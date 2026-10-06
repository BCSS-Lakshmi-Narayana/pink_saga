const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * A YouTube channel tracked for live broadcasts, plus the state of the
 * broadcast currently being read. One document per tracked channel; the
 * live_* fields are rewritten each time that channel goes live again.
 */
const liveStreamSchema = new mongoose.Schema({
    id: { type: String, default: uuidv4, unique: true },

    // ─── tracked channel ───
    channel_ref: { type: String, required: true, unique: true },   // @handle or UC… as entered
    channel_id: { type: String, default: null },                   // resolved UC…
    channel_name: { type: String, default: '' },
    is_active: { type: Boolean, default: true },                   // watch this channel?

    /**
     * Editorial leaning of the channel, fed to the LLM as context. A
     * opposition-aligned outlet's chat skews pro-opposition, and knowing that helps the
     * model read ambiguous comments — it never overrides an individual verdict.
     */
    alignment: {
        type: String,
        enum: ['ally', 'opposition', 'neutral', 'unknown'],
        default: 'unknown'
    },

    /**
     * Minimum seconds between chat reads for this channel. 0 = follow whatever
     * interval YouTube asks for (usually 10s).
     *
     * Polling SLOWER is always safe: the continuation token is a cursor, so a
     * longer gap returns the same messages in fewer, larger reads — nothing is
     * lost. Useful for keeping total request volume down when several channels
     * are being watched at once.
     */
    poll_interval_sec: { type: Number, default: 0, min: 0, max: 300 },

    /**
     * Every broadcast this channel has live right now, refreshed on each
     * watcher tick and ranked by audience.
     *
     * A news channel routinely runs several at once — a rolling 24/7 feed plus
     * one stream per event — and `/live` only ever exposes YouTube's single
     * primary pick, so the rest were invisible. This is the full list the UI
     * offers; only `video_id` below is actually read for chat.
     */
    available_streams: {
        type: [{
            _id: false,
            video_id: { type: String },
            title: { type: String, default: '' },
            viewers: { type: Number, default: 0 },
            thumbnail: { type: String, default: null },
        }],
        default: []
    },

    // Throttles re-scraping the ~1MB /streams page (see STREAMS_REFRESH_MS).
    available_streams_updated_at: { type: Date, default: null },

    /**
     * The broadcast the user explicitly chose to monitor.
     *
     * Sticky: while this stream stays live it is monitored even if a bigger one
     * appears, because "most viewers" is not the same as "the one worth
     * watching". Null means nobody has chosen, and the watcher falls back to
     * the largest live stream so a newly-added channel is never dead.
     */
    selected_video_id: { type: String, default: null },

    // ─── current / last broadcast (the one being read) ───
    video_id: { type: String, default: null, index: true },
    video_title: { type: String, default: '' },
    thumbnail: { type: String, default: null },

    status: {
        type: String,
        enum: ['idle', 'live', 'ended', 'error'],
        default: 'idle',
        index: true
    },

    // InnerTube cursor — lets a restarted poller resume mid-stream.
    continuation: { type: String, default: null },
    chat_disabled: { type: Boolean, default: false },
    last_error: { type: String, default: null },

    // ─── counters ───
    message_count: { type: Number, default: 0 },
    sentiment_counts: {
        positive: { type: Number, default: 0 },
        neutral: { type: Number, default: 0 },
        negative: { type: Number, default: 0 }
    },

    started_at: { type: Date, default: null },
    ended_at: { type: Date, default: null },
    last_polled_at: { type: Date, default: null },

    created_by: { type: String, default: 'system' },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

liveStreamSchema.pre('save', function (next) {
    this.updated_at = new Date();
    next();
});

liveStreamSchema.index({ is_active: 1, status: 1 });

module.exports = mongoose.model('LiveStream', liveStreamSchema);
