const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const analysisSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  content_id: {
    type: String,
    required: true,
    ref: 'Content'
  },
  risk_score: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  violence_score: {
    type: Number,
    required: false,
    default: 0,
    min: 0,
    max: 1000
  },
  threat_score: {
    type: Number,
    required: false,
    default: 0,
    min: 0,
    max: 1000
  },
  hate_score: {
    type: Number,
    required: false,
    default: 0,
    min: 0,
    max: 1000
  },
  // 'neutral' is the canonical middle label (no positive or negative
  // substance — low risk). 'moderate' is the retired label, still accepted so
  // older rows validate; new writes use 'neutral'.
  sentiment: {
    type: String,
    enum: ['positive', 'neutral', 'negative', 'moderate'],
    required: true
  },
  risk_level: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    required: true
  },
  triggered_keywords: [{
    type: String
  }],
  topic: {
    type: String
  },
  context: {
    type: String
  },
  summary: {
    type: String
  },
  flagged_lines: [{
    line: Number,
    text: String,
    category: String,
    severity: String,
    reason: String
  }],
  explanation: {
    type: String
  },
  intent: {
    type: String
  },
  confidence: {
    type: Number
  },
  language: {
    type: String
  },
  reasons: [{
    type: String
  }],
  highlights: [{
    type: String
  }],
  legal_sections: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },
  violated_policies: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },
  layers: {
    type: mongoose.Schema.Types.Mixed
  },
  threat_model: {
    type: mongoose.Schema.Types.Mixed
  },
  llm_analysis: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  forensic_results: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  analyzed_at: {
    type: Date,
    default: Date.now
  }
});

analysisSchema.index({ content_id: 1 }, { unique: true });

module.exports = mongoose.model('Analysis', analysisSchema);
