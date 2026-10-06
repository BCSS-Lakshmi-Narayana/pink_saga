const express = require('express');
const router = express.Router();
const {
  getAPKpis,
  getAPSentimentTrend,
  getAPMentionTrend,
  getAPSourceDistribution,
  getAPDistrictPerformance,
  getAPTopTopics,
  getAPAlertsSummary,
  getAPRecentActivity,
  getAPMapData,
  getAPAiInsights,
  getAPGeoHighlights,
  exportAPDashboardPdf
} = require('../controllers/apDashboardController');
const { protect } = require('../middleware/authMiddleware');

// All dashboard routes require authentication
router.use(protect);

// KPI snapshot
router.get('/ap-kpis', getAPKpis);

// Charts
router.get('/ap-sentiment-trend', getAPSentimentTrend);
router.get('/ap-mention-trend', getAPMentionTrend);
router.get('/ap-source-distribution', getAPSourceDistribution);

// Performance tables
router.get('/ap-district-performance', getAPDistrictPerformance);
router.get('/ap-top-topics', getAPTopTopics);

// Alerts & Activity
router.get('/ap-alerts-summary', getAPAlertsSummary);
router.get('/ap-recent-activity', getAPRecentActivity);

// Map data
router.get('/ap-map-data', getAPMapData);

// AI Insights
router.get('/ap-ai-insights', getAPAiInsights);

// Geographic highlights
router.get('/ap-geo-highlights', getAPGeoHighlights);

// PDF Export (POST to allow passing URL/token in body)
router.post('/ap-export-pdf', exportAPDashboardPdf);


module.exports = router;
