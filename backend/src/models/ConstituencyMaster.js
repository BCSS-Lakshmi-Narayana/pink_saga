/**
 * ConstituencyMaster
 * ─────────────────────────────────────────────────────────────────────
 * Canonical hierarchical master for every assembly constituency.
 *
 *   AC ─►  District + Lok Sabha + MLA + MP
 *     ├── Mandals  (with aliases)
 *     ├── Villages / landmarks (with aliases)
 *     └── Keywords (free-form tokens used by the location classifier
 *                   heuristic + LLM context)
 *
 * One document per AC. Keyed by `ac_name` (canonical UPPERCASE form that
 * matches User.assigned_constituency and detected_location.constituency).
 *
 * The auto-routing engine builds a reverse alias→AC index from this
 * collection on boot and refreshes it on every write. A post that
 * mentions "Kabirdham" hits the index and routes to KAWARDHA without any
 * LLM call.
 */

const mongoose = require('mongoose');

const aliasSchema = new mongoose.Schema({
    name:    { type: String, required: true, trim: true },
    aliases: { type: [String], default: [] },
}, { _id: false });

const constituencyMasterSchema = new mongoose.Schema({
    ac_name:     { type: String, required: true, unique: true, index: true, trim: true, uppercase: true },
    ac_key:      { type: String, required: true, index: true },

    district:     { type: String, default: null, trim: true },
    district_key: { type: String, default: null, index: true },

    lok_sabha:     { type: String, default: null, trim: true },
    lok_sabha_key: { type: String, default: null, index: true },

    mla_name:  { type: String, default: null, trim: true },
    mla_party: { type: String, default: null, trim: true },

    mp_name:   { type: String, default: null, trim: true },
    mp_party:  { type: String, default: null, trim: true },

    mandals:  { type: [aliasSchema], default: [] },
    villages: { type: [aliasSchema], default: [] },

    // Flat list of additional keywords / hashtags / handles to associate
    // with this AC for classifier matching (e.g. 'TTD', 'Tirumala').
    keywords: { type: [String], default: [] },

    is_active: { type: Boolean, default: true },

    updated_by: { type: String, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
});

const normKey = (v) =>
    String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^a-z0-9]+/g, '')
        .trim();

constituencyMasterSchema.pre('save', function preSave(next) {
    this.updated_at = new Date();
    if (this.ac_name)   this.ac_key      = normKey(this.ac_name);
    if (this.district)  this.district_key = normKey(this.district);
    if (this.lok_sabha) this.lok_sabha_key = normKey(this.lok_sabha);
    next();
});

constituencyMasterSchema.statics.normKey = normKey;

module.exports = mongoose.model('ConstituencyMaster', constituencyMasterSchema);
