/**
 * hashtagSignals
 * ─────────────────────────────────────────────────────────────────────────────
 * Two small jobs, both about hashtags, both deliberately conservative.
 *
 *   1. segmentHashtags()  — split compound hashtags so the existing alias scan
 *                           can see the entity glued inside them.
 *   2. STANCE_HASHTAGS    — the curated few that carry a DIRECTION, not just a
 *                           name.
 *
 * ── 1. WHY SEGMENTATION, AND WHY SO LITTLE OF IT ──
 * The alias scan already catches many hashtags, because it is a substring match:
 * `#KTR` and `#CongressTelangana` already contain the aliases "ktr"
 * and "congress". Multi-word aliases ("chandrashekar rao") need the space that
 * segmentation below restores.
 *
 * What fails is a SHORT alias glued to a preceding word. Aliases of 4 characters
 * or fewer require a non-word boundary (so "inc" does not match "including"), and
 * in `#TGRejectsBJP` the "bjp" is preceded by "s" — no boundary, no match.
 * Splitting on case transitions turns it into "TG Rejects BJP" and the existing
 * rule works.
 *
 * So this adds ONE narrow capability. It does not attempt general word
 * segmentation of `#savemusiriver` — that needs a dictionary, and guessing
 * word boundaries invents entities that were never mentioned.
 *
 * ── 2. WHY A CURATED LIST FOR STANCE ──
 * `#SaveMusi` names no leader at all, yet it is an attack on the government's
 * handling of the Musi riverfront displacements. The direction lives in the campaign phrase,
 * which cannot be derived from a roster of names.
 *
 * These cannot be generated, only listed, so the list is short and explicit.
 * Anything not on it contributes an entity mention and nothing more.
 *
 * ── THE GUARDS ──
 * • Capped. A stuffed post (one real example carried 12 hashtags) would otherwise
 *   look like it is about everyone.
 * • Advisory only. These signals are exposed on the context for the prompt and
 *   for review; they never overrule what the sentence itself says. A hashtag can
 *   ADD an entity, never outrank the body text.
 */

/**
 * Hashtags carrying a direction, not just a name. `target` is a roster key.
 * Only tags with evidence of real use in Telangana political posts
 * (researched Sep 2026, evidence URLs kept with the clone's research notes) are
 * listed; extend as new campaign tags appear. Keys are lower-case; Devanagari
 * keys are kept as written (toLowerCase leaves them unchanged).
 *
 * Left out on purpose: #विष्णु_का_सुशासन — the only verified hashtag uses are
 * Congress posts using it sarcastically, so its direction is not reliable.
 * #VishnuKaSushasan (Roman) is the government's own tag; Congress has also used
 * it sarcastically, which is why these signals stay advisory.
 */
const STANCE_HASHTAGS = {
    /*
     * ⚠ DIRECTIONS ARE INVERTED relative to a ruling-party deployment.
     * "attack" here means attacking whoever the `target` is; because our client
     * is in opposition, a tag attacking the GOVERNMENT is favourable to us.
     *
     * ⚠ THIS LIST IS A STARTING SET, NOT A MEASURED ONE. Each entry below is
     * derived from a documented controversy, not from observed hashtag volume
     * in this corpus — which does not exist yet, because the deployment is new.
     * Tags that never trend simply never match and cost nothing; the risk is the
     * opposite, a real tag missing. Review this against actual traffic after the
     * first weeks of collection and add what is actually circulating.
     */

    // ── attacks on US (our own vulnerabilities) ──
    // Kaleshwaram is the heaviest: CAG findings, the Ghose Commission holding
    // KCR responsible, and a CBI referral all attach to it.
    kaleshwaram: { target: 'scheme-kaleshwaram', direction: 'attack' },
    kaleshwaramscam: { target: 'scheme-kaleshwaram', direction: 'attack' },
    medigadda: { target: 'scheme-kaleshwaram', direction: 'attack' },
    phonetapping: { target: 'brs', direction: 'attack' },
    formulaescam: { target: 'ktr', direction: 'attack' },
    dharanischam: { target: 'scheme-dharani', direction: 'attack' },
    kcrfamilyrule: { target: 'brs', direction: 'attack' },

    // ── attacks on the GOVERNMENT (favourable to us) ──
    congressfailed: { target: 'inc', direction: 'attack' },
    congressbetrayal: { target: 'inc', direction: 'attack' },
    brokenpromises: { target: 'inc', direction: 'attack' },
    // The gap between the promised Rs 15,000 and the delivered Rs 12,000.
    rythubharosafailure: { target: 'scheme-rythu-bharosa', direction: 'attack' },
    loanwaiverfraud: { target: 'inc', direction: 'attack' },
    savemusi: { target: 'scheme-musi-riverfront', direction: 'attack' },
    hydraainjustice: { target: 'scheme-hydraa', direction: 'attack' },

    // ── support for US ──
    brs: { target: 'brs', direction: 'support' },
    brsparty: { target: 'brs', direction: 'support' },
    kcrgovernance: { target: 'kcr', direction: 'support' },
    // The legacy record the party wants remembered.
    rythubandhu: { target: 'scheme-rythu-bandhu', direction: 'support' },
    dalitbandhu: { target: 'scheme-dalit-bandhu', direction: 'support' },
    missionbhagiratha: { target: 'scheme-mission-bhagiratha', direction: 'support' },
    'బీఆర్ఎస్': { target: 'brs', direction: 'support' },

    // ── support for the GOVERNMENT (adverse to us) ──
    revanthreddy: { target: 'revanth-reddy', direction: 'support' },
    prajapalana: { target: 'inc', direction: 'support' },
    indirammarajyam: { target: 'inc', direction: 'support' },
};

/** Hard ceiling on hashtags considered, defeating hashtag-stuffing. */
const MAX_HASHTAGS = parseInt(process.env.MAX_HASHTAGS_CONSIDERED || '12', 10);

/**
 * Every hashtag in the post, `#` stripped, in order, capped.
 *
 * CASE IS PRESERVED. Segmentation splits on case transitions, so lowercasing
 * here would destroy the only boundary "#CGRejectsBJP" has and silently reduce this
 * module to a no-op. Callers that need a lookup key lowercase at the point of
 * use; de-duplication is case-insensitive so "#BJP" and "#bjp" count once.
 */
const extractHashtags = (text) => {
    const out = [];
    const seen = new Set();
    // \p{L}\p{M}\p{N} keeps Devanagari tags whole — Indic vowel signs are
    // separate combining marks and \w alone would cut a tag in half.
    const rx = /#([\p{L}\p{M}\p{N}_]{2,60})/gu;
    let m;
    while ((m = rx.exec(String(text || ''))) !== null) {
        const tag = m[1];
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(tag);
        if (out.length >= MAX_HASHTAGS) break;
    }
    return out;
};

/**
 * Split compound hashtags on case transitions and separators, and return the
 * pieces as spaced text for the alias scan to read.
 *
 * `#CGRejectsBJP` → "CG Rejects BJP" → the short alias "bjp" now has a word boundary.
 *
 * Returns '' when nothing splits, so callers can skip a second scan entirely.
 */
const segmentHashtags = (text) => {
    const pieces = [];
    for (const tag of extractHashtags(text)) {
        const split = String(tag)
            // camelCase / PascalCase boundaries, both directions, so "CGRejectsBJP"
            // and "BRSTelangana" both break correctly.
            .replace(/([a-z\d])([A-Z])/g, '$1 $2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
            .replace(/[_\-.]+/g, ' ')
            .trim();
        // Only worth adding when it actually changed — otherwise the plain scan
        // has already seen this exact string.
        if (split && split !== tag) pieces.push(split);
    }
    return pieces.join(' ');
};

/**
 * Curated stance hashtags present in the text.
 * @returns {Array<{tag, target, direction}>}
 */
const findStanceHashtags = (text) => {
    const out = [];
    for (const tag of extractHashtags(text)) {
        const hit = STANCE_HASHTAGS[tag.toLowerCase()];
        if (hit) out.push({ tag, target: hit.target, direction: hit.direction });
    }
    return out;
};

module.exports = {
    STANCE_HASHTAGS,
    MAX_HASHTAGS,
    extractHashtags,
    segmentHashtags,
    findStanceHashtags,
};
