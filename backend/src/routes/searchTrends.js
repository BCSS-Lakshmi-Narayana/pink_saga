const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const searchTrendsController = require('../controllers/searchTrendsController');

router.get('/', protect, searchTrendsController.getSearchTrends);

module.exports = router;
