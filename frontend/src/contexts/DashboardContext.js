import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';

const DashboardContext = createContext(null);

const CACHE_DURATION = 30 * 1000; // 30 seconds
const CACHE_KEY = 'dashboardCache_v3';

export const DashboardProvider = ({ children }) => {
  const [dashboardData, setDashboardData] = useState(null);
  const [lastFetchTime, setLastFetchTime] = useState(null);
  const [loading, setLoading] = useState(false);

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return;
      const parsed = JSON.parse(cached);
      if (parsed?.data && parsed?.ts) {
        setDashboardData(parsed.data);
        setLastFetchTime(parsed.ts);
      }
    } catch (error) {
      console.error('Failed to read dashboard cache:', error);
    }
  }, []);

  const fetchDashboardData = useCallback(async (forceRefresh = false) => {
    // Return cached data if available and not expired
    if (!forceRefresh && dashboardData && lastFetchTime) {
      const timeSinceLastFetch = Date.now() - lastFetchTime;
      if (timeSinceLastFetch < CACHE_DURATION) {
        return dashboardData;
      }
    }

    // Prevent multiple simultaneous fetches
    if (loading) return dashboardData;

    const isColdStart = !dashboardData;
    if (isColdStart) setLoading(true);

    try {
      const [dashStatsRes, reportsStatsRes, grievancesStatsRes, sentimentRes, categoryAnalyticsRes] = await Promise.all([
        api.get('/alerts/dashboard-stats'),
        api.get('/reports/stats'),
        api.get('/grievances/dashboard-stats'),
        api.get('/grievances/sentiment-analytics').catch(() => ({ data: null })),
        api.get('/grievances/category-analytics').catch(() => ({ data: null }))
      ]);

      const { byPlatform, pendingByPlatform, viralByPlatform } = dashStatsRes.data;

      // Build alertData in the format the dashboard expects: { active: { all: N, twitter: N, ... }, ... }
      const statuses = ['active', 'acknowledged', 'escalated', 'false_positive'];
      const alertData = {};
      statuses.forEach(status => {
        alertData[status] = {};
        Object.keys(byPlatform).forEach(plat => {
          alertData[status][plat] = byPlatform[plat]?.[status] || 0;
        });
      });

      // Viral counts
      alertData.viral = viralByPlatform;

      // Pending report counts
      const alertPendingReportData = pendingByPlatform;

      // Reports from lightweight backend stats
      const reportData = reportsStatsRes.data?.byPlatform || {};

      // Grievances from lightweight backend stats
      const grievanceData = grievancesStatsRes.data?.byPlatform || {};

      const sentimentAnalytics = sentimentRes?.data || null;

      const newData = {
        alertData,
        alertPendingReportData,
        reportData,
        grievanceData,
        stateSummary: null,
        sentimentAnalytics,
        categoryAnalytics: categoryAnalyticsRes.data || null
      };

      setDashboardData(newData);
      setLastFetchTime(Date.now());
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data: newData, ts: Date.now() }));
      } catch (error) {
        console.error('Failed to write dashboard cache:', error);
      }
      return newData;
    } catch (error) {
      toast.error('Failed to load dashboard data');
      console.error(error);
      return dashboardData; // Return cached data on error
    } finally {
      if (isColdStart) setLoading(false);
    }
  }, [dashboardData, lastFetchTime, loading]);

  const refreshDashboard = useCallback(() => {
    return fetchDashboardData(true);
  }, [fetchDashboardData]);

  return (
    <DashboardContext.Provider value={{
      dashboardData,
      loading,
      fetchDashboardData,
      refreshDashboard,
      hasCachedData: !!dashboardData
    }}>
      {children}
    </DashboardContext.Provider>
  );
};

export const useDashboard = () => {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
};

export default DashboardContext;
