# Sentiment Analysis — Chhattisgarh Political Watch

How the target-aware political sentiment pipeline works in this deployment, what
was changed to build it, and what is verified versus still unproven.

**Client:** BJP Chhattisgarh and the BJP government of Chhattisgarh (CM Vishnu Deo Sai).

> The pipeline code was built for the Andhra Pradesh deployment and carried over
> unchanged. §4 (roster and alignment) is written for Chhattisgarh. The change log in §5
> onward is kept as history; its AP examples explain *why* the code is shaped the
> way it is, and the same rules apply here.

---

## 1. The one rule everything else follows

This is **not** a positive/negative/neutral classifier. It answers: *given who
this post targets, is it good or bad for our client?*

Two separate values are tracked and must never be collapsed into one:

| Field | Answers | Example: "Congress looted Chhattisgarh" |
|---|---|---|
| `generic_sentiment` | What is the raw emotional tone of the text? | `negative` (the words are angry) |
| `target_sentiment` | Is this good or bad **for our client**? | `positive` (it attacks the opposition) |

A third value carries the signal the decision actually needs:

| Field | Answers | Example: "I back the farmers — the govt's order must be withdrawn" |
|---|---|---|
| `target_tone` | What is the tone aimed **at the target**? | `negative` (whole-post mood reads positive) |

`political_stance` (`pro_target` / `anti_target` / `pro_target_indirect` /
`anti_target_indirect` / `neutral` / `unrelated`) is the intermediate value the
deterministic engine computes to derive `target_sentiment`. `beneficiary`
(`ours` / `opposition` / `none`) comes from the same computation.

**Never convert `generic_sentiment` directly into `target_sentiment`.** Every
bug in this class is a version of that rule being broken somewhere.

> **Naming note.** On this deployment the stored field `analysis.sentiment`
> holds the **client-relative** value, not the raw tone. That is deliberate:
> 119 read sites across 15 controllers and services (every dashboard, geo
> sentiment index, constituency comparison, sentiment leaderboard and unrest
> score) already aggregate on it with that meaning. Redefining it would have
> silently changed all of them with nothing erroring. Raw tone lives in
> `analysis.generic_sentiment`. The rule above is about **derivation**, not
> naming — and it holds: `analysis.sentiment` is fed only from the deterministic
> stance engine.

---

## 2. Pipeline, stage by stage

```
Raw post (X / Instagram / Facebook via RapidAPI, RSS, Telegram, YouTube)
        │
        ▼
Ingestion relevance gate  (grievanceService.js — Mentions path only)
        │  kept if: the full keyword phrase matches, OR a significant token of
        │  it matches text/handle, OR the deterministic entity scan recognises
        │  a known ally/opposition figure. Rejects true noise before it costs an
        │  LLM call. Alerts and RSS have their own ingestion paths — see §7.
        ▼
Pre-translation  (analysisService.js)
        │  non-English text is translated to English ONCE, and both LLM stages
        │  reason over the translation. Entity detection still runs on the
        │  ORIGINAL text, where curated native-script aliases work directly.
        ▼
Stage 1 — LLM content understanding  (llmService.js: categorizeText)
        │  category, grievance_type, severity, department, risk, a
        │  client-relative sentiment, and `target_party` (whose side the post
        │  is about — consumed only as a cross-check, see Stage 5)
        ▼
Stage 2 — Political context (deterministic, NO LLM)  (politicalContextService.js)
        │  alias-matches the ORIGINAL text against the full roster
        │  (config/politicalEntities.js) → mentioned_entities, primary_target,
        │  civic-grievance keyword scan, AUTHOR resolution, and pipeline mode:
        │  about_target | about_opposition | civic_grievance | general_politics
        │  | irrelevant
        ▼
Stage 3 — Target-aware extraction (LLM, constrained)  (politicalSentimentService.js)
        │  The LLM is given the Stage-2 snapshot and asked ONLY to extract:
        │  candidate_actors, candidate_subjects, sentiment_target, target_tone,
        │  generic_sentiment, emotion, language, reasoning. It is explicitly
        │  told NOT to output stance or beneficiary — those are computed next.
        ▼
Entity resolution  (entityResolver.js)
        │  resolves each candidate actor AND the sentiment target to a roster
        │  entity + alignment, in order: (1) Stage-2's mentioned_entities,
        │  (2) a full-roster alias lookup on the LLM's own (translated) text —
        │  this is what catches a leader named only in a script Stage 2 has no
        │  curated alias for, (3) an optional operator CSV.
        ▼
Stage 4 — Deterministic stance engine  (stanceEngine.js)
        │  ally attacked → anti_target · ally praised → pro_target
        │  opposition attacked → pro_target_indirect · opposition praised → anti_target_indirect
        │  civic grievance, no one named → anti_target (negative) / pro_target (positive)
        │  nothing resolves at all → neutral (NEVER mirrors generic_sentiment — §1)
        │  + author-is-target correction, + cross-camp prior
        ▼
Stage 5 — Confidence fusion  (confidenceGate.js + analysisService.buildQualityGate)
        │  0.5×LLM + 0.3×resolver + 0.2×rule → needs_review if < 0.6,
        │  plus blocking reasons (low confidence, uncertain relevance,
        │  two contradicting client-relative verdicts, LLM fallback)
        ▼
risk_level / risk_score  (analysisService.js)
        │  target_sentiment is the ONLY input: negative→high/75,
        │  moderate→medium/50, positive→low/20.
        ▼
Persisted onto Grievance.analysis / Alert.llm_analysis / NewsArticle.*
        ▼
UI — all reading through frontend/src/lib/sentiment.js
```

---

## 3. Where each stage lives

| Stage | File |
|---|---|
| Ingestion gate (Mentions) | `backend/src/services/grievanceService.js` (`passesKeywordGate`) |
| Stage 1 (LLM understanding) | `backend/src/services/llmService.js` |
| Stage 2 (deterministic context) | `backend/src/services/politicalContextService.js` |
| Stage 3 (constrained LLM extraction) | `backend/src/services/politicalSentimentService.js` |
| Entity resolution | `backend/src/services/entityResolver.js` |
| Stage 4 (deterministic stance) | `backend/src/services/stanceEngine.js` |
| Stage 5 (confidence) | `backend/src/services/confidenceGate.js` |
| Orchestration + quality gate + risk bucket | `backend/src/services/analysisService.js` |
| Political roster (raw) | `backend/src/config/politicalData.js` |
| Political roster (entity graph + aliases) | `backend/src/config/politicalEntities.js` |
| RSS plumbing | `backend/src/services/rssAnalysisService.js` |
| **UI sentiment/stance resolution** | `frontend/src/lib/sentiment.js` |

Everything downstream of `analyzeContent()` is shared — Mentions, Alerts and RSS
all call the exact same Stage 1–5 pipeline.

---

## 4. The political roster

`config/politicalEntities.js` builds one entity graph from
`config/politicalData.js`. **143 entities**: 85 ally (people, the party and 9
government schemes), 54 opposition, 4 neutral institutions, across 769 unique
aliases (as of 26 Sep 2026).

### ⚠ Alignment is state-specific

| Party | Chhattisgarh alignment | Note |
|---|---|---|
| BJP | **ally** | client's party; governs alone (54 of 90 seats) |
| INC | **opposition** | 35 seats; Leader of Opposition Dr. Charan Das Mahant, PCC president Deepak Baij, former CM Bhupesh Baghel |
| GGP | **opposition** | Gondwana Gantantra Party, 1 seat (Pali-Tanakhar, Tuleshwar Markam) |
| JCC(J) | **opposition** | Janta Congress Chhattisgarh (J), Amit Jogi; no seat |
| AAP, BSP | **opposition** | no seat |

There is no coalition partner, so `ALLY_PARTIES` is empty. The primary target
is `vishnu-deo-sai` (legacy key `bsk`) and the secondary is `kiran-singh-deo`,
BJP Chhattisgarh state president (legacy key `bsk_son`). `bjp_telangana` is the
legacy key for the party machinery and resolves to `bjp`.

Never copy an alignment table between deployments. Re-derive it per state.

### How the roster is built

- **Hand-curated (rich aliases incl. Devanagari):** the CM, both Deputy CMs and
  all 11 ministers, the Speaker, the BJP Chhattisgarh organisation (incl. the
  state in-charge), the opposition leadership (INC, GGP, JCC(J)), all 16 MPs
  (11 Lok Sabha, 5 Rajya Sabha) and national figures.
- **Auto-derived from `data/state_voter_profiles.json`:** the remaining sitting
  MLAs (there are no vacant seats as of Sep 2026).
- **Bare common surnames and nicknames are never aliases.** "Sai", "Sao",
  "Baghel", "Singh", "Sharma", and nicknames that are ordinary words ("Kaka" =
  uncle, "Baba", "Mahant") are shared by many people, including rival
  politicians (Bhupesh, Dayaldas, Vijay and Lakheshwar Baghel are in four
  different roles). Only full names, titled forms ("CM Sai", "TS Baba",
  "Bhupesh Kaka") and verified handles match.

**Known limitation, stated plainly:** auto-derived entries carry **English-script
aliases only**. Because the pipeline pre-translates before Stage 3 extraction and
`entityResolver` matches that translated text against the full roster, English
aliases still catch native-script posts on the Stage 3 path — but they do **not**
help the Stage 2 deterministic pre-scan, which reads the original text.

**Extending `CURATED_ALIASES` with Hindi and Chhattisgarhi (Devanagari and
romanised) spellings is the single highest-leverage improvement available to
this pipeline.** The current Devanagari aliases were taken from the Assembly's
member list and Hindi media, and need review by a native speaker. Skipping a
native-script alias is the most common way a correctly-analysable post silently
drops to `general_politics`.

**When adding a leader:** add them to `politicalData.js`, then add a
`CURATED_ALIASES` entry keyed by their `id` with every spelling a real post is
likely to use — **including the spelling Google Translate produces**, which
often differs from the official one. Verify with
`findAliasMatches('<translated spelling>')`.

---

## 5. What was built and fixed

1. **Created the deterministic stance engine** (`stanceEngine.js`). Previously
   the LLM was asked for the stance directly and trusted. That is
   non-deterministic: on a post naming both camps, the answer depended on which
   entities the model listed first, so the same text could score
   `pro_target_indirect` on one run and `anti_target` on another.
2. **Created `entityResolver.js`** — resolves extracted actor/target text
   against the full roster, so a leader named only in Telugu (invisible to the
   Stage 2 pre-scan) still resolves from the translated Stage 3 output.
   Deliberately has **no short-name heuristic**: accepting any ≤6-char string as
   its own entity manufactured unaligned pseudo-entities ("govt", "cm") that
   occupied the actor slot and blocked the real entity behind them.
3. **Created `confidenceGate.js`** (Stage 5) and `buildQualityGate` in
   `analysisService` — per-dimension confidence, a validation record, and a
   blocking `needs_review` decision.
4. **Built the AP roster** (`politicalData.js`, 219-entity
   `politicalEntities.js`). Previously 13 hand-written entities carrying
   *Telangana* legacy key names (`bsk`, `bsk_son`, `bjp_telangana`).
5. **Added `sentiment_target`** — the entity the tone is aimed AT, taught as
   explicitly distinct from the speaker. It decides the stance when it resolves
   to a side; absent/neutral falls through to the original actor logic, so
   single-side posts are unaffected.
6. **Added `target_tone`** — the tone aimed at that target, which is what the
   matrix consumes. `generic_sentiment` is retained unchanged as whole-post mood
   for display. This is the fix for the most common political post shape there
   is: supporting a sympathetic group while attacking the government.
7. **Added the author signal.** `monitorService` never passed `authorHandle`, so
   *every Alert* reached the political gate with an empty author.
   `politicalContextService` now resolves the posting account against the roster
   (`author_alignment`; `null` for accounts not in the roster, which consumers
   must treat as *unknown*, never *neutral*), and the stance engine uses it for
   an **author-is-target correction** — *a speaker does not attack themselves*.
8. **Added the cross-camp prior** — a deterministic backstop that does not
   depend on the model. A roster-resolved opposition author "praising" our side
   is downgraded to `moderate` (→ `neutral` + review), **not** inverted, so
   genuine congratulations and condolences are not suppressed.
9. **`heuristicFallback` was dead code.** It computed a stance into `stance` and
   then returned a separate, always-`'unrelated'` variable, so every LLM outage
   produced `unrelated`. Now returns the computed value, and always sets
   `needs_review: true`.
10. **`resolveTargetSentiment` mirrored tone onto the client axis.** The
    `unrelated` branch returned `'positive'` whenever raw tone was positive —
    a direct §1 violation. Now returns `moderate`.
11. **The consistency enforcer could never fire.** It looked up
    `canonical_name`/`name` on mentioned entities, but `findMentionedEntities`
    returns `canonical`/`key`. Fixed, and extended to `civic_grievance` mode.
12. **Removed the inverted generic-tone fallback.** `generic_sentiment` no
    longer falls back to Pass A's `sentiment`, which is client-relative and
    would store an attack on the opposition as generically *positive*.
13. **Added `target_party` to Pass A** so a Pass-A/Stage-4 disagreement can be
    classified: a genuine contradiction (both client-relative) blocks on
    `client_sentiment_conflict`; the expected generic-vs-client difference is an
    audit-only warning.
14. **Self-consistency guard.** Stage 3's prompt asks for `reasoning` **before**
    the tone labels, and a guard flags a response whose own reasoning
    contradicts its own label, lowering confidence and routing to review.
15. **Model enums were rejecting the new vocabulary.**
    `Grievance.analysis.stance` had a hard enum of `pro_bsk`-family values —
    writing `pro_target` would have thrown `ValidationError` — and
    `beneficiary` rejected `'ours'`. Enums widened to accept both vocabularies
    (retired values kept so historical records still validate on re-save), and
    the missing fields added: `target_sentiment`, `target_tone`,
    `political_stance`, `emotion`, `confidence`, `validation`,
    `validation_status`, `needs_review`, `review_reason`, `client_relevance`,
    `target`, `target_relevance`, `manual_override`.
16. **`NewsArticle.language` had no Telugu.** The enum was
    `['en','pa','hi','unknown']` — carrying Punjabi from an earlier tenant while
    missing `'te'`, the primary regional language of this deployment. Every
    Telugu article (Eenadu, Sakshi, Andhrajyothy, TV9) failed enum validation.
17. **`Analysis.sentiment` was hardcoded to `'neutral'`** for every record in
    `monitorService`, discarding the real verdict. Several UI fallback chains
    read that flat field. Now writes the real value.
18. **Three incompatible sentiment vocabularies.** `Analysis` and `Content` used
    `['positive','neutral','negative']` while everything else used `'moderate'`,
    so the middle bucket wrote through unvalidated and never matched a query.
    Both enums widened; `'moderate'` is canonical.
19. **The Alerts sentiment override did nothing visible.** It wrote only
    `llm_analysis.sentiment`, while the list/stats/topic-count queries filter on
    `llm_analysis.target_sentiment` and the card painted its badge from
    `risk_level`. Now one correction cascades to every field that represents it
    — sentiment, stance, beneficiary, risk_level, risk_score — across Alert,
    Analysis and Content, in both directions, preserving the pipeline's
    sentiment⇄risk invariant. Same fix applied to the Grievance and News
    overrides.
20. **The Alerts sentiment filter matched only the legacy field** and was
    written to `query.$or`, which three later blocks in the same function
    overwrite with a plain assignment — silently dropping the filter. Now
    matches both field names and is always appended to `$and`.
21. **The dashboard faked sentiment from `risk_level`** (`apDashboardController`
    ×2), contradicting `alertController`'s deliberate decision to stop using
    risk as a sentiment proxy. Now filters on the stored sentiment.
22. **Frontend: one alert could show three different verdicts at once.** The
    badge read `risk_level`, the border read `risk_level` with a different
    mapping, and the modal read `llm_analysis.sentiment`. All now resolve
    through `frontend/src/lib/sentiment.js`.
23. **A missing sentiment rendered as green "POSITIVE".** Alert types that never
    ran through the political pipeline (velocity spikes, `new_post`, captured
    Instagram stories) fell through to the `else` arm. Unknown now resolves to
    `moderate`. Captured stories no longer claim `risk_level: 'low'`.
24. **Modals showed Pass A's reasoning next to Stage 4's badge** — two different
    LLM calls presented as one explanation, which is why reasoning could read
    "tone is critical" beside a Positive badge. All modals now show
    `political_reasoning`.
25. **Ingestion gate widened** (`passesKeywordGate`) with Unicode-correct
    tokenisation (`\p{L}\p{M}`, so Telugu vowel signs don't shatter a word into
    single characters and silently disable the check for every non-Latin
    keyword), plus an entity-scan rescue.
26. **RSS joined the pipeline** (`rssAnalysisService.js`). News was scored by a
    separate Cohere prompt in the Python engine with a different rubric, so
    `newsarticles.sentiment` did not mean the same thing as the identically
    named field on Grievances and Alerts.
27. **24 duplicate object keys fixed** (AST-verified, whole backend). Two in
    `monitorService`'s update literal — where the surviving `quoted_content`
    expression was the *worse* of the pair and discarded already-archived S3
    media on every poll. 21 `{ $ne: null, $ne: '' }` pairs where only `$ne: ''`
    survived, so nulls were never excluded. And `telegramService`'s
    `{ username: chat.username, username: { $ne: '' } }`, where the actual
    username match was dropped — leaving a branch that matched **any** group
    with a non-empty username, so an upsert could overwrite an unrelated group.

---

## 6. Verification status — READ BEFORE DEPLOYING

### What IS verified

| | |
|---|---|
| `scripts/test_stance_engine.js` | **47/47 green.** Deterministic, no LLM/DB/network, milliseconds. |
| `scripts/test_sentiment_pipeline.js` | **58/58 green.** Full pipeline with a stubbed LLM, incl. `analyzeContent`. |
| Backend module load | **237/237 modules load**, zero load-time failures. |
| Frontend production build | **compiles clean**, zero warnings. |
| Duplicate-key scan | **0 remaining** across 236 files. |
| Roster integrity | 219 entities, 574 aliases, no duplicate ids, alignment spot-checked, false-positive guards hold (`incident`/`increase`/`including` do not match `inc`). |

Run everything with `npm run test:sentiment`.

### What is NOT verified — be honest about this

- **No live LLM has been run through this.** Every test stubs the provider.
  Whether the local model actually populates `sentiment_target` and
  `target_tone` correctly on real posts is **unmeasured**. That is the ceiling
  on real-world accuracy (see §9).
- **No database has been touched.** Model enum changes, the override cascades
  and the news re-score script are syntax- and logic-verified only; none has
  been exercised against a live record.
- **Existing stored data is stale.** A roster populated today does not
  retroactively fix records analysed before it existed. Nothing has been
  backfilled.
- **`needs_review` volume will rise**, because Stage 5 adds blocking reasons
  that did not exist before. Check what else consumes `needs_review` before
  shipping, and measure the new rate on a sample.
- **Telugu curated aliases were hand-written** and have not been checked against
  real posts. A wrong alias is inert (it simply never matches), but an absent
  one silently costs recall.
- **Handles are mostly empty.** Only handles independently evidenced in this
  repo or verified publicly are filled in; the rest are deliberately `[]`. A
  wrong handle mis-attributes every post from that account, which is worse than
  no handle. Author resolution therefore covers party/leader accounts, not the
  long tail.

### Recommended before trusting dashboard numbers

```bash
cd backend
npm run test:sentiment                       # must be 105/105
node scripts/rescore_news_articles.js --dry-run --limit=50
node scripts/rescore_news_articles.js --limit=200      # persist
```

---

## 7. Ingestion paths are not uniform

- **Mentions (Grievances):** keyword-driven, goes through the relevance gate in
  §2. Passes `authorHandle` and `taggedKeyword`.
- **Alerts (X/FB/IG monitoring):** driven by `monitorService.js` /
  `velocityAlertService.js`. Several distinct alert-creation paths exist
  (`ai_risk`/`keyword_risk`, `velocity`, `new_post`); the `new_post` and some
  `velocity` paths do **not** attach `llm_analysis` at creation time at all —
  the real classification lives on the linked `Content`/`Analysis` record. This
  is exactly why `lib/sentiment.js` checks the nested
  `content.analysis.llm_analysis.*` path.
- **RSS (NewsArticle):** the Python engine owns INGEST (it writes with
  `$setOnInsert`, so it never clobbers what the Node pipeline writes).
  `rssAnalysisService.analyzeArticle()` re-scores through the same
  `analyzeContent()`. No containment gate — an RSS feed is a curated source
  list, not a keyword search.
- **YouTube live chat:** a **separate** lexicon + batch-LLM pipeline
  (`liveChatBatchAnalyzer.js`) emitting a third stance vocabulary
  (`pro_tdp`/`anti_tdp`). Not unified — doing so would change that prompt's
  contract. `lib/sentiment.js` understands its labels.

> **The gate only protects NEW posts.** It was added after this corpus was
> collected, so the existing ~69k Mentions went in ungated, and re-analysis
> re-scores them rather than removing them. `src/scripts/audit-irrelevant-posts.js`
> re-applies `passesKeywordGate` to stored posts and can quarantine the failures
> into `irrelevant_grievances` (reversible with `--restore`). It reports by
> default and writes nothing without `--move`.

---

## 7a. Pass A's context budget — a hard 4096, and it fails silently

The shared Ollama host keeps `qwen2.5:7b` **resident at `num_ctx` 4096**, and
nothing in this repo sets `num_ctx` (asking for a different one forces a model
reload for everything else using that host). When a prompt exceeds the window
Ollama **does not error — it drops the oldest tokens**, which for `categorizeText`
means the head of the prompt: the list of moderation categories the model is being
asked to choose from. The output stays well-formed JSON, so nothing downstream
notices.

Measured with Ollama's own `prompt_eval_count` against this deployment's prompt:

| input | prompt tokens | + `num_predict` | headroom |
|---|--:|--:|--:|
| typical tweet | 2,760 | 3,060 | +1,036 |
| 4,000-char English article | 3,394 | 3,694 | +402 |
| 4,000-char Telugu article | 3,506 | 3,806 | +290 |

**Telugu costs ~2 tokens per character; English ~0.25.** A character-based cap is
therefore useless — 2,000 characters is 500 tokens of English but 1,937 of Telugu,
which on its own put the prompt at 4,095 and into silent truncation. So
`llmService` budgets the post text in *estimated tokens*
(`CATEGORIZE_TEXT_TOKEN_BUDGET`, default 900) with non-Latin charged at its real
rate, and `num_predict` is 300 — the JSON this prompt asks for measured 108–140
output tokens, so the previous 700 was reserving five times what it used out of
the same 4096.

Anything that lengthens this prompt — a new JOB, more moderation categories,
longer category definitions — spends that headroom. Re-measure rather than assume;
`prompt_eval_count` on any `/api/chat` response is the ground truth.

---

## 8. Scenario coverage (verify against this table after any change)

| Input | `generic_sentiment` | Target | `political_stance` | `target_sentiment` |
|---|---|---|---|---|
| Praise of CBN/Lokesh/Pawan/TDP | positive | OURS | `pro_target` | positive |
| Attack on CBN/Lokesh/Pawan/TDP | negative | OURS | `anti_target` | negative |
| Praise of Jagan/YSRCP | positive | OPPOSITION | `anti_target_indirect` | negative |
| Attack on Jagan/YSRCP | negative | OPPOSITION | `pro_target_indirect` | positive |
| Civic complaint, no one named | negative | CIVIC | `anti_target` | negative |
| Civic improvement, no one named | positive | CIVIC | `pro_target` | positive |
| Neutral election news, no stance | any | NEUTRAL | `neutral` | moderate |
| Unrelated content (no political actor, not civic) | any | NONE | `unrelated` / `neutral` | moderate |

**Multi-entity posts** (an ally *and* an opposition figure in the same post):

| Input | Correct target | `political_stance` |
|---|---|---|
| Opposition account attacking our side (both named) | OURS | `anti_target` |
| Opposition figure praising our CM (both named) | OURS | `pro_target` |
| Attack on YSRCP with a passing TDP mention | OPPOSITION | `pro_target_indirect` |
| Opposition author whose target was mis-extracted as itself | OURS | `anti_target` |
| Opposition author attacking another opposition party (no ally named) | OPPOSITION | `pro_target_indirect` |

Every row is pinned by `scripts/test_stance_engine.js`.

---

## 9. Known limitations (not fixed — flagging honestly)

- **THE EXTRACTION LAYER IS THE CEILING.** The deterministic layer is provably
  correct (47/47). What remains is that the LLM feeding it can mislabel
  `sentiment_target` or `target_tone`, and **no deterministic rule recovers from
  a wrong input**. The cross-camp prior exists precisely for this: when the
  model is unreliable, fail to *review*, not to a confident wrong answer. If the
  configured provider is a small local model, expect to lean on that backstop —
  consider routing Stage 3 extraction to a stronger model (`llmProvider` already
  supports several).
- **Sarcasm.** A mocking post using laughing emojis can be labelled
  `generic_sentiment: positive` even when the same response tags
  `emotion: sarcasm`. The self-consistency guard catches only the subset where
  the model's own *reasoning text* contradicts its label.
- **Two LLM calls still both do political reasoning.** Stage 4 is authoritative
  and Pass A's verdict no longer leaks into stored fields or the UI, but Pass A
  still computes a `target_party`/sentiment consumed only as a cross-check.
  Collapsing it to pure content classification would remove a whole class of
  future divergence — deliberately not done, because it changes a prompt
  contract every monitoring path shares.
- **Correlated errors defeat cross-checks.** The conflict check and the
  self-consistency guard are *disagreement* detectors; neither catches two
  models wrong in the same direction. Structural limit, not a bug.
- **Alerts and Mentions still compute risk independently.**
  `monitorService.js` layers keyword-weight overrides and min-score-per-level
  "force-fix" rules on top of whatever `analyzeContent()` decided from
  `target_sentiment`. **A keyword with weight > 20 can flip a pro-TDP `low` post
  into `medium` or `high`**, breaking the invariant this pipeline guarantees.
  There are also three different "high" floor scores in the codebase (75 in
  `analysisService`, 65 in `monitorService`, 80 in `velocityAlertService`). Left
  alone deliberately — changing it alters alerting volume, which is an
  operational decision, not a correctness one. **Worth revisiting.**
- **Author resolution only covers roster accounts.** Citizen and parody accounts
  return `null` **by design**, so the author correction and the cross-camp prior
  do not help there.
- **The 7-day text cache does not learn from corrections.** An operator's manual
  override is not fed back, so re-analysing identical text within the TTL
  returns the pre-correction verdict. The cache key was bumped to `v2` for the
  new result shape, but the staleness behaviour is unchanged.

---

## 10. Porting this to another client

1. Build that client's roster in `politicalData.js` / `politicalEntities.js` —
   ally leaders/parties, opposition leaders/parties, and **native-script aliases
   for every single one** (§4). Highest-leverage step, and the one most likely
   to be half-done.
2. **Re-derive every alignment from scratch.** BJP is ally here and opposition
   in Telangana; INC is opposition here and the client there.
3. Confirm the civic lexicon in `politicalContextService.js`
   (`CIVIC_GRIEVANCE_TOKENS`) covers that state's languages and **current**
   scheme names.
4. Leave `stanceEngine.js`'s decision matrix as-is — it is client-agnostic
   (ally/opposition framing, never party names).
5. Update `scripts/test_stance_engine.js` Section F with the new roster's
   alignment expectations, then run the suites.
6. Re-score existing data; a roster populated today does not retroactively fix
   records analysed before it existed.
