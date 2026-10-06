/**
 * youtubeLiveChatReader.js
 *
 * Zero-quota YouTube Live Chat reader.
 *
 * Reads live chat through YouTube's own internal "InnerTube" endpoint — the
 * exact same one youtube.com/live_chat uses in the browser. This costs
 * ZERO YouTube Data API v3 quota units, which matters because
 * `liveChatMessages.list` would burn ~720 units/hour per stream and the whole
 * daily budget is 10,000 (see youtube.service.js for the quota'd client).
 *
 * Implemented in-house on purpose: the npm options (masterchat, youtube-chat)
 * were last published in 2022 and InnerTube's payload shape has moved since.
 *
 * Flow:
 *   1. resolveLiveVideo()  @handle | channelId  ->  currently-live videoId
 *   2. getChatContext()    videoId              ->  { apiKey, clientVersion, continuation }
 *   3. fetchChunk()        continuation         ->  { messages, nextContinuation, timeoutMs }
 *
 * fetchChunk() is a cursor: each call returns only messages that arrived since
 * the previous continuation token, so polling it in a loop yields new comments
 * as viewers post them.
 */

const axios = require('axios');

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/*
 * These headers matter more in production than in development.
 *
 * The reader scrapes youtube.com rather than calling the Data API, and YouTube
 * treats datacenter IPs differently from residential ones — it will serve a
 * consent interstitial or a stripped page where a home connection gets the real
 * one. An India locale keeps the served page consistent with what the feed is
 * about, and the CONSENT cookie pre-answers the interstitial that otherwise
 * replaces the page body (and takes INNERTUBE_API_KEY with it).
 */
const BASE_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'en-IN,en;q=0.9,te;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Cookie': 'CONSENT=YES+cb; SOCS=CAI',
};

/**
 * Did YouTube serve a challenge instead of the page we asked for?
 *
 * Distinguishing this from "channel isn't live" is the whole point: both look
 * like an empty result, but one is fixed by waiting and the other never is.
 *
 * Deliberately NOT keyword-matching the body. A healthy YouTube page is ~1.2 MB
 * and its bundled config mentions "recaptcha" among a long list of feature
 * flags, so scanning for that word flags every successful fetch as a challenge.
 * The reliable signals are where we were redirected to, and whether the page
 * carries the InnerTube config at all.
 */
const isChallengePage = (res, html) => {
    const finalUrl = String(res?.request?.res?.responseUrl || '');
    if (/consent\.youtube\.com|\/sorry\/index/i.test(finalUrl)) return true;

    // A challenge/error shell is a few KB and carries no InnerTube config;
    // a real page always has it.
    return html.length < 80000 && !/"INNERTUBE_API_KEY"/.test(html);
};

const DEFAULT_CLIENT_VERSION = '2.20260811.07.00';
const REQUEST_TIMEOUT_MS = 20000;

/* ─────────────────────────── helpers ─────────────────────────── */

const normalizeChannelRef = (ref) => {
    const raw = String(ref || '').trim();
    if (!raw) return null;

    // Full URL -> pull the meaningful segment.
    const urlMatch = raw.match(/youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22}|c\/[\w.-]+|user\/[\w.-]+)/i);
    if (urlMatch) {
        const seg = urlMatch[1];
        if (/^channel\//i.test(seg)) return seg.replace(/^channel\//i, '');
        return seg.replace(/^(c|user)\//i, '@').replace(/^@@/, '@');
    }

    if (/^UC[\w-]{22}$/.test(raw)) return raw;       // raw channel id
    if (raw.startsWith('@')) return raw;             // @handle
    return `@${raw}`;                                // bare handle
};

const channelUrl = (ref, tab) => {
    const norm = normalizeChannelRef(ref);
    if (!norm) return null;
    return norm.startsWith('@')
        ? `https://www.youtube.com/${norm}/${tab}`
        : `https://www.youtube.com/channel/${norm}/${tab}`;
};

const channelLiveUrl = (ref) => channelUrl(ref, 'live');

/**
 * Pull the "Live chat" continuation rather than the default "Top chat" one.
 * Top chat is YouTube-filtered and silently drops most messages — verified:
 * continuation #0 returned 0 messages while #1 returned the full firehose.
 */
const extractContinuations = (html) => {
    const ordered = [];

    // Preferred: the sort sub-menu explicitly labels the two modes.
    const subMenuRe = /"title":"(Live chat|Top chat)"[\s\S]{0,400}?"continuation":"([^"]+)"/g;
    let m;
    while ((m = subMenuRe.exec(html)) !== null) {
        ordered.push({ label: m[1], token: m[2] });
    }

    const live = ordered.find((c) => c.label === 'Live chat');
    const tokens = [];
    if (live) tokens.push(live.token);

    // Fallback: raw continuation tokens in document order. Index 1 is the
    // "Live chat" feed, index 0 is "Top chat".
    const all = [...html.matchAll(/"continuation":"([^"]+)"/g)].map((x) => x[1]);
    if (all[1]) tokens.push(all[1]);
    if (all[0]) tokens.push(all[0]);

    return [...new Set(tokens.filter(Boolean))];
};

/**
 * Walk a message's runs ONCE, in YouTube's own order, producing:
 *   - text          the plain analysis/search/fallback string (standard emoji
 *                    inlined as real Unicode, custom emoji inlined as their
 *                    ":shortcut:" placeholder — same shape callers already expect)
 *   - displayParts  ONLY set (non-empty) when the message contains a custom
 *                    emoji — an ordered [{part_type:'text',value}] /
 *                    [{part_type:'custom_emoji',image_url,alt}] sequence the
 *                    UI can render positionally, without ever having to search
 *                    `text` for a shortcut substring afterwards. Standard
 *                    emoji do NOT get their own part — they're already the
 *                    right thing to show, so they stay inline inside the
 *                    surrounding text part exactly like plain characters.
 */
const parseMessageRuns = (runs) => {
    let text = '';
    let textBuf = '';
    const parts = [];
    let hasCustomEmoji = false;

    const flushText = () => {
        if (textBuf) parts.push({ part_type: 'text', value: textBuf });
        textBuf = '';
    };

    for (const r of (runs || [])) {
        if (typeof r.text === 'string') {
            text += r.text;
            textBuf += r.text;
            continue;
        }
        if (!r.emoji) continue;

        if (r.emoji.isCustomEmoji === true) {
            // No Unicode equivalent exists for these — emojiId is an opaque
            // per-channel id, not a character. The shortcut is the only
            // text-safe stand-in, kept in `text` unchanged from the
            // pre-existing fallback; the real rendering comes from the image
            // captured below.
            hasCustomEmoji = true;
            const shortcut = r.emoji.shortcuts?.[0] || '';
            text += shortcut;

            flushText();
            parts.push({
                part_type: 'custom_emoji',
                // Durable identity, separate from image_url: the CDN link is a
                // yt3.ggpht.com hash path with no stated longevity guarantee,
                // while emojiId is the stable "{channelId}/{assetId}" YouTube
                // itself uses to identify this exact asset.
                emoji_id: r.emoji.emojiId || null,
                // Smallest thumbnail is enough for inline chat-sized rendering —
                // deliberately NOT storing the whole `image.thumbnails` array.
                image_url: r.emoji.image?.thumbnails?.[0]?.url || null,
                alt: r.emoji.image?.accessibility?.accessibilityData?.label
                    || shortcut.replace(/^:|:$/g, '')
                    || null,
            });
        } else {
            // Standard Unicode emoji: emojiId IS the actual character
            // (e.g. emojiId:"😅"). shortcuts[0] is only the text alias
            // (":sweat_smile:") and must not be preferred.
            const char = r.emoji.emojiId || r.emoji.shortcuts?.[0] || '';
            text += char;
            textBuf += char;
        }
    }
    flushText();

    // Trim edges to match text.trim() below, without leaving a stray empty
    // text part when the trimmed edge was the entire part.
    if (parts.length && parts[0].part_type === 'text') {
        parts[0].value = parts[0].value.replace(/^\s+/, '');
        if (!parts[0].value) parts.shift();
    }
    if (parts.length && parts[parts.length - 1].part_type === 'text') {
        const last = parts[parts.length - 1];
        last.value = last.value.replace(/\s+$/, '');
        if (!last.value) parts.pop();
    }

    return { text: text.trim(), displayParts: hasCustomEmoji ? parts : [] };
};

const parseRenderer = (renderer, kind) => {
    if (!renderer || !renderer.id) return null;

    const { text, displayParts } = parseMessageRuns(renderer.message?.runs);
    const purchase = renderer.purchaseAmountText?.simpleText || null;
    if (!text && !purchase) return null;

    const tsUsec = Number(renderer.timestampUsec || 0);
    const badges = (renderer.authorBadges || [])
        .map((b) => b.liveChatAuthorBadgeRenderer?.tooltip)
        .filter(Boolean);

    return {
        message_id: renderer.id,
        author_channel_id: renderer.authorExternalChannelId || null,
        author_name: renderer.authorName?.simpleText || 'Unknown',
        author_photo:
            renderer.authorPhoto?.thumbnails?.[renderer.authorPhoto.thumbnails.length - 1]?.url || null,
        text,
        display_parts: displayParts,
        published_at: tsUsec ? new Date(Math.floor(tsUsec / 1000)) : new Date(),
        is_superchat: kind === 'paid',
        superchat_amount: purchase,
        is_moderator: badges.some((b) => /moderator/i.test(b)),
        is_member: badges.some((b) => /member|sponsor/i.test(b)),
        is_owner: badges.some((b) => /owner/i.test(b)),
        badges,
    };
};

const channelStreamsUrl = (ref) => channelUrl(ref, 'streams');

/** "2.1K" / "1.5M" / "393" -> a number, for ranking streams by audience. */
const parseViewers = (raw) => {
    const m = String(raw || '').replace(/,/g, '').match(/^([\d.]+)([KM]?)$/i);
    if (!m) return 0;
    const n = parseFloat(m[1]) || 0;
    const unit = m[2].toUpperCase();
    return Math.round(unit === 'M' ? n * 1e6 : unit === 'K' ? n * 1e3 : n);
};

/**
 * Pull the inline ytInitialData blob out of a channel page.
 * YouTube ships the whole page model as JSON in a <script>, which is far more
 * stable to read than the rendered markup.
 */
const extractInitialData = (html) => {
    const m =
        html.match(/var ytInitialData = (\{.+?\});<\/script>/s) ||
        html.match(/window\["ytInitialData"\]\s*=\s*(\{.+?\});/s);
    if (!m) return null;
    try {
        return JSON.parse(m[1]);
    } catch (_) {
        return null;
    }
};

/* ─────────────────────────── public API ─────────────────────────── */

/**
 * EVERY broadcast a channel has live right now, newest/biggest first.
 *
 * `resolveLiveVideo()` below reads `/live`, which only ever redirects to
 * YouTube's single "primary" pick — so a news channel running seven
 * simultaneous streams (an election rally, a wedding, the rolling 24/7 feed…)
 * looked like it was running one. The /streams tab lists them all.
 *
 * Live vs finished is decided by the metadata line: a live broadcast reads
 * "N watching", an ended one reads "N views". YouTube now renders these as
 * `lockupViewModel`; `videoRenderer` is kept as a fallback for the older
 * layout, which is still served to some clients.
 */
const listLiveVideos = async (channelRef) => {
    const url = channelStreamsUrl(channelRef);
    if (!url) return [];

    const res = await axios.get(url, {
        headers: BASE_HEADERS,
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
    });
    if (res.status !== 200 || typeof res.data !== 'string') return [];

    // A challenge page parses as "nothing live", which would quietly retire a
    // healthy channel. Surface it instead so the operator sees the real cause.
    if (isChallengePage(res, res.data)) {
        throw fail('CHALLENGED', 'YouTube served a consent or bot-check page instead of the streams list');
    }

    const data = extractInitialData(res.data);
    if (!data) return [];

    const found = [];

    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(walk);

        // Current layout.
        const lock = node.lockupViewModel;
        if (lock?.contentId) {
            const blob = JSON.stringify(lock);
            const watching = blob.match(/"content":"([\d,.]+[KM]?) watching"/i)?.[1];
            if (watching) {
                found.push({
                    videoId: lock.contentId,
                    title: lock.metadata?.lockupMetadataViewModel?.title?.content || '',
                    viewers: parseViewers(watching),
                    thumbnail: `https://i.ytimg.com/vi/${lock.contentId}/hqdefault.jpg`,
                });
            }
        }

        // Older layout.
        const vr = node.videoRenderer;
        if (vr?.videoId) {
            const blob = JSON.stringify(vr);
            const watching = blob.match(/"([\d,.]+[KM]?) watching/i)?.[1];
            if (watching) {
                found.push({
                    videoId: vr.videoId,
                    title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || '',
                    viewers: parseViewers(watching),
                    thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
                });
            }
        }

        for (const v of Object.values(node)) walk(v);
    };

    walk(data);

    // Dedupe (a video can appear in more than one shelf) and rank by audience.
    const byId = new Map(found.map((f) => [f.videoId, f]));
    return [...byId.values()].sort((a, b) => b.viewers - a.viewers);
};

/**
 * Attach a machine-readable cause to a reader failure.
 *
 * Callers need to tell "this broadcast finished" (normal, expected, happens to
 * every stream) apart from "YouTube blocked us" or "the page shape changed"
 * (actionable). Without a code they all collapse into one generic message and
 * every completed stream looks like a fault.
 */
const fail = (code, message) => Object.assign(new Error(message), { code });

/**
 * The broadcast title.
 *
 * `videoDetails.title` is the video's own title. The older
 * `"title":{"simpleText":…}` pattern matches whichever UI label appears first
 * in the document, which is not always the video — it has been observed
 * storing interface strings such as "Like this video?" instead. Kept last as a
 * fallback for page variants that omit videoDetails.
 */
const extractVideoTitle = (html) => {
    const raw =
        html.match(/"videoDetails":\{[^}]*?"title":"((?:[^"\\]|\\.)*)"/)?.[1] ||
        html.match(/<meta\s+name="title"\s+content="([^"]*)"/i)?.[1] ||
        html.match(/"title":\{"simpleText":"((?:[^"\\]|\\.)*)"\}/)?.[1] ||
        null;

    if (!raw) return null;
    return raw
        .replace(/\\u0026/g, '&')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .trim() || null;
};

/**
 * Resolve a channel handle / id / URL to its currently-live videoId.
 * Returns null when the channel is not live right now.
 */
const resolveLiveVideo = async (channelRef) => {
    const url = channelLiveUrl(channelRef);
    if (!url) return null;

    const res = await axios.get(url, {
        headers: BASE_HEADERS,
        maxRedirects: 5,
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
    });

    if (res.status !== 200 || typeof res.data !== 'string') return null;
    const html = res.data;

    // `/live` on a non-live channel serves the channel page instead, so the
    // isLive flag is what separates "currently streaming" from "latest upload".
    const isLive = /"isLiveNow":true/.test(html) || /"isLive":true/.test(html);
    if (!isLive) return null;

    const videoId = html.match(/"videoId":"([\w-]{11})"/)?.[1] || null;
    if (!videoId) return null;

    return {
        videoId,
        title: extractVideoTitle(html),
        channelId: html.match(/"channelId":"(UC[\w-]{22})"/)?.[1] || null,
        channelName: html.match(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/)?.[1] || null,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
};

/**
 * Build the InnerTube session for a live video's chat.
 *
 * Throws with a `code` rather than returning null, because the four ways this
 * fails need different handling and used to be indistinguishable:
 *
 *   CHAT_ENDED  the broadcast finished, or chat is switched off — expected
 *   CHALLENGED  YouTube served a consent/blocked page instead of chat
 *   HTTP        transport or non-200 — usually transient, worth retrying
 *   PAGE_SHAPE  a 200 that no longer parses — the reader needs updating
 */
const getChatContext = async (videoId) => {
    let res;
    try {
        res = await axios.get(`https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`, {
            headers: BASE_HEADERS,
            timeout: REQUEST_TIMEOUT_MS,
            validateStatus: () => true,
        });
    } catch (err) {
        throw fail('HTTP', `Could not reach YouTube live chat: ${err.message}`);
    }

    if (res.status !== 200 || typeof res.data !== 'string') {
        throw fail('HTTP', `YouTube live chat returned HTTP ${res.status}`);
    }

    const html = res.data;

    if (isChallengePage(res, html)) {
        throw fail('CHALLENGED', 'YouTube served a consent or bot-check page instead of live chat');
    }

    const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
    const clientVersion = html.match(/"clientVersion":"([\d.]+)"/)?.[1] || DEFAULT_CLIENT_VERSION;
    const continuations = extractContinuations(html);

    if (!apiKey) {
        throw fail('PAGE_SHAPE', 'InnerTube key not found on the live chat page — YouTube markup may have changed');
    }

    // Key present but no continuation: chat exists as a page but has nothing to
    // subscribe to, which is what a finished or chat-disabled broadcast looks like.
    if (!continuations.length) {
        throw fail('CHAT_ENDED', 'Broadcast has ended or live chat is turned off for it');
    }

    return { videoId, apiKey, clientVersion, continuations, continuation: continuations[0] };
};

/**
 * Fetch one chunk of live chat. Pass the continuation returned by the previous
 * call to get only what arrived since. `timeoutMs` is YouTube telling us how
 * long to wait before polling again — always respect it.
 */
const fetchChunk = async (ctx, continuation) => {
    const token = continuation || ctx.continuation;
    const url = `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${ctx.apiKey}&prettyPrint=false`;

    const res = await axios.post(
        url,
        {
            context: { client: { clientName: 'WEB', clientVersion: ctx.clientVersion } },
            continuation: token,
        },
        {
            headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
            timeout: REQUEST_TIMEOUT_MS,
            validateStatus: () => true,
        }
    );

    if (res.status !== 200) {
        const err = new Error(`InnerTube live_chat HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }

    const lcc = res.data?.continuationContents?.liveChatContinuation;
    if (!lcc) {
        // Stream ended or chat closed — no continuation means stop polling.
        return { messages: [], nextContinuation: null, timeoutMs: null, ended: true };
    }

    const contData = lcc.continuations?.[0] || {};
    const inner = Object.values(contData)[0] || {};

    const messages = [];
    for (const action of lcc.actions || []) {
        const item = action.addChatItemAction?.item;
        if (!item) continue;

        const parsed =
            parseRenderer(item.liveChatTextMessageRenderer, 'text') ||
            parseRenderer(item.liveChatPaidMessageRenderer, 'paid') ||
            parseRenderer(item.liveChatPaidStickerRenderer, 'paid');

        if (parsed) messages.push({ ...parsed, video_id: ctx.videoId });
    }

    return {
        messages,
        nextContinuation: inner.continuation || null,
        timeoutMs: inner.timeoutMs || null,
        ended: false,
    };
};

/**
 * Probe every candidate continuation once and keep the one that actually
 * yields messages. Used on stream start so we never get stuck on "Top chat".
 */
const pickLiveContinuation = async (ctx) => {
    let fallback = ctx.continuations[0];

    for (const token of ctx.continuations.slice(0, 3)) {
        try {
            const chunk = await fetchChunk(ctx, token);
            if (chunk.ended) continue;
            if (chunk.messages.length > 0) {
                return { continuation: chunk.nextContinuation || token, primed: chunk };
            }
            if (chunk.nextContinuation) fallback = chunk.nextContinuation;
        } catch (_) {
            /* try the next candidate */
        }
    }

    return { continuation: fallback, primed: null };
};

module.exports = {
    listLiveVideos,
    resolveLiveVideo,
    getChatContext,
    fetchChunk,
    pickLiveContinuation,
    normalizeChannelRef,
    // exported for tests
    parseMessageRuns,
};
