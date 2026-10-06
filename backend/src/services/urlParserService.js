/**
 * URL Parser Service
 * Detects platform and extracts post/video/tweet IDs from URLs
 */

/**
 * Detect platform and extract post ID from a URL
 * @param {string} url - The URL to parse
 * @returns {{ platform: string, postId: string, authorHandle: string | null } | null}
 */
const parsePostUrl = (url) => {
    if (!url || typeof url !== 'string') return null;

    const trimmedUrl = url.trim();
    if (!trimmedUrl) return null;

    // Try each platform parser
    const youtubeResult = parseYouTubeUrl(trimmedUrl);
    if (youtubeResult) return youtubeResult;

    const xResult = parseXTwitterUrl(trimmedUrl);
    if (xResult) return xResult;

    const facebookResult = parseFacebookUrl(trimmedUrl);
    if (facebookResult) return facebookResult;

    const redditResult = parseRedditUrl(trimmedUrl);
    if (redditResult) return redditResult;

    return null;
};

/**
 * Parse YouTube URLs
 * Supports: youtube.com/watch?v=xxx, youtu.be/xxx, youtube.com/shorts/xxx, youtube.com/live/xxx
 */
const parseYouTubeUrl = (url) => {
    try {
        // Handle youtu.be short links
        const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        if (shortMatch) {
            return {
                platform: 'youtube',
                postId: shortMatch[1],
                authorHandle: null
            };
        }

        // Handle youtube.com URLs
        if (!url.includes('youtube.com')) return null;

        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);

        // Standard watch URL: youtube.com/watch?v=xxx
        if (urlObj.pathname === '/watch' || urlObj.pathname.startsWith('/watch')) {
            const videoId = urlObj.searchParams.get('v');
            if (videoId && videoId.length === 11) {
                return {
                    platform: 'youtube',
                    postId: videoId,
                    authorHandle: null
                };
            }
        }

        // Shorts: youtube.com/shorts/xxx
        const shortsMatch = urlObj.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
        if (shortsMatch) {
            return {
                platform: 'youtube',
                postId: shortsMatch[1],
                authorHandle: null
            };
        }

        // Live: youtube.com/live/xxx
        const liveMatch = urlObj.pathname.match(/\/live\/([a-zA-Z0-9_-]{11})/);
        if (liveMatch) {
            return {
                platform: 'youtube',
                postId: liveMatch[1],
                authorHandle: null
            };
        }

        // Embed: youtube.com/embed/xxx
        const embedMatch = urlObj.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
        if (embedMatch) {
            return {
                platform: 'youtube',
                postId: embedMatch[1],
                authorHandle: null
            };
        }

        return null;
    } catch (e) {
        return null;
    }
};

/**
 * Parse X/Twitter URLs
 * Supports: twitter.com/user/status/xxx, x.com/user/status/xxx
 */
const parseXTwitterUrl = (url) => {
    try {
        // Match both twitter.com and x.com
        const tweetMatch = url.match(/(?:twitter\.com|x\.com)\/([^\/]+)\/status\/(\d+)/i);
        if (tweetMatch) {
            return {
                platform: 'x',
                postId: tweetMatch[2],
                authorHandle: tweetMatch[1]
            };
        }

        return null;
    } catch (e) {
        return null;
    }
};

/**
 * Parse Facebook URLs
 * Supports: facebook.com/xxx/posts/yyy, facebook.com/xxx/videos/yyy, fb.watch/xxx
 */
const parseFacebookUrl = (url) => {
    try {
        // fb.watch short links
        const fbWatchMatch = url.match(/fb\.watch\/([a-zA-Z0-9_-]+)/i);
        if (fbWatchMatch) {
            return {
                platform: 'facebook',
                postId: fbWatchMatch[1],
                authorHandle: null,
                isShortLink: true
            };
        }

        if (!url.includes('facebook.com') && !url.includes('fb.com')) return null;

        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        const pathname = urlObj.pathname;

        // Posts: /xxx/posts/yyy or /permalink.php?story_fbid=xxx&id=yyy
        const postsMatch = pathname.match(/\/([^\/]+)\/posts\/([^\/\?]+)/i);
        if (postsMatch) {
            return {
                platform: 'facebook',
                postId: postsMatch[2],
                authorHandle: postsMatch[1]
            };
        }

        // Videos: /xxx/videos/yyy
        const videosMatch = pathname.match(/\/([^\/]+)\/videos\/([^\/\?]+)/i);
        if (videosMatch) {
            return {
                platform: 'facebook',
                postId: videosMatch[2],
                authorHandle: videosMatch[1]
            };
        }

        // Photos: /xxx/photos/yyy
        const photosMatch = pathname.match(/\/([^\/]+)\/photos\/[^\/]+\/(\d+)/i);
        if (photosMatch) {
            return {
                platform: 'facebook',
                postId: photosMatch[2],
                authorHandle: photosMatch[1]
            };
        }

        // Reel: /reel/xxx
        const reelMatch = pathname.match(/\/reel\/(\d+)/i);
        if (reelMatch) {
            return {
                platform: 'facebook',
                postId: reelMatch[1],
                authorHandle: null
            };
        }

        // Watch: /watch/?v=xxx or /watch/live/?v=xxx
        const watchVideoId = urlObj.searchParams.get('v');
        if (pathname.includes('/watch') && watchVideoId) {
            return {
                platform: 'facebook',
                postId: watchVideoId,
                authorHandle: null
            };
        }

        // story_fbid format: /permalink.php?story_fbid=xxx&id=yyy
        const storyFbId = urlObj.searchParams.get('story_fbid');
        const pageId = urlObj.searchParams.get('id');
        if (storyFbId) {
            return {
                platform: 'facebook',
                postId: storyFbId,
                authorHandle: pageId || null
            };
        }

        return null;
    } catch (e) {
        return null;
    }
};

/**
 * Parse Reddit URLs
 * Supports: reddit.com/r/<sub>/comments/<id>/..., reddit.com/comments/<id>/..., redd.it/<id>
 */
const parseRedditUrl = (url) => {
    try {
        // redd.it short links
        const shortMatch = url.match(/redd\.it\/([a-zA-Z0-9]+)/i);
        if (shortMatch) {
            return {
                platform: 'reddit',
                postId: shortMatch[1],
                authorHandle: null
            };
        }

        if (!url.includes('reddit.com')) return null;

        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        const pathname = urlObj.pathname;

        // /r/<sub>/comments/<id>/...
        const commentsMatch = pathname.match(/\/r\/[^\/]+\/comments\/([a-zA-Z0-9]+)/i);
        if (commentsMatch) {
            return {
                platform: 'reddit',
                postId: commentsMatch[1],
                authorHandle: null
            };
        }

        // /comments/<id>/...
        const directMatch = pathname.match(/\/comments\/([a-zA-Z0-9]+)/i);
        if (directMatch) {
            return {
                platform: 'reddit',
                postId: directMatch[1],
                authorHandle: null
            };
        }

        return null;
    } catch (e) {
        return null;
    }
};

/**
 * Get display name for a platform
 */
const getPlatformDisplayName = (platform) => {
    const names = {
        'youtube': 'YouTube',
        'x': 'X (Twitter)',
        'facebook': 'Facebook',
        'reddit': 'Reddit'
    };
    return names[platform] || platform;
};

module.exports = {
    parsePostUrl,
    parseYouTubeUrl,
    parseXTwitterUrl,
    parseFacebookUrl,
    parseRedditUrl,
    getPlatformDisplayName
};
