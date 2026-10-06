const axios = require('axios');
const { STATE_NAME } = require('../config/deployment');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Use compound-mini for web search (lower internal token usage) + 70b for structuring
const SEARCH_MODEL = 'groq/compound-mini';
const STRUCTURE_MODEL = 'llama-3.3-70b-versatile';

// Step 1: Web search via compound-mini (lighter, less TPM burn)
async function webSearch(eventData) {
  const { programme_name, organizer_details, police_station_place, zones } = eventData;

  const prompt = `Search X (Twitter) for real posts and hashtags about: "${programme_name}" ${police_station_place || ''} ${zones || ''}

Also search for: ${organizer_details || ''}

List every hashtag and keyword you find from actual posts. Include English, Telugu (Telugu script AND romanised) and Urdu results if found.`;

  const response = await axios.post(GROQ_API_URL, {
    model: SEARCH_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 800
  }, {
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 45000
  });

  return response.data?.choices?.[0]?.message?.content || '';
}

// Step 2: Use 70b to generate full keyword set, grounded by real search data
async function generateFromSearch(searchResults, eventData) {
  const { programme_name, gist, organizer_details, police_station_place, zones, expected_members, comments } = eventData;

  const trimmed = searchResults.length > 1500
    ? searchResults.substring(0, 1500) + '\n...(truncated)'
    : searchResults;

  const prompt = `You are a social media monitoring expert for ${STATE_NAME}, India.

REAL SEARCH DATA FROM X/TWITTER:
${trimmed}

EVENT DETAILS:
Name: ${programme_name || 'Unknown'}
Details: ${gist || 'No description'}
Organizer: ${organizer_details || 'Unknown'}
Location: ${police_station_place || 'Unknown'}, ${zones || ''}
Attendance: ${expected_members || 'Unknown'}
${comments ? 'Notes: ' + comments : ''}

Generate social media monitoring keywords. PRIORITY: Use hashtags/keywords from the REAL search data above. Then add keywords based on your knowledge of Indian social media patterns.

ENGLISH (10-15): Real hashtags from search + trending patterns for this event type, leader names, party abbreviations, news terms
TELUGU (10-15): Keywords in Telugu script that Telangana's Telugu press and readers use (Eenadu, Sakshi, Namasthe Telangana, V6, Andhra Jyothy, TV9 Telugu). NOT translations of English.
ROMANISED TELUGU (8-12): Keywords Telangana users actually type in Latin script — "Telgish" — local political slang, place names, colloquial terms. This tier matters: much of Telugu social media is typed this way and matches neither of the lists above. NOT translations of English.

Return ONLY valid JSON:
{"event_name":"...","location":"...","keywords_by_language":{"english":[],"telugu":[],"romanised_telugu":[]}}`;

  const response = await axios.post(GROQ_API_URL, {
    model: STRUCTURE_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: 1200
  }, {
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 30000
  });

  return response.data?.choices?.[0]?.message?.content || '';
}

function extractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*"keywords_by_language"[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

async function generateEventKeywords(eventData) {
  if (!GROQ_API_KEY) {
    console.error('[KeywordGen] GROQ_API_KEY not set');
    return null;
  }

  const startTime = Date.now();

  try {
    // Step 1: Web search via compound-mini (~10-20s)
    console.log('[KeywordGen] Step 1: Web search (compound-mini)...');
    let searchResults = '';
    try {
      searchResults = await webSearch(eventData);
      console.log(`[KeywordGen] Search found ${searchResults.length} chars in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    } catch (searchErr) {
      console.warn('[KeywordGen] Web search failed, proceeding with LLM only:', searchErr.response?.data?.error?.message || searchErr.message);
    }

    // Step 2: Generate keywords with 70b, grounded by search data (~2-5s)
    console.log('[KeywordGen] Step 2: Generating keywords (70b)...');
    const structured = await generateFromSearch(searchResults, eventData);
    const total = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[KeywordGen] Done in ${total}s`);

    const result = extractJSON(structured);
    if (!result?.keywords_by_language) {
      console.warn('[KeywordGen] Parse failed:', structured?.substring(0, 300));
      return null;
    }

    return {
      event_name: result.event_name || eventData.programme_name || '',
      location: result.location || eventData.police_station_place || '',
      keywords_by_language: {
        english: Array.isArray(result.keywords_by_language.english) ? result.keywords_by_language.english.slice(0, 15) : [],
        telugu: Array.isArray(result.keywords_by_language.telugu) ? result.keywords_by_language.telugu.slice(0, 15) : [],
        romanised_telugu: Array.isArray(result.keywords_by_language.romanised_telugu) ? result.keywords_by_language.romanised_telugu.slice(0, 15) : []
      }
    };
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const status = err.response?.status;
    const errMsg = err.response?.data?.error?.message || err.message;
    if (status === 429) {
      console.error(`[KeywordGen] Rate limited after ${elapsed}s:`, errMsg);
      return null;
    }
    console.error(`[KeywordGen] Failed after ${elapsed}s (${status}):`, errMsg);
    return null;
  }
}

module.exports = { generateEventKeywords };
