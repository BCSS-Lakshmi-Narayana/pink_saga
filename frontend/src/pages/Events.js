import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { useLocation, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { ScrollArea } from '../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Separator } from '../components/ui/separator';
import { Switch } from '../components/ui/switch';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { toast } from 'sonner';
import {
  CalendarDays, Loader2, Play, Download, RefreshCw, ExternalLink,
  Youtube, Facebook, Radio,Instagram, Pause, Trash2, Plus, MapPin, Clock,
  Search, ScanLine, UserPlus, Pencil, Settings, FileSpreadsheet,
  FileText, BarChart3, Shield, Activity, Zap, Timer, ChevronRight,
  ChevronDown, X, AlertTriangle, Globe, ArrowUpRight
} from 'lucide-react';
import ContentCard from '../components/ContentCard';
import AddSourceModal from '../components/AddSourceModal';
import EventMonthSidebar, { MONTH_THEMES } from '../components/EventMonthSidebar';
import { QRCodeCanvas } from 'qrcode.react';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

/* ── helpers ─────────────────────────────────────────── */
const splitKeywords = (value) => {
  if (!value) return [];
  return value.split(/\n|,|;/g).map((s) => s.trim()).filter(Boolean);
};

const openPrintableReport = ({ event, stats, content, alerts }) => {
  const safe = (v) => (v === null || v === undefined ? '' : String(v));
  const partyLogoUrl = `${window.location.origin}/party-logo.png`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Event Report - ${safe(event?.name)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; padding: 32px; color: #1a1a2e; background: #fff; line-height: 1.5; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 3px solid #1a1a2e; }
    .logo { height: 72px; width: auto; object-fit: contain; }
    .titleBlock { flex: 1; text-align: center; }
    .titleBlock h1 { margin: 0 0 4px; font-size: 24px; font-weight: 700; color: #1a1a2e; }
    .titleBlock .sub { margin: 0; color: #666; font-size: 12px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
    .stat-box { border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; text-align: center; background: #f8fafc; }
    .stat-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .08em; font-weight: 600; }
    .stat-value { font-size: 28px; font-weight: 700; margin-top: 4px; color: #1a1a2e; }
    .stat-value.danger { color: #dc2626; }
    .section-title { font-size: 14px; font-weight: 700; margin: 24px 0 10px; text-transform: uppercase; letter-spacing: .05em; color: #374151; border-left: 4px solid #3b82f6; padding-left: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
    th { background: #1a1a2e; color: #fff; padding: 10px 12px; text-align: left; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
    td { border-bottom: 1px solid #e5e7eb; padding: 10px 12px; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    a { color: #2563eb; text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 2px solid #e5e7eb; text-align: center; font-size: 10px; color: #999; }
    @media print { body { padding: 16px; } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print" style="display:flex; gap:10px; margin-bottom:20px;">
    <button onclick="window.print()" style="padding:10px 20px; border:1px solid #ddd; border-radius:8px; background:#1a1a2e; color:#fff; cursor:pointer; font-weight:600;">Print / Save as PDF</button>
    <button onclick="window.close()" style="padding:10px 20px; border:1px solid #ddd; border-radius:8px; background:#fff; cursor:pointer;">Close</button>
  </div>
  <div class="header">
    <div style="font-size:22px; font-weight:800; letter-spacing:.2em; color:#1a1a2e; white-space:nowrap;">SANKET</div>
    <div class="titleBlock">
      <h1>Event Intelligence Report</h1>
      <p class="sub">${safe(event?.name)} &bull; Generated: ${new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}</p>
    </div>
    <img class="logo" src="${partyLogoUrl}" alt="Logo" />
  </div>
  <div class="stats-grid">
    <div class="stat-box"><div class="stat-label">Date Range</div><div style="font-size:13px;margin-top:6px;font-weight:600">${event?.start_date ? new Date(event.start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''} to ${event?.end_date ? new Date(event.end_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}</div></div>
    <div class="stat-box"><div class="stat-label">Location</div><div style="font-size:13px;margin-top:6px;font-weight:600">${safe(event?.location) || 'N/A'}</div></div>
    <div class="stat-box"><div class="stat-label">Total Content</div><div class="stat-value">${safe(stats?.content_total)}</div></div>
    <div class="stat-box"><div class="stat-label">Priority Alerts</div><div class="stat-value danger">${safe(stats?.alerts_priority)}</div></div>
  </div>
  ${alerts.filter(a => a.is_priority).length > 0 ? `
  <div class="section-title">Priority Alerts</div>
  <table>
    <thead><tr><th>Time</th><th>Platform</th><th>Title</th><th>Reason</th><th>Link</th></tr></thead>
    <tbody>${alerts.filter(a => a.is_priority).map(a => `
      <tr>
        <td>${safe(new Date(a.created_at).toLocaleString('en-IN'))}</td>
        <td><strong>${safe((a.platform || '').toUpperCase())}</strong></td>
        <td>${safe(a.title)}</td>
        <td style="color:#dc2626">${safe(a.priority_reason)}</td>
        <td><a href="${safe(a.content_url)}" target="_blank">Open</a></td>
      </tr>`).join('')}
    </tbody>
  </table>` : ''}
  <div class="section-title">Detected Content (${content.length})</div>
  <table>
    <thead><tr><th>Published</th><th>Platform</th><th>Author</th><th>Content</th><th>Link</th></tr></thead>
    <tbody>${content.map(c => `
      <tr>
        <td>${safe(new Date(c.published_at).toLocaleString('en-IN'))}</td>
        <td><strong>${safe((c.platform || '').toUpperCase())}</strong></td>
        <td>${safe(c.author)}</td>
        <td>${safe(c.text).slice(0, 200)}${(c.text || '').length > 200 ? '...' : ''}</td>
        <td><a href="${safe(c.content_url)}" target="_blank">Open</a></td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div class="footer">Confidential &mdash; Generated by Events Control Center &bull; ${new Date().toLocaleDateString('en-IN')}</div>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) { toast.error('Popup blocked. Allow popups to export PDF.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
};

/** Format monitoring range — return the raw date string as-is */
const formatMonitoringRange = (rangeStr) => {
  if (!rangeStr) return '—';
  return rangeStr.trim();
};

/** Build merged report rows from calendar events + enriched events (with discovered_hashtags) */
const buildReportRows = ({ calendarEvents, events }) => {
  const rows = [];
  (calendarEvents || []).forEach(cal => {
    const matchedEvent = (events || []).find(
      e => e.origin_calendar_id === cal.id || (e.origin === 'master_calendar' && e.name?.toLowerCase() === cal.occasion?.toLowerCase())
    );
    const newKeywords = matchedEvent?.discovered_hashtags || [];
    rows.push({
      slNo: cal.slNo,
      eventName: cal.occasion || '',
      eventDate: cal.date || '',
      monitoringRange: formatMonitoringRange(cal.monitoringRange),
      keywordsGiven: cal.keywords || '',
      newKeywordsFetched: newKeywords.length > 0 ? newKeywords.join(', ') : '—',
      eventId: matchedEvent?.id || null,
      reportUrl: matchedEvent?.report_pdf_url || (matchedEvent?.id ? `${window.location.origin}/events?selected=${matchedEvent.id}` : ''),
    });
  });
  (events || []).filter(e => e.origin !== 'master_calendar').forEach(evt => {
    const kwList = evt.keywords?.map(k => k.keyword).join(', ') || '';
    const startDate = evt.start_date ? new Date(evt.start_date) : null;
    const endDate = evt.end_date ? new Date(evt.end_date) : null;
    let monitoringRange = '—';
    if (startDate && endDate) {
      const fmt = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      monitoringRange = `${fmt(startDate)} – ${fmt(endDate)}`;
    } else if (startDate) {
      monitoringRange = startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }
    const newKeywords = evt.discovered_hashtags || [];
    rows.push({
      slNo: rows.length + 1,
      eventName: evt.name || '',
      eventDate: startDate ? startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—',
      monitoringRange,
      keywordsGiven: kwList,
      newKeywordsFetched: newKeywords.length > 0 ? newKeywords.join(', ') : '—',
      eventId: evt.id,
      reportUrl: evt.report_pdf_url || `${window.location.origin}/events?selected=${evt.id}`,
    });
  });
  return rows;
};

const openPrintableEventsList = ({ events, calendarEvents }) => {
  const rows = buildReportRows({ calendarEvents, events });
  const partyLogoUrl = `${window.location.origin}/party-logo.png`;
  const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Events Report</title>
  <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"><\/script>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; padding: 28px; color: #1a1a2e; background: #fff; }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 14px; border-bottom: 3px solid #1a1a2e; }
    .logo { height: 62px; width: auto; object-fit: contain; }
    .title { flex: 1; text-align: center; }
    .title h1 { margin: 0; font-size: 24px; font-weight: 700; color: #1a1a2e; }
    .sub { margin-top: 4px; color: #6b7280; font-size: 12px; }
    .meta { margin: 12px 0 14px; font-size: 12px; color: #475569; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #1f2937; color: #fff; text-align: left; padding: 10px 10px; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; font-weight: 600; }
    td { border-bottom: 1px solid #e5e7eb; padding: 10px 10px; vertical-align: middle; }
    tr:nth-child(even) td { background: #f8fafc; }
    a { color: #2563eb; text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; }
    .qr-cell { text-align: center; }
    .qr-cell canvas, .qr-cell img { width: 60px; height: 60px; }
    .footer { margin-top: 24px; padding-top: 12px; border-top: 2px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 10px; color: #999; }
    @media print { body { padding: 16px; } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print" style="display:flex; gap:10px; margin-bottom:16px;">
    <button onclick="window.print()" style="padding:10px 20px; border:1px solid #ddd; border-radius:8px; background:#1a1a2e; color:#fff; cursor:pointer; font-weight:600;">Print / Save as PDF</button>
    <button onclick="window.close()" style="padding:10px 20px; border:1px solid #ddd; border-radius:8px; background:#fff; cursor:pointer;">Close</button>
  </div>
  <div class="header">
    <div style="font-size:22px; font-weight:800; letter-spacing:.2em; color:#1a1a2e; white-space:nowrap;">SANKET</div>
    <div class="title">
      <h1>Events Report</h1>
      <div class="sub">Report Generated: ${generatedAt}</div>
    </div>
    <img class="logo" src="${partyLogoUrl}" alt="Logo" />
  </div>
  <div class="meta">Total Events: <strong>${rows.length}</strong></div>
  <table>
    <thead>
      <tr>
        <th>Sl.No</th>
        <th>Event Name</th>
        <th>Event Date</th>
        <th>Monitoring Range</th>
        <th>Keywords (Given by Team)</th>
        <th>New Keywords Fetched</th>
        <th style="text-align:center">Scan QR to Download Report</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((r, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${r.eventId ? '<a href="' + window.location.origin + '/events?selected=' + r.eventId + '">' + (r.eventName || '') + '</a>' : (r.eventName || '')}</td>
          <td>${r.eventDate || '—'}</td>
          <td>${r.monitoringRange || '—'}</td>
          <td>${r.keywordsGiven || '—'}</td>
          <td>${r.newKeywordsFetched || '—'}</td>
          <td class="qr-cell">${r.reportUrl ? '<div id="qr-' + idx + '"></div>' : '—'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div class="footer">
    <span>Confidential — Events Control Center</span>
    <span>${new Date().toLocaleDateString('en-IN')}</span>
  </div>
  <script>
    (function() {
      var rows = ${JSON.stringify(rows.map((r, i) => ({ idx: i, url: r.reportUrl })))};
      rows.forEach(function(r) {
        if (!r.url) return;
        var el = document.getElementById('qr-' + r.idx);
        if (!el) return;
        try {
          var qr = qrcode(0, 'M');
          qr.addData(r.url);
          qr.make();
          el.innerHTML = qr.createImgTag(2, 4);
        } catch(e) { el.textContent = 'QR Error'; }
      });
    })();
  <\/script>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) { toast.error('Popup blocked. Allow popups to export PDF.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
};

/* ── status config ── */
const STATUS_CONFIG = {
  active:   { color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800', dot: 'bg-emerald-500', label: 'Active' },
  paused:   { color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',      dot: 'bg-amber-500',   label: 'Paused' },
  archived: { color: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-800 dark:text-gray-400 dark:border-slate-700',        dot: 'bg-gray-400',    label: 'Archived' },
  planned:  { color: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800',            dot: 'bg-sky-500',     label: 'Planned' }
};

const PLATFORM_CONFIG = {
  all:       { label: 'All Platforms', icon: Globe,     color: 'text-gray-500 dark:text-gray-400' },
  x:         { label: 'X / Twitter',  icon: Globe,     color: 'text-gray-800 dark:text-gray-200' },
  youtube:   { label: 'YouTube',       icon: Youtube,   color: 'text-red-600 dark:text-red-400' },
  facebook:  { label: 'Facebook',      icon: Facebook,  color: 'text-blue-600 dark:text-blue-400' }
};

const EVENT_POLL_INTERVALS = [
  { value: 'default', label: 'Use global default' },
  { value: '3',   label: 'Every 3 minutes' },
  { value: '5',   label: 'Every 5 minutes' },
  { value: '10',  label: 'Every 10 minutes' },
  { value: '15',  label: 'Every 15 minutes' },
  { value: '30',  label: 'Every 30 minutes' },
  { value: '60',  label: 'Every 1 hour' },
  { value: '120', label: 'Every 2 hours' },
  { value: '300', label: 'Every 5 hours' }
];

/* ══════════════════════════════════════════════════════
   Events Control Center
   ══════════════════════════════════════════════════════ */
const Events = () => {
  const routeLocation = useLocation();

  // ── Core state ──
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [creating, setCreating] = useState(false);
  const [runningScan, setRunningScan] = useState(false);
  const [contentPlatform, setContentPlatform] = useState('all');
  const [processingAction, setProcessingAction] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [originFilter, setOriginFilter] = useState('all'); // 'all' | 'recurring' | 'manual'
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all'); // 'all' | 'active' | 'paused'
  const [selectedMonth, setSelectedMonth] = useState(null); // null = all months
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // ── Sidebar resize handlers ──
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMouseMove = (e) => {
      const newWidth = Math.min(500, Math.max(200, startWidth + (e.clientX - startX)));
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  // ── Dialog state ──
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // ── HCP Master Calendar state ──
  const [hcpOpen, setHcpOpen] = useState(false);
  const [hcpTab, setHcpTab] = useState('recurring');
  const [hcpEvents, setHcpEvents] = useState([]);
  const [hcpLoading, setHcpLoading] = useState(false);
  const [hcpSearch, setHcpSearch] = useState('');
  const [hcpFormOpen, setHcpFormOpen] = useState(false);
  const [hcpEditId, setHcpEditId] = useState(null);
  const [hcpSaving, setHcpSaving] = useState(false);
  const [hcpForm, setHcpForm] = useState({ occasion: '', date: '', monitoringRange: '', keywords: '', remarks: '' });

  // ── Non-Recurring Event Form (uses real Event model) ──
  const [nrFormOpen, setNrFormOpen] = useState(false);
  const [nrEditId, setNrEditId] = useState(null);
  const [nrSaving, setNrSaving] = useState(false);
  const [nrForm, setNrForm] = useState({ name: '', location: '', start_date: '', end_date: '', keywords_te: '', keywords_hi: '', keywords_en: '', polling_interval_minutes: 'default' });
  const [nrEvents, setNrEvents] = useState([]);
  const [nrLoading, setNrLoading] = useState(false);

  // ── Add Source Modal ──
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [addSourceInitial, setAddSourceInitial] = useState(null);

  // ── Form fields ──
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [keywordsTe, setKeywordsTe] = useState('');
  const [keywordsHi, setKeywordsHi] = useState('');
  const [keywordsEn, setKeywordsEn] = useState('');
  const [eventPollInterval, setEventPollInterval] = useState('default');

  // ── API Settings state ──
  const [eventIntervals, setEventIntervals] = useState({ x: 60, instagram: 60, facebook: 60, youtube: 60, enabled: true });
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // ── Helpers ──
  const closeActionOverlays = () => {
    setEventFormOpen(false);
    setEditingEvent(null);
    setConfirmDeleteOpen(false);
    setAddSourceOpen(false);
    setAddSourceInitial(null);
    setExportMenuOpen(false);
    setHcpOpen(false);
  };

  const openCreateDialog = () => { closeActionOverlays(); resetForm(); setEventFormOpen(true); };
  const openDeleteDialog = () => { closeActionOverlays(); setConfirmDeleteOpen(true); };
  const handleSelectEvent = (id) => { closeActionOverlays(); setSelectedId(id); };
  const openHcpCalendar = () => { closeActionOverlays(); setHcpOpen(true); setHcpTab('recurring'); fetchHcpEvents('recurring'); };
  const openHcpNonRecurring = () => { closeActionOverlays(); setHcpOpen(true); setHcpTab('nonRecurring'); fetchHcpEvents('nonRecurring'); };

  // ── Non-Recurring Events (real Event model) ──
  const fetchNrEvents = useCallback(async () => {
    setNrLoading(true);
    try {
      const res = await api.get('/events', { params: { status: 'all' } });
      setNrEvents(res.data || []);
    } catch { toast.error('Failed to load events'); }
    finally { setNrLoading(false); }
  }, []);

  const nrFiltered = useMemo(() => {
    if (!hcpSearch.trim()) return nrEvents;
    const q = hcpSearch.toLowerCase();
    return nrEvents.filter(e => e.name?.toLowerCase().includes(q) || e.location?.toLowerCase().includes(q) || e.keywords?.some(k => k.keyword?.toLowerCase().includes(q)));
  }, [nrEvents, hcpSearch]);

  const openNrCreate = () => { setNrEditId(null); setNrForm({ name: '', location: '', start_date: '', end_date: '', keywords_te: '', keywords_hi: '', keywords_en: '', polling_interval_minutes: 'default' }); setNrFormOpen(true); };
  const openNrEdit = (evt) => {
    setNrEditId(evt.id);
    const kwByLang = (lang) => (evt.keywords || []).filter(k => k.language === lang).map(k => k.keyword).join(', ');
    setNrForm({
      name: evt.name || '',
      location: evt.location || '',
      start_date: evt.start_date ? new Date(evt.start_date).toISOString().split('T')[0] : '',
      end_date: evt.end_date ? new Date(evt.end_date).toISOString().split('T')[0] : '',
      keywords_te: kwByLang('te'),
      keywords_hi: kwByLang('hi'),
      keywords_en: kwByLang('en'),
      polling_interval_minutes: evt.polling_interval_minutes ? String(evt.polling_interval_minutes) : 'default'
    });
    setNrFormOpen(true);
  };

  const handleNrSave = async (e) => {
    e.preventDefault();
    if (!nrForm.name) { toast.error('Event name is required'); return; }
    if (nrForm.start_date && nrForm.end_date && new Date(nrForm.end_date) < new Date(nrForm.start_date)) { toast.error('End date must be after start date'); return; }
    setNrSaving(true);
    try {
      const kw = [];
      nrForm.keywords_te.split(/[,\n]/).filter(Boolean).forEach(k => kw.push({ keyword: k.trim(), language: 'te' }));
      nrForm.keywords_hi.split(/[,\n]/).filter(Boolean).forEach(k => kw.push({ keyword: k.trim(), language: 'hi' }));
      nrForm.keywords_en.split(/[,\n]/).filter(Boolean).forEach(k => kw.push({ keyword: k.trim(), language: 'en' }));
      const payload = {
        name: nrForm.name, location: nrForm.location,
        keywords: kw, platforms: ['youtube', 'x', 'facebook'],
        ...(nrForm.start_date ? { start_date: nrForm.start_date } : {}),
        ...(nrForm.end_date ? { end_date: nrForm.end_date } : {}),
        ...(nrForm.polling_interval_minutes && nrForm.polling_interval_minutes !== 'default' ? { polling_interval_minutes: Number(nrForm.polling_interval_minutes) } : {})
      };
      if (nrEditId) {
        await api.put(`/events/${nrEditId}`, payload);
        toast.success('Event updated');
      } else {
        await api.post('/events', payload);
        toast.success('Event created');
      }
      setNrFormOpen(false);
      setNrEditId(null);
      await fetchNrEvents();
      await fetchEvents(); // refresh main list too
    } catch (err) { toast.error(err?.response?.data?.message || 'Save failed'); }
    finally { setNrSaving(false); }
  };

  const handleNrDelete = async (id) => {
    if (!window.confirm('Delete this event permanently?')) return;
    try {
      await api.delete(`/events/${id}`);
      toast.success('Event deleted');
      await fetchNrEvents();
      await fetchEvents();
    } catch { toast.error('Delete failed'); }
  };

  // ── Data Fetching ──
  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await api.get('/events', { params: { status: 'all' } });
      setEvents(res.data || []);
      if (!selectedId && res.data?.length > 0) setSelectedId(res.data[0].id);
    } catch {
      toast.error('Failed to load events');
    } finally {
      setLoadingEvents(false);
    }
  }, [selectedId]);

  const fetchDashboard = useCallback(async (id) => {
    if (!id) return;
    setLoadingDashboard(true);
    try {
      const res = await api.get(`/events/${id}/dashboard`);
      setDashboard(res.data);
    } catch {
      toast.error('Failed to load dashboard');
    } finally {
      setLoadingDashboard(false);
    }
  }, []);

  // ── HCP Calendar fetching & CRUD ──
  const fetchHcpEvents = useCallback(async (tabOverride) => {
    const t = tabOverride || hcpTab;
    setHcpLoading(true);
    try {
      const res = await api.get('/master-calendar', { params: { recurring: t === 'recurring' ? 'true' : 'false' } });
      setHcpEvents(res.data || []);
    } catch { toast.error('Failed to load calendar events'); }
    finally { setHcpLoading(false); }
  }, [hcpTab]);

  const hcpFiltered = useMemo(() => {
    if (!hcpSearch.trim()) return hcpEvents;
    const q = hcpSearch.toLowerCase();
    return hcpEvents.filter(e => e.occasion?.toLowerCase().includes(q) || e.keywords?.toLowerCase().includes(q) || e.date?.toLowerCase().includes(q));
  }, [hcpEvents, hcpSearch]);

  const handleHcpTabChange = (t) => {
    setHcpTab(t); setHcpSearch('');
    fetchHcpEvents(t);
  };
  const openHcpCreate = () => { setHcpEditId(null); setHcpForm({ occasion: '', date: '', monitoringRange: '', keywords: '', remarks: '' }); setHcpFormOpen(true); };
  const openHcpEdit = (evt) => { setHcpEditId(evt.id); setHcpForm({ occasion: evt.occasion || '', date: evt.date || '', monitoringRange: evt.monitoringRange || '', keywords: evt.keywords || '', remarks: evt.remarks || '' }); setHcpFormOpen(true); };

  const handleHcpSave = async (e) => {
    e.preventDefault();
    if (!hcpForm.occasion || !hcpForm.date) { toast.error('Occasion and Date are required'); return; }
    setHcpSaving(true);
    try {
      if (hcpEditId) {
        await api.put(`/master-calendar/${hcpEditId}`, hcpForm);
        toast.success('Event updated');
      } else {
        await api.post('/master-calendar', { ...hcpForm, isRecurring: hcpTab === 'recurring' });
        toast.success('Event created');
      }
      setHcpFormOpen(false);
      setHcpForm({ occasion: '', date: '', monitoringRange: '', keywords: '', remarks: '' });
      setHcpEditId(null);
      await fetchHcpEvents();
    } catch (err) { toast.error(err?.response?.data?.message || 'Save failed'); }
    finally { setHcpSaving(false); }
  };

  const handleHcpDelete = async (id) => {
    if (!window.confirm('Delete this event?')) return;
    try {
      await api.delete(`/master-calendar/${id}`);
      toast.success('Event deleted');
      await fetchHcpEvents();
    } catch { toast.error('Delete failed'); }
  };

  const fetchSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      const res = await api.get('/events/monitoring-interval');
      setEventIntervals({
        x: res.data?.x ?? 60,
        instagram: res.data?.instagram ?? 60,
        facebook: res.data?.facebook ?? 60,
        youtube: res.data?.youtube ?? 60,
        enabled: res.data?.enabled !== false
      });
    } catch {
      // silently fail
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, []);
  useEffect(() => { if (selectedId) fetchDashboard(selectedId); }, [selectedId, fetchDashboard]);

  // ── Prefill from Announcements ──
  useEffect(() => {
    const prefill = routeLocation.state?.prefill;
    if (prefill) {
      setName(prefill.name || '');
      setLocation(prefill.location || '');
      setStartDate(prefill.start_date || '');
      setEndDate(prefill.end_date || '');
      setKeywordsEn(prefill.keywords_en || '');
      setKeywordsTe(prefill.keywords_te || '');
      setKeywordsHi(prefill.keywords_hi || '');
      setEditingEvent(null);
      closeActionOverlays();
      setEventFormOpen(true);
      window.history.replaceState({}, document.title);
    }
  }, [routeLocation.state]);

  // ── Derived ──
  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedId) || null, [events, selectedId]);

  // Compute events for the selected year (for month counts)
  const eventsForYear = useMemo(() => {
    return events.filter((e) => {
      // Events without dates are shown in all years
      if (!e.start_date && !e.end_date) return true;
      const start = e.start_date ? new Date(e.start_date) : null;
      const end = e.end_date ? new Date(e.end_date) : null;
      if (start && end) return start.getFullYear() === selectedYear || end.getFullYear() === selectedYear;
      if (start) return start.getFullYear() === selectedYear;
      if (end) return end.getFullYear() === selectedYear;
      return true;
    });
  }, [events, selectedYear]);

  // Count events per month for the selected year
  const monthCounts = useMemo(() => {
    const counts = {};
    eventsForYear.forEach((e) => {
      if (!e.start_date && !e.end_date) {
        // Open-ended events count in every month
        for (let m = 0; m < 12; m++) counts[m] = (counts[m] || 0) + 1;
        return;
      }
      const start = e.start_date ? new Date(e.start_date) : new Date(selectedYear, 0, 1);
      const end = e.end_date ? new Date(e.end_date) : new Date(selectedYear, 11, 31);
      const sYear = start.getFullYear();
      const sMonth = start.getMonth();
      const eYear = end.getFullYear();
      const eMonth = end.getMonth();
      let y = sYear, m = sMonth;
      while (y < eYear || (y === eYear && m <= eMonth)) {
        if (y === selectedYear) {
          counts[m] = (counts[m] || 0) + 1;
        }
        m++;
        if (m > 11) { m = 0; y++; }
      }
    });
    return counts;
  }, [eventsForYear, selectedYear]);

  // Filter events by selected month/year + search query + origin filter
  const filteredEvents = useMemo(() => {
    let result = events;

    // Filter by month/year
    if (selectedMonth !== null) {
      result = result.filter((e) => {
        // Events without dates shown in all months
        if (!e.start_date && !e.end_date) return true;
        const start = e.start_date ? new Date(e.start_date) : new Date(selectedYear, 0, 1);
        const end = e.end_date ? new Date(e.end_date) : new Date(selectedYear, 11, 31, 23, 59, 59);
        const monthStart = new Date(selectedYear, selectedMonth, 1);
        const monthEnd = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);
        return start <= monthEnd && end >= monthStart;
      });
    } else {
      // When "All" is selected, still scope to the selected year
      result = eventsForYear;
    }

    // Apply origin filter
    if (originFilter === 'recurring') {
      result = result.filter((e) => e.origin === 'master_calendar');
    } else if (originFilter === 'manual') {
      result = result.filter((e) => e.origin !== 'master_calendar');
    }

    // Apply status filter
    if (statusFilter === 'active') {
      result = result.filter((e) => e.status === 'active');
    } else if (statusFilter === 'paused') {
      result = result.filter((e) => e.status === 'paused' || !e.status);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((e) => e.name.toLowerCase().includes(q) || (e.location || '').toLowerCase().includes(q));
    }

    return result;
  }, [events, eventsForYear, searchQuery, selectedMonth, selectedYear, originFilter, statusFilter]);

  // Counts for origin filter badges
  const originCounts = useMemo(() => {
    const base = selectedMonth !== null
      ? events.filter((e) => {
          if (!e.start_date && !e.end_date) return true;
          const start = e.start_date ? new Date(e.start_date) : new Date(selectedYear, 0, 1);
          const end = e.end_date ? new Date(e.end_date) : new Date(selectedYear, 11, 31, 23, 59, 59);
          const monthStart = new Date(selectedYear, selectedMonth, 1);
          const monthEnd = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);
          return start <= monthEnd && end >= monthStart;
        })
      : eventsForYear;
    return {
      all: base.length,
      recurring: base.filter((e) => e.origin === 'master_calendar').length,
      manual: base.filter((e) => e.origin !== 'master_calendar').length,
    };
  }, [events, eventsForYear, selectedMonth, selectedYear]);

  const filteredRecentContent = useMemo(() => {
    const arr = dashboard?.recent_content || [];
    return contentPlatform === 'all' ? arr : arr.filter((c) => c.platform === contentPlatform);
  }, [dashboard, contentPlatform]);

  const filteredRecentAlerts = useMemo(() => {
    const arr = dashboard?.recent_alerts || [];
    return contentPlatform === 'all' ? arr : arr.filter((a) => a.platform === contentPlatform);
  }, [dashboard, contentPlatform]);

  const eventCounts = useMemo(() => {
    const active = events.filter(e => e.status === 'active').length;
    const paused = events.filter(e => e.status === 'paused').length;
    return { active, paused, total: events.length };
  }, [events]);

  // ── Actions ──
  const buildPayload = () => {
    const kw = [];
    splitKeywords(keywordsTe).forEach((k) => kw.push({ keyword: k, language: 'te' }));
    splitKeywords(keywordsHi).forEach((k) => kw.push({ keyword: k, language: 'hi' }));
    splitKeywords(keywordsEn).forEach((k) => kw.push({ keyword: k, language: 'en' }));
    const payload = { name, location, keywords: kw, platforms: ['youtube', 'x', 'facebook'] };
    if (startDate) payload.start_date = startDate;
    if (endDate) payload.end_date = endDate;
    if (eventPollInterval && eventPollInterval !== 'default') payload.polling_interval_minutes = Number(eventPollInterval);
    return payload;
  };

  const resetForm = () => {
    setName(''); setLocation(''); setStartDate(''); setEndDate('');
    setKeywordsTe(''); setKeywordsHi(''); setKeywordsEn(''); setEventPollInterval('default');
  };

  const handleStartEdit = () => {
    if (!selectedEvent) return;
    closeActionOverlays();
    const kws = selectedEvent.keywords || [];
    setName(selectedEvent.name || '');
    setLocation(selectedEvent.location || '');
    setStartDate(selectedEvent.start_date ? new Date(selectedEvent.start_date).toISOString().split('T')[0] : '');
    setEndDate(selectedEvent.end_date ? new Date(selectedEvent.end_date).toISOString().split('T')[0] : '');
    const allLangKws = kws.filter(k => (k.language || 'all') === 'all').map(k => k.keyword);
    const enKws = kws.filter(k => k.language === 'en').map(k => k.keyword);
    setKeywordsTe(kws.filter(k => k.language === 'te').map(k => k.keyword).join(', '));
    setKeywordsHi(kws.filter(k => k.language === 'hi').map(k => k.keyword).join(', '));
    setKeywordsEn([...enKws, ...allLangKws].join(', '));
    setEventPollInterval(selectedEvent.polling_interval_minutes ? String(selectedEvent.polling_interval_minutes) : 'default');
    setEditingEvent(selectedEvent);
    setEventFormOpen(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name) { toast.error('Event name is required'); return; }
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) { toast.error('End date must be after start date'); return; }
    setCreating(true);
    try {
      if (editingEvent) {
        await api.put(`/events/${editingEvent.id}`, buildPayload());
        toast.success('Event updated successfully');
      } else {
        const res = await api.post('/events', buildPayload());
        toast.success('Event created successfully');
        setSelectedId(res.data?.id);
      }
      resetForm();
      setEventFormOpen(false);
      setEditingEvent(null);
      await fetchEvents();
      if (editingEvent) await fetchDashboard(selectedId);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Operation failed');
    } finally {
      setCreating(false);
    }
  };

  const handleRunScan = async () => {
    if (!selectedId) return;
    setRunningScan(true);
    try {
      await api.post(`/events/${selectedId}/run`);
      toast.success('Scan completed — new content ingested');
      await fetchDashboard(selectedId);
      await fetchEvents();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Scan failed');
    } finally {
      setRunningScan(false);
    }
  };

  const handlePause = async (eventId) => {
    const id = eventId || selectedId;
    if (!id) return;
    setProcessingAction(true);
    try {
      await api.post(`/events/${id}/pause`);
      toast.success('Monitoring paused');
      await fetchEvents();
      if (id === selectedId) await fetchDashboard(selectedId);
    } catch { toast.error('Failed to pause'); } finally { setProcessingAction(false); }
  };

  const handleResume = async (eventId) => {
    const id = eventId || selectedId;
    if (!id) return;
    setProcessingAction(true);
    try {
      await api.post(`/events/${id}/resume`);
      toast.success('Monitoring resumed');
      await fetchEvents();
      if (id === selectedId) await fetchDashboard(selectedId);
    } catch { toast.error('Failed to resume'); } finally { setProcessingAction(false); }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    setProcessingAction(true);
    try {
      await api.delete(`/events/${selectedId}`);
      toast.success('Event deleted');
      setSelectedId(null); setDashboard(null); setConfirmDeleteOpen(false);
      await fetchEvents();
    } catch { toast.error('Failed to delete'); } finally { setProcessingAction(false); }
  };

  const handleOpenAddSource = (item) => {
    closeActionOverlays();
    setAddSourceInitial({
      platform: item.platform || 'x',
      identifier: item.author_handle || item.author || '',
      display_name: item.author || '',
      poiData: {
        realName: item.author || '',
        socialMedia: [{ platform: item.platform || 'x', handle: item.author_handle || item.author || '', displayName: item.author || '', category: 'others', priority: 'medium', isActive: true, followerCount: '', createdDate: '' }]
      }
    });
    setAddSourceOpen(true);
  };

  // ── Export ──
  const handleExportSelectedEventExcel = () => {
    if (!dashboard) return;
    const rows = [];
    filteredRecentAlerts.forEach((a) => {
      rows.push({
        Type: 'ALERT',
        Time: a.created_at ? new Date(a.created_at).toISOString() : '',
        Platform: a.platform || '',
        Author: a.author || '',
        Text: a.title || '',
        URL: a.content_url || ''
      });
    });
    filteredRecentContent.forEach((c) => {
      rows.push({
        Type: 'CONTENT',
        Time: c.published_at ? new Date(c.published_at).toISOString() : '',
        Platform: c.platform || '',
        Author: c.author || '',
        Text: c.text || '',
        URL: c.content_url || ''
      });
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Selected Event');
    XLSX.writeFile(wb, `event-${dashboard.event?.id || 'report'}-selected.xlsx`);
    toast.success('Selected event Excel exported');
    setExportMenuOpen(false);
  };

  const handleExportSelectedEventPdf = () => {
    if (!dashboard) return;
    openPrintableReport({ event: dashboard.event, stats: dashboard.stats, content: filteredRecentContent, alerts: filteredRecentAlerts });
    setExportMenuOpen(false);
  };

  /** Helper: render a QR code to a data URL using an offscreen QRCodeCanvas */
  const generateQRDataUrl = (url, size = 120) => {
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    document.body.appendChild(container);
    return new Promise((resolve) => {
      const root = createRoot(container);
      root.render(
        React.createElement(QRCodeCanvas, { value: url, size, level: 'M', includeMargin: true })
      );
      setTimeout(() => {
        const qrCanvas = container.querySelector('canvas');
        const dataUrl = qrCanvas ? qrCanvas.toDataURL('image/png') : null;
        root.unmount();
        document.body.removeChild(container);
        resolve(dataUrl);
      }, 100);
    });
  };

  /** Get the QR/report URL for a row — prefers S3 PDF URL */
  const getRowReportUrl = (row) => {
    if (row.reportUrl) return row.reportUrl;
    if (row.eventId) return `${window.location.origin}/events?selected=${row.eventId}`;
    return '';
  };

  const handleExportAllEventsExcel = async () => {
    try {
      const [reportRes, calRes] = await Promise.all([
        api.get('/events/report'),
        api.get('/master-calendar', { params: { recurring: 'true' } })
      ]);
      const enrichedEvents = reportRes.data || [];
      const calendarEvents = calRes.data || [];
      const rows = buildReportRows({ calendarEvents, events: enrichedEvents });
      const now = new Date();
      const generatedAt = now.toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });

      const wsData = [
        ['Events Report'],
        [`Report Generated: ${generatedAt}`],
        [],
        ['Sl.No', 'Event Name', 'Event Date', 'Monitoring Range', 'Keywords (Given by Team)', 'New Keywords Fetched', 'QR Code'],
      ];

      const qrImages = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const reportUrl = getRowReportUrl(r);
        wsData.push([
          i + 1,
          r.eventName,
          r.eventDate,
          r.monitoringRange,
          r.keywordsGiven,
          r.newKeywordsFetched,
          '' // QR placeholder
        ]);
        if (reportUrl) {
          const dataUrl = await generateQRDataUrl(reportUrl, 100);
          if (dataUrl) qrImages.push({ row: i + 4, col: 6, dataUrl });
        }
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws['!cols'] = [
        { wch: 6 }, { wch: 40 }, { wch: 18 }, { wch: 16 },
        { wch: 35 }, { wch: 30 }, { wch: 18 }
      ];
      ws['!rows'] = [];
      for (let i = 0; i < wsData.length; i++) {
        if (i >= 4) ws['!rows'][i] = { hpt: 80 };
      }
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      ];
      qrImages.forEach(({ row }) => {
        const cell = XLSX.utils.encode_cell({ r: row, c: 6 });
        if (ws[cell]) ws[cell].v = '\uD83D\uDCF1 Scan QR in PDF/Print';
      });

      XLSX.utils.book_append_sheet(wb, ws, 'Events Report');
      const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([wbOut], { type: 'application/octet-stream' }), `Events_Report_${now.toISOString().slice(0, 10)}.xlsx`);
      toast.success('Events Report Excel exported');
    } catch {
      toast.error('Failed to export Excel');
    }
    setExportMenuOpen(false);
  };

  const handleExportAllEventsPdf = async () => {
    try {
      const [reportRes, calRes] = await Promise.all([
        api.get('/events/report'),
        api.get('/master-calendar', { params: { recurring: 'true' } })
      ]);
      const enrichedEvents = reportRes.data || [];
      const calendarEvents = calRes.data || [];
      const rows = buildReportRows({ calendarEvents, events: enrichedEvents });
      const now = new Date();
      const generatedAt = now.toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });

      // Pre-generate QR codes
      const qrDataUrls = {};
      for (const r of rows) {
        const url = getRowReportUrl(r);
        if (url) {
          const dataUrl = await generateQRDataUrl(url, 150);
          if (dataUrl) qrDataUrls[r.eventId || r.eventName] = dataUrl;
        }
      }

      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(18);
      doc.text('Events Report', 14, 20);
      doc.setFontSize(10);
      doc.text(`Report Generated: ${generatedAt}`, 14, 28);

      doc.autoTable({
        startY: 36,
        head: [['Sl.No', 'Event Name', 'Event Date', 'Monitoring\nRange', 'Keywords (Given by Team)', 'New Keywords\nFetched', 'QR Code']],
        body: rows.map((r, idx) => [
          idx + 1,
          r.eventName,
          r.eventDate,
          r.monitoringRange,
          r.keywordsGiven,
          r.newKeywordsFetched,
          '' // QR placeholder
        ]),
        columnStyles: {
          0: { cellWidth: 12 },
          1: { cellWidth: 55 },
          2: { cellWidth: 30 },
          3: { cellWidth: 24 },
          4: { cellWidth: 60 },
          5: { cellWidth: 45 },
          6: { cellWidth: 30 },
        },
        styles: { fontSize: 7, cellPadding: 3, minCellHeight: 25 },
        headStyles: { fillColor: [26, 26, 46], textColor: 255, fontStyle: 'bold', fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didDrawCell: (data) => {
          if (data.section === 'body' && data.column.index === 6) {
            const r = rows[data.row.index];
            const key = r?.eventId || r?.eventName;
            if (key && qrDataUrls[key]) {
              const dim = Math.min(data.cell.height - 2, 22);
              doc.addImage(
                qrDataUrls[key],
                'PNG',
                data.cell.x + (data.cell.width - dim) / 2,
                data.cell.y + (data.cell.height - dim) / 2,
                dim, dim
              );
            }
          }
        },
      });

      doc.save(`Events_Report_${now.toISOString().slice(0, 10)}.pdf`);
      toast.success('Events Report PDF exported');
    } catch {
      toast.error('Failed to export PDF');
    }
    setExportMenuOpen(false);
  };

  // ── API Settings ──
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await api.put('/events/monitoring-interval', eventIntervals);
      toast.success('Event scanning intervals updated');
      setSettingsOpen(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const openSettingsDialog = async () => {
    setSettingsOpen(true);
    await fetchSettings();
  };

  // ── Status badge ──
  const StatusBadge = ({ status }) => {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.planned;
    return (
      <Badge variant="outline" className={`text-[10px] px-2 py-0.5 border font-semibold gap-1.5 ${cfg.color}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} ${status === 'active' ? 'animate-pulse' : ''}`} />
        {cfg.label}
      </Badge>
    );
  };

  // ══════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-amber-50/30 dark:bg-slate-950" data-testid="events-page">

      {/* ── Top Header Bar ── */}
      <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700 shadow-sm">
        <div className="px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-400 flex items-center justify-center shadow-md">
                <Shield className="h-4.5 w-4.5 text-black" />
              </div>
              <div>
                <h1 className="text-[15px] font-bold text-gray-900 dark:text-white tracking-tight">Events</h1>
                <div className="flex items-center gap-3 mt-0.5">
                  <span onClick={() => setStatusFilter(statusFilter === 'active' ? 'all' : 'active')} className={`text-[11px] flex items-center gap-1.5 font-medium cursor-pointer hover:underline ${statusFilter === 'active' ? 'text-emerald-700 underline' : 'text-emerald-600'}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {eventCounts.active} live
                  </span>
                  <span onClick={() => setStatusFilter(statusFilter === 'paused' ? 'all' : 'paused')} className={`text-[11px] cursor-pointer hover:underline ${statusFilter === 'paused' ? 'text-gray-700 underline font-medium' : 'text-gray-400'}`}>{eventCounts.paused} paused</span>
                  <span onClick={() => setStatusFilter('all')} className={`text-[11px] cursor-pointer hover:underline ${statusFilter === 'all' ? 'text-gray-700 underline font-medium' : 'text-gray-400'}`}>{eventCounts.total} total</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs text-gray-600 dark:text-gray-400 border-gray-200 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-slate-800 hover:border-indigo-300" onClick={openHcpCalendar}>
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">HCP Recurring</span>
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs text-gray-600 dark:text-gray-400 border-gray-200 dark:border-slate-700 hover:bg-amber-50 dark:hover:bg-slate-800 hover:border-amber-300" onClick={openHcpNonRecurring}>
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">HCP Non-Recurring</span>
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs text-gray-600 dark:text-gray-400 border-gray-200 dark:border-slate-700 hover:bg-amber-50 dark:hover:bg-slate-800 hover:border-amber-300" onClick={openSettingsDialog}>
                <Settings className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">API Settings</span>
              </Button>
              <Button size="sm" className="gap-1.5 h-8 text-xs bg-gray-900 hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200 text-white shadow-md" onClick={openCreateDialog}>
                <Plus className="h-3.5 w-3.5" />
                New Event
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main ── */}
      <div className="flex-1 flex overflow-hidden w-full">

        {/* Far-Left — Month Sidebar */}
        <EventMonthSidebar
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          monthCounts={monthCounts}
          onSelectMonth={setSelectedMonth}
          onChangeYear={setSelectedYear}
          totalCount={eventsForYear.length}
        />

        {/* Left — Events List */}
        <div className="hidden md:flex shrink-0 border-r border-gray-200 dark:border-slate-700 flex-col bg-white dark:bg-slate-900 relative" style={{ width: sidebarWidth }}>
          <div className="p-3 border-b border-gray-100 dark:border-slate-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search events..." className="pl-8 h-8 text-xs bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus-visible:ring-amber-400/40" />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Origin filter buttons */}
          <div className="px-3 pb-2 flex gap-1">
            {[
              { key: 'all',       label: 'All',           count: originCounts.all },
              { key: 'recurring', label: 'Recurring',      count: originCounts.recurring },
              { key: 'manual',    label: 'Non-Recurring',  count: originCounts.manual },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setOriginFilter(f.key)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all duration-200 border
                  ${originFilter === f.key
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white shadow-sm'
                    : 'bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
              >
                {f.label}
                <span className={`text-[9px] font-bold tabular-nums rounded-full px-1 min-w-[16px] text-center
                  ${originFilter === f.key
                    ? 'bg-white/20 dark:bg-gray-900/20'
                    : 'bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-gray-400'
                  }`}>
                  {f.count}
                </span>
              </button>
            ))}
          </div>

          <ScrollArea className="flex-1">
            <div className="p-1.5 space-y-0.5">
              {loadingEvents ? (
                <div className="py-16 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-amber-500" /></div>
              ) : filteredEvents.length === 0 ? (
                <div className="py-16 text-center text-xs text-gray-400">{searchQuery ? 'No matching events' : 'No events yet'}</div>
              ) : (
                filteredEvents.map((e) => {
                  const isSelected = selectedId === e.id;
                  // Use stored status directly — no date-based auto-computation
                  const displayStatus = e.status || 'paused';
                  const cfg = STATUS_CONFIG[displayStatus] || STATUS_CONFIG.planned;
                  // Month color for the event card
                  const eventMonth = e.start_date ? new Date(e.start_date).getMonth() : new Date().getMonth();
                  const mTheme = selectedMonth !== null ? MONTH_THEMES[selectedMonth] : MONTH_THEMES[eventMonth];
                  const canTogglePause = displayStatus !== 'archived';
                  return (
                    <button key={e.id} type="button" onClick={() => handleSelectEvent(e.id)}
                      className={`w-full text-left rounded-lg px-3 py-2.5 transition-all duration-200 border
                        ${isSelected
                          ? `${mTheme.cardBg} ${mTheme.cardBorder} shadow-sm`
                          : `hover:${mTheme.cardBg} border-transparent hover:${mTheme.cardBorder}`
                        }`}>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <span className={`font-semibold text-[13px] leading-snug truncate flex-1 ${isSelected ? mTheme.cardAccent : 'text-gray-800 dark:text-gray-200'}`}>{e.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {canTogglePause && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(ev) => { ev.stopPropagation(); e.status === 'paused' ? handleResume(e.id) : handlePause(e.id); }}
                              onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); e.status === 'paused' ? handleResume(e.id) : handlePause(e.id); } }}
                              className={`inline-flex items-center justify-center h-5 w-5 rounded transition-colors ${e.status === 'paused' ? 'text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-950' : 'text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-950'}`}
                              title={e.status === 'paused' ? 'Resume monitoring' : 'Pause monitoring'}
                            >
                              {e.status === 'paused' ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                            </span>
                          )}
                          <span className={`text-[8px] font-bold uppercase rounded px-1.5 py-0.5 leading-none border ${cfg.color}`}>{cfg.label}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {(Array.isArray(e.platforms) ? e.platforms : []).map((p) => (
                          <span key={p} className="text-[9px] font-bold uppercase text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 rounded px-1.5 py-0.5">{p}</span>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400">
                        {e.location && (<span className="flex items-center gap-0.5 truncate"><MapPin className="h-2.5 w-2.5 shrink-0" />{e.location}</span>)}
                        {(e.start_date || e.end_date) && (
                          <span className="flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5 shrink-0" />
                            {e.start_date ? new Date(e.start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Open'}
                            {' – '}
                            {e.end_date ? new Date(e.end_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : 'Ongoing'}
                          </span>
                        )}
                        {!e.start_date && !e.end_date && (
                          <span className="flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5 shrink-0" />
                            Open-ended
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>

          <div className="shrink-0 px-3 py-2 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/50 text-[10px] text-gray-400 flex items-center justify-between">
            <span>{events.length} events</span>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800" onClick={fetchEvents} disabled={loadingEvents}>
              {loadingEvents ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
          {/* Resize handle */}
          <div
            onMouseDown={handleMouseDown}
            className={`absolute top-0 right-0 w-1 h-full cursor-col-resize group hover:bg-amber-400 transition-colors z-10 ${isResizing ? 'bg-amber-400' : 'bg-transparent'}`}
          >
            <div className="absolute top-1/2 -translate-y-1/2 right-0 w-3 h-8 -mr-1 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="w-0.5 h-4 bg-amber-400 rounded-full" />
            </div>
          </div>
        </div>

        {/* Right — Dashboard */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-amber-50/30 dark:bg-slate-950">

          {/* Mobile picker */}
          <div className="md:hidden shrink-0 px-4 py-3 border-b border-gray-200 dark:border-slate-700">
            <Select value={selectedId ? String(selectedId) : ''} onValueChange={(v) => handleSelectEvent(v)}>
              <SelectTrigger className="h-9 text-sm bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-900 dark:text-gray-100"><SelectValue placeholder="Select event..." /></SelectTrigger>
              <SelectContent>{events.map((e) => (<SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>))}</SelectContent>
            </Select>
          </div>

          {/* Dashboard Header */}
          {selectedEvent && (
            <div className="shrink-0 px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 mb-0.5">
                      <h2 className="font-bold text-[15px] leading-tight truncate text-gray-900 dark:text-white">{selectedEvent.name}</h2>
                      <StatusBadge status={selectedEvent.status} />
                      {selectedEvent.keywords?.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap ml-1">
                          {selectedEvent.keywords.slice(0, 6).map((kw, i) => (
                            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 whitespace-nowrap">
                              {kw.keyword}
                            </span>
                          ))}
                          {selectedEvent.keywords.length > 6 && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">+{selectedEvent.keywords.length - 6}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-gray-400">
                      {selectedEvent.location && (<span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{selectedEvent.location}</span>)}
                      {(selectedEvent.start_date || selectedEvent.end_date) ? (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {selectedEvent.start_date ? new Date(selectedEvent.start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Open'} → {selectedEvent.end_date ? new Date(selectedEvent.end_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Ongoing'}
                      </span>
                      ) : (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Open-ended monitoring
                      </span>
                      )}
                      {selectedEvent.last_polled_at && (
                        <span className="flex items-center gap-1 text-emerald-600">
                          <Activity className="h-3 w-3" />
                          Last: {new Date(selectedEvent.last_polled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={handleStartEdit} className="h-8 w-8 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800" title="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon"
                    onClick={() => selectedEvent.status === 'paused' ? handleResume(selectedEvent.id) : handlePause(selectedEvent.id)}
                    disabled={processingAction || selectedEvent.status === 'archived'}
                    className={`h-8 w-8 ${selectedEvent.status === 'paused' ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950' : 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950'}`}
                    title={selectedEvent.status === 'paused' ? 'Resume' : 'Pause'}>
                    {processingAction ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : selectedEvent.status === 'paused' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={openDeleteDialog} disabled={processingAction} className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950" title="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>

                  <Separator orientation="vertical" className="h-5 mx-1" />

                  <Button onClick={handleRunScan} disabled={!selectedId || runningScan || selectedEvent?.status === 'archived'}
                    size="sm" className="h-8 px-3 gap-1.5 text-xs font-semibold bg-gray-900 hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200 text-white shadow-md">
                    {runningScan ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">Fetch Now</span>
                  </Button>

                  <div className="relative">
                    <Button
                      size="sm"
                      onClick={() => setExportMenuOpen(!exportMenuOpen)}
                      disabled={!dashboard && (events?.length || 0) === 0}
                      className="h-10 rounded-xl bg-blue-600 px-4 gap-2 text-sm font-semibold text-white shadow-md transition-all hover:bg-blue-700 disabled:bg-blue-300 disabled:text-white"
                    >
                      <Download className="h-4 w-4" />
                      <span>Export</span>
                      <ChevronDown className={cn('h-4 w-4 transition-transform', exportMenuOpen && 'rotate-180')} />
                    </Button>
                    {exportMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                        <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-2xl border border-blue-100 bg-white p-2 shadow-xl">
                          <div className="px-2 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Selected Event</div>
                          <button onClick={handleExportSelectedEventPdf} disabled={!dashboard} className="flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-blue-50 hover:text-slate-900 transition-colors disabled:opacity-40">
                            <FileText className="h-4 w-4 text-red-500" /> Export PDF
                          </button>
                          <button onClick={handleExportSelectedEventExcel} disabled={!dashboard} className="flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-blue-50 hover:text-slate-900 transition-colors disabled:opacity-40">
                            <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Export Excel
                          </button>

                          <div className="my-1.5 border-t border-slate-100" />
                          <div className="px-2 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">All Events (Global)</div>
                          <button onClick={handleExportAllEventsPdf} disabled={(events?.length || 0) === 0} className="flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-blue-50 hover:text-slate-900 transition-colors disabled:opacity-40">
                            <FileText className="h-4 w-4 text-red-500" /> Export PDF
                          </button>
                          <button onClick={handleExportAllEventsExcel} disabled={(events?.length || 0) === 0} className="flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-blue-50 hover:text-slate-900 transition-colors disabled:opacity-40">
                            <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Export Excel
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Platform tabs */}
          {selectedEvent && dashboard && (
            <div className="shrink-0 px-4 sm:px-6 py-2 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {Object.entries(PLATFORM_CONFIG).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  const isActive = contentPlatform === key;
                  return (
                    <button key={key} onClick={() => setContentPlatform(key)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200 ${isActive ? 'bg-gray-900 text-white shadow-sm dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-200'}`}>
                      <Icon className={`h-3.5 w-3.5 ${isActive ? '' : cfg.color}`} />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary cards */}
          {selectedEvent && dashboard && (
            <div className="shrink-0 px-4 sm:px-6 py-3 border-b border-gray-100 dark:border-slate-800">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Total Content', value: dashboard?.stats?.content_total || 0, bg: 'bg-white dark:bg-slate-900', borderColor: 'border-amber-200 dark:border-amber-800', iconBg: 'bg-amber-100 dark:bg-amber-950', iconColor: 'text-amber-600 dark:text-amber-400', valueColor: 'text-gray-900 dark:text-white', icon: BarChart3 },
                  { label: 'Priority Alerts', value: dashboard?.stats?.alerts_priority || 0, bg: 'bg-white dark:bg-slate-900', borderColor: 'border-red-200 dark:border-red-800', iconBg: 'bg-red-50 dark:bg-red-950', iconColor: 'text-red-500 dark:text-red-400', valueColor: 'text-red-600 dark:text-red-400', icon: AlertTriangle },
                  { label: 'Recent Alerts', value: filteredRecentAlerts.length, bg: 'bg-white dark:bg-slate-900', borderColor: 'border-amber-200 dark:border-amber-800', iconBg: 'bg-amber-50 dark:bg-amber-950', iconColor: 'text-amber-500 dark:text-amber-400', valueColor: 'text-gray-900 dark:text-white', icon: Activity },
                  { label: 'Platforms', value: (selectedEvent.platforms || []).length, bg: 'bg-white dark:bg-slate-900', borderColor: 'border-emerald-200 dark:border-emerald-800', iconBg: 'bg-emerald-50 dark:bg-emerald-950', iconColor: 'text-emerald-600 dark:text-emerald-400', valueColor: 'text-gray-900 dark:text-white', icon: Globe }
                ].map((card) => (
                  <div key={card.label} className={`rounded-xl border ${card.borderColor} ${card.bg} p-4 shadow-sm`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{card.label}</p>
                        <p className={`text-2xl font-bold mt-1 ${card.valueColor}`}>{card.value}</p>
                      </div>
                      <div className={`h-10 w-10 rounded-xl ${card.iconBg} flex items-center justify-center`}>
                        <card.icon className={`h-5 w-5 ${card.iconColor}`} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Content area */}
          <div className="flex-1 overflow-hidden min-w-0 w-full">
            {loadingDashboard ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-amber-500 mx-auto mb-3" />
                  <p className="text-sm text-gray-400">Loading dashboard...</p>
                </div>
              </div>
            ) : !dashboard ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-8">
                <div className="h-16 w-16 rounded-2xl bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 flex items-center justify-center mb-4">
                  <CalendarDays className="h-8 w-8 text-amber-400" />
                </div>
                <p className="text-base font-semibold text-gray-600 dark:text-gray-300">Select an event to view</p>
                <p className="text-sm text-gray-400 mt-1 max-w-sm">Choose an event from the left panel or create a new one to start monitoring.</p>
              </div>
            ) : (
              <ScrollArea className="h-full w-full">
                <div className="px-4 sm:px-6 pt-4 pb-8 w-full max-w-full overflow-x-hidden">

                  {/* Priority alerts */}
                  {filteredRecentAlerts.filter(a => a.is_priority).length > 0 && (
                    <div className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                        <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider">Priority Alerts</h3>
                        <Badge variant="destructive" className="text-[10px] h-5 px-1.5">{filteredRecentAlerts.filter(a => a.is_priority).length}</Badge>
                      </div>
                      <div className="space-y-2">
                        {filteredRecentAlerts.filter(a => a.is_priority).map((a) => (
                          <div key={a.id} className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30 p-3.5 flex items-start justify-between gap-3 group hover:border-red-300 dark:hover:border-red-700 transition-all duration-200">
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-sm mb-0.5 truncate text-gray-800 dark:text-gray-200">{a.title}</div>
                              <div className="text-[11px] text-gray-400 flex items-center gap-2">
                                <Badge variant="outline" className="text-[9px] h-4 px-1.5 uppercase font-bold">{a.platform}</Badge>
                                <span>{new Date(a.created_at).toLocaleString('en-IN')}</span>
                              </div>
                              {a.priority_reason && (<p className="text-[11px] mt-1.5 text-red-500/80 italic">"{a.priority_reason}"</p>)}
                            </div>
                            <Button asChild variant="outline" size="sm" className="shrink-0 text-[11px] h-7 gap-1 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 opacity-60 group-hover:opacity-100 transition-opacity">
                              <a href={a.content_url} target="_blank" rel="noopener noreferrer">View <ArrowUpRight className="h-3 w-3" /></a>
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Content feed */}
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Detected Content ({filteredRecentContent.length})</h3>
                  </div>

                  {filteredRecentContent.length === 0 ? (
                    <div className="py-16 text-center">
                      <div className="h-14 w-14 rounded-2xl bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 flex items-center justify-center mx-auto mb-3">
                        <ScanLine className="h-7 w-7 text-amber-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No content detected yet</p>
                      <p className="text-xs text-gray-400 mt-1">Click "Fetch Now" to scan for new content.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 max-w-3xl">
                      {filteredRecentContent.map((c, idx) => (
                        <div key={c.id || idx}><ContentCard item={c} index={idx} onAddSource={handleOpenAddSource} /></div>
                      ))}
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </div>

      {/* ══════ DIALOGS ══════ */}

      {/* Create/Edit Event */}
      <Dialog open={eventFormOpen} onOpenChange={(open) => { setEventFormOpen(open); if (!open) { setEditingEvent(null); resetForm(); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingEvent ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingEvent ? 'Update Event' : 'Create New Event'}
            </DialogTitle>
            <DialogDescription>
              {editingEvent ? 'Edit event configuration, keywords, and monitoring interval.' : 'Add a new event to begin cross-platform monitoring.'}
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-5" onSubmit={handleCreate}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Event Name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. LPG Supply Disruption" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Location</Label>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Hyderabad" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Start Date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">End Date</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9" />
              </div>
            </div>

            {/* Per-event scan interval */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                Scan Interval (per event)
              </Label>
              <Select value={eventPollInterval || 'default'} onValueChange={(v) => setEventPollInterval(v === 'default' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Use global default" /></SelectTrigger>
                <SelectContent>
                  {EVENT_POLL_INTERVALS.map(opt => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Override global interval for this event. Leave blank to use global setting.</p>
            </div>

            <div>
              <Label className="text-xs font-semibold mb-2 block">Keywords (comma or newline separated)</Label>
              <Tabs defaultValue="en">
                <TabsList className="h-8 mb-2">
                  <TabsTrigger value="en" className="text-xs h-7 px-4">English</TabsTrigger>
                  <TabsTrigger value="te" className="text-xs h-7 px-4">Telugu</TabsTrigger>
                  <TabsTrigger value="hi" className="text-xs h-7 px-4">Hindi</TabsTrigger>
                </TabsList>
                <TabsContent value="te"><Textarea value={keywordsTe} onChange={(e) => setKeywordsTe(e.target.value)} rows={3} placeholder="ఉదా: ఎన్నికలు, ప్రభుత్వం, రైతుబంధు, prajalu, rythu bharosa..." className="text-sm" /></TabsContent>
                <TabsContent value="hi"><Textarea value={keywordsHi} onChange={(e) => setKeywordsHi(e.target.value)} rows={3} placeholder="उदा: चुनाव, वोट..." className="text-sm" /></TabsContent>
                <TabsContent value="en"><Textarea value={keywordsEn} onChange={(e) => setKeywordsEn(e.target.value)} rows={3} placeholder="e.g. election, vote..." className="text-sm" /></TabsContent>
              </Tabs>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => { setEventFormOpen(false); setEditingEvent(null); resetForm(); }}>Cancel</Button>
              <Button type="submit" disabled={creating} className="gap-1.5">
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingEvent ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {editingEvent ? 'Update Event' : 'Create Event'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600"><Trash2 className="h-4 w-4" /> Delete Event</DialogTitle>
            <DialogDescription>Permanently delete <strong>{selectedEvent?.name}</strong> and all data? This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={processingAction} className="gap-1.5">
              {processingAction ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete Event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* API Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Settings className="h-4 w-4" /> Event Scanning Settings</DialogTitle>
            <DialogDescription>Configure per-platform scan intervals for event monitoring. Changes take effect on the next cycle.</DialogDescription>
          </DialogHeader>

          {loadingSettings ? (
            <div className="py-8 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-5">
              {/* Enabled toggle */}
              <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-amber-500" />
                  <div>
                    <p className="text-sm font-semibold">Event Scanning</p>
                    <p className="text-[10px] text-muted-foreground">Enable or pause all event scanning</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{eventIntervals.enabled ? 'Active' : 'Paused'}</span>
                  <Switch
                    checked={eventIntervals.enabled}
                    onCheckedChange={(checked) => setEventIntervals(prev => ({ ...prev, enabled: checked }))}
                  />
                </div>
              </div>

              {/* Per-platform intervals */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold flex items-center gap-2">
                  <Timer className="h-4 w-4 text-primary" />
                  Platform Scan Intervals
                </Label>
                <p className="text-xs text-muted-foreground -mt-1">
                  Set how often each platform is scanned for event-related content (in minutes).
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: 'x', label: 'X (Twitter)', icon: '𝕏' },
                    { key: 'instagram', label: 'Instagram', icon: '📷' },
                    { key: 'facebook', label: 'Facebook', icon: '📘' },
                    { key: 'youtube', label: 'YouTube', icon: '▶️' }
                  ].map(({ key, label, icon }) => (
                    <div key={key} className="flex flex-col gap-1.5">
                      <Label className="text-[11px] font-medium flex items-center gap-1.5">
                        <span>{icon}</span> {label}
                      </Label>
                      <div className="relative">
                        <Input
                          type="number" min="5" max="1440"
                          value={eventIntervals[key] ?? 60}
                          onChange={(e) => setEventIntervals(prev => ({ ...prev, [key]: parseInt(e.target.value) || 60 }))}
                          className="h-9 pr-12 text-sm"
                          disabled={!eventIntervals.enabled}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">min</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-400">API Rate Limits</p>
                    <p className="text-[11px] text-amber-700/80 dark:text-amber-400/70 mt-0.5">
                      Shorter intervals consume more API quota. For YouTube, the daily quota is limited. Set 30+ minutes to avoid quota exhaustion.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveSettings} disabled={savingSettings || loadingSettings} className="gap-1.5">
              {savingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Settings className="h-3.5 w-3.5" />}
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* HCP Master Calendar Dialog */}
      <Dialog open={hcpOpen} onOpenChange={setHcpOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> {hcpTab === 'recurring' ? 'HCP Recurring Events' : 'HCP Non-Recurring Events'}
            </DialogTitle>
            <DialogDescription>
              {hcpTab === 'recurring'
                ? 'Manage yearly recurring events (festivals, national days, etc.) for proactive monitoring.'
                : 'Manage manually created non-recurring events for specific incidents or situations.'}
            </DialogDescription>
          </DialogHeader>

          {/* Search + Add */}
          <div className="flex items-center justify-end gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search..." value={hcpSearch} onChange={(e) => setHcpSearch(e.target.value)} className="pl-8 h-8 w-48 text-xs" />
              {hcpSearch && <button onClick={() => setHcpSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X className="h-3 w-3 text-muted-foreground" /></button>}
            </div>
            <Button size="sm" className="h-8 text-xs gap-1" onClick={openHcpCreate}>
              <Plus className="h-3.5 w-3.5" />Add Event
            </Button>
          </div>

          {/* Events Table — same structure for both recurring and non-recurring */}
          <div className="flex-1 overflow-auto border rounded-lg">
            {hcpLoading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : hcpFiltered.length === 0 ? (
              <div className="text-center py-20 text-sm text-muted-foreground">{hcpSearch ? 'No matching events' : 'No events yet — click "Add Event"'}</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-16 text-center">SL.NO</TableHead>
                    <TableHead>OCCASIONS</TableHead>
                    <TableHead className="w-32">DATE</TableHead>
                    <TableHead className="w-44">MONITORING RANGE</TableHead>
                    <TableHead>KEYWORDS</TableHead>
                    <TableHead>REMARKS</TableHead>
                    <TableHead className="w-20 text-center">ACTIONS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hcpFiltered.map((evt) => (
                    <TableRow key={evt.id || evt._id}>
                      <TableCell className="text-center font-medium text-xs">{evt.slNo}</TableCell>
                      <TableCell className="font-medium text-xs">{evt.occasion}</TableCell>
                      <TableCell className="text-xs">{evt.date}</TableCell>
                      <TableCell className="text-xs">{evt.monitoringRange || '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {evt.keywords ? evt.keywords.split(',').map((kw, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">{kw.trim()}</Badge>
                          )) : <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{evt.remarks || '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openHcpEdit(evt)} className="p-1 rounded hover:bg-muted" title="Edit">
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button onClick={() => handleHcpDelete(evt.id)} className="p-1 rounded hover:bg-destructive/10" title="Delete">
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground text-right">{hcpFiltered.length} event{hcpFiltered.length !== 1 ? 's' : ''}</div>
        </DialogContent>
      </Dialog>

      {/* HCP Recurring Event Create/Edit Sub-Dialog */}
      <Dialog open={hcpFormOpen} onOpenChange={setHcpFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{hcpEditId ? 'Edit Calendar Event' : 'Add Calendar Event'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleHcpSave} className="space-y-4">
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Occasion *</Label>
                <Input placeholder="e.g. Republic Day" value={hcpForm.occasion} onChange={(e) => setHcpForm({ ...hcpForm, occasion: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Date *</Label>
                <Input placeholder="e.g. 26 January" value={hcpForm.date} onChange={(e) => setHcpForm({ ...hcpForm, date: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Monitoring Range</Label>
                <Input placeholder="e.g. 24 Jan – 28 Jan" value={hcpForm.monitoringRange} onChange={(e) => setHcpForm({ ...hcpForm, monitoringRange: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Keywords (comma-separated)</Label>
                <Textarea placeholder="Republic Day, 26 January, parade" value={hcpForm.keywords} onChange={(e) => setHcpForm({ ...hcpForm, keywords: e.target.value })} rows={2} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Remarks</Label>
                <Input placeholder="Optional notes" value={hcpForm.remarks} onChange={(e) => setHcpForm({ ...hcpForm, remarks: e.target.value })} className="h-9" />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setHcpFormOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={hcpSaving} className="gap-1.5">
                {hcpSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {hcpEditId ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Non-Recurring Event Create/Edit Sub-Dialog (full Event model fields) */}
      <Dialog open={nrFormOpen} onOpenChange={setNrFormOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {nrEditId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {nrEditId ? 'Edit Event' : 'Create New Event'}
            </DialogTitle>
            <DialogDescription>
              {nrEditId ? 'Edit event configuration, keywords, and monitoring interval.' : 'Add a new non-recurring event to monitor. All data is stored permanently.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleNrSave} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Event Name *</Label>
                <Input value={nrForm.name} onChange={(e) => setNrForm({ ...nrForm, name: e.target.value })} placeholder="e.g. Ganesh Immersion Rally" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Location</Label>
                <Input value={nrForm.location} onChange={(e) => setNrForm({ ...nrForm, location: e.target.value })} placeholder="e.g. Hyderabad" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Start Date</Label>
                <Input type="date" value={nrForm.start_date} onChange={(e) => setNrForm({ ...nrForm, start_date: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">End Date</Label>
                <Input type="date" value={nrForm.end_date} onChange={(e) => setNrForm({ ...nrForm, end_date: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                Scan Interval
              </Label>
              <Select value={nrForm.polling_interval_minutes || 'default'} onValueChange={(v) => setNrForm({ ...nrForm, polling_interval_minutes: v === 'default' ? '' : v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Use global default" /></SelectTrigger>
                <SelectContent>
                  {EVENT_POLL_INTERVALS.map(opt => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold mb-2 block">Keywords (comma or newline separated)</Label>
              <Tabs defaultValue="en">
                <TabsList className="h-8 mb-2">
                  <TabsTrigger value="en" className="text-xs h-7 px-4">English</TabsTrigger>
                  <TabsTrigger value="te" className="text-xs h-7 px-4">Telugu</TabsTrigger>
                  <TabsTrigger value="hi" className="text-xs h-7 px-4">Hindi</TabsTrigger>
                </TabsList>
                <TabsContent value="te"><Textarea value={nrForm.keywords_te} onChange={(e) => setNrForm({ ...nrForm, keywords_te: e.target.value })} rows={3} placeholder="ఉదా: ఎన్నికలు, ప్రభుత్వం, రైతుబంధు, prajalu, rythu bharosa..." className="text-sm" /></TabsContent>
                <TabsContent value="hi"><Textarea value={nrForm.keywords_hi} onChange={(e) => setNrForm({ ...nrForm, keywords_hi: e.target.value })} rows={3} placeholder="उदा: चुनाव, वोट..." className="text-sm" /></TabsContent>
                <TabsContent value="en"><Textarea value={nrForm.keywords_en} onChange={(e) => setNrForm({ ...nrForm, keywords_en: e.target.value })} rows={3} placeholder="e.g. election, vote..." className="text-sm" /></TabsContent>
              </Tabs>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setNrFormOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={nrSaving} className="gap-1.5">
                {nrSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : nrEditId ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {nrEditId ? 'Update Event' : 'Create Event'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Source Modal */}
      <AddSourceModal
        open={addSourceOpen}
        onClose={() => { setAddSourceOpen(false); setAddSourceInitial(null); }}
        onSuccess={() => { toast.success('Profile added to monitoring list'); }}
        initialData={addSourceInitial}
      />
    </div>
  );
};

export default Events;
