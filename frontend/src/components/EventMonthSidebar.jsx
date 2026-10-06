import React from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

export const MONTH_THEMES = [
  { key: 0,  label: 'Jan', full: 'January',   bg: 'bg-blue-50 dark:bg-blue-950/40',      border: 'border-blue-200 dark:border-blue-800',    text: 'text-blue-700 dark:text-blue-300',    dot: 'bg-blue-500',    activeBg: 'bg-blue-500 dark:bg-blue-600',         activeText: 'text-white',  activeBorder: 'border-blue-600 dark:border-blue-500',    cardBg: 'bg-blue-50 dark:bg-blue-950/30',      cardBorder: 'border-blue-200 dark:border-blue-800',    cardAccent: 'text-blue-600 dark:text-blue-400' },
  { key: 1,  label: 'Feb', full: 'February',  bg: 'bg-pink-50 dark:bg-pink-950/40',      border: 'border-pink-200 dark:border-pink-800',    text: 'text-pink-700 dark:text-pink-300',    dot: 'bg-pink-500',    activeBg: 'bg-pink-500 dark:bg-pink-600',         activeText: 'text-white',  activeBorder: 'border-pink-600 dark:border-pink-500',    cardBg: 'bg-pink-50 dark:bg-pink-950/30',      cardBorder: 'border-pink-200 dark:border-pink-800',    cardAccent: 'text-pink-600 dark:text-pink-400' },
  { key: 2,  label: 'Mar', full: 'March',     bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-800', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500', activeBg: 'bg-emerald-500 dark:bg-emerald-600',   activeText: 'text-white',  activeBorder: 'border-emerald-600 dark:border-emerald-500', cardBg: 'bg-emerald-50 dark:bg-emerald-950/30', cardBorder: 'border-emerald-200 dark:border-emerald-800', cardAccent: 'text-emerald-600 dark:text-emerald-400' },
  { key: 3,  label: 'Apr', full: 'April',     bg: 'bg-teal-50 dark:bg-teal-950/40',      border: 'border-teal-200 dark:border-teal-800',    text: 'text-teal-700 dark:text-teal-300',    dot: 'bg-teal-500',    activeBg: 'bg-teal-500 dark:bg-teal-600',         activeText: 'text-white',  activeBorder: 'border-teal-600 dark:border-teal-500',    cardBg: 'bg-teal-50 dark:bg-teal-950/30',      cardBorder: 'border-teal-200 dark:border-teal-800',    cardAccent: 'text-teal-600 dark:text-teal-400' },
  { key: 4,  label: 'May', full: 'May',       bg: 'bg-yellow-50 dark:bg-yellow-950/40',  border: 'border-yellow-200 dark:border-yellow-800', text: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-500', activeBg: 'bg-yellow-500 dark:bg-yellow-600',     activeText: 'text-white',  activeBorder: 'border-yellow-600 dark:border-yellow-500', cardBg: 'bg-yellow-50 dark:bg-yellow-950/30',  cardBorder: 'border-yellow-200 dark:border-yellow-800', cardAccent: 'text-yellow-600 dark:text-yellow-400' },
  { key: 5,  label: 'Jun', full: 'June',      bg: 'bg-orange-50 dark:bg-orange-950/40',  border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500', activeBg: 'bg-orange-500 dark:bg-orange-600',     activeText: 'text-white',  activeBorder: 'border-orange-600 dark:border-orange-500', cardBg: 'bg-orange-50 dark:bg-orange-950/30',  cardBorder: 'border-orange-200 dark:border-orange-800', cardAccent: 'text-orange-600 dark:text-orange-400' },
  { key: 6,  label: 'Jul', full: 'July',      bg: 'bg-red-50 dark:bg-red-950/40',        border: 'border-red-200 dark:border-red-800',      text: 'text-red-700 dark:text-red-300',      dot: 'bg-red-500',    activeBg: 'bg-red-500 dark:bg-red-600',           activeText: 'text-white',  activeBorder: 'border-red-600 dark:border-red-500',      cardBg: 'bg-red-50 dark:bg-red-950/30',        cardBorder: 'border-red-200 dark:border-red-800',      cardAccent: 'text-red-600 dark:text-red-400' },
  { key: 7,  label: 'Aug', full: 'August',    bg: 'bg-amber-50 dark:bg-amber-950/40',    border: 'border-amber-200 dark:border-amber-800',  text: 'text-amber-700 dark:text-amber-300',  dot: 'bg-amber-500',  activeBg: 'bg-amber-500 dark:bg-amber-600',       activeText: 'text-white',  activeBorder: 'border-amber-600 dark:border-amber-500',  cardBg: 'bg-amber-50 dark:bg-amber-950/30',    cardBorder: 'border-amber-200 dark:border-amber-800',  cardAccent: 'text-amber-600 dark:text-amber-400' },
  { key: 8,  label: 'Sep', full: 'September', bg: 'bg-purple-50 dark:bg-purple-950/40',  border: 'border-purple-200 dark:border-purple-800', text: 'text-purple-700 dark:text-purple-300', dot: 'bg-purple-500', activeBg: 'bg-purple-500 dark:bg-purple-600',     activeText: 'text-white',  activeBorder: 'border-purple-600 dark:border-purple-500', cardBg: 'bg-purple-50 dark:bg-purple-950/30',  cardBorder: 'border-purple-200 dark:border-purple-800', cardAccent: 'text-purple-600 dark:text-purple-400' },
  { key: 9,  label: 'Oct', full: 'October',   bg: 'bg-lime-50 dark:bg-lime-950/40',      border: 'border-lime-200 dark:border-lime-800',    text: 'text-lime-700 dark:text-lime-300',    dot: 'bg-lime-500',   activeBg: 'bg-lime-500 dark:bg-lime-600',         activeText: 'text-white',  activeBorder: 'border-lime-600 dark:border-lime-500',    cardBg: 'bg-lime-50 dark:bg-lime-950/30',      cardBorder: 'border-lime-200 dark:border-lime-800',    cardAccent: 'text-lime-600 dark:text-lime-400' },
  { key: 10, label: 'Nov', full: 'November',  bg: 'bg-slate-50 dark:bg-slate-800/40',    border: 'border-slate-200 dark:border-slate-700',  text: 'text-slate-700 dark:text-slate-300',  dot: 'bg-slate-500',  activeBg: 'bg-slate-500 dark:bg-slate-500',       activeText: 'text-white',  activeBorder: 'border-slate-600 dark:border-slate-400',  cardBg: 'bg-slate-50 dark:bg-slate-800/30',    cardBorder: 'border-slate-200 dark:border-slate-700',  cardAccent: 'text-slate-600 dark:text-slate-400' },
  { key: 11, label: 'Dec', full: 'December',  bg: 'bg-indigo-50 dark:bg-indigo-950/40',  border: 'border-indigo-200 dark:border-indigo-800', text: 'text-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-500', activeBg: 'bg-indigo-500 dark:bg-indigo-600',     activeText: 'text-white',  activeBorder: 'border-indigo-600 dark:border-indigo-500', cardBg: 'bg-indigo-50 dark:bg-indigo-950/30',  cardBorder: 'border-indigo-200 dark:border-indigo-800', cardAccent: 'text-indigo-600 dark:text-indigo-400' },
];

/**
 * @param {{ selectedMonth: number|null, selectedYear: number, monthCounts: Record<number, number>, onSelectMonth: (m: number|null) => void, onChangeYear: (y: number) => void, totalCount: number }} props
 */
const EventMonthSidebar = ({ selectedMonth, selectedYear, monthCounts = {}, onSelectMonth, onChangeYear, totalCount = 0 }) => {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  return (
    <div className="hidden lg:flex shrink-0 w-[140px] border-r border-gray-200 dark:border-slate-700 flex-col bg-white dark:bg-slate-900 overflow-hidden">

      {/* Year selector */}
      <div className="shrink-0 px-2 py-2.5 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center justify-between gap-1">
          <button
            onClick={() => onChangeYear(selectedYear - 1)}
            className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400 transition-colors"
            title="Previous year"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-bold text-gray-800 dark:text-gray-200 tabular-nums">{selectedYear}</span>
          <button
            onClick={() => onChangeYear(selectedYear + 1)}
            disabled={selectedYear >= currentYear}
            className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next year"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* "All" button */}
      <div className="shrink-0 px-1.5 pt-1.5">
        <button
          onClick={() => onSelectMonth(null)}
          className={`w-full flex items-center justify-between gap-1 px-2.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200
            ${selectedMonth === null
              ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800'
            }`}
        >
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3 w-3" />
            <span>All</span>
          </div>
          <span className={`text-[10px] font-bold tabular-nums min-w-[20px] text-center rounded-full px-1.5 py-0.5
            ${selectedMonth === null
              ? 'bg-white/20 dark:bg-gray-900/20'
              : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400'
            }`}>
            {totalCount}
          </span>
        </button>
      </div>

      {/* Month list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1 space-y-0.5" style={{ scrollbarWidth: 'thin' }}>
        {MONTH_THEMES.map((m) => {
          const count = monthCounts[m.key] || 0;
          const isSelected = selectedMonth === m.key;
          const isCurrent = selectedYear === currentYear && m.key === currentMonth;

          return (
            <button
              key={m.key}
              onClick={() => onSelectMonth(m.key)}
              className={`w-full flex items-center justify-between gap-1 px-2.5 py-[7px] rounded-lg text-[11px] font-medium transition-all duration-200 border
                ${isSelected
                  ? `${m.activeBg} ${m.activeBorder} ${m.activeText} shadow-md font-bold ring-1 ring-offset-1 ring-offset-white dark:ring-offset-slate-900 ${m.activeBorder.replace('border-', 'ring-')}`
                  : count > 0
                    ? `${m.bg} border-transparent ${m.text} hover:${m.border}`
                    : 'bg-transparent border-transparent text-gray-400 dark:text-gray-600 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-gray-500 dark:hover:text-gray-400'
                }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isSelected ? 'bg-white' : count > 0 ? m.dot : 'bg-gray-300 dark:bg-gray-700'} ${isCurrent && !isSelected ? 'ring-2 ring-offset-1 ring-amber-400' : ''}`} />
                <span className="truncate">{m.full}</span>
              </div>
              {count > 0 && (
                <span className={`text-[10px] font-bold tabular-nums min-w-[18px] text-center rounded-full px-1 py-0
                  ${isSelected
                    ? 'bg-white/30'
                    : 'bg-white/80 dark:bg-slate-800'
                  }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-2 py-1.5 border-t border-gray-100 dark:border-slate-800 text-center">
        <span className="text-[9px] text-gray-400 dark:text-gray-600 font-medium">{selectedYear} Events</span>
      </div>
    </div>
  );
};

export default EventMonthSidebar;
