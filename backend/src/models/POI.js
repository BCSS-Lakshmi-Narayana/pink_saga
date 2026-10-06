const mongoose = require('mongoose');

const poiSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true
    },
    realName: {
        type: String,
        trim: true,
        default: ''
    },
    aliasNames: [String],
    mobileNumbers: [String],
    emailIds: [String],
    lastUsedIp: {
        type: String,
        trim: true,
        default: ''
    },
    softwareHardwareIdentifiers: {
        type: String,
        trim: true,
        default: ''
    },
    currentAddress: {
        type: String,
        trim: true,
        default: ''
    },
    psLimits: {
        type: String,
        trim: true,
        default: ''
    },
    districtCommisionerate: {
        type: String,
        trim: true,
        default: ''
    },
    firDetails: [{
        firNo: { type: String, default: '' },
        psLimits: { type: String, default: '' },
        districtCommisionerate: { type: String, default: '' }
    }],
    linkedIncidents: {
        type: String,
        trim: true,
        default: ''
    },
    whatsappNumbers: [{
        type: String,
        trim: true
    }],
    firNo: {
        type: String,
        trim: true,
        default: ''
    },
    previouslyDeletedProfiles: {
        x: { type: [String], default: [] },
        facebook: { type: [String], default: [] },
        instagram: { type: [String], default: [] },
        youtube: { type: [String], default: [] },
        whatsapp: { type: [String], default: [] }
    },
    briefSummary: {
        type: String,
        trim: true,
        default: ''
    },
    escalatedToIntermediariesCount: {
        type: Number,
        default: 0
    },
    profileImage: {
        type: String,
        default: ''
    },
    customFields: [{
        label: { type: String, required: true },
        value: { type: String, default: '' }
    }],
    socialMedia: [{
        platform: {
            type: String,
            enum: ['x', 'facebook', 'instagram', 'youtube', 'whatsapp'],
            required: true
        },
        sourceId: {
            type: String,
            default: null   // optional — null for manually added entries
        },
        handle: String,
        profileImage: String,
        displayName: String,
        followerCount: { type: String, default: '' },   // editable followers/subscriber count
        createdDate: { type: String, default: '' },     // editable account creation date
        category: { type: String, default: 'others' },
        priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
        is_active: { type: Boolean, default: true },
        linkedAt: { type: Date, default: Date.now }
    }],
    status: {
        type: String,
        enum: ['active', 'archived'],
        default: 'active'
    },
    // RBAC: which AC this POI belongs to. Null = party-wide / state-level.
    constituency: {
        type: String,
        default: null,
        trim: true
    },
    is_party_wide: {
        type: Boolean,
        default: false
    },
    createdBy: {
        type: String,
        default: 'system'
    },
    s3ReportUrl: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

poiSchema.index({ 'socialMedia.handle': 1 });
poiSchema.index({ 'socialMedia.displayName': 1 });
poiSchema.index({ name: 'text', firNo: 'text', briefSummary: 'text' });
poiSchema.index({ status: 1 });
poiSchema.index({ createdAt: -1 });

module.exports = mongoose.model('POI', poiSchema);
