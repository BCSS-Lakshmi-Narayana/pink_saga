/**
 * Deployment profile — the state-specific facts every LLM prompt and log line
 * needs, in one place. Who is in which camp lives in politicalData.js; this file
 * only phrases it. Re-deploying for another state means editing politicalData.js,
 * the location/data files, and the constants at the top of this file.
 *
 * ⚠ THE CLIENT HERE IS OUT OF POWER. Earlier deployments could say "our party"
 * and "the government" interchangeably. In Telangana those are opposite camps,
 * and a prompt that gets this backwards will ask the model to defend the
 * administration BRS exists to attack. Every phrase below is written to keep
 * the two apart, and `CLIENT_DESCRIPTION` names the adversary explicitly so a
 * model reading it cannot drift into the wrong frame.
 */

const {
    OUR_PARTY, ALLY_PARTIES, OPPOSITION_PARTIES, OUR_FRONTBENCH, PARTY_CHIEF, RULING_MINISTERS,
} = require('./politicalData');

const APP_NAME = 'SANKET';
const STATE_NAME = 'Telangana';
const COUNTRY = 'India';
/** The state's name in Telugu, as local posts write it. */
const STATE_NAME_NATIVE = 'తెలంగాణ';

/**
 * How posts in this state are written — fed to prompts that read raw text.
 *
 * The romanised-Telugu note is load-bearing: a large share of Telugu political
 * social media is transliterated into Latin script or code-mixed with English,
 * so a model told only to expect Telugu script will misread much of the feed as
 * English noise. Urdu matters specifically around AIMIM's Old City base.
 */
const LANGUAGES_DESCRIPTION =
    'Telugu (Telugu script) for most rallies, regional TV and mass social posts; ' +
    'heavily romanised Telugu and Telugu-English code-mixing ("Telgish", e.g. "prajalu", "KCR garu", "hami") ' +
    'which is as common online as Telugu script itself; English, which is over-represented on X because ' +
    'leaders post bilingually for national media (KTR and Revanth Reddy both do this, often the same content twice); ' +
    'Urdu and Dakhni in Hyderabad\'s Old City, especially around AIMIM; and some Hindi from BJP national messaging';

/**
 * The brief's principal. A party president, not a head of government — the
 * distinction matters because advice written for a CM assumes levers (orders,
 * departments, transfers) that an opposition leader does not have.
 */
const CHIEF_MINISTER = RULING_MINISTERS.find((l) => /chief minister/i.test(l.role || '') && !/deputy/i.test(l.role || ''));

const CLIENT_DESCRIPTION =
    `the ${OUR_PARTY.name} (${OUR_PARTY.full_name}) of ${STATE_NAME}` +
    (PARTY_CHIEF ? `, led by party president ${PARTY_CHIEF.name}` : '') +
    `, which is IN OPPOSITION` +
    (CHIEF_MINISTER ? ` to the ${CHIEF_MINISTER.party} government of Chief Minister ${CHIEF_MINISTER.name}` : '');

const partyLabel = (p) => {
    const aka = (p.aliases || []).filter((a) => a !== p.name && a !== p.full_name).slice(0, 2).join('/');
    return `${p.name}${aka ? ` (${aka})` : ''}`;
};

const namedLeaders = (leaders, n) => (leaders || [])
    .filter((l) => !l.derived)
    .map((l) => l.shortName || l.name)
    .slice(0, n);

/** "BRS (Bharat Rashtra Samithi/BRS Party)" plus any allies — our camp in one line. */
const OUR_CAMP_SUMMARY = [
    partyLabel(OUR_PARTY),
    ...ALLY_PARTIES.map(partyLabel),
].join(', ');

/** Leaders of our camp most often named in posts. */
const OUR_CAMP_LEADERS = namedLeaders(OUR_FRONTBENCH, 6);

/** "INC (Congress) — Revanth Reddy, ...; BJP — ..." */
const OPPOSITION_SUMMARY = OPPOSITION_PARTIES
    .map((p) => {
        const leaders = namedLeaders(p.leaders, 3).join(', ');
        return `${partyLabel(p)}${leaders ? ` — ${leaders}` : ''}`;
    })
    .join('; ');

/**
 * The administration we are against, phrased for prompts that need to name it.
 * Kept separate from OPPOSITION_SUMMARY because "the government" and "the rival
 * parties" are not the same set here — BJP and AIMIM oppose us without being
 * the government, and a prompt that lumps them together loses that.
 */
const RULING_GOVERNMENT_DESCRIPTION = CHIEF_MINISTER
    ? `the ${CHIEF_MINISTER.party} government of ${STATE_NAME}, led by Chief Minister ${CHIEF_MINISTER.name} (in office since December 2023)`
    : `the ${STATE_NAME} state government`;

module.exports = {
    APP_NAME,
    STATE_NAME,
    STATE_NAME_NATIVE,
    COUNTRY,
    LANGUAGES_DESCRIPTION,
    /** The rival head of government — NOT one of ours. Named for targeting. */
    CHIEF_MINISTER,
    /** Our principal: the party president the brief is written for. */
    PARTY_CHIEF,
    CLIENT_DESCRIPTION,
    RULING_GOVERNMENT_DESCRIPTION,
    OUR_CAMP_SUMMARY,
    OUR_CAMP_LEADERS,
    OPPOSITION_SUMMARY,
};
