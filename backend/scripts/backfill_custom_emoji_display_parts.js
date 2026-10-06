/**
 * backfill_custom_emoji_display_parts.js
 *
 * One-time historical repair for `LiveChatMessage` rows written before the
 * custom-emoji fix, whose `text` still holds only a ":shortcut:" placeholder
 * (e.g. ":face-purple-wide-eyes:") with no `display_parts` — so the UI shows
 * the placeholder text instead of the real emoji image.
 *
 * COMPLETELY SEPARATE from backfill_standard_emoji_text.js on purpose — that
 * script fixes standard Unicode emoji by rewriting `text` from a static CLDR
 * table; this one fixes CUSTOM/channel emoji by populating `display_parts`
 * from metadata re-fetched live from YouTube. Different data, different
 * field, different resolution mechanism — kept as two scripts so neither's
 * blast radius or logic is entangled with the other's.
 *
 * HOW RESOLUTION WORKS (no dictionary, nothing hardcoded, nothing guessed)
 *   Custom emoji have no Unicode equivalent and no deterministic shortcut ->
 *   asset mapping — the only source of truth is YouTube itself. A channel's
 *   live_chat page bootstraps with a batch of recent chat actions, and if a
 *   target shortcode happens to be in active use again, its FULL definition
 *   (emojiId, image, accessibility label) comes back fully structured,
 *   exactly as the live parser already reads it. This script re-fetches that
 *   page fresh, for every video_id actually referenced by a pending
 *   document, and only ever uses a shortcut mapping it just observed live. A
 *   shortcut not currently in use anywhere is left completely alone — never
 *   guessed, never fabricated.
 *
 * SAFETY
 *   - Dry run by default. Nothing is written unless --execute is passed.
 *   - Touches ONLY `display_parts`, via a narrow $set — never `text`,
 *     message_id, stream_id, video_id, author fields, timestamps, sentiment/
 *     tone/stance/political_relevance/matched_entities/risk_level, or any
 *     other field.
 *   - A document is updated ONLY if every custom-shortcode occurrence in its
 *     `text` resolves unambiguously. If even one shortcode in a document
 *     can't be resolved right now, that whole document is left untouched —
 *     no partial/best-effort display_parts are ever written.
 *   - A shortcut that resolves to two DIFFERENT (emojiId, image) pairs across
 *     the pages fetched this run is treated as ambiguous and skipped, same
 *     principle as the standard-emoji script's ambiguous-key handling.
 *   - Before any real write, the FULL original document for every row about
 *     to change is saved to a timestamped JSON backup file.
 *   - --revert=<backup file> restores exactly those documents' `display_parts`
 *     field from that backup, undoing a previous --execute run.
 *
 * USAGE
 *   node scripts/backfill_custom_emoji_display_parts.js                  # dry run (default)
 *   node scripts/backfill_custom_emoji_display_parts.js --sample=30      # show more before/after examples
 *   node scripts/backfill_custom_emoji_display_parts.js --execute        # write for real, AFTER reviewing a dry run
 *   node scripts/backfill_custom_emoji_display_parts.js --revert=<file>  # undo a previous --execute run
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const LiveChatMessage = require('../src/models/LiveChatMessage');

const EXECUTE = process.argv.includes('--execute');
const REVERT_FILE = (process.argv.find((a) => a.startsWith('--revert=')) || '').split('=')[1] || null;
const SAMPLE_SIZE = Number((process.argv.find((a) => a.startsWith('--sample=')) || '').split('=')[1]) || 12;

const BACKUP_DIR = path.join(__dirname, '_backups');

/* ═══════════════════════ YouTube fetch (read-only, public pages only) ═══════════════════════ */
/* Mirrors the header/extraction conventions already used by
 * youtubeLiveChatReader.js, kept self-contained here rather than reaching
 * into that module's internals (it exports no such helper today). */

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BASE_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'en-IN,en;q=0.9,te;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Cookie': 'CONSENT=YES+cb; SOCS=CAI',
};
const REQUEST_TIMEOUT_MS = 20000;

const extractInitialData = (html) => {
    const m =
        html.match(/var ytInitialData = (\{.+?\});<\/script>/s) ||
        html.match(/window\["ytInitialData"\]\s*=\s*(\{.+?\});/s);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (_) { return null; }
};

/**
 * Every isCustomEmoji:true definition currently visible in this video's live
 * chat page (its recent-activity batch, not a full history). Defensive
 * against malformed/partial emoji objects on purpose — a stream mid-glitch
 * or a future markup change must degrade to "found nothing usable", never throw.
 */
async function fetchCustomEmojiDefinitions(videoId) {
    let res;
    try {
        res = await axios.get(`https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`, {
            headers: BASE_HEADERS,
            timeout: REQUEST_TIMEOUT_MS,
            validateStatus: () => true,
        });
    } catch (err) {
        console.warn(`  [fetch] ${videoId}: request failed - ${err.message}`);
        return [];
    }
    if (res.status !== 200 || typeof res.data !== 'string') {
        console.warn(`  [fetch] ${videoId}: HTTP ${res.status}`);
        return [];
    }

    const data = extractInitialData(res.data);
    if (!data) {
        console.warn(`  [fetch] ${videoId}: no ytInitialData found`);
        return [];
    }

    const defs = [];
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }

        const emoji = node.emoji;
        if (emoji && typeof emoji === 'object' && emoji.isCustomEmoji === true) {
            try {
                const rawShortcut = Array.isArray(emoji.shortcuts) ? emoji.shortcuts[0] : null;
                const shortcut = String(rawShortcut || '').replace(/^:|:$/g, '').toLowerCase();
                const imageUrl = emoji.image?.thumbnails?.[0]?.url || null;
                if (shortcut && imageUrl) {
                    defs.push({
                        shortcut,
                        emoji_id: emoji.emojiId || null,
                        image_url: imageUrl,
                        alt: emoji.image?.accessibility?.accessibilityData?.label || shortcut,
                    });
                }
            } catch (_) {
                // Malformed emoji object on this one node — skip it, keep walking.
            }
        }
        for (const v of Object.values(node)) walk(v);
    };
    walk(data);
    return defs;
}

/**
 * Resolve every shortcut observed across the given video_ids into a single
 * definition each. A shortcut seen with more than one distinct
 * (emoji_id, image_url) pair is ambiguous and deliberately dropped — never
 * guessed which one is "right".
 */
async function buildResolvedTable(videoIds) {
    const variantsByShortcut = new Map(); // shortcut -> Map(variantKey -> def)
    for (const videoId of videoIds) {
        console.log(`  fetching live_chat metadata for videoId=${videoId} ...`);
        const defs = await fetchCustomEmojiDefinitions(videoId);
        console.log(`    ${defs.length} custom-emoji definition(s) currently visible`);
        for (const d of defs) {
            const variantKey = `${d.emoji_id}||${d.image_url}`;
            if (!variantsByShortcut.has(d.shortcut)) variantsByShortcut.set(d.shortcut, new Map());
            variantsByShortcut.get(d.shortcut).set(variantKey, d);
        }
    }

    const resolved = new Map();
    const ambiguous = [];
    for (const [shortcut, variants] of variantsByShortcut) {
        if (variants.size === 1) resolved.set(shortcut, [...variants.values()][0]);
        else ambiguous.push({ shortcut, variantCount: variants.size });
    }
    return { resolved, ambiguous };
}

/* ═══════════════════════ text -> display_parts (historical rows only) ═══════════════════════ */
/*
 * Historical rows never had their original YouTube runs stored — only the
 * already-flattened `text` survives, so reconstructing positions here from
 * `text` is unavoidable (there is nothing else left to reconstruct from).
 * This is NOT how newly-ingested messages work: those get display_parts
 * straight from the real run boundaries in youtubeLiveChatReader.js, never
 * from scanning text. Uses the same token-boundary-safe pattern as
 * backfill_standard_emoji_text.js.
 */
const TOKEN_RE = /:([a-z0-9_+-]+):/gi;

function buildDisplayPartsFromText(text, resolvedTable) {
    const parts = [];
    let textBuf = '';
    let resolvedHits = 0;
    let unresolvedShortcuts = [];
    let lastIndex = 0;
    const re = new RegExp(TOKEN_RE);
    let m;
    while ((m = re.exec(text)) !== null) {
        const whole = m[0];
        const name = m[1].toLowerCase();
        textBuf += text.slice(lastIndex, m.index);
        lastIndex = m.index + whole.length;

        const def = resolvedTable.get(name);
        if (def) {
            resolvedHits++;
            if (textBuf) { parts.push({ part_type: 'text', value: textBuf }); textBuf = ''; }
            parts.push({
                part_type: 'custom_emoji',
                emoji_id: def.emoji_id,
                image_url: def.image_url,
                alt: def.alt,
            });
        } else {
            unresolvedShortcuts.push(whole);
            textBuf += whole; // leave the token text exactly as-is — this occurrence stays unresolved
        }
    }
    textBuf += text.slice(lastIndex);
    if (textBuf) parts.push({ part_type: 'text', value: textBuf });

    return { parts, resolvedHits, unresolvedShortcuts };
}

/* ═══════════════════════ scan / report / (optionally) write ═══════════════════════ */

const fmtDoc = (d) => ({
    _id: String(d._id),
    message_id: d.message_id,
    stream_id: d.stream_id,
    video_id: d.video_id,
    author_name: d.author_name,
    created_at: d.created_at,
});

async function scan() {
    const candidates = await LiveChatMessage.find(
        { text: { $regex: ':[a-z0-9_+-]+:', $options: 'i' } }
    ).lean();

    if (!candidates.length) {
        return { candidates: [], videoIds: [], resolved: new Map(), ambiguous: [], toChange: [], unresolvedDocs: [] };
    }

    const videoIds = [...new Set(candidates.map((d) => d.video_id).filter(Boolean))];
    console.log(`Candidate documents: ${candidates.length}. Distinct video_id(s) referenced: ${videoIds.length}`);
    const { resolved, ambiguous } = await buildResolvedTable(videoIds);

    const toChange = [];
    const unresolvedDocs = [];
    let totalResolvedOccurrences = 0;
    let totalUnresolvedOccurrences = 0;

    for (const doc of candidates) {
        const { parts, resolvedHits, unresolvedShortcuts } = buildDisplayPartsFromText(doc.text, resolved);
        totalResolvedOccurrences += resolvedHits;
        totalUnresolvedOccurrences += unresolvedShortcuts.length;

        // All-or-nothing per document: every custom-shortcode occurrence in
        // this doc's text must resolve, or the doc is left completely
        // untouched. No partial/best-effort display_parts are ever written.
        if (resolvedHits > 0 && unresolvedShortcuts.length === 0) {
            toChange.push({ doc, parts });
        } else if (unresolvedShortcuts.length > 0) {
            unresolvedDocs.push({ doc, unresolvedShortcuts, resolvedHits });
        }
    }

    return { candidates, videoIds, resolved, ambiguous, toChange, unresolvedDocs, totalResolvedOccurrences, totalUnresolvedOccurrences };
}

function printReport(r) {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(' Custom-emoji display_parts backfill —', EXECUTE ? 'EXECUTE MODE' : 'DRY RUN (no writes)');
    console.log('═══════════════════════════════════════════════════════════');

    if (!r.candidates.length) {
        console.log('No documents contain any ":word:"-shaped token. Nothing to do.');
        return;
    }

    console.log(`\nDocuments scanned:      ${r.candidates.length}`);
    console.log(`Documents resolvable:   ${r.toChange.length}`);
    console.log(`Documents unresolved:   ${r.unresolvedDocs.length}`);
    console.log(`Occurrences resolved:   ${r.totalResolvedOccurrences}`);
    console.log(`Occurrences unresolved: ${r.totalUnresolvedOccurrences}`);

    console.log('\n─── shortcodes resolved this run ───');
    for (const [shortcut, def] of r.resolved) {
        console.log(`  :${shortcut}:`);
        console.log(`    emoji_id : ${def.emoji_id}`);
        console.log(`    image_url: ${def.image_url}`);
        console.log(`    alt      : ${def.alt}`);
    }
    if (!r.resolved.size) console.log('  (none)');

    if (r.ambiguous.length) {
        console.log('\n─── AMBIGUOUS shortcodes — skipped, never guessed ───');
        r.ambiguous.forEach((a) => console.log(`  :${a.shortcut}: — ${a.variantCount} conflicting definitions observed`));
    }

    console.log('\n─── representative before/after examples (resolvable) ───');
    r.toChange.slice(0, SAMPLE_SIZE).forEach(({ doc, parts }) => {
        console.log('');
        console.log('  doc:', JSON.stringify(fmtDoc(doc)));
        console.log('  text (UNCHANGED):', JSON.stringify(doc.text));
        console.log('  display_parts (NEW):', JSON.stringify(parts, null, 2).split('\n').join('\n  '));
    });

    console.log('\n─── documents left completely untouched (unresolved) ───');
    r.unresolvedDocs.forEach(({ doc, unresolvedShortcuts }) => {
        console.log(`  ${JSON.stringify(fmtDoc(doc))}`);
        console.log(`    text: ${JSON.stringify(doc.text)}`);
        console.log(`    still unresolved: ${JSON.stringify(unresolvedShortcuts)}`);
    });
    if (!r.unresolvedDocs.length) console.log('  (none)');
}

async function writeBackupAndExecute(toChange) {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `custom_emoji_display_parts_backfill_${stamp}.json`);

    fs.writeFileSync(backupFile, JSON.stringify(toChange.map((c) => c.doc), null, 2));
    console.log(`\nBackup written: ${backupFile} (${toChange.length} full original document(s))`);

    const ops = toChange.map(({ doc, parts }) => ({
        updateOne: {
            filter: { _id: doc._id },
            // Narrow on purpose: display_parts only. text and everything
            // else on the document is untouched.
            update: { $set: { display_parts: parts } },
        },
    }));

    const result = await LiveChatMessage.bulkWrite(ops, { ordered: false });
    console.log(`Executed: matched=${result.matchedCount} modified=${result.modifiedCount}`);
    console.log(`To undo: node scripts/backfill_custom_emoji_display_parts.js --revert=${backupFile}`);
}

async function revert(backupFile) {
    const raw = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    console.log(`Reverting ${raw.length} document(s) from ${backupFile} ...`);
    const ops = raw.map((d) => ({
        updateOne: {
            filter: { _id: new mongoose.Types.ObjectId(d._id) },
            update: { $set: { display_parts: d.display_parts || [] } },
        },
    }));
    const result = await LiveChatMessage.bulkWrite(ops, { ordered: false });
    console.log(`Reverted: matched=${result.matchedCount} modified=${result.modifiedCount}`);
}

/* ═══════════════════════ entry point ═══════════════════════ */

(async () => {
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
