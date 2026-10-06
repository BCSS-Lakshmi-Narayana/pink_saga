import { useMemo, useCallback } from 'react';
import { toLocalYMD } from '../components/geographic/geoDate';

const FILTER_KEYS = ['from', 'to', 'platform', 'sentiment', 'topic'];

/**
 * Shared URL-backed filter state for the Geographic Intelligence pages —
 * default 7-day range computation + read/write of from/to/platform/
 * sentiment/topic against the URL. Previously duplicated (and already
 * slightly diverged) between GeographicIntelligence.jsx and
 * GeographicIntelligenceDistrict.jsx; centralizing it here means a future
 * fix only needs to land once, and both pages now consistently preserve any
 * unrelated URL params (like `tab`) when a filter changes.
 */
export const useGeoFilters = (searchParams, setSearchParams) => {
  const filters = useMemo(() => {
    let from = searchParams.get('from') || '';
    let to = searchParams.get('to') || '';

    if (!from && !to) {
      const now = new Date();
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      from = toLocalYMD(start);
      to = toLocalYMD(now);
    }

    return {
      from,
      to,
      platform: searchParams.get('platform') || 'all',
      sentiment: searchParams.get('sentiment') || 'all',
      topic: searchParams.get('topic') || 'all',
    };
  }, [searchParams]);

  const setFilters = useCallback((nextFilters) => {
    const next = new URLSearchParams(searchParams);
    FILTER_KEYS.forEach((key) => {
      const value = nextFilters[key];
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
    });
    setSearchParams(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return [filters, setFilters];
};
