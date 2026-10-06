const telegramService = require('../services/telegramService');
const TelegramGroup = require('../models/TelegramGroup');
const TelegramMessage = require('../models/TelegramMessage');

exports.sendCode = async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ message: 'Phone number is required' });
        console.log(`[Telegram Controller] Requesting code for ${phone}`);
        const result = await telegramService.sendCode(phone);
        // Result now contains phoneCodeHash
        res.json({ message: 'Code sent', ...result });
    } catch (error) {
        console.error('[Telegram Controller] sendCode error:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.verifyCode = async (req, res) => {
    try {
        const { phone, code, phoneCodeHash, password } = req.body;
        console.log('[Telegram Controller] Verify Payload Keys:', Object.keys(req.body));
        if (!phone || !code || !phoneCodeHash) {
            console.error('[Telegram Controller] Missing params:', { phone: !!phone, code: !!code, hash: !!phoneCodeHash });
            return res.status(400).json({ message: 'Phone, code, and session hash are required' });
        }
        console.log(`[Telegram Controller] Verifying code for ${phone}`);
        const result = await telegramService.signIn(phone, code, phoneCodeHash, password);
        res.json({ message: 'Authenticated successfully', result });
    } catch (error) {
        console.error('[Telegram Controller] verifyCode error:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getStatus = async (req, res) => {
    try {
        const status = await telegramService.checkStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.search = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ message: 'Query is required' });
        const results = await telegramService.searchGroups(q);
        res.json(results);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.searchGlobal = async (req, res) => {
    try {
        const { q, offset, deepScan, autoJoin } = req.query;
        if (!q) return res.status(400).json({ message: 'Keyword is required' });

        const hubOffset = parseInt(offset || '0');
        const isDeepScan = deepScan === 'true';
        const isAutoJoin = autoJoin === 'true';
        console.log(`[Telegram Controller] Unified Global Search for: ${q} (Offset: ${hubOffset}, Deep: ${isDeepScan}, Auto: ${isAutoJoin})`);

        // Run searches SEQUENTIALLY — GramJS uses a single connection,
        // so parallel API calls cause hanging/flooding
        let publicGroups = [];
        let discoveredResults = [];
        let floodWait = null;
        let myGroups = [];

        // 1. Public search (fast — contacts.Search)
        // Only run on first page to avoid redundancy
        if (hubOffset === 0) {
            try {
                publicGroups = await telegramService.searchGroups(q);
                console.log(`[Telegram Controller] Public search found ${publicGroups.length} groups`);
            } catch (err) {
                console.error('[Telegram Controller] Public search failed:', err.message);
            }
        }

        // 2. Multi-strategy discovery (slower — multiple SearchGlobal calls + Hub scanning)
        try {
            const discovery = await telegramService.discoverInviteLinks(q, hubOffset, isDeepScan, isAutoJoin);
            discoveredResults = discovery.results || [];
            floodWait = discovery.floodWait;
            console.log(`[Telegram Controller] Discovery found ${discoveredResults.length} results`);
        } catch (err) {
            console.error('[Telegram Controller] Discovery failed:', err.message);
        }

        // 3. Dialog scan (local)
        // Only on first page
        if (hubOffset === 0) {
            try {
                myGroups = await telegramService.searchDialogsForKeyword(q);
                console.log(`[Telegram Controller] Dialog scan found ${myGroups.length} groups`);
            } catch (err) {
                console.error('[Telegram Controller] Dialog scan failed:', err.message);
            }
        }

        // Split discovered results into private and public
        const discoveredPrivate = discoveredResults.filter(r => r.type === 'private_discovered');
        const discoveredPublic = discoveredResults.filter(r => r.type === 'public_discovered');

        res.json({
            public: publicGroups,
            discovered_private: discoveredPrivate,
            discovered_public: discoveredPublic,
            my_groups: myGroups,
            has_more: discoveredResults.length > 0, // Simple flag for UI
            floodWait: floodWait
        });
    } catch (error) {
        console.error('[Telegram Controller] searchGlobal error:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.join = async (req, res) => {
    try {
        const { identifier } = req.body; // username or invite link
        if (!identifier) return res.status(400).json({ message: 'Identifier is required' });

        const result = await telegramService.joinGroup(identifier);

        // Handle FloodWait
        if (result && result.error === 'flood_wait') {
            return res.status(429).json(result);
        }

        // Return 202 Accepted for pending requests or already pending
        if (result && (result.status === 'request_sent' || result.status === 'already_pending')) {
            return res.status(202).json(result);
        }

        res.json(result);
    } catch (error) {
        console.error('[Telegram Controller] Join failed:', error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.sync = async (req, res) => {
    try {
        const syncResults = await telegramService.syncJoinedGroups(true); // Manual bypass
        res.json({
            message: `Successfully synced ${syncResults.length} groups from Telegram.`,
            count: syncResults.length
        });
    } catch (error) {
        console.error('[Telegram Controller] Sync failed:', error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.getGroups = async (req, res) => {
    try {
        const { status } = req.query;
        const filter = status ? { status } : { status: { $in: ['joined', 'pending', 'left'] } };
        const groups = await TelegramGroup.find(filter).sort({ status: 1, created_at: -1 });
        res.json(groups);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.scrape = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { limit } = req.query;
        const messages = await telegramService.fetchMessages(groupId, parseInt(limit) || 50);
        res.json({ count: messages.length, messages });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getMessages = async (req, res) => {
    try {
        const { groupId } = req.params;
        const messages = await TelegramMessage.find({ group_id: groupId }).sort({ date: -1 }).limit(100);
        res.json(messages);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.discover = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ message: 'Keyword is required' });
        console.log(`[Telegram Controller] Discovering links for: ${q}`);
        const links = await telegramService.discoverInviteLinks(q);
        res.json(links);
    } catch (error) {
        console.error('[Telegram Controller] Discover error:', error);
        res.status(500).json({ message: error.message });
    }
};
exports.getMedia = async (req, res) => {
    try {
        const { groupId, messageId } = req.params;
        const { buffer, mimeType, fileName } = await telegramService.downloadMedia(groupId, messageId);
        res.set('Content-Type', mimeType);
        if (fileName) {
            const encodedName = encodeURIComponent(fileName);
            res.set('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
        }
        res.send(buffer);
    } catch (error) {
        console.error('[Telegram Controller] Media error:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.checkPending = async (req, res) => {
    try {
        const result = await telegramService.checkPendingGroups(true); // Manual bypass
        res.json(result);
    } catch (error) {
        console.error('[Telegram Controller] Check pending error:', error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.scrapeAll = async (req, res) => {
    try {
        const { limit } = req.query;
        const results = await telegramService.scrapeAllGroups(parseInt(limit) || 30, true); // Manual bypass
        const totalMessages = results.reduce((sum, r) => sum + r.count, 0);
        const successCount = results.filter(r => r.success).length;
        res.json({
            message: `Scraped ${totalMessages} messages from ${successCount}/${results.length} groups.`,
            total_messages: totalMessages,
            groups_scraped: successCount,
            groups_total: results.length,
            details: results
        });
    } catch (error) {
        console.error('[Telegram Controller] Scrape all error:', error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.leaveGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        if (!groupId) return res.status(400).json({ message: 'Group ID is required' });
        const result = await telegramService.leaveGroup(groupId);
        res.json(result);
    } catch (error) {
        console.error('[Telegram Controller] Leave group error:', error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.markRead = async (req, res) => {
    try {
        const { groupId } = req.params;
        if (!groupId) return res.status(400).json({ message: 'Group ID is required' });
        const result = await telegramService.markAsRead(groupId);
        res.json(result);
    } catch (error) {
        console.error('[Telegram Controller] Mark read error:', error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.rejoinGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        if (!groupId) return res.status(400).json({ message: 'Group ID is required' });
        const result = await telegramService.rejoinGroup(groupId);
        res.json(result);
    } catch (error) {
        console.error('[Telegram Controller] Rejoin group error:', error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.deleteGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { deleteMessages } = req.query;
        if (!groupId) return res.status(400).json({ message: 'Group ID is required' });
        const result = await telegramService.deleteGroup(groupId, deleteMessages !== 'false');
        res.json(result);
    } catch (error) {
        console.error('[Telegram Controller] Delete group error:', error.message);
        res.status(500).json({ message: error.message });
    }
};

exports.logout = async (req, res) => {
    try {
        await telegramService.logout();
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error('[Telegram Controller] Logout error:', error.message);
        res.status(500).json({ message: error.message });
    }
};
