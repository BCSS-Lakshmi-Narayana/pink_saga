const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/intelligenceReportController');
const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');
const { loadUserPermissions } = require('../middleware/rbacMiddleware');

router.use(protect, loadScope, loadUserPermissions);

// GET /api/intelligence-reports/alerts/pdf
router.get('/alerts/pdf', ctrl.alertsPdf);

// GET /api/intelligence-reports/grievances/pdf
router.get('/grievances/pdf', ctrl.grievancesPdf);

module.exports = router;