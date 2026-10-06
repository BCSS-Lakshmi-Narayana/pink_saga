/**
 * Booth
 * ─────────────────────────────────────────────────────────────────────
 * One polling station (a "part") of a constituency's electoral roll.
 *
 * Carries the ECI summary row (locality / polling station / elector
 * counts) plus the precomputed `metrics` for that booth, so the booth
 * grid and the drill-down header render without touching `booth_voters`
 * at all.
 *
 * Written in bulk by boothImportController.commitImport() — never
 * individually. Rows are scoped to an `import_id`, so the booths of a
 * staged roll are invisible until that import commits.
 */

const mongoose = require('mongoose');

const boothSchema = new mongoose.Schema({
    constituency:     { type: String, required: true, trim: true },
    constituency_key: { type: String, required: true, index: true },

    import_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BoothRollImport', required: true },

    // Denormalized off the import so the booth grid can be served without a
    // join, and so a year filter is a plain indexed match.
    roll_year: { type: Number, required: true },

    part: { type: Number, required: true },

    locality:        { type: String, default: null, trim: true },
    polling_station: { type: String, default: null, trim: true },

    // Straight off the ECI summary row.
    electors_male:         { type: Number, default: 0 },
    electors_female:       { type: Number, default: 0 },
    electors_third_gender: { type: Number, default: 0 },
    electors_unclassified: { type: Number, default: 0 },
    electors_total:        { type: Number, default: 0 },

    // computeBoothMetrics() output: gender counts, age brackets, avg/median
    // age, young/senior share, households, sex ratio. Null when the part was
    // missing from the upload (the booth still gets a row so the grid shows
    // the gap rather than silently dropping it).
    metrics: { type: mongoose.Schema.Types.Mixed, default: null },

    // Rows actually staged for this part. 0 for a missing part.
    voter_count: { type: Number, default: 0 },

    created_at: { type: Date, default: Date.now },
}, { collection: 'booths' });

// One row per part per import. Unique so a re-run of commit cannot double up.
boothSchema.index({ constituency_key: 1, import_id: 1, part: 1 }, { unique: true });
// Year-scoped booth lookups (grid, year-over-year diff).
boothSchema.index({ constituency_key: 1, roll_year: 1, part: 1 });

module.exports = mongoose.model('Booth', boothSchema);
