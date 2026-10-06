#!/usr/bin/env node
/**
 * Deterministic regression suite for the Stage 4 stance engine.
 *
 * No LLM, no DB, no network — runs in milliseconds and exits non-zero on any
 * failure, so "did I break the cases that already worked?" is a one-second
 * question instead of a judgement call.
 *
 *   node scripts/test_stance_engine.js
 *
 * RUN THIS after ANY change to:
 *   src/services/stanceEngine.js
 *   src/services/entityResolver.js
 *   src/config/politicalData.js
 *   src/config/politicalEntities.js
 *
 * Sections:
 *   A — regression: single-side actor logic (pins pre-existing behaviour)
 *   B — attack_target field shape (incl. the praise-of-ally asymmetry)
 *   C — multi-entity posts resolved via sentiment_target
 *   D — author-is-target correction, with safety cases
 *   E — cross-camp prior, with safety cases
 *   F — Telangana roster wiring: alignment inferred from the roster, not passed in
 */

const { compute } = require('../src/services/stanceEngine');
const { POLITICAL_ENTITIES, PRIMARY_TARGET_KEY } = require('../src/config/politicalEntities');

/* ─── helpers ───────────────────────────────────────────────────────── */

const ally = (n = 'K Chandrashekar Rao') => ({ text: n, canonical: n, affiliation: 'ally', confidence: 0.9 });
const opp = (n = 'Dr. Mahesh Kumar Goud') => ({ text: n, canonical: n, affiliation: 'opposition', confidence: 0.9 });
const neut = (n = 'Telangana Police') => ({ text: n, canonical: n, affiliation: 'neutral', confidence: 0.9 });

const E = (canonical, alignment) => ({ canonical, alignment });
const ctxWith = (ents = [], mode = 'about_target') => ({ mode, mentioned_entities: ents });
const ctxAuthor = (align, ents = [], mode = 'about_target') => ({
    mode,
    mentioned_entities: ents,
    author_alignment: align,
});

let pass = 0;
let fail = 0;

const t = (name, got, expStance, expBen) => {
    const ok = got.stance === expStance && got.beneficiary === expBen;
    if (ok) pass += 1; else fail += 1;
    console.log(`${ok ? 'PASS' : '*** FAIL'}  ${name}`);
    if (!ok) {
        console.log(`        got ${got.stance}/${got.beneficiary}  exp ${expStance}/${expBen}  [${got.rationale}]`);
    }
};

const tField = (name, actual, expected) => {
    const ok = actual === expected;
    if (ok) pass += 1; else fail += 1;
    console.log(`${ok ? 'PASS' : '*** FAIL'}  ${name}${ok ? '' : `  (got "${actual}", exp "${expected}")`}`);
};

/* ═══ A. REGRESSION — actor-only logic, no sentiment_target ═══════════ */
console.log('\n=== A. REGRESSION: no sentiment_target → actor-only truth table ===');

t('ally attacked → anti_target',
    compute({ resolvedActors: [ally()], generic_sentiment: 'negative', ctx: ctxWith() }),
    'anti_target', 'opposition');

t('ally praised → pro_target',
    compute({ resolvedActors: [ally()], generic_sentiment: 'positive', ctx: ctxWith() }),
    'pro_target', 'ours');

t('ally, neutral tone → neutral',
    compute({ resolvedActors: [ally()], generic_sentiment: 'neutral', ctx: ctxWith() }),
    'neutral', 'none');

t('opposition attacked → pro_target_indirect',
    compute({ resolvedActors: [opp()], generic_sentiment: 'negative', ctx: ctxWith() }),
    'pro_target_indirect', 'ours');

t('opposition praised → anti_target_indirect',
    compute({ resolvedActors: [opp()], generic_sentiment: 'positive', ctx: ctxWith() }),
    'anti_target_indirect', 'opposition');

t('opposition, neutral tone → neutral',
    compute({ resolvedActors: [opp()], generic_sentiment: 'neutral', ctx: ctxWith() }),
    'neutral', 'none');

t('actor order honoured when no target (ally first)',
    compute({ resolvedActors: [ally(), opp()], generic_sentiment: 'negative', ctx: ctxWith() }),
    'anti_target', 'opposition');

t('ctx fallback: neutral actors, ally in mentioned_entities',
    compute({
        resolvedActors: [neut()],
        generic_sentiment: 'negative',
        ctx: ctxWith([E('K Chandrashekar Rao', 'ally')]),
    }),
    'anti_target', 'opposition');

t('ctx fallback: neutral actors, opposition in mentioned_entities',
    compute({
        resolvedActors: [neut()],
        generic_sentiment: 'negative',
        ctx: ctxWith([E('Dr. Mahesh Kumar Goud', 'opposition')]),
    }),
    'pro_target_indirect', 'ours');

// ⚠ Blame for a service failure lands on whoever GOVERNS. We do not, so an
// unattributed complaint is mildly favourable to us — the reverse of a
// ruling-party deployment, where this same case was anti_target.
t('civic grievance, nobody named, negative → implicates the rival government',
    compute({ resolvedActors: [], candidateSubjects: [{ text: 'farmers' }], generic_sentiment: 'negative', ctx: ctxWith([], 'civic_grievance') }),
    'pro_target_indirect', 'ours');

// And credit for a service working lands there too — which is bad for us.
t('civic improvement, nobody named, positive → credits the rival government',
    compute({ resolvedActors: [], candidateSubjects: [{ text: 'farmers' }], generic_sentiment: 'positive', ctx: ctxWith([], 'civic_grievance') }),
    'anti_target_indirect', 'opposition');

t('NO TONE MIRRORING: general_politics, nothing resolvable, negative → neutral',
    compute({ resolvedActors: [neut()], generic_sentiment: 'negative', ctx: ctxWith([], 'general_politics') }),
    'neutral', 'none');

t('NO TONE MIRRORING: general_politics, nothing resolvable, positive → neutral',
    compute({ resolvedActors: [neut()], generic_sentiment: 'positive', ctx: ctxWith([], 'general_politics') }),
    'neutral', 'none');

t('mode=irrelevant, nothing resolves to a side → unrelated',
    compute({ resolvedActors: [neut()], generic_sentiment: 'negative', ctx: ctxWith([], 'irrelevant') }),
    'unrelated', 'none');

// Stage 2 had no alias for the name (e.g. a Devanagari spelling), but the
// resolver matched it on the translation: the resolved side wins.
t('mode=irrelevant but resolver found an ally → scored, not discarded',
    compute({ resolvedActors: [ally()], generic_sentiment: 'negative', ctx: ctxWith([], 'irrelevant') }),
    'anti_target', 'opposition');

// Raw-sentiment fallback: the model gave no clear tone toward the target.
t('ally named, target tone neutral, raw positive → pro_target',
    compute({ resolvedActors: [ally()], generic_sentiment: 'neutral', raw_sentiment: 'positive', ctx: ctxWith() }),
    'pro_target', 'ours');

t('civic grievance, target tone neutral, raw negative → implicates the government',
    compute({ resolvedActors: [], candidateSubjects: ['residents'], generic_sentiment: 'neutral', raw_sentiment: 'negative', ctx: ctxWith([], 'civic_grievance') }),
    'pro_target_indirect', 'ours');

// A clear target tone always wins over the raw mood (mixed posts).
t('explicit negative target tone beats positive raw mood',
    compute({ resolvedActors: [ally()], generic_sentiment: 'negative', raw_sentiment: 'positive', ctx: ctxWith() }),
    'anti_target', 'opposition');

t('civic grievance naming nobody, negative → implicates the government',
    compute({ resolvedActors: [], candidateSubjects: [], generic_sentiment: 'negative', ctx: ctxWith([], 'civic_grievance') }),
    'pro_target_indirect', 'ours');

t('completely empty input → unrelated',
    compute({ resolvedActors: [], candidateSubjects: [], generic_sentiment: 'negative', ctx: ctxWith() }),
    'unrelated', 'none');

/* ═══ B. attack_target field shape ═══════════════════════════════════ */
console.log('\n=== B. attack_target field preserved exactly ===');

tField('praise-of-ally leaves attack_target EMPTY (deliberate asymmetry)',
    compute({ resolvedActors: [ally()], generic_sentiment: 'positive', ctx: ctxWith() }).attack_target,
    '');

tField('attack-on-ally names the ally',
    compute({ resolvedActors: [ally()], generic_sentiment: 'negative', ctx: ctxWith() }).attack_target,
    'K Chandrashekar Rao');

tField('attack-on-opposition names the opposition',
    compute({ resolvedActors: [opp()], generic_sentiment: 'negative', ctx: ctxWith() }).attack_target,
    'Dr. Mahesh Kumar Goud');

tField('praise-of-opposition leaves attack_target EMPTY (praise is not an attack)',
    compute({ resolvedActors: [opp()], generic_sentiment: 'positive', ctx: ctxWith() }).attack_target,
    '');

/* ═══ C. multi-entity posts — sentiment_target breaks the tie ════════ */
console.log('\n=== C. NEW: multi-entity posts resolved via sentiment_target ===');

t('THE FAILING SHAPE: opposition speaker, our government is the target, negative → anti_target',
    compute({
        resolvedActors: [opp('INC'), ally('K Chandrashekar Rao'), neut()],
        resolvedTarget: ally('K Chandrashekar Rao'),
        generic_sentiment: 'negative',
        ctx: ctxWith([E('INC', 'opposition'), E('K Chandrashekar Rao', 'ally')]),
    }),
    'anti_target', 'opposition');

t('opposition figure praising our CM (both named) → pro_target',
    compute({
        resolvedActors: [opp(), ally()],
        resolvedTarget: ally(),
        generic_sentiment: 'positive',
        ctx: ctxWith([E('Dr. Mahesh Kumar Goud', 'opposition'), E('K Chandrashekar Rao', 'ally')]),
    }),
    'pro_target', 'ours');

t('MUST NOT REGRESS: attack on opposition with a passing ally mention → pro_target_indirect',
    compute({
        resolvedActors: [ally(), opp()],
        resolvedTarget: opp(),
        generic_sentiment: 'negative',
        ctx: ctxWith([E('K Chandrashekar Rao', 'ally'), E('Dr. Mahesh Kumar Goud', 'opposition')]),
    }),
    'pro_target_indirect', 'ours');

t('neutral-aligned target falls back to actor logic',
    compute({
        resolvedActors: [opp()],
        resolvedTarget: neut(),
        generic_sentiment: 'negative',
        ctx: ctxWith(),
    }),
    'pro_target_indirect', 'ours');

t('unresolvable target (affiliation null) falls back to actor logic',
    compute({
        resolvedActors: [ally()],
        resolvedTarget: { text: 'farmers', canonical: null, affiliation: null },
        generic_sentiment: 'negative',
        ctx: ctxWith(),
    }),
    'anti_target', 'opposition');

t('target resolves with NO actors at all → still scored',
    compute({
        resolvedActors: [],
        resolvedTarget: ally(),
        generic_sentiment: 'negative',
        ctx: ctxWith(),
    }),
    'anti_target', 'opposition');

t('target=opposition, neutral tone → neutral',
    compute({
        resolvedActors: [ally(), opp()],
        resolvedTarget: opp(),
        generic_sentiment: 'neutral',
        ctx: ctxWith(),
    }),
    'neutral', 'none');

/* ═══ D. author-is-target correction ═════════════════════════════════ */
console.log('\n=== D. author-is-target correction (speaker mistaken for target) ===');

t('opposition author, target mis-extracted as itself, ally present → re-pointed to anti_target',
    compute({
        resolvedActors: [opp()],
        resolvedTarget: opp(),
        generic_sentiment: 'negative',
        ctx: ctxAuthor('opposition', [E('Dr. Mahesh Kumar Goud', 'opposition'), E('K Chandrashekar Rao', 'ally')]),
    }),
    'anti_target', 'opposition');

t('ally author, target mis-extracted as itself, opposition present → re-pointed to pro_target_indirect',
    compute({
        resolvedActors: [ally()],
        resolvedTarget: ally(),
        generic_sentiment: 'negative',
        ctx: ctxAuthor('ally', [E('K Chandrashekar Rao', 'ally'), E('Dr. Mahesh Kumar Goud', 'opposition')]),
    }),
    'pro_target_indirect', 'ours');

t('SAFETY: opposition author attacking another opposition party, NO ally present → untouched',
    compute({
        resolvedActors: [opp()],
        resolvedTarget: opp(),
        generic_sentiment: 'negative',
        ctx: ctxAuthor('opposition', [E('Dr. Mahesh Kumar Goud', 'opposition')]),
    }),
    'pro_target_indirect', 'ours');

t('own party as target, negative, no other camp named → neutral (speaker attacks an unplaced party, e.g. the EC)',
    compute({
        resolvedActors: [{ text: 'Congress', key: 'inc', canonical: 'Indian National Congress', affiliation: 'opposition', confidence: 0.9 }],
        resolvedTarget: { text: 'Congress', key: 'inc', canonical: 'Indian National Congress', affiliation: 'opposition', confidence: 0.9 },
        generic_sentiment: 'negative',
        ctx: { ...ctxAuthor('opposition', [E('Indian National Congress', 'opposition')]), author_party: 'inc' },
    }),
    'neutral', 'none');

t('own party as the only actor (target unplaced), negative → neutral',
    compute({
        resolvedActors: [{ text: 'Congress', key: 'inc', canonical: 'Indian National Congress', affiliation: 'opposition', confidence: 0.9 }],
        resolvedTarget: { text: 'Chief Election Commissioner', key: null, canonical: null, affiliation: null, confidence: 0.25 },
        generic_sentiment: 'negative',
        ctx: { ...ctxAuthor('opposition', [E('Indian National Congress', 'opposition')]), author_party: 'inc' },
    }),
    'neutral', 'none');

t('citizen attacking Congress (no author party) is still pro client',
    compute({
        resolvedActors: [{ text: 'Congress', key: 'inc', canonical: 'Indian National Congress', affiliation: 'opposition', confidence: 0.9 }],
        generic_sentiment: 'negative',
        ctx: ctxAuthor(null, [E('Indian National Congress', 'opposition')]),
    }),
    'pro_target_indirect', 'ours');

t('SAFETY: target already correct (cross-camp) → correction does not fire',
    compute({
        resolvedActors: [opp(), ally()],
        resolvedTarget: ally(),
        generic_sentiment: 'negative',
        ctx: ctxAuthor('opposition', [E('Dr. Mahesh Kumar Goud', 'opposition'), E('K Chandrashekar Rao', 'ally')]),
    }),
    'anti_target', 'opposition');

t('SAFETY: positive tone is never re-pointed',
    compute({
        resolvedActors: [opp()],
        resolvedTarget: opp(),
        generic_sentiment: 'positive',
        ctx: ctxAuthor('opposition', [E('Dr. Mahesh Kumar Goud', 'opposition'), E('K Chandrashekar Rao', 'ally')]),
    }),
    // cross-camp prior does NOT apply (author and target are the same camp),
    // so this stays a plain praise-of-opposition.
    'anti_target_indirect', 'opposition');

t('SAFETY: unknown author (null alignment) → correction never fires',
    compute({
        resolvedActors: [opp()],
        resolvedTarget: opp(),
        generic_sentiment: 'negative',
        ctx: ctxAuthor(null, [E('Dr. Mahesh Kumar Goud', 'opposition'), E('K Chandrashekar Rao', 'ally')]),
    }),
    'pro_target_indirect', 'ours');

/* ═══ E. cross-camp prior ════════════════════════════════════════════ */
console.log('\n=== E. cross-camp prior (an opponent addressing our side is not endorsing it) ===');

t('opposition author + ally target + mislabelled positive → downgraded to neutral + review',
    compute({
        resolvedActors: [opp(), ally()],
        resolvedTarget: ally(),
        generic_sentiment: 'positive',
        ctx: ctxAuthor('opposition', [E('Dr. Mahesh Kumar Goud', 'opposition'), E('K Chandrashekar Rao', 'ally')]),
    }),
    'neutral', 'none');

t('ally author + opposition target + positive → downgraded to neutral (symmetric)',
    compute({
        resolvedActors: [ally(), opp()],
        resolvedTarget: opp(),
        generic_sentiment: 'positive',
        ctx: ctxAuthor('ally', [E('K Chandrashekar Rao', 'ally'), E('Dr. Mahesh Kumar Goud', 'opposition')]),
    }),
    'neutral', 'none');

t('SAFETY: ally author praising ally → genuine praise NOT downgraded',
    compute({
        resolvedActors: [ally()],
        resolvedTarget: ally(),
        generic_sentiment: 'positive',
        ctx: ctxAuthor('ally', [E('K Chandrashekar Rao', 'ally')]),
    }),
    'pro_target', 'ours');

t('SAFETY: opposition author praising own side → NOT downgraded',
    compute({
        resolvedActors: [opp()],
        resolvedTarget: opp(),
        generic_sentiment: 'positive',
        ctx: ctxAuthor('opposition', [E('Dr. Mahesh Kumar Goud', 'opposition')]),
    }),
    'anti_target_indirect', 'opposition');

t('SAFETY: unknown author + positive about ally → stays pro_target',
    compute({
        resolvedActors: [ally()],
        resolvedTarget: ally(),
        generic_sentiment: 'positive',
        ctx: ctxAuthor(null, [E('K Chandrashekar Rao', 'ally')]),
    }),
    'pro_target', 'ours');

t('SAFETY: cross-camp prior does not fire on negative tone (author correction owns that)',
    compute({
        resolvedActors: [opp(), ally()],
        resolvedTarget: ally(),
        generic_sentiment: 'negative',
        ctx: ctxAuthor('opposition', [E('Dr. Mahesh Kumar Goud', 'opposition'), E('K Chandrashekar Rao', 'ally')]),
    }),
    'anti_target', 'opposition');

/* ═══ F. Telangana roster wiring ═════════════════════════════════ */
console.log('\n=== F. Telangana roster wiring: alignment inferred from the roster ===');

{
    const { ALLY_PARTIES } = require('../src/config/politicalData');
    const cm = POLITICAL_ENTITIES[PRIMARY_TARGET_KEY];
    tField('primary target resolves to the BRS president', cm && cm.canonical, 'K. Chandrashekar Rao');
    tField('primary target is ALLY-aligned', cm && cm.alignment, 'ally');
    // Our camp.
    tField('BRS is ALLY (client party)', POLITICAL_ENTITIES.brs && POLITICAL_ENTITIES.brs.alignment, 'ally');
    tField('BRS contests alone: no coalition partner', ALLY_PARTIES.length, 0);

    // Everyone else. BRS is in OPPOSITION, so the party of government is a
    // rival and so is the Speaker who sits with it — the reverse of a
    // ruling-party deployment.
    tField('INC (the ruling party) is OPPOSITION', POLITICAL_ENTITIES.inc && POLITICAL_ENTITIES.inc.alignment, 'opposition');
    tField('BJP is OPPOSITION', POLITICAL_ENTITIES.bjp && POLITICAL_ENTITIES.bjp.alignment, 'opposition');
    tField('AIMIM is OPPOSITION', POLITICAL_ENTITIES.aimim && POLITICAL_ENTITIES.aimim.alignment, 'opposition');
    tField('CPI is OPPOSITION', POLITICAL_ENTITIES.cpi && POLITICAL_ENTITIES.cpi.alignment, 'opposition');
    tField("Kavitha's TRS(K) is OPPOSITION", POLITICAL_ENTITIES['trs-k'] && POLITICAL_ENTITIES['trs-k'].alignment, 'opposition');
    tField('Kavitha herself is OPPOSITION, not family', POLITICAL_ENTITIES.kavitha && POLITICAL_ENTITIES.kavitha.alignment, 'opposition');
    tField('Chief Minister Revanth Reddy is OPPOSITION', POLITICAL_ENTITIES['revanth-reddy'] && POLITICAL_ENTITIES['revanth-reddy'].alignment, 'opposition');
    tField('the Speaker sits with the OPPOSITION', POLITICAL_ENTITIES['gaddam-prasad-kumar'] && POLITICAL_ENTITIES['gaddam-prasad-kumar'].alignment, 'opposition');
    tField('the state government is OPPOSITION', POLITICAL_ENTITIES.state_government && POLITICAL_ENTITIES.state_government.alignment, 'opposition');
    tField('the working president is the secondary target', POLITICAL_ENTITIES[require('../src/config/politicalEntities').SECONDARY_TARGET_KEY].canonical, 'K. T. Rama Rao');
}

t('actor carrying only a roster KEY (no affiliation) still resolves to ally',
    compute({
        resolvedActors: [{ text: 'Sai', key: PRIMARY_TARGET_KEY, canonical: 'K Chandrashekar Rao', affiliation: null }],
        generic_sentiment: 'negative',
        ctx: ctxWith(),
    }),
    'anti_target', 'opposition');

t('target carrying only a roster KEY (no affiliation) still resolves to opposition',
    compute({
        resolvedActors: [],
        resolvedTarget: { text: 'Congress', key: 'inc', canonical: 'Indian National Congress', affiliation: null },
        generic_sentiment: 'negative',
        ctx: ctxWith(),
    }),
    'pro_target_indirect', 'ours');

/*
 * 'bsk' is the legacy target key of the Bandi Sanjay Kumar deployment this
 * codebase descends from. In THAT deployment he was the client, so criticism
 * of him scored anti_target. Here he is a Union Minister and one of the
 * loudest anti-BRS voices, so the same key resolves to a RIVAL and the same
 * criticism scores PRO us. The stored key is unchanged; its meaning is not.
 */
t('legacy key "bsk" resolves to a rival, so criticism of him is PRO us',
    compute({
        resolvedActors: [{ text: 'bsk', key: 'bsk', canonical: null, affiliation: null }],
        generic_sentiment: 'negative',
        ctx: ctxWith(),
    }),
    // pro_target_INDIRECT, because the benefit is second-hand: nobody praised
    // us, a rival was criticised. The beneficiary side is therefore 'ours'.
    'pro_target_indirect', 'ours');

/* ─── report ────────────────────────────────────────────────────────── */
console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
process.exit(fail ? 1 : 0);
