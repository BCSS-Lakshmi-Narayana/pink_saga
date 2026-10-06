#!/usr/bin/env node
/**
 * Evaluates the deterministic YouTube Live chat relevance gate
 * (youtubeLiveService.js's isChatRelevant/analyzeFast) against a small,
 * hand-labeled ground-truth set drawn from real production chat
 * (scripts/eval_data/live_chat_relevance_eval.json — relevant/irrelevant/
 * ambiguous, built the same way as the reference implementation's own eval
 * set: real messages, hand-judged, ambiguous kept as its own class rather
 * than folded into either side).
 *
 * No LLM, no DB, no network — runs in milliseconds.
 *
 *   node scripts/eval_relevance_filter.js
 */
const fs = require('fs');
const path = require('path');
const { analyzeFast } = require('../src/services/youtubeLiveService');

const DATASET_PATH = path.join(__dirname, 'eval_data', 'live_chat_relevance_eval.json');
const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
if (!dataset.length) {
    console.log(`No labelled chat in ${DATASET_PATH}. Add real Telangana live-chat messages as { "text", "label": "relevant"|"irrelevant"|"ambiguous", "note"? } rows, then re-run.`);
    process.exit(0);
}

const results = dataset.map((row) => {
    const { fields } = analyzeFast(row.text);
    return { ...row, predicted: fields.is_political ? 'relevant' : 'irrelevant' };
});

const confusion = (rows) => {
    const tp = rows.filter((r) => r.label === 'relevant' && r.predicted === 'relevant').length;
    const fn = rows.filter((r) => r.label === 'relevant' && r.predicted === 'irrelevant').length;
    const tn = rows.filter((r) => r.label === 'irrelevant' && r.predicted === 'irrelevant').length;
    const fp = rows.filter((r) => r.label === 'irrelevant' && r.predicted === 'relevant').length;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return { tp, fn, tn, fp, precision, recall, f1 };
};

const ambiguous = results.filter((r) => r.label === 'ambiguous');
const core = results.filter((r) => r.label !== 'ambiguous');
const hardNegatives = results.filter((r) => r.label === 'irrelevant' && r.note);

const c = confusion(core);

console.log(`Total evaluated: ${dataset.length} (${core.length} core + ${ambiguous.length} ambiguous, excluded from the core metric)\n`);

console.log('=== CONFUSION MATRIX (core: relevant vs. irrelevant only) ===');
console.log(`TP=${c.tp}  FN=${c.fn}  TN=${c.tn}  FP=${c.fp}`);
console.log(`precision=${(c.precision * 100).toFixed(1)}%  recall=${(c.recall * 100).toFixed(1)}%  F1=${(c.f1 * 100).toFixed(1)}%\n`);

console.log('=== HARD-NEGATIVE PERFORMANCE (labeled irrelevant, explicitly designed as traps) ===');
let hnPass = 0;
for (const r of hardNegatives) {
    const ok = r.predicted === 'irrelevant';
    if (ok) hnPass++;
    console.log(`${ok ? 'PASS' : '*** FAIL'}  "${r.text}"  (${r.note})`);
}
console.log(`${hnPass}/${hardNegatives.length} hard negatives correctly rejected\n`);

console.log('=== FALSE NEGATIVES (labeled relevant, gate said irrelevant — documented recall gaps) ===');
for (const r of core.filter((r) => r.label === 'relevant' && r.predicted === 'irrelevant')) {
    console.log(`  "${r.text}"${r.note ? `  — ${r.note}` : ''}`);
}

console.log('\n=== FALSE POSITIVES (labeled irrelevant, gate said relevant — should be none) ===');
const falsePositives = core.filter((r) => r.label === 'irrelevant' && r.predicted === 'relevant');
if (!falsePositives.length) console.log('  (none)');
for (const r of falsePositives) console.log(`  "${r.text}"`);

console.log('\n=== AMBIGUOUS rows (not scored, reported for visibility) ===');
for (const r of ambiguous) console.log(`  [${r.predicted}]  "${r.text}"`);

process.exit(falsePositives.length ? 1 : 0);
