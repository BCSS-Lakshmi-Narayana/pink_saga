const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const keywordSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  keyword: {
    type: String,
    required: true
  },
  // 'keyword' | 'hashtag' | 'handle' — lets the UI render the right glyph and
  // ingestion know whether to match a username vs free text.
  kind: {
    type: String,
    enum: ['keyword', 'hashtag', 'handle'],
    default: 'keyword'
  },
  category: {
    type: String,
    enum: ['violence', 'threat', 'hate', 'other'],
    required: true
  },
  language: {
    type: String,
    enum: ['en', 'te', 'ur', 'hi', 'all'],
    default: 'en'
  },
  // Scope: a keyword can be statewide (party-wide) or tied to a single AC.
  // Super admin can own party-wide entries; MLAs own their AC entries.
  constituency: {
    type: String,
    default: null,
    trim: true
  },
  is_party_wide: {
    type: Boolean,
    default: false
  },
  owner_user_id: {
    type: String,
    default: null
  },
  is_active: {
    type: Boolean,
    default: true
  },
  weight: {
    type: Number,
    default: 50
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

// Same keyword text can exist for multiple constituencies (Malkajgiri +
// Mapusa can both track "water shortage") — uniqueness is per-scope.
keywordSchema.index(
  { keyword: 1, constituency: 1, kind: 1 },
  { unique: true, name: 'uniq_keyword_per_scope' }
);

module.exports = mongoose.model('Keyword', keywordSchema);
