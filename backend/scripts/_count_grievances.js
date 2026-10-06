require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const dbs = await db.admin().listDatabases();
  for (const d of dbs.databases) {
    if (['admin','local','config'].includes(d.name)) continue;
    const conn = mongoose.connection.useDb(d.name, { useCache: false });
    const cols = await conn.db.listCollections().toArray();
    const gcol = cols.find(c => c.name === 'grievances');
    if (gcol) {
      const total = await conn.db.collection('grievances').countDocuments();
      const sentimentAgg = await conn.db.collection('grievances').aggregate([
        { $group: { _id: '$analysis.sentiment', count: { $sum: 1 } } }
      ]).toArray();
      const topicAgg = await conn.db.collection('grievances').aggregate([
        { $group: { _id: '$analysis.grievance_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 5 }
      ]).toArray();
      console.log(`[${d.name}] grievances=${total}`);
      console.log('  sentiment:', sentimentAgg);
      console.log('  top topics:', topicAgg);
    }
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
