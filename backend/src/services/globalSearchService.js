const rapidApiXService = require('./rapidApiXService');
const rapidApiFacebookService = require('./rapidApiFacebookService');
const rapidApiInstagramService = require('./rapidApiInstagramService');
const youtubeService = require('./youtube.service');
const redditService = require('./redditService');
const blugateClient = require('./blugateClient');

class GlobalSearchService {
    constructor() {
        this.weights = {
            recency: 0.7,
            engagement: 0.2,
            platform: 0.1
        };

        this.platformBoost = {
            'x': 1.2, // Boost X for real-time news
            'youtube': 1.0,
            'facebook': 0.9,
            'instagram': 0.95,
            'reddit': 0.8
        };
    }

    /**
     * Search Profiles across all platforms
     */
    async searchProfiles(query, limit = 20) {
        const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
        console.log(`[GlobalSearch] Searching profiles for: ${query}`);
        // X fallback: RapidAPI X -> Official X API -> Scraper
        let xResults = [];
        let xError = null;
        try {
            xResults = await rapidApiXService.searchUsers(query, safeLimit);
        } catch (e) {
            xError = e;
        }
        if ((!xResults || xResults.length === 0) && process.env.X_BEARER_TOKEN) {
            try {
                const xApiService = require('./xApiService');
                // Official API only supports fetch by user, so try as username
                const tweets = await xApiService.fetchUserTweets(query, 1);
                if (tweets && tweets.length > 0) {
                    xResults = [{
                        id: tweets[0].author_id || tweets[0].id,
                        name: tweets[0].author || query,
                        screen_name: tweets[0].author_handle || query,
                        description: '',
                        profile_image_url: tweets[0].author_avatar || '',
                        followers_count: 0,
                        verified: tweets[0].is_verified || false,
                        platform: 'x'
                    }];
                }
            } catch (e) {
                xError = e;
            }
        }
        if ((!xResults || xResults.length === 0) && (!blugateClient.hasCredentials() && !process.env.X_BEARER_TOKEN)) {
            try {
                const { scrapeProfile, getHealthyAccount } = require('./scraperService');
                const account = await getHealthyAccount();
                if (account) {
                    const tweets = await scrapeProfile(query, account);
                    if (tweets && tweets.length > 0) {
                        xResults = [{
                            id: tweets[0].author_id || tweets[0].id,
                            name: tweets[0].author || query,
                            screen_name: tweets[0].author_handle || query,
                            description: '',
                            profile_image_url: tweets[0].author_avatar || '',
                            followers_count: 0,
                            verified: tweets[0].is_verified || false,
                            platform: 'x'
                        }];
                    }
                }
            } catch (e) {
                xError = e;
            }
        }
        const results = await Promise.allSettled([
            Promise.resolve(this.normalizeList(xResults, 'x', 'user')),
            youtubeService.searchChannels(query, safeLimit).then(res => this.normalizeList(res, 'youtube', 'user')),
            rapidApiFacebookService.searchPages(query, { limit: safeLimit }).then(res => this.normalizeList(res, 'facebook', 'user')),
            rapidApiInstagramService.searchUsers(query, safeLimit).then(res => this.normalizeList(res, 'instagram', 'user')),
            redditService.searchUsers(query, safeLimit).then(res => this.normalizeList(res, 'reddit', 'user'))
        ]);
        const flatResults = results
            .filter(r => r.status === 'fulfilled')
            .flatMap(r => r.value);
        return this.rankResults(flatResults, 'user').slice(0, safeLimit);
    }

    /**
     * Search Content across all platforms
     */
    async searchContent(query, limit = 20) {
        const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
        console.log(`[GlobalSearch] Searching content for: ${query}`);
        // X fallback: RapidAPI X -> Official X API -> Scraper
        let xResults = [];
        let xError = null;
        try {
            xResults = await rapidApiXService.searchTweets(query, safeLimit);
        } catch (e) {
            xError = e;
        }
        if ((!xResults || xResults.length === 0) && process.env.X_BEARER_TOKEN) {
            try {
                const xApiService = require('./xApiService');
                // Official API only supports fetch by user, so try as username
                const tweets = await xApiService.fetchUserTweets(query, safeLimit);
                xResults = tweets || [];
            } catch (e) {
                xError = e;
            }
        }
        if ((!xResults || xResults.length === 0) && (!blugateClient.hasCredentials() && !process.env.X_BEARER_TOKEN)) {
            try {
                const { scrapeProfile, getHealthyAccount } = require('./scraperService');
                const account = await getHealthyAccount();
                if (account) {
                    const tweets = await scrapeProfile(query, account);
                    xResults = tweets || [];
                }
            } catch (e) {
                xError = e;
            }
        }
        const results = await Promise.allSettled([
            Promise.resolve(this.normalizeList(xResults, 'x', 'post')),
            youtubeService.searchVideos(query, safeLimit).then(res => this.normalizeList(res, 'youtube', 'video')),
            rapidApiFacebookService.searchPosts(query, safeLimit).then(res => this.normalizeList(res, 'facebook', 'post')),
            redditService.searchPosts(query, safeLimit).then(res => this.normalizeList(res, 'reddit', 'post'))
        ]);
        const flatResults = results
            .filter(r => r.status === 'fulfilled')
            .flatMap(r => r.value);
        return this.rankResults(flatResults, 'content').slice(0, safeLimit);
    }

    /**
     * Normalize a list of items
     */
    normalizeList(items, platform, type) {
        if (!Array.isArray(items)) return [];
        return items.map(item => this.normalizeItem(item, platform, type)).filter(Boolean);
    }

    /**
     * Normalize a single item to the Global Search Schema
     */
    normalizeItem(item, platform, type) {
        try {
            const normalized = {
                id: item.id || item.post_id,
                type: type,
                platform: platform,
                title: item.title || item.name || item.author_name || item.author || '',
                description: item.description || item.text || item.about || '',
                url: item.url || item.profile_url || item.post_url || '',

                // Author Info
                author: {
                    name: item.author_name || item.name || item.author || 'Unknown',
                    handle: item.screen_name || item.author_handle || item.author_id || '',
                    avatar: item.profile_image_url || item.author_avatar || item.author_image || item.thumbnails?.default?.url || '',
                    verified: item.verified || item.is_verified || false
                },

                // Media
                media: this.extractMedia(item, platform),
                thumbnail: item.thumbnails?.medium?.url || item.image || item.profile_image_url || '',

                // Engagement
                engagement: {
                    likes: parseInt(item.likes_count || item.metrics?.likes || item.statistics?.likeCount || 0),
                    comments: parseInt(item.metrics?.comments || item.statistics?.commentCount || 0),
                    shares: parseInt(item.metrics?.shares || item.metrics?.retweets || 0),
                    views: parseInt(item.metrics?.views || item.statistics?.viewCount || 0),
                    followers: parseInt(item.followers_count || item.statistics?.subscriberCount || 0)
                },

                // Timestamp
                timestamp: item.created_at || item.publishedAt || item.timestamp || new Date().toISOString()
            };

            // Calculate total engagement score for ranking
            normalized.scoreData = {
                totalEngagement: normalized.engagement.likes +
                    (normalized.engagement.comments * 2) +
                    (normalized.engagement.shares * 3),
                freshness: this.calculateFreshness(normalized.timestamp),
                platformBoost: this.platformBoost[platform] || 1.0
            };

            // Legacy compatibility fields (for frontend transitioning)
            normalized._platform = platform;
            normalized.name = normalized.title;
            normalized.text = normalized.description;
            normalized.profile_image_url = normalized.author.avatar;
            normalized.screen_name = normalized.author.handle;
            normalized.followers_count = normalized.engagement.followers;
            normalized.metrics = normalized.engagement;
            normalized.statistics = {
                likeCount: normalized.engagement.likes,
                viewCount: normalized.engagement.views,
                commentCount: normalized.engagement.comments,
                subscriberCount: normalized.engagement.followers
            };

            return normalized;
        } catch (e) {
            console.error(`Error normalizing ${platform} item:`, e.message);
            return null;
        }
    }

    extractMedia(item, platform) {
        if (platform === 'youtube') {
            return [{
                type: 'video',
                url: `https://youtube.com/watch?v=${item.id}`,
                preview: item.thumbnails?.medium?.url
            }];
        }

        if (item.media && Array.isArray(item.media)) {
            return item.media.map(m => ({
                type: m.type || 'image',
                url: m.url || m,
                preview: m.preview || m.url || m
            }));
        }

        return [];
    }

    calculateFreshness(dateStr) {
        if (!dateStr) return 0;
        const date = new Date(dateStr);
        const now = new Date();
        const diffHours = (now - date) / (1000 * 60 * 60);

        // Decay function: 1 / (hours + 2)
        // Recent items get high score (0.5 max), older items decay fast
        if (diffHours < 0) return 0.5; // Future/Now
        return 1 / (diffHours + 2);
    }

    rankResults(items, type) {
        if (!items || items.length === 0) return [];

        return items.sort((a, b) => {
            // Rank Profile/Users mainly by followers + platform
            if (type === 'user') {
                const scoreA = (a.engagement.followers * 0.8) + (a.scoreData.platformBoost * 1000);
                const scoreB = (b.engagement.followers * 0.8) + (b.scoreData.platformBoost * 1000);
                return scoreB - scoreA;
            }

            // Content: sort by most recent first, with light engagement tiebreaker
            const timeA = new Date(a.timestamp || 0).getTime();
            const timeB = new Date(b.timestamp || 0).getTime();
            if (timeA !== timeB) return timeB - timeA;
            return (b.scoreData?.totalEngagement || 0) - (a.scoreData?.totalEngagement || 0);
        });
    }
}

module.exports = new GlobalSearchService();
