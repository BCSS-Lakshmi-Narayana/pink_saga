/**
 * Stage A of AI Campaign generation — find the issues worth campaigning on.
 *
 * This is pure MongoDB. No LLM call happens here, and that is the whole point: a
 * 30-90 day window can hold 20,000+ posts, and counting them is a database job.
 * Ollama only ever sees the handful of topics this returns, and later the small
 * set of posts retrieved for each.
 *
 *   20,000 posts  →  [this service]  →  5-8 topics  →  RAG  →  Ollama
 *
 * Reads the classification already stamped on each post at ingest
 * (topic / grievance_type / political.stance), so the cost here is an indexed
 * aggregation, not re-analysis.
 */

const Grievance = require('../models/Grievance');
const NewsArticle = require('../models/NewsArticle');
const Alert = require('../models/Alert');
const { CAMPAIGN_TOPICS, normalizeCampaignTopic } = require('./campaignTaxonomy');

/**
 * Where the posts live.
 *
 * The same aggregation serves two collections because the platform has two, populated by
 * different paths: the monitoring pipeline writes Content, while the keyword/mentions
 * fetch writes Grievance — and today Grievance is the one with data (501 posts vs 0).
 * They carry the same information under different names, so rather than duplicate the
 * grouping (and let the copies drift, which is how the classification fields ended up
 * written on one path and dropped on the other) the field names are a parameter.
 *
 * Both now carry the 16-value campaign taxonomy — Content at `topic`, Grievance at
 * `analysis.topic`. Grievance additionally declares a `topicFallback`, because its
 * documents predate the field: until the backfill has covered enough of a window the
 * aggregation groups on the coarse `grievance_type` instead, rather than ranking
 * whichever posts the backfill happened to reach first.
 */
// A news article the Node pipeline has scored carries a real `political_stance`;
// before that only the Python engine's client-relative `sentiment` exists.
const NEWS_IS_SCORED = { $ne: [{ $ifNull: ['$pipeline_analyzed_at', null] }, null] };
const CAMPAIGNABLE_NEWS_STANCES = ['pro_target', 'pro_target_indirect', 'anti_target', 'anti_target_indirect'];

const SOURCES = {
  grievance: {
    model: () => Grievance,
    // The 16-value campaign taxonomy, not `grievance_type`. grievance_type's "Public
    // Complaint" merges water, power, roads, schools and pensions into one bucket, and
    // its "Normal" swallowed half the corpus — neither can produce the per-issue split
    // a campaign needs. `analysis.topic` is populated on ingest and by
    // scripts/backfill-grievance-topics.js.
    topic: 'analysis.topic',
    // Falls back to the coarse label for documents the topic backfill has not reached,
    // so a partially-classified corpus still aggregates instead of returning nothing.
    topicFallback: 'analysis.grievance_type',
    stance: 'analysis.political_stance',
    beneficiary: 'analysis.beneficiary',
    date: 'post_date',
    subtype: 'analysis.grievance_type',
    // Campaigns should be built only from posts whose core labels passed the confidence
    // gate. Low-confidence rows stay stored for review/reprocessing, but are excluded
    // from topic ranking and RAG evidence by default.
    live: { is_active: { $ne: false }, 'analysis.needs_review': { $ne: true } },
  },
  /**
   * RSS news. Grouped on its OWN `category` enum rather than the campaign taxonomy.
   *
   * NewsArticle carries analysis.stance (rssAnalysisService sets it) but has neither
   * `analysis.topic` nor an `embedding`, so it can join neither the 16-value taxonomy
   * nor the vector retrieval without a classification backfill. Its ingest-time
   * `category` — politics, development, agriculture, law_order… — is already populated
   * on every article, so it groups and ranks today with nothing to run first.
   */
  /**
   * Alerts — risk detections, grouped on the campaign topic classified onto them by
   * scripts/backfill-alert-topics.js.
   *
   * NO STANCE, deliberately. An alert exists because something was flagged as a risk, so
   * it is negative by construction; counting a pro/anti split would produce the same
   * answer every time. `stanceExpr` therefore pins every alert to anti_target, which
   * makes the intent 'counter' fall out of the normal aggregation rather than being
   * special-cased downstream.
   */
  alert: {
    model: () => Alert,
    topic: 'campaign_topic',
    stance: '__stance',
    stanceExpr: 'anti_target',
    beneficiary: '__beneficiary',
    beneficiaryExpr: 'opposition',
    date: 'published_at',
    subtype: 'alert_type',
    live: {},
  },

  /**
   * RSS news, grouped on its OWN `category` enum rather than the campaign taxonomy —
   * NewsArticle has neither analysis.topic nor an embedding, so it can join neither the
   * 16-value vocabulary nor the vector retrieval without a classification backfill.
   *
   * Stance comes from two places, depending on whether the Node pipeline has scored
   * the article yet (`pipeline_analyzed_at`):
   *   • scored   → `political_stance`, the same target-derived stance Mentions and
   *                Alerts carry. `sentiment` on these rows is the RAW tone, so it
   *                must NOT be used to decide who gains (a negative article about
   *                Congress is pro client).
   *   • unscored → the Python engine's ingest values: `sentiment` (CLIENT-relative
   *                there) plus `sentiment_target_alignment`, folded into the same
   *                vocabulary. This branch only covers the short gap before the
   *                RSS scorer reaches the article.
   */
  news: {
    model: () => NewsArticle,
    topic: 'category',
    stance: '__stance',      // computed by stanceExpr below, not stored
    stanceExpr: {
      $cond: [
        NEWS_IS_SCORED,
        {
          $cond: [
            { $in: ['$political_stance', CAMPAIGNABLE_NEWS_STANCES] },
            '$political_stance',
            'neutral',
          ],
        },
        {
          $switch: {
            branches: [
              { case: { $and: [{ $eq: ['$sentiment', 'positive'] }, { $eq: ['$sentiment_target_alignment', 'ally'] }] }, then: 'pro_target' },
              { case: { $and: [{ $eq: ['$sentiment', 'positive'] }, { $eq: ['$sentiment_target_alignment', 'opposition'] }] }, then: 'pro_target_indirect' },
              { case: { $and: [{ $eq: ['$sentiment', 'negative'] }, { $eq: ['$sentiment_target_alignment', 'ally'] }] }, then: 'anti_target' },
              { case: { $and: [{ $eq: ['$sentiment', 'negative'] }, { $eq: ['$sentiment_target_alignment', 'opposition'] }] }, then: 'anti_target_indirect' },
            ],
            // Everything else carries no signal about us — same treatment as
            // 'unrelated' on a mention, i.e. counted nowhere and campaigned on never.
            default: 'neutral',
          },
        },
      ],
    },
    beneficiary: '__beneficiary',
    // Who gains follows the stance: pro client → ours, anti client → opposition.
    beneficiaryExpr: {
      $cond: [
        NEWS_IS_SCORED,
        {
          $switch: {
            branches: [
              { case: { $in: ['$political_stance', ['pro_target', 'pro_target_indirect']] }, then: 'ours' },
              { case: { $in: ['$political_stance', ['anti_target', 'anti_target_indirect']] }, then: 'opposition' },
            ],
            default: 'none',
          },
        },
        {
          $switch: {
            branches: [
              { case: { $and: [{ $eq: ['$sentiment', 'positive'] }, { $in: ['$sentiment_target_alignment', ['ally', 'opposition']] }] }, then: 'ours' },
              { case: { $and: [{ $eq: ['$sentiment', 'negative'] }, { $in: ['$sentiment_target_alignment', ['ally', 'opposition']] }] }, then: 'opposition' },
            ],
            default: 'none',
          },
        },
      ],
    },
    date: 'published_date',
    subtype: 'source_name',
    live: {},
  },
};

const sourceFor = (name) => SOURCES[String(name || 'grievance').toLowerCase()] || SOURCES.grievance;

// Kept as an export for API compatibility with the multi-tenant original; unused here,
// where the deployment monitors a single organisation and there is nothing to partition.
const NO_TENANT = '__NO_TENANT__';

// Stances worth building a campaign around. `unrelated` and a missing stance carry
// no signal about the client, and campaigning on them would be noise.
const CAMPAIGNABLE_STANCES = [
  'anti_target', 'anti_target_indirect', 'pro_target', 'pro_target_indirect',
];

const DEFAULT_DAYS = 30;
const DEFAULT_TOP_N = 8;
// Below this a "topic" is a handful of posts — a coincidence, not an issue. Ten is
// deliberately low enough for a small constituency and high enough that one angry
// thread does not become a campaign.
const DEFAULT_MIN_POSTS = 10;
// Below this share of classified posts, grouping on the campaign taxonomy would rank a
// biased sample — whichever posts the backfill happened to reach first.
const MIN_TOPIC_COVERAGE = Number(process.env.RAG_MIN_TOPIC_COVERAGE || 0.5);

const clampInt = (v, min, max, fallback) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/**
 * Build the $match stage.
 *
 * Every filter is applied here, before any grouping: constituency, date window, and a
 * classified-and-campaignable stance.
 */
const buildMatch = ({ constituency, since, until, stances, source = 'grievance', topicField = null }) => {
  const S = sourceFor(source);
  const field = topicField || S.topic;
  const match = {
    [S.date]: { $gte: since, ...(until ? { $lte: until } : {}) },
    ...S.live,
    // Unclassified posts (topic null) are excluded rather than bucketed: they would
    // otherwise form a giant "null" group that looks like the biggest issue.
    [field]: { $nin: [null, ''] },
  };
  // A stored stance can be matched up front; a derived one does not exist until an
  // $addFields stage has run, so the aggregation applies it in a second $match.
  if (!S.stanceExpr) match[S.stance] = { $in: stances };
  // Constituency is optional — a tenant-wide campaign is legitimate — but when it is
  // supplied it is mandatory, never a soft preference. Resolved location lives under
  // detected_location, the same shape Grievance and NewsArticle use; Content carries
  // no flat `constituency` field and matching on one would silently return nothing.
  if (constituency) match['detected_location.constituency'] = constituency;
  return match;
};

/**
 * The significant issues in a window, ranked.
 *
 * @param {object}   opts
 * @param {string}   [opts.constituency]    optional hard filter
 * @param {number}   [opts.days=30]         window size (7 / 30 / 90)
 * @param {Date}     [opts.until]           window end, defaults to now
 * @param {number}   [opts.topN=8]          how many topics to return
 * @param {number}   [opts.minPosts=10]     ignore topics thinner than this
 * @param {string[]} [opts.stances]         override the campaignable stance list
 * @returns {Promise<{window:object, totals:object, topics:object[]}>}
 */
const getSignificantTopics = async ({
  constituency = null,
  days = DEFAULT_DAYS,
  until = null,
  topN = DEFAULT_TOP_N,
  minPosts = DEFAULT_MIN_POSTS,
  stances = CAMPAIGNABLE_STANCES,
  source = 'grievance',
} = {}) => {
  const S = sourceFor(source);
  const Model = S.model();

  const windowDays = clampInt(days, 1, 365, DEFAULT_DAYS);
  const end = until ? new Date(until) : new Date();
  const since = new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const limit = clampInt(topN, 1, 50, DEFAULT_TOP_N);
  const floor = clampInt(minPosts, 1, 10000, DEFAULT_MIN_POSTS);

  /**
   * Which field to group on.
   *
   * A partially-backfilled corpus must not mix taxonomies: grouping on
   * `$ifNull(topic, grievance_type)` would return "Elections & Politics" next to
   * "Normal", two different vocabularies in one ranked list, and the shares would be
   * meaningless. So the choice is all-or-nothing and made from measured coverage.
   *
   * Below the threshold the coarse label is still better than a list built from the
   * handful of posts that happen to have been classified so far.
   */
  const coverageFilter = {
    [S.date]: { $gte: since, $lte: end },
    ...S.live,
    // Measured over the SAME population the aggregation groups, not the whole window.
    //
    // Without the stance filter this compared "posts with a topic" against every post in
    // the window, including the ~80% with no stance towards us. Those can never appear
    // in a campaign and are deliberately not classified, so coverage could not exceed
    // ~24% however complete the backfill was — the gate would never open and all that
    // GPU time would have bought nothing.
    ...(S.stanceExpr ? {} : { [S.stance]: { $in: stances } }),
  };
  const inWindow = await Model.countDocuments(coverageFilter);
  const withTopic = inWindow
    ? await Model.countDocuments({ ...coverageFilter, [S.topic]: { $nin: [null, ''] } })
    : 0;
  const coverage = inWindow ? withTopic / inWindow : 0;
  const useFallback = !!S.topicFallback && coverage < MIN_TOPIC_COVERAGE;
  const topicField = useFallback ? S.topicFallback : S.topic;
  if (useFallback) {
    console.warn(`[campaignTopics] only ${(coverage * 100).toFixed(0)}% of ${inWindow} campaignable posts have a campaign topic — grouping on ${S.topicFallback}. Run scripts/backfill-grievance-topics.js.`);
  }

  const match = buildMatch({ constituency, since, until: end, stances, source, topicField });

  // Everything below runs in the database. Counts, stance splits and platform
  // splits are all $group work — the LLM is never asked to count anything.
  const rows = await Model.aggregate([
    { $match: match },
    // Sources that derive their stance rather than storing it get it materialised here,
    // then filtered — the $match above cannot see a field that does not exist yet.
    ...(S.stanceExpr ? [
      { $addFields: { __stance: S.stanceExpr, __beneficiary: S.beneficiaryExpr } },
      { $match: { __stance: { $in: stances } } },
    ] : []),
    {
      $group: {
        _id: `$${topicField}`,
        posts: { $sum: 1 },
        // The counter/amplify decision is made from these, not from raw sentiment:
        // "negative about us" and "positive about them" are different campaigns.
        anti: { $sum: { $cond: [{ $in: [`$${S.stance}`, ['anti_target', 'anti_target_indirect']] }, 1, 0] } },
        pro: { $sum: { $cond: [{ $in: [`$${S.stance}`, ['pro_target', 'pro_target_indirect']] }, 1, 0] } },
        opposition_benefit: { $sum: { $cond: [{ $eq: [`$${S.beneficiary}`, 'opposition'] }, 1, 0] } },
        platforms: { $addToSet: '$platform' },
        grievance_types: { $addToSet: `$${S.subtype}` },
        latest_at: { $max: `$${S.date}` },
        earliest_at: { $min: `$${S.date}` },
        // Kept so Stage B (RAG retrieval) and the final campaign can cite sources.
        // Capped hard — a 4,000-post topic must not drag 4,000 ids through memory.
        sample_ids: { $push: '$id' },
      },
    },
    { $match: { posts: { $gte: floor } } },
    { $sort: { posts: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        topic: '$_id',
        posts: 1, anti: 1, pro: 1, opposition_benefit: 1,
        platforms: 1, grievance_types: 1, latest_at: 1, earliest_at: 1,
        sample_ids: { $slice: ['$sample_ids', 50] },
      },
    },
  ]);

  // One extra count for the denominator, so the caller can say "4,000 of 20,000".
  const totalInWindow = await Model.countDocuments({
    [S.date]: { $gte: since, $lte: end },
    ...S.live,
    ...(constituency ? { 'detected_location.constituency': constituency } : {}),
  });

  const topics = rows.map((r) => ({
    ...r,
    platforms: (r.platforms || []).filter(Boolean),
    grievance_types: (r.grievance_types || []).filter(Boolean),
    // The routing decision, computed from counts rather than asked of the model.
    // A topic where criticism outweighs praise needs answering; the reverse is
    // worth amplifying. Ties default to 'counter' — an unanswered criticism costs
    // more than a missed opportunity to boast.
    intent: r.anti >= r.pro ? 'counter' : 'amplify',
    // Share of the classified, campaignable posts in this window.
    share: totalInWindow ? Number((r.posts / totalInWindow).toFixed(4)) : 0,
  }));

  return {
    window: { days: windowDays, since, until: end, constituency: constituency || null },
    // What the grouping was actually built from, so a caller can say so rather than
    // implying campaign-taxonomy quality from a coarse fallback.
    grouping: {
      field: topicField,
      taxonomy: useFallback ? 'grievance_type (fallback)' : 'campaign topic',
      coverage: Number(coverage.toFixed(3)),
    },
    totals: {
      posts_in_window: totalInWindow,
      topics_found: topics.length,
      posts_in_topics: topics.reduce((n, t) => n + t.posts, 0),
    },
    topics,
  };
};

/**
 * Validate a caller-supplied topic against the taxonomy.
 *
 * Used by the retrieval stage so a topic arriving over HTTP cannot become an
 * arbitrary query value.
 */
const isKnownTopic = (t) => !!normalizeCampaignTopic(t);

module.exports = {
  getSignificantTopics,
  isKnownTopic,
  buildMatch,
  CAMPAIGNABLE_STANCES,
  CAMPAIGN_TOPICS,
  NO_TENANT,
  DEFAULT_DAYS,
  DEFAULT_TOP_N,
  DEFAULT_MIN_POSTS,
  SOURCES,
};
