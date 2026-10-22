/**
 * test_manifesto_tracker.js
 * ─────────────────────────────────────────────────────────────────────
 * Manifesto tracker: the scheme catalogue, the model reader's output checks,
 * and status / reach / sentiment per scheme from hand-made posts whose answers
 * are known. No database, no model (the model call is stood in).
 *
 *   node scripts/test_manifesto_tracker.js
 */
let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`PASS  ${name}`); }
    else { fail += 1; console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

const { MANIFESTO_SCHEMES, schemesNamedIn } = require('../src/config/manifestoSchemes');
const { GOVERNMENT_SCHEMES } = require('../src/config/politicalEntities');

console.log('\n── the catalogue ──');
ok('both sides tracked', MANIFESTO_SCHEMES.some((s) => s.side === 'theirs') && MANIFESTO_SCHEMES.some((s) => s.side === 'ours'));
ok('every entity reference exists in politicalEntities', MANIFESTO_SCHEMES.every((s) => !s.entity || GOVERNMENT_SCHEMES[s.entity]));
const ids = new Set(MANIFESTO_SCHEMES.map((s) => s.id));
ok('ids are unique', ids.size === MANIFESTO_SCHEMES.length);
ok('every pair points both ways', MANIFESTO_SCHEMES.filter((s) => s.pair).every((s) => ids.has(s.pair) && MANIFESTO_SCHEMES.find((x) => x.id === s.pair).pair === s.id));
ok('Mahalakshmi is split into its separate promises', ['mahalakshmi-cash', 'mahalakshmi-lpg', 'mahalakshmi-bus'].every((x) => ids.has(x)));
ok('existing aliases are reused (Telugu Rythu Bharosa)', schemesNamedIn('రైతు భరోసా ఇంకా రాలేదు').includes('rythu-bharosa'));
ok('promise phrases find promise-gap posts (2,500 for women)', schemesNamedIn('మహిళలకు నెలకు 2500 ఏమైంది?').includes('mahalakshmi-cash'));
ok('loan waiver in Telugu', schemesNamedIn('రుణమాఫీ కాలేదు').includes('loan-waiver'));
ok('our scheme not in politicalEntities (Kalyana Lakshmi)', schemesNamedIn('కల్యాణ లక్ష్మి చెక్కులు ఆగిపోయాయి').includes('kalyana-lakshmi'));
ok('a post naming no scheme has no candidates', schemesNamedIn('Traffic jam at Ameerpet today').length === 0);

console.log('\n── the reader keeps only valid answers ──');
// Stand in for the model: whatever the next call should return.
let nextReply = null;
let byModel = null;   // when set, each model answers differently
const llmPath = require.resolve('../src/services/llmProvider');
require.cache[llmPath] = { id: llmPath, filename: llmPath, loaded: true, exports: { chatJson: async (o) => (byModel ? byModel[o.model] : nextReply), withForcedProvider: (_p, fn) => fn() } };
const { readClaims, buildPrompt } = require('../src/services/schemeClaimService');
(async () => {
    nextReply = { schemes: [
        { id: 'rythu-bharosa', about: true, evidence: 'Rythu Bharosa still not credited', claim: 'not_received', figure: null },
        { id: 'not-a-candidate', about: true, evidence: 'still not credited', claim: 'received' },
        { id: 'rythu-bandhu', about: true, evidence: 'Rythu Bandhu came', claim: 'made_up_claim', figure: 'Rs 10,000 per acre' },
        { id: 'rythu-bharosa', about: true, evidence: 'still not credited', claim: 'received' },
        { id: 'gruha-jyothi', about: false, evidence: 'free power', claim: 'received' },
        { id: 'loan-waiver', evidence: 'loan waiver', claim: 'received' },
    ] };
    const POST = 'Rythu Bharosa still not credited. Under KCR, Rythu Bandhu came every season, Rs 10,000 per acre.';
    const out = await readClaims(POST, ['rythu-bharosa', 'rythu-bandhu', 'gruha-jyothi', 'loan-waiver']);
    ok('a scheme the model says the post is not about is dropped', !out.some((r) => r.scheme === 'gruha-jyothi'));
    ok('a scheme with no "about" answer is dropped', !out.some((r) => r.scheme === 'loan-waiver'));
    ok('ids outside the candidates are dropped', !out.some((r) => r.scheme === 'not-a-candidate'));
    ok('an unknown claim becomes "none"', out.find((r) => r.scheme === 'rythu-bandhu').claim === 'none');
    ok('a scheme answered twice is kept once (first answer)', out.filter((r) => r.scheme === 'rythu-bharosa').length === 1 && out[0].claim === 'not_received');
    ok('a quoted figure is kept', out.find((r) => r.scheme === 'rythu-bandhu').figure === 'Rs 10,000 per acre');
    ok('handles are not scheme mentions', schemesNamedIn('@JAGANBRS @DharaniBRS #CongressFailed').length === 0);
    ok('the everyday word చేయూత alone is not the pension scheme', schemesNamedIn('భూక్య జంపన్న చేయూత!').length === 0);
    nextReply = { schemes: [
        { id: 'rythu-bharosa', about: true, evidence: '', claim: 'delayed' },
        { id: 'loan-waiver', about: true, evidence: 'farmers are waiting for months', claim: 'delayed' },
        { id: 'mission-bhagiratha', about: true, evidence: 'went without Mission Bhagiratha water for ten days', claim: 'not_received' },
    ] };
    const ev = await readClaims('Women protested after the wards went without Mission Bhagiratha water for 10 days. Rythu Bharosa and the loan waiver were also raised.', ['rythu-bharosa', 'loan-waiver', 'mission-bhagiratha']);
    ok('a claim with no evidence becomes "none"', ev.find((r) => r.scheme === 'rythu-bharosa').claim === 'none');
    ok('a claim whose quote is not in the post becomes "none"', ev.find((r) => r.scheme === 'loan-waiver').claim === 'none');
    ok('a near-verbatim quote (80% of words) stands', ev.find((r) => r.scheme === 'mission-bhagiratha').claim === 'not_received');
    nextReply = { schemes: [{ id: 'kaleshwaram', about: true, evidence: 'కాళేశ్వరం ప్రాజెక్టు', claim: 'received' }] };
    const nameOnly = await readClaims('కేసీఆర్ గారి హయాంలో కాళేశ్వరం ప్రాజెక్టు, మిషన్ భగీరథ', ['kaleshwaram']);
    ok('a quote that is only the scheme name is not evidence', nameOnly[0].claim === 'none');
    console.log('\n── two models must agree ──');
    const AGREE_POST = 'Rythu Bharosa still not credited to us. Free bus is working well for women.';
    byModel = {
        a: { schemes: [
            { id: 'rythu-bharosa', about: true, evidence: 'Rythu Bharosa still not credited', claim: 'not_received' },
            { id: 'mahalakshmi-bus', about: true, evidence: 'Free bus is working well', claim: 'received' },
            { id: 'gruha-jyothi', about: true, evidence: '', claim: 'none' },
        ] },
        b: { schemes: [
            { id: 'rythu-bharosa', about: true, evidence: 'still not credited to us', claim: 'not_received' },
            { id: 'mahalakshmi-bus', about: true, evidence: 'Free bus is working well', claim: 'delayed' },
            { id: 'gruha-jyothi', about: false, evidence: '', claim: 'none' },
        ] },
    };
    const agreed = await readClaims(AGREE_POST, ['rythu-bharosa', 'mahalakshmi-bus', 'gruha-jyothi'], { models: ['a', 'b'] });
    ok('same claim from both models stands', agreed.find((r) => r.scheme === 'rythu-bharosa').claim === 'not_received');
    ok('different claims → "none"', agreed.find((r) => r.scheme === 'mahalakshmi-bus').claim === 'none');
    ok('kept only when both say the post is about the scheme', !agreed.some((r) => r.scheme === 'gruha-jyothi'));
    byModel = null;
    nextReply = { schemes: [
        { id: 'gruha-jyothi', about: true, evidence: '24-hour free power to farmers', claim: 'received' },
        { id: 'mahalakshmi-bus', about: true, evidence: 'sharply hiking bus fares', claim: 'not_received' },
        { id: 'mission-bhagiratha', about: true, evidence: 'Tapped drinking water using mission bhagiratha', claim: 'received' },
        { id: 'rythu-bima', about: true, evidence: 'Revanth Reddy stopped this scheme', claim: 'stopped' },
    ] };
    const LOOK = 'KCR gave 24-hour free power to farmers. Govt is sharply hiking bus fares. Tapped drinking water using mission bhagiratha. Revanth Reddy stopped this scheme (Rythu Bima).';
    const look = await readClaims(LOOK, ['gruha-jyothi', 'mahalakshmi-bus', 'mission-bhagiratha', 'rythu-bima']);
    const lc = (id) => look.find((r) => r.scheme === id).claim;
    ok('farm power is not Gruha Jyothi', lc('gruha-jyothi') === 'none');
    ok('bus fares are not the free bus for women', lc('mahalakshmi-bus') === 'none');
    ok('"received" is not counted for our own schemes (past praise)', lc('mission-bhagiratha') === 'none');
    ok('"stopped" still counts for our schemes', lc('rythu-bima') === 'stopped');

    console.log('\n── rules re-applied to saved readings ──');
    const { claimStands } = require('../src/services/schemeClaimService');
    ok('a promise in Telugu ("will give", అందిస్తాం) is not delivery', !claimStands({ scheme: 'indiramma-indlu', claim: 'received', evidence: 'అర్హులైన ప్రతి పేద కుటుంబానికి ఇందిరమ్మ ఇల్లు అందిస్తాం' }));
    ok('a promise in English is not delivery', !claimStands({ scheme: 'rythu-bharosa', claim: 'received', evidence: 'farmers will get Rythu Bharosa next month' }));
    ok('"will" inside another word does not count as a promise', claimStands({ scheme: 'rythu-bharosa', claim: 'received', evidence: 'goodwill shown as Rythu Bharosa credited to farmers' }));
    ok('"24-hour power" is farm power, not Gruha Jyothi', !claimStands({ scheme: 'gruha-jyothi', claim: 'not_received', evidence: '24-hour free power policy' }));
    ok('a plain delivery report stands', claimStands({ scheme: 'rythu-bima', claim: 'not_received', evidence: 'Payment of Rythu Bima has not been made till date' }));
    // Real readings that quoted the promise or a description as if it were delivery.
    ok('quoting the promise is not delivery (Rs 2,500 from a protest)', !claimStands({ scheme: 'mahalakshmi-cash', claim: 'received', evidence: 'మహిళలకు నెలకు రూ.2,500' }));
    ok('a description is not delivery', !claimStands({ scheme: 'indiramma-indlu', claim: 'received', evidence: 'supports eligible families with ₹5 lakh for house construction' }));
    ok('a deadline is not delivery', !claimStands({ scheme: 'indiramma-indlu', claim: 'received', evidence: 'Indiramma house keys in one year: Minister Ponguleti Reddy' }));
    ok('"provides" describes, it does not report delivery', !claimStands({ scheme: 'rythu-bharosa', claim: 'received', evidence: 'Rythu Bharosa provides ₹6,000 per acre per season' }));
    ok('"provided" reports delivery', claimStands({ scheme: 'rythu-bharosa', claim: 'received', evidence: 'the government provided Rythu Bharosa to our village' }));
    ok('"sanctioned" is delivery', claimStands({ scheme: 'indiramma-indlu', claim: 'received', evidence: '4.5L Indiramma houses sanctioned' }));
    ok('Telugu "is being implemented" is delivery', claimStands({ scheme: 'mahalakshmi-bus', claim: 'received', evidence: 'మహిళలకు మహాలక్ష్మి ఉచిత బస్సు పథకం విజయవంతంగా అమలవుతోంది' }));
    ok('Telugu "credited" (జమ) is delivery', claimStands({ scheme: 'rythu-bharosa', claim: 'received', evidence: 'రైతు భరోసా డబ్బులు ఖాతాల్లో జమ అయ్యాయి' }));
    ok('the rule is only for "received": a complaint needs no delivery word', claimStands({ scheme: 'rythu-bharosa', claim: 'not_received', evidence: 'యాసంగి రైతు భరోసా లేనట్లే!' }));
    nextReply = 'not json at all';
    ok('a reply without a scheme list gives no claims', (await readClaims('post', ['rythu-bharosa'])).length === 0);
    ok('no candidates → no model call needed', (await readClaims('post', [])).length === 0);
    const prompt = buildPrompt('text', ['mahalakshmi-cash', 'rythu-bandhu']);
    ok('the prompt states the promise for their schemes and the scheme for ours', /promised in 2023: Rs 2,500 a month/.test(prompt) && /previous government ran/.test(prompt));

    console.log('\n── status, reach and sentiment per scheme ──');
    const { summariseScheme, favourOf } = require('../src/services/manifestoService');
    const { SCHEME_BY_ID } = require('../src/config/manifestoSchemes');
    let n = 0;
    // The quote a reading carries for each claim, as saved readings do (they are re-checked by claimStands).
    const EVIDENCE = {
        received: 'the amount was credited to our accounts', not_received: 'still not credited to us',
        delayed: 'we are still waiting for it', reduced: 'only half the amount was paid', stopped: 'the scheme was stopped',
    };
    const item = ({ scheme = 'rythu-bharosa', claim = 'none', figure = null, voice = 'organic', stance = 'neutral', platform = 'x', engagement = 0, handle = null }) => {
        n += 1;
        return {
            date: new Date(), platform, voice, stance, engagement, text: `post ${n}`, url: `https://x.com/p/${n}`,
            author: handle || `citizen${n}`, handle: handle || `citizen${n}`, schemes: [{ scheme, claim, figure, evidence: EVIDENCE[claim] || null }],
        };
    };
    const times = (k, make) => Array.from({ length: k }, () => make());
    const cur = [
        ...times(8, () => item({ claim: 'not_received', stance: 'pro_target_indirect', engagement: 5 })),
        ...times(2, () => item({ claim: 'delayed', stance: 'pro_target_indirect' })),
        ...times(2, () => item({ claim: 'received', stance: 'anti_target_indirect', voice: 'news', platform: 'news' })),
        // Government accounts say it was credited: reach yes, public report no.
        ...times(5, () => item({ claim: 'received', voice: 'opposition', handle: 'TelanganaCMO', stance: 'anti_target_indirect', figure: 'Rs 9,000 crore to 70 lakh farmers' })),
        ...times(3, () => item({ claim: 'none', stance: 'neutral' })),
        // Another scheme in the same window.
        ...times(4, () => item({ scheme: 'rythu-bandhu', claim: 'stopped', stance: 'pro_target' })),
    ];
    const rb = summariseScheme(SCHEME_BY_ID.get('rythu-bharosa'), cur, []);
    ok('public and press reports only (government accounts left out)', rb.status.total === 12 && rb.status.reports.received === 2, JSON.stringify(rb.status.reports));
    ok('verdict: mostly not received (8 of 12)', rb.status.verdict && rb.status.verdict.claim === 'not_received' && rb.status.verdict.share === 67 && rb.status.verdict.text === 'Mostly not received');
    ok('reach counts every post about it, accounts once each', rb.reach.posts === 20 && rb.reach.accounts === 16, JSON.stringify({ p: rb.reach.posts, a: rb.reach.accounts }));
    ok('figures quoted are kept with who quoted them, each figure once', rb.reach.figures.length === 1 && rb.reach.figures[0].source_type === 'Rival party & government accounts');
    ok('sentiment: public and press — 10 favour us, 2 favour the government', rb.sentiment.favours_ours === 10 && rb.sentiment.favours_govt === 2 && rb.sentiment.net_ours === 67);
    ok('sentiment by source shows the government accounts separately', rb.sentiment.by_source.find((v) => v.voice === 'opposition').govt === 5);
    ok('examples: most engaged first, one per text', rb.examples[0].claim === 'not_received' && rb.examples.length <= 12);

    const few = summariseScheme(SCHEME_BY_ID.get('rythu-bandhu'), cur, []);
    ok('under the threshold: no verdict, counts still shown', few.status.verdict === null && few.status.reports.stopped === 4 && few.status.total === 4);
    ok('our scheme credited to us', few.sentiment.favours_ours === 4 && few.sentiment.net_ours === 100);

    const mixed = summariseScheme(SCHEME_BY_ID.get('gruha-jyothi'), [
        ...times(5, () => item({ scheme: 'gruha-jyothi', claim: 'received' })),
        ...times(4, () => item({ scheme: 'gruha-jyothi', claim: 'not_received' })),
        ...times(3, () => item({ scheme: 'gruha-jyothi', claim: 'delayed' })),
    ], []);
    ok('no majority → "Mixed" with the largest share', mixed.status.verdict.text === 'Mixed — received 42%', mixed.status.verdict.text);

    ok('favour: rival criticised favours us, rival praised favours the government', favourOf('pro_target_indirect') === 'ours' && favourOf('anti_target_indirect') === 'govt' && favourOf('neutral') === null);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
