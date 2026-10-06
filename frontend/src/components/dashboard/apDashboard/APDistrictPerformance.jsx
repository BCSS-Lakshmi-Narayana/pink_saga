import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * APDistrictPerformance — District leaderboard with sentiment bars
 */
const APDistrictPerformance = ({ data, loading, filters }) => {
  const navigate = useNavigate();
  const districts = data?.districts || [];

  // sentimentOverride wins over the active filter — this is what lets a click on
  // a specific bar segment (positive / neutral / negative) drill into just that
  // slice, while a click on the row name keeps whatever sentiment filter is set.
  const goToGrievances = (district, sentimentOverride) => {
    const params = [];
    if (filters?.from) params.push(`from=${encodeURIComponent(filters.from)}`);
    if (filters?.to) params.push(`to=${encodeURIComponent(filters.to)}`);
    params.push(`location=${encodeURIComponent(district)}`);
    if (filters?.platform && filters.platform !== 'all') params.push(`platform=${encodeURIComponent(filters.platform)}`);
    const sentiment = sentimentOverride
      ?? (filters?.sentiment && filters.sentiment !== 'all' ? filters.sentiment : null);
    if (sentiment) params.push(`sentiment=${encodeURIComponent(sentiment)}`);
    navigate(`/grievances?${params.join('&')}`);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
        <div className="h-4 w-44 bg-slate-200 rounded mb-4" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="py-2 border-b border-slate-100">
            <div className="flex justify-between mb-1.5">
              <div className="h-3 w-24 bg-slate-200 rounded" />
              <div className="h-3 w-8 bg-slate-200 rounded" />
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!districts.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col items-center justify-center gap-2 text-slate-400 min-h-[200px]">
        <span className="text-2xl">🗺️</span>
        <span className="text-xs">No district data for this period</span>
      </div>
    );
  }

  const maxTotal = Math.max(...districts.map(d => d.total), 1);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800">District Performance</h3>
        <div className="flex gap-3 text-[10px] text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-sm" />Pos</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-slate-400 rounded-sm" />Neu</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-sm" />Neg</span>
        </div>
      </div>

      <div className="space-y-2.5 max-h-[215px] overflow-y-auto pr-1">
        {districts.map(d => {
          const neutralPct = Math.max(100 - d.positivePct - d.negativePct, 0);
          const segments = [
            { key: 'positive', label: 'Positive', pct: d.positivePct, base: 'bg-emerald-500' },
            { key: 'neutral', label: 'Neutral', pct: neutralPct, base: 'bg-slate-400' },
            { key: 'negative', label: 'Negative', pct: d.negativePct, base: 'bg-red-500' },
          ];
          return (
            <div
              key={d.district}
              role="button"
              tabIndex={0}
              onClick={() => goToGrievances(d.district)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') goToGrievances(d.district); }}
              className="group cursor-pointer hover:bg-slate-50 rounded-lg px-1.5 py-0.5 transition-colors"
              title={`View all ${d.district} mentions — or click a bar segment for a sentiment`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-700 truncate" title={d.district}>
                  {d.district}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  <span className="text-[10px] text-emerald-600 font-semibold">{d.positivePct}%</span>
                  <span className="text-[10px] text-slate-500 font-semibold">{neutralPct.toFixed(1)}%</span>
                  <span className="text-[10px] text-red-500 font-semibold">{d.negativePct}%</span>
                  <span className="text-[10px] text-slate-500">{d.total.toLocaleString()}</span>
                </div>
              </div>
              {/* Stacked bar — each segment is its own click target that drills
                  into that sentiment, and lifts/brightens under the cursor so it's
                  clear which slice you're about to open. */}
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
                {segments.map(s => s.pct > 0 && (
                  <button
                    key={s.key}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); goToGrievances(d.district, s.key); }}
                    title={`${d.district} · ${s.label} (${Number(s.pct).toFixed(1)}%) — view in Grievances`}
                    aria-label={`View ${d.district} ${s.label} mentions`}
                    className={`h-full ${s.base} transition-all duration-150 hover:brightness-110 hover:saturate-150 hover:shadow-[inset_0_0_0_2px_rgba(255,255,255,0.65)] focus:outline-none focus:brightness-110 focus:shadow-[inset_0_0_0_2px_rgba(255,255,255,0.65)]`}
                    style={{ width: `${s.pct}%` }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default APDistrictPerformance;
