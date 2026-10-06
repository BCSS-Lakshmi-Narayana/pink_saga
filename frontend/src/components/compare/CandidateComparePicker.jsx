import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { STATE_MLAS } from '../../data/stateMLAs';
import api from '../../lib/api';
import { partyColor, initialOf, titleCase } from './compareUtils';

// Only parties that hold a seat; vacant seats have no candidate to compare.
const PARTY_TABS = ['ALL', 'BRS', 'INC', 'BJP', 'AIMIM'];

const SentimentPreview = ({ idx }) => {
  if (idx == null) return <span className="text-[10px] text-slate-300">—</span>;
  const positive = idx > 4;
  const negative = idx < -4;
  const Icon = positive ? TrendingUp : negative ? TrendingDown : Minus;
  const cls = positive ? 'text-emerald-600 bg-emerald-50' : negative ? 'text-red-600 bg-red-50' : 'text-slate-500 bg-slate-100';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>
      <Icon className="h-3 w-3" /> {idx > 0 ? `+${idx}` : idx}
    </span>
  );
};

const CandidateComparePicker = ({ meKey, onSelect }) => {
  const [query, setQuery] = useState('');
  const [party, setParty] = useState('ALL');
  const [sentByKey, setSentByKey] = useState({});

  // One call fetches the sentiment index for every seat — lets each row show a
  // live preview so the pick isn't blind, without 40 individual requests.
  useEffect(() => {
    let cancelled = false;
    api.get('/constituency-intel/leaderboard', { params: { days: 90, limit: 200 } })
      .then((res) => {
        if (cancelled) return;
        const map = {};
        for (const r of res.data?.data || []) map[r.key] = r.sentiment_index;
        setSentByKey(map);
      })
      .catch(() => { if (!cancelled) setSentByKey({}); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STATE_MLAS
      .filter((m) => m.key !== meKey && !m.vacant)
      .filter((m) => (party === 'ALL' ? true : String(m.party).toUpperCase() === party))
      .filter((m) => !q
        || String(m.mla).toLowerCase().includes(q)
        || String(m.constituency).toLowerCase().includes(q))
      .sort((a, b) => a.constituency.localeCompare(b.constituency));
  }, [query, party, meKey]);

  return (
    <div className="flex flex-col h-full">
      {/* Search + party filter */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-100 bg-white sticky top-0 z-10">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search candidate or constituency…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition"
          />
        </div>
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {PARTY_TABS.map((p) => {
            const active = party === p;
            const pc = partyColor(p === 'ALL' ? 'DEFAULT' : p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => setParty(p)}
                className={`rounded-full px-3 py-1 text-xs font-semibold border transition-all ${
                  active ? 'text-white shadow-sm' : 'text-slate-600 bg-white border-slate-200 hover:border-slate-300'
                }`}
                style={active ? { background: pc.main, borderColor: pc.main } : undefined}
              >
                {p === 'ALL' ? 'All parties' : p}
              </button>
            );
          })}
          <span className="ml-auto text-[11px] text-slate-400">{rows.length} candidates</span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {rows.length === 0 ? (
          <div className="text-center text-sm text-slate-400 py-16">No candidates match your search.</div>
        ) : (
          <div className="space-y-1">
            {rows.map((m, i) => {
              const pc = partyColor(m.party);
              return (
                <motion.button
                  key={m.key}
                  type="button"
                  onClick={() => onSelect(m.constituency)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: Math.min(i * 0.012, 0.4) }}
                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all group"
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm"
                    style={{ background: pc.main }}
                  >
                    {initialOf(m.mla)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-800 truncate">{m.mla}</div>
                    <div className="text-[11px] text-slate-500 truncate">{titleCase(m.constituency)}</div>
                  </div>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0"
                    style={{ color: pc.text, background: pc.soft, borderColor: pc.ring }}
                  >
                    {m.party}
                  </span>
                  <SentimentPreview idx={sentByKey[m.key]} />
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
                </motion.button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CandidateComparePicker;
