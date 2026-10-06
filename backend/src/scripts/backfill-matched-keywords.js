/**
 * Backfill matched_keywords for existing alerts
 * Matches alert content against configured keywords list
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const Alert = require('../models/Alert');
const Content = require('../models/Content');
const Keyword = require('../models/Keyword');

// Match content against configured keywords
const matchConfiguredKeywords = async (contentText = '') => {
  try {
    if (!contentText || typeof contentText !== 'string') return [];

    const keywords = await Keyword.find({ is_active: true }).lean();
    if (!keywords || keywords.length === 0) return [];

    const matched = [];
    const matchedKeywordIds = new Set();

    for (const kw of keywords) {
      if (matchedKeywordIds.has(kw.id)) continue;

      const keyword = String(kw.keyword).trim();
      // Check for non-Latin scripts
      const isNonLatin = /[ऀ-ॿఀ-౿஀-௿ಀ-೿ഀ-ൿ]/.test(keyword);

      let isMatch = false;

      if (isNonLatin) {
        isMatch = contentText.includes(keyword);
      } else {
        const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
          new RegExp(`\\b${escapedKeyword}\\b`, 'i'),
          new RegExp(`#${escapedKeyword}`, 'i'),
          new RegExp(`@${escapedKeyword}`, 'i')
        ];
        isMatch = patterns.some(p => p.test(contentText));
      }

      if (isMatch) {
        matched.push({
          keyword_id: kw.id,
          keyword: kw.keyword,
          category: kw.category,
          language: kw.language,
          weight: kw.weight
        });
        matchedKeywordIds.add(kw.id);
      }
    }

    return matched;
  } catch (error) {
    console.error('Keyword matching error:', error.message);
    return [];
  }
};

async function backfillMatchedKeywords() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/blura_hub');
    console.log('✓ Connected to MongoDB');

    // Find all alerts with empty matched_keywords
    const alertsNeedingUpdate = await Alert.find({
      $or: [
        { matched_keywords: null },
        { matched_keywords: { $exists: false } },
        { matched_keywords: { $size: 0 } }
      ]
    }).select('id description title content_id').lean();

    console.log(`Found ${alertsNeedingUpdate.length} alerts needing matched_keywords backfill`);

    if (alertsNeedingUpdate.length === 0) {
      console.log('✓ All alerts already have matched_keywords set');
      await mongoose.disconnect();
      return;
    }

    let updatedCount = 0;
    let errorCount = 0;

    // Process alerts
    for (const alert of alertsNeedingUpdate) {
      try {
        // Get content text
        const contentText = alert.description || alert.title || '';

        // Match keywords
        const matchedKeywords = await matchConfiguredKeywords(contentText);

        // Update alert
        await Alert.updateOne(
          { id: alert.id },
          { $set: { matched_keywords: matchedKeywords } }
        );

        updatedCount++;
        if (updatedCount % 100 === 0) {
          console.log(`  Processed ${updatedCount}/${alertsNeedingUpdate.length}...`);
        }
      } catch (err) {
        errorCount++;
        console.error(`Failed to update alert ${alert.id}:`, err.message);
      }
    }

    console.log(`\n✓ Successfully backfilled ${updatedCount} alerts`);
    if (errorCount > 0) {
      console.log(`⚠ Errors: ${errorCount} alerts failed`);
    }

    // Show statistics
    const withKeywords = await Alert.countDocuments({ matched_keywords: { $exists: true, $ne: [] } });
    const total = await Alert.countDocuments();
    console.log(`\nStatistics:`);
    console.log(`  Total alerts: ${total}`);
    console.log(`  With matched_keywords: ${withKeywords}`);
    console.log(`  Without matched_keywords: ${total - withKeywords}`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  }
}

backfillMatchedKeywords();
