/**
 * Constituency Unrest Predictor Service
 *
 * Scores each assembly constituency by aggregating grievance signals from the
 * last N days (default 7) against a 4-week rolling baseline.
 *
 * Unrest Score (0-100):
 *   Volume Spike    35% — current-week count vs baseline weekly avg
 *   Severity Load   30% — weighted risk level average (critical=4 … low=1)
 *   Issue Clustering 20% — distinct issue types each with ≥2 grievances
 *   Velocity        15% — acceleration of last 24h vs prior 24h
 *
 * Levels:  0-20 Calm | 21-40 Watch | 41-60 Elevated | 61-80 High Alert | 81-100 Critical
 */

const Grievance = require('../models/Grievance');

const RISK_WEIGHTS = { critical: 4, high: 3, medium: 2, low: 1 };

const CLUSTER_SCORE = [0, 10, 30, 60, 85, 100]; // index = distinct issues count (capped at 5)

function levelFor(score) {
  if (score >= 81) return 'critical';
  if (score >= 61) return 'high_alert';
  if (score >= 41) return 'elevated';
  if (score >= 21) return 'watch';
  return 'calm';
}

function computeScore({ totalCurrent, baselineWeekly, critical, high, medium, low, distinctIssues, last24h, prev24h }) {
  // 1. Volume Spike (35%)
  const spikeRatio = totalCurrent / Math.max(baselineWeekly, 1);
  const volumeScore = Math.min(100, spikeRatio * 33);

  // 2. Severity Load (30%)
  const weightedSum = critical * 4 + high * 3 + medium * 2 + low * 1;
  const maxPossible = totalCurrent * 4;
  const severityScore = totalCurrent > 0 ? (weightedSum / maxPossible) * 100 : 0;

  // 3. Issue Clustering (20%)
  const cappedIssues = Math.min(distinctIssues, CLUSTER_SCORE.length - 1);
  const clusterScore = CLUSTER_SCORE[cappedIssues];

  // 4. Velocity (15%)
  let velocityScore = 0;
  if (prev24h === 0 && last24h > 0) {
    velocityScore = Math.min(100, last24h * 25);
  } else if (prev24h > 0) {
    velocityScore = Math.min(100, Math.max(0, ((last24h / prev24h) - 1) * 100));
  }

  const final = volumeScore * 0.35 + severityScore * 0.30 + clusterScore * 0.20 + velocityScore * 0.15;
  return Math.round(Math.min(100, Math.max(0, final)));
}

async function computeAllScores(windowDays = 7) {
  const now = new Date();
  const windowStart = new Date(now - windowDays * 86_400_000);
  const baselineStart = new Date(now - windowDays * 4 * 86_400_000);
  const ago24 = new Date(now - 86_400_000);
  const ago48 = new Date(now - 172_800_000);

  // ── Current window aggregation ────────────────────────────────────────────
  const [currentData, baselineData] = await Promise.all([
    Grievance.aggregate([
      {
        $match: {
          is_active: true,
          'detected_location.constituency': { $exists: true, $nin: [null, ''] },
          post_date: { $gte: windowStart }
        }
      },
      {
        $group: {
          _id: { $toLower: { $trim: { input: '$detected_location.constituency' } } },
          displayName: { $first: '$detected_location.constituency' },
          district: { $first: '$detected_location.district' },
          total: { $sum: 1 },
          critical: { $sum: { $cond: [{ $eq: ['$analysis.risk_level', 'critical'] }, 1, 0] } },
          high: { $sum: { $cond: [{ $eq: ['$analysis.risk_level', 'high'] }, 1, 0] } },
          medium: { $sum: { $cond: [{ $eq: ['$analysis.risk_level', 'medium'] }, 1, 0] } },
          low: { $sum: { $cond: [{ $eq: ['$analysis.risk_level', 'low'] }, 1, 0] } },
          negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
          last24h: { $sum: { $cond: [{ $gte: ['$post_date', ago24] }, 1, 0] } },
          prev24h: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ['$post_date', ago48] }, { $lt: ['$post_date', ago24] }] },
                1, 0
              ]
            }
          },
          issueTypes: { $push: '$analysis.grievance_type' }
        }
      }
    ]),

    Grievance.aggregate([
      {
        $match: {
          is_active: true,
          'detected_location.constituency': { $exists: true, $nin: [null, ''] },
          post_date: { $gte: baselineStart, $lt: windowStart }
        }
      },
      {
        $group: {
          _id: { $toLower: { $trim: { input: '$detected_location.constituency' } } },
          total: { $sum: 1 }
        }
      }
    ])
  ]);

  // Build baseline lookup
  const baselineMap = {};
  baselineData.forEach(b => { baselineMap[b._id] = b.total; });

  // Compute scores
  const scores = currentData.map(c => {
    const baselineTotal = baselineMap[c._id] || 0;
    const baselineWeekly = baselineTotal / 4; // 4-week baseline → weekly average

    // Count distinct issue types with ≥2 occurrences
    const issueFreq = {};
    (c.issueTypes || []).forEach(t => {
      if (t && t !== 'Normal' && t !== 'normal') {
        const key = t.toLowerCase();
        issueFreq[key] = (issueFreq[key] || 0) + 1;
      }
    });
    const distinctIssues = Object.values(issueFreq).filter(n => n >= 2).length;
    const topIssues = Object.entries(issueFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    const score = computeScore({
      totalCurrent: c.total,
      baselineWeekly,
      critical: c.critical,
      high: c.high,
      medium: c.medium,
      low: c.low,
      distinctIssues,
      last24h: c.last24h,
      prev24h: c.prev24h
    });

    return {
      constituency: c.displayName || c._id,
      constituency_lower: c._id,
      district: c.district || null,
      score,
      level: levelFor(score),
      total_grievances: c.total,
      baseline_weekly: Math.round(baselineWeekly * 10) / 10,
      top_issues: topIssues,
      negative_pct: c.total > 0 ? Math.round((c.negative / c.total) * 100) : 0,
      last_24h: c.last24h,
      prev_24h: c.prev24h,
      risk_breakdown: {
        critical: c.critical, high: c.high, medium: c.medium, low: c.low
      },
      factors: {
        volume: Math.round(Math.min(100, (c.total / Math.max(baselineWeekly, 1)) * 33)),
        severity: c.total > 0
          ? Math.round(((c.critical * 4 + c.high * 3 + c.medium * 2 + c.low) / (c.total * 4)) * 100)
          : 0,
        clustering: CLUSTER_SCORE[Math.min(distinctIssues, CLUSTER_SCORE.length - 1)],
        velocity: (() => {
          if (c.prev24h === 0 && c.last24h > 0) return Math.min(100, c.last24h * 25);
          if (c.prev24h > 0) return Math.min(100, Math.max(0, ((c.last24h / c.prev24h) - 1) * 100));
          return 0;
        })()
      }
    };
  });

  scores.sort((a, b) => b.score - a.score);

  return {
    window_days: windowDays,
    computed_at: now,
    summary: buildSummary(scores),
    constituencies: scores,
    districts: buildDistrictSummary(scores)
  };
}

// Pure functions of a `constituencies` (scores) array — split out so a caller
// (e.g. the RBAC route layer, for scoped mla/mp/senior_leader users) can
// recompute these from a constituency-filtered subset instead of the full
// statewide list, without duplicating this aggregation logic.
function buildSummary(scores) {
  return {
    total_constituencies: scores.length,
    critical: scores.filter(s => s.level === 'critical').length,
    high_alert: scores.filter(s => s.level === 'high_alert').length,
    elevated: scores.filter(s => s.level === 'elevated').length,
    watch: scores.filter(s => s.level === 'watch').length,
    calm: scores.filter(s => s.level === 'calm').length
  };
}

function buildDistrictSummary(scores) {
  const districtMap = {};
  scores.forEach(s => {
    const d = s.district || 'Unknown';
    if (!districtMap[d]) {
      districtMap[d] = { max_score: 0, level: 'calm', constituencies: 0, elevated_count: 0, total_grievances: 0 };
    }
    const dm = districtMap[d];
    dm.constituencies++;
    dm.total_grievances += s.total_grievances;
    if (s.score > dm.max_score) {
      dm.max_score = s.score;
      dm.level = s.level;
    }
    if (s.score >= 41) dm.elevated_count++;
  });
  return districtMap;
}

async function getConstituencyDetail(name, windowDays = 7) {
  const now = new Date();
  const windowStart = new Date(now - windowDays * 86_400_000);
  const ago24 = new Date(now - 86_400_000);
  const ago48 = new Date(now - 172_800_000);
  const baselineStart = new Date(now - windowDays * 4 * 86_400_000);

  const nameLower = name.toLowerCase().trim();

  const [current, baseline, recentGrievances] = await Promise.all([
    Grievance.aggregate([
      {
        $match: {
          is_active: true,
          'detected_location.constituency': { $regex: new RegExp(`^${nameLower}$`, 'i') },
          post_date: { $gte: windowStart }
        }
      },
      {
        $group: {
          _id: null,
          district: { $first: '$detected_location.district' },
          total: { $sum: 1 },
          critical: { $sum: { $cond: [{ $eq: ['$analysis.risk_level', 'critical'] }, 1, 0] } },
          high: { $sum: { $cond: [{ $eq: ['$analysis.risk_level', 'high'] }, 1, 0] } },
          medium: { $sum: { $cond: [{ $eq: ['$analysis.risk_level', 'medium'] }, 1, 0] } },
          low: { $sum: { $cond: [{ $eq: ['$analysis.risk_level', 'low'] }, 1, 0] } },
          negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
          neutral: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'neutral'] }, 1, 0] } },
          positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
          last24h: { $sum: { $cond: [{ $gte: ['$post_date', ago24] }, 1, 0] } },
          prev24h: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ['$post_date', ago48] }, { $lt: ['$post_date', ago24] }] },
                1, 0
              ]
            }
          },
          issueTypes: { $push: '$analysis.grievance_type' }
        }
      }
    ]),

    Grievance.aggregate([
      {
        $match: {
          is_active: true,
          'detected_location.constituency': { $regex: new RegExp(`^${nameLower}$`, 'i') },
          post_date: { $gte: baselineStart, $lt: windowStart }
        }
      },
      { $count: 'total' }
    ]),

    Grievance.find({
      is_active: true,
      'detected_location.constituency': { $regex: new RegExp(`^${nameLower}$`, 'i') },
      post_date: { $gte: windowStart }
    })
      .sort({ post_date: -1 })
      .limit(10)
      .select('id platform content.text analysis.sentiment analysis.risk_level analysis.grievance_type post_date tweet_url')
      .lean()
  ]);

  if (!current.length) return null;

  const c = current[0];
  const baselineTotal = baseline[0]?.total || 0;
  const baselineWeekly = baselineTotal / 4;

  const issueFreq = {};
  (c.issueTypes || []).forEach(t => {
    if (t && t !== 'Normal' && t !== 'normal') {
      const key = t.toLowerCase();
      issueFreq[key] = (issueFreq[key] || 0) + 1;
    }
  });
  const distinctIssues = Object.values(issueFreq).filter(n => n >= 2).length;
  const topIssues = Object.entries(issueFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([type, count]) => ({ type, count }));

  const score = computeScore({
    totalCurrent: c.total, baselineWeekly,
    critical: c.critical, high: c.high, medium: c.medium, low: c.low,
    distinctIssues, last24h: c.last24h, prev24h: c.prev24h
  });

  return {
    constituency: name,
    district: c.district || null,
    score,
    level: levelFor(score),
    window_days: windowDays,
    total_grievances: c.total,
    baseline_weekly: Math.round(baselineWeekly * 10) / 10,
    last_24h: c.last24h,
    prev_24h: c.prev24h,
    negative_pct: c.total > 0 ? Math.round((c.negative / c.total) * 100) : 0,
    sentiment_breakdown: { negative: c.negative, neutral: c.neutral, positive: c.positive },
    risk_breakdown: { critical: c.critical, high: c.high, medium: c.medium, low: c.low },
    top_issues: topIssues,
    factors: {
      volume: Math.round(Math.min(100, (c.total / Math.max(baselineWeekly, 1)) * 33)),
      severity: c.total > 0
        ? Math.round(((c.critical * 4 + c.high * 3 + c.medium * 2 + c.low) / (c.total * 4)) * 100)
        : 0,
      clustering: CLUSTER_SCORE[Math.min(distinctIssues, CLUSTER_SCORE.length - 1)],
      velocity: (() => {
        if (c.prev24h === 0 && c.last24h > 0) return Math.min(100, c.last24h * 25);
        if (c.prev24h > 0) return Math.min(100, Math.max(0, ((c.last24h / c.prev24h) - 1) * 100));
        return 0;
      })()
    },
    recent_grievances: recentGrievances.map(g => ({
      id: g.id,
      platform: g.platform,
      text: g.content?.text?.substring(0, 120),
      sentiment: g.analysis?.sentiment,
      risk_level: g.analysis?.risk_level,
      issue_type: g.analysis?.grievance_type,
      post_date: g.post_date,
      url: g.tweet_url
    }))
  };
}

async function getDailyTrend(name, days = 30) {
  const now = new Date();
  const since = new Date(now - days * 86_400_000);

  const raw = await Grievance.aggregate([
    {
      $match: {
        is_active: true,
        'detected_location.constituency': { $regex: new RegExp(`^${name.trim()}$`, 'i') },
        post_date: { $gte: since }
      }
    },
    {
      $group: {
        _id: {
          y: { $year: '$post_date' },
          m: { $month: '$post_date' },
          d: { $dayOfMonth: '$post_date' }
        },
        count: { $sum: 1 },
        negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } }
      }
    },
    { $sort: { '_id.y': 1, '_id.m': 1, '_id.d': 1 } }
  ]);

  return raw.map(r => ({
    date: `${r._id.y}-${String(r._id.m).padStart(2, '0')}-${String(r._id.d).padStart(2, '0')}`,
    count: r.count,
    negative: r.negative
  }));
}

module.exports = { computeAllScores, getConstituencyDetail, getDailyTrend, buildSummary, buildDistrictSummary };
