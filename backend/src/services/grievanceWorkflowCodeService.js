const Counter = require('../models/Counter');

const GRIEVANCE_WF_COUNTER_KEY = 'grievance_workflow_unique_code';

/**
 * Generate unique code like G-X00001-17022026
 * Format: G-{Platform}{5-digit seq}-DDMMYYYY
 */
const generateGrievanceWorkflowCode = async (platform = 'x') => {
  const counter = await Counter.findOneAndUpdate(
    { key: GRIEVANCE_WF_COUNTER_KEY },
    { $inc: { seq: 1 }, $set: { updated_at: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();

  const platformPrefix = platform === 'facebook' ? 'F' : platform === 'whatsapp' ? 'W' : 'X';

  return `G-${platformPrefix}${String(counter.seq).padStart(5, '0')}-${dd}${mm}${yyyy}`;
};

module.exports = {
  GRIEVANCE_WF_COUNTER_KEY,
  generateGrievanceWorkflowCode
};
