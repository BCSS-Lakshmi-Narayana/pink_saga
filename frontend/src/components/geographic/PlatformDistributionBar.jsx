import React from 'react';

const PLATFORM_META = {
  x: { label: 'X (Twitter)', color: 'bg-slate-700' },
  twitter: { label: 'X (Twitter)', color: 'bg-slate-700' },
  facebook: { label: 'Facebook', color: 'bg-blue-600' },
  instagram: { label: 'Instagram', color: 'bg-pink-500' },
  youtube: { label: 'YouTube', color: 'bg-red-600' },
  whatsapp: { label: 'WhatsApp', color: 'bg-green-500' },
  unknown: { label: 'Other', color: 'bg-slate-300' },
};

/** Horizontal segmented bar showing platform mix — geography-agnostic, takes a raw {platform: count} map. */
const PlatformDistributionBar = ({ distribution = {}, className = '' }) => {
  const entries = Object.entries(distribution).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  if (!total) {
    return <div className={`text-[11px] text-slate-400 ${className}`}>No platform data</div>;
  }

  const sorted = entries.sort((a, b) => b[1] - a[1]);

  return (
    <div className={className}>
      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
        {sorted.map(([platform, count]) => {
          const meta = PLATFORM_META[platform] || PLATFORM_META.unknown;
          const pct = (count / total) * 100;
          return (
            <div
              key={platform}
              className={`h-full ${meta.color}`}
              style={{ width: `${pct}%` }}
              title={`${meta.label}: ${count.toLocaleString()} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
        {sorted.map(([platform, count]) => {
          const meta = PLATFORM_META[platform] || PLATFORM_META.unknown;
          return (
            <span key={platform} className="flex items-center gap-1 text-[10px] text-slate-500">
              <span className={`w-2 h-2 rounded-sm ${meta.color}`} />
              {meta.label} · {Math.round((count / total) * 100)}%
            </span>
          );
        })}
      </div>
    </div>
  );
};

export default PlatformDistributionBar;
