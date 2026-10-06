export const GRIEVANCE_ADMIN_EMAIL = 'sreenu@gmail.com';

// Who can edit sentiment / delete grievances, alerts and RSS articles.
// The designated admin email OR any super-admin — so it works for every admin
// account on the server, not just one hardcoded address.
export const canManageRestrictedGrievanceUi = (user) => {
  if (!user) return false;
  const email = String(user.email || '').trim().toLowerCase();
  if (email === GRIEVANCE_ADMIN_EMAIL) return true;
  const role = String(user.role || '').trim().toLowerCase();
  return user.is_super_admin === true || role === 'superadmin' || role === 'super_admin';
};
