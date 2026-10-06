#!/usr/bin/env node
/**
 * backfill_alert_analysis.js
 * ─────────────────────────────────────────────────────────────────────
 * Repairs alerts that were saved without their analysis (no stance, no
 * target sentiment, no reasoning). A bug in monitorService.performFullAnalysis
 * discarded the finished analysis for ordinary posts on the source-scan path;
 * this script puts it back:
 *
 *   1. If an Analysis record for the post already has the LLM verdict, copy
 *      it onto the alert (no LLM call).
 *   2. Otherwise re-run the full pipeline for the post (performFullAnalysis
 *      with skipAlert, the same path new posts now take) and copy the result.
 *
 * Reads DB_NAME from .env. Safe to re-run: alerts that already carry
 * llm_analysis are skipped.
 *
 *   node scripts/backfill_alert_analysis.js --dry-run     count only
 *   node scripts/backfill_alert_analysis.js               repair all
 *   node scripts/backfill_alert_analysis.js --limit 20    repair 20
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Alert = require('../src/models/Alert');
const Analysis = require('../src/models/Analysis');
const Content = require('../src/models/Content');
const Settings = require('../src/models/Settings');
const Keyword = require('../src/models/Keyword');
const { performFullAnalysis } = require('../src/services/monitorService');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const limitArg = argv.indexOf('--limit');
const limit = limitArg !== -1 ? Number(argv[limitArg + 1]) : 0;

const RISK = { low: 'low', medium: 'medium', high: 'high', critical: 'critical' };

const alertFieldsFrom = (result) => ({
    llm_analysis: result.llm_analysis || null,
    analysis_id: result.analysis_id || result.id || null,
    classification_explanation: result.explanation || '',
    campaign_topic: result.topic || null,
    'threat_details.intent': result.intent || 'Monitor',
    'threat_details.reasons': result.reasons || [],
    'threat_details.risk_score': Number(result.risk_score) || 0,
    ...(result.detailedDescription ? { description: result.detailedDescription } : {}),
    ...(RISK[String(result.content_risk_level || result.risk_level || '').toLowerCase()]
        ? { risk_level: RISK[String(result.content_risk_level || result.risk_level).toLowerCase()] }
        : {}),
});

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}${dryRun ? '   (DRY-RUN)' : ''}`);

    // Relevance-gate stamps written by the keyword fallback (LLM unreachable),
    // or "promoted" stamps that never produced a mention, are cleared so the
    // alerts→mentions scheduler re-evaluates them with the real LLM gate.
    const staleGate = { $or: [{ 'bsk_pipeline.heuristic': true }, { 'bsk_pipeline.decision': 'promoted', 'bsk_pipeline.grievance_id': null }] };
    const staleCount = await Alert.countDocuments(staleGate);
    console.log(`Alerts with a stale relevance-gate stamp: ${staleCount}`);
    if (!dryRun && staleCount) {
        await Alert.updateMany(staleGate, { $unset: { bsk_pipeline: '' } });
        console.log('  cleared; the alerts→mentions scheduler will re-check them.');
    }

    let q = Alert.find({ $or: [{ llm_analysis: null }, { llm_analysis: { $exists: false } }] }).sort({ created_at: -1 });
    if (limit > 0) q = q.limit(limit);
    const alerts = await q.lean();
    console.log(`Alerts missing analysis: ${alerts.length}`);
    if (dryRun || !alerts.length) { await mongoose.disconnect(); return; }

    const settings = (await Settings.findOne({ id: 'global_settings' })) || {};
    const keywords = await Keyword.find({ is_active: true });
    const counts = { attached: 0, reanalysed: 0, noContent: 0, failed: 0 };

    for (const a of alerts) {
        try {
            const existing = await Analysis.findOne({ content_id: a.content_id, llm_analysis: { $ne: null } }).lean();
            if (existing) {
                await Alert.updateOne({ _id: a._id }, { $set: alertFieldsFrom({ ...existing, analysis_id: existing.id }) });
                counts.attached += 1;
                continue;
            }
            const content = await Content.findOne({ id: a.content_id });
            if (!content) { counts.noContent += 1; continue; }
            const result = await performFullAnalysis(content, settings, keywords, { skipAlert: true });
            if (!result || !result.llm_analysis) { counts.failed += 1; continue; }
            await Alert.updateOne({ _id: a._id }, { $set: alertFieldsFrom(result) });
            counts.reanalysed += 1;
            const la = result.llm_analysis;
            console.log(`  ✓ @${a.author_handle || a.author}: tone=${la.generic_sentiment} stance=${la.political_stance} for-client=${la.target_sentiment}`);
        } catch (err) {
            counts.failed += 1;
            console.warn(`  ✗ ${a.id}: ${err.message}`);
        }
    }

    console.log(`\nAttached existing: ${counts.attached}   re-analysed: ${counts.reanalysed}   content missing: ${counts.noContent}   failed: ${counts.failed}`);
    await mongoose.disconnect();
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
