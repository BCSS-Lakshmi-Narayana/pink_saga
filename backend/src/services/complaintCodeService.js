const Counter = require('../models/Counter');

const COUNTER_KEY = 'grievance_complaint_code';

const generateComplaintCode = async () => {
  const counter = await Counter.findOneAndUpdate(
    { key: COUNTER_KEY },
    { $inc: { seq: 1 }, $set: { updated_at: new Date() } },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  );

  return `HCP-${String(counter.seq).padStart(6, '0')}`;
};

const ensureComplaintCode = async (grievance) => {
  if (grievance.complaint_code) return grievance.complaint_code;
  grievance.complaint_code = await generateComplaintCode();
  return grievance.complaint_code;
};

module.exports = {
  COUNTER_KEY,
  generateComplaintCode,
  ensureComplaintCode
};
