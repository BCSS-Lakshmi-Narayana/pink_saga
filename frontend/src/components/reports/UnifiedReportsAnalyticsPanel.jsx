import React, { useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  Camera,
  FileText,
  Minus,
  PieChart as PieChartIcon,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Zap
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { exportAsPNG } from '../../lib/chartExportUtils';

/* ═══════════════════════════════════════════════════════════════════
   DOMAIN CONFIG (Query excluded per requirements)
   ═══════════════════════════════════════════════════════════════════ */
const DOMAIN_META = [
  { key: 'alerts', label: 'Alerts', icon: AlertTriangle, color: '#3b82f6', softBg: 'bg-blue-50', softBorder: 'border-blue-100', softText: 'text-blue-700', chartFill: 'url(#gradient-alerts)' },
  { key: 'grievance', label: 'Grievance', icon: FileText, color: '#f59e0b', softBg: 'bg-amber-50', softBorder: 'border-amber-100', softText: 'text-amber-700', chartFill: 'url(#gradient-grievance)' },
  { key: 'suggestion', label: 'Suggestions', icon: Building2, color: '#8b5cf6', softBg: 'bg-violet-50', softBorder: 'border-violet-100', softText: 'text-violet-700', chartFill: 'url(#gradient-suggestion)' },
  { key: 'criticism', label: 'Criticism', icon: Zap, color: '#ef4444', softBg: 'bg-rose-50', softBorder: 'border-rose-100', softText: 'text-rose-700', chartFill: 'url(#gradient-criticism)' }
];

const DOMAIN_KEYS = DOMAIN_META.map((d) => d.key);

const WINDOW_OPTIONS = [
  { key: 'weekly', label: 'Last 7 Days', shortLabel: '7D' },
  { key: 'monthly', label: 'Current Month', shortLabel: '1M' },
  { key: 'overall', label: 'All Time', shortLabel: 'All' },
  { key: 'custom', label: 'Custom Range', shortLabel: 'Custom' }
];

const PLATFORM_COLORS = { x: '#000000', youtube: '#FF0000', facebook: '#1877F2', instagram: '#E4405F', unknown: '#94a3b8' };
const PLATFORM_LABELS = { x: 'X (Twitter)', youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram', unknown: 'Other' };

/* ═══════════════════════════════════════════════════════════════════
   FORMATTERS
   ═══════════════════════════════════════════════════════════════════ */
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const numFmt = new Intl.NumberFormat('en-US');

const fmt = (v, compact = false) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '0';
  return compact ? compactFmt.format(n) : numFmt.format(n);
};

const fmtPct = (v) => {
  const n = Number(v || 0);
  const safe = Number.isFinite(n) ? n : 0;
  return `${safe > 0 ? '+' : ''}${safe.toFixed(1)}%`;
};

const prettifyStatus = (l) =>
  String(l || '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const STATUS_DISPLAY_CONFIG = {
  alerts: [
    { key: 'sent_to_intermediary', label: 'Sent To Intermediary' },
    { key: 'closed', label: 'Closed' }
  ],
  grievance: [
    { key: 'pending', label: 'Pending' },
    { key: 'escalated', label: 'Escalated' },
    { key: 'closed', label: 'Closed' },
    { key: 'fir', label: 'Fir' }
  ],
  suggestion: [],
  criticism: []
};

const getConfiguredStatusEntries = (domainKey, domainStatusMap = {}) => {
  const config = STATUS_DISPLAY_CONFIG[domainKey] || [];
  return config.map(({ key, label }) => ({
    key,
    label,
    count: Number(domainStatusMap?.[key] || 0)
  }));
};

/* ═══════════════════════════════════════════════════════════════════
   ANIMATION VARIANTS
   ═══════════════════════════════════════════════════════════════════ */
const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06, duration: 0.4, ease: 'easeOut' } })
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };

/* ═══════════════════════════════════════════════════════════════════
   CUSTOM TOOLTIP
   ═══════════════════════════════════════════════════════════════════ */
const PremiumTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <div className="space-y-1">
        {payload.map((e) => (
          <div key={e.name} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: e.color }} />
            <span className="text-xs text-slate-600">{e.name}:</span>
            <span className="text-xs font-bold text-slate-900">{fmt(e.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   EXPORT MENU
   ═══════════════════════════════════════════════════════════════════ */
const ExportMenu = ({ chartRef, title }) => {
  const handleExport = useCallback(async () => {
    const el = chartRef?.current;
    if (!el) return;
    const safeName = (title || 'chart').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    await exportAsPNG(el, safeName);
  }, [chartRef, title]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleExport}
        disabled={!chartRef}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow"
      >
        <Camera className="h-3.5 w-3.5" />
        Export Image
      </button>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   GROWTH BADGE
   ═══════════════════════════════════════════════════════════════════ */
const GrowthBadge = ({ value, compact = false }) => {
  const n = Number(value || 0);
  const pos = n > 0;
  const neutral = n === 0;
  const Icon = neutral ? Minus : pos ? TrendingUp : TrendingDown;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
      neutral && 'bg-slate-100 text-slate-500',
      pos && 'bg-emerald-50 text-emerald-700',
      !pos && !neutral && 'bg-rose-50 text-rose-700'
    )}>
      <Icon className="h-3 w-3" />
      {compact ? `${Math.abs(n).toFixed(0)}%` : fmtPct(n)}
    </span>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   SPARKLINE
   ═══════════════════════════════════════════════════════════════════ */
const Sparkline = ({ data, dataKey, color, height = 36 }) => {
  if (!data || data.length < 2) return null;
  const gradientId = `spark-${dataKey}`;
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#${gradientId})`} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
const UnifiedReportsAnalyticsPanel = ({
  data,
  loading,
  selectedWindow,
  onWindowChange,
  onOpenSection,
  onRefresh,
  customRange,
  onCustomRangeChange,
  onApplyCustomRange,
  onClearCustomRange
}) => {
  const effectiveWindow = selectedWindow === 'custom' && !data?.totals?.custom ? 'weekly' : selectedWindow;
  const selectedTotals = data?.totals?.[effectiveWindow] || {};
  const trend = data?.trend || {};
  const statuses = data?.status || {};
  const breakdowns = data?.breakdowns || {};

  const domainRows = useMemo(() =>
    DOMAIN_META.map((m) => ({
      ...m,
      value: Number(selectedTotals[m.key] || 0),
      weeklyPct: Number(trend?.delta?.[m.key]?.weeklyPct || 0),
      monthlyPct: Number(trend?.delta?.[m.key]?.monthlyPct || 0)
    })),
    [selectedTotals, trend]
  );

  const totalVisible = useMemo(() => domainRows.reduce((s, r) => s + r.value, 0), [domainRows]);
  const trendMetricKey =
    effectiveWindow === 'weekly'
      ? 'weeklyPct'
      : effectiveWindow === 'monthly'
        ? 'monthlyPct'
        : effectiveWindow === 'custom'
          ? 'customPct'
          : 'monthlyPct';

  const topDomain = useMemo(
    () => domainRows.length ? [...domainRows].sort((a, b) => b.value - a.value)[0] : null,
    [domainRows]
  );

  const strongestGrowth = useMemo(
    () => domainRows.length ? [...domainRows].sort((a, b) => Math.abs(b[trendMetricKey]) - Math.abs(a[trendMetricKey]))[0] : null,
    [domainRows, trendMetricKey]
  );

  const trendData = useMemo(() => {
    const raw = Array.isArray(data?.trend?.daily) ? data.trend.daily : [];
    return raw.map((r) => ({
      date: r.date,
      alerts: r.alerts || 0,
      grievance: r.grievance || 0,
      suggestion: r.suggestion || 0,
      criticism: r.criticism || 0,
      total: (r.alerts || 0) + (r.grievance || 0) + (r.suggestion || 0) + (r.criticism || 0)
    }));
  }, [data]);

  const weekTrend = useMemo(() => trendData.slice(-7), [trendData]);
  const analystTrendData = useMemo(() => {
    const arr = Array.isArray(trendData) ? trendData : [];
    return arr.map((row, idx) => {
      const start = Math.max(0, idx - 6);
      const slice = arr.slice(start, idx + 1);
      const movingAvg = slice.length
        ? Number((slice.reduce((sum, item) => sum + (item.total || 0), 0) / slice.length).toFixed(2))
        : 0;
      const volatility = Number(Math.abs((row.total || 0) - movingAvg).toFixed(2));
      return {
        ...row,
        movingAvg,
        volatility
      };
    });
  }, [trendData]);
  const pieData = useMemo(() => domainRows.filter((r) => r.value > 0), [domainRows]);

  const platformData = useMemo(() => {
    const bp = breakdowns?.alertPlatform || {};
    return Object.entries(bp).filter(([, v]) => v > 0).map(([k, v]) => ({
      name: PLATFORM_LABELS[k] || k, value: v, color: PLATFORM_COLORS[k] || PLATFORM_COLORS.unknown
    }));
  }, [breakdowns]);

  const categoryData = useMemo(() => {
    const cats = breakdowns?.grievanceCategory || {};
    const cc = ['#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#10b981', '#ec4899', '#06b6d4', '#f97316'];
    return Object.entries(cats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      .map(([n, v], i) => ({ name: n, value: v, color: cc[i % cc.length] }));
  }, [breakdowns]);

  const weeklyActivity = useMemo(() => breakdowns?.weeklyActivity || [], [breakdowns]);
  const statusBreakdownRows = useMemo(
    () => DOMAIN_META.flatMap((domain) => {
      const domainTotal = Number(selectedTotals?.[domain.key] || 0);
      const entries = getConfiguredStatusEntries(domain.key, statuses?.[domain.key] || {});

      if (!entries.length) {
        return [{ domain: domain.label, status: 'Total', count: domainTotal }];
      }

      return entries.map((entry) => ({
        domain: domain.label,
        status: entry.label,
        count: entry.count
      }));
    }),
    [selectedTotals, statuses]
  );
  const generatedAtLabel = data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : '--';

  const trendChartRef = useRef(null);
  const domainBarRef = useRef(null);
  const domainPieRef = useRef(null);
  const platformPieRef = useRef(null);
  const categoryBarRef = useRef(null);
  const statusPanelRef = useRef(null);
  const activityBarRef = useRef(null);
  const areaComparisonRef = useRef(null);

  const trendCSVCols = useMemo(() => [
    { key: 'date', label: 'Date' },
    ...DOMAIN_META.map((d) => ({ key: d.key, label: d.label })),
    { key: 'total', label: 'Total' }
  ], []);

  const domainCSVCols = [
    { key: 'label', label: 'Domain' },
    { key: 'value', label: 'Count' },
    { key: 'weeklyPct', label: 'Weekly Change (%)' },
    { key: 'monthlyPct', label: 'Monthly Change (%)' }
  ];

  /* Loading skeleton */
  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="animate-pulse space-y-5">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-5 w-56 rounded-lg bg-slate-200" />
              <div className="h-8 w-80 rounded-lg bg-slate-200" />
            </div>
            <div className="h-10 w-48 rounded-xl bg-slate-200" />
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 rounded-2xl bg-slate-100" />
            ))}
          </div>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-8 h-80 rounded-2xl bg-slate-100" />
            <div className="col-span-4 h-80 rounded-2xl bg-slate-100" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.section initial="hidden" animate="visible" variants={stagger} className="space-y-5">

      {/* ══════════ HEADER ══════════ */}
      <motion.div variants={fadeUp} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1">
            <Activity className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-blue-700">Analytics Command Center</span>
          </div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
            Unified Reports Intelligence
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Premium insight dashboard — Alerts, Grievances, Suggestions & Criticism
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => onWindowChange?.(opt.key)}
                className={cn(
                  'relative rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all sm:text-sm',
                  selectedWindow === opt.key
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm'
                )}
              >
                <span className="hidden sm:inline">{opt.label}</span>
                <span className="sm:hidden">{opt.shortLabel}</span>
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-2 rounded-xl border-slate-200">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
            <input
              type="date"
              value={customRange?.from || ''}
              onChange={(e) => onCustomRangeChange?.({ from: e.target.value })}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-slate-400"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={customRange?.to || ''}
              onChange={(e) => onCustomRangeChange?.({ to: e.target.value })}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-slate-400"
            />
            <Button size="sm" variant="outline" onClick={onApplyCustomRange} className="h-7 px-2 text-xs">Apply</Button>
            <Button size="sm" variant="ghost" onClick={onClearCustomRange} className="h-7 px-2 text-xs">Clear</Button>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[11px] text-slate-500">{generatedAtLabel}</span>
          </div>
        </div>
      </motion.div>

      {/* ══════════ KPI CARDS ══════════ */}
      <motion.div variants={stagger} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {/* Grand Total */}
        <motion.div
          variants={fadeUp}
          custom={0}
          className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-5 text-white shadow-lg sm:col-span-2 xl:col-span-1"
        >
          <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/5 blur-xl" />
          <div className="absolute -left-6 bottom-0 h-20 w-20 rounded-full bg-blue-500/10 blur-2xl" />
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Total Reports</p>
          <p className="mt-3 text-4xl font-black tracking-tight">{fmt(totalVisible, true)}</p>
          <div className="mt-2">
            <span className="text-xs text-slate-400">{WINDOW_OPTIONS.find((w) => w.key === selectedWindow)?.label}</span>
          </div>
          <div className="mt-3">
            <Sparkline data={weekTrend} dataKey="total" color="#60a5fa" height={32} />
          </div>
        </motion.div>

        {/* Domain KPIs */}
        {domainRows.map((row, idx) => {
          const Icon = row.icon;
          const delta = row[trendMetricKey];
          return (
            <motion.button
              key={row.key}
              type="button"
              variants={fadeUp}
              custom={idx + 1}
              onClick={() => onOpenSection?.(row.key)}
              className={cn(
                'group relative overflow-hidden rounded-2xl border p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg',
                row.softBg, row.softBorder
              )}
            >
              <div className="absolute -right-3 -top-3 h-16 w-16 rounded-full opacity-20 blur-2xl" style={{ backgroundColor: row.color }} />
              <div className="flex items-start justify-between">
                <div className={cn('rounded-xl border p-2', row.softBg, row.softBorder)}>
                  <Icon className="h-4 w-4" style={{ color: row.color }} />
                </div>
                <GrowthBadge value={delta} compact />
              </div>
              <p className="mt-3 text-3xl font-black tracking-tight text-slate-900">{fmt(row.value, true)}</p>
              <p className={cn('mt-1 text-sm font-semibold', row.softText)}>{row.label}</p>
              <div className="mt-2">
                <Sparkline data={weekTrend} dataKey={row.key} color={row.color} height={28} />
              </div>
              <div className="absolute bottom-0 left-0 h-1 w-full origin-left scale-x-0 transition-transform group-hover:scale-x-100" style={{ backgroundColor: row.color }} />
            </motion.button>
          );
        })}
      </motion.div>



      {/* ══════════ ROW 1: TREND AREA + DOMAIN PIE ══════════ */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* 30-Day Trend */}
        <div ref={trendChartRef} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-8">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <Activity className="h-4 w-4 text-blue-500" />30-Day Trend Analysis
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">Daily report activity across all domains</p>
            </div>
            <ExportMenu chartRef={trendChartRef} title="30-Day Trend Analysis" csvData={trendData} csvColumns={trendCSVCols} />
          </div>
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
                <defs>
                  {DOMAIN_META.map((d) => (
                    <linearGradient key={d.key} id={`gradient-${d.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={d.color} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={d.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tickFormatter={(v) => String(v).slice(5)} minTickGap={18} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<PremiumTooltip />} />
                <Legend wrapperStyle={{ paddingTop: 8, fontSize: 12, fontWeight: 600 }} onClick={(p) => p?.dataKey && onOpenSection?.(p.dataKey)} />
                {DOMAIN_META.map((d) => (
                  <Area key={d.key} type="monotone" dataKey={d.key} name={d.label} stroke={d.color} strokeWidth={2} fill={d.chartFill} dot={false} activeDot={{ r: 4, strokeWidth: 2 }} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Domain Donut */}
        <div ref={domainPieRef} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <PieChartIcon className="h-4 w-4 text-violet-500" />Domain Distribution
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">{WINDOW_OPTIONS.find((w) => w.key === selectedWindow)?.label}</p>
            </div>
            <ExportMenu chartRef={domainPieRef} title="Domain Distribution" csvData={domainRows.map((r) => ({ domain: r.label, count: r.value }))} csvColumns={[{ key: 'domain', label: 'Domain' }, { key: 'count', label: 'Reports' }]} />
          </div>
          <div className="relative h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData.length ? pieData : [{ key: 'empty', label: 'No Data', value: 1, color: '#e2e8f0' }]}
                  dataKey="value" nameKey="label" innerRadius={65} outerRadius={100} paddingAngle={3} cornerRadius={4}
                  onClick={(e) => e?.key && e.key !== 'empty' && onOpenSection?.(e.key)}
                >
                  {(pieData.length ? pieData : [{ key: 'empty', color: '#e2e8f0' }]).map((e) => (
                    <Cell key={e.key} fill={e.color} className={e.key === 'empty' ? '' : 'cursor-pointer'} stroke="white" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip content={<PremiumTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-3xl font-black text-slate-900">{fmt(totalVisible, true)}</p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Total</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {domainRows.map((row) => (
              <button key={row.key} type="button" onClick={() => onOpenSection?.(row.key)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-50">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                <span className="text-xs font-medium text-slate-600">{row.label}</span>
                <span className="ml-auto text-xs font-bold text-slate-800">{fmt(row.value, true)}</span>
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ══════════ ROW 2: DOMAIN BAR + COMPOSED OVERLAY ══════════ */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Domain Comparison */}
        <div ref={domainBarRef} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <BarChart3 className="h-4 w-4 text-emerald-500" />Domain Comparison
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">Report volume comparison by domain</p>
            </div>
            <ExportMenu chartRef={domainBarRef} title="Domain Comparison" csvData={domainRows} csvColumns={domainCSVCols} />
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={domainRows} margin={{ top: 8, right: 8, bottom: 8, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<PremiumTooltip />} />
                <Bar dataKey="value" name="Reports" radius={[8, 8, 0, 0]} maxBarSize={52} onClick={(r) => r?.key && onOpenSection?.(r.key)}>
                  {domainRows.map((r) => (
                    <Cell key={r.key} fill={r.color} className="cursor-pointer" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex justify-around">
            {domainRows.map((r) => (
              <div key={r.key} className="text-center"><GrowthBadge value={r[trendMetricKey]} compact /></div>
            ))}
          </div>
        </div>

        {/* Analyst Trend + Volatility */}
        <div ref={areaComparisonRef} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-7">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <TrendingUp className="h-4 w-4 text-sky-500" />Analyst Trend & Volatility
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">Total reports with 7-day moving average and volatility score</p>
            </div>
            <ExportMenu
              chartRef={areaComparisonRef}
              title="Analyst Trend Volatility"
              csvData={analystTrendData}
              csvColumns={[
                { key: 'date', label: 'Date' },
                { key: 'total', label: 'Total' },
                { key: 'movingAvg', label: '7-Day Moving Avg' },
                { key: 'volatility', label: 'Volatility' }
              ]}
            />
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={analystTrendData} margin={{ top: 8, right: 8, bottom: 8, left: -8 }}>
                <defs>
                  <linearGradient id="gradient-total-analyst" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tickFormatter={(v) => String(v).slice(5)} minTickGap={18} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<PremiumTooltip />} />
                <Legend wrapperStyle={{ paddingTop: 8, fontSize: 12, fontWeight: 600 }} />
                <Area yAxisId="left" type="monotone" dataKey="total" name="Total" stroke="#0284c7" strokeWidth={2} fill="url(#gradient-total-analyst)" dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="movingAvg" name="7D Avg" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Bar yAxisId="right" dataKey="volatility" name="Volatility" fill="#f59e0b" maxBarSize={24} radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

      </motion.div>

      {/* ══════════ ROW 3: PLATFORM PIE + CATEGORY BAR + WEEKLY ACTIVITY ══════════ */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Alert Platform Breakdown */}
        <div ref={platformPieRef} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <PieChartIcon className="h-4 w-4 text-blue-500" />Alert Platforms
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">Distribution by source platform</p>
            </div>
            <ExportMenu chartRef={platformPieRef} title="Alert Platform Breakdown" csvData={platformData} csvColumns={[{ key: 'name', label: 'Platform' }, { key: 'value', label: 'Alerts' }]} />
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={platformData.length ? platformData : [{ name: 'No Data', value: 1, color: '#e2e8f0' }]}
                  dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2} cornerRadius={3}
                >
                  {(platformData.length ? platformData : [{ name: 'No Data', color: '#e2e8f0' }]).map((e, i) => (
                    <Cell key={i} fill={e.color} stroke="white" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip content={<PremiumTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 space-y-1.5">
            {platformData.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg px-2 py-1">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="text-xs font-medium text-slate-600">{p.name}</span>
                </div>
                <span className="text-xs font-bold text-slate-800">{fmt(p.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Grievance Categories */}
        <div ref={categoryBarRef} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <BarChart3 className="h-4 w-4 text-amber-500" />Grievance Categories
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">By classification category</p>
            </div>
            <ExportMenu chartRef={categoryBarRef} title="Grievance Category Breakdown" csvData={categoryData} csvColumns={[{ key: 'name', label: 'Category' }, { key: 'value', label: 'Count' }]} />
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData.slice(0, 6)} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b', fontWeight: 500 }} width={85} axisLine={false} tickLine={false} />
                <Tooltip content={<PremiumTooltip />} />
                <Bar dataKey="value" name="Reports" radius={[0, 6, 6, 0]} maxBarSize={22}>
                  {categoryData.slice(0, 6).map((e, i) => (
                    <Cell key={i} fill={e.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Weekly Activity */}
        <div ref={activityBarRef} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <CalendarDays className="h-4 w-4 text-violet-500" />Weekly Activity
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">Alert volume by day of week</p>
            </div>
            <ExportMenu chartRef={activityBarRef} title="Weekly Activity Pattern" csvData={weeklyActivity} csvColumns={[{ key: 'day', label: 'Day' }, { key: 'count', label: 'Alerts' }]} />
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyActivity.length ? weeklyActivity : []} margin={{ top: 8, right: 8, bottom: 8, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<PremiumTooltip />} />
                <Bar dataKey="count" name="Alerts" radius={[6, 6, 0, 0]} maxBarSize={36}>
                  {(weeklyActivity || []).map((_, i) => (
                    <Cell key={i} fill={i === new Date().getDay() ? '#3b82f6' : '#cbd5e1'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {weeklyActivity.length === 0 && <p className="mt-2 text-center text-xs text-slate-400">No activity data yet</p>}
        </div>
      </motion.div>

      {/* ══════════ ROW 4: STATUS BREAKDOWN ══════════ */}
      <motion.div variants={fadeUp} ref={statusPanelRef}>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <FileText className="h-4 w-4 text-slate-500" />Status Breakdown by Domain
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">Current status distribution across all report domains</p>
            </div>
            <ExportMenu
              chartRef={statusPanelRef}
              title="Status Breakdown"
              csvData={statusBreakdownRows}
              csvColumns={[{ key: 'domain', label: 'Domain' }, { key: 'status', label: 'Status' }, { key: 'count', label: 'Count' }]}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {DOMAIN_META.map((domain) => {
              const configuredEntries = getConfiguredStatusEntries(domain.key, statuses?.[domain.key] || {});
              const total = Number(selectedTotals?.[domain.key] || 0);
              const breakdownTotal = configuredEntries.reduce((s, entry) => s + entry.count, 0);
              const visualEntries = configuredEntries.length
                ? configuredEntries
                : [{ key: 'total', label: 'Total', count: total }];
              const visualTotal = configuredEntries.length ? (breakdownTotal || total) : total;
              const Icon = domain.icon;
              return (
                <button
                  key={domain.key}
                  type="button"
                  onClick={() => onOpenSection?.(domain.key)}
                  className={cn('group rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md', domain.softBg, domain.softBorder)}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" style={{ color: domain.color }} />
                      <span className={cn('text-sm font-bold', domain.softText)}>{domain.label}</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-500">{fmt(total)}</span>
                  </div>
                  {visualTotal > 0 && (
                    <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-white/60">
                      {visualEntries.map((entry, idx) => {
                        const pct = (entry.count / visualTotal) * 100;
                        const opacities = ['', 'cc', '99', '66', '44', '22'];
                        return (
                          <div
                            key={entry.key}
                            className="h-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: domain.color + (opacities[idx] || ''),
                              minWidth: entry.count > 0 ? 4 : 0
                            }}
                            title={`${entry.label}: ${entry.count}`}
                          />
                        );
                      })}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {visualEntries.length ? visualEntries.map((entry) => (
                      <div key={entry.key} className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-slate-600">{entry.label}</span>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/60">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${visualTotal ? (entry.count / visualTotal) * 100 : 0}%`,
                                backgroundColor: domain.color
                              }}
                            />
                          </div>
                          <span className="w-8 text-right text-[11px] font-bold text-slate-700">{fmt(entry.count)}</span>
                        </div>
                      </div>
                    )) : <p className="text-xs text-slate-400">No status data</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </motion.div>

      {/* ══════════ ROW 5: PERIOD COMPARISON TABLE ══════════ */}
      <motion.div variants={fadeUp}>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <TrendingUp className="h-4 w-4 text-emerald-500" />Period Comparison Matrix
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">Weekly, monthly, and overall totals with growth indicators</p>
            </div>
            <ExportMenu
              chartRef={null}
              title="Period Comparison"
              csvData={DOMAIN_META.map((d) => ({
                domain: d.label,
                weekly: data?.totals?.weekly?.[d.key] || 0,
                monthly: data?.totals?.monthly?.[d.key] || 0,
                overall: data?.totals?.overall?.[d.key] || 0,
                weekly_change: fmtPct(trend?.delta?.[d.key]?.weeklyPct || 0),
                monthly_change: fmtPct(trend?.delta?.[d.key]?.monthlyPct || 0)
              }))}
              csvColumns={[
                { key: 'domain', label: 'Domain' },
                { key: 'weekly', label: 'Weekly' },
                { key: 'monthly', label: 'Monthly' },
                { key: 'overall', label: 'Overall' },
                { key: 'weekly_change', label: 'Weekly Change' },
                { key: 'monthly_change', label: 'Monthly Change' }
              ]}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">Domain</th>
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-400">Weekly</th>
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-400">Monthly</th>
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-400">Overall</th>
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-400">Weekly &#916;</th>
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-400">Monthly &#916;</th>
                </tr>
              </thead>
              <tbody>
                {DOMAIN_META.map((domain, idx) => {
                  const Icon = domain.icon;
                  const w = data?.totals?.weekly?.[domain.key] || 0;
                  const m = data?.totals?.monthly?.[domain.key] || 0;
                  const o = data?.totals?.overall?.[domain.key] || 0;
                  const wP = trend?.delta?.[domain.key]?.weeklyPct || 0;
                  const mP = trend?.delta?.[domain.key]?.monthlyPct || 0;
                  return (
                    <motion.tr
                      key={domain.key}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="group cursor-pointer border-b border-slate-50 transition-colors hover:bg-slate-50"
                      onClick={() => onOpenSection?.(domain.key)}
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${domain.color}15` }}>
                            <Icon className="h-4 w-4" style={{ color: domain.color }} />
                          </div>
                          <span className="text-sm font-semibold text-slate-800">{domain.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right"><span className="text-sm font-bold text-slate-900">{fmt(w)}</span></td>
                      <td className="px-4 py-3.5 text-right"><span className="text-sm font-bold text-slate-900">{fmt(m)}</span></td>
                      <td className="px-4 py-3.5 text-right"><span className="text-sm font-bold text-slate-900">{fmt(o)}</span></td>
                      <td className="px-4 py-3.5 text-right"><GrowthBadge value={wP} /></td>
                      <td className="px-4 py-3.5 text-right"><GrowthBadge value={mP} /></td>
                    </motion.tr>
                  );
                })}
                <tr className="border-t-2 border-slate-200 bg-slate-50/50">
                  <td className="px-4 py-3.5"><span className="text-sm font-bold text-slate-700">All Domains</span></td>
                  <td className="px-4 py-3.5 text-right">
                    <span className="text-sm font-black text-slate-900">{fmt(DOMAIN_KEYS.reduce((s, k) => s + (data?.totals?.weekly?.[k] || 0), 0))}</span>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span className="text-sm font-black text-slate-900">{fmt(DOMAIN_KEYS.reduce((s, k) => s + (data?.totals?.monthly?.[k] || 0), 0))}</span>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span className="text-sm font-black text-slate-900">{fmt(DOMAIN_KEYS.reduce((s, k) => s + (data?.totals?.overall?.[k] || 0), 0))}</span>
                  </td>
                  <td className="px-4 py-3.5" />
                  <td className="px-4 py-3.5" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

    </motion.section>
  );
};

export default UnifiedReportsAnalyticsPanel;
