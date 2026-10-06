/**
 * Create the Atlas Search / Vector Search indexes the campaign RAG uses.
 *
 * Safe to re-run: existing indexes are reported, never recreated.
 *
 *   node src/scripts/rag-ensure-indexes.js --status     # report only, change nothing
 *   node src/scripts/rag-ensure-indexes.js
 *
 * WHICH DATABASES IT TOUCHES
 * --------------------------
 * One database, one collection: this deployment monitors a single organisation, so it
 * creates exactly one pair of indexes on `grievances`. (The multi-tenant original had to
 * resolve every tenant to its database and deduplicate,
 * from the same command.
 *
 * If the cluster tier does not support search indexes the script says so and exits
 * cleanly. That is a supported deployment: retrieval falls back to in-process scoring,
 * bounded by RAG_CANDIDATE_CAP. It is slower and recency-bounded, not broken.
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const atlas = require('../services/rag/atlasIndexes');
const cfg = require('../services/rag/embeddingConfig');

const STATUS_ONLY = process.argv.includes('--status');
// Apply a changed definition to indexes that already exist. Needed whenever a filter
// field is added: ensure() only creates what is missing, so on a cluster that already
// has the index the new filter would silently match nothing.
const UPDATE = process.argv.includes('--update');
const log = (m) => console.log(`[rag:indexes] ${m}`);

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || undefined });
  log(`connected: ${mongoose.connection.name}`);
  log(`model ${cfg.MODEL} · ${cfg.DIMS}d · ${cfg.SIMILARITY}`);

  const collection = mongoose.connection.collection('grievances');
  log(`\n── ${mongoose.connection.name}.grievances`);

  const caps = await atlas.probe(collection, { force: true });
  log(`   current: vector=${caps.vector ? 'ready' : 'no'} lexical=${caps.lexical ? 'ready' : 'no'}${caps.reason ? ` — ${caps.reason}` : ''}`);

  if (STATUS_ONLY) {
    // Nothing else to do — the line above IS the report.
  } else if (UPDATE) {
    for (const r of await atlas.update(collection)) {
      log(r.status === 'failed' ? `   ✗ ${r.name}: ${r.detail}` : `   ✓ ${r.name}: ${r.status}`);
    }
    log('   note: Atlas rebuilds in place; the old definition stays queryable meanwhile.');
  } else if (caps.vector && caps.lexical) {
    log('   both present — pass --update to apply a changed definition');
  } else {
    for (const r of await atlas.ensure(collection)) {
      if (r.status === 'unsupported') {
        log(`   ✗ search indexes unsupported on this cluster — ${r.detail}`);
        log('     retrieval will use the in-process fallback (see hybridRetrievalService).');
      } else if (r.status === 'failed') {
        log(`   ✗ ${r.name}: ${r.detail}`);
      } else {
        log(`   ✓ ${r.name}: ${r.status}`);
      }
    }
    // Building is asynchronous on Atlas; a freshly created index is not queryable for a
    // minute or two, and querying it before then returns nothing rather than erroring.
    log('   note: new indexes take a few minutes to build before they return results.');
  }

  await mongoose.disconnect();
  log('\ndone');
};

main().catch(async (err) => {
  console.error('[rag:indexes] fatal:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
