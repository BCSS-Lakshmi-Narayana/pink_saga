const TempContent = require('../models/TempContent');
const Source = require('../models/Source');
const Content = require('../models/Content');
const Grievance = require('../models/Grievance');
const GrievanceSource = require('../models/GrievanceSource');
const Settings = require('../models/Settings');
const Keyword = require('../models/Keyword');
const { performFullAnalysis } = require('./monitorService');
const { generateComplaintCode } = require('./complaintCodeService');
const { analyzeGrievanceContent, extractAndSaveLocation, textMatchesAnyKeyword, getActiveKeywordsCached } = require('./grievanceService');
const { syncLegacyFieldsFromWorkflow } = require('./grievanceWorkflowService');

const BATCH_SIZE = Number(process.env.ENGINE_TEMP_BATCH_SIZE || 40);
const POLL_MS = Number(process.env.ENGINE_TEMP_POLL_MS || 30000);
const PROCESS_CONCURRENCY = Math.max(1, Number(process.env.ENGINE_TEMP_CONCURRENCY || 4));
const FAST_DRAIN = String(process.env.ENGINE_TEMP_FAST_DRAIN || 'true').toLowerCase() === 'true';
const PROCESSING_TIMEOUT_MS = Math.max(60000, Number(process.env.ENGINE_TEMP_PROCESSING_TIMEOUT_MS || 15 * 60 * 1000));

let running = false;
let timer = null;

const toDate = (v) => {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

const asString = (v, fallback = '') => {
  const s = String(v == null ? '' : v).trim();
  return s || fallback;
};

const normalizeHandle = (v) => asString(v).replace(/^@/, '').toLowerCase();

async function resolveSource(item) {
  if (item.source_id) {
    const byId = await Source.findOne({ id: item.source_id }).lean();
    if (byId) return byId;
  }

  const identifier = normalizeHandle(item.source_identifier);
  if (!identifier) return null;

  return await Source.findOne({
    platform: item.platform,
    identifier: { $in: [identifier, `@${identifier}`] }
  }).lean();
}

function normalizeIncoming(item, source) {
  const raw = item.raw_data || {};
  const platform = item.platform;

  const normalizeInstagramRaw = (value) => {
    if (!value || typeof value !== 'object') return {};
    if (value.node && typeof value.node === 'object') return value.node;
    if (Array.isArray(value.items) && value.items.length > 0 && value.items[0] && typeof value.items[0] === 'object') {
      return value.items[0];
    }
    if (value.data && typeof value.data === 'object') return normalizeInstagramRaw(value.data);
    return value;
  };

  if (platform === 'x') {
    return {
      content_id: asString(raw.id || raw.tweet_id),
      content_url: asString(raw.url || (raw.id ? `https://x.com/i/status/${raw.id}` : '')),
      text: asString(raw.text || raw.full_text),
      media: Array.isArray(raw.media) ? raw.media : [],
      quoted_content: raw.quoted_content || null,
      url_cards: Array.isArray(raw.url_cards) ? raw.url_cards : [],
      author: asString(raw.author_name || source?.display_name || item.source_display_name, source?.display_name || 'Unknown'),
      author_handle: asString(raw.author_handle || source?.identifier || item.source_identifier, source?.identifier || 'unknown'),
      published_at: toDate(raw.created_at),
      engagement: {
        likes: Number(raw?.metrics?.like || raw?.metrics?.likes || 0),
        comments: Number(raw?.metrics?.reply || raw?.metrics?.replies || 0),
        retweets: Number(raw?.metrics?.retweet || raw?.metrics?.retweets || 0),
        views: Number(raw?.metrics?.view || raw?.metrics?.views || 0)
      }
    };
  }

  if (platform === 'instagram') {
    const ig = normalizeInstagramRaw(raw);
    const igCaption = typeof ig.caption === 'string' ? ig.caption : ig.caption?.text;
    const igTakenAt = ig.taken_at || ig.created_at || ig.timestamp;
    return {
      content_id: asString(ig.id || ig.pk || ig.code || ig.shortcode || raw.id || raw.pk || raw.code || raw.shortcode),
      content_url: asString(ig.url || ig.post_url || ig.permalink || raw.url || raw.post_url || raw.permalink || (ig.code ? `https://www.instagram.com/p/${ig.code}/` : '')),
      text: asString(igCaption || ig.text || raw.caption || raw.text),
      media: Array.isArray(ig.media) ? ig.media : (Array.isArray(raw.media) ? raw.media : []),
      author: asString(ig.author_name || ig.username || raw.author_name || raw.username || source?.display_name || item.source_display_name, source?.display_name || 'Unknown'),
      author_handle: asString(ig.author_handle || ig.username || raw.author_handle || raw.username || source?.identifier || item.source_identifier, source?.identifier || 'unknown'),
      published_at: toDate(typeof igTakenAt === 'number' ? igTakenAt * 1000 : igTakenAt),
      engagement: {
        likes: Number(ig.likes || ig.like_count || raw.likes || raw.like_count || 0),
        comments: Number(ig.comments || ig.comment_count || raw.comments || raw.comment_count || 0),
        views: Number(ig.views || ig.play_count || raw.views || raw.play_count || 0)
      }
    };
  }

  if (platform === 'facebook') {
    return {
      content_id: asString(raw.id || raw.post_id),
      content_url: asString(raw.url || raw.post_url || raw.permalink || ''),
      text: asString(raw.text || raw.message),
      media: Array.isArray(raw.media) ? raw.media : [],
      author: asString(raw.author_name || raw.page_name || source?.display_name || item.source_display_name, source?.display_name || 'Unknown'),
      author_handle: asString(raw.author_handle || source?.identifier || item.source_identifier, source?.identifier || 'unknown'),
      published_at: toDate(raw.created_at || raw.timestamp || raw.time),
      engagement: {
        likes: Number(raw.likes || 0),
        comments: Number(raw.comments || 0),
        views: Number(raw.views || 0)
      }
    };
  }

  return {
    content_id: asString(raw.id || raw.videoId),
    content_url: asString(raw.url || (raw.id ? `https://www.youtube.com/watch?v=${raw.id}` : '')),
    text: asString(`${raw.title || ''} ${raw.description || ''}`),
    media: [{ type: 'video', url: asString(raw.url || (raw.id ? `https://www.youtube.com/watch?v=${raw.id}` : '')) }],
    author: asString(raw.channelTitle || source?.display_name || item.source_display_name, source?.display_name || 'Unknown'),
    author_handle: asString(raw.channelId || source?.identifier || item.source_identifier, source?.identifier || 'unknown'),
    published_at: toDate(raw.publishedAt || raw.created_at),
    engagement: {
      likes: Number(raw?.statistics?.likeCount || 0),
      comments: Number(raw?.statistics?.commentCount || 0),
      views: Number(raw?.statistics?.viewCount || 0)
    }
  };
}

async function upsertContent(item, source) {
  const normalized = normalizeIncoming(item, source);
  if (!normalized.content_id) {
    throw new Error('Missing content_id in raw temp item');
  }

  const baseFields = {
    source_id: source?.id || item.source_id || null,
    platform: item.platform,
    content_id: normalized.content_id,
    content_url: normalized.content_url || `https://${item.platform}.com`,
    text: normalized.text || '',
    media: normalized.media || [],
    quoted_content: normalized.quoted_content || null,
    url_cards: normalized.url_cards || [],
    author: normalized.author || 'Unknown',
    author_handle: normalizeHandle(normalized.author_handle) || 'unknown',
    published_at: normalized.published_at || new Date(),
    engagement: normalized.engagement || {},
    raw_data: item.raw_data,
    event_ids: item.event_id ? [item.event_id] : []
  };

  const existing = await Content.findOne({ platform: item.platform, content_id: normalized.content_id });
  if (!existing) {
    const created = await Content.create(baseFields);
    return { content: created, shouldAnalyze: true };
  }

  const eventIds = new Set([...(existing.event_ids || []), ...(baseFields.event_ids || [])]);

  const nextMedia = baseFields.media && baseFields.media.length > 0 ? baseFields.media : existing.media;
  const nextQuoted = baseFields.quoted_content || existing.quoted_content;
  const nextCards = baseFields.url_cards && baseFields.url_cards.length > 0 ? baseFields.url_cards : existing.url_cards;
  const nextEngagement = { ...(existing.engagement || {}), ...(baseFields.engagement || {}) };
  const nextRawData = baseFields.raw_data || existing.raw_data;
  const nextEventIds = Array.from(eventIds);

  const hasMeaningfulChange = (
    (baseFields.text || '') !== (existing.text || '') ||
    (baseFields.content_url || '') !== (existing.content_url || '') ||
    JSON.stringify(nextMedia || []) !== JSON.stringify(existing.media || []) ||
    JSON.stringify(nextQuoted || null) !== JSON.stringify(existing.quoted_content || null) ||
    JSON.stringify(nextCards || []) !== JSON.stringify(existing.url_cards || []) ||
    JSON.stringify(nextRawData || null) !== JSON.stringify(existing.raw_data || null) ||
    JSON.stringify(nextEventIds || []) !== JSON.stringify(existing.event_ids || [])
  );

  if (hasMeaningfulChange) {
    existing.text = baseFields.text || existing.text;
    existing.content_url = baseFields.content_url || existing.content_url;
    existing.media = nextMedia;
    existing.quoted_content = nextQuoted;
    existing.url_cards = nextCards;
    existing.engagement = nextEngagement;
    existing.raw_data = nextRawData;
    existing.event_ids = nextEventIds;
    await existing.save();
  }

  return {
    content: existing,
    shouldAnalyze: existing.risk_level == null
  };
}

function normalizeGrievanceRaw(item) {
  const raw = item.raw_data || {};
  const platform = item.platform;
  const engineMeta = raw?._engine_meta || {};
  const grievanceMode = asString(engineMeta.grievance_mode || 'handle');

  const idCandidate = asString(
    raw.id || raw.tweet_id || raw.post_id || raw.videoId || raw.pk || raw.code
  );
  const canonicalId = platform === 'x'
    ? idCandidate
    : `${platform}:${grievanceMode}:${idCandidate}`;

  let text = '';
  let url = '';
  let authorHandle = '';
  let authorName = '';
  let createdAt = new Date();
  let media = [];

  const normalizeGrievanceMedia = (value) => {
    if (!Array.isArray(value)) return [];

    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          const url = asString(entry);
          if (!url) return null;
          const isVideo = /\.(mp4|mov|mkv|webm)(\?|$)/i.test(url) || /\/reel\//i.test(url);
          return {
            type: isVideo ? 'video' : 'photo',
            url,
            video_url: isVideo ? url : null,
            preview_url: null
          };
        }

        if (entry && typeof entry === 'object') {
          const url = asString(entry.url || entry.video_url || entry.preview_url);
          if (!url) return null;
          const typeCandidate = asString(entry.type || '').toLowerCase();
          const inferredType = /\.(mp4|mov|mkv|webm)(\?|$)/i.test(url) || /\/reel\//i.test(url) ? 'video' : 'photo';
          const type = ['photo', 'video', 'animated_gif'].includes(typeCandidate) ? typeCandidate : inferredType;
          return {
            type,
            url,
            video_url: asString(entry.video_url || (type === 'video' ? url : '')) || null,
            preview_url: asString(entry.preview_url || entry.thumb_url || '') || null
          };
        }

        return null;
      })
      .filter(Boolean);
  };

  if (platform === 'x') {
    text = asString(raw.text || raw.full_text);
    url = asString(raw.url || (idCandidate ? `https://x.com/i/status/${idCandidate}` : ''));
    authorHandle = asString(raw.author_handle || raw.screen_name || raw.username || raw.user_name, 'unknown');
    authorName = asString(raw.author_name || raw.name || authorHandle, 'Unknown');
    createdAt = toDate(raw.created_at);
    media = normalizeGrievanceMedia(raw.media);
  } else if (platform === 'facebook') {
    text = asString(raw.text || raw.message || raw.caption);
    url = asString(raw.url || raw.post_url || raw.permalink || (idCandidate ? `https://facebook.com/${idCandidate}` : ''));
    authorHandle = asString(raw.author_handle || raw.author_id || raw.page_id || raw.page_name || 'unknown');
    authorName = asString(raw.author_name || raw.page_name || authorHandle, 'Unknown');
    createdAt = toDate(raw.created_at || raw.timestamp || raw.time);
    media = normalizeGrievanceMedia(raw.media);
  } else if (platform === 'instagram') {
    text = asString(raw.caption || raw.text);
    url = asString(raw.url || raw.post_url || raw.permalink || (idCandidate ? `https://instagram.com/p/${idCandidate}` : ''));
    authorHandle = asString(raw.username || raw.author_handle || 'unknown');
    authorName = asString(raw.author_name || raw.full_name || authorHandle, 'Unknown');
    createdAt = toDate(raw.created_at || raw.timestamp || raw.taken_at);
    media = normalizeGrievanceMedia(raw.media);
  } else {
    text = asString(`${raw.title || ''} ${raw.description || ''}`);
    url = asString(raw.url || (idCandidate ? `https://www.youtube.com/watch?v=${idCandidate}` : ''));
    authorHandle = asString(raw.channelId || raw.author_handle || 'unknown');
    authorName = asString(raw.channelTitle || raw.author_name || authorHandle, 'Unknown');
    createdAt = toDate(raw.publishedAt || raw.created_at);
    media = [{ type: 'video', url }];
  }

  return {
    canonicalId,
    text: text || '(no text)',
    url: url || `https://${platform}.com`,
    authorHandle: authorHandle || 'unknown',
    authorName: authorName || 'Unknown',
    createdAt,
    media,
    taggedAccount: asString(item.source_identifier || engineMeta.grievance_keyword || item.source_display_name || 'keyword_grievance'),
    grievanceMode
  };
}

async function resolveGrievanceSource(item, normalized) {
  if (normalized.grievanceMode !== 'handle') return null;
  const handle = normalizeHandle(item.source_identifier || normalized.taggedAccount);
  if (!handle) return null;

  return await GrievanceSource.findOne({
    platform: item.platform,
    handle: { $in: [handle, `@${handle}`] }
  }).lean();
}

async function updateGrievanceSourceStats(source) {
  if (!source?.id) return;
  await GrievanceSource.findOneAndUpdate(
    { id: source.id },
    {
      $inc: { total_grievances: 1 },
      $set: { last_fetched: new Date() }
    }
  );
}

async function upsertGrievanceFromTemp(item) {
  const n = normalizeGrievanceRaw(item);
  if (!n.canonicalId) {
    throw new Error('Missing grievance content identifier in raw temp item');
  }

  const existing = await Grievance.findOne({ tweet_id: n.canonicalId });
  if (existing) return existing;

  const keywords = await getActiveKeywordsCached();
  if (!textMatchesAnyKeyword(n.text, keywords)) {
    console.log(`[TempProcessor] Skipping grievance ${n.canonicalId}: no keyword match in "${String(n.text).substring(0, 80)}..."`);
    return null;
  }

  const grievanceSource = await resolveGrievanceSource(item, n);

  const grievance = new Grievance({
    complaint_code: await generateComplaintCode(),
    tweet_id: n.canonicalId,
    tagged_account: n.taggedAccount,
    grievance_source_id: grievanceSource?.id || null,
    platform: item.platform,
    posted_by: {
      handle: n.authorHandle,
      display_name: n.authorName,
      profile_image_url: '',
      is_verified: false,
      follower_count: 0
    },
    content: {
      text: n.text,
      full_text: n.text,
      media: n.media
    },
    tweet_url: n.url,
    engagement: {
      likes: Number(item.raw_data?.likes || item.raw_data?.metrics?.likes || 0),
      retweets: Number(item.raw_data?.retweets || item.raw_data?.metrics?.retweets || 0),
      replies: Number(item.raw_data?.replies || item.raw_data?.metrics?.reply || 0),
      views: Number(item.raw_data?.views || item.raw_data?.metrics?.views || 0),
      quotes: Number(item.raw_data?.quotes || 0)
    },
    post_date: n.createdAt,
    detected_date: new Date(),
    workflow_status: 'received',
    workflow_timestamps: {
      received_at: new Date()
    },
    escalation_count: 0
  });

  syncLegacyFieldsFromWorkflow(grievance, 'received');
  await grievance.save();
  await analyzeGrievanceContent(grievance.id, n.text, item.platform);
  await extractAndSaveLocation(grievance.id, n.text, {
    handle: n.authorHandle,
    display_name: n.authorName,
    location: '',
    bio: ''
  });
  await updateGrievanceSourceStats(grievanceSource);
  return grievance;
}

async function processOneItem(item, settings, keywords) {
  if (item.module === 'grievance') {
    await upsertGrievanceFromTemp(item);
    return;
  }

  const source = await resolveSource(item);
  const { content, shouldAnalyze } = await upsertContent(item, source);

  if (shouldAnalyze) {
    await performFullAnalysis(content, settings, keywords, { skipAlert: false, requireLLM: true });
  }
}

async function markSourceCheckedFromTemp(item) {
  // Grievance/telegram items do not map to the Sources table last_checked semantics.
  if (item.module === 'grievance' || item.module === 'telegram') return;

  const now = new Date();

  if (item.source_id) {
    const byId = await Source.updateOne(
      { id: item.source_id },
      { $set: { last_checked: now } }
    );
    if (byId?.matchedCount) return;
  }

  const identifier = normalizeHandle(item.source_identifier);
  if (!identifier || !item.platform) return;

  await Source.updateOne(
    {
      platform: item.platform,
      identifier: { $in: [identifier, `@${identifier}`] }
    },
    { $set: { last_checked: now } }
  );
}

async function processClaimedItem(item, settings, keywords) {
  try {
    await processOneItem(item, settings, keywords);

    await TempContent.updateOne(
      { _id: item._id },
      { $set: { status: 'done', processed_at: new Date(), error_message: null } }
    );

    await markSourceCheckedFromTemp(item);
  } catch (err) {
    const attempts = (item.attempts || 0) + 1;
    if (String(err?.message || '').includes('Missing content_id in raw temp item')) {
      console.warn(`[TempProcessor] Non-retryable malformed item ${item.platform}:${item._id} — missing content_id even after normalization. Marking done.`);
      await TempContent.updateOne(
        { _id: item._id },
        { $set: { status: 'done', processed_at: new Date(), error_message: err.message || 'malformed temp item: missing content_id' } }
      );
      return;
    }
    console.warn(`[TempProcessor] Attempt ${attempts} failed for ${item.platform}:${(item.raw_data?.id || item._id)}: ${err.message}. Will retry next cycle.`);
    await TempContent.updateOne(
      { _id: item._id },
      { $set: { status: 'failed', error_message: err.message || 'unknown error' } }
    );
  }
}

async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  const workers = [];

  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    workers.push((async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        await worker(items[current]);
      }
    })());
  }

  await Promise.all(workers);
}

async function runCycle() {
  if (running) return;
  running = true;

  try {
    await TempContent.updateMany(
      { status: 'pending', module: 'telegram' },
      { $set: { status: 'done', processed_at: new Date(), error_message: null } }
    );

    const settings = await Settings.findOne({ id: 'global_settings' });
    if (!settings) return 0;
    const keywords = await Keyword.find({ is_active: true });

    await TempContent.updateMany(
      { status: 'failed' },
      { $set: { status: 'pending' } }
    );

    // Recover items stuck in processing state (e.g., process restart/crash mid-item).
    const processingCutoff = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
    await TempContent.updateMany(
      {
        status: 'processing',
        $or: [
          { processing_started_at: { $lt: processingCutoff } },
          { processing_started_at: { $exists: false }, created_at: { $lt: processingCutoff } }
        ]
      },
      {
        $set: {
          status: 'pending',
          error_message: 'recovered stale processing item after timeout'
        }
      }
    );

    // Prioritize non-grievance traffic (profile/event) so grievance floods do not starve alerting paths.
    const prioritizedItems = await TempContent.find({
      status: 'pending',
      module: { $nin: ['telegram', 'grievance'] }
    })
      .sort({ created_at: 1 })
      .limit(BATCH_SIZE);

    let items = prioritizedItems;
    if (items.length < BATCH_SIZE) {
      const grievanceItems = await TempContent.find({ status: 'pending', module: 'grievance' })
        .sort({ created_at: 1 })
        .limit(BATCH_SIZE - items.length);
      items = [...items, ...grievanceItems];
    }

    if (items.length === 0) return 0;

    console.log(`[TempProcessor] Processing ${items.length} pending temp item(s) [concurrency=${PROCESS_CONCURRENCY}]`);

    let claimedCount = 0;

    await runWithConcurrency(items, PROCESS_CONCURRENCY, async (item) => {
      const claimed = await TempContent.updateOne(
        { _id: item._id, status: 'pending' },
        { $set: { status: 'processing', processing_started_at: new Date() }, $inc: { attempts: 1 } }
      );

      if (!claimed?.matchedCount) {
        return;
      }

      claimedCount += 1;
      await processClaimedItem(item, settings, keywords);
    });

    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await TempContent.deleteMany({ status: 'done', processed_at: { $lt: cutoff } });
    return claimedCount;
  } finally {
    running = false;
  }
}

function startTempContentProcessor() {
  if (timer) return;
  console.log(`[TempProcessor] Started (poll every ${Math.floor(POLL_MS / 1000)}s)`);

  const tick = async () => {
    try {
      let claimed = await runCycle();
      while (FAST_DRAIN && claimed >= BATCH_SIZE) {
        claimed = await runCycle();
      }
    } catch (err) {
      console.error(`[TempProcessor] cycle error: ${err.message}`);
    }
  };

  tick();
  timer = setInterval(tick, POLL_MS);
}

module.exports = {
  startTempContentProcessor,
  runCycle
};
