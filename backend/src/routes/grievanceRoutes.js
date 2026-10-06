const express = require('express');
const router = express.Router();
const {
    getSources,
    addSource,
    updateSource,
    deleteSource,
    fetchSourceGrievances,
    fetchAllGrievances,
    fetchKeywordGrievances,
    getGrievances,
    getGrievance,
    translateGrievanceContent,
    deleteGrievance,
    acknowledgeGrievance,
    markAsComplaint,
    updateComplaintStatus,
    updateWorkflowStatus,
    convertToFir,
    escalateGrievance,
    ingestWhatsAppWebhook,
    generateReport,
    recordShare,
    getStats,
    getDashboardStats,
    getSettings,
    updateSettings,
    revertGrievance,
    analyzeGrievance,
    analyzeAllGrievances,
    updateGrievanceRiskLevel,
    getSentimentAnalytics,
    getSentimentLeaders,
    getDistinctTopics,
    getDistinctCategories,
    getCategoryAnalytics,
    getMapGrievances,
    getLocationStats,
    getLocationSummary,
    importTweetByUrl
} = require('../controllers/grievanceController');
const { protect } = require('../middleware/authMiddleware');
const { GRIEVANCE_FEATURE_ALIASES } = require('../config/rbacConfig');
const { requireAnyPageAccess, requireFeatureAccess } = require('../middleware/rbacMiddleware');
const { requireConstituencyAccess } = require('../middleware/scopeMiddleware');

const normalizeGrievanceFeature = (value) => {
    if (!value || typeof value !== 'string') return null;
    const normalized = value.toLowerCase();
    if (normalized === 'total') return 'all';
    if (normalized === 'converted_to_fir') return 'fir';
    return normalized;
};

const resolveGrievanceFeatureFromQuery = (req) => (
    normalizeGrievanceFeature(req.query.status_filter || req.query.tab || req.query.status || req.query.navbarStatus) || 'all'
);

const resolveGrievanceFeatureFromBody = (req) => (
    normalizeGrievanceFeature(req.body.status || req.body.workflow_status || req.body.targetStatus || req.body.next_status)
);

// Public webhook route (must remain unauthenticated)
router.post('/whatsapp/webhook', ingestWhatsAppWebhook);

router.use(protect, requireAnyPageAccess(['/grievances']));

// Stats route (must be before :id routes)
router.get('/stats', getStats);
router.get('/dashboard-stats', getDashboardStats);
router.get('/sentiment-analytics', getSentimentAnalytics);
router.get('/sentiment-leaders', getSentimentLeaders);
router.get('/topics', getDistinctTopics);
router.get('/categories', getDistinctCategories);
router.get('/category-analytics', getCategoryAnalytics);
router.get('/map', getMapGrievances);
router.get('/location-stats', getLocationStats);
router.get(
    '/location-summary',
    requireConstituencyAccess((req) => req.query.location_city || req.query.location),
    getLocationSummary
);

// Settings routes
router.route('/settings')
    .get(getSettings)
    .put(updateSettings);

// Source routes
router.route('/sources')
    .get(getSources)
    .post(addSource);

router.route('/sources/:id')
    .put(updateSource)
    .delete(deleteSource);

router.post('/sources/:id/fetch', fetchSourceGrievances);

// Fetch all grievances from all sources
router.post('/fetch-all', fetchAllGrievances);

// Fetch grievances by keyword search from Settings
router.post('/fetch-keywords', fetchKeywordGrievances);
router.post('/import-tweet', importTweetByUrl);

// BSK Alerts → Mentions promotion pipeline (LLM-gated via RapidAPI ChatGPT-42).
// Reads unprocessed Alert rows, runs each through the BSK relevance gate,
// and promotes the relevant ones to Mentions / Grievance.

// Translate route (must be before :id routes)
router.post('/translate', translateGrievanceContent);

// Grievance routes
router.route('/')
    .get(requireFeatureAccess('/grievances', resolveGrievanceFeatureFromQuery, { aliases: GRIEVANCE_FEATURE_ALIASES }), getGrievances);

router.route('/:id')
    .get(getGrievance)
    .delete(deleteGrievance);

// Classification actions
router.put('/:id/acknowledge', requireFeatureAccess('/grievances', () => 'pending'), acknowledgeGrievance);
router.put('/:id/complaint', requireFeatureAccess('/grievances', () => 'pending'), markAsComplaint);
router.put('/:id/status', requireFeatureAccess('/grievances', resolveGrievanceFeatureFromBody, { aliases: GRIEVANCE_FEATURE_ALIASES, allowWhenMissing: true }), updateComplaintStatus);
router.put('/:id/workflow', requireFeatureAccess('/grievances', resolveGrievanceFeatureFromBody, { aliases: GRIEVANCE_FEATURE_ALIASES, allowWhenMissing: true }), updateWorkflowStatus);
router.post('/:id/convert-to-fir', requireFeatureAccess('/grievances', () => 'fir'), convertToFir);
router.post('/:id/escalate', requireFeatureAccess('/grievances', () => 'pending'), escalateGrievance);
router.put('/:id/revert', requireFeatureAccess('/grievances', () => 'all'), revertGrievance);

// Report generation and sharing
router.get('/:id/report', requireFeatureAccess('/grievances', () => 'reports'), generateReport);
router.post('/:id/share', requireFeatureAccess('/grievances', () => 'reports'), recordShare);

// Analysis routes
router.post('/analyze-all', analyzeAllGrievances);
router.post('/:id/analyze', analyzeGrievance);
router.put('/:id/risk-level', updateGrievanceRiskLevel);

module.exports = router;
