const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const searchHistorySchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  user_id: {
    type: String,
    required: true
  },
  user_email: {
    type: String,
    default: ''
  },
  query: {
    type: String,
    required: true,
    trim: true
  },
  query_normalized: {
    type: String,
    required: true,
    trim: true
  },
  results_search_text: {
    type: String,
    default: '',
    trim: true
  },
  search_type: {
    type: String,
    enum: ['profiles', 'content'],
    required: true
  },
  platform: {
    type: String,
    enum: ['all', 'x', 'youtube', 'reddit', 'facebook', 'instagram'],
    required: true
  },
  total_results: {
    type: Number,
    default: 0
  },
  platform_counts: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  platform_errors: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  duration_ms: {
    type: Number,
    default: 0
  },
  results: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  searched_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'search_history'
});

searchHistorySchema.index({ user_id: 1, searched_at: -1 });
searchHistorySchema.index({ user_id: 1, search_type: 1, searched_at: -1 });
searchHistorySchema.index({ user_id: 1, platform: 1, searched_at: -1 });
searchHistorySchema.index({ user_id: 1, search_type: 1, platform: 1, searched_at: -1 });
searchHistorySchema.index({ user_id: 1, query_normalized: 1, searched_at: -1 });
searchHistorySchema.index({ user_id: 1, query: 'text', results_search_text: 'text' });

module.exports = mongoose.model('SearchHistory', searchHistorySchema);
