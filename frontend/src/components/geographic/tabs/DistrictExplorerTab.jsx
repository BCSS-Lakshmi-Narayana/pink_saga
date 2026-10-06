import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Search, ShieldAlert, ArrowUpDown } from 'lucide-react';
import RiskBadge from '../RiskBadge';
import DistrictDetailPanel from '../DistrictDetailPanel';
import { formatGeoName } from '../sentimentScale';

const SORT_OPTIONS = [
  { value: 'risk', label: 'Risk (high to low)', cmp: (a, b) => b.risk_index - a.risk_index },
  { value: 'mentions', label: 'Mentions (high to low)', cmp: (a, b) => b.total_mentions - a.total_mentions },
  { value: 'positivity', label: 'Positivity (high to low)', cmp: (a, b) => b.positive_pct - a.positive_pct },
  { value: 'name', label: 'Name (A–Z)', cmp: (a, b) => a.name.localeCompare(b.name) },
];

/**
 * District Explorer — searchable district list on the left, full detail
 * panel on the right. Reuses DistrictDetailPanel (the same component that
 * powers the standalone /geographic-intelligence/:districtKey deep link),
 * so district drill-down logic exists in exactly one place.
 */
const DistrictExplorerTab = ({ filters, initialDistrictKey, leaderboard, leaderboardLoading, leaderboardError, active = true }) => {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('risk');
  const [selectedKey, setSelectedKey] = useState(initialDistrictKey || null);
  // Applies the scoped user's preselected district exactly once on mount —
  // previously this ran on every `districts` identity change (i.e. every
  // filter change), silently reverting a multi-district user's manual
  // selection back to their first district whenever they tweaked a filter.
  const appliedInitialRef = useRef(false);

  const districts = useMemo(() => {
    const sorter = SORT_OPTIONS.find((o) => o.value === sort) || SORT_OPTIONS[0];
    return [...(leaderboard?.districts || [])].sort(sorter.cmp);
  }, [leaderboard, sort]);

  useEffect(() => {
    if (!appliedInitialRef.current && initialDistrictKey) {
      appliedInitialRef.current = true;
      setSelectedKey(initialDistrictKey);
      return;
    }
    if (!selectedKey && districts.length) setSelectedKey(districts[0].key);
  }, [districts, selectedKey, initialDistrictKey]);

  const filtered = search
    ? districts.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
    : districts;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)] gap-3 items-start">
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="p-3 border-b border-slate-100 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">District Explorer</h3>
            <span className="text-[10px] font-semibold text-slate-400">{districts.length} districts</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-yellow-500/30 focus-within:border-yellow-400 transition-all">
            <Search className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search district..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-xs bg-transparent border-none outline-none w-full text-slate-700"
            />
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <ArrowUpDown className="h-3 w-3 text-slate-400 flex-shrink-0" />
            <label htmlFor="district-explorer-sort" className="text-slate-400 font-semibold">Sort by</label>
            <select
              id="district-explorer-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-slate-700 font-semibold cursor-pointer"
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {leaderboardError && (
            <div className="text-[10px] text-red-600 font-semibold">{leaderboardError}</div>
          )}
        </div>
        <div className="max-h-[680px] overflow-y-auto">
          {leaderboardLoading ? (
            <div className="p-3 space-y-2 animate-pulse">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-10 bg-slate-50 rounded-lg" />)}
            </div>
          ) : !filtered.length ? (
            <div className="text-xs text-slate-400 text-center py-8 flex flex-col items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-slate-300" />
              No districts match "{search}"
            </div>
          ) : (
            filtered.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setSelectedKey(d.key)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-50 last:border-0 text-left transition-colors relative ${selectedKey === d.key ? 'bg-yellow-50' : 'hover:bg-slate-50'}`}
              >
                {selectedKey === d.key && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-yellow-600" />}
                <div className="min-w-0">
                  <span className={`block text-xs font-semibold truncate ${selectedKey === d.key ? 'text-yellow-800' : 'text-slate-700'}`}>{formatGeoName(d.name)}</span>
                  <span className="text-[9px] text-slate-400">{d.total_mentions.toLocaleString()} mentions</span>
                </div>
                <RiskBadge level={d.risk_level} />
              </button>
            ))
          )}
        </div>
      </div>

      <div className="min-w-0">
        {selectedKey ? (
          <DistrictDetailPanel districtKey={selectedKey} filters={filters} active={active} />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200/80 p-10 flex items-center justify-center text-slate-400 text-sm">
            Select a district to view its intelligence
          </div>
        )}
      </div>
    </div>
  );
};

export default DistrictExplorerTab;
