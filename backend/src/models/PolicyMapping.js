const mongoose = require('mongoose');

const PolicyMappingSchema = new mongoose.Schema({
    category_id: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    definition: {
        type: String,
        required: true,
        description: "Description used for LLM Prompt context"
    },
    legal_sections: [{
        id: String,
        code: String,
        title: String,
        url: String
    }],
    platform_policies: {
        type: Map,
        of: [{
            id: String,
            name: String,
            url: String
        }],
        default: {}
    },
    keywords: [{
        type: String,
        trim: true
    }],
    severity_level: {
        type: String,
        enum: ['Low', 'Medium', 'High'],
        default: 'Medium'
    },
    is_active: {
        type: Boolean,
        default: true
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

// Update timestamp on save
PolicyMappingSchema.pre('save', function (next) {
    this.updated_at = Date.now();
    next();
});

module.exports = mongoose.model('PolicyMapping', PolicyMappingSchema);
