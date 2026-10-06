const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const LiveStream = require('../models/LiveStream');
const LiveChatMessage = require('../models/LiveChatMessage');
const YouTubeLiveSettings = require('../models/YouTubeLiveSettings');
const liveService = require('../services/youtubeLiveService');
const reader = require('../services/youtubeLiveChatReader');
const User = require('../models/User');
const { getJwtSecret } = require('../config/jwtSecret');
const { protect } = require('../middleware/authMiddleware');
const { loadScope } = require('../middleware/scopeMiddleware');
const { requireAnyPageAccess } = require('../middleware/rbacMiddleware');

/* ══════════════════════════════════════════════════════════════
   SSE — must be declared BEFORE the router-level `protect`, because
   EventSource cannot send an Authorization header. Auth comes from
   ?token= instead, verified with the same secret as authMiddleware.
   ══════════════════════════════════════════════════════════════ */

router.get('/stream', async (req, res) => {
    try {
        const token = String(req.query.token || '').trim();
        if (!token) return res.status(401).json({ message: 'Not authorized, no token' });

        const decoded = jwt.verify(token, getJwtSecret());
        const user = await User.findOne({ id: decoded.user_id }).select('-password');
        if (!user) return res.status(401).json({ message: 'Not authorized, user not found' });

        const streamFilter = String(req.query.stream_id || '').trim() || null;

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no', // nginx: don't buffer SSE
        });
        res.write('retry: 5000\n\n');

        let closed = false;

        /**
         * Writing to a socket the client has already dropped (laptop sleeps,
         * network drops, tab closes mid-flush) throws or emits 'error' on the
         * response. Unguarded, that surfaces as an unhandled rejection.
         */
        const write = (chunk) => {
            if (closed || res.writableEnded || res.destroyed) return;
            try {
                res.write(chunk);
            } catch (err) {
                cleanup();
            }
        };

        const send = (event, payload) => {
            if (streamFilter && payload.stream_id && payload.stream_id !== streamFilter) return;
            write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        };

        const onMessages = (p) => send('messages', p);
        const onUpdate = (p) => send('message:update', p);
        const onStatus = (p) => send('stream:status', p);
        const onAvailable = (p) => send('stream:available', p);
        const onCounts = (p) => send('stream:counts', p);

        liveService.bus.on('messages', onMessages);
        liveService.bus.on('message:update', onUpdate);
        liveService.bus.on('stream:status', onStatus);
        liveService.bus.on('stream:available', onAvailable);
        liveService.bus.on('stream:counts', onCounts);

        // Keep intermediaries from closing an idle connection.
        const heartbeat = setInterval(() => write(': ping\n\n'), 25000);

        /**
         * Idempotent: 'close' and 'error' can both fire, and the bus has
         * setMaxListeners(0) — so a listener leak here would never warn, it
         * would just accumulate one set per page load until the process died.
         */
        function cleanup() {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            liveService.bus.off('messages', onMessages);
            liveService.bus.off('message:update', onUpdate);
            liveService.bus.off('stream:status', onStatus);
            liveService.bus.off('stream:available', onAvailable);
            liveService.bus.off('stream:counts', onCounts);
            try { res.end(); } catch (_) { /* already torn down */ }
        }

        req.on('close', cleanup);
        req.on('error', cleanup);
        res.on('error', cleanup);
    } catch (err) {
        // The SSE headers may already have gone out, in which case setting a
        // status would throw "Cannot set headers after they are sent" and mask
        // the real error. Only answer with 401 while the response is still open.
        if (res.headersSent) {
            try { res.end(); } catch (_) { /* nothing more to do */ }
            return;
        }
        res.status(401).json({ message: 'Not authorized, token failed' });
    }
});

/* ══════════════════════ authenticated REST ══════════════════════ */

router.use(protect, loadScope, requireAnyPageAccess(['/grievances']));

// ─── tab settings ───

router.get('/settings', async (req, res) => {
    try {
        const doc = await YouTubeLiveSettings.findOne({ id: 'ytlive' }).lean();
        res.json({
            watch_interval_sec: doc?.watch_interval_sec ?? liveService.getWatchIntervalSec(),
            runtime: liveService.getRuntimeStats(),
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.put('/settings', async (req, res) => {
    try {
        const { watch_interval_sec } = req.body || {};
        if (watch_interval_sec === undefined) {
            return res.status(400).json({ message: 'watch_interval_sec is required' });
        }

        const secs = liveService.setWatchIntervalSec(watch_interval_sec);
        await YouTubeLiveSettings.findOneAndUpdate(
            { id: 'ytlive' },
            { $set: { watch_interval_sec: secs, updated_at: new Date(), updated_by: req.user?.email || null } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.json({ watch_interval_sec: secs });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// ─── tracked channels ───

router.get('/channels', async (req, res) => {
    try {
        const channels = await LiveStream.find().sort({ created_at: -1 }).lean();
        res.json({ channels, runtime: liveService.getRuntimeStats() });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.post('/channels', async (req, res) => {
    try {
        const { channel, alignment } = req.body || {};
        const channelRef = reader.normalizeChannelRef(channel);
        if (!channelRef) {
            return res.status(400).json({ message: 'A channel handle, ID or URL is required' });
        }

        const existing = await LiveStream.findOne({ channel_ref: channelRef });
        if (existing) {
            return res.status(409).json({ message: `${channelRef} is already tracked` });
        }

        // Resolve now so the user gets immediate feedback + the channel name.
        // `resolveLiveVideo` is what carries the channel's identity; the full
        // list of concurrent broadcasts comes from `listLiveVideos`.
        // resolveLiveVideo carries the channel identity; listLiveVideos carries
        // the full set of concurrent broadcasts. Neither failing should block
        // adding the channel — the watcher retries on its next tick.
        const [live, liveList] = await Promise.all([
            reader.resolveLiveVideo(channelRef).catch(() => null),
            reader.listLiveVideos(channelRef).catch(() => []),
        ]);

        const available = liveList.map((v) => ({
            video_id: v.videoId,
            title: v.title,
            viewers: v.viewers,
            thumbnail: v.thumbnail,
        }));
        // Biggest audience by default; the user can switch to any of the others.
        const primary = available[0] || null;

        const doc = await LiveStream.create({
            channel_ref: channelRef,
            channel_id: live?.channelId || null,
            channel_name: live?.channelName || channelRef,
            available_streams: available,
            available_streams_updated_at: new Date(),
            video_id: primary?.video_id || live?.videoId || null,
            video_title: primary?.title || live?.title || '',
            thumbnail: primary?.thumbnail || live?.thumbnail || null,
            status: primary || live ? 'live' : 'idle',
            started_at: primary || live ? new Date() : null,
            alignment: ['ally', 'opposition', 'neutral'].includes(alignment) ? alignment : 'unknown',
            created_by: req.user?.email || 'unknown',
        });

        if (primary || live) {
            liveService.startPoller(doc.toObject()).catch((err) =>
                console.warn('[YTLive] startPoller failed:', err.message)
            );
        }

        // The scrape above is a single snapshot — a stream that starts
        // moments later, or wasn't caught the first time, would otherwise be
        // missing for up to 10 minutes once the poller is healthy. One
        // follow-up check shortly after add catches that.
        liveService.scheduleNewChannelRecheck(doc.id);

        const extra = available.length > 1 ? ` (${available.length} streams live — pick any)` : '';

        res.status(201).json({
            channel: doc,
            live: !!(primary || live),
            message: primary || live
                ? `${doc.channel_name} is live — reading chat now${extra}`
                : `${channelRef} added. Chat will be read automatically when it goes live.`,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.patch('/channels/:id', async (req, res) => {
    try {
        const { is_active, alignment, poll_interval_sec } = req.body || {};
        const doc = await LiveStream.findOne({ id: req.params.id });
        if (!doc) return res.status(404).json({ message: 'Channel not found' });

        if (typeof is_active === 'boolean') {
            doc.is_active = is_active;
            if (!is_active) {
                liveService.stopPoller(doc.id);
                doc.status = 'idle';
                doc.continuation = null;
            }
        }

        if (['ally', 'opposition', 'neutral', 'unknown'].includes(alignment)) {
            doc.alignment = alignment;
            liveService.updateStreamSettings(doc.id, { alignment });
        }

        if (poll_interval_sec !== undefined) {
            const secs = Math.max(0, Math.min(300, Number(poll_interval_sec) || 0));
            doc.poll_interval_sec = secs;
            // Applies on the next tick — no need to restart the stream.
            liveService.updateStreamSettings(doc.id, { poll_interval_sec: secs });
        }

        await doc.save();
        res.json({ channel: doc });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.delete('/channels/:id', async (req, res) => {
    try {
        const doc = await LiveStream.findOne({ id: req.params.id });
        if (!doc) return res.status(404).json({ message: 'Channel not found' });

        liveService.stopPoller(doc.id);
        await LiveChatMessage.deleteMany({ stream_id: doc.id });
        await LiveStream.deleteOne({ id: doc.id });

        res.json({ message: `Removed ${doc.channel_name || doc.channel_ref}` });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * Choose which of a channel's concurrent broadcasts to read chat from.
 * Pass `video_id: null` to hand the choice back to "whichever is biggest".
 */
router.post('/channels/:id/select-stream', async (req, res) => {
    try {
        const { video_id } = req.body || {};
        const doc = await LiveStream.findOne({ id: req.params.id }).lean();
        if (!doc) return res.status(404).json({ message: 'Channel not found' });

        // Only a broadcast that is actually live can be read.
        if (video_id && !(doc.available_streams || []).some((s) => s.video_id === video_id)) {
            return res.status(400).json({ message: 'That stream has ended — refresh to see what is live now' });
        }

        const result = await liveService.selectStream(req.params.id, video_id || null);
        if (!result) return res.status(404).json({ message: 'Channel not found' });

        const { channel, applied, chat_disabled } = result;

        // The stream can end between the check above and the switch.
        let message = 'Now reading this stream';
        if (!applied) message = 'That stream just ended — reading the next one instead';
        else if (chat_disabled) message = 'Switched — this broadcast has live chat turned off';

        res.json({ channel, applied, chat_disabled, message });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/** Force an immediate live check (don't wait for the watcher tick). */
router.post('/channels/:id/refresh', async (req, res) => {
    try {
        const doc = await LiveStream.findOne({ id: req.params.id }).lean();
        if (!doc) return res.status(404).json({ message: 'Channel not found' });

        // Manual refresh always re-scrapes, bypassing the staleness throttle.
        await liveService.checkChannel(doc, { forceRefresh: true });
        const updated = await LiveStream.findOne({ id: req.params.id }).lean();
        res.json({ channel: updated, live: updated.status === 'live' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.post('/refresh-all', async (req, res) => {
    try {
        // User-triggered: force a real re-scrape of every channel's /streams
        // list rather than respecting the routine throttle, or the button
        // silently does nothing for any channel whose poller is already healthy.
        await liveService.runWatcherOnce({ forceRefresh: true });
        const channels = await LiveStream.find().sort({ created_at: -1 }).lean();
        res.json({ channels, runtime: liveService.getRuntimeStats() });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// ─── messages ───

router.get('/messages', async (req, res) => {
    try {
        const {
            stream_id,
            video_id,
            sentiment,
            search,
            political,
            after,          // ISO date — poll fallback when SSE is unavailable
            limit = 100,
            page = 1,
        } = req.query;

        const filter = {};
        if (stream_id) filter.stream_id = stream_id;
        if (video_id) filter.video_id = video_id;
        if (sentiment && sentiment !== 'all') filter.sentiment = sentiment;
        if (political === 'true') filter.is_political = true;
        if (search) filter.text = { $regex: String(search).trim(), $options: 'i' };
        if (after) {
            const d = new Date(after);
            if (!Number.isNaN(d.getTime())) filter.created_at = { $gt: d };
        }

        const lim = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
        const pg = Math.max(1, parseInt(page, 10) || 1);

        const [messages, total] = await Promise.all([
            LiveChatMessage.find(filter)
                .sort({ published_at: -1 })
                .skip((pg - 1) * lim)
                .limit(lim)
                .lean(),
            LiveChatMessage.countDocuments(filter),
        ]);

        // Real, current rolling-median duration (or null) — the SSE
        // 'analyzing' event carries this too; also attaching it here so a
        // page load or SSE-reconnect resync (which re-fetches via this
        // route) doesn't lose the progress-bar's real expected-duration
        // hint for a message that was already mid-analysis.
        const expected_duration_ms = liveService.getRuntimeStats().expected_duration_ms;
        const withDurationHint = messages.map((m) => ({ ...m, expected_duration_ms }));

        res.json({
            messages: withDurationHint,
            pagination: { page: pg, limit: lim, total, pages: Math.ceil(total / lim) || 1 },
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// ─── stats (scoped to live chat only — never mixed with grievance counts) ───

router.get('/stats', async (req, res) => {
    try {
        const { stream_id, video_id } = req.query;
        // A channel accumulates messages from every broadcast it has ever run,
        // so scoping by stream_id alone mixes them. video_id narrows to the one
        // broadcast actually being viewed.
        const filter = {};
        if (stream_id) filter.stream_id = stream_id;
        if (video_id) filter.video_id = video_id;

        const [bySentiment, total, political, liveCount] = await Promise.all([
            LiveChatMessage.aggregate([
                { $match: filter },
                { $group: { _id: '$sentiment', count: { $sum: 1 } } },
            ]),
            LiveChatMessage.countDocuments(filter),
            LiveChatMessage.countDocuments({ ...filter, is_political: true }),
            LiveStream.countDocuments({ status: 'live' }),
        ]);

        const sentiment = { positive: 0, neutral: 0, negative: 0 };
        for (const row of bySentiment) {
            if (row._id in sentiment) sentiment[row._id] = row.count;
        }

        res.json({ total, political, sentiment, live_streams: liveCount, runtime: liveService.getRuntimeStats() });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/** Top chat participants — the live-chat equivalent of "sentiment leaders". */
router.get('/top-authors', async (req, res) => {
    try {
        const { stream_id, video_id, limit = 10 } = req.query;
        const filter = {};
        if (stream_id) filter.stream_id = stream_id;
        if (video_id) filter.video_id = video_id;

        const authors = await LiveChatMessage.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: '$author_name',
                    messages: { $sum: 1 },
                    negative: { $sum: { $cond: [{ $eq: ['$sentiment', 'negative'] }, 1, 0] } },
                    positive: { $sum: { $cond: [{ $eq: ['$sentiment', 'positive'] }, 1, 0] } },
                    photo: { $first: '$author_photo' },
                },
            },
            { $sort: { messages: -1 } },
            { $limit: Math.min(50, parseInt(limit, 10) || 10) },
        ]);

        res.json({ authors });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
