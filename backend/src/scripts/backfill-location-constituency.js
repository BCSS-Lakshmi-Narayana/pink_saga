/**
 * backfill-location-constituency.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One-shot backfill of `detected_location.constituency` on the existing Alert
 * and NewsArticle backlog, via constituencyLocationSweepService — the same
 * resolver Grievances have used at ingest all along. Constituency Leader
 * Popularity's per-seat numbers only cover what has a constituency; without
 * this the feature launches seeing 0% of alerts and 0% of news.
 *
 * Measured before this ran:
 *      alerts       11,461 total —     0 placed (0.0%)
 *      newsarticles  3,656 total —     0 placed (0.0%, constituency did not exist as a field)
 *
 * The live scheduler in index.js (startConstituencySweep) handles every NEW
 * alert/article automatically from here on, at a small trickle — this script
 * exists only to drain the backlog that predates it, once.
 *
 * DEFAULT MODE IS A DRY RUN: it resolves and reports without writing anything.
 * Only --apply persists. Every write also goes through classifyLocation's own
 * confidence gate (LOCATION_AUTO_ASSIGN_THRESHOLD, default 0.80) — nothing
 * ambiguous gets stamped.
 *
 * COST — READ BEFORE RUNNING --apply WITHOUT --offline-only
 * ──────────────────────────────────────────────────────────
 * Tiers 1+2 (person-mention match, master alias index, plain name match) are
 * free and instant. Tier 3 falls back to a paid RapidAPI call for text neither
 * of those places. On the grievance corpus that tier alone accounts for ~26%
 * of all placements (6,157 of 24,105) — i.e. a full backlog run WILL spend
 * quota. Dry-run first and read the `would call RapidAPI for` count below
 * before deciding. `--offline-only` skips tier 3 entirely — free, but leaves
 * ambiguous text unplaced (same trade-off documented in
 * constituencyLocationSweepService.classifyOffline).
 *
 * USAGE
 *   node src/scripts/backfill-location-constituency.js                        # dry run, all surfaces
 *   node src/scripts/backfill-location-constituency.js --surface alert        # dry run, alerts only
 *   node src/scripts/backfill-location-constituency.js --offline-only         # dry run, no RapidAPI cost estimate needed
 *   node src/scripts/backfill-location-constituency.js --apply --limit 500    # write, first 500 per surface
 *   node src/scripts/backfill-location-constituency.js --apply --offline-only # write, free tiers only
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Alert = require('../models/Alert');
const NewsArticle = require('../models/NewsArticle');
const Content = require('../models/Content');
const { locateText, sweepAlerts, sweepNews } = require('../services/constituencyLocationSweepService');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  if (i === -1 || i + 1 >= args.length) return d;
  return args[i + 1];
};

const APPLY = has('--apply');
const OFFLINE_ONLY = has('--offline-only');
const SURFACE = val('--surface', 'all'); // alert | news | all
const LIMIT = parseInt(val('--limit', '0'), 10) || 0; // 0 = everything pending
const BATCH = Math.min(parseInt(val('--batch', '25'), 10) || 25, 100);

const log = (m) => console.log(`[backfill-location] ${m}`);

/* ─── dry-run reporting (read-only, mirrors the sweep's own read side) ────── */

const dryRunAlerts = async (limit) => {
  const q = { 'detected_location.attempted_at': null };
  const total = await Alert.countDocuments(q);
  const sample = await Alert.find(q).sort({ created_at: -1 }).limit(Math.min(limit || total, 500))
    .select('id content_id author_handle').lean();

  const contentIds = [...new Set(sample.map((a) => a.content_id).filter(Boolean))];
  const contents = contentIds.length
    ? await Content.find({ id: { $in: contentIds } }).select('id text translated_text').lean()
    : [];
  const contentMap = new Map(contents.map((c) => [c.id, c]));

  let placeable = 0, viaRapidapi = 0, unplaceable = 0;
  for (const a of sample) {
    const content = contentMap.get(a.content_id);
    const text = content?.translated_text || content?.text || '';
    const loc = await locateText(text, { handle: a.author_handle }, { offlineOnly: OFFLINE_ONLY });
    if (loc) {
      placeable += 1;
      if (loc.source?.startsWith('ap_classifier:rapidapi')) viaRapidapi += 1;
    } else {
      unplaceable += 1;
    }
  }
  return { total, sampled: sample.length, placeable, viaRapidapi, unplaceable };
};

const dryRunNews = async (limit) => {
  const q = { 'detected_location.attempted_at': null };
  const total = await NewsArticle.countDocuments(q);
  const sample = await NewsArticle.find(q).sort({ scraped_at: -1 }).limit(Math.min(limit || total, 500))
    .select('title title_english summary content').lean();

  let placeable = 0, viaRapidapi = 0, unplaceable = 0;
  for (const article of sample) {
    const text = [article.title_english || article.title, article.summary, article.content]
      .filter(Boolean).join(' ').slice(0, 1500);
    const loc = await locateText(text, {}, { offlineOnly: OFFLINE_ONLY });
    if (loc) {
      placeable += 1;
      if (loc.source?.startsWith('ap_classifier:rapidapi')) viaRapidapi += 1;
    } else {
      unplaceable += 1;
    }
  }
  return { total, sampled: sample.length, placeable, viaRapidapi, unplaceable };
};

/* ─── apply mode — batches through the real sweep functions until drained ── */

const applySurface = async (name, sweepFn, cap) => {
  let scanned = 0, placed = 0, unplaceable = 0, rounds = 0;
  for (;;) {
    const remaining = cap ? cap - scanned : BATCH;
    if (cap && remaining <= 0) break;
    const res = await sweepFn({ limit: Math.min(BATCH, remaining || BATCH), offlineOnly: OFFLINE_ONLY });
    if (!res.scanned) break;
    scanned += res.scanned;
    placed += res.placed;
    unplaceable += res.unplaceable;
    rounds += 1;
    if (rounds % 10 === 0 || res.scanned < BATCH) {
      log(`${name}: scanned=${scanned} placed=${placed} unplaceable=${unplaceable}`);
    }
  }
  log(`${name} done: scanned=${scanned} placed=${placed} unplaceable=${unplaceable}`);
  return { scanned, placed, unplaceable };
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  log(`mode=${APPLY ? 'APPLY' : 'DRY RUN'} surface=${SURFACE} offlineOnly=${OFFLINE_ONLY}${LIMIT ? ` limit=${LIMIT}` : ''}`);

  if (!APPLY) {
    if (SURFACE === 'alert' || SURFACE === 'all') {
      const r = await dryRunAlerts(LIMIT);
      log(`ALERTS  pending=${r.total} sampled=${r.sampled} → placeable=${r.placeable} (of which via RapidAPI=${r.viaRapidapi}) unplaceable=${r.unplaceable}`);
    }
    if (SURFACE === 'news' || SURFACE === 'all') {
      const r = await dryRunNews(LIMIT);
      log(`NEWS    pending=${r.total} sampled=${r.sampled} → placeable=${r.placeable} (of which via RapidAPI=${r.viaRapidapi}) unplaceable=${r.unplaceable}`);
    }
    log('Dry run only — nothing written. Re-run with --apply to persist.');
  } else {
    if (SURFACE === 'alert' || SURFACE === 'all') await applySurface('ALERTS', sweepAlerts, LIMIT);
    if (SURFACE === 'news' || SURFACE === 'all') await applySurface('NEWS', sweepNews, LIMIT);
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error('[backfill-location] fatal:', err);
  process.exit(1);
});
