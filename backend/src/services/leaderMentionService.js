/**
 * leaderMentionService
 * ─────────────────────────────────────────────────────────────────────
 * Per-MLA mention stats for the Statewide MLA Sentiment leaderboard.
 *
 * A post counts for a candidate when ANY of these appears in its text:
 *   1. their handle tagged    (@vijaysharmacg)
 *   2. their name             ("Vijay Sharma", "विजय शर्मा", roster aliases)
 *   3. their constituency     ("Kawardha", "कवर्धा", roster spellings)
 * — each post counted ONCE per candidate however many of the three it hits.
 *
 * Handles and names use the pipeline's own entity matcher
 * (politicalContextService.findMentionedEntities — same aliases, word
 * boundaries and blocked contexts the sentiment pipeline uses). A candidate's
 * OWN posts are not mentions of them and are skipped for that candidate.
 *
 * The seat's post-location basis (detected_location) is NOT used for handles
 * or names: a post tagging the CM is about the CM wherever it is located.
 */

const fs = require('fs');
const path = require('path');
const { POLITICAL_ENTITIES } = require('../config/politicalEntities');
const { findMentionedEntities } = require('./politicalContextService');
const { getAllMlas, normalizeConstituencyKey } = require('./mlaReferenceService');
const { STATE_NAME, STATE_NAME_NATIVE } = require('../config/deployment');

const readData = (...names) => {
    for (const n of names) {
        const p = path.join(__dirname, '../data', n);
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    return null;
};

/* ─── candidate ↔ roster entity ─────────────────────────────────────── */

// Roster person sitting in each seat. MPs share a seat name with the
// assembly seat ("Raigarh" LS vs AC), so MP entries are excluded.
const ROSTER_SEATS = new Set(getAllMlas().map((m) => m.key));
const ENTITY_KEY_BY_SEAT = (() => {
    const map = {};
    for (const [key, e] of Object.entries(POLITICAL_ENTITIES)) {
        if (e.type !== 'person' || !e.constituency || /^MP\b/i.test(e.role || '')) continue;
        const seat = normalizeConstituencyKey(e.constituency);
        // National leaders carry out-of-state seats (Varanasi, Raebareli).
        if (ROSTER_SEATS.has(seat) && !map[seat]) map[seat] = key;
    }
    return map;
})();

// Handles of each roster entity — to skip a candidate's own posts.
const OWN_HANDLES = (() => {
    const map = {};
    for (const [key, e] of Object.entries(POLITICAL_ENTITIES)) {
        const hs = (e.aliases || []).filter((a) => a.startsWith('@')).map((a) => a.slice(1).toLowerCase());
        if (hs.length) map[key] = new Set(hs);
    }
    return map;
})();

/* ─── constituency names in text ────────────────────────────────────── */

// Seat names that are also places elsewhere in India (or common words):
// they count only when the post also names the state.
const AMBIGUOUS_SEATS = new Set(['kota', 'patan', 'rampur', 'bilaspur', 'bijapur', 'chandrapur', 'pali',
    'sitapur', 'pratappur', 'manpur', 'bhatgaon', 'premnagar', 'khairagarh', 'sarangarh', 'durg']);

// Seat names that usually mean a whole REGION ("హైదరాబాద్" = the Hyderabad
// division): they count only as "<name> vidhan sabha / constituency".
const REGION_SEATS = new Set(['hyderabad']);
const SEAT_SUFFIXES = ['vidhan sabha', 'vidhansabha', 'constituency', 'assembly', 'विधानसभा', 'विधान सभा', 'क्षेत्र'];

const WORD_CH = /[\p{L}\p{M}\p{N}]/u;
const occurs = (hay, needle) => {
    let i = hay.indexOf(needle);
    while (i >= 0) {
        const b = hay[i - 1];
        const a = hay[i + needle.length];
        if ((b === undefined || !WORD_CH.test(b)) && (a === undefined || !WORD_CH.test(a))) return true;
        i = hay.indexOf(needle, i + 1);
    }
    return false;
};

const SEAT_NEEDLES = (() => {
    const bySeat = {};
    const add = (seat, name) => {
        const n = String(name || '').toLowerCase().replace(/\s*\((sc|st)\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
        if (!n || (/^[a-z .'-]+$/.test(n) && n.replace(/[^a-z]/g, '').length < 4)) return;
        (bySeat[seat] = bySeat[seat] || new Set()).add(n);
    };
    for (const m of getAllMlas()) add(m.key, m.constituency);
    const aliasFile = readData('state_constituency_aliases.json', 'goa_constituency_aliases.json');
    for (const [alias, seat] of Object.entries(aliasFile?.aliases || {})) add(seat, alias);
    return Object.entries(bySeat).map(([seat, names]) => ({
        seat,
        names: REGION_SEATS.has(seat)
            ? [...names].flatMap((n) => SEAT_SUFFIXES.map((x) => `${n} ${x}`))
            : [...names],
        ambiguous: AMBIGUOUS_SEATS.has(seat),
    }));
})();

const STATE_RX = new RegExp(
    [STATE_NAME, STATE_NAME_NATIVE].filter(Boolean).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'i',
);

const seatsNamedIn = (lower, namesState) => {
    const out = [];
    for (const s of SEAT_NEEDLES) {
        if (s.ambiguous && !namesState) continue;
        if (s.names.some((n) => occurs(lower, n))) out.push(s.seat);
    }
    return out;
};

/* ─── per-post association ──────────────────────────────────────────── */

const SEAT_BY_ENTITY_KEY = Object.fromEntries(Object.entries(ENTITY_KEY_BY_SEAT).map(([s, k]) => [k, s]));

/**
 * Seats whose candidate this post mentions → Map(seat → { person, seat }).
 */
const candidatesInPost = (post) => {
    const text = [post.content?.full_text || post.content?.text || '', post.content?.translated_text || '']
        .filter(Boolean).join('\n');
    const author = String(post.posted_by?.handle || '').replace(/^@+/, '').toLowerCase();
    const hits = new Map();
    if (!text.trim()) return hits;

    for (const e of findMentionedEntities(text)) {
        const seat = SEAT_BY_ENTITY_KEY[e.key];
        if (!seat) continue;
        if (author && OWN_HANDLES[e.key]?.has(author)) continue;
        hits.set(seat, { ...(hits.get(seat) || {}), person: true });
    }
    const lower = text.toLowerCase();
    for (const seat of seatsNamedIn(lower, STATE_RX.test(text))) {
        const ek = ENTITY_KEY_BY_SEAT[seat];
        if (author && ek && OWN_HANDLES[ek]?.has(author)) continue;
        hits.set(seat, { ...(hits.get(seat) || {}), seat: true });
    }
    return hits;
};

/**
 * Stream the matched posts once and tally per seat.
 * → Map(seatKey → { total, positive, negative, neutral, high_priority, via_person, via_seat })
 */
const computeLeaderMentionStats = async (GrievanceModel, match) => {
    const stats = new Map();
    const cursor = GrievanceModel.find(match)
        .select('content.text content.full_text content.translated_text posted_by.handle analysis.sentiment complaint.priority')
        .lean()
        .cursor();
    for await (const post of cursor) {
        const hits = candidatesInPost(post);
        if (!hits.size) continue;
        const s = post.analysis?.sentiment;
        const hp = ['high', 'critical'].includes(post.complaint?.priority);
        for (const [seat, via] of hits) {
            const st = stats.get(seat) || { total: 0, positive: 0, negative: 0, neutral: 0, high_priority: 0, via_person: 0, via_seat: 0 };
            st.total += 1;
            if (s === 'positive') st.positive += 1;
            else if (s === 'negative') st.negative += 1;
            else st.neutral += 1;
            if (hp) st.high_priority += 1;
            if (via.person) st.via_person += 1;
            if (via.seat) st.via_seat += 1;
            stats.set(seat, st);
        }
    }
    return stats;
};

/* ─── evidence index (for the candidate's detail page) ─────────────── */

// seat → ids of the posts that evidence that candidate, built over ALL active
// scored posts (no date bound) so each caller adds its own window on top.
// Same association as the leaderboard, so the detail page shows exactly the
// posts behind the leaderboard's count. Rebuilt at most every 90 s.
const EVIDENCE_TTL_MS = 90 * 1000;
const evidence = { grievance: { at: 0, map: null, building: null }, alert: { at: 0, map: null, building: null } };

const cached = async (slot, build) => {
    const e = evidence[slot];
    if (e.map && Date.now() - e.at < EVIDENCE_TTL_MS) return e.map;
    if (!e.building) {
        e.building = build()
            .then((map) => { e.map = map; e.at = Date.now(); return map; })
            .finally(() => { e.building = null; });
    }
    return e.building;
};

const addHit = (map, seat, id) => {
    if (!map.has(seat)) map.set(seat, []);
    map.get(seat).push(id);
};

const buildGrievanceIndex = async () => {
    const Grievance = require('../models/Grievance');
    const { grievanceGate, applyGate } = require('../config/displayGate');
    const map = new Map();
    const cursor = Grievance.find(applyGate({ is_active: true }, grievanceGate()))
        .select('_id content.text content.full_text content.translated_text posted_by.handle')
        .lean()
        .cursor();
    for await (const post of cursor) {
        for (const seat of candidatesInPost(post).keys()) addHit(map, seat, post._id);
    }
    return map;
};

const buildAlertIndex = async () => {
    const Alert = require('../models/Alert');
    const Content = require('../models/Content');
    const { alertGate, applyGate } = require('../config/displayGate');
    const alerts = await Alert.find(applyGate({}, await alertGate()))
        .select('id content_id author_handle')
        .lean();
    const contentIds = [...new Set(alerts.map((a) => a.content_id).filter(Boolean))];
    const texts = new Map();
    for (let i = 0; i < contentIds.length; i += 1000) {
        const rows = await Content.find({ id: { $in: contentIds.slice(i, i + 1000) } })
            .select('id text translated_text')
            .lean();
        for (const r of rows) texts.set(r.id, r);
    }
    const map = new Map();
    for (const a of alerts) {
        const c = texts.get(a.content_id);
        if (!c) continue;
        const post = { content: { text: c.text, translated_text: c.translated_text }, posted_by: { handle: a.author_handle } };
        for (const seat of candidatesInPost(post).keys()) addHit(map, seat, a.id);
    }
    return map;
};

/** Grievance `_id`s evidencing the candidate of `constituency`. */
const getGrievanceEvidenceIds = async (constituency) =>
    (await cached('grievance', buildGrievanceIndex)).get(normalizeConstituencyKey(constituency)) || [];

/** Alert `id`s evidencing the candidate of `constituency`. */
const getAlertEvidenceIds = async (constituency) =>
    (await cached('alert', buildAlertIndex)).get(normalizeConstituencyKey(constituency)) || [];

module.exports = { computeLeaderMentionStats, candidatesInPost, getGrievanceEvidenceIds, getAlertEvidenceIds };
