const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const reportSchema = new mongoose.Schema({
    id: {
        type: String,
        default: uuidv4,
        unique: true
    },
    serial_number: {
        type: String,
        required: true,
        unique: true
    },
    alert_id: {
        type: String,
        ref: 'Alert',
        required: true
    },
    title: {
        type: String,
        default: 'NOTICE: U/Sec:69(A) & 79(3) Information Technology Amendment Act 2008 and 94 BNSS'
    },
    target_user_details: {
        name: String,
        handle: String,
        profile_url: String,
        avatar_url: String,
        is_verified: Boolean
    },
    content_summary: {
        type: String
    },
    media_links: [{
        type: String
    }],
    legal_sections: [{
        act: String,
        section: String,
        description: String
    }],
    violated_policies: [{
        platform: String,
        policy_id: String,
        policy_name: String
    }],
    platform: {
        type: String,
        enum: ['x', 'youtube', 'facebook', 'instagram'],
        required: true
    },
    pdf_url: {
        type: String
    },
    status: {
        type: String,
        enum: ['generated', 'printed', 'sent', 'sent_to_intermediary', 'awaiting_reply', 'closed'],
        default: 'sent_to_intermediary'
    },
    generated_at: {
        type: Date,
        default: Date.now
    },
    edited_content: {
        type: Map,
        of: String,
        default: {}
    }
});


// ─── Lookup and join indexes ───
reportSchema.index({ alert_id: 1 });
reportSchema.index({ alert_id: 1, generated_at: -1 });

// ─── Primary sort indexes (all queries sort by generated_at) ───
reportSchema.index({ generated_at: -1, id: -1 });

// ─── Single filter + sort ───
reportSchema.index({ platform: 1, generated_at: -1, id: -1 });
reportSchema.index({ status: 1, generated_at: -1, id: -1 });

// ─── Common filter combinations + sort ───
reportSchema.index({ platform: 1, status: 1, generated_at: -1, id: -1 });
reportSchema.index({ status: 1, platform: 1, generated_at: -1 });

// ─── Date range filtering (for startDate/endDate) ───
reportSchema.index({ generated_at: 1 });

// ─── Search indexes ───
reportSchema.index({ 'target_user_details.handle': 1 });
reportSchema.index({ 'target_user_details.name': 1 });
reportSchema.index({ serial_number: 1 });

module.exports = mongoose.model('Report', reportSchema);
