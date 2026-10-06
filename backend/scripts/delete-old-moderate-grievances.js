/**
 * delete-old-moderate-grievances.js
 * ---------------------------------------------------------------------------
 * Deletes the OLDEST N grievances whose sentiment is Moderate (stored as
 * 'moderate', with legacy 'neutral' also included).
 *
 * "Oldest" = earliest fetched, i.e. ordered by `created_at` ascending
 * (ingestion order), with `_id` as a tiebreaker. Only Moderate/Neutral rows
 * are ever touched, and only the oldest N of them — nothing else is removed.
 *
 * Safe by default: a DRY RUN just previews what would be deleted. You must
 * pass --confirm to actually delete.
 *
 * Usage (run from the backend/ folder):
 *   node scripts/delete-old-moderate-grievances.js                 # DRY RUN (preview only)
 *   node scripts/delete-old-moderate-grievances.js --confirm       # delete oldest 2000
 *   node scripts/delete-old-moderate-grievances.js --confirm --limit 2000
 */
require('dotenv').config();
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const limIdx = args.indexOf('--limit');
const LIMIT = (limIdx !== -1 && args[limIdx + 1]) ? Math.max(1, parseInt(args[limIdx + 1], 10)) : 2000;

// Moderate is the current label; 'neutral' is the legacy value for the same bucket.
const SENTIMENTS = ['moderate', 'neutral'];

const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('✖ MONGODB_URI is missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, process.env.DB_NAME ? { dbName: process.env.DB_NAME } : undefined);
  const col = mongoose.connection.db.collection('grievances');

  const filter = { 'analysis.sentiment': { $in: SENTIMENTS } };

  const totalModerate = await col.countDocuments(filter);
  console.log(`Moderate/Neutral grievances currently in DB : ${totalModerate.toLocaleString()}`);
  if (totalModerate === 0) {
    console.log('Nothing to delete.');
    await mongoose.disconnect();
    return;
  }

  // Oldest first, by fetch/ingestion time.
  const victims = await col
    .find(filter)
    .project({ _id: 1, created_at: 1, post_date: 1 })
    .sort({ created_at: 1, _id: 1 })
    .limit(LIMIT)
    .toArray();

  const ids = victims.map((v) => v._id);
  const first = victims[0];
  const last = victims[victims.length - 1];

  console.log(`Selected the oldest ${ids.length} of them (limit ${LIMIT}).`);
  console.log(`  created_at (fetch date) range : ${fmt(first?.created_at)}  ->  ${fmt(last?.created_at)}`);
  console.log(`  post_date  (article date) range : ${fmt(first?.post_date)}  ->  ${fmt(last?.post_date)}`);

  if (!CONFIRM) {
    console.log(`\n── DRY RUN ── nothing was deleted.`);
    console.log(`Re-run with --confirm to permanently delete these ${ids.length} Moderate grievances:`);
    console.log(`  node scripts/delete-old-moderate-grievances.js --confirm --limit ${LIMIT}`);
    await mongoose.disconnect();
    return;
  }

  console.log(`\nDeleting ${ids.length} rows…`);
  const res = await col.deleteMany({ _id: { $in: ids } });
  console.log(`✔ Deleted ${res.deletedCount} grievances.`);
  console.log(`Remaining Moderate/Neutral : ${(await col.countDocuments(filter)).toLocaleString()}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error('✖ ERROR:', e.message);
  process.exit(1);
});
