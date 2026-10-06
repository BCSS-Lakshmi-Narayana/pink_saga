const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const masterCalendarEventSchema = new mongoose.Schema({
  id: { type: String, default: uuidv4, unique: true },
  slNo: { type: Number, required: true },
  occasion: { type: String, required: true, trim: true },
  date: { type: String, required: true, trim: true },          // e.g. "26 January" (day-month for recurring)
  monitoringRange: { type: String, default: '', trim: true },   // e.g. "24 Jan – 28 Jan"
  keywords: { type: String, default: '', trim: true },          // comma-separated keywords
  remarks: { type: String, default: '', trim: true },
  isRecurring: { type: Boolean, default: true },
  createdBy: { type: String, default: 'system' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

masterCalendarEventSchema.index({ isRecurring: 1, slNo: 1 });

masterCalendarEventSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('MasterCalendarEvent', masterCalendarEventSchema);
