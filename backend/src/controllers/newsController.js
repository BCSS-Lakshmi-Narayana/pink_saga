const mongoose = require('mongoose');
const NewsArticle = require('../models/NewsArticle');
const ConstituencyMaster = require('../models/ConstituencyMaster');
const { MOJIBAKE_SIGNATURE } = require('../utils/textEncoding');
// Withholds articles still being scored — see config/displayGate.js.
const { newsGate, applyGate } = require('../config/displayGate');
const { RISK_FOR_SENTIMENT } = require('../services/rssAnalysisService');

const escapeRx = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Sentiment filtering for the articles feed.
 *
 * The filter must select exactly what the CARD prints, or picking "Negative"
 * hides articles showing a NEGATIVE pill. On this deployment the card resolves
 * its badge from ONE field — `article.sentiment` (components/grievances/
 * RssNewsCard.jsx) — so that is the only field queried here.
 *
 * (The sibling KK deployment resolves `client_sentiment` first and falls back
 * to `sentiment`; its card does the same. Copying that precedence here would
 * make the filter disagree with this card, so it is deliberately not copied.)
 *
 * Spellings are expanded because the field has accumulated legacy values —
 * 'moderate' is the retired name of 'neutral' and older rows carry it — so the query
 * folds them the same way the UI groups them.
 */
const SENTIMENT_SPELLINGS = {
  positive: ['positive'],
  negative: ['negative'],
  neutral: ['neutral', 'moderate'],
};

const canonicalSentimentValue = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  return Object.keys(SENTIMENT_SPELLINGS).find((k) => SENTIMENT_SPELLINGS[k].includes(v)) || null;
};

/** A clause matching the sentiment the CARD would display, or null. */
const newsSentimentClause = (value) => {
  const wanted = canonicalSentimentValue(value);
  if (!wanted) return null;
  return { sentiment: { $in: SENTIMENT_SPELLINGS[wanted] } };
};

/**
 * STANCE toward the government, which is NOT the same thing as `sentiment`.
 * `sentiment` is the raw tone of the report and defaults to 'neutral', so it
 * reads as neutral on every article rssAnalysisService has not scored yet.
 * The client-relative verdict lives on `political_stance`, using the same
 * vocabulary as mentions and alerts (lib/sentiment.js).
 *
 * Used by the CM brief's evidence links: a drill-down must return the same
 * rows the figure was counted from, which raw sentiment would not.
 */
const NEWS_STANCE_VALUES = {
  supportive: ['pro_target', 'pro_target_indirect'],
  opposing: ['anti_target', 'anti_target_indirect'],
  neutral: ['neutral'],
  unrelated: ['unrelated'],
};
const newsStanceClause = (value) => {
  const wanted = NEWS_STANCE_VALUES[String(value || '').toLowerCase()];
  if (!wanted) return null;
  return { political_stance: { $in: wanted } };
};

/**
 * A 'YYYY-MM-DD' bound is a calendar day with no timezone, so it anchors to
 * that day in UTC; a full ISO timestamp is an exact instant the browser already
 * resolved and is honoured verbatim. The end bound used to be snapped with
 * `setHours`, i.e. to the SERVER's local day, so the window moved with wherever
 * the process happened to be running.
 */
const ARTICLE_DATE_ONLY_RX = /^\d{4}-\d{2}-\d{2}$/;

const parseArticleDateBound = (value, { end = false } = {}) => {
  const raw = String(value).trim();
  const date = new Date(raw);
  if (isNaN(date.getTime())) return undefined;
  if (ARTICLE_DATE_ONLY_RX.test(raw)) {
    if (end) date.setUTCHours(23, 59, 59, 999);
    else date.setUTCHours(0, 0, 0, 0);
  }
  return date;
};

// RSS ingestion doesn't run articles through mojibakeGuardPlugin, so a bad feed
// can leave text carrying the raw mojibake signature permanently. That's not
// repairable after the fact (bytes are already lost), so exclude it from every
// view instead of showing garbled text.
const MOJIBAKE_RX = { $regex: MOJIBAKE_SIGNATURE.source };
const NOT_MOJIBAKE_NOR = [
  { content: MOJIBAKE_RX },
  { summary: MOJIBAKE_RX },
  { summary_english: MOJIBAKE_RX },
  { title: MOJIBAKE_RX },
  { title_english: MOJIBAKE_RX },
];

// Build the constituency $or fragment for a scoped MLA/MP. Returns null when the
// caller can see everything (super admin / party leadership / legacy roles) and
// an impossible match when a scoped user has no seats assigned.
const buildNewsScopeOr = (scope) => {
  if (!scope || scope.canSeeAll) return null;
  const seats = scope.constituencies || [];
  if (seats.length === 0) return false;
  const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const seatRx = new RegExp(`(${seats.map(escape).join('|')})`, 'i');
  return [
    { title: seatRx },
    { title_english: seatRx },
    { summary: seatRx },
    { summary_english: seatRx },
    { keywords_matched: seatRx },
    { 'detected_location.city': seatRx },
    { 'detected_location.district': seatRx },
  ];
};

exports.getArticles = async (req, res) => {
  try {
    const {
      page        = 1,
      limit       = 20,
      search,
      district,
      category,
      source_type,
      language,
      sentiment,
      stance,
      source,
      startDate,
      endDate,
    } = req.query;

    // Never show articles from these domains in the UI
    const EXCLUDED_DOMAINS = ['indianexpress.com', 'news.google.com'];
    const filter = { source_domain: { $nin: EXCLUDED_DOMAINS }, $nor: NOT_MOJIBAKE_NOR };

    // Articles the Node pipeline judged NOT relevant to the client (sport, markets, out-of-state crime that
    // a whole-site feed let in) are kept in the database but never listed. `$ne` also keeps articles that
    // have no verdict yet; those are held back by the display gate below until they are scored.
    filter.client_relevance = { $ne: 'not_relevant' };

    // RBAC: scoped MLAs / MPs only see news that mentions their seat name
    // anywhere in the article (title, summary, matched keywords, detected
    // location). Super admin / party leadership pass through.
    const scopeOr = buildNewsScopeOr(req.scope);
    if (scopeOr === false) {
      return res.json({ articles: [], pagination: { page: 1, pages: 0, total: 0, limit: 0 } });
    }
    if (scopeOr) {
      filter.$and = [{ $or: scopeOr }];
    }

    if (search) {
      const rx = new RegExp(search, 'i');
      const searchOr = [
        { title: rx },
        { title_english: rx },
        { summary: rx },
        { summary_english: rx },
        { source_name: rx },
        { keywords_matched: rx },
      ];
      // Merge with the scope $and instead of clobbering it.
      filter.$and = (filter.$and || []).concat([{ $or: searchOr }]);
    }

    if (district && district !== 'all') {
      filter['detected_location.district'] = district;
    }
    if (category && category !== 'all') {
      filter.category = category;
    }
    if (source_type && source_type !== 'all') {
      filter.source_type = source_type;
    }
    /**
     * The outlet that PUBLISHED the article. `search` above also matches
     * source_name, but it matches titles and keywords too, so it cannot be
     * used to isolate one outlet — the CM brief's media list links here and
     * must land on exactly the articles it counted. Anchored so
     * "Sakshi" does not also pull "Sakshi Post" or "Sakshi TV".
     */
    if (source && source !== 'all') {
      const escaped = String(source).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.source_name = new RegExp(`^${escaped}$`, 'i');
    }
    if (language && language !== 'all') {
      filter.language = language;
    }

    // Appended to `$and` rather than assigned, so it composes with the RBAC
    // scope and search clauses above instead of replacing them.
    if (sentiment && sentiment !== 'all') {
      const clause = newsSentimentClause(sentiment);
      if (clause) filter.$and = (filter.$and || []).concat([clause]);
    }

    // Stance toward the government — what the CM brief counts and what its
    // evidence links drill into. Composes with everything above.
    if (stance && stance !== 'all') {
      const clause = newsStanceClause(stance);
      if (clause) filter.$and = (filter.$and || []).concat([clause]);
    }

    if (startDate || endDate) {
      filter.published_date = {};
      if (startDate) {
        filter.published_date.$gte = parseArticleDateBound(startDate);
      }
      if (endDate) {
        filter.published_date.$lte = parseArticleDateBound(endDate, { end: true });
      }
    }

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * limitNum;

    // Withhold articles the Node pipeline has not scored yet, so a card never
    // appears with the Python engine's sentiment and no stance, then changes when
    // the RSS scorer reaches it. Gates the count too, or pagination overstates.
    const gatedFilter = applyGate(filter, newsGate());

    const [articles, total] = await Promise.all([
      NewsArticle.find(gatedFilter).sort({ published_date: -1 }).skip(skip).limit(limitNum).lean(),
      NewsArticle.countDocuments(gatedFilter),
    ]);

    res.json({
      articles,
      pagination: {
        page:  pageNum,
        pages: Math.ceil(total / limitNum),
        total,
        limit: limitNum,
      },
    });
  } catch (err) {
    console.error('[NewsController] getArticles error:', err);
    res.status(500).json({ message: 'Failed to fetch news articles' });
  }
};

/* GET /api/news/constituency/:constituency — district news for the district a
 * constituency belongs to. Resolves AC -> district via ConstituencyMaster,
 * then returns articles tagged to that district (newest first). Powers the
 * "District News" panel on the constituency page. */
exports.getConstituencyDistrictNews = async (req, res) => {
  try {
    const decoded = decodeURIComponent(req.params.constituency || '');
    const key = ConstituencyMaster.normKey(decoded);

    // RBAC: a scoped MLA/MP can only pull their own seat's district.
    const scope = req.scope;
    if (scope && !scope.canSeeAll) {
      const allowed = new Set((scope.constituencies || []).map(ConstituencyMaster.normKey));
      if (!allowed.has(key)) {
        return res.status(403).json({ success: false, message: 'Not authorized for this constituency' });
      }
    }

    const ac = await ConstituencyMaster.findOne({ ac_key: key }).select('ac_name district').lean();
    const district = ac && ac.district ? ac.district : null;

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '12', 10)));

    if (!district) {
      return res.json({
        success: true, constituency: decoded, district: null,
        outlets: [], activeSource: null,
        articles: [], pagination: { page: 1, pages: 0, total: 0, limit },
      });
    }

    const EXCLUDED_DOMAINS = ['indianexpress.com', 'news.google.com'];
    const districtFilter = {
      source_domain: { $nin: EXCLUDED_DOMAINS },
      'detected_location.district': new RegExp(`^${escapeRx(district)}$`, 'i'),
      $nor: NOT_MOJIBAKE_NOR,
    };
    if (req.query.language && req.query.language !== 'all') districtFilter.language = req.query.language;

    // Per-outlet breakdown across the whole district (independent of the source
    // filter below) so the summary always lists every paper — this is the
    // "which newspaper is covering us" view; click an outlet to see its articles.
    const outletsAgg = await NewsArticle.aggregate([
      { $match: districtFilter },
      {
        $group: {
          _id: '$source_name',
          count: { $sum: 1 },
          latest: { $max: '$published_date' },
          positive: { $sum: { $cond: [{ $eq: ['$sentiment', 'positive'] }, 1, 0] } },
          negative: { $sum: { $cond: [{ $eq: ['$sentiment', 'negative'] }, 1, 0] } },
          // Everything that isn't explicitly positive/negative — neutral,
          // the retired 'moderate', or not-yet-scored — buckets as neutral.
          neutral: { $sum: { $cond: [{ $in: ['$sentiment', ['positive', 'negative']] }, 0, 1] } },
        },
      },
      { $sort: { count: -1 } },
    ]);
    const outlets = outletsAgg
      .filter((o) => o._id)
      .map((o) => ({
        source_name: o._id,
        count: o.count,
        latest: o.latest,
        positive: o.positive,
        negative: o.negative,
        neutral: o.neutral,
        moderate: o.neutral, // retired key
      }));

    // Article list — optionally narrowed to one outlet (the "proof" on click).
    const activeSource = String(req.query.source || '').trim();
    const articleFilter = { ...districtFilter };
    if (activeSource && activeSource !== 'all') {
      articleFilter.source_name = new RegExp(`^${escapeRx(activeSource)}$`, 'i');
    }

    const skip = (page - 1) * limit;
    const [articles, total] = await Promise.all([
      NewsArticle.find(articleFilter).sort({ published_date: -1 }).skip(skip).limit(limit).lean(),
      NewsArticle.countDocuments(articleFilter),
    ]);

    res.json({
      success: true,
      constituency: ac.ac_name || decoded,
      district,
      outlets,
      activeSource: activeSource && activeSource !== 'all' ? activeSource : null,
      articles,
      pagination: { page, pages: Math.ceil(total / limit), total, limit },
    });
  } catch (err) {
    console.error('[NewsController] getConstituencyDistrictNews error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch district news' });
  }
};

// Admin-only mutations on a single article — mirrors the Mentions/Alerts flow
// (UI gated to the grievance-admin email; deleting here removes the article
// from every view, incl. the District News panel, since all read `newsarticles`).
const NEWS_ADMIN_EMAIL = 'sreenu@gmail.com';
const isNewsAdmin = (req) => {
  const u = req.user || {};
  const email = String(u.email || '').trim().toLowerCase();
  if (email === NEWS_ADMIN_EMAIL) return true;
  const role = String(u.role || '').trim().toLowerCase();
  return u.is_super_admin === true || role === 'superadmin' || role === 'super_admin';
};

/* PATCH /api/news/:id/sentiment — set an article's sentiment. */
exports.updateArticleSentiment = async (req, res) => {
  try {
    if (!isNewsAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid article id' });
    }
    let sentiment = String(req.body.sentiment || '').toLowerCase();
    if (sentiment === 'moderate') sentiment = 'neutral';
    if (!['positive', 'negative', 'neutral'].includes(sentiment)) {
      return res.status(400).json({ success: false, message: 'Invalid sentiment' });
    }
    /**
     * Same rule as the Alert override: `sentiment` is the article's RAW tone,
     * so a correction changes the tone and the risk that follows it — never
     * the stance, which is derived from who the article is about.
     *
     * `manual_sentiment_override` marks the record so a bulk re-analysis
     * (rssAnalysisService) skips it instead of silently undoing the correction.
     */
    const [riskLevel, riskScore] = RISK_FOR_SENTIMENT[sentiment];

    const doc = await NewsArticle.findByIdAndUpdate(
      id,
      {
        $set: {
          sentiment,
          generic_sentiment: sentiment,
          risk_level: riskLevel,
          risk_score: riskScore,
          needs_review: false,
          validation_status: 'passed',
          review_reason: '',
          manual_sentiment_override: true,
        },
      },
      { new: true },
    ).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Article not found' });
    return res.json({ success: true, id, sentiment, risk_level: riskLevel, risk_score: riskScore, political_stance: doc.political_stance });
  } catch (err) {
    console.error('[NewsController] updateArticleSentiment error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update sentiment' });
  }
};

/* DELETE /api/news/:id — permanently remove an article. */
exports.deleteArticle = async (req, res) => {
  try {
    if (!isNewsAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid article id' });
    }
    const result = await NewsArticle.deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }
    return res.json({ success: true, deleted: id });
  } catch (err) {
    console.error('[NewsController] deleteArticle error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete article' });
  }
};

exports.getStats = async (req, res) => {
  try {
    const scopeOr = buildNewsScopeOr(req.scope);
    if (scopeOr === false) {
      return res.json({ total: 0, byCategory: [], byLanguage: [], bySourceType: [] });
    }
    const matchStage = scopeOr ? [{ $match: { $or: scopeOr } }] : [];
    const countFilter = scopeOr ? { $or: scopeOr } : {};

    const [total, byCategory, byLanguage, bySourceType, byDistrict] = await Promise.all([
      NewsArticle.countDocuments(countFilter),
      NewsArticle.aggregate([...matchStage, { $match: { category: { $nin: [null, ''] } } }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      NewsArticle.aggregate([...matchStage, { $group: { _id: '$language', count: { $sum: 1 } } }]),
      NewsArticle.aggregate([...matchStage, { $group: { _id: '$source_type', count: { $sum: 1 } } }]),
      // Districts actually present in the scraped articles — powers the filter
      // dropdown dynamically instead of a hard-coded list.
      NewsArticle.aggregate([...matchStage, { $match: { 'detected_location.district': { $nin: [null, ''] } } }, { $group: { _id: '$detected_location.district', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    ]);
    res.json({ total, byCategory, byLanguage, bySourceType, byDistrict });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch news stats' });
  }
};

exports.getRssKeywords = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const col = mongoose.connection.db.collection('rsskeywords');
    const metaCol = mongoose.connection.db.collection('rsskeywords_meta');

    const defaultKeywordsList = [
      // Full names only: bare 'sai', 'sao' or 'baghel' match thousands of
      // unrelated people; bare भाजपा / कांग्रेस pull in every other state's politics.
      // ── our leadership ──
      'kcr', 'k chandrashekar rao', 'chandrashekar rao', 'ktr', 'k t rama rao',
      'harish rao', 'brs', 'bharat rashtra samithi',
      // ── the government ──
      'revanth reddy', 'telangana cm', 'bhatti vikramarka', 'uttam kumar reddy',
      'sridhar babu', 'telangana congress', 'tpcc',
      // ── rivals ──
      'telangana bjp', 'kishan reddy', 'bandi sanjay', 'eatala rajender',
      'aimim', 'asaduddin owaisi', 'akbaruddin owaisi', 'raja singh',
      'kavitha', 'telangana rakshana sena',
      // ── institutions and process ──
      'telangana politics', 'telangana government', 'telangana assembly', 'telangana cabinet',
      'khairatabad by-election', 'telangana by-poll', 'electoral roll revision',
      // ── live issues ──
      'kaleshwaram', 'medigadda', 'phone tapping', 'formula e', 'dharani', 'bhu bharati',
      'rythu bandhu', 'rythu bharosa', 'dalit bandhu', 'mission bhagiratha',
      'indiramma indlu', 'gruha jyothi', 'hydraa', 'musi riverfront',
      'bc reservation telangana', 'loan waiver telangana', 'tgpsc', 'paper leak',
      // ── places ──
      'hyderabad', 'secunderabad', 'warangal', 'karimnagar', 'nizamabad', 'khammam',
      'nalgonda', 'siddipet', 'gajwel', 'sircilla',
      // ── Telugu ──
      'కేసీఆర్', 'కేటీఆర్', 'బీఆర్ఎస్', 'రేవంత్ రెడ్డి', 'తెలంగాణ', 'కాళేశ్వరం', 'రైతు భరోసా', 'ధరణి'
    ];

    // One-time bootstrap ONLY. Previously this default list was merged back in
    // on every fetch, so deleting a default keyword had no effect \u2014 the very
    // next load re-inserted it (which is why deleted chips kept reappearing at
    // the end). Keywords are now fully DB-managed: we seed this starter set
    // exactly once, and only into a brand-new (empty) collection. A persistent
    // marker makes the seed idempotent, so even clearing every keyword will not
    // resurrect the defaults.
    const seedMarker = await metaCol.findOne({ _id: 'seed' });
    if (!seedMarker) {
      const existingCount = await col.countDocuments();
      if (existingCount === 0) {
        const seededAt = new Date();
        const seedDocs = defaultKeywordsList.map((kw) => {
          const cleanKw = kw.toLowerCase().trim();
          // Devanagari terms are seeded as Hindi, the language with RSS coverage
          // (Google News has a Telugu edition: hl=te).
          const isDevanagari = /[\u0900-\u097F]/.test(cleanKw);
          return {
            keyword: cleanKw,
            language: isDevanagari ? 'hi' : 'en',
            is_active: true,
            created_at: seededAt,
          };
        });
        if (seedDocs.length > 0) await col.insertMany(seedDocs);
      }
      // Mark seeding as done regardless of whether the collection was empty, so
      // a DB that already had keywords is never re-seeded on later requests.
      await metaCol.updateOne(
        { _id: 'seed' },
        { $set: { seeded: true, seeded_at: new Date() } },
        { upsert: true }
      );
    }

    const keywords = await col.find({}).sort({ created_at: 1 }).toArray();
    res.json(keywords);
  } catch (err) {
    console.error('[NewsController] getRssKeywords error:', err);
    res.status(500).json({ message: 'Failed to fetch RSS keywords' });
  }
};

exports.addRssKeyword = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const { keyword, language } = req.body;

    // Accept one keyword or a comma-separated list ("kcr, kaleshwaram, dharani"):
    // split, normalise, drop blanks and in-request duplicates.
    const requested = [...new Set(
      String(keyword || '')
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
    )];
    if (!requested.length) {
      return res.status(400).json({ message: 'Keyword is required' });
    }

    const col = mongoose.connection.db.collection('rsskeywords');
    const langCol = mongoose.connection.db.collection('rsslanguages');

    // Accept any configured language code (not just en/mr). Validate against the
    // languages collection so a keyword can never be filed under a bucket that
    // doesn't exist; fall back to the first available language otherwise.
    let lang = (language || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (lang) {
      const known = await langCol.findOne({ code: lang });
      if (!known) lang = '';
    }
    if (!lang) {
      const [first] = await langCol.find({}).sort({ created_at: 1 }).limit(1).toArray();
      lang = first?.code || 'en';
    }

    // Skip keywords that already exist (in any language) so we never duplicate.
    const existingDocs = await col.find({ keyword: { $in: requested } }).project({ keyword: 1 }).toArray();
    const existing = new Set(existingDocs.map((d) => d.keyword));
    const toInsert = requested
      .filter((k) => !existing.has(k))
      .map((k) => ({ keyword: k, language: lang, is_active: true, created_at: new Date() }));

    if (toInsert.length) {
      await col.insertMany(toInsert);
    }

    return res.status(201).json({
      added: toInsert.length,
      skipped: requested.length - toInsert.length,
      keywords: toInsert.map((d) => d.keyword),
    });
  } catch (err) {
    console.error('[NewsController] addRssKeyword error:', err);
    res.status(500).json({ message: 'Failed to add RSS keyword' });
  }
};

exports.deleteRssKeyword = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const { keyword } = req.params;
    if (!keyword) {
      return res.status(400).json({ message: 'Keyword is required' });
    }
    const col = mongoose.connection.db.collection('rsskeywords');
    await col.deleteOne({ keyword: keyword.toLowerCase().trim() });
    res.json({ message: 'Keyword deleted successfully' });
  } catch (err) {
    console.error('[NewsController] deleteRssKeyword error:', err);
    res.status(500).json({ message: 'Failed to delete RSS keyword' });
  }
};

// ── RSS keyword languages (fully DB-managed, like the keywords themselves) ──
// Each keyword carries a `language` code; these docs define the set of language
// buckets the UI offers and renders. Shape: { code, label, is_active, created_at }.

exports.getRssLanguages = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const col = mongoose.connection.db.collection('rsslanguages');
    const metaCol = mongoose.connection.db.collection('rsslanguages_meta');

    // One-time bootstrap of the languages the system ships
    // with. Same idempotent-marker pattern as keywords: seed once into an empty
    // collection, then never re-add — so deleting a language is permanent.
    const seedMarker = await metaCol.findOne({ _id: 'seed' });
    if (!seedMarker) {
      const existingCount = await col.countDocuments();
      if (existingCount === 0) {
        const seededAt = new Date();
        await col.insertMany([
          { code: 'en', label: 'English', is_active: true, created_at: seededAt },
          { code: 'hi', label: 'Hindi', is_active: true, created_at: new Date(seededAt.getTime() + 1) },
        ]);
      }
      await metaCol.updateOne(
        { _id: 'seed' },
        { $set: { seeded: true, seeded_at: new Date() } },
        { upsert: true }
      );
    }

    const languages = await col.find({}).sort({ created_at: 1 }).toArray();
    res.json(languages);
  } catch (err) {
    console.error('[NewsController] getRssLanguages error:', err);
    res.status(500).json({ message: 'Failed to fetch languages' });
  }
};

exports.addRssLanguage = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const name = (req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ message: 'Language name is required' });
    }

    // The code is the identifier stored on each keyword (k.language), so it must
    // be stable, lowercase and space-free. Use an explicit code if given, else
    // derive one from the name.
    let cleanCode = (req.body.code || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!cleanCode) {
      cleanCode = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
    }
    if (!cleanCode) {
      return res.status(400).json({ message: 'Could not derive a language code — please provide one (e.g. "hi").' });
    }

    const col = mongoose.connection.db.collection('rsslanguages');
    const existing = await col.findOne({ code: cleanCode });
    if (existing) {
      return res.status(409).json({ message: 'A language with this code already exists' });
    }

    const doc = { code: cleanCode, label: name, is_active: true, created_at: new Date() };
    await col.insertOne(doc);
    res.status(201).json(doc);
  } catch (err) {
    console.error('[NewsController] addRssLanguage error:', err);
    res.status(500).json({ message: 'Failed to add language' });
  }
};

exports.deleteRssLanguage = async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const code = (req.params.code || '').trim().toLowerCase();
    if (!code) {
      return res.status(400).json({ message: 'Language code is required' });
    }

    const langCol = mongoose.connection.db.collection('rsslanguages');
    const kwCol = mongoose.connection.db.collection('rsskeywords');

    await langCol.deleteOne({ code });
    // Cascade: remove keywords filed under this language so none are left
    // orphaned under a language bucket that no longer exists.
    const kwResult = await kwCol.deleteMany({ language: code });
    res.json({ message: 'Language deleted successfully', keywordsRemoved: kwResult.deletedCount || 0 });
  } catch (err) {
    console.error('[NewsController] deleteRssLanguage error:', err);
    res.status(500).json({ message: 'Failed to delete language' });
  }
};
