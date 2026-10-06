const OpenAI = require('openai');
const { STATE_NAME } = require('../config/deployment');

let client = null;
let lastRequestAt = 0;

/* -------------------- CONFIG HELPERS -------------------- */

const getClient = () => {
  if (client) return client;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY missing');
  }
  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
};

const getModel = () =>
  process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

const getTemperature = () =>
  Number(process.env.OPENAI_TEMPERATURE) || 0.3;

const getMaxTokens = () => {
  const v = Number(process.env.OPENAI_MAX_TOKENS);
  return Number.isFinite(v) ? Math.min(Math.max(v, 900), 1400) : 1200;
};

const getRateLimitMs = () =>
  Number(process.env.OPENAI_RATE_LIMIT) || 0;

/* -------------------- CONSTANTS -------------------- */

const REQUIRED_SECTIONS = [
  '## Summary',
  '## Top Shared Links',
  '## Police & Public Safety',
  '## Government & Politics',
  '## Influencers & Viral Social',
  '## Recommended Posts'
];

/* -------------------- VALIDATION -------------------- */

const isInvalidOutput = (text) => {
  if (!text) return true;
  return REQUIRED_SECTIONS.some(h => !text.includes(h));
};

const safeFallback = () => `
## Summary
No sufficient verified social media content was available for the selected filters.

## Top Shared Links
- None

## Police & Public Safety
- No major police or public safety updates detected.

## Government & Politics
- No significant political or government developments observed.

## Influencers & Viral Social
- No strong viral narratives identified.

## Recommended Posts
- None
`.trim();

/* -------------------- MAIN FUNCTION -------------------- */

const createSocialGlanceMarkdown = async ({
  question,
  timeRange,
  platforms,
  posts = [],
  topLinks = []
}) => {

  const delay = getRateLimitMs();
  const now = Date.now();
  if (delay && now - lastRequestAt < delay) {
    const err = new Error('Rate limited');
    err.retryAfterMs = delay - (now - lastRequestAt);
    throw err;
  }
  lastRequestAt = now;

  const client = getClient();

  const compactPosts = posts.slice(0, 100).map(p => ({
    platform: p.platform,
    url: p.url || p.link,
    author: p.author,
    text: String(p.text || '').slice(0, 350)
  }));

  const systemPrompt = `
You are a regional news intelligence agent for ${STATE_NAME}, India.

STRICT RULES:
- Use ONLY the provided posts.
- Do NOT claim web searches or external research.
- Focus on police, politics, government, and viral social narratives.
- Output MUST be 50–100 lines total.
- Tone must be neutral, factual, and news-like.

MANDATORY SECTIONS (in order):
${REQUIRED_SECTIONS.join('\n')}
`;

  const userPrompt = JSON.stringify({
    question,
    timeRange,
    platforms,
    topLinks: topLinks.slice(0, 6),
    posts: compactPosts
  });

  const callModel = async () => {
    const res = await client.chat.completions.create({
      model: getModel(),
      temperature: getTemperature(),
      max_tokens: getMaxTokens(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });
    return res.choices?.[0]?.message?.content?.trim();
  };

  let output = await callModel();

  if (isInvalidOutput(output)) {
    output = await callModel();
  }

  return isInvalidOutput(output) ? safeFallback() : output;
};

module.exports = { createSocialGlanceMarkdown };
