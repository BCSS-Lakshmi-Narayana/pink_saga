const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * ViralCampaign — a piece of content this team has decided to publish.
 *
 * Ported from the multi-tenant saga, with its entire distribution half removed. There,
 * a campaign was a REQUEST: a tenant raised it, a Super Admin approved it, influencers
 * bid on it in an auction, one was awarded and delivered proof. None of that applies
 * here — this deployment has no Super Admin above it and no influencer marketplace, so
 * a campaign is simply owned by the team that created it and moves through its own
 * status by hand.
 *
 * What was kept is the creative payload, because that is what the AI suggestion engine
 * fills in and what the operator edits before publishing.
 */

const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true },
  kind: { type: String, enum: ['image', 'video', 'audio', 'document', 'link'], default: 'link' },
  name: { type: String, default: '' },
}, { _id: false });

/**
 * A per-platform override. Blank fields inherit the campaign's shared creative, so a
 * campaign only has to spell out what actually differs — most often the caption, since
 * X allows 280 characters and the others do not.
 */
const platformContentSchema = new mongoose.Schema({
  platform: { type: String, required: true },
  title: { type: String, default: '' },
  content_type: { type: String, default: '' },
  caption: { type: String, default: '' },
  hashtags: { type: [String], default: [] },
  media: { type: [mediaSchema], default: [] },
}, { _id: false });

const viralCampaignSchema = new mongoose.Schema({
  id: { type: String, default: uuidv4, unique: true },   // unique already indexes it

  title: { type: String, required: true },
  // The brief. When the campaign came from a suggestion this is the creator-facing
  // `brief`, never the internal summary — see CampaignSuggestion.brief for why.
  description: { type: String, default: '' },

  // ── Creative ────────────────────────────────────────────────────────────────
  content_type: { type: String, default: 'post' },
  content_url: { type: String, default: '' },
  caption: { type: String, default: '' },
  hashtags: { type: [String], default: [] },
  media: { type: [mediaSchema], default: [] },
  platform_content: { type: [platformContentSchema], default: [] },

  target_platforms: { type: [String], default: [] },
  target_reach: { type: Number },
  budget: { type: Number },
  location: { type: String, default: '' },
  deadline: { type: Date },

  /**
   * draft      — created, not yet being worked on
   * scheduled  — queued to go out
   * published  — live
   * completed  — done and measured
   * cancelled  — abandoned
   *
   * No 'pending' / 'approved': there is no approver in this deployment.
   */
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'published', 'completed', 'cancelled'],
    default: 'draft',
    index: true,
  },

  // Where it came from, so a campaign can be traced back to the suggestion and the
  // posts that produced it.
  source: { type: String, enum: ['manual', 'ai_suggestion'], default: 'manual' },
  suggestion_id: { type: String, default: '', index: true },

  created_by: { type: String, default: '' },
  created_by_role: { type: String, default: '' },
  history: {
    type: [{
      action: { type: String },
      by: { type: String, default: '' },
      role: { type: String, default: '' },
      note: { type: String, default: '' },
      at: { type: Date, default: Date.now },
    }],
    default: [],
  },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { collection: 'viral_campaigns' });

viralCampaignSchema.index({ status: 1, created_at: -1 });

viralCampaignSchema.pre('save', function setUpdatedAt(next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model('ViralCampaign', viralCampaignSchema);
