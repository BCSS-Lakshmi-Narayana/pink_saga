/**
 * backfill_standard_emoji_text.js
 *
 * One-time historical repair for `LiveChatMessage.text` rows written before
 * the InnerTube parser fix (youtubeLiveChatReader.js), which stored a
 * standard Unicode emoji's ":shortcode:" alias instead of the character
 * itself — e.g. "jai BJP :smiling_face_with_hearts:" instead of
 * "jai BJP 🥰".
 *
 * Deliberately NOT a hand-typed dictionary. The shortcode table is built at
 * run time from two independent, actively-maintained emoji datasets —
 * `emoji-datasource` (iamcal/Slack's short_name + short_names aliases, and
 * the official Unicode character name) and `unicode-emoji-json` (CLDR
 * annotation `slug`) — merged together. A single external dataset was tried
 * first and found insufficient: neither one alone covers both
 * ":smiling_face_with_hearts:" and ":pouting_face:" (two shortcodes actually
 * seen in production data), but the merge of both does. See buildShortcodeTable().
 *
 * SAFETY
 *   - Dry run by default. Nothing is written unless --execute is passed.
 *   - Touches ONLY `text`, via a narrow $set — never `display_parts`,
 *     sentiment/tone/stance/political_relevance/matched_entities/risk_level,
 *     message_id, published_at, created_at, author/stream/video ids.
 *   - A ":name:" token is replaced ONLY when `name` maps to exactly ONE
 *     emoji character across both datasets. Any shortcode that is unknown
 *     (this is how every custom/channel emoji — ":face-purple-wide-eyes:"
 *     etc. — is left untouched, with no special-casing needed) or genuinely
 *     ambiguous (e.g. "cat" -> both 🐈 and 🐱) is left exactly as-is rather
 *     than guessed.
 *   - Before any real write, the FULL original document for every row about
 *     to change is saved to a timestamped JSON backup file.
 *   - --revert=<backup file> restores exactly those documents' `text` field
 *     from that backup, undoing a previous --execute run.
 *
 * USAGE
 *   node scripts/backfill_standard_emoji_text.js                  # dry run (default)
 *   node scripts/backfill_standard_emoji_text.js --sample=30      # show more before/after examples
 *   node scripts/backfill_standard_emoji_text.js --execute        # write for real, AFTER reviewing a dry run
 *   node scripts/backfill_standard_emoji_text.js --revert=<file>  # undo a previous --execute run
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const LiveChatMessage = require('../src/models/LiveChatMessage');
const emojiDatasource = require('emoji-datasource');
const unicodeEmojiJson = require('unicode-emoji-json');

const EXECUTE = process.argv.includes('--execute');
const REVERT_FILE = (process.argv.find((a) => a.startsWith('--revert=')) || '').split('=')[1] || null;
const SAMPLE_SIZE = Number((process.argv.find((a) => a.startsWith('--sample=')) || '').split('=')[1]) || 12;

const BACKUP_DIR = path.join(__dirname, '_backups');

/* ═══════════════════════ shortcode table (multi-source, traceable) ═══════════════════════ */

const slugify = (s) => String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const codepointsToChar = (unified) => unified.split('-').map((h) => String.fromCodePoint(parseInt(h, 16))).join('');

function buildShortcodeTable() {
    // key -> Set<char>. A key surviving with more than one distinct char is
    // ambiguous and gets dropped below — never guessed.
    const candidates = new Map();
    const add = (key, char) => {
        if (!key || !char) return;
        if (!candidates.has(key)) candidates.set(key, new Set());
        candidates.get(key).add(char);
    };

    for (const e of emojiDatasource) {
        // Skip ZWJ / modifier-sequence composites (multi-codepoint "unified"
        // values contain a hyphen between codepoints) — YouTube's own
        // shortcodes for these compound emoji are unpredictable, and the
        // ambiguity risk isn't worth it for a handful of family/skin-tone emoji.
        if (e.unified.includes('-')) continue;
        const char = codepointsToChar(e.unified);
        add(e.short_name, char);
        (e.short_names || []).forEach((n) => add(n, char));
        add(slugify(e.name), char); // official Unicode character name, e.g. "POUTING FACE"
    }
    for (const [char, meta] of Object.entries(unicodeEmojiJson)) {
        add(meta.slug, char);       // CLDR annotation slug, e.g. "smiling_face_with_hearts"
        add(slugify(meta.name), char);
    }

    const table = new Map();
    let dropped = 0;
    for (const [key, chars] of candidates) {
        if (chars.size === 1) table.set(key, [...chars][0]);
        else dropped++;
    }
    return { table, totalKeys: candidates.size, ambiguousDropped: dropped };
}

const { table: SHORTCODE_TABLE, totalKeys, ambiguousDropped } = buildShortcodeTable();

/* ═══════════════════════ replacement (never guesses) ═══════════════════════ */

const TOKEN_RE = /:([a-z0-9_+-]+):/gi;

/**
 * Replace only ":name:" tokens present in SHORTCODE_TABLE. Everything else —
 * unknown/custom emoji shortcodes, already-real Unicode emoji, Telugu/English
 * text, repeated/adjacent tokens — passes through byte-for-byte unchanged.
 */
function backfillText(text) {
    let knownHits = 0;
    let unknownHits = 0;
    const next = String(text).replace(TOKEN_RE, (whole, name) => {
        const char = SHORTCODE_TABLE.get(name.toLowerCase());
        if (char) { knownHits++; return char; }
        unknownHits++;
        return whole;
    });
    return { changed: knownHits > 0, next, knownHits, unknownHits };
}

/* ═══════════════════════ scan / report / (optionally) write ═══════════════════════ */

const fmtDoc = (d) => ({
    _id: String(d._id),
    message_id: d.message_id,
    stream_id: d.stream_id,
    author_name: d.author_name,
    created_at: d.created_at,
});

async function scan() {
    // Coarse Mongo-side pre-filter (any ":word:"-shaped substring); the
    // authoritative decision is made by backfillText() below, so dry-run
    // and --execute always see identical logic.
    const candidates = await LiveChatMessage.find(
        { text: { $regex: ':[a-z0-9_+-]+:', $options: 'i' } }
    ).lean();

    const toChange = [];
    let totalKnownReplacements = 0;
    let totalUnknownLeftAlone = 0;
    let docsWithUnknownOnly = 0;

    for (const doc of candidates) {
        const { changed, next, knownHits, unknownHits } = backfillText(doc.text);
        totalUnknownLeftAlone += unknownHits;
        if (changed) {
            totalKnownReplacements += knownHits;
            toChange.push({ doc, next, knownHits, unknownHits });
        } else if (unknownHits > 0) {
            docsWithUnknownOnly++;
        }
    }

    return { candidates, toChange, totalKnownReplacements, totalUnknownLeftAlone, docsWithUnknownOnly };
}

function printReport({ candidates, toChange, totalKnownReplacements, totalUnknownLeftAlone, docsWithUnknownOnly }) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log(' Standard-emoji shortcode backfill —', EXECUTE ? 'EXECUTE MODE' : 'DRY RUN (no writes)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Shortcode table: ${SHORTCODE_TABLE.size} unambiguous keys ` +
        `(${totalKeys} candidate keys seen across both datasets, ${ambiguousDropped} dropped as ambiguous)`);
    console.log('');
    console.log(`Documents scanned (contain any ":word:"-shaped token): ${candidates.length}`);
    console.log(`Documents that WOULD change:                           ${toChange.length}`);
    console.log(`Total known-shortcode replacements across those docs:  ${totalKnownReplacements}`);
    console.log(`Unknown/custom shortcode occurrences left untouched:   ${totalUnknownLeftAlone}` +
        ` (across ${docsWithUnknownOnly} doc(s) with ONLY unknown shortcodes, plus any mixed-in above)`);

    console.log('\n─── representative before/after examples ───');
    toChange.slice(0, SAMPLE_SIZE).forEach(({ doc, next, knownHits, unknownHits }) => {
        console.log('');
        console.log('  doc:', JSON.stringify(fmtDoc(doc)));
        console.log('  before:', JSON.stringify(doc.text));
        console.log('  after: ', JSON.stringify(next));
        console.log(`  (${knownHits} known replaced, ${unknownHits} unknown left as-is)`);
    });
    if (toChange.length > SAMPLE_SIZE) {
        console.log(`\n  … and ${toChange.length - SAMPLE_SIZE} more (use --sample=N to show more)`);
    }
}

async function writeBackupAndExecute(toChange) {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `standard_emoji_backfill_${stamp}.json`);

    // Full original documents, not just `text` — strictly more useful for
    // reversibility than a text-only snapshot would be.
    fs.writeFileSync(backupFile, JSON.stringify(toChange.map((c) => c.doc), null, 2));
    console.log(`\nBackup written: ${backupFile} (${toChange.length} full original document(s))`);

    const ops = toChange.map(({ doc, next }) => ({
        updateOne: {
            filter: { _id: doc._id },
            // Narrow on purpose: text only. Nothing else on the document is touched.
            update: { $set: { text: next } },
        },
    }));

    const result = await LiveChatMessage.bulkWrite(ops, { ordered: false });
    console.log(`Executed: matched=${result.matchedCount} modified=${result.modifiedCount}`);
    console.log(`To undo: node scripts/backfill_standard_emoji_text.js --revert=${backupFile}`);
}

async function revert(backupFile) {
    const raw = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    console.log(`Reverting ${raw.length} document(s) from ${backupFile} ...`);
    const ops = raw.map((d) => ({
        updateOne: {
            filter: { _id: new mongoose.Types.ObjectId(d._id) },
            update: { $set: { text: d.text } },
        },
    }));
    const result = await LiveChatMessage.bulkWrite(ops, { ordered: false });
    console.log(`Reverted: matched=${result.matchedCount} modified=${result.modifiedCount}`);
}

/* ═══════════════════════ specific requested test cases ═══════════════════════ */

function runNamedTestCases() {
    console.log('\n─── requested test cases (pure function, no DB) ───');
    const cases = [
        {
            input: 'jai BJP :smiling_face_with_hearts::smiling_face_with_hearts:',
            expected: 'jai BJP 🥰🥰',
        },
        {
            input: 'CBN garu :pouting_face::pouting_face::pouting_face::pouting_face: opposition supporter :zipper_mouth_face::zipper_mouth_face::zipper_mouth_face:',
            expected: 'CBN garu 😡😡😡😡 opposition supporter 🤐🤐🤐',
        },
        {
            // unknown/custom shortcode must survive untouched, mixed with a known one
            input: 'nice :face-purple-wide-eyes: work :sleeping_face:',
            expected: 'nice :face-purple-wide-eyes: work 😴',
        },
    ];
    for (const c of cases) {
        const { next } = backfillText(c.input);
        const pass = next === c.expected;
        console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${JSON.stringify(c.input)}`);
        console.log(`         -> ${JSON.stringify(next)}`);
        if (!pass) console.log(`         expected ${JSON.stringify(c.expected)}`);
    }
}

/* ═══════════════════════ entry point ═══════════════════════ */

(async () => {
    runNamedTestCases();

    await connectDB();

    if (REVERT_FILE) {
        await revert(REVERT_FILE);
        await mongoose.disconnect();
        process.exit(0);
    }

    const result = await scan();
    printReport(result);

    if (EXECUTE) {
        if (!result.toChange.length) {
            console.log('\nNothing to do.');
        } else {
            await writeBackupAndExecute(result.toChange);
        }
    } else {
        console.log('\nDRY RUN ONLY — no documents were modified. Re-run with --execute to apply.');
    }

    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
