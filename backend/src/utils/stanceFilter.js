/**
 * stanceFilter — the Supportive / Opposing / Neutral filter for Alerts and
 * Mentions.
 *
 * The filter must select exactly what the card's stance badge shows
 * (frontend/src/lib/sentiment.js), so it matches on the FIRST stance field that
 * resolves, in the same order the card reads them — a record whose newer field
 * says "neutral" is never pulled into "Supportive" by a stale legacy field.
 */

const STANCE_GROUPS = {
    supportive: ['pro_target', 'pro_target_indirect', 'pro_bsk', 'pro_bsk_indirect', 'pro_client'],
    opposing: ['anti_target', 'anti_target_indirect', 'anti_bsk', 'anti_bsk_indirect', 'anti_client'],
    neutral: ['neutral', 'unrelated'],
};
const ALL_STANCES = Object.values(STANCE_GROUPS).flat();

/** Mentions: same precedence as getGrievanceStance. */
const GRIEVANCE_STANCE_PATHS = [
    'analysis.political_stance',
    'analysis.stance',
    'analysis.llm_analysis.political_stance',
    'analysis.llm_analysis.stance',
];

/** Alerts: same precedence as getAlertStance (the alert's own analysis). */
const ALERT_STANCE_PATHS = [
    'llm_analysis.political_stance',
    'llm_analysis.stance',
];

const normalizeStanceFilter = (value) => {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'supportive' || v === 'pro' || v === 'pro_client') return 'supportive';
    if (v === 'opposing' || v === 'anti' || v === 'anti_client') return 'opposing';
    if (v === 'neutral') return 'neutral';
    return null;
};

/**
 * A `{ $or: [...] }` clause selecting records whose displayed stance is in the
 * wanted group, or null when the value is not a recognised filter.
 */
const buildStanceClause = (value, paths) => {
    const wanted = normalizeStanceFilter(value);
    if (!wanted) return null;
    const want = STANCE_GROUPS[wanted];
    const unresolved = (path) => ({
        $or: [{ [path]: { $exists: false } }, { [path]: { $nin: ALL_STANCES } }],
    });
    return {
        $or: paths.map((path, i) => (i === 0
            ? { [path]: { $in: want } }
            : { [path]: { $in: want }, $and: paths.slice(0, i).map(unresolved) })),
    };
};

module.exports = {
    STANCE_GROUPS,
    GRIEVANCE_STANCE_PATHS,
    ALERT_STANCE_PATHS,
    normalizeStanceFilter,
    buildStanceClause,
};
