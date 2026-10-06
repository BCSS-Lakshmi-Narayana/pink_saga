/**
 * ManualReviewQueue
 * ─────────────────────────────────────────────────────────────────────
 * Holds low-confidence classifier outputs so a human can finalise the
 * routing. When the location classifier returns confidence below the
 * configured threshold (default 0.80), the grievance is stamped with
 * `manual_review_required=true` and a row is inserted here.
 *
 * The super-admin (or a designated reviewer) reads the queue, picks the
 * correct constituency, and submits a resolution. The resolution writes
 * back to the Grievance and removes the queue row.
 */

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const manualReviewQueueSchema = new mongoose.Schema({
    id: { type: String, default: uuidv4, unique: true, index: true },
    grievance_id: { type: String, required: true, index: true },

    text:           { type: String, default: '' },
    user_location:  { type: String, default: '' },
    user_bio:       { type: String, default: '' },
    hashtags:       { type: String, default: '' },
    tagged_account: { type: String, default: '' },

    suggested: {
        constituency: { type: String, default: null },
        district:     { type: String, default: null },
        lok_sabha:    { type: String, default: null },
        confidence:   { type: Number, default: 0 },
        provider:     { type: String, default: null },
        reasoning:    { type: String, default: '' },
        matched_token: { type: String, default: null },
        match_source:  { type: String, default: null },
    },

    status: {
        type: String,
        enum: ['pending', 'resolved', 'rejected'],
        default: 'pending',
        index: true,
    },

    resolved_constituency: { type: String, default: null },
    resolved_by:           { type: String, default: null }, // User.id
    resolved_at:           { type: Date,   default: null },
    resolution_note:       { type: String, default: '' },

    created_at: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model('ManualReviewQueue', manualReviewQueueSchema);
