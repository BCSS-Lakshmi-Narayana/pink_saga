/**
 * Repairs text that was stored after being decoded with the wrong charset
 * (UTF-8 read as Latin-1) — e.g. Telugu showing as "à°¤à°²à°ªà±".
 *
 * New writes are already protected by the mojibake guard on the models; this
 * is for rows written before that existed.
 *
 *   node scripts/repair_mojibake.js --dry-run     # report only (DO THIS FIRST)
 *   node scripts/repair_mojibake.js               # apply
 *   node scripts/repair_mojibake.js --only=alerts # one collection
 *
 * Safe to re-run: the repair is idempotent and only touches strings carrying
 * the unambiguous mojibake signature.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const { repairDeep, MOJIBAKE_SIGNATURE } = require('../src/utils/textEncoding');

const DRY = process.argv.includes('--dry-run');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];

const COLLECTIONS = ['contents', 'grievances', 'alerts', 'newsarticles', 'telegrammessages', 'comments', 'livechatmessages'];

/** Deep-compare to find which paths actually changed, for the report. */
const changedPaths = (before, after, path = '', out = []) => {
    if (typeof before === 'string') {
        if (before !== after) out.push({ path, before, after });
        return out;
    }
    if (!before || typeof before !== 'object' || before instanceof Date) return out;
    for (const k of Object.keys(before)) {
        changedPaths(before[k], after?.[k], path ? `${path}.${k}` : k, out);
    }
    return out;
};

(async () => {
    await connectDB();
    console.log(`Repairing mojibake${DRY ? ' (DRY RUN — nothing will be written)' : ''}\n`);

    const db = mongoose.connection.db;
    const targets = only ? [only] : COLLECTIONS;
    let grandTotal = 0;

    for (const name of targets) {
        let col;
        try {
            col = db.collection(name);
            await col.countDocuments({}, { limit: 1 });
        } catch (_) {
            continue;
        }

        // Scan everything; the signature test below is what decides. Cheap,
        // because it's a single regex over the serialised doc.
        const cursor = col.find({}).batchSize(200);
        let scanned = 0;
        let fixed = 0;
        const samples = [];
        const ops = [];

        for await (const doc of cursor) {
            scanned++;
            const raw = JSON.stringify(doc);
            if (!MOJIBAKE_SIGNATURE.test(raw)) continue;

            const before = JSON.parse(JSON.stringify(doc));
            const after = repairDeep(JSON.parse(JSON.stringify(doc)));
            const diffs = changedPaths(before, after);
            if (!diffs.length) continue;

            fixed++;
            if (samples.length < 3) samples.push(diffs[0]);

            const $set = {};
            for (const d of diffs) $set[d.path] = d.after;
            ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set } } });

            if (!DRY && ops.length >= 500) {
                await col.bulkWrite(ops.splice(0), { ordered: false });
            }
        }

        if (!DRY && ops.length) await col.bulkWrite(ops, { ordered: false });

        grandTotal += fixed;
        console.log(`${name.padEnd(18)} scanned=${String(scanned).padEnd(8)} repaired=${fixed}`);
        for (const s of samples) {
            console.log(`   ${s.path}`);
            console.log(`     before: ${String(s.before).slice(0, 60)}`);
            console.log(`     after : ${String(s.after).slice(0, 60)}`);
        }
    }

    console.log(`\n${grandTotal} document(s) ${DRY ? 'would be' : ''} repaired.`);
    if (DRY && grandTotal) console.log('Re-run without --dry-run to apply.');

    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
