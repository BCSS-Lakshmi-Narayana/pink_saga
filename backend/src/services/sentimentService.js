const fs = require('fs');
const path = require('path');

// Ensure the model cache is persisted on disk (important on servers / PM2 restarts).
// Xenova/transformers respects TRANSFORMERS_CACHE.
const defaultCacheDir = path.join(process.cwd(), 'downloads', 'transformers_cache');
if (!process.env.TRANSFORMERS_CACHE) {
  process.env.TRANSFORMERS_CACHE = defaultCacheDir;
}
try {
  fs.mkdirSync(process.env.TRANSFORMERS_CACHE, { recursive: true });
} catch (_) {
  // If we can't create a cache dir, the library may still work using its defaults.
}

const { pipeline } = require('@xenova/transformers');

// Lightweight multilingual sentiment model (positive/neutral/negative)
const SENTIMENT_MODEL = 'Xenova/distilbert-base-multilingual-cased-sentiments-student';

let sentimentModel = null;
let sentimentModelPromise = null;

function normalizeLabel(label) {
  const v = String(label || '').trim().toLowerCase();
  if (!v) return 'neutral';

  // Some models output directly.
  if (v === 'negative' || v === 'neutral' || v === 'positive') return v;

  // Xenova sentiment student model often returns: "1 star".."5 stars".
  // Map 1-2 => negative, 3 => neutral, 4-5 => positive.
  const m = v.match(/([1-5])\s*star/);
  if (m) {
    const stars = Number(m[1]);
    if (stars <= 2) return 'negative';
    if (stars === 3) return 'neutral';
    return 'positive';
  }

  // Fallback: if we don't recognize the label, keep neutral.
  return 'neutral';
}

async function getModel() {
  if (sentimentModel) return sentimentModel;
  if (!sentimentModelPromise) {
    sentimentModelPromise = pipeline('text-classification', SENTIMENT_MODEL)
      .then((m) => {
        sentimentModel = m;
        return sentimentModel;
      })
      .finally(() => {
        // Keep the resolved model in sentimentModel; clear promise to avoid leaks.
        sentimentModelPromise = null;
      });
  }
  return sentimentModelPromise;
}

async function analyzeSentiment(text) {
  if (!text || !text.toString().trim()) {
    return { label: 'neutral', score: 0 };
  }

  const model = await getModel();
  const out = await model(text.toString());
  const top = Array.isArray(out) ? out[0] : null;

  if (!top || !top.label) {
    return { label: 'neutral', score: 0 };
  }

  const normalized = normalizeLabel(top.label);
  return {
    label: normalized,
    score: typeof top.score === 'number' ? top.score : 0,
    raw_label: String(top.label),
    raw_score: typeof top.score === 'number' ? top.score : 0
  };
}

module.exports = {
  analyzeSentiment
};
