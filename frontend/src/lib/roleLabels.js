/**
 * Human-facing names for user roles.
 *
 * The stored role values (`level-1`, `superadmin`, …) are deliberately left
 * untouched: `superadmin` is checked by backend route guards, scope resolution
 * and several frontend access guards, so renaming the value would break
 * authorisation. Only the presentation changes here.
 */
export const ROLE_LABELS = {
    'level-1': 'Staff',
    'level-2': 'Level 2',
    superadmin: 'Leader',
    super_admin: 'Leader',
    mla: 'MLA',
    mp: 'MP',
    senior_leader: 'Senior Leader',
    nara_lokesh: 'Senior Leader', // legacy role value; the backend normalises it to senior_leader
    constituency_manager: 'Constituency Manager',
    party_leadership: 'Party Leadership',
    analyst: 'Analyst',
    viewer: 'Viewer',
    dial100: 'Dial 100'
};

/** Display name for a role, falling back to the raw value if unmapped. */
export const roleLabel = (role) => ROLE_LABELS[role] || role || '';

/**
 * Roles offered in the create / edit dropdowns. `level-2` is intentionally
 * excluded — existing level-2 accounts keep working and still render with a
 * readable label, but no new ones can be created. Re-add it here to bring it
 * back.
 */
export const ASSIGNABLE_ROLES = ['level-1', 'superadmin'];
