/**
 * Embed grievances that have no usable vector yet, so hybrid retrieval has something to
 * search.
 *
 *   node src/scripts/backfill-grievance-embeddings.js --days 30
 *   node src/scripts/backfill-grievance-embeddings.js --days 30 --dry-run
 *   node src/scripts/backfill-grievance-embeddings.js --days 30 --all-stances
 *   node src/scripts/backfill-grievance-embeddings.js --limit 200
 *
 * RESUMABLE. Every document this script looks at is stamped before it moves on — even
 * the ones it decides not to embed — so an interrupted run picks up exactly where it
 * stopped and a second run costs nothing. Work already done is never repeated.
 *
 * THAT STAMPING IS THE WHOLE TRICK. Get it wrong and a document that was selected but
 * then skipped still matches the filter on the next pass, so the loop reads the same rows
 * forever — which is what produced "0 embedded · 32 unchanged" on repeat. Nothing may
 * leave this loop unstamped.
 *
 * ONLY CAMPAIGNABLE POSTS BY DEFAULT. Retrieval filters by stance at query time, so a
 * post with no pro/anti stance towards us is never searched however well embedded it is.
 * On this database that is ~6,100 posts in a 30-day window instead of ~15,150. Pass
 * --all-stances to embed everything anyway.
 *
 * Provider is whatever EMBEDDING_PROVIDER says — local CPU (xenova) or the Ollama server.
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Grievance = require('../models/Grievance');
const embeddings = require('../services/rag/embeddingService');
const { MODEL, DIMS, PROVIDER } = require('../services/rag/embeddingConfig');

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const has = (flag) => process.argv.includes(flag);

const DRY_RUN = has('--dry-run');
const ALL_STANCES = has('--all-stances');
const LIMIT = Number(arg('--limit')) || 0;
const DAYS = Number(arg('--days')) || 0;
const BATCH = Number(arg('--batch')) || 32;
// A dropped connection to Ollama is nearly always GPU contention, not a real failure.
const MAX_RETRIES = Number(arg('--retries')) || 3;

// The stances the campaign engine can actually build on — same list campaignTopicService
// aggregates over. Anything else is invisible downstream.
const CAMPAIGNABLE = ['pro_target', 'pro_target_indirect', 'anti_target', 'anti_target_indirect'];

const log = (m) => console.log(`[embed-backfill] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || undefined });

  const filter = { is_active: { $ne: false } };
  if (DAYS) filter.post_date = { $gte: new Date(Date.now() - DAYS * 86400000) };
  if (!ALL_STANCES) filter['analysis.political_stance'] = { $in: CAMPAIGNABLE };
  // Never embedded, or embedded under a DIFFERENT model. Vectors from two models are not
  // comparable, so a mixed collection cannot be searched coherently. This clause is also
  // the resume cursor: anything already done under this model drops out of the query.
  filter.$or = [
    { embedded_at: null },
    { embedded_at: { $exists: false } },
    { embedding_model: { $ne: MODEL } },
  ];

  const total = await Grievance.countDocuments(filter);
  const target = LIMIT ? Math.min(LIMIT, total) : total;
  log(`provider=${PROVIDER} model=${MODEL} (${DIMS}d)${ALL_STANCES ? '' : ' · campaignable only'}`);
  log(`${total} pending, processing ${target}${DRY_RUN ? ' [DRY RUN]' : ''}`);
  if (!target) { log('nothing to do — everything in scope is already embedded.'); await mongoose.disconnect(); return; }

  const stats = { embedded: 0, skippedEmpty: 0, unchanged: 0, failed: 0 };
  const done = () => stats.embedded + stats.skippedEmpty + stats.unchanged + stats.failed;
  const started = Date.now();
  let attempt = 0;

  while (done() < target) {
    const batch = await Grievance.find(filter)
      // embedding_model is selected because the "already done" test below compares it.
      // Without it the field is always undefined, the test never matches, and every
      // document looks like it still needs work.
      .select('id content.text embedding_text_hash embedding_model')
      .sort({ post_date: -1 })
      .limit(Math.min(BATCH, target - done()))
      .lean();
    if (!batch.length) break;

    const prepared = batch.map((d) => ({ doc: d, text: embeddings.prepare(d.content?.text || '') }));

    // ── 1. nothing to embed ───────────────────────────────────────────────────
    const emptyIds = prepared.filter((p) => !p.text).map((p) => p.doc.id);
    stats.skippedEmpty += emptyIds.length;
    if (emptyIds.length && !DRY_RUN) {
      await Grievance.updateMany({ id: { $in: emptyIds } }, {
        $set: { embedded_at: new Date(), embedding_model: MODEL, embedding_dims: 0 },
      });
    }

    // ── 2. already correct: same text AND same model ──────────────────────────
    const usable = prepared.filter((p) => p.text).map((p) => ({ ...p, hash: embeddings.textHash(p.text) }));
    const isDone = (p) => p.doc.embedding_text_hash === p.hash && p.doc.embedding_model === MODEL;
    const unchanged = usable.filter(isDone);
    stats.unchanged += unchanged.length;
    // Stamped even though nothing was recomputed, or they match the filter again next
    // pass and the loop never terminates.
    if (unchanged.length && !DRY_RUN) {
      await Grievance.updateMany({ id: { $in: unchanged.map((p) => p.doc.id) } },
        { $set: { embedded_at: new Date() } });
    }

    // ── 3. the ones that actually need a vector ───────────────────────────────
    const toEmbed = usable.filter((p) => !isDone(p));
    if (!toEmbed.length) {
      log(`  ${done()}/${target} · ${stats.embedded} embedded · ${stats.unchanged} unchanged · ${stats.skippedEmpty} empty`);
      continue;
    }
    if (DRY_RUN) {
      stats.embedded += toEmbed.length;
    } else {
      try {
        const vectors = await embeddings.embedBatch(toEmbed.map((p) => p.text));
        const ops = [];
        for (let i = 0; i < toEmbed.length; i += 1) {
          const v = vectors[i];
          // embeddingService already rejects wrong dimensions and zero vectors, so a
          // missing entry means that one text failed rather than the whole batch.
          if (!Array.isArray(v) || !v.length) { stats.failed += 1; continue; }
          ops.push({
            updateOne: {
              filter: { id: toEmbed[i].doc.id },
              update: {
                $set: {
                  embedding: v,
                  embedding_model: MODEL,
                  embedding_dims: v.length,
                  embedding_text_hash: toEmbed[i].hash,
                  embedded_at: new Date(),
                },
              },
            },
          });
        }
        if (ops.length) await Grievance.bulkWrite(ops, { ordered: false });
        stats.embedded += ops.length;
        attempt = 0;   // the run is healthy again
      } catch (err) {
        /**
         * Retry, do not abandon the run.
         *
         * ECONNRESET here means the Ollama box dropped the connection — normally because
         * it was evicting a model under VRAM pressure while another job used the GPU. The
         * batch is untouched in the database, so waiting and asking again is safe, and it
         * beats stopping 3,600 documents in with 11,000 to go.
         */
        const transient = /ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|socket hang up|timeout|502|503|504/i.test(err.message);
        if (transient && attempt < MAX_RETRIES) {
          attempt += 1;
          const wait = attempt * 10;
          log(`batch failed (${err.message}) — retry ${attempt}/${MAX_RETRIES} in ${wait}s`);
          await sleep(wait * 1000);
          continue;   // same batch is re-read; nothing was written, so nothing is skipped
        }
        stats.failed += toEmbed.length;
        log(`batch failed: ${err.message}`);
        log('stopping — re-run the same command later and it resumes from here.');
        break;
      }
    }

    const rate = done() / ((Date.now() - started) / 1000);
    const eta = rate > 0 ? Math.round((target - done()) / rate / 60) : 0;
    log(`  ${done()}/${target} · ${stats.embedded} embedded · ${stats.unchanged} unchanged · ${stats.skippedEmpty} empty · ${stats.failed} failed · ~${eta}m left`);
  }

  log(`done in ${Math.round((Date.now() - started) / 60000)}m: ${JSON.stringify(stats)}`);
  await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
