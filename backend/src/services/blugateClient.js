const axios = require('axios');
const zlib = require('zlib');

/**
 * Shared client for BluGate — the metered gateway that fronts YouTube,
 * Twitter/X, Facebook, and Instagram so API usage can be tracked per client.
 * Endpoint paths/params are identical to the underlying provider's own REST
 * API; only the base URL and auth headers differ.
 *
 * The valid routes per provider are listed in backend/BluGate_Provider_Endpoints.xlsx.
 */

const DEFAULT_GATEWAY_BASE = 'https://blugate.blurasaga.com/api/gateway';

const GATEWAY_BASE = String(process.env.BLUGATE_BASE_URL || DEFAULT_GATEWAY_BASE).trim().replace(/\/+$/, '');

const hasGatewayCredentials = () => !!(process.env.BLUGATE_API_KEY && process.env.BLUGATE_CLIENT_CODE);

/**
 * DIRECT-PROVIDER FALLBACK. This deployment may have no BluGate account. When
 * BLUGATE_API_KEY / BLUGATE_CLIENT_CODE are not both set, every platform call is
 * sent straight to the provider BluGate would have fronted, using the keys in
 * .env. BluGate mirrors each provider's own paths and params, so only the base
 * URL and auth change:
 *   twitter   → RapidAPI twitter241        RAPIDAPI_TWITTER_KEY | RAPIDAPI_X_KEY | RAPIDAPI_KEY
 *   facebook  → RapidAPI facebook-scraper3 RAPIDAPI_FACEBOOK_KEY(S) | RAPIDAPI_KEY
 *   instagram → RapidAPI instagram120      RAPIDAPI_INSTAGRAM_KEY(S) | RAPIDAPI_KEY
 *   youtube   → YouTube Data API v3        YOUTUBE_API_KEY (sent as ?key=)
 * Hosts can be overridden with RAPIDAPI_<PLATFORM>_HOST. A configured BluGate
 * account always wins.
 */
const firstEnv = (...names) => {
    for (const name of names) {
        const raw = process.env[name];
        const value = raw ? String(raw).split(',')[0].trim() : '';
        if (value) return value;
    }
    return '';
};

const DIRECT = {
    twitter: {
        host: () => firstEnv('RAPIDAPI_TWITTER_HOST', 'RAPIDAPI_X_HOST', 'RAPIDAPI_HOST') || 'twitter241.p.rapidapi.com',
        key: () => firstEnv('RAPIDAPI_TWITTER_KEY', 'RAPIDAPI_X_KEY', 'RAPIDAPI_KEY'),
    },
    facebook: {
        host: () => firstEnv('RAPIDAPI_FACEBOOK_HOST') || 'facebook-scraper3.p.rapidapi.com',
        key: () => firstEnv('RAPIDAPI_FACEBOOK_KEY', 'RAPIDAPI_FACEBOOK_KEYS', 'RAPIDAPI_KEY'),
    },
    instagram: {
        host: () => firstEnv('RAPIDAPI_INSTAGRAM_HOST') || 'instagram120.p.rapidapi.com',
        key: () => firstEnv('RAPIDAPI_INSTAGRAM_KEY', 'RAPIDAPI_INSTAGRAM_KEYS', 'RAPIDAPI_KEY'),
    },
    youtube: {
        base: 'https://www.googleapis.com/youtube/v3',
        key: () => firstEnv('YOUTUBE_API_KEY'),
    },
};

/** True when `platform` can be reached: via BluGate, or via its direct key. */
const hasDirectCredentials = (platform) => !!(DIRECT[platform] && DIRECT[platform].key());

/**
 * Can we fetch? With a platform: that platform is reachable (BluGate or its own
 * key). Without one: BluGate is configured, or any direct key is.
 */
const hasCredentials = (platform) => {
    if (hasGatewayCredentials()) return true;
    if (platform) return hasDirectCredentials(platform);
    return Object.keys(DIRECT).some(hasDirectCredentials);
};

/** Base URL for a platform: the BluGate route, or the provider's own host. */
const platformBase = (platform) => {
    if (hasGatewayCredentials()) return `${GATEWAY_BASE}/${platform}`;
    const direct = DIRECT[platform];
    if (!direct) throw new Error(`Unknown platform '${platform}'`);
    return direct.base || `https://${direct.host()}`;
};

const getHeaders = (platform) => {
    if (hasGatewayCredentials()) {
        return {
            Authorization: `Bearer ${process.env.BLUGATE_API_KEY}`,
            'x-client-id': process.env.BLUGATE_CLIENT_CODE
        };
    }

    const direct = DIRECT[platform];
    if (!direct) {
        throw new Error('BLUGATE_API_KEY / BLUGATE_CLIENT_CODE is not configured, and no platform was given for the direct-key fallback');
    }
    const key = direct.key();
    if (!key) {
        throw new Error(`No credentials for ${platform}: set BLUGATE_API_KEY + BLUGATE_CLIENT_CODE, or the direct key for ${platform} in .env`);
    }
    // YouTube's key travels as a query param (see authParams), not a header.
    if (direct.base) return {};
    return { 'x-rapidapi-key': key, 'x-rapidapi-host': direct.host() };
};

/** Query params the direct provider needs for auth (YouTube only); {} on BluGate. */
const authParams = (platform) => {
    if (hasGatewayCredentials()) return {};
    const direct = DIRECT[platform];
    return direct && direct.base && direct.key() ? { key: direct.key() } : {};
};

/**
 * Drop null / undefined / empty-string / NaN values so BluGate never receives
 * blank params (axios would otherwise send `count=NaN` or silently omit a
 * required param that resolved to null).
 */
const cleanParams = (params) => {
    if (!params || typeof params !== 'object') return undefined;
    const out = {};
    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'string' && value.trim() === '') continue;
        if (typeof value === 'number' && !Number.isFinite(value)) continue;
        out[key] = value;
    }
    return out;
};

/**
 * BluGate labels responses `Content-Encoding: gzip` even when the body is
 * plain JSON, and axios then fails every call with "incorrect header check".
 * So we take the raw bytes and decompress only when the body really is
 * compressed (gzip magic 1f 8b; zlib 78 xx; brotli when labelled and valid),
 * then decode UTF-8 ourselves and parse JSON. Used by EVERY BluGate call —
 * spread `...blugateClient.responseOptions()` into the axios config.
 */
const decodeBody = (data, headers) => {
    let buf = data;
    if (buf instanceof ArrayBuffer) buf = Buffer.from(buf);
    if (!Buffer.isBuffer(buf)) return data;

    const encoding = String((headers && (headers['content-encoding'] || (headers.get && headers.get('content-encoding')))) || '').toLowerCase();
    try {
        if (buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
        else if (buf.length > 1 && buf[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(buf[1])) buf = zlib.inflateSync(buf);
        else if (encoding.includes('br') && buf[0] !== 0x7b && buf[0] !== 0x5b) buf = zlib.brotliDecompressSync(buf);
    } catch (_) { /* not actually compressed: use the bytes as they are */ }

    const text = buf.toString('utf8');
    try { return JSON.parse(text); } catch (_) { return text; }
};

const responseOptions = () => ({
    decompress: false,
    responseType: 'arraybuffer',
    transformResponse: [decodeBody],
});

/**
 * BluGate throttles bursts with 429 {"error":"Too many gateway requests",
 * "retryAfterSec":35} (and a Retry-After header). How long to wait, in ms.
 */
const retryAfterMs = (error, fallbackMs = 5000) => {
    const res = error && error.response;
    const header = res && res.headers && Number(res.headers['retry-after']);
    const body = res && res.data && Number(res.data.retryAfterSec);
    const sec = Number.isFinite(body) && body > 0 ? body : (Number.isFinite(header) && header > 0 ? header : null);
    return sec ? sec * 1000 : fallbackMs;
};

/**
 * A short-lived BluGate gateway throttle, worth waiting out. A provider quota
 * (e.g. Google's "Quota exceeded ... per day", also sent as 429) resets only
 * the next day, so it is NOT retried.
 */
const isRateLimited = (error) => {
    const res = error && error.response;
    if (!res || res.status !== 429) return false;
    const body = res.data || {};
    const message = String((body.error && body.error.message) || body.error || body.message || '');
    if (/quota exceeded|per day/i.test(message)) return false;
    return true;
};

/**
 * Run a BluGate call, and on 429 wait as long as BluGate asks (capped) and
 * retry. Waits longer than `maxWaitMs` are not slept through: the error is
 * rethrown so the caller's own cooldown / next scheduler tick handles it.
 */
const withRateLimitRetry = async (fn, { retries = 2, maxWaitMs = 60000, label = 'BluGate' } = {}) => {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await fn();
        } catch (error) {
            if (!isRateLimited(error) || attempt >= retries) throw error;
            const wait = retryAfterMs(error, 5000 * (attempt + 1));
            if (wait > maxWaitMs) throw error;
            console.warn(`[${label}] 429 rate limited, retrying in ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/${retries})`);
            await new Promise((r) => setTimeout(r, wait));
        }
    }
};

const request = async (platform, { method = 'get', path = '', params, data, headers = {}, timeout = 30000 } = {}) => {
    const cleanPath = String(path || '').replace(/^\/+/, '');
    return withRateLimitRetry(() => axios({
        method,
        url: `${platformBase(platform)}/${cleanPath}`,
        params: cleanParams({ ...params, ...authParams(platform) }),
        data,
        timeout,
        headers: { ...getHeaders(platform), ...headers },
        ...responseOptions(),
    }), { label: `BluGate ${platform}` });
};

const get = (platform, path, params, opts = {}) => request(platform, { method: 'get', path, params, ...opts });
const post = (platform, path, data, opts = {}) => request(platform, { method: 'post', path, data, ...opts });

module.exports = {
    retryAfterMs,
    isRateLimited,
    withRateLimitRetry,
    responseOptions,
    decodeBody,
    GATEWAY_BASE,
    hasCredentials,
    hasGatewayCredentials,
    platformBase,
    authParams,
    getHeaders,
    cleanParams,
    request,
    get,
    post
};
