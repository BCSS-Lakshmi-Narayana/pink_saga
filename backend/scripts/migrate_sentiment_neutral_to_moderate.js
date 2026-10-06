/**
 * migrate_sentiment_neutral_to_moderate.js
 * ─────────────────────────────────────────────────────────────────────
 * One-shot migration: rename the sentiment label `neutral` → `moderate`
 * on existing Grievance documents (analysis.sentiment, analysis.bsk_sentiment,
 * analysis.generic_sentiment). New ingestion already writes `moderate`;
 * this script normalizes historical rows so the canonical enum is enforced.
 *
 * Note: the political stance enum (`analysis.stance` includes 'neutral' as a
 * stance value) is intentionally NOT touched — that field has its own
 * semantics distinct from the sentiment label.
 *
 * Idempotent: re-running is a no-op once every legacy row is converted.
 *
 *   node backend/scripts/migrate_sentiment_neutral_to_moderate.js
 *   node backend/scripts/migrate_sentiment_neutral_to_moderate.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const Grievance = require('../src/models/Grievance');

const DRY = process.argv.includes('--dry-run');

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('Set MONGODB_URI in backend/.env first.');
    await mongoose.connect(uri);
    console.log(`[migrate] connected. dry-run=${DRY}`);

    const fields = ['analysis.sentiment', 'analysis.bsk_sentiment', 'analysis.generic_sentiment'];
    const summary = {};
    for (const f of fields) {
        const count = await Grievance.countDocuments({ [f]: 'neutral' });
        summary[f] = { before: count, updated: 0 };
        if (!DRY && count > 0) {
            const res = await Grievance.updateMany({ [f]: 'neutral' }, { $set: { [f]: 'moderate' } });
            summary[f].updated = res.modifiedCount;
        }
    }
    console.log('[migrate] result:', JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
    console.log('[migrate] done.');
}

main().catch((err) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
});
