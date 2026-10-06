const { searchPublicWebArticles } = require('../services/webArticleSearchService');

const searchWebArticles = async (req, res) => {
  const startedAt = Date.now();
  try {
    const q = String(req.query.q || '').trim();
    const limit = Number(req.query.limit || 25);

    console.log(`[WebArticles] Search request received | query="${q}" | limit=${limit}`);

    if (!q || q.length < 2) {
      console.warn('[WebArticles] Rejected request: query shorter than 2 characters');
      return res.status(400).json({ message: 'Query must be at least 2 characters.' });
    }

    const articles = await searchPublicWebArticles({ query: q, limit });
    const durationMs = Date.now() - startedAt;
    console.log(`[WebArticles] Search completed | query="${q}" | results=${articles.length} | duration=${durationMs}ms`);

    return res.status(200).json({
      query: q,
      total: articles.length,
      articles
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[WebArticles] Search failed | duration=${durationMs}ms | error=${error.message}`);
    return res.status(500).json({ message: `Failed to fetch web articles: ${error.message}` });
  }
};

module.exports = {
  searchWebArticles
};
