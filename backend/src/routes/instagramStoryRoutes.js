const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');
const {
  loadUserPermissions,
  hasPageAccess,
  hasFeatureAccess,
  denyPageAccess,
  denyFeatureAccess
} = require('../middleware/rbacMiddleware');
const {
  getStories,
  storeStories,
  markViewed,
  deleteStory,
  bulkDeleteStories,
  cleanupStories,
  getStoryStats
} = require('../controllers/instagramStoryController');

const requireInstagramMonitorAccess = (req, res, next) => {
  if (hasPageAccess(req, '/alerts')) return next();
  if (hasPageAccess(req, '/instagram-monitor')) return next();
  if (hasPageAccess(req, '/monitors') && hasFeatureAccess(req, '/monitors', 'instagram')) return next();
  if (hasPageAccess(req, '/monitors')) return denyFeatureAccess(res, '/monitors', 'instagram');
  return denyPageAccess(res, ['/alerts', '/instagram-monitor', '/monitors']);
};

router.use(protect, loadScope, loadUserPermissions, requireInstagramMonitorAccess);

router.get('/', getStories);
router.get('/stats', getStoryStats);

// Store stories from API fetches
router.post('/store', storeStories);

// Mark story as viewed
router.put('/:id/viewed', markViewed);

// Admin-level delete
router.delete('/bulk', bulkDeleteStories);
router.delete('/:id', deleteStory);

// Cleanup expired stories
router.post('/cleanup', cleanupStories);

module.exports = router;
