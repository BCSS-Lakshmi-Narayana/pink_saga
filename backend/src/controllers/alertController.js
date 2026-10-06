const axios = require('axios');
const Alert = require('../models/Alert');
const Content = require('../models/Content');
const Keyword = require('../models/Keyword');
const { createAuditLog } = require('../services/auditService');
// Withholds alerts still being scored — see config/displayGate.js.
const { alertGate, applyGate } = require('../config/displayGate');
const { fetchTweetDetail } = require('../services/rapidApiXService');
const YouTubeService = require('../services/youtube.service');
const { fetchInstagramPostDetail } = require('../services/rapidApiInstagramService');
const { analyzeContent } = require('../services/analysisService');
const { archiveContentMedia, archiveTwitterMedia } = require('../services/contentS3Service');
const cacheService = require('../services/cacheService');
const translationService = require('../services/translationService');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const { MOJIBAKE_SIGNATURE } = require('../utils/textEncoding');

const mongoose = require('mongoose');

const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * AND an "any of these fields" group onto an alert query.
 *
 * Mongo allows one top-level `$or`, so groups go onto `$and` — appended, never
 * assigned. The category filter used to assign `query.$or` outright and the
 * keyword filter then hand-rolled its own merge; whichever ran second decided
 * whether the first survived.
 */
const addAlertOr = (query, clauses) => {
  if (!Array.isArray(clauses) || clauses.length === 0) return query;
  query.$and = [...(query.$and || []), { $or: clauses }];
  return query;
};

/**
 * Identifies the caller's row scope for cache keys. Every alerts response is
 * scope-dependent, so two callers may share a cached entry only when they can
 * see the same rows.
 */
const alertScopeKey = (scope) => (
  scope?.canSeeAll ? 'all' : [...(scope?.constituencies || [])].sort().join(',') || 'none'
);

/**
 * Aggregation stages that apply the search box.
 *
 * Search cannot live in buildAlertMatch because it reaches into the joined
 * Content and Source rows, so it is stages rather than a match object — but it
 * still has to be the SAME stages everywhere, or the chips describe a different
 * set from the feed. The topic-count endpoint had no search handling at all, so
 * typing in the search box moved the feed and left every chip unchanged.
 *
 * Returns [] when there is nothing to search for, so callers can spread it
 * unconditionally.
 */
const alertSearchStages = (search) => {
  const raw = typeof search === 'string' ? search.trim() : '';
  if (!raw) return [];

  // A leading '@' is how an operator types a handle; the stored values do not
  // carry it, so it is stripped from the whole phrase and from each word.
  const cleanSearch = raw.startsWith('@') ? raw.substring(1) : raw;
  const terms = raw.split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith('@') ? t.substring(1) : t));
  const searchRegex = terms.length > 0
    ? { $regex: terms.map((t) => escapeRegex(t)).join('|'), $options: 'i' }
    : { $regex: escapeRegex(cleanSearch), $options: 'i' };

  return [
    {
      $lookup: {
        from: 'contents',
        localField: 'content_id',
        foreignField: 'id',
        pipeline: [{
          $project: {
            id: 1,
            text: 1,
            translated_text: 1,
            scraped_content: 1,
            content_url: 1,
            author_handle: 1,
            original_author_name: 1,
            source_id: 1
          }
        }],
        as: 'content_data'
      }
    },
    { $unwind: { path: '$content_data', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'sources',
        localField: 'content_data.source_id',
        foreignField: 'id',
        pipeline: [{ $project: { id: 1, display_name: 1, identifier: 1, category: 1 } }],
        as: 'source_data'
      }
    },
    { $unwind: { path: '$source_data', preserveNullAndEmptyArrays: true } },
    {
      $match: {
        $or: [
          { id: searchRegex },
          { title: searchRegex },
          { description: searchRegex },
          { author: searchRegex },
          { author_handle: searchRegex },
          { platform: searchRegex },
          { status: searchRegex },
          { risk_level: searchRegex },
          { source_category: searchRegex },
          { alert_type: searchRegex },
          { 'llm_analysis.grievance_type': searchRegex },
          { 'content_data.text': searchRegex },
          { 'content_data.translated_text': searchRegex },
          { 'content_data.scraped_content': searchRegex },
          { 'content_data.content_url': searchRegex },
          { 'content_data.author_handle': searchRegex },
          { 'content_data.original_author_name': searchRegex },
          { 'source_data.display_name': searchRegex },
          { 'source_data.identifier': searchRegex },
          { 'source_data.category': searchRegex }
        ]
      }
    },
    // Drop the heavy joined documents before sorting or grouping.
    { $project: { content_data: 0, source_data: 0 } }
  ];
};

const ALERT_STATUS_VALUES = ['active', 'false_positive', 'acknowledged', 'escalated'];

// title/description/etc that still carry the raw mojibake signature have
// already failed the automatic repair that runs on every write
// (mojibakeGuardPlugin) — the corruption is unrecoverable, so hide it from
// lists instead of attempting another repair pass.
const MOJIBAKE_RX = { $regex: MOJIBAKE_SIGNATURE.source };
const NOT_MOJIBAKE_NOR = [
  { title: MOJIBAKE_RX },
  { description: MOJIBAKE_RX },
  { author: MOJIBAKE_RX },
  { author_handle: MOJIBAKE_RX },
  { complaint_text: MOJIBAKE_RX },
  { classification_explanation: MOJIBAKE_RX },
  { priority_reason: MOJIBAKE_RX }
];

// Raw `llm_analysis.grievance_type` values that get merged and displayed
// under one canonical topic label (see normalizeTopicName in
// getTopicClassificationCounts, which this must stay in sync with). The
// stored value is NEVER literally "General Complaint" — it's always one of
// these — so any query filtering by the canonical label must match all of
// its aliases, not the label itself, or it returns zero rows.
const TOPIC_ALIASES = {
  'General Complaint': ['General Complaint', 'Government Praise', 'Govt Praise', 'General Praise'],
};

/**
 * The values that mean "the classifier produced no usable topic".
 *
 * These were excluded from the chip counts and, because the only way to filter
 * by topic was to name one, unreachable through the UI entirely — a large slice
 * of the feed with no way to isolate it. `UNCLASSIFIED_TOPIC` is a real filter
 * value so that bucket can be selected like any other.
 */
const UNCLASSIFIED_TOPIC_VALUES = [null, '', 'Normal', 'Not a Grievance'];
const UNCLASSIFIED_TOPIC = 'unclassified';

/** Matches alerts the classifier gave no usable topic — absent field included. */
const unclassifiedTopicClause = () => ({
  $or: [
    { 'llm_analysis.grievance_type': { $exists: false } },
    { 'llm_analysis.grievance_type': { $in: UNCLASSIFIED_TOPIC_VALUES } },
  ],
});

/** Matches alerts that DO carry a usable topic. */
const classifiedTopicClause = () => ({
  'llm_analysis.grievance_type': { $exists: true, $nin: UNCLASSIFIED_TOPIC_VALUES },
});

const isUnclassifiedTopic = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return v === UNCLASSIFIED_TOPIC || v === 'normal' || v === 'none';
};

// Builds the `llm_analysis.grievance_type` query fragment for a topic filter,
// expanding to every raw alias when the requested topic is a canonical label.
const buildTopicClassificationQuery = (topicClassification) => {
  const aliases = TOPIC_ALIASES[topicClassification];
  if (aliases) {
    return { $in: aliases.map((a) => new RegExp(`^${escapeRegex(a)}$`, 'i')) };
  }
  return { $regex: `^${escapeRegex(topicClassification)}$`, $options: 'i' };
};

// Negative/Neutral/Positive filtering must reflect stance RELATIVE TO the
// client government (llm_analysis.target_sentiment) — NOT risk_level, which is shared
// with non-political alert types (velocity/viral spikes) that never ran through
// the political-sentiment pipeline. An alert only lands in a bucket once its
// target sentiment is confirmed; alerts with no stored value match none of
// these three filters. 'moderate' is the retired name of 'neutral'.
// These are the exact spellings `normalize()` in frontend/src/lib/sentiment.js
// folds on read, so the query folds them the same way. Anything outside this
// set resolves to null on the card and must resolve to null here too, or the
// filter would claim a verdict the badge does not show.
const SENTIMENT_SPELLINGS = {
  positive: ['positive', 'low'],
  negative: ['negative', 'high', 'medium'],
  neutral: ['neutral', 'moderate'],
};
const ALL_SENTIMENT_SPELLINGS = Object.values(SENTIMENT_SPELLINGS).flat();

/** Retained under the old name: the plain per-bucket value lists. */
const TARGET_SENTIMENT_QUERY_VALUES = SENTIMENT_SPELLINGS;

const canonicalSentimentValue = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  return Object.keys(SENTIMENT_SPELLINGS).find((k) => SENTIMENT_SPELLINGS[k].includes(v)) || null;
};

/**
 * The field precedence the CARD uses to decide which badge to print — the
 * subset of getAlertSentiment() in frontend/src/lib/sentiment.js that can be
 * queried on an Alert document, in the same order. The `analysis.*` and
 * `content.*` rungs of that chain are hydrated after the query runs and cannot
 * be matched on here.
 */
// Negative / Neutral / Positive filter = the post's RAW sentiment.
const ALERT_SENTIMENT_PATHS = [
  'llm_analysis.generic_sentiment',
  'llm_analysis.sentiment',
  'sentiment',
];

/**
 * The card's last resort when no sentiment field resolved: risk is derived
 * from the raw sentiment, so it maps straight back.
 */
// Medium and high are both NEGATIVE (medium = ordinary complaint/criticism,
// high = threat/hate/violence/major scandal). Neutral and positive are both
// low, so a bare `low` cannot be told apart — it is shown as neutral rather
// than claimed as good news.
const SENTIMENT_RISK_FALLBACK = { critical: 'negative', high: 'negative', medium: 'negative', low: 'neutral' };

/**
 * Negative / Neutral / Positive, matching the verdict shown on the card.
 *
 * This used to query `target_sentiment` / `bsk_sentiment` only, while the card
 * resolved its badge through the whole precedence chain and then fell back to
 * `risk_level`. Any alert carrying neither of those two fields therefore
 * displayed a NEGATIVE / MODERATE / POSITIVE badge and yet matched NO sentiment
 * tab — reachable only under "All".
 *
 * The clause now reproduces the precedence: match on the first path that
 * resolves, exactly as the card reads it, so the three tabs partition the feed.
 */
const applyBskSentimentFilter = (query, sentiment) => {
  const wanted = canonicalSentimentValue(sentiment);
  if (!wanted) return;
  const want = SENTIMENT_SPELLINGS[wanted];

  // "This path yields no usable verdict" — absent, null, or an unrecognised
  // value. Mirrors normalize() returning null on the client.
  const unresolved = (path) => ({
    $or: [{ [path]: { $exists: false } }, { [path]: { $nin: ALL_SENTIMENT_SPELLINGS } }],
  });

  const terms = ALERT_SENTIMENT_PATHS.map((path, i) => (
    i === 0
      ? { [path]: { $in: want } }
      : { [path]: { $in: want }, $and: ALERT_SENTIMENT_PATHS.slice(0, i).map(unresolved) }
  ));

  const allPathsUnresolved = ALERT_SENTIMENT_PATHS.map(unresolved);

  // risk_level is a rendering of the sentiment, so it decides only when nothing
  // else does — same as the card.
  const riskLevels = Object.keys(SENTIMENT_RISK_FALLBACK).filter((l) => SENTIMENT_RISK_FALLBACK[l] === wanted);
  if (riskLevels.length > 0) {
    terms.push({ risk_level: { $in: riskLevels }, $and: allPathsUnresolved });
  }

  // Rule 2 of sentiment.js: a record with nothing stored is NOT good news, it
  // renders as 'neutral'. So the neutral bucket also owns the alerts that
  // resolve to nothing at all — velocity spikes, new_post alerts, captured
  // stories — which is what makes the three tabs sum to the whole feed.
  if (wanted === 'neutral') {
    terms.push({
      $and: [
        ...allPathsUnresolved,
        { $or: [{ risk_level: { $exists: false } }, { risk_level: { $nin: Object.keys(SENTIMENT_RISK_FALLBACK) } }] },
      ],
    });
  }

  addAlertOr(query, terms);
};
/**
 * Date bounds accept two shapes, and the difference matters.
 *
 *   'YYYY-MM-DD'          a calendar day carrying no timezone. Anchored to the
 *                         start/end of that day in UTC.
 *   a full ISO timestamp  an exact instant. The browser already resolved the
 *                         user's LOCAL day boundary into it, so it is returned
 *                         untouched.
 *
 * This used to snap every value with `setHours`, i.e. to the SERVER's local
 * day — so the window depended on where the server runs, and any precise
 * instant the client computed was thrown away.
 */
const DATE_ONLY_RX = /^\d{4}-\d{2}-\d{2}$/;

const parseDateBoundary = (value, { end = false } = {}) => {
  if (!value) return null;
  const raw = String(value).trim();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  if (DATE_ONLY_RX.test(raw)) {
    if (end) parsed.setUTCHours(23, 59, 59, 999);
    else parsed.setUTCHours(0, 0, 0, 0);
  }
  return parsed;
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
        // For Latin scripts, use word-boundary matching
        const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
          new RegExp(`\\b${escapedKeyword}\\b`, 'i'),        // Whole word match
          new RegExp(`#${escapedKeyword}`, 'i'),             // Hashtag
          new RegExp(`@${escapedKeyword}`, 'i')              // @mention
        ];
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
    console.error('[Alerts] Keyword matching error:', error.message);
    return [];
  }
};

const getAllowedAlertStatuses = (req) => {
  if (req?.rbac?.isSuperAdmin) return ALERT_STATUS_VALUES;

  const features = req?.rbac?.permissions?.['/alerts']?.features;
  if (!Array.isArray(features)) {
    // If no specific features configured but user has page access, default to 'active'
    return ['active'];
  }

  const filtered = ALERT_STATUS_VALUES.filter((status) => features.includes(status));
  // If user has features but they don't match any status, default to 'active'
  return filtered.length > 0 ? filtered : ['active'];
};

const normalizeIdentifier = (platform, identifier) => {
  if (!identifier) return '';
  const id = String(identifier).trim();

  switch (String(platform).toLowerCase()) {
    case 'x':
    case 'twitter':
      return id.replace(/^@/, '').toLowerCase();
    case 'youtube':
    case 'instagram':
      return id.toLowerCase();
    default:
      return id;
  }
};

const mediaHasS3Gaps = (media = []) => {
  if (!Array.isArray(media) || media.length === 0) return false;
  return media.some((item) => {
    const hasSource = Boolean(item?.video_url || item?.url);
    return hasSource && !item?.s3_url;
  });
};

const archiveAlertMediaForContent = async (contentDetails = {}) => {
  const platform = String(contentDetails.platform || '').toLowerCase();
  const contentId = contentDetails.id;
  if (!contentId || !['x', 'instagram'].includes(platform)) return;

  const media = Array.isArray(contentDetails.media) ? contentDetails.media : [];
  const quotedMedia = Array.isArray(contentDetails?.quoted_content?.media) ? contentDetails.quoted_content.media : [];

  if (!mediaHasS3Gaps(media) && (platform !== 'x' || !mediaHasS3Gaps(quotedMedia))) {
    return;
  }

  try {
    const patch = {};

    if (platform === 'x') {
      if (mediaHasS3Gaps(media)) {
        patch.media = await archiveTwitterMedia(media, contentDetails.content_id || contentId);
      }
      if (mediaHasS3Gaps(quotedMedia)) {
        patch.quoted_content = {
          ...(contentDetails.quoted_content || {}),
          media: await archiveTwitterMedia(
            quotedMedia,
            `${contentDetails.content_id || contentId}_quoted_${contentDetails?.quoted_content?.author_handle || 'unknown'}`
          )
        };
      }
      const effectiveMedia = patch.media || media;
      patch.is_media_archived = effectiveMedia.length > 0 && !mediaHasS3Gaps(effectiveMedia);
    } else if (platform === 'instagram' && mediaHasS3Gaps(media)) {
      patch.media = await archiveContentMedia(media, contentDetails.content_id || contentId, {
        useUniqueFileName: true,
        replaceOriginalUrls: false
      });
      patch.is_media_archived = patch.media.length > 0 && !mediaHasS3Gaps(patch.media);
    }

    if (Object.keys(patch).length > 0) {
      await Content.updateOne({ id: contentId }, { $set: patch });
    }
  } catch (error) {
    console.warn(`[Alerts] Media archive retry failed for ${platform}:${contentDetails.content_id || contentId} - ${error.message}`);
  }
};

const queueAlertMediaArchival = (alerts = []) => {
  const candidates = (Array.isArray(alerts) ? alerts : [])
    .map((a) => a?.content_details)
    .filter((content) => content && (content.platform === 'x' || content.platform === 'instagram'))
    .slice(0, 10);

  if (candidates.length === 0) return;

  Promise.allSettled(candidates.map((content) => archiveAlertMediaForContent(content)))
    .catch(() => {
      // Intentionally swallow background errors.
    });
};

const getCacheKey = (prefix, params) => {
  const ordered = Object.keys(params || {})
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});
  return `${prefix}:${JSON.stringify(ordered)}`;
};

const readCache = async (key) => cacheService.get(key);
const writeCache = async (key, value, ttl = 20) => cacheService.set(key, value, ttl);
const clearAlertCache = async () => {
  await cacheService.invalidatePrefix('alerts:list:v2');
  await cacheService.invalidatePrefix('alerts:stats:v2');
  await cacheService.invalidatePrefix('alerts:topic-counts:v1');
  await cacheService.invalidatePrefix('dashboard:v2');
  await cacheService.invalidatePrefix('alert_summary');
  await cacheService.invalidatePrefix('unread_count');
  // Bump the list-cache version so a GET already in flight when this ran
  // (e.g. the background checkForNewAlerts poll overlapping a delete) can't
  // write stale pre-delete data back into the cache after invalidatePrefix
  // already cleared it above.
  await cacheService.bumpVersion('alerts:list');
  await cacheService.invalidatePrefix('alerts:topic-counts:v2');
  await cacheService.invalidatePrefix('alerts:source-categories:v1');
  await cacheService.invalidatePrefix('alerts:keyword-counts:v1');
};

/**
 * THE filter set every alerts surface matches on.
 *
 * The list, the topic-classification chip counts and the status stats each
 * built their own copy of this, and the three had drifted apart — so a chip's
 * number was not the number of rows clicking it returned:
 *
 *   · the counts and stats filtered dates on `created_at`, the list on
 *     `published_at` — two different fields, so a date range moved the chips
 *     and the feed to different sets;
 *   · the counts destructured `keyword` and `category` and then never applied
 *     them, so those two filters moved the feed and left the chips untouched;
 *   · the counts and stats required a non-empty `matched_keywords` on EVERY
 *     caller, while the list deliberately waives that for unscoped admins —
 *     so an admin's chips counted a strict subset of their own feed;
 *   · only the list applied the mojibake filter and the RBAC row scope, so the
 *     chips counted rows the feed hides, and a constituency-scoped user saw
 *     statewide chip counts.
 *
 * Returns `{ query, empty }`. `empty` means a pre-resolution step matched
 * nothing, so the caller should return an empty payload rather than run a
 * query that cannot match.
 *
 * The display gate (config/displayGate.js) is deliberately NOT applied here —
 * it is asynchronous and is layered on by each caller at the point it runs its
 * count and its rows together, so the two can never disagree.
 */
const { buildStanceClause, ALERT_STANCE_PATHS } = require('../utils/stanceFilter');

const buildAlertMatch = async (params = {}, scope = null, options = {}) => {
  const { includeTopic = true, includeStatus = true } = options;
  const {
    status, risk_level, sentiment, stance, platform, startDate, endDate,
    alert_type, keyword, category, topic_classification, source_id,
  } = params;

  const query = { $nor: NOT_MOJIBAKE_NOR };

  // RBAC row-level scope: a scoped MLA / MP / NL user can only see alerts
  // whose title / description / matched keywords reference their seat.
  if (scope && !scope.canSeeAll) {
    const allowedSeats = scope.constituencies || [];
    if (allowedSeats.length === 0) return { query, empty: true };
    const seatRegex = new RegExp(allowedSeats.map(escapeRegex).join('|'), 'i');
    query.$and = (query.$and || []).concat([{
      $or: [
        { title: seatRegex },
        { description: seatRegex },
        { matched_keywords_normalized: seatRegex },
      ],
    }]);
    // Keyword gate, for scoped users only. Superadmin / party leadership see
    // every alert regardless of whether matched_keywords has been populated.
    query.$and = (query.$and || []).concat([{
      $or: [
        { matched_keywords: { $exists: true, $ne: [] } },
        { matched_keywords_normalized: { $exists: true, $ne: [] } },
      ],
    }]);
  }

  if (includeStatus && status && status !== 'all') query.status = status;
  if (risk_level && risk_level !== 'all') query.risk_level = risk_level;
  if (sentiment && sentiment !== 'all') applyBskSentimentFilter(query, sentiment);
  // Supportive / Opposing / Neutral — the stance badge the card shows.
  const stanceClause = buildStanceClause(stance, ALERT_STANCE_PATHS);
  if (stanceClause) query.$and = (query.$and || []).concat([stanceClause]);
  // leader_seat: alerts whose post tags the seat's MLA, names them, or names
  // the seat (leaderMentionService) — the MLA detail page's evidence.
  if (params.leader_seat) {
    const { getAlertEvidenceIds } = require('../services/leaderMentionService');
    query.id = { $in: await getAlertEvidenceIds(String(params.leader_seat)) };
  }
  if (platform && platform !== 'all') query.platform = platform;

  if (alert_type && alert_type !== 'all') {
    query.alert_type = alert_type === 'risk'
      ? { $in: ['keyword_risk', 'ai_risk', null] }
      : alert_type;
  }

  if (includeTopic && topic_classification && topic_classification !== 'all') {
    if (isUnclassifiedTopic(topic_classification)) {
      // An $or, because "no topic" includes the field being absent.
      query.$and = (query.$and || []).concat([unclassifiedTopicClause()]);
    } else {
      query['llm_analysis.grievance_type'] = buildTopicClassificationQuery(topic_classification);
    }
  }

  // Dates filter on `published_at` — when the post appeared on the platform,
  // which is what the list sorts by and what the picker claims to filter.
  // `created_at` (when WE raised the alert) is a different question and gave
  // the chips a different answer from the feed.
  if (startDate || endDate) {
    const start = parseDateBoundary(startDate);
    const end = parseDateBoundary(endDate, { end: true });
    const bounds = {};
    if (start) bounds.$gte = start;
    if (end) bounds.$lte = end;

    if (Object.keys(bounds).length > 0) {
      // `published_at` is the post's time on the platform and is the right
      // field to filter on — but alerts that carry none were silently dropped
      // from every date range when it was matched on alone. The model
      // documents created_at as the fallback and the sort already uses it that
      // way, so the filter honours the same fallback.
      addAlertOr(query, [
        { published_at: bounds },
        { published_at: null, created_at: bounds },
        { published_at: { $exists: false }, created_at: bounds },
      ]);
    }
  }

  const Source = require('../models/Source');

  // ── category → content ids ──
  if (category && category !== 'all') {
    const catSources = await Source.find({ category }).select('id').lean();
    const catSourceIds = catSources.map((s) => s.id);
    if (catSourceIds.length === 0) return { query, empty: true };

    const catContents = await Content.find({ source_id: { $in: catSourceIds } }).select('id').lean();
    const catContentIds = catContents.map((c) => c.id);
    if (catContentIds.length > 0) {
      addAlertOr(query, [
        { content_id: { $in: catContentIds } },
        { source_category: category },
      ]);
    } else {
      query.source_category = category;
    }
  }

  // ── source_id → content ids ──
  if (source_id) {
    const possibleSourceIds = [source_id];
    if (mongoose.Types.ObjectId.isValid(source_id)) {
      const sourceRecord = await Source.findById(source_id).select('id').lean();
      if (sourceRecord?.id) possibleSourceIds.push(sourceRecord.id);
    }
    const sidContents = await Content.find({ source_id: { $in: possibleSourceIds } }).select('id').lean();
    const sidContentIds = sidContents.map((c) => c.id);
    if (sidContentIds.length === 0) return { query, empty: true };
    query.content_id = { ...(query.content_id || {}), $in: sidContentIds };
  }

  // ── keyword → content ids ──
  if (keyword && keyword !== 'all') {
    const kw = String(keyword).trim().toLowerCase();
    const kwContents = await Content.find({
      'risk_factors.keyword': { $regex: `^${escapeRegex(kw)}`, $options: 'i' },
    }).select('id').lean();
    const kwContentIds = kwContents.map((c) => c.id);
    const kwOr = [{ matched_keywords_normalized: kw }];
    if (kwContentIds.length > 0) kwOr.push({ content_id: { $in: kwContentIds } });
    addAlertOr(query, kwOr);
  }

  return { query, empty: false };
};

// @desc    Get alerts
// @route   GET /api/alerts
// @access  Private
const getAlerts = async (req, res) => {
  try {
    const {
      status,
      risk_level,
      sentiment,
      search,
      platform,
      startDate,
      endDate,
      alert_type,
      keyword,
      category,
      topic_classification,
      page = 1,
      limit = 20
    } = req.query;

    // One shared filter set for the list, the topic chips and the status
    // stats — see buildAlertMatch. Built before the cache lookup so an empty
    // pre-resolution short-circuits without touching the cache.
    const { query, empty: filterMatchesNothing } = await buildAlertMatch(req.query, req.scope);

    const allowedStatuses = getAllowedAlertStatuses(req);

    const includeStats = String(req.query.includeStats || '').toLowerCase() === 'true';
    const cursor = req.query.cursor;
    let pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // Support page-encoded cursor for aggregation path (format: "p:N")
    if (cursor && cursor.startsWith('p:')) {
      const cursorPage = parseInt(cursor.substring(2), 10);
      if (!isNaN(cursorPage) && cursorPage > 0) pageNum = cursorPage;
    }

    const skip = (pageNum - 1) * limitNum;
    const hasSearch = search && search.trim();

    const Source = require('../models/Source');

    // A filter resolved to nothing (an unknown category, a source with no
    // content, a scoped user with no seats) — answer directly rather than run
    // a query that cannot match.
    if (filterMatchesNothing) {
      const emptyPayload = {
        alerts: [],
        pagination: { total: 0, page: pageNum, totalPages: 0, hasMore: false, nextCursor: null }
      };
      if (includeStats) emptyPayload.stats = await buildAlertStats(req.query, req.scope);
      return res.status(200).json(emptyPayload);
    }

    const listCacheVersion = await cacheService.getVersion('alerts:list');
    const cacheKey = getCacheKey('alerts:list:v2', {
      ...req.query,
      includeStats,
      cursor: cursor || '',
      // The result depends on the caller's row scope, so the cache key has to
      // as well. Without this a super-admin's unscoped page could be served to
      // a constituency-scoped user, and vice versa, for the same query string.
      _scope: alertScopeKey(req.scope),
      _v: listCacheVersion
    });
    const cachedResponse = await readCache(cacheKey);
    if (cachedResponse) return res.status(200).json(cachedResponse);

    // Category, source_id and keyword are already resolved into the query by
    // buildAlertMatch, so the list, the chips and the stats resolve them the
    // same way instead of each keeping its own copy.

    const needsLookup = !!hasSearch; // Only search still needs $lookup (for content text)

    let alerts = [];
    let hasMore = false;
    let nextCursor = null;
    let total;

    if (needsLookup) {
      // Search across alert fields plus joined content/source metadata so
      // operators can find an alert by any visible detail on the card. The
      // stages are shared with the status stats and the topic chips (see
      // alertSearchStages) so all three describe the same set, and they strip
      // the joined documents again before the sort to save memory.
      //
      // Gated like the non-search path below. This branch skipped applyGate
      // entirely, so typing in the search box surfaced alerts the unsearched
      // feed deliberately withholds.
      const pipeline = [
        { $match: applyGate({ ...query }, await alertGate()) },
        ...alertSearchStages(search)
      ];

      // Count via a separate query-style: use two pipelines
      // Pipeline 1: count
      const countPipeline = [...pipeline, { $count: 'total' }];
      // Pipeline 2: paginated data — sort by platform post time (published_at)
      const dataPipeline = [...pipeline, { $sort: { published_at: -1, id: -1 } }, { $skip: skip }, { $limit: limitNum }];

      const [countResult, dataResult] = await Promise.all([
        Alert.aggregate(countPipeline).option({ allowDiskUse: true }),
        Alert.aggregate(dataPipeline).option({ allowDiskUse: true })
      ]);

      alerts = dataResult || [];
      total = countResult?.[0]?.total || 0;
      hasMore = pageNum * limitNum < total;
      if (hasMore) {
        nextCursor = `p:${pageNum + 1}`;
      }
    } else {
      if (cursor && !cursor.startsWith('p:')) {
        const [cursorDateRaw, cursorId] = String(cursor).split('|');
        const cursorDate = new Date(cursorDateRaw);
        if (!isNaN(cursorDate.getTime()) && cursorId) {
          const cursorCondition = {
            $or: [
              { published_at: { $lt: cursorDate } },
              { published_at: cursorDate, id: { $lt: cursorId } }
            ]
          };
          // Merge without overwriting existing $or/$and from pre-resolved filters
          query.$and = query.$and || [];
          if (query.$or) {
            query.$and.push({ $or: query.$or });
            delete query.$or;
          }
          query.$and.push(cursorCondition);
          if (query.$and.length === 0) delete query.$and;
        }
      }

      const useDateCursor = cursor && !cursor.startsWith('p:');

      /**
       * Withhold alerts the pipeline has not finished scoring. Applied here,
       * after every filter and the cursor condition are built, so it cannot be
       * overwritten by a branch above assigning `query.$or` directly — and to
       * BOTH the rows and the count, or pagination would report totals for a
       * larger set than it returns.
       */
      const gatedQuery = applyGate(query, await alertGate());

      // Always count total for accurate pagination (needed for hasMore calculation)
      const countPromise = Alert.countDocuments(gatedQuery);

      const rows = await Alert.find(gatedQuery)
        .sort({ published_at: -1, id: -1 })
        .skip(useDateCursor ? 0 : skip)
        .limit(limitNum + 1)
        .lean();

      total = await countPromise;
      hasMore = pageNum * limitNum < total;
      alerts = rows.length > limitNum ? rows.slice(0, limitNum) : rows;
      if (hasMore && alerts.length > 0) {
        const last = alerts[alerts.length - 1];
        const lastTs = last.published_at || last.created_at;
        nextCursor = `${new Date(lastTs).toISOString()}|${last.id}`;
      }
    }

    // Join content + source for only visible rows
    const contentIds = Array.from(new Set(alerts.map((a) => a.content_id || a.content_ref_id).filter(Boolean)));

    // Kick off stats computation immediately — runs concurrently with joins below
    const statsPromise = includeStats
      ? buildAlertStats({ ...req.query, search: hasSearch ? search : '' }, req.scope)
      : Promise.resolve(null);

    const contents = await Content.find({ id: { $in: contentIds } })
      .select('id platform content_type content_url text author_handle published_at engagement media is_deleted deleted_at is_expired expired_at availability_status is_repost original_author original_author_name original_author_avatar quoted_content url_cards thumbnails risk_factors risk_level source_id translated_text scraped_content')
      .lean();
    const contentMap = new Map(contents.map((c) => [c.id, c]));

    const sourceIds = Array.from(new Set(contents.map((c) => c.source_id).filter(Boolean)));

    // Run sources + analyses + stats all in parallel
    const Analysis = require('../models/Analysis');
    const [sources, analyses, resolvedStats] = await Promise.all([
      Source.find({ id: { $in: sourceIds } })
        .select('id profile_image_url is_verified display_name identifier category')
        .lean(),
      Analysis.find({ content_id: { $in: contentIds } }).lean(),
      statsPromise,
    ]);

    const sourceMap = new Map(sources.map((s) => [s.id, s]));
    const analysisMap = new Map();
    // Use a map of content_id -> last analysis (most recent)
    analyses.forEach(a => {
      const current = analysisMap.get(a.content_id);
      const hasForensics = a.forensic_results && Array.isArray(a.forensic_results) && a.forensic_results.length > 0;

      if (!current) {
        analysisMap.set(a.content_id, a);
      } else {
        const currentHasForensics = current.forensic_results && Array.isArray(current.forensic_results) && current.forensic_results.length > 0;

        // Prefer one with forensics, or if both/neither, take the more recent one
        if (hasForensics && !currentHasForensics) {
          analysisMap.set(a.content_id, a);
        } else if (hasForensics === currentHasForensics) {
          if (new Date(a.analyzed_at) > new Date(current.analyzed_at)) {
            analysisMap.set(a.content_id, a);
          }
        }
      }
    });

    const hydrated = alerts.map((alert) => {
      const content = contentMap.get(alert.content_id || alert.content_ref_id);
      if (content && analysisMap.has(content.id)) {
        content.analysis = analysisMap.get(content.id);
      }
      const source = content ? sourceMap.get(content.source_id) : null;
      return {
        ...alert,
        content_details: content || null,
        source_meta: source
          ? {
            profile_image_url: source.profile_image_url,
            is_verified: source.is_verified,
            name: source.display_name,
            handle: source.identifier
          }
          : null
      };
    });

    queueAlertMediaArchival(hydrated);

    const responsePayload = {
      alerts: hydrated,
      pagination: {
        total,
        page: pageNum,
        totalPages: typeof total === 'number' ? Math.ceil(total / limitNum) : undefined,
        hasMore,
        nextCursor
      }
    };

    if (includeStats && resolvedStats) {
      responsePayload.stats = resolvedStats;
    }

    await writeCache(cacheKey, responsePayload, 20);
    res.status(200).json(responsePayload);

  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update alert
// @route   PUT /api/alerts/:id
// @access  Private
const updateAlert = async (req, res) => {
  try {
    const { status, notes, source_id, risk_level } = req.body;
    const alert = await Alert.findOne({ id: req.params.id });

    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    const updateDoc = {};

    if (status) {
      updateDoc.status = status;
      updateDoc.acknowledged_by = req.user.id;
      updateDoc.acknowledged_at = new Date();
    }

    if (notes) updateDoc.notes = notes;
    if (source_id !== undefined) updateDoc.source_id = source_id;

    // Risk level override support
    if (risk_level && ['low', 'medium', 'high', 'critical'].includes(risk_level.toLowerCase())) {
      updateDoc.risk_level = risk_level.toLowerCase();
    }

    const updatedAlert = await Alert.findOneAndUpdate(
      { id: req.params.id },
      updateDoc,
      { new: true }
    );

    await clearAlertCache();
    // --- ML FEEDBACK LOOP ---
    // If status changed to false positive, record it for model retraining
    if (status && status !== alert.status && (status === 'false_positive' || status === 'escalated')) {
      try {
        const feedbackService = require('../services/feedbackService');
        const Content = require('../models/Content');

        // Fetch full content text
        const content = await Content.findOne({
          $or: [{ id: alert.content_id }, { content_id: alert.content_id }]
        });

        if (content && content.text) {
          await feedbackService.recordFeedback({
            text: content.text,
            category: alert.category_id || alert.category || 'Normal',
            legal_sections: alert.legal_sections,
            review_status: status,
            current_risk: alert.risk_level || 'low'
          });
        }
      } catch (fbError) {
        console.error('[AlertController] Feedback recording failed:', fbError);
      }
    }

    await createAuditLog(req.user, 'update', 'alert', req.params.id, { status, source_id, risk_level: updateDoc.risk_level });

    res.status(200).json(updatedAlert);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete alert permanently
// @route   DELETE /api/alerts/:id
// @access  Private
const deleteAlert = async (req, res) => {
  try {
    const alert = await Alert.findOne({ id: req.params.id });
    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }
    await Alert.deleteOne({ id: req.params.id });
    // Mark the underlying content as suppressed so the monitor loop,
    // velocity/viral alerting, and manual rescans don't recreate a fresh
    // alert for the same post next time they evaluate it — they all dedupe
    // by checking whether an Alert already exists for the content_id, which
    // is no longer true the instant we delete it above.
    if (alert.content_id) {
      await Content.updateOne({ content_id: alert.content_id }, { $set: { alert_suppressed: true } });
    }
    await clearAlertCache();
    await createAuditLog(req.user, 'delete', 'alert', req.params.id, {});
    res.status(200).json({ message: 'Alert deleted successfully' });
  } catch (error) {
    console.error('[deleteAlert]', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get alert stats
// @route   GET /api/alerts/stats
// @access  Private
const buildAlertStats = async (params = {}, scope = null, { skipPendingCount = true } = {}) => {
  const { search } = params;

  // Same filter set as the list and the topic chips, so the status counts
  // describe exactly the rows the feed is showing. This used to be a third
  // hand-written copy that filtered dates on `created_at` rather than
  // `published_at`, always demanded a non-empty matched_keywords (even for the
  // unscoped admins the list deliberately waives it for), and skipped the
  // mojibake filter and the RBAC row scope entirely.
  //
  // `status` is excluded on purpose: this aggregate GROUPS BY status to produce
  // the per-tab counts, so constraining it to the selected tab would report 0
  // for every other tab. Every other filter applies.
  const { query, empty } = await buildAlertMatch(params, scope, { includeStatus: false });
  const EMPTY_STATS = {
    active: 0, acknowledged: 0, escalated: 0, resolved: 0,
    false_positive: 0, escalated_pending_report: 0,
  };
  if (empty) return EMPTY_STATS;

  // Gated like the feed, or the status pills promise more than the list shows.
  const gatedQuery = applyGate({ ...query }, await alertGate());

  // Identical search stages to the feed and the topic chips.
  const basePipeline = [{ $match: gatedQuery }, ...alertSearchStages(search)];

  const stats = { active: 0, acknowledged: 0, escalated: 0, resolved: 0, false_positive: 0, escalated_pending_report: 0 };

  const statusResult = await Alert.aggregate([
    ...basePipeline,
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]).option({ allowDiskUse: true });

  statusResult.forEach((item) => {
    if (item._id && Object.prototype.hasOwnProperty.call(stats, item._id)) stats[item._id] = item.count;
  });

  if (!skipPendingCount) {
    const pendingResult = await Alert.aggregate([
      ...basePipeline,
      { $match: { status: 'escalated' } },
      {
        $lookup: {
          from: 'reports',
          let: { alertId: '$id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$alert_id', '$$alertId'] } } },
            { $limit: 1 }
          ],
          as: 'report_exists'
        }
      },
      { $match: { report_exists: { $size: 0 } } },
      { $count: 'count' }
    ]).option({ allowDiskUse: true });
    stats.escalated_pending_report = pendingResult?.[0]?.count || 0;
  }

  return stats;
};

const getAlertStats = async (req, res) => {
  try {
    const statsCacheKey = getCacheKey('alerts:stats:v2', req.query || {});
    const cachedStats = await readCache(statsCacheKey);
    if (cachedStats) return res.status(200).json(cachedStats);

    const stats = await buildAlertStats(req.query || {}, req.scope, { skipPendingCount: false });
    await writeCache(statsCacheKey, stats, 60);
    res.status(200).json(stats);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get unread alerts count
// @route   GET /api/alerts/unread
// @access  Private
const getUnreadCount = async (req, res) => {
  try {
    const unreadCacheKey = 'unread_count:v2';
    const cachedUnread = await readCache(unreadCacheKey);
    if (cachedUnread) return res.status(200).json(cachedUnread);

    // Same gate as the list, or the badge would count cards the list withholds.
    const unreadFilter = applyGate({ is_read: false }, await alertGate());

    const [count, latestAlert] = await Promise.all([
      Alert.countDocuments(unreadFilter),
      Alert.findOne(unreadFilter)
        .sort({ created_at: -1 })
        .select('title risk_level description id')
        .lean()
    ]);

    const payload = { count, latest_alert: latestAlert };
    await writeCache(unreadCacheKey, payload, 20);
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark all alerts as read
// @route   PUT /api/alerts/read
// @access  Private
const markAllAsRead = async (req, res) => {
  try {
    await Alert.updateMany(
      { is_read: false },
      { $set: { is_read: true } }
    );
    await clearAlertCache();
    res.status(200).json({ message: 'All alerts marked as read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get single alert by ID
// @route   GET /api/alerts/:id
// @access  Private
const getAlertById = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const isValidObjectId = mongoose.Types.ObjectId.isValid(req.params.id);
    const findQuery = isValidObjectId
      ? { $or: [{ id: req.params.id }, { _id: req.params.id }] }
      : { id: req.params.id };

    const alert = await Alert.findOne(findQuery);

    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    // Match criteria for aggregation
    const matchQuery = isValidObjectId
      ? { $or: [{ id: req.params.id }, { _id: new mongoose.Types.ObjectId(req.params.id) }] }
      : { id: req.params.id };

    // Manual lookup for content details if needed by frontend
    // Alternatively, use an aggregate pipeline like in getAlerts
    const result = await Alert.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: 'contents',
          localField: 'content_id',
          foreignField: 'id',
          as: 'content_data'
        }
      },
      {
        $unwind: {
          path: '$content_data',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'sources',
          localField: 'content_data.source_id',
          foreignField: 'id',
          as: 'source_data'
        }
      },
      {
        $unwind: {
          path: '$source_data',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'analyses',
          let: {
            alertAnalysisId: '$analysis_id',
            contentId: '$content_id'
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$id', '$$alertAnalysisId'] },
                    { $eq: ['$content_id', '$$contentId'] }
                  ]
                }
              }
            },
            // Sort to prefer records WITH forensic_results, and then by latest timestamp
            {
              $addFields: {
                hasForensics: {
                  $cond: { if: { $gt: [{ $size: { $ifNull: ['$forensic_results', []] } }, 0] }, then: 1, else: 0 }
                }
              }
            },
            { $sort: { hasForensics: -1, analyzed_at: -1, created_at: -1 } },
            { $limit: 1 }
          ],
          as: 'analysis_data'
        }
      },
      {
        $addFields: {
          content_details: {
            id: '$content_data.id',
            platform: '$content_data.platform',
            content_type: '$content_data.content_type',
            content_url: '$content_data.content_url',
            text: '$content_data.text',
            author_handle: '$content_data.author_handle',
            published_at: '$content_data.published_at',
            media: '$content_data.media',
            is_deleted: '$content_data.is_deleted',
            deleted_at: '$content_data.deleted_at',
            is_expired: '$content_data.is_expired',
            expired_at: '$content_data.expired_at',
            availability_status: '$content_data.availability_status',
            risk_level: '$content_data.risk_level',
            analysis: { $arrayElemAt: ['$analysis_data', 0] }
          },
          source_meta: {
            profile_image_url: '$source_data.profile_image_url',
            is_verified: '$source_data.is_verified',
            name: '$source_data.display_name',
            handle: '$source_data.identifier'
          }
        }
      },
      { $project: { analysis_data: 0, content_data: 0, source_data: 0 } }
    ]);

    const responsePayload = result[0];
    if (responsePayload?.content_details) {
      queueAlertMediaArchival([responsePayload]);
    }

    res.status(200).json(responsePayload);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Investigate a link (One-off check)
// @route   POST /api/alerts/investigate
// @access  Private
const fs = require('fs');
const path = require('path');

const resolveShortenedUrl = async (url, maxRedirects = 3) => {
  if (maxRedirects === 0) return url;
  try {
    const res = await axios.head(url, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 300 && status < 400,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    const location = res.headers.location;
    if (location) {
      const nextUrl = location.startsWith('http') ? location : new URL(location, url).href;
      return await resolveShortenedUrl(nextUrl, maxRedirects - 1);
    }
  } catch (e) {
    // If HEAD fails or No redirect, return original
  }
  return url;
};

const fetchGenericLinkMetadata = async (url) => {
  try {
    console.log(`[Investigation] Fetching generic metadata for: ${url}`);
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const title = $('title').text() || $('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content') || 'Unknown Title';
    const description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || $('meta[name="twitter:description"]').attr('content') || '';
    const author = $('meta[name="author"]').attr('content') || $('meta[property="og:site_name"]').attr('content') || new URL(url).hostname;
    const thumbnail = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || '';

    return {
      title,
      text: description || title,
      description,
      author,
      platform: 'web',
      media: thumbnail ? [{ type: 'photo', url: thumbnail }] : [],
      created_at: new Date()
    };
  } catch (error) {
    console.warn(`[Investigation] Generic metadata fetch failed for ${url}:`, error.message);
    return null;
  }
};

const investigateLink = async (req, res) => {
  try {
    const { url } = req.body;
    const Source = require('../models/Source');

    console.log(`[Investigation] ENTRY: POST /api/alerts/investigate with URL: ${url}`);
    if (!url) return res.status(400).json({ message: 'URL is required' });

    // Resolve shortened links (t.co, bit.ly etc)
    let resolvedUrl = url;
    if (url.includes('t.co') || url.includes('bit.ly') || url.includes('tinyurl.com')) {
      const resolved = await resolveShortenedUrl(url);
      if (resolved !== url) {
        console.log(`[Investigation] Resolved ${url} to ${resolved}`);
        resolvedUrl = resolved;
      }
    }

    console.log(`[Investigation] Starting on-demand check for: ${resolvedUrl} (User: ${req.user?.email || 'unknown'})`);

    let platform = '';
    let contentId = '';
    let metadata = null;

    // 1. Identify Platform & ID
    if (resolvedUrl.includes('x.com') || resolvedUrl.includes('twitter.com')) {
      platform = 'x';
      // Match status ID which is typically numbers at the end of path or before query
      const match = resolvedUrl.match(/status\/(\d+)/);
      if (match) {
        contentId = match[1];
      } else {
        // Fallback: search for numbers that look like a tweet ID (long sequence)
        const longIdMatch = resolvedUrl.match(/\/(\d{15,})/);
        if (longIdMatch) contentId = longIdMatch[1];
      }
      console.log(`[Investigation] Detected X link, ID: ${contentId}`);
    } else if (resolvedUrl.includes('youtube.com') || resolvedUrl.includes('youtu.be')) {
      platform = 'youtube';
      const match = resolvedUrl.match(/(?:v=|v\/|vi\/|u\/\w\/|embed\/|shorts\/|e\/|youtu.be\/|v=)([^#&?]*).*/);
      if (match) contentId = match[1];
      console.log(`[Investigation] Detected YouTube link, ID: ${contentId}`);
    } else if (resolvedUrl.includes('instagram.com')) {
      platform = 'instagram';
      // Multi-format Instagram shortcode extraction
      const match = resolvedUrl.match(/\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/);
      if (match) contentId = match[1];
      console.log(`[Investigation] Detected Instagram link, shortcode: ${contentId}`);
    }

    if (!platform || !contentId) {
      console.log(`[Investigation] URL not a primary social link: ${resolvedUrl}. Attempting generic fetch...`);
      platform = 'web';
      contentId = `web_${Buffer.from(resolvedUrl).toString('base64').substring(0, 16)}`;
    }

    // 2. Fetch Metadata
    try {
      if (platform === 'x') {
        metadata = await fetchTweetDetail(contentId);
      } else if (platform === 'youtube') {
        const details = await YouTubeService.getVideoDetails([contentId]);
        if (details && details.length > 0) metadata = details[0];
      } else if (platform === 'instagram') {
        metadata = await fetchInstagramPostDetail(contentId);
        if (metadata) {
          // Normalize Instagram metadata for analysis
          metadata.text = metadata.text || '';
          metadata.title = `Instagram Post by ${metadata.author_handle}`;
        }
      } else if (platform === 'web') {
        metadata = await fetchGenericLinkMetadata(resolvedUrl);
      }
    } catch (fetchError) {
      console.log(`[Investigation] Metadata fetch failed for ${platform}:${contentId}: ${fetchError.message}`);
      return res.status(500).json({ message: `Service error while fetching ${platform} data: ${fetchError.message}` });
    }

    if (!metadata) {
      console.error(`[Investigation] ❌ CRITICAL: No metadata returned for ${platform}:${contentId}. URL was: ${resolvedUrl}`);
      return res.status(404).json({
        message: `Could not fetch details for this ${platform} link. The post might be private, deleted, or the API limit reached.`,
        debug: { platform, contentId, resolvedUrl }
      });
    }

    console.log(`[Investigation] Successfully fetched metadata for ${platform}:${contentId}. Content length: ${metadata.text?.length || 0}`);
    console.log(`[Investigation] Calling analyzeContent for ID: ${contentId}`);

    // 3. Analyze Content
    let analysis;
    const manualAnalysisId = uuidv4();
    try {
      analysis = await analyzeContent(metadata.text || metadata.description || metadata.title, {
        platform,
        content_id: contentId,
        content: {
          ...metadata,
          media: metadata.media || (platform === 'youtube' ? [{ url: resolvedUrl, type: 'video' }] : [])
        },
        analysisId: manualAnalysisId,
        skipForensics: true
      });
      console.log(`[Investigation] Analysis completed for ID: ${contentId}. Risk: ${analysis.risk_level}`);
    } catch (analysisError) {
      console.log(`[Investigation] Analysis failed for ID: ${contentId}: ${analysisError.message}`);
      // Fallback analysis object
      analysis = {
        risk_level: 'low',
        risk_score: 10,
        intent: 'unknown',
        reasons: [`Analysis failed: ${analysisError.message}`]
      };
    }

    // 4. Save Content Record (permanent)
    let contentRecord;
    try {
      // Check if content already exists
      contentRecord = await Content.findOne({ platform, content_id: contentId });

      if (!contentRecord) {
        // Create new content record
        contentRecord = await Content.create({
          platform,
          content_id: contentId,
          content_url: resolvedUrl,
          text: metadata.text || metadata.description || metadata.title,
          author: metadata.author || metadata.channelTitle || 'Unknown',
          author_handle: metadata.author_handle || metadata.channelId || 'unknown',
          published_at: metadata.created_at || metadata.publishedAt || new Date(),
          media: metadata.media || [],
          risk_score: analysis.risk_score || 0,
          risk_level: analysis.risk_level || 'low',
          threat_intent: analysis.intent,
          threat_reasons: analysis.reasons || [],
          engagement: metadata.metrics || metadata.statistics || {}
        });
        console.log(`[Investigation] Created new Content record: ${contentRecord.id}`);
      } else {
        console.log(`[Investigation] Found existing Content record: ${contentRecord.id}`);
      }
    } catch (contentError) {
      console.error(`[Investigation] Failed to save Content record:`, contentError.message);
      // Continue anyway, we can still create the alert
    }

    // 5. Check if author is already in Sources (monitoring status)
    let is_monitored = false;
    let existingSource = null; // Declare outside try-catch so it's accessible later
    try {
      const authorHandle = metadata.author_handle || metadata.channelId || metadata.author;
      const normalizedHandle = normalizeIdentifier(platform, authorHandle);
      const platformKeys = platform === 'x' || platform === 'twitter' ? ['x', 'twitter'] : [platform];
      const handleVariants = new Set([
        authorHandle,
        normalizedHandle,
        normalizedHandle ? `@${normalizedHandle}` : null,
        authorHandle ? `@${authorHandle}` : null
      ].filter(Boolean));
      const identifiersToCheck = Array.from(handleVariants);
      console.log(`[Investigation] Checking monitoring status for platform: ${platformKeys.join(',')}, identifier: ${normalizedHandle}`);

      existingSource = await Source.findOne({
        platform: { $in: platformKeys },
        identifier: { $in: identifiersToCheck }
      });

      if (existingSource) {
        is_monitored = true;
        console.log(`[Investigation] ✓ Author is monitored. Source ID: ${existingSource.id}`);
      } else {
        console.log(`[Investigation] ✗ Author is NOT monitored. No matching source found.`);
      }
    } catch (sourceError) {
      console.warn(`[Investigation] Failed to check monitoring status:`, sourceError.message);
    }

    // 6. Create permanent Alert record
    let alertRecord;
    try {
      alertRecord = await Alert.create({
        content_id: contentRecord?.id || contentId,
        content_ref_id: contentRecord?.id || null,
        source_id: existingSource?.id || null, // Link to source if monitored
        source_category: existingSource?.category || null,
        published_at: contentRecord?.published_at || metadata.published_at || null,
        title: metadata.title || metadata.text?.substring(0, 100) || 'Investigated Post',
        description: metadata.description || metadata.text || '',
        content_url: resolvedUrl,
        platform,
        author: metadata.author || metadata.channelTitle || 'Unknown',
        author_handle: metadata.author_handle || metadata.channelId,
        matched_keywords: await matchConfiguredKeywords(metadata.description || metadata.text || ''),
        matched_keywords_normalized: [], // deprecated, use matched_keywords instead
        risk_level: analysis.risk_level || 'low',
        status: 'active',
        alert_type: 'ai_risk',
        is_investigation: true,
        threat_details: {
          intent: analysis.intent || 'unknown',
          reasons: analysis.reasons || [],
          highlights: analysis.highlights || [],
          risk_score: analysis.risk_score || 0
        },
        legal_sections: analysis.legal_sections || [],
        violated_policies: analysis.violated_policies || [],
        classification_explanation: analysis.explanation || '',
        ml_analysis: analysis.ml_analysis || null,
        llm_analysis: analysis.llm_analysis || null,
        campaign_topic: analysis.topic || null,
        campaign_topic_taxonomy_version: analysis.topic_taxonomy_version || null
      });
      console.log(`[Investigation] Created new Alert record: ${alertRecord.id}${existingSource ? ` linked to Source: ${existingSource.id}` : ''}`);
    } catch (alertError) {
      console.error(`[Investigation] Failed to create Alert record:`, alertError.message);
      // Return error if we can't create the alert
      return res.status(500).json({ message: 'Failed to save investigation results to database' });
    }

    // 7. Return Alert with monitoring status
    const responseAlert = {
      id: alertRecord.id,
      content_id: contentRecord?.id || contentId,
      title: alertRecord.title,
      description: alertRecord.description,
      risk_level: alertRecord.risk_level,
      threat_details: alertRecord.threat_details,
      platform: alertRecord.platform,
      author: alertRecord.author,
      author_handle: alertRecord.author_handle,
      created_at: alertRecord.created_at,
      status: alertRecord.status,
      is_investigation: true,
      is_monitored,
      content_details: {
        content_type: metadata.content_type || (platform === 'instagram' ? 'post' : undefined),
        text: metadata.text || metadata.description || metadata.title,
        author_handle: metadata.author_handle || metadata.channelId,
        media: metadata.media || (metadata.thumbnails ? [{ url: metadata.thumbnails.high?.url || metadata.thumbnails.default?.url }] : []),
        engagement: metadata.metrics || metadata.statistics,
        url: resolvedUrl,
        content_url: contentRecord?.content_url || resolvedUrl,
        is_deleted: contentRecord?.is_deleted || false,
        deleted_at: contentRecord?.deleted_at || null,
        is_expired: contentRecord?.is_expired || false,
        expired_at: contentRecord?.expired_at || null,
        availability_status: contentRecord?.availability_status || 'available',
        analysis: analysis || null
      }
    };

    await clearAlertCache();
    console.log(`[Investigation] Completed successfully for ${platform}:${contentId}. Risk: ${analysis.risk_level}, Monitored: ${is_monitored}`);
    res.status(200).json(responseAlert);
  } catch (error) {
    console.error('[Investigation] Critical failure:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get lightweight alert counts per status (no $lookup, ultra-fast)
// @route   GET /api/alerts/summary
// @access  Private
const getAlertSummary = async (req, res) => {
  try {
    const summaryCacheKey = 'alert_summary:v2';
    const cached = await readCache(summaryCacheKey);
    if (cached) return res.status(200).json(cached);

    // Gated like the list so the status pills never promise more than it shows.
    const keywordFilter = { matched_keywords: { $exists: true, $ne: [] } };
    const gateFragment = await alertGate();

    const [statusCounts, unreadCount] = await Promise.all([
      Alert.aggregate([
        { $match: applyGate(keywordFilter, gateFragment) },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Alert.countDocuments(applyGate({ is_read: false, ...keywordFilter }, gateFragment))
    ]);

    const summary = { active: 0, acknowledged: 0, escalated: 0, resolved: 0, false_positive: 0, unread: unreadCount };
    statusCounts.forEach(item => {
      if (item._id && summary.hasOwnProperty(item._id)) summary[item._id] = item.count;
    });

    await writeCache(summaryCacheKey, summary, 20);
    res.status(200).json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Translate alert content
// @route   POST /api/alerts/translate
// @access  Private
const translateAlertContent = async (req, res) => {
  try {
    const { text, target = 'en' } = req.body;

    if (!text) {
      return res.status(400).json({ message: 'Text to translate is required' });
    }

    const translatedText = await translationService.translate(text, target);

    res.status(200).json({
      translatedText,
      originalText: text
    });
  } catch (error) {
    console.error('[AlertController] Translation Error:', error.message);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get dashboard stats grouped by platform in a single call (ultra-fast, no $lookup)
// @route   GET /api/alerts/dashboard-stats
// @access  Private
const getDashboardStats = async (req, res) => {
  try {
    // Same filter as the Alerts page (buildAlertStats): the caller's scope plus
    // the display gate. This used to count only alerts with matched_keywords,
    // so alerts from monitored profiles (which rarely match a keyword) never
    // reached the dashboard tile — it read 0 while the Alerts page listed them.
    const scopeKey = req.scope && !req.scope.canSeeAll ? (req.scope.constituencies || []).join(',') : 'all';
    const dashCacheKey = `dashboard:v3:alerts:${scopeKey}`;
    const cached = await readCache(dashCacheKey);
    if (cached) return res.status(200).json(cached);

    const platforms = ['twitter', 'x', 'youtube', 'facebook', 'instagram', 'whatsapp'];
    const statuses = ['active', 'acknowledged', 'escalated', 'false_positive'];

    const { query: scopeQuery, empty } = await buildAlertMatch({}, req.scope, { includeStatus: false });
    const gateFilter = empty ? { _id: { $exists: false } } : applyGate({ ...scopeQuery }, await alertGate());
    const [statusByPlatform, pendingReports, velocityByPlatform] = await Promise.all([
      Alert.aggregate([
        { $match: gateFilter },
        { $group: { _id: { platform: '$platform', status: '$status' }, count: { $sum: 1 } } }
      ]).option({ allowDiskUse: true }),

      // Escalated alerts without reports
      Alert.aggregate([
        { $match: { ...gateFilter, status: 'escalated' } },
        {
          $lookup: {
            from: 'reports',
            let: { alertId: '$id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$alert_id', '$$alertId'] } } },
              { $project: { _id: 1 } },
              { $limit: 1 }
            ],
            as: 'report_exists'
          }
        },
        { $match: { report_exists: { $size: 0 } } },
        { $group: { _id: '$platform', count: { $sum: 1 } } }
      ]),

      // Velocity/viral alerts by platform
      Alert.aggregate([
        { $match: { ...gateFilter, alert_type: 'velocity', status: 'active' } },
        { $group: { _id: '$platform', count: { $sum: 1 } } }
      ])
    ]);

    // Normalize x -> twitter
    const normPlatform = (p) => (p === 'x' ? 'twitter' : p);

    // Build result
    const initCounts = () => ({ active: 0, acknowledged: 0, escalated: 0, false_positive: 0 });
    const byPlatform = { all: initCounts() };
    platforms.forEach(p => { byPlatform[normPlatform(p)] = byPlatform[normPlatform(p)] || initCounts(); });

    statusByPlatform.forEach(({ _id, count }) => {
      const plat = normPlatform(_id.platform);
      const status = _id.status;
      if (!statuses.includes(status)) return;
      if (!byPlatform[plat]) byPlatform[plat] = initCounts();
      byPlatform[plat][status] = (byPlatform[plat][status] || 0) + count;
      byPlatform.all[status] = (byPlatform.all[status] || 0) + count;
    });

    // Pending report counts
    const pendingByPlatform = { all: 0 };
    pendingReports.forEach(({ _id, count }) => {
      const plat = normPlatform(_id);
      pendingByPlatform[plat] = (pendingByPlatform[plat] || 0) + count;
      pendingByPlatform.all += count;
    });

    // Viral counts
    const viralByPlatform = { all: 0 };
    velocityByPlatform.forEach(({ _id, count }) => {
      const plat = normPlatform(_id);
      viralByPlatform[plat] = (viralByPlatform[plat] || 0) + count;
      viralByPlatform.all += count;
    });

    const result = { byPlatform, pendingByPlatform, viralByPlatform };
    await writeCache(dashCacheKey, result, 20);
    res.status(200).json(result);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ message: error.message });
  }
};

// Check for similar escalated alerts
const getSimilarEscalatedAlerts = async (req, res) => {
  console.log('--- getSimilarEscalatedAlerts CALLED ---');
  try {
    const { text } = req.body;
    console.log('Checking text length:', text ? text.length : 'N/A');

    if (!text) return res.status(400).json({ message: 'Text is required' });

    // Call ML Service for Model-Based Similarity (TF-IDF/Embeddings on Training Data)
    try {
      const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:8006';
      const mlRes = await axios.post(`${mlServiceUrl}/similar-escalated`, { text });
      // console.log('ML Service Response:', mlRes.data);

      const { is_similar, score, matched_text } = mlRes.data;
      let responseAlerts = [];

      if (is_similar && matched_text) {
        // Find the Alert in DB that corresponds to this matched text (Optional Best Effort)
        const Content = require('../models/Content');
        const matchingContent = await Content.findOne({ text: matched_text }).select('content_id');

        if (matchingContent) {
          const foundAlert = await Alert.findOne({
            content_id: matchingContent.content_id,
            status: 'escalated'
          }).select('id created_at status title');

          if (foundAlert) {
            responseAlerts.push({
              id: foundAlert.id,
              text: matched_text,
              timestamp: foundAlert.created_at,
              title: foundAlert.title || 'Escalated Alert',
              score: score,
              is_db_record: true
            });
          }
        }

        // Always return the ML detection even if DB lookup fails
        if (responseAlerts.length === 0) {
          responseAlerts.push({
            id: 'ml_memory_detection',
            text: matched_text,
            timestamp: new Date(),
            title: 'Historical Model Data',
            score: score,
            is_training_data: true
          });
        }
      }

      return res.status(200).json({
        similarCount: responseAlerts.length,
        alerts: responseAlerts,
        ml_score: score || 0,
        matched_text: matched_text || null
      });

    } catch (mlErr) {
      console.error('ML Service Error:', mlErr.message);
      return res.status(200).json({ similarCount: 0, alerts: [], error: 'ML Service Unavailable' });
    }
  } catch (error) {
    console.error('Error checking similar escalated alerts:', error);
    res.status(500).json({ message: 'Server error check similarity' });
  }
};

// @desc    Manually override risk level and/or sentiment of an alert.
//          Risk score is auto-derived from the chosen level using the same
//          bands as the LLM prompt (low: 20, medium: 50, high: 75).
//          Updates Alert + linked Analysis + Content so all surfaces stay in sync.
// @route   PUT /api/alerts/:id/analysis-override
// @access  Private
const RISK_LEVEL_SCORE_MAP = { low: 20, medium: 50, high: 75, critical: 90 };
// 'neutral' is canonical; 'moderate' is its retired name.
const ALLOWED_SENTIMENTS = ['positive', 'negative', 'moderate', 'neutral'];

/**
 * The pipeline guarantees an INVARIANT (analysisService.js):
 *   sentiment (raw tone) negative → risk high/75
 *   sentiment (raw tone) neutral  → risk low/20
 *   sentiment (raw tone) positive → risk low/15
 * Editing either one updates the other. The STANCE (pro/anti client) comes
 * from the target and is not changed by a sentiment or risk edit.
 *
 * A manual override must preserve it in BOTH directions, otherwise an operator
 * correcting one field leaves the record self-contradictory — which is exactly
 * what the Alerts page then renders (badge from one field, pill filter from
 * another).
 */
// Raw sentiment ⇄ risk, both directions (same as analysisService).
const SENTIMENT_TO_RISK = { negative: 'high', neutral: 'low', moderate: 'low', positive: 'low' };
const SENTIMENT_TO_SCORE = { negative: 75, neutral: 20, moderate: 20, positive: 15 };
/**
 * Risk → sentiment when only the risk is edited. Medium, high and critical are
 * all negative. Low cannot say whether the post is positive or neutral, so the
 * current tone is kept unless it was negative, which becomes neutral.
 */
const riskToSentiment = (level, current) => {
  if (level === 'medium' || level === 'high' || level === 'critical') return 'negative';
  return current === 'positive' || current === 'neutral' ? current : 'neutral';
};

/** Canonical middle label; 'moderate' is the retired name. */
const canonicalSentiment = (s) => (s === 'moderate' ? 'neutral' : s);


const updateAlertAnalysisOverride = async (req, res) => {
  try {
    const Analysis = require('../models/Analysis');
    const { id } = req.params;
    const rawLevel = req.body?.risk_level ? String(req.body.risk_level).trim().toLowerCase() : null;
    const rawSentiment = req.body?.sentiment ? String(req.body.sentiment).trim().toLowerCase() : null;

    if (!rawLevel && !rawSentiment) {
      return res.status(400).json({ message: 'Provide risk_level and/or sentiment to update.' });
    }
    if (rawLevel && !RISK_LEVEL_SCORE_MAP.hasOwnProperty(rawLevel)) {
      return res.status(400).json({ message: `Invalid risk_level. Must be one of: ${Object.keys(RISK_LEVEL_SCORE_MAP).join(', ')}` });
    }
    if (rawSentiment && !ALLOWED_SENTIMENTS.includes(rawSentiment)) {
      return res.status(400).json({ message: `Invalid sentiment. Must be one of: ${ALLOWED_SENTIMENTS.join(', ')}` });
    }

    const alert = await Alert.findOne({ id });
    if (!alert) return res.status(404).json({ message: 'Alert not found' });

    /**
     * CASCADE. Previously `sentiment` and `risk_level` were patched completely
     * independently, and `sentiment` was written ONLY to `llm_analysis.sentiment`
     * — while the Alerts list, stats and topic-count queries all filter on
     * `llm_analysis.target_sentiment`/`bsk_sentiment` and the card paints its
     * badge from `risk_level`. The net effect was that correcting an alert's
     * sentiment changed nothing the operator could see.
     *
     * Now one correction propagates to every field that represents it, in both
     * directions, so no surface can disagree with another.
     */
    const sentiment = rawSentiment ? canonicalSentiment(rawSentiment) : null;
    // A negative edit keeps an existing medium/high/critical grade; otherwise
    // the risk follows the sentiment.
    const keepGrade = sentiment === 'negative' && ['medium', 'high', 'critical'].includes(alert.risk_level);
    const level = rawLevel || (sentiment ? (keepGrade ? alert.risk_level : SENTIMENT_TO_RISK[sentiment]) : null);
    const currentTone = canonicalSentiment(String(alert.llm_analysis?.generic_sentiment || alert.llm_analysis?.sentiment || '').toLowerCase());
    const derivedSentiment = sentiment || (rawLevel ? riskToSentiment(rawLevel, currentTone) : null);
    // An explicit risk edit keeps its own band score; otherwise the score
    // follows the sentiment (same bands as analysisService).
    const score = level ? ((rawLevel || keepGrade) ? RISK_LEVEL_SCORE_MAP[level] : SENTIMENT_TO_SCORE[derivedSentiment]) : null;

    const alertSet = {};
    if (level) {
      alertSet.risk_level = level;
      alertSet['threat_details.risk_score'] = score;
      alertSet['llm_analysis.score'] = score;
    }
    if (derivedSentiment) {
      // Raw sentiment only; the stance (pro/anti client) is left as analysed.
      alertSet['llm_analysis.sentiment'] = derivedSentiment;
      alertSet['llm_analysis.generic_sentiment'] = derivedSentiment;
      // Mark the record as human-corrected so a later re-analysis and any
      // review queue can tell an operator verdict from a model verdict.
      alertSet['llm_analysis.manual_override'] = true;
      alertSet['llm_analysis.needs_review'] = false;
    }

    // llm_analysis is a free-form Mixed field; Mongo rejects a dot-notation
    // $set into it while it currently holds null ("Cannot create field ...
    // in element {llm_analysis: null}"), so give it a home first when needed.
    if ((level || derivedSentiment) && alert.llm_analysis == null) {
      await Alert.updateOne({ id }, { $set: { llm_analysis: {} } });
    }

    const updatedAlert = await Alert.findOneAndUpdate({ id }, { $set: alertSet }, { new: true });

    // Mirror onto the linked Analysis record
    const analysisQuery = alert.analysis_id
      ? { id: alert.analysis_id }
      : { content_id: alert.content_id };
    const analysisDoc = await Analysis.findOne(analysisQuery);
    const analysisSet = {};
    if (level) {
      analysisSet.risk_level = level;
      analysisSet.risk_score = score;
      analysisSet['llm_analysis.score'] = score;
    }
    if (derivedSentiment) {
      analysisSet.sentiment = derivedSentiment;
      analysisSet['llm_analysis.sentiment'] = derivedSentiment;
      analysisSet['llm_analysis.generic_sentiment'] = derivedSentiment;
      analysisSet['llm_analysis.manual_override'] = true;
    }

    let updatedAnalysis = null;
    if (Object.keys(analysisSet).length > 0) {
      if (analysisDoc?.llm_analysis == null) {
        await Analysis.updateOne(analysisQuery, { $set: { llm_analysis: {} } });
      }
      updatedAnalysis = await Analysis.findOneAndUpdate(analysisQuery, { $set: analysisSet }, { new: true });
    }

    // Mirror onto Content so list views (which read content.risk_level / content.sentiment) reflect the change
    if (alert.content_id) {
      const contentSet = {};
      if (level) {
        contentSet.risk_level = level;
        contentSet.risk_score = score;
      }
      if (derivedSentiment) contentSet.sentiment = derivedSentiment;
      if (Object.keys(contentSet).length > 0) {
        await Content.updateOne({ id: alert.content_id }, { $set: contentSet });
      }
    }

    await clearAlertCache();
    await createAuditLog(req.user, 'update_analysis', 'alert', id, {
      // Record what the operator asked for AND what the cascade derived, so the
      // audit trail explains why fields they did not touch also changed.
      requested_risk_level: rawLevel || undefined,
      requested_sentiment: rawSentiment || undefined,
      applied_risk_level: level || undefined,
      applied_sentiment: derivedSentiment || undefined,
    });

    res.status(200).json({
      message: 'Alert analysis updated',
      alert: updatedAlert,
      analysis: updatedAnalysis
    });
  } catch (error) {
    console.error('[updateAlertAnalysisOverride]', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get topic classification counts for filter pills
// @route   GET /api/alerts/topic-counts
// @access  Private
/**
 * Source categories that actually exist, with the number of alerts behind each.
 *
 * The dropdown was a hardcoded list of seven — Political, Communal, Trouble
 * Makers, Defamation, Narcotics, History Sheeters, Others. Any of those that no
 * Source is actually tagged with returns zero rows and reads as a broken
 * filter. Deriving the list from the data means the dropdown can only ever
 * offer categories that select something, and new ones appear without a
 * frontend change.
 *
 * @route GET /api/alerts/source-categories
 */
const getSourceCategories = async (req, res) => {
  try {
    const cacheKey = getCacheKey('alerts:source-categories:v1', { _scope: alertScopeKey(req.scope) });
    const cached = await readCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    const Source = require('../models/Source');
    const rows = await Source.aggregate([
      { $match: { category: { $nin: [null, ''] } } },
      { $group: { _id: '$category', sources: { $sum: 1 } } },
      { $sort: { sources: -1 } },
    ]);

    const gateFragment = await alertGate();

    // The alert count per category is what tells an operator whether picking it
    // is worth anything, so it is resolved the same way the filter itself does.
    const categories = await Promise.all(rows.map(async (r) => {
      const { query, empty } = await buildAlertMatch({ status: 'all', category: r._id }, req.scope);
      return {
        value: r._id,
        label: String(r._id)
          .replace(/[_-]+/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        sources: r.sources,
        count: empty ? 0 : await Alert.countDocuments(applyGate({ ...query }, gateFragment)),
      };
    }));

    const payload = categories.filter((c) => c.count > 0);
    await writeCache(cacheKey, payload, 60);
    res.status(200).json(payload);
  } catch (error) {
    console.error('[getSourceCategories]', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Tracked keywords that actually select alerts, with their counts.
 *
 * The dropdown listed every tracked keyword straight from /api/keywords. Most
 * of them match nothing, so they were dead options that returned an empty feed
 * and read as a broken filter.
 *
 * Counting has to mirror what the filter DOES, which is a union of two paths
 * (see buildAlertMatch): an exact hit on the alert's own
 * `matched_keywords_normalized`, OR a prefix hit on the joined
 * `Content.risk_factors.keyword`. Most matches come through the second path, so
 * counting only the alert's own array would report nearly everything as zero.
 *
 * One pipeline pulls both key sets per alert and the union is resolved in JS,
 * so an alert matching a keyword through both paths is still counted once.
 *
 * @route GET /api/alerts/keyword-counts
 */
const getKeywordCounts = async (req, res) => {
  try {
    const cacheKey = getCacheKey('alerts:keyword-counts:v1', {
      ...(req.query || {}),
      _scope: alertScopeKey(req.scope),
    });
    const cached = await readCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    // Every other active filter applies, minus `keyword` itself — otherwise
    // each option would be counted inside the selection it is meant to change.
    const { query, empty } = await buildAlertMatch(
      { ...req.query, keyword: undefined }, req.scope
    );
    if (empty) return res.status(200).json([]);

    const tracked = await Keyword.find({}).select('keyword').lean();
    const uniqueTracked = [...new Set(
      tracked.map((k) => String(k.keyword || '').trim()).filter(Boolean)
    )];
    if (uniqueTracked.length === 0) return res.status(200).json([]);

    const rows = await Alert.aggregate([
      { $match: applyGate({ ...query }, await alertGate()) },
      ...alertSearchStages(req.query.search),
      {
        $lookup: {
          from: 'contents',
          localField: 'content_id',
          foreignField: 'id',
          pipeline: [{ $project: { _id: 0, kws: '$risk_factors.keyword' } }],
          as: 'c',
        },
      },
      {
        $project: {
          _id: 0,
          norm: { $ifNull: ['$matched_keywords_normalized', []] },
          cont: { $ifNull: [{ $arrayElemAt: ['$c.kws', 0] }, []] },
        },
      },
    ]).option({ allowDiskUse: true });

    const docs = rows.map((r) => ({
      norm: new Set((r.norm || []).map((s) => String(s).toLowerCase())),
      cont: (r.cont || []).map((s) => String(s).toLowerCase()),
    }));

    const counts = uniqueTracked.map((keyword) => {
      const kw = keyword.toLowerCase();
      let count = 0;
      for (const d of docs) {
        // Exact on the alert's array, prefix on the content's — the two
        // conditions the filter ORs together.
        if (d.norm.has(kw) || d.cont.some((s) => s.startsWith(kw))) count += 1;
      }
      return { keyword, count };
    });

    const payload = counts
      .filter((k) => k.count > 0)
      .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword));

    await writeCache(cacheKey, payload, 60);
    res.status(200).json(payload);
  } catch (error) {
    console.error('[getKeywordCounts]', error);
    res.status(500).json({ message: error.message });
  }
};

const getTopicClassificationCounts = async (req, res) => {
  try {
    const topicCacheKey = getCacheKey('alerts:topic-counts:v2', {
      ...(req.query || {}),
      // Chip counts are scope-dependent, so the cache key must be too.
      _scope: alertScopeKey(req.scope),
    });
    const cached = await readCache(topicCacheKey);
    if (cached) return res.status(200).json(cached);

    // The SAME filter set the list matches on, minus the topic filter itself
    // (this endpoint groups by topic, so constraining to one would return only
    // that one). This is what makes each chip's number the number of rows
    // clicking it returns.
    const { query: builtQuery, empty } = await buildAlertMatch(
      req.query, req.scope, { includeTopic: false }
    );
    if (empty) return res.status(200).json({ topics: [], total: 0, classified: 0, unclassified: 0, unclassified_key: UNCLASSIFIED_TOPIC });

    const matchQuery = applyGate({ ...builtQuery }, await alertGate());

    // Total under the current filters, WITHOUT requiring a topic. This is what
    // the "All Topics" chip shows: clicking it clears the topic filter and
    // returns every one of these rows, so summing the per-topic counts (which
    // exclude unclassified alerts) reported a number the feed contradicted.
    const countWithSearch = async (match) => {
      const rows = await Alert.aggregate([
        { $match: match },
        ...alertSearchStages(req.query.search),
        { $count: 'n' },
      ]).option({ allowDiskUse: true });
      return rows[0]?.n || 0;
    };
    const totalPromise = countWithSearch(matchQuery);

    // Alerts the classifier gave no usable topic. Counted so the bucket is a
    // selectable chip instead of a large slice of the feed being unreachable.
    const unclassifiedPromise = countWithSearch({
      ...matchQuery,
      $and: [...(matchQuery.$and || []), unclassifiedTopicClause()],
    });

    const topicMatch = {
      ...matchQuery,
      ...classifiedTopicClause(),
    };

    const pipeline = [
      { $match: topicMatch },
      ...alertSearchStages(req.query.search),
      {
        $group: {
          _id: '$llm_analysis.grievance_type',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ];

    const results = await Alert.aggregate(pipeline).option({ allowDiskUse: true });

    // Normalize topic names (matching ReasonModal display logic). Driven by
    // TOPIC_ALIASES so this can't drift out of sync with
    // buildTopicClassificationQuery, which is what the click-through filter
    // on these counts actually uses.
    const aliasToCanonical = Object.entries(TOPIC_ALIASES).reduce((acc, [canonical, aliases]) => {
      for (const alias of aliases) acc[alias.toLowerCase()] = canonical;
      return acc;
    }, {});
    const normalizeTopicName = (name) => {
      const normalized = String(name || '').trim().toLowerCase();
      return aliasToCanonical[normalized] || String(name || '').trim();
    };

    // Merge counts for normalized duplicates
    const mergedMap = {};
    results
      .filter(r => r._id && String(r._id).trim())
      .forEach(r => {
        const normalized = normalizeTopicName(r._id);
        mergedMap[normalized] = (mergedMap[normalized] || 0) + r.count;
      });

    const topics = Object.entries(mergedMap)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count);

    const [total, unclassified] = await Promise.all([totalPromise, unclassifiedPromise]);
    const classified = topics.reduce((sum, t) => sum + t.count, 0);

    // `total` drives the All Topics chip; `classified` is how many of those
    // carry a topic at all, so the gap between them is visible rather than
    // being mistaken for a miscount.
    const payload = { topics, total, classified, unclassified, unclassified_key: UNCLASSIFIED_TOPIC };
    await writeCache(topicCacheKey, payload, 30);
    res.status(200).json(payload);
  } catch (error) {
    console.error('[getTopicClassificationCounts]', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAlerts,
  getAlertById,
  updateAlert,
  updateAlertAnalysisOverride,
  deleteAlert,
  getAlertStats,
  getAlertSummary,
  getDashboardStats,
  getUnreadCount,
  markAllAsRead,
  investigateLink,
  translateAlertContent,
  getSimilarEscalatedAlerts,
  getTopicClassificationCounts,
  getSourceCategories,
  getKeywordCounts,
  // Filter construction is where composition breaks — a clause that overwrites
  // another produces no error, just wrong counts. Exposed so the list, the
  // chips and the stats can be asserted to match on exactly the same set.
  __testables: {
    buildAlertMatch, addAlertOr, alertScopeKey, buildAlertStats, alertSearchStages,
    applyBskSentimentFilter, parseDateBoundary,
    unclassifiedTopicClause, classifiedTopicClause, isUnclassifiedTopic, UNCLASSIFIED_TOPIC
  }
};
