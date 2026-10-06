const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildEmailLookup = (email) => {
  const normalizedEmail = normalizeEmail(email);
  return {
    $regex: `^${escapeRegex(normalizedEmail)}$`,
    $options: 'i'
  };
};

const normalizeRole = (role) => {
  const normalized = String(role || '').trim();
  if (normalized === 'super_admin') return 'superadmin';
  // Legacy name of the scoped senior-leader role.
  if (normalized === 'nara_lokesh') return 'senior_leader';
  return normalized;
};

const hasAnyRole = (actualRole, allowedRoles = []) => {
  const normalizedActualRole = normalizeRole(actualRole);
  return allowedRoles.some((role) => normalizeRole(role) === normalizedActualRole);
};

module.exports = {
  buildEmailLookup,
  normalizeEmail,
  normalizeRole,
  hasAnyRole,
};
