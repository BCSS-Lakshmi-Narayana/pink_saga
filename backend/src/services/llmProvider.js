/**
 * llmProvider
 * ─────────────────────────────────────────────────────────────────
 * Single entry point used by every downstream LLM consumer
 * (llmService, politicalSentimentService, bskRelevanceFilterService,
 * locationClassifierService).
 *
 * Strategy is controlled by `GlobalProfileSettings.flags.llm_provider`:
 *   'ollama'   — Ollama only; error if it fails
 *   'rapidapi' — RapidAPI only; error if it fails
 *   'auto'     — try Ollama first; on failure fall back to RapidAPI
 *
 * If the settings document is missing or the flag is unset, defaults
 * to 'auto'. The flag is cached for FLAG_CACHE_MS so we don't hit
 * Mongo on every classification call.
 */

const { AsyncLocalStorage } = require('async_hooks');
const ollama = require('./ollamaLLMService');
const rapidapi = require('./rapidApiLLMService');

let GlobalProfileSettings = null;
try { GlobalProfileSettings = require('../models/GlobalProfileSettings'); } catch (_) { /* optional during tests */ }

const FLAG_CACHE_MS = parseInt(process.env.LLM_PROVIDER_FLAG_CACHE_MS || '30000', 10);
let cachedProvider = null;
let cachedAt = 0;

/**
 * Per-call-tree provider pin, scoped via AsyncLocalStorage rather than a
 * global/DB flag. Lets one caller (e.g. YouTube Live) guarantee a single
 * provider — and therefore guarantee RapidAPI is never reached — for
 * everything that happens inside its own call, without touching the shared
 * GlobalProfileSettings flag that every other caller (Grievances, RSS, etc.)
 * still reads normally. Nothing outside a withForcedProvider() scope is
 * affected: resolveProvider() falls through to the existing DB-flag lookup.
 */
const providerOverrideStorage = new AsyncLocalStorage();

function withForcedProvider(provider, fn) {
  return providerOverrideStorage.run(provider, fn);
}

async function getProvider() {
  if (cachedProvider && Date.now() - cachedAt < FLAG_CACHE_MS) return cachedProvider;
  let value = 'auto';
  try {
    if (GlobalProfileSettings) {
      const doc = await GlobalProfileSettings.findOne({ id: 'global' }).lean();
      const raw = doc?.flags?.llm_provider;
      if (raw === 'ollama' || raw === 'rapidapi' || raw === 'auto') value = raw;
    }
  } catch (err) {
    console.warn('[llmProvider] failed to read GlobalProfileSettings.flags.llm_provider:', err.message);
  }
  cachedProvider = value;
  cachedAt = Date.now();
  return value;
}

async function resolveProvider() {
  const forced = providerOverrideStorage.getStore();
  if (forced) return forced;
  return getProvider();
}

function invalidateProviderCache() {
  cachedProvider = null;
  cachedAt = 0;
}

async function chatCompletion(opts) {
  const provider = await resolveProvider();
  if (provider === 'ollama') return ollama.chatCompletion(opts);
  if (provider === 'rapidapi') return rapidapi.chatCompletion(opts);
  try {
    return await ollama.chatCompletion(opts);
  } catch (err) {
    console.warn('[llmProvider] ollama failed, falling back to rapidapi:', err.message);
    return rapidapi.chatCompletion(opts);
  }
}

async function chatJson(opts) {
  const provider = await resolveProvider();
  if (provider === 'ollama') return ollama.chatJson(opts);
  if (provider === 'rapidapi') return rapidapi.chatJson(opts);
  try {
    return await ollama.chatJson(opts);
  } catch (err) {
    console.warn('[llmProvider] ollama failed, falling back to rapidapi:', err.message);
    return rapidapi.chatJson(opts);
  }
}

module.exports = {
  chatCompletion,
  chatJson,
  extractJson: ollama.extractJson,
  getProvider,
  invalidateProviderCache,
  withForcedProvider,
};
