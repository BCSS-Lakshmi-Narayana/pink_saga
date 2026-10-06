const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * QueryReport Model
 * Stores "Q" (Query) workflow classification data
 * Status lifecycle: PENDING → CLOSED (no escalation)
 */
const queryReportSchema = new mongoose.Schema({
  id: { type: String, default: uuidv4, unique: true },
  unique_code: { type: String, unique: true, sparse: true },

  /* ── Link back to original grievance ── */
  grievance_id: { type: String, required: true, ref: 'Grievance' },

  /* ── Post metadata ── */
  platform: { type: String, enum: ['x', 'facebook', 'whatsapp'], default: 'x' },
  profile_id: { type: String },
  profile_link: { type: String },
  post_link: { type: String },
  post_date: { type: Date },
  post_description: { type: String },

  /* ── Author ── */
  posted_by: {
    handle: { type: String },
    display_name: { type: String },
    profile_image_url: { type: String }
  },

  /* ── Engagement ── */
  engagement: {
    views: { type: Number, default: 0 },
    reposts: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    replies: { type: Number, default: 0 }
  },

  /* ── Complaint phone ── */
  complaint_phone: { type: String, default: '' },

  /* ── Category (police-relevant) ── */
  category: {
    type: String,
    enum: [
      'Cyber crimes', 'E-Challan', 'L&O', 'Others', 'She Team', 'Task force', 'Traffic'
    ],
    default: 'Others'
  },

  /* ── Media ── */
  media_urls: [{ type: String }],
  media_s3_urls: [{ type: String }],

  /* ── Operator remarks / full message ── */
  remarks: { type: String },
  message: { type: String },

  /* ── Contact who it was shared to ── */
  informed_to: {
    name: { type: String },
    phone: { type: String },
    department: { type: String }
  },

  /* ── Status lifecycle (PENDING → CLOSED only) ── */
  status: {
    type: String,
    enum: ['PENDING', 'CLOSED'],
    default: 'PENDING'
  },

  /* ── Operator reply to user ── */
  operator_reply: { type: String, default: '' },
  final_reply_to_user: { type: String, default: '' },

  /* ── Closing ── */
  closing_remarks: { type: String, default: '' },
  closing_media_urls: [{ type: String }],
  closing_media_s3_urls: [{ type: String }],

  /* ── Tracking timestamps ── */
  action_taken_at: { type: Date },
  closed_at: { type: Date },
  shared_at: { type: Date },
  shared_via: { type: String, enum: ['whatsapp', 'manual', null], default: null },
  report_pdf_url: { type: String, default: null },
  report_pdf_generated_at: { type: Date, default: null },

  /* ── Audit trail ── */
  status_history: [{
    from_status: { type: String },
    to_status: { type: String },
    changed_by: {
      user_id: { type: String },
      email: { type: String },
      name: { type: String }
    },
    note: { type: String },
    timestamp: { type: Date, default: Date.now }
  }],

  /* ── Who created ── */
  created_by: {
    user_id: { type: String },
    email: { type: String },
    name: { type: String }
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'query_reports'
});

queryReportSchema.index({ grievance_id: 1 });
queryReportSchema.index({ unique_code: 1 });
queryReportSchema.index({ status: 1, created_at: -1 });
queryReportSchema.index({ platform: 1, created_at: -1 });

module.exports = mongoose.model('QueryReport', queryReportSchema);
