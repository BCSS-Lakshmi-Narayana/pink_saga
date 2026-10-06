const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const youTubeTranscriptSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  transcript_id: {
    type: String,
    required: true,
    index: true
  },
  platform: {
    type: String,
    enum: ['youtube'],
    default: 'youtube',
    required: true
  },
  video_id: {
    type: String,
    required: true,
    index: true
  },
  youtube_url: {
    type: String,
    required: true
  },
  title: {
    type: String
  },
  duration_seconds: {
    type: Number
  },
  language: {
    type: String
  },
  transcript: {
    type: String,
    required: true
  },
  transcript_lines: {
    type: [String],
    default: []
  },
  requested_by: {
    user_id: String,
    user_email: String,
    user_name: String
  },
  status: {
    type: String,
    enum: ['stored', 'gemini_completed', 'gemini_failed'],
    default: 'stored'
  },
  gemini: {
    model: String,
    topic: String,
    context: String,
    summary: String,
    flags: mongoose.Schema.Types.Mixed,
    flagged_lines: [
      {
        line: Number,
        text: String,
        category: String,
        severity: String,
        reason: String
      }
    ],
    analyzed_at: Date,
    error: String,
    raw_response: String
  },
  created_at: {
    type: Date,
    default: Date.now,
    index: true
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

youTubeTranscriptSchema.index({ platform: 1, video_id: 1, created_at: -1 });

youTubeTranscriptSchema.pre('save', function (next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model('YouTubeTranscript', youTubeTranscriptSchema);
