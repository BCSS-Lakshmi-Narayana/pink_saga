const express = require('express');
const router = express.Router();
const {
    getAllPOIs,
    getPOIById,
    createPOI,
    updatePOI,
    deletePOI,
    getLatestReport,
    getPoiBySourceId
} = require('../controllers/poiController');
const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');

router.use(protect, loadScope, requireAnyPageAccess(['/person-of-interest']));

router.get('/', getAllPOIs);
router.get('/by-source/:sourceId', getPoiBySourceId);
router.get('/:id/report/latest', getLatestReport);
router.get('/:id', getPOIById);
router.post('/', createPOI);
router.put('/:id', updatePOI);
router.delete('/:id', deletePOI);

module.exports = router;
