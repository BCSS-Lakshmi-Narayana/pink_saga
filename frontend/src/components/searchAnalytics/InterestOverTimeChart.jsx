import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceDot,
  Legend
} from 'recharts';
import { Card } from '../ui/card';
import { ArrowUp, ArrowDown, Minus, Download } from 'lucide-react';

const downloadCsv = (points, keyword) => {
  if (!points.length) return;
  const csv = [
    'time,date,value',
    ...points.map((p) => `${(p.time || '').replace(/,/g, ' ')},${p.date || ''},${p.value}`)
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `interest-${keyword || 'trends'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const MomentumPill = ({ momentum }) => {
  const pct = momentum?.changePct ?? 0;
  const dir = momentum?.direction || 'flat';
  const tone =
    dir === 'up'
      ? 'text-emerald-500 bg-emerald-500/10'
      : dir === 'down'
      ? 'text-rose-500 bg-rose-500/10'
      : 'text-muted-foreground bg-muted';
  const Icon = dir === 'up' ? ArrowUp : dir === 'down' ? ArrowDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${tone}`}>
      <Icon className="h-3 w-3" />
      {pct > 0 ? `+${pct}%` : `${pct}%`}
      <span className="text-[10px] opacity-70 ml-0.5">vs earlier half</span>
    </span>
  );
};

const InterestOverTimeChart = ({ data, keyword, summary }) => {
  const points = Array.isArray(data) ? data : [];
  const peakPoint = useMemo(() => {
    if (!points.length) return null;
    return points.reduce((acc, p) => (p.value > (acc?.value ?? -1) ? p : acc), null);
  }, [points]);

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-xl font-heading font-semibold">Interest over time</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Google Trends search interest for <span className="font-medium text-foreground">"{keyword}"</span> (0–100 scale)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {summary?.momentum && <MomentumPill momentum={summary.momentum} />}
          <span className="text-xs text-muted-foreground">{points.length} points</span>
          <button
            type="button"
            onClick={() => downloadCsv(points, keyword)}
            disabled={!points.length}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            title="Download CSV"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      {points.length === 0 ? (
        <div className="h-[320px] flex items-center justify-center text-muted-foreground text-sm">
          No interest data available for this keyword.
        </div>
      ) : (
        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="interestFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f97316" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="time"
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 11 }}
                minTickGap={32}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 11 }}
                domain={[0, 100]}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
                formatter={(val) => [`${val} / 100`, 'Interest']}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#f97316"
                strokeWidth={2.5}
                fill="url(#interestFill)"
                name={keyword || 'Interest'}
              />
              {peakPoint && (
                <ReferenceDot
                  x={peakPoint.time}
                  y={peakPoint.value}
                  r={5}
                  fill="#f97316"
                  stroke="#fff"
                  strokeWidth={2}
                  label={{
                    value: `Peak ${peakPoint.value}`,
                    position: 'top',
                    fontSize: 11,
                    fill: 'hsl(var(--foreground))'
                  }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
};

export default InterestOverTimeChart;
