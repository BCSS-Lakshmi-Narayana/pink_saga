# AI Campaigns — AP.Blura.Saga

Turns the posts this deployment has already collected and analysed into
ready-to-publish awareness-campaign ideas.

It **collects nothing and analyses nothing itself** — it is a consumer sitting on
top of the monitoring pipeline and the target-aware sentiment pipeline
(see [SENTIMENT_ANALYSIS.md](./SENTIMENT_ANALYSIS.md)). That dependency is not
incidental: everything below is downstream of stance being correct.

---

## 1. The pipeline

```
Ingestion + analysis (already running)
        │  writes analysis.sentiment / political_stance / topic / grievance_type
        │  `topic` is the campaign taxonomy and is assigned HERE, per post — the
        │  backfill scripts in §4 exist for history, not as a recurring job.
        ▼
Embedding — automatic, fire-and-forget, on every Grievance save
        │  (post-save hook; the backfill script is the safety net for bulk paths
        │   and history, since updateOne/insertMany bypass the hook by design)
        ▼
Operator clicks "Generate"  (days, sources, topics, stance — all optional)
        ▼
Stage A — significant-topic aggregation  (campaignTopicService.js — DB only, NO LLM)
        │  groups the window by the 16-value campaign taxonomy + stance and
        │  ranks by volume:  43,000 posts → 5-8 topics
        ▼
Stage B — hybrid retrieval  (services/rag/ — NO LLM)
        │  dense (embeddings, cross-language) + lexical (BM25/regex) fused by
        │  Reciprocal Rank Fusion, best-matching posts PER topic
        ▼
Stage C — LLM generation  (campaignSuggestionService.js)
        │  title, summary, creator brief, post copy (+ X-length variant),
        │  hashtags, platforms, talking points
        ▼
CampaignSuggestion (status: new)
        ▼
Operator: dismiss → dismissed   |   send-to-campaign → ViralCampaign (draft)
```

**Generation is on-demand only.** No cron, no scheduler. Nothing in this
subsystem runs unless someone presses Generate.

### What the model decides, and what it does not

Deliberate, and worth preserving: **the model chooses what to SAY; the database
decides direction and scale.**

| Value | Source |
|---|---|
| `intent` (counter / amplify) | Stage A counts — critical vs supportive posts in the topic |
| `impact_score` | topic size relative to the biggest topic in the window |
| `urgency_score` | how one-sided the topic is |
| `priority` | derived from the two above |
| title, brief, post copy, hashtags, talking points | the LLM |

The engine asks the model for none of the numbers, because it returned 0 for
most of them and unfounded guesses for the rest.

---

## 2. Where it lives

| Piece | File |
|---|---|
| Campaign taxonomy (16 civic topics) | `backend/src/services/campaignTaxonomy.js` |
| Stage A — topic + stance aggregation | `backend/src/services/campaignTopicService.js` |
| Stage B — hybrid retrieval | `backend/src/services/rag/` (5 files) |
| Stage C — suggestion engine + prompts | `backend/src/services/campaignSuggestionService.js` |
| API | `backend/src/routes/campaignSuggestionRoutes.js` → `/api/campaign-suggestions` |
| Campaign management API | `backend/src/routes/viralCampaignRoutes.js` → `/api/viral-campaigns` |
| Models | `backend/src/models/CampaignSuggestion.js`, `ViralCampaign.js` |
| Creative sanitizers | `backend/src/utils/viralCreative.js` |
| Frontend page | `frontend/src/pages/AiSuggestions.js` |
| Creative editor | `frontend/src/components/viral/creative.jsx` |
| RBAC page | `/ai-suggestions` in `backend/src/config/rbacConfig.js` |

Handlers are **inline in the route files** — there is no campaign controller.

---

## 3. ⚠ HARD PREREQUISITE — the state of this deployment's data

Measured against the live database at port time:

| | count |
|---|---|
| grievances total | **69,161** (43,832 in the last 30 days) |
| with `analysis.stance` (retired vocabulary) | 69,117 |
| with `analysis.political_stance` (**what AI Campaigns reads**) | **0** |
| with `analysis.topic` | **0** |
| with an embedding | **0** |
| alerts with `campaign_topic` | **0** |

Stage A run against the live corpus, before any migration:

```
[campaignTopics] only 0% of 0 campaignable posts have a campaign topic
grouping : {"field":"analysis.grievance_type","taxonomy":"grievance_type (fallback)"}
totals   : {"posts_in_window":43598,"topics_found":0,"posts_in_topics":0}
```

**Zero topics. Generate would return an empty page** — not an error, just
nothing. The whole corpus was analysed under the earlier field names and is
invisible to the campaign filter.

The news source already works (it groups on its own `category` and derives
stance from `sentiment` + `sentiment_target_alignment`):
`general(21), politics(15), development(5), communal(1), crime(1)`.

---

## 4. Bringing existing posts in — run these in order

### Step 1 — stance vocabulary migration (REQUIRED, instant, no LLM, no cost)

```bash
cd backend
npm run migrate:stance:dry     # report only
npm run migrate:stance         # persist
```

A pure **rename** of values the pipeline already decided — no model call, no new
judgement:

| from | to | docs |
|---|---|---|
| `analysis.stance: pro_bsk` | `analysis.political_stance: pro_target` | 15,857 |
| `anti_bsk` | `anti_target` | 5,220 |
| `pro_bsk_indirect` | `pro_target_indirect` | 12,117 |
| `anti_bsk_indirect` | `anti_target_indirect` | 5,778 |
| `analysis.bsk_sentiment` | `analysis.target_sentiment` (verbatim copy) | 69,117 |
| `analysis.beneficiary: bsk` / `bjp` | `ours` | 32,893 |

→ **38,972 posts become campaignable.** The legacy fields are left in place as
the audit trail of what the old pipeline said.

> `bsk` and `bjp` both map to `ours` because in Andhra Pradesh the BJP is a
> coalition partner **in government**. The Telangana deployment maps the same
> value to the opposite side — never copy this table between deployments.

**This is not a substitute for re-analysis.** It carries forward verdicts
produced by the old logic, including the defects listed in
SENTIMENT_ANALYSIS.md §5. It exists so the corpus is not invisible while
re-analysis is pending.

### Step 2 — grant the page to existing users (REQUIRED)

```bash
npm run grant:page -- --page /ai-suggestions --dry-run
npm run grant:page -- --page /ai-suggestions
```

**202 permission documents** are on file and **none** contains `/ai-suggestions`.
This deployment seeds a `PagePermission` document at registration
(`authController.buildDefaultPagePermissions`), and `normalizePermissions` only
reflects stored keys — so every existing user would be **denied** the page and it
would simply never appear in their sidebar. New users pick it up automatically.

Add `--disabled` to grant it switched off, so enabling it stays a per-user
decision in Access Management.

### Step 3 — campaign topics for HISTORY (LLM, the expensive one)

```bash
npm run backfill:topics -- --days 30
npm run backfill:alert-topics -- --days 30
```

Until `analysis.topic` coverage passes 50% (`RAG_MIN_TOPIC_COVERAGE`), Stage A
falls back to grouping on `analysis.grievance_type` — where **"Normal" is 40,480
of 69,117 documents**. That bucket is not an issue anyone can campaign on, so the
topic list stays poor until this runs.

> **This is a one-off for the existing corpus.** Every post analysed from now on
> gets its campaign topic at ingest (§6.4) — the backfill is history-only, not a
> recurring job. It is resumable and skips anything already stamped with the
> current `TOPIC_TAXONOMY_VERSION`, so running it after new posts have arrived
> costs nothing for those posts.

### Step 4 — embeddings (enables Stage B retrieval)

```bash
npm run backfill:embeddings -- --days 30
```

Without embeddings, retrieval degrades to the lexical half only — slower and
recency-bounded, but **not broken**. New posts embed automatically from here on
via the Grievance post-save hook.

### Step 5 — Atlas indexes (OPTIONAL)

```bash
npm run rag:indexes:status
npm run rag:indexes
```

Retrieval probes for `grievance_vector_index` / `grievance_search_index` and
falls back to in-process cosine + `$text`/regex on any plain MongoDB when they
are absent or still building. Slower, not broken.

---

## 5. Configuration

Already set in `backend/.env` — nothing to add:

| var | value | used for |
|---|---|---|
| `PRIMARY_LLM_PROVIDER` | `ollama` | Stage C generation |
| `OLLAMA_MODEL` | `qwen2.5:7b` | Stage C |
| `EMBEDDING_PROVIDER` | `ollama` | Stage B |
| `EMBEDDING_MODEL` | `bge-m3:latest` | Stage B (1024d, cosine) |
| `OLLAMA_BASE_URL` | shared Ollama host | both |

Optional tuning: `RAG_PER_TOPIC` (8), `RAG_MAX_TOPICS` (5),
`RAG_MIN_TOPIC_COVERAGE` (0.5), `RAG_CANDIDATE_CAP` (1500),
`RAG_EMBED_ON_INGEST` (`true`), `RAG_FORCE_FALLBACK`,
`SUGGESTION_RETENTION_DAYS` (90), `CAMPAIGN_MAX_PER_RUN` (20),
`OLLAMA_MAX_CTX` (8192).

> **`@xenova/transformers` is pinned at v1.4.2** here (two older services depend
> on that API), and `Xenova/bge-m3` needs v2. This does not matter while
> `EMBEDDING_PROVIDER=ollama`, because the xenova require is lazy. A guard in
> `embeddingService.js` fails with an explanatory message rather than an opaque
> stack trace if the provider is ever flipped without upgrading.

---

## 6. What was adapted for AP (everything else is byte-identical to the reference)

The backend is genuinely client-agnostic — all 13 ported files contain zero
client-specific strings. Only three things changed:

1. **Hardcoded Ollama host removed.** Four files defaulted to another
   deployment's server IP when `OLLAMA_BASE_URL` was unset; now `localhost`.
2. **Evidence permalinks fixed.** The engine selected `Grievance.url`, which is
   **not a top-level field** on either deployment (the only `url` in that schema
   is inside the media sub-document) — so every mention citation rendered
   without its "open" link. Now uses `tweet_url`, which this deployment has on
   all 69,161 records.
3. **Model fields added** so the engine has something to read:
   `Grievance.analysis.topic` + `topic_taxonomy_version`, the five `embedding*`
   fields (+4 indexes), `Alert.campaign_topic` + taxonomy version, and
   `NewsArticle.campaign_topic` + taxonomy version (+1 index).
4. **Campaign topics are assigned at ingest, not only by backfill.** The
   reference deployment classifies `campaign_topic` inside Pass A and threads it
   all the way to storage; that wiring had not been carried over here, so the
   backfill scripts were the *only* writers and coverage would have decayed
   toward zero as new posts arrived. Now:

   | file | what it does |
   |---|---|
   | `llmService.js` | JOB 7 in the prompt + JSON schema; the answer goes through the **same** `normalizeCampaignTopic` the backfill uses, so ingest-time and backfill-time classifications cannot disagree |
   | `analysisService.js` | carries it onto the result as `topic` / `topic_taxonomy_version`, and raises the topic confidence floor when the model placed the post in the taxonomy |
   | `grievanceService.js` | persists `analysis.topic` (the `$set` is explicit — an omitted path is silently dropped by strict mode) |
   | `monitorService.js` (×3), `alertController.js`, `eventMonitorService.js` | every alert-creation site that has an analysis now stamps `campaign_topic` |
   | `rssAnalysisService.js` | same for `NewsArticle` |

   `null` is written — never a guess — when the model answers outside the
   taxonomy, and the taxonomy version is left `null` in that case so the backfill
   picks the post up and retries it later.

   **⚠ Adding a label list to that prompt is not free — measure it.** Pass A now
   hands the model three separate vocabularies (moderation `category`,
   `grievance_type`, `campaign_topic`). The first version of JOB 7 simply added
   the list, and the model began answering *every* field out of whichever list it
   liked best — A/B over the same six posts, same model, temperature 0:

   | | valid `category` | valid `grievance_type` | `campaign_topic` set |
   |---|---|---|---|
   | before JOB 7 | 5/6 | 5/6 | — |
   | JOB 7, first version | **3/6** | **4/6** | 6/6 |
   | JOB 7 + the separation guard | **6/6** | **6/6** | 6/6 |

   The invalid answers were not nonsense — they were `Public_Complaint` and
   `Corruption_Complaint` in the `category` field, i.e. JOB 2's labels leaking
   into JOB 1. Validation silently rewrote them to `Normal`, so nothing errored
   and the damage would only have shown up as a corpus that had quietly become
   59% `Normal`. What fixed it: naming the owning list on every field in the
   output schema ("copy one label verbatim from …") plus an explicit
   "the three lists are separate" block. The guard also repaired a pre-existing
   miss — `Government Praise` had been coming back as the invalid `Public Praise`.

---

## 7. Verification status

**Verified:**
- 248 backend modules load, 0 failures; all CLI scripts syntax-clean.
- Frontend production build compiles, zero warnings in the new/changed files;
  the `AiSuggestions` chunk is emitted.
- RAG config resolves live: `ollama / bge-m3:latest / 1024d / cosine`, RRF k=60.
- Stage A runs against the **real 69k-document corpus** and returns correctly
  for news; the mentions result (0 topics) is the accurate report of unmigrated
  data, not a bug.
- Both sentiment suites still green (47 + 58) after the campaign work.
- Migration and grant scripts dry-run cleanly against the live DB with exact
  counts (38,972 campaignable; 202 permission docs).

**NOT verified — no writes were made:**
- No migration, backfill or permission grant has been executed. Every number
  above is from a dry run.
- **Generate has never been run end-to-end**, because Stage A currently yields
  no mention topics. Its first real test is after Step 1.
- No LLM generation call has been exercised, so Stage C's prompt behaviour on
  `qwen2.5:7b` is unmeasured.
- Atlas Search indexes have not been probed against this cluster.

**Known gap, inherited by design:** `campaignSuggestionRoutes` applies `protect`
+ `requireAnyPageAccess(['/ai-suggestions'])` but **no `loadScope`**, unlike
essentially every other data-reading route here. A constituency-scoped user
(mla / mp) therefore generates campaigns from the **whole-state** corpus. That
matches the reference deployment, which is single-team. Decide whether it is
right for this one.
