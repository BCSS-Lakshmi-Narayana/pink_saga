import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

/** Direction + %-change indicator, reused for mention trend and topic trend. */
const TrendIndicator = ({ direction, changePct, className = '' }) => {
  const isRising = direction === 'rising';
  const isFalling = direction === 'falling';
  const Icon = isRising ? ArrowUpRight : isFalling ? ArrowDownRight : Minus;
  // Rising *volume* isn't inherently good or bad (could be positive buzz or a
  // brewing issue) — amber signals "more activity, worth a look" rather than
  // a hard positive/negative judgement.
  const color = isRising ? 'text-amber-600' : isFalling ? 'text-slate-400' : 'text-slate-400';

  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${color} ${className}`} title={`${direction} · ${changePct > 0 ? '+' : ''}${changePct}% vs previous period`}>
      <Icon className="h-3 w-3" />
      {changePct !== undefined && changePct !== null ? `${changePct > 0 ? '+' : ''}${changePct}%` : direction}
    </span>
  );
};

export default TrendIndicator;
