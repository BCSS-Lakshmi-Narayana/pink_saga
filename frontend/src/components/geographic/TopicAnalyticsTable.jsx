import React from 'react';
import RiskBadge from './RiskBadge';
import TrendIndicator from './TrendIndicator';

/**
 * Per-district topic analytics: mention count, sentiment split, risk and
 * trend — the trend column directly answers "which issues are increasing
 * rapidly" (rows with trend === 'rising').
 */
const TopicAnalyticsTable = ({ topics = [], loading, title = 'Top Topics', subtitle }) => {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200/80 p-4 animate-pulse space-y-2">
        <div className="h-4 w-28 bg-slate-100 rounded mb-2" />
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-7 bg-slate-50 rounded" />)}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {subtitle && <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {!topics.length ? (
        <div className="text-xs text-slate-400 py-6 text-center">No classified topics in this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[560px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Topic</th>
                <th className="py-2 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Mentions</th>
                <th className="py-2 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 min-w-[100px]">Sentiment</th>
                <th className="py-2 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Risk</th>
                <th className="py-2 pl-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Trend</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t.topic} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors">
                  <td className="py-2.5 pr-3 text-xs font-semibold text-slate-700 max-w-[180px] truncate" title={t.topic}>{t.topic}</td>
                  <td className="py-2.5 px-3 text-xs font-semibold text-slate-600 tabular-nums">{t.mention_count.toLocaleString()}</td>
                  <td className="py-2.5 px-3">
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden flex w-20">
                      {t.positive > 0 && <div className="h-full bg-emerald-400" style={{ width: `${(t.positive / t.mention_count) * 100}%` }} />}
                      {t.neutral > 0 && <div className="h-full bg-slate-300" style={{ width: `${(t.neutral / t.mention_count) * 100}%` }} />}
                      {t.negative > 0 && <div className="h-full bg-red-400" style={{ width: `${(t.negative / t.mention_count) * 100}%` }} />}
                    </div>
                    <div className="text-[9px] font-semibold tabular-nums mt-0.5 whitespace-nowrap">
                      <span className="text-emerald-600">{t.positive}</span>
                      <span className="text-slate-300"> / </span>
                      <span className="text-red-500">{t.negative}</span>
                      <span className="text-slate-300"> / </span>
                      <span className="text-slate-500">{t.neutral}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3"><RiskBadge level={t.risk >= 75 ? 'critical' : t.risk >= 50 ? 'high' : t.risk >= 25 ? 'medium' : 'low'} score={t.risk} /></td>
                  <td className="py-2.5 pl-3"><TrendIndicator direction={t.trend} changePct={t.trend_change_pct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TopicAnalyticsTable;
