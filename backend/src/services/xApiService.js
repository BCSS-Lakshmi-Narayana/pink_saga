const { TwitterApi } = require('twitter-api-v2');

let appClient = null;

const getClient = () => {
    if (appClient) return appClient;

    const token = process.env.X_BEARER_TOKEN;
    if (!token) {
        throw new Error('X_BEARER_TOKEN is not configured');
    }

    appClient = new TwitterApi(token);
    return appClient;
};

const userIdCache = new Map();

/**
 * Fetch latest tweets for a user handle
 * @param {string} handle - The Twitter/X handle (e.g., "ElonMusk")
 * @param {number} limit - Number of tweets to fetch (default 10)
 */
const fetchUserTweets = async (handle, limit = 10) => {
    try {
        const client = getClient();
        const cleanHandle = handle.replace('@', '');
        console.log(`[X API] Fetching tweets for ${cleanHandle}...`);

        // 1. Get User ID (Cache Check)
        let userId = userIdCache.get(cleanHandle);

        if (!userId) {
            const user = await client.v2.userByUsername(cleanHandle);
            if (!user.data) {
                console.warn(`[X API] User not found: ${handle}`);
                return [];
            }
            userId = user.data.id;
            userIdCache.set(cleanHandle, userId);
            console.log(`[X API] Cached User ID for ${cleanHandle}: ${userId}`);
        } else {
            console.log(`[X API] Using cached User ID for ${cleanHandle}: ${userId}`);
        }

        // 2. Fetch User Timeline
        // Fields to retrieve: explicit fields needed for our Content model
        const tweets = await client.v2.userTimeline(userId, {
            max_results: Math.min(limit, 100), // Max valid is 100
            'tweet.fields': ['created_at', 'public_metrics', 'entities', 'attachments', 'referenced_tweets'],
            'media.fields': ['url', 'preview_image_url', 'type'],
            expansions: ['attachments.media_keys'],
            exclude: ['replies'] // Focus on original content and retweets? Or just 'replies'? Let's keep retweets.
        });

        // 3. Process and Normalize Data
        if (tweets.rateLimit) {
            console.log(`[X API] Rate Limit: ${tweets.rateLimit.remaining} / ${tweets.rateLimit.limit} (Reset: ${new Date(tweets.rateLimit.reset * 1000).toISOString()})`);
        }

        // Debug: Log structure if data is missing
        if (!tweets.data) {
            console.warn(`[X API] Warning: tweets.data is undefined.`);
        }

        const tweetsData = (tweets.data && Array.isArray(tweets.data)) ? tweets.data : [];
        console.log(`[X API] Raw tweets found: ${tweetsData.length}`);

        const normalizedTweets = [];

        // Includes helper for media expansion
        const mediaMap = new Map();
        if (tweets.includes && tweets.includes.media) {
            tweets.includes.media.forEach(m => mediaMap.set(m.media_key, m));
        }

        for (const tweet of tweetsData) {
            // Normalize media URL if present
            let mediaUrl = '';
            if (tweet.attachments && tweet.attachments.media_keys) {
                const firstMediaKey = tweet.attachments.media_keys[0];
                const mediaObj = mediaMap.get(firstMediaKey);
                if (mediaObj) {
                    mediaUrl = mediaObj.url || mediaObj.preview_image_url || '';
                }
            }

            // Create normalized object similar to what internal Content model expects
            normalizedTweets.push({
                id: tweet.id,
                text: tweet.text,
                url: `https://x.com/${cleanHandle}/status/${tweet.id}`,
                created_at: tweet.created_at,
                media: mediaUrl,
                metrics: {
                    like: (tweet.public_metrics?.like_count || 0).toString(),
                    retweet: (tweet.public_metrics?.retweet_count || 0).toString(),
                    reply: (tweet.public_metrics?.reply_count || 0).toString(),
                    views: (tweet.public_metrics?.impression_count || 0).toString(),
                    quote: (tweet.public_metrics?.quote_count || 0).toString()
                }
            });
        }

        return normalizedTweets;

    } catch (error) {
        console.error(`[X API] Error fetching tweets for ${handle}:`, error.message);
        if (error.code) console.error(`[X API] Code: ${error.code}`);
        if (error.data) console.error(`[X API] Data: ${JSON.stringify(error.data)}`);

        if (error.code === 429 || error.code === 88) {
            console.warn('[X API] Rate limit hit. Backing off.');
        }
        return [];
    }
};

module.exports = {
    fetchUserTweets
};
