const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const dailyProgrammeSchema = new mongoose.Schema({
    id: {
        type: String,
        default: uuidv4,
        unique: true
    },
    // Date for the programme (indexed for filtering)
    date: {
        type: Date,
        required: true,
        index: true
    },
    // Category information
    category: {
        type: String,
        enum: ['category1', 'category2', 'category3', 'category4'],
        required: true
    },
    categoryLabel: {
        type: String,
        default: ''
    },
    // Programme details
    slNo: {
        type: Number,
        default: 1
    },
    zone: {
        type: String,
        default: ''
    },
    programName: {
        type: String,
        default: ''
    },
    location: {
        type: String,
        default: ''
    },
    organizer: {
        type: String,
        default: ''
    },
    expectedMembers: {
        type: Number,
        default: 0
    },
    time: {
        type: String,
        default: ''
    },
    gist: {
        type: String,
        default: ''
    },
    permission: {
        type: String,
        enum: ['By Information', 'Permitted', 'Applied for Permission', 'Rejected'],
        default: 'By Information'
    },
    comments: {
        type: String,
        default: 'Required L&O and Traffic BB'
    },
    // Metadata
    createdBy: {
        type: String,
        default: 'system'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update timestamp on save
dailyProgrammeSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

// Compound index for efficient date + category queries
dailyProgrammeSchema.index({ date: 1, category: 1 });
dailyProgrammeSchema.index({ date: 1, category: 1, slNo: 1 });

module.exports = mongoose.model('DailyProgramme', dailyProgrammeSchema);
