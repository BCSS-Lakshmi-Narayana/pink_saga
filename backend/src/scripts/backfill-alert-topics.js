/**
* Classify `campaign_topic` on alerts, so they group into campaigns like mentions do.
*
*   node src/scripts/backfill-alert-topics.js --days 30 --dry-run
*   node src/scripts/backfill-alert-topics.js --days 30
*   node src/scripts/backfill-alert-topics.js --restale
*
* WHAT GETS CLASSIFIED, AND WHY IT IS NOT THE ALERT ITSELF
* -------------------------------------------------------
* The first version fed the model the alert's own title and description. Those are
* risk-detection labels — "high risk content detected", a matched keyword, a threat
* category — so two thirds came back "None", correctly: there is no civic issue in the
* words "high risk content detected".
*
* An alert points at the post that triggered it (content_ref_id -> contents.id), and THAT
* has the real text. So this joins to it and classifies the post, falling back to the
* alert's own title/description only when the content row is missing.
*
* RESUMABLE via campaign_topic_taxonomy_version; --restale revisits older versions.
*/

const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Alert = require('../models/Alert');
const { CAMPAIGN_TOPICS, TOPIC_TAXONOMY_VERSION, normalizeCampaignTopic } = require('../services/campaignTaxonomy');

const BASE_URL = (process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

const arg = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
const has = (f) => process.argv.includes(f);

const DRY_RUN = has('--dry-run');
const RESTALE = has('--restale');
const LIMIT = Number(arg('--limit')) || 0;
const DAYS = Number(arg('--days')) || 0;
let BATCH = Math.min(Math.max(Number(arg('--batch')) || 8, 1), 20);
const PER_POST_CHARS = Number(arg('--chars')) || 500;

const log = (m) => console.log(`[alert-topics] ${m}`);

const SYSTEM = `You classify social-media posts into campaign topics.
 
Allowed topics (use the exact string):
${CAMPAIGN_TOPICS.join(', ')}
 
You will be given numbered posts. Output ONE JSON object:
{"results":[{"n":1,"topic":"<one of the allowed>"},{"n":2,"topic":"..."}]}
 
Rules:
- One entry per post you were given, with the SAME number. Never skip one, never merge two.
- Pick the topic the post is ABOUT (the civic or policy subject), not its tone or severity.
- "Elections & Politics" is for party/candidate/campaign talk that names no service issue.
- "None" only for spam, advertising, unintelligible text, or pure personal abuse with no issue.
- Posts may be English, Telugu (Telugu script or Roman script), Urdu, Hindi, or mixed. Classify either way.`;

const pendingFilter = () => {
  const f = {};
  if (DAYS) f.published_at = { $gte: new Date(Date.now() - DAYS * 86400000) };
  if (!RESTALE) f.campaign_topic_taxonomy_version = null;
  else {
    f.$or = [
      { campaign_topic_taxonomy_version: null },
      { campaign_topic_taxonomy_version: { $lt: TOPIC_TAXONOMY_VERSION } },
    ];
  }
  return f;
};

const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

const classifyBatch = async (items) => {
  const prompt = items.map((it, i) => `[${i + 1}] ${it.text}`).join('\n\n');
  const res = await axios.post(`${BASE_URL}/api/chat`, {
    model: MODEL,
    stream: false,
    format: 'json',
    // No num_ctx: the server keeps this model resident at 4096 and asking for a different
    // size forces an unload/reload that outlasts the request timeout.
    options: { temperature: 0.1 },
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
  }, { timeout: parseInt(process.env.OLLAMA_TIMEOUT_MS || '300000', 10) });

  const raw = res.data?.message?.content || '';
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  const out = new Map();
  if (a < 0 || b < 0) return out;
  let parsed;
  try { parsed = JSON.parse(raw.slice(a, b + 1)); } catch { return out; }
  const rows = Array.isArray(parsed?.results) ? parsed.results : (Array.isArray(parsed) ? parsed : []);
  for (const r of rows) {
    const n = Number(r?.n);
    if (!Number.isFinite(n) || n < 1 || n > items.length) continue;
    // Position echoed back, not inferred from order — a short reply must lose one alert,
    // never shift every topic onto the wrong one.
    out.set(n - 1, normalizeCampaignTopic(r.topic));
  }
  return out;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || undefined });
  log(`ollama: ${BASE_URL} · model: ${MODEL}`);

  // Raw driver: `contents` has no model in this feature's scope and we only need one field.
  const contents = mongoose.connection.collection('contents');

  const filter = pendingFilter();
  const total = await Alert.countDocuments(filter);
  const target = LIMIT ? Math.min(LIMIT, total) : total;
  log(`${total} pending${DAYS ? `, last ${DAYS}d` : ''} — processing ${target} in batches of ${BATCH}${DRY_RUN ? ' [DRY RUN]' : ''}`);
  if (!target) { await mongoose.disconnect(); return; }

  const stats = { classified: 0, none: 0, empty: 0, missing: 0, failed: 0, fromPost: 0, fromAlert: 0 };
  const done = () => stats.classified + stats.none + stats.empty + stats.missing + stats.failed;
  const started = Date.now();
  const seen = new Set();

  while (done() < target) {
    const batch = await Alert.find({ ...filter, id: { $nin: [...seen] } })
      .select('id title description content_ref_id content_id')
      .sort({ published_at: -1 })
      .limit(Math.min(BATCH, target - done()))
      .lean();
    if (!batch.length) break;
    batch.forEach((d) => seen.add(d.id));

    // ── join to the post that triggered each alert ────────────────────────────
    const refIds = [...new Set(batch.map((a) => a.content_ref_id || a.content_id).filter(Boolean))];
    const posts = refIds.length
      ? await contents.find({ id: { $in: refIds } }, { projection: { id: 1, text: 1 } }).toArray()
      : [];
    const textById = new Map(posts.map((p) => [p.id, clean(p.text)]));

    const items = [];
    const emptyIds = [];
    for (const a of batch) {
      const postText = textById.get(a.content_ref_id || a.content_id) || '';
      // The post itself is the signal. The alert's own title is a risk label and says
      // nothing about which civic issue the content is about.
      const text = (postText || clean([a.title, a.description].filter(Boolean).join(' — '))).slice(0, PER_POST_CHARS);
      if (!text) { emptyIds.push(a.id); continue; }
      if (postText) stats.fromPost += 1; else stats.fromAlert += 1;
      items.push({ id: a.id, text });
    }

    stats.empty += emptyIds.length;
    if (emptyIds.length && !DRY_RUN) {
      await Alert.updateMany({ id: { $in: emptyIds } },
        { $set: { campaign_topic: null, campaign_topic_taxonomy_version: TOPIC_TAXONOMY_VERSION } });
    }
    if (!items.length) continue;

    let answers;
    const t0 = Date.now();
    try {
      answers = await classifyBatch(items);
    } catch (err) {
      if (err.response?.status === 404) {
        log(`FATAL: ${MODEL} is not available at ${BASE_URL}.`);
        log('       Check OLLAMA_MODEL and OLLAMA_BASE_URL in .env.');
        break;
      }
      if (/timeout/i.test(err.message) && BATCH > 1) {
        BATCH = Math.max(1, Math.floor(BATCH / 2));
        items.forEach((it) => seen.delete(it.id));
        log(`batch timed out — retrying with batch size ${BATCH}`);
        continue;
      }
      stats.failed += items.length;
      log(`batch failed: ${err.message}`);
      if (/ECONNREFUSED|ENOTFOUND|socket hang up|ECONNRESET/i.test(err.message)) break;
      continue;
    }

    const ops = [];
    for (let i = 0; i < items.length; i += 1) {
      if (!answers.has(i)) { stats.missing += 1; seen.delete(items[i].id); continue; }
      const topic = answers.get(i);
      if (topic) stats.classified += 1; else stats.none += 1;
      ops.push({
        updateOne: {
          filter: { id: items[i].id },
          update: { $set: { campaign_topic: topic, campaign_topic_taxonomy_version: TOPIC_TAXONOMY_VERSION } },
        },
      });
    }
    if (ops.length && !DRY_RUN) await Alert.bulkWrite(ops, { ordered: false });
    log(`  ${done()}/${target} · ${Math.round((Date.now() - t0) / 1000)}s/batch · ${stats.classified} classified · ${stats.none} no-topic · ${stats.missing} skipped · ${stats.failed} failed`);
  }

  log(`done in ${Math.round((Date.now() - started) / 60000)}m: ${JSON.stringify(stats)}`);
  log(`text source: ${stats.fromPost} from the linked post, ${stats.fromAlert} from the alert's own title`);
  await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });