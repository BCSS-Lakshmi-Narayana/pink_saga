import { useEffect, useState } from 'react';
import api from '../lib/api';

/**
 * Electoral Base data. The seat list is static (published results), so it is
 * fetched once per page load and shared by every component that asks for it.
 */
let seatsRequest = null;
const loadSeats = () => {
  if (!seatsRequest) {
    seatsRequest = api.get('/electoral-base/seats').then((r) => r.data).catch((e) => { seatsRequest = null; throw e; });
  }
  return seatsRequest;
};

/** Every seat the user may see, with its results summary. */
export const useElectoralSeats = ({ enabled = true } = {}) => {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    loadSeats()
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((error) => { if (!cancelled) setState({ data: null, loading: false, error }); });
    return () => { cancelled = true; };
  }, [enabled]);
  return { seats: state.data?.data || [], meta: state.data?.meta || null, loading: state.loading, error: state.error };
};

/** Core / swing / opposition across the user's seats. */
export const useElectoralOverview = ({ enabled = true } = {}) => {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api.get('/electoral-base/overview')
      .then((r) => { if (!cancelled) setState({ data: r.data, loading: false, error: null }); })
      .catch((error) => { if (!cancelled) setState({ data: null, loading: false, error }); });
    return () => { cancelled = true; };
  }, [enabled]);
  return { overview: state.data?.data || null, scoped: !!state.data?.scoped, loading: state.loading, error: state.error };
};

/** One seat with full candidate-level results — fetched per seat. */
export const useElectoralSeat = (key) => {
  const [state, setState] = useState({ key: null, seat: null, meta: null, error: null });
  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    api.get(`/electoral-base/seats/${encodeURIComponent(key)}`)
      .then((r) => { if (!cancelled) setState({ key, seat: r.data?.data || null, meta: r.data?.meta || null, error: null }); })
      .catch((error) => { if (!cancelled) setState({ key, seat: null, meta: null, error }); });
    return () => { cancelled = true; };
  }, [key]);
  // Loading until the response for THIS key has landed, so a newly opened
  // seat never flashes the previous seat or an empty state.
  const loading = !!key && state.key !== key;
  return loading ? { seat: null, meta: null, loading: true, error: null } : { ...state, loading: false };
};
