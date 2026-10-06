const axios = require('axios');
const Settings = require('../models/Settings');
const blugateClient = require('./blugateClient');

const searchGlobal = async (username) => {
    const results = [];
    const settings = await Settings.findOne();

    // 1. Reddit (Public Search API)
    try {
        const redditRes = await axios.get(`https://www.reddit.com/users/search.json`, {
            params: { q: username, limit: 5 },
            headers: { 'User-Agent': 'BluraHub/1.0' }
        });

        if (redditRes.data && redditRes.data.data && redditRes.data.data.children) {
            redditRes.data.data.children.forEach(child => {
                const user = child.data;
                if (!user.is_suspended) {
                    results.push({
                        platform: 'Reddit',
                        exists: true,
                        url: `https://www.reddit.com/user/${user.name}`,
                        avatar: user.icon_img ? user.icon_img.split('?')[0] : null,
                        description: `u/${user.name} • Karma: ${user.link_karma + user.comment_karma}`
                    });
                }
            });
        }
    } catch (err) {
        if (err.response && err.response.status !== 404) console.error('Reddit search error:', err.message);
    }

    // 2. YouTube
    if (blugateClient.hasCredentials()) {
        try {
            // Use 'search' endpoint instead of 'channels' to find multiple
            const ytRes = await blugateClient.get('youtube', 'search', {
                part: 'snippet',
                q: username,
                type: 'channel',
                maxResults: 5
            });

            if (ytRes.data.items) {
                ytRes.data.items.forEach(item => {
                    results.push({
                        platform: 'YouTube',
                        exists: true,
                        url: `https://www.youtube.com/channel/${item.snippet.channelId}`,
                        avatar: item.snippet.thumbnails.default.url,
                        description: item.snippet.title
                    });
                });
            }
        } catch (err) {
            console.error('YouTube API error:', err.message);
        }
    } else {
        // Fallback: Check standard URL
        try {
            const ytUrl = `https://www.youtube.com/@${username}`;
            const ytRes = await axios.head(ytUrl, { validateStatus: false });
            if (ytRes.status === 200) {
                results.push({
                    platform: 'YouTube',
                    exists: true,
                    url: ytUrl,
                    avatar: null,
                    description: 'YouTube Channel (Verified by URL)'
                });
            }
        } catch (e) { }
    }

    // 3. Twitter / X (API)
    // 3. Twitter / X
    if (settings && settings.x_bearer_token) {
        try {
            const { TwitterApi } = require('twitter-api-v2');
            const twitterClient = new TwitterApi(settings.x_bearer_token);
            const user = await twitterClient.v2.userByUsername(username, { 'user.fields': ['profile_image_url', 'description'] });

            if (user.data) {
                results.push({
                    platform: 'Twitter',
                    exists: true,
                    url: `https://twitter.com/${username}`,
                    avatar: user.data.profile_image_url,
                    description: user.data.description || 'Twitter User'
                });
            }
        } catch (err) {
            // Quietly fail for API errors or 404
        }
    } else {
        // Fallback: Twitter (Best effort HTTP check)
        try {
            const twUrl = `https://twitter.com/${username}`;
            const twRes = await axios.get(twUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
                validateStatus: false
            });
            if (twRes.status === 200 && !twRes.request.path.includes('/login')) {
                results.push({
                    platform: 'Twitter',
                    exists: true,
                    url: twUrl,
                    avatar: null,
                    description: 'Twitter Profile (Potential Match)'
                });
            }
        } catch (e) { }
    }

    // 4. Facebook (Graph API - Basic Existence Check if token available)
    if (settings && settings.facebook_access_token) {
        try {
            // Note: Public search via ID/username is restricted, but we try basic object fetch
            const fbRes = await axios.get(`https://graph.facebook.com/v19.0/${username}`, {
                params: {
                    access_token: settings.facebook_access_token,
                    fields: 'id,name,picture'
                }
            });

            if (fbRes.data && fbRes.data.id) {
                results.push({
                    platform: 'Facebook',
                    exists: true,
                    url: `https://www.facebook.com/${username}`,
                    avatar: fbRes.data.picture?.data?.url || null,
                    description: fbRes.data.name || 'Facebook User'
                });
            }
        } catch (err) {
            // 400/404 means not found or restricted
        }
    } else {
        // Fallback: HTTP Check for Facebook
        try {
            // Facebook pages helpfully return 404 if not found, 200 if found (usually)
            const fbUrl = `https://www.facebook.com/${username}`;
            const fbRes = await axios.get(fbUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                validateStatus: false
            });

            // Check if redirected to login or generic home
            if (fbRes.status === 200 && !fbRes.data.includes('Log In') && !fbRes.request.res.responseUrl.includes('login')) {
                results.push({
                    platform: 'Facebook',
                    exists: true,
                    url: fbUrl,
                    avatar: null,
                    description: 'Facebook Profile found'
                });
            }
        } catch (e) { }
    }

    // 5. Instagram (HTTP Check)
    try {
        // Very strict, usually blocked. 
        const igRes = await axios.get(`https://www.instagram.com/${username}/`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });

        if (igRes.status === 200 && !igRes.data.includes('Login • Instagram')) {
            // Note: Instagram returns 200 for login page too.
            // A simple heuristic: check for some meta tags.
            if (igRes.data.includes('<meta property="og:title"')) {
                results.push({
                    platform: 'Instagram',
                    exists: true,
                    url: `https://www.instagram.com/${username}/`,
                    avatar: null, // Hard to extract without parsing
                    description: 'Instagram Account'
                });
            }
        }
    } catch (err) {
        // 404 is good indicator of Not Found
    }

    return results;
};

module.exports = {
    searchGlobal
};
