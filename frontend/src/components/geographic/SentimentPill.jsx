import React from 'react';

const SENTIMENT_STYLES = {
  positive: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  negative: 'bg-red-50 text-red-700 border-red-200',
  neutral: 'bg-slate-50 text-slate-700 border-slate-200',
  neutral: 'bg-slate-50 text-slate-700 border-slate-200',
  moderate: 'bg-slate-50 text-slate-700 border-slate-200', // retired name
};

/** Small colored sentiment badge — reused wherever a single sentiment label is shown. */
const SentimentPill = ({ sentiment, label, className = '' }) => {
  const key = (sentiment || 'neutral').toLowerCase();
  const style = SENTIMENT_STYLES[key] || SENTIMENT_STYLES.neutral;
  return (
    <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${style} ${className}`}>
      {label || key}
    </span>
  );
};

export default SentimentPill;
