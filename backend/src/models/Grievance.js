const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const createGrievanceMediaItemDefinition = () => ({
  type: { type: String, enum: ['photo', 'video', 'animated_gif'] },
  url: { type: String },
  video_url: { type: String },
  preview_url: { type: String },
  original_url: { type: String, default: null },
  original_video_url: { type: String, default: null },
  original_preview_url: { type: String, default: null },
  s3_url: { type: String, default: null },
  s3_key: { type: String, default: null },
  s3_preview: { type: String, default: null },
  s3_preview_key: { type: String, default: null }
});

/**
 * Grievance Model
 * Stores grievance posts from monitored X/Facebook government sources
 */
const grievanceSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  complaint_code: {
    type: String
  },
  // Canonical external post ID.
  // For X: raw tweet id.
  // For Facebook: prefixed ids (e.g., facebook:post:<id>, facebook:comment:<id>).
  tweet_id: {
    type: String,
    required: true,
    unique: true
  },
  // The government account that was tagged
  tagged_account: {
    type: String,
    required: true
  },
  tagged_account_normalized: {
    type: String,
    default: ''
  },
  // Reference to GrievanceSource
  grievance_source_id: {
    type: String,
    ref: 'GrievanceSource'
  },
  // Source platform
  platform: {
    type: String,
    enum: ['x', 'facebook', 'whatsapp', 'instagram', 'youtube'],
    default: 'x'
  },
  complainant_phone: {
    type: String
  },
  source_ref: {
    type: String
  },
  whatsapp_message_sid: {
    type: String
  },
  // Author information
  posted_by: {
    handle: { type: String, required: true },
    display_name: { type: String },
    profile_image_url: { type: String },
    is_verified: { type: Boolean, default: false },
    follower_count: { type: Number, default: 0 }
  },
  // Post content
  content: {
    text: { type: String, required: true },
    full_text: { type: String },
    media: [createGrievanceMediaItemDefinition()],
    archived_video_url: { type: String }
  },
  // Context about the original post when this grievance is a reply/quote.
  // This enables showing both the tagged reply and the original post in the UI.
  context: {
    in_reply_to: {
      tweet_id: { type: String },
      tweet_url: { type: String },
      posted_by: {
        handle: { type: String },
        display_name: { type: String },
        profile_image_url: { type: String },
        is_verified: { type: Boolean, default: false }
      },
      content: {
        text: { type: String },
        full_text: { type: String },
        media: [createGrievanceMediaItemDefinition()]
      },
      post_date: { type: Date }
    },
    reposted_from: {
      tweet_id: { type: String },
      tweet_url: { type: String },
      posted_by: {
        handle: { type: String },
        display_name: { type: String },
        profile_image_url: { type: String },
        is_verified: { type: Boolean, default: false }
      },
      content: {
        text: { type: String },
        full_text: { type: String },
        media: [createGrievanceMediaItemDefinition()]
      },
      post_date: { type: Date }
    },
    quoted: {
      tweet_id: { type: String },
      tweet_url: { type: String },
      posted_by: {
        handle: { type: String },
        display_name: { type: String },
        profile_image_url: { type: String },
        is_verified: { type: Boolean, default: false }
      },
      content: {
        text: { type: String },
        full_text: { type: String },
        media: [createGrievanceMediaItemDefinition()]
      },
      post_date: { type: Date }
    }
  },
  // Tweet URL
  tweet_url: {
    type: String,
    required: true
  },
  // Engagement metrics
  engagement: {
    likes: { type: Number, default: 0 },
    retweets: { type: Number, default: 0 },
    replies: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    quotes: { type: Number, default: 0 }
  },
  // Timestamps
  post_date: {
    type: Date,
    required: true
  },
  detected_date: {
    type: Date,
    default: Date.now
  },
  workflow_status: {
    type: String,
    enum: ['received', 'reviewed', 'action_taken', 'closed', 'converted_to_fir'],
    default: 'received'
  },
  workflow_history: [{
    from: { type: String },
    to: { type: String, enum: ['received', 'reviewed', 'action_taken', 'closed', 'converted_to_fir'] },
    at: { type: Date, default: Date.now },
    by: { type: String },
    note: { type: String }
  }],
  workflow_timestamps: {
    received_at: { type: Date },
    reviewed_at: { type: Date },
    action_taken_at: { type: Date },
    closed_at: { type: Date },
    fir_converted_at: { type: Date }
  },
  escalation_count: {
    type: Number,
    default: 0
  },
  escalation_history: [{
    reason: { type: String },
    note: { type: String },
    by: { type: String },
    at: { type: Date, default: Date.now }
  }],
  fir_converted_at: {
    type: Date
  },
  fir_converted_by: {
    type: String
  },
  fir_number: {
    type: String
  },
  // Classification status
  classification: {
    type: String,
    enum: ['unclassified', 'acknowledged', 'complaint'],
    default: 'unclassified'
  },
  // For acknowledged items - reason for acknowledgment
  acknowledgment: {
    reason: { type: String },
    acknowledged_by: { type: String },
    acknowledged_at: { type: Date },
    notes: { type: String }
  },
  // For complaints - action details
  complaint: {
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'reviewed', 'case_booked'],
      default: 'pending'
    },
    // Unique report number: X-GRV-DD-MM-YY-SERIAL
    report_number: { type: String },
    // PDF report path/URL
    report_url: { type: String },
    // Action details
    action_taken: { type: String },
    action_taken_by: { type: String },
    action_taken_at: { type: Date },
    // Sharing history
    shared_with: [{
      contact_number: { type: String },
      shared_at: { type: Date },
      shared_by: { type: String },
      method: { type: String, enum: ['whatsapp', 'download'] }
    }],
    // Internal notes
    notes: { type: String },
    // Category of complaint
    category: { type: String }
  },
  // Criticism workflow tracking
  criticism: {
    report_id: { type: String },
    unique_code: { type: String },
    category: { type: String },
    remarks: { type: String },
    message: { type: String },
    media_s3_urls: [{ type: String }],
    action_taken_at: { type: Date },
    shared_at: { type: Date },
    shared_via: { type: String },
    informed_to: {
      name: { type: String },
      phone: { type: String },
      department: { type: String }
    }
  },
  // Grievance (G) workflow tracking
  grievance_workflow: {
    report_id: { type: String },
    unique_code: { type: String },
    status: { type: String, enum: ['PENDING', 'ESCALATED', 'CLOSED'], default: 'PENDING' },
    category: { type: String },
    shared_at: { type: Date },
    informed_to: {
      type: {
        name: { type: String, default: '' },
        phone: { type: String, default: '' },
        department: { type: String, default: '' }
      },
      default: () => ({})
    }
  },
  // Query (Q) workflow tracking
  query_workflow: {
    report_id: { type: String },
    unique_code: { type: String },
    status: { type: String, enum: ['PENDING', 'CLOSED'], default: 'PENDING' },
    category: { type: String },
    shared_at: { type: Date },
    informed_to: {
      type: {
        name: { type: String, default: '' },
        phone: { type: String, default: '' },
        department: { type: String, default: '' }
      },
      default: () => ({})
    }
  },
  // Suggestion (S) workflow tracking
  suggestion: {
    report_id: { type: String },
    unique_code: { type: String },
    category: { type: String },
    remarks: { type: String },
    message: { type: String },
    media_s3_urls: [{ type: String }],
    action_taken_at: { type: Date },
    shared_at: { type: Date },
    shared_via: { type: String },
    informed_to: {
      name: { type: String },
      phone: { type: String },
      department: { type: String }
    }
  },
  // AI Analysis (full pipeline results)
  analysis: {
    // 'neutral' is canonical; 'moderate' is the retired label. It is still accepted because
    // records written before the rename carry it, and Mongoose validates the
    // WHOLE subdocument on save — without it, any unrelated update to an old
    // grievance (a status change, a note) would throw ValidationError.
    sentiment: { type: String, enum: ['positive', 'negative', 'moderate', 'neutral'] },
    risk_level: { type: String, enum: ['low', 'medium', 'high', 'critical'] },
    risk_score: { type: Number, default: 0 },
    // Severity is a semantic alias of risk_level for UI / map colouring.
    // Always populated by the classifier; kept distinct so future tuning
    // can decouple "risk to the leadership" from "severity to the citizen".
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'] },
    // Government department best suited to act on this grievance.
    concerned_department: { type: String, default: null },
    category: { type: String },
    grievance_type: { type: String },
    grievance_topic_reasoning: { type: String },
    intent: { type: String },
    explanation: { type: String },
    triggered_keywords: [{ type: String }],
    violated_policies: [{ type: mongoose.Schema.Types.Mixed }],
    legal_sections: [{ type: mongoose.Schema.Types.Mixed }],
    reasons: [{ type: String }],
    highlights: [{ type: String }],
    llm_analysis: { type: mongoose.Schema.Types.Mixed },
    forensic_results: { type: mongoose.Schema.Types.Mixed },
    video_transcript: { type: String },
    analyzed_at: { type: Date },
    // ── Target-aware political intelligence ───────────────────────
    //
    // THE ONE RULE: `generic_sentiment` is the literal tone of the text;
    // `target_sentiment` is whether the post is good or bad FOR THE CLIENT.
    // They are different values and must never be derived from one another.
    // `target_tone` is the tone aimed specifically at `target_entity` — it is
    // what the stance matrix consumed, and differs from `generic_sentiment` on
    // the very common "supports a group while attacking the government" shape.

    /** Client-relative verdict. THE value the Alerts/Mentions badges mean. */
    target_sentiment: { type: String, enum: ['positive', 'negative', 'neutral', 'moderate'] },
    /** Deprecated mirror of target_sentiment, written from the same value. */
    bsk_sentiment: { type: String, enum: ['positive', 'negative', 'neutral', 'moderate'] },
    /** Whole-post emotional tone, for display only. Never feeds the matrix. */
    generic_sentiment: { type: String, enum: ['positive', 'negative', 'neutral', 'moderate'] },
    /** Tone aimed AT the target — the matrix input. */
    target_tone: { type: String, enum: ['positive', 'negative', 'neutral', 'moderate'] },

    emotion: {
      type: String,
      enum: ['anger', 'joy', 'fear', 'sadness', 'frustration', 'hope', 'pride', 'sarcasm', 'concern', 'neutral'],
      default: 'neutral',
    },

    // Stage 5 confidence / review gate
    confidence: { type: mongoose.Schema.Types.Mixed },
    validation: { type: mongoose.Schema.Types.Mixed },
    validation_status: { type: String, enum: ['passed', 'needs_review'], default: 'passed' },
    needs_review: { type: Boolean, default: false },
    review_reason: { type: String, default: '' },
    /**
     * True once an operator has manually corrected the verdict. Lets a later
     * re-analysis (and any review queue) tell a human verdict from a model one
     * instead of silently overwriting it.
     */
    manual_override: { type: Boolean, default: false },
    client_relevance: { type: String, enum: ['relevant', 'not_relevant', 'uncertain'], default: 'uncertain' },
    target: {
      type: String,
      enum: ['ruling_party', 'state_government', 'opposition', 'other', 'unknown', 'none'],
      default: 'unknown',
    },
    /** Pass A's read of whose side the post is about — a cross-check input. */
    target_party: { type: String },

    /**
     * The 16-value CAMPAIGN taxonomy (services/campaignTaxonomy.js) — distinct
     * from `grievance_type`, which is deliberately coarse.
     *
     * AI Campaigns groups the window on THIS field. It cannot use
     * `grievance_type`, whose "Public Complaint" bucket merges water, power,
     * roads, schools and pensions into one, and whose "Normal" swallows most of
     * the corpus — neither can produce the per-issue split a campaign needs.
     *
     * Populated on ingest and by scripts/backfill-grievance-topics.js. Until
     * coverage passes RAG_MIN_TOPIC_COVERAGE the aggregation falls back to
     * `grievance_type` rather than ranking a biased sample.
     */
    topic: { type: String, default: null },
    topic_taxonomy_version: { type: Number, default: null },

    target_entity: { type: String },
    target_entity_canonical: { type: String },
    target_relevance: { type: Number, default: 0 },
    /** Deprecated mirror of target_relevance. */
    bsk_relevance: { type: Number, default: 0 },
    relevance_score: { type: Number, default: 0 },

    /**
     * The stance vocabulary. `pro_bsk`/`anti_bsk`/... are the retired names,
     * kept in the enum ONLY so historical records still validate when re-saved.
     * New writes always use the `*_target` values.
     */
    stance: {
      type: String,
      enum: [
        'pro_target', 'anti_target', 'pro_target_indirect', 'anti_target_indirect',
        'neutral', 'unrelated',
        // retired — accepted for stored records, never written
        'pro_bsk', 'anti_bsk', 'pro_bsk_indirect', 'anti_bsk_indirect',
      ],
    },
    /** Same value as `stance`, in the current vocabulary only. */
    political_stance: {
      type: String,
      enum: ['pro_target', 'anti_target', 'pro_target_indirect', 'anti_target_indirect', 'neutral', 'unrelated'],
    },
    // 'bsk'/'bjp' are retired beneficiary values, kept for stored records.
    beneficiary: { type: String, enum: ['ours', 'opposition', 'none', 'bsk', 'bjp'] },
    attack_target: { type: String },
    narrative_direction: { type: String },
    political_alignment: { type: String },
    political_mode: { type: String },
    mentioned_entities: [{ type: mongoose.Schema.Types.Mixed }],
    toxicity_level: { type: String, enum: ['none', 'low', 'medium', 'high'] },
    hate_speech: { type: Boolean, default: false },
    propaganda_probability: { type: Number, default: 0 },
    sarcasm_detected: { type: Boolean, default: false },
    emotional_intensity: { type: Number, default: 0 },
    misinformation_probability: { type: Number, default: 0 },
    language_detected: { type: String },
    political_reasoning: { type: String },
    political_provider: { type: String }
  },
  // Detected location from tweet text/user profile/hashtags
  detected_location: {
    location_found: { type: Boolean, default: false },
    city: { type: String },
    district: { type: String },
    constituency: { type: String },
    lok_sabha: { type: String },
    keyword_matched: { type: String },
    matched_token: { type: String },
    match_source:  { type: String },
    lat: { type: Number },
    lng: { type: Number },
    confidence: { type: mongoose.Schema.Types.Mixed }, // was String legacy; now allow 0..1 Number
    source: { type: String },
    reasoning: { type: String },
    // Confidence-gated auto-assign vs manual review.
    auto_assigned: { type: Boolean, default: false },
    manual_review_required: { type: Boolean, default: false },
  },
  // Resolved routing fan-out (set by constituencyMasterService.resolveRouting)
  routing_targets: { type: mongoose.Schema.Types.Mixed, default: null },
  // Is this grievance currently visible/active
  // Complete-or-pending pipeline: a verdict is written only from a complete
  // analysis; until then the record is 'pending' and the retry job re-analyses
  // it ('failed' after MAX_ANALYSIS_ATTEMPTS).
  analysis_status: { type: String, enum: ['pending', 'complete', 'failed'], default: undefined, index: true },
  analysis_attempts: { type: Number, default: 0 },
  analysis_error: { type: String, default: null },
  analysis_last_attempt_at: { type: Date, default: null },
  analysis_completed_at: { type: Date, default: null },
  is_active: {
    type: Boolean,
    default: true
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

// Pre-save middleware
grievanceSchema.pre('save', function (next) {
  this.updated_at = new Date();
  this.tagged_account_normalized = String(this.tagged_account || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  next();
});

/**
 * Dense vector for hybrid retrieval (see services/rag/).
 *
 * `select: false` because it is ~1024 floats — roughly 8KB per document — and
 * every ordinary Grievance query would otherwise drag it across the wire for
 * nothing. The retrieval path asks for it explicitly.
 */
grievanceSchema.add({
  embedding: { type: [Number], default: undefined, select: false },
  embedding_model: { type: String, default: '' },
  embedding_dims: { type: Number, default: 0 },
  embedded_at: { type: Date, default: null },
  // Lets a re-run skip documents whose text has not changed since embedding.
  embedding_text_hash: { type: String, default: '' },
});

// Backfill cursors and the campaign aggregation both key off these.
grievanceSchema.index({ embedded_at: 1 });
grievanceSchema.index({ is_active: 1, 'analysis.needs_review': 1, post_date: -1 });
grievanceSchema.index({ 'analysis.topic': 1, post_date: -1 });
grievanceSchema.index({ 'analysis.political_stance': 1, 'analysis.topic': 1, post_date: -1 });

// Indexes for efficient queries
grievanceSchema.index({ platform: 1 });
grievanceSchema.index({ tagged_account: 1 });
grievanceSchema.index({ classification: 1 });
grievanceSchema.index({ 'complaint.status': 1 });
grievanceSchema.index({ complaint_code: 1 }, { unique: true, sparse: true });
grievanceSchema.index({ workflow_status: 1, post_date: -1 });
grievanceSchema.index({ platform: 1, workflow_status: 1, post_date: -1 });
grievanceSchema.index({ whatsapp_message_sid: 1 }, { unique: true, sparse: true });
grievanceSchema.index({ post_date: -1 });
// Exact shape of the CM brief's window query: active rows inside a date range.
grievanceSchema.index({ is_active: 1, post_date: -1 });
grievanceSchema.index({ detected_date: -1 });
grievanceSchema.index({ 'posted_by.handle': 1 });
grievanceSchema.index({ 'complaint.report_number': 1 });
grievanceSchema.index({ is_active: 1, workflow_status: 1, post_date: -1, id: -1 });
grievanceSchema.index({ is_active: 1, platform: 1, workflow_status: 1, post_date: -1, id: -1 });
grievanceSchema.index({ is_active: 1, grievance_source_id: 1, workflow_status: 1, post_date: -1, id: -1 });
grievanceSchema.index({ is_active: 1, classification: 1, 'complaint.status': 1, post_date: -1 });
grievanceSchema.index({ is_active: 1, tagged_account_normalized: 1, post_date: -1 });
grievanceSchema.index({ 'criticism.unique_code': 1 }, { sparse: true });
grievanceSchema.index({ 'grievance_workflow.status': 1, post_date: -1 });
grievanceSchema.index({ is_active: 1, 'grievance_workflow.status': 1, post_date: -1, id: -1 });
grievanceSchema.index({ 'query_workflow.unique_code': 1 }, { sparse: true });
grievanceSchema.index({ 'query_workflow.status': 1, post_date: -1 });
grievanceSchema.index({ 'suggestion.unique_code': 1 }, { sparse: true });
grievanceSchema.index({ 'detected_location.district': 1 }, { sparse: true });
grievanceSchema.index({ 'detected_location.constituency': 1 }, { sparse: true });
grievanceSchema.index({ 'detected_location.city': 1 }, { sparse: true });
// Compound indexes matching getLocationStats $match (is_active + location field present)
grievanceSchema.index({ is_active: 1, 'detected_location.city': 1 }, { sparse: true });
grievanceSchema.index({ is_active: 1, 'detected_location.district': 1 }, { sparse: true });
grievanceSchema.index({ is_active: 1, 'detected_location.constituency': 1 }, { sparse: true });
// Sentiment $group during list fetch — speeds up the pill counts aggregation
grievanceSchema.index({ is_active: 1, 'analysis.sentiment': 1 });
// Geographic Intelligence: date-filtered + sentiment-filtered district/city rollups
grievanceSchema.index({ is_active: 1, 'detected_location.district': 1, post_date: -1 });
grievanceSchema.index({ is_active: 1, 'detected_location.city': 1, post_date: -1 });
grievanceSchema.index({ is_active: 1, 'detected_location.district': 1, 'analysis.sentiment': 1, post_date: -1 });
grievanceSchema.index({ is_active: 1, 'detected_location.city': 1, 'analysis.sentiment': 1, post_date: -1 });

// Virtual for generating report number
grievanceSchema.methods.generateReportNumber = async function () {
  const date = new Date();
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);

  // Get serial number for today
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const count = await mongoose.model('Grievance').countDocuments({
    'complaint.report_number': { $exists: true, $ne: null },
    'complaint.action_taken_at': { $gte: startOfDay, $lte: endOfDay }
  });

  const serial = String(count + 1).padStart(3, '0');
  return `X-GRV-${day}-${month}-${year}-${serial}`;
};

// Repair UTF-8-read-as-Latin-1 text on every write path. No-op unless the
// unambiguous mojibake signature is present — see utils/textEncoding.js.
grievanceSchema.plugin(require('../utils/textEncoding').mojibakeGuardPlugin);

/**
 * Embed new posts as they arrive, so the AI-Campaigns corpus stays current
 * without anyone re-running the backfill. Fire-and-forget: a failure here never
 * blocks a save.
 *
 * Registered on the SCHEMA rather than at each call site because grievances are
 * created in six different places (keyword fetch, three platform paths, the
 * manual controller, the temp processor) — one hook covers every path,
 * including ones added later.
 *
 * Note it only fires on `document.save()`. Bulk paths (`updateOne`,
 * `bulkWrite`, `insertMany`) bypass it by design — that is exactly what
 * scripts/backfill-grievance-embeddings.js is for.
 */
require('../services/rag/embedOnIngest').attach(grievanceSchema);

module.exports = mongoose.model('Grievance', grievanceSchema);
