const express = require('express');
const router  = express.Router();
const { getArticles, getStats, getRssKeywords, addRssKeyword, deleteRssKeyword,
        getRssLanguages, addRssLanguage, deleteRssLanguage, getConstituencyDistrictNews,
        updateArticleSentiment, deleteArticle } = require('../controllers/newsController');
const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');

router.get('/',       protect, loadScope, getArticles);
router.get('/stats',  protect, loadScope, getStats);
router.get('/constituency/:constituency', protect, loadScope, getConstituencyDistrictNews);

router.get('/keywords',           protect, loadScope, getRssKeywords);
router.post('/keywords',          protect, loadScope, addRssKeyword);
router.delete('/keywords/:keyword', protect, loadScope, deleteRssKeyword);

router.get('/languages',          protect, loadScope, getRssLanguages);
router.post('/languages',         protect, loadScope, addRssLanguage);
router.delete('/languages/:code', protect, loadScope, deleteRssLanguage);

// Admin-only single-article mutations (registered after the specific paths above).
router.patch('/:id/sentiment',    protect, loadScope, updateArticleSentiment);
router.delete('/:id',             protect, loadScope, deleteArticle);

module.exports = router;
