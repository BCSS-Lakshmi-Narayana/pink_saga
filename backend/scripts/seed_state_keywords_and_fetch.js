/**
 * seed_state_keywords_and_fetch.js
 * ─────────────────────────────────────────────────────────────────────
 * One-shot bootstrap of the Keyword collection for the Telangana deployment:
 * leaders, parties, verified handles, campaign hashtags and the issues
 * Telangana political posts revolve around — for both camps, so attacks on the
 * government are caught too. Idempotent — re-running is safe.
 *
 * Monitored ACCOUNTS are seeded separately: `npm run seed:sources`.
 *
 * With --fetch, runs grievanceService.fetchKeywordGrievances for an
 * immediate pull instead of waiting for the scheduler.
 *
 *   node backend/scripts/seed_state_keywords_and_fetch.js
 *   node backend/scripts/seed_state_keywords_and_fetch.js --fetch
 *   node backend/scripts/seed_state_keywords_and_fetch.js --fetch --platform x
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const Keyword = require('../src/models/Keyword');

const RUN_FETCH = process.argv.includes('--fetch');
const platformArgIdx = process.argv.indexOf('--platform');
const PLATFORM = platformArgIdx >= 0 ? process.argv[platformArgIdx + 1] : null;

const KEYWORDS = [
    // Our leadership (full names only — bare surnames such as "Rao" or "Reddy"
    // are shared by millions in Telangana)
    'K Chandrashekar Rao', 'KCR', 'Chandrashekar Rao', 'K T Rama Rao', 'KTR',
    'Harish Rao', 'Thanneeru Harish Rao', 'Sabitha Indra Reddy', 'Talasani Srinivas Yadav',
    'Kotha Prabhakar Reddy', 'Santosh Kumar', 'Vaddiraju Ravichandra',

    // The government we are against — first-class targets, not an afterthought
    'Revanth Reddy', 'Anumula Revanth Reddy', 'Telangana CM', 'Bhatti Vikramarka',
    'Uttam Kumar Reddy', 'Sridhar Babu', 'Ponguleti Srinivasa Reddy', 'Komatireddy Venkat Reddy',
    'Damodar Raja Narasimha', 'Seethakka', 'Ponnam Prabhakar', 'Jupally Krishna Rao',
    'Mahesh Kumar Goud', 'Gaddam Prasad Kumar',

    // Parties
    'BRS', 'Bharat Rashtra Samithi', 'Telangana Congress', 'TPCC', 'BJP Telangana',
    'Telangana BJP', 'AIMIM', 'Telangana Rakshana Sena',

    // Rival leaders
    'Kishan Reddy', 'Bandi Sanjay', 'Ramchander Rao', 'Eatala Rajender', 'DK Aruna',
    'Asaduddin Owaisi', 'Akbaruddin Owaisi', 'Raja Singh', 'K Kavitha', 'Kavitha Kalvakuntla',

    // Verified handles (read from live profile bios; unverified ones omitted)
    '@BRSparty', '@KTRBRS', '@BRSHarish', '@KCRBRSPresident', '@RaoKavitha',
    '@revanth_anumula', '@TelanganaCMO', '@INCTelangana', '@Bhatti_Mallu',
    '@BJP4Telangana', '@kishanreddybjp', '@bandisanjay_bjp', '@Eatala_Rajender',
    '@Tigerrajasingh', '@asadowaisi', '@aimim_national', '@AkbarOwaisi_MIM',

    // Campaign hashtags
    '#BRS', '#KCR', '#KTR', '#Telangana', '#RythuBharosa', '#Kaleshwaram',

    // Issues — English
    'Kaleshwaram', 'Medigadda', 'phone tapping', 'Formula E', 'Dharani', 'Bhu Bharati',
    'Rythu Bandhu', 'Rythu Bharosa', 'Dalit Bandhu', 'Mission Bhagiratha', 'Indiramma Indlu',
    'Gruha Jyothi', 'HYDRAA', 'Musi riverfront', 'BC reservation', 'loan waiver',
    'TGPSC', 'paper leak', 'Khairatabad by-election', 'unemployment Telangana',

    // Issues — Telugu
    'కేసీఆర్', 'కేటీఆర్', 'బీఆర్ఎస్', 'హరీష్ రావు', 'రేవంత్ రెడ్డి',
    'కాంగ్రెస్', 'తెలంగాణ', 'కాళేశ్వరం', 'రైతు భరోసా', 'రైతుబంధు',
    'ధరణి', 'భూభారతి', 'నిరుద్యోగం', 'రుణమాఫీ', 'ఫోన్ ట్యాపింగ్',
];

async function upsertKeywords() {
    let added = 0, reactivated = 0, kept = 0;
    for (const raw of KEYWORDS) {
        const kw = String(raw).trim();
        if (!kw) continue;
        let kind = 'keyword';
        if (kw.startsWith('@')) kind = 'handle';
        else if (kw.startsWith('#')) kind = 'hashtag';

        const existing = await Keyword.findOne({ keyword: kw, kind });
        if (existing) {
            if (!existing.is_active) {
                existing.is_active = true;
                await existing.save();
                reactivated += 1;
            } else {
                kept += 1;
            }
            continue;
        }
        await Keyword.create({
            keyword: kw,
            kind,
            category: 'other',
            language: 'all',
            is_party_wide: true,
            is_active: true,
            owner_user_id: 'system_seed',
            weight: 5,
        });
        added += 1;
    }
    return { added, reactivated, kept };
}

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`[seed-cg] connected (db=${dbName || 'default'})`);

    const summary = await upsertKeywords();
    console.log('[seed-cg] keywords:', summary);

    if (RUN_FETCH) {
        const grievanceService = require('../src/services/grievanceService');
        console.log(`[seed-cg] running fetchKeywordGrievances(${PLATFORM ? `'${PLATFORM}'` : 'null /* ALL platforms */'})`);
        const t0 = Date.now();
        try {
            const result = await grievanceService.fetchKeywordGrievances(PLATFORM);
            console.log('[seed-cg] fetch result:', result, 'ms:', Date.now() - t0);
        } catch (err) {
            console.error('[seed-cg] fetch failed:', err.message);
        }
    } else {
        console.log('[seed-cg] (skip fetch — re-run with --fetch to pull content immediately)');
    }

    await mongoose.disconnect();
    console.log('[seed-cg] done');
}

main().catch((err) => { console.error('[seed-cg] failed:', err); process.exit(1); });
