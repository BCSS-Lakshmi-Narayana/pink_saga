const { v4: uuidv4 } = require('uuid');
const { TwitterApi } = require('twitter-api-v2');
const blugateClient = require('./blugateClient');
const youtubeChannels = require('./youtubeChannelService');
const Source = require('../models/Source');
const Content = require('../models/Content');
const Analysis = require('../models/Analysis');
const Alert = require('../models/Alert');
const Settings = require('../models/Settings');
const Keyword = require('../models/Keyword');
const Comment = require('../models/Comment');
const { analyzeContent, isAnalysisComplete } = require('./analysisService');
const { sendAlertEmail } = require('./emailService');
const { getActiveEvents, autoArchiveEndedEvents, scanEventOnce, shouldPollEvent } = require('./eventMonitorService');
const { checkAndCreateVelocityAlerts, createNewPostAlert, updateEngagementHistory, checkVelocity } = require('./velocityAlertService');
const { queueUrlEnrichment } = require('./urlEnrichmentService');
const rapidApiInstagramService = require('./rapidApiInstagramService');
const { archiveContentMedia, archiveTwitterMedia } = require('./contentS3Service');
const { preferCleanText } = require('../utils/textEncoding');

let lastMediaBackfillAt = 0;
const MEDIA_BACKFILL_INTERVAL_MS = 15 * 60 * 1000;

const normalizeInstagramHandle = (value) => {
  if (!value) return value;
  let id = String(value).trim();
  if (/^https?:\/\//i.test(id) || /instagram\.com\//i.test(id)) {
    try {
      const url = new URL(id.startsWith('http') ? id : `https://${id}`);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length > 0) id = parts[0];
    } catch (_) {
      // ignore
    }
  }
  id = id.replace(/^@/, '');
  return id.toLowerCase();
};

const archiveXTweetMedia = async (tweetId, media = [], quotedContent = null) => {
  const normalizedMedia = Array.isArray(media) ? media : [];
  const quoted = quotedContent && typeof quotedContent === 'object' ? { ...quotedContent } : quotedContent;

  if (normalizedMedia.length === 0 && (!quoted?.media || quoted.media.length === 0)) {
    return {
      media: normalizedMedia,
      quoted_content: quoted,
      is_media_archived: false,
      upload_failures: 0
    };
  }

  let archivedMedia = normalizedMedia;
  let archivedQuoted = quoted;
  let uploadFailures = 0;

  try {
    if (normalizedMedia.length > 0) {
      archivedMedia = await archiveTwitterMedia(normalizedMedia, `${tweetId}`);
      uploadFailures += archivedMedia.filter((item) => item?.url && !item?.s3_url).length;
    }

    if (quoted?.media && Array.isArray(quoted.media) && quoted.media.length > 0) {
      const archivedQuotedMedia = await archiveTwitterMedia(
        quoted.media,
        `${tweetId}_quoted_${quoted.author_handle || 'unknown'}`
      );
      uploadFailures += archivedQuotedMedia.filter((item) => item?.url && !item?.s3_url).length;
      archivedQuoted = {
        ...quoted,
        media: archivedQuotedMedia
      };
    }
  } catch (error) {
    console.error(`[Monitor] X media archive failed for ${tweetId}: ${error.message}`);
    return {
      media: normalizedMedia,
      quoted_content: quoted,
      is_media_archived: false,
      upload_failures: normalizedMedia.length
    };
  }

  return {
    media: archivedMedia,
    quoted_content: archivedQuoted,
    is_media_archived: archivedMedia.length > 0 && archivedMedia.every((item) => !!item?.s3_url),
    upload_failures: uploadFailures
  };
};

const hasS3Gaps = (media = []) => {
  if (!Array.isArray(media) || media.length === 0) return false;
  return media.some((item) => {
    const hasSource = Boolean(item?.video_url || item?.url);
    return hasSource && !item?.s3_url;
  });
};

const hasAnyMedia = (media = []) => Array.isArray(media) && media.length > 0;

const hasAnyTwitterMedia = (media = [], quotedContent = null) => {
  const mainHasMedia = hasAnyMedia(media);
  const quotedHasMedia = hasAnyMedia(quotedContent?.media);
  return mainHasMedia || quotedHasMedia;
};

// Media is not archived to S3 any more — posts render from the platform's own
// URLs. Kept as a no-op so the ingest paths that call it need no changes.
const queueXTweetMediaArchive = () => {};

// No S3 archiving (see queueXTweetMediaArchive).
const queueInstagramMediaArchive = () => {};

const backfillRecentXMedia = async ({ limit = 200, hours = 24, maxUpdates = 50 } = {}) => {
  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const alerts = await Alert.find({ platform: 'x', created_at: { $gte: since } })
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();

    if (!alerts.length) return 0;

    const cache = new Map();
    let updated = 0;

    for (const alert of alerts) {
      if (updated >= maxUpdates) break;

      const content = await Content.findOne({ id: alert.content_id });
      if (!content) continue;
      if (content.media && content.media.length > 0) continue;

      const source = content.source_id ? await Source.findOne({ id: content.source_id }).lean() : null;
      const handle = content.author_handle || source?.identifier;
      if (!handle) continue;

      if (!cache.has(handle)) {
        const res = await rapidApiXService.fetchUserTweets(handle, 40);
        const tweets = Array.isArray(res) ? res : (res.tweets || []);
        cache.set(handle, tweets);
      }

      const tweets = cache.get(handle) || [];
      const match = tweets.find(t => t.id === content.content_id);
      if (!match || !Array.isArray(match.media) || match.media.length === 0) continue;

      content.media = match.media;
      if (match.quoted_content) content.quoted_content = match.quoted_content;
      content.is_media_archived = false;
      if (match.url_cards && match.url_cards.length > 0) content.url_cards = match.url_cards;
      if (match.is_repost !== undefined) content.is_repost = match.is_repost;

      const isUnknown = (val) => !val || String(val).trim().toLowerCase() === 'unknown' || String(val).trim().toLowerCase() === 'unknown user';

      if (match.original_author && (!isUnknown(match.original_author) || isUnknown(content.original_author))) {
        content.original_author = match.original_author;
      }
      if (match.original_author_name && (!isUnknown(match.original_author_name) || isUnknown(content.original_author_name))) {
        content.original_author_name = match.original_author_name;
      }
      if (match.original_author_avatar) content.original_author_avatar = match.original_author_avatar;
      content.scraped_content = `Media Count: ${match.media.length}`;

      await content.save();
      queueXTweetMediaArchive({
        query: { id: content.id },
        tweetId: match.id || content.content_id,
        media: match.media,
        quotedContent: match.quoted_content,
        sourceTag: 'x-backfill'
      });
      updated++;
    }

    if (updated > 0) {
      //console.log(`[Monitor] Media backfill updated ${updated} X items.`);
    }
    return updated;
  } catch (error) {
    //console.error(`[Monitor] Media backfill failed: ${error.message}`);
    return 0;
  }
};

const backfillRecentInstagramMedia = async ({ limit = 300, hours = 72, maxUpdates = 80 } = {}) => {
  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const docs = await Content.find({
      platform: 'instagram',
      published_at: { $gte: since },
      media: { $exists: true, $ne: [] }
    })
      .sort({ published_at: -1 })
      .limit(limit)
      .lean();

    if (!docs.length) return 0;

    let queued = 0;
    for (const doc of docs) {
      if (queued >= maxUpdates) break;
      const media = Array.isArray(doc.media) ? doc.media : [];
      if (!hasS3Gaps(media)) continue;
      queueInstagramMediaArchive({
        query: { id: doc.id },
        contentId: doc.content_id || doc.id,
        media,
        sourceTag: 'instagram-backfill'
      });
      queued++;
    }
    return queued;
  } catch (_) {
    return 0;
  }
};

// Helper to extract and fetch URL content
const extractAndFetchUrlContent = async (text) => {
  try {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex);

    if (!urls || urls.length === 0) return '';

    let scrapedText = '';
    for (const url of urls.slice(0, 2)) {
      try {
        if (url.includes('youtube.com') || url.includes('twitter.com') || url.includes('x.com')) continue;

        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) continue;

        const html = await response.text();

        // Simple regex extraction
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';

        const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ||
          html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
        const description = descMatch ? descMatch[1].trim() : '';

        if (title || description) {
          scrapedText += ` [Link Content: ${title} - ${description}]`;
        }
      } catch (err) {
        // Ignore fetch errors
        //console.log(`Failed to fetch URL ${url}: ${err.message}`);
      }
    }
    return scrapedText;
  } catch (error) {
    //console.error('Error in URL extraction:', error);
    return '';
  }
};

const monitorYoutubeSource = async (source) => {
  try {
    if (!blugateClient.hasCredentials('youtube')) {
      console.warn('[YouTube Monitor] ⚠️ No YouTube credentials (BluGate or YOUTUBE_API_KEY). Skipping scan.');
      await Source.findOneAndUpdate({ id: source.id }, { last_checked: new Date() });
      return [];
    }

    // Quota-safe path (see youtubeChannelService): resolve the channel id once
    // and store it, then read the uploads playlist and batch the details —
    // 2-3 units per scan instead of 100 per search.list call plus one
    // videos.list per video.
    let channelId = source.identifier;
    if (!youtubeChannels.CHANNEL_ID_RX.test(String(channelId || ''))) {
      const resolved = await youtubeChannels.resolveChannel(source.identifier);
      if (!resolved || !resolved.id) {
        console.warn(`[YouTube Monitor] Could not resolve channel "${source.identifier}" (${source.display_name}).`);
        await Source.findOneAndUpdate({ id: source.id }, { last_checked: new Date() });
        return [];
      }
      channelId = resolved.id;
      await Source.findOneAndUpdate({ id: source.id }, { identifier: channelId });
      source.identifier = channelId;
    }

    const latestIds = await youtubeChannels.latestVideoIds(channelId, 10);
    const known = new Set((await Content.find({ content_id: { $in: latestIds } }).select('content_id').lean()).map((c) => c.content_id));
    const freshIds = latestIds.filter((id) => !known.has(id));
    const details = await youtubeChannels.videoDetails(freshIds);

    const newContent = [];

    for (const videoData of details) {
      const videoId = videoData.id;
      const snippet = videoData.snippet;
      const stats = videoData.statistics;

      const baseText = `${snippet.title} ${snippet.description}`;
      const scrapedContent = await extractAndFetchUrlContent(baseText);

      const content = new Content({
        source_id: source.id,
        platform: 'youtube',
        content_id: videoId,
        content_url: `https://www.youtube.com/watch?v=${videoId}`,
        text: baseText + scrapedContent,
        scraped_content: scrapedContent,
        media: [{
          url: `https://www.youtube.com/watch?v=${videoId}`,
          type: 'video'
        }],
        author: snippet.channelTitle,
        author_handle: source.identifier,
        published_at: new Date(snippet.publishedAt),
        engagement: {
          views: parseInt(stats.viewCount || 0),
          likes: parseInt(stats.likeCount || 0),
          comments: parseInt(stats.commentCount || 0)
        }
      });

      await content.save();
      newContent.push(content);
      //console.log(`New YouTube video: ${videoId} from ${source.display_name}`);
    }

    // Update last checked
    await Source.findOneAndUpdate({ id: source.id }, { last_checked: new Date() });

    return newContent;
  } catch (error) {
    const status = error.response && error.response.status;
    const reason = error.response && error.response.data && error.response.data.error && error.response.data.error.message;
    console.error(`[YouTube Monitor] ${source.display_name}: ${status || ''} ${reason || error.message}`);
    return [];
  }
};

// Match content against configured keywords and return matched keyword objects
const matchConfiguredKeywords = async (contentText = '') => {
  try {
    if (!contentText || typeof contentText !== 'string') return [];

    // Fetch all active keywords from the database
    const keywords = await Keyword.find({ is_active: true }).lean();
    if (!keywords || keywords.length === 0) return [];

    const matched = [];
    const matchedKeywordIds = new Set(); // Track matched keywords to avoid duplicates

    // Check each keyword for a match
    for (const kw of keywords) {
      if (matchedKeywordIds.has(kw.id)) continue; // Skip if already matched

      const keyword = String(kw.keyword).trim();
      // Check for non-Latin scripts: Devanagari (Hindi), Telugu, Tamil, Kannada, Malayalam
      const isNonLatin = /[ऀ-ॿఀ-౿஀-௿ಀ-೿ഀ-ൿ]/.test(keyword);

      let isMatch = false;

      if (isNonLatin) {
        // For non-Latin scripts (Telugu, Hindi, etc.), use simple substring matching
        // as word boundaries don't work reliably
        isMatch = contentText.includes(keyword);
      } else {
        // Latin: a handle keyword ("@TelanganaCMO") matches only as @name, a
        // hashtag keyword only as #name, a plain keyword as a whole word or as
        // a #/@ tag. (The old patterns put \\b in front of the '@'/'#', which
        // can never match, so handle and hashtag keywords were never tagged.)
        const bare = keyword.replace(/^[@#]+/, '');
        const esc = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tail = '(?![A-Za-z0-9_])';
        const patterns = keyword.startsWith('@') ? [new RegExp(`@${esc}${tail}`, 'i')]
          : keyword.startsWith('#') ? [new RegExp(`#${esc}${tail}`, 'i')]
          : [new RegExp(`(^|[^A-Za-z0-9_])[#@]?${esc}${tail}`, 'i')];
        isMatch = patterns.some(p => p.test(contentText));
      }

      if (isMatch) {
        matched.push({
          keyword_id: kw.id,
          keyword: kw.keyword,
          category: kw.category,
          language: kw.language,
          weight: kw.weight
        });
        matchedKeywordIds.add(kw.id);
      }
    }

    return matched;
  } catch (error) {
    console.error('[Monitor] Keyword matching error:', error.message);
    return [];
  }
};

const xApiService = require('./xApiService');
const rapidApiXService = require('./rapidApiXService');
const rapidApiFacebookService = require('./rapidApiFacebookService');
const { scrapeProfile, getHealthyAccount } = require('./scraperService');

const monitorXSource = async (source, options = {}) => {
  try {
    let tweets = [];
    const useRapidApi = blugateClient.hasCredentials('twitter');
    const useOfficialApi = !!process.env.X_BEARER_TOKEN;

    let userData = null;

    if (useRapidApi) {
      //console.log(`[Monitor] Using RapidAPI (Twttr) for ${source.display_name}`);
      const result = await rapidApiXService.fetchUserTweets(source.identifier, options.limit || 40);

      // Handle both array/object returns for safety
      if (Array.isArray(result)) {
        tweets = result;
      } else {
        tweets = result.tweets || [];
        userData = result.userData;

        if (userData) {
          const updates = {};
          // Update verification status if different
          if (userData.isVerified !== undefined && source.is_verified !== userData.isVerified) {
            updates.is_verified = userData.isVerified;
          }
          // Update profile image if availalble and different
          if (userData.profileImageUrl && source.profile_image_url !== userData.profileImageUrl) {
            updates.profile_image_url = userData.profileImageUrl;
          }

          if (Object.keys(updates).length > 0) {
            await Source.updateOne({ id: source.id }, updates);
            //console.log(`[Monitor] Updated metadata for ${source.identifier}:`, Object.keys(updates).join(', '));
          }
        }
      }
    } else if (useOfficialApi) {
      //console.log(`[Monitor] Using Official X API for ${source.display_name}`);
      tweets = await xApiService.fetchUserTweets(source.identifier);
    }

    // Fallback or legacy path if API fails or not configured
    if (!tweets || tweets.length === 0) {
      // Corrected Logic: Check if NO API is configured
      if (!useRapidApi && !useOfficialApi) {
        //console.log(`[Monitor] API not configured, falling back to scraper for ${source.display_name}`);
        const account = await getHealthyAccount();
        if (account) {
          tweets = await scrapeProfile(source.identifier, account);
        } else {
          //console.warn('No healthy Twitter accounts available for scraping.');
        }
      } else {
        // console.log(`[Monitor] API active but returned no data (Rate Limit or empty). Skipping scraper fallback per policy.`);
      }
    }

    // Update last checked - do this AFTER fetching but BEFORE early returns to confirm poll success
    await Source.findOneAndUpdate({ id: source.id }, { last_checked: new Date() });

    if (!tweets || tweets.length === 0) return [];

    const lookbackDays = options.days || 1;
    const cutoff = Date.now() - (lookbackDays * 24 * 60 * 60 * 1000);
    tweets = tweets.filter(t => {
      const created = t.created_at ? new Date(t.created_at).getTime() : NaN;
      return Number.isFinite(created) ? created >= cutoff : true;
    });

    if (!tweets || tweets.length === 0) return [];

    const newContent = [];

    for (const tweet of tweets) {
      // Check if exists
      const existing = await Content.findOne({ content_id: tweet.id });
      if (existing) {
        const incomingMedia = Array.isArray(tweet.media) ? tweet.media : [];
        const incomingCards = Array.isArray(tweet.url_cards) ? tweet.url_cards : [];
        const existingMedia = Array.isArray(existing.media) ? existing.media : [];
        const existingQuoted = existing.quoted_content || null;
        const incomingQuoted = tweet.quoted_content || null;

        // Keep already-archived media to avoid replacing it with raw URLs on each poll.
        const preserveArchivedMainMedia =
          existing.is_media_archived === true &&
          existingMedia.length > 0 &&
          !hasS3Gaps(existingMedia);
        const mediaForSave = incomingMedia.length > 0
          ? (preserveArchivedMainMedia ? existingMedia : incomingMedia)
          : existingMedia;

        const preserveArchivedQuotedMedia =
          Array.isArray(existingQuoted?.media) &&
          existingQuoted.media.length > 0 &&
          !hasS3Gaps(existingQuoted.media);
        const quotedForSave = incomingQuoted
          ? (preserveArchivedQuotedMedia ? { ...incomingQuoted, media: existingQuoted.media } : incomingQuoted)
          : existingQuoted;

        const archiveMainCandidates = incomingMedia.length > 0 ? incomingMedia : existingMedia;
        const archiveQuotedCandidates = incomingQuoted || existingQuoted;
        const needsArchive =
          hasAnyTwitterMedia(archiveMainCandidates, archiveQuotedCandidates) &&
          (hasS3Gaps(mediaForSave) || hasS3Gaps(quotedForSave?.media));

        const shouldUpdate =
          (incomingMedia.length > 0 && (!existing.media || existing.media.length === 0)) ||
          (!existing.quoted_content && quotedForSave) ||
          (incomingCards.length > 0 && (!existing.url_cards || existing.url_cards.length === 0)) ||
          (!existing.original_author && tweet.original_author) ||
          (!existing.original_author_name && tweet.original_author_name) ||
          (!existing.original_author_avatar && tweet.original_author_avatar) ||
          (tweet.is_repost !== undefined && existing.is_repost !== tweet.is_repost);

        if (shouldUpdate || true) { // Always update metrics if found
          const newEngagement = {
            likes: parseInt(tweet.metrics?.like || tweet.metrics?.likes) || 0,
            retweets: parseInt(tweet.metrics?.retweet || tweet.metrics?.retweets) || 0,
            replies: parseInt(tweet.metrics?.reply || tweet.metrics?.replies) || 0,
            views: parseInt(tweet.metrics?.view || tweet.metrics?.views) || 0
          };

          const updatedDoc = await Content.findOneAndUpdate(
            { id: existing.id },
            {
              $set: {
                // Keep the stored copy when the provider hands back a double-encoded
                // response; otherwise one bad poll corrupts the post for good once it
                // ages out of the polling window.
                text: preferCleanText(tweet.text, existing.text),

                /**
                 * This object literal previously declared `quoted_content` TWICE
                 * and `media` TWICE. JS keeps only the last of each, so two of
                 * the four expressions were dead — and for quoted_content the
                 * surviving one was the WORSE of the pair: it wrote the raw
                 * `tweet.quoted_content`, throwing away `quotedForSave`'s
                 * already-archived S3 media, so every poll replaced archived
                 * quoted media with URLs that later expire.
                 *
                 * Both intents are now combined in one key: keep the archived
                 * media (via quotedForSave) AND keep the 'Unknown' guard that
                 * stops a degraded poll response clobbering a good record.
                 */
                quoted_content: (quotedForSave && (quotedForSave.author_name !== 'Unknown' || !existingQuoted))
                  ? quotedForSave
                  : existingQuoted,

                url_cards: incomingCards.length > 0 ? incomingCards : existing.url_cards,
                is_repost: tweet.is_repost ?? existing.is_repost,

                // Safeguard against 'Unknown' overwriting valid original_author info
                original_author: (tweet.original_author && (tweet.original_author !== 'unknown' || !existing.original_author))
                  ? tweet.original_author : existing.original_author,
                original_author_name: (tweet.original_author_name && (tweet.original_author_name !== 'Unknown' || !existing.original_author_name))
                  ? tweet.original_author_name : existing.original_author_name,

                original_author_avatar: tweet.original_author_avatar || existing.original_author_avatar,
                // The sole `media` key. `mediaForSave` already falls back to the
                // stored media when the poll returned none, and preserves
                // archived S3 copies — see its definition above.
                media: mediaForSave,
                is_media_archived: mediaForSave.length > 0 ? !hasS3Gaps(mediaForSave) : existing.is_media_archived,
                scraped_content: mediaForSave.length > 0 ? `Media Count: ${mediaForSave.length}` : existing.scraped_content,
                engagement: newEngagement,
                raw_data: tweet.raw_data || existing.raw_data
              },
              $push: {
                engagement_history: {
                  $each: [{
                    timestamp: new Date(),
                    ...newEngagement
                  }],
                  $slice: -50
                }
              }
            },
            { new: true }
          );
          //console.log(`[Monitor] Updated metrics/meta for ${tweet.id} from ${source.display_name}`);

          // Add to newContent so it gets checked for velocity alerts
          // We attach a flag 'is_update' so analysis service can skip re-analysis if needed
          updatedDoc.is_update = true;
          newContent.push(updatedDoc);

          if (needsArchive) {
            queueXTweetMediaArchive({
              query: { id: existing.id },
              tweetId: tweet.id,
              media: archiveMainCandidates,
              quotedContent: archiveQuotedCandidates,
              sourceTag: 'x-update'
            });
          }
        }
        continue;
      }

      const incomingMedia = Array.isArray(tweet.media) ? tweet.media : [];
      const incomingQuoted = tweet.quoted_content || null;
      const shouldArchive = hasAnyTwitterMedia(incomingMedia, incomingQuoted);

      const content = new Content({
        source_id: source.id,
        platform: 'x',
        content_id: tweet.id,
        content_url: tweet.url,
        text: tweet.text,
        scraped_content: incomingMedia.length > 0 ? `Media Count: ${incomingMedia.length}` : '',
        media: incomingMedia,
        is_media_archived: false,
        is_repost: tweet.is_repost || false,
        original_author: tweet.original_author,
        original_author_name: tweet.original_author_name,
        original_author_avatar: tweet.original_author_avatar,
        quoted_content: incomingQuoted,
        url_cards: tweet.url_cards || [],
        author: source.display_name,
        author_handle: source.identifier,
        published_at: new Date(tweet.created_at),
        engagement: {
          likes: parseInt(tweet.metrics.like) || 0,
          retweets: parseInt(tweet.metrics.retweet) || 0,
          replies: parseInt(tweet.metrics.reply) || 0,
          views: parseInt(tweet.metrics.views) || 0
        }
      });

      await content.save();
      newContent.push(content);

      if (shouldArchive) {
        queueXTweetMediaArchive({
          query: { id: content.id },
          tweetId: tweet.id,
          media: incomingMedia,
          quotedContent: incomingQuoted,
          sourceTag: 'x-create'
        });
      }
      //console.log(`New X post: ${tweet.id} from ${source.display_name}`);
    }

    // Queue background URL card enrichment for new content
    if (newContent.length > 0) {
      const contentIds = newContent.map(c => c.id);
      queueUrlEnrichment(contentIds);
    }

    return newContent;
  } catch (error) {
    console.error(`Error monitoring X source ${source.display_name}: ${error.message}`);
    return [];
  }
};

const monitorInstagramSource = async (source, accessToken) => {
  try {
    if (!blugateClient.hasCredentials('instagram')) {
      console.warn('[Instagram Monitor] ⚠️ No Instagram credentials (BluGate or RAPIDAPI_INSTAGRAM_KEY/RAPIDAPI_KEY). Skipping scan.');
      await Source.findOneAndUpdate({ id: source.id }, { last_checked: new Date() });
      return [];
    }

    // ─── Handle Normalization ──────────────────────────────────────────────
    const normalizeHandle = (value) => {
      let str = String(value || '').trim();
      if (str.includes('instagram.com/')) {
        try {
          if (!str.startsWith('http')) str = 'https://' + str;
          const urlObj = new URL(str);
          const segments = urlObj.pathname.split('/').filter(Boolean);
          if (segments.length > 0) return segments[0].toLowerCase();
        } catch (e) { /* fallback */ }
      }
      return str.replace(/^@/, '').toLowerCase();
    };

    const handle = normalizeHandle(source.identifier || source.display_name);
    if (!handle) {
      //console.warn(`[Instagram Monitor] ⚠️ No valid handle for source ${source.display_name}`);
      return [];
    }

    //console.log(`[Instagram Monitor] 🔍 Starting scan for @${handle} (${source.display_name})`);

    // ─── Utility Helpers ───────────────────────────────────────────────────
    const toJsDate = (value) => {
      if (!value) return new Date();
      if (value instanceof Date) return value;
      if (typeof value === 'number') {
        const ms = value < 1e12 ? value * 1000 : value;
        const d = new Date(ms);
        return isNaN(d) ? new Date() : d;
      }
      const d = new Date(value);
      return isNaN(d) ? new Date() : d;
    };

    const pickFirst = (...values) => values.find(v => v !== undefined && v !== null && v !== '');
    const asArray = (value) => (Array.isArray(value) ? value : []);
    const INSTAGRAM_VIDEO_EXT_RE = /\.(mp4|webm|m3u8|mov)(\?|$)/i;

    const unwrapStoryNode = (item) => {
      if (!item || typeof item !== 'object') return item;
      let current = item;
      let depth = 0;

      while (depth < 6) {
        const next = current?.node || current?.media || current?.story || current?.item || current?.data || null;
        if (!next || next === current || typeof next !== 'object') break;
        current = next;
        depth += 1;
      }

      return current;
    };

    const pickBestVideoVariantUrl = (variants = []) => {
      const normalized = variants
        .map((variant) => {
          if (typeof variant === 'string') return { url: variant, contentType: '' };
          if (!variant || typeof variant !== 'object') return null;
          return {
            ...variant,
            url: variant.url || variant.src,
            contentType: variant.content_type || variant.mime_type || variant.type || ''
          };
        })
        .filter((variant) => typeof variant?.url === 'string' && variant.url.trim());

      if (!normalized.length) return null;

      const mp4Only = normalized.filter((variant) => {
        const contentType = String(variant.contentType || '').toLowerCase();
        return !contentType || contentType.includes('mp4');
      });

      const selectable = mp4Only.length > 0 ? mp4Only : normalized;
      selectable.sort((a, b) => Number(b.bitrate || b.bandwidth || 0) - Number(a.bitrate || a.bandwidth || 0));
      return selectable[0]?.url || null;
    };

    // ─── Profile Extraction (deep fallbacks for different API shapes) ─────
    const extractProfile = (raw) => {
      if (!raw) return null;
      const data = raw?.data?.data || raw?.data || raw?.result || raw;
      const user =
        data?.user ||
        data?.data?.user ||
        data?.user_info?.user ||
        data?.userInfo ||
        data?.profile ||
        data?.result?.user ||
        data?.result?.data?.user ||
        data?.graphql?.user ||
        null;

      if (!user) return null;

      const username = pickFirst(user.username, user.user?.username, user.handle);
      const fullName = pickFirst(user.full_name, user.name, user.fullName, user.user?.full_name);
      const profilePic = pickFirst(
        user.profile_pic_url_hd,
        user.profile_pic_url,
        user.profile_pic,
        user.avatar,
        user.user?.profile_pic_url
      );
      const followers = pickFirst(
        user.edge_followed_by?.count,
        user.follower_count,
        user.followers,
        user.followers_count
      );
      const posts = pickFirst(
        user.edge_owner_to_timeline_media?.count,
        user.media_count,
        user.posts_count,
        user.post_count
      );
      const verified = pickFirst(user.is_verified, user.isVerified);
      const bio = pickFirst(user.biography, user.bio, user.description, '');

      return { username, fullName, profilePic, followers, posts, verified, bio };
    };

    // ─── Post Extraction (handles 10+ different API response shapes) ──────
    const extractPosts = (raw) => {
      if (!raw) return [];
      const data = raw?.data?.data || raw?.data || raw?.result || raw;
      const candidates = [
        data?.edges,
        data?.user?.edge_owner_to_timeline_media?.edges,
        data?.data?.user?.edge_owner_to_timeline_media?.edges,
        data?.edge_owner_to_timeline_media?.edges,
        data?.graphql?.user?.edge_owner_to_timeline_media?.edges,
        data?.items,
        data?.data?.items,
        data?.posts,
        data?.data?.posts,
        data?.results,
        data?.data?.results,
        data?.feed?.items,
        data?.media?.items
      ];
      const list = candidates.find(Array.isArray) || [];
      return list.map(item => item?.node || item).filter(Boolean);
    };

    // ─── Story Extraction (handles various API response shapes) ───────────
    const extractStories = (raw) => {
      if (!raw) return [];
      const data = raw?.data?.data || raw?.data || raw?.result || raw;

      const extracted = [];
      const appendCandidates = (input) => {
        asArray(input).forEach((entry) => {
          const unwrapped = unwrapStoryNode(entry);
          if (Array.isArray(unwrapped?.items)) {
            unwrapped.items.forEach((nestedEntry) => extracted.push(unwrapStoryNode(nestedEntry)));
            return;
          }
          extracted.push(unwrapped);
        });
      };

      if (Array.isArray(data)) {
        appendCandidates(data);
      } else {
        const candidates = [
          data?.reel?.items,
          data?.reel_media?.items,
          data?.reels_media?.[0]?.items,
          data?.story?.items,
          data?.story_items,
          data?.stories,
          data?.items,
          data?.data?.stories,
          data?.data?.items,
          data?.data?.reel?.items,
          data?.user?.reel?.items,
          data?.highlights,
          data?.data?.highlights
        ];

        candidates.forEach(appendCandidates);
        asArray(data?.reels_media).forEach((reel) => appendCandidates(reel?.items));
      }

      return extracted.filter(Boolean);
    };

    // ─── Media Normalization ───────────────────────────────────────────────
    const normalizeMediaItem = (item) => {
      if (!item) return null;

      if (typeof item === 'string') {
        const rawUrl = item.trim();
        if (!rawUrl) return null;
        const isVideoUrl = INSTAGRAM_VIDEO_EXT_RE.test(rawUrl);
        return {
          type: isVideoUrl ? 'video' : 'photo',
          url: rawUrl,
          preview: rawUrl
        };
      }

      const normalizedItem = unwrapStoryNode(item);
      const videoVersions = [
        ...asArray(normalizedItem?.video_versions),
        ...asArray(normalizedItem?.videoVersions),
        ...asArray(normalizedItem?.video_resources),
        ...asArray(normalizedItem?.variants)
      ];

      const bestVariantUrl = pickBestVideoVariantUrl(videoVersions);
      const directVideoUrl = pickFirst(
        normalizedItem?.video_url,
        normalizedItem?.videoUrl,
        normalizedItem?.video?.url,
        normalizedItem?.play_url,
        bestVariantUrl
      );

      const imageCandidates = [
        normalizedItem?.preview,
        normalizedItem?.preview_image_url,
        normalizedItem?.thumbnail_url,
        normalizedItem?.thumbnail_src,
        normalizedItem?.display_url,
        normalizedItem?.image_url,
        normalizedItem?.cover_frame_url,
        ...asArray(normalizedItem?.image_versions2?.candidates).map((candidate) => candidate?.url),
        ...asArray(normalizedItem?.image_versions).map((candidate) => candidate?.url),
        ...asArray(normalizedItem?.display_resources).map((resource) => resource?.src)
      ];

      const imageUrl = pickFirst(
        ...imageCandidates,
        normalizedItem?.url
      );

      const mediaType = String(normalizedItem?.type || normalizedItem?.media_type || '').toLowerCase();
      const isVideo = !!(
        normalizedItem?.is_video ||
        mediaType === 'video' ||
        mediaType === 'animated_gif' ||
        mediaType === '2' ||
        directVideoUrl ||
        videoVersions.length > 0 ||
        (typeof normalizedItem?.url === 'string' && INSTAGRAM_VIDEO_EXT_RE.test(normalizedItem.url))
      );

      const url = isVideo ? pickFirst(directVideoUrl, imageUrl) : imageUrl;
      if (!url) return null;

      const preview = pickFirst(imageUrl, url, directVideoUrl);
      return { type: isVideo ? 'video' : 'photo', url, preview };
    };

    const normalizeMedia = (node) => {
      const normalizedNode = unwrapStoryNode(node);
      const children = (
        normalizedNode?.edge_sidecar_to_children?.edges ||
        normalizedNode?.carousel_media ||
        normalizedNode?.carousel ||
        []
      );

      if (Array.isArray(children) && children.length > 0) {
        return children
          .map(child => normalizeMediaItem(unwrapStoryNode(child)))
          .filter(Boolean);
      }

      const single = normalizeMediaItem(normalizedNode);
      return single ? [single] : [];
    };

    const hasUsableMedia = (mediaItems = []) => (
      Array.isArray(mediaItems) &&
      mediaItems.some((mediaItem) => typeof mediaItem?.url === 'string' && mediaItem.url.trim())
    );

    // ─── STEP 1: Fetch Profile (with fallback to cached data) ─────────────
    let profile = null;
    let profileFetchFailed = false;

    try {
      const profileRaw = await rapidApiInstagramService.fetchUserProfile(handle);
      profile = extractProfile(profileRaw);
      if (profile) {
        //console.log(`[Instagram Monitor] ✅ Profile fetched: ${profile.fullName || profile.username || handle}`);
      }
    } catch (profileErr) {
      profileFetchFailed = true;
      //console.warn(`[Instagram Monitor] ⚠️ Profile fetch failed for @${handle}: ${profileErr.message}. Using cached data.`);
    }

    // Update source metadata from fresh profile (or keep existing)
    if (profile) {
      const set = {};
      const push = {};

      if (profile.fullName && profile.fullName !== source.display_name) set.display_name = profile.fullName;
      if (profile.profilePic && profile.profilePic !== source.profile_image_url) set.profile_image_url = profile.profilePic;
      if (profile.verified !== undefined && profile.verified !== null) set.is_verified = profile.verified;

      if (profile.followers || profile.posts) {
        const existingStats = source.statistics || {};
        set.statistics = {
          ...existingStats,
          subscriber_count: Number(profile.followers) || existingStats.subscriber_count || 0,
          video_count: Number(profile.posts) || existingStats.video_count || 0,
          view_count: existingStats.view_count || 0
        };

        push.history = {
          date: new Date(),
          subscriber_count: Number(profile.followers) || 0,
          video_count: Number(profile.posts) || 0,
          view_count: existingStats.view_count || 0
        };
      }

      const update = {};
      if (Object.keys(set).length > 0) update.$set = set;
      if (Object.keys(push).length > 0) update.$push = push;
      if (Object.keys(update).length > 0) {
        await Source.findOneAndUpdate({ id: source.id }, update);
        //console.log(`[Instagram Monitor] 📝 Updated source metadata for @${handle}`);
      }
    }

    // ─── STEP 2: Fetch Posts (with fallback — continue even if profile failed) ──
    let posts = [];
    let postsFetchFailed = false;

    try {
      const postsRaw = await rapidApiInstagramService.fetchUserPosts(handle);
      posts = extractPosts(postsRaw);
      //console.log(`[Instagram Monitor] 📦 Extracted ${posts.length} posts for @${handle}`);
    } catch (postsErr) {
      postsFetchFailed = true;
      //console.error(`[Instagram Monitor] ❌ Posts fetch failed for @${handle}: ${postsErr.message}`);
    }

    // If both profile and posts failed, something is seriously wrong with this source
    if (profileFetchFailed && postsFetchFailed) {
      //console.error(`[Instagram Monitor] 🚨 Complete API failure for @${handle}. All API keys may be exhausted. Will retry next cycle.`);
      // Still update last_checked so we don't hammer a broken source
      await Source.findOneAndUpdate({ id: source.id }, { last_checked: new Date() });
      return [];
    }

    if (!posts || posts.length === 0) {
      //console.log(`[Instagram Monitor] ℹ️ No posts found for @${handle} (may be private or empty)`);
      await Source.findOneAndUpdate({ id: source.id }, { last_checked: new Date() });
      return [];
    }

    // ─── STEP 3: Process Each Post (with per-post error isolation) ────────
    const newContent = [];
    let processedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (const post of posts) {
      try {
        const shortcode = pickFirst(post.shortcode, post.code);
        const contentId = String(pickFirst(post.id, post.pk, post.media_id, shortcode));
        if (!contentId) continue;

        let content = await Content.findOne({ platform: 'instagram', content_id: contentId });

        const caption =
          pickFirst(
            post.edge_media_to_caption?.edges?.[0]?.node?.text,
            post.caption?.text,
            post.text,
            post.caption_text,
            ''
          ) || '';

        // Safe date parsing with fallback
        let createdAt;
        try {
          createdAt = toJsDate(pickFirst(post.taken_at_timestamp, post.taken_at, post.created_time, post.timestamp, post.created_at));
        } catch (dateErr) {
          createdAt = new Date();
          //console.warn(`[Instagram Monitor] ⚠️ Date parse failed for post ${contentId}, using now()`);
        }

        const media = normalizeMedia(post);
        const contentUrl = pickFirst(
          post.permalink,
          shortcode ? `https://www.instagram.com/p/${shortcode}/` : null,
          post.url
        );

        // Engagement extraction with deep fallbacks
        const likes = Number(pickFirst(post.edge_media_preview_like?.count, post.edge_liked_by?.count, post.likes?.count, post.like_count, 0)) || 0;
        const comments = Number(pickFirst(post.edge_media_to_comment?.count, post.comment_count, post.comments?.count, 0)) || 0;
        const views = Number(
          pickFirst(
            post.video_view_count,
            post.view_count,
            post.play_count,
            post.video_play_count,
            post.clips_view_count,
            post.media?.view_count,
            post.statistics?.view_count,
            post.reel_play_count,
            post.reel_view_count,
            0
          )
        ) || 0;

        if (content) {
          const existingMedia = Array.isArray(content.media) ? content.media : [];
          const preserveArchivedMedia = content.is_media_archived === true &&
            existingMedia.length > 0 &&
            !hasS3Gaps(existingMedia);
          const mediaForSave = media.length > 0
            ? (preserveArchivedMedia ? existingMedia : media)
            : existingMedia;
          const needsArchive = hasS3Gaps(mediaForSave);

          // ── UPDATE existing content (metrics refresh, like X monitoring) ──
          const newEngagement = { likes, comments, views, retweets: 0 };

          const updatedDoc = await Content.findOneAndUpdate(
            { id: content.id },
            {
              $set: {
                text: caption || content.text,
                media: mediaForSave,
                is_media_archived: mediaForSave.length > 0 ? !hasS3Gaps(mediaForSave) : content.is_media_archived,
                engagement: newEngagement,
                author: profile?.fullName || content.author || source.display_name,
                author_handle: handle || content.author_handle || source.identifier
              },
              $push: {
                engagement_history: {
                  $each: [{
                    timestamp: new Date(),
                    likes,
                    comments,
                    views
                  }],
                  $slice: -50 // Keep last 50 history entries
                }
              }
            },
            { new: true }
          );

          if (updatedDoc) {
            // Safeguard Author Updates (Separate Update)
            const isUnknown = (val) => !val || String(val).trim().toLowerCase() === 'unknown' || String(val).trim().toLowerCase() === 'unknown user';
            const newAuthor = profile?.fullName || source.display_name;
            const newHandle = handle || source.identifier;

            if (!isUnknown(newAuthor) || isUnknown(updatedDoc.author)) {
              await Content.updateOne({ id: content.id }, { $set: { author: newAuthor || content.author } });
            }
            if (!isUnknown(newHandle) || isUnknown(updatedDoc.author_handle)) {
              await Content.updateOne({ id: content.id }, { $set: { author_handle: newHandle || content.author_handle } });
            }

            updatedDoc.is_update = true;
            newContent.push(updatedDoc);
            updatedCount++;

            if (needsArchive) {
              queueInstagramMediaArchive({
                query: { id: content.id },
                contentId,
                media: mediaForSave,
                sourceTag: 'instagram-update'
              });
            }
          }
        } else {
          // ── CREATE new content ────────────────────────────────────────────
          content = new Content({
            source_id: source.id,
            platform: 'instagram',
            content_id: contentId,
            content_url: contentUrl || `https://www.instagram.com/p/${shortcode || contentId}/`,
            text: caption || 'Instagram post',
            scraped_content: media.length > 0 ? `Media Count: ${media.length}` : '',
            media,
            author: profile?.fullName || source.display_name,
            author_handle: handle || source.identifier,
            published_at: createdAt,
            engagement: {
              likes,
              comments,
              views,
              retweets: 0
            }
          });
          await content.save();
          newContent.push(content);
          processedCount++;
          //console.log(`[Instagram Monitor] 🆕 New post: ${contentId} from @${handle}`);

          queueInstagramMediaArchive({
            query: { id: content.id },
            contentId,
            media,
            sourceTag: 'instagram-create'
          });
        }
      } catch (postErr) {
        errorCount++;
        //console.error(`[Instagram Monitor] ⚠️ Error processing post: ${postErr.message}`);
        // Continue processing remaining posts
      }
    }

    // ─── STEP 4: Fetch Stories (ephemeral, 24h content) ────────────────
    let storiesCount = 0;
    try {
      const storiesRaw = await rapidApiInstagramService.fetchUserStories(handle);
      const stories = extractStories(storiesRaw);
      //console.log(`[Instagram Monitor] 📖 Extracted ${stories.length} stories for @${handle}`);

      for (const story of stories) {
        try {
          const storyId = String(pickFirst(story.id, story.pk, story.story_id, story.media_id));
          if (!storyId) continue;

          const caption = pickFirst(story.caption?.text, story.text, '') || '';
          let createdAt;
          try {
            createdAt = toJsDate(pickFirst(story.taken_at, story.taken_at_timestamp, story.timestamp, story.created_at));
          } catch (dateErr) {
            createdAt = new Date();
          }

          const media = normalizeMedia(story);
          const storyUrl = pickFirst(
            story.story_url,
            story.url,
            `https://www.instagram.com/stories/${handle}/${storyId}/`
          );

          const expiresAt = story.expiring_at
            ? toJsDate(story.expiring_at)
            : new Date(createdAt.getTime() + 24 * 60 * 60 * 1000); // 24h from creation

          // Check if story already exists and repair only when media was missing earlier.
          const existingStory = await Content.findOne({
            platform: 'instagram',
            content_id: storyId,
            content_type: 'story'
          });

          if (existingStory) {
            const existingHasMedia = hasUsableMedia(existingStory.media);
            const incomingHasMedia = hasUsableMedia(media);
            const existingMedia = Array.isArray(existingStory.media) ? existingStory.media : [];
            const preserveArchivedMedia = existingStory.is_media_archived === true &&
              existingMedia.length > 0 &&
              !hasS3Gaps(existingMedia);
            const mediaForSave = incomingHasMedia
              ? (preserveArchivedMedia ? existingMedia : media)
              : existingMedia;
            const needsArchive = hasS3Gaps(mediaForSave);

            if ((!existingHasMedia && incomingHasMedia) || (incomingHasMedia && !preserveArchivedMedia)) {
              existingStory.media = mediaForSave;
              existingStory.content_url = storyUrl || existingStory.content_url;
              existingStory.scraped_content = `Story expires: ${expiresAt.toISOString()}`;
              existingStory.is_media_archived = mediaForSave.length > 0 ? !hasS3Gaps(mediaForSave) : existingStory.is_media_archived;
              if ((!existingStory.text || existingStory.text === 'Instagram Story') && caption) {
                existingStory.text = caption;
              }
              await existingStory.save();
              updatedCount++;
              //console.log(`[Instagram Monitor] 🔧 Repaired story media: ${storyId} from @${handle}`);
            }

            if (needsArchive) {
              queueInstagramMediaArchive({
                query: { id: existingStory.id },
                contentId: storyId,
                media: mediaForSave,
                sourceTag: 'instagram-story-update'
              });
            }

            continue;
          }

          const storyContent = new Content({
            source_id: source.id,
            platform: 'instagram',
            content_type: 'story',
            content_id: storyId,
            content_url: storyUrl,
            text: caption || 'Instagram Story',
            scraped_content: `Story expires: ${expiresAt.toISOString()}`,
            media,
            author: profile?.fullName || source.display_name,
            author_handle: handle || source.identifier,
            published_at: createdAt,
            engagement: {
              likes: 0,
              comments: 0,
              views: Number(pickFirst(story.view_count, story.viewer_count, story.seen_count, 0)) || 0,
              retweets: 0
            }
          });
          await storyContent.save();
          newContent.push(storyContent);
          storiesCount++;
          //console.log(`[Instagram Monitor] 📖 New story: ${storyId} from @${handle}`);

          queueInstagramMediaArchive({
            query: { id: storyContent.id },
            contentId: storyId,
            media,
            sourceTag: 'instagram-story-create'
          });
        } catch (storyErr) {
          //console.warn(`[Instagram Monitor] ⚠️ Error processing story: ${storyErr.message}`);
        }
      }
    } catch (storiesErr) {
      //console.warn(`[Instagram Monitor] ⚠️ Stories fetch failed for @${handle}: ${storiesErr.message}`);
      // Stories are optional, continue without them
    }

    // ─── STEP 5: Update source last_checked ──────────────────────────────
    await Source.findOneAndUpdate({ id: source.id }, { last_checked: new Date() });

    //console.log(`[Instagram Monitor] ✅ Scan complete for @${handle}: ${processedCount} new posts, ${storiesCount} stories, ${updatedCount} updated, ${errorCount} errors`);
    return newContent;

  } catch (error) {
    //console.error(`[Instagram Monitor] ❌ Fatal error monitoring ${source.display_name}: ${error.message}`);
    // Always update last_checked to prevent hammering a broken source
    try {
      await Source.findOneAndUpdate({ id: source.id }, { last_checked: new Date() });
    } catch (_) { /* ignore */ }
    return [];
  }
};

const monitorFacebookSource = async (source, accessToken, options = {}) => {
  try {
    const pageUrl = source.identifier;
    let details = await rapidApiFacebookService.fetchPageDetails(pageUrl, { throwOnCooldown: !!options.throwOnCooldown });
    if (details) {
      const updates = {};
      if (details.name && details.name !== source.display_name) updates.display_name = details.name;
      if (details.image && details.image !== source.profile_image_url) updates.profile_image_url = details.image;

      // Update stats
      if (details.followers || details.likes) {
        updates.statistics = {
          ...source.statistics,
          subscriber_count: details.followers || source.statistics.subscriber_count,
          view_count: details.likes || source.statistics.view_count
        };

        // Track history
        if (!source.history) source.history = [];
        source.history.push({
          date: new Date(),
          subscriber_count: details.followers || 0,
          view_count: details.likes || 0
        });
      }

      if (Object.keys(updates).length > 0) {
        await Source.findOneAndUpdate({ id: source.id }, updates);
        //console.log(`[Monitor] Updated profile info for ${source.display_name}`);
      }
    }

    // 2. Fetch Posts - prefer numeric id from details when available, else use the stored page URL
    const pageKey = details?.id || pageUrl;
    let posts = await rapidApiFacebookService.fetchPagePosts(pageKey, 10, source.display_name, { throwOnCooldown: !!options.throwOnCooldown });
    if (!posts || posts.length === 0) {
      // fallback: try the URL form (covers cases where pageKey is numeric but API expects URL)
      posts = await rapidApiFacebookService.fetchPagePosts(pageUrl, 10, source.display_name, { throwOnCooldown: !!options.throwOnCooldown });
    }
    const newContent = [];

    for (const post of posts) {
      let content = await Content.findOne({ content_id: post.id });

      const toJsDate = (value) => {
        if (!value) return new Date();
        if (value instanceof Date) return value;
        if (typeof value === 'number') {
          const ms = value < 1e12 ? value * 1000 : value;
          const d = new Date(ms);
          return isNaN(d) ? new Date() : d;
        }
        const d = new Date(value);
        return isNaN(d) ? new Date() : d;
      };

      if (content) {
        // Update existing content engagement
        if (!Array.isArray(content.engagement_history)) content.engagement_history = [];
        content.engagement = {
          likes: post.engagement.likes,
          comments: post.engagement.comments,
          views: post.engagement.views,
          retweets: post.engagement.shares // mapping shares to retweets
        };
        content.engagement_history.push({
          timestamp: new Date(),
          likes: post.engagement.likes,
          comments: post.engagement.comments,
          views: post.engagement.views
        });
        await content.save();
      } else {
        // Create new content
        const mediaItems = Array.isArray(post.media)
          ? post.media.map(m => ({
            url: m,
            type: (String(m).toLowerCase().includes('video') || String(m).toLowerCase().includes('.mp4')) ? 'video' : 'image'
          }))
          : [];

        content = new Content({
          source_id: source.id,
          platform: 'facebook',
          content_id: post.id,
          content_url: post.url,
          text: post.text,
          scraped_content: post.media.map(m => m).join(', '), // formatting media 
          media: mediaItems,
          author: post.author_name,
          author_handle: source.identifier,
          published_at: toJsDate(post.created_at),
          engagement: {
            likes: post.engagement.likes,
            comments: post.engagement.comments,
            views: post.engagement.views,
            retweets: post.engagement.shares
          }
        });
        await content.save();
        newContent.push(content);
      }

      // 3. Fetch Comments for this post
      if (post.engagement.comments > 0) {
        const comments = await rapidApiFacebookService.fetchPostComments(post.id, 20, { throwOnCooldown: !!options.throwOnCooldown });
        for (const c of comments) {
          const existingComment = await Comment.findOne({ comment_id: c.id });
          if (!existingComment) {
            const newComment = new Comment({
              content_id: content.id,
              video_id: post.id, // Using post_id as video_id
              comment_id: c.id,
              author_channel_id: c.author_id || 'unknown',
              author_display_name: c.author_name,
              author_profile_image: c.author_image,
              text: c.text,
              like_count: c.likes,
              published_at: new Date(c.created_at)
            });
            await newComment.save();
            // TODO: Analyze comment risk?
          }
        }
      }
    }

    // Update source last_checked
    await Source.findOneAndUpdate({ id: source.id }, { last_checked: new Date() });

    return newContent;

  } catch (error) {
    if (options.throwOnCooldown && (error?.code === 'FB_RAPIDAPI_COOLDOWN' || error?.response?.status === 429)) {
      throw error;
    }
    //console.error(`Error monitoring Facebook source ${source.display_name}: ${error.message}`);
    return [];
  }
};

const scanSourceOnce = async (source, options = {}) => {
  if (!source) throw new Error('Source is required');

  const settings = await Settings.findOne({ id: 'global_settings' });
  if (!settings) throw new Error('Settings not found');

  const xBearerToken = process.env.X_BEARER_TOKEN || settings.x_bearer_token;
  const fbAccessToken = settings.facebook_access_token || process.env.FACEBOOK_ACCESS_TOKEN;

  // Some services read from process.env; keep env in sync with DB settings.
  if (xBearerToken) process.env.X_BEARER_TOKEN = xBearerToken;

  const keywords = await Keyword.find({ is_active: true });

  let newContent = [];
  if (source.platform === 'youtube') {
    newContent = await monitorYoutubeSource(source);
  } else if (source.platform === 'x') {
    newContent = await monitorXSource(source, options);
  } else if (source.platform === 'instagram') {
    const normalized = normalizeInstagramHandle(source.identifier);
    if (normalized && normalized !== source.identifier) {
      source.identifier = normalized;
      await Source.findOneAndUpdate({ id: source.id }, { identifier: normalized });
    }
    newContent = await monitorInstagramSource(source, fbAccessToken, options);
  } else if (source.platform === 'facebook') {
    newContent = await monitorFacebookSource(source, fbAccessToken, { ...options, throwOnCooldown: !!options.throwOnCooldown });
  }

  for (const content of newContent) {
    // `is_update` marks posts already analysed in a prior poll — this cycle only
    // refreshed engagement. They are re-analysed only if that earlier analysis
    // never completed (status 'pending'); re-running the LLM on every poll used
    // to pin the event loop.
    const needsAnalysis = !content.is_update || content.analysis_status === 'pending';
    const analysis = needsAnalysis
      ? await performFullAnalysis(content, settings, keywords, { skipAlert: true })
      : null;
    const velocity = await checkVelocity(content, settings);

    if (analysis) {
      // Complete analysis: create the alert, or re-sync it, in one write.
      await upsertAlertForContent({ content, analysis, velocity, source, settings });
    } else if (!needsAnalysis) {
      // Engagement-only poll of an already-analysed post: refresh virality.
      await upsertAlertForContent({ content, analysis: null, velocity, source, settings });
    }
    // Otherwise the analysis did not complete: no alert. The post is 'pending'
    // and retryPendingAnalyses creates the alert once its analysis completes.

    // Update engagement history
    if (content.engagement) {
      await updateEngagementHistory(content.id, content.engagement);
    }
  }

  return { scanned: newContent.length, ingested: newContent.length };
};

const toContentRiskLevel = (analysisRiskLevel) => {
  const v = String(analysisRiskLevel || '').toLowerCase();
  if (v === 'high' || v === 'critical') return 'high';
  if (v === 'medium') return 'medium';
  return 'low';
};

const toAlertRiskLevel = (analysisRiskLevel) => {
  const v = String(analysisRiskLevel || '').toLowerCase();
  if (v === 'high' || v === 'critical') return 'high';
  if (v === 'medium') return 'medium';
  if (v === 'low') return 'low';
  return null;
};

/** Human-readable alert description from an analysis (intent, reasons, laws, policies, flagged terms). */
const buildDetailedDescription = (analysisData, platform) => {
  const reasons = analysisData.reasons || [];
  const intent = analysisData.intent || 'Unknown';
  const highlights = analysisData.highlights || [];

  let detailedDescription = '';

  // Add intent information
  if (intent && intent !== 'Neutral' && intent !== 'Unknown') {
    detailedDescription += `**Intent Detected:** ${intent}\n\n`;
  }

  // Add structured reasons (Expert Logic, Local Context, etc)
  if (reasons.length > 0) {
    reasons.forEach(reason => {
      // Skip duplicated entries that we show in specific sections below
      if (reason.startsWith('Legal: ') || reason.startsWith('Policy: ')) return;
      detailedDescription += `• ${reason}\n`;
    });
    detailedDescription += '\n';
  }

  // Explicitly Add Legal and Policy Sections if present in analysisData
  if (analysisData.legal_sections?.length > 0) {
    detailedDescription += `**Indian Laws Violated:**\n`;
    analysisData.legal_sections.forEach(l => {
      detailedDescription += `• ${l.act} ${l.section}${l.description ? ': ' + l.description : ''}\n`;
    });
    detailedDescription += '\n';
  }

  if (analysisData.violated_policies?.length > 0) {
    detailedDescription += `**Platform Policies Violated:**\n`;
    analysisData.violated_policies.forEach(p => {
      detailedDescription += `• ${p.policy_name} (${platform})\n`;
    });
    detailedDescription += '\n';
  }

  // Add highlighted dangerous phrases
  if (highlights.length > 0) {
    detailedDescription += `**Flagged terms:** ${highlights.join(', ')}\n\n`;
  }

  // Add risk score
  detailedDescription += `**Risk Score:** ${analysisData.risk_score || 0}%`;

  // Fallback if no details
  if (!detailedDescription.trim()) {
    detailedDescription = analysisData.explanation || 'Threat content detected by AI analysis.';
  }
  return detailedDescription;
};

/** The object performFullAnalysis hands back to alert builders. */
const buildAnalysisResult = (analysisData, analysis, uniqueRiskFactors, platform) => ({
  ...analysisData,
  analysis_id: analysis.id,
  content_risk_level: toContentRiskLevel(analysisData.risk_level),
  risk_score: analysisData.risk_score ?? 0,
  uniqueRiskFactors,
  violated_policies: analysisData.violated_policies || [],
  legal_sections: analysisData.legal_sections || [],
  intent: analysisData.intent,
  reasons: analysisData.reasons,
  highlights: analysisData.highlights,
  explanation: analysisData.explanation,
  detailedDescription: buildDetailedDescription(analysisData, platform),
});

/* ─── Complete-or-pending pipeline ────────────────────────────────────────────
 *
 * THE RULE: an alert is written only from a COMPLETE analysis (see
 * analysisService.isAnalysisComplete), with every analysis-derived field set in
 * ONE write. A post whose analysis failed or fell back is marked
 * `analysis_status: 'pending'` on its Content record and gets no alert; the
 * retry job below re-analyses it and creates the alert once it completes. When
 * a later analysis finishes for a post that already has an alert, the alert is
 * re-synced in the same write — it is never left showing an older verdict.
 *
 * Risk is the analysis' risk (it follows the raw sentiment). Virality sets the
 * alert type, the priority and the 🔥 title prefix only — never risk.
 */
const MAX_ANALYSIS_ATTEMPTS = Number(process.env.MAX_ANALYSIS_ATTEMPTS || 6);
const PRIORITY_WEIGHT = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const QUIET_INTENTS = ['Neutral', 'Unknown', 'Normal', 'Monitor'];

const markAnalysisPending = async (content, reason) => {
  const attempts = (Number(content.analysis_attempts) || 0) + 1;
  const status = attempts >= MAX_ANALYSIS_ATTEMPTS ? 'failed' : 'pending';
  content.analysis_attempts = attempts;
  content.analysis_status = status;
  try {
    await Content.updateOne(
      { id: content.id },
      {
        $set: {
          analysis_status: status,
          analysis_attempts: attempts,
          analysis_error: String(reason || 'incomplete').slice(0, 300),
          analysis_last_attempt_at: new Date(),
        },
      }
    );
  } catch (err) {
    console.error(`[Analysis] could not mark ${content.id} pending: ${err.message}`);
  }
  console.warn(`[Analysis] ${content.content_id || content.id} not complete (${reason}) — ${status}, attempt ${attempts}/${MAX_ANALYSIS_ATTEMPTS}`);
};

/** The post's own alert (not an event alert), found by content id, then by platform id / URL. */
const findExistingAlert = async (content) => {
  const notEvent = { event_id: null };
  const direct = await Alert.findOne({ content_id: content.id, ...notEvent });
  if (direct) return direct;
  const or = [{ content_id: content.content_id, platform: content.platform }];
  if (content.content_url) or.push({ content_url: content.content_url });
  const sameContents = await Content.find({ $or: or }).select('id').lean();
  const alertOr = [{ content_id: { $in: sameContents.map((c) => c.id) } }];
  if (content.content_url) alertOr.push({ content_url: content.content_url });
  return Alert.findOne({ $or: alertOr, ...notEvent });
};

const velocityFields = (velocity) => ({
  metric: velocity.triggeredMetrics.map((m) => m.metric).join(', '),
  current_value: Math.max(...velocity.triggeredMetrics.map((m) => m.value)),
  previous_value: 0,
  velocity: Math.max(...velocity.triggeredMetrics.map((m) => m.value)),
  time_window_minutes: velocity.threshold.time_window_minutes,
  threshold_triggered: velocity.highestPriority.thresholdTriggered,
  post_age_minutes: Math.round(velocity.postAgeMinutes),
  triggered_metrics: velocity.triggeredMetrics,
});

/** Every alert field, derived from ONE complete analysis (+ optional virality). */
const buildAlertData = async ({ content, analysis, velocity, source }) => {
  const riskLevel = toAlertRiskLevel(analysis.risk_level) || 'low';
  const viralPriority = velocity ? velocity.highestPriority.priority : null;
  const intent = analysis.intent || 'Unknown';
  const intentStr = QUIET_INTENTS.includes(intent) ? '' : `${intent} - `;
  const parts = [];
  if (velocity) {
    parts.push(`**Viral Status:** ${viralPriority} (${velocity.triggeredMetrics.map((m) => m.metric).join(', ')})`);
  }
  parts.push(analysis.detailedDescription || buildDetailedDescription(analysis, content.platform));
  const description = parts.join('\n\n');
  return {
    content_id: content.id,
    analysis_id: analysis.analysis_id,
    alert_type: velocity ? 'velocity' : (analysis.is_keyword_match ? 'keyword_risk' : 'ai_risk'),
    risk_level: riskLevel,
    priority: viralPriority || 'LOW',
    published_at: content.published_at || null,
    title: `${velocity ? '🔥 VIRAL: ' : ''}${riskLevel.toUpperCase()} Risk: ${intentStr}${content.author}`,
    description,
    classification_explanation: analysis.explanation || '',
    threat_details: {
      intent: analysis.intent || 'Monitor',
      reasons: analysis.reasons || [],
      highlights: analysis.highlights || [],
      risk_score: Number(analysis.risk_score) || 0,
      violated_policies: analysis.violated_policies || [],
      legal_sections: analysis.legal_sections || [],
    },
    velocity_data: velocity ? velocityFields(velocity) : undefined,
    violated_policies: analysis.violated_policies || [],
    legal_sections: analysis.legal_sections || [],
    llm_analysis: analysis.llm_analysis || null,
    // Campaign taxonomy (services/campaignTaxonomy.js) — the field AI Campaigns
    // Stage A groups alerts on.
    campaign_topic: analysis.topic || null,
    campaign_topic_taxonomy_version: analysis.topic_taxonomy_version || null,
    content_url: content.content_url,
    platform: content.platform,
    author: content.author,
    author_handle: content.author_handle,
    content_ref_id: content.id,
    source_category: source?.category || null,
    // The POST's own text (and its translation) — `description` is the
    // generated analysis summary, which never contains the post's words.
    matched_keywords: await matchConfiguredKeywords([content.text, content.translated_text].filter(Boolean).join('\n') || description),
    matched_keywords_normalized: [], // deprecated, use matched_keywords instead
  };
};

/**
 * Create the post's alert from a complete analysis, or re-sync an existing one.
 *   analysis = null → velocity-only refresh of an existing alert (engagement poll).
 * An operator's manual verdict (llm_analysis.manual_override) is never replaced:
 * such alerts only get their virality refreshed.
 */
const upsertAlertForContent = async ({ content, analysis, velocity, source, settings, allowCreate = true }) => {
  const existing = await findExistingAlert(content);

  if (existing) {
    const set = {};
    if (velocity) {
      const weight = PRIORITY_WEIGHT[velocity.highestPriority.priority] || 0;
      if (weight >= (PRIORITY_WEIGHT[existing.priority] || 0)) {
        set.alert_type = 'velocity';
        set.priority = velocity.highestPriority.priority;
        set.velocity_data = velocityFields(velocity);
      }
    }
    if (analysis && !existing.llm_analysis?.manual_override) {
      const data = await buildAlertData({ content, analysis, velocity, source });
      delete data.content_id; // keep the alert's original link
      if (!velocity) {
        // No new virality this round — keep the type/priority it already earned.
        delete data.alert_type;
        delete data.priority;
        delete data.velocity_data;
        if (existing.alert_type === 'velocity') {
          data.title = `🔥 VIRAL: ${data.title}`;
          if (existing.velocity_data) {
            data.description = `**Viral Status:** ${existing.priority} (${existing.velocity_data.metric || ''})\n\n${data.description}`;
          }
        }
      }
      Object.assign(set, data);
    }
    if (Object.keys(set).length) await Alert.updateOne({ id: existing.id }, { $set: set });
    return existing;
  }

  if (!analysis || !allowCreate || content.alert_suppressed) return null;

  const alert = new Alert(await buildAlertData({ content, analysis, velocity, source }));
  await alert.save();

  if (settings?.enable_email_alerts && settings.alert_emails?.length > 0) {
    await sendAlertEmail(settings.smtp_config, settings.alert_emails, {
      risk_level: alert.risk_level,
      platform: content.platform,
      author: content.author,
      content_url: content.content_url,
      description: alert.description,
      triggered_keywords: analysis.triggered_keywords || [],
      created_at: alert.created_at,
    });
  }
  return alert;
};

/**
 * Re-analyse posts whose analysis did not complete, and create / re-sync their
 * alerts once it does. Runs on a schedule from index.js.
 */
const retryPendingAnalyses = async ({ limit = 25 } = {}) => {
  const settings = await Settings.findOne({ id: 'global_settings' });
  if (!settings) return { picked: 0, completed: 0, still_pending: 0 };
  const keywords = await Keyword.find({ is_active: true });
  const pending = await Content.find({
    analysis_status: 'pending',
    analysis_attempts: { $lt: MAX_ANALYSIS_ATTEMPTS },
  }).sort({ analysis_last_attempt_at: 1 }).limit(limit);

  let completed = 0;
  let stillPending = 0;
  for (const content of pending) {
    const analysis = await performFullAnalysis(content, settings, keywords, { skipAlert: true });
    if (!analysis) { stillPending += 1; continue; }
    const source = content.source_id ? await Source.findOne({ id: content.source_id }).select('category').lean() : null;
    const velocity = await checkVelocity(content, settings);
    await upsertAlertForContent({ content, analysis, velocity, source, settings });
    completed += 1;
  }
  return { picked: pending.length, completed, still_pending: stillPending };
};

const performFullAnalysis = async (content, settings, keywords, options = {}) => {
  try {
    //console.log(`[Analysis] Analyzing content ${content.content_id}...`);
    const textToAnalyze = (content.text || '') + ' ' + (content.scraped_content || '');
    //console.log(`[Analysis] Text sample: ${textToAnalyze.substring(0, 50)}...`);
    //console.log(`[Analysis] Active Keywords for matching: ${keywords.length}`);

    // --- Layer 1: Explicit User Keyword Matching ---
    const matchedKeywords = [];

    // Normalize text for matching
    const normalize = (str) => String(str || '').toLowerCase().trim();
    const normalizedText = normalize(textToAnalyze);

    keywords.forEach(k => {
      if (!k.keyword) return;
      const keyLog = normalize(k.keyword);
      // Simple inclusion check, can be enhanced to regex if needed
      if (normalizedText.includes(keyLog)) {
        matchedKeywords.push({
          keyword: k.keyword,
          weight: k.weight || 50,
          category: k.category || 'other'
        });
      }
    });

    if (matchedKeywords.length > 0) {
      //console.log(`[Analysis] Layer 1 Match: Found ${matchedKeywords.length} keywords.`);
    }

    // --- Layer 2: Local ML Analysis ---
    const analysisId = uuidv4();
    const analysisData = await analyzeContent(textToAnalyze, {
      platform: content.platform,
      content_id: content.content_id,
      media_urls: content.media ? content.media.map(m => m.url) : [],
      content: content,
      analysisId: analysisId,
      // When it was published: settles which government a bare "the government" means.
      postDate: content.published_at || content.created_at || null,
      /**
       * The author handle was previously NOT passed on this path, so EVERY
       * alert reached the political gate with an empty author — losing a signal
       * the Mentions path always had.
       *
       * It matters because the stance engine uses it for the "a speaker does
       * not attack themselves" correction and the cross-camp prior: without it,
       * an opposition account demanding action from our government can be
       * scored as if our government were the speaker, inverting the verdict.
       * Unresolvable handles are fine — they yield author_alignment: null,
       * which every consumer treats as "unknown".
       */
      authorHandle: content.author_handle || content.author || '',
      taggedKeyword: (matchedKeywords || []).map(k => k.keyword || k).join(' ')
    });

    // An incomplete analysis (model failed or fell back) is never saved as a
    // verdict: the post stays pending and is retried.
    if (!isAnalysisComplete(analysisData)) {
      await markAnalysisPending(content, (analysisData?.analysis_incomplete_reasons || []).join(',') || analysisData?.explanation || 'incomplete');
      return null;
    }

    // --- Layer 3: Hybrid Merging ---
    // Merge Keywords into analysis data
    if (matchedKeywords.length > 0) {
      // 1. Merge Triggers
      const existingTriggers = new Set(analysisData.triggered_keywords || []);
      matchedKeywords.forEach(m => {
        if (!existingTriggers.has(m.keyword)) {
          analysisData.triggered_keywords.push(m.keyword);
        }
      });

      // 2. Merge Evidence (Custom Evidence)
      // We construct 'custom_evidence' compatible with our previous logic
      if (!analysisData.custom_evidence) analysisData.custom_evidence = [];
      matchedKeywords.forEach(m => {
        analysisData.custom_evidence.push({
          keyword: m.keyword,
          weight: m.weight,
          category: m.category,
          context: 'User Keyword Match'
        });
      });

      // Risk is NOT overridden by keyword weight: it follows the raw sentiment
      // (analysisService). Matched keywords are recorded as triggers only.
    }

    console.log(`[Analysis] Final Result for ${content.content_id}: Score=${analysisData.risk_score}, Level=${analysisData.risk_level}`);
    if ((analysisData.triggered_keywords || []).length > 0) {
      //console.log(`[Analysis] Final Keyword Triggers: ${analysisData.triggered_keywords.join(', ')}`);
    }
    // Upsert keyed by content_id (NOT a plain insert): monitorXSource/monitorInstagramSource
    // re-push already-seen content into newContent on every poll, so performFullAnalysis runs
    // repeatedly for the same content_id. Upserting keeps exactly one Analysis per content_id
    // and preserves the original `id` (via $setOnInsert) so earlier Alert links stay valid.
    const analysis = await Analysis.findOneAndUpdate(
      { content_id: content.id },
      {
        $set: {
          risk_score: Math.round(analysisData.risk_score || 0),
          risk_level: toContentRiskLevel(analysisData.risk_level),
          intent: analysisData.intent || 'unknown',
          explanation: analysisData.explanation,
          /**
           * This was hard-coded to 'neutral' on EVERY Analysis record, so the
           * real verdict was discarded here and several UI fallback chains —
           * which read this flat field before the nested llm_analysis path —
           * showed "neutral" for posts the pipeline had scored negative.
           * Now writes the actual client-relative sentiment.
           */
          sentiment: analysisData.sentiment || 'neutral',

          // REQUIRED FIELDS (Mapped from Risk Score or specific intent)
          violence_score: (analysisData.intent === 'Violence' ? Math.round((analysisData.risk_score || 0) * 10) : 0) || 0,
          threat_score: (analysisData.intent === 'Threat' ? Math.round((analysisData.risk_score || 0) * 10) : 0) || 0,
          hate_score: (analysisData.intent === 'Hate_Speech' ? Math.round((analysisData.risk_score || 0) * 10) : 0) || 0,

          triggered_keywords: analysisData.triggered_keywords || [],
          legal_sections: analysisData.legal_sections || [],
          violated_policies: analysisData.violated_policies || [],
          reasons: analysisData.reasons || [],
          highlights: analysisData.triggered_keywords || [],
          confidence: 0,
          language: 'en',
          llm_analysis: analysisData.llm_analysis || null, // Save rich LLM data
          forensic_results: analysisData.forensic_results || null
        },
        $setOnInsert: {
          id: analysisId
        }
      },
      { upsert: true, new: true }
    );

    // Persist derived intelligence back onto the content record for dashboard/reporting.
    const normalizeText = (value) => String(value || '')
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\u2060\uFE0F]/g, '')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();

    const textNormalized = normalizeText(content.text || '');
    const customEvidence = Array.isArray(analysisData.custom_evidence) ? analysisData.custom_evidence : [];
    const aiEvidence = Array.isArray(analysisData.ai_evidence) ? analysisData.ai_evidence : [];
    const filteredCustomEvidence = customEvidence.filter(e => {
      const keyword = String(e.keyword || '').trim();
      if (!keyword) return false;
      if (keyword.toLowerCase().startsWith('[ai]')) return true;
      if (!textNormalized) return true;
      return textNormalized.includes(normalizeText(keyword));
    });
    const riskEvidence = [...filteredCustomEvidence, ...aiEvidence];
    const uniqueRiskFactors = [];
    const seenRiskKeywords = new Set();
    for (const e of riskEvidence) {
      const key = String(e.keyword || '').trim().toLowerCase();
      if (!key || seenRiskKeywords.has(key)) continue;
      seenRiskKeywords.add(key);
      uniqueRiskFactors.push({
        keyword: e.keyword,
        weight: e.weight ?? 10,
        category: e.category || 'other',
        context: e.context || ''
      });
    }

    const updateQuery = { id: content.id };
    console.log(`[Monitor] Updating Content with query:`, updateQuery);
    const updateResult = await Content.findOneAndUpdate(
      updateQuery,
      {
        risk_score: analysisData.risk_score ?? 0,
        risk_level: toContentRiskLevel(analysisData.risk_level),
        threat_intent: analysisData.intent || 'Neutral',  // Save intent (e.g., Violence, Political)
        threat_reasons: analysisData.reasons || [],       // Save reasons (The "Why")
        risk_factors: uniqueRiskFactors,
        sentiment: analysisData.sentiment || 'neutral',
        analysis_status: 'complete',
        analysis_error: null,
        analysis_completed_at: new Date(),
        analysis_last_attempt_at: new Date()
      },
      { new: true }
    );
    if (!updateResult) {
      console.log(`[Monitor] WARNING: Content update returned null! Query:`, updateQuery);
      // Try fallback to content_id
      console.log(`[Monitor] Trying fallback update by content_id: ${content.content_id}`);
      await Content.findOneAndUpdate({ content_id: content.content_id, platform: content.platform }, {
        risk_score: analysisData.risk_score ?? 0,
        risk_level: toContentRiskLevel(analysisData.risk_level),
        threat_intent: analysisData.intent || 'Neutral',
        threat_reasons: analysisData.reasons || [],
        risk_factors: uniqueRiskFactors,
        sentiment: analysisData.sentiment || 'neutral',
        analysis_status: 'complete',
        analysis_error: null,
        analysis_completed_at: new Date(),
        analysis_last_attempt_at: new Date()
      });
    } else {
      console.log(`[Monitor] Content updated successfully. New Score: ${updateResult.risk_score}`);
    }

    // Manual propagation for in-memory object (used by subsequent velocity/newpost alerts)
    content.risk_score = analysisData.risk_score ?? 0;
    content.risk_level = toContentRiskLevel(analysisData.risk_level);
    content.threat_intent = analysisData.intent || 'Neutral';
    content.threat_reasons = analysisData.reasons || [];
    content.risk_factors = uniqueRiskFactors;
    content.sentiment = analysisData.sentiment || 'neutral';
    content.analysis_status = 'complete';
    content.violated_policies = analysisData.violated_policies || [];
    content.legal_sections = analysisData.legal_sections || [];

    // skipAlert callers (source scans, rescans) create the alert themselves and
    // need the analysis for EVERY post. The alert-worthiness filters below
    // used to run first and return `false` for ordinary posts (no keyword
    // match, no policy hit), so those alerts were saved with no stance, no
    // target sentiment and no reasoning even though the analysis had run.
    if (options.skipAlert) {
      return buildAnalysisResult(analysisData, analysis, uniqueRiskFactors, content.platform);
    }

    const alertRiskLevel = toAlertRiskLevel(analysisData.risk_level);
    if (!alertRiskLevel) return false;

    const hasKeywordMatch = filteredCustomEvidence.length > 0;
    const hasAiMatch = aiEvidence.length > 0;
    const hasPolicyViolation = (analysisData.violated_policies || []).length > 0;
    const hasLegalViolation = (analysisData.legal_sections || []).length > 0;
    const hasTriggeredKeywords = (analysisData.triggered_keywords || []).length > 0;

    // FILTER: Only create alert if content matches a configured keyword
    // OR the LLM detected meaningful risk (policy/legal/AI triggers).
    // Low-risk posts that DO match a keyword are still alerted.
    // Irrelevant posts (no keyword, no risk) are skipped.
    if (!hasKeywordMatch && !hasAiMatch && !hasPolicyViolation && !hasLegalViolation && !hasTriggeredKeywords) {
      console.log(`[Monitor] Skipping alert for ${content.content_id}: no keyword match and no risk signals`);
      return false;
    }

    // Same single write path as the source scan: create, or re-sync an existing alert.
    await upsertAlertForContent({
      content,
      analysis: { ...buildAnalysisResult(analysisData, analysis, uniqueRiskFactors, content.platform), is_keyword_match: hasKeywordMatch },
      velocity: null,
      source: null,
      settings,
    });

    // 4. Analysis record already created above (Line 1452)

    // Return the enriched data object for Alert Construction
    return buildAnalysisResult(analysisData, analysis, uniqueRiskFactors, content.platform);
  } catch (error) {
    console.error(`Error analyzing content ${content.id}:`, error);
    await markAnalysisPending(content, `error: ${error.message}`);
    return null;
  }
};


const rescanContent = async () => {
  try {
    //console.log("Starting retroactive content scan...");

    const settings = await Settings.findOne({ id: 'global_settings' });
    if (!settings) throw new Error("Settings not found");

    const keywords = await Keyword.find({ is_active: true });

    const yesterday = new Date(new Date().getTime() - (24 * 60 * 60 * 1000));
    const recentContent = await Content.find({ created_at: { $gte: yesterday } });

    //console.log(`Found ${recentContent.length} items to rescan.`);

    let alertCount = 0;
    for (const content of recentContent) {
      // Look up source for category
      const contentSource = content.source_id ? await Source.findOne({ id: content.source_id }).select('category').lean() : null;
      // Unified Analysis — incomplete means no alert; the retry job takes over.
      const analysis = await performFullAnalysis(content, settings, keywords, { skipAlert: true });
      if (!analysis) continue;
      const velocity = await checkVelocity(content, settings);

      // An existing alert is always re-synced to the fresh analysis. A new one
      // is created only for posts that carry risk or went viral (an admin-
      // deleted alert — alert_suppressed — is never resurrected).
      const hadAlert = !!(await findExistingAlert(content));
      const allowCreate = analysis.content_risk_level !== 'low' || !!velocity;
      const alert = await upsertAlertForContent({ content, analysis, velocity, source: contentSource, settings, allowCreate });
      if (!hadAlert && alert) alertCount++;
    }

    return { scanned: recentContent.length, alerts_triggered: alertCount };

  } catch (error) {
    //console.error("Rescan failed:", error);
    throw error;
  }
};

const startMonitoring = async () => {
  //console.log("Starting monitoring loop...");

  const runLoop = async () => {
    const loopStartedAt = Date.now();

    // Default fallback interval (minutes) if anything goes wrong.
    let nextIntervalMinutes = 5;

    try {
      const settings = await Settings.findOne({ id: 'global_settings' });
      if (!settings) {
        //console.log("Settings not found, waiting...");
        nextIntervalMinutes = 1;
        return;
      }

      const xBearerToken = process.env.X_BEARER_TOKEN || settings.x_bearer_token;
      const fbAccessToken = settings.facebook_access_token || process.env.FACEBOOK_ACCESS_TOKEN;

      // Sync back to process.env for other services that read from it
      if (xBearerToken) process.env.X_BEARER_TOKEN = xBearerToken;

      if (!blugateClient.hasCredentials() && !fbAccessToken && !xBearerToken) {
        //console.warn("No API credentials configured (BluGate/X/Facebook). Monitoring may fail. ");
      }

      const sources = await Source.find({ is_active: true });
      let keywords = await Keyword.find({ is_active: true });

      // Quick visibility into platform mix for this cycle.
      const platformCounts = sources.reduce((acc, s) => {
        acc[s.platform] = (acc[s.platform] || 0) + 1;
        return acc;
      }, {});
      console.log(`[Monitor] Active sources by platform: ${Object.entries(platformCounts).map(([k, v]) => `${k}:${v}`).join(', ')}`);

      // Merge Settings Keywords (Legacy/Watchlist)
      if (settings.threat_keywords && Array.isArray(settings.threat_keywords)) {
        const existingKeys = new Set(keywords.map(k => k.keyword.toLowerCase()));
        settings.threat_keywords.forEach(tk => {
          if (tk.keyword && !existingKeys.has(tk.keyword.toLowerCase())) {
            keywords.push({
              keyword: tk.keyword,
              category: tk.category || 'threat',
              weight: tk.weight || 80, // High default for watchlist
              is_active: true
            });
          }
        });
      }

      // Sort sources by priority: high > medium > low
      const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
      sources.sort((a, b) => {
        const pA = priorityOrder[a.priority] || 2;
        const pB = priorityOrder[b.priority] || 2;
        return pB - pA; // Descending order
      });

      // Events are scanned even when there are no monitored sources — they
      // search by their own keywords and do not depend on the Source list.
      // This used to `return` here, so a deployment with zero active sources
      // silently never scanned any event.
      if (sources.length === 0) {
        //console.log("No active sources to monitor");
        nextIntervalMinutes = 1;
      } else {
        //console.log(`Monitoring ${sources.length} sources...`);

        // Parallel execution with concurrency limit to prevent one platform from blocking others
        const CONCURRENCY_LIMIT = 5;

        for (let i = 0; i < sources.length; i += CONCURRENCY_LIMIT) {
          const batch = sources.slice(i, i + CONCURRENCY_LIMIT);
          // console.log(`[Monitor] Processing batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1}/${Math.ceil(sources.length / CONCURRENCY_LIMIT)} (${batch.length} sources)`);

          await Promise.all(batch.map(async (source) => {
            // Double check in-memory source against DB to honor "Pause" instantly
            const currentSource = await Source.findOne({ id: source.id });
            if (!currentSource || !currentSource.is_active) {
              return;
            }

            try {
              await scanSourceOnce(source);
            } catch (err) {
              // console.error(`[Monitor] Error scanning source ${source.display_name}: ${err.message}`);
            }
          }));
        }
      }
      await autoArchiveEndedEvents();
      const activeEvents = await getActiveEvents();

      for (const event of activeEvents) {
        const pollMinutes = event.polling_interval_minutes || Math.max(3, Math.floor((settings.monitoring_interval_minutes || 5) / 2));
        if (!shouldPollEvent(event, pollMinutes)) continue;
        // Per-event guard: scanEventOnce stamps last_polled_at only at the very
        // end, so an unhandled throw here used to abort the whole cycle — the
        // other events, the media backfill and the interval calculation with
        // it — and the event would retry from scratch on every loop, for ever.
        try {
          await scanEventOnce({ event, settings });
        } catch (err) {
          console.error(`[Monitor] Event scan failed for "${event.name}": ${err.message}`);
        }
      }

      if (rapidApiKey && Date.now() - lastMediaBackfillAt > MEDIA_BACKFILL_INTERVAL_MS) {
        lastMediaBackfillAt = Date.now();
        await backfillRecentXMedia();
        // (Instagram S3 backfill removed — media is not archived to S3.)
      }

      // Increase polling frequency while any active event exists.
      const baseInterval = settings.monitoring_interval_minutes || 5;
      const isAccelerated = activeEvents && activeEvents.length > 0;
      nextIntervalMinutes = isAccelerated ? Math.max(5, Math.floor(baseInterval / 3)) : baseInterval;

      if (isAccelerated) {
        //console.log(`[Monitor] 🚀 Acceleration Active: ${activeEvents.length} active events detected. Polling frequency increased (1/3rd of normal).`);
      }
      //console.log(`Waiting ${nextIntervalMinutes} minutes until next check... (Configured Base: ${baseInterval}m)`);

    } catch (error) {
      //console.error(`Error in monitoring loop: ${error.message}`);
      // If something blows up, fall back to a 1 minute retry to avoid long stalls.
      nextIntervalMinutes = 1;
    } finally {
      // Keep the cadence close to the configured interval by subtracting work time.
      const elapsedMs = Date.now() - loopStartedAt;
      const targetMs = (nextIntervalMinutes || 1) * 60 * 1000;
      const delayMs = Math.max(targetMs - elapsedMs, 30000); // minimum 30s between loops
      const nextInMinutes = (delayMs / 60000).toFixed(2);
      // console.log(`[Monitor] Cycle took ${(elapsedMs / 1000).toFixed(1)}s. Next run in ${nextInMinutes} minutes.`);
      setTimeout(runLoop, delayMs);
    }
  };

  runLoop();
};

module.exports = {
  matchConfiguredKeywords,
  startMonitoring,
  performFullAnalysis,
  rescanContent,
  scanSourceOnce,
  retryPendingAnalyses,
  upsertAlertForContent,
  __private: {
    monitorXSource,
    monitorInstagramSource,
    archiveXTweetMedia,
    queueXTweetMediaArchive,
    hasS3Gaps,
    queueInstagramMediaArchive,
    backfillRecentInstagramMedia
  }
};
