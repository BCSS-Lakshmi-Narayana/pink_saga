const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * One YouTube live-chat comment.
 *
 * Deliberately a SEPARATE collection from `Grievance` — live chat is a
 * high-volume, low-signal firehose and must never leak into the Mentions
 * "All" feed or its sentiment counters.
 */
const liveChatMessageSchema = new mongoose.Schema({
    id: { type: String, default: uuidv4, unique: true },

    stream_id: { type: String, required: true, index: true },   // LiveStream.id
    video_id: { type: String, required: true, index: true },
    message_id: { type: String, required: true, unique: true }, // YouTube's chat id — dedupe key

    // ─── author ───
    author_channel_id: { type: String, default: null },
    author_name: { type: String, default: 'Unknown' },
    author_photo: { type: String, default: null },
    is_moderator: { type: Boolean, default: false },
    is_member: { type: Boolean, default: false },
    is_owner: { type: Boolean, default: false },

    // ─── content ───
    text: { type: String, default: '' },
    text_en: { type: String, default: null },        // translation when non-English
    language: { type: String, default: null },
    /**
     * Ordered, positional rendering data for custom/channel emoji — kept
     * separate from `text` on purpose. `text` stays the single field every
     * analysis/search consumer reads (a custom emoji is still just its
     * ":shortcut:" placeholder there); this array only exists for the UI to
     * paint the right image in the right spot, and is only ever non-empty
     * when the message actually contains a custom emoji. Standard Unicode
     * emoji need no entry here — they're already correct as plain characters
     * inside `text` (and inside this array's own 'text' parts, when present).
     *
     * Shape when present — an array of:
     *   { part_type: 'text', value: string }
     *   { part_type: 'custom_emoji', emoji_id: string|null, image_url: string|null, alt: string|null }
     *
     * Typed as Mixed rather than [{...}] deliberately: a typed Mongoose array
     * path auto-vivifies to `[]` on every document Mongoose constructs
     * regardless of `default`, and the vast majority of messages have no
     * custom emoji — persisting `[]` on every single row is pure waste at
     * live-chat volume. Mixed has no such auto-vivification, so an
     * absent/undefined value here is genuinely absent in the stored document.
     * The tradeoff: Mongoose no longer validates this field's internal shape.
     * Acceptable because there is exactly one writer of non-empty values —
     * parseMessageRuns() in youtubeLiveChatReader.js (plus the custom-emoji
     * backfill script, which builds the identical shape) — neither takes
     * this shape from untrusted input.
     */
    display_parts: {
        type: mongoose.Schema.Types.Mixed,
    },
    is_superchat: { type: Boolean, default: false },
    superchat_amount: { type: String, default: null },

    // ─── intelligence (same scheme as mentions/alerts) ───
    sentiment: {
        type: String,
        enum: ['positive', 'neutral', 'negative', 'moderate'],
        default: 'neutral',
        index: true
    },
    sentiment_score: { type: Number, default: 0 },
    // Raw emotional tone, before the client-axis flip. Kept because "attacks the
    // opposition" (tone negative, sentiment positive) is a materially different
    // signal from "praises the government" (tone positive, sentiment positive).
    tone: { type: String, enum: ['positive', 'neutral', 'negative', 'moderate'], default: 'neutral' },
    // Canonical stance from analysisService.analyzeContent() — one of
    // pro_target / anti_target / pro_target_indirect / anti_target_indirect /
    // neutral / unrelated. Stored raw; presentation-layer code collapses this
    // to Supportive / Opposing / Neutral at render time only.
    stance: { type: String, default: null },
    target_entity: { type: String, default: null },
    political_relevance: { type: Number, default: 0 },
    is_political: { type: Boolean, default: false, index: true },
    matched_entities: { type: [String], default: [] },
    risk_level: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    analysis_provider: { type: String, default: null },  // 'lexicon' | 'llm' | 'fallback'
    analysis_reason: { type: String, default: null },    // short LLM justification

    // ─── canonical analysis lifecycle ───
    // pending: just ingested, not yet queued/claimed for analysis.
    // analyzing: claimed by a worker, canonical analysis in flight.
    // complete: a real, validated canonical result is stored below.
    // failed: the canonical engine returned an unusable/incomplete result, or
    //   the call errored — sentiment/stance/risk are never fabricated here.
    analysis_status: { type: String, enum: ['pending', 'analyzing', 'complete', 'failed'], default: 'pending', index: true },
    // When this message most recently entered the analysis queue — set at
    // first ingest, and re-set on every retry requeue. Real timestamp, used
    // to show real elapsed wait time (never a fabricated ETA).
    analysis_queued_at: { type: Date, default: null },
    analysis_started_at: { type: Date, default: null },
    analysis_completed_at: { type: Date, default: null },
    needs_review: { type: Boolean, default: false },
    review_reason: { type: String, default: '' },
    confidence: { type: Number, default: null },
    retry_count: { type: Number, default: 0 },
    // Full raw result object from analysisService.analyzeContent() — the
    // source for the eye-icon detail view. Mixed on purpose: any field the
    // canonical engine adds later lands here automatically, no migration.
    analysis_details: { type: mongoose.Schema.Types.Mixed, default: null },

    published_at: { type: Date, required: true, index: true },
    created_at: { type: Date, default: Date.now }
});

liveChatMessageSchema.index({ stream_id: 1, published_at: -1 });
liveChatMessageSchema.index({ video_id: 1, sentiment: 1 });
liveChatMessageSchema.index({ created_at: -1 });
liveChatMessageSchema.index({ analysis_status: 1, created_at: 1 });

/**
 * Retention cap. Live chat is a firehose — a single busy broadcast can add
 * tens of thousands of rows per hour, so this collection is bounded by a TTL
 * index instead of growing without limit.
 *
 * Tune with YT_LIVE_RETENTION_DAYS; set it to 0 to keep messages forever
 * (only do that if the cluster has plenty of headroom).
 */
const RETENTION_DAYS = Number(process.env.YT_LIVE_RETENTION_DAYS ?? 30);
if (RETENTION_DAYS > 0) {
    liveChatMessageSchema.index(
        { created_at: 1 },
        { expireAfterSeconds: Math.round(RETENTION_DAYS * 24 * 60 * 60), name: 'ytlive_ttl' }
    );
}

module.exports = mongoose.model('LiveChatMessage', liveChatMessageSchema);
