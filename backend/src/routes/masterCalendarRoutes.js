const express = require('express');
const router = express.Router();
const {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent
} = require('../controllers/masterCalendarController');
const { protect } = require('../middleware/authMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');

router.use(protect, requireAnyPageAccess(['/master-calendar', '/events']));

router.get('/', listEvents);
router.post('/', createEvent);
router.put('/:id', updateEvent);
router.delete('/:id', deleteEvent);

module.exports = router;
