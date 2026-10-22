/**
 * ElectionHistory
 * ─────────────────────────────────────────────────────────────────────
 * Published Telangana election results for the Electoral Analysis, written
 * by scripts/build_election_history.js after it has verified them against
 * the officially declared tallies. Read-only for the app.
 *
 * One collection, three kinds of document:
 *   kind 'seat'       one per assembly seat (key = seat key, e.g. 'gajwel'):
 *                     every MLA result, MP assembly-area result, by-polls,
 *                     district, Lok Sabha seat and 2023 elector counts
 *   kind 'lok_sabha'  one per Lok Sabha seat (key = 'medak'): its full
 *                     result in 2014, 2019 and 2024
 *   kind 'meta'       one document (key = 'meta'): sources, statewide
 *                     shares, 2023 manifestos, checks passed
 */
const mongoose = require('mongoose');

const electionHistorySchema = new mongoose.Schema({
    kind: { type: String, required: true, enum: ['seat', 'lok_sabha', 'meta'] },
    key: { type: String, required: true },
    ac_number: { type: Number, default: null },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    built: { type: String, default: null },
    updated_at: { type: Date, default: Date.now },
}, { collection: 'election_history', minimize: false });

electionHistorySchema.index({ kind: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('ElectionHistory', electionHistorySchema);
