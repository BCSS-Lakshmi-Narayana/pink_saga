const axios = require('axios');
const cheerio = require('cheerio');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 60;

const normalizeWhitespace = (value = '') => value.replace(/\s+/g, ' ').trim();

const stripHtml = (value = '') => {
  const $ = cheerio.load(value);
  return normalizeWhitespace($.text());
};

const computeRelevanceScore = (article, queryWords = []) => {
  if (!queryWords.length) return 0;

  const title = String(article.title || '').toLowerCase();
  const summary = String(article.summary || '').toLowerCase();
  const source = String(article.source || '').toLowerCase();
  const combined = `${title} ${summary} ${source}`;

  let score = 0;
  queryWords.forEach((word) => {
    if (!word) return;
    if (title.includes(word)) score += 5;
    if (summary.includes(word)) score += 3;
    if (source.includes(word)) score += 1;
    if (combined.includes(word)) score += 1;
  });

  return score;
};

const searchPublicWebArticles = async ({ query, limit }) => {
  const cleanQuery = normalizeWhitespace(String(query || ''));
  if (!cleanQuery) {
    return [];
  }

  const resultLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(cleanQuery)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const startedAt = Date.now();

  console.log(`[WebArticlesService] Fetching RSS | query="${cleanQuery}" | limit=${resultLimit}`);

  const response = await axios.get(rssUrl, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BluraHubBot/1.0; +https://blura.in)'
    }
  });

  const $ = cheerio.load(response.data, { xmlMode: true });
  const queryWords = cleanQuery.toLowerCase().split(' ').filter((part) => part.length >= 2);

  const seen = new Set();
  const items = [];

  $('item').each((index, element) => {
    if (items.length >= resultLimit) return false;

    const title = normalizeWhitespace($(element).find('title').first().text() || 'Untitled Article');
    const link = normalizeWhitespace($(element).find('link').first().text() || '');
    const source = normalizeWhitespace($(element).find('source').first().text() || 'Unknown Source');
    const descriptionRaw = $(element).find('description').first().text() || '';
    const summary = stripHtml(descriptionRaw).slice(0, 500);
    const publishedAt = $(element).find('pubDate').first().text() || new Date().toUTCString();

    if (!title || !link) return undefined;

    const dedupeKey = `${title}::${link}`.toLowerCase();
    if (seen.has(dedupeKey)) return undefined;
    seen.add(dedupeKey);

    const article = {
      id: `pub-live-${index + 1}`,
      title,
      source,
      url: link,
      summary: summary || 'No summary available for this result.',
      publishedAt: new Date(publishedAt).toISOString(),
      tags: queryWords.slice(0, 5),
      relevanceScore: 0
    };

    article.relevanceScore = computeRelevanceScore(article, queryWords);
    items.push(article);
    return undefined;
  });

  const sorted = items.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });

  const durationMs = Date.now() - startedAt;
  console.log(`[WebArticlesService] Parsed results | query="${cleanQuery}" | items=${sorted.length} | duration=${durationMs}ms`);

  return sorted;
};

module.exports = {
  searchPublicWebArticles
};
