/**
 * embeddingConfig — the SINGLE source of truth for which embedding model this app uses.
 *
 * WHY THE MODEL CHOICE IS NOT ARBITRARY
 * -------------------------------------
 * The measurements below were taken on the earlier Andhra Pradesh (Telugu) corpus.
 * bge-m3 covers Telugu well, but re-run the same related /
 * unrelated / cross-lingual probes on real Telangana posts before trusting the margins.
 *
 * That corpus was majority Telugu (measured: 269 of 501 grievances Telugu script, 26
 * romanized, 23 mixed — roughly 63% non-English). Most embedding models sold as
 * "general purpose" are English-primary, and they do not merely degrade on Telugu, they
 * collapse:
 *
 *   nomic-embed-text  cos("water problem in Pulivendula", "pension not paid 3 months")
 *                     = 1.0000, BIT-IDENTICAL vectors.
 *
 * It cannot tokenize the script, so every Telugu document embeds to the same point and
 * dense retrieval returns arbitrary results. paraphrase-multilingual-MiniLM was better
 * but still compressed Telugu into a 0.70-0.80 band — 0.009 of separation between a
 * related and an unrelated pair, which is noise.
 *
 * bge-m3 was measured on the same probes:
 *   related Telugu pair        0.738
 *   unrelated Telugu pair      0.579
 *   Telugu <-> English pension 0.901   <- cross-lingual actually works
 *
 * That last number is the one that matters here: an English query retrieves Telugu
 * posts, so the campaign engine does not need a translation pass before it can search.
 *
 * RULE: never swap the model without re-embedding the corpus. Vectors from two models
 * share a coordinate space only by coincidence; mixing them silently ruins recall. Every
 * document stores the model that produced it and the query path refuses the mismatches.
 *
 * Env:
 *   EMBEDDING_PROVIDER  xenova (default, local CPU) | ollama (needs `ollama pull bge-m3`)
 *   EMBEDDING_MODEL     provider-specific id; defaults below
 *   EMBEDDING_DIMS      must match the model; guarded at runtime
 */

const PROVIDER = String(process.env.EMBEDDING_PROVIDER || 'xenova').trim().toLowerCase();

// Same weights either way — Xenova serves the ONNX export of the very model Ollama
// pulls, so switching provider does not invalidate vectors already written.
const DEFAULT_MODEL = PROVIDER === 'ollama' ? 'bge-m3' : 'Xenova/bge-m3';
const MODEL = String(process.env.EMBEDDING_MODEL || DEFAULT_MODEL).trim();

const DIMS = Number(process.env.EMBEDDING_DIMS || 1024);

// Atlas Vector Search caps at 4096 dimensions; bge-m3 emits 1024.
if (!Number.isInteger(DIMS) || DIMS < 8 || DIMS > 4096) {
  throw new Error(`[embeddingConfig] EMBEDDING_DIMS=${process.env.EMBEDDING_DIMS} is not a usable dimension`);
}

// Cosine, because the vectors are L2-normalised at write time. Kept here so the Atlas
// index definition and the in-memory fallback cannot disagree about the metric.
const SIMILARITY = 'cosine';

// bge-m3 handles 8192 tokens, but grievance text is short and the tail of a long
// scraped page is rarely what makes a post relevant. Truncating keeps embedding time
// predictable during a backfill.
const MAX_CHARS = Number(process.env.EMBEDDING_MAX_CHARS || 2000);

module.exports = { PROVIDER, MODEL, DIMS, SIMILARITY, MAX_CHARS };
