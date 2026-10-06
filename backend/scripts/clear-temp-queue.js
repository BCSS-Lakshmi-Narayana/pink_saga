/**
 * Clear old pending/failed grievance items from the temp queue.
 * These were fetched BEFORE the keyword filter was applied and will keep
 * creating garbage grievances if left in the queue.
 *
 * Run: node scripts/clear-temp-queue.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bsk-watch';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  const TempContent = require('../src/models/TempContent');

  const pending = await TempContent.countDocuments({ status: 'pending', module: 'grievance' });
  const failed = await TempContent.countDocuments({ status: 'failed', module: 'grievance' });
  const processing = await TempContent.countDocuments({ status: 'processing', module: 'grievance' });

  console.log(`Temp queue grievance items:`);
  console.log(`  pending:   ${pending}`);
  console.log(`  failed:    ${failed}`);
  console.log(`  processing:${processing}`);

  const result = await TempContent.deleteMany({
    module: 'grievance',
    status: { $in: ['pending', 'failed'] }
  });

  console.log(`\nDeleted ${result.deletedCount} old temp queue items`);

  // Also clear processing items older than 1 hour (stale)
  const staleCutoff = new Date(Date.now() - 60 * 60 * 1000);
  const staleResult = await TempContent.deleteMany({
    module: 'grievance',
    status: 'processing',
    processing_started_at: { $lt: staleCutoff }
  });

  if (staleResult.deletedCount > 0) {
    console.log(`Deleted ${staleResult.deletedCount} stale processing items (>1hr old)`);
  }

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
