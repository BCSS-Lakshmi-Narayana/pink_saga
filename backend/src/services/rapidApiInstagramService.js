const axios = require('axios');
const blugateClient = require('./blugateClient');

const INSTAGRAM_BASE = `${blugateClient.GATEWAY_BASE}/instagram`;

// ─── Cooldown Tracking (single BluGate client key — no rotation) ──────────
let cooldownUntil = 0;
let failureCount = 0;

const isAvailable = () => Date.now() >= cooldownUntil;

const markSuccess = () => {
    failureCount = 0;
};

const markFailed = (isRateLimit = false) => {
    failureCount++;

    if (isRateLimit) {
        // Exponential cooldown: 60s, 120s, 240s, max 10min
        const cooldownMs = Math.min(60000 * Math.pow(2, failureCount - 1), 600000);
        cooldownUntil = Date.now() + cooldownMs;
        console.warn(`[Instagram] 🔑 BluGate rate-limited. Cooldown ${Math.round(cooldownMs / 1000)}s (failure #${failureCount})`);
    } else {
        // Non-rate-limit errors get a shorter cooldown
        const cooldownMs = Math.min(10000 * failureCount, 120000);
        cooldownUntil = Date.now() + cooldownMs;
    }
};

/**
 * Get a status summary (useful for debugging / health endpoint).
 */
const getKeyHealthStatus = () => {
    return [{
        index: 0,
        key: 'blugate',
        available: isAvailable(),
        failures: failureCount,
        cooldownRemaining: isAvailable() ? 0 : Math.round((cooldownUntil - Date.now()) / 1000)
    }];
};

// ─── Core Request Function (single BluGate credential) ────────────────────
const rapidPost = async (path, data, _retryCount = 0) => {
    const maxRetries = 2; // single credential + one retry for transient errors
    if (_retryCount >= maxRetries) {
        throw new Error(`[Instagram] Request failed after ${_retryCount} retries for ${path}`);
    }

    // If in cooldown, wait for it (short sleep)
    if (!isAvailable()) {
        const waitMs = cooldownUntil - Date.now();
        if (waitMs > 0 && waitMs <= 30000) {
            await new Promise(r => setTimeout(r, waitMs));
        }
    }

    try {
        const response = await axios.post(`${INSTAGRAM_BASE}${path}`, data, {
            headers: {
                ...blugateClient.getHeaders(),
                'Content-Type': 'application/json'
            },
            timeout: 30000, // 30s timeout
            ...blugateClient.responseOptions(),
        });

        markSuccess();
        return response;
    } catch (error) {
        const status = error.response?.status;
        const msg = String(error.response?.data?.message || error.response?.data?.error || error.message || '').toLowerCase();

        // Identify rate-limit scenarios
        const isRateLimit = status === 429 ||
            (status === 403 && (msg.includes('quota') || msg.includes('limit') || msg.includes('exceeded') || msg.includes('rate'))) ||
            msg.includes('too many requests') ||
            msg.includes('rate limit');

        // Only gateway/availability errors are transient. A plain 500 from
        // instagram120 is deterministic (e.g. unknown/private username) — retrying
        // it just duplicates the failed hit on BluGate.
        const isServerError = status === 502 || status === 503 || status === 504;

        if (isRateLimit) {
            // Wait as long as BluGate asks before retrying (a retry fired at once
            // only burns another request); without a hint, use the backoff cooldown.
            const hinted = status === 429 ? blugateClient.retryAfterMs(error, 0) : 0;
            if (hinted > 0 && hinted <= 60000) {
                cooldownUntil = Date.now() + hinted;
                console.warn(`[Instagram] 🔄 Rate limited. Waiting ${Math.round(hinted / 1000)}s then retrying (attempt ${_retryCount + 1}/${maxRetries})`);
                await new Promise((r) => setTimeout(r, hinted));
                return rapidPost(path, data, _retryCount + 1);
            }
            markFailed(true);
            throw error;
        }

        if (isServerError) {
            markFailed(false);
            console.warn(`[Instagram] 🔄 Server error ${status}. Retrying... (attempt ${_retryCount + 1}/${maxRetries})`);
            // Brief delay before retry on server error
            await new Promise(r => setTimeout(r, 2000));
            return rapidPost(path, data, _retryCount + 1);
        }

        // 404 = endpoint doesn't exist — not a credential issue
        if (status === 404) {
            console.error(`[Instagram] BluGate Error (${path}): ${status} — Endpoint '${path}' does not exist`);
            throw error;
        }

        // Non-recoverable error (4xx other than 429/404) — don't retry
        markFailed(false);
        console.error(`[Instagram] BluGate Error (${path}): ${status} — ${error.response?.data?.message || error.message}`);
        throw error;
    }
};

// ─── Public API Methods ────────────────────────────────────────────────────

// Instagram usernames: 1–30 chars of letters, digits, '.' and '_'. Anything
// else (free-text keywords, URLs, blanks) makes instagram120 return a 500, so
// we reject it locally instead of spending a BluGate hit on it.
const INSTAGRAM_USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

const normalizeUsername = (value) => {
    let name = String(value || '').trim();
    const urlMatch = name.match(/instagram\.com\/([^/?#]+)/i);
    if (urlMatch) name = urlMatch[1];
    name = name.replace(/^@/, '').replace(/\/+$/, '');
    return INSTAGRAM_USERNAME_RE.test(name) ? name : null;
};

/**
 * Fetch latest posts for a given username.
 */
const fetchUserPosts = async (username, maxId = "") => {
    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername) return null;

    try {
        const body = { username: cleanUsername };
        if (maxId) body.maxId = maxId;
        const response = await rapidPost('/api/instagram/posts', body);
        return response?.data || null;
    } catch (error) {
        return null;
    }
};

/**
 * Fetch profile information for a given username.
 * `userInfo` and `profile` are both real BluGate endpoints with slightly
 * different payload shapes, so we try userInfo first and fall back to
 * `profile` only when userInfo came back empty or hit a transient error —
 * not when the provider rejected the username (4xx/500), which `profile`
 * would reject too.
 */
const fetchUserProfile = async (username) => {
    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername) return null;

    const endpoints = ['/api/instagram/userInfo', '/api/instagram/profile'];

    for (const path of endpoints) {
        try {
            const response = await rapidPost(path, { username: cleanUsername });
            if (response?.data) {
                return response.data;
            }
        } catch (error) {
            const status = error.response?.status;
            if (status && status !== 429 && status !== 502 && status !== 503 && status !== 504) {
                return null;
            }
        }
    }

    return null;
};

/**
 * Fetch currently active (ephemeral, 24h) stories for a given username.
 */
const fetchUserStories = async (username) => {
    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername) return null;

    try {
        const response = await rapidPost('/api/instagram/stories', { username: cleanUsername });
        return response?.data || null;
    } catch (error) {
        return null;
    }
};

/**
 * Fetch detailed information for a specific Instagram post/reel by shortcode.
 */
const fetchInstagramPostDetail = async (shortcode) => {
    if (!/^[A-Za-z0-9_-]+$/.test(String(shortcode || ''))) return null;
    try {
        const response = await rapidPost('/api/instagram/mediaByShortcode', { shortcode });
        const data = response?.data?.data || response?.data;
        if (!data) return null;

        return {
            id: data.id || shortcode,
            text: data.caption?.text || data.text || '',
            author: data.user?.full_name || data.owner?.full_name || 'Instagram User',
            author_handle: data.user?.username || data.owner?.username || 'instagram',
            author_avatar: data.user?.profile_pic_url || data.owner?.profile_pic_url || '',
            created_at: data.taken_at ? new Date(data.taken_at * 1000) : new Date(),
            media: data.carousel_media || (data.image_versions2 ? [{ url: data.image_versions2.candidates?.[0]?.url, type: 'photo' }] : []),
            metrics: {
                likes: data.like_count || 0,
                comments: data.comment_count || 0,
                views: data.view_count || data.play_count || data.video_play_count || 0
            }
        };
    } catch (error) {
        return null;
    }
};

/**
 * Search Instagram users by query.
 * BluGate's Instagram gateway has no search endpoint — only direct profile lookup.
 */
const searchUsers = async (query) => {
    const cleanQuery = String(query || '').trim().replace(/^@/, '');
    if (!cleanQuery) return [];

    try {
        const profileData = await fetchUserProfile(cleanQuery);
        if (profileData) {
            // Response may nest user data under .data, .result[0].user, .user, or at top level
            const resultArr = profileData.result || profileData.results;
            const raw = Array.isArray(resultArr) ? (resultArr[0]?.user || resultArr[0]) : null;
            const user = raw || profileData.data || profileData.user || profileData;
            if (user.username || user.full_name) {
                console.log(`[Instagram] Found user profile: ${user.username}`);
                return [{
                    id: user.pk || user.pk_id || user.id || '',
                    name: user.full_name || user.username || cleanQuery,
                    screen_name: user.username || cleanQuery,
                    description: user.biography || user.bio_text || user.bio || '',
                    profile_image_url: user.profile_pic_url || user.profile_pic_url_hd || user.hd_profile_pic_url_info?.url || '',
                    followers_count: user.follower_count || user.edge_followed_by?.count || 0,
                    following_count: user.following_count || user.edge_follow?.count || 0,
                    posts_count: user.media_count || user.edge_owner_to_timeline_media?.count || 0,
                    verified: user.is_verified || false,
                    platform: 'instagram'
                }];
            }
        }
    } catch (err) {
        console.warn(`[Instagram] Profile lookup failed for '${cleanQuery}':`, err.message);
    }

    return [];
};

/**
 * Search Instagram posts by keyword.
 * BluGate's Instagram gateway has no hashtag/search endpoint — fetch posts
 * from the user matching the query, which is the closest available proxy.
 */
const IG_DEFAULT_LIMIT = Math.max(1, Math.min(100, parseInt(process.env.IG_SEARCH_PAGE_SIZE || '50', 10)));
const searchPosts = async (query, limit = IG_DEFAULT_LIMIT) => {
    const cleanQuery = String(query || '').trim().replace(/^#/, '');
    if (!cleanQuery) return [];

    try {
        const rawPosts = await fetchUserPosts(cleanQuery);
        if (!rawPosts) return [];

        // Response nests posts under .result.edges or .items
        const edges = rawPosts.result?.edges || rawPosts.edges || rawPosts.items || (Array.isArray(rawPosts) ? rawPosts : []);
        if (!Array.isArray(edges) || edges.length === 0) return [];

        const normalized = edges.slice(0, limit).map(p => {
            const node = p.node || p;
            return {
                id: node.id || node.pk || node.code || node.shortcode || '',
                text: node.caption?.text || node.edge_media_to_caption?.edges?.[0]?.node?.text || node.text || '',
                author: node.user?.full_name || node.owner?.full_name || cleanQuery,
                author_handle: node.user?.username || node.owner?.username || cleanQuery,
                author_avatar: node.user?.profile_pic_url || node.owner?.profile_pic_url || '',
                url: (node.shortcode || node.code)
                    ? `https://www.instagram.com/p/${node.shortcode || node.code}/`
                    : '',
                created_at: node.taken_at
                    ? new Date(node.taken_at * 1000).toISOString()
                    : (node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString() : new Date().toISOString()),
                media: node.image_versions2
                    ? [{ url: node.image_versions2.candidates?.[0]?.url, type: 'photo' }]
                    : (node.display_url ? [{ url: node.display_url, type: 'photo' }]
                    : (node.thumbnail_src ? [{ url: node.thumbnail_src, type: 'photo' }] : [])),
                metrics: {
                    likes: node.like_count || node.edge_liked_by?.count || node.edge_media_preview_like?.count || 0,
                    comments: node.comment_count || node.edge_media_to_comment?.count || 0,
                    views: node.view_count || node.play_count || node.video_view_count || 0
                },
                platform: 'instagram'
            };
        }).filter(p => p.id);

        if (normalized.length > 0) {
            console.log(`[Instagram] Found ${normalized.length} posts for user '${cleanQuery}'`);
        }
        return normalized;
    } catch (err) {
        console.warn(`[Instagram] Posts lookup failed for '${cleanQuery}':`, err.message);
    }

    return [];
};

module.exports = {
    fetchUserPosts,
    fetchUserStories,
    fetchUserProfile,
    fetchInstagramPostDetail,
    searchUsers,
    searchPosts,
    getKeyHealthStatus
};
