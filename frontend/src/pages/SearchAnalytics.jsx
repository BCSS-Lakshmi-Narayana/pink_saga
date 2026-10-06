import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { TrendingUp, RefreshCw, AlertCircle, Info } from 'lucide-react';
import { Card } from '../components/ui/card';
import SearchControls from '../components/searchAnalytics/SearchControls';
import InterestOverTimeChart from '../components/searchAnalytics/InterestOverTimeChart';
import TopRegionsCard from '../components/searchAnalytics/TopRegionsCard';
import RelatedSearchesCard from '../components/searchAnalytics/RelatedSearchesCard';
import TrendingScoreCard from '../components/searchAnalytics/TrendingScoreCard';

const RECENT_STORAGE_KEY = 'brs:searchAnalytics:recent';
const PREFS_STORAGE_KEY = 'brs:searchAnalytics:prefs';
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const MAX_RECENT = 10;
const DEFAULT_QUERY = 'KCR';

const loadJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const SearchAnalytics = () => {
  const initialPrefs = useMemo(() => loadJson(PREFS_STORAGE_KEY, {}), []);

  const [query, setQuery] = useState(initialPrefs.query || DEFAULT_QUERY);
  const [country, setCountry] = useState(initialPrefs.country || 'IN');
  const [range, setRange] = useState(initialPrefs.range || '7');
  const [property, setProperty] = useState(initialPrefs.property || 'web');
  const [category, setCategory] = useState(
    Number.isFinite(initialPrefs.category) ? initialPrefs.category : 0
  );
  const [autoRefresh, setAutoRefresh] = useState(Boolean(initialPrefs.autoRefresh));
  const [recent, setRecent] = useState(() => loadJson(RECENT_STORAGE_KEY, []));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const intervalRef = useRef(null);
  const activeQueryRef = useRef('');

  useEffect(() => {
    try {
      localStorage.setItem(
        PREFS_STORAGE_KEY,
        JSON.stringify({ query, country, range, property, category, autoRefresh })
      );
    } catch {
      /* ignore quota errors */
    }
  }, [query, country, range, property, category, autoRefresh]);

  const pushRecent = useCallback((kw) => {
    setRecent((prev) => {
      const cleaned = [kw, ...prev.filter((item) => item.toLowerCase() !== kw.toLowerCase())].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(cleaned));
      } catch {
        /* ignore */
      }
      return cleaned;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecent([]);
    try {
      localStorage.removeItem(RECENT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchTrends = useCallback(
    async (kwOverride, { silent = false } = {}) => {
      const kw = (kwOverride ?? query).trim();
      if (!kw) return;

      activeQueryRef.current = kw;
      if (!silent) setLoading(true);
      setError(null);

      try {
        const days = parseInt(range, 10) || 30;
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

        const res = await api.get('/search-trends', {
          params: {
            q: kw,
            country,
            property,
            category,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString()
          }
        });

        if (activeQueryRef.current !== kw) return;

        if (res.data?.success === false) {
          throw new Error(res.data?.message || 'Trends request failed');
        }

        setData(res.data);
        pushRecent(kw);
        if (!silent) toast.success(`Loaded trends for "${kw}"`);
      } catch (err) {
        const message =
          err?.response?.data?.message ||
          err?.message ||
          'Failed to load search trends';
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [country, property, category, pushRecent, query, range]
  );

  const handleSubmit = useCallback(() => {
    fetchTrends();
  }, [fetchTrends]);

  const didInitialFetchRef = useRef(false);
  useEffect(() => {
    if (didInitialFetchRef.current) return;
    didInitialFetchRef.current = true;
    const initial = (initialPrefs.query || DEFAULT_QUERY).trim();
    if (initial) {
      fetchTrends(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch when filters change after first successful query
  useEffect(() => {
    if (!data?.query) return;
    fetchTrends(data.query, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, range, property, category]);

  // Auto-refresh every 5 min
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (autoRefresh && data?.query) {
      intervalRef.current = setInterval(() => {
        fetchTrends(data.query, { silent: true });
      }, AUTO_REFRESH_MS);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, data?.query, fetchTrends]);

  return (
    <div className="space-y-6" data-testid="search-analytics-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-heading font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="h-7 w-7 text-orange-500" />
            Search Analytics
          </h1>
          <p className="text-muted-foreground mt-1">
            Explore real-time Google Trends search interest for keywords, incidents and campaigns.
          </p>
        </div>
        {data?.lastUpdated && (
          <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5 mt-2">
            <RefreshCw className={`h-3 w-3 ${autoRefresh ? 'animate-spin-slow' : ''}`} />
            Last updated {new Date(data.lastUpdated).toLocaleString()}
            {data.stale && (
              <span className="ml-2 text-[10px] uppercase tracking-wider bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded">
                Cached (rate-limited)
              </span>
            )}
          </div>
        )}
      </div>

      <SearchControls
        query={query}
        setQuery={setQuery}
        country={country}
        setCountry={setCountry}
        range={range}
        setRange={setRange}
        property={property}
        setProperty={setProperty}
        category={category}
        setCategory={setCategory}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        onSubmit={handleSubmit}
        loading={loading}
        recent={recent}
        onClearRecent={clearRecent}
      />

      {error && (
        <Card className="p-4 border-red-500/30 bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-500">Couldn't load trends data</p>
              <p className="text-sm text-muted-foreground mt-0.5">{error}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Google Trends rate-limits frequent requests. Wait a few seconds and try again, or pick a shorter range.
              </p>
            </div>
          </div>
        </Card>
      )}

      {loading && !data && (
        <Card className="p-12 flex flex-col items-center justify-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500" />
          <p className="text-sm text-muted-foreground">
            Fetching Google Trends data for "{query}"…
          </p>
        </Card>
      )}

      {!loading && !data && !error && (
        <Card className="p-12 flex flex-col items-center justify-center text-center gap-2">
          <TrendingUp className="h-10 w-10 text-orange-500/60" />
          <p className="text-base font-semibold">Search any keyword to begin</p>
          <p className="text-sm text-muted-foreground max-w-md">
            Type a keyword like <span className="font-medium">KCR</span> or{' '}
            <span className="font-medium">train accident</span> above and hit Analyze.
          </p>
        </Card>
      )}

      {data && Array.isArray(data.fallbacks) && data.fallbacks.length > 0 && (
        <Card className="p-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-amber-500">Filters were relaxed to find results</p>
              <p className="text-muted-foreground mt-0.5">
                Google Trends had no data for "{data.query}" with your exact filters. We relaxed:{' '}
                <span className="font-medium text-foreground">{data.fallbacks.join(', ')}</span>.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Try a broader keyword, a longer time range, or "All categories" to get richer results.
              </p>
            </div>
          </div>
        </Card>
      )}

      {data && data.interestOverTime?.length === 0 && (
        <Card className="p-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-amber-500">No search interest found</p>
              <p className="text-muted-foreground mt-0.5">
                Google Trends has no measurable search volume for "{data.query}" in {data.country} over this window.
                This usually means the keyword is too niche, mis-spelled, or below the noise threshold.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Try a shorter / simpler keyword, switch country to <span className="font-medium">Worldwide</span>, or extend the time range to <span className="font-medium">Past 12 months</span>.
              </p>
            </div>
          </div>
        </Card>
      )}

      {data && (
        <>
          <InterestOverTimeChart
            data={data.interestOverTime}
            keyword={data.query}
            summary={data.summary}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <TrendingScoreCard summary={data.summary} lastUpdated={data.lastUpdated} />
            <div className="lg:col-span-2">
              <TopRegionsCard regions={data.topRegions} />
            </div>
          </div>

          <RelatedSearchesCard data={data} />
        </>
      )}
    </div>
  );
};

export default SearchAnalytics;
