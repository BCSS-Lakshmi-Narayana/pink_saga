const express = require('express');
const router = express.Router();
const {
  getAnalyticsOverview,
  getTrends,
  getUnifiedReportsAnalytics
} = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');

router.use(protect, loadScope, requireAnyPageAccess(['/analytics', '/unified-reports', '/intel-processed']));

router.get('/overview', getAnalyticsOverview);
router.get('/trends', getTrends);
router.get('/unified-reports', getUnifiedReportsAnalytics);

module.exports = router;
