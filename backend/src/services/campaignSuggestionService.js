const Grievance = require('../models/Grievance');
const Alert = require('../models/Alert');
const Event = require('../models/Event');
const NewsArticle = require('../models/NewsArticle');
const CampaignSuggestion = require('../models/CampaignSuggestion');

const axios = require('axios');
const { normalizePlatforms, sanitizeHashtags } = require('../utils/viralCreative');
const topicSvc = require('./campaignTopicService');
const { CLIENT_CONTEXT } = require('../config/politicalPromptContext');
const { normalizeStance } = require('./stanceVocabulary');
const retrieval = require('./rag/hybridRetrievalService');

// Posts retrieved per significant topic. Small on purpose: the model needs enough to
// ground one campaign in specifics, and every extra snippet is prompt it must read.
const RETRIEVE_PER_TOPIC = Number(process.env.RAG_PER_TOPIC || 8);
// How many topics get a campaign. Each is one LLM call, so this is also the ceiling on
// how long a Generate takes.
const MAX_TOPICS = Number(process.env.RAG_MAX_TOPICS || 5);
// How long archived ("superseded") suggestions are kept before being pruned. Dismissed
// and converted ones are never pruned — those record a human decision.
const SUGGESTION_RETENTION_DAYS = Number(process.env.SUGGESTION_RETENTION_DAYS || 90);

// Selectable content sources for suggestion generation. "mentions" is the
// social-media mentions feed (stored as grievances — the /grievances page is
// literally named "Mentions" in the nav/RBAC), "alerts" and "events" map to the
// Alert / Event models. Anything not listed is ignored.
/**
 * Operator-selectable stance.
 *
 * `stances` narrows the posts RETRIEVED as evidence. `intent` is forced alongside it,
 * and only because the choice is explicit: deriving the direction from a pool the
 * operator has already filtered to criticism would make anti >= pro true by
 * construction, so every filtered run would come back "counter" no matter what the
 * conversation actually looked like. The counts stored on the card stay unfiltered.
 */
/**
 * How many campaigns one topic is allowed to produce.
 *
 * A topic with 84 posts has more than one story in it; a topic with 4 does not, and
 * asking for three campaigns out of four posts produces three paraphrases of the same
 * sentence. So volume sets the ceiling, and the default stays deliberately low —
 * every extra campaign is two more LLM calls and one more card to review.
 */
const campaignAllowance = (posts) => {
  const n = Number(posts) || 0;
  if (n < 10) return 1;
  if (n <= 20) return 3;
  if (n <= 30) return 5;
  if (n <= 40) return 7;
  return 10;
};

/** Two once a topic is big enough to hold two distinct stories, otherwise one. */
const defaultCampaigns = (posts) => ((Number(posts) || 0) >= 10 ? 2 : 1);

/**
 * A different lens per campaign on the same topic.
 *
 * Without this, two campaigns off one topic came back as the same argument with the
 * words moved around — same headline claim, same closing ask. Pairing a distinct angle
 * with a distinct slice of the retrieved posts is what makes the second card worth
 * reading rather than a near-duplicate of the first.
 */
const CAMPAIGN_ANGLES = [
  'Lead with the single most concrete thing in these posts — the number, the scheme or the place.',
  'Write it from the point of view of an ordinary person living there, not the party.',
  'Lead with what changed between then and now, using only what the posts state.',
  'Lead with the specific claim being made about us and answer it directly.',
  'Lead with the named people in these posts and what they actually did.',
  'Lead with the place itself — make it unmistakably local to the constituency named.',
  'Lead with what happens next and what the reader should watch for.',
  'Lead with the least-reported detail in these posts rather than the obvious headline.',
  'Lead with a plain question the reader can answer from their own experience.',
  'Lead with the scale of it — how many people this reaches.',
];

// A backstop on a whole run, so "10 campaigns" across 5 topics cannot silently become
// 50 topics' worth of LLM calls. Each campaign is two calls.
// The NewsArticle.category enum, in words a person would use on a card.
const NEWS_CATEGORY_LABELS = {
  crime: 'Crime', politics: 'Politics', development: 'Development',
  agriculture: 'Agriculture', health: 'Health', education: 'Education',
  law_order: 'Law & Order', accident: 'Accidents', sports: 'Sport',
  culture: 'Culture', general: 'General',
};

const MAX_SUGGESTIONS_PER_RUN = Number(process.env.CAMPAIGN_MAX_PER_RUN || 20);

const STANCE_MODES = {
  all: { stances: null, intent: null, label: 'all posts' },
  criticize: { stances: ['anti_target', 'anti_target_indirect'], intent: 'counter', label: 'criticism only' },
  support: { stances: ['pro_target', 'pro_target_indirect'], intent: 'amplify', label: 'support only' },
};

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt;
};

/**
 * Keep only real taxonomy values, in the taxonomy's own spelling.
 *
 * A topic arriving over HTTP is untrusted input, and it is compared against topic names
 * Stage A produces — so "corruption" from a query string has to come back as
 * "Corruption" or the filter silently matches nothing.
 */
const canonicalTopic = (() => {
  const key = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const map = new Map(topicSvc.CAMPAIGN_TOPICS.map((t) => [key(t), t]));
  return (t) => map.get(key(t)) || null;
})();

const normalizeTopicFilter = (v) => (Array.isArray(v) ? v : [v])
  .map(canonicalTopic)
  .filter((t) => t && t !== 'None')
  .filter((t, i, a) => a.indexOf(t) === i)
  .slice(0, 16);

/**
 * Context window, sized to the prompt.
 *
 * qwen2.5:7b supports 32,768 tokens, but nothing here ever set `num_ctx`, so Ollama
 * applied its own 4,096 default and the model's real capacity went unused. That matters
 * because Ollama does not error when a prompt exceeds num_ctx — it silently drops the
 * oldest tokens. With 100 posts per topic the evidence sits at the START of the user
 * message, so most of what the operator selected would have been trimmed away with no
 * sign of it anywhere: the card would still say "built from 100 posts".
 *
 * Computed per call rather than pinned high, because num_ctx sizes the KV cache and a
 * 32k window on every short call would waste VRAM on the shared server.
 */
/**
 * The ceiling is 8192, NOT the model's 32,768.
 *
 * qwen2.5 advertises a 32k window, but requesting num_ctx=32768 from the shared Ollama
 * server made even a three-word prompt time out — allocating that KV cache is more than
 * the box will do while it is also serving the monitoring pipeline. 8192 is roughly
 * double the silent default and comfortably fits the largest prompt this service builds.
 * Raise it with OLLAMA_MAX_CTX only against a server with the VRAM to spare.
 */
const MAX_CTX = Number(process.env.OLLAMA_MAX_CTX || 8192);
const estimateCtx = (...parts) => {
  const chars = parts.reduce((n, part) => n + String(part || '').length, 0);
  // ~3 chars per token on this corpus — English is nearer 4, but the posts are 63%
  // Telugu and Indic script tokenises far worse, so the pessimistic figure is the safe
  // one. Plus room for the answer itself.
  const tokens = Math.ceil(chars / 3) + 1200;
  return Math.min(MAX_CTX, Math.max(4096, Math.ceil(tokens / 1024) * 1024));
};

// 'news' is the RSS feed (NewsArticle). It joins as a first-class source, but grouped
// on its own `category` enum rather than the campaign taxonomy — see the news adapter in
// campaignTopicService for why.
const ALL_SOURCES = ['mentions', 'alerts', 'events', 'news'];
const normalizeSources = (sources) => {
  const picked = Array.isArray(sources) ? sources.map((s) => String(s).toLowerCase()) : [];
  const valid = picked.filter((s) => ALL_SOURCES.includes(s));
  return valid.length ? [...new Set(valid)] : [...ALL_SOURCES]; // default = all
};

// ── LLM helper ───────────────────────────────────────────────────────────────
// Priority: Ollama (PRIMARY_LLM_PROVIDER=ollama) → OpenAI → Gemini.
// If none is configured throws a 503-safe error — never crashes startup.
// Campaign suggestions are an on-demand user action, so they default to the
// 'live' lane and jump ahead of routine monitoring / bulk backfills.
/**
 * `json` (default) constrains decoding to a JSON object. Pass false for prose.
 *
 * That flag is not cosmetic. Ollama's JSON grammar makes this 7B model very unreliable
 * at emitting newlines INSIDE a string value: asked for a multi-line post as a JSON
 * field it returned one 255-character paragraph most of the time, whatever the prompt
 * said, and no amount of rewriting fixed it. The post is therefore written by a second,
 * plain-text call where a line break is just a line break.
 */
async function callLLM(systemPrompt, userPrompt, sched = {}, { json = true } = {}) {
  const provider = process.env.PRIMARY_LLM_PROVIDER || 'ollama';

  if (provider === 'ollama') {
    // Same server and model every other LLM path here talks to — ollamaLLMService reads
    // exactly these two vars. There is no shared Ollama queue in this deployment (the
    // multi-tenant saga had one to stop tenants starving each other), so this calls the
    // server directly; generation is an on-demand action by a single team.
    const baseURL = (process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    const model = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
    const timeout = parseInt(process.env.OLLAMA_CAMPAIGN_TIMEOUT_MS || '300000', 10);
    {
      const res = await axios.post(`${baseURL}/api/chat`, {
        model,
        stream: false,
        // Constrain decoding to JSON. Asking for it in the prompt is not enough: the
        // 7B model reliably answered a long prompt with a prose summary instead, and
        // the parse then returned nothing at all.
        ...(json ? { format: 'json' } : {}),
        options: { temperature: 0.4, num_ctx: estimateCtx(systemPrompt, userPrompt) },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }, { timeout });
      return res.data?.message?.content || '';
    }
  }

  if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      temperature: 0.4,
      max_tokens: 1600,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    return res.choices?.[0]?.message?.content || '';
  }

  if (process.env.GEMINI_API_KEY) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-flash-latest' });
    const result = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
    return result.response.text();
  }

  const err = new Error('AI not configured — set PRIMARY_LLM_PROVIDER=ollama or OPENAI_API_KEY or GEMINI_API_KEY');
  err.code = 'AI_NOT_CONFIGURED';
  throw err;
}


const tally = (arr) => {
  const m = new Map();
  arr.filter(Boolean).forEach((k) => m.set(k, (m.get(k) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const clampScore = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

/**
 * Undo HTML escaping in model output.
 *
 * The model returned the title "Elections &amp; Politics", which was stored verbatim and
 * rendered literally as "Elections &amp; Politics" on the influencer's screen — React
 * escapes on output, so an entity that arrives already-encoded is shown as its own
 * source text. Decoding here fixes it once, at the boundary, rather than in each of the
 * several places this text is displayed.
 */
const decodeEntities = (v) => String(v == null ? '' : v)
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#0?39;|&apos;/gi, "'")
  .replace(/&nbsp;/gi, ' ');

/** Title-case a topic into a usable fallback campaign name. */
const titleFromTopic = (unit) => {
  const topic = String(unit?.topic || '').trim();
  if (!topic) return 'Awareness campaign';
  return unit?.intent === 'counter' ? `Setting the record straight on ${topic}` : `Our record on ${topic}`;
};

/**
 * A title must be a campaign name, not the bucket it came from.
 *
 * The model kept echoing the issue label it was handed ("Elections & Politics"), which
 * reads as a database category on a poster and tells an influencer nothing about what
 * they are being asked to post.
 */
const pickTitle = (raw, unit) => {
  const title = decodeEntities(raw).trim().replace(/\s+/g, ' ');
  const topic = String(unit?.topic || '').trim().toLowerCase();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!title || (topic && norm(title) === norm(topic))) return titleFromTopic(unit);
  return title.slice(0, 200);
};

/**
 * Hashtags must never be empty — the influencer's post needs them and an empty array
 * renders as nothing at all. When the model omits them, build tags from the campaign's
 * own topic rather than shipping a post with none.
 */
const pickHashtags = (raw, unit) => {
  const tags = sanitizeHashtags(raw).slice(0, 8);
  if (tags.length) return tags;
  const fromTopic = String(unit?.topic || '').replace(/&/g, ' and ').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/)
    .filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return fromTopic ? [fromTopic] : [];
};

/**
 * A post, not a strapline.
 *
 * `suggested_message` was specified as "1-3 sentences", and that is exactly what came
 * back: "With @KTRBRS's leadership, we are taking concrete steps to end corruption."
 * Two lines is a caption for a photo someone else took — it is not something an
 * influencer can publish as the campaign. A post that has to carry an argument needs an
 * opening, the substance, and a close, so the floor is enforced rather than requested.
 */
const MIN_CAPTION_CHARS = Number(process.env.CAMPAIGN_MIN_CAPTION_CHARS || 450);
const MIN_CAPTION_LINES = Number(process.env.CAMPAIGN_MIN_CAPTION_LINES || 7);
// Rewrites allowed per topic when the caption misses the bar. Each one is another LLM
// round-trip, so this is also the multiplier on how long Generate takes.
const MAX_REWRITES = Number(process.env.CAMPAIGN_MAX_REWRITES || 2);

/** Lines with words in them — the blank spacers between blocks are not content. */
const contentLines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * Drop the hashtags the model tacked onto its own copy.
 *
 * It emitted two or three inline while `suggested_hashtags` held five, so the caption
 * that actually got published was missing tags the operator could plainly see listed on
 * the card above it. The full set is put back by composeCaption, from one source.
 */
const stripTrailingHashtags = (text) => String(text || '')
  .replace(/(\s*#[\p{L}\p{N}_]+)+\s*$/u, '')
  .trim();

/**
 * The caption IS the deliverable — whatever it says is what gets posted — so the
 * complete tag set belongs inside it, on its own line, identical to suggested_hashtags.
 */
const composeCaption = (message, hashtags) => {
  const body = stripTrailingHashtags(decodeEntities(message));
  const tags = (hashtags || []).map((h) => `#${String(h).replace(/^#/, '')}`).join(' ');
  return [body, tags].filter(Boolean).join('\n\n').slice(0, 2000);
};

const evidenceLabel = (r) => {
  const bits = [r.stance || r.kind];
  if (r.sentiment) bits.push(`sentiment=${r.sentiment}`);
  if (r.emotion) bits.push(`emotion=${r.emotion}`);
  const c = Number(r.confidence?.overall || r.confidence?.stance || 0);
  if (Number.isFinite(c) && c > 0) bits.push(`conf=${c.toFixed(2)}`);
  return bits.filter(Boolean).join('; ');
};

// ── scoring, from counts rather than from the model ──────────────────────────
// A unit is { topic, intent, posts, anti, pro, refs } as built from Stage A.

/** Size of this issue relative to the largest in the window, floored at 20. */
const scoreImpact = (unit, maxPosts) => {
  if (!unit?.posts || !maxPosts) return 40;
  return clampScore(Math.max(20, Math.round((unit.posts / maxPosts) * 100)));
};

/**
 * How lopsided the conversation is, in the direction that matters.
 *
 * For a counter-campaign, urgency rises with the share of criticism; for an amplify, with
 * the share of support. An evenly split topic is genuinely less time-sensitive than a
 * one-sided pile-on, which is what this encodes.
 */
const scoreUrgency = (unit) => {
  const anti = Number(unit?.anti) || 0;
  const pro = Number(unit?.pro) || 0;
  const total = anti + pro;
  if (!total) return 50;
  const share = unit?.intent === 'counter' ? anti / total : pro / total;
  return clampScore(Math.round(share * 100));
};

/** Combined band, so the badge agrees with the two numbers beside it. */
const derivePriority = (unit, maxPosts) => {
  const s = (scoreImpact(unit, maxPosts) + scoreUrgency(unit)) / 2;
  if (s >= 80) return 'critical';
  if (s >= 60) return 'high';
  if (s >= 35) return 'medium';
  return 'low';
};

/**
 * Generate ranked campaign suggestions from this deployment's recent content.
 * Sources are selectable — any of "mentions" (grievances), "alerts", "events";
 * default is all four (mentions, alerts, events, news).
 */
async function generateSuggestions({
  days = 7, sources, topics: topicFilter, perTopic, maxTopics, stance, campaignsPerTopic,
  generatedBy = '', generatedByRole = '',
} = {}) {

  /**
   * Operator overrides. Every one of them is optional and falls back to the value the
   * engine has always used, so a Generate with an empty filter panel behaves exactly as
   * it did before this existed.
   */
  const perTopicN = clampInt(perTopic, 3, 100, RETRIEVE_PER_TOPIC);
  const wanted = normalizeTopicFilter(topicFilter);
  // undefined = size it from each topic's own volume; a number = the operator's choice,
  // still capped per topic by what that topic can actually support.
  const campaignsReq = campaignsPerTopic === undefined || campaignsPerTopic === null || campaignsPerTopic === ''
    ? null
    : clampInt(campaignsPerTopic, 1, 10, null);
  const stanceKey = String(stance || 'all').toLowerCase();
  const stanceMode = STANCE_MODES[stanceKey] ? stanceKey : 'all';
  // With an explicit topic list, Stage A has to look past its usual top-N or a chosen
  // topic that ranks 7th by volume would never appear in the results at all.
  const topN = wanted.length
    ? Math.min(topicSvc.CAMPAIGN_TOPICS.length, Math.max(wanted.length, MAX_TOPICS))
    : clampInt(maxTopics, 1, 10, MAX_TOPICS);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const picked = normalizeSources(sources);
  const useMentions = picked.includes('mentions');
  const useAlerts = picked.includes('alerts');
  const useEvents = picked.includes('events');
  const useNews = picked.includes('news');

  // Only query the collections the operator selected — an unselected source
  // contributes nothing to the analysis.
  const [grievances, alerts, events, news] = await Promise.all([
    useMentions
      ? Grievance.find({ post_date: { $gte: cutoff }, is_active: { $ne: false }, 'analysis.needs_review': { $ne: true } })
          // id/url/posted_by are selected so a suggestion can name the exact posts it
          // was built from, not just how many were in the pool.
          .select('id tweet_url url posted_by.handle content.text analysis.sentiment analysis.category analysis.grievance_type analysis.topic analysis.risk_level analysis.political_stance analysis.emotion analysis.confidence platform priority post_date created_at')
          .sort({ created_at: -1 }).limit(300).lean()
      : [],
    useAlerts
      ? Alert.find({ published_at: { $gte: cutoff } })
          .select('id title description campaign_topic priority alert_type platform author author_handle content_url published_at created_at')
          .sort({ published_at: -1 }).limit(600).lean()
      : [],
    useEvents
      ? Event.find({ created_at: { $gte: cutoff } })
          .select('id name description location keywords platforms status created_at')
          .sort({ created_at: -1 }).limit(150).lean()
      : [],
    // RSS articles are longer than a post, so fewer of them fill the same budget.
    // published_date rather than scraped_at: the operator picked a window of NEWS, not
    // a window of when the crawler happened to run.
    useNews
      ? NewsArticle.find({ published_date: { $gte: cutoff } })
          .select('_id title title_english summary summary_english source_url source_name category relevance_score sentiment sentiment_target sentiment_target_alignment political_stance pipeline_analyzed_at published_date')
          .sort({ published_date: -1 }).limit(200).lean()
      : [],
  ]);

  // The pool this run reasoned over. Logged because "why did it suggest that?" is
  // unanswerable after the fact without knowing how much it actually looked at.
  console.log(`[campaignSuggestions] window=${days}d pool: ${grievances.length} mentions, ${alerts.length} alerts, ${events.length} events, ${news.length} news`);

  if (!grievances.length && !alerts.length && !events.length) {
    // Nothing to analyse. Archive rather than delete: an empty window (a narrower date
    // range, a quiet week) is not a reason to destroy the last good batch.
    await CampaignSuggestion.updateMany(
      { status: 'new' },
      { $set: { status: 'superseded' } },
    );
    return [];
  }

  const eventKeywords = events.flatMap((e) => (Array.isArray(e.keywords) ? e.keywords.map((k) => k?.keyword) : []));

  // Compact, privacy-light signal for the LLM.
  const topics = tally([
    ...grievances.map((g) => g.analysis?.category || g.analysis?.grievance_type).filter(Boolean),
    ...alerts.map((a) => a.threat_details?.intent || a.alert_type).filter(Boolean),
    ...eventKeywords.filter(Boolean),
  ]).slice(0, 12);
  const platforms = tally([
    ...grievances.map((g) => g.platform).filter(Boolean),
    ...alerts.map((a) => a.platform).filter(Boolean),
    ...events.flatMap((e) => (Array.isArray(e.platforms) ? e.platforms : [])).filter(Boolean),
  ]).slice(0, 6).map(([p]) => p);
  /**
   * The evidence the model reasons over.
   *
   * This used to be "the 40 newest posts". That is recency, not relevance: in a busy
   * window the 40 newest are whatever happened this morning, so a real issue running all
   * month could be invisible while a single noisy thread filled the prompt. It also does
   * not scale — the pool is capped at 300 mentions, so past that the model literally
   * never sees most of the corpus.
   *
   * Now it is two stages:
   *   A. group the window by topic and stance in the database (no LLM, no text) to find
   *      which issues are actually significant;
   *   B. hybrid-retrieve the most relevant posts INSIDE each of those topics.
   *
   * So the model receives a few posts per real issue rather than a recency sample of
   * everything, and the number of posts in the window stops mattering.
   *
   * Retrieval covers mentions only — alerts and events are small, already summarised,
   * and are appended whole.
   */
  const units = [];
  const retrievalMeta = { used: false, topics: [], mode: null, reason: '', grouping: null };

  // An article is a headline plus a summary; the model gets both, because the headline
  // alone is often the only part that names the place or the number.
  /**
   * The same derivation campaignTopicService applies in its aggregation.
   *
   * A scored article carries `political_stance`; an unscored one only has the Python
   * engine's client-relative `sentiment` plus who it is about. Negative coverage of our
   * opponent is good news for us, which is why sentiment alone never decides it.
   */
  const asAlertRef = (a, topic) => ({
    kind: 'alert',
    ref_id: a.id || '',
    text: [a.title, a.description].filter(Boolean).join(' — '),
    platform: a.platform || '',
    url: a.content_url || '',
    author: a.author_handle || a.author || '',
    sentiment: '',
    // The alert's own stance (every analysed alert carries llm_analysis.political_stance).
    // This used to pin every alert to 'anti_target' on the belief that alerts have none, so a
    // post attacking the Congress government (favourable to BRS) was fed to the campaign as
    // criticism of BRS and triggered a "counter" suggestion. Unscored / unrelated => neutral.
    stance: (() => {
      const st = normalizeStance(a.llm_analysis?.political_stance || a.llm_analysis?.stance);
      return ['pro_target', 'pro_target_indirect', 'anti_target', 'anti_target_indirect'].includes(st) ? st : 'neutral';
    })(),
    topic,
    at: a.published_at || a.created_at,
  });

  const CAMPAIGNABLE_NEWS_STANCES = ['pro_target', 'pro_target_indirect', 'anti_target', 'anti_target_indirect'];
  const newsStance = (a) => {
    // Scored by the Node pipeline: the stored stance is authoritative, and
    // `sentiment` is the raw tone (negative coverage of Congress is pro client).
    if (a.pipeline_analyzed_at) {
      return CAMPAIGNABLE_NEWS_STANCES.includes(a.political_stance) ? a.political_stance : 'neutral';
    }
    // Not scored yet: the Python engine's ingest sentiment is client-relative.
    const sent = a.sentiment;
    const side = a.sentiment_target_alignment;
    if (side === 'ally') return sent === 'positive' ? 'pro_target' : sent === 'negative' ? 'anti_target' : 'neutral';
    // sentiment is client-relative: positive about an opposition-focused article
    // means it damages the opposition.
    if (side === 'opposition') return sent === 'positive' ? 'pro_target_indirect' : sent === 'negative' ? 'anti_target_indirect' : 'neutral';
    return 'neutral';
  };

  const asNewsRef = (a, topic) => ({
    kind: 'news',
    ref_id: String(a._id || ''),
    text: [a.title_english || a.title, a.summary_english || a.summary].filter(Boolean).join(' — '),
    platform: a.source_name || 'news',
    url: a.source_url || '',
    author: a.source_name || '',
    sentiment: a.sentiment || '',
    stance: newsStance(a),
    topic,
    at: a.published_date,
  });

  const asRef = (d, topic) => ({
    kind: 'mention', ref_id: d.id || '', text: d.content?.text,
    // `url` is NOT a top-level field on Grievance (the only `url` in that schema
    // is inside the media sub-document), so it always resolved to undefined and
    // every mention citation rendered without its "open" link. `tweet_url` is
    // the real per-post permalink on this deployment.
    platform: d.platform || '', url: d.tweet_url || d.url || '',
    author: d.posted_by?.handle || '', sentiment: d.analysis?.sentiment || '',
    stance: d.analysis?.political_stance || '', emotion: d.analysis?.emotion || '',
    confidence: d.analysis?.confidence || null, topic, at: d.post_date || d.created_at,
  });

  if (useMentions) {
    try {
      const stage = await topicSvc.getSignificantTopics({
        days,
        // Low floor: this runs on whatever window the operator picked, which may be 24
        // hours. The batch-level guard is that a topic with too few posts is dropped.
        minPosts: Math.max(2, Math.floor(grievances.length / 50)),
        topN,
        source: 'grievance',
      });

      // Stage A reports which vocabulary it grouped on; the hard topic filter below is
      // only valid for the campaign taxonomy.
      const usingTopicTaxonomy = stage.grouping?.field === 'analysis.topic';
      retrievalMeta.grouping = stage.grouping || null;

      // An explicit selection wins over the volume ranking; without one, Stage A's own
      // top-N is used exactly as before.
      const chosen = wanted.length
        ? wanted.map((w) => stage.topics.find((t) => t.topic === w)).filter(Boolean)
        : stage.topics;
      if (wanted.length && chosen.length < wanted.length) {
        const missing = wanted.filter((w) => !chosen.some((t) => t.topic === w));
        retrievalMeta.reason = `no posts in the window for: ${missing.join(', ')}`;
        console.log(`[campaignSuggestions] requested topics with no data: ${missing.join(', ')}`);
      }

      for (const t of chosen) {
        // The topic name plus its own vocabulary is the query. Using the grievance types
        // seen inside the group keeps the query in the corpus's own words rather than
        // the taxonomy's, which matters when the label is as blunt as "Public Complaint".
        const query = [t.topic, ...(t.grievance_types || []).slice(0, 3)].filter(Boolean).join(' ');
        // How many campaigns this topic gets, and therefore how many posts to pull:
        // each campaign is grounded in its own perTopicN, so they cite different posts
        // rather than three cards all quoting the same top-ranked one.
        const nCampaigns = Math.min(campaignsReq ?? defaultCampaigns(t.posts), campaignAllowance(t.posts));
        const wantK = Math.min(perTopicN * nCampaigns, 100);
        const res = await retrieval.retrieve(Grievance, {
          query, k: wantK, since: stage.window.since, until: stage.window.until,
          // Scope retrieval to the group Stage A actually counted — but ONLY when the
          // grouping used analysis.topic. If it fell back to grievance_type (corpus not
          // yet backfilled), filtering on analysis.topic would match nothing and every
          // topic would come back with zero evidence.
          topics: usingTopicTaxonomy ? [t.topic] : undefined,
          // The same stance filter Stage A counted with. Without it the evidence set can
          // include posts Stage A deliberately excluded — an 'unrelated' post retrieved
          // as the justification for a campaign the counts never supported.
          // Narrowed further when the operator asked for one side only. Stage A's own
          // counts are untouched by this — see STANCE_MODES.
          stances: STANCE_MODES[stanceMode].stances || topicSvc.CAMPAIGNABLE_STANCES,
        });
        retrievalMeta.mode = retrievalMeta.mode || res.mode;
        retrievalMeta.topics.push({ topic: t.topic, intent: t.intent, posts: t.posts, retrieved: res.docs.length, campaigns: nCampaigns });
        const refs = res.docs.map((d) => asRef(d, t.topic)).filter((r) => r.text);
        if (!refs.length) continue;

        /**
         * Deal the retrieved posts round-robin, not in contiguous blocks.
         *
         * Retrieval returns them ranked, so slicing 1-10 / 11-20 would hand the first
         * campaign every strong post and the last one the dregs. Dealing them out gives
         * each campaign an even spread of relevance, and no two campaigns share a post.
         */
        for (let v = 0; v < nCampaigns; v += 1) {
          const slice = refs.filter((_, idx) => idx % nCampaigns === v);
          if (!slice.length) break;
          units.push({
            topic: t.topic,
            intent: STANCE_MODES[stanceMode].intent || t.intent,
            posts: t.posts, anti: t.anti, pro: t.pro,
            refs: slice,
            // Same issue, different story. Both are carried into the prompt.
            variant: v,
            variants: nCampaigns,
            angle: nCampaigns > 1 ? CAMPAIGN_ANGLES[v % CAMPAIGN_ANGLES.length] : '',
          });
        }
      }
      if (units.length > MAX_SUGGESTIONS_PER_RUN) {
        console.log(`[campaignSuggestions] ${units.length} campaigns requested, capping the run at ${MAX_SUGGESTIONS_PER_RUN}`);
        units.length = MAX_SUGGESTIONS_PER_RUN;
      }
      retrievalMeta.used = units.length > 0;
    } catch (err) {
      // Retrieval is an optimisation over the recency path, not a prerequisite. If the
      // embedder or the aggregation fails, generation still runs on recent posts.
      retrievalMeta.reason = err.message;
      console.warn(`[campaignSuggestions] retrieval unavailable, using recency: ${err.message}`);
    }
  }

  /**
   * RSS news — its own Stage A, on its own vocabulary.
   *
   * It cannot share the mentions path: NewsArticle has no `analysis.topic` and no
   * `embedding`, so neither the 16-value taxonomy nor the vector retrieval applies to
   * it. What it does have is an ingest-time `category` and a stance, which is enough to
   * group, rank and route exactly as mentions do — the only thing it gives up is
   * relevance-ranked retrieval, so its articles are taken by relevance_score then
   * recency inside each category.
   *
   * The topic filter is deliberately NOT applied here: those are campaign-taxonomy
   * values ("Water Supply") and news categories are a different vocabulary
   * ("development"), so matching one against the other would silently return nothing.
   */
  if (useNews && news.length) {
    try {
      const newsStage = await topicSvc.getSignificantTopics({
        days, minPosts: 1, topN, source: 'news',
        stances: STANCE_MODES[stanceMode].stances || undefined,
      });
      const wantStances = STANCE_MODES[stanceMode].stances;
      for (const t of newsStage.topics) {
        const inCategory = news
          .filter((a) => (a.category || 'general') === t.topic)
          .filter((a) => !wantStances || wantStances.includes(newsStance(a)))
          // relevance_score is set by the RSS matcher; recency breaks its ties.
          .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0)
            || new Date(b.published_date) - new Date(a.published_date));
        if (!inCategory.length) continue;

        const nCampaigns = Math.min(campaignsReq ?? defaultCampaigns(t.posts), campaignAllowance(t.posts));
        const picked2 = inCategory.slice(0, Math.min(perTopicN * nCampaigns, 100));
        const label = `News: ${NEWS_CATEGORY_LABELS[t.topic] || t.topic}`;
        for (let v = 0; v < nCampaigns; v += 1) {
          const slice = picked2.filter((_, idx) => idx % nCampaigns === v).map((a) => asNewsRef(a, label));
          if (!slice.length) break;
          units.push({
            topic: label,
            intent: STANCE_MODES[stanceMode].intent || t.intent,
            posts: t.posts, anti: t.anti, pro: t.pro,
            refs: slice,
            variant: v, variants: nCampaigns,
            angle: nCampaigns > 1 ? CAMPAIGN_ANGLES[v % CAMPAIGN_ANGLES.length] : '',
          });
        }
      }
      retrievalMeta.topics.push(...newsStage.topics.map((t) => ({
        topic: `News: ${NEWS_CATEGORY_LABELS[t.topic] || t.topic}`, intent: t.intent, posts: t.posts, retrieved: 0,
      })));
    } catch (err) {
      // News is additive. If its aggregation fails the mentions campaigns still ship.
      console.warn(`[campaignSuggestions] news grouping failed: ${err.message}`);
    }
  }

  if (!units.length) {
    // Fallback: one unit over the most recent posts, so a corpus with no classified
    // topics (or a failed retrieval) still gets suggestions rather than an empty page.
    retrievalMeta.reason = retrievalMeta.reason || 'no significant topics — using recent posts';
    const refs = grievances.map((g) => asRef(g, '')).filter((r) => r.text).slice(0, perTopicN * 2);
    if (refs.length) units.push({ topic: 'Recent activity', intent: 'counter', posts: grievances.length, anti: 0, pro: 0, refs });
  }

  /**
   * Alerts — grouped by their own classified topic, the same way mentions are.
   *
   * They used to be lumped with events into a single "Alerts & events" card, which meant
   * a water complaint and a hate-speech detection produced one incoherent campaign. Now
   * each topic gets its own, and the intent is always 'counter': an alert exists because
   * something was flagged as a risk, so there is nothing to amplify.
   *
   * Alerts carry no embedding, so there is no retrieval here — the most recent alerts in
   * each topic are taken, highest priority first.
   */
  if (useAlerts && alerts.length) {
    try {
      const alertStage = await topicSvc.getSignificantTopics({
        days, minPosts: 1, topN, source: 'alert',
        stances: ['anti_target'],   // the only value the alert adapter produces
      });
      const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
      for (const t of alertStage.topics) {
        const inTopic = alerts
          .filter((a) => (a.campaign_topic || null) === t.topic)
          .sort((x, y) => (RANK[x.priority] ?? 9) - (RANK[y.priority] ?? 9)
            || new Date(y.published_at || y.created_at) - new Date(x.published_at || x.created_at));
        if (!inTopic.length) continue;

        const nCampaigns = Math.min(campaignsReq ?? defaultCampaigns(t.posts), campaignAllowance(t.posts));
        const picked3 = inTopic.slice(0, Math.min(perTopicN * nCampaigns, 100));
        const label = `Alerts: ${t.topic}`;
        for (let v = 0; v < nCampaigns; v += 1) {
          const slice = picked3.filter((_, idx) => idx % nCampaigns === v).map((a) => asAlertRef(a, label));
          if (!slice.length) break;
          units.push({
            topic: label,
            intent: 'counter',
            posts: t.posts, anti: t.anti, pro: 0,
            refs: slice,
            variant: v, variants: nCampaigns,
            angle: nCampaigns > 1 ? CAMPAIGN_ANGLES[v % CAMPAIGN_ANGLES.length] : '',
          });
        }
      }
      retrievalMeta.topics.push(...alertStage.topics.map((t) => ({
        topic: `Alerts: ${t.topic}`, intent: 'counter', posts: t.posts, retrieved: 0,
      })));
    } catch (err) {
      // Additive: a failure here must not cost the mentions campaigns.
      console.warn(`[campaignSuggestions] alert grouping failed: ${err.message}`);
    }
  }

  /**
   * Events are NOT content.
   *
   * The Event model is a saved monitor — name, keywords, platforms, polling interval,
   * thresholds. There is no post text to campaign about, so they stay a single
   * descriptive unit rather than being classified. What you would actually campaign on
   * is the posts collected under an event, and those are already in `mentions`.
   */
  const eventRefs = events.map((e) => ({
    kind: 'event', ref_id: e.id || '', text: [e.name, e.description].filter(Boolean).join(' — '),
    platform: '', url: '', author: '', sentiment: '', stance: '', topic: 'Monitored events', at: e.created_at,
  })).filter((r) => r.text).slice(0, perTopicN * 2);
  if (eventRefs.length) {
    units.push({ topic: 'Monitored events', intent: 'counter', posts: eventRefs.length, anti: 0, pro: 0, refs: eventRefs });
  }

  // Number each unit's refs LOCALLY (1..n within the unit). The model only ever sees one
  // topic's posts at a time, so a small local numbering is what it can actually cite
  // accurately — a global 1..48 list is what it previously mis-cited or ignored.
  units.forEach((u) => {
    u.refs = u.refs
      .slice(0, perTopicN * 2)
      .map((r, i) => ({ ...r, ref: i + 1, text: String(r.text).replace(/\s+/g, ' ').trim().slice(0, 200) }));
  });

  const samples = units.flatMap((u) => u.refs.map((r) => r.text));

  /**
   * ONE CALL PER TOPIC, not one call for everything.
   *
   * The all-at-once prompt did not survive contact with the 7B model this platform
   * runs: given ~40 mixed samples and a nested schema it answered with a prose
   * summary, then with a sentiment tally, then with an array of strings — all of
   * which parse to zero suggestions, which is why the page silently kept showing the
   * previous batch. Splitting by topic makes each prompt ~1.5KB with one issue and
   * ~8 posts in it, and the model produces the right object reliably.
   *
   * It is also better retrieval hygiene: a suggestion can only cite posts from its own
   * topic, so `source_refs` are correct by construction rather than by trust.
   */
  const SYSTEM_ONE =
`You are a political campaign strategist. Output ONE JSON object, nothing else.
${CLIENT_CONTEXT} The party campaigns as the OPPOSITION: it does not govern and cannot claim government delivery; "counter" answers criticism of the party with its record and evidence, "amplify" boosts what favours the party, including the government's own failures against its promises.

SHAPE:
{"title":"","summary":"","brief":"","sentiment":"positive|negative|neutral|mixed","intent":"amplify|counter","suggested_message":"","suggested_message_short":"","suggested_news":[""],"suggested_hashtags":[""],"source_refs":[1,2],"target_platforms":["X","Facebook"],"recommended_niche":"","rationale":""}

RULES:
- title: a CAMPAIGN NAME, 3-8 words, that a person would recognise on a poster. It must NOT be the bare issue name you were given, and must NOT describe sentiment. Good: "Promised Fifteen Thousand, Paid Twelve", "Ten Years of Water for Every Village". Bad: "Elections & Politics", "Corruption", "Counter Negative Sentiment".
- summary: one or two sentences on what the posts actually say. INTERNAL — the client reads this, not the creator.
- brief: 4-6 sentences addressed to the CONTENT CREATOR who will post this. Cover, in plain language: what the campaign is about, the angle to take, the tone to use, and one thing to avoid. Write it as instructions to a person. Do NOT mention post counts, sentiment splits, "amplify", "counter", or any internal analysis — the creator is external and must not be shown our monitoring data.
- suggested_message: a 2-3 sentence draft of what to publish, naming a concrete detail from the posts (a place, scheme, number, person, claim). This is only a seed - the finished post is written separately - so keep it short and factual. NEVER generic lines like "committed to transparency", "serving with integrity", "promoting positive change".
- suggested_message_short: the same post compressed to under 240 characters for X, still naming one concrete detail. No hashtags.
- suggested_hashtags: 3-5 tags, REQUIRED, never empty, no leading '#'. Make them specific to this campaign, not generic party tags alone.
- intent "counter" answers criticism; "amplify" boosts praise.
- suggested_news: 2-4 SHORT FACTUAL talking points drawn from the posts — things a spokesperson could say out loud. NEVER URLs, links, or "https://..." of any kind; you cannot know a real link and a made-up one is a lie.
- source_refs: the ref numbers you actually used. At least one. Required.
- target_platforms from exactly: Instagram, X, YouTube, Facebook.
- Use only the given posts. Invent nothing — no names, numbers, dates or links that are not in the posts.
- Write plain text. Never write HTML entities such as &amp; — use a real "&".`;

  /**
   * Phrases that make a post publishable-looking but meaningless — copy that would fit
   * any party, in any state, on any day. Listing them in the prompt reduces them but does
   * not eliminate them on a 7B model, so the output is checked and regenerated once.
   *
   * Matched on the CAPTION only: a summary may legitimately describe a party as claiming
   * commitment to transparency; the post itself saying it is the failure mode.
   */
  const BOILERPLATE = [
    /committed to (transparency|accountability|serving|providing|improving)/i,
    /with integrity(\s+and\s+\w+)?/i,
    /dedicated to serving/i,
    /promoting positive change/i,
    /(join|let'?s) (us|together) (in )?(promoting|building|working)/i,
    /for the betterment of/i,
    /we (strive|aim) to/i,
  ];
  /**
   * Why this caption is not publishable, or null if it is.
   *
   * Returns the reason rather than a boolean because the reason is quoted back to the
   * model on the retry, and "too short" needs a different correction from "generic".
   * Length is measured on the body with any hashtags removed, so a two-line post padded
   * with five tags does not pass as a long one.
   */
  const captionProblem = (text) => {
    const body = stripTrailingHashtags(text);
    if (body.length < 20) return 'it is empty or a single fragment';
    if (BOILERPLATE.some((r) => r.test(body))) return 'it is generic filler that would fit any party in any state on any day';
    const lines = contentLines(body).length;
    if (body.length < MIN_CAPTION_CHARS || lines < MIN_CAPTION_LINES) {
      return `it is far too short to publish as a social-media post - ${lines} line(s) and ${body.length} characters, where at least ${MIN_CAPTION_LINES} lines and ${MIN_CAPTION_CHARS} characters are needed`;
    }
    return null;
  };

  /**
   * Tidy a plain-text completion into something publishable.
   *
   * Without the JSON grammar the model is free to be chatty, so it prefixes "Here is the
   * post:", wraps the whole thing in quotes, or bolds a line. None of that survives to
   * an influencer's screen.
   */
  /**
   * Drop a line that restates one already written.
   *
   * Asked for three fact lines when the posts only support one, the model pads: it wrote
   * "constructed over 10 new schools in Quepem" and then "built 12 new schools in
   * Quepem" four lines later — the same claim with a different, invented number. Two
   * contradictory numbers in one post is worse than one fact stated once.
   */
  const dedupeLines = (text) => {
    const seen = [];
    return String(text).split('\n').filter((line) => {
      const words = new Set(line.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
      if (words.size < 3) return true;   // blanks and very short lines are not duplicates
      const dup = seen.some((prev) => {
        const shared = [...words].filter((w) => prev.has(w)).length;
        return shared / Math.min(words.size, prev.size) >= 0.7;
      });
      if (!dup) seen.push(words);
      return !dup;
    }).join('\n');
  };

  const cleanPost = (raw, title = '') => {
    let t = decodeEntities(raw).replace(/\r\n/g, '\n');
    t = t.replace(/^\s*(?:here(?:'s| is)[^\n:]*:|post:|caption:|sure[^\n:]*:)\s*/i, '');
    t = t.replace(/\*\*/g, '').replace(/^```[a-z]*\n?|```$/gim, '');
    // Every hash is stripped, the word behind it kept: "In #ShriKalahasthi, YCP…" reads
    // fine as prose, and a tag left inline reappeared in the tag line composeCaption
    // adds, so the same hashtag was published twice in one post. One source of tags.
    t = t.replace(/#(?=[\p{L}\p{N}_])/gu, '');
    t = t.split('\n')
      // Headings and labels the format forbids, in case the model writes them anyway.
      // "Line 3: In Anakapalli, police intervened…" is it narrating the instructions it
      // was handed; published as-is that reads like a leaked template.
      .map((l) => l.replace(/^\s*line\s*\d+\s*[:.)-]\s*/i, '')
        .replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, '')
        .replace(/^(?:why it matters|what changed|the ask|call to action)\s*:\s*/i, ''))
      // After stripping, "Line 2: ." — its answer for a line it was told to leave empty —
      // is a bare full stop. Blank lines are kept; lines that are only punctuation go.
      .map((l) => (/^[\s.,;:_*-]+$/.test(l) ? '' : l))
      .join('\n');
    t = dedupeLines(t);
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    // "Police Pledge: Safety & Security" as line 1 of a post titled exactly that — the
    // model treating the campaign name as a heading. A post is not a document.
    const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const lines = t.split('\n');
    if (title && lines.length > 2 && norm(lines[0]) === norm(title)) t = lines.slice(1).join('\n').trim();
    // Only when the model quoted the ENTIRE post, not when it quotes someone inside it.
    if (/^["'“‘]/.test(t) && /["'”’]$/.test(t) && (t.match(/["“”]/g) || []).length <= 2) t = t.slice(1, -1).trim();
    return t;
  };

  /**
   * Remove lines the model copied out of a source post instead of writing.
   *
   * The corpus is largely YouTube and X titles, so it lifted whole ones in —
   * "Public reaction on KCR | Kaleshwaram Congress BRS" —
   * and stripping the hashes off them made them read almost like prose. Two tells: a
   * pipe, which titles use and written sentences do not, and heavy word overlap with a
   * single source post. Either one means it is quoting, not composing.
   */
  const stripSourceEchoes = (text, refs) => {
    const bag = (v) => new Set(String(v).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
    const sources = refs.map((r) => bag(r.text));
    return String(text).split('\n').filter((line) => {
      if (!line.trim()) return true;
      if (line.includes('|')) return false;
      const words = bag(line);
      if (words.size < 4) return true;
      return !sources.some((src) => [...words].filter((w) => src.has(w)).length / words.size >= 0.75);
    }).join('\n');
  };

  const SYSTEM_POST =
`You write finished social-media posts for a political campaign. Output ONLY the post itself — no preamble, no explanation, no quotation marks, no JSON, no hashtags.

FORMAT — follow it exactly:
Line 1: the campaign's claim, in the everyday words a voter would use.
Line 2: empty.
Lines 3, 4 and 5: three lines, each stating ONE thing that was done or that happened, and each naming a place, scheme, number, person or claim from the posts you are given.
Line 6: empty.
Lines 7 and 8: two lines on what that changed for an ordinary person living there.
Line 9: empty.
Line 10: one line asking the reader to do one thing — share it, ask their MLA, come and see, judge for themselves.

Every non-empty line must be a complete sentence of 15 to 25 words. Press Enter at the end of each one; never run two of them together into a paragraph.
Take every fact from the posts you are given. Never invent a number, a year, a place or a name to fill a line — if you only have two facts, write two fact lines and make them longer.
Never state the same fact twice in different words, and never give two different numbers for the same thing.
Do not number the lines. Do not write headings such as "Why it matters:". Do not write hashtags anywhere.
Never copy a line out of the posts. They are video titles and comments; you are writing an original post that uses the facts in them.
Do not use "committed to", "with integrity", "dedicated to serving" or "positive change".`;

  /**
   * Pass 2 — write the post as prose.
   *
   * Split out from the JSON call because Ollama's JSON grammar suppressed the newlines
   * this needs (see callLLM). It also lets the post be regenerated on its own, so a
   * caption that comes back too short costs one short call rather than the whole object.
   */
  const writePost = async (u, one) => {
    const facts = (Array.isArray(one.suggested_news) ? one.suggested_news : [])
      .filter((f) => f && !/https?:\/\//i.test(f)).slice(0, 4);
    const user =
`Campaign: ${one.title}
Issue: ${u.topic}
Angle: ${u.intent === 'counter' ? 'answer the criticism with the record and evidence of the party' : 'amplify what favours the party, including failures of the government against its own promises'}${u.angle ? `\nThis post's own angle: ${u.angle}` : ''}
${facts.length ? `\nFacts you may use:\n${facts.map((f) => `- ${f}`).join('\n')}\n` : ''}
Posts these must come from:
${u.refs.map((r) => `[${r.ref}] (${evidenceLabel(r)}) ${r.text}`).join('\n')}

Write the post now, in the format given. Only the post.`;

    let best = '';
    for (let i = 0; i <= MAX_REWRITES; i += 1) {
      let text;
      try {
        text = cleanPost(await callLLM(SYSTEM_POST, i === 0 ? user : `${user}\n\nYour previous attempt was rejected because ${captionProblem(best)}:\n${best}\n\nWrite it again. Put a real line break after every sentence, and make every line a full sentence of 15 to 25 words.`, {}, { json: false }), one.title);
      } catch (err) {
        console.warn(`[campaignSuggestions] post write failed for "${u.topic}": ${err.message}`);
        break;
      }
      text = stripSourceEchoes(text, u.refs).replace(/\n{3,}/g, '\n\n').trim();
      if (!text) break;
      // Keep the longest usable attempt: a rewrite is usually better but not always, and
      // a short post is the exact failure this whole pass exists to prevent.
      if (contentLines(text).length > contentLines(best).length
        || (contentLines(text).length === contentLines(best).length && text.length > best.length)) best = text;
      if (!captionProblem(best)) break;
      if (i < MAX_REWRITES) console.log(`[campaignSuggestions] "${u.topic}": ${captionProblem(best)} - rewrite ${i + 1}/${MAX_REWRITES}`);
    }
    return best;
  };

  const generateOne = async (u) => {
    const user =
`Issue: "${u.topic}" — ${u.posts} posts in the last ${days} days, ${u.anti} critical of us, ${u.pro} supportive. Recommended intent: ${u.intent}.
${u.angle ? `\nThis is campaign ${u.variant + 1} of ${u.variants} on this issue, so it must not repeat the others. Your angle: ${u.angle}\n` : ''}
Posts:
${u.refs.map((r) => `[${r.ref}] (${evidenceLabel(r)}) ${r.text}`).join('\n')}

Write ONE campaign for this issue as a single JSON object in the shape given. No other text.`;

    const ask = async (extra) => {
      const raw = await callLLM(SYSTEM_ONE, extra ? `${user}\n\n${extra}` : user);
      const s = raw.indexOf('{');
      const e = raw.lastIndexOf('}');
      if (s < 0 || e < 0) return null;
      const obj = JSON.parse(raw.slice(s, e + 1));
      // A bare object is what we asked for, but accept a one-element wrapper too rather
      // than discarding an otherwise good answer over its packaging.
      const one = Array.isArray(obj?.suggestions) ? obj.suggestions[0] : obj;
      if (!one || typeof one !== 'object' || Array.isArray(one) || !one.title) return null;
      return one;
    };

    try {
      let one = await ask();
      if (!one) return null;

      // One retry, quoting the offending line back. Cheap next to the value of not
      // shipping a post that says nothing — and bounded, so a model that simply cannot
      // do better costs one extra call rather than a loop.
      // The post itself comes from a second, plain-text call. The JSON draft stays as
      // the fallback for the case where that call fails outright.
      const post = await writePost(u, one);
      if (post) one.suggested_message = post;

      return { ...one, __unit: u };
    } catch (err) {
      console.warn(`[campaignSuggestions] topic "${u.topic}" failed: ${err.message}`);
      return null;
    }
  };

  // Concurrent: the Ollama queue already limits how many actually run at once, so this
  // just stops six topics from being six serial round-trips.
  const parsed = (await Promise.all(units.map(generateOne))).filter(Boolean);
  console.log(`[campaignSuggestions] ${parsed.length}/${units.length} topics produced a campaign`);

  const topTopicNames = topics.slice(0, 6).map(([t]) => t);
  const evidence = {
    grievance_count: grievances.length,
    alert_count: alerts.length,
    event_count: events.length,
    news_count: news.length,
    sources: picked,
    top_topics: topTopicNames,
    sample_texts: samples.slice(0, 5),
    // How the evidence was chosen. Stored so a suggestion can be read months later
    // knowing whether it was grounded in retrieved posts or in a recency fallback —
    // the two are not equally trustworthy and the card should not imply they are.
    retrieval: {
      used: retrievalMeta.used,
      mode: retrievalMeta.mode ? `${retrievalMeta.mode.dense}/${retrievalMeta.mode.lexical}` : '',
      topics_considered: retrievalMeta.topics.map((t) => t.topic),
      // Which vocabulary the topics came from. A card grouped on the coarse fallback is
      // not the same quality of claim as one grouped on the campaign taxonomy.
      taxonomy: retrievalMeta.grouping?.taxonomy || '',
      note: retrievalMeta.reason || '',
      // What the operator asked for. Recorded so a card can be read months later
      // without wondering why it cites eight critical posts and no supportive ones.
      filters: {
        topics: wanted,
        per_topic: perTopicN,
        stance: stanceMode,
        max_topics: topN,
        campaigns_per_topic: campaignsReq,   // null = sized from each topic's volume
        defaults: !wanted.length && stanceMode === 'all' && perTopicN === RETRIEVE_PER_TOPIC && topN === MAX_TOPICS && campaignsReq === null,
      },
    },
  };

  /**
   * Resolve the refs a suggestion cited back to the real posts.
   *
   * Anything unrecognised is dropped rather than guessed — a hallucinated ref should
   * show as "no sources cited", which is honest, instead of silently pointing the
   * operator at an unrelated post.
   */
  const resolveSources = (refs, unit) => {
    // Resolve against the unit's OWN refs. Each topic was numbered 1..n independently,
    // so a global index would map "ref 3" to whichever topic happened to be third — a
    // silent mis-attribution that is worse than citing nothing.
    const index = new Map((unit?.refs || []).map((r) => [r.ref, r]));
    const seen = new Set();
    const cited = (Array.isArray(refs) ? refs : [])
      .map((n) => index.get(Number(n)))
      .filter((r) => r && !seen.has(r.ref) && seen.add(r.ref));
    // If the model cited nothing usable, fall back to the top retrieved posts for this
    // topic. They ARE what the suggestion was generated from — the model simply failed
    // to say so — and showing them beats showing an empty list.
    const list = cited.length ? cited : (unit?.refs || []).slice(0, 3);
    return list.slice(0, 8).map(({ kind, ref_id, platform, url, author, sentiment, stance: st, emotion, confidence, text, at }) => ({
      kind, ref_id, platform, url, author, sentiment, stance: st, emotion, confidence, text, at,
    }));
  };

  // Denominator for the impact score: the biggest topic this run considered.
  const maxTopicPosts = Math.max(1, ...units.map((u) => Number(u.posts) || 0));

  const docs = parsed.slice(0, 8).map((s) => ({
    // The issue this campaign is about, straight from Stage A. Stored so the brief and
    // the card can name it without re-deriving it from the title.
    topic: s.__unit?.topic || '',
    title: pickTitle(s.title, s.__unit),
    summary: decodeEntities(s.summary).slice(0, 1500),
    // The creator-facing brief. Kept separate from `summary` because they have different
    // audiences: summary is our own read of the conversation, brief is instructions to an
    // outside person who must never see our monitoring numbers.
    brief: decodeEntities(s.brief).slice(0, 2000),
    sentiment: ['positive', 'negative', 'neutral', 'mixed'].includes(s.sentiment) ? s.sentiment : 'mixed',
    /**
     * Intent comes from the COUNTS, not from the model.
     *
     * Stage A already decides this by comparing how many posts in the topic are critical
     * of the client against how many are supportive — an arithmetic fact about the
     * window. Asked to decide it as well, the 7B model returned "amplify" for all six
     * topics including Corruption (43 critical vs 25 supportive), and then wrote a
     * DEFENCE as the message: a counter-campaign mislabelled as amplification, which
     * routes it to the wrong reviewer and the wrong influencer brief.
     *
     * The model chooses what to SAY. The database decides which direction.
     */
    intent: s.__unit?.intent === 'counter' || s.__unit?.intent === 'amplify'
      ? s.__unit.intent
      : (s.intent === 'counter' ? 'counter' : 'amplify'),
    /**
     * Impact and urgency are computed, not asked for.
     *
     * The model returned 0 for both on most topics, which rendered as "Impact 0 ·
     * Urgency 0" — a number that looks broken and, when it was non-zero, was an
     * unfounded guess anyway. Both are now derived from the same aggregation that chose
     * the topic:
     *   impact  = how big this issue is next to the biggest issue in the window
     *   urgency = how one-sided it is (a 43-to-25 pile-on needs answering sooner than
     *             an evenly split conversation)
     * Floored rather than allowed to reach 0: a topic that cleared Stage A's minimum is
     * by definition not zero-impact.
     */
    impact_score: scoreImpact(s.__unit, maxTopicPosts),
    urgency_score: scoreUrgency(s.__unit),
    // Derived too, NOT taken from the model. Keeping the model's value here produced a
    // card badged "high" beside "Impact 20 · Urgency 72" — a badge contradicting the two
    // numbers printed next to it, which makes both untrustworthy.
    priority: derivePriority(s.__unit, maxTopicPosts),
    // pickHashtags is pure, and calling it here as well as below is what guarantees the
    // caption's tag line and the suggested_hashtags array can never disagree.
    variant_index: Number(s.__unit?.variant) || 0,
    variant_count: Number(s.__unit?.variants) || 1,
    suggested_message: composeCaption(s.suggested_message, pickHashtags(s.suggested_hashtags, s.__unit)),
    // The long post cannot fit X. Rather than let it be silently truncated at 280, the
    // model writes a compressed variant and the Edit & send modal prefills X's override
    // with it, so the operator starts from real copy instead of an empty box.
    suggested_message_short: stripTrailingHashtags(decodeEntities(s.suggested_message_short)).slice(0, 280),
    /**
     * Talking points — facts to work into the post, never links.
     *
     * The model was emitting placeholder URLs ("https://example.com/news/…") because the
     * field is called suggested_news. It has no way to know a real URL, so every one of
     * those was fabricated and shown to the operator as if it were a source. Anything
     * URL-shaped is dropped here as well as being forbidden in the prompt, because a
     * fabricated citation is worse than no citation.
     */
    suggested_news: Array.isArray(s.suggested_news)
      ? s.suggested_news
          .map((x) => decodeEntities(x).trim())
          .filter((x) => x && !/https?:\/\/|www\.|example\.com/i.test(x))
          .map((x) => x.slice(0, 300))
          .slice(0, 6)
      : [],
    suggested_hashtags: pickHashtags(s.suggested_hashtags, s.__unit),
    // Canonicalised, because both candidate sources are lowercase: the model echoes the
    // `active_platforms` we hand it, and the fallback is that same observed list.
    target_platforms: (() => {
      const named = normalizePlatforms(s.target_platforms);
      return named.length ? named.slice(0, 8) : normalizePlatforms(platforms);
    })(),
    recommended_niche: String(s.recommended_niche || '').slice(0, 120),
    rationale: String(s.rationale || '').slice(0, 1000),
    // Batch-wide counts plus the posts THIS suggestion actually cited.
    evidence: {
      ...evidence,
      // Scale of the issue, so a reviewer sees "169 posts, 115 supportive" rather than
      // only the batch-wide pool size.
      topic_posts: Number(s.__unit?.posts) || 0,
      topic_anti: Number(s.__unit?.anti) || 0,
      topic_pro: Number(s.__unit?.pro) || 0,
      source_posts: resolveSources(s.source_refs, s.__unit),
    },
    status: 'new',
    generated_by: generatedBy,
    generated_by_role: generatedByRole,
    history: [{ action: 'generated', by: generatedBy, role: generatedByRole, note: `${picked.join(', ')} · ${days}d`, at: new Date() }],
    generated_at: new Date(),
  }));

  // Replace the existing "new" suggestions; never touch dismissed/converted.
  //
  // Insert BEFORE deleting, and delete only the batch we saw going in. Deleting first
  // meant any failed insert — a schema mismatch, a dropped connection — wiped the
  // previous batch and left the page empty with nothing to fall back on. Likewise, a
  // run that parses nothing keeps the old suggestions rather than clearing the screen.
  if (!docs.length) {
    return CampaignSuggestion.find({ status: 'new' })
      .sort({ impact_score: -1, urgency_score: -1 }).lean();
  }

  const superseded = (await CampaignSuggestion
    .find({ status: 'new' }).select('id').lean()).map((d) => d.id);

  await CampaignSuggestion.insertMany(docs);
  if (superseded.length) {
    // ARCHIVE, do not delete. Pressing Generate twice used to destroy the first run
    // outright — including suggestions the operator was still considering, and any
    // chance of comparing one run against the next.
    await CampaignSuggestion.updateMany(
      { status: 'new', id: { $in: superseded } },
      { $set: { status: 'superseded' } },
    );
  }

  // Bounded history. Without this, generating daily accumulates suggestions
  // forever; with it, the archive covers the window anyone would actually look back
  // over. Only 'superseded' is pruned — a dismissal or a conversion is a decision
  // someone made and is kept regardless of age.
  const retentionCutoff = new Date(Date.now() - SUGGESTION_RETENTION_DAYS * 86400000);
  await CampaignSuggestion.deleteMany({
    status: 'superseded',
    generated_at: { $lt: retentionCutoff },
  }).catch((err) => console.warn(`[campaignSuggestions] retention prune skipped: ${err.message}`));

  return CampaignSuggestion.find({ status: 'new' })
    .sort({ impact_score: -1, urgency_score: -1 }).lean();
}

module.exports = { generateSuggestions };
