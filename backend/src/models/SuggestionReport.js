const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * SuggestionReport Model
 * Stores "S" (Suggestion) classification data from Grievance posts
 * Similar to Criticism flow — create report, share to contact, done
 */
const suggestionReportSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  unique_code: {
    type: String,
    unique: true,
    sparse: true
  },

  // Link back to the grievance
  grievance_id: {
    type: String,
    required: true,
    ref: 'Grievance'
  },

  // Post metadata
  platform: {
    type: String,
    enum: ['x', 'facebook', 'whatsapp'],
    default: 'x'
  },
  profile_id: { type: String },
  profile_link: { type: String },
  post_link: { type: String },
  post_date: { type: Date },
  post_description: { type: String },

  // Author info
  posted_by: {
    handle: { type: String },
    display_name: { type: String },
    profile_image_url: { type: String }
  },

  // Engagement
  engagement: {
    views: { type: Number, default: 0 },
    reposts: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    replies: { type: Number, default: 0 }
  },

  // Media S3 URLs
  media_urls: [{ type: String }],
  media_s3_urls: [{ type: String }],

  // Category (police-relevant suggestions)
  category: {
    type: String,
    enum: [
      'Cyber crimes', 'E-Challan', 'L&O', 'Others', 'She Team', 'Task force', 'Traffic'
    ],
    default: 'Others'
  },

  // Remarks entered in popup
  remarks: { type: String },

  // Full message that was composed in the popup
  message: { type: String },

  // Contact to whom it was shared
  informed_to: {
    name: { type: String },
    phone: { type: String },
    department: { type: String }
  },

  // Tracking
  action_taken_at: { type: Date },
  shared_at: { type: Date },
  shared_via: {
    type: String,
    enum: ['whatsapp', 'manual', null],
    default: null
  },
  report_pdf_url: { type: String, default: null },
  report_pdf_generated_at: { type: Date, default: null },

  // Who created this
  created_by: {
    user_id: { type: String },
    email: { type: String },
    name: { type: String }
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'suggestion_reports'
});

suggestionReportSchema.index({ grievance_id: 1 });
suggestionReportSchema.index({ unique_code: 1 });
suggestionReportSchema.index({ created_at: -1 });
suggestionReportSchema.index({ platform: 1, created_at: -1 });

module.exports = mongoose.model('SuggestionReport', suggestionReportSchema);
