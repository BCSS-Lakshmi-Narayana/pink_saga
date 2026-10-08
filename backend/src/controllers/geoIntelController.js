/**
 * geoIntelController — Geographic Intelligence
 * ─────────────────────────────────────────────────────────────────────
 * District/city sentiment intelligence, aggregated live from the existing
 * Grievance (social mentions) and NewsArticle collections. No tenant,
 * district, or city name is ever hardcoded here — every group key is
 * derived from whatever `detected_location.district` / `.city` actually
 * contains, so the module works unmodified for any tenant's geography.
 *
 * Ranking methodology (see getDistricts):
 *   • Top Positive Districts  → Wilson score lower bound on the
 *     positive-vs-negative ratio. A plain positive % ranks a district with
 *     1 positive / 0 negative mentions above one with 400 positive / 60
 *     negative — Wilson's confidence-interval bound is the standard fix
 *     (the same method Reddit/Yelp use to rank by rating *and* volume) and
 *     avoids that false signal.
 *   • Top Negative Districts (political risk) → a weighted composite of
 *     (a) Wilson-bound negative confidence, (b) average AI risk_score,
 *     (c) week-over-week growth in negative mentions, and (d) mention
 *     volume (a district with a small but fast-growing negative signal
 *     still needs attention; volume alone would hide it, sentiment alone
 *     would over-react to a single viral post).
 */

const Grievance = require('../models/Grievance');
const NewsArticle = require('../models/NewsArticle');
const cacheService = require('../services/cacheService');
const { hasFeatureAccess } = require('../middleware/rbacMiddleware');
const { isKnownStateLocation, DISTRICT_KEY_ALIASES, DISTRICT_DISPLAY } = require('../config/stateLocations');
const { grievanceGate } = require('../config/displayGate');

/** `is_active: true` plus the display gate: a post still waiting for analysis is not shown in Mentions, so it is not counted here. */
const gatedActive = () => {
  const gate = grievanceGate();
  return gate ? { is_active: true, $and: [gate] } : { is_active: true };
};

const GEO_PAGE_PATH = '/geographic-intelligence';
const VALID_PLATFORMS = new Set(['x', 'facebook', 'whatsapp', 'instagram', 'youtube']);
/** 'moderate' is the retired name of 'neutral'; both are accepted and matched. */
const canonicalSentimentParam = (v) => (v === 'moderate' ? 'neutral' : v);
const sentimentValue = (s) => (s === 'neutral' ? { $in: ['neutral', 'moderate'] } : s);
const VALID_SENTIMENTS = new Set(['positive', 'negative', 'neutral', 'moderate']);

/** Whitelists platform/sentiment query params against the schema's own enums before they ever reach a Mongo $match — an unvalidated value (e.g. an injected `{ $ne: 'x' }` object via bracket-notation query parsing) silently collapses to "all" instead of being passed through. */
const sanitizePlatform = (v) => (typeof v === 'string' && (v === 'all' || VALID_PLATFORMS.has(v)) ? v : 'all');
const sanitizeSentiment = (v) => (typeof v === 'string' && (v === 'all' || VALID_SENTIMENTS.has(v)) ? canonicalSentimentParam(v) : 'all');
const sanitizeTopic = (v) => (typeof v === 'string' && v ? v : 'all');

const DEFAULT_WINDOW_DAYS = 30;
const VOLUME_CAP = 200; // mentions at which "attention volume" confidence maxes out
const MIN_SAMPLE_FOR_RANKING = 3; // exclude near-zero-volume districts from top-N lists
const RISK_WEIGHTS = { negative: 0.35, risk: 0.30, trend: 0.20, volume: 0.15 };
const LEADERBOARD_CACHE_TTL = 60;
const DETAIL_CACHE_TTL = 60;

// ─── date helpers (mirrors apDashboardController's convention) ───────────
const startOfDay = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setUTCHours(23, 59, 59, 999); return x; };
const parseFrom = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : startOfDay(d); };
const parseTo = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : endOfDay(d); };
const pct = (n, t) => (t > 0 ? Math.round((n / t) * 100) : 0);

const sentimentIndex = (pos, neg, total) => (total > 0 ? Math.round(((pos - neg) / total) * 100) : 0);

const toYMD = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const padTrendSeries = (trendArray, fromDate, toDate) => {
  const map = new Map();
  for (const item of (trendArray || [])) {
    const key = item._id || item.date;
    if (key) map.set(key, item);
  }
  const result = [];
  const curr = new Date(fromDate);
  const end = new Date(toDate);
  curr.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);

  if (curr.getTime() === end.getTime()) {
    curr.setUTCDate(curr.getUTCDate() - 6);
  }

  while (curr <= end) {
    const ymd = toYMD(curr);
    const existing = map.get(ymd);
    const pos = existing ? (existing.positive || 0) : 0;
    const neg = existing ? (existing.negative || 0) : 0;
    const neu = existing ? (existing.neutral || 0) : 0;
    const tot = existing ? (existing.total || existing.count || 0) : 0;
    result.push({
      date: ymd,
      total: tot,
      positive: pos,
      negative: neg,
      neutral: neu,
      sentiment_index: sentimentIndex(pos, neg, tot),
    });
    curr.setUTCDate(curr.getUTCDate() + 1);
  }
  return result;
};

const formatGeoName = (rawName) => {
  if (!rawName) return '';
  const s = String(rawName).trim();
  const lower = s.toLowerCase().replace(/[\s._\-]/g, '');
  
  const district = DISTRICT_DISPLAY[DISTRICT_KEY_ALIASES[lower] || lower];
  if (district) return district;

  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

const riskLevelFromScore = (score) => {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
};

// Wilson score lower bound for a binomial proportion — see file header.
const wilsonLowerBound = (positive, total, z = 1.96) => {
  if (!total || total <= 0) return 0;
  const phat = positive / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = phat + z2 / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denominator);
};

// ─── generic geo-key normalization ────────────────────────────────────────
// Free-text location fields ("Hyderabad" / "hyderabad " / "HYDERABAD")
// need one canonical key so aggregation groups line up with the RBAC scope
// keys built in scopeMiddleware.buildGeoScope (which uses the same rule via
// ConstituencyMaster.normKey). Computed inside the aggregation pipeline so
// grouping happens once, in Mongo, at scale.
const STRIP_CHARS = [' ', '.', '-', "'", ',', '(', ')', '/'];

// Variant spellings of the districts → one key, so "Kawardha District" and
// "Kabirdham" aggregate together and match the scope keys. DISTRICT_KEY_ALIASES
// and DISTRICT_DISPLAY come from config/stateLocations.js (data/state_geo.json).

const geoKeyExpr = (path) => ({
  $let: {
    vars: {
      k: {
        $reduce: {
          input: STRIP_CHARS,
          initialValue: { $toLower: { $trim: { input: { $ifNull: [`$${path}`, ''] } } } },
          in: { $replaceAll: { input: '$$value', find: '$$this', replacement: '' } },
        },
      },
    },
    in: {
      $switch: {
        branches: Object.entries(DISTRICT_KEY_ALIASES).map(([from, to]) => ({ case: { $eq: ['$$k', from] }, then: to })),
        default: '$$k',
      },
    },
  },
});

// JS-side equivalent, for normalizing an inbound route param before matching.
const normalizeKeyJS = (v) => {
  const k = String(v || '').toLowerCase().replace(/[\s.\-',/()]/g, '');
  return DISTRICT_KEY_ALIASES[k] || k;
};

// Geo-tagging can pick up places outside Telangana; the leaderboards show Telangana only.
const inState = (r) => isKnownStateLocation(r.name || '') || Boolean(DISTRICT_DISPLAY[r._id]);

const geoKeyEquals = (path, targetKey) => ({ $expr: { $eq: [geoKeyExpr(path), targetKey] } });
const geoKeyIn = (path, targetKeys) => ({ $expr: { $in: [geoKeyExpr(path), targetKeys] } });

/**
 * District-scope match fragment for aggregations that don't already go
 * through computeLeaderboard (which is scope-filtered after the fact by its
 * callers). Empty for canSeeAll callers; otherwise restricts the pipeline to
 * the caller's allowed districts *before* aggregating, so a scoped user's
 * unauthorized districts are never computed, cached, or returned.
 */
const geoScopeMatch = (geoScope, path = 'detected_location.district') => (
  geoScope && !geoScope.canSeeAll ? geoKeyIn(path, [...geoScope.districtKeys]) : {}
);

/** Stable per-request scope identity for cache keys — two requests with different geo scopes must never share a cache slot. */
const scopeCacheKey = (geoScope) => (
  geoScope && !geoScope.canSeeAll ? `d:${[...geoScope.districtKeys].sort().join(',')}` : 'all'
);

/** Match fragment for the optional Category/Topic filter — reuses the same $ifNull(grievance_type, category) topic definition as computeTopicAnalytics. */
const buildTopicMatch = (topic) => (
  topic && topic !== 'all'
    ? { $or: [{ 'analysis.grievance_type': topic }, { 'analysis.category': topic }] }
    : {}
);

/** Match fragment for the platform/sentiment filters — shared by every sub-panel query (topics, trend, recent activity, influencers, posts) so they honor the same filters as the KPI stats next to them. */
const buildFilterMatch = (platform, sentiment) => {
  const m = {};
  if (platform && platform !== 'all') m.platform = platform;
  if (sentiment && sentiment !== 'all') m['analysis.sentiment'] = sentimentValue(sentiment);
  return m;
};

/** Largest-remainder rounding so a set of percentages that should sum to 100 actually does, instead of each being rounded independently. */
const reconcilePercentages = (counts, total) => {
  if (!total) return counts.map(() => 0);
  const raw = counts.map((n) => (n / total) * 100);
  const floors = raw.map(Math.floor);
  let remainder = 100 - floors.reduce((s, n) => s + n, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k += 1, remainder -= 1) {
    result[order[k].i] += 1;
  }
  return result;
};

/**
 * Core district/city leaderboard aggregation. Geography-agnostic: `path` is
 * whatever location field to group by (district or city), and the shape
 * returned has no notion of "district" vs "city" baked in — callers name
 * the fields for their own response shape.
 */
const computeLeaderboard = async ({ path, from, to, prevFrom, prevTo, platform, sentiment, topic, extraMatch = {} }) => {
  const baseMatch = {
    ...gatedActive(),
    [path]: { $exists: true, $nin: [null, ''] },
    ...extraMatch,
    ...buildTopicMatch(topic),
  };
  if (platform && platform !== 'all') baseMatch.platform = platform;
  if (sentiment && sentiment !== 'all') baseMatch['analysis.sentiment'] = sentimentValue(sentiment);

  const curMatch = { ...baseMatch, post_date: { $gte: from, $lte: to } };
  const prevMatch = { ...baseMatch, post_date: { $gte: prevFrom, $lt: from } };
  const keyExpr = geoKeyExpr(path);

  const sentimentGroup = {
    total: { $sum: 1 },
    positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
    negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
    neutral: { $sum: { $cond: [{ $in: ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
    avg_risk_score: { $avg: { $ifNull: ['$analysis.risk_score', 0] } },
    engagement: {
      $sum: {
        $add: [
          { $ifNull: ['$engagement.likes', 0] },
          { $ifNull: ['$engagement.retweets', 0] },
          { $ifNull: ['$engagement.replies', 0] },
        ],
      },
    },
  };

  const [curRows, prevRows, platformRows, topicRows] = await Promise.all([
    Grievance.aggregate([
      { $match: curMatch },
      { $group: { _id: keyExpr, name: { $first: `$${path}` }, ...sentimentGroup } },
    ]),
    Grievance.aggregate([
      { $match: prevMatch },
      { $group: { _id: keyExpr, ...sentimentGroup } },
    ]),
    Grievance.aggregate([
      { $match: curMatch },
      { $group: { _id: { key: keyExpr, platform: '$platform' }, count: { $sum: 1 } } },
    ]),
    Grievance.aggregate([
      {
        $match: {
          // curMatch may carry the topic filter's own $or: combine, don't overwrite.
          ...(({ $or, ...rest }) => rest)(curMatch),
          $and: [
            ...(curMatch.$and || []),
            ...(curMatch.$or ? [{ $or: curMatch.$or }] : []),
            { $or: [
              { 'analysis.grievance_type': { $exists: true, $nin: [null, ''] } },
              { 'analysis.category': { $exists: true, $nin: [null, ''] } },
            ] },
          ],
        },
      },
      {
        $project: {
          key: keyExpr,
          topic: { $ifNull: ['$analysis.grievance_type', '$analysis.category'] },
          sentiment: '$analysis.sentiment',
          risk_score: { $ifNull: ['$analysis.risk_score', 0] },
        },
      },
      { $match: { topic: { $nin: [null, ''] } } },
      {
        $group: {
          _id: { key: '$key', topic: '$topic' },
          count: { $sum: 1 },
          positive: { $sum: { $cond: [{ $eq: ['$sentiment', 'positive'] }, 1, 0] } },
          negative: { $sum: { $cond: [{ $eq: ['$sentiment', 'negative'] }, 1, 0] } },
          neutral: { $sum: { $cond: [{ $in: ['$sentiment', ['neutral', 'moderate']] }, 1, 0] } },
          avg_risk: { $avg: '$risk_score' },
        },
      },
    ]),
  ]);

  const prevByKey = new Map(prevRows.map((r) => [r._id, r]));

  const platformByKey = new Map();
  platformRows.forEach((r) => {
    const k = r._id.key;
    if (!platformByKey.has(k)) platformByKey.set(k, {});
    platformByKey.get(k)[r._id.platform || 'unknown'] = r.count;
  });

  const topicByKey = new Map();
  topicRows.forEach((r) => {
    const k = r._id.key;
    if (!topicByKey.has(k)) topicByKey.set(k, []);
    topicByKey.get(k).push({
      topic: r._id.topic,
      count: r.count,
      positive: r.positive,
      negative: r.negative,
      neutral: r.neutral,
      risk: Math.round(r.avg_risk || 0),
    });
  });

  return curRows.filter(inState).map((r) => {
    const key = r._id;
    const total = r.total || 0;
    const prev = prevByKey.get(key) || { total: 0, negative: 0 };
    const positive = r.positive || 0;
    const negative = r.negative || 0;
    const neutral = r.neutral || 0;
    const avgRisk = Math.round(r.avg_risk_score || 0);

    const totalGrowth = total > 0 && prev.total > 0
      ? (total - prev.total) / prev.total
      : (total > 0 ? 1 : 0);
    const negGrowth01 = negative > (prev.negative || 0)
      ? Math.min(1, (negative - (prev.negative || 0)) / Math.max(1, prev.negative || 0))
      : 0;
    const volumeNorm = Math.min(1, total / VOLUME_CAP);
    const negativeConfidence = wilsonLowerBound(negative, positive + negative);
    const positiveConfidence = wilsonLowerBound(positive, positive + negative);

    const riskIndex = Math.round(100 * (
      RISK_WEIGHTS.negative * negativeConfidence
      + RISK_WEIGHTS.risk * (avgRisk / 100)
      + RISK_WEIGHTS.trend * negGrowth01
      + RISK_WEIGHTS.volume * volumeNorm
    ));

    const topics = (topicByKey.get(key) || []).sort((a, b) => b.count - a.count).slice(0, 5);

    return {
      key,
      name: formatGeoName(r.name || key),
      total_mentions: total,
      total_social: total,
      positive,
      negative,
      neutral,
      positive_pct: pct(positive, total),
      negative_pct: pct(negative, total),
      neutral_pct: pct(neutral, total),
      avg_risk_score: avgRisk,
      risk_level: riskLevelFromScore(avgRisk),
      sentiment_index: sentimentIndex(positive, negative, total),
      positive_score: Math.round(positiveConfidence * 100),
      risk_index: riskIndex,
      most_discussed_topic: topics[0]?.topic || null,
      top_topics: topics,
      platform_distribution: platformByKey.get(key) || {},
      engagement: r.engagement || 0,
      mention_trend: {
        direction: totalGrowth > 0.15 ? 'rising' : totalGrowth < -0.15 ? 'falling' : 'stable',
        change_pct: Math.round(totalGrowth * 100),
      },
    };
  });
};

/** Merges NewsArticle counts (by the same geo key) onto leaderboard rows. */
const attachNewsCounts = async (rows, path, extraMatch, from, to) => {
  if (!rows.length) return rows;
  const newsRows = await NewsArticle.aggregate([
    {
      $match: {
        ...extraMatch,
        [path]: { $exists: true, $nin: [null, ''] },
        published_date: { $gte: from, $lte: to },
      },
    },
    { $group: { _id: geoKeyExpr(path), count: { $sum: 1 } } },
  ]);
  const newsByKey = new Map(newsRows.map((r) => [r._id, r.count]));
  return rows.map((r) => ({ ...r, total_news: newsByKey.get(r.key) || 0 }));
};

/**
 * Topic analytics for one geo scope (a single district or city), with
 * period-over-period trend — the direct answer to "which issues are
 * increasing rapidly" (trend === 'rising').
 */
const computeTopicAnalytics = async ({ extraMatch, from, to, prevFrom, prevTo, limit = 10 }) => {
  const baseFilter = {
    ...gatedActive(),
    $or: [
      { 'analysis.grievance_type': { $exists: true, $nin: [null, ''] } },
      { 'analysis.category': { $exists: true, $nin: [null, ''] } },
    ],
    ...extraMatch,
  };
  const project = {
    topic: { $ifNull: ['$analysis.grievance_type', '$analysis.category'] },
    sentiment: '$analysis.sentiment',
    risk_score: { $ifNull: ['$analysis.risk_score', 0] },
  };
  const groupStage = {
    _id: '$topic',
    count: { $sum: 1 },
    positive: { $sum: { $cond: [{ $eq: ['$sentiment', 'positive'] }, 1, 0] } },
    negative: { $sum: { $cond: [{ $eq: ['$sentiment', 'negative'] }, 1, 0] } },
    neutral: { $sum: { $cond: [{ $in: ['$sentiment', ['neutral', 'moderate']] }, 1, 0] } },
    avg_risk: { $avg: '$risk_score' },
  };

  const [curRows, prevRows] = await Promise.all([
    Grievance.aggregate([
      { $match: { ...baseFilter, post_date: { $gte: from, $lte: to } } },
      { $project: project },
      { $match: { topic: { $nin: [null, ''] } } },
      { $group: groupStage },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]),
    Grievance.aggregate([
      { $match: { ...baseFilter, post_date: { $gte: prevFrom, $lt: from } } },
      { $project: project },
      { $match: { topic: { $nin: [null, ''] } } },
      { $group: groupStage },
    ]),
  ]);

  const prevByTopic = new Map(prevRows.map((r) => [r._id, r.count]));

  return curRows.map((r) => {
    const prevCount = prevByTopic.get(r._id) || 0;
    const growth = prevCount > 0 ? (r.count - prevCount) / prevCount : (r.count > 0 ? 1 : 0);
    const diff = r.count - prevCount;
    const logVal = Math.log10(Math.max(1.1, r.count));
    const velocityScore = diff * logVal;
    return {
      topic: r._id,
      mention_count: r.count,
      positive: r.positive,
      negative: r.negative,
      neutral: r.neutral,
      risk: Math.round(r.avg_risk || 0),
      risk_level: riskLevelFromScore(Math.round(r.avg_risk || 0)),
      trend: growth >= 0.2 ? 'rising' : growth <= -0.2 ? 'falling' : 'stable',
      trend_change_pct: Math.round(growth * 100),
      velocity_score: velocityScore,
    };
  });
};

/** Top accounts by follower count / reach within a geo scope — same pattern as constituencyIntelligenceController.analyzeSeat. */
const computeTopInfluencers = async ({ extraMatch, from, to, limit = 6 }) => {
  const rows = await Grievance.aggregate([
    { $match: { ...gatedActive(), ...extraMatch, post_date: { $gte: from, $lte: to }, 'posted_by.handle': { $nin: [null, ''] } } },
    {
      $group: {
        _id: '$posted_by.handle',
        display_name: { $first: '$posted_by.display_name' },
        followers: { $max: '$posted_by.follower_count' },
        verified: { $max: { $cond: ['$posted_by.is_verified', 1, 0] } },
        posts: { $sum: 1 },
        reach: { $sum: { $ifNull: ['$engagement.views', 0] } },
      },
    },
    { $sort: { followers: -1, reach: -1 } },
    { $limit: limit },
  ]);
  return rows.map((i) => ({
    handle: i._id,
    display_name: i.display_name || i._id,
    followers: i.followers || 0,
    verified: !!i.verified,
    posts: i.posts,
    reach: i.reach || 0,
  }));
};

/** Posts ranked by total engagement (likes+retweets+replies+views) within a geo scope. */
const computeTopPosts = async ({ extraMatch, from, to, limit = 12 }) => {
  const rows = await Grievance.aggregate([
    { $match: { ...gatedActive(), ...extraMatch, post_date: { $gte: from, $lte: to } } },
    {
      $addFields: {
        total_engagement: {
          $add: [
            { $ifNull: ['$engagement.likes', 0] },
            { $ifNull: ['$engagement.retweets', 0] },
            { $ifNull: ['$engagement.replies', 0] },
            { $ifNull: ['$engagement.views', 0] },
          ],
        },
      },
    },
    { $sort: { total_engagement: -1 } },
    { $limit: limit },
    {
      $project: {
        tweet_id: 1, platform: 1, post_date: 1, total_engagement: 1,
        text: '$content.text',
        sentiment: '$analysis.sentiment',
        risk_level: '$analysis.risk_level',
        city: '$detected_location.city',
        handle: '$posted_by.handle',
        display_name: '$posted_by.display_name',
      },
    },
  ]);
  return rows.map((g) => ({
    id: g.tweet_id,
    text: g.text || '',
    platform: g.platform,
    sentiment: g.sentiment || null,
    risk_level: g.risk_level || null,
    city: g.city || null,
    handle: g.handle || null,
    display_name: g.display_name || null,
    post_date: g.post_date,
    engagement: g.total_engagement || 0,
  }));
};

/** True when from/to was supplied but couldn't be parsed — distinguishes "bad input" from "omitted, use the default window" so callers can 400 instead of silently substituting the default. */
const hasInvalidDateParams = (query) => (
  (query.from && !parseFrom(query.from)) || (query.to && !parseTo(query.to))
);

/** Resolves the from/to/prevFrom/prevTo window from query params, defaulting to 30d. */
const resolveWindow = (query) => {
  const to = parseTo(query.to) || endOfDay(new Date());
  const from = parseFrom(query.from) || new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86400000);
  const windowMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - windowMs);
  return { from, to, prevFrom, prevTo };
};

/** 403 guard: does the caller's geo scope permit this district key? */
const canAccessDistrict = (geoScope, districtKey) => (
  !geoScope || geoScope.canSeeAll || geoScope.districtKeys.has(districtKey)
);

/**
 * Redacts risk-score / city-level fields from a district-detail payload for
 * callers whose role has those `/geographic-intelligence` features disabled
 * (rbacConfig declares `risk_score`/`city_view` as feature toggles, but
 * nothing previously enforced them server-side). Applied on every response
 * — including cache hits — rather than baked into the cached payload, so one
 * cached entry serves every feature-permission combination correctly.
 */
const applySummaryAccess = (req, payload) => {
  if (hasFeatureAccess(req, GEO_PAGE_PATH, 'risk_score')) return payload;
  return {
    ...payload,
    high_risk_district_count: undefined,
    high_risk_districts: undefined,
    emerging_topic: payload.emerging_topic ? (({ risk, risk_level, ...t }) => t)(payload.emerging_topic) : null,
    emerging_topics: (payload.emerging_topics || []).map(({ risk, risk_level, ...t }) => t),
    top_issues_by_volume: (payload.top_issues_by_volume || []).map(({ risk, risk_level, ...t }) => t),
  };
};

const applyDistrictDetailAccess = (req, payload) => {
  const canSeeRisk = hasFeatureAccess(req, GEO_PAGE_PATH, 'risk_score');
  const canSeeCities = hasFeatureAccess(req, GEO_PAGE_PATH, 'city_view');
  let out = payload;
  if (!canSeeRisk && out.stats) {
    const { avg_risk_score, risk_level, risk_index, top_topics, ...restStats } = out.stats;
    out = { ...out, stats: { ...restStats, top_topics: (top_topics || []).map(({ risk, ...t }) => t) } };
  }
  if (!canSeeRisk && Array.isArray(out.top_topics)) {
    out = { ...out, top_topics: out.top_topics.map(({ risk, ...t }) => t) };
  }
  if (!canSeeCities) {
    out = { ...out, cities_preview: [] };
  }
  return out;
};

// ─── GET /api/geo-intel/scope ──────────────────────────────────────────────
const getScope = async (req, res) => {
  try {
    const geoScope = req.geoScope;
    res.json({
      success: true,
      level: geoScope.level,
      can_see_all_districts: geoScope.canSeeAll,
      districts: geoScope.districts,
    });
  } catch (err) {
    console.error('[geoIntel] getScope error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to resolve geographic scope' });
  }
};

// ─── GET /api/geo-intel/districts ──────────────────────────────────────────
// District leaderboard + top-positive/top-negative rankings (query params:
// ?from=&to=&platform=&sentiment=&sort=total|positive|negative|risk&order=&limit=)
const getDistricts = async (req, res) => {
  try {
    if (hasInvalidDateParams(req.query)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date' });
    }
    const platform = sanitizePlatform(req.query.platform);
    const sentiment = sanitizeSentiment(req.query.sentiment);
    const topic = sanitizeTopic(req.query.topic);
    const { sort = 'total', order = 'desc', limit } = req.query;
    const { from, to, prevFrom, prevTo } = resolveWindow(req.query);

    const cacheKey = `geo:districts:v1:${from.toISOString()}:${to.toISOString()}:${platform || ''}:${sentiment || ''}:${topic || ''}`;
    let rows = await cacheService.get(cacheKey);
    if (!rows) {
      const leaderboard = await computeLeaderboard({
        path: 'detected_location.district', from, to, prevFrom, prevTo, platform, sentiment, topic,
      });
      rows = await attachNewsCounts(leaderboard, 'detected_location.district', {}, from, to);
      await cacheService.set(cacheKey, rows, LEADERBOARD_CACHE_TTL);
    }

    const scoped = req.geoScope.canSeeAll
      ? rows
      : rows.filter((r) => req.geoScope.districtKeys.has(r.key));

    const shaped = scoped.map((r) => ({ ...r, district_key: r.key, district_name: r.name }));

    const dir = order === 'asc' ? 1 : -1;
    // Note on naming: `negative` sorts by risk_index (the weighted negativity+risk+
    // growth+volume composite, not a raw negative count/pct), and `risk` sorts by
    // the narrower avg_risk_score (the raw AI model average). See the file header
    // for what each score means.
    const sorters = {
      total: (a, b) => a.total_mentions - b.total_mentions,
      positive: (a, b) => a.positive_score - b.positive_score,
      negative: (a, b) => a.risk_index - b.risk_index,
      risk: (a, b) => a.avg_risk_score - b.avg_risk_score,
    };
    const sorter = sorters[sort] || sorters.total;
    const sorted = [...shaped].sort((a, b) => sorter(a, b) * dir);

    const max = Number(limit);
    const limited = Number.isFinite(max) && max > 0 ? sorted.slice(0, max) : sorted;

    const rankable = shaped.filter((r) => r.total_mentions >= MIN_SAMPLE_FOR_RANKING);

    const canSeeRisk = hasFeatureAccess(req, GEO_PAGE_PATH, 'risk_score');
    const redact = (r) => (canSeeRisk ? r : (() => {
      const { avg_risk_score, risk_level, risk_index, top_topics, ...rest } = r;
      return { ...rest, top_topics: (top_topics || []).map(({ risk, ...t }) => t) };
    })());

    res.json({
      success: true,
      window: { from: from.toISOString(), to: to.toISOString() },
      scope: { level: req.geoScope.level, can_see_all: req.geoScope.canSeeAll },
      count: limited.length,
      districts: limited.map(redact),
      top_positive: [...rankable].sort((a, b) => b.positive_score - a.positive_score).slice(0, 5).map(redact),
      top_negative: [...rankable].sort((a, b) => b.risk_index - a.risk_index).slice(0, 5).map(redact),
    });
  } catch (err) {
    console.error('[geoIntel] getDistricts error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to build district leaderboard' });
  }
};

// ─── GET /api/geo-intel/districts/:districtKey ─────────────────────────────
const getDistrictDetail = async (req, res) => {
  try {
    const districtKey = normalizeKeyJS(decodeURIComponent(req.params.districtKey || ''));
    if (!districtKey) return res.status(400).json({ success: false, message: 'districtKey is required' });
    if (!canAccessDistrict(req.geoScope, districtKey)) {
      return res.status(403).json({ success: false, code: 'DISTRICT_FORBIDDEN', message: 'You are not authorized to view this district' });
    }

    if (hasInvalidDateParams(req.query)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date' });
    }
    const platform = sanitizePlatform(req.query.platform);
    const sentiment = sanitizeSentiment(req.query.sentiment);
    const topic = sanitizeTopic(req.query.topic);
    const { from, to, prevFrom, prevTo } = resolveWindow(req.query);
    const districtMatch = geoKeyEquals('detected_location.district', districtKey);
    // Sub-panels below (topics, trend, recent activity, influencers, posts) don't
    // go through computeLeaderboard, so they need the platform/sentiment/topic
    // filters folded in explicitly to stay consistent with the KPI stats above.
    const filterMatch = { ...districtMatch, ...buildFilterMatch(platform, sentiment), ...buildTopicMatch(topic) };

    // v2: payload now includes top_topics (previously computed but silently
    // dropped from the response) — versioned so any cache entry from before
    // that fix can't be served stale.
    const cacheKey = `geo:district:v2:${districtKey}:${from.toISOString()}:${to.toISOString()}:${platform || ''}:${sentiment || ''}:${topic || ''}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return res.json(applyDistrictDetailAccess(req, cached));

    const [districtRows, cityRows, topics, trendSeries, recentActivity, topInfluencers, topPosts] = await Promise.all([
      computeLeaderboard({
        path: 'detected_location.district', from, to, prevFrom, prevTo, platform, sentiment, topic, extraMatch: districtMatch,
      }),
      computeLeaderboard({
        path: 'detected_location.city', from, to, prevFrom, prevTo, platform, sentiment, topic, extraMatch: districtMatch,
      }),
      computeTopicAnalytics({ extraMatch: filterMatch, from, to, prevFrom, prevTo, limit: 8 }),
      Grievance.aggregate([
        { $match: { ...gatedActive(), ...filterMatch, post_date: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$post_date' } },
            total: { $sum: 1 },
            positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
            negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
            neutral: { $sum: { $cond: [{ $in: ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Grievance.find({ ...gatedActive(), ...filterMatch, post_date: { $gte: from, $lte: to } })
        .select('content.text analysis.sentiment analysis.risk_level platform post_date tweet_id posted_by.handle posted_by.display_name detected_location.city')
        .sort({ post_date: -1 })
        .limit(12)
        .lean(),
      computeTopInfluencers({ extraMatch: filterMatch, from, to, limit: 6 }),
      computeTopPosts({ extraMatch: filterMatch, from, to, limit: 12 }),
    ]);

    if (!districtRows.length) {
      return res.json({
        success: true,
        district: { key: districtKey, name: districtKey },
        window: { from: from.toISOString(), to: to.toISOString() },
        stats: null,
        cities_preview: [],
        city_count: 0,
        top_topics: [],
        sentiment_trend: [],
        recent_activity: [],
        top_influencers: [],
        top_posts: [],
        message: 'No data for this district in the selected window',
      });
    }

    const [withNews] = await attachNewsCounts(districtRows, 'detected_location.district', districtMatch, from, to);
    const cities = (await attachNewsCounts(cityRows, 'detected_location.city', districtMatch, from, to))
      .sort((a, b) => b.total_mentions - a.total_mentions);

    const payload = {
      success: true,
      district: { key: withNews.key, name: withNews.name },
      window: { from: from.toISOString(), to: to.toISOString() },
      stats: withNews,
      cities_preview: cities.slice(0, 8).map((c) => ({ ...c, city_key: c.key, city_name: c.name })),
      city_count: cities.length,
      top_topics: topics,
      sentiment_trend: padTrendSeries(trendSeries, from, to),
      recent_activity: recentActivity.map((g) => ({
        id: g.tweet_id,
        text: g?.content?.text || '',
        platform: g.platform,
        sentiment: g?.analysis?.sentiment || null,
        risk_level: g?.analysis?.risk_level || null,
        city: g?.detected_location?.city || null,
        handle: g?.posted_by?.handle || null,
        display_name: g?.posted_by?.display_name || null,
        post_date: g.post_date,
      })),
      top_influencers: topInfluencers,
      top_posts: topPosts,
    };

    await cacheService.set(cacheKey, payload, DETAIL_CACHE_TTL);
    res.json(applyDistrictDetailAccess(req, payload));
  } catch (err) {
    console.error('[geoIntel] getDistrictDetail error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to build district detail' });
  }
};

// ─── GET /api/geo-intel/districts/:districtKey/cities ──────────────────────
const getCities = async (req, res) => {
  try {
    const districtKey = normalizeKeyJS(decodeURIComponent(req.params.districtKey || ''));
    if (!districtKey) return res.status(400).json({ success: false, message: 'districtKey is required' });
    if (!canAccessDistrict(req.geoScope, districtKey)) {
      return res.status(403).json({ success: false, code: 'DISTRICT_FORBIDDEN', message: 'You are not authorized to view this district' });
    }
    if (!hasFeatureAccess(req, GEO_PAGE_PATH, 'city_view')) {
      return res.status(403).json({ success: false, code: 'CITY_VIEW_FORBIDDEN', message: 'You are not authorized to view city-level data' });
    }
    if (hasInvalidDateParams(req.query)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date' });
    }

    const platform = sanitizePlatform(req.query.platform);
    const sentiment = sanitizeSentiment(req.query.sentiment);
    const topic = sanitizeTopic(req.query.topic);
    const { sort = 'total', order = 'desc', limit } = req.query;
    const { from, to, prevFrom, prevTo } = resolveWindow(req.query);
    const districtMatch = geoKeyEquals('detected_location.district', districtKey);

    const cacheKey = `geo:cities:v1:${districtKey}:${from.toISOString()}:${to.toISOString()}:${platform || ''}:${sentiment || ''}:${topic || ''}`;
    let rows = await cacheService.get(cacheKey);
    if (!rows) {
      const leaderboard = await computeLeaderboard({
        path: 'detected_location.city', from, to, prevFrom, prevTo, platform, sentiment, topic, extraMatch: districtMatch,
      });
      rows = await attachNewsCounts(leaderboard, 'detected_location.city', districtMatch, from, to);
      await cacheService.set(cacheKey, rows, LEADERBOARD_CACHE_TTL);
    }

    const shaped = rows.map((r) => ({ ...r, city_key: r.key, city_name: r.name }));
    const dir = order === 'asc' ? 1 : -1;
    const sorters = {
      total: (a, b) => a.total_mentions - b.total_mentions,
      positive: (a, b) => a.positive_score - b.positive_score,
      negative: (a, b) => a.risk_index - b.risk_index,
      risk: (a, b) => a.avg_risk_score - b.avg_risk_score,
    };
    const sorter = sorters[sort] || sorters.total;
    const sorted = [...shaped].sort((a, b) => sorter(a, b) * dir);
    // Default/max cap — "view all cities" was previously unbounded when no
    // limit was supplied, which doesn't scale if location detection ever
    // produces many distinct city-name variants for one district.
    const requested = Number(limit);
    const cap = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 500) : 100;
    const limited = sorted.slice(0, cap);

    const canSeeRisk = hasFeatureAccess(req, GEO_PAGE_PATH, 'risk_score');
    const redact = (r) => (canSeeRisk ? r : (() => {
      const { avg_risk_score, risk_level, risk_index, top_topics, ...rest } = r;
      return { ...rest, top_topics: (top_topics || []).map(({ risk, ...t }) => t) };
    })());

    res.json({
      success: true,
      district_key: districtKey,
      window: { from: from.toISOString(), to: to.toISOString() },
      count: limited.length,
      cities: limited.map(redact),
    });
  } catch (err) {
    console.error('[geoIntel] getCities error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to build city leaderboard' });
  }
};

// ─── GET /api/geo-intel/districts/:districtKey/topics ──────────────────────
const getTopics = async (req, res) => {
  try {
    const districtKey = normalizeKeyJS(decodeURIComponent(req.params.districtKey || ''));
    if (!districtKey) return res.status(400).json({ success: false, message: 'districtKey is required' });
    if (!canAccessDistrict(req.geoScope, districtKey)) {
      return res.status(403).json({ success: false, code: 'DISTRICT_FORBIDDEN', message: 'You are not authorized to view this district' });
    }

    if (hasInvalidDateParams(req.query)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date' });
    }
    const platform = sanitizePlatform(req.query.platform);
    const sentiment = sanitizeSentiment(req.query.sentiment);
    const topic = sanitizeTopic(req.query.topic);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const { from, to, prevFrom, prevTo } = resolveWindow(req.query);
    const districtMatch = geoKeyEquals('detected_location.district', districtKey);
    const filterMatch = { ...districtMatch, ...buildFilterMatch(platform, sentiment), ...buildTopicMatch(topic) };

    const cacheKey = `geo:topics:v1:${districtKey}:${from.toISOString()}:${to.toISOString()}:${platform}:${sentiment}:${topic}:${limit}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return res.json(cached);

    const topics = await computeTopicAnalytics({ extraMatch: filterMatch, from, to, prevFrom, prevTo, limit });

    const canSeeRisk = hasFeatureAccess(req, GEO_PAGE_PATH, 'risk_score');
    const shapedTopics = canSeeRisk ? topics : topics.map(({ risk, risk_level, ...t }) => t);

    const payload = {
      success: true,
      district_key: districtKey,
      window: { from: from.toISOString(), to: to.toISOString() },
      count: shapedTopics.length,
      topics: shapedTopics,
      rising: shapedTopics.filter((t) => t.trend === 'rising'),
    };
    await cacheService.set(cacheKey, payload, DETAIL_CACHE_TTL);
    res.json(payload);
  } catch (err) {
    console.error('[geoIntel] getTopics error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to build topic analytics' });
  }
};

// ─── GET /api/geo-intel/summary ────────────────────────────────────────────
// State Overview tab: overall mood, negative/high-risk district counts,
// emerging topic, top issues by volume, platform mix, and the state-wide
// daily sentiment trend. Reuses computeLeaderboard/computeTopicAnalytics —
// no aggregation logic is duplicated for the state-wide rollup.
const getSummary = async (req, res) => {
  try {
    if (hasInvalidDateParams(req.query)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date' });
    }
    const platform = sanitizePlatform(req.query.platform);
    const sentiment = sanitizeSentiment(req.query.sentiment);
    const topic = sanitizeTopic(req.query.topic);
    const { from, to, prevFrom, prevTo } = resolveWindow(req.query);

    // Scope identity is part of the cache key — this payload is already
    // scope-filtered below, so two callers with different geo scopes must
    // never be served each other's cached response.
    const cacheKey = `geo:summary:v2:${scopeCacheKey(req.geoScope)}:${from.toISOString()}:${to.toISOString()}:${platform}:${sentiment}:${topic}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return res.json(applySummaryAccess(req, cached));

    // Every sibling aggregation below (trend/topics/platform-mix/prev-period)
    // must apply the same district-scope restriction as the leaderboard, or a
    // scoped user's trend chart / top-issues panel / platform mix silently
    // shows state-wide data they aren't authorized to see.
    const scope = geoScopeMatch(req.geoScope);
    const dateMatch = { ...gatedActive(), post_date: { $gte: from, $lte: to }, ...scope, ...buildTopicMatch(topic) };
    if (platform && platform !== 'all') dateMatch.platform = platform;
    if (sentiment && sentiment !== 'all') dateMatch['analysis.sentiment'] = sentimentValue(sentiment);
    const prevDateMatch = { ...dateMatch, post_date: { $gte: prevFrom, $lt: from } };
    const topicExtraMatch = { ...scope, ...buildFilterMatch(platform, sentiment) };

    const sentimentTotals = {
      total: { $sum: 1 },
      positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
      negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
      neutral: { $sum: { $cond: [{ $in: ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
    };

    const [districtRows, dailyTrend, topicsStateWide, platformRows, prevTotalsRows] = await Promise.all([
      computeLeaderboard({ path: 'detected_location.district', from, to, prevFrom, prevTo, platform, sentiment, topic }),
      Grievance.aggregate([
        { $match: dateMatch },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$post_date' } }, ...sentimentTotals } },
        { $sort: { _id: 1 } },
      ]),
      computeTopicAnalytics({ extraMatch: topicExtraMatch, from, to, prevFrom, prevTo, limit: 12 }),
      Grievance.aggregate([
        { $match: dateMatch },
        { $group: { _id: '$platform', count: { $sum: 1 } } },
      ]),
      Grievance.aggregate([
        { $match: prevDateMatch },
        { $group: { _id: null, ...sentimentTotals } },
      ]),
    ]);

    // districtRows still needs its own post-filter: computeLeaderboard doesn't
    // take a scope match, and this is also how the district-level rows (not
    // just the sibling aggregations above) stay scoped.
    const scoped = req.geoScope.canSeeAll
      ? districtRows
      : districtRows.filter((r) => req.geoScope.districtKeys.has(r.key));

    const totalMentions = scoped.reduce((s, d) => s + d.total_mentions, 0);
    const totalPositive = scoped.reduce((s, d) => s + d.positive, 0);
    const totalNegative = scoped.reduce((s, d) => s + d.negative, 0);
    const totalNeutral = scoped.reduce((s, d) => s + d.neutral, 0);

    const negativeDistricts = scoped.filter((d) => d.negative > d.positive);
    const highRiskDistricts = scoped.filter((d) => d.risk_level === 'high' || d.risk_level === 'critical');

    // Emerging topic(s): highest week-over-week growth among topics with enough
    // volume to be meaningful (avoids a single viral post reading as "emerging").
    const risingTopics = [...topicsStateWide]
      .filter((t) => t.mention_count >= 5 && t.trend === 'rising')
      .sort((a, b) => b.velocity_score - a.velocity_score);
    const emergingTopic = risingTopics[0] || null;

    const totalTopicMentions = topicsStateWide.reduce((s, t) => s + t.mention_count, 0);
    const topIssuesByVolume = topicsStateWide.map((t) => ({ ...t, share_pct: pct(t.mention_count, totalTopicMentions) }));

    const platformTotal = platformRows.reduce((s, p) => s + p.count, 0);
    const platformDistribution = platformRows
      .map((p) => ({ platform: p._id || 'unknown', count: p.count, pct: pct(p.count, platformTotal) }))
      .sort((a, b) => b.count - a.count);

    // Period-over-period comparison for the KPI strip (Total Mentions /
    // Positive / Negative / Neutral), computed from one extra cheap aggregate
    // over the already-resolved previous window — additive to the response,
    // no change to any other endpoint's contract.
    const prevTotalsRow = prevTotalsRows[0] || { total: 0, positive: 0, negative: 0, neutral: 0 };
    // Largest-remainder rounding so positive/neutral/negative always sum to
    // exactly 100 — independently-rounded percentages can be off by a point
    // and the donut legend shows all three side by side, inviting a sum check.
    const [positivePct, neutralPct, negativePct] = reconcilePercentages(
      [totalPositive, totalNeutral, totalNegative], totalMentions,
    );
    const totalMentionsChangePct = prevTotalsRow.total > 0
      ? Math.round(((totalMentions - prevTotalsRow.total) / prevTotalsRow.total) * 100)
      : (totalMentions > 0 ? 100 : 0);

    const payload = {
      success: true,
      window: { from: from.toISOString(), to: to.toISOString() },
      overall_mood: {
        positive_pct: positivePct,
        negative_pct: negativePct,
        neutral_pct: neutralPct,
      },
      trend: {
        total_mentions_change_pct: totalMentionsChangePct,
        // Point-change (pct this period minus pct last period), not relative
        // growth — the right comparison for an already-a-percentage metric.
        positive_pct_change: positivePct - pct(prevTotalsRow.positive, prevTotalsRow.total),
        negative_pct_change: negativePct - pct(prevTotalsRow.negative, prevTotalsRow.total),
        neutral_pct_change: neutralPct - pct(prevTotalsRow.neutral, prevTotalsRow.total),
      },
      total_mentions: totalMentions,
      // Districts with at least one mention in this window — not the caller's
      // full assigned-district count, which can differ for a scoped user
      // whose assignment includes a district with zero activity right now.
      district_count: scoped.length,
      negative_district_count: negativeDistricts.length,
      high_risk_district_count: highRiskDistricts.length,
      high_risk_districts: highRiskDistricts.map((d) => d.name).slice(0, 6),
      emerging_topic: emergingTopic,
      emerging_topics: risingTopics.slice(0, 5),
      top_issues_by_volume: topIssuesByVolume,
      platform_distribution: platformDistribution,
      sentiment_trend: padTrendSeries(dailyTrend, from, to),
    };

    await cacheService.set(cacheKey, payload, LEADERBOARD_CACHE_TTL);
    res.json(applySummaryAccess(req, payload));
  } catch (err) {
    console.error('[geoIntel] getSummary error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to build state summary' });
  }
};

// ─── GET /api/geo-intel/playback ───────────────────────────────────────────
// Historical Playback tab: per-day, per-district sentiment frames for the
// animated heatmap, plus a per-day platform mix for the "platforms over
// time" chart. Bounded to MAX_PLAYBACK_DAYS to keep the one grouped
// aggregation ({date, district}) cheap regardless of the requested range.
const MAX_PLAYBACK_DAYS = 120;

const getPlayback = async (req, res) => {
  try {
    if (hasInvalidDateParams(req.query)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date' });
    }
    const platform = sanitizePlatform(req.query.platform);
    const sentiment = sanitizeSentiment(req.query.sentiment);
    const topic = sanitizeTopic(req.query.topic);
    let { from, to } = resolveWindow(req.query);
    const maxSpanMs = MAX_PLAYBACK_DAYS * 86400000;
    if (to.getTime() - from.getTime() > maxSpanMs) {
      from = new Date(to.getTime() - maxSpanMs);
    }

    // Scope identity is part of the cache key for the same reason as
    // getSummary — this payload is scope-filtered below and must never be
    // shared across callers with different geo scopes.
    const cacheKey = `geo:playback:v2:${scopeCacheKey(req.geoScope)}:${from.toISOString()}:${to.toISOString()}:${platform}:${sentiment}:${topic}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return res.json(cached);

    // District scope is pushed into the $match itself (not applied after the
    // fact) so a scoped user's unauthorized districts are never aggregated,
    // cached, or returned — and the platform-mix aggregation gets the same
    // restriction, which it was previously missing entirely.
    const scope = geoScopeMatch(req.geoScope);
    const match = {
      ...gatedActive(),
      'detected_location.district': { $exists: true, $nin: [null, ''] },
      post_date: { $gte: from, $lte: to },
      ...scope,
      ...buildTopicMatch(topic),
    };
    if (platform && platform !== 'all') match.platform = platform;
    if (sentiment && sentiment !== 'all') match['analysis.sentiment'] = sentimentValue(sentiment);
    const platformMatch = { ...gatedActive(), post_date: { $gte: from, $lte: to }, ...scope, ...buildTopicMatch(topic) };
    if (platform && platform !== 'all') platformMatch.platform = platform;
    if (sentiment && sentiment !== 'all') platformMatch['analysis.sentiment'] = sentimentValue(sentiment);

    const keyExpr = geoKeyExpr('detected_location.district');

    const [rows, platformRows] = await Promise.all([
      Grievance.aggregate([
        { $match: match },
        {
          $group: {
            _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$post_date' } }, district: keyExpr },
            name: { $first: '$detected_location.district' },
            total: { $sum: 1 },
            positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
            negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
            neutral: { $sum: { $cond: [{ $in: ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
          },
        },
        { $sort: { '_id.date': 1 } },
      ]),
      Grievance.aggregate([
        { $match: platformMatch },
        {
          $group: {
            _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$post_date' } }, platform: '$platform' },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.date': 1 } },
      ]),
    ]);

    const byDate = new Map();
    for (const r of rows) {
      const date = r._id.date;
      if (!byDate.has(date)) byDate.set(date, []);
      if (!isKnownStateLocation(r.name || '') && !DISTRICT_DISPLAY[r._id.district]) continue;
      byDate.get(date).push({
        key: r._id.district,
        name: DISTRICT_DISPLAY[r._id.district] || r.name,
        total_mentions: r.total,
        positive: r.positive,
        negative: r.negative,
        neutral: r.neutral,
        sentiment_index: sentimentIndex(r.positive, r.negative, r.total),
      });
    }

    const platformByDate = new Map();
    for (const r of platformRows) {
      const date = r._id.date;
      if (!platformByDate.has(date)) platformByDate.set(date, {});
      platformByDate.get(date)[r._id.platform || 'unknown'] = r.count;
    }

    // Every calendar day in the window gets a frame, even with zero activity
    // — previously only days that actually had data were included, which
    // desynced the scrubber's frame index from real dates and made the
    // sharp-swing detector compare non-adjacent days.
    const dates = [];
    {
      const curr = new Date(from);
      const end = new Date(to);
      curr.setUTCHours(0, 0, 0, 0);
      end.setUTCHours(0, 0, 0, 0);
      while (curr <= end) {
        dates.push(toYMD(curr));
        curr.setUTCDate(curr.getUTCDate() + 1);
      }
    }
    const frames = dates.map((date) => ({
      date,
      districts: byDate.get(date) || [],
      platforms: platformByDate.get(date) || {},
    }));

    const payload = {
      success: true,
      window: { from: from.toISOString(), to: to.toISOString() },
      frame_count: frames.length,
      frames,
    };

    await cacheService.set(cacheKey, payload, 120);
    res.json(payload);
  } catch (err) {
    console.error('[geoIntel] getPlayback error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to build historical playback data' });
  }
};

module.exports = {
  getScope,
  getDistricts,
  getDistrictDetail,
  getCities,
  getTopics,
  getSummary,
  getPlayback,
};
