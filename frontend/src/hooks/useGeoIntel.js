import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';

/**
 * Geographic Intelligence data hooks — thin fetch wrappers around
 * /api/geo-intel/*, following the same loading/error/refetch shape used
 * across the app's other dashboard hooks (see useDashboardData.js).
 *
 * Every hook aborts its previous in-flight request before firing a new one
 * (via AbortController) and ignores the abort's own rejection, so a rapid
 * sequence of filter changes can't let an older, slower response land after
 * a newer one and overwrite it with stale data.
 */

export const buildParams = (filters = {}) => {
  const params = {};
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.platform && filters.platform !== 'all') params.platform = filters.platform;
  if (filters.sentiment && filters.sentiment !== 'all') params.sentiment = filters.sentiment;
  if (filters.topic && filters.topic !== 'all') params.topic = filters.topic;
  if (filters.sort) params.sort = filters.sort;
  if (filters.order) params.order = filters.order;
  if (filters.limit) params.limit = filters.limit;
  return params;
};

const isAbortError = (err) => err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError';

export const useGeoScope = () => {
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        setLoading(true);
        const res = await api.get('/geo-intel/scope', { signal: controller.signal });
        setScope(res.data);
      } catch (err) {
        if (isAbortError(err)) return;
        setError(err?.response?.data?.message || 'Failed to load geographic scope');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  return { scope, loading, error };
};

export const useDistrictLeaderboard = (filters) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const controllerRef = useRef(null);

  const refetch = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/geo-intel/districts', { params: buildParams(filtersRef.current), signal: controller.signal });
      setData(res.data);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err?.response?.data?.message || 'Failed to load district leaderboard');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); return () => controllerRef.current?.abort(); }, [refetch, filters.from, filters.to, filters.platform, filters.sentiment, filters.topic, filters.sort, filters.order]);

  return { data, loading, error, refetch };
};

export const useDistrictDetail = (districtKey, filters, { enabled = true } = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const controllerRef = useRef(null);

  const refetch = useCallback(async () => {
    if (!districtKey || !enabled) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      setLoading(true);
      setError(null);
      const res = await api.get(`/geo-intel/districts/${encodeURIComponent(districtKey)}`, { params: buildParams(filtersRef.current), signal: controller.signal });
      setData(res.data);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err?.response?.data?.message || 'Failed to load district detail');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [districtKey, enabled]);

  useEffect(() => { refetch(); return () => controllerRef.current?.abort(); }, [refetch, filters.from, filters.to, filters.platform, filters.sentiment, filters.topic]);

  return { data, loading, error, refetch };
};

export const useCityLeaderboard = (districtKey, filters, { enabled = true } = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const controllerRef = useRef(null);

  const refetch = useCallback(async () => {
    if (!districtKey || !enabled) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      setLoading(true);
      setError(null);
      const res = await api.get(`/geo-intel/districts/${encodeURIComponent(districtKey)}/cities`, { params: buildParams(filtersRef.current), signal: controller.signal });
      setData(res.data);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err?.response?.data?.message || 'Failed to load city leaderboard');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [districtKey, enabled]);

  // Previously missing filters.from/to/platform/sentiment/topic here meant
  // the expanded city table went stale after a global filter change while
  // the rest of the district panel (correctly) refetched.
  useEffect(() => { refetch(); return () => controllerRef.current?.abort(); }, [refetch, filters.from, filters.to, filters.platform, filters.sentiment, filters.topic]);

  return { data, loading, error, refetch };
};

export const useStateSummary = (filters) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const controllerRef = useRef(null);

  const refetch = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/geo-intel/summary', { params: buildParams(filtersRef.current), signal: controller.signal });
      setData(res.data);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err?.response?.data?.message || 'Failed to load state summary');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); return () => controllerRef.current?.abort(); }, [refetch, filters.from, filters.to, filters.platform, filters.sentiment, filters.topic]);

  return { data, loading, error, refetch };
};

export const usePlayback = (filters, { enabled = true } = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const controllerRef = useRef(null);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/geo-intel/playback', { params: buildParams(filtersRef.current), signal: controller.signal });
      setData(res.data);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err?.response?.data?.message || 'Failed to load historical playback data');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refetch(); return () => controllerRef.current?.abort(); }, [refetch, filters.from, filters.to, filters.platform, filters.sentiment, filters.topic]);

  return { data, loading, error, refetch };
};

export const useTopicAnalytics = (districtKey, filters, { enabled = true } = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const controllerRef = useRef(null);

  const refetch = useCallback(async () => {
    if (!districtKey || !enabled) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      setLoading(true);
      setError(null);
      const res = await api.get(`/geo-intel/districts/${encodeURIComponent(districtKey)}/topics`, { params: { ...buildParams(filtersRef.current), limit: 20 }, signal: controller.signal });
      setData(res.data);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err?.response?.data?.message || 'Failed to load topic analytics');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [districtKey, enabled]);

  // Same missing-dependency bug as useCityLeaderboard — a filter change
  // wasn't refetching the topic table.
  useEffect(() => { refetch(); return () => controllerRef.current?.abort(); }, [refetch, filters.from, filters.to, filters.platform, filters.sentiment, filters.topic]);

  return { data, loading, error, refetch };
};
