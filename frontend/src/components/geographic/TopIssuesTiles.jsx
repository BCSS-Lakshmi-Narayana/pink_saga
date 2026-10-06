import React from 'react';
import TrendIndicator from './TrendIndicator';

const TILE_ACCENTS = [
  { bg: 'bg-red-50', text: 'text-red-700', bar: 'bg-red-400' },
  { bg: 'bg-orange-50', text: 'text-orange-700', bar: 'bg-orange-400' },
  { bg: 'bg-amber-50', text: 'text-amber-700', bar: 'bg-amber-400' },
  { bg: 'bg-teal-50', text: 'text-teal-700', bar: 'bg-teal-400' },
  { bg: 'bg-purple-50', text: 'text-purple-700', bar: 'bg-purple-400' },
  { bg: 'bg-blue-50', text: 'text-blue-700', bar: 'bg-blue-400' },
];

/** "Top Issues by Volume" tile grid — volume, sentiment split and trend per issue. */
const TopIssuesTiles = ({ issues = [], loading, onSelect }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-slate-50 animate-pulse" />)}
      </div>
    );
  }

  if (!issues.length) {
    return <div className="text-xs text-slate-400 py-6 text-center">No classified issues in this period</div>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {issues.map((issue, idx) => {
        const accent = TILE_ACCENTS[idx % TILE_ACCENTS.length];
        return (
          <button
            key={issue.topic}
            type="button"
            onClick={() => onSelect?.(issue)}
            className={`text-left rounded-xl border border-transparent p-3 transition-all hover:-translate-y-0.5 hover:shadow-md ${accent.bg}`}
          >
            <div className="flex items-start justify-between gap-1">
              <div className={`text-sm font-bold truncate ${accent.text}`} title={issue.topic}>{issue.topic}</div>
              <TrendIndicator direction={issue.trend} changePct={issue.trend_change_pct} />
            </div>
            <div className={`text-lg font-extrabold mt-1 tabular-nums ${accent.text}`}>{issue.mention_count.toLocaleString()}</div>
            <div className="text-[10px] opacity-70 font-semibold mb-1.5">{issue.share_pct}% of volume</div>
            <div className="h-1.5 bg-white/70 rounded-full overflow-hidden flex">
              {issue.positive > 0 && <div className="h-full bg-emerald-500" style={{ width: `${(issue.positive / issue.mention_count) * 100}%` }} />}
              {issue.neutral > 0 && <div className="h-full bg-slate-400" style={{ width: `${(issue.neutral / issue.mention_count) * 100}%` }} />}
              {issue.negative > 0 && <div className="h-full bg-red-500" style={{ width: `${(issue.negative / issue.mention_count) * 100}%` }} />}
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default TopIssuesTiles;
