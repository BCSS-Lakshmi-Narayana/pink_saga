const express = require('express');
const {
    getPolicies,
    getPolicy,
    createPolicy,
    updatePolicy,
    deletePolicy
} = require('../controllers/policyController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// Reading needs a signed-in user; changing the policy catalogue is superadmin-only.
router.use(protect);
const adminOnly = authorize('superadmin');

router
    .route('/')
    .get(getPolicies)
    .post(adminOnly, createPolicy);

router
    .route('/:id')
    .get(getPolicy)
    .put(adminOnly, updatePolicy)
    .delete(adminOnly, deletePolicy);

module.exports = router;
