import React, { createContext, useContext, useRef, useCallback } from 'react';

/**
 * In-memory cache for Instagram data so navigating between pages
 * doesn't re-fetch everything. Data survives across route changes
 * but is cleared on full page refresh.
 *
 * Cached items:
 *   profiles   – keyed by sourceId
 *   content    – keyed by `${sourceId}__${tab}`, stores { items[], page, hasMore }
 *   reels      – keyed by selectedSourceId (monitor page), stores { items[], page, hasMore }
 *   sources    – the sources list (shared across monitor + profile pages)
 */

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const InstagramCacheContext = createContext(null);

export const useInstagramCache = () => {
  const ctx = useContext(InstagramCacheContext);
  if (!ctx) throw new Error('useInstagramCache must be used inside InstagramCacheProvider');
  return ctx;
};

export const InstagramCacheProvider = ({ children }) => {
  const cacheRef = useRef({
    profiles: {},   // { [sourceId]: { data, ts } }
    content: {},    // { [key]: { items, page, hasMore, ts } }
    reels: {},      // { [sourceId]: { items, page, hasMore, ts } }
    sources: null,  // { data, ts }
  });

  const isStale = useCallback((ts) => {
    return !ts || Date.now() - ts > CACHE_TTL;
  }, []);

  /* ── Profiles ────────────────────────── */
  const getProfile = useCallback((sourceId) => {
    const entry = cacheRef.current.profiles[sourceId];
    if (entry && !isStale(entry.ts)) return entry.data;
    return null;
  }, [isStale]);

  const setProfile = useCallback((sourceId, data) => {
    cacheRef.current.profiles[sourceId] = { data, ts: Date.now() };
  }, []);

  /* ── Content (profile page grid) ─────── */
  const getContent = useCallback((sourceId, tab) => {
    const key = `${sourceId}__${tab}`;
    const entry = cacheRef.current.content[key];
    if (entry && !isStale(entry.ts)) return entry;
    return null;
  }, [isStale]);

  const setContent = useCallback((sourceId, tab, items, page, hasMore) => {
    const key = `${sourceId}__${tab}`;
    cacheRef.current.content[key] = { items, page, hasMore, ts: Date.now() };
  }, []);

  /* ── Reels (monitor page) ────────────── */
  const getReels = useCallback((sourceId) => {
    const entry = cacheRef.current.reels[sourceId || 'all'];
    if (entry && !isStale(entry.ts)) return entry;
    return null;
  }, [isStale]);

  const setReels = useCallback((sourceId, items, page, hasMore) => {
    cacheRef.current.reels[sourceId || 'all'] = { items, page, hasMore, ts: Date.now() };
  }, []);

  /* ── Sources list ────────────────────── */
  const getSources = useCallback(() => {
    const entry = cacheRef.current.sources;
    if (entry && !isStale(entry.ts)) return entry.data;
    return null;
  }, [isStale]);

  const setSources = useCallback((data) => {
    cacheRef.current.sources = { data, ts: Date.now() };
  }, []);

  /* ── Invalidate ──────────────────────── */
  const invalidateAll = useCallback(() => {
    cacheRef.current = { profiles: {}, content: {}, reels: {}, sources: null };
  }, []);

  const invalidateSource = useCallback((sourceId) => {
    delete cacheRef.current.profiles[sourceId];
    // Remove all content keys for this source
    Object.keys(cacheRef.current.content).forEach((k) => {
      if (k.startsWith(`${sourceId}__`)) delete cacheRef.current.content[k];
    });
    delete cacheRef.current.reels[sourceId];
  }, []);

  return (
    <InstagramCacheContext.Provider
      value={{
        getProfile, setProfile,
        getContent, setContent,
        getReels, setReels,
        getSources, setSources,
        invalidateAll, invalidateSource,
      }}
    >
      {children}
    </InstagramCacheContext.Provider>
  );
};
