/**
 * boothImportService
 * ─────────────────────────────────────────────────────────────────────
 * Pure helpers for the booth-roll import pipeline: seat resolution,
 * payload normalization, and the ingest limits. No DB access, no request
 * handling — all of that lives in boothImportController.
 *
 * ── Why seat resolution matters ──────────────────────────────────────
 * The single most important rule in this pipeline: the constituency the
 * browser names is re-resolved against the canonical 175-seat list and the
 * posted value is then DISCARDED. Everything stored downstream (the key
 * that scopes every voter row) comes from the seat list, never from the
 * payload. Without that, a crafted request could file one seat's roll
 * under another seat.
 *
 * Seats are resolved by AC NUMBER rather than by name because some states have
 * genuinely duplicate constituency names across districts (some states have
 * two Prathipadu and two Gannavaram; Telangana has two Ghanpurs). Name-keyed lookups collapse
 * those pairs (voterProfileService's own PROFILE_BY_KEY does exactly that),
 * so a name-addressed import could silently land on the wrong seat.
 */

const { getAllVoterProfiles, normalizeConstituencyKey } = require('./voterProfileService');
const { normalizeGender } = require('../utils/boothMetrics');

// ── Ingest limits ─────────────────────────────────────────────────────
// MAX_VOTERS_PER_PART is a sanity ceiling, not an ECI rule: real booths run
// ~700–1,500 electors, so anything above 5,000 means a malformed file.
const MAX_VOTERS_PER_PART = 5000;
// Guards the request body. The client batches 10 parts; 40 leaves room for
// a deliberately larger batch without letting one request carry a whole seat.
const MAX_PARTS_PER_BATCH = 40;
// insertMany chunk. Large enough to keep round-trips down, small enough that
// a single chunk stays well inside the 16MB BSON command limit.
const INSERT_CHUNK = 2000;
// Booth rows written per insertMany at commit.
const BOOTH_CHUNK = 500;
// Cap on the per-session rejection log, so a pathological upload cannot grow
// the session document without bound.
const MAX_REJECTED = 200;
// How many parts inside ONE request write concurrently. Bounded rather than
// unlimited: the client already runs 3 requests at a time, so an unbounded
// fan-out over a 10-part batch puts 30 simultaneous insertMany calls on the
// connection pool. On a well-provisioned server that is fine; on a small or
// IOPS-throttled instance the fan-out becomes counterproductive and the
// writes start queueing behind each other anyway. 4 × 3 = 12 in flight.
const PART_WRITE_CONCURRENCY = Number(process.env.BOOTH_PART_CONCURRENCY) || 4;

const MIN_ROLL_YEAR = 1990;

// ── Canonical seat index ──────────────────────────────────────────────
const PROFILES = getAllVoterProfiles();

const SEAT_BY_AC = new Map();
// How many distinct seats share each normalized name — drives the
// disambiguation below.
const NAME_COLLISIONS = new Map();

PROFILES.forEach((p) => {
    const nameKey = normalizeConstituencyKey(p.constituency);
    NAME_COLLISIONS.set(nameKey, (NAME_COLLISIONS.get(nameKey) || 0) + 1);
});

PROFILES.forEach((p) => {
    const nameKey = normalizeConstituencyKey(p.constituency);
    // Where two seats share a name, the AC number is appended so they can
    // never share one roll. Unique names keep the bare key, which is what
    // on-disk roll files use —
    // so the legacy file path stays addressable by the same key.
    const key = NAME_COLLISIONS.get(nameKey) > 1 ? `${nameKey}-${p.ac_number}` : nameKey;
    SEAT_BY_AC.set(Number(p.ac_number), {
        ac_number: Number(p.ac_number),
        constituency: p.constituency,
        constituency_key: key,
        district: p.district || null,
    });
});

/** Every seat, for the upload dropdown. Sorted by AC number. */
const listSeats = () =>
    Array.from(SEAT_BY_AC.values()).sort((a, b) => a.ac_number - b.ac_number);

/**
 * Resolve a seat from an untrusted payload.
 *
 * Prefers `ac_number` (unambiguous). Falls back to a name, but refuses when
 * that name matches more than one seat rather than guessing — guessing here
 * would file a roll under the wrong constituency.
 *
 * @returns {{ seat: object }|{ error: string }}
 */
const resolveSeat = ({ ac_number, constituency } = {}) => {
    const acNum = Number(ac_number);
    if (Number.isFinite(acNum) && acNum > 0) {
        const seat = SEAT_BY_AC.get(acNum);
        if (!seat) return { error: `Unknown constituency (AC ${acNum})` };
        return { seat };
    }

    const key = normalizeConstituencyKey(constituency);
    if (!key) return { error: 'Constituency is required' };

    const matches = listSeats().filter(
        (s) => normalizeConstituencyKey(s.constituency) === key,
    );
    if (matches.length === 0) return { error: `Unknown constituency: ${constituency}` };
    if (matches.length > 1) {
        const opts = matches.map((m) => `${m.ac_number}. ${m.constituency} — ${m.district}`).join('; ');
        return {
            error: `"${constituency}" matches ${matches.length} seats — specify ac_number (${opts})`,
        };
    }
    return { seat: matches[0] };
};

/** Look up an already-resolved key (used by the read path). */
const seatByKey = (key) =>
    listSeats().find((s) => s.constituency_key === key) || null;

/** Validate the roll year. Returns { year } or { error }. */
const resolveRollYear = (raw) => {
    const year = Number(raw);
    const max = new Date().getFullYear() + 1;
    if (!Number.isInteger(year) || year < MIN_ROLL_YEAR || year > max) {
        return { error: `Roll year must be an integer between ${MIN_ROLL_YEAR} and ${max}` };
    }
    return { year };
};

/**
 * Normalize the uploaded summary file into the parts list.
 *
 * `expected_parts` is exactly what the summary declares — deliberately NOT
 * a 1..N range. Real rolls skip part numbers, so assuming
 * contiguity would invent missing booths that never existed.
 */
const normalizeSummaryRows = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { error: 'Summary file must be a non-empty JSON array' };
    }

    const seen = new Set();
    const clean = [];
    const dropped = [];

    rows.forEach((row, i) => {
        const part = Number(row?.part);
        if (!Number.isFinite(part) || part <= 0) {
            dropped.push({ index: i, part: row?.part ?? null, reason: 'invalid_part' });
            return;
        }
        if (seen.has(part)) {
            dropped.push({ index: i, part, reason: 'duplicate_part' });
            return;
        }
        seen.add(part);
        clean.push({
            part,
            locality: row.locality ?? null,
            polling_station: row.polling_station ?? null,
            electors_male: Number(row.electors_male) || 0,
            electors_female: Number(row.electors_female) || 0,
            electors_third_gender: Number(row.electors_third_gender) || 0,
            electors_unclassified: Number(row.electors_unclassified) || 0,
            electors_total: Number(row.electors_total) || 0,
        });
    });

    if (clean.length === 0) {
        return { error: 'No usable rows in the summary file — every row is missing a valid `part`' };
    }

    clean.sort((a, b) => a.part - b.part);
    return { rows: clean, dropped };
};

/**
 * One source voter row → one booth_voters document.
 *
 * Scope fields (`constituency_key`, `import_id`, `part`) are injected by the
 * caller from the import session — deliberately not taken from the payload.
 */
const normalizeVoter = (v, scope) => {
    const name = String(v?.name ?? '').trim();
    const relation = String(v?.relation ?? '').trim();
    const house = String(v?.house_no ?? '').trim();
    const age = Number(v?.age);
    const sl = Number(v?.sl);

    return {
        ...scope,
        sl: Number.isFinite(sl) ? sl : null,
        voter_id: String(v?.voter_id ?? '').trim(),
        name,
        name_lc: name.toLowerCase(),
        relation,
        relation_lc: relation.toLowerCase(),
        house_no: house,
        house_no_lc: house.toLowerCase(),
        // Age is genuinely absent on thousands of real rows — null, not 0,
        // so it lands in the `unknown` age bracket instead of skewing the mean.
        age: Number.isFinite(age) && age > 0 ? age : null,
        gender: normalizeGender(v?.gender),
    };
};

/**
 * Accepts either `[{...}]` or `{ voters: [{...}] }` for a part's payload —
 * the on-disk booth files are bare arrays, and that is what the browser
 * reads and forwards.
 */
const extractVoterRows = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.voters)) return payload.voters;
    return null;
};

/**
 * Run `worker` over `items` with at most `limit` in flight. Bounded fan-out,
 * so a batch's parts still overlap their round trips without dogpiling the
 * connection pool.
 */
const mapLimit = async (items, limit, worker) => {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const i = cursor;
            cursor += 1;
            if (i >= items.length) return;
            await worker(items[i], i);
        }
    });
    await Promise.all(runners);
};

module.exports = {
    MAX_VOTERS_PER_PART,
    MAX_PARTS_PER_BATCH,
    INSERT_CHUNK,
    BOOTH_CHUNK,
    MAX_REJECTED,
    PART_WRITE_CONCURRENCY,
    mapLimit,
    listSeats,
    resolveSeat,
    seatByKey,
    resolveRollYear,
    normalizeSummaryRows,
    normalizeVoter,
    extractVoterRows,
};
