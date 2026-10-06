import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';
import {
    Download, Loader2, ExternalLink, RefreshCw, ChevronDown, ChevronUp,
    Calendar, Filter, Search, FileSpreadsheet, MessageSquare,
    Eye, Printer, GripHorizontal, X, Share2, Copy, Check,
    AlertCircle, Clock, Users, Tag, Link2, Image, FileText,
    MoreHorizontal, ArrowUpDown, Maximize2, Minimize2,
    CircleCheck, ArrowRight, User
} from 'lucide-react';
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
} from '../ui/dropdown-menu';
import { QRCodeSVG } from 'qrcode.react';
import { useReactToPrint } from 'react-to-print';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    TooltipProvider
} from '../ui/tooltip';
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

const fmtNum = (n) => {
    if (!n || n === 0) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
};

const categoryColors = {
    'hate_speech': 'rose',
    'misinformation': 'amber',
    'harassment': 'red',
    'spam': 'purple',
    'violence': 'orange',
    'others': 'slate'
};

// Custom Icons
const Globe = ({ className }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>;
const XIcon = ({ className }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4l11.733 16h4.267L8.267 4H4z" /><path d="M4 20l6.768-8.5M20 4l-6.768 8.5" /></svg>;
const FacebookIcon = ({ className }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>;

const platformConfig = {
    all: { label: 'All Platforms', icon: Globe, color: 'slate' },
    x: { label: 'X (Twitter)', icon: XIcon, color: 'sky' },
    facebook: { label: 'Facebook', icon: FacebookIcon, color: 'blue' },
    whatsapp: { label: 'WhatsApp', icon: MessageSquare, color: 'emerald' }
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*                  CRITICISM REPORTS TABLE                         */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */



const ExpandableText = ({ text, limit = 150, className }) => {
    const [expanded, setExpanded] = React.useState(false);
    if (!text) return <span className="text-slate-400 font-normal">—</span>;
    if (text.length <= limit) return <p className={className}>{text}</p>;

    return (
        <div className="group">
            <p className={className}>
                {expanded ? text : text.slice(0, limit).trim() + '...'}
            </p>
            <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-700 hover:underline mt-1 focus:outline-none"
            >
                {expanded ? <>Show Less <ChevronUp className="h-3 w-3" /></> : <>Read More <ChevronDown className="h-3 w-3" /></>}
            </button>
        </div>
    );
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*               CRITICISM REPORT DETAIL VIEW                     */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const CriticismReportDetailView = ({ report: r, onClose, onPrint, onUpdate }) => {
    const isVideo = (url) => typeof url === 'string' && (url.toLowerCase().endsWith('.mp4') || url.toLowerCase().includes('/video/'));
    const [pdfGenerating, setPdfGenerating] = useState(false);
    const [pdfUrl, setPdfUrl] = useState(r?.report_pdf_url || null);

    React.useEffect(() => {
        if (!pdfUrl && r?.id && !pdfGenerating) {
            handleGeneratePdf();
        }
    }, [pdfUrl, r?.id]);

    const handleGeneratePdf = async () => {
        setPdfGenerating(true);
        try {
            const res = await api.post(`/criticism/reports/${r?.id || r?.unique_code}/generate-pdf`);
            const url = res.data?.pdf_url;
            if (url) {
                setPdfUrl(url);
                onUpdate?.({ ...r, report_pdf_url: url });
                toast.success('PDF generated successfully');
            }
        } catch (err) {
            toast.error(err?.response?.data?.detail || 'PDF generation failed');
            console.error(err);
        } finally {
            setPdfGenerating(false);
        }
    };

    // Derived state for status timeline
    const timelineSteps = React.useMemo(() => {
        const steps = [];
        // Pending
        steps.push({
            label: 'Posted',
            date: r.post_date,
            active: true,
            current: !r.action_taken_at,
            color: 'yellow',
            officer: r.posted_by?.display_name || '—',
            note: 'Content Detected'
        });

        // Action Taken
        const isActionTaken = !!r.action_taken_at;
        steps.push({
            label: isActionTaken ? 'Action Taken' : 'Pending',
            date: r.action_taken_at,
            active: isActionTaken,
            current: isActionTaken,
            color: 'green',
            officer: r.informed_to?.name || '—',
            note: r.remarks || (isActionTaken ? 'Issue Resolved' : 'Awaiting Action'),
            duration: isActionTaken ? (() => {
                const diff = new Date(r.action_taken_at) - new Date(r.post_date);
                if (diff < 0) return '—';
                const hrs = Math.floor(diff / 3600000);
                return `${hrs}h ${Math.floor((diff % 3600000) / 60000)}m`;
            })() : '—'
        });

        return steps;
    }, [r]);

    const status = r.action_taken_at
        ? { label: 'ACTION TAKEN', bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200', icon: Check }
        : { label: 'PENDING', bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', icon: Clock };

    const StatusIcon = status.icon;
    const mediaUrls = (Array.isArray(r.media_s3_urls) && r.media_s3_urls.length > 0 ? r.media_s3_urls : r.media_urls || []);

    // Icon mapping
    const PlatformIcon = platformConfig[r.platform?.toLowerCase()]?.icon || Globe;
    const platformLabel = platformConfig[r.platform?.toLowerCase()]?.label || r.platform || '—';

    return (
        <div className="space-y-6 pb-4">
            {/* ══════════════════════════════════════════════════ */}
            {/* PRINT-ONLY LETTERHEAD (hidden on screen)          */}
            {/* ══════════════════════════════════════════════════ */}
            <div className="hidden print:block mb-8 border-b-2 border-slate-800 pb-4">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <div style={{ fontSize: '13pt', fontWeight: 700, letterSpacing: '0.04em' }}>Criticism Report</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '18pt', fontWeight: 900, letterSpacing: '0.05em', fontFamily: 'monospace', color: '#fbbf24' }}>{r.unique_code || '—'}</div>
                        <div style={{ fontSize: '7pt', opacity: 0.7, marginTop: 2 }}>UNIQUE ID</div>
                    </div>
                    {(pdfUrl || r.report_pdf_url) ? (
                        <div style={{ display: 'flex', flexDirection: 'column', items: 'center', marginLeft: '16px' }}>
                            <div style={{ background: 'white', padding: '4px', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                                <QRCodeSVG
                                    value={pdfUrl || r.report_pdf_url}
                                    size={64}
                                    level="M"
                                    includeMargin={false}
                                />
                            </div>
                            <div style={{ fontSize: '6pt', textAlign: 'center', marginTop: '2px', opacity: 0.6 }}>Scan for PDF</div>
                        </div>
                    ) : (
                        <div style={{ border: '1px dashed #cbd5e1', borderRadius: '4px', height: '70px', width: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '16px' }}>
                            <span style={{ fontSize: '6pt', textAlign: 'center', color: '#64748b' }}>No PDF</span>
                        </div>
                    )}
                </div>
                <div className="grid grid-cols-4 gap-4 text-xs">
                    <div>
                        <div className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Status</div>
                        <div className="font-semibold">{status.label}</div>
                    </div>
                    <div>
                        <div className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Category</div>
                        <div className="font-semibold">{r.category || 'Others'}</div>
                    </div>
                    <div>
                        <div className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Platform</div>
                        <div className="font-semibold">{platformLabel}</div>
                    </div>
                    <div>
                        <div className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">Date</div>
                        <div className="font-semibold">{fmtDate(r.post_date)}</div>
                    </div>
                </div>
            </div>

            {/* ═══════ 1. HEADER (screen only) ═══════ */}
            <div className="flex items-center justify-between p-5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-xl text-white print:hidden">
                <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center">
                        <FileSpreadsheet className="h-6 w-6 text-amber-400" />
                    </div>
                    <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Critical Report ID</p>
                        <p className="text-lg font-bold font-mono tracking-wide text-amber-400">{r.unique_code || '—'}</p>
                    </div>
                    <div className="flex flex-col items-center gap-1 ml-2">
                        {(pdfUrl || r.report_pdf_url) ? (
                            <div className="bg-white p-1.5 rounded-lg shadow-sm group relative cursor-pointer" onClick={() => window.open(pdfUrl || r.report_pdf_url, '_blank')}>
                                <QRCodeSVG
                                    value={pdfUrl || r.report_pdf_url}
                                    size={52}
                                    level="M"
                                    includeMargin={false}
                                    bgColor="#ffffff"
                                    fgColor="#1e293b"
                                />
                                <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center">
                                    <ExternalLink className="h-4 w-4 text-slate-800" />
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={handleGeneratePdf}
                                disabled={pdfGenerating}
                                className="h-[64px] w-[64px] rounded-lg border border-dashed border-slate-600 bg-slate-800/50 hover:bg-slate-800 flex flex-col items-center justify-center gap-1 transition-colors"
                            >
                                {pdfGenerating ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <Printer className="h-4 w-4 text-slate-400" />}
                                <span className="text-[7px] font-medium text-slate-400 uppercase">Gen PDF</span>
                            </button>
                        )}
                        <span className="text-[9px] text-slate-400">{pdfUrl || r.report_pdf_url ? 'Report PDF' : 'No PDF'}</span>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className={cn("flex items-center gap-2 px-4 py-2 rounded-lg border", status.bg, status.border)}>
                        <StatusIcon className={cn("h-4 w-4", status.text)} />
                        <span className={cn("text-sm font-bold", status.text)}>{status.label}</span>
                    </div>
                    {(pdfUrl || r.report_pdf_url) && (
                        <div className="hidden sm:flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-white bg-transparent"
                                onClick={() => window.open(pdfUrl || r.report_pdf_url, '_blank')}
                            >
                                <ExternalLink className="h-3.5 w-3.5 mr-2" /> Open PDF
                            </Button>
                        </div>
                    )}
                    {/* Print Button */}
                    <button
                        onClick={onPrint}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors"
                    >
                        <Printer className="h-3.5 w-3.5" /> Print
                    </button>
                </div>
            </div>

            {/* ═══════ 2. POST DETAILS TABLE ═══════ */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-slate-500 print:hidden" />
                    <span className="text-sm font-semibold text-slate-800">Post Details</span>
                </div>
                <div className="p-4">
                    <div className="flex gap-5">
                        <div className="flex-1">
                            <table className="w-full text-sm">
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
                                            </div>
                                        </td>
                                    </tr>
                                    <tr className="border-b border-slate-100">
                                        <td className="py-2.5 pr-4 text-slate-500 font-medium align-top">Date & Time</td>
                                        <td className="py-2.5 text-slate-900 font-medium">{fmtDate(r.post_date)}</td>
                                    </tr>
                                    <tr className="border-b border-slate-100">
                                        <td className="py-2.5 pr-4 text-slate-500 font-medium align-top">Link</td>
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
                    </div>
                    {/* Description */}
                    <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Post Description</p>
                        <ExpandableText text={r.post_description} limit={300} className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed" />
                    </div>

                    {/* Media Preview */}
                    {mediaUrls.length > 0 && (
                        <div className="mt-3">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Media ({mediaUrls.length})</p>
                            <div className="grid grid-cols-2 gap-3">
                                {mediaUrls.map((url, i) => (
                                    <div key={i} className="group relative aspect-video rounded-xl border border-slate-200 overflow-hidden hover:border-amber-300 transition-colors cursor-pointer bg-slate-100">
                                        {isVideo(url) ? (
                                            <video src={url} className="h-full w-full object-cover bg-black" preload="metadata" />
                                        ) : (
                                            <img src={url} alt={`Media ${i + 1}`} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={e => e.currentTarget.src = ''} />
                                        )}
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <span className="text-[10px] text-white font-medium bg-black/50 px-2 py-1 rounded-full backdrop-blur-sm">View Full</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══════ 3. STATUS TIMELINE ═══════ */}
            <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/80 backdrop-blur-sm">
                    <div className="p-1.5 bg-blue-100/50 rounded-lg text-blue-600">
                        <Clock className="h-4 w-4" />
                    </div>
                    <div>
                        <span className="text-sm font-bold text-slate-800 block">Status Timeline</span>
                        <span className="text-[10px] text-slate-500 font-medium">Tracking the lifecycle of this report</span>
                    </div>
                </div>
                <div className="p-6 md:p-8">
                    <div className="relative pl-6 sm:pl-10 space-y-8 before:absolute before:left-3 sm:before:left-5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                        {timelineSteps.map((step, idx) => {
                            const c = { yellow: 'yellow', green: 'green' }[step.color] || 'yellow';
                            const isActive = step.active;
                            const isLast = idx === timelineSteps.length - 1;

                            return (
                                <div key={idx} className={cn("relative group transition-all duration-300", !isActive && "opacity-50 grayscale")}>
                                    {/* Timeline Dot */}
                                    <div className={cn(
                                        "absolute -left-[27px] sm:-left-[43px] top-6 h-4 w-4 rounded-full border-[3px] bg-white ring-4 ring-white z-10 transition-colors duration-300",
                                        isActive ? `border-${c}-500 shadow-md` : "border-slate-300",
                                        step.current && isActive && "animate-pulse"
                                    )}>
                                        {step.current && isActive && (
                                            <span className={cn("absolute inset-0 rounded-full animate-ping opacity-75", `bg-${c}-400`)} />
                                        )}
                                    </div>

                                    {/* Card Content - The "Rectangle" */}
                                    <div className={cn(
                                        "relative rounded-xl border transition-all duration-300 hover:shadow-md overflow-hidden bg-white",
                                        isActive ? "border-slate-200 shadow-sm" : "border-slate-100 bg-slate-50/50"
                                    )}>
                                        {/* Status Header Strip */}
                                        <div className={cn(
                                            "px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-between border-b",
                                            isActive
                                                ? `bg-${c}-50 text-${c}-700 border-${c}-100`
                                                : "bg-slate-100 text-slate-500 border-slate-200"
                                        )}>
                                            <div className="flex items-center gap-2">
                                                {idx === 0 ? <Clock className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                                                {step.label}
                                            </div>
                                            {step.date && (
                                                <div className="font-mono opacity-80 normal-case flex items-center gap-1.5">
                                                    <Calendar className="h-3 w-3" />
                                                    {new Date(step.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                    <span className="w-1 h-3 border-l border-current opacity-30 mx-0.5" />
                                                    {new Date(step.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                                </div>
                                            )}
                                        </div>

                                        {/* Body Content */}
                                        <div className="p-4">
                                            {/* Officer & Role */}
                                            <div className="flex items-start gap-3 mb-3">
                                                <div className={cn("p-2 rounded-lg shrink-0", isActive ? "bg-slate-100" : "bg-slate-100/50")}>
                                                    <User className="h-4 w-4 text-slate-500" />
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500 font-medium mb-0.5">Handled By</p>
                                                    <p className="text-sm font-semibold text-slate-900">{step.officer}</p>
                                                </div>
                                            </div>

                                            {/* Note / Remarks */}
                                            <div className={cn(
                                                "p-3 rounded-lg text-sm leading-relaxed border",
                                                isActive ? "bg-slate-50 border-slate-100 text-slate-700" : "bg-transparent border-transparent text-slate-400 italic"
                                            )}>
                                                {step.note && step.note !== '—' ? step.note : <span className="text-slate-400 italic">No additional remarks recorded.</span>}
                                            </div>

                                            {/* Step Duration Footer */}
                                            {isActive && step.duration && step.duration !== '—' && (
                                                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-end text-xs text-slate-500 font-medium">
                                                    <span className="bg-slate-100 px-2 py-1 rounded text-[10px] uppercase tracking-wide flex items-center gap-1.5">
                                                        <Clock className="h-3 w-3" />
                                                        Duration: {step.duration}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* ═══════ 4. COMMUNICATION / REMARKS LOG ═══════ */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-slate-500 print:hidden" />
                        <span className="text-sm font-semibold text-slate-800">Communication & Remarks</span>
                    </div>
                </div>
                <div className="bg-white divide-y divide-slate-100 min-h-[100px] max-h-[400px] overflow-y-auto">
                    {(() => {
                        const logs = [];
                        if (r.post_description) {
                            logs.push({
                                type: 'User',
                                timestamp: r.post_date,
                                content: r.post_description,
                                label: 'User Content',
                                bg: 'bg-orange-500'
                            });
                        }
                        if (r.remarks) {
                            logs.push({
                                type: 'Internal',
                                timestamp: r.action_taken_at || r.created_at,
                                content: r.remarks,
                                label: 'Internal / Action Remark',
                                bg: 'bg-emerald-600'
                            });
                        }
                        return logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map((log, idx) => (
                            <div key={idx} className="bg-white pt-1.5 pb-1">
                                <div className="flex items-center gap-2 px-3">
                                    <div className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm max-w-[85%]', log.bg)}>
                                        <span className="text-[10px] font-semibold truncate text-white">
                                            {log.label}
                                        </span>
                                    </div>
                                    <span className="text-[8px] text-slate-400 whitespace-nowrap shrink-0">{fmtDate(log.timestamp)}</span>
                                </div>
                                <div className="px-3 pt-1 pb-0.5 mb-2">
                                    <ExpandableText text={log.content} limit={150} className="text-xs text-slate-800 whitespace-pre-wrap leading-snug" />
                                </div>
                            </div>
                        ));
                    })()}
                </div>
            </div>
        </div>
    );
};

export const CriticismReports = ({ openReportCode = '', onReportCodeHandled }) => {
    const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [platform, setPlatform] = useState('all');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [quickRange, setQuickRange] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ total: 0, pages: 1 });
    const [selectedReport, setSelectedReport] = useState(null);
    const [waPhone, setWaPhone] = useState('');
    const [copied, setCopied] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const detailPopupRef = useRef(null);
    const [detailPos, setDetailPos] = useState({ x: Math.max(40, window.innerWidth / 2 - 420), y: 40 });
    const [draggingDetail, setDraggingDetail] = useState(false);
    const [detailDragOffset, setDetailDragOffset] = useState({ x: 0, y: 0 });
    const [sortConfig, setSortConfig] = useState({ key: 'post_date', direction: 'desc' });

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
            if (categoryFilter !== 'all') params.category = categoryFilter;
            if (fromDate) params.from = fromDate;
            if (toDate) params.to = toDate;
            if (searchTerm.trim()) params.unique_code = searchTerm.trim().toUpperCase();

            const res = await api.get('/criticism/reports', { params });
            setReports(res.data?.reports || []);
            setPagination(res.data?.pagination || { total: 0, pages: 1 });
        } catch {
            toast.error('Failed to load criticism reports', {
                description: 'Please check your connection and try again',
                action: { label: 'Retry', onClick: fetchReports }
            });
        } finally {
            setLoading(false);
        }
    }, [page, platform, categoryFilter, fromDate, toDate, searchTerm, sortConfig]);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    useEffect(() => {
        const code = String(openReportCode || '').trim();
        if (!code) return;
        setPlatform('all');
        setCategoryFilter('all');
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

    /* ─── Export to Excel ─── */
    const handleExport = async () => {
        setExporting(true);
        try {
            const params = {};
            if (platform !== 'all') params.platform = platform;
            if (categoryFilter !== 'all') params.category = categoryFilter;
            if (fromDate) params.from = fromDate;
            if (toDate) params.to = toDate;
            if (searchTerm.trim()) params.unique_code = searchTerm.trim().toUpperCase();

            const res = await api.get('/criticism/reports/export', {
                params,
                responseType: 'blob'
            });

            const blob = new Blob([res.data], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `criticism_reports_${new Date().toISOString().slice(0, 10)}.xlsx`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            toast.success('Excel report downloaded successfully', {
                description: `${pagination.total} reports exported`
            });
        } catch {
            toast.error('Failed to export reports');
        } finally {
            setExporting(false);
        }
    };

    const buildShareMessage = useCallback((r) => {
        if (!r) return '';
        return [
            `📋 *CRITICISM REPORT: ${r.unique_code || ''}*`,
            ``,
            `📅 *Post Date:* ${fmtDate(r.post_date)}`,
            `👤 *Profile:* ${r.profile_id || r.posted_by?.handle || 'N/A'}`,
            `🏷️ *Category:* ${r.category || 'Others'}`,
            `🔗 *Post Link:* ${r.post_link || 'N/A'}`,
            ``,
            `📝 *Description:*`,
            `${r.post_description || ''}`,
            ``,
            `💬 *Remarks:*`,
            `${r.remarks || ''}`,
            ``,
            `👥 *Informed To:* ${r.informed_to?.name || 'N/A'} ${r.informed_to?.phone ? `(${r.informed_to.phone})` : ''} - Action: ${fmtDate(r.action_taken_at) || 'Pending'}`,
            ``,
            `_Shared via Criticism Management System_`
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

    const printComponentRef = useRef(null);
    const handlePrintPdf = useReactToPrint({
        content: () => printComponentRef.current,
        documentTitle: `Criticism_Report_${selectedReport?.unique_code || 'Detail'}`,
        pageStyle: `
        @page { size: A4; margin: 20mm; }
        @media print {
            body { -webkit-print-color-adjust: exact; }
            .print-hidden { display: none !important; }
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
            x: Math.max(24, window.innerWidth / 2 - 420),
            y: Math.max(20, window.innerHeight / 2 - 300)
        });
    }, [selectedReport]);

    useEffect(() => {
        if (!draggingDetail) return;
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
    }, [draggingDetail, detailDragOffset]);

    const SortIcon = ({ column }) => (
        <ArrowUpDown className={cn(
            "h-3.5 w-3.5 ml-1 transition-opacity",
            sortConfig.key === column ? "opacity-100" : "opacity-30"
        )} />
    );

    /* ━━━━━ RENDER ━━━━━ */
    return (
        <TooltipProvider>
            <div className="space-y-4">
                {/* Header Card */}
                <Card className="border-slate-200 rounded-xl bg-white overflow-hidden">
                    {/* ── Header Row ── */}
                    <CardHeader className="py-3 px-5 border-b border-slate-200 bg-white">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-lg bg-red-500 flex items-center justify-center shadow-sm">
                                    <FileSpreadsheet className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg font-semibold text-slate-900">
                                        Criticism Reports
                                    </CardTitle>
                                    <CardDescription className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                                        <span>{pagination.total} records</span>
                                        {(searchTerm || platform !== 'all' || categoryFilter !== 'all' || fromDate || toDate || quickRange !== 'all') && (
                                            <>
                                                <span className="w-1 h-1 rounded-full bg-red-400" />
                                                <span className="text-red-600 font-medium">Filtered</span>
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
                            {(searchTerm || platform !== 'all' || categoryFilter !== 'all' || fromDate || toDate || quickRange !== 'all') && (
                                <>
                                    <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                                        {[searchTerm, platform !== 'all', categoryFilter !== 'all', fromDate, toDate, quickRange !== 'all' && quickRange !== 'custom'].filter(Boolean).length}
                                    </span>
                                    <button
                                        onClick={() => { setSearchTerm(''); setPlatform('all'); setCategoryFilter('all'); setFromDate(''); setToDate(''); setQuickRange('all'); setPage(1); }}
                                        className="ml-auto text-xs text-red-600 hover:text-red-800 font-medium flex items-center gap-1 transition-colors"
                                    >
                                        <X className="h-3 w-3" />
                                        Clear All
                                    </button>
                                </>
                            )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                            {/* Search */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Search</label>
                                <div className="relative">
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                                    <Input
                                        placeholder="Unique ID..."
                                        value={searchTerm}
                                        onChange={(e) => { setSearchTerm(e.target.value.toUpperCase()); setPage(1); }}
                                        className="pl-7 h-8 text-xs bg-white border-slate-200 focus:border-red-400 focus:ring-red-200 rounded-md"
                                    />
                                </div>
                            </div>
                            {/* Date Range */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Date Range</label>
                                <Select value={quickRange} onValueChange={(v) => { setQuickRange(v); setPage(1); }}>
                                    <SelectTrigger className="h-8 text-xs border-slate-200 bg-white focus:border-red-400 focus:ring-red-200 rounded-md">
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
                                        className="w-full h-8 pl-7 pr-2 text-xs bg-white border border-slate-200 rounded-md outline-none focus:border-red-400 focus:ring-1 focus:ring-red-200 transition-colors"
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
                                        className="w-full h-8 pl-7 pr-2 text-xs bg-white border border-slate-200 rounded-md outline-none focus:border-red-400 focus:ring-1 focus:ring-red-200 transition-colors"
                                    />
                                </div>
                            </div>
                            {/* Category */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Category</label>
                                <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(1); }}>
                                    <SelectTrigger className="h-8 text-xs border-slate-200 bg-white focus:border-red-400 focus:ring-red-200 rounded-md">
                                        <SelectValue placeholder="All" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Categories</SelectItem>
                                        <SelectItem value="Cyber crimes">Cyber crimes</SelectItem>
                                        <SelectItem value="E-Challan">E-Challan</SelectItem>
                                        <SelectItem value="L&O">L&O</SelectItem>
                                        <SelectItem value="Others">Others</SelectItem>
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
                                    <SelectTrigger className="h-8 text-xs border-slate-200 bg-white focus:border-red-400 focus:ring-red-200 rounded-md">
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
                        </div>

                        {/* ── Results Count Banner ── */}
                        {(searchTerm || platform !== 'all' || categoryFilter !== 'all' || fromDate || toDate || quickRange !== 'all') && (
                            <div className="mt-3 flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
                                {loading ? (
                                    <Loader2 className="h-5 w-5 text-red-500 animate-spin flex-shrink-0" />
                                ) : (
                                    <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                                        <Check className="h-3 w-3 text-white" />
                                    </div>
                                )}
                                <div>
                                    <span className="text-2xl font-bold text-red-700">{loading ? '...' : pagination.total}</span>
                                    <span className="ml-2 text-base font-medium text-red-600">
                                        {pagination.total === 1 ? 'result found' : 'results found'} for your filter
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    <CardContent className="p-0">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-20">
                                <div className="relative">
                                    <div className="h-16 w-16 rounded-full border-4 border-slate-100 border-t-red-500 animate-spin" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <FileSpreadsheet className="h-6 w-6 text-slate-400" />
                                    </div>
                                </div>
                                <p className="mt-4 text-sm text-slate-500">Loading criticism reports...</p>
                            </div>
                        ) : reports.length === 0 ? (
                            <div className="text-center py-20 px-4">
                                <div className="h-20 w-20 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                                    <FileSpreadsheet className="h-10 w-10 text-slate-400" />
                                </div>
                                <h3 className="text-lg font-semibold text-slate-900 mb-2">No reports yet</h3>
                                <p className="text-sm text-slate-500 max-w-md mx-auto">
                                    No criticism reports found. Use the <span className="font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">C</span> button on grievance cards to create new reports.
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
                                                    { key: 'category', label: 'Category', width: 'w-32', sortable: true },
                                                    { key: 'unique_code', label: 'Unique ID', width: 'w-32', sortable: true },
                                                    { key: 'post_date', label: 'Post Date', width: 'w-32', sortable: true },
                                                    { key: 'profile', label: 'Profile', width: 'w-44' },
                                                    { key: 'post_link', label: 'Link', width: 'w-16' },
                                                    { key: 'description', label: 'Description', width: 'min-w-[200px]' },
                                                    { key: 'remarks', label: 'Remarks', width: 'min-w-[180px]' },
                                                    { key: 'informed_to', label: 'Informed To', width: 'min-w-[200px]', sortable: true }
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
                                                        <div className="flex items-center gap-1">
                                                            {col.label}
                                                            {col.sortable && <SortIcon column={col.key} />}
                                                        </div>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 bg-white">
                                            {reports.map((r, idx) => {
                                                const mediaUrls = Array.isArray(r.media_s3_urls) && r.media_s3_urls.length > 0
                                                    ? r.media_s3_urls
                                                    : (r.media_urls || []);

                                                return (
                                                    <tr
                                                        key={r.id}
                                                        className="hover:bg-slate-50/50 transition-colors group"
                                                    >
                                                        <td className="py-3 px-3 align-top">
                                                            <div className="flex flex-col items-center gap-1">
                                                                <span className="text-slate-500 font-mono text-[11px]">
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
                                                                                setWaPhone(r.informed_to?.phone || '');
                                                                            }}
                                                                        >
                                                                            <Eye className="h-3.5 w-3.5 text-violet-600" />
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent><p className="text-xs">View Details</p></TooltipContent>
                                                                </Tooltip>
                                                            </div>
                                                        </td>

                                                        <td className="py-3 px-3 align-top">
                                                            <Badge
                                                                variant="outline"
                                                                className={cn(
                                                                    "text-[10px] font-medium px-2 py-0.5 whitespace-nowrap",
                                                                    `border-${categoryColors[r.category] || 'slate'}-200`,
                                                                    `bg-${categoryColors[r.category] || 'slate'}-50`,
                                                                    `text-${categoryColors[r.category] || 'slate'}-700`
                                                                )}
                                                            >
                                                                {r.category || 'Others'}
                                                            </Badge>
                                                        </td>

                                                        <td className="py-3 px-3 align-top">
                                                            <button
                                                                onClick={() => {
                                                                    setSelectedReport(r);
                                                                    setWaPhone(r.informed_to?.phone || '');
                                                                }}
                                                                className="hover:opacity-80 transition-opacity outline-none"
                                                            >
                                                                <Badge className="bg-slate-100 text-slate-700 border-slate-200 font-mono text-[11px] px-2 py-0.5 hover:bg-slate-200 cursor-pointer shadow-sm">
                                                                    {r.unique_code}
                                                                </Badge>
                                                            </button>
                                                        </td>

                                                        <td className="py-3 px-3 align-top">
                                                            <div className="flex flex-col">
                                                                <span className="text-slate-900 font-medium text-xs">
                                                                    {fmtDate(r.post_date).split(',')[0]}
                                                                </span>
                                                                <span className="text-[10px] text-slate-400">
                                                                    {fmtDate(r.post_date).split(',')[1]}
                                                                </span>
                                                                <span className="text-[9px] text-slate-400 mt-0.5">
                                                                    {fmtRelativeTime(r.post_date)}
                                                                </span>
                                                            </div>
                                                        </td>

                                                        <td className="py-3 px-3 align-top">
                                                            <div className="flex items-start gap-2">
                                                                {r.posted_by?.profile_image_url ? (
                                                                    <img
                                                                        src={r.posted_by.profile_image_url}
                                                                        alt=""
                                                                        className="h-6 w-6 rounded-full ring-1 ring-slate-200 mt-0.5 bg-slate-100 object-cover"
                                                                    />
                                                                ) : (
                                                                    <div className="h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 shrink-0 mt-0.5">
                                                                        <Users className="h-3 w-3" />
                                                                    </div>
                                                                )}
                                                                <div className="min-w-0">
                                                                    <p className="font-semibold text-slate-900 text-xs truncate max-w-[140px]" title={r.posted_by?.display_name}>
                                                                        {r.posted_by?.display_name || '—'}
                                                                    </p>
                                                                    {r.profile_id && (
                                                                        <a
                                                                            href={r.profile_link || '#'}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="text-[10px] text-blue-600 hover:underline truncate block max-w-[140px]"
                                                                        >
                                                                            @{r.profile_id}
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>

                                                        <td className="py-3 px-3 align-top">
                                                            {r.post_link ? (
                                                                <a
                                                                    href={r.post_link}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="h-6 w-6 flex items-center justify-center rounded bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 transition-colors"
                                                                    title="View Post"
                                                                >
                                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                                </a>
                                                            ) : (
                                                                <span className="text-slate-300 text-xs">—</span>
                                                            )}
                                                        </td>

                                                        <td className="py-3 px-3 align-top">
                                                            <div className="min-w-[300px] max-w-[500px]">
                                                                <ExpandableText
                                                                    text={r.post_description}
                                                                    limit={150}
                                                                    className="text-slate-700 text-xs leading-snug whitespace-pre-wrap"
                                                                />
                                                            </div>
                                                        </td>

                                                        <td className="py-3 px-3 align-top">
                                                            <div className="min-w-[200px] max-w-[400px]">
                                                                <ExpandableText
                                                                    text={r.remarks}
                                                                    limit={150}
                                                                    className="text-slate-600 text-xs leading-snug whitespace-pre-wrap"
                                                                />
                                                            </div>
                                                        </td>

                                                        <td className="py-3 px-3 align-top">
                                                            {r.informed_to?.name || r.informed_to?.phone || r.informed_to?.department || r.action_taken_at ? (
                                                                <div className="flex flex-col">
                                                                    {r.informed_to?.name && (
                                                                        <span className="font-semibold text-slate-900 text-xs truncate max-w-[140px]" title={r.informed_to.name}>
                                                                            {r.informed_to.name}
                                                                        </span>
                                                                    )}
                                                                    {r.informed_to?.phone && (
                                                                        <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                                                                            {r.informed_to.phone}
                                                                        </span>
                                                                    )}
                                                                    {r.informed_to?.department && (
                                                                        <span className="text-[9px] text-slate-400 truncate max-w-[140px] mt-0.5">
                                                                            {r.informed_to.department}
                                                                        </span>
                                                                    )}
                                                                    {r.action_taken_at && (
                                                                        <span className="text-slate-500 font-medium text-[10px] mt-0.5">
                                                                            {fmtDate(r.action_taken_at)}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-slate-400 text-sm">—</span>
                                                            )}
                                                        </td>
                                                    </tr>
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
                                initial={{ opacity: 0, scale: 0.95, y: 20, x: '-50%' }}
                                animate={{ opacity: 1, scale: 1, y: '-50%', x: '-50%' }}
                                exit={{ opacity: 0, scale: 0.95, y: 20, x: '-50%' }}
                                transition={{ type: "spring", duration: 0.3 }}
                                className={cn(
                                    "fixed left-1/2 top-1/2 z-[9999] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden",
                                    fullscreen ? "w-[95vw] h-[95vh]" : "w-full max-w-4xl max-h-[85vh]"
                                )}
                            >
                                {/* Modal Header */}
                                <div className="px-5 py-3 border-b flex items-center justify-between shrink-0 bg-white">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-semibold text-slate-900">Criticism Report</span>
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
                                <div className="flex-1 overflow-y-auto p-5 bg-slate-50/50">
                                    <div ref={printComponentRef} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print:shadow-none print:border-0">
                                        <CriticismReportDetailView
                                            report={selectedReport}
                                            onClose={() => setSelectedReport(null)}
                                            onPrint={handlePrintPdf}
                                            onUpdate={(updated) => {
                                                setSelectedReport(updated);
                                                setReports(prev => prev.map(rep => rep.id === updated.id ? updated : rep));
                                            }}
                                        />
                                    </div>
                                </div>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>
            </div>
        </TooltipProvider>
    );
};

export default CriticismReports;