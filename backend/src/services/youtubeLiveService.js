/**
 * youtubeLiveService.js
 *
 * Owns the YouTube Live tab end to end:
 *   • watcher   — every WATCH_INTERVAL, checks tracked channels for a live broadcast
 *   • poller    — one loop per live stream, reading chat via InnerTube (zero quota)
 *   • analysis  — sentiment on every message, same positive/neutral/negative
 *                 scheme used by mentions & alerts
 *   • bus       — EventEmitter that feeds the SSE endpoint so the UI updates
 *                 as viewers type
 *
 * Live chat is stored in its own `LiveChatMessage` collection and never written
 * to `Grievance`, so it cannot pollute the Mentions "All" feed or its counters.
 */

const { EventEmitter } = require('events');
const reader = require('./youtubeLiveChatReader');
const LiveStream = require('../models/LiveStream');
const LiveChatMessage = require('../models/LiveChatMessage');
const { buildPoliticalContext } = require('./politicalContextService');
const { analyzeLiveComment, buildLiveChatAnalysisUpdate } = require('./liveChatCanonicalAnalyzer');

/* ─────────────────────────── config ─────────────────────────── */

const WATCH_INTERVAL_MS = Number(process.env.YT_LIVE_WATCH_INTERVAL_MS || 3 * 60 * 1000);
const MIN_POLL_MS = Number(process.env.YT_LIVE_MIN_POLL_MS || 2000);
const MAX_POLL_MS = Number(process.env.YT_LIVE_MAX_POLL_MS || 15000);
// Concurrent single-comment canonical analyses (2 sequential LLM calls each:
// Pass A + Stage 3/4). Re-benchmarked for this single-item shape, not carried
// over from the old 20-comment-batch analyzer: on a real local Ollama run,
// concurrency=2 completed both calls in ~44-50s each with zero timeouts;
// concurrency=5 caused frequent Pass-A 45s timeouts and 90-123s latencies.
// Landed on the same numeric default as before for a different, verified reason.
const LLM_CONCURRENCY = Number(process.env.YT_LIVE_LLM_CONCURRENCY || 2);
const LLM_QUEUE_MAX = Number(process.env.YT_LIVE_LLM_QUEUE_MAX || 2000);
const MAX_CONSECUTIVE_ERRORS = 5;
// How stale the concurrent-stream list may get while a poller is healthy.
const STREAMS_REFRESH_MS = Number(process.env.YT_LIVE_STREAMS_REFRESH_MS || 10 * 60 * 1000);
const MAX_AVAILABLE_STREAMS = 20;

/* ─────────────────────────── state ─────────────────────────── */

const bus = new EventEmitter();
bus.setMaxListeners(0);

const pollers = new Map();      // stream_id -> { stop, videoId }
const streamMeta = new Map();   // stream_id -> { alignment, video_title } for prompt context
const checking = new Set();     // stream_ids with a checkChannel in flight
let watcherTimer = null;
let watcherRunning = false;

/* ───────────────────── fast lexicon sentiment ───────────────────── */
/*
 * Runs on EVERY message. Live chat can burst to hundreds of messages per
 * 10-second chunk, so the default path has to be allocation-cheap and
 * synchronous. The LLM only sees politically-relevant messages.
 */

const NEGATIVE_TERMS = [
    'worst', 'fail', 'failed', 'failure', 'corrupt', 'corruption', 'cheat', 'cheater', 'fraud',
    'liar', 'lies', 'fake', 'scam', 'shame', 'shameful', 'useless', 'waste', 'anti', 'against',
    'protest', 'resign', 'arrest', 'jail', 'criminal', 'looting', 'loot', 'betray', 'traitor',
    'nonsense', 'stupid', 'idiot', 'pathetic', 'disgusting', 'hate', 'worse', 'bad', 'poor',
    'unemployment', 'problem', 'issue', 'complaint', 'injustice', 'bogus', 'drama',
    // English political invective — ASCII words are matched as whole tokens,
    // so inflected forms are listed explicitly.
    'corrupted', 'scams', 'fraudster', 'liars', 'thief', 'thieves', 'shameless', 'betrayed',
    'betrayal', 'turncoat', 'turncoats', 'defector', 'defectors', 'sellout', 'nepotism',
    'dictator', 'dictatorship', 'incompetent', 'kickback', 'bribe',
    'looted', 'looters', 'commission',
    'horse trading', 'land grab', 'land mafia', 'sand mafia', 'liquor mafia',
    // Telangana-specific lines of attack, in the phrasing they actually appear in.
    'family rule', 'family party', 'dynasty', 'farmhouse', 'phone tapping', 'vote theft',
    'broken promise', 'broken promises', 'betrayed farmers', 'jobless',
    // Romanised Telugu — a large share of live chat is written this way, and
    // none of it matches either the English or the Telugu-script list.
    'dongalu', 'donga', 'avineethi', 'kummakku', 'mosam', 'mosagadu', 'abaddam', 'abaddalu',
    'nirudyoga', 'nirudyogam', 'rajeenama', 'sigguleni', 'padavi', 'kutra', 'dopidi',
    'moshapoyaru', 'cheyyaledu', 'chesindi ledu', 'vifalam', 'vaifalyam',
    // Telugu script — stems, matched as substrings, so 'అవినీతి' covers its inflections.
    'అవినీతి', 'కుంభకోణం', 'దోపిడీ', 'దొంగ', 'లంచం', 'మోసం', 'అబద్ధం',
    'వైఫల్యం', 'నిరుద్యోగ', 'రాజీనామా', 'సిగ్గులేని', 'కుట్ర', 'విమర్శ',
    'నిరసన', 'ధర్నా', 'అరెస్ట్', 'జైలు', 'దగా', 'డ్రామా',
];

const POSITIVE_TERMS = [
    'good', 'great', 'best', 'excellent', 'support', 'supporting', 'welcome', 'thanks', 'thank you',
    'congrats', 'congratulations', 'proud', 'well done', 'super', 'awesome', 'fantastic',
    'development', 'progress', 'growth', 'achievement', 'success', 'hope', 'trust', 'leader',
    'visionary', 'strong', 'brave', 'honest', 'jai', 'long live', 'blessing',
    // Romanised Telugu praise, as typed in live chat.
    'chala bagundi', 'bagundi', 'manchi', 'adiripoindi', 'super anna', 'gelupu', 'jai',
    'abhinandanalu', 'dhanyavadalu', 'mahanubhavudu', 'nayakudu', 'abhivrudhi',
    // Telugu script.
    'బాగుంది', 'మంచి', 'అభివృద్ధి', 'అభినందనలు', 'ధన్యవాదాలు',
    'గెలుపు', 'నాయకుడు', 'జయ', 'మద్దతు', 'సంక్షేమం',
];

const buildMatcher = (terms) => {
    const ascii = new Set(terms.filter((t) => /^[a-z]+$/.test(t)));
    const other = terms.filter((t) => !/^[a-z]+$/.test(t));
    return { ascii, other };
};

const NEG = buildMatcher(NEGATIVE_TERMS);
const POS = buildMatcher(POSITIVE_TERMS);

const countHits = (lower, tokens, matcher) => {
    let hits = 0;
    for (const t of tokens) if (matcher.ascii.has(t)) hits++;
    for (const t of matcher.other) if (lower.includes(t)) hits++;
    return hits;
};

// Single lowercase+tokenize pass, reused by lexiconSentiment AND the
// relevance gate below (analyzeFast calls this once and passes the result
// to both) — avoids scanning the same message text twice.
const tokenize = (text) => {
    const lower = String(text || '').toLowerCase();
    const tokens = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return { lower, tokens };
};

const lexiconSentimentFromTokens = (lower, tokens) => {
    if (!lower.trim()) return { sentiment: 'neutral', score: 0 };

    const neg = countHits(lower, tokens, NEG);
    const pos = countHits(lower, tokens, POS);

    if (neg === 0 && pos === 0) return { sentiment: 'neutral', score: 0 };
    if (neg > pos) return { sentiment: 'negative', score: Math.min(1, neg / 3) };
    if (pos > neg) return { sentiment: 'positive', score: Math.min(1, pos / 3) };
    return { sentiment: 'neutral', score: 0.2 };
};

// Public standalone form — unchanged signature, still used by
// scripts/rescore_live_chat.js and scripts/backfill_live_chat_sentiment.js.
// Internally just tokenizes once and delegates; analyzeFast() below bypasses
// this wrapper and calls lexiconSentimentFromTokens directly with the
// tokens it already computed.
const lexiconSentiment = (text) => {
    const { lower, tokens } = tokenize(text);
    return lexiconSentimentFromTokens(lower, tokens);
};

/* ───────────────────── canonical single-comment analysis ─────────────────────
 *
 * Every political comment is analyzed one at a time through the SAME
 * canonical engine Grievances use (analysisService.analyzeContent), via
 * liveChatCanonicalAnalyzer. Not batched: the canonical engine has no
 * batched code path, and building one here would just recreate the second,
 * YouTube-only sentiment implementation this replaces.
 *
 * Fair, per-stream round-robin scheduling: a busy stream's backlog sits in
 * its OWN queue, not one shared FIFO — so a stream with 500 pending comments
 * can never delay a quiet stream's first comment past its own turn.
 * LLM_CONCURRENCY workers each pull the next item from whichever stream is
 * next in rotation.
 */

const streamQueues = new Map();   // stream_id -> [{ id, text, stream_id }]
const streamOrder = [];           // round-robin rotation of stream_ids with pending work
let llmActive = 0;          // in-flight single-item analyses
let llmDropped = 0;
let llmScored = 0;
let llmFailed = 0;
let llmRetried = 0;

// Identical text arriving concurrently (spam/copypasta bursts, or several
// authors pasting the same line within the same second) shares ONE canonical
// call instead of firing N — registered at ENQUEUE time (not just once
// analysis starts), so a duplicate that is still waiting in the queue also
// piggybacks on the leader's result rather than taking its own worker slot.
// Same in-flight-dedup shape already proven in translationService.js. Every
// message still gets its own claim/status/SSE update; only the underlying
// analyzeContent() call is shared. dedupResolvers guarantees the shared
// promise always settles — even on an unexpected error — so a follower can
// never hang waiting on a leader that silently failed.
const inFlightByText = new Map();   // normalizedText -> Promise<{ok, ...}>
const dedupResolvers = new Map();   // normalizedText -> resolve fn for that promise
const normalizeForDedup = (text) => String(text || '').trim().toLowerCase();

const settleDedup = (key, outcome) => {
    const resolve = dedupResolvers.get(key);
    if (resolve) {
        dedupResolvers.delete(key);
        inFlightByText.delete(key);
        resolve(outcome);
    }
};

const queueLength = () => {
    let n = 0;
    for (const q of streamQueues.values()) n += q.length;
    return n;
};

// Round-robin: take one item from the stream at the front of the rotation;
// if that stream still has more queued work, it goes to the BACK of the
// rotation rather than being served again immediately. So every stream with
// pending work gets one item processed per "round" before any stream gets a
// second — a 500-deep backlog on stream A cannot push stream B's one
// waiting comment more than one turn back.
const nextQueueEntry = () => {
    if (!streamOrder.length) return null;
    const streamId = streamOrder.shift();
    const q = streamQueues.get(streamId);
    const entry = q.shift();
    if (q.length) {
        streamOrder.push(streamId);
    } else {
        streamQueues.delete(streamId);
    }
    return entry;
};

// Bounded retry for transient failures (Ollama timeout/503/etc). Never
// silent-permanent-drop: after MAX_RETRIES the row lands on 'failed', a
// terminal, visible state — not a fabricated result and not a vanished one.
const MAX_RETRIES = Number(process.env.YT_LIVE_ANALYSIS_MAX_RETRIES || 2);
const RETRY_DELAY_MS = Number(process.env.YT_LIVE_ANALYSIS_RETRY_DELAY_MS || 5000);

// Marks a claimed-but-unresolved item either back to 'pending' (+ requeue)
// if retries remain, or terminally 'failed' once MAX_RETRIES is exhausted.
const failOrRetry = async (entry, reason) => {
    const current = await LiveChatMessage.findOne({ id: entry.id }).select('retry_count').lean();
    const retryCount = (current?.retry_count || 0) + 1;

    if (retryCount <= MAX_RETRIES) {
        await LiveChatMessage.updateOne(
            { id: entry.id },
            { $set: { analysis_status: 'pending', analysis_queued_at: new Date(), retry_count: retryCount, analysis_reason: reason } }
        );
        llmRetried++;
        // Small delay so a struggling Ollama instance isn't hit again instantly.
        setTimeout(() => enqueueLlm({ id: entry.id, text: entry.text, stream_id: entry.stream_id }), RETRY_DELAY_MS);
    } else {
        await LiveChatMessage.updateOne(
            { id: entry.id },
            { $set: { analysis_status: 'failed', analysis_completed_at: new Date(), retry_count: retryCount, analysis_reason: reason } }
        );
        llmFailed++;
    }
};

// Persists a settled outcome onto one message's row and emits its SSE
// update. Shared by both the leader (real analysis) and any dedup followers
// (piggybacking on the leader's outcome) so every message gets an identical,
// correct persistence/emit path regardless of which one produced the result.
const applyOutcome = async (entry, outcome) => {
    if (!outcome.ok) {
        // Canonical engine returned an unusable result or errored. Never
        // fabricate sentiment/stance/risk here — retry (bounded) or fail.
        await failOrRetry(entry, outcome.reason || 'analysis_failed');
    } else {
        try {
            await LiveChatMessage.updateOne({ id: entry.id }, { $set: buildLiveChatAnalysisUpdate(outcome.result) });
            llmScored++;
        } catch (err) {
            // A bad field in the update (or a transient DB error) must never
            // leave the row stuck in 'analyzing' with no result and no SSE
            // update — retry/fail through the same bounded path.
            console.warn('[YTLive] persisting analysis result failed:', err.message);
            await failOrRetry(entry, `persist_error: ${err.message}`);
        }
    }

    // Counters were incremented with the placeholder sentiment at insert
    // time; re-sync from the collection so totals match what is stored.
    await resyncStreamCounts(entry.stream_id);

    const doc = await LiveChatMessage.findOne({ id: entry.id }).lean();
    if (doc) bus.emit('message:update', { stream_id: doc.stream_id, message: doc });
};

const runOneItem = async (entry) => {
    const key = normalizeForDedup(entry.text);
    const startedAt = new Date();
    try {
        // Atomic claim: flips pending -> analyzing only if it is still pending.
        // Guards against the same message being analyzed (and billed against
        // the LLM) twice from an accidental double-enqueue, a retry race, or
        // a restart mid-queue.
        const claimed = await LiveChatMessage.findOneAndUpdate(
            { id: entry.id, analysis_status: 'pending' },
            { $set: { analysis_status: 'analyzing', analysis_started_at: startedAt } }
        );
        if (!claimed) {
            // Already claimed/analyzed elsewhere — but any dedup followers
            // waiting on THIS text are still owed a settlement, or they'd hang.
            settleDedup(key, { ok: false, reason: 'leader_already_claimed_elsewhere' });
            return;
        }

        // Tell the frontend analysis genuinely started now, with the real
        // measured typical duration (or null — never a guess) so its
        // progress bar can compute elapsed/expected from real numbers only.
        // Fire-and-forget: this is a display hint, not on the critical path.
        LiveChatMessage.findOne({ id: entry.id }).lean().then((doc) => {
            if (doc) bus.emit('message:update', { stream_id: doc.stream_id, message: { ...doc, expected_duration_ms: getExpectedDurationMs() } });
        }).catch(() => {});

        const outcome = await analyzeLiveComment(entry.text).catch((err) => ({ ok: false, reason: `error: ${err.message}` }));
        // Hand the result to any followers waiting on this exact text BEFORE
        // our own (slower) persistence round trip, so they aren't held up by it.
        settleDedup(key, outcome);

        // Record REAL measured timing for this leader's own solo processing
        // (never for dedup followers, whose "duration" would be meaningless —
        // they never actually ran their own analysis). Recorded regardless of
        // outcome.ok so a slow-but-eventually-fallback verdict still counts
        // as real observed processing time.
        pushSample(recentDurationsMs, Date.now() - startedAt.getTime());
        if (entry.queued_at) {
            pushSample(recentWaitsMs, startedAt.getTime() - new Date(entry.queued_at).getTime());
        }

        await applyOutcome(entry, outcome);
    } catch (err) {
        // Truly unexpected failure (e.g. the claim query itself threw) —
        // still guarantee followers don't hang forever.
        settleDedup(key, { ok: false, reason: `error: ${err.message}` });
        throw err;
    }
};

const drainLlmQueue = () => {
    while (llmActive < LLM_CONCURRENCY) {
        const entry = nextQueueEntry();
        if (!entry) break;
        llmActive++;
        runOneItem(entry)
            .catch((err) => console.warn('[YTLive] single-item analysis failed:', err.message))
            .finally(() => {
                llmActive--;
                drainLlmQueue();
            });
    }
};

const enqueueLlm = (entry) => {
    const key = normalizeForDedup(entry.text);
    const existing = inFlightByText.get(key);
    if (existing) {
        // A duplicate is already queued or being analyzed — piggyback on its
        // eventual result instead of taking a second worker slot / LLM call.
        existing
            .then((outcome) => applyOutcome(entry, outcome))
            .catch((err) => console.warn('[YTLive] dedup follower failed:', err.message));
        return true;
    }

    if (queueLength() >= LLM_QUEUE_MAX) {
        llmDropped++;
        return false;
    }
    let q = streamQueues.get(entry.stream_id);
    if (!q) {
        q = [];
        streamQueues.set(entry.stream_id, q);
        streamOrder.push(entry.stream_id); // a stream with fresh work joins the back of the rotation
    }
    // Real timestamp of THIS (re)queue — used for the real wait-duration
    // sample once this item is claimed, and to seed a real elapsed-wait
    // display while it's still pending.
    entry.queued_at = new Date();
    q.push(entry);

    // Register this text as in-flight immediately — covers the queued-but-
    // not-yet-processing window too, not just active analysis.
    inFlightByText.set(key, new Promise((resolve) => dedupResolvers.set(key, resolve)));

    drainLlmQueue();
    return true;
};

/* ───────────────────── real timing stats (for the progress UI) ─────────────────────
 *
 * A rolling window of ACTUAL measured durations from real completed
 * analyses — the only input the frontend progress bar is allowed to use to
 * compute an expected duration. Never hard-coded, never a guess. Resets on
 * process restart; seedDurationStats() reseeds it from the DB's own recent
 * history so a fresh process isn't blind on its first few comments.
 */
const MAX_STAT_SAMPLES = 30;
const recentDurationsMs = [];   // real analysis_started_at -> analysis_completed_at, successful only
const recentWaitsMs = [];       // real analysis_queued_at -> analysis_started_at, successful only

const pushSample = (arr, value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
    arr.push(value);
    if (arr.length > MAX_STAT_SAMPLES) arr.shift();
};

const median = (arr) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};

// Median of real recent successful analyses. null (not a guessed number)
// when there is no real history yet — the frontend must not render a
// percentage bar in that case, only real elapsed time.
const getExpectedDurationMs = () => median(recentDurationsMs);

const seedDurationStats = async () => {
    try {
        const recent = await LiveChatMessage.find({
            analysis_status: 'complete',
            analysis_started_at: { $ne: null },
            analysis_completed_at: { $ne: null },
        })
            .select('analysis_started_at analysis_completed_at analysis_queued_at')
            .sort({ analysis_completed_at: -1 })
            .limit(MAX_STAT_SAMPLES)
            .lean();
        for (const d of recent.reverse()) {
            pushSample(recentDurationsMs, new Date(d.analysis_completed_at).getTime() - new Date(d.analysis_started_at).getTime());
            if (d.analysis_queued_at) {
                pushSample(recentWaitsMs, new Date(d.analysis_started_at).getTime() - new Date(d.analysis_queued_at).getTime());
            }
        }
        if (recentDurationsMs.length) {
            console.log(`[YTLive] seeded timing stats from ${recentDurationsMs.length} real recent completions (median duration ${getExpectedDurationMs()}ms)`);
        } else {
            console.log('[YTLive] no prior completions to seed timing stats from — progress bar will show real elapsed time only until the first analysis finishes.');
        }
    } catch (err) {
        console.warn('[YTLive] seedDurationStats failed (non-fatal):', err.message);
    }
};

/* ───────────────────── message analysis ───────────────────── */

const SENTIMENT_TO_RISK = { negative: 'high', neutral: 'low', positive: 'low' };

/**
 * Convert raw emotional TONE into client-axis sentiment.
 *
 * Tone alone is meaningless here: "Revanth zindabad" is warm in tone but hostile to
 * the client, and "Sardesai fottkiro" ("Sardesai is a liar") is hostile in
 * tone but FAVOURABLE to the client. Polarity therefore has to be flipped
 * whenever the praise or attack is aimed at the opposition.
 *
 *   praise  ally       -> positive      attack ally       -> negative
 *   praise  opposition -> negative      attack opposition -> positive
 */
const toClientAxis = (tone, ctx) => {
    if (tone === 'neutral') return 'neutral';

    const hasAlly = ctx.has_bsk_mention || ctx.has_ally_mention;
    const hasOpp = ctx.has_opposition_mention;

    // Both camps named — the deterministic pass can't tell who is being
    // praised vs attacked. Leave it to the LLM rather than guess.
    if (hasAlly && hasOpp) return 'neutral';

    if (hasOpp) return tone === 'positive' ? 'negative' : 'positive';   // flip
    if (hasAlly) return tone;                                           // keep

    // No political target: mirror resolveBskSentiment's "unrelated" rule so
    // generic chatter never lands in the negative bucket.
    return tone === 'positive' ? 'positive' : 'neutral';
};

/**
 * Deterministic guard over the LLM's stance.
 *
 * The LLM sometimes recognises that a message is an attack but assigns it to
 * the wrong axis — an attack on an opposition leader coming back anti-client,
 * when attacking the opposition is by definition pro-client. When only ONE
 * camp is named the correct stance is fully determined, so we override rather
 * than trust the model.
 */
const enforceBatchConsistency = (verdict, ctx, lexiconTone = 'neutral') => {
    const hasAlly = ctx.has_bsk_mention || ctx.has_ally_mention;
    const hasOpp = ctx.has_opposition_mention;

    // No political target at all, or both camps named — the model's reading is
    // the best available, because tone alone can't say who it lands on.
    if (!hasAlly && !hasOpp) return verdict;
    if (hasAlly && hasOpp) return verdict;

    // Exactly one camp is named, so tone fully determines the answer.
    //
    // The 7B models available here are unreliable on regional-language slang
    // (in testing, "X is a cheater" in a regional language came back as
    // "supporting X").
    // When the model reports no usable tone but the lexicon matched an
    // unambiguous term, trust the lexicon — a term match is evidence,
    // "neutral"/"unrelated" is just the model's default.
    const tone = verdict.tone !== 'neutral' ? verdict.tone : lexiconTone;
    if (tone !== 'positive' && tone !== 'negative') return verdict;

    const camp = hasOpp ? 'opposition' : 'ours';
    const corrected =
        camp === 'opposition'
            ? (tone === 'negative' ? 'pro_client' : 'anti_client')   // attacking them helps the client
            : (tone === 'negative' ? 'anti_client' : 'pro_client');  // attacking us hurts the client

    if (verdict.stance === corrected) return verdict;

    console.log(
        `[YTLive] stance corrected: ${camp}-only mention, ${tone} tone -> ${corrected} (model said ${verdict.stance})`
    );
    return {
        ...verdict,
        stance: corrected,
        sentiment: corrected === 'pro_client' ? 'positive' : 'negative',
    };
};

/**
 * Name the message's language from the detector's flags.
 *
 * `language_hints` is an OBJECT ({ has_telugu, has_hindi, … }), so indexing
 * it with [0] silently yielded undefined and left every row's language null.
 *
 * Latin is checked last on purpose: Telugu chat is full of stray English
 * words, and a single roman token should not make the message read as English.
 * Romanised Telugu is checked BEFORE Hindi/Hinglish because it is far more
 * common in this state, and the two marker sets can both fire on a mixed post.
 */
const LANGUAGE_BY_HINT = [
    ['has_telugu', 'telugu'],
    ['has_telugu_roman', 'telugu'],
    ['has_hindi', 'hindi'],
    ['has_hinglish', 'hindi'],
    ['has_tamil', 'tamil'],
    ['has_kannada', 'kannada'],
    ['has_urdu', 'urdu'],
    ['has_arabic', 'arabic'],
    ['has_latin', 'english'],
];

const pickLanguage = (hints) => {
    if (!hints || typeof hints !== 'object') return null;
    for (const [flag, name] of LANGUAGE_BY_HINT) {
        if (hints[flag]) return name;
    }
    return null;
};

/* ───────────────────── chat relevance gate (deterministic signal combinations) ────
 *
 * A message naming a leader/party is not automatically political: bare-name
 * fan noise ("BJP🔥", "viva babush") carries no monitorable signal, while a
 * genuinely political message may name nobody ("sorkar kiteak udok dina?").
 * So this gate requires a SIGNAL COMBINATION — no single generic word (price,
 * official, why, project, ...) is ever sufficient by itself.
 *
 *   entity      — ctx.mentioned_entities (roster, incl. bare party short-forms
 *                 "bjp"/"inc"/"aap"/"bsp"/"ggp" with word-boundary
 *                 protection via config/politicalEntities.js PARTY_ALIASES)
 *   institution — strong, low-ambiguity governance vocabulary (government,
 *                 minister, MLA, election, Naxal, paddy procurement, ...) —
 *                 unconditionally sufficient alone, plus a digit-guarded 'cm'
 *                 check (hasPoliticalCm)
 *   topic       — softer public-policy words (price, tax, jobs, project,
 *                 casino, tourism, ...) — NOT sufficient alone; needs a second
 *                 signal (criticism/action/civic/question)
 *   action      — political-action verbs (announced, banned, promised, ...)
 *   criticism   — NEGATIVE_TERMS, plus RELEVANCE_CRITICISM_TERMS
 *   praise      — political slogans/praise (jai, viva, zindabad, ...)
 *   civic       — politicalContextService.has_civic_signal
 *   civicMarker — "X was not given/received/done" negation forms (Hindi,
 *                 Telugu, English), confirming a service-non-delivery
 *                 complaint
 *   question    — question/demand words — only ever combined with topic/civic
 *
 * Matching (see buildMatcher): single ASCII words match as WHOLE TOKENS;
 * everything else (Devanagari, multi-word phrases) matches as a SUBSTRING, so
 * Devanagari entries are stems and must be long enough not to hide inside
 * unrelated words. Very short Devanagari words (का, जय, लाच, जाय) are left out
 * for exactly that reason.
 *
 * Vocabulary from Telangana Telugu media and everyday usage; romanised
 * spelling is not standardised, so extend with variants seen in real chat.
 */
const POLITICAL_CONTEXT_TERMS = [
    // NB: bare 'cm' is deliberately ABSENT — it is digit-guarded separately by
    // hasPoliticalCm(), or "5 cm long" would score as political.
    'government', 'minister', 'chief minister', 'mla', 'mlc', 'mp', 'party', 'election',
    'assembly', 'cabinet', 'opposition leader', 'lok sabha', 'rajya sabha', 'legislative council',
    'zilla parishad', 'mandal parishad', 'gram panchayat', 'corporation', 'ghmc',
    'telangana government', 'telangana govt', 'state government', 'government scheme',
    // Romanised Telugu institution vocabulary.
    'prabhutvam', 'mantri', 'mukhyamantri', 'shasana sabha', 'ennikalu', 'neta', 'party',
    // Near-unconditionally political Telangana issues.
    'kaleshwaram', 'medigadda', 'phone tapping', 'formula e', 'dharani', 'bhu bharati',
    'rythu bandhu', 'rythu bharosa', 'dalit bandhu', 'mission bhagiratha', 'indiramma',
    'gruha jyothi', 'hydraa', 'musi', 'bc reservation', 'loan waiver', 'tgpsc', 'tspsc',
    'paper leak', 'sheep scam', 'liquor scam', 'land grabbing',
    // Telugu governance vocabulary, as stems.
    'ప్రభుత్వ', 'మంత్రి', 'ముఖ్యమంత్రి', 'ఎమ్మల్యే', 'ఎంపి',
    'అసెంబ్లీ', 'శాసనసభ', 'ఎన్నిక', 'పార్టీ', 'అవినీతి',
    'పంచాయతీ', 'కార్పొరేషన్', 'పథకం', 'రాష్ట్ర',
];

/**
 * Softer "topic" words — public-policy subject matter too generic to be
 * unconditionally political alone (see isChatRelevant for the required
 * second signal). Anything already in politicalContextService's
 * CIVIC_GRIEVANCE_TOKENS (water, power, roads, pension, ...) is left out —
 * those already drive ctx.has_civic_signal.
 *
 */
const POLITICAL_TOPIC_TERMS = [
    'price', 'prices', 'tax', 'taxes', 'job', 'jobs', 'employment', 'naukri',
    'education', 'healthcare', 'infrastructure', 'repair', 'repaired',
    'project', 'projects', 'inflation', 'mehngai', 'mehangai', 'tourism',
    'coal', 'mining', 'price rise', 'govt job', 'govt jobs', 'bharti', 'vacancy',
    'tendu', 'tendu patta', 'khaad', 'fertiliser', 'fertilizer', 'bonus',
    'महंगाई', 'महँगाई', 'बेरोजगारी', 'नौकरी', 'भर्ती', 'परियोजना', 'शिक्षा',
    'पर्यटन', 'कोयला', 'खनन', 'तेंदूपत्ता', 'खाद', 'बोनस',
];

/**
 * Words safe as a political signal ONLY when a named political entity is
 * already confirmed present — never as a standalone TOPIC: "why is the budget
 * so high for our trip" is not political, "Sai budget" is.
 */
const ENTITY_QUALIFIED_TOPIC_TERMS = [
    'policy', 'budget', 'official', 'officials', 'reservation', 'quota',
    'बजट', 'आरक्षण', 'नीति',
];

// Political-action verbs. English-only — generic verbs ("changed", "said")
// stay out. 'increased'/'reduced' are excluded: they collide with 'price' in
// ordinary shop talk ("this shop increased the price").
const POLITICAL_ACTION_TERMS = [
    'announced', 'announce', 'implemented', 'implement',
    'banned', 'ban', 'approved', 'approve',
    'demanded', 'demand', 'promised', 'promise',
];

// Question/demand words — only ever combined with topic/civic below, never
// sufficient alone. Hindi 'का' is left out (it is also "of"), as are other
// words too short to substring-match safely.
const QUESTION_DEMAND_TERMS = [
    'why', 'should', 'must', 'we want', 'we demand', 'when will', 'kyon', 'kyun',
    'kab tak', 'kab milega', 'kabar', 'kab',
    'क्यों', 'कब तक', 'कब मिलेगा', 'चाहिए', 'काबर', 'कब',
];

// Unambiguous political sloganeering, entity-gated only (see isChatRelevant).
const POLITICAL_PRAISE_TERMS = [
    'jai', 'victory', 'zindabad', 'jindabad', 'jai hind', 'abhinandan',
    'jai telangana', 'jai brs', 'jai kcr',
    'జయ', 'జిందాబాద్', 'జయ తెలంగాణ', 'జయ హింద్', 'అభినందనలు',
];

// "X was not given / received / done" negation forms — confirms an actual
// service-non-delivery complaint even when NEGATIVE_TERMS doesn't match.
// Telugu forms the negative with లేదు ("రాలేదు" = "did not come"). Bare
// ना / नहीं / nahi ("no") are excluded: they are plain "no" in ordinary chat
// and would reintroduce the false-positive class.
const CIVIC_COMPLAINT_MARKERS = [
    // Telugu negatives: the "did not come / did not happen / has not been done"
    // forms that mark a grievance without naming anyone.
    'రాలేదు', 'లేదు', 'కాలేదు', 'అవ్వలేదు', 'ఇవ్వలేదు',
    'చేయలేదు', 'చేయడం లేదు', 'అందలేదు', 'పడలేదు', 'మంజూరు కాలేదు',
    // Romanised Telugu.
    'raledu', 'ledu', 'ledhu', 'kaledu', 'avvaledu', 'ivvaledu', 'cheyaledu',
    'andaledu', 'padaledu', 'inka raledu',
    // English.
    'not received', 'not done', 'no action', 'no response', 'still waiting',
    'yet to receive', 'nothing happened',
];

/**
 * Criticism terms carrying a political charge in Telangana that NEGATIVE_TERMS
 * (built for sentiment scoring, not relevance) doesn't carry. Kept
 * CRITICISM-tier only — never sufficient alone, always needs the accompanying
 * entity or civic signal.
 */
const RELEVANCE_CRITICISM_TERMS = [
    'turncoat', 'turncoats', 'horse trading', 'defection', 'defected', 'defectors',
    'land grab', 'land mafia', 'sand mafia', 'liquor mafia',
    'sellout', 'commission', 'family rule', 'dynasty', 'vote theft',
    'dopidi', 'kummakku', 'avineethi', 'mosam', 'sigguleni',
    'అవినీతి', 'దోపిడీ', 'కుట్ర', 'మోసం', 'భూ మాఫియా',
];

/**
 * Political relevance is NOT restricted to entities in this app's own
 * ally/opposition roster. Telangana chat regularly discusses neighbouring-
 * state politics — Odisha over the Mahanadi waters, Madhya Pradesh, Jharkhand
 * and Telangana — and those messages are still political.
 *
 * This list only extends what counts as "a named political entity" for the
 * entity branch of isChatRelevant; it carries no alignment and is never
 * sufficient alone.
 */
const GENERIC_POLITICAL_ENTITY_TERMS = [
    'odisha', 'naveen patnaik', 'mohan majhi', 'mohan yadav', 'madhya pradesh',
    'jharkhand', 'hemant soren', 'telangana', 'revanth reddy',
    'ओडिशा', 'झारखंड', 'मध्यप्रदेश', 'मध्य प्रदेश',
];

const CONTEXT_TERMS = buildMatcher(POLITICAL_CONTEXT_TERMS);
const TOPIC_TERMS = buildMatcher(POLITICAL_TOPIC_TERMS);
const ENTITY_QUALIFIED_TOPIC = buildMatcher(ENTITY_QUALIFIED_TOPIC_TERMS);
const ACTION_TERMS = buildMatcher(POLITICAL_ACTION_TERMS);
const QUESTION_TERMS = buildMatcher(QUESTION_DEMAND_TERMS);
const PRAISE_TERMS = buildMatcher(POLITICAL_PRAISE_TERMS);
const CIVIC_MARKERS = buildMatcher(CIVIC_COMPLAINT_MARKERS);
const RELEVANCE_CRITICISM = buildMatcher(RELEVANCE_CRITICISM_TERMS);
const GENERIC_POLITICAL_ENTITY = buildMatcher(GENERIC_POLITICAL_ENTITY_TERMS);

/**
 * The "5 cm long" false-positive guard. 'cm' is excluded from the flat
 * CONTEXT_TERMS list (plain Set/substring matching) and checked here
 * instead: a measurement always has a NUMBER immediately before "cm" ("5
 * cm", "10 cm"), while political usage doesn't ("amcho cm", "cm government",
 * "cm action"). O(1) extra check per 'cm' occurrence, reuses the tokens
 * array analyzeFast() already computed.
 */
const isNumericToken = (t) => /^[0-9]+$/.test(t);
const hasPoliticalCm = (tokens) => {
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] !== 'cm') continue;
        const prev = i > 0 ? tokens[i - 1] : null;
        if (!prev || !isNumericToken(prev)) return true;
    }
    return false;
};

const isChatRelevant = (lower, tokens, ctx) => {
    if (!lower.trim()) return false;

    const hasCriticism = countHits(lower, tokens, NEG) > 0 || countHits(lower, tokens, RELEVANCE_CRITICISM) > 0;
    const hasCivicMarker = countHits(lower, tokens, CIVIC_MARKERS) > 0;

    // Civic-grievance signal (power cuts, water, roads, farmer distress, ...)
    // needs a second confirming signal — an existing criticism-lexicon hit,
    // an explicit service-non-delivery marker, or a question/demand
    // word.
    if (ctx.has_civic_signal) {
        if (hasCriticism || hasCivicMarker) return true;
        if (countHits(lower, tokens, QUESTION_TERMS) > 0) return true;
    }

    // Governance vocabulary needs no named entity — this is what catches
    // "sorkar kiteak kaim korina" (why is the government doing nothing).
    if (countHits(lower, tokens, CONTEXT_TERMS) > 0) return true;
    if (hasPoliticalCm(tokens)) return true;

    // A softer "topic" word (price, tax, jobs, project, ...) needs a second,
    // INDEPENDENT signal — criticism, a political-action verb, an explicit
    // civic non-delivery marker, or a question/demand word.
    //
    // Deliberately hasCivicMarker here, NOT the bare ctx.has_civic_signal
    // boolean: a topic word can ALSO be a civic-service noun in the shared
    // civic lexicon, so has_civic_signal can become true from the SAME word
    // that made hasTopic true — collapsing "topic + confirmation" into "topic
    // alone" (an astrology-spam message mentioning "job" once passed exactly
    // this way). hasCivicMarker requires an explicit "X was not done/given"
    // negation form instead of just any civic-service noun, so it stays a
    // genuinely distinct signal ("project funds diunk na" passes; a bare spam
    // mention does not).
    const hasTopic = countHits(lower, tokens, TOPIC_TERMS) > 0;
    const hasAction = countHits(lower, tokens, ACTION_TERMS) > 0;
    if (hasTopic) {
        if (hasCriticism || hasAction || hasCivicMarker) return true;
        if (countHits(lower, tokens, QUESTION_TERMS) > 0) return true;
    }

    // No named political entity — mentioned_entities already resolves bare
    // party short-forms (see the comment block above); GENERIC_POLITICAL_ENTITY
    // extends this to well-known politics outside this app's own ally/
    // opposition roster (see its own comment) so political relevance isn't
    // restricted to this state's roster. Nothing below is reachable
    // without one, and — same as a roster entity — neither is sufficient
    // alone.
    const hasEntity = (ctx.mentioned_entities || []).length > 0
        || countHits(lower, tokens, GENERIC_POLITICAL_ENTITY) > 0;
    if (!hasEntity) return false;

    // Both camps named in one message is a comparison — inherently political.
    const hasAlly = ctx.has_bsk_mention || ctx.has_ally_mention;
    if (hasAlly && ctx.has_opposition_mention) return true;

    // Entity + real criticism (curated lexicon: corruption, fraud, resign,
    // traitor, backstab, ...) is criticism, not fan noise.
    if (hasCriticism) return true;

    // Entity + an unambiguous political-slogan/praise word.
    if (countHits(lower, tokens, PRAISE_TERMS) > 0) return true;

    // Entity + political topic.
    if (hasTopic) return true;

    // Entity + a topic word too ambiguous to trust standalone (policy,
    // budget, official, reservation, quota — see ENTITY_QUALIFIED_TOPIC_TERMS).
    if (countHits(lower, tokens, ENTITY_QUALIFIED_TOPIC) > 0) return true;

    // NOTE: entity + bare question/demand word ("when is Babush coming to
    // the feast?") is DELIBERATELY NOT a relevance signal: personal and
    // social questions about a named leader are common and not political.
    // A question about a policy or service still passes via the topic/civic
    // branches above.

    // Bare entity mention, or entity + only generic/fan wording — noise
    // ("BRS🔥", "jai telangana", "hi Revanth").
    return false;
};

/**
 * Synchronous first pass — deterministic political context + lexicon sentiment.
 * Every message gets this immediately so nothing waits on a model.
 */
const analyzeFast = (text) => {
    const ctx = buildPoliticalContext(text, { platform: 'youtube_live' });
    // Tokenize once here; both the sentiment lexicon and the relevance gate
    // reuse the same {lower, tokens} instead of each re-scanning the text.
    const { lower, tokens } = tokenize(text);
    const lex = lexiconSentimentFromTokens(lower, tokens);

    // lex.sentiment is raw TONE — convert it onto the client axis before
    // storing, otherwise "Revanth zindabad" reads as positive for the client.
    const sentiment = toClientAxis(lex.sentiment, ctx);

    const relevance = Number(ctx.bsk_relevance || 0);
    const isPolitical = isChatRelevant(lower, tokens, ctx);

    return {
        ctx,
        fields: {
            sentiment,
            tone: lex.sentiment,
            sentiment_score: lex.score,
            political_relevance: relevance,
            is_political: isPolitical,
            matched_entities: (ctx.mentioned_entities || []).map((e) => e.canonical || e.key).filter(Boolean),
            target_entity: ctx.primary_target || null,
            language: pickLanguage(ctx.language_hints),
            risk_level: SENTIMENT_TO_RISK[sentiment] || 'medium',
            analysis_provider: 'lexicon',
            // Lexicon fields above are an internal placeholder only, never
            // shown to the UI as a final verdict — see analysis_status.
            // Political messages start pending; the canonical engine
            // (analysisService.analyzeContent, via the queue below) is the
            // only thing that ever sets this to 'complete'/'failed'.
            analysis_status: isPolitical ? 'pending' : 'complete',
            // Real queue-entry timestamp for the "Waiting for analysis · Xs"
            // display — persistChunk enqueues this same message immediately
            // after insert, so this is accurate to within milliseconds.
            analysis_queued_at: isPolitical ? new Date() : null,
        },
    };
};

/**
 * Recompute a stream's counters from the collection.
 *
 * Counts are first incremented using the placeholder sentiment, so once the
 * LLM overrules it they have to be re-derived rather than adjusted.
 */
const resyncStreamCounts = async (streamId, videoId) => {
    // Scoped to one broadcast. Without video_id this counted every message the
    // channel ever received, so counters silently jumped from "this broadcast"
    // to "all history" the first time an LLM batch landed.
    //
    // Omitted videoId resolves to the doc's current broadcast, so the backfill
    // scripts keep working unchanged.
    let scope = videoId;
    if (scope === undefined) {
        const doc = await LiveStream.findOne({ id: streamId }).select('video_id').lean();
        scope = doc?.video_id || null;
    }

    const match = { stream_id: streamId };
    if (scope) match.video_id = scope;

    const rows = await LiveChatMessage.aggregate([
        { $match: match },
        { $group: { _id: '$sentiment', n: { $sum: 1 } } },
    ]);

    const counts = { positive: 0, neutral: 0, negative: 0 };
    let total = 0;
    for (const r of rows) {
        if (r._id in counts) counts[r._id] = r.n;
        total += r.n;
    }

    await LiveStream.updateOne(
        { id: streamId },
        { $set: { sentiment_counts: counts, message_count: total } }
    );
    bus.emit('stream:counts', { stream_id: streamId, video_id: scope, sentiment_counts: counts, message_count: total });
};

/* ───────────────────── persistence ───────────────────── */

const persistChunk = async (stream, messages) => {
    if (!messages.length) return [];

    const analyzed = messages.map((m) => {
        const { ctx, fields } = analyzeFast(m.text);
        return {
            ctx,
            doc: {
                stream_id: stream.id,
                video_id: stream.video_id,
                message_id: m.message_id,
                author_channel_id: m.author_channel_id,
                author_name: m.author_name,
                author_photo: m.author_photo,
                is_moderator: m.is_moderator,
                is_member: m.is_member,
                is_owner: m.is_owner,
                text: m.text,
                // Omit entirely for the common case (no custom emoji) rather
                // than persisting an empty array on every message — paired
                // with LiveChatMessage's default-less `display_parts` field,
                // an undefined value here means the key is never written at
                // all, not stored as `[]`. Messages that do have custom
                // emoji still get the complete ordered array.
                display_parts: (m.display_parts && m.display_parts.length) ? m.display_parts : undefined,
                is_superchat: m.is_superchat,
                superchat_amount: m.superchat_amount,
                published_at: m.published_at,
                ...fields,
            },
        };
    });

    // Relevance gate — greetings, fan noise, spam, bare entity mentions, etc.
    // are dropped here, before any DB write or SSE emission, so they never
    // reach Mongo, the frontend, or the LLM queue.
    const relevant = analyzed.filter((a) => a.doc.is_political);
    if (!relevant.length) return [];

    // insertMany + ordered:false lets YouTube's message_id unique index absorb
    // duplicates (chunks overlap on reconnect) without a per-message findOne.
    let inserted = [];
    try {
        inserted = await LiveChatMessage.insertMany(
            relevant.map((a) => a.doc),
            { ordered: false, rawResult: false }
        );
    } catch (err) {
        // With ordered:false a partial success is normal — chunks overlap on
        // reconnect and the unique message_id index rejects the repeats.
        // Mongoose reports what actually landed on the error object.
        if (Array.isArray(err.insertedDocs)) {
            inserted = err.insertedDocs;
        } else if (err.code === 11000 || err.writeErrors) {
            inserted = [];
        } else {
            throw err;
        }
    }

    const insertedIds = new Set(inserted.map((d) => d.message_id));
    const fresh = relevant.filter((a) => insertedIds.has(a.doc.message_id));
    if (!fresh.length) return [];

    // counters
    const counts = { positive: 0, neutral: 0, negative: 0 };
    for (const a of fresh) counts[a.doc.sentiment] = (counts[a.doc.sentiment] || 0) + 1;

    await LiveStream.updateOne(
        { id: stream.id },
        {
            $inc: {
                message_count: fresh.length,
                'sentiment_counts.positive': counts.positive,
                'sentiment_counts.neutral': counts.neutral,
                'sentiment_counts.negative': counts.negative,
            },
            $set: { last_polled_at: new Date() },
        }
    );

    const docsById = new Map(inserted.map((d) => [d.message_id, d]));
    const emitted = fresh.map((a) => {
        const saved = docsById.get(a.doc.message_id);
        const plain = saved ? saved.toObject() : a.doc;

        // Every political comment is queued for the canonical engine — the
        // lexicon fields above are only ever a pending-state placeholder.
        if (a.doc.is_political && saved) {
            enqueueLlm({ id: plain.id, text: a.doc.text, stream_id: stream.id });
        }
        return plain;
    });

    // video_id at the top level so the UI can drop a chunk from a broadcast it
    // is no longer showing without inspecting every message.
    bus.emit('messages', { stream_id: stream.id, video_id: stream.video_id, messages: emitted });
    return emitted;
};

/* ───────────────────── poller ───────────────────── */

const startPoller = async (streamDoc) => {
    if (pollers.has(streamDoc.id)) return;

    let stopped = false;
    let timer = null;
    const state = {
        stop: () => {
            stopped = true;
            if (timer) clearTimeout(timer);
            // Only clear our own entry: switching broadcast stops the old poller
            // and starts a new one on the same stream_id, and a late stop() from
            // the old one would otherwise deregister the new one — leaving it
            // running but invisible, so the watcher starts a second.
            if (pollers.get(streamDoc.id) === state) pollers.delete(streamDoc.id);
            if (streamMeta.get(streamDoc.id)?.owner === state) streamMeta.delete(streamDoc.id);
        },
        videoId: streamDoc.video_id,
    };
    pollers.set(streamDoc.id, state);

    // Cached for the batch prompt: an opposition-aligned channel's chat reads
    // very differently from a government-aligned one, and the model should know which.
    streamMeta.set(streamDoc.id, {
        owner: state,
        alignment: streamDoc.alignment || 'unknown',
        video_title: streamDoc.video_title || '',
        poll_interval_sec: streamDoc.poll_interval_sec || 0,
    });

    /**
     * Deregister the poller and record how the stream finished.
     *
     * The write is guarded because `finish` is reached via `return finish(...)`
     * from inside tick()'s try/catch — a returned promise is NOT covered by the
     * enclosing try, so an unguarded Mongo error here escapes as an unhandled
     * rejection and takes the process down.
     */
    const finish = async (status, error = null, extra = {}) => {
        state.stop();
        try {
            await LiveStream.updateOne(
                // video_id in the filter: if we have already switched broadcast,
                // this write belongs to a stream that is no longer current and
                // must not clobber the new one's state.
                { id: streamDoc.id, video_id: streamDoc.video_id },
                { $set: { status, ended_at: new Date(), last_error: error, continuation: null, ...extra } }
            );
        } catch (err) {
            // Losing the final status write is cosmetic — the watcher re-checks
            // this channel on its next tick regardless. Crashing over it is not.
            console.warn(`[YTLive] could not persist final status for ${streamDoc.video_id}: ${err.message}`);
        }
        bus.emit('stream:status', { stream_id: streamDoc.id, status, error });
        console.log(`[YTLive] stream ${streamDoc.video_id} -> ${status}${error ? ` (${error})` : ''}`);
    };

    let ctx;
    let continuation;
    try {
        ctx = await reader.getChatContext(streamDoc.video_id);

        // Resume mid-stream if we already have a cursor, else find the real
        // "Live chat" continuation (not the filtered "Top chat" one).
        continuation = streamDoc.continuation;
        if (!continuation) {
            const picked = await reader.pickLiveContinuation(ctx);
            continuation = picked.continuation;
            if (picked.primed?.messages?.length) {
                await persistChunk(streamDoc, picked.primed.messages);
            }
        }

        await LiveStream.updateOne(
            { id: streamDoc.id },
            { $set: { status: 'live', started_at: streamDoc.started_at || new Date(), ended_at: null, last_error: null, chat_disabled: false } }
        );
    } catch (err) {
        // "No chat continuation" means either the broadcast finished OR it is
        // live with chat switched off. The stream list tells them apart: a
        // broadcast still listed as live keeps status 'live' so the video plays
        // on, and only chat is reported unavailable.
        if (err.code === 'CHAT_ENDED') {
            const stillLive = (streamDoc.available_streams || [])
                .some((s) => s.video_id === streamDoc.video_id);
            return stillLive
                ? finish('live', 'Live chat is turned off for this broadcast', { chat_disabled: true })
                : finish('ended');
        }

        // Anything else must still deregister the poller. Setup runs after the
        // map entry is created, so bailing out without finish() would leave a
        // dead entry behind and the watcher would skip this channel forever.
        return finish('error', err.message);
    }

    bus.emit('stream:status', { stream_id: streamDoc.id, status: 'live' });
    console.log(`[YTLive] polling ${streamDoc.channel_name || streamDoc.channel_ref} · ${streamDoc.video_id}`);

    let errors = 0;

    const tick = async () => {
        if (stopped) return;

        try {
            const chunk = await reader.fetchChunk(ctx, continuation);
            errors = 0;

            if (chunk.ended || !chunk.nextContinuation) {
                return finish('ended');
            }

            continuation = chunk.nextContinuation;

            if (chunk.messages.length) {
                await persistChunk(streamDoc, chunk.messages);
            }

            await LiveStream.updateOne(
                // Scoped to this broadcast — a cursor belongs to one video, and
                // writing it after a switch would resume the new stream mid-nowhere.
                { id: streamDoc.id, video_id: streamDoc.video_id },
                { $set: { continuation, last_polled_at: new Date() } }
            );

            // YouTube tells us when to come back; honour it as the FLOOR, then
            // apply the channel's own minimum on top. Polling slower is safe —
            // the continuation is a cursor, so a longer gap just returns more
            // messages per read.
            const meta = streamMeta.get(streamDoc.id) || {};
            const youtubeWait = Math.min(Math.max(chunk.timeoutMs || 5000, MIN_POLL_MS), MAX_POLL_MS);
            const floor = Number(meta.poll_interval_sec || 0) * 1000;
            timer = setTimeout(safeTick, Math.max(youtubeWait, floor));
        } catch (err) {
            // A finished broadcast surfaces here too, once the cursor stops
            // resolving — end it cleanly rather than burning the retry budget.
            if (err.code === 'CHAT_ENDED') return finish('ended');

            errors++;
            console.warn(`[YTLive] poll error (${errors}/${MAX_CONSECUTIVE_ERRORS}) ${streamDoc.video_id}: ${err.message}`);
            if (errors >= MAX_CONSECUTIVE_ERRORS) {
                return finish('error', err.message);
            }
            timer = setTimeout(safeTick, Math.min(MAX_POLL_MS, 3000 * errors)); // backoff
        }
    };

    /**
     * tick() is never awaited — it drives itself through setTimeout — so any
     * rejection that escapes it would be unhandled and would kill the process.
     * Every entry point goes through here so the loop degrades to a slow retry
     * instead.
     */
    const safeTick = () => {
        tick().catch((err) => {
            console.warn(`[YTLive] poller tick failed for ${streamDoc.video_id}: ${err.message}`);
            if (!stopped) timer = setTimeout(safeTick, MAX_POLL_MS);
        });
    };

    safeTick();
};

const stopPoller = (streamId) => {
    const p = pollers.get(streamId);
    if (p) p.stop();
};

/* ───────────────────── channel watcher ───────────────────── */

/**
 * Which broadcast to read chat from.
 *
 * Deliberately NOT a plain argmax. Two near-equal streams swap rank constantly,
 * and re-picking on every tick would stop and restart the poller each time —
 * resetting the cursor and losing messages. So a healthy poller keeps its stream
 * as long as that stream is still live; ranking only decides a fresh start.
 */
const pickTargetStream = (available, { selectedVideoId, currentVideoId } = {}) => {
    if (!available.length) return null;

    const stillLive = (id) => available.find((s) => s.video_id === id);

    return stillLive(selectedVideoId)      // user's explicit pick wins
        || stillLive(currentVideoId)       // else keep what we're already reading
        || available[0];                   // else the biggest (list is pre-sorted)
};

/**
 * The channel's live broadcasts, normalised.
 *
 * Falls back to /live when /streams yields nothing, so a single scraping path
 * breaking can't take monitoring down. Also refreshes channel identity, which
 * /streams does not carry.
 */
const resolveAvailableStreams = async (channelRef, { allowFallback = true } = {}) => {
    const list = await reader.listLiveVideos(channelRef);
    if (list.length) {
        return {
            available: list.map((v) => ({
                video_id: v.videoId,
                title: v.title,
                viewers: v.viewers,
                thumbnail: v.thumbnail,
            })).slice(0, MAX_AVAILABLE_STREAMS),
            identity: null,
        };
    }

    if (!allowFallback) return { available: [], identity: null };

    const live = await reader.resolveLiveVideo(channelRef);
    if (!live) return { available: [], identity: null };

    return {
        available: [{
            video_id: live.videoId,
            title: live.title || '',
            viewers: 0,
            thumbnail: live.thumbnail,
        }],
        identity: { channel_id: live.channelId, channel_name: live.channelName },
    };
};

/**
 * Point a channel's poller at `target`, replacing whatever it was reading.
 *
 * Counters and the chat cursor belong to one broadcast, so switching resets
 * them; re-selecting the broadcast already stored keeps them.
 */
const switchTo = async (streamDoc, target, running) => {
    if (running) stopPoller(streamDoc.id);

    const isNewBroadcast = target.video_id !== streamDoc.video_id;

    await LiveStream.updateOne(
        { id: streamDoc.id },
        {
            $set: {
                video_id: target.video_id,
                video_title: target.title || streamDoc.video_title,
                thumbnail: target.thumbnail,
                status: 'live',
                chat_disabled: false,
                last_error: null,
                ...(isNewBroadcast
                    ? { continuation: null, started_at: new Date(), ended_at: null, message_count: 0, sentiment_counts: { positive: 0, neutral: 0, negative: 0 } }
                    : {}),
            },
        }
    );

    console.log(`[YTLive] ${streamDoc.channel_name || streamDoc.channel_ref} -> ${target.video_id}`);

    const refreshed = await LiveStream.findOne({ id: streamDoc.id }).lean();
    await startPoller(refreshed);
};

/**
 * Check one tracked channel: refresh what it has live, then make sure the right
 * broadcast is being read. Uses free channel pages (no Data API quota).
 */
const checkChannel = async (streamDoc, { forceRefresh = false } = {}) => {
    // A paused channel must stay paused. The watcher already filters on
    // is_active, but the manual /refresh endpoint reaches here directly.
    if (streamDoc.is_active === false) return;

    // Serialise per channel: /refresh and selectStream call this directly,
    // bypassing the watcher's own guard, and two concurrent runs on one doc can
    // interleave into duplicate pollers.
    if (checking.has(streamDoc.id)) return;
    checking.add(streamDoc.id);

    try {
        const running = pollers.get(streamDoc.id);

        // Re-scraping /streams costs ~1MB per channel, so it is skipped while a
        // poller is healthy and the stored list is recent. The stored list is
        // still evaluated below, so a user switching stream takes effect at once
        // instead of waiting for the next scrape.
        const age = streamDoc.available_streams_updated_at
            ? Date.now() - new Date(streamDoc.available_streams_updated_at).getTime()
            : Infinity;
        const needsRefresh = forceRefresh || !running || age >= STREAMS_REFRESH_MS;

        let available = streamDoc.available_streams || [];
        let identity = null;

        if (!needsRefresh) {
            const target = pickTargetStream(available, {
                selectedVideoId: streamDoc.selected_video_id,
                currentVideoId: running.videoId,
            });
            // Nothing to do unless the choice moved off what we're reading.
            if (!target || target.video_id === running.videoId) return;
            return switchTo(streamDoc, target, running);
        }

        // Fallback only when we believed the channel was live: /live can return a
        // stale id, and applying it unconditionally would resurrect ended streams
        // every tick.
        ({ available, identity } = await resolveAvailableStreams(streamDoc.channel_ref, {
            allowFallback: streamDoc.status === 'live',
        }));

        if (!available.length) {
            stopPoller(streamDoc.id);
            // 'error' clears too: once a channel is confirmed off air, whatever
            // went wrong while it was live is history.
            const wasActive = streamDoc.status === 'live' || streamDoc.status === 'error';
            await LiveStream.updateOne(
                { id: streamDoc.id },
                {
                    $set: {
                        available_streams: [],
                        available_streams_updated_at: new Date(),
                        ...(wasActive
                            ? { status: 'ended', ended_at: new Date(), continuation: null, last_error: null }
                            : {}),
                    },
                }
            );
            if (wasActive) bus.emit('stream:status', { stream_id: streamDoc.id, status: 'ended' });
            bus.emit('stream:available', { stream_id: streamDoc.id, available_streams: [] });
            return;
        }

        const target = pickTargetStream(available, {
            selectedVideoId: streamDoc.selected_video_id,
            currentVideoId: running?.videoId || streamDoc.video_id,
        });

        // Publish the list before the short-circuit, or the picker would never
        // refresh while a poller is healthy — which is the point of the feature.
        await LiveStream.updateOne(
            { id: streamDoc.id },
            {
                $set: {
                    available_streams: available,
                    available_streams_updated_at: new Date(),
                    ...(identity?.channel_id ? { channel_id: identity.channel_id } : {}),
                    ...(identity?.channel_name ? { channel_name: identity.channel_name } : {}),
                },
            }
        );
        bus.emit('stream:available', { stream_id: streamDoc.id, available_streams: available });

        // Already reading the right broadcast — leave the poller alone.
        if (running && running.videoId === target.video_id) return;

        return switchTo(streamDoc, target, running);
    } finally {
        checking.delete(streamDoc.id);
    }
};

/**
 * Switch which broadcast a channel is read from, effective immediately.
 *
 * Uses the stored stream list rather than re-scraping, so a click switches in
 * the time it takes to open the new chat rather than waiting on a ~1MB fetch.
 * The caller has already checked the video is in that list. Returns the doc plus
 * whether the requested broadcast is the one now being read, so the API can say
 * what actually happened instead of assuming it worked.
 */
const selectStream = async (streamId, videoId) => {
    const doc = await LiveStream.findOne({ id: streamId }).lean();
    if (!doc) return null;

    await LiveStream.updateOne({ id: streamId }, { $set: { selected_video_id: videoId || null } });

    const updated = await LiveStream.findOne({ id: streamId }).lean();
    await checkChannel(updated);

    const channel = await LiveStream.findOne({ id: streamId }).lean();
    return {
        channel,
        applied: !videoId || channel.video_id === videoId,
        chat_disabled: !!channel.chat_disabled,
    };
};

// How long after adding a channel to give its first /streams scrape a
// follow-up check.
const NEW_CHANNEL_RECHECK_MS = Number(process.env.YT_LIVE_NEW_CHANNEL_RECHECK_MS || 20 * 1000);

/**
 * A channel's very first /streams scrape (done synchronously in POST
 * /channels) can catch fewer concurrent broadcasts than actually exist — a
 * second stream going live moments after that scrape ran, or the page simply
 * not having settled yet. Once the poller is running, checkChannel's own
 * STREAMS_REFRESH_MS throttle then suppresses re-scraping for up to 10
 * minutes, so a fluky first read would otherwise stay wrong for a long time
 * with no way for the user to force a correction sooner (the "Check for
 * live" button respects that same throttle). One forced re-check shortly
 * after creation catches that without paying the re-scrape cost on every add.
 */
const scheduleNewChannelRecheck = (streamId) => {
    setTimeout(async () => {
        try {
            const doc = await LiveStream.findOne({ id: streamId }).lean();
            // Deleted or paused since — nothing to correct.
            if (!doc || doc.is_active === false) return;
            await checkChannel(doc, { forceRefresh: true });
        } catch (err) {
            console.warn(`[YTLive] new-channel recheck failed for ${streamId}: ${err.message}`);
        }
    }, NEW_CHANNEL_RECHECK_MS);
};

/**
 * `forceRefresh` bypasses checkChannel's own STREAMS_REFRESH_MS throttle for
 * every channel in this pass. The periodic timer never sets it — routine
 * ticks should stay cheap — but the user-triggered "Check for live" button
 * does, because a silent no-op on a channel that already has a healthy
 * poller would make the button feel broken.
 */
const runWatcherOnce = async ({ forceRefresh = false } = {}) => {
    if (watcherRunning) return;
    watcherRunning = true;
    try {
        const channels = await LiveStream.find({ is_active: true }).lean();
        for (const ch of channels) {
            try {
                await checkChannel(ch, { forceRefresh });
            } catch (err) {
                console.warn(`[YTLive] watcher failed for ${ch.channel_ref}: ${err.message}`);
            }
        }
    } catch (err) {
        console.warn('[YTLive] watcher tick failed:', err.message);
    } finally {
        watcherRunning = false;
    }
};

let watchIntervalMs = WATCH_INTERVAL_MS;

/** Current going-live check interval, in seconds. */
const getWatchIntervalSec = () => Math.round(watchIntervalMs / 1000);

/**
 * Change how often channels are checked for a new broadcast, taking effect
 * immediately rather than after the current interval elapses.
 */
const setWatchIntervalSec = (seconds) => {
    const secs = Math.max(30, Math.min(3600, Number(seconds) || 180));
    watchIntervalMs = secs * 1000;
    if (watcherTimer) {
        clearInterval(watcherTimer);
        watcherTimer = setInterval(runWatcherOnce, watchIntervalMs);
    }
    console.log(`[YTLive] watcher interval set to ${secs}s`);
    return secs;
};

// The analysis queue lives only in process memory — a restart (deploy,
// crash, nodemon reload) loses it entirely. Any row left 'analyzing'
// (claimed but never finished) or 'pending' (queued but the queue itself is
// gone) would otherwise sit there forever with no automatic recovery, which
// violates "no silent permanent dropping". Reset+requeue once at boot.
const recoverStuckAnalysis = async () => {
    try {
        const stale = await LiveChatMessage.find({
            is_political: true,
            analysis_status: { $in: ['pending', 'analyzing'] },
        }).select('id text stream_id analysis_status').lean();

        if (!stale.length) return;

        const ids = stale.map((d) => d.id);
        await LiveChatMessage.updateMany(
            { id: { $in: ids } },
            { $set: { analysis_status: 'pending' } }
        );
        for (const d of stale) {
            enqueueLlm({ id: d.id, text: d.text, stream_id: d.stream_id });
        }
        console.log(`[YTLive] recovered ${stale.length} message(s) orphaned by a previous restart, requeued for analysis`);
    } catch (err) {
        console.warn('[YTLive] recoverStuckAnalysis failed (non-fatal):', err.message);
    }
};

const startWatcher = async () => {
    if (watcherTimer) return;

    // Pick up the persisted interval so a restart doesn't silently revert it.
    try {
        const YouTubeLiveSettings = require('../models/YouTubeLiveSettings');
        const doc = await YouTubeLiveSettings.findOne({ id: 'ytlive' }).lean();
        if (doc?.watch_interval_sec) watchIntervalMs = doc.watch_interval_sec * 1000;
    } catch (err) {
        console.warn('[YTLive] could not load settings, using default interval:', err.message);
    }

    await recoverStuckAnalysis();
    await seedDurationStats();

    console.log(`[YTLive] watcher starting (every ${Math.round(watchIntervalMs / 1000)}s)`);
    setTimeout(runWatcherOnce, 20 * 1000);          // let Mongo settle after boot
    watcherTimer = setInterval(runWatcherOnce, watchIntervalMs);
};

const stopWatcher = () => {
    if (watcherTimer) clearInterval(watcherTimer);
    watcherTimer = null;
    for (const id of [...pollers.keys()]) stopPoller(id);
};

/**
 * Keep the running poller's cached settings in sync when they are edited,
 * so a change takes effect on the next tick without restarting the stream.
 */
const updateStreamSettings = (streamId, patch = {}) => {
    const meta = streamMeta.get(streamId);
    if (!meta) return;
    if (patch.alignment !== undefined) meta.alignment = patch.alignment;
    if (patch.poll_interval_sec !== undefined) meta.poll_interval_sec = patch.poll_interval_sec;
};

const getRuntimeStats = () => ({
    active_pollers: pollers.size,
    llm_queue: queueLength(),
    llm_streams_waiting: streamOrder.length,
    llm_active: llmActive,
    llm_concurrency: LLM_CONCURRENCY,
    llm_scored: llmScored,
    llm_failed: llmFailed,
    llm_retried: llmRetried,
    llm_dropped: llmDropped,
    expected_duration_ms: getExpectedDurationMs(),
    duration_sample_count: recentDurationsMs.length,
});

module.exports = {
    bus,
    startWatcher,
    stopWatcher,
    runWatcherOnce,
    checkChannel,
    selectStream,
    scheduleNewChannelRecheck,
    startPoller,
    stopPoller,
    updateStreamSettings,
    resyncStreamCounts,
    getWatchIntervalSec,
    setWatchIntervalSec,
    getRuntimeStats,
    // exported for tests / backfill scripts
    lexiconSentiment,
    analyzeFast,
    enforceBatchConsistency,
    isChatRelevant,
    persistChunk,
    enqueueLlm,
    failOrRetry,
    recoverStuckAnalysis,
};
