const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Scrape Open Graph meta tags from a URL to get link preview data
 * @param {string} url - The URL to scrape (can be t.co shortlink)
 * @returns {Promise<{title: string, description: string, image: string, url: string} | null>}
 */
const scrapeOpenGraph = async (url) => {
    try {
        // Follow redirects to get final URL
        const response = await axios.get(url, {
            timeout: 5000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            },
            validateStatus: (status) => status < 400
        });

        const finalUrl = response.request?.res?.responseUrl || url;
        const html = response.data;

        if (typeof html !== 'string') {
            return null;
        }

        const $ = cheerio.load(html);

        // Extract Open Graph meta tags
        const ogData = {
            url: finalUrl,
            title: $('meta[property="og:title"]').attr('content') ||
                $('meta[name="twitter:title"]').attr('content') ||
                $('title').text() || null,
            description: $('meta[property="og:description"]').attr('content') ||
                $('meta[name="twitter:description"]').attr('content') ||
                $('meta[name="description"]').attr('content') || null,
            image: $('meta[property="og:image"]').attr('content') ||
                $('meta[name="twitter:image"]').attr('content') ||
                $('meta[property="og:image:url"]').attr('content') || null
        };

        // Clean up - only return if we have meaningful data
        if (!ogData.title && !ogData.image) {
            return null;
        }

        // Ensure image URL is absolute
        if (ogData.image && !ogData.image.startsWith('http')) {
            try {
                const baseUrl = new URL(finalUrl);
                ogData.image = new URL(ogData.image, baseUrl.origin).href;
            } catch (e) {
                // Keep as-is
            }
        }

        return ogData;
    } catch (error) {
        // Silently fail - URL scraping is best-effort
        console.warn(`[OG Scraper] Failed to scrape ${url}: ${error.message}`);
        return null;
    }
};

/**
 * Batch scrape multiple URLs with concurrency limit
 * @param {string[]} urls - Array of URLs to scrape
 * @param {number} concurrency - Max concurrent requests
 * @returns {Promise<Map<string, object>>} - 
 */
const batchScrapeOpenGraph = async (urls, concurrency = 3) => {
    const results = new Map();

    // Filter out twitter/x.com URLs - no need to scrape those
    const externalUrls = urls.filter(url =>
        url &&
        !url.includes('twitter.com') &&
        !url.includes('x.com') &&
        !url.includes('t.co') === false // Keep t.co since they redirect to external
    );

    // Process in batches
    for (let i = 0; i < externalUrls.length; i += concurrency) {
        const batch = externalUrls.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(
            batch.map(async (url) => {
                const data = await scrapeOpenGraph(url);
                return { url, data };
            })
        );

        batchResults.forEach(result => {
            if (result.status === 'fulfilled' && result.value.data) {
                results.set(result.value.url, result.value.data);
            }
        });
    }

    return results;
};

module.exports = {
    scrapeOpenGraph,
    batchScrapeOpenGraph
};
