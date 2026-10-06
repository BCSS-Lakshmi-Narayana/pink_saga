const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { hasAnyRole, normalizeRole } = require('../utils/authIdentity');
const { buildScope } = require('./scopeMiddleware');
const { getJwtSecret } = require('../config/jwtSecret');

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, getJwtSecret());

      // Get user from the token
      req.user = await User.findOne({ id: decoded.user_id }).select('-password');

      if (!req.user) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }
      // Legacy role values (e.g. 'nara_lokesh' from the AP deployment) are
      // mapped to their current names, so every role check downstream sees one
      // vocabulary and a later save() passes the enum.
      req.user.role = normalizeRole(req.user.role);

      req.scope = buildScope(req.user);

      next();
    } catch (error) {
      console.error(error);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!hasAnyRole(req.user.role, roles)) {
      return res.status(403).json({ 
        message: `User role ${req.user.role} is not authorized to access this route`
      });
    }
    next();
  };
};

module.exports = { protect, authorize };
