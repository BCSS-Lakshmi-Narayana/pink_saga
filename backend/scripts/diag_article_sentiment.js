/**
 * Diagnostic: what do newsarticles actually hold in the brief's window?
 *
 * NewsArticle.js documents that `sentiment` is the RAW tone and defaults to
 * 'neutral', while the client-relative verdict lives in `political_stance` /
 * `target_sentiment`. If the brief reads `sentiment`, every unanalysed row
 * counts as neutral and the figure is meaningless.
 *
 * Run:  node scripts/diag_article_sentiment.js [days]
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
  const col = mongoose.connection.db.collection('newsarticles');

  const days = parseInt(process.argv[2], 10) || 30;
  const from = new Date(Date.now() - days * 86400000);
  const q = { published_date: { $gte: from } };

  const total = await col.countDocuments(q);
  console.log(`\nnewsarticles published in the last ${days} days: ${total}\n`);

  const group = async (field, match = q) => {
    const rows = await col.aggregate([
      { $match: match },
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]).toArray();
    console.log(`-- ${field} --`);
    rows.forEach((r) => console.log(`   ${String(r._id)}`.padEnd(30) + r.n));
    console.log();
    return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
  };

  const rawMap = await group('sentiment');
  const stanceMap = await group('political_stance');
  await group('target_sentiment');

  const analysedQ = { ...q, pipeline_analyzed_at: { $ne: null } };
  const analysed = await col.countDocuments(analysedQ);
  console.log(`analysed (pipeline_analyzed_at set) : ${analysed}`);
  console.log(`NOT analysed                        : ${total - analysed}\n`);

  console.log('-- political_stance, ANALYSED rows only --');
  const stanceAnalysed = await group('political_stance', analysedQ);

  const pro = (stanceAnalysed.pro_target || 0) + (stanceAnalysed.pro_target_indirect || 0);
  const anti = (stanceAnalysed.anti_target || 0) + (stanceAnalysed.anti_target_indirect || 0);
  const neu = stanceAnalysed.neutral || 0;
  const unrel = stanceAnalysed.unrelated || 0;

  console.log('====================================================');
  console.log('WHAT THE BRIEF REPORTS NOW  (raw `sentiment`, all rows)');
  console.log(`   supportive ${rawMap.positive || 0}`
    + `  |  neutral ${(rawMap.neutral || 0) + (rawMap.moderate || 0)}`
    + `  |  opposing ${rawMap.negative || 0}`);
  console.log('WHAT IT SHOULD REPORT  (political_stance, analysed only, unrelated dropped)');
  console.log(`   supportive ${pro}  |  neutral ${neu}  |  opposing ${anti}`
    + `   [${unrel} unrelated excluded]`);
  console.log('====================================================\n');

  await mongoose.disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
