const mongoose = require('mongoose');

const tempContentSchema = new mongoose.Schema({
  tenant_name: { type: String, required: true, index: true },
  module: { type: String, enum: ['profile', 'event', 'grievance', 'telegram', 'media_backfill'], required: true },
  platform: { type: String, enum: ['x', 'instagram', 'facebook', 'youtube', 'telegram'], required: true },

  source_id: { type: String, default: null },
  source_identifier: { type: String, default: null },
  source_category: { type: String, default: null },
  source_display_name: { type: String, default: null },

  event_id: { type: String, default: null },
  event_name: { type: String, default: null },
  event_keywords: { type: [String], default: [] },

  raw_data: { type: mongoose.Schema.Types.Mixed, required: true },

  status: { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  error_message: { type: String, default: null },

  created_at: { type: Date, default: Date.now },
  processed_at: { type: Date, default: null }
}, {
  timestamps: false,
  collection: 'temp_content'
});

tempContentSchema.index({ tenant_name: 1, status: 1, created_at: 1 });

module.exports = mongoose.model('TempContent', tempContentSchema);
