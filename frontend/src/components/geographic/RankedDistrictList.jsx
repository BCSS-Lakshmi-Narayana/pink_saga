import React from 'react';
import TrendIndicator from './TrendIndicator';

/**
 * Professional leaderboard for "Top Positive Districts" / "Top Negative
 * Districts" — rank, sentiment split, trend and score in one scannable row.
 * `scoreField` lets the same component render either the Wilson-bound
 * positive confidence score or the weighted political-risk index.
 */
const RankedDistrictList = ({ title, subtitle, icon: Icon, accent, items = [], scoreField, scoreLabel, loading, onSelect }) => {
  const barColor = accent === 'positive' ? 'bg-emerald-500' : 'bg-red-500';
  const textColor = accent === 'positive' ? 'text-emerald-600' : 'text-red-600';
  const iconBg = accent === 'positive' ? 'bg-emerald-50' : 'bg-red-50';

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && (
            <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg} ${textColor}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
          )}
          <div>
            <h3 className="text-sm font-bold text-slate-800 leading-tight">{title}</h3>
            {subtitle && <p className="text-[10px] text-slate-400">{subtitle}</p>}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-slate-50 rounded-lg" />)}
        </div>
      ) : !items.length ? (
        <div className="text-xs text-slate-400 py-8 text-center">Not enough data yet</div>
      ) : (
        <div className="space-y-0.5">
          {items.map((row, idx) => {
            const score = row[scoreField] ?? 0;
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => onSelect?.(row)}
                className="w-full grid grid-cols-[20px_1fr_auto_auto] items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors text-left group"
              >
                <span className={`text-[11px] font-extrabold ${idx < 3 ? textColor : 'text-slate-300'}`}>{idx + 1}</span>

                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-slate-700 truncate group-hover:text-slate-900">{row.name}</span>
                  <span className="flex items-center gap-1 mt-1">
                    <span className="h-1.5 flex-1 max-w-[90px] bg-slate-100 rounded-full overflow-hidden flex">
                      {row.positive_pct > 0 && <span className="h-full bg-emerald-400" style={{ width: `${row.positive_pct}%` }} />}
                      {row.neutral_pct > 0 && <span className="h-full bg-slate-300" style={{ width: `${row.neutral_pct}%` }} />}
                      {row.negative_pct > 0 && <span className="h-full bg-red-400" style={{ width: `${row.negative_pct}%` }} />}
                    </span>
                    <span className="text-[9px] text-slate-400">{row.total_mentions.toLocaleString()}</span>
                  </span>
                </span>

                <TrendIndicator direction={row.mention_trend?.direction} changePct={row.mention_trend?.change_pct} />

                <span className="flex flex-col items-end gap-0.5 w-12 flex-shrink-0">
                  <span className={`text-xs font-extrabold tabular-nums ${textColor}`}>{score}{scoreField === 'positive_score' ? '%' : ''}</span>
                  <span className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                    <span className={`block h-full ${barColor}`} style={{ width: `${Math.min(100, score)}%` }} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {scoreLabel && <div className="text-[9px] text-slate-400 mt-3 pt-2 border-t border-slate-50">{scoreLabel}</div>}
    </div>
  );
};

export default RankedDistrictList;
