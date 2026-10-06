const PagePermission = require('../models/PagePermission');
const User = require('../models/User');
const { ALL_PAGES, PAGE_FEATURES } = require('../config/rbacConfig');
const { resolveScopeAssignment } = require('../middleware/scopeMiddleware');
const { normalizeRole } = require('../utils/authIdentity');

// Constituency-scoped officer roles (MLA / MP / senior leader). These accounts
// are provisioned directly (see authController.provisionScopedUser) and never
// get a PagePermission doc unless a superadmin customizes one later — so
// their default, until customized, should mirror full officer access rather
// than the single-page fallback used for freshly self-registered accounts.
const SCOPED_ROLES = new Set(['mla', 'mp', 'senior_leader']);

const PAGE_PATHS = new Set(ALL_PAGES.map((page) => page.path));
const FEATURE_IDS_BY_PAGE = Object.fromEntries(
  Object.entries(PAGE_FEATURES).map(([path, features]) => [path, new Set(features.map((feature) => feature.id))])
);

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

// Pages a scoped officer (mla/mp/senior_leader) must always be able to reach,
// regardless of what an existing custom PagePermission doc says. Login always
// redirects to /state-map and /mla is the officer's own profile —
// an account provisioned (or last edited) before these pages existed would
// otherwise never gain them, since a stored doc simply missing a key is not
// the same as the "no doc at all" default-permissions fallback above.
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

const normalizePermissionsForRead = (rawPermissions = {}, { fillMissingFeatures = false } = {}) => {
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

const validateAndNormalizePermissions = (rawPermissions = {}) => {
  const sanitized = {};
  const errors = [];

  Object.entries(rawPermissions || {}).forEach(([rawPagePath, rawPermission]) => {
    const pagePath = normalizePath(rawPagePath);
    if (!PAGE_PATHS.has(pagePath)) {
      errors.push(`Invalid page path: ${rawPagePath}`);
      return;
    }

    if (!rawPermission || typeof rawPermission !== 'object') {
      errors.push(`Invalid permission object for ${pagePath}`);
      return;
    }

    const enabled = Boolean(rawPermission.enabled);
    const featureSet = FEATURE_IDS_BY_PAGE[pagePath];
    let features = uniqueStrings(rawPermission.features);

    if (featureSet && featureSet.size > 0) {
      const invalidFeatures = features.filter((featureId) => !featureSet.has(featureId));
      if (invalidFeatures.length > 0) {
        errors.push(`Invalid feature ids for ${pagePath}: ${invalidFeatures.join(', ')}`);
      }
      features = features.filter((featureId) => featureSet.has(featureId));
      if (enabled && features.length === 0) {
        errors.push(`At least one feature must be enabled for ${pagePath}`);
      }
    } else {
      if (features.length > 0) {
        errors.push(`Page ${pagePath} does not support feature-level permissions`);
      }
      features = [];
    }

    sanitized[pagePath] = { enabled, features };
  });

  return { sanitized, errors };
};

const enabledPagesFromPermissions = (permissions = {}) => (
  Object.entries(permissions)
    .filter(([, permission]) => permission?.enabled)
    .map(([pagePath]) => pagePath)
);

// @access  Private (superadmin only)
const getAllPages = async (req, res) => {
  try {
    const pagesWithFeatures = ALL_PAGES.map((page) => ({
      ...page,
      features: PAGE_FEATURES[page.path] || []
    }));
    res.json(pagesWithFeatures);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all users (for admin dropdown)
// @route   GET /api/rbac/users
// @access  Private (superadmin only)
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({})
      .select('id email full_name role is_active is_scoped assigned_constituency assigned_lok_sabha extra_constituencies')
      .sort({ full_name: 1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get permissions for a specific user
// @route   GET /api/rbac/permissions/:userId
// @access  Private (superadmin only)
const getUserPermissions = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const permissionDoc = await PagePermission.findOne({ user_id: userId });

    if (!permissionDoc) {
      const defaultPermissions = buildDefaultPermissions(user.role);
      return res.json({
        user_id: userId,
        allowed_pages: enabledPagesFromPermissions(defaultPermissions),
        permissions: defaultPermissions,
        has_custom_permissions: false
      });
    }

    const permissions = withScopedBaseline(
      permissionDoc.permissions
        ? normalizePermissionsForRead(permissionDoc.permissions, { fillMissingFeatures: true })
        : buildPermissionsFromAllowedPages(permissionDoc.allowed_pages || []),
      user.role
    );

    res.json({
      user_id: userId,
      allowed_pages: enabledPagesFromPermissions(permissions),
      permissions,
      has_custom_permissions: true,
      updated_by: permissionDoc.updated_by,
      updated_at: permissionDoc.updated_at
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Set/update permissions for a specific user
// @route   PUT /api/rbac/permissions/:userId
// @access  Private (superadmin only)
const updateUserPermissions = async (req, res) => {
  try {
    const { userId } = req.params;
    const { permissions } = req.body;

    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
      return res.status(400).json({ message: 'permissions must be an object' });
    }

    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'superadmin') {
      return res.status(403).json({ message: 'Cannot modify superadmin permissions' });
    }

    const { sanitized, errors } = validateAndNormalizePermissions(permissions);
    if (errors.length > 0) {
      return res.status(400).json({
        message: 'Invalid permissions payload',
        errors
      });
    }

    const allowedPages = enabledPagesFromPermissions(sanitized);

    const permissionDoc = await PagePermission.findOneAndUpdate(
      { user_id: userId },
      {
        user_id: userId,
        allowed_pages: allowedPages,
        permissions: sanitized,
        updated_by: req.user.id,
        updated_at: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      message: 'Permissions updated successfully',
      user_id: userId,
      allowed_pages: permissionDoc.allowed_pages,
      permissions: permissionDoc.permissions,
      has_custom_permissions: true,
      updated_by: permissionDoc.updated_by,
      updated_at: permissionDoc.updated_at
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get permissions for the currently logged-in user
// @route   GET /api/rbac/my-permissions
// @access  Private
const getMyPermissions = async (req, res) => {
  try {
    if (req.user.role === 'superadmin') {
      const permissions = buildSuperAdminPermissions();
      return res.json({
        allowed_pages: enabledPagesFromPermissions(permissions),
        permissions,
        is_super_admin: true
      });
    }

    const permissionDoc = await PagePermission.findOne({ user_id: req.user.id });
    if (!permissionDoc) {
      const defaultPermissions = buildDefaultPermissions(req.user.role);
      return res.json({
        allowed_pages: enabledPagesFromPermissions(defaultPermissions),
        permissions: defaultPermissions,
        has_custom_permissions: false
      });
    }

    let permissions = permissionDoc.permissions
      ? normalizePermissionsForRead(permissionDoc.permissions, { fillMissingFeatures: true })
      : buildPermissionsFromAllowedPages(permissionDoc.allowed_pages || []);

    if (Object.keys(permissions).length === 0) {
      permissions = buildDefaultPermissions(req.user.role);
    }
    permissions = withScopedBaseline(permissions, req.user.role);

    res.json({
      allowed_pages: enabledPagesFromPermissions(permissions),
      permissions,
      has_custom_permissions: true
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update user details (name, email, role, password)
// @route   PUT /api/rbac/users/:userId
// @access  Private (superadmin only)
const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { full_name, email, role, password } = req.body;

    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent downgrading the last superadmin (basic safeguard). Only when the
    // payload actually changes the role: renaming the sole superadmin, or
    // changing their email/password, must still work.
    if (user.role === 'superadmin' && role !== undefined && normalizeRole(role) !== 'superadmin') {
      const superAdminCount = await User.countDocuments({ role: 'superadmin' });
      if (superAdminCount <= 1) {
        return res.status(400).json({ message: 'Cannot change the role of the last superadmin' });
      }
    }

    user.full_name = full_name || user.full_name;
    user.email = email || user.email;
    user.role = role ? normalizeRole(role) : user.role;

    // Scope assignment is only rewritten when the payload actually carries it,
    // so callers that just rename a user don't accidentally clear their seats.
    if ('is_scoped' in req.body || 'constituencies' in req.body) {
      const { value: scope, error: scopeError } = resolveScopeAssignment(req.body, { role: user.role });
      if (scopeError) {
        return res.status(400).json({ message: scopeError });
      }
      Object.assign(user, scope);
    }

    // Only update password if provided
    if (password && password.trim() !== '') {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }

    await user.save();

    res.json({
      message: 'User updated successfully',
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        is_scoped: user.is_scoped,
        assigned_constituency: user.assigned_constituency,
        assigned_lok_sabha: user.assigned_lok_sabha,
        extra_constituencies: user.extra_constituencies
      }
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a user
// @route   DELETE /api/rbac/users/:userId
// @access  Private (superadmin only)
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'superadmin') {
      const superAdminCount = await User.countDocuments({ role: 'superadmin' });
      if (superAdminCount <= 1) {
        return res.status(400).json({ message: 'Cannot delete the last superadmin' });
      }
    }

    // Prevent self-deletion
    if (user.id === req.user.id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    await User.findOneAndDelete({ id: userId });

    // Cleanup related permissions
    await PagePermission.findOneAndDelete({ user_id: userId });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


module.exports = {
  getAllPages,
  getAllUsers,
  getUserPermissions,
  updateUserPermissions,
  getMyPermissions,
  updateUser,
  deleteUser,
  ALL_PAGES,
  PAGE_FEATURES
};
