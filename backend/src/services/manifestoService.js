/**
 * manifestoService — the Manifesto tracker (client requirement 3).
 * ─────────────────────────────────────────────────────────────────────
 *   "Election manifesto: status of promised schemes, people reach, people sentiments"
 *
 * For every scheme in manifestoSchemes.js — the governing party's 2023
 * promises and the schemes our party built — computed from what people post,
 * over the selected window:
 *
 *   status      what the public and press REPORT: received / not received /
 *               delayed / less than promised / stopped (schemeClaimService).
 *               A one-line verdict is given only with MIN_VERDICT reports or
 *               more; it is public opinion, and is labelled so, not an
 *               official delivery record.
 *   reach       online: posts, engagement, distinct accounts, platforms.
 *               claimed: figures quoted in posts and news, with who quoted them.
 *   sentiment   whom the discussion favours — our party or the government —
 *               from the stance already stored on every post, overall and by
 *               who is talking.
 *
 * Built on the Social & Channels in-memory copy (socialChannelsService), so it
 * makes no database reads of its own and answers in milliseconds.
 */
const social = require('./socialChannelsService');
const claims = require('./schemeClaimService');
const { netScore } = require('../controllers/cmDashboardController');
const { MANIFESTO_SCHEMES, SCHEME_BY_ID } = require('../config/manifestoSchemes');

/** Public and press reports needed before a verdict is stated. */
const MIN_VERDICT = 10;
const REPORTS = ['not_received', 'delayed', 'reduced', 'stopped', 'received'];
const REPORT_LABEL = {
    received: 'received', not_received: 'not received', delayed: 'delayed', reduced: 'less than promised', stopped: 'stopped',
};

const bump = (o, k, by = 1) => { o[k] = (o[k] || 0) + by; };
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const topOf = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

/** Which side a post favours, from its stance (stanceVocabulary: "target" = our party). */
const favourOf = (stance) => {
    if (stance === 'pro_target' || stance === 'pro_target_indirect') return 'ours';
    if (stance === 'anti_target' || stance === 'anti_target_indirect') return 'govt';
    return null;
};

const example = (i, claim) => ({
    text: i.text.length > 220 ? `${i.text.slice(0, 217)}…` : i.text,
    url: i.url, author: i.author, platform: i.platform, source_type: social.VOICE_LABEL[i.voice], engagement: i.engagement, claim,
});

/** Each item that the reader linked to `id`, with what it says. */
const rowsFor = (items, id) => {
    const out = [];
    for (const i of items) {
        const c = i.schemes.find((x) => x && x.scheme === id);
        // Saved readings are re-checked against the current rules (schemeClaimService.claimStands).
        if (c) out.push({ i, claim: claims.claimStands(c) ? c.claim : 'none', figure: c.figure || null });
    }
    return out;
};

const verdictOf = (reports, total) => {
    if (total < MIN_VERDICT) return null;
    const top = REPORTS.slice().sort((a, b) => (reports[b] || 0) - (reports[a] || 0))[0];
    const share = pct(reports[top] || 0, total);
    return {
        claim: top,
        share,
        text: share >= 50 ? `Mostly ${REPORT_LABEL[top]}` : `Mixed — ${REPORT_LABEL[top]} ${share}%`,
    };
};

const summariseScheme = (s, cur, prev) => {
    const rows = rowsFor(cur, s.id);
    const before = rowsFor(prev, s.id);

    // Status: what the public and press report.
    const reports = {}; let reportsTotal = 0;
    const prevReports = {}; let prevTotal = 0;
    for (const r of rows) if (r.claim !== 'none' && social.isOpinion(r.i)) { bump(reports, r.claim); reportsTotal += 1; }
    for (const r of before) if (r.claim !== 'none' && social.isOpinion(r.i)) { bump(prevReports, r.claim); prevTotal += 1; }
    const verdict = verdictOf(reports, reportsTotal);

    // Reach: online, and figures people quote.
    const platforms = {}; const accounts = new Set(); let engagement = 0;
    for (const { i } of rows) {
        bump(platforms, i.platform);
        if (i.handle || i.author) accounts.add(String(i.handle || i.author).toLowerCase());
        engagement += i.engagement;
    }
    const seenFigures = new Set();
    const figures = rows.filter((r) => r.figure)
        .sort((a, b) => new Date(b.i.date) - new Date(a.i.date))
        // The same figure is often quoted by many posts: show each once, newest first.
        .filter((r) => { const k = String(r.figure).toLowerCase().replace(/\s+/g, ' ').trim(); if (seenFigures.has(k)) return false; seenFigures.add(k); return true; })
        .slice(0, 6)
        .map((r) => ({ figure: r.figure, by: r.i.author, source_type: social.VOICE_LABEL[r.i.voice], date: r.i.date, url: r.i.url }));

    // Sentiment: whom it favours, among the public and press; and what each group of accounts says.
    const favour = { ours: 0, govt: 0 };
    const byVoice = {};
    for (const { i } of rows) {
        const f = favourOf(i.stance);
        if (!f) continue;
        if (social.isOpinion(i)) favour[f] += 1;
        byVoice[i.voice] = byVoice[i.voice] || { ours: 0, govt: 0 };
        byVoice[i.voice][f] += 1;
    }

    // The most engaged report of each kind, one per text.
    const examples = [];
    const seen = new Set();
    for (const claim of [...REPORTS, 'none']) {
        rows.filter((r) => r.claim === claim && r.i.url)
            .sort((a, b) => b.i.engagement - a.i.engagement)
            .filter((r) => { const k = r.i.text.slice(0, 120); if (seen.has(k)) return false; seen.add(k); return true; })
            .slice(0, 2)
            .forEach((r) => examples.push(example(r.i, claim)));
    }

    const prevVerdict = verdictOf(prevReports, prevTotal);
    return {
        id: s.id, side: s.side, group: s.group || null, name: s.name, promise: s.promise || s.what || null,
        pair: s.pair || null, new_scheme: !!s.newScheme,
        status: {
            reports, total: reportsTotal, verdict, min_reports: MIN_VERDICT,
            previous: prevVerdict ? { ...prevVerdict, total: prevTotal } : null,
        },
        reach: {
            posts: rows.length, prev_posts: before.length, engagement, accounts: accounts.size,
            platforms, top_platform: topOf(platforms), figures,
        },
        sentiment: {
            favours_ours: favour.ours, favours_govt: favour.govt,
            // Positive = the public and press side with our party on this scheme.
            net_ours: netScore(favour.ours, favour.govt),
            by_source: Object.entries(byVoice).map(([voice, v]) => ({ voice, label: social.VOICE_LABEL[voice], ...v })),
        },
        examples,
    };
};

/** Promises on one side, counted by their verdict. */
const scorecard = (rows) => {
    const out = { schemes: rows.length, not_enough: 0 };
    REPORTS.forEach((c) => { out[c] = 0; });
    for (const r of rows) {
        if (r.status.verdict) out[r.status.verdict.claim] += 1;
        else out.not_enough += 1;
    }
    return out;
};

const memo = new Map();

const overview = async ({ days, scope }) => {
    const copy = await social.scopedCopy({ scope });
    const key = `${copy.key}:${days}`;
    if (!memo.has(key)) {
        const from = new Date(Date.now() - days * social.DAY);
        const prevFrom = new Date(from.getTime() - days * social.DAY);
        const cur = []; const prev = [];
        for (const i of copy.items) {
            if (!i.schemes.length) continue;
            const t = new Date(i.date);
            if (t >= from) cur.push(i);
            else if (t >= prevFrom) prev.push(i);
        }
        const all = MANIFESTO_SCHEMES.map((s) => summariseScheme(s, cur, prev));
        const theirs = all.filter((r) => r.side === 'theirs');
        const ours = all.filter((r) => r.side === 'ours');
        const byId = new Map(all.map((r) => [r.id, r]));
        const pairs = ours.filter((r) => r.pair && byId.has(r.pair)).map((r) => ({ ours: r, theirs: byId.get(r.pair) }));
        if (memo.size > 100) memo.clear();
        memo.set(key, {
            days,
            as_of: copy.as_of,
            min_reports: MIN_VERDICT,
            theirs: { scorecard: scorecard(theirs.filter((r) => !r.new_scheme)), schemes: theirs },
            ours: { scorecard: scorecard(ours), schemes: ours },
            pairs,
        });
    }
    // Reading progress changes between reloads of the copy, so it is added fresh.
    return { ...memo.get(key), reading: { ...claims.progress(), pending: await claims.countPending() } };
};

module.exports = { overview, summariseScheme, favourOf, MIN_VERDICT, SCHEME_BY_ID };
