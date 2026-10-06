const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const sourceSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  platform: {
    type: String,
    enum: ['youtube', 'x', 'instagram', 'facebook'],
    required: true
  },
  identifier: {
    type: String,
    required: true
  },
  display_name: {
    type: String,
    required: true
  },
  profile_image_url: {
    type: String
  },
  category: {
    type: String,
    default: 'unknown'
  },
  // RBAC scope: which AC owns this tracked account. Null = party-wide
  // (visible to super admin and all scoped users).
  constituency: {
    type: String,
    default: null,
    trim: true
  },
  is_party_wide: {
    type: Boolean,
    default: false
  },
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  is_active: {
    type: Boolean,
    default: true
  },
  is_verified: {
    type: Boolean,
    default: false
  },
  created_by: {
    type: String,
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  risk_level: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'low'
  },
  last_checked: {
    type: Date
  },
  follower_count: {
    type: String,
    default: ''
  },
  joined_date: {
    type: String,
    default: ''
  },
  // YouTube Specific Metadata
  youtube_metadata: {
    upload_playlist_id: String,
    channel_branding_settings: mongoose.Schema.Types.Mixed,
    default_language: String,
    country: String
  },
  // Statistics Tracking
  statistics: {
    subscriber_count: { type: Number, default: 0 },
    video_count: { type: Number, default: 0 },
    view_count: { type: Number, default: 0 },
    hidden_subscriber_count: { type: Boolean, default: false }
  },
  // Historic Stats for Growth Tracking
  history: [{
    date: { type: Date, default: Date.now },
    subscriber_count: Number,
    video_count: Number,
    view_count: Number
  }]
});

// Compound index to prevent duplicates
sourceSchema.index({ platform: 1, identifier: 1 }, { unique: true });
sourceSchema.index({ id: 1 }); // Used by alert $lookup pipelines
sourceSchema.index({ category: 1 }); // Used by source category filter
sourceSchema.index({ created_at: -1 }); // Default sort for getSources
sourceSchema.index({ is_active: 1, created_at: -1 }); // is_active filter + default sort
sourceSchema.index({ platform: 1, created_at: -1 }); // platform filter + default sort
sourceSchema.index({ constituency: 1 }, { sparse: true }); // scope filter

module.exports = mongoose.model('Source', sourceSchema);
