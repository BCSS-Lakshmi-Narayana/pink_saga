/**
 * voterProfileController
 * ─────────────────────────────────────────────────────────────────────
 * Serves the verified public voter/election profile per AC (see
 * voterProfileService for sourcing and coverage caveats).
 */

const {
  getAllVoterProfiles,
  getVoterProfileByConstituency,
  normalizeConstituencyKey,
  DATA_COVERAGE,
} = require('../services/voterProfileService');
const { getBoothsByConstituency, getBoothVoters, getBoothSummary } = require('../services/boothVoterService');
const Grievance = require('../models/Grievance');

const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isInScope = (constituency, scope) => {
  if (!scope || scope.canSeeAll) return true;
  return (scope.constituencyKeys || new Set()).has(normalizeConstituencyKey(constituency));
};

/* GET /api/voter-profiles — list all seats (RBAC-scoped), summary fields only. */
const listVoterProfiles = (req, res) => {
  try {
    const { party, district } = req.query;
    let rows = getAllVoterProfiles();

    if (!req.scope || !req.scope.canSeeAll) {
      const allowed = (req.scope && req.scope.constituencyKeys) || new Set();
      rows = rows.filter((p) => allowed.has(p.key));
    }
    // Vacant seats carry `mla: null`.
    if (party) rows = rows.filter((p) => p.mla && String(p.mla.party).toUpperCase() === String(party).toUpperCase());
    if (district) rows = rows.filter((p) => String(p.district).toUpperCase() === String(district).toUpperCase());

    const summary = rows.map((p) => ({
      ac_number: p.ac_number,
      constituency: p.constituency,
      key: p.key,
      district: p.district,
      reserved_category: p.reserved_category,
      lok_sabha: p.lok_sabha,
      // Vacant seats carry an `mla` object with null fields plus `vacancy`.
      mla_name: p.mla?.name ?? null,
      party: p.mla?.party ?? null,
      alliance: p.mla?.alliance ?? null,
      vacant: !!p.vacancy || !p.mla?.name,
      election_year: p.election_year,
      vote_share_latest: p.election_latest?.winner ? p.election_latest.winner.vote_pct : null,
      margin_latest: p.election_latest ? p.election_latest.margin : null,
    }));

    return res.json({ success: true, count: summary.length, data: summary, coverage: DATA_COVERAGE });
  } catch (err) {
    console.error('[voterProfile] list error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list voter profiles' });
  }
};

/* GET /api/voter-profiles/:constituency — full profile for one seat. */
const getVoterProfile = (req, res) => {
  try {
    const { constituency } = req.params;
    const decoded = decodeURIComponent(constituency || '');

    if (!isInScope(decoded, req.scope)) {
      return res.status(403).json({
        success: false,
        code: 'CONSTITUENCY_FORBIDDEN',
        message: 'You are not authorized to view this constituency',
      });
    }

    const profile = getVoterProfileByConstituency(decoded);
    if (!profile) {
      return res.status(404).json({ success: false, message: `No voter profile found for "${decoded}"` });
    }

    return res.json({ success: true, data: profile, coverage: DATA_COVERAGE });
  } catch (err) {
    console.error('[voterProfile] detail error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load voter profile' });
  }
};

/* GET /api/voter-profiles/:constituency/booths — booth (polling-station)
 * level voter demographics for one seat, where sourced. 404 if we don't
 * have booth-level data collected for this constituency yet. */
const getBoothLevelData = async (req, res) => {
  try {
    const { constituency } = req.params;
    const decoded = decodeURIComponent(constituency || '');

    if (!isInScope(decoded, req.scope)) {
      return res.status(403).json({
        success: false,
        code: 'CONSTITUENCY_FORBIDDEN',
        message: 'You are not authorized to view this constituency',
      });
    }

    const result = await getBoothsByConstituency(decoded);
    if (!result) {
      return res.status(404).json({
        success: false,
        message: `No booth-level data collected for "${decoded}" yet`,
      });
    }

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[voterProfile] booth-level error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load booth-level data' });
  }
};

/* GET /api/voter-profiles/:constituency/booths/:part/voters — the full
 * voter roll for one booth, paginated + searchable + gender-filterable.
 * Query: page, pageSize, search, gender (all|male|female|third|other). */
const getBoothVotersHandler = async (req, res) => {
  try {
    const { constituency, part } = req.params;
    const decoded = decodeURIComponent(constituency || '');

    if (!isInScope(decoded, req.scope)) {
      return res.status(403).json({
        success: false,
        code: 'CONSTITUENCY_FORBIDDEN',
        message: 'You are not authorized to view this constituency',
      });
    }

    const result = await getBoothVoters(decoded, part, {
      page: req.query.page,
      pageSize: req.query.pageSize,
      search: req.query.search,
      gender: req.query.gender,
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: `No voter roll on record for "${decoded}" booth ${part}`,
      });
    }

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[voterProfile] booth-voters error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load booth voter list' });
  }
};

/* Sentiment + trending topics for one grievance $match scope. */
const aggregateSentiment = async (match) => {
  const [sentAgg, topicAgg] = await Promise.all([
    Grievance.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
          negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
          // 'neutral' is canonical; older rows may carry the retired 'moderate'.
          neutral: { $sum: { $cond: [{ $in: ['$analysis.sentiment', ['neutral', 'moderate']] }, 1, 0] } },
        },
      },
    ]),
    Grievance.aggregate([
      { $match: match },
      { $group: { _id: { $ifNull: ['$analysis.grievance_type', '$analysis.category'] }, count: { $sum: 1 } } },
      { $match: { _id: { $nin: [null, '', 'Normal'] } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]),
  ]);
  const s = sentAgg[0] || { total: 0, positive: 0, negative: 0, neutral: 0 };
  return { ...s, topics: topicAgg.map((t) => ({ name: t._id, count: t.count })) };
};

/* GET /api/voter-profiles/:constituency/booths/:part/sentiment — public
 * sentiment (positive / neutral / negative) + trending topics for the AREA
 * a booth sits in. Grievances are mapped to a booth via their detected city
 * matching the booth's locality; when nothing maps to the locality we fall
 * back to the constituency-wide signal (flagged via `scope`). No grievance is
 * counted twice within a response. */
const getBoothSentiment = async (req, res) => {
  try {
    const { constituency, part } = req.params;
    const decoded = decodeURIComponent(constituency || '');

    if (!isInScope(decoded, req.scope)) {
      return res.status(403).json({ success: false, code: 'CONSTITUENCY_FORBIDDEN', message: 'You are not authorized to view this constituency' });
    }

    const summary = await getBoothSummary(decoded, part);
    if (!summary) {
      return res.status(404).json({ success: false, message: `No booth ${part} on record for "${decoded}"` });
    }

    const days = Number(req.query.days);
    const base = { is_active: true, 'detected_location.constituency': new RegExp(`^${escapeRegex(decoded)}$`, 'i') };
    if (days > 0) base.post_date = { $gte: new Date(Date.now() - days * 86400000) };

    // Locality name tokens (drop bracketed qualifiers like "(U)" and short words).
    const tokens = String(summary.locality || '')
      .replace(/\([^)]*\)/g, ' ')
      .split(/[^A-Za-z0-9]+/)
      .filter((t) => t.length >= 4);

    let agg = null;
    let scope = 'none';
    let location = decoded;

    if (tokens.length) {
      const rx = new RegExp(`(^|[^a-z0-9])(${tokens.map(escapeRegex).join('|')})([^a-z0-9]|$)`, 'i');
      const localityAgg = await aggregateSentiment({ ...base, 'detected_location.city': { $regex: rx } });
      if (localityAgg.total > 0) {
        agg = localityAgg;
        scope = 'locality';
        location = summary.locality;
      }
    }

    if (!agg) {
      const constAgg = await aggregateSentiment(base);
      if (constAgg.total > 0) {
        agg = constAgg;
        scope = 'constituency';
        location = decoded;
      } else {
        agg = { total: 0, positive: 0, negative: 0, neutral: 0, topics: [] };
      }
    }

    const pctOf = (n) => (agg.total ? Math.round((n / agg.total) * 100) : 0);
    return res.json({
      success: true,
      part: summary.part,
      locality: summary.locality,
      constituency: decoded,
      scope,
      location,
      window_days: days > 0 ? days : null,
      total: agg.total,
      positive: agg.positive,
      negative: agg.negative,
      neutral: agg.neutral,
      positive_pct: pctOf(agg.positive),
      negative_pct: pctOf(agg.negative),
      neutral_pct: pctOf(agg.neutral),
      // retired keys, kept for older clients
      moderate: agg.neutral,
      moderate_pct: pctOf(agg.neutral),
      topics: agg.topics,
    });
  } catch (err) {
    console.error('[voterProfile] booth-sentiment error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load booth sentiment' });
  }
};

module.exports = { listVoterProfiles, getVoterProfile, getBoothLevelData, getBoothVoters: getBoothVotersHandler, getBoothSentiment };
