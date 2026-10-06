require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const { categorizeText } = require('./llmService');
const mappingService = require('./mappingService');
const { buildPoliticalContext, detectLanguageHints } = require('./politicalContextService');
const { analyzePoliticalSentiment } = require('./politicalSentimentService');
// Owns the STAGE3_INCLUDE_ORIGINAL switch. Inert unless that flag is 'true'.
const { buildStage3Input } = require('./stage3Input');
const cacheService = require('./cacheService');
const translationService = require('./translationService');
const LegalSection = require('../models/LegalSection');
const PlatformPolicy = require('../models/PlatformPolicy');

// Identical (or near-identical, whitespace-collapsed) text — reposts, RTs,
// the same article picked up by multiple keyword sweeps — reuses the prior
// LLM verdict instead of re-spending Pass A + Stage 4 tokens on it.
const TEXT_ANALYSIS_CACHE_TTL_SECONDS = Number(process.env.ANALYSIS_TEXT_CACHE_TTL_SECONDS || 7 * 24 * 60 * 60);
const ANALYSIS_REVIEW_CONFIDENCE_FLOOR = Number(process.env.ANALYSIS_REVIEW_CONFIDENCE_FLOOR || 0.6);
const textAnalysisCacheKey = (text, authorHandle = '') => {
  // Links are dropped: the same post re-shared with a different t.co link
  // must get the SAME verdict, not a fresh (and possibly different) one.
  const normalized = String(text || '').replace(/https?:\/\/\S+/g, ' ').trim().replace(/\s+/g, ' ');
  // The verdict depends on WHO posted (author-is-target correction, cross-camp
  // prior), so the same text from a different author is a different entry.
  const author = String(authorHandle || '').trim().replace(/^@+/, '').toLowerCase();
  const hash = crypto.createHash('sha256').update(`${author}|${normalized}`).digest('hex');
  // v2: the cached object's SHAPE changed with the target-aware rewrite (it now
  // carries target_sentiment / target_tone / validation / needs_review). Bumping
  // the key namespace retires v1 entries instead of serving verdicts that are
  // missing every new field.
  return `analysis:text:v13:${hash}`;
};

const clamp01 = (n, fallback = 0) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
};

const normalizeSentiment = (s) => {
  const v = String(s || '').toLowerCase().trim();
  if (v === 'moderate') return 'neutral'; // retired label
  if (['positive', 'negative', 'neutral'].includes(v)) return v;
  return 'neutral';
};

/**
 * Stage 5 output surface: a per-dimension confidence bag, a validation record,
 * and the blocking `needs_review` decision.
 *
 * The subtle part is what a Pass-A/Stage-4 sentiment DISAGREEMENT means, which
 * depends on whether Pass A had identified a side:
 *
 *   • target_party OUR_GROUP/OPPOSITION → Pass A applied its own client-relative
 *     matrix, so two independent CLIENT-RELATIVE verdicts now contradict each
 *     other. One of them is wrong about whether this post helps or hurts the
 *     client. That is a genuine red flag → block on `client_sentiment_conflict`.
 *
 *   • target_party NEUTRAL/absent → Pass A fell through to raw tone, so we are
 *     comparing generic tone against a client-relative verdict. These are
 *     SUPPOSED to differ (an attack on the opposition is negative in tone and
 *     positive for us) → audit-only warning, never blocking.
 *
 * Absent `target_party` (a cached Pass-A result from before the field existed)
 * is treated as the non-blocking case deliberately: over-flagging would shrink
 * every downstream pool that excludes `needs_review` records.
 */
const buildQualityGate = ({ llmResult, political, finalSentiment }) => {
  const llmSentiment = normalizeSentiment(llmResult?.sentiment);
  const targetSentiment = normalizeSentiment(finalSentiment);

  const passAWasClientRelative = ['OUR_GROUP', 'OPPOSITION'].includes(
    String(llmResult?.target_party || '').toUpperCase()
  );

  // A post the model successfully placed inside the campaign taxonomy is a
  // confidently-topiced post, whatever Stage 2 thought of its political stance.
  const topicFallback = llmResult?.campaign_topic
    ? 0.7
    : (political?.stance === 'unrelated' ? 0.7 : 0.45);
  const confidence = {
    relevance: clamp01(political?.confidence?.relevance, political?.client_relevance === 'uncertain' ? 0.45 : 0.7),
    sentiment: clamp01(political?.confidence?.sentiment, clamp01(llmResult?.confidence?.sentiment, 0.65)),
    stance: clamp01(political?.confidence?.stance, 0.65),
    topic: clamp01(llmResult?.confidence?.topic, topicFallback),
    emotion: clamp01(political?.confidence?.emotion, 0.6),
    classification: clamp01(llmResult?.confidence?.classification, 0.65),
  };
  confidence.overall = Math.min(
    confidence.sentiment,
    confidence.relevance,
    confidence.stance,
    confidence.topic,
    confidence.emotion,
    confidence.classification,
  );

  const sentimentDisagreement = llmSentiment !== targetSentiment;
  const reasons = [];
  const warnings = [];

  // A post that is plainly not about Telangana politics (a festival greeting, a
  // sports update) scores low confidence only because it names no rostered
  // politician. Sending those to human review buried the posts that matter,
  // so the confidence-based reasons apply to political posts only.
  const clearlyNotPolitical = political?.stance === 'unrelated' && political?.client_relevance === 'not_relevant';
  if (!clearlyNotPolitical) {
    // Review is about the VERDICT, so only the dimensions that decide it count.
    // Topic (the AI-campaign grouping; 0.45 whenever a post fits none of the 16
    // campaign topics), emotion and Pass A's category stay in `overall` for
    // display but no longer send a confidently-scored post to review.
    const verdictConfidence = Math.min(confidence.sentiment, confidence.relevance, confidence.stance);
    if (verdictConfidence < ANALYSIS_REVIEW_CONFIDENCE_FLOOR) reasons.push('low_confidence');
    if (political?.client_relevance === 'uncertain') reasons.push('uncertain_client_relevance');
    if (political?.needs_review) reasons.push('stage3_low_confidence');
  }
  // Pass A's sentiment is a rough first read; the deterministic stance engine
  // is authoritative. Pass A most often reports the RAW tone on posts about the
  // opposition ("Congress looted Telangana" = negative) where Stage 4 correctly
  // says positive for the client, so a mismatch there is expected, not a
  // conflict. Only opposite verdicts on a post directly about the client camp
  // (pro_target / anti_target) go to human review.
  const directStance = ['pro_target', 'anti_target'].includes(political?.stance);
  const oppositeVerdicts = (llmSentiment === 'positive' && targetSentiment === 'negative')
    || (llmSentiment === 'negative' && targetSentiment === 'positive');
  if (sentimentDisagreement) {
    if (passAWasClientRelative && directStance && oppositeVerdicts) reasons.push('client_sentiment_conflict');
    else warnings.push('sentiment_disagreement');
  }
  if (political?.provider === 'fallback') reasons.push('llm_fallback');

  return {
    confidence,
    validation: {
      status: reasons.length ? 'needs_review' : 'passed',
      method: 'stage4_deterministic_stance',
      sentiment: {
        pass_a: llmSentiment,
        target_aware: targetSentiment,
        generic: normalizeSentiment(political?.generic_sentiment),
        target_tone: normalizeSentiment(political?.target_tone),
        agrees: !sentimentDisagreement,
      },
      client_relevance: political?.client_relevance || 'uncertain',
      target: political?.target || 'unknown',
      reasons,
      warnings,
    },
    needs_review: reasons.length > 0,
  };
};

/**
 * Advanced Dual-Pass AI Analysis (V5.1)
 * Pass A: RapidAPI ChatGPT-42 LLM for Intent & Categorization
 * Pass B: Local Fine-Tuned Model for Legal & Policy Mapping
 * Replaces legacy Toxicity and Distilbert models.
 * Pass D: Standalone Deepfake Forensics (S3-First, Async)
 */

/**
 * //
 * Global lock to ensure forensic analyses are processed strictly one-by-one.
 */
let forensicLock = Promise.resolve();

const triggerForensicAnalysis = async (content, analysisId) => {
  const log = (msg) => console.log(`[ForensicLock] ${msg}`);
  const mlServiceUrl = process.env.DEEPFAKE_ML_URL || 'http://localhost:8001';

  // Entry into sequential queue
  return forensicLock = forensicLock.then(async () => {
    try {
      log(`Acquired lock for Analysis: ${analysisId}`);
      let mediaItems = content.media || [];

      // Fallback: If no media items but platform is YouTube/Facebook, use content_url
      if (mediaItems.length === 0 && (content.platform === 'youtube' || content.platform === 'facebook')) {
        const url = content.content_url || content.url;
        if (url) {
          mediaItems = [{ url, type: 'video' }];
        }
      }

      if (mediaItems.length === 0) return null;

      // Prioritize S3 URLs if archived, fallback to platform URL
      const payload = {
        media_items: mediaItems.map(m => ({
          url: m.s3_url || m.video_url || m.url,
          type: m.type === 'video' ? 'video' : 'image'
        }))
      };

      log(`Triggering batch forensics for ${payload.media_items.length} items (Analysis: ${analysisId})`);

      const response = await axios.post(`${mlServiceUrl}/detect/batch`, payload, { timeout: 300000 });
      log(`Forensics Complete for ${analysisId}`);
      return response.data.results || null;

    } catch (err) {
      log(`Forensics Failed for ${analysisId}: ${err.message}`);
      return null;
    } finally {
      log(`Released lock for Analysis: ${analysisId}`);
    }
  });
};

const analyzeContent = async (text, options = {}) => {
  const log = (msg) => console.log(`[AnalysisService] ${msg}`);

  if (!text || !text.trim()) {
    return {
      risk_level: 'low',
      risk_score: 0,
      explanation: 'No text provided.',
      violated_policies: [],
      legal_sections: [],
      triggered_keywords: []
    };
  }

  try {
    // --- CACHE: identical/near-identical text already analyzed (reposts, RTs,
    // the same story ingested via multiple keyword sweeps) ---
    const cacheKey = textAnalysisCacheKey(text, options.authorHandle);
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      log(`Cache hit for text (skipping Pass A + Stage 4 LLM calls): "${text.substring(0, 50)}..."`);
      let forensicResults = null;
      if (!options.skipForensics && options.content && options.analysisId) {
        forensicResults = await triggerForensicAnalysis(options.content, options.analysisId);
      }
      return { ...cached, forensic_results: forensicResults, from_text_cache: true };
    }

    log(`Starting Dual-Pass analysis for: "${text.substring(0, 50)}..."`);

    // --- PRE-TRANSLATION: non-English (native-script) text is translated
    // ONCE here via the existing Google-Translate-backed translationService,
    // and the translated text is what both LLM stages reason over. This
    // replaces asking each LLM stage to silently translate-then-reason
    // in a single inference pass (observed to hallucinate/invert meaning on
    // regional-language text — see Stage 4 cross-check comment below).
    // Entity/language detection (buildPoliticalContext) still runs on the
    // ORIGINAL text — its deterministic alias matching already handles
    // native scripts directly and is more reliable than re-matching against
    // a machine translation of proper nouns.
    let analysisText = text;
    let englishTranslation = '';
    const langHints = detectLanguageHints(text);
    const isNonEnglish = langHints.has_telugu || langHints.has_telugu_roman ||
      langHints.has_hindi || langHints.has_hinglish || langHints.has_tamil ||
      langHints.has_kannada || langHints.has_urdu;
    if (isNonEnglish) {
      try {
        const translated = await translationService.translate(text, 'en', 'auto');
        if (translated && translated.trim()) {
          analysisText = translated;
          englishTranslation = translated;
          log(`Pre-translated non-English text for analysis: "${analysisText.substring(0, 50)}..."`);
        }
      } catch (err) {
        log(`Pre-translation failed (${err.message}); analyzing original text.`);
      }
    }

    // --- PASS A: LLM INTENT ANALYSIS ---
    log("Running Pass A (Primary AI Content Understanding)...");
    let llmResult = await categorizeText(analysisText);
    // Pass A returning nothing means the model call failed. The Normal default
    // below keeps the rest of the pipeline running, but the result is NOT a
    // real analysis — see analysis_complete further down.
    const passAFailed = !llmResult;

    if (!llmResult) {
      log("Pass A failed. Using fallback categorization (Normal).");
      llmResult = {
        category: 'Normal',
        reasoning: 'Primary AI analysis unavailable. Defaulting to Normal category.'
      };
    }

    // --- PASS B: DETERMINISTIC MAPPING ENGINE ---
    // --- PASS B: DETERMINISTIC MAPPING ENGINE ---
    log("Running Pass B (Deterministic Mapping Engine)...");

    // Check against ALL platforms for comprehensive policy analysis
    const supportedPlatforms = ['x', 'youtube', 'facebook', 'instagram'];
    let allViolatedPolicies = [];
    let aggregatedLegalSections = []; // Should be same across platforms for same country
    let aggregatedKeywords = [];

    // We run mapping for all platforms to show "Cyber Simulation" results
    supportedPlatforms.forEach(p => {
      const result = mappingService.resolveMapping(
        llmResult.category,
        text,
        p,
        options.country || 'IN'
      );
      if (result.platform_policies && result.platform_policies.length > 0) {
        allViolatedPolicies.push(...result.platform_policies);
      }
      // Capture legal/keywords from the first valid run (they don't depend on platform)
      if (aggregatedLegalSections.length === 0) aggregatedLegalSections = result.legal_sections || [];
      if (aggregatedKeywords.length === 0) aggregatedKeywords = result.triggered_keywords || [];
    });

    const mappingResult = {
      legal_sections: aggregatedLegalSections,
      platform_policies: allViolatedPolicies,
      triggered_keywords: aggregatedKeywords
    };

    // --- PASS C: RISK ASSESSMENT (LLM-Driven) ---
    // Pass C was previously a standalone ML model, now integrated into Pass A (LLM) for efficiency.
    log("Applying Risk Assessment from LLM...");
    let finalRiskLevel = llmResult.risk_level || 'low';
    let finalRiskScore = Number(llmResult.risk_score || 0);
    log(`Risk Level: ${finalRiskLevel.toUpperCase()} (Score: ${finalRiskScore})`);

    /*
    // --- PASS C: RISK SCORING ML MODEL ---
    log("Running Pass C (Risk Scoring ML Model)...");
    let finalRiskLevel = 'low';
    let finalRiskScore = 0;

    const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:8006';

    try {
      const riskResponse = await axios.post(`${mlServiceUrl}/score-risk`, {
        text: text,
        category: llmResult.category,
        legal_sections: mappingResult.legal_sections.map(s => s.section)
      });

      const riskData = riskResponse.data;

      // Pass C (ML) is the "Final Word" on physical risk scoring
      finalRiskLevel = riskData.risk.toLowerCase();
      finalRiskScore = Math.round(riskData.confidence * 100);

      log(`Risk Scoring Complete: ${finalRiskLevel.toUpperCase()} (${finalRiskScore}%) [Method: ${riskData.method}]`);

    } catch (error) {
      log(`Pass C (Risk Service) failed: ${error.message}.`);

      // Fallback: If ML is down, use a heuristic based on LLM category
      const highRiskCategories = ['Violence', 'Hate_Speech', 'Sexual_Violence', 'Threat'];
      if (highRiskCategories.includes(llmResult.category)) {
        finalRiskLevel = 'high';
        finalRiskScore = 85;
        log(`ML Service Down. Fallback to HIGH risk based on LLM category: ${llmResult.category}`);
      } else {
        finalRiskLevel = 'low';
        finalRiskScore = 15;
      }
    }
    */

    // --- TARGET-AWARE POLITICAL SENTIMENT (Stages 3 & 4) ---
    // The old category-driven sentiment override is GONE. Sentiment is now
    // resolved RELATIVE TO the client leadership (the party president / BRS) via the
    // deterministic politicalContextService + LLM politicalSentimentService.
    log("Running Stage 3 (Political Context Gate)...");
    const politicalCtx = buildPoliticalContext(text, {
      taggedKeyword: options.taggedKeyword || '',
      authorHandle: options.authorHandle || '',
      platform: options.platform || '',
    });
    log(`Political context: mode=${politicalCtx.mode} target=${politicalCtx.primary_target || 'none'} target_relevance=${politicalCtx.target_relevance.toFixed(2)} author=${politicalCtx.author_alignment || 'unknown'}`);

    log("Running Stage 3/4 (constrained extraction → deterministic stance engine)...");
    /**
     * Stage 3 ONLY — deliberately not Pass A.
     *
     * When STAGE3_INCLUDE_ORIGINAL is on, Stage 3 receives the original text
     * alongside its translation so it can recover idiom the translation drops.
     * Pass A is left on the translation alone because its prompt already sits at
     * ~2,760 tokens against a 4096 window (measured) — adding a Devanagari original
     * there, at roughly 2 tokens per character, would push it over and Ollama
     * truncates silently rather than erroring.
     *
     * With the flag off this returns `analysisText` unchanged, so the default
     * deployment behaves exactly as before.
     */
    const stage3Text = buildStage3Input({ original: text, english: englishTranslation });
    if (stage3Text !== analysisText) {
      log('Stage 3 receiving ORIGINAL + translation (STAGE3_INCLUDE_ORIGINAL=true).');
    }
    const political = await analyzePoliticalSentiment(stage3Text, politicalCtx);
    log(`Stance=${political.stance} target_sentiment=${political.target_sentiment} target_tone=${political.target_tone} beneficiary=${political.beneficiary} provider=${political.provider}`);

    // ── risk_level is the Alerts page's Negative/Neutral/Positive bucket ──
    // (see frontend/src/pages/Alerts.js pill config: high=Negative,
    // low=Neutral or Positive). That bucket must reflect stance
    // RELATIVE TO the client government, not generic Pass-A moderation risk —
    // otherwise a pro-government post that happens to mention violence/crime keywords
    // lands in "Negative", and an anti-government post with mild language lands in
    // "Positive". So target_sentiment is the single source of truth for both
    // risk_level and risk_score here; we no longer let Pass A's risk survive
    // in either direction.
    // ── Sentiment is the post's RAW tone; risk follows it; stance is separate ──
    //   sentiment  = generic_sentiment from Stage 3 (the content's own tone)
    //   risk       = positive → low 15, neutral → low 20, negative → high 75
    //   stance     = derived from the TARGET by the stance engine (pro/anti client)
    // So "Congress looted Telangana" is sentiment negative, risk high, stance pro client.
    // Pass A's sentiment is client-relative, so it is never used as the tone;
    // when Stage 3 gives no tone, neutral is the honest answer.
    const finalSentiment = political.generic_sentiment || 'neutral';
    switch (finalSentiment) {
        case 'negative':
            finalRiskLevel = 'high';
            finalRiskScore = 75;
            break;
        case 'positive':
            finalRiskLevel = 'low';
            finalRiskScore = 15;
            break;
        case 'neutral':
        default:
            // Neutral content carries no risk.
            finalRiskLevel = 'low';
            finalRiskScore = 20;
            break;
    }
    log(`Raw sentiment=${finalSentiment} → risk ${finalRiskLevel} (${finalRiskScore}); stance=${political.stance} (client-relative ${political.target_sentiment})`);

    const finalGenericSentiment = finalSentiment;
    // The quality gate compares CLIENT-relative verdicts (Pass A vs Stage 4).
    const quality = buildQualityGate({ llmResult, political, finalSentiment: political.target_sentiment || 'neutral' });
    const currentCategory = llmResult.category;

    // --- RESULT CONSOLIDATION ---
    const finalResult = {
      risk_level: finalRiskLevel,
      risk_score: finalRiskScore,
      // Citizen-impact severity + best-fit government department from the
      // extended Pass A schema. Both are validated inside categorizeText.
      severity: llmResult.severity || finalRiskLevel,
      concerned_department: llmResult.concerned_department || 'General Administration',
      primary_intent: currentCategory,
      category: currentCategory,
      grievance_type: llmResult.grievance_type || 'Normal',
      grievance_topic_reasoning: llmResult.grievance_reasoning || '',
      // The 16-value CAMPAIGN taxonomy, deliberately distinct from grievance_type
      // above — see services/campaignTaxonomy.js. This is the field AI Campaigns
      // Stage A groups on, so every post analysed from here on joins the taxonomy
      // without waiting for a backfill run. null when the model returned nothing
      // inside the taxonomy; a wrong topic would surface a phantom campaign.
      topic: llmResult.campaign_topic || null,
      topic_taxonomy_version: llmResult.campaign_topic_taxonomy_version || null,
      intent: currentCategory,
      violated_policies: mappingResult.platform_policies || [],
      legal_sections: mappingResult.legal_sections || [],
      triggered_keywords: mappingResult.triggered_keywords || [],
      /**
       * `sentiment` is the post's RAW tone (= generic_sentiment), and risk
       * follows it. Whether the post helps or hurts the client is the STANCE
       * (political_stance → pro/anti client) with its client-relative value in
       * target_sentiment. Every dashboard aggregate on `sentiment` therefore
       * counts raw tone.
       */
      sentiment: finalSentiment,
      // ── Target-aware political fields ────────────────────────────
      target_sentiment: political.target_sentiment,
      // Legacy mirror of target_sentiment — same value, same object literal,
      // so the two can never diverge. Retained because stored records and a few
      // older readers (politicalImpactService, intelligenceController) still
      // read `bsk_sentiment` first.
      bsk_sentiment: political.target_sentiment,
      generic_sentiment: finalGenericSentiment,
      // Tone aimed AT the target — the value the stance matrix actually
      // consumed. Distinct from generic_sentiment (whole-post mood); persisted
      // so a reviewer can see WHY a supportive-sounding post scored against us.
      target_tone: political.target_tone,
      emotion: political.emotion || 'neutral',
      confidence: quality.confidence,
      validation: quality.validation,
      validation_status: quality.validation.status,
      needs_review: quality.needs_review,
      review_reason: quality.validation.reasons.join(','),
      client_relevance: political.client_relevance || 'uncertain',
      target: political.target || 'unknown',
      target_entity: political.target_entity,
      target_entity_canonical: political.target_entity_canonical,
      relevance_score: political.relevance_score,
      target_relevance: politicalCtx.target_relevance,
      bsk_relevance: politicalCtx.target_relevance, // legacy mirror
      stance: political.stance,
      // Same value as `stance`, mirrored into the schema's validated enum field.
      political_stance: political.stance,
      beneficiary: political.beneficiary,
      attack_target: political.attack_target,
      narrative_direction: political.narrative_direction,
      political_alignment: political.political_alignment,
      political_mode: politicalCtx.mode,
      mentioned_entities: politicalCtx.mentioned_entities,
      toxicity_level: political.toxicity_level,
      hate_speech: political.hate_speech,
      propaganda_probability: political.propaganda_probability,
      sarcasm_detected: political.sarcasm_detected,
      emotional_intensity: political.emotional_intensity,
      misinformation_probability: political.misinformation_probability,
      language_detected: political.language_detected,
      political_reasoning: political.reasoning,
      political_analysis: political.analysis,
      english_translation: political.english_translation,
      political_provider: political.provider,
      // ─────────────────────────────────────────────────────────────
      explanation: llmResult.reasoning || '',
      highlights: mappingResult.triggered_keywords || [],
      // Structure for ReasonModal
      llm_analysis: {
        category: currentCategory,
        grievance_type: llmResult.grievance_type || 'Normal',
        grievance_reasoning: llmResult.grievance_reasoning || '',
        intent: currentCategory,
        sentiment: finalSentiment,
        target_sentiment: political.target_sentiment,
        bsk_sentiment: political.target_sentiment, // legacy mirror
        generic_sentiment: finalGenericSentiment,
        target_tone: political.target_tone,
        client_relevance: political.client_relevance || 'uncertain',
        target: political.target || 'unknown',
        emotion: political.emotion || 'neutral',
        confidence: quality.confidence,
        validation: quality.validation,
        needs_review: quality.needs_review,
        stance: political.stance,
        political_stance: political.stance,
        political_provider: political.provider, // 'llm' | 'fallback' — fallback is never a complete analysis
        beneficiary: political.beneficiary,
        attack_target: political.attack_target,
        narrative_direction: political.narrative_direction,
        target_entity: political.target_entity,
        mentioned_entities: politicalCtx.mentioned_entities,
        reasoning: llmResult.reasoning || '',
        political_reasoning: political.reasoning,
        score: finalRiskScore,
        platform_policies_violated: mappingResult.platform_policies || [],
        bns_sections_violated: mappingResult.legal_sections || []
      }
    };

    // 3. Final Metadata for UI
    finalResult.reasons = [
      finalResult.explanation,
      `Risk Assessment: ${finalRiskLevel.toUpperCase()} (${finalRiskScore}%)`,
      ...finalResult.violated_policies.map(p => `Policy: ${p.policy_name}`),
      ...finalResult.legal_sections.map(l => `Legal: ${l.act} ${l.section}`)
    ].filter(Boolean);

    /**
     * COMPLETENESS — the one definition every consumer uses (alerts, mentions,
     * YouTube live, news). A result is complete only when Pass A answered, the
     * Stage 3 stance came from the model (not the keyword fallback) and a
     * stance exists. An incomplete result is returned so the caller can see
     * why, but it must not be saved as a verdict — the caller keeps the record
     * pending and retries. It is never cached, so a retry really re-analyses.
     */
    const incompleteReasons = [];
    if (passAFailed) incompleteReasons.push('pass_a_failed');
    if (political?.provider === 'fallback') incompleteReasons.push('stance_llm_fallback');
    if (!finalResult.llm_analysis?.political_stance) incompleteReasons.push('no_stance');
    finalResult.analysis_complete = incompleteReasons.length === 0;
    finalResult.analysis_incomplete_reasons = incompleteReasons;
    if (finalResult.llm_analysis) finalResult.llm_analysis.analysis_complete = finalResult.analysis_complete;

    // Cache the text-derived verdict (not forensic_results, which is
    // per-content media, not per-text) for reuse by identical future text.
    if (finalResult.analysis_complete) {
      await cacheService.set(cacheKey, finalResult, TEXT_ANALYSIS_CACHE_TTL_SECONDS);
    }

    // --- PASS D: STANDALONE FORENSICS (POST-SAVE TRIGGER) ---
    // If we have content metadata (from monitorService), trigger forensics
    let forensicResults = null;
    if (!options.skipForensics && options.content && options.analysisId) {
      forensicResults = await triggerForensicAnalysis(options.content, options.analysisId);
    }

    finalResult.forensic_results = forensicResults;


    return finalResult;

  } catch (error) {
    log(`Critical Analysis Error: ${error.message}`);
    return {
      risk_level: 'low',
      risk_score: 0,
      explanation: `Analysis failed: ${error.message}`,
      violated_policies: [],
      legal_sections: [],
      triggered_keywords: []
    };
  }
};

const VALID_SENTIMENTS = ['positive', 'negative', 'neutral'];
const VALID_RISK_LEVELS = ['low', 'medium', 'high'];

/**
 * True only for a finished, real analysis: every field the UI shows as a
 * verdict is present and came from the model. Alerts, mentions, YouTube live
 * and news all save a verdict only when this is true.
 */
const isAnalysisComplete = (r) => !!(
  r
  && r.analysis_complete === true
  && r.llm_analysis
  && r.llm_analysis.political_stance
  && VALID_SENTIMENTS.includes(r.sentiment)
  && VALID_RISK_LEVELS.includes(r.risk_level)
);

module.exports = {
  analyzeContent,
  isAnalysisComplete,
};