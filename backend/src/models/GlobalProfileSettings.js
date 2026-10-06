/**
 * GlobalProfileSettings
 * ─────────────────────────────────────────────────────────────────────
 * Singleton document holding state-level (party-wide) configuration that
 * every MLA / MP profile inherits from. Stored as a single row keyed by
 * id='global' so we never need to enumerate or pick "which one".
 *
 * Super-admin uses this to:
 *   • set the master keyword list that drives ingest across all seats
 *   • set the master watch-list of social handles to monitor statewide
 *   • set default escalation contacts (used when an MLA has none)
 *   • toggle pipeline-wide flags (LLM gate on/off, classifier on/off)
 *   • record state-level notes the admin team needs to share
 */

const mongoose = require('mongoose');

const globalProfileSettingsSchema = new mongoose.Schema({
    id: {
        type: String,
        default: 'global',
        unique: true,
        index: true,
    },
    state_keywords:           { type: [String], default: [] },
    state_handles:            { type: [String], default: [] },
    default_priority_categories: { type: [String], default: [] },
    default_escalation_to:    { type: [String], default: [] },

    // Pipeline-wide kill-switches (super-admin only).
    flags: {
        use_llm_classifier:   { type: Boolean, default: true },  // location classifier
        use_llm_categoriser:  { type: Boolean, default: true },  // category/sentiment
        use_political_sentiment: { type: Boolean, default: true },
        // LLM provider strategy used by llmProvider.js:
        //   'auto'     — try Ollama first, fall back to RapidAPI on error
        //   'ollama'   — Ollama only
        //   'rapidapi' — RapidAPI only
        llm_provider: { type: String, enum: ['auto', 'ollama', 'rapidapi'], default: 'auto' },
    },

    notes: { type: String, default: '' },

    updated_by: { type: String, default: null },
    updated_at: { type: Date, default: Date.now },
});

globalProfileSettingsSchema.pre('save', function preSave(next) {
    this.updated_at = new Date();
    if (!this.id) this.id = 'global';
    next();
});

module.exports = mongoose.model('GlobalProfileSettings', globalProfileSettingsSchema);
