const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * CampaignSuggestion — an AI-generated awareness-campaign idea derived from this
 * deployment's own mentions, alerts and news. Each suggestion is tagged with sentiment +
 * intent (counter a negative trend / amplify a positive one) and scored by impact +
 * urgency so the operator can prioritise.
 *
 * Ported from the multi-tenant saga. Two things were dropped deliberately: `tenant_id`
 * and its scoping (this deployment monitors one organisation), and the Super Admin
 * approval hop — a suggestion here goes straight to a campaign the same team owns.
 */
const campaignSuggestionSchema = new mongoose.Schema(
  {
    id: { type: String, default: uuidv4, unique: true },   // unique already indexes it

    // The Stage A issue this campaign answers (16-value campaign taxonomy). Empty when
    // the aggregation fell back to the coarse label or ran on the recency path.
    topic: { type: String, default: '' },
    /**
     * Which of the topic's campaigns this is (0-based) and how many there were.
     *
     * Two campaigns off one topic legitimately share their post counts, impact and
     * urgency — it is the same issue — so on screen they look like the page rendered a
     * duplicate. These let a card say "Campaign 2 of 3 on this issue" instead.
     */
    variant_index: { type: Number, default: 0 },
    variant_count: { type: Number, default: 1 },
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    /**
     * The creator-facing brief — what an influencer is actually told to do.
     *
     * Deliberately NOT `summary`. Summary is our internal read of the conversation and
     * carries our monitoring numbers; pushing it to a campaign meant an external creator
     * saw "161 posts on this issue — 108 supportive, 53 critical" and the word "AMPLIFY".
     * That is our own intelligence and does not belong in anything published.
     */
    brief: { type: String, default: '' },
    sentiment: { type: String, enum: ['positive', 'negative', 'neutral', 'mixed'], default: 'mixed' },
    intent: { type: String, enum: ['amplify', 'counter'], default: 'amplify' },

    impact_score: { type: Number, default: 0 },   // 0–100
    urgency_score: { type: Number, default: 0 },   // 0–100
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },

    suggested_message: { type: String, default: '' },
    /**
     * The same post cut down for X.
     *
     * suggested_message is now a full-length post (10+ lines); X allows 280 characters,
     * so publishing the long one there means an arbitrary mid-sentence truncation. This
     * is written by the model alongside it and prefills X's per-platform override.
     */
    suggested_message_short: { type: String, default: '' },
    suggested_news: { type: [String], default: [] },
    // Carried into ViralCampaign.hashtags when the suggestion is converted, so the AI
    // path produces the same creative fields the manual request form collects.
    suggested_hashtags: { type: [String], default: [] },
    target_platforms: { type: [String], default: [] },
    recommended_niche: { type: String, default: '' }, // used by Super Admin for influencer matching
    rationale: { type: String, default: '' },

    evidence: {
      // Counts describe the POOL that was analysed for the whole batch — every
      // suggestion in one run shares them.
      grievance_count: { type: Number, default: 0 },
      alert_count: { type: Number, default: 0 },
      event_count: { type: Number, default: 0 },
      // RSS articles (NewsArticle) in the window when 'news' was one of the sources.
      news_count: { type: Number, default: 0 },
      sources: { type: [String], default: [] }, // which content sources fed this batch
      top_topics: { type: [String], default: [] },
      sample_texts: { type: [String], default: [] },
      // Scale of the ONE issue this suggestion is about (the counts above describe the
      // whole batch and are identical on every card).
      topic_posts: { type: Number, default: 0 },
      topic_anti: { type: Number, default: 0 },
      topic_pro: { type: Number, default: 0 },

      // How the evidence was selected — retrieved per topic, or a recency fallback —
      // and which vocabulary those topics came from.
      retrieval: {
        used: { type: Boolean, default: false },
        mode: { type: String, default: '' },        // e.g. "atlas/atlas" or "fallback/fallback"
        topics_considered: { type: [String], default: [] },
        taxonomy: { type: String, default: '' },   // 'campaign topic' | 'grievance_type (fallback)'
        note: { type: String, default: '' },
        // The operator's filter choices for this run. `defaults: true` means nothing was
        // selected and the engine picked the topics itself, which is the original
        // behaviour and the only case where the volume ranking chose the issues.
        filters: {
          topics: { type: [String], default: [] },
          per_topic: { type: Number, default: 0 },
          stance: { type: String, default: 'all' },   // all | criticize | support
          max_topics: { type: Number, default: 0 },
          // null when the operator left it on auto and volume decided per topic.
          campaigns_per_topic: { type: Number, default: null },
          defaults: { type: Boolean, default: true },
        },
      },

      // …whereas THESE are the specific posts the model cited for THIS suggestion.
      // Without them a card could only say "based on 30 mentions", which is the size of
      // the pool, not the reason this particular campaign exists — so an operator had no
      // way to check whether the AI had actually read anything relevant.
      source_posts: {
        type: [{
          kind: { type: String, enum: ['mention', 'alert', 'event', 'news'], default: 'mention' },
          ref_id: { type: String, default: '' },   // Grievance/Alert/Event.id
          platform: { type: String, default: '' },
          url: { type: String, default: '' },
          author: { type: String, default: '' },
          sentiment: { type: String, default: '' },
          // pro_target / anti_target / … — what makes a stance-filtered run auditable.
          stance: { type: String, default: '' },
          emotion: { type: String, default: '' },
          confidence: { type: mongoose.Schema.Types.Mixed, default: null },
          text: { type: String, default: '' },     // the truncated excerpt shown to the model
          at: { type: Date },
        }],
        default: [],
      },
    },

    /**
     * new         — the current batch, shown by default
     * superseded  — from an earlier Generate run. Kept, not deleted: a suggestion the
     *               operator liked should not vanish because someone pressed Generate
     *               again, and comparing runs is how you tell a real trend from noise.
     * dismissed   — explicitly rejected by a person
     * converted   — sent to a viral campaign
     */
    status: { type: String, enum: ['new', 'superseded', 'dismissed', 'converted'], default: 'new', index: true },
    linked_campaign_id: { type: String },

    // ── Audit / tracking ──────────────────────────────────────────────────────
    generated_by: { type: String, default: '' },       // who ran Generate
    generated_by_role: { type: String, default: '' },  // the operator's role at generation time
    converted_by: { type: String, default: '' },       // who sent it to a campaign
    converted_at: { type: Date },
    history: {
      type: [{
        action: { type: String },   // generated | sent_to_viral | dismissed | approved
        by: { type: String, default: '' },
        role: { type: String, default: '' },
        note: { type: String, default: '' },
        at: { type: Date, default: Date.now },
      }],
      default: [],
    },

    generated_at: { type: Date, default: Date.now },
    created_at: { type: Date, default: Date.now },
  },
  { collection: 'campaign_suggestions' }
);

module.exports = mongoose.model('CampaignSuggestion', campaignSuggestionSchema);
