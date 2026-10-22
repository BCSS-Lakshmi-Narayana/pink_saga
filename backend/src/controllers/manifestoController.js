/**
 * manifestoController — Manifesto tracker (Intelligence Brief, third tab).
 *
 *   GET /api/manifesto/overview?days=7|30|90    status, reach and sentiment of every tracked scheme, both sides
 *
 * A user restricted to some seats sees only posts and articles located in
 * those seats. Answered from the Social & Channels in-memory copy.
 */
const manifesto = require('../services/manifestoService');
const { WINDOWS } = require('../services/socialChannelsService');

const getOverview = async (req, res) => {
    try {
        const asked = parseInt(req.query.days, 10);
        const days = WINDOWS.includes(asked) ? asked : 7;
        const data = await manifesto.overview({ days, scope: req.scope });
        return res.json({ success: true, scoped: !!(req.scope && !req.scope.canSeeAll), data });
    } catch (err) {
        console.error('[manifesto] overview error:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to load the manifesto tracker' });
    }
};

module.exports = { getOverview };
