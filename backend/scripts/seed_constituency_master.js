/**
 * seed_constituency_master.js
 * ─────────────────────────────────────────────────────────────────────
 * Seeds the ConstituencyMaster collection with all 119 Telangana ACs from
 * src/data/state_voter_profiles.json:
 *   • canonical AC name, current MLA + party (vacant seats get nulls)
 *   • current district (33 districts since 2022), tehsil and Lok Sabha
 *     seat, plus that seat's MP
 *   • town aliases (Hindi / press spellings from src/data/state_geo.json)
 *     for ACs named after their main town, so "Kabirdham" or "कवर्धा" routes
 *     to KAWARDHA
 *
 * Villages are NOT assigned to ACs here: the geography data maps villages to
 * talukas, and a taluka spans several ACs, so any assignment would be a
 * guess. Add verified village lists per AC through the admin API
 * (POST /api/admin/constituency-master/bulk).
 *
 * Idempotent: re-running updates names + party + LS + district but does
 * NOT clobber any mandals / villages / keywords the admin has already
 * customised through the API (use --replace to force overwrite).
 *
 *   node backend/scripts/seed_constituency_master.js
 *   node backend/scripts/seed_constituency_master.js --replace
 *   node backend/scripts/seed_constituency_master.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const ConstituencyMaster = require('../src/models/ConstituencyMaster');
const PROFILES = require('../src/data/state_voter_profiles.json');
const GEO = require('../src/data/state_geo.json');

const normKey = (v) => String(v || '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '').trim();

/** Sitting MPs by Lok Sabha seat (2024 general election), from the roster. */
const { ALLY_MPS, OPPOSITION_MPS } = require('../src/config/politicalData');
const MP_BY_LS = Object.fromEntries(
    [...ALLY_MPS, ...OPPOSITION_MPS]
        .filter((m) => /lok sabha/i.test(m.role || ''))
        .map((m) => [m.constituency, { name: m.name, party: m.party }]),
);

/** Town aliases keyed by the AC they share a name with. */
const TOWN_ALIASES_BY_AC = (() => {
    const map = {};
    for (const t of GEO.towns || []) {
        const names = [t.name, ...(t.aliases || [])];
        for (const p of PROFILES) {
            const ac = normKey(p.constituency);
            if (names.some((n) => normKey(n) === ac)) {
                map[ac] = [...new Set([...(map[ac] || []), ...names.filter((n) => normKey(n) !== ac)])];
            }
        }
    }
    return map;
})();

/* ─── builder ────────────────────────────────────────────────────── */

const buildRow = (p) => {
    const acName = String(p.constituency || '').trim().toUpperCase();
    const acKey = normKey(acName);
    const mp = MP_BY_LS[p.lok_sabha] || null;
    const aliases = TOWN_ALIASES_BY_AC[acKey] || [];
    return {
        ac_name: acName,
        ac_key:  acKey,
        district: p.district || null,
        district_key: p.district ? normKey(p.district) : null,
        lok_sabha: p.lok_sabha || null,
        lok_sabha_key: p.lok_sabha ? normKey(p.lok_sabha) : null,
        mla_name:  p.mla ? p.mla.name : null,
        mla_party: p.mla ? p.mla.party : null,
        mp_name:   mp ? mp.name : null,
        mp_party:  mp ? mp.party : null,
        // `mandals` is the schema's sub-unit list; here the AC's own town
        // (with its alternate spellings) is the only sub-unit we can assert.
        mandals:   aliases.length ? [{ name: acName.charAt(0) + acName.slice(1).toLowerCase(), aliases }] : [],
        villages:  [],
        keywords:  [`#${acKey}`],
        is_active: true,
    };
};

/* ─── main ───────────────────────────────────────────────────────── */

const main = async () => {
    const argv = process.argv.slice(2);
    const replace = argv.includes('--replace');
    const dryRun  = argv.includes('--dry-run');

    const seeds = [];
    const seen = new Set();
    for (const p of PROFILES) {
        const row = buildRow(p);
        if (seen.has(row.ac_key)) continue;
        seen.add(row.ac_key);
        seeds.push(row);
    }

    console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║  SEED · ConstituencyMaster (Telangana)                    ║`);
    console.log(`║  ACs: ${String(seeds.length).padStart(3)}    mode: ${(replace ? 'REPLACE' : 'MERGE  ').padEnd(8)}${dryRun ? '  (DRY-RUN)' : ''}     ║`);
    console.log(`╚═══════════════════════════════════════════════════════════╝\n`);

    if (dryRun) {
        const sample = seeds.find((s) => s.ac_name === 'MARGAO') || seeds[0];
        console.log('Sample (MARGAO):', JSON.stringify(sample, null, 2));
        process.exit(0);
    }

    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cgsaga';
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(uri, dbName ? { dbName } : undefined);

    let created = 0, updated = 0, errors = 0;
    try {
        for (const seed of seeds) {
            try {
                const existing = await ConstituencyMaster.findOne({ ac_key: seed.ac_key });
                if (existing) {
                    // MERGE mode: keep admin-edited mandals/villages/keywords
                    // unless --replace is passed.
                    const patch = {
                        ac_name: seed.ac_name,
                        district: seed.district || existing.district,
                        district_key: seed.district_key || existing.district_key,
                        lok_sabha: seed.lok_sabha || existing.lok_sabha,
                        lok_sabha_key: seed.lok_sabha_key || existing.lok_sabha_key,
                        mla_name: seed.mla_name,
                        mla_party: seed.mla_party,
                        mp_name: seed.mp_name,
                        mp_party: seed.mp_party,
                        updated_at: new Date(),
                    };
                    if (replace) {
                        patch.mandals  = seed.mandals;
                        patch.villages = seed.villages;
                        patch.keywords = seed.keywords;
                    } else {
                        if ((existing.mandals  || []).length === 0 && seed.mandals.length  > 0) patch.mandals  = seed.mandals;
                        if ((existing.keywords || []).length === 0 && seed.keywords.length > 0) patch.keywords = seed.keywords;
                    }
                    await ConstituencyMaster.updateOne({ ac_key: seed.ac_key }, { $set: patch });
                    updated += 1;
                } else {
                    seed.created_at = new Date();
                    seed.updated_at = new Date();
                    await ConstituencyMaster.create(seed);
                    created += 1;
                }
            } catch (err) {
                errors += 1;
                console.error(`  ✖ ${seed.ac_name}: ${err.message}`);
            }
        }
    } finally {
        await mongoose.disconnect();
    }

    console.log(`\n┌─ SUMMARY ────────────────┐`);
    console.log(`│  created : ${String(created).padStart(5)}         │`);
    console.log(`│  updated : ${String(updated).padStart(5)}         │`);
    console.log(`│  errors  : ${String(errors).padStart(5)}         │`);
    console.log(`└──────────────────────────┘\n`);
    process.exit(errors === 0 ? 0 : 1);
};

main().catch((err) => { console.error('[seed] crashed:', err); process.exit(1); });
