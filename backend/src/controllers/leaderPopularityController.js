/**
 * leaderPopularityController
 * ─────────────────────────────────────────────────────────────────────────────
 * "Constituency Leader Popularity" — per assembly seat, who is being
 * discussed and whether that discussion helps or hurts them. Spans Mentions,
 * Alerts and RSS/News in one view (the existing "Constituency War Room"
 * controller in this same directory covers only Grievances, and scores the
 * seat/MLA on their own merits rather than breaking it down per person).
 *
 * THE CRITICAL STEP — align sentiment to the PERSON, not the client
 * ───────────────────────────────────────────────────────────────
 * Every stored verdict (`target_sentiment` / `llm_analysis.target_sentiment`)
 * is CLIENT-relative: positive means good for the client (BRS), not "flattering to whoever
 * is named" — see THE ONE RULE in services/analysisService.js. A post attacking
 * an opposition leader is CLIENT-positive. Rendered as-is under that leader's
 * name it would show as "positive sentiment for them", which inverts the
 * meaning of every opposition row. `alignToPerson` below flips client-relative
 * sentiment onto person-relative sentiment for anyone tagged `alignment:
 * 'opposition'` in the roster before it is ever displayed.
 *
 * ENTITY RESOLUTION — the same text field holds three different shapes
 * ─────────────────────────────────────────────────────────────────────
 * `target_entity` is written by the shared pipeline (analysisService.js →
 * politicalSentimentService.js) but is not one consistent shape across
 * collections or across time:
 *   - usually a resolved CANONICAL NAME  ("Dr. Raman Singh")
 *   - sometimes a raw ROSTER KEY         ("inc", "aap")
 *   - sometimes a LEGACY pipeline key    ("bsk", "bjp_telangana")
 *   - a placeholder meaning "no target"  ("none")
 * `resolveEntity` below tries, in order: the roster's own legacy-key map
 * (config/politicalEntities.js `resolveEntityKey`, already the single source
 * of truth the live pipeline uses for the same migration), a direct key
 * match, then a canonical-name match built once from the roster. Anything
 * left over is off-roster free text, kept and displayed but with no alignment
 * to flip and no roster priority — it can never outrank a recognised leader.
 *
 * TWO GUARDS, BOTH FOUND BY RUNNING AGAINST REAL DATA (not designed up front)
 * ──────────────────────────────────────────────────────────────────────────
 *   1. Placeholder names. The pipeline's own fallback is the literal string
 *      "none" when Stage 2 found no target; PLACEHOLDER_RE also rejects
 *      "n/a", "unknown", "null", and HAS_LETTER_RE rejects digit/symbol-only
 *      strings, so junk can never rank as a "leader".
 *   2. Highlight floor. "Most negative in this seat" needs more evidence than
 *      a bare listing — 3 mentions at 100% negative should not outrank 264 at
 *      39%. LEADER_POPULARITY_HIGHLIGHT_FLOOR gates the Best/Worst chips
 *      separately from LEADER_POPULARITY_LISTING_FLOOR (which gates the list
 *      itself, and is also the UI's "Min N mentions" filter). If nobody clears
 *      the highlight floor in a quiet seat, it falls back to the
 *      listing-floor set so the seat still shows something instead of blanks.
 *
 * ROUTE ORDERING: registered in constituencyIntelligenceRoutes.js BEFORE the
 * generic `/:constituency` route, or "leader-popularity" is captured as a
 * constituency name and this handler is never reached.
 */

const Grievance = require('../models/Grievance');
const cacheService = require('../services/cacheService');
const {
    POLITICAL_ENTITIES,
    resolveEntityKey,
    LEGACY_ENTITY_KEYS,
} = require('../config/politicalEntities');
const { grievanceGate, applyGate } = require('../config/displayGate');

const CACHE_TTL = 60;
const LISTING_FLOOR_DEFAULT = Number(process.env.LEADER_POPULARITY_LISTING_FLOOR || 3);
const HIGHLIGHT_FLOOR_DEFAULT = Number(process.env.LEADER_POPULARITY_HIGHLIGHT_FLOOR || 10);
const HIGH_NEG_PCT = Number(process.env.LEADER_POPULARITY_HIGH_NEG_PCT || 50);
/** 'moderate' is the retired name of 'neutral'; both are accepted and matched. */
const canonicalSentimentParam = (v) => (v === 'moderate' ? 'neutral' : v);
const sentimentValue = (s) => (s === 'neutral' ? { $in: ['neutral', 'moderate'] } : s);
const VALID_SENTIMENTS = new Set(['positive', 'negative', 'neutral', 'moderate']);

/* ─── entity resolution ────────────────────────────────────────────────── */

const PLACEHOLDER_RE = /^(none|n\/?a|unknown|null|undefined|-|—|other)$/i;
// Any script's letters count, so a Devanagari-only name is not rejected as "no letters".
const HAS_LETTER_RE = /\p{L}/u;

/**
 * Exact-match index over canonical name + every registered alias, not just the
 * canonical form. Needed because `target_entity` is not always the canonical
 * string — e.g. the roster's alias list for raman-singh includes "Speaker Raman Singh"
 * alongside "Dr. Raman Singh", and Alerts' free-text resolution stores
 * whichever one Stage 3 actually wrote. Indexing canonical only split one
 * leader's numbers across two rows the first time this ran against real data.
 */
/**
 * "Dr. Raman Singh", "dr raman singh" and "Dr Raman Singh" are the same
 * string three ways. Stripping periods and collapsing whitespace before
 * indexing AND before lookup means the roster only has to register one
 * punctuation variant per name instead of every plausible one.
 */
const normalizeNameForLookup = (v) =>
    String(v || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

const CANONICAL_INDEX = new Map();
for (const [key, ent] of Object.entries(POLITICAL_ENTITIES)) {
    if (!ent) continue;
    if (ent.canonical) CANONICAL_INDEX.set(normalizeNameForLookup(ent.canonical), key);
    for (const alias of ent.aliases || []) {
        const norm = normalizeNameForLookup(alias);
        if (!CANONICAL_INDEX.has(norm)) CANONICAL_INDEX.set(norm, key);
    }
}

/**
 * Every raw string a stored record might carry for a given resolved roster
 * key — the key itself, its canonical name, every registered alias (same
 * list resolveEntity indexes above), and any legacy key that now maps here.
 */
const rawAliasesForKey = (key) => {
    const ent = POLITICAL_ENTITIES[key];
    if (!ent) return [key];
    const legacy = Object.entries(LEGACY_ENTITY_KEYS)
        .filter(([, current]) => current === key)
        .map(([old]) => old);
    return [...new Set([key, ent.canonical, ...(ent.aliases || []), ...legacy].filter(Boolean))];
};

/**
 * Resolve one raw `target_entity` value to a display entity, or null if it is
 * a placeholder / empty / has no letters. Off-roster text is never dropped —
 * it comes back with `key: null, alignment: 'unknown'` so it can still be
 * shown, just without a flip and without ranking above a recognised leader.
 */
const resolveEntity = (raw) => {
    const val = String(raw || '').trim();
    if (!val || PLACEHOLDER_RE.test(val) || !HAS_LETTER_RE.test(val)) return null;

    const asKeyGuess = val.toLowerCase().replace(/\s+/g, '-');
    const key = resolveEntityKey(asKeyGuess) || resolveEntityKey(val.toLowerCase());
    if (key && POLITICAL_ENTITIES[key]) {
        const ent = POLITICAL_ENTITIES[key];
        return { key, name: ent.canonical, alignment: ent.alignment || 'unknown', priority: ent.priority || 0, type: ent.type || 'unknown' };
    }

    const byName = CANONICAL_INDEX.get(normalizeNameForLookup(val));
    if (byName) {
        const ent = POLITICAL_ENTITIES[byName];
        return { key: byName, name: ent.canonical, alignment: ent.alignment || 'unknown', priority: ent.priority || 0, type: ent.type || 'unknown' };
    }

    return { key: null, name: val, alignment: 'unknown', priority: 0, type: 'unknown' };
};

/** THE CRITICAL STEP — see file header. */
const alignToPerson = (sentiment, alignment) => {
    if (sentiment === 'neutral' || sentiment === 'moderate' || !sentiment) return sentiment;
    if (alignment !== 'opposition') return sentiment;
    return sentiment === 'positive' ? 'negative' : 'positive';
};

/* ─── query helpers ────────────────────────────────────────────────────── */

const dateRange = ({ days, from, to } = {}) => {
    if (from && to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        return { $gte: new Date(from), $lte: toDate };
    }
    const windowDays = Number(days);
    if (Number.isFinite(windowDays) && windowDays > 0) {
        return { $gte: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000) };
    }
    return null;
};

const sanitizeSentiment = (v) => (VALID_SENTIMENTS.has(v) ? canonicalSentimentParam(v) : undefined);

/** Union grievances/alerts/newsarticles into one common {constituency, entity_raw, sentiment} shape, grouped to counts. Cheap — cardinality is small even over the whole corpus. */
const rawCounts = async (range) => {
    const dc = (field) => (range ? { [field]: range } : {});

    const pipeline = [
        { $match: applyGate({
            is_active: true,
            'detected_location.constituency': { $nin: [null, ''] },
            'analysis.target_sentiment': { $in: ['positive', 'negative', 'neutral', 'moderate'] },
            ...dc('post_date'),
        }, grievanceGate()) },
        { $project: {
            constituency: '$detected_location.constituency',
            entity_raw: { $ifNull: ['$analysis.target_entity_canonical', '$analysis.target_entity'] },
            sentiment: '$analysis.target_sentiment',
        } },
        { $unionWith: { coll: 'alerts', pipeline: [
            { $match: {
                'detected_location.constituency': { $nin: [null, ''] },
                'llm_analysis.target_sentiment': { $in: ['positive', 'negative', 'neutral', 'moderate'] },
                ...dc('created_at'),
            } },
            { $project: {
                constituency: '$detected_location.constituency',
                entity_raw: '$llm_analysis.target_entity',
                sentiment: '$llm_analysis.target_sentiment',
            } },
        ] } },
        { $unionWith: { coll: 'newsarticles', pipeline: [
            { $match: {
                'detected_location.constituency': { $nin: [null, ''] },
                target_sentiment: { $in: ['positive', 'negative', 'neutral', 'moderate'] },
                ...dc('scraped_at'),
            } },
            { $project: {
                constituency: '$detected_location.constituency',
                entity_raw: '$sentiment_target',
                sentiment: '$target_sentiment',
            } },
        ] } },
        { $group: {
            _id: { constituency: '$constituency', entity_raw: '$entity_raw', sentiment: '$sentiment' },
            count: { $sum: 1 },
        } },
    ];

    return Grievance.aggregate(pipeline).allowDiskUse(true);
};

/** Resolve + align-flip + re-aggregate the raw counts into per-seat, per-leader stats. */
const buildLeaderboard = (rows) => {
    const byConstituency = new Map();

    for (const row of rows) {
        const { constituency, entity_raw, sentiment } = row._id;
        const count = row.count;
        const resolved = resolveEntity(entity_raw);
        if (!resolved) continue;

        const aligned = alignToPerson(sentiment, resolved.alignment);
        const groupKey = resolved.key || `free:${resolved.name.toLowerCase()}`;

        if (!byConstituency.has(constituency)) byConstituency.set(constituency, new Map());
        const leaders = byConstituency.get(constituency);
        if (!leaders.has(groupKey)) {
            leaders.set(groupKey, {
                key: resolved.key,
                name: resolved.name,
                alignment: resolved.alignment,
                priority: resolved.priority,
                type: resolved.type,
                total: 0, pos: 0, neg: 0, mod: 0,
            });
        }
        const l = leaders.get(groupKey);
        l.total += count;
        if (aligned === 'positive') l.pos += count;
        else if (aligned === 'negative') l.neg += count;
        else l.mod += count;
    }

    return byConstituency;
};

const withNegPct = (l) => ({ ...l, neg_pct: l.total > 0 ? Math.round((l.neg / l.total) * 1000) / 10 : 0 });

/* ─── GET /leader-popularity ───────────────────────────────────────────── */

const getLeaderPopularity = async (req, res) => {
    try {
        const {
            constituency, search, sort = 'most_discussed', days, from, to,
        } = req.query;
        const minMentions = Math.max(0, parseInt(req.query.min_mentions, 10) || LISTING_FLOOR_DEFAULT);
        const range = dateRange({ days, from, to });

        const cacheKey = `leader-popularity:v1:${JSON.stringify({ constituency: constituency || '', search: search || '', sort, minMentions, range: range ? [range.$gte, range.$lte] : null, scope: req.scope?.canSeeAll ? 'all' : [...(req.scope?.constituencyKeys || [])].sort().join(',') })}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.status(200).json(cached);

        const rows = await rawCounts(range);
        const byConstituency = buildLeaderboard(rows);

        let seats = [...byConstituency.entries()].map(([seatName, leaders]) => ({ seatName, leaders }));

        // RBAC scope — a constituency-scoped MLA/MP sees only their own seat(s).
        if (req.scope && !req.scope.canSeeAll) {
            const { normalizeConstituencyKey } = require('../services/mlaReferenceService');
            const allowed = req.scope.constituencyKeys || new Set();
            seats = seats.filter((s) => allowed.has(normalizeConstituencyKey(s.seatName)));
        }

        if (constituency && constituency !== 'all') {
            const needle = String(constituency).toLowerCase();
            seats = seats.filter((s) => s.seatName.toLowerCase() === needle);
        }
        if (search && search.trim()) {
            const needle = search.trim().toLowerCase();
            seats = seats.filter((s) =>
                s.seatName.toLowerCase().includes(needle) ||
                [...s.leaders.values()].some((l) => l.name.toLowerCase().includes(needle)));
        }

        const payload = seats.map(({ seatName, leaders }) => {
            const listed = [...leaders.values()]
                .filter((l) => l.total >= minMentions)
                .map(withNegPct)
                .sort((a, b) => b.total - a.total || b.priority - a.priority);

            const totalMentions = [...leaders.values()].reduce((s, l) => s + l.total, 0);

            const highlightPool = listed.filter((l) => l.total >= HIGHLIGHT_FLOOR_DEFAULT);
            const forHighlight = highlightPool.length ? highlightPool : listed;

            const top = listed[0] || null;
            const best = forHighlight.length
                ? forHighlight.reduce((a, b) => (b.neg_pct < a.neg_pct ? b : a))
                : null;
            const worst = forHighlight.length
                ? forHighlight.reduce((a, b) => (b.neg_pct > a.neg_pct ? b : a))
                : null;

            return {
                constituency: seatName,
                total_mentions: totalMentions,
                leader_count: leaders.size,
                top: top && { name: top.name, total: top.total },
                best: best && { name: best.name, neg_pct: best.neg_pct },
                worst: worst && { name: worst.name, neg_pct: worst.neg_pct },
                leaders: listed.map((l) => ({
                    key: l.key,
                    name: l.name,
                    alignment: l.alignment,
                    type: l.type,
                    total: l.total,
                    positive: l.pos,
                    negative: l.neg,
                    neutral: l.mod,
                    moderate: l.mod, // retired key
                    neg_pct: l.neg_pct,
                    high_neg: l.neg_pct >= HIGH_NEG_PCT,
                })),
            };
        });

        const sorters = {
            most_discussed: (a, b) => b.total_mentions - a.total_mentions,
            most_negative: (a, b) => (b.worst?.neg_pct || 0) - (a.worst?.neg_pct || 0),
            alphabetical: (a, b) => a.constituency.localeCompare(b.constituency),
        };
        payload.sort(sorters[sort] || sorters.most_discussed);

        const response = {
            sentiment_basis: 'aligned_to_person',
            listing_floor: minMentions,
            highlight_floor: HIGHLIGHT_FLOOR_DEFAULT,
            total_placed_mentions: payload.reduce((s, c) => s + c.total_mentions, 0),
            constituency_count: payload.length,
            constituencies: payload,
        };

        await cacheService.set(cacheKey, response, CACHE_TTL);
        return res.status(200).json(response);
    } catch (error) {
        console.error('[leaderPopularityController] getLeaderPopularity failed:', error);
        return res.status(500).json({ message: 'Failed to load constituency leader popularity', detail: error.message });
    }
};

/* ─── GET /leader-popularity/posts — drill-down ────────────────────────── */

const getLeaderPopularityPosts = async (req, res) => {
    try {
        const { constituency, entity_key: entityKey, entity_name: entityName, days, from, to } = req.query;
        const sentiment = sanitizeSentiment(req.query.sentiment);
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
        // Same window the leaderboard card was computed under, or clicking into
        // a "last 30 days" number would show all-time posts underneath it.
        const range = dateRange({ days, from, to });

        if (!constituency) return res.status(400).json({ message: 'constituency is required' });
        if (!entityKey && !entityName) return res.status(400).json({ message: 'entity_key or entity_name is required' });

        if (req.scope && !req.scope.canSeeAll) {
            const { normalizeConstituencyKey } = require('../services/mlaReferenceService');
            const allowed = req.scope.constituencyKeys || new Set();
            if (!allowed.has(normalizeConstituencyKey(constituency))) {
                return res.status(403).json({ message: 'This constituency is outside your assigned scope' });
            }
        }

        // Every raw string a record for this entity could carry — see
        // rawAliasesForKey in the file header. Off-roster entities (no key)
        // match on their display name alone.
        const aliases = entityKey ? rawAliasesForKey(entityKey) : [String(entityName)];
        const aliasRegexes = aliases.map((a) => new RegExp(`^${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));

        const constituencyRe = new RegExp(`^${String(constituency).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

        // The card the user clicked shows PERSON-aligned sentiment (see THE
        // CRITICAL STEP). `sentiment` on this request is that aligned value —
        // for an opposition figure it must be translated back to the RAW
        // client-relative value before it can filter the DB, or "negative
        // about an opposition leader" would query for stored negative and return posts that
        // are actually positive for that leader. Every returned post's `sentiment`
        // field is aligned back before it reaches the response, so what the
        // drill-down shows always matches what the card that opened it showed.
        const entity = entityKey
            ? { alignment: (POLITICAL_ENTITIES[entityKey] || {}).alignment || 'unknown' }
            : resolveEntity(entityName) || { alignment: 'unknown' };
        const toRawSentiment = (aligned) => {
            if (!aligned || aligned === 'neutral' || entity.alignment !== 'opposition') return aligned;
            return aligned === 'positive' ? 'negative' : 'positive';
        };
        const rawSentimentFilter = sentiment ? toRawSentiment(sentiment) : undefined;

        // Mirrors rawCounts' $ifNull EXACTLY: prefer target_entity_canonical,
        // and only consult target_entity when canonical is absent. A plain
        // $or across both fields independently over-matched by 38 rows the
        // first time this was checked against real data for the CM's seat — rows
        // whose canonical resolved to someone else but whose separate
        // target_entity fallback text happened to also contain a CM alias.
        const gMatch = {
            ...(grievanceGate() ? { $and: [grievanceGate()] } : {}),
            is_active: true,
            'detected_location.constituency': constituencyRe,
            $or: [
                { 'analysis.target_entity_canonical': { $in: aliasRegexes } },
                {
                    'analysis.target_entity_canonical': { $in: [null, ''] },
                    'analysis.target_entity': { $in: aliasRegexes },
                },
            ],
            ...(rawSentimentFilter ? { 'analysis.target_sentiment': sentimentValue(rawSentimentFilter) } : {}),
            ...(range ? { post_date: range } : {}),
        };
        const aMatch = {
            'detected_location.constituency': constituencyRe,
            'llm_analysis.target_entity': { $in: aliasRegexes },
            ...(rawSentimentFilter ? { 'llm_analysis.target_sentiment': sentimentValue(rawSentimentFilter) } : {}),
            ...(range ? { created_at: range } : {}),
        };
        const nMatch = {
            'detected_location.constituency': constituencyRe,
            sentiment_target: { $in: aliasRegexes },
            ...(rawSentimentFilter ? { target_sentiment: sentimentValue(rawSentimentFilter) } : {}),
            ...(range ? { scraped_at: range } : {}),
        };

        const Alert = require('../models/Alert');
        const NewsArticle = require('../models/NewsArticle');

        // FETCH_CAP bounds how many rows per surface are ever pulled into the
        // in-memory merge/sort below — needed because the CM in his own
        // constituency alone runs past 5,000 mentions, and merging a true
        // full result set across 3 collections in Node for every drill-down
        // click would not scale. `total` below is a real countDocuments, not
        // this cap, so the UI can show "5,047 posts" honestly even though
        // paging stops once FETCH_CAP*3 rows have been browsed.
        const FETCH_CAP = 300;

        const [gTotal, aTotal, nTotal, gRows, aRows, nRows] = await Promise.all([
            Grievance.countDocuments(gMatch),
            Alert.countDocuments(aMatch),
            NewsArticle.countDocuments(nMatch),
            Grievance.find(gMatch).select('id content.text analysis.english_translation platform post_date analysis.target_sentiment author_handle content_url')
                .sort({ post_date: -1 }).limit(FETCH_CAP).lean(),
            Alert.find(aMatch).select('id title description platform published_at llm_analysis.target_sentiment author content_url')
                .sort({ published_at: -1 }).limit(FETCH_CAP).lean(),
            NewsArticle.find(nMatch).select('title title_english summary source_name source_url scraped_at target_sentiment')
                .sort({ scraped_at: -1 }).limit(FETCH_CAP).lean(),
        ]);
        const total = gTotal + aTotal + nTotal;
        const fetched = gRows.length + aRows.length + nRows.length;

        const merged = [
            ...gRows.map((g) => ({
                surface: 'mention', id: g.id, text: g.content?.text || g.analysis?.english_translation || '', platform: g.platform,
                date: g.post_date, sentiment: alignToPerson(g.analysis?.target_sentiment, entity.alignment),
                url: g.content_url, author: g.author_handle,
            })),
            ...aRows.map((a) => ({
                surface: 'alert', id: a.id, text: a.title || a.description, platform: a.platform,
                date: a.published_at, sentiment: alignToPerson(a.llm_analysis?.target_sentiment, entity.alignment),
                url: a.content_url, author: a.author,
            })),
            ...nRows.map((n) => ({
                surface: 'news', id: n._id, text: n.title_english || n.title, platform: n.source_name,
                date: n.scraped_at, sentiment: alignToPerson(n.target_sentiment, entity.alignment),
                url: n.source_url, author: n.source_name,
            })),
        ].sort((x, y) => new Date(y.date) - new Date(x.date));

        const start = (page - 1) * limit;
        const pagePosts = merged.slice(start, start + limit);

        return res.status(200).json({
            constituency, entity_key: entityKey || null, entity_name: entityName || null,
            sentiment_basis: 'aligned_to_person',
            total,
            browsable: fetched < total ? fetched : total,
            page, limit, has_more: start + limit < Math.min(fetched, total),
            posts: pagePosts,
        });
    } catch (error) {
        console.error('[leaderPopularityController] getLeaderPopularityPosts failed:', error);
        return res.status(500).json({ message: 'Failed to load posts for this leader', detail: error.message });
    }
};

module.exports = {
    getLeaderPopularity,
    getLeaderPopularityPosts,
    // exported for tests
    resolveEntity,
    alignToPerson,
    rawAliasesForKey,
};
