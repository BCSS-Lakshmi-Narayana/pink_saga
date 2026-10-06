const { GoogleGenerativeAI } = require('@google/generative-ai');
const SOURCE_WEIGHTS = {
    'Web': 1.0,
    'News': 1.0,
    'Youtube': 0.8,
    'X (Twitter)': 0.7,
    'Reddit': 0.4,
    'Facebook': 0.5
};

const RECENCY_DECAY_FACTOR = 0.5; // Controls how fast old news loses value

const getSourceScore = (platform) => {
    return SOURCE_WEIGHTS[platform] || 0.6; // Default for unknown
};

const getRecencyScore = (timestamp) => {
    if (!timestamp) return 0.5; // Penalize undated content

    const now = Date.now();
    const itemTime = new Date(timestamp).getTime();
    const ageInHours = (now - itemTime) / (1000 * 60 * 60);

    if (ageInHours < 2) return 1.0; // Fresh
    if (ageInHours < 6) return 0.9;
    if (ageInHours < 24) return 0.7;

    // Decay formula: 1 / (1 + age * decay)
    return 1 / (1 + (ageInHours * 0.1));
};

const rankAndProcess = async (rawResults, query, apiKey) => {
    // 1. Initial Scoring & Sorting
    const scoredResults = rawResults.map(item => {
        const sourceScore = getSourceScore(item.platform);
        const recencyScore = getRecencyScore(item.created_at || item.published_at);
        const baseScore = sourceScore * recencyScore;

        return { ...item, baseScore, impactScore: 0, signalType: 'Unclassified' };
    }).sort((a, b) => b.baseScore - a.baseScore);

    // 2. Select Candidates for AI Analysis (Top 30 to save tokens)
    const candidates = scoredResults.slice(0, 30);
    const tail = scoredResults.slice(30); // Keep remaining as "Low Signal" backup

    if (!apiKey) return {
        executiveSummary: "AI Analysis unavailable (Missing Key).",
        highSignal: candidates,
        emerging: [],
        noise: tail
    };

    // 3. AI Impact Analysis (Batch Process)
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-flash-latest' });

        const prompt = `You are a Senior Intelligence Analyst. Rank these search results for the query: "${query}".
        
        For each item, assign:
        - Impact Score (1-10): Based on real-world consequence (market moving, verified news, official statement).
        - Signal Type: "High Signal", "Emerging", or "Noise".
        
        Items:
        ${candidates.map((c, i) => `[${i}] ${c.title} (${c.platform}) - ${c.text?.slice(0, 100)}...`).join('\n')}
        
        Return JSON ONLY: { "rankings": [ { "index": 0, "impact": 9, "type": "High Signal", "reason": "..." }, ... ] }`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        const aiData = JSON.parse(text);

        // Merge AI scores
        if (aiData.rankings) {
            aiData.rankings.forEach(r => {
                if (candidates[r.index]) {
                    candidates[r.index].impactScore = r.impact;
                    candidates[r.index].signalType = r.type;
                    candidates[r.index].reason = r.reason;
                    // Boost base score with AI impact
                    candidates[r.index].finalScore = candidates[r.index].baseScore * (1 + (r.impact / 10));
                }
            });
        }

        // Re-sort by Final Score
        candidates.sort((a, b) => (b.finalScore || b.baseScore) - (a.finalScore || a.baseScore));

    } catch (e) {
        console.error("AI Ranking Error:", e.message);
        // Fallback: use base scores
    }

    // 4. Group Results
    const highSignal = candidates.filter(c => c.signalType === 'High Signal' || c.impactScore >= 7);
    const emerging = candidates.filter(c => c.signalType === 'Emerging' || (c.impactScore >= 4 && c.impactScore < 7));
    const noise = [...candidates.filter(c => c.signalType === 'Noise' || c.impactScore < 4), ...tail];

    return {
        // We'll let the controller generate the text summary from these groups
        groups: {
            highSignal,
            emerging,
            noise
        }
    };
};

module.exports = {
    rankAndProcess
};
