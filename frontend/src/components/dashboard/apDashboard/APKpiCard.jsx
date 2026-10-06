import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

/**
 * APKpiCard — Revamped executive horizontal KPI tile.
 * Displays left circle icon, value next to trend badge, and combined footer info.
 */
const APKpiCard = ({
  title,
  value,
  subValue,
  change,
  up,
  icon: Icon,
  iconColor = 'text-white',
  iconBg = 'bg-yellow-600',
  tooltip,
  format = 'number',
  loading = false,
  compareLabel = 'vs Last 7 days',
  hideCompare = false,
  onClick
}) => {
  const formatValue = (v) => {
    if (v === null || v === undefined) return '—';
    if (format === 'pct') return `${v}%`;
    if (format === 'compact') {
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
      if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
      return v.toLocaleString();
    }
    return typeof v === 'number' ? v.toLocaleString() : v;
  };

  const trendColor = up === undefined ? 'text-slate-400'
    : up ? 'text-emerald-600' : 'text-red-500';
  const TrendIcon = up === undefined ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const changeAbs = Math.abs(change || 0);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 animate-pulse flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-slate-200 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-16 bg-slate-200 rounded" />
          <div className="h-5 w-24 bg-slate-200 rounded" />
          <div className="h-3 w-20 bg-slate-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 hover:shadow-md hover:border-rose-500 transition-all duration-200 flex items-center gap-3 ${onClick ? 'cursor-pointer' : ''}`}
    >
      {/* Left Icon Circle */}
      {Icon && (
        <div className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center ${iconBg} ${iconColor}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      )}

      {/* Right Content */}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">
          {title}
        </div>
        
        <div className="mt-0.5">
          <span className="text-lg font-extrabold text-slate-800 leading-none">
            {formatValue(value)}
          </span>
        </div>
        
        {/* Trend Badge */}
        {!hideCompare && change !== undefined && change !== null && (
          <div className="mt-1">
            <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-50 border border-slate-100/60 leading-none ${trendColor}`}>
              <TrendIcon className="h-3 w-3" />
              {changeAbs}%
            </span>
          </div>
        )}

        {/* Bottom compare line combining subValue percentage and compareLabel */}
        <div className="text-[9px] text-slate-400 font-semibold mt-1 truncate">
          {subValue ? `${subValue} of total` : ''}
          {subValue && !hideCompare ? ' · ' : ''}
          {!hideCompare ? compareLabel : ''}
        </div>
      </div>
    </div>
  );
};

export default APKpiCard;
