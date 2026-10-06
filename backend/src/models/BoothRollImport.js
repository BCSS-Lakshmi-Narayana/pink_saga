/**
 * BoothRollImport
 * ─────────────────────────────────────────────────────────────────────
 * One staged upload of a constituency's ECI electoral roll.
 *
 * An import is a hand-rolled transaction: every voter row is written to
 * `booth_voters` as it arrives, tagged with this session's `_id`, but the
 * read path only ever queries rows belonging to an import whose status is
 * `committed`. So a quarter-million rows can sit fully written and totally
 * invisible, and the single `status` flip in commitImport() is what makes
 * the roll live. That flip is the atomicity.
 *
 * Lifecycle:  staging ──commit──► committed
 *                    └──abort───► aborted
 *
 * A committed import is superseded (not edited) by re-importing the same
 * `(constituency_key, roll_year)`. Different years are retained side by
 * side so a seat can be diffed year over year.
 */

const mongoose = require('mongoose');

const boothRollImportSchema = new mongoose.Schema({
    // ── Seat ──────────────────────────────────────────────────────────
    // Both fields are resolved server-side from the canonical seat list;
    // whatever the browser posted is validated and then discarded. See
    // boothImportService.resolveSeat().
    constituency:     { type: String, required: true, trim: true },
    constituency_key: { type: String, required: true, index: true },
    district:         { type: String, default: null, trim: true },
    ac_number:        { type: Number, default: null },

    // ── Roll identity ─────────────────────────────────────────────────
    // The flattened ECI export carries no year, so if it is not captured
    // at upload time it is gone for good and 2025 becomes
    // indistinguishable from 2026.
    roll_year:  { type: Number, required: true },
    roll_label: { type: String, default: null, trim: true },  // 'Final Roll', 'SSR', …

    status: {
        type: String,
        enum: ['staging', 'committed', 'aborted'],
        default: 'staging',
        index: true,
    },

    // ── Progress ──────────────────────────────────────────────────────
    // expected_parts is exactly what the summary file listed — deliberately
    // NOT assumed contiguous. Real ECI rolls skip part numbers (one earlier import skipped part 43, another
    // 285), so a 1..N range would manufacture phantom missing booths.
    expected_parts: { type: [Number], default: [] },
    received_parts: { type: [Number], default: [] },

    // The summary file verbatim, so commit can rebuild booth rows without
    // asking the operator to re-upload it.
    summary: { type: [mongoose.Schema.Types.Mixed], default: [] },

    // computeBoothMetrics() output keyed by part number. Computed once at
    // stage time so booth drill-down never rescans ~900 voter rows.
    metrics_by_part: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },

    voters_staged: { type: Number, default: 0 },

    // Persisted at commit so the panel never has to aggregate over millions
    // of voter rows just to render a count.
    voters_total: { type: Number, default: 0 },
    booths_total: { type: Number, default: 0 },

    // Capped server-side at 200 entries — a pathological upload should not
    // grow the session document without bound.
    rejected: { type: [mongoose.Schema.Types.Mixed], default: [] },

    created_by:   { type: String, default: null },
    created_at:   { type: Date, default: Date.now },
    committed_at: { type: Date, default: null },
    aborted_at:   { type: Date, default: null },
}, { collection: 'booth_roll_imports' });

// Panel overview + "does this seat have a roll" lookups.
boothRollImportSchema.index({ constituency_key: 1, status: 1 });
// Supersede check at commit: same seat + same year + already committed.
boothRollImportSchema.index({ constituency_key: 1, roll_year: 1, status: 1 });
// Sweeper for staging sessions abandoned by a closed tab.
boothRollImportSchema.index({ status: 1, created_at: 1 });

module.exports = mongoose.model('BoothRollImport', boothRollImportSchema);
