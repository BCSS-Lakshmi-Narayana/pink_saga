const mongoose = require('mongoose');

const pagePermissionSchema = new mongoose.Schema({
    user_id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    allowed_pages: [{
        type: String
    }],
    // Feature-level permissions: { "/alerts": { enabled: true, features: ["active","reports"] }, ... }
    permissions: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    updated_by: {
        type: String,
        default: null
    },
    updated_at: {
        type: Date,
        default: Date.now
    }
});

// Update the updated_at timestamp on save
pagePermissionSchema.pre('save', function (next) {
    this.updated_at = new Date();
    next();
});

module.exports = mongoose.model('PagePermission', pagePermissionSchema);
