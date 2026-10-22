/**
 * seed_manifesto_keywords.js
 * ─────────────────────────────────────────────────────────────────────
 * Search keywords so the collectors fetch posts about every scheme the
 * Manifesto tracker follows (src/config/manifestoSchemes.js).
 *
 * Checked on the live database before this was written: of 43 scheme-related
 * keywords, most were switched off — nearly every Telugu one ("రైతు భరోసా",
 * "ఇందిరమ్మ ఇళ్లు", "ఆరు గ్యారంటీలు", …) — and several promises had none at
 * all (Gruha Jyothi, the Rs 2,500 for women, the Rs 4,000 pension, the paddy
 * bonus, Aarogyasri, Bhu Bharati, KCR Kit, …). The tracker can only be as full
 * as the collection: Gruha Jyothi had 4 posts in 90 days.
 *
 * Each keyword is one more search per polling cycle on every platform that
 * searches by keyword, so this costs API calls. Review the dry run first.
 *
 *   node scripts/seed_manifesto_keywords.js            # dry run: lists what would change, writes nothing
 *   node scripts/seed_manifesto_keywords.js --apply    # switch on / add them
 *
 * Idempotent. Existing keywords are switched on, never duplicated; nothing is
 * switched off or deleted.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Keyword = require('../src/models/Keyword');
const { SCHEME_BY_ID } = require('../src/config/manifestoSchemes');

/** scheme id → search terms. One English and one Telugu at least; promise-gap wording where people use it. */
const TERMS = {
    // the governing party's 2023 promises
    'mahalakshmi-cash': { en: ['Mahalakshmi 2500'], te: ['మహాలక్ష్మి 2500', 'మహిళలకు 2500'] },
    'mahalakshmi-lpg': { en: ['500 gas cylinder Telangana'], te: ['రూ.500 గ్యాస్ సిలిండర్'] },
    'mahalakshmi-bus': { en: ['Mahalakshmi free bus'], te: ['ఉచిత బస్సు ప్రయాణం'] },
    'rythu-bharosa': { en: ['Rythu Bharosa', 'Rythu Bharosa delay'], te: ['రైతు భరోసా', '#రైతుభరోసా'] },
    'atmiya-bharosa': { en: ['Indiramma Atmiya Bharosa'], te: ['ఆత్మీయ భరోసా'] },
    'paddy-bonus': { en: ['paddy bonus Telangana'], te: ['సన్న వడ్ల బోనస్'] },
    'indiramma-indlu': { en: ['Telangana Indiramma houses'], te: ['ఇందిరమ్మ ఇళ్లు'] },
    'gruha-jyothi': { en: ['Gruha Jyothi', '200 units free power Telangana'], te: ['గృహ జ్యోతి'] },
    'vidya-bharosa': { en: ['Vidya Bharosa card'], te: ['విద్యా భరోసా'] },
    cheyutha: { en: ['Cheyutha pension', '4000 pension Telangana'], te: ['చేయూత పింఛన్'] },
    aarogyasri: { en: ['Aarogyasri Telangana'], te: ['ఆరోగ్యశ్రీ'] },
    'loan-waiver': { en: ['Telangana farmer loan waiver', 'Telangana crop loan waiver pending'], te: ['రుణమాఫీ'] },
    'bhu-bharati': { en: ['Bhu Bharati'], te: ['భూ భారతి'] },
    // the promises as a whole
    _six: { en: ['Congress six guarantees'], te: ['ఆరు గ్యారంటీలు'] },
    // schemes our party built
    'rythu-bandhu': { en: ['Rythu Bandhu', '#RythuBandhu'], te: ['రైతు బంధు', '#రైతుబంధు'] },
    aasara: { en: ['Aasara pensions'], te: ['ఆసరా పెన్షన్లు'] },
    '2bhk': { en: ['double bedroom houses Telangana'], te: ['డబుల్ బెడ్‌రూమ్ ఇళ్లు'] },
    dharani: { en: ['Dharani portal'], te: ['ధరణి పోర్టల్'] },
    'kalyana-lakshmi': { en: ['Kalyana Lakshmi', 'Shaadi Mubarak'], te: ['కల్యాణ లక్ష్మి'] },
    'dalit-bandhu': { en: ['Dalit Bandhu'], te: ['దళిత బంధు'] },
    'rythu-bima': { en: ['Rythu Bima'], te: ['రైతు బీమా'] },
    'kcr-kit': { en: ['KCR Kit'], te: ['కేసీఆర్ కిట్'] },
    'mission-bhagiratha': { en: ['Mission Bhagiratha'], te: ['మిషన్ భగీరథ'] },
    'mission-kakatiya': { en: ['Mission Kakatiya'], te: ['మిషన్ కాకతీయ'] },
    kaleshwaram: { en: ['Kaleshwaram project'], te: ['కాళేశ్వరం ప్రాజెక్టు'] },
    'gruha-lakshmi': { en: ['Gruha Lakshmi scheme'], te: ['గృహలక్ష్మి'] },
    'sheep-distribution': { en: ['sheep distribution Telangana'], te: ['గొర్రెల పంపిణీ'] },
    'haritha-haram': { en: ['Haritha Haram'], te: ['హరితహారం'] },
};

const APPLY = process.argv.includes('--apply');

const main = async () => {
    const unknown = Object.keys(TERMS).filter((id) => !id.startsWith('_') && !SCHEME_BY_ID.has(id));
    if (unknown.length) throw new Error(`not in manifestoSchemes.js: ${unknown.join(', ')}`);

    const wanted = [];
    for (const [scheme, langs] of Object.entries(TERMS)) {
        for (const [language, list] of Object.entries(langs)) {
            for (const keyword of list) wanted.push({ scheme, keyword, language, kind: keyword.startsWith('#') ? 'hashtag' : 'keyword' });
        }
    }

    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cgsaga';
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(uri, dbName ? { dbName } : undefined);

    const tally = { active: [], activate: [], add: [] };
    for (const w of wanted) {
        // Statewide keywords only (constituency null); a seat's own copy is left alone.
        const existing = await Keyword.findOne({ keyword: w.keyword, constituency: null, kind: w.kind }).lean();
        if (existing && existing.is_active !== false) { tally.active.push(w); continue; }
        if (existing) tally.activate.push(w); else tally.add.push(w);
        if (APPLY) {
            await Keyword.updateOne(
                { keyword: w.keyword, constituency: null, kind: w.kind },
                {
                    $set: { is_active: true },
                    $setOnInsert: { category: 'other', language: w.language, is_party_wide: true, weight: 50 },
                },
                { upsert: true },
            );
        }
    }

    const show = (label, list) => {
        console.log(`\n${label} (${list.length})`);
        list.forEach((w) => console.log(`  ${w.scheme.padEnd(20)} ${w.language}  ${w.keyword}`));
    };
    show('already active', tally.active);
    show(APPLY ? 'switched on' : 'would switch on (exists, inactive)', tally.activate);
    show(APPLY ? 'added' : 'would add (new)', tally.add);
    console.log(`\n${APPLY ? 'Done' : 'Dry run — nothing written. Re-run with --apply to make these changes.'} `
        + `${tally.activate.length + tally.add.length} keywords ${APPLY ? 'now' : 'would become'} active for the Manifesto tracker.`);
    await mongoose.disconnect();
};

main().catch(async (err) => {
    console.error('[seed-manifesto-kw] failed:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
