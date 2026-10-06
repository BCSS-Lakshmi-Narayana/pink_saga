const Counter = require('../models/Counter');

const CRITICISM_COUNTER_KEY = 'criticism_unique_code';

/**
 * Generate unique code like C-X00001-17022026
 * Format: C-X{5-digit seq}-DDMMYYYY
 */
const generateCriticismCode = async (platform = 'x') => {
  const counter = await Counter.findOneAndUpdate(
    { key: CRITICISM_COUNTER_KEY },
    { $inc: { seq: 1 }, $set: { updated_at: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();

  const platformPrefix = platform === 'facebook' ? 'F' : platform === 'whatsapp' ? 'W' : 'X';

  return `C-${platformPrefix}${String(counter.seq).padStart(5, '0')}-${dd}${mm}${yyyy}`;
};

module.exports = {
  CRITICISM_COUNTER_KEY,
  generateCriticismCode
};
