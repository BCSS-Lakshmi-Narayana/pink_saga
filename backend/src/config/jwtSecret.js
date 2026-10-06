/**
 * The one place that decides the JWT signing secret.
 *
 * There is deliberately no hardcoded fallback: a default string in the source
 * lets anyone who has read the code forge a token for any user, superadmin
 * included. If JWT_SECRET is unset, a random secret is generated for this
 * process. Logins still work, but every session ends when the server restarts,
 * and tokens are not valid across multiple instances. Set JWT_SECRET in .env
 * for anything beyond local development.
 */
const crypto = require('crypto');

let cached = null;

const getJwtSecret = () => {
  if (cached) return cached;
  const fromEnv = String(process.env.JWT_SECRET || '').trim();
  if (fromEnv) {
    cached = fromEnv;
  } else {
    cached = crypto.randomBytes(48).toString('hex');
    console.warn(
      '[auth] JWT_SECRET is not set: using a random per-process secret. ' +
      'All sessions end on restart. Set JWT_SECRET in backend/.env.'
    );
  }
  return cached;
};

module.exports = { getJwtSecret };
