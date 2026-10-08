/**
 * stanceVocabulary.js — the ONE place stance values are named and mapped.
 *
 * ═══ WHAT "TARGET" MEANS IN `pro_target` / `anti_target` ═════════════════════
 * The "target" is the CLIENT: BRS and its leadership (KCR, KTR, Harish Rao).
 * It is NOT "whoever the post is about". So:
 *
 *   pro_target            helps the client directly   (praise/defence of BRS or its leaders)
 *   anti_target           hurts the client directly   (criticism of / allegations against BRS)
 *   pro_target_indirect   helps the client indirectly (a RIVAL — the Congress government,
 *                                                      BJP, AIMIM … — is criticised)
 *   anti_target_indirect  hurts the client indirectly (a rival is praised)
 *   neutral               no effect / simple mention / reporting
 *   mixed                 clearly conflicting sentiment toward the client itself
 *   unrelated             not about the client's political world at all
 *
 * In this deployment the client-facing names are the same values:
 *   pro_client ≡ pro_target*   anti_client ≡ anti_target*
 *   neutral_client ≡ neutral   mixed_client ≡ mixed
 * `*_client` is therefore a VIEW (clientStance() below), not a second stored
 * vocabulary, so no database field is renamed and no record is migrated.
 *
 * LEGACY. `pro_bsk` / `anti_bsk` (+ `_indirect`) were written before the rename.
 * They are read as the same *_target value. They are NEVER written. (A scan of the
 * live database found none stored; the mapping exists for older exports/backups.)
 * `pro_client` / `anti_client` were written by the live-chat analyser for a while;
 * those rows mean the same thing as `pro_target` / `anti_target`.
 */

const CANONICAL_STANCES = [
    'pro_target',
    'anti_target',
    'pro_target_indirect',
    'anti_target_indirect',
    'neutral',
    'mixed',
    'unrelated',
];

/** Accepted on input, mapped to a canonical value. Anything else becomes 'unrelated'. */
const LEGACY_STANCE_MAP = {
    pro_bsk: 'pro_target',
    anti_bsk: 'anti_target',
    pro_bsk_indirect: 'pro_target_indirect',
    anti_bsk_indirect: 'anti_target_indirect',
    pro_client: 'pro_target',
    anti_client: 'anti_target',
    pro_client_indirect: 'pro_target_indirect',
    anti_client_indirect: 'anti_target_indirect',
    neutral_target: 'neutral',
    neutral_client: 'neutral',
    mixed_target: 'mixed',
    mixed_client: 'mixed',
};

const normalizeStance = (value) => {
    let s = String(value || '').toLowerCase().trim().replace(/[-\s]/g, '_');
    if (LEGACY_STANCE_MAP[s]) s = LEGACY_STANCE_MAP[s];
    return CANONICAL_STANCES.includes(s) ? s : 'unrelated';
};

/**
 * A stance entered by a PERSON (review screen, API): "pro" / "anti" / "neutral" / "mixed" /
 * "unrelated", the *_client forms, or any canonical/legacy name. A person says whether the post
 * helps or hurts the client; they do not say whether it is direct or indirect, so that is taken
 * from which camp the verdict's target entity is on: a RIVAL target ('opposition') means indirect.
 * Returns a canonical stance, or null when the input is not a stance at all.
 */
const stanceFromOperator = (value, { targetAlignment = null } = {}) => {
    const v = String(value || '').toLowerCase().trim().replace(/[-\s]/g, '_');
    if (!v) return null;
    const indirect = targetAlignment === 'opposition';
    if (['pro', 'pro_client', 'pro_brs'].includes(v)) return indirect ? 'pro_target_indirect' : 'pro_target';
    if (['anti', 'anti_client', 'anti_brs'].includes(v)) return indirect ? 'anti_target_indirect' : 'anti_target';
    if (['neutral', 'neutral_client'].includes(v)) return 'neutral';
    if (['mixed', 'mixed_client'].includes(v)) return 'mixed';
    if (CANONICAL_STANCES.includes(v) || LEGACY_STANCE_MAP[v]) return normalizeStance(v);
    return null;
};

/**
 * The client-facing reading of a stance: 'pro_client' | 'anti_client' |
 * 'neutral_client' | 'mixed_client'. `unrelated` reads as neutral_client — it
 * neither helps nor hurts — but callers that must exclude it (a share-of-voice
 * denominator) should test for 'unrelated' themselves.
 */
const clientStance = (value) => {
    const s = normalizeStance(value);
    if (s === 'pro_target' || s === 'pro_target_indirect') return 'pro_client';
    if (s === 'anti_target' || s === 'anti_target_indirect') return 'anti_client';
    if (s === 'mixed') return 'mixed_client';
    return 'neutral_client';
};

const isProClient = (value) => clientStance(value) === 'pro_client';
const isAntiClient = (value) => clientStance(value) === 'anti_client';

/**
 * Legacy `target` class values on stored grievances/news. `ruling_party` was
 * written for posts about the client camp in a ruling-party deployment; BRS is
 * not ruling, so it is read as `our_party`. `opposition` meant the rival camp.
 */
const LEGACY_TARGET_CLASS = {
    ruling_party: 'our_party',
    opposition: 'rival_party',
};
const normalizeTargetClass = (value) => {
    const v = String(value || '').toLowerCase().trim();
    return LEGACY_TARGET_CLASS[v] || v || 'unknown';
};

module.exports = {
    CANONICAL_STANCES,
    LEGACY_STANCE_MAP,
    normalizeStance,
    stanceFromOperator,
    clientStance,
    isProClient,
    isAntiClient,
    LEGACY_TARGET_CLASS,
    normalizeTargetClass,
};
