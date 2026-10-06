const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const templateSchema = new mongoose.Schema({
    id: {
        type: String,
        default: uuidv4,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    platform: {
        type: String,
        enum: ['x', 'youtube', 'facebook', 'instagram', 'all'],
        default: 'all'
    },
    html_content: {
        type: String,
        required: true
    },
    is_default: {
        type: Boolean,
        default: false
    },
    created_by: {
        type: String,
        ref: 'User'
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

module.exports = mongoose.model('Template', templateSchema);
