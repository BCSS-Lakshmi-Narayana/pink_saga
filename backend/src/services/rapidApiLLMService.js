/**
 * rapidApiLLMService
 * ─────────────────────────────────────────────────────────────────
 * Single LLM gateway for the grievance / sentiment pipeline.
 * Wraps the RapidAPI "chatgpt-42" GPT-4 endpoint:
 *   POST https://chatgpt-42.p.rapidapi.com/conversationgpt4-2
 *
 * Replaces the previous local Ollama integration. Every place that
 * used to call Ollama (llmService, politicalSentimentService,
 * bskRelevanceFilterService) now funnels through here so we have
 * exactly ONE LLM call site to operate.
 */

const axios = require('axios');

const HOST = process.env.RAPIDAPI_CHATGPT_HOST
  || process.env['chatgpt-rapidapi-host']
  || 'chatgpt-42.p.rapidapi.com';

const KEY = process.env.RAPIDAPI_CHATGPT_KEY
  || process.env.rapidapi_chatgpt_key
  || process.env.RAPIDAPI_INSTAGRAM_KEYS
  || process.env.RAPIDAPI_KEY
  || '8aa52e5d94msh58ab4c62e749612p1d5537jsn4921c68519fc';

const ENDPOINT = `https://${HOST}/conversationgpt4-2`;
const DEFAULT_TIMEOUT = parseInt(process.env.RAPIDAPI_CHATGPT_TIMEOUT_MS || '45000', 10);

const JSON_SYSTEM_HINT =
  'You are a strict JSON generator. Respond with one valid JSON object only. ' +
  'No markdown, no code fences, no commentary before or after the JSON.';

/**
 * Low-level chat call.
 *
 *   prompt        — user content (string, required)
 *   systemPrompt  — optional system instruction. If `json` is true and this
 *                   is empty, a strict-JSON hint is injected.
 *   json          — when true, asks the model for JSON and the caller is
 *                   expected to parse the returned string.
 *   maxTokens     — completion budget (default 1500).
 *   temperature   — sampling temperature (default 0.1).
 *   timeoutMs     — per-request timeout.
 *
 * Returns the raw assistant text (string) or throws on transport / API error.
 */
async function chatCompletion({
  prompt,
  systemPrompt = '',
  json = false,
  maxTokens = 1500,
  temperature = 0.1,
  topK = 5,
  topP = 0.9,
  timeoutMs = DEFAULT_TIMEOUT,
} = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('rapidApiLLMService.chatCompletion: prompt is required');
  }

  const sys = systemPrompt
    || (json ? JSON_SYSTEM_HINT : '');

  const body = {
    messages: [{ role: 'user', content: prompt }],
    system_prompt: sys,
    temperature,
    top_k: topK,
    top_p: topP,
    max_tokens: maxTokens,
    web_access: false,
  };

  const res = await axios.post(ENDPOINT, body, {
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      'x-rapidapi-host': HOST,
      'x-rapidapi-key': KEY,
    },
  });

  const data = res.data;
  // The endpoint has shipped several response shapes over time; handle them all.
  const text =
       (typeof data === 'string' ? data : null)
    || data?.result
    || data?.response
    || data?.message
    || data?.data
    || data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || '';

  if (!text || typeof text !== 'string') {
    throw new Error(`rapidApiLLMService: empty / unrecognized response: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return text.trim();
}

/**
 * Tolerant JSON extractor — handles models that wrap JSON in prose or
 * markdown fences despite the system prompt.
 */
function extractJson(text) {
  if (!text) return null;
  if (typeof text === 'object') return text;
  const s = String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(s); } catch (_) { /* fall through */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

/** Convenience: chat → parsed JSON (or null). */
async function chatJson(opts) {
  const text = await chatCompletion({ ...opts, json: true });
  return extractJson(text);
}

module.exports = {
  chatCompletion,
  chatJson,
  extractJson,
};
