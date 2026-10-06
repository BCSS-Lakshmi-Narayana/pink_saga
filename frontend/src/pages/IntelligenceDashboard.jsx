import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Link, useNavigate } from  'react-router-dom';
import { motion } from 'framer-motion';
import '@fontsource/noto-sans-telugu';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronRight,
  Circle,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Globe,
  Hash,
  KeyRound,
  Layers,
  MessageSquare,
  Minus,
  Monitor,
  Search,
  PieChart as PieChartIcon,
  RefreshCw,
  Shield,
  Tag,
  TrendingDown,
  TrendingUp,
  Twitter,
  User,
  UserSearch,
  Users,
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
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { exportAsPNG } from '../lib/chartExportUtils';

const EventsReportEmbed = lazy(() => import('./EventsReport'));
const XBulkActionsEmbed = lazy(() => import('../components/reports/XBulkActions'));
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import html2canvas from 'html2canvas';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { FrequentEngagersDialog } from '../components/AlertCards';

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS & UTILITIES
   ═══════════════════════════════════════════════════════════════════ */
const TABS = [
  { key: 'alerts', label: 'Alerts Reports', icon: AlertTriangle, color: '#3b82f6', bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-700' },
  { key: 'grievances', label: 'Grievances Reports', icon: MessageSquare, color: '#f59e0b', bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-700' },
  { key: 'profiles', label: 'Profiles Reports', icon: UserSearch, color: '#8b5cf6', bg: 'bg-violet-50', border: 'border-violet-100', text: 'text-violet-700' },
  { key: 'events', label: 'Events Report', icon: CalendarDays, color: '#10b981', bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-700' },
  { key: 'xactions', label: 'X Bulk Actions', icon: Twitter, color: '#0ea5e9', bg: 'bg-sky-50', border: 'border-sky-100', text: 'text-sky-700' }
];

const PLATFORM_COLORS = { x: '#000000', youtube: '#FF0000', facebook: '#1877F2', instagram: '#E4405F', whatsapp: '#25D366', unknown: '#94a3b8' };
const PLATFORM_LABELS = { x: 'X (Twitter)', youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp', unknown: 'Other' };
const RISK_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
const ALERT_TOPIC_ORDER = [
  'Public Complaint',
  'Political Criticism',
  'Law & Order',
  'Corruption Complaint',
  'Public Nuisance',
  'Hate Speech',
  'General Complaint'
];
const STATUS_COLORS = {
  generated: '#3b82f6', printed: '#8b5cf6', sent: '#10b981', sent_to_intermediary: '#f59e0b',
  awaiting_reply: '#ec4899', closed: '#64748b', active: '#3b82f6', acknowledged: '#8b5cf6',
  resolved: '#10b981', false_positive: '#94a3b8', escalated: '#ef4444',
  PENDING: '#f59e0b', ESCALATED: '#ef4444', CLOSED: '#64748b',
  received: '#3b82f6', reviewed: '#8b5cf6', action_taken: '#10b981', converted_to_fir: '#ef4444'
};
const CHART_PALETTE = ['#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#10b981', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1'];
const ALERTS_REPORT_PAGE_SIZE = 25;
const GRIEVANCES_REPORT_PAGE_SIZE = 25;
const REPORT_EXPORT_BATCH_SIZE = 200;

const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const numFmt = new Intl.NumberFormat('en-US');
const fmt = (v, compact = false) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '0';
  return compact ? compactFmt.format(n) : numFmt.format(n);
};
const prettify = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const formatRangeLabel = (from, to) => {
  if (!from && !to) return 'All time';
  const fromLabel = from ? new Date(from).toLocaleDateString('en-GB') : '...';
  const toLabel = to ? new Date(to).toLocaleDateString('en-GB') : '...';
  return `${fromLabel} – ${toLabel}`;
};
const normalizeTopicLabel = (topic) => {
  const raw = String(topic || '').trim();
  const normalized = raw.toLowerCase();
  if (['government praise', 'govt praise', 'general praise'].includes(normalized)) return 'General Complaint';
  return raw;
};
const truncateText = (value, max = 90) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
};
const buildPaginationItems = (currentPage, totalPages) => {
  if (totalPages <= 1) return [];
  const items = [];
  for (let page = 1; page <= totalPages; page += 1) {
    if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
      items.push(page);
    }
  }
  return items.reduce((acc, page) => {
    if (acc.length > 0 && page - acc[acc.length - 1] > 1) acc.push('...');
    acc.push(page);
    return acc;
  }, []);
};
const normalizeAlertReportRow = (alert) => ({
  ...alert,
  _topic: normalizeTopicLabel(alert?.llm_analysis?.grievance_type),
  _createdAtLabel: alert?.created_at ? new Date(alert.created_at).toLocaleDateString('en-GB') : '',
  _postUrl: alert?.content_details?.content_url || alert?.content_url || '',
  _authorName: alert?.author || alert?.source_meta?.name || '',
  _handle: alert?.content_details?.author_handle || alert?.author_handle || alert?.source_meta?.handle || '',
  _category: alert?.source_category || '',
  _translatedText: String(alert?.content_details?.translated_text || '').replace(/\s+/g, ' ').trim(),
  _rawContentText: String(
    alert?.content_details?.text
    || alert?.content_details?.scraped_content
    || alert?.description
    || alert?.title
    || ''
  ).replace(/\s+/g, ' ').trim(),
  _contentText: String(
    alert?.content_details?.translated_text
    || alert?.content_details?.text
    || alert?.content_details?.scraped_content
    || alert?.description
    || alert?.title
    || ''
  ).replace(/\s+/g, ' ').trim(),
  _mediaImages: (() => {
    const media = alert?.content_details?.media || [];
    return media
      .filter(m => m && (m.url || m.preview || m.s3_url))
      .filter(m => !String(m.type || m.media_type || '').toLowerCase().includes('video'))
      .map(m => m.s3_url || m.url || m.preview)
      .filter(Boolean)
      .slice(0, 3);
  })(),
});
const normalizeGrievanceReportRow = (report) => ({
  ...report,
  unique_code: report.complaint_code || report.id || '',
  posted_by: {
    display_name: report.complainant?.name || report.posted_by?.display_name || report.posted_by?.handle || 'Unknown',
    handle: report.complainant?.handle || report.posted_by?.handle || '',
    profile_image_url: report.posted_by?.profile_image_url || '',
  },
  post_description: report.content_text || report.content?.full_text || report.content?.text || '',
  sentiment: report.analysis?.sentiment || '',
  category: report.analysis?.category || '',
  topic: normalizeTopicLabel(report.analysis?.grievance_type || ''),
  risk_level: report.analysis?.risk_level || '',
  post_link: report.tweet_url || '',
  post_date: report.post_date || report.detected_date || null,
  informed_to: null,
  status: report.workflow_status || report.complaint?.status || '',
  _type: 'grievance',
  grievance_text: report.content_text || report.content?.full_text || report.content?.text || '',
});

const dedupeAlertsByAuthor = (rows) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = (row._handle || row._authorName || '').toLowerCase().trim();
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, { ...row, _postCount: 1 });
    } else {
      const existing = map.get(key);
      existing._postCount += 1;
    }
  });
  return Array.from(map.values());
};

const dedupeGrievancesByAuthor = (rows) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = (row.posted_by?.handle || row.posted_by?.display_name || '').toLowerCase().trim();
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, { ...row, _postCount: 1 });
    } else {
      const existing = map.get(key);
      existing._postCount += 1;
    }
  });
  return Array.from(map.values());
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' } })
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };

/* ═══════════════════════════════════════════════════════════════════
   SHARED SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════ */
const ChartTooltip = ({ active, payload, label }) => {
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

const GrowthBadge = ({ value }) => {
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
      {`${n > 0 ? '+' : ''}${n.toFixed(1)}%`}
    </span>
  );
};

const ExportButton = ({ chartRef, title }) => {
  const handleExport = useCallback(async () => {
    const el = chartRef?.current;
    if (!el) return;
    const safeName = (title || 'chart').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    await exportAsPNG(el, safeName);
  }, [chartRef, title]);
  return (
    <button type="button" onClick={handleExport} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50">
      <Camera className="h-3.5 w-3.5" /> Export
    </button>
  );
};

const KpiCard = ({ label, value, icon: Icon, color, subtitle, growth, onClick, onDownload }) => {
  const SafeIcon = Icon || Activity;

  return (
    <motion.div
      variants={fadeUp}
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-2xl border p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg',
        onClick ? 'cursor-pointer' : 'cursor-default'
      )}
      style={{ borderColor: `${color}30`, backgroundColor: `${color}08` }}
    >
      <div className="absolute -right-3 -top-3 h-16 w-16 rounded-full opacity-20 blur-2xl" style={{ backgroundColor: color }} />
      <div className="flex items-start justify-between">
        <div className="rounded-xl border p-2" style={{ borderColor: `${color}30`, backgroundColor: `${color}15` }}>
          <SafeIcon className="h-4 w-4" style={{ color }} />
        </div>
        <div className="flex gap-1 items-center">
          {growth !== undefined && <GrowthBadge value={growth} />}
          {onDownload && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDownload(); }}
              className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50"
              title={`Download ${label}`}
            >
              <Download className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <p className="mt-3 text-3xl font-black tracking-tight text-slate-900">{fmt(value, true)}</p>
      <p className="mt-1 text-sm font-semibold" style={{ color }}>{label}</p>
      {subtitle && <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p>}
    </motion.div>
  );
};

const ChartCard = React.forwardRef(({ title, subtitle, icon: Icon, iconColor, children, className }, ref) => (
  <div ref={ref} className={cn('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm', className)}>
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          {Icon && <Icon className="h-4 w-4" style={{ color: iconColor || '#3b82f6' }} />}
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
      {ref && <ExportButton chartRef={ref} title={title} />}
    </div>
    {children}
  </div>
));
ChartCard.displayName = 'ChartCard';

const EmptyState = ({ message }) => (
  <div className="flex h-[200px] items-center justify-center">
    <p className="text-sm text-slate-400">{message || 'No data available'}</p>
  </div>
);

/* ═══════════════════════════════════════════════════════════════════
   ALERTS INTELLIGENCE TAB
   ═══════════════════════════════════════════════════════════════════ */
const AlertsIntelligence = ({ data, dateFrom, dateTo }) => {
  const refs = {
    riskTrend: useRef(null),
    riskDist: useRef(null),
    platformDist: useRef(null),
    escalations: useRef(null),
    escalationPlatform: useRef(null),
    actions: useRef(null),
    topAccounts: useRef(null),
    keywords: useRef(null),
    keywordMatches: useRef(null),
    reportStatus: useRef(null),
    accountsTrend: useRef(null),
    alertTypes: useRef(null),
    riskPlatform: useRef(null),
    alertStatus: useRef(null)
  };

  const [alertRows, setAlertRows] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportSearch, setReportSearch] = useState('');
  const [reportPlatformFilter, setReportPlatformFilter] = useState('all');
  const [reportRiskFilter, setReportRiskFilter] = useState('all');
  const [reportTopicFilter, setReportTopicFilter] = useState('all');
  const [topicCounts, setTopicCounts] = useState([]);
  const [alertsPage, setAlertsPage] = useState(1);
  const [alertsPagination, setAlertsPagination] = useState({ total: 0, totalPages: 0, hasMore: false });
  const [alertsExporting, setAlertsExporting] = useState(false);
  const [alertsIncludeContentDetails, setAlertsIncludeContentDetails] = useState(true);
  const [alertsViewMode, setAlertsViewMode] = useState('all'); // 'all' | 'profiles'
  const [alertsProfileRows, setAlertsProfileRows] = useState([]);
  const [alertsProfilesLoading, setAlertsProfilesLoading] = useState(false);
  const [profilesModalOpen, setProfilesModalOpen] = useState(false);
  const [monitoredSources, setMonitoredSources] = useState([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [modalSearch, setModalSearch] = useState('');
  const [modalPlatformFilter, setModalPlatformFilter] = useState('all');
  const [modalCategoryFilter, setModalCategoryFilter] = useState('all');
  const [modalStatusFilter, setModalStatusFilter] = useState('all');
  const [escalationCounts, setEscalationCounts] = useState({});
  const [modalView, setModalView] = useState('overview'); // 'overview' | 'list'
  const [newProfilesModalOpen, setNewProfilesModalOpen] = useState(false);
  const [frequentEngagersOpen, setFrequentEngagersOpen] = useState(false);
  const [topKeywordsModalOpen, setTopKeywordsModalOpen] = useState(false);
  const navigate = useNavigate();

  const PROFILE_CATEGORIES = [
    { value: 'political', label: 'Political' },
    { value: 'communal', label: 'Communal' },
    { value: 'trouble_makers', label: 'Trouble Makers' },
    { value: 'defamation', label: 'Defamation' },
    { value: 'narcotics', label: 'Narcotics' },
    { value: 'history_sheeters', label: 'History Sheeters' },
    { value: 'others', label: 'Others' }
  ];

  const PROFILE_PLATFORM_ORDER = ['x', 'youtube', 'facebook', 'instagram', 'whatsapp', 'telegram'];

  const PROFILE_PLATFORM_THEMES = {
    x: { label: 'X', rowClass: 'bg-slate-200/70 hover:bg-slate-300/70', stickyClass: 'bg-slate-200/80', color: '#000000', dotClass: 'bg-black' },
    youtube: { label: 'YouTube', rowClass: 'bg-red-200/60 hover:bg-red-300/60', stickyClass: 'bg-red-200/75', color: '#FF0000', dotClass: 'bg-red-500' },
    facebook: { label: 'Facebook', rowClass: 'bg-blue-200/60 hover:bg-blue-300/60', stickyClass: 'bg-blue-200/75', color: '#1877F2', dotClass: 'bg-blue-500' },
    instagram: { label: 'Instagram', rowClass: 'bg-pink-200/60 hover:bg-pink-300/60', stickyClass: 'bg-pink-200/75', color: '#E4405F', dotClass: 'bg-pink-500' },
    whatsapp: { label: 'WhatsApp', rowClass: 'bg-emerald-200/60 hover:bg-emerald-300/60', stickyClass: 'bg-emerald-200/75', color: '#25D366', dotClass: 'bg-emerald-500' },
    telegram: { label: 'Telegram', rowClass: 'bg-cyan-200/60 hover:bg-cyan-300/60', stickyClass: 'bg-cyan-200/75', color: '#26A5E4', dotClass: 'bg-cyan-500' },
  };

  const PRIORITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
  const RISK_BADGE_COLORS = { critical: '#7c2d12', high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };

  // Normalize a source's platform & category
  const normalizeSource = useCallback((source) => {
    let p = String(source?.platform || '').trim().toLowerCase();
    if (p === 'twitter') p = 'x';
    if (p === 'fb') p = 'facebook';
    if (p === 'yt') p = 'youtube';
    if (!p) p = 'unknown';
    const catSet = new Set(PROFILE_CATEGORIES.map(c => c.value));
    let c = String(source?.category || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!c || !catSet.has(c)) c = 'others';
    return { ...source, _normPlatform: p, _normCategory: c };
  }, []);

  const normalizedSources = useMemo(() => monitoredSources.map(normalizeSource), [monitoredSources, normalizeSource]);

  const profilesMatrix = useMemo(() => {
    const catKeys = PROFILE_CATEGORIES.map(c => c.value);
    const platformCounts = {};

    const mkCell = () => ({ total: 0, active: 0, inactive: 0 });

    normalizedSources.forEach(source => {
      const p = source._normPlatform;
      const c = source._normCategory;
      const active = source.is_active !== false;

      if (!platformCounts[p]) {
        platformCounts[p] = { _total: mkCell() };
        catKeys.forEach(k => { platformCounts[p][k] = mkCell(); });
      }
      platformCounts[p][c].total += 1;
      platformCounts[p][c][active ? 'active' : 'inactive'] += 1;
      platformCounts[p]._total.total += 1;
      platformCounts[p]._total[active ? 'active' : 'inactive'] += 1;
    });

    const extra = Object.keys(platformCounts).filter(p => !PROFILE_PLATFORM_ORDER.includes(p)).sort();
    const ordered = [...PROFILE_PLATFORM_ORDER, ...extra];
    const rows = ordered.filter(p => platformCounts[p]).map(p => ({ platform: p, counts: platformCounts[p] }));
    const totalsByCategory = catKeys.reduce((acc, k) => {
      const cell = mkCell();
      rows.forEach(r => {
        cell.total += r.counts[k].total;
        cell.active += r.counts[k].active;
        cell.inactive += r.counts[k].inactive;
      });
      acc[k] = cell;
      return acc;
    }, {});
    const grandTotal = mkCell();
    rows.forEach(r => {
      grandTotal.total += r.counts._total.total;
      grandTotal.active += r.counts._total.active;
      grandTotal.inactive += r.counts._total.inactive;
    });
    return { rows, totalsByCategory, grandTotal };
  }, [normalizedSources]);

  // Filtered sources for the profiles list view
  const filteredSources = useMemo(() => {
    let list = normalizedSources;
    if (modalPlatformFilter !== 'all') list = list.filter(s => s._normPlatform === modalPlatformFilter);
    if (modalCategoryFilter !== 'all') list = list.filter(s => s._normCategory === modalCategoryFilter);
    if (modalStatusFilter === 'active') list = list.filter(s => s.is_active !== false);
    if (modalStatusFilter === 'inactive') list = list.filter(s => s.is_active === false);
    if (modalSearch.trim()) {
      const q = modalSearch.trim().toLowerCase();
      list = list.filter(s =>
        (s.display_name || '').toLowerCase().includes(q) ||
        (s.identifier || '').toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [normalizedSources, modalPlatformFilter, modalCategoryFilter, modalStatusFilter, modalSearch]);

  // ─── Export Helpers ───
  const exportMatrixPDF = useCallback(() => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 297, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Profiles Being Monitored \u2014 Overview Matrix', 14, 12);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total: ${profilesMatrix.grandTotal.total} | Active: ${profilesMatrix.grandTotal.active} | Inactive: ${profilesMatrix.grandTotal.inactive} | Generated: ${new Date().toLocaleString('en-IN')}`, 14, 20);

    const head = [['Platform', ...PROFILE_CATEGORIES.map(c => c.label), 'Total']];
    const body = profilesMatrix.rows.map(row => {
      const theme = PROFILE_PLATFORM_THEMES[row.platform] || { label: row.platform };
      return [
        theme.label,
        ...PROFILE_CATEGORIES.map(cat => {
          const c = row.counts[cat.value] || { total: 0, active: 0, inactive: 0 };
          return `${c.total}\nActive: ${c.active}  |  Inactive: ${c.inactive}`;
        }),
        `${row.counts._total.total}\nActive: ${row.counts._total.active}  |  Inactive: ${row.counts._total.inactive}`
      ];
    });
    body.push([
      'ALL PLATFORMS',
      ...PROFILE_CATEGORIES.map(cat => {
        const c = profilesMatrix.totalsByCategory[cat.value] || { total: 0, active: 0, inactive: 0 };
        return `${c.total}\nActive: ${c.active}  |  Inactive: ${c.inactive}`;
      }),
      `${profilesMatrix.grandTotal.total}\nActive: ${profilesMatrix.grandTotal.active}  |  Inactive: ${profilesMatrix.grandTotal.inactive}`
    ]);

    autoTable(doc, {
      head, body, startY: 30,
      styles: { fontSize: 7, cellPadding: 2.5, halign: 'center', lineWidth: 0.1, lineColor: [200, 200, 200] },
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [226, 232, 240];
        }
      }
    });
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) { doc.setPage(p); doc.setFontSize(7); doc.setTextColor(148, 163, 184); doc.text(`Page ${p}/${pageCount}`, 148, 205, { align: 'center' }); }
    doc.save(`profiles_matrix_${new Date().toISOString().split('T')[0]}.pdf`);
  }, [profilesMatrix]);

  const exportMatrixExcel = useCallback(() => {
    const rows = profilesMatrix.rows.map(row => {
      const theme = PROFILE_PLATFORM_THEMES[row.platform] || { label: row.platform };
      const obj = { 'Platform': theme.label };
      PROFILE_CATEGORIES.forEach(cat => {
        const c = row.counts[cat.value] || { total: 0, active: 0, inactive: 0 };
        obj[`${cat.label} - Total`] = c.total;
        obj[`${cat.label} - Active`] = c.active;
        obj[`${cat.label} - Inactive`] = c.inactive;
      });
      obj['Grand Total'] = row.counts._total.total;
      obj['Total Active'] = row.counts._total.active;
      obj['Total Inactive'] = row.counts._total.inactive;
      return obj;
    });
    const totalsRow = { 'Platform': 'ALL PLATFORMS' };
    PROFILE_CATEGORIES.forEach(cat => {
      const c = profilesMatrix.totalsByCategory[cat.value] || { total: 0, active: 0, inactive: 0 };
      totalsRow[`${cat.label} - Total`] = c.total;
      totalsRow[`${cat.label} - Active`] = c.active;
      totalsRow[`${cat.label} - Inactive`] = c.inactive;
    });
    totalsRow['Grand Total'] = profilesMatrix.grandTotal.total;
    totalsRow['Total Active'] = profilesMatrix.grandTotal.active;
    totalsRow['Total Inactive'] = profilesMatrix.grandTotal.inactive;
    rows.push(totalsRow);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Matrix');
    const meta = [{ Field: 'Report', Value: 'Profiles Being Monitored - Matrix' }, { Field: 'Total Profiles', Value: profilesMatrix.grandTotal.total }, { Field: 'Active', Value: profilesMatrix.grandTotal.active }, { Field: 'Inactive', Value: profilesMatrix.grandTotal.inactive }, { Field: 'Generated', Value: new Date().toLocaleString('en-IN') }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), 'Info');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `profiles_matrix_${new Date().toISOString().split('T')[0]}.xlsx`);
  }, [profilesMatrix]);

  const exportProfilesPDF = useCallback(() => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 297, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Monitored Profiles \u2014 Detailed List', 14, 12);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total: ${filteredSources.length} profiles | Generated: ${new Date().toLocaleString('en-IN')}`, 14, 20);
    const head = [['#', 'Name', 'Handle', 'Platform', 'Category', 'Status', 'Escalations', 'Added']];
    const body = filteredSources.map((s, i) => {
      const theme = PROFILE_PLATFORM_THEMES[s._normPlatform] || { label: s._normPlatform };
      return [i + 1, s.display_name || s.identifier || '', s.identifier || '', theme.label, prettify(s._normCategory), s.is_active !== false ? 'Active' : 'Inactive', escalationCounts[s.id] || 0, s.created_at ? new Date(s.created_at).toLocaleDateString('en-GB') : ''];
    });
    autoTable(doc, {
      head, body, startY: 30,
      styles: { fontSize: 6.5, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: 10 } },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 5) {
          data.cell.styles.textColor = data.cell.raw === 'Active' ? [22, 163, 74] : [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) { doc.setPage(p); doc.setFontSize(7); doc.setTextColor(148, 163, 184); doc.text(`Page ${p}/${pageCount}`, 148, 205, { align: 'center' }); }
    doc.save(`monitored_profiles_${new Date().toISOString().split('T')[0]}.pdf`);
  }, [filteredSources, escalationCounts]);

  const exportProfilesExcel = useCallback(() => {
    const rows = filteredSources.map((s, i) => {
      const theme = PROFILE_PLATFORM_THEMES[s._normPlatform] || { label: s._normPlatform };
      return { '#': i + 1, 'Name': s.display_name || s.identifier || '', 'Handle': s.identifier || '', 'Platform': theme.label, 'Category': prettify(s._normCategory), 'Status': s.is_active !== false ? 'Active' : 'Inactive', 'Escalations': escalationCounts[s.id] || 0, 'Date Added': s.created_at ? new Date(s.created_at).toLocaleDateString('en-GB') : '' };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Profiles');
    const meta = [{ Field: 'Report', Value: 'Monitored Profiles - Detailed List' }, { Field: 'Total', Value: filteredSources.length }, { Field: 'Active', Value: filteredSources.filter(s => s.is_active !== false).length }, { Field: 'Inactive', Value: filteredSources.filter(s => s.is_active === false).length }, { Field: 'Generated', Value: new Date().toLocaleString('en-IN') }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), 'Info');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `monitored_profiles_${new Date().toISOString().split('T')[0]}.xlsx`);
  }, [filteredSources, escalationCounts]);

  // Profiles added in the selected date range
  const newProfilesInRange = useMemo(() => {
    if (!normalizedSources.length) return [];
    return normalizedSources.filter(s => {
      if (!s.created_at) return false;
      const d = new Date(s.created_at);
      if (dateFrom && d < new Date(dateFrom)) return false;
      if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); if (d > to) return false; }
      return true;
    });
  }, [normalizedSources, dateFrom, dateTo]);

  const exportNewProfilesPDF = useCallback(() => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFillColor(16, 185, 129);
    doc.rect(0, 0, 297, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('New Profiles Added', 14, 12);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    const rangeLabel = dateFrom && dateTo ? `${new Date(dateFrom).toLocaleDateString('en-GB')} – ${new Date(dateTo).toLocaleDateString('en-GB')}` : 'All time';
    doc.text(`${rangeLabel} | Total: ${newProfilesInRange.length} profiles | Generated: ${new Date().toLocaleString('en-IN')}`, 14, 20);
    const head = [['#', 'Name', 'Handle', 'Platform', 'Category', 'Status', 'Escalations', 'Added']];
    const body = newProfilesInRange.map((s, i) => {
      const theme = PROFILE_PLATFORM_THEMES[s._normPlatform] || { label: s._normPlatform };
      return [i + 1, s.display_name || s.identifier || '', s.identifier || '', theme.label, prettify(s._normCategory), s.is_active !== false ? 'Active' : 'Inactive', escalationCounts[s.id] || 0, s.created_at ? new Date(s.created_at).toLocaleDateString('en-GB') : ''];
    });
    autoTable(doc, {
      head, body, startY: 30,
      styles: { fontSize: 6.5, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: 10 } },
      alternateRowStyles: { fillColor: [236, 253, 245] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 5) {
          data.cell.styles.textColor = data.cell.raw === 'Active' ? [22, 163, 74] : [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) { doc.setPage(p); doc.setFontSize(7); doc.setTextColor(148, 163, 184); doc.text(`Page ${p}/${pageCount}`, 148, 205, { align: 'center' }); }
    doc.save(`new_profiles_${new Date().toISOString().split('T')[0]}.pdf`);
  }, [newProfilesInRange, dateFrom, dateTo, escalationCounts]);

  const exportNewProfilesExcel = useCallback(() => {
    const rows = newProfilesInRange.map((s, i) => {
      const theme = PROFILE_PLATFORM_THEMES[s._normPlatform] || { label: s._normPlatform };
      return { '#': i + 1, 'Name': s.display_name || s.identifier || '', 'Handle': s.identifier || '', 'Platform': theme.label, 'Category': prettify(s._normCategory), 'Status': s.is_active !== false ? 'Active' : 'Inactive', 'Escalations': escalationCounts[s.id] || 0, 'Date Added': s.created_at ? new Date(s.created_at).toLocaleDateString('en-GB') : '' };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'New Profiles');
    const rangeLabel = dateFrom && dateTo ? `${new Date(dateFrom).toLocaleDateString('en-GB')} – ${new Date(dateTo).toLocaleDateString('en-GB')}` : 'All time';
    const meta = [{ Field: 'Report', Value: 'New Profiles Added' }, { Field: 'Period', Value: rangeLabel }, { Field: 'Total', Value: newProfilesInRange.length }, { Field: 'Generated', Value: new Date().toLocaleString('en-IN') }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), 'Info');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `new_profiles_${new Date().toISOString().split('T')[0]}.xlsx`);
  }, [newProfilesInRange, dateFrom, dateTo, escalationCounts]);





  useEffect(() => {
    if (profilesModalOpen && !sourcesLoaded && !sourcesLoading) {
      setSourcesLoading(true);
      Promise.all([
        api.get('/sources'),
        api.get('/sources/escalation-counts').catch(() => ({ data: {} }))
      ]).then(([srcRes, escRes]) => {
        const d = Array.isArray(srcRes.data) ? srcRes.data : (srcRes.data?.data || []);
        setMonitoredSources(d);
        setEscalationCounts(escRes.data || {});
        setSourcesLoaded(true);
      }).catch(() => {}).finally(() => setSourcesLoading(false));
    }
  }, [profilesModalOpen, sourcesLoaded, sourcesLoading]);

  // Also load sources when new profiles modal opens
  useEffect(() => {
    if (newProfilesModalOpen && !sourcesLoaded && !sourcesLoading) {
      setSourcesLoading(true);
      Promise.all([
        api.get('/sources'),
        api.get('/sources/escalation-counts').catch(() => ({ data: {} }))
      ]).then(([srcRes, escRes]) => {
        const d = Array.isArray(srcRes.data) ? srcRes.data : (srcRes.data?.data || []);
        setMonitoredSources(d);
        setEscalationCounts(escRes.data || {});
        setSourcesLoaded(true);
      }).catch(() => {}).finally(() => setSourcesLoading(false));
    }
  }, [newProfilesModalOpen, sourcesLoaded, sourcesLoading]);

  const buildAlertsReportParams = useCallback((overrides = {}) => {
    const params = {
      limit: ALERTS_REPORT_PAGE_SIZE,
      page: alertsPage,
      status: 'all',
      ...overrides
    };
    if (reportSearch.trim()) params.search = reportSearch.trim();
    if (reportPlatformFilter !== 'all') params.platform = reportPlatformFilter;
    if (reportRiskFilter === 'viral') params.alert_type = 'velocity';
    else if (reportRiskFilter !== 'all') params.risk_level = reportRiskFilter;
    if (reportTopicFilter !== 'all') params.topic_classification = reportTopicFilter;
    if (dateFrom) params.startDate = dateFrom;
    if (dateTo) params.endDate = dateTo;
    return params;
  }, [alertsPage, dateFrom, dateTo, reportPlatformFilter, reportRiskFilter, reportSearch, reportTopicFilter]);

  const fetchReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const res = await api.get('/alerts', { params: buildAlertsReportParams() });
      setAlertRows(Array.isArray(res.data?.alerts) ? res.data.alerts : []);
      const pagination = res.data?.pagination || {};
      setAlertsPagination({
        total: Number(pagination.total) || 0,
        totalPages: Number(pagination.totalPages) || 0,
        hasMore: Boolean(pagination.hasMore)
      });
    } catch {
      setAlertRows([]);
      setAlertsPagination({ total: 0, totalPages: 0, hasMore: false });
    }
    finally { setReportsLoading(false); }
  }, [buildAlertsReportParams]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    setAlertsPage(1);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    const fetchTopicCounts = async () => {
      try {
        const params = { status: 'all' };
        if (reportPlatformFilter !== 'all') params.platform = reportPlatformFilter;
        if (reportRiskFilter === 'viral') params.alert_type = 'velocity';
        else if (reportRiskFilter !== 'all') params.risk_level = reportRiskFilter;
        if (dateFrom) params.startDate = dateFrom;
        if (dateTo) params.endDate = dateTo;
        const response = await api.get('/alerts/topic-counts', { params });
        const rows = Array.isArray(response.data?.topics)
          ? response.data.topics
          : Array.isArray(response.data)
            ? response.data
            : [];
        const countMap = new Map(
          rows.map((row) => [normalizeTopicLabel(row.topic), Number(row.count || 0)])
        );
        const merged = ALERT_TOPIC_ORDER
          .map((topic) => ({ topic, count: countMap.get(topic) || 0 }))
          .filter((row) => row.count > 0);
        rows.forEach((row) => {
          const topic = normalizeTopicLabel(row.topic);
          if (!topic || merged.some((entry) => entry.topic === topic)) return;
          merged.push({ topic, count: Number(row.count || 0) });
        });
        setTopicCounts(merged);
      } catch {
        setTopicCounts([]);
      }
    };
    fetchTopicCounts();
  }, [reportPlatformFilter, reportRiskFilter, dateFrom, dateTo]);

  const safeData = data || {};

  const riskDist = (safeData.riskAnalysis?.distribution || []).map(r => ({
    name: prettify(r.level), value: r.count, color: RISK_COLORS[r.level] || '#94a3b8', _raw: r.level
  }));

  const platformDist = (safeData.platformDistribution || []).map(r => ({
    name: PLATFORM_LABELS[r.platform] || r.platform, value: r.count, color: PLATFORM_COLORS[r.platform] || PLATFORM_COLORS.unknown
  }));

  const alertTypesData = (safeData.alertTypes || []).map((r, i) => ({
    name: prettify(r.type), value: r.count, color: CHART_PALETTE[i % CHART_PALETTE.length]
  }));

  const keywordCatData = (safeData.keywords?.byCategory || []).map((r, i) => ({
    name: prettify(r.category), total: r.total, active: r.active, color: CHART_PALETTE[i % CHART_PALETTE.length]
  }));

  const topKeywords = (safeData.keywords?.topMatched || []).slice(0, 12);

  const reportStatusData = (safeData.reportsFormatShare?.statusDistribution || []).map((r, i) => ({
    name: prettify(r.status), value: r.count, color: STATUS_COLORS[r.status] || CHART_PALETTE[i % CHART_PALETTE.length]
  }));

  const alertTrend = safeData.alertsTrend || [];

  // Risk by platform cross-tab
  const riskPlatformMap = {};
  (safeData.riskAnalysis?.byPlatform || []).forEach(({ platform, riskLevel, count }) => {
    if (!riskPlatformMap[platform]) riskPlatformMap[platform] = { platform: PLATFORM_LABELS[platform] || platform };
    riskPlatformMap[platform][prettify(riskLevel)] = count;
  });
  const riskPlatformData = Object.values(riskPlatformMap);
  const alertsRangeLabel = formatRangeLabel(dateFrom, dateTo);
  const totalTopicCount = topicCounts.reduce((sum, topic) => sum + topic.count, 0);
  const normalizedAlertRows = useMemo(() => alertRows.map(normalizeAlertReportRow), [alertRows]);
  const displayAlertRows = useMemo(
    () => (alertsViewMode === 'profiles' ? dedupeAlertsByAuthor(alertsProfileRows) : normalizedAlertRows),
    [alertsViewMode, alertsProfileRows, normalizedAlertRows]
  );

  const fetchAllAlertsForExport = useCallback(async () => {
    const collected = [];
    let page = 1;
    let totalPages = 1;

    do {
      const res = await api.get('/alerts', {
        params: buildAlertsReportParams({ page, limit: REPORT_EXPORT_BATCH_SIZE })
      });
      const rows = Array.isArray(res.data?.alerts) ? res.data.alerts : [];
      collected.push(...rows.map(normalizeAlertReportRow));
      const pagination = res.data?.pagination || {};
      totalPages = Number(pagination.totalPages) || (pagination.hasMore ? page + 1 : page);
      page += 1;
      if (!pagination.hasMore && page > totalPages) break;
    } while (page <= totalPages);

    return collected;
  }, [buildAlertsReportParams]);

  useEffect(() => {
    if (alertsViewMode !== 'profiles') return;
    const fetchProfiles = async () => {
      setAlertsProfilesLoading(true);
      try {
        const rows = await fetchAllAlertsForExport();
        setAlertsProfileRows(rows);
      } catch {
        setAlertsProfileRows([]);
      } finally {
        setAlertsProfilesLoading(false);
      }
    };
    fetchProfiles();
  }, [alertsViewMode, fetchAllAlertsForExport]);

  const exportAlertsReportsPDF = useCallback(async () => {
    setAlertsExporting(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('startDate', dateFrom);
      if (dateTo)   params.set('endDate', dateTo);
      if (reportPlatformFilter && reportPlatformFilter !== 'all') params.set('platform', reportPlatformFilter);
      if (reportRiskFilter === 'viral') {
        params.set('alert_type', 'velocity');
      } else if (reportRiskFilter && reportRiskFilter !== 'all') {
        params.set('risk_level', reportRiskFilter);
      }
      if (reportTopicFilter && reportTopicFilter !== 'all') params.set('topic_classification', reportTopicFilter);
      if (reportSearch && reportSearch.trim()) params.set('search', reportSearch.trim());
      params.set('status', 'all');
      params.set('viewMode', alertsViewMode === 'profiles' ? 'profiles' : 'all');
      params.set('limit', String(Math.max(alertsPagination.total || 0, 1)));

      const response = await api.get(`/intelligence-reports/alerts/pdf?${params.toString()}`, {
        responseType: 'blob'
      });
      const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `alerts_report_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setAlertsExporting(false);
    }
  }, [dateFrom, dateTo, reportPlatformFilter, reportRiskFilter, reportTopicFilter, reportSearch, alertsViewMode, alertsPagination.total]);


  const exportAlertsReportsExcel = useCallback(async () => {
    setAlertsExporting(true);
    try {
    const exportRows = await fetchAllAlertsForExport();
    const profilesMode = alertsViewMode === 'profiles';
    const dedupedRows = profilesMode ? dedupeAlertsByAuthor(exportRows) : exportRows;
    const rows = dedupedRows.map((alert, idx) => profilesMode ? {
      'SNo.': idx + 1,
      'Author': alert._authorName || '',
      'Handle': alert._handle || '',
      'Platform': PLATFORM_LABELS[alert.platform] || prettify(alert.platform || 'unknown'),
      'Topic': alert._topic || '',
      'Risk': prettify(alert.risk_level || ''),
      'Posts': alert._postCount || 1,
      'Post Link': alert._postUrl || '',
      'Alert Date': alert._createdAtLabel || '',
      'Content': alert._contentText || ''
    } : {
      'SNo.': idx + 1,
      'Author': alert._authorName || '',
      'Handle': alert._handle || '',
      'Platform': PLATFORM_LABELS[alert.platform] || prettify(alert.platform || 'unknown'),
      'Topic': alert._topic || '',
      'Risk': prettify(alert.risk_level || ''),
      'Post Link': alert._postUrl || '',
      'Alert Date': alert._createdAtLabel || '',
      'Content': alert._contentText || ''
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Alerts Reports');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { Field: 'Report', Value: 'Alerts Reports' },
      { Field: 'Period', Value: alertsRangeLabel },
      { Field: 'Total', Value: dedupedRows.length },
      { Field: 'Generated', Value: new Date().toLocaleString('en-IN') }
    ]), 'Info');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `alerts_reports_${new Date().toISOString().split('T')[0]}.xlsx`);
    } finally {
      setAlertsExporting(false);
    }
  }, [alertsRangeLabel, fetchAllAlertsForExport, alertsViewMode]);

  if (!data) return <EmptyState message="Loading alerts intelligence..." />;

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-5">
      {/* Top: KPI sidebar (right) + first chart row */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Left: charts */}
        <div className="space-y-5 xl:col-span-9">

      {/* Alerts Table */}
      <motion.div variants={fadeUp}>
        <ChartCard title="Alerts Reports" subtitle="Browse and export alert content in the selected date range" icon={FileText} iconColor="#3b82f6">
          {/* Filters Row */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-[180px] max-w-[280px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search author, handle, content..."
                value={reportSearch}
                onChange={(e) => { setReportSearch(e.target.value); setAlertsPage(1); }}
                onKeyDown={(e) => e.key === 'Enter' && fetchReports()}
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            {/* Platform */}
            <select value={reportPlatformFilter} onChange={(e) => { setReportPlatformFilter(e.target.value); setAlertsPage(1); }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-300 focus:outline-none">
              <option value="all">All Platforms</option>
              <option value="x">X (Twitter)</option>
              <option value="youtube">YouTube</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            {/* Topic Classification */}
            <select value={reportTopicFilter} onChange={(e) => { setReportTopicFilter(e.target.value); setAlertsPage(1); }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-300 focus:outline-none">
              <option value="all">{`All Topics${totalTopicCount ? ` (${totalTopicCount})` : ''}`}</option>
              {topicCounts.map((topic) => (
                <option key={topic.topic} value={topic.topic}>
                  {`${topic.topic} (${topic.count})`}
                </option>
              ))}
            </select>
            {/* Clear */}
            {(reportSearch || reportPlatformFilter !== 'all' || reportTopicFilter !== 'all' || reportRiskFilter !== 'all') && (
              <button type="button" onClick={() => { setReportSearch(''); setReportPlatformFilter('all'); setReportTopicFilter('all'); setReportRiskFilter('all'); setAlertsPage(1); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 transition-colors">
                <RefreshCw className="h-3 w-3" /> Clear
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 transition-all hover:bg-slate-50 select-none">
                <input
                  type="checkbox"
                  checked={alertsIncludeContentDetails}
                  onChange={(e) => setAlertsIncludeContentDetails(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Content Details
              </label>
              <button type="button" onClick={exportAlertsReportsPDF} disabled={(alertsViewMode === 'profiles' ? displayAlertRows.length === 0 : alertsPagination.total === 0) || alertsExporting} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition-all hover:bg-blue-100 disabled:opacity-40">
                <Download className="h-3.5 w-3.5" /> {alertsExporting ? 'Exporting...' : 'PDF'}
              </button>
              <button type="button" onClick={exportAlertsReportsExcel} disabled={(alertsViewMode === 'profiles' ? displayAlertRows.length === 0 : alertsPagination.total === 0) || alertsExporting} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-all hover:bg-emerald-100 disabled:opacity-40">
                <Download className="h-3.5 w-3.5" /> {alertsExporting ? 'Exporting...' : 'Excel'}
              </button>
              <span className="text-[11px] font-medium text-slate-400">{alertsViewMode === 'profiles' ? `${displayAlertRows.length} profile${displayAlertRows.length !== 1 ? 's' : ''}` : `${alertsPagination.total} alert${alertsPagination.total !== 1 ? 's' : ''}`}</span>
            </div>
          </div>
          <div className="mb-4 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {[
              { value: 'all', label: 'All' },
              { value: 'high', label: 'Negative' },
              { value: 'medium', label: 'Neutral' },
              { value: 'low', label: 'Positive' },
              { value: 'viral', label: 'Viral' }
            ].map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => { setReportRiskFilter(filter.value); setAlertsPage(1); }}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-all whitespace-nowrap',
                  reportRiskFilter === filter.value
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="mb-4 flex items-center gap-2">
            <span className="text-[11px] font-medium text-slate-400">View:</span>
            {[
              { value: 'all', label: 'All Posts' },
              { value: 'profiles', label: 'Profiles Only' }
            ].map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => { setAlertsViewMode(mode.value); setAlertsPage(1); }}
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] font-medium transition-all whitespace-nowrap',
                  alertsViewMode === mode.value
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {reportsLoading || (alertsViewMode === 'profiles' && alertsProfilesLoading) ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : displayAlertRows.length === 0 ? (
            <EmptyState message="No alerts found for the selected filters" />
          ) : (
            <>
              <div className="max-h-[620px] overflow-auto rounded-xl border border-slate-100">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-white">
                    <tr className="border-b border-slate-100">
                      <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">SNo.</th>
                      <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Author</th>
                      <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Topic</th>
                      <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Platform</th>
                      <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Risk</th>
                      {alertsViewMode === 'profiles' && (
                        <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Posts</th>
                      )}
                      <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Post Link</th>
                      <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Alert Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayAlertRows.map((alert, index) => (
                      <tr key={alert._id || alert.id || index} className="border-b border-slate-50 transition-colors hover:bg-slate-50">
                        <td className="px-3 py-2.5">
                          <span className="text-xs font-semibold text-slate-700">{index + 1}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                              {(alert.source_meta?.profile_image_url || alert.content_details?.original_author_avatar) ? (
                                <img src={alert.source_meta?.profile_image_url || alert.content_details?.original_author_avatar} className="h-full w-full object-cover" alt="" />
                              ) : (
                                <User className="h-4 w-4 text-slate-400" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-800 truncate">{alert._authorName || 'Unknown'}</p>
                              <p className="text-[10px] text-slate-400 truncate">@{String(alert._handle || '').replace('@', '')}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#14b8a615', color: '#0f766e' }}>
                            {alert._topic || 'N/A'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `${PLATFORM_COLORS[alert.platform] || '#94a3b8'}15`, color: PLATFORM_COLORS[alert.platform] || '#94a3b8' }}>
                            {PLATFORM_LABELS[alert.platform] || prettify(alert.platform || 'unknown')}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ backgroundColor: `${RISK_COLORS[alert.risk_level] || '#94a3b8'}15`, color: RISK_COLORS[alert.risk_level] || '#94a3b8' }}>
                            {prettify(alert.risk_level || 'unknown')}
                          </span>
                        </td>
                        {alertsViewMode === 'profiles' && (
                          <td className="px-3 py-2.5">
                            <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700">
                              {alert._postCount || 1}
                            </span>
                          </td>
                        )}
                        <td className="px-3 py-2.5">
                          {alert._postUrl ? (
                            <a href={alert._postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium">
                              <ExternalLink className="h-3 w-3" /> View Post
                            </a>
                          ) : <span className="text-slate-400 text-xs italic">N/A</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1 text-xs text-slate-600">
                            <CalendarDays className="h-3 w-3 shrink-0" />
                            {alert._createdAtLabel || 'N/A'}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {alertsViewMode === 'profiles' ? (
                <div className="mt-3 flex items-center justify-between gap-3 px-1">
                  <span className="text-[11px] text-slate-500">
                    {displayAlertRows.length} unique profile{displayAlertRows.length !== 1 ? 's' : ''}
                  </span>
                </div>
              ) : alertsPagination.totalPages > 1 && (
                <div className="mt-3 flex items-center justify-between gap-3 px-1">
                  <span className="text-[11px] text-slate-500">
                    Showing {Math.min((alertsPage - 1) * ALERTS_REPORT_PAGE_SIZE + 1, alertsPagination.total)}–{Math.min(alertsPage * ALERTS_REPORT_PAGE_SIZE, alertsPagination.total)} of {alertsPagination.total} alerts
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={alertsPage === 1}
                      onClick={() => setAlertsPage(p => p - 1)}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >← Prev</button>
                    {buildPaginationItems(alertsPage, alertsPagination.totalPages)
                      .map((p, i) => p === '...' ? (
                        <span key={`dots-${i}`} className="px-1 text-[11px] text-slate-400">…</span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setAlertsPage(p)}
                          className={`min-w-[28px] rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                            alertsPage === p
                              ? 'border-blue-500 bg-blue-600 text-white shadow-sm'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >{p}</button>
                      ))}
                    <button
                      type="button"
                      disabled={alertsPage === alertsPagination.totalPages}
                      onClick={() => setAlertsPage(p => p + 1)}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >Next →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </ChartCard>
      </motion.div>


        </div>

        {/* Right: KPI tiles stacked vertically */}
        <motion.div variants={stagger} className="flex flex-col gap-4 xl:col-span-3">
          <KpiCard label="Total Profiles" value={data.accounts?.total} icon={Users} color="#3b82f6" subtitle={`${data.accounts?.active || 0} active`} onClick={() => setProfilesModalOpen(true)} />

          {/* Alert Summary */}
          <motion.div variants={fadeUp} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="flex items-center gap-2 text-xs font-bold text-slate-800 mb-3">
              <PieChartIcon className="h-3.5 w-3.5 text-violet-500" />
              Alert Summary
            </h4>

            {/* Risk Distribution Donut */}
            {riskDist.length > 0 && (
              <div className="relative h-[140px] mb-2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={riskDist} dataKey="value" nameKey="name" innerRadius={38} outerRadius={60} paddingAngle={3} cornerRadius={3} className="cursor-pointer" onClick={(entry) => { if (entry?._raw) navigate(`/alerts?risk=${encodeURIComponent(entry._raw)}`); }}>
                      {riskDist.map(e => <Cell key={e.name} fill={e.color} stroke="white" strokeWidth={2} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-lg font-black text-slate-900">{fmt(riskDist.reduce((s, r) => s + r.value, 0), true)}</p>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Alerts</p>
                </div>
              </div>
            )}

            {/* Risk legend */}
            <div className="space-y-1 mb-3">
              {riskDist.map(r => (
                <button key={r.name} type="button" onClick={() => navigate(`/alerts?risk=${encodeURIComponent(r._raw)}`)} className="flex w-full items-center justify-between px-1.5 py-1 rounded-md transition-colors hover:bg-slate-50 group cursor-pointer">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                    <span className="text-[11px] font-medium text-slate-600 group-hover:text-slate-900">{r.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-bold text-slate-800">{fmt(r.value)}</span>
                    <ExternalLink className="h-2.5 w-2.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          </motion.div>

          <KpiCard label="New Profiles Added" value={data.accounts?.addedInRange || 0} icon={TrendingUp} color="#10b981" subtitle={dateFrom && dateTo ? `${new Date(dateFrom).toLocaleDateString('en-GB', {day:'2-digit',month:'short'})} – ${new Date(dateTo).toLocaleDateString('en-GB', {day:'2-digit',month:'short'})}` : 'In selected range'} onClick={() => setNewProfilesModalOpen(true)} />
          <KpiCard label="Frequent Engagers" value="View" icon={Users} color="#8b5cf6" subtitle="Top Retweeters & Engagers" onClick={() => setFrequentEngagersOpen(true)} />
          <KpiCard label="Top Keywords" value={topKeywords.length} icon={KeyRound} color="#f59e0b" subtitle="Matched keywords" onClick={() => setTopKeywordsModalOpen(true)} />
        </motion.div>
      </div>

      {/* Profiles Being Monitored Modal */}
      <Dialog open={profilesModalOpen} onOpenChange={(open) => { setProfilesModalOpen(open); if (!open) { setModalSearch(''); setModalPlatformFilter('all'); setModalCategoryFilter('all'); setModalStatusFilter('all'); setModalView('overview'); } }}>
        <DialogContent className="w-[96vw] max-w-7xl max-h-[94vh] overflow-hidden p-0">
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50/30">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">Profiles Being Monitored</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-slate-500 mt-1">Complete overview of all monitored social media profiles across platforms and categories</p>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 'calc(94vh - 72px)' }}>
            {sourcesLoading && normalizedSources.length === 0 ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-slate-100" />)}
              </div>
            ) : normalizedSources.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-16">No monitored profiles found.</p>
            ) : (
              <div className="p-5 space-y-5">
                {/* Summary KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3.5 text-center">
                    <p className="text-2xl font-black text-blue-700">{profilesMatrix.grandTotal.total.toLocaleString()}</p>
                    <p className="text-[11px] font-semibold text-blue-600 mt-0.5">Total Profiles</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 text-center">
                    <p className="text-2xl font-black text-emerald-700">{profilesMatrix.grandTotal.active.toLocaleString()}</p>
                    <p className="text-[11px] font-semibold text-emerald-600 mt-0.5">Active</p>
                  </div>
                  <div className="rounded-xl border border-red-200 bg-red-50/60 p-3.5 text-center">
                    <p className="text-2xl font-black text-red-700">{profilesMatrix.grandTotal.inactive.toLocaleString()}</p>
                    <p className="text-[11px] font-semibold text-red-600 mt-0.5">Inactive</p>
                  </div>
                  {/* Platform breakdown mini cards */}
                  {profilesMatrix.rows.slice(0, 3).map(row => {
                    const theme = PROFILE_PLATFORM_THEMES[row.platform] || { label: row.platform, dotClass: 'bg-slate-400' };
                    return (
                      <div key={row.platform} className="rounded-xl border border-slate-200 bg-white p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5 mb-1">
                          <span className={`h-2 w-2 rounded-full ${theme.dotClass}`} />
                          <p className="text-[11px] font-semibold text-slate-500">{theme.label}</p>
                        </div>
                        <p className="text-xl font-black text-slate-800">{row.counts._total.total.toLocaleString()}</p>
                        <p className="text-[10px] text-slate-400">{row.counts._total.active} active &middot; {row.counts._total.inactive} inactive</p>
                      </div>
                    );
                  })}
                </div>

                {/* Toolbar: View Toggle + Export */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setModalView('overview')} className={cn('px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all', modalView === 'overview' ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                      Overview Matrix
                    </button>
                    <button type="button" onClick={() => setModalView('list')} className={cn('px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all', modalView === 'list' ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                      All Profiles ({normalizedSources.length.toLocaleString()})
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={modalView === 'overview' ? exportMatrixPDF : exportProfilesPDF} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-red-300 hover:bg-red-50 hover:text-red-700">
                      <Download className="h-3.5 w-3.5" /> PDF
                    </button>
                    <button type="button" onClick={modalView === 'overview' ? exportMatrixExcel : exportProfilesExcel} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700">
                      <Download className="h-3.5 w-3.5" /> Excel
                    </button>
                  </div>
                </div>

                {/* Overview Matrix View */}
                {modalView === 'overview' && (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse min-w-[700px]">
                        <thead>
                          <tr className="bg-slate-800 text-white">
                            <th className="text-left px-3 py-2.5 font-semibold sticky left-0 bg-slate-800 z-10 min-w-[130px] border-r border-slate-600">Platform</th>
                            {PROFILE_CATEGORIES.map(cat => (
                              <th key={cat.value} className="text-center px-2.5 py-2.5 font-semibold whitespace-nowrap border-r border-slate-600">{cat.label}</th>
                            ))}
                            <th className="text-center px-2.5 py-2.5 font-bold bg-blue-900/50 whitespace-nowrap">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {profilesMatrix.rows.map(row => {
                            const theme = PROFILE_PLATFORM_THEMES[row.platform] || { label: row.platform, rowClass: 'bg-amber-50 hover:bg-amber-100', stickyClass: 'bg-amber-50', dotClass: 'bg-slate-400' };
                            return (
                              <tr key={row.platform} className={`border-b border-slate-200 ${theme.rowClass}`}>
                                <td className={`px-3 py-2.5 sticky left-0 z-10 border-r border-slate-200 font-semibold ${theme.stickyClass}`}>
                                  <div className="flex items-center gap-2">
                                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${theme.dotClass}`} />
                                    {theme.label}
                                  </div>
                                </td>
                                {PROFILE_CATEGORIES.map(cat => {
                                  const cell = row.counts[cat.value] || { total: 0 };
                                  return (
                                    <td key={`${row.platform}-${cat.value}`} className="text-center px-2.5 py-2.5 tabular-nums border-r border-slate-100 font-bold text-slate-900">{cell.total || <span className="text-slate-300">&mdash;</span>}</td>
                                  );
                                })}
                                <td className="text-center px-2.5 py-2.5 tabular-nums font-black text-slate-900 bg-blue-50/50">{row.counts._total.total}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-400 bg-slate-800 text-white font-semibold">
                            <td className="px-3 py-2.5 sticky left-0 z-10 bg-slate-800 border-r border-slate-600 font-bold">All Platforms</td>
                            {PROFILE_CATEGORIES.map(cat => {
                              const cell = profilesMatrix.totalsByCategory[cat.value] || { total: 0 };
                              return (
                                <td key={`ft-${cat.value}`} className="text-center px-2.5 py-2.5 tabular-nums border-r border-slate-600/50 font-bold">{cell.total}</td>
                              );
                            })}
                            <td className="text-center px-2.5 py-2.5 tabular-nums font-black bg-blue-900/40">{profilesMatrix.grandTotal.total}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {/* Detailed List View */}
                {modalView === 'list' && (
                  <div className="space-y-3">
                    {/* Filters Row */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Search by name or handle..."
                          value={modalSearch}
                          onChange={(e) => setModalSearch(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                      <select value={modalPlatformFilter} onChange={(e) => setModalPlatformFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-300 focus:outline-none">
                        <option value="all">All Platforms</option>
                        {PROFILE_PLATFORM_ORDER.filter(p => normalizedSources.some(s => s._normPlatform === p)).map(p => (
                          <option key={p} value={p}>{(PROFILE_PLATFORM_THEMES[p]?.label || p)}</option>
                        ))}
                      </select>
                      <select value={modalCategoryFilter} onChange={(e) => setModalCategoryFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-300 focus:outline-none">
                        <option value="all">All Categories</option>
                        {PROFILE_CATEGORIES.map(cat => (
                          <option key={cat.value} value={cat.value}>{cat.label}</option>
                        ))}
                      </select>
                      <select value={modalStatusFilter} onChange={(e) => setModalStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-300 focus:outline-none">
                        <option value="all">All Status</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>

                      <span className="text-[11px] text-slate-400 font-medium ml-auto">
                        Showing {filteredSources.length.toLocaleString()} of {normalizedSources.length.toLocaleString()}
                      </span>
                    </div>

                    {/* Profiles Table */}
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="overflow-x-auto" style={{ maxHeight: '52vh' }}>
                        <table className="w-full text-xs border-collapse">
                          <thead className="bg-slate-100 sticky top-0 z-10">
                            <tr>
                              <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">#</th>
                              <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Profile</th>
                              <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Platform</th>
                              <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Category</th>
                              <th className="text-center px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Status</th>
                              <th className="text-center px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Escalations</th>
                              <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Added</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredSources.length === 0 ? (
                              <tr><td colSpan={7} className="text-center py-10 text-sm text-slate-400">No profiles match the current filters.</td></tr>
                            ) : filteredSources.map((source, idx) => {
                              const theme = PROFILE_PLATFORM_THEMES[source._normPlatform] || { label: source._normPlatform, dotClass: 'bg-slate-400', color: '#94a3b8' };
                              const isActive = source.is_active !== false;
                              return (
                                <tr key={source._id || source.id || idx} className="border-b border-slate-100 transition-colors hover:bg-slate-50 cursor-pointer" onClick={() => {
                                    const handle = source.identifier;
                                    const platform = source._normPlatform;
                                    if (platform === 'x') navigate(`/x-monitor?handle=${encodeURIComponent(handle)}`);
                                    else if (platform === 'instagram') navigate(source.id ? `/instagram-monitor/${source.id}` : '/instagram-monitor');
                                    else if (platform === 'youtube') navigate('/youtube-monitor');
                                    else if (platform === 'facebook') navigate('/facebook-monitor');
                                    else navigate(`/alerts?search=${encodeURIComponent(handle)}`);
                                    setProfilesModalOpen(false);
                                  }}>
                                  <td className="px-3 py-2.5 text-[11px] font-medium text-slate-400 tabular-nums">{idx + 1}</td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-2.5">
                                      <div className="h-8 w-8 rounded-full bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                                        {source.profile_image_url ? (
                                          <img src={source.profile_image_url} className="h-full w-full object-cover" alt="" />
                                        ) : (
                                          <User className="h-4 w-4 text-slate-400" />
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-xs font-semibold text-slate-800 truncate max-w-[180px] group-hover:text-blue-600">{source.display_name || source.identifier}</p>
                                        <p className="text-[10px] text-slate-400 truncate max-w-[180px]">@{source.identifier}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `${theme.color}12`, color: theme.color }}>
                                      <span className={`h-1.5 w-1.5 rounded-full ${theme.dotClass}`} />
                                      {theme.label}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize bg-violet-50 text-violet-700">
                                      {prettify(source._normCategory)}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 text-center">
                                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold', isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>
                                      <Circle className={cn('h-1.5 w-1.5 fill-current', isActive ? 'text-emerald-500' : 'text-red-400')} />
                                      {isActive ? 'Active' : 'Inactive'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 text-center">
                                    <span className={`inline-flex items-center justify-center min-w-[28px] rounded-full px-2 py-0.5 text-[10px] font-bold ${(escalationCounts[source.id] || 0) > 0 ? 'bg-purple-50 text-purple-700' : 'bg-slate-50 text-slate-400'}`}>
                                      {escalationCounts[source.id] || 0}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <span className="text-[11px] text-slate-500">
                                      {source.created_at ? new Date(source.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* New Profiles Added Modal */}
      <Dialog open={newProfilesModalOpen} onOpenChange={setNewProfilesModalOpen}>
        <DialogContent className="w-[96vw] max-w-5xl max-h-[90vh] overflow-hidden p-0">
          <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-emerald-50/50 to-slate-50">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">New Profiles Added</DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-slate-500">
                {dateFrom && dateTo
                  ? <>{new Date(dateFrom).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'})} – {new Date(dateTo).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'})} &middot; <span className="font-semibold text-emerald-700">{newProfilesInRange.length} profiles</span></>
                  : <><span className="font-semibold text-emerald-700">{newProfilesInRange.length} profiles</span> added (no date range selected — showing all)</>}
              </p>
              {newProfilesInRange.length > 0 && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={exportNewProfilesPDF} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-red-300 hover:bg-red-50 hover:text-red-700">
                    <Download className="h-3 w-3" /> PDF
                  </button>
                  <button type="button" onClick={exportNewProfilesExcel} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700">
                    <Download className="h-3 w-3" /> Excel
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 80px)' }}>
            {sourcesLoading && newProfilesInRange.length === 0 ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4].map(i => <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-slate-100" />)}
              </div>
            ) : newProfilesInRange.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-16">No profiles added in this period.</p>
            ) : (
              <div className="p-4">
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto" style={{ maxHeight: '62vh' }}>
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-slate-100 sticky top-0 z-10">
                        <tr>
                          <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">#</th>
                          <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Profile</th>
                          <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Platform</th>
                          <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Category</th>
                          <th className="text-center px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Status</th>
                          <th className="text-center px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Priority</th>
                          <th className="text-center px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Risk</th>
                          <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Added On</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newProfilesInRange.map((source, idx) => {
                          const theme = PROFILE_PLATFORM_THEMES[source._normPlatform] || { label: source._normPlatform, dotClass: 'bg-slate-400', color: '#94a3b8' };
                          const isActive = source.is_active !== false;
                          return (
                            <tr key={source._id || source.id || idx} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                              <td className="px-3 py-2.5 text-[11px] font-medium text-slate-400 tabular-nums">{idx + 1}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-2.5">
                                  <div className="h-8 w-8 rounded-full bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                                    {source.profile_image_url ? (
                                      <img src={source.profile_image_url} className="h-full w-full object-cover" alt="" />
                                    ) : (
                                      <User className="h-4 w-4 text-slate-400" />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-slate-800 truncate max-w-[180px]">{source.display_name || source.identifier}</p>
                                    <p className="text-[10px] text-slate-400 truncate max-w-[180px]">@{source.identifier}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2.5">
                                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `${theme.color}12`, color: theme.color }}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${theme.dotClass}`} />
                                  {theme.label}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize bg-violet-50 text-violet-700">
                                  {prettify(source._normCategory)}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold', isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>
                                  <Circle className={cn('h-1.5 w-1.5 fill-current', isActive ? 'text-emerald-500' : 'text-red-400')} />
                                  {isActive ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold capitalize" style={{ backgroundColor: `${PRIORITY_COLORS[source.priority] || '#94a3b8'}15`, color: PRIORITY_COLORS[source.priority] || '#94a3b8' }}>
                                  {source.priority || 'medium'}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold capitalize" style={{ backgroundColor: `${RISK_BADGE_COLORS[source.risk_level] || '#94a3b8'}15`, color: RISK_BADGE_COLORS[source.risk_level] || '#94a3b8' }}>
                                  {source.risk_level || 'low'}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <span className="text-[11px] text-slate-500">
                                  {source.created_at ? new Date(source.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>



      {/* Top Keywords Modal */}
      <Dialog open={topKeywordsModalOpen} onOpenChange={setTopKeywordsModalOpen}>
        <DialogContent className="w-[96vw] max-w-2xl max-h-[90vh] overflow-hidden p-0">
          <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-amber-50/50 to-slate-50">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">Top Matched Keywords</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-slate-500 mt-1">
              {dateFrom && dateTo
                ? <>{new Date(dateFrom).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'})} \u2013 {new Date(dateTo).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'})} &middot; <span className="font-semibold text-amber-700">{topKeywords.length} keywords</span></>
                : <>Most triggered keywords &middot; <span className="font-semibold text-amber-700">{topKeywords.length} keywords</span></>}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">Click any keyword to view all matching posts</p>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 100px)' }}>
            {topKeywords.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-16">No keyword data available.</p>
            ) : (
              <div className="p-4 space-y-2">
                {topKeywords.slice(0, 10).map((kw, idx) => {
                  const maxCount = topKeywords[0]?.count || 1;
                  const pct = Math.round((kw.count / maxCount) * 100);
                  const color = CHART_PALETTE[idx % CHART_PALETTE.length];
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => { setTopKeywordsModalOpen(false); navigate(`/alerts?search=${encodeURIComponent(kw.keyword)}`); }}
                      className="w-full text-left group rounded-xl border border-slate-200 bg-white px-4 py-3 transition-all hover:border-amber-300 hover:shadow-md hover:bg-amber-50/30 cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-black text-white" style={{ backgroundColor: color }}>{idx + 1}</span>
                          <span className="text-sm font-semibold text-slate-800 group-hover:text-amber-800 transition-colors">{kw.keyword}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-slate-900 tabular-nums">{kw.count}</span>
                          <span className="text-[10px] text-slate-400">matches</span>
                          <ExternalLink className="h-3.5 w-3.5 text-slate-300 group-hover:text-amber-500 transition-colors" />
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <FrequentEngagersDialog
        open={frequentEngagersOpen}
        onOpenChange={setFrequentEngagersOpen}
        onAddSource={() => {}}
        monitoredHandles={monitoredSources.map(s => s.identifier).filter(Boolean)}
      />
    </motion.div>
  );
};

/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
   GRIEVANCES INTELLIGENCE TAB
   \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */
const GrievancesIntelligence = ({ data, dateFrom, dateTo }) => {
  const refs = {
    trend: useRef(null),
    classification: useRef(null),
    priority: useRef(null),
    sentiment: useRef(null),
  };

  const [allReports, setAllReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportSearch, setReportSearch] = useState('');
  const [reportPlatformFilter, setReportPlatformFilter] = useState('all');
  const [reportSentimentFilter, setReportSentimentFilter] = useState('all');
  const [reportCategoryFilter, setReportCategoryFilter] = useState('all');
  const [reportTopicFilter, setReportTopicFilter] = useState('all');
  const [availableTopics, setAvailableTopics] = useState([]);
  const [availableCategories, setAvailableCategories] = useState([]);
  const [reportsModalOpen, setReportsModalOpen] = useState(false);
  const [reportsModalType, setReportsModalType] = useState('all');
  const [grievancesPage, setGrievancesPage] = useState(1);
  const [grievancePagination, setGrievancePagination] = useState({ total: 0, pages: 0, hasMore: false });
  const [grievancesExporting, setGrievancesExporting] = useState(false);
  const [grievancesIncludeContentDetails, setGrievancesIncludeContentDetails] = useState(true);
  const [grievancesViewMode, setGrievancesViewMode] = useState('all'); // 'all' | 'profiles'
  const [grievancesProfileRows, setGrievancesProfileRows] = useState([]);
  const [grievancesProfilesLoading, setGrievancesProfilesLoading] = useState(false);
  const navigate = useNavigate();

  const buildGrievanceReportParams = useCallback((overrides = {}) => ({
    page: grievancesPage,
    limit: GRIEVANCES_REPORT_PAGE_SIZE,
    tab: 'all',
    status_filter: 'all',
    ...(dateFrom ? { from: dateFrom } : {}),
    ...(dateTo ? { to: dateTo } : {}),
    ...(reportPlatformFilter !== 'all' ? { platform: reportPlatformFilter } : {}),
    ...(reportSentimentFilter !== 'all' ? { sentiment: reportSentimentFilter } : {}),
    ...(reportTopicFilter !== 'all' ? { grievance_type: reportTopicFilter } : {}),
    ...(reportCategoryFilter !== 'all' ? { analysis_category: reportCategoryFilter } : {}),
    ...(reportSearch.trim() ? { search: reportSearch.trim() } : {}),
    ...overrides,
  }), [dateFrom, dateTo, grievancesPage, reportCategoryFilter, reportPlatformFilter, reportSearch, reportSentimentFilter, reportTopicFilter]);

  useEffect(() => {
    const fetchReportPage = async () => {
      setReportsLoading(true);
      try {
        const response = await api.get('/grievances', { params: buildGrievanceReportParams() });
        setAllReports(Array.isArray(response.data?.grievances) ? response.data.grievances : []);
        const pagination = response.data?.pagination || {};
        setGrievancePagination({
          total: Number(pagination.total) || 0,
          pages: Number(pagination.pages) || 0,
          hasMore: Boolean(pagination.hasMore)
        });
      } catch {
        setAllReports([]);
        setGrievancePagination({ total: 0, pages: 0, hasMore: false });
      } finally {
        setReportsLoading(false);
      }
    };
    fetchReportPage();
  }, [buildGrievanceReportParams]);

  useEffect(() => {
    setGrievancesPage(1);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    Promise.all([
      api.get('/grievances/topics').catch(() => ({ data: { topics: [] } })),
      api.get('/grievances/categories').catch(() => ({ data: { categories: [] } }))
    ])
      .then(([topicsResponse, categoriesResponse]) => {
        setAvailableTopics(Array.isArray(topicsResponse.data?.topics) ? topicsResponse.data.topics : []);
        setAvailableCategories(Array.isArray(categoriesResponse.data?.categories) ? categoriesResponse.data.categories : []);
      })
      .catch(() => {
        setAvailableTopics([]);
        setAvailableCategories([]);
      });
  }, []);

  const baseFilteredReports = useMemo(() => allReports.map(normalizeGrievanceReportRow), [allReports]);

  const filteredReports = useMemo(() => {
    return baseFilteredReports;
  }, [baseFilteredReports]);
  const displayGrievanceRows = useMemo(
    () => (grievancesViewMode === 'profiles' ? dedupeGrievancesByAuthor(grievancesProfileRows) : filteredReports),
    [grievancesViewMode, grievancesProfileRows, filteredReports]
  );

  const fetchAllGrievancesForExport = useCallback(async () => {
    const collected = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await api.get('/grievances', {
        params: buildGrievanceReportParams({ page, limit: REPORT_EXPORT_BATCH_SIZE })
      });
      const rows = Array.isArray(response.data?.grievances) ? response.data.grievances : [];
      collected.push(...rows.map(normalizeGrievanceReportRow));
      const pagination = response.data?.pagination || {};
      totalPages = Number(pagination.pages) || (pagination.hasMore ? page + 1 : page);
      page += 1;
      if (!pagination.hasMore && page > totalPages) break;
    } while (page <= totalPages);

    return collected;
  }, [buildGrievanceReportParams]);

  useEffect(() => {
    if (grievancesViewMode !== 'profiles') return;
    const fetchProfiles = async () => {
      setGrievancesProfilesLoading(true);
      try {
        const rows = await fetchAllGrievancesForExport();
        setGrievancesProfileRows(rows);
      } catch {
        setGrievancesProfileRows([]);
      } finally {
        setGrievancesProfilesLoading(false);
      }
    };
    fetchProfiles();
  }, [grievancesViewMode, fetchAllGrievancesForExport]);

  const openReportsModal = (type = 'all') => {
    setReportsModalType(type);
    setReportsModalOpen(true);
  };

  const TYPE_BADGE = {
    grievance: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Grievance' },
    criticism: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', label: 'Criticism' },
    suggestion: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Suggestion' },
  };

  const REPORT_MODAL_THEME = {
    all: { title: 'Reports in Date Range', subtitle: 'All reports', tone: 'blue', header: 'from-blue-50/60 to-cyan-50/40', row: 'hover:bg-blue-50/20', button: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100', th: 'text-blue-700', thead: 'bg-blue-50/70' },
    grievance: { title: 'Grievance Reports', subtitle: 'Showing grievance workflow reports only', tone: 'amber', header: 'from-amber-50/60 to-orange-50/40', row: 'hover:bg-amber-50/20', button: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100', th: 'text-amber-700', thead: 'bg-amber-50/70' },
    suggestion: { title: 'Suggestion Reports', subtitle: 'Showing suggestion reports only', tone: 'emerald', header: 'from-emerald-50/60 to-green-50/40', row: 'hover:bg-emerald-50/20', button: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100', th: 'text-emerald-700', thead: 'bg-emerald-50/70' },
    criticism: { title: 'Criticism Reports', subtitle: 'Showing criticism reports only', tone: 'pink', header: 'from-pink-50/60 to-rose-50/40', row: 'hover:bg-pink-50/20', button: 'border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-100', th: 'text-pink-700', thead: 'bg-pink-50/70' },
  };
  const activeModalTheme = REPORT_MODAL_THEME[reportsModalType] || REPORT_MODAL_THEME.all;
  const modalReports = reportsModalType === 'all'
    ? filteredReports
    : baseFilteredReports.filter((report) => report._type === reportsModalType);
  const grievanceRangeLabel = formatRangeLabel(dateFrom, dateTo);
  const exportModalPDF = () => {
    exportReportsPDF(modalReports, `kpi_${reportsModalType}_reports`, reportsModalType, activeModalTheme.title);
  };
  const exportModalExcel = () => {
    exportReportsExcel(modalReports, `kpi_${reportsModalType}_reports`);
  };

  if (!data) return <EmptyState message="Loading grievances intelligence..." />;

  const platformData = (data.byPlatform || []).map(r => ({
    name: PLATFORM_LABELS[r.platform] || r.platform,
    value: r.count,
    color: PLATFORM_COLORS[r.platform] || PLATFORM_COLORS.unknown,
    _raw: r.platform
  }));

  const workflowData = (data.workflowStatus || []).map((r, i) => ({
    name: prettify(r.status),
    value: r.count,
    color: STATUS_COLORS[r.status] || CHART_PALETTE[i % CHART_PALETTE.length],
    _raw: r.status
  }));

  const trendData = data.dailyTrend || [];

  const sentimentData = (data.sentiment || []).map(r => ({
    name: prettify(r.sentiment),
    value: r.count,
    color: r.sentiment === 'positive' ? '#22c55e' : r.sentiment === 'negative' ? '#ef4444' : '#94a3b8'
  }));



  // ── Export helpers ──
  const exportReportsPDF = async (reports, fileName = 'intelligence_reports', selectedType = 'all', title = 'Intelligence Reports', includeContentDetails = true, profilesMode = false) => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const left = 14;
    const right = pageWidth - 14;
    doc.setFontSize(16);
    doc.text(title, left, 18);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleString()} | Period: ${grievanceRangeLabel}${selectedType !== 'all' ? ` | Type: ${TYPE_BADGE[selectedType]?.label}` : ''}`, left, 25);
    if (profilesMode) {
      autoTable(doc, {
        startY: 30,
        head: [['SNo.', 'Posted By', 'Handle', 'Platform', 'Sentiment', 'Category', 'Posts', 'Post Date', 'Post Link']],
        body: reports.map((r, i) => [
          i + 1,
          r.posted_by?.display_name || r.posted_by?.handle || '',
          r.posted_by?.handle || '',
          prettify(r.platform || ''),
          prettify(r.sentiment === 'moderate' ? 'neutral' : r.sentiment || ''),
          r.category || '',
          r._postCount || 1,
          r.post_date ? new Date(r.post_date).toLocaleDateString('en-GB') : '',
          truncateText(r.post_link || 'N/A', 60)
        ]),
        styles: { fontSize: 7, cellPadding: 2.5, overflow: 'linebreak', valign: 'top' },
        headStyles: { fillColor: [245, 158, 11], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [254, 252, 232] },
        columnStyles: {
          0: { cellWidth: 10 },
          1: { cellWidth: 26 },
          2: { cellWidth: 22 },
          3: { cellWidth: 22 },
          4: { cellWidth: 20 },
          5: { cellWidth: 26 },
          6: { cellWidth: 14 },
          7: { cellWidth: 18 },
          8: { cellWidth: 90 }
        }
      });
    } else {
      autoTable(doc, {
        startY: 30,
        head: [['SNo.', 'Type', 'Code', 'Posted By', 'Platform', 'Sentiment', 'Category', 'Post Date', 'Post Link']],
        body: reports.map((r, i) => [
          i + 1,
          TYPE_BADGE[r._type]?.label || r._type,
          r.unique_code || '',
          r.posted_by?.display_name || r.posted_by?.handle || '',
          prettify(r.platform || ''),
          prettify(r.sentiment === 'moderate' ? 'neutral' : r.sentiment || ''),
          r.category || '',
          r.post_date ? new Date(r.post_date).toLocaleDateString('en-GB') : '',
          truncateText(r.post_link || 'N/A', 60)
        ]),
        styles: { fontSize: 7, cellPadding: 2.5, overflow: 'linebreak', valign: 'top' },
        headStyles: { fillColor: [245, 158, 11], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [254, 252, 232] },
        columnStyles: {
          0: { cellWidth: 12 },
          1: { cellWidth: 18 },
          2: { cellWidth: 24 },
          3: { cellWidth: 28 },
          4: { cellWidth: 22 },
          5: { cellWidth: 22 },
          6: { cellWidth: 28 },
          7: { cellWidth: 20 },
          8: { cellWidth: 98 }
        }
      });
    }
    if (includeContentDetails) {
      let y = (doc.lastAutoTable?.finalY || 30) + 10;
      const ensureSpace = (needed = 24) => {
        if (y + needed > pageHeight - 14) {
          doc.addPage('a4', 'landscape');
          y = 16;
        }
      };
      ensureSpace(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(11);
      doc.text('Report Content Details', left, y);
      y += 6;

      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      for (let idx = 0; idx < reports.length; idx += 1) {
        const report = reports[idx];
        const originalContent = String(report.grievance_text || report.post_description || '').replace(/\s+/g, ' ').trim() || 'N/A';
        const translatedContent = String(report.translated_text || report.translated_description || '').replace(/\s+/g, ' ').trim();
        const displayContent = String(report.post_description || report.grievance_text || '').replace(/\s+/g, ' ').trim() || 'N/A';
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-20000px';
        container.style.top = '0';
        container.style.width = '1180px';
        container.style.padding = '20px 24px';
        container.style.background = idx % 2 === 0 ? '#fffaf0' : '#ffffff';
        container.style.border = '1px solid #fde68a';
        container.style.borderRadius = '12px';
        container.style.boxSizing = 'border-box';
        container.style.color = '#0f172a';
        container.style.fontFamily = '"Noto Sans Telugu", "Nirmala UI", "Gautami", "Segoe UI", Arial, sans-serif';
        container.innerHTML = `
          <div style="font-size:15px;font-weight:700;margin-bottom:8px;">
            ${idx + 1}. ${TYPE_BADGE[report._type]?.label || prettify(report._type || '')} - ${String(report.unique_code || '—').replace(/&/g, '&amp;')}
          </div>
          <div style="font-size:12px;color:#475569;margin-bottom:12px;line-height:1.5;">
            Posted By: ${String(report.posted_by?.display_name || report.posted_by?.handle || '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            ${report.posted_by?.handle ? ` (${String(report.posted_by.handle).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')})` : ''}
            | Platform: ${String(prettify(report.platform || 'unknown')).replace(/&/g, '&amp;')}
            | Sentiment: ${String(prettify(report.sentiment === 'moderate' ? 'neutral' : report.sentiment || '')).replace(/&/g, '&amp;')}
            | Category: ${String(report.category || '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            | Date: ${report.post_date ? new Date(report.post_date).toLocaleDateString('en-GB') : 'N/A'}
          </div>
          <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:#1e293b;">Report Content</div>
          <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:#111827;">${String(displayContent)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')}</div>
          ${translatedContent && translatedContent !== displayContent ? `
            <div style="font-size:12px;font-weight:700;margin:14px 0 6px;color:#1e293b;">Translated Content</div>
            <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:#111827;">${String(translatedContent)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')}</div>
          ` : ''}
          ${originalContent && originalContent !== displayContent ? `
            <div style="font-size:12px;font-weight:700;margin:14px 0 6px;color:#1e293b;">Source Content</div>
            <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:#111827;">${String(originalContent)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')}</div>
          ` : ''}
          <div style="font-size:12px;font-weight:700;margin:14px 0 6px;color:#1e293b;">Post Link</div>
          <div style="font-size:12px;line-height:1.5;word-break:break-all;color:#2563eb;">${String(report.post_link || 'N/A')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')}</div>
        `;
        document.body.appendChild(container);
        const canvas = await html2canvas(container, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          logging: false,
        });
        document.body.removeChild(container);

        const imgData = canvas.toDataURL('image/png');
        const contentWidth = right - left;
        const contentHeight = (canvas.height * contentWidth) / canvas.width;
        ensureSpace(contentHeight + 4);
        doc.addImage(imgData, 'PNG', left, y, contentWidth, contentHeight, undefined, 'FAST');
        y += contentHeight + 6;
      }
    }
    doc.save(`${fileName}.pdf`);
  };

  const exportReportsExcel = (reports, fileName = 'intelligence_reports', profilesMode = false) => {
    const rows = profilesMode
      ? reports.map((r, i) => ({
          '#': i + 1,
          'Posted By': r.posted_by?.display_name || r.posted_by?.handle || '',
          'Handle': r.posted_by?.handle || '',
          'Platform': prettify(r.platform || ''),
          'Sentiment': prettify(r.sentiment === 'moderate' ? 'neutral' : r.sentiment || ''),
          'Category': r.category || '',
          'Posts': r._postCount || 1,
          'Post Date': r.post_date ? new Date(r.post_date).toLocaleDateString('en-GB') : '',
          'Post Link': r.post_link || '',
        }))
      : reports.map((r, i) => ({
          '#': i + 1,
          'Type': TYPE_BADGE[r._type]?.label || r._type,
          'Unique Code': r.unique_code || '',
          'Posted By': r.posted_by?.display_name || r.posted_by?.handle || '',
          'Handle': r.posted_by?.handle || '',
          'Platform': prettify(r.platform || ''),
          'Sentiment': prettify(r.sentiment === 'moderate' ? 'neutral' : r.sentiment || ''),
          'Category': r.category || '',
          'Status': r.status || r.shared_via || '',
          'Post Date': r.post_date ? new Date(r.post_date).toLocaleDateString('en-GB') : '',
          'Post Link': r.post_link || '',
          'Post Description': r.post_description || '',
          'Source Content': r.grievance_text || '',
          'Informed To': r.informed_to?.name || '',
          'Department': r.informed_to?.department || '',
          'Remarks': r.remarks || '',
        }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Intelligence Reports');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { Field: 'Report', Value: 'Grievances Reports' },
      { Field: 'Period', Value: grievanceRangeLabel },
      { Field: 'Total', Value: reports.length },
      { Field: 'Generated', Value: new Date().toLocaleString('en-IN') }
    ]), 'Info');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${fileName}.xlsx`);
  };

  const exportGrievancesPDF = () => {
    const runExport = async () => {
      setGrievancesExporting(true);
      try {
        const params = new URLSearchParams();
        if (dateFrom) params.set('startDate', dateFrom);
        if (dateTo)   params.set('endDate', dateTo);
        if (reportPlatformFilter && reportPlatformFilter !== 'all') params.set('platform', reportPlatformFilter);
        if (reportSentimentFilter && reportSentimentFilter !== 'all') {
          params.set('sentiment', reportSentimentFilter);
        }
        if (reportTopicFilter && reportTopicFilter !== 'all') params.set('grievance_type', reportTopicFilter);
        if (reportCategoryFilter && reportCategoryFilter !== 'all') params.set('category', reportCategoryFilter);
        if (reportSearch) params.set('search', reportSearch);
        params.set('viewMode', grievancesViewMode === 'profiles' ? 'profiles' : 'all');
        params.set('limit', String(Math.max(grievancePagination.total || 0, 1)));

        const response = await api.get(`/intelligence-reports/grievances/pdf?${params.toString()}`, {
          responseType: 'blob'
        });
        const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `grievances_report_${new Date().toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } finally {
        setGrievancesExporting(false);
      }
    };
    return runExport();
  };

  const exportGrievancesExcel = () => {
    const runExport = async () => {
      setGrievancesExporting(true);
      try {
        const exportRows = await fetchAllGrievancesForExport();
        const profilesMode = grievancesViewMode === 'profiles';
        const dedupedRows = profilesMode ? dedupeGrievancesByAuthor(exportRows) : exportRows;
        exportReportsExcel(dedupedRows, 'grievances_reports', profilesMode);
      } finally {
        setGrievancesExporting(false);
      }
    };
    return runExport();
  };

  const STATUS_BADGE = {
    PENDING: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    ESCALATED: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
    CLOSED: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
  };

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-5">
      {/* MAIN GRID: LEFT (reports+charts) + RIGHT (KPIs) */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* LEFT SIDE: Reports Table + Charts */}
        <div className="space-y-5 xl:col-span-12">

      {/* Reports Table */}
      <motion.div variants={fadeUp}>
        <ChartCard title="Grievances Reports" subtitle="Browse and export grievance content in the selected date range" icon={FileText} iconColor="#f59e0b">
          {/* Filters + Export bar */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[190px] flex-1 max-w-[280px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search code, handle, content..."
                value={reportSearch}
                onChange={(e) => { setReportSearch(e.target.value); setGrievancesPage(1); }}
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-700 placeholder:text-slate-400 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
              />
            </div>
            <select value={reportPlatformFilter} onChange={(e) => { setReportPlatformFilter(e.target.value); setGrievancesPage(1); }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-amber-300 focus:outline-none">
              <option value="all">All Platforms</option>
              <option value="x">X (Twitter)</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="youtube">YouTube</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            <select value={reportSentimentFilter} onChange={(e) => { setReportSentimentFilter(e.target.value); setGrievancesPage(1); }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-amber-300 focus:outline-none">
              <option value="all">All Sentiment</option>
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
            </select>
            <select value={reportTopicFilter} onChange={(e) => { setReportTopicFilter(e.target.value); setGrievancesPage(1); }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-amber-300 focus:outline-none">
              <option value="all">All Topics</option>
              {availableTopics.map((topic) => (
                <option key={topic} value={topic}>{topic}</option>
              ))}
            </select>
            <select value={reportCategoryFilter} onChange={(e) => { setReportCategoryFilter(e.target.value); setGrievancesPage(1); }} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-amber-300 focus:outline-none">
              <option value="all">All Categories</option>
              {availableCategories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            {(reportSearch || reportPlatformFilter !== 'all' || reportSentimentFilter !== 'all' || reportTopicFilter !== 'all' || reportCategoryFilter !== 'all') && (
              <button type="button" onClick={() => { setReportSearch(''); setReportPlatformFilter('all'); setReportSentimentFilter('all'); setReportTopicFilter('all'); setReportCategoryFilter('all'); setGrievancesPage(1); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 transition-colors">
                <RefreshCw className="h-3 w-3" /> Clear
              </button>
            )}
            <div className="flex-1" />
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 transition-all hover:bg-slate-50 select-none">
              <input
                type="checkbox"
                checked={grievancesIncludeContentDetails}
                onChange={(e) => setGrievancesIncludeContentDetails(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
              Content Details
            </label>
            <button type="button" onClick={exportGrievancesPDF} disabled={(grievancesViewMode === 'profiles' ? displayGrievanceRows.length === 0 : grievancePagination.total === 0) || grievancesExporting} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-all hover:bg-amber-100 disabled:opacity-40">
              <Download className="h-3.5 w-3.5" /> {grievancesExporting ? 'Exporting...' : 'PDF'}
            </button>
            <button type="button" onClick={exportGrievancesExcel} disabled={(grievancesViewMode === 'profiles' ? displayGrievanceRows.length === 0 : grievancePagination.total === 0) || grievancesExporting} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-all hover:bg-emerald-100 disabled:opacity-40">
              <Download className="h-3.5 w-3.5" /> {grievancesExporting ? 'Exporting...' : 'Excel'}
            </button>
            <span className="text-[11px] font-medium text-slate-400">{grievancesViewMode === 'profiles' ? `${displayGrievanceRows.length} profile${displayGrievanceRows.length !== 1 ? 's' : ''}` : `${grievancePagination.total} report${grievancePagination.total !== 1 ? 's' : ''}`}</span>
          </div>
          <div className="mb-4 flex items-center gap-2">
            <span className="text-[11px] font-medium text-slate-400">View:</span>
            {[
              { value: 'all', label: 'All Posts' },
              { value: 'profiles', label: 'Profiles Only' }
            ].map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => { setGrievancesViewMode(mode.value); setGrievancesPage(1); }}
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] font-medium transition-all whitespace-nowrap',
                  grievancesViewMode === mode.value
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {reportsLoading || (grievancesViewMode === 'profiles' && grievancesProfilesLoading) ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : displayGrievanceRows.length === 0 ? (
            <EmptyState
              message={
                reportSearch || reportPlatformFilter !== 'all' || reportSentimentFilter !== 'all' || reportTopicFilter !== 'all' || reportCategoryFilter !== 'all' || dateFrom || dateTo
                  ? 'No grievances found for the selected filters'
                  : 'No grievances found'
              }
            />
          ) : (
            <>
              <div className="max-h-[620px] overflow-auto rounded-xl border border-slate-100">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-white">
                    <tr className="bg-gradient-to-r from-amber-50 to-orange-50/50">
                      <th className="px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-amber-700">SNo.</th>
                      <th className="px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-amber-700">Posted By</th>
                      <th className="px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-amber-700">Platform</th>
                      <th className="px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-amber-700">Topic</th>
                      <th className="px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-amber-700">Sentiment</th>
                      {grievancesViewMode === 'profiles' && (
                        <th className="px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-amber-700">Posts</th>
                      )}
                      <th className="px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-amber-700">Post Date</th>
                      <th className="px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-amber-700">Post Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayGrievanceRows.map((report, idx) => {
                      return (
                        <tr key={report.id || idx} className="border-b border-slate-50 transition-colors hover:bg-amber-50/30">
                          <td className="px-3 py-2.5">
                            <span className="text-xs font-semibold text-slate-700">{idx + 1}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-amber-100 overflow-hidden shrink-0 flex items-center justify-center">
                                {report.posted_by?.profile_image_url ? (
                                  <img src={report.posted_by.profile_image_url} className="h-full w-full object-cover" alt="" />
                                ) : (
                                  <User className="h-4 w-4 text-amber-400" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-800 truncate">{report.posted_by?.display_name || '—'}</p>
                                <p className="text-[10px] text-slate-400 truncate">@{(report.posted_by?.handle || '').replace('@', '')}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize" style={{ backgroundColor: `${PLATFORM_COLORS[report.platform] || '#94a3b8'}15`, color: PLATFORM_COLORS[report.platform] || '#94a3b8' }}>
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[report.platform] || '#94a3b8' }} />
                              {PLATFORM_LABELS[report.platform] || prettify(report.platform || 'unknown')}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#8b5cf615', color: '#8b5cf6' }}>
                              {report.topic || normalizeTopicLabel(report.analysis?.grievance_type || '') || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ backgroundColor: `${report.sentiment === 'negative' ? '#ef444415' : report.sentiment === 'positive' ? '#22c55e15' : '#f59e0b15'}`, color: report.sentiment === 'negative' ? '#ef4444' : report.sentiment === 'positive' ? '#22c55e' : '#f59e0b' }}>
                              {prettify(report.sentiment === 'moderate' ? 'neutral' : report.sentiment || '—')}
                            </span>
                          </td>
                          {grievancesViewMode === 'profiles' && (
                            <td className="px-3 py-2.5">
                              <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700">
                                {report._postCount || 1}
                              </span>
                            </td>
                          )}
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1 text-xs text-slate-600">
                              <CalendarDays className="h-3 w-3 shrink-0" />
                              {report.post_date ? new Date(report.post_date).toLocaleDateString('en-GB') : '—'}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            {report.post_link ? (
                              <a href={report.post_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium">
                                <ExternalLink className="h-3 w-3" /> View Post
                              </a>
                            ) : <span className="text-xs text-slate-400 italic">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {grievancesViewMode === 'profiles' ? (
                <div className="mt-3 flex items-center justify-between gap-3 px-1">
                  <span className="text-[11px] text-slate-500">
                    {displayGrievanceRows.length} unique profile{displayGrievanceRows.length !== 1 ? 's' : ''}
                  </span>
                </div>
              ) : grievancePagination.pages > 1 && (
                <div className="mt-3 flex items-center justify-between gap-3 px-1">
                  <span className="text-[11px] text-slate-500">
                    Showing {Math.min((grievancesPage - 1) * GRIEVANCES_REPORT_PAGE_SIZE + 1, grievancePagination.total)}–{Math.min(grievancesPage * GRIEVANCES_REPORT_PAGE_SIZE, grievancePagination.total)} of {grievancePagination.total} reports
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={grievancesPage === 1}
                      onClick={() => setGrievancesPage((page) => page - 1)}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >← Prev</button>
                    {buildPaginationItems(grievancesPage, grievancePagination.pages).map((page, index) => page === '...' ? (
                      <span key={`grievance-dots-${index}`} className="px-1 text-[11px] text-slate-400">…</span>
                    ) : (
                      <button
                        key={page}
                        type="button"
                        onClick={() => setGrievancesPage(page)}
                        className={`min-w-[28px] rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                          grievancesPage === page
                            ? 'border-amber-500 bg-amber-500 text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >{page}</button>
                    ))}
                    <button
                      type="button"
                      disabled={grievancesPage === grievancePagination.pages}
                      onClick={() => setGrievancesPage((page) => page + 1)}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >Next →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </ChartCard>
      </motion.div>

      {/* Daily Trend */}
      <motion.div variants={fadeUp}>
        <ChartCard ref={refs.trend} title="Daily Tags Trend" subtitle="Volume of grievances over time" icon={Activity} iconColor="#f59e0b">
          {trendData.length ? (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
                  <defs>
                    <linearGradient id="grievance-trend-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tickFormatter={v => String(v).slice(5)} minTickGap={18} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="count" name="Grievances" stroke="#f59e0b" strokeWidth={2} fill="url(#grievance-trend-grad)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState />}
        </ChartCard>
      </motion.div>

        </div>
      </div>

      <Dialog open={reportsModalOpen} onOpenChange={setReportsModalOpen}>
        <DialogContent className="w-[96vw] max-w-5xl max-h-[90vh] overflow-hidden p-0">
          <div className={cn('px-6 py-4 border-b border-slate-200 bg-gradient-to-r', activeModalTheme.header)}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <DialogHeader>
                  <DialogTitle className="text-lg font-bold text-slate-900">{activeModalTheme.title}</DialogTitle>
                </DialogHeader>
                <p className="text-xs text-slate-500 mt-1">
                  {activeModalTheme.subtitle}
                  {` | Date: ${grievanceRangeLabel}`}
                  {` | ${modalReports.length} records`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportModalPDF}
                  disabled={modalReports.length === 0}
                  className={cn('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-40', activeModalTheme.button)}
                >
                  <Download className="h-3.5 w-3.5" /> PDF
                </button>
                <button
                  type="button"
                  onClick={exportModalExcel}
                  disabled={modalReports.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" /> Excel
                </button>
              </div>
            </div>
          </div>
          <div className="overflow-y-auto p-4" style={{ maxHeight: 'calc(90vh - 96px)' }}>
            {reportsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map(i => <div key={i} className="h-11 w-full animate-pulse rounded-lg bg-slate-100" />)}
              </div>
            ) : modalReports.length === 0 ? (
              <EmptyState message="No reports found for this KPI" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={activeModalTheme.thead}>
                      <th className={cn('px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider', activeModalTheme.th)}>Type</th>
                      <th className={cn('px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider', activeModalTheme.th)}>Posted By</th>
                      <th className={cn('px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider', activeModalTheme.th)}>Platform</th>
                      <th className={cn('px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider', activeModalTheme.th)}>Sentiment</th>
                      <th className={cn('px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider', activeModalTheme.th)}>Category</th>
                      <th className={cn('px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider', activeModalTheme.th)}>Status</th>
                      <th className={cn('px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider', activeModalTheme.th)}>Post Date</th>
                      <th className={cn('px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider', activeModalTheme.th)}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalReports.map((report, idx) => {
                      const badge = STATUS_BADGE[report.status] || STATUS_BADGE.PENDING;
                      const typeBadge = TYPE_BADGE[report._type] || TYPE_BADGE.grievance;
                      const viewLink = report._type === 'grievance'
                        ? `/grievances?tab=reports&id=${report.id}`
                        : report._type === 'criticism'
                          ? `/grievances?tab=criticism&id=${report.id}`
                          : `/grievances?tab=suggestions&id=${report.id}`;
                      return (
                        <tr key={report.id || idx} className={cn('border-b border-slate-50 transition-colors', activeModalTheme.row)}>
                          <td className="px-3 py-2">
                            <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', typeBadge.bg, typeBadge.text, typeBadge.border)}>
                              {typeBadge.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">{report.posted_by?.display_name || report.posted_by?.handle || '—'}</td>
                          <td className="px-3 py-2 text-xs text-slate-700">{PLATFORM_LABELS[report.platform] || prettify(report.platform || 'unknown')}</td>
                          <td className="px-3 py-2 text-xs text-slate-700">{prettify(report.sentiment === 'moderate' ? 'neutral' : report.sentiment || '—')}</td>
                          <td className="px-3 py-2 text-xs text-slate-700">{report.category || '—'}</td>
                          <td className="px-3 py-2">
                            <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', badge.bg, badge.text, badge.border)}>
                              {report.status || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600">{report.post_date ? new Date(report.post_date).toLocaleDateString('en-GB') : '—'}</td>
                          <td className="px-3 py-2 text-right">
                            <Link
                              to={viewLink}
                              className={cn('inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors', activeModalTheme.button)}
                              onClick={() => setReportsModalOpen(false)}
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   PROFILES INTELLIGENCE TAB
   ═══════════════════════════════════════════════════════════════════ */
const ProfilesIntelligence = ({ data, dateFrom, dateTo }) => {
  const refs = {
    platform: useRef(null),
  };

  // Drill-down modal state
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillTitle, setDrillTitle] = useState('');
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillProfiles, setDrillProfiles] = useState([]);
  const [drillSearch, setDrillSearch] = useState('');

  const handlePieClick = async (sliceData, chartType) => {
    // chartType: 'platform' | 'coverage'
    setDrillTitle(sliceData.name);
    setDrillOpen(true);
    setDrillLoading(true);
    setDrillSearch('');
    setDrillProfiles([]);

    try {
      const params = { limit: 500, status: 'active' };
      if (chartType === 'platform') {
        params.platform = sliceData._rawPlatform || sliceData.name;
      } else if (chartType === 'coverage') {
        params.minLinkedPlatforms = sliceData._rawCount;
      }
      const res = await api.get('/poi', { params });
      setDrillProfiles(res.data?.pois || []);
    } catch {
      setDrillProfiles([]);
    } finally {
      setDrillLoading(false);
    }
  };

  const handleKpiClick = async (type) => {
    const labels = {
      total: 'Total Profiles',
      addedInRange: 'Added in Range',
      active: 'Active Profiles',
      deleted: 'Profiles with Deleted Accounts'
    };
    setDrillTitle(labels[type] || type);
    setDrillOpen(true);
    setDrillLoading(true);
    setDrillSearch('');
    setDrillProfiles([]);

    try {
      const params = { limit: 500 };
      if (type === 'active') {
        params.status = 'active';
      }
      const res = await api.get('/poi', { params });
      let profiles = res.data?.pois || [];

      if (type === 'addedInRange' && dateFrom && dateTo) {
        const from = new Date(dateFrom);
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        profiles = profiles.filter(p => {
          const created = new Date(p.createdAt);
          return created >= from && created <= to;
        });
      } else if (type === 'deleted') {
        profiles = profiles.filter(p => {
          const dp = p.previouslyDeletedProfiles;
          if (!dp) return false;
          return Object.values(dp).some(v => Array.isArray(v) ? v.length > 0 : !!v);
        });
      }

      setDrillProfiles(profiles);
    } catch {
      setDrillProfiles([]);
    } finally {
      setDrillLoading(false);
    }
  };

  const filteredDrillProfiles = useMemo(() => {
    if (!drillSearch.trim()) return drillProfiles;
    const q = drillSearch.toLowerCase();
    return drillProfiles.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.realName || '').toLowerCase().includes(q) ||
      (p.districtCommisionerate || '').toLowerCase().includes(q) ||
      (p.socialMedia || []).some(s => (s.handle || '').toLowerCase().includes(q) || (s.displayName || '').toLowerCase().includes(q))
    );
  }, [drillProfiles, drillSearch]);

  const handleKpiDownload = useCallback(async (type) => {
    const labels = {
      total: 'Total Profiles',
      addedInRange: 'Added in Range',
      active: 'Active Profiles',
      deleted: 'Profiles with Deleted Accounts'
    };
    try {
      const params = { limit: 500 };
      if (type === 'active') params.status = 'active';
      const res = await api.get('/poi', { params });
      let profiles = res.data?.pois || [];

      if (type === 'addedInRange' && dateFrom && dateTo) {
        const from = new Date(dateFrom);
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        profiles = profiles.filter(p => {
          const created = new Date(p.createdAt);
          return created >= from && created <= to;
        });
      } else if (type === 'deleted') {
        profiles = profiles.filter(p => {
          const dp = p.previouslyDeletedProfiles;
          if (!dp) return false;
          return Object.values(dp).some(v => Array.isArray(v) ? v.length > 0 : !!v);
        });
      }

      const rows = profiles.map((p, i) => ({
        '#': i + 1,
        'Name': p.name || 'Unknown',
        'Real Name': p.realName || '',
        'District': p.districtCommisionerate || '',
        'Status': (p.status || 'active').toUpperCase(),
        'Linked Platforms': (p.socialMedia || []).length,
        'Handles': (p.socialMedia || []).map(s => `${s.platform || ''}:@${(s.handle || '').replace('@', '')}`).join(', '),
        'Created': p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-GB') : '',
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Profiles');
      const rangeLabel = dateFrom && dateTo ? `${new Date(dateFrom).toLocaleDateString('en-GB')} – ${new Date(dateTo).toLocaleDateString('en-GB')}` : 'All time';
      const meta = [
        { Field: 'Report', Value: labels[type] || type },
        { Field: 'Period', Value: rangeLabel },
        { Field: 'Total', Value: profiles.length },
        { Field: 'Generated', Value: new Date().toLocaleString('en-IN') },
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), 'Info');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const safeName = (labels[type] || type).replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeName}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch {
      // silent fail
    }
  }, [dateFrom, dateTo]);

  if (!data) return <EmptyState message="Loading profiles intelligence..." />;

  const platformData = (data.platformDistribution || []).map(r => ({
    name: PLATFORM_LABELS[r.platform] || r.platform, value: r.count, color: PLATFORM_COLORS[r.platform] || PLATFORM_COLORS.unknown, _rawPlatform: r.platform
  }));

  const coverageData = (data.socialCoverage || []).map((r, i) => ({
    name: `${r.linkedPlatforms} Platform${r.linkedPlatforms !== 1 ? 's' : ''}`,
    value: r.count,
    color: CHART_PALETTE[i % CHART_PALETTE.length],
    _rawCount: r.linkedPlatforms
  }));

  const summary = data.summary || {};

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-9">
          <motion.div variants={fadeUp}>
            <ChartCard ref={refs.platform} title="Platform Coverage" subtitle="Social media platforms linked — click a slice to see profiles" icon={Globe} iconColor="#1877F2">
              {platformData.length ? (
                <>
                  <div className="relative h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={platformData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={92} paddingAngle={3} cornerRadius={4} className="cursor-pointer" onClick={(_, idx) => handlePieClick(platformData[idx], 'platform')}>
                          {platformData.map(e => <Cell key={e.name} fill={e.color} stroke="white" strokeWidth={2} />)}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <p className="text-2xl font-black text-slate-900">{fmt(platformData.reduce((s, r) => s + r.value, 0), true)}</p>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Links</p>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {platformData.map(r => (
                      <div key={r.name} className="flex items-center justify-between rounded-lg px-2 py-1 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => handlePieClick(r, 'platform')}>
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                          <span className="text-xs font-medium text-slate-600">{r.name}</span>
                        </div>
                        <span className="text-xs font-bold text-slate-800">{fmt(r.value)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : <EmptyState />}
            </ChartCard>
          </motion.div>
        </div>

        <motion.div variants={stagger} className="flex flex-col gap-4 xl:col-span-3">
          <KpiCard label="Total Profiles" value={summary.total} icon={Users} color="#8b5cf6" onClick={() => handleKpiClick('total')} onDownload={() => handleKpiDownload('total')} />
          <KpiCard label="Added in Range" value={summary.addedInRange} icon={TrendingUp} color="#3b82f6" subtitle={dateFrom && dateTo ? `${new Date(dateFrom).toLocaleDateString('en-GB', {day:'2-digit',month:'short'})} – ${new Date(dateTo).toLocaleDateString('en-GB', {day:'2-digit',month:'short'})}` : undefined} onClick={() => handleKpiClick('addedInRange')} onDownload={() => handleKpiDownload('addedInRange')} />
          <KpiCard label="Active" value={summary.active} icon={UserSearch} color="#10b981" onClick={() => handleKpiClick('active')} onDownload={() => handleKpiDownload('active')} />
          <KpiCard label="Deleted Profiles" value={summary.withDeletedProfiles} icon={AlertTriangle} color="#ec4899" subtitle="Tracked deletions" onClick={() => handleKpiClick('deleted')} onDownload={() => handleKpiDownload('deleted')} />
        </motion.div>
      </div>

      {/* Drill-Down Modal */}
      <Dialog open={drillOpen} onOpenChange={(open) => { setDrillOpen(open); if (!open) { setDrillSearch(''); setDrillProfiles([]); } }}>
        <DialogContent className="w-[96vw] max-w-5xl max-h-[90vh] overflow-hidden p-0">
          <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-violet-50 to-slate-50">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Users className="h-5 w-5 text-violet-600" />
                {drillTitle} — Profiles ({filteredDrillProfiles.length})
              </DialogTitle>
            </DialogHeader>
            <div className="relative mt-3 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                placeholder="Search name, handle, district..."
                value={drillSearch}
                onChange={(e) => setDrillSearch(e.target.value)}
                className="w-full pl-9 pr-3 h-8 text-xs rounded-lg border border-slate-200 bg-white focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none transition-colors"
              />
            </div>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 120px)' }}>
            {drillLoading ? (
              <div className="flex items-center justify-center py-20">
                <RefreshCw className="h-5 w-5 animate-spin text-violet-500" />
                <span className="ml-2 text-sm text-slate-500">Loading profiles...</span>
              </div>
            ) : filteredDrillProfiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <Users className="h-8 w-8 mb-2" />
                <p className="text-sm font-medium">No profiles found</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr className="border-b border-slate-200">
                    <th className="text-left px-4 py-2.5 font-semibold text-slate-600">#</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Name</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-slate-600">District</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Linked Handles</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Status</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDrillProfiles.map((poi, idx) => (
                    <tr key={poi._id || idx} className="border-b border-slate-100 hover:bg-violet-50/30 transition-colors cursor-pointer" onClick={() => window.open(`/person-of-interest/${poi._id}`, '_blank')}>
                      <td className="px-4 py-2.5 text-slate-400 font-mono">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900">{poi.name || 'Unknown'}</div>
                        {poi.realName && poi.realName !== poi.name && <div className="text-[10px] text-slate-400">aka {poi.realName}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{poi.districtCommisionerate || '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {(poi.socialMedia || []).slice(0, 4).map((s, si) => (
                            <span key={si} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-medium text-slate-600">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[s.platform] || '#94a3b8' }} />
                              @{(s.handle || '').replace('@', '')}
                            </span>
                          ))}
                          {(poi.socialMedia || []).length > 4 && (
                            <span className="text-[10px] text-slate-400">+{poi.socialMedia.length - 4} more</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] font-bold', poi.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                          {(poi.status || 'active').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{poi.createdAt ? new Date(poi.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
const IntelligenceDashboard = () => {
  const [activeTab, setActiveTab] = useState('alerts');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [alertsData, setAlertsData] = useState(null);
  const [grievancesData, setGrievancesData] = useState(null);
  const [profilesData, setProfilesData] = useState(null);

  const activeTabMeta = useMemo(() => TABS.find(t => t.key === activeTab) || TABS[0], [activeTab]);

  const fetchData = useCallback(async (tab, customFrom = dateFrom, customTo = dateTo) => {
    if (tab === 'events' || tab === 'xactions') { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (customFrom) params.from = customFrom;
      if (customTo) params.to = customTo;

      const targetTab = tab || activeTab;
      const response = await api.get(`/intelligence/${targetTab}`, { params });

      switch (targetTab) {
        case 'alerts': setAlertsData(response.data); break;
        case 'grievances': setGrievancesData(response.data); break;
        case 'profiles': setProfilesData(response.data); break;
      }
    } catch (err) {
      setError(`Failed to load ${tab || activeTab} intelligence. Please try again.`);
    } finally {
      setLoading(false);
    }
  }, [activeTab, dateFrom, dateTo]);

  useEffect(() => {
    fetchData(activeTab);
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApplyDateRange = () => {
    fetchData(activeTab, dateFrom, dateTo);
  };

  const handleClearDateRange = () => {
    setDateFrom('');
    setDateTo('');
    fetchData(activeTab, '', '');
  };

  const handleTabChange = (key) => {
    setActiveTab(key);
  };

  const currentData = activeTab === 'alerts' ? alertsData : activeTab === 'grievances' ? grievancesData : profilesData;
  const generatedAt = currentData?.generatedAt ? new Date(currentData.generatedAt).toLocaleString() : '--';
  const todayDate = new Date().toISOString().split('T')[0];
  const isTodaySelected = dateFrom === todayDate && dateTo === todayDate;

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-100 p-4 md:p-6">
      {/* Background decorations */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-blue-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-28 bottom-10 h-80 w-80 rounded-full bg-violet-200/40 blur-3xl" />

      <div className="relative mx-auto max-w-[1600px] space-y-5">

        {/* ══════════ HEADER ══════════ */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between"
        >
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
              Reports
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Date Range */}
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-slate-400"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-slate-400"
              />
              <Button size="sm" variant="outline" onClick={handleApplyDateRange} className="h-7 px-2 text-xs">Apply</Button>
              <Button size="sm" variant="ghost" onClick={handleClearDateRange} className="h-7 px-2 text-xs">Clear</Button>
              <Button
                size="sm"
                variant={isTodaySelected ? 'default' : 'outline'}
                className={cn(
                  'h-7 px-3 text-xs transition-colors',
                  isTodaySelected
                    ? 'bg-slate-900 text-white hover:bg-slate-800 hover:text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
                )}
                onClick={() => {
                  setDateFrom(todayDate);
                  setDateTo(todayDate);
                  fetchData(activeTab, todayDate, todayDate);
                }}
              >
                Today
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => fetchData(activeTab, dateFrom, dateTo)} disabled={loading} className="gap-2 rounded-xl border-slate-200">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-[11px] text-slate-500">{generatedAt}</span>
            </div>
          </div>
        </motion.div>

        {/* ══════════ TAB NAVIGATION ══════════ */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
        >
          <div className="flex gap-2">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleTabChange(tab.key)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all',
                    isActive
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.key === 'alerts' ? 'Alerts' : tab.key === 'grievances' ? 'Grievances' : tab.key === 'events' ? 'Events' : tab.key === 'xactions' ? 'X Actions' : 'Profiles'}</span>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* ══════════ ERROR BANNER ══════════ */}
        {error && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => fetchData(activeTab)}>Retry</Button>
            </div>
          </div>
        )}

        {/* ══════════ LOADING SKELETON ══════════ */}
        {loading && !currentData && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="animate-pulse space-y-5">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-32 rounded-2xl bg-slate-100" />
                ))}
              </div>
              <div className="grid grid-cols-12 gap-4">
                <div className="col-span-8 h-80 rounded-2xl bg-slate-100" />
                <div className="col-span-4 h-80 rounded-2xl bg-slate-100" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-64 rounded-2xl bg-slate-100" />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══════════ TAB CONTENT ══════════ */}
        {activeTab === 'alerts' && <AlertsIntelligence data={alertsData} dateFrom={dateFrom} dateTo={dateTo} />}
        {activeTab === 'grievances' && <GrievancesIntelligence data={grievancesData} dateFrom={dateFrom} dateTo={dateTo} />}
        {activeTab === 'profiles' && <ProfilesIntelligence data={profilesData} dateFrom={dateFrom} dateTo={dateTo} />}
        {activeTab === 'events' && (
          <Suspense fallback={
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-500 border-t-transparent" />
            </div>
          }>
            <EventsReportEmbed />
          </Suspense>
        )}

        {activeTab === 'xactions' && (
          <Suspense fallback={
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-sky-500 border-t-transparent" />
            </div>
          }>
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden" style={{ minHeight: 600 }}>
              <XBulkActionsEmbed />
            </div>
          </Suspense>
        )}

      </div>
    </div>
  );
};

export default IntelligenceDashboard;
   