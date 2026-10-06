/**
 * constituencyIntelligenceController
 * ─────────────────────────────────────────────────────────────────────
 * "Constituency War Room" — party-strategist intelligence across all
 * 119 Telangana assembly constituencies.
 *
 * Aggregates the existing Grievance collection (ingested social mentions +
 * citizen grievances) BY CONSTITUENCY and joins it with the MLA reference
 * dataset to produce a ranked, filterable view of:
 *   • neutral public sentiment per seat (positive/negative/neutral)
 *   • grievance volume & negative-mention pressure
 *   • the top civic issues being raised
 *
 * Sentiment here is NEUTRAL per-constituency (analysis.sentiment), i.e.
 * about the seat/MLA on their own merits — NOT the client-relative score.
 */

const Grievance = require('../models/Grievance');
const {
  getAllMlas,
  getMlaByConstituency,
  normalizeConstituencyKey,
} = require('../services/mlaReferenceService');
const { getVoterProfileByConstituency } = require('../services/voterProfileService');
const cacheService = require('../services/cacheService');
const { computeLeaderMentionStats, getGrievanceEvidenceIds } = require('../services/leaderMentionService');
const { grievanceGate, applyGate } = require('../config/displayGate');

const CONST_CACHE_TTL = 60;
const VALID_PLATFORMS = new Set(['x', 'facebook', 'whatsapp', 'instagram', 'youtube']);
/** 'moderate' is the retired name of 'neutral'; both are accepted and matched. */
const canonicalSentimentParam = (v) => (v === 'moderate' ? 'neutral' : v);
const sentimentValue = (s) => (s === 'neutral' ? { $in: ['neutral', 'moderate'] } : s);
const VALID_SENTIMENTS = new Set(['positive', 'negative', 'neutral', 'moderate']);
/** Whitelists platform/sentiment against the schema's own enums before they reach a Mongo $match — matches the guard geoIntelController applies for the same class of query-param-injection risk. */
const sanitizePlatform = (v) => (typeof v === 'string' && VALID_PLATFORMS.has(v) ? v : undefined);
const sanitizeSentiment = (v) => (typeof v === 'string' && VALID_SENTIMENTS.has(v) ? canonicalSentimentParam(v) : undefined);
/** Scope identity for cache keys — a scoped caller's row-filtered leaderboard must never be served from a superadmin's cached full roster, or vice versa. */
const scopeCacheKey = (scope) => (
  scope && !scope.canSeeAll ? `s:${[...(scope.constituencyKeys || [])].sort().join(',')}` : 'all'
);

/* RBAC helper: clamp a constituency list to the caller's allowed scope. */
const scopeMlaList = (mlas, scope) => {
  if (!scope || scope.canSeeAll) return mlas;
  const allowed = scope.constituencyKeys || new Set();
  return mlas.filter((m) => allowed.has(normalizeConstituencyKey(m.constituency)));
};

const isInScope = (constituency, scope) => {
  if (!scope || scope.canSeeAll) return true;
  return (scope.constituencyKeys || new Set()).has(normalizeConstituencyKey(constituency));
};

/* ─── helpers ─────────────────────────────────────────────────────── */

const buildBaseMatch = (queryOpts) => {
  const opts = typeof queryOpts === 'object' && queryOpts !== null ? queryOpts : { days: queryOpts };
  const { days, from, to, topic } = opts;
  const platform = sanitizePlatform(opts.platform);
  const sentiment = sanitizeSentiment(opts.sentiment);

  const match = {
    is_active: true,
    'detected_location.constituency': { $exists: true, $nin: [null, ''] },
  };

  if (from && to) {
    const since = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    match.post_date = { $gte: since, $lte: toDate };
  } else {
    const windowDays = Number(days);
    if (Number.isFinite(windowDays) && windowDays > 0) {
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
      match.post_date = { $gte: since };
    }
  }

  if (platform) match.platform = platform;
  if (sentiment) match['analysis.sentiment'] = sentimentValue(sentiment);
  if (topic && topic !== 'all' && typeof topic === 'string') match.$or = [{ 'analysis.grievance_type': topic }, { 'analysis.category': topic }];

  return match;
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Sentiment index in [-100, 100]: net positivity share.
const sentimentIndex = (pos, neg, total) =>
  total > 0 ? Math.round(((pos - neg) / total) * 100) : 0;

const SENTIMENT_BUCKET = (idx, total) => {
  if (total === 0) return 'no_data';
  if (idx <= -25) return 'critical';
  if (idx < 0) return 'negative';
  if (idx < 25) return 'mixed';
  return 'positive';
};

/**
 * Merges an existence-check $or into a match that may already carry its own
 * $or (e.g. from an active Category filter in buildBaseMatch) — combining
 * via $and rather than overwriting, same pattern used elsewhere in the app
 * (grievanceController's addLocationOrFilter, scopeMiddleware's mergeFilter)
 * for exactly this "two independent $or conditions" situation.
 */
const mergeExistsOr = (match, existsOr) => {
  if (match.$or) {
    const { $or, ...rest } = match;
    return { ...rest, $and: [...(match.$and || []), { $or }, { $or: existsOr }] };
  }
  return { ...match, $or: existsOr };
};

/**
 * Top issues for a match scope, aggregated from the REAL AI-classified
 * category fields (analysis.grievance_type / analysis.category) — not a
 * local keyword lexicon. A keyword scan of raw text produces counts that
 * don't correspond to any value actually stored in the database, so a "Top
 * Issue" tag built from it can never reliably filter the Grievances page by
 * that same category; this aggregates the literal field the Grievances page
 * itself filters on, so a tag's topic value is guaranteed to exist there.
 */
const computeTopIssues = async (match, limit = 8) => {
  const scopedMatch = mergeExistsOr(match, [
    { 'analysis.grievance_type': { $exists: true, $nin: [null, ''] } },
    { 'analysis.category': { $exists: true, $nin: [null, ''] } },
  ]);
  const rows = await Grievance.aggregate([
    { $match: scopedMatch },
    { $project: { topic: { $ifNull: ['$analysis.grievance_type', '$analysis.category'] } } },
    { $match: { topic: { $nin: [null, ''] } } },
    { $group: { _id: '$topic', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
  return rows.map((r) => ({ issue: r._id, count: r.count }));
};

/* ─── GET /api/constituency-intel/leaderboard ─────────────────────────
 * Ranked list of every constituency with sentiment + grievance pressure.
 * Query: ?party=BRS&alliance=None&district=HYDERABAD&sort=negative|volume|index
 *        &order=asc|desc&days=30&limit=200
 */
const getLeaderboard = async (req, res) => {
  try {
    const { party, alliance, district, sort = 'negative', order, days, limit, from, to, platform, sentiment, topic } = req.query;
    // basis=leader: count every post that tags the MLA's handle, names them, or
    // names their constituency (leaderMentionService). Default basis=seat:
    // posts LOCATED in the seat — what the seat heat map and war room use.
    const leaderBasis = req.query.basis === 'leader';

    // Cached WITHOUT scope in the key — the aggregation itself carries no
    // per-user restriction (it's unscoped raw stats keyed only by the date/
    // platform/sentiment/topic window), and scope is applied fresh on every
    // request via `scopeMlaList` below, so one cache entry safely serves
    // every caller's scope.
    const cacheKey = `cintel:leaderboard:v2:${leaderBasis ? 'leader' : 'seat'}:${days || ''}:${from || ''}:${to || ''}:${platform || ''}:${sentiment || ''}:${topic || ''}`;
    let agg = await cacheService.get(cacheKey);
    if (!agg && leaderBasis) {
      const { 'detected_location.constituency': _loc, ...match } = buildBaseMatch(req.query);
      const stats = await computeLeaderMentionStats(Grievance, applyGate(match, grievanceGate()));
      agg = [...stats].map(([seat, st]) => ({ _id: seat, ...st }));
      await cacheService.set(cacheKey, agg, CONST_CACHE_TTL);
    }
    if (!agg) {
      agg = await Grievance.aggregate([
        { $match: buildBaseMatch(req.query) },
        {
          $group: {
            _id: '$detected_location.constituency',
            total: { $sum: 1 },
            positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
            negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
            neutral: { $sum: { $cond: [{ $in: ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
            high_priority: {
              $sum: { $cond: [{ $in: ['$complaint.priority', ['high', 'critical']] }, 1, 0] },
            },
          },
        },
      ]);
      await cacheService.set(cacheKey, agg, CONST_CACHE_TTL);
    }

    // Index aggregation results by normalized constituency key, SUMMING
    // (not overwriting) when two raw casing/whitespace variants of the same
    // seat normalize to the same key — the Mongo $group above groups on the
    // raw, unnormalized string, so two variants produce two separate rows
    // here; a plain Map.set() would silently drop one variant's grievances.
    const statsByKey = new Map();
    for (const row of agg) {
      const key = normalizeConstituencyKey(row._id);
      const existing = statsByKey.get(key);
      if (!existing) {
        statsByKey.set(key, { ...row });
      } else {
        existing.total += row.total;
        existing.positive += row.positive;
        existing.negative += row.negative;
        existing.neutral += row.neutral;
        existing.high_priority += row.high_priority;
      }
    }

    // Start from the full MLA roster so every seat appears, even with 0 data.
    // RBAC: non-super-admin scoped users see only their assigned constituencies.
    const roster = scopeMlaList(getAllMlas(), req.scope);
    let rows = roster.map((mla) => {
      const stat = statsByKey.get(mla.key) || { total: 0, positive: 0, negative: 0, neutral: 0, high_priority: 0 };
      const total = stat.total || 0;
      const idx = sentimentIndex(stat.positive, stat.negative, total);
      return {
        constituency: mla.constituency,
        key: mla.key,
        district: mla.district || null,
        vacant: !!mla.vacant,
        mla: mla.vacant ? null : mla.mla,
        party: mla.vacant ? 'Vacant' : mla.party,
        alliance: mla.vacant ? null : mla.alliance,
        criminalCases: mla.criminalCases ?? null,
        grievances: total,
        positive: stat.positive || 0,
        negative: stat.negative || 0,
        neutral: stat.neutral || 0,
        high_priority: stat.high_priority || 0,
        ...(leaderBasis ? { via_person: stat.via_person || 0, via_constituency: stat.via_seat || 0 } : {}),
        negative_share: total > 0 ? Math.round((stat.negative / total) * 100) : 0,
        sentiment_index: idx,
        bucket: SENTIMENT_BUCKET(idx, total),
      };
    });

    // Filters
    if (party) rows = rows.filter((r) => String(r.party).toUpperCase() === String(party).toUpperCase());
    if (alliance) rows = rows.filter((r) => String(r.alliance).toUpperCase() === String(alliance).toUpperCase());
    if (district) {
      const want = normalizeConstituencyKey(district);
      rows = rows.filter((r) => normalizeConstituencyKey(r.district) === want);
    }

    // Sorting
    const dir = order === 'asc' ? 1 : -1;
    const sorters = {
      negative: (a, b) => (a.negative - b.negative) || (a.negative_share - b.negative_share),
      volume: (a, b) => a.grievances - b.grievances,
      index: (a, b) => a.sentiment_index - b.sentiment_index,
      priority: (a, b) => a.high_priority - b.high_priority,
    };
    const sorter = sorters[sort] || sorters.negative;
    rows.sort((a, b) => sorter(a, b) * dir);

    const max = Number(limit);
    if (Number.isFinite(max) && max > 0) rows = rows.slice(0, max);

    return res.json({
      success: true,
      count: rows.length,
      window_days: Number(days) || null,
      basis: leaderBasis ? 'leader' : 'seat',
      sort,
      order: order === 'asc' ? 'asc' : 'desc',
      data: rows,
    });
  } catch (err) {
    console.error('[constituencyIntel] leaderboard error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to build leaderboard' });
  }
};

/* ─── GET /api/constituency-intel/summary ─────────────────────────────
 * State-level rollup: party-wise sentiment, hotspot count, top issues.
 */
const getSummary = async (req, res) => {
  try {
    const { days } = req.query;
    const baseMatch = buildBaseMatch(days);

    const [byParty, totals, topIssues] = await Promise.all([
      // Party-wise sentiment via constituency join done in JS below.
      Grievance.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: '$detected_location.constituency',
            positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
            negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
            total: { $sum: 1 },
          },
        },
      ]),
      Grievance.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
            negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
            neutral: { $sum: { $cond: [{ $in: ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
          },
        },
      ]),
      // Statewide top issues among negative grievances, from the real
      // AI-classified category fields (see computeTopIssues doc comment).
      computeTopIssues({ ...baseMatch, 'analysis.sentiment': 'negative' }, 10),
    ]);

    // Party-wise rollup (join constituency → party).
    const partyAgg = {};
    let hotspots = 0;
    for (const row of byParty) {
      const mla = getMlaByConstituency(row._id);
      const party = mla ? (mla.vacant ? 'Vacant' : mla.party || 'UNKNOWN') : 'UNKNOWN';
      if (!partyAgg[party]) partyAgg[party] = { party, seats: 0, grievances: 0, positive: 0, negative: 0 };
      partyAgg[party].seats += 1;
      partyAgg[party].grievances += row.total;
      partyAgg[party].positive += row.positive;
      partyAgg[party].negative += row.negative;
      const idx = sentimentIndex(row.positive, row.negative, row.total);
      if (row.total >= 5 && idx <= -25) hotspots += 1;
    }
    const partyBreakdown = Object.values(partyAgg).map((p) => ({
      ...p,
      sentiment_index: sentimentIndex(p.positive, p.negative, p.grievances),
    })).sort((a, b) => b.grievances - a.grievances);

    const t = totals[0] || { total: 0, positive: 0, negative: 0, neutral: 0 };

    return res.json({
      success: true,
      window_days: Number(days) || null,
      totals: {
        ...t,
        sentiment_index: sentimentIndex(t.positive, t.negative, t.total),
        constituencies_with_data: byParty.length,
        hotspots,
      },
      party_breakdown: partyBreakdown,
      top_issues: topIssues,
    });
  } catch (err) {
    console.error('[constituencyIntel] summary error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to build summary' });
  }
};

/* ─── GET /api/constituency-intel/:constituency ───────────────────────
 * Per-seat detail: MLA bio + neutral sentiment + top issues +
 * recent negative mentions (evidence).
 */
const getConstituencyDetail = async (req, res) => {
  try {
    const { constituency } = req.params;
    const { days } = req.query;
    const decoded = decodeURIComponent(constituency || '');
    const mla = getMlaByConstituency(decoded);

    // RBAC: scoped users can only fetch detail for their own seat.
    if (!isInScope(decoded, req.scope)) {
      return res.status(403).json({
        success: false,
        code: 'CONSTITUENCY_FORBIDDEN',
        message: 'You are not authorized to view this constituency',
      });
    }

    const baseMatch = {
      // buildBaseMatch(req.query) — not buildBaseMatch(days) — so from/to/
      // platform/sentiment/topic (everything the shared filter bar sends)
      // actually apply; previously only `days` was read, and since the
      // frontend never sends it, no date bound applied at all and this
      // endpoint silently aggregated all-time history.
      ...buildBaseMatch(req.query),
      // Reserved seats store literal parentheses in their name, e.g.
      // "AMALAPURAM (SC)" — escape regex metacharacters before compiling,
      // or "(SC)" is parsed as a capture group and the pattern never matches
      // the real stored value, silently returning zero data for every
      // SC/ST seat.
      'detected_location.constituency': mla ? new RegExp(`^${escapeRegex(mla.constituency)}$`, 'i') : decoded,
    };
    // basis=leader: the posts behind the MLA's leaderboard count — tagging
    // their handle, naming them, or naming their seat — not posts located here.
    if (req.query.basis === 'leader') {
      delete baseMatch['detected_location.constituency'];
      baseMatch._id = { $in: await getGrievanceEvidenceIds(mla ? mla.constituency : decoded) };
    }

    // Cache is safe without a scope segment — the isInScope 403 guard above
    // already runs before this point, so only a caller already authorized
    // for this exact seat can ever reach (or benefit from) the cached entry.
    // v2: top_issues now comes from the real AI-classified category fields
    // instead of a keyword lexicon — versioned so a cached v1 entry (with the
    // old, unfilterable issue labels) can't be served stale.
    const cacheKey = `cintel:detail:v3:${normalizeConstituencyKey(decoded)}:${JSON.stringify(req.query)}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return res.json(cached);

    const [counts, recent, topIssues] = await Promise.all([
      Grievance.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
            negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
            neutral: { $sum: { $cond: [{ $in: ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
            high_priority: { $sum: { $cond: [{ $in: ['$complaint.priority', ['high', 'critical']] }, 1, 0] } },
          },
        },
      ]),
      Grievance.find(baseMatch)
        .select('content.text analysis.sentiment posted_by.handle posted_by.display_name platform post_date tweet_id')
        .sort({ post_date: -1 })
        .limit(400)
        .lean(),
      // From the real AI-classified category fields, not a keyword scan —
      // see computeTopIssues doc comment.
      computeTopIssues(baseMatch, 8),
    ]);

    const c = counts[0] || { total: 0, positive: 0, negative: 0, neutral: 0, high_priority: 0 };

    const recentNegative = recent
      .filter((g) => g?.analysis?.sentiment === 'negative')
      .slice(0, 15)
      .map((g) => ({
        text: g?.content?.text || '',
        handle: g?.posted_by?.handle || null,
        display_name: g?.posted_by?.display_name || null,
        platform: g.platform,
        post_date: g.post_date,
        tweet_id: g.tweet_id,
      }));

    const payload = {
      success: true,
      window_days: Number(days) || null,
      mla: mla || { constituency: decoded },
      sentiment: {
        ...c,
        sentiment_index: sentimentIndex(c.positive, c.negative, c.total),
        bucket: SENTIMENT_BUCKET(sentimentIndex(c.positive, c.negative, c.total), c.total),
      },
      top_issues: topIssues,
      recent_negative: recentNegative,
    };
    await cacheService.set(cacheKey, payload, CONST_CACHE_TTL);
    return res.json(payload);
  } catch (err) {
    console.error('[constituencyIntel] detail error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to build constituency detail' });
  }
};

/* ─── GET /api/constituency-intel/:constituency/narrative ─────────────
 * Social-media narrative intelligence for one seat: platform-wide sentiment,
 * conversation-volume trend, platform mix, trending topics/hashtags,
 * top influencers, narrative themes, and rule-based insights.
 * All figures are aggregated from the Grievance collection (ingested social
 * mentions) scoped to this constituency — real, not illustrative.
 */
const getConstituencyNarrative = async (req, res) => {
  try {
    const { constituency } = req.params;
    const decodedForScope = decodeURIComponent(constituency || '');
    // RBAC: same guard getConstituencyDetail applies — without this, a
    // seat-scoped MLA/MP could pull narrative intelligence for ANY
    // constituency, not just their own, by hitting this endpoint directly.
    if (!isInScope(decodedForScope, req.scope)) {
      return res.status(403).json({
        success: false,
        code: 'CONSTITUENCY_FORBIDDEN',
        message: 'You are not authorized to view this constituency',
      });
    }

    const { days, from, to, platform, sentiment, topic } = req.query;
    let windowDays = Number(days) > 0 ? Number(days) : 30;
    // `since`/`toDate` must be scoped to this request — without `let`, an
    // assignment to an undeclared identifier creates an implicit global in
    // this non-strict CommonJS module, so a concurrent request that takes
    // the other branch could silently read a stale value left behind by a
    // completely unrelated prior request.
    let since;
    let toDate;
    if (from && to) {
      since = new Date(from);
      toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      windowDays = Math.round((toDate.getTime() - since.getTime()) / 86400000);
    } else {
      since = new Date(Date.now() - windowDays * 86400000);
    }
    const prevSince = new Date(since.getTime() - (toDate ? (toDate.getTime() - since.getTime()) : 30 * 86400000));

    const decoded = decodeURIComponent(constituency || '');
    const mla = getMlaByConstituency(decoded);

    // Safe without a scope segment for the same reason as getConstituencyDetail
    // — the isInScope 403 guard above already runs first.
    const narrativeCacheKey = `cintel:narrative:v2:${normalizeConstituencyKey(decoded)}:${JSON.stringify(req.query)}`;
    const cachedNarrative = await cacheService.get(narrativeCacheKey);
    if (cachedNarrative) return res.json(cachedNarrative);

    const targetConst = mla ? mla.constituency : decoded;
    const constFilter = {
      $in: [
        targetConst,
        targetConst.toUpperCase(),
        targetConst.toLowerCase(),
        targetConst.charAt(0).toUpperCase() + targetConst.slice(1).toLowerCase(),
      ]
    };

    // basis=leader: the candidate's evidence (handle / name / seat named in the
    // post — leaderMentionService) instead of posts located in the seat.
    const seatClause = req.query.basis === 'leader'
      ? { _id: { $in: await getGrievanceEvidenceIds(targetConst) } }
      : { 'detected_location.constituency': constFilter };
    const baseMatch = { is_active: true, ...seatClause, post_date: { $gte: since } };
    if (toDate) baseMatch.post_date.$lte = toDate;
    const safePlatform = sanitizePlatform(platform);
    const safeSentiment = sanitizeSentiment(sentiment);
    if (safePlatform) baseMatch.platform = safePlatform;
    if (safeSentiment) baseMatch['analysis.sentiment'] = sentimentValue(safeSentiment);
    if (topic && topic !== 'all' && typeof topic === 'string') baseMatch.$or = [{ 'analysis.grievance_type': topic }, { 'analysis.category': topic }];

    const prevMatch = { is_active: true, ...seatClause, post_date: { $gte: prevSince, $lt: since } };

    const sentimentGroup = {
      _id: null,
      total: { $sum: 1 },
      positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
      negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
      neutral: { $sum: { $cond: [{ $in: ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
    };

    const [curAgg, prevAgg, volume, platforms, influencers, recent] = await Promise.all([
      Grievance.aggregate([{ $match: baseMatch }, { $group: sentimentGroup }]),
      Grievance.aggregate([{ $match: prevMatch }, { $group: sentimentGroup }]),
      Grievance.aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$post_date' } },
            count: { $sum: 1 },
            positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
            negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
            neutral: { $sum: { $cond: [{ $in: ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
          }
        },
        { $sort: { _id: 1 } },
      ]),
      Grievance.aggregate([
        { $match: baseMatch },
        { $group: { _id: '$platform', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Grievance.aggregate([
        { $match: { ...baseMatch, 'posted_by.handle': { $nin: [null, ''] } } },
        {
          $group: {
            _id: '$posted_by.handle',
            display_name: { $first: '$posted_by.display_name' },
            followers: { $max: '$posted_by.follower_count' },
            verified: { $max: { $cond: ['$posted_by.is_verified', 1, 0] } },
            posts: { $sum: 1 },
            reach: { $sum: '$engagement.views' },
          },
        },
        { $sort: { followers: -1, reach: -1 } },
        { $limit: 8 },
      ]),
      Grievance.find(baseMatch)
        .select('content.text analysis.category analysis.grievance_type analysis.sentiment')
        .sort({ post_date: -1 })
        .limit(600)
        .lean(),
    ]);

    const cur = curAgg[0] || { total: 0, positive: 0, negative: 0, neutral: 0 };
    const prev = prevAgg[0] || { total: 0, positive: 0, negative: 0, neutral: 0 };
    const pct = (n, t) => (t > 0 ? Math.round((n / t) * 100) : 0);
    // Sentiment score 0-100 (positive weight 1, neutral 0.5).
    const scoreOf = (s) => (s.total > 0 ? Math.round(((s.positive + 0.5 * s.neutral) / s.total) * 100) : 0);
    const curScore = scoreOf(cur);
    const prevScore = scoreOf(prev);

    // Topics: merge classified categories + extracted hashtags.
    const topicCounts = {};
    const hashtagCounts = {};
    const HASHTAG_RE = /#[\wऀ-ॿఀ-౿]+/g;
    const bySentimentCat = { positive: {}, negative: {}, neutral: {} };
    for (const g of recent) {
      const cat = g?.analysis?.grievance_type || g?.analysis?.category;
      if (cat) topicCounts[cat] = (topicCounts[cat] || 0) + 1;
      const sent = g?.analysis?.sentiment === 'negative' ? 'negative'
        : g?.analysis?.sentiment === 'positive' ? 'positive' : 'neutral';
      if (cat) bySentimentCat[sent][cat] = (bySentimentCat[sent][cat] || 0) + 1;
      const text = g?.content?.text || '';
      const tags = text.match(HASHTAG_RE) || [];
      for (const t of tags) {
        const k = t.toLowerCase();
        hashtagCounts[k] = (hashtagCounts[k] || 0) + 1;
      }
    }
    const topList = (obj, n) => Object.entries(obj).map(([k, v]) => ({ name: k, count: v })).sort((a, b) => b.count - a.count).slice(0, n);
    const topTopics = topList(topicCounts, 6);
    const trendingHashtags = topList(hashtagCounts, 6);
    const topCatOf = (sent) => topList(bySentimentCat[sent], 1)[0] || null;

    const PLATFORM_LABELS = { x: 'X (Twitter)', twitter: 'X (Twitter)', facebook: 'Facebook', youtube: 'YouTube', instagram: 'Instagram', whatsapp: 'WhatsApp', rss: 'Web Articles' };
    const platformMix = platforms.map((p) => ({
      platform: p._id || 'unknown',
      label: PLATFORM_LABELS[p._id] || (p._id || 'Unknown'),
      count: p.count,
      pct: pct(p.count, cur.total),
    }));

    // Rule-based (non-LLM) insights derived from the real aggregates.
    const insights = [];
    if (topTopics.length) insights.push(`Top conversation drivers: ${topTopics.slice(0, 3).map((t) => t.name).join(', ')}.`);
    if (cur.total > 0) {
      const delta = curScore - prevScore;
      if (delta !== 0) insights.push(`Sentiment score ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} pts vs previous ${windowDays}d (now ${curScore}/100).`);
    }
    if (platformMix.length) insights.push(`Most conversation on ${platformMix[0].label} (${platformMix[0].pct}%).`);
    const negTop = topCatOf('negative');
    if (negTop && pct(cur.negative, cur.total) >= 25) insights.push(`Elevated negative sentiment — “${negTop.name}” is the main driver; consider a response.`);
    if (cur.total === 0) insights.push('No social mentions detected for this constituency in the selected window.');

    const narrativePayload = {
      success: true,
      constituency: mla ? mla.constituency : decoded,
      mla: mla ? { name: mla.mla, party: mla.party, alliance: mla.alliance } : null,
      window_days: windowDays,
      sentiment: {
        total: cur.total,
        positive: cur.positive, negative: cur.negative, neutral: cur.neutral,
        positive_pct: pct(cur.positive, cur.total),
        negative_pct: pct(cur.negative, cur.total),
        neutral_pct: pct(cur.neutral, cur.total),
        score: curScore,
        score_change: curScore - prevScore,
      },
      volume_trend: volume.map((v) => ({
        date: v._id,
        count: v.count,
        total: v.count,
        positive: v.positive || 0,
        negative: v.negative || 0,
        neutral: v.neutral || 0,
      })),
      platforms: platformMix,
      top_topics: topTopics,
      trending_hashtags: trendingHashtags,
      narratives: {
        positive: topCatOf('positive'),
        negative: topCatOf('negative'),
        neutral: topCatOf('neutral'),
      },
      top_influencers: influencers.map((i) => ({
        handle: i._id,
        display_name: i.display_name || i._id,
        followers: i.followers || 0,
        verified: !!i.verified,
        posts: i.posts,
        reach: i.reach || 0,
      })),
      ai_insights: insights,
    };
    await cacheService.set(narrativeCacheKey, narrativePayload, CONST_CACHE_TTL);
    return res.json(narrativePayload);
  } catch (err) {
    console.error('[constituencyIntel] narrative error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to build narrative intelligence' });
  }
};

/* ─── internal: full analytics bundle for ONE seat ────────────────────
 * Reuses the exact same aggregations that power the detail + narrative
 * endpoints, packaged into a single object so the head-to-head compare
 * endpoint can fetch two seats in one request. Every figure is derived
 * live from the Grievance collection — nothing illustrative.
 */
const analyzeSeat = async (rawConstituency, queryOpts) => {
  const decoded = decodeURIComponent(rawConstituency || '');
  const mla = getMlaByConstituency(decoded);
  const constName = mla ? mla.constituency : decoded;

  const opts = typeof queryOpts === 'object' && queryOpts !== null ? queryOpts : { days: queryOpts };
  const { days, from, to, platform, sentiment, topic } = opts;
  let since, toDate;
  // `windowDays` must be declared in the function's outer scope, not inside
  // the `else` branch — it's read in the return value below regardless of
  // which branch ran. Previously this was only ever called with a bare
  // `days` number (never from/to), so the `if` branch was unreachable and
  // this bug was latent; threading from/to through (to fix the Comparative
  // sub-tab's filters) exposed it as a ReferenceError.
  let windowDays = Number(days) > 0 ? Number(days) : 90;
  if (from && to) {
    since = new Date(from);
    toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    windowDays = Math.round((toDate.getTime() - since.getTime()) / 86400000);
  } else {
    since = new Date(Date.now() - windowDays * 86400000);
  }
  const prevSince = new Date(since.getTime() - (toDate ? (toDate.getTime() - since.getTime()) : 90 * 86400000));

  const targetConst = mla ? mla.constituency : decoded;
  const constFilter = {
    $in: [
      targetConst,
      targetConst.toUpperCase(),
      targetConst.toLowerCase(),
      targetConst.charAt(0).toUpperCase() + targetConst.slice(1).toLowerCase(),
    ]
  };

  const baseMatch = { is_active: true, 'detected_location.constituency': constFilter, post_date: { $gte: since } };
  if (toDate) baseMatch.post_date.$lte = toDate;
  const safePlatform = sanitizePlatform(platform);
  const safeSentiment = sanitizeSentiment(sentiment);
  if (safePlatform) baseMatch.platform = safePlatform;
  if (safeSentiment) baseMatch['analysis.sentiment'] = sentimentValue(safeSentiment);
  if (topic && topic !== 'all' && typeof topic === 'string') baseMatch.$or = [{ 'analysis.grievance_type': topic }, { 'analysis.category': topic }];

  const prevMatch = { is_active: true, 'detected_location.constituency': constFilter, post_date: { $gte: prevSince, $lt: since } };

  const countsGroup = {
    _id: null,
    total: { $sum: 1 },
    positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
    negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
    neutral: { $sum: { $cond: [{ $in: ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
    high_priority: { $sum: { $cond: [{ $in: ['$complaint.priority', ['high', 'critical']] }, 1, 0] } },
    reach: { $sum: '$engagement.views' },
  };

  const [curAgg, prevAgg, volume, platforms, influencers, recent, topIssues] = await Promise.all([
    Grievance.aggregate([{ $match: baseMatch }, { $group: countsGroup }]),
    Grievance.aggregate([{ $match: prevMatch }, { $group: countsGroup }]),
    Grievance.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$post_date' } },
          count: { $sum: 1 },
          positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
          negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
          neutral: { $sum: { $cond: [{ $in: ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
        }
      },
      { $sort: { _id: 1 } },
    ]),
    Grievance.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$platform', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Grievance.aggregate([
      { $match: { ...baseMatch, 'posted_by.handle': { $nin: [null, ''] } } },
      {
        $group: {
          _id: '$posted_by.handle',
          display_name: { $first: '$posted_by.display_name' },
          followers: { $max: '$posted_by.follower_count' },
          verified: { $max: { $cond: ['$posted_by.is_verified', 1, 0] } },
          posts: { $sum: 1 },
          reach: { $sum: '$engagement.views' },
        },
      },
      { $sort: { followers: -1, reach: -1 } },
      { $limit: 6 },
    ]),
    Grievance.find(baseMatch)
      .select('content.text analysis.category analysis.grievance_type analysis.sentiment')
      .sort({ post_date: -1 })
      .limit(600)
      .lean(),
    // From the real AI-classified category fields, not a keyword scan —
    // see computeTopIssues doc comment.
    computeTopIssues(baseMatch, 8),
  ]);

  const cur = curAgg[0] || { total: 0, positive: 0, negative: 0, neutral: 0, high_priority: 0, reach: 0 };
  const prev = prevAgg[0] || { total: 0, positive: 0, negative: 0, neutral: 0 };
  const pct = (n, t) => (t > 0 ? Math.round((n / t) * 100) : 0);
  const idx = sentimentIndex(cur.positive, cur.negative, cur.total);
  // Social sentiment score 0-100 (positive weight 1, neutral 0.5).
  const scoreOf = (s) => (s.total > 0 ? Math.round(((s.positive + 0.5 * s.neutral) / s.total) * 100) : 0);
  const curScore = scoreOf(cur);
  const prevScore = scoreOf(prev);

  // Trending topics/hashtags from this seat's grievance text — already
  // sourced from the real analysis.grievance_type/category fields (unlike
  // top_issues before this fix, this loop was never using the keyword
  // lexicon), so it's left as-is.
  const topicCounts = {};
  const hashtagCounts = {};
  const HASHTAG_RE = /#[\wऀ-ॿఀ-౿]+/g;
  for (const g of recent) {
    const cat = g?.analysis?.grievance_type || g?.analysis?.category;
    if (cat) topicCounts[cat] = (topicCounts[cat] || 0) + 1;
    const tags = (g?.content?.text || '').match(HASHTAG_RE) || [];
    for (const t of tags) {
      const k = t.toLowerCase();
      hashtagCounts[k] = (hashtagCounts[k] || 0) + 1;
    }
  }
  const topList = (obj, n) => Object.entries(obj)
    .map(([k, v]) => ({ name: k, count: v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);

  const PLATFORM_LABELS = { x: 'X (Twitter)', twitter: 'X (Twitter)', facebook: 'Facebook', youtube: 'YouTube', instagram: 'Instagram', whatsapp: 'WhatsApp' };
  const platformMix = platforms.map((p) => ({
    platform: p._id || 'unknown',
    label: PLATFORM_LABELS[p._id] || (p._id || 'Unknown'),
    count: p.count,
    pct: pct(p.count, cur.total),
  }));

  // Voter profile (static ECI data) — demographics + latest assembly result.
  const voter = getVoterProfileByConstituency(decoded);
  const eLatest = voter?.election_latest || {};

  return {
    constituency: constName,
    key: normalizeConstituencyKey(constName),
    mla: mla ? {
      name: mla.mla,
      party: mla.party,
      alliance: mla.alliance,
      criminalCases: mla.criminalCases ?? null,
      education: mla.education ?? null,
      assets: mla.assets ?? null,
    } : { name: null, party: null, alliance: null },
    window_days: windowDays,
    sentiment: {
      total: cur.total,
      positive: cur.positive,
      negative: cur.negative,
      neutral: cur.neutral,
      high_priority: cur.high_priority,
      reach: cur.reach || 0,
      positive_pct: pct(cur.positive, cur.total),
      negative_pct: pct(cur.negative, cur.total),
      neutral_pct: pct(cur.neutral, cur.total),
      sentiment_index: idx,
      bucket: SENTIMENT_BUCKET(idx, cur.total),
      score: curScore,
      score_change: curScore - prevScore,
    },
    top_issues: topIssues,
    top_topics: topList(topicCounts, 6),
    trending_hashtags: topList(hashtagCounts, 6),
    volume_trend: volume.map((v) => ({
      date: v._id,
      count: v.count,
      total: v.count,
      positive: v.positive || 0,
      negative: v.negative || 0,
      neutral: v.neutral || 0,
    })),
    platforms: platformMix,
    top_influencers: influencers.map((i) => ({
      handle: i._id,
      display_name: i.display_name || i._id,
      followers: i.followers || 0,
      verified: !!i.verified,
      posts: i.posts,
      reach: i.reach || 0,
    })),
    voter: voter ? {
      electors_total: voter.electors_total ?? null,
      electors_male: voter.electors_male ?? null,
      electors_female: voter.electors_female ?? null,
      election_year: voter.election_year ?? null,
      vote_share_latest: eLatest.winner ? eLatest.winner.vote_pct : null,
      margin_latest: eLatest.margin ?? null,
    } : null,
  };
};

/* ─── GET /api/constituency-intel/compare ─────────────────────────────
 * Head-to-head comparison of two constituencies/candidates.
 * Query: ?a=Gajwel&b=Siddipet&days=90
 * Returns each seat's full analytics bundle plus a computed, per-metric
 * "who's ahead" head-to-head and an overall verdict.
 */
const getComparison = async (req, res) => {
  try {
    const { a, b, days, from, to, platform, sentiment, topic } = req.query;
    if (!a || !b) {
      return res.status(400).json({ success: false, message: 'Both ?a and ?b constituencies are required' });
    }
    const decodedA = decodeURIComponent(a);
    const decodedB = decodeURIComponent(b);
    if (normalizeConstituencyKey(decodedA) === normalizeConstituencyKey(decodedB)) {
      return res.status(400).json({ success: false, message: 'Pick two different constituencies to compare' });
    }

    // NOTE: Intentional product decision — the head-to-head compare is open to
    // every authenticated user, including seat-scoped ones (e.g. an MLA
    // comparing their own seat against a rival). It exposes only AGGREGATE
    // sentiment/issues/narrative for the two seats (the same class of figures
    // shown on the profile), never row-level grievances or restricted data,
    // so it does not widen access to sensitive per-record content.
    // Forward the full filter set (not just `days`) so Comparative honors the
    // same date range/platform/sentiment/topic filters as every other tab —
    // previously only `days` reached analyzeSeat and the rest were dropped.
    const opts = { days, from, to, platform, sentiment, topic };
    const [seatA, seatB] = await Promise.all([
      analyzeSeat(decodedA, opts),
      analyzeSeat(decodedB, opts),
    ]);

    // Per-metric head-to-head. dir = 'higher' means a bigger value wins.
    const metricDefs = [
      { key: 'sentiment_index', label: 'Sentiment Index', dir: 'higher', a: seatA.sentiment.sentiment_index, b: seatB.sentiment.sentiment_index, unit: '' },
      { key: 'positive_pct', label: 'Positive Share', dir: 'higher', a: seatA.sentiment.positive_pct, b: seatB.sentiment.positive_pct, unit: '%' },
      { key: 'negative_pct', label: 'Negative Share', dir: 'lower', a: seatA.sentiment.negative_pct, b: seatB.sentiment.negative_pct, unit: '%' },
      { key: 'score', label: 'Social Sentiment Score', dir: 'higher', a: seatA.sentiment.score, b: seatB.sentiment.score, unit: '/100' },
      { key: 'total', label: 'Conversation Volume', dir: 'higher', a: seatA.sentiment.total, b: seatB.sentiment.total, unit: '' },
      { key: 'reach', label: 'Total Reach', dir: 'higher', a: seatA.sentiment.reach, b: seatB.sentiment.reach, unit: '' },
      { key: 'high_priority', label: 'High-Priority Grievances', dir: 'lower', a: seatA.sentiment.high_priority, b: seatB.sentiment.high_priority, unit: '' },
      { key: 'criminalCases', label: 'Clean Record (fewer cases)', dir: 'lower', a: seatA.mla.criminalCases, b: seatB.mla.criminalCases, unit: '' },
    ];

    let aWins = 0;
    let bWins = 0;
    const head_to_head = metricDefs.map((m) => {
      const num = (x) => (x === null || x === undefined || x === '' ? null : (Number.isFinite(Number(x)) ? Number(x) : null));
      const av = num(m.a);
      const bv = num(m.b);
      let winner = 'tie';
      if (av != null && bv != null && av !== bv) {
        const aBetter = m.dir === 'higher' ? av > bv : av < bv;
        winner = aBetter ? 'a' : 'b';
      } else if (av != null && bv == null) {
        winner = 'a';
      } else if (bv != null && av == null) {
        winner = 'b';
      }
      // Only sentiment/reputation metrics count toward the overall verdict;
      // raw volume is buzz, not necessarily "better", so it's shown but neutral.
      const countsToward = m.key !== 'total' && m.key !== 'reach';
      if (countsToward && winner === 'a') aWins += 1;
      if (countsToward && winner === 'b') bWins += 1;
      return { ...m, a: av, b: bv, winner, counts_toward_verdict: countsToward };
    });

    const overall = aWins === bWins ? 'tie' : (aWins > bWins ? 'a' : 'b');

    return res.json({
      success: true,
      window_days: seatA.window_days,
      a: seatA,
      b: seatB,
      head_to_head,
      verdict: { overall, a_wins: aWins, b_wins: bWins },
    });
  } catch (err) {
    console.error('[constituencyIntel] compare error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to build comparison' });
  }
};

module.exports = {
  getLeaderboard,
  getSummary,
  getConstituencyDetail,
  getConstituencyNarrative,
  getComparison,
};
