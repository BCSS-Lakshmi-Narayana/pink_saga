/**
 * embedOnIngest — keeps newly ingested grievances retrievable without anyone remembering
 * to call the embedder.
 *
 * WHY A HOOK AND NOT A CALL AT EACH SITE
 * --------------------------------------
 * Grievances are created in six places (keyword fetch, three platform paths, the manual
 * controller, the temp processor). Adding an embed call to each is how fields end up
 * populated on some paths and silently missing on others — the same class of bug that
 * left socialHandles and the political verdict unwritten. One post-save hook on the
 * schema covers every path, including ones added later.
 *
 * WHY FIRE-AND-FORGET
 * -------------------
 * Embedding takes tens to hundreds of milliseconds and depends on a model that may be
 * loading, or on a remote server. Awaiting it inside save() would put ingest throughput
 * and ingest AVAILABILITY behind the embedder — a monitoring pipeline should not stop
 * collecting posts because a vector could not be computed. So the write is scheduled
 * after the save resolves, and its failures are logged, never thrown.
 *
 * The backfill script is the safety net: anything this misses is simply still pending,
 * and `node src/scripts/backfill-grievance-embeddings.js` picks it up.
 */

const embeddings = require('./embeddingService');

// Serialise. With the xenova provider the pipeline is single-threaded, so a burst of new
// posts firing concurrent embeds would thrash rather than parallelise. A promise chain
// keeps them in order at one at a time.
let chain = Promise.resolve();
let queued = 0;

// Beyond this, drop rather than accumulate. A backlog that grows without bound during a
// large fetch would hold every document's text in memory; the backfill will catch them.
const MAX_QUEUE = Number(process.env.RAG_INGEST_QUEUE_MAX || 200);

const textOf = (doc) => [doc?.content?.text, doc?.analysis?.video_transcript].filter(Boolean).join('\n');

/**
 * Schedule an embedding for a freshly saved grievance.
 * Never throws, never returns a promise the caller is expected to await.
 */
const scheduleEmbedding = (doc) => {
  try {
    if (!doc) return;
    const text = embeddings.prepare(textOf(doc));
    if (!text) return;

    // Already current — nothing to do. Cheap check before taking a queue slot.
    if (doc.embedding_model === embeddings.config.MODEL
        && doc.embedding_text_hash === embeddings.textHash(text)) return;

    if (queued >= MAX_QUEUE) return;   // backfill will pick it up
    queued += 1;

    const Model = doc.constructor;
    const id = doc._id;

    chain = chain.then(async () => {
      try {
        const [vec] = await embeddings.embedBatch([text], { label: 'ingest' });
        if (!vec) return;
        // updateOne rather than doc.save(): saving would re-fire this hook.
        await Model.updateOne({ _id: id }, {
          $set: {
            embedding: vec,
            embedding_model: embeddings.config.MODEL,
            embedding_dims: vec.length,
            embedding_text_hash: embeddings.textHash(text),
            embedded_at: new Date(),
          },
        });
      } catch (err) {
        console.warn(`[embedOnIngest] ${id}: ${err.message}`);
      } finally {
        queued -= 1;
      }
    }).catch(() => { queued = Math.max(0, queued - 1); });
  } catch (err) {
    console.warn(`[embedOnIngest] schedule failed: ${err.message}`);
  }
};

/** Attach to a schema. Called once, from the Grievance model. */
const attach = (schema) => {
  // Off by default in tests / scripts that only need the model shape.
  if (String(process.env.RAG_EMBED_ON_INGEST || 'true').toLowerCase() === 'false') return;
  schema.post('save', function embedAfterSave(doc) { scheduleEmbedding(doc); });
};

/** Drain — used by scripts that must not exit before scheduled writes land. */
const flush = () => chain;

module.exports = { attach, scheduleEmbedding, flush };
