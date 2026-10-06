const mongoose = require('mongoose');

const xOAuthAccountSchema = new mongoose.Schema({
    display_name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    x_user_id: { type: String },
    profile_image_url: { type: String },
    // OAuth 1.0a tokens (kept for read operations)
    access_token: { type: String },
    access_token_secret: { type: String },
    // Scraper cookies (agent-twitter-client) — used for write operations, no API plan needed
    scraper_cookies: { type: mongoose.Schema.Types.Mixed, default: null },
    auth_method: {
        type: String,
        enum: ['oauth', 'scraper', 'both'],
        default: 'oauth'
    },
    status: {
        type: String,
        enum: ['active', 'suspended', 'rate_limited'],
        default: 'active'
    },
    daily_stats: {
        retweets: { type: Number, default: 0 },
        replies: { type: Number, default: 0 },
        date: { type: Date, default: Date.now }
    },
    connected_by: { type: String },
    created_at: { type: Date, default: Date.now },
    last_used_at: { type: Date }
});

xOAuthAccountSchema.methods.resetDailyIfNeeded = function () {
    const isNewDay = new Date().toDateString() !== new Date(this.daily_stats.date).toDateString();
    if (isNewDay) {
        this.daily_stats.retweets = 0;
        this.daily_stats.replies = 0;
        this.daily_stats.date = new Date();
    }
};

module.exports = mongoose.model('XOAuthAccount', xOAuthAccountSchema);
