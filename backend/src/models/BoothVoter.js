/**
 * BoothVoter  (collection: booth_voters)
 * ─────────────────────────────────────────────────────────────────────
 * One document per elector. This is the big one — a single AC runs
 * ~220k rows, and Srikakulam's eight seats together are several million.
 *
 * Why its own collection rather than an array on the seat: ~250k rows
 * blows the 16MB BSON document limit many times over. That constraint is
 * the entire reason the three-collection design exists.
 *
 * ── Why the schema is so permissive ──────────────────────────────────
 * The ECI Final Roll export is dirty, and validated against real data:
 *   • `voter_id` is NOT unique  — thousands of rows in real ECI rolls share a single id
 *   • `voter_id` is NOT required — real ECI rolls carry many rows with ""
 *   • `age` is nullable          — real ECI rolls carry many rows with no age
 * Rejecting those rows would lose real electors, so dirt is normalized on
 * the way in (boothImportService.normalizeVoter) rather than refused at
 * the DB layer.
 *
 * `constituency_key`, `import_id` and `part` are injected server-side from
 * the import session — never read from the uploaded payload.
 */

const mongoose = require('mongoose');

const boothVoterSchema = new mongoose.Schema({
    constituency_key: { type: String, required: true },
    import_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BoothRollImport', required: true },
    part: { type: Number, required: true },

    sl:       { type: Number, default: null },
    voter_id: { type: String, default: '', trim: true },

    // Each searchable text field keeps a lowercased twin so search is a plain
    // indexed-friendly substring match instead of a per-row $toLower.
    name:        { type: String, default: '', trim: true },
    name_lc:     { type: String, default: '' },
    relation:    { type: String, default: '', trim: true },
    relation_lc: { type: String, default: '' },
    house_no:    { type: String, default: '', trim: true },
    house_no_lc: { type: String, default: '' },

    age: { type: Number, default: null },

    // Normalized to exactly one of: Male | Female | Third | Other | Unknown.
    // Source data carries both "Others" and "Other".
    gender: { type: String, default: 'Unknown' },
}, {
    collection: 'booth_voters',
    // Nothing reads a voter row's create time and there are millions of them.
    timestamps: false,
    versionKey: false,
});

// Primary read path: one booth's roll, in ballot order.
boothVoterSchema.index({ constituency_key: 1, import_id: 1, part: 1, sl: 1 });
// Voter-id lookup within a roll (not unique — see above).
boothVoterSchema.index({ constituency_key: 1, import_id: 1, voter_id: 1 });

module.exports = mongoose.model('BoothVoter', boothVoterSchema);
