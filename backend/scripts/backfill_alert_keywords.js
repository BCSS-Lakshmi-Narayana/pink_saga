/**
 * backfill_alert_keywords.js
 * ─────────────────────────────────────────────────────────────────────
 * Re-tags every alert's `matched_keywords` from its POST text against the
 * current keyword list (Settings → Keywords = the Mentions keyword panel).
 * Alerts used to be matched against their generated summary instead of the
 * post, and handle/hashtag keywords never matched, so most carried none.
 * Offline — no AI calls. Safe to re-run after adding or removing keywords.
 *
 *   node scripts/backfill_alert_keywords.js --dry-run
 *   node scripts/backfill_alert_keywords.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry-run');

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, process.env.DB_NAME ? { dbName: String(process.env.DB_NAME).trim() } : undefined);
    const Alert = require('../src/models/Alert');
    const Content = require('../src/models/Content');
    const { matchConfiguredKeywords } = require('../src/services/monitorService');

    const alerts = await Alert.find({}).select('id content_id matched_keywords').lean();
    const contents = new Map((await Content.find({ id: { $in: alerts.map((a) => a.content_id).filter(Boolean) } })
        .select('id text translated_text').lean()).map((c) => [c.id, c]));

    let tagged = 0, changed = 0;
    const counts = new Map();
    for (const a of alerts) {
        const c = contents.get(a.content_id);
        const text = [c?.text, c?.translated_text].filter(Boolean).join('\n');
        if (!text) continue;
        const matched = await matchConfiguredKeywords(text);
        if (matched.length) tagged += 1;
        for (const m of matched) counts.set(m.keyword, (counts.get(m.keyword) || 0) + 1);
        const before = (a.matched_keywords || []).map((m) => m.keyword).sort().join('|');
        const after = matched.map((m) => m.keyword).sort().join('|');
        if (before === after) continue;
        changed += 1;
        if (!DRY) await Alert.updateOne({ id: a.id }, { $set: { matched_keywords: matched } });
    }
    console.log(`[alert-keywords] dry-run=${DRY} alerts=${alerts.length} tagged=${tagged} changed=${changed}`);
    console.log('  top:', [...counts].sort((x, y) => y[1] - x[1]).slice(0, 15).map(([k, n]) => `${k}:${n}`).join('  '));
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error('[alert-keywords] failed:', e); process.exit(1); });
