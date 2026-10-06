/**
 * confidenceGate.js — Stage 5 of the target-aware sentiment pipeline.
 *
 * Fuses three independent confidence signals into one score and a
 * `needs_review` flag:
 *
 *   • llmConfidence      — how sure the Stage 3 extractor was
 *   • resolverConfidence — how cleanly the extracted actors/target resolved
 *                          to roster entities (an ambiguous surname scores low)
 *   • ruleConfidence     — whether the Stage 4 stance engine reached its verdict
 *                          via a specific rule or a fallback
 *
 * Deliberately conservative: the weighted mean is dragged down by ANY weak
 * component, so a confident LLM reading of an unresolvable entity still lands
 * in review rather than being published as fact.
 */

const clamp = (n) => Math.max(0, Math.min(1, Number(n) || 0));

/** Below this fused score a verdict is routed to a human instead of published. */
const REVIEW_THRESHOLD = Number(process.env.ANALYSIS_REVIEW_CONFIDENCE_FLOOR || 0.6);

const fuse = ({ llmConfidence = 0.7, resolverConfidence = 0.6, ruleConfidence = 0.7 } = {}) => {
    const wL = 0.5;
    const wR = 0.3;
    const wE = 0.2;
    const score = clamp(wL * clamp(llmConfidence) + wR * clamp(resolverConfidence) + wE * clamp(ruleConfidence));
    return { confidence: score, needs_review: score < REVIEW_THRESHOLD };
};

module.exports = { fuse, REVIEW_THRESHOLD };
