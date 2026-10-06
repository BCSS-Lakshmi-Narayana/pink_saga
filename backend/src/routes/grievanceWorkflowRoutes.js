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
  closeReport,
  updateReportStatus,
  getReports,
  getReport,
  exportReports,
  getContacts,
  updateReport,
  generateReportPdf
} = require('../controllers/grievanceWorkflowController');

const requireWorkflowPageAccess = (req, res, next) => {
  if (hasPageAccess(req, '/unified-reports') || hasPageAccess(req, '/grievances')) {
    return next();
  }
  return denyPageAccess(res, ['/grievances', '/unified-reports']);
};

const requireWorkflowReportFeature = (req, res, next) => {
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

router.use(protect, loadUserPermissions, requireWorkflowPageAccess, requireWorkflowReportFeature);

/* ── Reports ── */
router.get('/reports/export', exportReports); // before :id
router.get('/reports', getReports);
router.post('/reports', createReport);
router.get('/reports/:id', getReport);
router.put('/reports/:id', updateReport);
router.put('/reports/:id/share', shareReport);
router.put('/reports/:id/close', closeReport);
router.put('/reports/:id/status', updateReportStatus);
router.post('/reports/:id/generate-pdf', generateReportPdf);

/* ── Contacts (reuse criticism contacts) ── */
router.get('/contacts', getContacts);

module.exports = router;
