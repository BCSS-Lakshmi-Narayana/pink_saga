/**
 * test_hashtags_schemes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers the two Stage 2 additions — compound-hashtag segmentation and
 * government-scheme entities — with the emphasis on what must NOT change.
 *
 * Both additions are meant to be purely additive: they may turn "no entity
 * found" into "entity found", and nothing else. Most of what follows checks that
 * promise rather than the new capability.
 *
 *   node scripts/test_hashtags_schemes.js
 */

const { buildPoliticalContext } = require('../src/services/politicalContextService');
const { segmentHashtags, findStanceHashtags, extractHashtags } = require('../src/config/hashtagSignals');
const { POLITICAL_ENTITIES } = require('../src/config/politicalEntities');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`PASS  ${name}`); }
    else { fail += 1; console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};
const keys = (t, opts) => (buildPoliticalContext(t, opts || {}).mentioned_entities || []).map((e) => e.key);
const has = (t, k) => keys(t).includes(k);

console.log('\n── compound hashtags: the gap segmentation exists to close ──');
ok('#TGRejectsBJP now resolves BJP', has('#TGRejectsBJP', 'bjp'), `got ${keys('#TGRejectsBJP')}`);
ok('#KCR resolves the party president', has('#KCR', 'kcr'), `got ${keys('#KCR')}`);
ok('#CongressTelangana resolves INC', has('#CongressTelangana', 'inc'), `got ${keys('#CongressTelangana')}`);
ok('segmentation splits case boundaries', segmentHashtags('#TGRejectsBJP').includes('BJP'),
    `got "${segmentHashtags('#TGRejectsBJP')}"`);
ok('segmentation preserves case (lowercasing would make it a no-op)',
    /[A-Z]/.test(segmentHashtags('#TGRejectsBJP')));
ok('nothing to split returns empty', segmentHashtags('#bjp #aap') === '');

console.log('\n── segmentation must NOT invent entities ──');
ok('#TelanganaPolitics resolves nothing', keys('#TelanganaPolitics').length === 0, `got ${keys('#TelanganaPolitics')}`);
ok('#AdilabadTourism resolves nothing', keys('#AdilabadTourism').length === 0, `got ${keys('#AdilabadTourism')}`);
ok('a non-political tag resolves nothing', keys('#GoodMorningFriends').length === 0);
ok('plain text with no hashtags is unaffected',
    keys('The weather in Margao is pleasant today').length === 0);
ok('"including" does not match the INC alias', !has('including everyone', 'inc'));
ok('#IncredibleIndia does not match INC', !has('#IncredibleIndia', 'inc'),
    `got ${keys('#IncredibleIndia')}`);
ok('"aapka" does not match AAP', !has('aapka swagat hai', 'aap'));

console.log('\n── body text still outranks hashtags ──');
{
    const t = 'K Chandrashekar Rao inaugurated the project today #CongressTelangana';
    const ks = keys(t);
    ok('both resolve, body entity first', ks[0] === 'kcr' && ks.includes('inc'), `got ${ks}`);
    const ctx = buildPoliticalContext(t, {});
    ok('primary_target comes from the body, not the hashtag',
        ctx.primary_target === 'kcr', `got ${ctx.primary_target}`);
    const bodyOnly = buildPoliticalContext('K Chandrashekar Rao inaugurated the project today', {});
    ok('adding a hashtag does not change the body-derived primary_target',
        ctx.primary_target === bodyOnly.primary_target);
}

console.log('\n── hashtag stuffing is capped ──');
{
    const stuffed = Array.from({ length: 40 }, (_, i) => `#Tag${i}`).join(' ');
    ok('extraction stops at the cap', extractHashtags(stuffed).length <= 12,
        `got ${extractHashtags(stuffed).length}`);
    ok('duplicates counted once', extractHashtags('#BJP #bjp #Bjp').length === 1);
}

console.log('\n── curated stance hashtags ──');
{
    const s = findStanceHashtags('మూసీ నిరసన #SaveMusi #CongressFailed');
    ok('both attack tags found', s.length === 2 && s.every((x) => x.direction === 'attack'),
        JSON.stringify(s));
    const te = findStanceHashtags('ప్రచారం #బీఆర్ఎస్');
    ok('Telugu campaign tag found as support',
        te.length === 1 && te[0].direction === 'support' && te[0].target === 'brs', JSON.stringify(te));
    ok('targets resolve to real roster keys',
        s.every((x) => !!POLITICAL_ENTITIES[x.target]), JSON.stringify(s));
    ok('an uncurated tag yields no direction', findStanceHashtags('#RandomTag').length === 0);
    ok('lookup is case-insensitive', findStanceHashtags('#KALESHWARAM').length === 1);
    const all = require('../src/config/hashtagSignals').STANCE_HASHTAGS;
    const bad = Object.entries(all).filter(([, v]) => !POLITICAL_ENTITIES[v.target]);
    ok('every curated target exists in the roster', bad.length === 0,
        bad.map(([k, v]) => `${k}→${v.target}`).join(', '));
    ok('every curated direction is attack|support',
        Object.values(all).every((v) => ['attack', 'support'].includes(v.direction)));
}

console.log('\n── government schemes ──');
ok('English scheme name resolves', has('Rythu Bandhu money not credited for three months', 'scheme-rythu-bandhu'));
ok('paddy input-subsidy scheme resolves', has('Dalit Bandhu payment delayed again', 'scheme-dalit-bandhu'));
ok('Telugu scheme name resolves', has('రైతుబంధు డబ్బులు రాలేదు', 'scheme-rythu-bandhu'));
ok('water-scheme name resolves', has('Mission Bhagiratha pipelines dry for weeks', 'scheme-mission-bhagiratha'));
ok('scheme post is no longer "irrelevant"',
    buildPoliticalContext('Rythu Bharosa instalment stuck for months', {}).mode !== 'irrelevant');

console.log('\n── a scheme must never outrank a named leader ──');
{
    const ctx = buildPoliticalContext('K Chandrashekar Rao defended the Rythu Bandhu scheme today', {});
    ok('primary_target is the person, not the scheme',
        ctx.primary_target === 'kcr', `got ${ctx.primary_target}`);
    const sch = POLITICAL_ENTITIES['scheme-rythu-bandhu'];
    const cm = POLITICAL_ENTITIES['kcr'];
    ok('scheme priority sits below every person/party', sch.priority < cm.priority);
    ok('schemes are aligned to us', sch.alignment === 'ally');
    ok('schemes are typed distinctly', sch.type === 'scheme');
}

console.log('\n── no alias collisions introduced ──');
{
    const schemeKeys = Object.keys(POLITICAL_ENTITIES).filter((k) => POLITICAL_ENTITIES[k].type === 'scheme');
    ok(`${schemeKeys.length} scheme entities registered`, schemeKeys.length >= 8);
    const nonScheme = Object.entries(POLITICAL_ENTITIES).filter(([, e]) => e.type !== 'scheme');
    const clashes = [];
    for (const k of schemeKeys) {
        for (const a of POLITICAL_ENTITIES[k].aliases) {
            for (const [ok2, e] of nonScheme) {
                if ((e.aliases || []).some((x) => String(x).toLowerCase() === a)) clashes.push(`${a}: ${k} vs ${ok2}`);
            }
        }
    }
    ok('no scheme alias collides with a person or party', clashes.length === 0, clashes.join(' | '));
    ok('no scheme alias is dangerously short',
        schemeKeys.every((k) => POLITICAL_ENTITIES[k].aliases.every((a) => a.length >= 4)));
}

console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
process.exit(fail ? 1 : 0);
