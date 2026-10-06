const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const telegramGroupSchema = new mongoose.Schema({
    id: {
        type: String,
        default: uuidv4,
        unique: true
    },
    telegram_id: {
        type: String,
        required: true,
        unique: true
    },
    title: {
        type: String,
        required: true
    },
    username: {
        type: String,
        default: ''
    },
    access_hash: {
        type: String,
        default: ''
    },
    type: {
        type: String,
        enum: ['public', 'private'],
        default: 'public'
    },
    member_count: {
        type: Number,
        default: 0
    },
    invite_link: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['joined', 'left', 'pending', 'discovered'],
        default: 'discovered'
    },
    is_active: {
        type: Boolean,
        default: true
    },
    last_scraped_at: {
        type: Date
    },
    message_count: {
        type: Number,
        default: 0
    },
    unread_count: {
        type: Number,
        default: 0
    },
    last_message_id: {
        type: Number,
        default: 0
    },
    top_message_id: {
        type: Number,
        default: 0
    },
    created_at: {
        type: Date,
        default: Date.now
    },
    updated_at: {
        type: Date,
        default: Date.now
    }
});

telegramGroupSchema.pre('save', function (next) {
    this.updated_at = Date.now();
    next();
});

telegramGroupSchema.index({ status: 1 });

module.exports = mongoose.model('TelegramGroup', telegramGroupSchema);
