/**
 * build_election_history.js
 * ─────────────────────────────────────────────────────────────────────
 * Builds every Telangana assembly seat's results across Assembly 2014, 2018,
 * 2023, Lok Sabha 2014, 2019, 2024 (assembly-segment breakdown for 2019 and
 * 2024) and post-2023 by-elections, and writes them to MongoDB
 * (ElectionHistory, collection `election_history`) — the Electoral Analysis
 * reads only from there.
 *
 * Inputs live in data-sources/elections/ with their provenance in
 * sources.json. The output is a pure function of those files: re-running
 * it after replacing a source file is the whole update procedure.
 *
 *   node scripts/build_election_history.js           # build + verify + write to DB
 *   node scripts/build_election_history.js --check   # build + verify, write nothing
 *
 * It refuses to write if any check fails. The checks are what make the
 * output trustworthy: every seat present in every election, vote shares
 * summing to ~100, and the statewide seat tally of each assembly election
 * matching the officially declared result.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SRC = path.resolve(__dirname, '../data-sources/elections');
const CHECK_ONLY = process.argv.includes('--check');

const sources = JSON.parse(fs.readFileSync(path.join(SRC, 'sources.json'), 'utf8'));
const bypollsSrc = JSON.parse(fs.readFileSync(path.join(SRC, sources.bypolls.file), 'utf8'));
/** Current district of each seat, per CEO Telangana's district-wise AC list. */
const acDistricts = JSON.parse(fs.readFileSync(path.join(SRC, 'tg_ac_districts_ceo.json'), 'utf8'));
const profiles = require('../src/data/state_voter_profiles.json');
/** 2023 electors per seat (ECI statistical report), stored with each seat. */
const acElectors = require('../src/data/state_ac_electors.json');

/* Officially declared statewide results — the build must reproduce these exactly. */
const DECLARED_TALLY = {
    AE2014: { BRS: 63, INC: 21, TDP: 15, AIMIM: 7, BJP: 5, YSRCP: 3, BSP: 2, CPI: 1, CPM: 1, IND: 1 },
    AE2018: { BRS: 88, INC: 19, AIMIM: 7, TDP: 2, BJP: 1, AIFB: 1, IND: 1 },
    AE2023: { INC: 64, BRS: 39, BJP: 8, AIMIM: 7, CPI: 1 },
};

/** TRS (2001-2022) and BHRS (ECI's code since 2022) are the same party: BRS. */
const PARTY_ALIASES = { TRS: 'BRS', BHRS: 'BRS', BRS: 'BRS', CPIM: 'CPM', 'CPI(M)': 'CPM' };
/* Lok Sabha files spell parties out in full; map the ones that matter to the
 * same codes the assembly files use. Anything else keeps its published name. */
const FULL_NAMES = {
    'telangana rashtra samithi': 'BRS', 'bharat rashtra samithi': 'BRS',
    'indian national congress': 'INC', 'bharatiya janata party': 'BJP',
    'all india majlis-e-ittehadul muslimeen': 'AIMIM', 'telugu desam': 'TDP', 'telugu desam party': 'TDP',
    'yuvajana sramika rythu congress party': 'YSRCP', 'ysr congress party': 'YSRCP',
    'bahujan samaj party': 'BSP', 'communist party of india': 'CPI', 'communist party of india (marxist)': 'CPM',
    'communist party of india  (marxist)': 'CPM', 'aam aadmi party': 'AAP', 'independent': 'IND',
    'none of the above': 'NOTA', 'nota': 'NOTA',
};
const normParty = (p) => {
    const raw = String(p || '').trim();
    const full = FULL_NAMES[raw.toLowerCase().replace(/\s+/g, ' ')] || FULL_NAMES[raw.toLowerCase()];
    if (full) return full;
    const k = raw.toUpperCase();
    // Party names become field keys in MongoDB, which cannot hold dots ("B. C. United Front").
    return PARTY_ALIASES[k] || (raw.length > 12 ? raw.replace(/\.\s*/g, ' ').replace(/\s+/g, ' ').trim() : k) || 'IND';
};
/** Lok Sabha seat names are spelt differently across years ("Secundrabad", "Chelvella"). */
const PC_ALIASES = { secundrabad: 'secunderabad', peddapalli: 'peddapalle', bhuvanagiri: 'bhongir', mahabubnagar: 'mahbubnagar', chelvella: 'chevella' };
const pcKey = (s) => { const n = String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]/g, ''); return PC_ALIASES[n] || n; };

const round2 = (n) => Math.round(n * 100) / 100;
const readRows = (file, opts) => {
    const wb = XLSX.readFile(path.join(SRC, file));
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], opts);
};
/** "1 Dr.palvai Harish Babu" → "Dr.palvai Harish Babu" (ECI prefixes the ballot serial). */
const stripSerial = (s) => String(s || '').replace(/^\s*\d+\s+/, '').trim();

/**
 * One election at one seat, from its candidate rows.
 * `candidates`: [{ name, party, votes }] — NOTA included as party 'NOTA'.
 */
const contest = ({ candidates, electors, extra = {} }) => {
    const valid = candidates.reduce((s, c) => s + c.votes, 0);
    const ranked = candidates.filter((c) => c.party !== 'NOTA').sort((a, b) => b.votes - a.votes);
    const share = (v) => (valid ? round2((v / valid) * 100) : 0);
    const parties = {};
    for (const c of ranked) {
        const p = parties[c.party] || { votes: 0, share: 0, candidate: c.name };
        p.votes += c.votes; // an independent pool can hold several candidates
        parties[c.party] = p;
    }
    for (const p of Object.values(parties)) p.share = share(p.votes);
    const nota = candidates.filter((c) => c.party === 'NOTA').reduce((s, c) => s + c.votes, 0);
    const [w, r] = ranked;
    const pick = (c) => (c ? { name: c.name, party: c.party, votes: c.votes, share: share(c.votes) } : null);
    return {
        electors: electors || null,
        valid_votes: valid,
        turnout_pct: electors ? round2((valid / electors) * 100) : null,
        candidates_count: ranked.length,
        // Every candidate, in finishing order. `deposit_lost` is the ECI rule:
        // a candidate polling under one-sixth of the valid votes forfeits it.
        candidates: ranked.map((c) => ({
            name: c.name, party: c.party, votes: c.votes, share: share(c.votes),
            deposit_lost: valid ? c.votes < valid / 6 : false,
            ...(c.incumbent != null ? { incumbent: c.incumbent, turncoat: c.turncoat } : {}),
        })),
        winner: pick(w),
        runner_up: pick(r),
        margin: w && r ? w.votes - r.votes : null,
        margin_pct: w && r ? round2(share(w.votes) - share(r.votes)) : null,
        nota: { votes: nota, share: share(nota) },
        parties,
        ...extra,
    };
};

/* ── loaders ─────────────────────────────────────────────────────────── */

/** TCPD LokDhaba rows (2014, 2018). */
const loadTcpd = (file) => {
    const byAc = new Map();
    for (const r of readRows(file)) {
        if (Number(r.Poll_No) !== 0) continue; // 0 = the general election, >0 = by-polls
        const n = Number(r.Constituency_No);
        const a = byAc.get(n) || { rows: [], electors: Number(r.Electors) || null, turnout: Number(r.Turnout_Percentage) || null };
        a.rows.push(r);
        byAc.set(n, a);
    }
    const out = new Map();
    for (const [n, a] of byAc) {
        const flag = (v) => (v === undefined || v === '' ? null : String(v).toUpperCase() === 'TRUE');
        const c = contest({
            candidates: a.rows.map((r) => ({
                name: String(r.Candidate || '').trim(), party: normParty(r.Party), votes: Number(r.Votes) || 0,
                incumbent: flag(r.Incumbent), turncoat: flag(r.Turncoat),
            })),
            electors: a.electors,
        });
        // TCPD's own turnout counts every vote cast (incl. rejected); prefer it.
        if (a.turnout) c.turnout_pct = a.turnout;
        const brs = a.rows.find((r) => normParty(r.Party) === 'BRS');
        if (brs && brs.Incumbent !== undefined) {
            c.brs_candidate_flags = {
                incumbent: String(brs.Incumbent).toUpperCase() === 'TRUE',
                turncoat: String(brs.Turncoat).toUpperCase() === 'TRUE',
                previous_party: brs.Last_Party ? normParty(brs.Last_Party) : null,
            };
        }
        const win = a.rows.find((r) => Number(r.Position) === 1);
        if (win && win.Turncoat !== undefined) {
            c.winner.turncoat = String(win.Turncoat).toUpperCase() === 'TRUE';
            c.winner.previous_party = win.Last_Party ? normParty(win.Last_Party) : null;
        }
        out.set(n, c);
    }
    return out;
};

/** ECI '10 - Detailed Results' (2023). */
const loadEci2023 = (file) => {
    const rows = readRows(file, { header: 1 }).filter((r) => r[0] === 'Telangana');
    const byAc = new Map();
    for (const r of rows) {
        const n = Number(r[1]);
        const a = byAc.get(n) || { rows: [], electors: Number(r[13]) || null };
        a.rows.push(r);
        byAc.set(n, a);
    }
    const out = new Map();
    for (const [n, a] of byAc) {
        out.set(n, contest({
            candidates: a.rows.map((r) => ({ name: stripSerial(r[3]), party: normParty(r[7]), votes: Number(r[11]) || 0 })),
            electors: a.electors,
        }));
    }
    return out;
};

/**
 * ECI 'Details of Assembly Segment of PC' (Lok Sabha 2019 / 2024): how one
 * assembly area voted in the MP election. EVM votes only — postal ballots are
 * counted per parliamentary seat, not per assembly segment.
 */
const loadLs2024 = (file) => {
    const rows = readRows(file);
    const byAc = new Map();
    for (const r of rows) {
        const n = Number(r['AC NO']);
        const a = byAc.get(n) || { rows: [], electors: Number(r['TOTAL ELECTORS IN AC'] ?? r['TOTAL ELECTORS']) || null,
            nota: Number(r['NOTA VOTES EVM IN AC'] ?? r['NOTA VOTES EVM']) || 0, pc: String(r['PC NAME'] || '').trim(), pc_no: Number(r['PC NO']) };
        a.rows.push(r);
        byAc.set(n, a);
    }
    const out = new Map();
    for (const [n, a] of byAc) {
        const candidates = a.rows.map((r) => ({ name: String(r['CANDIDATE NAME'] || '').trim(), party: normParty(r.PARTY), votes: Number(r['VOTES SECURED EVM']) || 0 }));
        candidates.push({ name: 'NOTA', party: 'NOTA', votes: a.nota });
        out.set(n, contest({ candidates, electors: a.electors, extra: { parliamentary_constituency: a.pc, pc_number: a.pc_no, evm_only: true } }));
    }
    return out;
};

/**
 * Full Lok Sabha results, one contest per parliamentary seat. Each source
 * names its columns differently; `pick` maps a row to { pc, name, party, votes }.
 */
const loadPc = (file, pick, electorsOf = () => null) => {
    const byPc = new Map();
    for (const r of readRows(file)) {
        const c = pick(r);
        const a = byPc.get(c.pc) || { rows: [], name: c.pcName, electors: electorsOf(r) };
        a.rows.push(c);
        byPc.set(c.pc, a);
    }
    const out = new Map();
    for (const [pc, a] of byPc) out.set(pc, { name: a.name, ...contest({ candidates: a.rows, electors: a.electors }) });
    return out;
};
const PC_LOADERS = {
    LS2014: () => loadPc('tg_ls_2014_pc_eci.csv', (r) => ({
        pc: pcKey(r.pc_name), pcName: r.pc_name, name: String(r.candidate_name || '').trim(), party: normParty(r.party_name),
        votes: (Number(r.votes_secured_general) || 0) + (Number(r.votes_secured_postal) || 0),
    }), (r) => Number(r.total_electors) || null),
    LS2019: () => loadPc('tg_ls_2019_pc_tcpd.csv', (r) => ({
        pc: pcKey(r.Constituency_Name), pcName: r.Constituency_Name, name: String(r.Candidate || '').trim(), party: normParty(r.Party),
        votes: Number(r.Votes) || 0,
    }), (r) => Number(r.Electors) || null),
    // The 2024 seat-level file has no electors column; the ECI assembly-segment
    // file carries each seat's total ("TOTAL ELECTORS IN PC"), so it comes from there.
    LS2024: () => {
        const electorsByPc = new Map(readRows('tg_ls_2024_ac_segments_eci.csv')
            .map((r) => [pcKey(r['PC NAME']), Number(r['TOTAL ELECTORS IN PC']) || null]));
        return loadPc('tg_ls_2024_pc_eci.csv', (r) => ({
            pc: pcKey(r['PC Name']), pcName: r['PC Name'], name: String(r.Candidate || '').trim(), party: normParty(r.Party),
            votes: Number(r['Total Votes']) || 0,
        }), (r) => electorsByPc.get(pcKey(r['PC Name'])) || null);
    },
};

/* ── build ───────────────────────────────────────────────────────────── */

const loaders = {
    AE2014: () => loadTcpd('tg_ae_2014_tcpd.csv'),
    AE2018: () => loadTcpd('tg_ae_2018_tcpd.csv'),
    AE2023: () => loadEci2023('tg_ae_2023_eci_detailed.xlsx'),
    LS2024: () => loadLs2024('tg_ls_2024_ac_segments_eci.csv'),
    LS2019: () => loadLs2024('tg_ls_2019_ac_segments_eci.csv'),
};
const elections = {};
for (const e of sources.elections) elections[e.id] = loaders[e.id]();
// The 2019 MP vote by assembly area (segment level), alongside 2024's.
for (const s of sources.lok_sabha.segments) elections[s.id] = loaders[s.id]();
const lokSabha = {};
for (const e of sources.lok_sabha.elections) lokSabha[e.id] = PC_LOADERS[e.id]();

const failures = [];
const fail = (m) => failures.push(m);

// 1. Every seat in every election.
for (const [id, m] of Object.entries(elections)) {
    for (let n = 1; n <= 119; n++) if (!m.has(n)) fail(`${id}: seat ${n} missing`);
    if (m.size !== 119) fail(`${id}: ${m.size} seats, expected 119`);
}
// 2. Shares sum to 100 (incl. NOTA) at every seat.
for (const [id, m] of Object.entries(elections)) {
    for (const [n, c] of m) {
        const sum = Object.values(c.parties).reduce((s, p) => s + p.share, 0) + c.nota.share;
        if (Math.abs(sum - 100) > 0.5) fail(`${id}: seat ${n} shares sum to ${sum.toFixed(2)}`);
    }
}
// 3. Statewide seat tally equals the declared result.
for (const [id, want] of Object.entries(DECLARED_TALLY)) {
    const got = {};
    for (const c of elections[id].values()) got[c.winner.party] = (got[c.winner.party] || 0) + 1;
    const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
    for (const k of keys) if ((want[k] || 0) !== (got[k] || 0)) fail(`${id}: ${k} won ${got[k] || 0}, declared ${want[k] || 0}`);
}
// 4. Seat numbers mean the same seat in every source (names agree on their first letters).
const nm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]/g, '');
const byNo = new Map(profiles.map((p) => [p.ac_number, p]));
const tcpdNames = new Map(readRows('tg_ae_2018_tcpd.csv').map((r) => [Number(r.Constituency_No), r.Constituency_Name]));
for (let n = 1; n <= 119; n++) {
    const p = byNo.get(n);
    if (!p) { fail(`seat ${n} missing from state_voter_profiles.json`); continue; }
    if (nm(p.constituency).slice(0, 4) !== nm(tcpdNames.get(n)).slice(0, 4)) fail(`seat ${n}: '${p.constituency}' vs source '${tcpdNames.get(n)}'`);
}
// 4b. Every seat has a current district, and the list covers all 33 districts.
{
    const d = acDistricts.districts;
    for (let n = 1; n <= 119; n++) if (!d[n]) fail(`seat ${n} has no district in tg_ac_districts_ceo.json`);
    const distinct = new Set(Object.values(d));
    if (distinct.size !== 33) fail(`district list has ${distinct.size} districts, expected 33`);
}
// 5. By-polls point at real seats and are internally consistent.
for (const b of bypollsSrc.bypolls) {
    const p = byNo.get(b.ac_number);
    if (!p || nm(p.constituency).slice(0, 6) !== nm(b.constituency).slice(0, 6)) fail(`bypoll ${b.constituency}: ac ${b.ac_number} is '${p && p.constituency}'`);
    const [w, r] = b.candidates.filter((c) => c.party !== 'NOTA').sort((x, y) => y.votes - x.votes);
    if (w.votes - r.votes !== b.margin) fail(`bypoll ${b.constituency}: margin ${b.margin} != ${w.votes - r.votes}`);
}

// 6. Statewide picture per election, computed from the verified seat results.
const statewide = {};
for (const id of Object.keys(elections)) {
    const tally = {};
    for (const c of elections[id].values()) tally[c.winner.party] = (tally[c.winner.party] || 0) + 1;
    statewide[id] = { assembly_segments_won: tally };
}
// Lok Sabha: all 17 seats every year, shares sum to 100, and the Telangana
// seat tally equals the declared result.
for (const [id, m] of Object.entries(lokSabha)) {
    if (m.size !== 17) fail(`${id}: ${m.size} Lok Sabha seats, expected 17 (${[...m.keys()].join(',')})`);
    for (const [pc, c] of m) {
        const sum = Object.values(c.parties).reduce((s, p) => s + p.share, 0) + c.nota.share;
        if (Math.abs(sum - 100) > 0.5) fail(`${id} ${pc}: shares sum to ${sum.toFixed(2)}`);
    }
    const tally = {};
    for (const c of m.values()) tally[c.winner.party] = (tally[c.winner.party] || 0) + 1;
    const want = sources.lok_sabha.declared[id];
    for (const p of new Set([...Object.keys(tally), ...Object.keys(want)])) {
        if ((tally[p] || 0) !== (want[p] || 0)) fail(`${id}: ${p} won ${tally[p] || 0} Lok Sabha seats, declared ${want[p] || 0}`);
    }
    statewide[id] = { ...(statewide[id] || {}), lok_sabha_seats_won: tally, lok_sabha_seats: m.size,
        government: { level: 'national', ...sources.lok_sabha.national_governments[id] } };
}
// Every assembly seat sits in a known Lok Sabha seat, the same one in 2019 and 2024.
for (let n = 1; n <= 119; n++) {
    const a = pcKey(elections.LS2024.get(n)?.parliamentary_constituency);
    const b = pcKey(elections.LS2019.get(n)?.parliamentary_constituency);
    if (!lokSabha.LS2024.has(a)) fail(`seat ${n}: parent Lok Sabha seat '${a}' not found`);
    if (a !== b) fail(`seat ${n}: Lok Sabha seat ${b} in 2019 but ${a} in 2024`);
}
// 7. Every named state government holds a majority in its election's results.
for (const [id, g] of Object.entries(sources.governments)) {
    if (id.startsWith('_')) continue;
    statewide[id].government = g;
    if (g.level === 'state') {
        const seats = statewide[id].assembly_segments_won[g.party] || 0;
        if (seats < 60) fail(`${id}: government party ${g.party} has ${seats} seats, short of a 60-seat majority`);
    }
}

if (failures.length) {
    const msg = `${failures.length} check(s) failed — nothing written:\n  ${failures.join('\n  ')}`;
    if (require.main !== module) throw new Error(msg);
    console.error(`\n✗ ${msg}`);
    process.exit(1);
}

const seats = profiles
    .slice()
    .sort((a, b) => a.ac_number - b.ac_number)
    .map((p) => {
        const n = p.ac_number;
        const results = {};
        for (const e of sources.elections) results[e.id] = { poll_date: e.poll_date, ...elections[e.id].get(n) };
        const ls19 = sources.lok_sabha.elections.find((e) => e.id === 'LS2019');
        results.LS2019 = { poll_date: ls19.poll_date, ...elections.LS2019.get(n) };
        const bypolls = bypollsSrc.bypolls.filter((b) => b.ac_number === n).map((b) => {
            const ranked = b.candidates.filter((c) => c.party !== 'NOTA').sort((x, y) => y.votes - x.votes);
            const parties = {};
            for (const c of ranked) parties[normParty(c.party)] = { votes: c.votes, share: c.share, candidate: c.name };
            return {
                poll_date: b.poll_date, result_date: b.result_date, cause: b.cause,
                votes_polled: b.votes_polled, turnout_pct: b.turnout_pct,
                winner: { name: ranked[0].name, party: normParty(ranked[0].party), votes: ranked[0].votes, share: ranked[0].share },
                runner_up: { name: ranked[1].name, party: normParty(ranked[1].party), votes: ranked[1].votes, share: ranked[1].share },
                margin: b.margin, margin_pct: b.margin_pct, parties,
                nota: (() => { const n = b.candidates.find((c) => c.party === 'NOTA'); return n ? { votes: n.votes, share: n.share } : null; })(),
                candidates: ranked.map((c) => ({ name: c.name, party: normParty(c.party), votes: c.votes, share: c.share, deposit_lost: c.share < 100 / 6 })),
                partial: true, sources: b.sources,
            };
        });
        return {
            ac_number: n, key: p.key, constituency: p.constituency,
            district: acDistricts.districts[n], reserved_category: p.reserved_category, lok_sabha: p.lok_sabha,
            lok_sabha_key: pcKey(elections.LS2024.get(n).parliamentary_constituency),
            electors_2023: acElectors[String(n)] ? {
                total: acElectors[String(n)].electors_total,
                female: acElectors[String(n)].electors_female,
                male: acElectors[String(n)].electors_male,
            } : null,
            results, bypolls,
        };
    });

const out = {
    _meta: {
        description: 'Telangana assembly seat results 2014-2024 for the Electoral Analysis. Built by scripts/build_election_history.js — do not edit by hand.',
        built: new Date().toISOString().slice(0, 10),
        party_normalisation: 'TRS and BHRS are recorded as BRS.',
        share_basis: 'Vote share is of total valid votes including NOTA, as the ECI reports it.',
        checks_passed: ['119 seats in every election', 'shares sum to 100 at every seat', 'statewide seat tallies equal the declared results', 'seat numbers agree across sources', 'by-poll margins consistent', 'Lok Sabha 2014/2019/2024: 17 seats each, Telangana tallies equal the declared results', 'each assembly seat maps to the same Lok Sabha seat in 2019 and 2024', 'each state government holds a majority in its election', 'every seat has its current district (CEO Telangana district-wise AC list)'],
        statewide,
        // Main parties' 2023 assembly promises, as reported at release (with sources).
        manifestos: JSON.parse(fs.readFileSync(path.join(SRC, 'tg_2023_manifestos.json'), 'utf8')).parties,
        elections: sources.elections.map(({ file, ...e }) => e),
        lok_sabha_elections: sources.lok_sabha.elections.map(({ file, ...e }) => e),
        bypolls: sources.bypolls.notes,
        excluded: sources.excluded,
        retrieved: sources.retrieved,
    },
    seats,
    // One entry per Lok Sabha seat: its full result in every year.
    lok_sabha: Object.fromEntries([...lokSabha.LS2024.keys()].map((pc) => [pc, {
        name: lokSabha.LS2024.get(pc).name,
        results: Object.fromEntries(sources.lok_sabha.elections.map((e) => [e.id, { poll_date: e.poll_date, ...lokSabha[e.id].get(pc) }])),
    }])),
};

module.exports = out;

/** Replace the election_history collection with this build: upsert every document, drop stale ones. */
const writeToDb = async () => {
    require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
    const mongoose = require('mongoose');
    const ElectionHistory = require('../src/models/ElectionHistory');
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cgsaga';
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(uri, dbName ? { dbName } : undefined);
    try {
        const built = new Date().toISOString();
        const docs = [
            { kind: 'meta', key: 'meta', data: out._meta },
            ...out.seats.map((s) => ({ kind: 'seat', key: s.key, ac_number: s.ac_number, data: s })),
            ...Object.entries(out.lok_sabha).map(([key, pc]) => ({ kind: 'lok_sabha', key, data: pc })),
        ];
        await ElectionHistory.bulkWrite(docs.map((d) => ({
            replaceOne: { filter: { kind: d.kind, key: d.key }, replacement: { ...d, built, updated_at: new Date() }, upsert: true },
        })));
        const stale = await ElectionHistory.deleteMany({ built: { $ne: built } });
        console.log(`  wrote ${docs.length} documents to election_history (${out.seats.length} seats, ${Object.keys(out.lok_sabha).length} Lok Sabha seats, meta)${stale.deletedCount ? ` · removed ${stale.deletedCount} stale` : ''}`);
        console.log('  the app picks this up within 10 minutes, or at once on a backend restart');
    } finally {
        await mongoose.disconnect();
    }
};

if (require.main === module) {
    const brsWins = (id) => seats.filter((s) => s.results[id].winner.party === 'BRS').length;
    console.log(`✓ all checks passed — ${seats.length} seats`);
    console.log(`  BRS seats won: 2014 ${brsWins('AE2014')} · 2018 ${brsWins('AE2018')} · 2023 ${brsWins('AE2023')} · LS-2024 segments led ${brsWins('LS2024')}`);
    if (CHECK_ONLY) { console.log('  --check: nothing written'); process.exit(0); }
    writeToDb().then(() => process.exit(0)).catch((err) => { console.error('✗ write to DB failed:', err.message); process.exit(1); });
}
