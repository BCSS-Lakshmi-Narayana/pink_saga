require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Delete the oldest N grievances and their related report records.
 *
 * Deletes from:
 *   - grievances               (main record, includes embedded `analysis`)
 *   - criticismreports         (grievance_id -> grievance.id)
 *   - suggestionreports        (grievance_id -> grievance.id)
 *   - queryreports             (grievance_id -> grievance.id)
 *   - grievanceworkflowreports (grievance_id -> grievance.id)
 *
 * Usage:
 *   node scripts/delete_old_grievances.js                  -> dry-run, oldest 1000 by post_date
 *   node scripts/delete_old_grievances.js --limit=500       -> dry-run, oldest 500
 *   node scripts/delete_old_grievances.js --sort=detected_date
 *   node scripts/delete_old_grievances.js --apply           -> actually deletes
 */

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 1000;
const sortArg = args.find(a => a.startsWith('--sort='));
const sortField = sortArg ? sortArg.split('=')[1] : 'post_date';

if (!Number.isFinite(limit) || limit <= 0) {
  console.error(`Invalid --limit value: ${limit}`);
  process.exit(1);
}
if (!['post_date', 'detected_date', 'created_at'].includes(sortField)) {
  console.error(`Invalid --sort value: ${sortField} (expected post_date|detected_date|created_at)`);
  process.exit(1);
}

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set in .env');
    process.exit(1);
  }

  const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
  await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
  console.log(`Connected to MongoDB (db=${mongoose.connection.name})`);
  console.log(`[DeleteOldGrievances] Mode: ${apply ? 'APPLY (destructive)' : 'DRY-RUN'}`);
  console.log(`[DeleteOldGrievances] Selecting oldest ${limit} grievances by ${sortField} ascending`);

  const db = mongoose.connection.db;
  const grievancesCol = db.collection('grievances');

  const totalCount = await grievancesCol.countDocuments({});
  const oldest = await grievancesCol
    .find({}, { projection: { id: 1, complaint_code: 1, platform: 1, tagged_account: 1, post_date: 1, detected_date: 1, created_at: 1, _id: 1 } })
    .sort({ [sortField]: 1 })
    .limit(limit)
    .toArray();

  console.log(`\nTotal grievances in DB: ${totalCount}`);
  console.log(`Matched for deletion: ${oldest.length}`);
  console.log('\nOldest sample (first 5):');
  console.log(oldest.slice(0, 5).map(g => ({
    id: g.id, complaint_code: g.complaint_code, platform: g.platform,
    tagged_account: g.tagged_account, post_date: g.post_date, detected_date: g.detected_date
  })));
  console.log('\nNewest of the selected batch (last 5):');
  console.log(oldest.slice(-5).map(g => ({
    id: g.id, complaint_code: g.complaint_code, platform: g.platform,
    tagged_account: g.tagged_account, post_date: g.post_date, detected_date: g.detected_date
  })));

  const grievanceIds = oldest.map(g => g.id).filter(Boolean);
  const grievanceObjectIds = oldest.map(g => g._id);

  const relatedCollections = ['criticismreports', 'suggestionreports', 'queryreports', 'grievanceworkflowreports'];
  const relatedCounts = {};
  for (const name of relatedCollections) {
    const exists = await db.listCollections({ name }).toArray();
    if (exists.length === 0) {
      relatedCounts[name] = 0;
      continue;
    }
    relatedCounts[name] = await db.collection(name).countDocuments({ grievance_id: { $in: grievanceIds } });
  }

  console.log('\nRelated report records that would be deleted:');
  console.log(relatedCounts);

  if (!apply) {
    console.log('\nDRY-RUN complete. No documents were deleted. Re-run with --apply to proceed.');
    await mongoose.disconnect();
    return;
  }

  console.log('\nApplying deletions...');
  for (const name of relatedCollections) {
    if (relatedCounts[name] === 0) continue;
    const res = await db.collection(name).deleteMany({ grievance_id: { $in: grievanceIds } });
    console.log(`  [${name}] deleted=${res.deletedCount}`);
  }

  const grievanceRes = await grievancesCol.deleteMany({ _id: { $in: grievanceObjectIds } });
  console.log(`  [grievances] deleted=${grievanceRes.deletedCount}`);

  await mongoose.disconnect();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
