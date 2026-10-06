/**
 * stateSignal — is a post about THIS state at all?
 *
 * True when the text names the state, a district / town (districtLocator), an
 * assembly seat, or any in-state roster entity (leader, party, department,
 * institution). National figures alone (Modi, Rahul Gandhi) do not count.
 *
 * Used twice:
 *   • ingestion — a post fetched by a generic grievance keyword ("fertilizer
 *     shortage", "electricity bill") must be about this state to be kept;
 *   • stance — a post with no state context is `unrelated`, never supportive
 *     or opposing (a Ghana or Uttar Pradesh post is not about the client).
 */

const { STATE_NAME, STATE_NAME_NATIVE } = require('../config/deployment');
const { locateDistrict } = require('../services/districtLocator');

// Common spellings / abbreviations of the state name in posts.
const EXTRA_SPELLINGS = {
    Telangana: ['telengana', 'telangan', 'thelangana', 'ts', 'tg'],
}[STATE_NAME] || [];

const STATE_WORD_RX = new RegExp(
    `(^|[^a-z0-9])#?(${[STATE_NAME.toLowerCase(), ...EXTRA_SPELLINGS].join('|')})([^a-z0-9]|$)`,
    'i',
);
// Devanagari spellings vary in the nukta (छत्तीसगढ़ / छत्तीसगढ), so compare without it.
const stripNukta = (s) => String(s || '').normalize('NFD').replace(/़/g, '');
const NATIVE_STEM = stripNukta(STATE_NAME_NATIVE || '');

let _seatLookup = null;
const namesSeat = (text) => {
    // Lazy: locationClassifierService pulls in the constituency master.
    if (!_seatLookup) _seatLookup = require('../services/locationClassifierService').heuristicLookup;
    return !!_seatLookup(text);
};

let _entities = null;
const isInStateEntity = (key) => {
    if (!_entities) _entities = require('../config/politicalEntities').POLITICAL_ENTITIES;
    const e = _entities[key];
    return !!e && e.scope !== 'national';
};

/**
 * @param {string} text        post text (plus anything else worth scanning)
 * @param {Array}  entities    roster entities already found in the text
 *                             ({ key }), e.g. ctx.mentioned_entities
 */
const hasStateSignal = (text, entities = []) => {
    const t = String(text || '');
    if (!t.trim() && !entities.length) return false;
    if ((entities || []).some((e) => e && isInStateEntity(e.key))) return true;
    if (STATE_WORD_RX.test(t)) return true;
    if (NATIVE_STEM && stripNukta(t).includes(NATIVE_STEM)) return true;
    if (locateDistrict(t)) return true;
    return namesSeat(t);
};

module.exports = { hasStateSignal };
