/**
 * campaignSuggestionRoutes — the AI Campaigns tab.
 *
 * Ported from the multi-tenant saga. Two things were dropped on the way, deliberately:
 *
 *   1. TENANT SCOPING. That deployment served many parties from one database, so every
 *      read and write went through withTenant(). This one monitors a single
 *      organisation, so the scoping would be a no-op wrapped around every query.
 *
 *   2. THE APPROVAL HOP. There, a suggestion became a REQUEST that a Super Admin
 *      reviewed and published to an influencer auction. Here the team that generates a
 *      campaign is the team that runs it, so "send to campaign" writes a ViralCampaign
 *      directly, in 'draft'.
 *
 * Mounted at /api/campaign-suggestions and gated by the /ai-suggestions RBAC page, so it
 * appears in Access Management like every other page.
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');
const CampaignSuggestion = require('../models/CampaignSuggestion');
const ViralCampaign = require('../models/ViralCampaign');
const { generateSuggestions } = require('../services/campaignSuggestionService');
const topicSvc = require('../services/campaignTopicService');
const { createAuditLog } = require('../services/auditService');
const { buildCreative, normalizePlatforms, sanitizeHashtags } = require('../utils/viralCreative');

router.use(protect, requireAnyPageAccess(['/ai-suggestions']));

const clampDays = (v) => Math.min(Math.max(Number(v) || 7, 1), 30);

// Local midnight, so a deadline of "today" from an IST browser is not rejected as past.
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const actorOf = (req) => req.user?.full_name || req.user?.name || req.user?.email || 'operator';

// Audit is best-effort: a failed log must never fail the request it describes.
const audit = (req, action, resourceId, details) => {
  if (!req.user) return;
  createAuditLog(req.user, action, 'ai_campaign', resourceId, details)
    .catch((err) => console.warn('[campaignSuggestions:audit]', err.message));
};

// GET /api/campaign-suggestions?status=new|superseded|dismissed|converted|all
router.get('/', async (req, res) => {
  try {
    const status = req.query.status && req.query.status !== 'all' ? { status: req.query.status } : {};
    const suggestions = await CampaignSuggestion
      .find(status)
      .sort({ impact_score: -1, urgency_score: -1, generated_at: -1 })
      .lean();
    res.json({ ok: true, suggestions });
  } catch (err) {
    console.error('[campaignSuggestions:list]', err.message);
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET /api/campaign-suggestions/topics?days=30
 *
 * The issues present in the window, ranked by volume, with their stance split. Feeds the
 * filter panel — without it the operator would be picking from the 16-value taxonomy
 * blind, including topics with no posts at all this window.
 */
router.get('/topics', async (req, res) => {
  try {
    const days = clampDays(req.query?.days);
    const stage = await topicSvc.getSignificantTopics({
      days,
      // Everything available, not the top 5 the engine would pick: the point of the
      // panel is to reach an issue the volume ranking would have dropped.
      topN: topicSvc.CAMPAIGN_TOPICS.length,
      minPosts: 1,
      source: 'grievance',
    });
    res.json({
      ok: true,
      days,
      grouping: stage.grouping || null,
      topics: (stage.topics || []).map((t) => ({
        topic: t.topic, posts: t.posts, anti: t.anti, pro: t.pro, intent: t.intent,
      })),
    });
  } catch (err) {
    console.error('[campaignSuggestions:topics]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/campaign-suggestions/generate
//   { days, sources: ['mentions','alerts','events','news'],
//     topics: ['Corruption', …], per_topic: 8, max_topics: 5, campaigns_per_topic: 2,
//     stance: 'all'|'criticize'|'support' }
// Every filter is optional; omitting them all reproduces the engine's own defaults.
router.post('/generate', async (req, res) => {
  try {
    const days = clampDays(req.body?.days);
    const sources = Array.isArray(req.body?.sources) ? req.body.sources : undefined;
    const topics = Array.isArray(req.body?.topics) ? req.body.topics : undefined;
    const actor = actorOf(req);
    const suggestions = await generateSuggestions({
      days,
      sources,
      topics,
      perTopic: req.body?.per_topic,
      maxTopics: req.body?.max_topics,
      campaignsPerTopic: req.body?.campaigns_per_topic,
      stance: req.body?.stance,
      generatedBy: actor,
      generatedByRole: req.user?.role || '',
    });
    audit(req, 'generate_suggestions', null, {
      days, sources: sources || 'all', topics: topics || 'auto', count: suggestions?.length || 0,
    });
    res.json({ ok: true, suggestions });
  } catch (err) {
    if (err.code === 'AI_NOT_CONFIGURED') return res.status(503).json({ message: err.message });
    console.error('[campaignSuggestions:generate]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/campaign-suggestions/:id   { status }  — dismiss / restore
router.put('/:id', async (req, res) => {
  try {
    const update = {};
    // 'superseded' is accepted so an archived suggestion can be restored to the current
    // batch, and so a dismissal can be undone back to the archive rather than to 'new'.
    if (['new', 'superseded', 'dismissed', 'converted'].includes(req.body?.status)) update.status = req.body.status;
    if (req.body?.linked_campaign_id !== undefined) update.linked_campaign_id = req.body.linked_campaign_id;
    const suggestion = await CampaignSuggestion.findOneAndUpdate({ id: req.params.id }, update, { new: true });
    if (!suggestion) return res.status(404).json({ message: 'Suggestion not found' });
    audit(req, `suggestion_${update.status || 'update'}`, suggestion.id, { title: suggestion.title });
    res.json({ ok: true, suggestion });
  } catch (err) {
    console.error('[campaignSuggestions:update]', err.message);
    res.status(500).json({ message: err.message });
  }
});

/**
 * The campaign description.
 *
 * In the original this was the field that leaked: it was assembled from our own
 * monitoring data, so the campaign read "AMPLIFY — 161 posts on this issue, 108
 * supportive, 53 critical" — internal analysis, in internal vocabulary, as a brief. The
 * model now writes `brief` for exactly this, and the counts stay on the suggestion.
 *
 * Kept here even though this deployment publishes nothing outside the team: the brief is
 * still the only field that reads as instructions rather than as a diagnosis.
 */
const buildBrief = (s) => {
  const points = (s.suggested_news || []).filter(Boolean).slice(0, 4);
  const fallback = s.summary
    ? `This campaign is about ${s.topic || s.title}. ${s.summary}`
    : `This campaign is about ${s.topic || s.title}.`;
  return [
    String(s.brief || fallback).trim(),
    points.length ? `Key points to include:\n${points.map((p) => `• ${p}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 2000);
};

// POST /api/campaign-suggestions/:id/send-to-campaign
// Creates the ViralCampaign in 'draft' and marks the suggestion converted. No approval
// step — see the header. Anything the operator leaves blank falls back to the
// suggestion's own creative.
router.post('/:id/send-to-campaign', async (req, res) => {
  try {
    const suggestion = await CampaignSuggestion.findOne({ id: req.params.id });
    if (!suggestion) return res.status(404).json({ message: 'Suggestion not found' });

    const deadline = req.body?.deadline ? new Date(req.body.deadline) : null;
    if (deadline && Number.isNaN(deadline.getTime())) {
      return res.status(400).json({ message: 'Deadline is not a valid date.' });
    }
    if (deadline && deadline < startOfToday()) {
      return res.status(400).json({ message: 'Deadline cannot be in the past — pick today or a future date.' });
    }

    const platforms = normalizePlatforms(
      Array.isArray(req.body?.target_platforms) && req.body.target_platforms.length
        ? req.body.target_platforms
        : suggestion.target_platforms,
    );
    if (!platforms.length) {
      return res.status(400).json({ message: 'Select at least one platform — we need to know where this should be posted.' });
    }

    // The operator's creative wins; otherwise the suggestion supplies it. `caption` is
    // the important one: suggested_message is the copy meant to be POSTED, and dropping
    // it is how campaigns used to arrive with "No caption" and no message at all.
    const creative = buildCreative(req.body);
    const caption = creative.caption || String(suggestion.suggested_message || '').slice(0, 2000);
    const hashtags = creative.hashtags.length ? creative.hashtags : sanitizeHashtags(suggestion.suggested_hashtags);

    const actor = actorOf(req);
    const now = new Date();
    const campaign = await ViralCampaign.create({
      title: String(req.body?.title || suggestion.title || 'Awareness campaign').trim().slice(0, 200),
      description: String(req.body?.description || '').trim().slice(0, 2000) || buildBrief(suggestion),
      ...creative,
      caption,
      hashtags,
      target_platforms: platforms,
      target_reach: Number(req.body?.target_reach) || undefined,
      budget: Number(req.body?.budget) || undefined,
      location: req.body?.location || undefined,
      deadline: deadline || undefined,
      status: 'draft',
      source: 'ai_suggestion',
      suggestion_id: suggestion.id,
      created_by: actor,
      created_by_role: req.user?.role || '',
      history: [{ action: 'created', by: actor, role: req.user?.role || '', note: 'From AI suggestion', at: now }],
    });

    suggestion.status = 'converted';
    suggestion.linked_campaign_id = campaign.id;
    suggestion.converted_by = actor;
    suggestion.converted_at = now;
    if (!Array.isArray(suggestion.history)) suggestion.history = [];
    suggestion.history.push({ action: 'sent_to_campaign', by: actor, role: req.user?.role || '', note: campaign.id, at: now });
    await suggestion.save();

    audit(req, 'suggestion_converted', suggestion.id, { campaign_id: campaign.id, title: campaign.title });
    res.status(201).json({ ok: true, campaign, suggestion });
  } catch (err) {
    console.error('[campaignSuggestions:sendToCampaign]', err.message);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
