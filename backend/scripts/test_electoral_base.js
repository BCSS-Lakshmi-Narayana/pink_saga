/**
 * test_electoral_base.js
 * ─────────────────────────────────────────────────────────────────────
 * Electoral Base: the election data against officially declared results,
 * well-known seat outcomes, and the API's scope handling. No database: the
 * results are built in memory from data-sources/ and served through a
 * stand-in for the ElectionHistory model.
 *
 *   node scripts/test_electoral_base.js
 */
let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`PASS  ${name}`); }
    else { fail += 1; console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

// The controller reads results and post topics from Mongo and caches them; stand all three in.
const stub = (rel, exportsObj) => {
    const file = require.resolve(rel);
    require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
};
const history = require('./build_election_history'); // builds + verifies, writes nothing when required
const historyDocs = [
    { kind: 'meta', key: 'meta', data: history._meta },
    ...history.seats.map((s) => ({ kind: 'seat', key: s.key, ac_number: s.ac_number, data: s })),
    ...Object.entries(history.lok_sabha).map(([key, pc]) => ({ kind: 'lok_sabha', key, data: pc })),
];
let historyRows = historyDocs;
stub('../src/models/ElectionHistory', { find: () => ({ lean: async () => historyRows }) });
const electoral = require('../src/services/electoralBaseService').fromHistory(history);

const tally = (contests) => contests.reduce((t, c) => { t[c.winner.party] = (t[c.winner.party] || 0) + 1; return t; }, {});
const same = (a, b) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => (a[k] || 0) === (b[k] || 0));
};

console.log('\n── Assembly (MLA): seat tallies equal the declared results ──');
ok('119 assembly seats', history.seats.length === 119);
const ae = (id) => tally(history.seats.map((s) => s.results[id]));
ok('2014: TRS 63 · INC 21 · TDP 15 · AIMIM 7 · BJP 5 · YSRCP 3 · BSP 2 · CPI 1 · CPM 1 · IND 1',
    same(ae('AE2014'), { BRS: 63, INC: 21, TDP: 15, AIMIM: 7, BJP: 5, YSRCP: 3, BSP: 2, CPI: 1, CPM: 1, IND: 1 }), JSON.stringify(ae('AE2014')));
ok('2018: TRS 88 · INC 19 · AIMIM 7 · TDP 2 · BJP 1 · AIFB 1 · IND 1',
    same(ae('AE2018'), { BRS: 88, INC: 19, AIMIM: 7, TDP: 2, BJP: 1, AIFB: 1, IND: 1 }), JSON.stringify(ae('AE2018')));
ok('2023: INC 64 · BRS 39 · BJP 8 · AIMIM 7 · CPI 1',
    same(ae('AE2023'), { INC: 64, BRS: 39, BJP: 8, AIMIM: 7, CPI: 1 }), JSON.stringify(ae('AE2023')));

console.log('\n── Lok Sabha (MP): seat tallies equal the declared results ──');
ok('17 Lok Sabha seats', Object.keys(history.lok_sabha).length === 17);
const ls = (id) => tally(Object.values(history.lok_sabha).map((pc) => pc.results[id]));
ok('2014: TRS 11 · INC 2 · BJP 1 · TDP 1 · YSRCP 1 · AIMIM 1',
    same(ls('LS2014'), { BRS: 11, INC: 2, BJP: 1, TDP: 1, YSRCP: 1, AIMIM: 1 }), JSON.stringify(ls('LS2014')));
ok('2019: TRS 9 · BJP 4 · INC 3 · AIMIM 1', same(ls('LS2019'), { BRS: 9, BJP: 4, INC: 3, AIMIM: 1 }), JSON.stringify(ls('LS2019')));
ok('2024: INC 8 · BJP 8 · AIMIM 1 · BRS 0', same(ls('LS2024'), { INC: 8, BJP: 8, AIMIM: 1 }), JSON.stringify(ls('LS2024')));
ok('every assembly seat is linked to its Lok Sabha seat', history.seats.every((s) => history.lok_sabha[s.lok_sabha_key]));

console.log('\n── well-known results ──');
const seat = (k) => electoral.getSeat(k);
ok('Gajwel: KCR (BRS) won 2014, 2018, 2023', ['AE2014', 'AE2018', 'AE2023'].every((id) => seat('gajwel').assembly[id].winner_party === 'BRS' && /chandrashekar/i.test(seat('gajwel').assembly[id].winner_name)));
ok('Kamareddy 2023: BJP beat KCR, BRS 2nd', seat('kamareddy').assembly.AE2023.winner_party === 'BJP' && seat('kamareddy').assembly.AE2023.brs_place === 2);
ok('Sircilla: KTR won all three, 3 BRS wins', seat('sircilla').brs_assembly_wins === 3 && /rama rao/i.test(seat('sircilla').assembly.AE2023.winner_name));
ok('Jubilee Hills: latest assembly result is the 2025 by-poll, INC won, BRS 2nd',
    seat('jubileehills').latest_assembly.poll_date === '2025-11-11' && seat('jubileehills').latest_assembly.winner_party === 'INC' && seat('jubileehills').latest_assembly.brs_place === 2);
ok('Karimnagar MP: BRS 2014, BJP (Bandi Sanjay) 2019 and 2024',
    seat('sircilla').lok_sabha_results.LS2014.winner_party === 'BRS' && seat('sircilla').lok_sabha_results.LS2019.winner_party === 'BJP'
    && /sanjay/i.test(seat('sircilla').lok_sabha_results.LS2024.winner_name));
const wins = electoral.listSeats().reduce((t, s) => { t[s.brs_assembly_wins] = (t[s.brs_assembly_wins] || 0) + 1; return t; }, {});
ok('BRS win counts cover all 119 seats', Object.values(wins).reduce((a, b) => a + b, 0) === 119, JSON.stringify(wins));
ok('defected-MLA note only where BRS won in 2023', electoral.listSeats().filter((s) => s.defected_mla).every((s) => s.assembly.AE2023.winner_party === 'BRS'));
ok('every election carries a source link', [...history._meta.elections, ...history._meta.lok_sabha_elections].every((e) => e.url && e.publisher));

console.log('\n── year by year: MLA and MP together ──');
const labels = (k) => seat(k).timeline.map((t) => t.label).join(',');
ok('timeline is in date order: MLA 2014, MP 2014, MLA 2018, MP 2019, MLA 2023, MP 2024',
    labels('gajwel') === 'MLA 2014,MP 2014,MLA 2018,MP 2019,MLA 2023,MP 2024', labels('gajwel'));
ok('Gajwel: BRS won all 6', seat('gajwel').brs_wins === 6);
ok('Sircilla: 5 of 6, lost only MP 2024 to BJP', seat('sircilla').brs_wins === 5
    && seat('sircilla').timeline.filter((t) => !t.brs_won).map((t) => `${t.label}:${t.winner_party}`).join() === 'MP 2024:BJP');
ok('Charminar: AIMIM every time, BRS 0 of 6', seat('charminar').brs_wins === 0 && seat('charminar').timeline.every((t) => t.winner_party === 'AIMIM'));
ok('Jubilee Hills: by-poll shown in the timeline but not counted', labels('jubileehills').endsWith('MLA by-poll 2025') && seat('jubileehills').elections_counted === 6);
ok('MP 2014 is labelled as the whole Lok Sabha seat; MP 2019/2024 as the assembly area',
    seat('gajwel').timeline.find((t) => t.id === 'LS2014').level === 'lok_sabha_seat' && seat('gajwel').timeline.find((t) => t.id === 'LS2024').level === 'assembly_area');
ok('every seat is counted out of 6 general elections', electoral.listSeats().every((x) => x.elections_counted === 6));
const g24 = seat('gajwel').timeline.find((t) => t.id === 'LS2024');
ok('Gajwel MP 2024: BRS led the Gajwel area, BJP (Raghunandan Rao) won the Medak seat',
    g24.brs_won && g24.lok_sabha_seat === 'Medak' && g24.seat_winner_party === 'BJP' && /raghunandan/i.test(g24.seat_winner_name));

console.log('\n── districts (CEO Telangana, current) ──');
ok('Gajwel is in Siddipet district (Medak is its Lok Sabha seat)', seat('gajwel').district === 'Siddipet' && seat('gajwel').lok_sabha === 'Medak');
ok('Husnabad → Siddipet, Khanapur → Nirmal, Waradhanapet → Hanumakonda',
    seat('husnabad').district === 'Siddipet' && seat('khanapur').district === 'Nirmal' && seat('waradhanapet').district === 'Hanumakonda');
ok('all 33 districts used', new Set(electoral.listSeats().map((x) => x.district)).size === 33);

console.log('\n── core / swing / opposition (statewide) ──');
const o = electoral.overview(electoral.listSeats());
const share = (p, id) => o.opposition.party_shares.find((x) => x.party === p).share[id];
const nearly = (a, b) => Math.abs(a - b) <= 0.2;
// Published statewide vote shares (ECI): AE 2023 BRS 37.35 · INC 39.40 · BJP 13.90; LS 2024 BRS 16.68 · INC 40.10 · BJP 35.08.
ok('statewide 2023 assembly shares match ECI (BRS 37.35, INC 39.40, BJP 13.90)',
    nearly(share('BRS', 'AE2023'), 37.35) && nearly(share('INC', 'AE2023'), 39.4) && nearly(share('BJP', 'AE2023'), 13.9));
ok('statewide 2024 Lok Sabha shares match ECI (BRS 16.68, INC 40.10, BJP 35.08)',
    nearly(share('BRS', 'LS2024'), 16.68) && nearly(share('INC', 'LS2024'), 40.1) && nearly(share('BJP', 'LS2024'), 35.08));
ok('core: Siddipet, Dubbak, Gajwel won all 6', o.core.all_six.map((s) => s.key).sort().join() === 'dubbak,gajwel,siddipet');
ok('core: seat-type groups cover 119 seats', o.core.by_seat_type.reduce((t, g) => t + g.seats, 0) === 119);
ok('opposition: BRS 2018 seats = held in 2023 + lost to each party (88 = 34 + 47 INC + 7 BJP)',
    o.opposition.brs_seats_2018 === 88 && o.opposition.brs_held_2023 + o.opposition.lost_to.reduce((t, x) => t + x.seats, 0) === 88
    && o.opposition.lost_to[0].party === 'INC');
ok('swing: Kamareddy (3.5 pts) is a close 2023 contest; Gajwel (19.4 pts) is not',
    o.swing.close_2023.some((s) => s.key === 'kamareddy') && !o.swing.close_2023.some((s) => s.key === 'gajwel'));
ok('swing: Vemulawada changed hands BRS → INC in 2023', o.swing.changed_hands_2018_2023.some((s) => s.key === 'vemulawada' && s.from === 'BRS' && s.to === 'INC'));
ok('opposition: all three parties\' 2023 manifestos carried with sources',
    ['INC', 'BJP', 'BRS'].every((p) => o.opposition.manifestos_2023.some((m) => m.party === p && m.promises.length && m.sources.length)));
ok('seat facts: Gajwel — BJP gained most 2018→2023 (+27.9), demographics present',
    seat('gajwel').facts.vote_share_change_2018_2023[0].party === 'BJP' && seat('gajwel').facts.demographics.electors_2023 > 0);

console.log('\n── API ──');
const cacheStore = new Map();
stub('../src/services/cacheService', { get: async (k) => cacheStore.get(k) || null, set: async (k, v) => { cacheStore.set(k, v); } });
stub('../src/models/Grievance', {
    aggregate: async () => [
        { _id: { seat: 'GAJWEL', topic: 'Irrigation' }, n: 6, negative: 4 },
        { _id: { seat: 'Gajwel', topic: 'Roads' }, n: 3, negative: 3 },
        { _id: { seat: 'GAJWEL', topic: 'Normal' }, n: 11, negative: 0 },
    ],
});
delete require.cache[require.resolve('../src/controllers/electoralBaseController')];
const api = require('../src/controllers/electoralBaseController');
const call = async (fn, req) => {
    let out = null; let code = 200;
    const res = { status(c) { code = c; return this; }, json(b) { out = b; return this; } };
    await fn({ query: {}, params: {}, ...req }, res);
    return { code, body: out };
};
const all = { canSeeAll: true, isSuperAdmin: true, constituencyKeys: new Set() };
const scoped = { canSeeAll: false, isSuperAdmin: false, constituencyKeys: new Set(['gajwel', 'siddipet']) };
(async () => {
    ok('statewide user gets 119 seats', (await call(api.getSeats, { scope: all })).body.count === 119);
    const mine = (await call(api.getSeats, { scope: scoped })).body;
    ok('seat-scoped user gets only their seats', mine.count === 2 && mine.data.every((x) => ['gajwel', 'siddipet'].includes(x.key)));
    ok('a seat outside scope is a 404', (await call(api.getSeat, { scope: scoped, params: { key: 'kamareddy' } })).code === 404);
    ok('non-string filter is ignored', (await call(api.getSeats, { scope: all, query: { district: { $ne: 'x' } } })).body.count === 119);
    const one = await call(api.getSeat, { scope: all, params: { key: 'JUBILEE HILLS' } });
    ok('seat detail resolves a display name and carries full results, by-poll and Lok Sabha seat',
        one.code === 200 && one.body.data.results.AE2023.candidates.length > 3 && one.body.data.bypolls.length === 1
        && one.body.data.lok_sabha_seat.name === 'Secunderabad' && typeof one.body.data.lok_sabha === 'string');
    const gj = (await call(api.getSeat, { scope: all, params: { key: 'gajwel' } })).body.data.issues;
    ok('seat issues: casing variants merge, "Normal" excluded, top topic first', gj.posts === 20 && gj.top[0].topic === 'Irrigation' && !gj.top.some((t) => t.topic === 'Normal'));
    const ov = (await call(api.getOverview, { scope: scoped })).body;
    ok('overview is computed over the user\'s seats only', ov.data.seats === 2 && ov.scoped === true);

    // A fresh backend with an empty collection answers 503 with the seed command, not a crash.
    historyRows = [];
    delete require.cache[require.resolve('../src/services/electoralBaseService')];
    delete require.cache[require.resolve('../src/controllers/electoralBaseController')];
    const empty = await call(require('../src/controllers/electoralBaseController').getSeats, { scope: all });
    ok('empty election_history collection → 503 naming the build script', empty.code === 503 && /build_election_history/.test(empty.body.message));

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
