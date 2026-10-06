const axios = require('axios');

const GOOGLE_AI_MODE_HOST = 'google-ai-mode.p.rapidapi.com';

/**
 * Query Google AI Mode API - Gemini-powered search with web access
 * @param {string} prompt - The user's query/prompt
 * @param {string} sessionToken - Optional session token for follow-up questions
 * @returns {Promise<{response: string, sources: Array, sessionToken: string}>}
 */
const queryAiMode = async (prompt, sessionToken = null) => {
    const apiKey = process.env.GOOGLE_AI_MODE_RAPIDAPI_KEY;

    if (!apiKey) {
        console.error('[GoogleAiMode] Missing GOOGLE_AI_MODE_RAPIDAPI_KEY in .env');
        return null;
    }

    try {
        const params = {
            prompt: prompt,
            gl: 'in',  // India
            hl: 'en'   // English
        };

        // Add session token for follow-up questions
        if (sessionToken) {
            params.session_token = sessionToken;
        }

        console.log(`[GoogleAiMode] Querying: "${prompt.slice(0, 50)}..."`);

        const response = await axios.get(`https://${GOOGLE_AI_MODE_HOST}/ai-mode`, {
            params,
            headers: {
                'x-rapidapi-host': GOOGLE_AI_MODE_HOST,
                'x-rapidapi-key': apiKey
            },
            timeout: 30000 // 30 second timeout
        });

        if (response.data.status !== 'OK' || !response.data.data) {
            console.error('[GoogleAiMode] API returned error:', response.data);
            return null;
        }

        const data = response.data.data;

        // Extract and combine reply parts into a single response
        // Handle different part types: paragraph, list, etc.
        let fullResponse = '';
        if (data.reply_parts && Array.isArray(data.reply_parts)) {
            data.reply_parts.forEach(part => {
                const type = part.type || 'paragraph'; // Default to paragraph

                if (type === 'heading' && part.text) {
                    // Headings (assume H3 for structure)
                    fullResponse += `\n### ${part.text}\n\n`;
                }
                else if (type === 'paragraph' && part.text) {
                    // Standard text
                    fullResponse += part.text + '\n\n';
                }
                else if (type === 'list' && part.list && Array.isArray(part.list)) {
                    // List items
                    part.list.forEach(item => {
                        if (item.title) {
                            fullResponse += `**${item.title}** `;
                        }
                        if (item.text) {
                            fullResponse += item.text;
                        }
                        fullResponse += '\n\n';
                    });
                }
            });
        }

        // Extract sources/reference links
        const sources = [];
        if (data.reference_links && Array.isArray(data.reference_links)) {
            data.reference_links.forEach(link => {
                sources.push({
                    title: link.title || link.snippet || 'Source',
                    url: link.url || link.link || '#',
                    snippet: link.snippet || ''
                });
            });
        }

        console.log(`[GoogleAiMode] Success - Response: ${fullResponse.length} chars, Sources: ${sources.length}`);

        return {
            response: fullResponse.trim(),
            sources: sources,
            sessionToken: data.session_token || null
        };

    } catch (error) {
        if (error.response?.status === 429) {
            console.error('[GoogleAiMode] Rate limit hit. Please wait or upgrade plan.');
        } else {
            console.error('[GoogleAiMode] Error:', error.message);
        }
        return null;
    }
};

/**
 * Generate a social intelligence analysis using Google AI Mode
 * @param {string} query - Original user query
 * @param {Array} socialMediaResults - Results from X, Reddit, etc.
 * @param {Object} platformStats - Count of results per platform
 * @returns {Promise<{analysis: string, webSources: Array}>}
 */
const generateIntelligenceAnalysis = async (query, socialMediaResults = [], platformStats = {}) => {
    // Build a simple, direct prompt - let Google AI Mode do the heavy lifting
    let prompt = query;

    // Add social media context if we have significant results
    const significantResults = socialMediaResults.filter(item => {
        const text = item.text || item.content || item.title || '';
        return text.length > 50;
    }).slice(0, 10);

    if (significantResults.length > 0) {
        const socialSummary = significantResults.map((item, i) => {
            const text = item.text || item.content || item.title || '';
            const author = item.author || item.author_handle || 'Unknown';
            return `- [${item.platform}] @${author}: "${text.slice(0, 120)}..."`;
        }).join('\n');

        prompt = `${query}

Also, here is what people are saying on social media right now:
${socialSummary}

Please incorporate this social media sentiment into your analysis.

IMPORTANT: Respond ONLY in ENGLISH. If source content is in another language, translate and summarize it in English.`;
    }

    console.log(`[GoogleAiMode] Sending query: "${query.slice(0, 80)}..."`);

    const result = await queryAiMode(prompt);

    if (!result) {
        return null;
    }

    return {
        analysis: result.response,
        webSources: result.sources,
        sessionToken: result.sessionToken
    };
};

module.exports = {
    queryAiMode,
    generateIntelligenceAnalysis
};
