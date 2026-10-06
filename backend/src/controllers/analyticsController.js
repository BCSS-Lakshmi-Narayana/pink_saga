const Source = require('../models/Source');
const Content = require('../models/Content');
const Alert = require('../models/Alert');
const Analysis = require('../models/Analysis');
const Report = require('../models/Report');
const GrievanceWorkflowReport = require('../models/GrievanceWorkflowReport');
const SuggestionReport = require('../models/SuggestionReport');
const CriticismReport = require('../models/CriticismReport');
const QueryReport = require('../models/QueryReport');
const cacheService = require('../services/cacheService');
const { sourceScopeFilter, mergeFilter } = require('../middleware/scopeMiddleware');

const sendShortCacheHeaders = (res, browserSeconds = 15) => {
  res.set('Cache-Control', `private, max-age=${browserSeconds}`);
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_STATUSES = ['generated', 'printed', 'sent', 'sent_to_intermediary', 'awaiting_reply', 'closed'];
const DOMAIN_KEYS = ['alerts', 'grievance', 'suggestion', 'criticism', 'query'];

const domainConfigs = {
  alerts: { model: Report, dateField: 'generated_at' },
  grievance: { model: GrievanceWorkflowReport, dateField: 'created_at' },
  suggestion: { model: SuggestionReport, dateField: 'created_at' },
  criticism: { model: CriticismReport, dateField: 'created_at' },
  query: { model: QueryReport, dateField: 'created_at' }
};

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const toISODate = (date) => startOfDay(date).toISOString().slice(0, 10);

const parseDateParam = (value, { end = false } = {}) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return end ? endOfDay(d) : startOfDay(d);
};

const buildDateQuery = (dateField, start, end) => {
  const query = {};
  if (!start && !end) return query;

  query[dateField] = {};
  if (start) query[dateField].$gte = start;
  if (end) query[dateField].$lte = end;
  return query;
};

const safePctChange = (current, previous) => {
  if (!previous) return current ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
};

const countByRange = (model, dateField, start, end) =>
  model.countDocuments(buildDateQuery(dateField, start, end));

const getDailySeries = async (model, dateField, start, end) => {
  const rows = await model.aggregate([
    { $match: buildDateQuery(dateField, start, end) },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: `$${dateField}`
          }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
};

const getAlertsStatus = async () => {
  const grouped = await Report.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const status = Object.fromEntries(ALERT_STATUSES.map((key) => [key, 0]));
  grouped.forEach(({ _id, count }) => {
    if (_id && Object.prototype.hasOwnProperty.call(status, _id)) {
      status[_id] = count;
    }
  });
  return status;
};

const getGrievanceStatus = async () => {
  const [pending, escalated, closed, fir] = await Promise.all([
    GrievanceWorkflowReport.countDocuments({ status: 'PENDING' }),
    GrievanceWorkflowReport.countDocuments({ status: 'ESCALATED' }),
    GrievanceWorkflowReport.countDocuments({ status: 'CLOSED' }),
    GrievanceWorkflowReport.countDocuments({ fir_status: { $nin: ['', 'No', null] } })
  ]);

  return { pending, escalated, closed, fir };
};

const getQueryStatus = async () => {
  const [pending, closed] = await Promise.all([
    QueryReport.countDocuments({ status: 'PENDING' }),
    QueryReport.countDocuments({ status: 'CLOSED' })
  ]);

  return { pending, closed };
};

const getActionedStatus = async (model) => {
  const [total, actionTaken] = await Promise.all([
    model.countDocuments({}),
    model.countDocuments({ action_taken_at: { $exists: true, $ne: null } })
  ]);

  return {
    action_taken: actionTaken,
    pending_action: Math.max(total - actionTaken, 0)
  };
};

const getAlertPlatformBreakdown = async () => {
  const grouped = await Report.aggregate([
    { $group: { _id: '$platform', count: { $sum: 1 } } }
  ]);
  return Object.fromEntries(grouped.map(({ _id, count }) => [_id || 'unknown', count]));
};

const getGrievanceCategoryBreakdown = async () => {
  const grouped = await GrievanceWorkflowReport.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 } } }
  ]);
  return Object.fromEntries(grouped.map(({ _id, count }) => [_id || 'Uncategorized', count]));
};

const getWeeklyHourlyActivity = async () => {
  const now = new Date();
  const weekAgo = addDays(startOfDay(now), -6);
  const rows = await Report.aggregate([
    { $match: { generated_at: { $gte: weekAgo } } },
    {
      $group: {
        _id: { $dayOfWeek: '$generated_at' },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return dayNames.map((name, idx) => ({
    day: name,
    count: rows.find((r) => r._id === idx + 1)?.count || 0
  }));
};

// @desc    Get analytics overview
// @route   GET /api/analytics/overview
// @access  Private
const getAnalyticsOverview = async (req, res) => {
  try {
    // Scope-aware cache key: never let a scoped MLA/MP read a super-admin's
    // cached aggregate (or vice-versa).
    const scope = req.scope;
    const scopeKey = !scope || scope.canSeeAll
      ? 'all'
      : [...(scope.constituencyKeys || [])].sort().join(',') || 'none';
    const cacheKey = `analytics:overview:v1:${scopeKey}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      sendShortCacheHeaders(res);
      return res.status(200).json(cached);
    }

    // Source counts honour the owned-vs-party-wide rule; alerts are matched by
    // seat name in title/description/keywords (mirrors the alerts report).
    const srcFilter = sourceScopeFilter(scope);
    let alertScope = {};
    if (scope && !scope.canSeeAll) {
      const seats = scope.constituencies || [];
      if (seats.length === 0) {
        const empty = {
          total_sources: 0, active_sources: 0, total_content: 0,
          active_alerts: 0, total_alerts: 0, risk_distribution: []
        };
        await cacheService.set(cacheKey, empty, 30);
        sendShortCacheHeaders(res);
        return res.status(200).json(empty);
      }
      const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const seatRegex = new RegExp(seats.map(escape).join('|'), 'i');
      alertScope = {
        $or: [
          { title: seatRegex },
          { description: seatRegex },
          { matched_keywords_normalized: seatRegex },
        ],
      };
    }

    const [
      totalSources,
      activeSources,
      totalContent,
      activeAlerts,
      totalAlerts,
      riskDist
    ] = await Promise.all([
      Source.countDocuments({ ...srcFilter }),
      Source.countDocuments({ ...srcFilter, is_active: true }),
      Content.countDocuments({}),
      Alert.countDocuments({ ...alertScope, status: 'active' }),
      Alert.countDocuments({ ...alertScope }),
      Analysis.aggregate([
        {
          $group: {
            _id: '$risk_level',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const payload = {
      total_sources: totalSources,
      active_sources: activeSources,
      total_content: totalContent,
      active_alerts: activeAlerts,
      total_alerts: totalAlerts,
      risk_distribution: riskDist
    };
    await cacheService.set(cacheKey, payload, 30);
    sendShortCacheHeaders(res);
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get trends
// @route   GET /api/analytics/trends
// @access  Private
const getTrends = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Content has no constituency-bearing field anywhere in the schema/codebase
    // (mirrors the unscoped `Content.countDocuments({})` in getAnalyticsOverview
    // above), so content_trend intentionally stays unscoped here.
    const contentTrend = await Content.aggregate([
      { $match: { created_at: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // RBAC row-level scope: same seat-name regex over title/description/
    // matched_keywords_normalized used by getAnalyticsOverview above and by
    // alertController.getAlerts. Zero assigned seats -> match nothing.
    const scope = req.scope;
    let alertMatch = { created_at: { $gte: startDate } };
    if (scope && !scope.canSeeAll) {
      const seats = scope.constituencies || [];
      if (seats.length === 0) {
        alertMatch = mergeFilter(alertMatch, { _id: { $exists: false } });
      } else {
        const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const seatRegex = new RegExp(seats.map(escape).join('|'), 'i');
        alertMatch = mergeFilter(alertMatch, {
          $or: [
            { title: seatRegex },
            { description: seatRegex },
            { matched_keywords_normalized: seatRegex },
          ],
        });
      }
    }

    const alertTrend = await Alert.aggregate([
      { $match: alertMatch },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
            risk_level: "$risk_level"
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.date": 1 } }
    ]);

    res.status(200).json({
      content_trend: contentTrend,
      alert_trend: alertTrend
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Unified reports analytics (weekly, monthly, overall)
// @route   GET /api/analytics/unified-reports
// @access  Private
//
// NOTE on RBAC scope: this function aggregates across Report,
// GrievanceWorkflowReport, SuggestionReport, CriticismReport and QueryReport
// (see domainConfigs / getAlertsStatus / getGrievanceStatus / etc. below).
// None of those five schemas carry a constituency/detected_location field,
// and no controller in the codebase scopes them by constituency today (the
// established constituencyFilter pattern only applies to collections that
// carry `detected_location.constituency`, e.g. Grievance, and the seat-name
// regex pattern only applies to Alert's title/description). Scoping these
// would require inventing a new join (e.g. GrievanceWorkflowReport ->
// Grievance via grievance_id) that doesn't exist elsewhere, so this is
// intentionally left unscoped rather than guessed. Flagged for follow-up.
const getUnifiedReportsAnalytics = async (req, res) => {
  try {
    const fromKey = (req.query.from || '').toString();
    const toKey = (req.query.to || '').toString();
    const cacheKey = `analytics:unified-reports:v1:${fromKey}:${toKey}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      sendShortCacheHeaders(res);
      return res.status(200).json(cached);
    }

    const now = new Date();
    const todayStart = startOfDay(now);
    const nowEnd = endOfDay(now);

    const customStart = parseDateParam(req.query.from, { end: false });
    const customEnd = parseDateParam(req.query.to, { end: true });
    const hasCustomRange = Boolean(customStart && customEnd && customStart <= customEnd);

    const weeklyStart = addDays(todayStart, -6);
    const previousWeeklyStart = addDays(weeklyStart, -7);
    const previousWeeklyEnd = endOfDay(addDays(weeklyStart, -1));

    const monthlyStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const currentMonthDayIndex = Math.floor((todayStart.getTime() - monthlyStart.getTime()) / DAY_MS);
    const previousMonthStart = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const previousMonthDays = new Date(
      previousMonthStart.getFullYear(),
      previousMonthStart.getMonth() + 1,
      0
    ).getDate();
    const previousMonthlyEnd = endOfDay(
      new Date(
        previousMonthStart.getFullYear(),
        previousMonthStart.getMonth(),
        Math.min(currentMonthDayIndex + 1, previousMonthDays)
      )
    );

    const trendStart = hasCustomRange ? customStart : addDays(todayStart, -29);
    const trendEnd = hasCustomRange ? customEnd : nowEnd;

    const customRangeDays = hasCustomRange
      ? Math.floor((startOfDay(customEnd).getTime() - startOfDay(customStart).getTime()) / DAY_MS) + 1
      : 0;

    const previousCustomEnd = hasCustomRange ? endOfDay(addDays(customStart, -1)) : null;
    const previousCustomStart = hasCustomRange ? startOfDay(addDays(customStart, -customRangeDays)) : null;

    const windows = {
      weekly: { start: weeklyStart, end: nowEnd },
      monthly: { start: monthlyStart, end: nowEnd },
      overall: { start: null, end: nowEnd },
      custom: hasCustomRange ? { start: customStart, end: customEnd } : null
    };

    const totals = {
      weekly: {},
      monthly: {},
      overall: {},
      custom: {}
    };

    const dailyMaps = {};
    const delta = {};

    await Promise.all(
      DOMAIN_KEYS.map(async (domainKey) => {
        const { model, dateField } = domainConfigs[domainKey];

        const [
          weeklyCount,
          monthlyCount,
          overallCount,
          customCount,
          previousWeeklyCount,
          previousMonthlyCount,
          previousCustomCount,
          dailySeries
        ] = await Promise.all([
          countByRange(model, dateField, windows.weekly.start, windows.weekly.end),
          countByRange(model, dateField, windows.monthly.start, windows.monthly.end),
          countByRange(model, dateField, windows.overall.start, windows.overall.end),
          hasCustomRange ? countByRange(model, dateField, windows.custom.start, windows.custom.end) : Promise.resolve(0),
          countByRange(model, dateField, previousWeeklyStart, previousWeeklyEnd),
          countByRange(model, dateField, previousMonthStart, previousMonthlyEnd),
          hasCustomRange ? countByRange(model, dateField, previousCustomStart, previousCustomEnd) : Promise.resolve(0),
          getDailySeries(model, dateField, trendStart, trendEnd)
        ]);

        totals.weekly[domainKey] = weeklyCount;
        totals.monthly[domainKey] = monthlyCount;
        totals.overall[domainKey] = overallCount;
        totals.custom[domainKey] = customCount;

        dailyMaps[domainKey] = dailySeries;
        delta[domainKey] = {
          weeklyPct: safePctChange(weeklyCount, previousWeeklyCount),
          monthlyPct: safePctChange(monthlyCount, previousMonthlyCount),
          customPct: hasCustomRange ? safePctChange(customCount, previousCustomCount) : 0
        };
      })
    );

    totals.weekly.all = DOMAIN_KEYS.reduce((sum, key) => sum + (totals.weekly[key] || 0), 0);
    totals.monthly.all = DOMAIN_KEYS.reduce((sum, key) => sum + (totals.monthly[key] || 0), 0);
    totals.overall.all = DOMAIN_KEYS.reduce((sum, key) => sum + (totals.overall[key] || 0), 0);
    totals.custom.all = DOMAIN_KEYS.reduce((sum, key) => sum + (totals.custom[key] || 0), 0);

    const trendDaily = [];
    const totalTrendDays = Math.min(
      Math.max(Math.floor((startOfDay(trendEnd).getTime() - startOfDay(trendStart).getTime()) / DAY_MS) + 1, 1),
      366
    );
    for (let i = 0; i < totalTrendDays; i += 1) {
      const date = addDays(trendStart, i);
      const dateKey = toISODate(date);

      const row = {
        date: dateKey,
        alerts: dailyMaps.alerts?.[dateKey] || 0,
        grievance: dailyMaps.grievance?.[dateKey] || 0,
        suggestion: dailyMaps.suggestion?.[dateKey] || 0,
        criticism: dailyMaps.criticism?.[dateKey] || 0,
        query: dailyMaps.query?.[dateKey] || 0
      };
      row.all = row.alerts + row.grievance + row.suggestion + row.criticism + row.query;
      trendDaily.push(row);
    }

    const [
      alertsStatus,
      grievanceStatus,
      suggestionStatus,
      criticismStatus,
      queryStatus,
      alertPlatformBreakdown,
      grievanceCategoryBreakdown,
      weeklyActivity
    ] = await Promise.all([
      getAlertsStatus(),
      getGrievanceStatus(),
      getActionedStatus(SuggestionReport),
      getActionedStatus(CriticismReport),
      getQueryStatus(),
      getAlertPlatformBreakdown(),
      getGrievanceCategoryBreakdown(),
      getWeeklyHourlyActivity()
    ]);

    const responsePayload = {
      generatedAt: now.toISOString(),
      windows: {
        weekly: {
          start: windows.weekly.start.toISOString(),
          end: windows.weekly.end.toISOString()
        },
        monthly: {
          start: windows.monthly.start.toISOString(),
          end: windows.monthly.end.toISOString()
        },
        overall: {
          start: null,
          end: windows.overall.end.toISOString()
        },
        custom: windows.custom
          ? {
            start: windows.custom.start.toISOString(),
            end: windows.custom.end.toISOString()
          }
          : null
      },
      totals,
      trend: {
        daily: trendDaily,
        delta
      },
      status: {
        alerts: alertsStatus,
        grievance: grievanceStatus,
        suggestion: suggestionStatus,
        criticism: criticismStatus,
        query: queryStatus
      },
      breakdowns: {
        alertPlatform: alertPlatformBreakdown,
        grievanceCategory: grievanceCategoryBreakdown,
        weeklyActivity
      }
    };
    await cacheService.set(cacheKey, responsePayload, 45);
    sendShortCacheHeaders(res);
    res.status(200).json(responsePayload);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAnalyticsOverview,
  getTrends,
  getUnifiedReportsAnalytics
};
