# YouTube Live Chat — Emoji Fidelity Feature: Canonical Implementation Spec

Status: implemented and verified in TDP Saga (this repository). Written as a portable
specification so the identical feature can be reproduced in another Blura Saga deployment
(e.g. TGCongress Saga) without re-deriving the design. This document describes ONLY the
emoji feature — it assumes the base YouTube Live Chat Monitor feature (see
`YOUTUBE_LIVE_MONITOR_IMPLEMENTATION.md`) already exists in the target app.

**What this feature does:** ensures every YouTube live-chat message displays with full
visual fidelity — standard Unicode emoji as real characters, and YouTube custom/channel
emoji as their actual image — instead of degrading to a raw `:shortcut:` text placeholder.

---

## 0. The contract, stated once

> Given a YouTube InnerTube chat message's `runs` array, produce a `text` string and a
> `display_parts` array such that:
> 1. `text` is exactly what existed before this feature (byte-for-byte compatible with the
>    prior "flatten runs to a string" behavior) EXCEPT that a standard Unicode emoji is now
>    inlined as its real character instead of its `:shortcode:` alias.
> 2. `display_parts` is `[]` (and never persisted — see §4) UNLESS the message contains at
>    least one custom/channel emoji, in which case it is the ordered, positional
>    reconstruction of the message: alternating `{part_type:'text', value}` and
>    `{part_type:'custom_emoji', emoji_id, image_url, alt}` entries, in YouTube's original
>    run order.
> 3. Nothing downstream (DB, API, SSE) may lose, reorder, or duplicate this information.
> 4. A message with no custom emoji costs nothing extra to store or transmit versus before
>    this feature existed (no `[]` written, no key sent).
> 5. Rendering never breaks on missing/broken image data — it always degrades to text.

Every other section below is the concrete implementation of this contract.

---

## 1. Exact files involved

| File | Role | New or modified |
|---|---|---|
| `backend/src/services/youtubeLiveChatReader.js` | `parseMessageRuns()` — the parser. Only YouTube-facing file touched. | Modified |
| `backend/src/models/LiveChatMessage.js` | `display_parts` schema field. | Modified |
| `backend/src/services/youtubeLiveService.js` | `persistChunk()` — carries `display_parts` from reader output into the Mongo doc. | Modified |
| `backend/scripts/backfill_standard_emoji_text.js` | One-time repair: rewrite historical `text` for known standard-emoji shortcodes. | New |
| `backend/scripts/backfill_custom_emoji_display_parts.js` | One-time repair: populate historical `display_parts` for custom emoji. | New |
| `backend/scripts/test_emoji_display_parts.js` | Backend regression suite (no DB/network required for the parsing tests). | New |
| `backend/package.json` | Two new deps, five new npm scripts. | Modified |
| `frontend/.../liveChatEmoji.jsx` | `CustomEmojiImage` + `renderMessageBody` — the renderer. Deliberately its own module (see §6, §10). | New |
| `frontend/.../YouTubeLiveTab.jsx` | Imports `renderMessageBody` and uses it in place of raw `msg.text`. | Modified (2 lines net) |
| `frontend/.../liveChatEmoji.test.js` | Frontend regression suite (jsdom, no network). | New |

**Files explicitly NOT touched, and why:** the chat routes/controller file, the app entry
point, and the `LiveStream` (channel-level) model. `display_parts` flows through the REST
`/messages` endpoint and the SSE `messages`/`message:update` events purely because those
layers do `Model.find().lean()` / `doc.toObject()` and `JSON.stringify(...)` generically —
any field present on the document is transmitted, any field absent is not. No route,
controller, or serialization code needed to know this field exists. **Do not add
`display_parts` handling to routes/controllers in the target app — if it needs adding,
something about the base port is non-standard and should be investigated first.**

---

## 2. `youtubeLiveChatReader.js` — exact change

The pre-existing function that flattened a message's `runs` into a plain string:

```js
const runsToText = (runs) =>
    (runs || [])
        .map((r) => {
            if (typeof r.text === 'string') return r.text;
            if (r.emoji) return r.emoji.shortcuts?.[0] || r.emoji.emojiId || '';
            return '';
        })
        .join('')
        .trim();
```

is replaced by `parseMessageRuns(runs)` (full behavior in §3), and its single call site is
updated:

```js
// before
const text = runsToText(renderer.message?.runs);
// ...
return { ..., text, ... };

// after
const { text, displayParts } = parseMessageRuns(renderer.message?.runs);
// ...
return { ..., text, display_parts: displayParts, ... };
```

`parseMessageRuns` is also added to the module's exports (`// exported for tests`) — it has
no side effects and no dependency on the rest of the module, so it is unit-testable in
isolation.

**Nothing else in this file changes.** In particular, do not port any other reader-level
behavior differences you might find if diffing against a KKSaga copy of this file — see §10.

---

## 3. `parseMessageRuns()` — exact behavioral spec

```js
const parseMessageRuns = (runs) => {
    let text = '';
    let textBuf = '';
    const parts = [];
    let hasCustomEmoji = false;

    const flushText = () => {
        if (textBuf) parts.push({ part_type: 'text', value: textBuf });
        textBuf = '';
    };

    for (const r of (runs || [])) {
        if (typeof r.text === 'string') {
            text += r.text;
            textBuf += r.text;
            continue;
        }
        if (!r.emoji) continue;

        if (r.emoji.isCustomEmoji === true) {
            hasCustomEmoji = true;
            const shortcut = r.emoji.shortcuts?.[0] || '';
            text += shortcut;

            flushText();
            parts.push({
                part_type: 'custom_emoji',
                emoji_id: r.emoji.emojiId || null,
                image_url: r.emoji.image?.thumbnails?.[0]?.url || null,
                alt: r.emoji.image?.accessibility?.accessibilityData?.label
                    || shortcut.replace(/^:|:$/g, '')
                    || null,
            });
        } else {
            const char = r.emoji.emojiId || r.emoji.shortcuts?.[0] || '';
            text += char;
            textBuf += char;
        }
    }
    flushText();

    if (parts.length && parts[0].part_type === 'text') {
        parts[0].value = parts[0].value.replace(/^\s+/, '');
        if (!parts[0].value) parts.shift();
    }
    if (parts.length && parts[parts.length - 1].part_type === 'text') {
        const last = parts[parts.length - 1];
        last.value = last.value.replace(/\s+$/, '');
        if (!last.value) parts.pop();
    }

    return { text: text.trim(), displayParts: hasCustomEmoji ? parts : [] };
};
```

### Behavior by input case

**Normal text run** (`{ text: "..." }`): appended to both `text` and the current `textBuf`
segment. No part is created for it directly — it becomes (part of) the next flushed
`{part_type:'text', value}` segment.

**Standard Unicode emoji** (`{ emoji: { emojiId, shortcuts, isCustomEmoji: false|undefined } }`):
the run's real character is `emoji.emojiId` — InnerTube puts the actual Unicode character
there, e.g. `emojiId: "😅"`. `shortcuts[0]` is only the human alias (`":sweat_smile:"`) and
**must never be preferred over `emojiId`** — that inversion was the original bug this
feature fixes. The character is appended to `text` and to the current `textBuf`, exactly
like a text run. **No `display_parts` entry is created.** `isCustomEmoji` is treated as
falsy for anything other than the literal boolean `true` — an absent field, `false`, or any
other value all take this branch.

**Custom/channel emoji** (`{ emoji: { isCustomEmoji: true, emojiId, shortcuts, image } }`):
these have no Unicode equivalent — `emojiId` here is an opaque per-channel identifier
(`"{channelId}/{assetId}"`), not a character. Handling:
1. `hasCustomEmoji` is set (this is what decides whether `display_parts` ends up non-empty
   at all).
2. The shortcut (`shortcuts[0]`, or `''` if absent) is appended to `text` — this preserves
   the pre-existing fallback behavior for any consumer that only ever reads `text` (search,
   the LLM sentiment prompt, etc.).
3. Any buffered plain text before this point is flushed into a `text` part.
4. A `custom_emoji` part is pushed with:
   - `emoji_id`: `emoji.emojiId`, or `null` if absent. Chosen over `image_url` as the
     durable identity because the CDN URL is an unversioned `yt3.ggpht.com` hash path with
     no stated longevity guarantee, while `emojiId` is YouTube's own stable identifier for
     the asset.
   - `image_url`: `emoji.image.thumbnails[0].url`, or `null` if that path doesn't resolve.
     Deliberately only the first/smallest thumbnail — inline chat-sized rendering never
     needs the full `thumbnails` array, and storing it would bloat every row.
   - `alt`: `emoji.image.accessibility.accessibilityData.label`, falling back to the
     shortcut with its colons stripped (`shortcut.replace(/^:|:$/g, '')`), falling back to
     `null` if both are unavailable.

**Mixed text + standard emoji + custom emoji, any order:** runs are processed strictly in
the order YouTube sent them. Standard emoji simply extend the current text buffer; custom
emoji force a flush-then-push. The result is a `parts` array where every custom emoji is
its own array element and every contiguous run of (text ∪ standard-emoji-as-character)
between two custom emoji — or before the first / after the last — is one `text` part. This
is a single left-to-right pass with O(n) parts relative to the number of custom emoji, not
the number of runs.

**Ordering/position preservation:** guaranteed by construction — `parts` is only ever
appended to (`.push`), never reordered, and the loop visits `runs` in array order. There is
no sorting, no separate "collect custom emoji then collect text" pass.

**Edge trimming:** `text.trim()` is the final value for `text`. To keep `display_parts`
visually consistent with a trimmed `text`, the FIRST part (if it is a `text` part) has
leading whitespace stripped, and the LAST part (if it is a `text` part) has trailing
whitespace stripped. If stripping empties that part, it is removed from the array entirely
(`parts.shift()` / `parts.pop()`) rather than left as an empty string entry. This trimming
never touches a `custom_emoji` part, and never touches a `text` part that isn't at position
0 or `length-1` (interior whitespace, e.g. the space between an emoji and the next word, is
content and is preserved).

**Malformed / missing emoji metadata — every fallback is `|| null` or `|| ''`, never a
thrown error:**
- No `runs` argument at all → `runs || []` → returns `{ text: '', displayParts: [] }`.
- A run with neither a string `text` nor a truthy `emoji` → silently skipped (`continue`).
- `emoji.shortcuts` missing/empty → `''`/`null` fallback, never `undefined` written to the
  document (undefined store values are simply omitted by Mongoose on a plain object field,
  but here the fallbacks make the value an explicit `''` or `null` string).
- `emoji.image` missing entirely, or `image.thumbnails` empty, or `image.accessibility`
  missing → `image_url` and/or `alt` resolve to `null` via optional chaining
  (`r.emoji.image?.thumbnails?.[0]?.url`) — never a thrown `TypeError`.
- `emoji.emojiId` missing on a standard emoji → falls back to `shortcuts[0]`, then to `''`
  if that's also missing — the message is never dropped, worst case it contributes no
  visible character for that run.
- A message with `runs` present but yielding no text and no custom emoji (e.g. only
  whitespace) → `text: ''`, `displayParts: []`. (The CALLER, `parseRenderer`, separately
  drops the whole message if `!text && !purchase` — that early-return is pre-existing base
  feature behavior, not part of this spec, and must not be altered.)

**`hasCustomEmoji` is the single gate for whether `displayParts` is non-empty.** Even if
`parts` accumulated entries (which only happens via the custom-emoji branch), the function
still returns `[]` when `hasCustomEmoji` is false — this is actually unreachable dead
symmetry in practice (parts is only ever pushed to inside the custom-emoji branch or via
`flushText`, and a lone `flushText` with no subsequent custom-emoji push only fires at the
very end for the final buffered text — see the walkthrough below) but is written as an
explicit gate rather than relying on `parts.length` so the intent is unambiguous: **a
message containing ONLY standard emoji, or ONLY text, always yields `displayParts: []`,
never a single-element `[{part_type:'text', ...}]` array.**

---

## 4. `display_parts` schema — exact shape and omission rule

**Model field** (`LiveChatMessage.js`), placed directly after the existing `language` field:

```js
display_parts: {
    type: mongoose.Schema.Types.Mixed,
},
```

**Shape when present** — an array of exactly two possible element shapes, always in this
order relative to each other but interleaved as the message dictates:

```
{ part_type: 'text', value: string }
{ part_type: 'custom_emoji', emoji_id: string|null, image_url: string|null, alt: string|null }
```

**Why `Mixed` and not a typed `[{...}]` sub-schema — this is load-bearing, not stylistic:**
a typed Mongoose array path is auto-vivified to `[]` on every document Mongoose
constructs, REGARDLESS of whether a `default` is declared. Since the overwhelming majority
of live-chat messages have no custom emoji, a typed array would silently write `[]` to
every single row at live-chat volume (potentially thousands/hour). `Mixed` has no such
auto-vivification: an absent/undefined value is genuinely absent from the stored document.
**The tradeoff, accepted deliberately:** Mongoose no longer validates this field's internal
shape (the `part_type` enum, per-field casting). This is acceptable only because there is
exactly one writer of non-empty values in the whole system — `parseMessageRuns()` (plus the
backfill script in §7, which constructs the identical shape by hand) — and neither path
takes this shape from untrusted/external input.

**Exact omission rule**, in `persistChunk()` (`youtubeLiveService.js`), where the Mongo doc
is built from a parsed message `m`:

```js
{
    ...
    text: m.text,
    display_parts: (m.display_parts && m.display_parts.length) ? m.display_parts : undefined,
    is_superchat: m.is_superchat,
    ...
}
```

`undefined` (not `null`, not `[]`) is passed for the common case. Combined with the
`Mixed`/no-default field above, this means: **a message with no custom emoji has NO
`display_parts` key at all in the stored MongoDB document** — verified directly (see §9,
test D1) by constructing a document and confirming `'display_parts' in doc.toObject()` is
`false`. A message WITH custom emoji stores the complete ordered array, unmodified.

This same `undefined`-drops-the-key behavior is what makes SSE/API payloads efficient too:
`JSON.stringify({..., display_parts: undefined, ...})` omits the key from the JSON output
entirely (this is standard `JSON.stringify` behavior for `undefined` values, not anything
this feature added) — verified in test E2.

---

## 5. Exact persistence flow, end to end

```
InnerTube runs
   → parseMessageRuns(runs)                             [youtubeLiveChatReader.js]
      → { text, displayParts }
   → parseRenderer() returns { ..., text, display_parts: displayParts, ... }
   → fetchChunk() returns { messages: [...], ... }        (array of the above objects)
   → persistChunk(stream, messages)                       [youtubeLiveService.js]
      → per message m: doc.display_parts =
            (m.display_parts && m.display_parts.length) ? m.display_parts : undefined
      → LiveChatMessage.insertMany(docs, { ordered: false })
            (unrelated to this feature: message_id unique index absorbs
             reconnect-overlap duplicates — do not alter this mechanism)
   → inserted docs (Mongoose documents) → .toObject() for the emitted/bus payload
      → bus.emit('messages', { stream_id, video_id, messages: emitted })
   → SSE route: JSON.stringify(payload) straight onto the `messages` event
      OR REST GET /messages: LiveChatMessage.find(filter).lean() → JSON response
   → frontend receives the message object, `display_parts` present iff the
     message actually contained custom emoji
```

No step in this chain does anything emoji-specific beyond the two marked points
(`parseMessageRuns` and the one-line mapping in `persistChunk`). Every other step
(`insertMany`, the bus, the SSE writer, the REST handler) is generic pass-through — this is
intentional and must be preserved in the port: **do not add any emoji-aware code to the
routes, the SSE writer, or the bus.**

---

## 6. Frontend rendering — exact behavior and fallback

**Module: `liveChatEmoji.jsx`** (deliberately separate from the tab component — see §10 for
why). Exports two things, both pure with respect to the rest of the app (no API client, no
toast library, no icon set imported):

```js
export const CustomEmojiImage = ({ part }) => {
    const [broken, setBroken] = useState(false);
    const usable = typeof part.image_url === 'string' && part.image_url.startsWith('https://') && !broken;

    if (!usable) {
        return <span className="text-slate-500">{part.alt ? `:${part.alt}:` : ''}</span>;
    }
    return (
        <img
            src={part.image_url}
            alt={part.alt || 'emoji'}
            title={part.alt || undefined}
            onError={() => setBroken(true)}
            loading="lazy"
            className="inline-block h-[18px] w-[18px] align-text-bottom object-contain"
        />
    );
};

export const renderMessageBody = (msg) => {
    const parts = msg.display_parts;
    if (!parts || !parts.length) return msg.text;

    return parts.map((p, i) => {
        const key = `${msg.id || msg.message_id}-part-${i}`;
        if (p.part_type === 'custom_emoji') {
            return <CustomEmojiImage key={key} part={p} />;
        }
        return <React.Fragment key={key}>{p.value}</React.Fragment>;
    });
};
```

**Call site** (the tab's message row): `<p>{renderMessageBody(msg)}</p>` in place of
`<p>{msg.text}</p>`. This is the ONLY rendering change.

### Exact fallback rules

1. **No `display_parts`, or an empty array, or the key entirely absent:** `renderMessageBody`
   returns `msg.text` — a plain string — unchanged from pre-feature behavior. React renders
   a string child identically to before; no wrapper elements are introduced for the common
   case.
2. **`display_parts` present:** returns an array of React nodes (never a string), one per
   part, each keyed by `${id}-part-${index}` for stable reconciliation across live SSE
   patches.
3. **`image_url` fails the `https://` prefix check** (not a string, empty, `http://`, a
   relative path, anything else): renders `:{alt}:` as plain text (or an empty span if `alt`
   is also falsy) — **never renders an untrusted string as a `src`/markup**. This check runs
   on every render, not just once.
4. **The `<img>` fires a load error** (`onError`): local `broken` state flips to `true`,
   which on re-render fails the `usable` check above and falls through to the same `:{alt}:`
   text fallback. A broken emoji image is never left as a visible broken-image icon.
5. Fixed presentation: `18px` square, `inline-block`, `align-text-bottom`, `object-contain`,
   `loading="lazy"`. These are the only styling decisions specific to this feature; they are
   safe to keep as-is or restyle to the target app's own design system — restyling is NOT a
   behavioral change.

---

## 7. Backfill scripts — exact behavior

Both scripts share one shape: **dry-run by default**, `--execute` to write, full-document
JSON backup written before any write, `--revert=<backup file>` to undo, and a narrow `$set`
that touches only the one field each script owns. Neither script ever guesses — every
decision is either "resolves unambiguously" or "left completely alone."

### 7a. `backfill_standard_emoji_text.js` — repairs historical `text`

Fixes rows written before this feature existed, where a standard Unicode emoji was stored
as its `:shortcode:` alias instead of the real character.

- Builds an in-memory shortcode → character table at run time from TWO merged datasets:
  `emoji-datasource` (short_name + short_names aliases + slugified official Unicode name)
  and `unicode-emoji-json` (CLDR annotation slug + slugified name). Neither dataset alone
  covers every shortcode observed in real production data; the merge does.
  - ZWJ/modifier-sequence composites (multi-codepoint `unified` values) are skipped
    entirely — YouTube's shortcodes for family/skin-tone compound emoji are unpredictable
    and not worth the ambiguity risk.
  - A key that resolves to more than one distinct character across the merged sources is
    dropped from the table (never guessed).
- Scans `LiveChatMessage` for `text` matching `/:[a-z0-9_+-]+:/i` (coarse pre-filter only —
  the real decision is the pure `backfillText()` function, so dry-run and `--execute` are
  guaranteed to agree).
- `backfillText(text)` replaces ONLY tokens present in the resolved table; every other
  `:word:`-shaped token (this is precisely how every custom/channel emoji shortcode is left
  alone, with zero special-casing) passes through byte-for-byte.
- Writes only `{ $set: { text: next } }` per matching document.
- Ships three inline pass/fail assertions (`runNamedTestCases()`) run unconditionally at
  script start, independent of DB connectivity — pure-function checks against
  `backfillText()` with representative before/after strings.

### 7b. `backfill_custom_emoji_display_parts.js` — repairs historical `display_parts`

Fixes rows written before this feature existed, where a custom emoji's `text` still holds
only its `:shortcut:` placeholder and `display_parts` was never populated.

- **No dictionary, nothing hardcoded.** Custom emoji have no deterministic shortcut→asset
  mapping — the only source of truth is YouTube itself, live. The script re-fetches the
  `live_chat?is_popout=1&v=<videoId>` page for every DISTINCT `video_id` referenced by a
  candidate document, and extracts every `emoji.isCustomEmoji === true` definition currently
  present in that page's initial data blob (the page's own bootstrapped recent-activity
  batch — not a full history).
- A shortcut observed with more than one distinct `(emoji_id, image_url)` pair across the
  video_ids fetched this run is ambiguous and dropped — never guessed which is "right."
- Reconstructs `display_parts` from each candidate document's `text` using the same
  token-boundary regex (`/:([a-z0-9_+-]+):/gi`) as the standard-emoji script, substituting
  each resolved shortcode occurrence for a `custom_emoji` part.
- **All-or-nothing per document:** a document is only queued to change if EVERY
  custom-shortcode occurrence in its `text` resolves. If even one occurrence in a document
  can't be resolved this run, the ENTIRE document is left untouched — no partial
  `display_parts` is ever written.
- Writes only `{ $set: { display_parts: parts } }` per matching document — `text` itself is
  never touched by this script.

---

## 8. Exact npm dependencies and scripts added

**`backend/package.json` dependencies** (alphabetical insertion, no other dependency
touched by this feature):
```
"emoji-datasource": "^16.0.0",
"unicode-emoji-json": "^0.9.0",
```

**`backend/package.json` scripts**:
```
"test:emoji": "node scripts/test_emoji_display_parts.js",
"backfill:emoji-text": "node scripts/backfill_standard_emoji_text.js",
"backfill:emoji-text:execute": "node scripts/backfill_standard_emoji_text.js --execute",
"backfill:emoji-parts": "node scripts/backfill_custom_emoji_display_parts.js",
"backfill:emoji-parts:execute": "node scripts/backfill_custom_emoji_display_parts.js --execute",
```

No frontend `package.json` changes — the frontend implementation uses only `react`, already
a dependency, and the test file uses only `react-dom/client` + `react-dom/test-utils`,
already transitive dependencies of `react-dom`.

---

## 9. Exact tests and test cases

### 9a. Backend — `backend/scripts/test_emoji_display_parts.js`

Convention: standalone script (matches the repo's existing `test_stance_engine.js` /
`test_sentiment_pipeline.js` pattern) — no test framework, deterministic, exits non-zero on
any failure, no network, no live DB connection (document-shape tests use `new Model()`,
which constructs/casts without opening a connection).

19 assertions, in five sections:

**A — plain text & standard Unicode emoji**
1. Plain text message, no emoji.
2. Text + a single Unicode emoji.
3. Multiple Unicode emojis in a row.
4. Emoji-only message (standard Unicode) — labeled "7a".
5. No `display_parts` needed for a plain message (checks `.displayParts.length === 0`) —
   labeled "10".

**A2 — custom YouTube emoji**
6. Text + a single custom emoji.
7. Multiple custom emojis back-to-back.
8. Emoji-only message (custom emoji) — labeled "7b".

**B — ordering, mixed content, edge positions**
9. Mixed text + Unicode emoji + custom emoji, order preserved.
10. Custom emoji at the START of the message — labeled "8a".
11. Custom emoji at the END of the message — labeled "8b".
12. Multiple text/emoji segments interleaved.
13. Leading/trailing whitespace trimmed like `text.trim()`.

**C — `persistChunk`'s display_parts mapping** (mirrors the exact expression, no DB)
14. A message with no custom emoji stores `display_parts` as `undefined`, not `[]`.
15. A message with custom emoji stores the full ordered array.

**D — `LiveChatMessage` persistence shape** (via `new Model()`, no DB connection)
16. A document with no custom emoji has NO `display_parts` key at all (not `[]`).
17. A document with custom emoji round-trips `display_parts` unchanged through the schema.

**E — SSE/API JSON payload fidelity** (`JSON.parse(JSON.stringify(...))` round trip)
18. Payload preserves `display_parts` for a message with custom emoji.
19. Payload omits `display_parts` entirely for a plain message.

Result in this repo: **19/19 passed.**

### 9b. Frontend — `frontend/.../liveChatEmoji.test.js`

Convention: CRA/Jest (`craco test`), real DOM via `react-dom/client createRoot` +
`react-dom/test-utils act` — no `@testing-library/react` dependency (not present in this
repo; avoided adding it purely for this feature). Imports ONLY from `liveChatEmoji.jsx`,
never from the full tab component, specifically so the test doesn't transitively import the
app's API client (in this repo, doing so hits an unrelated pre-existing Jest/axios-ESM
config gap — worth checking whether the target app has the same gap before assuming this
constraint applies there too).

9 tests:
1. Plain text message renders as the raw text (unchanged from before this feature).
2. Text with Unicode emoji (no `display_parts`) renders as the raw text, emoji inline.
3. A message with no `display_parts` key at all behaves identically to an empty array.
4. Text + one custom emoji renders the text and an `<img>` for the emoji, in order.
5. Multiple custom emojis render one `<img>` each, in the original order.
6. Mixed text + Unicode emoji (inline) + custom emoji preserves order and text content.
7. Emoji-only message renders a single `<img>` with no surrounding text.
8. `CustomEmojiImage` falls back to alt text when the URL is not `https://`.
9. `CustomEmojiImage` falls back to alt text when the image fails to load (simulated via a
   dispatched `error` event on the `<img>` node).

Result in this repo: **9/9 passed.**

---

## 10. Application-specific — do NOT copy these into TGCongress verbatim

These exist in this repo's port but are either cosmetic/regional or artifacts of THIS
repo's specific constraints. Reproduce the *behavior* they represent using TGCongress's own
equivalents, not these literal values:

1. **The `liveChatEmoji.jsx` file path** (`frontend/src/components/grievances/`). This repo
   nests the YouTube Live tab under a `grievances` directory; TGCongress's component tree
   will almost certainly differ. What must be preserved is the PATTERN: a standalone,
   dependency-light sibling module next to whatever component renders the chat feed —
   not the exact path.
2. **Illustrative example strings** in `backfill_standard_emoji_text.js`'s
   `runNamedTestCases()` (`"jai TDP :smiling_face_with_hearts:..."`, `"CBN garu..."`) —
   these are just sample inputs for a pure-function sanity check and carry no behavioral
   meaning. Replace with neutral or TGCongress-domain-appropriate strings; the assertions
   themselves (known shortcode → character, unknown shortcode left alone) are what matters.
3. **The `Accept-Language` locale value** (`en-IN,en;q=0.9,te;q=0.8`) used in
   `backfill_custom_emoji_display_parts.js`'s own request headers — `te` is Telugu, matching
   this app's Andhra Pradesh focus and its existing `youtubeLiveChatReader.js` convention.
   Match whatever locale the target app's own reader already uses for the same reason (a
   served page consistent with the deployment's actual audience).
4. **Anything about political entities, sentiment lexicons, party alignment, or the LLM
   prompt.** None of that was touched by this feature (confirmed via diff — zero lines
   changed in `liveChatBatchAnalyzer.js`, `politicalContextService`, or any config file
   defining entities/parties). Do not let a KKSaga or TDP diff that happens to sit near this
   feature (see §11) leak political-domain content into TGCongress.
5. **The two unrelated dependency bumps** (`@tensorflow-models/toxicity`,
   `@xenova/transformers`, `exceljs` version changes) that happened to be sitting
   uncommitted in this repo's `package.json` at the same time as this work — confirmed
   via audit to be pre-existing and unrelated. Only `emoji-datasource` and
   `unicode-emoji-json` (§8) belong to this feature.

---

## 11. Intentional differences from the original KKSaga implementation

The KKSaga PR that introduced this feature (`BluraSagaKK` PR #20) bundled it into the SAME
commit as porting the entire YouTube Live Monitor feature, plus several unrelated changes.
This TDP port deliberately diverges from that PR in the following ways:

1. **Extracted the renderer into its own module** (`liveChatEmoji.jsx`). KKSaga defines
   `CustomEmojiImage`/`renderMessageBody` inline inside its (large) tab component. TDP split
   them out for two reasons: (a) testability — importing the full tab component pulls in the
   app's API client, which broke this repo's Jest config for unrelated reasons; (b) exactly
   the goal stated for this document — a dependency-light module is what should be handed to
   TGCongress, not a slice of a monolithic component. **This is the one structural deviation
   TGCongress should also adopt**, adapted to its own file layout.
2. **Did not port unrelated changes bundled in the same KKSaga commit**, specifically:
   error-handling refactors in `listLiveVideos`/`resolveLiveVideo` (throwing vs. returning
   empty/null on a challenge page), a Tamil/DMK-specific sentiment lexicon and LLM prompt
   rewrite, `React.memo` on the message row component, an `ended_at`-null-vs-set logic
   tweak, and general comment rewording. These are legitimate KKSaga-specific improvements
   but are not part of the emoji feature and must not be conflated with it in TGCongress
   either.
3. **Added a full regression suite in both stacks** (§9). KKSaga shipped no formal test
   suite for this feature — only the three inline `runNamedTestCases()` assertions inside
   `backfill_standard_emoji_text.js`. TDP added 19 backend + 9 frontend deterministic tests
   covering the full contract in §0. TGCongress should port (and adapt) these test suites,
   not just the feature code.
4. **Verified, not assumed, that no routes/API/model-adjacent files needed changes.** This
   was confirmed by diffing KKSaga's routes/`index.js`/`LiveStream` model against TDP's
   equivalents and finding zero emoji-related lines in any of them — stated here as a
   positive fact for TGCongress to also verify (its own routes/index.js layer should need
   zero emoji-specific changes), not merely copy on faith.
