import React from 'react';
import { TrendingUp } from 'lucide-react';

/** Professional ranking of topics with the sharpest week-over-week growth — the "what's newly hot" answer. */
const EmergingTopicsList = ({ topics = [], loading, onSelect }) => {
  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-11 bg-slate-50 rounded-lg" />)}
      </div>
    );
  }

  if (!topics.length) {
    return (
      <div className="text-xs text-slate-400 py-8 text-center flex flex-col items-center gap-2">
        <TrendingUp className="h-5 w-5 text-slate-300" />
        No topic is growing sharply this period
      </div>
    );
  }

  const maxGrowth = Math.max(...topics.map((t) => t.trend_change_pct), 1);

  return (
    <div className="space-y-1">
      {topics.map((t, idx) => (
        <button
          key={t.topic}
          type="button"
          onClick={() => onSelect?.(t)}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-purple-50/60 transition-colors text-left cursor-pointer"
          title={`View grievances for ${t.topic}`}
        >
          <span className="text-[11px] font-extrabold text-purple-400 w-4">{idx + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700 truncate">{t.topic}</span>
              <span className="text-xs font-extrabold text-emerald-600 flex-shrink-0">
                {t.trend_change_pct >= 1000
                  ? `+${parseFloat((t.trend_change_pct / 100).toFixed(1))}x`
                  : `+${t.trend_change_pct}%`}
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
              <div className="h-full bg-gradient-to-r from-purple-400 to-purple-600 rounded-full" style={{ width: `${Math.max(6, (t.trend_change_pct / maxGrowth) * 100)}%` }} />
            </div>
          </div>
          <span className="text-[10px] text-slate-400 w-16 text-right flex-shrink-0">{t.mention_count.toLocaleString()} mentions</span>
        </button>
      ))}
    </div>
  );
};

export default EmergingTopicsList;
