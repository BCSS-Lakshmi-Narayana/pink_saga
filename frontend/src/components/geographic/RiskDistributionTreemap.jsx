import React from 'react';
import { Treemap, Tooltip, ResponsiveContainer } from 'recharts';
import { RISK_COLORS } from './sentimentScale';

const TreemapTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload || payload[0];
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="font-bold text-slate-800">{d.name}</div>
      <div className="text-slate-500 mt-1">Mentions Volume: <span className="text-slate-700 font-semibold">{(d.total_mentions || d.value || 0).toLocaleString()}</span></div>
      <div className="text-slate-500">Risk Index: <span className="text-slate-700 font-semibold">{d.risk_index}</span></div>
      <div className="text-slate-500">Risk Level: <span className="text-slate-700 font-semibold capitalize">{d.risk_level}</span></div>
      <div className="text-slate-400 text-[10px] mt-1 max-w-[180px] leading-snug">
        Block color follows Risk Level (AI risk score); Risk Index is a separate composite that also factors in volume and growth — the two can differ.
      </div>
    </div>
  );
};

const CustomTreemapContent = (props) => {
  const { x, y, width, height, onSelect } = props;
  const payload = props.payload || props;

  const name = payload.name;
  const total_mentions = payload.total_mentions || props.value || 0;
  const risk_level = payload.risk_level || 'low';

  const fill = RISK_COLORS[risk_level] || RISK_COLORS.low;

  // Show labels only if the rectangle is large enough to contain text
  const showLabel = width > 50 && height > 24;

  return (
    <g onClick={() => onSelect?.(payload)}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill,
          stroke: '#fff',
          strokeWidth: 1.5,
          cursor: 'pointer',
        }}
      />
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2 - 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#fff"
          fontSize={10}
          fontWeight="bold"
          style={{ pointerEvents: 'none' }}
        >
          {name}
        </text>
      )}
      {showLabel && width > 70 && height > 40 && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#ffffffd0"
          fontSize={8}
          style={{ pointerEvents: 'none' }}
        >
          {total_mentions.toLocaleString()}
        </text>
      )}
    </g>
  );
};

/**
 * Risk Distribution Treemap — represents districts as nested blocks.
 *   • Size of rectangle = Mention Volume (Mentions count)
 *   • Color of rectangle = Risk Level (Critical, High, Medium, Low)
 * (Previously named RiskMatrixScatter from an earlier scatter-plot version —
 * renamed to match what it actually renders.)
 */
const RiskDistributionTreemap = ({ districts = [], loading, onSelect }) => {
  const points = districts
    .map((d) => ({
      name: d.name,
      key: d.key,
      total_mentions: d.total_mentions,
      value: d.total_mentions, // Recharts uses 'value' as size key
      risk_index: d.risk_index,
      risk_level: d.risk_level,
    }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value); // Sort descending for optimal treemap layout

  if (loading) {
    return <div className="h-[260px] animate-pulse bg-white rounded-xl border border-slate-200" />;
  }

  if (!points.length) {
    return (
      <div className="h-[260px] flex items-center justify-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
        Not enough data yet
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800">Risk Distribution Treemap</h3>
        <div className="flex gap-3 text-[9px] text-slate-400 select-none">
          {Object.entries(RISK_COLORS).map(([k, c]) => (
            <span key={k} className="flex items-center gap-1 capitalize">
              <span className="w-2 h-2 rounded-full" style={{ background: c }} />
              {k}
            </span>
          ))}
        </div>
      </div>
      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>
          <Treemap
            data={points}
            dataKey="value"
            stroke="#fff"
            fill="#8884d8"
            content={<CustomTreemapContent onSelect={onSelect} />}
          >
            <Tooltip content={<TreemapTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default RiskDistributionTreemap;
