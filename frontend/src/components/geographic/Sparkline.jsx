import React, { useMemo } from 'react';

/**
 * Minimal inline SVG sparkline — deliberately not a Recharts chart. KPI
 * tiles render several of these at once, and a plain polyline is orders of
 * magnitude cheaper than mounting a full chart per tile.
 */
const Sparkline = ({ data = [], color = '#d97706', height = 28, width = 88 }) => {
  const { points, lastY } = useMemo(() => {
    if (data.length < 2) return { points: '', lastY: 0 };
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = Math.max(max - min, 1);
    const stepX = width / (data.length - 1);
    const toY = (v) => height - ((v - min) / range) * (height - 4) - 2;
    const pts = data.map((v, i) => `${(i * stepX).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
    return { points: pts, lastY: toY(data[data.length - 1]) };
  }, [data, height, width]);

  if (data.length < 2) return <div style={{ width, height }} />;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      <circle cx={width} cy={lastY} r="2" fill={color} />
    </svg>
  );
};

export default Sparkline;
