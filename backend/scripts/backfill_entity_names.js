/**
 * backfill_entity_names.js
 * ─────────────────────────────────────────────────────────────────────
 * Re-canonicalizes `target_entity` (and its mirrors) on grievances and
 * alerts already written with the raw roster KEY instead of the display
 * name — "ktr" instead of "K. T. Rama Rao", "kcr" instead of
 * "K. Chandrashekar Rao", a bare @handle, etc.
 *
 * Root cause (now fixed going forward in stanceEngine.js /
 * politicalSentimentService.js): several `.canonical || .text` /
 * `.canonical || .key` fallback chains used the raw matched text whenever
 * the resolver's `.canonical` field happened to be unset. This script only
 * repairs the ALREADY-STORED display name — it does not touch stance,
 * sentiment, or re-run any LLM call, so it is cheap, offline, and safe to
 * re-run.
 *
 * Detection is false-positive-proof: `resolveEntityKey(storedValue)` only
 * ever matches a literal registered roster KEY, never a display name (a
 * canonical value like "K. T. Rama Rao" never resolves to anything), so a
 * record is only touched when its stored string IS a raw key with a
 * DIFFERENT canonical name on file.
 *
 *   node scripts/backfill_entity_names.js --dry-run   # report only
 *   node scripts/backfill_entity_names.js             # write
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { POLITICAL_ENTITIES, resolveEntityKey } = require('../src/config/politicalEntities');

const DRY = process.argv.includes('--dry-run');

const correctedCanonical = (stored) => {
    if (!stored || typeof stored !== 'string') return null;
    const key = resolveEntityKey(stored);
    if (!key) return null;
    const ent = POLITICAL_ENTITIES[key];
    if (!ent || !ent.canonical || ent.canonical === stored) return null;
    return ent.canonical;
};

const fixCollection = async (coll, label, fields) => {
    const projection = { _id: 1 };
    for (const f of fields) projection[f] = 1;

    const cursor = coll.find({}).project(projection);
    let scanned = 0, changed = 0;
    const examples = [];

    for await (const doc of cursor) {
        scanned += 1;
        const set = {};
        for (const f of fields) {
            const path = f.split('.');
            let val = doc;
            for (const p of path) val = val && val[p];
            const fixed = correctedCanonical(val);
            if (fixed) set[f] = fixed;
        }
        if (Object.keys(set).length === 0) continue;
        changed += 1;
        if (examples.length < 10) examples.push({ id: String(doc._id), from: fields.map((f) => f.split('.').reduce((o, p) => o && o[p], doc)), to: set });
        if (!DRY) await coll.updateOne({ _id: doc._id }, { $set: set });
    }

    console.log(`\n[${label}] dry-run=${DRY} scanned=${scanned} changed=${changed}`);
    examples.forEach((e) => console.log('  ', JSON.stringify(e)));
};

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, process.env.DB_NAME ? { dbName: String(process.env.DB_NAME).trim() } : undefined);
    const db = mongoose.connection.db;

    await fixCollection(db.collection('grievances'), 'grievances', [
        'analysis.target_entity',
        'analysis.target_entity_canonical',
        'analysis.llm_analysis.target_entity',
    ]);
    await fixCollection(db.collection('alerts'), 'alerts', [
        'llm_analysis.target_entity',
    ]);

    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error('[backfill_entity_names] failed:', e); process.exit(1); });
