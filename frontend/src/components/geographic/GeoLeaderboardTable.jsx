import React from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import RiskBadge from './RiskBadge';
import TrendIndicator from './TrendIndicator';
import { formatGeoName } from './sentimentScale';

/**
 * Geography-agnostic leaderboard table.
 */
const GeoLeaderboardTable = ({ rows = [], loading, levelLabel = 'District', onRowClick, onQuickAction, emptyMessage, selectedKey }) => {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200/80 p-4 animate-pulse">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="py-3 border-b border-slate-50 flex items-center gap-4">
            <div className="h-3 w-28 bg-slate-100 rounded" />
            <div className="h-2.5 flex-1 bg-slate-50 rounded-full" />
            <div className="h-3 w-10 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200/80 p-8 flex flex-col items-center justify-center gap-2 text-slate-400">
        <span className="text-2xl">🗺️</span>
        <span className="text-xs">{emptyMessage || `No ${levelLabel.toLowerCase()} data for this period`}</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-slate-100 bg-slate-50/80 backdrop-blur-sm">
              <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 w-10">#</th>
              <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{levelLabel}</th>
              <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Mentions</th>
              <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 min-w-[160px]">Sentiment</th>
              <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Risk</th>
              <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Top Issues</th>
              <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Trend</th>
              <th className="px-2 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.key}
                onClick={() => onRowClick?.(row)}
                className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/80 cursor-pointer transition-colors group ${selectedKey === row.key ? 'bg-yellow-50/60' : ''}`}
              >
                <td className="px-4 py-3 text-xs font-semibold text-slate-400">{idx + 1}</td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRowClick?.(row); }}
                    className="text-sm font-semibold text-slate-800 hover:text-yellow-800 focus-visible:text-yellow-800 outline-none text-left"
                  >
                    {formatGeoName(row.name)}
                  </button>
                  {row.total_news > 0 && (
                    <div className="text-[10px] text-slate-400">{row.total_social.toLocaleString()} social · {row.total_news.toLocaleString()} news</div>
                  )}
                </td>
                <td className="px-3 py-3 text-sm font-semibold text-slate-700 tabular-nums">{row.total_mentions.toLocaleString()}</td>
                <td className="px-3 py-3">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex w-full">
                    {row.positive_pct > 0 && <div className="h-full bg-emerald-500" style={{ width: `${row.positive_pct}%` }} />}
                    {row.neutral_pct > 0 && <div className="h-full bg-slate-400" style={{ width: `${row.neutral_pct}%` }} />}
                    {row.negative_pct > 0 && <div className="h-full bg-red-500" style={{ width: `${row.negative_pct}%` }} />}
                  </div>
                  <div className="flex gap-2 mt-1 text-[10px] font-semibold">
                    <span className="text-emerald-600">{row.positive_pct}%</span>
                    <span className="text-slate-500">{row.neutral_pct}%</span>
                    <span className="text-red-500">{row.negative_pct}%</span>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <RiskBadge level={row.risk_level} score={row.avg_risk_score} />
                </td>
                <td className="px-3 py-3 max-w-[180px]">
                  <div className="flex flex-wrap gap-1">
                    {(row.top_topics?.length ? row.top_topics.slice(0, 2) : [{ topic: row.most_discussed_topic }]).filter((t) => t.topic).map((t) => (
                      <span key={t.topic} className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-medium truncate max-w-[85px]" title={t.topic}>{t.topic}</span>
                    ))}
                    {!row.most_discussed_topic && !row.top_topics?.length && <span className="text-xs text-slate-300">—</span>}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <TrendIndicator direction={row.mention_trend?.direction} changePct={row.mention_trend?.change_pct} />
                </td>
                <td className="px-2 py-3">
                  <div className="flex items-center gap-1">
                    {onQuickAction && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onQuickAction(row); }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-slate-200/60 text-slate-400 hover:text-slate-600 transition-all"
                        title="View mentions"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default GeoLeaderboardTable;
