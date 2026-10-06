const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');

router.use(protect, loadScope, requireAnyPageAccess(['/global-search']));

router.get('/profiles', searchController.searchProfiles);
router.get('/content', searchController.searchContent);
router.get('/glance', searchController.glanceSearch); // AI-powered Grok-like search
router.get('/url', searchController.fetchPostByUrl); // URL-based post lookup
router.post('/history', searchController.saveSearchHistory);
router.get('/history', searchController.getSearchHistory);
router.get('/history/:id', searchController.getSearchHistoryById);

module.exports = router;
