/**
 * enrich_constituency_master.js
 * ─────────────────────────────────────────────────────────────────────
 * Adds matching tokens to ConstituencyMaster so the location classifier can
 * place more posts. Only data that can be traced is added:
 *
 *   1. Telugu constituency names (src/data/state_constituency_aliases.json) →
 *      each AC's `keywords`, so Telugu posts naming a seat match it.
 *   2. Towns (src/data/state_geo.json) → an AC's `mandals`, but ONLY when
 *      (a) the town's district has exactly one AC, or (b) the town's name is
 *      the AC's own name (adds its Telugu name + aliases). Towns in a
 *      multi-seat district are left to the district-level fallback — assigning
 *      them to a seat would be a guess, and a wrong seat puts a post on the
 *      wrong MLA's dashboard.
 *   3. A short, hand-picked list of Hyderabad-area localities that sit
 *      unambiguously inside one seat → that AC's `villages`. Review this list
 *      (LOCALITIES below) before applying; localities that straddle seats
 *      (Banjara Hills, Ameerpet, Dilsukhnagar, Tarnaka …) are deliberately left out.
 *
 * Idempotent (adds only what is missing, never removes). The classifier's
 * alias cache is rebuilt on the next server start / write.
 *
 *   node scripts/enrich_constituency_master.js --dry-run
 *   node scripts/enrich_constituency_master.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const ConstituencyMaster = require('../src/models/ConstituencyMaster');
const GEO = require('../src/data/state_geo.json');
const ALIASES = require('../src/data/state_constituency_aliases.json').aliases || {};

const DRY = process.argv.includes('--dry-run');
const normKey = ConstituencyMaster.normKey;

/** AC (as named in the master) → localities lying wholly inside it. */
const LOCALITIES = {
    'SERILINGAMPALLY': ['Gachibowli', 'Madhapur', 'HITEC City', 'Hitech City', 'Kondapur', 'Miyapur', 'Chandanagar', 'Lingampally', 'Hafeezpet', 'Nallagandla'],
    'KUKATPALLE': ['KPHB', 'Kukatpally Housing Board', 'Nizampet', 'Moosapet', 'Balanagar'],
    'JUBILEE HILLS': ['Film Nagar', 'Yousufguda', 'Borabanda'],
    'UPPAL': ['Nacharam', 'Habsiguda', 'Ramanthapur'],
    'LAL BAHADUR NAGAR': ['LB Nagar', 'Vanasthalipuram'],
    'CHARMINAR': ['Laad Bazaar'],
    'RAJENDRANAGAR': ['Attapur'],
    'QUTHBULLAPUR': ['Jeedimetla', 'Suraram', 'Bachupally'],
    'KHAIRATABAD': ['Somajiguda', 'Panjagutta'],
    'SANATHNAGAR': ['Erragadda'],
    'MUSHEERABAD': ['Chikkadpally'],
    'AMBERPET': ['Kachiguda'],
    'MALAKPET': ['Saidabad', 'Chaderghat'],
};

/** Roster keys whose master name carries a "(URBAN)" / "(STATION)" suffix that normKey strips. */
const ROSTER_KEY_TO_MASTER = { nizamabadurban: 'NIZAMABAD (URBAN)', ghanpurstation: 'GHANPUR (STATION)' };

const uniq = (arr) => [...new Set(arr.filter(Boolean).map((s) => String(s).trim()).filter(Boolean))];

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
    console.log(`${DRY ? '[DRY RUN] ' : ''}Enriching ConstituencyMaster in "${process.env.DB_NAME}"\n`);

    const rows = await ConstituencyMaster.find({});
    const byKey = new Map(rows.map((r) => [normKey(r.ac_name), r]));
    const byDistrict = new Map();
    for (const r of rows) {
        const k = normKey(r.district);
        byDistrict.set(k, [...(byDistrict.get(k) || []), r]);
    }
    const touched = new Set();
    const stats = { teluguKeywords: 0, teluguUnmatched: [], townsAdded: 0, townAliasesAdded: 0, localitiesAdded: 0, localitiesUnmatched: [] };

    // 1. Telugu / alternate seat names
    for (const [spelling, rosterKey] of Object.entries(ALIASES)) {
        const row = byKey.get(normKey(ROSTER_KEY_TO_MASTER[rosterKey] || rosterKey));
        if (!row) { stats.teluguUnmatched.push(`${spelling}→${rosterKey}`); continue; }
        if (!/[ఀ-౿]/.test(spelling)) continue; // Latin spellings already match via ac_name
        if (!row.keywords.includes(spelling)) { row.keywords.push(spelling); stats.teluguKeywords += 1; touched.add(row); }
    }

    // 2. Towns
    for (const t of GEO.towns || []) {
        const names = uniq([t.name, t.telugu, ...(t.aliases || [])]);
        const sameName = byKey.get(normKey(t.name));
        const inDistrict = byDistrict.get(normKey(t.district)) || [];
        const target = sameName || (inDistrict.length === 1 ? inDistrict[0] : null);
        if (!target) continue;

        let m = target.mandals.find((x) => normKey(x.name) === normKey(t.name));
        if (!m) {
            // Seat named after the town and the town is already covered by ac_name: still record aliases.
            m = { name: t.name, aliases: [] };
            target.mandals.push(m);
            stats.townsAdded += 1;
            touched.add(target);
        }
        for (const n of names) {
            if (normKey(n) === normKey(m.name) && n === m.name) continue;
            if (!m.aliases.includes(n) && n !== m.name) { m.aliases.push(n); stats.townAliasesAdded += 1; touched.add(target); }
        }
    }

    // 3. Curated localities
    for (const [ac, places] of Object.entries(LOCALITIES)) {
        const row = byKey.get(normKey(ac));
        if (!row) { stats.localitiesUnmatched.push(ac); continue; }
        for (const p of places) {
            if (!row.villages.some((v) => normKey(v.name) === normKey(p))) {
                row.villages.push({ name: p, aliases: [] });
                stats.localitiesAdded += 1;
                touched.add(row);
            }
        }
    }

    console.log(JSON.stringify(stats, null, 2));
    console.log(`\nSeats changed: ${touched.size}`);
    if (!DRY) {
        for (const r of touched) {
            r.markModified('mandals'); r.markModified('villages'); r.markModified('keywords');
            r.updated_by = 'enrich_constituency_master';
            await r.save();
        }
        console.log('Saved. Restart the backend so the alias cache rebuilds.');
    } else {
        console.log('Dry run — nothing written.');
    }
    await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
