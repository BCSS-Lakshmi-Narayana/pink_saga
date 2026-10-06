import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Scale, Users, FileText, TrendingUp, Newspaper, LayoutGrid } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import ConstituencyHeatMap from '../../ConstituencyHeatMap';
import RiskGauge from '../RiskGauge';
import SentimentTrendChart from '../SentimentTrendChart';
import PlatformDistributionBar from '../PlatformDistributionBar';
import {
  useConstituencyLeaderboard, useConstituencyDetail, useConstituencyComparison,
} from '../../../hooks/useConstituencyIntel';

const CARD = 'bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]';

const BUCKET_STYLE = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  negative: 'bg-orange-50 text-orange-700 border-orange-200',
  mixed: 'bg-amber-50 text-amber-700 border-amber-200',
  positive: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  no_data: 'bg-slate-50 text-slate-500 border-slate-200',
};
const BucketBadge = ({ bucket }) => (
  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${BUCKET_STYLE[bucket] || BUCKET_STYLE.no_data}`}>
    {(bucket || 'no data').replace('_', ' ')}
  </span>
);

const SUB_TABS = [
  ['overview', 'Overview', LayoutGrid],
  ['trend', 'Sentiment Trend', TrendingUp],
  ['issues', 'Issues', FileText],
  ['comparative', 'Comparative', Scale],
  ['posts', 'Top Posts', Newspaper],
  ['influencers', 'Influencers', Users],
];

/**
 * Constituency Explorer — an investigative workspace for a single seat.
 */
const ConstituencyExplorerTab = ({ filters = {}, active = true }) => {
  const navigate = useNavigate();
  // Scoped officers (mla/mp/senior_leader) only ever have one seat in scope, so
  // head-to-head comparison against another seat isn't meaningful for them —
  // and would otherwise be the only place in this tab that surfaces other
  // constituencies' names/metrics to a single-seat login.
  const { isScoped } = useAuth();
  const visibleSubTabs = useMemo(
    () => (isScoped ? SUB_TABS.filter(([key]) => key !== 'comparative') : SUB_TABS),
    [isScoped]
  );
  // `active` lets the page keep this tab mounted (preserving search/selected
  // seat/sub-tab/compare choice) while hidden, without it continuing to
  // fetch in the background.
  const { data: leaderboard, loading: leaderboardLoading, error: leaderboardError } = useConstituencyLeaderboard(filters, { enabled: active });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [subTab, setSubTab] = useState('overview');
  const [compareWith, setCompareWith] = useState('');

  useEffect(() => {
    if (isScoped && subTab === 'comparative') setSubTab('overview');
  }, [isScoped, subTab]);

  const goToGrievances = (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.search) params.set('search', opts.search);
    // `opts.topic` is now the literal analysis.grievance_type/category value
    // the backend's top-issues aggregation grouped by — send it verbatim so
    // it exact-matches what the Grievances page actually filters on, instead
    // of re-formatting a value that (pre-fix) used to be a local keyword-
    // lexicon key with no relation to any stored field.
    if (opts.topic) params.set('topic', opts.topic);
    if (selected) params.set('location', selected);
    const fromDate = opts.from || filters?.from;
    const toDate = opts.to || filters?.to;
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    navigate(`/grievances?${params.toString()}`);
  };

  const rows = useMemo(() => leaderboard?.data || [], [leaderboard]);

  useEffect(() => {
    if (!selected && rows.length) setSelected(rows[0].constituency);
  }, [rows, selected]);

  const filtered = search ? rows.filter((r) => r.constituency.toLowerCase().includes(search.toLowerCase())) : rows;

  const { detail, narrative, loading: detailLoading, error: detailError } = useConstituencyDetail(selected, filters, { enabled: active });
  const { data: comparison, loading: comparisonLoading, error: comparisonError } = useConstituencyComparison(selected, compareWith || null, filters, { enabled: active });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[270px_minmax(0,1fr)] gap-3 items-start">
      <div className={`${CARD} overflow-hidden`}>
        <div className="p-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-slate-800">Constituency Explorer</h3>
            <span className="text-[10px] font-semibold text-slate-400">{rows.length} seats</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-yellow-500/30 focus-within:border-yellow-400 transition-all">
            <Search className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search constituency..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-xs bg-transparent border-none outline-none w-full text-slate-700"
            />
          </div>
        </div>
        {leaderboardError && (
          <div className="text-[10px] text-red-600 font-semibold px-3 py-1.5 border-b border-red-100 bg-red-50">{leaderboardError}</div>
        )}
        <div className="max-h-[620px] overflow-y-auto">
          {leaderboardLoading ? (
            <div className="p-3 space-y-2 animate-pulse">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 bg-slate-50 rounded-lg" />)}
            </div>
          ) : !filtered.length ? (
            <div className="text-xs text-slate-400 text-center py-8">No seats match "{search}"</div>
          ) : (
            filtered.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setSelected(r.constituency)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-50 last:border-0 text-left transition-colors relative ${selected === r.constituency ? 'bg-yellow-50' : 'hover:bg-slate-50'}`}
              >
                {selected === r.constituency && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-yellow-600" />}
                <span className={`text-xs font-semibold truncate ${selected === r.constituency ? 'text-yellow-800' : 'text-slate-700'}`}>{r.constituency}</span>
                <BucketBadge bucket={r.bucket} />
              </button>
            ))
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        {!selected ? (
          <div className={`${CARD} p-10 flex items-center justify-center text-slate-400 text-sm`}>
            Select a constituency to view its intelligence
          </div>
        ) : (
          <>
            {detailError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-lg px-3 py-2">{detailError}</div>
            )}
            <div className={`${CARD} p-4`}>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[180px]">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-yellow-700 mb-0.5">Constituency Profile</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-extrabold text-slate-800">{selected}</h2>
                    {detail && <BucketBadge bucket={detail.sentiment?.bucket} />}
                  </div>
                  {/* The API returns the roster record: the name is `mla.mla`. */}
                  {detail?.mla?.vacant && (
                    <div className="text-xs text-slate-500 mt-0.5">Seat vacant</div>
                  )}
                  {detail?.mla?.mla && !detail.mla.vacant && (
                    <div className="text-xs text-slate-500 mt-0.5">MLA: <b className="text-slate-700">{detail.mla.mla}</b> · {detail.mla.party} {detail.mla.alliance ? `(${detail.mla.alliance})` : ''}</div>
                  )}
                </div>
                {detailLoading ? (
                  <div className="flex items-center gap-4 animate-pulse">
                    <div className="w-14 h-14 bg-slate-100 rounded-full" />
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                      <div className="w-16 h-5 bg-slate-100 rounded" />
                      <div className="w-16 h-5 bg-slate-100 rounded" />
                      <div className="w-16 h-5 bg-slate-100 rounded" />
                      <div className="w-16 h-5 bg-slate-100 rounded" />
                    </div>
                  </div>
                ) : detail ? (() => {
                  // constituency-intel has no separate AI risk score (unlike
                  // Geographic Intelligence's districts) — this gauge used to
                  // show max(0, -sentiment_index), which is only ever
                  // non-zero for net-negative seats and reads as "broken"
                  // (a flat 0/100) for any neutral-or-better seat. Negative
                  // mention share is meaningful regardless of the seat's
                  // overall lean, and matches the "Negative %" stat beside it.
                  const negativePct = detail.sentiment.negative_pct
                    ?? Math.round((detail.sentiment.negative / Math.max(1, detail.sentiment.total)) * 100);
                  return (
                    <>
                      <div className="text-center flex-shrink-0">
                        <RiskGauge score={negativePct} size={72} />
                        <div className="text-[9px] text-slate-400 uppercase font-bold mt-0.5">Negative Share</div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                        <div><span className="text-slate-400">Mentions</span><br /><span className="font-bold text-slate-800 tabular-nums">{detail.sentiment.total.toLocaleString()}</span></div>
                        <div><span className="text-slate-400">Positive</span><br /><span className="font-bold text-emerald-600 tabular-nums">{detail.sentiment.positive_pct ?? Math.round((detail.sentiment.positive / Math.max(1, detail.sentiment.total)) * 100)}%</span></div>
                        <div><span className="text-slate-400">Negative</span><br /><span className="font-bold text-red-500 tabular-nums">{negativePct}%</span></div>
                        <div><span className="text-slate-400">Index</span><br /><span className="font-bold text-slate-800 tabular-nums">{detail.sentiment.sentiment_index}</span></div>
                      </div>
                    </>
                  );
                })() : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-1 bg-slate-100/70 p-1 rounded-xl w-fit">
              {visibleSubTabs.map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSubTab(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all duration-150 ${
                    subTab === key ? 'bg-white text-yellow-800 shadow-[0_1px_3px_rgba(15,23,42,0.12)]' : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              ))}
            </div>

            {subTab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className={`${CARD} h-[340px] p-2 flex flex-col`}>
                  <div className="flex-1 min-h-0">
                    <ConstituencyHeatMap currentConstituency={selected} />
                  </div>
                  {/* This map is a cross-page-shared, always-365-day snapshot
                      (see ConstituencyHeatMap's module-level cache) — it does
                      not reflect the page's date range/platform/sentiment
                      filters the way the seat list and profile below do. */}
                  <div className="text-[9px] text-slate-400 text-center pt-1">Fixed 365-day snapshot — not affected by the filters above</div>
                </div>
                <div className={`${CARD} p-4`}>
                  <h3 className="text-sm font-bold text-slate-800 mb-2">Top Issues</h3>
                  {detailLoading ? (
                    <div className="flex flex-wrap gap-2 animate-pulse py-4">
                      <div className="h-6 w-24 bg-slate-100 rounded-full" />
                      <div className="h-6 w-20 bg-slate-100 rounded-full" />
                      <div className="h-6 w-28 bg-slate-100 rounded-full" />
                      <div className="h-6 w-16 bg-slate-100 rounded-full" />
                    </div>
                  ) : !detail?.top_issues?.length ? (
                    <div className="text-xs text-slate-400 py-6 text-center">No classified issues yet</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {detail.top_issues.map((i) => (
                        <button
                          key={i.issue}
                          type="button"
                          onClick={() => goToGrievances({ topic: i.issue })}
                          className="text-[10px] bg-slate-100 hover:bg-yellow-100 text-slate-700 hover:text-yellow-900 px-2.5 py-1 rounded-full font-medium transition-colors flex items-center gap-1 cursor-pointer border border-slate-200/60"
                          title={`View grievances for ${i.issue}`}
                        >
                          <span>{i.issue}</span>
                          <span className="opacity-60">· {i.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {narrative?.platforms?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-50">
                      <h4 className="text-xs font-bold text-slate-700 mb-1.5">Platform Mix</h4>
                      <PlatformDistributionBar distribution={Object.fromEntries(narrative.platforms.map((p) => [p.platform, p.count]))} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {subTab === 'trend' && (
              <SentimentTrendChart
                data={(narrative?.volume_trend || detail?.volume_trend || []).map((v) => ({
                  date: v.date,
                  total: v.count || v.total || 0,
                  positive: v.positive || 0,
                  negative: v.negative || 0,
                  neutral: v.neutral || 0,
                }))}
                loading={detailLoading}
                title="Conversation Volume Trend (30d)"
              />
            )}

            {subTab === 'issues' && (
              <div className={`${CARD} p-4 space-y-4`}>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 mb-2">Top Issues</h3>
                  {detailLoading ? (
                    <div className="flex flex-wrap gap-2 animate-pulse py-2">
                      <div className="h-6 w-24 bg-slate-100 rounded-full" />
                      <div className="h-6 w-20 bg-slate-100 rounded-full" />
                      <div className="h-6 w-28 bg-slate-100 rounded-full" />
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(detail?.top_issues || []).map((i) => (
                        <button
                          key={i.issue}
                          type="button"
                          onClick={() => goToGrievances({ topic: i.issue })}
                          className="text-[10px] bg-slate-100 hover:bg-yellow-100 text-slate-700 hover:text-yellow-900 px-2.5 py-1 rounded-full font-medium transition-colors flex items-center gap-1 cursor-pointer border border-slate-200/60"
                          title={`View grievances for ${i.issue}`}
                        >
                          <span>{i.issue}</span>
                          <span className="opacity-60">· {i.count}</span>
                        </button>
                      ))}
                      {!detail?.top_issues?.length && <span className="text-xs text-slate-400">No classified issues yet</span>}
                    </div>
                  )}
                </div>
                <div className="pt-4 border-t border-slate-50">
                  <h3 className="text-sm font-bold text-slate-800 mb-2">Trending Hashtags</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(narrative?.trending_hashtags || []).map((h) => (
                      <button
                        key={h.name}
                        type="button"
                        onClick={() => goToGrievances({ search: h.name })}
                        className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-600 hover:text-blue-800 px-2.5 py-1 rounded-full font-medium transition-colors flex items-center gap-1 cursor-pointer border border-blue-200/60"
                        title={`View grievances for ${h.name}`}
                      >
                        <span>{h.name}</span>
                        <span className="opacity-60">· {h.count}</span>
                      </button>
                    ))}
                    {!narrative?.trending_hashtags?.length && <span className="text-xs text-slate-400">No hashtags trending yet</span>}
                  </div>
                </div>
              </div>
            )}

            {subTab === 'comparative' && !isScoped && (
              <div className={`${CARD} p-4`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-slate-500">Compare with:</span>
                  <select
                    value={compareWith}
                    onChange={(e) => setCompareWith(e.target.value)}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
                  >
                    <option value="">Select a seat…</option>
                    {rows.filter((r) => r.constituency !== selected).map((r) => (
                      <option key={r.key} value={r.constituency}>{r.constituency}</option>
                    ))}
                  </select>
                </div>
                {comparisonError && (
                  <div className="text-xs text-red-600 font-semibold mb-2">{comparisonError}</div>
                )}
                {!compareWith ? (
                  <div className="text-xs text-slate-400 py-6 text-center">Pick a second seat to compare</div>
                ) : comparisonLoading ? (
                  <div className="text-xs text-slate-400 py-6 text-center animate-pulse">Comparing…</div>
                ) : comparison ? (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="py-2 text-[10px] font-bold uppercase text-slate-400">Metric</th>
                        <th className="py-2 text-[10px] font-bold uppercase text-slate-400">{selected}</th>
                        <th className="py-2 text-[10px] font-bold uppercase text-slate-400">{compareWith}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.head_to_head.map((m) => (
                        <tr key={m.key} className="border-b border-slate-50 last:border-0">
                          <td className="py-2 text-xs text-slate-500">{m.label}</td>
                          <td className={`py-2 text-xs font-bold ${m.winner === 'a' ? 'text-emerald-600' : 'text-slate-700'}`}>{m.a}{m.unit}</td>
                          <td className={`py-2 text-xs font-bold ${m.winner === 'b' ? 'text-emerald-600' : 'text-slate-700'}`}>{m.b}{m.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            )}

            {subTab === 'posts' && (
              <div className={`${CARD} p-4`}>
                <h3 className="text-sm font-bold text-slate-800 mb-3">Recent Negative Mentions</h3>
                {!detail?.recent_negative?.length ? (
                  <div className="text-xs text-slate-400 py-6 text-center">No recent negative mentions</div>
                ) : (
                  <ul className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                    {detail.recent_negative.map((p, i) => (
                      <li key={i} className="border-b border-slate-50 last:border-0 pb-2.5 last:pb-0">
                        <div className="text-[10px] text-slate-400 uppercase mb-1">{p.platform} · {p.display_name || p.handle}</div>
                        <p className="text-xs text-slate-600 line-clamp-2">{p.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {subTab === 'influencers' && (
              <div className={`${CARD} p-4`}>
                <h3 className="text-sm font-bold text-slate-800 mb-3">Top Influencers</h3>
                {!narrative?.top_influencers?.length ? (
                  <div className="text-xs text-slate-400 py-6 text-center">No influencer data for this window</div>
                ) : (
                  <ul className="space-y-2">
                    {narrative.top_influencers.map((inf) => (
                      <li key={inf.handle} className="flex items-center justify-between border-b border-slate-50 last:border-0 pb-2 last:pb-0">
                        <div>
                          <span className="text-xs font-semibold text-slate-700">{inf.display_name}</span>
                          {inf.verified && <span className="text-yellow-600 text-[10px] ml-1">✓</span>}
                          <div className="text-[10px] text-slate-400">@{inf.handle} · {inf.posts} posts</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-bold text-slate-700">{inf.followers.toLocaleString()}</div>
                          <div className="text-[10px] text-slate-400">followers</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ConstituencyExplorerTab;
