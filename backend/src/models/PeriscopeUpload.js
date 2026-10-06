const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Stores metadata for each uploaded Periscope DOCX file.
 * The original file is archived in S3 so users can download it later by date.
 */
const periscopeUploadSchema = new mongoose.Schema({
    id: {
        type: String,
        default: uuidv4,
        unique: true
    },
    // The date the document is for (same as DailyProgramme.date)
    date: {
        type: Date,
        required: true,
        index: true,
        unique: true // one upload per date
    },
    // Original filename (e.g. "Periscope for the day 07.02.2026.docx")
    originalFilename: {
        type: String,
        required: true
    },
    // S3 storage info
    s3Key: {
        type: String,
        required: true
    },
    s3Url: {
        type: String,
        required: true
    },
    fileSizeBytes: {
        type: Number,
        default: 0
    },
    // Abstract of Programmes – summary breakdown
    abstract: [{
        categoryKey: String,     // e.g. "category1"
        categoryLabel: String,   // e.g. "Government Programmes /TG, CM/..."
        totalCount: Number,      // total programmes in this category
        items: [{
            name: String,        // programme name
            count: Number        // how many of this type
        }]
    }],
    totalProgrammes: {
        type: Number,
        default: 0
    },
    // Who uploaded it
    uploadedBy: {
        type: String,
        default: 'system'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('PeriscopeUpload', periscopeUploadSchema);
