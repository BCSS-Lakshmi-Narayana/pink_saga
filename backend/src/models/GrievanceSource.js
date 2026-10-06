const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * GrievanceSource Model
 * Stores government X/Facebook accounts monitored for grievance intake
 * Source caps are enforced per platform in controller logic
 */
const grievanceSourceSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  // X handle (e.g., @TGPolice, @Collector_HYD) or Facebook Page/URL
  handle: {
    type: String,
    required: true
    // Unique constraint removed at field level to allow same handle on different platforms
    // Handled by application logic or compound index
  },
  // Platform: 'x' or 'facebook'
  platform: {
    type: String,
    enum: ['x', 'facebook'],
    default: 'x'
  },
  // Display name for the account
  display_name: {
    type: String,
    required: true
  },
  // Profile image URL from X
  profile_image_url: {
    type: String
  },
  // X user ID (for API calls)
  x_user_id: {
    type: String
  },
  // Is this account actively being monitored
  is_active: {
    type: Boolean,
    default: true
  },
  // Is the account verified on X
  is_verified: {
    type: Boolean,
    default: false
  },
  // Department or category of the official
  department: {
    type: String,
    default: 'General'
  },
  // Designation of the official
  designation: {
    type: String
  },
  // Contact number for sharing reports (WhatsApp)
  contact_number: {
    type: String
  },
  // Total grievances received
  total_grievances: {
    type: Number,
    default: 0
  },
  // Statistics
  stats: {
    acknowledged: { type: Number, default: 0 },
    complaints: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    resolved: { type: Number, default: 0 }
  },
  // Who added this source
  created_by: {
    type: String,
    required: true
  },
  // Last time grievances were fetched
  last_fetched: {
    type: Date
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

// Pre-save middleware to update timestamps
grievanceSourceSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

// Indexes for efficient and platform-safe lookups
grievanceSourceSchema.index({ platform: 1, handle: 1 }, { unique: true });
grievanceSourceSchema.index({ platform: 1, is_active: 1 });
grievanceSourceSchema.index({ is_active: 1 });

module.exports = mongoose.model('GrievanceSource', grievanceSourceSchema);
