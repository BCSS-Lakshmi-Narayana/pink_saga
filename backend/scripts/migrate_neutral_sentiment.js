/**
 * migrate_neutral_sentiment.js
 * ─────────────────────────────────────────────────────────────────────
 * One-shot data migration: the middle sentiment band is 'neutral' again
 * (content with no positive or negative substance), and it carries NO risk.
 *
 *   1. Every stored 'moderate' sentiment/tone value → 'neutral'. Paths are
 *      discovered by scanning each collection, not hard-coded, so nested
 *      copies (llm_analysis.*, pipeline_analysis.*) are caught too.
 *   2. Risk that was derived from that sentiment (medium / 50) → low / 20,
 *      only where the record's raw tone is now neutral.
 *   3. Live-stream counters `sentiment_counts.moderate` → `.neutral`.
 *
 *   node scripts/migrate_neutral_sentiment.js --dry-run
 *   node scripts/migrate_neutral_sentiment.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry-run');
const COLLECTIONS = ['grievances', 'alerts', 'analyses', 'contents', 'newsarticles', 'livechatmessages'];
// Only fields that hold a sentiment / tone verdict are converted.
const TONE_FIELD_RX = /(^|\.)(sentiment|target_sentiment|bsk_sentiment|generic_sentiment|target_tone|tone|client_sentiment|sentiment_label)$|(^|\.)validation\.sentiment\.\w+$/;

const discoverPaths = async (coll) => {
    const counts = new Map();
    const walk = (obj, prefix, depth) => {
        if (!obj || typeof obj !== 'object' || depth > 5) return;
        for (const [k, v] of Object.entries(obj)) {
            const path = prefix ? `${prefix}.${k}` : k;
            if (v === 'moderate' && TONE_FIELD_RX.test(path)) counts.set(path, (counts.get(path) || 0) + 1);
            else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof mongoose.Types.ObjectId)) walk(v, path, depth + 1);
        }
    };
    const cursor = coll.find({}, { batchSize: 500 });
    for await (const doc of cursor) walk(doc, '', 0);
    return counts;
};

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, process.env.DB_NAME ? { dbName: String(process.env.DB_NAME).trim() } : undefined);
    const db = mongoose.connection.db;
    console.log(`[neutral] db=${db.databaseName} dry-run=${DRY}`);

    // 1. moderate → neutral
    for (const name of COLLECTIONS) {
        const coll = db.collection(name);
        const paths = await discoverPaths(coll);
        if (!paths.size) { console.log(`  ${name}: nothing to convert`); continue; }
        for (const [path, n] of paths) {
            if (DRY) { console.log(`  ${name}.${path}: ${n}`); continue; }
            const r = await coll.updateMany({ [path]: 'moderate' }, { $set: { [path]: 'neutral' } });
            console.log(`  ${name}.${path}: ${r.modifiedCount} converted`);
        }
    }

    // 2. risk follows the neutral tone: medium/50 → low/20
    const riskFixes = [
        {
            coll: 'grievances',
            match: {
                $or: [{ 'analysis.generic_sentiment': { $in: ['neutral', 'moderate'] } },
                    { 'analysis.generic_sentiment': { $exists: false }, 'analysis.sentiment': { $in: ['neutral', 'moderate'] } }],
                'analysis.risk_level': 'medium', 'analysis.risk_score': 50,
            },
            set: { 'analysis.risk_level': 'low', 'analysis.risk_score': 20 },
            extra: [{ match: { 'analysis.llm_analysis.score': 50 }, set: { 'analysis.llm_analysis.score': 20 } }],
        },
        {
            coll: 'alerts',
            match: {
                $or: [{ 'llm_analysis.generic_sentiment': { $in: ['neutral', 'moderate'] } },
                    { 'llm_analysis.generic_sentiment': { $exists: false }, 'llm_analysis.sentiment': { $in: ['neutral', 'moderate'] } }],
                risk_level: 'medium',
            },
            set: { risk_level: 'low', 'threat_details.risk_score': 20 },
            extra: [{ match: { 'llm_analysis.score': 50 }, set: { 'llm_analysis.score': 20 } }],
        },
        {
            coll: 'analyses',
            match: { sentiment: { $in: ['neutral', 'moderate'] }, risk_level: 'medium', risk_score: 50 },
            set: { risk_level: 'low', risk_score: 20 },
        },
        {
            coll: 'newsarticles',
            match: { sentiment: { $in: ['neutral', 'moderate'] }, risk_level: 'medium', risk_score: 50 },
            set: { risk_level: 'low', risk_score: 20 },
        },
    ];
    for (const f of riskFixes) {
        const coll = db.collection(f.coll);
        const ids = (await coll.find(f.match).project({ _id: 1 }).toArray()).map((d) => d._id);
        if (DRY) { console.log(`  risk ${f.coll}: ${ids.length} medium → low`); continue; }
        if (!ids.length) { console.log(`  risk ${f.coll}: 0`); continue; }
        const r = await coll.updateMany({ _id: { $in: ids } }, { $set: f.set });
        for (const x of f.extra || []) await coll.updateMany({ _id: { $in: ids }, ...x.match }, { $set: x.set });
        console.log(`  risk ${f.coll}: ${r.modifiedCount} medium → low`);
    }

    // 3. live-stream counters
    const streams = db.collection('livestreams');
    const withModerate = await streams.find({ 'sentiment_counts.moderate': { $exists: true } }).project({ sentiment_counts: 1 }).toArray();
    if (DRY) console.log(`  livestreams: ${withModerate.length} counters to rename`);
    else {
        for (const s of withModerate) {
            const c = s.sentiment_counts || {};
            await streams.updateOne({ _id: s._id }, {
                $set: { 'sentiment_counts.neutral': (c.neutral || 0) + (c.moderate || 0) },
                $unset: { 'sentiment_counts.moderate': '' },
            });
        }
        console.log(`  livestreams: ${withModerate.length} counters renamed`);
    }

    console.log('[neutral] done');
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error('[neutral] failed:', e); process.exit(1); });
