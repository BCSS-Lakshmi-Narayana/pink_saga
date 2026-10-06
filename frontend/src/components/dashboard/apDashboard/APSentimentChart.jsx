import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from 'recharts';
import { format, parseISO } from 'date-fns';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 text-xs">
      <div className="font-semibold text-slate-700 mb-2">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-500 capitalize">{p.dataKey}:</span>
          <span className="font-semibold text-slate-800">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
};

/**
 * APSentimentChart — Positive/Neutral/Negative line chart over time
 */
const APSentimentChart = ({ data, loading, filters }) => {
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
        <div className="h-4 w-40 bg-slate-200 rounded" />
        <div className="h-full bg-slate-100 rounded-lg mt-3" />
      </div>
    );
  }

  if (!formatted.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 h-[260px] flex flex-col justify-center items-center gap-2 text-slate-400">
        <span className="text-2xl">📈</span>
        <span className="text-xs">No sentiment data for this period</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 h-[260px] flex flex-col shadow-sm hover:shadow transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-slate-800">Sentiment Over Time</h3>
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Positive</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />Neutral</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Negative</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={formatted} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} className="cursor-pointer">
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Line type="monotone" dataKey="positive" stroke="#10b981" strokeWidth={2} dot={{ r: 2, fill: '#10b981' }} activeDot={{ r: 4, cursor: 'pointer', fill: '#059669', onClick: (e, p) => { if (p?.payload?.date) { const params = [`sentiment=positive`, `from=${encodeURIComponent(p.payload.date)}`, `to=${encodeURIComponent(p.payload.date)}`]; if (filters?.district) params.push(`location=${encodeURIComponent(filters.district)}`); if (filters?.platform && filters.platform !== 'all') params.push(`platform=${encodeURIComponent(filters.platform)}`); navigate(`/grievances?${params.join('&')}`); } } }} />
          <Line type="monotone" dataKey="neutral"  stroke="#94a3b8" strokeWidth={2} dot={{ r: 2, fill: '#94a3b8' }} activeDot={{ r: 4, cursor: 'pointer', fill: '#64748b', onClick: (e, p) => { if (p?.payload?.date) { const params = [`sentiment=neutral`, `from=${encodeURIComponent(p.payload.date)}`, `to=${encodeURIComponent(p.payload.date)}`]; if (filters?.district) params.push(`location=${encodeURIComponent(filters.district)}`); if (filters?.platform && filters.platform !== 'all') params.push(`platform=${encodeURIComponent(filters.platform)}`); navigate(`/grievances?${params.join('&')}`); } } }} />
          <Line type="monotone" dataKey="negative" stroke="#ef4444" strokeWidth={2} dot={{ r: 2, fill: '#ef4444' }} activeDot={{ r: 4, cursor: 'pointer', fill: '#dc2626', onClick: (e, p) => { if (p?.payload?.date) { const params = [`sentiment=negative`, `from=${encodeURIComponent(p.payload.date)}`, `to=${encodeURIComponent(p.payload.date)}`]; if (filters?.district) params.push(`location=${encodeURIComponent(filters.district)}`); if (filters?.platform && filters.platform !== 'all') params.push(`platform=${encodeURIComponent(filters.platform)}`); navigate(`/grievances?${params.join('&')}`); } } }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default APSentimentChart;
