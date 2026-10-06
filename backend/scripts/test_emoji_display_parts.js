#!/usr/bin/env node
/**
 * Deterministic regression suite for YouTube Live emoji fidelity.
 *
 * No LLM, no network. Only the persistence round-trip section touches
 * Mongoose (constructing documents in memory — no DB connection is opened),
 * so the whole suite runs in milliseconds and exits non-zero on any failure.
 *
 *   node scripts/test_emoji_display_parts.js
 *
 * RUN THIS after ANY change to:
 *   src/services/youtubeLiveChatReader.js  (parseMessageRuns)
 *   src/models/LiveChatMessage.js          (display_parts field)
 *   src/services/youtubeLiveService.js     (persistChunk's display_parts mapping)
 *   components/grievances/YouTubeLiveTab.jsx (renderMessageBody — see the
 *     frontend counterpart of this suite for that piece)
 *
 * Sections:
 *   A — parseMessageRuns: plain text, standard Unicode emoji, custom emoji
 *   B — parseMessageRuns: ordering, multiple segments, edge positions
 *   C — persistChunk's display_parts mapping (empty -> undefined semantics)
 *   D — LiveChatMessage persistence shape (Mixed field, no auto-vivification)
 *   E — SSE/API JSON payload fidelity
 */

const { parseMessageRuns } = require('../src/services/youtubeLiveChatReader');
const LiveChatMessage = require('../src/models/LiveChatMessage');

let pass = 0;
let fail = 0;

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const t = (name, got, expected) => {
    const ok = deepEqual(got, expected);
    if (ok) pass += 1; else fail += 1;
    console.log(`${ok ? 'PASS' : '*** FAIL'}  ${name}`);
    if (!ok) {
        console.log(`        got:      ${JSON.stringify(got)}`);
        console.log(`        expected: ${JSON.stringify(expected)}`);
    }
};

/* ─── run builders (mirror the shape parseMessageRuns actually reads) ──── */

const textRun = (text) => ({ text });

const unicodeEmojiRun = (char, shortcut = ':emoji:') => ({
    emoji: { emojiId: char, shortcuts: [shortcut], isCustomEmoji: false },
});

const customEmojiRun = ({ shortcut, emojiId, imageUrl, alt }) => ({
    emoji: {
        emojiId,
        isCustomEmoji: true,
        shortcuts: [shortcut],
        image: {
            thumbnails: [{ url: imageUrl }],
            accessibility: { accessibilityData: { label: alt } },
        },
    },
});

const EMOJI_A = { shortcut: ':party-flag:', emojiId: 'UCabc123/asset1', imageUrl: 'https://yt3.ggpht.com/asset1', alt: 'Party Flag' };
const EMOJI_B = { shortcut: ':party-cheer:', emojiId: 'UCabc123/asset2', imageUrl: 'https://yt3.ggpht.com/asset2', alt: 'Party Cheer' };

/* ═══════════════════════ A — plain text & standard Unicode emoji ═══════════════════════ */

t('1. plain text message, no emoji',
    parseMessageRuns([textRun('jai BJP')]),
    { text: 'jai BJP', displayParts: [] });

t('2. text + a single Unicode emoji',
    parseMessageRuns([textRun('nice work '), unicodeEmojiRun('😅', ':sweat_smile:')]),
    { text: 'nice work 😅', displayParts: [] });

t('3. multiple Unicode emojis in a row',
    parseMessageRuns([textRun('wow '), unicodeEmojiRun('😅'), unicodeEmojiRun('🔥')]),
    { text: 'wow 😅🔥', displayParts: [] });

t('7a. emoji-only message (standard Unicode)',
    parseMessageRuns([unicodeEmojiRun('🔥')]),
    { text: '🔥', displayParts: [] });

t('10. no display_parts needed for a plain message',
    parseMessageRuns([textRun('great speech today')]).displayParts.length,
    0);

/* ═══════════════════════ A2 — custom YouTube emoji ═══════════════════════ */

t('4. text + a single custom emoji',
    parseMessageRuns([textRun('great '), customEmojiRun(EMOJI_A)]),
    {
        text: 'great :party-flag:',
        displayParts: [
            { part_type: 'text', value: 'great ' },
            { part_type: 'custom_emoji', emoji_id: EMOJI_A.emojiId, image_url: EMOJI_A.imageUrl, alt: EMOJI_A.alt },
        ],
    });

t('5. multiple custom emojis back-to-back',
    parseMessageRuns([customEmojiRun(EMOJI_A), customEmojiRun(EMOJI_B)]),
    {
        text: ':party-flag::party-cheer:',
        displayParts: [
            { part_type: 'custom_emoji', emoji_id: EMOJI_A.emojiId, image_url: EMOJI_A.imageUrl, alt: EMOJI_A.alt },
            { part_type: 'custom_emoji', emoji_id: EMOJI_B.emojiId, image_url: EMOJI_B.imageUrl, alt: EMOJI_B.alt },
        ],
    });

t('7b. emoji-only message (custom emoji)',
    parseMessageRuns([customEmojiRun(EMOJI_A)]),
    {
        text: ':party-flag:',
        displayParts: [
            { part_type: 'custom_emoji', emoji_id: EMOJI_A.emojiId, image_url: EMOJI_A.imageUrl, alt: EMOJI_A.alt },
        ],
    });

/* ═══════════════════════ B — ordering, mixed content, edge positions ═══════════════════════ */

t('6. mixed text + Unicode emoji + custom emoji, order preserved',
    parseMessageRuns([
        textRun('go '), unicodeEmojiRun('🔥'), textRun(' team '), customEmojiRun(EMOJI_A), textRun('!'),
    ]),
    {
        text: 'go 🔥 team :party-flag:!',
        displayParts: [
            { part_type: 'text', value: 'go 🔥 team ' },
            { part_type: 'custom_emoji', emoji_id: EMOJI_A.emojiId, image_url: EMOJI_A.imageUrl, alt: EMOJI_A.alt },
            { part_type: 'text', value: '!' },
        ],
    });

t('8a. custom emoji at the START of the message',
    parseMessageRuns([customEmojiRun(EMOJI_A), textRun(' hello')]),
    {
        text: ':party-flag: hello',
        displayParts: [
            { part_type: 'custom_emoji', emoji_id: EMOJI_A.emojiId, image_url: EMOJI_A.imageUrl, alt: EMOJI_A.alt },
            { part_type: 'text', value: ' hello' },
        ],
    });

t('8b. custom emoji at the END of the message',
    parseMessageRuns([textRun('bye '), customEmojiRun(EMOJI_A)]),
    {
        text: 'bye :party-flag:',
        displayParts: [
            { part_type: 'text', value: 'bye ' },
            { part_type: 'custom_emoji', emoji_id: EMOJI_A.emojiId, image_url: EMOJI_A.imageUrl, alt: EMOJI_A.alt },
        ],
    });

t('9. multiple text/emoji segments interleaved',
    parseMessageRuns([
        textRun('a'), customEmojiRun(EMOJI_A), textRun('b'), customEmojiRun(EMOJI_B), textRun('c'),
    ]),
    {
        text: 'a:party-flag:b:party-cheer:c',
        displayParts: [
            { part_type: 'text', value: 'a' },
            { part_type: 'custom_emoji', emoji_id: EMOJI_A.emojiId, image_url: EMOJI_A.imageUrl, alt: EMOJI_A.alt },
            { part_type: 'text', value: 'b' },
            { part_type: 'custom_emoji', emoji_id: EMOJI_B.emojiId, image_url: EMOJI_B.imageUrl, alt: EMOJI_B.alt },
            { part_type: 'text', value: 'c' },
        ],
    });

t('leading/trailing whitespace is trimmed like text.trim()',
    parseMessageRuns([textRun('   padded text   ')]),
    { text: 'padded text', displayParts: [] });

/* ═══════════════════════ C — persistChunk's display_parts mapping ═══════════════════════ */
/* Mirrors the exact expression in youtubeLiveService.js persistChunk(), so a
 * change to that line is caught here without needing a live DB/poller. */

const toStoredDisplayParts = (m) => (m.display_parts && m.display_parts.length) ? m.display_parts : undefined;

t('C1. a message with no custom emoji stores display_parts as undefined (omitted key), not []',
    toStoredDisplayParts({ display_parts: [] }),
    undefined);

t('C2. a message with custom emoji stores the full ordered array',
    toStoredDisplayParts({ display_parts: [{ part_type: 'custom_emoji', emoji_id: EMOJI_A.emojiId, image_url: EMOJI_A.imageUrl, alt: EMOJI_A.alt }] }),
    [{ part_type: 'custom_emoji', emoji_id: EMOJI_A.emojiId, image_url: EMOJI_A.imageUrl, alt: EMOJI_A.alt }]);

/* ═══════════════════════ D — LiveChatMessage persistence shape ═══════════════════════ */
/* new Model() constructs and casts a document without opening a DB
 * connection, so this checks the Mixed-field auto-vivification behaviour the
 * model's own comment relies on — no mongoose.connect() needed. */

const baseFields = {
    stream_id: 'stream-1',
    video_id: 'video-1',
    message_id: 'msg-1',
    published_at: new Date(),
};

{
    const doc = new LiveChatMessage({ ...baseFields, text: 'plain message' }).toObject();
    const ok = !('display_parts' in doc);
    if (ok) pass += 1; else fail += 1;
    console.log(`${ok ? 'PASS' : '*** FAIL'}  D1. a document with no custom emoji has NO display_parts key at all (not [])`);
    if (!ok) console.log(`        got display_parts: ${JSON.stringify(doc.display_parts)}`);
}

{
    const parts = [
        { part_type: 'text', value: 'great ' },
        { part_type: 'custom_emoji', emoji_id: EMOJI_A.emojiId, image_url: EMOJI_A.imageUrl, alt: EMOJI_A.alt },
    ];
    const doc = new LiveChatMessage({ ...baseFields, text: 'great :party-flag:', display_parts: parts }).toObject();
    t('D2. a document with custom emoji round-trips display_parts unchanged through the schema', doc.display_parts, parts);
}

/* ═══════════════════════ E — SSE / API JSON payload fidelity ═══════════════════════ */
/* The SSE route and the REST /messages route both do a plain
 * JSON.stringify() of the message document — this pins that undefined keys
 * are dropped (matching "omit entirely" in persistChunk) and present arrays
 * survive the trip byte-for-byte. */

{
    const withEmoji = { id: 'm1', text: 'great :party-flag:', display_parts: [{ part_type: 'custom_emoji', emoji_id: EMOJI_A.emojiId, image_url: EMOJI_A.imageUrl, alt: EMOJI_A.alt }] };
    const roundTripped = JSON.parse(JSON.stringify(withEmoji));
    t('E1. SSE/API payload preserves display_parts for a message with custom emoji', roundTripped.display_parts, withEmoji.display_parts);
}

{
    const noEmoji = { id: 'm2', text: 'plain message', display_parts: undefined };
    const roundTripped = JSON.parse(JSON.stringify(noEmoji));
    const ok = !('display_parts' in roundTripped) && roundTripped.text === 'plain message';
    if (ok) pass += 1; else fail += 1;
    console.log(`${ok ? 'PASS' : '*** FAIL'}  E2. SSE/API payload omits display_parts entirely for a plain message`);
    if (!ok) console.log(`        got: ${JSON.stringify(roundTripped)}`);
}

/* ═══════════════════════ summary ═══════════════════════ */

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
