/**
 * locationClassifierService
 * ─────────────────────────────────────────────────────────────────────
 * Telangana location classifier. Given the raw text of a social-media
 * post (plus optional metadata), returns the most relevant assembly
 * constituency / district / Lok-Sabha seat so the post can be auto-routed to
 * the right MLA / MP dashboard via the existing scopeMiddleware
 * (`detected_location.constituency`).
 *
 * Output (or null if the post is not about the state):
 *   {
 *     constituency: '<exact name from state_mlas.json>',
 *     district:     '<district name>',
 *     lok_sabha:    '<ls slug from state_ls_to_ac.json>',
 *     confidence:   0.0..1.0,
 *     reasoning:    'one short sentence',
 *     provider:     'master_index' | 'heuristic'
 *   }
 *
 * Offline only, two tiers: the ConstituencyMaster alias index (villages,
 * localities, aliases), then a whole-word constituency-name match. There is
 * no LLM guess — see the end of classifyLocation for why.
 */

const MLA_ROSTER = require('../data/state_mlas.json');
const LS_TO_AC = require('../data/state_ls_to_ac.json');
const masterService = require('./constituencyMasterService');
const { STATE_NAME } = require('../config/deployment');


/* ─── canonical lists ─────────────────────────────────────────────── */

const normalize = (v) =>
    String(v || '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^a-z0-9]+/g, '')
        .trim();

const CONSTITUENCIES = [...new Set(
    MLA_ROSTER.map((m) => String(m.constituency || '').trim()).filter(Boolean)
)];

// Build AC → LS reverse map so we can derive lok_sabha + district from the
// constituency once the classifier picks one.
const AC_TO_LS = (() => {
    const map = {};
    for (const [ls, acs] of Object.entries(LS_TO_AC)) {
        for (const ac of acs) {
            map[normalize(ac)] = ls;
        }
    }
    return map;
})();

const CONSTITUENCY_BY_NORM = (() => {
    const map = {};
    for (const c of CONSTITUENCIES) map[normalize(c)] = c;
    return map;
})();

// District map — derived from the MLA dataset where present, else from a
// hand-maintained fallback list. Most production data files only carry
// constituency; district is best-effort.
const DISTRICT_BY_AC = (() => {
    const map = {};
    for (const m of MLA_ROSTER) {
        if (m.constituency && m.district) {
            map[normalize(m.constituency)] = m.district;
        }
    }
    return map;
})();

/* ─── heuristic short-circuit ─────────────────────────────────────── */

// Punctuation-insensitive word form: "VASCO-DA-GAMA" / "Vasco da Gama" →
// "vasco da gama", "ST. CRUZ" / "St Cruz" → "st cruz".
const toWords = (s) => ` ${String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

// Whole-word needles: every AC name plus the shared alias spellings
// (Warangal Urban → HANUMAKONDA, ఖమ్మం → KHAMMAM …), longest first so
// a compound name is tried before shorter ones that could overlap it.
const HEURISTIC_NEEDLES = (() => {
    const byKey = {};
    for (const c of CONSTITUENCIES) byKey[normalize(c)] = c;
    const needles = CONSTITUENCIES.map((c) => ({ words: toWords(c), ac: c }));
    for (const [alias, key] of Object.entries(require('../data/state_constituency_aliases.json').aliases)) {
        if (byKey[key]) needles.push({ words: ` ${alias} `, ac: byKey[key] });
    }
    return needles
        .filter((n) => n.words.trim().length >= 4) // skip 3-letter noise
        .sort((a, b) => b.words.length - a.words.length);
})();

const heuristicLookup = (text) => {
    if (!text) return null;
    const hay = toWords(text);
    for (const n of HEURISTIC_NEEDLES) {
        if (hay.includes(n.words)) return n.ac;
    }
    return null;
};

/* ─── result enrichment ───────────────────────────────────────────── */

const enrichWithDistrictAndLs = (constituency) => {
    const key = normalize(constituency);
    return {
        district:  DISTRICT_BY_AC[key] || null,
        lok_sabha: AC_TO_LS[key]       || null,
    };
};

/* ─── public API ──────────────────────────────────────────────────── */

/**
 * Classify a post to its assembly constituency. Returns null if the post is
 * not confidently about any seat in the state.
 */
const classifyLocation = async (text, ctxOpts = {}) => {
    const ctx = {
        userLocation:  ctxOpts.userLocation  || '',
        userBio:       ctxOpts.userBio       || '',
        hashtags:      ctxOpts.hashtags      || '',
        taggedAccount: ctxOpts.taggedAccount || '',
    };

    // 1. Heuristic short-circuit — try the rich ConstituencyMaster alias
    //    index FIRST (mandals / villages / keywords / aliases), then fall
    //    back to the static AC-name list for environments where the master
    //    DB hasn't been seeded yet.
    const haystack = `${text} ${ctx.userLocation} ${ctx.userBio} ${ctx.hashtags} ${ctx.taggedAccount}`;
    try {
        const masterHit = await masterService.matchAlias(haystack);
        if (masterHit) {
            const enr = enrichWithDistrictAndLs(masterHit.ac_name);
            return {
                constituency: masterHit.ac_name,
                district:     enr.district,
                lok_sabha:    enr.lok_sabha,
                confidence:   0.95,
                reasoning:    `Master DB matched "${masterHit.matched_token}" (${masterHit.match_source}) → ${masterHit.ac_name}.`,
                matched_token: masterHit.matched_token,
                match_source:  masterHit.match_source,
                provider:     'master_index',
            };
        }
    } catch (err) {
        console.warn(`[LocationClassifier] Master index lookup failed: ${err.message}`);
    }

    const heuristic = heuristicLookup(haystack);
    if (heuristic) {
        const enr = enrichWithDistrictAndLs(heuristic);
        return {
            constituency: heuristic,
            district:     enr.district,
            lok_sabha:    enr.lok_sabha,
            confidence:   0.92,
            reasoning:    `Exact constituency name "${heuristic}" found in post or author metadata.`,
            provider:     'heuristic',
        };
    }

    // No LLM guess. The classifier used to fall back to an LLM here, and
    // measured on live data it was wrong more often than right: it mapped
    // out-of-state places to sound-alike seats (Chandigarh → Chandrapur,
    // Patna → Pamgarh, Karnataka's Kalasa river → a Goa seat) and picked a
    // seat for posts that name no place at all. A wrong seat puts a post on
    // the wrong MLA's dashboard; no seat leaves it statewide. So a post is
    // placed only from a place it actually names (the tiers above).
    return null;
};

module.exports = {
    classifyLocation,
    // exported for tests / admin tooling
    CONSTITUENCIES,
    AC_TO_LS,
    DISTRICT_BY_AC,
    heuristicLookup,
};
