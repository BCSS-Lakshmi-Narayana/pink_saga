const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const auditLogSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  user_id: {
    type: String,
    required: true
  },
  user_email: {
    type: String,
    required: true
  },
  user_name: {
    type: String
  },
  action: {
    type: String,
    required: true
  },
  resource_type: {
    type: String,
    required: true
  },
  resource_id: {
    type: String
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
