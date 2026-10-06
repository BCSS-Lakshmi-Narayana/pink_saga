/**
 * boothImportController
 * ─────────────────────────────────────────────────────────────────────
 * Staged bulk import of a constituency's ECI electoral roll.
 *
 * The flow is a hand-rolled transaction, because the volume (~220k voter
 * rows for one seat) rules out an actual one:
 *
 *   1. POST   /booth-imports              create session from the summary
 *   2. POST   /booth-imports/:id/parts    stage a batch of booth files  ×N
 *   3. GET    /booth-imports/:id          progress / missing_parts
 *   4. POST   /booth-imports/:id/commit   go live
 *   5. DELETE /booth-imports/:id          abort + sweep staged rows
 *
 * Every row written in step 2 is tagged with the session id, and the read
 * path only ever queries rows whose import is `committed`. So the entire
 * roll lands invisibly and step 4's single status flip publishes it.
 *
 * Files are never uploaded as files: the browser parses the JSON and posts
 * it in the request body (express.json is configured at 50mb in index.js).
 */

const mongoose = require('mongoose');
const BoothRollImport = require('../models/BoothRollImport');
const Booth = require('../models/Booth');
const BoothVoter = require('../models/BoothVoter');
const { createAuditLog } = require('../services/auditService');
const { computeBoothMetrics } = require('../utils/boothMetrics');
const {
    MAX_VOTERS_PER_PART,
    MAX_PARTS_PER_BATCH,
    INSERT_CHUNK,
    BOOTH_CHUNK,
    MAX_REJECTED,
    PART_WRITE_CONCURRENCY,
    mapLimit,
    listSeats,
    resolveSeat,
    resolveRollYear,
    normalizeSummaryRows,
    normalizeVoter,
    extractVoterRows,
} = require('../services/boothImportService');

/* ── Authorization ────────────────────────────────────────────────────
 * Mirrors the read path exactly (voterProfileController.isInScope): a
 * user who may not VIEW a seat may certainly not import a roll for it.
 * `req.scope` is populated by scopeMiddleware.loadScope.
 */
const canAccessSeat = (scope, seat) => {
    if (!scope || scope.canSeeAll) return true;
    const allowed = scope.constituencyKeys || new Set();
    // scope keys are normalized names; our seat key may carry an `-<ac>`
    // suffix for the duplicate-name seats, so compare on the bare name too.
    return allowed.has(seat.constituency_key) ||
        allowed.has(seat.constituency_key.replace(/-\d+$/, ''));
};

const forbidden = (res) => res.status(403).json({
    success: false,
    code: 'CONSTITUENCY_FORBIDDEN',
    message: 'You are not authorized to manage booth data for this constituency',
});

const actor = (req) => req.user?.email || req.user?.username || String(req.user?._id || 'unknown');

/**
 * Load a session and check the caller may act on it.
 * `projection` lets a hot path skip the heavy fields — uploadParts runs 25+
 * times per import and has no use for the 242-row `summary` blob.
 */
const loadSession = async (req, res, projection = null) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
        res.status(400).json({ success: false, message: 'Invalid import id' });
        return null;
    }
    const query = BoothRollImport.findById(id);
    if (projection) query.select(projection);
    const session = await query;
    if (!session) {
        res.status(404).json({ success: false, message: 'Import session not found' });
        return null;
    }
    if (!canAccessSeat(req.scope, session)) {
        forbidden(res);
        return null;
    }
    return session;
};

/* ── GET /api/booth-imports/seats ─────────────────────────────────────
 * Dropdown source: every seat the caller may import for, each flagged
 * with whether it already holds a committed roll. */
const getSeats = async (req, res) => {
    try {
        const seats = listSeats().filter((s) => canAccessSeat(req.scope, s));

        const committed = await BoothRollImport.find({ status: 'committed' })
            .select('constituency_key roll_year booths_total voters_total committed_at')
            .lean();

        const byKey = new Map();
        committed.forEach((c) => {
            const prev = byKey.get(c.constituency_key);
            // Surface the newest roll when a seat holds several years.
            if (!prev || c.roll_year > prev.roll_year) byKey.set(c.constituency_key, c);
        });

        const data = seats.map((s) => {
            const roll = byKey.get(s.constituency_key) || null;
            return {
                ...s,
                has_roll: Boolean(roll),
                roll_year: roll ? roll.roll_year : null,
                booths: roll ? roll.booths_total : 0,
                voters: roll ? roll.voters_total : 0,
            };
        });

        return res.json({
            success: true,
            total_seats: data.length,
            seats_with_roll: data.filter((d) => d.has_roll).length,
            data,
        });
    } catch (err) {
        console.error('[boothImport] seats error:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to list seats' });
    }
};

/* ── GET /api/booth-imports ───────────────────────────────────────────
 * Panel overview. Reads the persisted totals off each session rather than
 * aggregating booth_voters — at 175 seats that aggregation would scan tens
 * of millions of documents on every page load. */
const listImports = async (req, res) => {
    try {
        const filter = {};
        if (req.query.constituency_key) filter.constituency_key = req.query.constituency_key;
        if (req.query.status) filter.status = req.query.status;

        let rows = await BoothRollImport.find(filter)
            .select('-summary -metrics_by_part -rejected')
            .sort({ created_at: -1 })
            .limit(Math.min(200, Number(req.query.limit) || 100))
            .lean();

        if (!req.scope?.canSeeAll) rows = rows.filter((r) => canAccessSeat(req.scope, r));

        return res.json({
            success: true,
            count: rows.length,
            data: rows.map((r) => ({
                import_id: r._id,
                constituency: r.constituency,
                constituency_key: r.constituency_key,
                district: r.district,
                ac_number: r.ac_number,
                roll_year: r.roll_year,
                roll_label: r.roll_label,
                status: r.status,
                expected: (r.expected_parts || []).length,
                received: (r.received_parts || []).length,
                voters_staged: r.voters_staged,
                voters_total: r.voters_total,
                booths_total: r.booths_total,
                created_by: r.created_by,
                created_at: r.created_at,
                committed_at: r.committed_at,
            })),
        });
    } catch (err) {
        console.error('[boothImport] list error:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to list imports' });
    }
};

/* ── POST /api/booth-imports ──────────────────────────────────────────
 * Create the staging session from the summary file. This is the
 * security-critical step: the posted seat is re-resolved against the
 * canonical list and the client's value is discarded. */
const createImport = async (req, res) => {
    try {
        const { ac_number, constituency, roll_year, roll_label, summary } = req.body || {};

        const { seat, error: seatErr } = resolveSeat({ ac_number, constituency });
        if (seatErr) return res.status(400).json({ success: false, message: seatErr });
        if (!canAccessSeat(req.scope, seat)) return forbidden(res);

        const { year, error: yearErr } = resolveRollYear(roll_year);
        if (yearErr) return res.status(400).json({ success: false, message: yearErr });

        const { rows, dropped, error: sumErr } = normalizeSummaryRows(summary);
        if (sumErr) return res.status(400).json({ success: false, message: sumErr });

        // Warn (don't block) when this seat+year already has a roll or a
        // half-finished session — the operator may legitimately be replacing
        // the year, or may have meant to resume.
        const [existingCommitted, existingStaging] = await Promise.all([
            BoothRollImport.findOne({ constituency_key: seat.constituency_key, roll_year: year, status: 'committed' })
                .select('_id booths_total voters_total committed_at').lean(),
            BoothRollImport.findOne({ constituency_key: seat.constituency_key, roll_year: year, status: 'staging' })
                .select('_id received_parts expected_parts created_at').lean(),
        ]);

        const session = await BoothRollImport.create({
            constituency: seat.constituency,
            constituency_key: seat.constituency_key,
            district: seat.district,
            ac_number: seat.ac_number,
            roll_year: year,
            roll_label: roll_label ? String(roll_label).trim() : null,
            status: 'staging',
            expected_parts: rows.map((r) => r.part),
            received_parts: [],
            summary: rows,
            created_by: actor(req),
        });

        await createAuditLog(req.user, 'booth_roll_import_start', 'booth_rolls', String(session._id), {
            constituency: seat.constituency, roll_year: year, expected_parts: rows.length,
        });

        return res.status(201).json({
            success: true,
            import_id: session._id,
            constituency: seat.constituency,
            constituency_key: seat.constituency_key,
            district: seat.district,
            ac_number: seat.ac_number,
            roll_year: year,
            expected_parts: session.expected_parts,
            total_expected: session.expected_parts.length,
            duplicate_or_invalid_summary_rows: dropped,
            // Purely advisory — the UI shows these as confirmations.
            existing_committed: existingCommitted
                ? { import_id: existingCommitted._id, booths: existingCommitted.booths_total, voters: existingCommitted.voters_total, committed_at: existingCommitted.committed_at }
                : null,
            existing_staging: existingStaging
                ? { import_id: existingStaging._id, received: (existingStaging.received_parts || []).length, expected: (existingStaging.expected_parts || []).length, created_at: existingStaging.created_at }
                : null,
        });
    } catch (err) {
        console.error('[boothImport] create error:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to create import session' });
    }
};

/* ── POST /api/booth-imports/:id/parts ────────────────────────────────
 * Stage one batch of booth files. Each part is written independently, so
 * one malformed booth costs that booth and not the batch. */
const uploadParts = async (req, res) => {
    // Timing is reported back to the client, which compares it against its own
    // round-trip duration. That single subtraction splits network cost from
    // database cost — without it, "the upload is slow" is unfalsifiable.
    const tRequest = Date.now();
    let tSessionLoad = 0;
    let tWrites = 0;
    let tSessionUpdate = 0;
    let dbMs = 0;   // summed across parts; exceeds tWrites because they overlap

    try {
        // `summary` and `rejected` are dead weight here and `summary` alone is
        // a few hundred rows re-read on every batch.
        const tS = Date.now();
        const session = await loadSession(req, res, '-summary -rejected');
        tSessionLoad = Date.now() - tS;
        if (!session) return undefined;

        if (session.status !== 'staging') {
            return res.status(409).json({
                success: false,
                message: `Import is ${session.status} — only a staging import accepts parts`,
            });
        }

        const parts = req.body?.parts;
        if (!Array.isArray(parts) || parts.length === 0) {
            return res.status(400).json({ success: false, message: '`parts` must be a non-empty array' });
        }
        if (parts.length > MAX_PARTS_PER_BATCH) {
            return res.status(413).json({
                success: false,
                message: `Too many parts in one request (${parts.length} > ${MAX_PARTS_PER_BATCH})`,
            });
        }

        const expected = new Set(session.expected_parts);
        // Previously recorded per-part totals, so a re-sent part adjusts the
        // running count by the DELTA instead of double-counting it.
        const priorTotals = new Map();
        (session.metrics_by_part || new Map()).forEach((m, k) => {
            priorTotals.set(Number(k), Number(m?.total) || 0);
        });

        const accepted = [];
        const rejected = [];
        const metricsSet = {};
        let stagedDelta = 0;

        // Parts are written CONCURRENTLY, not one after another. Each part
        // costs a deleteMany plus an insertMany, so a serial loop over a
        // 10-part batch is ~20 sequential round trips — on localhost that is
        // invisible, but against a remote Mongo (or through a tunnel) every
        // hop pays full latency and the batch takes seconds instead of one
        // round trip's worth. Parts touch disjoint document sets, keyed by
        // part number, so there is nothing to serialise them for.
        const alreadyStaged = new Set(session.received_parts || []);
        let rowsWritten = 0;

        const tW = Date.now();
        await mapLimit(parts, PART_WRITE_CONCURRENCY, async (entry) => {
            const partNum = Number(entry?.part);
            if (!Number.isFinite(partNum) || partNum <= 0) {
                rejected.push({ part: entry?.part ?? null, reason: 'unreadable_part_number' });
                return;
            }
            if (!expected.has(partNum)) {
                rejected.push({ part: partNum, reason: 'not_in_expected_parts' });
                return;
            }

            const rows = extractVoterRows(entry?.voters ?? entry?.rows ?? entry?.data);
            if (!rows) {
                rejected.push({ part: partNum, reason: 'voters_missing_or_not_an_array' });
                return;
            }
            if (rows.length > MAX_VOTERS_PER_PART) {
                rejected.push({ part: partNum, reason: `too_many_voters (${rows.length} > ${MAX_VOTERS_PER_PART})` });
                return;
            }

            const scope = {
                constituency_key: session.constituency_key,
                import_id: session._id,
                part: partNum,
            };
            const docs = rows.map((v) => normalizeVoter(v, scope));

            try {
                const tDb = Date.now();
                // Idempotency: a retried part must overwrite, never duplicate.
                // Only a part we have actually staged before can have rows to
                // clear, so a first upload skips 10 pointless round trips per
                // batch. The catch below re-deletes on failure, so a part that
                // half-landed is never left behind for this to miss.
                if (alreadyStaged.has(partNum)) await BoothVoter.deleteMany(scope);

                // The native driver, deliberately: normalizeVoter already emits
                // the exact stored shape, so Mongoose casting is pure overhead
                // (measured 1.4× slower) on the hottest path in the pipeline.
                for (let i = 0; i < docs.length; i += INSERT_CHUNK) {
                    await BoothVoter.collection.insertMany(docs.slice(i, i + INSERT_CHUNK), { ordered: false });
                }
                dbMs += Date.now() - tDb;
                rowsWritten += docs.length;

                const metrics = computeBoothMetrics(docs);
                metricsSet[`metrics_by_part.${partNum}`] = metrics;
                stagedDelta += docs.length - (priorTotals.get(partNum) || 0);
                accepted.push(partNum);
            } catch (writeErr) {
                // Roll the part back so a half-written booth never survives.
                await BoothVoter.deleteMany(scope).catch(() => {});
                console.error(`[boothImport] part ${partNum} write failed:`, writeErr.message);
                rejected.push({ part: partNum, reason: `write_failed: ${writeErr.message}` });
            }
        });
        tWrites = Date.now() - tW;

        accepted.sort((a, b) => a - b);

        // One atomic operator set. A save() of the whole document would let
        // the client's concurrent batches clobber each other's received_parts.
        const update = {};
        if (accepted.length) {
            update.$addToSet = { received_parts: { $each: accepted } };
            update.$set = metricsSet;
        }
        if (stagedDelta !== 0) update.$inc = { voters_staged: stagedDelta };
        if (rejected.length) {
            update.$push = { rejected: { $each: rejected, $slice: -MAX_REJECTED } };
        }

        let received = (session.received_parts || []).length;
        let votersStaged = session.voters_staged;
        if (Object.keys(update).length) {
            const tU = Date.now();
            const updated = await BoothRollImport.findByIdAndUpdate(session._id, update, { new: true })
                .select('received_parts voters_staged expected_parts').lean();
            tSessionUpdate = Date.now() - tU;
            received = (updated?.received_parts || []).length;
            votersStaged = updated?.voters_staged ?? votersStaged;
        }

        const totalMs = Date.now() - tRequest;
        console.log(
            `[boothImport] ${session.constituency} parts=${accepted.length} rows=${rowsWritten} ` +
            `server=${totalMs}ms (session ${tSessionLoad}ms + writes ${tWrites}ms + update ${tSessionUpdate}ms, ` +
            `db ${dbMs}ms across ${PART_WRITE_CONCURRENCY}-way fan-out)`,
        );

        return res.json({
            success: true,
            import_id: session._id,
            accepted,
            rejected,
            received_parts: received,
            expected_parts: session.expected_parts.length,
            voters_staged: votersStaged,
            // Subtract `total_ms` from the client's own round-trip time and
            // whatever is left is network + proxy, not the database.
            timings: {
                total_ms: totalMs,
                session_load_ms: tSessionLoad,
                writes_ms: tWrites,
                session_update_ms: tSessionUpdate,
                db_ms: dbMs,
                rows: rowsWritten,
            },
        });
    } catch (err) {
        console.error('[boothImport] parts error:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to stage booth files' });
    }
};

/* ── GET /api/booth-imports/:id ───────────────────────────────────────
 * Progress + which parts are still outstanding. */
const getImport = async (req, res) => {
    try {
        const session = await loadSession(req, res);
        if (!session) return undefined;

        const received = new Set(session.received_parts);
        const missing = session.expected_parts.filter((p) => !received.has(p));

        return res.json({
            success: true,
            import_id: session._id,
            constituency: session.constituency,
            constituency_key: session.constituency_key,
            district: session.district,
            ac_number: session.ac_number,
            roll_year: session.roll_year,
            roll_label: session.roll_label,
            status: session.status,
            expected_parts: session.expected_parts.length,
            received_parts: session.received_parts.length,
            missing_parts: missing,
            voters_staged: session.voters_staged,
            voters_total: session.voters_total,
            booths_total: session.booths_total,
            rejected: session.rejected || [],
            created_by: session.created_by,
            created_at: session.created_at,
            committed_at: session.committed_at,
        });
    } catch (err) {
        console.error('[boothImport] get error:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to load import' });
    }
};

/* ── POST /api/booth-imports/:id/commit ───────────────────────────────
 * Publish the roll. Everything before this point was invisible. */
const commitImport = async (req, res) => {
    try {
        const session = await loadSession(req, res);
        if (!session) return undefined;

        if (session.status === 'committed') {
            return res.status(409).json({ success: false, message: 'Import is already committed' });
        }
        if (session.status === 'aborted') {
            return res.status(409).json({ success: false, message: 'Import was aborted and cannot be committed' });
        }

        const received = new Set(session.received_parts);
        const missing = session.expected_parts.filter((p) => !received.has(p));
        const allowPartial = req.query.allow_partial === 'true' || req.body?.allow_partial === true;
        if (missing.length && !allowPartial) {
            return res.status(409).json({
                success: false,
                code: 'MISSING_PARTS',
                message: `${missing.length} booth file(s) never landed — re-send them, or commit with allow_partial=true`,
                missing_parts: missing,
            });
        }

        // The roll this one replaces: same seat AND same year. A different
        // year is a separate historical record and is left alone, so a seat
        // can be diffed year over year.
        const superseded = await BoothRollImport.findOne({
            constituency_key: session.constituency_key,
            roll_year: session.roll_year,
            status: 'committed',
            _id: { $ne: session._id },
        }).select('_id');

        // Build one Booth row per summary part. A part that never landed
        // still gets a row (voter_count 0) so the grid shows the gap rather
        // than silently omitting the booth.
        const metricsByPart = session.metrics_by_part || new Map();
        const boothDocs = session.summary.map((row) => {
            const m = metricsByPart.get(String(row.part)) || null;
            return {
                constituency: session.constituency,
                constituency_key: session.constituency_key,
                import_id: session._id,
                roll_year: session.roll_year,
                part: row.part,
                locality: row.locality,
                polling_station: row.polling_station,
                electors_male: row.electors_male,
                electors_female: row.electors_female,
                electors_third_gender: row.electors_third_gender,
                electors_unclassified: row.electors_unclassified,
                electors_total: row.electors_total,
                metrics: m,
                voter_count: m ? Number(m.total) || 0 : 0,
            };
        });

        await Booth.deleteMany({ constituency_key: session.constituency_key, import_id: session._id });
        for (let i = 0; i < boothDocs.length; i += BOOTH_CHUNK) {
            await Booth.insertMany(boothDocs.slice(i, i + BOOTH_CHUNK), { ordered: false });
        }

        const votersTotal = boothDocs.reduce((sum, b) => sum + b.voter_count, 0);

        // ── The flip. This single write publishes the roll. ──
        session.status = 'committed';
        session.committed_at = new Date();
        session.voters_total = votersTotal;
        session.booths_total = boothDocs.length;
        await session.save();

        // Purge the roll we just replaced. Ordered after the flip so a crash
        // here leaves the NEW roll live and only strands the old rows.
        let purged = { voters: 0, booths: 0 };
        if (superseded) {
            const [v, b] = await Promise.all([
                BoothVoter.deleteMany({ constituency_key: session.constituency_key, import_id: superseded._id }),
                Booth.deleteMany({ constituency_key: session.constituency_key, import_id: superseded._id }),
            ]);
            purged = { voters: v.deletedCount || 0, booths: b.deletedCount || 0 };
            await BoothRollImport.updateOne(
                { _id: superseded._id },
                { $set: { status: 'aborted', aborted_at: new Date() } },
            );
        }

        await createAuditLog(req.user, 'booth_roll_import_commit', 'booth_rolls', String(session._id), {
            constituency: session.constituency,
            roll_year: session.roll_year,
            booths: boothDocs.length,
            voters: votersTotal,
            missing_parts: missing.length,
        });

        return res.json({
            success: true,
            import_id: session._id,
            constituency: session.constituency,
            roll_year: session.roll_year,
            booths_written: boothDocs.length,
            booths_with_roll: boothDocs.filter((b) => b.voter_count > 0).length,
            voters_total: votersTotal,
            missing_parts: missing,
            superseded_import_id: superseded ? superseded._id : null,
            purged,
        });
    } catch (err) {
        console.error('[boothImport] commit error:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to commit import' });
    }
};

/* ── DELETE /api/booth-imports/:id ────────────────────────────────────
 * Two behaviours behind one route, because both mean "get rid of this":
 *
 *   • staging / aborted → abort. Sweeps the staged voter + booth rows and
 *     marks the session aborted. The session record is kept: it is part of
 *     the upload flow's history and costs nothing.
 *
 *   • committed → DELETE. Takes the roll off the air and removes it
 *     entirely, session document included, so the seat reads as having no
 *     roll for that year and can be re-imported from scratch. Requires an
 *     explicit `confirm=true` because it destroys live data; the 409 that
 *     comes back without it carries the row counts so the UI can show the
 *     operator exactly what they are about to lose.
 *
 * Either way the cascade is the same and runs first: booth_voters, then
 * booths, then the session. Deleting the session before its rows would
 * orphan them with no remaining pointer to sweep them by.
 */
const deleteImport = async (req, res) => {
    try {
        const session = await loadSession(req, res);
        if (!session) return undefined;

        const isCommitted = session.status === 'committed';
        const confirmed = req.query.confirm === 'true' || req.body?.confirm === true;

        if (isCommitted && !confirmed) {
            return res.status(409).json({
                success: false,
                code: 'CONFIRM_REQUIRED',
                message: `This permanently deletes the live ${session.roll_year} roll for ${session.constituency}.`,
                constituency: session.constituency,
                roll_year: session.roll_year,
                booths: session.booths_total,
                voters: session.voters_total,
            });
        }

        // constituency_key is included so both deletes use the compound
        // index prefix rather than scanning the whole voter collection.
        const scope = { constituency_key: session.constituency_key, import_id: session._id };
        const [v, b] = await Promise.all([
            BoothVoter.deleteMany(scope),
            Booth.deleteMany(scope),
        ]);

        if (isCommitted) {
            await BoothRollImport.deleteOne({ _id: session._id });
        } else {
            session.status = 'aborted';
            session.aborted_at = new Date();
            await session.save();
        }

        await createAuditLog(
            req.user,
            isCommitted ? 'booth_roll_delete' : 'booth_roll_import_abort',
            'booth_rolls',
            String(session._id),
            {
                constituency: session.constituency,
                roll_year: session.roll_year,
                voters_deleted: v.deletedCount || 0,
                booths_deleted: b.deletedCount || 0,
            },
        );

        // What the seat falls back to now — an older year, or nothing.
        const remaining = await BoothRollImport.findOne({
            constituency_key: session.constituency_key,
            status: 'committed',
        }).sort({ roll_year: -1 }).select('roll_year booths_total voters_total').lean();

        return res.json({
            success: true,
            import_id: session._id,
            action: isCommitted ? 'deleted' : 'aborted',
            constituency: session.constituency,
            roll_year: session.roll_year,
            deleted: { voters: v.deletedCount || 0, booths: b.deletedCount || 0 },
            now_serving: remaining
                ? { roll_year: remaining.roll_year, booths: remaining.booths_total, voters: remaining.voters_total }
                : null,
        });
    } catch (err) {
        console.error('[boothImport] delete error:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to delete import' });
    }
};

/* ── PUT /api/booth-imports/:id  (alias: /:id/year) ───────────────────
 * Update a roll's identity — its year and/or its revision label.
 *
 * Only the labelling is editable. The roll's DATA is never patched in
 * place: to change what a seat holds, re-import the year, which supersedes
 * the old roll atomically through the staged flow. A partial in-place edit
 * would leave booths and voters disagreeing about which roll they belong
 * to, with no way to tell which rows were updated.
 *
 * Changing the year rewrites the denormalized `roll_year` on every booth
 * row of this import so the two never drift, and refuses a year already
 * held by another committed roll for the seat — that would make two rolls
 * indistinguishable to the supersede check.
 */
const updateImport = async (req, res) => {
    try {
        const session = await loadSession(req, res);
        if (!session) return undefined;

        const hasYear = req.body?.roll_year !== undefined;
        const hasLabel = req.body?.roll_label !== undefined;
        if (!hasYear && !hasLabel) {
            return res.status(400).json({ success: false, message: 'Nothing to update — send roll_year and/or roll_label' });
        }

        let yearChanged = false;
        if (hasYear) {
            const { year, error } = resolveRollYear(req.body.roll_year);
            if (error) return res.status(400).json({ success: false, message: error });

            if (year !== session.roll_year) {
                const clash = await BoothRollImport.findOne({
                    constituency_key: session.constituency_key,
                    roll_year: year,
                    status: 'committed',
                    _id: { $ne: session._id },
                }).select('_id');
                if (clash) {
                    return res.status(409).json({
                        success: false,
                        message: `${session.constituency} already has a committed ${year} roll`,
                    });
                }
                session.roll_year = year;
                yearChanged = true;
            }
        }

        if (hasLabel) {
            session.roll_label = req.body.roll_label ? String(req.body.roll_label).trim() : null;
        }

        await session.save();

        // Keep the denormalized copy on the booth rows in step.
        if (yearChanged) {
            await Booth.updateMany(
                { constituency_key: session.constituency_key, import_id: session._id },
                { $set: { roll_year: session.roll_year } },
            );
        }

        await createAuditLog(req.user, 'booth_roll_update', 'booth_rolls', String(session._id), {
            constituency: session.constituency,
            roll_year: session.roll_year,
            roll_label: session.roll_label,
        });

        return res.json({
            success: true,
            import_id: session._id,
            constituency: session.constituency,
            roll_year: session.roll_year,
            roll_label: session.roll_label,
        });
    } catch (err) {
        console.error('[boothImport] update error:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to update roll' });
    }
};

module.exports = {
    getSeats,
    listImports,
    createImport,
    uploadParts,
    getImport,
    commitImport,
    deleteImport,
    updateImport,
};
