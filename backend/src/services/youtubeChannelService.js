/**
 * YouTube channel helpers over BluGate, written to stay inside the YouTube
 * Data API quota.
 *
 * `search.list` costs 100 units per call and has its own daily cap ("Search
 * Queries per day"); `channels.list`, `playlistItems.list` and `videos.list`
 * cost 1 unit each. Monitoring a channel therefore never uses search:
 *   identifier → channel id (channels.list: id / forHandle / forUsername)
 *   channel id → uploads playlist ("UC…" → "UU…")
 *   playlistItems.list → newest video ids
 *   videos.list (batched, up to 50 ids) → details + statistics
 * Search is used only to resolve a legacy /c/<custom-name> URL, which the
 * API cannot look up any other way.
 */
const blugateClient = require('./blugateClient');

const CHANNEL_ID_RX = /^UC[\w-]{22}$/;

/** Classify a channel identifier: raw id, channel URL, @handle, /user/ name, /c/ name. */
const parseIdentifier = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (CHANNEL_ID_RX.test(s)) return { kind: 'id', value: s };

    let path = s;
    try {
        if (/^https?:\/\//i.test(s)) path = new URL(s).pathname;
    } catch (_) { /* treat as a bare name */ }
    path = path.replace(/\/+$/, '');

    let m;
    if ((m = path.match(/\/channel\/(UC[\w-]{22})/))) return { kind: 'id', value: m[1] };
    if ((m = path.match(/\/@([\w.\-]+)/)) || (m = s.match(/^@([\w.\-]+)$/))) return { kind: 'handle', value: m[1] };
    if ((m = path.match(/\/user\/([\w.\-]+)/))) return { kind: 'username', value: m[1] };
    if ((m = path.match(/\/c\/([^/]+)/))) return { kind: 'custom', value: decodeURIComponent(m[1]) };
    if ((m = path.match(/^\/?([\w.\-]+)$/))) return { kind: 'custom', value: m[1] };
    return { kind: 'custom', value: s };
};

const channelsList = async (params) => {
    const res = await blugateClient.get('youtube', 'channels', { part: 'snippet', ...params });
    const item = res.data && res.data.items && res.data.items[0];
    return item ? { id: item.id, title: item.snippet ? item.snippet.title : '' } : null;
};

/**
 * Resolve any channel identifier to { id, title }, or null. Legacy custom
 * URLs are first tried as a handle and a username (both cheap) and only then
 * searched.
 */
const resolveChannel = async (identifier) => {
    const parsed = parseIdentifier(identifier);
    if (!parsed) return null;
    if (parsed.kind === 'id') return (await channelsList({ id: parsed.value })) || { id: parsed.value, title: '' };
    if (parsed.kind === 'handle') return channelsList({ forHandle: parsed.value });
    if (parsed.kind === 'username') {
        return (await channelsList({ forUsername: parsed.value })) || channelsList({ forHandle: parsed.value });
    }
    const cheap = (await channelsList({ forHandle: parsed.value })) || (await channelsList({ forUsername: parsed.value }));
    if (cheap) return cheap;
    const res = await blugateClient.get('youtube', 'search', { part: 'snippet', q: parsed.value, type: 'channel', maxResults: 1 });
    const hit = res.data && res.data.items && res.data.items[0];
    return hit ? { id: hit.id.channelId, title: hit.snippet ? hit.snippet.channelTitle : '' } : null;
};

/** Newest video ids of a channel from its uploads playlist (1 unit). */
const latestVideoIds = async (channelId, max = 10) => {
    const uploads = `UU${channelId.slice(2)}`;
    const res = await blugateClient.get('youtube', 'playlistItems', {
        part: 'contentDetails',
        playlistId: uploads,
        maxResults: Math.min(50, max),
    });
    return (res.data.items || []).map((i) => i.contentDetails && i.contentDetails.videoId).filter(Boolean);
};

/** Details + statistics for up to 50 videos in one call (1 unit). */
const videoDetails = async (ids) => {
    if (!ids.length) return [];
    const res = await blugateClient.get('youtube', 'videos', { part: 'snippet,statistics', id: ids.slice(0, 50).join(',') });
    return res.data.items || [];
};

module.exports = { CHANNEL_ID_RX, parseIdentifier, resolveChannel, latestVideoIds, videoDetails };
