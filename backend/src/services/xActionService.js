const { TwitterApi } = require('twitter-api-v2');
const { Scraper } = require('agent-twitter-client');
const { v4: uuidv4 } = require('uuid');
const XOAuthAccount = require('../models/XOAuthAccount');
const XBulkAction = require('../models/XBulkAction');
const Content = require('../models/Content');
const Alert = require('../models/Alert');
const Grievance = require('../models/Grievance');
const Source = require('../models/Source');
const { sourceScopeFilter, constituencyFilter, mergeFilter } = require('../middleware/scopeMiddleware');

// ── Scraper session cache (reuse logged-in scrapers per account) ───────────────
const scraperCache = new Map(); // username → Scraper instance

// ── OAuth helpers ──────────────────────────────────────────────────────────────

const getAppCredentials = () => {
    const apiKey = process.env.X_API_KEY || process.env.TWITTER_API_KEY;
    const apiSecret = process.env.X_API_SECRET || process.env.TWITTER_API_SECRET;
    if (!apiKey || !apiSecret) {
        throw new Error('X_API_KEY and X_API_SECRET must be set in .env for OAuth actions');
    }
    return { apiKey, apiSecret };
};

// In-memory store for OAuth request tokens (short-lived, cleared after callback/PIN use)
const oauthTokenStore = new Map();

/**
 * Step 1 (PIN/OOB flow): Generate the X OAuth URL using oob callback.
 * Works with Desktop app type — user gets a PIN on X to paste back.
 * Returns { oauthUrl, oauthToken }
 */
const initiateOAuthPin = async () => {
    const { apiKey, apiSecret } = getAppCredentials();
    const client = new TwitterApi({ appKey: apiKey, appSecret: apiSecret });
    const { url, oauth_token, oauth_token_secret } = await client.generateAuthLink('oob', {
        linkMode: 'authorize'
    });
    oauthTokenStore.set(oauth_token, oauth_token_secret);
    return { oauthUrl: url, oauthToken: oauth_token };
};

/**
 * Step 1 (Callback flow): Generate the X OAuth URL using a real callback URL.
 * Requires the X app to be set as "Web App" in developer portal.
 * Returns { oauthUrl, oauthToken }
 */
const initiateOAuth = async (callbackUrl) => {
    const { apiKey, apiSecret } = getAppCredentials();
    const client = new TwitterApi({ appKey: apiKey, appSecret: apiSecret });
    const { url, oauth_token, oauth_token_secret } = await client.generateAuthLink(callbackUrl, {
        linkMode: 'authorize'
    });
    oauthTokenStore.set(oauth_token, oauth_token_secret);
    return { oauthUrl: url, oauthToken: oauth_token };
};

/**
 * Step 2 (shared): Exchange a verifier/PIN for permanent tokens and save account to DB.
 */
const handleOAuthCallback = async (oauthToken, oauthVerifier, connectedBy) => {
    const { apiKey, apiSecret } = getAppCredentials();
    const oauthTokenSecret = oauthTokenStore.get(oauthToken);
    if (!oauthTokenSecret) throw new Error('OAuth session expired or invalid. Please try connecting again.');

    const tempClient = new TwitterApi({
        appKey: apiKey,
        appSecret: apiSecret,
        accessToken: oauthToken,
        accessSecret: oauthTokenSecret
    });

    const { client: authedClient, accessToken, accessSecret } = await tempClient.login(oauthVerifier);
    oauthTokenStore.delete(oauthToken);

    // Fetch the user's profile
    const me = await authedClient.v2.me({ 'user.fields': ['profile_image_url', 'name', 'username'] });

    const accountData = {
        username: me.data.username,
        display_name: me.data.name,
        x_user_id: me.data.id,
        profile_image_url: me.data.profile_image_url,
        access_token: accessToken,
        access_token_secret: accessSecret,
        status: 'active',
        connected_by: connectedBy
    };

    const account = await XOAuthAccount.findOneAndUpdate(
        { username: me.data.username },
        accountData,
        { upsert: true, new: true }
    );

    return account;
};

/**
 * Direct add: use Access Token + Secret from developer portal (no PIN flow).
 * Useful when you already have tokens from developer.twitter.com → Keys & Tokens.
 */
const addAccountDirect = async (accessToken, accessTokenSecret, connectedBy) => {
    const { apiKey, apiSecret } = getAppCredentials();
    const client = new TwitterApi({ appKey: apiKey, appSecret: apiSecret, accessToken, accessSecret: accessTokenSecret });
    const me = await client.v2.me({ 'user.fields': ['profile_image_url', 'name', 'username'] });

    const accountData = {
        username: me.data.username,
        display_name: me.data.name,
        x_user_id: me.data.id,
        profile_image_url: me.data.profile_image_url,
        access_token: accessToken,
        access_token_secret: accessTokenSecret,
        status: 'active',
        connected_by: connectedBy
    };

    return XOAuthAccount.findOneAndUpdate(
        { username: me.data.username },
        accountData,
        { upsert: true, new: true }
    );
};

/**
 * Login with username+password via agent-twitter-client (no API plan needed).
 * Saves cookies to DB so future actions reuse the session.
 */
const addAccountScraper = async (username, password, email, connectedBy) => {
    const scraper = new Scraper();
    // email is required by Twitter's login flow to pass the identity-confirmation step
    await scraper.login(username, password, email || undefined);

    if (!(await scraper.isLoggedIn())) {
        throw new Error('Login failed — check username and password');
    }

    const cookies = await scraper.getCookies();

    // getProfile can fail with code 34 on some accounts; treat it as optional
    let profile = null;
    try {
        profile = await scraper.getProfile(username);
    } catch (profileErr) {
        console.warn(`[XAction] getProfile failed for @${username} (non-fatal):`, profileErr.message);
    }

    const accountData = {
        display_name: profile?.name || username,
        username: profile?.username || username,
        x_user_id: profile?.userId || '',
        profile_image_url: profile?.avatar || '',
        scraper_cookies: cookies,
        auth_method: 'scraper',
        status: 'active',
        connected_by: connectedBy,
        access_token: 'scraper',
        access_token_secret: 'scraper'
    };

    const account = await XOAuthAccount.findOneAndUpdate(
        { username: accountData.username },
        accountData,
        { upsert: true, new: true }
    );

    // cache the scraper
    scraperCache.set(account.username, scraper);
    return account;
};

/**
 * Get (or restore) a logged-in Scraper for the given account.
 */
const getScraperForAccount = async (accountUsername) => {
    // Return cached scraper if available
    if (scraperCache.has(accountUsername)) {
        return scraperCache.get(accountUsername);
    }

    const account = await XOAuthAccount.findOne({ username: accountUsername, status: 'active' });
    if (!account) throw new Error(`X account @${accountUsername} not found or not active`);
    if (!account.scraper_cookies) throw new Error(`@${accountUsername} has no scraper session. Use Cookie Login to connect.`);

    const scraper = new Scraper();
    // Normalize to strings — old records may have stored tough-cookie POJOs
    const cookieStrings = cookiesToStrings(account.scraper_cookies);
    await scraper.setCookies(cookieStrings);
    // Best-effort guest token fetch — write endpoints include it in headers but
    // authenticated users may not need it; silently skip if the bearer token fails
    try { await scraper.auth.updateGuestToken(); } catch (e) {
        console.warn('[XAction] updateGuestToken failed on restore (non-fatal):', e.message);
    }

    scraperCache.set(accountUsername, scraper);
    return scraper;
};

// ── Post fetching with filters ─────────────────────────────────────────────────

/**
 * Fetch X posts from DB with filter options.
 * Filters: sentiment, keyword, dateFrom, dateTo, riskLevel, handle
 *
 * RBAC row-level scope: `scope` (req.scope from scopeMiddleware) clamps
 * results for scoped MLA/MP/NL users so bulk-select can't reach statewide
 * content. Content/Alert carry no constituency field of their own — same
 * as contentController.applyContentScope — so visibility is inherited from
 * the Source (X handle) they were scraped from via source_id. Grievances
 * carry their own detected_location.constituency, scoped the same way
 * grievanceController does. No-op for super-admins / unscoped legacy roles.
 */
const getFilteredPosts = async ({ sentiment, keyword, dateFrom, dateTo, riskLevel, handle, source, limit = 50, page = 1, scope }) => {
    const skip = (page - 1) * limit;

    let allowedSourceIds = null; // null = unscoped (canSeeAll / no scope passed)
    if (scope && !scope.canSeeAll) {
        const allowedSources = await Source.find({ platform: 'x', ...sourceScopeFilter(scope) }).select('id').lean();
        allowedSourceIds = allowedSources.map(s => s.id);
        if (allowedSourceIds.length === 0) allowedSourceIds = ['__none__'];
    }

    // ── ALERTS: pre-resolve sentiment from Content (same approach as alertController)
    // then query Alert collection and join Content only for display fields ──────
    if (source === 'alerts') {
        const alertMatch = { platform: 'x' };
        if (allowedSourceIds) alertMatch.source_id = { $in: allowedSourceIds };
        if (riskLevel && riskLevel !== 'all') alertMatch.risk_level = riskLevel;
        if (handle) alertMatch.author_handle = { $regex: handle, $options: 'i' };
        if (dateFrom || dateTo) {
            alertMatch.created_at = {};
            if (dateFrom) alertMatch.created_at.$gte = new Date(dateFrom);
            if (dateTo)   alertMatch.created_at.$lte  = new Date(dateTo);
        }

        // Pre-resolve sentiment → Content.id list (avoids losing alerts whose content
        // was deleted or whose content_id format differs — same pattern alertController uses)
        if (sentiment && sentiment !== 'all') {
            const contentWithSentiment = await Content.find(
                { platform: 'x', sentiment },
                { id: 1, _id: 0 }
            ).lean();
            const ids = contentWithSentiment.map(c => c.id);
            if (ids.length === 0) return { posts: [], total: 0, page, limit };
            alertMatch.content_id = { $in: ids };
        }

        // Pre-resolve keyword → match against Alert fields + Content text
        if (keyword) {
            const kwContents = await Content.find(
                { platform: 'x', text: { $regex: keyword, $options: 'i' } },
                { id: 1, _id: 0 }
            ).lean();
            const kwIds = kwContents.map(c => c.id);
            const kwOr = [
                { description: { $regex: keyword, $options: 'i' } },
                { title:       { $regex: keyword, $options: 'i' } }
            ];
            if (kwIds.length > 0) kwOr.push({ content_id: { $in: kwIds } });
            alertMatch.$or = kwOr;
        }

        // Join Content only for display fields (text, sentiment, engagement, published_at)
        const pipeline = [
            { $match: alertMatch },
            {
                $lookup: {
                    from: 'contents',
                    localField: 'content_id',
                    foreignField: 'id',
                    as: '_c'
                }
            },
            { $addFields: { _c: { $arrayElemAt: ['$_c', 0] } } },
            {
                $project: {
                    _id: 0,
                    content_id:   { $ifNull: ['$_c.content_id', null] },
                    content_url:  '$content_url',
                    text:         { $ifNull: ['$_c.text', '$description'] },
                    sentiment:    { $ifNull: ['$_c.sentiment', 'neutral'] },
                    risk_level:   '$risk_level',
                    risk_score:   { $ifNull: ['$threat_details.risk_score', 0] },
                    published_at: { $ifNull: ['$_c.published_at', '$created_at'] },
                    engagement:   { $ifNull: ['$_c.engagement', {}] },
                    author:       '$author',
                    author_handle: { $ifNull: ['$author_handle', '$_c.author_handle'] }
                }
            }
        ];

        const [posts, countResult] = await Promise.all([
            Alert.aggregate([...pipeline, { $sort: { published_at: -1 } }, { $skip: skip }, { $limit: limit }]),
            Alert.aggregate([{ $match: alertMatch }, { $count: 'n' }])
        ]);

        return { posts, total: countResult[0]?.n || 0, page, limit };
    }

    // ── GRIEVANCES: query Grievance collection, use inline content ──────────────
    if (source === 'grievances') {
        const gMatch = {
            platform: 'x',
            is_active: true,
            // Exclude alert-promoted grievances (tweet_id = "alert:<uuid>") — no real tweet ID for actions
            tweet_id: { $not: /^alert:/ }
        };
        if (sentiment && sentiment !== 'all') gMatch['analysis.sentiment'] = sentiment;
        if (riskLevel && riskLevel !== 'all') gMatch['analysis.risk_level'] = riskLevel;
        if (handle)  gMatch['posted_by.handle'] = { $regex: handle,  $options: 'i' };
        if (keyword) gMatch['$or'] = [
            { 'content.text':      { $regex: keyword, $options: 'i' } },
            { 'content.full_text': { $regex: keyword, $options: 'i' } }
        ];
        if (dateFrom || dateTo) {
            gMatch.post_date = {};
            if (dateFrom) gMatch.post_date.$gte = new Date(dateFrom);
            if (dateTo)   gMatch.post_date.$lte  = new Date(dateTo);
        }
        if (scope && !scope.canSeeAll) {
            mergeFilter(gMatch, constituencyFilter(scope, { extraFields: ['routing_targets.constituencies'] }));
        }

        const [rawDocs, total] = await Promise.all([
            Grievance.find(gMatch).sort({ post_date: -1 }).skip(skip).limit(limit).lean(),
            Grievance.countDocuments(gMatch)
        ]);

        const posts = rawDocs.map(g => ({
            content_id:   g.tweet_id,
            content_url:  g.tweet_url,
            text:         g.content?.full_text || g.content?.text || '',
            sentiment:    g.analysis?.sentiment  || 'neutral',
            risk_level:   g.analysis?.risk_level || 'low',
            risk_score:   g.analysis?.risk_score  || 0,
            published_at: g.post_date,
            engagement: {
                views:    g.engagement?.views    || 0,
                retweets: g.engagement?.retweets || 0,
                comments: g.engagement?.replies  || 0,
                likes:    g.engagement?.likes    || 0
            },
            author:        g.posted_by?.display_name || '',
            author_handle: g.posted_by?.handle       || '—'
        }));

        return { posts, total, page, limit };
    }

    // ── ALL POSTS: union of Content + Grievances ────────────────────────────────
    // Content and Grievances are separate collections — both must be queried.
    const contentMatch = { platform: 'x' };
    if (allowedSourceIds) contentMatch.source_id = { $in: allowedSourceIds };
    if (sentiment && sentiment !== 'all') contentMatch.sentiment = sentiment;
    if (riskLevel && riskLevel !== 'all') contentMatch.risk_level = riskLevel;
    if (handle)  contentMatch['raw_data.handle'] = { $regex: handle,  $options: 'i' };
    if (keyword) contentMatch.text               = { $regex: keyword, $options: 'i' };
    if (dateFrom || dateTo) {
        contentMatch.published_at = {};
        if (dateFrom) contentMatch.published_at.$gte = new Date(dateFrom);
        if (dateTo)   contentMatch.published_at.$lte  = new Date(dateTo);
    }

    const grievanceMatch = {
        platform: 'x',
        is_active: true,
        tweet_id: { $not: /^alert:/ }
    };
    if (sentiment && sentiment !== 'all') grievanceMatch['analysis.sentiment'] = sentiment;
    if (riskLevel && riskLevel !== 'all') grievanceMatch['analysis.risk_level'] = riskLevel;
    if (handle)  grievanceMatch['posted_by.handle'] = { $regex: handle,  $options: 'i' };
    if (keyword) grievanceMatch['$or'] = [
        { 'content.text':      { $regex: keyword, $options: 'i' } },
        { 'content.full_text': { $regex: keyword, $options: 'i' } }
    ];
    if (dateFrom || dateTo) {
        grievanceMatch.post_date = {};
        if (dateFrom) grievanceMatch.post_date.$gte = new Date(dateFrom);
        if (dateTo)   grievanceMatch.post_date.$lte  = new Date(dateTo);
    }
    if (scope && !scope.canSeeAll) {
        mergeFilter(grievanceMatch, constituencyFilter(scope, { extraFields: ['routing_targets.constituencies'] }));
    }

    const contentProjection = {
        content_id:   '$content_id',
        content_url:  '$content_url',
        text:         '$text',
        sentiment:    '$sentiment',
        risk_level:   '$risk_level',
        risk_score:   '$risk_score',
        published_at: '$published_at',
        engagement:   '$engagement',
        author:       '$author',
        author_handle: '$author_handle'
    };

    const grievancePipeline = [
        { $match: grievanceMatch },
        {
            $project: {
                content_id:   '$tweet_id',
                content_url:  '$tweet_url',
                text:         { $ifNull: ['$content.full_text', '$content.text'] },
                sentiment:    { $ifNull: ['$analysis.sentiment',  'neutral'] },
                risk_level:   { $ifNull: ['$analysis.risk_level', 'low'] },
                risk_score:   { $ifNull: ['$analysis.risk_score',  0] },
                published_at: '$post_date',
                engagement: {
                    views:    '$engagement.views',
                    retweets: '$engagement.retweets',
                    comments: '$engagement.replies',
                    likes:    '$engagement.likes'
                },
                author:        '$posted_by.display_name',
                author_handle: '$posted_by.handle'
            }
        }
    ];

    const unionPipeline = [
        { $match: contentMatch },
        { $project: contentProjection },
        { $unionWith: { coll: 'grievances', pipeline: grievancePipeline } },
        { $sort: { published_at: -1 } }
    ];

    const [posts, countResult] = await Promise.all([
        Content.aggregate([...unionPipeline, { $skip: skip }, { $limit: limit }]),
        Content.aggregate([...unionPipeline, { $count: 'n' }])
    ]);

    return { posts, total: countResult[0]?.n || 0, page, limit };
};

/**
 * Parse a Netscape/curl cookie file (tab-separated) into cookie strings
 * that tough-cookie / agent-twitter-client accept.
 */
const parseNetscapeCookies = (text) => {
    const result = [];
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const parts = t.split('\t');
        if (parts.length < 7) continue;
        const [rawDomain, , path, secure, , name, value] = parts;
        // agent-twitter-client uses https://twitter.com as the jar URL;
        // remap x.com → twitter.com so tough-cookie domain validation passes
        const domain = rawDomain.replace(/x\.com$/, 'twitter.com');
        const attrs = [`${name}=${value}`, `Domain=${domain}`, `Path=${path}`];
        if (secure === 'TRUE') attrs.push('Secure');
        result.push(attrs.join('; '));
    }
    return result;
};

/**
 * Convert saved cookie records (tough-cookie POJOs from MongoDB) back to strings.
 * We always STORE strings; this handles old records that stored objects.
 */
const cookiesToStrings = (cookies) => {
    if (!Array.isArray(cookies) || cookies.length === 0) return [];
    if (typeof cookies[0] === 'string') return cookies;
    // POJO format from old records
    return cookies.map(c => {
        const parts = [`${c.key || c.name}=${c.value}`];
        if (c.domain) parts.push(`Domain=${c.domain}`);
        if (c.path) parts.push(`Path=${c.path}`);
        if (c.secure) parts.push('Secure');
        return parts.join('; ');
    });
};

/**
 * Cookie-based login: bypass the broken username/password login flow entirely.
 * Accepts the full Netscape cookie file text (exported from browser).
 */
const addAccountCookies = async (username, cookieFileText, connectedBy) => {
    if (!cookieFileText) throw new Error('Cookie file content is required');

    const cookieStrings = parseNetscapeCookies(cookieFileText);
    if (cookieStrings.length === 0) throw new Error('No valid cookies found — paste the full cookie file content');

    const scraper = new Scraper();
    await scraper.setCookies(cookieStrings);

    // Verify auth_token is present — check the original strings (no OAuth needed)
    const hasAuthToken = cookieStrings.some(s => s.startsWith('auth_token='));
    if (!hasAuthToken) {
        throw new Error('auth_token cookie not found — make sure you pasted the full cookie file content');
    }

    // Attempt to get a guest token (best-effort — may fail if bearer token is rejected)
    try { await scraper.auth.updateGuestToken(); } catch (e) {
        console.warn('[XAction] updateGuestToken failed (non-fatal):', e.message);
    }

    // Store the cookie strings (not tough-cookie objects) so MongoDB can restore them as-is
    const savedCookies = cookieStrings;

    let profile = null;
    try {
        profile = await scraper.getProfile(username);
    } catch (e) {
        console.warn(`[XAction] getProfile failed for @${username}:`, e.message);
    }

    const accountData = {
        display_name: profile?.name || username,
        username: profile?.username || username,
        x_user_id: profile?.userId || '',
        profile_image_url: profile?.avatar || '',
        scraper_cookies: savedCookies,
        auth_method: 'scraper',
        status: 'active',
        connected_by: connectedBy,
        access_token: 'scraper',
        access_token_secret: 'scraper'
    };

    const account = await XOAuthAccount.findOneAndUpdate(
        { username: accountData.username },
        accountData,
        { upsert: true, new: true }
    );

    scraperCache.set(account.username, scraper);
    return account;
};

// ── Direct Twitter GraphQL write functions (bypasses agent-twitter-client auth) ──
// The library's hardcoded bearer token is rejected; we make raw requests instead.

// Well-known Twitter web-app bearer token used by browser clients
const TW_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const extractCookieValue = (cookieStrings, name) => {
    for (const cs of cookieStrings) {
        const m = cs.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
        if (m) return m[1];
    }
    return null;
};

const twitterPost = async (cookieStrings, url, body) => {
    const authToken = extractCookieValue(cookieStrings, 'auth_token');
    const ct0       = extractCookieValue(cookieStrings, 'ct0');
    if (!authToken) throw new Error('auth_token missing from stored cookies');
    if (!ct0)       throw new Error('ct0 (CSRF) missing from stored cookies');

    // Build a flat cookie header string (name=value pairs only)
    const cookieHeader = cookieStrings.map(s => s.split(';')[0].trim()).join('; ');

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization':          `Bearer ${TW_BEARER}`,
            'Cookie':                 cookieHeader,
            'Content-Type':           'application/json',
            'x-csrf-token':           ct0,
            'x-twitter-auth-type':    'OAuth2Session',
            'x-twitter-active-user':  'yes',
            'x-twitter-client-language': 'en',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(text);
    return JSON.parse(text);
};

/**
 * Upload one media file to Twitter using the chunked upload API (INIT→APPEND→FINALIZE).
 * Works for images (jpg/png/gif/webp) and short videos (mp4).
 * Returns the media_id_string to include in the tweet.
 */
const uploadMediaToTwitter = async (cookieStrings, buffer, mimeType) => {
    const ct0 = extractCookieValue(cookieStrings, 'ct0');
    const cookieHeader = cookieStrings.map(s => s.split(';')[0].trim()).join('; ');
    const baseHeaders = {
        'Authorization':         `Bearer ${TW_BEARER}`,
        'Cookie':                cookieHeader,
        'x-csrf-token':          ct0,
        'x-twitter-auth-type':   'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };
    const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';

    // INIT
    const initForm = new URLSearchParams({ command: 'INIT', total_bytes: buffer.length, media_type: mimeType });
    const initRes  = await fetch(uploadUrl, { method: 'POST', headers: { ...baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded' }, body: initForm });
    const initJson = await initRes.json();
    if (!initRes.ok) throw new Error(`Media INIT failed: ${JSON.stringify(initJson)}`);
    const mediaId = initJson.media_id_string;

    // APPEND — split into 1 MB chunks
    const CHUNK = 1024 * 1024;
    for (let i = 0, seg = 0; i < buffer.length; i += CHUNK, seg++) {
        const chunk = buffer.slice(i, i + CHUNK);
        const fd = new FormData();
        fd.append('command', 'APPEND');
        fd.append('media_id', mediaId);
        fd.append('segment_index', String(seg));
        fd.append('media', new Blob([chunk], { type: mimeType }), 'media');
        const appendRes = await fetch(uploadUrl, { method: 'POST', headers: baseHeaders, body: fd });
        if (!appendRes.ok) throw new Error(`Media APPEND failed at segment ${seg}`);
    }

    // FINALIZE
    const finalForm = new URLSearchParams({ command: 'FINALIZE', media_id: mediaId });
    const finalRes  = await fetch(uploadUrl, { method: 'POST', headers: { ...baseHeaders, 'Content-Type': 'application/x-www-form-urlencoded' }, body: finalForm });
    const finalJson = await finalRes.json();
    if (!finalRes.ok) throw new Error(`Media FINALIZE failed: ${JSON.stringify(finalJson)}`);

    return mediaId;
};

const TW_FEATURES = {
    interactive_text_enabled: true,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_text_conversations_enabled: false,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
    vibe_api_enabled: false,
    rweb_lists_timeline_redesign_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    longform_notetweets_rich_text_read_enabled: true,
    responsive_web_enhance_cards_enabled: false,
    subscriptions_verification_info_enabled: true,
    subscriptions_verification_info_reason_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true,
    super_follow_badge_privacy_enabled: false,
    super_follow_exclusive_tweet_notifications_enabled: false,
    super_follow_tweet_api_enabled: false,
    super_follow_user_api_enabled: false,
    android_graphql_skip_api_media_color_palette: false,
    creator_subscriptions_subscription_count_enabled: false,
    blue_business_profile_image_shape_enabled: false,
    unified_cards_ad_metadata_container_dynamic_card_content_query_enabled: false,
    rweb_video_timestamps_enabled: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: false,
};

// Returns the new tweet's rest_id so we can build a direct URL to it
const retweetPost = async (cookieStrings, tweetId) => {
    const json = await twitterPost(
        cookieStrings,
        'https://twitter.com/i/api/graphql/ojPdsZsimiJrUGLR1sjUtA/CreateRetweet',
        { variables: { tweet_id: tweetId, dark_request: false } }
    );
    return json?.data?.create_retweet?.retweet_results?.result?.rest_id || null;
};

const replyToPost = async (cookieStrings, tweetId, text, mediaBuffers = [], mediaMimeTypes = []) => {
    // Upload any attached media first and collect their IDs
    const mediaIds = [];
    for (let i = 0; i < mediaBuffers.length; i++) {
        const id = await uploadMediaToTwitter(cookieStrings, mediaBuffers[i], mediaMimeTypes[i] || 'image/jpeg');
        mediaIds.push(id);
    }

    const json = await twitterPost(
        cookieStrings,
        'https://twitter.com/i/api/graphql/a1p9RWpkYKBjWv_I3WzS-A/CreateTweet',
        {
            variables: {
                tweet_text: text,
                reply: { in_reply_to_tweet_id: tweetId, exclude_reply_user_ids: [] },
                dark_request: false,
                media: {
                    media_entities: mediaIds.map(id => ({ media_id: id, tagged_users: [] })),
                    possibly_sensitive: false,
                },
                semantic_annotation_ids: [],
            },
            features: TW_FEATURES,
            fieldToggles: {},
        }
    );
    return json?.data?.create_tweet?.tweet_results?.result?.rest_id || null;
};

// ── Bulk action executor ───────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Human-like random delay between actions.
 * Fixed intervals are a bot signal; random range mimics natural pacing.
 * Range: 28–55 seconds with jitter.
 */
const humanDelay = async () => {
    const base = 28000 + Math.floor(Math.random() * 27000); // 28s–55s
    const jitter = Math.floor(Math.random() * 3000);         // 0–3s extra jitter
    await sleep(base + jitter);
};

/**
 * Execute a bulk action across multiple tweets.
 * @param {Object} options
 * @param {string} options.accountUsername - @handle of the account to act from
 * @param {string} options.actionType - 'retweet' | 'reply'
 * @param {string[]} options.tweetIds - list of tweet IDs
 * @param {string} [options.replyText] - text for reply (required if actionType === 'reply')
 * @param {Buffer[]} [options.mediaBuffers] - uploaded media buffers
 * @param {string[]} [options.mediaMimeTypes] - mime types for each buffer
 * @param {string} options.executedBy - user email
 * @returns {Object} summary { batchId, total, success, failed, results }
 */
const executeBulkAction = async ({
    accountUsername,
    actionType,
    tweetIds,
    replyText,
    mediaBuffers = [],
    mediaMimeTypes = [],
    tweetUrls = {},
    tweetTexts = {},
    executedBy
}) => {
    const batchId = uuidv4();
    // Load cookies directly from DB — we use raw fetch instead of the scraper library
    const account = await XOAuthAccount.findOne({ username: accountUsername, status: 'active' });
    if (!account) throw new Error(`X account @${accountUsername} not found or not active`);
    if (!account.scraper_cookies) throw new Error(`@${accountUsername} has no cookie session. Use Cookie Login to connect.`);
    const cookieStrings = cookiesToStrings(account.scraper_cookies);

    const results = [];
    let successCount = 0;
    let failedCount = 0;

    for (const tweetId of tweetIds) {
        const actionDoc = {
            batch_id: batchId,
            action_type: actionType,
            account_username: accountUsername,
            tweet_id: tweetId,
            tweet_url: tweetUrls[tweetId] || `https://x.com/i/status/${tweetId}`,
            tweet_text: tweetTexts[tweetId] || '',
            reply_text: replyText,
            media_urls: [],
            status: 'pending',
            executed_by: executedBy,
            executed_at: new Date()
        };

        try {
            let createdId = null;
            if (actionType === 'retweet') {
                createdId = await retweetPost(cookieStrings, tweetId);
            } else if (actionType === 'reply') {
                if (!replyText || replyText.trim() === '') throw new Error('Reply text is required');
                createdId = await replyToPost(cookieStrings, tweetId, replyText, mediaBuffers, mediaMimeTypes);
            }

            // Store direct link to the created tweet/retweet so history links go there
            if (createdId) {
                actionDoc.created_tweet_id = createdId;
                actionDoc.created_tweet_url = `https://x.com/${accountUsername}/status/${createdId}`;
            }

            actionDoc.status = 'success';
            successCount++;
        } catch (err) {
            actionDoc.status = 'failed';
            actionDoc.error_message = err.message;
            failedCount++;
            console.error(`[XAction] Failed on tweet ${tweetId}:`, err.message);
        }

        await XBulkAction.create(actionDoc);
        results.push({ tweetId, status: actionDoc.status, error: actionDoc.error_message });

        // Human-like random delay between actions (28–58s) — fixed intervals flag as bot
        if (tweetIds.indexOf(tweetId) < tweetIds.length - 1) {
            await humanDelay();
        }
    }

    // Update account last_used_at
    await XOAuthAccount.findOneAndUpdate(
        { username: accountUsername },
        { last_used_at: new Date() }
    );

    return { batchId, total: tweetIds.length, success: successCount, failed: failedCount, results };
};

/**
 * Execute a bulk action across multiple accounts sequentially.
 * Each account processes all selected tweets with human delays between tweets.
 * A human delay is also added between accounts.
 */
const executeBulkActionMulti = async ({
    accountUsernames,
    actionType,
    tweetIds,
    replyText,
    mediaBuffers = [],
    mediaMimeTypes = [],
    tweetUrls = {},
    tweetTexts = {},
    executedBy
}) => {
    const overallBatchId = uuidv4();
    const perAccountResults = [];
    let totalSuccess = 0;
    let totalFailed = 0;

    for (let i = 0; i < accountUsernames.length; i++) {
        const accountUsername = accountUsernames[i];
        try {
            const result = await executeBulkAction({
                accountUsername,
                actionType,
                tweetIds,
                replyText,
                mediaBuffers,
                mediaMimeTypes,
                tweetUrls,
                tweetTexts,
                executedBy
            });
            totalSuccess += result.success;
            totalFailed += result.failed;
            perAccountResults.push({ accountUsername, ...result });
        } catch (err) {
            totalFailed += tweetIds.length;
            perAccountResults.push({
                accountUsername,
                batchId: null,
                total: tweetIds.length,
                success: 0,
                failed: tweetIds.length,
                error: err.message,
                results: tweetIds.map(id => ({ tweetId: id, status: 'failed', error: err.message }))
            });
        }
        if (i < accountUsernames.length - 1) {
            await humanDelay();
        }
    }

    return {
        batchId: overallBatchId,
        total: tweetIds.length * accountUsernames.length,
        success: totalSuccess,
        failed: totalFailed,
        perAccount: perAccountResults,
        results: perAccountResults.flatMap(r => r.results || [])
    };
};

const deletePost = async (contentId) => {
    const content = await Content.findOne({ content_id: contentId });

    if (content) {
        // Alert.content_id = Content.id (UUID) — NOT the tweet ID
        await Alert.deleteMany({ content_id: content.id });
        // Hard-delete any grievances whose tweet_id matches this tweet ID
        await Grievance.deleteMany({ tweet_id: contentId });
        await Content.deleteOne({ content_id: contentId });
    } else {
        // No Content found — treat contentId as a Grievance.tweet_id (standalone grievance)
        const grievance = await Grievance.findOne({ tweet_id: contentId });
        if (!grievance) throw new Error('Post not found');
        // Also delete any alerts that were promoted from this grievance
        await Alert.deleteMany({ content_id: grievance.id });
        await Grievance.deleteOne({ tweet_id: contentId });
    }
};

const updatePost = async (contentId, { text, sentiment, risk_level }) => {
    const update = {};
    if (text !== undefined) update.text = text;
    if (sentiment !== undefined) update.sentiment = sentiment;
    if (risk_level !== undefined) update.risk_level = risk_level;
    const doc = await Content.findOneAndUpdate({ content_id: contentId }, { $set: update }, { new: true });
    if (!doc) throw new Error('Post not found');
    return doc;
};

// ── Account management ─────────────────────────────────────────────────────────

const listAccounts = async () => {
    return XOAuthAccount.find().select('-access_token -access_token_secret').sort({ created_at: -1 });
};

const removeAccount = async (username) => {
    return XOAuthAccount.findOneAndDelete({ username });
};

const getActionHistory = async ({ batchId, accountUsername, page = 1, limit = 50 }) => {
    const query = {};
    if (batchId) query.batch_id = batchId;
    if (accountUsername) query.account_username = accountUsername;

    const skip = (page - 1) * limit;
    const [actions, total] = await Promise.all([
        XBulkAction.find(query).sort({ created_at: -1 }).skip(skip).limit(limit),
        XBulkAction.countDocuments(query)
    ]);

    return { actions, total, page, limit };
};

module.exports = {
    initiateOAuth,
    initiateOAuthPin,
    handleOAuthCallback,
    addAccountDirect,
    addAccountScraper,
    addAccountCookies,
    getFilteredPosts,
    deletePost,
    updatePost,
    executeBulkAction,
    executeBulkActionMulti,
    listAccounts,
    removeAccount,
    getActionHistory
};
