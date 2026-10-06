/**
 * convert_eci_xls.js
 * ─────────────────────────────────────────────────────────────────────
 * Converts a folder of ECI per-booth roll exports (.xls produced by a
 * PDF→Excel conversion) into the two JSON shapes the in-app booth roll
 * uploader expects:
 *
 *   <out>/<key>.summary.json    one row per booth
 *   <out>/booths/<part>.json    the voter roll for that booth
 *
 * Usage:
 *   node convert_eci_xls.js --src "<folder of .xls>" --ac 7
 *   node convert_eci_xls.js --src "..." --ac 7 --out "..." --force
 *
 * ── Why part numbers are read from inside the files ──────────────────
 * The exported filenames are NOT reliable. In the Etcherla drop, 277 of
 * 307 filenames disagreed with the part number in the file they contained,
 * and three differently-named files all held part 82. Only the "Part
 * Number" metadata row inside the sheet is authoritative, so that is what
 * names the output and what deduplication keys on.
 *
 * ── Duplicate handling ───────────────────────────────────────────────
 * The upstream PDF download can hand the same booth back under several
 * filenames, so copies are grouped by the part number inside the file.
 *
 * Copies are MERGED, not picked between. Most are byte-identical, but the
 * PDF→Excel step sometimes yields a partial extraction: fewer rows, and —
 * critically — the serial numbers renumbered from 1, so a short copy is
 * not simply a prefix of the full one. In Palasa, 18 booths had copies
 * that each captured a different overlapping slice; taking only the
 * longest would have silently dropped 1,173 real electors.
 *
 * So every copy contributes, de-duplicated on voter ID (falling back to
 * name+relation+house for the handful of rows with no ID). The longest
 * copy supplies the canonical serial numbers; voters found only in a
 * shorter copy are appended after it.
 *
 * The run reports how far short of the seat's verified ECI electorate the
 * result falls — booths that were never fetched show up there. Check that
 * number before uploading.
 *
 * Expected sheet layout (verified across 307 Etcherla files):
 *   rows 0..N   "Label", "", "Value" metadata pairs
 *   header row  Serial No | Voter ID Number | Name |
 *               Father/Husband Name | House No | Age | Gender
 *   thereafter  one row per elector
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const { resolveSeat } = require('../../src/services/boothImportService');
const VERIFIED = require('../../src/data/state_ac_electors.json');

// ── args ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const SRC = arg('src');
const AC = Number(arg('ac'));

if (!SRC || !Number.isFinite(AC)) {
    console.error('Usage: node convert_eci_xls.js --src "<folder of .xls>" --ac <number> [--out <dir>] [--force]');
    process.exit(1);
}
if (!fs.existsSync(SRC)) {
    console.error(`Source folder not found: ${SRC}`);
    process.exit(1);
}

const { seat, error } = resolveSeat({ ac_number: AC });
if (error) { console.error(error); process.exit(1); }

const KEY = seat.constituency_key;
const OUT = arg('out', path.join(__dirname, 'output', KEY));
const BOOTHS = path.join(OUT, 'booths');

// ── helpers ───────────────────────────────────────────────────────────
const n = (v) => Number(v || 0).toLocaleString('en-IN');
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// "Main Town or Village" frequently carries a stray leading '+'.
const cleanLocality = (s) => clean(s).replace(/^\+\s*/, '');

const metaOf = (rows) => (label) => {
    const r = rows.find((x) => clean(x[0]).toLowerCase() === label.toLowerCase());
    return r ? clean(r[2]) : '';
};

const bucket = (g) => {
    const v = String(g || '').trim().toLowerCase();
    if (v === 'male' || v === 'm') return 'male';
    if (v === 'female' || v === 'f') return 'female';
    if (v.includes('third') || v === 'tg') return 'third';
    return 'other';
};

const readBooth = (file) => {
    const wb = XLSX.readFile(path.join(SRC, file));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });

    // Locate the voter table rather than assuming a fixed row index.
    const hdr = rows.findIndex((r) => clean(r[0]).toLowerCase() === 'serial no');
    if (hdr < 0) throw new Error('no voter-table header row');

    const meta = metaOf(rows);
    const part = Number(meta('Part Number'));
    if (!Number.isFinite(part) || part <= 0) throw new Error('unreadable part number');

    const acNum = Number(meta('Assembly Constituency Number'));
    if (acNum !== AC) throw new Error(`file is AC ${acNum}, expected ${AC}`);

    const voters = [];
    for (const r of rows.slice(hdr + 1)) {
        const sl = Number(clean(r[0]));
        if (!Number.isFinite(sl)) continue;   // trailing/footer rows carry no serial
        const age = Number(clean(r[5]));
        voters.push({
            sl,
            voter_id: clean(r[1]),
            name: clean(r[2]),
            relation: clean(r[3]),
            house_no: clean(r[4]),
            // Genuinely absent on thousands of real rows — null, not 0, so it
            // lands in the "unknown" age bracket instead of skewing the mean.
            age: Number.isFinite(age) && age > 0 ? age : null,
            gender: clean(r[6]),
        });
    }

    return {
        file,
        part,
        rollYear: Number(meta('Roll Year')) || null,
        locality: cleanLocality(meta('Main Town or Village')),
        // Existing seats store the full descriptive address; fall back to the
        // short station name when no address is present.
        polling_station: clean(meta('Polling Station Address')) || clean(meta('Polling Station Name')),
        declaredTotal: Number(meta('Total Electors')) || 0,
        voters,
        hash: '',
    };
};

// ── run ───────────────────────────────────────────────────────────────
const files = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.xls')).sort();
console.log(`${seat.constituency} (AC ${seat.ac_number}, ${seat.district}) — reading ${files.length} .xls files…\n`);

const copiesByPart = new Map();
const failed = [];
const hashes = new Map();
const rollYears = new Set();

for (const f of files) {
    let b;
    try { b = readBooth(f); } catch (e) { failed.push(`${f}: ${e.message}`); continue; }
    b.hash = crypto.createHash('md5').update(JSON.stringify(b.voters)).digest('hex');
    hashes.set(b.hash, (hashes.get(b.hash) || 0) + 1);
    if (b.rollYear) rollYears.add(b.rollYear);

    if (!copiesByPart.has(b.part)) copiesByPart.set(b.part, []);
    copiesByPart.get(b.part).push(b);
}

// Identity for de-duplication. Voter ID is the natural key, but a small
// number of rows have none, so fall back to the person's other fields.
const voterKey = (v) => (v.voter_id ? `id:${v.voter_id}` : `x:${v.name}|${v.relation}|${v.house_no}|${v.age}`);

/**
 * Union every copy of a booth. The longest copy is taken VERBATIM — a real
 * roll can legitimately list the same voter id twice (thousands of such rows
 * exist in some seats), so nothing inside a single copy is ever collapsed.
 * Shorter copies then contribute only the voters the base does not already
 * have, which is what recovers a partial extraction's unique slice.
 */
const mergeCopies = (copies) => {
    const ordered = [...copies].sort((a, b) => b.voters.length - a.voters.length);
    const base = ordered[0];

    const merged = [...base.voters];
    const seen = new Set(base.voters.map(voterKey));

    for (const c of ordered.slice(1)) {
        for (const v of c.voters) {
            const k = voterKey(v);
            if (seen.has(k)) continue;
            seen.add(k);
            // Serials in a partial extraction are renumbered from 1, so they
            // cannot interleave with the base — append after it instead.
            merged.push(v);
        }
    }

    return {
        ...base,
        voters: merged,
        copies: copies.length,
        recovered: merged.length - base.voters.length,
    };
};

const booths = [...copiesByPart.values()].map(mergeCopies).sort((a, b) => a.part - b.part);
const recoveredTotal = booths.reduce((s, b) => s + b.recovered, 0);
const boothsWithRecovery = booths.filter((b) => b.recovered > 0);
if (!booths.length) { console.error('Nothing readable in that folder.'); process.exit(1); }

if (fs.existsSync(OUT) && !flag('force')) {
    console.error(`Output exists: ${OUT}\nRe-run with --force to overwrite.`);
    process.exit(1);
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(BOOTHS, { recursive: true });

const summary = booths.map((b) => {
    const c = { male: 0, female: 0, third: 0, other: 0 };
    b.voters.forEach((v) => { c[bucket(v.gender)] += 1; });
    return {
        part: b.part,
        locality: b.locality || null,
        polling_station: b.polling_station || null,
        // Derived from the rows actually present so the booth grid can never
        // disagree with the drill-down. Each file's own "Total Electors" counts
        // only the basic roll and omits supplement additions.
        electors_male: c.male,
        electors_female: c.female,
        electors_third_gender: c.third,
        electors_unclassified: c.other,
        electors_total: b.voters.length,
    };
});

fs.writeFileSync(path.join(OUT, `${KEY}.summary.json`), JSON.stringify(summary, null, 1));
booths.forEach((b) => fs.writeFileSync(path.join(BOOTHS, `${b.part}.json`), JSON.stringify(b.voters)));

// ── report ────────────────────────────────────────────────────────────
const rows = booths.reduce((s, b) => s + b.voters.length, 0);
const verified = VERIFIED[String(AC)];
const parts = booths.map((b) => b.part);
const maxPart = Math.max(...parts);
const present = new Set(parts);
const absent = [];
for (let p = 1; p <= maxPart; p++) if (!present.has(p)) absent.push(p);

console.log('── Written ─────────────────────────────────────────────');
console.log(`  ${path.join(OUT, `${KEY}.summary.json`)}`);
console.log(`  ${BOOTHS}\\<part>.json   (${booths.length} files)`);

console.log('\n── Source files ────────────────────────────────────────');
console.log(`  read              : ${files.length}`);
console.log(`  distinct booths   : ${booths.length}`);
console.log(`  redundant copies  : ${files.length - booths.length - failed.length}`);
if (failed.length) {
    console.log(`  unreadable        : ${failed.length}`);
    failed.slice(0, 5).forEach((x) => console.log(`     ${x}`));
}
if (boothsWithRecovery.length) {
    console.log(`\n  merged partial extractions:`);
    console.log(`    booths where copies differed : ${boothsWithRecovery.length}`);
    console.log(`    voters recovered by merging  : ${n(recoveredTotal)}`);
    boothsWithRecovery.slice(0, 8).forEach((b) => console.log(`      part ${String(b.part).padStart(3)}: +${b.recovered} from ${b.copies} copies`));
    if (boothsWithRecovery.length > 8) console.log(`      …and ${boothsWithRecovery.length - 8} more`);
}

console.log('\n── Contents ────────────────────────────────────────────');
const tot = (k) => summary.reduce((s, r) => s + r[k], 0);
console.log(`  roll year(s)      : ${[...rollYears].join(', ') || 'unknown'}`);
console.log(`  voter rows        : ${n(rows)}`);
console.log(`  male / female     : ${n(tot('electors_male'))} / ${n(tot('electors_female'))}`);
console.log(`  third / unclassed : ${n(tot('electors_third_gender'))} / ${n(tot('electors_unclassified'))}`);

console.log('\n── Coverage ────────────────────────────────────────────');
console.log(`  parts present     : ${booths.length}  (range ${Math.min(...parts)}..${maxPart})`);
console.log(`  parts absent      : ${absent.length}`);
if (verified) {
    const pct = (rows / verified.electors_total) * 100;
    console.log(`  ECI verified total: ${n(verified.electors_total)}`);
    console.log(`  this covers       : ${pct.toFixed(1)}%`);
    if (pct < 90) {
        console.log('\n  ⚠  WELL SHORT OF THE FULL ELECTORATE.');
        console.log('     Redundant copies mean booths that were never downloaded.');
        console.log('     Re-fetch the missing PDFs before uploading this as live data.');
    }
}
