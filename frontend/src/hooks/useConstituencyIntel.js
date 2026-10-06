import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import { buildParams } from './useGeoIntel';

/**
 * Thin hooks around the existing /api/constituency-intel/* endpoints
 * (constituencyIntelligenceController) — reused as-is for the Constituency
 * Explorer tab rather than re-implementing seat-level aggregation.
 *
 * Param-shaping reuses useGeoIntel's buildParams (drops 'all'/empty values
 * instead of sending them literally) so the two hook files don't maintain
 * independent, potentially-drifting copies of the same logic.
 */

export const useConstituencyLeaderboard = (filters = {}, { enabled = true } = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const f = filtersRef.current;
        const params = typeof f === 'number' || typeof f === 'string'
          ? { days: f, sort: 'negative', limit: 200 }
          : { days: f?.days || 90, ...buildParams(f), sort: 'negative', limit: 200 };
        const res = await api.get('/constituency-intel/leaderboard', { params });
        if (!cancelled) { setData(res.data); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load constituency leaderboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [JSON.stringify(filters), enabled]);

  return { data, loading, error };
};

export const useConstituencyDetail = (constituency, filters = {}, { enabled = true } = {}) => {
  const [detail, setDetail] = useState(null);
  const [narrative, setNarrative] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const refetch = useCallback(async () => {
    if (!constituency || !enabled) return;
    try {
      setLoading(true);
      setError(null);
      const f = filtersRef.current;
      const params = typeof f === 'number' || typeof f === 'string' ? { days: f } : buildParams(f);
      const [detailRes, narrativeRes] = await Promise.all([
        api.get(`/constituency-intel/${encodeURIComponent(constituency)}`, { params }),
        api.get(`/constituency-intel/${encodeURIComponent(constituency)}/narrative`, { params }),
      ]);
      setDetail(detailRes.data);
      setNarrative(narrativeRes.data);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load constituency detail');
    } finally {
      setLoading(false);
    }
  }, [constituency, enabled]);

  useEffect(() => { refetch(); }, [refetch, JSON.stringify(filters)]);

  return { detail, narrative, loading, error };
};

// `filters` accepts either a plain days number (back-compat) or the shared
// {from,to,platform,sentiment,topic} filter object — previously this only
// ever forwarded `days` (hardcoded to 90 by the caller), so the Comparative
// sub-tab silently ignored the page's date range/platform/sentiment/topic
// filters that every other sub-tab honored.
export const useConstituencyComparison = (a, b, filters = 90, { enabled = true } = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const filtersKey = typeof filters === 'object' ? JSON.stringify(filters) : filters;

  useEffect(() => {
    if (!a || !b || !enabled) { setData(null); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const f = filters;
        const params = typeof f === 'number' || typeof f === 'string'
          ? { a, b, days: f }
          : { a, b, days: f?.days, ...buildParams(f) };
        const res = await api.get('/constituency-intel/compare', { params });
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to compare constituencies');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [a, b, filtersKey, enabled]);

  return { data, loading, error };
};
