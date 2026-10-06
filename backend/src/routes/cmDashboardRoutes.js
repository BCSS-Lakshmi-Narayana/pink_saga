/**
 * cmDashboardRoutes — the Chief Minister's brief.
 * ─────────────────────────────────────────────────────────────────────────
 * Mounted at /api/cm-dashboard.
 *
 * This feature previously hung off apDashboardRoutes, which owns the AP
 * dashboard widgets and has nothing to do with the CM brief. Sharing a router
 * meant the two features shared middleware, mount path and blast radius for
 * no reason. It now has its own module, mounted on its own path, so the
 * surface is explicit and changing one cannot disturb the other.
 *
 * Every route here requires authentication. Page-level access is enforced
 * separately by rbacConfig against the '/cm-dashboard' front-end route.
 */

const express = require('express');

const router = express.Router();
const { getCMBrief } = require('../controllers/cmDashboardController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

/**
 * GET /api/cm-dashboard/brief?days=30
 * One call returning the outcome of every module plus the cross-module
 * findings no single module can produce alone.
 */
router.get('/brief', getCMBrief);

module.exports = router;
