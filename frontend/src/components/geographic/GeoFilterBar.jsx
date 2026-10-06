import React, { useState, useRef, useEffect } from 'react';
import { CalendarDays, Radio, Smile, Tag, X } from 'lucide-react';

const PLATFORM_OPTIONS = [
  { value: 'all', label: 'All Platforms' },
  { value: 'x', label: 'X (Twitter)' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

const SENTIMENT_OPTIONS = [
  { value: 'all', label: 'All Sentiment' },
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'neutral', label: 'Neutral' },
];

const selectClass = 'text-xs bg-transparent border-none outline-none text-slate-700 font-medium pr-1 cursor-pointer';

// ─── Date helpers ──────────────────────────────────────────────────────────
const toYMD = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const PRESETS = [
  {
    label: 'Today',
    resolve: () => { const t = new Date(); return { from: toYMD(t), to: toYMD(t) }; },
  },
  {
    label: 'Yesterday',
    resolve: () => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      return { from: toYMD(d), to: toYMD(d) };
    },
  },
  {
    label: 'This Week',
    resolve: () => {
      const now = new Date();
      const start = new Date(now); start.setDate(now.getDate() - 6);
      return { from: toYMD(start), to: toYMD(now) };
    },
  },
  {
    label: 'Last Week',
    resolve: () => {
      const now = new Date();
      const thisMon = new Date(now); thisMon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
      const lastSun = new Date(thisMon); lastSun.setDate(thisMon.getDate() - 1);
      return { from: toYMD(lastMon), to: toYMD(lastSun) };
    },
  },
  {
    label: 'This Month',
    resolve: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toYMD(start), to: toYMD(now) };
    },
  },
  {
    label: 'Last Month',
    resolve: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toYMD(start), to: toYMD(end) };
    },
  },
];

const fmtDisplay = (ymd) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}-${m}-${y}`;
};

const getTriggerLabel = (from, to) => {
  let f = from;
  let t = to;
  if (!f && !t) {
    const now = new Date();
    const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    f = toYMD(mon);
    t = toYMD(now);
  }
  for (const p of PRESETS) {
    const r = p.resolve();
    if (r.from === f && r.to === t) return p.label;
  }
  if (f && t) return `${fmtDisplay(f)} – ${fmtDisplay(t)}`;
  if (f) return `From ${fmtDisplay(f)}`;
  return `To ${fmtDisplay(f)}`;
};

// ─── DateRangePicker ───────────────────────────────────────────────────────
const DateRangePicker = ({ from, to, onApply }) => {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [draft, setDraft] = useState({ from: from || '', to: to || '' });
  const ref = useRef(null);

  // Sync draft when external from/to changes (e.g., clear button)
  useEffect(() => { setDraft({ from: from || '', to: to || '' }); }, [from, to]);

  // Close on outside click or Escape
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const keyHandler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, []);

  const triggerLabel = getTriggerLabel(from, to);

  const currentPresetLabel = (() => {
    let f = from;
    let t = to;
    if (!f && !t) {
      const now = new Date();
      const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      f = toYMD(mon);
      t = toYMD(now);
    }
    for (const p of PRESETS) { const r = p.resolve(); if (r.from === f && r.to === t) return p.label; }
    return null;
  })();

  const applyPreset = (p) => {
    const r = p.resolve();
    onApply(r.from, r.to);
    setOpen(false);
    setCustomMode(false);
  };

  const applyCustom = () => {
    onApply(draft.from, draft.to);
    setOpen(false);
    setCustomMode(false);
  };

  const CheckIcon = () => (
    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-500 text-white flex-shrink-0">
      <svg viewBox="0 0 10 10" fill="none" className="w-2.5 h-2.5">
        <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );

  return (
    <div className="relative" ref={ref}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 select-none"
        aria-label="Open date range picker"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarDays className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
        <span className={triggerLabel ? 'font-semibold text-slate-800' : 'text-slate-400'}>
          {triggerLabel || 'Date Range'}
        </span>
        <svg className="h-3 w-3 text-slate-400" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-xl shadow-xl w-52 py-1.5 overflow-hidden">
          {PRESETS.map((p) => {
            const isActive = p.label === currentPresetLabel;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors ${
                  isActive ? 'text-yellow-700 font-bold bg-yellow-50/40' : 'text-slate-700 hover:bg-slate-50 font-medium'
                }`}
              >
                <span>{p.label}</span>
                {isActive && <CheckIcon />}
              </button>
            );
          })}

          {/* Custom Range row */}
          <div className="border-t border-slate-100 mt-1 pt-1">
            <button
              type="button"
              onClick={() => setCustomMode((v) => !v)}
              className={`w-full flex items-center justify-between px-4 py-2 text-sm font-medium transition-colors ${
                customMode ? 'text-yellow-700 font-bold bg-yellow-50/60' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>Custom Range</span>
              {customMode && <CheckIcon />}
            </button>

            {customMode && (
              <div className="px-4 pb-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1.5">Custom Date Range</p>
                <div className="flex items-center gap-2">
                  <label htmlFor="geo-filter-date-from" className="text-[10px] w-5 font-semibold text-slate-500">From:</label>
                  <input
                    id="geo-filter-date-from"
                    type="date"
                    value={draft.from || ''}
                    max={draft.to || undefined}
                    onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-yellow-400 focus:border-yellow-400"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="geo-filter-date-to" className="text-[10px] w-5 font-semibold text-slate-500">To:</label>
                  <input
                    id="geo-filter-date-to"
                    type="date"
                    value={draft.to || ''}
                    min={draft.from || undefined}
                    onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-yellow-400 focus:border-yellow-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={applyCustom}
                  disabled={!draft.from && !draft.to}
                  className="w-full mt-1 text-xs font-bold text-white bg-yellow-600 hover:bg-yellow-700 disabled:opacity-40 rounded-lg py-1.5 transition-colors"
                >
                  Apply Range
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main GeoFilterBar ─────────────────────────────────────────────────────

/**
 * Compact, sticky filter bar shared across the Geo Intel tabs — Date range
 * (dropdown preset picker), Platform, Sentiment and (when the caller supplies
 * data-driven options) Category/Topic. Controlled component — the page owns
 * the values (synced to the URL via useSearchParams).
 */
const GeoFilterBar = ({ filters, onChange, className = '', topicOptions = [], sticky = false }) => {
  const update = (patch) => onChange({ ...filters, ...patch });

  const isActive = (filters.platform && filters.platform !== 'all')
    || (filters.sentiment && filters.sentiment !== 'all')
    || (filters.topic && filters.topic !== 'all')
    || filters.from || filters.to;

  const clearAll = () => onChange({ from: '', to: '', platform: 'all', sentiment: 'all', topic: 'all' });

  return (
    <div className={`flex flex-wrap items-center gap-1 bg-white border border-slate-200/80 rounded-xl px-1 py-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${sticky ? 'sticky top-0 z-30' : ''} ${className}`}>
      <DateRangePicker
        from={filters.from || ''}
        to={filters.to || ''}
        onApply={(from, to) => update({ from, to })}
      />

      <div className="w-px h-5 bg-slate-100" />

      <div className="flex items-center gap-1.5 px-2 py-1">
        <Radio className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
        <select value={filters.platform || 'all'} onChange={(e) => update({ platform: e.target.value })} className={selectClass} aria-label="Platform filter">
          {PLATFORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="w-px h-5 bg-slate-100" />

      <div className="flex items-center gap-1.5 px-2 py-1">
        <Smile className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
        <select value={filters.sentiment || 'all'} onChange={(e) => update({ sentiment: e.target.value })} className={selectClass} aria-label="Sentiment filter">
          {SENTIMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {topicOptions.length > 0 && (
        <>
          <div className="w-px h-5 bg-slate-100" />
          <div className="flex items-center gap-1.5 px-2 py-1">
            <Tag className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
            <select value={filters.topic || 'all'} onChange={(e) => update({ topic: e.target.value })} className={`${selectClass} max-w-[140px]`} aria-label="Category filter">
              <option value="all">All Categories</option>
              {topicOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </>
      )}

      {isActive && (
        <button type="button" onClick={clearAll} className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors ml-auto">
          <X className="h-3 w-3" /> Clear
        </button>
      )}
    </div>
  );
};

export default GeoFilterBar;
