#!/usr/bin/env node
/**
 * seed_grievance_tracking.js
 * ─────────────────────────────────────────────────────────────────────
 * Seeds Mentions (grievance) tracking for the Telangana deployment:
 *
 *   1. Tracked accounts (Grievances → Sources) — posts that TAG or MENTION
 *      these are fetched. 5 per platform (the app's cap). Added the same way
 *      the UI adds them: X handles are looked up through BluGate for the user
 *      id / name / avatar; Facebook pages are resolved to their numeric page id.
 *   2. Tracking keywords (Grievances → Tracking Keywords, also listed on the
 *      Settings page — both read the same `keywords` collection). Same shape the
 *      UI writes: category 'other', weight 75, party-wide, active; language
 *      'hi' for Devanagari, 'en' for Latin text, 'all' for @handles/#hashtags;
 *      `kind` handle / hashtag / keyword.
 *
 * Idempotent: existing accounts and keywords are left as they are (an inactive
 * keyword is re-activated). Nothing is deleted.
 *
 *   node scripts/seed_grievance_tracking.js --dry-run   show the plan, write nothing
 *   node scripts/seed_grievance_tracking.js             seed accounts + keywords
 *   node scripts/seed_grievance_tracking.js --keywords-only
 *   node scripts/seed_grievance_tracking.js --sources-only
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const Keyword = require('../src/models/Keyword');
const GrievanceSource = require('../src/models/GrievanceSource');

const DRY = process.argv.includes('--dry-run');
const ONLY_KW = process.argv.includes('--keywords-only');
const ONLY_SRC = process.argv.includes('--sources-only');
const MAX_SOURCES_PER_PLATFORM = 5; // mirrors grievanceController

/* ─── 1. Tracked accounts (verified: data/state_leader_handles.json) ── */
const SOURCES = [
    // Every handle below was read from a live profile bio before inclusion.
    // ⚠ Mixed camps on purpose: our client is in OPPOSITION, so the
    // government's own channels are tracked targets, not our publicity.
    // X — ours
    { platform: 'x', handle: 'BRSparty', display_name: 'BRS Party', designation: 'Party' },
    { platform: 'x', handle: 'KTRBRS', display_name: 'K. T. Rama Rao', designation: 'Working President, BRS' },
    { platform: 'x', handle: 'BRSHarish', display_name: 'T. Harish Rao', designation: 'Deputy Leader, BRS Legislature Party' },
    { platform: 'x', handle: 'KCRBRSPresident', display_name: 'K. Chandrashekar Rao', designation: 'President, BRS; Leader of the Opposition' },
    // X — the government
    { platform: 'x', handle: 'revanth_anumula', display_name: 'A. Revanth Reddy', designation: 'Chief Minister of Telangana' },
    { platform: 'x', handle: 'TelanganaCMO', display_name: 'Telangana CMO', designation: "Chief Minister's Office" },
    { platform: 'x', handle: 'INCTelangana', display_name: 'Telangana Congress', designation: 'Ruling party' },
    // X — other rivals
    { platform: 'x', handle: 'BJP4Telangana', display_name: 'BJP Telangana', designation: 'Party' },
    { platform: 'x', handle: 'RaoKavitha', display_name: 'K. Kavitha', designation: 'Founder & President, Telangana Rakshana Sena' },
    { platform: 'x', handle: 'asadowaisi', display_name: 'Asaduddin Owaisi', designation: 'National President, AIMIM' },
    // Facebook
    { platform: 'facebook', handle: 'BRSParty', display_name: 'BRS Party', designation: 'Party' },
    { platform: 'facebook', handle: 'TrsHarish', display_name: 'T. Harish Rao', designation: 'Deputy Leader, BRS Legislature Party' },
    { platform: 'facebook', handle: 'TelanganaCMO', display_name: 'Telangana CMO', designation: "Chief Minister's Office" },
    { platform: 'facebook', handle: 'BJP4Telangana', display_name: 'BJP Telangana', designation: 'Party' },
];

/* ─── 2. Tracking keywords ────────────────────────────────────────── */
const KEYWORDS = [
    // Our leadership — English
    'K Chandrashekar Rao', 'KCR', 'Chandrashekar Rao', 'K T Rama Rao', 'KTR',
    'Harish Rao', 'Thanneeru Harish Rao', 'BRS', 'Bharat Rashtra Samithi',
    // The government we are against — English
    'Revanth Reddy', 'Telangana CM', 'Bhatti Vikramarka', 'Uttam Kumar Reddy',
    'Sridhar Babu', 'Ponguleti Srinivasa Reddy', 'Seethakka', 'Telangana Congress', 'TPCC',
    // Other rivals
    'Kishan Reddy', 'Bandi Sanjay', 'Eatala Rajender', 'Asaduddin Owaisi', 'Akbaruddin Owaisi',
    'Raja Singh', 'K Kavitha', 'Telangana Rakshana Sena', 'BJP Telangana', 'AIMIM',
    // Leaders — Telugu
    'కేసీఆర్', 'కేటీఆర్', 'హరీష్ రావు', 'రేవంత్ రెడ్డి',
    'బీఆర్ఎస్', 'కాంగ్రెస్', 'తెలంగాణ ప్రభుత్వం', 'కవిత',
    // Verified handles (posts that tag them)
    '@BRSparty', '@KTRBRS', '@BRSHarish', '@KCRBRSPresident', '@RaoKavitha',
    '@revanth_anumula', '@TelanganaCMO', '@INCTelangana', '@Bhatti_Mallu',
    '@BJP4Telangana', '@kishanreddybjp', '@bandisanjay_bjp', '@Eatala_Rajender',
    '@Tigerrajasingh', '@asadowaisi', '@aimim_national',
    // Attack lines we press — Telugu / romanised
    'రైతు భరోసా మోసం', 'రుణమాఫీ లేదు', 'నిరుద్యోగం', 'హామీలు నెరవేర్లేదు',
    'congress failed', 'broken promises', 'rythu bharosa delay',
    // Attack lines pressed against US — tracked because we must see them
    'Kaleshwaram', 'Medigadda', 'phone tapping', 'Formula E', 'Dharani',
    // Issues — English
    'paddy procurement', 'fertilizer shortage', 'electricity bill', 'loan waiver',
    'Bhu Bharati', 'HYDRAA', 'Musi', 'BC reservation', 'TGPSC', 'paper leak',
    // Hashtags
    '#BRS', '#KCR', '#KTR', '#RythuBharosa', '#Kaleshwaram', '#SaveMusi',
];

const kindOf = (kw) => (kw.startsWith('@') ? 'handle' : kw.startsWith('#') ? 'hashtag' : 'keyword');
const languageOf = (kw) => {
    if (kw.startsWith('@') || kw.startsWith('#')) return 'all';
    return /[ऀ-ॿ]/.test(kw) ? 'hi' : 'en';
};

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function seedKeywords() {
    const out = { added: 0, reactivated: 0, kept: 0 };
    const seen = new Set();
    for (const raw of KEYWORDS) {
        const keyword = String(raw).trim();
        const kind = kindOf(keyword);
        const dedupe = `${kind}:${keyword.toLowerCase()}`;
        if (!keyword || seen.has(dedupe)) continue;
        seen.add(dedupe);

        const existing = await Keyword.findOne({
            keyword: { $regex: new RegExp(`^${escapeRx(keyword)}$`, 'i') },
            kind,
            constituency: null,
        });
        if (existing) {
            if (!existing.is_active) {
                out.reactivated += 1;
                if (!DRY) { existing.is_active = true; await existing.save(); }
                console.log(`  REACTIVATE ${kind.padEnd(8)} ${keyword}`);
            } else {
                out.kept += 1;
            }
            continue;
        }
        out.added += 1;
        console.log(`  ADD        ${kind.padEnd(8)} ${languageOf(keyword).padEnd(3)} ${keyword}`);
        if (!DRY) {
            await Keyword.create({
                keyword,
                kind,
                category: 'other',
                language: languageOf(keyword),
                weight: 75,
                is_party_wide: true,
                constituency: null,
                is_active: true,
                owner_user_id: 'system_seed',
            });
        }
    }
    return out;
}

async function seedSources() {
    // Loaded lazily: they reach BluGate, which the keyword-only path never needs.
    const grievanceService = require('../src/services/grievanceService');
    const rapidApiFacebookService = require('../src/services/rapidApiFacebookService');
    const out = { added: 0, kept: 0, skipped_cap: 0, lookup_failed: 0 };

    for (const s of SOURCES) {
        const clean = s.handle.replace(/^@/, '').trim();
        const existing = await GrievanceSource.findOne({
            platform: s.platform,
            $or: [
                { handle: { $regex: new RegExp(`^@?${escapeRx(clean)}$`, 'i') } },
                { display_name: s.display_name },
            ],
        });
        if (existing) { out.kept += 1; console.log(`  KEEP   ${s.platform.padEnd(8)} ${s.handle}`); continue; }

        const count = await GrievanceSource.countDocuments({ platform: s.platform });
        if (count >= MAX_SOURCES_PER_PLATFORM) {
            out.skipped_cap += 1;
            console.log(`  SKIP   ${s.platform.padEnd(8)} ${s.handle} — ${MAX_SOURCES_PER_PLATFORM} ${s.platform} accounts already tracked`);
            continue;
        }

        let profile = null;
        let finalHandle = s.platform === 'x' ? `@${clean}` : clean;
        if (!DRY) {
            try {
                if (s.platform === 'x') {
                    profile = await grievanceService.fetchUserProfile(clean);
                } else {
                    profile = await rapidApiFacebookService.fetchPageDetails(clean);
                    if (profile?.id) finalHandle = String(profile.id);
                }
            } catch (err) {
                console.warn(`    lookup failed for ${s.handle}: ${err.message}`);
            }
            if (!profile) out.lookup_failed += 1;
        }

        out.added += 1;
        console.log(`  ADD    ${s.platform.padEnd(8)} ${s.handle}${finalHandle !== s.handle && finalHandle !== `@${clean}` ? ` → ${finalHandle}` : ''}${DRY ? '' : profile ? ' (profile found)' : ' (profile lookup failed — saved with the name below)'}`);
        if (!DRY) {
            await GrievanceSource.create({
                handle: finalHandle,
                display_name: s.display_name || profile?.name || clean,
                profile_image_url: profile?.profileImageUrl || profile?.image,
                x_user_id: s.platform === 'x' ? profile?.id : undefined,
                is_verified: profile?.isVerified || profile?.is_verified || false,
                department: 'Government',
                designation: s.designation,
                platform: s.platform,
                created_by: 'system_seed',
            });
        }
    }
    return out;
}

(async () => {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing in backend/.env');
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
    console.log(`${DRY ? '[DRY RUN] ' : ''}Seeding Mentions tracking into db "${process.env.DB_NAME}"\n`);

    if (!ONLY_KW) {
        console.log('Tracked accounts:');
        const s = await seedSources();
        console.log(`  → added ${s.added}, already there ${s.kept}, skipped (cap) ${s.skipped_cap}${DRY ? '' : `, profile lookups failed ${s.lookup_failed}`}\n`);
    }
    if (!ONLY_SRC) {
        console.log('Tracking keywords:');
        const k = await seedKeywords();
        console.log(`  → added ${k.added}, re-activated ${k.reactivated}, already there ${k.kept}\n`);
    }
    console.log(DRY ? 'Dry run — nothing written.' : 'Done. The Mentions auto-fetch picks these up on its next run (every 10–30 min).');
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
