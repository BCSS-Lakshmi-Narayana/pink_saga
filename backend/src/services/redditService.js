const axios = require('axios');

const REDDIT_API_URL = 'https://www.reddit.com';

// Reddit strictly requires a unique User-Agent
const HEADERS = {
    'User-Agent': 'BluraHub/1.0.0 (by /u/BluraHubDev)'
};

const safeDate = (utcSeconds) => {
    if (!utcSeconds) return new Date().toISOString();
    try {
        const date = new Date(utcSeconds * 1000);
        return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    } catch (e) {
        return new Date().toISOString();
    }
};

/**
 * Search Reddit Users
 * @param {string} query 
 * @returns {Promise<Array>} Normalized user objects
 */
const searchUsers = async (query) => {
    try {
        const url = `${REDDIT_API_URL}/users/search.json`;
        const response = await axios.get(url, {
            params: { q: query, limit: 25 },
            headers: HEADERS
        });

        const users = response.data?.data?.children || [];

        return users.map(user => {
            const data = user.data;
            return {
                id: data.id,
                name: data.name, // Display name (e.g., 'news')
                screen_name: data.name, // Handle (e.g., 'news')
                description: data.public_description || data.subreddit?.public_description || '',
                followers_count: data.subreddit?.subscribers || 0,
                profile_image_url: data.icon_img || data.subreddit?.icon_img,
                created_at: safeDate(data.created_utc),
                url: `https://www.reddit.com/user/${data.name}`,
                _platform: 'reddit'
            };
        });
    } catch (error) {
        console.error('Reddit User Search Error:', error.message);
        return [];
    }
};

/**
 * Search Reddit Posts (Content)
 * @param {string} query 
 * @returns {Promise<Array>} Normalized content objects
 */
const searchPosts = async (query) => {
    try {
        const url = `${REDDIT_API_URL}/search.json`;
        const response = await axios.get(url, {
            params: { q: query, limit: 25, sort: 'new' }, // Sort by new to get latest
            headers: HEADERS
        });

        const posts = response.data?.data?.children || [];

        return posts.map(post => {
            const data = post.data;
            return {
                id: data.id,
                text: data.title + (data.selftext ? `\n\n${data.selftext.substring(0, 200)}...` : ''),
                url: `https://www.reddit.com${data.permalink}`,
                author: data.author,
                author_handle: data.author,
                author_avatar: null,
                created_at: safeDate(data.created_utc),
                metrics: {
                    likes: data.ups, // Upvotes
                    comments: data.num_comments,
                    views: data.view_count || 0,
                    retweets: 0 // Not applicable
                },
                _platform: 'reddit'
            };
        });
    } catch (error) {
        console.error('Reddit Content Search Error:', error.message);
        return [];
    }
};

module.exports = {
    searchUsers,
    searchPosts
};
