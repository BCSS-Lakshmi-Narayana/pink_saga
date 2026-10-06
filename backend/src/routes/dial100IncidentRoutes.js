const express = require('express');
const router = express.Router();
const {
  getIncidentsByDate,
  saveIncidentsBulk
} = require('../controllers/dial100IncidentController');
const { protect } = require('../middleware/authMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');

router.use(protect, requireAnyPageAccess(['/dial-100-incident-reporting']));

router.get('/', getIncidentsByDate);
router.post('/bulk', saveIncidentsBulk);

module.exports = router;
