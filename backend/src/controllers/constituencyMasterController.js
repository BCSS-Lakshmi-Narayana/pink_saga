/**
 * constituencyMasterController
 * ─────────────────────────────────────────────────────────────────────
 * Super-admin CRUD + bulk import + routing-preview over the
 * ConstituencyMaster collection.
 *
 *   GET    /api/admin/constituency-master                  — list (paginated)
 *   GET    /api/admin/constituency-master/:ac              — single AC
 *   PUT    /api/admin/constituency-master/:ac              — upsert one row
 *   POST   /api/admin/constituency-master/bulk             — bulk upsert (JSON array)
 *   DELETE /api/admin/constituency-master/:ac              — delete a row
 *   POST   /api/admin/constituency-master/route-preview    — preview routing fan-out for a text snippet
 */

const ConstituencyMaster = require('../models/ConstituencyMaster');
const masterService = require('../services/constituencyMasterService');
const { classifyLocation } = require('../services/locationClassifierService');

const normKey = ConstituencyMaster.normKey;

const requireSuperAdmin = (req, res) => {
    const role = String(req.user?.role || '').toLowerCase();
    if (role === 'superadmin' || role === 'super_admin') return true;
    res.status(403).json({ code: 'FORBIDDEN', message: 'Super admin only' });
    return false;
};

/* ─── list ───────────────────────────────────────────────────────── */

const listMaster = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const { district, lok_sabha, q, limit = '500', skip = '0' } = req.query;
        const find = {};
        if (district)  find.district_key  = normKey(district);
        if (lok_sabha) find.lok_sabha_key = normKey(lok_sabha);
        if (q) {
            const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            find.$or = [
                { ac_name: rx },
                { district: rx },
                { lok_sabha: rx },
                { mla_name: rx },
                { mp_name: rx },
                { 'mandals.name': rx },
                { 'villages.name': rx },
                { keywords: rx },
            ];
        }
        const rows = await ConstituencyMaster.find(find)
            .sort({ ac_name: 1 })
            .skip(parseInt(skip, 10))
            .limit(Math.min(parseInt(limit, 10), 1000))
            .lean();
        const total = await ConstituencyMaster.countDocuments(find);
        return res.json({ ok: true, total, count: rows.length, rows });
    } catch (err) {
        console.error('[constituencyMaster] list failed:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/* ─── single ─────────────────────────────────────────────────────── */

const getOne = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const key = normKey(req.params.ac);
        const row = await ConstituencyMaster.findOne({ ac_key: key }).lean();
        if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
        const routing = await masterService.resolveRouting(row.ac_name);
        return res.json({ ok: true, row, routing });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/* ─── upsert (single) ────────────────────────────────────────────── */

const EDITABLE_FIELDS = [
    'district', 'lok_sabha',
    'mla_name', 'mla_party',
    'mp_name', 'mp_party',
    'mandals', 'villages', 'keywords',
    'is_active',
];

const sanitiseAliasList = (input) => {
    if (!Array.isArray(input)) return [];
    return input
        .map((entry) => {
            if (typeof entry === 'string') return { name: entry.trim(), aliases: [] };
            if (entry && typeof entry === 'object') {
                return {
                    name: String(entry.name || '').trim(),
                    aliases: Array.isArray(entry.aliases)
                        ? entry.aliases.map((a) => String(a).trim()).filter(Boolean)
                        : [],
                };
            }
            return null;
        })
        .filter((x) => x && x.name);
};

const buildUpdateDoc = (body) => {
    const update = {};
    for (const f of EDITABLE_FIELDS) {
        if (body[f] === undefined) continue;
        if (f === 'mandals' || f === 'villages') {
            update[f] = sanitiseAliasList(body[f]);
        } else if (f === 'keywords') {
            update[f] = Array.isArray(body[f])
                ? [...new Set(body[f].map((k) => String(k).trim()).filter(Boolean))]
                : [];
        } else {
            update[f] = body[f];
        }
    }
    return update;
};

const upsertOne = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const acName = String(req.params.ac || '').trim();
        if (!acName) return res.status(400).json({ ok: false, error: 'ac is required' });

        const update = buildUpdateDoc(req.body || {});
        update.ac_name = acName.toUpperCase();
        update.ac_key  = normKey(acName);
        if (update.district)  update.district_key  = normKey(update.district);
        if (update.lok_sabha) update.lok_sabha_key = normKey(update.lok_sabha);
        update.updated_by = req.user?.id || null;
        update.updated_at = new Date();

        const doc = await ConstituencyMaster.findOneAndUpdate(
            { ac_key: update.ac_key },
            { $set: update, $setOnInsert: { created_at: new Date() } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        masterService.invalidateCache();
        return res.json({ ok: true, row: doc });
    } catch (err) {
        console.error('[constituencyMaster] upsert failed:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/* ─── bulk upsert ────────────────────────────────────────────────── */

const bulkUpsert = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const items = Array.isArray(req.body?.rows) ? req.body.rows : Array.isArray(req.body) ? req.body : null;
        if (!items) return res.status(400).json({ ok: false, error: 'body.rows must be an array' });

        const ops = [];
        const skipped = [];
        for (const raw of items) {
            const acName = String(raw?.ac_name || raw?.constituency || '').trim();
            if (!acName) { skipped.push({ reason: 'missing ac_name', raw }); continue; }
            const update = buildUpdateDoc(raw);
            update.ac_name = acName.toUpperCase();
            update.ac_key  = normKey(acName);
            if (update.district)  update.district_key  = normKey(update.district);
            if (update.lok_sabha) update.lok_sabha_key = normKey(update.lok_sabha);
            update.updated_by = req.user?.id || null;
            update.updated_at = new Date();

            ops.push({
                updateOne: {
                    filter: { ac_key: update.ac_key },
                    update: { $set: update, $setOnInsert: { created_at: new Date() } },
                    upsert: true,
                },
            });
        }
        if (ops.length === 0) {
            return res.status(400).json({ ok: false, error: 'no valid rows', skipped });
        }

        const result = await ConstituencyMaster.bulkWrite(ops, { ordered: false });
        masterService.invalidateCache();
        return res.json({
            ok: true,
            attempted: ops.length,
            upserted: result.upsertedCount || 0,
            modified: result.modifiedCount || 0,
            matched:  result.matchedCount  || 0,
            skipped,
        });
    } catch (err) {
        console.error('[constituencyMaster] bulkUpsert failed:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/* ─── delete ─────────────────────────────────────────────────────── */

const deleteOne = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const r = await ConstituencyMaster.deleteOne({ ac_key: normKey(req.params.ac) });
        masterService.invalidateCache();
        return res.json({ ok: true, deleted: r.deletedCount });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/* ─── routing preview ────────────────────────────────────────────── */

/**
 * POST /api/admin/constituency-master/route-preview
 *   { text, userLocation?, userBio?, hashtags?, taggedAccount? }
 *
 *   Runs the full pipeline (classifier → routing engine) and returns
 *   exactly what would be stamped on the grievance if this post landed
 *   in production.
 */
const routePreview = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const { text, userLocation, userBio, hashtags, taggedAccount } = req.body || {};
        if (!text) return res.status(400).json({ ok: false, error: 'text is required' });

        const verdict = await classifyLocation(text, { userLocation, userBio, hashtags, taggedAccount });
        if (!verdict) return res.json({ ok: true, verdict: null, routing: null });

        const routing = await masterService.resolveRouting(verdict.constituency);
        return res.json({ ok: true, verdict, routing });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

/* ─── stats ──────────────────────────────────────────────────────── */

const stats = async (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    try {
        const total      = await ConstituencyMaster.countDocuments({});
        const withDistrict  = await ConstituencyMaster.countDocuments({ district: { $ne: null } });
        const withMandals   = await ConstituencyMaster.countDocuments({ 'mandals.0': { $exists: true } });
        const withVillages  = await ConstituencyMaster.countDocuments({ 'villages.0': { $exists: true } });
        const withMp        = await ConstituencyMaster.countDocuments({ mp_name: { $ne: null } });
        return res.json({ ok: true, total, withDistrict, withMandals, withVillages, withMp });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

module.exports = {
    listMaster,
    getOne,
    upsertOne,
    bulkUpsert,
    deleteOne,
    routePreview,
    stats,
};
