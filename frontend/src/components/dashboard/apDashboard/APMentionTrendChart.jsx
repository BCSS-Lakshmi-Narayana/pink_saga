import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts';
import { format, parseISO } from 'date-fns';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 text-xs">
      <div className="font-semibold text-slate-700 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
        <span className="text-slate-500">Mentions:</span>
        <span className="font-semibold">{payload[0]?.value?.toLocaleString()}</span>
      </div>
    </div>
  );
};

/**
 * APMentionTrendChart — Total mentions area chart
 */
const APMentionTrendChart = ({ data, loading, filters }) => {
  const series = data?.series || [];
  const navigate = useNavigate();

  const handleChartClick = (state) => {
    if (state && state.activePayload && state.activePayload.length > 0) {
      const clickedData = state.activePayload[0].payload;
      const clickedDate = clickedData.date;
      
      const params = [
        `from=${encodeURIComponent(clickedDate)}`,
        `to=${encodeURIComponent(clickedDate)}`
      ];
      if (filters?.district) params.push(`location=${encodeURIComponent(filters.district)}`);
      if (filters?.platform && filters.platform !== 'all') params.push(`platform=${encodeURIComponent(filters.platform)}`);
      if (filters?.sentiment && filters.sentiment !== 'all') params.push(`sentiment=${encodeURIComponent(filters.sentiment)}`);

      navigate(`/grievances?${params.join('&')}`);
    }
  };

  const formatted = series.map(d => ({
    ...d,
    label: (() => {
      try { return format(parseISO(d.date), 'dd MMM'); }
      catch { return d.date; }
    })()
  }));

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 h-[260px] animate-pulse flex flex-col justify-between">
        <div className="h-4 w-32 bg-slate-200 rounded" />
        <div className="h-full bg-slate-100 rounded-lg mt-3" />
      </div>
    );
  }

  if (!formatted.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 h-[260px] flex flex-col justify-center items-center gap-2 text-slate-400">
        <span className="text-2xl">📊</span>
        <span className="text-xs">No mention data for this period</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 h-[260px] flex flex-col shadow-sm hover:shadow transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-slate-800">Mention Volume</h3>
        <span className="text-xs text-slate-400">Total mentions per day</span>
      </div>
      <ResponsiveContainer width="100%" height={190}>
        <AreaChart data={formatted} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} className="cursor-pointer">
          <defs>
            <linearGradient id="mentionGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#eab308" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="count"
            stroke="#ca8a04"
            strokeWidth={2}
            fill="url(#mentionGrad)"
            dot={{ r: 3, fill: '#ca8a04', cursor: 'pointer' }}
            activeDot={{
              r: 5,
              fill: '#a16207',
              cursor: 'pointer',
              onClick: (e, p) => {
                if (p?.payload?.date) {
                  const params = [
                    `from=${encodeURIComponent(p.payload.date)}`,
                    `to=${encodeURIComponent(p.payload.date)}`
                  ];
                  if (filters?.district) params.push(`location=${encodeURIComponent(filters.district)}`);
                  if (filters?.platform && filters.platform !== 'all') params.push(`platform=${encodeURIComponent(filters.platform)}`);
                  if (filters?.sentiment && filters.sentiment !== 'all') params.push(`sentiment=${encodeURIComponent(filters.sentiment)}`);
                  navigate(`/grievances?${params.join('&')}`);
                }
              }
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default APMentionTrendChart;
