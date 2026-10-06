/**
 * TELANGANA LOCATION DATABASE — geo detection layer.
 *
 * Built from data/state_geo.json (33 districts, each with its Telugu name and
 * common variant spellings; ~150 towns with Telugu names and coordinates) and
 * data/state_mlas.json (the 119 assembly constituencies).
 *
 * Everything state-specific is read from those two files, except the short
 * ANCHORS and AMBIGUOUS_NAMES lists below.
 *
 * NOTE: `state_geo.json.talukas` is intentionally empty — Telangana's 621
 * revenue mandals were not obtainable as an authoritative list, and inventing
 * them would make every invented name a false location match. The tier simply
 * contributes nothing.
 */

const GEO = require('../data/state_geo.json');
const MLAS = require('../data/state_mlas.json');

const STATE_NAME = 'Telangana';

const lower = (s) => String(s || '').toLowerCase().trim();
const stripReserved = (s) => String(s || '').replace(/\s*\((?:sc|st)\)\s*/i, '').trim();

/**
 * Every spelling of every district → its canonical name. Posts and geo-tags
 * use "Warangal Urban" for Hanumakonda, "Palamuru" for Mahabubnagar, "RR
 * District" for Rangareddy, "<name> district", or the Telugu name.
 */
const DISTRICT_VARIANTS = (() => {
    const map = {};
    for (const d of GEO.districts) {
        const names = [d.name, d.telugu, ...(d.aliases || [])].filter(Boolean);
        for (const n of names) {
            map[lower(n)] = d.name;
            if (/[a-z]/i.test(n)) map[`${lower(n)} district`] = d.name;
            // "జిల్లా" is Telugu for district and is written as a separate word.
            else map[`${lower(n)} జిల్లా`] = d.name;
        }
    }
    return map;
})();

const DISTRICTS = Object.keys(DISTRICT_VARIANTS);

/** Normalised key (lower-case alphanumerics, Telugu kept) of a district spelling. */
const districtKey = (v) => String(v || '').toLowerCase().replace(/[\s.\-',/()]/g, '');

/** Variant key → canonical key, e.g. "warangalurban" → "hanumakonda". */
const DISTRICT_KEY_ALIASES = Object.fromEntries(
    Object.entries(DISTRICT_VARIANTS)
        .map(([variant, canonical]) => [districtKey(variant), districtKey(canonical)])
        .filter(([from, to]) => from !== to),
);

/** Canonical key → display name. */
const DISTRICT_DISPLAY = Object.fromEntries(GEO.districts.map((d) => [districtKey(d.name), d.name]));

/** Any district spelling → its canonical display name ('' when unknown). */
const canonicalDistrict = (v) => DISTRICT_VARIANTS[lower(v)] || DISTRICT_DISPLAY[districtKey(v)] || '';

const TALUKAS = GEO.talukas.map((t) => lower(t.name));

const CONSTITUENCIES = MLAS.map((m) => lower(stripReserved(m.constituency)));

const CITIES_AND_VILLAGES = [
    ...GEO.towns.flatMap((t) => [t.name, t.telugu, ...(t.aliases || [])]).filter(Boolean).map(lower),
    ...GEO.villages_and_localities.flatMap((v) => [v.name, ...(v.aliases || [])]).map(lower),
    // State references. Two-letter codes are safe here because this list is
    // matched as a WHOLE string, never as a substring.
    'telangana', 'telengana', 'telangana state', 'state of telangana',
    'govt of telangana', 'government of telangana', 'ts', 'tg',
    'తెలంగాణ', 'తెలంగాణా', 'తెలంగాణ రాష్ట్రం',
];

const ALL_LOCATIONS = new Set();

const addToSet = (arr) => {
    for (const item of arr) {
        const l = lower(item);
        if (l) ALL_LOCATIONS.add(l);
        const clean = l.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        if (clean) ALL_LOCATIONS.add(clean);
    }
};

addToSet(DISTRICTS);
addToSet(TALUKAS);
addToSet(CONSTITUENCIES);
addToSet(CITIES_AND_VILLAGES);

/**
 * Words that identify a Telangana location even inside a longer label.
 * Latin anchors must be whole words. Only names unambiguous across India are
 * anchors — Nizamabad (also in Azamgarh, UP), Khanapur (Maharashtra and
 * Karnataka) and Nirmal (also an ordinary word and a given name) are not.
 *
 * Hyderabad is kept as an anchor despite sharing its name with the city in
 * Sindh: in an Indian political feed it effectively always means this one, and
 * excluding it would lose the single most-named place in the state.
 */
const ANCHORS = ['telangana', 'telengana', 'hyderabad', 'secunderabad', 'warangal', 'hanumakonda',
    'karimnagar', 'khammam', 'nalgonda', 'adilabad', 'siddipet', 'suryapet', 'mancherial',
    'ramagundam', 'mahabubnagar', 'mahbubnagar', 'palamuru', 'sangareddy', 'kothagudem',
    'zaheerabad', 'kamareddy', 'vikarabad', 'nagarkurnool', 'wanaparthy', 'bhuvanagiri',
    'peddapalli', 'jangaon', 'mulugu', 'narayanpet', 'jagtial', 'medchal', 'malkajgiri',
    'rangareddy', 'bhadrachalam', 'miryalaguda', 'gajwel', 'sircilla', 'charminar', 'golconda',
    'తెలంగాణ', 'హైదరాబాద్', 'సికింద్రాబాద్', 'వరంగల్', 'కరీంనగర్', 'ఖమ్మం', 'నల్గొండ',
    'ఆదిలాబాద్', 'సిద్దిపేట', 'మెదక్', 'సూర్యాపేట', 'సంగారెడ్డి'];
const ANCHOR_RX = new RegExp(
    `(?<![a-z])(${ANCHORS.filter((a) => /[a-z]/.test(a)).join('|')})(?![a-z])`,
);
const TELUGU_ANCHORS = ANCHORS.filter((a) => !/[a-z]/.test(a));

/**
 * Telugu anchors that are a prefix of a longer, unrelated word, and so only
 * count when NOT followed by that continuation — the mechanism the Devanagari
 * builds needed for दुर्ग (Durg) inside दुर्गा (the goddess).
 *
 * Empty for now: no Telugu place anchor above has been found to be a prefix of
 * a common unrelated word. Telugu's case suffixes attach directly
 * ("వరంగల్‌లో" = "in Warangal"), but those continuations SHOULD still match,
 * so they are not blockers. The hook is kept because the first genuine
 * collision found will need exactly this.
 */
const TELUGU_BLOCKED = {};

/**
 * Telangana place names shared with other states, with each other, or with
 * common words. They count only when the label also names Telangana.
 *
 * Ghanpur is in here for an in-state reason: there are two — Station Ghanpur
 * (Jangaon) and Ghanpur (Mulugu) — so the bare name cannot resolve a seat.
 */
const AMBIGUOUS_NAMES = new Set(['nirmal', 'nizamabad', 'khanapur', 'ghanpur', 'chandur',
    'kollapur', 'sirpur', 'rampur', 'kothapally', 'medak', 'armoor', 'bhainsa', 'shadnagar',
    'నిర్మల్', 'నిజామాబాద్']);

const hasTeluguAnchor = (l) => TELUGU_ANCHORS.some((a) => {
    const blocked = TELUGU_BLOCKED[a];
    const text = blocked ? l.replace(blocked, ' ') : l;
    return text.includes(a);
});

/**
 * True when a location name belongs to Telangana. Used to keep dashboards
 * and filters to in-state places when geo-tagging also picks up other states.
 */
const isStateLocation = (name) => {
    if (!name || typeof name !== 'string') return false;
    const l = lower(name);
    const clean = l.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!AMBIGUOUS_NAMES.has(clean) && (ALL_LOCATIONS.has(l) || ALL_LOCATIONS.has(clean))) return true;
    return ANCHOR_RX.test(l) || hasTeluguAnchor(l);
};

/**
 * isStateLocation, plus any exact canonical seat or district name. For values
 * the pipeline itself resolved (detected_location.constituency / district):
 * those are in-state by construction, so an ambiguous-but-real name such as
 * NIZAMABAD or MEDAK must still count. Free text (search queries, raw
 * geo-tags) keeps the strict isStateLocation.
 */
const CANONICAL_SEATS = new Set(CONSTITUENCIES);
const isKnownStateLocation = (name) => {
    if (!name || typeof name !== 'string') return false;
    return isStateLocation(name)
        || CANONICAL_SEATS.has(lower(stripReserved(name)))
        || Boolean(DISTRICT_DISPLAY[districtKey(name)]);
};

const STATE_CENTROID = { lat: GEO.centroid.lat, lng: GEO.centroid.lng };
const STATE_BBOX = GEO.bbox;

module.exports = {
    STATE_NAME,
    DISTRICTS,
    DISTRICT_VARIANTS,
    DISTRICT_KEY_ALIASES,
    DISTRICT_DISPLAY,
    districtKey,
    canonicalDistrict,
    TALUKAS,
    CONSTITUENCIES,
    CITIES_AND_VILLAGES,
    ALL_LOCATIONS,
    STATE_CENTROID,
    STATE_BBOX,
    isStateLocation,
    isKnownStateLocation,
};
