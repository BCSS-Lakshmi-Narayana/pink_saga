const express = require('express');
const router = express.Router();

const {
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  archiveEvent,
  pauseEvent,
  resumeEvent,
  deleteEvent,
  getEventDashboard,
  runEventScan,
  generateKeywords,
  getMonitoringInterval,
  updateMonitoringInterval,
  getEventsReport,
  generateEventReportPdf
} = require('../controllers/eventController');

const { protect, authorize } = require('../middleware/authMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');

router.use(protect, requireAnyPageAccess(['/events']));

router.get('/', listEvents);
router.get('/report', getEventsReport);
router.get('/:id', getEvent);
router.get('/:id/dashboard', getEventDashboard);

router.post('/', authorize('superadmin', 'analyst', 'level-1'), createEvent);
router.get('/monitoring-interval', getMonitoringInterval);
router.put('/monitoring-interval', authorize('superadmin', 'analyst', 'level-1'), updateMonitoringInterval);
router.post('/generate-keywords', authorize('superadmin', 'analyst', 'level-1'), generateKeywords);
router.put('/:id', authorize('superadmin', 'analyst', 'level-1'), updateEvent);
router.post('/:id/archive', authorize('superadmin', 'analyst', 'level-1'), archiveEvent);
router.post('/:id/pause', authorize('superadmin', 'analyst', 'level-1'), pauseEvent);
router.post('/:id/resume', authorize('superadmin', 'analyst', 'level-1'), resumeEvent);
router.post('/:id/run', authorize('superadmin', 'analyst', 'level-1'), runEventScan);
router.post('/:id/generate-report-pdf', authorize('superadmin', 'analyst', 'level-1'), generateEventReportPdf);
router.delete('/:id', authorize('superadmin', 'analyst', 'level-1'), deleteEvent);

module.exports = router;
