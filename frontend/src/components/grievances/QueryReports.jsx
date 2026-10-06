import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';
import {
    Download, Loader2, ExternalLink, RefreshCw, ChevronDown,
    Calendar, Filter, Search, FileSpreadsheet, MessageSquare,
    Eye, Printer, GripHorizontal, X, Maximize2, Minimize2,
    Share2, Copy, Check, AlertCircle, Clock, Users, Tag,
    Link2, Image, FileText, MoreHorizontal, ArrowUpDown,
    Phone, Mail, Globe, Facebook, Twitter, MessageCircle,
    ChevronLeft, ChevronRight, Info, HelpCircle, Plus
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
    DropdownMenuSeparator
} from '../ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Separator } from '../ui/separator';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';

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
    CLOSED: {
        label: 'Closed',
        color: 'green',
        icon: Check,
        bg: 'bg-green-50',
        text: 'text-green-700',
        border: 'border-green-200',
        dot: 'bg-green-500'
    }
};

const platformConfig = {
    all: { label: 'All Platforms', icon: Globe, color: 'slate' },
    x: { label: 'X (Twitter)', icon: Twitter, color: 'sky' },
    facebook: { label: 'Facebook', icon: Facebook, color: 'blue' },
    whatsapp: { label: 'WhatsApp', icon: MessageCircle, color: 'emerald' }
};

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
                onClick={() => setExpanded(!expanded)}
                className="text-[10px] text-blue-600 hover:text-blue-700 font-medium mt-1 underline-offset-2 hover:underline focus:outline-none"
            >
                {expanded ? 'Show Less' : 'Read More'}
            </button>
        </div>
    );
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*                  QUERY WORKFLOW REPORTS TABLE                     */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export const QueryReports = ({ externalStatusFilter = 'all', onStatsUpdate }) => {
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [platform, setPlatform] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ total: 0, pages: 1 });
    const [stats, setStats] = useState({ total: 0, pending: 0, closed: 0 });
    const [selectedReport, setSelectedReport] = useState(null);
    const [waPhone, setWaPhone] = useState('');
    const [copied, setCopied] = useState(false);
    const detailPopupRef = useRef(null);
    const [detailPos, setDetailPos] = useState({
        x: Math.max(24, window.innerWidth / 2 - 450),
        y: 40
    });
    const [draggingDetail, setDraggingDetail] = useState(false);
    const [detailDragOffset, setDetailDragOffset] = useState({ x: 0, y: 0 });
    const [fullscreen, setFullscreen] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'post_date', direction: 'desc' });
    const [activeTab, setActiveTab] = useState('details');
    const [previewMedia, setPreviewMedia] = useState(null);
    const [pdfGenerating, setPdfGenerating] = useState(false);

    useEffect(() => {
        if (selectedReport && !selectedReport.report_pdf_url && !pdfGenerating) {
            handleAutoGeneratePdf(selectedReport);
        }
    }, [selectedReport]);

    const handleAutoGeneratePdf = async (report) => {
        setPdfGenerating(true);
        try {
            const res = await api.post(`/query-workflow/reports/${report.id}/generate-pdf`);
            const url = res.data?.pdf_url;
            if (url) {
                const updated = { ...report, report_pdf_url: url };
                setSelectedReport(updated);
                setReports(prev => prev.map(r => r.id === report.id ? updated : r));
                toast.success('PDF generated successfully');
            }
        } catch (err) {
            console.error('Auto PDF generation failed:', err);
        } finally {
            setPdfGenerating(false);
        }
    };

    useEffect(() => {
        const normalized = String(externalStatusFilter || 'all').trim().toUpperCase();
        const allowed = new Set(['ALL', 'PENDING', 'CLOSED']);
        const next = allowed.has(normalized) ? normalized : 'ALL';
        const nextValue = next.toLowerCase() === 'all' ? 'all' : next;
        setStatusFilter((prev) => (prev === nextValue ? prev : nextValue));
        setPage(1);
    }, [externalStatusFilter]);

    const timelineSteps = React.useMemo(() => {
        if (!selectedReport) return [];
        const steps = [];
        const r = selectedReport;

        // 1. Posted
        steps.push({
            label: 'Query Posted',
            date: r.post_date,
            active: true,
            current: r.status === 'PENDING',
            color: 'yellow',
            officer: r.posted_by?.display_name || r.profile_id || '—',
            note: 'Query detected and logged'
        });

        // 2. Resolved (if CLOSED)
        const isClosed = r.status === 'CLOSED';
        steps.push({
            label: isClosed ? 'Query Resolved' : 'Pending Resolution',
            date: r.action_taken_at,
            active: isClosed,
            current: isClosed,
            color: 'green',
            officer: r.informed_to?.name || '—',
            note: r.closing_remarks || (isClosed ? 'Final response shared' : 'Awaiting officer action'),
            duration: isClosed ? (() => {
                const diff = new Date(r.action_taken_at) - new Date(r.post_date);
                if (diff < 0) return '—';
                const hrs = Math.floor(diff / 3600000);
                const mins = Math.floor((diff % 3600000) / 60000);
                return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
            })() : '—'
        });

        return steps;
    }, [selectedReport]);

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
            if (searchTerm) params.search = searchTerm;

            const res = await api.get('/query-workflow/reports', { params });
            setReports(res.data?.reports || []);
            setPagination(res.data?.pagination || { total: 0, pages: 1 });
            if (res.data?.stats) {
                setStats(res.data.stats);
                onStatsUpdate?.(res.data.stats);
            }
        } catch {
            toast.error('Failed to load query reports', {
                description: 'Please check your connection and try again',
                action: { label: 'Retry', onClick: fetchReports }
            });
        }
        finally { setLoading(false); }
    }, [page, platform, statusFilter, searchTerm, sortConfig]);

    useEffect(() => { fetchReports(); }, [fetchReports]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const params = {};
            if (platform !== 'all') params.platform = platform;
            if (statusFilter !== 'all') params.status = statusFilter;
            if (searchTerm) params.search = searchTerm;

            const res = await api.get('/query-workflow/reports/export', {
                params,
                responseType: 'blob'
            });

            const blob = new Blob([res.data], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `query_reports_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
            `📋 *QUERY REPORT: ${r.unique_code || ''}*`,
            ``,
            `📊 *Status:* ${r.status || 'PENDING'}`,
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
            r.status === 'CLOSED' ? `✅ *Operator Reply:* ${r.operator_reply || ''}` : '',
            r.status === 'CLOSED' ? `📢 *Final Reply to User:* ${r.final_reply_to_user || ''}` : '',
            r.status === 'CLOSED' ? `📝 *Closing Remarks:* ${r.closing_remarks || ''}` : '',
            ``,
            `_Shared via Query Management System_`
        ].filter(Boolean).join('\n');
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

    const handlePrintPdf = () => {
        if (!selectedReport) return;
        const r = selectedReport;
        const media = (Array.isArray(r.media_s3_urls) && r.media_s3_urls.length > 0 ? r.media_s3_urls : (r.media_urls || []));
        const doc = window.open('', '_blank', 'width=900,height=700');
        if (!doc) return;

        const styles = `
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                    padding: 32px; 
                    color: #111827; 
                    background: #f9fafb;
                    line-height: 1.5;
                }
                .container { max-width: 800px; margin: 0 auto; }
                .header { 
                    background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
                    color: white;
                    padding: 24px;
                    border-radius: 16px 16px 0 0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .header h1 { font-size: 24px; font-weight: 600; }
                .status-badge { 
                    background: rgba(255,255,255,0.2);
                    padding: 6px 16px;
                    border-radius: 30px;
                    font-size: 14px;
                    font-weight: 500;
                    backdrop-filter: blur(4px);
                }
                .content { 
                    background: white;
                    padding: 32px;
                    border-radius: 0 0 16px 16px;
                    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
                }
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
                .field { 
                    background: #f9fafb;
                    padding: 12px 16px;
                    border-radius: 12px;
                    border: 1px solid #e5e7eb;
                }
                .field .label { 
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: #6b7280;
                    margin-bottom: 4px;
                }
                .field .value { font-weight: 500; color: #111827; }
                .section { 
                    margin-top: 24px;
                    padding: 20px;
                    background: #f9fafb;
                    border-radius: 12px;
                    border: 1px solid #e5e7eb;
                }
                .section h3 { 
                    font-size: 16px;
                    font-weight: 600;
                    margin-bottom: 12px;
                    color: #374151;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .media-list { 
                    list-style: none;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .media-list a { 
                    color: #2563eb;
                    text-decoration: none;
                    word-break: break-all;
                }
                .media-list a:hover { text-decoration: underline; }
                .footer {
                    margin-top: 32px;
                    text-align: center;
                    color: #9ca3af;
                    font-size: 12px;
                    border-top: 1px solid #e5e7eb;
                    padding-top: 20px;
                }
            </style>
        `;

        doc.document.write(`
            <html>
                <head>
                    <title>Query Report ${r.unique_code || ''}</title>
                    ${styles}
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Query Report</h1>
                            <div class="status-badge">${r.status || 'PENDING'}</div>
                        </div>
                        <div class="content">
                            <div class="grid">
                                <div class="field">
                                    <div class="label">Unique ID</div>
                                    <div class="value">${r.unique_code || '—'}</div>
                                </div>
                                <div class="field">
                                    <div class="label">Post Date</div>
                                    <div class="value">${fmtDate(r.post_date)}</div>
                                </div>
                                <div class="field">
                                    <div class="label">Category</div>
                                    <div class="value">${r.category || 'Others'}</div>
                                </div>
                                <div class="field">
                                    <div class="label">Profile</div>
                                    <div class="value">${r.profile_id || r.posted_by?.display_name || 'N/A'}</div>
                                </div>
                            </div>

                            ${r.post_link ? `
                                <div class="field" style="margin-bottom: 24px;">
                                    <div class="label">Post Link</div>
                                    <div class="value"><a href="${r.post_link}" style="color: #2563eb;">${r.post_link}</a></div>
                                </div>
                            ` : ''}

                            <div class="section">
                                <h3>📝 Description</h3>
                                <p style="white-space: pre-wrap;">${r.post_description || 'No description'}</p>
                            </div>

                            <div class="section">
                                <h3>💬 Remarks</h3>
                                <p style="white-space: pre-wrap;">${r.remarks || 'No remarks'}</p>
                            </div>

                            ${r.status === 'CLOSED' ? `
                                <div class="section">
                                    <h3>✅ Operator Reply</h3>
                                    <p style="white-space: pre-wrap;">${r.operator_reply || 'No reply recorded'}</p>
                                </div>
                                <div class="section">
                                    <h3>📢 Final Reply to User</h3>
                                    <p style="white-space: pre-wrap;">${r.final_reply_to_user || 'No reply recorded'}</p>
                                </div>
                                <div class="section">
                                    <h3>📝 Closing Remarks</h3>
                                    <p style="white-space: pre-wrap;">${r.closing_remarks || 'No closing remarks'}</p>
                                </div>
                            ` : ''}

                            ${media.length > 0 ? `
                                <div class="section">
                                    <h3>🖼️ Media URLs</h3>
                                    <ul class="media-list">
                                        ${media.map(url => `<li><a href="${url}" target="_blank">${url}</a></li>`).join('')}
                                    </ul>
                                </div>
                            ` : ''}

                            <div class="grid" style="margin-top: 24px;">
                                <div class="field">
                                    <div class="label">Informed To</div>
                                    <div class="value">${r.informed_to?.name || 'N/A'}</div>
                                </div>
                                <div class="field">
                                    <div class="label">Contact</div>
                                    <div class="value">${r.informed_to?.phone || 'N/A'}</div>
                                </div>
                                <div class="field">
                                    <div class="label">Action Date</div>
                                    <div class="value">${fmtDate(r.action_taken_at) || 'Pending'}</div>
                                </div>
                                <div class="field">
                                    <div class="label">Department</div>
                                    <div class="value">${r.informed_to?.department || 'N/A'}</div>
                                </div>
                            </div>

                            <div class="footer">
                                Generated on ${new Date().toLocaleString()} • Query Management System
                            </div>
                        </div>
                    </div>
                </body>
            </html>
        `);
        doc.document.close();
        doc.focus();
        doc.print();
    };

    const handleSort = (key) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    useEffect(() => {
        if (!selectedReport) return;
        setDetailPos({
            x: Math.max(24, window.innerWidth / 2 - 450),
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
        const config = platformConfig[platform?.toLowerCase()] || platformConfig.all;
        return config.icon;
    };

    return (
        <TooltipProvider>
            <div className="space-y-4">
                {/* Header Section */}
                <Card className="border-slate-200 rounded-xl bg-white overflow-hidden">
                    <CardHeader className="py-4 px-5 border-b bg-white">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="h-11 w-11 rounded-xl bg-sky-500 flex items-center justify-center">
                                    <HelpCircle className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl font-semibold text-slate-900">
                                        Query Reports
                                    </CardTitle>
                                    <CardDescription className="text-sm text-slate-500 flex items-center gap-2 mt-0.5">
                                        <span>Track and manage query resolution workflow</span>
                                        <span className="w-1 h-1 rounded-full bg-slate-300" />
                                        <span className="font-medium text-slate-700">{stats.total} total</span>
                                    </CardDescription>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <Input
                                        placeholder="Search reports..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="pl-8 h-9 w-[200px] lg:w-[260px] text-sm bg-white border-slate-200 focus:border-sky-300 focus:ring-sky-200"
                                    />
                                </div>

                                <Select value={platform} onValueChange={(v) => { setPlatform(v); setPage(1); }}>
                                    <SelectTrigger className="w-[140px] h-9 text-sm border-slate-200 bg-white">
                                        <SelectValue placeholder="Platform" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Platforms</SelectItem>
                                        <SelectItem value="x">X (Twitter)</SelectItem>
                                        <SelectItem value="facebook">Facebook</SelectItem>
                                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                                    </SelectContent>
                                </Select>

                                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                                    <SelectTrigger className="w-[140px] h-9 text-sm border-slate-200 bg-white">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Status</SelectItem>
                                        <SelectItem value="PENDING">Pending</SelectItem>
                                        <SelectItem value="CLOSED">Closed</SelectItem>
                                    </SelectContent>
                                </Select>

                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={fetchReports}
                                    className="gap-1.5 h-9 text-sm border-slate-200 hover:bg-slate-50"
                                >
                                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                                    Refresh
                                </Button>

                                <Button
                                    size="sm"
                                    onClick={handleExport}
                                    disabled={exporting || reports.length === 0}
                                    className="gap-1.5 h-9 text-sm bg-green-600 hover:bg-green-700 text-white"
                                >
                                    {exporting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Download className="h-4 w-4" />
                                    )}
                                    Export Excel
                                </Button>
                            </div>
                        </div>
                    </CardHeader>

                    {/* Stats Cards — only Total / Pending / Closed */}
                    <div className="grid grid-cols-3 gap-3 p-4 bg-white border-b border-slate-100">
                        <div
                            className={cn(
                                "bg-white rounded-lg p-3 border transition-all cursor-pointer hover:bg-slate-50",
                                statusFilter === 'all' ? "border-sky-500 ring-1 ring-sky-500/20" : "border-slate-200"
                            )}
                            onClick={() => { setStatusFilter('all'); setPage(1); }}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-slate-500">Total Reports</p>
                                    <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
                                </div>
                                <div className="h-10 w-10 rounded-lg bg-sky-50 flex items-center justify-center">
                                    <FileText className="h-5 w-5 text-sky-600" />
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
                    </div>

                    <CardContent className="p-0">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-20">
                                <div className="relative">
                                    <div className="h-16 w-16 rounded-full border-4 border-slate-100 border-t-sky-500 animate-spin" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <HelpCircle className="h-6 w-6 text-slate-400" />
                                    </div>
                                </div>
                                <p className="mt-4 text-sm text-slate-500">Loading query reports...</p>
                            </div>
                        ) : reports.length === 0 ? (
                            <div className="text-center py-20 px-4">
                                <div className="h-20 w-20 rounded-full bg-sky-50 flex items-center justify-center mx-auto mb-4">
                                    <HelpCircle className="h-10 w-10 text-sky-400" />
                                </div>
                                <h3 className="text-lg font-semibold text-slate-900 mb-2">No reports yet</h3>
                                <p className="text-sm text-slate-500 max-w-md mx-auto">
                                    No query reports found. Use the <span className="font-bold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">Q</span> button on grievance cards to create new reports.
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="overflow-auto max-h-[60vh] relative">
                                    <table className="w-full text-sm min-w-[1800px]">
                                        <thead className="bg-slate-50 sticky top-0 z-20">
                                            <tr className="border-b border-slate-200">
                                                {[
                                                    { key: 'si_no', label: 'Sl.No', width: 'w-16' },
                                                    { key: 'status', label: 'Status', width: 'w-28', sortable: true },
                                                    { key: 'unique_id', label: 'Unique ID', width: 'w-32' },
                                                    { key: 'post_date', label: 'Post Date', width: 'w-32', sortable: true },
                                                    { key: 'profile', label: 'Profile', width: 'w-44' },
                                                    { key: 'post_link', label: 'Link', width: 'w-16' },
                                                    { key: 'description', label: 'Description', width: 'min-w-[180px]' },
                                                    { key: 'category', label: 'Category', width: 'w-24', sortable: true },
                                                    { key: 'remarks', label: 'Remarks', width: 'min-w-[150px]' },
                                                    { key: 'informed_to', label: 'Informed to Officer', width: 'min-w-[150px]' },
                                                    { key: 'action_date', label: 'Action Taken', width: 'w-32', sortable: true },
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
                                                const status = statusConfig[r.status] || statusConfig.PENDING;
                                                const PlatformIcon = getPlatformIcon(r.platform);

                                                return (
                                                    <motion.tr
                                                        key={r.id}
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: idx * 0.02 }}
                                                        className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors group"
                                                    >
                                                        {/* 1. Sl.No + Eye */}
                                                        <td className="py-2.5 px-3 text-center">
                                                            <div className="flex flex-col items-center gap-1">
                                                                <span className="text-slate-400 font-mono text-[10px]">
                                                                    {(page - 1) * 50 + idx + 1}
                                                                </span>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            className="h-6 w-6 p-0 rounded-full hover:bg-violet-100 transition-colors"
                                                                            onClick={() => {
                                                                                setSelectedReport(r);
                                                                                setWaPhone(r.informed_to?.phone || '');
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
                                                                    setWaPhone(r.informed_to?.phone || '');
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

                                                        {/* 5. Profile */}
                                                        <td className="py-2.5 px-3">
                                                            <div className="flex items-center gap-2">
                                                                <div className="relative">
                                                                    {r.posted_by?.profile_image_url ? (
                                                                        <img src={r.posted_by.profile_image_url} alt="" className="h-7 w-7 rounded-full ring-2 ring-white" />
                                                                    ) : (
                                                                        <div className="h-7 w-7 rounded-full bg-slate-200 flex items-center justify-center border border-slate-100">
                                                                            <Users className="h-3.5 w-3.5 text-slate-500" />
                                                                        </div>
                                                                    )}
                                                                    <div className="absolute -bottom-1 -right-1">
                                                                        <PlatformIcon className="h-3.5 w-3.5 text-slate-500 bg-white rounded-full p-0.5 shadow-sm" />
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

                                                        {/* 6. Link */}
                                                        <td className="py-2.5 px-3 text-center">
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

                                                        {/* 7. Description */}
                                                        <td className="py-2.5 px-3">
                                                            <ExpandableText
                                                                text={r.post_description}
                                                                limit={100}
                                                                className="text-slate-700 text-xs leading-relaxed"
                                                            />
                                                        </td>

                                                        {/* 8. Category */}
                                                        <td className="py-2.5 px-3">
                                                            <Badge variant="outline" className="text-[9px] font-medium px-2 py-0.5 bg-slate-50 text-slate-700 border-slate-200 uppercase tracking-tight">
                                                                {r.category || '—'}
                                                            </Badge>
                                                        </td>

                                                        {/* 9. Remarks */}
                                                        <td className="py-2.5 px-3">
                                                            <ExpandableText
                                                                text={r.remarks}
                                                                limit={80}
                                                                className="text-slate-600 text-xs leading-relaxed italic"
                                                            />
                                                        </td>

                                                        {/* 10. Informed To */}
                                                        <td className="py-2.5 px-3">
                                                            {r.informed_to?.name ? (
                                                                <div className="space-y-0.5">
                                                                    <p className="font-medium text-slate-900 text-xs">{r.informed_to.name}</p>
                                                                    <p className="text-[9px] text-slate-500 flex items-center gap-1">
                                                                        <Phone className="h-2.5 w-2.5" />
                                                                        {r.informed_to.phone}
                                                                    </p>
                                                                </div>
                                                            ) : <span className="text-slate-400 text-xs italic">—</span>}
                                                        </td>

                                                        {/* 11. Action Taken */}
                                                        <td className="py-2.5 px-3">
                                                            {r.action_taken_at ? (
                                                                <div className="flex flex-col">
                                                                    <span className="text-slate-900 text-xs font-medium">{fmtDate(r.action_taken_at)}</span>
                                                                    <span className="text-[9px] text-slate-400">{fmtRelativeTime(r.action_taken_at)}</span>
                                                                </div>
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
                                    width: Math.min(900, window.innerWidth - 48),
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
                                        <span className="text-sm font-semibold text-slate-900">Query Report</span>
                                        <Badge className="bg-amber-50 text-amber-700 border-amber-200 font-mono text-[10px]">
                                            {selectedReport.unique_code}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {selectedReport.report_pdf_url ? (
                                            <div className="flex items-center gap-2 mr-4 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                                                <div className="bg-white p-0.5 rounded shadow-sm">
                                                    <QRCodeSVG
                                                        value={selectedReport.report_pdf_url}
                                                        size={32}
                                                        level="M"
                                                    />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[7px] text-slate-500 font-bold uppercase tracking-widest leading-none">PDF Scan</span>
                                                    <span className="text-[6px] text-slate-400 font-medium leading-none mt-0.5 whitespace-nowrap">Scan to view</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 mr-4 opacity-40 bg-slate-50/50 px-2 py-1 rounded-lg border border-dashed border-slate-200">
                                                <div className="w-[32px] h-[32px] rounded border border-dashed border-slate-300 flex items-center justify-center bg-white">
                                                    <Loader2 className={cn("h-3 w-3 text-slate-300", pdfGenerating && "animate-spin")} />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[7px] text-slate-400 font-bold uppercase tracking-widest leading-none">{pdfGenerating ? 'Generating' : 'No PDF'}</span>
                                                </div>
                                            </div>
                                        )}
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-slate-100" onClick={() => setFullscreen(!fullscreen)}>
                                            {fullscreen ? <Minimize2 className="h-4 w-4 text-slate-600" /> : <Maximize2 className="h-4 w-4 text-slate-600" />}
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full hover:bg-slate-100 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => setSelectedReport(null)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>

                                {/* Modal Tabs */}
                                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                                    <div className="px-5 pt-2 border-b">
                                        <TabsList className="bg-slate-100">
                                            <TabsTrigger value="details" className="text-xs">Details</TabsTrigger>
                                            <TabsTrigger value="resolution" className="text-xs">Resolution</TabsTrigger>
                                            <TabsTrigger value="media" className="text-xs">Media</TabsTrigger>
                                            <TabsTrigger value="share" className="text-xs">Share</TabsTrigger>
                                        </TabsList>
                                    </div>

                                    <ScrollArea className="flex-1 p-5">
                                        <TabsContent value="details" className="mt-0 space-y-5">
                                            {/* Status Banner */}
                                            <div className={cn(
                                                "p-4 rounded-xl border flex items-center justify-between",
                                                statusConfig[selectedReport.status]?.bg,
                                                statusConfig[selectedReport.status]?.border
                                            )}>
                                                <div className="flex items-center gap-3">
                                                    {React.createElement(statusConfig[selectedReport.status]?.icon || Clock, {
                                                        className: cn("h-5 w-5", statusConfig[selectedReport.status]?.text)
                                                    })}
                                                    <div>
                                                        <p className="text-xs text-slate-500">Current Status</p>
                                                        <p className={cn("text-sm font-semibold", statusConfig[selectedReport.status]?.text)}>
                                                            {statusConfig[selectedReport.status]?.label || 'Pending'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <Badge className={cn(
                                                    "text-xs",
                                                    statusConfig[selectedReport.status]?.bg,
                                                    statusConfig[selectedReport.status]?.text
                                                )}>
                                                    Last updated {fmtRelativeTime(selectedReport.updated_at)}
                                                </Badge>
                                            </div>

                                            <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
                                                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/80 backdrop-blur-sm">
                                                    <div className="p-1.5 bg-sky-100/50 rounded-lg text-sky-600">
                                                        <Clock className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-bold text-slate-800 block">Status Timeline</span>
                                                        <span className="text-[10px] text-slate-500 font-medium">Tracking the lifecycle of this query</span>
                                                    </div>
                                                </div>
                                                <div className="p-6 md:p-8">
                                                    <div className="relative pl-6 sm:pl-10 space-y-8 before:absolute before:left-3 sm:before:left-5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                                                        {timelineSteps.map((step, idx) => {
                                                            const c = step.color || 'yellow';
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
                                                                                {idx === 0 ? <Plus className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
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
                                                                                    <Users className="h-4 w-4 text-slate-500" />
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

                                            {/* Key Info Grid */}
                                            <div className="grid grid-cols-3 gap-3">
                                                {[
                                                    { icon: Calendar, label: 'Post Date', value: fmtDate(selectedReport.post_date) },
                                                    { icon: Tag, label: 'Category', value: selectedReport.category || 'Others' },
                                                    { icon: Users, label: 'Profile', value: selectedReport.profile_id || selectedReport.posted_by?.display_name || '—' },
                                                    { icon: Users, label: 'Informed To', value: selectedReport.informed_to?.name || 'Not shared' },
                                                    { icon: Clock, label: 'Action Date', value: fmtDate(selectedReport.action_taken_at) || 'Pending' },
                                                    {
                                                        icon: Link2, label: 'Post Link', value: selectedReport.post_link ? (
                                                            <a href={selectedReport.post_link} target="_blank" rel="noopener noreferrer"
                                                                className="text-blue-600 hover:underline inline-flex items-center gap-1 text-xs">
                                                                View Post <ExternalLink className="h-3 w-3" />
                                                            </a>
                                                        ) : '—'
                                                    }
                                                ].map((item, i) => (
                                                    <div key={i} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                                                        <div className="flex items-center gap-2 mb-1.5">
                                                            <item.icon className="h-3.5 w-3.5 text-slate-400" />
                                                            <span className="text-[9px] font-medium text-slate-500 uppercase tracking-wider">
                                                                {item.label}
                                                            </span>
                                                        </div>
                                                        <div className="text-sm text-slate-900 font-medium">
                                                            {item.value}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Description */}
                                            <div className="rounded-xl border border-slate-200 overflow-hidden">
                                                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                                                    <FileText className="h-4 w-4 text-slate-400" />
                                                    <span className="text-xs font-medium text-slate-700">Description</span>
                                                </div>
                                                <div className="p-4 bg-white">
                                                    <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                                        {selectedReport.post_description || 'No description provided'}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Remarks */}
                                            <div className="rounded-xl border border-slate-200 overflow-hidden">
                                                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                                                    <MessageSquare className="h-4 w-4 text-slate-400" />
                                                    <span className="text-xs font-medium text-slate-700">Remarks</span>
                                                </div>
                                                <div className="p-4 bg-white">
                                                    <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                                        {selectedReport.remarks || 'No remarks added'}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Direct Media Preview */}
                                            {(() => {
                                                const mediaUrls = (Array.isArray(selectedReport.media_s3_urls) && selectedReport.media_s3_urls.length > 0
                                                    ? selectedReport.media_s3_urls
                                                    : (selectedReport.media_urls || []));

                                                return mediaUrls.length > 0 && (
                                                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                                                        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                                                            <Image className="h-4 w-4 text-slate-400" />
                                                            <span className="text-xs font-medium text-slate-700">Media Attachments</span>
                                                            <Badge variant="outline" className="ml-auto text-[10px]">
                                                                {mediaUrls.length} items
                                                            </Badge>
                                                        </div>
                                                        <div className="p-4 bg-white">
                                                            <div className="grid grid-cols-2 gap-3">
                                                                {mediaUrls.map((url, i) => (
                                                                    <div
                                                                        key={i}
                                                                        className="group relative aspect-video rounded-xl border border-slate-200 overflow-hidden hover:border-sky-300 transition-colors cursor-pointer"
                                                                        onClick={() => setPreviewMedia(url)}
                                                                    >
                                                                        {isVideoUrl(url) ? (
                                                                            <div className="h-full w-full bg-slate-900 flex items-center justify-center">
                                                                                <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
                                                                                    <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[10px] border-l-white border-b-[6px] border-b-transparent ml-1" />
                                                                                </div>
                                                                            </div>
                                                                        ) : (
                                                                            <img
                                                                                src={url}
                                                                                alt={`Media ${i + 1}`}
                                                                                className="h-full w-full object-cover"
                                                                                loading="lazy"
                                                                                referrerPolicy="no-referrer"
                                                                            />
                                                                        )}
                                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                            <span className="text-[10px] text-white font-medium bg-black/50 px-2 py-1 rounded-full backdrop-blur-sm">Click to view</span>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </TabsContent>

                                        <TabsContent value="resolution" className="mt-0 space-y-5">
                                            {selectedReport.status === 'CLOSED' ? (
                                                <>
                                                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                                                        <div className="px-4 py-2 bg-green-50 border-b border-green-200 flex items-center gap-2">
                                                            <Check className="h-4 w-4 text-green-600" />
                                                            <span className="text-xs font-medium text-green-700">Operator Reply</span>
                                                        </div>
                                                        <div className="p-4 bg-white">
                                                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                                                {selectedReport.operator_reply || 'No reply recorded'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                                                        <div className="px-4 py-2 bg-sky-50 border-b border-sky-200 flex items-center gap-2">
                                                            <MessageSquare className="h-4 w-4 text-sky-600" />
                                                            <span className="text-xs font-medium text-sky-700">Final Reply to User</span>
                                                        </div>
                                                        <div className="p-4 bg-white">
                                                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                                                {selectedReport.final_reply_to_user || 'No reply recorded'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                                                        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                                                            <FileText className="h-4 w-4 text-slate-400" />
                                                            <span className="text-xs font-medium text-slate-700">Closing Remarks</span>
                                                        </div>
                                                        <div className="p-4 bg-white">
                                                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                                                {selectedReport.closing_remarks || 'No closing remarks'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* Closing Media */}
                                                    {(selectedReport.closing_media_s3_urls?.length > 0) && (
                                                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                                                            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                                                                <Image className="h-4 w-4 text-slate-400" />
                                                                <span className="text-xs font-medium text-slate-700">Closing Attachments</span>
                                                                <Badge variant="outline" className="ml-auto text-[10px]">
                                                                    {selectedReport.closing_media_s3_urls.length} items
                                                                </Badge>
                                                            </div>
                                                            <div className="p-4 bg-white">
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    {selectedReport.closing_media_s3_urls.map((url, i) => (
                                                                        <a
                                                                            key={i}
                                                                            href={url}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-colors group"
                                                                        >
                                                                            <div className="h-8 w-8 rounded bg-slate-100 flex items-center justify-center group-hover:bg-sky-100">
                                                                                <Image className="h-4 w-4 text-slate-400 group-hover:text-sky-600" />
                                                                            </div>
                                                                            <div className="flex-1 min-w-0">
                                                                                <p className="text-xs font-medium text-slate-700 truncate">Attachment {i + 1}</p>
                                                                                <p className="text-[10px] text-slate-400 truncate">{url.split('/').pop()}</p>
                                                                            </div>
                                                                            <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-sky-600" />
                                                                        </a>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="text-center py-12">
                                                    <div className="h-16 w-16 rounded-full bg-yellow-50 flex items-center justify-center mx-auto mb-3">
                                                        <Clock className="h-8 w-8 text-yellow-400" />
                                                    </div>
                                                    <p className="text-sm font-medium text-slate-900 mb-1">Query Still Pending</p>
                                                    <p className="text-xs text-slate-500">Resolution details will appear here once the query is closed.</p>
                                                </div>
                                            )}
                                        </TabsContent>

                                        <TabsContent value="media" className="mt-0 space-y-5">
                                            {(() => {
                                                const mediaUrls = (Array.isArray(selectedReport.media_s3_urls) && selectedReport.media_s3_urls.length > 0
                                                    ? selectedReport.media_s3_urls
                                                    : (selectedReport.media_urls || []));

                                                return mediaUrls.length > 0 ? (
                                                    <div className="grid grid-cols-2 gap-3">
                                                        {mediaUrls.map((url, i) => (
                                                            <div
                                                                key={i}
                                                                className="group relative aspect-video rounded-xl border border-slate-200 overflow-hidden hover:border-sky-300 transition-colors"
                                                            >
                                                                {isVideoUrl(url) ? (
                                                                    <video
                                                                        src={url}
                                                                        controls
                                                                        playsInline
                                                                        preload="metadata"
                                                                        className="h-full w-full object-cover bg-black"
                                                                    >
                                                                        Your browser does not support the video tag.
                                                                    </video>
                                                                ) : (
                                                                    <img
                                                                        src={url}
                                                                        alt={`Media ${i + 1}`}
                                                                        className="h-full w-full object-cover bg-slate-100"
                                                                        loading="lazy"
                                                                        referrerPolicy="no-referrer"
                                                                        onError={(e) => {
                                                                            e.currentTarget.style.display = 'none';
                                                                            const fallback = e.currentTarget.parentElement?.querySelector('[data-media-fallback]');
                                                                            if (fallback) fallback.classList.remove('hidden');
                                                                        }}
                                                                    />
                                                                )}
                                                                <div data-media-fallback className="hidden absolute inset-0 bg-slate-100 flex items-center justify-center">
                                                                    <Image className="h-8 w-8 text-slate-400" />
                                                                </div>
                                                                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setPreviewMedia(url);
                                                                    }}
                                                                    className="absolute top-2 right-2 bg-white/90 backdrop-blur rounded-full px-2 py-1 text-[9px] font-medium hover:bg-white"
                                                                >
                                                                    Preview
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="text-center py-12">
                                                        <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                                                            <Image className="h-8 w-8 text-slate-400" />
                                                        </div>
                                                        <p className="text-sm text-slate-500">No media attached to this report</p>
                                                    </div>
                                                );
                                            })()}
                                        </TabsContent>

                                        <TabsContent value="share" className="mt-0 space-y-5">
                                            <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5">
                                                <div className="flex items-center gap-3 mb-4">
                                                    <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
                                                        <MessageSquare className="h-5 w-5 text-emerald-600" />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-semibold text-slate-900">Share via WhatsApp</h4>
                                                        <p className="text-xs text-slate-500">Send report details to concerned parties</p>
                                                    </div>
                                                </div>

                                                <div className="space-y-3">
                                                    <div>
                                                        <label className="text-xs font-medium text-slate-700 mb-1 block">
                                                            WhatsApp Number
                                                        </label>
                                                        <div className="flex gap-2">
                                                            <Input
                                                                value={waPhone}
                                                                onChange={(e) => setWaPhone(e.target.value)}
                                                                placeholder="e.g., 9876543210"
                                                                className="flex-1 h-10 text-sm border-slate-200 focus:border-emerald-300 focus:ring-emerald-200"
                                                            />
                                                            <Button
                                                                onClick={handleShareViaWhatsApp}
                                                                className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white shadow-sm shadow-emerald-200"
                                                            >
                                                                {copied ? (
                                                                    <Check className="h-4 w-4 mr-2" />
                                                                ) : (
                                                                    <Share2 className="h-4 w-4 mr-2" />
                                                                )}
                                                                Share
                                                            </Button>
                                                        </div>
                                                        <p className="text-[9px] text-slate-400 mt-1">
                                                            Include country code (e.g., 91 for India)
                                                        </p>
                                                    </div>

                                                    <Separator />

                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs text-slate-600">Preview message</span>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={handleCopyToClipboard}
                                                            className="h-7 text-xs gap-1"
                                                        >
                                                            <Copy className="h-3 w-3" />
                                                            Copy All
                                                        </Button>
                                                    </div>

                                                    <div className="bg-slate-100 rounded-lg p-3 text-[10px] font-mono whitespace-pre-wrap max-h-32 overflow-auto">
                                                        {buildShareMessage(selectedReport)}
                                                    </div>
                                                </div>
                                            </div>
                                        </TabsContent>
                                    </ScrollArea>
                                </Tabs>

                                {/* Modal Footer */}
                                <div className="px-5 py-4 border-t bg-slate-50/80 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handlePrintPdf}
                                            className="gap-2 text-sm border-slate-200 hover:bg-white"
                                        >
                                            <Printer className="h-4 w-4" />
                                            Print / Save PDF
                                        </Button>
                                        {selectedReport.report_pdf_url && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                asChild
                                                className="gap-2 text-sm border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                                            >
                                                <a href={selectedReport.report_pdf_url} target="_blank" rel="noopener noreferrer">
                                                    <Download className="h-4 w-4" />
                                                    Download PDF
                                                </a>
                                            </Button>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setSelectedReport(null)}
                                            className="text-sm"
                                        >
                                            Close
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => setActiveTab('share')}
                                            className="bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-700 hover:to-sky-800 text-white gap-2 text-sm"
                                        >
                                            <Share2 className="h-4 w-4" />
                                            Share Report
                                        </Button>
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
        </TooltipProvider >
    );
};

export default QueryReports;
