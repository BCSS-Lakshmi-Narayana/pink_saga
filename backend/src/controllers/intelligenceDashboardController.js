const Source = require('../models/Source');
const Content = require('../models/Content');
const Alert = require('../models/Alert');
const Analysis = require('../models/Analysis');
const Report = require('../models/Report');
const Keyword = require('../models/Keyword');
const Grievance = require('../models/Grievance');
const GrievanceWorkflowReport = require('../models/GrievanceWorkflowReport');
const SuggestionReport = require('../models/SuggestionReport');
const CriticismReport = require('../models/CriticismReport');
const POI = require('../models/POI');
const cacheService = require('../services/cacheService');

const sendShortCacheHeaders = (res, browserSeconds = 15) => {
  res.set('Cache-Control', `private, max-age=${browserSeconds}`);
};

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };
const endOfDay = (date) => { const d = new Date(date); d.setHours(23, 59, 59, 999); return d; };
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };
const toISODate = (date) => startOfDay(date).toISOString().slice(0, 10);

const parseDateParam = (value, { end = false } = {}) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return end ? endOfDay(d) : startOfDay(d);
};

const safePct = (cur, prev) => {
  if (!prev) return cur ? 100 : 0;
  return Number((((cur - prev) / prev) * 100).toFixed(1));
};

/* ═══════════════════════════════════════════════════════════════════
   ALERTS INTELLIGENCE
   ═══════════════════════════════════════════════════════════════════ */
const getAlertsIntelligence = async (req, res) => {
  try {
    const cacheKey = `intel:alerts:v1:${req.query.from || ''}:${req.query.to || ''}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      sendShortCacheHeaders(res);
      return res.status(200).json(cached);
    }

    const now = new Date();
    const from = parseDateParam(req.query.from) || addDays(startOfDay(now), -29);
    const to = parseDateParam(req.query.to, { end: true }) || endOfDay(now);

    // ── Total Accounts (Sources) ──
    const [totalSources, activeSources] = await Promise.all([
      Source.countDocuments({}),
      Source.countDocuments({ is_active: true })
    ]);

    // ── Accounts added in date range by category & platform ──
    const sourcesInRange = await Source.aggregate([
      { $match: { created_at: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { platform: '$platform', category: '$category' },
          count: { $sum: 1 }
        }
      }
    ]);

    const sourcesByPlatform = {};
    const sourcesByCategory = {};
    let totalSourcesInRange = 0;
    sourcesInRange.forEach(({ _id, count }) => {
      const p = _id.platform || 'unknown';
      const c = _id.category || 'unknown';
      sourcesByPlatform[p] = (sourcesByPlatform[p] || 0) + count;
      sourcesByCategory[c] = (sourcesByCategory[c] || 0) + count;
      totalSourcesInRange += count;
    });

    // ── Accounts trend (daily) ──
    const accountsTrend = await Source.aggregate([
      { $match: { created_at: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ── Risk Distribution ──
    const riskDistribution = await Alert.aggregate([
      { $match: { created_at: { $gte: from, $lte: to } } },
      { $group: { _id: '$risk_level', count: { $sum: 1 } } }
    ]);

    const riskByPlatform = await Alert.aggregate([
      { $match: { created_at: { $gte: from, $lte: to } } },
      { $group: { _id: { platform: '$platform', risk_level: '$risk_level' }, count: { $sum: 1 } } }
    ]);

    const riskByCategory = await Alert.aggregate([
      { $match: { created_at: { $gte: from, $lte: to } } },
      { $group: { _id: { category: '$source_category', risk_level: '$risk_level' }, count: { $sum: 1 } } }
    ]);

    // ── Alert Types Distribution ──
    const alertTypesDist = await Alert.aggregate([
      { $match: { created_at: { $gte: from, $lte: to } } },
      { $group: { _id: '$alert_type', count: { $sum: 1 } } }
    ]);

    // ── Platform-wise alerts ──
    const alertsByPlatform = await Alert.aggregate([
      { $match: { created_at: { $gte: from, $lte: to } } },
      { $group: { _id: '$platform', count: { $sum: 1 } } }
    ]);

    // ── Escalations (status-based) ──
    const escalationStats = await Report.aggregate([
      { $match: { generated_at: { $gte: from, $lte: to } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const escalationByPlatform = await Report.aggregate([
      { $match: { generated_at: { $gte: from, $lte: to } } },
      { $group: { _id: { platform: '$platform', status: '$status' }, count: { $sum: 1 } } }
    ]);

    // ── Actions (reports generated/sent in date range) ──
    const actionsTrend = await Report.aggregate([
      { $match: { generated_at: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { platform: '$platform' },
          count: { $sum: 1 }
        }
      }
    ]);

    const actionsTimeline = await Report.aggregate([
      { $match: { generated_at: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$generated_at' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ── Top Active Accounts (Removed to prevent timeouts, using Frequent Engagers on frontend instead) ──

    // ── Keywords analytics ──
    const keywordStats = await Keyword.aggregate([
      {
        $group: {
          _id: '$category',
          total: { $sum: 1 },
          active: { $sum: { $cond: ['$is_active', 1, 0] } },
          avgWeight: { $avg: '$weight' }
        }
      }
    ]);

    const keywordsByLanguage = await Keyword.aggregate([
      { $group: { _id: '$language', count: { $sum: 1 } } }
    ]);

    const topMatchedKeywords = await Alert.aggregate([
      { $match: { created_at: { $gte: from, $lte: to } } },
      { $unwind: '$matched_keywords_normalized' },
      { $group: { _id: '$matched_keywords_normalized', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    // ── Format & Share (Reports generated/shared) ──
    const reportStatusDist = await Report.aggregate([
      { $match: { generated_at: { $gte: from, $lte: to } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const reportsByMonth = await Report.aggregate([
      { $match: { generated_at: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$generated_at' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ── Daily alerts trend ──
    const alertsDailyTrend = await Alert.aggregate([
      { $match: { created_at: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
            risk_level: '$risk_level'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    // Build daily trend with risk levels
    const daysMap = {};
    const totalDays = Math.min(Math.ceil((to - from) / DAY_MS) + 1, 366);
    for (let i = 0; i < totalDays; i++) {
      const dk = toISODate(addDays(from, i));
      daysMap[dk] = { date: dk, high: 0, medium: 0, low: 0, total: 0 };
    }
    alertsDailyTrend.forEach(({ _id, count }) => {
      if (daysMap[_id.date]) {
        daysMap[_id.date][_id.risk_level] = (daysMap[_id.date][_id.risk_level] || 0) + count;
        daysMap[_id.date].total += count;
      }
    });

    // ── Alert status summary ──
    const alertStatusSummary = await Alert.aggregate([
      { $match: { created_at: { $gte: from, $lte: to } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Previous period for comparison
    const periodLength = Math.ceil((to - from) / DAY_MS);
    const prevFrom = addDays(from, -periodLength);
    const prevTo = endOfDay(addDays(from, -1));

    const [currentAlerts, prevAlerts, currentReports, prevReports] = await Promise.all([
      Alert.countDocuments({ created_at: { $gte: from, $lte: to } }),
      Alert.countDocuments({ created_at: { $gte: prevFrom, $lte: prevTo } }),
      Report.countDocuments({ generated_at: { $gte: from, $lte: to } }),
      Report.countDocuments({ generated_at: { $gte: prevFrom, $lte: prevTo } })
    ]);

    const alertsIntelPayload = {
      generatedAt: now.toISOString(),
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      accounts: {
        total: totalSources,
        active: activeSources,
        addedInRange: totalSourcesInRange,
        byPlatform: sourcesByPlatform,
        byCategory: sourcesByCategory,
        trend: accountsTrend.map(r => ({ date: r._id, count: r.count }))
      },
      riskAnalysis: {
        distribution: riskDistribution.map(r => ({ level: r._id, count: r.count })),
        byPlatform: riskByPlatform.map(r => ({
          platform: r._id.platform, riskLevel: r._id.risk_level, count: r.count
        })),
        byCategory: riskByCategory.map(r => ({
          category: r._id.category || 'Unknown', riskLevel: r._id.risk_level, count: r.count
        }))
      },
      alertTypes: alertTypesDist.map(r => ({ type: r._id || 'unknown', count: r.count })),
      platformDistribution: alertsByPlatform.map(r => ({ platform: r._id, count: r.count })),
      escalations: {
        statusDistribution: escalationStats.map(r => ({ status: r._id, count: r.count })),
        byPlatform: escalationByPlatform.map(r => ({
          platform: r._id.platform, status: r._id.status, count: r.count
        }))
      },
      actions: {
        byPlatform: actionsTrend.map(r => ({ platform: r._id.platform, count: r.count })),
        timeline: actionsTimeline.map(r => ({ date: r._id, count: r.count })),
        total: currentReports,
        previousTotal: prevReports,
        changePct: safePct(currentReports, prevReports)
      },

      keywords: {
        byCategory: keywordStats.map(r => ({
          category: r._id, total: r.total, active: r.active, avgWeight: Number((r.avgWeight || 0).toFixed(1))
        })),
        byLanguage: keywordsByLanguage.map(r => ({ language: r._id, count: r.count })),
        topMatched: topMatchedKeywords.map(r => ({ keyword: r._id, count: r.count }))
      },
      reportsFormatShare: {
        statusDistribution: reportStatusDist.map(r => ({ status: r._id, count: r.count })),
        byMonth: reportsByMonth.map(r => ({ month: r._id, count: r.count }))
      },
      alertsTrend: Object.values(daysMap),
      alertStatusSummary: alertStatusSummary.map(r => ({ status: r._id, count: r.count })),
      comparison: {
        alerts: { current: currentAlerts, previous: prevAlerts, changePct: safePct(currentAlerts, prevAlerts) },
        reports: { current: currentReports, previous: prevReports, changePct: safePct(currentReports, prevReports) }
      }
    };
    await cacheService.set(cacheKey, alertsIntelPayload, 45);
    sendShortCacheHeaders(res);
    res.status(200).json(alertsIntelPayload);
  } catch (error) {
    console.error('Alerts intelligence error:', error);
    res.status(500).json({ message: error.message });
  }
};

/* ═══════════════════════════════════════════════════════════════════
   GRIEVANCES INTELLIGENCE
   ═══════════════════════════════════════════════════════════════════ */
const getGrievancesIntelligence = async (req, res) => {
  try {
    const cacheKey = `intel:grievances:v1:${req.query.from || ''}:${req.query.to || ''}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      sendShortCacheHeaders(res);
      return res.status(200).json(cached);
    }

    const now = new Date();
    const from = parseDateParam(req.query.from) || addDays(startOfDay(now), -29);
    const to = parseDateParam(req.query.to, { end: true }) || endOfDay(now);
    const dateMatch = { post_date: { $gte: from, $lte: to } };
    const reportDateMatch = { post_date: { $gte: from, $lte: to } };

    // ── Total Grievances ──
    const [totalGrievances, grievancesInRange] = await Promise.all([
      Grievance.countDocuments({ is_active: true }),
      Grievance.countDocuments({ is_active: true, ...dateMatch })
    ]);

    // ── Platform Distribution ──
    const byPlatform = await Grievance.aggregate([
      { $match: { is_active: true, ...dateMatch } },
      { $group: { _id: '$platform', count: { $sum: 1 } } }
    ]);

    // ── Workflow Status Distribution ──
    const workflowStatusDist = await Grievance.aggregate([
      { $match: { is_active: true, ...dateMatch } },
      { $group: { _id: '$workflow_status', count: { $sum: 1 } } }
    ]);

    // ── Classification Distribution ──
    const classificationDist = await Grievance.aggregate([
      { $match: { is_active: true, ...dateMatch } },
      { $group: { _id: '$classification', count: { $sum: 1 } } }
    ]);

    // ── Priority Distribution (complaints) ──
    const priorityDist = await Grievance.aggregate([
      { $match: { is_active: true, classification: 'complaint', ...dateMatch } },
      { $group: { _id: '$complaint.priority', count: { $sum: 1 } } }
    ]);

    // ── Grievance Workflow Reports by Status ──
    const gwrStatusDist = await GrievanceWorkflowReport.aggregate([
      { $match: reportDateMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // ── Grievance Workflow Reports by Category ──
    const gwrCategoryDist = await GrievanceWorkflowReport.aggregate([
      { $match: reportDateMatch },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);

    // ── Suggestion Reports category ──
    const suggCategoryDist = await SuggestionReport.aggregate([
      { $match: reportDateMatch },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);

    // ── Criticism Reports category ──
    const critCategoryDist = await CriticismReport.aggregate([
      { $match: reportDateMatch },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);

    // ── Daily trend ──
    const dailyTrend = await Grievance.aggregate([
      { $match: { is_active: true, ...dateMatch } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$post_date' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ── Platform + workflow status cross-tab ──
    const platformWorkflowCross = await Grievance.aggregate([
      { $match: { is_active: true, ...dateMatch } },
      { $group: { _id: { platform: '$platform', status: '$workflow_status' }, count: { $sum: 1 } } }
    ]);

    // ── Escalation count distribution ──
    const escalationCountDist = await Grievance.aggregate([
      { $match: { is_active: true, escalation_count: { $gt: 0 }, ...dateMatch } },
      { $group: { _id: '$escalation_count', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // ── Tagged account distribution (top) ──
    const taggedAccountDist = await Grievance.aggregate([
      { $match: { is_active: true, ...dateMatch } },
      { $group: { _id: '$tagged_account_normalized', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 }
    ]);

    // ── Engagement metrics aggregation ──
    const engagementAgg = await Grievance.aggregate([
      { $match: { is_active: true, ...dateMatch } },
      {
        $group: {
          _id: null,
          totalLikes: { $sum: '$engagement.likes' },
          totalRetweets: { $sum: '$engagement.retweets' },
          totalReplies: { $sum: '$engagement.replies' },
          totalViews: { $sum: '$engagement.views' },
          avgLikes: { $avg: '$engagement.likes' },
          avgViews: { $avg: '$engagement.views' }
        }
      }
    ]);

    // ── Sentiment distribution (from analysis) ──
    const sentimentDist = await Grievance.aggregate([
      { $match: { is_active: true, 'analysis.sentiment': { $exists: true }, ...dateMatch } },
      { $group: { _id: '$analysis.sentiment', count: { $sum: 1 } } }
    ]);

    // ── Urgency distribution ──
    const urgencyDist = await Grievance.aggregate([
      { $match: { is_active: true, 'analysis.urgency': { $exists: true }, ...dateMatch } },
      { $group: { _id: '$analysis.urgency', count: { $sum: 1 } } }
    ]);

    // ── Reports shared (grievance workflow shared_at exists) ──
    const [gwrTotal, gwrShared, gwrPending, gwrEscalated, gwrClosed] = await Promise.all([
      GrievanceWorkflowReport.countDocuments(reportDateMatch),
      GrievanceWorkflowReport.countDocuments({ ...reportDateMatch, shared_at: { $exists: true, $ne: null } }),
      GrievanceWorkflowReport.countDocuments({ ...reportDateMatch, status: 'PENDING' }),
      GrievanceWorkflowReport.countDocuments({ ...reportDateMatch, status: 'ESCALATED' }),
      GrievanceWorkflowReport.countDocuments({ ...reportDateMatch, status: 'CLOSED' })
    ]);

    const [suggTotal, suggShared, critTotal, critShared] = await Promise.all([
      SuggestionReport.countDocuments(reportDateMatch),
      SuggestionReport.countDocuments({ ...reportDateMatch, shared_at: { $exists: true, $ne: null } }),
      CriticismReport.countDocuments(reportDateMatch),
      CriticismReport.countDocuments({ ...reportDateMatch, shared_at: { $exists: true, $ne: null } })
    ]);

    // Previous period comparison
    const periodLength = Math.ceil((to - from) / DAY_MS);
    const prevFrom = addDays(from, -periodLength);
    const prevTo = endOfDay(addDays(from, -1));
    const [currentCount, prevCount] = await Promise.all([
      Grievance.countDocuments({ is_active: true, ...dateMatch }),
      Grievance.countDocuments({ is_active: true, post_date: { $gte: prevFrom, $lte: prevTo } })
    ]);

    const grievancesIntelPayload = {
      generatedAt: now.toISOString(),
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        total: totalGrievances,
        inRange: grievancesInRange,
        changePct: safePct(currentCount, prevCount)
      },
      byPlatform: byPlatform.map(r => ({ platform: r._id, count: r.count })),
      workflowStatus: workflowStatusDist.map(r => ({ status: r._id, count: r.count })),
      classification: classificationDist.map(r => ({ type: r._id, count: r.count })),
      priority: priorityDist.map(r => ({ level: r._id, count: r.count })),
      grievanceReports: {
        statusDistribution: gwrStatusDist.map(r => ({ status: r._id, count: r.count })),
        categoryDistribution: gwrCategoryDist.map(r => ({ category: r._id || 'Uncategorized', count: r.count })),
        total: gwrTotal,
        shared: gwrShared,
        pending: gwrPending,
        escalated: gwrEscalated,
        closed: gwrClosed
      },
      suggestions: {
        total: suggTotal,
        shared: suggShared,
        categoryDistribution: suggCategoryDist.map(r => ({ category: r._id || 'Uncategorized', count: r.count }))
      },
      criticism: {
        total: critTotal,
        shared: critShared,
        categoryDistribution: critCategoryDist.map(r => ({ category: r._id || 'Uncategorized', count: r.count }))
      },
      dailyTrend: dailyTrend.map(r => ({ date: r._id, count: r.count })),
      platformWorkflowCross: platformWorkflowCross.map(r => ({
        platform: r._id.platform, status: r._id.status, count: r.count
      })),
      escalationDistribution: escalationCountDist.map(r => ({ escalations: r._id, count: r.count })),
      topTaggedAccounts: taggedAccountDist.map(r => ({ account: r._id, count: r.count })),
      engagement: engagementAgg[0] || {},
      sentiment: sentimentDist.map(r => ({ sentiment: r._id, count: r.count })),
      urgency: urgencyDist.map(r => ({ level: r._id, count: r.count })),
      comparison: {
        current: currentCount,
        previous: prevCount,
        changePct: safePct(currentCount, prevCount)
      }
    };
    await cacheService.set(cacheKey, grievancesIntelPayload, 45);
    sendShortCacheHeaders(res);
    res.status(200).json(grievancesIntelPayload);
  } catch (error) {
    console.error('Grievances intelligence error:', error);
    res.status(500).json({ message: error.message });
  }
};

const getGrievanceReportsFeed = async (req, res) => {
  try {
    const now = new Date();
    const from = parseDateParam(req.query.from) || addDays(startOfDay(now), -29);
    const to = parseDateParam(req.query.to, { end: true }) || endOfDay(now);
    const dateQuery = { post_date: { $gte: from, $lte: to } };

    const [grievanceReports, suggestionReports, criticismReports] = await Promise.all([
      GrievanceWorkflowReport.find(dateQuery).sort({ post_date: -1, created_at: -1 }).limit(1000).lean(),
      SuggestionReport.find(dateQuery).sort({ post_date: -1, created_at: -1 }).limit(1000).lean(),
      CriticismReport.find(dateQuery).sort({ post_date: -1, created_at: -1 }).limit(1000).lean()
    ]);

    const grievanceIds = [...new Set(
      [...grievanceReports, ...suggestionReports, ...criticismReports]
        .map((report) => String(report.grievance_id || '').trim())
        .filter(Boolean)
    )];

    const grievances = grievanceIds.length
      ? await Grievance.find(
          { id: { $in: grievanceIds } },
          {
            id: 1,
            platform: 1,
            post_date: 1,
            analysis: 1,
            posted_by: 1,
            content: 1
          }
        ).lean()
      : [];

    const grievanceMap = new Map(grievances.map((grievance) => [String(grievance.id), grievance]));

    const enrich = (report, type) => {
      const source = grievanceMap.get(String(report.grievance_id || ''));
      return {
        ...report,
        _type: type,
        sentiment: source?.analysis?.sentiment || null,
        risk_level: source?.analysis?.risk_level || null,
        grievance_platform: source?.platform || null,
        grievance_post_date: source?.post_date || null,
        grievance_text: source?.content?.full_text || source?.content?.text || null
      };
    };

    const reports = [
      ...grievanceReports.map((report) => enrich(report, 'grievance')),
      ...suggestionReports.map((report) => enrich(report, 'suggestion')),
      ...criticismReports.map((report) => enrich(report, 'criticism'))
    ].sort((a, b) => {
      const left = new Date(b.post_date || b.created_at || 0).getTime();
      const right = new Date(a.post_date || a.created_at || 0).getTime();
      return left - right;
    });

    res.status(200).json({
      generatedAt: now.toISOString(),
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      reports
    });
  } catch (error) {
    console.error('Grievance reports feed error:', error);
    res.status(500).json({ message: error.message });
  }
};

/* ═══════════════════════════════════════════════════════════════════
   PROFILES (POI) INTELLIGENCE
   ═══════════════════════════════════════════════════════════════════ */
const getProfilesIntelligence = async (req, res) => {
  try {
    const now = new Date();
    const from = parseDateParam(req.query.from) || addDays(startOfDay(now), -29);
    const to = parseDateParam(req.query.to, { end: true }) || endOfDay(now);

    // ── Total Profiles ──
    const [totalProfiles, activeProfiles, archivedProfiles] = await Promise.all([
      POI.countDocuments({}),
      POI.countDocuments({ status: 'active' }),
      POI.countDocuments({ status: 'archived' })
    ]);

    // ── Profiles added in date range ──
    const profilesInRange = await POI.countDocuments({
      createdAt: { $gte: from, $lte: to }
    });

    // ── Profiles trend ──
    const profilesTrend = await POI.aggregate([
      { $match: { createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ── Platform distribution (count social media entries) ──
    const platformDist = await POI.aggregate([
      { $match: { status: 'active' } },
      { $unwind: '$socialMedia' },
      { $group: { _id: '$socialMedia.platform', count: { $sum: 1 } } }
    ]);

    // ── District/Commisionerate distribution ──
    const districtDist = await POI.aggregate([
      { $match: { status: 'active', districtCommisionerate: { $ne: '' } } },
      { $group: { _id: '$districtCommisionerate', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 }
    ]);

    // ── Profiles with FIR details ──
    const profilesWithFIR = await POI.countDocuments({
      status: 'active',
      'firDetails.0': { $exists: true }
    });

    // ── Profiles with reports (s3ReportUrl) ──
    const profilesWithReports = await POI.countDocuments({
      status: 'active',
      s3ReportUrl: { $ne: '' }
    });

    // ── Social media coverage (profiles with linked platforms) ──
    const socialCoverageAgg = await POI.aggregate([
      { $match: { status: 'active' } },
      {
        $project: {
          linkedPlatforms: { $size: { $ifNull: ['$socialMedia', []] } }
        }
      },
      {
        $group: {
          _id: '$linkedPlatforms',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ── Profiles with deleted profiles tracked ──
    const profilesWithDeleted = await POI.aggregate([
      { $match: { status: 'active' } },
      {
        $project: {
          hasDeleted: {
            $gt: [
              {
                $add: [
                  { $size: { $ifNull: ['$previouslyDeletedProfiles.x', []] } },
                  { $size: { $ifNull: ['$previouslyDeletedProfiles.facebook', []] } },
                  { $size: { $ifNull: ['$previouslyDeletedProfiles.instagram', []] } },
                  { $size: { $ifNull: ['$previouslyDeletedProfiles.youtube', []] } },
                  { $size: { $ifNull: ['$previouslyDeletedProfiles.whatsapp', []] } }
                ]
              },
              0
            ]
          }
        }
      },
      { $match: { hasDeleted: true } },
      { $count: 'count' }
    ]);

    // ── Profiles by creator ──
    const profilesByCreator = await POI.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$createdBy', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // ── Monthly creation trend ──
    const monthlyTrend = await POI.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      { $limit: 12 }
    ]);

    // ── Cross-reference: POI linked alerts ──
    // Get all social media handles from POIs and count alerts against them
    const poiHandles = await POI.aggregate([
      { $match: { status: 'active' } },
      { $unwind: '$socialMedia' },
      {
        $project: {
          handle: '$socialMedia.handle',
          platform: '$socialMedia.platform',
          poiName: '$name'
        }
      }
    ]);

    // ── Previous period comparison ──
    const periodLength = Math.ceil((to - from) / DAY_MS);
    const prevFrom = addDays(from, -periodLength);
    const prevTo = endOfDay(addDays(from, -1));
    const prevProfilesInRange = await POI.countDocuments({
      createdAt: { $gte: prevFrom, $lte: prevTo }
    });

    res.status(200).json({
      generatedAt: now.toISOString(),
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        total: totalProfiles,
        active: activeProfiles,
        archived: archivedProfiles,
        addedInRange: profilesInRange,
        withFIR: profilesWithFIR,
        withReports: profilesWithReports,
        withDeletedProfiles: profilesWithDeleted[0]?.count || 0
      },
      trend: profilesTrend.map(r => ({ date: r._id, count: r.count })),
      monthlyTrend: monthlyTrend.map(r => ({ month: r._id, count: r.count })),
      platformDistribution: platformDist.map(r => ({ platform: r._id, count: r.count })),
      districtDistribution: districtDist.map(r => ({ district: r._id, count: r.count })),
      socialCoverage: socialCoverageAgg.map(r => ({ linkedPlatforms: r._id, count: r.count })),
      profilesByCreator: profilesByCreator.map(r => ({ creator: r._id || 'system', count: r.count })),
      comparison: {
        current: profilesInRange,
        previous: prevProfilesInRange,
        changePct: safePct(profilesInRange, prevProfilesInRange)
      }
    });
  } catch (error) {
    console.error('Profiles intelligence error:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAlertsIntelligence,
  getGrievancesIntelligence,
  getGrievanceReportsFeed,
  getProfilesIntelligence
};
