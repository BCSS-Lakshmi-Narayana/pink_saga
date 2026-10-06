const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  loadUserPermissions,
  hasPageAccess,
  hasFeatureAccess,
  denyPageAccess,
  denyFeatureAccess
} = require('../middleware/rbacMiddleware');
const {
  createReport,
  shareReport,
  getReports,
  getReport,
  exportReports,
  getContacts,
  generateReportPdf
} = require('../controllers/suggestionController');

const requireSuggestionPageAccess = (req, res, next) => {
  if (hasPageAccess(req, '/unified-reports') || hasPageAccess(req, '/grievances')) {
    return next();
  }
  return denyPageAccess(res, ['/grievances', '/unified-reports']);
};

const requireSuggestionReportFeature = (req, res, next) => {
  if (hasPageAccess(req, '/unified-reports')) {
    return next();
  }
  if (!hasPageAccess(req, '/grievances')) {
    return denyPageAccess(res, ['/grievances', '/unified-reports']);
  }
  if (!hasFeatureAccess(req, '/grievances', 'reports')) {
    return denyFeatureAccess(res, '/grievances', 'reports');
  }
  return next();
};

router.use(protect, loadUserPermissions, requireSuggestionPageAccess, requireSuggestionReportFeature);

/* ── Reports ── */
router.get('/reports/export', exportReports); // must be before :id
router.get('/reports', getReports);
router.post('/reports', createReport);
router.get('/reports/:id', getReport);
router.put('/reports/:id/share', shareReport);
router.post('/reports/:id/generate-pdf', generateReportPdf);

/* ── Contacts (reuses criticism contacts) ── */
router.get('/contacts', getContacts);

module.exports = router;
