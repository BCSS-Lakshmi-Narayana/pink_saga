/**
 * rssAnalysisService.js — puts RSS / news articles through the SAME
 * target-aware pipeline as Mentions and Alerts.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The Python ingest engine (Blura-Engine) scores every article with its own
 * Cohere prompt and its own rubric ("who politically benefits"), while Mentions
 * and Alerts go through the Node pipeline's ally/opposition stance matrix.
 * Both write a field called `sentiment` with the same three labels — but the
 * labels do NOT mean the same thing across the two collections, so a
 * cross-source dashboard was adding up two different measurements.
 *
 * This service re-scores an article through `analyzeContent`, so `newsarticles`
 * carries the same `political_stance` / `target_sentiment` vocabulary as
 * everything else. The Python engine keeps ownership of INGEST (it writes with
 * `$setOnInsert`, so it never clobbers what we write here).
 *
 * It is intentionally a thin wrapper: no separate prompt, no separate rubric.
 * Any future pipeline fix reaches news automatically.
 */

const NewsArticle = require('../models/NewsArticle');
const { analyzeContent, isAnalysisComplete } = require('./analysisService');

/**
 * Prefer the English rendering when the engine produced one — the pipeline
 * pre-translates anyway, and reusing the stored translation avoids paying for
 * the same translation twice.
 */
const textForArticle = (article) => [
    article.title_english || article.title,
    article.summary_english || article.summary,
    article.content,
]
    .filter(Boolean)
    .join('\n\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);

/** Which camp the tone landed on, derived from the stance. */
const targetAlignmentFromStance = (stance) => {
    if (stance === 'pro_target' || stance === 'anti_target') return 'ally';
    if (stance === 'pro_target_indirect' || stance === 'anti_target_indirect') return 'opposition';
    return 'neutral';
};

/** Risk follows the raw tone — the same bands analysisService uses. */
const RISK_FOR_SENTIMENT = {
    positive: ['low', 15],
    neutral: ['low', 20],
    negative: ['high', 75],
};

/**
 * Map a pipeline result onto the NewsArticle schema.
 *
 * Same display contract as Alerts, Mentions and Grievances:
 *   sentiment  = the article's RAW tone (what the text itself says)
 *   risk       = follows that tone: positive → low 15, neutral → low 20,
 *                negative → high 75
 *   stance     = who it helps, derived from the target (`political_stance`);
 *                `target_sentiment` keeps the client-relative verdict.
 * So a negative article about Congress shows "negative" + "pro client".
 */
const updateFromAnalysis = (analysisData) => {
    const stance = analysisData.political_stance || analysisData.stance || 'unrelated';
    const rawSentiment = analysisData.generic_sentiment || analysisData.sentiment || 'neutral';
    const targetSentiment = analysisData.target_sentiment || 'neutral';
    const [riskLevel, riskScore] = RISK_FOR_SENTIMENT[rawSentiment] || RISK_FOR_SENTIMENT.neutral;

    return {
        sentiment: rawSentiment,
        target_sentiment: targetSentiment,
        generic_sentiment: rawSentiment,
        risk_level: riskLevel,
        risk_score: riskScore,
        target_tone: analysisData.target_tone || analysisData.generic_sentiment || 'neutral',
        political_stance: stance === 'unrelated' ? 'unrelated' : stance,
        sentiment_target: analysisData.target_entity_canonical || analysisData.target_entity || '',
        sentiment_target_alignment: targetAlignmentFromStance(stance),
        // Stage 4's rationale — the one that actually produced the badge. Pass
        // A's `explanation` is a different LLM call and would contradict it.
        sentiment_reasoning: analysisData.political_reasoning || analysisData.explanation || '',
        emotion: analysisData.emotion || 'neutral',
        confidence: analysisData.confidence || {},
        validation: analysisData.validation || null,
        validation_status: analysisData.validation_status || 'passed',
        needs_review: !!analysisData.needs_review,
        review_reason: analysisData.review_reason || '',
        client_relevance: analysisData.client_relevance || 'uncertain',
        target: analysisData.target || 'unknown',
        // Campaign taxonomy, same vocabulary as Grievance.analysis.topic. This is
        // an explicit $set through updateOne, so a field the pipeline produced but
        // this object omits would be dropped by strict mode without erroring.
        campaign_topic: analysisData.topic || null,
        campaign_topic_taxonomy_version: analysisData.topic_taxonomy_version || null,
        pipeline_analysis: analysisData.llm_analysis || null,
        pipeline_analyzed_at: new Date(),
    };
};

/**
 * Re-score one article.
 *
 * @param {object}  article        a NewsArticle document (lean or hydrated)
 * @param {boolean} options.write  persist the result (default true)
 * @param {boolean} options.force  re-analyse even if manually corrected
 * @returns {Promise<{analysisData, update}|null>} null when there is no text
 */
const analyzeArticle = async (article, { write = true, force = false } = {}) => {
    const text = textForArticle(article);
    if (!text) return null;

    // A human correction outranks the model. `PATCH /api/news/:id/sentiment`
    // sets this; without the guard a bulk re-run would silently undo every
    // manual fix an operator has made.
    if (!force && article.manual_sentiment_override) {
        return null;
    }

    const analysisData = await analyzeContent(text, {
        platform: 'news',
        skipForensics: true,
        taggedKeyword: (article.keywords_matched || []).join(' '),
        // News has no social author. The publication is the closest analogue,
        // and it will not resolve to the roster, so `author_alignment` stays
        // null — which the stance engine treats as "unknown" and ignores.
        authorHandle: article.source_name || article.source_domain || '',
    });

    // Incomplete (model failed / fell back): no verdict is written and
    // pipeline_analyzed_at stays null, so the scorer retries it (bounded by
    // pipeline_attempts) and the news gate keeps it hidden meanwhile.
    if (!isAnalysisComplete(analysisData)) {
        if (write) {
            await NewsArticle.updateOne({ _id: article._id }, {
                $inc: { pipeline_attempts: 1 },
                $set: { pipeline_last_error: ((analysisData?.analysis_incomplete_reasons || []).join(',') || 'incomplete').slice(0, 300) },
            });
        }
        return null;
    }

    const update = updateFromAnalysis(analysisData);
    if (write) {
        await NewsArticle.updateOne({ _id: article._id }, { $set: update });
    }
    return { analysisData, update };
};

/**
 * Re-score a batch of articles, newest first.
 * Sequential on purpose: each item costs LLM calls, and the provider layer is
 * shared with live ingestion.
 */
const analyzeArticles = async (filter = {}, { limit = 100, write = true, force = false } = {}) => {
    const articles = await NewsArticle.find(filter)
        .sort({ published_date: -1 })
        .limit(limit)
        .lean();

    const results = { total: articles.length, analyzed: 0, skipped: 0, failed: 0, changed: 0 };

    for (const article of articles) {
        try {
            const before = article.sentiment;
            const res = await analyzeArticle(article, { write, force });
            if (!res) { results.skipped += 1; continue; }
            results.analyzed += 1;
            if (res.update.sentiment !== before) results.changed += 1;
        } catch (err) {
            results.failed += 1;
            console.warn(`[rssAnalysis] Failed for ${article._id}: ${err.message}`);
        }
    }

    return results;
};

module.exports = {
    analyzeArticle,
    analyzeArticles,
    textForArticle,
    updateFromAnalysis,
    targetAlignmentFromStance,
    RISK_FOR_SENTIMENT,
};
