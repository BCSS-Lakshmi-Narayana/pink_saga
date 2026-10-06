const axios = require('axios');
const { responseLooksDoubleEncoded } = require('../utils/textEncoding');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const Grievance = require('../models/Grievance');
const GrievanceSource = require('../models/GrievanceSource');
const GrievanceSettings = require('../models/GrievanceSettings');
const Keyword = require('../models/Keyword');
const rapidApiFacebookService = require('./rapidApiFacebookService');
const rapidApiInstagramService = require('./rapidApiInstagramService');
const rapidApiXService = require('./rapidApiXService');
const youtubeService = require('./youtube.service');
const blugateClient = require('./blugateClient');
const { archiveTwitterMedia } = require('./contentS3Service');
const { generateComplaintCode } = require('./complaintCodeService');
const { syncLegacyFieldsFromWorkflow } = require('./grievanceWorkflowService');
const { analyzeContent, isAnalysisComplete } = require('./analysisService');
const { transcribeVideoUrl } = require('./videoTranscriptionService');
const { classifyLocation } = require('./locationClassifierService');
const { locateDistrict } = require('./districtLocator');
const { hasStateSignal } = require('../utils/stateSignal');
// Used by the ingestion relevance gate to rescue posts whose search term does
// not appear literally but whose political subject is still identifiable.
const { buildPoliticalContext } = require('./politicalContextService');
const { resolveRouting, resolvePersonToConstituency, resolveAllPersonsToConstituencies } = require('./constituencyMasterService');
const ManualReviewQueue = require('../models/ManualReviewQueue');

// Confidence threshold for auto-assigning a classified location. Below
// this, the grievance is enqueued for human review instead of being
// stamped. Configurable via env so ops can tune without a redeploy.
const AUTO_ASSIGN_THRESHOLD = Number(process.env.LOCATION_AUTO_ASSIGN_THRESHOLD || 0.80);

// ═══════════════════════════════════════════════════════════════
//          LOCATION EXTRACTION (backend-side)
// ═══════════════════════════════════════════════════════════════


/**
 * Extract location from a grievance's text / user profile and persist it.
 * STEP -1: Person-mention short-circuit (routes to every named MLA/MP's AC).
 * STEP 0: location classifier — confident hits are stamped, low-confidence hits go
 * to manual review. Failing both, an in-state district/town named in the post
 * places it at district level; otherwise it is left unlocated, never guessed.
 * Non-blocking: failures are logged but never throw.
 */
const extractAndSaveLocation = async (grievanceId, text, postedBy = {}, extraContext = {}) => {
    try {
        if (!text || !text.trim()) return;

        let finalLocation = null;
        const userLocation = postedBy.location || '';
        const userBio = postedBy.bio || postedBy.description || '';
        const hashtags = (text.match(/#\w+/g) || []).join(' ');

        // ── STEP -1: Person-mention short-circuit ──
        // If the text names a local MLA (or monitored handle), route directly to
        // ALL of their constituencies. Statewide leaders — CM, ministers, party
        // and opposition leadership — are skipped (constituencyMasterService
        // STATEWIDE_LEADER_AC_KEYS): they are tagged for their state role, so the
        // post is located from the places it names instead.
        // The first (longest) match becomes the primary `detected_location`;
        // the full set is stored in `routing_targets.constituencies` and the
        // MLA/MP login arrays are the merged fan-out across every matched AC.
        try {
            const handle = String(postedBy.handle || '').trim();
            const personScan = [text, handle].filter(Boolean).join(' ');
            const personHits = await resolveAllPersonsToConstituencies(personScan);
            if (personHits.length > 0) {
                const primary = personHits[0];
                const routings = await Promise.all(
                    personHits.map(async (h) => {
                        try { return { hit: h, routing: await resolveRouting(h.ac_name) }; }
                        catch (rErr) {
                            console.warn(`[GrievanceLocation] person-hit routing failed for ${h.ac_name}: ${rErr.message}`);
                            return { hit: h, routing: null };
                        }
                    })
                );

                const primaryRouting = routings[0]?.routing || null;
                finalLocation = {
                    city:          primary.ac_name,
                    district:      primaryRouting?.district  || null,
                    constituency:  primary.ac_name,
                    lok_sabha:     primaryRouting?.lok_sabha || null,
                    confidence:    1.0,
                    source:        `person_match:${primary.matched_via}`,
                    reasoning:     personHits.length > 1
                        ? `Mentions ${personHits.map(h => h.matched_name).join(', ')}`
                        : `Mentions ${primary.matched_name}`,
                    matched_token: primary.matched_name,
                    match_source:  primary.matched_via,
                    auto_assigned: true,
                    manual_review_required: false,
                };

                // Merge MLA / MP login fan-out across every matched constituency.
                const mlaIds = new Set();
                const mpIds  = new Set();
                const acDashboards = [];
                const allAcNames = [];
                const allScopeKeys = new Set();
                for (const { hit, routing } of routings) {
                    allAcNames.push(hit.ac_name);
                    if (!routing) continue;
                    for (const u of routing.mla_users || []) if (u?.id) mlaIds.add(u.id);
                    for (const u of routing.mp_users  || []) if (u?.id) mpIds.add(u.id);
                    if (routing.dashboards?.ac) acDashboards.push(routing.dashboards.ac);
                    for (const k of routing.scope_keys || []) allScopeKeys.add(k);
                }

                const routingTargets = {
                    // Primary AC keys preserved for back-compat with any reader
                    // that still uses the singular field set.
                    ac_key:        primaryRouting?.ac_key        || null,
                    district_key:  primaryRouting?.district_key  || null,
                    lok_sabha_key: primaryRouting?.lok_sabha_key || null,
                    dashboards:    primaryRouting?.dashboards    || null,
                    siblings_in_district: primaryRouting?.siblings_in_district || [],
                    siblings_in_ls:       primaryRouting?.siblings_in_ls       || [],

                    // Multi-routing fields — every consumer that wants the full
                    // fan-out reads these.
                    constituencies:   allAcNames,
                    ac_dashboards:    acDashboards,
                    mla_user_ids:     [...mlaIds],
                    mp_user_ids:      [...mpIds],
                    scope_keys:       [...allScopeKeys],
                    matched_persons:  personHits.map(h => ({ ac_name: h.ac_name, matched_name: h.matched_name, matched_via: h.matched_via })),
                };

                await Grievance.findOneAndUpdate(
                    { id: grievanceId },
                    { $set: { detected_location: finalLocation, routing_targets: routingTargets } }
                );
                console.log(`[GrievanceLocation] ${grievanceId} routed by ${personHits.length} person match(es) → [${allAcNames.join(', ')}]`);
                return;
            }
        } catch (pErr) {
            console.warn(`[GrievanceLocation] person resolver failed for ${grievanceId}: ${pErr.message}`);
        }

        // ── STEP 0: location classifier (highest priority for in-state routing) ──
        // Runs first so in-state posts route directly to the right MLA/MP scope
        // without falling through to the legacy location code.
        try {
            const ap = await classifyLocation(text, {
                userLocation,
                userBio,
                hashtags,
                taggedAccount: extraContext.tagged_account || '',
            });
            if (ap && ap.constituency) {
                // Confidence gate: below the threshold we DO NOT stamp the
                // location. Instead we mark the grievance as awaiting human
                // review and push a row into ManualReviewQueue.
                if (ap.confidence < AUTO_ASSIGN_THRESHOLD) {
                    await Grievance.findOneAndUpdate(
                        { id: grievanceId },
                        { $set: {
                            'detected_location.manual_review_required': true,
                            'detected_location.auto_assigned': false,
                            'detected_location.confidence': ap.confidence,
                            'detected_location.source': `ap_classifier:${ap.provider}:low_conf`,
                            'detected_location.reasoning': ap.reasoning,
                        } }
                    );
                    try {
                        await ManualReviewQueue.create({
                            grievance_id:   grievanceId,
                            text,
                            user_location:  userLocation,
                            user_bio:       userBio,
                            hashtags,
                            tagged_account: extraContext.tagged_account || '',
                            suggested: {
                                constituency: ap.constituency,
                                district:     ap.district  || null,
                                lok_sabha:    ap.lok_sabha || null,
                                confidence:   ap.confidence,
                                provider:     ap.provider,
                                reasoning:    ap.reasoning,
                                matched_token: ap.matched_token || null,
                                match_source:  ap.match_source  || null,
                            },
                        });
                    } catch (qErr) {
                        console.warn(`[GrievanceLocation] ManualReviewQueue insert failed for ${grievanceId}: ${qErr.message}`);
                    }
                    console.log(`[GrievanceLocation] ${grievanceId} sent to manual review (conf=${ap.confidence.toFixed(2)} < ${AUTO_ASSIGN_THRESHOLD})`);
                    return;
                }

                // High confidence — resolve the multi-level routing fan-out
                // (district + LS + MLA/MP logins) via ConstituencyMaster.
                let routing = null;
                try {
                    routing = await resolveRouting(ap.constituency);
                } catch (rErr) {
                    console.warn(`[GrievanceLocation] resolveRouting failed for ${ap.constituency}: ${rErr.message}`);
                }

                finalLocation = {
                    city:          ap.constituency,
                    district:      routing?.district  || ap.district  || null,
                    constituency:  ap.constituency,
                    lok_sabha:     routing?.lok_sabha || ap.lok_sabha || null,
                    confidence:    ap.confidence,
                    source:        `ap_classifier:${ap.provider}`,
                    reasoning:     ap.reasoning,
                    matched_token: ap.matched_token || null,
                    match_source:  ap.match_source  || null,
                    auto_assigned: true,
                    manual_review_required: false,
                };

                const routingTargets = routing ? {
                    ac_key:        routing.ac_key,
                    district_key:  routing.district_key,
                    lok_sabha_key: routing.lok_sabha_key,
                    dashboards:    routing.dashboards,
                    mla_user_ids:  (routing.mla_users || []).map((u) => u.id),
                    mp_user_ids:   (routing.mp_users  || []).map((u) => u.id),
                    mla_name:      routing.mla_name,
                    mp_name:       routing.mp_name,
                    scope_keys:    routing.scope_keys,
                    resolved_at:   new Date(),
                } : null;

                await Grievance.findOneAndUpdate(
                    { id: grievanceId },
                    { $set: { detected_location: finalLocation, routing_targets: routingTargets } }
                );
                console.log(`[GrievanceLocation] routed ${grievanceId} → ${ap.constituency} ` +
                            `(district=${finalLocation.district || '?'}, ls=${finalLocation.lok_sabha || '?'}, ` +
                            `mla_logins=${(routing?.mla_users || []).length}, mp_logins=${(routing?.mp_users || []).length})`);
                return;
            }
        } catch (err) {
            console.warn(`[GrievanceLocation] location classifier failed for ${grievanceId}: ${err.message}`);
        }

        // No seat. If the post names an in-state district or town, place it at
        // district level (no constituency, so no MLA routing) — never a guessed seat.
        const districtHit = locateDistrict(`${text} ${hashtags}`);
        if (districtHit) {
            await Grievance.findOneAndUpdate(
                { id: grievanceId },
                { $set: { detected_location: {
                    city:          districtHit.city,
                    district:      districtHit.district,
                    constituency:  null,
                    lok_sabha:     null,
                    confidence:    0.85,
                    source:        'district_match',
                    reasoning:     `Names ${districtHit.city} (${districtHit.district} district); no constituency named.`,
                    matched_token: districtHit.matched_token,
                    match_source:  'district_match',
                    auto_assigned: true,
                    manual_review_required: false,
                } } }
            );
            console.log(`[GrievanceLocation] ${grievanceId} placed at district level → ${districtHit.district}`);
            return;
        }

        // Nothing in-state named — leave the grievance unlocated rather than guessing.
        console.log(`[GrievanceLocation] No in-state location found for ${grievanceId}; left unlocated.`);
    } catch (error) {
        console.error(`[GrievanceLocation] Final extraction error for ${grievanceId}:`, error.message);
    }
};

/**
 * Run the full analysis pipeline on a grievance's text content.
 * Updates the grievance document in-place with analysis results.
 * Runs async (fire-and-forget) so it doesn't block ingestion.
 */
/**
 * Build the `$set` document that persists a pipeline result onto a Grievance.
 *
 * Factored out so the live ingest path and the re-analysis script
 * (scripts/rerun_analysis.js) write the IDENTICAL field set. When these were two
 * separate literals the re-run quietly omitted `analysis.bsk_sentiment` — the
 * deprecated mirror that politicalImpactService and intelligenceController read
 * FIRST — so a re-analysed post showed its new verdict on the Mentions page and
 * its old one on those two surfaces.
 */
const buildGrievanceAnalysisUpdate = (analysisData, { videoTranscript = '' } = {}) => {
    // `analysis.sentiment` is the post's RAW tone (risk follows it); the
    // client-relative verdict is `analysis.target_sentiment`, shown as the
    // stance (pro/anti client). See analysisService.js.
    const targetSentiment = analysisData.target_sentiment || 'neutral';
    const sentiment = analysisData.generic_sentiment || analysisData.sentiment || 'neutral';
    return {
        'analysis.sentiment': sentiment,
        'analysis.risk_level': analysisData.risk_level,
        'analysis.risk_score': analysisData.risk_score,
        'analysis.category': analysisData.category,
        'analysis.grievance_type': analysisData.grievance_type || 'Normal',
        'analysis.grievance_topic_reasoning': analysisData.grievance_topic_reasoning || '',
        // Campaign taxonomy — what AI Campaigns Stage A groups on. Written here as
        // well as declared on the schema: this update goes through findOneAndUpdate
        // with an explicit $set, so a field the analysis produced but this object
        // omits simply never lands, silently and with no error.
        'analysis.topic': analysisData.topic || null,
        'analysis.topic_taxonomy_version': analysisData.topic_taxonomy_version || null,
        'analysis.intent': analysisData.intent,
        'analysis.explanation': analysisData.explanation,
        'analysis.triggered_keywords': analysisData.triggered_keywords || [],
        'analysis.violated_policies': analysisData.violated_policies || [],
        'analysis.legal_sections': analysisData.legal_sections || [],
        'analysis.reasons': analysisData.reasons || [],
        'analysis.highlights': analysisData.highlights || [],
        'analysis.llm_analysis': analysisData.llm_analysis || null,
        'analysis.forensic_results': analysisData.forensic_results || null,
        ...(videoTranscript ? { 'analysis.video_transcript': videoTranscript } : {}),
        // ── Target-aware political intelligence ──
        'analysis.target_sentiment': targetSentiment,
        'analysis.bsk_sentiment': targetSentiment, // deprecated mirror
        'analysis.generic_sentiment': sentiment,
        'analysis.target_tone': analysisData.target_tone || analysisData.generic_sentiment || 'neutral',
        'analysis.emotion': analysisData.emotion || 'neutral',
        // ── Stage 5 confidence / review gate ──
        'analysis.confidence': analysisData.confidence || {},
        'analysis.validation': analysisData.validation || null,
        'analysis.validation_status': analysisData.validation_status || 'passed',
        'analysis.needs_review': !!analysisData.needs_review,
        'analysis.review_reason': analysisData.review_reason || '',
        'analysis.client_relevance': analysisData.client_relevance || 'uncertain',
        'analysis.target': analysisData.target || 'unknown',
        'analysis.target_party': (analysisData.llm_analysis && analysisData.llm_analysis.target_party) || '',
        'analysis.target_entity': analysisData.target_entity || null,
        'analysis.target_entity_canonical': analysisData.target_entity_canonical || null,
        'analysis.target_relevance': analysisData.target_relevance || 0,
        'analysis.bsk_relevance': analysisData.target_relevance || 0, // deprecated mirror
        'analysis.relevance_score': analysisData.relevance_score || 0,
        'analysis.stance': analysisData.stance || 'unrelated',
        'analysis.political_stance': analysisData.political_stance || analysisData.stance || 'unrelated',
        'analysis.beneficiary': analysisData.beneficiary || 'none',
        'analysis.attack_target': analysisData.attack_target || '',
        'analysis.narrative_direction': analysisData.narrative_direction || '',
        'analysis.political_alignment': analysisData.political_alignment || '',
        'analysis.political_mode': analysisData.political_mode || '',
        'analysis.mentioned_entities': analysisData.mentioned_entities || [],
        'analysis.toxicity_level': analysisData.toxicity_level || 'none',
        'analysis.hate_speech': !!analysisData.hate_speech,
        'analysis.propaganda_probability': analysisData.propaganda_probability || 0,
        'analysis.sarcasm_detected': !!analysisData.sarcasm_detected,
        'analysis.emotional_intensity': analysisData.emotional_intensity || 0,
        'analysis.misinformation_probability': analysisData.misinformation_probability || 0,
        'analysis.language_detected': analysisData.language_detected || '',
        'analysis.political_reasoning': analysisData.political_reasoning || '',
        'analysis.political_provider': analysisData.political_provider || '',
        'analysis.analyzed_at': new Date(),
    };
};

const MAX_ANALYSIS_ATTEMPTS = Number(process.env.MAX_ANALYSIS_ATTEMPTS || 6);

/**
 * A mention whose analysis did not complete keeps NO verdict: it stays
 * 'pending' (the display gate hides it, since it has no stance/analyzed_at)
 * and retryPendingGrievanceAnalyses re-analyses it; 'failed' after
 * MAX_ANALYSIS_ATTEMPTS.
 */
const markGrievancePending = async (grievanceId, reason) => {
    try {
        const doc = await Grievance.findOneAndUpdate(
            { id: grievanceId },
            {
                $inc: { analysis_attempts: 1 },
                $set: {
                    analysis_status: 'pending',
                    analysis_error: String(reason || 'incomplete').slice(0, 300),
                    analysis_last_attempt_at: new Date(),
                },
            },
            { new: true, projection: { analysis_attempts: 1 } }
        );
        if (doc && doc.analysis_attempts >= MAX_ANALYSIS_ATTEMPTS) {
            await Grievance.updateOne({ id: grievanceId }, { $set: { analysis_status: 'failed' } });
        }
        console.warn(`[GrievanceAnalysis] ${grievanceId} not complete (${reason}) — attempt ${doc ? doc.analysis_attempts : '?'}/${MAX_ANALYSIS_ATTEMPTS}`);
    } catch (err) {
        console.error(`[GrievanceAnalysis] could not mark ${grievanceId} pending: ${err.message}`);
    }
};

const analyzeGrievanceContent = async (grievanceId, text, platform) => {
    try {
        if (!text || !text.trim()) return;

        let analysisText = text;
        let videoTranscriptSaved = null;
        // Pull author + tagged keyword so the target-aware political pipeline
        // can use them as deterministic signal (alongside the text).
        let grievanceCtx = null;
        try {
            const grievanceDoc = await Grievance.findOne(
                { id: grievanceId },
                'content.media posted_by.handle tagged_account'
            ).lean();
            grievanceCtx = grievanceDoc;
            const videoItems = (grievanceDoc?.content?.media || [])
                .filter(m => m.type === 'video' || m.type === 'animated_gif')
                .slice(0, 3);
            if (videoItems.length > 0) {
                const parts = [];
                for (const item of videoItems) {
                    const url = item.s3_url || item.video_url || item.url;
                    if (!url) continue;
                    const t = await transcribeVideoUrl(url);
                    if (t) parts.push(t);
                }
                if (parts.length > 0) {
                    videoTranscriptSaved = parts.join('\n');
                    analysisText = `${text}\n\n[VIDEO TRANSCRIPT]:\n${videoTranscriptSaved}`;
                }
            }
        } catch (transcribeErr) {
            console.warn(`[AnalyzeContent] Video transcription skipped: ${transcribeErr.message}`);
        }

        const analysisData = await analyzeContent(analysisText, {
            platform: platform || 'x',
            skipForensics: true,
            taggedKeyword: grievanceCtx?.tagged_account || '',
            authorHandle: grievanceCtx?.posted_by?.handle || ''
        });
        if (!isAnalysisComplete(analysisData)) {
            await markGrievancePending(grievanceId, (analysisData?.analysis_incomplete_reasons || []).join(',') || analysisData?.explanation || 'incomplete');
            return;
        }

        const update = buildGrievanceAnalysisUpdate(analysisData, { videoTranscript: videoTranscriptSaved });
        const targetSentiment = update['analysis.target_sentiment'];
        const sentiment = update['analysis.sentiment'];

        // Verdict + completion written together, in one update.
        await Grievance.findOneAndUpdate({ id: grievanceId }, {
            $set: {
                ...update,
                analysis_status: 'complete',
                analysis_error: null,
                analysis_completed_at: new Date(),
                analysis_last_attempt_at: new Date(),
            },
        });
        console.log(`[GrievanceAnalysis] Completed for ${grievanceId}: generic=${sentiment} target_sentiment=${targetSentiment} stance=${analysisData.stance} target=${analysisData.target_entity} risk=${analysisData.risk_level || 'low'}${analysisData.needs_review ? ` NEEDS_REVIEW(${analysisData.review_reason})` : ''}`);
    } catch (err) {
        console.error(`[GrievanceAnalysis] Failed for ${grievanceId}: ${err.message}`);
        await markGrievancePending(grievanceId, `error: ${err.message}`);
    }
};

/** Re-analyse mentions whose analysis did not complete. Runs on a schedule from index.js. */
const retryPendingGrievanceAnalyses = async ({ limit = 25 } = {}) => {
    const pending = await Grievance.find({
        analysis_status: 'pending',
        analysis_attempts: { $lt: MAX_ANALYSIS_ATTEMPTS },
    }).select('id platform content.text').sort({ analysis_last_attempt_at: 1 }).limit(limit).lean();
    let completed = 0;
    for (const g of pending) {
        await analyzeGrievanceContent(g.id, (g.content && g.content.text) || '', g.platform || 'x');
        const after = await Grievance.findOne({ id: g.id }).select('analysis_status').lean();
        if (after && after.analysis_status === 'complete') completed += 1;
    }
    return { picked: pending.length, completed, still_pending: pending.length - completed };
};

/**
 * Grievance Service
 * Handles fetching mentions from X, processing grievances, and generating reports
 */

/**
 * GET against RapidAPI with a guard against double-encoded responses.
 *
 * The provider intermittently serves a whole response whose UTF-8 was decoded as
 * Windows-1252, so Indic script (Telugu, Devanagari) arrives as "à°µà°°à±�à°·..." and every non-ASCII string
 * in the payload — post text, author display names, quoted posts — is mangled.
 * It cannot be repaired after the fact (Windows-1252 has no mapping for
 * 0x8D/0x8F/0x90, so the Telugu virama is already destroyed), but a re-request
 * normally comes back clean.
 *
 * Grievances are written once and never re-polled, so unlike the monitored
 * `contents` feed they never self-heal — a corrupt response is permanent. That
 * makes catching it on arrival the only defence, which is why these calls must
 * not bypass this wrapper.
 */
const rapidApiGet = async (path, rawParams, maxRetries = 2) => {
    // Validates the route + required params against the BluGate catalog and
    // strips blank values, so no null-param hit ever reaches BluGate.
    const { params } = rapidApiXService.prepareXRequest(path, rawParams);
    for (let attempt = 0; ; attempt++) {
        const res = await blugateClient.withRateLimitRetry(() => axios.get(`${blugateClient.GATEWAY_BASE}/twitter${path}`, {
            params,
            headers: blugateClient.getHeaders(),
            ...blugateClient.responseOptions(),
        }), { label: 'BluGate X search' });

        if (!responseLooksDoubleEncoded(res.data)) return res;

        if (attempt >= maxRetries) {
            console.error(`[Grievance] ❌ RapidAPI response still double-encoded after ${maxRetries} retries: ${path}`);
            return res;
        }

        console.warn(`[Grievance] ⚠️ Double-encoded RapidAPI response for ${path}; re-requesting (${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, 1000));
    }
};

/**
 * Check if text contains any of the provided keywords (case-insensitive, NFKC normalized).
 * Fail-closed: empty/missing keyword list returns false (config bug, not "let everything in").
 * Empty text returns false — media-only posts must use the handle-bypass path.
 */
const textMatchesAnyKeyword = (text, keywords) => {
    if (!Array.isArray(keywords) || keywords.length === 0) return false;
    if (!text || String(text).trim().length === 0) return false;
    const normalizedText = String(text).toLowerCase().normalize('NFKC');
    return keywords.some(k => {
        const kw = String(k.keyword || k).toLowerCase().normalize('NFKC').trim();
        if (!kw) return false;
        return normalizedText.includes(kw);
    });
};

/**
 * Split a phrase into "significant" tokens for loose keyword matching.
 *
 * `\p{M}` (combining marks) MUST stay attached to `\p{L}` (letters): Indic
 * scripts encode vowel signs as separate combining marks, so splitting on
 * `\P{L}` alone would shatter every multi-syllable Indic word into
 * single base characters, drop them all below the length floor, and silently
 * disable this check for every non-Latin keyword.
 */
const KEYWORD_TOKEN_MIN_LEN = 3;
const significantTokens = (phrase) => String(phrase || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/^[@#]+/, '')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((t) => t.length >= KEYWORD_TOKEN_MIN_LEN);

/**
 * True if the post text or the author handle contains at least one significant
 * token of the keyword phrase that fetched it. Looser than a full-phrase
 * substring match — a search API can legitimately return a post about the
 * subject of a multi-word keyword without the exact adjacent phrase.
 */
const keywordTokenMatches = (text, handle, keywordPhrase) => {
    const tokens = significantTokens(keywordPhrase);
    if (!tokens.length) return false;
    const haystack = `${String(text || '')} ${String(handle || '')}`.toLowerCase().normalize('NFKC');
    return tokens.some((t) => haystack.includes(t));
};

/**
 * True if the deterministic political entity scan recognises anyone in the
 * roster (ally or opposition) in the text.
 *
 * This RESCUES a genuinely relevant post that a search API surfaced via loose
 * or semantic matching in a different script than the literal search term: the
 * search term may not appear at all, yet the actual person or party is still
 * identifiable to the Stage 2 gate.
 */
const hasRecognizedPoliticalEntity = (text) => {
    try {
        const ctx = buildPoliticalContext(text || '', {});
        return (ctx.mentioned_entities || []).length > 0;
    } catch (err) {
        return false;
    }
};

/**
 * Ingestion relevance gate for a single (post, keyword) pair.
 *
 * Accept if the full keyword phrase matches (the original behaviour), OR a
 * significant token of it matches, OR the text independently resolves to a
 * known political entity.
 *
 * PURELY ADDITIVE: it never rejects a post the old substring check would have
 * accepted — it only rescues more relevant ones, especially the cross-script
 * matches a search API's loose matching returns.
 */
const passesKeywordGate = (text, handle, keywordPhrase) => {
    const matched = textMatchesAnyKeyword(text, [{ keyword: keywordPhrase }])
        || keywordTokenMatches(text, handle, keywordPhrase)
        || hasRecognizedPoliticalEntity(text);
    if (!matched) return false;
    // A keyword that names the state, a place or a leader already binds the
    // search to this state. A GENERIC one ("fertilizer shortage", "electricity
    // bill") returns posts from every state and country — keep only those that
    // are about this state (see utils/stateSignal).
    if (hasStateSignal(keywordPhrase, buildPoliticalContext(keywordPhrase, {}).mentioned_entities || [])) return true;
    return hasStateSignal(`${text || ''} ${handle || ''}`, buildPoliticalContext(text || '', {}).mentioned_entities || []);
};

let _keywordCache = { ts: 0, data: [] };
const KEYWORD_CACHE_TTL_MS = 60 * 1000;
const getActiveKeywordsCached = async () => {
    const now = Date.now();
    if (now - _keywordCache.ts < KEYWORD_CACHE_TTL_MS && _keywordCache.data.length > 0) {
        return _keywordCache.data;
    }
    const data = await Keyword.find({ is_active: true }).lean();
    _keywordCache = { ts: now, data };
    return data;
};

const extractMediaFromLegacy = (legacy) => {
    const media = [];
    const mediaEntities = legacy?.extended_entities?.media || legacy?.entities?.media || [];

    for (const m of mediaEntities) {
        const mediaType = m.type || 'photo';
        let mediaUrl = m.media_url_https || m.url;
        let videoUrl = null;

        // For videos and animated_gifs, extract the actual video URL from video_info
        if ((mediaType === 'video' || mediaType === 'animated_gif') && m.video_info?.variants) {
            const mp4Variants = m.video_info.variants
                .filter(v => v.content_type === 'video/mp4')
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

            if (mp4Variants.length > 0) {
                videoUrl = mp4Variants[0].url;
            } else if (m.video_info.variants.length > 0) {
                videoUrl = m.video_info.variants[0].url;
            }
        }

        media.push({
            type: mediaType,
            url: videoUrl || mediaUrl,
            video_url: videoUrl,
            preview_url: m.media_url_https
        });
    }

    return media;
};

const extractTweetSnapshot = (tweetResult) => {
    if (!tweetResult) return null;

    // Handle TweetWithVisibilityResults wrapper
    let result = tweetResult;
    if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) {
        result = result.tweet;
    }
    if (result.__typename === 'TweetUnavailable' || result.__typename === 'TweetTombstone') return null;

    const legacy = result.legacy;
    if (!legacy?.id_str) return null;

    const userResult = result.core?.user_results?.result;
    const userLegacy = userResult?.legacy || {};

    let createdAt = null;
    try {
        if (legacy.created_at) {
            const parsed = new Date(legacy.created_at);
            if (!isNaN(parsed)) createdAt = parsed;
        }
    } catch (e) {
        createdAt = null;
    }

    const handle = userLegacy.screen_name || userResult?.core?.screen_name || 'unknown';
    const tweetUrl = handle && handle !== 'unknown'
        ? `https://x.com/${handle}/status/${legacy.id_str}`
        : `https://x.com/i/web/status/${legacy.id_str}`;

    const noteText = result.note_tweet?.note_tweet_results?.result?.text;
    const text = noteText || legacy.full_text || legacy.text || '';

    return {
        tweet_id: legacy.id_str,
        tweet_url: tweetUrl,
        posted_by: {
            handle,
            display_name: userLegacy.name || userResult?.core?.name || userResult?.legacy?.name || (handle !== 'unknown' ? handle : 'Unknown User'),
            profile_image_url: userLegacy.profile_image_url_https || userResult?.avatar?.image_url,
            is_verified: userResult?.is_blue_verified || userLegacy.verified || false
        },
        content: {
            text,
            full_text: text,
            media: extractMediaFromLegacy(legacy)
        },
        post_date: createdAt
    };
};

const getTimelineEntriesFromSearchResponse = (data) => {
    const instructions = data?.result?.timeline?.instructions ||
        data?.timeline?.instructions ||
        data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
        [];

    return instructions.find(i => i.type === 'TimelineAddEntries')?.entries ||
        instructions[0]?.entries ||
        [];
};

const fetchTweetById = async (tweetId, cache = null) => {
    const key = String(tweetId || '').trim();
    if (!key) return null;
    if (cache && cache.has(key)) return cache.get(key);

    let snapshot = null;

    // Attempt 1: provider-specific tweet endpoint (if available)
    const endpointAttempts = [
        { path: '/tweet-v2', params: { pid: key } },
        { path: '/tweet', params: { pid: key } }
    ];

    for (const attempt of endpointAttempts) {
        try {
            const res = await rapidApiGet(attempt.path, attempt.params);

            const tweetResult = res.data?.result?.tweet ||
                res.data?.result?.tweet_results?.result ||
                res.data?.tweet_results?.result ||
                res.data?.result;

            snapshot = extractTweetSnapshot(tweetResult);
            if (snapshot) break;
        } catch (e) {
            // continue
        }
    }

    // Attempt 2: fallback to search by URL operator
    if (!snapshot) {
        try {
            const searchQuery = `url:\"/status/${key}\"`;
            const res = await rapidApiGet('/search', { query: searchQuery, type: 'Latest', count: 10 });

            const entries = getTimelineEntriesFromSearchResponse(res.data);
            for (const entry of entries) {
                if (entry.entryId?.startsWith('cursor-')) continue;
                let tweetResult = entry.content?.itemContent?.tweet_results?.result;
                if (!tweetResult) continue;

                // unwrap
                if (tweetResult.__typename === 'TweetWithVisibilityResults' && tweetResult.tweet) {
                    tweetResult = tweetResult.tweet;
                }
                const legacy = tweetResult?.legacy;
                if (!legacy?.id_str) continue;
                if (legacy.id_str !== key) continue;

                snapshot = extractTweetSnapshot(tweetResult);
                if (snapshot) break;
            }
        } catch (e) {
            snapshot = null;
        }
    }

    if (cache) cache.set(key, snapshot);
    return snapshot;
};

/**
 * Fetch user profile to get user ID
 */
const fetchUserProfile = async (handle) => {
    try {
        const cleanHandle = String(handle || '').replace('@', '').trim();
        if (!cleanHandle) return null;

        const userResponse = await rapidApiGet('/user', { username: cleanHandle });

        let result = null;
        if (userResponse.data?.result?.data?.user?.result) {
            result = userResponse.data.result.data.user.result;
        } else if (userResponse.data?.data?.user?.result) {
            result = userResponse.data.data.user.result;
        } else if (userResponse.data?.result) {
            result = userResponse.data.result;
        }

        if (!result) return null;

        return {
            id: result.rest_id,
            name: result.legacy?.name,
            screenName: result.legacy?.screen_name,
            isVerified: result.is_blue_verified || result.legacy?.verified || false,
            profileImageUrl: result.avatar?.image_url || result.legacy?.profile_image_url_https
        };
    } catch (error) {
        return null;
    }
};

/**
 * Format date to YYYY-MM-DD for Twitter search query
 */
const formatDateForSearch = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Search for tweets mentioning a specific account using the search endpoint
 * @param {string} handle - Twitter handle to search mentions for
 * @param {number} limit - Maximum number of tweets to fetch
 * @param {string} startDate - Start date for search (YYYY-MM-DD)
 * @param {string} endDate - End date for search (YYYY-MM-DD)
 */
const searchMentions = async (handle, limit = 50, startDate = null, endDate = null) => {
    try {
        const cleanHandle = handle.replace('@', '').trim();

        // Build search query with date filters
        let searchQuery = `@${cleanHandle}`;

        // Calculate days range to adjust limit
        let daysRange = 1;
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            daysRange = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
            if (!Number.isFinite(daysRange) || daysRange < 1) daysRange = 1;
        }

        // Increase limit based on date range (more days = need more tweets)
        const adjustedLimit = Math.min(100, Math.max(Number(limit) || 50, daysRange * 20));

        // Add date filter using Twitter's since: operator only
        // Twitter search works best with just since: (until: can cause issues)
        if (startDate) {
            const formattedStart = formatDateForSearch(startDate);
            if (formattedStart) {
                searchQuery += ` since:${formattedStart}`;
            }
        }



        const response = await rapidApiGet('/search', {
            query: searchQuery,
            type: 'Latest',
            count: adjustedLimit
        });


        // Log raw response structure for debugging
        if (response.data) {
        }

        // Parse the timeline entries - handle multiple response structures
        const instructions = response.data?.result?.timeline?.instructions ||
            response.data?.timeline?.instructions ||
            response.data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
            [];

        const timelineEntries = instructions.find(i => i.type === 'TimelineAddEntries')?.entries ||
            instructions[0]?.entries ||
            [];


        const tweets = [];
        const processedIds = new Set();
        const parentTweetCache = new Map();

        for (const entry of timelineEntries) {
            // Skip cursor entries
            if (entry.entryId?.startsWith('cursor-')) continue;

            let tweetResult = entry.content?.itemContent?.tweet_results?.result;
            if (!tweetResult) continue;

            // Handle TweetWithVisibilityResults wrapper
            if (tweetResult.__typename === 'TweetWithVisibilityResults' && tweetResult.tweet) {
                tweetResult = tweetResult.tweet;
            }

            // Skip unavailable tweets
            if (tweetResult.__typename === 'TweetUnavailable' || tweetResult.__typename === 'TweetTombstone') {
                continue;
            }

            const legacy = tweetResult.legacy;
            if (!legacy) continue;

            // Skip duplicates
            if (processedIds.has(legacy.id_str)) continue;
            processedIds.add(legacy.id_str);

            // Extract user info
            const userResult = tweetResult.core?.user_results?.result;
            const userLegacy = userResult?.legacy || {};

            // Verify this tweet actually mentions the target account
            const mentions = legacy.entities?.user_mentions || [];
            const isMentioned = mentions.some(m =>
                m.screen_name?.toLowerCase() === cleanHandle.toLowerCase()
            );
            const textContainsMention = legacy.full_text?.toLowerCase().includes(`@${cleanHandle.toLowerCase()}`);

            if (!isMentioned && !textContainsMention) {
                continue;
            }

            let media = extractMediaFromLegacy(legacy);

            // Repost (retweet) context
            let repostedFrom = null;
            let retweetResult = legacy.retweeted_status_result?.result;
            if (retweetResult && retweetResult.__typename === 'TweetWithVisibilityResults' && retweetResult.tweet) {
                retweetResult = retweetResult.tweet;
            }
            if (retweetResult) {
                repostedFrom = extractTweetSnapshot(retweetResult);
                // Retweets often don't have media on the wrapper tweet; pull from original.
                if ((!media || media.length === 0) && repostedFrom?.content?.media?.length) {
                    media = repostedFrom.content.media;
                }
            }

            // Quote tweet context
            let quoted = null;
            let rawQuote = tweetResult?.quoted_status_result?.result || tweetResult?.quoted_status_result;
            if (rawQuote && (rawQuote.result || rawQuote.tweet)) {
                rawQuote = rawQuote.result || rawQuote.tweet;
            }
            if (rawQuote && rawQuote.__typename === 'TweetWithVisibilityResults' && rawQuote.tweet) {
                rawQuote = rawQuote.tweet;
            }
            if (rawQuote) {
                quoted = extractTweetSnapshot(rawQuote);
            } else if (legacy.quoted_status_id_str) {
                quoted = await fetchTweetById(legacy.quoted_status_id_str, parentTweetCache);
            }

            // Reply context (original post)
            const inReplyToId = legacy.in_reply_to_status_id_str;
            const inReplyToHandle = legacy.in_reply_to_screen_name;

            let inReplyTo = null;
            if (inReplyToId) {
                inReplyTo = await fetchTweetById(inReplyToId, parentTweetCache);
                if (!inReplyTo) {
                    const fallbackUrl = inReplyToHandle
                        ? `https://x.com/${inReplyToHandle}/status/${inReplyToId}`
                        : `https://x.com/i/web/status/${inReplyToId}`;
                    inReplyTo = {
                        tweet_id: String(inReplyToId),
                        tweet_url: fallbackUrl,
                        posted_by: { handle: inReplyToHandle || undefined },
                        content: {},
                        post_date: null
                    };
                }
            }

            // Parse date safely
            let createdAt = new Date();
            try {
                if (legacy.created_at) {
                    const parsed = new Date(legacy.created_at);
                    if (!isNaN(parsed)) {
                        createdAt = parsed;
                    }
                }
            } catch (e) {
            }

            const screenName = userLegacy.screen_name || userResult?.core?.screen_name || 'unknown';
            const tweetUrl = `https://x.com/${screenName}/status/${legacy.id_str}`;

            const context = {
                ...(inReplyTo ? { in_reply_to: inReplyTo } : {}),
                ...(repostedFrom ? { reposted_from: repostedFrom } : {}),
                ...(quoted ? { quoted } : {})
            };

            tweets.push({
                tweet_id: legacy.id_str,
                text: legacy.full_text,
                url: tweetUrl,
                created_at: createdAt,
                author: {
                    handle: screenName,
                    display_name: userLegacy.name || userResult?.core?.name || userResult?.legacy?.name || (screenName !== 'unknown' ? screenName : 'Unknown User'),
                    profile_image_url: userLegacy.profile_image_url_https || userResult?.avatar?.image_url,
                    is_verified: userResult?.is_blue_verified || userLegacy.verified || false,
                    follower_count: userLegacy.followers_count || 0
                },
                media,
                context: Object.keys(context).length > 0 ? context : undefined,
                engagement: {
                    likes: legacy.favorite_count || 0,
                    retweets: legacy.retweet_count || 0,
                    replies: legacy.reply_count || 0,
                    views: parseInt(tweetResult.views?.count || '0', 10),
                    quotes: legacy.quote_count || 0
                }
            });
        }

        return tweets;
    } catch (error) {
        if (error.response) {
        }
        return [];
    }
};

const isWithinDateRange = (dateValue, startDate, endDate) => {
    const d = new Date(dateValue);
    if (isNaN(d)) return false;

    if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        if (d < start) return false;
    }

    if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (d > end) return false;
    }

    return true;
};

const toSafeDate = (value, fallback = new Date()) => {
    const d = value ? new Date(value) : null;
    return d && !isNaN(d) ? d : fallback;
};

const toSafeHandle = (value, fallback = 'unknown') => {
    const v = String(value || '').trim();
    if (!v) return fallback;
    return v.replace(/\s+/g, '_').replace(/[^\w.-]/g, '').toLowerCase() || fallback;
};

const normalizeFacebookMedia = (mediaArray = []) => {
    if (!Array.isArray(mediaArray)) return [];

    return mediaArray
        .map((item) => {
            if (!item) return null;

            if (typeof item === 'string') {
                const guessedType = /\.(mp4|webm|mov)(\?|$)/i.test(item) ? 'video' : 'photo';
                return {
                    type: guessedType,
                    url: item,
                    video_url: guessedType === 'video' ? item : undefined,
                    preview_url: guessedType === 'photo' ? item : undefined
                };
            }

            const url = item.url || item.src || item.video || item.image || item.image_url || item.thumbnail || item.preview;
            if (!url) return null;

            const rawType = String(item.type || item.media_type || '').toLowerCase();
            const isVideo = rawType.includes('video') || /\.(mp4|webm|mov)(\?|$)/i.test(url);

            return {
                type: isVideo ? 'video' : 'photo',
                url,
                video_url: isVideo ? (item.video || url) : undefined,
                preview_url: item.preview || item.thumbnail || item.image || (isVideo ? undefined : url)
            };
        })
        .filter(Boolean);
};

const archiveTwitterMediaSafe = async (mediaItems, contentId, archiveMediaFn = archiveTwitterMedia, options = {}) => {
    if (!Array.isArray(mediaItems) || mediaItems.length === 0) {
        return { media: [], failures: 0 };
    }

    try {
        const archived = await archiveMediaFn(mediaItems, contentId, options);
        const failures = archived.filter((item) => (item?.url || item?.video_url) && !item?.s3_url).length;
        return { media: archived, failures };
    } catch (error) {
        console.error(`[Grievance] Failed to archive media for ${contentId}: ${error.message}`);
        return { media: mediaItems, failures: mediaItems.length };
    }
};

const archiveMentionMediaForStorage = async (mention, archiveMediaFn = archiveTwitterMedia) => {
    const prepared = { ...mention };
    let failures = 0;

    // Pass tweet URL so the Python service (yt-dlp) can download videos from the page
    const tweetUrl = mention.url || (mention.tweet_id ? `https://x.com/i/status/${mention.tweet_id}` : undefined);
    const mainArchive = await archiveTwitterMediaSafe(mention.media, mention.tweet_id, archiveMediaFn, { postUrl: tweetUrl });
    prepared.media = mainArchive.media;
    failures += mainArchive.failures;

    if (mention.context && typeof mention.context === 'object') {
        const contextCopy = { ...mention.context };
        const contextKeys = ['in_reply_to', 'reposted_from', 'quoted'];

        for (const key of contextKeys) {
            const contextPost = mention.context[key];
            if (!contextPost?.content || !Array.isArray(contextPost.content.media) || contextPost.content.media.length === 0) continue;

            // Use context post's tweet_url for video downloads
            const contextTweetUrl = contextPost.tweet_url ||
                (contextPost.tweet_id ? `https://x.com/i/status/${contextPost.tweet_id}` : undefined);

            const contextArchive = await archiveTwitterMediaSafe(
                contextPost.content.media,
                `${mention.tweet_id}_${key}_${contextPost.tweet_id || 'unknown'}`,
                archiveMediaFn,
                { postUrl: contextTweetUrl }
            );

            failures += contextArchive.failures;
            contextCopy[key] = {
                ...contextPost,
                content: {
                    ...contextPost.content,
                    media: contextArchive.media
                }
            };
        }

        prepared.context = contextCopy;
    }

    prepared.upload_failures = failures;
    return prepared;
};

const upsertXGrievancesForSource = async (source, startDate = null, endDate = null, deps = {}) => {
    const searchMentionsFn = deps.searchMentionsFn || searchMentions;
    const GrievanceModel = deps.GrievanceModel || Grievance;
    const archiveMentionFn = deps.archiveMentionFn || archiveMentionMediaForStorage;
    const archiveMediaFn = deps.archiveMediaFn || archiveTwitterMedia;
    const complaintCodeFn = deps.complaintCodeFn || generateComplaintCode;

    const keywords = await getActiveKeywordsCached();
    const mentions = await searchMentionsFn(source.handle, 100, startDate, endDate);
    let newCount = 0;

    for (const mention of mentions) {
        const postDate = toSafeDate(mention.created_at);
        if ((startDate || endDate) && !isWithinDateRange(postDate, startDate, endDate)) continue;

        const existing = await GrievanceModel.findOne({ tweet_id: mention.tweet_id });
        if (existing) continue;

        if (!textMatchesAnyKeyword(mention.text, keywords)) {
            console.log(`[Grievance][X] Skipping tweet ${mention.tweet_id}: no keyword match in "${String(mention.text).substring(0, 80)}..."`);
            continue;
        }

        const preparedMention = await archiveMentionFn(mention, archiveMediaFn);
        if (preparedMention.upload_failures > 0) {
            console.warn(`[Grievance] Partial media archive failure for tweet ${mention.tweet_id}: ${preparedMention.upload_failures} item(s)`);
        }

        const grievance = new GrievanceModel({
            complaint_code: await complaintCodeFn(),
            tweet_id: preparedMention.tweet_id,
            tagged_account: source.handle,
            grievance_source_id: source.id,
            platform: 'x',
            posted_by: {
                handle: preparedMention.author.handle,
                display_name: preparedMention.author.display_name,
                profile_image_url: preparedMention.author.profile_image_url,
                is_verified: preparedMention.author.is_verified,
                follower_count: preparedMention.author.follower_count
            },
            content: {
                text: preparedMention.text,
                full_text: preparedMention.text,
                media: preparedMention.media
            },
            context: preparedMention.context,
            tweet_url: preparedMention.url,
            engagement: preparedMention.engagement,
            post_date: postDate,
            detected_date: new Date(),
            workflow_status: 'received',
            workflow_timestamps: {
                received_at: new Date()
            },
            escalation_count: 0
        });

        syncLegacyFieldsFromWorkflow(grievance, 'received');

        await grievance.save();
        // Sequential analysis: complete before moving to next grievance
        await analyzeGrievanceContent(grievance.id, preparedMention.text, 'x');
        // Extract and persist location from text
        await extractAndSaveLocation(grievance.id, preparedMention.text, preparedMention.author, { tagged_account: source.handle });
        // Stagger delay to reduce model load
        if (mentions.length > 1) await new Promise(r => setTimeout(r, 2000));
        newCount += 1;
    }

    return { newCount, totalFetched: mentions.length };
};

const upsertFacebookGrievancesForSource = async (source, startDate = null, endDate = null) => {
    const keywords = await getActiveKeywordsCached();
    const posts = await rapidApiFacebookService.fetchPagePosts(source.handle, 40, source.display_name);
    let newCount = 0;
    let totalFetched = 0;

    for (const post of posts) {
        const postId = String(post?.id || '').trim();
        if (!postId) continue;

        const postDate = toSafeDate(post.created_at);
        if ((startDate || endDate) && !isWithinDateRange(postDate, startDate, endDate)) continue;

        totalFetched += 1;

        const canonicalPostId = `facebook:post:${postId}`;
        const existingPost = await Grievance.findOne({ tweet_id: canonicalPostId });
        const postUrl = post.url || `https://facebook.com/${postId}`;
        const postMedia = normalizeFacebookMedia(post.media);
        const postAuthorHandle = toSafeHandle(post.author_id || post.author_name);
        const postAuthorName = post.author_name || source.display_name || source.handle;
        const postText = String(post.text || '').trim() || '[Facebook post without text]';

        // Handle-bypass: posts from the tracked source's own page are always kept
        // (their relevance comes from the source itself, not from keyword match).
        // Keyword filter still applies to comments below — those are from third parties.

        if (!existingPost) {
            const grievance = new Grievance({
                complaint_code: await generateComplaintCode(),
                tweet_id: canonicalPostId,
                tagged_account: source.handle,
                grievance_source_id: source.id,
                platform: 'facebook',
                posted_by: {
                    handle: postAuthorHandle,
                    display_name: postAuthorName,
                    profile_image_url: '',
                    is_verified: false,
                    follower_count: 0
                },
                content: {
                    text: postText,
                    full_text: postText,
                    media: postMedia
                },
                tweet_url: postUrl,
                engagement: {
                    likes: post.engagement?.likes || 0,
                    retweets: post.engagement?.shares || 0,
                    replies: post.engagement?.comments || 0,
                    views: post.engagement?.views || 0,
                    quotes: 0
                },
                post_date: postDate,
                detected_date: new Date(),
                workflow_status: 'received',
                workflow_timestamps: {
                    received_at: new Date()
                },
                escalation_count: 0
            });

            syncLegacyFieldsFromWorkflow(grievance, 'received');
            await grievance.save();
            // Sequential analysis: complete before moving to next
            await analyzeGrievanceContent(grievance.id, postText, 'facebook');
            // Extract and persist location from text
            await extractAndSaveLocation(grievance.id, postText, { location: '', bio: '' }, { tagged_account: source.handle });
            // Stagger delay to reduce model load
            await new Promise(r => setTimeout(r, 2000));
            newCount += 1;
        }

        const comments = await rapidApiFacebookService.fetchPostComments(postId, 50);

        for (const comment of comments) {
            const commentId = String(comment?.id || '').trim();
            if (!commentId) continue;

            const commentDate = toSafeDate(comment.created_at, postDate);
            if ((startDate || endDate) && !isWithinDateRange(commentDate, startDate, endDate)) continue;
            const commentText = String(comment.text || '').trim() || '[Facebook comment without text]';

            totalFetched += 1;

            const canonicalCommentId = `facebook:comment:${commentId}`;
            const existingComment = await Grievance.findOne({ tweet_id: canonicalCommentId });
            if (existingComment) continue;

            if (!textMatchesAnyKeyword(commentText, keywords)) {
                console.log(`[Grievance][FB] Skipping comment ${commentId}: no keyword match in "${commentText.substring(0, 80)}..."`);
                continue;
            }

            const commentUrl = postUrl.includes('?')
                ? `${postUrl}&comment_id=${encodeURIComponent(commentId)}`
                : `${postUrl}?comment_id=${encodeURIComponent(commentId)}`;

            const grievance = new Grievance({
                complaint_code: await generateComplaintCode(),
                tweet_id: canonicalCommentId,
                tagged_account: source.handle,
                grievance_source_id: source.id,
                platform: 'facebook',
                posted_by: {
                    handle: toSafeHandle(comment.author_id || comment.author_name),
                    display_name: comment.author_name || 'Facebook User',
                    profile_image_url: comment.author_image || '',
                    is_verified: false,
                    follower_count: 0
                },
                content: {
                    text: commentText,
                    full_text: commentText,
                    media: []
                },
                context: {
                    in_reply_to: {
                        tweet_id: canonicalPostId,
                        tweet_url: postUrl,
                        posted_by: {
                            handle: postAuthorHandle,
                            display_name: postAuthorName,
                            profile_image_url: '',
                            is_verified: false
                        },
                        content: {
                            text: postText,
                            full_text: postText,
                            media: postMedia
                        },
                        post_date: postDate
                    }
                },
                tweet_url: commentUrl,
                engagement: {
                    likes: comment.likes || 0,
                    retweets: 0,
                    replies: comment.replies_count || 0,
                    views: 0,
                    quotes: 0
                },
                post_date: commentDate,
                detected_date: new Date(),
                workflow_status: 'received',
                workflow_timestamps: {
                    received_at: new Date()
                },
                escalation_count: 0
            });

            syncLegacyFieldsFromWorkflow(grievance, 'received');
            await grievance.save();
            // Sequential analysis: complete before moving to next
            await analyzeGrievanceContent(grievance.id, commentText, 'facebook');
            // Extract and persist location from comment text
            await extractAndSaveLocation(grievance.id, commentText, { location: '', bio: '' });
            // Stagger delay to reduce model load
            await new Promise(r => setTimeout(r, 2000));
            newCount += 1;
        }
    }

    return { newCount, totalFetched };
};

const upsertGrievancesForSource = async (source, startDate = null, endDate = null) => {
    const platform = (source.platform || 'x').toLowerCase();
    if (platform === 'facebook') {
        return upsertFacebookGrievancesForSource(source, startDate, endDate);
    }
    return upsertXGrievancesForSource(source, startDate, endDate);
};

/**
 * Fetch and process grievances for all active sources with optional date filter
 */
const fetchAllGrievances = async (startDate = null, endDate = null) => {
    try {
        const sources = await GrievanceSource.find({ is_active: true });
        let totalNew = 0;

        for (const source of sources) {
            const result = await upsertGrievancesForSource(source, startDate, endDate);
            totalNew += result.newCount;

            await GrievanceSource.findOneAndUpdate(
                { id: source.id },
                {
                    $inc: { total_grievances: result.newCount },
                    last_fetched: new Date()
                }
            );
        }

        return { newGrievances: totalNew };
    } catch (error) {
        throw error;
    }
};

/**
 * Fetch grievances for a specific source with optional date filter
 */
const fetchGrievancesForSource = async (sourceId, startDate = null, endDate = null) => {
    try {
        const source = await GrievanceSource.findOne({ id: sourceId });
        if (!source) {
            throw new Error('Source not found');
        }

        const result = await upsertGrievancesForSource(source, startDate, endDate);

        await GrievanceSource.findOneAndUpdate(
            { id: sourceId },
            {
                $inc: { total_grievances: result.newCount },
                last_fetched: new Date()
            }
        );

        return { newGrievances: result.newCount, total: result.totalFetched };
    } catch (error) {
        throw error;
    }
};

/**
 * Generate unique report number
 */
const generateReportNumber = async () => {
    const date = new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);

    // Get count of reports generated today
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const count = await Grievance.countDocuments({
        'complaint.report_number': { $exists: true, $ne: null },
        'complaint.action_taken_at': { $gte: startOfDay, $lte: endOfDay }
    });

    const serial = String(count + 1).padStart(3, '0');
    return `X-GRV-${day}-${month}-${year}-${serial}`;
};

/**
 * Generate PDF report for a grievance
 */
const generatePDFReport = async (grievanceId) => {
    try {
        const grievance = await Grievance.findOne({ id: grievanceId });
        if (!grievance) {
            throw new Error('Grievance not found');
        }

        // Generate report number if not exists
        if (!grievance.complaint.report_number) {
            grievance.complaint.report_number = await generateReportNumber();
            grievance.complaint.action_taken_at = new Date();
            await grievance.save();
        }

        const settings = await GrievanceSettings.findOne({ id: 'grievance_settings' });
        const reportSettings = settings?.report_settings || {};

        // Create PDF
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));

        // Header
        doc.fontSize(18).font('Helvetica-Bold')
            .text(reportSettings.header_text || 'OFFICIAL GRIEVANCE REPORT', { align: 'center' });

        doc.moveDown();
        doc.fontSize(12).font('Helvetica')
            .text(`Report Number: ${grievance.complaint.report_number}`, { align: 'center' });
        doc.text(`Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, { align: 'center' });

        doc.moveDown(2);

        // Complaint Details Table
        doc.fontSize(14).font('Helvetica-Bold').text('COMPLAINT DETAILS');
        doc.moveDown(0.5);

        // Draw table
        const tableTop = doc.y;
        const tableLeft = 50;
        const colWidth = 250;

        const drawRow = (label, value, y) => {
            doc.font('Helvetica-Bold').fontSize(10).text(label, tableLeft, y, { width: 150 });
            doc.font('Helvetica').fontSize(10).text(value || 'N/A', tableLeft + 160, y, { width: colWidth });
        };

        let currentY = tableTop;
        const rowHeight = 25;

        drawRow('Posted By:', `@${grievance.posted_by.handle}`, currentY);
        currentY += rowHeight;

        drawRow('Post Date & Time:', new Date(grievance.post_date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), currentY);
        currentY += rowHeight;

        drawRow('Detected Date & Time:', new Date(grievance.detected_date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), currentY);
        currentY += rowHeight;

        drawRow('Tagged Account:', grievance.tagged_account, currentY);
        currentY += rowHeight;

        drawRow('Platform:', 'X (Twitter)', currentY);
        currentY += rowHeight;

        drawRow('Priority:', (grievance.complaint.priority || 'Medium').toUpperCase(), currentY);
        currentY += rowHeight;

        drawRow('Status:', (grievance.complaint.status || 'Pending').replace('_', ' ').toUpperCase(), currentY);
        currentY += rowHeight;

        doc.moveDown(2);

        // Post Content
        doc.fontSize(14).font('Helvetica-Bold').text('POST CONTENT');
        doc.moveDown(0.5);

        doc.rect(tableLeft, doc.y, 500, 100).stroke();
        const contentY = doc.y + 10;
        doc.fontSize(10).font('Helvetica').text(grievance.content.text, tableLeft + 10, contentY, {
            width: 480,
            height: 80
        });

        doc.y = contentY + 90;
        doc.moveDown();

        // Engagement Stats
        if (reportSettings.include_engagement_stats !== false) {
            doc.fontSize(14).font('Helvetica-Bold').text('ENGAGEMENT METRICS');
            doc.moveDown(0.5);

            const eng = grievance.engagement || {};
            doc.fontSize(10).font('Helvetica');
            doc.text(`Likes: ${eng.likes || 0}  |  Retweets: ${eng.retweets || 0}  |  Replies: ${eng.replies || 0}  |  Views: ${eng.views || 0}`);
        }

        doc.moveDown(2);

        // Action Details
        if (grievance.complaint.action_taken) {
            doc.fontSize(14).font('Helvetica-Bold').text('ACTION DETAILS');
            doc.moveDown(0.5);
            doc.fontSize(10).font('Helvetica').text(grievance.complaint.action_taken);
        }

        // Footer
        doc.moveDown(2);
        doc.fontSize(8).font('Helvetica')
            .text(reportSettings.footer_text || 'This is a system-generated report.', { align: 'center' });

        doc.text(`Tweet URL: ${grievance.tweet_url}`, { align: 'center' });

        doc.end();

        return new Promise((resolve, reject) => {
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(chunks);
                resolve({
                    buffer: pdfBuffer,
                    filename: `${grievance.complaint.report_number}.pdf`,
                    reportNumber: grievance.complaint.report_number
                });
            });
            doc.on('error', reject);
        });
    } catch (error) {
        throw error;
    }
};

/**
 * Get grievance statistics
 */
const getGrievanceStats = async () => {
    try {
        const total = await Grievance.countDocuments({ is_active: true });
        const unclassified = await Grievance.countDocuments({ classification: 'unclassified', is_active: true });
        const acknowledged = await Grievance.countDocuments({ classification: 'acknowledged', is_active: true });
        const complaints = await Grievance.countDocuments({ classification: 'complaint', is_active: true });

        const pending = await Grievance.countDocuments({
            classification: 'complaint',
            'complaint.status': 'pending',
            is_active: true
        });
        const sent = await Grievance.countDocuments({
            classification: 'complaint',
            'complaint.status': 'sent',
            is_active: true
        });
        const reviewed = await Grievance.countDocuments({
            classification: 'complaint',
            'complaint.status': 'reviewed',
            is_active: true
        });
        const caseBooked = await Grievance.countDocuments({
            classification: 'complaint',
            'complaint.status': 'case_booked',
            is_active: true
        });
        const workflowPending = await Grievance.countDocuments({
            is_active: true,
            workflow_status: { $in: ['received', 'reviewed', 'action_taken'] }
        });
        const workflowClosed = await Grievance.countDocuments({
            is_active: true,
            workflow_status: 'closed'
        });
        const workflowFir = await Grievance.countDocuments({
            is_active: true,
            workflow_status: 'converted_to_fir'
        });

        const sources = await GrievanceSource.countDocuments({ is_active: true });

        return {
            total,
            total_complaints: total,
            unclassified,
            acknowledged,
            complaints,
            pending: workflowPending,
            closed: workflowClosed,
            converted_to_fir: workflowFir,
            byStatus: {
                pending,
                sent,
                reviewed,
                case_booked: caseBooked
            },
            activeSources: sources
        };
    } catch (error) {
        throw error;
    }
};

/**
 * Generate 3 search variants from a keyword:
 *  - @handle variant (mention)
 *  - #hashtag variant
 *  - plain text variant (stripped of @ and #)
 */
const generateKeywordVariants = (keyword) => {
    const raw = keyword.trim();
    if (!raw) return [];
    // Strip leading @ or # to get the base term
    const base = raw.replace(/^[@#]+/, '').trim();
    if (!base) return [];
    const variants = new Set();
    variants.add(`@${base}`);       // as handle/mention
    variants.add(`#${base}`);       // as hashtag
    variants.add(base);             // as plain text
    return [...variants];
};

/**
 * Search X for tweets matching a keyword query.
 */
const searchXByKeyword = async (query, limit = 50) => {
    try {
        if (!query.trim()) return [];
        const response = await rapidApiGet('/search', { query: query.trim(), type: 'Latest', count: Math.min(100, limit) });

        const instructions = response.data?.result?.timeline?.instructions ||
            response.data?.timeline?.instructions ||
            response.data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
        const timelineEntries = instructions.find(i => i.type === 'TimelineAddEntries')?.entries ||
            instructions[0]?.entries || [];

        const tweets = [];
        const processedIds = new Set();
        const parentTweetCache = new Map();

        for (const entry of timelineEntries) {
            if (entry.entryId?.startsWith('cursor-')) continue;
            let tweetResult = entry.content?.itemContent?.tweet_results?.result;
            if (!tweetResult) continue;
            if (tweetResult.__typename === 'TweetWithVisibilityResults' && tweetResult.tweet) tweetResult = tweetResult.tweet;
            if (tweetResult.__typename === 'TweetUnavailable' || tweetResult.__typename === 'TweetTombstone') continue;
            const legacy = tweetResult.legacy;
            if (!legacy || processedIds.has(legacy.id_str)) continue;
            processedIds.add(legacy.id_str);

            const userResult = tweetResult.core?.user_results?.result;
            const userLegacy = userResult?.legacy || {};
            let media = extractMediaFromLegacy(legacy);

            let repostedFrom = null;
            let retweetResult = legacy.retweeted_status_result?.result;
            if (retweetResult && retweetResult.__typename === 'TweetWithVisibilityResults' && retweetResult.tweet) retweetResult = retweetResult.tweet;
            if (retweetResult) {
                repostedFrom = extractTweetSnapshot(retweetResult);
                if ((!media || media.length === 0) && repostedFrom?.content?.media?.length) media = repostedFrom.content.media;
            }

            let quoted = null;
            let rawQuote = tweetResult?.quoted_status_result?.result || tweetResult?.quoted_status_result;
            if (rawQuote && (rawQuote.result || rawQuote.tweet)) rawQuote = rawQuote.result || rawQuote.tweet;
            if (rawQuote && rawQuote.__typename === 'TweetWithVisibilityResults' && rawQuote.tweet) rawQuote = rawQuote.tweet;
            if (rawQuote) quoted = extractTweetSnapshot(rawQuote);
            else if (legacy.quoted_status_id_str) quoted = await fetchTweetById(legacy.quoted_status_id_str, parentTweetCache);

            let inReplyTo = null;
            if (legacy.in_reply_to_status_id_str) {
                inReplyTo = await fetchTweetById(legacy.in_reply_to_status_id_str, parentTweetCache);
                if (!inReplyTo) {
                    inReplyTo = {
                        tweet_id: String(legacy.in_reply_to_status_id_str),
                        tweet_url: legacy.in_reply_to_screen_name
                            ? `https://x.com/${legacy.in_reply_to_screen_name}/status/${legacy.in_reply_to_status_id_str}`
                            : `https://x.com/i/web/status/${legacy.in_reply_to_status_id_str}`,
                        posted_by: { handle: legacy.in_reply_to_screen_name || undefined },
                        content: {}, post_date: null
                    };
                }
            }

            let createdAt = new Date();
            try { if (legacy.created_at) { const p = new Date(legacy.created_at); if (!isNaN(p)) createdAt = p; } } catch (e) { }
            const screenName = userLegacy.screen_name || userResult?.core?.screen_name || 'unknown';
            const context = {
                ...(inReplyTo ? { in_reply_to: inReplyTo } : {}),
                ...(repostedFrom ? { reposted_from: repostedFrom } : {}),
                ...(quoted ? { quoted } : {})
            };
            const noteText = tweetResult.note_tweet?.note_tweet_results?.result?.text;
            const text = noteText || legacy.full_text || legacy.text || '';

            tweets.push({
                tweet_id: legacy.id_str,
                text, url: `https://x.com/${screenName}/status/${legacy.id_str}`,
                created_at: createdAt,
                author: { handle: screenName, display_name: userLegacy.name || screenName, profile_image_url: userLegacy.profile_image_url_https || userResult?.avatar?.image_url, is_verified: userResult?.is_blue_verified || userLegacy.verified || false, follower_count: userLegacy.followers_count || 0 },
                media, context: Object.keys(context).length > 0 ? context : undefined,
                engagement: { likes: legacy.favorite_count || 0, retweets: legacy.retweet_count || 0, replies: legacy.reply_count || 0, views: parseInt(tweetResult.views?.count || '0', 10), quotes: legacy.quote_count || 0 }
            });
        }
        return tweets;
    } catch (error) {
        console.error(`[X-KeywordSearch] Failed for "${query}": ${error.message}`);
        return [];
    }
};

/**
 * Create a Grievance doc from a generic post object (platform-agnostic).
 */
const createGrievanceFromPost = async (post, platform, taggedKeyword, forceLocation = null, options = {}) => {
    const existing = await Grievance.findOne({ tweet_id: post.tweet_id });
    if (existing) return null;

    // Keyword searches must match a tracking keyword. `skipKeywordGate` is for
    // callers that have already judged relevance themselves (monitored-profile
    // alerts no longer flow into Mentions, so no caller sets it today).
    const keywords = options.skipKeywordGate ? null : await getActiveKeywordsCached();
    if (!options.skipKeywordGate && !textMatchesAnyKeyword(post.text, keywords)) {
        console.log(`[createGrievanceFromPost] Skipping ${post.tweet_id}: no keyword match in "${String(post.text).substring(0, 80)}..."`);
        return null;
    }

    const postDate = toSafeDate(post.created_at);

    // Sanitize media — ensure all URLs are plain strings (FB sometimes sends {uri, height, width})
    const VIDEO_EXT_RE = /\.(mp4|m3u8|webm|mov|m4s)(\?|$)/i;
    const sanitizedMedia = (post.media || []).map(m => {
        let url = typeof m === 'string' ? m : (typeof m.url === 'string' ? m.url : (m.url?.uri || m.uri || m.src || ''));
        // Read either `preview_url` (new shape) or `preview` (X service legacy).
        // Reject anything that looks like a video stream — those belong in
        // video_url, not preview_url, and would otherwise blank the UI poster.
        let previewUrl = typeof m.preview_url === 'string' ? m.preview_url
            : (m.preview_url?.uri
                || (typeof m.preview === 'string' ? m.preview : m.preview?.uri)
                || '');
        if (VIDEO_EXT_RE.test(previewUrl)) previewUrl = '';
        let videoUrl = typeof m.video_url === 'string' ? m.video_url : (m.video_url?.uri || undefined);

        const original_url = String(url || '');
        const original_video_url = videoUrl ? String(videoUrl) : (m.type === 'video' ? original_url : undefined);

        // Proxy media to bypass CORS/Referer issues
        const mediaAnalyzerService = require('./mediaAnalyzerService');
        if (url && (url.includes('twimg.com') || url.includes('fbcdn.net') || url.includes('cdninstagram.com'))) {
            url = mediaAnalyzerService.MEDIA_ANALYZER_URL.includes('127.0.0.1') || mediaAnalyzerService.MEDIA_ANALYZER_URL.includes('localhost')
                ? `/api/media/stream?url=${encodeURIComponent(url)}`
                : url;
        }
        if (videoUrl && (videoUrl.includes('twimg.com') || videoUrl.includes('fbcdn.net') || videoUrl.includes('cdninstagram.com'))) {
            videoUrl = mediaAnalyzerService.MEDIA_ANALYZER_URL.includes('127.0.0.1') || mediaAnalyzerService.MEDIA_ANALYZER_URL.includes('localhost')
                ? `/api/media/stream?url=${encodeURIComponent(videoUrl)}`
                : videoUrl;
        }

        return {
            type: m.type || 'photo',
            url: String(url || ''),
            preview_url: String(previewUrl || ''),
            original_url: original_url,
            ...(videoUrl ? { video_url: String(videoUrl), original_video_url } : {})
        };
    }).filter(m => m.url);

    const textContent = post.text || '(no text)';

    const grievance = new Grievance({
        complaint_code: await generateComplaintCode(),
        tweet_id: post.tweet_id,
        tagged_account: taggedKeyword,
        platform,
        posted_by: {
            handle: post.author?.handle || post.author?.author_handle || 'unknown',
            display_name: post.author?.display_name || post.author?.handle || 'Unknown',
            profile_image_url: post.author?.profile_image_url || '',
            is_verified: post.author?.is_verified || false,
            follower_count: post.author?.follower_count || 0
        },
        content: {
            text: textContent,
            full_text: textContent,
            media: sanitizedMedia
        },
        context: post.context,
        tweet_url: post.url || '',
        engagement: post.engagement || { likes: 0, retweets: 0, replies: 0, views: 0, quotes: 0 },
        post_date: postDate,
        detected_date: new Date(),
        workflow_status: 'received',
        workflow_timestamps: { received_at: new Date() },
        escalation_count: 0
    });

    syncLegacyFieldsFromWorkflow(grievance, 'received');
    
    if (forceLocation) {
        grievance.detected_location = {
            ...forceLocation,
            location_found: true,
            confidence: 1.0
        };
    }

    await grievance.save();
    await analyzeGrievanceContent(grievance.id, post.text || '', platform);
    
    // Extract and persist location only if NOT forced
    if (!forceLocation) {
        await extractAndSaveLocation(grievance.id, post.text || '', post.author || {}, { tagged_account: grievance.tagged_account });
    }

    // Trigger background media archival if video exists
    if (sanitizedMedia.some(m => m.type === 'video')) {
        const mediaAnalyzerService = require('./mediaAnalyzerService');
        const firstVideo = sanitizedMedia.find(m => m.type === 'video');
        const downloadUrl = firstVideo.original_video_url || firstVideo.original_url;
        if (firstVideo && downloadUrl) {
            console.log(`[MediaArchival] Triggering archival for grievance ${grievance.id} with URL: ${downloadUrl}`);
            mediaAnalyzerService.downloadVideo(downloadUrl).then(async (result) => {
                if (result && result.download_url) {
                    console.log(`[MediaArchival] Archival SUCCESS for ${grievance.id}. Result URL: ${result.download_url}`);
                    await Grievance.findOneAndUpdate(
                        { id: grievance.id },
                        { $set: { 'content.archived_video_url': result.download_url } }
                    );
                    console.log(`[MediaArchival] Updated DB for ${grievance.id}`);
                } else {
                    console.warn(`[MediaArchival] Archival returned no download_url for ${grievance.id}`, result);
                }
            }).catch(err => {
                console.error(`[MediaArchival] Archival failed for ${grievance.id}: ${err.message}`);
            });
        }
    }

    return grievance;
};

/**
 * Fetch content from Facebook, Instagram, and YouTube
 * matching keywords from the Keyword model.
 * @param {string|null} platformFilter - 'facebook', 'instagram', 'youtube', or null for all
 */
const fetchKeywordGrievances = async (platformFilter = null) => {
    try {
        const keywords = await Keyword.find({ is_active: true });

        if (keywords.length === 0) {
            console.log('[KeywordFetch] No active keywords configured');
            return { newGrievances: 0, keywordsSearched: 0 };
        }

        const runFB = !platformFilter || platformFilter === 'facebook';
        const runIG = !platformFilter || platformFilter === 'instagram';
        const runYT = !platformFilter || platformFilter === 'youtube';
        const runX = !platformFilter || platformFilter === 'x' || platformFilter === 'twitter';
        console.log(`[KeywordFetch] Platforms: FB=${runFB} IG=${runIG} YT=${runYT} X=${runX}`);

        let totalNew = 0;
        let keywordsSearched = 0;
        const seenTweetIds = new Set();

        for (const kw of keywords) {
            const rawKeyword = (kw.keyword || '').trim();
            if (!rawKeyword) continue;
            keywordsSearched++;

            const variants = generateKeywordVariants(rawKeyword);
            const baseKeyword = rawKeyword.replace(/^[@#]+/, '').trim();
            console.log(`[KeywordFetch] Keyword: "${rawKeyword}" → variants: ${variants.join(', ')}`);

            // Run selected platforms in parallel for speed
            const platformResults = await Promise.allSettled([
                // ── Facebook (all 3 variants) ──
                (async () => {
                    if (!runFB) return 0;
                    let count = 0;
                    for (const variant of variants) {
                        try {
                            console.log(`[KeywordFetch][FB] Searching: "${variant}"`);
                            const fbPosts = await rapidApiFacebookService.searchPosts(variant);
                            console.log(`[KeywordFetch][FB] Found ${fbPosts.length} for "${variant}"`);

                            for (const fbPost of fbPosts) {
                                const postId = String(fbPost.id || '').trim();
                                if (!postId) continue;
                                const canonicalId = `facebook:keyword:${postId}`;
                                if (seenTweetIds.has(canonicalId)) continue;
                                seenTweetIds.add(canonicalId);

                                if (!passesKeywordGate(fbPost.text, fbPost.author_handle || fbPost.author || '', rawKeyword)) {
                                    console.log(`[KeywordFetch][FB] Skipping post ${postId}: returned by API but text does not contain "${rawKeyword}"`);
                                    continue;
                                }

                                const fbMedia = (fbPost.media || []).map(m => {
                                    if (typeof m === 'string') {
                                        const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(m);
                                        return { type: isVideo ? 'video' : 'photo', url: m, video_url: isVideo ? m : undefined, preview_url: !isVideo ? m : undefined };
                                    }
                                    // Handle FB objects like {uri, height, width, id}
                                    const url = typeof m.url === 'string' ? m.url : (m.uri || m.src || '');
                                    const isVideo = m.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(String(url));
                                    return { type: isVideo ? 'video' : 'photo', url: String(url), preview_url: String(m.preview || m.thumbnail || url), ...(isVideo ? { video_url: String(url) } : {}) };
                                }).filter(m => m.url);

                                const post = {
                                    tweet_id: canonicalId,
                                    text: fbPost.text || '',
                                    url: fbPost.url || `https://facebook.com/${postId}`,
                                    created_at: fbPost.created_at,
                                    author: { handle: fbPost.author_handle || fbPost.author || 'facebook_user', display_name: fbPost.author || 'Facebook User', profile_image_url: fbPost.author_avatar || '', is_verified: false, follower_count: 0 },
                                    media: fbMedia,
                                    engagement: { likes: fbPost.metrics?.likes || 0, retweets: fbPost.metrics?.shares || 0, replies: fbPost.metrics?.comments || 0, views: fbPost.metrics?.views || 0, quotes: 0 }
                                };
                                const created = await createGrievanceFromPost(post, 'facebook', rawKeyword);
                                if (created) count++;
                            }
                        } catch (err) {
                            console.error(`[KeywordFetch][FB] Error for "${variant}": ${err.message}`);
                        }
                    }
                    return count;
                })(),

                // ── X / Twitter (all 3 variants) ──
                (async () => {
                    if (!runX) return 0;
                    let count = 0;
                    for (const variant of variants) {
                        try {
                            console.log(`[KeywordFetch][X] Searching: "${variant}"`);
                            const xTweets = await rapidApiXService.searchTweets(variant);
                            console.log(`[KeywordFetch][X] Found ${xTweets.length} for "${variant}"`);

                            for (const tweet of xTweets) {
                                const canonicalId = `x:keyword:${tweet.id}`;
                                if (seenTweetIds.has(canonicalId)) continue;
                                seenTweetIds.add(canonicalId);

                                if (!passesKeywordGate(tweet.text, tweet.author_handle || tweet.author || '', rawKeyword)) {
                                    console.log(`[KeywordFetch][X] Skipping tweet ${tweet.id}: returned by API but text does not contain "${rawKeyword}"`);
                                    continue;
                                }

                                // Build a thread/quote context object so the
                                // grievance popup can render the parent tweet
                                // and any quoted snapshot the search response
                                // already carries. The reply parent is a stub
                                // here (only id + handle) — the UI may resolve
                                // its full body lazily; ingestion stays cheap.
                                const ctx = {};
                                if (tweet.in_reply_to_id) {
                                    ctx.in_reply_to = {
                                        tweet_id: String(tweet.in_reply_to_id),
                                        tweet_url: tweet.in_reply_to_handle
                                            ? `https://x.com/${tweet.in_reply_to_handle}/status/${tweet.in_reply_to_id}`
                                            : `https://x.com/i/web/status/${tweet.in_reply_to_id}`,
                                        posted_by: { handle: tweet.in_reply_to_handle || undefined },
                                        content: {},
                                        post_date: null,
                                    };
                                }
                                if (tweet.quoted_content) {
                                    const qc = tweet.quoted_content;
                                    ctx.quoted = {
                                        tweet_id: qc.tweet_id || null,
                                        tweet_url: qc.url || (qc.author_handle && qc.tweet_id
                                            ? `https://x.com/${qc.author_handle}/status/${qc.tweet_id}` : null),
                                        posted_by: {
                                            handle: qc.author_handle || null,
                                            display_name: qc.author_name || null,
                                            profile_image_url: qc.profile_image_url || null,
                                        },
                                        content: { text: qc.text || '', media: qc.media || [] },
                                        post_date: qc.created_at || null,
                                    };
                                }
                                if (tweet.conversation_id) ctx.conversation_id = String(tweet.conversation_id);

                                const post = {
                                    tweet_id: canonicalId,
                                    text: tweet.text || '',
                                    url: tweet.url || `https://x.com/${tweet.author_handle}/status/${tweet.id}`,
                                    created_at: tweet.created_at,
                                    author: {
                                        handle: tweet.author_handle || 'x_user',
                                        display_name: tweet.author || tweet.author_handle || 'X User',
                                        profile_image_url: tweet.author_avatar || '',
                                        is_verified: tweet.verified || false,
                                        follower_count: 0
                                    },
                                    media: tweet.media || [],
                                    engagement: {
                                        likes: parseInt(tweet.metrics?.like) || 0,
                                        retweets: parseInt(tweet.metrics?.retweet) || 0,
                                        replies: parseInt(tweet.metrics?.reply) || 0,
                                        views: parseInt(tweet.metrics?.views) || 0,
                                        quotes: parseInt(tweet.metrics?.quote) || 0
                                    },
                                    context: Object.keys(ctx).length > 0 ? ctx : undefined,
                                };
                                const created = await createGrievanceFromPost(post, 'x', rawKeyword);
                                if (created) count++;
                            }
                        } catch (err) {
                            console.error(`[KeywordFetch][X] Error for "${variant}": ${err.message}`);
                        }
                    }
                    return count;
                })(),

                // ── Instagram (username-based — API only fetches by exact IG username) ──
                (async () => {
                    if (!runIG) return 0;
                    // Instagram API only works with exact usernames, not general text queries.
                    // Only attempt if the keyword looks like a handle (@username or single word, no spaces)
                    const igUsername = baseKeyword.replace(/\s+/g, '');
                    if (baseKeyword.includes(' ') && !rawKeyword.startsWith('@')) {
                        console.log(`[KeywordFetch][IG] Skipping "${baseKeyword}"(not a username)`);
                        return 0;
                    }
                    let count = 0;
                    try {
                        console.log(`[KeywordFetch][IG] Fetching posts for user: "${igUsername}"`);
                        const igPosts = await rapidApiInstagramService.searchPosts(igUsername);
                        console.log(`[KeywordFetch][IG] Found ${igPosts.length} for "${igUsername}"`);

                        for (const igPost of igPosts) {
                            const postId = String(igPost.id || '').trim();
                            if (!postId) continue;
                            const canonicalId = `instagram: keyword:${postId} `;
                            if (seenTweetIds.has(canonicalId)) continue;
                            seenTweetIds.add(canonicalId);

                            if (!passesKeywordGate(igPost.text, igPost.author_handle || igPost.username || '', rawKeyword)) {
                                console.log(`[KeywordFetch][IG] Skipping post ${postId}: text does not contain "${rawKeyword}"`);
                                continue;
                            }

                            const igMedia = (igPost.media || []).map(m => ({
                                type: m.type || 'photo', url: m.url, preview_url: m.url
                            }));

                            const post = {
                                tweet_id: canonicalId,
                                text: igPost.text || '',
                                url: igPost.url || '',
                                created_at: igPost.created_at,
                                author: { handle: igPost.author_handle || igUsername, display_name: igPost.author || igUsername, profile_image_url: igPost.author_avatar || '', is_verified: false, follower_count: 0 },
                                media: igMedia,
                                engagement: { likes: igPost.metrics?.likes || 0, retweets: 0, replies: igPost.metrics?.comments || 0, views: igPost.metrics?.views || 0, quotes: 0 }
                            };
                            const created = await createGrievanceFromPost(post, 'instagram', rawKeyword);
                            if (created) count++;
                        }
                    } catch (err) {
                        console.error(`[KeywordFetch][IG] Error for "${igUsername}": ${err.message} `);
                    }
                    return count;
                })(),

                // ── YouTube (all 3 variants) ──
                (async () => {
                    if (!runYT) return 0;
                    let count = 0;
                    for (const variant of variants) {
                        try {
                            console.log(`[KeywordFetch][YT] Searching: "${variant}"`);
                            const ytVideos = await youtubeService.searchVideos(variant);
                            console.log(`[KeywordFetch][YT] Found ${(ytVideos || []).length} for "${variant}"`);

                            for (const video of (ytVideos || [])) {
                                const videoId = video.id;
                                if (!videoId) continue;
                                const canonicalId = `youtube: keyword:${videoId} `;
                                if (seenTweetIds.has(canonicalId)) continue;
                                seenTweetIds.add(canonicalId);

                                const text = `${video.title || ''} \n\n${video.description || ''} `.trim();
                                if (!passesKeywordGate(text, video.channelTitle || video.channelId || '', rawKeyword)) {
                                    console.log(`[KeywordFetch][YT] Skipping video ${videoId}: title/description does not contain "${rawKeyword}"`);
                                    continue;
                                }

                                const thumbnail = video.thumbnails?.high?.url || video.thumbnails?.medium?.url || video.thumbnails?.default?.url || '';

                                const post = {
                                    tweet_id: canonicalId,
                                    text,
                                    url: `https://www.youtube.com/watch?v=${videoId}`,
                                    created_at: video.publishedAt,
                                    author: { handle: video.channelId || 'youtube_channel', display_name: video.channelTitle || 'YouTube Channel', profile_image_url: '', is_verified: false, follower_count: 0 },
                                    media: thumbnail ? [{ type: 'photo', url: thumbnail, preview_url: thumbnail }] : [],
                                    engagement: { likes: video.statistics?.likeCount || 0, retweets: 0, replies: video.statistics?.commentCount || 0, views: video.statistics?.viewCount || 0, quotes: 0 }
                                };
                                const created = await createGrievanceFromPost(post, 'youtube', rawKeyword);
                                if (created) count++;
                            }
                        } catch (err) {
                            console.error(`[KeywordFetch][YT] Error for "${variant}": ${err.message}`);
                        }
                    }
                    return count;
                })()
            ]);

            // Sum results from all platforms
            for (const result of platformResults) {
                if (result.status === 'fulfilled') totalNew += result.value;
            }
        }

        console.log(`[KeywordFetch] Complete: ${totalNew} new posts from ${keywordsSearched} keywords`);
        return { newGrievances: totalNew, keywordsSearched };
    } catch (error) {
        console.error(`[KeywordFetch] Error: ${error.message}`);
        throw error;
    }
};

module.exports = {
    fetchUserProfile,
    searchMentions,
    fetchAllGrievances,
    fetchGrievancesForSource,
    generateReportNumber,
    generatePDFReport,
    getGrievanceStats,
    analyzeGrievanceContent,
    retryPendingGrievanceAnalyses,
    extractAndSaveLocation,
    fetchKeywordGrievances,
    createGrievanceFromPost,
    textMatchesAnyKeyword,
    buildGrievanceAnalysisUpdate,
    passesKeywordGate,
    significantTokens,
    keywordTokenMatches,
    getActiveKeywordsCached,
    __private: {
        archiveMentionMediaForStorage,
        upsertXGrievancesForSource
    }
};
