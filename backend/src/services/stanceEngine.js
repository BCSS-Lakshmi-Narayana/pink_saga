/**
 * stanceEngine.js — Stage 4 of the target-aware sentiment pipeline.
 *
 * Given the resolved actors, the resolved sentiment TARGET, the tone aimed at
 * that target, and the Stage 2 context, this computes the client-relative
 * stance DETERMINISTICALLY. No LLM call, no network, no DB — the same inputs
 * always produce the same verdict.
 *
 * ═══ THE ONE RULE ═══════════════════════════════════════════════════════
 *   generic_sentiment = the literal tone of the text
 *   target_sentiment  = is this good or bad FOR OUR CLIENT (BRS, in OPPOSITION)
 *
 *   These are different values. "Congress looted Telangana" is generically NEGATIVE
 *   and client-POSITIVE. NEVER convert one directly into the other — always
 *   resolve the target and its camp first. Every historical bug in this
 *   subsystem has been a variant of that rule being broken.
 * ════════════════════════════════════════════════════════════════════════
 *
 * The decision matrix is client-agnostic: it reasons in terms of ally and
 * opposition, never BJP or INC by name. Alignment comes from the roster
 * (config/politicalEntities.js), which is the only state-specific input.
 */

const { POLITICAL_ENTITIES, resolveEntityKey } = require('../config/politicalEntities');
// Needed by civicVerdict below: whether the client governs decides who an
// unattributed service complaint reflects on.
const { OUR_PARTY } = require('../config/politicalData');

/**
 * Alignment for a resolved actor. Prefers the affiliation the resolver already
 * attached; falls back to a roster lookup by entity key or canonical name so a
 * partially-populated actor object still lands on the right side.
 */
/** Party code of a resolved actor/target ('inc', 'bjp', …) from the roster, or null. */
const partyOf = (resolvedActor) => {
    if (!resolvedActor) return null;
    const key = resolveEntityKey(resolvedActor.key || resolvedActor.canonical);
    const ent = key ? POLITICAL_ENTITIES[key] : null;
    return ent && ent.party ? String(ent.party).toLowerCase() : null;
};

const alignmentOf = (resolvedActor) => {
    if (!resolvedActor) return null;
    if (resolvedActor.affiliation === 'ally' || resolvedActor.affiliation === 'opposition') {
        return resolvedActor.affiliation;
    }
    if (resolvedActor.affiliation === 'neutral') return 'neutral';

    const key = resolveEntityKey(resolvedActor.key || resolvedActor.canonical);
    const ent = key ? POLITICAL_ENTITIES[key] : null;
    return ent ? ent.alignment || null : null;
};

/**
 * Find an ally/opposition hit straight from the deterministic Stage 2 pre-scan.
 * Used when the LLM's actor extraction surfaced nobody resolvable — e.g. a
 * passing mention, or a joke where the entity is present in the text but the
 * model did not treat them as "the actor".
 */
const findCtxHit = (ctx, alignment) => {
    const list = ctx && Array.isArray(ctx.mentioned_entities) ? ctx.mentioned_entities : [];
    return list.find((e) => e.alignment === alignment) || null;
};

/**
 * THE DECISION MATRIX, IN ONE PLACE.
 *
 * Every branch below calls this, so the rules cannot drift apart per branch —
 * which is exactly how a matrix ends up disagreeing with itself.
 *
 * Note the deliberate asymmetry: PRAISE leaves `attack_target` empty —
 * whether the praise is of an ally or of the opposition, nobody is being
 * attacked. Only a NEGATIVE tone names the entity it lands on. Filling it on
 * praise-of-opposition made cards read "attack on <the leader being welcomed>"
 * (seen on three Congress posts welcoming their own state in-charge).
 * This is pinned by the regression suite.
 */
const applyMatrix = (side, entityLabel, tone, rationale) => ({
    ...applyMatrixCore(side, entityLabel, tone, rationale),
    // The entity the verdict was scored on. Callers use it as `target_entity`,
    // so leader popularity credits the same person the stance is about.
    scored_entity: entityLabel || '',
    scored_side: side,
});

const applyMatrixCore = (side, entityLabel, tone, rationale) => {
    if (side === 'ally') {
        if (tone === 'negative') {
            return { stance: 'anti_target', beneficiary: 'opposition', attack_target: entityLabel || '', rationale };
        }
        if (tone === 'positive') {
            return { stance: 'pro_target', beneficiary: 'ours', attack_target: '', rationale };
        }
        return { stance: 'neutral', beneficiary: 'none', attack_target: '', rationale };
    }

    // opposition
    if (tone === 'negative') {
        // Negative about the opposition helps our client indirectly.
        return { stance: 'pro_target_indirect', beneficiary: 'ours', attack_target: entityLabel || '', rationale };
    }
    if (tone === 'positive') {
        // Praise, not an attack — see the asymmetry note on applyMatrix.
        return { stance: 'anti_target_indirect', beneficiary: 'opposition', attack_target: '', rationale };
    }
    return { stance: 'neutral', beneficiary: 'none', attack_target: '', rationale };
};

/**
 * Civic grievance with no named political actor. A service-failure complaint
 * implicates the RULING government by default, and a civic improvement
 * credits it.
 *
 * ⚠ WHO THAT HELPS DEPENDS ON WHETHER WE GOVERN.
 *
 * Earlier deployments of this codebase were all ruling-party, so "implicates
 * the ruling government" and "damages the client" were the same statement and
 * the code could collapse them. For an OPPOSITION client they are opposites:
 * the potholes are the other side's to answer for, so the same complaint is
 * mildly good news for us.
 *
 * Left unfixed this is invisible and large: unattributed civic grievances are
 * a substantial share of the corpus and every one would carry the wrong sign.
 * The direction is therefore read from the roster, never assumed.
 */
const WE_GOVERN = OUR_PARTY.in_power !== false && OUR_PARTY.role !== 'opposition';

const civicVerdict = (tone) => {
    if (tone === 'negative') {
        // Blame lands on whoever governs.
        return WE_GOVERN
            ? { stance: 'anti_target', beneficiary: 'opposition', attack_target: '', rationale: 'civic grievance (unnamed)' }
            : { stance: 'pro_target_indirect', beneficiary: 'ours', attack_target: 'state_government', rationale: 'civic grievance (unnamed) — implicates the rival government' };
    }
    if (tone === 'positive') {
        // Credit lands on whoever governs.
        return WE_GOVERN
            ? { stance: 'pro_target', beneficiary: 'ours', attack_target: '', rationale: 'civic improvement (unnamed)' }
            : { stance: 'anti_target_indirect', beneficiary: 'opposition', attack_target: '', rationale: 'civic improvement (unnamed) — credits the rival government' };
    }
    return { stance: 'neutral', beneficiary: 'none', attack_target: '', rationale: 'civic grievance (unnamed, neutral tone)' };
};

/**
 * @param {object}   input
 * @param {Array}    input.resolvedActors     entities appearing in the post
 * @param {object}   input.resolvedTarget     the entity the tone is aimed AT (may be null)
 * @param {Array}    input.candidateSubjects  beneficiary groups (students, farmers…)
 * @param {string}   input.generic_sentiment  the tone the matrix should consume —
 *                                            callers pass `target_tone` here when
 *                                            it was extracted (see politicalSentimentService)
 * @param {object}   input.ctx                politicalContextService snapshot
 */
const compute = ({
    resolvedActors = [],
    resolvedTarget = null,
    candidateSubjects = [],
    generic_sentiment = 'neutral',
    raw_sentiment = null,
    ctx = {},
} = {}) => {
    // `generic_sentiment` here is the tone aimed AT the target. When the model
    // could not read one ("neutral") but the post itself clearly leans
    // positive or negative ("CM inaugurated the bridge, great relief!"), the
    // post's raw sentiment decides. A deliberate mixed post keeps its explicit
    // target tone ("I back the farmers — the govt order must go" = negative).
    const rawTone = raw_sentiment === 'positive' || raw_sentiment === 'negative' ? raw_sentiment : null;
    // 'moderate' is the retired name of 'neutral'.
    const targetTone = generic_sentiment === 'moderate' ? 'neutral' : generic_sentiment;
    const tone = targetTone === 'neutral' && rawTone ? rawTone : targetTone;
    // A civic complaint names no target, so its raw tone is the only signal.
    const civicTone = rawTone || tone;

    // Nothing to reason about at all — except a civic grievance, which
    // implicates the government even when nobody is named ("no water in
    // Porvorim for 4 days").
    if (!resolvedActors.length && !candidateSubjects.length && !resolvedTarget) {
        if (ctx && ctx.mode === 'civic_grievance') return civicVerdict(civicTone);
        // The extractor named nobody, but the post itself names roster entities
        // of ONE camp only (a tagged handle, 'सुशासन सरकार') and has a clear tone:
        // that camp is what the tone is about.
        const ctxSides = [...new Set((ctx?.mentioned_entities || []).map((e) => e.alignment).filter((a) => a === 'ally' || a === 'opposition'))];
        if (ctxSides.length === 1 && (tone === 'positive' || tone === 'negative')) {
            const named = ctx.mentioned_entities.find((e) => e.alignment === ctxSides[0]);
            return applyMatrix(ctxSides[0], named.canonical || named.key, tone, 'context rule (one camp named)');
        }
        return { stance: 'unrelated', beneficiary: 'none', attack_target: '', rationale: 'no actors/subjects' };
    }

    const allyHit = resolvedActors.find((r) => alignmentOf(r) === 'ally');
    const oppHit = resolvedActors.find((r) => alignmentOf(r) === 'opposition');

    // Stage 2 found nothing political, but the extractor resolved a rostered
    // actor or target (typically a name written in a script Stage 2 has no
    // alias for). The resolver is the later, better-informed signal, so the
    // "irrelevant" short-circuit applies only when nothing resolved to a side.
    const targetResolvesToSide = ['ally', 'opposition'].includes(alignmentOf(resolvedTarget));
    if (ctx && ctx.mode === 'irrelevant' && !targetResolvesToSide && !allyHit && !oppHit) {
        return { stance: 'unrelated', beneficiary: 'none', attack_target: '', rationale: 'context not relevant' };
    }

    /**
     * AUTHORITATIVE: who the tone is actually directed AT.
     *
     * The actor list answers "who appears in this post", NOT "who is this post
     * about" — and `.find()` over it picks whichever side the extractor happened
     * to list first, so a post naming BOTH camps could resolve either way on
     * different runs of the same text. That is the non-determinism this field
     * exists to kill.
     *
     * Purely additive: when `sentiment_target` is absent, or resolves to
     * nothing/neutral, every branch below runs exactly as it did before, so
     * single-side posts are unaffected.
     */
    const targetAlignment = alignmentOf(resolvedTarget);
    const targetSide = (targetAlignment === 'ally' || targetAlignment === 'opposition')
        ? targetAlignment
        : null;

    /**
     * CROSS-CAMP PRIOR — an opponent addressing our side is not endorsing it.
     *
     * A deterministic backstop for the case where the extractor picks the right
     * target but the wrong tone. When a roster-resolved OPPOSITION author
     * addresses OUR side and the extractor still claims the tone is positive,
     * that is the far less likely reading: genuine cross-camp praise is rare,
     * whereas criticism wrapped around support for a sympathetic group is the
     * single most common political post shape.
     *
     * It does NOT silently invert the verdict — that would suppress real
     * congratulations and condolences. It downgrades the tone to `neutral`, so
     * the post lands on `neutral` + human review instead of asserting good news
     * for the client. Symmetric for an ally author addressing the opposition.
     * Fires only when the author actually resolves to the roster, so citizen and
     * parody accounts are untouched.
     */
    const authorAlignment = ctx && ctx.author_alignment;
    const authorIsRostered = authorAlignment === 'ally' || authorAlignment === 'opposition';

    let effectiveTone = tone;
    if (targetSide && authorIsRostered && authorAlignment !== targetSide && tone === 'positive') {
        effectiveTone = 'neutral';
    }

    if (targetSide) {
        /**
         * AUTHOR-IS-TARGET CORRECTION — "a speaker does not attack themselves".
         *
         * The extractor's most common failure is returning the SPEAKER as the
         * sentiment target. When the extracted target is the author's OWN side,
         * the tone is negative, and the OTHER camp is present in the post, the
         * extraction is almost certainly inverted — so re-point it.
         *
         * Kept deliberately narrow so it cannot corrupt legitimate cross-camp
         * attacks. Requires ALL of:
         *   • the author actually resolves to the roster (null ⇒ never fires);
         *   • the OPPOSITE camp is present, so an opposition account attacking
         *     another opposition party (no ally named) is untouched;
         *   • negative tone only — praise of one's own side is normal.
         */
        if (effectiveTone === 'negative' && authorIsRostered && targetSide === authorAlignment) {
            const otherSide = authorAlignment === 'ally' ? 'opposition' : 'ally';
            const otherHit = findCtxHit(ctx, otherSide);
            if (otherHit) {
                return applyMatrix(
                    otherSide,
                    otherHit.canonical,
                    effectiveTone,
                    `author-is-target correction (author=${authorAlignment}, re-pointed to ${otherSide})`,
                );
            }
            // No other camp named, and the target is the author's OWN party:
            // the speaker is attacking someone the roster does not place (the
            // Election Commission, an institution, an unnamed "they"), not
            // itself. Scoring it as an attack on its own party would invert
            // it, so it is neutral. A different party of the same camp (AAP
            // attacking Congress) is a real attack and is left alone.
            const targetParty = partyOf(resolvedTarget);
            if (ctx.author_party && targetParty && ctx.author_party === targetParty) {
                return applyMatrix(
                    targetSide,
                    resolvedTarget.canonical || resolvedTarget.text,
                    'neutral',
                    `author-is-target correction (author party ${ctx.author_party} = target party, no other camp named — neutral)`,
                );
            }
        }

        return applyMatrix(
            targetSide,
            resolvedTarget.canonical || resolvedTarget.text,
            effectiveTone,
            `sentiment-target rule (${targetSide}${effectiveTone !== tone ? ', cross-camp prior applied' : ''})`,
        );
    }

    /**
     * Actor-based fallback (no usable target). Same "a speaker does not attack
     * itself" guard as the target branch: when the only side found is the
     * AUTHOR'S OWN party and the tone is negative, the anger is aimed at
     * someone the roster does not place (the Election Commission, an unnamed
     * "they") — neutral, not an attack on the author's own party.
     */
    const scoreHit = (side, hit, rule) => {
        if (tone === 'negative' && ctx && ctx.author_party && partyOf(hit) === ctx.author_party) {
            return applyMatrix(side, hit.canonical || hit.text, 'neutral', `${rule} — author's own party with negative tone, target not placed — neutral`);
        }
        return applyMatrix(side, hit.canonical || hit.text, tone, rule);
    };

    if (allyHit) {
        return scoreHit('ally', allyHit, 'ally-based rule');
    }

    if (oppHit) {
        return scoreHit('opposition', oppHit, 'opposition-based rule');
    }

    // Neither the extractor's actors nor the target resolved to a side. Before
    // giving up, consult the Stage 2 pre-scan directly — it can carry a hit the
    // "candidate actor" framing missed (a name mentioned only in passing, or
    // inside a joke/parody post).
    const ctxAlly = findCtxHit(ctx, 'ally');
    if (ctxAlly) {
        return scoreHit('ally', ctxAlly, 'ally-based rule (context fallback)');
    }

    const ctxOpp = findCtxHit(ctx, 'opposition');
    if (ctxOpp) {
        return scoreHit('opposition', ctxOpp, 'opposition-based rule (context fallback)');
    }

    /**
     * Civic grievance with no named political actor. A service-failure complaint
     * still implicates the RULING government by default (that is the BJP-led government
     * here), and a civic improvement still credits it — independent of whether
     * any leader was named.
     */
    if (ctx && ctx.mode === 'civic_grievance') {
        return civicVerdict(civicTone);
    }

    /**
     * No identifiable political side at all.
     *
     * Do NOT mirror the generic text tone onto the client-relative stance (see
     * THE ONE RULE at the top). An off-topic, joke, or generically-emotional
     * post with no resolvable actor or target is politically NEUTRAL regardless
     * of how positive or negative its language is.
     */
    return {
        stance: 'neutral',
        beneficiary: 'none',
        attack_target: '',
        rationale: 'no resolvable political actor — neutral (not mirroring generic sentiment)',
    };
};

module.exports = { compute, applyMatrix, alignmentOf };
