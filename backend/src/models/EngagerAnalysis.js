const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const engagerSchema = new mongoose.Schema({
  handle: { type: String, required: true },
  name: { type: String, default: null },
  avatar: { type: String, default: null },
  verified: { type: Boolean, default: false },
  user_id: { type: String, default: null },
  tweets_retweeted: { type: Number, default: 0 },
  tweet_ids: [{ type: String }],
  frequency: { type: String, enum: ['super-active', 'regular', 'occasional', 'one-time'], default: 'one-time' },
  retweet_ids: { type: Map, of: String, default: {} }
}, { _id: false });

const tweetSnapshotSchema = new mongoose.Schema({
  tweet_id: { type: String, required: true },
  text: { type: String, default: '' },
  created_at: { type: Date, default: null },
  content_url: { type: String, default: '' },
  retweet_count: { type: Number, default: 0 },
  retweeters_found: { type: Number, default: 0 }
}, { _id: false });

const engagerAnalysisSchema = new mongoose.Schema({
  id: { type: String, default: uuidv4, unique: true },
  handle: { type: String, required: true, index: true },
  handle_lower: { type: String, required: true, index: true },
  display_name: { type: String, default: null },
  avatar: { type: String, default: null },
  source_id: { type: String, default: null, ref: 'Source' },
  analyzed_at: { type: Date, default: Date.now },
  period_days: { type: Number, default: 30 },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  error: { type: String, default: null },
  tweets_analyzed: { type: Number, default: 0 },
  total_retweet_events: { type: Number, default: 0 },
  unique_retweeters: { type: Number, default: 0 },
  summary: {
    super_active: { type: Number, default: 0 },
    regular: { type: Number, default: 0 },
    occasional: { type: Number, default: 0 },
    one_time: { type: Number, default: 0 }
  },
  engagers: [engagerSchema],
  tweets: [tweetSnapshotSchema]
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

engagerAnalysisSchema.index({ handle_lower: 1, analyzed_at: -1 });
engagerAnalysisSchema.index({ status: 1, analyzed_at: -1 });

module.exports = mongoose.model('EngagerAnalysis', engagerAnalysisSchema);
