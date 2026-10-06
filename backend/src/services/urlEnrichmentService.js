const Content = require('../models/Content');
const { scrapeOpenGraph } = require('../utils/ogScraper');

const enrichUrlCards = async (contentId) => {
    try {
        const content = await Content.findOne({ id: contentId });
        if (!content) return;

        // Check if there are t.co URLs in the text that need scraping
        const tcoRegex = /https?:\/\/t\.co\/[a-zA-Z0-9]+/g;
        const tcoUrls = content.text?.match(tcoRegex) || [];

        if (tcoUrls.length === 0) return;

        // Skip if we already have url_cards with images
        if (content.url_cards?.some(card => card.image)) return;

        console.log(`[URLEnrich] Scraping ${tcoUrls.length} URLs for content ${contentId}`);

        const urlCards = [];
        for (const url of tcoUrls.slice(0, 2)) { // Limit to 2 URLs per tweet
            const ogData = await scrapeOpenGraph(url);
            if (ogData && (ogData.title || ogData.image)) {
                urlCards.push({
                    url: url,
                    expanded_url: ogData.url,
                    display_url: new URL(ogData.url).hostname.replace('www.', ''),
                    title: ogData.title,
                    description: ogData.description,
                    image: ogData.image
                });
            }
        }

        if (urlCards.length > 0) {
            content.url_cards = urlCards;
            await content.save();
            console.log(`[URLEnrich] Updated ${contentId} with ${urlCards.length} URL cards`);
        }
    } catch (error) {
        console.warn(`[URLEnrich] Error enriching ${contentId}: ${error.message}`);
    }
};

/**
 * Queue URL enrichment for new content items
 * @param {string[]} contentIds
 */
const queueUrlEnrichment = (contentIds) => {
    contentIds.forEach((id, index) => {
        setTimeout(() => {
            enrichUrlCards(id).catch(console.error);
        }, index * 2000);
    });
};

module.exports = {
    enrichUrlCards,
    queueUrlEnrichment
};
