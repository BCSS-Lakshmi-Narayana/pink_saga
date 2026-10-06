/**
 * CMDashboard — the front page of the platform.
 * ──────────────────────────────────────────────────────────────────────────
 * DENSITY. Earlier versions let one section eat a whole screen: eight tracker
 * rows at 84px with the bar stranded mid-row and half the width empty. Every
 * band here is either full-width because it needs to be (a table) or paired
 * into a 8/4 or 4/4/4 split so the horizontal space carries content instead
 * of air.
 *
 * ICONOGRAPHY. Every analytic carries an icon that says what it is:
 *   · each card header has a subject icon
 *   · each of the 15 issue topics has its own icon (Water Supply → droplets,
 *     Corruption → gavel, Electricity → bolt …) so a row is recognised before
 *     it is read
 *   · direction is an arrow, severity is a symbol — never colour alone
 *
 * SPOTLIGHTS. Band B lifts the three things a Chief Minister asks first —
 * how am I doing, how is my party doing, is the press with us — out of the
 * tables and into large-figure cards.
 *
 * TILE DISCIPLINE. Three components only: <Kpi>, <Spotlight>, <Card>. Rows
 * are items-stretch with h-full cards so tiles share a baseline.
 *
 * BASELINE HONESTY. When monitoring started part-way through the previous
 * window a period-on-period percentage reports when collection began, not
 * what the public did. The API flags it and the page prints "baseline
 * building" instead of a figure like +2164%.
 *
 * Colour — Supportive #15803d · Neutral #64748b · Opposing #ef4444.
 * Neutral is grey because neutral is neither good nor bad, matching
 * APAlertsWidget; it is also what a diverging scale needs at the midpoint.
 * Validated on white: CVD separation worst ΔE 13.9, normal vision 19.8.
 * Amber is under 3:1, so colour never carries meaning alone; every legend
 * prints the count and the share.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, ReferenceLine,
} from 'recharts';
import {
  Megaphone, Smile, Frown, Newspaper, Download, RefreshCw,
  ChevronRight, ChevronDown, AlertTriangle, TrendingUp, TrendingDown, Minus,
  MessageSquare, Map, Users, Calendar, Sparkles, ClipboardCheck,
  MessageCircle, UserSearch, Share2, Landmark, LayoutDashboard, Search,
  FileBarChart, Settings, Info, Activity, PieChart as PieIcon, Siren, MapPin,
  Building2, Vote, GraduationCap, Gavel, HeartPulse, Wheat,
  Zap, Droplets, Route, Briefcase, Home, Shield, Wallet, Leaf, Trash2,
  CircleDot, Layers, ExternalLink,
} from 'lucide-react';
import api from '../lib/api';
import { APP_NAVIGATION } from '../config/navigation';
import { useRbac } from '../contexts/RbacContext';

/* ── palette ───────────────────────────────────────────────────────────── */
const POS = '#15803d';
const NEU = '#64748b';   // slate-500, as APAlertsWidget establishes for neutral
const NEG = '#ef4444';
const VOICE_COLORS = ['#2563eb', '#e07a0f', '#0d9488', '#c026d3'];
const SEV = { critical: '#dc2626', serious: '#ea580c', warning: '#ca8a04', good: '#15803d' };
const INK = { mute: '#94a3b8' };

/* Severity ramp, matching RISK_COLORS in APAlertsWidget so a level means the
   same colour everywhere in the app. Note `low` is emerald, not grey — grey
   is reserved for neutral. */
const RISK = {
  critical: '#dc2626',  // red-600
  high: '#ea580c',      // orange-600
  medium: '#ca8a04',    // yellow-600
  low: '#059669',       // emerald-600
};

/* ── issue iconography — one per topic in the taxonomy ─────────────────── */
const TOPIC_ICONS = {
  'Governance & Administration': Building2,
  'Elections & Politics': Vote,
  Education: GraduationCap,
  Corruption: Gavel,
  'Health Services': HeartPulse,
  'Agriculture & Farmers': Wheat,
  Electricity: Zap,
  'Water Supply': Droplets,
  'Roads & Transport': Route,
  'Employment & Jobs': Briefcase,
  'Housing & Land': Home,
  'Law & Order': Shield,
  'Pensions & Welfare': Wallet,
  Environment: Leaf,
  'Sanitation & Waste': Trash2,
};
const topicIcon = (t) => TOPIC_ICONS[t] || CircleDot;


/* ── evidence links ────────────────────────────────────────────────────── */
/**
 * Every figure on this page is a claim, so every figure links to the rows it
 * was counted from. The window is always carried, so the destination shows the
 * same period the brief measured.
 *
 * Only parameters the destination actually reads are emitted:
 *   /grievances           stance · topic · location · from · to
 *   /alerts               stance · risk · from · to
 *   /public-web-articles  stance · search · category · from · to
 */
const ymd = (d) => {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
};
const qs = (obj) => {
  const u = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') u.set(k, String(v));
  });
  const q = u.toString();
  return q ? `?${q}` : '';
};
/**
 * A recommendation carries where its evidence lives; this turns that into the
 * href, using only params the destination actually reads.
 */
const recLink = (link, links) => {
  if (!link) return '#';
  const { page, topic, stance, district } = link;
  if (page === 'district' && district) return links.district(district);
  if (page === 'articles') return links.articles(stance ? { stance } : {});
  if (page === 'alerts') return links.alerts(stance ? { stance } : {});
  const extra = {};
  if (topic) extra.topic = topic;
  if (stance) extra.stance = stance;
  return links.mentions(extra);
};

const makeLinks = (win) => {
  const from = ymd(win?.from);
  const to = ymd(win?.to);
  return {
    mentions: (extra = {}) => `/grievances${qs({ from, to, ...extra })}`,
    articles: (extra = {}) => `/public-web-articles${qs({ from, to, ...extra })}`,
    alerts: (extra = {}) => `/alerts${qs({ from, to, ...extra })}`,
    // A district figure combines news and social; only Geo Intel shows both.
    district: (name) => `/geographic-intelligence/${encodeURIComponent(name)}`,
  };
};

/* ── helpers ───────────────────────────────────────────────────────────── */
const n = (v) => (v ?? 0).toLocaleString('en-IN');
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const fmtDay = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const verdict = (net, confident) => {
  if (net === null || net === undefined) return 'No reading';
  if (!confident) return 'Low volume';
  if (net >= 40) return 'Mostly supportive';
  if (net >= 15) return 'Leaning supportive';
  if (net > -15) return 'Balanced';
  if (net > -40) return 'Leaning opposing';
  return 'Mostly opposing';
};
const verdictTone = (net, confident) => {
  if (net === null || net === undefined || !confident) return 'muted';
  if (net >= 15) return 'positive';
  if (net > -15) return 'neutral';
  return 'negative';
};
const netColor = (v) => (v === null || v === undefined ? INK.mute
  : v >= 15 ? POS : v > -15 ? NEU : NEG);

/* ── primitives ────────────────────────────────────────────────────────── */

const Card = ({ Icon, title, action, children, className = '' }) => (
  <section className={`bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col h-full ${className}`}>
    {(title || action) && (
      <header className="flex items-center justify-between gap-3 px-4 h-[48px] shrink-0 border-b border-slate-100">
        <h3 className="text-[13.5px] font-semibold text-slate-900 flex items-center gap-2 truncate">
          {Icon && <Icon className="h-4 w-4 text-slate-400 shrink-0" />}
          {title}
        </h3>
        {action}
      </header>
    )}
    <div className="p-4 flex-1 min-h-0">{children}</div>
  </section>
);

const ViewAll = ({ to }) => (
  <Link to={to} className="text-[12px] font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-0.5 shrink-0">
    View All <ChevronRight className="h-3.5 w-3.5" />
  </Link>
);

const Pill = ({ tone, children }) => {
  const map = {
    positive: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    neutral: 'bg-amber-50 text-amber-800 ring-amber-200',
    negative: 'bg-rose-50 text-rose-700 ring-rose-200',
    muted: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ring-1 whitespace-nowrap shrink-0 ${map[tone] || map.muted}`}>
      {children}
    </span>
  );
};
const STANCE_TONE = { pro: 'positive', neutral: 'neutral', anti: 'negative', unrelated: 'muted' };
const STANCE_WORD = { pro: 'Supportive', neutral: 'Neutral', anti: 'Opposing', unrelated: 'Unrelated' };
/**
 * The value the destination pages expect on ?stance= — lowercase
 * supportive | opposing | neutral, per lib/sentiment.js and Grievances.js.
 * The brief uses pro/anti internally, so the two are mapped explicitly rather
 * than passing the internal key through and silently filtering nothing.
 */
const STANCE_PARAM = { pro: 'supportive', neutral: 'neutral', anti: 'opposing' };

/**
 * Headline counter. The footer carries the source split, because the figure
 * above it is a total across streams and the reader needs to know what fed it.
 */
const Kpi = ({ label, value, share, footer, color, bg, Icon, to }) => {
  const Wrap = to ? Link : 'div';
  const wrapProps = to ? { to } : {};
  return (
  <Wrap {...wrapProps}
    className={`bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-3.5 flex flex-col h-full ${
      to ? 'hover:border-indigo-300 hover:shadow-[0_4px_12px_rgba(16,24,40,0.08)] transition-all group' : ''}`}>
    <div className="flex items-center justify-between gap-2">
      <span className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: bg }}>
        <Icon className="h-4 w-4" style={{ color }} />
      </span>
      <div className="text-[12px] font-medium truncate text-right" style={{ color }}>{label}</div>
    </div>
    <div className="flex items-baseline gap-1.5 mt-2.5">
      <span className="text-[26px] font-bold tracking-[-0.02em] text-slate-900 tabular-nums leading-none">
        {value}
      </span>
      {share !== undefined && share !== null && (
        <span className="text-[12px] text-slate-500 tabular-nums">({share}%)</span>
      )}
    </div>
    <div className="mt-auto pt-2.5 h-[24px] flex items-center gap-2 text-[11px] text-slate-500 truncate">
      {footer}
    </div>
  </Wrap>
  );
};

/** One stream's composition: icon, label, segmented bar, headline figure. */
/** Stance bar — counts always available, colour never alone. */
/**
 * Supportive against opposing. Neutral is not drawn: the brief reports who took
 * a side, and a bar segment for "no opinion" only shrinks the two that matter.
 */
const StanceBar = ({ pro, anti, compact = false, h = 8 }) => {
  const total = pro + anti;
  if (!total) return <div className="text-[11.5px] text-slate-400">Nobody has taken a side</div>;
  return (
    <div>
      <div className="flex rounded-full overflow-hidden bg-slate-100" style={{ gap: 2, height: h }}>
        {pro > 0 && <div style={{ width: `${pct(pro, total)}%`, background: POS }} />}
        {anti > 0 && <div style={{ width: `${pct(anti, total)}%`, background: NEG }} />}
      </div>
      {!compact && (
        <div className="mt-1.5 flex gap-3 text-[11px] text-slate-500">
          <span><span className="font-semibold tabular-nums" style={{ color: POS }}>{n(pro)}</span> supportive</span>
          <span><span className="font-semibold tabular-nums" style={{ color: NEG }}>{n(anti)}</span> opposing</span>
        </div>
      )}
    </div>
  );
};

/** A small supportive-vs-opposing pie with the share in the middle. */
const StancePie = ({ pro, anti, size = 124 }) => {
  const total = pro + anti;
  const data = [
    { name: 'Supportive', value: pro, c: POS },
    { name: 'Opposing', value: anti, c: NEG },
  ].filter((d) => d.value > 0);
  if (!total) {
    return (
      <div className="flex items-center justify-center text-[11.5px] text-slate-400"
        style={{ width: size, height: size }}>No side taken</div>
    );
  }
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
            innerRadius={size * 0.33} outerRadius={size * 0.5} paddingAngle={2}
            stroke="#fff" strokeWidth={2}>
            {data.map((d) => <Cell key={d.name} fill={d.c} />)}
          </Pie>
          {/* No tooltip: Recharts anchors it to the cursor, which sits over the
              centre label on a donut. The counts are listed beside the pie. */}
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[21px] font-bold tabular-nums leading-none"
          style={{ color: pro >= anti ? POS : NEG }}>{pct(pro, total)}%</span>
        <span className="text-[9.5px] text-slate-400 mt-0.5">supportive</span>
      </div>
    </div>
  );
};

/**
 * One stream, laid out exactly like the Chief Minister and party tiles above:
 * name and total on one line, then StanceBar — which already writes the counts
 * as "n supportive · n opposing" in the app's own vocabulary.
 * Cramming them into narrow columns was what forced the abbreviations.
 */
const SourceRow = ({ Icon, label, stream, to }) => {
  const Wrap = to ? Link : 'div';
  return (
    <Wrap {...(to ? { to } : {})}
      className={`block py-2 border-b border-slate-100 last:border-0 ${
        to ? 'hover:bg-slate-50/70 -mx-2 px-2 rounded transition-colors' : ''}`}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="flex items-center gap-2 text-[12px] font-medium text-slate-700">
          <Icon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          {label}
        </span>
        <span className="text-[12px] font-semibold text-slate-900 tabular-nums">
          {n(stream?.decisive)}
        </span>
      </div>
      {/* Bar and counts share a line, so a stream costs two rows, not three. */}
      <div className="flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <StanceBar pro={stream?.supportive || 0} anti={stream?.opposing || 0} compact h={6} />
        </div>
        <span className="text-[11px] whitespace-nowrap shrink-0">
          <span className="font-semibold tabular-nums" style={{ color: POS }}>
            {n(stream?.supportive)}
          </span>
          <span className="text-slate-400"> supportive</span>
          <span className="text-slate-300 mx-1.5">·</span>
          <span className="font-semibold tabular-nums" style={{ color: NEG }}>
            {n(stream?.opposing)}
          </span>
          <span className="text-slate-400"> opposing</span>
        </span>
      </div>
    </Wrap>
  );
};

/** Spotlight — the three questions asked first, with room to breathe. */
const Spotlight = ({ Icon, accent, eyebrow, title, pill, pillTone, figure, unit, children, footer }) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden flex flex-col h-full">
    <div className="h-1 w-full shrink-0" style={{ background: accent }} />
    <div className="p-4 flex flex-col flex-1">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `${accent}14` }}>
            <Icon className="h-[18px] w-[18px]" style={{ color: accent }} />
          </span>
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-400">{eyebrow}</div>
            <div className="text-[14px] font-semibold text-slate-900 truncate">{title}</div>
          </div>
        </div>
        {pill && <Pill tone={pillTone}>{pill}</Pill>}
      </div>
      <div className="flex items-baseline gap-2 mt-2.5">
        <span className="text-[26px] font-bold text-slate-900 tabular-nums leading-none">{figure}</span>
        <span className="text-[11.5px] text-slate-500 truncate">{unit}</span>
      </div>
      <div className="mt-2.5">{children}</div>
      {footer && (
        <div className="mt-2.5 pt-2 border-t border-slate-100 text-[11.5px] text-slate-500 truncate flex items-center gap-1.5">
          {footer}
        </div>
      )}
    </div>
  </div>
);


const DIRECTION = {
  improving: { Icon: TrendingUp, color: POS },
  worsening: { Icon: TrendingDown, color: NEG },
  stable: { Icon: Minus, color: INK.mute },
  unknown: { Icon: Minus, color: '#cbd5e1' },
};

/** Where zero sits in the chart, so the fill is green above and red below. */
const zeroOffset = (points) => {
  const vals = points.map((p) => p.net).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return 0.5;
  const max = Math.max(...vals, 0);
  const min = Math.min(...vals, 0);
  if (max <= 0) return 0;
  if (min >= 0) return 1;
  return max / (max - min);
};

const TrendTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-lg px-3 py-2">
      <div className="text-[11px] text-slate-500 mb-1">{d.label}</div>
      <div className="text-[15px] font-bold tabular-nums leading-none"
        style={{ color: d.net > 0 ? POS : d.net < 0 ? NEG : INK.mute }}>
        {d.net > 0 ? '+' : ''}{d.net}
      </div>
      <div className="mt-1.5 flex gap-2.5 text-[11px] text-slate-500">
        <span><span className="font-semibold" style={{ color: POS }}>{d.pro}</span> supportive</span>
        <span><span className="font-semibold" style={{ color: NEG }}>{d.anti}</span> opposing</span>
      </div>
    </div>
  );
};

/** Expanded panel: one diverging area chart. Shape answers the question. */
const IssueTrend = ({ track }) => {
  const points = (track.series || [])
    .filter((s) => s.net !== null && s.net !== undefined)
    .map((s) => ({
      label: `${fmtDay(s.start)} – ${fmtDay(s.end)}`,
      short: fmtDay(s.start),
      net: s.net, pro: s.pro, anti: s.anti,
    }));

  if (points.length < 2) {
    return (
      <div className="h-[168px] flex flex-col items-center justify-center text-center gap-1.5">
        <Info className="h-4 w-4 text-slate-300" />
        <span className="text-[12px] text-slate-400">Not enough history yet for this issue.</span>
      </div>
    );
  }
  const off = zeroOffset(points);
  const gid = `sp-${track.topic.replace(/[^a-zA-Z0-9]/g, '')}`;

  const has = (v) => v !== null && v !== undefined;
  const arrow = (a, b) => (
    <span className="tabular-nums">
      <span className="text-slate-400">{n(a)}</span>
      <span className="text-slate-300 mx-1">&rarr;</span>
      <span className="font-semibold text-slate-900">{n(b)}</span>
    </span>
  );

  return (
    <div>
      {/* One line of figures, not a block of boxes. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pb-3 text-[11.5px] text-slate-500">
        <span>Stance {has(track.early_net) && has(track.late_net)
          ? arrow(track.early_net, track.late_net)
          : <span className="text-slate-300">not enough</span>}</span>
        {has(track.movement) && (
          <span>Change{' '}
            <span className="font-semibold tabular-nums" style={{ color: netColor(track.movement) }}>
              {track.movement > 0 ? '+' : ''}{track.movement}
            </span>
          </span>
        )}
        <span>Our posts {arrow(track.our_posts_early, track.our_posts_late)}</span>
        <span>Opposition {arrow(track.opposition_posts_early, track.opposition_posts_late)}</span>
      </div>

      <div style={{ height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 6, right: 6, left: -26, bottom: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset={off} stopColor={POS} stopOpacity={0.28} />
                <stop offset={off} stopColor={NEG} stopOpacity={0.28} />
              </linearGradient>
              <linearGradient id={`${gid}-l`} x1="0" y1="0" x2="0" y2="1">
                <stop offset={off} stopColor={POS} stopOpacity={1} />
                <stop offset={off} stopColor={NEG} stopOpacity={1} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="short" tick={{ fill: INK.mute, fontSize: 10 }}
              axisLine={{ stroke: '#e2e8f0' }} tickLine={false} minTickGap={18} />
            <YAxis domain={[-100, 100]} ticks={[-100, 0, 100]}
              tick={{ fill: INK.mute, fontSize: 10 }} axisLine={false} tickLine={false} width={34} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
            <Tooltip content={<TrendTooltip />} />
            <Area type="monotone" dataKey="net" stroke={`url(#${gid}-l)`} strokeWidth={2.5}
              fill={`url(#${gid})`} dot={{ r: 2, strokeWidth: 0, fill: '#64748b' }} activeDot={{ r: 5 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

/** Compact tracker row — icon, name, bar, net, direction, expander. */
const IssueRow = ({ track, open, onToggle, evidenceHref }) => {
  const dir = DIRECTION[track.direction] || DIRECTION.unknown;
  const Icon = topicIcon(track.topic);
  const pro = track.series.reduce((a, s) => a + s.pro, 0);
  const neutral = track.series.reduce((a, s) => a + s.neutral, 0);
  const anti = track.series.reduce((a, s) => a + s.anti, 0);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button onClick={onToggle}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${open ? 'bg-slate-50' : 'hover:bg-slate-50/70'}`}>
        <span className="h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
          <Icon className="h-[15px] w-[15px] text-slate-500" />
        </span>
        <div className="w-[168px] shrink-0 min-w-0">
          <div className="text-[12.5px] font-medium text-slate-800 truncate leading-tight">{track.topic}</div>
          <div className="text-[10.5px] text-slate-400 tabular-nums">{n(track.total)} mentions</div>
        </div>
        <div className="flex-1 min-w-0">
          <StanceBar pro={pro} anti={anti} compact h={7} />
        </div>
        <span className="w-[46px] shrink-0 text-right text-[12.5px] font-semibold tabular-nums"
          style={{ color: netColor(track.confident ? track.net : null) }}>
          {track.net === null || track.net === undefined ? '—' : `${track.net > 0 ? '+' : ''}${track.net}`}
        </span>
        <dir.Icon className="h-4 w-4 shrink-0" style={{ color: dir.color }} />
        {evidenceHref && (
          <Link to={evidenceHref} onClick={(e) => e.stopPropagation()}
            title={`Open the ${track.total} mentions behind this`}
            className="shrink-0 text-slate-300 hover:text-indigo-600">
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 bg-slate-50/60 border-t border-slate-100">
          <IssueTrend track={track} />
        </div>
      )}
    </div>
  );
};

const Donut = ({ data, total, totalLabel, size = 140 }) => {
  const sum = total ?? data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius={size * 0.34} outerRadius={size * 0.48} paddingAngle={2}
              stroke="#fff" strokeWidth={2}>
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={(v, nm) => [`${n(v)} (${pct(v, sum)}%)`, nm]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[19px] font-bold text-slate-900 tabular-nums leading-none">{n(sum)}</div>
          <div className="text-[9.5px] text-slate-500 mt-1 text-center px-4 leading-tight">{totalLabel}</div>
        </div>
      </div>
      <ul className="flex-1 min-w-0 space-y-2">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2 text-[12px]">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="text-slate-600 truncate flex-1">{d.name}</span>
            <span className="font-semibold text-slate-900 tabular-nums">{n(d.value)}</span>
            <span className="text-slate-400 tabular-nums w-[32px] text-right">{pct(d.value, sum)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const MainTrendTip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-lg px-3 py-2">
      <div className="text-[11.5px] font-semibold text-slate-900 mb-1.5">{fmtDay(label)}</div>
      {payload.map((pl) => (
        <div key={pl.dataKey} className="flex items-center gap-2 text-[11.5px]">
          <span className="h-2 w-2 rounded-full" style={{ background: pl.color }} />
          <span className="text-slate-500">{pl.name}</span>
          <span className="ml-auto font-semibold text-slate-900 tabular-nums">{n(pl.value)}</span>
        </div>
      ))}
    </div>
  );
};

/* ── page ──────────────────────────────────────────────────────────────── */
export default function CMDashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(true);
  const [openIssue, setOpenIssue] = useState(null);
  // Same gate the sidebar uses, so a pill never offers a page the user
  // cannot open.
  const { hasAccess } = useRbac();

  const load = useCallback(() => {
    setBusy(true); setErr(null); setOpenIssue(null);
    api.get(`/cm-dashboard/brief?days=${days}`)
      .then((r) => setData(r.data))
      .catch((e) => setErr(e?.response?.data?.message || e.message))
      .finally(() => setBusy(false));
  }, [days]);
  useEffect(load, [load]);

  const c = data?.counts;
  const p = data?.principal;
  const party = data?.party;
  const h = data?.headline;
  const comb = data?.combined;
  const src = data?.by_source;
  // Built from the window the API reported, so a drill-down always lands on
  // exactly the period this page measured.
  const links = useMemo(() => makeLinks(data?.window), [data]);

  // The donut stays on social mentions only: an article's tone and a public
  // post's stance are different measurements, and the issue tracker below is
  // built from mentions alone. Mixing them here would not match it.
  const sentimentData = useMemo(() => ([
    { name: 'Supportive', value: c?.public?.pro || 0, color: POS },
    { name: 'Opposing', value: c?.public?.anti || 0, color: NEG },
  ]), [c]);
  const mentionsDecisive = (c?.public?.pro || 0) + (c?.public?.anti || 0);

  const voiceData = useMemo(() => {
    const v = data?.voice || {};
    return [
      { name: 'Public', value: v.organic || 0, color: VOICE_COLORS[0] },
      { name: 'Our accounts', value: v.owned || 0, color: VOICE_COLORS[1] },
      { name: 'Press', value: v.news || 0, color: VOICE_COLORS[2] },
      { name: 'Opposition', value: v.opposition || 0, color: VOICE_COLORS[3] },
    ];
  }, [data]);

  const tracking = useMemo(
    () => (data?.issue_tracking || []).filter((t) => t.total >= 10).slice(0, 8),
    [data],
  );

  const topLocations = useMemo(() => {
    const list = data?.districts || [];
    return [...list].sort((a, b) => (b.news + b.social) - (a.news + a.social)).slice(0, 6)
      .map((d) => ({ ...d, mentions: d.news + d.social }));
  }, [data]);
  const maxLocation = topLocations[0]?.mentions || 1;

  if (busy && !data) {
    return (
      <div className="h-full flex items-center justify-center bg-[#f6f7fb]">
        <div className="text-center">
          <RefreshCw className="h-6 w-6 text-indigo-500 animate-spin mx-auto mb-3" />
          <div className="text-[13px] text-slate-500">Loading your brief…</div>
        </div>
      </div>
    );
  }
  if (err) {
    return (
      <div className="h-full flex items-center justify-center bg-[#f6f7fb] p-6">
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center max-w-md">
          <AlertTriangle className="h-8 w-8 text-rose-500 mx-auto mb-3" />
          <div className="text-[15px] font-semibold text-slate-900 mb-1">Could not load the brief</div>
          <div className="text-[12.5px] text-slate-500 mb-4">{err}</div>
          <button onClick={load}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-[#f6f7fb]">
      <div className="p-5 lg:p-6 space-y-5 max-w-[1800px] mx-auto">

        {/* ── header ────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[23px] font-bold text-slate-900 tracking-[-0.02em]">Intelligence Brief</h1>
            <p className="text-[12.5px] text-slate-500 mt-0.5">
              Public pulse, press coverage and open issues across Telangana
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center bg-white rounded-lg border border-slate-200 p-0.5">
              {[7, 30, 90].map((dd) => (
                <button key={dd} onClick={() => setDays(dd)}
                  className={`px-3 py-1.5 text-[12.5px] font-medium rounded-md transition-colors tabular-nums ${
                    days === dd ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                  {dd}d
                </button>
              ))}
            </div>
            <button onClick={() => window.print()}
              className="flex items-center gap-2 px-3.5 py-2 bg-white rounded-lg border border-slate-200 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
              <Download className="h-4 w-4" /> Export
            </button>
          </div>
        </div>


        {/* ── A · SIGNALS (all three streams) ───────────────────────────── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5 items-stretch">
          <Kpi label="Took a side" value={n(comb?.total)} Icon={Megaphone} color="#2563eb" bg="#eff6ff"
            footer={`${n(src?.mentions?.decisive)} mentions · ${n(src?.articles?.decisive)} articles · ${n(src?.alerts?.decisive)} alerts`} />
          <Kpi label="Supportive" value={n(comb?.supportive)} share={pct(comb?.supportive, comb?.total)}
            Icon={Smile} color={POS} bg="#f0fdf4"
            footer={`${n(src?.mentions?.supportive)} mentions · ${n(src?.articles?.supportive)} articles · ${n(src?.alerts?.supportive)} alerts`} />
          <Kpi label="Opposing" value={n(comb?.opposing)} share={pct(comb?.opposing, comb?.total)}
            Icon={Frown} color={NEG} bg="#fef2f2"
            footer={`${n(src?.mentions?.opposing)} mentions · ${n(src?.articles?.opposing)} articles · ${n(src?.alerts?.opposing)} alerts`} />
          <Kpi label="Alerts" value={n(src?.alerts?.total)} Icon={Siren} color={RISK.critical} bg="#fef2f2"
            to={links.alerts()}
            footer={`${n(src?.alerts?.opposing)} opposing · ${n(src?.alerts?.supportive)} supportive`} />
        </div>

        {/* ── B · SPOTLIGHTS ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
          <Spotlight Icon={Landmark} accent="#2563eb" eyebrow="Chief Minister" title={p?.name || '—'}
            pill={verdict(p?.net, p?.confident)} pillTone={verdictTone(p?.net, p?.confident)}
            figure={n(p?.mentions)} unit="mentions naming him"
            footer={null}>
            {p?.mentions > 0
              ? (
                <>
                  <div className="flex items-center gap-4">
                    <StancePie pro={p.pro} anti={p.anti} />
                    <ul className="space-y-1.5 text-[12px] min-w-0 flex-1">
                      <li className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: POS }} />
                        <span className="text-slate-500">Supportive</span>
                        <span className="font-semibold text-slate-900 tabular-nums ml-auto">{n(p.pro)}</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: NEG }} />
                        <span className="text-slate-500">Opposing</span>
                        <span className="font-semibold text-slate-900 tabular-nums ml-auto">{n(p.anti)}</span>
                      </li>
                    </ul>
                  </div>

                </>
              )
              : <div className="text-[11.5px] text-slate-400">No mentions named him</div>}
          </Spotlight>

          <Spotlight Icon={Users} accent="#7c3aed" eyebrow="Your Party" title={party?.name || '—'}
            pill={verdict(party?.net, party?.confident)} pillTone={verdictTone(party?.net, party?.confident)}
            figure={n(party?.mentions)} unit="mentions naming the party"
            footer={null}>
            {party?.mentions > 0
              ? (
                <>
                  <div className="flex items-center gap-4">
                    <StancePie pro={party.pro} anti={party.anti} />
                    <ul className="space-y-1.5 text-[12px] min-w-0 flex-1">
                      <li className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: POS }} />
                        <span className="text-slate-500">Supportive</span>
                        <span className="font-semibold text-slate-900 tabular-nums ml-auto">{n(party.pro)}</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: NEG }} />
                        <span className="text-slate-500">Opposing</span>
                        <span className="font-semibold text-slate-900 tabular-nums ml-auto">{n(party.anti)}</span>
                      </li>
                    </ul>
                  </div>

                </>
              )
              : <div className="text-[11.5px] text-slate-400">No mentions named the party</div>}
          </Spotlight>

          <Spotlight Icon={Layers} accent="#0d9488" eyebrow="Stance by source"
            title="Supportive against opposing"
            figure={n(comb?.total)} unit="took a side"
            footer={null}>
            <div>
              <SourceRow Icon={MessageSquare} label="Mentions" stream={src?.mentions} to={links.mentions()} />
              <SourceRow Icon={Newspaper} label="Articles" stream={src?.articles} to={links.articles()} />
              <SourceRow Icon={Siren} label="Alerts" stream={src?.alerts} to={links.alerts()} />
            </div>
          </Spotlight>
        </div>

        {/* ── C · ISSUES + SHARE (8/4, so the width carries content) ────── */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          <div className="xl:col-span-8">
            <section className="bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
              <header className="flex items-center justify-between gap-3 px-4 h-[48px] border-b border-slate-100">
                <h3 className="text-[13.5px] font-semibold text-slate-900 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-slate-400" />
                  Issue Tracker
                </h3>
                <div className="flex items-center gap-4">
                  <span className="text-[11.5px] text-slate-400 hidden sm:inline">Open an issue to see its trend</span>
                  <ViewAll to="/grievances" />
                </div>
              </header>
              {tracking.map((t) => (
                <IssueRow key={t.topic} track={t} open={openIssue === t.topic}
                  evidenceHref={links.mentions({ topic: t.topic })}
                  onToggle={() => setOpenIssue(openIssue === t.topic ? null : t.topic)} />
              ))}
              {!tracking.length && (
                <div className="py-10 flex flex-col items-center gap-2 text-slate-400">
                  <Info className="h-5 w-5" />
                  <span className="text-[12.5px]">No issue yet carries enough mentions to track.</span>
                </div>
              )}
            </section>
          </div>

          <div className="xl:col-span-4 space-y-4">
            <Card Icon={PieIcon} title="Balance of opinion">
              <Donut data={sentimentData} total={mentionsDecisive} totalLabel="Took a side" size={140} />
            </Card>
            <Card Icon={Siren} title="Alerts" action={<ViewAll to="/alerts" />}>
              {/* Only figures the Alerts page can actually filter to, so every
                  tile opens exactly the rows it counted. That page filters on
                  `stance` and `risk`; it has no filter for legal sections,
                  policy breaches or triage status, so those are not shown here
                  as clickable claims. */}
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  [Siren, 'Opposing', src?.alerts?.opposing, NEG, links.alerts({ stance: 'opposing' })],
                  [Smile, 'Supportive', src?.alerts?.supportive, POS, links.alerts({ stance: 'supportive' })],
                  [Shield, 'High risk', src?.alerts?.risk?.high, RISK.high, links.alerts({ risk: 'high' })],
                  [Layers, 'All alerts', src?.alerts?.total, INK.mute, links.alerts()],
                ].map(([Ic, label, value, col, href]) => (
                  <Link key={label} to={href}
                    className="rounded-lg border border-slate-200 p-2.5 block hover:border-indigo-300 transition-colors">
                    <div className="flex items-center gap-1.5">
                      <Ic className="h-3.5 w-3.5 shrink-0" style={{ color: col }} />
                      <span className="text-[19px] font-bold tabular-nums leading-none" style={{ color: col }}>
                        {n(value)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-1.5">{label}</div>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </div>

        {/* ── D · TREND + VOICES ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
          <Card Icon={Activity} title="Sentiment Trend" className="xl:col-span-8">
            <div className="flex items-center gap-4 mb-2.5">
              {[[Smile, 'Supportive', POS], [Frown, 'Opposing', NEG]].map(([Ic, nm, col]) => (
                <span key={nm} className="flex items-center gap-1.5 text-[11.5px] text-slate-600">
                  <Ic className="h-3.5 w-3.5" style={{ color: col }} />{nm}
                </span>
              ))}
            </div>
            {(data?.trend || []).length > 1 ? (
              <div style={{ height: 216 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                    <CartesianGrid stroke="#eef2f7" vertical={false} />
                    <XAxis dataKey="d" tickFormatter={fmtDay} tick={{ fill: INK.mute, fontSize: 11 }}
                      axisLine={{ stroke: '#e2e8f0' }} tickLine={false} minTickGap={24} />
                    <YAxis tick={{ fill: INK.mute, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<MainTrendTip />} />
                    <Line type="monotone" dataKey="positive" name="Supportive" stroke={POS} strokeWidth={2}
                      dot={{ r: 2.5, fill: POS, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="negative" name="Opposing" stroke={NEG} strokeWidth={2}
                      dot={{ r: 2.5, fill: NEG, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[216px] flex flex-col items-center justify-center gap-2 text-slate-400">
                <Info className="h-5 w-5" />
                <span className="text-[12.5px]">Not enough days of data to draw a trend.</span>
              </div>
            )}
          </Card>

          <Card Icon={Users} title="Who Is Talking" className="xl:col-span-4">
            <Donut data={voiceData} totalLabel="Mentions collected" size={140} />
            <p className="mt-3 text-[11.5px] text-slate-500 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 text-slate-300 shrink-0 mt-px" />
              Only the public group feeds the sentiment figures.
            </p>
          </Card>
        </div>

        {/* ── E · DECISIONS, THEN PLACES ──────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
          <Card Icon={AlertTriangle} title="Needs Attention" className="xl:col-span-8"
            action={<span className="text-[11.5px] text-slate-400">
              {(data?.decisions || []).length} found
            </span>}>
            {/* Every recommendation, ranked by computed impact — not a fixed
                top four. The list scrolls rather than truncating, because what
                is cut is not necessarily what matters least. */}
            {/* Roughly two rows deep: the list still holds every
                recommendation, it just scrolls sooner so the band stays short. */}
            <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2 content-start max-h-[330px] overflow-y-auto -mr-1 pr-1">
              {(data?.decisions || []).map((d, i) => {
                const col = SEV[d.severity] || INK.mute;
                return (
                  <li key={`${d.headline}-${i}`} className="rounded-lg p-2.5"
                    style={{ background: `${col}0d`, borderLeft: `3px solid ${col}` }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[12px] font-semibold leading-snug" style={{ color: col }}>
                        {d.headline}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13px] font-bold tabular-nums leading-none" style={{ color: col }}>
                          {d.metric}
                        </div>
                        {d.unit && <div className="text-[9px] text-slate-400 mt-0.5">{d.unit}</div>}
                      </div>
                    </div>

                    {d.detail && (
                      <div className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">{d.detail}</div>
                    )}

                    {/* The words that actually recur in the criticism. */}
                    {!!d.themes?.length && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {d.themes.map((t) => (
                          <span key={t.term}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-white/70 text-slate-600 ring-1 ring-slate-200">
                            {t.term}
                            <span className="text-slate-400 tabular-nums"> {t.posts}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="text-[11px] text-slate-800 mt-1.5 leading-relaxed">
                      <span className="text-slate-400">Do: </span>{d.action}
                      {/* Say plainly which advice was written from the evidence
                          by the model and which is a standing template. */}
                      {d.action_source === 'model' && (
                        <span title="Written from the posts behind this finding"
                          className="ml-1.5 align-middle inline-flex items-center gap-0.5 px-1 rounded text-[9px] font-medium bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                          <Sparkles className="h-2.5 w-2.5" />AI
                        </span>
                      )}
                    </div>

                    {d.link && (
                      <Link to={recLink(d.link, links)}
                        className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-medium text-indigo-600 hover:underline">
                        See the evidence <ChevronRight className="h-3 w-3" />
                      </Link>
                    )}
                  </li>
                );
              })}
              {!(data?.decisions || []).length && (
                <li className="py-8 text-center text-[12px] text-slate-400">Nothing needs a decision.</li>
              )}
            </ul>
          </Card>

          <Card Icon={MapPin} title="Top Locations" className="xl:col-span-4" action={<ViewAll to="/geographic-intelligence" />}>
            <table className="w-full">
              <thead>
                <tr className="text-[10.5px] text-slate-400">
                  <th className="text-left pb-2 font-medium">District</th>
                  <th className="text-right pb-2 font-medium">Mentions</th>
                  <th className="text-right pb-2 font-medium">Adverse</th>
                </tr>
              </thead>
              <tbody>
                {topLocations.map((d) => (
                  <tr key={d.district} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="py-1.5 pr-3">
                      <Link to={links.district(d.district)}
                        className="text-[12px] text-slate-700 truncate hover:text-indigo-600 block">
                        {d.district}
                      </Link>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden max-w-[120px]">
                        <div className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${pct(d.mentions, maxLocation)}%` }} />
                      </div>
                    </td>
                    <td className="py-1.5 text-right text-[12px] font-semibold text-slate-900 tabular-nums align-top">
                      {n(d.mentions)}
                    </td>
                    <td className="py-1.5 text-right align-top">
                      <Pill tone={d.pressure >= 50 ? 'negative' : d.pressure >= 25 ? 'neutral' : 'positive'}>
                        {d.pressure}%
                      </Pill>
                    </td>
                  </tr>
                ))}
                {!topLocations.length && (
                  <tr><td colSpan={3} className="py-8 text-center text-[12px] text-slate-400">
                    No district above threshold.
                  </td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>

        {/* ── F · RECENT MENTIONS + COVERAGE ───────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
          <div className="xl:col-span-8">
          <div className="bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden h-full">
            <header className="flex items-center justify-between gap-3 px-4 h-[48px] border-b border-slate-100">
              <h3 className="text-[13.5px] font-semibold text-slate-900 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-slate-400" />
                Recent Mentions
              </h3>
              <ViewAll to="/grievances" />
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px]">
                <thead>
                  <tr className="text-[10.5px] font-medium text-slate-500 bg-slate-50 border-b border-slate-200">
                    <th className="text-left py-2 pl-4 pr-4">Mention</th>
                    <th className="text-left py-2 px-4 w-[142px]">Account</th>
                    <th className="text-left py-2 px-4 w-[168px]">Issue</th>
                    <th className="text-left py-2 px-4 w-[120px]">District</th>
                    <th className="text-left py-2 px-4 w-[104px]">Stance</th>
                    <th className="text-right py-2 px-4 pr-4 w-[80px]">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.recent_mentions || []).map((m) => {
                    const Ic = topicIcon(m.topic);
                    return (
                      <tr key={m.ref} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        <td className="py-2 pl-4 pr-4 max-w-[420px]">
                          {m.url ? (
                            <a href={m.url} target="_blank" rel="noreferrer"
                              className="text-[12px] text-slate-700 line-clamp-1 hover:text-indigo-600">
                              {m.text || '—'}
                            </a>
                          ) : (
                            <div className="text-[12px] text-slate-700 line-clamp-1">{m.text || '—'}</div>
                          )}
                        </td>
                        <td className="py-2 px-4 text-[11.5px] text-slate-500 truncate">
                          {m.handle ? (
                            <Link to={links.mentions({ handle: m.handle })}
                              className="hover:text-indigo-600">@{m.handle}</Link>
                          ) : (m.platform || '—')}
                        </td>
                        <td className="py-2 px-4">
                          <Link to={links.mentions({ topic: m.topic })}
                            className="flex items-center gap-1.5 text-[11.5px] text-slate-600 truncate hover:text-indigo-600">
                            <Ic className="h-3.5 w-3.5 text-slate-400 shrink-0" />{m.topic}
                          </Link>
                        </td>
                        <td className="py-2 px-4 text-[11.5px] text-slate-500 truncate">
                          {m.district ? (
                            <Link to={links.mentions({ location: m.district })}
                              className="hover:text-indigo-600">{m.district}</Link>
                          ) : '—'}
                        </td>
                        <td className="py-2 px-4">
                          <Link to={links.mentions({ stance: STANCE_PARAM[m.stance] })}>
                            <Pill tone={STANCE_TONE[m.stance]}>{STANCE_WORD[m.stance]}</Pill>
                          </Link>
                        </td>
                        <td className="py-2 px-4 pr-4 text-right text-[11px] text-slate-400 whitespace-nowrap">
                          {fmtDay(m.date)}
                        </td>
                      </tr>
                    );
                  })}
                  {!(data?.recent_mentions || []).length && (
                    <tr><td colSpan={6} className="py-10 text-center text-[12px] text-slate-400">
                      No mentions in this period.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </div>

          <Card Icon={Newspaper} title="Media Stance" className="xl:col-span-4"
            action={<ViewAll to="/public-web-articles" />}>
            {/* Outlets ranked by how they are covering us, most hostile first.
                Each row opens that outlet's opposing articles. */}
            <ul className="space-y-2.5">
              {(data?.narrative?.outlets || []).slice(0, 7).map((o) => {
                const scored = o.positive + o.neutral + o.negative;
                return (
                  <li key={o.outlet}>
                    <Link to={links.articles({ source: o.outlet, stance: 'opposing' })}
                      className="group block">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] text-slate-700 truncate group-hover:text-indigo-600">
                          {o.outlet}
                        </span>
                        <span className="text-[12px] font-semibold tabular-nums shrink-0"
                          style={{ color: netColor(o.net) }}>
                          {o.net > 0 ? '+' : ''}{o.net}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <StanceBar pro={o.positive} anti={o.negative} compact h={5} />
                        </div>
                        <span className="text-[10.5px] text-slate-400 tabular-nums shrink-0">
                          {o.negative} of {scored}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
              {!(data?.narrative?.outlets || []).length && (
                <li className="py-8 text-center text-[12px] text-slate-400">
                  No outlet has enough scored coverage yet.
                </li>
              )}
            </ul>
          </Card>
        </div>

        {/* ── G · PLATFORM ──────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between gap-3 px-1 mb-3">
            <h3 className="text-[13.5px] font-semibold text-slate-900 flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4 text-slate-400" />
              Explore the Platform
            </h3>
          </div>
          {/* The sidebar's own list, filtered by the same permission check, with
              this page itself left out. Nothing about module health: that is an
              operations question, not something a Chief Minister acts on. */}
          <div className="flex flex-wrap gap-2">
            {APP_NAVIGATION
              .filter((item) => item.href !== '/cm-dashboard' && hasAccess(item.href))
              .map(({ name, href, icon: Icon, colour }) => (
                <Link key={href} to={href}
                  className="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full text-[12px] font-medium transition-colors"
                  style={{ background: `${colour}14`, color: colour }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `${colour}26`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = `${colour}14`; }}>
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {name}
                </Link>
              ))}
          </div>
        </div>

        {/* One line. The methodology matters, but it is a caveat, not a briefing. */}
        <p className="text-[11px] text-slate-400 pb-2 flex items-center gap-1.5"
          title={`Our own accounts (${n(data?.voice?.owned)}), the press (${n(data?.voice?.news)}) and opposition handles (${n(data?.voice?.opposition)}) are counted separately. Anything under ${data?.min_confident} mentions is marked low volume and not trended.`}>
          <Info className="h-3.5 w-3.5 shrink-0 text-slate-300" />
          Public voice only — our own accounts, the press and opposition handles are counted separately.
        </p>
      </div>
    </div>
  );
}
