import React from 'react';
import { Link } from 'react-router-dom';

/*
 * Building blocks of the Intelligence Brief, shared by its tabs (Brief,
 * Social & Channels, Manifesto tracker) so every tab reads as one page.
 * Moved here unchanged from pages/CMDashboard.jsx.
 */

export const Card = ({ Icon, title, action, children, className = '' }) => (
  <section className={`bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col h-full ${className}`}>
    {(title || action) && (
      <header className="flex items-center justify-between gap-3 px-4 h-[48px] shrink-0 border-b border-slate-100">
        <h3 className="text-[13.5px] font-semibold text-slate-900 flex items-center gap-2 truncate">
          {Icon && <Icon className="h-4 w-4 text-slate-400 shrink-0" />}
          {title}
        </h3>
        {action}
      </header>
    )}
    <div className="p-4 flex-1 min-h-0">{children}</div>
  </section>
);

export const Pill = ({ tone, children }) => {
  const map = {
    positive: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    neutral: 'bg-amber-50 text-amber-800 ring-amber-200',
    negative: 'bg-rose-50 text-rose-700 ring-rose-200',
    muted: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ring-1 whitespace-nowrap shrink-0 ${map[tone] || map.muted}`}>
      {children}
    </span>
  );
};

/**
 * Headline counter. The footer carries the source split, because the figure
 * above it is a total across streams and the reader needs to know what fed it.
 */
export const Kpi = ({ label, value, share, footer, color, bg, Icon, to }) => {
  const Wrap = to ? Link : 'div';
  const wrapProps = to ? { to } : {};
  return (
  <Wrap {...wrapProps}
    className={`bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-3.5 flex flex-col h-full ${
      to ? 'hover:border-indigo-300 hover:shadow-[0_4px_12px_rgba(16,24,40,0.08)] transition-all group' : ''}`}>
    <div className="flex items-center justify-between gap-2">
      <span className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: bg }}>
        <Icon className="h-4 w-4" style={{ color }} />
      </span>
      <div className="text-[12px] font-medium truncate text-right" style={{ color }}>{label}</div>
    </div>
    <div className="flex items-baseline gap-1.5 mt-2.5">
      <span className="text-[26px] font-bold tracking-[-0.02em] text-slate-900 tabular-nums leading-none">
        {value}
      </span>
      {share !== undefined && share !== null && (
        <span className="text-[12px] text-slate-500 tabular-nums">({share}%)</span>
      )}
    </div>
    <div className="mt-auto pt-2.5 h-[24px] flex items-center gap-2 text-[11px] text-slate-500 truncate">
      {footer}
    </div>
  </Wrap>
  );
};
