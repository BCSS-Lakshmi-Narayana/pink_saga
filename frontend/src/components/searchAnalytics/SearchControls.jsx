import React from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Search,
  RefreshCw,
  Clock,
  Globe,
  Calendar,
  Layers,
  Filter
} from 'lucide-react';

const COUNTRIES = [
  { value: 'IN', label: 'India' },
  { value: 'US', label: 'USA' },
  { value: 'GLOBAL', label: 'Worldwide' }
];

const RANGES = [
  { value: '1', label: 'Past 24 hrs' },
  { value: '7', label: 'Past 7 days' },
  { value: '30', label: 'Past 30 days' },
  { value: '90', label: 'Past 90 days' },
  { value: '365', label: 'Past 12 months' },
  { value: '1825', label: 'Past 5 years' }
];

const PROPERTIES = [
  { value: 'web', label: 'Web Search' },
  { value: 'images', label: 'Image Search' },
  { value: 'news', label: 'News Search' },
  { value: 'youtube', label: 'YouTube Search' },
  { value: 'shopping', label: 'Shopping' }
];

// Trimmed Google Trends category set — most useful for incident & political tracking.
const CATEGORIES = [
  { value: 0, label: 'All categories' },
  { value: 16, label: 'News' },
  { value: 396, label: 'Politics' },
  { value: 19, label: 'Law & Government' },
  { value: 18, label: 'Business & Industrial' },
  { value: 174, label: 'Sports' },
  { value: 3, label: 'Arts & Entertainment' },
  { value: 5, label: 'Computers & Electronics' },
  { value: 14, label: 'Health' },
  { value: 13, label: 'Jobs & Education' },
  { value: 8, label: 'Finance' }
];

const EXAMPLES = [
  'KCR',
  'BRS',
  'Rythu Bharosa',
  'Revanth Reddy',
  'Paddy procurement',
  'Kaleshwaram'
];

const ChipRow = ({ icon: Icon, label, options, value, onChange, valueKey = 'value' }) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground min-w-[88px]">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
    {options.map((opt) => {
      const active = String(value) === String(opt[valueKey]);
      return (
        <button
          key={opt[valueKey]}
          type="button"
          onClick={() => onChange(opt[valueKey])}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            active
              ? 'bg-orange-600 border-orange-600 text-white shadow-sm'
              : 'bg-background border-border hover:bg-muted'
          }`}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

const SearchControls = ({
  query,
  setQuery,
  country,
  setCountry,
  range,
  setRange,
  property,
  setProperty,
  category,
  setCategory,
  autoRefresh,
  setAutoRefresh,
  onSubmit,
  loading,
  recent = [],
  onClearRecent
}) => {
  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <Card className="p-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Enter a keyword — e.g. "kcr", "kaleshwaram"'
              className="pl-10 h-11"
            />
          </div>
          <Button
            type="submit"
            disabled={loading || !query.trim()}
            className="h-11 px-6 bg-orange-600 hover:bg-orange-700 text-white"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Searching…
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" /> Analyze
              </>
            )}
          </Button>
        </div>

        <div className="space-y-2.5 border-t border-border pt-3">
          <ChipRow
            icon={Globe}
            label="Country"
            options={COUNTRIES}
            value={country}
            onChange={setCountry}
          />
          <ChipRow
            icon={Calendar}
            label="Time range"
            options={RANGES}
            value={range}
            onChange={setRange}
          />
          <ChipRow
            icon={Layers}
            label="Search type"
            options={PROPERTIES}
            value={property}
            onChange={setProperty}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground min-w-[88px]">
              <Filter className="h-3.5 w-3.5" />
              Category
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(parseInt(e.target.value, 10) || 0)}
              className="text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:bg-muted focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-colors"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>

            <label className="ml-auto inline-flex items-center gap-2 select-none cursor-pointer">
              <input
                type="checkbox"
                className="accent-orange-600"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              <span className="text-xs text-muted-foreground">Auto refresh every 5 min</span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">Examples:</span>
          {EXAMPLES.map((kw) => (
            <button
              key={kw}
              type="button"
              onClick={() => setQuery(kw)}
              className="text-xs px-2.5 py-1 rounded-md bg-muted hover:bg-muted/70 transition-colors"
            >
              {kw}
            </button>
          ))}

          {recent.length > 0 && (
            <>
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" /> Recent:
              </span>
              {recent.slice(0, 6).map((kw) => (
                <button
                  key={`recent-${kw}`}
                  type="button"
                  onClick={() => setQuery(kw)}
                  className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted transition-colors"
                >
                  {kw}
                </button>
              ))}
              <button
                type="button"
                onClick={onClearRecent}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                clear
              </button>
            </>
          )}
        </div>
      </form>
    </Card>
  );
};

export default SearchControls;
