const mongoose = require('mongoose');

const platformPolicySchema = new mongoose.Schema({
    platform: {
        type: String,
        enum: ['x', 'youtube', 'instagram', 'general'],
        required: true
    },
    policy_name: {
        type: String,
        required: true
    },
    policy_id: {
        type: String,
        required: true,
        unique: true
    },
    description: {
        type: String,
        required: true
    },
    keywords: {
        type: [String],
        default: []
    },
    is_active: {
        type: Boolean,
        default: true
    },
    created_at: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('PlatformPolicy', platformPolicySchema);
