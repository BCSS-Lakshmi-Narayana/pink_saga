# YouTube Live → Canonical TDP Analysis Engine: Integration Architecture Report

**Status:** Analysis and architecture recommendation only. No code was changed to produce this document.
**Builds on:** [PIPELINE_FORENSIC_ANALYSIS.md](PIPELINE_FORENSIC_ANALYSIS.md) (the prior end-to-end forensic trace). This document does not repeat that trace — it goes one level deeper specifically on the canonical engine's contract, its concurrency behavior, and the exact schema/UI facts needed to design this integration.
**Verification:** Every claim was checked against current source, not inferred. File:line citations given throughout.

---

## The central tension (read this first)

The canonical engine (`analysisService.analyzeContent`) is architecturally **single-item**: one call, one piece of text, up to two sequential LLM round trips (Pass A `categorizeText`, Stage 3/4 `analyzePoliticalSentiment`), no batched code path exists anywhere in it. `liveChatBatchAnalyzer.js` exists specifically **because** someone already tried the single-item-per-comment approach for YouTube Live and measured it too slow for chat volume — its own header comment documents this: only ~4 of 30 messages got scored before the next chunk arrived. Routing YouTube Live through the canonical engine, exactly as required, means giving up batching for the actual LLM verdict and re-accepting that original throughput ceiling — there is no way to satisfy "same canonical logic, no separate YouTube prompts" and "batch multiple comments into one LLM call" at the same time, because batching *is* a different prompt/parsing implementation, which is precisely the duplication this integration is meant to eliminate. This report resolves the tension the way §9 of the request prioritizes it — **correctness over throughput** — and proposes concurrency (many independent single-item calls in flight at once) rather than batching (one call covering many items) as the throughput lever. The quantitative and mitigating factors are laid out in §J.

---

## A. Existing Grievance/Post Analysis — exact end-to-end function flow

```
Grievance ingestion (any of 4 paths)
   ↓
grievanceService.createGrievanceFromPost()          [grievanceService.js:1705]
   ↓
Grievance.save()                                     (content persisted first)
   ↓
grievanceService.analyzeGrievanceContent(id, text, platform)   [grievanceService.js:335]
   ↓
analysisService.analyzeContent(analysisText, {
   platform: platform || 'x',
   skipForensics: true,
   taggedKeyword: grievanceCtx?.tagged_account || '',
   authorHandle: grievanceCtx?.posted_by?.handle || ''
})                                                    [grievanceService.js:370-375]
   ↓  (returns a plain object — see §C for exact shape)
grievanceService.buildGrievanceAnalysisUpdate(analysisData)     [grievanceService.js:262-333]
   ↓  (pure field-mapping function, no side effects)
Grievance.findOneAndUpdate({id}, {$set: update})      [grievanceService.js:382]
```

This is the reference pattern: **ingest → persist raw → call canonical engine → map result via a dedicated builder function → `$set`-update the record.** `analyzeGrievanceContent` never inlines any sentiment/stance/risk logic itself — it is a thin caller plus a thin mapper.

## B. Existing YouTube Live Flow — exact end-to-end function flow

Already fully traced in [PIPELINE_FORENSIC_ANALYSIS.md §2.1](PIPELINE_FORENSIC_ANALYSIS.md#21-youtube-live--full-chain-the-pipeline-the-task-asked-to-trace-in-most-depth). Summary of the two things that must change:

1. **`analyzeFast()` (`youtubeLiveService.js:821-850`)** computes a synchronous lexicon-only sentiment/tone (`lexiconSentimentFromTokens`, `toTdpAxis`) that is displayed to the UI **immediately, as if it were a real verdict**, then silently overwritten later. This is exactly the "incomplete analysis presented as final" pattern §6 of the request forbids.
2. **`liveChatBatchAnalyzer.analyzeBatch()` + `enforceBatchConsistency()`** (`liveChatBatchAnalyzer.js`, `youtubeLiveService.js:296-332`) is a second, independent sentiment/stance implementation — different prompt, different enums (`about`/`tone` → `deriveStance`), different provider-call site — that must be retired in favor of the canonical engine.

`isChatRelevant()` (`youtubeLiveService.js:727-815`) is **not** in this list — see §D for why it should stay.

## C. Canonical Analysis Engine — exact reusable contract

**Entry point:** `analysisService.analyzeContent(text, options)` — `services/analysisService.js:185`.

### Input (`options`, all optional, no required fields)

| Field | Effect | YouTube Live should pass |
|---|---|---|
| `platform` | Free-text label, interpolated into the Stage-3 prompt (`"Platform: ${ctx.platform}"`, `politicalSentimentService.js:172`). **Never validated against the `Content.platform` enum, never branches logic.** Confirmed safe to pass a value outside that enum. | `'youtube_live'` |
| `skipForensics` | If falsy AND `content`/`analysisId` are both present, triggers a deepfake-detection side call. | `true` (comments are pure text, exactly like Grievance's own `skipForensics: true`) |
| `content`, `analysisId` | Only used for forensics when `skipForensics` is false. | omit |
| `taggedKeyword` | Feeds `computeTargetRelevance` in the deterministic Stage-2 context builder. | omit (no keyword-search concept for live chat) |
| `authorHandle` | Resolved against the political figure roster for author-is-target correction. | omit (a chat commenter is not a tracked political account) |
| `country` | Legal-section mapping only (BNS 2023 vs international). Irrelevant to sentiment/stance/risk. | omit (defaults `'IN'`) |

**Conclusion: the call YouTube Live needs is functionally identical to Grievance's own call** — `analyzeContent(text, {platform:'youtube_live', skipForensics:true})`.

### Output — exact shape (quoted from `analysisService.js:406-521`)

The fields that matter for this integration (full list in the research transcript, condensed here):

- `sentiment` — **this is the client-relative, canonical field** (`= political.target_sentiment || 'moderate'`), one of `positive | negative | moderate`. This is what should populate the UI's Positive/Moderate/Negative chip — not `generic_sentiment` (whole-post raw tone) and not Pass A's own `llmResult.sentiment` (computed but **not** used as the final sentiment anywhere).
- `stance` / `political_stance` — one of `ALLOWED_STANCES` (`politicalSentimentService.js:50-53`): `pro_target | anti_target | pro_target_indirect | anti_target_indirect | neutral | unrelated`. **Six values, not the two ("Pro Client"/"Anti Client") the UI needs** — see §I for the display-mapping recommendation; the important point is the *stored* value must stay the full canonical enum, only the *chip label* collapses it.
- `risk_level` / `risk_score` — derived **entirely** from `political.target_sentiment` (`negative→high/75`, `positive→low/20`, `moderate→medium/50`, `analysisService.js:376-390`). Pass A's own risk fields are computed and then fully discarded. This is the one and only source of truth for risk — no separate risk calculation should exist on the YouTube side.
- `needs_review` (boolean) + `review_reason` (comma-joined reason codes) + `validation` (object with `.reasons[]`/`.warnings[]`) — the formal "is this result trustworthy" signal, from `buildQualityGate` (`analysisService.js:64-126`). Reason codes: `low_confidence`, `uncertain_client_relevance`, `stage3_low_confidence`, `client_sentiment_conflict`, `llm_fallback`.
- `confidence` — `{relevance, sentiment, stance, topic, emotion, classification, overall}`, all 0–1.
- `political_provider` — `'llm' | 'fallback'`. `'fallback'` means Stage 3/4's LLM call failed/timed out and a deterministic heuristic (`heuristicFallback`, `politicalSentimentService.js:281-330`) substituted — **not a crash, a documented degraded mode that always sets `needs_review: true`.**
- `explanation`, `political_reasoning`, `narrative_direction`, `llm_analysis` (a nested object mirroring most of the above, kept for backward compatibility with older consumers) — feed the "eye icon" detail view.
- `category`, `grievance_type`, `topic` — not meaningful for a raw chat comment (no civic-department/legal-category concept applies), but harmless to store; they'll mostly land on `'Normal'`/`null` defaults since Pass A's category prompt isn't tuned for chat one-liners. **This is expected, not a bug** — these fields exist because the same function serves Grievances, which do need them.

### Failure/validity semantics — the answer to §6's "no fallback" requirement

`analyzeContent` **never throws** — it always resolves. There are exactly three outcome shapes:

1. **Normal / LLM-degraded-but-valid** (the overwhelming majority of calls, including full LLM-provider outage): a fully-shaped result as above. Even when both Ollama and RapidAPI are down, Stage 3/4 falls back to `heuristicFallback()`, which returns a **deterministic, non-arbitrary** stance/sentiment derived from the same entity/context scan used everywhere else in the app, explicitly stamped `political_provider:'fallback'` and `needs_review:true`. **This is not a fabricated value** — it's the same graceful-degradation path Grievances and Content already accept as "analyzed, low confidence," and the existing UI vocabulary (`needs_review` badges, already used in `ReasonModal`/`GrievanceAnalysisModal`) exists precisely to surface this state honestly.
2. **Empty/whitespace input**: returns a stripped 6-key object (`risk_level:'low', risk_score:0, explanation, violated_policies:[], legal_sections:[], triggered_keywords:[]`) — `sentiment`/`stance`/`needs_review` **keys do not exist on the object at all**. Not applicable to live chat (the relevance pre-filter guarantees non-empty text before this is ever called).
3. **Catastrophic top-level exception** (something *outside* Pass A/Stage 3/4's own internal try/catches, e.g. `mappingService` throwing synchronously): same stripped 6-key shape as #2.

**Design rule for the adapter**: check for the *presence* of `result.stance` (or `result.needs_review !== undefined`) to distinguish outcome #1 (real, persistable result — even if `needs_review:true`) from #2/#3 (genuine failure — no verdict exists, must not be displayed as one). This one check is the entire "no fallback / no wrong mapping" enforcement point.

### Two existing reference mappings (confirms this is a proven, repeatable pattern)

- **Grievance**: `buildGrievanceAnalysisUpdate()` (`grievanceService.js:262-333`) — flattens ~40 canonical fields onto `analysis.*` paths via a single `$set` object. This is the direct template for a new `buildLiveChatAnalysisUpdate()`.
- **Content/Analysis**: `monitorService.performFullAnalysis`'s inline mapping (`monitorService.js:1842-1879, 1916-1927`) — a thinner mapping that notably **drops** `target_sentiment`/`stance`/`needs_review`/`client_relevance` entirely, burying them inside the opaque `llm_analysis` blob. This is a known gap in that mapping, not a pattern to copy — the Grievance mapping is the one to follow because it actually surfaces stance/risk/confidence as first-class, queryable fields, which is exactly what the eye-icon requirement needs.

## D. Integration Point — exactly where YouTube should call the canonical analysis

**Do not call `analyzeGrievanceContent()`.** It is Grievance-specific (writes to the `Grievance` collection, expects a `grievanceCtx` shape, handles video-transcript concatenation that doesn't apply here). Call **`analysisService.analyzeContent()` directly** — the same function Grievance calls, one layer lower than the Grievance-specific wrapper. This is the "thin adapter" the request anticipates: a new, small function (naming suggestion only, not prescribing implementation) that:

1. Takes a `LiveChatMessage` candidate (text + light context).
2. Calls `analyzeContent(text, {platform:'youtube_live', skipForensics:true})` — nothing else.
3. Maps the result onto `LiveChatMessage` fields via a new `buildLiveChatAnalysisUpdate()`, structurally parallel to `buildGrievanceAnalysisUpdate()`.
4. Contains **zero** sentiment/stance/risk/political logic itself — only field mapping and the outcome-shape check from §C.

**What stays YouTube-specific (ingestion concerns, not analysis concerns):**
- `youtubeLiveChatReader.js` — InnerTube polling, unchanged.
- `isChatRelevant()` (`youtubeLiveService.js:727-815`) — **stays**, repurposed as a pre-canonical-engine cost gate (see below). It is not in the request's §13 duplication list (sentiment, stance, risk, political analysis, prompts, LLM calls, result mapping) — relevance-for-cost-control is a distinct concern from client-relative political analysis, and the canonical engine has no equivalent cheap pre-filter of its own (Grievances/Content are always fully analyzed once ingested; there is no ingestion-time relevance reject in the general pipeline).
- The controlled-concurrency queue feeding the adapter (§J).
- SSE emission and persistence timing (§H).

**Why keep `isChatRelevant()`:** the canonical engine's own Stage 3/4 output already includes a `client_relevance` field (`relevant|not_relevant|uncertain`) — but producing it costs up to 2 LLM calls. Running that on every single incoming chat message, including pure emoji spam and off-topic banter, would multiply LLM load far beyond even the "worst case" numbers in §J. `isChatRelevant()` costs zero I/O and already filters this correctly today. Recommendation: keep it exactly as-is as the ingestion gate; do **not** let it compute or display a placeholder sentiment (see §I) — its only job becomes "is this worth spending canonical-engine budget on."

## E. Input/Output Mapping — YouTube comment → canonical input → canonical result → LiveChatMessage

```
LiveChatMessage.text (already persisted, is_political=true, analysis_status='pending')
        ↓
analyzeContent(text, {platform:'youtube_live', skipForensics:true})
        ↓
result.sentiment            → LiveChatMessage.sentiment            (positive|negative|moderate)
result.stance                → LiveChatMessage.stance               (full 6-value canonical enum, stored raw)
result.risk_level            → LiveChatMessage.risk_level           (low|medium|high)
result.needs_review          → LiveChatMessage.needs_review
result.review_reason         → LiveChatMessage.review_reason
result.confidence.overall    → LiveChatMessage.confidence
result.political_provider    → LiveChatMessage.analysis_provider    ('llm' | 'fallback' — replaces the old 'lexicon'|'llm')
result.target_entity         → LiveChatMessage.target_entity
result.mentioned_entities    → LiveChatMessage.matched_entities
result (whole object)        → LiveChatMessage.analysis_details     (Mixed — full canonical payload, for the eye-icon modal)
        ↓
LiveChatMessage.analysis_status = 'complete' (or 'failed' if outcome #2/#3 from §C)
LiveChatMessage.analysis_completed_at = now
```

`analysis_reason` (existing field, currently populated by the old batch analyzer's `reason`) maps to `result.explanation` or `result.political_reasoning`.

## F. Duplicate Logic to Remove / Replace (identified, not yet removed)

| Current YouTube-specific implementation | Canonical equivalent | Verdict |
|---|---|---|
| `lexiconSentimentFromTokens()` + `toTdpAxis()` (`youtubeLiveService.js:103-129, 270-286`) | `analyzeContent().sentiment` (client-relative) | Remove once the "instant placeholder" UI behavior is removed (§I) — nothing else depends on their sentiment *output* (they're independent of `isChatRelevant`'s tokenizing). |
| `liveChatBatchAnalyzer.js` (whole file: `buildPrompt`, `analyzeBatch`, `deriveStance`, `coerce`) | `analyzeContent()` end-to-end (Pass A + Stage 3/4 + `stanceEngine` + `confidenceGate`) | Remove — this is the second sentiment/stance implementation the request explicitly targets. |
| `enforceBatchConsistency()` (`youtubeLiveService.js:296-332`) | `stanceEngine.computeStance()` (already applies the equivalent "single-camp-named → tone determines stance" correction as part of the canonical Stage 4 matrix) | Remove — its entire purpose (correcting the model's stance judgment) is already the canonical engine's job. |
| `SENTIMENT_TO_RISK` static lookup (`youtubeLiveService.js:257`) | `analyzeContent()`'s risk derivation from `political.target_sentiment` | Remove — risk now arrives already computed. |
| `enqueueLlm`/`drainLlmQueue`/`llmQueue`/`runBatch` (`youtubeLiveService.js:150-253`) | Replaced by a new controlled-concurrency queue driving single-item adapter calls (§J) | Replace, not delete outright — the *shape* of "queue + bounded concurrency" is still needed, just re-tuned for single-item semantics. |
| `resyncStreamCounts()`'s sentiment aggregation (`youtubeLiveService.js:858-891`) | Unaffected in principle (still counts by `sentiment` field), but must be re-verified once `sentiment` is populated asynchronously rather than immediately at insert | Keep, re-verify against the new timing (a message counts only once its `sentiment` is set, i.e. once `analysis_status='complete'`). |
| `scripts/rescore_live_chat.js`, `scripts/backfill_live_chat_sentiment.js` | Would need to call the new adapter instead of `analyzeFast`/`analyzeBatch` | Update or retire — decide at implementation time. |

**Not duplicated / correctly kept as-is:** `youtubeLiveChatReader.js` (ingestion), `isChatRelevant()` (relevance/cost gate — see §D), the SSE bus/heartbeat mechanism, the per-stream poller.

## G. Database Changes (fields/schema/index considerations — not yet applied)

Current `LiveChatMessage` schema (`models/LiveChatMessage.js:11-85`) has **no pending/analyzing/complete concept at all**. The closest existing field, `analysis_provider`, is confirmed **write-only** — grep found zero reads of it anywhere in backend or frontend. It cannot be repurposed as a status field without also adding actual read-side logic, so a dedicated status field is needed regardless.

**The precedent to mirror already exists in this codebase** — `Grievance.analysis.analyzed_at` (Date, `null` until scored) plus `analysis.needs_review`/`validation_status`/`review_reason` (`models/Grievance.js:334, 362-364`), and the identical pattern again on `NewsArticle.pipeline_analyzed_at`. This is a repeated house convention, not something to invent from scratch.

Fields to add (additive, non-breaking):
- `analysis_status`: `String`, enum `['pending', 'analyzing', 'complete', 'failed']`, default `'pending'`, indexed — this is the field the new queue worker claims atomically against (see §K) and the field the frontend branches its render on.
- `analysis_started_at`: `Date`
- `analysis_completed_at`: `Date` (mirrors `Grievance.analysis.analyzed_at` semantics — "presence = analysis has run")
- `needs_review`: `Boolean`, default `false`
- `review_reason`: `String`, default `''`
- `confidence`: `Number`, default `null`
- `analysis_details`: `Mixed` — stores the **entire raw canonical result object**. This is the field that makes §L's future-proofing guarantee hold at the persistence layer too: if a future dev adds a new field to `analyzeContent`'s output, it lands in `analysis_details` automatically with no migration, exactly how `Alert.llm_analysis`/`ml_analysis` (`Mixed`) already work in this codebase for the same reason.
- `retry_count`: `Number`, default `0` (for §K's bounded-retry policy)

Fields to reconsider/tighten (decide at implementation time, not now): `stance` currently has no enforced enum — should become `enum: ALLOWED_STANCES` (the 6 canonical values) once populated from the canonical engine. `sentiment_score` and `tone` (raw pre-TDP-axis tone) become vestigial once the lexicon path is removed — likely candidates for deprecation, not deletion, pending confirmation nothing else reads them.

Index: add `{ analysis_status: 1, created_at: 1 }` to support the queue worker's "find pending items" scan — the same shape as `TempContent`'s existing `{tenant_name:1, status:1, created_at:1}` index, another already-proven pattern in this codebase.

## H. SSE Changes

Current behavior (confirmed): both `'messages'` and `'message:update'` events serialize the **entire raw document** with no field allowlist, including Mongo-internal `_id`/`__v` (neither `.lean()` nor a schema `toJSON` transform strips them today — a pre-existing hygiene gap, worth fixing while this code is being touched regardless of this integration).

Proposed event semantics (structure, not code):

- **`'messages'` (fires once, at ingest)**: comment persisted and emitted with `analysis_status:'pending'` (or `'analyzing'` if the queue picks it up synchronously enough) and no `sentiment`/`stance`/`risk_level`/`analysis_details` — because at this point none exist. This event is naturally lightweight already; no change needed to its payload size, just to what's *in* the document at the time it fires.
- **`'message:update'` (fires once per message, when the canonical adapter finishes)**: carries the completed document, including the full `analysis_details` blob. Because this event fires exactly once per analyzed message (not on a polling cadence), shipping the full analysis payload here is consistent with how Grievance's list endpoint already ships full `analysis.*` inline (the eye icon opens a modal from already-loaded data, no extra fetch) — no new REST endpoint is required for the detail view.
- On a failure outcome (§C outcome #2/#3), emit `'message:update'` with `analysis_status:'failed'` and **no** sentiment/stance/risk fields — the frontend must render a distinct "analysis unavailable" state, never a guessed chip.
- The frontend's existing `'message:update'` handler (`YouTubeLiveTab.jsx`) already patches a message in place by `message_id`/`id` — this behavior is reused as-is, no new SSE event type needed.

## I. Frontend Changes

Current state (confirmed): `MessageRow` (`YouTubeLiveTab.jsx:52-108`) renders identically regardless of analysis state — no loading indicator exists per-message today, and `stance` is tooltip-only, never a visible chip. The app already has a full, reusable "eye icon → detail modal" pattern (`AlertCards.jsx` → `ReasonModal.jsx`; `GrievanceCard.jsx` → `GrievanceAnalysisModal.jsx`), both showing: risk level + score, sentiment, stance/needs-review badge, category/topic + reasoning, a collapsible LLM-reasoning block, and a link back to source.

Recommended changes:
- **`analysis_status === 'pending' | 'analyzing'`**: comment text renders immediately (unchanged — ingestion is decoupled from analysis); no sentiment/stance/risk chip; a small muted "⏳ Analyzing…" label in place of the chip row. Eye icon absent or disabled.
- **`analysis_status === 'complete'`**: sentiment chip (unchanged 3-way scheme, now canonical-sourced), a new stance indicator, risk indicator, and an **enabled** eye icon opening a new `LiveChatAnalysisModal` modeled directly on `GrievanceAnalysisModal`/`ReasonModal` for visual consistency with the rest of the app, populated from `analysis_details` already present in local state (no extra fetch, per §H).
- **`analysis_status === 'failed'`**: comment text only, a distinct (non-alarming, non-chip) "analysis unavailable" indicator, no eye icon. Never falls back to showing a chip.
- **Stance display mapping** (presentation only — the stored value stays the full 6-value canonical enum): `pro_target`/`pro_target_indirect` → "Pro Client"; `anti_target`/`anti_target_indirect` → "Anti Client"; `neutral`/`unrelated` → a neutral label (or no stance chip at all, since `unrelated` shouldn't occur once `isChatRelevant()` has already gated the message as political — worth confirming during implementation whether `unrelated` can still occur for a message that passed the relevance gate but that Stage 3/4 assessed as not-actually-about-any-tracked-entity). This collapse is a UI label choice, not a re-derivation of the underlying analysis, so it does not violate §6.
- If `needs_review: true`, mirror the existing subtle "needs review" badge convention already used in `ReasonModal`, rather than hiding or altering the sentiment/stance shown — consistent with how the rest of the app already treats a flagged-but-valid verdict.

## J. Performance Architecture

**The honest baseline, stated in numbers:** today, one LLM call covers up to 20 comments (`liveChatBatchAnalyzer`, batch size 20). Under this integration, one comment costs up to 2 sequential LLM calls (Pass A + Stage 3/4). That is roughly a **40x increase in LLM-call volume per analyzed comment**, not a rounding error — this is the direct, unavoidable cost of eliminating the second implementation, and needs to be sized against the shared Ollama host's real capacity before rollout, not assumed away.

**Confirmed concurrency-safety** (full detail in the research transcript): `analyzeContent` has no shared mutable state on its hot path (the one lock, `forensicLock`, never engages for `skipForensics:true` calls), so it can safely be invoked by many concurrent workers without cross-talk or corruption. **But nothing below it enforces any concurrency cap** — `llmProvider.js` → `ollamaLLMService.js`/`rapidApiLLMService.js` issue bare, unpooled `axios.post` calls with no limiter at any layer. Today's YouTube Live code compensates for this gap itself (`LLM_CONCURRENCY=2` around the batched call) precisely because nothing lower in the stack does — that same responsibility now falls on whatever replaces it, sized for single-item calls rather than 20-item batches (the old `=2` figure is not a valid reference point for the new call shape).

**Mitigating factors, some of them new benefits of this integration, not just costs:**
1. **The canonical engine's text-hash cache is a net new win for YouTube Live** — `analysisService.js`'s SHA-256-keyed, 7-day-TTL cache (`analysisService.js:18-27, 202-211`) is *shared across the whole app*, and today's YouTube Live path has **no cache at all**. Live chat is unusually repetitive (copypasta, brigading, "TDP TDP TDP" spam) — identical or near-identical repeated text costs one LLM round trip total, not one per occurrence, which meaningfully offsets the per-comment multiplier above for exactly the kind of traffic that makes chat volume high in the first place.
2. **`isChatRelevant()` staying in place** (§D) means only messages already assessed as politically relevant ever reach the canonical engine — the multiplier applies to a filtered subset of chat volume, not the raw firehose.
3. **A controlled-concurrency queue in front of the adapter** (structurally the same shape as today's `enqueueLlm`/`drainLlmQueue`, re-tuned) bounds how many single-item `analyzeContent` calls are in flight at once, protecting the shared Ollama host from an unbounded burst even though nothing forces that bound at a lower layer.
4. **Backpressure over silent loss**: today's queue silently and permanently drops messages once `LLM_QUEUE_MAX` (2000) is exceeded. Given §6's "no fallback, no manufactured completeness" principle, the replacement should prefer explicit, visible backpressure (comments still display immediately; their `analysis_status` simply stays `'pending'`/`'analyzing'` longer under load) over silent, permanent loss.
5. **A parallelization opportunity worth investigating at implementation time, not decided here**: Pass A (`categorizeText`) and Stage 3/4 (`analyzePoliticalSentiment`) are called sequentially in `analyzeContent`'s current code, but nothing in the research confirms whether Stage 3/4 actually depends on Pass A's output value (as opposed to just running after it in the code's textual order). If they're truly independent, running them concurrently per item could roughly halve per-item latency — this needs a direct read of the dependency, not assumed, before being relied on.

**Sizing the worker pool is an empirical question, not a number this report can responsibly assert** — it depends on real chat volume after the relevance filter, real cache-hit rate on real chat text, and the shared Ollama host's actual current headroom (noted in project memory as possibly CPU-bound rather than GPU-accelerated on that box, which would lower its ceiling further — this should be confirmed operationally, not assumed, before committing to a specific concurrency figure).

## K. Reliability

- **Retry**: `analyzeContent` itself never throws (§C) — a queue worker's "failure" case is narrow: the rare catastrophic-shape outcome, an application-level timeout wrapper (recommended, since `analyzeContent` has no caller-visible upper bound of its own beyond the two providers' individual `~45-60s` timeouts stacked sequentially), or an exception in the adapter's own DB write. On any of these, mark `analysis_status:'failed'`, increment `retry_count`, and requeue up to a small bounded limit with backoff — never substitute a guessed value.
- **Backpressure**: prefer a visibly-delayed `'pending'`/`'analyzing'` state over the current design's silent permanent drop (§J point 4).
- **Failure isolation**: a worker pool of independent single-item calls means one slow/failed comment cannot block others behind it in the way a sequential `for`-loop would — this is naturally true once batching is removed, not something extra to build.
- **Duplicate-processing prevention**: reuse the atomic-claim pattern already proven elsewhere in this exact codebase — `tempContentProcessor.js`'s `TempContent.updateOne({_id, status:'pending'}, {$set:{status:'processing'}})` claim-before-work idiom. The equivalent here: `LiveChatMessage.findOneAndUpdate({id, analysis_status:'pending'}, {$set:{analysis_status:'analyzing', analysis_started_at: now}})` before enqueuing the actual `analyzeContent` call, so a crash/restart mid-queue, or an accidental double-enqueue, cannot cause the same comment to be analyzed (and billed against the LLM) twice. `message_id`'s existing unique index already prevents duplicate *ingestion*; this claim step prevents duplicate *analysis* of the same already-ingested row.

## L. Future-Proofing — the test the architecture must pass

Walking through the request's own list, given the integration point in §D (YouTube calls `analyzeContent` directly, with a thin field-mapping adapter holding zero analysis logic of its own):

| Future change to the canonical pipeline | Does YouTube Live need a separate change? |
|---|---|
| Sentiment prompt changed | No — `categorizeText`'s prompt lives entirely inside `llmService.js`, invisible to any caller. |
| Sentiment logic/categories improved | No — same reasoning; `analyzeContent`'s return field names (`sentiment`, `target_sentiment`, etc.) are the only contract the adapter depends on. |
| Political context changed | No — `buildPoliticalContext`/`politicalSentimentService` are internal to `analyzeContent`. |
| Stance rules changed | No — `stanceEngine.computeStance()` is called internally; the adapter only reads `result.stance`. |
| Risk calculation changed | No — same reasoning; the adapter only reads `result.risk_level`/`result.risk_score`. |
| LLM model changed | No — resolved inside `llmProvider.getProvider()`, invisible above `analyzeContent`. |
| Provider changed (Ollama ↔ RapidAPI ↔ something new) | No — same reasoning. |
| Response parsing changed | No — internal to `categorizeText`/`analyzePoliticalSentiment`. |
| A bug fix lands in `analyzeContent` | No — every caller, including YouTube Live, gets it on the next call, automatically, with zero YouTube-side deployment. |
| Confidence logic changed | No — the adapter only reads `result.confidence`/`result.needs_review`. |

**The one honest exception**: if a future change *renames* a top-level output field (e.g. `target_sentiment` becomes something else), every existing consumer's mapping function needs a one-line update — including Grievance's own `buildGrievanceAnalysisUpdate`. This is a cost shared equally across all consumers of the canonical contract, not a YouTube-specific burden, and does not violate the single-source-of-truth principle — it's the normal cost of a breaking API change, identical to what Grievance already accepts today.

## M. Implementation Plan (ordered, for a later phase — not executed in this pass)

1. **Schema**: add the additive `LiveChatMessage` fields from §G (`analysis_status`, `analysis_started_at`, `analysis_completed_at`, `needs_review`, `review_reason`, `confidence`, `analysis_details`, `retry_count`) plus the supporting index. Non-breaking — existing fields untouched.
2. **Adapter**: build `buildLiveChatAnalysisUpdate(analysisData)` (mirrors `buildGrievanceAnalysisUpdate` structurally) and a thin `analyzeLiveComment(text)` wrapper calling `analysisService.analyzeContent(text, {platform:'youtube_live', skipForensics:true})`, including the outcome-shape check from §C.
3. **Ingestion change**: `persistChunk` inserts new messages with `analysis_status:'pending'` and **no** lexicon-derived sentiment/tone fields populated for display purposes (`isChatRelevant()` still runs as the cost gate; `lexiconSentimentFromTokens`/`toTdpAxis` calls removed from the insert path).
4. **Queue replacement**: replace `enqueueLlm`/`drainLlmQueue`/`runBatch` with a controlled-concurrency worker pool that claims pending messages (atomic claim per §K), calls the new adapter per item, applies an application-level timeout, and writes results via the new mapper.
5. **SSE**: emit `'messages'` at ingest (pending state, as today's insert path already does structurally) and `'message:update'` once the adapter completes (per §H), including the failure-state emission.
6. **Frontend**: add the pending/analyzing/complete/failed render states to `MessageRow`, add the stance display-mapping (§I), build `LiveChatAnalysisModal` from the `GrievanceAnalysisModal`/`ReasonModal` template, wire the eye icon.
7. **Retire duplicate code**: remove `liveChatBatchAnalyzer.js`, `enforceBatchConsistency`, `SENTIMENT_TO_RISK`, the old queue machinery, and the lexicon sentiment functions (§F) — only after step 4-6 are verified working, and only once `scripts/rescore_live_chat.js`/`backfill_live_chat_sentiment.js` are updated or explicitly retired (they currently import these functions directly).
8. **Testing, before any rollout**:
   - Unit-test the adapter against all three `analyzeContent` outcome shapes from §C, including the LLM-total-outage `needs_review:true` path and the catastrophic-failure path — confirm `analysis_status` lands correctly in each case.
   - Load-test the new worker pool against the actual shared Ollama host at realistic post-relevance-filter chat volume, to empirically size concurrency (§J) — do not carry over the old `LLM_CONCURRENCY=2` figure, it was sized for a different call shape.
   - Measure real cache-hit rate on a sample of real chat text to validate the §J mitigation assumption.
   - Verify SSE payload behavior and the frontend's pending→complete→(optionally failed) state transitions end-to-end on a real or replayed live stream, side-by-side with the current behavior before removing the old code.

---

## Appendix — open items to confirm before implementation

- **Whether Pass A and Stage 3/4 can run in parallel** (§J point 5) — worth a direct read of `analyzeContent`'s exact data dependencies before assuming either way.
- **Whether `stance:'unrelated'` can still occur** for a message that already passed `isChatRelevant()` — affects whether §I's stance-mapping needs a third visible state or can safely collapse to two.
- **Real-world worker-pool sizing** (§J) — explicitly deferred to a load test, not asserted here, per the request's own instruction not to pick queue technology or concurrency numbers yet.
- **Whether `scripts/rescore_live_chat.js`/`backfill_live_chat_sentiment.js` should be updated or retired** — depends on whether any operational workflow still relies on them once the async pipeline no longer leaves messages permanently stuck at "lexicon-only."
