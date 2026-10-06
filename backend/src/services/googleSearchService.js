const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Perform a Web search (via DuckDuckGo HTML) and return results
 * @param {string} query - The search query
 * @param {number} limit - Number of results to return (default 10)
 * @param {string} timeFilter - 'd' (day), 'w' (week), 'm' (month), or null (any time)
 * @returns {Promise<Array<{title: string, link: string, snippet: string, source: string}>>}
 */
const searchWeb = async (query, limit = 10, timeFilter = null) => {
    try {
        let url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        if (timeFilter) {
            url += `&df=${timeFilter}`;
        }

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Referer': 'https://html.duckduckgo.com/'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const items = [];

        $('.result').each((i, el) => {
            if (items.length >= limit) return false;

            const titleEl = $(el).find('.result__a');
            const snippetEl = $(el).find('.result__snippet');
            const urlEl = $(el).find('.result__url');

            const title = titleEl.text().trim();
            const link = titleEl.attr('href');
            const snippet = snippetEl.text().trim();

            // Skip ads or malformed results
            if (title && link && !link.includes('duckduckgo.com/y.js')) {
                items.push({
                    title: title,
                    link: link,
                    snippet: snippet,
                    source: urlEl.text().trim().split('/')[0] || 'Web',
                    platform: 'Web'
                });
            }
        });

        return items;

    } catch (error) {
        console.error('Web Search Error (Axios):', error.message);
        return [];
    }
};

module.exports = {
    searchWeb
};
