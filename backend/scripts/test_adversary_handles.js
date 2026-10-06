#!/usr/bin/env node
/**
 * test_adversary_handles.js
 * ─────────────────────────────────────────────────────────────────────
 * Asserts that the adversary roster actually reaches voice classification,
 * and that the impersonation trap stays shut.
 *
 * The failure this guards against is silent. If an adversary handle is not in
 * the opposition set it does not error — it is classified `organic`, and the
 * rival's coordinated output is reported as spontaneous public opinion. The
 * dashboard looks fine. The number is just wrong, in the direction that most
 * flatters a misreading.
 *
 * No database needed:
 *   node backend/scripts/test_adversary_handles.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { classifyVoice } = require('../src/controllers/cmDashboardController');
const ADV = require('../src/data/state_adversary_handles.json');
const REGISTRY = require('../src/data/state_leader_handles.json');
const { OUR_PARTY } = require('../src/config/politicalData');

let pass = 0; let fail = 0;
const t = (name, actual, expected) => {
    const ok = actual === expected;
    if (ok) { pass += 1; } else {
        fail += 1;
        console.log(`  ✖ ${name}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
};
const ok = (name, cond) => t(name, !!cond, true);

console.log('\n── adversary roster ───────────────────────────────────────');

/* 1. Every listed adversary must reach the opposition column. */
for (const a of ADV.adversaries) {
    t(`@${a.handle} → opposition`, classifyVoice(a.handle, a.name), 'opposition');
}

/* 2. And none of them may be mistaken for our own voice. */
for (const a of ADV.adversaries) {
    ok(`@${a.handle} is not owned`, classifyVoice(a.handle, a.name) !== 'owned');
}

/* 3. The impersonation trap. A handle ending in "BRS" that was used AGAINST
 *    BRS must not read as ours. This is the one that would look right. */
for (const imp of ADV.impersonation || []) {
    const voice = classifyVoice(imp.handle, imp.claimed_identity);
    ok(`@${imp.handle} (fake BRS account) is not owned`, voice !== 'owned');
    ok(`@${imp.handle} is recorded as deleted`, imp.status === 'DELETED');
}
/* The same trap, stated directly, so it survives the roster being edited. */
ok('an invented "...BRS" handle does not read as owned',
    classifyVoice('TotallyRealBRSLeader', 'BRS Spokesperson') !== 'owned');

/* 4. Our own accounts must still be ours — a regression here would be the
 *    mirror-image error, filing our publicity as an attack on ourselves. */
const ourHandles = (REGISTRY.parties || {})[String(OUR_PARTY.id).toLowerCase()] || [];
const liveOurs = ourHandles.filter((h) => h.platform === 'x' && h.status !== 'ARCHIVED');
ok('our party has at least one live X handle', liveOurs.length > 0);
for (const h of liveOurs) {
    t(`@${h.handle} → owned`, classifyVoice(h.handle, OUR_PARTY.name), 'owned');
}

/* 5. No handle may appear on both sides of the roster. */
const advSet = new Set(ADV.adversaries.map((a) => a.handle.toLowerCase()));
for (const h of liveOurs) {
    ok(`@${h.handle} is not also listed as an adversary`, !advSet.has(h.handle.toLowerCase()));
}

/* 6. Data hygiene — a roster with a duplicate or a missing field silently
 *    under-counts, so the shape is asserted rather than assumed. */
const seen = new Set();
for (const a of ADV.adversaries) {
    const k = a.handle.toLowerCase();
    ok(`@${a.handle} appears once`, !seen.has(k));
    seen.add(k);
    ok(`@${a.handle} has evidence`, typeof a.evidence === 'string' && a.evidence.length > 20);
    ok(`@${a.handle} has a verified_on date`, /^\d{4}-\d{2}-\d{2}$/.test(a.verified_on || ''));
    ok(`@${a.handle} has a known hostility value`,
        ['structural', 'reported', 'defector'].includes(a.hostility));
}

/* 7. Kavitha must not be filed as ours. Her bio says "TRS Party", meaning
 *    Telangana Rakshana Sena — not the Telangana Rashtra Samithi that BRS
 *    used to be. An alias rule mapping bare "TRS" to BRS breaks exactly here. */
ok('Kavitha is on the adversary roster', advSet.has('raokavitha'));
t('@RaoKavitha → opposition', classifyVoice('RaoKavitha', 'Kavitha Kalvakuntla'), 'opposition');

/* 8. The dormant list is separate on purpose — it must not leak into the
 *    adversary totals. */
for (const d of ADV.dormant || []) {
    ok(`@${d.handle} is not counted as an active adversary`, !advSet.has(d.handle.toLowerCase()));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
