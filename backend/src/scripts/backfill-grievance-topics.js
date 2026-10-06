/**
 * Classify `analysis.topic` — the 16-value CAMPAIGN taxonomy — on posts that lack it.
 *
 *   node src/scripts/backfill-grievance-topics.js --days 30 --dry-run
 *   node src/scripts/backfill-grievance-topics.js --days 30
 *   node src/scripts/backfill-grievance-topics.js                  # everything
 *   node src/scripts/backfill-grievance-topics.js --all-stances    # ignore the stance filter
 *   node src/scripts/backfill-grievance-topics.js --restale        # revisit older taxonomy versions
 *
 * TWO THINGS MAKE THIS CHEAP, AND BOTH MATTER AT THIS CORPUS SIZE.
 *
 * 1. ONLY CAMPAIGNABLE POSTS. A post with no pro/anti stance towards us is excluded from
 *    the campaign aggregation no matter what topic it has, so classifying it buys
 *    nothing. On this database that is the difference between 15,411 posts in a 30-day
 *    window and 6,121 — a 60% saving for no loss of output. --all-stances opts out.
 *
 * 2. BATCHED. One post per call spends most of its time on round-trips: measured at
 *    ~10s each, 6,121 posts is ~17 hours. The prompt is ~600 chars per post, so ten fit
 *    in an 8k context comfortably and the same work takes about two hours.
 *
 * RESUMABLE. `analysis.topic_taxonomy_version` is the cursor. A post that classifies to
 * nothing usable is still stamped, so it is not retried forever; --restale is how you
 * deliberately revisit after changing the taxonomy.
 *
 * THIS USES THE GPU (Ollama). The embedding backfill does not — run that one freely.
 */

const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Grievance = require('../models/Grievance');
const { CAMPAIGN_TOPICS, TOPIC_TAXONOMY_VERSION, normalizeCampaignTopic } = require('../services/campaignTaxonomy');

const BASE_URL = (process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

const arg = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
const has = (f) => process.argv.includes(f);

const DRY_RUN = has('--dry-run');
const RESTALE = has('--restale');
const ALL_STANCES = has('--all-stances');
const LIMIT = Number(arg('--limit')) || 0;
const DAYS = Number(arg('--days')) || 0;
let BATCH = Math.min(Math.max(Number(arg('--batch')) || 8, 1), 20);
// Per-post text budget. 600 chars is what a single-post prompt used; ten of those plus
// the instructions is ~7k chars, which fits the 8k window this server will serve.
const PER_POST_CHARS = Number(arg('--chars')) || 500;

// The stances that can ever produce a campaign — the same list campaignTopicService
// aggregates on. Anything else is invisible to the engine downstream.
const CAMPAIGNABLE = ['pro_target', 'pro_target_indirect', 'anti_target', 'anti_target_indirect'];

const log = (m) => console.log(`[topic-backfill] ${m}`);

const SYSTEM = `You classify social-media posts into campaign topics.

Allowed topics (use the exact string):
${CAMPAIGN_TOPICS.join(', ')}

You will be given numbered posts. Output ONE JSON object:
{"results":[{"n":1,"topic":"<one of the allowed>"},{"n":2,"topic":"..."}]}

Rules:
- One entry per post you were given, with the SAME number. Never skip one, never merge two.
- Pick the topic the post is ABOUT (the civic or policy subject), not its tone.
- "Elections & Politics" is for party/candidate/campaign talk that names no service issue.
- "None" only for spam, advertising, unintelligible text, or pure personal abuse with no issue.
- Posts may be English, Telugu (Telugu script or Roman script), Urdu, Hindi, or mixed. Classify either way.`;

const pendingFilter = () => {
  const f = { is_active: { $ne: false } };
  if (DAYS) f.post_date = { $gte: new Date(Date.now() - DAYS * 86400000) };
  if (!ALL_STANCES) f['analysis.political_stance'] = { $in: CAMPAIGNABLE };
  if (!RESTALE) {
    f['analysis.topic_taxonomy_version'] = null;
  } else {
    f.$or = [
      { 'analysis.topic_taxonomy_version': null },
      { 'analysis.topic_taxonomy_version': { $lt: TOPIC_TAXONOMY_VERSION } },
    ];
  }
  return f;
};

const textOf = (d) => String(d.content?.text || '').replace(/\s+/g, ' ').trim().slice(0, PER_POST_CHARS);

/**
 * Classify a batch. Returns a Map of position → canonical topic (or null).
 *
 * Positions are echoed back by the model rather than inferred from array order: a 7B
 * asked for ten answers sometimes returns nine, and silently shifting every topic up by
 * one would mislabel the whole batch instead of losing one post.
 */
const classifyBatch = async (items) => {
  const prompt = items.map((it, i) => `[${i + 1}] ${it.text}`).join('\n\n');
  const res = await axios.post(`${BASE_URL}/api/chat`, {
    model: MODEL,
    stream: false,
    format: 'json',                 // asking for JSON in the prompt is not enough on a 7B
    // NO num_ctx. The server keeps this model resident at 4096, and asking for a
    // different size makes Ollama unload and reload it — which, with a second model also
    // resident, took longer than the request timeout and failed every batch. The prompt
    // below is sized to fit 4096 instead.
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
    out.set(n - 1, normalizeCampaignTopic(r.topic));
  }
  return out;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || undefined });
  log(`ollama: ${BASE_URL} · model: ${MODEL}`);

  const filter = pendingFilter();
  const total = await Grievance.countDocuments(filter);
  const target = LIMIT ? Math.min(LIMIT, total) : total;
  log(`${total} pending${ALL_STANCES ? '' : ' (campaignable only)'}${DAYS ? `, last ${DAYS}d` : ''}`);
  log(`processing ${target} in batches of ${BATCH} with ${MODEL}${DRY_RUN ? ' [DRY RUN]' : ''}`);
  if (!target) { await mongoose.disconnect(); return; }

  const stats = { classified: 0, none: 0, empty: 0, missing: 0, failed: 0 };
  const done = () => stats.classified + stats.none + stats.empty + stats.missing + stats.failed;
  const started = Date.now();
  const seen = new Set();

  while (done() < target) {
    const batch = await Grievance.find({ ...filter, id: { $nin: [...seen] } })
      .select('id content.text')
      .sort({ post_date: -1 })
      .limit(Math.min(BATCH, target - done()))
      .lean();
    if (!batch.length) break;
    batch.forEach((d) => seen.add(d.id));

    const items = batch.map((d) => ({ id: d.id, text: textOf(d) })).filter((it) => it.text);
    const emptyIds = batch.filter((d) => !textOf(d)).map((d) => d.id);
    stats.empty += emptyIds.length;
    // Stamped even though they were never asked about, or the cursor never moves past
    // them and the loop reads the same rows forever.
    if (emptyIds.length && !DRY_RUN) {
      await Grievance.updateMany({ id: { $in: emptyIds } },
        { $set: { 'analysis.topic': null, 'analysis.topic_taxonomy_version': TOPIC_TAXONOMY_VERSION } });
    }
    if (!items.length) continue;

    let answers;
    const t0 = Date.now();
    try {
      answers = await classifyBatch(items);
    } catch (err) {
      // A timeout is usually the batch being too big for the loaded window, not a broken
      // server — so shrink and put these items back rather than writing them off. They
      // were added to `seen` before the call; removing them re-queues them.
      if (/timeout/i.test(err.message) && BATCH > 1) {
        BATCH = Math.max(1, Math.floor(BATCH / 2));
        items.forEach((it) => seen.delete(it.id));
        log(`batch timed out — retrying with batch size ${BATCH}`);
        continue;
      }
      stats.failed += items.length;
      log(`batch failed: ${err.message}`);
      // A dead server should stop the run, not spin through the whole corpus failing.
      // 404 = the model is not on that server; 6,000 more identical failures teach
      // nothing. Same for a dead host.
      if (err.response?.status === 404) {
        log(`FATAL: ${MODEL} is not available at ${BASE_URL}.`);
        log('       Check OLLAMA_MODEL and OLLAMA_BASE_URL in .env, and `curl $OLLAMA_BASE_URL/api/tags` to see what is installed.');
        break;
      }
      if (/ECONNREFUSED|ENOTFOUND|socket hang up/i.test(err.message)) break;
      continue;
    }

    const ops = [];
    for (let i = 0; i < items.length; i += 1) {
      if (!answers.has(i)) { stats.missing += 1; continue; }  // retried on the next pass
      const topic = answers.get(i);
      if (topic) stats.classified += 1; else stats.none += 1;
      ops.push({
        updateOne: {
          filter: { id: items[i].id },
          update: { $set: { 'analysis.topic': topic, 'analysis.topic_taxonomy_version': TOPIC_TAXONOMY_VERSION } },
        },
      });
    }
    // A post the model skipped is left untouched AND removed from `seen`, so the next
    // pass picks it up rather than losing it.
    items.forEach((it, i) => { if (!answers.has(i)) seen.delete(it.id); });
    if (ops.length && !DRY_RUN) await Grievance.bulkWrite(ops, { ordered: false });

    const elapsed = (Date.now() - started) / 1000;
    const rate = done() / elapsed;
    const eta = rate > 0 ? Math.round((target - done()) / rate / 60) : 0;
    log(`  ${done()}/${target} · ${Math.round((Date.now() - t0) / 1000)}s/batch · ${stats.classified} classified · ${stats.none} no-topic · ${stats.missing} skipped · ${stats.failed} failed · ~${eta}m left`);
  }

  log(`done in ${Math.round((Date.now() - started) / 60000)}m: ${JSON.stringify(stats)}`);
  if (stats.missing) log(`note: ${stats.missing} posts the model skipped are still pending — re-run to pick them up.`);
  await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
