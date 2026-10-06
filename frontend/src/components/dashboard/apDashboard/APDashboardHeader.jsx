import React, { useState, useCallback, useRef, useEffect } from 'react';
import { RefreshCw, SlidersHorizontal, Calendar, X, ChevronDown } from 'lucide-react';
import { STATE_MLAS, STATE_DISTRICTS } from '../../../data/stateMLAs';
import { BRAND } from '../../../config/partyMedia';

// The state's current districts, from the generated roster data.
const DISTRICTS = STATE_DISTRICTS;

/**
 * APDashboardHeader — Executive Filter Header with Dropdown Preset Date Range Picker.
 */
const APDashboardHeader = ({ filters, onFiltersChange, onRefresh, loading }) => {
  const [showFilters, setShowFilters] = useState(false);
  const [showDatePickerDropdown, setShowDatePickerDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDatePickerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const getYYYYMMDD = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getDetectedPreset = () => {
    const fromStr = filters.from;
    const toStr = filters.to;
    if (!fromStr || !toStr) return 'custom';

    const today = new Date();
    const getPresetDates = (presetKey) => {
      let f = new Date(), t = new Date();
      switch (presetKey) {
        case 'today':
          break;
        case 'yesterday':
          f.setDate(f.getDate() - 1);
          t.setDate(t.getDate() - 1);
          break;
        case 'this_week': {
          const day = f.getDay();
          const diff = f.getDate() - day + (day === 0 ? -6 : 1);
          f.setDate(diff);
          break;
        }
        case 'last_week': {
          const day = f.getDay();
          const diff = f.getDate() - day + (day === 0 ? -6 : 1) - 7;
          f.setDate(diff);
          t = new Date(f);
          t.setDate(t.getDate() + 6);
          break;
        }
        case 'this_month':
          f.setDate(1);
          break;
        case 'last_month':
          f = new Date(today.getFullYear(), today.getMonth() - 1, 1);
          t = new Date(today.getFullYear(), today.getMonth(), 0);
          break;
        default:
          return null;
      }
      return { from: getYYYYMMDD(f), to: getYYYYMMDD(t) };
    };

    const keys = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month'];
    for (const key of keys) {
      const dates = getPresetDates(key);
      if (dates && dates.from === fromStr && dates.to === toStr) {
        return key;
      }
    }
    return 'custom';
  };

  const activePreset = getDetectedPreset();

  const handlePresetClick = (presetKey) => {
    if (presetKey === 'custom') {
      return; // Handled below via date inputs
    }
    
    const today = new Date();
    let from, to;

    switch (presetKey) {
      case 'today':
        from = today;
        to = today;
        break;
      case 'yesterday':
        from = new Date();
        from.setDate(from.getDate() - 1);
        to = new Date(from);
        break;
      case 'this_week': {
        from = new Date();
        const day = from.getDay();
        const diff = from.getDate() - day + (day === 0 ? -6 : 1);
        from.setDate(diff);
        to = today;
        break;
      }
      case 'last_week': {
        from = new Date();
        const day = from.getDay();
        const diff = from.getDate() - day + (day === 0 ? -6 : 1) - 7;
        from.setDate(diff);
        to = new Date(from);
        to.setDate(to.getDate() + 6);
        break;
      }
      case 'this_month':
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        to = today;
        break;
      case 'last_month':
        from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        to = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      default:
        return;
    }

    onFiltersChange({
      from: getYYYYMMDD(from),
      to: getYYYYMMDD(to)
    });
    setShowDatePickerDropdown(false);
  };

  const formatDateLabel = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date)) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  };

  const getFormattedLabel = () => {
    if (!filters.from || !filters.to) return 'Select Date Range';
    return `${formatDateLabel(filters.from)} - ${formatDateLabel(filters.to)}`;
  };

  const PRESETS = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'this_week', label: 'This Week' },
    { key: 'last_week', label: 'Last Week' },
    { key: 'this_month', label: 'This Month' },
    { key: 'last_month', label: 'Last Month' },
    { key: 'custom', label: 'Custom Range' }
  ];

  const hasActiveFilters = filters.district || filters.sentiment || filters.platform;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm h-full flex flex-col justify-center">
      {/* Top row */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {/* Title */}
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 leading-tight">
            {BRAND.stateName} Political Intelligence Dashboard
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 hidden sm:block">
            Real-time intelligence across all {STATE_MLAS.length} {BRAND.stateName} assembly constituencies
          </p>
        </div>

        {/* Dropdown Date Range Picker */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowDatePickerDropdown(v => !v)}
            className="flex items-center gap-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:border-yellow-300 transition-all rounded-full px-4 py-2 text-xs font-bold text-slate-700 select-none shadow-sm"
          >
            <Calendar className="h-4 w-4 text-slate-400" />
            <span>{getFormattedLabel()}</span>
            <ChevronDown className="h-3 w-3 text-slate-400 ml-1" />
          </button>

          {showDatePickerDropdown && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg p-2.5 z-40 space-y-0.5">
              {PRESETS.map(p => (
                <button
                  key={p.key}
                  onClick={() => handlePresetClick(p.key)}
                  className={`w-full text-left px-3 py-1.5 text-xs font-semibold rounded-lg hover:bg-yellow-50 hover:text-yellow-700 transition-colors flex items-center justify-between ${
                    activePreset === p.key ? 'bg-yellow-50/80 text-yellow-700' : 'text-slate-700'
                  }`}
                >
                  <span>{p.label}</span>
                  {activePreset === p.key && <span className="text-[10px] bg-yellow-500 text-white font-bold px-1.5 py-0.2 rounded-full">✓</span>}
                </button>
              ))}

              {activePreset === 'custom' && (
                <div className="border-t border-slate-100 pt-2.5 mt-2 space-y-2">
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider px-1">Custom Date Range</div>
                  <div className="flex flex-col gap-1.5 px-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-slate-500 min-w-[32px]">From:</span>
                      <input
                        type="date"
                        value={filters.from}
                        max={filters.to}
                        onChange={e => onFiltersChange({ from: e.target.value })}
                        className="text-xs text-slate-700 border border-slate-200 rounded px-2 py-1 bg-slate-50 focus:bg-white outline-none flex-1"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-slate-500 min-w-[32px]">To:</span>
                      <input
                        type="date"
                        value={filters.to}
                        min={filters.from}
                        max={getYYYYMMDD(new Date())}
                        onChange={e => onFiltersChange({ to: e.target.value })}
                        className="text-xs text-slate-700 border border-slate-200 rounded px-2 py-1 bg-slate-50 focus:bg-white outline-none flex-1"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Filters toggle */}
        <button
          onClick={() => setShowFilters(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
            showFilters || hasActiveFilters
              ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {hasActiveFilters && (
            <span className="ml-1 bg-yellow-500 text-white text-[9px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
              !
            </span>
          )}
        </button>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-yellow-600 text-white text-xs font-semibold hover:bg-yellow-700 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="border-t border-slate-100 px-4 py-3 flex flex-wrap gap-3 bg-slate-50 rounded-b-xl">
          {/* District filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">District</label>
            <select
              value={filters.district}
              onChange={e => onFiltersChange({ district: e.target.value })}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 outline-none focus:border-yellow-400 min-w-[160px]"
            >
              <option value="">All Districts</option>
              {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {/* Sentiment filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Sentiment</label>
            <select
              value={filters.sentiment}
              onChange={e => onFiltersChange({ sentiment: e.target.value })}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 outline-none focus:border-yellow-400 min-w-[130px]"
            >
              <option value="">All Sentiments</option>
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
            </select>
          </div>

          {/* Platform filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Platform</label>
            <select
              value={filters.platform}
              onChange={e => onFiltersChange({ platform: e.target.value })}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 outline-none focus:border-yellow-400 min-w-[130px]"
            >
              <option value="">All Platforms</option>
              <option value="x">X (Twitter)</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="youtube">YouTube</option>
            </select>
          </div>

          {/* Clear filters */}
          {hasActiveFilters && (
            <div className="flex items-end">
              <button
                onClick={() => onFiltersChange({ district: '', sentiment: '', platform: '', party: '' })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"
              >
                <X className="h-3 w-3" />
                Clear Filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default APDashboardHeader;
