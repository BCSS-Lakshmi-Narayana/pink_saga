const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * GrievanceWorkflowReport Model
 * Stores "G" (Grievance) workflow classification data
 * Status lifecycle: PENDING → ESCALATED → CLOSED
 */
const grievanceWorkflowReportSchema = new mongoose.Schema({
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

  /* ── Category ── */
  category: {
    type: String,
    enum: [
      'Cyber crimes', 'E-Challan', 'L&O', 'Others', 'Query', 'She Team', 'Task force', 'Traffic'
    ],
    default: 'Others'
  },

  /* ── Media ── */
  media_urls: [{ type: String }],
  media_s3_urls: [{ type: String }],

  /* ── Operator remarks / full message ── */
  remarks: { type: String },
  message: { type: String },
  escalation_message: { type: String, default: '' },

  /* ── Contact who it was shared/escalated to ── */
  informed_to: {
    name: { type: String },
    phone: { type: String },
    department: { type: String }
  },

  /* ── Status lifecycle ── */
  status: {
    type: String,
    enum: ['PENDING', 'ESCALATED', 'CLOSED'],
    default: 'PENDING'
  },

  /* ── Operator reply to user ── */
  operator_reply: { type: String, default: '' },
  final_reply_to_user: { type: String, default: '' },

  /* ── Closing ── */
  closing_remarks: { type: String, default: '' },
  closing_media_urls: [{ type: String }],
  closing_media_s3_urls: [{ type: String }],
  final_communication: { type: String, default: '' },

  /* ── FIR ── */
  fir_status: { type: String, default: '' }, // 'Yes' | 'No'
  fir_number: { type: String, default: '' },

  /* ── Tracking timestamps ── */
  action_taken_at: { type: Date },
  escalated_at: { type: Date },
  closed_at: { type: Date },
  shared_at: { type: Date },
  shared_via: { type: String, enum: ['whatsapp', 'manual', null], default: null },

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

  /* ── Complainant conversation log ── */
  complainant_logs: [{
    type: { type: String, enum: ['User', 'Operator', 'OperatorRemark'], required: true },
    mode: {
      type: String,
      enum: ['X POST', 'X DM', 'WHATSAPP CALL', 'WHATSAPP DM', 'FB POST', 'INTERNAL'],
      required: true
    },
    content: { type: String, required: true },
    operator: {
      user_id: { type: String },
      email: { type: String },
      name: { type: String }
    },
    timestamp: { type: Date, default: Date.now },
    locked: { type: Boolean, default: false }
  }],

  /* ── Officer communication log ── */
  officer_logs: [{
    type: { type: String, enum: ['Operator', 'Officer'], default: 'Operator' },
    mode: {
      type: String,
      enum: ['WHATSAPP CALL', 'WHATSAPP MSG', 'PHONE CALL', 'X POST', 'X DM', 'WHATSAPP DM', 'FB POST'],
      required: true
    },
    content: { type: String, required: true },
    is_escalation: { type: Boolean, default: false },
    operator: {
      user_id: { type: String },
      email: { type: String },
      name: { type: String }
    },
    recipient: {
      name: { type: String },
      phone: { type: String }
    },
    timestamp: { type: Date, default: Date.now }
  }],

  /* ── Who created ── */
  created_by: {
    user_id: { type: String },
    email: { type: String },
    name: { type: String }
  },

  /* ── Generated PDF ── */
  report_pdf_url: { type: String, default: null },
  report_pdf_generated_at: { type: Date, default: null }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'grievance_workflow_reports'
});

grievanceWorkflowReportSchema.index({ grievance_id: 1 });
grievanceWorkflowReportSchema.index({ unique_code: 1 });
grievanceWorkflowReportSchema.index({ status: 1, created_at: -1 });
grievanceWorkflowReportSchema.index({ platform: 1, created_at: -1 });

module.exports = mongoose.model('GrievanceWorkflowReport', grievanceWorkflowReportSchema);
