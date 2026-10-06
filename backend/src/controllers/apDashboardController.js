/**
 * State Political Intelligence Dashboard Controller
 * -----------------------------------------------
 * Powers the /state-map executive dashboard.
 * All endpoints are date-range and filter aware; results are cached.
 */

const Grievance = require('../models/Grievance');
const Alert = require('../models/Alert');
const Content = require('../models/Content');
const Source = require('../models/Source');
const cacheService = require('../services/cacheService');
const { isKnownStateLocation, canonicalDistrict } = require('../config/stateLocations');
const { APP_NAME, STATE_NAME, CLIENT_DESCRIPTION } = require('../config/deployment');

/**
 * The Negative/Neutral/Positive pills use these labels; stored records use
 * 'neutral', older ones the retired 'moderate', so both must match.
 */
const SENTIMENT_ALIASES = {
  positive: ['positive'],
  negative: ['negative'],
  moderate: ['moderate', 'neutral'],
  neutral: ['moderate', 'neutral'],
};


// District spellings ("Kawardha", "GPM", "Kabirdham district") resolve to the
// canonical district through config/stateLocations.js, which reads them from
// data/state_geo.json.
const normalizeDistrictKey = (name) => {
  if (!name) return '';
  const canonical = canonicalDistrict(name);
  if (canonical) return canonical.toLowerCase();
  return String(name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const startOfDay = (d) => { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; };
const endOfDay   = (d) => { const x = new Date(d); x.setUTCHours(23,59,59,999); return x; };

const parseFrom = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : startOfDay(d);
};
const parseTo = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : endOfDay(d);
};

const safePct = (cur, prev) => {
  if (!prev) return cur ? 100 : 0;
  return Number((((cur - prev) / prev) * 100).toFixed(1));
};

/** Build a Mongoose date-range match clause for `post_date` */
const dateMatch = (from, to) => {
  const q = {};
  if (from || to) {
    q.post_date = {};
    if (from) q.post_date.$gte = from;
    if (to)   q.post_date.$lte = to;
  }
  return q;
};

/** Build Mongoose date-range match clause for Content's `published_at` */
const publishedAtMatch = (from, to) => {
  const q = {};
  if (from || to) {
    q.published_at = {};
    if (from) q.published_at.$gte = from;
    if (to)   q.published_at.$lte = to;
  }
  return q;
};

/** Build Mongoose date-range match clause for Alert's `created_at` */
const alertDateMatch = (from, to) => {
  const q = {};
  if (from || to) {
    q.created_at = {};
    if (from) q.created_at.$gte = from;
    if (to)   q.created_at.$lte = to;
  }
  return q;
};

/** Given a date range, compute the equivalent previous period */
const previousPeriod = (from, to) => {
  if (!from || !to) return { prevFrom: null, prevTo: null };
  const diffMs = to.getTime() - from.getTime();
  const prevTo   = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - diffMs);
  return { prevFrom: startOfDay(prevFrom), prevTo: endOfDay(prevTo) };
};

/** Build optional extra filters from query params */
const buildExtraFilters = (query) => {
  const extra = { is_active: true };
  if (query.district) {
    const d = String(query.district).trim().toLowerCase();
    extra.$or = [
      { 'detected_location.district': { $regex: d, $options: 'i' } },
      { 'detected_location.city': { $regex: d, $options: 'i' } }
    ];
  }
  if (query.sentiment && query.sentiment !== 'all') {
    // 'neutral' and the retired 'moderate' (what older records
    // store) are the same bucket.
    const wanted = SENTIMENT_ALIASES[query.sentiment] || [query.sentiment];
    extra['analysis.sentiment'] = { $in: wanted };
  }
  if (query.platform && query.platform !== 'all') {
    extra.platform = query.platform;
  }
  return extra;
};

const cacheKey = (...parts) => parts.join(':');

// Two independent $or conditions must be combined with $and — spreading a
// second `$or` into the same object silently replaces the first.
const TOPIC_EXISTS_OR = [
  { 'analysis.grievance_type': { $exists: true, $nin: [null, ''] } },
  { 'analysis.category': { $exists: true, $nin: [null, ''] } },
];
const withoutOr = (m) => { const { $or, ...rest } = m; return rest; };
const orClause = (m) => (m.$or ? [{ $or: m.$or }] : []);

const filterSuffix = (query) => {
  return `${query.district || ''}:${query.sentiment || ''}:${query.platform || ''}`;
};

// ─── 1. KPI Snapshot ─────────────────────────────────────────────────────────

/**
 * GET /api/dashboard/ap-kpis
 * Returns current-period KPI values + % change vs previous period.
 */
const getAPKpis = async (req, res) => {
  try {
    const from = parseFrom(req.query.from);
    const to   = parseTo(req.query.to) || endOfDay(new Date());
    const effectiveFrom = from || new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

    const { prevFrom, prevTo } = previousPeriod(effectiveFrom, to);
    const ck = cacheKey('ap:kpis:v3', effectiveFrom.toISOString(), to.toISOString(), filterSuffix(req.query));
    const cached = await cacheService.get(ck);
    if (cached) return res.json(cached);

    const extra = buildExtraFilters(req.query);
    const curMatch  = { ...extra, ...dateMatch(effectiveFrom, to) };
    const prevMatch = { ...extra, ...dateMatch(prevFrom, prevTo) };

    // Run all aggregations in parallel
    const [
      curTotals, prevTotals,
      curSentiment, prevSentiment,
      curEngagement, prevEngagement,
      curAlerts, prevAlerts,
      activeSources, totalAlerts,
      activeConstituencies, activeLeaders
    ] = await Promise.all([
      // Total mentions current / prev
      Grievance.countDocuments(curMatch),
      Grievance.countDocuments(prevMatch),

      // Sentiment breakdown current / prev
      Grievance.aggregate([
        { $match: curMatch },
        { $group: { _id: '$analysis.sentiment', count: { $sum: 1 } } }
      ]),
      Grievance.aggregate([
        { $match: prevMatch },
        { $group: { _id: '$analysis.sentiment', count: { $sum: 1 } } }
      ]),

      // Engagement current / prev
      Grievance.aggregate([
        { $match: curMatch },
        { $group: {
          _id: null,
          likes:    { $sum: { $ifNull: ['$engagement.likes', 0] } },
          retweets: { $sum: { $ifNull: ['$engagement.retweets', 0] } },
          replies:  { $sum: { $ifNull: ['$engagement.replies', 0] } },
          views:    { $sum: { $ifNull: ['$engagement.views', 0] } }
        }}
      ]),
      Grievance.aggregate([
        { $match: prevMatch },
        { $group: {
          _id: null,
          likes:    { $sum: { $ifNull: ['$engagement.likes', 0] } },
          retweets: { $sum: { $ifNull: ['$engagement.retweets', 0] } },
          replies:  { $sum: { $ifNull: ['$engagement.replies', 0] } },
          views:    { $sum: { $ifNull: ['$engagement.views', 0] } }
        }}
      ]),

      // Alerts current / prev
      Alert.countDocuments(alertDateMatch(effectiveFrom, to)),
      Alert.countDocuments(alertDateMatch(prevFrom, prevTo)),

      // Active sources
      Source.countDocuments({ is_active: true }),

      // Total alerts (all time)
      Alert.countDocuments({}),

      // Active constituencies (with data in range)
      Grievance.distinct('detected_location.constituency', { ...curMatch, 'detected_location.constituency': { $nin: [null, ''] } })
        .then(arr => arr.filter(c => c && isKnownStateLocation(c)).length),

      // Active leaders (distinct posted_by.handle)
      Grievance.distinct('posted_by.handle', curMatch)
        .then(arr => arr.filter(Boolean).length)
    ]);

    const sentMap = (rows) => {
      const m = { positive: 0, negative: 0, neutral: 0 };
      (rows || []).forEach(r => {
        if (r._id) {
          const s = (r._id === 'neutral' || r._id === 'moderate') ? 'neutral' : r._id;
          m[s] = (m[s] || 0) + r.count;
        }
      });
      return m;
    };
    const curSent  = sentMap(curSentiment);
    const prevSent = sentMap(prevSentiment);
    const curEng   = curEngagement[0]  || { likes: 0, retweets: 0, replies: 0, views: 0 };
    const prevEng  = prevEngagement[0] || { likes: 0, retweets: 0, replies: 0, views: 0 };
    const totalEngCur  = curEng.likes  + curEng.retweets  + curEng.replies;
    const totalEngPrev = prevEng.likes + prevEng.retweets + prevEng.replies;
    const reachCur  = curEng.views;
    const reachPrev = prevEng.views;

    const pct = (c, p) => safePct(c, p);
    const totalCur = curTotals || 1; // avoid div-by-zero in pct calcs

    const payload = {
      period: { from: effectiveFrom, to },
      kpis: {
        totalMentions:   { value: curTotals,  change: pct(curTotals,  prevTotals),  up: curTotals  >= prevTotals },
        positiveMentions:{ value: curSent.positive, change: pct(curSent.positive, prevSent.positive), pct: +(curSent.positive / totalCur * 100).toFixed(1), up: curSent.positive >= prevSent.positive },
        neutralMentions: { value: curSent.neutral,  change: pct(curSent.neutral,  prevSent.neutral),  pct: +(curSent.neutral  / totalCur * 100).toFixed(1), up: curSent.neutral  >= prevSent.neutral  },
        negativeMentions:{ value: curSent.negative, change: pct(curSent.negative, prevSent.negative), pct: +(curSent.negative / totalCur * 100).toFixed(1), up: curSent.negative <= prevSent.negative },
        totalEngagement: { value: totalEngCur, change: pct(totalEngCur, totalEngPrev), up: totalEngCur >= totalEngPrev },
        potentialReach:  { value: reachCur,    change: pct(reachCur,   reachPrev),   up: reachCur   >= reachPrev  },
        activeConstituencies: { value: activeConstituencies, change: 0, up: true },
        totalAlerts:     { value: curAlerts, change: pct(curAlerts, prevAlerts), up: curAlerts <= prevAlerts },
        activeLeaders:   { value: activeLeaders, change: 0, up: true }
      }
    };
    await cacheService.set(ck, payload, 45);
    res.json(payload);
  } catch (err) {
    console.error('[ap-kpis]', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── 2. Sentiment Over Time ───────────────────────────────────────────────────

/**
 * GET /api/dashboard/ap-sentiment-trend
 * Daily positive/neutral/negative counts over selected period.
 */
const getAPSentimentTrend = async (req, res) => {
  try {
    const from = parseFrom(req.query.from) || new Date(Date.now() - 7 * 86400000);
    const to   = parseTo(req.query.to)   || endOfDay(new Date());
    const ck = cacheKey('ap:sentiment-trend:v3', from.toISOString(), to.toISOString(), filterSuffix(req.query));
    const cached = await cacheService.get(ck);
    if (cached) return res.json(cached);

    const extra = buildExtraFilters(req.query);
    const rows = await Grievance.aggregate([
      { $match: { ...extra, ...dateMatch(from, to) } },
      { $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$post_date' } },
          sentiment: '$analysis.sentiment'
        },
        count: { $sum: 1 }
      }},
      { $sort: { '_id.date': 1 } }
    ]);

    // Build day-keyed map
    const map = {};
    rows.forEach(r => {
      const d = r._id.date;
      const rawSent = r._id.sentiment;
      const s = (rawSent === 'neutral' || rawSent === 'moderate') ? 'neutral' : (rawSent || 'neutral');
      if (!map[d]) map[d] = { date: d, positive: 0, neutral: 0, negative: 0, total: 0 };
      map[d][s] = (map[d][s] || 0) + r.count;
      map[d].total += r.count;
    });

    const series = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
    const payload = { series };
    await cacheService.set(ck, payload, 45);
    res.json(payload);
  } catch (err) {
    console.error('[ap-sentiment-trend]', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── 3. Mention Trend ────────────────────────────────────────────────────────

/**
 * GET /api/dashboard/ap-mention-trend
 * Total mentions per day (area chart data).
 */
const getAPMentionTrend = async (req, res) => {
  try {
    const from = parseFrom(req.query.from) || new Date(Date.now() - 7 * 86400000);
    const to   = parseTo(req.query.to)   || endOfDay(new Date());
    const ck = cacheKey('ap:mention-trend:v3', from.toISOString(), to.toISOString(), filterSuffix(req.query));
    const cached = await cacheService.get(ck);
    if (cached) return res.json(cached);

    const extra = buildExtraFilters(req.query);
    const rows = await Grievance.aggregate([
      { $match: { ...extra, ...dateMatch(from, to) } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$post_date' } },
        count: { $sum: 1 }
      }},
      { $sort: { _id: 1 } }
    ]);

    const series = rows.map(r => ({ date: r._id, count: r.count }));
    const payload = { series };
    await cacheService.set(ck, payload, 45);
    res.json(payload);
  } catch (err) {
    console.error('[ap-mention-trend]', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── 4. Source Distribution ───────────────────────────────────────────────────

/**
 * GET /api/dashboard/ap-source-distribution
 * Mention count by platform (X, Facebook, WhatsApp, Instagram, YouTube).
 */
const getAPSourceDistribution = async (req, res) => {
  try {
    const from = parseFrom(req.query.from) || new Date(Date.now() - 7 * 86400000);
    const to   = parseTo(req.query.to)   || endOfDay(new Date());
    const ck = cacheKey('ap:source-dist:v3', from.toISOString(), to.toISOString(), filterSuffix(req.query));
    const cached = await cacheService.get(ck);
    if (cached) return res.json(cached);

    const extra = buildExtraFilters(req.query);
    const rows = await Grievance.aggregate([
      { $match: { ...extra, ...dateMatch(from, to) } },
      { $group: { _id: '$platform', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const PLATFORM_LABELS = {
      x: 'X (Twitter)', facebook: 'Facebook', whatsapp: 'WhatsApp',
      instagram: 'Instagram', youtube: 'YouTube', rss: 'Web Articles'
    };
    const total = rows.reduce((s, r) => s + r.count, 0);
    const distribution = rows.map(r => ({
      platform: r._id || 'other',
      label: PLATFORM_LABELS[r._id] || r._id || 'Other',
      count: r.count,
      pct: total ? +((r.count / total) * 100).toFixed(1) : 0
    }));

    const payload = { total, distribution };
    await cacheService.set(ck, payload, 60);
    res.json(payload);
  } catch (err) {
    console.error('[ap-source-dist]', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── 5. District Performance ──────────────────────────────────────────────────

/**
 * GET /api/dashboard/ap-district-performance
 * Mentions + sentiment breakdown per district.
 */
const getAPDistrictPerformance = async (req, res) => {
  try {
    const from = parseFrom(req.query.from) || new Date(Date.now() - 7 * 86400000);
    const to   = parseTo(req.query.to)   || endOfDay(new Date());
    const queryForCache = { ...req.query, sentiment: undefined };
    const ck = cacheKey('ap:district-perf:v3', from.toISOString(), to.toISOString(), filterSuffix(queryForCache));
    const cached = await cacheService.get(ck);
    if (cached) return res.json(cached);

    const extra = buildExtraFilters(queryForCache);
    const rows = await Grievance.aggregate([
      { $match: {
        ...extra,
        ...dateMatch(from, to),
        'detected_location.district': { $exists: true, $nin: [null, ''] }
      }},
      { $group: {
        _id: { $toLower: { $trim: { input: '$detected_location.district' } } },
        district: { $first: '$detected_location.district' },
        total: { $sum: 1 },
        positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
        negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
        neutral:  { $sum: { $cond: [{ $in:  ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
        totalEngagement: { $sum: { $add: [
          { $ifNull: ['$engagement.likes', 0] },
          { $ifNull: ['$engagement.retweets', 0] },
          { $ifNull: ['$engagement.replies', 0] }
        ]}}
      }},
      { $sort: { total: -1 } },
      { $limit: 20 }
    ]);

    const districts = rows
      .filter(r => r._id && isKnownStateLocation(r.district || r._id))
      .map(r => ({
        district: r.district || r._id,
        total: r.total,
        positive: r.positive,
        negative: r.negative,
        neutral: r.neutral,
        positivePct: r.total ? +((r.positive / r.total) * 100).toFixed(1) : 0,
        negativePct: r.total ? +((r.negative / r.total) * 100).toFixed(1) : 0,
        engagement: r.totalEngagement
      }));

    const payload = { districts };
    await cacheService.set(ck, payload, 45);
    res.json(payload);
  } catch (err) {
    console.error('[ap-district-perf]', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── 6. Top Topics ────────────────────────────────────────────────────────────

/**
 * GET /api/dashboard/ap-top-topics
 * Top N issues/categories by mention count with sentiment.
 */
const getAPTopTopics = async (req, res) => {
  try {
    const from  = parseFrom(req.query.from) || new Date(Date.now() - 7 * 86400000);
    const to    = parseTo(req.query.to)   || endOfDay(new Date());
    const limit = Math.min(parseInt(req.query.limit) || 10, 30);
    const ck = cacheKey('ap:top-topics:v3', from.toISOString(), to.toISOString(), limit, filterSuffix(req.query));
    const cached = await cacheService.get(ck);
    if (cached) return res.json(cached);

    const extra = buildExtraFilters(req.query);
    // Also compute previous period for growth
    const { prevFrom, prevTo } = previousPeriod(from, to);

    const [curRows, prevRows] = await Promise.all([
      Grievance.aggregate([
        { $match: {
          ...withoutOr(extra),
          ...dateMatch(from, to),
          $and: [...orClause(extra), { $or: TOPIC_EXISTS_OR }]
        }},
        { $project: {
          topic: { $ifNull: ['$analysis.grievance_type', '$analysis.category'] },
          sentiment: '$analysis.sentiment'
        }},
        { $match: { topic: { $nin: [null, ''] } } },
        { $group: {
          _id: '$topic',
          count: { $sum: 1 },
          positive: { $sum: { $cond: [{ $eq: ['$sentiment', 'positive'] }, 1, 0] } },
          negative: { $sum: { $cond: [{ $eq: ['$sentiment', 'negative'] }, 1, 0] } }
        }},
        { $sort: { count: -1 } },
        { $limit: limit }
      ]),
      Grievance.aggregate([
        { $match: {
          ...withoutOr(extra),
          ...dateMatch(prevFrom, prevTo),
          $and: [...orClause(extra), { $or: TOPIC_EXISTS_OR }]
        }},
        { $project: { topic: { $ifNull: ['$analysis.grievance_type', '$analysis.category'] } } },
        { $match: { topic: { $nin: [null, ''] } } },
        { $group: { _id: '$topic', count: { $sum: 1 } } }
      ])
    ]);

    const prevMap = {};
    prevRows.forEach(r => { prevMap[r._id] = r.count; });

    const topics = curRows.map(r => ({
      topic: r._id,
      count: r.count,
      positive: r.positive,
      negative: r.negative,
      dominantSentiment: r.negative > r.positive ? 'negative' : r.positive > r.negative ? 'positive' : 'neutral',
      growth: safePct(r.count, prevMap[r._id] || 0)
    }));

    const payload = { topics };
    await cacheService.set(ck, payload, 45);
    res.json(payload);
  } catch (err) {
    console.error('[ap-top-topics]', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── 7. Alerts Summary ────────────────────────────────────────────────────────

/**
 * GET /api/dashboard/ap-alerts-summary
 * Alert counts by risk level + recent active alerts list.
 */
const getAPAlertsSummary = async (req, res) => {
  try {
    const from = parseFrom(req.query.from) || new Date(Date.now() - 7 * 86400000);
    const to   = parseTo(req.query.to)   || endOfDay(new Date());
    const ck = cacheKey('ap:alerts:v3', from.toISOString(), to.toISOString(), filterSuffix(req.query));
    const cached = await cacheService.get(ck);
    if (cached) return res.json(cached);

    // Build the query match stage for alerts
    const matchObj = alertDateMatch(from, to);
    if (req.query.platform && req.query.platform !== 'all') {
      matchObj.platform = req.query.platform;
    }
    if (req.query.sentiment && req.query.sentiment !== 'all') {
      // Filter on the CLIENT-RELATIVE sentiment the pipeline stored, not on
      // risk_level. risk_level is shared with non-political alert types
      // (velocity/viral spikes, captured archive items) that never ran through
      // the political pipeline, so mapping sentiment onto it pulled unrelated
      // alerts into the wrong bucket — and contradicted alertController, which
      // deliberately stopped using risk_level as a sentiment proxy.
      // Matches the deprecated mirror too, since older alerts carry only that.
      const wanted = SENTIMENT_ALIASES[req.query.sentiment] || [req.query.sentiment];
      matchObj.$and = [...(matchObj.$and || []), {
        $or: [
          { 'llm_analysis.target_sentiment': { $in: wanted } },
          { 'llm_analysis.bsk_sentiment': { $in: wanted } },
        ],
      }];
    }
    
    const basePipeline = [{ $match: matchObj }];
    
    if (req.query.district) {
      const dist = String(req.query.district).trim().toLowerCase();
      basePipeline.push(
        {
          $lookup: {
            from: 'grievances',
            let: { alertId: '$id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$tweet_id', { $concat: ['alert:', '$$alertId'] }] },
                  $or: [
                    { 'detected_location.district': { $regex: dist, $options: 'i' } },
                    { 'detected_location.city': { $regex: dist, $options: 'i' } }
                  ]
                }
              }
            ],
            as: 'matched_grievance'
          }
        },
        { $match: { 'matched_grievance.0': { $exists: true } } }
      );
    }

    const [byLevel, recent] = await Promise.all([
      Alert.aggregate([
        ...basePipeline,
        // Also flag neutral alerts so the dashboard can show them apart from
        // positive ones. Risk follows sentiment (positive -> low, neutral ->
        // low, negative -> high), so 'low' lumps praise together with routine
        // neutral chatter; splitting it is the only way to tell them apart.
        {
          $group: {
            _id: {
              level: '$risk_level',
              neutral: {
                $in: [
                  { $ifNull: ['$llm_analysis.target_sentiment',
                    { $ifNull: ['$llm_analysis.bsk_sentiment', ''] }] },
                  SENTIMENT_ALIASES.neutral,
                ],
              },
            },
            count: { $sum: 1 },
          },
        }
      ]),
      Alert.aggregate([
        ...basePipeline,
        { $sort: { created_at: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'contents',
            localField: 'content_id',
            foreignField: 'id',
            pipeline: [{ $project: { text: 1 } }],
            as: 'content_details'
          }
        },
        { $unwind: { path: '$content_details', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            id: 1,
            title: 1,
            description: 1,
            risk_level: 1,
            platform: 1,
            created_at: 1,
            status: 1,
            author: 1,
            author_handle: 1,
            alert_type: 1,
            priority: 1,
            intent: '$threat_details.intent',
            post_text: '$content_details.text'
          }
        }
      ])
    ]);

    // `neutral` is carved out of `low` rather than added alongside it, so the
    // buckets stay mutually exclusive and still sum to total.
    const summary = { high: 0, medium: 0, low: 0, critical: 0, neutral: 0 };
    byLevel.forEach((r) => {
      const level = r._id && r._id.level;
      if (!level) return;
      if (r._id.neutral && level === 'low') summary.neutral += r.count;
      else summary[level] = (summary[level] || 0) + r.count;
    });
    summary.total = Object.values(summary).reduce((s, v) => s + v, 0);

    const payload = { summary, recent };
    await cacheService.set(ck, payload, 30);
    res.json(payload);
  } catch (err) {
    console.error('[ap-alerts]', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── 8. Recent Activity ───────────────────────────────────────────────────────

/**
 * GET /api/dashboard/ap-recent-activity
 * Latest mentions from in-state constituencies.
 */
const getAPRecentActivity = async (req, res) => {
  try {
    const from = parseFrom(req.query.from);
    const to   = parseTo(req.query.to)   || endOfDay(new Date());
    const limit = Math.min(parseInt(req.query.limit) || 10, 30);
    
    const ck = cacheKey('ap:recent:v3', from ? from.toISOString() : '', to ? to.toISOString() : '', limit, filterSuffix(req.query));
    const cached = await cacheService.get(ck);
    if (cached) return res.json(cached);

    const extra = buildExtraFilters(req.query);
    const dateMatchQuery = from ? { post_date: { $gte: from, $lte: to } } : {};
    const queryMatch = { ...extra, ...dateMatchQuery };

    const items = await Grievance.find(queryMatch)
      .sort({ post_date: -1 })
      .limit(limit)
      .select('posted_by content.text post_date platform analysis.sentiment analysis.grievance_type detected_location engagement tweet_url')
      .lean();

    const activity = items.map(g => ({
      id: g._id,
      author: g.posted_by?.display_name || g.posted_by?.handle || 'Unknown',
      handle: g.posted_by?.handle || '',
      text: g.content?.text?.substring(0, 180) || '',
      platform: g.platform,
      sentiment: g.analysis?.sentiment || 'neutral',
      topic: g.analysis?.grievance_type || '',
      location: g.detected_location?.city || g.detected_location?.district || g.detected_location?.constituency || '',
      likes: g.engagement?.likes || 0,
      replies: g.engagement?.replies || 0,
      url: g.tweet_url || '',
      date: g.post_date
    }));

    const payload = { activity };
    await cacheService.set(ck, payload, 20);
    res.json(payload);
  } catch (err) {
    console.error('[ap-recent]', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── 9. Enhanced Map Data ─────────────────────────────────────────────────────

/**
 * GET /api/dashboard/ap-map-data
 * Full constituency + district-level data for all map view modes:
 * sentiment | volume | engagement | alert_severity | party (static)
 */
const getAPMapData = async (req, res) => {
  try {
    const from = parseFrom(req.query.from) || new Date(Date.now() - 30 * 86400000);
    const to   = parseTo(req.query.to)   || endOfDay(new Date());
    const ck = cacheKey('ap:map-data:v3', from.toISOString(), to.toISOString(), filterSuffix(req.query));
    const cached = await cacheService.get(ck);
    if (cached) return res.json(cached);

    const extra = buildExtraFilters(req.query);

    // Build the query match pipeline for Alerts
    const alertMatchObj = alertDateMatch(from, to);
    if (req.query.platform && req.query.platform !== 'all') {
      alertMatchObj.platform = req.query.platform;
    }
    if (req.query.sentiment && req.query.sentiment !== 'all') {
      // Filter on the CLIENT-RELATIVE sentiment the pipeline stored, not on
      // risk_level. risk_level is shared with non-political alert types
      // (velocity/viral spikes, captured archive items) that never ran through
      // the political pipeline, so mapping sentiment onto it pulled unrelated
      // alerts into the wrong bucket — and contradicted alertController, which
      // deliberately stopped using risk_level as a sentiment proxy.
      // Matches the deprecated mirror too, since older alerts carry only that.
      const wanted = SENTIMENT_ALIASES[req.query.sentiment] || [req.query.sentiment];
      alertMatchObj.$and = [...(alertMatchObj.$and || []), {
        $or: [
          { 'llm_analysis.target_sentiment': { $in: wanted } },
          { 'llm_analysis.bsk_sentiment': { $in: wanted } },
        ],
      }];
    }
    const alertPipeline = [{ $match: alertMatchObj }];
    if (req.query.district) {
      const dist = String(req.query.district).trim().toLowerCase();
      alertPipeline.push(
        {
          $lookup: {
            from: 'grievances',
            let: { alertId: '$id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$tweet_id', { $concat: ['alert:', '$$alertId'] }] },
                  $or: [
                    { 'detected_location.district': { $regex: dist, $options: 'i' } },
                    { 'detected_location.city': { $regex: dist, $options: 'i' } }
                  ]
                }
              }
            ],
            as: 'matched_grievance'
          }
        },
        { $match: { 'matched_grievance.0': { $exists: true } } }
      );
    }
    alertPipeline.push({
      $group: {
        _id: '$risk_level',
        count: { $sum: 1 }
      }
    });

    // Constituency-level and District-level along with Alerts
    const [constituencyRows, districtRows, alertRows] = await Promise.all([
      Grievance.aggregate([
        { $match: {
          is_active: true,
          ...extra,
          ...dateMatch(from, to),
          'detected_location.constituency': { $exists: true, $nin: [null, ''] }
        }},
        { $group: {
          _id: { $toLower: { $trim: { input: '$detected_location.constituency' } } },
          name: { $first: '$detected_location.constituency' },
          total: { $sum: 1 },
          positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
          negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
          neutral:  { $sum: { $cond: [{ $in:  ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
          engagement: { $sum: { $add: [
            { $ifNull: ['$engagement.likes', 0] },
            { $ifNull: ['$engagement.retweets', 0] },
            { $ifNull: ['$engagement.replies', 0] }
          ]}},
          topTopic: { $first: '$analysis.grievance_type' }
        }}
      ]),
      Grievance.aggregate([
        { $match: {
          is_active: true,
          ...extra,
          ...dateMatch(from, to),
          'detected_location.district': { $exists: true, $nin: [null, ''] }
        }},
        { $group: {
          _id: { $toLower: { $trim: { input: '$detected_location.district' } } },
          name: { $first: '$detected_location.district' },
          total: { $sum: 1 },
          positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
          negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
          neutral:  { $sum: { $cond: [{ $in:  ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
          engagement: { $sum: { $add: [
            { $ifNull: ['$engagement.likes', 0] },
            { $ifNull: ['$engagement.retweets', 0] },
            { $ifNull: ['$engagement.replies', 0] }
          ]}}
        }}
      ]),
      Alert.aggregate(alertPipeline)
    ]);

    const toMap = (rows, isDistrict = false, apFilter) => {
      const m = {};
      rows.forEach(r => {
        if (!r._id || !isKnownStateLocation(r.name || r._id)) return;
        if (apFilter && !apFilter(r)) return;
        const key = isDistrict ? normalizeDistrictKey(r.name || r._id) : r._id;
        // Two raw spellings of one district ("Kabirdham", "Kawardha District")
        // share a key: add them up instead of letting the second overwrite.
        const prev = m[key];
        const total = (prev?.total || 0) + (r.total || 0);
        const positive = (prev?.positive || 0) + (r.positive || 0);
        const negative = (prev?.negative || 0) + (r.negative || 0);
        m[key] = {
          name: prev?.name || r.name || r._id,
          total,
          positive,
          negative,
          neutral: (prev?.neutral || 0) + (r.neutral || 0),
          positivePct: total ? +((positive / total) * 100).toFixed(1) : 0,
          negativePct: total ? +((negative / total) * 100).toFixed(1) : 0,
          engagement: (prev?.engagement || 0) + (r.engagement || 0),
          topTopic: prev && prev.total >= (r.total || 0) ? prev.topTopic : (r.topTopic || prev?.topTopic || '')
        };
      });
      return m;
    };

    const payload = {
      constituencies: toMap(constituencyRows, false),
      districts: toMap(districtRows, true),
      alertSummary: Object.fromEntries(alertRows.map(r => [r._id, r.count]))
    };
    await cacheService.set(ck, payload, 45);
    res.json(payload);
  } catch (err) {
    console.error('[ap-map-data]', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── 10. AI Insights (LLM-powered) ───────────────────────────────────────────

/**
 * GET /api/dashboard/ap-ai-insights
 * Generate real insights from actual analytics using OpenAI/Gemini.
 */
const getAPAiInsights = async (req, res) => {
  try {
    const from = parseFrom(req.query.from) || new Date(Date.now() - 7 * 86400000);
    const to   = parseTo(req.query.to)   || endOfDay(new Date());
    const ck = cacheKey('ap:ai-insights:v3', from.toISOString(), to.toISOString(), filterSuffix(req.query));
    const cached = await cacheService.get(ck);
    if (cached) return res.json(cached);

    // Gather analytics data for LLM context
    const extra = buildExtraFilters(req.query);
    const [
      sentimentRows,
      topTopics,
      districtRows,
      alertRows,
      prevSentimentRows
    ] = await Promise.all([
      Grievance.aggregate([
        { $match: { ...extra, ...dateMatch(from, to) } },
        { $group: {
          _id: '$analysis.sentiment',
          count: { $sum: 1 }
        }}
      ]),
      Grievance.aggregate([
        { $match: { ...extra, ...dateMatch(from, to), 'analysis.grievance_type': { $nin: [null, ''] } } },
        { $group: { _id: '$analysis.grievance_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 }
      ]),
      Grievance.aggregate([
        { $match: { ...extra, ...dateMatch(from, to), 'detected_location.district': { $nin: [null, ''] } } },
        { $group: {
          _id: { $toLower: '$detected_location.district' },
          district: { $first: '$detected_location.district' },
          total: { $sum: 1 },
          negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
          positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } }
        }},
        { $sort: { total: -1 } },
        { $limit: 10 }
      ]),
      Alert.countDocuments(alertDateMatch(from, to)),
      (() => {
        const { prevFrom, prevTo } = previousPeriod(from, to);
        return Grievance.aggregate([
          { $match: { ...extra, ...dateMatch(prevFrom, prevTo) } },
          { $group: { _id: '$analysis.sentiment', count: { $sum: 1 } } }
        ]);
      })()
    ]);

    const sentMap = (rows) => {
      const m = { positive: 0, negative: 0, neutral: 0 };
      // 'neutral' and the retired 'moderate' are one bucket.
      rows.forEach(r => {
        if (!r._id) return;
        const k = r._id === 'moderate' ? 'neutral' : r._id;
        m[k] = (m[k] || 0) + r.count;
      });
      m.total = m.positive + m.negative + m.neutral;
      return m;
    };
    const cur  = sentMap(sentimentRows);
    const prev = sentMap(prevSentimentRows);

    const stateDistricts = districtRows.filter(r => isKnownStateLocation(r.district));
    const mostNegativeDistrict = stateDistricts.sort((a, b) => b.negative - a.negative)[0];
    const mostActiveDistrict   = stateDistricts.sort((a, b) => b.total - a.total)[0];

    // Build analytics context for LLM
    const analyticsContext = `
${APP_NAME.toUpperCase()} — INTELLIGENCE SUMMARY
Period: ${from.toDateString()} to ${to.toDateString()}

SENTIMENT OVERVIEW:
- Total mentions: ${cur.total}
- Positive: ${cur.positive} (${cur.total ? ((cur.positive/cur.total)*100).toFixed(1) : 0}%)
- Negative: ${cur.negative} (${cur.total ? ((cur.negative/cur.total)*100).toFixed(1) : 0}%)
- Neutral: ${cur.neutral} (${cur.total ? ((cur.neutral/cur.total)*100).toFixed(1) : 0}%)
- vs Previous period: Positive changed by ${safePct(cur.positive, prev.positive)}%, Negative changed by ${safePct(cur.negative, prev.negative)}%

MOST ACTIVE DISTRICTS:
${stateDistricts.slice(0, 5).map(d => `- ${d.district}: ${d.total} mentions, ${d.negative} negative, ${d.positive} positive`).join('\n')}

TOP ISSUES/TOPICS:
${topTopics.map(t => `- ${t._id}: ${t.count} mentions`).join('\n')}

ALERTS: ${alertRows} alerts generated in this period.
`.trim();

    // Try OpenAI first, fallback to Gemini, fallback to template
    let insights = [];
    let aiProvider = 'none';

    // Try OpenAI
    if (process.env.OPENAI_API_KEY) {
      try {
        const { OpenAI } = require('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'system',
            content: `You are a political intelligence analyst for ${STATE_NAME}, India, working for ${CLIENT_DESCRIPTION}. Analyze the provided data and generate 5 specific, actionable insights. Each insight must be based directly on the numbers provided. Be concise (1-2 sentences each). Focus on trends, anomalies, and opportunities for the government and party leadership. Output as a JSON array of strings.`
          }, {
            role: 'user',
            content: `${analyticsContext}\n\nGenerate 5 specific political intelligence insights based on this data. Return only a JSON array of 5 insight strings.`
          }],
          temperature: 0.3,
          max_tokens: 600,
          response_format: { type: 'json_object' }
        });
        const parsed = JSON.parse(completion.choices[0].message.content);
        insights = parsed.insights || parsed.data || Object.values(parsed)[0] || [];
        if (Array.isArray(insights) && insights.length > 0) aiProvider = 'openai';
      } catch (aiErr) {
        console.warn('[ap-ai-insights] OpenAI failed:', aiErr.message);
      }
    }

    // Fallback to Gemini
    if (insights.length === 0 && process.env.GEMINI_API_KEY) {
      try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: `${analyticsContext}\n\nYou are a political intelligence analyst for ${STATE_NAME}, India, working for ${CLIENT_DESCRIPTION}. Generate exactly 5 specific, data-driven insights based on the analytics above. Each insight must reference actual numbers. Focus on trends, anomalies, and implications for the government and party leadership. Return ONLY a valid JSON object: {"insights": ["insight1", "insight2", "insight3", "insight4", "insight5"]}` }] }]
        });
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          insights = parsed.insights || [];
          if (insights.length > 0) aiProvider = 'gemini';
        }
      } catch (aiErr) {
        console.warn('[ap-ai-insights] Gemini failed:', aiErr.message);
      }
    }

    // Template-based fallback using actual data
    if (insights.length === 0) {
      aiProvider = 'template';
      insights = [];
      if (cur.total > 0) {
        const negPct = ((cur.negative / cur.total) * 100).toFixed(1);
        const posPct = ((cur.positive / cur.total) * 100).toFixed(1);
        insights.push(`${negPct}% of ${cur.total} total mentions carry negative sentiment during this period — ${safePct(cur.negative, prev.negative) > 0 ? 'up' : 'down'} ${Math.abs(safePct(cur.negative, prev.negative))}% from the previous period.`);
        insights.push(`Positive sentiment stands at ${posPct}% (${cur.positive} mentions), ${safePct(cur.positive, prev.positive) > 0 ? 'improving' : 'declining'} vs the previous period.`);
      }
      if (mostNegativeDistrict && mostNegativeDistrict.district) {
        insights.push(`${mostNegativeDistrict.district} district shows the highest negative sentiment volume (${mostNegativeDistrict.negative} negative mentions) — requires priority attention.`);
      }
      if (mostActiveDistrict && mostActiveDistrict.district) {
        insights.push(`${mostActiveDistrict.district} is the most discussed district with ${mostActiveDistrict.total} mentions, indicating high public engagement.`);
      }
      if (topTopics.length > 0) {
        insights.push(`"${topTopics[0]._id}" is the most discussed issue with ${topTopics[0].count} mentions${topTopics[1] ? `, followed by "${topTopics[1]._id}" (${topTopics[1].count} mentions)` : ''}.`);
      }
      if (alertRows > 0) {
        insights.push(`${alertRows} alert${alertRows > 1 ? 's were' : ' was'} generated this period — review the Alerts section for content requiring immediate attention.`);
      }
    }

    const payload = { insights, aiProvider, generatedAt: new Date() };
    await cacheService.set(ck, payload, 120); // 2 min cache for AI calls
    res.json(payload);
  } catch (err) {
    console.error('[ap-ai-insights]', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── 11. Geographic Highlights ────────────────────────────────────────────────

/**
 * GET /api/dashboard/ap-geo-highlights
 * Quick-stat callouts: highest positive/negative district, most active, etc.
 */
const getAPGeoHighlights = async (req, res) => {
  try {
    const from = parseFrom(req.query.from) || new Date(Date.now() - 7 * 86400000);
    const to   = parseTo(req.query.to)   || endOfDay(new Date());
    const ck = cacheKey('ap:geo-highlights:v3', from.toISOString(), to.toISOString(), filterSuffix(req.query));
    const cached = await cacheService.get(ck);
    if (cached) return res.json(cached);

    const extra = buildExtraFilters(req.query);
    const rows = await Grievance.aggregate([
      { $match: {
        ...extra,
        ...dateMatch(from, to),
        'detected_location.district': { $nin: [null, ''] }
      }},
      { $group: {
        _id: { $toLower: { $trim: { input: '$detected_location.district' } } },
        district: { $first: '$detected_location.district' },
        total: { $sum: 1 },
        positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
        negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
        engagement: { $sum: { $add: [
          { $ifNull: ['$engagement.likes', 0] },
          { $ifNull: ['$engagement.retweets', 0] },
          { $ifNull: ['$engagement.replies', 0] }
        ]}}
      }}
    ]);

    const stateRows = rows.filter(r => isKnownStateLocation(r.district || r._id));
    const byNegPct = [...stateRows].filter(r => r.total >= 5).sort((a, b) => (b.negative / b.total) - (a.negative / a.total));
    const byPosPct = [...stateRows].filter(r => r.total >= 5).sort((a, b) => (b.positive / b.total) - (a.positive / a.total));
    const byTotal  = [...stateRows].sort((a, b) => b.total - a.total);
    const byEng    = [...stateRows].sort((a, b) => b.engagement - a.engagement);

    const highlight = (row, pctField) => row ? {
      name: row.district || row._id,
      total: row.total,
      value: row[pctField],
      pct: row.total ? +((row[pctField] / row.total) * 100).toFixed(1) : 0
    } : null;

    const payload = {
      highestNegativeDistrict:  highlight(byNegPct[0], 'negative'),
      highestPositiveDistrict:  highlight(byPosPct[0], 'positive'),
      mostDiscussedDistrict:    byTotal[0] ? { name: byTotal[0].district, total: byTotal[0].total } : null,
      highestEngagementDistrict: byEng[0] ? { name: byEng[0].district, engagement: byEng[0].engagement } : null
    };
    await cacheService.set(ck, payload, 60);
    res.json(payload);
  } catch (err) {
    console.error('[ap-geo-highlights]', err.message);
    res.status(500).json({ message: err.message });
  }
};

// ─── 12. PDF Export ───────────────────────────────────────────────────────────

/**
 * POST /api/dashboard/ap-export-pdf
 * Server-side Puppeteer PDF of the dashboard.
 */
const exportAPDashboardPdf = async (req, res) => {
  try {
    const puppeteer = require('puppeteer');
    const { dashboardUrl, from, to, title = `${STATE_NAME} Political Intelligence Report` } = req.body;

    // Build authenticated dashboard URL
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const targetUrl = dashboardUrl || `${baseUrl}/state-map?from=${from || ''}&to=${to || ''}&export=1&token=${encodeURIComponent(token)}`;

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // Inject token into localStorage before navigation
    await page.evaluateOnNewDocument((t) => {
      localStorage.setItem('token', t);
    }, token);

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for dashboard to load
    await page.waitForTimeout(4000);

    // Add print header / footer metadata
    const pdfBuffer = await page.pdf({
      format: 'A3',
      landscape: true,
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:9px;font-family:Arial;width:100%;text-align:center;color:#666;">
        ${APP_NAME} — ${title}
      </div>`,
      footerTemplate: `<div style="font-size:8px;font-family:Arial;width:100%;text-align:center;color:#999;padding-bottom:5px;">
        Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST &nbsp;|&nbsp; <span class="pageNumber"></span> / <span class="totalPages"></span>
      </div>`
    });

    await browser.close();

    const filename = `${STATE_NAME}_Intelligence_Dashboard_${new Date().toISOString().slice(0, 10)}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length
    });
    res.end(pdfBuffer);
  } catch (err) {
    console.error('[ap-export-pdf]', err.message);
    res.status(500).json({ message: `PDF export failed: ${err.message}` });
  }
};

module.exports = {
  getAPKpis,
  getAPSentimentTrend,
  getAPMentionTrend,
  getAPSourceDistribution,
  getAPDistrictPerformance,
  getAPTopTopics,
  getAPAlertsSummary,
  getAPRecentActivity,
  getAPMapData,
  getAPAiInsights,
  getAPGeoHighlights,
  exportAPDashboardPdf
};
