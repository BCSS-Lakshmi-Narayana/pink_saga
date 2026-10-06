const PagePermission = require('../models/PagePermission');
const { ALL_PAGES, PAGE_FEATURES } = require('../config/rbacConfig');

// Keep in sync with rbacController.js — constituency-scoped officer roles
// (MLA / MP / senior leader) default to full page access until a superadmin
// customizes their permissions, instead of the single-page fallback used
// for freshly self-registered accounts.
const SCOPED_ROLES = new Set(['mla', 'mp', 'senior_leader']);

const PAGE_PATHS = new Set(ALL_PAGES.map((page) => page.path));
const FEATURE_IDS_BY_PAGE = Object.fromEntries(
  Object.entries(PAGE_FEATURES).map(([pagePath, features]) => [pagePath, new Set(features.map((feature) => feature.id))])
);

const MONITOR_PLATFORM_TO_FEATURE = {
  x: 'x',
  twitter: 'x',
  facebook: 'facebook',
  instagram: 'instagram',
  youtube: 'youtube'
};

const normalizePath = (value) => {
  if (!value || typeof value !== 'string') return '/';
  const path = value.replace(/\/+$/, '') || '/';
  return path.startsWith('/') ? path : `/${path}`;
};

const uniqueStrings = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === 'string'))];
};

const buildPermissionsFromAllowedPages = (allowedPages = []) => {
  const permissions = {};
  uniqueStrings(allowedPages).forEach((rawPath) => {
    const pagePath = normalizePath(rawPath);
    if (!PAGE_PATHS.has(pagePath)) return;
    const featureIds = PAGE_FEATURES[pagePath]?.map((feature) => feature.id) || [];
    permissions[pagePath] = { enabled: true, features: featureIds };
  });
  return permissions;
};

const buildFullPermissions = () => {
  const permissions = {};
  ALL_PAGES.forEach((page) => {
    if (page.path === '/access-management') return;
    permissions[page.path] = {
      enabled: true,
      features: PAGE_FEATURES[page.path]?.map((feature) => feature.id) || []
    };
  });
  return permissions;
};

const buildDefaultPermissions = (role) => (
  SCOPED_ROLES.has(role)
    ? buildFullPermissions()
    : { '/dashboard': { enabled: true, features: [] } }
);

// Keep in sync with rbacController.js — pages a scoped officer must always
// be able to reach regardless of what an existing custom PagePermission doc
// says (see rbacController.js for the full rationale).
const SCOPED_BASELINE_PAGES = ['/dashboard', '/state-map', '/mla', '/unrest-predictor'];

const withScopedBaseline = (permissions, role) => {
  if (!SCOPED_ROLES.has(role)) return permissions;
  SCOPED_BASELINE_PAGES.forEach((path) => {
    if (!PAGE_PATHS.has(path)) return;
    permissions[path] = {
      enabled: true,
      features: PAGE_FEATURES[path]?.map((feature) => feature.id) || []
    };
  });
  return permissions;
};

const buildSuperAdminPermissions = () => {
  const permissions = {};
  ALL_PAGES.forEach((page) => {
    permissions[page.path] = {
      enabled: true,
      features: PAGE_FEATURES[page.path]?.map((feature) => feature.id) || []
    };
  });
  return permissions;
};

const normalizePermissions = (rawPermissions = {}, { fillMissingFeatures = false } = {}) => {
  const permissions = {};
  Object.entries(rawPermissions || {}).forEach(([rawPagePath, rawPermission]) => {
    const pagePath = normalizePath(rawPagePath);
    if (!PAGE_PATHS.has(pagePath)) return;

    const enabled = Boolean(rawPermission?.enabled);
    const featureSet = FEATURE_IDS_BY_PAGE[pagePath];
    let features = uniqueStrings(rawPermission?.features);

    if (featureSet && featureSet.size > 0) {
      features = features.filter((featureId) => featureSet.has(featureId));
      if (enabled && fillMissingFeatures && features.length === 0) {
        features = [...featureSet];
      }
    } else {
      features = [];
    }

    permissions[pagePath] = { enabled, features };
  });
  return permissions;
};

const enabledPagesFromPermissions = (permissions = {}) => (
  Object.entries(permissions)
    .filter(([, permission]) => permission?.enabled)
    .map(([pagePath]) => pagePath)
);

const denyPageAccess = (res, requiredPages = []) => res.status(403).json({
  code: 'RBAC_PAGE_DENIED',
  message: 'You do not have access to this module',
  required_pages: requiredPages
});

const denyFeatureAccess = (res, pagePath, featureId) => res.status(403).json({
  code: 'RBAC_FEATURE_DENIED',
  message: 'You do not have access to this feature',
  page: pagePath,
  feature: featureId
});

const ensureRbacLoaded = async (req) => {
  if (req.rbac) return req.rbac;

  if (!req.user) {
    const error = new Error('Not authorized');
    error.status = 401;
    throw error;
  }

  if (req.user.role === 'superadmin') {
    const permissions = buildSuperAdminPermissions();
    req.rbac = {
      isSuperAdmin: true,
      permissions,
      allowedPages: enabledPagesFromPermissions(permissions)
    };
    return req.rbac;
  }

  const permissionDoc = await PagePermission.findOne({ user_id: req.user.id });
  let permissions;

  if (!permissionDoc) {
    permissions = buildDefaultPermissions(req.user.role);
  } else {
    permissions = permissionDoc.permissions
      ? normalizePermissions(permissionDoc.permissions, { fillMissingFeatures: true })
      : buildPermissionsFromAllowedPages(permissionDoc.allowed_pages || []);

    if (Object.keys(permissions).length === 0) {
      permissions = buildDefaultPermissions(req.user.role);
    }
  }

  permissions = withScopedBaseline(permissions, req.user.role);

  req.rbac = {
    isSuperAdmin: false,
    permissions,
    allowedPages: enabledPagesFromPermissions(permissions)
  };

  return req.rbac;
};

const loadUserPermissions = async (req, res, next) => {
  try {
    await ensureRbacLoaded(req);
    next();
  } catch (error) {
    if (error.status === 401) {
      return res.status(401).json({ message: 'Not authorized' });
    }
    return res.status(500).json({ message: 'Failed to load RBAC permissions' });
  }
};

const hasPageAccess = (req, pagePath) => {
  if (req.rbac?.isSuperAdmin) return true;
  const normalizedPagePath = normalizePath(pagePath);
  return Boolean(req.rbac?.permissions?.[normalizedPagePath]?.enabled);
};

const hasFeatureAccess = (req, pagePath, featureId) => {
  if (req.rbac?.isSuperAdmin) return true;

  const normalizedPagePath = normalizePath(pagePath);
  const pagePermission = req.rbac?.permissions?.[normalizedPagePath];
  if (!pagePermission?.enabled) return false;

  const featureSet = FEATURE_IDS_BY_PAGE[normalizedPagePath];
  if (!featureSet || featureSet.size === 0) return true;
  if (!featureId || typeof featureId !== 'string') return false;

  return Array.isArray(pagePermission.features) && pagePermission.features.includes(featureId);
};

const resolveValue = (resolver, req) => {
  if (typeof resolver === 'function') return resolver(req);
  return resolver;
};

const requireAnyPageAccess = (allowedPages = []) => async (req, res, next) => {
  try {
    await ensureRbacLoaded(req);
  } catch (error) {
    if (error.status === 401) return res.status(401).json({ message: 'Not authorized' });
    return res.status(500).json({ message: 'Failed to evaluate RBAC permissions' });
  }

  if (req.rbac.isSuperAdmin) return next();
  if (allowedPages.some((pagePath) => hasPageAccess(req, pagePath))) return next();

  return denyPageAccess(res, allowedPages);
};

const requireFeatureAccess = (pagePath, featureResolver, options = {}) => async (req, res, next) => {
  try {
    await ensureRbacLoaded(req);
  } catch (error) {
    if (error.status === 401) return res.status(401).json({ message: 'Not authorized' });
    return res.status(500).json({ message: 'Failed to evaluate RBAC permissions' });
  }

  if (req.rbac.isSuperAdmin) return next();
  if (!hasPageAccess(req, pagePath)) return denyPageAccess(res, [pagePath]);

  let featureId = resolveValue(featureResolver, req);
  if (featureId === null || typeof featureId === 'undefined' || featureId === '') {
    if (options.allowWhenMissing) return next();
    return denyFeatureAccess(res, pagePath, 'unknown');
  }

  featureId = String(featureId).toLowerCase();
  if (options.aliases && options.aliases[featureId]) {
    featureId = options.aliases[featureId];
  }

  if (hasFeatureAccess(req, pagePath, featureId)) return next();
  return denyFeatureAccess(res, pagePath, featureId);
};

const requirePlatformFeatureAccess = (pagePath, platformResolver) => async (req, res, next) => {
  try {
    await ensureRbacLoaded(req);
  } catch (error) {
    if (error.status === 401) return res.status(401).json({ message: 'Not authorized' });
    return res.status(500).json({ message: 'Failed to evaluate RBAC permissions' });
  }

  if (req.rbac.isSuperAdmin) return next();

  const rawPlatform = resolveValue(platformResolver, req);
  if (!rawPlatform || typeof rawPlatform !== 'string') return next();

  const normalizedPlatform = rawPlatform.toLowerCase();
  const featureId = MONITOR_PLATFORM_TO_FEATURE[normalizedPlatform];
  if (!featureId) return next();

  if (hasFeatureAccess(req, pagePath, featureId)) return next();

  return denyFeatureAccess(res, pagePath, featureId);
};

module.exports = {
  loadUserPermissions,
  requireAnyPageAccess,
  requireFeatureAccess,
  requirePlatformFeatureAccess,
  hasPageAccess,
  hasFeatureAccess,
  denyPageAccess,
  denyFeatureAccess
};
