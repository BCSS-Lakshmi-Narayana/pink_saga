const express = require('express');
const router = express.Router();
const threatController = require('../controllers/threatController');
const { protect } = require('../middleware/authMiddleware');

router.post('/analyze', protect, threatController.analyzeText);

module.exports = router;
