/**
 * politicalSentimentService.js
 * ─────────────────────────────────────────────────────────────────────
 * Stage 3 of the target-aware sentiment pipeline.
 *
 * ROLE CHANGE — read this before editing the prompt.
 *
 * This service used to ask the LLM for the political VERDICT (stance,
 * beneficiary, who benefits) and then trust it. That is non-deterministic: on a
 * post naming both camps the same text produced `pro_target_indirect` on one
 * run and `anti_target` on another, because the answer depended on which
 * entities the model happened to list first.
 *
 * It is now a FACTUAL EXTRACTOR only. It asks the model for:
 *   • english_translation, candidate_actors, candidate_subjects
 *   • sentiment_target — the ONE entity the tone is aimed AT (≠ the speaker)
 *   • target_tone      — the tone aimed at THAT entity (≠ whole-post mood)
 *   • generic_sentiment, emotion, reasoning, language_detected
 *
 * The verdict is then computed DETERMINISTICALLY downstream:
 *   entityResolver → stanceEngine → confidenceGate
 *
 * The model is explicitly told NOT to emit stance or beneficiary. If it does
 * anyway, we ignore it.
 *
 *   analyzePoliticalSentiment(text, politicalContext, options)
 *     → { target_entity, target_entity_canonical, relevance_score,
 *         stance, beneficiary, attack_target, narrative_direction,
 *         target_sentiment,   // FINAL client-relative: positive|negative|neutral
 *         bsk_sentiment,      // legacy mirror of target_sentiment
 *         generic_sentiment,  // whole-post tone, for display
 *         target_tone,        // tone AT the target — what the matrix consumed
 *         emotion, confidence, needs_review, client_relevance, target,
 *         language_detected, reasoning, english_translation, provider }
 */

const { chatJson } = require('./llmProvider');
const { resolve: resolveEntities } = require('./entityResolver');
const { compute: computeStance } = require('./stanceEngine');
const { fuse: fuseConfidence } = require('./confidenceGate');
const {
    POLITICAL_ENTITIES,
    PRIMARY_TARGET_KEY,
    SECONDARY_TARGET_KEY,
} = require('../config/politicalEntities');
const { OUR_PARTY, OPPOSITION_PARTIES, ALLY_PARTIES } = require('../config/politicalData');
const { STATE_NAME, COUNTRY, LANGUAGES_DESCRIPTION } = require('../config/deployment');

const LLM_TIMEOUT = parseInt(process.env.POLITICAL_SENTIMENT_TIMEOUT_MS || '60000', 10);

const ALLOWED_STANCES = [
    'pro_target',
    'anti_target',
    'pro_target_indirect',
    'anti_target_indirect',
    'neutral',
    'unrelated',
];

// Sentiment labels exposed downstream / to the DB: positive | negative | neutral.
// NOTE: `stance` above keeps its own 'neutral' value — that is a political
// STANCE, not a sentiment label, and must not be confused with this list.
const ALLOWED_GENERIC_SENTIMENTS = ['positive', 'negative', 'neutral'];
const ALLOWED_BENEFICIARIES = ['ours', 'opposition', 'none'];
const ALLOWED_CLIENT_RELEVANCE = ['relevant', 'not_relevant', 'uncertain'];
const ALLOWED_TARGETS = ['ruling_party', 'state_government', 'opposition', 'other', 'unknown', 'none'];
const ALLOWED_EMOTIONS = [
    'anger', 'joy', 'fear', 'sadness', 'frustration',
    'hope', 'pride', 'sarcasm', 'concern', 'neutral',
];

/** Legacy stance vocabulary from before the rename — accepted, then mapped. */
const LEGACY_STANCE_MAP = {
    pro_bsk: 'pro_target',
    anti_bsk: 'anti_target',
    pro_bsk_indirect: 'pro_target_indirect',
    anti_bsk_indirect: 'anti_target_indirect',
    pro_client: 'pro_target',
    anti_client: 'anti_target',
};

const PRIMARY = POLITICAL_ENTITIES[PRIMARY_TARGET_KEY];
const SECONDARY = POLITICAL_ENTITIES[SECONDARY_TARGET_KEY];

/** Camps described from the roster, so the prompt can never go stale. */
const ALLY_SUMMARY = [OUR_PARTY, ...ALLY_PARTIES]
    .map((p) => {
        const aka = (p.aliases || []).filter((a) => a !== p.name).slice(0, 2).join('/');
        return `${p.name}${aka ? ` (also called ${aka})` : ''}`;
    })
    .join('; ');

const OPPOSITION_SUMMARY = OPPOSITION_PARTIES
    .map((p) => {
        const leaders = p.leaders
            .filter((l) => !l.derived)
            .map((l) => l.shortName)
            .slice(0, 4)
            .join(', ');
        const aka = (p.aliases || []).filter((a) => a !== p.name).slice(0, 2).join('/');
        return `${p.name}${aka ? ` (also called ${aka})` : ''}${leaders ? ` — ${leaders}` : ''}`;
    })
    .join('; ');

/* ─── JSON extraction (tolerant to wrapping prose) ─────────────────── */

const extractJson = (blob) => {
    if (!blob) return null;
    if (typeof blob === 'object') return blob;
    const text = String(blob);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch (err) {
        return null;
    }
};

/* ─── prompt ───────────────────────────────────────────────────────── */

const buildPrompt = (text, ctx) => {
    const mentionedList = ctx.mentioned_entities && ctx.mentioned_entities.length > 0
        ? ctx.mentioned_entities
            .map((m) => `  • ${m.canonical} — ${m.alignment} of ${OUR_PARTY.name}${m.party ? ` (${m.party})` : ''}`)
            .join('\n')
        : '  (none detected by the deterministic gate — you must still read the text)';

    const langList = Object.entries(ctx.language_hints || {})
        .filter(([, v]) => v)
        .map(([k]) => k.replace('has_', ''))
        .join(', ') || 'unknown';

    // FIELD ORDER MATTERS: "reasoning" is requested BEFORE the tone labels, so
    // the model articulates its read of the text first and labels it second,
    // instead of committing to a label and writing a reasoning line to match.
    // This is what prevents "reasoning says critical, sentiment says positive".
    return `You are a factual extractor for political media monitoring in ${STATE_NAME}, ${COUNTRY}. Posts may be written in ${LANGUAGES_DESCRIPTION}.

Read the input text and return STRICT JSON only, with these fields IN THIS ORDER:
"english_translation", "candidate_actors" (array of {text, span}), "candidate_subjects" (array of {text, span, subject_type}), "praised" (array of {text}: every person, party or government the text speaks FAVOURABLY about — praise, thanks, credit, support, defence), "criticised" (array of {text}: every person, party or government the text speaks UNFAVOURABLY about — attack, blame, accusation, demand, mockery), "sentiment_target" (object {text, span} or null — see below), "reasoning" (ONE line; write this BEFORE deciding the tones below — it must justify them, not restate them), "target_tone" (positive|negative|neutral), "generic_sentiment" (positive|negative|neutral — the overall mood of the WHOLE text; must agree with "reasoning"), "emotion" (anger|joy|fear|sadness|frustration|hope|pride|sarcasm|concern|neutral — must agree with "reasoning"), "language_detected".

Do NOT output any client-perspective verdict (stance, beneficiary, who benefits). Those are computed downstream by a deterministic engine. "sentiment_target" and "target_tone" are FACTUAL EXTRACTIONS, not verdicts.

── "sentiment_target" ────────────────────────────────────────────────
The ONE person, party or government the tone is directed AT: the entity being praised, criticised, blamed, demanded of, or defended. This is NOT necessarily who is speaking or posting.
  • "Congress demands the Sai government keep its promises" → sentiment_target is the Sai government (the one being demanded of), NOT Congress (the speaker).
  • "Mahant praised the CM's decision"   → sentiment_target is the CM (the one praised), NOT Mahant (the praiser).
  • "Congress misled the farmers of Telangana, says a citizen" → sentiment_target is Congress (the one accused).
  • A politician posting about a GOVERNMENT ORDER, policy, police action or scheme is targeting the GOVERNMENT that issued it, even if the government is not named again in that sentence.
  • Use the entity's name as it appears in the text. Return null if the tone is not aimed at any person/party/government.

── "target_tone" ─────────────────────────────────────────────────────
The tone directed specifically AT "sentiment_target". THIS IS OFTEN DIFFERENT FROM "generic_sentiment", and getting it right matters more than the overall mood of the post.

A post very commonly SUPPORTS one group while ATTACKING the target. Judge ONLY the attitude toward sentiment_target:
  • "I fully support the farmers' just fight. The government's order must be withdrawn immediately. Police are suppressing them with arrests."
      → generic_sentiment may look positive (it supports farmers), but target_tone = "negative" (it demands, accuses and condemns the government).
  • "Fulfil the promises you made to employees, or we will fight on their behalf."
      → a demand/ultimatum aimed at the target ⇒ target_tone = "negative", even though it is phrased calmly.
  • Treat as target_tone "negative": demands, ultimatums, accusations, blame, "must resign/cancel/withdraw", alleging failure, corruption, repression or broken promises.
  • Treat as target_tone "positive": praise, thanks, congratulation, credit, defence of the target.
  • NEWS / REPORTING: judge WHAT THE REPORTED FACTS MEAN for the target, not the writing style. A calm, factual headline is still negative when the facts damage the target, and positive when they credit it.
      → "Land scam exposed; SIT to probe former Congress ministers" ⇒ target_tone = "negative" (scam, probe).
      → "MLA faces backlash after controversial remarks" ⇒ target_tone = "negative" (backlash, controversy).
      → "CM inaugurates new hospital block" ⇒ target_tone = "positive" (achievement credited to the target).
      Damaging facts: scam, corruption, probe, FIR, arrest, raid, chargesheet, backlash, protest against, controversy, resignation demand, defeat, defection away, failure, crisis. Crediting facts: inauguration, launch, award, win, completed project, welfare delivered, praise received, defection toward.
  • Treat as target_tone "neutral": only when the reported facts are genuinely neither damaging nor crediting (schedules, routine meetings, announcements with no evaluation, weather, statistics).
  • If sentiment_target is null, set target_tone to "neutral".
  • "sentiment_target" and "target_tone" MUST describe the SAME entity. When a post praises one side AND attacks the other, choose ONE entity as sentiment_target and give the tone toward THAT entity — never the target of one clause with the tone of the other.
      → "Baghel gave a brilliant speech and exposed the government" ⇒ EITHER sentiment_target = Baghel with target_tone "positive", OR sentiment_target = the government with target_tone "negative". NOT Baghel with "negative".

── "generic_sentiment" ───────────────────────────────────────────────
The mood of the WHOLE text, judged by the same rule: what the content says or reports, not how calmly it is written. A neutrally worded report of a scam, arrest, protest, accident or crisis is "negative"; a report of an inauguration, award, festival or relief delivered — or of a government decision delivered to people (a gazette notification, a grant, a new facility, a renaming residents asked for) — is "positive"; "neutral" only for content with no positive or negative substance (weather bulletins, schedules, plain announcements).
  • LENGTH IS NOT NEUTRALITY. A one-line taunt, a sarcastic jibe or a meme caption is judged on what it says, not its length: "जनता परेशान, और साहब अपने में मस्त है" (people suffer while the boss enjoys himself) and "वोट चुराया मैंने तेरे लिए" (vote-theft sarcasm) are "negative". Do not fall back to "neutral" merely because a post is short or informal.
  • A REQUEST OR DEMAND ADDRESSED TO THE GOVERNMENT is an unmet grievance, not praise, however politely it is worded ("माननीय महोदय, … कीजिए", "विचार करें", "मांग है", "ध्यान दें"). Deferential openings and honorifics do not make it "positive" — score the ASK, which is that something has not been delivered.

── Political map (for identifying WHO, not for judging) ──────────────
  Governing alliance (NDA) : ${ALLY_SUMMARY}
  Leadership               : ${PRIMARY ? PRIMARY.canonical : 'CM'} (Chief Minister)${SECONDARY ? `, ${SECONDARY.canonical} (${SECONDARY.role || 'party leader'})` : ''}
  Opposition               : ${OPPOSITION_SUMMARY}

── Deterministic pre-scan (evidence) ─────────────────────────────────
  Platform           : ${ctx.platform || 'unknown'}
  Author handle      : ${ctx.author_handle || 'unknown'}
  Detected languages : ${langList}
  Pipeline mode      : ${ctx.mode}
  Primary target     : ${ctx.primary_target_canonical || 'none'} (${ctx.primary_target_alignment || 'n/a'})
  Entities mentioned :
${mentionedList}

You may receive profanity, abuse, or sensitive political content. Do not refuse — extract it. That is the entire job.

Now analyze the following text and return JSON exactly in the schema above. Text:
<<<
${String(text || '').slice(0, 1800)}
>>>`;
};

/* ─── provider call ────────────────────────────────────────────────── */

const callLLM = (prompt) => chatJson({
    prompt,
    temperature: 0.1,
    maxTokens: 1500,
    timeout: LLM_TIMEOUT,
});

/* ─── normalization ────────────────────────────────────────────────── */

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

const readConfidence = (raw, keys, fallback) => {
    for (const key of keys) {
        const value = key.split('.').reduce(
            (obj, part) => (obj && obj[part] !== undefined ? obj[part] : undefined),
            raw,
        );
        if (value !== undefined && value !== null && value !== '') return clamp01(value);
    }
    return fallback;
};

/**
 * `scored` is the stance engine's result when one exists. A verdict scored on
 * a rostered entity is never "not relevant" (Stage 2 may simply have lacked an
 * alias for the name), and a clear, non-neutral verdict about either camp is
 * relevant: an attack on the opposition matters to the client as much as
 * praise of the CM.
 */
const SCORED_STANCES = ['pro_target', 'anti_target', 'pro_target_indirect', 'anti_target_indirect'];
const defaultClientRelevance = (ctx, scored = null) => {
    if ((ctx.target_relevance || 0) >= 0.65 || ctx.mode === 'about_target' || ctx.mode === 'civic_grievance') return 'relevant';
    if (scored && scored.scored_side) {
        return SCORED_STANCES.includes(scored.stance) ? 'relevant' : 'uncertain';
    }
    if ((ctx.target_relevance || 0) <= 0.2 && !(ctx.mentioned_entities || []).length) return 'not_relevant';
    return 'uncertain';
};

const defaultTarget = (ctx) => {
    if (ctx.primary_target_alignment === 'ally') return 'ruling_party';
    if (ctx.mode === 'civic_grievance') return 'state_government';
    if (ctx.has_opposition_mention) return 'opposition';
    if ((ctx.target_relevance || 0) <= 0.2) return 'none';
    return 'unknown';
};

const normalizeStance = (value) => {
    let s = String(value || '').toLowerCase().trim().replace(/[-\s]/g, '_');
    if (LEGACY_STANCE_MAP[s]) s = LEGACY_STANCE_MAP[s];
    return ALLOWED_STANCES.includes(s) ? s : 'unrelated';
};

/**
 * Names the model's reasoning says it praises / criticises. Only phrases that
 * start like a name (capital letter or @handle) are taken, so "criticizes the
 * lack of roads" contributes nothing.
 */
const REASONING_VERBS = {
    praised: /\b(?:prais(?:es|ing|ed)?|support(?:s|ing|ed)?|credit(?:s|ing|ed)?|appreciat(?:es|ing|ed)|thank(?:s|ing|ed)?|applaud(?:s|ing|ed)?)\s+(?:the\s+)?/gi,
    criticised: /\b(?:critici[sz](?:es|ing|ed)?|attack(?:s|ing|ed)?|mock(?:s|ing|ed)?|blam(?:es|ing|ed)|condemn(?:s|ing|ed)?|slam(?:s|ming|med)?)\s+(?:the\s+)?/gi,
};
const reasoningNames = (reasoning, field) => {
    const text = String(reasoning || '');
    const verbs = REASONING_VERBS[field];
    if (!text || !verbs) return [];
    const out = [];
    verbs.lastIndex = 0;
    let m;
    while ((m = verbs.exec(text)) !== null) {
        const rest = text.slice(m.index + m[0].length);
        const phrase = rest.split(/[,.;:!?]|\s(?:and|while|but|for|as|who|which|by)\s/)[0].trim();
        if (/^[A-Z@\u0900-\u097F]/.test(phrase) && phrase.length >= 3 && phrase.length <= 60) out.push({ text: phrase });
    }
    return out;
};

const normalizeGeneric = (value) => {
    let v = String(value || '').toLowerCase().trim();
    if (v === 'moderate') v = 'neutral'; // retired label
    return ALLOWED_GENERIC_SENTIMENTS.includes(v) ? v : null;
};

const normalizeEmotion = (value) => {
    let e = String(value || 'neutral').toLowerCase().trim().replace(/[-\s]/g, '_');
    if (e === 'optimism') e = 'hope';
    if (e === 'happy') e = 'joy';
    if (e === 'worried') e = 'concern';
    return ALLOWED_EMOTIONS.includes(e) ? e : 'neutral';
};

/**
 * Resolve the final client-relative sentiment from stance.
 *
 * Deterministic, so the value is stable across runs. This is the ONLY post-LLM
 * transformation — we do NOT second-guess the engine's stance with keyword
 * lists. If the model misreads the text, fix it by sharpening the prompt, not
 * by patching outputs.
 */
const resolveTargetSentiment = (verdict) => {
    switch (verdict.stance) {
        case 'pro_target':
        case 'pro_target_indirect':
            return 'positive';
        case 'anti_target':
        case 'anti_target_indirect':
            return 'negative';
        case 'neutral':
            // A civic grievance addressed TO the leadership is neutral on the
            // client axis; its emotional tone lives in generic_sentiment.
            return 'neutral';
        case 'unrelated':
        default:
            // No client target means no client-relative positive/negative value.
            //
            // NOTE: this deliberately does NOT pass through a positive generic
            // tone. The previous implementation returned 'positive' whenever the
            // raw text tone was positive, which is exactly the
            // generic→client conversion THE ONE RULE forbids: a cheerful
            // off-topic post is not good news for the client.
            return 'neutral';
    }
};

/* ─── deterministic fallback (no LLM available) ────────────────────── */

const heuristicFallback = (ctx) => {
    // Derive a coarse stance purely from the deterministic context.
    //
    // NOTE: the previous implementation computed a stance here and then
    // returned a SEPARATE always-'unrelated' variable, so this whole branch was
    // dead and every LLM outage produced 'unrelated'. The computed value is now
    // actually used.
    let stance = 'unrelated';
    let beneficiary = 'none';

    // Without the LLM there is no tone, so pro vs anti cannot be told apart for
    // either camp ("Rane caught in land scam" mentions an ally and is bad for
    // the client). Any political mention stays neutral and goes to review.
    if (ctx.has_target_mention || ctx.has_opposition_mention || ctx.has_ally_mention) {
        stance = 'neutral';
    }

    return {
        client_relevance: defaultClientRelevance(ctx),
        target: defaultTarget(ctx),
        target_entity: ctx.primary_target || 'none',
        target_entity_canonical: ctx.primary_target_canonical || null,
        relevance_score: clamp01(ctx.target_relevance),
        stance,
        beneficiary,
        attack_target: '',
        narrative_direction: 'heuristic (LLM unavailable)',
        political_alignment: 'unclear',
        generic_sentiment: 'neutral',
        target_tone: 'neutral',
        emotion: 'neutral',
        confidence: { relevance: 0.35, stance: 0.35, sentiment: 0.35, emotion: 0.3 },
        toxicity_level: 'none',
        hate_speech: false,
        propaganda_probability: 0,
        sarcasm_detected: false,
        emotional_intensity: 0,
        misinformation_probability: 0,
        language_detected: '',
        english_translation: '',
        analysis: '',
        reasoning: 'LLM unavailable; fell back to deterministic political-context heuristic.',
        // An LLM outage must never publish a confident verdict.
        needs_review: true,
    };
};

/* ─── public API ───────────────────────────────────────────────────── */

const analyzePoliticalSentiment = async (text, politicalContext, options = {}) => {
    const ctx = politicalContext || {};

    const finalize = (verdict, provider) => {
        const targetSentiment = resolveTargetSentiment(verdict);
        return {
            ...verdict,
            target_sentiment: targetSentiment,
            // Legacy mirror — same value, same statement, cannot diverge.
            bsk_sentiment: targetSentiment,
            provider,
        };
    };

    if (!text || !String(text).trim()) {
        return finalize(heuristicFallback(ctx), 'fallback');
    }

    const prompt = buildPrompt(text, ctx);

    try {
        const raw = extractJson(await callLLM(prompt));
        if (raw) {
            const llmConfidence = readConfidence(
                raw,
                ['confidence.extraction', 'confidence.extraction_score', 'confidence'],
                0.7,
            );

            const candidateActors = Array.isArray(raw.candidate_actors) ? raw.candidate_actors : [];
            const candidateSubjects = Array.isArray(raw.candidate_subjects) ? raw.candidate_subjects : [];

            const resolvedActors = resolveEntities(candidateActors, ctx);

            // Who the tone is aimed at, resolved through the same roster lookup
            // as the actors. Null/unresolvable is fine and common — stanceEngine
            // falls back to actor-based logic, so this can only ADD signal.
            const rawTarget = raw.sentiment_target && raw.sentiment_target.text
                ? raw.sentiment_target
                : null;
            const resolvedTarget = rawTarget ? (resolveEntities([rawTarget], ctx)[0] || null) : null;
            if (resolvedTarget && resolvedTarget.affiliation) {
                console.log(`[politicalSentiment] sentiment_target="${rawTarget.text}" → ${resolvedTarget.canonical} (${resolvedTarget.affiliation})`);
            }

            /**
             * Tone aimed AT the target — what the stance matrix actually needs.
             *
             * `generic_sentiment` is the mood of the WHOLE post, and the two
             * genuinely differ on the most common political shape there is: an
             * opponent backing a sympathetic group while attacking the
             * government ("I support the farmers; the government's order must be
             * withdrawn"). Read as a whole that scans positive; aimed at the
             * government it is plainly negative. Feeding whole-post mood into
             * the matrix is what produced POSITIVE badges on posts attacking our
             * own side.
             *
             * Falls back to generic_sentiment when the model omits it, so
             * behaviour is unchanged for a response without the new field.
             */
            const genericSentiment = normalizeGeneric(raw.generic_sentiment) || 'neutral';
            const targetTone = normalizeGeneric(raw.target_tone) || genericSentiment;
            if (targetTone !== genericSentiment) {
                console.log(`[politicalSentiment] target_tone=${targetTone} differs from generic_sentiment=${genericSentiment} — using target_tone for stance.`);
            }

            /**
             * PRAISED / CRITICISED CROSS-CHECK. On a post that praises one side
             * and attacks the other ("Baghel gave a brilliant speech and exposed
             * the government"), a small model often pairs the target from one
             * clause with the tone from the other (target Baghel, tone negative),
             * which inverts the stance. Listing who is praised and who is
             * criticised is a simpler extraction, so when the chosen target sits
             * in exactly one of those lists and the tone contradicts it, the
             * list wins. Nothing changes when the lists are absent or agree.
             */
            const toneTarget = (() => {
                if (!resolvedTarget) return targetTone;
                const sameEntity = (r) => r && (
                    (r.key && r.key === resolvedTarget.key)
                    || (r.canonical && r.canonical === resolvedTarget.canonical)
                );
                const listed = (field) => {
                    const items = Array.isArray(raw[field])
                        ? raw[field].map((x) => (typeof x === 'string' ? { text: x } : x)).filter((x) => x && x.text)
                        : [];
                    // The model's own one-line reasoning often names who it
                    // praises and who it criticises correctly even when the
                    // structured lists are empty or garbled ("criticizes Baghel,
                    // while praising the Vishnudev Sai government").
                    items.push(...reasoningNames(raw.reasoning, field));
                    return items.length ? resolveEntities(items, ctx).some(sameEntity) : false;
                };
                const praised = listed('praised');
                const criticised = listed('criticised');
                if (praised && !criticised && targetTone === 'negative') {
                    console.log(`[politicalSentiment] target ${resolvedTarget.canonical} is listed as PRAISED but target_tone=negative — using positive.`);
                    return 'positive';
                }
                if (criticised && !praised && targetTone === 'positive') {
                    console.log(`[politicalSentiment] target ${resolvedTarget.canonical} is listed as CRITICISED but target_tone=positive — using negative.`);
                    return 'negative';
                }
                return targetTone;
            })();

            const stanceResult = computeStance({
                resolvedActors,
                resolvedTarget,
                candidateSubjects,
                generic_sentiment: toneTarget,
                raw_sentiment: genericSentiment,
                ctx,
            });

            /**
             * GUARDS — three shapes the matrix alone gets wrong, each found in a
             * 100-post audit:
             *  • no state context at all (a Ghana / UP post fetched by a generic
             *    keyword) — it cannot help or hurt the client: `unrelated`;
             *  • a tribute or condolence praising an opposition figure — courtesy,
             *    not a position: `neutral`, not opposing;
             *  • a post criticising BOTH camps ("Congress, BJP, AAP — all the same
             *    drama") — attacking the opposition there is not support: `neutral`.
             */
            let guardSettled = false;
            {
                const sided = /^(pro|anti)_target/.test(String(stanceResult.stance || ''));
                const settle = (stance, why) => {
                    guardSettled = true;
                    stanceResult.stance = stance;
                    stanceResult.beneficiary = 'none';
                    stanceResult.attack_target = '';
                    stanceResult.rationale = `${stanceResult.rationale || ''} → ${why}`.trim();
                };
                if (sided && ctx.has_state_signal === false) {
                    settle('unrelated', 'no state context: unrelated');
                } else if (sided && ctx.ceremonial && String(stanceResult.stance).startsWith('anti_target')
                    && (toneTarget === 'positive' || genericSentiment === 'positive')) {
                    settle('neutral', 'ceremonial tribute to an opposition figure: neutral');
                } else if (sided) {
                    const items = Array.isArray(raw.criticised)
                        ? raw.criticised.map((x) => (typeof x === 'string' ? { text: x } : x)).filter((x) => x && x.text)
                        : [];
                    const sides = new Set(resolveEntities(items, ctx).map((r) => r && r.affiliation).filter(Boolean));
                    if (sides.has('ally') && sides.has('opposition')) settle('neutral', 'criticises both camps: neutral');
                }
            }

            // Everything that resolved to the roster counts — the target as well
            // as the actors (a post whose target resolved cleanly is not
            // uncertain just because no separate actor was extracted). A civic
            // complaint or a non-political post legitimately names nobody.
            const resolvedAll = [...resolvedActors, resolvedTarget].filter((r) => r && r.confidence != null);
            const resolverConfidence = resolvedAll.length
                ? resolvedAll.reduce((s, r) => s + (r.confidence || 0), 0) / resolvedAll.length
                : (['civic_grievance', 'irrelevant'].includes(ctx.mode) ? 0.7 : 0.4);
            const ruleConfidence = stanceResult.rationale ? 0.8 : 0.6;
            const fused = fuseConfidence({ llmConfidence, resolverConfidence, ruleConfidence });

            const verdict = {
                client_relevance: defaultClientRelevance(ctx, stanceResult),
                target: defaultTarget(ctx),
                // The entity the stance engine actually scored (after the
                // author-is-target re-point); else the extracted target; else
                // the first resolved actor.
                target_entity: stanceResult.scored_entity
                    || (resolvedTarget && (resolvedTarget.canonical || resolvedTarget.text))
                    || (resolvedActors[0] && (resolvedActors[0].canonical || resolvedActors[0].text))
                    || String(ctx.primary_target || 'none'),
                target_entity_canonical: (resolvedTarget && resolvedTarget.canonical)
                    || (resolvedActors[0] && resolvedActors[0].canonical)
                    || ctx.primary_target_canonical || null,
                relevance_score: clamp01(ctx.target_relevance),
                stance: normalizeStance(stanceResult.stance),
                beneficiary: ALLOWED_BENEFICIARIES.includes(stanceResult.beneficiary)
                    ? stanceResult.beneficiary
                    : 'none',
                attack_target: String(stanceResult.attack_target || ''),
                narrative_direction: String(stanceResult.rationale || ''),
                political_alignment: 'unclear',
                // generic_sentiment stays the WHOLE-POST mood (what the UI shows
                // as tone); target_tone is the client-facing signal the matrix
                // consumed. Both are persisted so a reviewer can see WHY a
                // supportive-sounding post scored against the client.
                generic_sentiment: genericSentiment,
                target_tone: toneTarget,
                emotion: normalizeEmotion(raw.emotion),
                confidence: {
                    relevance: fused.confidence,
                    stance: fused.confidence,
                    sentiment: fused.confidence,
                    emotion: fused.confidence,
                },
                toxicity_level: 'none',
                hate_speech: !!raw.hate_speech,
                propaganda_probability: clamp01(raw.propaganda_probability || 0),
                sarcasm_detected: !!raw.sarcasm_detected,
                emotional_intensity: clamp01(raw.emotional_intensity || 0),
                misinformation_probability: clamp01(raw.misinformation_probability || 0),
                language_detected: String(raw.language_detected || ''),
                english_translation: String(raw.english_translation || ''),
                analysis: String(raw.analysis || ''),
                reasoning: String(raw.reasoning || ''),
                needs_review: fused.needs_review,
            };

            /**
             * SELF-CONSISTENCY GUARD — does the model's OWN reasoning agree with
             * its OWN sentiment label, from this SAME call?
             *
             * This does not override sentiment/stance with a keyword list (the
             * header forbids that). It only detects when the model has visibly
             * contradicted itself, and routes that case to human review instead
             * of publishing a confidently-wrong verdict.
             */
            {
                const NEGATIVE_SIGNAL_RX = /\b(critical|criticis|attack|condemn|warn(?:ing|s)?|threat(?:en(?:s|ing)?)?|fail(?:ure|ed|s)?|blame|oppos|protest|slam|expos|corrupt|demand)/i;
                const POSITIVE_SIGNAL_RX = /\b(prais|thank|congratulat|welcome|support(?:ive|s)?|appreciat|applaud|celebrat)/i;
                const reasoningText = `${verdict.reasoning || ''} ${verdict.narrative_direction || ''}`;
                const looksNegative = NEGATIVE_SIGNAL_RX.test(reasoningText);
                const looksPositive = POSITIVE_SIGNAL_RX.test(reasoningText);
                const conflict = (verdict.generic_sentiment === 'positive' && looksNegative && !looksPositive)
                    || (verdict.generic_sentiment === 'negative' && looksPositive && !looksNegative);
                if (conflict) {
                    console.warn(`[politicalSentiment] Reasoning/sentiment conflict: generic_sentiment=${verdict.generic_sentiment} but reasoning reads the opposite ("${reasoningText.slice(0, 120)}"). Flagging for review.`);
                    verdict.needs_review = true;
                    verdict.confidence.sentiment = Math.min(verdict.confidence.sentiment, 0.4);
                    verdict.confidence.stance = Math.min(verdict.confidence.stance, 0.4);
                }
            }

            if (verdict.client_relevance === 'not_relevant') {
                verdict.stance = 'unrelated';
                verdict.beneficiary = 'none';
                verdict.attack_target = '';
                verdict.narrative_direction = verdict.narrative_direction || 'not client-relevant';
                verdict.political_alignment = 'neutral';
            }

            /**
             * CONSISTENCY ENFORCER — catches a logical contradiction in the
             * assembled verdict itself (not a language rule).
             *
             * An explicit attack on an ally, in a mode that is about our side,
             * cannot also be neutral/unrelated.
             *
             * Note the lookup uses `canonical`/`key` — the fields
             * findMentionedEntities actually returns. An earlier version looked
             * for `canonical_name`/`name`, which no entity carries, so this
             * enforcer could never fire at all.
             */
            if (
                !guardSettled // a guard above settled this deliberately
                && verdict.client_relevance !== 'not_relevant'
                && (verdict.stance === 'neutral' || verdict.stance === 'unrelated')
                && (ctx.mode === 'about_target' || ctx.mode === 'civic_grievance')
            ) {
                if (verdict.attack_target) {
                    const wanted = String(verdict.attack_target).toLowerCase().trim();
                    const attacked = (ctx.mentioned_entities || []).find(
                        (e) => String(e.canonical || '').toLowerCase() === wanted
                            || String(e.key || '').toLowerCase() === wanted,
                    );
                    if (attacked && attacked.alignment === 'ally') {
                        console.warn(`[politicalSentiment] Consistency enforcer: attack on ally "${verdict.attack_target}" in ${ctx.mode} mode cannot be neutral/unrelated. Correcting stance → anti_target.`);
                        verdict.stance = 'anti_target';
                        verdict.beneficiary = 'opposition';
                    }
                } else if (verdict.target_tone === 'negative') {
                    const targetEntity = String(verdict.target_entity || '').toLowerCase().trim();
                    const targetIsAlly = (ctx.mentioned_entities || []).some(
                        (e) => e.alignment === 'ally'
                            && (String(e.canonical || '').toLowerCase() === targetEntity
                                || String(e.key || '').toLowerCase() === targetEntity),
                    );
                    if (targetIsAlly) {
                        console.warn(`[politicalSentiment] Consistency enforcer: negative tone toward ally target "${verdict.target_entity}" in ${ctx.mode} mode cannot be neutral/unrelated. Correcting stance → anti_target.`);
                        verdict.stance = 'anti_target';
                        verdict.beneficiary = 'opposition';
                    }
                }
            }

            return finalize(verdict, 'llm');
        }
    } catch (err) {
        console.warn(`[politicalSentiment] LLM failed: ${err.message}`);
    }

    return finalize(heuristicFallback(ctx), 'fallback');
};

module.exports = {
    analyzePoliticalSentiment,
    resolveTargetSentiment,
    ALLOWED_STANCES,
    ALLOWED_GENERIC_SENTIMENTS,
    ALLOWED_BENEFICIARIES,
    ALLOWED_CLIENT_RELEVANCE,
    ALLOWED_TARGETS,
    ALLOWED_EMOTIONS,
    // exported for unit tests
    buildPrompt,
    heuristicFallback,
    extractJson,
    normalizeStance,
    normalizeGeneric,
    normalizeEmotion,
    // Legacy export name kept so older imports keep resolving.
    resolveBskSentiment: resolveTargetSentiment,
};
