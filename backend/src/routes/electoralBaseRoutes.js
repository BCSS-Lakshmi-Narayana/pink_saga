const express = require('express');
const { getSeats, getSeat, getOverview } = require('../controllers/electoralBaseController');
const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');
const { loadUserPermissions, hasPageAccess } = require('../middleware/rbacMiddleware');

const router = express.Router();

/*
 * Shown on the Overview dashboard. Seat-scoped users pass through and are
 * row-filtered by req.scope in the controller; a statewide (canSeeAll) user
 * who is not a super-admin additionally needs the Overview page itself.
 */
const requireDashboardIfStatewide = (req, res, next) => {
    if (req.scope?.isSuperAdmin || !req.scope?.canSeeAll) return next();
    if (hasPageAccess(req, '/dashboard')) return next();
    return res.status(403).json({ code: 'RBAC_PAGE_DENIED', message: 'You do not have access to the Overview dashboard', required_pages: ['/dashboard'] });
};

router.use(protect, loadScope, loadUserPermissions, requireDashboardIfStatewide);

router.get('/seats', getSeats);
router.get('/overview', getOverview);
router.get('/seats/:key', getSeat);

module.exports = router;
