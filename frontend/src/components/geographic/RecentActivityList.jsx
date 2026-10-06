import React from 'react';
import SentimentPill from './SentimentPill';

const timeAgo = (dateStr) => {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

/** Latest mentions feed for a district — links out to the full Mentions page. Also used, with engagement-sorted data, as "Top Posts". */
const RecentActivityList = ({ items = [], loading, onViewAll, title = 'Recent Activity', showEngagement = false }) => {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse space-y-3">
        <div className="h-4 w-32 bg-slate-200 rounded" />
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded" />)}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {onViewAll && (
          <button type="button" onClick={onViewAll} className="text-[11px] font-semibold text-yellow-700 hover:text-yellow-800">
            View all →
          </button>
        )}
      </div>
      {!items.length ? (
        <div className="text-xs text-slate-400 py-6 text-center">No activity in this window</div>
      ) : (
        <ul className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
          {items.map((item) => (
            <li key={item.id} className="border-b border-slate-50 last:border-0 pb-2.5 last:pb-0">
              <div className="flex items-center gap-2 mb-1">
                <SentimentPill sentiment={item.sentiment} />
                <span className="text-[10px] text-slate-400 uppercase tracking-wide">{item.platform}</span>
                {item.city && <span className="text-[10px] text-slate-400">· {item.city}</span>}
                {showEngagement ? (
                  <span className="text-[10px] text-slate-500 ml-auto flex-shrink-0 font-semibold">{(item.engagement || 0).toLocaleString()} eng.</span>
                ) : (
                  <span className="text-[10px] text-slate-300 ml-auto flex-shrink-0">{timeAgo(item.post_date)}</span>
                )}
              </div>
              <p className="text-xs text-slate-600 line-clamp-2">{item.text || '(no text)'}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default RecentActivityList;
