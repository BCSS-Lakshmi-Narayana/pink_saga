import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/** Consistent breadcrumb trail — crumbs = [{ label, to? }], last crumb is always the current page (no link). */
const GeoBreadcrumb = ({ crumbs = [] }) => (
  <nav className="flex items-center gap-1 text-[11px] text-slate-400 mb-1.5">
    {crumbs.map((c, i) => {
      const isLast = i === crumbs.length - 1;
      return (
        <React.Fragment key={`${c.label}-${i}`}>
          {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300" />}
          {c.to && !isLast ? (
            <Link to={c.to} className="hover:text-slate-600 font-medium transition-colors">{c.label}</Link>
          ) : (
            <span className={isLast ? 'text-slate-600 font-semibold' : 'font-medium'}>{c.label}</span>
          )}
        </React.Fragment>
      );
    })}
  </nav>
);

export default GeoBreadcrumb;
