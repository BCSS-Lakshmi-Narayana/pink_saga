const express = require('express');
const router = express.Router();
const {
  getLeaderboard,
  getSummary,
  getConstituencyDetail,
  getConstituencyNarrative,
  getComparison,
} = require('../controllers/constituencyIntelligenceController');
const {
  getLeaderPopularity,
  getLeaderPopularityPosts,
} = require('../controllers/leaderPopularityController');
const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');
const { loadUserPermissions, hasPageAccess } = require('../middleware/rbacMiddleware');

// Constituency War Room — party-strategist intelligence across AP seats.
// Consumed both by the ungated /state-map home page (any
// authenticated user, already row-scoped via req.scope for mla/mp/
// senior_leader/constituency_manager) and by Geographic Intelligence's
// Constituency Explorer tab. A blanket `/geographic-intelligence` page gate
// would break the home page for users who don't hold that permission, so
// instead: already-scoped callers pass straight through; only a
// canSeeAll-but-not-superadmin caller (a legacy/back-office/party-leadership
// role with no explicit constituency assignment, which resolves to full
// state-wide visibility) additionally needs the Geographic Intelligence page
// permission before it can pull the full 175-seat dataset.
const requireStatewideAccessIfUnscoped = (req, res, next) => {
  if (req.scope?.isSuperAdmin || !req.scope?.canSeeAll) return next();
  if (hasPageAccess(req, '/geographic-intelligence')) return next();
  return res.status(403).json({
    code: 'RBAC_PAGE_DENIED',
    message: 'You do not have access to state-wide constituency intelligence',
    required_pages: ['/geographic-intelligence'],
  });
};

router.use(protect, loadScope, loadUserPermissions, requireStatewideAccessIfUnscoped);

router.get('/leaderboard', getLeaderboard);
router.get('/summary', getSummary);
router.get('/compare', getComparison);
// Registered BEFORE the generic /:constituency route below — otherwise
// "leader-popularity" is captured as a constituency name and neither handler
// here is ever reached.
router.get('/leader-popularity', getLeaderPopularity);
router.get('/leader-popularity/posts', getLeaderPopularityPosts);
router.get('/:constituency/narrative', getConstituencyNarrative);
router.get('/:constituency', getConstituencyDetail);

module.exports = router;
