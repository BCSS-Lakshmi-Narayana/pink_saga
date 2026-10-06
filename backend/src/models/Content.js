const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const contentSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  source_id: {
    type: String,
    required: false,
    ref: 'Source'
  },
  platform: {
    type: String,
    enum: ['youtube', 'x', 'instagram', 'facebook'],
    required: true
  },
  content_type: {
    type: String,
    enum: ['post', 'reel', 'story', 'highlight', 'video', 'tweet'],
    default: 'post'
  },
  content_id: {
    type: String,
    required: true
  },
  content_url: {
    type: String,
    required: true
  },
  text: {
    type: String,
    required: true
  },
  scraped_content: {
    type: String
  },
  media: {
    type: [
      {
        type: { type: String, enum: ['photo', 'video', 'animated_gif'], default: 'photo' },
        url: String,
        video_url: String,
        preview: String,
        preview_url: String,
        // Original Instagram CDN URLs (kept for availability checks)
        original_url: { type: String, default: null },
        original_video_url: { type: String, default: null },
        original_preview: { type: String, default: null },
        original_preview_url: { type: String, default: null },
        // S3 permanent copies (survive CDN expiry / author deletion)
        s3_url: { type: String, default: null },
        s3_key: { type: String, default: null },
        s3_preview: { type: String, default: null },
        s3_preview_key: { type: String, default: null }
      }
    ],
    default: []
  },
  // Whether all media items have been archived to S3
  is_media_archived: {
    type: Boolean,
    default: false
  },
  // ── Content Availability Tracking ─────────────────────────────
  // Whether the original post/reel/story has been deleted by the author
  is_deleted: {
    type: Boolean,
    default: false
  },
  deleted_at: {
    type: Date,
    default: null
  },
  // An admin deleted the Alert generated for this content. Distinct from
  // `is_deleted` above (which tracks the ORIGINAL POST's availability, not
  // our alert about it). Checked by every alert-creation path
  // (velocityAlertService, monitorService.rescanContent/scanSourceOnce) so a
  // deleted alert doesn't get silently recreated the next time this same
  // content is re-evaluated.
  alert_suppressed: {
    type: Boolean,
    default: false
  },
  // Whether the content has expired (e.g. Instagram stories after 24h)
  is_expired: {
    type: Boolean,
    default: false
  },
  expired_at: {
    type: Date,
    default: null
  },
  // Last time we checked if the original URL is still live
  last_availability_check: {
    type: Date,
    default: null
  },
  // Status of the content on the original platform
  availability_status: {
    type: String,
    enum: ['available', 'deleted', 'expired', 'unknown'],
    default: 'available'
  },
  is_repost: {
    type: Boolean,
    default: false
  },
  original_author: {
    type: String // For Reposts: The handle
  },
  original_author_name: {
    type: String
  },
  original_author_avatar: {
    type: String
  },
  quoted_content: {
    type: {
      text: String,
      author_name: String,
      author_handle: String,
      profile_image_url: String,
      media: [{
        type: { type: String, enum: ['photo', 'video', 'animated_gif'], default: 'photo' },
        url: String,
        video_url: String,
        preview: String,
        preview_url: String,
        original_url: { type: String, default: null },
        original_video_url: { type: String, default: null },
        original_preview: { type: String, default: null },
        original_preview_url: { type: String, default: null },
        s3_url: { type: String, default: null },
        s3_key: { type: String, default: null },
        s3_preview: { type: String, default: null },
        s3_preview_key: { type: String, default: null }
      }],
      created_at: Date
    },
    default: null
  },
  // URL Card Previews (link unfurling)
  url_cards: [{
    url: String,
    expanded_url: String,
    display_url: String,
    title: String,
    description: String,
    image: String
  }],
  author: {
    type: String,
    required: true
  },
  author_handle: {
    type: String,
    required: true
  },
  published_at: {
    type: Date,
    required: true
  },

  // Optional linkage for event-based monitoring
  event_ids: {
    type: [String],
    default: []
  },
  // Video Metadata
  duration: { type: String }, // ISO 8601 duration
  thumbnails: {
    default: { url: String, width: Number, height: Number },
    medium: { url: String, width: Number, height: Number },
    high: { url: String, width: Number, height: Number }
  },
  tags: [String],
  category_id: String,

  // Intelligence & Risk
  risk_score: { type: Number, default: 0 }, // 0-100
  risk_level: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'low'
  },
  // Complete-or-pending pipeline: a verdict is written only from a complete
  // analysis; until then the record is 'pending' and the retry job re-analyses
  // it ('failed' after MAX_ANALYSIS_ATTEMPTS).
  analysis_status: { type: String, enum: ['pending', 'complete', 'failed'], default: undefined, index: true },
  analysis_attempts: { type: Number, default: 0 },
  analysis_error: { type: String, default: null },
  analysis_last_attempt_at: { type: Date, default: null },
  analysis_completed_at: { type: Date, default: null },
  threat_intent: { type: String }, // e.g. Violence, Political, Neutral
  threat_reasons: [String],        // e.g. ["Detected 'kill'", "Violence detected"]
  risk_factors: [{
    keyword: String,
    weight: Number,
    category: String,
    context: String
  }],
  // See the note on Analysis.sentiment: 'neutral' is the canonical middle
  // label; 'moderate' (retired) is retained so older rows still validate.
  sentiment: {
    type: String,
    enum: ['positive', 'neutral', 'negative', 'moderate'],
    default: 'neutral'
  },

  engagement: {
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    retweets: { type: Number, default: 0 }
  },
  // Engagement History for Velocity Tracking
  engagement_history: [{
    timestamp: { type: Date, default: Date.now },
    views: Number,
    likes: Number,
    comments: Number
  }],
  raw_data: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

// NOTE: index will be migrated at runtime in backend/src/index.js (fixIndexes)
contentSchema.index({ platform: 1, content_id: 1 }, { unique: true });
contentSchema.index({ id: 1 }); // Critical: used by alert $lookup pipelines
contentSchema.index({ content_id: 1 }); // Standalone for $expr lookups
contentSchema.index({ platform: 1, source_id: 1, published_at: -1 });
contentSchema.index({ platform: 1, risk_level: 1 });
contentSchema.index({ source_id: 1, risk_level: 1 });
contentSchema.index({ platform: 1, content_type: 1, published_at: -1 });
contentSchema.index({ platform: 1, source_id: 1, content_type: 1, published_at: -1 });
contentSchema.index({ is_deleted: 1 });

// Repair UTF-8-read-as-Latin-1 text on every write path. No-op unless the
// unambiguous mojibake signature is present — see utils/textEncoding.js.
contentSchema.plugin(require('../utils/textEncoding').mojibakeGuardPlugin);

module.exports = mongoose.model('Content', contentSchema);
