const axios = require('axios');
const blugateClient = require('./blugateClient');

const FACEBOOK_BASE = `${blugateClient.GATEWAY_BASE}/facebook`;

// Simple in-memory cooldown to handle BluGate 429s gracefully (single client key — no rotation).
const fbState = {
    cooldownUntil: 0,
    lastCooldownLogAt: 0,
    // Cache page_id resolution so we don't repeatedly call /search/pages for the same URL/slug
    pageIdCache: new Map()
};

const isNumericId = (value) => /^\d+$/.test(String(value || '').trim());

const isProbablyFacebookUrl = (value) => {
    const v = String(value || '').trim();
    if (!v) return false;
    return /^https?:\/\//i.test(v) || /facebook\.com\//i.test(v) || /fb\.me\//i.test(v) || /m\.facebook\.com\//i.test(v);
};

const extractFacebookEntityToken = (value) => {
    const input = String(value || '').trim();
    if (!input) return null;

    // If it's numeric already, treat it as a token/id.
    if (isNumericId(input)) return input;

    // Try parse as URL.
    if (isProbablyFacebookUrl(input)) {
        try {
            const url = new URL(input.startsWith('http') ? input : `https://${input}`);
            const pathname = url.pathname || '';

            // profile.php?id=123
            if (/profile\.php/i.test(pathname)) {
                const id = url.searchParams.get('id');
                if (id) return id;
            }

            // /pages/<name>/<id>
            const pagesMatch = pathname.match(/^\/pages\/(?:[^\/]+)\/([^\/]+)/i);
            if (pagesMatch?.[1]) return pagesMatch[1];

            // /<slug>
            const first = pathname.split('/').filter(Boolean)[0];
            if (first) return first;
        } catch {
            // Fall through
        }
    }

    // Otherwise treat as slug.
    return input;
};

const normalizeFacebookUrlForMatch = (value) => {
    const input = String(value || '').trim();
    if (!input) return '';
    try {
        const url = new URL(input.startsWith('http') ? input : `https://${input}`);
        const host = url.hostname.replace(/^m\./i, '').replace(/^www\./i, 'www.');
        const path = (url.pathname || '').replace(/\/+$/, '');
        // Keep scheme+host+path only (ignore query/hash) so we can match canonical URLs.
        return `https://${host}${path}`.toLowerCase();
    } catch {
        return input.replace(/\/+$/, '').toLowerCase();
    }
};

const getCachedResolvedPageId = (cacheKey) => {
    const v = fbState.pageIdCache.get(cacheKey);
    if (!v) return null;
    if (Date.now() > v.expiresAt) {
        fbState.pageIdCache.delete(cacheKey);
        return null;
    }
    return v.id;
};

const setCachedResolvedPageId = (cacheKey, id) => {
    if (!cacheKey || !id) return;
    // 6 hours TTL
    fbState.pageIdCache.set(cacheKey, { id, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
};

const getCooldownSeconds = () => {
    const v = Number(process.env.RAPIDAPI_FACEBOOK_COOLDOWN_SECONDS);
    return Number.isFinite(v) && v > 0 ? v : 90;
};

const ensureNotCoolingDown = () => {
    const now = Date.now();
    if (now < fbState.cooldownUntil) {
        const secondsLeft = Math.max(1, Math.ceil((fbState.cooldownUntil - now) / 1000));

        // Log at most once per 30s to avoid spam.
        if (now - fbState.lastCooldownLogAt > 30000) {
            fbState.lastCooldownLogAt = now;
            console.warn(`[Facebook] BluGate rate limited. Cooling down ~${secondsLeft}s.`);
        }

        const err = new Error('Facebook BluGate in cooldown (429)');
        err.code = 'FB_RAPIDAPI_COOLDOWN';
        err.retryAfterSeconds = secondsLeft;
        throw err;
    }
};

const markRateLimited = (retryAfterSeconds) => {
    const seconds = Math.max(1, Number(retryAfterSeconds) || getCooldownSeconds());
    fbState.cooldownUntil = Date.now() + seconds * 1000;
    console.warn(`[Facebook] BluGate 429. Cooling down for ${seconds}s.`);
};

const rapidGet = async (path, params) => {
    ensureNotCoolingDown();
    try {
        return await blugateClient.withRateLimitRetry(() => axios.get(`${FACEBOOK_BASE}${path}`, {
            params: blugateClient.cleanParams(params),
            headers: blugateClient.getHeaders(),
            timeout: 20000,
            ...blugateClient.responseOptions(),
        }), { retries: 1, label: 'BluGate Facebook' });
    } catch (error) {
        const status = error?.response?.status;

        if (status === 429) {
            // Still limited after the in-place retry: cool down for as long as BluGate asks.
            markRateLimited(Math.ceil(blugateClient.retryAfterMs(error, getCooldownSeconds() * 1000) / 1000));
        }

        throw error;
    }
};

const resolveUsablePageId = async (pageIdOrUrl) => {
    const input = String(pageIdOrUrl || '').trim();
    if (!input) return null;
    if (isNumericId(input)) return input;

    const cacheKey = `resolve:${input}`;
    const cached = getCachedResolvedPageId(cacheKey);
    if (cached) return cached;

    const token = extractFacebookEntityToken(input);
    if (!token) return null;

    // If token itself is numeric, return it.
    if (isNumericId(token)) {
        setCachedResolvedPageId(cacheKey, token);
        return token;
    }

    // Exact lookup first: BluGate's /page/page_id resolves the page's own URL
    // (e.g. facebook.com/<page-name> → 100044269997657). The fuzzy page search
    // below can pick a similarly named page, so it is only the fallback.
    try {
        const pageUrl = isProbablyFacebookUrl(input) ? input : `https://www.facebook.com/${token}`;
        const exact = await rapidGet('/page/page_id', { url: pageUrl });
        const exactId = exact?.data?.page_id || exact?.data?.id;
        if (exactId && isNumericId(String(exactId))) {
            setCachedResolvedPageId(cacheKey, String(exactId));
            return String(exactId);
        }
    } catch (_) { /* fall back to search */ }

    // Search by slug/token and pick the first match that has an id.
    const results = await searchPages(token);
    let best = null;
    if (isProbablyFacebookUrl(input)) {
        const wanted = normalizeFacebookUrlForMatch(input);
        best = (results || []).find((r) => r?.url && normalizeFacebookUrlForMatch(r.url) === wanted);
    }
    best = best || (results || []).find((r) => r?.id) || (results || [])[0];
    const id = best?.id;
    if (id) setCachedResolvedPageId(cacheKey, id);
    return id || null;
};

const fetchPageDetails = async (pageIdOrUrl, options = {}) => {
    try {
        // The current RapidAPI provider we use exposes /search/pages and /page/posts.
        // It does NOT expose /page/info, so we resolve basic page details via search.
        const input = String(pageIdOrUrl || '').trim();
        if (!input) return null;

        // If numeric already, we can still return a minimal object.
        if (isNumericId(input)) {
            return { id: input, name: null, image: null, url: null, is_verified: null };
        }

        const token = extractFacebookEntityToken(input);
        if (!token) return null;

        const results = await searchPages(token, options);
        let best = null;
        if (isProbablyFacebookUrl(input)) {
            const wanted = normalizeFacebookUrlForMatch(input);
            best = (results || []).find((r) => r?.url && normalizeFacebookUrlForMatch(r.url) === wanted);
        }
        best = best || (results || []).find((r) => r?.id) || (results || [])[0];
        if (!best) return null;

        return {
            name: best.name || null,
            id: best.id || null,
            image: best.profile_image_url || null,
            url: best.url || null,
            is_verified: best.verified ?? null,
            about: best.description || null,
            followers: best.followers_count || 0,
            likes: best.likes_count || 0
        };
    } catch (error) {
        if (options?.throwOnCooldown && (error?.code === 'FB_RAPIDAPI_COOLDOWN' || error?.response?.status === 429)) {
            throw error;
        }
        if (error?.code === 'FB_RAPIDAPI_COOLDOWN') return null;
        console.error(`[Facebook] Error fetching page details for ${pageIdOrUrl}:`, error.message);
        return null;
    }
};

const fetchPagePosts = async (pageIdOrUrl, limit = 10, pageName = null, options = {}) => {
    try {
        const input = String(pageIdOrUrl || '').trim();

        const fetchRaw = async (params) => {
            // Provider requires `page_id` (numeric Facebook ID). `page_url` is not supported.
            const response = await rapidGet('/page/posts', { ...params, depth: 1, limit });
            return response.data?.results || response.data?.posts || [];
        };

        // Always attempt with a numeric page_id.
        // - If input is numeric: use directly.
        // - Else: resolve via /search/pages -> facebook_id.
        const resolvedId = isNumericId(input) ? input : await resolveUsablePageId(input);
        if (!resolvedId) return [];

        const rawPosts = await fetchRaw({ page_id: resolvedId });

        const safeRawPosts = Array.isArray(rawPosts) ? rawPosts : [];

        // Map to standard format
        return safeRawPosts.slice(0, limit).map(post => ({
            id: post.post_id || post.id,
            text: post.text || post.message || post.caption || '',
            url: post.url || post.post_url,
            created_at: (() => {
                const dateValue = post.time || post.timestamp || post.created_time;
                if (!dateValue) return null;
                if (typeof dateValue === 'number') {
                    // Provider returns unix seconds
                    const ms = dateValue < 1e12 ? dateValue * 1000 : dateValue;
                    const d = new Date(ms);
                    return isNaN(d) ? null : d;
                }
                const d = new Date(dateValue);
                return isNaN(d) ? null : d;
            })(),
            author_id: post.author?.id || post.owner_id || post.user_id || post.from?.id || resolvedId,
            // Provider returns an `author` object
            author_name: post.author?.name || post.owner_name || post.author_name || post.page_name || post.name || post.from?.name || post.user?.name || pageName || pageIdOrUrl,
            type: post.type || 'post',
            media: post.images || (post.video ? [post.video] : []) || [],
            engagement: {
                likes: post.likes || post.reactions?.likes || post.reactions_count || post.reaction_count || 0,
                comments: post.comments || post.comments_count || post.comment_count || 0,
                shares: post.shares || post.shares_count || post.share_count || post.reshare_count || 0,
                views: post.views || post.view_count || 0
            }
        }));

    } catch (error) {
        if (options?.throwOnCooldown && (error?.code === 'FB_RAPIDAPI_COOLDOWN' || error?.response?.status === 429)) {
            throw error;
        }
        if (error?.code === 'FB_RAPIDAPI_COOLDOWN') return [];
        console.error(`[Facebook] Error fetching posts for ${pageIdOrUrl}:`, error.message);
        return [];
    }
};

const fetchPostComments = async (postId, limit = 20, options = {}) => {
    if (!String(postId || '').trim()) return [];
    try {
        const response = await rapidGet('/post/comments', { post_id: postId });

        const rawComments = response.data?.results || response.data?.comments || [];
        
        return rawComments.slice(0, limit).map(comment => ({
            id: comment.comment_id || comment.id,
            text: comment.text || comment.message || '',
            author_id: comment.owner_id || comment.author_id,
            author_name: comment.owner_name || comment.author_name || 'Unknown',
            author_image: comment.owner_pic || comment.author_pic,
            created_at: (() => {
                const dateValue = comment.time || comment.timestamp || comment.created_time;
                if (!dateValue) return null;
                if (typeof dateValue === 'number') {
                    const ms = dateValue < 1e12 ? dateValue * 1000 : dateValue;
                    const d = new Date(ms);
                    return isNaN(d) ? null : d;
                }
                const d = new Date(dateValue);
                return isNaN(d) ? null : d;
            })(),
            likes: comment.likes || 0,
            replies_count: comment.replies || 0
        }));

    } catch (error) {
        if (options?.throwOnCooldown && (error?.code === 'FB_RAPIDAPI_COOLDOWN' || error?.response?.status === 429)) {
            throw error;
        }
        if (error.response?.status === 404) return [];
        if (error?.code === 'FB_RAPIDAPI_COOLDOWN') return [];
        console.error(`[Facebook] Error fetching comments for ${postId}:`, error.message);
        return [];
    }
};

// Search for Facebook pages
const searchPages = async (query, options = {}) => {
    if (!String(query || '').trim()) return [];
    try {
        const response = await rapidGet('/search/pages', { query, limit: 20 });

        const rawResults = response.data?.results || response.data?.pages || response.data || [];
        
        return rawResults.map(page => ({
            // Provider returns `facebook_id` + `profile_url` + `image` object
            id: page.facebook_id || page.page_id || page.id,
            name: page.name || page.title || 'Unknown Page',
            screen_name: page.username || page.screen_name || page.facebook_id || page.page_id || page.id,
            description: page.about || page.description || '',
            profile_image_url: page.image?.uri || page.image || page.profile_pic || page.picture || '',
            followers_count: page.followers_count || page.followers || 0,
            likes_count: page.likes_count || page.likes || 0,
            verified: page.is_verified || false,
            url: page.profile_url || page.url || `https://facebook.com/${page.facebook_id || page.page_id || page.id}`,
            platform: 'facebook'
        }));

    } catch (error) {
        if (options?.throwOnCooldown && (error?.code === 'FB_RAPIDAPI_COOLDOWN' || error?.response?.status === 429)) {
            throw error;
        }
        if (error?.code === 'FB_RAPIDAPI_COOLDOWN') return [];
        console.error(`[Facebook] Error searching pages:`, error.message);
        return [];
    }
};

// Search for Facebook posts
const FB_DEFAULT_LIMIT = Math.max(1, Math.min(100, parseInt(process.env.FB_SEARCH_PAGE_SIZE || '50', 10)));
const searchPosts = async (query, limit = FB_DEFAULT_LIMIT, options = {}) => {
    if (!String(query || '').trim()) return [];
    try {
        const response = await rapidGet('/search/posts', { query, limit });

        const rawPosts = response.data?.results || response.data?.posts || response.data || [];
        
        return rawPosts.slice(0, limit).map(post => {
            // Safe date parsing
            let createdAt = null;
            try {
                if (post.time || post.timestamp || post.created_time) {
                    const dateValue = post.time || post.timestamp || post.created_time;
                    // Handle Unix timestamp (seconds)
                    const parsedDate = typeof dateValue === 'number' 
                        ? new Date(dateValue * 1000) 
                        : new Date(dateValue);
                    if (!isNaN(parsedDate)) {
                        createdAt = parsedDate;
                    }
                }
            } catch (e) {
                // Invalid date, skip
            }

            // Extract media URLs
            const media = [];
            if (post.images && Array.isArray(post.images)) {
                media.push(...post.images);
            }
            if (post.video) {
                media.push(post.video);
            }
            if (post.image) {
                media.push(post.image);
            }

            // Build author name with multiple fallbacks
            const authorName =
                post.owner_name ||
                post.author_name ||
                post.page_name ||
                post.name ||
                post.from?.name ||
                post.user?.name ||
                (typeof post.author === 'string' ? post.author : post.author?.name) ||
                post.owner_id ||
                post.page_id ||
                'Facebook User';

            return {
                id: post.post_id || post.id,
                text: post.text || post.message || post.caption || '',
                created_at: createdAt,
                media: media,
                author: authorName,
                author_handle: post.owner_id || post.page_id || post.user_id || authorName,
                author_avatar: post.owner_pic || post.author_pic || post.profile_pic || post.author?.profile_picture_url || '',
                url: post.url || post.post_url || `https://facebook.com/${post.post_id || post.id}`,
                metrics: {
                    likes: post.likes || post.reactions?.total || post.reaction_count || 0,
                    comments: post.comments || post.comments_count || post.comment_count || 0,
                    shares: post.shares || post.shares_count || post.share_count || 0,
                    views: post.views || post.view_count || 0
                },
                platform: 'facebook'
            };
        });

    } catch (error) {
        if (options?.throwOnCooldown && (error?.code === 'FB_RAPIDAPI_COOLDOWN' || error?.response?.status === 429)) {
            throw error;
        }
        if (error?.code === 'FB_RAPIDAPI_COOLDOWN') return [];
        console.error(`[Facebook] Error searching posts:`, error.message);
        return [];
    }
};

module.exports = {
    fetchPageDetails,
    fetchPagePosts,
    fetchPostComments,
    searchPages,
    searchPosts
};
