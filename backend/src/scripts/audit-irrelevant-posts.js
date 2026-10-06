/**
 * audit-irrelevant-posts.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Counts — and optionally quarantines — Mentions that a keyword search returned
 * but that are not actually about anything we monitor.
 *
 * WHY THESE EXIST
 * ───────────────
 * The search APIs match loosely and semantically: ask for a leader's name and you
 * also get posts that merely resemble the query. `grievanceService.passesKeywordGate`
 * rejects those AT INGEST, but it was added after this corpus was collected, so
 * everything already in the database went in ungated.
 *
 * Re-running the analysis does NOT remove them — it re-scores them. A junk post
 * simply gets a fresh verdict and keeps polluting every dashboard aggregate, the
 * AI-Campaigns topic ranking, and the RAG retrieval pool.
 *
 * THE TEST APPLIED IS THE INGEST GATE ITSELF
 * ──────────────────────────────────────────
 * Not a new heuristic — literally `passesKeywordGate(text, handle, keyword)`, the
 * same function live ingestion uses. A post is kept if ANY of these hold:
 *   1. the full keyword phrase appears in the text, OR
 *   2. a significant token of it appears in the text or the author handle, OR
 *   3. the deterministic roster scan recognises any political entity in the text.
 * (3) is what rescues a genuinely relevant post written in a different script
 * from the search term, so this is conservative by construction.
 *
 * SAFETY
 * ──────
 *   • Default mode reports only. Nothing is written without --move.
 *   • --move COPIES to `irrelevant_grievances` FIRST, verifies the copy landed,
 *     and only then removes the original. A crash mid-run leaves a duplicate,
 *     never a hole.
 *   • --restore puts a quarantined batch back, so the move is reversible.
 *   • Posts with no recorded search keyword are reported separately and are
 *     NEVER moved — an unknown provenance is not evidence of irrelevance.
 *
 * USAGE
 *   node src/scripts/audit-irrelevant-posts.js                  # report, whole corpus
 *   node src/scripts/audit-irrelevant-posts.js --days 30        # report, recent window
 *   node src/scripts/audit-irrelevant-posts.js --samples 40     # show more examples
 *   node src/scripts/audit-irrelevant-posts.js --move           # quarantine them
 *   node src/scripts/audit-irrelevant-posts.js --move --days 30
 *   node src/scripts/audit-irrelevant-posts.js --restore        # undo the last move
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Grievance = require('../models/Grievance');
const { passesKeywordGate } = require('../services/grievanceService');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  if (i === -1 || i + 1 >= args.length) return d;
  return args[i + 1];
};

const MOVE = has('--move');
const RESTORE = has('--restore');
const DAYS = parseInt(val('--days', '0'), 10);
const SAMPLES = parseInt(val('--samples', '15'), 10);
const BATCH = 1000;
const QUARANTINE = 'irrelevant_grievances';

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0');

const windowFilter = () => {
  if (!DAYS) return {};
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  return { $or: [{ post_date: { $gte: since } }, { detected_date: { $gte: since } }] };
};

async function restore() {
  const col = mongoose.connection.db.collection(QUARANTINE);
  const total = await col.countDocuments({});
  if (!total) {
    console.log(`Nothing in ${QUARANTINE} to restore.`);
    return;
  }
  console.log(`Restoring ${total} documents from ${QUARANTINE} back into grievances…`);
  let restored = 0;
  let skipped = 0;
  const cursor = col.find({});
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const { _quarantine, ...original } = doc;
    const exists = await Grievance.collection.findOne({ id: original.id }, { projection: { _id: 1 } });
    if (exists) { skipped += 1; continue; }
    await Grievance.collection.insertOne(original);
    await col.deleteOne({ _id: doc._id });
    restored += 1;
    if (restored % 500 === 0) console.log(`   … ${restored}/${total}`);
  }
  console.log(`\nrestored : ${restored}`);
  console.log(`skipped  : ${skipped} (already present in grievances)`);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`connected: ${mongoose.connection.name}\n`);

  if (RESTORE) {
    await restore();
    await mongoose.disconnect();
    return;
  }

  const filter = windowFilter();
  const total = await Grievance.countDocuments(filter);
  console.log('='.repeat(78));
  console.log(`IRRELEVANT-POST AUDIT   window=${DAYS ? `last ${DAYS} days` : 'ALL'}   mode=${MOVE ? 'MOVE' : 'report only'}`);
  console.log('='.repeat(78));
  console.log(`grievances in window : ${total}\n`);

  const stats = {
    checked: 0,
    kept: 0,
    failed: 0,
    noKeyword: 0,
    noText: 0,
    promoted: 0,
    byKeyword: new Map(),
    byPlatform: new Map(),
  };
  const samples = [];
  const failedIds = [];

  let lastId = null;
  /* eslint-disable no-await-in-loop */
  while (true) {
    const q = { ...filter };
    if (lastId) q._id = { $gt: lastId };
    const batch = await Grievance.find(q)
      .sort({ _id: 1 })
      .limit(BATCH)
      .select('id _id tagged_account platform content.text posted_by.handle post_date tweet_url')
      .lean();
    if (!batch.length) break;
    lastId = batch[batch.length - 1]._id;

    for (const g of batch) {
      stats.checked += 1;
      const text = g.content?.text || '';
      const handle = g.posted_by?.handle || '';
      const keyword = (g.tagged_account || '').trim();

      if (!text || text === '(no text)') { stats.noText += 1; stats.kept += 1; continue; }
      // Unknown provenance is not evidence of irrelevance — count, never move.
      if (!keyword) { stats.noKeyword += 1; stats.kept += 1; continue; }

      /**
       * EXEMPT: posts promoted from an Alert by the former alerts → mentions job, which
       * stores `alert:<uuid>` in tagged_account as a provenance tag — NOT a search
       * term. Gate-checking those tokenises a UUID, matches nothing, and the post
       * survives only if the roster scan happens to catch it.
       *
       * This is not hypothetical: the first run of this audit flagged 147 posts and
       * every one was of this kind, including @naralokesh's own Instagram post and
       * several @bangaloretdp posts. They had already passed the relevance filter in
       * that job — a different, stricter gate — before promotion.
       * Re-judging them with the wrong test would have deleted relevant data.
       */
      if (/^alert:/i.test(keyword)) { stats.promoted += 1; stats.kept += 1; continue; }

      if (passesKeywordGate(text, handle, keyword)) { stats.kept += 1; continue; }

      stats.failed += 1;
      failedIds.push(g.id);
      stats.byKeyword.set(keyword, (stats.byKeyword.get(keyword) || 0) + 1);
      stats.byPlatform.set(g.platform || 'unknown', (stats.byPlatform.get(g.platform || 'unknown') || 0) + 1);
      if (samples.length < SAMPLES) {
        samples.push({ id: g.id, keyword, platform: g.platform, handle, text: text.replace(/\s+/g, ' ').slice(0, 140) });
      }
    }
    process.stdout.write(`\r   scanned ${stats.checked}/${total}…`);
  }
  /* eslint-enable no-await-in-loop */
  process.stdout.write('\r'.padEnd(40) + '\r');

  console.log('RESULT');
  console.log('─'.repeat(78));
  console.log(`checked                  : ${stats.checked}`);
  console.log(`pass the ingest gate     : ${stats.kept}  (${pct(stats.kept, stats.checked)}%)`);
  console.log(`FAIL the gate            : ${stats.failed}  (${pct(stats.failed, stats.checked)}%)   ← irrelevant`);
  console.log(`  not judged (counted as kept, never moved):`);
  console.log(`    no search keyword recorded : ${stats.noKeyword}`);
  console.log(`    no text                    : ${stats.noText}`);
  console.log(`    promoted from an Alert     : ${stats.promoted}  (tagged_account is "alert:<uuid>", not a search term)`);

  if (stats.byPlatform.size) {
    console.log('\nfailures by platform');
    console.log('─'.repeat(78));
    [...stats.byPlatform.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([p, n]) => console.log(`  ${String(p).padEnd(14)} ${String(n).padStart(7)}`));
  }

  if (stats.byKeyword.size) {
    console.log('\ntop search keywords producing noise');
    console.log('─'.repeat(78));
    [...stats.byKeyword.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
      .forEach(([k, n]) => console.log(`  ${String(n).padStart(7)}  ${k}`));
  }

  if (samples.length) {
    console.log(`\nsamples (${samples.length}) — check these before moving anything`);
    console.log('─'.repeat(78));
    samples.forEach((s, i) => {
      console.log(`${String(i + 1).padStart(3)}. [${s.platform}] keyword="${s.keyword}" @${s.handle}`);
      console.log(`     ${s.text}`);
    });
  }

  if (!MOVE) {
    console.log('\n' + '='.repeat(78));
    console.log('REPORT ONLY — nothing was written.');
    console.log(`To quarantine these ${stats.failed} posts into "${QUARANTINE}":`);
    console.log(`  node src/scripts/audit-irrelevant-posts.js${DAYS ? ` --days ${DAYS}` : ''} --move`);
    console.log('='.repeat(78));
    await mongoose.disconnect();
    return;
  }

  if (!stats.failed) {
    console.log('\nNothing to move.');
    await mongoose.disconnect();
    return;
  }

  console.log(`\nMOVING ${stats.failed} posts → ${QUARANTINE} …`);
  const col = mongoose.connection.db.collection(QUARANTINE);
  let moved = 0;
  let failedMoves = 0;
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < failedIds.length; i += 200) {
    const ids = failedIds.slice(i, i + 200);
    const docs = await Grievance.collection.find({ id: { $in: ids } }).toArray();
    if (!docs.length) continue;

    // Copy first. Only delete originals whose copy is confirmed present, so an
    // interruption can only ever duplicate — never lose a record.
    await col.insertMany(
      docs.map((d) => ({ ...d, _quarantine: { at: new Date(), reason: 'failed passesKeywordGate', keyword: d.tagged_account || null } })),
      { ordered: false }
    ).catch((e) => { if (e.code !== 11000) throw e; });

    const confirmed = await col.distinct('id', { id: { $in: docs.map((d) => d.id) } });
    if (confirmed.length) {
      await Grievance.collection.deleteMany({ id: { $in: confirmed } });
      moved += confirmed.length;
    }
    failedMoves += docs.length - confirmed.length;
    process.stdout.write(`\r   moved ${moved}/${failedIds.length}…`);
  }
  /* eslint-enable no-await-in-loop */
  process.stdout.write('\r'.padEnd(40) + '\r');

  const remaining = await Grievance.countDocuments(filter);
  console.log('\n' + '='.repeat(78));
  console.log(`moved to ${QUARANTINE} : ${moved}`);
  if (failedMoves) console.log(`copy not confirmed, LEFT IN PLACE : ${failedMoves}`);
  console.log(`grievances in window before : ${total}`);
  console.log(`grievances in window after  : ${remaining}`);
  console.log(`\nreversible: node src/scripts/audit-irrelevant-posts.js --restore`);
  console.log('='.repeat(78));

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
