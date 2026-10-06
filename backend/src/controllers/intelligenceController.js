/**
 * intelligenceController
 * ─────────────────────────────────────────────────────────────────────
 * Read-only endpoints that power the leadership dashboards:
 *
 *   GET  /api/admin/political-impact         — impact-score table per AC
 *   GET  /api/admin/geo-mapping              — geo-coded grievance markers
 *   GET  /api/admin/manual-review-queue      — pending classifier reviews
 *   POST /api/admin/manual-review-queue/:id/resolve — assign + close a row
 *
 * The first three accept ?window=24h|7d|30d. The manual-review-queue
 * resolution endpoint accepts { constituency, note? } in the body and:
 *   • writes the chosen constituency + routing fan-out to the Grievance
 *   • marks the queue row resolved
 */

const Grievance = require('../models/Grievance');
const ManualReviewQueue = require('../models/ManualReviewQueue');
const { computeImpact, levelFromScore } = require('../services/politicalImpactService');
const { resolveRouting } = require('../services/constituencyMasterService');

const requireSuperAdmin = (req, res) => {
    const role = String(req.user?.role || '').toLowerCase();
    if (role === 'superadmin' || role === 'super_admin') return true;
    res.status(403).json({ code: 'FORBIDDEN', message: 'Super admin only' });
    return false;
};

const parseWindowMs = (windowStr) => {
    const m = String(windowStr || '7d').match(/^(\d+)([hdw])$/);
    if (!m) return 7 * 24 * 60 * 60 * 1000;
    const n = parseInt(m[1], 10);
    const u = m[2];
    return n * (u === 'h' ? 3600e3 : u === 'd' ? 86400e3 : 604800e3);
};

/* ─── Political Impact Score ─────────────────────────────────────── */

const politicalImpact = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const data = await computeImpact({
            window:    req.query.window || '24h',
            minVolume: req.query.minVolume,
            limit:     req.query.limit,
        });
        return res.json({ ok: true, ...data });
    } catch (err) {
        console.error('[intelligence] politicalImpact failed:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/* ─── Geo-Mapping markers ────────────────────────────────────────── */

const COLOR_BY_SEVERITY = {
    critical: 'red',
    high:     'red',
    medium:   'yellow',
    low:      'green',
};

// Closed / resolved workflow states should always render green regardless
// of the original severity.
const RESOLVED_STATES = new Set(['closed', 'action_taken', 'converted_to_fir']);

const geoMapping = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const cutoff = new Date(Date.now() - parseWindowMs(req.query.window || '7d'));
        const find = {
            post_date: { $gte: cutoff },
            'detected_location.constituency': { $ne: null },
            is_active: { $ne: false },
        };
        if (req.query.constituency) {
            find['detected_location.constituency'] = new RegExp(`^${String(req.query.constituency).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        }

        const docs = await Grievance.find(find)
            .select({
                _id: 0,
                id: 1, post_date: 1, workflow_status: 1, content: 1, text: 1,
                'detected_location.lat': 1, 'detected_location.lng': 1,
                'detected_location.constituency': 1, 'detected_location.district': 1,
                'analysis.severity': 1, 'analysis.risk_level': 1, 'analysis.category': 1,
                'analysis.concerned_department': 1, 'analysis.bsk_sentiment': 1,
                engagement: 1,
            })
            .limit(Math.min(parseInt(req.query.limit || '2000', 10), 10000))
            .lean();

        let withCoords = 0;
        const markers = docs.map((d) => {
            const severity = d.analysis?.severity || d.analysis?.risk_level || 'low';
            const isResolved = RESOLVED_STATES.has(d.workflow_status);
            const color = isResolved ? 'green' : (COLOR_BY_SEVERITY[severity] || 'green');
            if (d.detected_location?.lat != null && d.detected_location?.lng != null) withCoords += 1;
            return {
                id: d.id,
                lat:  d.detected_location?.lat ?? null,
                lng:  d.detected_location?.lng ?? null,
                constituency: d.detected_location?.constituency || null,
                district:     d.detected_location?.district     || null,
                severity,
                color,
                workflow_status: d.workflow_status,
                category:    d.analysis?.category || null,
                department:  d.analysis?.concerned_department || null,
                sentiment:   d.analysis?.bsk_sentiment || null,
                engagement_total: (d.engagement?.likes || 0) + (d.engagement?.retweets || 0) + (d.engagement?.replies || 0),
                post_date: d.post_date,
            };
        });

        // Also emit an AC-level aggregate so the UI can render a choropleth
        // when individual markers don't have coords yet.
        const acAgg = {};
        for (const m of markers) {
            if (!m.constituency) continue;
            const a = acAgg[m.constituency] = acAgg[m.constituency] || { ac: m.constituency, district: m.district, counts: { red: 0, yellow: 0, green: 0 }, total: 0 };
            a.counts[m.color] = (a.counts[m.color] || 0) + 1;
            a.total += 1;
        }
        const acRows = Object.values(acAgg).sort((a, b) => b.total - a.total);

        return res.json({
            ok: true,
            window: req.query.window || '7d',
            cutoff,
            color_legend: { red: 'Critical / High', yellow: 'Medium', green: 'Resolved / Low' },
            counts: { total: markers.length, with_coords: withCoords, ac_count: acRows.length },
            markers,
            by_ac: acRows,
        });
    } catch (err) {
        console.error('[intelligence] geoMapping failed:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/* ─── Manual Review Queue ────────────────────────────────────────── */

const listManualReviewQueue = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const status = req.query.status || 'pending';
        const limit  = Math.min(parseInt(req.query.limit || '100', 10), 500);
        const rows = await ManualReviewQueue.find({ status })
            .sort({ created_at: -1 })
            .limit(limit)
            .lean();
        const total = await ManualReviewQueue.countDocuments({ status });
        return res.json({ ok: true, status, total, count: rows.length, rows });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

const resolveManualReview = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const { id } = req.params;
        const { constituency, note } = req.body || {};
        if (!constituency) return res.status(400).json({ ok: false, error: 'constituency is required' });

        const row = await ManualReviewQueue.findOne({ id });
        if (!row) return res.status(404).json({ ok: false, error: 'queue row not found' });
        if (row.status !== 'pending') return res.status(409).json({ ok: false, error: `already ${row.status}` });

        const routing = await resolveRouting(constituency);
        if (!routing?.ac_name) return res.status(400).json({ ok: false, error: `Unknown constituency: ${constituency}` });

        // Stamp the grievance with the human decision (100% confidence by definition).
        await Grievance.findOneAndUpdate(
            { id: row.grievance_id },
            { $set: {
                'detected_location.constituency': routing.ac_name,
                'detected_location.district':     routing.district,
                'detected_location.lok_sabha':    routing.lok_sabha,
                'detected_location.confidence':   1.0,
                'detected_location.source':       'manual_review',
                'detected_location.auto_assigned': false,
                'detected_location.manual_review_required': false,
                'detected_location.reasoning':    `Manually resolved by reviewer (note: ${note || '-'})`,
                routing_targets: {
                    ac_key:        routing.ac_key,
                    district_key:  routing.district_key,
                    lok_sabha_key: routing.lok_sabha_key,
                    dashboards:    routing.dashboards,
                    mla_user_ids:  (routing.mla_users || []).map((u) => u.id),
                    mp_user_ids:   (routing.mp_users  || []).map((u) => u.id),
                    mla_name:      routing.mla_name,
                    mp_name:       routing.mp_name,
                    scope_keys:    routing.scope_keys,
                    resolved_at:   new Date(),
                },
            } }
        );

        row.status                = 'resolved';
        row.resolved_constituency = routing.ac_name;
        row.resolved_by           = req.user?.id || null;
        row.resolved_at           = new Date();
        row.resolution_note       = note || '';
        await row.save();

        return res.json({ ok: true, grievance_id: row.grievance_id, routed_to: routing.ac_name });
    } catch (err) {
        console.error('[intelligence] resolveManualReview failed:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
};

const rejectManualReview = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const { id } = req.params;
        const row = await ManualReviewQueue.findOne({ id });
        if (!row) return res.status(404).json({ ok: false, error: 'queue row not found' });
        if (row.status !== 'pending') return res.status(409).json({ ok: false, error: `already ${row.status}` });
        row.status          = 'rejected';
        row.resolved_by     = req.user?.id || null;
        row.resolved_at     = new Date();
        row.resolution_note = (req.body?.note) || 'Rejected as non-Telangana / out-of-scope';
        await row.save();
        return res.json({ ok: true, id: row.id });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

module.exports = {
    politicalImpact,
    geoMapping,
    listManualReviewQueue,
    resolveManualReview,
    rejectManualReview,
};
