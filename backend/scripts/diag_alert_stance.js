/**
 * Do alerts actually carry a stance, or is the model's claim still true?
 * Alert.js: "Alerts deliberately carry NO stance ... negative by construction;
 * the campaign aggregation pins every alert to anti_target."
 *
 * Run:  node scripts/diag_alert_stance.js [days]
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
  const col = mongoose.connection.db.collection('alerts');
  const days = parseInt(process.argv[2], 10) || 30;
  const q = { created_at: { $gte: new Date(Date.now() - days * 86400000) } };

  const total = await col.countDocuments(q);
  console.log(`\nalerts in last ${days} days: ${total}\n`);

  const group = async (field) => {
    const rows = await col.aggregate([
      { $match: q }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }, { $sort: { n: -1 } },
    ]).toArray();
    console.log(`-- ${field} --`);
    rows.forEach((r) => console.log(`   ${String(r._id)}`.padEnd(30) + r.n));
    console.log();
    return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
  };

  await group('llm_analysis.political_stance');
  await group('llm_analysis.target_sentiment');
  await group('risk_level');
  await group('alert_type');

  const withStance = await col.countDocuments({
    ...q, 'llm_analysis.political_stance': { $nin: [null, ''] },
  });
  console.log(`alerts carrying a political_stance: ${withStance} of ${total}`);
  console.log(withStance === 0
    ? '=> model claim holds: alerts carry NO stance.'
    : '=> some alerts DO carry a stance; a stance split is possible.');

  await mongoose.disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
