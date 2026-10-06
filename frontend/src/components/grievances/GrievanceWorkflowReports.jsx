import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';
import {
    Download, Loader2, ExternalLink, RefreshCw, ChevronDown,
    Calendar, Filter, Search, FileSpreadsheet, MessageSquare,
    Eye, Printer, GripHorizontal, X, Maximize2, Minimize2,
    Share2, Copy, Check, AlertCircle, Clock, Users, Tag,
    Link2, Image, FileText, MoreHorizontal, ArrowUpDown,
    Phone, Mail, Globe, Facebook, Twitter, MessageCircle,
    ChevronLeft, ChevronRight, Info, Shield, Lock, Reply,
    User, CircleDot, CircleCheck, ArrowRight, Send, Plus
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useReactToPrint } from 'react-to-print';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../ui/select';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator
} from '../ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Separator } from '../ui/separator';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Helpers ─── */
const fmtDate = (d) => {
    if (!d) return '—';
    try {
        return new Date(d).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch { return '—'; }
};

const fmtRelativeTime = (date) => {
    if (!date) return '';
    const now = new Date();
    const then = new Date(date);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return fmtDate(date);
};

const isVideoUrl = (url = '') => {
    const u = String(url).toLowerCase();
    return /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i.test(u)
        || u.includes('video')
        || u.includes('m3u8');
};

const statusConfig = {
    PENDING: {
        label: 'Pending',
        color: 'yellow',
        icon: Clock,
        bg: 'bg-yellow-50',
        text: 'text-yellow-700',
        border: 'border-yellow-200',
        dot: 'bg-yellow-500'
    },
    ESCALATED: {
        label: 'Escalated',
        color: 'orange',
        icon: AlertCircle,
        bg: 'bg-orange-50',
        text: 'text-orange-700',
        border: 'border-orange-200',
        dot: 'bg-orange-500'
    },
    CLOSED: {
        label: 'Closed',
        color: 'green',
        icon: Check,
        bg: 'bg-green-50',
        text: 'text-green-700',
        border: 'border-green-200',
        dot: 'bg-green-500'
    },
    FIR: {
        label: 'FIR',
        color: 'red',
        icon: Shield,
        bg: 'bg-red-50',
        text: 'text-red-700',
        border: 'border-red-200',
        dot: 'bg-red-500'
    }
};

const normalizeStatus = (s = '') => String(s || '').trim().toUpperCase();

const parseFirFields = (report = {}) => {
    const rawStatus = String(report.fir_status || '').trim();
    const storedNumber = String(report.fir_number || '').trim();

    if (!rawStatus && !storedNumber) return { converted: '', firNumber: '' };

    if (/^yes\s*[-:]\s*/i.test(rawStatus)) {
        return {
            converted: 'Yes',
            firNumber: storedNumber || rawStatus.replace(/^yes\s*[-:]\s*/i, '').trim()
        };
    }

    if (rawStatus.toLowerCase() === 'yes') return { converted: 'Yes', firNumber: storedNumber };
    if (rawStatus.toLowerCase() === 'no') return { converted: 'No', firNumber: '' };

    return { converted: 'Yes', firNumber: storedNumber || rawStatus };
};

const isUnknownName = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    return !normalized || normalized === 'unknown user' || normalized === 'unknown' || normalized === 'n/a';
};

const resolveOperatorName = (report = {}, preferred = null) => {
    const preferredName = preferred?.name;
    if (!isUnknownName(preferredName)) return preferredName;

    const createdByName = report?.created_by?.name;
    if (!isUnknownName(createdByName)) return createdByName;

    const statusHistoryName = (report?.status_history || [])
        .map((entry) => entry?.changed_by?.name)
        .find((name) => !isUnknownName(name));
    if (!isUnknownName(statusHistoryName)) return statusHistoryName;

    const complainantOperatorName = (report?.complainant_logs || [])
        .map((entry) => entry?.operator?.name)
        .find((name) => !isUnknownName(name));
    if (!isUnknownName(complainantOperatorName)) return complainantOperatorName;

    return '';
};

const statusMatches = (filter, report) => {
    if (!filter || filter === 'all') return true;
    const s = normalizeStatus(report.status);
    if (filter === 'FIR') {
        const { converted } = parseFirFields(report);
        return converted === 'Yes';
    }
    if (filter === 'PENDING') return s === 'PENDING';
    if (filter === 'ESCALATED') return s === 'ESCALATED' || s === 'ESCALED';
    if (filter === 'CLOSED') return s === 'CLOSED';
    return s === filter;
};

const platformIcons = {
    x: Twitter,
    twitter: Twitter,
    facebook: Facebook,
    whatsapp: MessageCircle,
    default: Globe
};

/* ─── Duration calculator ─── */
const calcDuration = (from, to) => {
    if (!from) return '—';
    const start = new Date(from);
    const end = to ? new Date(to) : new Date();
    const diffMs = Math.max(0, end - start);
    const mins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    if (days > 0) return `${days}d ${hrs % 24}h`;
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*   DETAIL VIEW – Single scrollable report page          */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const GrievanceReportDetailView = ({ report, onClose, onPrint, isVideoUrl: isVideo, onUpdate }) => {
    const [simMsg, setSimMsg] = useState('');
    const [simSender, setSimSender] = useState('user');
    const [simMode, setSimMode] = useState('X POST');
    const [submitting, setSubmitting] = useState(false);
    const [pdfGenerating, setPdfGenerating] = useState(false);
    const [pdfUrl, setPdfUrl] = useState(report?.report_pdf_url || null);

    useEffect(() => {
        if (!pdfUrl && report?.id && !pdfGenerating) {
            handleGeneratePdf();
        }
    }, [pdfUrl, report?.id]);

    const handleGeneratePdf = async () => {
        setPdfGenerating(true);
        try {
            const res = await api.post(`/grievance-workflow/reports/${report?.id || report?.unique_code}/generate-pdf`);
            const url = res.data?.pdf_url;
            if (url) {
                setPdfUrl(url);
                onUpdate?.({ ...report, report_pdf_url: url });
                toast.success('PDF generated successfully');
            }
        } catch (err) {
            toast.error(err?.response?.data?.detail || 'PDF generation failed');
            console.error(err);
        } finally {
            setPdfGenerating(false);
        }
    };

    const simModeOptions = {
        user: ['X POST', 'X DM', 'WHATSAPP CALL', 'WHATSAPP DM', 'FB POST'],
        operator_user: ['X DM', 'X POST', 'WHATSAPP CALL', 'WHATSAPP DM', 'FB POST'],
        officer: ['WHATSAPP MSG', 'WHATSAPP CALL', 'PHONE CALL', 'X DM', 'WHATSAPP DM', 'FB POST'],
        operator_remarks: ['INTERNAL'],
    };
    const handleSetSimSender = (s) => {
        setSimSender(s);
        setSimMode((simModeOptions[s] || ['X POST'])[0]);
    };

    const r = report || {};
    const status = statusConfig[r.status] || statusConfig.PENDING;
    const StatusIcon = status.icon;
    const mediaUrls = (Array.isArray(r.media_s3_urls) && r.media_s3_urls.length > 0 ? r.media_s3_urls : r.media_urls || []);
    const closingMediaUrls = (Array.isArray(r.closing_media_s3_urls) && r.closing_media_s3_urls.length > 0 ? r.closing_media_s3_urls : r.closing_media_urls || []);
    const firInfo = parseFirFields(r);
    const platformLabel = r.platform === 'x' || r.platform === 'twitter' ? 'X (Twitter)' : r.platform === 'facebook' ? 'Facebook' : r.platform === 'whatsapp' ? 'WhatsApp' : r.platform || '—';
    const PlatformIcon = platformIcons[r.platform] || platformIcons.default;

    /* Build status timeline steps */
    const timelineSteps = useMemo(() => {
        if (!report) return [];
        const steps = [];
        const hist = r.status_history || [];

        /* PENDING */
        const pendingEntry = hist.find(h => h.to_status === 'PENDING') || {};
        const createdAt = r.created_at;
        const escalatedAt = r.escalated_at || hist.find(h => h.to_status === 'ESCALATED' || h.to_status === 'ESCALED')?.timestamp;
        const closedAt = r.closed_at || hist.find(h => h.to_status === 'CLOSED')?.timestamp;
        const currentStatus = (r.status || 'PENDING').toUpperCase();

        steps.push({
            label: 'Pending',
            date: createdAt,
            active: true,
            current: currentStatus === 'PENDING',
            duration: calcDuration(createdAt, escalatedAt || closedAt || (currentStatus === 'PENDING' ? null : createdAt)),
            officer: r.created_by?.name || r.informed_to?.name || '—',
            note: 'Issue created',
            color: 'yellow'
        });

        /* ESCALATED */
        const escalateHist = hist.find(h => h.to_status === 'ESCALATED' || h.to_status === 'ESCALED');
        const isEscalated = currentStatus === 'ESCALATED' || currentStatus === 'ESCALED' || currentStatus === 'CLOSED';

        let escalatedNote = escalateHist?.note || (r.informed_to?.name ? `Escalated to ${r.informed_to.name}` : '—');
        if (r.informed_to?.phone && escalatedNote !== '—' && !escalatedNote.includes(r.informed_to.phone)) {
            escalatedNote += ` (${r.informed_to.phone})`;
        }

        steps.push({
            label: 'Escalated',
            date: escalatedAt,
            active: isEscalated,
            current: currentStatus === 'ESCALATED' || currentStatus === 'ESCALED',
            duration: isEscalated ? calcDuration(escalatedAt, closedAt || (currentStatus === 'CLOSED' ? closedAt : null)) : '—',
            officer: escalateHist?.changed_by?.name || r.informed_to?.name || '—',
            note: escalatedNote,
            color: 'orange'
        });

        /* CLOSED */
        const closeHist = hist.find(h => h.to_status === 'CLOSED');
        const isClosed = currentStatus === 'CLOSED';
        steps.push({
            label: 'Closed',
            date: closedAt,
            active: isClosed,
            current: isClosed,
            duration: isClosed ? calcDuration(createdAt, closedAt) : '—',
            officer: closeHist?.changed_by?.name || '—',
            note: r.closing_remarks || closeHist?.note || 'Resolved',
            color: 'green',
            totalResolution: true
        });

        return steps;
    }, [r]);

    /* Chat logs merged */
    const chatLogs = useMemo(() => {
        const logs = [
            ...(r.complainant_logs || []).map(l => ({ ...l, _source: 'complainant' })),
            ...(r.officer_logs || []).map(l => ({ ...l, _source: 'officer' }))
        ];

        const escalateHist = (r.status_history || []).find(h => h.to_status === 'ESCALATED' || h.to_status === 'ESCALED');
        if (escalateHist || r.escalated_at) {
            logs.push({
                _source: 'system_escalation',
                timestamp: escalateHist?.timestamp || r.escalated_at,
                content: escalateHist?.note || r.remarks || 'Grievance Escalated',
                fullMessage: r.escalation_message || '',
                operator: escalateHist?.changed_by || r.created_by,
                informed_to: r.informed_to
            });
        }

        return logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }, [r.complainant_logs, r.officer_logs, r.status_history, r.escalated_at, r.remarks, r.created_by, r.informed_to]);

    const colorMap = { yellow: { bg: 'bg-yellow-500', ring: 'ring-yellow-200', text: 'text-yellow-700', light: 'bg-yellow-50' }, orange: { bg: 'bg-orange-500', ring: 'ring-orange-200', text: 'text-orange-700', light: 'bg-orange-50' }, green: { bg: 'bg-green-500', ring: 'ring-green-200', text: 'text-green-700', light: 'bg-green-50' } };

    if (!report) return null;

    const printDate = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    return (
        <div className="space-y-6 pb-4">

            {/* ══════════════════════════════════════════════════ */}
            {/* PRINT-ONLY LETTERHEAD (hidden on screen)          */}
            {/* ══════════════════════════════════════════════════ */}
            <div className="gwr-print-letterhead hidden print:block">
                <div className="gwr-print-letterhead-top">
                    <div>
                        <div style={{ fontSize: '13pt', fontWeight: 700, letterSpacing: '0.04em' }}>Grievance Report</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-end' }}>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '18pt', fontWeight: 900, letterSpacing: '0.05em', fontFamily: 'monospace', color: '#fbbf24' }}>{r.unique_code || '—'}</div>
                            <div style={{ fontSize: '7pt', opacity: 0.7, marginTop: 2 }}>UNIQUE REPORT ID</div>
                        </div>
                        {r.post_link && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                <div style={{ background: '#ffffff', padding: '4px', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                                    <QRCodeSVG
                                        value={r.post_link}
                                        size={72}
                                        level="M"
                                        includeMargin={false}
                                        bgColor="#ffffff"
                                        fgColor="#1e293b"
                                    />
                                </div>
                                <div style={{ fontSize: '6pt', opacity: 0.7, textAlign: 'center' }}>Post QR</div>
                            </div>
                        )}
                        {(pdfUrl || r.report_pdf_url) ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                <div style={{ background: '#ffffff', padding: '4px', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                                    <QRCodeSVG
                                        value={pdfUrl || r.report_pdf_url}
                                        size={72}
                                        level="M"
                                        includeMargin={false}
                                        bgColor="#ffffff"
                                        fgColor="#1e293b"
                                    />
                                </div>
                                <div style={{ fontSize: '6pt', opacity: 0.6, textAlign: 'center' }}>Scan to download PDF</div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', width: '80px', height: '80px', border: '1px dashed #cbd5e1', borderRadius: '4px', opacity: 0.5 }}>
                                <div style={{ fontSize: '6pt', textAlign: 'center', color: '#64748b', lineHeight: 1.4 }}>Generate PDF to enable QR</div>
                            </div>
                        )}
                    </div>
                </div>
                <div className="gwr-print-letterhead-body">
                    <div className="gwr-print-letterhead-col">
                        <div className="gwr-print-letterhead-label">Status</div>
                        <div className="gwr-print-letterhead-value" style={{ color: r.status === 'CLOSED' ? '#16a34a' : r.status === 'ESCALATED' ? '#ea580c' : '#ca8a04' }}>{r.status || 'PENDING'}</div>
                    </div>
                    <div className="gwr-print-letterhead-col">
                        <div className="gwr-print-letterhead-label">Category</div>
                        <div className="gwr-print-letterhead-value">{r.category || 'Others'}</div>
                    </div>
                    <div className="gwr-print-letterhead-col">
                        <div className="gwr-print-letterhead-label">Platform</div>
                        <div className="gwr-print-letterhead-value">{r.platform ? r.platform.toUpperCase() : '—'}</div>
                    </div>
                    <div className="gwr-print-letterhead-col">
                        <div className="gwr-print-letterhead-label">Post Date</div>
                        <div className="gwr-print-letterhead-value">{r.post_date ? new Date(r.post_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</div>
                    </div>
                </div>
            </div>

            {/* ═══════ 1. HEADER (screen only) ═══════ */}
            <div className="flex items-center justify-between p-5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-xl text-white print:hidden">
                <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center">
                        <FileText className="h-6 w-6 text-amber-400" />
                    </div>
                    <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Grievance Unique ID</p>
                        <p className="text-lg font-bold font-mono tracking-wide text-amber-400">{r.unique_code || '—'}</p>
                    </div>
                    {(pdfUrl || r.report_pdf_url) ? (
                        <div className="flex flex-col items-center gap-1 ml-2">
                            <div className="bg-white p-1.5 rounded-lg shadow-sm">
                                <QRCodeSVG
                                    value={pdfUrl || r.report_pdf_url}
                                    size={52}
                                    level="M"
                                    includeMargin={false}
                                    bgColor="#ffffff"
                                    fgColor="#1e293b"
                                />
                            </div>
                            <span className="text-[9px] text-slate-400">PDF QR</span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-1 ml-2">
                            <div className="w-[52px] h-[52px] rounded-lg border border-dashed border-slate-600 flex items-center justify-center">
                                <span className="text-[7px] text-slate-500 text-center leading-tight px-1">Generate PDF for QR</span>
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <div className={cn("flex items-center gap-2 px-4 py-2 rounded-lg border", status.bg, status.border)}>
                        <StatusIcon className={cn("h-4 w-4", status.text)} />
                        <span className={cn("text-sm font-bold", status.text)}>{status.label}</span>
                    </div>
                    <Badge className="bg-white/10 text-white/70 border-white/20 text-[10px]">
                        Created {fmtRelativeTime(r.created_at)}
                    </Badge>
                    {/* Generate / Download PDF */}
                    {(pdfUrl || r.report_pdf_url) ? (
                        <a
                            href={pdfUrl || r.report_pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition-colors"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Download PDF
                        </a>
                    ) : null}
                    <button
                        onClick={handleGeneratePdf}
                        disabled={pdfGenerating}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-semibold transition-colors"
                    >
                        {pdfGenerating ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
                        ) : (
                            <><FileText className="h-3.5 w-3.5" /> {(pdfUrl || r.report_pdf_url) ? 'Regenerate PDF' : 'Generate PDF'}</>
                        )}
                    </button>
                </div>
            </div>

            {/* ═══════ 2. POST DETAILS TABLE ═══════ */}
            <div className="gwr-section-card rounded-xl border border-slate-200 overflow-hidden">
                <div className="gwr-section-header px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-slate-500 print:hidden" />
                    <span className="text-sm font-semibold text-slate-800">Post Details</span>
                </div>
                <div className="p-4">
                    <div className="flex gap-5">
                        {/* Table */}
                        <div className="flex-1">
                            <table className="gwr-detail-table w-full text-sm">
                                <tbody>
                                    <tr className="border-b border-slate-100">
                                        <td className="py-2.5 pr-4 text-slate-500 font-medium w-36 align-top">Platform</td>
                                        <td className="py-2.5 text-slate-900 font-semibold">
                                            <div className="flex items-center gap-2">
                                                <PlatformIcon className="h-4 w-4 text-slate-500" />
                                                {platformLabel}
                                            </div>
                                        </td>
                                    </tr>
                                    <tr className="border-b border-slate-100">
                                        <td className="py-2.5 pr-4 text-slate-500 font-medium align-top">Posted By</td>
                                        <td className="py-2.5 text-slate-900">
                                            <div className="flex items-center gap-2">
                                                {r.posted_by?.profile_image_url ? (
                                                    <img src={r.posted_by.profile_image_url} alt="" className="h-6 w-6 rounded-full ring-1 ring-slate-200" />
                                                ) : (
                                                    <div className="h-6 w-6 rounded-full bg-slate-200 flex items-center justify-center"><User className="h-3 w-3 text-slate-500" /></div>
                                                )}
                                                <span className="font-semibold">{r.posted_by?.display_name || '—'}</span>
                                                {r.posted_by?.handle && <span className="text-xs text-blue-600">@{r.posted_by.handle}</span>}
                                            </div>
                                        </td>
                                    </tr>
                                    <tr className="border-b border-slate-100">
                                        <td className="py-2.5 pr-4 text-slate-500 font-medium align-top">Posted Date & Time</td>
                                        <td className="py-2.5 text-slate-900 font-medium">{fmtDate(r.post_date)}</td>
                                    </tr>
                                    <tr className="border-b border-slate-100">
                                        <td className="py-2.5 pr-4 text-slate-500 font-medium align-top">Post Link</td>
                                        <td className="py-2.5">
                                            {r.post_link ? (
                                                <a href={r.post_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs break-all flex items-center gap-1">
                                                    {r.post_link}
                                                    <ExternalLink className="h-3 w-3 shrink-0" />
                                                </a>
                                            ) : <span className="text-slate-400">—</span>}
                                        </td>
                                    </tr>
                                    <tr className="border-b border-slate-100">
                                        <td className="py-2.5 pr-4 text-slate-500 font-medium align-top">Category</td>
                                        <td className="py-2.5"><Badge variant="outline" className="text-xs">{r.category || 'Others'}</Badge></td>
                                    </tr>
                                    <tr className="border-b border-slate-100">
                                        <td className="py-2.5 pr-4 text-slate-500 font-medium align-top">Complaint Phone</td>
                                        <td className="py-2.5 text-slate-900 font-mono">{r.complaint_phone || '—'}</td>
                                    </tr>
                                    <tr className="border-b border-slate-100">
                                        <td className="py-2.5 pr-4 text-slate-500 font-medium align-top">Informed To</td>
                                        <td className="py-2.5 text-slate-900">
                                            {r.informed_to?.name ? (
                                                <div>
                                                    <span className="font-semibold">{r.informed_to.name}</span>
                                                    {r.informed_to.phone && <span className="text-xs text-slate-500 ml-2">({r.informed_to.phone})</span>}
                                                    {r.informed_to.department && <span className="text-[10px] text-slate-400 ml-1">• {r.informed_to.department}</span>}
                                                </div>
                                            ) : <span className="text-slate-400">Not shared</span>}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* QR Code */}
                        {r.post_link && (
                            <div className="gwr-post-qr shrink-0 flex flex-col items-center gap-2 p-2 bg-white">
                                <div className="w-[136px] h-[136px] p-2 border border-slate-200 rounded-none shadow-sm flex items-center justify-center bg-white">
                                    <QRCodeSVG
                                        value={r.post_link}
                                        size={120}
                                        level="M"
                                        includeMargin={false}
                                        bgColor="#ffffff"
                                        fgColor="#1e293b"
                                    />
                                </div>
                                <p className="text-[9px] text-slate-400 text-center max-w-[120px] leading-tight">Scan to view original post</p>
                            </div>
                        )}
                    </div>

                    {/* Description */}
                    <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Post Description</p>
                        <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                            {r.content?.full_text || r.content?.text || 'No description provided'}
                        </div>
                    </div>

                    {/* Direct Media Preview */}
                    {mediaUrls.length > 0 && (
                        <div className="mt-4">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Image className="h-3 w-3" /> Post Media ({mediaUrls.length})
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                                {mediaUrls.map((url, i) => (
                                    <a
                                        key={i}
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group relative aspect-video rounded-xl border border-slate-200 overflow-hidden hover:border-amber-300 transition-colors"
                                    >
                                        {isVideo(url) ? (
                                            <div className="h-full w-full bg-slate-900 flex items-center justify-center">
                                                <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
                                                    <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[10px] border-l-white border-b-[6px] border-b-transparent ml-1" />
                                                </div>
                                            </div>
                                        ) : (
                                            <img src={url} alt={`Media ${i + 1}`} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={e => e.currentTarget.src = ''} />
                                        )}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}


                </div>
            </div>

            {/* ═══════ 3. STATUS TIMELINE ═══════ */}
            <div className="gwr-section-card rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/80 backdrop-blur-sm">
                    <div className="p-1.5 bg-blue-100/50 rounded-lg text-blue-600">
                        <Clock className="h-4 w-4" />
                    </div>
                    <div>
                        <span className="text-sm font-bold text-slate-800 block">Status Timeline</span>
                        <span className="text-[10px] text-slate-500 font-medium">Tracking the lifecycle of this grievance</span>
                    </div>
                </div>

                <div className="p-6 md:p-8">
                    <div className="flex flex-col">
                        {timelineSteps.map((step, idx) => {
                            const c = colorMap[step.color] || colorMap.yellow;
                            const isLast = idx === timelineSteps.length - 1;
                            const isActive = step.active;

                            return (
                                <div key={idx} className={cn("flex group", !isActive && "opacity-40")}>
                                    {/* Left: Time/Date Side */}
                                    <div className="w-24 md:w-32 pt-1 pr-4 text-right shrink-0">
                                        {step.date ? (
                                            <>
                                                <div className="text-[11px] font-bold text-slate-900 leading-tight">
                                                    {new Date(step.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                                </div>
                                                <div className="text-[10px] text-slate-400 font-medium">
                                                    {new Date(step.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-[10px] text-slate-300 italic">Pending</div>
                                        )}
                                    </div>

                                    {/* Center: Connector & Circle */}
                                    <div className="relative flex flex-col items-center shrink-0 w-10">
                                        <div className={cn(
                                            "z-10 h-8 w-8 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                                            isActive ? cn("bg-white shadow-md", `border-${step.color}-500`) : "bg-slate-50 border-slate-200"
                                        )}>
                                            {step.label === 'Pending' && <Plus className={cn("h-4 w-4", isActive ? `text-${step.color}-600` : "text-slate-300")} />}
                                            {step.label === 'Escalated' && <AlertCircle className={cn("h-4 w-4", isActive ? `text-${step.color}-600` : "text-slate-300")} />}
                                            {step.label === 'Closed' && <Check className={cn("h-4 w-4", isActive ? `text-${step.color}-600` : "text-slate-300")} />}
                                            {step.current && isActive && (
                                                <span className={cn("absolute inset-0 rounded-full animate-ping opacity-25", `bg-${step.color}-400`)} />
                                            )}
                                        </div>
                                        {!isLast && (
                                            <div className={cn(
                                                "w-0.5 grow my-1 rounded-full transition-colors duration-500",
                                                timelineSteps[idx + 1]?.active ? `bg-${step.color}-400` : "bg-slate-100"
                                            )} />
                                        )}
                                    </div>

                                    {/* Right: Content Side */}
                                    <div className={cn(
                                        "flex-1 ml-4 pb-8",
                                        isLast && "pb-0"
                                    )}>
                                        <div className="flex flex-wrap items-center gap-2 mb-1">
                                            <h4 className={cn(
                                                "text-sm font-bold tracking-tight uppercase",
                                                isActive ? "text-slate-900" : "text-slate-400"
                                            )}>
                                                {step.label}
                                            </h4>
                                            {isActive && step.duration && step.duration !== '—' && (
                                                <Badge variant="outline" className="h-5 px-1.5 py-0 text-[10px] font-bold border-slate-200 text-slate-500 bg-slate-50">
                                                    <Clock className="h-3 w-3 mr-1" />
                                                    {step.duration}
                                                </Badge>
                                            )}
                                        </div>

                                        <div className={cn(
                                            "relative p-3 rounded-xl border transition-all duration-300",
                                            isActive ? "bg-white border-slate-200 shadow-sm" : "bg-slate-50/50 border-slate-100"
                                        )}>
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-1.5 mb-1.5">
                                                        <User className="h-3 w-3 text-slate-400" />
                                                        <span className="text-[11px] font-semibold text-slate-700">{step.officer}</span>
                                                    </div>
                                                    {step.note && step.note !== '—' && (
                                                        <p className="text-xs text-slate-500 italic leading-snug">
                                                            "{step.note}"
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* ═══════ 4. CHAT HISTORY ═══════ */}
            <div className="gwr-section-card rounded-xl border border-slate-200 overflow-hidden">
                <div className="gwr-section-header px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-slate-500 print:hidden" />
                        <span className="text-sm font-semibold text-slate-800">Communication Log</span>
                        <Badge variant="outline" className="text-[9px] ml-1 print:hidden">{chatLogs.length} messages</Badge>
                        <span className="hidden print:inline text-[9pt] font-normal text-slate-500">({chatLogs.length} entries)</span>
                    </div>
                </div>
                <div className="gwr-chat-print bg-white divide-y divide-slate-100 min-h-[200px] max-h-[500px] overflow-y-auto print:max-h-none print:overflow-visible">
                    {chatLogs.length === 0 ? (
                        <div className="flex items-center justify-center h-[200px]">
                            <p className="text-slate-400 text-xs bg-slate-100 px-3 py-1 rounded-full">No communication entries yet</p>
                        </div>
                    ) : chatLogs.map((log, idx) => {
                        const isEscalation = log._source === 'system_escalation' || (log._source === 'officer' && log.is_escalation);
                        const isOfficerMsg = log._source === 'officer' && !isEscalation;
                        const isOperatorRemark = log._source === 'complainant' && log.type === 'OperatorRemark';
                        const isUserMsg = log._source === 'complainant' && log.type === 'User';

                        const complainantName = r.posted_by?.display_name || r.profile_id || 'Post Author';
                        const operatorName = resolveOperatorName(r, log.operator?.name || log.operator);
                        const officerName = log.recipient?.name || r.informed_to?.name || 'Officer';
                        const officerPhone = log.recipient?.phone || r.informed_to?.phone || '';

                        let stripBg, roleLabel, dirLabel;

                        if (isUserMsg) {
                            stripBg = 'bg-orange-500';
                            roleLabel = complainantName;
                            dirLabel = null;
                        } else if (isOperatorRemark) {
                            stripBg = 'bg-amber-500';
                            roleLabel = `Operator (${operatorName})`;
                            dirLabel = 'Internal Note';
                        } else if (isEscalation) {
                            stripBg = 'bg-red-600';
                            roleLabel = `Operator (${operatorName})`;
                            dirLabel = `Escalated → Officer (${officerName}${officerPhone ? ' · ' + officerPhone : ''})`;
                        } else if (isOfficerMsg) {
                            stripBg = 'bg-blue-600';
                            roleLabel = `Operator (${operatorName})`;
                            dirLabel = `→ Officer (${officerName}${officerPhone ? ' · ' + officerPhone : ''})`;
                        } else {
                            stripBg = 'bg-emerald-600';
                            roleLabel = `Operator (${operatorName})`;
                            dirLabel = `→ User (${complainantName})`;
                        }

                        const fullDate = log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit', hour12: true
                        }) : '';

                        return (
                            <div key={idx} className="bg-white pt-1.5 pb-1">
                                {/* Colored tag — left-aligned, content-width */}
                                <div className="flex items-center gap-2 px-3">
                                    <div className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm max-w-[85%]', stripBg)}>
                                        <span className="text-[10px] font-semibold truncate text-white">
                                            {roleLabel}
                                            {dirLabel && <span className="font-normal opacity-90"> {dirLabel}</span>}
                                        </span>
                                        {log.mode && (
                                            <span className="text-[8px] text-white/80 bg-white/20 border border-white/30 rounded px-1 py-px uppercase font-bold tracking-wider shrink-0">
                                                {log.mode}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[8px] text-slate-400 whitespace-nowrap shrink-0">{fullDate}</span>
                                </div>
                                {/* Message body */}
                                <div className="px-3 pt-1 pb-0.5">
                                    {log.replyTo && (
                                        <div className="text-[9px] text-slate-400 italic border-l-2 border-slate-300 pl-1.5 mb-1 truncate">
                                            ↩ {log.replyTo.content}
                                        </div>
                                    )}
                                    <p className="text-xs text-slate-800 whitespace-pre-wrap leading-snug">
                                        {log.fullMessage || log.content}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ═══════ OPERATOR NOTE ═══════ */}
            <div className="rounded-xl border border-amber-200 overflow-hidden bg-amber-50 print:hidden shadow-sm">
                <div className="px-4 py-2.5 border-b border-amber-200 flex items-center justify-between bg-white">
                    <div className="flex items-center gap-2">
                        <MessageSquare className="h-3.5 w-3.5 text-amber-600" />
                        <span className="text-xs font-bold text-amber-700">Operator Note</span>
                        <span className="text-[9px] text-amber-500 bg-amber-100 px-1.5 py-0.5 rounded font-medium uppercase tracking-wider">Internal</span>
                    </div>
                    {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />}
                </div>
                <div className="p-3 flex items-end gap-2">
                    <div className="flex-1 bg-white rounded-lg border border-amber-200 focus-within:ring-1 focus-within:ring-amber-300 px-3 py-2 min-h-[40px]">
                        <textarea
                            value={simMsg}
                            onChange={e => setSimMsg(e.target.value)}
                            placeholder="Add an internal operator note..."
                            className="w-full max-h-24 bg-transparent border-none focus:ring-0 text-sm p-0 resize-none leading-6 placeholder:text-amber-300 outline-none"
                            style={{ height: 'auto', minHeight: '24px' }}
                            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                            onKeyDown={async e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    if (!simMsg.trim() || submitting) return;
                                    setSubmitting(true);
                                    try {
                                        const res = await api.put(`/grievance-workflow/reports/${r.id}`, {
                                            complainant_logs: [...(r.complainant_logs || []), {
                                                mode: 'INTERNAL', type: 'OperatorRemark', content: simMsg.trim(), timestamp: new Date()
                                            }]
                                        });
                                        if (res.data) { onUpdate?.(res.data); setSimMsg(''); toast.success('Note added'); }
                                    } catch { toast.error('Failed to add note'); }
                                    finally { setSubmitting(false); }
                                }
                            }}
                        />
                    </div>
                    <button
                        className="h-10 w-10 flex items-center justify-center rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-sm shrink-0 transition-all active:scale-95 disabled:opacity-50"
                        disabled={submitting || !simMsg.trim()}
                        onClick={async () => {
                            if (!simMsg.trim() || submitting) return;
                            setSubmitting(true);
                            try {
                                const res = await api.put(`/grievance-workflow/reports/${r.id}`, {
                                    complainant_logs: [...(r.complainant_logs || []), {
                                        mode: 'INTERNAL', type: 'OperatorRemark', content: simMsg.trim(), timestamp: new Date()
                                    }]
                                });
                                if (res.data) { onUpdate?.(res.data); setSimMsg(''); toast.success('Note added'); }
                            } catch { toast.error('Failed to add note'); }
                            finally { setSubmitting(false); }
                        }}
                    >
                        <Send className="h-4 w-4 ml-0.5" />
                    </button>
                </div>
            </div>

            {/* ═══════ 5. CLOSING DETAILS (if closed) ═══════ */}
            {(r.closing_remarks || r.final_reply_to_user || firInfo.converted || firInfo.firNumber || closingMediaUrls.length > 0) && (
                <div className="gwr-section-card rounded-xl border border-slate-200 overflow-hidden">
                    <div className="gwr-section-header px-4 py-3 bg-green-50 border-b border-green-200 flex items-center gap-2">
                        <CircleCheck className="h-4 w-4 text-green-600 print:hidden" />
                        <span className="text-sm font-semibold text-green-800">Closing Details</span>
                    </div>
                    <div className="p-4 space-y-3">
                        {r.closing_remarks && (
                            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Closing Remarks</p>
                                <p className="text-sm text-slate-800 whitespace-pre-wrap">{r.closing_remarks}</p>
                            </div>
                        )}
                        {r.final_reply_to_user && (
                            <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                                <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1">Final Reply to User</p>
                                <p className="text-sm text-emerald-900 whitespace-pre-wrap">{r.final_reply_to_user}</p>
                            </div>
                        )}
                        {(firInfo.converted || firInfo.firNumber) && (
                            <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                                <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider mb-1">Converted to FIR</p>
                                <p className="text-sm text-red-900 font-semibold">{firInfo.converted || 'Yes'}</p>
                                {firInfo.converted === 'Yes' && firInfo.firNumber && (
                                    <p className="text-xs text-red-800 mt-1">FIR Number: {firInfo.firNumber}</p>
                                )}
                            </div>
                        )}
                        {closingMediaUrls.length > 0 && (
                            <div>
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Closing Attachment Media ({closingMediaUrls.length})</p>
                                <div className="flex gap-2 overflow-x-auto pb-2 print:flex-wrap print:overflow-visible">
                                    {closingMediaUrls.map((url, i) => (
                                        <div key={i} className="shrink-0 w-28 h-20 rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                                            {isVideo(url) ? (
                                                <video src={url} className="h-full w-full object-cover bg-black" preload="metadata" />
                                            ) : (
                                                <img src={url} alt={`Closing ${i + 1}`} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={e => e.currentTarget.src = ''} />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

        </div>
    );
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*            GRIEVANCE WORKFLOW REPORTS TABLE                      */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export const GrievanceWorkflowReports = ({ externalStatusFilter = 'all', onStatsUpdate, openReportCode = '', onReportCodeHandled }) => {
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [platform, setPlatform] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [quickRange, setQuickRange] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ total: 0, pages: 1 });
    const [stats, setStats] = useState({ total: 0, pending: 0, escalated: 0, closed: 0, fir: 0 });
    const [selectedReport, setSelectedReport] = useState(null);
    const [waPhone, setWaPhone] = useState('');
    const [copied, setCopied] = useState(false);
    const detailPopupRef = useRef(null);
    const printComponentRef = useRef(null);
    const [detailPos, setDetailPos] = useState({
        x: Math.max(24, window.innerWidth / 2 - 480),
        y: 40
    });
    const [draggingDetail, setDraggingDetail] = useState(false);
    const [detailDragOffset, setDetailDragOffset] = useState({ x: 0, y: 0 });
    const [fullscreen, setFullscreen] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'post_date', direction: 'desc' });
    const [activeTab, setActiveTab] = useState('details');
    const [previewMedia, setPreviewMedia] = useState(null);

    useEffect(() => {
        if (!externalStatusFilter) return;
        const normalized = String(externalStatusFilter).trim().toUpperCase();
        const allowed = new Set(['ALL', 'PENDING', 'ESCALATED', 'CLOSED', 'FIR']);
        const next = allowed.has(normalized) ? normalized : 'ALL';
        const nextValue = next.toLowerCase() === 'all' ? 'all' : next;

        // Only update if different and not just a mount-time default reset
        setStatusFilter((prev) => {
            if (prev === nextValue) return prev;
            return nextValue;
        });
        setPage(1);
    }, [externalStatusFilter]);

    useEffect(() => {
        if (quickRange === 'all') {
            setFromDate('');
            setToDate('');
            return;
        }
        if (quickRange === 'custom') return;

        const end = new Date();
        const start = new Date();

        if (quickRange === '24h') {
            start.setDate(start.getDate() - 1);
        } else if (quickRange === '7d') {
            start.setDate(start.getDate() - 7);
        } else if (quickRange === '30d') {
            start.setDate(start.getDate() - 30);
        } else if (quickRange === 'last_month') {
            start.setMonth(start.getMonth() - 1);
            start.setDate(1);
            end.setDate(0); // Last day of previous month
        }

        const fmt = (d) => {
            const yr = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const da = String(d.getDate()).padStart(2, '0');
            return `${yr}-${mo}-${da}`;
        };

        setFromDate(fmt(start));
        setToDate(fmt(end));
        setPage(1);
    }, [quickRange]);

    const fetchReports = useCallback(async () => {
        setLoading(true);
        try {
            const params = {
                page,
                limit: 50,
                sort: sortConfig.key,
                order: sortConfig.direction
            };
            if (platform !== 'all') params.platform = platform;
            if (statusFilter !== 'all') params.status = statusFilter;
            if (categoryFilter !== 'all') params.category = categoryFilter;
            if (fromDate) params.from = fromDate;
            if (toDate) params.to = toDate;
            if (searchTerm) params.search = searchTerm;

            console.log('[fetchReports] Sending params:', params);

            const res = await api.get('/grievance-workflow/reports', { params });
            setReports(res.data?.reports || []);
            setPagination(res.data?.pagination || { total: 0, pages: 1 });
            if (res.data?.stats) {
                setStats(res.data.stats);
                onStatsUpdate?.(res.data.stats);
            }
        } catch {
            toast.error('Failed to load grievance reports', {
                description: 'Please check your connection and try again',
                action: { label: 'Retry', onClick: fetchReports }
            });
        }
        finally { setLoading(false); }
    }, [page, platform, statusFilter, categoryFilter, fromDate, toDate, searchTerm, sortConfig]);

    useEffect(() => { fetchReports(); }, [fetchReports]);

    useEffect(() => {
        const code = String(openReportCode || '').trim();
        if (!code) return;
        setPlatform('all');
        setStatusFilter('all');
        setPage(1);
        setSearchTerm(code);
    }, [openReportCode]);

    useEffect(() => {
        const code = String(openReportCode || '').trim().toUpperCase();
        if (!code || loading) return;
        const match = reports.find((item) => String(item.unique_code || '').trim().toUpperCase() === code);
        if (!match) return;
        setSelectedReport(match);
        setWaPhone(match.informed_to?.phone || match.complaint_phone || '');
        onReportCodeHandled?.(match.unique_code || code);
    }, [openReportCode, reports, loading, onReportCodeHandled]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const params = {};
            if (platform !== 'all') params.platform = platform;
            if (statusFilter !== 'all') params.status = statusFilter;
            if (categoryFilter !== 'all') params.category = categoryFilter;
            if (fromDate) params.from = fromDate;
            if (toDate) params.to = toDate;
            if (searchTerm) params.search = searchTerm;

            const res = await api.get('/grievance-workflow/reports/export', {
                params,
                responseType: 'blob'
            });

            const blob = new Blob([res.data], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `grievance_workflow_${new Date().toISOString().slice(0, 10)}.xlsx`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            toast.success('Excel report downloaded successfully', {
                description: `${pagination.total} reports exported`
            });
        } catch {
            toast.error('Failed to export reports');
        }
        finally { setExporting(false); }
    };

    const buildShareMessage = useCallback((r) => {
        if (!r) return '';
        return [
            `📋 *GRIEVANCE REPORT: ${r.unique_code || ''}*`,
            ``,
            `📊 *Status:* ${r.status || 'PENDING'}`,
            `📅 *Post Date:* ${fmtDate(r.post_date)}`,
            `👤 *Profile:* ${r.profile_id || r.posted_by?.handle || 'N/A'}`,
            `📞 *Complaint Phone:* ${r.complaint_phone || 'N/A'}`,
            `🏷️ *Category:* ${r.category || 'Others'}`,
            `🔗 *Post Link:* ${r.post_link || 'N/A'}`,
            ``,
            `📝 *Description:*`,
            `${r.post_description || ''}`,
            ``,
            ` *Final Communication:*`,
            `${r.final_communication || ''}`,
            ``,
            `_Shared via Grievance Management System_`
        ].join('\n');
    }, []);

    const handleShareViaWhatsApp = () => {
        if (!selectedReport) return;
        const phone = String(waPhone || '').replace(/[^0-9]/g, '');
        if (!phone) {
            toast.error('Please enter a WhatsApp number');
            return;
        }
        const message = buildShareMessage(selectedReport);
        const phoneWithCountry = phone.startsWith('91') ? phone : `91${phone}`;

        navigator.clipboard.writeText(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);

        toast.success('Details copied to clipboard', {
            description: 'Opening WhatsApp...'
        });

        window.open(`https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`, '_blank');
    };

    const handleCopyToClipboard = () => {
        if (!selectedReport) return;
        const message = buildShareMessage(selectedReport);
        navigator.clipboard.writeText(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success('Copied to clipboard');
    };

    const handlePrintPdf = useReactToPrint({
        contentRef: printComponentRef,
        documentTitle: `Grievance Report - ${selectedReport?.unique_code || 'Detail'}`,
        pageStyle: `
            @page {
                size: A4;
                margin: 18mm 20mm 22mm 20mm;
            }
            @page :first {
                margin-top: 14mm;
            }
            @media print {
                * {
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                    box-shadow: none !important;
                    text-shadow: none !important;
                }
                body {
                    font-family: 'Segoe UI', Arial, sans-serif;
                    font-size: 10.5pt;
                    color: #111;
                    background: #fff !important;
                    line-height: 1.5;
                }
                /* ── Letterhead ── */
                .gwr-print-letterhead {
                    display: block !important;
                    border: 2px solid #1e293b;
                    padding: 0;
                    margin-bottom: 18px;
                    page-break-inside: avoid;
                }
                .gwr-print-letterhead-top {
                    background: #1e293b !important;
                    color: #fff !important;
                    padding: 10px 16px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .gwr-print-letterhead-body {
                    padding: 8px 16px;
                    display: flex;
                    align-items: stretch;
                    gap: 0;
                }
                .gwr-print-letterhead-col {
                    flex: 1;
                    padding: 4px 12px 4px 0;
                }
                .gwr-print-letterhead-col + .gwr-print-letterhead-col {
                    border-left: 1px solid #cbd5e1;
                    padding-left: 12px;
                }
                .gwr-print-letterhead-label {
                    font-size: 7.5pt;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    color: #64748b;
                    font-weight: 600;
                    margin-bottom: 1px;
                }
                .gwr-print-letterhead-value {
                    font-size: 10.5pt;
                    color: #0f172a;
                    font-weight: 700;
                }
                /* ── Section headers ── */
                .gwr-section-header {
                    background: #f1f5f9 !important;
                    color: #1e293b !important;
                    border-bottom: 1.5px solid #cbd5e1 !important;
                    padding: 6px 14px !important;
                    font-size: 9pt;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                /* ── Cards / section wrappers ── */
                .gwr-section-card {
                    border: 1.5px solid #cbd5e1 !important;
                    border-radius: 0 !important;
                    margin-bottom: 14px !important;
                    page-break-inside: avoid;
                    overflow: visible !important;
                }
                /* ── Tables ── */
                .gwr-detail-table td {
                    padding: 5px 10px 5px 0;
                    font-size: 10pt;
                    border-bottom: 0.5px solid #e2e8f0;
                    vertical-align: top;
                }
                .gwr-detail-table td:first-child {
                    color: #475569;
                    font-weight: 600;
                    white-space: nowrap;
                    min-width: 130px;
                }
                /* ── Timeline: convert to a horizontal row ── */
                .gwr-timeline-print {
                    display: flex !important;
                    gap: 0 !important;
                    page-break-inside: avoid;
                }
                /* ── Chat history ── */
                .gwr-chat-print {
                    background: #fff !important;
                    max-height: none !important;
                    overflow: visible !important;
                    border: none !important;
                }
                .gwr-chat-print-entry {
                    border: 1px solid #e2e8f0 !important;
                    border-radius: 0 !important;
                    background: #fff !important;
                    margin-bottom: 6px !important;
                    padding: 6px 10px !important;
                }
                /* ── Footer ── */
                .gwr-print-footer {
                    display: block !important;
                    border-top: 1.5px solid #1e293b;
                    margin-top: 20px;
                    padding-top: 8px;
                    font-size: 8pt;
                    color: #475569;
                    display: flex;
                    justify-content: space-between;
                }
                /* ── Misc ── */
                .gwr-screen-only { display: none !important; }
                .gwr-print-letterhead svg,
                .gwr-post-qr svg { display: block !important; }
                a { color: #0f172a !important; text-decoration: underline !important; }
                .rounded-xl, .rounded-lg, .rounded-full, .rounded { border-radius: 0 !important; }
            }
        `
    });

    const handleSort = (key) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    useEffect(() => {
        if (!selectedReport) return;
        setDetailPos({
            x: Math.max(24, window.innerWidth / 2 - 480),
            y: 40
        });
    }, [selectedReport]);

    useEffect(() => {
        if (!selectedReport) {
            setPreviewMedia(null);
        }
    }, [selectedReport]);

    useEffect(() => {
        if (!draggingDetail || fullscreen) return;
        const onMove = (e) => {
            setDetailPos({
                x: Math.max(12, Math.min(e.clientX - detailDragOffset.x, window.innerWidth - 860)),
                y: Math.max(12, Math.min(e.clientY - detailDragOffset.y, window.innerHeight - 120))
            });
        };
        const onUp = () => setDraggingDetail(false);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [draggingDetail, detailDragOffset, fullscreen]);

    const SortIcon = ({ column }) => (
        <ArrowUpDown className={cn(
            "h-3.5 w-3.5 ml-1 transition-opacity",
            sortConfig.key === column ? "opacity-100" : "opacity-30"
        )} />
    );

    const getPlatformIcon = (platform) => {
        const Icon = platformIcons[platform?.toLowerCase()] || platformIcons.default;
        return Icon;
    };

    return (
        <TooltipProvider>
            <div className="space-y-4">
                {/* Header Section */}
                <Card className="border-slate-200 rounded-xl bg-white overflow-hidden">

                    {/* ── Header Row ── */}
                    <CardHeader className="py-3 px-5 border-b border-slate-200 bg-white">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-lg bg-amber-500 flex items-center justify-center shadow-sm">
                                    <FileSpreadsheet className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg font-semibold text-slate-900">
                                        Grievance Workflow Reports
                                    </CardTitle>
                                    <CardDescription className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                                        <span>{pagination.total} records</span>
                                        {(searchTerm || platform !== 'all' || statusFilter !== 'all' || categoryFilter !== 'all' || fromDate || toDate) && (
                                            <>
                                                <span className="w-1 h-1 rounded-full bg-amber-400" />
                                                <span className="text-amber-600 font-medium">Filtered</span>
                                            </>
                                        )}
                                    </CardDescription>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={fetchReports}
                                    className="gap-1.5 h-8 text-xs border-slate-200 hover:bg-slate-50"
                                >
                                    <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                                    Refresh
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleExport}
                                    disabled={exporting || reports.length === 0}
                                    className="gap-1.5 h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                                >
                                    {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                                    Export Excel
                                </Button>
                            </div>
                        </div>
                    </CardHeader>

                    {/* ── Excel-Style Filter Strip ── */}
                    <div className="bg-slate-50/80 border-b border-slate-200 px-5 py-3">
                        <div className="flex items-center gap-2 mb-2">
                            <Filter className="h-3.5 w-3.5 text-slate-500" />
                            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Filters</span>
                            {(searchTerm || platform !== 'all' || statusFilter !== 'all' || categoryFilter !== 'all' || fromDate || toDate || quickRange !== 'all') && (
                                <>
                                    <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                                        {[searchTerm, platform !== 'all', statusFilter !== 'all', categoryFilter !== 'all', fromDate, toDate, quickRange !== 'all' && quickRange !== 'custom'].filter(Boolean).length}
                                    </span>
                                    <button
                                        onClick={() => { setSearchTerm(''); setPlatform('all'); setStatusFilter('all'); setCategoryFilter('all'); setFromDate(''); setToDate(''); setQuickRange('all'); setPage(1); }}
                                        className="ml-auto text-xs text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1 transition-colors"
                                    >
                                        <X className="h-3 w-3" />
                                        Clear All
                                    </button>
                                </>
                            )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
                            {/* Search */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Search</label>
                                <div className="relative">
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                                    <Input
                                        placeholder="Code, name, desc..."
                                        value={searchTerm}
                                        onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                                        className="pl-7 h-8 text-xs bg-white border-slate-200 focus:border-amber-400 focus:ring-amber-200 rounded-md"
                                    />
                                </div>
                            </div>
                            {/* Date Range */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Date Range</label>
                                <Select value={quickRange} onValueChange={(v) => { setQuickRange(v); setPage(1); }}>
                                    <SelectTrigger className="h-8 text-xs border-slate-200 bg-white focus:border-amber-400 focus:ring-amber-200 rounded-md">
                                        <SelectValue placeholder="All Time" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Time</SelectItem>
                                        <SelectItem value="24h">Last 24 Hours</SelectItem>
                                        <SelectItem value="7d">Last 7 Days</SelectItem>
                                        <SelectItem value="30d">Last 30 Days</SelectItem>
                                        <SelectItem value="last_month">Last Month</SelectItem>
                                        <SelectItem value="custom">Custom</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {/* Date From */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">From Date</label>
                                <div className="relative">
                                    <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                                    <input
                                        type="date"
                                        value={fromDate}
                                        onChange={(e) => { setFromDate(e.target.value); setQuickRange('custom'); setPage(1); }}
                                        className="w-full h-8 pl-7 pr-2 text-xs bg-white border border-slate-200 rounded-md outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200 transition-colors"
                                    />
                                </div>
                            </div>
                            {/* Date To */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">To Date</label>
                                <div className="relative">
                                    <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                                    <input
                                        type="date"
                                        value={toDate}
                                        onChange={(e) => { setToDate(e.target.value); setQuickRange('custom'); setPage(1); }}
                                        className="w-full h-8 pl-7 pr-2 text-xs bg-white border border-slate-200 rounded-md outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200 transition-colors"
                                    />
                                </div>
                            </div>
                            {/* Category */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Category</label>
                                <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(1); }}>
                                    <SelectTrigger className="h-8 text-xs border-slate-200 bg-white focus:border-amber-400 focus:ring-amber-200 rounded-md">
                                        <SelectValue placeholder="All" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Categories</SelectItem>
                                        <SelectItem value="Cyber crimes">Cyber crimes</SelectItem>
                                        <SelectItem value="E-Challan">E-Challan</SelectItem>
                                        <SelectItem value="L&O">L&O</SelectItem>
                                        <SelectItem value="Others">Others</SelectItem>
                                        <SelectItem value="Query">Query</SelectItem>
                                        <SelectItem value="She Team">She Team</SelectItem>
                                        <SelectItem value="Task force">Task force</SelectItem>
                                        <SelectItem value="Traffic">Traffic</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {/* Platform */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Platform</label>
                                <Select value={platform} onValueChange={(v) => { setPlatform(v); setPage(1); }}>
                                    <SelectTrigger className="h-8 text-xs border-slate-200 bg-white focus:border-amber-400 focus:ring-amber-200 rounded-md">
                                        <SelectValue placeholder="All" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Platforms</SelectItem>
                                        <SelectItem value="x">X (Twitter)</SelectItem>
                                        <SelectItem value="facebook">Facebook</SelectItem>
                                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {/* Status */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</label>
                                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                                    <SelectTrigger className="h-8 text-xs border-slate-200 bg-white focus:border-amber-400 focus:ring-amber-200 rounded-md">
                                        <SelectValue placeholder="All" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Status</SelectItem>
                                        <SelectItem value="PENDING">Pending</SelectItem>
                                        <SelectItem value="ESCALATED">Escalated</SelectItem>
                                        <SelectItem value="CLOSED">Closed</SelectItem>
                                        <SelectItem value="FIR">Converted to FIR</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* ── Results Count Banner ── */}
                        {(searchTerm || platform !== 'all' || statusFilter !== 'all' || categoryFilter !== 'all' || fromDate || toDate || quickRange !== 'all') && (
                            <div className="mt-3 flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
                                {loading ? (
                                    <Loader2 className="h-5 w-5 text-amber-500 animate-spin flex-shrink-0" />
                                ) : (
                                    <div className="h-5 w-5 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
                                        <Check className="h-3 w-3 text-white" />
                                    </div>
                                )}
                                <div>
                                    <span className="text-2xl font-bold text-amber-700">{loading ? '...' : pagination.total}</span>
                                    <span className="ml-2 text-base font-medium text-amber-600">
                                        {pagination.total === 1 ? 'result found' : 'results found'} for your filter
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-5 gap-3 p-4 bg-white border-b border-slate-100">
                        <div
                            className={cn(
                                "bg-white rounded-lg p-3 border transition-all cursor-pointer hover:bg-slate-50",
                                statusFilter === 'all' ? "border-blue-500 ring-1 ring-blue-500/20" : "border-slate-200"
                            )}
                            onClick={() => { setStatusFilter('all'); setPage(1); }}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-slate-500">Total Reports</p>
                                    <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
                                </div>
                                <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
                                    <FileText className="h-5 w-5 text-blue-600" />
                                </div>
                            </div>
                        </div>

                        <div
                            className={cn(
                                "bg-white rounded-lg p-3 border transition-all cursor-pointer hover:bg-slate-50",
                                statusFilter === 'PENDING' ? "border-yellow-500 ring-1 ring-yellow-500/20" : "border-slate-200"
                            )}
                            onClick={() => { setStatusFilter('PENDING'); setPage(1); }}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-slate-500">Pending</p>
                                    <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
                                </div>
                                <div className="h-10 w-10 rounded-lg bg-yellow-50 flex items-center justify-center">
                                    <Clock className="h-5 w-5 text-yellow-600" />
                                </div>
                            </div>
                        </div>

                        <div
                            className={cn(
                                "bg-white rounded-lg p-3 border transition-all cursor-pointer hover:bg-slate-50",
                                statusFilter === 'ESCALATED' ? "border-orange-500 ring-1 ring-orange-500/20" : "border-slate-200"
                            )}
                            onClick={() => { setStatusFilter('ESCALATED'); setPage(1); }}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-slate-500">Escalated</p>
                                    <p className="text-2xl font-bold text-orange-600">{stats.escalated}</p>
                                </div>
                                <div className="h-10 w-10 rounded-lg bg-orange-50 flex items-center justify-center">
                                    <AlertCircle className="h-5 w-5 text-orange-600" />
                                </div>
                            </div>
                        </div>

                        <div
                            className={cn(
                                "bg-white rounded-lg p-3 border transition-all cursor-pointer hover:bg-slate-50",
                                statusFilter === 'CLOSED' ? "border-green-500 ring-1 ring-green-500/20" : "border-slate-200"
                            )}
                            onClick={() => { setStatusFilter('CLOSED'); setPage(1); }}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-slate-500">Closed</p>
                                    <p className="text-2xl font-bold text-green-600">{stats.closed}</p>
                                </div>
                                <div className="h-10 w-10 rounded-lg bg-green-50 flex items-center justify-center">
                                    <Check className="h-5 w-5 text-green-600" />
                                </div>
                            </div>
                        </div>

                        <div
                            className={cn(
                                "bg-white rounded-lg p-3 border transition-all cursor-pointer hover:bg-slate-50",
                                statusFilter === 'FIR' ? "border-red-500 ring-1 ring-red-500/20" : "border-slate-200"
                            )}
                            onClick={() => { setStatusFilter('FIR'); setPage(1); }}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-slate-500">FIR</p>
                                    <p className="text-2xl font-bold text-red-600">{stats.fir}</p>
                                </div>
                                <div className="h-10 w-10 rounded-lg bg-red-50 flex items-center justify-center">
                                    <Shield className="h-5 w-5 text-red-600" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Main Table */}
                    <CardContent className="p-0">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-20">
                                <div className="relative">
                                    <div className="h-16 w-16 rounded-full border-4 border-slate-100 border-t-amber-500 animate-spin" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <FileSpreadsheet className="h-6 w-6 text-slate-400" />
                                    </div>
                                </div>
                                <p className="mt-4 text-sm text-slate-500">Loading grievance reports...</p>
                            </div>
                        ) : reports.length === 0 ? (
                            <div className="text-center py-20 px-4">
                                <div className="h-20 w-20 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
                                    <FileSpreadsheet className="h-10 w-10 text-amber-400" />
                                </div>
                                <h3 className="text-lg font-semibold text-slate-900 mb-2">No reports yet</h3>
                                <p className="text-sm text-slate-500 max-w-md mx-auto">
                                    No grievance workflow reports found. Use the <span className="font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">G</span> button on grievance cards to create new reports.
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="overflow-auto max-h-[60vh] relative">
                                    <table className="w-full text-sm min-w-[2200px]">
                                        <thead className="bg-slate-50 sticky top-0 z-20">
                                            <tr className="border-b border-slate-200">
                                                {[
                                                    { key: 'si_no', label: 'Sl.No', width: 'w-16' },
                                                    { key: 'status', label: 'Status', width: 'w-28', sortable: true },
                                                    { key: 'unique_id', label: 'Unique ID', width: 'w-32' },
                                                    { key: 'post_date', label: 'Post Date', width: 'w-32', sortable: true },
                                                    { key: 'phone', label: 'Phone', width: 'w-28' },
                                                    { key: 'profile', label: 'Profile', width: 'w-44' },
                                                    { key: 'post_link', label: 'Link', width: 'w-16' },
                                                    { key: 'description', label: 'Description', width: 'min-w-[180px]' },
                                                    { key: 'category', label: 'Category', width: 'w-24', sortable: true },
                                                    { key: 'chat_history', label: 'Communication', width: 'min-w-[200px]' },
                                                    { key: 'operator_remarks', label: 'Remarks', width: 'min-w-[150px]' },
                                                    { key: 'informed_to', label: 'Informed to Officer', width: 'min-w-[150px]' },
                                                    { key: 'escalated_remarks', label: 'Escalated Remarks', width: 'min-w-[160px]' },
                                                    { key: 'escalated_to_officer_time', label: 'Escalated to Officer', width: 'w-36' },
                                                    { key: 'closing_remarks', label: 'Closing Remarks', width: 'min-w-[160px]' },
                                                    { key: 'fir_number', label: 'FIR Number', width: 'w-28' },
                                                ].map((col) => (
                                                    <th
                                                        key={col.key}
                                                        className={cn(
                                                            "text-left py-3 px-3 font-semibold text-slate-700 text-xs",
                                                            col.width,
                                                            col.sortable && "cursor-pointer hover:bg-slate-100 transition-colors"
                                                        )}
                                                        onClick={() => col.sortable && handleSort(col.key)}
                                                    >
                                                        <div className="flex items-center">
                                                            {col.label}
                                                            {col.sortable && <SortIcon column={col.key} />}
                                                        </div>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {reports.map((r, idx) => {
                                                const mediaUrls = (Array.isArray(r.media_s3_urls) && r.media_s3_urls.length > 0 ? r.media_s3_urls : r.media_urls || []);
                                                const status = statusConfig[r.status] || statusConfig.PENDING;
                                                const StatusIcon = status.icon;
                                                const PlatformIcon = getPlatformIcon(r.platform);
                                                const firInfo = parseFirFields(r);

                                                // Escalation logs
                                                const escalationLogs = (r.officer_logs || []).filter(l => l.is_escalation === true);
                                                const firstEscalation = escalationLogs[0];

                                                // Operator remarks
                                                const operatorRemarks = (r.complainant_logs || []).filter(l => l.type === 'OperatorRemark');

                                                // First officer log timestamp (for informed_to time)
                                                const firstOfficerLog = (r.officer_logs || []).find(l => !l.is_escalation);

                                                return (
                                                    <motion.tr
                                                        key={r.id}
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: idx * 0.02 }}
                                                        className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors group"
                                                    >
                                                        {/* 1. Sl.No + Eye */}
                                                        <td className="py-2.5 px-3">
                                                            <div className="flex flex-col items-center gap-1">
                                                                <span className="text-slate-400 font-mono text-xs">
                                                                    {(page - 1) * 50 + idx + 1}
                                                                </span>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            className="h-6 w-6 p-0 rounded-full hover:bg-violet-100"
                                                                            onClick={() => {
                                                                                setSelectedReport(r);
                                                                                setWaPhone(r.informed_to?.phone || r.complaint_phone || '');
                                                                                setActiveTab('details');
                                                                            }}
                                                                        >
                                                                            <Eye className="h-3.5 w-3.5 text-violet-600" />
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent><p className="text-xs">View Details</p></TooltipContent>
                                                                </Tooltip>
                                                            </div>
                                                        </td>

                                                        {/* 2. Status */}
                                                        <td className="py-2.5 px-3">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className={cn("w-1.5 h-1.5 rounded-full", status.dot)} />
                                                                <Badge variant="outline" className={cn('text-[9px] font-medium px-2 py-0.5', status.bg, status.text, status.border)}>
                                                                    {status.label}
                                                                </Badge>
                                                            </div>
                                                        </td>

                                                        {/* 3. Unique ID */}
                                                        <td className="py-2.5 px-3">
                                                            <Badge
                                                                variant="outline"
                                                                className="text-[9px] font-mono bg-amber-50 text-amber-700 border-amber-200 cursor-pointer hover:bg-amber-100 hover:border-amber-300 transition-colors"
                                                                onClick={() => {
                                                                    setSelectedReport(r);
                                                                    setWaPhone(r.informed_to?.phone || r.complaint_phone || '');
                                                                }}
                                                            >
                                                                {r.unique_code}
                                                            </Badge>
                                                        </td>

                                                        {/* 4. Post Date */}
                                                        <td className="py-2.5 px-3">
                                                            <div className="flex flex-col">
                                                                <span className="text-slate-900 font-medium text-xs">{fmtDate(r.post_date)}</span>
                                                                <span className="text-[9px] text-slate-400">{fmtRelativeTime(r.post_date)}</span>
                                                            </div>
                                                        </td>

                                                        {/* 5. Phone */}
                                                        <td className="py-2.5 px-3">
                                                            {r.complaint_phone ? (
                                                                <div className="flex items-center gap-1">
                                                                    <Phone className="h-3 w-3 text-slate-400" />
                                                                    <span className="text-xs font-mono text-slate-700">{r.complaint_phone}</span>
                                                                </div>
                                                            ) : <span className="text-slate-400 text-xs">—</span>}
                                                        </td>

                                                        {/* 6. Profile */}
                                                        <td className="py-2.5 px-3">
                                                            <div className="flex items-center gap-2">
                                                                <div className="relative">
                                                                    {r.posted_by?.profile_image_url ? (
                                                                        <img src={r.posted_by.profile_image_url} alt="" className="h-7 w-7 rounded-full ring-2 ring-white" />
                                                                    ) : (
                                                                        <div className="h-7 w-7 rounded-full bg-slate-200 flex items-center justify-center">
                                                                            <Users className="h-3.5 w-3.5 text-slate-500" />
                                                                        </div>
                                                                    )}
                                                                    <div className="absolute -bottom-1 -right-1">
                                                                        <PlatformIcon className="h-3 w-3 text-slate-500 bg-white rounded-full p-0.5" />
                                                                    </div>
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="font-medium text-slate-900 truncate max-w-[120px] text-xs">{r.posted_by?.display_name || '—'}</p>
                                                                    {r.profile_link && (
                                                                        <a href={r.profile_link} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-600 hover:underline truncate block max-w-[120px]">
                                                                            @{r.profile_id || 'view'}
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>

                                                        {/* 7. Link */}
                                                        <td className="py-2.5 px-3">
                                                            {r.post_link ? (
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <a href={r.post_link} target="_blank" rel="noopener noreferrer"
                                                                            className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">
                                                                            <ExternalLink className="h-3 w-3" />
                                                                        </a>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent><p className="text-xs">View Post</p></TooltipContent>
                                                                </Tooltip>
                                                            ) : <span className="text-slate-300 text-xs">—</span>}
                                                        </td>

                                                        {/* 8. Description */}
                                                        <td className="py-2.5 px-3">
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <p className="text-slate-700 line-clamp-2 text-xs cursor-help">{r.post_description || '—'}</p>
                                                                </TooltipTrigger>
                                                                {r.post_description && (
                                                                    <TooltipContent side="right" className="max-w-xs"><p className="text-xs">{r.post_description}</p></TooltipContent>
                                                                )}
                                                            </Tooltip>
                                                        </td>

                                                        {/* 9. Category */}
                                                        <td className="py-2.5 px-3">
                                                            <Badge variant="outline" className="text-[9px] font-medium px-2 py-0.5 bg-slate-50">
                                                                {r.category || '—'}
                                                            </Badge>
                                                        </td>

                                                        {/* 10. Communication */}
                                                        <td className="py-2.5 px-3 relative">
                                                            {(r.status === 'ESCALATED' || r.status === 'CLOSED') && (
                                                                <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                                                                    <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", r.status === 'ESCALATED' ? "bg-orange-400" : "bg-green-400")} />
                                                                    <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", r.status === 'ESCALATED' ? "bg-orange-500" : "bg-green-500")} />
                                                                </span>
                                                            )}
                                                            {(() => {
                                                                const logs = [
                                                                    ...(r.complainant_logs || []).filter(l => l.type !== 'OperatorRemark').map(l => ({ ...l, _source: 'User' })),
                                                                    ...(r.officer_logs || []).map(l => ({ ...l, _source: 'Officer' }))
                                                                ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                                                                if (logs.length === 0) return <span className="text-slate-300 text-[10px] italic">No Logs</span>;
                                                                return (
                                                                    <div className="max-h-[80px] overflow-y-auto space-y-1.5 p-1 border rounded bg-slate-50 min-w-[200px]">
                                                                        {logs.map((l, i) => (
                                                                            <div key={i} className="text-[10px] bg-white p-1 rounded border border-slate-100 shadow-sm">
                                                                                <div className="flex justify-between opacity-70 mb-0.5">
                                                                                    <span className={cn("font-bold uppercase tracking-wider text-[8px]", l._source === 'User' ? 'text-orange-600' : 'text-blue-600')}>
                                                                                        {l._source === 'User' ? (l.type === 'Operator' ? 'Operator' : 'User') : 'To Officer'}
                                                                                    </span>
                                                                                    <span className="text-[8px]">{fmtRelativeTime(l.timestamp)}</span>
                                                                                </div>
                                                                                <p className="line-clamp-2 text-slate-700 font-mono leading-tight">{l.content}</p>
                                                                                {l.original_link && (
                                                                                    <a href={l.original_link} target="_blank" rel="noopener noreferrer" className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                                        <span className="text-[10px] text-white font-medium bg-black/50 px-2 py-1 rounded-full backdrop-blur-sm">Open original</span>
                                                                                    </a>
                                                                                )}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </td>

                                                        {/* 11. Remarks (Operator Remarks) */}
                                                        <td className="py-2.5 px-3">
                                                            {operatorRemarks.length > 0 ? (
                                                                <div className="max-h-[80px] overflow-y-auto space-y-1 p-1 border rounded bg-amber-50 min-w-[150px]">
                                                                    {operatorRemarks.map((l, i) => (
                                                                        <div key={i} className="text-[10px] bg-white p-1 rounded border border-amber-100">
                                                                            <div className="flex justify-between mb-0.5">
                                                                                <span className="text-[8px] font-bold text-amber-600 uppercase">Note</span>
                                                                                <span className="text-[8px] text-slate-400">{fmtRelativeTime(l.timestamp)}</span>
                                                                            </div>
                                                                            <p className="line-clamp-2 text-slate-700 leading-tight">{l.content}</p>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ) : <span className="text-slate-300 text-xs">—</span>}
                                                        </td>

                                                        {/* 12. Informed to Officer */}
                                                        <td className="py-2.5 px-3">
                                                            {r.informed_to?.name ? (
                                                                <div className="space-y-0.5">
                                                                    <p className="font-medium text-slate-900 text-xs">{r.informed_to.name}</p>
                                                                    {r.informed_to.phone && (
                                                                        <p className="text-[9px] text-slate-500 flex items-center gap-1">
                                                                            <Phone className="h-2 w-2" />{r.informed_to.phone}
                                                                        </p>
                                                                    )}
                                                                    {firstOfficerLog?.timestamp && (
                                                                        <p className="text-[9px] text-slate-400">{fmtDate(firstOfficerLog.timestamp)}</p>
                                                                    )}
                                                                </div>
                                                            ) : <span className="text-slate-400 text-xs italic">—</span>}
                                                        </td>

                                                        {/* 13. Escalated Remarks */}
                                                        <td className="py-2.5 px-3">
                                                            {firstEscalation ? (
                                                                <div className="space-y-0.5">
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <p className="text-red-700 line-clamp-2 text-xs cursor-help bg-red-50 px-1.5 py-1 rounded border border-red-100">
                                                                                {firstEscalation.content}
                                                                            </p>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent side="left" className="max-w-xs"><p className="text-xs">{firstEscalation.content}</p></TooltipContent>
                                                                    </Tooltip>
                                                                    <p className="text-[9px] text-slate-400">{fmtDate(firstEscalation.timestamp)}</p>
                                                                </div>
                                                            ) : <span className="text-slate-300 text-xs">—</span>}
                                                        </td>

                                                        {/* 14. Escalated to Officer log */}
                                                        <td className="py-2.5 px-3">
                                                            {firstEscalation?.timestamp ? (
                                                                <div className="flex flex-col">
                                                                    <span className="text-slate-900 text-xs">{fmtDate(firstEscalation.timestamp)}</span>
                                                                    <span className="text-[9px] text-slate-400">{fmtRelativeTime(firstEscalation.timestamp)}</span>
                                                                    {firstEscalation.recipient?.name && (
                                                                        <span className="text-[9px] text-blue-600 mt-0.5">{firstEscalation.recipient.name}</span>
                                                                    )}
                                                                </div>
                                                            ) : <span className="text-slate-400 text-xs italic">—</span>}
                                                        </td>

                                                        {/* 15. Closing Remarks */}
                                                        <td className="py-2.5 px-3">
                                                            {r.closing_remarks ? (
                                                                <div className="space-y-0.5">
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <p className="text-slate-700 line-clamp-2 text-xs cursor-help">{r.closing_remarks}</p>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent side="left" className="max-w-xs"><p className="text-xs">{r.closing_remarks}</p></TooltipContent>
                                                                    </Tooltip>
                                                                    {r.action_taken_at && r.status === 'CLOSED' && (
                                                                        <p className="text-[9px] text-slate-400">{fmtDate(r.action_taken_at)}</p>
                                                                    )}
                                                                </div>
                                                            ) : <span className="text-slate-300 text-xs">—</span>}
                                                        </td>

                                                        {/* 16. FIR Number */}
                                                        <td className="py-2.5 px-3">
                                                            {firInfo.converted === 'Yes' && firInfo.firNumber ? (
                                                                <Badge variant="outline" className="text-[9px] font-mono bg-red-50 text-red-700 border-red-200">
                                                                    {firInfo.firNumber}
                                                                </Badge>
                                                            ) : <span className="text-slate-400 text-xs italic">—</span>}
                                                        </td>
                                                    </motion.tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Pagination */}
                                {pagination.pages > 1 && (
                                    <div className="flex items-center justify-between px-4 py-3 border-t bg-white">
                                        <p className="text-xs text-slate-500">
                                            {(page - 1) * 50 + 1}-{Math.min(page * 50, pagination.total)} of {pagination.total}
                                        </p>
                                        <div className="flex items-center gap-1">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={page <= 1}
                                                onClick={() => setPage(p => p - 1)}
                                                className="text-xs h-8"
                                            >
                                                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                                                Previous
                                            </Button>

                                            <div className="flex items-center gap-1">
                                                {Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => {
                                                    let pageNum;
                                                    if (pagination.pages <= 5) {
                                                        pageNum = i + 1;
                                                    } else if (page <= 3) {
                                                        pageNum = i + 1;
                                                    } else if (page >= pagination.pages - 2) {
                                                        pageNum = pagination.pages - 4 + i;
                                                    } else {
                                                        pageNum = page - 2 + i;
                                                    }

                                                    return (
                                                        <Button
                                                            key={i}
                                                            variant={pageNum === page ? "default" : "outline"}
                                                            size="sm"
                                                            onClick={() => setPage(pageNum)}
                                                            className={cn(
                                                                "text-xs h-8 w-8 rounded-lg",
                                                                pageNum === page && "bg-violet-600 hover:bg-violet-700"
                                                            )}
                                                        >
                                                            {pageNum}
                                                        </Button>
                                                    );
                                                })}
                                            </div>

                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={page >= pagination.pages}
                                                onClick={() => setPage(p => p + 1)}
                                                className="text-xs h-8"
                                            >
                                                Next
                                                <ChevronRight className="h-3.5 w-3.5 ml-1" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>

                {/* Detail Modal */}
                <AnimatePresence>
                    {selectedReport && (
                        <>
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="fixed inset-0 z-[9998] bg-slate-900/60 backdrop-blur-sm"
                                onClick={() => setSelectedReport(null)}
                            />

                            <motion.div
                                ref={detailPopupRef}
                                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                                transition={{ type: "spring", duration: 0.3 }}
                                className={cn(
                                    "fixed z-[9999] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden",
                                    fullscreen ? "inset-4" : ""
                                )}
                                style={!fullscreen ? {
                                    left: detailPos.x,
                                    top: detailPos.y,
                                    width: Math.min(960, window.innerWidth - 48),
                                    height: 'calc(100vh - 80px)'
                                } : {}}
                            >
                                {/* Modal Header */}
                                <div
                                    className={cn(
                                        "px-5 py-3 border-b flex items-center justify-between shrink-0",
                                        !fullscreen && "cursor-move bg-white"
                                    )}
                                    onMouseDown={!fullscreen ? (e) => {
                                        setDraggingDetail(true);
                                        setDetailDragOffset({ x: e.clientX - detailPos.x, y: e.clientY - detailPos.y });
                                    } : undefined}
                                >
                                    <div className="flex items-center gap-3">
                                        {!fullscreen && <GripHorizontal className="h-4 w-4 text-slate-300" />}
                                        <span className="text-sm font-semibold text-slate-900">Grievance Report</span>
                                        <Badge className="bg-amber-50 text-amber-700 border-amber-200 font-mono text-[10px]">
                                            {selectedReport.unique_code}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-slate-100" onClick={handlePrintPdf}>
                                            <Printer className="h-4 w-4 text-slate-600" />
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-slate-100" onClick={() => setFullscreen(!fullscreen)}>
                                            {fullscreen ? <Minimize2 className="h-4 w-4 text-slate-600" /> : <Maximize2 className="h-4 w-4 text-slate-600" />}
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-slate-100" onClick={() => setSelectedReport(null)}>
                                            <X className="h-4 w-4 text-slate-600" />
                                        </Button>
                                    </div>
                                </div>

                                {/* Scrollable Content */}
                                <div className="flex-1 overflow-y-auto p-5">
                                    <div ref={printComponentRef}>
                                        <GrievanceReportDetailView
                                            report={selectedReport}
                                            onClose={() => setSelectedReport(null)}
                                            onPrint={handlePrintPdf}
                                            isVideoUrl={isVideoUrl}
                                            onUpdate={(updated) => {
                                                setSelectedReport(updated);
                                                setReports(prev => prev.map(r => r.id === updated.id ? updated : r));
                                            }}
                                        />
                                    </div>
                                </div>
                            </motion.div>

                            {previewMedia && (
                                <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                                    <button
                                        type="button"
                                        onClick={() => setPreviewMedia(null)}
                                        className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/15 text-white hover:bg-white/25 flex items-center justify-center"
                                    >
                                        <X className="h-5 w-5" />
                                    </button>

                                    <div className="w-full max-w-5xl max-h-[85vh] rounded-xl overflow-hidden border border-white/20 bg-black/40 shadow-2xl">
                                        {isVideoUrl(previewMedia) ? (
                                            <video
                                                src={previewMedia}
                                                controls
                                                autoPlay
                                                playsInline
                                                className="w-full max-h-[85vh] object-contain bg-black"
                                            >
                                                Your browser does not support the video tag.
                                            </video>
                                        ) : (
                                            <img
                                                src={previewMedia}
                                                alt="Media Preview"
                                                className="w-full max-h-[85vh] object-contain bg-black"
                                                referrerPolicy="no-referrer"
                                            />
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </AnimatePresence>
            </div>
        </TooltipProvider>
    );
};

export default GrievanceWorkflowReports;
