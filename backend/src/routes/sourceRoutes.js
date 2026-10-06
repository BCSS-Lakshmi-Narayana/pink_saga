const express = require('express');
const router = express.Router();
const sourceController = require('../controllers/sourceController');
const { 
  getSources, 
  createSource, 
  updateSource, 
  deleteSource, 
  manualCheck, 
  toggleSourceStatus, 
  scanNow, 
  scanAllSources, 
  createSourcesBulk, 
  getInstagramProfile,
  resolveIdentity
} = sourceController;

const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');
const { requireAnyPageAccess, requirePlatformFeatureAccess } = require('../middleware/rbacMiddleware');

const SOURCE_ALLOWED_PAGES = [
  '/sources',
  '/global-search',
  '/surveillance',
  '/person-of-interest',
  '/monitors',
  '/x-monitor',
  '/facebook-monitor',
  '/instagram-monitor',
  '/youtube-monitor'
];

router.use(protect, loadScope, requireAnyPageAccess(SOURCE_ALLOWED_PAGES));

router.route('/')
  .get(requirePlatformFeatureAccess('/monitors', (req) => req.query.platform), getSources)
  .post(requirePlatformFeatureAccess('/monitors', (req) => req.body.platform), createSource);

// Before the '/:id' routes, so 'resolve-identity' is not read as an id.
router.post('/resolve-identity', resolveIdentity);
router.post('/bulk', requirePlatformFeatureAccess('/monitors', (req) => req.body.platform), createSourcesBulk);
router.post('/scan-all', requirePlatformFeatureAccess('/monitors', (req) => req.body.platform), scanAllSources);

router.route('/:id')
  .put(updateSource)
  .delete(deleteSource);

router.post('/:id/check', manualCheck);
router.post('/:id/scan', scanNow);
router.put('/:id/toggle', toggleSourceStatus);
router.get('/:id/instagram-profile', requirePlatformFeatureAccess('/monitors', () => 'instagram'), getInstagramProfile);

module.exports = router;
