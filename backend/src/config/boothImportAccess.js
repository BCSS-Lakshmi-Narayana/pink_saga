/**
 * boothImportAccess
 * ─────────────────────────────────────────────────────────────────────
 * Who may upload, update or delete booth-level voter roll data.
 *
 * This is an explicit account allowlist, NOT a role check. Uploading a roll
 * writes hundreds of thousands of rows and deleting one destroys them, so
 * the gate is "these specific people", not "anyone who happens to hold a
 * role" — a role check would silently widen the moment another account is
 * given that role.
 *
 * Reading booth data is unaffected — that stays governed by the caller's
 * constituency scope, exactly as before. This module only gates writes.
 *
 * ── Changing who has access ──────────────────────────────────────────
 * ALLOW_VOTER_UPLOAD_FILE below is the ONE place this feature names an
 * account. Nothing else in the codebase needs touching.
 *
 *   Single:    'abc@gmail.com'
 *   Multiple:  'abc@gmail.com, xyz@gmail.com'
 *
 * Both forms work. Spacing does not matter and matching ignores case, so
 * 'ABC@Gmail.com' and ' abc@gmail.com ' both resolve to the same account.
 *
 * To change access WITHOUT editing code — e.g. if the account below is
 * disabled and access has to move immediately — set an environment
 * variable of the same name and restart:
 *
 *   ALLOW_VOTER_UPLOAD_FILE=someone@gmail.com, other@gmail.com
 *
 * The environment variable, when set, replaces the constant entirely.
 */

const { normalizeEmail } = require('../utils/authIdentity');

// ─────────────────────────────────────────────────────────────────────
// Emails allowed to upload / update / delete booth roll data.
// One email, or several separated by commas.
// ─────────────────────────────────────────────────────────────────────
const ALLOW_VOTER_UPLOAD_FILE = 'sreenu@gmail.com';

/**
 * Accepts either form — a single address, a comma-separated list, or an
 * array — so the constant can be edited to whichever shape reads best
 * without the parsing having to be touched.
 */
const parseEmails = (value) => {
    const list = Array.isArray(value) ? value : String(value || '').split(',');
    return list.map(normalizeEmail).filter(Boolean);
};

const ALLOWED = new Set(
    parseEmails(process.env.ALLOW_VOTER_UPLOAD_FILE || ALLOW_VOTER_UPLOAD_FILE),
);

/** True if this user may upload, update or delete booth roll data. */
const canManageBoothRolls = (user) => ALLOWED.has(normalizeEmail(user?.email));

/** For logging / diagnostics — never returned to a client. */
const allowlistSize = () => ALLOWED.size;

module.exports = { canManageBoothRolls, allowlistSize, ALLOW_VOTER_UPLOAD_FILE };
