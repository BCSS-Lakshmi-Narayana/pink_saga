#!/usr/bin/env node
/**
 * One-shot fetch of tagged posts for every active GrievanceSource profile
 * (the CM, ministers, opposition leaders, etc.). Pulls from X / Facebook / Instagram via
 * the same pipeline the dashboard's "Fetch All" button uses, runs each post
 * through analysis, and writes results into the Grievance collection.
 *
 *   node backend/scripts/fetch_profile_grievances_now.js
 *   node backend/scripts/fetch_profile_grievances_now.js 2025-01-01 2025-12-31
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const GrievanceSource = require('../src/models/GrievanceSource');
const { fetchAllGrievances } = require('../src/services/grievanceService');

const startDate = process.argv[2] || null;
const endDate = process.argv[3] || null;

async function main() {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║  PROFILE FETCH · ALL ACTIVE GRIEVANCE SOURCES            ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    if (startDate || endDate) {
        console.log(`Date window: ${startDate || '(none)'} → ${endDate || '(none)'}`);
    }

    await connectDB();

    const sources = await GrievanceSource.find({ is_active: true })
        .select('handle platform display_name department')
        .lean();

    console.log(`\nActive profiles (${sources.length}):`);
    for (const s of sources) {
        console.log(`  • [${s.platform}] @${s.handle.replace(/^@/, '')}  — ${s.display_name}`);
    }
    if (sources.length === 0) {
        console.log('\nNo active GrievanceSource profiles found. Add some in the UI first.\n');
        await mongoose.disconnect();
        process.exit(0);
    }

    console.log('\nFetching… (this hits live RapidAPI endpoints — may take a few minutes)\n');
    const t0 = Date.now();
    const result = await fetchAllGrievances(startDate, endDate);
    const took = ((Date.now() - t0) / 1000).toFixed(1);

    console.log('\n──────── RESULT ────────');
    console.log(`  Profiles processed : ${sources.length}`);
    console.log(`  New grievances     : ${result.newGrievances}`);
    console.log(`  Time               : ${took}s\n`);

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(async (err) => {
    console.error('\n[fetch_profile_grievances_now] failed:', err.message);
    console.error(err.stack);
    try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
    process.exit(1);
});
