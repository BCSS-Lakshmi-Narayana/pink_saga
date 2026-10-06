const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const telegramMessageSchema = new mongoose.Schema({
    id: {
        type: String,
        default: uuidv4,
        unique: true
    },
    telegram_message_id: {
        type: Number,
        required: true
    },
    group_id: {
        type: String,
        required: true, // Refers to TelegramGroup.id
        index: true
    },
    sender_id: {
        type: String
    },
    sender_name: {
        type: String
    },
    sender_username: {
        type: String
    },
    text: {
        type: String,
        default: ''
    },
    media: [{
        type: { type: String }, // 'photo', 'video', 'document', etc.
        file_id: String,
        url: String,
        s3_url: String,
        s3_key: String,
        fileName: String,
        fileSize: Number,
        mimeType: String
    }],
    links: [String],
    date: {
        type: Date,
        required: true
    },
    reply_to: {
        type: Number
    },
    forwarded_from: {
        type: mongoose.Schema.Types.Mixed
    },
    analyzed: {
        type: Boolean,
        default: false
    },
    risk_score: {
        type: Number,
        default: 0
    },
    risk_level: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical', 'none'],
        default: 'none'
    },
    created_at: {
        type: Date,
        default: Date.now
    }
});

telegramMessageSchema.index({ group_id: 1, telegram_message_id: 1 }, { unique: true });
telegramMessageSchema.index({ date: -1 });

// Repair UTF-8-read-as-Latin-1 text on every write path. No-op unless the
// unambiguous mojibake signature is present — see utils/textEncoding.js.
telegramMessageSchema.plugin(require('../utils/textEncoding').mojibakeGuardPlugin);

module.exports = mongoose.model('TelegramMessage', telegramMessageSchema);
