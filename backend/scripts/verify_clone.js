#!/usr/bin/env node
/**
 * verify_clone.js — static consistency checks for the Telangana / BRS build.
 *
 *   node backend/scripts/verify_clone.js
 *
 * Needs no database. It checks the things a clone gets wrong silently: the
 * roster and the data files disagreeing, alias targets pointing at entities
 * that do not exist, the opposition inversion being half-applied, and the
 * previous deployment's identity surviving in a live code path.
 *
 * Re-run after any change to config/ or data/. It is deliberately noisy about
 * WHY each check exists, because every one of them corresponds to a mistake
 * that was actually made while building this.
 */
const path = require('path');

const DATA = path.join(__dirname, '..', 'src', 'data');
const CONFIG = path.join(__dirname, '..', 'src', 'config');

let pass = 0;
let fail = 0;
const failures = [];

const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log(`  ok    ${label}`); }
  else { fail += 1; failures.push(`${label}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
};

const section = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

/* ── load ── */
const pd = require(path.join(CONFIG, 'politicalData'));
const pe = require(path.join(CONFIG, 'politicalEntities'));
const dep = require(path.join(CONFIG, 'deployment'));
const loc = require(path.join(CONFIG, 'stateLocations'));
const { STANCE_HASHTAGS } = require(path.join(CONFIG, 'hashtagSignals'));
const profiles = require(path.join(DATA, 'state_voter_profiles.json'));
const mlas = require(path.join(DATA, 'state_mlas.json'));
const electors = require(path.join(DATA, 'state_ac_electors.json'));
const geo = require(path.join(DATA, 'state_geo.json'));
const handles = require(path.join(DATA, 'state_leader_handles.json'));

/* ── 1. identity ── */
section('1. Deployment identity');
check('OUR_PARTY is BRS', pd.OUR_PARTY.id === 'brs', pd.OUR_PARTY.id);
check("OUR_PARTY.role is 'opposition'", pd.OUR_PARTY.role === 'opposition', pd.OUR_PARTY.role);
check('STATE_NAME is Telangana', dep.STATE_NAME === 'Telangana', dep.STATE_NAME);
check('PARTY_CHIEF resolves (the brief has a principal)', !!pd.PARTY_CHIEF, String(pd.PARTY_CHIEF && pd.PARTY_CHIEF.name));
check('CHIEF_MINISTER is a RIVAL, not ours',
  !!dep.CHIEF_MINISTER && dep.CHIEF_MINISTER.side === 'opposition',
  dep.CHIEF_MINISTER ? `${dep.CHIEF_MINISTER.name} / ${dep.CHIEF_MINISTER.side}` : 'undefined');
check('CLIENT_DESCRIPTION states we are in opposition',
  /in opposition/i.test(dep.CLIENT_DESCRIPTION), dep.CLIENT_DESCRIPTION.slice(0, 60));

/* ── 2. the inversion ── */
section('2. Opposition inversion (the trap this clone had to avoid)');
const E = pe.POLITICAL_ENTITIES;
check("state_government is 'opposition', not 'ally'",
  E.state_government && E.state_government.alignment === 'opposition',
  E.state_government && E.state_government.alignment);
check('the Speaker sits with the opposition',
  pd.PRESIDING_OFFICERS.every((l) => l.side === 'opposition'));
check('every ruling minister is on the opposition side',
  pd.RULING_MINISTERS.length > 0 && pd.RULING_MINISTERS.every((l) => l.side === 'opposition'));
check('Kavitha is NOT counted as ours (she left BRS in 2025)',
  E.kavitha && E.kavitha.alignment === 'opposition', E.kavitha && E.kavitha.alignment);
check('Kaleshwaram scores against US (we built it)',
  E['scheme-kaleshwaram'] && E['scheme-kaleshwaram'].alignment === 'ally');
check('Rythu Bharosa scores against THEM (they built it)',
  E['scheme-rythu-bharosa'] && E['scheme-rythu-bharosa'].alignment === 'opposition');
check('our principal outranks the Chief Minister',
  E.kcr && E['revanth-reddy'] && E.kcr.priority > E['revanth-reddy'].priority,
  `${E.kcr && E.kcr.priority} vs ${E['revanth-reddy'] && E['revanth-reddy'].priority}`);

/* ── 3. "TRS" disambiguation ── */
section('3. The three-way "TRS" collision');
const allAliases = Object.values(E).flatMap((e) => e.aliases || []);
check('bare "trs" is an alias of NOTHING',
  !allAliases.includes('trs'),
  allAliases.includes('trs') ? 'some entity claims it' : '');
check('Kavitha\'s party exists as its own entity', !!E['trs-k']);
check('BRS keeps its unambiguous former name',
  (E.brs.aliases || []).some((a) => /telangana rashtra samithi/i.test(a)));

/* ── 4. roster vs data ── */
section('4. Roster and data files agree');
check('119 voter profiles', profiles.length === 119, String(profiles.length));
check('119 MLA rows', mlas.length === 119, String(mlas.length));
check('119 AC elector rows', Object.keys(electors).length === 119, String(Object.keys(electors).length));
check('33 districts in geo', geo.districts.length === 33, String(geo.districts.length));
check('every district has a Telugu name',
  geo.districts.every((d) => d.telugu), `${geo.districts.filter((d) => !d.telugu).length} missing`);
/**
 * District names must match EXACTLY between the roster and the geography file.
 * The map dissolves districts using the roster's string while the rest of the
 * UI labels them from the geo file, so a difference means the same district
 * reads two ways on two screens — and on two of them ("Hanamkonda" vs
 * "Hanumakonda", "Komaram" vs "Kumuram") it did.
 */
const geoDistrictNames = new Set(geo.districts.map((d) => d.name));
const rosterDistricts = [...new Set(profiles.map((p) => p.district))];
const driftedDistricts = rosterDistricts.filter((d) => !geoDistrictNames.has(d));
check('roster and geo agree on every district name (exact string)',
  driftedDistricts.length === 0, driftedDistricts.join(', '));

check('elector arithmetic holds on every AC',
  Object.values(electors).every((r) => r.electors_male + r.electors_female + r.electors_other === r.electors_total));

const deJure = profiles.filter((p) => p.mla && p.mla.party === 'BRS').length;
const defectors = profiles.filter((p) => p.mla && p.mla.defected_to).length;
check('BRS de jure 36 = de facto 27 + 9 defectors',
  deJure === 36 && defectors === 9 && deJure - defectors === 27,
  `de jure ${deJure}, defectors ${defectors}`);
check('defectors are NOT counted in our camp',
  pd.ALLY_MLAS.every((m) => !m.defection_unresolved));
/**
 * Seat coverage. This caught a real bug: twelve Telangana Lok Sabha seats share
 * a name with an assembly seat, and a curated MP's seat name was suppressing
 * the identically-named assembly seat from the derived roster — deleting twelve
 * MLAs, four of them ours, with no error anywhere. Our own strength read 24
 * instead of 27.
 */
const seatHolders = [
  ...pd.ALLY_MLAS, ...pd.OPPOSITION_MLAS,
  ...pd.OUR_FRONTBENCH, ...pd.RULING_MINISTERS, ...pd.PRESIDING_OFFICERS,
  ...pd.AIMIM_LEADERS, ...pd.CPI_LEADERS, ...pd.CPM_LEADERS, ...pd.IND_LEADERS,
].filter((l) => l.constituency && l.house !== 'parliament');
const claimed = seatHolders.map((l) => pd.acKey(l.constituency));
const rosterSeats = new Set(profiles.filter((p) => p.mla).map((p) => pd.acKey(p.constituency)));
const dupes = [...new Set(claimed.filter((s, i) => claimed.indexOf(s) !== i))];
const uncovered = [...rosterSeats].filter((k) => !new Set(claimed).has(k));
const phantom = [...new Set(claimed)].filter((k) => !rosterSeats.has(k));

check('every filled assembly seat maps to exactly one entity',
  uncovered.length === 0 && dupes.length === 0,
  `uncovered: ${uncovered.join(', ') || 'none'}; duplicated: ${dupes.join(', ') || 'none'}`);
check('no entity sits on a seat that is not in the roster',
  phantom.length === 0, phantom.join(', '));
check('our de facto strength is 27',
  pd.ALLY_MLAS.length + pd.OUR_FRONTBENCH.filter((l) => l.constituency).length === 27,
  String(pd.ALLY_MLAS.length + pd.OUR_FRONTBENCH.filter((l) => l.constituency).length));

check('every Lok Sabha seat has an MP (the frontend generator requires it)',
  new Set(profiles.map((p) => p.lok_sabha)).size === 17
  && [...new Set(profiles.map((p) => p.lok_sabha))].every((ls) =>
    pd.ALL_LEADERS.some((l) => /^MP,/.test(l.role || '') && l.constituency === ls)),
  `${new Set(profiles.map((p) => p.lok_sabha)).size} seats`);

/* ── 5. references resolve ── */
section('5. Every reference resolves to a real entity');
const badHashtags = Object.entries(STANCE_HASHTAGS).filter(([, v]) => !E[v.target]);
check('all stance-hashtag targets exist', badHashtags.length === 0,
  badHashtags.map(([k]) => k).join(', '));
check('PRIMARY/SECONDARY targets exist',
  !!E[pe.PRIMARY_TARGET_KEY] && !!E[pe.SECONDARY_TARGET_KEY]);
const regKeys = Object.keys(handles.people || {});
const unknownHandleKeys = regKeys.filter((k) => !k.startsWith('ac:') && !pd.ALL_LEADERS.some((l) => l.id === k));
check('every handle-registry person maps to a roster leader',
  unknownHandleKeys.length === 0, unknownHandleKeys.join(', '));
check('handle-registry party keys all exist in the roster',
  Object.keys(handles.parties || {}).every((k) =>
    k === pd.OUR_PARTY.id || pd.OPPOSITION_PARTIES.some((p) => p.id === k)),
  Object.keys(handles.parties || {}).filter((k) =>
    k !== pd.OUR_PARTY.id && !pd.OPPOSITION_PARTIES.some((p) => p.id === k)).join(', '));

/* ── 6. geography ── */
section('6. Geography resolves');
const geoTests = [['Hyderabad', true], ['Warangal', true], ['Gajwel', true],
  ['హైదరాబాద్', true], ['Mumbai', false], ['Raipur', false]];
for (const [name, want] of geoTests) {
  check(`isStateLocation(${name}) === ${want}`, loc.isStateLocation(name) === want);
}
check('Warangal Urban resolves to Hanumakonda',
  loc.canonicalDistrict('Warangal Urban') === 'Hanumakonda', loc.canonicalDistrict('Warangal Urban'));

/* ── 7. no previous deployment left in a live path ── */
section('7. No Chhattisgarh identity in loaded config');
const blob = JSON.stringify({
  party: pd.OUR_PARTY, leaders: pd.ALL_LEADERS.map((l) => [l.name, l.role, l.constituency]),
  entities: Object.values(E).map((e) => [e.canonical, e.aliases]),
});
for (const term of ['Chhattisgarh', 'Vishnu Deo', 'Kiran Singh Deo', 'Bhupesh', 'Raipur', 'Mahtari']) {
  check(`no "${term}" in the loaded roster or entity graph`, !blob.includes(term));
}

/* ── summary ── */
console.log(`\n${'═'.repeat(58)}`);
console.log(`  ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\n  Failures:');
  for (const f of failures) console.log('   -', f);
}
console.log('═'.repeat(58));
process.exit(fail ? 1 : 0);
