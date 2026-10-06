const mongoose = require('mongoose');

/**
 * Settings for the YouTube LIVE tab only.
 *
 * Deliberately its own single-document collection rather than a field on the
 * shared `Settings` model, so nothing here can affect monitoring, alerts or
 * grievance configuration.
 */
const youTubeLiveSettingsSchema = new mongoose.Schema({
    id: { type: String, default: 'ytlive', unique: true },

    /**
     * How often to check tracked channels for a NEW live broadcast.
     * This is the going-live check, not the chat read — it costs no YouTube
     * API quota (it reads the public channel page), but each tick makes one
     * request per tracked channel, so it's worth slowing down as the list grows.
     */
    watch_interval_sec: { type: Number, default: 180, min: 30, max: 3600 },

    updated_at: { type: Date, default: Date.now },
    updated_by: { type: String, default: null }
});

module.exports = mongoose.model('YouTubeLiveSettings', youTubeLiveSettingsSchema);
