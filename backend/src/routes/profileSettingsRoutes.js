/**
 * profileSettingsRoutes
 * ─────────────────────────────────────────────────────────────────────
 * Super-admin admin routes for:
 *   /api/admin/mla-profiles       — list / get / upsert / delete
 *   /api/admin/global-profile     — get / update singleton
 *   /api/admin/classify-location  — preview classifier output
 *
 * All endpoints require a valid JWT (protect) and role=superadmin
 * (enforced inside each controller via requireSuperAdmin).
 */

const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/profileSettingsController');

const router = express.Router();

// MLA profile settings (one per constituency)
router.get('/mla-profiles',                protect, ctrl.listMlaProfiles);
router.get('/mla-profiles/:constituency',  protect, ctrl.getMlaProfile);
router.put('/mla-profiles/:constituency',  protect, ctrl.upsertMlaProfile);
router.delete('/mla-profiles/:constituency', protect, ctrl.deleteMlaProfile);

// Global state-wide profile (singleton)
router.get('/global-profile', protect, ctrl.getGlobalProfile);
router.put('/global-profile', protect, ctrl.updateGlobalProfile);

// Classifier preview
router.post('/classify-location', protect, ctrl.classifyLocationPreview);

// Ollama health / smoke test
router.post('/test-ollama', protect, ctrl.testOllama);

// Intelligence dashboards (impact score, geo map, manual review queue)
const intel = require('../controllers/intelligenceController');
router.get ('/political-impact',                      protect, intel.politicalImpact);
router.get ('/geo-mapping',                           protect, intel.geoMapping);
router.get ('/manual-review-queue',                   protect, intel.listManualReviewQueue);
router.post('/manual-review-queue/:id/resolve',       protect, intel.resolveManualReview);
router.post('/manual-review-queue/:id/reject',        protect, intel.rejectManualReview);

// Constituency Master (hierarchy: MLA / MP / district / mandals / villages / aliases)
const cm = require('../controllers/constituencyMasterController');
router.get   ('/constituency-master',                protect, cm.listMaster);
router.get   ('/constituency-master/stats',          protect, cm.stats);
router.post  ('/constituency-master/bulk',           protect, cm.bulkUpsert);
router.post  ('/constituency-master/route-preview',  protect, cm.routePreview);
router.get   ('/constituency-master/:ac',            protect, cm.getOne);
router.put   ('/constituency-master/:ac',            protect, cm.upsertOne);
router.delete('/constituency-master/:ac',            protect, cm.deleteOne);

module.exports = router;
