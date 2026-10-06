/**
 * ollamaLLMService
 * ─────────────────────────────────────────────────────────────────
 * Self-hosted LLM gateway backed by an Ollama instance running
 * `qwen2.5:7b`. Mirrors the public surface of `rapidApiLLMService`
 * (`chatCompletion`, `chatJson`, `extractJson`) so call sites can be
 * swapped 1:1 through `llmProvider`.
 *
 *   POST ${OLLAMA_URL}/api/chat
 *   body: { model, messages, stream: false, format?, options }
 */

const axios = require('axios');

/**
 * Host comes from the environment. This file used to fall back to a specific
 * remote GPU box, which every other Ollama caller here does NOT do — see
 * campaignSuggestionService, rag/embeddingService and the backfill scripts,
 * which all read OLLAMA_URL then OLLAMA_BASE_URL then localhost. With both
 * vars unset that split the deployment: this path talked to a remote machine
 * while the rest talked to localhost, and nothing said so. Same order as the
 * rest of the codebase now.
 */
const OLLAMA_URL = (
  process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
).replace(/\/+$/, '');
if (!process.env.OLLAMA_URL && !process.env.OLLAMA_BASE_URL) {
  console.warn('[ollama] OLLAMA_URL is not set; defaulting to', OLLAMA_URL);
}
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const DEFAULT_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT_MS || '45000', 10);

/**
 * One Ollama host serves every pipeline stage (relevance gate, Pass A, Stage 3,
 * campaigns, live chat). Fired together, requests queue on the GPU and each
 * one's HTTP timeout keeps running while it waits, so under load most calls
 * timed out, fell back to the (unconfigured) RapidAPI provider and the gate
 * published a keyword-heuristic verdict instead of an analysis.
 *
 * So requests are queued HERE: at most OLLAMA_CONCURRENCY run at once, and a
 * call's timeout starts only when it is actually sent.
 */
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.OLLAMA_CONCURRENCY || '2', 10));
let running = 0;
const waiting = [];
const acquire = () => new Promise((resolve) => {
  if (running < MAX_CONCURRENT) { running += 1; resolve(); return; }
  waiting.push(resolve);
});
const release = () => {
  const next = waiting.shift();
  if (next) next(); else running -= 1;
};

const JSON_SYSTEM_HINT =
  'You are a strict JSON generator. Respond with one valid JSON object only. ' +
  'No markdown, no code fences, no commentary before or after the JSON.';

async function chatCompletion({
  prompt,
  systemPrompt = '',
  json = false,
  maxTokens = 1500,
  temperature = 0.1,
  topK = 5,
  topP = 0.9,
  /**
   * Accept BOTH spellings.
   *
   * Callers were split: this function declared `timeoutMs`, while
   * politicalSentimentService (and anything copying it) passes `timeout`. The
   * mismatch was silent — the named argument simply never bound, so every one
   * of those calls ran on the 45s default and `POLITICAL_SENTIMENT_TIMEOUT_MS`
   * had no effect at all.
   *
   * That matters on a shared/queued Ollama host, where a Stage 3 prompt can sit
   * in the queue longer than 45s: the request aborted, fell through to the
   * rate-limited RapidAPI fallback, and the pipeline published a HEURISTIC
   * verdict while looking like it had run normally.
   */
  timeoutMs,
  timeout,
} = {}) {
  const effectiveTimeout = Number(timeoutMs || timeout || DEFAULT_TIMEOUT);
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('ollamaLLMService.chatCompletion: prompt is required');
  }

  const sys = systemPrompt || (json ? JSON_SYSTEM_HINT : '');

  const messages = [];
  if (sys) messages.push({ role: 'system', content: sys });
  messages.push({ role: 'user', content: prompt });

  const body = {
    model: MODEL,
    messages,
    stream: false,
    options: {
      temperature,
      top_k: topK,
      top_p: topP,
      num_predict: maxTokens,
    },
  };
  if (json) body.format = 'json';

  await acquire();
  let res;
  try {
    res = await axios.post(`${OLLAMA_URL}/api/chat`, body, {
      timeout: effectiveTimeout,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    release();
  }

  const data = res.data;
  const text =
       data?.message?.content
    || data?.response
    || (typeof data === 'string' ? data : '')
    || '';

  if (!text || typeof text !== 'string') {
    throw new Error(`ollamaLLMService: empty / unrecognized response: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return text.trim();
}

function extractJson(text) {
  if (!text) return null;
  if (typeof text === 'object') return text;
  const s = String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(s); } catch (_) { /* fall through */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

async function chatJson(opts) {
  const text = await chatCompletion({ ...opts, json: true });
  return extractJson(text);
}

async function ping(timeoutMs = 5000) {
  const t0 = Date.now();
  const res = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: timeoutMs });
  const models = (res.data?.models || []).map((m) => m.name || m.model);
  return {
    ok: true,
    url: OLLAMA_URL,
    expected_model: MODEL,
    model_available: models.includes(MODEL),
    models,
    latency_ms: Date.now() - t0,
  };
}

/**
 * Keep-warm scheduler — this GPU host is shared with several other
 * applications under OLLAMA_MAX_LOADED_MODELS=2 (confirmed on the box: a 15GB
 * T4 with several other 6-7GB models). OLLAMA_KEEP_ALIVE is already 24h
 * server-side, so our model is NOT evicted by idling — it is evicted by the
 * LRU slot-cap when a third distinct model is requested by one of those other
 * apps. Whichever model was used longest ago loses its slot.
 *
 * A periodic no-op "touch" — Ollama's documented preload call: /api/generate
 * with a model and no prompt loads or refreshes it without running inference —
 * keeps ours most-recently-used, so someone else's model is evicted instead.
 * Measured on this host: ~20-45s cold load versus ~1.3s warm.
 */
const KEEPALIVE_ENABLED = String(process.env.OLLAMA_KEEPALIVE_ENABLED ?? 'true').toLowerCase() !== 'false';
const KEEPALIVE_MINUTES = Math.max(1, parseInt(process.env.OLLAMA_KEEPALIVE_MINUTES || '3', 10));

async function touch() {
  try {
    await axios.post(`${OLLAMA_URL}/api/generate`, { model: MODEL, keep_alive: '24h' }, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.warn('[ollama] keep-warm touch failed:', err.message);
  }
}

if (KEEPALIVE_ENABLED) {
  const timer = setInterval(touch, KEEPALIVE_MINUTES * 60 * 1000);
  timer.unref?.();
  touch();
}

module.exports = {
  chatCompletion,
  chatJson,
  extractJson,
  ping,
  _config: { OLLAMA_URL, MODEL, DEFAULT_TIMEOUT, KEEPALIVE_ENABLED, KEEPALIVE_MINUTES },
};
