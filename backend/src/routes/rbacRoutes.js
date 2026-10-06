const express = require('express');
const router = express.Router();
const {
    getAllPages,
    getAllUsers,
    getUserPermissions,
    updateUserPermissions,
    getMyPermissions,
    updateUser,
    deleteUser
} = require('../controllers/rbacController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { loadUserPermissions, requireAnyPageAccess } = require('../middleware/rbacMiddleware');

// All routes require authentication
router.use(protect);

// Current user's own permissions (any authenticated user)
router.get('/my-permissions', getMyPermissions);

// Admin-only routes
router.get('/pages', authorize('superadmin'), loadUserPermissions, requireAnyPageAccess(['/access-management']), getAllPages);
router.get('/users', authorize('superadmin'), loadUserPermissions, requireAnyPageAccess(['/access-management']), getAllUsers);
router.put('/users/:userId', authorize('superadmin'), loadUserPermissions, requireAnyPageAccess(['/access-management']), updateUser);
router.delete('/users/:userId', authorize('superadmin'), loadUserPermissions, requireAnyPageAccess(['/access-management']), deleteUser);
router.get('/permissions/:userId', authorize('superadmin'), loadUserPermissions, requireAnyPageAccess(['/access-management']), getUserPermissions);
router.put('/permissions/:userId', authorize('superadmin'), loadUserPermissions, requireAnyPageAccess(['/access-management']), updateUserPermissions);

module.exports = router;
