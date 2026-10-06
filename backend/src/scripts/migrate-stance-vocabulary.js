#!/usr/bin/env node
/**
 * Migrate the retired `*_bsk` stance vocabulary onto the current `*_target` one.
 *
 *   node src/scripts/migrate-stance-vocabulary.js --dry-run
 *   node src/scripts/migrate-stance-vocabulary.js
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT AN LLM RE-RUN
 * ────────────────────────────────────────────────
 * The whole historical corpus was analysed under the earlier field names:
 *
 *     analysis.stance          pro_bsk | anti_bsk | pro_bsk_indirect | anti_bsk_indirect
 *     analysis.bsk_sentiment   positive | negative | moderate
 *     analysis.beneficiary     bsk | bjp | opposition | none
 *
 * while everything downstream now reads `analysis.political_stance`,
 * `analysis.target_sentiment` and the `ours` beneficiary.
 *
 * AI Campaigns filters on `analysis.political_stance ∈ {pro_target,
 * anti_target, pro_target_indirect, anti_target_indirect}`. On an unmigrated
 * corpus that matches ZERO documents, so Generate returns nothing at all —
 * not an error, just an empty page.
 *
 * This is a pure RENAME of values the pipeline already decided. It makes NO new
 * judgement, calls no model, and costs nothing. It is NOT a substitute for
 * re-analysis: the verdicts it carries forward were produced by the old logic,
 * which had the defects fixed in docs/SENTIMENT_ANALYSIS.md §5. Re-running the
 * analysis will improve them. This just stops the corpus being invisible in the
 * meantime.
 *
 * The legacy fields are left in place, not deleted — they are the audit trail
 * for what the old pipeline said, and a re-analysis overwrites the new fields
 * anyway.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Grievance = require('../models/Grievance');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

/**
 * ALLY vs OPPOSITION, in the AP alignment.
 *
 * `bsk` was the legacy key for N. Chandrababu Naidu and `bjp` for the NDA
 * machinery — in Andhra Pradesh the BJP is a coalition partner IN GOVERNMENT,
 * so both are the client's own side and both become `ours`. (In the Telangana
 * deployment this same value means the opposite; never copy this mapping.)
 */
const STANCE_MAP = {
    pro_bsk: 'pro_target',
    anti_bsk: 'anti_target',
    pro_bsk_indirect: 'pro_target_indirect',
    anti_bsk_indirect: 'anti_target_indirect',
    neutral: 'neutral',
    unrelated: 'unrelated',
};

const BENEFICIARY_MAP = {
    bsk: 'ours',
    bjp: 'ours',
    opposition: 'opposition',
    none: 'none',
};

const main = async () => {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
        dbName: process.env.DB_NAME || undefined,
    });

    console.log(`\n[migrate-stance] mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'PERSIST'}\n`);

    const total = await Grievance.countDocuments({});
    console.log(`[migrate-stance] ${total} grievance(s) on file\n`);

    // ── 1. stance → political_stance ──
    console.log('── analysis.stance → analysis.political_stance ──');
    let stanceTotal = 0;
    for (const [from, to] of Object.entries(STANCE_MAP)) {
        // Only touch documents that do not already carry the new value, so a
        // re-run after a partial pass is a no-op rather than a rewrite.
        const filter = { 'analysis.stance': from, 'analysis.political_stance': { $in: [null, ''] } };
        const n = await Grievance.countDocuments(filter);
        stanceTotal += n;
        console.log(`   ${String(from).padEnd(20)} → ${String(to).padEnd(22)} ${n}`);
        if (!DRY_RUN && n) {
            await Grievance.updateMany(filter, { $set: { 'analysis.political_stance': to } });
        }
    }

    // ── 2. bsk_sentiment → target_sentiment ──
    // Same value, new name. `analysis.sentiment` already holds the
    // client-relative verdict on this deployment and is left untouched.
    console.log('\n── analysis.bsk_sentiment → analysis.target_sentiment ──');
    const sentFilter = {
        'analysis.bsk_sentiment': { $nin: [null, ''] },
        'analysis.target_sentiment': { $in: [null, ''] },
    };
    const sentCount = await Grievance.countDocuments(sentFilter);
    console.log(`   copying value verbatim                     ${sentCount}`);
    if (!DRY_RUN && sentCount) {
        // A field-to-field copy needs an aggregation-pipeline update.
        await Grievance.updateMany(sentFilter, [
            { $set: { 'analysis.target_sentiment': '$analysis.bsk_sentiment' } },
        ]);
    }

    // ── 3. beneficiary bsk|bjp → ours ──
    console.log('\n── analysis.beneficiary → current vocabulary ──');
    let benTotal = 0;
    for (const [from, to] of Object.entries(BENEFICIARY_MAP)) {
        if (from === to) continue; // opposition / none are already correct
        const filter = { 'analysis.beneficiary': from };
        const n = await Grievance.countDocuments(filter);
        benTotal += n;
        console.log(`   ${String(from).padEnd(20)} → ${String(to).padEnd(22)} ${n}`);
        if (!DRY_RUN && n) {
            await Grievance.updateMany(filter, { $set: { 'analysis.beneficiary': to } });
        }
    }

    // ── 4. What this unlocks ──
    const CAMPAIGNABLE = ['pro_target', 'anti_target', 'pro_target_indirect', 'anti_target_indirect'];
    const campaignable = DRY_RUN
        ? await Grievance.countDocuments({ 'analysis.stance': { $in: Object.keys(STANCE_MAP).filter((k) => CAMPAIGNABLE.includes(STANCE_MAP[k])) } })
        : await Grievance.countDocuments({ 'analysis.political_stance': { $in: CAMPAIGNABLE } });

    console.log('\n─── summary ─────────────────────────────────');
    console.log(`  stance values mapped     : ${stanceTotal}`);
    console.log(`  target_sentiment copied  : ${sentCount}`);
    console.log(`  beneficiary values mapped: ${benTotal}`);
    console.log(`  campaignable posts       : ${campaignable}  ← what AI Campaigns can now see`);
    console.log(`  writes                   : ${DRY_RUN ? 'NONE (dry run)' : 'persisted'}`);
    console.log('─────────────────────────────────────────────');
    console.log('\nNEXT: analysis.topic is still empty, so campaign topics will group on the');
    console.log('coarse grievance_type until you run scripts/backfill-grievance-topics.js.\n');

    await mongoose.connection.close();
};

main().catch(async (err) => {
    console.error('[migrate-stance] fatal:', err);
    try { await mongoose.connection.close(); } catch (e) { /* already closed */ }
    process.exit(1);
});
