import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  Loader2, TrendingUp, TrendingDown, Hash, Users2, Sparkles, MessageSquare,
  Twitter, Facebook, Youtube, Instagram, Newspaper, BadgeCheck, Info, ArrowRight,
} from 'lucide-react';
import { Card } from './ui/card';
import api from '../lib/api';
import ConstituencyHeatMap from './ConstituencyHeatMap';

const fmtNum = (n) => (n || n === 0) ? Number(n).toLocaleString('en-IN') : '—';
const fmtShort = (n) => {
  if (n == null) return '—';
  const v = Number(n);
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
};

const PLATFORM_ICON = {
  x: Twitter, twitter: Twitter, facebook: Facebook, youtube: Youtube,
  instagram: Instagram, whatsapp: MessageSquare, unknown: Newspaper,
};
const PLATFORM_COLOR = {
  x: '#0f172a', twitter: '#0f172a', facebook: '#2563eb', youtube: '#dc2626',
  instagram: '#db2777', whatsapp: '#16a34a', unknown: '#64748b',
};

const PanelCard = ({ icon: Icon, title, badge, children, className = '', href }) => {
  const cardContent = (
    <>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
        <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
          <Icon className="h-3.5 w-3.5 text-slate-500" /> {title}
        </h3>
        {badge}
      </div>
      <div className="p-4 flex-1 flex flex-col">{children}</div>
    </>
  );

  if (href) {
    return (
      <Card className={`border-slate-200 overflow-hidden flex flex-col transition-all duration-200 hover:shadow-md hover:border-slate-300 cursor-pointer ${className}`}>
        <Link to={href} className="flex flex-col flex-1 h-full">
          {cardContent}
        </Link>
      </Card>
    );
  }

  return (
    <Card className={`border-slate-200 overflow-hidden flex flex-col transition-shadow duration-200 hover:shadow-md ${className}`}>
      {cardContent}
    </Card>
  );
};

const Empty = ({ children }) => (
  <div className="flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>{children}</span>
  </div>
);

/* Sentiment donut (single value). */
const SentimentDonut = ({ label, pct, color, constituency }) => {
  const gradient = `conic-gradient(${color} 0% ${pct}%, #f1f5f9 ${pct}% 100%)`;
  // Same 365-day window as the Statewide MLA Sentiment leaderboard.
  const windowStart = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  return (
    <Link
      to={`/grievances?leader=${encodeURIComponent(constituency)}&sentiment=${label.toLowerCase()}&from=${encodeURIComponent(windowStart)}`}
      className="flex flex-col items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer"
    >
      <div className="relative w-20 h-20">
        <div className="w-20 h-20 rounded-full" style={{ background: gradient }} />
        <div className="absolute inset-2.5 rounded-full bg-white flex items-center justify-center">
          <span className="text-base font-bold" style={{ color }}>{pct}%</span>
        </div>
      </div>
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
    </Link>
  );
};

const getGrievancePlatform = (pName) => {
  const p = String(pName).toLowerCase();
  if (p === 'twitter' || p === 'x') return 'x';
  if (p === 'facebook') return 'facebook';
  if (p === 'instagram') return 'instagram';
  if (p === 'youtube') return 'youtube';
  return 'all';
};

const SocialNarrativePanel = ({ constituency, dense = false, sectionNumber }) => {
  const navigate = useNavigate();
  // Same 365-day window as the Statewide MLA Sentiment leaderboard.
  const windowStart = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await api.get(`/constituency-intel/${encodeURIComponent(constituency)}/narrative`, { params: { days: 365, basis: 'leader' } });
        if (!cancelled) setData(res.data || null);
      } catch (_e) {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [constituency]);

  if (loading) {
    return <div className="h-64 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  }
  if (!data) {
    return <Empty>Could not load narrative intelligence for this constituency.</Empty>;
  }

  const s = data.sentiment || {};
  const hasData = (s.total || 0) > 0;
  const trend = (data.volume_trend || []).map((d) => ({ date: d.date.slice(5), fullDate: d.date, count: d.count }));

  const handleChartClick = (state) => {
    if (state && state.activePayload && state.activePayload.length > 0) {
      const clickedData = state.activePayload[0].payload;
      const clickedDate = clickedData.fullDate;
      const params = [
        `leader=${encodeURIComponent(constituency)}`,
        `from=${encodeURIComponent(clickedDate)}`,
        `to=${encodeURIComponent(clickedDate)}`
      ];
      navigate(`/grievances?${params.join('&')}`);
    }
  };
  const maxInfluencerFollowers = (data.top_influencers || []).reduce((m, i) => Math.max(m, i.followers), 0) || 1;
  const topics = data.trending_hashtags?.length ? data.trending_hashtags : data.top_topics || [];
  const maxPlatform = (data.platforms || []).reduce((m, p) => Math.max(m, p.pct), 0) || 100;

  // Dense (split-column) mode keeps the multi-card grid via md: breakpoints so
  // the cards render across within each half at xl+ (matching the reference).
  const grid3 = dense ? 'grid grid-cols-1 md:grid-cols-3 gap-3' : 'grid grid-cols-1 lg:grid-cols-3 gap-4';
  const span2 = dense ? 'md:col-span-2' : 'lg:col-span-2';

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Banner */}
      <div className="rounded-xl bg-white border border-slate-200 px-5 py-3 flex items-center justify-between flex-wrap gap-2 shadow-sm">
        <div className="flex items-center gap-3">
          {sectionNumber != null && (
            <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold shrink-0">{sectionNumber}</div>
          )}
          <div>
            <div className="text-sm font-bold text-slate-800">Social Media Narrative Intelligence</div>
            <div className="text-[11px] text-slate-500">Listen to people. Decode narratives. Stay ahead.</div>
          </div>
        </div>
        <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
          <Info className="h-3 w-3" /> Live · social monitoring · 365 days
        </div>
      </div>

      {!hasData && (
        <Empty>
          No posts tagging or naming this MLA, or naming this constituency, in the last 365 days yet.
          Panels populate automatically as the monitoring pipeline ingests and analyses posts.
        </Empty>
      )}

      {/* Row 1 — Sentiment overview + score */}
      <div className={grid3}>
        <PanelCard icon={MessageSquare} title="Sentiment Overview (All Platforms)" className={span2}>
          <div className="flex items-center justify-around gap-2 flex-wrap">
            <SentimentDonut label="Positive" pct={s.positive_pct || 0} color="#22c55e" constituency={constituency} />
            <SentimentDonut label="Negative" pct={s.negative_pct || 0} color="#ef4444" constituency={constituency} />
            <SentimentDonut label="Neutral" pct={s.neutral_pct || 0} color="#94a3b8" constituency={constituency} />
          </div>
        </PanelCard>
        <PanelCard icon={Sparkles} title="Overall Sentiment Score">
          <div className="flex flex-col items-center justify-center h-full py-2">
            <div className="text-5xl font-bold text-slate-800 leading-none">{s.score ?? '—'}<span className="text-lg text-slate-400">/100</span></div>
            {s.score_change != null && s.score_change !== 0 && (
              <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${s.score_change > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {s.score_change > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {Math.abs(s.score_change)} pts vs prev 365d
              </div>
            )}
            <div className="text-[10px] text-slate-400 mt-1">{fmtNum(s.total)} mentions analysed</div>
          </div>
        </PanelCard>
      </div>

      {/* Row 2 — Volume trend + platforms */}
      <div className={grid3}>
        <PanelCard icon={TrendingUp} title="Conversation Volume Trend" className={span2}>
          {trend.length === 0 ? <Empty>No conversation volume in this window.</Empty> : (
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 5, right: 10, left: -18, bottom: 0 }} onClick={handleChartClick} className="cursor-pointer">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={20} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <RTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }} />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#7c3aed"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#7c3aed', cursor: 'pointer' }}
                    activeDot={{
                      r: 5,
                      fill: '#5b21b6',
                      cursor: 'pointer',
                      onClick: (event, payload) => {
                        if (payload && payload.payload && payload.payload.fullDate) {
                          const d = payload.payload.fullDate;
                          navigate(`/grievances?leader=${encodeURIComponent(constituency)}&from=${encodeURIComponent(d)}&to=${encodeURIComponent(d)}`);
                        }
                      }
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </PanelCard>

        <PanelCard icon={Hash} title="Top Platforms">
          {(data.platforms || []).length === 0 ? <Empty>No platform data.</Empty> : (
            <div className="space-y-2.5">
              {data.platforms.map((p) => {
                const Icon = PLATFORM_ICON[p.platform] || Newspaper;
                const color = PLATFORM_COLOR[p.platform] || '#64748b';
                return (
                  <Link
                    key={p.platform}
                    to={`/grievances?leader=${encodeURIComponent(constituency)}&platform=${getGrievancePlatform(p.platform)}&from=${encodeURIComponent(windowStart)}`}
                    className="flex items-center gap-2 w-full hover:bg-slate-50 rounded px-1 -mx-1 py-0.5 transition-colors cursor-pointer"
                  >
                    <Icon className="h-4 w-4 shrink-0" style={{ color }} />
                    <span className="text-[11px] text-slate-600 w-24 shrink-0 truncate" title={p.label}>{p.label}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(p.pct / maxPlatform) * 100}%`, background: color }} />
                    </div>
                    <span className="text-[11px] font-bold text-slate-700 w-8 text-right">{p.pct}%</span>
                  </Link>
                );
              })}
            </div>
          )}
        </PanelCard>
      </div>

      {/* Row 3 — Trending topics + narratives + influencers */}
      <div className={grid3}>
        <PanelCard icon={Hash} title="Top Trending Topics">
          {topics.length === 0 ? <Empty>No trending topics/hashtags detected yet.</Empty> : (
            <div className="space-y-1.5">
              {topics.map((t, i) => (
                <Link
                  key={t.name}
                  to={`/grievances?leader=${encodeURIComponent(constituency)}&search=${encodeURIComponent(t.name)}&from=${encodeURIComponent(windowStart)}`}
                  className="flex items-center gap-2 w-full hover:bg-slate-50 rounded px-1 -mx-1 py-0.5 transition-colors cursor-pointer"
                >
                  <span className="text-[11px] font-bold text-slate-400 w-4">{i + 1}</span>
                  <span className="text-[11px] text-violet-700 font-medium flex-1 truncate">{t.name}</span>
                  <span className="text-[10px] text-slate-500 font-semibold">{fmtShort(t.count)}</span>
                </Link>
              ))}
            </div>
          )}
        </PanelCard>

        <PanelCard icon={MessageSquare} title="Top Narratives">
          {(!data.narratives || (!data.narratives.positive && !data.narratives.negative && !data.narratives.neutral)) ? (
            <Empty>No narrative themes detected yet.</Empty>
          ) : (
            <div className="space-y-2.5">
              {[
                { key: 'positive', color: '#22c55e', bg: '#f0fdf4', label: 'Positive' },
                { key: 'negative', color: '#ef4444', bg: '#fef2f2', label: 'Negative' },
                { key: 'neutral', color: '#94a3b8', bg: '#f8fafc', label: 'Neutral' },
              ].map((n) => {
                const item = data.narratives[n.key];
                if (!item) return null;
                return (
                  <Link
                    key={n.key}
                    to={`/grievances?leader=${encodeURIComponent(constituency)}&sentiment=${n.key}&from=${encodeURIComponent(windowStart)}`}
                    className="block rounded-lg px-3 py-2 hover:opacity-85 transition-opacity cursor-pointer"
                    style={{ background: n.bg }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold" style={{ color: n.color }}>{n.label}</span>
                      <span className="text-[10px] text-slate-500">{item.count} mentions</span>
                    </div>
                    <div className="text-[11px] text-slate-700 capitalize mt-0.5">{String(item.name).replace(/_/g, ' ')}</div>
                  </Link>
                );
              })}
            </div>
          )}
        </PanelCard>

        <PanelCard icon={Users2} title="Top Influencers">
          {(data.top_influencers || []).length === 0 ? <Empty>No influencer data for this seat yet.</Empty> : (
            <div className="space-y-2">
              {data.top_influencers.map((inf) => (
                <Link
                  key={inf.handle}
                  to={`/grievances?leader=${encodeURIComponent(constituency)}&posted_by=${encodeURIComponent(inf.handle)}&from=${encodeURIComponent(windowStart)}`}
                  className="flex items-center gap-2 w-full hover:bg-slate-50 rounded px-1 -mx-1 py-1 transition-colors cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                    {String(inf.display_name || inf.handle).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-medium text-slate-700 truncate">@{inf.handle}</span>
                      {inf.verified && <BadgeCheck className="h-3 w-3 text-blue-500 shrink-0" />}
                    </div>
                    <div className="h-1 rounded-full bg-slate-100 overflow-hidden mt-0.5">
                      <div className="h-full bg-violet-400 rounded-full" style={{ width: `${(inf.followers / maxInfluencerFollowers) * 100}%` }} />
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500 shrink-0">{fmtShort(inf.followers)}</span>
                </Link>
              ))}
            </div>
          )}
        </PanelCard>
      </div>

      {/* Row 4 — Narrative heat map + AI insights */}
      <div className={grid3}>
        <PanelCard icon={TrendingUp} title="Narrative Heat Map (by seat)" className={span2}>
          <ConstituencyHeatMap currentConstituency={constituency} />
        </PanelCard>

        <Card className="border-slate-200 overflow-hidden flex flex-col bg-gradient-to-br from-indigo-600 to-violet-700 text-white">
          <div className="px-4 py-2.5 border-b border-white/15 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            <h3 className="text-xs font-bold uppercase tracking-wide">AI Insights</h3>
          </div>
          <div className="p-4 flex-1 space-y-2.5">
            {(data.ai_insights || []).length === 0 ? (
              <div className="text-[11px] text-indigo-100">No insights available yet.</div>
            ) : (
              data.ai_insights.map((line, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-md bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="h-3 w-3" />
                  </div>
                  <span className="text-[11px] leading-relaxed text-indigo-50">{line}</span>
                </div>
              ))
            )}
            <Link to={`/grievances?leader=${encodeURIComponent(constituency)}&from=${encodeURIComponent(windowStart)}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-white/90 hover:text-white pt-1">
              View detailed grievances <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </Card>
      </div>

      <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
        <Info className="h-3 w-3" /> All figures aggregated live from ingested & geo-tagged social mentions for this constituency. AI insights are rule-based summaries of the same data.
      </div>
    </div>
  );
};

export default SocialNarrativePanel;
