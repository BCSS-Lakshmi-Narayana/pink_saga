const express = require('express');
const router = express.Router();
const exportController = require('../controllers/exportController');
const { protect } = require('../middleware/authMiddleware');

// Export routes
router.get('/pdf', protect, exportController.generatePDF);
router.get('/word', protect, exportController.generateWord);

module.exports = router;
