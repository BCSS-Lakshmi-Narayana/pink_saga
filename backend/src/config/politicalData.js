/**
 * politicalData.js — who exists in Telangana's political universe.
 * ─────────────────────────────────────────────────────────────────────
 * Single source of truth for this deployment. `politicalEntities.js` and
 * `deployment.js` are derived views over it.
 *
 * ⚠ THIS DEPLOYMENT'S CLIENT IS AN OPPOSITION PARTY.
 *
 * Every earlier deployment of this codebase (Chhattisgarh, Goa, AP) had the
 * client in power, so "ours" and "the government" meant the same thing and the
 * code could blur them. Here they are OPPOSITES:
 *
 *      ours        = BRS — 27 MLAs, Leader of Opposition, out of power since Dec 2023
 *      opposition  = the INC government of Chief Minister Revanth Reddy, plus
 *                    BJP, AIMIM, CPI, CPI(M), and Kavitha's breakaway TRS(K)
 *
 * So: the Chief Minister is a TARGET, not a principal. The Speaker sits with
 * the other side. There is no cabinet of ours — `OUR_FRONTBENCH` (the
 * legislature-party leadership) is what replaces `CABINET_MINISTERS`, and
 * `PARTY_CHIEF` replaces `CHIEF_MINISTER` as the brief's principal reader.
 *
 * ── Handles ──────────────────────────────────────────────────────────
 * Only independently verified accounts are listed. Everything else is left
 * EMPTY rather than guessed: a wrong handle silently mis-attributes every post
 * from it, and mis-attribution on the author side corrupts the stance engine's
 * author-is-target correction. Unverified accounts are named in
 * data/state_leader_handles.json under a status that keeps them out of here.
 *
 * ── The "TRS" collision — read before touching aliases ───────────────
 * "TRS" now means three different things:
 *    1. Telangana Rashtra Samithi — this party's OWN name until Oct 2022
 *    2. Telangana Rakshana Sena   — K. Kavitha's breakaway, founded 25 Apr 2026
 *    3. @trspartyonline           — a legacy BRS-era handle still in circulation
 * Bare "TRS" is therefore NOT an alias of anything here. Only the unambiguous
 * full names are encoded, and Kavitha's party carries the internal code
 * `TRS(K)` — same disambiguation convention the Chhattisgarh build used for
 * `JCC(J)`. Encoding bare "TRS" against BRS would silently resolve every
 * Kavitha mention to her father's party.
 */

const VOTER_PROFILES = require('../data/state_voter_profiles.json');

const normalizeHandle = (h) => String(h || '').trim().replace(/^@/, '').toLowerCase();

/**
 * Verified X / Instagram / Facebook accounts (data/state_leader_handles.json,
 * with status and evidence per handle). Merged into every leader and party
 * below, so a leader is recognised when a post tags them AND when they are the
 * post's author — which is what the stance engine's author-is-target
 * correction and cross-camp prior depend on.
 */
const HANDLE_REGISTRY = require('../data/state_leader_handles.json');
const registryHandles = (entries) => (entries || []).map((e) => `@${e.handle}`);
const mergeHandles = (...lists) => {
    const seen = new Set();
    const out = [];
    for (const h of lists.flat()) {
        const k = normalizeHandle(h);
        if (k && !seen.has(k)) { seen.add(k); out.push(h.startsWith('@') ? h : `@${h}`); }
    }
    return out;
};

/** Assembly-constituency key: strips any "(SC)"/"(ST)" reservation suffix and
 *  punctuation, so "MAHABUBNAGAR (SC)" === "Mahabubnagar". */
const acKey = (s) => String(s || '')
    .toLowerCase()
    .replace(/\((?:sc|st)\)/g, '')
    .replace(/[^a-z0-9]/g, '');

const nameKey = (s) => String(s || '')
    .toLowerCase()
    .replace(/\b(?:dr|doctor|sri|smt|shri|capt|captain|adv|engr)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Results data spells parties out in full; the roster uses short codes. */
const normalizeParty = (p) => {
    const v = String(p || '').trim();
    // "Samithi" = this party (renamed from Telangana Rashtra Samithi, Oct 2022).
    if (/^bharat\s*rashtra\s*samithi/i.test(v)) return 'BRS';
    if (/^telangana\s*rashtra\s*samithi/i.test(v)) return 'BRS';
    // "Sena" = Kavitha's 2026 breakaway. One word apart from the line above —
    // which is exactly why bare "TRS" is never matched here.
    if (/^telangana\s*raksh?ana\s*sena/i.test(v)) return 'TRS(K)';
    if (/^telangana\s*rashtra\s*sena/i.test(v)) return 'TRS(K)';
    if (/^indian\s*national\s*congress/i.test(v)) return 'INC';
    if (/^bharatiya\s*janata/i.test(v)) return 'BJP';
    if (/^all\s*india\s*majlis/i.test(v)) return 'AIMIM';
    if (/^communist\s*party\s*of\s*india\s*\(?\s*marxist/i.test(v)) return 'CPM';
    if (/^communist\s*party\s*of\s*india$/i.test(v)) return 'CPI';
    if (/^independent$/i.test(v)) return 'IND';
    if (/^vacant$/i.test(v)) return 'VACANT';
    return v.toUpperCase();
};

/**
 * Party codes that count as OUR camp. BRS contests alone — it has no alliance
 * in this Assembly — so this is a single-entry list, kept as an array because
 * the rest of the pipeline iterates it.
 */
const ALLY_PARTY_CODES = ['BRS'];

/**
 * MLAs who won on a BRS ticket and crossed to Congress are marked in the
 * ROSTER (`mla.defected_to` in state_voter_profiles.json), not by a list of
 * constituency keys here.
 *
 * That is deliberate. A hand-kept key list has to reproduce the ECI's exact
 * spelling of each seat, and the first attempt at one silently missed Kadiyam
 * Srihari because the ECI writes "GHANPUR (STATION)" where the press writes
 * "Station Ghanpur" — a miss that costs nothing visible and quietly moves a
 * defector back into our own camp's numbers. The roster already holds the
 * canonical spellings, so it decides.
 *
 * Why they are not counted as ours: on 11 Mar 2026 the Speaker dismissed BRS's
 * disqualification petitions against all ten, so on the House's books they are
 * still BRS while in practice they work with the government. Counting them as
 * clean BRS voices would pad every "our camp said X" figure with people
 * campaigning for the other side.
 *
 * One case is genuinely unsettled: BRS reportedly withdrew its petition
 * against G. Mahipal Reddy (Patancheru) after he returned to the party, and he
 * denied defecting in an affidavit to the Supreme Court. He is recorded with
 * the rest pending an editorial decision.
 */

/**
 * Independents have no party alignment of their own, so their side comes from
 * the roster's `alliance` field. Telangana's one Independent — T. Raja Singh
 * (Goshamahal), who quit BJP in 2025 — is anti-Congress but not BRS-aligned,
 * so the default lands him on the opposition side, which is correct: he is a
 * rival for the same anti-government space, not an ally.
 */
const sideForParty = (party, alliance) => {
    const code = normalizeParty(party);
    if (ALLY_PARTY_CODES.includes(code)) return 'ours';
    if (code === 'IND') return String(alliance || '').toUpperCase() === 'BRS' ? 'ours' : 'opposition';
    return 'opposition';
};

/** Current district of an AC, from the roster (33 districts since Feb 2019). */
const DISTRICT_BY_AC = new Map(
    VOTER_PROFILES.map((row) => [acKey(row.constituency), row.district || '']),
);
const districtFor = (constituency, fallback = '') =>
    DISTRICT_BY_AC.get(acKey(constituency)) || fallback;

const tagLeaders = (leaders, party, side) =>
    leaders.map((l) => {
        const handles = mergeHandles(l.handles || [], registryHandles(HANDLE_REGISTRY.people[l.id]));
        const primary_handle = handles[0] || '';
        return {
            ...l,
            district: l.constituency ? districtFor(l.constituency, l.district || '') : (l.district || ''),
            party: l.party || party,
            side: l.side || side,
            handles,
            primary_handle,
            primary_handle_normalized: normalizeHandle(primary_handle),
            handles_normalized: handles.map(normalizeHandle).filter(Boolean),
        };
    });

// ─────────────────────────────────────────────────────────
// PARTIES
// ─────────────────────────────────────────────────────────

const OUR_PARTY = {
    id: 'brs',
    name: 'BRS',
    full_name: 'Bharat Rashtra Samithi',
    // Note the absence of bare "TRS" — see the header. "Telangana Rashtra
    // Samithi" (samithi) is this party's own former name and is unambiguous;
    // "Telangana Rakshana Sena" (sena) is Kavitha's and belongs to TRS(K).
    aliases: [
        'BRS', 'Bharat Rashtra Samithi', 'BRS Party', 'Bharath Rashtra Samithi',
        'Telangana Rashtra Samithi', 'Telangana Rashtra Samiti',
        'Car party', 'Pink party',
        'బీఆర్ఎస్', 'భారత్ రాష్ట్ర సమితి', 'తెలంగాణ రాష్ట్ర సమితి', 'కారు పార్టీ', 'గులాబీ పార్టీ',
    ],
    alliance: 'None',
    /**
     * ⚠ 'opposition', not 'ruling'. Consumers that branch on this — prompt
     * builders especially — must not describe our camp as the government.
     */
    role: 'opposition',
    state: 'Telangana',
    chief: 'K. Chandrashekar Rao',
    working_president: 'K. T. Rama Rao',
    /** A state party: the national president IS the state chief. */
    state_president: 'K. Chandrashekar Rao',
    symbol: 'Car',
    handles: ['@BRSparty'],
    /** Out of power since 7 Dec 2023; next general election due ~Nov/Dec 2028. */
    in_power: false,
    seats_assembly: 27,
};

/** BRS contests alone in this Assembly. Kept (empty) because callers iterate it. */
const ALLY_PARTIES = [];

// ─────────────────────────────────────────────────────────
// OUR FRONT BENCH — the BRS legislature-party leadership.
//
// This is the structural replacement for `CABINET_MINISTERS`. BRS holds no
// ministries, so there is no cabinet to list; what a reader of this brief
// actually needs is who speaks for the party in the House and in public.
//
// KCR is both party president and Leader of the Opposition, which makes him
// the brief's principal (see PARTY_CHIEF / deployment.js).
// ─────────────────────────────────────────────────────────
const _OUR_FRONTBENCH_RAW = [
    {
        id: 'kcr', name: 'K. Chandrashekar Rao', shortName: 'KCR',
        aliases: [
            'KCR', 'K Chandrashekar Rao', 'Kalvakuntla Chandrashekar Rao', 'Chandrashekar Rao',
            'Chandrasekhar Rao', 'K Chandrasekhar Rao', 'KCR garu', 'Former CM KCR', 'Ex-CM KCR',
            'BRS chief', 'BRS president', 'Leader of Opposition',
            'కేసీఆర్', 'చంద్రశేఖర్ రావు', 'కల్వకుంట్ల చంద్రశేఖర్ రావు',
        ],
        role: 'President, Bharat Rashtra Samithi (since 27 Apr 2001); Leader of the Opposition, Telangana Legislative Assembly (since 16 Dec 2023); Chief Minister of Telangana 2014-2023',
        constituency: 'Gajwel', party: 'BRS',
        // Joined X and Instagram 27 Apr 2024; posts rarely — he has kept a low
        // public profile since a Dec 2023 hip surgery, with KTR running
        // day-to-day operations. Low volume is expected, not a data fault.
        handles: ['@KCRBRSPresident'],
    },
    {
        id: 'ktr', name: 'K. T. Rama Rao', shortName: 'KTR',
        aliases: [
            'KTR', 'K T Rama Rao', 'Kalvakuntla Taraka Rama Rao', 'Taraka Rama Rao', 'Rama Rao',
            'BRS working president', 'Working President KTR', 'Former IT Minister KTR',
            'కేటీఆర్', 'తారక రామారావు', 'కల్వకుంట్ల తారక రామారావు',
        ],
        role: 'Working President, Bharat Rashtra Samithi (since 15 Dec 2018); former Minister for IT and Municipal Administration & Urban Development',
        constituency: 'Sircilla', party: 'BRS',
        handles: ['@KTRBRS'],
    },
    {
        id: 'harish-rao', name: 'T. Harish Rao', shortName: 'Harish Rao',
        aliases: [
            'Harish Rao', 'Thanneeru Harish Rao', 'T Harish Rao', 'Tanneeru Harish Rao',
            'Former Finance Minister Harish Rao', 'Former Irrigation Minister Harish Rao',
            'హరీష్ రావు', 'తన్నీరు హరీష్ రావు',
        ],
        role: 'Deputy Leader, BRS Legislature Party; MLA Siddipet since 2004 (7th term); former Minister for Irrigation, later Finance and Health',
        constituency: 'Siddipet', party: 'BRS',
        handles: ['@BRSHarish'],
    },
    {
        id: 'sabitha-indra-reddy', name: 'Sabitha Indra Reddy', shortName: 'Sabitha Indra Reddy',
        aliases: ['Sabitha Indra Reddy', 'Sabitha Indrareddy', 'సబితా ఇంద్రా రెడ్డి'],
        role: 'Deputy Floor Leader, BRS Legislature Party; former Minister for Education; former Home Minister (undivided AP)',
        constituency: 'Maheswaram', party: 'BRS', handles: [],
    },
    {
        id: 'talasani-srinivas-yadav', name: 'Talasani Srinivas Yadav', shortName: 'Talasani Srinivas Yadav',
        aliases: ['Talasani Srinivas Yadav', 'Talasani', 'తలసాని శ్రీనివాస్ యాదవ్'],
        role: 'Deputy Floor Leader, BRS Legislature Party; former Minister for Animal Husbandry',
        constituency: 'Sanathnagar', party: 'BRS', handles: [],
    },
    {
        id: 'kotha-prabhakar-reddy', name: 'Kotha Prabhakar Reddy', shortName: 'Kotha Prabhakar Reddy',
        aliases: ['Kotha Prabhakar Reddy', 'కొత్త ప్రభాకర్ రెడ్డి'],
        role: 'MLA, Dubbak; former MP, Medak',
        constituency: 'Dubbak', party: 'BRS', handles: [],
    },
];

/**
 * BRS organisation.
 *
 * ⚠ STALENESS WARNING: in April 2026 KCR dissolved ALL BRS committees at every
 * level except the state committee (and all NRI committees), handing KTR the
 * job of reconstituting them alongside a fresh membership drive. Any
 * district- or constituency-level office-bearer list is therefore in flux.
 * Only posts confirmed after that dissolution are listed here.
 *
 * A SECOND working president post, earmarked for a Backward Classes leader,
 * was reported as planned for around Sept-Oct 2026. It is deliberately NOT
 * encoded — no appointment has been confirmed.
 */
const _PARTY_ORG_RAW = [
    {
        id: 'j-santosh-kumar', name: 'Joginapally Santosh Kumar', shortName: 'Santosh Kumar',
        aliases: ['J Santosh Kumar', 'Santosh Kumar', 'JSK', 'జోగినపల్లి సంతోష్ కుమార్'],
        // Rajya Sabha term ended 2 Apr 2024 — a party office-bearer, not a sitting MP.
        role: 'General Secretary, Bharat Rashtra Samithi; former MP (Rajya Sabha, term ended Apr 2024)',
        constituency: '', party: 'BRS', handles: [],
    },
    {
        id: 'vaddiraju-ravichandra', name: 'Vaddiraju Ravichandra', shortName: 'Vaddiraju Ravichandra',
        aliases: ['Vaddiraju Ravichandra', 'Ravichandra Vaddiraju', 'వడ్డిరాజు రవిచంద్ర'],
        role: 'Leader, BRS Parliamentary Party and BRS floor leader in the Rajya Sabha (appointed 9 Jul 2026); MP (Rajya Sabha, term to Apr 2030)',
        constituency: '', party: 'BRS', handles: [],
    },
    {
        id: 'damodar-rao', name: 'Divakonda Damodar Rao', shortName: 'D. Damodar Rao',
        aliases: ['Damodar Rao', 'D Damodar Rao', 'Divakonda Damodar Rao', 'దామోదర్ రావు'],
        role: 'BRS Whip, Rajya Sabha; MP (Rajya Sabha, term to Jun 2028)',
        constituency: '', party: 'BRS', handles: [],
    },
];

// ─────────────────────────────────────────────────────────
// THE GOVERNMENT — Revanth Reddy ministry (INC). Sworn in 7 Dec 2023.
//
// ⚠ On the OPPOSITION side of this deployment's matrix. These are the people
// the brief's reader is up against, not colleagues.
//
// Portfolio mapping below is partially unverified — the CM, Deputy CM and the
// three senior ministers are confirmed; the remaining portfolio assignments
// need a second source before anything downstream depends on them.
// ─────────────────────────────────────────────────────────
const _RULING_CABINET_RAW = [
    {
        id: 'revanth-reddy', name: 'A. Revanth Reddy', shortName: 'Revanth Reddy',
        aliases: [
            'Revanth Reddy', 'Anumula Revanth Reddy', 'A Revanth Reddy', 'CM Revanth', 'CM Revanth Reddy',
            'Telangana CM', 'Chief Minister Revanth Reddy', 'Revanth sarkar', 'Revanth government',
            'రేవంత్ రెడ్డి', 'అనుముల రేవంత్ రెడ్డి', 'ముఖ్యమంత్రి రేవంత్ రెడ్డి',
        ],
        role: 'Chief Minister of Telangana (since 7 Dec 2023)',
        portfolios: ['General Administration', 'Home', 'Law & Order', 'Municipal Administration & Urban Development', 'all unallocated departments'],
        constituency: 'Kodangal', party: 'INC',
        handles: ['@revanth_anumula', '@TelanganaCMO'],
    },
    {
        id: 'bhatti-vikramarka', name: 'Mallu Bhatti Vikramarka', shortName: 'Bhatti Vikramarka',
        aliases: ['Bhatti Vikramarka', 'Mallu Bhatti Vikramarka', 'Deputy CM Bhatti', 'భట్టి విక్రమార్క'],
        role: 'Deputy Chief Minister of Telangana',
        portfolios: ['Finance & Planning', 'Energy'],
        constituency: 'Madhira', party: 'INC', handles: [],
    },
    {
        id: 'uttam-kumar-reddy', name: 'N. Uttam Kumar Reddy', shortName: 'Uttam Kumar Reddy',
        aliases: ['Uttam Kumar Reddy', 'N Uttam Kumar Reddy', 'Nalamada Uttam Kumar Reddy', 'ఉత్తమ్ కుమార్ రెడ్డి'],
        role: 'Minister for Irrigation & Command Area Development, Food & Civil Supplies',
        portfolios: ['Irrigation & CAD', 'Food & Civil Supplies'],
        constituency: 'Huzurnagar', party: 'INC', handles: [],
    },
    {
        id: 'sridhar-babu', name: 'D. Sridhar Babu', shortName: 'Sridhar Babu',
        aliases: ['Sridhar Babu', 'D Sridhar Babu', 'Duddilla Sridhar Babu', 'శ్రీధర్ బాబు'],
        role: 'Minister for IT, Electronics & Communications, Industries & Commerce, Legislative Affairs',
        portfolios: ['IT, Electronics & Communications', 'Industries & Commerce', 'Legislative Affairs'],
        constituency: 'Manthani', party: 'INC', handles: [],
    },
    {
        id: 'ponguleti-srinivasa-reddy', name: 'Ponguleti Srinivasa Reddy', shortName: 'Ponguleti Srinivasa Reddy',
        aliases: ['Ponguleti Srinivasa Reddy', 'Ponguleti', 'పొంగులేటి శ్రీనివాస రెడ్డి'],
        role: 'Minister for Revenue', portfolios: ['Revenue'],
        constituency: 'Palair', party: 'INC', handles: [],
    },
    {
        id: 'komatireddy-venkat-reddy', name: 'Komatireddy Venkat Reddy', shortName: 'Komatireddy Venkat Reddy',
        aliases: ['Komatireddy Venkat Reddy', 'Komatireddy', 'కోమటిరెడ్డి వెంకట్ రెడ్డి'],
        role: 'Minister for Roads & Buildings', portfolios: ['Roads & Buildings'],
        constituency: 'Nalgonda', party: 'INC', handles: [],
    },
    {
        id: 'damodar-raja-narasimha', name: 'Damodar Raja Narasimha', shortName: 'Damodar Raja Narasimha',
        aliases: ['Damodar Raja Narasimha', 'Raja Narasimha', 'దామోదర రాజనర్సింహ'],
        role: 'Minister for Health, Medical & Family Welfare', portfolios: ['Health & Family Welfare'],
        constituency: 'Andole', party: 'INC', handles: [],
    },
    {
        id: 'seethakka', name: 'Danasari Anasuya', shortName: 'Seethakka',
        aliases: ['Seethakka', 'Sithakka', 'Danasari Anasuya', 'D Anasuya', 'సీతక్క', 'దనసరి అనసూయ'],
        role: 'Minister for Panchayat Raj & Rural Development, Women & Child Welfare',
        portfolios: ['Panchayat Raj & Rural Development', 'Women & Child Welfare'],
        constituency: 'Mulug', party: 'INC', handles: [],
    },
    {
        id: 'ponnam-prabhakar', name: 'Ponnam Prabhakar', shortName: 'Ponnam Prabhakar',
        aliases: ['Ponnam Prabhakar', 'పొన్నం ప్రభాకర్'],
        role: 'Minister for Transport & BC Welfare', portfolios: ['Transport', 'BC Welfare'],
        constituency: 'Husnabad', party: 'INC', handles: [],
    },
    {
        id: 'jupally-krishna-rao', name: 'Jupally Krishna Rao', shortName: 'Jupally Krishna Rao',
        aliases: ['Jupally Krishna Rao', 'Jupally', 'జూపల్లి కృష్ణారావు'],
        role: 'Minister for Tourism & Culture, Excise', portfolios: ['Tourism & Culture', 'Excise'],
        constituency: 'Kollapur', party: 'INC', handles: [],
    },
];

/**
 * Presiding officers.
 *
 * ⚠ INVERTED relative to earlier deployments. In Chhattisgarh and Goa the
 * Speaker belonged to the client's party and sat on "our" side. Telangana's
 * Speaker is Congress, so presiding officers sit with the OPPOSITION here —
 * and `politicalEntities.js` must align them accordingly rather than
 * inheriting the old `alignment: 'ally'`.
 *
 * The Speaker is also politically live in his own right: he dismissed BRS's
 * disqualification petitions against the ten defectors on 11 Mar 2026.
 */
const _PRESIDING_OFFICERS_RAW = [
    {
        id: 'gaddam-prasad-kumar', name: 'Gaddam Prasad Kumar', shortName: 'Gaddam Prasad Kumar',
        aliases: ['Gaddam Prasad Kumar', 'Speaker Prasad Kumar', 'గడ్డం ప్రసాద్ కుమార్'],
        role: 'Speaker, Telangana Legislative Assembly (since 14 Dec 2023)',
        constituency: 'Vicarabad', party: 'INC', handles: [],
    },
];

// ─────────────────────────────────────────────────────────
// RIVALS — hand-curated. MLAs among them are skipped by the derived roster
// below, so nobody becomes two entities.
// ─────────────────────────────────────────────────────────

const _INC_LEADERS_RAW = [
    {
        id: 'mahesh-kumar-goud', name: 'Bomma Mahesh Kumar Goud', shortName: 'Mahesh Kumar Goud',
        aliases: ['Mahesh Kumar Goud', 'Bomma Mahesh Kumar Goud', 'TPCC president', 'మహేష్ కుమార్ గౌడ్'],
        role: 'President, Telangana Pradesh Congress Committee (since 6 Sep 2024)',
        constituency: '', party: 'INC', handles: [],
    },
];

const _BJP_LEADERS_RAW = [
    {
        id: 'ramchander-rao', name: 'N. Ramchander Rao', shortName: 'Ramchander Rao',
        aliases: ['Ramchander Rao', 'N Ramchander Rao', 'Naraparaju Ramchander Rao', 'BJP state president', 'రాంచందర్ రావు'],
        role: 'State President, BJP Telangana (appointed 30 Jun 2025, took charge 1 Jul 2025); senior advocate; former MLC',
        constituency: '', party: 'BJP', handles: [],
    },
    {
        house: 'parliament', id: 'kishan-reddy', name: 'G. Kishan Reddy', shortName: 'Kishan Reddy',
        aliases: ['Kishan Reddy', 'G Kishan Reddy', 'Gangapuram Kishan Reddy', 'కిషన్ రెడ్డి'],
        role: 'Union Minister; MP, Secunderabad; BJP Telangana state president Jul 2023 - Jun 2025',
        constituency: 'Secunderabad', party: 'BJP', handles: [],
    },
    {
        house: 'parliament', id: 'bandi-sanjay', name: 'Bandi Sanjay Kumar', shortName: 'Bandi Sanjay',
        aliases: ['Bandi Sanjay', 'Bandi Sanjay Kumar', 'బండి సంజయ్', 'బండి సంజయ్ కుమార్'],
        role: 'Union Minister of State for Home Affairs (since 9 Jun 2024); MP, Karimnagar; former BJP Telangana state president',
        constituency: 'Karimnagar', party: 'BJP', handles: [],
    },
    {
        house: 'parliament', id: 'dk-aruna', name: 'D. K. Aruna', shortName: 'DK Aruna',
        aliases: ['DK Aruna', 'D K Aruna', 'Dharmapuri Kondala Aruna', 'డీకే అరుణ'],
        role: 'MP, Mahabubnagar; BJP National Vice President',
        constituency: 'Mahabubnagar', party: 'BJP', handles: [],
    },
    {
        house: 'parliament', id: 'eatala-rajender', name: 'Eatala Rajender', shortName: 'Eatala Rajender',
        aliases: ['Eatala Rajender', 'Etela Rajender', 'Etala Rajender', 'ఈటల రాజేందర్'],
        // Sacked from the BRS cabinet by KCR in 2021, then defected to BJP —
        // a personally invested anti-KCR voice, not a generic rival.
        role: 'MP, Malkajgiri; former BRS Minister for Health, sacked 2021 and later joined BJP',
        constituency: 'Malkajgiri', party: 'BJP', handles: [],
    },
];

const _AIMIM_LEADERS_RAW = [
    {
        house: 'parliament',
        id: 'asaduddin-owaisi', name: 'Asaduddin Owaisi', shortName: 'Asaduddin Owaisi',
        aliases: ['Asaduddin Owaisi', 'Asad Owaisi', 'Owaisi', 'Barrister Owaisi', 'అసదుద్దీన్ ఒవైసీ'],
        role: 'National President, AIMIM; MP, Hyderabad',
        constituency: 'Hyderabad', party: 'AIMIM', handles: ['@asadowaisi'],
    },
    {
        id: 'akbaruddin-owaisi', name: 'Akbaruddin Owaisi', shortName: 'Akbaruddin Owaisi',
        aliases: ['Akbaruddin Owaisi', 'Akbar Owaisi', 'అక్బరుద్దీన్ ఒవైసీ'],
        role: 'AIMIM floor leader, Telangana Legislative Assembly; MLA, Chandrayangutta',
        constituency: 'Chandrayangutta', party: 'AIMIM', handles: ['@AkbarOwaisi_MIM'],
    },
];

const _CPI_LEADERS_RAW = [
    {
        id: 'kunamneni-sambasiva-rao', name: 'Kunamneni Sambasiva Rao', shortName: 'Kunamneni Sambasiva Rao',
        aliases: ['Kunamneni Sambasiva Rao', 'Sambasiva Rao', 'కూనంనేని సాంబశివరావు'],
        role: 'State Secretary, CPI Telangana (since Sep 2022); MLA, Kothagudem',
        constituency: 'Kothagudem', party: 'CPI', handles: [],
    },
];

const _CPM_LEADERS_RAW = [
    {
        id: 'john-wesley', name: 'Jaggula John Wesley', shortName: 'John Wesley',
        aliases: ['John Wesley', 'Jaggula John Wesley', 'జాగుల జాన్ వెస్లీ'],
        role: 'State Secretary, CPI(M) Telangana (elected 28 Jan 2025)',
        constituency: '', party: 'CPM', handles: [],
    },
];

/**
 * K. Kavitha and her breakaway party.
 *
 * She is KCR's daughter and KTR's sister, which makes her the single most
 * error-prone entity in this deployment: family association plus the recycled
 * "TRS" abbreviation will pull her toward BRS in any naive resolver. She is
 * NOT BRS — suspended 2 Sep 2025 for anti-party activity, quit the next day,
 * resigned her MLC seat (accepted 6 Jan 2026), and launched her own party on
 * 25 Apr 2026. She attacks BOTH Congress and BRS, and has specifically
 * targeted Harish Rao's Siddipet base.
 *
 * Legal status matters for how coverage of her should read: a Delhi court
 * DISCHARGED her in the excise-policy case on 26 Feb 2026; the CBI has
 * appealed to the Delhi High Court. She is not an accused facing trial.
 */
const _TRS_K_LEADERS_RAW = [
    {
        id: 'kavitha', name: 'Kalvakuntla Kavitha', shortName: 'K. Kavitha',
        aliases: [
            'K Kavitha', 'Kavitha', 'Kalvakuntla Kavitha', 'Kavitha Kalvakuntla',
            'MLC Kavitha', 'కవిత', 'కల్వకుంట్ల కవిత',
        ],
        role: 'Founder & President, Telangana Rakshana Sena (launched 25 Apr 2026); former MP Nizamabad (2014-19); former MLC; suspended from BRS 2 Sep 2025',
        constituency: '', party: 'TRS(K)', handles: ['@RaoKavitha'],
    },
];

/**
 * T. Raja Singh — Independent since 2025.
 *
 * He won Goshamahal on a BJP ticket in 2023 but resigned from the party in
 * protest at Ramchander Rao's appointment as state president. Kept as his own
 * entity rather than folded into BJP: he has an outsized social footprint and
 * attacks the state BJP as often as he attacks the government.
 */
const _IND_LEADERS_RAW = [
    {
        id: 'raja-singh', name: 'T. Raja Singh', shortName: 'Raja Singh',
        aliases: ['Raja Singh', 'T Raja Singh', 'Tiger Raja Singh', 'Raja Singh Lodha', 'రాజా సింగ్'],
        role: 'MLA, Goshamahal; Independent since resigning from BJP in 2025',
        constituency: 'Goshamahal', party: 'IND', handles: [],
    },
];

// ─────────────────────────────────────────────────────────
// NATIONAL figures frequently named in Telangana political chat.
//
// ⚠ Both national blocs sit OPPOSITE us here. BRS is aligned with neither the
// NDA nor the INDIA bloc, so Modi/Shah AND Rahul/Kharge are all rivals — the
// Chhattisgarh build's "national ally" concept has no occupant in Telangana.
// The collection is kept (empty) because callers iterate it.
// ─────────────────────────────────────────────────────────
const _NATIONAL_ALLY_RAW = [];

const _NATIONAL_OPPOSITION_RAW = [
    { id: 'narendra-modi', name: 'Narendra Modi', shortName: 'Modi', aliases: ['Modi', 'Modi ji', 'PM Modi', 'Prime Minister Modi', 'నరేంద్ర మోదీ', 'మోదీ'], role: 'Prime Minister of India', constituency: 'Varanasi', party: 'BJP', scope: 'national', handles: ['@narendramodi', '@PMOIndia'] },
    { id: 'amit-shah', name: 'Amit Shah', shortName: 'Amit Shah', aliases: ['Amit Shah', 'HM Shah', 'Home Minister Amit Shah', 'అమిత్ షా'], role: 'Union Home Minister', constituency: 'Gandhinagar', party: 'BJP', scope: 'national', handles: ['@AmitShah'] },
    { id: 'rahul-gandhi', name: 'Rahul Gandhi', shortName: 'Rahul Gandhi', aliases: ['Rahul Gandhi', 'రాహుల్ గాంధీ'], role: 'Leader of Opposition, Lok Sabha', constituency: 'Rae Bareli', party: 'INC', scope: 'national', handles: ['@RahulGandhi'] },
    { id: 'mallikarjun-kharge', name: 'Mallikarjun Kharge', shortName: 'Kharge', aliases: ['Kharge', 'Mallikarjun Kharge', 'మల్లికార్జున్ ఖర్గే'], role: 'AICC President', constituency: '', party: 'INC', scope: 'national', handles: ['@kharge'] },
    { id: 'priyanka-gandhi', name: 'Priyanka Gandhi Vadra', shortName: 'Priyanka Gandhi', aliases: ['Priyanka Gandhi', 'ప్రియాంక గాంధీ'], role: 'AICC General Secretary; MP, Wayanad', constituency: '', party: 'INC', scope: 'national', handles: ['@priyankagandhi'] },
];

// ─────────────────────────────────────────────────────────
// MEMBERS OF PARLIAMENT
//
// BRS holds ZERO Lok Sabha seats — it was wiped out in 2024, its vote share
// collapsing from 41.71% to 16.68%, having held 9 seats in 2019. Telangana's
// 17 LS seats split INC 8 / BJP 8 / AIMIM 1.
//
// BRS's remaining parliamentary presence is 3 Rajya Sabha members, and its
// strongest institutional foothold is the Legislative Council (18 of 40).
// ─────────────────────────────────────────────────────────
const _MPS_RAW = [
    /*
     * ── RAJYA SABHA ──
     * BRS holds 3 of Telangana's 7 seats and NO Lok Sabha seat at all. This is
     * the party's remaining parliamentary presence; its strongest institutional
     * foothold is actually the Legislative Council, where it is still the
     * largest bloc.
     *
     * BRS held 4 RS seats until April 2026, when K. R. Suresh Reddy's seat went
     * to Congress's Vem Narender Reddy unopposed. Sources that still say "four"
     * are pre-April-2026.
     */
    { house: 'parliament', id: 'rs-b-parthasaradhi-reddy', name: 'B. Parthasaradhi Reddy', shortName: 'Parthasaradhi Reddy', role: 'MP, Rajya Sabha (term to 2028)', constituency: '', party: 'BRS', handles: [] },
    { house: 'parliament', id: 'rs-d-damodar-rao', name: 'D. Damodar Rao', shortName: 'Damodar Rao', role: 'MP, Rajya Sabha (term to 2028)', constituency: '', party: 'BRS', handles: [] },
    { house: 'parliament', id: 'rs-vaddiraju-ravichandra', name: 'Vaddiraju Ravichandra', shortName: 'Vaddiraju Ravichandra', role: 'MP, Rajya Sabha (term to 2030)', constituency: '', party: 'BRS', handles: [] },
    { house: 'parliament', id: 'rs-renuka-chowdhury', name: 'Renuka Chowdhury', shortName: 'Renuka Chowdhury', role: 'MP, Rajya Sabha (term to 2030)', constituency: '', party: 'INC', handles: [] },
    { house: 'parliament', id: 'rs-m-anil-kumar-yadav', name: 'M. Anil Kumar Yadav', shortName: 'Kumar Yadav', role: 'MP, Rajya Sabha (term to 2030)', constituency: '', party: 'INC', handles: [] },
    { house: 'parliament', id: 'rs-abhishek-manu-singhvi', name: 'Abhishek Manu Singhvi', shortName: 'Manu Singhvi', role: 'MP, Rajya Sabha (term to 2032)', constituency: '', party: 'INC', handles: [] },
    { house: 'parliament', id: 'rs-vem-narender-reddy', name: 'Vem Narender Reddy', shortName: 'Narender Reddy', role: 'MP, Rajya Sabha (term to 2032)', constituency: '', party: 'INC', handles: [] },

    /*
     * ── LOK SABHA (all 17) ──
     * The 2024 wipeout: BRS went from 9 seats in 2019 to ZERO, its vote share
     * collapsing from 41.71% to 16.68%. Every seat here belongs to a rival, so
     * the whole list sits on the opposition side of the matrix.
     *
     * All 17 are listed rather than just the prominent ones, because
     * frontend/scripts/gen_state_data.js refuses to build a roster in which any
     * Lok Sabha seat lacks an MP — a guard worth satisfying, not bypassing.
     */
    { house: 'parliament', id: 'mp-adilabad', name: 'Godam Nagesh', shortName: 'Godam Nagesh', role: 'MP, Adilabad (Lok Sabha)', constituency: 'Adilabad', party: 'BJP', handles: [] },
    { house: 'parliament', id: 'mp-peddapalli', name: 'Gaddam Vamsi Krishna', shortName: 'Vamsi Krishna', role: 'MP, Peddapalli (Lok Sabha)', constituency: 'Peddapalli', party: 'INC', handles: [] },
    { house: 'parliament', id: 'mp-karimnagar', name: 'Bandi Sanjay Kumar', shortName: 'Sanjay Kumar', role: 'MP, Karimnagar (Lok Sabha); Union Minister of State for Home Affairs (sworn in 9 June 2024)', constituency: 'Karimnagar', party: 'BJP', handles: [] },
    { house: 'parliament', id: 'mp-nizamabad', name: 'Dharmapuri Arvind', shortName: 'Dharmapuri Arvind', role: 'MP, Nizamabad (Lok Sabha)', constituency: 'Nizamabad', party: 'BJP', handles: [] },
    { house: 'parliament', id: 'mp-zahirabad', name: 'Suresh Kumar Shetkar', shortName: 'Kumar Shetkar', role: 'MP, Zahirabad (Lok Sabha)', constituency: 'Zahirabad', party: 'INC', handles: [] },
    { house: 'parliament', id: 'mp-medak', name: 'Madhavaneni Raghunandan Rao', shortName: 'Raghunandan Rao', role: 'MP, Medak (Lok Sabha)', constituency: 'Medak', party: 'BJP', handles: [] },
    { house: 'parliament', id: 'mp-malkajgiri', name: 'Eatala Rajender', shortName: 'Eatala Rajender', role: 'MP, Malkajgiri (Lok Sabha)', constituency: 'Malkajgiri', party: 'BJP', handles: [] },
    { house: 'parliament', id: 'mp-secunderabad', name: 'G. Kishan Reddy', shortName: 'Kishan Reddy', role: 'MP, Secunderabad (Lok Sabha); Union Cabinet Minister for Coal and Mines', constituency: 'Secunderabad', party: 'BJP', handles: [] },
    { house: 'parliament', id: 'mp-hyderabad', name: 'Asaduddin Owaisi', shortName: 'Asaduddin Owaisi', role: 'MP, Hyderabad (Lok Sabha); AIMIM national president', constituency: 'Hyderabad', party: 'AIMIM', handles: [] },
    { house: 'parliament', id: 'mp-chevella', name: 'Konda Vishweshwar Reddy', shortName: 'Vishweshwar Reddy', role: 'MP, Chevella (Lok Sabha)', constituency: 'Chevella', party: 'BJP', handles: [] },
    { house: 'parliament', id: 'mp-mahabubnagar', name: 'D. K. Aruna', shortName: 'K. Aruna', role: 'MP, Mahabubnagar (Lok Sabha)', constituency: 'Mahabubnagar', party: 'BJP', handles: [] },
    { house: 'parliament', id: 'mp-nagarkurnool', name: 'Mallu Ravi', shortName: 'Mallu Ravi', role: 'MP, Nagarkurnool (Lok Sabha)', constituency: 'Nagarkurnool', party: 'INC', handles: [] },
    { house: 'parliament', id: 'mp-nalgonda', name: 'Kunduru Raghuveer Reddy', shortName: 'Raghuveer Reddy', role: 'MP, Nalgonda (Lok Sabha)', constituency: 'Nalgonda', party: 'INC', handles: [] },
    { house: 'parliament', id: 'mp-bhongir', name: 'Chamala Kiran Kumar Reddy', shortName: 'Kumar Reddy', role: 'MP, Bhongir (Lok Sabha)', constituency: 'Bhongir', party: 'INC', handles: [] },
    { house: 'parliament', id: 'mp-warangal', name: 'Kadiyam Kavya', shortName: 'Kadiyam Kavya', role: 'MP, Warangal (Lok Sabha)', constituency: 'Warangal', party: 'INC', handles: [] },
    { house: 'parliament', id: 'mp-mahabubabad', name: 'Balram Naik Porika', shortName: 'Naik Porika', role: 'MP, Mahabubabad (Lok Sabha)', constituency: 'Mahabubabad', party: 'INC', handles: [] },
    { house: 'parliament', id: 'mp-khammam', name: 'Ramasahayam Raghuram Reddy', shortName: 'Raghuram Reddy', role: 'MP, Khammam (Lok Sabha)', constituency: 'Khammam', party: 'INC', handles: [] },
];

const ALL_CURATED_RAW = [
    ..._OUR_FRONTBENCH_RAW, ..._PARTY_ORG_RAW,
    ..._RULING_CABINET_RAW, ..._PRESIDING_OFFICERS_RAW,
    ..._INC_LEADERS_RAW, ..._BJP_LEADERS_RAW, ..._AIMIM_LEADERS_RAW,
    ..._CPI_LEADERS_RAW, ..._CPM_LEADERS_RAW, ..._TRS_K_LEADERS_RAW, ..._IND_LEADERS_RAW,
];

/**
 * ⚠ ASSEMBLY seats only. An MP's `constituency` is a LOK SABHA seat, and in
 * Telangana TWELVE Lok Sabha seats share their name with an assembly seat —
 * Karimnagar, Malkajgiri, Secunderabad, Khammam, Nalgonda, Medak, Adilabad,
 * Zahirabad, Chevella, Bhongir, Nagarkurnool and Mahabubabad.
 *
 * Membership of a house is therefore DECLARED with `house: 'parliament'`, not
 * inferred from the role text. Inference was wrong in both directions:
 * "Union Minister; MP, Secunderabad" does not start with "MP", so a strict
 * regex missed it; while a sitting MLA's "MLA, Dubbak; former MP, Medak" does
 * contain "MP", so a loose one would have dropped a real assembly seat and
 * duplicated its member.
 *
 * Left unfiltered, a curated MP's seat name suppressed the identically-named
 * assembly seat from the derived roster, because buildDerivedMlas skips any AC
 * already covered by a curated entry. That silently deleted twelve MLAs —
 * four of them ours — so the party's own strength read 24 instead of 27, and
 * nothing anywhere reported an error.
 */
const isAssemblyMember = (l) => l.house !== 'parliament';
const CURATED_AC_KEYS = new Set(
    ALL_CURATED_RAW.filter(isAssemblyMember).map((l) => acKey(l.constituency)).filter(Boolean),
);
const CURATED_NAME_KEYS = new Set(
    ALL_CURATED_RAW
        .flatMap((l) => [l.name, l.shortName, ...(l.aliases || [])])
        .map(nameKey)
        .filter(Boolean),
);

/** "Harish Rao" → "Rao Harish". Only for two-token names. */
const reversedName = (name) => {
    const parts = String(name || '').trim().split(/\s+/);
    if (parts.length !== 2) return null;
    return `${parts[1]} ${parts[0]}`;
};

/** Title-case names that arrive in ALL CAPS; leave mixed-case names untouched. */
const tidyName = (raw) => {
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s || /[a-z]/.test(s)) return s;
    return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
};

const buildDerivedMlas = () => {
    const out = [];
    const seenNameKeys = new Set();

    for (const row of VOTER_PROFILES) {
        const mla = row && row.mla;
        if (!mla || !mla.name) continue;

        const ac = acKey(row.constituency);
        const nk = nameKey(mla.name);

        if (CURATED_AC_KEYS.has(ac) || CURATED_NAME_KEYS.has(nk)) continue;
        if (seenNameKeys.has(nk)) continue;
        seenNameKeys.add(nk);

        const party = normalizeParty(mla.party);
        const cleanName = tidyName(String(mla.name).replace(/^(?:Dr\.?|Doctor|Adv\.?|Capt\.?)\s*/i, '').trim());
        const rev = reversedName(cleanName);

        /**
         * A defector won as BRS but functions with the government. Side follows
         * function, not the House register — otherwise "our camp" figures get
         * padded with people campaigning against us — but the formal position
         * is preserved so the distinction stays auditable.
         */
        const defected = !!mla.defected_to;

        out.push({
            id: `mla-${row.ac_number || 'x'}-${ac}`,
            name: cleanName,
            shortName: cleanName,
            aliases: rev ? [rev] : [],
            role: defected ? 'MLA (elected BRS; crossed to Congress, disqualification petition dismissed 11 Mar 2026)' : 'MLA',
            constituency: String(row.constituency || '').replace(/\s*\((?:SC|ST)\)\s*/i, '').trim(),
            district: row.district || '',
            ac_number: row.ac_number || null,
            party: defected ? 'BRS' : party,
            side: defected ? 'opposition' : sideForParty(party, mla.alliance),
            ...(defected ? { defection_unresolved: true, elected_party: 'BRS', functions_with: 'INC' } : {}),
            derived: true,
            handles: registryHandles(HANDLE_REGISTRY.people[`ac:${ac}`]),
        });
    }

    return out;
};

const DERIVED_MLAS = buildDerivedMlas();

// ─────────────────────────────────────────────────────────
// TAGGED COLLECTIONS
// ─────────────────────────────────────────────────────────

/**
 * Replaces the `CABINET_MINISTERS` export used by ruling-party deployments.
 * Renamed rather than repopulated: BRS holds no ministries, and a collection
 * called "cabinet ministers" containing opposition front-benchers would
 * mislead every future reader of this file.
 */
const OUR_FRONTBENCH = tagLeaders(_OUR_FRONTBENCH_RAW, 'BRS', 'ours');
const PARTY_ORG_LEADERS = tagLeaders(_PARTY_ORG_RAW, 'BRS', 'ours');

/** The government — on the far side of the matrix in this deployment. */
const RULING_MINISTERS = tagLeaders(_RULING_CABINET_RAW, 'INC', 'opposition');
const PRESIDING_OFFICERS = tagLeaders(_PRESIDING_OFFICERS_RAW, 'INC', 'opposition');

const NATIONAL_ALLY_LEADERS = tagLeaders(_NATIONAL_ALLY_RAW, 'BRS', 'ours');
const NATIONAL_OPPOSITION_LEADERS = tagLeaders(_NATIONAL_OPPOSITION_RAW, 'INC', 'opposition');

const ALLY_MLAS = tagLeaders(DERIVED_MLAS.filter((m) => m.side === 'ours'), 'BRS', 'ours');
const OPPOSITION_MLAS = tagLeaders(DERIVED_MLAS.filter((m) => m.side === 'opposition'), 'IND', 'opposition');

/** Elected BRS, sitting with the government, formally unresolved. */
const DEFECTED_MLAS = OPPOSITION_MLAS.filter((m) => m.defection_unresolved);

const MPS = tagLeaders(
    _MPS_RAW.map((m) => ({ ...m, district: '', side: sideForParty(m.party) })),
    'BRS',
    'ours',
);
const ALLY_MPS = MPS.filter((m) => m.side === 'ours');
const OPPOSITION_MPS = MPS.filter((m) => m.side === 'opposition');

const INC_LEADERS = tagLeaders(_INC_LEADERS_RAW, 'INC', 'opposition');
const BJP_LEADERS = tagLeaders(_BJP_LEADERS_RAW, 'BJP', 'opposition');
const AIMIM_LEADERS = tagLeaders(_AIMIM_LEADERS_RAW, 'AIMIM', 'opposition');
const CPI_LEADERS = tagLeaders(_CPI_LEADERS_RAW, 'CPI', 'opposition');
const CPM_LEADERS = tagLeaders(_CPM_LEADERS_RAW, 'CPM', 'opposition');
const TRS_K_LEADERS = tagLeaders(_TRS_K_LEADERS_RAW, 'TRS(K)', 'opposition');
const IND_LEADERS = tagLeaders(_IND_LEADERS_RAW, 'IND', 'opposition');

const OUR_LEADERS = [
    ...OUR_FRONTBENCH,
    ...PARTY_ORG_LEADERS,
    ...NATIONAL_ALLY_LEADERS,
    ...ALLY_MLAS,
    ...ALLY_MPS,
];

/** The brief's principal: party president, not a head of government. */
const PARTY_CHIEF = OUR_FRONTBENCH.find((l) => l.id === 'kcr') || OUR_FRONTBENCH[0] || null;

const byParty = (code) => (l) => normalizeParty(l.party) === code;

const OPPOSITION_PARTIES = [
    {
        id: 'inc',
        name: 'INC',
        full_name: 'Indian National Congress',
        aliases: [
            'Congress', 'INC', 'Telangana Congress', 'TPCC', 'Telangana Pradesh Congress Committee',
            'Indian National Congress', 'Hand symbol party', 'Hath party',
            'కాంగ్రెస్', 'భారత జాతీయ కాంగ్రెస్', 'తెలంగాణ కాంగ్రెస్',
        ],
        alliance: 'INDIA',
        /** ⚠ The party of government in this state — our principal adversary. */
        role: 'ruling',
        handles: ['@INCTelangana', '@TelanganaCMO'],
        leaders: [...RULING_MINISTERS, ...PRESIDING_OFFICERS, ...INC_LEADERS,
            ...OPPOSITION_MLAS.filter(byParty('INC')), ...OPPOSITION_MPS.filter(byParty('INC')),
            ...NATIONAL_OPPOSITION_LEADERS.filter(byParty('INC')),],
    },
    {
        id: 'bjp',
        name: 'BJP',
        full_name: 'Bharatiya Janata Party',
        aliases: [
            'BJP', 'Bharatiya Janata Party', 'BJP Telangana', 'Telangana BJP', 'Bharatiya Janta Party',
            'Lotus party', 'Saffron party', 'కమలం పార్టీ', 'బీజేపీ', 'భారతీయ జనతా పార్టీ',
        ],
        alliance: 'NDA',
        handles: ['@BJP4Telangana'],
        leaders: [...BJP_LEADERS, ...OPPOSITION_MLAS.filter(byParty('BJP')),
            ...OPPOSITION_MPS.filter(byParty('BJP')), ...NATIONAL_OPPOSITION_LEADERS.filter(byParty('BJP')),],
    },
    {
        id: 'aimim',
        name: 'AIMIM',
        full_name: 'All India Majlis-e-Ittehadul Muslimeen',
        aliases: [
            'AIMIM', 'MIM', 'Majlis', 'Ittehadul Muslimeen', 'All India Majlis-e-Ittehadul Muslimeen',
            'Owaisi party', 'ఎంఐఎం', 'మజ్లిస్',
        ],
        /**
         * ⚠ REALIGNED. AIMIM backed BRS in seats it did not contest in 2023 and
         * was effectively an ally. Since the change of government it has moved
         * toward Congress — Asaduddin Owaisi has publicly praised the CM's
         * Hyderabad agenda and AIMIM's criticism of the government has
         * noticeably softened. Encoded as a rival, NOT an ally, but the history
         * is recorded because older posts will read very differently.
         */
        alliance: 'None (formerly BRS-aligned; Congress-leaning since 2024)',
        handles: ['@aimim_national'],
        leaders: [...AIMIM_LEADERS, ...OPPOSITION_MLAS.filter(byParty('AIMIM')),
            ...OPPOSITION_MPS.filter(byParty('AIMIM')),],
    },
    {
        id: 'trs-k',
        name: 'TRS(K)',
        full_name: 'Telangana Rakshana Sena',
        /**
         * ⚠ Bare "TRS" is deliberately absent — it collides with this party's
         * own former name. Only forms that cannot mean BRS are listed.
         * "Telangana Rashtra Sena" is included because the launch was widely
         * reported under that name before the ECI approved "Rakshana".
         */
        aliases: [
            'Telangana Rakshana Sena', 'Telangana Rashtra Sena', 'Rakshana Sena',
            'Kavitha party', 'Telangana Jagruthi',
            'తెలంగాణ రక్షణ సేన', 'తెలంగాణ జాగృతి',
        ],
        alliance: 'None',
        handles: [],
        leaders: [...TRS_K_LEADERS, ...OPPOSITION_MLAS.filter(byParty('TRS(K)')),],
    },
    {
        id: 'cpi',
        name: 'CPI',
        full_name: 'Communist Party of India',
        aliases: ['CPI', 'Communist Party of India', 'సీపీఐ'],
        alliance: 'INDIA (contested 2023 with Congress)',
        handles: [],
        leaders: [...CPI_LEADERS, ...OPPOSITION_MLAS.filter(byParty('CPI')),],
    },
    {
        id: 'cpm',
        name: 'CPM',
        full_name: 'Communist Party of India (Marxist)',
        aliases: ['CPM', 'CPI(M)', 'CPI-M', 'Communist Party of India (Marxist)', 'సీపీఎం'],
        alliance: 'None',
        handles: [],
        leaders: [...CPM_LEADERS, ...OPPOSITION_MLAS.filter(byParty('CPM')),],
    },
];

/** Independents have no party entity; they still need a camp. */
const OTHER_OPPOSITION_LEADERS = [
    ...IND_LEADERS,
    ...OPPOSITION_MLAS.filter(byParty('IND')).filter((m) => !IND_LEADERS.some((c) => acKey(c.constituency) === acKey(m.constituency))),
];

const OPPOSITION_LEADERS = [
    ...OPPOSITION_PARTIES.flatMap((p) => p.leaders),
    ...OTHER_OPPOSITION_LEADERS,
];

const ALL_LEADERS = [...OUR_LEADERS, ...OPPOSITION_LEADERS];

// Party accounts from the verified registry (parties without an entry keep theirs).
for (const party of [OUR_PARTY, ...ALLY_PARTIES, ...OPPOSITION_PARTIES]) {
    party.handles = mergeHandles(party.handles || [], registryHandles(HANDLE_REGISTRY.parties[party.id]));
}

module.exports = {
    // Meta
    OUR_PARTY,
    ALLY_PARTIES,
    OPPOSITION_PARTIES,
    PARTY_CHIEF,
    // Tagged collections
    OUR_FRONTBENCH,
    RULING_MINISTERS,
    PRESIDING_OFFICERS,
    PARTY_ORG_LEADERS,
    NATIONAL_ALLY_LEADERS,
    NATIONAL_OPPOSITION_LEADERS,
    ALLY_MLAS,
    OPPOSITION_MLAS,
    DEFECTED_MLAS,
    ALLY_MPS,
    OPPOSITION_MPS,
    INC_LEADERS,
    BJP_LEADERS,
    AIMIM_LEADERS,
    CPI_LEADERS,
    CPM_LEADERS,
    TRS_K_LEADERS,
    IND_LEADERS,
    OUR_LEADERS,
    OPPOSITION_LEADERS,
    ALL_LEADERS,
    // Helpers
    normalizeHandle,
    normalizeParty,
    sideForParty,
    acKey,
    nameKey,
};
