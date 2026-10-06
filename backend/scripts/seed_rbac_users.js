/**
 * seed_rbac_users.js
 * ─────────────────────────────────────────────────────────────────────
 * Idempotent seed for the RBAC rollout. Creates / updates:
 *   1. Super admin    (SUPERADMIN_EMAIL, default admin@brswatch.local)
 *   2. Optionally, one constituency-scoped senior-leader login, when
 *      SENIOR_LEADER_EMAIL + SENIOR_LEADER_CONSTITUENCY are set in .env
 *      (e.g. a leader who should see only their own seat's data).
 *
 * Passwords come from SUPERADMIN_PASSWORD / SENIOR_LEADER_PASSWORD. When
 * unset, a new account gets a random password printed once; an existing
 * account's password is left untouched.
 *
 * Run with:
 *   node backend/scripts/seed_rbac_users.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../src/models/User');

const upsertUser = async ({ email, password, full_name, role, ...scope }) => {
  const lookup = { email: email.toLowerCase() };
  const existing = await User.findOne(lookup);
  if (existing) {
    existing.full_name = full_name;
    existing.role = role;
    if (scope.assigned_constituency !== undefined) existing.assigned_constituency = scope.assigned_constituency;
    if (scope.assigned_lok_sabha !== undefined) existing.assigned_lok_sabha = scope.assigned_lok_sabha;
    if (scope.extra_constituencies !== undefined) existing.extra_constituencies = scope.extra_constituencies;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      existing.password = await bcrypt.hash(password, salt);
    }
    await existing.save();
    console.log(`[seed] updated ${role.padEnd(14)} ${email}`);
    return existing;
  }
  const initial = password || crypto.randomBytes(12).toString('base64url');
  const salt = await bcrypt.genSalt(10);
  const user = await User.create({
    email: email.toLowerCase(),
    password: await bcrypt.hash(initial, salt),
    full_name,
    role,
    ...scope,
    is_active: true,
  });
  console.log(`[seed] created ${role.padEnd(14)} ${email}${password ? '' : `  one-time password: ${initial}`}`);
  return user;
};

const main = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cgsaga';
  const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
  await mongoose.connect(uri, dbName ? { dbName } : undefined);
  try {
    await upsertUser({
      email: process.env.SUPERADMIN_EMAIL || 'admin@brswatch.local',
      password: process.env.SUPERADMIN_PASSWORD,
      full_name: 'SANKET Super Admin',
      role: 'superadmin',
    });

    if (process.env.SENIOR_LEADER_EMAIL && process.env.SENIOR_LEADER_CONSTITUENCY) {
      await upsertUser({
        email: process.env.SENIOR_LEADER_EMAIL,
        password: process.env.SENIOR_LEADER_PASSWORD,
        full_name: process.env.SENIOR_LEADER_NAME || 'Senior Leader',
        role: 'senior_leader',
        assigned_constituency: String(process.env.SENIOR_LEADER_CONSTITUENCY).toUpperCase(),
      });
    }
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
