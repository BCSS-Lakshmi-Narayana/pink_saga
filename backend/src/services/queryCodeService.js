const Counter = require('../models/Counter');

const QUERY_COUNTER_KEY = 'query_unique_code';

/**
 * Generate unique code like Q-X00001-17022026
 * Format: Q-{Platform}{5-digit seq}-DDMMYYYY
 */
const generateQueryCode = async (platform = 'x') => {
  const counter = await Counter.findOneAndUpdate(
    { key: QUERY_COUNTER_KEY },
    { $inc: { seq: 1 }, $set: { updated_at: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();

  const platformPrefix = platform === 'facebook' ? 'F' : platform === 'whatsapp' ? 'W' : 'X';

  return `Q-${platformPrefix}${String(counter.seq).padStart(5, '0')}-${dd}${mm}${yyyy}`;
};

module.exports = {
  QUERY_COUNTER_KEY,
  generateQueryCode
};
