/**
 * check_platform_apis.js
 * Verifies that all platform API keys are configured and can fetch content.
 * Run: node scripts/check_platform_apis.js
 */
require('dotenv').config();
const axios = require('axios');
const { google } = require('googleapis');

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';
const WARN = '⚠️  WARN';

const results = [];

const log = (platform, status, detail) => {
  const line = `  ${status}  [${platform.padEnd(12)}] ${detail}`;
  results.push(line);
  console.log(line);
};

// ── 1. X / Twitter (RapidAPI) ────────────────────────────────────────────────
async function checkX() {
  const key = (process.env.RAPIDAPI_TWITTER_KEY || process.env.RAPIDAPI_X_KEY || process.env.RAPIDAPI_KEY || '').trim();
  const host = (process.env.RAPIDAPI_TWITTER_HOST || process.env.RAPIDAPI_X_HOST || process.env.RAPIDAPI_HOST || 'twitter241.p.rapidapi.com').trim();

  if (!key) {
    log('X/Twitter', FAIL, 'RAPIDAPI_KEY / RAPIDAPI_TWITTER_KEY not set in .env');
    return;
  }

  try {
    const resp = await axios.get(`https://${host}/search`, {
      params: { query: 'KCR BRS', type: 'Latest', count: 5 },
      headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host },
      timeout: 15000
    });
    const instructions = resp.data?.result?.timeline?.instructions ||
      resp.data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
    const entries = (instructions.find(i => i.type === 'TimelineAddEntries')?.entries) || [];
    log('X/Twitter', PASS, `Search OK — ${entries.length} entries returned (host: ${host})`);
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message;
    log('X/Twitter', FAIL, `HTTP ${status || 'N/A'}: ${String(msg).substring(0, 120)}`);
  }
}

// ── 2. YouTube ───────────────────────────────────────────────────────────────
async function checkYouTube() {
  const key = (process.env.YOUTUBE_API_KEY || '').trim();
  if (!key) {
    log('YouTube', FAIL, 'YOUTUBE_API_KEY not set in .env');
    return;
  }

  try {
    const yt = google.youtube({ version: 'v3', auth: key });
    const resp = await yt.search.list({
      part: ['snippet'],
      q: 'KCR BRS Telangana',
      type: 'video',
      maxResults: 5
    });
    const count = resp.data.items?.length || 0;
    log('YouTube', PASS, `Search OK — ${count} videos returned`);
  } catch (err) {
    const code = err.code || err.response?.status;
    const msg = err.message || '';
    if (String(msg).includes('quota')) {
      log('YouTube', WARN, `Quota exceeded (${code}): ${msg.substring(0, 100)}`);
    } else {
      log('YouTube', FAIL, `Error ${code}: ${msg.substring(0, 120)}`);
    }
  }
}

// ── 3. Facebook (RapidAPI) ───────────────────────────────────────────────────
async function checkFacebook() {
  const key = (process.env.RAPIDAPI_FACEBOOK_KEY || process.env.RAPIDAPI_FACEBOOK_KEYS || process.env.RAPIDAPI_KEY || '').split(',')[0].trim();
  const host = (process.env.RAPIDAPI_FACEBOOK_HOST || 'facebook-scraper3.p.rapidapi.com').trim();

  if (!key) {
    log('Facebook', FAIL, 'RAPIDAPI_FACEBOOK_KEY / RAPIDAPI_KEY not set in .env');
    return;
  }

  try {
    const resp = await axios.get(`https://${host}/search/posts`, {
      params: { query: 'KCR BRS', limit: 5 },
      headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host },
      timeout: 20000
    });
    const posts = resp.data?.results || resp.data?.posts || resp.data || [];
    const count = Array.isArray(posts) ? posts.length : 0;
    log('Facebook', PASS, `Search OK — ${count} posts returned (host: ${host})`);
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    log('Facebook', FAIL, `HTTP ${status || 'N/A'}: ${String(msg).substring(0, 120)}`);
  }
}

// ── 4. Instagram (RapidAPI) ──────────────────────────────────────────────────
async function checkInstagram() {
  const key = (process.env.RAPIDAPI_INSTAGRAM_KEY || process.env.RAPIDAPI_INSTAGRAM_KEYS || process.env.RAPIDAPI_KEY || '').split(',')[0].trim();
  const host = (process.env.RAPIDAPI_INSTAGRAM_HOST || 'instagram120.p.rapidapi.com').trim();

  if (!key) {
    log('Instagram', FAIL, 'RAPIDAPI_INSTAGRAM_KEY / RAPIDAPI_KEY not set in .env');
    return;
  }

  try {
    const resp = await axios.get(`https://${host}/v1/hashtag`, {
      params: { hashtag: 'VishnuDeoSai' },
      headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host },
      timeout: 15000
    });
    const count = resp.data?.data?.count || resp.data?.count || '?';
    log('Instagram', PASS, `Hashtag lookup OK — count: ${count} (host: ${host})`);
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    // Instagram may not support hashtag search on all plans, try a user lookup instead
    if (status === 404 || String(msg).includes('endpoint')) {
      log('Instagram', WARN, `Hashtag endpoint not available on plan (${status}). Key is set but plan may not support this.`);
    } else {
      log('Instagram', FAIL, `HTTP ${status || 'N/A'}: ${String(msg).substring(0, 120)}`);
    }
  }
}

// ── 5. Config summary ────────────────────────────────────────────────────────
function printConfigSummary() {
  console.log('\n────────── ENV CONFIGURATION ──────────');
  const keys = {
    RAPIDAPI_KEY:            process.env.RAPIDAPI_KEY,
    RAPIDAPI_HOST:           process.env.RAPIDAPI_HOST,
    RAPIDAPI_TWITTER_KEY:    process.env.RAPIDAPI_TWITTER_KEY,
    RAPIDAPI_X_KEY:          process.env.RAPIDAPI_X_KEY,
    YOUTUBE_API_KEY:         process.env.YOUTUBE_API_KEY,
    RAPIDAPI_FACEBOOK_KEY:   process.env.RAPIDAPI_FACEBOOK_KEY,
    RAPIDAPI_FACEBOOK_HOST:  process.env.RAPIDAPI_FACEBOOK_HOST,
    RAPIDAPI_INSTAGRAM_KEY:  process.env.RAPIDAPI_INSTAGRAM_KEY,
    RAPIDAPI_INSTAGRAM_HOST: process.env.RAPIDAPI_INSTAGRAM_HOST,
    GROQ_API_KEY:            process.env.GROQ_API_KEY,
  };

  for (const [k, v] of Object.entries(keys)) {
    const display = v ? `${v.substring(0, 6)}...${v.substring(v.length - 4)} (len:${v.length})` : '❌ NOT SET';
    console.log(`  ${k.padEnd(30)} = ${display}`);
  }
  console.log('───────────────────────────────────────\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔍  SANKET — Platform API Diagnostic\n');
  printConfigSummary();

  console.log('──────────── PLATFORM TESTS ────────────');
  await checkX();
  await checkYouTube();
  await checkFacebook();
  await checkInstagram();

  console.log('\n──────────── SUMMARY ────────────');
  const passed = results.filter(r => r.includes('PASS')).length;
  const failed = results.filter(r => r.includes('FAIL')).length;
  const warned = results.filter(r => r.includes('WARN')).length;
  console.log(`  Passed: ${passed}  |  Failed: ${failed}  |  Warnings: ${warned}`);

  if (failed > 0) {
    console.log(`\n⚠️  ACTION NEEDED: ${failed} platform(s) are not configured.`);
    console.log('   Add missing API keys to backend/.env or set them in the Settings page → API Keys.\n');
  } else {
    console.log('\n🎉  All platforms are configured and responding!\n');
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
