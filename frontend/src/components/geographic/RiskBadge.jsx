import React from 'react';

const RISK_STYLES = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

/** Colored badge for a district/city/topic risk_level, with the numeric score. */
const RiskBadge = ({ level, score, className = '' }) => {
  const style = RISK_STYLES[level] || RISK_STYLES.low;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${style} ${className}`}>
      {level || 'low'}
      {score !== undefined && score !== null && <span className="opacity-70 font-semibold normal-case">· {score}</span>}
    </span>
  );
};

export default RiskBadge;
