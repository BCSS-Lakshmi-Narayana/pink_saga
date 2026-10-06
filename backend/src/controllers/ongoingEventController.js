const OngoingEvent = require('../models/OngoingEvent');
const cacheService = require('../services/cacheService');

const EVENTS_CACHE_PREFIX = 'ongoing-events:v1';
const invalidateEventsCache = () => cacheService.invalidatePrefix(EVENTS_CACHE_PREFIX);

// @desc    Get all ongoing events
// @route   GET /api/ongoing-events
// @access  Private
const getEvents = async (req, res) => {
    try {
        const { bucket, date } = req.query;
        const cacheKey = `${EVENTS_CACHE_PREFIX}:${bucket || ''}:${date || ''}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', 'private, max-age=15');
            return res.status(200).json(cached);
        }

        const query = {};
        
        if (bucket) {
            if (bucket === 'ONGOING') {
                query.$or = [{ bucket: 'ONGOING' }, { bucket: { $exists: false } }];
            } else {
                query.bucket = bucket;
            }
        }

        if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            
            query.createdAt = {
                $gte: startOfDay,
                $lte: endOfDay
            };
        }

        const events = await OngoingEvent.find(query).sort({ createdAt: -1 });
        await cacheService.set(cacheKey, events, 30);
        res.set('Cache-Control', 'private, max-age=15');
        res.status(200).json(events);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create a new ongoing event
// @route   POST /api/ongoing-events
// @access  Private
const createEvent = async (req, res) => {
    try {
        const { title, type, bucket } = req.body;

        if (!title) {
            return res.status(400).json({ message: 'Title is required' });
        }

        const event = await OngoingEvent.create({
            title,
            type: type || 'OTHER',
            bucket: bucket || 'ONGOING'
        });

        await invalidateEventsCache();
        res.status(201).json(event);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update an ongoing event
// @route   PUT /api/ongoing-events/:id
// @access  Private
const updateEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, type, bucket } = req.body;

        const event = await OngoingEvent.findOne({ id });

        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }

        event.title = title || event.title;
        event.type = type || event.type;
        event.bucket = bucket || event.bucket;
        await event.save();

        await invalidateEventsCache();
        res.status(200).json(event);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Delete an ongoing event
// @route   DELETE /api/ongoing-events/:id
// @access  Private
const deleteEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const event = await OngoingEvent.findOne({ id });

        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }

        await OngoingEvent.deleteOne({ id });

        await invalidateEventsCache();
        res.status(200).json({ message: 'Event deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getEvents,
    createEvent,
    updateEvent,
    deleteEvent
};
