const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * GrievanceSettings Model
 * Stores configuration settings for the Grievances module
 */
const grievanceSettingsSchema = new mongoose.Schema({
  id: {
    type: String,
    default: 'grievance_settings',
    unique: true
  },
  // Maximum number of government accounts allowed
  max_sources: {
    type: Number,
    default: 5
  },
  // Auto-fetch interval in minutes
  fetch_interval_minutes: {
    type: Number,
    default: 15
  },
  // Pre-configured official contact numbers for sharing
  official_contacts: [{
    name: { type: String },
    designation: { type: String },
    phone_number: { type: String },
    whatsapp_enabled: { type: Boolean, default: true }
  }],
  // Enable/disable automatic fetching
  auto_fetch_enabled: {
    type: Boolean,
    default: true
  },
  // Enable/disable AI analysis for grievances
  ai_analysis_enabled: {
    type: Boolean,
    default: true
  },
  // Default priority for new grievances
  default_priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  // Report template settings
  report_settings: {
    include_media: { type: Boolean, default: true },
    include_engagement_stats: { type: Boolean, default: true },
    header_text: { type: String, default: 'OFFICIAL GRIEVANCE REPORT' },
    footer_text: { type: String, default: 'This is a system-generated report.' }
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
  updated_by: {
    type: String
  }
});

// Pre-save middleware
grievanceSettingsSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model('GrievanceSettings', grievanceSettingsSchema);
