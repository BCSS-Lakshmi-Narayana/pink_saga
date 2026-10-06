const googleTrends = require('google-trends-api');

const GEO_MAP = {
  IN: 'IN',
  US: 'US',
  GLOBAL: '',
  '': ''
};

// google-trends-api `property` values. '' = Web Search.
const PROPERTY_MAP = {
  web: '',
  '': '',
  images: 'images',
  news: 'news',
  youtube: 'youtube',
  froogle: 'froogle',
  shopping: 'froogle'
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

const cacheGet = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) return null;
  return hit.value;
};

const cacheGetStale = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > STALE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
};

const cacheGetAnyStaleForKeyword = (keyword) => {
  const prefix = `${keyword.toLowerCase()}|`;
  for (const [k, v] of cache.entries()) {
    if (k.startsWith(prefix) && Date.now() - v.ts <= STALE_TTL_MS) return v.value;
  }
  return null;
};

const cacheSet = (key, value) => {
  if (cache.size > 200) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { ts: Date.now(), value });
};

// In-flight request map — collapses concurrent identical requests into one
// Google call so rapid filter changes don't multiply the rate-limit hit.
const inflight = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const safeParse = (raw) => {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  const str = String(raw).trim();
  if (!str || str.startsWith('<')) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

const callTrends = async (fn, args) => {
  try {
    const raw = await fn(args);
    const parsed = safeParse(raw);
    if (parsed) return { data: parsed, rateLimited: false };
    return { data: null, rateLimited: true };
  } catch (err) {
    const message = String(err?.message || err || '');
    const rateLimited =
      message.includes('Unexpected token') ||
      message.includes('429') ||
      message.toLowerCase().includes('too many');
    return { data: null, rateLimited, error: message };
  }
};

const callTrendsWithRetry = async (fn, args, retries = 1) => {
  let last = await callTrends(fn, args);
  for (let i = 0; i < retries && last.rateLimited; i++) {
    await sleep(2000 + i * 1500);
    last = await callTrends(fn, args);
  }
  return last;
};

const parseDate = (value, fallback) => {
  if (!value) return fallback;
  const d = new Date(value);
  return isNaN(d.getTime()) ? fallback : d;
};

const computeTrendingScore = (timeline) => {
  if (!Array.isArray(timeline) || timeline.length === 0) return 0;
  const values = timeline.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (values.length === 0) return 0;
  const recentWindow = values.slice(-Math.max(3, Math.floor(values.length * 0.2)));
  const earlierWindow = values.slice(0, Math.max(3, Math.floor(values.length * 0.2)));
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const recent = avg(recentWindow);
  const earlier = avg(earlierWindow) || 1;
  const peak = Math.max(...values);
  const momentum = ((recent - earlier) / earlier) * 100;
  const score = Math.round(
    Math.min(100, Math.max(0, recent * 0.6 + (momentum > 0 ? momentum * 0.3 : 0) + peak * 0.1))
  );
  return score;
};

// Derive change percentage and momentum direction from interest timeline.
const computeMomentum = (timeline) => {
  if (!Array.isArray(timeline) || timeline.length < 4) {
    return { changePct: 0, direction: 'flat' };
  }
  const values = timeline.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (values.length < 4) return { changePct: 0, direction: 'flat' };
  const half = Math.floor(values.length / 2);
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const recent = avg(values.slice(half));
  const earlier = avg(values.slice(0, half)) || 1;
  const changePct = Math.round(((recent - earlier) / earlier) * 100);
  const direction = changePct > 2 ? 'up' : changePct < -2 ? 'down' : 'flat';
  return { changePct, direction };
};

// Rising query "value" from Google Trends is a percent change (e.g. 200, 4500)
// or 'Breakout' which the API surfaces as a very large sentinel (>= 5000).
// We classify those as Breakout in the UI.
const formatRisingChange = (item) => {
  const raw = item.value;
  const formatted = item.formattedValue;
  if (typeof formatted === 'string' && /breakout/i.test(formatted)) {
    return { breakout: true, changePct: null, label: 'Breakout' };
  }
  if (typeof raw === 'number' && raw >= 5000) {
    return { breakout: true, changePct: null, label: 'Breakout' };
  }
  if (typeof formatted === 'string' && formatted.includes('%')) {
    const pct = parseInt(formatted.replace(/[^0-9-]/g, ''), 10);
    return { breakout: false, changePct: Number.isFinite(pct) ? pct : null, label: formatted };
  }
  return {
    breakout: false,
    changePct: typeof raw === 'number' ? raw : null,
    label: formatted || (typeof raw === 'number' ? `+${raw}%` : '—')
  };
};

exports.getSearchTrends = async (req, res) => {
  const keyword = String(req.query.q || '').trim();
  if (!keyword) {
    return res.status(400).json({ success: false, message: 'Query parameter "q" is required' });
  }

  const countryRaw = String(req.query.country || 'IN').toUpperCase();
  const geo = GEO_MAP[countryRaw] ?? 'IN';

  const propertyRaw = String(req.query.property || 'web').toLowerCase();
  const property = PROPERTY_MAP[propertyRaw] ?? '';

  const categoryRaw = parseInt(req.query.category, 10);
  const category = Number.isFinite(categoryRaw) && categoryRaw >= 0 ? categoryRaw : 0;

  const now = new Date();
  const defaultStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const startTime = parseDate(req.query.startTime, defaultStart);
  const endTime = parseDate(req.query.endTime, now);

  const hourBucket = (d) => Math.floor(d.getTime() / (60 * 60 * 1000));
  const cacheKey = `${keyword.toLowerCase()}|${countryRaw}|${property || 'web'}|${category}|${hourBucket(startTime)}|${hourBucket(endTime)}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.set('X-Cache', 'HIT');
    return res.json(cached);
  }

  // Deduplicate concurrent identical requests — rapid filter changes used to
  // fire several Google calls per click. Now they share the same promise.
  if (inflight.has(cacheKey)) {
    try {
      const shared = await inflight.get(cacheKey);
      res.set('X-Cache', 'INFLIGHT');
      return res.json(shared);
    } catch (err) {
      // fall through to retry — original requester already failed
    }
  }

  const buildOptions = (cat, prop) => {
    const opts = { keyword, geo, startTime, endTime };
    if (prop) opts.property = prop;
    if (cat) opts.category = cat;
    return opts;
  };

  const regionResolution = geo ? 'REGION' : 'COUNTRY';
  const appliedFallbacks = [];

  // First attempt: with whatever filters the user picked.
  let activeCategory = category;
  let activeProperty = property;
  let baseOptions = buildOptions(activeCategory, activeProperty);

  try {
    // 1 retry on the primary call — additional retries multiply rate-limit risk.
    let interestRes = await callTrendsWithRetry(googleTrends.interestOverTime, baseOptions, 1);

    const hasInterestData = (res) => {
      if (res.rateLimited || !res.data) return false;
      const tl = res.data?.default?.timelineData || [];
      if (tl.length === 0) return false;
      const total = tl.reduce((s, p) => s + (Array.isArray(p.value) ? p.value[0] : 0), 0);
      return total > 0;
    };

    // Auto-relax ONCE — prefer dropping category first (most common cause of empty
    // results), otherwise drop property. Cascading both burns through Google's
    // rate limit fast, so we stop after one relaxation.
    if (!hasInterestData(interestRes) && !interestRes.rateLimited) {
      if (activeCategory) {
        appliedFallbacks.push(`category (${activeCategory}) → all categories`);
        activeCategory = 0;
      } else if (activeProperty) {
        appliedFallbacks.push(`${propertyRaw} → web search`);
        activeProperty = '';
      }
      if (appliedFallbacks.length > 0) {
        baseOptions = buildOptions(activeCategory, activeProperty);
        await sleep(800);
        interestRes = await callTrendsWithRetry(googleTrends.interestOverTime, baseOptions, 0);
      }
    }

    await sleep(700);
    const regionRes = await callTrendsWithRetry(
      googleTrends.interestByRegion,
      { ...baseOptions, resolution: regionResolution },
      1
    );
    await sleep(700);
    const relatedQueriesRes = await callTrendsWithRetry(googleTrends.relatedQueries, baseOptions, 0);

    const queriesHaveData =
      !relatedQueriesRes.rateLimited &&
      ((relatedQueriesRes.data?.default?.rankedList?.[0]?.rankedKeyword || []).length > 0 ||
        (relatedQueriesRes.data?.default?.rankedList?.[1]?.rankedKeyword || []).length > 0);

    // Only fetch related topics if queries returned nothing — saves one Google
    // call per request. The Topics tab in the UI falls back gracefully when empty.
    let relatedTopicsRes = { data: null, rateLimited: false };
    if (!queriesHaveData) {
      await sleep(700);
      relatedTopicsRes = await callTrendsWithRetry(googleTrends.relatedTopics, baseOptions, 0);
    }

    if (interestRes.rateLimited) {
      const stale = cacheGetStale(cacheKey) || cacheGetAnyStaleForKeyword(keyword);
      if (stale) {
        res.set('X-Cache', 'STALE');
        return res.json({ ...stale, stale: true, staleReason: 'rate_limited' });
      }
      return res.status(429).json({
        success: false,
        rateLimited: true,
        message:
          'Google Trends rate-limited this request. Wait ~30 seconds and try again, or pick a narrower keyword / range.'
      });
    }

    const timelineRaw = interestRes.data?.default?.timelineData || [];
    const interestOverTime = timelineRaw.map((point) => ({
      time: point.formattedAxisTime || point.formattedTime || '',
      date: point.time ? new Date(Number(point.time) * 1000).toISOString() : null,
      value: Array.isArray(point.value) ? point.value[0] : 0
    }));

    const topBlock = relatedQueriesRes.data?.default?.rankedList?.[0]?.rankedKeyword || [];
    const risingBlock = relatedQueriesRes.data?.default?.rankedList?.[1]?.rankedKeyword || [];
    const topicsTopBlock = relatedTopicsRes.data?.default?.rankedList?.[0]?.rankedKeyword || [];
    const topicsRisingBlock = relatedTopicsRes.data?.default?.rankedList?.[1]?.rankedKeyword || [];

    const mapTopQuery = (item, idx) => ({
      rank: idx + 1,
      query: item.query,
      value: item.value,
      link: item.link ? `https://trends.google.com${item.link}` : null
    });
    const mapRisingQuery = (item, idx) => {
      const change = formatRisingChange(item);
      return {
        rank: idx + 1,
        query: item.query,
        value: item.value,
        link: item.link ? `https://trends.google.com${item.link}` : null,
        ...change
      };
    };
    const mapTopTopic = (item, idx) => ({
      rank: idx + 1,
      query: item.topic?.title || item.topic?.mid || '(topic)',
      topicType: item.topic?.type || null,
      value: item.value,
      link: item.link ? `https://trends.google.com${item.link}` : null
    });
    const mapRisingTopic = (item, idx) => {
      const change = formatRisingChange(item);
      return {
        rank: idx + 1,
        query: item.topic?.title || item.topic?.mid || '(topic)',
        topicType: item.topic?.type || null,
        value: item.value,
        link: item.link ? `https://trends.google.com${item.link}` : null,
        ...change
      };
    };

    const queries = {
      top: topBlock.slice(0, 25).map(mapTopQuery),
      rising: risingBlock.slice(0, 25).map(mapRisingQuery)
    };
    const topics = {
      top: topicsTopBlock.slice(0, 25).map(mapTopTopic),
      rising: topicsRisingBlock.slice(0, 25).map(mapRisingTopic)
    };

    // Back-compat shape used by older parts of the UI.
    const relatedQueries = {
      top: queries.top.length ? queries.top : topics.top,
      rising: queries.rising.length ? queries.rising : topics.rising,
      source:
        queries.top.length || queries.rising.length
          ? 'queries'
          : topics.top.length || topics.rising.length
          ? 'topics'
          : 'none'
    };

    const regionRows = regionRes.data?.default?.geoMapData || [];
    const topRegions = regionRows
      .filter((row) => Array.isArray(row.value) && row.value[0] > 0)
      .map((row) => ({
        geoCode: row.geoCode,
        geoName: row.geoName,
        value: row.value[0],
        formatted: Array.isArray(row.formattedValue) ? row.formattedValue[0] : row.formattedValue
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 25);

    const trendingScore = computeTrendingScore(interestOverTime);
    const momentum = computeMomentum(interestOverTime);
    const peak = interestOverTime.reduce(
      (acc, p) => (p.value > acc.value ? p : acc),
      { value: -1, time: '', date: null }
    );

    const partial = {
      interestOverTime: interestRes.rateLimited,
      relatedQueries: relatedQueriesRes.rateLimited && relatedTopicsRes.rateLimited,
      topRegions: regionRes.rateLimited
    };

    const effectivePropertyKey =
      Object.entries(PROPERTY_MAP).find(([, v]) => v === activeProperty)?.[0] || 'web';

    const payload = {
      success: true,
      query: keyword,
      country: countryRaw,
      geo: geo || 'GLOBAL',
      property: propertyRaw,
      category,
      effective: {
        property: effectivePropertyKey,
        category: activeCategory
      },
      fallbacks: appliedFallbacks,
      range: { startTime: startTime.toISOString(), endTime: endTime.toISOString() },
      interestOverTime,
      queries,
      topics,
      relatedQueries,
      topRegions,
      summary: {
        trendingScore,
        momentum,
        averageInterest: interestOverTime.length
          ? Math.round(interestOverTime.reduce((s, p) => s + p.value, 0) / interestOverTime.length)
          : 0,
        peakInterest: peak.value > 0 ? peak : null,
        dataPoints: interestOverTime.length,
        topRegionsCount: topRegions.length,
        topQueriesCount: queries.top.length,
        risingQueriesCount: queries.rising.length,
        topTopicsCount: topics.top.length,
        risingTopicsCount: topics.rising.length
      },
      partial,
      lastUpdated: new Date().toISOString()
    };

    cacheSet(cacheKey, payload);
    res.set('X-Cache', 'MISS');
    return res.json(payload);
  } catch (err) {
    console.error('[searchTrends] failed:', err.message);
    return res.status(502).json({
      success: false,
      message: 'Failed to fetch Google Trends data',
      error: err.message
    });
  }
};
