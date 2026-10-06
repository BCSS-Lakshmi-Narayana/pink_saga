/**
 * scopeMiddleware
 * ─────────────────────────────────────────────────────────────────────
 * Row-level access control on top of the existing JWT auth + page-level
 * RBAC. Determines, per request, which constituencies / Lok Sabha seats
 * the logged-in user is allowed to see, and exposes the result on
 * `req.scope` so downstream controllers can attach Mongo filters.
 *
 * Roles:
 *   • superadmin / super_admin  → full visibility (canSeeAll = true)
 *   • mla                       → exactly one assigned_constituency
 *   • mp                        → one assigned_lok_sabha (all child ACs)
 *   • senior_leader             → one assigned_constituency (super admin
 *                                  may grant more via extra_constituencies)
 *   • anything else (level-1, analyst, viewer, …) → backwards-compatible
 *                                  full visibility, to avoid breaking the
 *                                  ops console while RBAC rolls out.
 */

const { normalizeRole } = require('../utils/authIdentity');
const { getMlaByConstituency, getAllMlas } = require('../services/mlaReferenceService');
const LS_TO_AC = require('../data/state_ls_to_ac.json');
const ConstituencyMaster = require('../models/ConstituencyMaster');

const normalizeKey = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .trim();

// Roles that are ALWAYS row-level scoped, by definition of the role itself.
const SCOPED_ROLES = new Set(['mla', 'mp', 'senior_leader', 'constituency_manager']);

// Any other role (level-1, level-2, analyst, viewer, dial100, …) is scoped only
// when the super admin explicitly opted that individual user in via the
// `is_scoped` flag at onboarding. See User.is_scoped for why this is opt-in
// rather than role-wide: flipping every legacy account to scoped at once would
// blank out users who have no seat assigned.
const isScopedUser = (user, role) => {
  if (role === 'superadmin') return false;
  if (SCOPED_ROLES.has(role)) return true;
  return user?.is_scoped === true;
};

// Resolve a Lok Sabha key to its child AC names. Accepts the LS slug
// (`hyderabad`) or a display name (`Hyderabad`).
const childAcsForLs = (ls) => {
  if (!ls) return [];
  const direct = LS_TO_AC[ls];
  if (direct) return direct;
  const key = normalizeKey(ls);
  const hit = Object.keys(LS_TO_AC).find((k) => normalizeKey(k) === key);
  return hit ? LS_TO_AC[hit] : [];
};

// ── Seat-name validation ──────────────────────────────────────────────────
// A misspelt constituency is worse than a rejected one: `constituencyFilter`
// would build a regex that matches no documents, silently handing the user a
// blank app instead of an error. So assignments are canonicalised against the
// real seat lists at write time, and rejected outright if unrecognised.

// Union of every AC name we know: the LS→AC map plus the MLA reference list
// (the two datasets differ slightly in spelling and coverage).
const KNOWN_AC_NAMES = (() => {
  const byKey = new Map();
  Object.values(LS_TO_AC).flat().forEach((ac) => {
    const k = normalizeKey(ac);
    if (k && !byKey.has(k)) byKey.set(k, ac);
  });
  (getAllMlas() || []).forEach((m) => {
    const k = normalizeKey(m.constituency);
    if (k && !byKey.has(k)) byKey.set(k, m.constituency);
  });
  return byKey;
})();

const KNOWN_LS_NAMES = (() => {
  const byKey = new Map();
  Object.keys(LS_TO_AC).forEach((ls) => {
    const k = normalizeKey(ls);
    if (k) byKey.set(k, ls);
  });
  return byKey;
})();

/** Canonical AC name for a user-supplied value, or null if unrecognised. */
const resolveConstituencyName = (raw) => {
  const key = normalizeKey(raw);
  if (!key) return null;
  return KNOWN_AC_NAMES.get(key) || null;
};

/** Canonical Lok Sabha seat name for a user-supplied value, or null. */
const resolveLokSabhaName = (raw) => {
  const key = normalizeKey(raw);
  if (!key) return null;
  return KNOWN_LS_NAMES.get(key) || null;
};

/**
 * Normalise and validate the row-level scope assignment on a user create /
 * update payload. Returns `{ error }` on bad input, else `{ value }` with the
 * canonicalised fields ready to spread onto a User document.
 *
 * Accepts a `constituencies` array — one or many. The User model splits them
 * into a primary `assigned_constituency` plus `extra_constituencies`, which is
 * what `buildScope` already reads, so no schema change is needed to support
 * multiple seats.
 *
 * Shared by POST /auth/register and PUT /rbac/users/:userId so both entry
 * points enforce identical rules.
 */
const resolveScopeAssignment = (body = {}, { role } = {}) => {
  const wantsScope = body.is_scoped === true || body.is_scoped === 'true';

  // Super admins are never row-level scoped — refuse the contradictory combo
  // outright rather than silently dropping the assignment.
  if (normalizeRole(role) === 'superadmin' && wantsScope) {
    return { error: 'A superadmin cannot be restricted to a constituency' };
  }

  // Accept either the array form or the legacy single-seat fields, so the
  // existing /provision-mla flow keeps working unchanged.
  const raw = Array.isArray(body.constituencies)
    ? body.constituencies
    : [body.assigned_constituency];

  const seats = [];
  for (const name of raw) {
    if (!name) continue;
    const canonical = resolveConstituencyName(name);
    if (!canonical) return { error: `Unknown constituency: ${name}` };
    if (!seats.includes(canonical)) seats.push(canonical);
  }

  const out = {
    is_scoped: wantsScope,
    assigned_constituency: seats[0] || null,
    assigned_lok_sabha: null,
    extra_constituencies: seats.slice(1),
  };

  if (body.assigned_lok_sabha) {
    const canonical = resolveLokSabhaName(body.assigned_lok_sabha);
    if (!canonical) return { error: `Unknown Lok Sabha seat: ${body.assigned_lok_sabha}` };
    out.assigned_lok_sabha = canonical;
  }

  // A scoped user with no seats resolves to "match nothing" downstream, which
  // reads as a broken account. Require at least one assignment up front.
  if (wantsScope && !out.assigned_constituency && !out.assigned_lok_sabha) {
    return { error: 'Select at least one constituency when restricting a user' };
  }

  return { value: out };
};

const buildScope = (user) => {
  const role = normalizeRole(user?.role);
  if (role === 'superadmin') {
    return {
      isSuperAdmin: true,
      canSeeAll: true,
      role,
      constituencies: [],
      constituencyKeys: new Set(),
      lokSabha: null,
    };
  }

  // An explicit per-user opt-in outranks the statewide-read and legacy
  // fall-throughs below: if an admin assigned this account a seat, honour it.
  if (!isScopedUser(user, role)) {
    // Party leadership sees everything but isn't an admin; legacy/back-office
    // roles keep full visibility until someone opts them in.
    return {
      isSuperAdmin: false,
      canSeeAll: true,
      role,
      constituencies: [],
      constituencyKeys: new Set(),
      lokSabha: null,
    };
  }

  const constituencies = [];
  if (user.assigned_constituency) constituencies.push(user.assigned_constituency);
  (user.extra_constituencies || []).forEach((c) => {
    if (c) constituencies.push(c);
  });

  // Expand an assigned LS seat into all of its child ACs so the holder sees
  // grievances / alerts / sentiment across the whole parliamentary seat. Keyed
  // off the assignment rather than the `mp` role, so an opted-in level-1 user
  // granted a Lok Sabha seat gets the same fan-out.
  if (user.assigned_lok_sabha) {
    const childAcs = childAcsForLs(user.assigned_lok_sabha);
    childAcs.forEach((ac) => {
      if (!constituencies.some((c) => normalizeKey(c) === normalizeKey(ac))) {
        constituencies.push(ac);
      }
    });
  }

  const constituencyKeys = new Set(constituencies.map(normalizeKey).filter(Boolean));

  return {
    isSuperAdmin: false,
    canSeeAll: false,
    role,
    constituencies,
    constituencyKeys,
    lokSabha: user.assigned_lok_sabha || null,
  };
};

const loadScope = (req, _res, next) => {
  if (!req.user) {
    req.scope = { isSuperAdmin: false, canSeeAll: false, role: null, constituencies: [], constituencyKeys: new Set(), lokSabha: null };
    return next();
  }
  req.scope = buildScope(req.user);
  next();
};

/**
 * Hard guard: 403 if the request targets a constituency the caller isn't
 * scoped to. `getConstituency` may be a string or a (req)=>string resolver.
 */
const requireConstituencyAccess = (getConstituency) => (req, res, next) => {
  if (!req.scope) req.scope = buildScope(req.user);
  if (req.scope.canSeeAll) return next();

  const raw = typeof getConstituency === 'function' ? getConstituency(req) : getConstituency;
  if (!raw) return res.status(400).json({ code: 'CONSTITUENCY_REQUIRED', message: 'Constituency parameter missing' });

  const key = normalizeKey(raw);
  if (req.scope.constituencyKeys.has(key)) return next();

  // If the caller holds an LS seat, accept any AC inside it. Resolving the
  // LS-AC mapping at runtime keeps this dependency-free.
  if (req.scope.lokSabha) {
    const mla = getMlaByConstituency(raw);
    if (mla && normalizeKey(mla.lok_sabha) === normalizeKey(req.scope.lokSabha)) return next();
  }

  return res.status(403).json({
    code: 'CONSTITUENCY_FORBIDDEN',
    message: 'You are not authorized to view this constituency',
  });
};

/**
 * Returns a Mongo filter fragment to AND into queries on collections that
 * carry `detected_location.constituency`. Empty for super-admins / legacy.
 *
 * Pass `{ field }` to use a different path (e.g. 'constituency' on Alert).
 */
const constituencyFilter = (scope, opts = {}) => {
  const {
    field = 'detected_location.constituency',
    // Extra fields that should also match the user's allowed seats. When a
    // grievance fans out to multiple constituencies via routing_targets,
    // pass `extraFields: ['routing_targets.constituencies']` so each matched
    // MLA still sees the post even if it's not the primary detected_location.
    extraFields = [],
  } = opts;

  if (!scope || scope.canSeeAll) return {};
  const allowed = [...(scope.constituencies || [])];
  if (allowed.length === 0) {
    // User has no constituency assigned — deny everything.
    return { _id: { $exists: false } };
  }
  const regex = allowed
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const rx = { $regex: `^(${regex})$`, $options: 'i' };

  if (extraFields.length === 0) return { [field]: rx };
  return { $or: [{ [field]: rx }, ...extraFields.map((f) => ({ [f]: rx }))] };
};

/**
 * Mongo filter fragment for collections that follow the owned-vs-party-wide
 * pattern (e.g. Source, Keyword): a scoped user sees party-wide entries OR
 * entries tagged to one of their seats. Empty for super-admins / legacy.
 */
const sourceScopeFilter = (scope) => {
  if (!scope || scope.canSeeAll) return {};
  const seats = scope.constituencies || [];
  if (seats.length === 0) return { _id: { $exists: false } };
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = `^(${seats.map(esc).join('|')})$`;
  return {
    $or: [
      { is_party_wide: true },
      { constituency: { $regex: rx, $options: 'i' } },
    ],
  };
};

/**
 * Merge a filter fragment into a Mongo query object safely. If both sides
 * carry `$or`, they are AND-combined under `$and` so neither is silently
 * dropped (the way a plain `Object.assign` would). Use this whenever you
 * mix `constituencyFilter` / `sourceScopeFilter` into a query that may
 * already contain user-driven `$or` clauses (handle search, category OR,
 * location OR etc.).
 */
const mergeFilter = (target, fragment) => {
  if (!fragment || Object.keys(fragment).length === 0) return target;
  for (const [k, v] of Object.entries(fragment)) {
    if (k === '$or' && target.$or) {
      target.$and = [...(target.$and || []), { $or: target.$or }, { $or: v }];
      delete target.$or;
    } else if (k === '$and' && target.$and) {
      target.$and = [...target.$and, ...v];
    } else {
      target[k] = v;
    }
  }
  return target;
};

/**
 * Geographic scope (used by the Geographic Intelligence module).
 *
 * District-level access is DERIVED from the caller's existing constituency
 * scope via ConstituencyMaster (ac_key → district_key) rather than adding a
 * new `User.assigned_district` field — every scoped role already carries an
 * `assigned_constituency` / `assigned_lok_sabha`, and ConstituencyMaster is
 * the authoritative AC→district mapping, so this needs zero schema change.
 *
 * Shape:
 *   {
 *     canSeeAll:   boolean,               // state-wide visibility
 *     level:       'state' | 'district',  // what the UI should land on
 *     districtKeys: Set<string>,          // normKey()'d district keys allowed
 *     districts:   [{ key, name }],       // display list for scoped users
 *     role:        string,
 *   }
 */
const buildGeoScope = async (user) => {
  const scope = buildScope(user);

  if (scope.canSeeAll) {
    return {
      canSeeAll: true,
      level: 'state',
      districtKeys: new Set(),
      districts: [],
      role: scope.role,
    };
  }

  if (!scope.constituencies.length) {
    // Scoped role with no constituency assigned yet — deny everything,
    // consistent with constituencyFilter()'s "no seats → match nothing".
    return {
      canSeeAll: false,
      level: 'district',
      districtKeys: new Set(),
      districts: [],
      role: scope.role,
    };
  }

  const acKeys = scope.constituencies.map(ConstituencyMaster.normKey);
  const masters = await ConstituencyMaster
    .find({ ac_key: { $in: acKeys } })
    .select('district district_key')
    .lean();

  const districtMap = new Map();
  masters.forEach((m) => {
    if (m.district_key && m.district) districtMap.set(m.district_key, m.district);
  });

  return {
    canSeeAll: false,
    level: 'district',
    districtKeys: new Set(districtMap.keys()),
    districts: Array.from(districtMap.entries()).map(([key, name]) => ({ key, name })),
    role: scope.role,
  };
};

const loadGeoScope = async (req, res, next) => {
  try {
    req.geoScope = await buildGeoScope(req.user);
    next();
  } catch (error) {
    console.error('[geoScope] failed to build scope:', error.message);
    res.status(500).json({ message: 'Failed to resolve geographic scope' });
  }
};

module.exports = {
  loadScope,
  buildScope,
  isScopedUser,
  resolveScopeAssignment,
  resolveConstituencyName,
  resolveLokSabhaName,
  requireConstituencyAccess,
  constituencyFilter,
  mergeFilter,
  sourceScopeFilter,
  normalizeScopeKey: normalizeKey,
  buildGeoScope,
  loadGeoScope,
};
