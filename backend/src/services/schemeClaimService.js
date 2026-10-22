/**
 * schemeClaimService — what each post says about a promised or existing scheme.
 * ─────────────────────────────────────────────────────────────────────
 * The Manifesto tracker's status is what the PUBLIC reports, so every post and
 * news headline that names a tracked scheme (manifestoSchemes.js) is read once
 * by the model, which records, for each scheme the post is really about:
 *
 *   claim   received      people are getting it / it was credited / it works
 *           not_received  it has not been given or implemented; people did not get it
 *           delayed       pending, late, people still waiting
 *           reduced       given, but less than promised or to fewer people
 *           stopped       it was running and has been stopped, frozen or cancelled
 *           none          the post discusses the scheme without saying any of that
 *   evidence the words in the post that state the claim (checked to be in the post)
 *   figure  a reach figure the post quotes ("Rs 9,000 crore to 70 lakh farmers"), or null
 *
 * Why the model and not phrases: tested on a month of live posts, phrase rules
 * credited a "released" in a twelve-scheme achievements list to every scheme in
 * it, read a government promise ("every poor family WILL get a house") as
 * delivered, and missed sarcasm. Phrases still pick the CANDIDATE posts.
 *
 * Results are stored on the post (Grievance.analysis.scheme_claims,
 * NewsArticle.scheme_claims) with CLAIMS_VERSION, so each post is read once;
 * bump the version when the prompt or the scheme list changes and everything
 * is re-read in the background.
 *
 * Readings are written by scripts/read_scheme_claims.js (run where suitable
 * models are) or, when enabled, by a background worker that reads new posts in
 * small batches and backs off when the model is unreachable.
 */
const Grievance = require('../models/Grievance');
const NewsArticle = require('../models/NewsArticle');
const { chatJson, withForcedProvider } = require('./llmProvider');
const { SCHEME_BY_ID, schemesNamedIn, namesOf } = require('../config/manifestoSchemes');

/**
 * 2: the two-model reader with quoted evidence. Version 1 readings were written
 * by earlier, less accurate versions (one of them by a development server's
 * background reader on the qwen model) and are all read again.
 */
const CLAIMS_VERSION = 2;
const CLAIMS = ['received', 'not_received', 'delayed', 'reduced', 'stopped', 'none'];
const SCAN_DAYS = 90;
const TEXT_CHARS = 1500;

const num = (name, fallback) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
};
/**
 * The background reader runs on the server on a schedule, with the same
 * model the pipeline uses for sentiment (OLLAMA_MODEL on OLLAMA_URL), so new
 * posts about a scheme are read without anyone running anything:
 *   every MANIFESTO_CLAIMS_INTERVAL_MS (15 min), up to MANIFESTO_CLAIMS_BATCH
 *   (25) posts — small batches, because the GPU host is shared with the live
 *   pipeline and other apps; a backlog is worked through over successive runs.
 * MANIFESTO_CLAIMS_ENABLED=false switches it off. scripts/read_scheme_claims.js
 * does the same reading on demand (it was used for the first full read, with
 * llama3.1 + gemma3 on a local Ollama); readings already saved are kept.
 */
const ENABLED = String(process.env.MANIFESTO_CLAIMS_ENABLED ?? 'true').toLowerCase() !== 'false';
const BATCH = num('MANIFESTO_CLAIMS_BATCH', 25);               // posts per scheduled run
const INTERVAL_MS = num('MANIFESTO_CLAIMS_INTERVAL_MS', 15 * 60 * 1000);
const TIMEOUT_MS = num('MANIFESTO_CLAIMS_TIMEOUT_MS', 120000);
/**
 * Models and Ollama host for this reader (default: the pipeline's OLLAMA_MODEL
 * and OLLAMA_URL). MANIFESTO_CLAIMS_MODELS takes a comma-separated list; with
 * two or more, a post counts as being about a scheme, and a claim counts, only
 * when every model gives the same answer.
 *
 * Why, from checking answers on real posts by hand: no single 7–8B model was
 * right often enough on its own — qwen2.5 (7B and 14B) misread Telugu
 * negatives ("రైతు బీమా అందని కుటుంబాలు", families who did NOT get it, came
 * back "received"); llama3.1 read those correctly but mistook past
 * achievements for current delivery. Different models make different
 * mistakes, so requiring agreement removes most of them, at the cost of
 * fewer claims.
 */
const MODELS = String(process.env.MANIFESTO_CLAIMS_MODELS || process.env.MANIFESTO_CLAIMS_MODEL || '')
    .split(',').map((m) => m.trim()).filter(Boolean);
const BASE_URL = process.env.MANIFESTO_CLAIMS_OLLAMA_URL || undefined;
/** Stored with each reading, so it is always clear which models produced it. */
const READ_BY = MODELS.length ? MODELS.join(' + ') : (process.env.OLLAMA_MODEL || 'default model');
const BREAKER_AFTER = 3;                                        // consecutive failures before backing off
const BREAKER_MS = 15 * 60 * 1000;

/* ── the prompt ─────────────────────────────────────────────────────────── */

const describe = (s) => `${s.side === 'theirs'
    ? `${s.id}: ${s.name} — the governing party promised in 2023: ${s.promise}`
    : `${s.id}: ${s.name} — a scheme the previous government ran: ${s.what}`}${s.not ? ` (NOT ${s.not})` : ''}`;

/*
 * Two things keep a small model honest here, both learned by checking its
 * answers on real posts by hand:
 *
 *  1. EVIDENCE. Every claim must quote the words in the post that state it,
 *     and the code (hasEvidence) checks the quote really is in the post. Asked
 *     only for a label, the model defaulted to "delayed" for farmhouse
 *     allegations, a press-meet notice and a bus-fare story; asked to quote,
 *     it has nothing to quote and answers "none".
 *  2. WORKED EXAMPLES from posts it got wrong: praise read as a complaint, a
 *     list of a party's achievements read as reports, a past achievement read
 *     as today's status, an opinion read as a report, a house-for-sale advert
 *     kept as the 2BHK scheme.
 */
const buildPrompt = (text, ids) => `You read Telangana social media posts and news (English, Telugu or Hindi) about government welfare schemes.

Schemes named in this post:
${ids.map((id) => `- ${describe(SCHEME_BY_ID.get(id))}`).join('\n')}

For EACH scheme above give:
"about": true only if the post is really about this government scheme. false when the word means something else (a house for sale, an acreage, a goddess, a person's name, an everyday word), it is only a hashtag on an unrelated post, or the scheme is one name in a list with nothing said about it.
"evidence": copy the exact words from the post that say whether people are getting this scheme now. Use "" if the post has no such words.
"claim": what that evidence says. If "evidence" is "", the claim MUST be "none".
  "none"          the post says nothing about people getting it now: an opinion of the scheme, what the scheme is or is designed to do, what it achieved under the previous government, a plan or promise, a court case, a corruption allegation, politics, general news
  "received"      people are getting it now, it was paid or given, it is working, people thank the government for it
  "not_received"  people are not getting it, it was never implemented, the promise was not kept, people demand that it be given
  "delayed"       people are still waiting, it is pending or late, "when will it come?"
  "reduced"       given, but less than promised (a lower amount, fewer people, only some)
  "stopped"       it used to reach people and does not any more
When unsure, use "none". Sarcasm reverses the literal words.
"figure": a reach figure the post quotes for that scheme (amount, people, houses), e.g. "Rs 9,000 crore to 70 lakh farmers"; otherwise null.

Examples:
- "ఉచిత కరెంట్‌తో వెలుగులు నింపుతూ ఇందిరమ్మ ఇండ్లతో కలలు నెరవేర్చిన ప్రజాపాలన" → gruha-jyothi: about true, evidence "ఉచిత కరెంట్‌తో వెలుగులు నింపుతూ", received; indiramma-indlu: about true, evidence "ఇందిరమ్మ ఇండ్లతో కలలు నెరవేర్చిన", received
- "తెలంగాణ రైతులకు ₹8,000 రైతు భరోసా ఎప్పుడు?" → rythu-bharosa: about true, evidence "రైతు భరోసా ఎప్పుడు?", delayed
- "కేసీఆర్ తాత నువ్వుంటే మా తాతకు రైతుబంధు వచ్చేది" → rythu-bandhu: about true, evidence "నువ్వుంటే మా తాతకు రైతుబంధు వచ్చేది", stopped
- "Women protested after wards 13 and 23 went without Mission Bhagiratha drinking water for 10 days" → mission-bhagiratha: about true, evidence "went without Mission Bhagiratha drinking water for 10 days", not_received
- "ఫాంహౌస్ కోసం 58 ఎకరాల చెరువు, కాళేశ్వరం నీళ్లతో కల్వకుంట్ల లీలలు!" → kaleshwaram: about true, evidence "", none (an allegation)
- "2016: Mission Bhagiratha launched … 2020–23: 100% piped safe water" → mission-bhagiratha: about true, evidence "", none (a past achievement)
- "Developments under BRS rule: Apparel Park, Medical College, Mission Bhagiratha, green parks" → mission-bhagiratha: about false (a list)
- "KCR spent on infra, not on useless schemes like free bus" → mahalakshmi-bus: about true, evidence "", none (an opinion)
- "1.28 lakh families got Rythu Bima under KCR. But Revanth Reddy stopped this scheme" → rythu-bima: about true, evidence "Revanth Reddy stopped this scheme", stopped
- "కాళేశ్వరం ప్రాజెక్టు 40 లక్షల ఎకరాలకు సాగునీరు" → kaleshwaram: about true, evidence "", none (what it achieved before)
- "Warangal–Paleru project is a Mission Bhagiratha initiative designed to provide drinking water to 1,700 habitations" → mission-bhagiratha: about true, evidence "", none (what it is designed to do)
- "రైతులకు రైతుభరోసా ఇవ్వాలి" → rythu-bharosa: about true, evidence "రైతుభరోసా ఇవ్వాలి", not_received (a demand)
- "Harish Rao accused the government of hiking bus fares" → mahalakshmi-bus: about false (fares, not the free bus for women)
- "Minister: Rs 23,000 crore crop loan waiver done for farmers" → loan-waiver: about true, evidence "Rs 23,000 crore crop loan waiver done", received, figure "Rs 23,000 crore"
- "2BHK house for sale, Adilabad" → 2bhk: about false

Post:
"""${text}"""

Reply with JSON only, one entry per scheme above:
{"schemes":[{"id":"<scheme id>","about":<true or false>,"evidence":"<exact words from the post, or empty>","claim":"<received | not_received | delayed | reduced | stopped | none>","figure":<"figure" or null>}]}`;

const squash = (t) => String(t || '').toLowerCase().replace(/[\s"'“”‘’.,!?:;()\-–—…]+/g, ' ').trim();
/**
 * The quote must really be in the post (verbatim, or at least 80% of its
 * words) AND say something beyond the scheme's own name: quoting just
 * "కాళేశ్వరం ప్రాజెక్టు" from a list of achievements is not evidence that
 * anyone is getting it.
 */
const hasEvidence = (quote, text, schemeId) => {
    const q = squash(quote);
    if (q.length < 4) return false;
    let rest = q;
    for (const name of (schemeId && SCHEME_BY_ID.has(schemeId) ? namesOf(SCHEME_BY_ID.get(schemeId)) : [])) rest = rest.split(squash(name)).join(' ');
    if (rest.split(' ').filter((w) => w.length > 1).length < 2) return false;
    const t = squash(text);
    if (t.includes(q)) return true;
    const words = q.split(' ').filter((w) => w.length > 1);
    return words.length > 0 && words.filter((w) => t.includes(w)).length / words.length >= 0.8;
};

/** One model's reading: the schemes it says the post is about, each with a grounded claim. */
const readWith = async (post, ids, model) => {
    const out = await withForcedProvider('ollama', () => chatJson({
        prompt: buildPrompt(post, ids),
        temperature: 0,
        maxTokens: 400,
        timeoutMs: TIMEOUT_MS,
        model,
        baseUrl: BASE_URL,
    }));
    const rows = Array.isArray(out?.schemes) ? out.schemes : [];
    const seen = new Set();
    return rows
        // Only schemes the model says the post is really about (a missing answer counts as not about).
        .filter((r) => r && (r.about === true || String(r.about).toLowerCase() === 'true'))
        .map((r) => {
            const said = String(r?.claim || '').trim();
            const claim = CLAIMS.includes(said) ? said : 'none';
            const evidence = String(r?.evidence || '').trim();
            // A claim stands only on words that are really in the post.
            const scheme = String(r?.id || '').trim();
            const grounded = claim !== 'none' && hasEvidence(evidence, post, scheme) && claimStands({ scheme, claim, evidence });
            return {
                scheme,
                claim: grounded ? claim : 'none',
                evidence: grounded ? evidence.slice(0, 200) : null,
                figure: r?.figure && String(r.figure).trim() && String(r.figure).toLowerCase() !== 'null' ? String(r.figure).trim().slice(0, 200) : null,
            };
        })
        .filter((r) => ids.includes(r.scheme) && !seen.has(r.scheme) && seen.add(r.scheme));
};

/**
 * What one text says about its candidate schemes. Returns [] when it names
 * none or the models reject them all. With several models, a scheme is kept
 * only if every model says the post is about it, and its claim only if every
 * model gives the same one (otherwise "none").
 */
const agree = (readings) => {
    const [first, ...others] = readings;
    return first
        .filter((r) => others.every((o) => o.some((x) => x.scheme === r.scheme)))
        .map((r) => {
            const agreed = others.every((o) => o.find((x) => x.scheme === r.scheme).claim === r.claim);
            return agreed ? r : { ...r, claim: 'none', evidence: null };
        });
};

const readClaims = async (text, ids, { models = MODELS } = {}) => {
    if (!ids.length) return [];
    const post = String(text).slice(0, TEXT_CHARS);
    const readings = [];
    for (const m of (models.length ? models : [undefined])) readings.push(await readWith(post, ids, m));
    return agree(readings);
};

/**
 * The same for many posts: every post through the first model, then every post
 * through the next. A GPU that cannot hold both models then loads each once,
 * instead of swapping them for every post (measured: ~30 s a post swapping,
 * ~3 s a post per model batched). `onError(i, err)` is called for a post that
 * fails; its result is null.
 */
const readClaimsBatch = async (posts, { models = MODELS, onError = () => {}, onStep = () => {} } = {}) => {
    const list = models.length ? models : [undefined];
    const readings = posts.map(() => []);
    const failed = new Set();
    for (const m of list) {
        for (let i = 0; i < posts.length; i += 1) {
            if (failed.has(i) || !posts[i].ids.length) continue;
            onStep({ model: m || 'default model', at: i + 1, of: posts.length });
            try { readings[i].push(await readWith(String(posts[i].text).slice(0, TEXT_CHARS), posts[i].ids, m)); }
            catch (err) { failed.add(i); onError(i, err); }
        }
    }
    return posts.map((p, i) => (failed.has(i) ? null : (p.ids.length ? agree(readings[i]) : [])));
};

/**
 * Rules a claim must also pass, on its quoted evidence. Applied when a post is
 * read AND again when the tracker counts readings (manifestoService), so a
 * rule added here corrects every saved reading without reading anything again.
 * Each rule comes from a mistake found by checking real readings by hand.
 */
const FUTURE_RX = /\bwill\b|\bgoing to\b|ఇస్తాం|ఇస్తాము|అందిస్తాం|అందిస్తాము|చేస్తాం|కట్టిస్తాం|देंगे|करेंगे/i;
/**
 * Words that say something was actually delivered. A "received" claim must
 * quote one: quoting the promise itself ("మహిళలకు నెలకు రూ.2,500", from a
 * protest that it was never paid) or a description ("supports families with
 * ₹5 lakh") was read as delivery on real posts. Costs a few true reports that
 * use no such word; for a status shown to a client, precision comes first.
 */
const DELIVERED_RX = new RegExp([
    // "provides" describes a scheme; "provided" reports it — so only the past tense counts.
    '\\b(?:receiv|credit|deposit|disburs|distribut|releas|sanction|implement|paid|getting|got|given|availed|availing|benefit|handed)\\w*',
    '\\bprovided\\b',
    '\\b(?:running|working)\\b',
    'జమ', 'అందింది', 'అందాయి', 'అందుతోంది', 'అందుతున్న', 'అందిస్తున్న', 'ఇస్తున్న', 'ఇచ్చారు', 'ఇచ్చింది', 'ఇచ్చిన',
    'వచ్చింది', 'వచ్చాయి', 'వస్తోంది', 'వస్తున్న', 'అమలవుతోంది', 'అమలవుతున్న', 'అమలు చేస్తున్న', 'అమలు చేశా', 'అమలు చేసిన',
    'పంపిణీ', 'మంజూరు', 'లబ్ధి', 'సాయంతో', 'పొందుతున్న', 'పొందారు',
    'मिला', 'मिली', 'मिल रहा', 'जारी', 'दिया', 'दी गई',
].join('|'), 'iu');
const claimStands = ({ scheme, claim, evidence }) => {
    if (!claim || claim === 'none') return false;
    const def = SCHEME_BY_ID.get(scheme);
    const ev = String(evidence || '');
    // A look-alike: farm power is not Gruha Jyothi, bus fares are not the free bus for women.
    if (def?.notWords && def.notWords.test(ev)) return false;
    // For a scheme our party built, the question is what has happened to it since: "it works"
    // posts about our schemes were praise of what it did while we governed.
    if (def?.side === 'ours' && claim === 'received') return false;
    // A promise ("every eligible family WILL get a house") is not delivery.
    if (claim === 'received' && FUTURE_RX.test(ev)) return false;
    // "Received" must quote a word that says something was delivered.
    if (claim === 'received' && !DELIVERED_RX.test(ev)) return false;
    return true;
};

/* ── background worker ──────────────────────────────────────────────────── */

const state = {
    running: false, timer: null, failures: 0, pausedUntil: 0,
    lastRunAt: null, lastError: null, read: 0, pending: null,
};

const textOfPost = (d) => d.content?.text || '';
const textOfArticle = (a) => [a.title, a.title_english].filter(Boolean).join(' — ');

/**
 * One pass over a collection: mark posts that name no scheme (no model call),
 * and read up to `budget` that do. Returns how many model calls it used.
 */
const passOver = async ({ Model, dateField, textOf, select, claimsPath, budget, skip = new Set(), onEvent = () => {} }) => {
    const since = new Date(Date.now() - SCAN_DAYS * 86400000);
    const versionPath = `${claimsPath}_v`;
    const todo = await Model.find({
        [dateField]: { $gte: since },
        [versionPath]: { $ne: CLAIMS_VERSION },
        // Posts that already failed in this run are left for the next one.
        ...(skip.size ? { _id: { $nin: [...skip] } } : {}),
    }).select(select).sort({ [dateField]: -1 }).limit(2000).lean();

    const unnamed = []; const named = [];
    for (const d of todo) (schemesNamedIn(textOf(d)).length ? named : unnamed).push(d);
    onEvent({ type: 'scan', what: Model.modelName, scanned: todo.length, unnamed: unnamed.length, named: named.length });
    if (unnamed.length) {
        await Model.bulkWrite(unnamed.map((d) => ({
            updateOne: { filter: { _id: d._id }, update: { $set: { [claimsPath]: [], [versionPath]: CLAIMS_VERSION, [`${claimsPath}_at`]: new Date(), [`${claimsPath}_by`]: null } } },
        })), { ordered: false });
    }

    if (!named.length || budget <= 0 || Date.now() < state.pausedUntil) return { used: 0, waiting: named.length, scanned: todo.length };
    const batch = named.slice(0, budget);
    let errors = 0;
    const results = await readClaimsBatch(batch.map((d) => ({ text: textOf(d), ids: schemesNamedIn(textOf(d)) })), {
        onError: (_i, err) => { errors += 1; state.lastError = err.message; },
        onStep: (step) => onEvent({ type: 'read', what: Model.modelName, ...step }),
    });
    for (let i = 0; i < batch.length; i += 1) {
        if (!results[i]) { skip.add(batch[i]._id); continue; }      // failed: left for the next run
        await Model.updateOne({ _id: batch[i]._id }, { $set: { [claimsPath]: results[i], [versionPath]: CLAIMS_VERSION, [`${claimsPath}_at`]: new Date(), [`${claimsPath}_by`]: READ_BY } });
        state.read += 1;
    }
    state.failures = errors === batch.length ? state.failures + 1 : 0;
    if (state.failures >= BREAKER_AFTER) {
        state.pausedUntil = Date.now() + BREAKER_MS;
        console.warn(`[scheme-claims] model unreachable ${state.failures} runs in a row — pausing 15 min:`, state.lastError);
    }
    return { used: batch.length, waiting: named.length - batch.length, scanned: todo.length };
};

const runOnce = async () => {
    if (!ENABLED || state.running || Date.now() < state.pausedUntil) return;
    state.running = true;
    try {
        const posts = await passOver({
            Model: Grievance, dateField: 'post_date', textOf: textOfPost,
            select: '_id content.text', claimsPath: 'analysis.scheme_claims', budget: BATCH,
        });
        const news = await passOver({
            Model: NewsArticle, dateField: 'published_date', textOf: textOfArticle,
            select: '_id title title_english', claimsPath: 'scheme_claims', budget: Math.max(0, BATCH - posts.used),
        });
        state.pending = posts.waiting + news.waiting;
        state.lastRunAt = new Date();
        if (posts.used + news.used) console.log(`[scheme-claims] read ${posts.used + news.used} posts/articles · ${state.pending} waiting`);
        // A backlog (after a deploy) is worked through a minute apart, then runs settle to the interval.
        if (state.pending > 0 && Date.now() >= state.pausedUntil) setTimeout(() => runOnce().catch(() => {}), 60 * 1000).unref?.();
    } catch (err) {
        state.lastError = err.message;
        console.warn('[scheme-claims] run failed:', err.message);
    } finally {
        state.running = false;
    }
};

/** Start the background reader (called once after the server starts listening). */
const start = () => {
    if (!ENABLED || state.timer) return;
    state.timer = setInterval(() => runOnce().catch(() => {}), INTERVAL_MS);
    if (state.timer.unref) state.timer.unref();
    runOnce().catch(() => {});
};

/**
 * Read everything not yet read, in batches, until nothing is left (the script's
 * entry point). Calls onProgress({ read, waiting }) after each batch.
 */
const readAll = async ({ onProgress = () => {}, onEvent = () => {} } = {}) => {
    let read = 0;
    const skipPosts = new Set(); const skipNews = new Set();
    for (;;) {
        const posts = await passOver({
            Model: Grievance, dateField: 'post_date', textOf: textOfPost,
            select: '_id content.text', claimsPath: 'analysis.scheme_claims', budget: BATCH, skip: skipPosts, onEvent,
        });
        const news = await passOver({
            Model: NewsArticle, dateField: 'published_date', textOf: textOfArticle,
            select: '_id title title_english', claimsPath: 'scheme_claims', budget: Math.max(0, BATCH - posts.used), skip: skipNews, onEvent,
        });
        read += posts.used + news.used;
        const waiting = posts.waiting + news.waiting;
        const failed = skipPosts.size + skipNews.size;
        onProgress({ read, waiting, failed, failing: state.failures, lastError: state.lastError });
        // Done when a pass finds nothing left to look at (marked, read or failed), or the model is unreachable.
        if (!(posts.scanned + news.scanned) || Date.now() < state.pausedUntil) return { read, waiting, failed };
    }
};

/** Posts and articles in the window not yet looked at by the current reader version (cached for 5 minutes). */
let pendingCache = { at: 0, value: null };
const countPending = async () => {
    if (Date.now() - pendingCache.at < 5 * 60 * 1000) return pendingCache.value;
    const since = new Date(Date.now() - SCAN_DAYS * 86400000);
    try {
        const [p, n] = await Promise.all([
            Grievance.countDocuments({ post_date: { $gte: since }, is_active: { $ne: false }, 'analysis.scheme_claims_v': { $ne: CLAIMS_VERSION } }),
            NewsArticle.countDocuments({ published_date: { $gte: since }, scheme_claims_v: { $ne: CLAIMS_VERSION } }),
        ]);
        pendingCache = { at: Date.now(), value: p + n };
    } catch (err) {
        console.warn('[scheme-claims] pending count failed:', err.message);
    }
    return pendingCache.value;
};

const progress = () => ({
    enabled: ENABLED,
    pending: state.pending,
    read_since_start: state.read,
    last_run_at: state.lastRunAt,
    paused_until: state.pausedUntil > Date.now() ? new Date(state.pausedUntil) : null,
});

module.exports = {
    readClaims, readClaimsBatch, readAll, countPending, claimStands, buildPrompt, hasEvidence, start, runOnce, progress, CLAIMS, CLAIMS_VERSION,
};
