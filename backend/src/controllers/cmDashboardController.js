/**
 * cmDashboardController — the Chief Minister's command screen.
 * ─────────────────────────────────────────────────────────────────────
 * GET /api/dashboard/cm-brief?days=30
 *
 * ONE call that reduces every module of the platform to its outcome, then
 * does the thing no single module can do alone: cross-reads them.
 *
 * ── The sources, and what each is actually good for ──────────────────
 * Measured on live data before this was written:
 *
 *   grievances    2,382   public stance + issue topic. District on only 33%.
 *   newsarticles  1,707   press tone, outlet, category — and a district on
 *                         82% of rows. Geography therefore comes from NEWS,
 *                         not social, which is the opposite of the obvious
 *                         design.
 *   alerts          280   threat intent, legal sections, platform policies.
 *   contents        740   what our own tracked accounts published.
 *   comments        746   sentiment is NOT running on these (746/746 neutral,
 *                         zero threats) — reported as unconfigured rather
 *                         than charted as "all calm".
 *
 * ── The corrections that make the numbers honest ─────────────────────
 * 1. OWN PUBLISHING IS NOT SENTIMENT. Top posting accounts include
 *    TelanganaCMO and the district handles, the bulk of it
 *    pro-government. Mentions are classified by voice; headline figures use
 *    ORGANIC only.
 * 2. SMALL SAMPLES GET NO TRENDS. A topic needs volume in BOTH windows
 *    before a change is claimed.
 * 3. UNUSED WORKFLOWS ARE REPORTED AS UNUSED, not presented as a backlog.
 */

const mongoose = require('mongoose');
const SOURCES_LIST = require('../data/sources_list.json');
const HANDLE_REGISTRY = require('../data/state_leader_handles.json');
const ADVERSARY_REGISTRY = require('../data/state_adversary_handles.json');
const {
  OUR_PARTY, OPPOSITION_PARTIES, OUR_FRONTBENCH, PARTY_CHIEF, OPPOSITION_LEADERS,
} = require('../config/politicalData');
const { adviseAll } = require('../services/recommendationAdviceService');
const { normalizeStance } = require('../services/stanceVocabulary');

/* ── voice classification ─────────────────────────────────────────────── */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const OUR_PARTY_CODE = String(OUR_PARTY?.id || 'bjp').toLowerCase();

const buildVoiceSets = () => {
  const owned = new Set(); const opposition = new Set(); const news = new Set();
  const addAll = (entries, set) => {
    for (const e of entries || []) if (e && e.handle) set.add(norm(e.handle));
  };
  for (const [party, entries] of Object.entries(HANDLE_REGISTRY.parties || {})) {
    addAll(entries, party.toLowerCase() === OUR_PARTY_CODE ? owned : opposition);
  }
  /**
   * ⚠ GOVERNMENT ACCOUNTS ARE THE RIVAL'S HERE, NOT OURS.
   *
   * Ruling-party deployments added these to `owned`, because the CMO and the
   * public-relations directorate were the client's own channels. BRS is in
   * opposition: @TelanganaCMO belongs to the Congress administration it
   * exists to attack. Left on the `owned` side, every government press post
   * would count as our own publicity — and, worse, the headline sentiment
   * figures deliberately EXCLUDE owned voice, so the rival's entire output
   * would vanish from the opposition column instead of being measured.
   */
  for (const entries of Object.values(HANDLE_REGISTRY.government || {})) {
    addAll(Array.isArray(entries) ? entries : [entries], opposition);
  }
  /**
   * The accounts politicalData already records against each leader and party.
   * Without these, a post from the party president's own handle counts as
   * public opinion and inflates the supportive figure with our own publicity.
   * STATE_MACHINERY_RX below is only a fallback for accounts whose NAME ends
   * in cmo/dpr/govt — it does not catch a personal handle.
   */
  const addHandles = (list, set) => {
    for (const h of list || []) {
      const k = norm(h);
      if (k) set.add(k);
    }
  };
  addHandles(OUR_PARTY?.handles, owned);
  for (const l of OUR_FRONTBENCH || []) addHandles(l.handles, owned);
  for (const p of OPPOSITION_PARTIES || []) addHandles(p.handles, opposition);
  for (const l of OPPOSITION_LEADERS || []) addHandles(l.handles, opposition);
  /**
   * The rival CAMPAIGN APPARATUS, which the registries above do not reach.
   *
   * state_leader_handles.json answers "who is this account?" and holds one
   * handle per party. It has no row for the Youth Congress account, the TPCC
   * social-media chairman, or a minister's personal handle — so all of that
   * fell through to `organic` and was counted as spontaneous public opinion.
   *
   * That is the most expensive mistake available to an opposition
   * deployment. @IYCTelangana alone has posted 175k times to 54k followers;
   * read as organic, the rival's posting schedule becomes our sentiment
   * trend, and a quiet week for them looks like a swing towards us.
   */
  for (const a of ADVERSARY_REGISTRY.adversaries || []) {
    if (a && a.handle) opposition.add(norm(a.handle));
  }
  for (const s of SOURCES_LIST || []) {
    if (String(s.category || '').toLowerCase() !== 'news') continue;
    const last = String(s.identifier || '').replace(/\/+$/, '').split('/').pop();
    if (last) news.add(norm(last));
    if (s.display_name) news.add(norm(s.display_name));
  }
  return { owned, opposition, news };
};
const VOICE = buildVoiceSets();
/**
 * Accounts whose NAME marks them as official state machinery — district
 * administrations, collectorates, the CMO, NIC-run handles.
 *
 * ⚠ These resolve to OPPOSITION in this deployment, not `owned`. They are the
 * Congress administration's channels. The only thing that matters for the
 * headline figures is that they are not mistaken for ORGANIC public opinion:
 * a collectorate's press post is institutional output either way.
 */
const STATE_MACHINERY_RX = /(dist|collector|dpr|cmo|govt|government|nic)$/i;

const classifyVoice = (handle, displayName) => {
  const h = norm(handle); const d = norm(displayName);
  if (VOICE.owned.has(h) || VOICE.owned.has(d)) return 'owned';
  if (VOICE.opposition.has(h) || VOICE.opposition.has(d)) return 'opposition';
  if (VOICE.news.has(h) || VOICE.news.has(d)) return 'news';
  if (STATE_MACHINERY_RX.test(String(handle || ''))) return 'opposition';
  return 'organic';
};

/* ── stance / sentiment helpers ───────────────────────────────────────── */
/**
 * Which side of the CLIENT (BRS) a stance is on. Reads every vocabulary through
 * stanceVocabulary (legacy pro_bsk / pro_client rows included — they used to fall
 * through to 'unrelated' here). `mixed` takes no side, so it joins neutral and stays
 * out of every net-score denominator.
 */
const sideOf = (s) => {
  const n = normalizeStance(s);
  if (n.startsWith('pro_')) return 'pro';
  if (n.startsWith('anti_')) return 'anti';
  return n === 'neutral' || n === 'mixed' ? 'neutral' : 'unrelated';
};
const engagementOf = (e) => (e?.likes || 0) + (e?.retweets || 0) + (e?.replies || 0) + (e?.quotes || 0);
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * −100..+100, computed over the people who TOOK A SIDE.
 *
 * Neutral and unrelated are excluded from the denominator: the brief reports
 * support against opposition, so a swing in the neutral pile must not move the
 * figure. Call sites still pass a third argument; it is deliberately ignored.
 */
const netScore = (pro, anti) => {
  const base = pro + anti;
  return base ? Math.round(((pro - anti) / base) * 100) : null;
};

const MIN_CONFIDENT = 40;
const ENGAGEMENT_FLOOR = 10;

const getCMBrief = async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));
    const now = new Date();
    const from = new Date(now - days * 86400000);
    const prevFrom = new Date(now - days * 2 * 86400000);

    const [mentions, articles, alerts] = await Promise.all([
      db.collection('grievances').find(
        { post_date: { $gte: prevFrom }, is_active: { $ne: false } },
        { projection: {
          post_date: 1, platform: 1, tweet_url: 1, engagement: 1, workflow_status: 1,
          'posted_by.handle': 1, 'posted_by.display_name': 1, 'content.text': 1,
          'analysis.topic': 1, 'analysis.political_stance': 1,
          'analysis.mentioned_entities': 1, 'detected_location.district': 1,
        } }
      ).toArray(),
      db.collection('newsarticles').find(
        { published_date: { $gte: prevFrom } },
        { projection: {
          published_date: 1, sentiment: 1, category: 1, language: 1,
          // The client-relative verdict. `sentiment` above is RAW tone and
          // defaults to 'neutral', so it cannot be used for stance.
          political_stance: 1, target_sentiment: 1, pipeline_analyzed_at: 1,
          source_name: 1, title: 1, title_english: 1, source_url: 1,
          'detected_location.district': 1,
        } }
      ).toArray(),
      db.collection('alerts').find(
        { created_at: { $gte: from } },
        { projection: {
          created_at: 1, alert_type: 1, risk_level: 1, status: 1, title: 1,
          'threat_details.intent': 1, legal_sections: 1, violated_policies: 1,
          // Needed to split `neutral` out of `low` — see ALERT_NEUTRAL below.
          'llm_analysis.target_sentiment': 1, 'llm_analysis.bsk_sentiment': 1,
          // The alert's position toward the government, same vocabulary as
          // mentions and articles.
          'llm_analysis.political_stance': 1,
        } }
      ).toArray(),
    ]);

    const curM = []; const prevM = [];
    for (const d of mentions) {
      d._voice = classifyVoice(d.posted_by?.handle, d.posted_by?.display_name);
      (new Date(d.post_date) >= from ? curM : prevM).push(d);
    }
    const curN = articles.filter((a) => new Date(a.published_date) >= from);
    const prevN = articles.filter((a) => new Date(a.published_date) < from);

    const voice = { owned: 0, news: 0, opposition: 0, organic: 0 };
    for (const d of curM) voice[d._voice] += 1;
    const organic = curM.filter((d) => d._voice === 'organic');
    const prevOrganic = prevM.filter((d) => d._voice === 'organic');

    /* ── headline: what the public says vs what the press prints ───────── */
    const tally = (list) => {
      const t = { pro: 0, anti: 0, neutral: 0 };
      for (const d of list) { const s = sideOf(d.analysis?.political_stance); if (s !== 'unrelated') t[s] += 1; }
      return t;
    };
    /**
     * An article's stance toward the government. Returns null when the article
     * has not been scored — those must NOT fall into 'neutral', which is what
     * reading the raw `sentiment` default did.
     */
    const articleStance = (a) => {
      const st = a.political_stance;
      if (!st) return null;              // not scored by rssAnalysisService yet
      const side = sideOf(st);           // pro | anti | neutral | unrelated
      return side === 'unrelated' ? 'unrelated' : side;
    };
    const articleScored = (a) => {
      const side = articleStance(a);
      return side !== null && side !== 'unrelated';
    };

    const pressTally = (list) => {
      const t = { positive: 0, negative: 0, neutral: 0 };
      for (const a of list) {
        const side = articleStance(a);
        if (side === 'pro') t.positive += 1;
        else if (side === 'anti') t.negative += 1;
        else if (side === 'neutral') t.neutral += 1;
        // null (unscored) and 'unrelated' are counted in neither.
      }
      return t;
    };
    const pub = tally(organic); const prevPub = tally(prevOrganic);
    // `tally` drops unrelated; count them so a row can add up to what was read.
    const pubUnrelated = organic.filter(
      (d) => sideOf(d.analysis?.political_stance) === 'unrelated',
    ).length;
    const press = pressTally(curN); const prevPress = pressTally(prevN);
    const publicNet = netScore(pub.pro, pub.anti, pub.neutral);
    const pressNet = netScore(press.positive, press.negative, press.neutral);

    const headline = {
      public_net: publicNet,
      public_prev: netScore(prevPub.pro, prevPub.anti, prevPub.neutral),
      press_net: pressNet,
      press_prev: netScore(prevPress.positive, prevPress.negative, prevPress.neutral),
      // The gap is the finding: press warmer than the public means the message
      // is landing in newsrooms but not on the street; the reverse means
      // coverage is lagging a shift that has already happened.
      divergence: publicNet !== null && pressNet !== null ? pressNet - publicNet : null,
      total_signals: curM.length + curN.length + alerts.length,
    };

    /* ── issues ────────────────────────────────────────────────────────── */
    const blank = () => ({ pro: 0, anti: 0, neutral: 0, unrelated: 0 });
    const rollTopics = (list) => {
      const map = new Map();
      for (const d of list) {
        const t = d.analysis?.topic;
        if (!t || t === 'None') continue;
        if (!map.has(t)) map.set(t, blank());
        map.get(t)[sideOf(d.analysis?.political_stance)] += 1;
      }
      return map;
    };
    const curTopics = rollTopics(organic);
    const prevTopics = rollTopics(prevOrganic);
    const oppByTopic = new Map();
    for (const d of curM) {
      const t = d.analysis?.topic;
      if (!t || t === 'None') continue;
      if (!oppByTopic.has(t)) oppByTopic.set(t, { opp: 0, own: 0 });
      if (d._voice === 'opposition') oppByTopic.get(t).opp += 1;
      if (d._voice === 'owned') oppByTopic.get(t).own += 1;
    }

    const issues = [];
    for (const [topic, o] of curTopics.entries()) {
      const p = prevTopics.get(topic) || blank();
      const total = o.pro + o.anti + o.neutral + o.unrelated;
      const prevTotal = p.pro + p.anti + p.neutral + p.unrelated;
      const net = netScore(o.pro, o.anti, o.neutral);
      const prevNet = netScore(p.pro, p.anti, p.neutral);
      const sov = oppByTopic.get(topic) || { opp: 0, own: 0 };
      issues.push({
        topic, total, pro: o.pro, anti: o.anti, neutral: o.neutral,
        net, prev_net: prevNet,
        delta: net !== null && prevNet !== null ? net - prevNet : null,
        delta_confident: total >= MIN_CONFIDENT && prevTotal >= MIN_CONFIDENT,
        confident: total >= MIN_CONFIDENT,
        opposition_posts: sov.opp, our_posts: sov.own,
      });
    }
    issues.sort((a, b) => (a.net ?? 999) - (b.net ?? 999));

    /* ── narrative: the press, by outlet and category ──────────────────── */
    const group = (list, keyFn, labelKey) => {
      const m = new Map();
      for (const a of list) {
        if (!articleScored(a)) continue;
        const k = keyFn(a) || 'Unknown';
        if (!m.has(k)) m.set(k, { [labelKey]: k, n: 0, positive: 0, negative: 0, neutral: 0 });
        const r = m.get(k); r.n += 1;
        const side = articleStance(a);
        if (side === 'pro') r.positive += 1;
        else if (side === 'anti') r.negative += 1;
        else if (side === 'neutral') r.neutral += 1;
      }
      return [...m.values()].map((r) => ({ ...r, net: netScore(r.positive, r.negative, r.neutral) }));
    };
    const outlets = group(curN, (a) => a.source_name, 'outlet')
      .filter((o) => o.n >= 5).sort((a, b) => (a.net ?? 999) - (b.net ?? 999)).slice(0, 8);
    const categories = group(curN, (a) => a.category, 'category').sort((a, b) => b.n - a.n);

    /* ── geography: news-led (82% district coverage vs 33% on social) ──── */
    const geo = new Map();
    const touch = (d) => {
      if (!geo.has(d)) {
        geo.set(d, {
          district: d, news: 0, news_scored: 0, news_negative: 0,
          social: 0, social_scored: 0, social_anti: 0,
        });
      }
      return geo.get(d);
    };
    for (const a of curN) {
      const d = a.detected_location?.district; if (!d) continue;
      const r = touch(d); r.news += 1;
      // Adverse share is computed over SCORED articles only — an unscored row
      // is not evidence of calm.
      if (!articleScored(a)) continue;
      r.news_scored += 1;
      if (articleStance(a) === 'anti') r.news_negative += 1;
    }
    for (const d of organic) {
      const dist = d.detected_location?.district; if (!dist) continue;
      const r = touch(dist); r.social += 1;
      const side = sideOf(d.analysis?.political_stance);
      if (side === 'unrelated') continue;
      r.social_scored += 1;
      if (side === 'anti') r.social_anti += 1;
    }
    const districts = [...geo.values()]
      .map((r) => ({
        ...r,
        // Share of that district's signal that is adverse, across both channels.
        // Denominator is the CLASSIFIED signal, not everything collected.
        pressure: (r.news_scored + r.social_scored)
          ? Math.round(((r.news_negative + r.social_anti) / (r.news_scored + r.social_scored)) * 100) : 0,
      }))
      .filter((r) => r.news + r.social >= 5)
      .sort((a, b) => b.pressure - a.pressure || b.news_negative - a.news_negative)
      .slice(0, 10);

    /* ── threats: alerts reduced to what can be acted on ───────────────── */
    const intents = new Map();
    /**
     * The five levels the rest of the app shows. `neutral` is NOT stored on the
     * alert: risk follows sentiment (positive -> low, neutral -> low, negative
     * -> high), so `low` would otherwise count routine neutral chatter as
     * praise. Split exactly as apDashboardController.getAPAlertsSummary does.
     */
    const ALERT_NEUTRAL = new Set(['moderate', 'neutral']);
    const alertIsNeutral = (a) => ALERT_NEUTRAL.has(
      String(a.llm_analysis?.target_sentiment ?? a.llm_analysis?.bsk_sentiment ?? '')
        .toLowerCase(),
    );
    const byRisk = { critical: 0, high: 0, medium: 0, neutral: 0, low: 0 };
    // `hostile`, `legalReady`, `policyReady` and `highRisk` are CLIENT-facing: they count content
    // that is ADVERSE TO BRS (stance anti_*). They used to count every moderation-flagged or
    // negative-toned alert, so a sharp post attacking the Congress government — favourable to
    // BRS — was reported as a hostile post to file a complaint against. `flagged` /
    // `highTone` keep the unfiltered counts (content/tone), under names that say what they are.
    let hostile = 0; let legalReady = 0; let policyReady = 0; let highRisk = 0;
    let flagged = 0; let highTone = 0;
    for (const a of alerts) {
      const adverse = sideOf(a.llm_analysis?.political_stance) === 'anti';
      // The carve-out applies ONLY to `low`. apDashboardController line 651:
      //   if (r._id.neutral && level === 'low') summary.neutral += count;
      //   else summary[level] += count;
      // A high-risk alert whose sentiment reads neutral stays HIGH — it was
      // flagged for something other than stance, and moving it would drain the
      // negative band and overstate neutral.
      const level = String(a.risk_level || 'low').toLowerCase();
      const risk = (alertIsNeutral(a) && level === 'low') ? 'neutral' : level;
      if (byRisk[risk] !== undefined) byRisk[risk] += 1;
      const intent = String(a.threat_details?.intent || '').trim();
      if (intent && intent.toLowerCase() !== 'normal') {
        flagged += 1;
        if (adverse) {
          hostile += 1;
          intents.set(intent, (intents.get(intent) || 0) + 1);
        }
      }
      if (adverse && a.legal_sections?.length) legalReady += 1;
      if (adverse && a.violated_policies?.length) policyReady += 1;
      if (a.risk_level === 'high' || a.risk_level === 'critical') {
        highTone += 1;
        if (adverse) highRisk += 1;
      }
    }
    /**
     * Alerts by STANCE. Alert.js says alerts carry none, but every alert in the
     * live data does, so the split is measured rather than assumed. `unrelated`
     * is reported separately and never counted into the totals.
     */
    const alertStanceTally = { supportive: 0, neutral: 0, opposing: 0, unrelated: 0, unscored: 0 };
    for (const a of alerts) {
      const raw = a.llm_analysis?.political_stance;
      if (!raw) { alertStanceTally.unscored += 1; continue; }
      const side = sideOf(raw);
      if (side === 'pro') alertStanceTally.supportive += 1;
      else if (side === 'anti') alertStanceTally.opposing += 1;
      else if (side === 'neutral') alertStanceTally.neutral += 1;
      else alertStanceTally.unrelated += 1;
    }

    const threats = {
      total: alerts.length, hostile, high_risk: highRisk,
      // Unfiltered counts, for anyone who wants content/tone regardless of who it favours.
      flagged, high_tone: highTone,
      legal_ready: legalReady, policy_ready: policyReady,
      untriaged: alerts.filter((a) => a.status === 'active').length,
      by_risk: byRisk,
      by_intent: [...intents.entries()].map(([intent, n]) => ({ intent, n })).sort((a, b) => b.n - a.n),
    };

    /* ── leaders named in public conversation ──────────────────────────── */
    const leaderMap = new Map();
    for (const d of organic) {
      const ents = d.analysis?.mentioned_entities;
      if (!Array.isArray(ents)) continue;
      const side = sideOf(d.analysis?.political_stance);
      for (const e of ents) {
        const nm = typeof e === 'string' ? e : (e?.name || e?.canonical || e?.id);
        if (!nm) continue;
        if (!leaderMap.has(nm)) leaderMap.set(nm, { name: String(nm), n: 0, pro: 0, anti: 0 });
        const r = leaderMap.get(nm); r.n += 1;
        if (side === 'pro') r.pro += 1;
        if (side === 'anti') r.anti += 1;
      }
    }
    const leaders = [...leaderMap.values()].filter((l) => l.n >= 5)
      .sort((a, b) => b.anti - a.anti || b.n - a.n).slice(0, 8);

    /* ── timeline per topic (public only) ──────────────────────────────── */
    const timeline = {};
    for (const d of organic) {
      const t = d.analysis?.topic;
      if (!t || t === 'None') continue;
      const k = dayKey(d.post_date);
      timeline[t] = timeline[t] || {};
      timeline[t][k] = timeline[t][k] || { d: k, pro: 0, anti: 0, neutral: 0 };
      const s = sideOf(d.analysis?.political_stance);
      if (s !== 'unrelated') timeline[t][k][s] += 1;
    }
    for (const t of Object.keys(timeline)) {
      timeline[t] = Object.values(timeline[t]).sort((a, b) => a.d.localeCompare(b.d));
    }

    /* ── spreading (velocity: follower reach is unavailable on 94%) ────── */
    const vel = curM
      .filter((d) => sideOf(d.analysis?.political_stance) === 'anti')
      .map((d) => {
        const hours = Math.max(1, (now - new Date(d.post_date)) / 3600000);
        const eng = engagementOf(d.engagement);
        return { d, eng, vph: eng / hours };
      })
      .filter((x) => x.eng >= ENGAGEMENT_FLOOR);
    const medVph = vel.length
      ? vel.map((v) => v.vph).sort((a, b) => a - b)[Math.floor(vel.length / 2)] : 0;
    const spreading = vel.sort((a, b) => b.vph - a.vph).slice(0, 5).map((v) => ({
      text: String(v.d.content?.text || '').slice(0, 180),
      handle: v.d.posted_by?.handle || null,
      platform: v.d.platform,
      url: v.d.tweet_url || null,
      topic: v.d.analysis?.topic || null,
      engagement: v.eng,
      multiple: medVph ? Math.min(20, Math.round((v.vph / medVph) * 10) / 10) : null,
    }));

    /* ── module status: the outcome of every module, and what is dark ──── */
    const closedGrievances = curM.filter((d) => ['closed', 'action_taken'].includes(d.workflow_status)).length;
    const [evActive, campaigns, pois, commentCount, engagers, acCount] = await Promise.all([
      db.collection('events').countDocuments({ status: 'active' }),
      db.collection('campaign_suggestions').countDocuments({}),
      db.collection('pois').countDocuments({}),
      db.collection('comments').countDocuments({}),
      db.collection('engageranalyses').countDocuments({}),
      db.collection('constituencymasters').countDocuments({}),
    ]);

    const modules = [
      { key: 'mentions', label: 'Mentions', route: '/grievances', status: 'live',
        metric: curM.length.toLocaleString(), unit: 'in window',
        outcome: `${voice.organic.toLocaleString()} from the public · net ${publicNet ?? '—'}` },
      { key: 'news', label: 'News & Web', route: '/public-web-articles', status: 'live',
        metric: curN.length.toLocaleString(), unit: 'articles',
        outcome: `press net ${pressNet ?? '—'} · ${categories[0]?.category || '—'} leads coverage` },
      { key: 'alerts', label: 'Alerts', route: '/alerts',
        status: threats.total && threats.untriaged === threats.total ? 'attention' : 'live',
        metric: String(threats.hostile), unit: 'hostile',
        outcome: threats.total && threats.untriaged === threats.total
          ? `${threats.total} raised, none triaged` : `${threats.legal_ready} with a legal section` },
      { key: 'geo', label: 'Geographic Intel', route: '/geographic-intelligence', status: 'live',
        metric: String(districts.length), unit: 'districts under pressure',
        outcome: districts[0] ? `${districts[0].district} worst at ${districts[0].pressure}% adverse` : 'None above threshold' },
      { key: 'leaders', label: 'Leader Tracking', route: '/dashboard',
        status: leaders.length ? 'live' : 'idle',
        metric: String(leaders.length), unit: 'leaders in play',
        outcome: leaders[0] ? `${leaders[0].name} draws the most criticism` : 'None above threshold' },
      { key: 'events', label: 'Events', route: '/events', status: evActive ? 'live' : 'idle',
        metric: String(evActive), unit: 'active',
        outcome: evActive ? 'Tracking on own keywords' : 'No event tracked' },
      { key: 'campaigns', label: 'AI Campaigns', route: '/ai-suggestions',
        status: campaigns ? 'live' : 'idle',
        metric: String(campaigns), unit: 'drafted',
        outcome: campaigns ? 'Awaiting approval' : 'Nothing drafted' },
      { key: 'grievance_workflow', label: 'Grievance Resolution', route: '/grievances',
        status: closedGrievances ? 'live' : 'unused',
        metric: String(closedGrievances), unit: 'closed',
        outcome: closedGrievances ? 'Closure being recorded' : 'No case worked to closure' },
      { key: 'comments', label: 'Comment Analysis', route: '/content', status: 'unconfigured',
        metric: commentCount.toLocaleString(), unit: 'collected',
        outcome: 'Sentiment not running — every row scored neutral' },
      { key: 'poi', label: 'Profiles', route: '/person-of-interest', status: pois ? 'live' : 'idle',
        metric: String(pois), unit: 'tracked', outcome: pois ? 'Under watch' : 'None tracked' },
      { key: 'engagers', label: 'Amplifier Analysis', route: '/dashboard',
        status: engagers ? 'live' : 'idle',
        metric: String(engagers), unit: 'analysed', outcome: engagers ? 'Networks mapped' : 'Not run' },
      { key: 'constituency', label: 'Constituency Master', route: '/geographic-intelligence',
        status: 'live', metric: String(acCount), unit: 'seats', outcome: 'Reference data loaded' },
    ];

    /* ── daily sentiment trend (public voice only) ─────────────────────── */
    const trendMap = new Map();
    for (const d of organic) {
      const k = dayKey(d.post_date);
      if (!trendMap.has(k)) trendMap.set(k, { d: k, positive: 0, neutral: 0, negative: 0, total: 0 });
      const r = trendMap.get(k);
      const side = sideOf(d.analysis?.political_stance);
      if (side === 'pro') { r.positive += 1; r.total += 1; }
      else if (side === 'anti') { r.negative += 1; r.total += 1; }
      else if (side === 'neutral') { r.neutral += 1; r.total += 1; }
    }
    const trend = [...trendMap.values()].sort((a, b) => a.d.localeCompare(b.d));

    /* ── the latest of each stream, for the at-a-glance tables ─────────── */
    const STANCE_LABEL = {
      pro: 'Supportive', anti: 'Opposing', neutral: 'Neutral', unrelated: 'Unrelated',
    };
    const recentMentions = [...organic]
      .sort((a, b) => new Date(b.post_date) - new Date(a.post_date))
      .slice(0, 6)
      .map((d, i) => {
        const side = sideOf(d.analysis?.political_stance);
        return {
          ref: `PM-${String(i + 1).padStart(4, '0')}`,
          text: String(d.content?.text || '').replace(/\s+/g, ' ').slice(0, 300),
          handle: d.posted_by?.handle || null,
          topic: d.analysis?.topic && d.analysis.topic !== 'None' ? d.analysis.topic : 'Unclassified',
          district: d.detected_location?.district || null,
          stance: side,
          stance_label: STANCE_LABEL[side],
          platform: d.platform || null,
          date: d.post_date,
          url: d.tweet_url || null,
        };
      });

    /**
     * Coverage that actually took a side. An article rssAnalysisService has not
     * scored carries no stance at all, so listing it forced a "Not scored" badge
     * that told the reader nothing — and most of the newest rows are unscored,
     * which is why the list was almost entirely badges with no verdict.
     * Neutral and unrelated are left out for the same reason the rest of the
     * page leaves them out.
     */
    const recentNews = [...curN]
      .filter((a) => ['pro', 'anti'].includes(articleStance(a)))
      .sort((a, b) => new Date(b.published_date) - new Date(a.published_date))
      .slice(0, 5)
      .map((a) => ({
        title: String(a.title_english || a.title || 'Untitled').slice(0, 140),
        source: a.source_name || 'Unknown',
        stance: articleStance(a),
        category: a.category || null,
        date: a.published_date,
        url: a.source_url || null,
      }));

    /* Raw counts both windows, so the cards can show a real period-on-period
       change instead of a net score the reader has to decode. */
    const counts = {
      public: pub,
      prev_public: prevPub,
      press,
      prev_press: prevPress,
      mentions: curM.length,
      prev_mentions: prevM.length,
      articles: curN.length,
      prev_articles: prevN.length,
      public_total: pub.pro + pub.anti + pub.neutral,
      prev_public_total: prevPub.pro + prevPub.anti + prevPub.neutral,
      // Collection ramp-up is NOT growth. When the previous window holds far
      // less than this one, a percentage change is meaningless -- it reports
      // when monitoring started, not what the public did. The page shows
      // "baseline building" instead of a headline figure like +2164%.
      comparable: prevM.length >= 50 && prevM.length >= curM.length * 0.25,
      earliest_seen: mentions.length
        ? new Date(Math.min(...mentions.map((d) => new Date(d.post_date).getTime())))
        : null,
    };

    /* -- combined and per-source sentiment ------------------------------- */
    /**
     * Three streams reach this page and they are not interchangeable:
     *   mentions  stance of the public toward the government
     *   articles  tone of a published report
     *   alerts    adverse content severe enough to be flagged
     *
     * All three carry the SAME stance vocabulary, so the headline tiles sum
     * them. `unrelated` and unscored rows are excluded from every stream — they
     * are absence of a reading, not a neutral one.
     */
    const articlesUnrelated = curN.filter((a) => articleStance(a) === 'unrelated').length;

    const combined = {
      supportive: pub.pro + press.positive + alertStanceTally.supportive,
      neutral: pub.neutral + pubUnrelated
        + press.neutral + articlesUnrelated
        + alertStanceTally.neutral + alertStanceTally.unrelated,
      opposing: pub.anti + press.negative + alertStanceTally.opposing,
    };
    // The one total on the page. Neutral is counted but never shown: the brief
    // reports support against opposition, so the headline is those who took a
    // side.
    combined.total = combined.supportive + combined.opposing;
    combined.analysed = combined.supportive + combined.neutral + combined.opposing;
    combined.score = netScore(combined.supportive, combined.opposing, combined.neutral);

    const bySource = {
      mentions: {
        label: 'Social mentions',
        total: curM.length,
        // `unrelated` is neutral — utils/stanceFilter.js groups them, and the
        // pages filter on that grouping, so the brief must count it the same
        // way or a drill-down would not return what the figure counted.
        supportive: pub.pro,
        neutral: pub.neutral + pubUnrelated,
        opposing: pub.anti,
        analysed: pub.pro + pub.neutral + pubUnrelated + pub.anti,
        decisive: pub.pro + pub.anti,
        score: netScore(pub.pro, pub.anti, pub.neutral + pubUnrelated),
      },
      articles: {
        label: 'News articles',
        total: curN.length,
        supportive: press.positive,
        neutral: press.neutral + articlesUnrelated,
        opposing: press.negative,
        analysed: press.positive + press.neutral + articlesUnrelated + press.negative,
        decisive: press.positive + press.negative,
        score: netScore(press.positive, press.negative, press.neutral + articlesUnrelated),
      },
      alerts: {
        label: 'Alerts',
        total: alerts.length,
        // Stance, on the same scale as the other two streams.
        supportive: alertStanceTally.supportive,
        neutral: alertStanceTally.neutral + alertStanceTally.unrelated,
        opposing: alertStanceTally.opposing,
        analysed: alertStanceTally.supportive + alertStanceTally.neutral
          + alertStanceTally.unrelated + alertStanceTally.opposing,
        decisive: alertStanceTally.supportive + alertStanceTally.opposing,
        score: netScore(alertStanceTally.supportive, alertStanceTally.opposing,
          alertStanceTally.neutral + alertStanceTally.unrelated),
        // Severity is an operational fact, kept apart from the position taken.
        risk: {
          critical: byRisk.critical, high: byRisk.high, medium: byRisk.medium,
          neutral: byRisk.neutral, low: byRisk.low,
        },
        hostile,
        untriaged: threats.untriaged,
      },
    };

    /* -- is each issue moving for us or against us? ---------------------- */
    /**
     * The question this answers: "we did something about Corruption three
     * weeks ago -- did it work?" A single net score cannot answer that, so the
     * window is cut into equal buckets and the net is tracked across them.
     *
     * Each bucket also carries how many times OUR side and the OPPOSITION
     * posted on that topic, so a rise or fall in sentiment can be read next to
     * whether we were actually campaigning on it at the time.
     *
     * Movement is only reported when both halves of the window carry enough
     * mentions to support the comparison -- otherwise a topic that happened to
     * be quiet early on would look like a dramatic improvement.
     */
    /**
     * Bucket count follows the window, so the line has useful resolution at
     * every setting instead of six coarse blocks regardless of span:
     *   7 days  -> 7 buckets  (one per day)
     *   30 days -> 10 buckets (three days each)
     *   90 days -> 12 buckets (about a week each)
     */
    const BUCKETS = days <= 7 ? 7 : days <= 30 ? 10 : 12;
    const MIN_PER_HALF = 15;
    const bucketIndex = (date) => {
      const t = new Date(date).getTime();
      const span = now.getTime() - from.getTime();
      if (span <= 0) return 0;
      const i = Math.floor(((t - from.getTime()) / span) * BUCKETS);
      return Math.max(0, Math.min(BUCKETS - 1, i));
    };
    const emptyBuckets = () => Array.from({ length: BUCKETS }, (_, i) => {
      const span = now.getTime() - from.getTime();
      return {
        i,
        start: new Date(from.getTime() + (span * i) / BUCKETS),
        end: new Date(from.getTime() + (span * (i + 1)) / BUCKETS),
        pro: 0, anti: 0, neutral: 0, total: 0, net: null,
        our_posts: 0, opposition_posts: 0,
      };
    });

    const trackByTopic = new Map();
    const touchTrack = (topic) => {
      if (!trackByTopic.has(topic)) trackByTopic.set(topic, emptyBuckets());
      return trackByTopic.get(topic);
    };
    // public stance per bucket
    for (const d of organic) {
      const topic = d.analysis?.topic;
      if (!topic || topic === 'None') continue;
      const side = sideOf(d.analysis?.political_stance);
      if (side === 'unrelated') continue;
      const b = touchTrack(topic)[bucketIndex(d.post_date)];
      b[side] += 1;
      b.total += 1;
    }
    // who was campaigning on it, per bucket
    for (const d of curM) {
      const topic = d.analysis?.topic;
      if (!topic || topic === 'None') continue;
      if (d._voice !== 'owned' && d._voice !== 'opposition') continue;
      const b = touchTrack(topic)[bucketIndex(d.post_date)];
      if (d._voice === 'owned') b.our_posts += 1;
      else b.opposition_posts += 1;
    }

    const issueTracking = [];
    for (const [topic, buckets] of trackByTopic.entries()) {
      for (const b of buckets) b.net = netScore(b.pro, b.anti, b.neutral);

      const half = Math.floor(BUCKETS / 2);
      const sum = (arr) => arr.reduce((a, b) => ({
        pro: a.pro + b.pro, anti: a.anti + b.anti, neutral: a.neutral + b.neutral,
        total: a.total + b.total, our: a.our + b.our_posts, opp: a.opp + b.opposition_posts,
      }), { pro: 0, anti: 0, neutral: 0, total: 0, our: 0, opp: 0 });
      const early = sum(buckets.slice(0, half));
      const late = sum(buckets.slice(half));
      const earlyNet = netScore(early.pro, early.anti, early.neutral);
      const lateNet = netScore(late.pro, late.anti, late.neutral);

      const enough = early.total >= MIN_PER_HALF && late.total >= MIN_PER_HALF;
      const movement = (enough && earlyNet !== null && lateNet !== null)
        ? lateNet - earlyNet : null;

      let direction = 'unknown';
      if (movement !== null) {
        if (movement >= 10) direction = 'improving';
        else if (movement <= -10) direction = 'worsening';
        else direction = 'stable';
      }

      const total = buckets.reduce((a, b) => a + b.total, 0);
      issueTracking.push({
        topic,
        total,
        net: netScore(
          buckets.reduce((a, b) => a + b.pro, 0),
          buckets.reduce((a, b) => a + b.anti, 0),
          buckets.reduce((a, b) => a + b.neutral, 0),
        ),
        series: buckets.map((b) => ({
          start: b.start, end: b.end,
          pro: b.pro, anti: b.anti, neutral: b.neutral,
          total: b.total, net: b.net,
          our_posts: b.our_posts, opposition_posts: b.opposition_posts,
        })),
        early_net: earlyNet,
        late_net: lateNet,
        early_total: early.total,
        late_total: late.total,
        movement,
        direction,
        // Did we actually campaign on it in the later half, and did that
        // coincide with the movement? This is the PR-effectiveness read.
        our_posts_early: early.our,
        our_posts_late: late.our,
        opposition_posts_early: early.opp,
        opposition_posts_late: late.opp,
        we_stepped_up: late.our > early.our,
        confident: total >= MIN_CONFIDENT,
      });
    }
    issueTracking.sort((a, b) => {
      // worsening first, then by volume -- what needs attention leads
      const rank = (x) => (x.direction === 'worsening' ? 0 : x.direction === 'stable' ? 1
        : x.direction === 'improving' ? 2 : 3);
      return rank(a) - rank(b) || b.total - a.total;
    });

    /* -- the Chief Minister, his ministers, and the party by name -------- */
    /**
     * A leader is counted when a mention NAMES them (analysis.mentioned_entities
     * resolved through that leader's own aliases). The stance carried by the
     * mention is attributed to them. Public voice only, so our own press
     * releases cannot inflate anybody's standing.
     */
    const nameNorm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const buildLeaderIndex = (list) => {
      const m = new Map();
      for (const l of list || []) {
        for (const key of [l.name, l.shortName, ...(l.aliases || [])]) {
          const k = nameNorm(key);
          if (k) m.set(k, l);
        }
      }
      return m;
    };
    const OUR_INDEX = buildLeaderIndex(OUR_FRONTBENCH);
    const OPP_INDEX = buildLeaderIndex(OPPOSITION_LEADERS);

    const entityNames = (d) => {
      const ents = d.analysis?.mentioned_entities;
      if (!Array.isArray(ents)) return [];
      return ents
        .map((e) => (typeof e === 'string' ? e : (e?.name || e?.canonical || e?.id)))
        .filter(Boolean);
    };

    const blankLeader = (l, rival = false) => ({
      rival,
      id: l.id,
      name: l.name,
      role: l.role || null,
      constituency: l.constituency || null,
      portfolios: l.portfolios || [],
      party: l.party || null,
      mentions: 0, pro: 0, anti: 0, neutral: 0,
      topics: new Map(), quotes: [],
    });

    // `pro` / `anti` are always CLIENT-relative (does the post help or hurt BRS?). For a RIVAL
    // leader that is the reverse of the leader's own standing — a post that criticises Revanth
    // Reddy is `pro` (good for BRS) — so finishLeader also reports `leader_standing` for them.
    const scoreLeaders = (list, index, rival = false) => {
      const acc = new Map();
      for (const d of list) {
        const side = sideOf(d.analysis?.political_stance);
        if (side === 'unrelated') continue;
        const seen = new Set();
        for (const nm of entityNames(d)) {
          const leader = index.get(nameNorm(nm));
          if (!leader || seen.has(leader.id)) continue;
          seen.add(leader.id);
          if (!acc.has(leader.id)) acc.set(leader.id, blankLeader(leader, rival));
          const r = acc.get(leader.id);
          r.mentions += 1;
          r[side] += 1;
          const topic = d.analysis?.topic;
          if (topic && topic !== 'None') {
            if (!r.topics.has(topic)) {
              r.topics.set(topic, { topic, pro: 0, anti: 0, neutral: 0, total: 0 });
            }
            const t = r.topics.get(topic);
            t[side] += 1;
            t.total += 1;
          }
          if (side === 'anti') {
            r.quotes.push({
              text: String(d.content?.text || '').replace(/\s+/g, ' ').slice(0, 320),
              handle: d.posted_by?.handle || null,
              platform: d.platform || null,
              topic: topic && topic !== 'None' ? topic : null,
              district: d.detected_location?.district || null,
              engagement: engagementOf(d.engagement),
              date: d.post_date,
              url: d.tweet_url || null,
            });
          }
        }
      }
      return acc;
    };

    const finishLeader = (r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      constituency: r.constituency,
      portfolios: r.portfolios,
      party: r.party,
      mentions: r.mentions,
      pro: r.pro,
      anti: r.anti,
      neutral: r.neutral,
      net: netScore(r.pro, r.anti, r.neutral),
      // Which question `pro` / `anti` / `net` answer: "does it help or hurt BRS?".
      axis: 'client_relative',
      // For a rival leader, how people regard THAT LEADER (the reverse of the client-relative
      // counts). Null for our own leaders, where the two are the same thing.
      leader_standing: r.rival
        ? { supportive: r.anti, critical: r.pro, net: netScore(r.anti, r.pro) }
        : null,
      confident: r.mentions >= MIN_CONFIDENT,
      topics: [...r.topics.values()].sort((a, b) => b.anti - a.anti || b.total - a.total).slice(0, 5),
      quotes: r.quotes.sort((a, b) => b.engagement - a.engagement).slice(0, 4),
    });

    const curOur = scoreLeaders(organic, OUR_INDEX);
    const prevOur = scoreLeaders(prevOrganic, OUR_INDEX);
    const curOpp = scoreLeaders(organic, OPP_INDEX, true);

    /**
     * The brief's principal. In a ruling-party deployment this was whoever held
     * the role "Chief Minister"; BRS is in opposition and holds no office, so
     * the principal is the party president (PARTY_CHIEF, i.e. KCR). The name
     * match against OUR_PARTY.chief is kept as the fallback.
     */
    const CHIEF_ID = PARTY_CHIEF?.id
      || (OUR_FRONTBENCH || []).find(
        (l) => nameNorm(l.name) === nameNorm(OUR_PARTY?.chief),
      )?.id
      || null;

    const chiefCur = CHIEF_ID && curOur.has(CHIEF_ID) ? finishLeader(curOur.get(CHIEF_ID)) : null;
    const chiefPrev = CHIEF_ID && prevOur.has(CHIEF_ID) ? finishLeader(prevOur.get(CHIEF_ID)) : null;

    const principal = {
      name: PARTY_CHIEF?.name || OUR_PARTY?.chief || null,
      role: 'Party President',
      party: OUR_PARTY?.name || null,
      party_full: OUR_PARTY?.full_name || null,
      found: !!chiefCur,
      ...(chiefCur || {
        mentions: 0, pro: 0, anti: 0, neutral: 0,
        net: null, confident: false, topics: [], quotes: [],
      }),
      prev_mentions: chiefPrev?.mentions ?? 0,
      prev_net: chiefPrev?.net ?? null,
      // A move is only claimed when BOTH windows are big enough to support one.
      net_change: (chiefCur && chiefPrev
        && chiefCur.net !== null && chiefPrev.net !== null
        && chiefCur.mentions >= MIN_CONFIDENT && chiefPrev.mentions >= MIN_CONFIDENT)
        ? chiefCur.net - chiefPrev.net : null,
    };

    const ministers = [...curOur.values()]
      .filter((r) => r.id !== CHIEF_ID)
      .map(finishLeader)
      .sort((a, b) => b.anti - a.anti || b.mentions - a.mentions)
      .slice(0, 10);

    const oppositionLeaders = [...curOpp.values()]
      .map(finishLeader)
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 6);

    /* -- party standing: ours against the opposition, in the public voice - */
    /**
     * politicalData carries Latin aliases only, but a large share of public
     * conversation in Telangana is written in Telugu. Without these forms a
     * post saying బీఆర్ఎస్ would not be counted as naming the party at all,
     * which would understate every party figure on the brief. Keyed by the
     * party name as politicalData spells it.
     */
    const TELUGU_PARTY_ALIASES = {
      BRS: ['బీఆర్ఎస్', 'భారత్ రాష్ట్ర సమితి', 'కారు పార్టీ'],
      INC: ['కాంగ్రెస్', 'భారత జాతీయ కాంగ్రెస్', 'హస్తం పార్టీ'],
      BJP: ['బీజేపీ', 'భారతీయ జనతా పార్టీ', 'కమలం పార్టీ'],
      AIMIM: ['ఎంఐఎం', 'మజ్లిస్'],
      CPI: ['సీపీఐ'],
      CPM: ['సీపీఎం'],
      // Kavitha's breakaway. Bare "TRS" is deliberately absent — it is also
      // this party's own former name, and the two are led by an estranged
      // father and daughter attacking each other.
      'TRS(K)': ['తెలంగాణ రక్షణ సేన'],
    };
    const partyAliasRx = (pt) => {
      const words = [
        pt?.name, pt?.full_name,
        ...(pt?.aliases || []),
        ...(TELUGU_PARTY_ALIASES[pt?.name] || []),
      ]
        .filter(Boolean)
        .map((w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .sort((a, b) => b.length - a.length);
      return words.length ? new RegExp('(' + words.join('|') + ')', 'i') : null;
    };
    const ourRx = partyAliasRx(OUR_PARTY);
    const oppRxList = (OPPOSITION_PARTIES || [])
      .map((pt) => ({ name: pt.name, rx: partyAliasRx(pt) }))
      .filter((x) => x.rx);

    const ourParty = { pro: 0, anti: 0, neutral: 0, mentions: 0 };
    const rivalParties = {};
    for (const d of organic) {
      const side = sideOf(d.analysis?.political_stance);
      if (side === 'unrelated') continue;
      const hay = (d.content?.text || '') + ' ' + entityNames(d).join(' ');
      if (ourRx && ourRx.test(hay)) {
        ourParty.mentions += 1;
        ourParty[side] += 1;
      }
      for (const o of oppRxList) {
        if (!o.rx.test(hay)) continue;
        if (!rivalParties[o.name]) {
          rivalParties[o.name] = { party: o.name, mentions: 0, pro: 0, anti: 0, neutral: 0 };
        }
        rivalParties[o.name].mentions += 1;
        rivalParties[o.name][side] += 1;
      }
    }
    const party = {
      name: OUR_PARTY?.name || null,
      full_name: OUR_PARTY?.full_name || null,
      mentions: ourParty.mentions,
      pro: ourParty.pro,
      anti: ourParty.anti,
      neutral: ourParty.neutral,
      net: netScore(ourParty.pro, ourParty.anti, ourParty.neutral),
      confident: ourParty.mentions >= MIN_CONFIDENT,
      rivals: Object.values(rivalParties)
        .map((r) => ({ ...r, net: netScore(r.pro, r.anti, r.neutral) }))
        .sort((a, b) => b.mentions - a.mentions)
        .slice(0, 4),
    };

    /* -- the sharpest criticism on each leading issue -------------------- */
    const quotesByTopic = new Map();
    for (const d of organic) {
      if (sideOf(d.analysis?.political_stance) !== 'anti') continue;
      const t = d.analysis?.topic;
      if (!t || t === 'None') continue;
      if (!quotesByTopic.has(t)) quotesByTopic.set(t, []);
      quotesByTopic.get(t).push({
        text: String(d.content?.text || '').replace(/\s+/g, ' ').slice(0, 320),
        handle: d.posted_by?.handle || null,
        platform: d.platform || null,
        district: d.detected_location?.district || null,
        engagement: engagementOf(d.engagement),
        date: d.post_date,
        url: d.tweet_url || null,
      });
    }
    const issueQuotes = {};
    for (const [t, list] of quotesByTopic.entries()) {
      issueQuotes[t] = list.sort((a, b) => b.engagement - a.engagement).slice(0, 3);
    }

    /* ── recommendations: scanned from the data, not a fixed rule list ──── */
    /**
     * The previous version was eight `if` statements with template strings, so
     * it could only ever produce eight findings and said the same thing however
     * the data moved. This scans EVERY entity the brief holds — each issue,
     * district, minister, outlet, threat cluster and spreading post — scores
     * each on what the numbers actually are, and ranks them against each other.
     *
     * Two things make a recommendation specific rather than generic:
     *   1. IMPACT is computed, not assigned. Severity follows from the score,
     *      so a small issue cannot outrank a large one just because a rule for
     *      it happened to be written first.
     *   2. THEMES come from the criticism itself — the words that actually
     *      recur in the opposing posts — so "Corruption" is accompanied by what
     *      people are saying about it, not just a count.
     */

    /* Term extraction over the opposing posts, English + Devanagari. */
    const STOPWORDS = new Set([
      // English
      'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'had',
      'not', 'are', 'was', 'were', 'will', 'would', 'been', 'being', 'they',
      'them', 'their', 'there', 'then', 'than', 'what', 'when', 'which', 'who',
      'whom', 'how', 'why', 'all', 'any', 'can', 'her', 'his', 'its', 'our',
      'out', 'you', 'your', 'about', 'after', 'again', 'also', 'into', 'more',
      'most', 'over', 'such', 'only', 'other', 'some', 'these', 'those', 'very',
      'just', 'like', 'make', 'made', 'need', 'now', 'one', 'two', 'said',
      'says', 'say', 'get', 'got', 'new', 'even', 'much', 'many', 'still',
      'https', 'http', 'www', 'com', 'amp', 'rt',
      // Romanised Telugu — a large share of this feed is written this way.
      'garu', 'kani', 'kuda', 'chala', 'chaala', 'unnadi', 'undi', 'unnaru',
      'ledu', 'ledhu', 'kadu', 'avunu', 'manam', 'meeru', 'vallu', 'vaallu',
      'anta', 'ante', 'appudu', 'ippudu', 'enduku', 'endhuku', 'cheppadu',
      // Telugu — the equivalents that carry no subject matter
      'మరియు', 'కానీ', 'కూడా', 'ఇది', 'అది', 'ఒక', 'అని', 'అనే',
      'లో', 'కు', 'కి', 'తో', 'పై', 'నుండి', 'వరకు', 'గురించి',
      'ఉంది', 'ఉన్నాయి', 'ఉన్నారు', 'లేదు', 'కాదు', 'అవును',
      'చేసిన', 'చేసే', 'చేయడం', 'అయింది', 'వచ్చిన', 'చాలా', 'ఎందుకు',
      'మేము', 'మీరు', 'వారు', 'నేను', 'తన', 'వారి', 'మన', 'అన్ని',
    ]);
    /**
     * ⚠ Telugu is U+0C00-U+0C7F and Kannada begins at U+0C80, immediately
     * after. Telangana borders Karnataka, so an off-by-one here silently
     * tokenises Kannada as Telugu. The bounds are written as escapes, not as
     * literal glyphs, because the two scripts' characters are visually
     * unfamiliar to most reviewers and a wrong boundary would pass unnoticed.
     *
     * The 3-codepoint minimum is looser than Latin's 4 because Telugu is an
     * abugida: one cluster carries a consonant plus its vowel, so meaningful
     * words are shorter in code points than their Latin equivalents.
     */
    const TOKEN_RX = /[A-Za-z]{4,}|[ఀ-౿]{3,}/g;
    const tokenise = (text) => {
      const clean = String(text || '')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/@[\w.]+/g, ' ')
        .replace(/#/g, ' ')
        // Danda and double danda are Indic full stops that stick to the word
        // before them. Telugu mostly uses the Latin period now, but the danda
        // still turns up in older and literary copy.
        .replace(/[\u0964\u0965]/g, ' ')
        // Zero-width joiner and non-joiner sit INSIDE Telugu clusters. Left in,
        // they split one word into two tokens, and neither half then matches a
        // stopword or another post's spelling of the same word.
        .replace(/[\u200C\u200D]/g, '');
      return (clean.match(TOKEN_RX) || [])
        .map((w) => w.toLowerCase())
        .filter((w) => !STOPWORDS.has(w));
    };
    /** The words that recur in a set of posts, most frequent first. */
    const themesOf = (docs, limit = 4) => {
      const freq = new Map();
      for (const d of docs) {
        // Count a word once per post, so one ranting account cannot set the theme.
        for (const w of new Set(tokenise(d.content?.text))) {
          freq.set(w, (freq.get(w) || 0) + 1);
        }
      }
      return [...freq.entries()]
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([term, n]) => ({ term, posts: n }));
    };

    const opposingPosts = organic.filter(
      (d) => sideOf(d.analysis?.political_stance) === 'anti',
    );
    const opposingBy = (pred) => opposingPosts.filter(pred);

    /* Impact: volume of opposition, weighted by how one-sided it is and how
       far it is spreading. Everything is scored on the same scale so the list
       ranks itself. */
    const impactOf = ({ adverse = 0, share = 0, reach = 0, rising = false }) =>
      // Reach is capped: how fast something travels argues for answering it
      // today, but it should not let a handful of posts outrank an issue the
      // public has turned against.
      Math.round((adverse * (0.5 + share)) + Math.min(35, reach / 120) + (rising ? 25 : 0));
    const severityFor = (impact) => (impact >= 80 ? 'critical'
      : impact >= 40 ? 'serious' : impact >= 15 ? 'warning' : 'info');

    const n0 = (v) => (v || 0).toLocaleString('en-IN');
    const recommendations = [];
    const addRec = (r) => {
      if (!r || !r.headline) return;
      recommendations.push({ ...r, severity: r.severity || severityFor(r.impact || 0) });
    };

    /* 1 ── every issue where the public is against us ------------------- */
    for (const i of issues) {
      if (i.anti < 5) continue;
      const share = (i.anti + i.pro) ? i.anti / (i.anti + i.pro) : 0;
      if (share < 0.4) continue;
      const posts = opposingBy((d) => d.analysis?.topic === i.topic);
      const reach = posts.reduce((s, d) => s + engagementOf(d.engagement), 0);
      const track = issueTracking.find((t) => t.topic === i.topic);
      const worsening = track?.direction === 'worsening';
      const losingVoice = i.opposition_posts > i.our_posts;
      const themes = themesOf(posts);
      addRec({
        kind: 'issue',
        topic: i.topic,
        headline: `${i.topic}: ${Math.round(share * 100)}% of those taking a side are against us`,
        metric: String(i.anti),
        unit: 'opposing posts',
        detail: `${i.anti} opposing against ${i.pro} supportive`
          + (themes.length ? `. Recurring in the criticism: ${themes.map((t) => t.term).join(', ')}.` : '.')
          + (worsening ? ' It has worsened across this window.' : '')
          + (losingVoice ? ` The opposition posted ${i.opposition_posts} times on it against our ${i.our_posts}.` : ''),
        action: losingVoice
          ? `Put our position on ${i.topic} on record — we are being out-posted ${i.opposition_posts} to ${i.our_posts}.`
          : worsening
            ? `Find what changed on ${i.topic} in the last two weeks before it sets.`
            : `Prepare the party's response on ${i.topic}: a press statement that answers the specific complaints with evidence.`,
        themes,
        evidence: {
          total: i.total, pro: i.pro, anti: i.anti, reach,
          opposition: i.opposition_posts, ours: i.our_posts,
        },
        // The actual posts, so advice can name the grievance rather than the
        // topic label. Trimmed to the most-shared few.
        quotes: posts
          .slice()
          .sort((a, b) => engagementOf(b.engagement) - engagementOf(a.engagement))
          .slice(0, 3)
          .map((d) => d.content?.text)
          .filter(Boolean),
        districts: [...new Set(posts.map((d) => d.detected_location?.district).filter(Boolean))]
          .slice(0, 3),
        link: { page: 'mentions', topic: i.topic, stance: 'opposing' },
        impact: impactOf({ adverse: i.anti, share, reach, rising: worsening }),
      });
    }

    /* 2 ── every district carrying adverse weight ----------------------- */
    for (const d of districts) {
      const adverse = d.news_negative + d.social_anti;
      if (adverse < 3) continue;
      const share = d.pressure / 100;
      const posts = opposingBy((m) => m.detected_location?.district === d.district);
      const themes = themesOf(posts, 3);
      addRec({
        kind: 'district',
        headline: `${d.district}: ${d.pressure}% of local coverage is adverse`,
        metric: `${d.pressure}%`,
        unit: 'adverse',
        detail: `${d.news_negative} negative articles and ${d.social_anti} opposing posts`
          + (themes.length ? `, recurring on ${themes.map((t) => t.term).join(', ')}` : '')
          + '.',
        action: `Mobilise the ${d.district} district unit: cadre outreach, a local press note and a promise-vs-delivery sheet.`,
        themes,
        evidence: { news: d.news, social: d.social, adverse },
        quotes: posts
          .slice()
          .sort((a, b) => engagementOf(b.engagement) - engagementOf(a.engagement))
          .slice(0, 3)
          .map((m) => m.content?.text)
          .filter(Boolean),
        link: { page: 'district', district: d.district },
        impact: impactOf({ adverse, share }),
      });
    }

    /* 3 ── ministers drawing fire -------------------------------------- */
    for (const m of ministers) {
      if (m.anti < 5) continue;
      const share = (m.anti + m.pro) ? m.anti / (m.anti + m.pro) : 0;
      if (share < 0.4) continue;
      const subject = m.topics?.[0];
      addRec({
        kind: 'minister',
        headline: `${m.name} is drawing criticism`,
        metric: String(m.anti),
        unit: 'opposing mentions',
        detail: `${m.anti} opposing against ${m.pro} supportive`
          + (m.role ? `, as ${m.role}` : '')
          + (subject ? `, mostly over ${subject.topic}` : '') + '.',
        action: subject
          ? `Have ${m.name} answer on ${subject.topic} directly, with a press statement or a social-media response.`
          : `Ask ${m.name}'s office for a line on the criticism.`,
        themes: [],
        evidence: { mentions: m.mentions, pro: m.pro, anti: m.anti },
        link: { page: 'mentions', stance: 'opposing' },
        impact: impactOf({ adverse: m.anti, share }),
      });
    }

    /* 4 ── outlets whose coverage has turned ---------------------------- */
    for (const o of outlets) {
      if (o.net === null || o.net > -20 || o.negative < 3) continue;
      addRec({
        kind: 'outlet',
        headline: `${o.outlet} is running against us`,
        metric: String(o.net),
        unit: 'net tone',
        detail: `${o.negative} unfavourable of ${o.n} articles scored from this outlet.`,
        action: `Offer ${o.outlet} a briefing and a named spokesperson.`,
        themes: [],
        evidence: { articles: o.n, negative: o.negative, positive: o.positive },
        link: { page: 'articles', stance: 'opposing' },
        impact: impactOf({ adverse: o.negative, share: o.n ? o.negative / o.n : 0 }),
      });
    }

    /* 5 ── hostile content with a legal route --------------------------- */
    /* One queue, not one entry per intent — they all end in the same action. */
    const topIntents = threats.by_intent.filter((t) => t.n >= 3);
    if (threats.hostile > 0 && topIntents.length) {
      addRec({
        kind: 'threat',
        headline: `${threats.hostile} hostile posts flagged and unactioned`,
        metric: String(threats.legal_ready),
        unit: 'ready to file',
        detail: `Mostly ${topIntents.slice(0, 3).map((t) => `${t.intent.replace(/_/g, ' ').toLowerCase()} (${t.n})`).join(', ')}.`
          + ` ${threats.legal_ready} of ${threats.total} already carry a legal section`
          + ` and ${threats.policy_ready} breach a platform policy.`,
        action: threats.legal_ready
          ? `File the ${threats.legal_ready} complaints already prepared rather than leaving them open.`
          : 'Have legal review these before they age out.',
        themes: [],
        evidence: {
          hostile: threats.hostile,
          legal_ready: threats.legal_ready,
          policy_ready: threats.policy_ready,
          by_intent: topIntents.slice(0, 5),
        },
        link: { page: 'alerts', stance: 'opposing' },
        impact: impactOf({ adverse: threats.hostile, share: 1 }),
      });
    }

    /* 6 ── posts spreading faster than normal --------------------------- */
    /* One situation, not one per post: five near-identical "spreading fast"
       entries otherwise took the top of the list and buried the issues. */
    const fast = spreading.filter((x) => x.multiple && x.multiple >= 2);
    if (fast.length) {
      const lead = fast[0];
      const reach = fast.reduce((sum, x) => sum + (x.engagement || 0), 0);
      const topics = [...new Set(fast.map((x) => x.topic).filter(Boolean))];
      addRec({
        kind: 'velocity',
        headline: fast.length === 1
          ? `A critical post is spreading ${lead.multiple}× faster than normal`
          : `${fast.length} critical posts are spreading faster than normal`,
        metric: `${lead.multiple}×`,
        unit: 'fastest of these',
        detail: `Between them ${n0(reach)} likes, shares and replies`
          + (topics.length ? `, on ${topics.slice(0, 3).join(', ')}` : '')
          + `. The fastest: "${lead.text.slice(0, 120)}${lead.text.length > 120 ? '…' : ''}"`,
        action: 'Decide within the hour whether to answer these or leave them alone.',
        themes: themesOf(
          opposingPosts.filter((d) => fast.some((x) => x.url && x.url === d.tweet_url)), 3,
        ),
        evidence: { posts: fast.length, reach, fastest: lead.multiple, url: lead.url },
        link: { page: 'mentions', stance: 'opposing' },
        impact: impactOf({ adverse: 8 * fast.length, share: 1, reach, rising: true }),
      });
    }

    /* 7 ── issues the opposition owns because we are silent ------------- */
    for (const i of issues) {
      if (i.opposition_posts < 3 || i.opposition_posts <= i.our_posts) continue;
      if (recommendations.some((r) => r.kind === 'issue' && r.topic === i.topic)) continue;
      addRec({
        kind: 'coverage',
        topic: i.topic,
        headline: `We are not contesting ${i.topic}`,
        metric: `${i.opposition_posts}:${i.our_posts}`,
        unit: 'their posts to ours',
        detail: `The opposition posted ${i.opposition_posts} times on ${i.topic}; we posted ${i.our_posts}.`,
        action: `Put our record on ${i.topic} out before the framing settles.`,
        themes: [],
        evidence: { opposition: i.opposition_posts, ours: i.our_posts },
        link: { page: 'mentions', topic: i.topic },
        impact: impactOf({ adverse: i.opposition_posts - i.our_posts, share: 0.5 }),
      });
    }

    /* 8 ── press out of step with the public ---------------------------- */
    if (headline.divergence !== null && Math.abs(headline.divergence) >= 15) {
      const pressWorse = headline.divergence < 0;
      addRec({
        kind: 'press',
        headline: pressWorse
          ? 'Newspapers are more negative than the public'
          : 'Newspapers are more positive than the public',
        metric: `${headline.divergence > 0 ? '+' : ''}${headline.divergence}`,
        unit: 'points apart',
        detail: pressWorse
          ? `The public scores ${publicNet} against ${pressNet} in print. Coverage has not caught up with opinion.`
          : `Print scores ${pressNet} against ${publicNet} from the public. The clippings read better than the mood.`,
        action: pressWorse
          ? 'Brief the press on what has already shifted.'
          : 'Do not read the clippings as the public mood.',
        themes: [],
        evidence: { public: publicNet, press: pressNet },
        link: { page: 'articles' },
        impact: impactOf({ adverse: Math.abs(headline.divergence), share: 0.6 }),
      });
    }

    /* 9 ── what is working, so it can be repeated ----------------------- */
    const working = issues
      .filter((i) => i.confident && i.pro >= 10 && i.pro > i.anti * 3)
      .sort((a, b) => b.pro - a.pro)[0];
    if (working) {
      addRec({
        kind: 'working',
        severity: 'good',
        topic: working.topic,
        headline: `${working.topic} is working for us`,
        metric: String(working.pro),
        unit: 'supportive posts',
        detail: `${working.pro} supportive against ${working.anti} opposing — the clearest positive in this window.`,
        action: `Repeat the ${working.topic} message on issues that are not landing.`,
        themes: themesOf(
          organic.filter((d) => d.analysis?.topic === working.topic
            && sideOf(d.analysis?.political_stance) === 'pro'), 3,
        ),
        evidence: { pro: working.pro, anti: working.anti },
        link: { page: 'mentions', topic: working.topic, stance: 'supportive' },
        impact: 0,
      });
    }

    /* Rank by impact. Positives sit at the end regardless of size — this is a
       list of things to act on, and the good news is context, not an action. */
    recommendations.sort((a, b) => {
      if ((a.severity === 'good') !== (b.severity === 'good')) return a.severity === 'good' ? 1 : -1;
      return b.impact - a.impact;
    });

    /**
     * The findings above are measured. The ACTION on each is still a sentence
     * written by hand, which is why it never changed however the data moved.
     * This rewrites it from the evidence — the recurring words, the verbatim
     * posts, who is out-posting whom — for the findings that will actually be
     * read. Everything else on the page stays deterministic.
     *
     * If the model is unavailable the template sentence stands, so the brief
     * renders either way; `action_source` records which it was.
     */
    await adviseAll(recommendations, {
      state: OUR_PARTY?.state || 'the state',
      party: OUR_PARTY?.full_name || OUR_PARTY?.name || 'the party',
      days,
    });

    // Kept as `decisions` so nothing downstream has to change.
    const decisions = recommendations;

    /* ── coverage, stated openly ───────────────────────────────────────── */
    const withTopic = curM.filter((d) => d.analysis?.topic && d.analysis.topic !== 'None').length;
    const coverage = {
      mentions: curM.length,
      articles: curN.length,
      topic_pct: curM.length ? Math.round((withTopic / curM.length) * 100) : 0,
      social_district_pct: curM.length
        ? Math.round((curM.filter((d) => d.detected_location?.district).length / curM.length) * 100) : 0,
      news_district_pct: curN.length
        ? Math.round((curN.filter((a) => a.detected_location?.district).length / curN.length) * 100) : 0,
    };

    res.json({
      window: { days, from, to: now },
      headline, voice, coverage, modules, decisions,
      issues, timeline, spreading,
      trend, counts, combined, by_source: bySource,
      principal, ministers, opposition_leaders: oppositionLeaders, party,
      issue_tracking: issueTracking,
      issue_quotes: issueQuotes,
      recent_mentions: recentMentions,
      recent_news: recentNews,
      narrative: { press, public: pub, outlets, categories },
      districts, threats, leaders,
      min_confident: MIN_CONFIDENT,
    });
  } catch (err) {
    console.error('[cm-brief]', err);
    res.status(500).json({ message: err.message });
  }
};

// classifyVoice is exported for the adversary-roster test only. Which side an
// account speaks for is the one thing in this controller that a wrong data
// file breaks silently — nothing throws, the numbers are just wrong — so it
// needs to be assertable without standing up a database.
module.exports = { getCMBrief, classifyVoice };
