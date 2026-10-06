/**
 * test_leader_popularity.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure-function tests for leaderPopularityController's entity resolution and
 * alignment flip — no DB connection needed. The failure modes these pin were
 * found by running the aggregation against a live database: one leader's
 * numbers split across two rows over an unindexed alias or a punctuation
 * variant, and placeholder strings ranking as "leaders".
 *
 *   node scripts/test_leader_popularity.js
 */

const {
    resolveEntity,
    alignToPerson,
    rawAliasesForKey,
} = require('../src/controllers/leaderPopularityController');
const { POLITICAL_ENTITIES } = require('../src/config/politicalEntities');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`PASS  ${name}`); }
    else { fail += 1; console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

console.log('\n── THE CRITICAL STEP: align client-relative sentiment to the person ──');
ok('opposition + client-positive → negative for them',
    alignToPerson('positive', 'opposition') === 'negative');
ok('opposition + client-negative → positive for them',
    alignToPerson('negative', 'opposition') === 'positive');
ok('ally + client-positive stays positive',
    alignToPerson('positive', 'ally') === 'positive');
ok('ally + client-negative stays negative',
    alignToPerson('negative', 'ally') === 'negative');
ok('neutral entity is never flipped',
    alignToPerson('positive', 'neutral') === 'positive');
ok('unknown (off-roster) entity is never flipped',
    alignToPerson('negative', 'unknown') === 'negative');
ok('neutral passes through regardless of alignment',
    alignToPerson('neutral', 'opposition') === 'neutral');
ok('empty sentiment passes through unchanged',
    alignToPerson('', 'opposition') === '');

console.log('\n── placeholder / junk guard ──');
for (const v of ['none', 'None', 'N/A', 'n/a', 'unknown', 'null', '', '   ', '123', '---']) {
    ok(`${JSON.stringify(v)} resolves to null`, resolveEntity(v) === null, `got ${JSON.stringify(resolveEntity(v))}`);
}
ok('a Telugu-only name is NOT rejected as "no letters"',
    resolveEntity('కేసీఆర్') !== null, 'Telugu must not trip the digit/symbol-only guard');
ok('the Telugu name resolves to the party president',
    resolveEntity('కేసీఆర్')?.key === 'kcr');
ok('the Telugu name of the working president resolves',
    resolveEntity('కేటీఆర్')?.key === 'ktr');

console.log('\n── legacy roster keys resolve to their current entity ──');
/*
 * ⚠ These legacy keys do NOT point at our own leadership here.
 *
 * 'bsk' is Bandi Sanjay Kumar, the client of an earlier Telangana deployment
 * this codebase descends from. He is in THIS roster too — as a Union Minister
 * and a prominent BRS critic — so the key resolves to the real man, on the
 * opposition side. Pointing it at our own president (as a ruling-party clone
 * did) would silently file his posts as ours.
 *
 * 'bjp_telangana' likewise means BJP Telangana, a rival, not "our machinery".
 */
ok('"bsk" → bandi-sanjay, opposition (he is a rival here)', (() => {
    const r = resolveEntity('bsk');
    return r && r.key === 'bandi-sanjay' && r.alignment === 'opposition';
})());
ok('"bjp_telangana" → bjp, opposition (NOT our party)', (() => {
    const r = resolveEntity('bjp_telangana');
    return r && r.key === 'bjp' && r.alignment === 'opposition';
})());

console.log('\n── alias / punctuation variants merge onto ONE roster key ──');
const sameKey = (a, b) => {
    const ra = resolveEntity(a), rb = resolveEntity(b);
    return ra && rb && ra.key === rb.key;
};
ok('"Dr. Gaddam Prasad Kumar" and "Dr Gaddam Prasad Kumar" are the same leader',
    sameKey('Dr. Gaddam Prasad Kumar', 'Dr Gaddam Prasad Kumar'));
ok('"KCR" and "K Chandrashekar Rao" are the same leader', sameKey('KCR', 'K Chandrashekar Rao'));
ok('"KTR" and "K T Rama Rao" are the same leader', sameKey('KTR', 'K T Rama Rao'));
ok('"Harish Rao" and "Thanneeru Harish Rao" are the same leader',
    sameKey('Harish Rao', 'Thanneeru Harish Rao'));
// ⚠ The Leader of the Opposition is OURS here — KCR holds the post. It is the
// TPCC president who sits on the far side.
ok('our own Leader of the Opposition is ally-aligned', resolveEntity('KCR')?.alignment === 'ally');
ok('the ruling-party state president is opposition-aligned',
    resolveEntity('Mahesh Kumar Goud')?.alignment === 'opposition');
ok('canonical party name resolves to itself', resolveEntity('Indian National Congress')?.key === 'inc');

console.log('\n── off-roster free text is KEPT (shown), never merged into an unrelated entity ──');
const randoA = resolveEntity('Some Local Sarpanch');
const randoB = resolveEntity('A Totally Different Person');
ok('unresolved text still returns a display entry', randoA !== null && randoA.key === null && randoA.alignment === 'unknown');
ok('two different unresolved names do not collide', randoA.name !== randoB.name);
ok('unresolved priority is 0 — can never outrank a recognised leader', randoA.priority === 0);

console.log('\n── rawAliasesForKey drives the drill-down query ──');
const cmAliases = rawAliasesForKey('kcr');
ok('includes the roster key itself', cmAliases.includes('kcr'));
ok('includes the canonical name', cmAliases.includes(POLITICAL_ENTITIES['kcr'].canonical));
ok('includes a free-text alias variant ("KCR")', cmAliases.some((a) => a.toLowerCase() === 'kcr'));
ok('does NOT include "bsk" — that key belongs to a rival now',
    !cmAliases.includes('bsk'));

console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
process.exit(fail ? 1 : 0);
