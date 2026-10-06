import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  Crown, Trophy, Hash, MessageSquare, TrendingUp, Users2, Gavel, Vote, Sparkles, Minus,
} from 'lucide-react';
import { partyColor, fmtShort, fmtNum, useCountUp, titleCase } from './compareUtils';

/* ── shared section wrapper ────────────────────────────────────────── */
const Section = ({ icon: Icon, title, children, delay = 0 }) => (
  <motion.section
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, delay }}
    className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"
  >
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50/70">
      <Icon className="h-4 w-4 text-slate-500" />
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">{title}</h3>
    </div>
    <div className="p-4">{children}</div>
  </motion.section>
);

/* Format a metric value for display. */
const fmtMetric = (m, v) => {
  if (v == null) return '—';
  if (m.key === 'reach' || m.key === 'total') return fmtShort(v);
  const rounded = Math.round(v);
  if (m.unit === '/100') return `${rounded}/100`;
  if (m.unit === '%') return `${rounded}%`;
  return String(m.unit ? `${rounded}${m.unit}` : rounded);
};

/* ── signature: centre-anchored mirrored metric bars ───────────────── */
const MirrorRow = ({ metric, colorA, colorB }) => {
  const a = metric.a;
  const b = metric.b;
  const maxAbs = Math.max(Math.abs(a || 0), Math.abs(b || 0)) || 1;
  const pctA = Math.round((Math.abs(a || 0) / maxAbs) * 100);
  const pctB = Math.round((Math.abs(b || 0) / maxAbs) * 100);
  const aWin = metric.winner === 'a';
  const bWin = metric.winner === 'b';

  const dispA = useCountUp(a || 0, { duration: 950 });
  const dispB = useCountUp(b || 0, { duration: 950 });

  const barStyle = (win, c) => ({
    background: c.main,
    opacity: win ? 1 : 0.32,
    boxShadow: win ? `0 0 14px ${c.main}66` : 'none',
  });

  return (
    <div className="py-2">
      <div className="grid grid-cols-[70px_1fr_70px] items-center gap-2">
        <div className="flex items-center justify-end gap-1">
          {aWin && <Crown className="h-3.5 w-3.5" style={{ color: colorA.main }} />}
          <span className="text-sm font-extrabold tabular-nums" style={{ color: aWin ? colorA.main : '#94a3b8' }}>
            {fmtMetric(metric, dispA)}
          </span>
        </div>

        <div>
          <div className="text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
            {metric.label}
          </div>
          <div className="flex items-center h-3">
            <div className="flex-1 flex justify-end">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pctA}%` }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
                className="h-3 rounded-l-full"
                style={barStyle(aWin, colorA)}
              />
            </div>
            <div className="w-px h-4 bg-slate-300 shrink-0" />
            <div className="flex-1">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pctB}%` }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
                className="h-3 rounded-r-full"
                style={barStyle(bWin, colorB)}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-start gap-1">
          <span className="text-sm font-extrabold tabular-nums" style={{ color: bWin ? colorB.main : '#94a3b8' }}>
            {fmtMetric(metric, dispB)}
          </span>
          {bWin && <Crown className="h-3.5 w-3.5" style={{ color: colorB.main }} />}
        </div>
      </div>
    </div>
  );
};

/* ── small sentiment donut ─────────────────────────────────────────── */
const Donut = ({ pct, color, label }) => {
  const g = `conic-gradient(${color} 0% ${pct}%, #f1f5f9 ${pct}% 100%)`;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-14 h-14">
        <div className="w-14 h-14 rounded-full" style={{ background: g }} />
        <div className="absolute inset-2 rounded-full bg-white flex items-center justify-center text-[11px] font-bold" style={{ color }}>
          {pct}%
        </div>
      </div>
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
};

/* ── paired stat tile ──────────────────────────────────────────────── */
const VsTile = ({ label, a, b, better = 'higher', colorA, colorB, fmt = (x) => x, icon: Icon }) => {
  const av = Number(a);
  const bv = Number(b);
  const valid = Number.isFinite(av) && Number.isFinite(bv);
  const aWin = valid && av !== bv && (better === 'higher' ? av > bv : av < bv);
  const bWin = valid && av !== bv && (better === 'higher' ? bv > av : bv < av);
  const da = useCountUp(Number.isFinite(av) ? av : 0);
  const db = useCountUp(Number.isFinite(bv) ? bv : 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-extrabold tabular-nums" style={{ color: aWin ? colorA.main : '#64748b' }}>
          {a == null ? '—' : fmt(Math.round(da))}
        </span>
        <span className="text-[10px] text-slate-300 font-bold">VS</span>
        <span className="text-lg font-extrabold tabular-nums" style={{ color: bWin ? colorB.main : '#64748b' }}>
          {b == null ? '—' : fmt(Math.round(db))}
        </span>
      </div>
    </div>
  );
};

/* ── verdict banner ────────────────────────────────────────────────── */
const VerdictStrip = ({ data, nameA, nameB, colorA, colorB }) => {
  const { verdict, head_to_head } = data;
  const aWins = verdict.a_wins;
  const bWins = verdict.b_wins;
  const total = Math.max(aWins + bWins, 1);
  const leader = verdict.overall === 'a' ? nameA : verdict.overall === 'b' ? nameB : null;
  const leaderColor = verdict.overall === 'a' ? colorA : verdict.overall === 'b' ? colorB : null;

  // Build a plain-language lead/trail summary from the metrics that count.
  const you = verdict.overall === 'a' ? 'a' : 'b';
  const scored = head_to_head.filter((m) => m.counts_toward_verdict);
  const leadsOn = scored.filter((m) => m.winner === you).map((m) => m.label).slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45 }}
      className="rounded-2xl p-4 text-white shadow-md relative overflow-hidden"
      style={{ background: leaderColor ? `linear-gradient(120deg, ${leaderColor.main}, ${leaderColor.text})` : 'linear-gradient(120deg, #475569, #1e293b)' }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            {leader ? <Trophy className="h-6 w-6" /> : <Minus className="h-6 w-6" />}
          </div>
          <div>
            <div className="text-lg font-extrabold leading-tight">
              {leader ? `${leader} leads` : 'Neck and neck'}
            </div>
            <div className="text-[12px] text-white/80">
              {leadsOn.length
                ? `Ahead on ${leadsOn.join(', ')}`
                : 'Both candidates are evenly matched across key metrics'}
            </div>
          </div>
        </div>
        {/* tug-of-war score bar */}
        <div className="flex items-center gap-2 min-w-[180px]">
          <span className="text-sm font-extrabold tabular-nums">{aWins}</span>
          <div className="flex-1 h-2.5 rounded-full bg-white/25 overflow-hidden flex">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(aWins / total) * 100}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full"
              style={{ background: colorA.main }}
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(bWins / total) * 100}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full"
              style={{ background: colorB.main }}
            />
          </div>
          <span className="text-sm font-extrabold tabular-nums">{bWins}</span>
        </div>
      </div>
    </motion.div>
  );
};

const mergeTrend = (ta = [], tb = []) => {
  const map = new Map();
  for (const d of ta) map.set(d.date, { date: d.date, a: d.count, b: 0 });
  for (const d of tb) {
    const e = map.get(d.date) || { date: d.date, a: 0, b: 0 };
    e.b = d.count;
    map.set(d.date, e);
  }
  return [...map.values()]
    .sort((x, y) => x.date.localeCompare(y.date))
    .map((d) => ({ ...d, label: d.date.slice(5) }));
};

const ComparisonView = ({ data }) => {
  const a = data.a;
  const b = data.b;
  const nameA = a.mla.name || titleCase(a.constituency);
  const nameB = b.mla.name || titleCase(b.constituency);
  const colorA = partyColor(a.mla.party);
  let colorB = partyColor(b.mla.party);
  // Same party? nudge B toward its lighter ring tone so the two sides stay
  // visually distinct instead of collapsing into one colour.
  if (colorB.main === colorA.main) colorB = { ...colorB, main: '#6366f1', text: '#3730a3' };

  const trend = useMemo(() => mergeTrend(a.volume_trend, b.volume_trend), [a, b]);

  // Platform union for paired bars.
  const platforms = useMemo(() => {
    const keys = new Map();
    for (const p of a.platforms || []) keys.set(p.platform, p.label);
    for (const p of b.platforms || []) keys.set(p.platform, p.label);
    const pctA = Object.fromEntries((a.platforms || []).map((p) => [p.platform, p.pct]));
    const pctB = Object.fromEntries((b.platforms || []).map((p) => [p.platform, p.pct]));
    return [...keys.entries()].map(([k, label]) => ({ platform: k, label, a: pctA[k] || 0, b: pctB[k] || 0 }))
      .sort((x, y) => (y.a + y.b) - (x.a + x.b))
      .slice(0, 5);
  }, [a, b]);

  const issuesA = (a.top_issues || []).slice(0, 6);
  const issuesB = (b.top_issues || []).slice(0, 6);
  const sharedIssues = new Set(issuesA.map((i) => i.issue).filter((i) => issuesB.some((j) => j.issue === i)));

  return (
    <div className="space-y-4">
      <VerdictStrip data={data} nameA={nameA} nameB={nameB} colorA={colorA} colorB={colorB} />

      {/* Signature head-to-head mirror bars */}
      <Section icon={Trophy} title="Head-to-Head Metrics" delay={0.05}>
        <div className="flex items-center justify-between px-[70px] mb-2">
          <span className="text-xs font-bold" style={{ color: colorA.main }}>{nameA}</span>
          <span className="text-xs font-bold" style={{ color: colorB.main }}>{nameB}</span>
        </div>
        <div className="divide-y divide-slate-100">
          {data.head_to_head
            .filter((m) => m.a != null || m.b != null)
            .map((m) => (
              <MirrorRow key={m.key} metric={m} colorA={colorA} colorB={colorB} />
            ))}
        </div>
      </Section>

      {/* Sentiment split donuts */}
      <Section icon={MessageSquare} title="Public Sentiment Split" delay={0.1}>
        <div className="grid grid-cols-2 gap-4">
          {[{ seat: a, name: nameA, c: colorA }, { seat: b, name: nameB, c: colorB }].map((side, idx) => (
            <div key={idx} className="rounded-xl border border-slate-100 p-3">
              <div className="text-xs font-bold text-center mb-3 truncate" style={{ color: side.c.main }}>{side.name}</div>
              <div className="flex items-center justify-around">
                <Donut pct={side.seat.sentiment.positive_pct} color="#22c55e" label="Positive" />
                <Donut pct={side.seat.sentiment.negative_pct} color="#ef4444" label="Negative" />
                <Donut pct={side.seat.sentiment.neutral_pct} color="#94a3b8" label="Neutral" />
              </div>
              <div className="text-center text-[11px] text-slate-400 mt-2">
                {fmtNum(side.seat.sentiment.total)} mentions analysed
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Top issues side by side */}
      <Section icon={TrendingUp} title="Top Public Issues" delay={0.15}>
        <div className="grid grid-cols-2 gap-4">
          {[{ list: issuesA, name: nameA, c: colorA }, { list: issuesB, name: nameB, c: colorB }].map((side, idx) => (
            <div key={idx}>
              <div className="text-xs font-bold mb-2 truncate" style={{ color: side.c.main }}>{side.name}</div>
              {side.list.length === 0 ? (
                <div className="text-[11px] text-slate-400 py-4 text-center">No issues detected in window.</div>
              ) : (
                <div className="space-y-1.5">
                  {side.list.map((it) => {
                    const shared = sharedIssues.has(it.issue);
                    return (
                      <div key={it.issue} className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${shared ? 'bg-indigo-50 border border-indigo-100' : 'bg-slate-50'}`}>
                        <span className="text-[11px] font-medium text-slate-700 capitalize flex-1 truncate">
                          {it.issue.replace(/_/g, ' ')}
                          {shared && <span className="ml-1 text-[9px] text-indigo-500 font-bold">· shared</span>}
                        </span>
                        <span className="text-[11px] font-bold text-slate-500">{it.count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Social narrative — dual volume trend + platform mix */}
      <Section icon={Sparkles} title="Social Narrative" delay={0.2}>
        <div className="text-[11px] font-semibold text-slate-500 mb-2">Conversation Volume Trend</div>
        {trend.length === 0 ? (
          <div className="text-[11px] text-slate-400 py-8 text-center">No conversation volume in this window.</div>
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 5, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <RTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="a" name={nameA} stroke={colorA.main} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="b" name={nameB} stroke={colorB.main} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="text-[11px] font-semibold text-slate-500 mt-4 mb-2">Platform Mix</div>
        <div className="space-y-2">
          {platforms.length === 0 ? (
            <div className="text-[11px] text-slate-400 py-2 text-center">No platform data.</div>
          ) : platforms.map((p) => (
            <div key={p.platform} className="grid grid-cols-[1fr_88px_1fr] items-center gap-2">
              <div className="flex items-center justify-end gap-2">
                <span className="text-[10px] font-bold tabular-nums text-slate-500">{p.a}%</span>
                <div className="w-full max-w-[140px] h-2 bg-slate-100 rounded-full overflow-hidden flex justify-end">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${p.a}%` }} transition={{ duration: 0.7 }} className="h-full rounded-full" style={{ background: colorA.main }} />
                </div>
              </div>
              <span className="text-[10px] text-slate-500 text-center truncate">{p.label}</span>
              <div className="flex items-center gap-2">
                <div className="w-full max-w-[140px] h-2 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${p.b}%` }} transition={{ duration: 0.7 }} className="h-full rounded-full" style={{ background: colorB.main }} />
                </div>
                <span className="text-[10px] font-bold tabular-nums text-slate-500">{p.b}%</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Record & reach tiles */}
      <Section icon={Vote} title="Record, Reach & Last Election Result" delay={0.25}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <VsTile label="Conversation Volume" icon={MessageSquare} a={a.sentiment.total} b={b.sentiment.total} better="higher" colorA={colorA} colorB={colorB} fmt={fmtShort} />
          <VsTile label="Total Reach" icon={Users2} a={a.sentiment.reach} b={b.sentiment.reach} better="higher" colorA={colorA} colorB={colorB} fmt={fmtShort} />
          <VsTile label="High-Priority Grievances" icon={TrendingUp} a={a.sentiment.high_priority} b={b.sentiment.high_priority} better="lower" colorA={colorA} colorB={colorB} fmt={fmtNum} />
          <VsTile label="Criminal Cases" icon={Gavel} a={a.mla.criminalCases} b={b.mla.criminalCases} better="lower" colorA={colorA} colorB={colorB} fmt={fmtNum} />
          <VsTile label={`${a.voter?.election_year || b.voter?.election_year || 'Last'} Vote Share`} icon={Vote} a={a.voter?.vote_share_latest} b={b.voter?.vote_share_latest} better="higher" colorA={colorA} colorB={colorB} fmt={(x) => `${x}%`} />
          <VsTile label={`${a.voter?.election_year || b.voter?.election_year || 'Last'} Win Margin`} icon={Trophy} a={a.voter?.margin_latest} b={b.voter?.margin_latest} better="higher" colorA={colorA} colorB={colorB} fmt={fmtShort} />
        </div>
      </Section>

      {/* Trending hashtags */}
      {(a.trending_hashtags?.length > 0 || b.trending_hashtags?.length > 0) && (
        <Section icon={Hash} title="Trending Hashtags" delay={0.3}>
          <div className="grid grid-cols-2 gap-4">
            {[{ list: a.trending_hashtags, name: nameA, c: colorA }, { list: b.trending_hashtags, name: nameB, c: colorB }].map((side, idx) => (
              <div key={idx}>
                <div className="text-xs font-bold mb-2 truncate" style={{ color: side.c.main }}>{side.name}</div>
                <div className="flex flex-wrap gap-1.5">
                  {(side.list || []).length === 0 ? (
                    <span className="text-[11px] text-slate-400">No hashtags.</span>
                  ) : side.list.map((t) => (
                    <span key={t.name} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: side.c.soft, color: side.c.text }}>
                      {t.name} <span className="opacity-60">{t.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="text-[10px] text-slate-400 text-center pb-2">
        All figures aggregated live from ingested & geo-tagged social mentions and verified ECI 2023 Telangana assembly records · {data.window_days}-day window.
      </div>
    </div>
  );
};

export default ComparisonView;
