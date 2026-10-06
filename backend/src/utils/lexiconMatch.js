/**
 * Keyword-lexicon matching shared by the civic-grievance scan
 * (politicalContextService) and the issue classifier (mlaReferenceService).
 *
 * Latin-script tokens must start and end on a word boundary, allowing a plain
 * inflection (s, es, ed, ing), so "road" matches "roads" but not "abroad",
 * "pension" not "suspension", "hospital" not "hospitality". Devanagari tokens
 * stay substring matches, because Telugu case suffixes attach
 * directly to the word (पाण्याची, रस्त्यावर); tokens there must be specific
 * enough on their own.
 */
const cache = new Map();

const latinRegex = (token) => {
    let rx = cache.get(token);
    if (!rx) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        rx = new RegExp(`(?<![a-z0-9])${escaped}(?:s|es|ed|ing)?(?![a-z0-9])`);
        cache.set(token, rx);
    }
    return rx;
};

/** Does `token` occur in `lowerText` (already lower-cased)? */
const tokenOccurs = (lowerText, token) => {
    const t = String(token || '').toLowerCase();
    if (!t) return false;
    if (/[a-z]/.test(t)) return latinRegex(t).test(lowerText);
    return lowerText.includes(t);
};

module.exports = { tokenOccurs };
