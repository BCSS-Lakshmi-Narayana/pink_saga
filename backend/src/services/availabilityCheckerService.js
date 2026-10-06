/**
 * availabilityCheckerService.js
 * ─────────────────────────────
 * Periodically checks whether the original Instagram content (posts, reels,
 * stories) is still live on the platform.  When the original CDN URL returns
 * a 404 / 410 / network error, we mark the content as "deleted" or "expired"
 * so the frontend can show "Deleted at …" or "Expired" labels.
 *
 * The actual media is still available via the S3 copy — no data is lost.
 */

const axios = require('axios');
const Content = require('../models/Content');
const InstagramStory = require('../models/InstagramStory');

// ─── Configuration ─────────────────────────────────────────────────────────
const CHECK_BATCH_SIZE = 50;          // how many docs per run
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;  // don't re-check the same doc within 6 h
const REQUEST_TIMEOUT_MS = 15000;     // 15 s
const CONCURRENCY = 5;                // parallel HEAD requests

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Check if a single URL is still accessible.
 * Uses HEAD first (fast), falls back to GET with range if HEAD is blocked.
 * @returns {'available'|'deleted'|'unknown'}
 */
const checkUrl = async (url) => {
  if (!url || typeof url !== 'string') return 'unknown';

  try {
    const res = await axios.head(url, {
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true, // don't throw on any status
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const status = res.status;

    // 2xx / 3xx = still live
    if (status >= 200 && status < 400) return 'available';

    // 404, 410 = definitely removed
    if (status === 404 || status === 410) return 'deleted';

    // 403 can mean CDN token expired (Instagram does this) — try GET fallback
    if (status === 403) {
      return await checkUrlGet(url);
    }

    // 429 / 5xx = transient — don't mark as deleted
    return 'unknown';
  } catch (err) {
    // Network errors (ECONNREFUSED, timeout, DNS) — transient
    return 'unknown';
  }
};

/**
 * Fallback GET with range header (downloads only 1 byte to verify).
 */
const checkUrlGet = async (url) => {
  try {
    const res = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Range: 'bytes=0-0'
      },
      responseType: 'arraybuffer'
    });
    if (res.status >= 200 && res.status < 400) return 'available';
    if (res.status === 404 || res.status === 410) return 'deleted';
    return 'unknown';
  } catch (_) {
    return 'unknown';
  }
};

/**
 * Process batches with limited concurrency.
 */
const processConcurrent = async (items, fn, concurrency = CONCURRENCY) => {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
};

// ─── Core Check Logic ──────────────────────────────────────────────────────

/**
 * Check a single Content document's original URLs.
 * The function determines the best URL to check:
 *  1. content_url (the Instagram permalink)
 *  2. The first media item's original_url (CDN link)
 *  3. The first media item's url (current link)
 */
const getCheckableUrl = (doc) => {
  // For Instagram posts/reels the permalink is the most reliable indicator
  if (doc.content_url && /instagram\.com\/(p|reel|stories)\//i.test(doc.content_url)) {
    return doc.content_url;
  }
  // Fallback: original CDN URL from first media item
  const firstMedia = doc.media?.[0];
  if (firstMedia?.original_url) return firstMedia.original_url;
  if (firstMedia?.url) return firstMedia.url;
  return doc.content_url || null;
};

/**
 * Run a batch availability check for Content documents.
 * Selects documents that:
 *  - Are on Instagram
 *  - Are not already marked deleted
 *  - Haven't been checked recently
 *  - Have S3 archives (so media is safe regardless)
 *
 * @returns {{ checked, deleted, expired, errors }}
 */
const runContentAvailabilityCheck = async (options = {}) => {
  const {
    batchSize = CHECK_BATCH_SIZE,
    platform = 'instagram',
    forceRecheck = false
  } = options;

  const recheckCutoff = forceRecheck
    ? new Date()
    : new Date(Date.now() - RECHECK_INTERVAL_MS);

  // Find documents due for a check
  const docs = await Content.find({
    platform,
    is_media_archived: true,
    availability_status: { $ne: 'deleted' }, // don't re-check confirmed deletions
    $or: [
      { last_availability_check: null },
      { last_availability_check: { $lt: recheckCutoff } }
    ]
  })
    .sort({ last_availability_check: 1 })  // oldest checks first
    .limit(batchSize)
    .lean();

  if (docs.length === 0) {
    return { checked: 0, deleted: 0, expired: 0, errors: 0 };
  }

  const stats = { checked: 0, deleted: 0, expired: 0, errors: 0 };

  await processConcurrent(docs, async (doc) => {
    try {
      const url = getCheckableUrl(doc);
      if (!url) {
        await Content.updateOne(
          { _id: doc._id },
          { $set: { last_availability_check: new Date() } }
        );
        stats.checked++;
        return;
      }

      const status = await checkUrl(url);
      stats.checked++;

      const now = new Date();
      const updateFields = { last_availability_check: now };

      if (status === 'deleted') {
        // Check if it's a story that naturally expired
        const isStory = doc.content_type === 'story';
        const publishedAt = doc.published_at ? new Date(doc.published_at) : null;
        const hoursOld = publishedAt ? (now - publishedAt) / (1000 * 60 * 60) : Infinity;

        if (isStory && hoursOld >= 24) {
          // Stories naturally expire after 24h — mark as expired, not deleted
          updateFields.is_expired = true;
          updateFields.expired_at = updateFields.expired_at || new Date(publishedAt.getTime() + 24 * 60 * 60 * 1000);
          updateFields.availability_status = 'expired';
          stats.expired++;
          console.log(`[AvailabilityChecker] ⏰ Story expired: ${doc.content_id} (${Math.round(hoursOld)}h old)`);
        } else {
          // Post, reel, or young story — genuinely deleted by author
          updateFields.is_deleted = true;
          updateFields.deleted_at = now;
          updateFields.availability_status = 'deleted';
          stats.deleted++;
          console.log(`[AvailabilityChecker] 🗑️ Content deleted: ${doc.content_id} (${doc.content_type || 'post'}) by @${doc.author_handle}`);
        }
      } else if (status === 'available') {
        // If it was previously marked deleted/expired in error, restore it
        if (doc.availability_status !== 'available') {
          updateFields.is_deleted = false;
          updateFields.deleted_at = null;
          updateFields.availability_status = 'available';
        }
      }
      // 'unknown' — don't change status, just update check timestamp

      await Content.updateOne({ _id: doc._id }, { $set: updateFields });
    } catch (err) {
      stats.errors++;
      console.error(`[AvailabilityChecker] ❌ Error checking ${doc.content_id}:`, err.message);
    }
  });

  console.log(`[AvailabilityChecker] ✅ Batch complete: ${stats.checked} checked, ${stats.deleted} deleted, ${stats.expired} expired, ${stats.errors} errors`);
  return stats;
};

/**
 * Run availability check for InstagramStory documents.
 * Stories use original_url for the CDN check.
 */
const runStoryAvailabilityCheck = async (options = {}) => {
  const { batchSize = CHECK_BATCH_SIZE } = options;

  const recheckCutoff = new Date(Date.now() - RECHECK_INTERVAL_MS);

  const stories = await InstagramStory.find({
    is_archived: true,
    is_available: true,
    $or: [
      { last_availability_check: { $exists: false } },
      { last_availability_check: null },
      { last_availability_check: { $lt: recheckCutoff } }
    ]
  })
    .sort({ published_at: -1 })
    .limit(batchSize)
    .lean();

  if (stories.length === 0) return { checked: 0, unavailable: 0 };

  const stats = { checked: 0, unavailable: 0 };

  await processConcurrent(stories, async (story) => {
    try {
      const url = story.original_url;
      if (!url) return;

      const status = await checkUrl(url);
      stats.checked++;

      const now = new Date();
      const updateFields = { last_availability_check: now };

      if (status === 'deleted') {
        const expiresAt = story.expires_at ? new Date(story.expires_at) : null;
        
        // If current time is BEFORE expiry time, it means the user deleted it manually
        if (expiresAt && now < expiresAt) {
             updateFields.deleted_at = now;
             console.log(`[AvailabilityChecker] 🗑️ Story deleted by user: ${story.story_pk}`);
        }
        
        updateFields.is_available = false;
        stats.unavailable++;
      }

      await InstagramStory.updateOne({ _id: story._id }, { $set: updateFields });
    } catch (err) {
      console.error(`[AvailabilityChecker] ❌ Story check error ${story.story_pk}:`, err.message);
    }
  });

  console.log(`[AvailabilityChecker] 📖 Stories: ${stats.checked} checked, ${stats.unavailable} now unavailable`);
  return stats;
};

/**
 * Run both content and story availability checks.
 */
const runFullAvailabilityCheck = async (options = {}) => {
  const contentStats = await runContentAvailabilityCheck(options);
  const storyStats = await runStoryAvailabilityCheck(options);
  return { content: contentStats, stories: storyStats };
};

module.exports = {
  checkUrl,
  runContentAvailabilityCheck,
  runStoryAvailabilityCheck,
  runFullAvailabilityCheck
};
