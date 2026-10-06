/**
 * embeddingService — turns text into vectors, for both indexing and querying.
 *
 * Two providers behind one interface:
 *   xenova  (default) runs bge-m3 on this process's CPU. No infrastructure to change,
 *           but it is single-threaded and holds ~600MB resident once loaded.
 *   ollama  posts to the shared Ollama server. Faster and off this box, but the model
 *           must be pulled there first (`ollama pull bge-m3`) and it competes for the
 *           same GPU slots as analysis, so it runs in the 'bulk' lane.
 *
 * Both paths return L2-normalised vectors of EMBEDDING_DIMS, or throw. A caller never
 * receives a short, unnormalised, or wrong-model vector — those are the failures that
 * would otherwise be discovered months later as "search quality got worse".
 */

const crypto = require('crypto');
const axios = require('axios');
const cfg = require('./embeddingConfig');

// ── text preparation ─────────────────────────────────────────────────────────

/**
 * The text actually embedded. Collapsing whitespace matters more than it looks: scraped
 * posts carry runs of newlines that survive tokenisation and push real content past the
 * truncation limit.
 */
const prepare = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, cfg.MAX_CHARS);

/** Stable hash of the prepared text, so a re-run can tell "unchanged" from "new". */
const textHash = (text) => crypto.createHash('sha1').update(prepare(text)).digest('hex');

// ── vector hygiene ───────────────────────────────────────────────────────────

const l2norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

/**
 * Reject anything that would poison the index, then normalise.
 *
 * A NaN slips through arithmetic silently and makes every cosine involving that document
 * NaN, which sorts unpredictably rather than erroring — so it is checked here, once, at
 * the only place vectors are created.
 */
const finalize = (vec, label) => {
  if (!Array.isArray(vec) || !vec.length) throw new Error(`[embedding] ${label}: provider returned no vector`);
  if (vec.length !== cfg.DIMS) {
    throw new Error(`[embedding] ${label}: got ${vec.length} dims, config says ${cfg.DIMS} — model and EMBEDDING_DIMS disagree`);
  }
  if (!vec.every((x) => Number.isFinite(x))) throw new Error(`[embedding] ${label}: vector contains NaN/Infinity`);
  const n = l2norm(vec);
  if (n === 0) throw new Error(`[embedding] ${label}: zero vector`);
  return vec.map((x) => x / n);
};

// ── providers ────────────────────────────────────────────────────────────────

let xenovaPipe = null;
let xenovaLoading = null;

/**
 * Load the ONNX pipeline once. Guarded by a promise rather than a boolean because a
 * backfill fires many concurrent calls the instant it starts, and each would otherwise
 * begin its own multi-hundred-megabyte load.
 */
const getXenova = async () => {
  if (xenovaPipe) return xenovaPipe;
  if (!xenovaLoading) {
    xenovaLoading = (async () => {
      /**
       * This deployment pins @xenova/transformers to v1.x, because two older
       * services (sentimentService, aiAnalysisService) are written against that
       * API. The v1 runtime cannot load the bge-m3 ONNX export, and the
       * `{ pooling, normalize }` option shape below is v2-only — so on v1 this
       * path fails deep inside the library with an opaque error.
       *
       * EMBEDDING_PROVIDER is 'ollama' here, so this never runs in normal
       * operation. The guard exists so that flipping the provider fails with a
       * sentence explaining what to do rather than a stack trace.
       */
      const installed = (() => {
        try { return require('@xenova/transformers/package.json').version || ''; } catch (e) { return ''; }
      })();
      if (installed && Number(installed.split('.')[0]) < 2) {
        throw new Error(
          `[embedding] EMBEDDING_PROVIDER=xenova needs @xenova/transformers >= 2, but ${installed} is installed. `
          + 'Either keep EMBEDDING_PROVIDER=ollama (the configured default), or upgrade the package AND '
          + 're-verify services/sentimentService.js and services/aiAnalysisService.js against the v2 API.',
        );
      }
      const { pipeline } = require('@xenova/transformers');
      console.log(`[embedding] loading ${cfg.MODEL} (first run downloads the weights)…`);
      xenovaPipe = await pipeline('feature-extraction', cfg.MODEL);
      console.log(`[embedding] ${cfg.MODEL} ready (${cfg.DIMS}d)`);
      return xenovaPipe;
    })().catch((err) => {
      xenovaLoading = null;       // let a later call retry instead of caching the failure
      throw err;
    });
  }
  return xenovaLoading;
};

const embedXenova = async (texts) => {
  const pipe = await getXenova();
  const out = [];
  // Sequential on purpose: the ONNX runtime is single-threaded here, so concurrency adds
  // scheduling overhead without throughput, and a batch would hold more tensors at once.
  for (const t of texts) {
    const res = await pipe(t, { pooling: 'mean', normalize: true });
    out.push(Array.from(res.data));
  }
  return out;
};

/**
 * Optional provider, only reached when EMBEDDING_PROVIDER=ollama. The default path is
 * local @xenova/transformers, which needs no server at all.
 *
 * Serial rather than concurrent: there is no shared Ollama queue in this deployment (the
 * multi-tenant original had one so a backfill could not delay a live request), so this
 * keeps one request in flight at a time rather than firing thousands at the GPU.
 */
const embedOllama = async (texts) => {
  const BASE_URL = (process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
  const timeout = parseInt(process.env.OLLAMA_TIMEOUT_MS || '120000', 10);
  const out = [];
  for (const t of texts) {
    const res = await axios.post(`${BASE_URL}/api/embeddings`, { model: cfg.MODEL, prompt: t }, { timeout });
    out.push(res.data?.embedding);
  }
  return out;
};

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Embed a batch. Returns vectors positionally aligned with `texts`; entries whose text
 * is empty come back as null rather than shifting the array, because callers zip the
 * result against their documents.
 */
const embedBatch = async (texts, { label = 'batch' } = {}) => {
  const prepared = (Array.isArray(texts) ? texts : [texts]).map(prepare);
  const usable = prepared.map((t, i) => ({ t, i })).filter((x) => x.t.length > 0);
  if (!usable.length) return prepared.map(() => null);

  const raw = cfg.PROVIDER === 'ollama'
    ? await embedOllama(usable.map((x) => x.t))
    : await embedXenova(usable.map((x) => x.t));

  const result = prepared.map(() => null);
  usable.forEach((x, n) => { result[x.i] = finalize(raw[n], `${label}[${x.i}]`); });
  return result;
};

/** Embed one string. Throws if it is empty — a query with no text is a caller bug. */
const embedOne = async (text, opts = {}) => {
  const [v] = await embedBatch([text], opts);
  if (!v) throw new Error('[embedding] cannot embed empty text');
  return v;
};

/** Cosine similarity. Inputs are normalised, so this is just the dot product. */
const cosine = (a, b) => {
  if (!a || !b || a.length !== b.length) return 0;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
};

module.exports = { embedBatch, embedOne, cosine, prepare, textHash, config: cfg };
