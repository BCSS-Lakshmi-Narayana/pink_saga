import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Check, ChevronDown, ExternalLink, Globe, Newspaper, Search, RefreshCw, Loader2, Filter, AlertTriangle, X } from 'lucide-react';
import api from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar as CalendarComponent } from '../components/ui/calendar';
import { format } from 'date-fns';
import { RssNewsCard } from '../components/grievances/RssNewsCard';
import { STATE_DISTRICTS } from '../data/stateMLAs';
import { fromDateOnly, rangeToDateStrings, isWithinDays } from '../lib/dateRange';

const SUGGESTED_QUERIES = [
  'KCR BRS Telangana',
  'Telangana paddy procurement farmers',
  'Telangana BC reservation local body polls',
  'Rythu Bharosa beneficiaries Telangana',
  'Kaleshwaram project inquiry',
  'BRS 2028 assembly election preparations'
];

// District filter options — STATE_DISTRICTS matches the district names the Blura
// engine writes (political_config.DISTRICTS); both come from state_geo.json.

// A dropdown filter styled to match the app's pill-shaped filter bar — built on
// Popover instead of a native <select> so the highlighted/selected row can be
// styled directly (native select popups can't be restyled cross-browser).
const FilterDropdown = ({ value, options, onChange, placeholder, width = 'w-[150px]', menuWidth = 'w-56' }) => {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`h-10 ${width} shrink-0 flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-colors hover:border-slate-400 focus:ring-2 focus:ring-red-500/30 focus:border-red-400 ${open ? 'ring-2 ring-red-500/30 border-red-400' : ''}`}
        >
          <span className="truncate">{selected?.label || placeholder}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={`${menuWidth} p-1 max-h-72 overflow-y-auto`}>
        {options.map((opt) => {
          const isSelected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left transition-colors ${
                isSelected ? 'bg-red-700 text-white font-semibold' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Check className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
              <span className="truncate">{opt.label}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};

const PublicWebArticles = () => {
  const [activeTab, setActiveTab] = useState('monitored'); // 'monitored' or 'live'

  // Live News Scrape Tab States
  const [searchText, setSearchText] = useState('');
  const [liveArticles, setLiveArticles] = useState([]);
  const [liveSourceFilter, setLiveSourceFilter] = useState('All');
  const [isLiveLoading, setIsLiveLoading] = useState(false);
  const [liveErrorMessage, setLiveErrorMessage] = useState('');
  const [liveDateRange, setLiveDateRange] = useState({ start: '', end: '' });

  // Monitored Database Feed States
  const [dbArticles, setDbArticles] = useState([]);
  /**
   * Filters can arrive in the URL so a figure elsewhere in the app can link to
   * the rows behind it:
   *   ?stance=opposing&from=2026-09-01&to=2026-09-29&district=Hyderabad
   * `stance` is the client-relative verdict (political_stance), NOT the raw
   * `sentiment` tone, which defaults to 'neutral' on unscored articles.
   */
  const [searchParams] = useSearchParams();
  const [dbSearch, setDbSearch] = useState(() => searchParams.get('search') || '');
  // What is typed in the box; it is committed to `dbSearch` (and so to the API) after a short pause, not per keystroke.
  const [dbSearchInput, setDbSearchInput] = useState(() => searchParams.get('search') || '');
  useEffect(() => {
    if (dbSearchInput === dbSearch) return undefined;
    const t = setTimeout(() => setDbSearch(dbSearchInput), 300);
    return () => clearTimeout(t);
  }, [dbSearchInput, dbSearch]);
  const [dbStance, setDbStance] = useState(() => searchParams.get('stance') || 'all');
  const [dbSource, setDbSource] = useState(() => searchParams.get('source') || 'all');
  const [dbCategory, setDbCategory] = useState(() => searchParams.get('category') || 'all');
  const [dbDistrict, setDbDistrict] = useState(() => searchParams.get('district') || 'all');
  const [dbLanguage, setDbLanguage] = useState(() => searchParams.get('language') || 'all');
  const [dbDateRange, setDbDateRange] = useState(() => ({
    start: searchParams.get('from') || '',
    end: searchParams.get('to') || '',
  }));
  const [isDbLoading, setIsDbLoading] = useState(false);
  const [isDbLoadingMore, setIsDbLoadingMore] = useState(false);
  const [dbPagination, setDbPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [dbErrorMessage, setDbErrorMessage] = useState('');

  const hasDbFilters = Boolean(
    dbSearch.trim() ||
    dbSearchInput.trim() ||
    (dbStance && dbStance !== 'all') ||
    (dbSource && dbSource !== 'all') ||
    (dbCategory && dbCategory !== 'all') ||
    (dbDistrict && dbDistrict !== 'all') ||
    (dbLanguage && dbLanguage !== 'all') ||
    dbDateRange.start ||
    dbDateRange.end
  );

  const clearDbFilters = () => {
    setDbSearch('');
    setDbSearchInput('');
    setDbStance('all');
    setDbSource('all');
    setDbCategory('all');
    setDbDistrict('all');
    setDbLanguage('all');
    setDbDateRange({ start: '', end: '' });
  };

  const hasLiveFilters = Boolean(
    (liveSourceFilter && liveSourceFilter !== 'All') ||
    liveDateRange.start ||
    liveDateRange.end
  );

  const clearLiveFilters = () => {
    setLiveSourceFilter('All');
    setLiveDateRange({ start: '', end: '' });
  };

  // ── Monitored Feed Database Fetch ──
  // Only the most recent request may update the screen: a slow response for an older filter must not overwrite
  // newer results (or append page 2 of the previous filter onto the new list).
  const dbRequestRef = useRef(0);
  const fetchDbArticles = useCallback(async (page = 1, append = false) => {
    const requestId = ++dbRequestRef.current;
    if (page === 1) { setIsDbLoading(true); setIsDbLoadingMore(false); }
    else setIsDbLoadingMore(true);
    setDbErrorMessage('');
    try {
      const response = await api.get('/news', {
        params: {
          page,
          limit: 20,
          search: dbSearch || undefined,
          district: dbDistrict !== 'all' ? dbDistrict : undefined,
          category: dbCategory !== 'all' ? dbCategory : undefined,
          stance: dbStance !== 'all' ? dbStance : undefined,
          source: dbSource !== 'all' ? dbSource : undefined,
          language: dbLanguage !== 'all' ? dbLanguage : undefined,
          startDate: dbDateRange.start || undefined,
          endDate: dbDateRange.end || undefined,
        }
      });
      if (requestId !== dbRequestRef.current) return;
      const { articles = [], pagination } = response.data;
      setDbArticles(prev => append ? [...prev, ...articles] : articles);
      setDbPagination(pagination || { page: 1, pages: 1, total: 0, limit: 20 });
    } catch (error) {
      if (requestId !== dbRequestRef.current) return;
      console.error('[RSS DB] Fetch failed:', error);
      setDbErrorMessage('Failed to load database RSS feed articles.');
    } finally {
      if (requestId === dbRequestRef.current) {
        setIsDbLoading(false);
        setIsDbLoadingMore(false);
      }
    }
  }, [dbSearch, dbStance, dbSource, dbCategory, dbDistrict, dbLanguage, dbDateRange]);

  // ── Live news search API ──
  const liveRequestRef = useRef(0);
  const liveAutoRanRef = useRef(false);
  const runLiveSearch = useCallback(async (overrideQuery) => {
    const query = typeof overrideQuery === 'string' ? overrideQuery.trim() : searchText.trim();
    if (!query) {
      setLiveErrorMessage('Enter keywords to scrape public web articles.');
      setLiveArticles([]);
      return;
    }

    const requestId = ++liveRequestRef.current;
    try {
      setIsLiveLoading(true);
      setLiveErrorMessage('');
      // A new search has a new set of sources; one picked for the previous results must not linger (even if this search fails).
      setLiveSourceFilter('All');
      const response = await api.get('/web-articles/search', {
        params: { q: query, limit: 40 }
      });
      if (requestId !== liveRequestRef.current) return;
      setLiveArticles(Array.isArray(response.data?.articles) ? response.data.articles : []);
    } catch (error) {
      if (requestId !== liveRequestRef.current) return;
      setLiveArticles([]);
      setLiveErrorMessage(error?.response?.data?.message || 'Failed to scrape public web articles for this query.');
    } finally {
      if (requestId === liveRequestRef.current) setIsLiveLoading(false);
    }
  }, [searchText]);

  // Initial load / filter changes. Live tab auto-runs the first suggested query once.
  useEffect(() => {
    if (activeTab === 'monitored') {
      fetchDbArticles(1, false);
    } else if (activeTab === 'live' && !liveAutoRanRef.current) {
      // First visit only: seed a default search. Never again, so returning to the tab after an empty or failed
      // search does not replace what the person typed.
      liveAutoRanRef.current = true;
      if (!searchText.trim()) {
        setSearchText(SUGGESTED_QUERIES[0]);
        runLiveSearch(SUGGESTED_QUERIES[0]);
      } else {
        runLiveSearch(searchText);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, dbSearch, dbStance, dbSource, dbCategory, dbDistrict, dbLanguage, dbDateRange, fetchDbArticles]);

  const liveSources = useMemo(() => {
    const items = liveArticles.map((article) => article.source);
    return ['All', ...Array.from(new Set(items))];
  }, [liveArticles]);

  const filteredLiveArticles = useMemo(() => {
    return liveArticles.filter((article) => {
      const inSource = liveSourceFilter === 'All' || article.source === liveSourceFilter;
      if (!inSource) return false;
      return isWithinDays(article.publishedAt, liveDateRange.start, liveDateRange.end);
    }).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }, [liveArticles, liveSourceFilter, liveDateRange]);

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-6">

      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-xl bg-violet-600 text-white inline-flex items-center justify-center shadow-md">
            <Newspaper className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Web Articles & News Feeds</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Live updates and keyword triaging from Telangana & National RSS feeds.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs list */}
      <div className="border-b border-slate-200">
        <div className="flex gap-6">
          <button
            onClick={() => setActiveTab('monitored')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all duration-200 ${
              activeTab === 'monitored'
                ? 'border-violet-600 text-violet-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Monitored RSS Feed
          </button>
          <button
            onClick={() => setActiveTab('live')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all duration-200 ${
              activeTab === 'live'
                ? 'border-violet-600 text-violet-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Live News Search (Scraper)
          </button>
        </div>
      </div>

      {/* TAB 1: MONITORED RSS FEED (DB) */}
      {activeTab === 'monitored' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={dbSearchInput}
                onChange={(e) => {
                  setDbSearchInput(e.target.value);
                }}
                placeholder="Search articles..."
                className="pl-9 h-10 text-sm"
              />
            </div>

            {/* Category Filter */}
            <FilterDropdown
              value={dbCategory}
              onChange={setDbCategory}
              placeholder="All Categories"
              options={[
                { value: 'all', label: 'All Categories' },
                ...['crime', 'politics', 'development', 'agriculture', 'health', 'education', 'law_order', 'communal', 'accident', 'sports', 'culture', 'general'].map((c) => ({
                  value: c,
                  label: c.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
                })),
              ]}
            />

            {/* District Filter */}
            <FilterDropdown
              value={dbDistrict}
              onChange={setDbDistrict}
              placeholder="All Districts"
              options={[{ value: 'all', label: 'All Districts' }, ...STATE_DISTRICTS.map((d) => ({ value: d, label: d }))]}
            />

            {/* Language Filter */}
            <FilterDropdown
              value={dbLanguage}
              onChange={setDbLanguage}
              placeholder="All Languages"
              width="w-[160px]"
              menuWidth="w-44"
              options={[
                { value: 'all', label: 'All Languages' },
                { value: 'en', label: 'English' },
                { value: 'hi', label: 'Hindi' },
                { value: 'te', label: 'Telugu' },
                { value: 'ur', label: 'Urdu' },
              ]}
            />

            {/* Date Range */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={`h-10 gap-1.5 text-sm font-medium px-3 rounded-lg border-slate-300 ${dbDateRange.start ? 'border-red-400 bg-red-50 text-red-700' : 'text-slate-700'}`}>
                  <CalendarDays className="h-4 w-4" />
                  {dbDateRange.start ? (
                    <span>
                      {format(fromDateOnly(dbDateRange.start) || new Date(), 'dd MMM')}
                      {dbDateRange.end ? ` – ${format(fromDateOnly(dbDateRange.end) || new Date(), 'dd MMM')}` : ''}
                    </span>
                  ) : 'Date Range'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <CalendarComponent
                  mode="range"
                  selected={{
                    from: fromDateOnly(dbDateRange.start),
                    to: fromDateOnly(dbDateRange.end)
                  }}
                  onSelect={(range) => {
                    setDbDateRange(rangeToDateStrings(range));
                  }}
                  numberOfMonths={2}
                  initialFocus
                />
                {dbDateRange.start && (
                  <div className="flex justify-end px-3 pb-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-500" onClick={() => setDbDateRange({ start: '', end: '' })}>
                      Clear dates
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            {/* Stats & Refresh */}
            <div className="flex items-center gap-2">
              {!isDbLoading && dbPagination.total > 0 && (
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  <span className="font-semibold text-slate-700">{dbPagination.total.toLocaleString()}</span> articles
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchDbArticles(1, false)}
                disabled={isDbLoading}
                className="h-8 gap-1.5 text-xs text-violet-600 border-violet-200 hover:bg-violet-50"
              >
                <RefreshCw className={`h-3 w-3 ${isDbLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              {hasDbFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearDbFilters}
                  className="h-8 gap-1 text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 border border-slate-200 rounded-lg px-2.5 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear Filters
                </Button>
              )}
            </div>
          </div>

          {/* DB Feed Articles List */}
          <div className="space-y-4">
            {dbErrorMessage && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="p-4 text-sm text-red-700">
                  {dbErrorMessage}
                </CardContent>
              </Card>
            )}

            {isDbLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4 animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 bg-slate-200 rounded-full shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-slate-200 rounded w-1/3" />
                        <div className="h-3 bg-slate-200 rounded w-1/4" />
                      </div>
                    </div>
                    <div className="h-4 bg-slate-200 rounded w-3/4" />
                    <div className="h-16 bg-slate-200 rounded w-full" />
                  </div>
                ))}
              </div>
            ) : dbArticles.length === 0 ? (
              <Card className="border-dashed border-slate-300 bg-slate-50/70">
                <CardContent className="p-12 text-center space-y-2">
                  <Newspaper className="h-8 w-8 text-slate-400 mx-auto" />
                  <div className="text-slate-700 font-medium">No monitored articles found</div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {dbArticles.map((article) => (
                    <RssNewsCard key={article._id || article.source_url} article={article} />
                  ))}
                </div>

                {/* DB Load More */}
                {dbPagination.page < dbPagination.pages && (
                  <div className="flex justify-center pt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        const nextPage = dbPagination.page + 1;
                        fetchDbArticles(nextPage, true);
                      }}
                      disabled={isDbLoadingMore}
                      className="gap-2 text-sm text-violet-600 border-violet-200 hover:bg-violet-50"
                    >
                      {isDbLoadingMore ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                        </>
                      ) : (
                        `Load More (Page ${dbPagination.page + 1} of ${dbPagination.pages})`
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: LIVE GOOGLE NEWS SEARCH */}
      {activeTab === 'live' && (
        <div className="space-y-4">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4 sm:p-5 space-y-4">
              <div className="text-xs text-slate-500">
                Search keywords to scrape Google News directly on the fly.
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') runLiveSearch();
                    }}
                    placeholder="Search keywords (example: KCR Kaleshwaram)"
                    className="h-11 pl-9"
                  />
                </div>
                <Button
                  type="button"
                  onClick={runLiveSearch}
                  disabled={isLiveLoading}
                  className="h-11 sm:px-6 bg-red-700 hover:bg-red-800 text-white font-semibold"
                >
                  {isLiveLoading ? 'Searching...' : 'Search'}
                </Button>
              </div>

              <div className="overflow-x-auto">
                <div className="flex gap-2 min-w-max pr-1">
                  {SUGGESTED_QUERIES.map((query) => (
                    <Button
                      key={query}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-full bg-white hover:bg-red-50 hover:text-red-700"
                      onClick={() => {
                        setSearchText(query);
                        runLiveSearch(query);
                      }}
                    >
                      {query}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-1">
                <label className="text-xs text-slate-500 shrink-0">
                  Filter by source
                </label>
                <FilterDropdown
                  value={liveSourceFilter}
                  onChange={setLiveSourceFilter}
                  placeholder="All"
                  width="w-full sm:w-[180px]"
                  options={liveSources.map((source) => ({ value: source, label: source }))}
                />

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={`h-10 gap-1.5 text-sm font-medium px-3 rounded-lg border-slate-300 ${liveDateRange.start ? 'border-red-400 bg-red-50 text-red-700' : 'text-slate-700'}`}>
                      <CalendarDays className="h-4 w-4" />
                      {liveDateRange.start ? (
                        <span>
                          {format(fromDateOnly(liveDateRange.start) || new Date(), 'dd MMM')}
                          {liveDateRange.end ? ` – ${format(fromDateOnly(liveDateRange.end) || new Date(), 'dd MMM')}` : ''}
                        </span>
                      ) : 'Date Range'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <CalendarComponent
                      mode="range"
                      selected={{
                        from: fromDateOnly(liveDateRange.start),
                        to: fromDateOnly(liveDateRange.end)
                      }}
                      onSelect={(range) => {
                        setLiveDateRange(rangeToDateStrings(range));
                      }}
                      numberOfMonths={2}
                      initialFocus
                    />
                    {liveDateRange.start && (
                      <div className="flex justify-end px-3 pb-2">
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-500" onClick={() => setLiveDateRange({ start: '', end: '' })}>
                          Clear dates
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>

                {hasLiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearLiveFilters}
                    className="h-8 gap-1 text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 border border-slate-200 rounded-lg px-2.5 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear Filters
                  </Button>
                )}

                <div className="sm:ml-auto text-xs text-slate-500">
                  Showing {filteredLiveArticles.length} article{filteredLiveArticles.length === 1 ? '' : 's'}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {liveErrorMessage && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="p-4 text-sm text-red-700">
                  {liveErrorMessage}
                </CardContent>
              </Card>
            )}

            {isLiveLoading && (
              <Card className="border-slate-200">
                <CardContent className="p-6 text-sm text-slate-600 flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-red-700" />
                  Scraping public web articles for your keywords...
                </CardContent>
              </Card>
            )}

            {/* Render live articles as cards */}
            {!isLiveLoading && filteredLiveArticles.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredLiveArticles.map((article) => {
                  const adaptedArticle = {
                    ...article,
                    source_name: article.source,
                    source_url: article.url,
                    published_date: article.publishedAt,
                    category: 'general'
                  };
                  return (
                    <RssNewsCard key={article.id || article.url} article={adaptedArticle} />
                  );
                })}
              </div>
            )}

            {!isLiveLoading && !liveErrorMessage && filteredLiveArticles.length === 0 && searchText.trim() && (
              <Card className="border-slate-200">
                <CardContent className="p-10 text-center space-y-2">
                  <div className="text-slate-700 font-medium">No articles found for this keyword set.</div>
                  <div className="text-sm text-slate-500">Try broader terms or remove one keyword.</div>
                </CardContent>
              </Card>
            )}

            {!isLiveLoading && !liveErrorMessage && filteredLiveArticles.length === 0 && !searchText.trim() && (
              <Card className="border-dashed border-slate-300 bg-slate-50/70">
                <CardContent className="p-12 text-center space-y-2">
                  <Newspaper className="h-8 w-8 text-slate-400 mx-auto" />
                  <div className="text-slate-700 font-medium">Start with a keyword search</div>
                  <div className="text-sm text-slate-500">Pick a suggestion or type your own query.</div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicWebArticles;
