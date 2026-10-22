/**
 * test_social_channels.js
 * ─────────────────────────────────────────────────────────────────────
 * Social & Channels (Intelligence Brief, second tab): channels, party
 * sentiment, topics, platforms and response strategy, computed from
 * hand-made posts whose answers are known. No database.
 *
 *   node scripts/test_social_channels.js
 */
let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`PASS  ${name}`); }
    else { fail += 1; console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

const { summarise } = require('../src/services/socialChannelsService');
const { offlineChannelOf } = require('../src/services/outreachChannels');

console.log('\n── rallies and outreach are recognised, look-alikes are not ──');
const ch = (t) => offlineChannelOf(t);
ok('Telugu public meeting → rally', ch('గోదావరిఖనిలో సింగరేణి కార్మిక గర్జన బహిరంగ సభలో కేటీఆర్') === 'rally');
ok('English rally → rally', ch('Telangana Congress leads Save Democracy rally in Hyderabad') === 'rally');
ok('Hindi padayatra → rally', ch('कांग्रेस नेता का पैदल मार्च') === 'rally');
ok('"chalo <place>" → rally', ch('ఛలో సిరిసిల్ల 30 సెప్టెంబర్') === 'rally');
ok('శాసనసభ (the assembly) is not a rally', ch('శాసనసభ సమావేశాలు రేపటి నుంచి') === null);
ok('Ayyappa deeksha is not a rally', ch('అయ్యప్ప దీక్ష స్వీకరించిన భక్తులు') === null);
ok('meeting workers and asking their problems → outreach', ch('పారిశుధ్య కార్మికులతో కలిసి వారి సమస్యలను అడిగి తెలుసుకున్న హరీశ్ రావు') === 'outreach');
ok('janata darbar → outreach', ch('ఈరోజు జనతా దర్బార్ కు విచ్చేసిన ప్రజలను కలిసి') === 'outreach');
ok('"interaction with youth" → outreach', ch('began the day with an interaction with youth from Siddipet') === 'outreach');
ok('ప్రజా పాలన (government slogan) is not outreach', ch('ఇదేనా ప్రజాపాలన? రైతులు తల్లడిల్లుతున్నారు') === null);
ok('tap water to every home is not outreach', ch('ఇంటింటికి నల్లా నీళ్లు ఇవ్వాలి') === null);
ok('door-to-door waste collection is not outreach', ch('door-to-door waste collection vehicles') === null);

const DAY = 86400000;
const now = Date.now();
const from = new Date(now - 30 * DAY);
const cur = new Date(now - 2 * DAY);
const old = new Date(now - 40 * DAY);

let n = 0;
const post = ({ topic = 'Water Supply', stance = 'neutral', platform = 'x', handle = null, name = 'A citizen', text = 'post', target = null, date = cur, likes = 0 }) => {
    n += 1;
    return {
        post_date: date, platform, tweet_url: `https://x.com/p/${n}`, engagement: { likes },
        posted_by: { handle: handle || `citizen${n}`, display_name: name }, content: { text },
        analysis: { topic, political_stance: stance, target },
    };
};
const times = (k, make) => Array.from({ length: k }, () => make());

const mentions = [
    // Water: the public criticises BRS 6 times, praises it twice.
    ...times(6, () => post({ topic: 'Water Supply', stance: 'anti_target', text: 'BRS failed on water' })),
    ...times(2, () => post({ topic: 'Water Supply', stance: 'pro_target', text: 'BRS did well on water' })),
    // Jobs: 4 attacks on BRS, all from a registered rival account on Facebook.
    ...times(4, () => post({ topic: 'Employment & Jobs', stance: 'anti_target', platform: 'facebook', handle: 'IYCTelangana', name: 'Youth Congress Telangana' })),
    // Roads: the public criticises the government at a dharna (no party named; aimed at the state government).
    ...times(5, () => post({ topic: 'Roads & Transport', stance: 'pro_target_indirect', text: 'farmers dharna at collectorate, government sleeping', target: 'state_government' })),
    // BJP praised once, in Telugu, at a public meeting.
    post({ topic: 'Elections & Politics', stance: 'anti_target_indirect', text: 'బీజేపీ బహిరంగ సభ బాగా జరిగింది' }),
    // Outreach: Harish Rao meets workers — praised.
    ...times(3, () => post({ topic: 'Health Services', stance: 'pro_target', platform: 'youtube', text: 'కార్మికులతో కలిసి వారి సమస్యలను అడిగి తెలుసుకున్న హరీశ్ రావు' })),
    // Congress's own account praising itself: volume yes, sentiment no.
    ...times(4, () => post({ topic: 'Water Supply', stance: 'anti_target_indirect', handle: 'INCTelangana', name: 'INC Telangana' })),
    // BRS's own account.
    ...times(10, () => post({ topic: 'Water Supply', stance: 'pro_target', handle: 'BRSparty', name: 'BRS Party' })),
    // Previous window: 3 attacks on water.
    ...times(3, () => post({ topic: 'Water Supply', stance: 'anti_target', date: old })),
];
const articles = [
    { published_date: cur, title: 'Govt under fire on roads', source_url: 'https://news/1', source_name: 'Paper', campaign_topic: 'Roads & Transport', political_stance: 'pro_target_indirect' },
];
const events = [{ id: 'ev1', name: 'Rythu Deeksha rally', status: 'active', start_date: cur, end_date: cur }];
const eventPosts = [
    { event_ids: ['ev1'], platform: 'youtube', sentiment: 'positive' },
    { event_ids: ['ev1'], platform: 'x', sentiment: 'moderate' },
    { event_ids: ['other'], platform: 'x', sentiment: 'negative' },
];

const out = summarise({ mentions, articles, events, eventPosts, from, days: 30 });

console.log('\n── totals: sentiment towards BRS and towards the opposition, public and press only ──');
ok('posts and articles counted separately', out.totals.posts === 35 && out.totals.articles === 1, JSON.stringify(out.totals));
ok('towards BRS: 5 positive · 6 negative — party accounts left out', out.totals.brs.positive === 5 && out.totals.brs.negative === 6, JSON.stringify(out.totals.brs));
ok('towards opposition: 1 positive · 6 negative — INC praising itself left out', out.totals.opposition.positive === 1 && out.totals.opposition.negative === 6, JSON.stringify(out.totals.opposition));

console.log('\n── the three channels ──');
const chan = (id) => out.channels.find((c) => c.id === id);
ok('digital platforms: every post and article', chan('digital').posts === 36);
ok('rallies: the dharna posts and the BJP public meeting', chan('rally').posts === 6 && chan('rally').opposition.negative === 5 && chan('rally').opposition.positive === 1, JSON.stringify(chan('rally')));
ok('community outreach: the 3 posts about meeting workers, positive towards BRS', chan('outreach').posts === 3 && chan('outreach').brs.positive === 3 && chan('outreach').top_platform === 'youtube');
ok('rally and outreach cards carry example posts, each text once', chan('rally').examples.length === 2 && chan('outreach').examples.length === 1 && chan('outreach').examples[0].url);

console.log('\n── party vs opposition ──');
const party = (p) => out.parties.find((x) => x.party === p);
ok('BRS: public only', party('BRS').positive === 5 && party('BRS').negative === 6, JSON.stringify(party('BRS')));
ok('BRS is attacked for water', party('BRS').attacked_for[0] === 'Water Supply');
ok('"the government" with no party named counts against INC', party('INC').negative === 5 && party('INC').attacked_for[0] === 'Roads & Transport', JSON.stringify(party('INC')));
ok('BJP praised in Telugu', party('BJP').positive === 1);

console.log('\n── top topics: sentiment towards each side, platform, volume, source type ──');
const topic = (t) => out.topics.find((x) => x.topic === t);
ok('volume counts everyone (incl. party accounts)', topic('Water Supply').posts === 22, JSON.stringify(topic('Water Supply')));
ok('topic sentiment towards BRS: public only', topic('Water Supply').brs.positive === 2 && topic('Water Supply').brs.negative === 6 && topic('Water Supply').brs.net === -50);
ok('topic sentiment towards opposition', topic('Roads & Transport').opposition.negative === 6 && topic('Roads & Transport').opposition.net === -100);
ok('main source type of a topic', topic('Water Supply').top_source === 'owned' && topic('Employment & Jobs').top_source === 'opposition' && topic('Employment & Jobs').top_source_label === 'Rival party & government accounts');
ok('main platform of a topic', topic('Employment & Jobs').top_platform === 'facebook');
ok('no change claimed on a small sample', topic('Water Supply').share_change === null && topic('Water Supply').prev_share_pct === null);
ok('share of the conversation', topic('Water Supply').share_pct === 61.1, String(topic('Water Supply').share_pct));

console.log('\n── platforms and source types ──');
const plat = (p) => out.platforms.find((x) => x.platform === p);
ok('volume by platform, news websites included', plat('x').posts === 28 && plat('facebook').posts === 4 && plat('youtube').posts === 3 && plat('news').posts === 1);
const src = (v) => out.source_types.find((x) => x.voice === v);
ok('source types counted', src('organic').posts === 17 && src('opposition').posts === 8 && src('owned').posts === 10 && src('news').posts === 1);
ok('a source type\'s own sentiment: rival accounts attack BRS and praise the opposition', src('opposition').brs.negative === 4 && src('opposition').opposition.positive === 4);
ok('tracked events: only their own posts, "moderate" read as neutral', out.events[0].posts === 2 && out.events[0].positive === 1 && out.events[0].neutral === 1);

console.log('\n── response strategy ──');
const c = (t) => out.strategy.counter.find((x) => x.topic === t);
ok('counter: topics ranked by criticism of BRS', out.strategy.counter[0].topic === 'Water Supply' && c('Water Supply').criticism === 6);
ok('public-driven → Respond on X', c('Water Supply').action.type === 'Respond' && /on X/.test(c('Water Supply').action.text));
ok('rival-driven → Rebut on Facebook', c('Employment & Jobs').action.type === 'Rebut' && c('Employment & Jobs').driven_by_pct === 100 && /Facebook/.test(c('Employment & Jobs').action.text));
ok('amplify: the government is already criticised on roads', out.strategy.amplify[0].topic === 'Roads & Transport' && out.strategy.amplify[0].posts === 6);
const where = (id) => out.strategy.where.find((w) => w.id === id);
ok('where: X is more critical than positive about BRS → respond there first', where('x').tone === 'negative');
ok('where: too little about BRS at rallies to judge', where('rally').tone === 'quiet');

console.log('\n── growth in collection is not "rising" ──');
// Previous window: 25 of 100 posts criticise BRS on water. Now: 50 of 200 — twice the posts, same share.
const grow = [
    ...times(25, () => post({ topic: 'Water Supply', stance: 'anti_target', date: old })),
    ...times(75, () => post({ topic: 'Education', stance: 'neutral', date: old })),
    ...times(50, () => post({ topic: 'Water Supply', stance: 'anti_target', text: 'same complaint' })),
    ...times(150, () => post({ topic: 'Education', stance: 'neutral' })),
];
const g = summarise({ mentions: grow, from, days: 30 });
const gw = g.topics.find((t) => t.topic === 'Water Supply');
ok('twice the posts at the same share → no change', gw.share_change === 0 && gw.share_pct === 25, JSON.stringify({ s: gw.share_pct, p: gw.prev_share_pct, c: gw.share_change }));
ok('twice the criticism at the same share → not rising', g.strategy.counter[0].rising === false);
ok('the same post collected many times is shown once', g.strategy.counter[0].examples.length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
