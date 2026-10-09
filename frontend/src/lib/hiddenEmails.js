// Accounts whose email must not be displayed in the UI (shown to clients).
// Display-only: the value stays in state and the edit forms, so the login still works.
const HIDDEN_EMAILS = ['sreenu@gmail.com'];

export const displayEmail = (email) =>
  HIDDEN_EMAILS.includes(String(email || '').trim().toLowerCase()) ? '' : (email || '');

/** Drops hidden accounts from a user list so they never render at all (cards, pickers, tables). */
export const visibleUsers = (users) =>
  (Array.isArray(users) ? users : []).filter((u) => displayEmail(u && u.email) !== '' || !(u && u.email));
