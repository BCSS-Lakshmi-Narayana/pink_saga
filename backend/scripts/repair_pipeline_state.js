#!/usr/bin/env node
/**
 * repair_pipeline_state.js
 * ─────────────────────────────────────────────────────────────────────
 * One-time repair for records written before the complete-or-pending
 * pipeline. Deletes nothing.
 *
 *   1. Alerts whose analysis never completed — no stance of their own (the
 *      "Routine content analysis complete." placeholders) or a stance that
 *      came from the keyword fallback — get their post marked
 *      `analysis_status: 'pending'`. The retry job (index.js) re-analyses it
 *      and re-syncs the EXISTING alert in one write once it completes.
 *   2. Alerts with a real stance whose risk drifted from the sentiment (the
 *      viral boost used to overwrite it) get risk recomputed from sentiment.
 *   3. Mentions whose stance came from the keyword fallback are marked
 *      pending the same way.
 *   4. Content with a complete alert but no status is stamped 'complete'.
 *
 * Alerts / mentions edited by hand (llm_analysis.manual_override) are skipped.
 *
 *   node scripts/repair_pipeline_state.js --dry-run
 *   node scripts/repair_pipeline_state.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry-run');
const RISK = { positive: ['low', 15], moderate: ['medium', 50], negative: ['high', 75] };

const isFallback = (la) => !!(la && (
    la.political_provider === 'fallback'
    || (la.validation && Array.isArray(la.validation.reasons) && la.validation.reasons.includes('llm_fallback'))
));
const hasRealStance = (la) => !!(la && la.political_stance && !isFallback(la));

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
    const db = mongoose.connection.db;
    const alertsCol = db.collection('alerts');
    const contentsCol = db.collection('contents');
    const grievancesCol = db.collection('grievances');
    const stats = { alerts: 0, requeued: 0, riskResynced: 0, manualSkipped: 0, alreadyOk: 0, contentStampedComplete: 0, mentionsRequeued: 0 };
    const requeue = new Set();

    const alerts = await alertsCol.find({ event_id: null }).toArray();
    stats.alerts = alerts.length;
    for (const a of alerts) {
        const la = a.llm_analysis || {};
        if (la.manual_override) { stats.manualSkipped++; continue; }
        if (!hasRealStance(la)) {
            if (a.content_id) requeue.add(a.content_id);
            continue;
        }
        const sentiment = la.generic_sentiment || la.sentiment;
        const [level, score] = RISK[sentiment] || [];
        if (level && (a.risk_level !== level || (a.threat_details && a.threat_details.risk_score) !== score)) {
            stats.riskResynced++;
            if (!DRY) {
                await alertsCol.updateOne({ _id: a._id }, { $set: { risk_level: level, 'threat_details.risk_score': score } });
            }
        } else {
            stats.alreadyOk++;
        }
        if (a.content_id && !DRY) {
            const r = await contentsCol.updateOne(
                { id: a.content_id, analysis_status: { $exists: false } },
                { $set: { analysis_status: 'complete' } }
            );
            stats.contentStampedComplete += r.modifiedCount;
        }
    }

    stats.requeued = requeue.size;
    if (!DRY && requeue.size) {
        await contentsCol.updateMany(
            { id: { $in: [...requeue] } },
            { $set: { analysis_status: 'pending', analysis_attempts: 0, analysis_error: 'repair: analysis never completed', analysis_last_attempt_at: new Date(0) } }
        );
    }

    const fallbackMentions = await grievancesCol.find({
        'analysis.llm_analysis.manual_override': { $ne: true },
        $or: [
            { 'analysis.llm_analysis.political_provider': 'fallback' },
            { 'analysis.llm_analysis.validation.reasons': 'llm_fallback' },
        ],
    }).project({ id: 1 }).toArray();
    stats.mentionsRequeued = fallbackMentions.length;
    if (!DRY && fallbackMentions.length) {
        await grievancesCol.updateMany(
            { id: { $in: fallbackMentions.map((g) => g.id) } },
            { $set: { analysis_status: 'pending', analysis_attempts: 0, analysis_error: 'repair: stance came from fallback', analysis_last_attempt_at: new Date(0) } }
        );
    }

    console.log(`${DRY ? '[DRY RUN] ' : ''}${process.env.DB_NAME}:`, JSON.stringify(stats));
    if (!DRY && (stats.requeued || stats.mentionsRequeued)) {
        console.log('Requeued records are re-analysed by the retry job (index.js) within ~5 minutes of the backend running.');
    }
    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
