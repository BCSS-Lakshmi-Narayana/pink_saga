const express = require('express');
const router = express.Router();
const { getKeywords, createKeyword, deleteKeyword } = require('../controllers/keywordController');
const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');

// One keyword list, managed from both Settings → Keywords and the Mentions
// (Grievances) page keyword panel, so either page's users can use it.
router.get('/', protect, loadScope, requireAnyPageAccess(['/settings', '/alerts', '/grievances']), getKeywords);
router.post('/', protect, loadScope, requireAnyPageAccess(['/settings', '/grievances']), createKeyword);
router.post('/scan', protect, loadScope, requireAnyPageAccess(['/settings']), require('../controllers/keywordController').triggerRescan);
router.delete('/:id', protect, loadScope, requireAnyPageAccess(['/settings', '/grievances']), deleteKeyword);

module.exports = router;
