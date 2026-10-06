/**
 * Mojibake healer — the last line of defence for double-encoded text.
 *
 * The RapidAPI X provider intermittently serves a whole response whose UTF-8 was
 * decoded as Windows-1252, so Telugu arrives as "à°µà°°à±�à°·..." and every
 * non-ASCII string in that response is mangled. rapidRequestX() and
 * grievanceService's rapidApiGet() detect this and re-request, which stops
 * almost all of it — but if every retry comes back corrupt, the bad text is
 * written and nothing after that would notice.
 *
 * `contents` recovers on its own because the monitors re-poll each source and
 * overwrite `text`. Grievances do not: they are created once from keyword
 * searches and never re-polled, so a corrupt row stays corrupt forever. Alerts
 * hold no post text of their own — they mirror `author` from the content they
 * were raised on — so they are healed after contents, from the repaired record.
 *
 * This service closes that gap by sweeping for the signature on a schedule and
 * re-fetching the affected posts from the API.
 *
 * Repair-in-place is only attempted when it is provably lossless. For Telugu it
 * never is: Windows-1252 has no mapping for 0x8D/0x8F/0x90, so the bytes behind
 * the virama (U+0C4D = E0 B1 8D) are already gone. Those rows must be re-fetched.
 */
const Content = require('../models/Content');
const Grievance = require('../models/Grievance');
const Alert = require('../models/Alert');
const { looksDoubleEncoded, repairIfLossless } = require('../utils/textEncoding');
const { fetchTweetDetail } = require('./rapidApiXService');

// Bound the work per sweep. Each re-fetch is an API call, and this runs on the
// same process that serves requests — a runaway sweep must never be able to
// starve the event loop or burn the API quota.
const MAX_PER_RUN = Number(process.env.MOJIBAKE_HEAL_MAX_PER_RUN || 40);
const THROTTLE_MS = Number(process.env.MOJIBAKE_HEAL_THROTTLE_MS || 400);

// Server-side prefilter built from codepoints so no source-file or shell
// encoding can distort it: U+00E0 followed by U+00A4-U+00BF is the Latin-1
// rendering of any Indic UTF-8 lead byte.
const ch = (c) => String.fromCharCode(c);
const SIGNATURE = new RegExp(ch(0x00E0) + '[' + ch(0x00A4) + '-' + ch(0x00BF) + ']');

const isBad = (value) => typeof value === 'string' && looksDoubleEncoded(value);
const pause = () => new Promise((r) => setTimeout(r, THROTTLE_MS));

/**
 * Grievance `tweet_id` is namespaced by the ingest path ("x:keyword:2087829…",
 * "alert:<uuid>"), so it is not a tweet id and must never be sent to the API as
 * one — each bad id burns ~10 requests failing over every endpoint. The
 * canonical id is the /status/<id> segment of tweet_url.
 */
const extractTweetId = (doc) => {
  const fromUrl = String(doc.tweet_url || doc.content_url || '').match(/\/status\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  const fromId = String(doc.tweet_id || doc.content_id || '').match(/(\d{10,25})$/);
  return fromId ? fromId[1] : null;
};

const healContents = async (limit, dryRun) => {
  const candidates = await Content.find({ text: SIGNATURE })
    .select('id content_id content_url platform text')
    .limit(limit)
    .lean();

  const corrupt = candidates.filter((d) => isBad(d.text));
  const stats = { found: corrupt.length, repaired: 0, failed: 0 };
  if (dryRun) return stats;

  for (const doc of corrupt) {
    const lossless = repairIfLossless(doc.text);
    if (lossless) {
      await Content.updateOne({ id: doc.id }, { $set: { text: lossless } });
      stats.repaired++;
      continue;
    }

    const tweetId = extractTweetId(doc);
    if (doc.platform !== 'x' || !tweetId) {
      stats.failed++;
      continue;
    }

    try {
      const tweet = await fetchTweetDetail(tweetId);
      if (tweet?.text && !looksDoubleEncoded(tweet.text)) {
        await Content.updateOne(
          { id: doc.id },
          { $set: { text: tweet.text, raw_data: tweet.raw_data || undefined } }
        );
        stats.repaired++;
      } else {
        stats.failed++;
      }
    } catch (err) {
      stats.failed++;
      console.warn(`[MojibakeHealer] content ${doc.content_url} re-fetch failed: ${err.message}`);
    }
    await pause();
  }

  return stats;
};

const healGrievances = async (limit, dryRun) => {
  const candidates = await Grievance.find({
    $or: [
      { 'content.text': SIGNATURE },
      { 'content.full_text': SIGNATURE },
      { 'posted_by.display_name': SIGNATURE }
    ]
  })
    .select('id tweet_id tweet_url platform content posted_by')
    .limit(limit)
    .lean();

  const corrupt = candidates.filter(
    (d) => isBad(d.content?.text) || isBad(d.content?.full_text) || isBad(d.posted_by?.display_name)
  );
  const stats = { found: corrupt.length, repaired: 0, failed: 0 };
  if (dryRun) return stats;

  for (const doc of corrupt) {
    const tweetId = extractTweetId(doc);
    if (doc.platform !== 'x' || !tweetId) {
      stats.failed++;
      continue;
    }

    try {
      const tweet = await fetchTweetDetail(tweetId);
      if (!tweet?.text || looksDoubleEncoded(tweet.text)) {
        stats.failed++;
      } else {
        const set = { 'content.text': tweet.text, 'content.full_text': tweet.text };
        if (tweet.author && !looksDoubleEncoded(tweet.author)) {
          set['posted_by.display_name'] = tweet.author;
        }
        await Grievance.updateOne({ id: doc.id }, { $set: set });
        stats.repaired++;
      }
    } catch (err) {
      stats.failed++;
      console.warn(`[MojibakeHealer] grievance ${doc.tweet_url} re-fetch failed: ${err.message}`);
    }
    await pause();
  }

  return stats;
};

/**
 * Alerts store no post text — they carry `author`, `title` and `description`
 * derived from the content they were raised on, and the API $lookups `contents`
 * for the body. Run after healContents() so the referenced record is already
 * clean, then mirror the author across; fall back to a lossless repair.
 */
const healAlerts = async (limit, dryRun) => {
  const candidates = await Alert.find({
    $or: [{ author: SIGNATURE }, { title: SIGNATURE }, { description: SIGNATURE }]
  })
    .select('id content_id author title description')
    .limit(limit)
    .lean();

  const corrupt = candidates.filter(
    (d) => isBad(d.author) || isBad(d.title) || isBad(d.description)
  );
  const stats = { found: corrupt.length, repaired: 0, failed: 0 };
  if (dryRun) return stats;

  for (const doc of corrupt) {
    const set = {};

    for (const field of ['author', 'title', 'description']) {
      if (!isBad(doc[field])) continue;
      const lossless = repairIfLossless(doc[field]);
      if (lossless) set[field] = lossless;
    }

    // Anything still corrupt: take it from the (already healed) content record.
    if (isBad(doc.author) && !set.author && doc.content_id) {
      const content = await Content.findOne({ content_id: doc.content_id }).select('author').lean();
      if (content?.author && !looksDoubleEncoded(content.author)) set.author = content.author;
    }

    if (Object.keys(set).length) {
      await Alert.updateOne({ id: doc.id }, { $set: set });
      stats.repaired++;
    } else {
      stats.failed++;
    }
  }

  return stats;
};

/**
 * One sweep across all three collections. Safe to call concurrently with normal
 * traffic: work is capped at MAX_PER_RUN per collection and throttled between
 * API calls.
 */
const runMojibakeHealOnce = async ({ maxPerRun = MAX_PER_RUN, dryRun = false } = {}) => {
  const contents = await healContents(maxPerRun, dryRun);
  const grievances = await healGrievances(maxPerRun, dryRun);
  const alerts = await healAlerts(maxPerRun, dryRun); // after contents, so it mirrors clean data

  const total = contents.found + grievances.found + alerts.found;
  if (total > 0) {
    console.log(
      `[MojibakeHealer] contents(found=${contents.found} fixed=${contents.repaired} failed=${contents.failed}) ` +
      `grievances(found=${grievances.found} fixed=${grievances.repaired} failed=${grievances.failed}) ` +
      `alerts(found=${alerts.found} fixed=${alerts.repaired} failed=${alerts.failed})`
    );
  }

  return { contents, grievances, alerts, total };
};

module.exports = {
  runMojibakeHealOnce,
  healContents,
  healGrievances,
  healAlerts,
  extractTweetId,
  SIGNATURE
};
