const axios = require('axios');
const mongoose = require('mongoose');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const Settings = require('../models/Settings');
const TelegramGroup = require('../models/TelegramGroup');
const TelegramMessage = require('../models/TelegramMessage');
// Web discovery disabled due to anti-bot protections

const apiId = process.env.TELEGRAM_API_ID ? parseInt(process.env.TELEGRAM_API_ID) : null;
const apiHash = process.env.TELEGRAM_API_HASH;
console.log(`[Telegram Service] Module loaded. API_ID: ${apiId ? 'Defined' : 'UNDEFINED'}`);

let client = null;
let connectionPromise = null;
let isSyncing = false; // Global Sync Lock
let phoneCodeHash = '';
let currentPhone = '';
let resolutionMap = new Map(); // groupId -> Promise for resolvePeer

const formatPhone = (phone) => {
    let cleaned = phone.replace(/\s+/g, '').replace(/-/g, '');
    if (!cleaned.startsWith('+')) {
        if (cleaned.length === 10) cleaned = '+91' + cleaned;
        else if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
    }
    return cleaned;
};





const initClient = async (sessionString = '') => {
    if (client) return client;

    console.log('[Telegram Service] Initializing client. API_ID:', apiId ? 'Present' : 'MISSING');
    if (!apiId || !apiHash) {
        throw new Error('TELEGRAM_API_ID or TELEGRAM_API_HASH missing in .env');
    }

    const session = new StringSession(sessionString || '');
    client = new TelegramClient(session, parseInt(apiId), apiHash, {
        connectionRetries: 5,
        maxReconnectRetries: -1, // Infinite reconnects
        autoReconnect: true,
        deviceModel: "Blura Hub Server",
        systemVersion: "Windows 10",
        appVersion: "1.0.0",
        useWSS: true, // Use WebSocket on port 443 for better firewall/ISP stability
        timeout: 60000, // 60s timeout for large media
    });

    return client;
};

const getClient = async () => {
    if (!client) {
        const settings = await Settings.findOne({ id: 'global_settings' });
        await initClient(settings?.telegram_session || '');
    }

    // If client exists but is totally stuck or disconnected
    if (!client.connected && !connectionPromise) {
        console.log('[Telegram Service] Client disconnected. Attempting stable connection...');
        connectionPromise = (async () => {
            try {
                // Manually start connection
                await client.connect();
                console.log('[Telegram Service] Connection established.');
            } catch (err) {
                console.error('[Telegram Service] Connection fatal error:', err.message);
            } finally {
                connectionPromise = null;
            }
        })();
    }

    if (connectionPromise) {
        await connectionPromise;
    }

    return client;
};

const saveSession = async () => {
    if (client) {
        const sessionString = client.session.save();
        await Settings.findOneAndUpdate(
            { id: 'global_settings' },
            { $set: { telegram_session: sessionString } },
            { upsert: true }
        );
    }
};

const sendCode = async (phone) => {
    const tlClient = await getClient();
    const formattedPhone = formatPhone(phone);
    console.log(`[Telegram Service] Sending code to ${formattedPhone}...`);
    const result = await tlClient.sendCode(
        {
            apiId: parseInt(apiId),
            apiHash,
        },
        formattedPhone
    );
    return {
        phoneCodeHash: result.phoneCodeHash,
        phone: formattedPhone
    };
};

const signIn = async (phone, code, phoneCodeHash, password = '') => {
    const tlClient = await getClient();
    const formattedPhone = formatPhone(phone);
    console.log(`[Telegram Service] Signing in for ${formattedPhone}...`);

    try {
        let result;
        try {
            // Attempt direct sign in
            result = await tlClient.invoke(
                new Api.auth.SignIn({
                    phoneNumber: formattedPhone,
                    phoneCodeHash: phoneCodeHash,
                    phoneCode: code.toString().trim(),
                })
            );
        } catch (error) {
            // Handle 2FA if needed
            if (error.errorMessage === 'SESSION_PASSWORD_NEEDED' && password) {
                console.log('[Telegram Service] 2FA required, checking password...');
                const pwd = await tlClient.invoke(new Api.account.GetPassword());
                const passwordResult = await tlClient.invoke(
                    new Api.auth.CheckPassword({
                        password: await tlClient.computeCheckPassword(pwd, password)
                    })
                );
                result = passwordResult;
            } else {
                throw error;
            }
        }

        console.log('[Telegram Service] Sign in successful. Saving session...');
        await saveSession();
        return { success: true, user: result.user };
    } catch (error) {
        console.error('[Telegram Service] Sign in failed:', error);
        throw error;
    }
};

const checkStatus = async () => {
    const tlClient = await getClient();
    try {
        const me = await tlClient.getMe();
        return { authenticated: !!me, user: me };
    } catch (error) {
        return { authenticated: false };
    }
};

const searchGroups = async (keyword) => {
    const tlClient = await getClient();
    // Search global for public channels/groups
    const result = await tlClient.invoke(
        new Api.contacts.Search({
            q: keyword,
            limit: 20,
        })
    );

    const groups = [];
    for (const chat of result.chats) {
        if (chat.className === 'Channel' || chat.className === 'Chat') {
            groups.push({
                telegram_id: chat.id.toString(),
                title: chat.title,
                username: chat.username || '',
                access_hash: chat.accessHash ? chat.accessHash.toString() : '',
                type: chat.broadcast ? 'channel' : 'group',
                member_count: chat.participantsCount,
                verified: chat.verified,
                scam: chat.scam,
            });
        }
    }
    return groups;
};

const extractInviteHash = (input) => {
    if (!input) return null;
    const clean = input.trim().replace('@', '');
    // Regex for private hashes (16+ chars usually, but we capture word chars)
    const privateMatch = clean.match(/t\.me\/(?:\+|joinchat\/)([\w-]+)/);
    if (privateMatch) return privateMatch[1];

    // Fallback split logic
    if (clean.includes('t.me/') || clean.includes('joinchat/')) {
        return clean.split('/').filter(Boolean).pop().replace('+', '').split('?')[0];
    }
    return null;
};

const joinGroup = async (usernameOrLink) => {
    const tlClient = await getClient();
    let result;

    const identifier = usernameOrLink.trim();
    const hash = extractInviteHash(identifier);

    // 1. Check if group already exists in our database
    const existingGroup = await TelegramGroup.findOne({
        $or: [
            { invite_link: identifier },
            { username: identifier.replace('@', '') }
        ]
    });

    if (existingGroup) {
        if (existingGroup.status === 'joined') {
            return {
                status: 'already_joined',
                message: `You are already a member of "${existingGroup.title}".`,
                group: existingGroup
            };
        }
        if (existingGroup.status === 'pending') {
            return {
                status: 'already_pending',
                message: `Join request for "${existingGroup.title}" is already pending approval.`,
                group: existingGroup
            };
        }
    }

    console.log(`[Telegram Service] Attempting to join. Identifier: ${identifier} | Extracted Hash: ${hash}`);

    try {
        if (hash) {
            console.log(`[Telegram Service] Using ImportChatInvite for hash: ${hash}`);
            result = await tlClient.invoke(
                new Api.messages.ImportChatInvite({ hash })
            );
        } else {
            // Treat as public username or link
            const username = identifier.split('/').filter(Boolean).pop().replace('@', '').split('?')[0];
            console.log(`[Telegram Service] Using JoinChannel for username: ${username}`);
            result = await tlClient.invoke(
                new Api.channels.JoinChannel({ channel: username })
            );
        }
    } catch (err) {
        // Handle common errors gracefully
        if (err.message.includes('USER_ALREADY_PARTICIPANT')) {
            console.log('[Telegram Service] Already a member of this group. Fetching info...');
            // If already a participant, try to get the channel info via its username or hash
            try {
                // If it was a username, we can just resolve it
                if (!identifier.includes('t.me/')) {
                    const chatInfo = await tlClient.getEntity(identifier);
                    result = { chats: [chatInfo] };
                } else {
                    // For private links, we might not be able to get info if we don't know the ID
                    // But usually, ImportChatInvite failing with ALREADY_PARTICIPANT means we already have it in dialogs
                    const dialogs = await tlClient.getDialogs({ limit: 100 });
                    const found = dialogs.find(d => identifier.includes(d.id.toString()) || (d.entity && d.entity.username && identifier.includes(d.entity.username)));
                    if (found) {
                        result = { chats: [found.entity] };
                    } else {
                        throw new Error('You are already a member of this group.');
                    }
                }
            } catch (innerErr) {
                throw new Error('You are already a member of this group.');
            }
        } else if (err.message.includes('INVITE_HASH_EXPIRED')) {
            throw new Error('This invite link has expired.');
        } else if (err.message.includes('INVITE_HASH_INVALID')) {
            throw new Error('Invalid invite link or hash.');
        } else if (err.message.includes('INVITE_REQUEST_SENT')) {
            console.log('[Telegram Service] Join request already sent (from error).');
            // Save as pending in database so we can track it
            await TelegramGroup.findOneAndUpdate(
                { invite_link: identifier },
                {
                    $set: {
                        title: identifier.split('/').pop() || 'Pending Group',
                        invite_link: identifier,
                        type: hash ? 'private' : 'public',
                        status: 'pending',
                        is_active: true
                    },
                    $setOnInsert: { telegram_id: `pending_${Date.now()}` }
                },
                { upsert: true, new: true }
            );
            return {
                status: 'request_sent',
                message: 'Join request has been sent and is pending admin approval.'
            };
        } else if (err.errorMessage === 'FLOOD' || err.code === 420) {
            console.warn(`[Telegram Service] FloodWait hit: ${err.seconds} seconds required.`);
            return {
                error: 'flood_wait',
                seconds: err.seconds || 0,
                message: `Telegram rate limit hit. Please wait ${Math.ceil((err.seconds || 0) / 60)} minutes before joining more groups.`
            };
        } else {
            console.error('[Telegram Service] Join failed:', err);
            throw err;
        }
    }

    // result.chats is often where the group info resides
    const chat = result?.chats ? result.chats[0] : null;

    if (chat) {
        const group = await TelegramGroup.findOneAndUpdate(
            { telegram_id: chat.id.toString() },
            {
                $set: {
                    title: chat.title,
                    username: chat.username || '',
                    access_hash: chat.accessHash ? chat.accessHash.toString() : '',
                    type: (chat.className === 'Channel' || chat.className === 'Chat') ? (chat.broadcast ? 'channel' : 'group') : 'group',
                    status: 'joined',
                    is_active: true,
                    invite_link: identifier // Save the original link used to join
                }
            },
            { upsert: true, new: true }
        );
        return {
            status: 'joined',
            message: `Successfully joined "${chat.title}"`,
            group: group
        };
    }

    // Handle InviteRequestSent (updates.InviteRequestSent)
    if (result && (result.className === 'updates.InviteRequestSent' || result.className === 'InviteRequestSent')) {
        console.log('[Telegram Service] Join request sent and pending approval.');
        // Save as pending in database
        await TelegramGroup.findOneAndUpdate(
            { invite_link: identifier },
            {
                $set: {
                    title: identifier.split('/').pop() || 'Pending Group',
                    invite_link: identifier,
                    type: hash ? 'private' : 'public',
                    status: 'pending',
                    is_active: true
                },
                $setOnInsert: { telegram_id: `pending_${Date.now()}` }
            },
            { upsert: true, new: true }
        );
        return {
            status: 'request_sent',
            message: 'Join request has been sent and is pending admin approval.'
        };
    }

    return result;
};

/**
 * Synchronize the database with the user's actual joined groups in Telegram.
 * Useful for catching groups joined directly in the Telegram app.
 */
const syncJoinedGroups = async (force = false) => {
    if (isSyncing && !force) {
        console.log('[Telegram Service] Sync already in progress, skipping syncJoinedGroups...');
        return [];
    }

    isSyncing = true;
    try {
        const tlClient = await getClient();
        console.log('[Telegram Service] Syncing joined groups from dialogs (limit: 200)...');
        const dialogs = await tlClient.getDialogs({ limit: 200 });
        const syncResults = [];
        const seenInTelegram = new Set();

        for (const dialog of dialogs) {
            if (dialog.isGroup || dialog.isChannel) {
                const chat = dialog.entity;
                if (!chat) continue;

                const chatIdStr = chat.id.toString();
                seenInTelegram.add(chatIdStr);
                const topMsgId = dialog.message?.id || 0;

                try {
                    // Try to find if we already have a record for this group (maybe by invite_link)
                    // This ensures we link the new joined state to the old pending state
                    const updateData = {
                        title: chat.title,
                        username: chat.username || '',
                        access_hash: chat.accessHash ? chat.accessHash.toString() : '',
                        type: chat.broadcast ? 'channel' : 'group',
                        status: 'joined',
                        is_active: true,
                        top_message_id: topMsgId
                    };

                    // If it's a public group, we can reconstruct the link if missing
                    if (chat.username) {
                        updateData.invite_link = `https://t.me/${chat.username}`;
                    }

                    /**
                     * This $or branch previously read
                     *   { username: chat.username, username: { $ne: '' } }
                     * — a duplicate key, so JS kept only `{ $ne: '' }` and the
                     * actual username match was DISCARDED. The branch therefore
                     * matched ANY group with a non-empty username, so an upsert
                     * for one chat could silently overwrite an unrelated group.
                     *
                     * The username branch is now included only when we actually
                     * have a username to match on.
                     */
                    const groupMatch = [{ telegram_id: chatIdStr }];
                    if (chat.username) groupMatch.push({ username: chat.username });

                    const group = await TelegramGroup.findOneAndUpdate(
                        { $or: groupMatch },
                        { $set: updateData },
                        { upsert: true, new: true }
                    );
                    syncResults.push(group);
                } catch (err) {
                    if (err.code === 11000) {
                        console.warn(`[Telegram Service] Duplicate key during syncJoinedGroups: ${chat.id}`);
                    } else {
                        throw err;
                    }
                }
            }
        }

        // AUTO-CLEANUP: Mark groups as "left" if they are in our DB as joined but not in dialogs
        const dbGroups = await TelegramGroup.find({ status: 'joined', is_active: true });
        for (const dbg of dbGroups) {
            const rawId = dbg.telegram_id.replace('-100', '');
            if (!seenInTelegram.has(rawId) && !seenInTelegram.has(`-${rawId}`) && !seenInTelegram.has(dbg.telegram_id)) {
                console.log(`[Telegram Service] Auto-cleanup: Group ${dbg.title} (${dbg.telegram_id}) no longer in dialogs. Marking as left.`);
                await TelegramGroup.updateOne({ id: dbg.id }, { $set: { status: 'left', is_active: false } });
            }
        }

        console.log(`[Telegram Service] Sync complete. Processed ${syncResults.length} live groups.`);
        return syncResults;
    } catch (error) {
        console.error('[Telegram Service] Sync failed:', error);
        throw error;
    } finally {
        isSyncing = false;
    }
};

/**
 * Robustly resolve a peer by checking username, ID+Hash, or falling back to dialogs.
 * Uses a map to deduplicate concurrent requests for the same group to avoid flood waits.
 */
const resolvePeer = async (tlClient, dbGroup) => {
    const groupId = dbGroup.id;
    if (resolutionMap.has(groupId)) return await resolutionMap.get(groupId);

    const promise = (async () => {
        try {
            let entity = null;
            const repairHash = async (ent) => {
                if (ent && ent.accessHash) {
                    const newHash = ent.accessHash.toString();
                    if (dbGroup.access_hash !== newHash) {
                        console.log(`[Telegram Service] Persisting discovered access_hash for ${dbGroup.title}: ${newHash}`);
                        await TelegramGroup.updateOne({ id: dbGroup.id }, { $set: { access_hash: newHash } });
                        dbGroup.access_hash = newHash;
                    }
                }
                return ent;
            };

            // 1. Try Username
            if (dbGroup.username) {
                try {
                    entity = await tlClient.getEntity(dbGroup.username);
                    return await repairHash(entity);
                } catch (e) { }
            }

            // 2. Try ID + Access Hash
            if (dbGroup.access_hash) {
                try {
                    return await tlClient.getEntity(new Api.InputPeerChannel({
                        channelId: BigInt(dbGroup.telegram_id.replace('-100', '')),
                        accessHash: BigInt(dbGroup.access_hash)
                    }));
                } catch (e) {
                    console.warn(`[Telegram Service] ID+Hash failed for ${dbGroup.title}, trying numeric ID...`);
                }
            }

            // 3. Try numeric ID fallback
            let idStr = dbGroup.telegram_id;
            if (!idStr.startsWith('-') && idStr.length > 8) idStr = '-100' + idStr;
            try {
                entity = await tlClient.getEntity(idStr);
                return await repairHash(entity);
            } catch (e) {
                // 4. Final Fallback: Dialogs
                console.warn(`[Telegram Service] getEntity failed for ${dbGroup.title}, trying dialogs...`);
                const dialogs = await tlClient.getDialogs({ limit: 100 });
                const rawId = dbGroup.telegram_id.replace('-100', '');
                const found = dialogs.find(d => {
                    const dId = d.id?.toString();
                    return dId === rawId || dId === `-${rawId}` || dId === `-100${rawId}`;
                });
                if (found && found.entity) return await repairHash(found.entity);

                // Last ditch
                entity = await tlClient.getEntity(idStr);
                return await repairHash(entity);
            }
        } catch (error) {
            console.error(`[Telegram Service] Resolution failed for ${dbGroup.title}:`, error.message);
            throw error;
        } finally {
            resolutionMap.delete(groupId);
        }
    })();

    resolutionMap.set(groupId, promise);
    return await promise;
};

const fetchMessages = async (groupId, limit = 50, markAsRead = false) => {
    const tlClient = await getClient();
    // Search by both UUID 'id' and MongoDB '_id'
    const dbGroup = await TelegramGroup.findOne({
        $or: [
            { id: groupId },
            { _id: mongoose.Types.ObjectId.isValid(groupId) ? groupId : null }
        ].filter(f => f._id !== null || f.id)
    });
    if (!dbGroup) throw new Error('Group not found in database');

    let peer;
    try {
        peer = await resolvePeer(tlClient, dbGroup);
    } catch (err) {
        if (err.message.includes('CHANNEL_INVALID') || err.message.includes('CHANNEL_PRIVATE') || err.message.includes('PEER_ID_INVALID')) {
            await deactivateGroup(groupId, err.message);
        }
        throw err;
    }

    let result;
    try {
        result = await tlClient.invoke(
            new Api.messages.GetHistory({
                peer: peer,
                limit: limit,
            })
        );
    } catch (err) {
        if (err.message.includes('CHANNEL_INVALID') || err.message.includes('CHANNEL_PRIVATE')) {
            await deactivateGroup(groupId, err.message);
        }
        throw err;
    }

    const peerMap = {};
    if (result.users) {
        result.users.forEach(u => {
            peerMap[u.id.toString()] = {
                name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
                username: u.username || ''
            };
        });
    }
    if (result.chats) {
        result.chats.forEach(c => {
            peerMap[c.id.toString()] = {
                name: c.title,
                username: c.username || '',
                accessHash: c.accessHash
            };
        });

        // AUTO-REPAIR: Capture access_hash from live results if we're missing it
        const currentChat = result.chats.find(c => c.id?.toString() === dbGroup.telegram_id.replace('-100', ''));
        if (currentChat && currentChat.accessHash && (!dbGroup.access_hash || dbGroup.access_hash !== currentChat.accessHash.toString())) {
            const newHash = currentChat.accessHash.toString();
            console.log(`[Telegram Service] Auto-repairing access_hash for group ${dbGroup.title}: ${newHash}`);
            await TelegramGroup.updateOne({ id: dbGroup.id }, { $set: { access_hash: newHash } });
        }
    }

    const savedMessages = [];
    for (const msg of result.messages) {
        if (msg.className === 'Message') {
            try {
                let senderName = 'Unknown User';
                let senderUsername = '';
                let senderId = '';

                if (msg.fromId) {
                    const fromIdStr = msg.fromId.userId?.toString() || msg.fromId.channelId?.toString() || msg.fromId.chatId?.toString();
                    senderId = fromIdStr;
                    const peer = peerMap[fromIdStr];
                    if (peer) {
                        senderName = peer.name;
                        senderUsername = peer.username;
                    }
                } else if (msg.peerId) {
                    const peerIdStr = msg.peerId.userId?.toString() || msg.peerId.channelId?.toString() || msg.peerId.chatId?.toString();
                    senderId = peerIdStr;
                    const peer = peerMap[peerIdStr];
                    if (peer) {
                        senderName = peer.name;
                        senderUsername = peer.username;
                    } else {
                        senderName = dbGroup.title;
                        senderUsername = dbGroup.username;
                    }
                }

                const mediaItems = [];
                if (msg.media) {
                    let mediaType = 'other';
                    let fileName = '';
                    let fileSize = 0;
                    let mimeType = '';

                    if (msg.media.className === 'MessageMediaPhoto') {
                        mediaType = 'photo';
                        mimeType = 'image/jpeg';
                    } else if (msg.media.className === 'MessageMediaDocument') {
                        const doc = msg.media.document;
                        mimeType = doc.mimeType || '';
                        fileSize = doc.size ? parseInt(doc.size) : 0;

                        if (doc.attributes) {
                            const fileAttr = doc.attributes.find(a => a.className === 'DocumentAttributeFilename');
                            if (fileAttr) fileName = fileAttr.fileName;
                        }

                        if (mimeType.includes('video')) mediaType = 'video';
                        else if (mimeType.includes('audio')) mediaType = 'audio';
                        else mediaType = 'document';
                    } else if (msg.media.className === 'MessageMediaWebPage') {
                        mediaType = 'link';
                    }

                    mediaItems.push({
                        type: mediaType,
                        file_id: msg.media.document?.id?.toString() || msg.media.photo?.id?.toString() || '',
                        url: `[Media: ${mediaType}]`,
                        fileName: fileName,
                        fileSize: fileSize,
                        mimeType: mimeType
                    });
                }

                const links = new Set();
                if (msg.entities) {
                    for (const entity of msg.entities) {
                        if (entity.className === 'MessageEntityUrl') {
                            const url = (msg.message || '').substring(entity.offset, entity.offset + entity.length);
                            if (url) links.add(url);
                        } else if (entity.className === 'MessageEntityTextUrl') {
                            if (entity.url) links.add(entity.url);
                        }
                    }
                }

                const existingMsg = await TelegramMessage.findOne({
                    telegram_message_id: msg.id,
                    group_id: groupId
                });

                if (existingMsg && existingMsg.media && existingMsg.media.length > 0) {
                    mediaItems.forEach(newItem => {
                        const oldItem = existingMsg.media.find(m => m.file_id === newItem.file_id);
                        if (oldItem && oldItem.s3_url) {
                            newItem.s3_url = oldItem.s3_url;
                            newItem.s3_key = oldItem.s3_key;
                        }
                    });
                }

                const saved = await TelegramMessage.findOneAndUpdate(
                    { telegram_message_id: msg.id, group_id: groupId },
                    {
                        $set: {
                            text: msg.message || '',
                            date: new Date(msg.date * 1000),
                            sender_id: senderId,
                            sender_name: senderName,
                            sender_username: senderUsername,
                            media: mediaItems,
                            links: Array.from(links),
                            analyzed: false
                        }
                    },
                    { upsert: true, new: true }
                );
                savedMessages.push(saved);

                // Media is not archived to S3 any more.
            } catch (e) {
                console.error('[Telegram Service] Error processing message:', e);
            }
        }
    }

    if (result.messages && result.messages.length > 0 && markAsRead) {
        try {
            const maxMsgId = Math.max(...result.messages.map(m => m.id));
            await tlClient.invoke(new Api.messages.ReadHistory({
                peer: peer,
                maxId: maxMsgId
            }));
            console.log(`[Telegram Service] Phone sync: Marked history as read for ${dbGroup.title} up to message ID ${maxMsgId}`);

            // Immediately clear the unread count in DB too
            await TelegramGroup.updateOne({ id: groupId }, { $set: { unread_count: 0 } });
        } catch (readErr) {
            console.warn(`[Telegram Service] Failed to sync read receipt to phone for ${dbGroup.title}:`, readErr.message);
        }
    }

    const actualCount = await TelegramMessage.countDocuments({ group_id: groupId });
    const maxScrapedId = (result.messages && result.messages.length > 0)
        ? Math.max(...result.messages.map(m => m.id))
        : (dbGroup.last_message_id || 0);

    await TelegramGroup.updateOne({ id: groupId }, {
        $set: {
            last_scraped_at: new Date(),
            message_count: actualCount,
            last_message_id: maxScrapedId,
            top_message_id: Math.max(maxScrapedId, dbGroup.top_message_id || 0)
        }
    });

    return savedMessages;
};

/**
 * Search user's own dialogs (joined chats) for groups matching a keyword.
 * This catches private groups the user is already in but might have forgotten about.
 */
const searchDialogsForKeyword = async (keyword) => {
    const tlClient = await getClient();
    const kw = keyword.toLowerCase();
    const found = [];

    try {
        const dialogs = await tlClient.getDialogs({ limit: 200 });
        for (const dialog of dialogs) {
            if (!dialog.entity) continue;
            const cn = dialog.entity.className;
            if (cn !== 'Channel' && cn !== 'Chat') continue;

            const title = (dialog.entity.title || '').toLowerCase();
            const username = (dialog.entity.username || '').toLowerCase();
            if (title.includes(kw) || username.includes(kw)) {
                const isPrivate = !dialog.entity.username;
                found.push({
                    telegram_id: dialog.entity.id.toString(),
                    title: dialog.entity.title || 'Unknown Group',
                    username: dialog.entity.username || '',
                    access_hash: dialog.entity.accessHash ? dialog.entity.accessHash.toString() : '',
                    type: dialog.entity.broadcast ? 'channel' : 'group',
                    member_count: dialog.entity.participantsCount || 0,
                    verified: dialog.entity.verified || false,
                    scam: dialog.entity.scam || false,
                    invite_link: dialog.entity.username ? `https://t.me/${dialog.entity.username}` : '',
                    source: isPrivate ? 'my_private_groups' : 'my_public_groups'
                });
            }
        }
    } catch (err) {
        console.warn('[Telegram Service] Dialog scan warning:', err.message);
    }
    return found;
};

/**
 * Multi-Strategy Private Group Discovery Engine.
 *
 * Runs 5 parallel SearchGlobal queries with different patterns:
 *   1. Direct keyword — catches all messages, extract links from them
 *   2. keyword + "join" — catches invite-sharing messages
 *   3. keyword + "group" — catches group advertisement posts
 *   4. keyword + "channel" — catches channel advertisements
 *   5. keyword + "t.me/" — the original approach (kept for coverage)
 *
 * Extracts BOTH private invite links (t.me/+ and t.me/joinchat/) AND
 * public group usernames (t.me/username) from the messages.
 * Also collects chat entities returned by SearchGlobal results.
 */
const discoverInviteLinks = async (keyword, hubOffset = 0, deepScan = false, autoJoin = false) => {
    const tlClient = await getClient();
    console.log(`[Telegram Service] Advanced Discovery for: "${keyword}" (Offset: ${hubOffset}, Deep: ${deepScan}, AutoJoin: ${autoJoin})`);

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const results = [];
    const discoveryMap = new Map();
    let floodWaitData = null;

    // --- Core Strategies (Always run on Page 0) ---
    if (hubOffset === 0) {
        // Strategy 1-3: Global Message Search
        const searchQueries = [keyword, `${keyword} t.me/`, `${keyword} group`];
        for (const query of searchQueries) {
            try {
                const searchResult = await tlClient.invoke(
                    new Api.messages.SearchGlobal({
                        q: query,
                        filter: new Api.InputMessagesFilterEmpty(),
                        minDate: 0,
                        maxDate: 0,
                        offsetRate: 0,
                        offsetPeer: new Api.InputPeerEmpty(),
                        offsetId: 0,
                        limit: 50
                    })
                );
                results.push(searchResult);
                await delay(500);
            } catch (err) {
                console.warn(`[Telegram Service] Strategy failed for "${query}":`, err.message);
            }
        }

        // Strategy 5: Web Index Search (Native TG Meta Search)
        if (deepScan) {
            console.log('[Telegram Service] Strategy 5: Web Index Search (Native TG Meta Search)...');
            // Web scraping disabled due to anti-bot protections.
            // Relying only on native search queries for directories now.

            const webQueries = [`site:t.me ${keyword}`, `TGStat ${keyword}`, `Telemetr ${keyword}`];
            for (const query of webQueries) {
                try {
                    const res = await tlClient.invoke(new Api.messages.SearchGlobal({
                        q: query,
                        filter: new Api.InputMessagesFilterEmpty(),
                        minDate: 0,
                        maxDate: 0,
                        offsetRate: 0,
                        offsetPeer: new Api.InputPeerEmpty(),
                        offsetId: 0,
                        limit: 30
                    }));
                    results.push(res);
                    await delay(500);
                } catch (e) { }
            }
        }
    }

    // --- Strategy 4 & 6: Hub Scanning & Spidering ---
    console.log(`[Telegram Service] Hub Scanning (Offset: ${hubOffset})`);
    try {
        const publicHubs = await tlClient.invoke(
            new Api.contacts.Search({ q: keyword, limit: 15 })
        );
        const hubsToScan = (publicHubs.chats || []).slice(hubOffset, hubOffset + 5);

        for (const chat of hubsToScan) {
            if (chat.className !== 'Channel' && chat.className !== 'Chat') continue;

            // Strategy 4: History Scan
            try {
                const history = await tlClient.invoke(
                    new Api.messages.GetHistory({
                        peer: chat,
                        offsetId: 0,
                        offsetDate: 0,
                        addOffset: 0,
                        limit: 50,
                        maxId: 0,
                        minId: 0,
                        hash: BigInt(0)
                    })
                );
                if (history.messages) results.push({ messages: history.messages, chats: [] });
            } catch (err) { }

            // Strategy 7: Bio/About Scraping
            if (deepScan) {
                console.log(`[Telegram Service] Strategy 7: Scraping Metadata for ${chat.title}`);
                try {
                    const fullChat = await tlClient.invoke(
                        chat.broadcast
                            ? new Api.channels.GetFullChannel({ channel: chat })
                            : new Api.messages.GetFullChat({ chatId: chat.id })
                    );
                    const aboutText = fullChat.fullChat?.about || '';
                    if (aboutText) {
                        // Inject "virtual message" to reuse extraction logic
                        results.push({ messages: [{ message: aboutText, chat: chat }], chats: [] });
                    }
                } catch (err) { }
            }
            await delay(300);
        }
    } catch (err) {
        console.warn('[Telegram Service] Hub Search failed:', err.message);
    }

    // --- Extraction & Deduplication ---
    const allMessages = [];
    const chatMap = new Map();
    for (const result of results) {
        if (result.messages) allMessages.push(...result.messages);
        if (result.chats) {
            for (const chat of result.chats) {
                if (chat.className === 'Channel' || chat.className === 'Chat') {
                    chatMap.set(chat.id.toString(), chat);
                }
            }
        }
    }

    const privateLinkRegex = /t\.me\/(?:\+|joinchat\/)([\w-]+)/g;
    const publicLinkRegex = /t\.me\/((?!joinchat\/)(?!\+)[A-Za-z]\w{3,30})(?:\s|$|[)\].,!?])/g;

    for (const msg of allMessages) {
        if (!msg.message) continue;
        const text = msg.message;
        const sourceTitle = msg.chat ? msg.chat.title : 'External Source';

        // Private Links
        let match;
        privateLinkRegex.lastIndex = 0;
        while ((match = privateLinkRegex.exec(text)) !== null) {
            const hash = extractInviteHash(match[0]);
            if (!hash || discoveryMap.has(hash)) continue;

            const title = text.split('\n')[0].substring(0, 60).trim() || 'Private Group';
            discoveryMap.set(hash, {
                title: title.replace(/[^\w\s\-.@#]/g, '') || 'Discovered Private',
                link: `https://t.me/+${hash}`,
                snippet: text.substring(0, 150).trim(),
                full_text: text,
                source_title: sourceTitle,
                type: 'private_discovered',
                id: hash
            });

            // Optional Auto-Join (Sequential with delay to avoid flood)
            if (autoJoin && hubOffset === 0) {
                console.log(`[Telegram Service] Auto-Joining: ${hash}`);
                try {
                    const joinRes = await joinGroup(match[0]);
                    if (joinRes && joinRes.error === 'flood_wait') {
                        console.warn(`[Telegram Service] Auto-Join stopped due to FloodWait (${joinRes.seconds}s)`);
                        floodWaitData = { seconds: joinRes.seconds, message: joinRes.message };
                        break; // Stop auto-joining if we hit a flood wait
                    }
                    await new Promise(r => setTimeout(r, 2500)); // 2.5s delay between joins
                } catch (err) {
                    console.warn(`[Telegram Service] Auto-Join failed for ${hash}:`, err.message);
                }
            }
        }

        // Public Links
        publicLinkRegex.lastIndex = 0;
        while ((match = publicLinkRegex.exec(text)) !== null) {
            const username = match[1].split('?')[0].split('/')[0].trim();
            if (['proxy', 'socks', 'share', 'c', 'iv', 's'].includes(username.toLowerCase())) continue;
            if (discoveryMap.has(username)) continue;

            discoveryMap.set(username, {
                title: `@${username}`,
                link: `https://t.me/${username}`,
                username: username,
                snippet: text.substring(0, 150).trim(),
                full_text: text,
                source_title: sourceTitle,
                type: 'public_discovered',
                id: username
            });
        }
    }

    // Merge entities from search coverage
    const kw = keyword.toLowerCase();
    for (const [cid, chat] of chatMap) {
        const title = (chat.title || '').toLowerCase();
        const username = (chat.username || '').toLowerCase();
        if (!title.includes(kw) && !username.includes(kw)) continue;

        const isPrivate = !chat.username;
        const key = isPrivate ? `ent_${cid}` : chat.username;
        if (discoveryMap.has(key)) continue;

        discoveryMap.set(key, {
            id: cid,
            title: chat.title || 'Unknown',
            link: chat.username ? `https://t.me/${chat.username}` : '',
            username: chat.username || '',
            access_hash: chat.accessHash?.toString() || '',
            type: isPrivate ? 'private_discovered' : 'public_discovered',
            snippet: `${chat.broadcast ? 'Channel' : 'Group'} found via search`,
            source: 'search_entity'
        });
    }

    console.log(`[Telegram Service] Discovery found ${discoveryMap.size} unique results`);
    return {
        results: Array.from(discoveryMap.values()),
        floodWait: floodWaitData
    };
};

const downloadMedia = async (groupId, messageId) => {
    const tlClient = await getClient();
    // Search by both UUID 'id' and MongoDB '_id'
    const dbGroup = await TelegramGroup.findOne({
        $or: [
            { id: groupId },
            { _id: mongoose.Types.ObjectId.isValid(groupId) ? groupId : null }
        ].filter(f => f._id !== null || f.id)
    });
    if (!dbGroup) throw new Error('Group not found in database');

    console.log(`[Telegram Service] Media Request: Msg ${messageId} | Group: ${dbGroup.title} (${dbGroup.telegram_id})`);

    try {
        let peer = await resolvePeer(tlClient, dbGroup);
        console.log(`[Telegram Service] Resolved Peer: ${peer.className} with ID ${peer.id}`);

        const messages = await tlClient.getMessages(peer, {
            ids: [parseInt(messageId)]
        });

        const msg = messages[0];
        if (!msg || msg.className === 'MessageEmpty') {
            console.error(`[Telegram Service] Message ${messageId} not found in peer ${peer.className}`);
            throw new Error('Message not found');
        }

        if (!msg.media) {
            console.error('[Telegram Service] Message has no media:', messageId);
            throw new Error('No media found');
        }

        // --- NEW: Check S3 Cache First ---
        const messageDoc = await TelegramMessage.findOne({ telegram_message_id: messageId, group_id: dbGroup.id });
        if (messageDoc && messageDoc.media && messageDoc.media.length > 0) {
            const cachedMedia = messageDoc.media.find(m => m.s3_url);
            if (cachedMedia && cachedMedia.s3_url) {
                console.log(`[Telegram Service] Found media in S3 cache: ${cachedMedia.s3_url}`);
                try {
                    const response = await axios.get(cachedMedia.s3_url, { responseType: 'arraybuffer' });
                    return {
                        buffer: Buffer.from(response.data),
                        mimeType: cachedMedia.mimeType || 'image/jpeg',
                        fileName: cachedMedia.fileName || ''
                    };
                } catch (s3Err) {
                    console.warn(`[Telegram Service] S3 cache fetch failed, falling back to Telegram: ${s3Err.message}`);
                }
            }
        }

        console.log(`[Telegram Service] Downloading media from Telegram (type: ${msg.media.className})...`);
        const buffer = await tlClient.downloadMedia(msg.media, {
            workers: 4
        });

        if (!buffer || buffer.length === 0) {
            throw new Error('Downloaded buffer is empty');
        }


        console.log(`[Telegram Service] Telegram download success. Size: ${buffer.length} bytes`);

        let mimeType = 'image/jpeg';
        let fileName = '';
        if (msg.media.document) {
            mimeType = msg.media.document.mimeType;
            if (msg.media.document.attributes) {
                const fileAttr = msg.media.document.attributes.find(a => a.className === 'DocumentAttributeFilename');
                if (fileAttr) fileName = fileAttr.fileName;
            }
        }

        return { buffer, mimeType, fileName };
    } catch (error) {
        console.error('[Telegram Service] downloadMedia failure:', error);
        throw error;
    }
};

/**
 * Check pending join requests by scanning dialogs for groups that were pending.
 * If a pending group is now in dialogs, update status to 'joined' and auto-scrape.
 */
const checkPendingGroups = async (force = false) => {
    if (isSyncing && !force) {
        console.log('[Telegram Service] Sync already in progress, skipping checkPendingGroups...');
        return { accepted: [], still_pending: [] };
    }
    isSyncing = true;
    try {
        return await _checkPendingGroups();
    } finally {
        isSyncing = false;
    }
};

const _checkPendingGroups = async () => {
    try {
        console.log('[Telegram Service] Syncing real-time group status and messaging counts...');
        const tlClient = await getClient();
        const dialogs = await tlClient.getDialogs({ limit: 200 });

        // Helper to sleep and avoid hitting flood limits too quickly
        const sleep = ms => new Promise(res => setTimeout(res, ms));

        // 1. Resolve Pending Groups
        const pendingGroups = await TelegramGroup.find({ status: 'pending' });
        const accepted = [];
        const stillPending = [];

        let hitFloodLimit = false;

        for (const pg of pendingGroups) {
            let found = null;

            // Try Api.messages.CheckChatInvite if we haven't hit a flood wait
            if (!hitFloodLimit) {
                try {
                    const hash = extractInviteHash(pg.invite_link);
                    if (hash) {
                        await sleep(2000); // 2-second rate limit throttle for checking invites
                        const result = await tlClient.invoke(new Api.messages.CheckChatInvite({ hash }));
                        if (result.className === 'ChatInviteAlready') {
                            found = result.chat;
                        }
                    }
                } catch (err) {
                    if (err.errorMessage === 'FLOOD' || err.code === 420 || err.message.includes('FLOOD')) {
                        console.warn(`[Telegram Service] FloodWait hit during checkPending: ${err.seconds || 'unknown'} seconds. Halting CheckChatInvite for now.`);
                        hitFloodLimit = true;
                    } else {
                        console.warn(`[Telegram Service] CheckChatInvite metadata for ${pg.invite_link}: ${err.message}`);
                    }
                }
            }

            // Fallback: title/id matching on dialogs
            if (!found) {
                for (const dialog of dialogs) {
                    if (!dialog.entity || (dialog.entity.className !== 'Channel' && dialog.entity.className !== 'Chat')) continue;
                    const chat = dialog.entity;
                    const chatTitle = (chat.title || '').toLowerCase();
                    const pgTitle = (pg.title || '').toLowerCase();

                    if (pg.telegram_id && !pg.telegram_id.startsWith('pending_') && chat.id.toString() === pg.telegram_id.replace('-100', '')) {
                        found = chat;
                        break;
                    }
                    if (pg.invite_link && !pg.invite_link.includes('+') && chatTitle.length > 3 && (chatTitle === pgTitle || chatTitle.includes(pgTitle))) {
                        found = chat;
                        break;
                    }
                }
            }

            if (found) {
                try {
                    const group = await TelegramGroup.findOneAndUpdate(
                        { id: pg.id },
                        {
                            $set: {
                                telegram_id: found.id.toString(),
                                title: found.title,
                                username: found.username || '',
                                access_hash: found.accessHash ? found.accessHash.toString() : '',
                                type: found.broadcast ? 'channel' : 'group',
                                status: 'joined',
                                is_active: true,
                                invite_link: pg.invite_link // Persist the original join link
                            }
                        },
                        { new: true }
                    );
                    accepted.push(group);
                    console.log(`[Telegram Service] Pending group accepted: ${found.title}`);
                } catch (err) {
                    if (err.code === 11000) {
                        console.warn(`[Telegram Service] Duplicate key error (joined) for ${found.title}, skipping...`);
                    } else {
                        throw err;
                    }
                }
            } else {
                stillPending.push(pg);
            }
        }

        // 2. Sync Unread Counts and New Mobile Joins
        let syncCount = 0;
        for (const dialog of dialogs) {
            if (!dialog.entity || (dialog.entity.className !== 'Channel' && dialog.entity.className !== 'Chat')) continue;
            const chat = dialog.entity;
            const unreadCount = dialog.unreadCount || 0;
            const topMsgId = dialog.message?.id || 0;
            const chatIdStr = chat.id.toString();

            // Robust match: check for ID with and without -100 prefix
            const existing = await TelegramGroup.findOne({
                $or: [
                    { telegram_id: chatIdStr },
                    { telegram_id: '-100' + chatIdStr },
                    { telegram_id: chatIdStr.startsWith('-100') ? chatIdStr.replace('-100', '') : chatIdStr }
                ]
            });

            if (existing) {
                const hasChanged = existing.unread_count !== unreadCount ||
                    existing.title !== chat.title ||
                    existing.status !== 'joined' ||
                    (existing.top_message_id || 0) < topMsgId;

                if (hasChanged) {
                    console.log(`[Telegram Service] Activity detected for ${chat.title}: Unread: ${unreadCount}, TopMsg: ${topMsgId}`);
                    await TelegramGroup.findOneAndUpdate(
                        { _id: existing._id },
                        {
                            $set: {
                                unread_count: unreadCount,
                                top_message_id: topMsgId,
                                title: chat.title,
                                status: 'joined',
                                is_active: true
                            }
                        }
                    );
                    syncCount++;
                }
            } else {
                // New group from mobile
                try {
                    const group = await TelegramGroup.findOneAndUpdate(
                        { telegram_id: chatIdStr },
                        {
                            $set: {
                                title: chat.title,
                                username: chat.username || '',
                                access_hash: chat.accessHash ? chat.accessHash.toString() : '',
                                type: chat.broadcast ? 'channel' : 'group',
                                status: 'joined',
                                is_active: true,
                                unread_count: unreadCount,
                                top_message_id: topMsgId
                            }
                        },
                        { upsert: true, new: true }
                    );
                    accepted.push(group);
                    console.log(`[Telegram Service] New group from mobile: ${chat.title}`);
                } catch (err) {
                    if (err.code === 11000) {
                        console.warn(`[Telegram Service] Duplicate key error (mobile) for ${chat.title}, skipping...`);
                    } else {
                        throw err;
                    }
                }
            }
        }

        console.log(`[Telegram Service] Sync complete: ${accepted.length} newly accepted/joined, ${stillPending.length} still pending, ${syncCount} existing groups updated with live counts.`);
        return { accepted, still_pending: stillPending };
    } catch (error) {
        console.error('[Telegram Service] checkPendingGroups failure:', error);
        throw error;
    }
};

/**
 * Batch scrape messages from all joined groups.
 */
const scrapeAllGroups = async (limit = 30, force = false) => {
    if (isSyncing && !force) {
        console.log('[Telegram Service] Sync already in progress, skipping scrapeAllGroups...');
        return [];
    }

    isSyncing = true;
    try {
        const groups = await TelegramGroup.find({ status: 'joined', is_active: true });
        console.log(`[Telegram Service] Batch scraping ${groups.length} groups...`);

        const results = [];
        for (const group of groups) {
            try {
                const messages = await fetchMessages(group.id, limit);
                results.push({ group_id: group.id, title: group.title, count: messages.length, success: true });
            } catch (err) {
                console.warn(`[Telegram Service] Scrape failed for ${group.title}:`, err.message);
                results.push({ group_id: group.id, title: group.title, count: 0, success: false, error: err.message });
            }
            // Small delay to avoid flood
            await new Promise(r => setTimeout(r, 1000));
        }
        return results;
    } finally {
        isSyncing = false;
    }
};

/**
 * Leave a Telegram group/channel and update status in DB.
 */
const leaveGroup = async (groupId) => {
    const tlClient = await getClient();
    // Search by both UUID 'id' and MongoDB '_id' for robustness
    const dbGroup = await TelegramGroup.findOne({
        $or: [
            { id: groupId },
            { _id: mongoose.Types.ObjectId.isValid(groupId) ? groupId : null }
        ].filter(f => f._id !== null || f.id)
    });
    if (!dbGroup) throw new Error('Group not found in database');

    console.log(`[Telegram Service] Leaving group: ${dbGroup.title}`);

    // For pending groups, just update DB status
    if (dbGroup.status === 'pending') {
        await TelegramGroup.updateOne({ id: groupId }, { $set: { status: 'left', is_active: false } });
        return { success: true, message: `Removed pending group: ${dbGroup.title}` };
    }

    try {
        const peer = await resolvePeer(tlClient, dbGroup);
        await tlClient.invoke(
            new Api.channels.LeaveChannel({ channel: peer })
        );
        console.log(`[Telegram Service] Successfully left: ${dbGroup.title}`);
    } catch (err) {
        // If it's a Chat (not Channel), try deleteChatUser
        if (err.message?.includes('CHANNEL_INVALID') || err.message?.includes('PEER_ID_INVALID')) {
            try {
                await tlClient.invoke(
                    new Api.messages.DeleteChatUser({
                        chatId: BigInt(dbGroup.telegram_id),
                        userId: new Api.InputUserSelf(),
                    })
                );
            } catch (innerErr) {
                console.warn(`[Telegram Service] Could not leave via API: ${innerErr.message}. Updating DB only.`);
            }
        } else {
            console.warn(`[Telegram Service] Leave API error: ${err.message}. Updating DB only.`);
        }
    }

    await TelegramGroup.updateOne({ id: groupId }, { $set: { status: 'left', is_active: false } });
    return { success: true, message: `Left group: ${dbGroup.title}` };
};

/**
 * Helper to mark a group as left/deactivated when it's no longer accessible via API.
 */
const deactivateGroup = async (groupId, reason = 'unknown') => {
    console.log(`[Telegram Service] Deactivating group ${groupId}. Reason: ${reason}`);
    await TelegramGroup.updateOne(
        {
            $or: [
                { id: groupId },
                { _id: mongoose.Types.ObjectId.isValid(groupId) ? groupId : null }
            ].filter(f => f.id || f._id)
        },
        { $set: { status: 'left', is_active: false } }
    );
};

/**
 * Mark a group as read in both Telegram API and our Database.
 */
const markAsRead = async (groupId) => {
    const tlClient = await getClient();
    const dbGroup = await TelegramGroup.findOne({
        $or: [
            { id: groupId },
            { _id: mongoose.Types.ObjectId.isValid(groupId) ? groupId : null }
        ].filter(f => f._id !== null || f.id)
    });
    if (!dbGroup) throw new Error('Group not found in database');

    try {
        const peer = await resolvePeer(tlClient, dbGroup);
        const topMsgs = await tlClient.invoke(new Api.messages.GetHistory({
            peer: peer,
            limit: 1
        }));

        if (topMsgs.messages && topMsgs.messages.length > 0) {
            const maxId = topMsgs.messages[0].id;
            await tlClient.invoke(new Api.messages.ReadHistory({
                peer: peer,
                maxId: maxId
            }));
        }

        await TelegramGroup.updateOne({ _id: dbGroup._id }, { $set: { unread_count: 0 } });
        return { success: true };
    } catch (err) {
        console.warn(`[Telegram Service] markAsRead failed for ${dbGroup.title}:`, err.message);
        // Still clear local DB count if user viewed it
        await TelegramGroup.updateOne({ _id: dbGroup._id }, { $set: { unread_count: 0 } });
        return { success: false, error: err.message };
    }
};

/**
 * Delete a group from the database and optionally its messages.
 * Also leaves the group on Telegram if still joined.
 */
const deleteGroup = async (groupId, deleteMessages = true) => {
    // Search by both UUID 'id' and MongoDB '_id'
    const dbGroup = await TelegramGroup.findOne({
        $or: [
            { id: groupId },
            { _id: mongoose.Types.ObjectId.isValid(groupId) ? groupId : null }
        ].filter(f => f._id !== null || f.id)
    });
    if (!dbGroup) throw new Error('Group not found in database');

    console.log(`[Telegram Service] Deleting group: ${dbGroup.title} (deleteMessages: ${deleteMessages})`);

    // Leave if still joined
    if (dbGroup.status === 'joined') {
        try {
            await leaveGroup(groupId);
        } catch (err) {
            console.warn(`[Telegram Service] Leave before delete failed: ${err.message}`);
        }
    }

    // Delete messages if requested
    let deletedMessages = 0;
    if (deleteMessages) {
        const result = await TelegramMessage.deleteMany({ group_id: groupId });
        deletedMessages = result.deletedCount || 0;
        console.log(`[Telegram Service] Deleted ${deletedMessages} messages for group: ${dbGroup.title}`);
    }

    // Delete the group record
    await TelegramGroup.deleteOne({ _id: dbGroup._id });
    console.log(`[Telegram Service] Group record deleted: ${dbGroup.title}`);

    return {
        success: true,
        message: `Deleted group: ${dbGroup.title}`,
        deleted_messages: deletedMessages
    };
};

/**
 * Rejoin a previously left group using stored username or invite_link.
 */
const rejoinGroup = async (groupId) => {
    // Search by both UUID 'id' and MongoDB '_id'
    const dbGroup = await TelegramGroup.findOne({
        $or: [
            { id: groupId },
            { _id: mongoose.Types.ObjectId.isValid(groupId) ? groupId : null }
        ].filter(f => f._id !== null || f.id)
    });
    if (!dbGroup) throw new Error('Group not found in database');
    if (dbGroup.status === 'joined') throw new Error('Already a member of this group');

    console.log(`[Telegram Service] Rejoining group: ${dbGroup.title}`);

    // Determine identifier to use for joining
    let identifier = '';
    if (dbGroup.username) {
        identifier = dbGroup.username;
    } else if (dbGroup.invite_link) {
        identifier = dbGroup.invite_link;
    } else {
        throw new Error('No username or invite link available to rejoin this group. Try joining manually with a fresh invite link.');
    }

    const result = await joinGroup(identifier);

    // If join was successful (not pending), update the existing DB record
    if (result && !result.status) {
        await TelegramGroup.updateOne({ _id: dbGroup._id }, {
            $set: { status: 'joined', is_active: true }
        });
    }

    return result;
};

const logout = async () => {
    if (client) {
        try {
            await client.disconnect();
        } catch (e) {
            console.warn('[Telegram Service] Error disconnecting during logout:', e.message);
        }
        client = null;
        connectionPromise = null;
    }

    // Clear session from DB
    await Settings.findOneAndUpdate(
        { id: 'global_settings' },
        { $unset: { telegram_session: "" } }
    );

    console.log('[Telegram Service] Logged out successfully.');
};

/**
 * Background loop to keep Telegram synced with the server.
 * Runs every 3 minutes:
 * 1. Checks for pending group approvals
 * 2. Syncs unread counts from mobile
 * 3. Automatically scrapes any groups with unread_count > 0
 */
let autoSyncInterval = null;
const startTelegramAutoSync = () => {
    if (autoSyncInterval) return;

    console.log('[Telegram Service] Starting Background Auto-Sync (Interval: 5m)');

    // Run once after 1 minute of startup to give connection time to stabilize
    setTimeout(() => runSyncCycle(), 60000);

    // Then run every 5 minutes
    autoSyncInterval = setInterval(() => runSyncCycle(), 5 * 60 * 1000);
};

const runSyncCycle = async (force = false) => {
    if (isSyncing && !force) {
        console.log('[Telegram Service] Sync already in progress, skipping runSyncCycle...');
        return;
    }

    isSyncing = true;
    try {
        const auth = await checkStatus();
        if (!auth.authenticated) {
            console.log('[Telegram Service] Auto-Sync skipped: Not authenticated');
            return;
        }

        // 1. Sync Dialogs (Pending groups + Unread counts)
        await _checkPendingGroups();

        // 2. Identify groups that actually have new messages
        const allJoined = await TelegramGroup.find({ status: 'joined', is_active: true });
        if (allJoined.length > 0) {
            console.log(`[Telegram Service] Sync Cycle: Tracking ${allJoined.length} active groups. [Activity: ${allJoined.map(g => `${g.title}: ${g.unread_count || 0} / New: ${(g.top_message_id || 0) > (g.last_message_id || 0)}`).join(', ')}]`);
        }

        const groupsToScrape = allJoined.filter(g =>
            (g.unread_count || 0) > 0 || (g.top_message_id || 0) > (g.last_message_id || 0)
        );

        if (groupsToScrape.length > 0) {
            console.log(`[Telegram Service] Auto-Scraping ${groupsToScrape.length} groups with new activity: ${groupsToScrape.map(g => g.title).join(', ')}`);
            for (const group of groupsToScrape) {
                try {
                    // Fetch up to 50 messages to ensure we catch the unread ones
                    await fetchMessages(group.id, 50);
                    // Small delay between groups to avoid flood
                    await new Promise(r => setTimeout(r, 2000));
                } catch (err) {
                    console.error(`[Telegram Service] Auto-Scrape failed for ${group.title}:`, err.message);
                }
            }
        }
    } catch (error) {
        console.error('[Telegram Service] Critical error in Auto-Sync cycle:', error.message);
    } finally {
        isSyncing = false;
    }
};

module.exports = {
    sendCode,
    signIn,
    checkStatus,
    searchGroups,
    joinGroup,
    leaveGroup,
    deleteGroup,
    rejoinGroup,
    fetchMessages,
    discoverInviteLinks,
    searchDialogsForKeyword,
    downloadMedia,
    syncJoinedGroups,
    checkPendingGroups,
    scrapeAllGroups,
    logout,
    startTelegramAutoSync,
};
