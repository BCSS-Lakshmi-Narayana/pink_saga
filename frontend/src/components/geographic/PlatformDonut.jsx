import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { PLATFORM_META } from './platformScale';

/** "Data Source Distribution" donut — state-wide platform mix. */
const PlatformDonut = ({ distribution = [], loading }) => {
  if (loading) {
    return <div className="h-[130px] flex items-center justify-center"><div className="h-24 w-24 rounded-full bg-slate-100 animate-pulse" /></div>;
  }
  if (!distribution.length) {
    return <div className="h-[130px] flex items-center justify-center text-xs text-slate-400">No platform data</div>;
  }

  return (
    <div className="flex items-center gap-3">
      <ResponsiveContainer width={110} height={110}>
        <PieChart>
          <Pie data={distribution} dataKey="count" nameKey="platform" cx="50%" cy="50%" innerRadius={32} outerRadius={52} stroke="#fff" strokeWidth={2}>
            {distribution.map((d) => (
              <Cell key={d.platform} fill={(PLATFORM_META[d.platform] || PLATFORM_META.unknown).color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v, _n, p) => [`${v.toLocaleString()} (${p.payload.pct}%)`, (PLATFORM_META[p.payload.platform] || PLATFORM_META.unknown).label]}
            contentStyle={{ fontSize: 11, borderRadius: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1">
        {distribution.map((d) => {
          const meta = PLATFORM_META[d.platform] || PLATFORM_META.unknown;
          return (
            <div key={d.platform} className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.color }} />
              {meta.label} <span className="text-slate-800 font-semibold">{d.pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PlatformDonut;
