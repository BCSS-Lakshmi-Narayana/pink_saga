const express = require('express');
const router = express.Router();
const telegramController = require('../controllers/telegramController');
const { protect } = require('../middleware/authMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');

// Media stays public: the page loads it through <img>/<video> tags, which
// cannot send the Authorization header. It only streams a message's
// attachment by id; everything else (including the MTProto login and group
// management) requires a signed-in user with Telegram page access.
router.get('/media/:groupId/:messageId', telegramController.getMedia);

router.use(protect, requireAnyPageAccess(['/telegram', '/monitors']));

router.get('/status', telegramController.getStatus);
router.post('/auth/send-code', telegramController.sendCode);
router.post('/auth/verify', telegramController.verifyCode);
router.post('/auth/logout', telegramController.logout);
router.get('/search', telegramController.search);
router.get('/search-global', telegramController.searchGlobal);
router.post('/join', telegramController.join);
router.get('/groups', telegramController.getGroups);
router.post('/scrape/:groupId', telegramController.scrape);
router.get('/messages/:groupId', telegramController.getMessages);
router.get('/discover', telegramController.discover);
router.post('/sync', telegramController.sync);
router.post('/check-pending', telegramController.checkPending);
router.post('/scrape-all', telegramController.scrapeAll);
router.post('/leave/:groupId', telegramController.leaveGroup);
router.post('/mark-read/:groupId', telegramController.markRead);
router.post('/rejoin/:groupId', telegramController.rejoinGroup);
router.delete('/group/:groupId', telegramController.deleteGroup);

module.exports = router;
