const axios = require('axios');
const { responseLooksDoubleEncoded } = require('../utils/textEncoding');
const blugateClient = require('./blugateClient');

const TWITTER_BASE = `${blugateClient.GATEWAY_BASE}/twitter`;

// Every twitter241 route BluGate exposes, with its required query params
// (from BluGate_Provider_Endpoints.xlsx). Anything not listed here does not
// exist on BluGate and would 404.
const X_ENDPOINT_REQUIRED_PARAMS = {
    'search-community': ['query'],
    'community-topics': [],
    'explore-community-timeline': [],
    'fetch-popular-community': [],
    'community-members': ['communityId'],
    'community-members-v2': ['communityId'],
    'community-moderators': ['communityId'],
    'community-tweets': ['communityId'],
    'community-about': ['communityId'],
    'community-details': ['communityId'],
    'likes': ['pid'],
    'user-likes': ['user', 'count'],
    'tweet': ['pid'],
    'get-users-v2': ['users'],
    'search': ['type', 'count', 'query'],
    'autocomplete': ['query'],
    'search-v2': ['type', 'count', 'query'],
    'search-v3': ['type', 'count', 'query'],
    'jobs-locations-suggest': ['query'],
    'jobs-search': ['query'],
    'job-details': ['id'],
    'search-lists': ['query'],
    'list-details': ['listId'],
    'list-timeline': ['listId'],
    'list-followers': ['listId'],
    'list-members': ['listId'],
    'org-affiliates': ['user'],
    'comments': ['pid'],
    'comments-v2': ['pid'],
    'quotes': ['pid'],
    'retweets': ['pid'],
    'tweet-v2': ['pid'],
    'tweet-by-ids': ['ids'],
    'tweet-by-ids-v2': ['ids'],
    'spaces': ['id'],
    'trends-locations': [],
    'trends-by-location': ['woeid'],
    'user': ['username'],
    'get-users': ['users'],
    'user-replies': ['user', 'count'],
    'user-replies-v2': ['user', 'count'],
    'user-media': ['user', 'count'],
    'user-tweets': ['user', 'count'],
    'followings': ['user', 'count'],
    'following-ids': ['username', 'count'],
    'followers': ['user', 'count'],
    'verified-followers': ['user', 'count'],
    'followers-ids': ['username', 'count'],
    'highlights': ['user'],
    'about-account': ['username']
};

const isKnownXEndpoint = (endpoint) =>
    Object.prototype.hasOwnProperty.call(X_ENDPOINT_REQUIRED_PARAMS, String(endpoint || '').replace(/^\/+/, ''));

/**
 * Strip blank params and verify the endpoint + required params against the
 * BluGate catalog. Throws (without making a request) instead of sending BluGate
 * a hit with null/missing params or to a route that doesn't exist.
 */
const prepareXRequest = (endpoint, params) => {
    const name = String(endpoint || '').replace(/^\/+/, '').split('?')[0];
    if (!isKnownXEndpoint(name)) {
        const err = new Error(`[BluGate X] Unknown endpoint '/${name}' — not in the BluGate twitter catalog`);
        err.code = 'BLUGATE_X_UNKNOWN_ENDPOINT';
        throw err;
    }

    const cleaned = blugateClient.cleanParams(params) || {};
    const missing = X_ENDPOINT_REQUIRED_PARAMS[name].filter(p => !(p in cleaned));
    if (missing.length > 0) {
        const err = new Error(`[BluGate X] /${name} missing required param(s): ${missing.join(', ')}`);
        err.code = 'BLUGATE_X_MISSING_PARAMS';
        throw err;
    }

    return { name, params: cleaned };
};

const rapidRequestX = async (config, retryCount = 0) => {
    const maxRetries = 2; // Allow up to 2 retries (3 attempts total)
    const baseDelay = 5000; // 5 seconds base delay for 429s

    const endpoint = String(config.url || '').startsWith(TWITTER_BASE)
        ? String(config.url).slice(TWITTER_BASE.length)
        : config.url;
    const { params } = prepareXRequest(endpoint, config.params);

    try {
        const response = await axios({
            ...config,
            params,
            headers: {
                ...config.headers,
                ...blugateClient.getHeaders()
            },
            timeout: 30000, // 30s timeout
            ...blugateClient.responseOptions(),
        });

        // The provider intermittently serves a response whose UTF-8 was decoded as
        // Windows-1252, mangling every non-ASCII string in it (Telugu posts arrive as
        // "à°µà°°à±�à°·..."). It cannot be repaired — Windows-1252 has no mapping for
        // 0x8D/0x8F/0x90, so the Telugu virama and friends are destroyed on arrival.
        // A retry normally comes back clean, so treat it like any other transient fault.
        if (responseLooksDoubleEncoded(response.data)) {
            if (retryCount < maxRetries) {
                console.warn(`[RapidAPI] ⚠️ Response is double-encoded (UTF-8 read as Windows-1252). Re-requesting... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, 1000));
                return rapidRequestX(config, retryCount + 1);
            }
            // Out of retries: let it through so metrics and media still update. The
            // preferCleanText() guards in the monitors keep already-stored clean text
            // from being overwritten by the mangled copy.
            console.error('[RapidAPI] ❌ Response still double-encoded after retries; existing text will be preserved by the write guards.');
        }

        return response;
    } catch (error) {
        const status = error.response?.status;
        const msg = String(error.response?.data?.message || error.response?.data?.error || error.message || '').toLowerCase();

        // 429 (Rate Limit) - Always retry with backoff
        if (status === 429 && retryCount < maxRetries) {
            // Honour BluGate's retryAfterSec / Retry-After; fall back to backoff.
            const delay = Math.min(60000, blugateClient.retryAfterMs(error, baseDelay * (retryCount + 1)));
            console.warn(`[RapidAPI] ⏳ Rate limited (429). Retrying in ${delay / 1000}s... (attempt ${retryCount + 1}/${maxRetries})`);
            await new Promise(r => setTimeout(r, delay));
            return rapidRequestX(config, retryCount + 1);
        }

        if (status !== 200) {
            console.error(`[RapidAPI] ❌ Request failed (${status}): ${msg}. Response Body:`, JSON.stringify(error.response?.data || 'No body'));
        }

        throw error;
    }
};

const rapidGet = async (path, params = {}) => {
    const cleanPath = String(path || '').replace(/^\/+/, '');
    const response = await rapidRequestX({
        method: 'get',
        url: `${TWITTER_BASE}/${cleanPath}`,
        params
    });
    return response.data;
};

const userIdCache = new Map();

const getTimelineInstructions = (data) => {
    return data?.result?.timeline?.instructions ||
        data?.timeline?.instructions ||
        data?.data?.user?.result?.timeline_response?.timeline?.instructions ||
        data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
        data?.data?.threaded_conversation_with_injections_v2?.instructions ||
        data?.data?.favoriters_timeline?.timeline?.instructions ||
        [];
};

const getTimelineEntries = (data) => {
    const instructions = getTimelineInstructions(data);
    const entries = [];
    for (const instruction of instructions) {
        if (Array.isArray(instruction?.entries)) {
            entries.push(...instruction.entries);
        }
        if (Array.isArray(instruction?.moduleItems)) {
            entries.push(...instruction.moduleItems);
        }
    }
    return entries;
};

const extractBottomCursor = (entries = []) => {
    for (const entry of entries) {
        const cursorType = entry?.content?.cursorType || entry?.cursorType;
        const value = entry?.content?.value || entry?.value;
        const entryId = entry?.entryId || entry?.entry_id || '';
        if ((cursorType === 'Bottom' || /cursor-bottom/i.test(String(entryId))) && value) {
            return value;
        }
    }
    return null;
};

const pickBestVideoVariant = (variants = []) => {
    if (!Array.isArray(variants) || variants.length === 0) return null;

    // Prefer HLS, then highest bitrate MP4
    let bestVariant = variants.find(v => v.content_type === 'application/x-mpegURL');
    if (!bestVariant) {
        bestVariant = variants
            .filter(v => v.content_type === 'video/mp4')
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    }
    return bestVariant || null;
};

// True when the URL points at a video stream/file rather than an image
// thumbnail. Used so we never store an HLS playlist or MP4 URL in the
// preview slot — the UI expects an image there.
const isVideoLikeUrl = (u) => typeof u === 'string' && /\.(mp4|m3u8|webm|mov|m4s)(\?|$)/i.test(u);

const getMediaUrlCandidates = (media) => {
    const primary = media?.media_url_https || media?.media_url || media?.url || media?.image_url || media?.image?.url;

    // Image-only candidates for the preview slot. Prefer fields explicitly
    // documented as thumbnails before falling back to media_url_https
    // (which can hold a video stream URL for video items on some RapidAPI
    // response shapes). Drop any candidate that looks like a video file.
    const previewRaw = [
        media?.preview_image_url,
        media?.thumbnail_url,
        media?.image_url,
        media?.image?.url,
        media?.media_url_https,
        media?.media_url,
        primary,
    ].filter((u) => u && !isVideoLikeUrl(u));

    return { primary, preview: previewRaw[0] || null };
};

const normalizeMediaItem = (media) => {
    if (!media) return null;

    let type = media.type || media.media_type || 'photo';
    const { primary, preview } = getMediaUrlCandidates(media);
    let url = primary;

    if (!type && media.video_info) type = 'video';

    if (media.type === 'video' || media.type === 'animated_gif' || type === 'video' || type === 'animated_gif') {
        type = media.type || type;

        const variant = pickBestVideoVariant(media.video_info?.variants || []);
        if (variant?.url) {
            url = variant.url;
        } else if (media.video_url) {
            url = media.video_url;
        } else if (media.player_stream_url) {
            url = media.player_stream_url;
        } else if (media.url && media.url !== primary) {
            url = media.url;
        }
    }

    if (!url) return null;

    // Emit both `preview` (legacy callers) and `preview_url` (the field name
    // the grievance pipeline persists). For videos we only set a preview if
    // we actually have an image — otherwise the UI falls back to first-frame
    // extraction via hls.js / <video> rather than rendering a broken poster.
    const isVideo = type === 'video' || type === 'animated_gif';
    const imagePreview = isVideoLikeUrl(preview) ? null : preview;
    const result = { type, url };
    if (imagePreview) {
        result.preview = imagePreview;
        result.preview_url = imagePreview;
    }
    if (isVideo) {
        result.video_url = url;
    }
    return result;
};

const fetchUserProfile = async (handle) => {
    try {
        const cleanHandle = handle.replace('@', '').trim();
        console.log(`[RapidAPI] Fetching profile for ${cleanHandle}...`);

        const userResponse = await rapidRequestX({
            method: 'get',
            url: `${TWITTER_BASE}/user`,
            params: { username: cleanHandle }
        });

        if (userResponse.data?.errors || userResponse.data?.error) {
            throw new Error(`RapidAPI Error: ${JSON.stringify(userResponse.data.errors || userResponse.data.error)}`);
        }

        let result = null;
        if (userResponse.data?.result?.data?.user?.result) {
            result = userResponse.data.result.data.user.result;
        } else if (userResponse.data?.data?.user?.result) {
            result = userResponse.data.data.user.result;
        } else if (userResponse.data?.result) {
            result = userResponse.data.result;
        }

        if (!result) return null;

        const userId = result.rest_id;
        const freshVerified = result.is_blue_verified || result.legacy?.verified || false;
        const freshImage = result.avatar?.image_url ||
            result.legacy?.profile_image_url_https ||
            result.profile_image_url_https;

        // Update cache
        if (userId) userIdCache.set(cleanHandle, userId);
        userIdCache.set(cleanHandle + '_meta', { isVerified: freshVerified, profileImageUrl: freshImage });

        return {
            id: userId,
            isVerified: freshVerified,
            profileImageUrl: freshImage,
            // X moved name/screen_name from `legacy` to `core`; read both.
            name: result.core?.name || result.legacy?.name,
            screenName: result.core?.screen_name || result.legacy?.screen_name
        };
    } catch (error) {
        console.warn(`[RapidAPI] Profile fetch failed for ${handle}:`, error.message);
        return null;
    }
};

const fetchUserTweets = async (handle, limit = 20) => {
    try {
        const cleanHandle = handle.replace('@', '').trim();
        console.log(`[RapidAPI] Fetching tweets for ${cleanHandle}...`);

        let userId = userIdCache.get(cleanHandle);

        if (!userId) {
            const userResponse = await rapidRequestX({
                method: 'get',
                url: `${TWITTER_BASE}/user`,
                params: { username: cleanHandle }
            });

            if (userResponse.data?.errors || userResponse.data?.error) {
                const errMsg = JSON.stringify(userResponse.data.errors || userResponse.data.error);
                console.warn(`[RapidAPI] API returned errors for ${cleanHandle}: ${errMsg}`);
                // return null instead of throwing to allow other sources to proceed
                return null;
            }

            let result = null;

            if (userResponse.data?.result?.data?.user?.result) {
                result = userResponse.data.result.data.user.result;
            } else if (userResponse.data?.result?.data?.userResult?.result) {
                result = userResponse.data.result.data.userResult.result;
            } else if (userResponse.data?.data?.user?.result) {
                result = userResponse.data.data.user.result;
            } else if (userResponse.data?.result?.rest_id) {
                result = userResponse.data.result;
            } else if (userResponse.data?.user?.result) {
                result = userResponse.data.user.result;
            } else if (userResponse.data?.rest_id) {
                result = userResponse.data;
            } else {
                console.warn(`[RapidAPI] User structure mismatch for ${cleanHandle}. Response:`, JSON.stringify(userResponse.data).substring(0, 500));
            }

            if (!result || !result.rest_id) {
                console.warn(`[RapidAPI] User identification failed for: ${handle}`);
                return [];
            }

            userId = result.rest_id;
            userIdCache.set(cleanHandle, userId);

            const freshVerified = result.is_blue_verified || result.legacy?.verified || false;
            const freshImage = result.avatar?.image_url ||
                result.legacy?.profile_image_url_https ||
                result.profile_image_url_https;
            userIdCache.set(cleanHandle + '_meta', { isVerified: freshVerified, profileImageUrl: freshImage });
        }

        const tweetsResponse = await rapidRequestX({
            method: 'get',
            url: `${TWITTER_BASE}/user-tweets`,
            params: { user: userId, count: limit }
        });

        const timelineEntries = tweetsResponse.data.result.timeline.instructions
            .find(i => i.type === 'TimelineAddEntries')?.entries || [];

        // Initialize with cached metadata
        const cachedMeta = userIdCache.get(cleanHandle + '_meta');
        let isVerified = cachedMeta?.isVerified || false;
        let profileImageUrl = cachedMeta?.profileImageUrl || null;

        const tweets = [];
        for (const entry of timelineEntries) {
            const rawTweet = entry.content?.itemContent?.tweet_results?.result;
            const normalized = normalizeTweet(rawTweet, cleanHandle);
            if (normalized) {
                tweets.push(normalized);
                // Backup metadata extraction
                if (!profileImageUrl && normalized.author_avatar) profileImageUrl = normalized.author_avatar;
                if (normalized.verified !== undefined) isVerified = normalized.verified;
            }
        }

        console.log(`[RapidAPI] Fetched ${timelineEntries.length} entries, processed ${tweets.length} tweets for @${cleanHandle}`);

        return {
            tweets,
            userData: { isVerified, profileImageUrl }
        };


    } catch (error) {
        console.error(`[RapidAPI] Error fetching tweets for ${handle}:`, error.message);
        return { tweets: [], userData: {} }; // Return empty structure on error matches return type
    }
};

const fetchAllUserTweetsSince = async (handle, cutoffDate, maxCount = 200) => {
    const cleanHandle = String(handle || '').replace('@', '').trim();
    const cutoff = cutoffDate instanceof Date ? cutoffDate : new Date(cutoffDate);

    if (!cleanHandle) {
        return { tweets: [], userData: {} };
    }

    try {
        const profile = await fetchUserProfile(cleanHandle);
        const userId = profile?.id || userIdCache.get(cleanHandle);
        if (!userId) {
            throw new Error(`Could not resolve user id for @${cleanHandle}`);
        }

        const tweets = [];
        const seenTweetIds = new Set();
        let cursor = null;
        let page = 0;
        let reachedCutoff = false;
        const maxPages = Math.max(1, Math.ceil(maxCount / 40)) + 2;

        while (!reachedCutoff && tweets.length < maxCount && page < maxPages) {
            page += 1;
            const params = { user: userId, count: Math.min(40, maxCount - tweets.length) };
            if (cursor) params.cursor = cursor;

            const data = await rapidGet('user-tweets', params);
            const entries = getTimelineEntries(data);

            let addedThisPage = 0;
            for (const entry of entries) {
                const rawTweet = entry?.content?.itemContent?.tweet_results?.result ||
                    entry?.item?.itemContent?.tweet_results?.result ||
                    entry?.tweet_results?.result ||
                    entry?.content?.tweetResult?.result ||
                    null;

                const normalized = normalizeTweet(rawTweet, cleanHandle);
                if (!normalized?.id || seenTweetIds.has(normalized.id)) continue;

                const createdAt = normalized.created_at ? new Date(normalized.created_at) : null;
                if (createdAt && createdAt < cutoff) {
                    reachedCutoff = true;
                    continue;
                }

                seenTweetIds.add(normalized.id);
                tweets.push(normalized);
                addedThisPage += 1;

                if (tweets.length >= maxCount) break;
            }

            cursor = extractBottomCursor(entries);
            if (!cursor || addedThisPage === 0) break;
        }

        return {
            tweets,
            userData: {
                isVerified: !!profile?.isVerified,
                profileImageUrl: profile?.profileImageUrl || null,
                name: profile?.name || null,
                screenName: profile?.screenName || cleanHandle
            }
        };
    } catch (error) {
        console.error(`[RapidAPI] Error fetching all tweets for ${handle}:`, error.message);
        throw error;
    }
};

const searchUsers = async (query) => {
    try {
        console.log(`[RapidAPI] Searching users for: ${query}`);
        const cleanQuery = query.replace('@', '').trim();

        const extractUsersFromEntries = (entries) => {
            const users = [];
            for (const entry of entries) {
                const userResult = entry?.content?.itemContent?.user_results?.result ||
                    entry?.content?.itemContent?.userDisplayType?.user_results?.result ||
                    entry?.content?.itemContent?.user_result?.result;

                if (!userResult) continue;
                const legacy = userResult.legacy || {};
                const core = userResult.core || {};
                // API now puts name/screen_name in core, not legacy
                const screenName = core.screen_name || legacy.screen_name || '';
                if (!screenName) continue;

                users.push({
                    id: userResult.rest_id,
                    name: core.name || legacy.name || cleanQuery,
                    screen_name: screenName,
                    description: userResult.profile_bio?.description || legacy.description || '',
                    profile_image_url: userResult.avatar?.image_url || legacy.profile_image_url_https || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png',
                    followers_count: legacy.followers_count || 0,
                    friends_count: legacy.friends_count || 0,
                    verified: userResult.is_blue_verified || userResult.verification?.verified || legacy.verified || false,
                    platform: 'x'
                });
            }
            return users;
        };

        // Use type: 'People' (the API requires this, not section: 'people')
        try {
            const searchResponse = await rapidRequestX({
                method: 'get',
                url: `${TWITTER_BASE}/search`,
                params: {
                    query: cleanQuery,
                    type: 'People',
                    count: 30
                }
            });

            // Parse search results - handle multiple response structures
            const instructions = searchResponse.data?.result?.timeline?.instructions ||
                searchResponse.data?.timeline?.instructions ||
                searchResponse.data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
                [];
            const entries = instructions.find(i => i.type === 'TimelineAddEntries')?.entries ||
                instructions[0]?.entries || [];

            const users = extractUsersFromEntries(entries);

            if (users.length > 0) {
                console.log(`[RapidAPI] Found ${users.length} users matching "${query}"`);
                return users;
            }
        } catch (searchError) {
            console.warn(`[RapidAPI] Search endpoint failed, falling back to exact lookup:`, searchError.message);
        }

        // Fallback: Try exact username lookup
        const response = await rapidRequestX({
            method: 'get',
            url: `${TWITTER_BASE}/user`,
            params: { username: cleanQuery }
        });

        const result = response.data?.result?.data?.user?.result ||
            response.data?.data?.user?.result ||
            response.data?.result;

        if (result) {
            const legacy = result.legacy || {};
            const core = result.core || {};

            return [{
                id: result.rest_id,
                name: core.name || legacy.name || cleanQuery,
                screen_name: core.screen_name || legacy.screen_name || cleanQuery,
                description: result.profile_bio?.description || legacy.description || '',
                profile_image_url: result.avatar?.image_url || legacy.profile_image_url_https || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png',
                followers_count: legacy.followers_count || 0,
                friends_count: legacy.friends_count || 0,
                verified: result.is_blue_verified || result.verification?.verified || legacy.verified || false,
                platform: 'x'
            }];
        }

        return [];
    } catch (error) {
        console.warn(`[RapidAPI] User search failed for ${query}:`, error.message);
        return [];
    }
};

const fetchTweetRetweeters = async (tweetId, { count = 200 } = {}) => {
    const key = String(tweetId || '').trim();
    if (!key) return [];

    const attempts = [
        { path: 'retweets', baseParams: { pid: key, count: Math.min(count, 100) } }
    ];

    for (const attempt of attempts) {
        try {
            const retweeters = [];
            const seenHandles = new Set();
            let cursor = null;
            let page = 0;
            const maxPages = Math.max(1, Math.ceil(count / 100));

            while (retweeters.length < count && page < maxPages) {
                page += 1;
                const params = { ...attempt.baseParams };
                if (cursor) params.cursor = cursor;

                const data = await rapidGet(attempt.path, params);
                const entries = getTimelineEntries(data);
                let addedThisPage = 0;

                for (const entry of entries) {
                    const rawUser = entry?.content?.itemContent?.user_results?.result ||
                        entry?.content?.itemContent?.user_result?.result ||
                        entry?.item?.itemContent?.user_results?.result ||
                        entry?.user_results?.result ||
                        entry?.content?.user ||
                        null;

                    const resolved = resolveUser(rawUser);
                    if (!resolved?.screen_name) continue;

                    const handle = String(resolved.screen_name).replace(/^@/, '').trim().toLowerCase();
                    if (!handle || seenHandles.has(handle)) continue;

                    const retweetId = entry?.content?.itemContent?.tweet_results?.result?.rest_id ||
                        entry?.item?.itemContent?.tweet_results?.result?.rest_id ||
                        entry?.content?.itemContent?.tweet_results?.result?.legacy?.id_str ||
                        (entry?.entryId?.startsWith('tweet-') ? entry.entryId.split('tweet-')[1] : null);

                    seenHandles.add(handle);
                    retweeters.push({
                        id: resolved.id || null,
                        handle,
                        name: resolved.name || handle,
                        avatar: resolved.profile_image_url_https || null,
                        verified: !!resolved.verified,
                        retweet_id: retweetId || null
                    });
                    addedThisPage += 1;

                    if (retweeters.length >= count) break;
                }

                cursor = extractBottomCursor(entries);
                if (!cursor || addedThisPage === 0) break;
            }

            if (retweeters.length > 0) {
                return retweeters;
            }
        } catch (error) {
            console.warn(`[RapidAPI] Retweeter fetch attempt failed for tweet ${key} via ${attempt.path}:`, error.message);
        }
    }

    return [];
};

const resolveUser = (userResult) => {
    if (!userResult) return null;

    // Handle UserUnavailable / Tombstone
    if (userResult.__typename === 'UserUnavailable' || userResult.__typename === 'UserTombstone') {
        return null;
    }

    // Step 1: Deep Unwrapping Loop
    // This finds the "User" object (which contains legacy/core) if we pass it a wrapper or a Tweet
    let raw = userResult;
    for (let i = 0; i < 6; i++) {
        if (!raw || typeof raw !== 'object') break;

        // Common wrappers
        if (raw.result && typeof raw.result === 'object') raw = raw.result;
        else if (raw.user_results?.result) raw = raw.user_results.result;
        else if (raw.core?.user_results?.result) raw = raw.core.user_results.result;
        else if (raw.author_results?.result) raw = raw.author_results.result; // Seen in some v2 APIs
        else if (raw.user && typeof raw.user === 'object' && (raw.user.id || raw.user.rest_id)) raw = raw.user;
        else if (raw.data?.user) raw = raw.data.user;
        else if (raw.core && typeof raw.core === 'object' && (raw.core.screen_name || raw.core.name)) break;
        else break;
    }

    // Secondary unwrapping for TweetWithVisibilityResults style
    if (raw && (raw.__typename === 'UserWithVisibilityResults' || raw.__typename === 'User') && raw.user) {
        raw = raw.user;
    }

    if (!raw) return null;

    // Step 2: Extract core/legacy fields
    // Some APIs put 'core' and 'legacy' inside another 'core' or 'result'
    const legacy = raw.legacy || raw.core?.legacy || {};
    const core = raw.core || {};

    // Prioritize core (new API structure / Mathematical unicode names) then legacy then top-level
    const name = core.name || legacy.name || raw.name || core.screen_name || legacy.screen_name || raw.screen_name || 'Unknown User';
    const screen_name = core.screen_name || legacy.screen_name || raw.screen_name || 'unknown';

    // Avatar resolution with multiple fallbacks
    const avatar = core.avatar?.image_url ||
        legacy.profile_image_url_https ||
        raw.avatar?.image_url ||
        raw.profile_image_url_https ||
        'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';

    const verified = core.is_blue_verified || legacy.verified || raw.is_blue_verified || raw.verified || false;

    if (!screen_name || screen_name === 'unknown') {
        // Log locally if we can't find a handle in a non-null object
        if (raw.id_str || raw.rest_id) {
            console.warn('[RapidAPI] Could not resolve screen_name for user ID:', raw.rest_id || raw.id_str);
        }
        return null;
    }

    return {
        name: name,
        screen_name: screen_name,
        profile_image_url_https: avatar,
        verified,
        location: legacy.location || raw.location || '',
        description: legacy.description || raw.description || '',
        id: raw.rest_id || raw.id_str || raw.id
    };
};

/**
 * Unifies normalization of a raw tweet result from any RapidAPI endpoint into a standard format.
 * Handles: full text (note tweets), media, quoted content, reposts/retweets, and robust author resolution.
 */
const normalizeTweet = (tweetResult, fallbackHandle = 'unknown') => {
    if (!tweetResult) return null;

    let tweet = tweetResult;
    // Unwrap generic wrappers
    for (let i = 0; i < 6; i++) {
        if (!tweet || typeof tweet !== 'object') break;

        if (tweet.result) tweet = tweet.result;
        else if (tweet.tweet) tweet = tweet.tweet;
        else if (tweet.tweetResult) tweet = tweet.tweetResult;
        else if (tweet.tweet_results?.result) tweet = tweet.tweet_results.result;
        else if (tweet.data && typeof tweet.data === 'object') tweet = tweet.data;
        else if (tweet.__typename === 'TweetWithVisibilityResults' && tweet.tweet) tweet = tweet.tweet;
        else break;
    }

    if (tweet.__typename === 'TweetUnavailable' || tweet.__typename === 'TweetTombstone') {
        return null;
    }

    const legacy = tweet.legacy;
    if (!legacy) return null;

    // Helper to extract user raw from various possible locations in a tweet object
    const extractUserRaw = (obj) => {
        if (!obj) return null;
        return obj.core?.user_results?.result ||
            obj.user_results?.result ||
            obj.author ||
            obj.user ||
            obj.result?.user_results?.result ||
            obj.result?.user ||
            obj.author_results?.result ||
            obj.result?.author_results?.result ||
            (obj.legacy || obj.screen_name || obj.core ? obj : null);
    };

    // Recursively resolve author to handle nested retweets
    const resolveAuthorRecursive = (obj) => {
        if (!obj) return null;
        const resolved = resolveUser(extractUserRaw(obj));

        // Check for nested retweet structure
        let retweet = obj.retweeted_status_result?.result ||
            obj.result?.retweeted_status_result?.result ||
            obj.legacy?.retweeted_status_result?.result;

        if (retweet) {
            const nested = resolveAuthorRecursive(retweet);
            // Prioritize original author if successfully resolved
            if (nested && nested.screen_name !== 'unknown') return nested;
        }
        return resolved;
    };

    // 1. Resolve Main Author
    const mainUser = resolveAuthorRecursive(tweet) || {
        name: fallbackHandle,
        screen_name: fallbackHandle,
        profile_image_url_https: 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png',
        verified: false
    };


    // 2. Handle Reposts / Retweets
    let retweetResult = legacy.retweeted_status_result?.result;
    if (retweetResult && retweetResult.result) retweetResult = retweetResult.result;
    if (retweetResult && retweetResult.tweet) retweetResult = retweetResult.tweet;

    const isRepost = !!retweetResult;
    let targetLegacy = legacy;
    let originalAuthor = null;
    let originalAuthorName = null;
    let originalAuthorAvatar = null;

    if (isRepost && retweetResult.legacy) {
        targetLegacy = retweetResult.legacy;

        let origUserRaw = retweetResult.core?.user_results?.result ||
            retweetResult.author ||
            retweetResult.user;

        const origUser = resolveUser(origUserRaw);
        if (origUser) {
            originalAuthor = origUser.screen_name;
            originalAuthorName = origUser.name;
            originalAuthorAvatar = origUser.profile_image_url_https;
        }
    }

    // 3. Extract Text (Handling Note Tweets / Long Posts)
    const targetNoteTweet = retweetResult?.note_tweet || tweet.note_tweet;
    const noteTweetText = targetNoteTweet?.note_tweet_results?.result?.text;
    let fullText = noteTweetText || targetLegacy.full_text || targetLegacy.text || '';

    // 4. Extract Quotes
    let quotedContent = null;
    let rawQuote = retweetResult?.quoted_status_result?.result ||
        retweetResult?.legacy?.quoted_status_result?.result ||
        tweet.quoted_status_result?.result ||
        tweet.quoted_status_result ||
        legacy.quoted_status_result?.result ||
        legacy.quoted_status_result;

    if (rawQuote) {
        // Handle wrappers for Quote
        let unwrappedQuote = rawQuote;
        for (let i = 0; i < 5; i++) {
            if (unwrappedQuote.result) unwrappedQuote = unwrappedQuote.result;
            else if (unwrappedQuote.tweet) unwrappedQuote = unwrappedQuote.tweet;
            else if (unwrappedQuote.tweet_results?.result) unwrappedQuote = unwrappedQuote.tweet_results.result;
            else if (unwrappedQuote.__typename === 'TweetWithVisibilityResults' && unwrappedQuote.tweet) unwrappedQuote = unwrappedQuote.tweet;
            else break;
        }

        // Check if the quote itself is a retweet, and if so, use the original tweet
        let targetQuote = unwrappedQuote;
        const qRetweetResult = unwrappedQuote.retweeted_status_result?.result ||
            unwrappedQuote.legacy?.retweeted_status_result?.result;

        if (qRetweetResult) {
            let unwrappedOrig = qRetweetResult;
            for (let i = 0; i < 3; i++) {
                if (unwrappedOrig.result) unwrappedOrig = unwrappedOrig.result;
                else if (unwrappedOrig.tweet) unwrappedOrig = unwrappedOrig.tweet;
                else break;
            }
            if (unwrappedOrig && unwrappedOrig.legacy) {
                targetQuote = unwrappedOrig;
            }
        }

        if (targetQuote.legacy) {
            const qLegacy = targetQuote.legacy;
            const qUser = resolveUser(extractUserRaw(targetQuote)) || {
                name: 'Unknown',
                screen_name: 'unknown',
                profile_image_url_https: 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'
            };

            const qNoteTweet = targetQuote.note_tweet;
            let qText = qNoteTweet?.note_tweet_results?.result?.text || qLegacy.full_text || qLegacy.text || '';

            const qEntities = qLegacy.extended_entities || qLegacy.entities;
            const qMediaRaw = (qEntities?.media || []);
            const qMedia = qMediaRaw.map(normalizeMediaItem).filter(Boolean);

            quotedContent = {
                text: qText,
                author_name: qUser.name,
                author_handle: qUser.screen_name,
                profile_image_url: qUser.profile_image_url_https,
                media: qMedia,
                created_at: qLegacy.created_at ? new Date(qLegacy.created_at) : null
            };
        }
    }

    // NEW FALLBACK: Extract handle from permalink URL if quoted data is missing or incomplete
    if ((!quotedContent || quotedContent.author_handle === 'unknown') && (targetLegacy.is_quote_status || tweet.is_quote_status)) {
        const permalink = targetLegacy.quoted_status_permalink || tweet.quoted_status_permalink;
        if (permalink) {
            const urlStr = permalink.expanded || permalink.url || permalink.display || '';
            let authorHandle = null;

            if (urlStr) {
                const parts = urlStr.split('/').filter(Boolean);
                const xIndex = parts.findIndex(p => p.includes('twitter.com') || p.includes('x.com'));
                if (xIndex !== -1 && parts[xIndex + 1]) {
                    authorHandle = parts[xIndex + 1].split('?')[0];
                }
            }

            if (authorHandle && authorHandle !== 'status' && authorHandle !== 'i') {
                if (!quotedContent) {
                    quotedContent = {
                        text: '',
                        author_name: authorHandle,
                        author_handle: authorHandle,
                        profile_image_url: 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png',
                        media: [],
                        created_at: null
                    };
                } else if (quotedContent.author_handle === 'unknown') {
                    quotedContent.author_handle = authorHandle;
                    if (quotedContent.author_name === 'Unknown') quotedContent.author_name = authorHandle;
                }
            }
        }
    }

    // 5. Extract Media
    const rawMediaMap = new Map();
    const addMediaItems = (items) => {
        if (!Array.isArray(items)) return;
        items.forEach(m => {
            const key = m.media_key || m.id_str || m.media_url_https || m.media_url || m.url;
            if (key) rawMediaMap.set(key, m);
        });
    };

    if (targetLegacy.extended_entities?.media) addMediaItems(targetLegacy.extended_entities.media);
    else if (targetLegacy.entities?.media) addMediaItems(targetLegacy.entities.media);

    if (targetNoteTweet?.note_tweet_results?.result?.media?.inline_media) {
        addMediaItems(targetNoteTweet.note_tweet_results.result.media.inline_media);
    }

    // Fallback search in high level buckets
    if (tweet.extended_entities?.media) addMediaItems(tweet.extended_entities.media);

    const media = Array.from(rawMediaMap.values()).map(normalizeMediaItem).filter(Boolean);

    // 6. Extract URL Cards
    const urlCards = [];
    const urlEntities = targetLegacy.entities?.urls || [];
    for (const urlEntity of urlEntities) {
        if (urlEntity.expanded_url && !urlEntity.expanded_url.includes('twitter.com') && !urlEntity.expanded_url.includes('x.com')) {
            urlCards.push({
                url: urlEntity.url,
                expanded_url: urlEntity.unwound_url || urlEntity.expanded_url,
                display_url: urlEntity.display_url,
                title: urlEntity.title,
                description: urlEntity.description,
                image: urlEntity.images?.[0]?.url || urlEntity.image
            });
        }
    }

    // 7. Clean Text
    let cleanText = fullText;
    const urlsToRemove = [];
    if (targetLegacy.extended_entities?.media) targetLegacy.extended_entities.media.forEach(m => urlsToRemove.push(m.url));
    if (targetLegacy.quoted_status_permalink?.url) urlsToRemove.push(targetLegacy.quoted_status_permalink.url);
    urlsToRemove.forEach(u => { if (u) cleanText = cleanText.replace(u, ''); });
    cleanText = cleanText.trim();

    // Thread context — `in_reply_to_status_id_str` + the conversation root tell
    // the UI this tweet is a reply, so it can render the parent above and the
    // rest of the thread. The legacy Twitter response carries the parent
    // screen name too, so we can produce a clickable URL without re-fetching.
    const inReplyToId = targetLegacy.in_reply_to_status_id_str;
    const inReplyToHandle = targetLegacy.in_reply_to_screen_name;
    const conversationId = targetLegacy.conversation_id_str || tweet.conversation_id_str || null;

    return {
        id: targetLegacy.id_str,
        text: cleanText || fullText,
        url: `https://x.com/${mainUser.screen_name}/status/${targetLegacy.id_str}`,
        created_at: targetLegacy.created_at ? new Date(targetLegacy.created_at) : null,
        media,
        url_cards: urlCards,
        is_repost: isRepost,
        author: mainUser.name,
        author_handle: mainUser.screen_name,
        author_avatar: mainUser.profile_image_url_https,
        author_location: mainUser.location,
        author_bio: mainUser.description,
        verified: mainUser.verified,
        original_author: originalAuthor,

        original_author_name: originalAuthorName,
        original_author_avatar: originalAuthorAvatar,
        quoted_content: quotedContent,
        in_reply_to_id: inReplyToId || null,
        in_reply_to_handle: inReplyToHandle || null,
        conversation_id: conversationId,
        raw_data: tweetResult,
        metrics: {
            like: (targetLegacy.favorite_count || 0).toString(),
            retweet: (targetLegacy.retweet_count || 0).toString(),
            reply: (targetLegacy.reply_count || 0).toString(),
            views: (tweet.views?.count || 0).toString(),
            quote: (targetLegacy.quote_count || 0).toString()
        }
    };
};


const X_SEARCH_PAGE_SIZE = Math.max(1, Math.min(100, parseInt(process.env.X_SEARCH_PAGE_SIZE || '100', 10)));

const searchTweets = async (query, since = null) => {
    query = String(query || '').trim();
    if (!query) return [];
    try {
        let sinceDate = since;
        if (!sinceDate) {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            sinceDate = weekAgo.toISOString().split('T')[0];
        }

        console.log(`[RapidAPI] Searching tweets for: ${query} since:${sinceDate}`);

        // Try Top results first (more relevant), then Latest if empty
        const extractTweets = (responseData) => {
            const instructions = responseData?.result?.timeline?.instructions ||
                responseData?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
                responseData?.timeline?.instructions ||
                [];
            const entries = instructions.find(i => i.type === 'TimelineAddEntries')?.entries ||
                instructions[0]?.entries || [];
            const tweets = [];
            for (const entry of entries) {
                // Standard tweet entry
                const rawTweet = entry.content?.itemContent?.tweet_results?.result;
                if (rawTweet) {
                    const normalized = normalizeTweet(rawTweet);
                    if (normalized && !tweets.some(t => t.id === normalized.id)) {
                        tweets.push(normalized);
                    }
                }
                // Module entries (Top search returns user modules + tweet modules)
                if (entry.content?.items) {
                    for (const item of entry.content.items) {
                        const nestedTweet = item?.item?.itemContent?.tweet_results?.result;
                        if (nestedTweet) {
                            const normalized = normalizeTweet(nestedTweet);
                            if (normalized && !tweets.some(t => t.id === normalized.id)) {
                                tweets.push(normalized);
                            }
                        }
                    }
                }
            }
            return tweets;
        };

        // Try Top results first for better relevance
        const response = await rapidRequestX({
            method: 'get',
            url: `${TWITTER_BASE}/search`,
            params: { query: `${query} since:${sinceDate}`, type: 'Top', count: X_SEARCH_PAGE_SIZE }
        });

        let tweets = extractTweets(response.data);

        // If Top returned too few, also try Latest
        if (tweets.length < 5) {
            try {
                const latestResp = await rapidRequestX({
                    method: 'get',
                    url: `${TWITTER_BASE}/search`,
                    params: { query: `${query} since:${sinceDate}`, type: 'Latest', count: X_SEARCH_PAGE_SIZE }
                });
                const latestTweets = extractTweets(latestResp.data);
                for (const t of latestTweets) {
                    if (!tweets.some(existing => existing.id === t.id)) {
                        tweets.push(t);
                    }
                }
            } catch {
                // Latest failed, use what we have from Top
            }
        }

        // If still empty, try without date filter
        if (tweets.length === 0) {
            try {
                const noDateResp = await rapidRequestX({
                    method: 'get',
                    url: `${TWITTER_BASE}/search`,
                    params: { query, type: 'Top', count: X_SEARCH_PAGE_SIZE }
                });
                tweets = extractTweets(noDateResp.data);
            } catch {
                // All attempts failed
            }
        }

        console.log(`[RapidAPI] Found ${tweets.length} tweets for "${query}"`);
        return tweets;
    } catch (error) {
        console.error('[RapidAPI] Search Tweets Error:', error.message);
        return [];
    }
};


const fs = require('fs');
const path = require('path');

const fetchTweetDetail = async (tweetId) => {
    const log = (msg) => console.log(`[Investigation] ${msg}`);
    const key = String(tweetId || '').trim();
    if (!key) {
        log('Error: Empty tweet ID provided');
        return null;
    }

    try {
        log(`Fetching details for tweet ${key}...`);

        const endpointAttempts = [
            { path: '/tweet-v2', params: { pid: key } },
            { path: '/tweet', params: { pid: key } }
        ];

        let tweetData = null;

        for (const attempt of endpointAttempts) {
            try {
                const response = await rapidRequestX({
                    method: 'get',
                    url: `${TWITTER_BASE}${attempt.path}`,
                    params: attempt.params
                });

                // DEBUG: Log keys to see structure
                if (response.data) {
                    const topKeys = Object.keys(response.data);
                    log(`Response keys for ${attempt.path}: ${topKeys.join(', ')}`);
                    if (response.data.result) log(`Result keys: ${Object.keys(response.data.result).join(', ')}`);
                }

                // Robust extraction based on known twitter241 and related schemas
                let result = response.data?.result || response.data?.data || response.data;

                // Aggressive unwrapping for deeply nested RapidAPI structures
                for (let i = 0; i < 6; i++) {
                    if (!result || typeof result !== 'object') break;
                    if (result.tweetResult) result = result.tweetResult;
                    else if (result.tweet) result = result.tweet;
                    else if (result.result) result = result.result;
                    else if (result.tweet_results?.result) result = result.tweet_results.result;
                    else if (result.data && typeof result.data === 'object') result = result.data;
                    else break;
                }

                // Check if we found valid data
                if (result && (result.legacy || result.data?.legacy || result.rest_id)) {
                    tweetData = result;
                    log(`Successfully fetched tweet ${key} via ${attempt.path}`);
                    break;
                } else if (result) {
                    log(`Found data for ${attempt.path} but it lacked legacy/rest_id. Keys: ${Object.keys(result).join(', ')}`);
                }
            } catch (e) {
                // Only log if it's not a 404
                if (e.response?.status !== 404) {
                    log(`Attempt error for ${attempt.path}: ${e.response?.status || e.message}`);
                }
            }
        }

        // 2. Search Fallback (if no direct fetch worked)
        if (!tweetData) {
            try {
                const searchQuery = `url:\"/status/${key}\"`;
                log(`Direct fetch failed for ${key}, trying search fallback with query: ${searchQuery}...`);
                // Search for the ID directly which is very reliable for many APIs
                const searchRes = await rapidRequestX({
                    method: 'get',
                    url: `${TWITTER_BASE}/search`,
                    params: { query: searchQuery, type: 'Latest', count: 10 }
                });

                const instructions = searchRes.data?.result?.timeline?.instructions ||
                    searchRes.data?.timeline?.instructions ||
                    searchRes.data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];

                const entries = instructions.find(i => i.type === 'TimelineAddEntries')?.entries ||
                    instructions[0]?.entries || [];

                const processEntry = (entry) => {
                    let result = entry.content?.itemContent?.tweet_results?.result;
                    if (!result) return null;

                    // Unwrap TweetWithVisibilityResults
                    if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) {
                        result = result.tweet;
                    }

                    // 1. Check top-level ID
                    if (result.rest_id === key || result.legacy?.id_str === key || result.id_str === key) {
                        return result;
                    }

                    // 2. Check Quoted Status
                    let quote = result.quoted_status_result?.result || result.quoted_status_result;
                    if (quote) {
                        if (quote.result || quote.tweet) quote = quote.result || quote.tweet;
                        if (quote.__typename === 'TweetWithVisibilityResults' && quote.tweet) quote = quote.tweet;

                        if (quote.rest_id === key || quote.legacy?.id_str === key || quote.id_str === key) {
                            log(`Found tweet ${key} INSIDE quoted_status_result`);
                            return quote;
                        }
                    }

                    // 3. Check Retweeted Status
                    let retweet = result.legacy?.retweeted_status_result?.result || result.legacy?.retweeted_status_result;
                    if (retweet) {
                        if (retweet.result || retweet.tweet) retweet = retweet.result || retweet.tweet;
                        if (retweet.__typename === 'TweetWithVisibilityResults' && retweet.tweet) retweet = retweet.tweet;

                        if (retweet.rest_id === key || retweet.legacy?.id_str === key || retweet.id_str === key) {
                            log(`Found tweet ${key} INSIDE retweeted_status_result`);
                            return retweet;
                        }
                    }

                    return null;
                };

                for (const entry of entries) {
                    tweetData = processEntry(entry);
                    if (tweetData) break;
                }

                // If still not found, try a broader search for the ID as a string
                if (!tweetData) {
                    log(`Specific URL search failed for ${key}, trying keyword search fallback (count: 20)...`);
                    const broadRes = await rapidRequestX({
                        method: 'get',
                        url: `${TWITTER_BASE}/search`,
                        params: { query: key, type: 'Latest', count: 20 }
                    });

                    const broadInstructions = broadRes.data?.result?.timeline?.instructions ||
                        broadRes.data?.timeline?.instructions ||
                        broadRes.data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];

                    const broadEntries = broadInstructions.find(i => i.type === 'TimelineAddEntries')?.entries ||
                        broadInstructions[0]?.entries || [];

                    for (const entry of broadEntries) {
                        tweetData = processEntry(entry);
                        if (tweetData) break;
                    }
                }
            } catch (e) {
                log(`Search fallback failed for ${key}: ${e.response?.status || e.message}`);
            }
        }

        if (!tweetData) return null;

        const normalized = normalizeTweet(tweetData);
        return normalized;

    } catch (error) {
        console.error(`[RapidAPI] Final Fetch Tweet Detail Error for ${tweetId}:`, error.message);
        return null;
    }
};

const fetchRetweetIdForUser = async (handle, originalTweetId) => {
    const cleanHandle = String(handle || '').replace(/^@/, '').trim();
    if (!cleanHandle || !originalTweetId) return null;

    try {
        // 1. Resolve user profile to get userId
        const profile = await fetchUserProfile(cleanHandle);
        const userId = profile?.id || userIdCache.get(cleanHandle);
        if (!userId) {
            console.warn(`[RapidAPI] Could not resolve user ID for @${cleanHandle}`);
            return null;
        }

        // 2. Fetch latest user tweets/retweets (timeline)
        const data = await rapidGet('user-tweets', { user: userId, count: 100 });
        const entries = getTimelineEntries(data);

        // 3. Scan timeline entries for a retweet of originalTweetId
        for (const entry of entries) {
            const rawTweet = entry?.content?.itemContent?.tweet_results?.result ||
                entry?.item?.itemContent?.tweet_results?.result ||
                entry?.tweet_results?.result ||
                entry?.content?.tweetResult?.result ||
                null;

            if (!rawTweet) continue;

            // Unwrap any outer wrappers
            let tweet = rawTweet;
            for (let i = 0; i < 4; i++) {
                if (!tweet || typeof tweet !== 'object') break;
                if (tweet.result) tweet = tweet.result;
                else if (tweet.tweet) tweet = tweet.tweet;
                else break;
            }

            if (!tweet || !tweet.legacy) continue;

            const outerTweetId = tweet.rest_id || tweet.legacy.id_str;

            // Check if it's a retweet/repost
            let retweetResult = tweet.legacy.retweeted_status_result?.result;
            if (retweetResult && retweetResult.result) retweetResult = retweetResult.result;
            if (retweetResult && retweetResult.tweet) retweetResult = retweetResult.tweet;

            if (retweetResult) {
                const origTweetId = retweetResult.rest_id || retweetResult.legacy?.id_str;
                if (origTweetId === originalTweetId && outerTweetId) {
                    console.log(`[RapidAPI] Found retweet ID ${outerTweetId} for @${cleanHandle} retweeting ${originalTweetId}`);
                    return String(outerTweetId);
                }
            }
        }
    } catch (err) {
        console.warn(`[RapidAPI] fetchRetweetIdForUser failed for @${cleanHandle}:`, err.message);
    }
    return null;
};

const fetchTweetLikers = async (tweetId, { count = 200 } = {}) => {
    const key = String(tweetId || '').trim();
    if (!key) return [];

    const attempts = [
        { path: 'likes', baseParams: { pid: key, count: Math.min(count, 100) } }
    ];

    for (const attempt of attempts) {
        try {
            const likers = [];
            const seenHandles = new Set();
            let cursor = null;
            let page = 0;
            const maxPages = Math.max(1, Math.ceil(count / 100));

            while (likers.length < count && page < maxPages) {
                page += 1;
                const params = { ...attempt.baseParams };
                if (cursor) params.cursor = cursor;

                const data = await rapidGet(attempt.path, params);
                const entries = getTimelineEntries(data);
                let addedThisPage = 0;

                for (const entry of entries) {
                    const rawUser = entry?.content?.itemContent?.user_results?.result ||
                        entry?.content?.itemContent?.user_result?.result ||
                        entry?.item?.itemContent?.user_results?.result ||
                        entry?.user_results?.result ||
                        entry?.content?.user ||
                        null;

                    const resolved = resolveUser(rawUser);
                    if (!resolved?.screen_name) continue;

                    const handle = String(resolved.screen_name).replace(/^@/, '').trim().toLowerCase();
                    if (!handle || seenHandles.has(handle)) continue;

                    seenHandles.add(handle);
                    likers.push({
                        id: resolved.id || null,
                        handle,
                        name: resolved.name || handle,
                        avatar: resolved.profile_image_url_https || null,
                        verified: !!resolved.verified
                    });
                    addedThisPage += 1;

                    if (likers.length >= count) break;
                }

                if (addedThisPage === 0) break;
                const nextCursor = extractBottomCursor(entries);
                if (!nextCursor || nextCursor === cursor) break;
                cursor = nextCursor;
            }

            if (likers.length > 0) {
                return likers;
            }
        } catch (error) {
            console.warn(`[RapidAPI] Likers fetch attempt failed for tweet ${key} via ${attempt.path}:`, error.message);
        }
    }

    return [];
};

const fetchTweetComments = async (tweetId, { count = 100 } = {}) => {
    const key = String(tweetId || '').trim();
    if (!key) return [];

    try {
        const raw = await rapidGet('comments', { pid: key });
        const instructions = raw?.result?.instructions || [];
        const entries = [];
        for (const instruction of instructions) {
            if (Array.isArray(instruction?.entries)) {
                entries.push(...instruction.entries);
            }
        }

        const comments = [];
        const seenCommentIds = new Set();

        const parseCommentFromTweetResult = (result) => {
            if (!result) return null;
            const core = result.core || {};
            const userResult = core.user_results?.result || {};
            const userCore = userResult.core || {};
            const legacyUser = userResult.legacy || {};
            
            const handle = userCore.screen_name || legacyUser.screen_name || '';
            if (!handle) return null;

            const legacyTweet = result.legacy || {};
            const text = legacyTweet.full_text || '';
            const avatar = userResult.avatar?.image_url || legacyUser.profile_image_url_https || null;
            const name = userCore.name || legacyUser.name || handle;
            const verified = !!(userResult.is_blue_verified || legacyUser.verified);
            return {
                id: result.rest_id || legacyTweet.id_str,
                handle,
                name,
                avatar,
                verified,
                text,
                engagement_type: 'comment'
            };
        };

        for (const entry of entries) {
            const entryId = entry?.entryId || '';
            if (entryId.startsWith('conversationthread-')) {
                const items = entry?.content?.items || [];
                for (const item of items) {
                    const tweetResult = item?.item?.itemContent?.tweet_results?.result;
                    const comment = parseCommentFromTweetResult(tweetResult);
                    if (comment && comment.id !== key && !seenCommentIds.has(comment.id)) {
                        seenCommentIds.add(comment.id);
                        comments.push(comment);
                    }
                }
            } else if (entryId.startsWith('tweet-')) {
                const tweetResult = entry?.content?.itemContent?.tweet_results?.result;
                const comment = parseCommentFromTweetResult(tweetResult);
                if (comment && comment.id !== key && !seenCommentIds.has(comment.id)) {
                    seenCommentIds.add(comment.id);
                    comments.push(comment);
                }
            }
        }

        return comments;
    } catch (error) {
        console.warn(`[RapidAPI] Comments fetch failed for tweet ${key}:`, error.message);
        return [];
    }
};

module.exports = {
    rapidGet,
    fetchUserTweets,
    fetchAllUserTweetsSince,
    fetchTweetRetweeters,
    fetchRetweetIdForUser,
    fetchTweetLikers,
    fetchTweetComments,
    searchUsers,
    searchTweets,
    fetchUserProfile,
    fetchTweetDetail,
    normalizeTweet,
    prepareXRequest,
    isKnownXEndpoint
};
