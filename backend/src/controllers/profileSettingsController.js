/**
 * profileSettingsController
 * ─────────────────────────────────────────────────────────────────────
 * Super-admin CRUD over:
 *   • MlaProfileSettings   — one document per AC / LS seat
 *   • GlobalProfileSettings — singleton (id='global')
 *
 * All endpoints require role=superadmin (enforced at the route layer).
 */

const MlaProfileSettings = require('../models/MlaProfileSettings');
const GlobalProfileSettings = require('../models/GlobalProfileSettings');
const User = require('../models/User');
const Grievance = require('../models/Grievance');
const Alert = require('../models/Alert');
const {
    CONSTITUENCIES,
    AC_TO_LS,
    DISTRICT_BY_AC,
} = require('../services/locationClassifierService');

/* ─── helpers ────────────────────────────────────────────────────── */

const normKey = (v) =>
    String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^a-z0-9]+/g, '')
        .trim();

const canonicalConstituency = (input) => {
    const key = normKey(input);
    return CONSTITUENCIES.find((c) => normKey(c) === key) || null;
};

const requireSuperAdmin = (req, res) => {
    const role = String(req.user?.role || '').toLowerCase();
    if (role === 'superadmin' || role === 'super_admin') return true;
    res.status(403).json({ code: 'FORBIDDEN', message: 'Super admin only' });
    return false;
};

/* ─── MLA profile settings ───────────────────────────────────────── */

/**
 * GET /api/admin/mla-profiles
 *   Returns one row per constituency with operational counts joined
 *   (grievances, alerts, user logins). Includes seats with no settings
 *   doc yet so the admin UI can list every AC.
 */
const listMlaProfiles = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const settings = await MlaProfileSettings.find({}).lean();
        const byKey = Object.fromEntries(settings.map((s) => [normKey(s.constituency), s]));

        // Pull user counts + grievance/alert counts in bulk for the dashboard view.
        const [grievanceAgg, alertAgg, users] = await Promise.all([
            Grievance.aggregate([
                { $match: { 'detected_location.constituency': { $ne: null } } },
                { $group: { _id: '$detected_location.constituency', count: { $sum: 1 } } },
            ]),
            Alert.aggregate([
                { $match: { constituency: { $ne: null } } },
                { $group: { _id: '$constituency', count: { $sum: 1 } } },
            ]),
            User.find({ role: { $in: ['mla', 'mp'] } })
                .select('id email role assigned_constituency assigned_lok_sabha is_active last_login_at')
                .lean(),
        ]);

        const grievanceCountsByKey = Object.fromEntries(grievanceAgg.map((r) => [normKey(r._id), r.count]));
        const alertCountsByKey     = Object.fromEntries(alertAgg.map((r) => [normKey(r._id), r.count]));
        const usersByKey = users.reduce((acc, u) => {
            const key = u.role === 'mla'
                ? normKey(u.assigned_constituency)
                : normKey(u.assigned_lok_sabha);
            if (!key) return acc;
            (acc[key] = acc[key] || []).push({
                id: u.id,
                email: u.email,
                role: u.role,
                is_active: u.is_active,
                last_login_at: u.last_login_at,
            });
            return acc;
        }, {});

        const rows = CONSTITUENCIES.map((c) => {
            const key = normKey(c);
            const s = byKey[key] || {};
            return {
                constituency: c,
                constituency_key: key,
                lok_sabha: AC_TO_LS[key] || null,
                district:  DISTRICT_BY_AC[key] || null,
                role: 'mla',
                display_name:        s.display_name        || null,
                party:               s.party               || null,
                contact_email:       s.contact_email       || null,
                contact_phone:       s.contact_phone       || null,
                monitored_handles:   s.monitored_handles   || [],
                custom_keywords:     s.custom_keywords     || [],
                priority_categories: s.priority_categories || [],
                escalation_to:       s.escalation_to       || [],
                notes:               s.notes               || '',
                is_active:           s.is_active !== false,
                updated_at:          s.updated_at          || null,
                updated_by:          s.updated_by          || null,
                grievance_count:     grievanceCountsByKey[key] || 0,
                alert_count:         alertCountsByKey[key]     || 0,
                logins:              usersByKey[key] || [],
                has_settings_doc:    !!byKey[key],
            };
        });

        return res.json({ ok: true, count: rows.length, rows });
    } catch (err) {
        console.error('[profileSettings] listMlaProfiles failed:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/**
 * GET /api/admin/mla-profiles/:constituency
 *   Single MLA profile detail (or 404).
 */
const getMlaProfile = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const canonical = canonicalConstituency(req.params.constituency);
        if (!canonical) return res.status(404).json({ ok: false, error: 'Unknown constituency' });

        const settings = await MlaProfileSettings.findOne({ constituency: canonical }).lean();
        const key = normKey(canonical);
        const logins = await User.find({
            role: { $in: ['mla', 'mp'] },
            $or: [
                { assigned_constituency: canonical },
                // Stored as the slug; older rows may hold the display name ("Hyderabad").
                ...(AC_TO_LS[key]
                    ? [{ assigned_lok_sabha: { $regex: `^${AC_TO_LS[key].replace(/[^a-z0-9]/gi, '').split('').join('[^a-z0-9]*')}$`, $options: 'i' } }]
                    : []),
            ],
        }).select('id email role assigned_constituency assigned_lok_sabha is_active last_login_at').lean();

        return res.json({
            ok: true,
            constituency: canonical,
            lok_sabha: AC_TO_LS[key] || null,
            district:  DISTRICT_BY_AC[key] || null,
            settings: settings || null,
            logins,
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/**
 * PUT /api/admin/mla-profiles/:constituency
 *   Upsert the per-MLA settings. Body accepts any subset of editable fields.
 */
const upsertMlaProfile = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const canonical = canonicalConstituency(req.params.constituency);
        if (!canonical) return res.status(404).json({ ok: false, error: 'Unknown constituency' });

        const body = req.body || {};
        const update = {
            constituency:     canonical,
            constituency_key: normKey(canonical), // findOneAndUpdate bypasses pre('save')
        };
        const fields = [
            'role', 'lok_sabha', 'display_name', 'party',
            'contact_email', 'contact_phone', 'notes',
            'monitored_handles', 'custom_keywords',
            'priority_categories', 'escalation_to', 'is_active',
        ];
        for (const f of fields) {
            if (body[f] !== undefined) update[f] = body[f];
        }
        update.updated_by = req.user?.id || null;
        update.updated_at = new Date();

        const doc = await MlaProfileSettings.findOneAndUpdate(
            { constituency: canonical },
            { $set: update, $setOnInsert: { created_at: new Date() } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        return res.json({ ok: true, profile: doc });
    } catch (err) {
        console.error('[profileSettings] upsertMlaProfile failed:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/**
 * DELETE /api/admin/mla-profiles/:constituency
 *   Removes the settings doc (NOT the user login or grievances).
 */
const deleteMlaProfile = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const canonical = canonicalConstituency(req.params.constituency);
        if (!canonical) return res.status(404).json({ ok: false, error: 'Unknown constituency' });
        const r = await MlaProfileSettings.deleteOne({ constituency: canonical });
        return res.json({ ok: true, deleted: r.deletedCount });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/* ─── Global profile (singleton) ─────────────────────────────────── */

const ensureGlobal = async () => {
    let doc = await GlobalProfileSettings.findOne({ id: 'global' });
    if (!doc) {
        doc = await GlobalProfileSettings.create({ id: 'global' });
    }
    return doc;
};

const getGlobalProfile = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const doc = await ensureGlobal();
        return res.json({ ok: true, profile: doc });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

const updateGlobalProfile = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const body = req.body || {};
        const update = { updated_by: req.user?.id || null, updated_at: new Date() };
        const fields = [
            'state_keywords', 'state_handles',
            'default_priority_categories', 'default_escalation_to',
            'flags', 'notes',
        ];
        for (const f of fields) {
            if (body[f] !== undefined) update[f] = body[f];
        }
        const doc = await GlobalProfileSettings.findOneAndUpdate(
            { id: 'global' },
            { $set: update, $setOnInsert: { id: 'global' } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        // Pick up changes to flags.llm_provider on the next LLM call.
        try { require('../services/llmProvider').invalidateProviderCache(); } catch (_) {}
        return res.json({ ok: true, profile: doc });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/* ─── classifier debug endpoint ──────────────────────────────────── */

/**
 * POST /api/admin/classify-location
 *   Body: { text, userLocation?, userBio?, hashtags?, taggedAccount? }
 *   Returns the same shape classifyLocation produces. Useful for the
 *   admin UI to preview where a post would route before persisting it.
 */
const classifyLocationPreview = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const { classifyLocation } = require('../services/locationClassifierService');
        const { text, userLocation, userBio, hashtags, taggedAccount } = req.body || {};
        if (!text) return res.status(400).json({ ok: false, error: 'text is required' });
        const verdict = await classifyLocation(text, { userLocation, userBio, hashtags, taggedAccount });
        return res.json({ ok: true, verdict });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/**
 * POST /api/admin/test-ollama
 *   Pings the configured Ollama endpoint, lists available models, then runs
 *   a tiny chat round-trip so admins can verify provider health. Optional
 *   body: { prompt } (defaults to a JSON probe).
 */
const testOllama = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const ollama = require('../services/ollamaLLMService');
        const ping = await ollama.ping(8000).catch((err) => ({ ok: false, error: err.message }));

        const prompt = (req.body && req.body.prompt) || 'Reply with one JSON object: {"ok": true}';
        const t0 = Date.now();
        let echo = null;
        let echoError = null;
        try {
            echo = await ollama.chatJson({ prompt, temperature: 0, maxTokens: 50, timeoutMs: 15000 });
        } catch (err) {
            echoError = err.message;
        }
        return res.json({
            ok: !!ping.ok && !echoError,
            ping,
            echo: { result: echo, latency_ms: Date.now() - t0, error: echoError },
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

module.exports = {
    listMlaProfiles,
    getMlaProfile,
    upsertMlaProfile,
    deleteMlaProfile,
    getGlobalProfile,
    updateGlobalProfile,
    classifyLocationPreview,
    testOllama,
};
