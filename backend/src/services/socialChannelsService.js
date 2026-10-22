/**
 * socialChannelsService — Social Media & Communication Channels (client requirement 2).
 *
 *   "Sentiments in digital platforms, rallies, or community outreach.
 *    Top discussion topics: sentiments towards the party and opposition.
 *    Platform, volume, source type. Response strategy."
 *
 * Over a window of 7–90 days, from posts and news articles the platform has
 * already collected and scored — nothing here re-scores a post:
 *
 *   channels    the three channels the requirement names: digital platforms,
 *               rallies, community outreach (outreachChannels.js), each with
 *               volume and sentiment towards BRS and towards the opposition
 *   parties     sentiment towards BRS, INC, BJP and AIMIM separately
 *   topics      top discussion topics, each with sentiment towards BRS and the
 *               opposition, platform, volume and source type
 *   platforms   volume and sentiment per platform, and per source type
 *   strategy    what to counter, what to amplify, and where
 *
 * Sentiment towards BRS / the opposition, from the stored stance
 * (stanceVocabulary: "target" = BRS):
 *   towards BRS          pro_target = positive, anti_target = negative
 *   towards opposition   anti_target_indirect (a rival praised) = positive,
 *                        pro_target_indirect (a rival criticised) = negative
 *
 * VOLUME counts every post. SENTIMENT counts only the public and news media:
 * party and government accounts (ours and theirs) are publicity, not opinion —
 * @INCTelangana praising Congress is not the public feeling positive about it.
 * Source type is classifyVoice (owned / opposition / news / organic).
 */
const Grievance = require('../models/Grievance');
const NewsArticle = require('../models/NewsArticle');
const Event = require('../models/Event');
const Content = require('../models/Content');
const { grievanceGate, newsGate } = require('../config/displayGate');
const { normalizeStance } = require('./stanceVocabulary');
const { offlineChannelOf } = require('./outreachChannels');
const { OUR_PARTY, OPPOSITION_PARTIES } = require('../config/politicalData');
const {
    classifyVoice, netScore, engagementOf, partyAliasRx,
} = require('../controllers/cmDashboardController');

const VOICES = [
    { id: 'organic', label: 'Public' },
    { id: 'news', label: 'News media' },
    { id: 'opposition', label: 'Rival party & government accounts' },
    { id: 'owned', label: 'BRS accounts' },
];
const VOICE_LABEL = Object.fromEntries(VOICES.map((v) => [v.id, v.label]));
const CHANNELS = [
    { id: 'digital', label: 'Digital platforms', sub: 'Every post and news article collected' },
    { id: 'rally', label: 'Rallies', sub: 'Posts about rallies, public meetings, padayatras, dharnas and protests' },
    { id: 'outreach', label: 'Community outreach', sub: 'Posts about door-to-door campaigns, village visits, darbars and meetings with people' },
];
const RIVALS = ['INC', 'BJP', 'AIMIM'];
/**
 * A change is only claimed when both windows have at least this many posts.
 * Changes compare SHARES of the conversation, not raw counts: collection grows
 * as sources are added, which would make every topic look like it is rising.
 */
const MIN_TREND = 20;
const share = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);
const NO_TOPIC = new Set(['', 'None', 'none', 'Normal']);
const PLATFORM_NAME = { x: 'X', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', whatsapp: 'WhatsApp', news: 'news websites' };

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const topOf = (counts, n = 1) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
const bump = (obj, k, by = 1) => { obj[k] = (obj[k] || 0) + by; };
const platformName = (p) => PLATFORM_NAME[p] || p;

/* ── one shape for a social post and a news article ─────────────────────── */

const entityNames = (d) => {
    const ents = d.analysis?.mentioned_entities;
    if (!Array.isArray(ents)) return [];
    return ents.map((e) => (typeof e === 'string' ? e : (e?.name || e?.canonical || e?.id))).filter(Boolean);
};

const fromMention = (d) => {
    const text = d.content?.text || '';
    return {
        kind: 'post',
        date: d.post_date,
        platform: d.platform || 'unknown',
        voice: classifyVoice(d.posted_by?.handle, d.posted_by?.display_name),
        topic: d.analysis?.topic || null,
        stance: normalizeStance(d.analysis?.political_stance || d.analysis?.stance),
        target: d.analysis?.target || null,
        offline: offlineChannelOf(text),
        engagement: engagementOf(d.engagement),
        text,
        entities: entityNames(d),
        url: d.tweet_url || null,
        author: d.posted_by?.display_name || d.posted_by?.handle || null,
        seat: d.detected_location?.constituency || null,
    };
};

const fromArticle = (a) => {
    const text = a.title_english || a.title || '';
    return {
        kind: 'article',
        date: a.published_date,
        platform: 'news',
        voice: 'news',
        topic: a.campaign_topic || null,
        stance: normalizeStance(a.political_stance),
        target: null,
        offline: offlineChannelOf(`${a.title || ''} ${a.title_english || ''}`),
        engagement: 0,
        text,
        entities: [],
        url: a.source_url || null,
        author: a.source_name || null,
        seat: a.detected_location?.constituency || null,
    };
};

const hasTopic = (i) => i.topic && !NO_TOPIC.has(i.topic);
/** Whose posts count towards sentiment: the public and the press. */
const isOpinion = (i) => i.voice === 'organic' || i.voice === 'news';

/* ── sentiment towards BRS and towards the opposition ───────────────────── */

const blankSentiment = () => ({ brs: { positive: 0, negative: 0 }, opposition: { positive: 0, negative: 0 } });
const addSentiment = (s, i) => {
    if (!isOpinion(i)) return;
    if (i.stance === 'pro_target') s.brs.positive += 1;
    else if (i.stance === 'anti_target') s.brs.negative += 1;
    else if (i.stance === 'anti_target_indirect') s.opposition.positive += 1;
    else if (i.stance === 'pro_target_indirect') s.opposition.negative += 1;
};
const finishSentiment = (s) => ({
    brs: { ...s.brs, net: netScore(s.brs.positive, s.brs.negative) },
    opposition: { ...s.opposition, net: netScore(s.opposition.positive, s.opposition.negative) },
});

/** Volume, sentiment, platform and source-type counts over a list of items. */
const rollup = (items) => {
    const s = blankSentiment();
    const platforms = {}; const sources = {}; const topics = {};
    let engagement = 0;
    for (const i of items) {
        addSentiment(s, i);
        bump(platforms, i.platform);
        bump(sources, i.voice);
        if (hasTopic(i)) bump(topics, i.topic);
        engagement += i.engagement;
    }
    const topSource = topOf(sources)[0] || null;
    return {
        posts: items.length,
        ...finishSentiment(s),
        platforms,
        top_platform: topOf(platforms)[0] || null,
        sources,
        top_source: topSource,
        top_source_label: topSource ? VOICE_LABEL[topSource] : null,
        top_topics: topOf(topics, 3),
        engagement,
    };
};

const evidence = (i) => ({
    text: i.text.length > 220 ? `${i.text.slice(0, 217)}…` : i.text,
    url: i.url, author: i.author, platform: i.platform, source_type: VOICE_LABEL[i.voice], engagement: i.engagement, stance: i.stance,
});
/** The most engaged posts with a link, one per distinct text (the same post is often collected twice). */
const mostEngaged = (items, n = 3) => {
    const seen = new Set();
    return items.filter((i) => i.url).sort((a, b) => b.engagement - a.engagement)
        .filter((i) => { const k = i.text.replace(/\s+/g, ' ').trim().slice(0, 120); if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, n).map(evidence);
};

/* ── the three channels: digital platforms, rallies, community outreach ──── */

const channels = (cur, prev) => CHANNELS.map((c) => {
    const pick = (list) => (c.id === 'digital' ? list : list.filter((i) => i.offline === c.id));
    const now = pick(cur);
    return {
        ...c,
        ...rollup(now),
        prev_posts: pick(prev).length,
        // Rallies and outreach are read from the posts about them: show what was said.
        examples: c.id === 'digital' ? [] : mostEngaged(now),
    };
});

/* ── parties ────────────────────────────────────────────────────────────── */

const OUR_RX = partyAliasRx(OUR_PARTY);
const RIVAL_RX = (OPPOSITION_PARTIES || [])
    .filter((p) => RIVALS.includes(p.name))
    .map((p) => ({ name: p.name, rx: partyAliasRx(p) }))
    .filter((p) => p.rx);

/** Rival parties a post names. A post aimed at "the state government" with no party named is about INC, which forms it. */
const rivalsNamed = (i) => {
    const hay = `${i.text} ${i.entities.join(' ')}`;
    const named = RIVAL_RX.filter((p) => p.rx.test(hay)).map((p) => p.name);
    if (!named.length && i.target === 'state_government') named.push('INC');
    return named;
};

/** Sentiment towards each party separately, in the public and press voice, with what each is praised and attacked for. */
const partySentiment = (items) => {
    const rows = Object.fromEntries([OUR_PARTY.name, ...RIVALS].map((p) => [p, { party: p, mentions: 0, positive: 0, negative: 0, neutral: 0, praised: {}, attacked: {} }]));
    const add = (party, tone, i) => {
        const r = rows[party];
        if (!r) return;
        r.mentions += 1;
        r[tone] += 1;
        if (hasTopic(i) && tone === 'positive') bump(r.praised, i.topic);
        if (hasTopic(i) && tone === 'negative') bump(r.attacked, i.topic);
    };
    for (const i of items.filter(isOpinion)) {
        const s = i.stance;
        if (s === 'pro_target') add(OUR_PARTY.name, 'positive', i);
        else if (s === 'anti_target') add(OUR_PARTY.name, 'negative', i);
        else if (s === 'pro_target_indirect') rivalsNamed(i).forEach((p) => add(p, 'negative', i));
        else if (s === 'anti_target_indirect') rivalsNamed(i).forEach((p) => add(p, 'positive', i));
        else if (s === 'neutral' || s === 'mixed') {
            const hay = `${i.text} ${i.entities.join(' ')}`;
            if (OUR_RX && OUR_RX.test(hay)) add(OUR_PARTY.name, 'neutral', i);
            RIVAL_RX.filter((p) => p.rx.test(hay)).forEach((p) => add(p.name, 'neutral', i));
        }
    }
    return rows;
};

const parties = (cur, prev) => {
    const now = partySentiment(cur);
    const before = partySentiment(prev);
    return Object.values(now).map(({ praised, attacked, ...r }) => ({
        ...r,
        ours: r.party === OUR_PARTY.name,
        net: netScore(r.positive, r.negative),
        prev_net: netScore(before[r.party].positive, before[r.party].negative),
        praised_for: topOf(praised, 3),
        attacked_for: topOf(attacked, 3),
    }));
};

/* ── top discussion topics ──────────────────────────────────────────────── */

const topics = (cur, prev, limit = 10) => {
    const prevCount = {};
    prev.filter(hasTopic).forEach((i) => bump(prevCount, i.topic));
    const byTopic = new Map();
    for (const i of cur.filter(hasTopic)) {
        if (!byTopic.has(i.topic)) byTopic.set(i.topic, []);
        byTopic.get(i.topic).push(i);
    }
    return [...byTopic.entries()]
        .map(([topic, list]) => {
            const r = rollup(list);
            const before = prevCount[topic] || 0;
            const nowShare = share(r.posts, cur.length);
            const prevShare = share(before, prev.length);
            return {
                topic,
                ...r,
                prev_posts: before,
                share_pct: nowShare,
                prev_share_pct: before >= MIN_TREND ? prevShare : null,
                share_change: r.posts >= MIN_TREND && before >= MIN_TREND ? Math.round((nowShare - prevShare) * 10) / 10 : null,
            };
        })
        .sort((a, b) => b.posts - a.posts)
        .slice(0, limit);
};

/* ── platforms and source types ─────────────────────────────────────────── */

const platforms = (cur) => {
    const byPlatform = new Map();
    for (const i of cur) {
        if (!byPlatform.has(i.platform)) byPlatform.set(i.platform, []);
        byPlatform.get(i.platform).push(i);
    }
    return [...byPlatform.entries()].map(([platform, list]) => ({ platform, ...rollup(list) })).sort((a, b) => b.posts - a.posts);
};

/** Per source type, sentiment is what THAT group says — so party accounts are counted here, unlike everywhere else. */
const sourceTypes = (cur) => VOICES.map((v) => {
    const list = cur.filter((i) => i.voice === v.id);
    const s = blankSentiment();
    for (const i of list) addSentiment(s, { ...i, voice: 'organic' });
    const plats = {};
    list.forEach((i) => bump(plats, i.platform));
    return { voice: v.id, label: v.label, posts: list.length, ...finishSentiment(s), platforms: plats, top_platform: topOf(plats)[0] || null };
}).filter((v) => v.posts);

/* ── response strategy ──────────────────────────────────────────────────── */

/** "Mostly X (70%)" only when it is a majority; otherwise "X — the largest share (44%)". */
const led = (who, part) => (part >= 50 ? `Mostly ${who} (${part}%)` : `${who[0].toUpperCase()}${who.slice(1)} — the largest share (${part}%)`);
const ACTIONS = {
    opposition: (t, platform, part) => ({
        type: 'Rebut',
        text: `${led('pushed by rival party and government accounts', part)}. Rebut with facts and BRS's record on ${platform}; reply on the issue rather than resharing their posts.`,
    }),
    organic: (t, platform, part) => ({
        type: 'Respond',
        text: `${led('ordinary people', part)} — a real public concern. Acknowledge it, state BRS's position on ${t}, and have local leaders engage on ${platform}.`,
    }),
    news: (t, platform, part) => ({
        type: 'Brief the press',
        text: `${led('news coverage', part)}. Put out a statement or press brief on ${t} and share it on ${platform}.`,
    }),
};

const strategy = (cur, prev, chans, limit = 5) => {
    // Counter: criticism of BRS, by topic. Rival accounts count here — their attacks need an answer.
    const critical = cur.filter((i) => i.voice !== 'owned' && hasTopic(i) && i.stance === 'anti_target');
    const prevCritical = {};
    prev.filter((i) => i.voice !== 'owned' && hasTopic(i) && i.stance === 'anti_target').forEach((i) => bump(prevCritical, i.topic));
    const byTopic = new Map();
    critical.forEach((i) => { if (!byTopic.has(i.topic)) byTopic.set(i.topic, []); byTopic.get(i.topic).push(i); });
    const counter = [...byTopic.entries()]
        .filter(([, list]) => list.length >= 3)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, limit)
        .map(([topic, list]) => {
            const voices = {}; const plats = {};
            list.forEach((i) => { bump(voices, i.voice); bump(plats, i.platform); });
            const driver = topOf(voices)[0];
            const platform = topOf(plats)[0];
            const driverShare = pct(voices[driver], list.length);
            const before = prevCritical[topic] || 0;
            // Rising = a bigger share of everything collected than last period, not just more posts.
            const nowShare = share(list.length, cur.length);
            const prevShare = share(before, prev.length);
            return {
                topic,
                criticism: list.length,
                prev_criticism: before,
                share_pct: nowShare,
                prev_share_pct: prevShare,
                rising: list.length >= MIN_TREND && before >= MIN_TREND / 2 && nowShare >= prevShare * 1.25,
                driven_by: driver,
                driven_by_label: VOICE_LABEL[driver],
                driven_by_pct: driverShare,
                top_platform: platform,
                action: ACTIONS[driver](topic, platformName(platform), driverShare),
                examples: mostEngaged(list, 2),
            };
        });

    // Amplify: where the public and press already criticise the opposition.
    const amp = {};
    cur.filter((i) => isOpinion(i) && hasTopic(i) && i.stance === 'pro_target_indirect').forEach((i) => {
        if (!amp[i.topic]) amp[i.topic] = { topic: i.topic, posts: 0, platforms: {} };
        amp[i.topic].posts += 1;
        bump(amp[i.topic].platforms, i.platform);
    });
    const amplify = Object.values(amp)
        .filter((a) => a.posts >= 3)
        .sort((a, b) => b.posts - a.posts)
        .slice(0, 3)
        .map(({ platforms: plats, ...a }) => {
            const platform = topOf(plats)[0];
            return {
                ...a,
                top_platform: platform,
                action: { type: 'Amplify', text: `The public and press are already criticising the government on ${a.topic} (${a.posts} posts, mostly on ${platformName(platform)}). Amplify it with BRS's record and a clear alternative.` },
            };
        });

    // Where: each channel and platform, by how the public and press feel about BRS there.
    const verdict = (r) => {
        const decided = r.brs.positive + r.brs.negative;
        if (decided < 5) return { tone: 'quiet', text: 'Too little said about BRS here to judge.' };
        if (r.brs.net < 0) return { tone: 'negative', text: `More criticism than praise of BRS (${r.brs.negative} vs ${r.brs.positive}) — respond here first.` };
        return { tone: 'positive', text: `More praise than criticism of BRS (${r.brs.positive} vs ${r.brs.negative}) — keep it going and share more here.` };
    };
    const where = [
        ...chans.filter((c) => c.id !== 'digital').map((c) => ({ id: c.id, label: c.label, posts: c.posts, brs: c.brs, ...verdict(c) })),
        ...platforms(cur).map((p) => ({ id: p.platform, label: platformName(p.platform), posts: p.posts, brs: p.brs, ...verdict(p) })),
    ];

    return { counter, amplify, where };
};

/* ── tracked events (Events monitoring) ─────────────────────────────────── */

/** Each event set up under Events, with the posts Events monitoring matched to it. */
const eventSummary = (events, posts) => {
    const byEvent = new Map(events.map((e) => [e.id, {
        id: e.id, name: e.name, location: e.location || null, status: e.status,
        start_date: e.start_date, end_date: e.end_date,
        posts: 0, positive: 0, negative: 0, neutral: 0, platforms: {},
    }]));
    for (const p of posts) {
        for (const id of p.event_ids || []) {
            const r = byEvent.get(id);
            if (!r) continue;
            r.posts += 1;
            const tone = p.sentiment === 'moderate' ? 'neutral' : (p.sentiment || 'neutral');
            if (r[tone] !== undefined) r[tone] += 1;
            bump(r.platforms, p.platform);
        }
    }
    return [...byEvent.values()].sort((a, b) => b.posts - a.posts || new Date(b.start_date) - new Date(a.start_date));
};

/* ── putting it together ────────────────────────────────────────────────── */

const DAY = 86400000;

/** Everything the tab shows, from items already mapped by fromMention / fromArticle. */
const summariseItems = ({ items, events = [], eventPosts = [], from, days }) => {
    const prevFrom = new Date(from.getTime() - days * DAY);
    const cur = []; const prev = [];
    for (const i of items) {
        const t = new Date(i.date);
        if (t >= from) cur.push(i);
        else if (t >= prevFrom) prev.push(i);
    }
    const chans = channels(cur, prev);
    const all = rollup(cur);
    return {
        days,
        totals: {
            posts: cur.filter((i) => i.kind === 'post').length,
            articles: cur.filter((i) => i.kind === 'article').length,
            prev_total: prev.length,
            brs: all.brs,
            opposition: all.opposition,
        },
        channels: chans,
        parties: parties(cur, prev),
        topics: topics(cur, prev),
        platforms: platforms(cur),
        source_types: sourceTypes(cur),
        events: eventSummary(events, eventPosts.filter((p) => !p.published_at || new Date(p.published_at) >= from)),
        strategy: strategy(cur, prev, chans),
    };
};

/** The same, from raw rows. Pure: the test calls this directly. */
const summarise = ({ mentions = [], articles = [], events = [], eventPosts = [], from, days }) => summariseItems({
    items: [...mentions.map(fromMention), ...articles.map(fromArticle)], events, eventPosts, from, days,
});

/* ── the in-memory store ────────────────────────────────────────────────────
 *
 * Measured on the live database: the read itself is indexed (post_date) and
 * takes ~50 ms on the server, but returning ~7,500 full posts is ~10 MB, which
 * took 8–11 s to cross the network from the remote database — on every request
 * and every change of window.
 *
 * So the posts are read ONCE, trimmed to what this tab uses (text cut to its
 * first TEXT_CHARS characters, entity names only), mapped, and kept in memory.
 * Every window (7 / 30 / 90 days) and every user's seat scope is computed from
 * that copy in milliseconds. The copy is reloaded in the background every
 * REFRESH_MS while the tab is in use, and warmed once when the server starts.
 */
const WINDOWS = [7, 30, 90];
const KEEP_DAYS = Math.max(...WINDOWS) * 2;          // the longest window and the one before it
const TEXT_CHARS = 600;                               // rallies, outreach and party names are matched in this much text
const REFRESH_MS = 10 * 60 * 1000;
const MAX_STALE_MS = 30 * 60 * 1000;                  // older than this, a request waits for fresh data
const ACTIVE_MS = 60 * 60 * 1000;                     // keep refreshing while the tab was opened within this

const entityNamesExpr = {
    $map: {
        input: { $cond: [{ $isArray: '$analysis.mentioned_entities' }, '$analysis.mentioned_entities', []] },
        as: 'e',
        in: { $cond: [{ $eq: [{ $type: '$$e' }, 'string'] }, '$$e', { $ifNull: ['$$e.name', { $ifNull: ['$$e.canonical', '$$e.id'] }] }] },
    },
};
const textExpr = (field) => ({ $substrCP: [{ $ifNull: [field, ''] }, 0, TEXT_CHARS] });

const fetchRows = async () => {
    const since = new Date(Date.now() - KEEP_DAYS * DAY);
    const gG = grievanceGate();
    const nG = newsGate();
    const [mentions, articles, events] = await Promise.all([
        Grievance.aggregate([
            { $match: { $and: [{ post_date: { $gte: since }, is_active: { $ne: false } }, ...(gG ? [gG] : [])] } },
            { $project: {
                _id: 0, post_date: 1, platform: 1, tweet_url: 1,
                engagement: { likes: 1, retweets: 1, replies: 1, quotes: 1 },
                posted_by: { handle: 1, display_name: 1 },
                content: { text: textExpr('$content.text') },
                analysis: {
                    topic: '$analysis.topic', political_stance: '$analysis.political_stance', stance: '$analysis.stance',
                    target: '$analysis.target', mentioned_entities: entityNamesExpr,
                },
                detected_location: { constituency: '$detected_location.constituency' },
            } },
        ]).allowDiskUse(true),
        NewsArticle.find({ $and: [{ published_date: { $gte: since } }, ...(nG ? [nG] : [])] })
            .select('-_id published_date title title_english source_url source_name campaign_topic political_stance detected_location.constituency')
            .lean(),
        Event.find({ $or: [{ end_date: null }, { end_date: { $gte: new Date(Date.now() - Math.max(...WINDOWS) * DAY) } }] })
            .select('-_id id name location status start_date end_date').sort({ start_date: -1 }).limit(50).lean(),
    ]);
    const eventPosts = events.length
        ? await Content.find({ event_ids: { $in: events.map((e) => e.id) }, published_at: { $gte: new Date(Date.now() - Math.max(...WINDOWS) * DAY) } })
            .select('-_id event_ids platform sentiment published_at').lean()
        : [];
    return { items: [...mentions.map(fromMention), ...articles.map(fromArticle)], events, eventPosts };
};

const store = { data: null, loadedAt: 0, inflight: null, lastAsked: 0, timer: null, results: new Map() };

/** Reload the copy. Concurrent callers share one read; a failed reload keeps the last good copy. */
const refresh = () => {
    if (!store.inflight) {
        const t = Date.now();
        store.inflight = fetchRows()
            .then((data) => {
                store.data = data;
                store.loadedAt = Date.now();
                store.results.clear();
                console.log(`[socialChannels] loaded ${data.items.length} posts and articles in ${Date.now() - t} ms`);
                return data;
            })
            .catch((err) => {
                console.warn('[socialChannels] reload failed:', err.message);
                if (store.data) return store.data;
                throw err;
            })
            .finally(() => { store.inflight = null; });
    }
    return store.inflight;
};

/** Reload in the background while someone has used the tab recently; idle servers make no reads. */
const startTimer = () => {
    if (store.timer) return;
    store.timer = setInterval(() => {
        if (Date.now() - store.lastAsked < ACTIVE_MS) refresh().catch(() => {});
    }, REFRESH_MS);
    if (store.timer.unref) store.timer.unref();
};

/** Called once after the server starts listening. */
const warm = () => { startTimer(); return refresh(); };

/** Seat keys a user may see, or null for statewide. Same match as constituencyFilter: whole name, any case. */
const seatsOf = (scope) => (!scope || scope.canSeeAll ? null : new Set([...(scope.constituencies || [])].map((c) => String(c).toLowerCase())));

/**
 * The tab's data for one window and one user's scope. Served from memory;
 * waits for the database only on a cold start or when the copy is very old.
 */
const overview = async ({ days, scope }) => {
    store.lastAsked = Date.now();
    startTimer();
    const age = Date.now() - store.loadedAt;
    if (!store.data || age > MAX_STALE_MS) await refresh();
    else if (age > REFRESH_MS) refresh().catch(() => {});

    const seats = seatsOf(scope);
    const key = `${store.loadedAt}:${days}:${seats ? [...seats].sort().join(',') : 'all'}`;
    if (!store.results.has(key)) {
        const { items, events, eventPosts } = store.data;
        const mine = seats ? items.filter((i) => i.seat && seats.has(String(i.seat).toLowerCase())) : items;
        const result = summariseItems({
            items: mine,
            // Events are set up statewide and their posts are not tied to a seat: statewide users only.
            events: seats ? [] : events.filter((e) => !e.start_date || new Date(e.start_date) <= new Date()),
            eventPosts: seats ? [] : eventPosts,
            from: new Date(Date.now() - days * DAY),
            days,
        });
        result.as_of = new Date(store.loadedAt).toISOString();
        if (store.results.size > 200) store.results.clear();
        store.results.set(key, result);
    }
    return store.results.get(key);
};

module.exports = { overview, warm, summarise, VOICES, CHANNELS, WINDOWS, MIN_TREND };
