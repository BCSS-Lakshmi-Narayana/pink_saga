const toxicity = require('@tensorflow-models/toxicity');
const tf = require('@tensorflow/tfjs');
const { pipeline } = require('@xenova/transformers');

// Configuration
// User requirement: escalate when toxicity probability >= 50%.
const TOXICITY_THRESHOLD = Number(process.env.TOXICITY_THRESHOLD || 0.5);
const SENTIMENT_MODEL = 'Xenova/distilbert-base-multilingual-cased-sentiments-student';

// Lower threshold for Non-English negative sentiment to trigger a warning
const MULTILINGUAL_NEGATIVE_THRESHOLD = 0.4;

let toxicityModel = null;
let sentimentModel = null;

let toxicityModelPromise = null;
let sentimentModelPromise = null;
const isEnglishLike = (text) => {
    // Matches if the string contains mostly Common Latin characters
    const nonLatin = /[^\u0000-\u007F\u00A0-\u00FF\u2000-\u206F]/;
    return !nonLatin.test(text);
};

const normalizeSentimentLabel = (label) => {
    const v = String(label || '').trim().toLowerCase();
    if (!v) return 'neutral';
    if (v === 'negative' || v === 'neutral' || v === 'positive') return v;
    const m = v.match(/([1-5])\s*star/);
    if (m) {
        const stars = Number(m[1]);
        if (stars <= 2) return 'negative';
        if (stars === 3) return 'neutral';
        return 'positive';
    }
    return 'neutral';
};

const loadToxicityModel = async () => {
    if (toxicityModel) return toxicityModel;
    if (!toxicityModelPromise) {
        console.log('⏳ Loading TensorFlow Toxicity Model...');
        toxicityModelPromise = toxicity.load(TOXICITY_THRESHOLD)
            .then((m) => {
                toxicityModel = m;
                console.log('✅ Toxicity Model Loaded');
                return toxicityModel;
            })
            .finally(() => {
                toxicityModelPromise = null;
            });
    }
    return toxicityModelPromise;
};

const loadSentimentModel = async () => {
    if (sentimentModel) return sentimentModel;
    if (!sentimentModelPromise) {
        console.log('⏳ Loading Xenova Multilingual Sentiment Model...');
        sentimentModelPromise = pipeline('text-classification', SENTIMENT_MODEL)
            .then((m) => {
                sentimentModel = m;
                console.log('✅ Sentiment Model Loaded');
                return sentimentModel;
            })
            .finally(() => {
                sentimentModelPromise = null;
            });
    }
    return sentimentModelPromise;
};

const loadModels = async () => {
    await Promise.all([loadToxicityModel(), loadSentimentModel()]);
};

// Toxicity-only analysis used by risk escalation rules.
// Returns max probability across labels and the labels over the threshold.
const analyzeToxicity = async (text) => {
    if (!text || text.trim().length === 0) {
        return { score: 0, hits: [] };
    }

    const model = await loadToxicityModel();
    const preds = await model.classify([text]);

    let maxProb = 0;
    const hits = [];
    for (const p of preds || []) {
        const prob = p?.results?.[0]?.probabilities?.[1];
        if (typeof prob === 'number') {
            maxProb = Math.max(maxProb, prob);
            if (prob >= TOXICITY_THRESHOLD) {
                hits.push({ label: p.label, probability: prob });
            }
        }
    }

    hits.sort((a, b) => b.probability - a.probability);

    // Multilingual fallback: TF toxicity is English-optimized.
    // If the text is non-English-like and we didn't get meaningful toxicity,
    // treat strong negative sentiment as possible_toxicity.
    if (!isEnglishLike(text) && maxProb < TOXICITY_THRESHOLD) {
        try {
            const sModel = await loadSentimentModel();
            const sentimentOutput = await sModel(text);
            const top = Array.isArray(sentimentOutput) ? sentimentOutput[0] : null;
            const label = normalizeSentimentLabel(top?.label);
            const score = typeof top?.score === 'number' ? top.score : 0;
            if (label === 'negative' && score >= MULTILINGUAL_NEGATIVE_THRESHOLD) {
                maxProb = Math.max(maxProb, score);
                hits.unshift({ label: 'possible_toxicity', probability: score });
            }
        } catch (_) {
            log(`Multilingual fallback failed: ${_.message}`);
        }
    }

    return {
        score: maxProb,
        hits,
        labels: hits.map(h => h.label)
    };
};

const analyze = async (text) => {
    if (!text || text.trim().length === 0) {
        return {
            toxicity: [],
            sentiment: { label: 'neutral', score: 0 }
        };
    }

    await loadModels();

    // 1. Run Standard Toxicity (returns probabilities)
    const toxicityPredictions = await toxicityModel.classify([text]);

    let toxicityResult = (toxicityPredictions || [])
        .map(prediction => ({
            label: prediction.label,
            probability: prediction?.results?.[0]?.probabilities?.[1]
        }))
        .filter(x => typeof x.probability === 'number' && x.probability >= TOXICITY_THRESHOLD)
        .sort((a, b) => b.probability - a.probability);

    // 2. Run Multilingual Sentiment
    const sentimentOutput = await sentimentModel(text);
    const sentimentTop = sentimentOutput[0]; // { label: 'positive'/'negative' or '1 star'.., score: 0.99 }
    const sentimentResult = {
        label: normalizeSentimentLabel(sentimentTop?.label),
        score: sentimentTop?.score
    };

    // 3. Multilingual Toxicity Fallback
    if (!isEnglishLike(text)) {
        if (sentimentResult.label === 'negative' && sentimentResult.score > MULTILINGUAL_NEGATIVE_THRESHOLD) {
            if (toxicityResult.length === 0) {
                console.log(`[AI] detected Non-English Negative (${(sentimentResult.score * 100).toFixed(1)}%). Flagging as risk.`);
                toxicityResult.push({
                    label: 'possible_toxicity',
                    probability: sentimentResult.score
                });
            }
        }
    }

    return {
        toxicity: toxicityResult,
        sentiment: {
            label: sentimentResult.label,
            score: sentimentResult.score
        }
    };
};

module.exports = {
    analyze,
    loadModels,
    analyzeToxicity,
    loadToxicityModel
};
