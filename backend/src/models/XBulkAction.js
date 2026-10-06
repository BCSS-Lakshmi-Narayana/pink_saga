const mongoose = require('mongoose');

const xBulkActionSchema = new mongoose.Schema({
    batch_id: { type: String, required: true }, // groups all posts in one bulk run
    action_type: {
        type: String,
        enum: ['retweet', 'reply', 'quote_tweet'],
        required: true
    },
    account_username: { type: String, required: true },
    tweet_id: { type: String, required: true },
    tweet_url: { type: String },
    tweet_text: { type: String },
    // For reply/quote_tweet
    reply_text: { type: String },
    media_urls: [{ type: String }],
    status: {
        type: String,
        enum: ['pending', 'success', 'failed', 'skipped'],
        default: 'pending'
    },
    error_message: { type: String },
    executed_by: { type: String }, // user email
    executed_at: { type: Date },
    created_at: { type: Date, default: Date.now }
});

xBulkActionSchema.index({ batch_id: 1 });
xBulkActionSchema.index({ created_at: -1 });
xBulkActionSchema.index({ account_username: 1, created_at: -1 });

module.exports = mongoose.model('XBulkAction', xBulkActionSchema);
