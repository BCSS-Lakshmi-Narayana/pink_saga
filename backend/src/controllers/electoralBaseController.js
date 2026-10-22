/**
 * electoralBaseController — election results and electoral analysis per seat.
 *
 *   GET /api/electoral-base/seats         every seat the user may see, results summary
 *   GET /api/electoral-base/seats/:key    one seat: full results + what its posts are about
 *   GET /api/electoral-base/overview      core / swing / opposition across the user's seats
 *
 * Results are verified data in the ElectionHistory collection, written by
 * scripts/build_election_history.js. The
 * one live part is `issues`: the topics of public posts located in a seat over
 * the last 30 days, from this platform's own collection — the "what matters
 * there" next to how the seat has voted. A user restricted to some seats sees
 * only those seats, and every overview figure is computed over just those.
 */
const Grievance = require('../models/Grievance');
const cacheService = require('../services/cacheService');
const { normalizeConstituencyKey } = require('../services/mlaReferenceService');
const electoral = require('../services/electoralBaseService');

const ISSUE_DAYS = 30;
const ISSUE_TTL_SECONDS = 600;

const inScope = (seat, scope) => (!scope || scope.canSeeAll
    ? true
    : (scope.constituencyKeys || new Set()).has(normalizeConstituencyKey(seat.constituency)));
const scopedSeats = (data, req) => data.listSeats().filter((s) => inScope(s, req.scope));

/** 503 with the reason when the results have not been loaded into the DB yet. */
const fail = (res, err, label, message) => {
    if (err && err.code === 'ELECTIONS_NOT_SEEDED') return res.status(503).json({ success: false, message: err.message });
    console.error(`[electoralBase] ${label} error:`, err.message);
    return res.status(500).json({ success: false, message });
};

/** Per seat: posts in the last 30 days, share negative in tone, and topic counts. */
const loadIssues = async () => {
    const cacheKey = `electoral:issues:v1:${ISSUE_DAYS}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return new Map(cached);
    const since = new Date(Date.now() - ISSUE_DAYS * 86400000);
    const rows = await Grievance.aggregate([
        { $match: { is_active: true, post_date: { $gte: since }, 'detected_location.constituency': { $exists: true, $nin: [null, ''] } } },
        { $project: {
            seat: '$detected_location.constituency',
            negative: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] },
            topic: { $ifNull: ['$analysis.topic', { $ifNull: ['$analysis.grievance_type', '$analysis.category'] }] },
        } },
        { $group: { _id: { seat: '$seat', topic: '$topic' }, n: { $sum: 1 }, negative: { $sum: '$negative' } } },
    ]);
    const bySeat = new Map();
    for (const r of rows) {
        const key = normalizeConstituencyKey(r._id.seat);
        const p = bySeat.get(key) || { posts: 0, negative: 0, topics: {} };
        p.posts += r.n;
        p.negative += r.negative;
        const t = r._id.topic;
        if (t && t !== 'Normal') p.topics[t] = (p.topics[t] || 0) + r.n;
        bySeat.set(key, p);
    }
    const out = [...bySeat];
    await cacheService.set(cacheKey, out, ISSUE_TTL_SECONDS);
    return new Map(out);
};

const safeIssues = async () => {
    try { return await loadIssues(); } catch (e) { console.warn('[electoralBase] issues unavailable:', e.message); return new Map(); }
};

/** Combine several seats' issue counts into one ranked list. */
const combineIssues = (seats, issues) => {
    let posts = 0; let negative = 0; const topics = {};
    for (const s of seats) {
        const p = issues.get(s.key);
        if (!p) continue;
        posts += p.posts; negative += p.negative;
        for (const [t, n] of Object.entries(p.topics)) topics[t] = (topics[t] || 0) + n;
    }
    return {
        days: ISSUE_DAYS, posts,
        negative_pct: posts ? Math.round((negative / posts) * 100) : 0,
        top: Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([topic, count]) => ({ topic, count })),
    };
};

const getSeats = async (req, res) => {
    try {
        const data = await electoral.load();
        let seats = scopedSeats(data, req);
        const { district } = req.query;
        if (typeof district === 'string' && district) {
            const want = normalizeConstituencyKey(district);
            seats = seats.filter((s) => normalizeConstituencyKey(s.district) === want);
        }
        res.json({ success: true, count: seats.length, meta: data.meta(), data: seats });
    } catch (err) {
        fail(res, err, 'seats', 'Failed to load seats');
    }
};

const getSeat = async (req, res) => {
    try {
        const data = await electoral.load();
        const key = normalizeConstituencyKey(req.params.key);
        const seat = data.getSeat(key);
        if (!seat || !inScope(seat, req.scope)) return res.status(404).json({ success: false, message: 'Seat not found' });
        const issues = await safeIssues();
        res.json({ success: true, meta: data.meta(), data: { ...seat, ...data.getSeatResults(key), issues: combineIssues([seat], issues) } });
    } catch (err) {
        fail(res, err, 'seat', 'Failed to load seat');
    }
};

const getOverview = async (req, res) => {
    try {
        const data = await electoral.load();
        const seats = scopedSeats(data, req);
        const o = data.overview(seats);
        const issues = await safeIssues();
        const byKey = new Map(seats.map((s) => [s.key, s]));
        const pick = (rows) => rows.map((r) => byKey.get(r.key)).filter(Boolean);
        o.core.issues = combineIssues(seats.filter((s) => s.brs_wins >= 5), issues);
        o.swing.issues = combineIssues(pick(o.swing.close_2023), issues);
        o.issues_all = combineIssues(seats, issues);
        res.json({ success: true, scoped: !(req.scope && req.scope.canSeeAll), meta: data.meta(), data: o });
    } catch (err) {
        fail(res, err, 'overview', 'Failed to build electoral overview');
    }
};

module.exports = { getSeats, getSeat, getOverview, combineIssues };
