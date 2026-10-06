/**
 * viralCampaignRoutes — the campaigns an AI suggestion turns into.
 *
 * Intentionally small. In the multi-tenant saga this surface carried the whole
 * marketplace: approval, publishing to an auction, influencer bids, awards and proof of
 * delivery. None of that exists here — a campaign is owned by the team that made it, so
 * this is list / read / edit / change status / delete.
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');
const ViralCampaign = require('../models/ViralCampaign');
const CampaignSuggestion = require('../models/CampaignSuggestion');
const { createAuditLog } = require('../services/auditService');
const { buildCreative, normalizePlatforms } = require('../utils/viralCreative');

router.use(protect, requireAnyPageAccess(['/ai-suggestions']));

const STATUSES = ['draft', 'scheduled', 'published', 'completed', 'cancelled'];
const actorOf = (req) => req.user?.full_name || req.user?.name || req.user?.email || 'operator';
const audit = (req, action, id, details) => {
  if (!req.user) return;
  createAuditLog(req.user, action, 'viral_campaign', id, details)
    .catch((err) => console.warn('[viralCampaigns:audit]', err.message));
};

// GET /api/viral-campaigns?status=draft|…|all
router.get('/', async (req, res) => {
  try {
    const filter = req.query.status && req.query.status !== 'all' ? { status: req.query.status } : {};
    const campaigns = await ViralCampaign.find(filter).sort({ created_at: -1 }).lean();
    res.json({ ok: true, campaigns });
  } catch (err) {
    console.error('[viralCampaigns:list]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/viral-campaigns/:id
router.get('/:id', async (req, res) => {
  try {
    const campaign = await ViralCampaign.findOne({ id: req.params.id }).lean();
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    res.json({ ok: true, campaign });
  } catch (err) {
    console.error('[viralCampaigns:get]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/viral-campaigns/:id — edit the creative, or move the status along.
router.put('/:id', async (req, res) => {
  try {
    const campaign = await ViralCampaign.findOne({ id: req.params.id });
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    if (req.body?.status !== undefined) {
      if (!STATUSES.includes(req.body.status)) {
        return res.status(400).json({ message: `Status must be one of: ${STATUSES.join(', ')}` });
      }
      campaign.status = req.body.status;
    }
    if (req.body?.title !== undefined) campaign.title = String(req.body.title).trim().slice(0, 200);
    if (req.body?.description !== undefined) campaign.description = String(req.body.description).trim().slice(0, 2000);
    if (req.body?.target_platforms !== undefined) {
      const platforms = normalizePlatforms(req.body.target_platforms);
      if (!platforms.length) return res.status(400).json({ message: 'Select at least one platform.' });
      campaign.target_platforms = platforms;
    }
    if (req.body?.target_reach !== undefined) campaign.target_reach = Number(req.body.target_reach) || undefined;
    if (req.body?.budget !== undefined) campaign.budget = Number(req.body.budget) || undefined;
    if (req.body?.location !== undefined) campaign.location = req.body.location;
    if (req.body?.deadline !== undefined) {
      const d = req.body.deadline ? new Date(req.body.deadline) : null;
      if (d && Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Deadline is not a valid date.' });
      campaign.deadline = d || undefined;
    }
    // Only overwrite the creative when the caller actually sent one — a status-only
    // PATCH must not blank the caption by passing an empty body through buildCreative.
    if (['content_type', 'caption', 'hashtags', 'media', 'platform_content', 'content_url']
      .some((k) => req.body?.[k] !== undefined)) {
      Object.assign(campaign, buildCreative({ ...campaign.toObject(), ...req.body }));
    }

    campaign.history.push({
      action: 'updated', by: actorOf(req), role: req.user?.role || '',
      note: req.body?.status ? `status → ${req.body.status}` : 'edited', at: new Date(),
    });
    await campaign.save();
    audit(req, 'campaign_updated', campaign.id, { status: campaign.status });
    res.json({ ok: true, campaign });
  } catch (err) {
    console.error('[viralCampaigns:update]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/viral-campaigns/:id
router.delete('/:id', async (req, res) => {
  try {
    const campaign = await ViralCampaign.findOneAndDelete({ id: req.params.id });
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    // Release the suggestion so it can be sent again, rather than being stranded as
    // 'converted' pointing at a campaign that no longer exists.
    if (campaign.suggestion_id) {
      await CampaignSuggestion.updateOne(
        { id: campaign.suggestion_id, status: 'converted' },
        { $set: { status: 'new', linked_campaign_id: '' } },
      ).catch(() => {});
    }
    audit(req, 'campaign_deleted', campaign.id, { title: campaign.title });
    res.json({ ok: true });
  } catch (err) {
    console.error('[viralCampaigns:delete]', err.message);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
