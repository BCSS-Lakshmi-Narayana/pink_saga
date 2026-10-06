/**
 * liveChatCanonicalAnalyzer.js
 *
 * Thin adapter between YouTube Live chat messages and the ONE canonical client-axis
 * analysis engine (analysisService.analyzeContent). Holds no sentiment,
 * stance, risk, or political logic of its own — that all lives in
 * analysisService.js / llmService.js / politicalSentimentService.js /
 * stanceEngine.js / confidenceGate.js, unchanged, shared with Grievances and
 * every other content type. If that pipeline changes tomorrow (prompt,
 * model, provider, parsing, business rules), YouTube Live picks it up on the
 * next call automatically — this file has nothing to update.
 *
 * The one thing this file DOES own: guaranteeing RapidAPI is never reached
 * for a YouTube-live-originated call, via llmProvider.withForcedProvider,
 * and translating analyzeContent()'s three possible outcome shapes into a
 * simple ok/fail verdict so the caller never has to guess whether a result
 * is real.
 */

const { withForcedProvider } = require('./llmProvider');
const { analyzeContent, isAnalysisComplete } = require('./analysisService');

// The canonical engine's own enums (analysisService.js / politicalSentimentService.js).
// Checked by VALUE, not just key presence — a present-but-null/empty field
// must be rejected exactly the same as an absent one. needs_review is
// checked separately (typeof === 'boolean') because `false` is a genuinely
// valid, meaningful value there, not an absence.
const VALID_SENTIMENTS = ['positive', 'negative', 'neutral'];
const VALID_RISK_LEVELS = ['low', 'medium', 'high'];

/**
 * True only when the result carries a real, usable verdict for every field
 * the UI shows as final. This is the ONLY gate between "canonical engine
 * responded" and "safe to mark analysis_status: complete" — nothing
 * downstream of this check is allowed to substitute a default.
 */
function isValidCanonicalResult(result) {
  if (!result) return false;
  // Same completeness rule as alerts and mentions: a Pass-A failure or a
  // keyword-fallback stance is not a verdict — it is retried, not shown.
  if (!isAnalysisComplete(result)) return false;
  if (!VALID_SENTIMENTS.includes(result.sentiment)) return false;
  if (typeof result.stance !== 'string' || result.stance.length === 0) return false;
  if (!VALID_RISK_LEVELS.includes(result.risk_level)) return false;
  if (typeof result.needs_review !== 'boolean') return false;
  return true;
}

/**
 * Runs one comment through the canonical engine, Ollama-only.
 * analyzeContent() itself never throws for a normal LLM failure — it
 * degrades (political_provider:'fallback', analysis_complete:false). Such a
 * degraded result is ok:false here, exactly like a missing field or an
 * exception, so the caller retries it (bounded) and never marks it
 * 'complete'.
 */
async function analyzeLiveComment(text) {
  try {
    const result = await withForcedProvider('ollama', () =>
      analyzeContent(text, { platform: 'youtube_live', skipForensics: true })
    );
    if (!isValidCanonicalResult(result)) {
      return { ok: false, reason: (result && result.explanation) || 'canonical_engine_incomplete_result' };
    }
    return { ok: true, result };
  } catch (err) {
    return { ok: false, reason: `error: ${err.message}` };
  }
}

/**
 * Maps a real, already-validated canonical result onto LiveChatMessage
 * fields — same shape of function as
 * grievanceService.buildGrievanceAnalysisUpdate(), kept deliberately
 * parallel to it. Only ever called after isValidCanonicalResult() has
 * passed, so sentiment/stance/risk_level/needs_review are assigned
 * directly — NO fallback defaults on these four fields, ever. A missing or
 * invalid required field must fail analyzeLiveComment() above, not get
 * silently defaulted here.
 */
function buildLiveChatAnalysisUpdate(result) {
  return {
    sentiment: result.sentiment,
    stance: result.stance,
    risk_level: result.risk_level,
    needs_review: result.needs_review,
    // Supplementary metadata only — absence here is represented honestly
    // (empty string / null / empty array), never guessed.
    review_reason: typeof result.review_reason === 'string' ? result.review_reason : '',
    confidence: result.confidence && typeof result.confidence.overall === 'number' ? result.confidence.overall : null,
    target_entity: result.target_entity || null,
    // mentioned_entities is an array of roster objects ({key, canonical,
    // alignment, ...}); LiveChatMessage.matched_entities is a string array
    // (same convention as the old analyzeFast() lexicon fields) — reduce to names.
    matched_entities: Array.isArray(result.mentioned_entities)
      ? result.mentioned_entities.map((e) => (e && (e.canonical || e.key)) || null).filter(Boolean)
      : [],
    analysis_provider: result.political_provider || 'llm',
    analysis_reason: result.explanation || result.political_reasoning || null,
    analysis_details: result,
    analysis_status: 'complete',
    analysis_completed_at: new Date(),
  };
}

module.exports = { analyzeLiveComment, buildLiveChatAnalysisUpdate, isValidCanonicalResult };
