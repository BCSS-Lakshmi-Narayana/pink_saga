const mongoose = require('mongoose');

const detectedLocationSchema = new mongoose.Schema({
  location_found: { type: Boolean, default: false },
  district:       { type: String, default: '' },
  city:           { type: String, default: '' },
  state:          { type: String, default: '' },
  lat:            { type: Number, default: null },
  lng:            { type: Number, default: null },
  // Assembly constituency, added for Constituency Leader Popularity — the
  // Python ingest engine writes district/city/state above but never this.
  // Filled by constituencyLocationSweepService, same as Alert.detected_location.
  constituency:   { type: String, default: '' },
  lok_sabha:      { type: String, default: '' },
  source:         { type: String, default: '' },
  // Completion marker the sweep's pending query keys on — stamped on every
  // attempt (success or failure) so an unplaceable article is asked once, not
  // re-classified forever. Distinct from location_found, which the Python
  // engine already defaults to false for every row on insert.
  attempted_at:   { type: Date, default: null },
}, { _id: false });

const newsArticleSchema = new mongoose.Schema({
  title:           { type: String, required: true },
  title_english:   { type: String, default: '' },
  summary:         { type: String, default: '' },
  summary_english: { type: String, default: '' },
  content:         { type: String, default: '' },
  source_url:      { type: String, required: true, unique: true },
  source_name:     { type: String, default: '' },
  source_domain:   { type: String, default: '' },
  image_url:       { type: String, default: null },
  published_date:  { type: Date, default: Date.now },
  scraped_at:      { type: Date, default: Date.now },
  // Telangana's press is Telugu ('te') and English ('en'), with a real Urdu
  // ('ur') presence in Hyderabad. Default is 'te', not 'en': the bulk of
  // ingested copy is Telugu, and defaulting to English mislabels it wholesale.
  language:        { type: String, enum: ['en', 'te', 'ur', 'hi', 'unknown'], default: 'te' },
  category: {
    type: String,
    // 'communal' is written by the Blura engine (political_config.CATEGORY_KEYWORDS).
    enum: ['crime', 'politics', 'development', 'agriculture', 'health', 'education', 'law_order', 'communal', 'accident', 'sports', 'culture', 'general'],
    default: 'general',
  },
  // Same three-bucket scheme as grievances/mentions: positive | negative | neutral ('moderate' is the retired label).
  // Once rssAnalysisService has scored the article this is the RAW tone; the
  // client-relative verdict is `target_sentiment` / `political_stance`. Before
  // that it holds the Python engine's ingest value.
  sentiment:        { type: String, enum: ['positive', 'negative', 'neutral', 'moderate'], default: 'neutral' },
  // Who the sentiment above is actually about — the LLM already computes these
  // when scoring `sentiment`; kept instead of discarded so a "Negative" badge
  // can show *who* it's negative for instead of reading as generic bad news.
  sentiment_target:           { type: String, default: '' }, // e.g. "BJP", "INC", leader name, or "none"
  sentiment_target_alignment: { type: String, default: '' }, // ally | opposition | neutral | none
  sentiment_reasoning:        { type: String, default: '' }, // 1-2 sentence model justification

  // ── Target-aware political intelligence ──────────────────────────
  // Populated when an article is (re-)scored through the shared Node pipeline
  // via services/rssAnalysisService.js, so RSS carries the SAME stance
  // vocabulary as Mentions and Alerts. The Python ingest engine writes only
  // `sentiment` + the three `sentiment_*` fields above, so these stay at their
  // defaults until an article is analysed here.
  political_stance: {
    type: String,
    enum: ['pro_target', 'anti_target', 'pro_target_indirect', 'anti_target_indirect', 'neutral', 'mixed', 'unrelated'],
    default: 'neutral',
  },
  target_sentiment: { type: String, enum: ['positive', 'negative', 'neutral', 'moderate'], default: 'neutral' },
  generic_sentiment: { type: String, enum: ['positive', 'negative', 'neutral', 'moderate'], default: 'neutral' },
  target_tone: { type: String, enum: ['positive', 'negative', 'neutral', 'moderate'], default: 'neutral' },
  // Follows the RAW `sentiment` (positive → low, neutral → low, negative →
  // high), the same bands Alerts and Mentions use. Set by rssAnalysisService.
  // `risk_level` below is a TONE band (negative reads high), not risk to the client.
  // `client_impact` / `hostile_to_client` answer the client-facing question from the stance.
  client_impact: { type: String, enum: ['favourable', 'adverse', 'neutral', 'mixed'], default: null },
  hostile_to_client: { type: Boolean, default: false },
  risk_level: { type: String, enum: ['low', 'medium', 'high'], default: null },
  risk_score: { type: Number, default: null },
  emotion: {
    type: String,
    enum: ['anger', 'joy', 'fear', 'sadness', 'frustration', 'hope', 'pride', 'sarcasm', 'concern', 'neutral'],
    default: 'neutral',
  },
  confidence: { type: mongoose.Schema.Types.Mixed, default: {} },
  validation: { type: mongoose.Schema.Types.Mixed, default: null },
  validation_status: { type: String, enum: ['passed', 'needs_review'], default: 'passed' },
  needs_review: { type: Boolean, default: false },
  review_reason: { type: String, default: '' },
  client_relevance: { type: String, enum: ['relevant', 'not_relevant', 'uncertain'], default: 'uncertain' },
  target: {
    type: String,
    enum: ['our_party', 'state_government', 'rival_party', 'leader', 'institution', 'issue', 'unknown', 'none', 'ruling_party', 'opposition', 'other'],
    default: 'unknown',
  },
  /**
   * The 16-value CAMPAIGN taxonomy (services/campaignTaxonomy.js), the same one
   * Grievance stores as `analysis.topic` and Alert as `campaign_topic`.
   *
   * AI Campaigns Stage A groups news on the `category` enum above rather than on
   * this field, so nothing breaks while it is null — but storing it keeps the
   * three collections describing an issue with one vocabulary, which is what
   * makes a cross-source campaign possible at all.
   */
  campaign_topic: { type: String, default: null },
  campaign_topic_taxonomy_version: { type: Number, default: null },
  /** Full pipeline output, for the reason modal. */
  pipeline_analysis: { type: mongoose.Schema.Types.Mixed, default: null },
  pipeline_analyzed_at: { type: Date, default: null },
  /** Failed/incomplete scoring attempts; the RSS scorer stops retrying at MAX_ANALYSIS_ATTEMPTS. */
  pipeline_attempts: { type: Number, default: 0 },
  pipeline_last_error: { type: String, default: null },
  /**
   * Set when an administrator corrects the sentiment by hand. A bulk re-analysis
   * skips these unless explicitly forced, so a re-run cannot quietly revert
   * every manual correction.
   */
  manual_sentiment_override: { type: Boolean, default: false },

  source_type:      { type: String, enum: ['rss', 'keyword_search', 'domain'], default: 'rss' },
  relevance_score:  { type: Number, default: 0 },
  keywords_matched: [String],
  is_translated:    { type: Boolean, default: false },
  detected_location: { type: detectedLocationSchema, default: () => ({}) },
}, {
  timestamps: false,
  collection: 'newsarticles',
});

// The CM brief and every date-ranged news query filter on published_date;
// without this the collection was scanned in full on each request.
newsArticleSchema.index({ published_date: -1 });
newsArticleSchema.index({ scraped_at: -1 });
newsArticleSchema.index({ category: 1 });
newsArticleSchema.index({ language: 1 });
newsArticleSchema.index({ source_type: 1 });
newsArticleSchema.index({ 'detected_location.district': 1 });
// Geographic Intelligence: district/city news counts within a date window
newsArticleSchema.index({ 'detected_location.district': 1, published_date: -1 });
newsArticleSchema.index({ 'detected_location.city': 1, published_date: -1 });
// Per-district sentiment rollups (outlet stance breakdown on the constituency page)
newsArticleSchema.index({ 'detected_location.district': 1, sentiment: 1 });
// Review queue + "which articles still need the target-aware pass" lookups
newsArticleSchema.index({ campaign_topic: 1, published_date: -1 });
newsArticleSchema.index({ needs_review: 1, published_date: -1 });
newsArticleSchema.index({ pipeline_analyzed_at: 1, scraped_at: -1 });
newsArticleSchema.index({ 'detected_location.constituency': 1 }, { sparse: true });
newsArticleSchema.index({ 'detected_location.attempted_at': 1 }, { sparse: true });

module.exports = mongoose.model('NewsArticle', newsArticleSchema);
