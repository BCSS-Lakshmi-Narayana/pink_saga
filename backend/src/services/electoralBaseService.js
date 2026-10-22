/**
 * electoralBaseService — published election results per assembly seat.
 *
 * Reads the ElectionHistory collection, which scripts/build_election_history.js
 * builds from ECI / TCPD / India Data Portal files and verifies against the
 * officially declared seat tallies before writing. Nothing here estimates or
 * scores a seat: every value is a published result or a direct count of them.
 *
 * The results only change when the build script is re-run, so `load()` keeps
 * the computed seats in memory and re-reads the collection every 10 minutes.
 */
const ElectionHistory = require('../models/ElectionHistory');
const { DEFECTED_MLAS = [] } = require('../config/politicalData');

const OURS = 'BRS';
const ASSEMBLY = ['AE2014', 'AE2018', 'AE2023'];
const LOK_SABHA = ['LS2014', 'LS2019', 'LS2024'];

/** BRS's finishing position in one contest (0 = did not contest). */
const placeOf = (contest) => (contest?.candidates || []).findIndex((c) => c.party === OURS) + 1;

const brief = (contest) => ({
    winner_party: contest.winner.party,
    winner_name: contest.winner.name,
    brs_place: placeOf(contest),
    brs_share: contest.parties[OURS] ? contest.parties[OURS].share : null,
    margin: contest.margin,
});

const defectedByAc = new Map(DEFECTED_MLAS.filter((m) => m.ac_number).map((m) => [Number(m.ac_number), m]));

/**
 * Every MLA and MP election for one seat, in date order: who won there and
 * how BRS did. MP 2019 and 2024 are this assembly area's own vote (ECI
 * assembly-segment results). MP 2014 is the whole Lok Sabha seat's result —
 * the ECI never published 2014 segment results in machine-readable form; it
 * was polled the same day as the 2014 assembly election.
 */
/** Who won the whole Lok Sabha seat — shown beside how this one assembly area voted. */
const seatWinner = (pc, id) => (pc && pc.results[id] ? {
    lok_sabha_seat: pc.name,
    seat_winner_party: pc.results[id].winner.party,
    seat_winner_name: pc.results[id].winner.name,
} : {});

const buildTimeline = (s, pc) => {
    const row = (id, label, type, level, contest, extra = {}) => (contest && contest.winner ? {
        id, label, type, level, poll_date: contest.poll_date || extra.poll_date || null,
        ...brief(contest), brs_won: contest.winner.party === OURS, ...extra,
    } : null);
    const rows = [
        row('AE2014', 'MLA 2014', 'MLA', 'seat', s.results.AE2014),
        row('LS2014', 'MP 2014', 'MP', 'lok_sabha_seat', pc && pc.results.LS2014),
        row('AE2018', 'MLA 2018', 'MLA', 'seat', s.results.AE2018),
        row('LS2019', 'MP 2019', 'MP', 'assembly_area', s.results.LS2019, seatWinner(pc, 'LS2019')),
        row('AE2023', 'MLA 2023', 'MLA', 'seat', s.results.AE2023),
        row('LS2024', 'MP 2024', 'MP', 'assembly_area', s.results.LS2024, seatWinner(pc, 'LS2024')),
        ...s.bypolls.map((b) => row(`BYE${b.poll_date}`, `MLA by-poll ${b.poll_date.slice(0, 4)}`, 'MLA', 'seat', b, { bypoll: true, poll_date: b.poll_date })),
    ].filter(Boolean);
    return rows.sort((a, b) => String(a.poll_date).localeCompare(String(b.poll_date)));
};

const r1 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10);
const shareIn = (contest, party) => (contest && contest.parties[party] ? contest.parties[party].share : 0);
const CLOSE_PTS = 5;

/**
 * Plain facts that answer the three client questions for one seat — all read
 * straight off the published results:
 *   core       how often BRS won here (see brs_wins / timeline)
 *   swing      did the seat change hands, was the last contest close, did
 *              the area vote one way for MLA and another for MP
 *   opposition each party's vote-share change between assembly elections
 */
const seatFacts = (s, pc) => {
    const a18 = s.results.AE2018;
    const a23 = s.results.AE2023;
    const ls24 = s.results.LS2024;
    const parties = new Set([...Object.keys(a18.parties), ...Object.keys(a23.parties)]);
    parties.delete('IND');
    const change = [...parties]
        .map((p) => ({ party: p, share_2018: shareIn(a18, p), share_2023: shareIn(a23, p), change: r1(shareIn(a23, p) - shareIn(a18, p)) }))
        .filter((x) => x.share_2018 >= 2 || x.share_2023 >= 2)
        .sort((x, y) => y.change - x.change);
    const el = s.electors_2023 || {};
    return {
        changed_hands_2018_2023: a18.winner.party !== a23.winner.party ? { from: a18.winner.party, to: a23.winner.party } : null,
        margin_pct_2023: a23.margin_pct,
        close_2023: a23.margin_pct != null && a23.margin_pct < CLOSE_PTS,
        // Same voters, six months apart: who won the MLA seat vs who led this area for MP.
        split_2023_2024: a23.winner.party !== ls24.winner.party ? { mla_2023: a23.winner.party, mp_2024_area: ls24.winner.party } : null,
        vote_share_change_2018_2023: change,
        demographics: {
            seat_type: s.reserved_category,
            electors_2023: el.total || a23.electors || null,
            women_electors_pct: el.total ? r1((el.female / el.total) * 100) : null,
            turnout: { AE2014: s.results.AE2014.turnout_pct, AE2018: a18.turnout_pct, AE2023: a23.turnout_pct, LS2024: ls24.turnout_pct },
        },
        lok_sabha_seat_2024_winner: pc ? pc.results.LS2024.winner.party : null,
    };
};

/** One row per seat: who won each assembly and Lok Sabha election, and how BRS did. */
const buildSeat = (s, history) => {
    const assembly = Object.fromEntries(ASSEMBLY.map((id) => [id, brief(s.results[id])]));
    const bypolls = s.bypolls.map((b) => ({ poll_date: b.poll_date, ...brief(b) }));
    const latest = bypolls.length ? bypolls[bypolls.length - 1] : assembly.AE2023;
    const pc = history.lok_sabha[s.lok_sabha_key];
    const lokSabha = pc ? Object.fromEntries(LOK_SABHA.map((id) => [id, brief(pc.results[id])])) : {};
    const defected = defectedByAc.get(s.ac_number);
    const timeline = buildTimeline(s, pc);
    // Loyalty count over the six general elections (by-polls are shown but not
    // counted, so every seat is measured out of the same six).
    const general = timeline.filter((t) => !t.bypoll);
    return {
        ac_number: s.ac_number,
        key: s.key,
        constituency: s.constituency,
        district: s.district,
        reserved_category: s.reserved_category,
        lok_sabha: pc ? pc.name : s.lok_sabha,
        assembly,
        bypolls,
        latest_assembly: latest,
        brs_assembly_wins: ASSEMBLY.filter((id) => assembly[id].winner_party === OURS).length,
        timeline,
        brs_wins: general.filter((t) => t.brs_won).length,
        elections_counted: general.length,
        lok_sabha_results: lokSabha,
        defected_mla: defected && assembly.AE2023.winner_party === OURS
            ? { name: defected.name, now_with: defected.functions_with || 'INC' } : null,
        facts: seatFacts(s, pc),
    };
};

/* ── statewide overview over a set of seats (all, or a user's scoped seats) ── */

const GENERAL = ['AE2014', 'LS2014', 'AE2018', 'LS2019', 'AE2023', 'LS2024'];
const RIVALS = ['INC', 'BJP', 'AIMIM'];

/** Vote-weighted share of `party` over seats, for one assembly election (or MP area result). */
const pooledShare = (raws, id, party) => {
    let v = 0; let total = 0;
    for (const r of raws) {
        const c = r.results[id];
        if (!c) continue;
        v += c.parties[party] ? c.parties[party].votes : 0;
        total += c.valid_votes;
    }
    return total ? r1((v / total) * 100) : null;
};

const seatRow = (s) => ({
    key: s.key, constituency: s.constituency, district: s.district, reserved_category: s.reserved_category,
    brs_wins: s.brs_wins, winner_2023: s.assembly.AE2023.winner_party, margin_pct_2023: s.facts.margin_pct_2023,
});

const overview = (history, RAW_BY_KEY, seats) => {
    const raws = seats.map((s) => RAW_BY_KEY.get(s.key));
    const elections = ['AE2014', 'AE2018', 'AE2023', 'LS2019', 'LS2024'];

    // Core: who consistently votes BRS — by seat, by seat type, by district.
    const loyalty = [6, 5, 4, 3, 2, 1, 0].map((n) => ({ wins: n, seats: seats.filter((s) => s.brs_wins === n).length }));
    const groupBy = (fn) => {
        const m = new Map();
        seats.forEach((s) => { const k = fn(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s); });
        return [...m].map(([group, list]) => {
            const rs = list.map((s) => RAW_BY_KEY.get(s.key));
            return {
                group, seats: list.length,
                brs_seats_won: Object.fromEntries(ASSEMBLY.map((id) => [id, list.filter((s) => s.assembly[id].winner_party === OURS).length])),
                brs_share: Object.fromEntries(elections.map((id) => [id, pooledShare(rs, id, OURS)])),
                avg_brs_wins: r1(list.reduce((t, s) => t + s.brs_wins, 0) / list.length),
            };
        });
    };

    // Swing: seats that changed hands, close contests, MLA-vs-MP splits.
    const changed = seats.filter((s) => s.facts.changed_hands_2018_2023);
    const close = seats.filter((s) => s.facts.close_2023).sort((a, b) => a.facts.margin_pct_2023 - b.facts.margin_pct_2023);
    const split = seats.filter((s) => s.facts.split_2023_2024);

    // Opposition: where BRS's 2018 seats went in 2023, and each party's share over time.
    const brs2018 = seats.filter((s) => s.assembly.AE2018.winner_party === OURS);
    const lostTo = {};
    brs2018.filter((s) => s.assembly.AE2023.winner_party !== OURS).forEach((s) => {
        const p = s.assembly.AE2023.winner_party;
        (lostTo[p] = lostTo[p] || []).push(seatRow(s));
    });
    const partyShares = [OURS, ...RIVALS].map((p) => ({ party: p, share: Object.fromEntries(elections.map((id) => [id, pooledShare(raws, id, p)])) }));

    return {
        seats: seats.length,
        core: {
            loyalty,
            all_six: seats.filter((s) => s.brs_wins === 6).map(seatRow),
            five: seats.filter((s) => s.brs_wins === 5).map(seatRow),
            all_three_assembly: seats.filter((s) => s.brs_assembly_wins === 3).map(seatRow),
            by_seat_type: groupBy((s) => s.reserved_category || 'GEN').sort((a, b) => b.seats - a.seats),
            by_district: groupBy((s) => s.district).sort((a, b) => b.avg_brs_wins - a.avg_brs_wins),
        },
        swing: {
            close_pts: CLOSE_PTS,
            close_2023: close.map(seatRow),
            close_2023_brs_won: close.filter((s) => s.assembly.AE2023.winner_party === OURS).length,
            changed_hands_2018_2023: changed.map((s) => ({ ...seatRow(s), ...s.facts.changed_hands_2018_2023 })),
            split_2023_2024: split.map((s) => ({ ...seatRow(s), ...s.facts.split_2023_2024 })),
        },
        opposition: {
            brs_seats_2018: brs2018.length,
            brs_held_2023: brs2018.filter((s) => s.assembly.AE2023.winner_party === OURS).length,
            lost_to: Object.entries(lostTo).map(([party, list]) => ({ party, seats: list.length, list })).sort((a, b) => b.seats - a.seats),
            party_shares: partyShares,
            manifestos_2023: history._meta.manifestos || [],
        },
    };
};

/**
 * Everything the API serves, computed once from one read of the collection:
 * { listSeats(), getSeat(key), getSeatResults(key), overview(seats), meta() }.
 */
const fromHistory = (history) => {
    const SEATS = history.seats.map((s) => buildSeat(s, history));
    const SEAT_BY_KEY = new Map(SEATS.map((s) => [s.key, s]));
    const RAW_BY_KEY = new Map(history.seats.map((s) => [s.key, s]));
    const m = history._meta;
    const metaOut = {
        elections: m.elections,
        lok_sabha_elections: m.lok_sabha_elections,
        statewide: m.statewide,
        share_basis: m.share_basis,
        party_normalisation: m.party_normalisation,
        checks_passed: m.checks_passed,
        built: m.built,
        retrieved: m.retrieved,
    };
    return {
        listSeats: () => SEATS,
        getSeat: (key) => SEAT_BY_KEY.get(key) || null,
        /** Full candidate-level results for one seat, plus its parent Lok Sabha seat. */
        getSeatResults: (key) => {
            const raw = RAW_BY_KEY.get(key);
            if (!raw) return null;
            return { results: raw.results, bypolls: raw.bypolls, lok_sabha_seat: history.lok_sabha[raw.lok_sabha_key] || null };
        },
        overview: (seats) => overview(history, RAW_BY_KEY, seats),
        meta: () => metaOut,
    };
};

/** Thrown when the collection is empty: run scripts/build_election_history.js. */
class NotSeededError extends Error {
    constructor() {
        super('Election results are not loaded yet — run: node scripts/build_election_history.js');
        this.code = 'ELECTIONS_NOT_SEEDED';
    }
}

const fromDocs = (docs) => {
    const metaDoc = docs.find((d) => d.kind === 'meta');
    const seats = docs.filter((d) => d.kind === 'seat').map((d) => d.data).sort((a, b) => a.ac_number - b.ac_number);
    if (!metaDoc || !seats.length) throw new NotSeededError();
    const lokSabha = Object.fromEntries(docs.filter((d) => d.kind === 'lok_sabha').map((d) => [d.key, d.data]));
    return fromHistory({ _meta: metaDoc.data, seats, lok_sabha: lokSabha });
};

const TTL_MS = 10 * 60 * 1000;
let store = null;
let loadedAt = 0;
let inflight = null;

/** The current results, read from the DB at most every 10 minutes. On a failed re-read the last good copy is kept. */
const load = async () => {
    if (store && Date.now() - loadedAt < TTL_MS) return store;
    if (!inflight) {
        inflight = ElectionHistory.find({}).lean()
            .then((docs) => { store = fromDocs(docs); loadedAt = Date.now(); return store; })
            .catch((err) => { if (store) { console.warn('[electoralBase] reload failed, keeping last copy:', err.message); return store; } throw err; })
            .finally(() => { inflight = null; });
    }
    return inflight;
};

module.exports = { load, fromHistory, NotSeededError, placeOf, GENERAL };
