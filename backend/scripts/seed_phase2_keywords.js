/**
 * seed_phase2_keywords.js
 * ─────────────────────────────────────────────────────────────────
 * Phase 2 keyword / hashtag expansion for the BRS deployment. ADDITIVE and idempotent: it only upserts
 * (keyword, kind, constituency=null) rows that are missing, never edits or deletes an existing row, so it is
 * safe to re-run and safe alongside seed_brs_keywords.js.
 *
 *   node backend/scripts/seed_phase2_keywords.js            # write
 *   node backend/scripts/seed_phase2_keywords.js --dry-run  # report only, no DB writes
 *
 * Design rules (to keep the X / Facebook / Instagram fetch budget for signal, not noise):
 *   - no bare generic words ("government", "minister", "scam", "Rao", "Reddy");
 *   - every term names a Telangana actor, scheme or live issue, or is a qualified phrase;
 *   - Telugu script + Roman transliteration + common misspellings are listed separately because the
 *     platforms match them as different strings;
 *   - TRS appears ONLY as a historical/contextual term ("TRS" alone collides with other uses);
 *   - category follows the deployment's TOPIC buckets (see seed_brs_keywords.js):
 *       violence = confrontation framing, threat = attacks on the government's record,
 *       hate = hostile narratives aimed at our leadership, other = leaders / schemes / issues / hashtags.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Keyword = require('../src/models/Keyword');

const KEYWORDS = {
    other: {
        en: [
            // party + historical name (contextual)
            'BRS Party', 'BRS Telangana', 'Pink Party', 'Telangana Rashtra Samithi', 'TRS BRS rename',
            'Telangana Bhavan', 'BRS working president', 'BRS MLAs', 'BRS MLC',
            // leaders (full names + spellings used in captions)
            'Kalvakuntla Chandrashekar Rao', 'Kalvakuntla Taraka Rama Rao', 'KT Rama Rao', 'KTR garu', 'KCR garu',
            'Harish Rao Thanneeru', 'Harish Rao garu', 'Harish Anna', 'Kavitha Kalvakuntla',
            'Santosh Kumar Joginapally', 'Vinod Kumar Boinapalli', 'Jagadish Reddy Guntakandla',
            'Talasani Srinivas Yadav', 'Sabitha Indra Reddy', 'Sridhar Reddy Pailla', 'Gangula Kamalakar',
            'Errabelli Dayakar Rao', 'Niranjan Reddy Singireddy', 'Koppula Eshwar', 'Puvvada Ajay Kumar',
            'Vemula Prashanth Reddy', 'Mahmood Ali Telangana', 'Manne Krishank', 'Dasoju Sravan',
            'RS Praveen Kumar', 'Balka Suman', 'Gutha Sukender Reddy', 'Palla Rajeshwar Reddy',
            // schemes / record
            'Rythu Bandhu', 'Rythu Bima', 'Dalit Bandhu', 'Kalyana Lakshmi', 'Shaadi Mubarak',
            'Aasara pensions', 'KCR Kit', 'Mission Kakatiya', 'Mission Bhagiratha', 'Kaleshwaram project',
            'Palamuru Rangareddy lift', 'Yadadri temple KCR', 'Telangana Secretariat KCR', 'Dharani portal',
            'TS-iPASS', 'T-Hub', 'Telangana 24x7 power',
            // live issues the client campaigns on
            'Telangana urea shortage', 'Telangana farmers protest', 'Rythu Bharosa delay',
            'Telangana crop loan waiver pending', 'Telangana paddy procurement', 'Telangana job calendar',
            'Group 1 aspirants Telangana', 'TGPSC Group 1', 'Telangana DSC', 'Telangana fee reimbursement dues',
            'Gurukul food poisoning Telangana', 'HYDRAA demolitions', 'Musi riverfront displacement',
            'Telangana BC reservation 42 percent', 'Telangana local body elections', 'Telangana Congress 6 guarantees',
            'Telangana Praja Palana', 'Telangana Indiramma houses', 'Telangana power cuts',
            'Telangana SC ST sub-classification',
            // what other actors say about BRS
            'Congress slams BRS', 'BJP slams BRS', 'Owaisi BRS', 'Revanth Reddy KCR', 'Bandi Sanjay KTR',
            'BRS BJP merger', 'BRS BJP secret deal', 'KTR arrest',
        ],
        te: [
            'బీఆర్ఎస్ పార్టీ', 'భారత రాష్ట్ర సమితి', 'టీఆర్ఎస్', 'గులాబీ పార్టీ', 'గులాబీ దళపతి', 'తెలంగాణ భవన్',
            'కల్వకుంట్ల చంద్రశేఖర రావు', 'కల్వకుంట్ల తారక రామారావు', 'కేటీఆర్ గారు', 'కేసీఆర్ గారు',
            'హరీశ్ రావు', 'హరీష్ రావు', 'కల్వకుంట్ల కవిత', 'జగదీష్ రెడ్డి', 'సబితా ఇంద్రారెడ్డి', 'తలసాని శ్రీనివాస్ యాదవ్',
            'గంగుల కమలాకర్', 'ఎర్రబెల్లి దయాకర్ రావు', 'నిరంజన్ రెడ్డి', 'పువ్వాడ అజయ్', 'వేముల ప్రశాంత్ రెడ్డి',
            'రైతు బంధు', 'రైతు బీమా', 'దళిత బంధు', 'కళ్యాణలక్ష్మి', 'ఆసరా పెన్షన్లు', 'కేసీఆర్ కిట్', 'మిషన్ కాకతీయ',
            'మిషన్ భగీరథ', 'కాళేశ్వరం ప్రాజెక్టు', 'ధరణి పోర్టల్',
            'యూరియా కొరత', 'రైతు భరోసా', 'రుణమాఫీ', 'పంట రుణాల మాఫీ', 'ధాన్యం కొనుగోలు', 'జాబ్ క్యాలెండర్',
            'గ్రూప్ 1 అభ్యర్థులు', 'ఫీజు రీయింబర్స్‌మెంట్', 'గురుకుల విద్యార్థులు', 'హైడ్రా కూల్చివేతలు',
            'మూసీ బాధితులు', 'బీసీ రిజర్వేషన్లు', 'స్థానిక సంస్థల ఎన్నికలు', 'ఆరు గ్యారంటీలు', 'ఇందిరమ్మ ఇళ్లు',
            'ప్రజాపాలన', 'కాంగ్రెస్ వైఫల్యాలు',
        ],
        // Roman-script Telugu (Telglish) as people actually type it, incl. misspellings
        te_roman: [
            'Kcr garu', 'Ktr anna', 'Harish anna', 'Harishrao', 'Kavitha akka', 'Kaleswaram', 'Kaleshwaram scam',
            'Rythu bandhu', 'Raithu bandhu', 'Rythu bharosa', 'Raithu bharosa', 'Runa mafi', 'Dharani',
            'Indiramma illu', 'Prajapalana', 'Gulabi party', 'Gulabi jenda', 'Telangana bhavan',
        ],
    },
    threat: {
        en: [
            'Congress betrayal Telangana farmers', 'Revanth Reddy failed promises', 'Revanth Reddy lies',
            'Telangana debt Congress government', 'Telangana law and order Congress', 'Telangana farmer suicides',
            'Telangana pension hike not implemented', 'Mahalakshmi scheme Telangana delay',
            'Telangana scholarships pending', 'Telangana Congress corruption', 'Telangana land grab Congress',
            'Telangana liquor policy', 'Telangana Metro phase 2 delay',
            '#CongressBetrayal', '#TelanganaFarmersCrisis', '#RevanthFailedTelangana', '#EmergencyInTelangana',
        ],
        te: [
            'కాంగ్రెస్ మోసం', 'రేవంత్ రెడ్డి అబద్ధాలు', 'రైతులకు కాంగ్రెస్ ద్రోహం', 'హామీల అమలు విఫలం',
            '#కాంగ్రెస్మోసం', '#రైతుద్రోహికాంగ్రెస్',
        ],
    },
    hate: {
        en: [
            'KTR trolls', 'KCR health rumours', 'KTR fake news', 'BRS fake video', 'KTR ACB case',
            'KTR Formula E case', 'Kavitha liquor case', 'Kaleshwaram Commission KCR', 'Phone tapping KTR',
            '#FakeNewsAgainstKTR', '#IStandWithKTR', '#IStandWithKCR',
        ],
        te: ['కేటీఆర్ ఫార్ములా ఈ కేసు', 'కేసీఆర్ కాళేశ్వరం కమిషన్', '#IStandWithKTR'],
    },
    violence: {
        en: [
            'BRS leaders house arrest', 'BRS workers attacked', 'BRS Chalo', 'BRS dharna', 'KTR detained',
            'Harish Rao detained', 'BRS leaders arrested Telangana', 'Congress goons BRS', 'BRS flexi removal',
            '#BRSChalo', '#BRSDharna',
        ],
        te: ['బీఆర్ఎస్ నేతల హౌస్ అరెస్ట్', 'బీఆర్ఎస్ కార్యకర్తలపై దాడి', 'చలో హైదరాబాద్ బీఆర్ఎస్'],
    },
};

// Only this lean core is switched ON at seed time. Every ACTIVE keyword costs ~3 variants x 4 platforms of paid
// RapidAPI calls per keyword-fetch run (grievanceService.fetchKeywordGrievances), so the long tail is added
// INACTIVE and can be enabled from Settings -> Keywords as quota allows.
const ACTIVE_CORE = new Set([
    'BRS Party', 'BRS Telangana', 'Pink Party', 'Telangana Bhavan', 'BRS MLAs',
    'Kalvakuntla Chandrashekar Rao', 'KT Rama Rao', 'Harish Anna', 'Kavitha Kalvakuntla',
    'Rythu Bharosa delay', 'Telangana urea shortage', 'Telangana crop loan waiver pending', 'HYDRAA demolitions',
    'Congress slams BRS', 'BJP slams BRS', 'Revanth Reddy KCR', 'BRS BJP secret deal',
    'Revanth Reddy failed promises', 'Congress betrayal Telangana farmers',
    'బీఆర్ఎస్ పార్టీ', 'గులాబీ పార్టీ', 'కేటీఆర్ గారు', 'కేసీఆర్ గారు', 'హరీశ్ రావు', 'యూరియా కొరత', 'రుణమాఫీ',
    'Kcr garu', 'Ktr anna', 'Harish anna', 'Gulabi party',
    '#CongressBetrayal', '#IStandWithKTR', '#BRSChalo',
]);

const LANG_OF = { en: 'en', te: 'te', te_roman: 'all' };
const kindOf = (kw) => (kw.startsWith('#') ? 'hashtag' : kw.startsWith('@') ? 'handle' : 'keyword');

(async () => {
    const dry = process.argv.includes('--dry-run');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    const tally = {};
    let total = 0;
    let activated = 0;
    for (const [category, byLang] of Object.entries(KEYWORDS)) {
        tally[category] = { added: 0, kept: 0 };
        for (const [langKey, list] of Object.entries(byLang)) {
            for (const keyword of [...new Set(list)]) {
                total += 1;
                const kind = kindOf(keyword);
                const exists = await Keyword.exists({ keyword, kind, constituency: null });
                if (exists) { tally[category].kept += 1; continue; }
                if (!dry) {
                    await Keyword.updateOne(
                        { keyword, kind, constituency: null },
                        {
                            $setOnInsert: {
                                category, language: LANG_OF[langKey] || 'en', is_party_wide: true, is_active: ACTIVE_CORE.has(keyword),
                            },
                        },
                        { upsert: true },
                    );
                }
                tally[category].added += 1;
                if (ACTIVE_CORE.has(keyword)) activated += 1;
            }
        }
    }
    const count = await Keyword.countDocuments({});
    console.log(`${dry ? '[dry-run] would add' : 'added'} per category:`, JSON.stringify(tally));
    console.log(`of the added terms, ${activated} are ACTIVE (core); the rest are inactive until enabled in Settings -> Keywords`);
    console.log(`considered ${total} terms; keywords collection now has ${count} rows`);
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
