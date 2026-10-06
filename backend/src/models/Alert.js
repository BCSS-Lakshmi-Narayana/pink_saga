const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const alertSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  content_id: {
    type: String,
    required: true,
    ref: 'Content'
  },
  source_id: {
    type: String,
    required: false,
    ref: 'Source'
  },
  content_ref_id: {
    type: String,
    default: null
  },
  source_category: {
    type: String,
    default: null
  },
  matched_keywords: [{
    keyword_id: { type: String },
    keyword: { type: String },
    category: { type: String },
    language: { type: String },
    weight: { type: Number }
  }],
  matched_keywords_normalized: {
    type: [String],
    default: []
  },
  event_id: {
    type: String,
    default: null
  },
  analysis_id: {
    type: String,
    ref: 'Analysis'
  },
  // Alert type classification
  alert_type: {
    type: String,
    enum: ['keyword_risk', 'ai_risk', 'velocity', 'new_post'],
    default: 'keyword_risk'
  },
  // Priority classification for velocity alerts
  priority: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH'],
    default: 'MEDIUM'
  },
  // Velocity-specific data
  velocity_data: {
    metric: { type: String },
    current_value: { type: Number },
    previous_value: { type: Number },
    velocity: { type: Number },
    time_window_minutes: { type: Number },
    threshold_triggered: { type: Number }
  },
  risk_level: {
    type: String,
    enum: ['low', 'medium', 'high'],
    required: true,
    lowercase: true
  },
  // Threat detection details for display
  threat_details: {
    intent: { type: String },           // e.g., "Violence", "Political"
    reasons: [{ type: String }],         // Array of reasons why flagged
    highlights: [{ type: String }],      // Flagged keywords/phrases
    risk_score: { type: Number },        // 0-100
    confidence: { type: Number }         // AI confidence
  },
  violated_policies: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },
  legal_sections: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },
  complaint_text: {
    type: String
  },
  classification_explanation: {
    type: String
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  content_url: {
    type: String,
    required: true
  },
  platform: {
    type: String,
    enum: ['youtube', 'x', 'instagram', 'facebook'],
    required: true
  },
  author: {
    type: String,
    required: true
  },
  author_handle: {
    type: String
  },
  status: {
    type: String,
    enum: ['active', 'acknowledged', 'resolved', 'false_positive', 'escalated', 'all'],
    default: 'active'
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  // Denormalized from Content.published_at — used as the primary sort key
  // ("posted time on platform"). Falls back to created_at when missing.
  published_at: {
    type: Date,
    default: null
  },
  acknowledged_by: {
    type: String,
    ref: 'User'
  },
  acknowledged_at: {
    type: Date
  },
  is_read: {
    type: Boolean,
    default: false
  },
  is_priority: {
    type: Boolean,
    default: false
  },
  priority_reason: {
    type: String,
    default: ''
  },
  notes: {
    type: String
  },
  is_investigation: {
    type: Boolean,
    default: false
  },
  // Side-by-side analysis results for verification
  ml_analysis: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  llm_analysis: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  /**
   * Assembly constituency this alert is about — mirrors Grievance.detected_location,
   * but is filled by constituencyLocationSweepService rather than at creation
   * time, since no alert-creation path (monitorService, velocityAlertService)
   * has ever run location detection. `attempted_at` is the completion marker
   * the sweep's pending query keys on: it is stamped on EVERY attempt, success
   * or failure, so a genuinely unplaceable alert is asked once and then left
   * alone rather than re-classified every sweep tick forever.
   */
  detected_location: {
    location_found:  { type: Boolean, default: false },
    city:             { type: String },
    district:         { type: String },
    constituency:     { type: String },
    lok_sabha:        { type: String },
    confidence:       { type: mongoose.Schema.Types.Mixed },
    source:           { type: String },   // 'person_match:<via>' | 'ap_classifier:<provider>'
    matched_token:    { type: String },
    match_source:     { type: String },
    auto_assigned:    { type: Boolean, default: false },
    attempted_at:     { type: Date, default: null },
  },
  // BSK relevance pipeline lineage — set by the former alerts → mentions
  // promotion (removed: Alerts and Mentions are now separate). Kept so older
  // records keep their history.
  bsk_pipeline: {
    processed:    { type: Boolean, default: false },
    decision:     { type: String, enum: ['promoted', 'rejected', 'skipped', null], default: null },
    grievance_id: { type: String, default: null },   // Grievance.id once promoted
    confidence:   { type: Number, default: null },
    stance:       { type: String, default: null },
    target:       { type: String, default: null },
    topic:        { type: String, default: null },
    reason:       { type: String, default: null },
    heuristic:    { type: Boolean, default: false },
    processed_at: { type: Date,   default: null }
  }
});

// Always have a sortable published_at — fall back to created_at when caller forgot.
alertSchema.pre('save', function (next) {
  if (!this.published_at) this.published_at = this.created_at || new Date();
  next();
});

// Pipeline lookup index — find unprocessed alerts fast
alertSchema.index({ 'bsk_pipeline.processed': 1, created_at: -1 });

// ─── Sort by published_at (posted time on platform) — primary sort key ───
alertSchema.index({ published_at: -1, id: -1 });
alertSchema.index({ status: 1, published_at: -1, id: -1 });
alertSchema.index({ platform: 1, published_at: -1, id: -1 });
alertSchema.index({ risk_level: 1, published_at: -1, id: -1 });
alertSchema.index({ alert_type: 1, published_at: -1, id: -1 });
alertSchema.index({ status: 1, platform: 1, published_at: -1, id: -1 });
alertSchema.index({ status: 1, alert_type: 1, published_at: -1, id: -1 });
alertSchema.index({ status: 1, risk_level: 1, published_at: -1, id: -1 });
alertSchema.index({ status: 1, source_category: 1, published_at: -1, id: -1 });
alertSchema.index({ status: 1, matched_keywords_normalized: 1, published_at: -1, id: -1 });
alertSchema.index({ status: 1, platform: 1, alert_type: 1, published_at: -1, id: -1 });
alertSchema.index({ 'llm_analysis.grievance_type': 1, status: 1, published_at: -1 });
// Client-relative sentiment filter (Negative/Neutral/Positive pills on
// the Alerts page). `target_sentiment` is the current field; `bsk_sentiment` is
// its deprecated mirror, still indexed because historical alerts carry only
// that one and the query matches on either.
alertSchema.index({ 'llm_analysis.target_sentiment': 1, status: 1, published_at: -1 });
alertSchema.index({ 'llm_analysis.bsk_sentiment': 1, status: 1, published_at: -1 });
alertSchema.index({ 'llm_analysis.political_stance': 1, status: 1, published_at: -1 });
// Constituency Leader Popularity's aggregation groups on this; the sweep's
// pending query filters on attempted_at — see detected_location above.
alertSchema.index({ 'detected_location.constituency': 1 }, { sparse: true });
alertSchema.index({ 'detected_location.attempted_at': 1 }, { sparse: true });

// ─── Gate filter: matched_keywords for reports and filtering ───
// Index on matched_keywords for checking if alert has keywords (gate filter)
alertSchema.index({ matched_keywords: 1 });

// ─── Alert data lookup + filtering for reports ───
// Compound indexes for report lookups (lookups join on id, then filter by these fields)
alertSchema.index({ id: 1, matched_keywords: 1 });  // Gate filter during report lookups
alertSchema.index({ id: 1, risk_level: 1 });        // Risk level filtering in reports
alertSchema.index({ id: 1, alert_type: 1 });        // Alert type filtering in reports
alertSchema.index({ id: 1, content_id: 1 });        // Content lookup chaining

// ─── Legacy sort by created_at — kept for endpoints still using it ───
alertSchema.index({ created_at: -1, id: -1 });
alertSchema.index({ status: 1, created_at: -1, id: -1 });

// ─── Lookup / join indexes ───
alertSchema.index({ content_id: 1 });
alertSchema.index({ content_ref_id: 1 });
alertSchema.index({ source_id: 1 });
alertSchema.index({ id: 1 }, { unique: false });

// ─── Utility ───
alertSchema.index({ is_read: 1, published_at: -1 });

// Repair UTF-8-read-as-Latin-1 text on every write path. No-op unless the
// unambiguous mojibake signature is present — see utils/textEncoding.js.
alertSchema.plugin(require('../utils/textEncoding').mojibakeGuardPlugin);

/**
 * Campaign topic — the same 16-value taxonomy grievances carry on
 * `analysis.topic` (services/campaignTaxonomy.js).
 *
 * An alert cannot inherit one: it points at a Content document, and Content
 * stores no analysis in this deployment. So it is classified from the alert's
 * own title + description by scripts/backfill-alert-topics.js.
 *
 * Alerts deliberately carry NO stance. An alert exists because something was
 * flagged as a risk, so it is negative by construction; the campaign
 * aggregation pins every alert to `anti_target` rather than counting a split
 * that would always come out the same way.
 */
alertSchema.add({
  campaign_topic: { type: String, default: null },
  campaign_topic_taxonomy_version: { type: Number, default: null },
});
alertSchema.index({ campaign_topic: 1, published_at: -1 });

module.exports = mongoose.model('Alert', alertSchema);
