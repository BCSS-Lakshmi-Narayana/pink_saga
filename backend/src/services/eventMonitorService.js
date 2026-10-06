const Event = require('../models/Event');
const Content = require('../models/Content');
const Alert = require('../models/Alert');
const Comment = require('../models/Comment');
const Keyword = require('../models/Keyword');

const youtubeService = require('./youtube.service');
const rapidApiXService = require('./rapidApiXService');
const rapidApiFacebookService = require('./rapidApiFacebookService');
const { analyzeContent, analyzeComment } = require('./analysisService');
const { textMatchesAnyKeyword } = require('./grievanceService');
const { preferCleanText } = require('../utils/textEncoding');

const normalizeText = (text) => String(text || '').toLowerCase();

// Cap how many keywords we hit per platform per scan to avoid API-quota blowups.
// Picks the highest-weighted keywords first.
const MAX_KEYWORDS_PER_SCAN = Number(process.env.EVENT_SCAN_MAX_KEYWORDS || 25);
// Cap how many items we keep per author per scan (kills copy-paste spam clusters).
const MAX_ITEMS_PER_AUTHOR = Number(process.env.EVENT_SCAN_MAX_PER_AUTHOR || 10);

const nowUtc = () => new Date();

const getActiveEvents = async () => {
  const now = nowUtc();
  const events = await Event.find({ status: { $ne: 'archived' } }).sort({ start_date: 1 });
  return events.filter((e) => now >= e.start_date && now <= e.end_date);
};

const autoArchiveEndedEvents = async () => {
  const now = nowUtc();
  const ended = await Event.find({
    status: { $ne: 'archived' },
    auto_archive: true,
    end_date: { $lt: now }
  });

  for (const event of ended) {
    event.status = 'archived';
    event.archived_at = now;
    await event.save();
  }

  return { archived: ended.length };
};

// Pick the keywords we will hit the search API with, capped by weight desc.
// Each is wrapped in quotes so X / FB / YT treat multi-word phrases as a unit.
const pickSearchQueries = (mergedKeywords) => {
  const sorted = [...mergedKeywords].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const queries = [];
  const seen = new Set();
  for (const k of sorted) {
    const kw = String(k.keyword || '').trim();
    if (!kw) continue;
    const key = normalizeText(kw);
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(kw.includes(' ') ? `"${kw}"` : kw);
    if (queries.length >= MAX_KEYWORDS_PER_SCAN) break;
  }
  return queries;
};

const computeEventThresholds = (settings, event) => {
  const globalHigh = settings?.high_risk_threshold ?? settings?.risk_threshold_high ?? 70;
  const globalMedium = settings?.medium_risk_threshold ?? settings?.risk_threshold_medium ?? 40;

  // Apply lower thresholds during active events by default.
  const loweredHigh = Math.max(0, globalHigh - 10);
  const loweredMedium = Math.max(0, globalMedium - 10);

  return {
    high: event?.high_risk_threshold ?? loweredHigh,
    medium: event?.medium_risk_threshold ?? loweredMedium
  };
};

const mergeKeywords = (globalKeywordDocs, event) => {
  const merged = [...(globalKeywordDocs || [])];

  const eventKeywords = (event?.keywords || [])
    .map((k) => {
      if (!k) return null;
      const keyword = typeof k === 'string' ? k : k.keyword;
      if (!keyword) return null;
      return {
        keyword: String(keyword).trim(),
        category: 'other',
        language: k.language || 'all',
        weight: 10
      };
    })
    .filter((k) => k && k.keyword);

  merged.push(...eventKeywords);

  // Deduplicate by lower-cased keyword
  const seen = new Set();
  return merged.filter((k) => {
    const key = normalizeText(k.keyword);
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const upsertEventContent = async ({ eventId, platform, contentId, payload }) => {
  const existing = await Content.findOne({ platform, content_id: contentId });

  if (!existing) {
    const created = await Content.create({
      ...payload,
      platform,
      content_id: contentId,
      event_ids: [eventId]
    });
    return { content: created, isNew: true };
  }

  const updatedEventIds = Array.isArray(existing.event_ids) ? existing.event_ids : [];
  if (!updatedEventIds.includes(eventId)) updatedEventIds.push(eventId);

  existing.event_ids = updatedEventIds;

  // Best-effort engagement history
  if (payload.engagement) {
    existing.engagement = { ...existing.engagement, ...payload.engagement };
    existing.engagement_history = existing.engagement_history || [];
    existing.engagement_history.push({
      timestamp: new Date(),
      views: existing.engagement.views,
      likes: existing.engagement.likes,
      comments: existing.engagement.comments
    });
  }

  // Prefer latest text, unless the provider sent back a double-encoded copy of it
  if (payload.text) existing.text = preferCleanText(payload.text, existing.text);
  if (payload.published_at) existing.published_at = payload.published_at;

  // Safeguard Author Updates: Don't overwrite valid author with "Unknown"
  const isUnknown = (val) => !val || String(val).trim().toLowerCase() === 'unknown' || String(val).trim().toLowerCase() === 'unknown user';

  if (payload.author && (!isUnknown(payload.author) || isUnknown(existing.author))) {
    existing.author = payload.author;
  }
  if (payload.author_handle && (!isUnknown(payload.author_handle) || isUnknown(existing.author_handle))) {
    existing.author_handle = payload.author_handle;
  }

  if (payload.content_url) existing.content_url = payload.content_url;
  if (payload.thumbnails) existing.thumbnails = payload.thumbnails;
  if (payload.duration) existing.duration = payload.duration;
  if (payload.tags) existing.tags = payload.tags;
  if (payload.media) existing.media = payload.media;
  if (payload.quoted_content) {
    // Only overwrite if new one is valid (not Unknown) or if existing is already Unknown/missing
    const isNewUnknown = !payload.quoted_content.author_name || payload.quoted_content.author_name === 'Unknown';
    const isExistingUnknown = !existing.quoted_content || !existing.quoted_content.author_name || existing.quoted_content.author_name === 'Unknown';

    if (!isNewUnknown || isExistingUnknown) {
      existing.quoted_content = payload.quoted_content;
    }
  }
  if (payload.url_cards) existing.url_cards = payload.url_cards;
  if (payload.scraped_content) existing.scraped_content = payload.scraped_content;
  if (payload.raw_data) existing.raw_data = payload.raw_data;

  await existing.save();
  return { content: existing, isNew: false };
};

const maybeCreatePriorityAlert = async ({ event, content, analysis, analysisData, reason }) => {
  if (!analysis && !analysisData) return null;

  const effective = analysisData || analysis;

  const shouldAlert = ['MEDIUM', 'HIGH'].includes(String(effective.risk_level || '').toUpperCase());
  if (!shouldAlert) return null;

  const existing = await Alert.findOne({ content_id: content.id, event_id: event.id });
  if (existing) return existing;

  const riskLevel = String(effective.risk_level || '').toUpperCase() === 'HIGH' ? 'high' : 'medium';

  return await Alert.create({
    content_id: content.id,
    analysis_id: analysis.id,
    event_id: event.id,
    risk_level: riskLevel,
    published_at: content.published_at || null,
    title: `Event Priority: ${event.name}`,
    description: effective.explanation || 'Event-related risk signal detected.',
    threat_details: {
      intent: effective.intent || 'Unknown',
      reasons: effective.reasons || [],
      highlights: effective.highlights || [],
      risk_score: effective.risk_score || 0,
      confidence: effective.confidence || 0
    },
    violated_policies: effective.violated_policies || [],
    legal_sections: effective.legal_sections || [],
    classification_explanation: effective.explanation || '',
    ml_analysis: effective.ml_analysis || null,
    llm_analysis: effective.llm_analysis || null,
    campaign_topic: effective.topic || null,
    campaign_topic_taxonomy_version: effective.topic_taxonomy_version || null,
    content_url: content.content_url,
    platform: content.platform,
    author: content.author,
    is_priority: true,
    priority_reason: reason || ''
  });
};

const scanEventOnce = async ({ event, settings }) => {
  const thresholds = computeEventThresholds(settings, event);
  // An event is about ONE topic: it searches and matches on its OWN keywords
  // only. The global keyword list (leader names, "Revanth sarkar", …) used to be
  // merged in at a higher weight, so the query cap filled with global terms,
  // the event's own keywords were never searched, and any post naming the CM
  // was kept as event content.
  const keywordDocs = mergeKeywords([], event);

  const searchQueries = pickSearchQueries(keywordDocs);
  if (searchQueries.length === 0) {
    console.warn(`[EventScan] No active keywords for event "${event.name}" — skipping scan.`);
    return { scanned: 0, ingested: 0, alerts: 0 };
  }

  let ingested = 0;
  let alerts = 0;
  let scanned = 0;
  const perAuthor = new Map();
  const seenIds = new Set();

  const shouldKeep = (text, authorHandle) => {
    if (!textMatchesAnyKeyword(text, keywordDocs)) return false;
    const author = String(authorHandle || '').toLowerCase();
    const count = perAuthor.get(author) || 0;
    if (count >= MAX_ITEMS_PER_AUTHOR) return false;
    perAuthor.set(author, count + 1);
    return true;
  };

  const tweetMediaCache = new Map();
  const getHandleMediaMap = async (handle) => {
    if (!handle) return null;
    const cleanHandle = String(handle).replace('@', '').trim();
    if (!cleanHandle) return null;

    if (tweetMediaCache.has(cleanHandle)) return tweetMediaCache.get(cleanHandle);

    try {
      const result = await rapidApiXService.fetchUserTweets(cleanHandle);
      const tweets = Array.isArray(result) ? result : (result.tweets || []);
      const map = new Map();
      for (const t of tweets) {
        if (t?.id) map.set(t.id, t);
      }
      tweetMediaCache.set(cleanHandle, map);
      return map;
    } catch (error) {
      console.warn(`[EventScan] Failed to hydrate media for @${cleanHandle}:`, error.message);
      tweetMediaCache.set(cleanHandle, null);
      return null;
    }
  };

  const platforms = event.platforms && event.platforms.length > 0 ? event.platforms : ['youtube', 'x', 'facebook'];

  // X / Twitter — one search per keyword, post-fetch text-match + per-author cap
  if (platforms.includes('x')) {
    for (const q of searchQueries) {
      try {
        const tweets = await rapidApiXService.searchTweets(q);
        scanned += tweets.length;

        for (const t of tweets) {
          if (!t?.id || seenIds.has(`x:${t.id}`)) continue;
          seenIds.add(`x:${t.id}`);

          if (!shouldKeep(t.text, t.author_handle)) continue;

          if ((!t.media || t.media.length === 0) && t.author_handle) {
            await new Promise(r => setTimeout(r, 1500));
            const mediaMap = await getHandleMediaMap(t.author_handle);
            const enriched = mediaMap?.get(t.id);
            if (enriched?.media?.length) {
              t.media = enriched.media;
              if (!t.quoted_content && enriched.quoted_content) t.quoted_content = enriched.quoted_content;
              if ((!t.url_cards || t.url_cards.length === 0) && enriched.url_cards) t.url_cards = enriched.url_cards;
            }
          }

          const { isNew } = await upsertEventContent({
            eventId: event.id,
            platform: 'x',
            contentId: t.id,
            payload: {
              source_id: null,
              content_url: t.url,
              text: t.text || '',
              author: t.author || t.author_handle || 'Unknown',
              author_handle: t.author_handle || 'unknown',
              published_at: t.created_at ? new Date(t.created_at) : new Date(),
              engagement: {
                views: Number(t.metrics?.views || 0),
                likes: Number(t.metrics?.likes || 0),
                retweets: Number(t.metrics?.retweets || 0),
                comments: Number(t.metrics?.reply || 0)
              },
              media: t.media || [],
              quoted_content: t.quoted_content,
              raw_data: t.raw_data,
              url_cards: t.url_cards || [],
              scraped_content: t.media && t.media.length > 0 ? `Media Count: ${t.media.length}` : ''
            }
          });

          if (isNew) ingested++;
        }
      } catch (error) {
        console.error(`[EventMonitor] X search "${q}" for event ${event.name}: ${error.message}`);
      }
    }
  }

  // YouTube — one search per keyword, post-fetch text-match + per-author cap
  if (platforms.includes('youtube')) {
    for (const q of searchQueries) {
      try {
        const videos = await youtubeService.searchVideos(q);
        scanned += videos.length;

        for (const v of videos) {
          if (!v?.id || seenIds.has(`yt:${v.id}`)) continue;
          seenIds.add(`yt:${v.id}`);
          const text = `${v.title || ''}\n${v.description || ''}`.trim();
          if (!shouldKeep(text, v.channelId)) continue;

          const { content, isNew } = await upsertEventContent({
            eventId: event.id,
            platform: 'youtube',
            contentId: v.id,
            payload: {
              source_id: null,
              content_url: `https://www.youtube.com/watch?v=${v.id}`,
              text: text || v.title || 'Untitled',
              author: v.channelTitle || 'Unknown',
              author_handle: v.channelId || 'unknown',
              published_at: v.publishedAt ? new Date(v.publishedAt) : new Date(),
              duration: v.duration,
              thumbnails: v.thumbnails,
              tags: v.tags,
              category_id: v.categoryId,
              engagement: {
                views: Number(v.statistics?.viewCount || 0),
                likes: Number(v.statistics?.likeCount || 0),
                comments: Number(v.statistics?.commentCount || 0)
              },
              media: [{
                url: `https://www.youtube.com/watch?v=${v.id}`,
                type: 'video'
              }]
            }
          });

          if (isNew) ingested++;

          try {
            const comments = await youtubeService.getVideoComments(v.id, 50);
            for (const c of comments) {
              const existing = await Comment.findOne({ comment_id: c.id });
              if (existing) continue;

              await Comment.create({
                content_id: content.id,
                video_id: v.id,
                comment_id: c.id,
                author_channel_id: c.authorChannelId,
                author_display_name: c.authorDisplayName,
                author_profile_image: c.authorProfileImageUrl,
                text: c.textDisplay,
                like_count: c.likeCount,
                published_at: c.publishedAt ? new Date(c.publishedAt) : new Date(),
                sentiment: 'neutral',
                threat_score: 0,
                is_threat: false
              });
            }
          } catch {
            // Ignore comment ingestion failures
          }
        }
      } catch (error) {
        if (error.code === 403 || (error.message && error.message.includes('quota'))) {
          console.warn(`[EventMonitor] YouTube quota exceeded — skipping rest of YouTube scan for "${event.name}".`);
          break;
        }
        console.error(`[EventMonitor] YouTube search "${q}" for event ${event.name}: ${error.message}`);
      }
    }
  }

  // Facebook — one search per keyword, post-fetch text-match + per-author cap
  if (platforms.includes('facebook')) {
    for (const q of searchQueries) {
      try {
        const posts = await rapidApiFacebookService.searchPosts(q);
        scanned += posts.length;

        for (const p of posts) {
          if (!p?.id || seenIds.has(`fb:${p.id}`)) continue;
          seenIds.add(`fb:${p.id}`);
          if (!shouldKeep(p.text, p.author_handle || p.author)) continue;

          const { content, isNew } = await upsertEventContent({
            eventId: event.id,
            platform: 'facebook',
            contentId: p.id,
            payload: {
              source_id: null,
              content_url: p.url || `https://facebook.com/${p.id}`,
              text: p.text || '',
              author: p.author || 'Unknown',
              author_handle: p.author_handle || 'unknown',
              published_at: p.created_at ? new Date(p.created_at) : new Date(),
              engagement: {
                views: Number(p.metrics?.views || 0),
                likes: Number(p.metrics?.likes || 0),
                comments: Number(p.metrics?.comments || 0),
                retweets: Number(p.metrics?.shares || 0)
              }
            }
          });

          if (isNew) ingested++;

          try {
            if (p.metrics?.comments > 0) {
              const comments = await rapidApiFacebookService.fetchPostComments(p.id, 30);
              for (const c of comments) {
                const existing = await Comment.findOne({ comment_id: c.id });
                if (existing) continue;

                await Comment.create({
                  content_id: content.id,
                  video_id: p.id,
                  comment_id: c.id,
                  author_channel_id: c.author_id || 'unknown',
                  author_display_name: c.author_name || 'Unknown',
                  author_profile_image: c.author_image,
                  text: c.text,
                  like_count: c.likes || 0,
                  published_at: c.created_at ? new Date(c.created_at) : new Date(),
                  sentiment: 'neutral',
                  threat_score: 0,
                  is_threat: false
                });
              }
            }
          } catch {
            // Ignore comment ingestion failures
          }
        }
      } catch (error) {
        console.error(`[EventMonitor] Facebook search "${q}" for event ${event.name}: ${error.message}`);
      }
    }
  }

  event.last_polled_at = new Date();
  if (event.status !== 'active') event.status = 'active';
  await event.save();

  return { scanned, ingested, alerts };
};

const shouldPollEvent = (event, pollingIntervalMinutes) => {
  if (!pollingIntervalMinutes) return true;
  if (!event.last_polled_at) return true;
  const last = new Date(event.last_polled_at).getTime();
  const now = Date.now();
  return now - last >= pollingIntervalMinutes * 60 * 1000;
};

module.exports = {
  getActiveEvents,
  autoArchiveEndedEvents,
  scanEventOnce,
  shouldPollEvent
};
