import React from 'react';
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { colorForRiskScore } from './sentimentScale';

/** Circular risk-score gauge (0-100) — used on the district snapshot panel. */
const RiskGauge = ({ score = 0, size = 96 }) => {
  const color = colorForRiskScore(score);
  const data = [{ value: score, fill: color }];

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={data}
          startAngle={90}
          endAngle={-270}
          innerRadius="72%"
          outerRadius="100%"
          barSize={8}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar background={{ fill: '#f1f5f9' }} dataKey="value" cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-extrabold text-slate-800 leading-none">{score}</span>
        <span className="text-[9px] text-slate-400 font-semibold mt-0.5">/100</span>
      </div>
    </div>
  );
};

export default RiskGauge;
