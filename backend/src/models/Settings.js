const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  id: {
    type: String,
    default: 'global_settings',
    unique: true
  },
  // UI compatibility fields (kept in sync in controller)
  risk_threshold_high: {
    type: Number,
    default: 70
  },
  risk_threshold_medium: {
    type: Number,
    default: 40
  },
  monitoring_interval_minutes: {
    type: Number,
    default: 5
  },
  high_risk_threshold: {
    type: Number,
    default: 70
  },
  medium_risk_threshold: {
    type: Number,
    default: 40
  },
  enable_email_alerts: {
    type: Boolean,
    default: true
  },
  // Velocity-based alerting settings
  velocity_alerts_enabled: {
    type: Boolean,
    default: true
  },
  alert_for_every_post: {
    type: Boolean,
    default: false
  },
  alert_emails: [{
    type: String
  }],
  youtube_api_key: { type: String },
  x_bearer_token: { type: String },
  facebook_access_token: { type: String },
  // RapidAPI key used for certain integrations (e.g., Facebook scraper, X via RapidAPI)
  rapidapi_key: { type: String },
  // Instagram-specific RapidAPI configuration (single-key mode; legacy multi-key field retained)
  rapidapi_instagram_key: { type: String },
  rapidapi_instagram_keys: { type: String },
  rapidapi_instagram_host: { type: String },
  telegram_session: { type: String },

  // ─── API Configuration (per-module, per-platform intervals in minutes) ───
  api_config: {
    monitoring: {
      enabled: { type: Boolean, default: true },
      // Category × Platform frequency matrix (values in minutes)
      // Each platform key holds an object with category keys → interval in minutes
      frequencies: {
        x: {
          political: { type: Number, default: 60 },
          communal: { type: Number, default: 60 },
          trouble_makers: { type: Number, default: 60 },
          defamation: { type: Number, default: 60 },
          narcotics: { type: Number, default: 60 },
          history_sheeters: { type: Number, default: 60 },
          others: { type: Number, default: 60 }
        },
        instagram: {
          political: { type: Number, default: 60 },
          communal: { type: Number, default: 60 },
          trouble_makers: { type: Number, default: 60 },
          defamation: { type: Number, default: 60 },
          narcotics: { type: Number, default: 60 },
          history_sheeters: { type: Number, default: 60 },
          others: { type: Number, default: 60 }
        },
        facebook: {
          political: { type: Number, default: 60 },
          communal: { type: Number, default: 60 },
          trouble_makers: { type: Number, default: 60 },
          defamation: { type: Number, default: 60 },
          narcotics: { type: Number, default: 60 },
          history_sheeters: { type: Number, default: 60 },
          others: { type: Number, default: 60 }
        },
        youtube: {
          political: { type: Number, default: 60 },
          communal: { type: Number, default: 60 },
          trouble_makers: { type: Number, default: 60 },
          defamation: { type: Number, default: 60 },
          narcotics: { type: Number, default: 60 },
          history_sheeters: { type: Number, default: 60 },
          others: { type: Number, default: 60 }
        }
      }
    },
    events: {
      x: { type: Number, default: 60 },
      instagram: { type: Number, default: 60 },
      facebook: { type: Number, default: 60 },
      youtube: { type: Number, default: 60 },
      enabled: { type: Boolean, default: true }
    },
    grievances: {
      x: { type: Number, default: 60 },
      facebook: { type: Number, default: 60 },
      enabled: { type: Boolean, default: true }
    },
    telegram: {
      sync_interval: { type: Number, default: 5 },
      enabled: { type: Boolean, default: true }
    }
  },

  // Custom Threat Keywords for AI Model
  threat_keywords: [{
    category: { type: String, required: true },
    keyword: { type: String, required: true }
  }],

  smtp_config: {
    host: { type: String },
    port: { type: Number },
    username: { type: String },
    password: { type: String }
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Settings', settingsSchema);

