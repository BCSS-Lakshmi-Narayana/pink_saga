const express = require('express');
const router = express.Router();
const {
  getScope,
  getDistricts,
  getDistrictDetail,
  getCities,
  getTopics,
  getSummary,
  getPlayback,
} = require('../controllers/geoIntelController');
const { protect } = require('../middleware/authMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');
const { loadGeoScope } = require('../middleware/scopeMiddleware');

// Geographic Intelligence — District → City drill-down.
// Unlike constituency-intel / ap-dashboard (which skip page-level RBAC),
// this module is gated by the strict pattern used by Grievances/Alerts:
// page-level access + row-level geo scope, both enforced server-side.
router.use(protect, requireAnyPageAccess(['/geographic-intelligence']), loadGeoScope);

router.get('/scope', getScope);
router.get('/summary', getSummary);
router.get('/playback', getPlayback);
router.get('/districts', getDistricts);
router.get('/districts/:districtKey', getDistrictDetail);
router.get('/districts/:districtKey/cities', getCities);
router.get('/districts/:districtKey/topics', getTopics);

module.exports = router;
