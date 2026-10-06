const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  seq: {
    type: Number,
    default: 0
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

counterSchema.pre('save', function preSave(next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model('Counter', counterSchema);
