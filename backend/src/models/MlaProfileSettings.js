/**
 * MlaProfileSettings
 * ─────────────────────────────────────────────────────────────────────
 * Per-constituency editable configuration that is OPERATIONALLY distinct
 * from the User account (login + RBAC) and from the static ap_mlas.json
 * reference data (canonical names, party).
 *
 * Super-admin uses this collection to:
 *   • override the display name / contact for an MLA
 *   • add custom monitoring keywords scoped to that seat
 *   • register additional social handles to watch for that seat
 *   • mark priority grievance categories the MLA cares about
 *   • set escalation recipients (constituency manager, PA, etc.)
 *
 * Keyed by canonical constituency name (matches the User.assigned_constituency
 * and detected_location.constituency fields used elsewhere). One document
 * per AC; super-admin upserts via the admin API.
 */

const mongoose = require('mongoose');

const mlaProfileSettingsSchema = new mongoose.Schema({
    constituency: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true,
        uppercase: true, // store as AP_MLAS canonical (uppercase) — matches scope filter
    },
    constituency_key: {
        // Normalised lookup key (lowercase, alphanumeric). Auto-derived.
        type: String,
        index: true,
    },
    role: {
        type: String,
        enum: ['mla', 'mp'],
        default: 'mla',
    },
    // Optional Lok Sabha seat when role='mp' (overrides for MP profiles).
    lok_sabha: { type: String, default: null, trim: true },

    display_name: { type: String, default: null, trim: true },
    party:        { type: String, default: null, trim: true },
    contact_email:{ type: String, default: null, trim: true, lowercase: true },
    contact_phone:{ type: String, default: null, trim: true },

    // Free-form notes the super-admin can attach (visible only to admins).
    notes: { type: String, default: '' },

    // Custom monitoring inputs — these supplement the global / party-wide set.
    monitored_handles:    { type: [String], default: [] }, // ['@someMLA','@chair-mandal-x']
    custom_keywords:      { type: [String], default: [] },
    priority_categories:  { type: [String], default: [] }, // e.g. ['Public Complaint','Road & Infrastructure']

    // Who to forward escalations to (free-form list of emails or User.id).
    escalation_to: { type: [String], default: [] },

    is_active: { type: Boolean, default: true },

    updated_by: { type: String, default: null }, // User.id of the admin who last touched it
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
});

mlaProfileSettingsSchema.pre('save', function preSave(next) {
    this.updated_at = new Date();
    if (this.constituency) {
        this.constituency_key = String(this.constituency)
            .toLowerCase()
            .replace(/\([^)]*\)/g, ' ')
            .replace(/[^a-z0-9]+/g, '')
            .trim();
    }
    next();
});

module.exports = mongoose.model('MlaProfileSettings', mlaProfileSettingsSchema);
