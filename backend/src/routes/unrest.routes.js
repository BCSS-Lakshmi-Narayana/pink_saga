const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { loadScope, requireConstituencyAccess, normalizeScopeKey } = require('../middleware/scopeMiddleware');
const { computeAllScores, getConstituencyDetail, getDailyTrend, buildSummary, buildDistrictSummary } = require('../services/unrestPredictorService');

const clampWindow = (val) => {
  const n = parseInt(val, 10);
  if (!n || n < 1) return 7;
  return Math.min(n, 90);
};

// GET /api/unrest/overview?window=7
router.get('/overview', protect, loadScope, async (req, res) => {
  try {
    const window = clampWindow(req.query.window || 7);
    const data = await computeAllScores(window);

    // RBAC row-level scope: scoped mla/mp/senior_leader users only ever see
    // their own constituency(ies) here, not the statewide ranked list.
    if (req.scope && !req.scope.canSeeAll) {
      const allowedKeys = req.scope.constituencyKeys || new Set();
      const scoped = data.constituencies.filter((c) => allowedKeys.has(normalizeScopeKey(c.constituency)));
      return res.json({
        ...data,
        constituencies: scoped,
        summary: buildSummary(scoped),
        districts: buildDistrictSummary(scoped)
      });
    }

    res.json(data);
  } catch (err) {
    console.error('[UnrestRoutes] overview error:', err.message);
    res.status(500).json({ error: 'Failed to compute unrest overview' });
  }
});

// GET /api/unrest/constituency/:name?window=7
router.get(
  '/constituency/:name',
  protect,
  loadScope,
  requireConstituencyAccess((req) => decodeURIComponent(req.params.name || '')),
  async (req, res) => {
    try {
      const name = decodeURIComponent(req.params.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Constituency name required' });
      const window = clampWindow(req.query.window || 7);
      const data = await getConstituencyDetail(name, window);
      if (!data) return res.status(404).json({ error: 'No grievance data found for this constituency in the selected window' });
      res.json(data);
    } catch (err) {
      console.error('[UnrestRoutes] constituency detail error:', err.message);
      res.status(500).json({ error: 'Failed to compute constituency detail' });
    }
  }
);

// GET /api/unrest/trend?constituency=Gajwel&days=30
router.get(
  '/trend',
  protect,
  loadScope,
  requireConstituencyAccess((req) => req.query.constituency),
  async (req, res) => {
    try {
      const name = (req.query.constituency || '').trim();
      if (!name) return res.status(400).json({ error: 'constituency query param required' });
      const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
      const data = await getDailyTrend(name, days);
      res.json({ constituency: name, days, data });
    } catch (err) {
      console.error('[UnrestRoutes] trend error:', err.message);
      res.status(500).json({ error: 'Failed to fetch trend data' });
    }
  }
);

module.exports = router;
