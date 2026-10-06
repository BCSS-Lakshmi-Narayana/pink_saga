/**
 * test_stage3_input.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Proves the STAGE3_INCLUDE_ORIGINAL switch is safe to deploy.
 *
 * The claim being tested is the one the deployment rests on: with the flag unset
 * or 'false', Stage 3 receives EXACTLY the string it received before this change.
 * Everything else is secondary.
 *
 *   node scripts/test_stage3_input.js
 */

const path = require('path');
const MODULE = path.join(__dirname, '..', 'src', 'services', 'stage3Input.js');

let pass = 0;
let fail = 0;
const check = (name, actual, expected) => {
    const ok = actual === expected;
    if (ok) { pass += 1; console.log(`PASS  ${name}`); }
    else {
        fail += 1;
        console.log(`FAIL  ${name}`);
        console.log(`        expected: ${JSON.stringify(String(expected).slice(0, 120))}`);
        console.log(`        actual  : ${JSON.stringify(String(actual).slice(0, 120))}`);
    }
};
const checkTrue = (name, cond) => check(name, !!cond, true);

/** Reload with a specific flag value — the module reads env at call time, but a
 *  fresh require also guards against anyone later hoisting it to module scope. */
const load = (value) => {
    if (value === undefined) delete process.env.STAGE3_INCLUDE_ORIGINAL;
    else process.env.STAGE3_INCLUDE_ORIGINAL = value;
    delete require.cache[require.resolve(MODULE)];
    return require(MODULE);
};

// A Devanagari (Marathi) headline and its translation.
const TE = 'मुख्यमंत्र्यांचे भगीरथ प्रयत्न.. सत्तरी तालुक्यातील लोकांचे तीस वर्षांचे स्वप्न साकार';
const EN = "The Chief Minister's bhagiratha effort.. The 30-year dream of the people of Sattari taluka has come true";

console.log('\n── the deployment-safety claim: flag off changes nothing ──');
for (const [label, value] of [['unset', undefined], ['"false"', 'false'], ['"FALSE"', 'FALSE'], ['garbage', 'yes-please']]) {
    const { buildStage3Input } = load(value);
    check(`flag ${label}: returns the translation verbatim`,
        buildStage3Input({ original: TE, english: EN }), EN);
    check(`flag ${label}: English-only post returns its own text`,
        buildStage3Input({ original: EN, english: '' }), EN);
}

console.log('\n── flag on ──');
{
    const { buildStage3Input } = load('true');
    const out = buildStage3Input({ original: TE, english: EN });
    checkTrue('contains the original', out.includes(TE));
    checkTrue('contains the translation', out.includes(EN));
    checkTrue('original appears BEFORE the translation', out.indexOf(TE) < out.indexOf(EN));
    checkTrue('labels the original authoritative', /ORIGINAL TEXT \(authoritative/.test(out));

    // No translation happened → nothing to pair, must not fabricate a block.
    check('no translation: returns the original alone',
        buildStage3Input({ original: TE, english: '' }), TE);

    // Already English → the two strings are the same text; pairing would just
    // duplicate the post and waste half the context.
    check('English post: not duplicated',
        buildStage3Input({ original: EN, english: EN }), EN);
    check('English post, whitespace differs: still not duplicated',
        buildStage3Input({ original: `${EN}  `, english: EN }), EN);

    // Empty / missing inputs must not throw.
    check('both empty', buildStage3Input({ original: '', english: '' }), '');
    check('null inputs', buildStage3Input({ original: null, english: null }), '');
}

console.log('\n── context overflow: must degrade to translation-only, never overflow ──');
{
    const { buildStage3Input, estimateTokens } = load('true');
    // A long Devanagari article. Indic script runs ~2 tokens/char, so this is far
    // over the 1200-token budget on its own.
    const longTe = TE.repeat(30);
    const longEn = EN.repeat(30);
    checkTrue('long input really does exceed the budget',
        estimateTokens(longTe) + estimateTokens(longEn) > 1200);
    check('oversized pair falls back to translation-only',
        buildStage3Input({ original: longTe, english: longEn }), longEn);

    // A short pair must still be combined.
    const out = buildStage3Input({ original: TE, english: EN });
    checkTrue('short pair is still combined', out.includes(TE) && out.includes(EN));

    // Budget is tunable and respected.
    process.env.STAGE3_INPUT_TOKEN_BUDGET = '10';
    check('a tiny budget forces translation-only',
        buildStage3Input({ original: TE, english: EN }), EN);
    delete process.env.STAGE3_INPUT_TOKEN_BUDGET;
}

console.log('\n── the estimator (a char count cannot police this budget) ──');
{
    const { estimateTokens } = load('true');
    const te = estimateTokens(TE);
    const en = estimateTokens(EN);
    console.log(`      Devanagari ${TE.length} chars → ~${te} tokens  (${(te / TE.length).toFixed(2)}/char)`);
    console.log(`      English    ${EN.length} chars → ~${en} tokens  (${(en / EN.length).toFixed(2)}/char)`);
    checkTrue('Devanagari costs far more per character than English', te / TE.length > (en / EN.length) * 3);
    check('empty string is 0 tokens', estimateTokens(''), 0);
    check('null is 0 tokens', estimateTokens(null), 0);
    checkTrue('newlines are not charged at the non-Latin rate',
        estimateTokens('a\n\n\n\n\n\nb') < 5);
}

console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
process.exit(fail ? 1 : 0);
