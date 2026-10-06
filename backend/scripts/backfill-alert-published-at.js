#!/usr/bin/env node
/**
 * Backfill Alert.published_at for existing alerts.
 *
 *   node scripts/backfill-alert-published-at.js
 *
 * Strategy:
 *  1. Pull Alerts where published_at is null in batches of 500.
 *  2. For each batch, look up the underlying Content.published_at by content_id.
 *  3. If content has published_at -> set it. Else fall back to alert.created_at.
 *
 * Idempotent: re-running only touches rows where published_at is still null.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const BATCH = 500;

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const Alert = require('../src/models/Alert');
  const Content = require('../src/models/Content');

  let total = 0;
  let updated = 0;
  let usedFallback = 0;

  while (true) {
    const batch = await Alert.find({
      $or: [{ published_at: null }, { published_at: { $exists: false } }]
    })
      .select('id content_id content_ref_id created_at')
      .limit(BATCH)
      .lean();

    if (batch.length === 0) break;
    total += batch.length;

    const contentIds = Array.from(
      new Set(batch.map(a => a.content_id || a.content_ref_id).filter(Boolean))
    );
    const contents = await Content.find({ id: { $in: contentIds } })
      .select('id published_at')
      .lean();
    const contentMap = new Map(contents.map(c => [c.id, c.published_at]));

    const ops = batch.map(a => {
      const cid = a.content_id || a.content_ref_id;
      const pub = (cid && contentMap.get(cid)) || a.created_at;
      if (!cid || !contentMap.get(cid)) usedFallback += 1;
      return {
        updateOne: {
          filter: { _id: a._id },
          update: { $set: { published_at: pub } }
        }
      };
    });

    if (ops.length > 0) {
      const result = await Alert.bulkWrite(ops, { ordered: false });
      updated += result.modifiedCount || ops.length;
    }

    console.log(`  processed=${total} updated=${updated} fallback_to_created_at=${usedFallback}`);
  }

  console.log(`\nDone. total=${total} updated=${updated} fallback_to_created_at=${usedFallback}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
