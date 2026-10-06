import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  RefreshCw, ChevronRight, ArrowUpRight, ArrowDownRight, Minus, Info, Search
} from 'lucide-react';

// ── Level config ─────────────────────────────────────────────────────────────
const LEVELS = {
  critical:   { label: 'Critical',   bg: 'bg-red-100',    border: 'border-red-400',    text: 'text-red-700',    dot: '#ef4444' },
  high_alert: { label: 'High Alert', bg: 'bg-orange-100', border: 'border-orange-400', text: 'text-orange-700', dot: '#f97316' },
  elevated:   { label: 'Elevated',   bg: 'bg-yellow-100', border: 'border-yellow-400', text: 'text-yellow-700', dot: '#eab308' },
  watch:      { label: 'Watch',      bg: 'bg-blue-100',   border: 'border-blue-400',   text: 'text-blue-700',   dot: '#3b82f6' },
  calm:       { label: 'Calm',       bg: 'bg-gray-100',   border: 'border-gray-300',   text: 'text-gray-500',   dot: '#9ca3af' },
};

const ISSUE_LABELS = {
  roads: 'Roads', water: 'Water', electricity: 'Electricity',
  employment: 'Employment', health: 'Health', corruption: 'Corruption',
  education: 'Education', pensions_welfare: 'Pensions/Welfare',
  housing: 'Housing', agriculture: 'Agriculture',
  drugs: 'Drug Menace', law_order: 'Law & Order',
  sand_mining: 'Sand Mining', infrastructure: 'Infrastructure',
};

const ISSUE_COLORS = {
  roads: '#f59e0b', water: '#3b82f6', electricity: '#eab308',
  employment: '#8b5cf6', health: '#ec4899', corruption: '#ef4444',
  education: '#06b6d4', pensions_welfare: '#10b981', housing: '#f97316',
  agriculture: '#84cc16', drugs: '#a78bfa', law_order: '#6b7280',
  sand_mining: '#92400e', infrastructure: '#0ea5e9',
};

const formatIssueLabel = (i) => {
  if (!i) return '';
  const val = ISSUE_LABELS[i] || i;
  return val.replace(/[_-]+/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

const DAY_RANGE_OPTIONS = [1, 2, 3, 7, 30, 90];

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreRing({ score, level, size = 80 }) {
  const cfg = LEVELS[level] || LEVELS.calm;
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={8} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={cfg.dot} strokeWidth={8}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fontSize={18} fontWeight="700" fill={cfg.dot}>{score}</text>
    </svg>
  );
}

function LevelBadge({ level }) {
  const cfg = LEVELS[level] || LEVELS.calm;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cfg.bg} ${cfg.border} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}


function ConstituencyRow({ item, rank, selected, onClick }) {
  const cfg = LEVELS[item.level] || LEVELS.calm;
  const velocityUp = item.last_24h > item.prev_24h;
  const velocityDown = item.last_24h < item.prev_24h && item.prev_24h > 0;

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all hover:bg-gray-50 border ${
        selected ? 'border-blue-300 bg-blue-50' : 'border-transparent'
      }`}
      onClick={onClick}
    >
      <span className="text-xs text-gray-400 w-5 text-right">{rank}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800 truncate">{item.constituency}</span>
          <LevelBadge level={item.level} />
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-gray-500">{item.district || '—'}</span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-500">{item.total_grievances} grievances</span>
          {item.top_issues?.[0] && (
            <>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-500">{formatIssueLabel(item.top_issues[0].type)}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {velocityUp && <ArrowUpRight className="h-3.5 w-3.5 text-red-500" />}
        {velocityDown && <ArrowDownRight className="h-3.5 w-3.5 text-green-500" />}
        {!velocityUp && !velocityDown && <Minus className="h-3.5 w-3.5 text-gray-300" />}
        <div className="w-16 bg-gray-200 rounded-full h-1.5">
          <div className="h-1.5 rounded-full" style={{ width: `${item.score}%`, backgroundColor: cfg.dot }} />
        </div>
        <span className={`text-xs font-bold w-7 text-right ${cfg.text}`}>{item.score}</span>
        <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
      </div>
    </div>
  );
}

function FactorBar({ label, value }) {
  const color = value >= 75 ? '#ef4444' : value >= 50 ? '#f97316' : value >= 25 ? '#eab308' : '#9ca3af';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-20 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-8 text-right">{Math.round(value)}</span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function UnrestPredictor() {
  const navigate = useNavigate();
  const [windowDays, setWindowDays] = useState(7);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedConstituency, setSelectedConstituency] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [trend, setTrend] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [districtFilter, setDistrictFilter] = useState('all');
  const [issueFilter, setIssueFilter] = useState('all');
  const [isMarqueePaused, setIsMarqueePaused] = useState(false);

  const detailRef = useRef(null);

  const fetchOverview = useCallback(async (win) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/unrest/overview?window=${win}`);
      setOverview(res.data);
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to load unrest data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOverview(windowDays); }, [windowDays, fetchOverview]);

  const openDetail = useCallback(async (name) => {
    setSelectedConstituency(name);
    setDetail(null);
    setTrend([]);
    setDetailLoading(true);
    try {
      const [detRes, trendRes] = await Promise.all([
        api.get(`/unrest/constituency/${encodeURIComponent(name)}?window=${windowDays}`),
        api.get(`/unrest/trend?constituency=${encodeURIComponent(name)}&days=30`)
      ]);
      setDetail(detRes.data);
      setTrend(trendRes.data.data || []);
    } catch (e) {
      setDetail({ error: e?.response?.data?.error || 'No data for this constituency in selected window' });
    } finally {
      setDetailLoading(false);
    }
  }, [windowDays]);

  const districtOptions = Object.keys(overview?.districts || {}).sort((a, b) => a.localeCompare(b));
  const issueOptions = Array.from(new Set(
    (overview?.constituencies || []).flatMap(c => (c.top_issues || []).map(i => i.type))
  )).filter(Boolean);

  const filteredConstituencies = React.useMemo(() => {
    return (overview?.constituencies || []).filter(c => {
      if (!searchQ.trim()) return true;
      const q = searchQ.toLowerCase();
      return c.constituency.toLowerCase().includes(q) || (c.district || '').toLowerCase().includes(q);
    }).filter(c => {
      if (levelFilter === 'all') return true;
      return c.level === levelFilter;
    }).filter(c => {
      if (districtFilter === 'all') return true;
      return (c.district || '').toLowerCase() === districtFilter.toLowerCase();
    }).filter(c => {
      if (issueFilter === 'all') return true;
      return (c.top_issues || []).some(i => i.type === issueFilter);
    }).sort((a, b) => b.score - a.score);
  }, [overview, searchQ, levelFilter, districtFilter, issueFilter]);

  useEffect(() => {
    if (filteredConstituencies.length > 0) {
      const isStillVisible = filteredConstituencies.some(c => c.constituency === selectedConstituency);
      if (!selectedConstituency || !isStillVisible) {
        openDetail(filteredConstituencies[0].constituency);
      }
    } else {
      setSelectedConstituency(null);
      setDetail(null);
      setTrend([]);
    }
  }, [filteredConstituencies, selectedConstituency, openDetail]);

  const recentGrievances = detail?.recent_grievances || [];
  const grievanceMarqueeItems = recentGrievances.length > 1
    ? [...recentGrievances, ...recentGrievances]
    : recentGrievances;
  const grievanceMarqueeDuration = recentGrievances.length <= 3 ? 12 : recentGrievances.length <= 6 ? 16 : 20;

  const getGrievanceId = (g) => g?.id || g?.grievance_id || g?.content_id || g?.grievanceId || null;
  const normalizeXUrl = (url) => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('twitter.com') || parsed.hostname.includes('x.com')) {
        parsed.hostname = 'x.com';
        return parsed.toString();
      }
    } catch { }
    return url;
  };
  const buildXUrlFromTweet = (g) => {
    const tweetId = g?.tweet_id || g?.tweetId || null;
    const handle = g?.posted_by?.handle || g?.handle || g?.username || null;
    if (!tweetId || !handle) return null;
    return `https://x.com/${handle.replace(/^@/, '')}/status/${tweetId}`;
  };
  const handleGrievanceRedirect = (g) => {
    const originalUrl = g?.tweet_url || g?.url || null;
    const xUrl = normalizeXUrl(originalUrl) || buildXUrlFromTweet(g);
    if (xUrl) {
      window.open(xUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const grievanceId = getGrievanceId(g);
    if (grievanceId) {
      navigate(`/grievances?id=${encodeURIComponent(grievanceId)}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <style>{`
        @keyframes grievance-marquee {
          from { transform: translateY(0); }
          to { transform: translateY(-50%); }
        }
      `}</style>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">{error}</div>
      )}

      {/* ── Filters ── */}
      <div className="border border-gray-200 rounded-lg bg-transparent px-3 py-2 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2 items-end">
          <div className="space-y-1">
            <label className="text-[11px] text-gray-500">Search</label>
            <div className="relative">
              <Search className="h-3 w-3 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Constituency or district"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                className="text-xs border border-gray-200 rounded-md pl-7 pr-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-gray-500">District</label>
            <select
              value={districtFilter}
              onChange={e => setDistrictFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-blue-300"
            >
              <option value="all">All districts</option>
              {districtOptions.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-gray-500">Risk Level</label>
            <select
              value={levelFilter}
              onChange={e => setLevelFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-blue-300"
            >
              <option value="all">All levels</option>
              {Object.entries(LEVELS).filter(([k]) => k !== 'calm').map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-gray-500">Issue Type</label>
            <select
              value={issueFilter}
              onChange={e => setIssueFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-blue-300"
            >
              <option value="all">All issues</option>
              {issueOptions.map(i => (
                <option key={i} value={i}>{formatIssueLabel(i)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-gray-500">Day Range</label>
            <div className="flex items-center flex-wrap gap-1">
              {DAY_RANGE_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setWindowDays(d)}
                  className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                    windowDays === d
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <RefreshCw className="h-8 w-8 animate-spin" />
            <p className="text-sm">Computing constituency scores…</p>
          </div>
        </div>
      )}

      {!loading && overview && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-stretch">
              {/* ── Left: Ranked Constituencies (Top 5) ── */}
              <div className="xl:col-span-2">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm h-full min-h-[260px]">
                  <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-gray-700 mr-auto">Ranked Constituencies</h2>
                    <span className="text-xs text-gray-400">{filteredConstituencies.length} total</span>
                  </div>
                  {filteredConstituencies.length === 0 && (
                    <div className="text-center py-10 text-sm text-gray-400">
                      {searchQ ? 'No constituencies match your filters.' : 'No grievance data in this window.'}
                    </div>
                  )}
                  <div className="p-2 space-y-1 max-h-[320px] overflow-y-auto">
                    {filteredConstituencies.map((item, i) => (
                      <ConstituencyRow
                        key={item.constituency_lower || item.constituency}
                        item={item}
                        rank={i + 1}
                        selected={selectedConstituency?.toLowerCase() === item.constituency?.toLowerCase()}
                        onClick={() => openDetail(item.constituency)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Right: Constituency Summary ── */}
              <div ref={detailRef} className="space-y-5 h-full">
                {!selectedConstituency && (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex flex-col items-center justify-center text-center gap-3 h-full min-h-[260px]">
                    <Info className="h-10 w-10 text-gray-300" />
                    <p className="text-sm text-gray-500">Select a constituency to see its summary.</p>
                  </div>
                )}

                {selectedConstituency && detailLoading && (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex items-center justify-center h-full min-h-[260px]">
                    <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                )}

                {selectedConstituency && !detailLoading && detail && !detail.error && (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 h-full min-h-[260px]">
                    {(() => {
                      const current24 = detail.last_24h || 0;
                      const prior24 = detail.prev_24h || 0;
                      const delta = current24 - prior24;
                      const deltaPct = prior24 > 0 ? (delta / prior24) * 100 : current24 > 0 ? 100 : 0;
                      const deltaUp = delta > 0;
                      const deltaDown = delta < 0;
                      const deltaColor = deltaUp ? 'text-red-500' : deltaDown ? 'text-green-500' : 'text-gray-400';
                      const barColor = deltaUp ? '#ef4444' : deltaDown ? '#10b981' : '#9ca3af';

                      return (
                        <>
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-[11px] uppercase tracking-widest text-gray-400">Constituency Risk Snapshot</p>
                              <h3 className="text-base font-bold text-gray-900">{detail.constituency}</h3>
                              <p className="text-xs text-gray-500">{detail.district || 'Telangana'}</p>
                              <div className="mt-2 flex items-center gap-2">
                                <LevelBadge level={detail.level} />
                                <span className="text-xs text-gray-500">{detail.total_grievances} grievances in last {windowDays}d</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <ScoreRing score={detail.score} level={detail.level} />
                              <p className="text-[11px] text-gray-400 mt-1">Risk score (0-100)</p>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-3">
                            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                              <p className="text-[11px] text-gray-500 mb-1 font-medium">24h Volume</p>
                              <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                                <span>Current: <span className="font-semibold text-gray-800">{current24}</span></span>
                                <span>Prior: <span className="font-semibold text-gray-800">{prior24}</span></span>
                              </div>
                              <div className="flex gap-1.5 h-4 items-end">
                                <div
                                  className="bg-gray-300 rounded-sm flex-1"
                                  style={{ height: `${Math.min(100, (prior24 / Math.max(current24, prior24, 1)) * 100)}%` }}
                                />
                                <div
                                  className="rounded-sm flex-1"
                                  style={{
                                    height: `${Math.min(100, (current24 / Math.max(current24, prior24, 1)) * 100)}%`,
                                    backgroundColor: barColor
                                  }}
                                />
                              </div>
                            </div>
                            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                              <p className="text-[11px] text-gray-500 mb-1 font-medium">24h Change</p>
                              <div className="flex items-center gap-2">
                                {deltaUp && <ArrowUpRight className="h-4 w-4 text-red-500" />}
                                {deltaDown && <ArrowDownRight className="h-4 w-4 text-green-500" />}
                                {!deltaUp && !deltaDown && <Minus className="h-4 w-4 text-gray-300" />}
                                <span className={`text-sm font-semibold ${deltaColor}`}>{delta >= 0 ? '+' : ''}{delta}</span>
                                <span className="text-xs text-gray-500">({deltaPct.toFixed(0)}%)</span>
                              </div>
                              <p className="text-[11px] text-gray-400 mt-1">Compared with previous 24h window</p>
                            </div>
                          </div>

                          <div className="mt-3 space-y-1.5">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Risk Drivers</p>
                            <FactorBar label="Volume Surge" value={detail.factors?.volume || 0} />
                            <FactorBar label="Severity Index" value={detail.factors?.severity || 0} />
                            <FactorBar label="Issue Clustering" value={detail.factors?.clustering || 0} />
                            <FactorBar label="Velocity" value={detail.factors?.velocity || 0} />
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {selectedConstituency && !detailLoading && detail?.error && (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 text-center text-sm text-gray-500">
                    {detail.error}
                  </div>
                )}
              </div>

              {/* ── Left: 30-day Trend ── */}
              <div className="xl:col-span-2">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 h-full min-h-[200px]">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">30-Day Trend</h4>
                  {trend.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={120}>
                        <AreaChart data={trend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={v => v.slice(5)} />
                          <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                          <Tooltip
                            contentStyle={{ fontSize: 11, padding: '4px 8px' }}
                            formatter={(val, name) => [val, name === 'count' ? 'Grievances' : 'Negative']}
                            labelFormatter={v => `Date: ${v}`}
                          />
                          <Area type="monotone" dataKey="count" stroke="#f97316" fill="url(#trendGrad)" strokeWidth={2} dot={false} />
                          <Area type="monotone" dataKey="negative" stroke="#ef4444" fill="none" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                      <div className="flex gap-4 mt-2 text-xs text-gray-400">
                        <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-orange-400" />Total</span>
                        <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-red-400 border-dashed" />Negative</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-gray-400 py-6 text-center">Select a constituency to view trend.</div>
                  )}
                </div>
              </div>

              {/* ── Right: Issue Breakdown ── */}
              <div>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 h-full min-h-[200px]">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Issue Breakdown</h4>
                  {detail?.top_issues?.length > 0 ? (
                    <>
                      <div className="space-y-2">
                        {detail.top_issues.slice(0, 6).map(issue => (
                          <div key={issue.type} className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ISSUE_COLORS[issue.type] || '#9ca3af' }} />
                            <span className="text-xs text-gray-700 flex-1">{formatIssueLabel(issue.type)}</span>
                            <div className="w-20 bg-gray-100 rounded-full h-1.5">
                              <div
                                className="h-1.5 rounded-full"
                                style={{
                                  width: `${(issue.count / (detail.top_issues[0]?.count || 1)) * 100}%`,
                                  backgroundColor: ISSUE_COLORS[issue.type] || '#9ca3af'
                                }}
                              />
                            </div>
                            <span className="text-xs font-semibold text-gray-600 w-5 text-right">{issue.count}</span>
                          </div>
                        ))}
                      </div>

                      {detail.sentiment_breakdown && (
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sentiment Split</p>
                          <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
                            <div className="bg-red-400" style={{ width: `${(detail.sentiment_breakdown.negative / Math.max(detail.total_grievances, 1)) * 100}%` }} />
                            <div className="bg-gray-300" style={{ width: `${(detail.sentiment_breakdown.neutral / Math.max(detail.total_grievances, 1)) * 100}%` }} />
                            <div className="bg-green-400" style={{ width: `${(detail.sentiment_breakdown.positive / Math.max(detail.total_grievances, 1)) * 100}%` }} />
                          </div>
                          <div className="flex gap-3 mt-1.5 text-xs text-gray-500">
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />{detail.sentiment_breakdown.negative} Negative</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" />{detail.sentiment_breakdown.neutral} Neutral</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" />{detail.sentiment_breakdown.positive} Positive</span>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-sm text-gray-400 py-6 text-center">Select a constituency to view breakdown.</div>
                  )}
                </div>
              </div>

              {/* ── Bottom: Recent Grievances ── */}
              <div className="xl:col-span-3">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 min-h-[300px]">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Grievances</h4>
                  {recentGrievances.length > 0 ? (
                    <div
                      className="relative h-[280px] overflow-y-auto pr-1"
                      onMouseEnter={() => setIsMarqueePaused(true)}
                      onMouseLeave={() => setIsMarqueePaused(false)}
                    >
                      <div
                        className="space-y-2 grievance-marquee"
                        style={recentGrievances.length > 1
                          ? {
                            animation: `grievance-marquee ${grievanceMarqueeDuration}s linear infinite`,
                            animationPlayState: isMarqueePaused ? 'paused' : 'running'
                          }
                          : undefined}
                      >
                        {grievanceMarqueeItems.map((g, i) => {
                          const rl = LEVELS[g.risk_level] || LEVELS.calm;
                          return (
                            <button
                              key={`${getGrievanceId(g) || i}-${i}`}
                              type="button"
                              onClick={() => handleGrievanceRedirect(g)}
                              className="w-full text-left flex gap-2 items-start rounded-md px-2 py-1.5 hover:bg-gray-50 transition-colors"
                            >
                              <span className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: rl.dot }} />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-700 line-clamp-2">{g.text || '—'}</p>
                                <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                                  <span className="capitalize">{g.platform}</span>
                                  {g.issue_type && <span>· {formatIssueLabel(g.issue_type)}</span>}
                                  <span>· {g.post_date ? new Date(g.post_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}</span>
                                </div>
                              </div>
                              <ArrowUpRight className="h-3.5 w-3.5 text-gray-300" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-400 py-6 text-center">Select a constituency to view recent grievances.</div>
                  )}
                </div>
              </div>
            </div>
          )}
    </div>
  );
}
