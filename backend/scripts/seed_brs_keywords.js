/**
 * seed_brs_keywords.js
 * ─────────────────────────────────────────────────────────────────────
 * Curated BRS monitoring keywords for Settings → Keywords, grouped into the
 * four categories the UI offers. Idempotent — re-running is safe.
 *
 * Category here is a TOPIC bucket for this deployment, not a literal reading:
 *   violence — confrontation / clash framing (X vs Y, protests, suspensions)
 *   threat   — attacks on the government and its record (charge sheet, failures)
 *   hate     — personalised / hostile narratives aimed at our leadership
 *   other    — leaders, schemes, jobs, elections, farmers, campaign hashtags
 *
 *   node backend/scripts/seed_brs_keywords.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Keyword = require('../src/models/Keyword');

const KEYWORDS = {
    violence: {
        en: [
            'BRS vs Congress', 'KTR vs Revanth Reddy', 'KCR vs Revanth Reddy',
            'KTR Assembly protest', 'BRS MLAs suspension', 'Telangana political crisis',
            '#BRSvsCongress',
        ],
        te: [],
    },
    threat: {
        en: [
            'BRS charge sheet', 'Congress 1000 days Telangana', 'Congress failures Telangana',
            'Congress unfulfilled promises', 'Congress six guarantees',
            'Congress anti-incumbency Telangana', 'Revanth Reddy government',
            '#BRSChargeSheet', '#CongressFailures', '#Congress1000Days', '#SaveTelangana',
        ],
        te: ['#కాంగ్రెస్‌వైఫల్యం'],
    },
    hate: {
        en: [
            'KTR AI images', 'KTR Formula E', 'KCR farmhouse', 'BRS BJP alliance',
            'Manne Krishank', 'BRS social media',
        ],
        te: [],
    },
    other: {
        en: [
            'BRS Telangana', 'Bharat Rashtra Samithi', 'KCR', 'K Chandrashekar Rao', 'KTR',
            'KT Rama Rao', 'Harish Rao', 'BRS comeback Telangana',
            'Rythu Bandhu', 'Rythu Bima', 'Kaleshwaram project', 'Mission Bhagiratha',
            'Telangana jobs', 'TSPSC', 'Telangana unemployment',
            'Telangana elections', 'GHMC elections', 'SIR Telangana',
            'Telangana farmers', 'Telangana rice prices', 'Telangana farmer loan waiver',
            '#BRS', '#KCR', '#KTR', '#BRSComeback', '#KCRComeback', '#RythuBandhu',
            '#RythuBharosa', '#TelanganaPolitics', '#TelanganaElections2026', '#GHMCElections',
        ],
        te: [
            '#బీఆర్‌ఎస్', '#కేసీఆర్', '#కేటీఆర్', '#హరీష్‌రావు', '#తెలంగాణరాజకీయాలు',
            '#రైతుబంధు', '#రైతుభరోసా', '#నిరుద్యోగం',
        ],
    },
};

/**
 * Place-bearing keywords. A grievance's location is read from the post text
 * (the fetch never stamps a keyword's place on it), so these pull posts that
 * NAME a place — which is what lets the classifier tag a district/constituency.
 * Kept to a few big centres; each keyword costs one search per platform.
 */
KEYWORDS.other.en.push(
    'Hyderabad water problem', 'Hyderabad roads', 'Hyderabad flooding', 'HYDRAA Hyderabad',
    'Musi riverfront', 'Warangal', 'Karimnagar', 'Nizamabad', 'Khammam', 'Sircilla',
    'Siddipet', 'Gajwel', 'Mahabubnagar', 'Nalgonda', 'Adilabad', 'Secunderabad',
);
KEYWORDS.other.te.push('హైదరాబాద్', 'వరంగల్', 'కరీంనగర్', 'సిరిసిల్ల', 'సిద్దిపేట');

const kindOf = (kw) => (kw.startsWith('#') ? 'hashtag' : kw.startsWith('@') ? 'handle' : 'keyword');

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('MONGODB_URI missing');
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(uri, dbName ? { dbName } : undefined);
    console.log(`[seed-brs-kw] connected (db=${mongoose.connection.name})`);

    const tally = {};
    for (const [category, byLang] of Object.entries(KEYWORDS)) {
        tally[category] = { added: 0, kept: 0 };
        for (const [language, list] of Object.entries(byLang)) {
            for (const raw of list) {
                const keyword = raw.trim();
                const kind = kindOf(keyword);
                const res = await Keyword.updateOne(
                    { keyword, kind, constituency: null },
                    {
                        $setOnInsert: {
                            id: require('uuid').v4(),
                            category, language, is_party_wide: true, is_active: true,
                            owner_user_id: 'system_seed', weight: 50, created_at: new Date(),
                        },
                    },
                    { upsert: true },
                );
                tally[category][res.upsertedCount ? 'added' : 'kept'] += 1;
            }
        }
    }
    console.log('[seed-brs-kw] result:', tally);
    console.log('[seed-brs-kw] total in DB:', await Keyword.countDocuments());
    await mongoose.disconnect();
}

main().catch((e) => { console.error('[seed-brs-kw] failed:', e); process.exit(1); });
