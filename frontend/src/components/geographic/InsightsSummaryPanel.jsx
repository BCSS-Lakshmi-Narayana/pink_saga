import React from 'react';
import { Sparkles } from 'lucide-react';

const TONE_DOT = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  positive: 'bg-emerald-500',
  info: 'bg-blue-500',
};

/** Rule-based "insights summary" card — key observations distilled from the current view's data. */
const InsightsSummaryPanel = ({ insights = [], loading, title = 'Insights Summary' }) => (
  <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-4 text-white">
    <div className="flex items-center gap-2 mb-3">
      <span className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center">
        <Sparkles className="h-3.5 w-3.5 text-amber-300" />
      </span>
      <h3 className="text-sm font-bold">{title}</h3>
    </div>
    {loading ? (
      <div className="space-y-2.5 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-3 bg-white/10 rounded" />)}
      </div>
    ) : (
      <ul className="space-y-2.5">
        {insights.map((note, i) => (
          <li key={i} className="text-xs text-slate-200 flex gap-2 leading-relaxed">
            <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${TONE_DOT[note.tone] || TONE_DOT.info}`} />
            {note.text}
          </li>
        ))}
      </ul>
    )}
  </div>
);

export default InsightsSummaryPanel;
