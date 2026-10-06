/**
 * hybridRetrievalService — the retrieval half of the campaign engine's RAG.
 *
 * WHAT "HYBRID" BUYS HERE
 * ----------------------
 * Two rankings over the same filtered candidate set, fused:
 *
 *   dense   (embeddings)  finds posts that MEAN the same thing in different words, and
 *                         across languages — an English query retrieves Telugu posts,
 *                         measured at 0.90 cosine on a translated pair.
 *   lexical (BM25)        finds posts containing the EXACT token — party names, scheme
 *                         names, handles, "వైసీపీ". Dense retrieval is worst at exactly
 *                         these, because a rare proper noun barely moves a sentence
 *                         vector.
 *
 * Neither alone is adequate for this corpus. Fusion is Reciprocal Rank Fusion: score a
 * document by 1/(K + rank) in each list and add. RRF uses only RANK, never the raw
 * scores, which is the point — cosine similarity and BM25 are on incomparable scales, so
 * any weighted sum of the two would need a tuning constant that silently rots as the
 * corpus changes. RRF has no such constant.
 *
 * NO LLM RUNS IN THIS PATH. Retrieval is embeddings + text search + arithmetic; the
 * model is only invoked afterwards, on the handful of posts this returns.
 *
 * DEGRADED MODES
 * --------------
 * Atlas Search may be absent (tier, or indexes never created, or still building). Rather
 * than fail, each half falls back:
 *   dense   -> load the candidate window's vectors and cosine them in this process
 *   lexical -> MongoDB $text, and if even that is missing, a tokenised regex score
 * The fallbacks are bounded by CANDIDATE_CAP and are genuinely slower, so the result
 * reports which path ran. A caller that silently degraded would be worse than one that
 * says so.
 */

const atlasIndexes = require('./atlasIndexes');
const { VECTOR_INDEX, SEARCH_INDEX } = atlasIndexes;
const embeddings = require('./embeddingService');

/**
 * Force the in-process path even where Atlas Search exists.
 *
 * Real use: an index that has gone stale, is rebuilding, or is returning obviously wrong
 * results can be taken out of the loop with an env change instead of a deploy. Also the
 * only way to exercise the fallback deliberately — the capability probe is otherwise
 * truthful, so the degraded path would never run on a healthy cluster and would rot.
 */
const forceFallback = () => String(process.env.RAG_FORCE_FALLBACK || '').toLowerCase() === 'true';

// Called through the module object, not a destructured copy, so the probe stays
// swappable and the env override above is read on every call rather than at load.
const capabilities = async (collection) => {
  if (forceFallback()) return { vector: false, lexical: false, reason: 'RAG_FORCE_FALLBACK=true' };
  return atlasIndexes.probe(collection);
};

// RRF's smoothing constant. 60 is the value from the original paper and the one Atlas
// itself uses for $rankFusion; it flattens the difference between ranks 1 and 2 so a
// single list cannot dominate the fusion.
const RRF_K = 60;

// How many documents the in-process fallbacks may load. This is the ceiling on the
// "no Atlas Search" path — beyond it, retrieval quality is bounded by recency rather
// than relevance, which is a real limitation and why the indexes are worth creating.
const CANDIDATE_CAP = Number(process.env.RAG_CANDIDATE_CAP || 1500);

/**
 * Mongo filter shared by every path.
 *
 * This deployment monitors ONE organisation, so there is no tenant partition to enforce
 * here — unlike the multi-tenant saga this was ported from, where a missing tenant id
 * had to fail closed rather than run an unscoped query. Every other guard (window,
 * stance, topic, platform, is_active) is unchanged.
 */
const buildFilter = ({ since, until, stances, topics, grievanceTypes, platforms, activeOnly = true }) => {
  const f = {};
  if (activeOnly) f.is_active = { $ne: false };
  f['analysis.needs_review'] = { $ne: true };
  if (since || until) {
    f.post_date = {};
    if (since) f.post_date.$gte = since;
    if (until) f.post_date.$lte = until;
  }
  if (stances?.length) f['analysis.political_stance'] = { $in: stances };
  // Hard topic scope. Stage A decides WHICH issue gets a campaign; without this the
  // "retrieve inside that topic" step is only semantic — the query string is the topic
  // NAME, so a post about a different issue that happens to be worded similarly can
  // still surface and end up cited as evidence for a campaign it has nothing to do with.
  if (topics?.length) f['analysis.topic'] = { $in: topics };
  if (grievanceTypes?.length) f['analysis.grievance_type'] = { $in: grievanceTypes };
  if (platforms?.length) f.platform = { $in: platforms };
  return f;
};

/** The same filter expressed for $vectorSearch, which takes a restricted subset of Mongo query syntax. */
const buildVectorFilter = (f) => {
  const out = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === 'is_active') { out.is_active = { $ne: false }; continue; }
    out[k] = v;
  }
  return out;
};

// ── dense ────────────────────────────────────────────────────────────────────

const denseAtlas = async (collection, queryVector, filter, limit) => {
  const docs = await collection.aggregate([
    {
      $vectorSearch: {
        index: VECTOR_INDEX,
        path: 'embedding',
        queryVector,
        // Over-fetch before filtering: Atlas explores numCandidates neighbours and then
        // applies the filter, so a narrow filter needs a wide exploration to come back
        // with `limit` results at all.
        numCandidates: Math.min(Math.max(limit * 20, 150), 10_000),
        limit,
        filter: buildVectorFilter(filter),
      },
    },
    { $addFields: { _score: { $meta: 'vectorSearchScore' } } },
    { $project: { embedding: 0 } },
  ]).toArray();
  return docs;
};

/**
 * Fallback: score in this process.
 *
 * Only documents carrying a vector from the CURRENT model are considered — a vector
 * written by a previous model is not in the same space, and including it would return
 * confidently wrong neighbours.
 */
const denseFallback = async (collection, queryVector, filter, limit) => {
  const cursor = collection.find(
    { ...filter, embedding: { $exists: true, $ne: null }, embedding_model: embeddings.config.MODEL },
    { projection: { embedding: 1, id: 1 }, sort: { post_date: -1 }, limit: CANDIDATE_CAP },
  );
  const scored = [];
  for await (const d of cursor) {
    scored.push({ _id: d._id, _score: embeddings.cosine(queryVector, d.embedding) });
  }
  scored.sort((a, b) => b._score - a._score);
  const top = scored.slice(0, limit);
  if (!top.length) return [];

  const byId = new Map(top.map((t) => [String(t._id), t._score]));
  const docs = await collection.find({ _id: { $in: top.map((t) => t._id) } }, { projection: { embedding: 0 } }).toArray();
  return docs
    .map((d) => ({ ...d, _score: byId.get(String(d._id)) || 0 }))
    .sort((a, b) => b._score - a._score);
};

// ── lexical ──────────────────────────────────────────────────────────────────

const lexicalAtlas = async (collection, queryText, filter, limit) => {
  const must = [{ text: { query: queryText, path: ['content.text', 'analysis.grievance_type', 'analysis.category'] } }];
  const filters = [];
  if (filter.post_date?.$gte || filter.post_date?.$lte) {
    filters.push({
      range: {
        path: 'post_date',
        ...(filter.post_date.$gte ? { gte: filter.post_date.$gte } : {}),
        ...(filter.post_date.$lte ? { lte: filter.post_date.$lte } : {}),
      },
    });
  }
  const docs = await collection.aggregate([
    { $search: { index: SEARCH_INDEX, compound: { must, filter: filters } } },
    { $addFields: { _score: { $meta: 'searchScore' } } },
    { $limit: limit },
    // Stance/type are filtered here rather than in $search so one definition of the
    // filter stays authoritative even for fields not in the search mapping.
    { $match: filter },
    { $project: { embedding: 0 } },
  ]).toArray();
  return docs;
};

/** Tokens worth matching on. Short tokens and pure punctuation add noise, not recall. */
const queryTokens = (q) => [...new Set(
  String(q || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3),
)].slice(0, 12);

/**
 * Fallback: MongoDB $text first, then a token-overlap score.
 *
 * $text does not analyse Telugu, so the regex path is not merely a backstop for a
 * missing index — it is what makes non-Latin tokens matchable at all when Atlas Search
 * is unavailable.
 */
const lexicalFallback = async (collection, queryText, filter, limit) => {
  try {
    const docs = await collection.aggregate([
      { $match: { ...filter, $text: { $search: queryText } } },
      { $addFields: { _score: { $meta: 'textScore' } } },
      { $sort: { _score: -1 } },
      { $limit: limit },
      { $project: { embedding: 0 } },
    ]).toArray();
    if (docs.length) return docs;
  } catch {
    // no text index on this collection — fall through
  }

  const tokens = queryTokens(queryText);
  if (!tokens.length) return [];
  const rx = tokens.map((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  const cursor = collection.find(filter, {
    projection: { embedding: 0 },
    sort: { post_date: -1 },
    limit: CANDIDATE_CAP,
  });
  const scored = [];
  for await (const d of cursor) {
    const hay = `${d.content?.text || ''} ${d.analysis?.grievance_type || ''} ${d.analysis?.category || ''}`;
    const hits = rx.reduce((n, r) => n + (r.test(hay) ? 1 : 0), 0);
    if (hits) scored.push({ ...d, _score: hits / tokens.length });
  }
  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, limit);
};

// ── fusion ───────────────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion over any number of ranked lists.
 *
 * Deliberately rank-only: a document at rank 1 in one list and absent from the other
 * still scores well, which is what lets each retriever contribute what it is good at
 * without either being calibrated against the other.
 */
const rrf = (lists, { k = RRF_K } = {}) => {
  const acc = new Map();
  lists.forEach(({ docs, tag }) => {
    docs.forEach((doc, i) => {
      const key = String(doc._id);
      const cur = acc.get(key) || { doc, score: 0, ranks: {} };
      cur.score += 1 / (k + i + 1);
      cur.ranks[tag] = i + 1;
      // Prefer whichever copy carries more fields (the Atlas paths project identically,
      // but the dense fallback's re-fetch can arrive first with a lean projection).
      if (Object.keys(doc).length > Object.keys(cur.doc).length) cur.doc = doc;
      acc.set(key, cur);
    });
  });
  return [...acc.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ doc, score, ranks }) => ({ ...doc, _rrf: score, _ranks: ranks }));
};

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve the posts most relevant to `query` within the filtered slice.
 *
 * Returns { docs, mode, counts } — `mode` names the path each half took so the caller
 * can report honestly rather than implying Atlas-quality results from a fallback.
 */
const retrieve = async (Model, {
  query, k = 12,
  since, until, stances, topics, grievanceTypes, platforms, activeOnly = true,
  perListLimit,
} = {}) => {
  const filter = buildFilter({ since, until, stances, topics, grievanceTypes, platforms, activeOnly });
  const collection = Model.collection;
  const text = embeddings.prepare(query);
  const limit = perListLimit || Math.max(k * 4, 40);

  if (!text) return { docs: [], mode: { dense: 'skipped', lexical: 'skipped' }, counts: { dense: 0, lexical: 0, fused: 0 }, reason: 'empty query' };

  const caps = await capabilities(collection);
  const mode = { dense: 'none', lexical: 'none' };

  // Both halves run concurrently — they hit different indexes and neither needs the
  // other's output, so serialising them would just add latency.
  const [denseDocs, lexDocs] = await Promise.all([
    (async () => {
      let vec;
      try {
        vec = await embeddings.embedOne(text, { label: 'query' });
      } catch (err) {
        // No embedding provider (model not pulled, server down). Lexical alone is a
        // usable degraded mode; failing the whole retrieval would not be.
        mode.dense = `unavailable: ${err.message}`;
        return [];
      }
      if (caps.vector) {
        try {
          const d = await denseAtlas(collection, vec, filter, limit);
          mode.dense = 'atlas';
          return d;
        } catch (err) {
          mode.dense = `atlas failed → fallback (${err.message})`;
        }
      } else {
        mode.dense = 'fallback';
      }
      const d = await denseFallback(collection, vec, filter, limit);
      if (mode.dense === 'fallback') mode.dense = caps.reason ? `fallback (${caps.reason})` : 'fallback';
      return d;
    })(),
    (async () => {
      if (caps.lexical) {
        try {
          const d = await lexicalAtlas(collection, text, filter, limit);
          mode.lexical = 'atlas';
          return d;
        } catch (err) {
          mode.lexical = `atlas failed → fallback (${err.message})`;
        }
      } else {
        mode.lexical = 'fallback';
      }
      return lexicalFallback(collection, text, filter, limit);
    })(),
  ]);

  const fused = rrf([
    { docs: denseDocs, tag: 'dense' },
    { docs: lexDocs, tag: 'lexical' },
  ]).slice(0, k);

  return {
    docs: fused,
    mode,
    counts: { dense: denseDocs.length, lexical: lexDocs.length, fused: fused.length },
  };
};

module.exports = { retrieve, rrf, buildFilter, queryTokens, RRF_K, CANDIDATE_CAP };
