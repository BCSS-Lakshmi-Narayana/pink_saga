const express = require('express');
const { getOverview } = require('../controllers/manifestoController');
const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');

const router = express.Router();

// The Manifesto tracker tab of the Intelligence Brief; rows are filtered to the user's seats in the service.
router.use(protect, loadScope, requireAnyPageAccess(['/cm-dashboard']));

router.get('/overview', getOverview);

module.exports = router;
