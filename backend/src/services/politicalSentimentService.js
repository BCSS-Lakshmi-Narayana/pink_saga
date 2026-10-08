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
 *         target,             // KIND of target: our_party|state_government|rival_party|leader|institution|issue|unknown|none
 *         attribution,        // { claim_source, claim_type: allegation|fact_reported|opinion, ... } | null
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
const { POLITICAL_ENTITIES, resolveEntityKey, findAliasMatches } = require('../config/politicalEntities');
const { OUR_PARTY } = require('../config/politicalData');
const { STATE_NAME, COUNTRY } = require('../config/deployment');
const promptContext = require('../config/politicalPromptContext');
const stanceVocab = require('./stanceVocabulary');

const LLM_TIMEOUT = parseInt(process.env.POLITICAL_SENTIMENT_TIMEOUT_MS || '60000', 10);

// Canonical stance vocabulary lives in stanceVocabulary.js (see its header for what
// "target" means). `mixed` is new: clearly conflicting sentiment toward the client itself.
const ALLOWED_STANCES = stanceVocab.CANONICAL_STANCES;

// Sentiment labels exposed downstream / to the DB: positive | negative | neutral.
// NOTE: `stance` above keeps its own 'neutral' value — that is a political
// STANCE, not a sentiment label, and must not be confused with this list.
const ALLOWED_GENERIC_SENTIMENTS = ['positive', 'negative', 'neutral'];
const ALLOWED_BENEFICIARIES = ['ours', 'opposition', 'none'];
const ALLOWED_CLIENT_RELEVANCE = ['relevant', 'not_relevant', 'uncertain'];
/**
 * What KIND of thing the verdict's target is — never a guess from "a party was
 * mentioned". `ruling_party` / `opposition` are the legacy values: `ruling_party`
 * was written for the client camp when the client governed, and `opposition` for
 * the rival camp. They stay valid for stored rows (stanceVocabulary maps them) but
 * are no longer written.
 */
const ALLOWED_TARGETS = [
    'our_party', 'state_government', 'rival_party', 'leader', 'institution', 'issue', 'unknown', 'none',
    // legacy — read, never written
    'ruling_party', 'opposition', 'other',
];
const ALLOWED_CLAIM_TYPES = ['allegation', 'fact_reported', 'opinion', 'none'];
const ALLOWED_EMOTIONS = [
    'anger', 'joy', 'fear', 'sadness', 'frustration',
    'hope', 'pride', 'sarcasm', 'concern', 'neutral',
];

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

const campOf = (alignment) => (alignment === 'ally' ? `our camp (${OUR_PARTY.name})`
    : alignment === 'opposition' ? `RIVAL camp (government / other party)` : 'neutral institution');

const buildPrompt = (text, ctx) => {
    const mentionedList = ctx.mentioned_entities && ctx.mentioned_entities.length > 0
        ? ctx.mentioned_entities
            .map((m) => `  • ${m.canonical} — ${campOf(m.alignment)}${m.party ? ` (${m.party})` : ''}`
                + (m.defected ? ` — elected on a ${String(m.elected_party || '').toUpperCase()} ticket, now with ${String(m.current_party || '').toUpperCase()}` : '')
                + (m.ambiguous_alias ? ' — AMBIGUOUS name, check the text' : ''))
            .join('\n')
        : '  (none detected by the deterministic gate — you must still read the text)';

    const langList = Object.entries(ctx.language_hints || {})
        .filter(([, v]) => v)
        .map(([k]) => k.replace('has_', ''))
        .join(', ') || 'unknown';

    const trsNote = ctx.trs_ambiguous
        ? '\n  NOTE: the text says "TRS" and nothing settles whether that is BRS (its old name) or Kavitha\'s party. Do not guess; return it as "TRS".'
        : (ctx.trs_resolution ? `\n  NOTE: "TRS" here was read as ${ctx.trs_resolution === OUR_PARTY.id ? `${OUR_PARTY.name} (its former name)` : "Kavitha's party"}.` : '');

    // FIELD ORDER MATTERS: "reasoning" is requested BEFORE the tone labels, so
    // the model articulates its read of the text first and labels it second,
    // instead of committing to a label and writing a reasoning line to match.
    // This is what prevents "reasoning says critical, sentiment says positive".
    return `You are a factual extractor for political media monitoring in ${STATE_NAME}, ${COUNTRY}, working for the client described below.

Read the input text and return STRICT JSON only, with these fields IN THIS ORDER:
"english_translation", "candidate_actors" (array of {text, span}), "candidate_subjects" (array of {text, span, subject_type}), "praised" (array of {text}: every person, party or government the text speaks FAVOURABLY about — praise, thanks, credit, support, defence), "criticised" (array of {text}: every person, party or government the text speaks UNFAVOURABLY about — attack, blame, accusation, demand, mockery), "sentiment_target" (object {text, span} or null — see below), "claim_source" (object {text} or null — see ATTRIBUTION), "claim_type" (allegation|fact_reported|opinion|none), "reasoning" (ONE line; write this BEFORE deciding the tones below — it must justify them, not restate them), "target_tone" (positive|negative|neutral), "generic_sentiment" (positive|negative|neutral — the overall mood of the WHOLE text; must agree with "reasoning"), "emotion" (anger|joy|fear|sadness|frustration|hope|pride|sarcasm|concern|neutral — must agree with "reasoning"), "language_detected".

Do NOT output any client-perspective verdict (stance, beneficiary, who benefits). Those are computed downstream by a deterministic engine. "sentiment_target" and "target_tone" are FACTUAL EXTRACTIONS, not verdicts.
Determine sentiment toward the TARGET ENTITY, not merely the overall tone of the post. The overall tone ("generic_sentiment") and the tone aimed at the target ("target_tone") are different things and often differ.

── Political map (for identifying WHO, not for judging) ──────────────
${promptContext.buildPoliticalMap({ compact: true })}

── "sentiment_target" ────────────────────────────────────────────────
The ONE person, party or government the tone is directed AT: the entity being praised, criticised, blamed, demanded of, or defended. This is NOT necessarily who is speaking or posting.
  • "BRS exposed the failures of the Congress government" → sentiment_target is the Congress government (the one being criticised), NOT BRS (the speaker).
  • "Congress government praised BRS for its irrigation projects" → sentiment_target is BRS (the one praised), NOT the Congress government (the praiser).
  • "KTR slammed the Revanth Reddy government over the loan waiver" → sentiment_target is the Revanth Reddy government; KTR is the claim source.
  • A politician posting about a GOVERNMENT ORDER, policy, police action or scheme is targeting the GOVERNMENT that issued it, even if the government is not named again in that sentence. A BRS-built scheme (see the map) is a target on BRS's side of the line.
  • A post that criticises a person or party AND praises another: choose ONE entity as sentiment_target and give the tone toward THAT entity.
  • Use the entity's name as it appears in the text. Return null if the tone is not aimed at any person/party/government.

── "target_tone" ─────────────────────────────────────────────────────
The tone directed specifically AT "sentiment_target". THIS IS OFTEN DIFFERENT FROM "generic_sentiment", and getting it right matters more than the overall mood of the post.
  • Treat as "negative": demands, ultimatums, accusations, blame, "must resign/withdraw", alleging failure, corruption, repression or broken promises — even when phrased calmly.
  • Treat as "positive": praise, thanks, congratulation, credit, defence of the target.
  • NEWS / REPORTING: judge WHAT THE REPORTED FACTS MEAN for the target, not the writing style. A calm headline is negative when the facts damage the target (scam, probe, FIR, chargesheet, raid, backlash, defection away, failure) and positive when they credit it (inauguration, launch, award, win, welfare delivered).
      → "ACB files chargesheet against KTR in Formula E case" ⇒ sentiment_target KTR, target_tone "negative".
      → "Revanth Reddy government launches new housing scheme" ⇒ sentiment_target the government, target_tone "positive".
  • "neutral" only when the facts are genuinely neither damaging nor crediting (schedules, routine meetings, statistics). If sentiment_target is null, target_tone is "neutral".
  • "sentiment_target" and "target_tone" MUST describe the SAME entity. When a post praises one side AND attacks the other, never pair the target of one clause with the tone of the other.
      → "KCR gave a brilliant speech and exposed the government" ⇒ EITHER sentiment_target = KCR with "positive", OR sentiment_target = the government with "negative". NOT KCR with "negative".
  • Naming BRS, KCR or KTR is not itself praise or criticism: "KCR will address a meeting tomorrow" is neutral.

── "generic_sentiment" ───────────────────────────────────────────────
The mood of the WHOLE text: what it says or reports, not how calmly it is written. A neutrally worded report of a scam, arrest, protest or crisis is "negative"; a report of an inauguration, award or relief delivered is "positive"; "neutral" only for content with no positive or negative substance.
  • LENGTH IS NOT NEUTRALITY: a one-line taunt, sarcastic jibe or meme caption is judged on what it says.
  • A REQUEST OR DEMAND ADDRESSED TO THE GOVERNMENT is an unmet grievance, not praise, however politely worded. Honorifics do not make it positive.

── ATTRIBUTION ───────────────────────────────────────────────────────
${promptContext.COMPACT.ATTRIBUTION_RULES}

── LANGUAGE ──────────────────────────────────────────────────────────
${promptContext.COMPACT.TELUGU_ANALYSIS_RULES}

── TRS ───────────────────────────────────────────────────────────────
${promptContext.COMPACT.TRS_RULE}
${ctx.language_hints && ctx.language_hints.has_telugu_roman ? `
── Romanised Telugu ─────────────────────────────────────────────────
${promptContext.COMPACT.TELGLISH_GLOSSARY}
` : ''}
── Examples (target and tone only) ───────────────────────────────────
  • "Telangana govt failed to pay Rythu Bharosa" → target: the Telangana government, target_tone negative, generic negative.
  • "Revanth Reddy delivered a great welfare push" → target: Revanth Reddy, target_tone positive.
  • "Congress alleges BRS looted Kaleshwaram" → target BRS, target_tone negative, claim_source Congress, claim_type allegation.
  • "KTR: the Congress government has cheated every section" → target: the Congress government, negative, claim_source KTR, claim_type allegation.
  • "Kadiyam Srihari betrayed voters by joining Congress" → target: Kadiyam Srihari (a rival-camp MLA), negative.
  • "Praja palana ante idena? Rythu Bharosa ekkada?" → sarcastic; target: the government, negative, emotion sarcasm.
  • "KCR garu unte ee paristhiti ravadu" → target KCR, positive.

── Deterministic pre-scan (evidence) ─────────────────────────────────
  Platform           : ${ctx.platform || 'unknown'}
  Author handle      : ${ctx.author_handle || 'unknown'}
  Detected languages : ${langList}
  Pipeline mode      : ${ctx.mode}
  Primary target     : ${ctx.primary_target_canonical || 'none'} (${ctx.primary_target_alignment ? campOf(ctx.primary_target_alignment) : 'n/a'})
  Government era     : ${ctx.government_era === 'brs' ? 'the text refers to the BRS-era government (2014-2023)' : ctx.government_era === 'current' ? 'the text refers to the current Congress government' : ctx.government_era === 'ambiguous' ? 'UNCLEAR which government "the government" means: name the entity exactly as written and do not assume' : 'n/a'}
  Entities mentioned :
${mentionedList}${trsNote}

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
const SCORED_STANCES = ['pro_target', 'anti_target', 'pro_target_indirect', 'anti_target_indirect', 'mixed'];
const defaultClientRelevance = (ctx, scored = null) => {
    if ((ctx.target_relevance || 0) >= 0.65 || ctx.mode === 'about_target' || ctx.mode === 'civic_grievance') return 'relevant';
    if (scored && scored.scored_side) {
        return SCORED_STANCES.includes(scored.stance) ? 'relevant' : 'uncertain';
    }
    if ((ctx.target_relevance || 0) <= 0.2 && !(ctx.mentioned_entities || []).length) return 'not_relevant';
    return 'uncertain';
};

/**
 * What KIND of thing the verdict is about. Decided from the entity the verdict
 * actually scored — never from "a party was mentioned". When nothing was resolved
 * with confidence the answer is 'unknown' (or 'none' for a post with no political
 * content), not a guess.
 *
 *   government entity            → state_government
 *   party, our camp / rival camp → our_party / rival_party
 *   person                       → leader
 *   neutral institution          → institution
 *   scheme / civic issue         → issue
 */
const classifyTargetEntity = (keyOrCanonical) => {
    const key = resolveEntityKey(keyOrCanonical)
        || Object.keys(POLITICAL_ENTITIES).find((k) => POLITICAL_ENTITIES[k].canonical === keyOrCanonical);
    const ent = key ? POLITICAL_ENTITIES[key] : null;
    if (!ent) return null;
    if (ent.type === 'government') return 'state_government';
    if (ent.type === 'institution' || ent.alignment === 'neutral') return 'institution';
    if (ent.type === 'scheme') return 'issue';
    if (ent.type === 'party') return ent.alignment === 'ally' ? 'our_party' : 'rival_party';
    if (ent.type === 'person') return 'leader';
    return null;
};

const deriveTarget = ({ resolvedTarget = null, scoredEntity = null, ctx = {} } = {}) => {
    const fromTarget = resolvedTarget && (resolvedTarget.key || resolvedTarget.canonical)
        ? classifyTargetEntity(resolvedTarget.key || resolvedTarget.canonical) : null;
    if (fromTarget) return fromTarget;
    const fromScored = scoredEntity ? classifyTargetEntity(scoredEntity) : null;
    if (fromScored) return fromScored;
    // A civic complaint names no actor: its subject is the ISSUE, not a guessed party.
    if (ctx.mode === 'civic_grievance') return 'issue';
    if ((ctx.target_relevance || 0) <= 0.2 && !(ctx.mentioned_entities || []).length) return 'none';
    return 'unknown';
};

const normalizeStance = stanceVocab.normalizeStance;

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

/** Does the post both praise and criticise entities of OUR camp? (resolved against the roster) */
const praisesAndCriticisesOurCamp = (raw, ctx) => {
    const asItems = (field) => (Array.isArray(raw[field]) ? raw[field] : [])
        .map((x) => (typeof x === 'string' ? { text: x } : x)).filter((x) => x && x.text);
    const ourSide = (items) => resolveEntities(items, ctx).some((r) => r && r.affiliation === 'ally');
    return ourSide(asItems('praised')) && ourSide(asItems('criticised'));
};

/**
 * Who MAKES the claim, resolved against the roster ({text} or a bare string -> entity | null).
 */
const resolveClaimSource = (raw, ctx) => {
    const claimRaw = raw.claim_source && typeof raw.claim_source === 'object' && raw.claim_source.text
        ? raw.claim_source
        : (typeof raw.claim_source === 'string' && raw.claim_source.trim() ? { text: raw.claim_source.trim() } : null);
    return { claimRaw, claimResolved: claimRaw ? (resolveEntities([claimRaw], ctx)[0] || null) : null };
};

/**
 * A SPEAKER IS NOT THE TARGET OF ITS OWN ATTACK - applied to the extractor's own output.
 *
 * Seen live ("BRS exposed the failures of the Congress government"): the 7B model returned
 * claim_source = BRS and criticised = [BRS] - it named the SPEAKER as the one criticised and left the
 * Congress government out, which turned a post attacking the government into an attack on BRS. The two
 * fields contradict each other: the camp making the accusation is the only camp listed as criticised.
 * The existing author-is-target correction (stanceEngine) handles this when the post's AUTHOR is rostered;
 * this handles it when the contradiction is inside the extraction.
 *
 * Deliberately narrow, like that correction. It fires only when ALL hold:
 *   - the claim source resolves to a camp (ally / opposition);
 *   - the tone is negative and what is criticised (the chosen target, else everything in `criticised`) is
 *     ONLY that same camp;
 *   - the OTHER camp is named in the post, so there is someone else for the attack to be aimed at.
 * Anything else (a rival accusing BRS, BRS accusing the government, intra-camp criticism with nobody
 * from the other camp in the post) is left untouched.
 * Returns the entity to re-point the target at, or null.
 */
const claimSelfTargetCorrection = ({ raw, ctx, resolvedTarget, claimResolved, targetTone }) => {
    if (!claimResolved || !['ally', 'opposition'].includes(claimResolved.affiliation) || targetTone !== 'negative') return null;
    // Only an ACCUSATION has a speaker who can be listed as criticised by mistake. When the model calls the post an
    // "opinion" (or gives no claim type) and names the criticised party as its claim source, that is a mislabelled
    // claim source, not evidence about who is speaking, and must not neutralise the post.
    if (!['allegation', 'fact_reported'].includes(String(raw.claim_type || '').toLowerCase().trim())) return null;
    const items = (Array.isArray(raw.criticised) ? raw.criticised : [])
        .map((x) => (typeof x === 'string' ? { text: x } : x)).filter((x) => x && x.text);
    const criticisedSides = new Set(resolveEntities(items, ctx).map((r) => r && r.affiliation).filter((a) => a === 'ally' || a === 'opposition'));
    const selfAimed = resolvedTarget && resolvedTarget.affiliation
        ? resolvedTarget.affiliation === claimResolved.affiliation
        : (criticisedSides.size === 1 && criticisedSides.has(claimResolved.affiliation));
    if (!selfAimed) return null;
    const otherSide = claimResolved.affiliation === 'ally' ? 'opposition' : 'ally';
    // Everyone ELSE in the post. If they span both camps ("BJP says BRS and Congress are two sides of the same
    // coin": the speaker is BJP, the people criticised are BRS AND Congress) there is no single target to re-point
    // to - the speaker criticises both camps, which the engine scores as neutral.
    const mentionedOthers = (ctx.mentioned_entities || []).filter((m) => m.key !== claimResolved.key && (m.alignment === 'ally' || m.alignment === 'opposition'));
    if (mentionedOthers.some((m) => m.alignment === 'ally') && mentionedOthers.some((m) => m.alignment === 'opposition')) {
        return { bothCamps: true };
    }
    const other = (ctx.mentioned_entities || [])
        .filter((m) => m.alignment === otherSide)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
    if (!other) return null;
    return { text: other.canonical, span: null, key: other.key, canonical: other.canonical, affiliation: otherSide, confidence: 0.6 };
};

/**
 * Wording that blames BOTH camps together ("both the Congress government and BRS failed", "all the same", "two
 * sides of the same coin"). Only with such a cue is a criticised list that spans both camps read as
 * "criticises both camps equally"; without one, a resolved target stands and the other camp's name is
 * context (the victim, the opponent being quoted). English is tested on the (translated) text the model saw.
 */
const EQUAL_BLAME_RX = /(?<![a-z0-9_])(?:both|all\s+(?:the\s+)?(?:same|alike|parties|three|two|of\s+them)|neither|none\s+of\s+(?:them|these|the)|same\s+coin|two\s+sides|birds\s+of\s+a\s+feather|each\s+other|equally|one\s+and\s+the\s+same|every\s+party)(?![a-z0-9_])|రెండు\s*పార్టీలు|రెండూ|ఇద్దరూ|అన్ని\s*పార్టీలు|ఒకే\s*(?:తాను|నాణెం)/i;

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
        case 'mixed':
            // A civic grievance addressed TO the leadership is neutral on the
            // client axis; its emotional tone lives in generic_sentiment. A MIXED
            // post has no single client-relative sign: the label stays neutral and
            // the stance ('mixed') carries the finding.
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
        // No LLM: no resolved target, so nothing may be claimed beyond what the pre-scan found.
        target: deriveTarget({ resolvedTarget: null, scoredEntity: ctx.primary_target || null, ctx }),
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
            let resolvedTarget = rawTarget ? (resolveEntities([rawTarget], ctx)[0] || null) : null;
            const earlyTone = normalizeGeneric(raw.target_tone) || normalizeGeneric(raw.generic_sentiment) || 'neutral';

            // The model leaves `sentiment_target` null far more often than it should (15 of 20 live posts); the
            // stance engine then falls back to "whichever actor was listed first", which is where wrong-side
            // verdicts come from. The lists it DOES fill reliably carry the same information: when the tone is
            // negative, the entities it lists as CRITICISED are what the tone is aimed at (praised, when positive).
            // Used only when sentiment_target gave nothing, and only when the list names ONE camp - a list that
            // spans both camps stays unresolved and is handled by the existing both-camps guard.
            let criticisesBothCampsInOneItem = false;
            if (!(resolvedTarget && resolvedTarget.affiliation) && (earlyTone === 'negative' || earlyTone === 'positive')) {
                const listItems = (Array.isArray(earlyTone === 'negative' ? raw.criticised : raw.praised) ? (earlyTone === 'negative' ? raw.criticised : raw.praised) : [])
                    .map((x) => (typeof x === 'string' ? { text: x } : x)).filter((x) => x && x.text);
                const fromList = resolveEntities(listItems, ctx).filter((r) => r && r.affiliation && (r.affiliation === 'ally' || r.affiliation === 'opposition'));
                // A COMPOUND item ("BRS and BJP") names several entities in one phrase; resolving it would keep only
                // one of them and silently drop the other (seen live: MP5 became anti-BRS). If any item names entities
                // of more than one camp, the list is not a single target: leave it unresolved.
                const compoundAcrossCamps = listItems.some((it) => new Set(findAliasMatches(String(it.text)).map((m) => (POLITICAL_ENTITIES[m.entityKeys[0]] || {}).alignment).filter((a) => a === 'ally' || a === 'opposition')).size > 1);
                if (compoundAcrossCamps) criticisesBothCampsInOneItem = true;
                if (!compoundAcrossCamps && fromList.length && new Set(fromList.map((r) => r.affiliation)).size === 1) {
                    resolvedTarget = fromList.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
                    console.log(`[politicalSentiment] sentiment_target was empty; using the ${earlyTone === 'negative' ? 'criticised' : 'praised'} entity ${resolvedTarget.canonical} (${resolvedTarget.affiliation}).`);
                }
            }

            /**
             * VICTIM-AS-TARGET. "Revanth's rule is harassment; poison against KCR garu" - the model returned the
             * VICTIM (BRS leaders) as sentiment_target with a negative tone, while its own `criticised` list named
             * the entity the criticism is actually aimed at (Revanth, the Congress government). A negative tone
             * lands on whoever is criticised, a positive one on whoever is praised, so a target that is absent from
             * the matching list - while that list names ONE other camp - is the subject of the sentence, not its
             * target. The listed entity becomes the target. Deliberately narrow:
             *   - only when the matching list resolves to the roster and names exactly ONE camp, and that camp is
             *     not the target's own (an intra-camp list says nothing about a wrong camp);
             *   - never when the claim source (the speaker) sits in the listed camp - that is the speaker-as-
             *     criticised extraction error, which claimSelfTargetCorrection below already handles;
             *   - never when the target itself is in the list.
             * Anything else leaves the model's target untouched.
             */
            if (resolvedTarget && resolvedTarget.affiliation && (earlyTone === 'negative' || earlyTone === 'positive')) {
                const field = earlyTone === 'negative' ? raw.criticised : raw.praised;
                const items = (Array.isArray(field) ? field : [])
                    .map((x) => (typeof x === 'string' ? { text: x } : x)).filter((x) => x && x.text);
                const listed = resolveEntities(items, ctx).filter((r) => r && r.key && (r.affiliation === 'ally' || r.affiliation === 'opposition'));
                const listedCamps = new Set(listed.map((r) => r.affiliation));
                // Only a genuine ACCUSATION puts the speaker in the list by mistake ("BRS exposed the failures of the
                // Congress government": claim_source BRS, criticised [BRS]). An "opinion" whose claim source is the
                // criticised party is the model mislabelling who is being criticised, not who is speaking.
                const claimTypeHere = String(raw.claim_type || '').toLowerCase().trim();
                const speakerCamp = ['allegation', 'fact_reported'].includes(claimTypeHere)
                    ? ((resolveClaimSource(raw, ctx).claimResolved || {}).affiliation || null)
                    : null;
                if (listed.length && listedCamps.size === 1
                    && !listed.some((r) => r.key === resolvedTarget.key)
                    && !listedCamps.has(resolvedTarget.affiliation)
                    && !(speakerCamp && listedCamps.has(speakerCamp))) {
                    const subject = resolvedTarget;
                    resolvedTarget = listed.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
                    console.log(`[politicalSentiment] sentiment_target ${subject.canonical} (${subject.affiliation}) is not among the ${earlyTone === 'negative' ? 'criticised' : 'praised'} entities; the post is aimed at ${resolvedTarget.canonical} (${resolvedTarget.affiliation}), using that.`);
                }
            }

            /**
             * UNSUPPORTED POSITIVE TONE. "CPI(M) backs displaced landowners ... none has paid heed" - the model set
             * sentiment_target to the backing party with target_tone positive, yet put NOBODY in `praised`, scored
             * the whole post neutral, and listed the government as `criticised`. Reporting that a group supports
             * farmers is not praise of that group; the only judgement in the post is the criticism. A positive tone
             * with no praised entity and no positive overall sentiment is therefore not trusted, and the criticised
             * entity (when it resolves to the roster) becomes the target with a negative tone. Nothing changes when
             * `praised` is filled, when the post reads positive overall, or when no criticised entity resolves.
             */
            let toneOverride = null;
            if (resolvedTarget && resolvedTarget.affiliation && earlyTone === 'positive'
                && normalizeGeneric(raw.generic_sentiment) !== 'positive'
                && !(Array.isArray(raw.praised) && raw.praised.some((x) => x && (typeof x === 'string' ? x : x.text)))) {
                const criticisedItems = (Array.isArray(raw.criticised) ? raw.criticised : [])
                    .map((x) => (typeof x === 'string' ? { text: x } : x)).filter((x) => x && x.text);
                const criticisedRoster = resolveEntities(criticisedItems, ctx)
                    .filter((r) => r && (r.affiliation === 'ally' || r.affiliation === 'opposition') && r.key !== resolvedTarget.key);
                if (criticisedRoster.length && new Set(criticisedRoster.map((r) => r.affiliation)).size === 1) {
                    const next = criticisedRoster.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
                    console.log(`[politicalSentiment] positive tone toward ${resolvedTarget.canonical} has no praised entity and the post is not positive overall; using the criticised entity ${next.canonical} (${next.affiliation}) with a negative tone.`);
                    resolvedTarget = next;
                    toneOverride = 'negative';
                }
            }

            const { claimRaw, claimResolved } = resolveClaimSource(raw, ctx);
            const repointed = claimSelfTargetCorrection({
                raw, ctx, resolvedTarget, claimResolved,
                targetTone: toneOverride || earlyTone,
            });
            // One criticised item that itself names both camps ("BRS and BJP") is a criticism of both camps.
            let speakerAttacksBothCamps = criticisesBothCampsInOneItem && earlyTone !== 'positive';
            if (repointed && repointed.bothCamps) {
                console.log(`[politicalSentiment] claim source "${claimResolved.canonical}" criticises both camps; no side is claimed.`);
                speakerAttacksBothCamps = true;
            } else if (repointed) {
                console.log(`[politicalSentiment] claim source "${claimResolved.canonical}" was also the only camp criticised; re-pointing the target to ${repointed.canonical} (${repointed.affiliation}).`);
                resolvedTarget = repointed;
            }
            if (resolvedTarget && resolvedTarget.affiliation) {
                console.log(`[politicalSentiment] sentiment_target="${(rawTarget && rawTarget.text) || resolvedTarget.canonical}" → ${resolvedTarget.canonical} (${resolvedTarget.affiliation})`);
            }
            // A target the guards below may rely on: it resolved to a camp, and not as an ambiguous bare name.
            const confidentTarget = !!(resolvedTarget && resolvedTarget.affiliation
                && (resolvedTarget.confidence == null || resolvedTarget.confidence >= 0.6));
            let bothCampsReview = false;

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
            const targetTone = toneOverride || normalizeGeneric(raw.target_tone) || genericSentiment;
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

            // REPORTING ONLY. The model extracted a claim and its speaker but nothing praised or criticised, and
            // says the tone toward any target is neutral ("Congress says BRS and BJP are secretly together. Both
            // deny it."). The engine's "raw tone decides when the target tone is neutral" fallback would then read
            // the post's negative mood as an attack on whoever is listed first. Reporting a claim is not taking a
            // side, so the raw tone is withheld.
            const claimTypeProbe = String(raw.claim_type || '').toLowerCase().trim();
            const reportingOnly = targetTone === 'neutral'
                && !(Array.isArray(raw.praised) && raw.praised.length)
                && !(Array.isArray(raw.criticised) && raw.criticised.length)
                && !(resolvedTarget && resolvedTarget.affiliation)
                && !!claimResolved && ['allegation', 'fact_reported'].includes(claimTypeProbe);

            const stanceResult = computeStance({
                resolvedActors,
                resolvedTarget,
                candidateSubjects,
                generic_sentiment: toneTarget,
                raw_sentiment: reportingOnly ? 'neutral' : genericSentiment,
                ctx,
            });

            // Does anything the model named resolve to a ROSTER entity (a leader, party, the government, a scheme)?
            // That is itself proof the post is about this state, even when the deterministic pre-scan found
            // nothing (e.g. "our dear Revanth garu ...": the pre-scan did not know "garu").
            const listResolved = ['praised', 'criticised'].flatMap((f) => (Array.isArray(raw[f]) ? raw[f] : [])
                .map((x) => (typeof x === 'string' ? { text: x } : x)).filter((x) => x && x.text));
            const rosterResolved = [...resolvedActors, resolvedTarget, ...resolveEntities(listResolved, ctx)]
                .some((r) => r && r.key && POLITICAL_ENTITIES[r.key] && ['person', 'party', 'government', 'scheme'].includes(POLITICAL_ENTITIES[r.key].type));

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
                if (sided && speakerAttacksBothCamps) {
                    settle('neutral', 'the speaker criticises both camps: neutral');
                } else if (sided && ctx.government_era_ambiguous && !(resolvedTarget && resolvedTarget.affiliation)) {
                    // A generic "the government" that cannot be assigned to either administration, with nothing
                    // else to place the post: no side is claimed (the civic default would assume the CURRENT
                    // government, which is exactly the guess to avoid). The verdict is flagged for review below.
                    settle('neutral', 'which government is unclear: no side claimed');
                } else if (sided && ctx.has_state_signal === false && !rosterResolved) {
                    settle('unrelated', 'no state context: unrelated');
                } else if (sided && ctx.ceremonial && String(stanceResult.stance).startsWith('anti_target')
                    && (toneTarget === 'positive' || genericSentiment === 'positive')) {
                    settle('neutral', 'ceremonial tribute to an opposition figure: neutral');
                } else if (ctx.has_state_signal !== false && praisesAndCriticisesOurCamp(raw, ctx)) {
                    // Praise AND criticism both land on the client's own camp (e.g. "KCR built a
                    // great irrigation network, but BRS failed on jobs"). One sign would be wrong
                    // either way, so it is reported as what it is.
                    settle('mixed', 'praises and criticises the client camp: mixed');
                } else if (sided) {
                    const items = Array.isArray(raw.criticised)
                        ? raw.criticised.map((x) => (typeof x === 'string' ? { text: x } : x)).filter((x) => x && x.text)
                        : [];
                    const sides = new Set(resolveEntities(items, ctx).map((r) => r && r.affiliation).filter(Boolean));
                    if (sides.has('ally') && sides.has('opposition')) {
                        // The model's `criticised` list is a bag of phrases that also holds victims and quoted
                        // opponents ("suspended all the BRS MLAs"), so a list that spans both camps does not by
                        // itself mean both camps are blamed. A resolved target is kept ONLY while the directional
                        // evidence is consistent with it:
                        //   - the text blames both camps together (an equal-blame cue)  -> neutral, review;
                        //   - the OTHER camp is named in the list as an entity in its own right ("Revanth Reddy" and
                        //     "BRS" side by side) - the list itself contradicts the target -> neutral, review;
                        //   - no resolved target at all                                  -> neutral, review;
                        //   - otherwise the other camp appears only inside an event phrase (a victim, a quoted
                        //     opponent) and the target stands.
                        // An "entity item" is a short item (at most three words) that resolves to the roster.
                        const targetCamp = confidentTarget ? resolvedTarget.affiliation : null;
                        const otherCampNamedAsEntity = !!targetCamp && items.some((it) => {
                            if (String(it.text).trim().split(/\s+/).length > 3) return false;
                            const r = resolveEntities([it], ctx)[0];
                            return !!(r && (r.affiliation === 'ally' || r.affiliation === 'opposition') && r.affiliation !== targetCamp);
                        });
                        if (EQUAL_BLAME_RX.test(`${text || ''} ${raw.english_translation || ''}`)) {
                            settle('neutral', 'criticises both camps equally: neutral');
                            bothCampsReview = true;
                        } else if (!confidentTarget) {
                            settle('neutral', 'criticises both camps, no separable target: neutral');
                            bothCampsReview = true;
                        } else if (otherCampNamedAsEntity) {
                            settle('neutral', 'criticised list names both camps as entities, so the target is not supported: neutral');
                            bothCampsReview = true;
                        } else {
                            console.log(`[politicalSentiment] criticised list spans both camps but the other camp appears only inside an event phrase; keeping the target ${resolvedTarget.canonical} (${resolvedTarget.affiliation}).`);
                        }
                    }
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

            // Who MAKES the claim (not who it is about). An accusation is a claim, not a fact.
            const claimTypeRaw = String(raw.claim_type || '').toLowerCase().trim().replace(/[-\s]/g, '_');
            const claimType = ALLOWED_CLAIM_TYPES.includes(claimTypeRaw) ? claimTypeRaw : 'none';
            // The model sometimes gives claim_type "allegation" but leaves claim_source null ("Revanth Reddy accuses
            // KCR of ..."). When exactly ONE resolved person/party in the post is not the target, that is the speaker.
            let claimSourceFinal = claimResolved;
            if (!claimSourceFinal && ['allegation', 'opinion'].includes(claimType)) {
                const targetKey = resolvedTarget && resolvedTarget.key;
                const speakers = resolvedActors.filter((a) => a && a.key && a.key !== targetKey && POLITICAL_ENTITIES[a.key] && ['person', 'party', 'government'].includes(POLITICAL_ENTITIES[a.key].type));
                if (speakers.length === 1) claimSourceFinal = speakers[0];
            }
            const attribution = (claimRaw || claimSourceFinal || claimType !== 'none') ? {
                claim_source: (claimSourceFinal && claimSourceFinal.canonical) || (claimRaw && claimRaw.text) || null,
                claim_source_key: (claimSourceFinal && claimSourceFinal.key) || null,
                claim_source_alignment: (claimSourceFinal && claimSourceFinal.affiliation) || null,
                claim_type: claimType,
                // We do not verify claims. An allegation stays an allegation however often it is repeated.
                verified_fact: false,
            } : null;

            const verdict = {
                client_relevance: defaultClientRelevance(ctx, stanceResult),
                target: deriveTarget({ resolvedTarget, scoredEntity: stanceResult.scored_entity, ctx }),
                attribution,
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
                narrative_direction: `${String(stanceResult.rationale || '')}${attribution && attribution.claim_type === 'allegation' && attribution.claim_source ? ` [allegation by ${attribution.claim_source} - a claim, not a verified fact]` : ''}`.trim(),
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
                sarcasm_detected: !!raw.sarcasm_detected || raw.emotion === 'sarcasm',
                emotional_intensity: clamp01(raw.emotional_intensity || 0),
                misinformation_probability: clamp01(raw.misinformation_probability || 0),
                language_detected: String(raw.language_detected || ''),
                english_translation: String(raw.english_translation || ''),
                analysis: String(raw.analysis || ''),
                reasoning: String(raw.reasoning || ''),
                needs_review: fused.needs_review,
            };

            /**
             * POSSIBLE SARCASM. Praise words ("great job", "so proud", "thank you", clapping/prayer emoji) sitting
             * next to damaging facts (a leaked paper, shortages, queues, a scam) are far more often mockery than
             * praise ("Great job Congress government, another exam paper leaked. So proud!"). A 7B model reads the
             * praise literally. Flipping on a word list would be a guess, so nothing is flipped: the verdict is
             * marked as possible sarcasm and sent to review with its confidence capped.
             */
            if (/^(pro|anti)_target/.test(verdict.stance) && (verdict.target_tone === 'positive' || verdict.generic_sentiment === 'positive')) {
                const praiseWords = /\b(great job|good job|well done|wow|so proud|proud of|thank you|thanks|brilliant|amazing|excellent|beautifully|bravo|love|super)\b|[\u{1F44F}\u{1F64F}\u{1F602}\u{1F923}\u{1F44C}]/iu;
                const damaging = /\b(leak(?:ed|s)?|scam|scandal|fail(?:ed|ure|s)?|shortage|queues?|cuts?|collaps\w+|delay(?:ed|s)?|cheat\w*|fraud|corrupt\w*|crisis|loot(?:ed)?|bulldoz\w+|denied|stuck|waiting|wasted|ruined)\b/i;
                if (praiseWords.test(String(text || '')) && damaging.test(String(text || '')) || raw.emotion === 'sarcasm') {
                    verdict.sarcasm_detected = true;
                    verdict.needs_review = true;
                    verdict.narrative_direction = `${verdict.narrative_direction} [possible sarcasm: praise wording beside damaging facts]`.trim();
                    verdict.confidence.stance = Math.min(verdict.confidence.stance, 0.5);
                    verdict.confidence.sentiment = Math.min(verdict.confidence.sentiment, 0.5);
                }
            }

            // Both camps criticised and the direction cannot be settled (or the text blames both): neutral, but a person should look.
            if (bothCampsReview) {
                verdict.needs_review = true;
                verdict.ambiguous_entities = [...(verdict.ambiguous_entities || []), 'target (both camps criticised)'];
                verdict.confidence.stance = Math.min(verdict.confidence.stance, 0.5);
            }

            // "The government" with nothing to say WHICH government (current Congress vs BRS's own years):
            // never guess a camp. The target stays unresolved and the verdict goes to review.
            if (ctx.government_era_ambiguous) {
                verdict.needs_review = true;
                verdict.ambiguous_entities = [...(verdict.ambiguous_entities || []), 'government (current vs BRS era)'];
                verdict.confidence.relevance = Math.min(verdict.confidence.relevance, 0.5);
            }

            // "TRS" with nothing to say which party it is: never guess, send it to review.
            if (ctx.trs_ambiguous) {
                verdict.needs_review = true;
                verdict.ambiguous_entities = ['TRS'];
                verdict.confidence.relevance = Math.min(verdict.confidence.relevance, 0.5);
            }

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
             * CONSISTENCY VALIDATOR — notices a contradiction in the assembled verdict; it does NOT rewrite it.
             *
             * This stage used to flip a neutral stance to `anti_target` whenever the target was an ally with a
             * negative tone. But the neutral it overwrote was usually DELIBERATE: the stance engine's
             * author-is-target correction returns neutral for an official BRS account whose negative post is not
             * aimed at its own party (live: @ktrbrs attacking a rival the roster could not place came out as an
             * attack on KTR, adverse to the client). A later check must never invent a different stance from an
             * intermediate field; when the verdict looks contradictory and cannot be settled safely it is marked
             * for review with reduced confidence and its stance is left exactly as the engine produced it.
             */
            if (
                verdict.client_relevance !== 'not_relevant'
                && (verdict.stance === 'neutral' || verdict.stance === 'unrelated')
                && (ctx.mode === 'about_target' || ctx.mode === 'civic_grievance')
                && !guardSettled // a guard above settled this deliberately
            ) {
                const ours = (name) => (ctx.mentioned_entities || []).some(
                    (e) => e.alignment === 'ally'
                        && [String(e.canonical || '').toLowerCase(), String(e.key || '').toLowerCase()].includes(String(name || '').toLowerCase().trim()),
                );
                const attacksAlly = verdict.attack_target ? ours(verdict.attack_target)
                    : (verdict.target_tone === 'negative' && ours(verdict.target_entity));
                if (attacksAlly) {
                    console.warn(`[politicalSentiment] Consistency validator: negative tone toward ally "${verdict.target_entity}" but the stance is ${verdict.stance}; leaving the engine's verdict and flagging it for review.`);
                    verdict.needs_review = true;
                    verdict.confidence.stance = Math.min(verdict.confidence.stance, 0.4);
                    verdict.narrative_direction = `${verdict.narrative_direction} [validation: negative tone toward an ally target but the stance is ${verdict.stance} - review]`.trim();
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
    ALLOWED_CLAIM_TYPES,
    ALLOWED_EMOTIONS,
    deriveTarget,
    classifyTargetEntity,
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
