/**
 * outreachChannels — which posts are about a RALLY or about COMMUNITY OUTREACH.
 *
 * Client requirement 2 asks for sentiment "in digital platforms, rallies, or
 * community outreach". Rallies and outreach happen offline; what reaches this
 * platform is the posts and reports about them. Those are recognised here by
 * the words people use for them, in English, Telugu and Hindi.
 *
 * Events monitoring (Content.event_ids) only covers events someone has set up
 * by hand, and on the live data none had been, so the posts themselves are the
 * reliable source.
 *
 * Every phrase was checked against a month of live posts. Left out on purpose,
 * because they matched the wrong things:
 *   సభ alone             also శాసనసభ (the legislative assembly)
 *   దీక్ష alone          also religious vows (Ayyappa deeksha)
 *   ప్రజా పాలన / PrajaPalana   the Congress government's slogan, not an outreach event
 *   ఇంటింటికి alone      "tap water to every home", a scheme, not a visit
 *   door-to-door alone   "door-to-door waste collection"
 */

/** Whole word in any script (JS \b only understands ASCII). */
const word = (alternatives) => `(?<![\\p{L}\\p{M}])(?:${alternatives})(?![\\p{L}\\p{M}])`;

const RALLY_RX = new RegExp([
    word('rally|rallies|bahiranga sabha|jana sabha|padayatra|pada yatra|dharna|maha ?dharna|rasta roko|road ?show|chalo [a-z]+|protest march|bike rally|torch rally|candle rally|garjana sabha'),
    word('public meeting'),
    'బహిరంగ ?సభ', 'జన ?సభ', 'గర్జన ?సభ', 'ర్యాలీ', 'పాదయాత్ర', 'మహా ?ధర్నా', 'ధర్నా', 'రాస్తారోకో', 'రోడ్ ?షో',
    'ఛలో ', 'చలో ', 'నిరసన ప్రదర్శన', 'నిరసన దీక్ష', 'నిరాహార దీక్ష',
    'रैली', 'जनसभा', 'पदयात्रा', 'पैदल मार्च', 'धरना', 'रोड ?शो',
].join('|'), 'iu');

const OUTREACH_RX = new RegExp([
    word('door[- ]to[- ]door (?:campaign\\w*|canvass\\w*|visits?|outreach)|village visits?|praja ?darbar|janata ?darbar|grama ?sabha|rachabanda|palle ?nidra|basti ?bata|grievance camp|outreach (?:programme|program|drive|camp)'),
    word('(?:interacted|interacting|interaction) with (?:farmers|villagers|residents|people|locals|youth|students|women|workers)'),
    word('met (?:farmers|villagers|residents|locals|families)'),
    'ఇంటింటి ప్రచారం', 'ఇంటింటా ప్రచారం', 'గ్రామ ?సభ', 'ప్రజా ?దర్బార్', 'జనతా ?దర్బార్', 'రచ్చబండ', 'పల్లె ?నిద్ర', 'బస్తీ ?బాట',
    'ముఖాముఖి', 'సమస్యలను? అడిగి తెలుసుకు',
    'घर-घर (?:अभियान|संपर्क|जाकर)', 'जनता दरबार', 'जन संवाद',
].join('|'), 'iu');

/** 'rally', 'outreach', or null. A post about both counts as a rally (the larger, public event). */
const offlineChannelOf = (text) => {
    const t = String(text || '');
    if (!t) return null;
    if (RALLY_RX.test(t)) return 'rally';
    if (OUTREACH_RX.test(t)) return 'outreach';
    return null;
};

module.exports = { RALLY_RX, OUTREACH_RX, offlineChannelOf };
