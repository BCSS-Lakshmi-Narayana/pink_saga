/**
 * Backfill missing published_at for existing alerts
 * Uses content.published_at if available, falls back to alert.created_at
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Alert = require('../models/Alert');
const Content = require('../models/Content');

async function backfillPublishedAt() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/blura_hub');
    console.log('✓ Connected to MongoDB');

    // Find all alerts where published_at is missing/null
    const alertsNeedingUpdate = await Alert.find({
      $or: [
        { published_at: null },
        { published_at: { $exists: false } }
      ]
    }).select('id content_id content_ref_id created_at').lean();

    console.log(`Found ${alertsNeedingUpdate.length} alerts needing published_at backfill`);

    if (alertsNeedingUpdate.length === 0) {
      console.log('✓ All alerts already have published_at set');
      await mongoose.disconnect();
      return;
    }

    // Get content IDs
    const contentIds = alertsNeedingUpdate
      .map(a => a.content_id || a.content_ref_id)
      .filter(Boolean);

    // Fetch all content at once
    const contents = await Content.find({ id: { $in: contentIds } })
      .select('id published_at').lean();

    const contentMap = new Map(contents.map(c => [c.id, c]));

    // Prepare bulk updates
    let updatedCount = 0;
    for (const alert of alertsNeedingUpdate) {
      const contentId = alert.content_id || alert.content_ref_id;
      const content = contentId ? contentMap.get(contentId) : null;
      const publishedAt = content?.published_at || alert.created_at || new Date();

      try {
        await Alert.updateOne(
          { id: alert.id },
          { $set: { published_at: publishedAt } }
        );
        updatedCount++;
        if (updatedCount % 100 === 0) {
          console.log(`  Processed ${updatedCount}/${alertsNeedingUpdate.length}...`);
        }
      } catch (err) {
        console.error(`Failed to update alert ${alert.id}:`, err.message);
      }
    }

    console.log(`✓ Successfully backfilled ${updatedCount} alerts`);
    console.log('\nNow verify sorting is correct:');
    console.log('  $ npm run backfill-alert-published-at');
    console.log('  Then restart the server and alerts should sort by published_at (platform post date)');

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  }
}

backfillPublishedAt();
