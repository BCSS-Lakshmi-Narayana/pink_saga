import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const COLORS = { positive: '#10b981', neutral: '#94a3b8', negative: '#ef4444' };

/** "Overall Political Mood" donut — dominant sentiment share, large center readout. */
const PoliticalMoodDonut = ({ positivePct = 0, neutralPct = 0, negativePct = 0, loading }) => {
  const data = [
    { key: 'positive', label: 'Positive', value: positivePct },
    { key: 'neutral', label: 'Neutral', value: neutralPct },
    { key: 'negative', label: 'Negative', value: negativePct },
  ];
  const dominant = [...data].sort((a, b) => b.value - a.value)[0];
  const hasData = positivePct + neutralPct + negativePct > 0;

  if (loading) {
    return <div className="h-full w-full animate-pulse flex items-center justify-center"><div className="h-24 w-24 rounded-full bg-slate-100" /></div>;
  }

  if (!hasData) {
    return (
      <div className="flex items-center gap-3">
        <div className="w-[92px] h-[92px] rounded-full border-4 border-dashed border-slate-200 flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] text-slate-400 text-center px-2">No data</span>
        </div>
        <div className="text-xs text-slate-400">No mentions in this window yet.</div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative w-[92px] h-[92px] flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={30} outerRadius={44} startAngle={90} endAngle={-270} stroke="#fff" strokeWidth={2}>
              {data.map((d) => <Cell key={d.key} fill={COLORS[d.key]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-lg font-extrabold text-slate-800 leading-none">{dominant.value}%</span>
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: COLORS[dominant.key] }}>{dominant.label}</div>
        {data.map((d) => (
          <div key={d.key} className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <span className="w-2 h-2 rounded-full" style={{ background: COLORS[d.key] }} />
            {d.label} {d.value}%
          </div>
        ))}
      </div>
    </div>
  );
};

export default PoliticalMoodDonut;
