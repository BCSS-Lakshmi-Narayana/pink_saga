const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getMe,
  provisionScopedUser,
  listScopedUsers,
  updateScopedUser,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// Superadmin-only: creating accounts is an admin action, enforced in the
// controller. Previously unauthenticated, which allowed self-provisioning.
router.post('/register', protect, register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.post('/provision-mla', protect, provisionScopedUser);
router.get('/constituency-users', protect, listScopedUsers);
router.patch('/scoped-user/:id', protect, updateScopedUser);

module.exports = router;
