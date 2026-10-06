/**
 * atlasIndexes — the Atlas Search / Vector Search index definitions, plus the capability
 * probe the retrieval path uses to decide whether it can use them at all.
 *
 * WHY A PROBE INSTEAD OF A CONFIG FLAG
 * ------------------------------------
 * Atlas Search indexes are a cluster feature, not a driver feature. Whether they exist
 * depends on the tier, on whether someone ran the ensure script, and on whether the
 * index has finished building — none of which this process controls, and all of which
 * can change under it. A boolean in .env would go stale the first time any of those
 * moved, and the failure mode is silent: `$vectorSearch` against a missing index throws
 * mid-aggregation, so the campaign engine would surface an error instead of results.
 *
 * So capability is discovered, cached briefly, and re-checked. When it is absent the
 * retrieval service runs its own scoring instead. That is slower and bounded, but it
 * returns the right documents, which matters more than the mechanism.
 *
 * IMPORTANT: index names are shared with the aggregation pipelines. Change them here and
 * nowhere else.
 */

const cfg = require('./embeddingConfig');

const VECTOR_INDEX = 'grievance_vector_index';
const SEARCH_INDEX = 'grievance_search_index';

/**
 * Vector index. `filter` fields are declared so the filters are applied INSIDE the
 * vector search rather than after it — filtering afterwards would let irrelevant posts
 * consume the k nearest neighbours and leave the real matches out, which is both
 * a quality bug and a data-isolation smell.
 */
const vectorIndexDefinition = () => ({
  name: VECTOR_INDEX,
  type: 'vectorSearch',
  definition: {
    fields: [
      { type: 'vector', path: 'embedding', numDimensions: cfg.DIMS, similarity: cfg.SIMILARITY },
      { type: 'filter', path: 'is_active' },
      { type: 'filter', path: 'analysis.needs_review' },
      { type: 'filter', path: 'analysis.political_stance' },
      { type: 'filter', path: 'analysis.topic' },
      { type: 'filter', path: 'analysis.grievance_type' },
      { type: 'filter', path: 'platform' },
      { type: 'filter', path: 'post_date' },
    ],
  },
});

/**
 * Lexical index — the BM25 half of the hybrid.
 *
 * `lucene.standard` rather than an English analyzer on purpose: an English analyzer
 * stems and strips stopwords for one language and mangles the rest, and this corpus is
 * majority Telugu. The standard analyzer tokenises Unicode without pretending to know
 * the language, which is what keeps exact Telugu terms like "వైసీపీ" matchable — the
 * precise thing dense vectors are worst at and the reason the hybrid exists.
 */
const searchIndexDefinition = () => ({
  name: SEARCH_INDEX,
  type: 'search',
  definition: {
    mappings: {
      dynamic: false,
      fields: {
        content: {
          type: 'document',
          fields: { text: { type: 'string', analyzer: 'lucene.standard' } },
        },
        analysis: {
          type: 'document',
          fields: {
            grievance_type: { type: 'string', analyzer: 'lucene.standard' },
            category: { type: 'string', analyzer: 'lucene.standard' },
            stance: { type: 'token' },
          },
        },
        is_active: { type: 'boolean' },
        platform: { type: 'token' },
        post_date: { type: 'date' },
      },
    },
  },
});

// ── capability probe ─────────────────────────────────────────────────────────

const PROBE_TTL_MS = 60_000;
const probeCache = new Map(); // dbName.collection -> { at, caps }

/**
 * What this collection can actually do right now.
 *
 * Returns { vector, lexical, reason }. `queryable` is what we check, not mere existence:
 * a freshly created Atlas index reports itself while still building, and querying it
 * then returns nothing rather than failing — which would look like "no relevant posts".
 */
const probe = async (collection, { force = false } = {}) => {
  const key = `${collection.dbName || collection.s?.db?.databaseName || '?'}.${collection.collectionName}`;
  const hit = probeCache.get(key);
  if (!force && hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.caps;

  let caps = { vector: false, lexical: false, reason: '' };
  try {
    const list = await collection.listSearchIndexes().toArray();
    const byName = new Map(list.map((i) => [i.name, i]));
    const ready = (name) => {
      const i = byName.get(name);
      if (!i) return false;
      // Drivers differ on the field; treat an explicit false as not ready, absence as ok.
      if (i.queryable === false) return false;
      if (i.status && !['READY', 'STALE'].includes(String(i.status).toUpperCase())) return false;
      return true;
    };
    caps = {
      vector: ready(VECTOR_INDEX),
      lexical: ready(SEARCH_INDEX),
      reason: list.length ? '' : 'no search indexes on this collection',
    };
  } catch (err) {
    // Shared/serverless tiers reject listSearchIndexes outright. That is a legitimate
    // deployment, not an error to propagate — the fallback path handles it.
    caps = { vector: false, lexical: false, reason: `search unavailable: ${err.message}` };
  }

  probeCache.set(key, { at: Date.now(), caps });
  return caps;
};

/** Force the next probe to re-check — called after creating indexes. */
const invalidateProbe = () => probeCache.clear();

/**
 * Create the indexes if missing. Returns a per-index outcome rather than throwing, so a
 * cluster that supports one and not the other still gets the one it can have.
 */
const ensure = async (collection) => {
  const results = [];
  let existing = [];
  try {
    existing = await collection.listSearchIndexes().toArray();
  } catch (err) {
    return [{ name: '*', status: 'unsupported', detail: err.message }];
  }
  const have = new Set(existing.map((i) => i.name));

  for (const def of [vectorIndexDefinition(), searchIndexDefinition()]) {
    if (have.has(def.name)) {
      results.push({ name: def.name, status: 'exists' });
      continue;
    }
    try {
      await collection.createSearchIndex(def);
      results.push({ name: def.name, status: 'created' });
    } catch (err) {
      results.push({ name: def.name, status: 'failed', detail: err.message });
    }
  }
  invalidateProbe();
  return results;
};

/**
 * Apply a changed definition to an EXISTING index.
 *
 * ensure() only creates what is missing, so adding a filter field to the definition
 * above would otherwise be invisible on a cluster that already has the index — the
 * new filter would silently match nothing. Atlas rebuilds in place; the index stays
 * queryable on the old definition until the rebuild finishes.
 */
const update = async (collection) => {
  const results = [];
  for (const def of [vectorIndexDefinition(), searchIndexDefinition()]) {
    try {
      await collection.updateSearchIndex(def.name, def.definition);
      results.push({ name: def.name, status: 'updated' });
    } catch (err) {
      results.push({ name: def.name, status: 'failed', detail: err.message });
    }
  }
  invalidateProbe();
  return results;
};

module.exports = {
  VECTOR_INDEX,
  SEARCH_INDEX,
  vectorIndexDefinition,
  searchIndexDefinition,
  probe,
  invalidateProbe,
  ensure,
  update,
};
