/**
 * verify_cm_brief — the CM brief's contract, checked against the live database.
 *
 * Run this after ANY change to the brief, its controller, or the pages it links
 * into. It runs the real getCMBrief (no mocks, no fixtures) and checks two
 * things that have each broken in production:
 *
 *   PART 1 — THE NUMBERS
 *     Every figure comes from STANCE, not raw sentiment. `unrelated` counts as
 *     neutral exactly as utils/stanceFilter.js groups it. Neutral is counted but
 *     never shown and never in a denominator, so scores are computed over the
 *     people who took a side. supportive + opposing == that stream's decisive
 *     total, and the headline == the three streams added.
 *
 *   PART 2 — THE EVIDENCE LINKS
 *     Every figure on the page links to the rows behind it. A link is a claim,
 *     so each one must RETURN ROWS. This caught a real defect: the brief groups
 *     by `analysis.topic` (campaign taxonomy) while the grievance filter only
 *     searched `analysis.grievance_type` (intent taxonomy), so every issue link
 *     showed "No grievances found".
 *
 * Run:  node scripts/verify_cm_brief.js [days]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { getCMBrief } = require('../src/controllers/cmDashboardController');

const days = parseInt(process.argv[2], 10) || 30;
let failures = 0;

const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} got ${got}  want ${want}`);
};
/** A link that returns nothing is a claim the page cannot support. */
const returnsRows = (label, got) => {
  const ok = got > 0;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${got} rows`);
};

const STANCE = {
  supportive: ['pro_target', 'pro_target_indirect'],
  opposing: ['anti_target', 'anti_target_indirect'],
};
const rx = (v) => new RegExp(String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
  const db = mongoose.connection.db;

  const payload = await new Promise((resolve, reject) => {
    getCMBrief(
      { query: { days: String(days) } },
      { json: resolve, status: () => ({ json: (e) => reject(new Error(e.message)) }) },
    );
  });

  const from = new Date(Date.now() - days * 86400000);
  const S = payload.by_source;
  const C = payload.combined;
  const gr = db.collection('grievances');
  const arts = db.collection('newsarticles');
  const alerts = db.collection('alerts');
  const mBase = { post_date: { $gte: from }, is_active: { $ne: false } };
  const aBase = { published_date: { $gte: from } };
  const lBase = { created_at: { $gte: from } };

  /* ══ PART 1 · THE NUMBERS ═══════════════════════════════════════════════ */
  console.log(`\n████ PART 1 — THE NUMBERS (${days}d) ████`);

  console.log(`\n=== ARTICLES ===`);
  const ast = Object.fromEntries((await arts.aggregate([
    { $match: aBase }, { $group: { _id: '$political_stance', n: { $sum: 1 } } },
  ]).toArray()).map((r) => [String(r._id), r.n]));
  const aPro = (ast.pro_target || 0) + (ast.pro_target_indirect || 0);
  const aAnti = (ast.anti_target || 0) + (ast.anti_target_indirect || 0);
  const aNeu = (ast.neutral || 0) + (ast.unrelated || 0);
  check('articles.supportive', S.articles.supportive, aPro);
  check('articles.neutral (incl. unrelated)', S.articles.neutral, aNeu);
  check('articles.opposing', S.articles.opposing, aAnti);
  check('articles.total (everything collected)', S.articles.total, await arts.countDocuments(aBase));

  console.log(`\n=== ALERTS ===`);
  const lst = Object.fromEntries((await alerts.aggregate([
    { $match: lBase }, { $group: { _id: '$llm_analysis.political_stance', n: { $sum: 1 } } },
  ]).toArray()).map((r) => [String(r._id), r.n]));
  check('alerts.supportive', S.alerts.supportive,
    (lst.pro_target || 0) + (lst.pro_target_indirect || 0));
  check('alerts.neutral (incl. unrelated)', S.alerts.neutral,
    (lst.neutral || 0) + (lst.unrelated || 0));
  check('alerts.opposing', S.alerts.opposing,
    (lst.anti_target || 0) + (lst.anti_target_indirect || 0));

  // risk_level, folded exactly as apDashboardController line 651 does
  const rows = await alerts.aggregate([
    { $match: lBase },
    {
      $group: {
        _id: {
          level: '$risk_level',
          neutral: {
            $in: [{ $ifNull: ['$llm_analysis.target_sentiment',
              { $ifNull: ['$llm_analysis.bsk_sentiment', ''] }] }, ['moderate', 'neutral']],
          },
        },
        n: { $sum: 1 },
      },
    },
  ]).toArray();
  const wantRisk = { critical: 0, high: 0, medium: 0, neutral: 0, low: 0 };
  for (const r of rows) {
    const lvl = r._id.level;
    if (!lvl) continue;
    if (r._id.neutral && lvl === 'low') wantRisk.neutral += r.n;
    else if (wantRisk[lvl] !== undefined) wantRisk[lvl] += r.n;
  }
  for (const k of ['critical', 'high', 'medium', 'neutral', 'low']) {
    check(`alerts.risk.${k} matches the existing API`, S.alerts.risk[k], wantRisk[k]);
  }

  console.log(`\n=== MENTIONS ===`);
  check('mentions.total (everything collected)', S.mentions.total, await gr.countDocuments(mBase));

  console.log(`\n=== IT ALL ADDS UP ===`);
  for (const k of ['mentions', 'articles', 'alerts']) {
    const r = S[k];
    check(`${k}: supportive+opposing == decisive`, r.supportive + r.opposing, r.decisive);
    check(`${k}: +neutral == analysed`, r.decisive + r.neutral, r.analysed);
    check(`${k}: score over decisive only`, r.score,
      r.decisive ? Math.round(((r.supportive - r.opposing) / r.decisive) * 100) : null);
    console.log(`      ${k}: ${r.supportive} supportive · ${r.opposing} opposing `
      + `= ${r.decisive} took a side  (${r.neutral} neutral, not shown)`);
  }
  check('headline == the three streams added', C.total,
    S.mentions.decisive + S.articles.decisive + S.alerts.decisive);
  check('headline == supportive + opposing', C.total, C.supportive + C.opposing);

  console.log(`\n=== ISSUE TRACKER ===`);
  const buckets = days <= 7 ? 7 : days <= 30 ? 10 : 12;
  const t0 = payload.issue_tracking[0];
  check('bucket count follows the window', t0 ? t0.series.length : buckets, buckets);
  check('movement only claimed with >=15 per half',
    payload.issue_tracking.every((t) => t.movement === null
      || (t.early_total >= 15 && t.late_total >= 15)), true);

  console.log(`\n=== COVERAGE LIST ===`);
  check('recent_news carries only scored coverage',
    (payload.recent_news || []).every((a) => ['pro', 'anti'].includes(a.stance)), true);

  /* ══ PART 2 · THE EVIDENCE LINKS ════════════════════════════════════════ */
  console.log(`\n████ PART 2 — THE EVIDENCE LINKS ████`);

  // The OR the grievance controller builds for ?topic=
  const topicOr = (t) => ({
    $or: [
      { 'analysis.topic': rx(t) },
      { 'analysis.grievance_type': rx(t) },
      { 'analysis.category': rx(t) },
    ],
  });

  console.log(`\n=== /grievances?topic=<t>  (every issue row) ===`);
  for (const t of (payload.issue_tracking || []).slice(0, 8).map((x) => x.topic)) {
    returnsRows(`topic=${t}`, await gr.countDocuments({ ...mBase, ...topicOr(t) }));
  }

  console.log(`\n=== /grievances?stance=<s>  (headline + mention rows) ===`);
  for (const [word, vals] of Object.entries(STANCE)) {
    returnsRows(`stance=${word}`,
      await gr.countDocuments({ ...mBase, 'analysis.political_stance': { $in: vals } }));
  }

  console.log(`\n=== /grievances?topic=<t>&stance=opposing  (CM tile rows) ===`);
  for (const t of (payload.principal?.topics || []).slice(0, 3).map((x) => x.topic)) {
    returnsRows(`topic=${t} + opposing`, await gr.countDocuments({
      ...mBase, ...topicOr(t), 'analysis.political_stance': { $in: STANCE.opposing },
    }));
  }

  /**
   * District rows link to /geographic-intelligence/<district>, NOT to
   * /grievances?location=. A district figure counts news AND social, and some
   * districts are listed purely on news coverage — Sarangarh-Bilaigarh had 0
   * grievances, so the mentions link showed an empty page for a row claiming
   * real volume. Geo Intel covers both streams, so it can always show the rows.
   */
  console.log(`\n=== /geographic-intelligence/<d>  (district rows) ===`);
  for (const d of (payload.districts || []).slice(0, 6)) {
    const social = await gr.countDocuments({ ...mBase, 'detected_location.district': d.district });
    const news = await arts.countDocuments({ ...aBase, 'detected_location.district': d.district });
    returnsRows(`${d.district}  (${news} news + ${social} social)`, news + social);
  }

  console.log(`\n=== /public-web-articles?stance=<s>  (coverage pills) ===`);
  for (const [word, vals] of Object.entries(STANCE)) {
    returnsRows(`article stance=${word}`,
      await arts.countDocuments({ ...aBase, political_stance: { $in: vals } }));
  }

  console.log(`\n=== /alerts?stance=<s> and ?risk=high  (alert tiles) ===`);
  for (const [word, vals] of Object.entries(STANCE)) {
    returnsRows(`alert stance=${word}`,
      await alerts.countDocuments({ ...lBase, 'llm_analysis.political_stance': { $in: vals } }));
  }
  returnsRows('alert risk=high', await alerts.countDocuments({ ...lBase, risk_level: 'high' }));

  console.log(`\n${failures
    ? `${failures} CHECK(S) FAILED`
    : 'ALL CHECKS PASSED — figures reconcile and every link returns rows'}`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
