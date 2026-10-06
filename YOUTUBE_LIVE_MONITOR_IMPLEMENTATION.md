# YouTube Live Chat Monitor — Implementation Spec

A portable specification of the YouTube Live monitoring feature, written so it can be rebuilt in
another application.

**What it does:** track any YouTube channel by handle. When it goes live, read its live chat in real
time, score every comment for sentiment, and stream the result to a dashboard — with no YouTube Data
API key and no quota.

| | |
|---|---|
| Backend | Node · Express · Mongoose |
| Frontend | React + Server-Sent Events |
| New files | 10 |
| Collections | 3 |
| YouTube API quota | None |
| Video playback | Not included — chat and analysis only |

---

## 1. Overview

An operator pastes a channel handle, URL, or ID. A background watcher checks each tracked channel on
an interval; when one is broadcasting, a per-stream poller opens that broadcast's live chat and reads
it continuously. Every message is stored, scored for sentiment, and pushed to the browser over
Server-Sent Events as viewers type.

The dashboard shows a channel list, a live chat feed with filters, and a sentiment/participants
panel.

### Why there is no API key

YouTube's own web player does not use the public Data API — it calls a private JSON service called
**InnerTube**. This feature impersonates the web client and calls the same endpoints, which is what
makes it quota-free.

The official `liveChatMessages.list` would burn roughly 720 quota units per hour per stream against a
10,000/day budget, so it is not viable for continuous monitoring.

**The tradeoff:** InnerTube is undocumented and unsupported. If YouTube changes its page or payload
shape, the reader breaks until the parsing is updated. Budget for that maintenance.

---

## 2. How the data flows

```
WATCHER            SESSION             POLLER              PERSIST             DELIVER
Is it live?   →    Open the chat  →    Read a chunk   →    Store & score  →    Push to UI
every 3 min        scrape key +        POST cursor,        bulk insert,        event bus →
per channel        continuation        get messages        dedupe, score       SSE → browser
                                            ↑                   |
                                            └───── loop on the cursor ─────┘
```

- Wait between reads = `max(YouTube's hint, channel floor)`, clamped to 2–15s
- 5 consecutive errors ends the stream
- The continuation token is a **cursor**, so polling slower never loses messages — it just returns
  more of them per read

### The two-tier sentiment path

Every message gets a **synchronous keyword verdict on insert** so the feed is never blank. Only
messages mentioning a known political entity are queued for the **language model**, which scores them
in batches and overwrites the placeholder.

Batching is the point: one call per message cannot keep pace with chat, so a keyword guess would
survive as the final answer.

Labels are `positive` / `moderate` / `negative`, stored on two axes:
- `tone` — raw emotional register
- `sentiment` — flipped onto the party axis (attacking a rival is favourable; praising them is not)

> **Prompt design worth copying**
>
> The model is **never asked for the final verdict**. It reports only two observations — `about`
> (which camp) and `tone` (praise / attack / neutral) — and the pro/anti inversion is computed in
> code.
>
> Asking for the verdict directly produced self-contradictions on real chat: "abuses Jagan" came back
> labelled anti-TDP. Models are reliable at *perception* and unreliable at *inversion*, so the
> inversion lives where it is deterministic.

---

## 3. Files to create

| Path | Role | Lines |
|---|---|---|
| `models/LiveStream.js` | Tracked channel + current broadcast state | 81 |
| `models/LiveChatMessage.js` | One chat comment + its analysis | 78 |
| `models/YouTubeLiveSettings.js` | Single-doc settings (watch interval) | 25 |
| `services/youtubeLiveChatReader.js` | InnerTube client — the only YouTube-facing code | 279 |
| `services/youtubeLiveService.js` | Watcher, pollers, sentiment, event bus | 704 |
| `services/liveChatBatchAnalyzer.js` | Batched LLM scoring + prompt | 175 |
| `routes/youtubeLiveRoutes.js` | REST + SSE endpoint | 342 |
| `components/YouTubeLiveTab.jsx` | The entire dashboard UI | 763 |
| `scripts/rescore_live_chat.js` | Re-score stored chat after a prompt change | 183 |
| `scripts/backfill_live_chat_sentiment.js` | Backfill analysis on existing rows | 84 |

**Dependencies** are ones most Express apps already have: `axios`, `mongoose`, `uuid`, `express`,
`jsonwebtoken`. No YouTube library and no InnerTube package — the reader is hand-written against the
raw endpoints.

---

## 4. The InnerTube reader

This is the part to port most carefully — everything else is ordinary application code.

| Function | Does |
|---|---|
| `normalizeChannelRef(ref)` | Accepts `@handle`, `UC…`, or any youtube.com URL → a canonical reference |
| `resolveLiveVideo(ref)` | GETs `youtube.com/{ref}/live`. Returns video id, title, channel id/name, thumbnail — or `null` when not live |
| `getChatContext(videoId)` | GETs the popout chat page, extracts `INNERTUBE_API_KEY`, client version, continuation tokens |
| `fetchChunk(ctx, cont)` | POSTs to `/youtubei/v1/live_chat/get_live_chat`. Returns messages, next cursor, wait hint, `ended` flag |
| `pickLiveContinuation(ctx)` | Probes candidate tokens and keeps whichever actually yields messages |

All requests spoof a desktop browser User-Agent.

### Two traps that cost real debugging time

**Pick "Live chat", not "Top chat".** The chat page ships two continuation tokens. The default is
YouTube's filtered "Top chat", which silently drops most messages — one token returned nothing while
the other returned the full firehose. That is what `pickLiveContinuation` exists to solve.

**A channel page is not proof of a live stream.** Requesting `/live` on an idle channel serves the
ordinary channel page rather than 404ing, so the **live flag in the HTML** — not the response status —
is what decides.

### Message parsing

Each response contains actions; the ones that matter carry a chat item. Handle three renderer types —
plain text, paid message, paid sticker — and ignore the rest. YouTube injects its own system notices
(such as the "Welcome to live chat" banner) as actions too.

Text arrives as an **array of runs** mixing strings and emoji objects, so join them rather than
reading a single field. Author badges yield moderator / member / owner flags. Timestamps are in
microseconds.

Normalized output per message:

```js
{
  message_id, author_channel_id, author_name, author_photo,
  text, published_at,
  is_superchat, superchat_amount,
  is_moderator, is_member, is_owner, badges
}
```

---

## 5. Watcher and poller

### Watcher — one per process

On an interval, load every channel with `is_active: true` and check each.

- If live and the video id **differs** from the stored one → new broadcast: reset cursor and counters
  before starting a poller
- If no longer live → mark ended
- A re-entrancy guard prevents overlapping ticks

### Poller — one per live stream

Each poller owns a `setTimeout` loop keyed by stream id, held in a module-level map so it can be
stopped on pause or delete. Per tick: fetch a chunk, persist messages, save the cursor, schedule the
next tick.

- **Respect the server's wait hint**, clamped to 2–15s, with the channel's own minimum as a floor
- **Persist the cursor every tick** so a restart resumes mid-stream instead of replaying or losing chat
- **Back off on errors** — after 5 consecutive failures, end the stream with the error recorded
- **No cursor returned means the broadcast ended** — stop cleanly

### Persisting a chunk

Insert with `ordered: false` and let a **unique index on the YouTube message id** absorb duplicates —
chunks overlap on reconnect, and this avoids a lookup per message.

Only rows that actually inserted should increment counters or be emitted, so a partial-failure result
has to be read carefully rather than assumed empty.

---

## 6. API surface

All paths relative to the router mount (e.g. `/api/youtube-live`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/stream` | SSE feed — messages, updates, status |
| GET | `/channels` | List tracked channels + runtime stats |
| POST | `/channels` | Add a channel; starts reading if already live |
| PATCH | `/channels/:id` | Pause/resume, alignment, poll interval |
| DELETE | `/channels/:id` | Remove channel and its stored messages |
| POST | `/channels/:id/refresh` | Check one channel now |
| POST | `/refresh-all` | Run a watcher pass immediately |
| GET | `/messages` | Paged history; filter by stream, sentiment, search, political |
| GET | `/stats` | Sentiment totals and live stream count |
| GET | `/top-authors` | Most active chatters with their negative share |
| GET | `/settings` | Current watch interval + runtime counters |
| PUT | `/settings` | Change watch interval, effective immediately |

### SSE auth — mount order matters

`EventSource` cannot send an `Authorization` header, so the stream route authenticates from a
`?token=` query parameter and **must be declared before the router-level auth middleware**. Verify it
with the same secret your normal middleware uses.

- Send `X-Accel-Buffering: no` so nginx does not buffer the stream
- Write a comment line every ~25s to stop intermediaries closing an idle connection
- **Detach every bus listener on client disconnect** or you leak one set per page load

### Events emitted

| Event | When |
|---|---|
| `messages` | New chat arrived — array, with placeholder sentiment |
| `message:update` | The model refined one message; patch it in place |
| `stream:status` | A stream went live, ended, or errored |

---

## 7. Data model

### LiveStream — one per tracked channel

| Field | Notes |
|---|---|
| `channel_ref` | **Unique.** The handle/ID as entered, normalized |
| `channel_id` / `channel_name` | Resolved on first successful live check |
| `is_active` | Watch this channel? Pause without deleting |
| `alignment` | `ally` / `opposition` / `neutral` / `unknown` — fed to the model as context |
| `poll_interval_sec` | 0 = follow YouTube's pace; higher caps request volume |
| `video_id` / `video_title` / `thumbnail` | The broadcast being read |
| `status` | `idle` / `live` / `ended` / `error` |
| `continuation` | Cursor — enables resume after restart |
| `message_count`, `sentiment_counts` | Denormalized totals for the UI |
| `started_at`, `ended_at`, `last_polled_at` | Timestamps |

### LiveChatMessage — one per comment

| Field | Notes |
|---|---|
| `message_id` | **Unique** — YouTube's id, the dedupe key |
| `stream_id` / `video_id` | Indexed for feed queries |
| `author_*`, `is_moderator` / `is_member` / `is_owner` | Rendered as badges |
| `text`, `is_superchat`, `superchat_amount` | Content |
| `sentiment` | Party-axis label, indexed |
| `tone` | Raw emotional register, kept separate |
| `stance`, `target_entity`, `analysis_reason` | Model output |
| `is_political` | Indexed — **the gate deciding what reaches the model** |
| `analysis_provider` | `lexicon` or `llm` — which tier produced the verdict |
| `published_at`, `created_at` | Indexed |

> **Bound this collection.** Live chat is a firehose — a single busy broadcast can add tens of
> thousands of rows an hour. A TTL index on the created timestamp (30 days by default) keeps it from
> growing without limit. Decide retention before launch, not after.

### YouTubeLiveSettings

Single document holding `watch_interval_sec` (30–3600). Deliberately its own collection so it cannot
affect unrelated application settings.

---

## 8. Dashboard

One React component, three columns: **channels** left, **chat feed** middle, **analytics** right.
Above them, an add-channel field and a header carrying connection status, manual refresh, and the
auto-check interval.

- **Channels** — live/offline badge, message count, per-channel pause, read-interval selector, remove
- **Feed** — avatar, name, owner/mod/member badges, superchat amount, text, sentiment chip; search
  plus sentiment and political-only filters
- **Analytics** — sentiment totals with a share bar, and top participants with their negative counts

### Live-feed details that matter

- **Cap the rendered list** (~400 rows). Chat is unbounded; the DOM is not.
- **Keep filters in a ref** for the SSE handler, or every keystroke tears down and rebuilds the
  connection.
- **Offer a freeze toggle** so an operator can read without new messages pushing the list down.
- **Patch on `message:update`** — model verdicts land a moment after insert and should update in
  place, not duplicate.
- **Dedupe on arrival** — reconnects re-deliver overlapping chunks.

---

## 9. Wiring and configuration

Two lines in your server entry point — mount the router, and start the watcher after the DB connects:

```js
app.use('/api/youtube-live', require('./routes/youtubeLiveRoutes'));

// after DB connect — never let a watcher failure block boot
try {
  await require('./services/youtubeLiveService').startWatcher();
} catch (err) {
  console.warn('[Server] YouTube Live watcher failed to start:', err.message);
}
```

The watcher delays its first pass ~20s after boot to let the DB settle.

### Environment variables

| Variable | Default | Controls |
|---|---|---|
| `YT_LIVE_WATCH_INTERVAL_MS` | 180000 | How often channels are checked for a broadcast |
| `YT_LIVE_MIN_POLL_MS` | 2000 | Fastest chat read |
| `YT_LIVE_MAX_POLL_MS` | 15000 | Slowest chat read |
| `YT_LIVE_LLM_BATCH_SIZE` | 20 | Messages per model call |
| `YT_LIVE_LLM_CONCURRENCY` | 2 | Batches in flight |
| `YT_LIVE_LLM_QUEUE_MAX` | 2000 | Queue cap before messages are dropped |
| `YT_LIVE_BATCH_TIMEOUT_MS` | 180000 | Model call ceiling — generation is slow at batch size |
| `YT_LIVE_RETENTION_DAYS` | 30 | TTL on stored messages; 0 keeps forever |

> **Verify the model path before you trust the output.**
>
> Sentiment depends on an LLM provider being genuinely reachable. When a batch call fails, the
> failure is caught and logged — the message simply keeps its keyword placeholder. A misconfigured
> provider therefore looks like working software producing poor labels, rather than an outage.
>
> After porting, query the collection and confirm rows show `analysis_provider: "llm"`. If everything
> reads `"lexicon"`, the model tier is not running — check the provider URL, model name, and
> credentials before tuning anything else.

---

## 10. Porting checklist

- **Auth and permissions** — routes assume a `protect` middleware and a page-permission check. Swap
  in your own, and keep the SSE route mounted *before* them.
- **Political entities** — the sentiment layer is tuned to one region's parties and leaders. Replace
  the entity list and the prompt's camp definitions with your own domain, or the political axis is
  meaningless.
- **Keyword lexicon** — the built-in word lists cover English, Telugu script, and romanized Telugu.
  Rebuild for your languages.
- **Single process only** — pollers and the LLM queue live in module memory. Running multiple
  instances double-reads chat and double-writes messages. Pin to one worker, or add a distributed
  lock before scaling.
- **Chat can be disabled** — many news channels turn live chat off entirely. The stream resolves as
  live but yields no messages, which is expected, not a bug. Test against a channel with active chat.
