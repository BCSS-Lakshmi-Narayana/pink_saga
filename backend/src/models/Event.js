const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const eventKeywordSchema = new mongoose.Schema(
  {
    keyword: { type: String, required: true },
    language: {
      type: String,
      enum: ['en', 'te', 'ur', 'hi', 'all'],
      default: 'all'
    }
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  start_date: {
    type: Date,
    required: false,
    default: null
  },
  end_date: {
    type: Date,
    required: false,
    default: null
  },
  location: {
    type: String,
    default: ''
  },
  keywords: {
    type: [eventKeywordSchema],
    default: []
  },
  platforms: {
    type: [String],
    enum: ['youtube', 'x', 'instagram', 'facebook'],
    default: ['youtube', 'x']
  },

  // Event-specific overrides
  high_risk_threshold: { type: Number },
  medium_risk_threshold: { type: Number },
  polling_interval_minutes: { type: Number },

  status: {
    type: String,
    enum: ['planned', 'active', 'archived', 'paused'],
    default: 'paused'
  },
  auto_archive: {
    type: Boolean,
    default: false
  },

  last_polled_at: {
    type: Date
  },

  created_by: {
    type: String,
    default: 'system'
  },
  // Track auto-created events from Master Calendar
  origin: {
    type: String,
    enum: ['manual', 'master_calendar'],
    default: 'manual'
  },
  origin_calendar_id: {
    type: String,
    default: null
  },
  origin_year: {
    type: Number,
    default: null
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
  archived_at: {
    type: Date
  },
  report_pdf_url: {
    type: String,
    default: null
  }
});

eventSchema.virtual('is_active_now').get(function () {
  const now = new Date();
  if (this.status === 'archived' || this.status === 'paused') return false;
  return now >= this.start_date && now <= this.end_date;
});

eventSchema.set('toJSON', { virtuals: true });

eventSchema.index({ start_date: 1, end_date: 1 });
eventSchema.index({ origin: 1, origin_calendar_id: 1, origin_year: 1 });

eventSchema.pre('save', function (next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model('Event', eventSchema);
