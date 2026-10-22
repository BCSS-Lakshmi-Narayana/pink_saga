/**
 * socialChannelsController — Social Media & Communication Channels (Intelligence Brief, second tab).
 *
 *   GET /api/social-channels/overview?days=7    channels, party sentiment, topics, platforms, response strategy
 *
 * `days` is 7, 30 or 90 (default 7). A user restricted to some seats sees only
 * posts and articles located in those seats; events are statewide and shown
 * to statewide users only. Answered from the service's in-memory copy of the
 * posts, so every window and scope returns in milliseconds.
 */
const social = require('../services/socialChannelsService');

const getOverview = async (req, res) => {
    try {
        const asked = parseInt(req.query.days, 10);
        const days = social.WINDOWS.includes(asked) ? asked : 7;
        const data = await social.overview({ days, scope: req.scope });
        return res.json({ success: true, scoped: !!(req.scope && !req.scope.canSeeAll), data });
    } catch (err) {
        console.error('[socialChannels] overview error:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to load social channels overview' });
    }
};

module.exports = { getOverview };
