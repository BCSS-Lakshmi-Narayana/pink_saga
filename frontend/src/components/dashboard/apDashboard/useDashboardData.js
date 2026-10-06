/**
 * useDashboardData — Central data hook for the Telangana Political Intelligence Dashboard
 * (the /dashboard/ap-* endpoint names are legacy route names, kept for API stability)
 * Manages all fetch calls, filter state, and refresh logic.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../../lib/api';

const formatLocalYYYYMMDD = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const defaultFrom = () => {
  const d = new Date();
  d.setDate(d.getDate() - 6); // 7 days total including today
  return formatLocalYYYYMMDD(d);
};

const defaultTo = () => formatLocalYYYYMMDD(new Date());

export function useDashboardData() {
  const [filters, setFilters] = useState({
    from: defaultFrom(),
    to: defaultTo(),
    district: '',
    sentiment: '',
    platform: '',
    party: ''
  });

  const [data, setData] = useState({
    kpis: null,
    sentimentTrend: null,
    mentionTrend: null,
    sourceDistribution: null,
    districtPerformance: null,
    topTopics: null,
    alertsSummary: null,
    recentActivity: null,
    mapData: null,
    aiInsights: null,
    geoHighlights: null
  });

  const [loading, setLoading] = useState({
    kpis: true,
    sentimentTrend: true,
    mentionTrend: true,
    sourceDistribution: true,
    districtPerformance: true,
    topTopics: true,
    alertsSummary: true,
    recentActivity: true,
    mapData: true,
    aiInsights: true,
    geoHighlights: true
  });

  const [errors, setErrors] = useState({});
  const abortRef = useRef(null);

  const buildParams = useCallback((extra = {}) => {
    const p = {};
    if (filters.from) p.from = filters.from;
    if (filters.to)   p.to   = filters.to;
    if (filters.district)  p.district  = filters.district;
    if (filters.sentiment) p.sentiment = filters.sentiment;
    if (filters.platform)  p.platform  = filters.platform;
    return { ...p, ...extra };
  }, [filters]);

  const fetchSection = useCallback(async (key, endpoint, params = {}) => {
    setLoading(prev => ({ ...prev, [key]: true }));
    try {
      const res = await api.get(endpoint, { params: buildParams(params) });
      setData(prev => ({ ...prev, [key]: res.data }));
      setErrors(prev => ({ ...prev, [key]: null }));
    } catch (err) {
      setErrors(prev => ({ ...prev, [key]: err.message }));
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  }, [buildParams]);

  const fetchAll = useCallback(() => {
    // Critical path — fetch in parallel
    fetchSection('kpis',               '/dashboard/ap-kpis');
    fetchSection('sentimentTrend',     '/dashboard/ap-sentiment-trend');
    fetchSection('mentionTrend',       '/dashboard/ap-mention-trend');
    fetchSection('sourceDistribution', '/dashboard/ap-source-distribution');
    fetchSection('districtPerformance','/dashboard/ap-district-performance');
    fetchSection('topTopics',          '/dashboard/ap-top-topics', { limit: 10 });
    fetchSection('alertsSummary',      '/dashboard/ap-alerts-summary');
    fetchSection('recentActivity',     '/dashboard/ap-recent-activity', { limit: 8 });
    fetchSection('mapData',            '/dashboard/ap-map-data');
    fetchSection('geoHighlights',      '/dashboard/ap-geo-highlights');
    // AI insights — lazy, slightly delayed to not block critical path
    setTimeout(() => fetchSection('aiInsights', '/dashboard/ap-ai-insights'), 800);
  }, [fetchSection]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const updateFilters = useCallback((newFilters) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  const refresh = useCallback(() => fetchAll(), [fetchAll]);

  return {
    filters,
    updateFilters,
    data,
    loading,
    errors,
    refresh
  };
}
