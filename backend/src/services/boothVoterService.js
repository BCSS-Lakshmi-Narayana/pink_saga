/**
 * boothVoterService
 * ─────────────────────────────────────────────────────────────────────
 * Booth-level (polling-station) voter data. Reads from two sources, in
 * this order:
 *
 *  1. **Uploaded rolls (Mongo).** Any seat whose roll was imported through
 *     /api/booth-imports. Serves the newest COMMITTED import for the seat;
 *     staged and aborted imports are invisible here, which is precisely
 *     what makes the staged upload safe. Booth metrics come straight off
 *     the Booth row — computed once at ingest, so a drill-down never
 *     rescans ~900 voter rows.
 *
 *  2. **Legacy on-disk rolls (JSON).** The two seats collected before the
 *     upload pipeline existed:
 *       - `<key>.summary.json`      : one row per booth with elector counts
 *       - `voters/<key>/<part>.json`: the full roll for that booth
 *     Loaded lazily per booth and cached, since the on-disk set is ~500k
 *     rows / 66MB and must never be required up front. Kept as a fallback
 *     so those seats keep working untouched — re-import one through the
 *     upload flow and the Mongo path takes over for it automatically.
 *
 * Everything is async because source (1) is a database. Both sources
 * return the same shape, so callers never branch on which one answered.
 */

const fs = require('fs');
const path = require('path');

const BoothRollImport = require('../models/BoothRollImport');
const Booth = require('../models/Booth');
const BoothVoter = require('../models/BoothVoter');
const { listSeats } = require('./boothImportService');
const { genderBucket, computeBoothMetrics } = require('../utils/boothMetrics');

const DATA_DIR = path.join(__dirname, '..', 'data', 'boothVoters');

const normalizeConstituencyKey = (name) =>
  String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .trim();

const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Constituencies with a roll on disk. Value is the on-disk key. Empty for Telangana:
// rolls are imported through /api/booth-imports (the Mongo path above).
const SUMMARY_KEYS = {};

// Cache the (small) summaries and the (large) per-booth voter rolls so we
// only hit disk + JSON.parse once per file for the life of the process.
const summaryCache = new Map();
const voterCache = new Map();

/* ── Seat key resolution ──────────────────────────────────────────────
 * Seats are addressed by NAME in the URL, but some states have duplicate seat
 * names across districts. Those carry an
 * `-<ac_number>` suffix on their storage key, so one name can map to more
 * than one key — return every candidate and let the query pick whichever
 * actually holds a roll. */
const keysForName = (name) => {
  const bare = normalizeConstituencyKey(name);
  if (!bare) return [];
  const matches = listSeats()
    .filter((s) => normalizeConstituencyKey(s.constituency) === bare)
    .map((s) => s.constituency_key);
  // `bare` also covers the legacy on-disk keys and every unique-name seat.
  return Array.from(new Set([...matches, bare]));
};

/** Newest committed import for a seat, or null. */
const findCommittedImport = async (constituency) => {
  const keys = keysForName(constituency);
  if (!keys.length) return null;
  return BoothRollImport.findOne({ constituency_key: { $in: keys }, status: 'committed' })
    .sort({ roll_year: -1, committed_at: -1 })
    .select('_id constituency constituency_key roll_year roll_label booths_total voters_total committed_at')
    .lean();
};

/* ── Legacy on-disk source ────────────────────────────────────────────*/

const loadSummary = (key) => {
  if (summaryCache.has(key)) return summaryCache.get(key);
  const file = path.join(DATA_DIR, `${key}.summary.json`);
  let rows = null;
  try {
    rows = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    rows = null;
  }
  summaryCache.set(key, rows);
  return rows;
};

const loadVoterRoll = (key, part) => {
  const cacheKey = `${key}/${part}`;
  if (voterCache.has(cacheKey)) return voterCache.get(cacheKey);
  const file = path.join(DATA_DIR, 'voters', key, `${part}.json`);
  let rows = null;
  try {
    rows = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    rows = null;
  }
  voterCache.set(cacheKey, rows);
  return rows;
};

const fileKeyFor = (constituency) => SUMMARY_KEYS[normalizeConstituencyKey(constituency)] || null;

/* ── Public API ───────────────────────────────────────────────────────*/

/** Does this seat have booth-level data from either source? */
const hasBoothData = async (constituency) => {
  const imp = await findCommittedImport(constituency);
  if (imp) return true;
  const key = fileKeyFor(constituency);
  if (!key) return false;
  const rows = loadSummary(key);
  return Boolean(rows && rows.length);
};

/**
 * The booth grid for one seat. Returns null when neither source holds
 * data — the caller turns that into a 404, which is what tells the UI to
 * offer the upload flow instead.
 */
const getBoothsByConstituency = async (constituency) => {
  const imp = await findCommittedImport(constituency);

  if (imp) {
    const rows = await Booth.find({ constituency_key: imp.constituency_key, import_id: imp._id })
      .select('-_id -__v -import_id -constituency_key -constituency -created_at')
      .sort({ part: 1 })
      .lean();

    if (rows.length) {
      // A part that never landed still has a Booth row (voter_count 0), so
      // coverage here is "booths we actually hold a roll for" over "booths
      // the summary declared" — a real completeness figure, not always 100%.
      const collected = rows.filter((b) => b.voter_count > 0).length;
      const total = rows.length;
      return {
        constituency,
        key: imp.constituency_key,
        source: 'upload',
        roll_year: imp.roll_year,
        roll_label: imp.roll_label,
        import_id: imp._id,
        committed_at: imp.committed_at,
        booths: rows,
        coverage: {
          collected,
          total_booths: total,
          pct: total ? Math.round((collected / total) * 100) : 0,
        },
      };
    }
  }

  const key = fileKeyFor(constituency);
  if (!key) return null;
  const rows = loadSummary(key);
  if (!rows || !rows.length) return null;
  // The on-disk Final Roll is the complete set of parts for the seat, so
  // the number of booths we hold is also the official total — coverage 100%.
  const total = rows.length;
  return {
    constituency,
    key,
    source: 'file',
    roll_year: null,
    booths: rows,
    coverage: {
      collected: rows.length,
      total_booths: total,
      pct: total ? Math.round((rows.length / total) * 100) : 0,
    },
  };
};

/**
 * One booth's summary row (locality / polling station / counts) without
 * touching the heavy voter roll — used by the area-sentiment endpoint.
 */
const getBoothSummary = async (constituency, part) => {
  const partNum = Number(part);
  if (!Number.isFinite(partNum)) return null;

  const imp = await findCommittedImport(constituency);
  if (imp) {
    const row = await Booth.findOne({ constituency_key: imp.constituency_key, import_id: imp._id, part: partNum })
      .select('-_id part locality polling_station electors_male electors_female electors_third_gender electors_unclassified electors_total')
      .lean();
    if (row) return { key: imp.constituency_key, ...row };
  }

  const key = fileKeyFor(constituency);
  if (!key) return null;
  const row = (loadSummary(key) || []).find((b) => b.part === partNum);
  return row ? { key, ...row } : null;
};

// Stored gender values behind each filter bucket. 'other' also catches
// 'Unknown' so the buckets partition the roll exactly the way
// genderBucket() does for the on-disk source.
const GENDER_FILTER = {
  male: ['Male'],
  female: ['Female'],
  third: ['Third'],
  other: ['Other', 'Unknown'],
};

/**
 * Paginated + searchable voter roll for one booth.
 * opts: { page=1, pageSize=50, search='', gender='' }
 * Returns null when neither source holds a roll for that seat/booth.
 */
const getBoothVoters = async (constituency, part, opts = {}) => {
  const partNum = Number(part);
  if (!Number.isFinite(partNum)) return null;

  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(opts.pageSize) || 50));
  const search = String(opts.search || '').trim().toLowerCase();
  const genderFilter = String(opts.gender || '').trim().toLowerCase();

  const imp = await findCommittedImport(constituency);

  if (imp) {
    const base = { constituency_key: imp.constituency_key, import_id: imp._id, part: partNum };

    const booth = await Booth.findOne(base)
      .select('-_id part locality polling_station electors_male electors_female electors_third_gender electors_unclassified electors_total metrics voter_count')
      .lean();

    if (booth) {
      const filter = { ...base };
      if (search) {
        // The `_lc` twins let search be a plain substring match instead of
        // a per-row $toLower across the whole booth.
        const rx = new RegExp(escapeRegex(search));
        filter.$or = [
          { name_lc: rx },
          { relation_lc: rx },
          { house_no_lc: rx },
          { voter_id: new RegExp(escapeRegex(search), 'i') },
        ];
      }
      if (genderFilter && genderFilter !== 'all' && GENDER_FILTER[genderFilter]) {
        filter.gender = { $in: GENDER_FILTER[genderFilter] };
      }

      const [total, voters] = await Promise.all([
        BoothVoter.countDocuments(filter),
        BoothVoter.find(filter)
          .select('-_id sl voter_id name relation house_no age gender')
          .sort({ sl: 1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
      ]);

      // Precomputed at ingest — never recomputed on a read.
      const metrics = booth.metrics || computeBoothMetrics([]);
      const { metrics: _metrics, voter_count: unfiltered, ...summary } = booth;

      return {
        constituency,
        key: imp.constituency_key,
        source: 'upload',
        roll_year: imp.roll_year,
        part: partNum,
        summary,
        counts: metrics.counts,
        metrics,
        totalUnfiltered: unfiltered || 0,
        total,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        voters,
      };
    }
  }

  const key = fileKeyFor(constituency);
  if (!key) return null;
  const all = loadVoterRoll(key, partNum);
  if (!all) return null;

  // Whole-booth metrics + gender breakdown (before any filtering).
  const metrics = computeBoothMetrics(all);

  let rows = all;
  if (search) {
    rows = rows.filter((v) =>
      String(v.name || '').toLowerCase().includes(search) ||
      String(v.voter_id || '').toLowerCase().includes(search) ||
      String(v.relation || '').toLowerCase().includes(search) ||
      String(v.house_no || '').toLowerCase().includes(search));
  }
  if (genderFilter && genderFilter !== 'all') {
    rows = rows.filter((v) => genderBucket(v.gender) === genderFilter);
  }

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const voters = rows.slice(start, start + pageSize);

  // Booth summary row (locality / polling station) for context in the header.
  const summary = (loadSummary(key) || []).find((b) => b.part === partNum) || null;

  return {
    constituency,
    key,
    source: 'file',
    roll_year: null,
    part: partNum,
    summary,
    counts: metrics.counts,
    metrics,
    totalUnfiltered: all.length,
    total,
    page,
    pageSize,
    pages,
    voters,
  };
};

module.exports = {
  hasBoothData,
  getBoothsByConstituency,
  getBoothVoters,
  getBoothSummary,
  normalizeConstituencyKey,
};
