const mongoose = require('mongoose');

const twitterAccountSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    email: {
        type: String,
        trim: true
    },
    cookies: {
        type: Array, // Stores Puppeteer cookies
        default: []
    },
    status: {
        type: String,
        enum: ['active', 'locked', 'cooldown', 'suspended'],
        default: 'active'
    },
    last_used: {
        type: Date
    },
    daily_stats: {
        requests: { type: Number, default: 0 },
        date: { type: Date, default: Date.now } // Tracks the date for resetting stats
    },
    proxy: {
        type: String // Optional: 'protocol://user:pass@host:port'
    },
    created_at: {
        type: Date,
        default: Date.now
    }
});

// Method to check if account is ready
twitterAccountSchema.methods.isReady = function () {
    // Check daily limit (conservative 200)
    const isNewDay = new Date().toDateString() !== new Date(this.daily_stats.date).toDateString();
    if (isNewDay) {
        this.daily_stats.requests = 0;
        this.daily_stats.date = new Date();
    }

    return this.status === 'active' && this.daily_stats.requests < 200;
};

module.exports = mongoose.model('TwitterAccount', twitterAccountSchema);
