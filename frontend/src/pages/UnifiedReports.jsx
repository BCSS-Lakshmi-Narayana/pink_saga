import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  ChevronRight,
  Clock3,
  FileText,
  LayoutPanelTop,
  RefreshCw,
  Zap,
  Twitter
} from 'lucide-react';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

const ReportsContent = lazy(() => import('../components/ReportsContent'));
const GrievanceWorkflowReports = lazy(() => import('../components/grievances/GrievanceWorkflowReports'));
const SuggestionReports = lazy(() => import('../components/grievances/SuggestionReports'));
const CriticismReports = lazy(() => import('../components/grievances/CriticismReports'));
const XBulkActions = lazy(() => import('../components/reports/XBulkActions'));
const UnifiedReportWindow = lazy(() => import('../components/reports/UnifiedReportWindow'));
const UnifiedReportsAnalyticsPanel = lazy(() => import('../components/reports/UnifiedReportsAnalyticsPanel'));

const PanelSkeleton = () => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="h-6 w-48 animate-pulse rounded bg-slate-100" />
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
      ))}
    </div>
    <div className="mt-4 h-64 animate-pulse rounded-xl bg-slate-100" />
  </div>
);

const SectionSkeleton = () => (
  <div className="space-y-3 p-4">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
    ))}
  </div>
);

const INITIAL_COUNTS = {
  alerts: null,
  grievance: null,
  suggestion: null,
  criticism: null,
  xactions: null
};

const SECTIONS = [
  {
    key: 'alerts',
    label: 'Alerts Reports',
    description: 'Escalated alert investigation reports',
    icon: AlertTriangle,
    tone: 'blue'
  },
  {
    key: 'grievance',
    label: 'Grievance Reports',
    description: 'Formal grievance workflow reports',
    icon: FileText,
    tone: 'amber'
  },
  {
    key: 'suggestion',
    label: 'Suggestion Reports',
    description: 'Community suggestion report records',
    icon: Building2,
    tone: 'purple'
  },
  {
    key: 'criticism',
    label: 'Criticism Reports',
    description: 'Critical grievance report records',
    icon: Zap,
    tone: 'red'
  },
  {
    key: 'xactions',
    label: 'X Bulk Actions',
    description: 'Bulk reply, comment & retweet on X posts',
    icon: Twitter,
    tone: 'sky'
  }
];

const toneClasses = {
  blue: {
    iconWrap: 'bg-blue-50 text-blue-700 border-blue-100',
    count: 'text-blue-700 bg-blue-50 border-blue-100',
    active: 'ring-blue-400 border-blue-300 bg-blue-50/40',
    borderAccent: 'group-hover:border-blue-300'
  },
  amber: {
    iconWrap: 'bg-amber-50 text-amber-700 border-amber-100',
    count: 'text-amber-700 bg-amber-50 border-amber-100',
    active: 'ring-amber-400 border-amber-300 bg-amber-50/40',
    borderAccent: 'group-hover:border-amber-300'
  },
  purple: {
    iconWrap: 'bg-violet-50 text-violet-700 border-violet-100',
    count: 'text-violet-700 bg-violet-50 border-violet-100',
    active: 'ring-violet-400 border-violet-300 bg-violet-50/40',
    borderAccent: 'group-hover:border-violet-300'
  },
  red: {
    iconWrap: 'bg-rose-50 text-rose-700 border-rose-100',
    count: 'text-rose-700 bg-rose-50 border-rose-100',
    active: 'ring-rose-400 border-rose-300 bg-rose-50/40',
    borderAccent: 'group-hover:border-rose-300'
  },
  teal: {
    iconWrap: 'bg-teal-50 text-teal-700 border-teal-100',
    count: 'text-teal-700 bg-teal-50 border-teal-100',
    active: 'ring-teal-400 border-teal-300 bg-teal-50/40',
    borderAccent: 'group-hover:border-teal-300'
  },
  sky: {
    iconWrap: 'bg-sky-50 text-sky-700 border-sky-100',
    count: 'text-sky-700 bg-sky-50 border-sky-100',
    active: 'ring-sky-400 border-sky-300 bg-sky-50/40',
    borderAccent: 'group-hover:border-sky-300'
  }
};

const parseCount = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

const UnifiedReports = () => {
  const [counts, setCounts] = useState(INITIAL_COUNTS);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [failedSections, setFailedSections] = useState([]);
  const [windowOpen, setWindowOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('alerts');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState('');
  const [selectedWindow, setSelectedWindow] = useState('weekly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const fetchCounts = useCallback(async () => {
    setLoadingCounts(true);

    const results = await Promise.allSettled([
      api.get('/reports/stats'),
      api.get('/grievance-workflow/reports', { params: { page: 1, limit: 1 } }),
      api.get('/suggestion/reports', { params: { page: 1, limit: 1 } }),
      api.get('/criticism/reports', { params: { page: 1, limit: 1 } })
    ]);

    const nextCounts = { ...INITIAL_COUNTS };
    const failures = [];

    if (results[0].status === 'fulfilled') {
      const data = results[0].value?.data || {};
      nextCounts.alerts = parseCount(data?.totals?.total ?? data?.byPlatform?.all?.total);
    } else {
      failures.push('alerts');
    }

    if (results[1].status === 'fulfilled') {
      const data = results[1].value?.data || {};
      nextCounts.grievance = parseCount(data?.stats?.total ?? data?.pagination?.total);
    } else {
      failures.push('grievance');
    }

    if (results[2].status === 'fulfilled') {
      const data = results[2].value?.data || {};
      nextCounts.suggestion = parseCount(data?.pagination?.total);
    } else {
      failures.push('suggestion');
    }

    if (results[3].status === 'fulfilled') {
      const data = results[3].value?.data || {};
      nextCounts.criticism = parseCount(data?.pagination?.total);
    } else {
      failures.push('criticism');
    }

    // X Bulk Actions: show connected accounts count as the badge number
    try {
      const { data } = await api.get('/x/actions/accounts');
      nextCounts.xactions = parseCount((data?.accounts || []).length);
    } catch {
      nextCounts.xactions = 0;
    }

    setCounts(nextCounts);
    setFailedSections(failures);
    setLoadingCounts(false);
    setLastUpdatedAt(new Date());
  }, []);

  const fetchAnalytics = useCallback(async (rangeOverride) => {
    setAnalyticsLoading(true);
    setAnalyticsError('');

    try {
      const activeRange = rangeOverride || { from: customFrom, to: customTo };
      const params = {};
      if (activeRange?.from) params.from = activeRange.from;
      if (activeRange?.to) params.to = activeRange.to;
      const response = await api.get('/analytics/unified-reports', { params });
      setAnalyticsData(response?.data || null);
      setLastUpdatedAt(new Date());
    } catch (error) {
      setAnalyticsError('Unified analytics is temporarily unavailable. Section workspace remains usable.');
    } finally {
      setAnalyticsLoading(false);
    }
  }, [customFrom, customTo]);

  const handleRefreshAll = useCallback(async () => {
    await Promise.allSettled([fetchCounts(), fetchAnalytics()]);
  }, [fetchCounts, fetchAnalytics]);

  const handleApplyCustomRange = useCallback(async () => {
    if (!customFrom || !customTo) return;
    const fromDate = new Date(customFrom);
    const toDate = new Date(customTo);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) return;
    setSelectedWindow('custom');
    await fetchAnalytics({ from: customFrom, to: customTo });
  }, [customFrom, customTo, fetchAnalytics]);

  const handleClearCustomRange = useCallback(async () => {
    setCustomFrom('');
    setCustomTo('');
    setSelectedWindow('weekly');
    await fetchAnalytics({ from: '', to: '' });
  }, [fetchAnalytics]);

  useEffect(() => {
    handleRefreshAll();
  }, [handleRefreshAll]);

  const activeMeta = useMemo(
    () => SECTIONS.find((item) => item.key === activeSection) || SECTIONS[0],
    [activeSection]
  );

  const healthyCount = useMemo(() => {
    return Object.values(counts).reduce((acc, value) => acc + (typeof value === 'number' ? value : 0), 0);
  }, [counts]);

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'alerts':
        return <ReportsContent />;
      case 'grievance':
        return <GrievanceWorkflowReports />;
      case 'suggestion':
        return <SuggestionReports />;
      case 'criticism':
        return <CriticismReports />;
      case 'xactions':
        return <XBulkActions />;
      default:
        return <ReportsContent />;
    }
  };

  const handleOpenSection = (sectionKey) => {
    setActiveSection(sectionKey);
    setWindowOpen(true);
  };

  const formatCount = (sectionKey) => {
    if (loadingCounts) return '...';
    if (counts[sectionKey] === null) return '--';
    return counts[sectionKey].toLocaleString();
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-100 p-4 md:p-6">
      <div className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-blue-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 bottom-10 h-80 w-80 rounded-full bg-amber-200/40 blur-3xl" />

      <div className="relative mx-auto max-w-7xl space-y-6">

        <Suspense fallback={<PanelSkeleton />}>
          <UnifiedReportsAnalyticsPanel
            data={analyticsData}
            loading={analyticsLoading}
            selectedWindow={selectedWindow}
            onWindowChange={setSelectedWindow}
            onOpenSection={handleOpenSection}
            onRefresh={fetchAnalytics}
            customRange={{ from: customFrom, to: customTo }}
            onCustomRangeChange={({ from, to }) => {
              if (typeof from === 'string') setCustomFrom(from);
              if (typeof to === 'string') setCustomTo(to);
            }}
            onApplyCustomRange={handleApplyCustomRange}
            onClearCustomRange={handleClearCustomRange}
          />
        </Suspense>

        {analyticsError ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{analyticsError}</span>
              <Button type="button" variant="outline" size="sm" onClick={fetchAnalytics}>
                Retry Analytics
              </Button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-sm text-slate-700">
              Open any section below to launch the workspace window. Switching sections keeps the same window for a cleaner workflow.
            </p>
            {failedSections.length > 0 && (
              <p className="mt-1.5 text-xs text-amber-700">
                Some counts could not be loaded. Failed sections show <span className="font-semibold">--</span>.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <Clock3 className="h-4 w-4 text-slate-500" />
            <span className="text-xs text-slate-600">
              Last updated: {lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString() : '--'}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshAll}
              className="ml-2 gap-2"
              disabled={loadingCounts || analyticsLoading}
            >
              <RefreshCw className={cn('h-4 w-4', (loadingCounts || analyticsLoading) && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <LayoutPanelTop className="h-4 w-4 text-slate-700" />
              <h3 className="text-sm font-semibold text-slate-900">Report Domains</h3>
            </div>
            <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              <AlertCircle className="h-3.5 w-3.5" />
              Click any card to open related reports
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const tone = toneClasses[section.tone] || toneClasses.blue;
              const isActive = section.key === activeSection;

              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => handleOpenSection(section.key)}
                  className={cn(
                    'group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
                    tone.borderAccent,
                    isActive && tone.active
                  )}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className={cn('rounded-lg border p-2', tone.iconWrap)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className={cn('rounded-md border px-2 py-0.5 text-xs font-semibold', tone.count)}>
                      {formatCount(section.key)}
                    </span>
                  </div>

                  <p className="text-sm font-semibold text-slate-900">{section.label}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{section.description}</p>

                  <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-600 group-hover:text-slate-900">
                    View Reports
                    <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {windowOpen ? (
          <Suspense fallback={null}>
            <UnifiedReportWindow
              open={windowOpen}
              onClose={() => setWindowOpen(false)}
              title={activeMeta.label}
              subtitle={activeMeta.description}
            >
              <Suspense fallback={<SectionSkeleton />}>
                {renderSectionContent()}
              </Suspense>
            </UnifiedReportWindow>
          </Suspense>
        ) : null}
      </div>

    </div>
  );
};

export default UnifiedReports;
