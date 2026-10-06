const Keyword = require('../models/Keyword');

/**
 * Normalizes text for polyglot matching.
 * Uses NFKC normalization to handle compatibility characters and ensures lowercase.
 * @param {string} text 
 * @returns {string}
 */
const normalizeText = (text) => {
    if (!text) return '';
    return text.normalize('NFKC').toLowerCase().trim();
};

/**
 * Loads all active keywords from the database.
 * @returns {Promise<Array>} List of keyword objects
 */
const loadKeywords = async () => {
    try {
        return await Keyword.find({ is_active: true });
    } catch (error) {
        console.error('Error loading keywords:', error.message);
        return [];
    }
};

/**
 * Checks text against a list of keywords.
 * Handles different matching strategies based on language.
 * @param {string} text - The content text to check
 * @param {Array} keywords - List of keyword objects from DB
 * @returns {Object} result - { matches: [], totalScore: 0, byCategory: {} }
 */
const matchKeywords = (text, keywords) => {
    const normalizedText = normalizeText(text);
    const matches = [];
    let totalScore = 0;
    const byCategory = {};

    if (!text || !keywords || keywords.length === 0) {
        return { matches, totalScore, byCategory };
    }

    // Tokenize text for safer matching (space delimiter fallback for all)
    // For Indian languages, simple space splitting is often sufficient for basic Keyword spotting.
    // We perform a "contains" check for phrases or a "token" check for single words.

    keywords.forEach(kw => {
        const term = normalizeText(kw.keyword);
        if (!term) return;

        let isMatch = false;

        if (kw.language === 'en' || kw.language === 'all') {
            // Use word boundaries for English to avoid "ass" in "bass"
            // Escape special regex chars in term
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`\\b${escapedTerm}\\b`, 'i');
            if (pattern.test(normalizedText)) {
                isMatch = true;
            }
        } else {
            // For Hindi/Telugu/Others, word boundaries (\b) are flaky with unicode.
            // We use a simpler "includes" check but we verify it's part of a meaningful segment if needed.
            // For Phase 1, robust 'includes' is acceptable given the constraints "Polyglot... match against incoming"
            // To reduce false positives (e.g. matching a syllable), we can ensure it's surrounded by spaces or punctuation,
            // but simpler is to just check 'includes' for now if the keywords are distinct words.
            if (normalizedText.includes(term)) {
                isMatch = true;
            }
        }

        if (isMatch) {
            matches.push({
                keyword: kw.keyword,
                language: kw.language,
                category: kw.category,
                weight: kw.weight
            });

            totalScore += kw.weight;

            // Group by category
            if (!byCategory[kw.category]) {
                byCategory[kw.category] = { count: 0, score: 0, keywords: [] };
            }
            byCategory[kw.category].count += 1;
            byCategory[kw.category].score += kw.weight;
            byCategory[kw.category].keywords.push(kw.keyword);
        }
    });

    return { matches, totalScore, byCategory };
};

module.exports = {
    normalizeText,
    loadKeywords,
    matchKeywords
};
