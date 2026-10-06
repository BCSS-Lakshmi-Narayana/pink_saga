const AuditLog = require('../models/AuditLog');

const createAuditLog = async (user, action, resourceType, resourceId = null, details = null) => {
  try {
    await AuditLog.create({
      user_id: user.id,
      user_email: user.email,
      user_name: user.full_name || user.name || user.email,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details: details || {}
    });
  } catch (error) {
    console.error(`Failed to create audit log: ${error.message}`);
  }
};

module.exports = { createAuditLog };
