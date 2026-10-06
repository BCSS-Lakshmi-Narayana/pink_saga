/**
 * boothImportRoutes  →  /api/booth-imports
 * ─────────────────────────────────────────────────────────────────────
 * Staged bulk import of a constituency's ECI electoral roll. See
 * boothImportController for the five-step protocol.
 *
 * Two tiers of access:
 *   • READ  (seat list, session progress) — any authenticated user, then
 *     narrowed per-seat by `req.scope` inside the controller.
 *   • WRITE (create / stage / commit / abort / relabel) — restricted to
 *     the roles that own a seat's data, and then narrowed to the seats
 *     that specific user holds.
 */

const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');
const { canManageBoothRolls } = require('../config/boothImportAccess');
const {
    getSeats,
    listImports,
    createImport,
    uploadParts,
    getImport,
    commitImport,
    deleteImport,
    updateImport,
} = require('../controllers/boothImportController');

// Writes are gated on an explicit account allowlist rather than a role —
// see config/boothImportAccess.js for why. Seat-level scoping still applies
// on top of this inside the controller.
const requireImportAccess = (req, res, next) => {
    if (canManageBoothRolls(req.user)) return next();
    return res.status(403).json({
        success: false,
        code: 'BOOTH_IMPORT_FORBIDDEN',
        message: 'This account is not authorized to manage booth rolls',
    });
};

router.use(protect, loadScope);

// ── Read ──────────────────────────────────────────────────────────────
// Single source of truth for the UI: the frontend asks whether this account
// may manage rolls rather than carrying its own copy of the allowlist, so
// the two can never disagree.
router.get('/access', (req, res) => res.json({
    success: true,
    can_manage: canManageBoothRolls(req.user),
}));
router.get('/seats', getSeats);
router.get('/', listImports);
router.get('/:id', getImport);

// ── Write ─────────────────────────────────────────────────────────────
router.post('/', requireImportAccess, createImport);
router.post('/:id/parts', requireImportAccess, uploadParts);
router.post('/:id/commit', requireImportAccess, commitImport);
// Aborts a staging roll; deletes a committed one (the latter needs confirm=true).
router.delete('/:id', requireImportAccess, deleteImport);
router.put('/:id', requireImportAccess, updateImport);
// Retained alias — same handler, accepts roll_year and/or roll_label.
router.put('/:id/year', requireImportAccess, updateImport);

module.exports = router;
