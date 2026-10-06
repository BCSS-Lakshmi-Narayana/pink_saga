/**
 * districtLocator
 * ─────────────────────────────────────────────────────────────────────
 * Last, coarsest placement tier: a post that names no assembly seat but does
 * name an in-state district or town ("Hyderabad", "ఖమ్మం జిల్లా", "Warangal") is
 * placed at DISTRICT level — `district` + `city` set, `constituency` left
 * empty. Guessing a seat for it would put the post on one MLA's dashboard at
 * random (a capital-city post on one of its four seats); leaving it unplaced
 * would drop it off the district map entirely.
 *
 * Built from the state geo file (districts with Hindi names and aliases,
 * towns with aliases). Pure and offline.
 */

const fs = require('fs');
const path = require('path');
const { STATE_NAME, STATE_NAME_NATIVE } = require('../config/deployment');

const GEO = (() => {
    for (const f of ['state_geo.json', 'goa_geo.json']) {
        const p = path.join(__dirname, '../data', f);
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    return { districts: [], towns: [] };
})();

// Town names that are also common places in other states. They only count
// when the post also names the state itself.
// Every spelling of such a place (its Hindi name included) is ambiguous.
const AMBIGUOUS = new Set(['bilaspur', 'bijapur', 'balrampur', 'chandrapur', 'rampur', 'korea', 'koriya',
    'pratappur', 'sitapur', 'lakhanpur', 'udaipur', 'kota', 'mandi', 'patna', 'aurangabad', 'raghunathpur']);

const lc = (s) => String(s || '').toLowerCase().normalize('NFC');

const NEEDLES = (() => {
    const out = [];
    const add = (token, district, city, ambiguous, town = false) => {
        const t = lc(token).trim();
        if (!t || (/^[a-z .'-]+$/.test(t) && t.replace(/[^a-z]/g, '').length < 4)) return;
        out.push({ token: t, district, city, ambiguous: ambiguous || AMBIGUOUS.has(t), town });
    };
    for (const d of GEO.districts || []) {
        const amb = AMBIGUOUS.has(lc(d.name));
        for (const n of [d.name, d.telugu, ...(d.aliases || [])]) add(n, d.name, d.hq || d.name, amb);
    }
    for (const t of GEO.towns || []) {
        if (!t.district) continue;
        const amb = AMBIGUOUS.has(lc(t.name));
        for (const n of [t.name, ...(t.aliases || [])]) add(n, t.district, t.name, amb, true);
    }
    // Named localities (Tatibandh, Gudhiyari …) place a post in their district too.
    for (const v of GEO.villages_and_localities || []) {
        if (!v.district) continue;
        const amb = AMBIGUOUS.has(lc(v.name));
        for (const n of [v.name, ...(v.aliases || [])]) add(n, v.district, v.name, amb, true);
    }
    return out.sort((a, b) => b.token.length - a.token.length);
})();

// A letter or combining mark (Telugu vowel signs included) continues a word,
// so a district name must not match inside a longer word: 'Medak' must not
// match inside 'Medakalpatnam', nor 'Nirmal' inside 'Nirmala'.
const WORD_CH = /[\p{L}\p{M}\p{N}]/u;
const VILLAGE_PREFIX_RX = /(ग्राम|गांव|गाँव|village|gram)\s*$/i;
const STATE_RX = new RegExp([STATE_NAME, STATE_NAME_NATIVE].filter(Boolean).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');

/**
 * → { district, city, matched_token } or null.
 */
const locateDistrict = (text) => {
    const hay = lc(text);
    if (!hay.trim()) return null;
    const namesState = STATE_RX.test(String(text));
    for (const n of NEEDLES) {
        if (n.ambiguous && !namesState) continue;
        let i = hay.indexOf(n.token);
        while (i >= 0) {
            const before = hay[i - 1];
            const after = hay[i + n.token.length];
            // "ग्राम कुम्हारी" is a village that shares a town's name, not the town.
            const village = n.town && VILLAGE_PREFIX_RX.test(hay.slice(Math.max(0, i - 12), i));
            if (!village && (before === undefined || !WORD_CH.test(before)) && (after === undefined || !WORD_CH.test(after))) {
                return { district: n.district, city: n.city, matched_token: n.token };
            }
            i = hay.indexOf(n.token, i + 1);
        }
    }
    return null;
};

module.exports = { locateDistrict };
