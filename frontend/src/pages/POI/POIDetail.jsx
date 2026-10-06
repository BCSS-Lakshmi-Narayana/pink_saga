import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
    User, Users, Edit, Save, X, FileText, Globe,
    Facebook, Instagram, Youtube, Twitter,
    ArrowLeft, Activity, MapPin, Hash,
    PlusCircle, MinusCircle, Loader2, Trash2,
    Search, Link as LinkIcon, AlertTriangle, CheckCircle, Shield,
    PanelLeftClose, PanelLeftOpen, Camera, ExternalLink,
    Phone, Mail, Plus, XCircle, Monitor, Home, Cpu, MessageCircle,
    LayoutGrid, Edit2, AlertCircle, FilePlus, Download, Check,
    Calendar, Eye, Printer, BarChart2,
    Square, CheckSquare
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { QRCodeCanvas } from 'qrcode.react';

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

import { toast } from 'sonner';
import { TwitterAlertCard, YoutubeAlertCard } from '../../components/AlertCards';
import ManageProfileImageDialog from './ManageProfileImageDialog';
import AddSourceModal from '../../components/AddSourceModal';
import api, { BACKEND_URL } from '../../lib/api'; // Use authenticated API helper
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { Badge } from '../../components/ui/badge';

const CATEGORY_OPTIONS = [
    { value: 'political', label: 'Political' },
    { value: 'communal', label: 'Communal' },
    { value: 'trouble_makers', label: 'Trouble Makers' },
    { value: 'defamation', label: 'Defamation' },
    { value: 'narcotics', label: 'Narcotics' },
    { value: 'history_sheeters', label: 'History Sheeters' },
    { value: 'others', label: 'Others' }
];

const XLogo = ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
);

const WhatsAppLogo = ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
);

const FacebookLogo = ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
);

// Helper to generate social media URLs
const getSocialMediaUrl = (platform, handle) => {
    if (!handle) return '#';
    const cleanHandle = handle.replace(/^@/, ''); // Remove leading @ for most platforms

    switch (platform) {
        case 'twitter':
        case 'x':
            return `https://twitter.com/${cleanHandle}`;
        case 'facebook':
            return `https://facebook.com/${cleanHandle}`;
        case 'instagram':
            return `https://instagram.com/${cleanHandle}`;
        case 'youtube':
            // YouTube handles usually start with @, channels don't.
            // If it starts with @, use that. If not, assume it's a channel ID or query
            if (handle.startsWith('@')) {
                return `https://youtube.com/${handle}`;
            }
            return `https://youtube.com/channel/${handle}`;
        default:
            return '#';
    }
};

const POIDetail = () => {
    const observerTarget = React.useRef(null);
    const reportRef = React.useRef(null);
    const lastFetchedRef = React.useRef({ sourceId: null, platform: null, handle: null, selectedSourceId: null });
    const fetchIdRef = React.useRef(0);
    const reportFetchIdRef = React.useRef(0);
    const isFetchingFeedRef = React.useRef(false); // Immediate lock for content feed
    const pageRef = React.useRef(1); // Synchronous page tracking
    const isFetchingReportsRef = React.useRef(false); // Immediate lock for reports
    const prevPlatformRef = React.useRef(null);
    const { id } = useParams();
    const location = useLocation();
    const navigate = useNavigate();

    // Initial Data Setup
    const initialData = location.state?.poi || {
        _id: id || '1',
        name: 'Loading...',
        realName: '',
        aliasNames: [],
        mobileNumbers: [],
        emailIds: [],
        briefSummary: '',
        firNo: '',
        lastUsedIp: '',
        lastUsedDevice: '',
        currentAddress: '',
        psLimits: '',
        districtCommisionerate: '',
        softwareHardwareIdentifiers: '',
        firDetails: [],
        linkedIncidents: '',
        whatsappNumbers: [],
        profileImage: null,
        customFields: [],
        socialMedia: []
    };

    // Normalize data if necessary
    if (initialData.description && !initialData.briefSummary) {
        initialData.briefSummary = initialData.description;
    }

    // Main States
    const [poiData, setPoiData] = useState(initialData);
    const navPlatform = location.state?.selectedPlatform;
    const [selectedPlatform, setSelectedPlatform] = useState(
        navPlatform === 'x' ? 'twitter' : (navPlatform || 'twitter')
    );
    const [statsLoading, setStatsLoading] = useState(false);
    const [escalationStats, setEscalationStats] = useState({
        escalated: 0,
        sentToIntermediary: 0,
        closed: 0
    });
    const [totalEscalatedCount, setTotalEscalatedCount] = useState(0);

    // Right Panel Tabs State
    const [rightPanelTab, setRightPanelTab] = useState('content');
    const [reports, setReports] = useState([]);
    const [reportPage, setReportPage] = useState(1);
    const [hasMoreReports, setHasMoreReports] = useState(true);
    const [loadingMoreReports, setLoadingMoreReports] = useState(false);
    const aggregatedCategories = React.useMemo(() => {
        const categories = new Set();
        (poiData.socialMedia || []).forEach(sm => {
            if (sm.category && sm.category !== 'others') {
                const option = CATEGORY_OPTIONS.find(opt => opt.value === sm.category);
                categories.add(option ? option.label : sm.category);
            }
        });
        const list = Array.from(categories);
        return list.length > 0 ? list.join(', ') : 'Others';
    }, [poiData.socialMedia]);

    const fetchEscalationStats = async (handlesToFetch, isLoadMore = false) => {
        if (!handlesToFetch || (Array.isArray(handlesToFetch) && handlesToFetch.length === 0)) return;
        if (isFetchingReportsRef.current) return; // Block concurrent requests

        // Convert to array if it's a single handle string
        const handlesArray = Array.isArray(handlesToFetch) ? handlesToFetch : [handlesToFetch];
        // Clean handles and filter out empties
        const cleanHandles = handlesArray.map(h => h.replace('@', '')).filter(Boolean);

        if (cleanHandles.length === 0) return;

        const currentFetchId = ++reportFetchIdRef.current;
        isFetchingReportsRef.current = true;
        if (!isLoadMore) {
            setStatsLoading(true);
            setReportPage(1);
        } else {
            setLoadingMoreReports(true);
        }

        try {
            // Check if we are searching for multiple handles
            const searchQuery = cleanHandles.join(',');
            const currentPage = isLoadMore ? reportPage + 1 : 1;
            const res = await api.get(`/reports?search=${encodeURIComponent(searchQuery)}&page=${currentPage}&limit=20`);

            // Abort if a newer request has been started (prevents race conditions)
            if (currentFetchId !== reportFetchIdRef.current) return;

            const reportsData = res.data || [];

            if (isLoadMore) {
                setReports(prev => [...prev, ...reportsData]);
                setReportPage(currentPage);
            } else {
                setReports(reportsData); // Store full reports for the tab

                // Also update escalation stats summary based on a separate call or calculated from full data
                // For now, if we are paginating, we might need a separate endpoint for total metrics if we want them accurate
                setEscalationStats({
                    escalated: reportsData.length, // This is just the first page count now, we need a better way if we want total
                    sentToIntermediary: reportsData.filter(r => ['sent', 'sent_to_intermediary', 'awaiting_reply'].includes(r.status)).length,
                    closed: reportsData.filter(r => ['closed', 'resolved'].includes(r.status)).length
                });
            }

            setHasMoreReports(reportsData.length === 20);

            setEscalationStats({
                escalated: reportsData.length,
                sentToIntermediary: reportsData.filter(r => ['sent', 'sent_to_intermediary', 'awaiting_reply'].includes(r.status)).length,
                closed: reportsData.filter(r => ['closed', 'resolved'].includes(r.status)).length
            });
        } catch (error) {
            console.error('Failed to fetch escalation stats:', error);
        } finally {
            if (currentFetchId === reportFetchIdRef.current) {
                setStatsLoading(false);
                setLoadingMoreReports(false);
                isFetchingReportsRef.current = false; // Release lock
            }
        }
    };
    const [isEditing, setIsEditing] = useState(false);
    const [originalData, setOriginalData] = useState(null);
    const [saving, setSaving] = useState(false);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [discardTarget, setDiscardTarget] = useState(null); // 'back'

    // Social Data States
    const [linkedHandles, setLinkedHandles] = useState([]);
    const [linkedHandle, setLinkedHandle] = useState(null);
    const [sources, setSources] = useState([]);
    const [loadingSources, setLoadingSources] = useState(false);
    const [contentFeed, setContentFeed] = useState([]);
    const [loadingFeed, setLoadingFeed] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [isFetchingMore, setIsFetchingMore] = useState(false);

    // Link Source States
    const [searchTerm, setSearchTerm] = useState('');
    const [isUnlinkingMode, setIsUnlinkingMode] = useState(false);
    const [unlinkingSelection, setUnlinkingSelection] = useState([]);
    const [isLinking, setIsLinking] = useState(true); // Default to true to prevent blank screen during initialization
    const [linkingIdx, setLinkingIdx] = useState(null);
    const [selectedSourceId, setSelectedSourceId] = useState(null);
    const [linkStep, setLinkStep] = useState('search'); // 'search' | 'create'
    const [newSourceForm, setNewSourceForm] = useState({
        identifier: '',
        display_name: '',
        category: 'others',
        is_active: true,
        priority: 'medium'
    });
    const [creatingSource, setCreatingSource] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [addSourceDialogOpen, setAddSourceDialogOpen] = useState(false);
    const [isAddSourceDirty, setIsAddSourceDirty] = useState(false);
    const [manageImageOpen, setManageImageOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [predictiveQrUrl, setPredictiveQrUrl] = useState(null);

    // Common derived variables
    const platforms = [
        { id: 'twitter', label: 'X', icon: XLogo, text: 'text-black', bg: 'bg-gray-100', border: 'border-gray-200', activeText: 'text-black', activeBorder: 'border-black' },
        { id: 'facebook', label: 'Facebook', icon: FacebookLogo, text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100', activeText: 'text-blue-600', activeBorder: 'border-blue-600' },
        { id: 'instagram', label: 'Instagram', icon: Instagram, text: 'text-pink-600', bg: 'bg-pink-50', border: 'border-pink-100', activeText: 'text-pink-600', activeBorder: 'border-pink-600' },
        { id: 'youtube', label: 'YouTube', icon: Youtube, text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-100', activeText: 'text-red-600', activeBorder: 'border-red-600' }
    ];

    const effectiveProfileImage = poiData.profileImage && poiData.profileImage !== '' && !poiData.profileImage.includes('placeholder')
        ? poiData.profileImage
        : (() => {
            const sm = poiData.socialMedia?.find(s => s.avatar || s.profileImage || s.profile_image_url || s.profile_image || s.thumbnail);
            if (sm) return sm.avatar || sm.profileImage || sm.profile_image_url || sm.profile_image || sm.thumbnail;

            // Fallback to source-level images if available
            const src = sources.find(s => poiData.socialMedia?.some(sm => sm.sourceId === s.id || sm.sourceId === s._id));
            return src?.profileImage || src?.avatar || src?.profile_image_url || null;
        })();

    const proxifyImageUrl = (url) => {
        if (!url || typeof url !== 'string' || url === '') return url;

        // If it's a data URI or blob, it's already local/embedded
        if (url.startsWith('data:') || url.includes('blob:')) return url;

        // If it already includes our backend host, don't double proxify
        // UNLESS it's a direct /uploads path, in which case we still want to go through the proxy for CORS headers in reports
        if (url.includes(window.location.hostname) && !url.includes('/uploads/')) return url;

        // Use the stream proxy for EVERYTHING (local uploads and external social photos)
        // This ensures:
        // 1. Absolute URLs (fixes sidebar on port 3000)
        // 2. Proper CORS headers (fixes report printing/archive with html2canvas)
        // 3. Robust loading across all environments
        return `${BACKEND_URL}/api/media/stream?url=${encodeURIComponent(url)}`;
    };

    const getMobileFriendlyUrl = (forcedUrl = null) => {
        // If an explicit URL is forced (e.g. during capture), use it
        if (forcedUrl) return forcedUrl;

        // If we are currently generating a report (as reflected in state), use the predictive URL
        if (predictiveQrUrl) return predictiveQrUrl;

        // Otherwise use the stored URL if it exists
        if (poiData.s3ReportUrl) return poiData.s3ReportUrl;

        // Fallback (should ideally not be reached during export)
        return "https://blura.in/reports/waiting";
    };

    const handleExportReport = () => {
        handleUploadToS3();
    };

    const handleUploadToS3 = async () => {
        if (isUploading) return;

        const reportElement = reportRef.current;
        if (!reportElement) {
            toast.error("Report content not found");
            return;
        }

        try {
            setIsUploading(true);
            const toastId = toast.loading("Arriving at Cloud Authority...");

            // 1. Get Predictive S3 URL & Key from Backend (Single Source of Truth)
            const fileName = `POI_Report_${poiData.realName || poiData.name}.pdf`.replace(/\s+/g, '_');
            const predRes = await api.get(`/uploads/predict?filename=${fileName}`);
            const { url: finalS3Url, key: finalS3Key } = predRes.data;
            console.log(`!!!! [CLOUD AUTHORITY] STAGE 1: Prediction URL: ${finalS3Url}, Key: ${finalS3Key}`);

            // 2. Synchronously set the predictive URL for the NEXT render
            setPredictiveQrUrl(finalS3Url);

            // S3 Authority requires absolute sync. We wait 1.2s to ensure the QR is baked.
            await new Promise(resolve => setTimeout(resolve, 1200));

            // 4. Capture to Canvas
            const canvas = await html2canvas(reportElement, {
                scale: 2,
                useCORS: true,
                logging: false,
                windowWidth: 794,
                onclone: (clonedDoc) => {
                    // Ensure the report is visible in the cloned DOM for capture
                    const el = clonedDoc.querySelector('.hidden-report-container');
                    if (el) {
                        el.style.position = 'relative';
                        el.style.left = '0';
                        el.style.top = '0';
                        el.style.display = 'block';
                        el.style.visibility = 'visible';
                        el.style.opacity = '1';
                        el.style.width = '210mm';
                        el.style.backgroundColor = 'white';
                        el.style.pointerEvents = 'auto';
                    }
                }
            });

            // 6. Create PDF (Multi-page with Precise Margins & Masking)
            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();

            const margin = 10; // 10mm margin
            const printWidth = pageWidth - (margin * 2);
            const printHeight = pageHeight - (margin * 2);

            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
            const imgHeightInMm = (canvasHeight * printWidth) / canvasWidth;

            let heightLeft = imgHeightInMm;
            let pageIdx = 0;

            while (heightLeft > 0) {
                if (pageIdx > 0) pdf.addPage();

                // 1. Draw image shifted by precisely the print height
                pdf.addImage(imgData, 'JPEG', margin, margin - (pageIdx * printHeight), printWidth, imgHeightInMm);

                // 2. MASKING: Overwrite margins with white to hide bleed-over from huge canvas
                pdf.setFillColor(255, 255, 255);
                pdf.rect(0, 0, pageWidth, margin, 'F'); // Top
                pdf.rect(0, pageHeight - margin, pageWidth, margin, 'F'); // Bottom
                pdf.rect(0, 0, margin, pageHeight, 'F'); // Left
                pdf.rect(pageWidth - margin, 0, margin, pageHeight, 'F'); // Right

                heightLeft -= printHeight;
                pageIdx++;
            }

            const pdfBlob = pdf.output('blob');

            // 7. Upload to S3 with the Authority Key in the URL
            const formData = new FormData();
            formData.append('files', pdfBlob, fileName);

            console.log(`[Cloud Sync] ðŸ“¤ Uploading to Authority Key: ${finalS3Key}`);

            // NOTE: We do NOT set 'Content-Type' manually for FormData with Axios.
            // Axios/the browser will set the boundary automatically.
            // We pass the finalS3Key in BOTH query and header for maximum reliability.
            const uploadRes = await api.post(`/uploads/s3?customKey=${encodeURIComponent(finalS3Key)}`, formData, {
                headers: {
                    'x-s3-key': finalS3Key
                }
            });

            console.log(`[Cloud Sync] ðŸ“¥ Server Response Metadata:`, uploadRes.data);

            if (!uploadRes.data.uploads || uploadRes.data.uploads.length === 0) {
                throw new Error("Server responded with 200 but no upload metadata found.");
            }

            const s3Url = uploadRes.data.uploads[0].url;
            console.log(`[Cloud Sync Success] âœ… Final Verified URL: ${s3Url}`);

            // 8. Update POI Record
            await api.put(`/poi/${poiData._id}`, { s3ReportUrl: s3Url });
            console.log(`[Cloud Sync] POI record updated with s3ReportUrl`);

            setPoiData(prev => ({ ...prev, s3ReportUrl: s3Url }));

            toast.dismiss(toastId);
            toast.success("Synchronized Cloud Report Archived Successfully");

            // Print BEFORE resetting state to avoid re-render blankness
            window.print();
            setPredictiveQrUrl(null);
        } catch (error) {
            console.error("âŒ Cloud Authority Error:", error);
            if (error.response) {
                console.error("âŒ Server Error Data:", error.response.data);
                console.error("âŒ Server Error Status:", error.response.status);
            }
            toast.error(`Cloud synchronization failed: ${error.message}`);
            setPredictiveQrUrl(null);

            // Still allow local printing as fallback
            window.print();
        } finally {
            setIsUploading(false);
        }
    };

    const renderReportDocument = (isForPreview = false, forcedUrl = null) => {
        const reportBody = (
            <>
                {/* 1. White Header - Removed Navy Background */}
                <div className="p-0 bg-white rounded-t-xl font-sans relative text-center border-b-2 border-slate-100">
                    {/* Top Heading */}
                    <div className="mb-0 pb-10">
                        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-normal [word-spacing:0.25em]">
                            Profile of {poiData.realName || poiData.name}
                        </h1>
                    </div>

                    {/* Identity Section (Centered Photo & Name) */}
                    <div className="relative mb-6 px-4">
                        {/* QR Code (Floating Top Right - Subtle) */}
                        <div className="absolute top-0 right-4 flex flex-col items-center gap-1">
                            <QRCodeCanvas
                                value={getMobileFriendlyUrl(forcedUrl)}
                                size={150}
                                level="H"
                                includeMargin={true}
                                bgColor="#ffffff"
                                fgColor="#000000"
                                className="bg-white rounded-lg shadow-sm"
                                style={{ display: 'block' }}
                            />
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">Scan to view/download</span>
                        </div>

                        {/* Centered Profile Identity */}
                        <div className="flex flex-col items-center justify-center pt-4">
                            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-slate-100 shadow-sm mb-4">
                                {effectiveProfileImage ? (
                                    <img
                                        src={proxifyImageUrl(effectiveProfileImage)}
                                        alt={poiData.name}
                                        className="w-full h-full object-cover"
                                        crossOrigin="anonymous"
                                    />
                                ) : (
                                    <div className="w-full h-full bg-slate-50 flex items-center justify-center text-slate-300">
                                        <User className="w-16 h-16" />
                                    </div>
                                )}
                            </div>
                            <h2 className="text-2xl font-bold text-slate-800 tracking-tight leading-tight text-center">
                                {poiData.realName || poiData.name || 'Unknown'}
                            </h2>
                        </div>
                    </div>

                    {/* Brief Summary - Center Aligned Below */}
                    <div className="pt-6 border-t border-slate-50 max-w-3xl mx-auto break-inside-avoid">
                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                            Brief Summary
                        </label>
                        <div className="text-[15px] text-slate-600 leading-relaxed break-words whitespace-pre-wrap text-center">
                            {poiData.briefSummary || <span className="text-slate-300 italic">No summary available.</span>}
                        </div>
                    </div>
                </div>

                {/* 2. White Content Body - Exactly like Sidebar */}
                {/* Alias Names */}
                <div className="flex items-start break-inside-avoid">
                    <div className="w-1/2 shrink-0">
                        <span className="text-[13px] font-semibold text-slate-500">Alias Names</span>
                        <div className="text-[10px] text-slate-400 italic">(in real world / social media)</div>
                    </div>
                    <div className="w-1/2 flex items-start">
                        <span className="text-[13px] text-slate-400 mr-2">:</span>
                        <span className="text-[14px] text-slate-700">
                            {poiData.aliasNames && poiData.aliasNames.length > 0 ? poiData.aliasNames.join(', ') : 'Unknown'}
                        </span>
                    </div>
                </div>

                <div className="h-px bg-slate-100" />

                {/* Category */}
                <div className="flex items-start break-inside-avoid">
                    <div className="w-1/2 shrink-0">
                        <span className="text-[13px] font-semibold text-slate-500">Category</span>
                    </div>
                    <div className="w-1/2 flex items-start">
                        <span className="text-[13px] text-slate-400 mr-2">:</span>
                        <span className="text-[14px] text-slate-700">
                            {aggregatedCategories}
                        </span>
                    </div>
                </div>

                <div className="h-px bg-slate-100" />

                {/* Mobile Number */}
                <div className="flex items-start break-inside-avoid">
                    <div className="w-1/2 shrink-0">
                        <span className="text-[13px] font-semibold text-slate-500">Mobile Number</span>
                    </div>
                    <div className="w-1/2 flex items-start">
                        <span className="text-[13px] text-slate-400 mr-2">:</span>
                        <div className="space-y-0.5">
                            {poiData.mobileNumbers && poiData.mobileNumbers.length > 0 ? (
                                poiData.mobileNumbers.map((num, idx) => (
                                    <div key={idx} className="text-[14px] text-slate-700">{num}</div>
                                ))
                            ) : (
                                <span className="text-[14px] text-slate-700">Unknown</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="h-px bg-slate-100" />

                {/* Email IDs */}
                <div className="flex items-start break-inside-avoid">
                    <div className="w-1/2 shrink-0">
                        <span className="text-[13px] font-semibold text-slate-500">Email IDs</span>
                    </div>
                    <div className="w-1/2 flex items-start">
                        <span className="text-[13px] text-slate-400 mr-2">:</span>
                        <div className="space-y-0.5">
                            {poiData.emailIds && poiData.emailIds.length > 0 ? (
                                poiData.emailIds.map((email, idx) => (
                                    <div key={idx} className="text-[14px] text-slate-700">{email}</div>
                                ))
                            ) : (
                                <span className="text-[14px] text-slate-700">Unknown</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="h-px bg-slate-100" />

                {/* Current Address */}
                <div className="flex items-start break-inside-avoid">
                    <div className="w-1/2 shrink-0">
                        <span className="text-[13px] font-semibold text-slate-500">Current Address</span>
                    </div>
                    <div className="w-1/2 flex items-start">
                        <span className="text-[13px] text-slate-400 mr-2">:</span>
                        <span className="text-[14px] text-slate-700 whitespace-pre-wrap">{poiData.currentAddress || 'Unknown'}</span>
                    </div>
                </div>

                {/* PS Limits */}
                <div className="flex items-center break-inside-avoid">
                    <div className="w-1/2 shrink-0">
                        <span className="text-[13px] font-semibold text-slate-500">PS Limits</span>
                    </div>
                    <div className="w-1/2 flex items-center">
                        <span className="text-[13px] text-slate-400 mr-2">:</span>
                        <span className="text-[14px] text-slate-700">{poiData.psLimits || 'Unknown'}</span>
                    </div>
                </div>

                {/* District / Commissionerate */}
                <div className="flex items-center break-inside-avoid">
                    <div className="w-1/2 shrink-0">
                        <span className="text-[13px] font-semibold text-slate-500">District / Commissionerate</span>
                    </div>
                    <div className="w-1/2 flex items-center">
                        <span className="text-[13px] text-slate-400 mr-2">:</span>
                        <span className="text-[14px] text-slate-700">{poiData.districtCommisionerate || 'Unknown'}</span>
                    </div>
                </div>

                <div className="h-px bg-slate-100" />

                {/* Last Used IP */}
                <div className="flex items-center break-inside-avoid">
                    <div className="w-1/2 shrink-0">
                        <span className="text-[13px] font-semibold text-slate-500">Last Used IP</span>
                    </div>
                    <div className="w-1/2 flex items-center">
                        <span className="text-[13px] text-slate-400 mr-2">:</span>
                        <span className="text-[14px] text-slate-700 font-mono">{poiData.lastUsedIp || 'Unknown'}</span>
                    </div>
                </div>

                <div className="h-px bg-slate-100" />

                {/* Software / Hardware Identifiers */}
                <div className="flex items-start break-inside-avoid">
                    <div className="w-1/2 shrink-0">
                        <span className="text-[13px] font-semibold text-slate-500">Software / Hardware Identifiers</span>
                    </div>
                    <div className="w-1/2 flex items-start">
                        <span className="text-[13px] text-slate-400 mr-2">:</span>
                        <span className="text-[14px] text-slate-700 whitespace-pre-wrap">{poiData.softwareHardwareIdentifiers || 'Unknown'}</span>
                    </div>
                </div>

                <div className="h-px bg-slate-100" />

                {/* Total FIRs */}
                <div className="flex items-center break-inside-avoid">
                    <div className="w-1/2 shrink-0">
                        <span className="text-[13px] font-semibold text-slate-500">Total FIRs Against</span>
                    </div>
                    <div className="w-1/2 flex items-center">
                        <span className="text-[13px] text-slate-400 mr-2">:</span>
                        <span className="text-[14px] text-slate-700">
                            {(poiData.firDetails && poiData.firDetails.length > 0) ? poiData.firDetails.length : 'Null'}
                        </span>
                    </div>
                </div>

                {/* FIR Details Table */}
                {(poiData.firDetails && poiData.firDetails.length > 0) && (
                    <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden break-inside-avoid">
                        <table className="w-full table-fixed border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="w-10 py-2 px-2 text-[11px] font-bold text-slate-400 text-center">#</th>
                                    <th className="w-[20%] py-2 px-2 text-[11px] font-bold text-slate-500 uppercase text-left border-l border-slate-200">FIR No</th>
                                    <th className="w-[30%] py-2 px-2 text-[11px] font-bold text-slate-500 uppercase text-left border-l border-slate-200">PS Limits</th>
                                    <th className="w-auto py-2 px-2 text-[11px] font-bold text-slate-500 uppercase text-left border-l border-slate-200 whitespace-normal leading-tight">District / Commissionerate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {poiData.firDetails.map((fir, idx) => (
                                    <tr key={idx} className={`border-b border-slate-100 last:border-b-0 ${idx % 2 === 1 ? 'bg-slate-50/50' : ''} break-inside-avoid`}>
                                        <td className="py-2 px-2 text-[12px] text-slate-400 text-center font-medium align-top">{idx + 1}</td>
                                        <td className="py-1.5 px-2 border-l border-slate-200 align-top break-words">
                                            <span className="text-[12px] text-slate-700">{fir.firNo || 'â€”'}</span>
                                        </td>
                                        <td className="py-1.5 px-2 border-l border-slate-200 align-top break-words">
                                            <span className="text-[12px] text-slate-700">{fir.psLimits || 'â€”'}</span>
                                        </td>
                                        <td className="py-1.5 px-2 border-l border-slate-200 align-top break-words">
                                            <span className="text-[12px] text-slate-700">{fir.districtCommisionerate || 'â€”'}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="h-px bg-slate-100" />

                {/* Linked Incidents */}
                <div className="flex items-start break-inside-avoid">
                    <div className="w-1/2 shrink-0">
                        <span className="text-[13px] font-semibold text-slate-500">Linked Incidents</span>
                    </div>
                    <div className="w-1/2 flex items-start">
                        <span className="text-[13px] text-slate-400 mr-2">:</span>
                        <span className="text-[14px] text-slate-700 whitespace-pre-wrap">{poiData.linkedIncidents || 'Unknown'}</span>
                    </div>
                </div>

                <div className="h-px bg-slate-100" />

                {/* Escalation Count */}
                <div className="flex items-center break-inside-avoid">
                    <div className="w-1/2 shrink-0">
                        <span className="text-[13px] font-semibold text-slate-500">No of times escalated to Intermediaries</span>
                    </div>
                    <div className="w-1/2 flex items-center">
                        <span className="text-[13px] text-slate-400 mr-2">:</span>
                        <span className="text-[14px] font-semibold text-slate-700">
                            {totalEscalatedCount > 0 ? totalEscalatedCount : '0'}
                        </span>
                    </div>
                </div>

                <div className="h-px bg-slate-200 !my-6" />

                {/* Social Media Sections */}
                <div className="space-y-6">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Social Media Profiles</div>

                    {/* X (Twitter) */}
                    {(() => {
                        const entries = (poiData.socialMedia || []).filter(s => s.platform === 'twitter' || s.platform === 'x');
                        if (entries.length === 0) return null;
                        return (
                            <div className="space-y-2 break-inside-avoid">
                                <div className="flex items-center gap-2">
                                    <XLogo className="w-4 h-4 text-slate-900" />
                                    <span className="text-[13px] font-semibold text-slate-600">X Profile</span>
                                    <span className="text-[11px] text-slate-400">({entries.length})</span>
                                </div>
                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                    <table className="w-full table-fixed border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200">
                                                <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left">Handle</th>
                                                <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200">Followers</th>
                                                <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200">Created</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {entries.map((h, i) => {
                                                const src = sources.find(s => s.id === h.sourceId || s._id === h.sourceId);
                                                const followers = h.followerCount || src?.statistics?.subscriber_count?.toLocaleString() || '';
                                                const created = h.createdDate || (src?.created_at ? new Date(src.created_at).toLocaleDateString() : '');
                                                return (
                                                    <tr key={i} className="border-b border-slate-100 last:border-b-0 break-inside-avoid">
                                                        <td className="py-1 px-2 text-[12px] text-sky-600 font-medium break-all align-middle">
                                                            {h.handle ? `@${h.handle.replace('@', '')}` : '—'}
                                                        </td>
                                                        <td className="py-1 px-2 border-l border-slate-200 text-[12px] text-slate-700 align-middle">
                                                            {followers || '—'}
                                                        </td>
                                                        <td className="py-1 px-2 border-l border-slate-200 text-[12px] text-slate-700 align-middle">
                                                            {created || '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Facebook */}
                    {(() => {
                        const platform = 'facebook';
                        const entries = (poiData.socialMedia || []).filter(s => s.platform === platform);
                        if (entries.length === 0) return null;
                        return (
                            <div className="space-y-2 break-inside-avoid">
                                <div className="flex items-center gap-2">
                                    <Facebook className="w-4 h-4 text-blue-600" />
                                    <span className="text-[13px] font-semibold text-slate-600">Facebook Profile</span>
                                    <span className="text-[11px] text-slate-400">({entries.length})</span>
                                </div>
                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                    <table className="w-full table-fixed border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200">
                                                <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left">Handle</th>
                                                <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200">Followers</th>
                                                <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200">Created</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {entries.map((h, i) => {
                                                const src = sources.find(s => s.id === h.sourceId || s._id === h.sourceId);
                                                const followers = h.followerCount || src?.statistics?.subscriber_count?.toLocaleString() || '';
                                                const created = h.createdDate || (src?.created_at ? new Date(src.created_at).toLocaleDateString() : '');
                                                return (
                                                    <tr key={i} className="border-b border-slate-100 last:border-b-0 break-inside-avoid">
                                                        <td className="py-1 px-2 text-[12px] text-blue-800 font-medium break-all align-middle">
                                                            {h.handle || 'â€”'}
                                                        </td>
                                                        <td className="py-1 px-2 border-l border-slate-200 text-[12px] text-slate-700 align-middle">
                                                            {followers || 'â€”'}
                                                        </td>
                                                        <td className="py-1 px-2 border-l border-slate-200 text-[12px] text-slate-700 align-middle">
                                                            {created || 'â€”'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Instagram */}
                    {(() => {
                        const platform = 'instagram';
                        const entries = (poiData.socialMedia || []).filter(s => s.platform === platform);
                        if (entries.length === 0) return null;
                        return (
                            <div className="space-y-2 break-inside-avoid">
                                <div className="flex items-center gap-2">
                                    <Instagram className="w-4 h-4 text-pink-500" />
                                    <span className="text-[13px] font-semibold text-slate-600">Instagram Profile</span>
                                    <span className="text-[11px] text-slate-400">({entries.length})</span>
                                </div>
                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                    <table className="w-full table-fixed border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200">
                                                <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left">Handle</th>
                                                <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200">Followers</th>
                                                <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200">Created</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {entries.map((h, i) => {
                                                const src = sources.find(s => s.id === h.sourceId || s._id === h.sourceId);
                                                const followers = h.followerCount || src?.statistics?.subscriber_count?.toLocaleString() || '';
                                                const created = h.createdDate || (src?.created_at ? new Date(src.created_at).toLocaleDateString() : '');
                                                return (
                                                    <tr key={i} className="border-b border-slate-100 last:border-b-0 break-inside-avoid">
                                                        <td className="py-1 px-2 text-[12px] text-pink-600 font-medium break-all align-middle">
                                                            {h.handle ? `@${h.handle.replace('@', '')}` : 'â€”'}
                                                        </td>
                                                        <td className="py-1 px-2 border-l border-slate-200 text-[12px] text-slate-700 align-middle">
                                                            {followers || 'â€”'}
                                                        </td>
                                                        <td className="py-1 px-2 border-l border-slate-200 text-[12px] text-slate-700 align-middle">
                                                            {created || 'â€”'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}

                    {/* YouTube */}
                    {(() => {
                        const platform = 'youtube';
                        const entries = (poiData.socialMedia || []).filter(s => s.platform === platform);
                        if (entries.length === 0) return null;
                        return (
                            <div className="space-y-2 break-inside-avoid">
                                <div className="flex items-center gap-2">
                                    <Youtube className="w-4 h-4 text-red-500" />
                                    <span className="text-[13px] font-semibold text-slate-600">YouTube Profile</span>
                                    <span className="text-[11px] text-slate-400">({entries.length})</span>
                                </div>
                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                    <table className="w-full table-fixed border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200">
                                                <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left">Channel</th>
                                                <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200">Subscribers</th>
                                                <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200">Created</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {entries.map((h, i) => {
                                                const src = sources.find(s => s.id === h.sourceId || s._id === h.sourceId);
                                                const followers = h.followerCount || src?.statistics?.subscriber_count?.toLocaleString() || '';
                                                const created = h.createdDate || (src?.created_at ? new Date(src.created_at).toLocaleDateString() : '');
                                                const label = h.displayName || h.handle || '';
                                                return (
                                                    <tr key={i} className="border-b border-slate-100 last:border-b-0 break-inside-avoid">
                                                        <td className="py-1 px-2 text-[12px] text-red-600 font-medium break-all align-middle">
                                                            {label || 'â€”'}
                                                        </td>
                                                        <td className="py-1 px-2 border-l border-slate-200 text-[12px] text-slate-700 align-middle">
                                                            {followers || 'â€”'}
                                                        </td>
                                                        <td className="py-1 px-2 border-l border-slate-200 text-[12px] text-slate-700 align-middle">
                                                            {created || 'â€”'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}

                    {/* WhatsApp */}
                    <div className="flex items-start break-inside-avoid">
                        <div className="w-1/2 shrink-0 flex items-center gap-2">
                            <MessageCircle className="w-4 h-4 text-green-500" />
                            <span className="text-[13px] font-semibold text-slate-600">WhatsApp</span>
                        </div>
                        <div className="w-1/2 flex items-start">
                            <span className="text-[13px] text-slate-400 mr-2">:</span>
                            <div className="text-[13px] text-slate-700 break-all leading-relaxed">
                                {poiData.whatsappNumbers && poiData.whatsappNumbers.filter(n => n).length > 0 ? (
                                    poiData.whatsappNumbers.filter(n => n).join(', ')
                                ) : (
                                    <span className="text-slate-400 italic">No numbers</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="h-px bg-slate-100 !my-6" />

                {/* Previously Deleted Profiles */}
                <div className="">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Previously Deleted Profiles</div>
                    {[
                        { key: 'x', label: 'X Profiles' },
                        { key: 'facebook', label: 'Face Book' },
                        { key: 'instagram', label: 'Instagram' },
                        { key: 'youtube', label: 'Youtube' },
                        { key: 'whatsapp', label: 'Whatsapp' }
                    ].map(({ key, label }) => {
                        const profiles = poiData.previouslyDeletedProfiles?.[key] || [];
                        return (
                            <div key={key} className="flex items-start mb-1 break-inside-avoid">
                                <div className="w-1/2 shrink-0">
                                    <span className="text-[13px] font-semibold text-slate-500">{label}</span>
                                </div>
                                <div className="w-1/2 flex items-start">
                                    <span className="text-[13px] text-slate-400 mr-2">:</span>
                                    <span className="text-[14px] text-slate-700">
                                        {profiles.filter(p => p).length > 0 ? profiles.filter(p => p).join(', ') : 'Unknown'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </>
        );

        if (isForPreview) {
            return (
                <div className="report-document w-full max-w-[210mm] min-h-[297mm] mx-auto bg-white p-[25mm_20mm] shadow-2xl origin-top overflow-visible">
                    {reportBody}
                </div>
            );
        }

        // For Print & Capture (Using Table for Repeating Margins & Chrome Suppression)
        return (
            <div className="report-document print:block bg-white">
                <table className="report-print-container w-full border-collapse">
                    <thead className="report-header-spacer">
                        <tr><td><div className="report-page-header-spacer h-[25mm]"></div></td></tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td className="px-[20mm]">
                                {reportBody}
                            </td>
                        </tr>
                    </tbody>
                    <tfoot className="report-footer-spacer">
                        <tr><td><div className="report-page-footer-spacer h-[20mm]"></div></td></tr>
                    </tfoot>
                </table>
            </div>
        );
    };

    // Effect to fetch stats when linked handles change
    useEffect(() => {
        if (linkedHandles && linkedHandles.length > 0) {
            // For now, fetch stats for the primary (first) handle
            // or we could aggregate them if needed
            fetchEscalationStats(linkedHandles[0].handle);
        }
    }, [linkedHandles.map(h => h.handle).join(',')]);

    // Compute total escalated-to-intermediary count across ALL linked social media handles
    useEffect(() => {
        const fetchTotalEscalated = async () => {
            const socialMedia = poiData.socialMedia;
            if (!socialMedia || socialMedia.length === 0) {
                setTotalEscalatedCount(0);
                return;
            }
            try {
                let total = 0;
                for (const sm of socialMedia) {
                    // Get the handle â€” strip @ prefix for broader search matching
                    const rawHandle = sm.handle || sm.identifier || '';
                    if (!rawHandle) continue;
                    const cleanHandle = rawHandle.replace(/^@/, '');

                    const res = await api.get(`/reports?search=${encodeURIComponent(cleanHandle)}&limit=500`);
                    const reports = res.data || [];
                    // All escalated reports are created with status 'sent_to_intermediary' by default
                    // Count all reports linked to this handle
                    total += reports.length;
                }
                setTotalEscalatedCount(total);
            } catch (err) {
                console.error('Failed to fetch total escalated count:', err);
            }
        };
        fetchTotalEscalated();
    }, [poiData._id, poiData.socialMedia?.length]);

    // Fetch available sources and POI data on mount
    useEffect(() => {
        fetchSources();
        if (id && id !== '1' && id !== 'new') {
            fetchPOIData(id);
        } else if (poiData._id && poiData._id !== '1') {
            fetchPOIData(poiData._id);
        }
    }, [id]);

    const fetchPOIData = async (id) => {
        try {
            const res = await api.get(`/poi/${id}`);
            const updatedPoi = res.data;

            // Normalize data if necessary
            if (updatedPoi.description && !updatedPoi.briefSummary) {
                updatedPoi.briefSummary = updatedPoi.description;
            }

            setPoiData(updatedPoi);
            setOriginalData(updatedPoi);
        } catch (err) {
            console.error("Failed to fetch POI data", err);
            // toast.error("Failed to synchronize profile data");
        }
    };

    const fetchSources = async (search = '') => {
        try {
            setLoadingSources(true);
            const schemaPlatform = selectedPlatform === 'twitter' ? 'x' : selectedPlatform;
            let url = `/sources?platform=${schemaPlatform}`;

            // Always ask backend to suggest based on POI identities for prioritization/sorting,
            // even if a search term is present.
            const suggestNames = [poiData.name, poiData.realName, ...(poiData.aliasNames || [])]
                .filter(Boolean)
                .map(n => n.trim())
                .filter(n => n.toLowerCase() !== 'unknown' && n.toLowerCase() !== 'null')
                .join(',');

            if (suggestNames) {
                url += `&suggest=${encodeURIComponent(suggestNames)}`;
            }

            if (search) {
                url += `&search=${encodeURIComponent(search)}`;
            }
            const res = await api.get(url);
            setSources(res.data || []);
        } catch (err) {
            console.error("Failed to fetch sources", err);
        } finally {
            setLoadingSources(false);
        }
    };

    // Debounced source searching
    useEffect(() => {
        if (!isLinking) return;

        const timer = setTimeout(() => {
            fetchSources(searchTerm);
        }, 300);

        return () => clearTimeout(timer);
    }, [searchTerm, selectedPlatform, isLinking]);

    // When platform changes, check if we have matching linked handles
    useEffect(() => {
        if (!selectedPlatform) {
            setLinkedHandles([]);
            setContentFeed([]);
            setIsLinking(false);
            setLinkStep('search');
            lastFetchedRef.current = { sourceId: null, platform: null, handle: null, selectedSourceId: null };
            setIsUnlinkingMode(false);
            setUnlinkingSelection([]);
            return;
        }

        setIsUnlinkingMode(false);
        setUnlinkingSelection([]);

        // Map UI platform to schema platform (ui: 'twitter' -> schema: 'x')
        // Support both 'x' and 'twitter' for backward compatibility
        const schemaPlatform = selectedPlatform === 'twitter' ? 'x' : selectedPlatform;

        const matchingLinks = poiData.socialMedia?.filter(s =>
            s.platform === schemaPlatform ||
            (selectedPlatform === 'twitter' && s.platform === 'twitter')
        ) || [];

        if (matchingLinks.length > 0) {
            // Verify source IDs against sources list if we have it
            const validatedLinks = matchingLinks.map(link => {
                if (link.sourceId && sources.length > 0) {
                    const sourceMatch = sources.find(src => src.id === link.sourceId || src._id === link.sourceId);
                    if (sourceMatch) {
                        return { ...link, source_meta: sourceMatch };
                    }
                }
                return link;
            });

            console.log(`[POI] Platform Switch: Found ${validatedLinks.length} matching links for ${selectedPlatform}`);
            setLinkedHandles(validatedLinks);
            setLinkedHandle(validatedLinks[0]); // Primary handle for singular elements

            // Manage default selection carefully
            const platformChanged = prevPlatformRef.current !== selectedPlatform;
            const currentSelectionInvalid = selectedSourceId && !validatedLinks.some(l => (l.sourceId || l.id || l._id) === selectedSourceId);

            if (platformChanged || !selectedSourceId || currentSelectionInvalid) {
                const firstId = validatedLinks[0].sourceId || validatedLinks[0].id || validatedLinks[0]._id;
                setSelectedSourceId(firstId);
            }

            if (platformChanged) {
                setIsLinking(false);
            }
            prevPlatformRef.current = selectedPlatform;
        } else {
            setLinkedHandles([]);
            setLinkedHandle(null);
            setContentFeed([]);
            setSelectedSourceId(null);
            // Don't auto-open linking if loading sources
            if (!loadingSources) {
                setIsLinking(true);
            }
        }
    }, [selectedPlatform, poiData.socialMedia, sources, loadingSources]);

    // Auto-enrich social media entries with source metadata if missing
    useEffect(() => {
        if (poiData.socialMedia && sources.length > 0 && poiData._id !== '1' && !isEditing) {
            let changed = false;
            const enrichedSocial = poiData.socialMedia.map(sm => {
                if (sm.sourceId) {
                    const match = sources.find(s => s.id === sm.sourceId || s._id === sm.sourceId);
                    if (match) {
                        const updates = {};
                        // Only auto-fill if the current POI record has defaults ('others'/'medium')
                        if (match.category && (sm.category === 'others' || !sm.category) && match.category !== sm.category) {
                            updates.category = match.category;
                        }
                        if (match.priority && (sm.priority === 'medium' || !sm.priority) && match.priority !== sm.priority) {
                            updates.priority = match.priority;
                        }
                        if (Object.keys(updates).length > 0) {
                            changed = true;
                            return { ...sm, ...updates };
                        }
                    }
                }
                return sm;
            });

            if (changed) {
                console.log("[POI] Enriching social media categories from linked sources");
                setPoiData(prev => ({ ...prev, socialMedia: enrichedSocial }));
            }
        }
    }, [sources, poiData._id, isEditing]);

    useEffect(() => {
        // Reset locks on account switch so fetch always fires
        lastFetchedRef.current = { sourceId: null, platform: null, handle: null, selectedSourceId: null };
        isFetchingFeedRef.current = false;
        pageRef.current = 1;

        if (linkedHandles.length > 0) {
            fetchContent(linkedHandles);

            // Always refresh reports so the badge shows the correct number for the selected profile
            const handlesToFetch = selectedSourceId
                ? [linkedHandles.find(h => (h.sourceId || h.id || h._id) === selectedSourceId)?.handle].filter(Boolean)
                : linkedHandles.map(h => h.handle).filter(Boolean);

            if (handlesToFetch.length > 0) {
                setReports([]); // Clear immediately for instant feedback
                fetchEscalationStats(handlesToFetch);
            }
        }
    }, [selectedSourceId, linkedHandles]);

    const fetchContent = async (links, isLoadMore = false) => {
        if (!links || (Array.isArray(links) && links.length === 0)) return;
        if (isFetchingFeedRef.current) return; // Block concurrent requests

        // Ensure we're working with an array
        const linksArray = Array.isArray(links) ? links : [links];

        // Get comma-separated source IDs if available, else handles
        const sourceIdSet = new Set(linksArray.filter(l => l.sourceId).map(l => l.sourceId));
        const sourceIds = Array.from(sourceIdSet).join(',');
        const firstLink = linksArray[0];
        const platform = firstLink.platform === 'twitter' ? 'x' : (firstLink.platform || selectedPlatform);
        const mainHandle = firstLink.handle;

        // Prevent redundant fetching for same platform/source
        if (!isLoadMore &&
            lastFetchedRef.current.platform === platform &&
            lastFetchedRef.current.sourceId === sourceIds &&
            lastFetchedRef.current.handle === mainHandle &&
            lastFetchedRef.current.selectedSourceId === selectedSourceId) {
            console.log("Skipping redundant fetchContent call for", sourceIds);
            return;
        }

        if (isFetchingFeedRef.current) return; // Synchronous block

        const currentPage = isLoadMore ? pageRef.current + 1 : 1;
        const currentFetchId = ++fetchIdRef.current;
        isFetchingFeedRef.current = true; // Immediate atomic lock

        if (!isLoadMore) {
            setLoadingFeed(true);
            setPage(1);
            setContentFeed([]);
        } else {
            setIsFetchingMore(true);
        }

        try {
            // Request content for all linked sources
            let url = `/content/feed?platform=${platform}&page=${currentPage}&limit=20&status=all`;

            // If a specific source is selected via the ribbon, use ONLY that one
            if (selectedSourceId) {
                url += `&source_id=${selectedSourceId}`;
            } else if (sourceIds) {
                url += `&source_id=${sourceIds}`;
            } else if (mainHandle) {
                const cleanHandle = mainHandle.replace('@', '');
                url += `&search=${encodeURIComponent(cleanHandle)}`;
            } else {
                // No criteria to fetch
                setLoadingFeed(false);
                return;
            }

            const res = await api.get(url);

            // Abort if a newer request has been started (prevents race conditions)
            if (currentFetchId !== fetchIdRef.current) return;

            const { items, pagination } = res.data;

            if (isLoadMore) {
                // Ensure no duplicates by checking IDs against existing feed
                setContentFeed(prev => {
                    const existingKeys = new Set(prev.map(item => (item.id || item._id)));
                    // Also filter duplicates WITHIN the current batch (just in case)
                    const uniqueNewItemsBatch = items.filter((item, index, self) =>
                        index === self.findIndex((t) => (t.id || t._id) === (item.id || item._id))
                    );
                    const newItems = uniqueNewItemsBatch.filter(item => !existingKeys.has(item.id || item._id));
                    return [...prev, ...newItems];
                });
                pageRef.current = currentPage;
                setPage(currentPage);
            } else {
                // Initial load: Still deduplicate just in case the backend returns dupes for Page 1
                const uniqueItems = (items || []).filter((item, index, self) =>
                    index === self.findIndex((t) => (t.id || t._id) === (item.id || item._id))
                );
                setContentFeed(uniqueItems);
                pageRef.current = 1;
                setPage(1);
                lastFetchedRef.current = { sourceId: sourceIds, platform, handle: mainHandle, selectedSourceId };
            }

            setHasMore(pagination.hasMore && items?.length > 0);

        } catch (err) {
            console.error("Failed to fetch content feed", err);
            toast.error("Failed to load alerts data");
        } finally {
            isFetchingFeedRef.current = false; // ALWAYS release lock
            setIsFetchingMore(false); // ALWAYS release scroll lock
            if (currentFetchId === fetchIdRef.current) {
                setLoadingFeed(false); // Only latest request controls spinner
            }
        }
    };

    // Infinite Scroll Observer implementation
    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                // Check isFetchingFeedRef.current SYNCHRONOUSLY before anything else
                if (entries[0].isIntersecting && hasMore && !loadingFeed && !isFetchingMore && !isFetchingFeedRef.current && linkedHandles.length > 0) {
                    // Start a tiny delay to allow the DOM to settle
                    setTimeout(() => {
                        // Re-check EVERYTHING inside the timeout to ensure no other fetch started
                        if (observerTarget.current && entries[0].isIntersecting && !isFetchingFeedRef.current) {
                            fetchContent(linkedHandles, true);
                        }
                    }, 100); // 100ms for safety
                }
            },
            { threshold: 0.1, rootMargin: '200px' } // Trigger early as sentinel approaches viewport
        );

        const currentTarget = observerTarget.current;
        if (currentTarget) {
            observer.observe(currentTarget);
        }

        return () => {
            if (currentTarget) {
                observer.unobserve(currentTarget);
            }
        };
    }, [hasMore, loadingFeed, isFetchingMore, linkedHandles, selectedPlatform]);

    // Link Handlers
    const handleLinkSource = (source) => {
        // Use source platform if available (to support 'twitter' vs 'x'), else default to schema
        const schemaPlatform = source.platform || (selectedPlatform === 'twitter' ? 'x' : selectedPlatform);

        const newLink = {
            platform: schemaPlatform,
            handle: source.identifier,
            sourceId: source.id || source._id, // Prefer UUID (id) for Content/Alert collection compatibility
            displayName: source.display_name,
            profileImage: source.profile_image_url,
            category: source.category,
            priority: source.priority
        };

        // Update local POI data
        let updatedSocial = [...(poiData.socialMedia || [])];

        if (linkingIdx !== null) {
            // Update the specific row that triggered the link search
            updatedSocial[linkingIdx] = {
                ...updatedSocial[linkingIdx],
                ...newLink,
                // Ensure we don't lose the pre-filled displayName if it was changed
                displayName: newLink.displayName || updatedSocial[linkingIdx].displayName
            };
            setLinkingIdx(null);
        } else {
            // Fallback: If linkingIdx is null (e.g., from "Add Account" button), append a new row
            updatedSocial.push({
                ...newLink,
                category: newLink.category || 'others',
                priority: newLink.priority || 'medium',
                is_active: true
            });
        }

        const newData = { ...poiData, socialMedia: updatedSocial };

        // Auto-sync profile image if current one is missing or default
        if (source.profile_image_url && (!poiData.profileImage || poiData.profileImage.includes('placeholder') || poiData.profileImage === '')) {
            newData.profileImage = source.profile_image_url;
        }

        setPoiData(newData);

        // Persist immediately
        updatePoiBackend(newData);

        setIsLinking(false);
        // Refresh handles after link
        const validatedLinks = updatedSocial.filter(s =>
            s.platform === schemaPlatform ||
            (selectedPlatform === 'twitter' && s.platform === 'twitter')
        );

        // Force fetchContent to bypass redundant cache check
        lastFetchedRef.current = { sourceId: null, platform: null, handle: null, selectedSourceId: null };

        setLinkedHandles(validatedLinks);
        setSelectedSourceId(newLink.sourceId);
        // toast.success(`Linked ${source.display_name} to this profile`);
    };

    const handleUnlinkSource = async () => {
        if (!selectedPlatform) return;

        const platformToUnlink = selectedPlatform === 'twitter' ? 'x' : selectedPlatform;

        if (isUnlinkingMode && unlinkingSelection.length === 0) return;

        const updatedSocial = poiData.socialMedia?.filter(s => {
            const isTargetPlatform = s.platform === platformToUnlink || (platformToUnlink === 'x' && s.platform === 'twitter');
            if (!isTargetPlatform) return true; // Keep other platforms

            // If we are in unlinking mode, only remove selected handles
            if (isUnlinkingMode) {
                return !unlinkingSelection.includes(s.sourceId || s.id || s._id);
            }
            return false;
        }) || [];

        const newData = { ...poiData, socialMedia: updatedSocial };

        // Clear profile image if it came from one of the unlinked sources
        const unlinkedEntries = poiData.socialMedia?.filter(s => {
            const isTargetPlatform = s.platform === platformToUnlink || (platformToUnlink === 'x' && s.platform === 'twitter');
            if (isUnlinkingMode) return isTargetPlatform && unlinkingSelection.includes(s.sourceId || s.id || s._id);
            return isTargetPlatform;
        }) || [];

        if (newData.profileImage) {
            const wasProfileImageUnlinked = unlinkedEntries.some(s => s.profileImage === newData.profileImage);
            if (wasProfileImageUnlinked) {
                newData.profileImage = '';
            }
        }

        setPoiData(newData);

        // Persist immediately
        const success = await updatePoiBackend(newData);
        if (success) {
            setUnlinkingSelection([]);
            setIsUnlinkingMode(false);

            const remainingTargetPlatformHandles = updatedSocial.filter(s =>
                s.platform === platformToUnlink || (platformToUnlink === 'x' && s.platform === 'twitter')
            );

            if (remainingTargetPlatformHandles.length === 0) {
                setLinkedHandle(null);
                setContentFeed([]);
                setIsLinking(true);
                setSelectedSourceId(null);
            } else if (isUnlinkingMode && unlinkingSelection.includes(selectedSourceId)) {
                setSelectedSourceId(remainingTargetPlatformHandles[0].sourceId || remainingTargetPlatformHandles[0].id || remainingTargetPlatformHandles[0]._id);
            }

            lastFetchedRef.current = { sourceId: null, platform: null, handle: null, selectedSourceId: null };
            toast.success("Handle(s) unlinked successfully");
        }
    };

    const handleProfileImageUpdate = async (newImageUrl) => {
        const newData = { ...poiData, profileImage: newImageUrl };
        setPoiData(newData);
        await updatePoiBackend(newData);
        toast.success("Profile image updated");
    };

    const handleCreateSource = async () => {
        if (!newSourceForm.identifier) return toast.error("Handle/URL is required");

        setCreatingSource(true);
        try {
            const payload = {
                platform: selectedPlatform === 'twitter' ? 'x' : selectedPlatform,
                ...newSourceForm,
                category: newSourceForm.category.toLowerCase()
            };

            const res = await api.post('/sources', payload);
            const newSource = res.data;

            setSources(prev => [...prev, newSource]);
            handleLinkSource(newSource); // Link immediately after creating
            setAddSourceDialogOpen(false); // Close dialog
            // Reset form
            setNewSourceForm({
                identifier: '',
                display_name: '',
                category: 'others',
                is_active: true,
                priority: 'medium'
            });

        } catch (err) {
            const msg = err.response?.data?.message || err.message || "Failed to create source";
            toast.error(msg);
        } finally {
            setCreatingSource(false);
        }
    };

    const updatePoiBackend = async (data) => {
        if (data._id && data._id !== '1') {
            try {
                // Clean data to remove Mongoose-specific fields
                const { _id, __v, createdAt, updatedAt, ...cleanData } = data;
                await api.put(`/poi/${_id}`, cleanData);
                return true;
            } catch (e) {
                console.error("Background save failed", e);
                toast.error("Failed to save changes to server");
                return false;
            }
        }
        return false;
    };
    const handleBack = () => {
        if ((isEditing && hasUnsavedChanges()) || (addSourceDialogOpen && isAddSourceDirty)) {
            setDiscardTarget('back');
            setShowDiscardConfirm(true);
        } else {
            navigate(-1);
        }
    };

    useEffect(() => {
        // No browser-level navigation blocking per user request
    }, []);

    // Edit Handlers
    const handleEditClick = () => {
        setOriginalData({ ...poiData });
        setIsEditing(true);
    };

    const hasUnsavedChanges = () => {
        if (!originalData) return false;
        return JSON.stringify(poiData) !== JSON.stringify(originalData);
    };

    const handleCancel = () => {
        if (hasUnsavedChanges()) {
            setShowDiscardConfirm(true);
        } else {
            setPoiData(originalData || initialData);
            setIsEditing(false);
        }
    };

    const confirmDiscard = () => {
        const target = discardTarget;
        setPoiData(originalData || initialData);
        setIsEditing(false);
        setAddSourceDialogOpen(false);
        setIsAddSourceDirty(false);
        setShowDiscardConfirm(false);
        setDiscardTarget(null);

        if (target === 'back') {
            navigate(-1);
        }
    };

    const handleDiscardCancel = () => {
        setShowDiscardConfirm(false);
        setDiscardTarget(null);
    };

    const handleSave = async () => {
        if (!poiData.name.trim()) {
            toast.error('Name is required');
            return;
        }

        try {
            setSaving(true);

            // If valid ID, call API
            if (poiData._id && poiData._id !== '1') {
                const { _id, __v, createdAt, updatedAt, ...cleanData } = poiData;
                await api.put(`/poi/${_id}`, cleanData);
            }

            setIsEditing(false);
            toast.success("Profile updated successfully");
        } catch (err) {
            console.error(err);
            toast.error("Failed to save profile changes");
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (field, value) => {
        setPoiData(prev => {
            const updates = { [field]: value };
            // Synchronize name and realName
            if (field === 'realName') updates.name = value;
            if (field === 'name') updates.realName = value;
            return { ...prev, ...updates };
        });
    };

    const handleArrayChange = (field, index, value) => {
        setPoiData(prev => {
            const newArr = [...(prev[field] || [])];
            newArr[index] = value;
            return { ...prev, [field]: newArr };
        });
    };

    const addArrayItem = (field) => {
        setPoiData(prev => ({
            ...prev,
            [field]: [...(prev[field] || []), '']
        }));
    };

    const removeArrayItem = (field, index) => {
        setPoiData(prev => {
            const newArr = (prev[field] || []).filter((_, i) => i !== index);
            return { ...prev, [field]: newArr };
        });
    };

    // FIR Table Handlers
    const handleFirCountChange = (countStr) => {
        const count = parseInt(countStr, 10);
        if (isNaN(count) || count < 0) {
            setPoiData(prev => ({ ...prev, firDetails: [] }));
            return;
        }
        setPoiData(prev => {
            const existing = prev.firDetails || [];
            const newArr = [];
            for (let i = 0; i < count; i++) {
                newArr.push(existing[i] || { firNo: '', psLimits: '', districtCommisionerate: '' });
            }
            return { ...prev, firDetails: newArr };
        });
    };

    const handleFirDetailChange = (index, field, value) => {
        setPoiData(prev => {
            const newArr = [...(prev.firDetails || [])];
            newArr[index] = { ...newArr[index], [field]: value };
            return { ...prev, firDetails: newArr };
        });
    };

    const addFirRow = () => {
        setPoiData(prev => ({
            ...prev,
            firDetails: [...(prev.firDetails || []), { firNo: '', psLimits: '', districtCommisionerate: '' }]
        }));
    };

    const removeFirRow = (index) => {
        setPoiData(prev => ({
            ...prev,
            firDetails: (prev.firDetails || []).filter((_, i) => i !== index)
        }));
    };

    // Dynamic Fields Handlers
    const addCustomField = () => {
        setPoiData(prev => ({ ...prev, customFields: [...(prev.customFields || []), { label: '', value: '' }] }));
    };

    const updateCustomField = (index, key, value) => {
        const newFields = [...(poiData.customFields || [])];
        newFields[index][key] = value;
        setPoiData(prev => ({ ...prev, customFields: newFields }));
    };

    const removeCustomField = (index) => {
        const newFields = (poiData.customFields || []).filter((_, i) => i !== index);
        setPoiData(prev => ({ ...prev, customFields: newFields }));
    };

    // Filter sources for current platform search
    const filteredSources = sources.filter(s => {
        // Map UI platform to backend platform ID
        const backendPlatform = selectedPlatform === 'twitter' ? 'x' : selectedPlatform;
        const matchesPlatform = s.platform === backendPlatform ||
            (selectedPlatform === 'twitter' && s.platform === 'twitter');

        if (!searchTerm) return matchesPlatform;

        const matchesSearch = s.identifier?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.display_name?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesPlatform && matchesSearch;
    });

    // Auto-suggest logic: Aggressive word-based matching
    const sortedSources = [...filteredSources].sort((a, b) => {
        const checkMatch = (s) => {
            const id = s.identifier?.toLowerCase() || '';
            const dn = s.display_name?.toLowerCase() || '';

            const namesToCheck = [
                poiData.name,
                poiData.realName,
                ...(poiData.aliasNames || [])
            ].filter(Boolean).map(n => n.toLowerCase());

            // Full name match (highest priority)
            if (namesToCheck.some(n => id.includes(n) || dn.includes(n))) return 2;

            // Aggressive word-based match (splitting by spaces and punctuation)
            const allWords = namesToCheck.flatMap(n => n.split(/[\s._-]+/)).filter(w => w.length > 2);
            if (allWords.some(w => id.includes(w) || dn.includes(w))) return 1;

            return 0;
        };

        const aScore = checkMatch(a);
        const bScore = checkMatch(b);
        if (aScore !== bScore) return bScore - aScore;

        // Secondary sort by display name
        return (a.display_name || '').localeCompare(b.display_name || '');
    });

    const getInitial = (name) => name?.charAt(0)?.toUpperCase() || '?';

    return (
        <div className="flex flex-1 flex-col h-full bg-gray-50 font-sans overflow-hidden poi-detail-root-container">
            {/* Main Workspace - No wasted space */}
            <div className="flex-1 flex flex-col h-full min-h-0 no-print">
                <div className="flex flex-1 h-full overflow-hidden">

                    {/* LEFT SIDEBAR - PROFILE DETAILS (50%) */}
                    <div className={`
                    ${isSidebarOpen ? 'w-[300px] md:w-1/2' : 'w-0 overflow-hidden border-none'}
                    bg-white border-r border-gray-200 flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10 shrink-0 transition-all duration-300 overflow-x-hidden
                `}>
                        <div className="p-6 bg-[#071633] font-sans relative">


                            {/* Control Buttons Overlay */}
                            <div className="absolute top-4 left-4 flex gap-2 z-30 no-print">
                                <button
                                    onClick={handleBack}
                                    className="text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-full transition-all"
                                    title="Back"
                                >
                                    <ArrowLeft className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="absolute top-4 right-4 z-30 flex gap-2 no-print">
                                <button
                                    onClick={handleExportReport}
                                    disabled={isUploading}
                                    className={`text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-md transition-all flex items-center gap-2 ${isUploading ? 'opacity-100' : 'opacity-70'}`}
                                    title="Export Report"
                                >
                                    {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />}
                                    <span className="text-xs font-bold uppercase tracking-wider hidden md:inline">
                                        {isUploading ? "Preparing..." : "Export Report"}
                                    </span>
                                </button>
                                <button
                                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                    className="text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-md transition-all"
                                    title={isSidebarOpen ? "Hide Profile" : "Show Profile"}
                                >
                                    {isSidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
                                </button>
                            </div>

                            <div className="flex flex-row items-stretch gap-0 mt-8 min-h-[140px]">
                                {/* LEFT COLUMN (50%): Profile Image + Display Name + ID */}
                                <div className="w-1/2 flex flex-col items-center justify-center border-r border-white/10 pr-4">
                                    {/* Profile Image with Camera Overlay */}
                                    <div className="relative w-28 h-28 mb-3 group cursor-pointer" onClick={() => setManageImageOpen(true)}>
                                        <div className="w-full h-full rounded-full overflow-hidden border-4 border-white/10 shadow-xl relative z-10">
                                            {effectiveProfileImage ? (
                                                <img src={proxifyImageUrl(effectiveProfileImage)} alt={poiData.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-white/5 flex items-center justify-center text-white/30">
                                                    <User className="w-10 h-10" />
                                                </div>
                                            )}

                                            {/* Camera Overlay */}
                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 z-20">
                                                <Camera className="w-8 h-8 text-white/80" />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Display Name & ID */}
                                    {/* Real Name & ID */}
                                    <div className="text-center w-full space-y-1">
                                        {isEditing ? (
                                            <input
                                                type="text"
                                                value={poiData.realName || ''}
                                                onChange={(e) => handleChange('realName', e.target.value)}
                                                className="text-lg font-bold text-white text-center w-full border-b border-white/50 focus:border-white/80 outline-none pb-1 bg-transparent placeholder-white/20"
                                                placeholder="Real Name"
                                            />
                                        ) : (
                                            <>
                                                <h2 className="text-xl font-bold text-white tracking-tight leading-tight break-words">
                                                    {poiData.realName || 'Unknown'}
                                                </h2>
                                            </>
                                        )}
                                        <div className="text-[10px] font-bold text-white/40 tracking-[0.1em] uppercase pt-1">
                                            ID:
                                            <div className="text-[9px] opacity-70 break-all leading-tight mt-0.5">{poiData._id}</div>
                                        </div>
                                    </div>
                                </div>

                                {/* RIGHT COLUMN (50%): Brief Summary */}
                                <div className="w-1/2 pl-4 flex flex-col justify-center">
                                    <label className="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">
                                        Brief Summary
                                    </label>
                                    {isEditing ? (
                                        <div className="relative h-full flex flex-col">
                                            <textarea
                                                value={poiData.briefSummary || ''}
                                                onChange={(e) => {
                                                    if (e.target.value.length <= 500) {
                                                        handleChange('briefSummary', e.target.value);
                                                    }
                                                }}
                                                maxLength={500}
                                                className="w-full flex-1 bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white focus:border-white/30 focus:bg-white/10 outline-none resize-none placeholder-white/20 leading-relaxed custom-scrollbar-dark min-h-[120px]"
                                                placeholder="Enter a brief summary (max 500 characters)..."
                                            />
                                            <div className="text-[10px] text-white/40 text-right mt-1 font-mono">
                                                {(poiData.briefSummary?.length || 0)}/500
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-sm text-white/90 leading-relaxed break-words whitespace-pre-wrap max-h-[200px] overflow-y-auto custom-scrollbar-dark pr-2">
                                            {poiData.briefSummary || <span className="text-white/30 italic">No summary available.</span>}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-3.5 custom-scrollbar bg-white print:overflow-visible">
                            {/* Edit Profile Button - Professional Blue */}
                            <div className="w-full no-print">
                                {!isEditing ? (
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-sm font-bold rounded-xl transition-all shadow-md active:scale-[0.98]"
                                    >
                                        <Edit className="h-4 w-4" />
                                        Edit Profile
                                    </button>
                                ) : (
                                    <div className="grid grid-cols-2 gap-3 w-full">
                                        <button
                                            onClick={handleCancel}
                                            className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold rounded-xl transition-all border border-gray-200"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSave}
                                            disabled={saving}
                                            className="flex items-center justify-center gap-2 px-4 py-3 bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-sm font-bold rounded-xl transition-all shadow-md active:scale-[0.98] disabled:opacity-50"
                                        >
                                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                            Save
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Alias Names */}
                            <div className="flex items-start min-h-[28px]">
                                <div className="w-1/2 shrink-0 pt-1">
                                    <span className="text-[13px] font-semibold text-slate-500">Alias Names</span>
                                    <div className="text-[10px] text-slate-400 italic">(in real world / social media)</div>
                                </div>
                                <div className="w-1/2 flex items-start">
                                    <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                                    <div className="flex-1">
                                        {isEditing ? (
                                            <div className="space-y-1.5">
                                                {(poiData.aliasNames || []).map((alias, idx) => (
                                                    <div key={idx} className="flex items-center gap-2">
                                                        <input
                                                            type="text"
                                                            value={alias}
                                                            onChange={(e) => handleArrayChange('aliasNames', idx, e.target.value)}
                                                            className="flex-1 bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none"
                                                        />
                                                        <button onClick={() => removeArrayItem('aliasNames', idx)} className="text-red-400 hover:text-red-600">
                                                            <XCircle className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ))}
                                                <button onClick={() => addArrayItem('aliasNames')} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 mt-1">
                                                    <PlusCircle className="w-3.5 h-3.5" /> Add Alias
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="text-[14px] text-slate-700">
                                                {poiData.aliasNames && poiData.aliasNames.length > 0
                                                    ? poiData.aliasNames.join(', ')
                                                    : 'Unknown'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="h-px bg-slate-100" />

                            {/* Category */}
                            <div className="flex items-start min-h-[28px]">
                                <div className="w-1/2 shrink-0 pt-1">
                                    <span className="text-[13px] font-semibold text-slate-500">Category</span>
                                    <div className="text-[10px] text-slate-400 italic">(auto-fetched from handles)</div>
                                </div>
                                <div className="w-1/2 flex items-start">
                                    <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                                    <div className="flex-1">
                                        <span className="text-[14px] text-slate-700">
                                            {aggregatedCategories}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="h-px bg-slate-100" />

                            {/*Mobile Number*/}
                            <div className="flex items-start min-h-[28px]">
                                <div className="w-1/2 shrink-0 pt-1">
                                    <span className="text-[13px] font-semibold text-slate-500">Mobile Number</span>
                                </div>
                                <div className="w-1/2 flex items-start">
                                    <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                                    <div className="flex-1">
                                        {isEditing ? (
                                            <div className="space-y-1.5">
                                                {(poiData.mobileNumbers || []).map((num, idx) => (
                                                    <div key={idx} className="flex items-center gap-2">
                                                        <input
                                                            type="text"
                                                            value={num}
                                                            onChange={(e) => handleArrayChange('mobileNumbers', idx, e.target.value)}
                                                            className="flex-1 bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none"
                                                            placeholder="+91 XXXXX XXXXX"
                                                        />
                                                        <button onClick={() => removeArrayItem('mobileNumbers', idx)} className="text-red-400 hover:text-red-600">
                                                            <MinusCircle className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ))}
                                                <button onClick={() => addArrayItem('mobileNumbers')} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 mt-1">
                                                    <PlusCircle className="w-3.5 h-3.5" /> Add Number
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="space-y-0.5">
                                                {poiData.mobileNumbers && poiData.mobileNumbers.length > 0 ? (
                                                    poiData.mobileNumbers.map((num, idx) => (
                                                        <div key={idx} className="text-[14px] text-slate-700">{num}</div>
                                                    ))
                                                ) : (
                                                    <span className="text-[14px] text-slate-700">Unknown</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="h-px bg-slate-100" />

                            {/* Email IDs  */}
                            <div className="flex items-start min-h-[28px]">
                                <div className="w-1/2 shrink-0 pt-1">
                                    <span className="text-[13px] font-semibold text-slate-500">Email IDs</span>
                                </div>
                                <div className="w-1/2 flex items-start">
                                    <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                                    <div className="flex-1">
                                        {isEditing ? (
                                            <div className="space-y-1.5">
                                                {(poiData.emailIds || []).map((email, idx) => (
                                                    <div key={idx} className="flex items-center gap-2">
                                                        <input
                                                            type="text"
                                                            value={email}
                                                            onChange={(e) => handleArrayChange('emailIds', idx, e.target.value)}
                                                            className="flex-1 bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none"
                                                            placeholder="example@email.com"
                                                        />
                                                        <button onClick={() => removeArrayItem('emailIds', idx)} className="text-red-400 hover:text-red-600">
                                                            <MinusCircle className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ))}
                                                <button onClick={() => addArrayItem('emailIds')} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 mt-1">
                                                    <PlusCircle className="w-3.5 h-3.5" /> Add Email
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="space-y-0.5">
                                                {poiData.emailIds && poiData.emailIds.length > 0 ? (
                                                    poiData.emailIds.map((email, idx) => (
                                                        <div key={idx} className="text-[14px] text-slate-700">{email}</div>
                                                    ))
                                                ) : (
                                                    <span className="text-[14px] text-slate-700">Unknown</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="h-px bg-slate-100" />

                            {/*Current Address */}
                            <div className="flex items-start min-h-[28px]">
                                <div className="w-1/2 shrink-0 pt-1">
                                    <span className="text-[13px] font-semibold text-slate-500">Current Address</span>
                                </div>
                                <div className="w-1/2 flex items-start">
                                    <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                                    <div className="flex-1">
                                        {isEditing ? (
                                            <textarea
                                                value={poiData.currentAddress}
                                                onChange={(e) => handleChange('currentAddress', e.target.value)}
                                                rows={5}
                                                className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none resize-none custom-scrollbar"
                                                placeholder="Full address..."
                                            />
                                        ) : (
                                            <span className="text-[14px] text-slate-700 whitespace-pre-wrap">{poiData.currentAddress || 'Unknown'}</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* PS Limits */}
                            <div className="flex items-center min-h-[28px]">
                                <div className="w-1/2 shrink-0">
                                    <span className="text-[13px] font-semibold text-slate-500">PS Limits</span>
                                </div>
                                <div className="w-1/2 flex items-center">
                                    <span className="text-[13px] text-slate-400 mr-2">:</span>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={poiData.psLimits}
                                            onChange={(e) => handleChange('psLimits', e.target.value)}
                                            className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none pb-0.5"
                                            placeholder="PS limits..."
                                        />
                                    ) : (
                                        <span className="text-[14px] text-slate-700">{poiData.psLimits || 'Unknown'}</span>
                                    )}
                                </div>
                            </div>

                            {/* District / Commissionerate */}
                            <div className="flex items-center min-h-[28px]">
                                <div className="w-1/2 shrink-0">
                                    <span className="text-[13px] font-semibold text-slate-500">District / Commissionerate</span>
                                </div>
                                <div className="w-1/2 flex items-center">
                                    <span className="text-[13px] text-slate-400 mr-2">:</span>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={poiData.districtCommisionerate}
                                            onChange={(e) => handleChange('districtCommisionerate', e.target.value)}
                                            className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none pb-0.5"
                                            placeholder="District / Commissionerate..."
                                        />
                                    ) : (
                                        <span className="text-[14px] text-slate-700">{poiData.districtCommisionerate || 'Unknown'}</span>
                                    )}
                                </div>
                            </div>

                            <div className="h-px bg-slate-100" />

                            {/* Last Used IP */}
                            <div className="flex items-center min-h-[28px]">
                                <div className="w-1/2 shrink-0">
                                    <span className="text-[13px] font-semibold text-slate-500">Last Used IP</span>
                                </div>
                                <div className="w-1/2 flex items-center">
                                    <span className="text-[13px] text-slate-400 mr-2">:</span>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={poiData.lastUsedIp}
                                            onChange={(e) => handleChange('lastUsedIp', e.target.value)}
                                            className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 font-mono focus:border-blue-500 outline-none pb-0.5"
                                            placeholder="0.0.0.0"
                                        />
                                    ) : (
                                        <span className="text-[14px] text-slate-700 font-mono">{poiData.lastUsedIp || 'Unknown'}</span>
                                    )}
                                </div>
                            </div>

                            <div className="h-px bg-slate-100" />

                            {/* Software / Hardware Identifiers */}
                            <div className="flex items-start min-h-[28px]">
                                <div className="w-1/2 shrink-0 pt-1">
                                    <span className="text-[13px] font-semibold text-slate-500">Software / Hardware Identifiers</span>
                                </div>
                                <div className="w-1/2 flex items-start">
                                    <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                                    <div className="flex-1">
                                        {isEditing ? (
                                            <textarea
                                                value={poiData.softwareHardwareIdentifiers}
                                                onChange={(e) => handleChange('softwareHardwareIdentifiers', e.target.value)}
                                                rows={5}
                                                className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none resize-none custom-scrollbar"
                                                placeholder="IMEI, MAC, Device Model..."
                                            />
                                        ) : (
                                            <span className="text-[14px] text-slate-700 whitespace-pre-wrap">{poiData.softwareHardwareIdentifiers || 'Unknown'}</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="h-px bg-slate-100" />

                            {/* Total FIRs */}
                            <div className="flex items-center min-h-[28px]">
                                <div className="w-1/2 shrink-0">
                                    <span className="text-[13px] font-semibold text-slate-500">Total FIRs Against</span>
                                </div>
                                <div className="w-1/2 flex items-center">
                                    <span className="text-[13px] text-slate-400 mr-2">:</span>
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            min="0"
                                            value={(poiData.firDetails || []).length || ''}
                                            onChange={(e) => handleFirCountChange(e.target.value)}
                                            className="w-20 bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none pb-0.5 text-center"
                                            placeholder="0"
                                        />
                                    ) : (
                                        <span className="text-[14px] text-slate-700">
                                            {(poiData.firDetails && poiData.firDetails.length > 0) ? poiData.firDetails.length : 'Null'}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* FIR Details Table */}
                            {(poiData.firDetails && poiData.firDetails.length > 0) && (
                                <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden">
                                    <table className="w-full table-fixed border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200">
                                                <th className="w-10 py-2 px-2 text-[11px] font-bold text-slate-400 text-center">#</th>
                                                <th className="w-[20%] py-2 px-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide text-left border-l border-slate-200">FIR No</th>
                                                <th className="w-[30%] py-2 px-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide text-left border-l border-slate-200">PS Limits</th>
                                                <th className="w-auto py-2 px-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide text-left border-l border-slate-200 whitespace-normal leading-tight">District / Commissionerate</th>
                                                {isEditing && <th className="w-8" />}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {poiData.firDetails.map((fir, idx) => (
                                                <tr key={idx} className={`border-b border-slate-100 last:border-b-0 ${idx % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                                                    <td className="w-8 py-2 px-2 text-[12px] text-slate-400 text-center font-medium align-top">{idx + 1}</td>
                                                    <td className="py-1.5 px-2 border-l border-slate-200 align-top break-words">
                                                        {isEditing ? (
                                                            <input
                                                                type="text"
                                                                value={fir.firNo}
                                                                onChange={(e) => handleFirDetailChange(idx, 'firNo', e.target.value)}
                                                                className="w-full bg-transparent text-[12px] text-slate-700 outline-none"
                                                                placeholder="FIR No..."
                                                            />
                                                        ) : (
                                                            <span className="text-[12px] text-slate-700 break-words">{fir.firNo || 'â€”'}</span>
                                                        )}
                                                    </td>
                                                    <td className="py-1.5 px-2 border-l border-slate-200 align-top break-words">
                                                        {isEditing ? (
                                                            <input
                                                                type="text"
                                                                value={fir.psLimits}
                                                                onChange={(e) => handleFirDetailChange(idx, 'psLimits', e.target.value)}
                                                                className="w-full bg-transparent text-[12px] text-slate-700 outline-none"
                                                                placeholder="PS limits..."
                                                            />
                                                        ) : (
                                                            <span className="text-[12px] text-slate-700 break-words">{fir.psLimits || 'â€”'}</span>
                                                        )}
                                                    </td>
                                                    <td className="py-1.5 px-2 border-l border-slate-200 align-top break-words">
                                                        {isEditing ? (
                                                            <input
                                                                type="text"
                                                                value={fir.districtCommisionerate}
                                                                onChange={(e) => handleFirDetailChange(idx, 'districtCommisionerate', e.target.value)}
                                                                className="w-full bg-transparent text-[12px] text-slate-700 outline-none"
                                                                placeholder="District..."
                                                            />
                                                        ) : (
                                                            <span className="text-[12px] text-slate-700 break-words">{fir.districtCommisionerate || 'â€”'}</span>
                                                        )}
                                                    </td>
                                                    {isEditing && (
                                                        <td className="w-8 py-1.5 text-center align-top">
                                                            <button onClick={() => removeFirRow(idx)} className="text-red-400 hover:text-red-600">
                                                                <MinusCircle className="w-3.5 h-3.5" />
                                                            </button>
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {/* Add Row Button */}
                                    {isEditing && (
                                        <div className="py-1.5 px-3 border-t border-slate-200 bg-slate-50/30">
                                            <button onClick={addFirRow} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700">
                                                <PlusCircle className="w-3.5 h-3.5" /> Add Row
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="h-px bg-slate-100" />

                            {/*Linked Incidents*/}
                            <div className="flex items-start min-h-[28px]">
                                <div className="w-1/2 shrink-0 pt-1">
                                    <span className="text-[13px] font-semibold text-slate-500">Linked Incidents</span>
                                </div>
                                <div className="w-1/2 flex items-start">
                                    <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                                    <div className="flex-1">
                                        {isEditing ? (
                                            <textarea
                                                value={poiData.linkedIncidents}
                                                onChange={(e) => handleChange('linkedIncidents', e.target.value)}
                                                rows={5}
                                                className="w-full bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none resize-none custom-scrollbar"
                                                placeholder="Linked incidents..."
                                            />
                                        ) : (
                                            <span className="text-[14px] text-slate-700 whitespace-pre-wrap">{poiData.linkedIncidents || 'Unknown'}</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="h-px bg-slate-100" />

                            {/*No of times escalated to Intermediaries*/}
                            <div className="flex items-center min-h-[28px]">
                                <div className="w-1/2 shrink-0">
                                    <span className="text-[13px] font-semibold text-slate-500">No of times escalated to Intermediaries</span>
                                </div>
                                <div className="w-1/2 flex items-center">
                                    <span className="text-[13px] text-slate-400 mr-2">:</span>
                                    <span className="text-[14px] font-semibold text-slate-700">
                                        {totalEscalatedCount > 0 ? totalEscalatedCount : '0'}
                                    </span>
                                </div>
                            </div>

                            <div className="h-px bg-slate-100" />

                            {/*  Platform Profiles Section */}
                            <div className="pt-2 space-y-4">
                                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Social Media Profiles</div>

                                {/* Helper: update a field on a socialMedia entry */}
                                {/* NOTE: handlers defined inline via closures below */}

                                {/* X (Twitter) Profiles*/}
                                {(() => {
                                    const platform = 'x';
                                    const allSM = poiData.socialMedia || [];
                                    const entries = allSM.map((s, globalIdx) => ({ ...s, _globalIdx: globalIdx }))
                                        .filter(s => s.platform === platform || s.platform === 'twitter');

                                    const updateSM = (globalIdx, field, value) => {
                                        const arr = [...allSM];
                                        arr[globalIdx] = { ...arr[globalIdx], [field]: value };
                                        handleChange('socialMedia', arr);
                                    };
                                    const removeRow = (globalIdx) => {
                                        handleChange('socialMedia', allSM.filter((_, i) => i !== globalIdx));
                                    };
                                    const addRow = () => {
                                        handleChange('socialMedia', [
                                            ...allSM,
                                            {
                                                platform,
                                                sourceId: null,
                                                handle: '',
                                                displayName: poiData.realName || '',
                                                category: 'others',
                                                priority: 'medium',
                                                is_active: true,
                                                followerCount: '',
                                                createdDate: ''
                                            }
                                        ]);
                                    };

                                    return (
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <XLogo className="w-4 h-4 text-slate-900" />
                                                    <span className="text-[13px] font-semibold text-slate-600">X Profile</span>
                                                    <span className="text-[11px] text-slate-400">({entries.length})</span>
                                                </div>
                                            </div>

                                            {isEditing ? (
                                                <div className="space-y-3">
                                                    {entries.map((h, index) => (
                                                        <div key={h._globalIdx} className="border border-slate-200 bg-white rounded-lg p-3 relative shadow-sm">
                                                            <button type="button" onClick={() => removeRow(h._globalIdx)} className="absolute top-2 right-2 text-slate-400 hover:text-red-500 transition-colors">
                                                                <XCircle className="w-4 h-4" />
                                                            </button>
                                                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Monitoring Profile #{index + 1}</span>
                                                            <div className="grid grid-cols-2 gap-3 mt-2">
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Identifier / Handle <span className="text-red-500">*</span></Label>
                                                                    <Input value={h.handle || ''} onChange={e => updateSM(h._globalIdx, 'handle', e.target.value)} className="h-7 text-xs" placeholder="@handle" />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Display Name <span className="text-red-500">*</span></Label>
                                                                    <Input value={h.displayName || h.display_name || ''} onChange={e => updateSM(h._globalIdx, 'displayName', e.target.value)} className="h-7 text-xs" placeholder="Recognizable Name" />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Category</Label>
                                                                    <Select value={h.category || 'others'} onValueChange={(v) => updateSM(h._globalIdx, 'category', v)}>
                                                                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            {CATEGORY_OPTIONS.map(c => <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>)}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Priority</Label>
                                                                    <Select value={h.priority || 'medium'} onValueChange={(v) => updateSM(h._globalIdx, 'priority', v)}>
                                                                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="high" className="text-xs">High</SelectItem>
                                                                            <SelectItem value="medium" className="text-xs">Medium</SelectItem>
                                                                            <SelectItem value="low" className="text-xs">Low</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Followers (Optional)</Label>
                                                                    <Input value={h.followerCount || ''} onChange={e => updateSM(h._globalIdx, 'followerCount', e.target.value)} className="h-7 text-xs" placeholder="10K" />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Joined Date (Optional)</Label>
                                                                    <Input value={h.createdDate || h.joinedDate || ''} onChange={e => updateSM(h._globalIdx, 'createdDate', e.target.value)} className="h-7 text-xs" placeholder="Jan 2020" />
                                                                </div>
                                                                <div className="col-span-2 mt-1">
                                                                    <div className="flex items-center justify-between border border-slate-200 px-2 py-1 rounded h-7 bg-slate-50/50">
                                                                        <span className={`text-[11px] font-semibold ${h.is_active !== false ? 'text-sky-600' : 'text-slate-400'}`}>
                                                                            Monitoring Status: {h.is_active !== false ? 'Active' : 'Paused'}
                                                                        </span>
                                                                        <Switch checked={h.is_active !== false} onCheckedChange={(v) => updateSM(h._globalIdx, 'is_active', v)} className="scale-75 origin-right" />
                                                                    </div>
                                                                </div>
                                                                <div className="col-span-2 flex items-center gap-2 mt-1 pt-1 border-t border-slate-100">
                                                                    {h.sourceId ? (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => updateSM(h._globalIdx, 'sourceId', null)}
                                                                            className="text-[10px] font-bold text-red-500 hover:text-red-600 bg-red-50 px-2 py-0.5 rounded transition-colors"
                                                                        >
                                                                            Unlink Account
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setLinkingIdx(h._globalIdx);
                                                                                setIsLinking(true);
                                                                            }}
                                                                            className="text-[10px] font-bold text-blue-500 hover:text-blue-600 bg-blue-50 px-2 py-0.5 rounded transition-colors"
                                                                        >
                                                                            Link Search
                                                                        </button>
                                                                    )}
                                                                    {h.sourceId && (
                                                                        <span className="text-[9px] text-slate-400 font-medium italic">Linked to Source ID: {h.sourceId.substring(0, 8)}...</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    <button onClick={addRow} className="flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:text-sky-700 mt-2">
                                                        <PlusCircle className="w-3.5 h-3.5" /> Add another X Profile
                                                    </button>
                                                </div>
                                            ) : (
                                                entries.length > 0 ? (
                                                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                                                        <table className="w-full table-fixed border-collapse">
                                                            <thead>
                                                                <tr className="bg-slate-50 border-b border-slate-200">
                                                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left w-[40%]">Handle</th>
                                                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200 w-[30%]">Followers</th>
                                                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200 w-[30%]">Joined</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {entries.map((h) => (
                                                                    <tr key={h._globalIdx} className="border-b border-slate-100 last:border-b-0">
                                                                        <td className="py-1 px-2 align-middle break-all">
                                                                            <span className="text-[12px] text-sky-600 font-medium">{h.handle ? `@${h.handle.replace('@', '')}` : '—'}</span>
                                                                        </td>
                                                                        <td className="py-1 px-2 border-l border-slate-200 align-middle">
                                                                            <span className="text-[12px] text-slate-700">{h.followerCount || '—'}</span>
                                                                        </td>
                                                                        <td className="py-1 px-2 border-l border-slate-200 align-middle">
                                                                            <span className="text-[12px] text-slate-700">{h.createdDate || h.joinedDate || '—'}</span>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                ) : (
                                                    <span className="text-[12px] text-slate-400 italic">No X profiles linked</span>
                                                )
                                            )}
                                        </div>
                                    );
                                })()}

                                <div className="h-px bg-slate-50" />

                                {/* Facebook Profiles  */}
                                {(() => {
                                    const platform = 'facebook';
                                    const allSM = poiData.socialMedia || [];
                                    const entries = allSM.map((s, globalIdx) => ({ ...s, _globalIdx: globalIdx })).filter(s => s.platform === platform);

                                    const updateSM = (globalIdx, field, value) => {
                                        const arr = [...allSM];
                                        arr[globalIdx] = { ...arr[globalIdx], [field]: value };
                                        handleChange('socialMedia', arr);
                                    };
                                    const removeRow = (globalIdx) => {
                                        handleChange('socialMedia', allSM.filter((_, i) => i !== globalIdx));
                                    };
                                    const addRow = () => {
                                        handleChange('socialMedia', [
                                            ...allSM,
                                            {
                                                platform,
                                                sourceId: null,
                                                handle: '',
                                                display_name: poiData.realName || '',
                                                category: 'others',
                                                priority: 'medium',
                                                is_active: true,
                                                followerCount: '',
                                                createdDate: ''
                                            }
                                        ]);
                                    };

                                    return (
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <FacebookLogo className="w-4 h-4 text-blue-600" />
                                                    <span className="text-[13px] font-semibold text-slate-600">Facebook Profile</span>
                                                    <span className="text-[11px] text-slate-400">({entries.length})</span>
                                                </div>
                                            </div>

                                            {isEditing ? (
                                                <div className="space-y-3">
                                                    {entries.map((h, index) => (
                                                        <div key={h._globalIdx} className="border border-slate-200 bg-white rounded-lg p-3 relative shadow-sm">
                                                            <button type="button" onClick={() => removeRow(h._globalIdx)} className="absolute top-2 right-2 text-slate-400 hover:text-red-500 transition-colors">
                                                                <XCircle className="w-4 h-4" />
                                                            </button>
                                                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Monitoring Profile #{index + 1}</span>
                                                            <div className="grid grid-cols-2 gap-3 mt-2">
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Identifier / Handle <span className="text-red-500">*</span></Label>
                                                                    <Input value={h.handle || ''} onChange={e => updateSM(h._globalIdx, 'handle', e.target.value)} className="h-7 text-xs" placeholder="handle" />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Display Name <span className="text-red-500">*</span></Label>
                                                                    <Input value={h.displayName || h.display_name || ''} onChange={e => updateSM(h._globalIdx, 'displayName', e.target.value)} className="h-7 text-xs" placeholder="Recognizable Name" />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Category</Label>
                                                                    <Select value={h.category || 'others'} onValueChange={(v) => updateSM(h._globalIdx, 'category', v)}>
                                                                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            {CATEGORY_OPTIONS.map(c => <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>)}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Priority</Label>
                                                                    <Select value={h.priority || 'medium'} onValueChange={(v) => updateSM(h._globalIdx, 'priority', v)}>
                                                                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="high" className="text-xs">High</SelectItem>
                                                                            <SelectItem value="medium" className="text-xs">Medium</SelectItem>
                                                                            <SelectItem value="low" className="text-xs">Low</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Followers (Optional)</Label>
                                                                    <Input value={h.followerCount || ''} onChange={e => updateSM(h._globalIdx, 'followerCount', e.target.value)} className="h-7 text-xs" placeholder="10K" />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Joined Date (Optional)</Label>
                                                                    <Input value={h.createdDate || h.joinedDate || ''} onChange={e => updateSM(h._globalIdx, 'createdDate', e.target.value)} className="h-7 text-xs" placeholder="Jan 2020" />
                                                                </div>
                                                                <div className="col-span-2 mt-1">
                                                                    <div className="flex items-center justify-between border border-slate-200 px-2 py-1 rounded h-7 bg-slate-50/50">
                                                                        <span className={`text-[11px] font-semibold ${h.is_active !== false ? 'text-blue-600' : 'text-slate-400'}`}>
                                                                            Monitoring Status: {h.is_active !== false ? 'Active' : 'Paused'}
                                                                        </span>
                                                                        <Switch checked={h.is_active !== false} onCheckedChange={(v) => updateSM(h._globalIdx, 'is_active', v)} className="scale-75 origin-right" />
                                                                    </div>
                                                                </div>
                                                                <div className="col-span-2 flex items-center gap-2 mt-1 pt-1 border-t border-slate-100">
                                                                    {h.sourceId ? (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => updateSM(h._globalIdx, 'sourceId', null)}
                                                                            className="text-[10px] font-bold text-red-500 hover:text-red-600 bg-red-50 px-2 py-0.5 rounded transition-colors"
                                                                        >
                                                                            Unlink Account
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setLinkingIdx(h._globalIdx);
                                                                                setIsLinking(true);
                                                                            }}
                                                                            className="text-[10px] font-bold text-blue-500 hover:text-blue-600 bg-blue-50 px-2 py-0.5 rounded transition-colors"
                                                                        >
                                                                            Link Search
                                                                        </button>
                                                                    )}
                                                                    {h.sourceId && (
                                                                        <span className="text-[9px] text-slate-400 font-medium italic">Linked to Source ID: {h.sourceId.substring(0, 8)}...</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    <button onClick={addRow} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 mt-2">
                                                        <PlusCircle className="w-3.5 h-3.5" /> Add another Facebook Profile
                                                    </button>
                                                </div>
                                            ) : (
                                                entries.length > 0 ? (
                                                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                                                        <table className="w-full table-fixed border-collapse">
                                                            <thead>
                                                                <tr className="bg-slate-50 border-b border-slate-200">
                                                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left w-[40%]">Handle</th>
                                                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200 w-[30%]">Followers</th>
                                                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200 w-[30%]">Joined</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {entries.map((h) => (
                                                                    <tr key={h._globalIdx} className="border-b border-slate-100 last:border-b-0">
                                                                        <td className="py-1 px-2 align-middle break-all">
                                                                            <span className="text-[12px] text-blue-600 font-medium">{h.handle || '—'}</span>
                                                                        </td>
                                                                        <td className="py-1 px-2 border-l border-slate-200 align-middle">
                                                                            <span className="text-[12px] text-slate-700">{h.followerCount || '—'}</span>
                                                                        </td>
                                                                        <td className="py-1 px-2 border-l border-slate-200 align-middle">
                                                                            <span className="text-[12px] text-slate-700">{h.createdDate || h.joinedDate || '—'}</span>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                ) : (
                                                    <span className="text-[12px] text-slate-400 italic">No Facebook profiles linked</span>
                                                )
                                            )}
                                        </div>
                                    );
                                })()}

                                <div className="h-px bg-slate-50" />

                                {/* Instagram Profiles*/}
                                {(() => {
                                    const platform = 'instagram';
                                    const allSM = poiData.socialMedia || [];
                                    const entries = allSM.map((s, globalIdx) => ({ ...s, _globalIdx: globalIdx })).filter(s => s.platform === platform);

                                    const updateSM = (globalIdx, field, value) => {
                                        const arr = [...allSM];
                                        arr[globalIdx] = { ...arr[globalIdx], [field]: value };
                                        handleChange('socialMedia', arr);
                                    };
                                    const removeRow = (globalIdx) => {
                                        handleChange('socialMedia', allSM.filter((_, i) => i !== globalIdx));
                                    };
                                    const addRow = () => {
                                        handleChange('socialMedia', [
                                            ...allSM,
                                            {
                                                platform,
                                                sourceId: null,
                                                handle: '',
                                                display_name: poiData.realName || '',
                                                category: 'others',
                                                priority: 'medium',
                                                is_active: true,
                                                followerCount: '',
                                                createdDate: ''
                                            }
                                        ]);
                                    };

                                    return (
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <Instagram className="w-4 h-4 text-pink-500" />
                                                    <span className="text-[13px] font-semibold text-slate-600">Instagram Profile</span>
                                                    <span className="text-[11px] text-slate-400">({entries.length})</span>
                                                </div>
                                            </div>

                                            {isEditing ? (
                                                <div className="space-y-3">
                                                    {entries.map((h, index) => (
                                                        <div key={h._globalIdx} className="border border-slate-200 bg-white rounded-lg p-3 relative shadow-sm">
                                                            <button type="button" onClick={() => removeRow(h._globalIdx)} className="absolute top-2 right-2 text-slate-400 hover:text-red-500 transition-colors">
                                                                <XCircle className="w-4 h-4" />
                                                            </button>
                                                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Monitoring Profile #{index + 1}</span>
                                                            <div className="grid grid-cols-2 gap-3 mt-2">
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Identifier / Handle <span className="text-red-500">*</span></Label>
                                                                    <Input value={h.handle || ''} onChange={e => updateSM(h._globalIdx, 'handle', e.target.value)} className="h-7 text-xs" placeholder="@handle" />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Display Name <span className="text-red-500">*</span></Label>
                                                                    <Input value={h.displayName || h.display_name || ''} onChange={e => updateSM(h._globalIdx, 'displayName', e.target.value)} className="h-7 text-xs" placeholder="Recognizable Name" />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Category</Label>
                                                                    <Select value={h.category || 'others'} onValueChange={(v) => updateSM(h._globalIdx, 'category', v)}>
                                                                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            {CATEGORY_OPTIONS.map(c => <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>)}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Priority</Label>
                                                                    <Select value={h.priority || 'medium'} onValueChange={(v) => updateSM(h._globalIdx, 'priority', v)}>
                                                                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="high" className="text-xs">High</SelectItem>
                                                                            <SelectItem value="medium" className="text-xs">Medium</SelectItem>
                                                                            <SelectItem value="low" className="text-xs">Low</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Followers (Optional)</Label>
                                                                    <Input value={h.followerCount || ''} onChange={e => updateSM(h._globalIdx, 'followerCount', e.target.value)} className="h-7 text-xs" placeholder="10K" />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Joined Date (Optional)</Label>
                                                                    <Input value={h.createdDate || h.joinedDate || ''} onChange={e => updateSM(h._globalIdx, 'createdDate', e.target.value)} className="h-7 text-xs" placeholder="Jan 2020" />
                                                                </div>
                                                                <div className="col-span-2 mt-1">
                                                                    <div className="flex items-center justify-between border border-slate-200 px-2 py-1 rounded h-7 bg-slate-50/50">
                                                                        <span className={`text-[11px] font-semibold ${h.is_active !== false ? 'text-pink-600' : 'text-slate-400'}`}>
                                                                            Monitoring Status: {h.is_active !== false ? 'Active' : 'Paused'}
                                                                        </span>
                                                                        <Switch checked={h.is_active !== false} onCheckedChange={(v) => updateSM(h._globalIdx, 'is_active', v)} className="scale-75 origin-right" />
                                                                    </div>
                                                                </div>
                                                                <div className="col-span-2 flex items-center gap-2 mt-1 pt-1 border-t border-slate-100">
                                                                    {h.sourceId ? (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => updateSM(h._globalIdx, 'sourceId', null)}
                                                                            className="text-[10px] font-bold text-red-500 hover:text-red-600 bg-red-50 px-2 py-0.5 rounded transition-colors"
                                                                        >
                                                                            Unlink Account
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setLinkingIdx(h._globalIdx);
                                                                                setIsLinking(true);
                                                                            }}
                                                                            className="text-[10px] font-bold text-blue-500 hover:text-blue-600 bg-blue-50 px-2 py-0.5 rounded transition-colors"
                                                                        >
                                                                            Link Search
                                                                        </button>
                                                                    )}
                                                                    {h.sourceId && (
                                                                        <span className="text-[9px] text-slate-400 font-medium italic">Linked to Source ID: {h.sourceId.substring(0, 8)}...</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    <button onClick={addRow} className="flex items-center gap-1 text-[11px] font-semibold text-pink-600 hover:text-pink-700 mt-2">
                                                        <PlusCircle className="w-3.5 h-3.5" /> Add another Instagram Profile
                                                    </button>
                                                </div>
                                            ) : (
                                                entries.length > 0 ? (
                                                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                                                        <table className="w-full table-fixed border-collapse">
                                                            <thead>
                                                                <tr className="bg-slate-50 border-b border-slate-200">
                                                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left w-[40%]">Handle</th>
                                                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200 w-[30%]">Followers</th>
                                                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200 w-[30%]">Joined</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {entries.map((h) => (
                                                                    <tr key={h._globalIdx} className="border-b border-slate-100 last:border-b-0">
                                                                        <td className="py-1 px-2 align-middle break-all">
                                                                            <span className="text-[12px] text-pink-600 font-medium">{h.handle ? `@${h.handle.replace('@', '')}` : '—'}</span>
                                                                        </td>
                                                                        <td className="py-1 px-2 border-l border-slate-200 align-middle">
                                                                            <span className="text-[12px] text-slate-700">{h.followerCount || '—'}</span>
                                                                        </td>
                                                                        <td className="py-1 px-2 border-l border-slate-200 align-middle">
                                                                            <span className="text-[12px] text-slate-700">{h.createdDate || h.joinedDate || '—'}</span>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                ) : (
                                                    <span className="text-[12px] text-slate-400 italic">No Instagram profiles linked</span>
                                                )
                                            )}
                                        </div>
                                    );
                                })()}

                                <div className="h-px bg-slate-50" />

                                {/*YouTube Profiles*/}
                                {(() => {
                                    const platform = 'youtube';
                                    const allSM = poiData.socialMedia || [];
                                    const entries = allSM.map((s, globalIdx) => ({ ...s, _globalIdx: globalIdx })).filter(s => s.platform === platform);

                                    const updateSM = (globalIdx, field, value) => {
                                        const arr = [...allSM];
                                        arr[globalIdx] = { ...arr[globalIdx], [field]: value };
                                        handleChange('socialMedia', arr);
                                    };
                                    const removeRow = (globalIdx) => {
                                        handleChange('socialMedia', allSM.filter((_, i) => i !== globalIdx));
                                    };
                                    const addRow = () => {
                                        handleChange('socialMedia', [
                                            ...allSM,
                                            {
                                                platform,
                                                sourceId: null,
                                                handle: '',
                                                display_name: poiData.realName || '',
                                                category: 'others',
                                                priority: 'medium',
                                                is_active: true,
                                                followerCount: '',
                                                createdDate: ''
                                            }
                                        ]);
                                    };

                                    return (
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <Youtube className="w-4 h-4 text-red-500" />
                                                    <span className="text-[13px] font-semibold text-slate-600">YouTube Channel</span>
                                                    <span className="text-[11px] text-slate-400">({entries.length})</span>
                                                </div>
                                            </div>

                                            {isEditing ? (
                                                <div className="space-y-3">
                                                    {entries.map((h, index) => (
                                                        <div key={h._globalIdx} className="border border-slate-200 bg-white rounded-lg p-3 relative shadow-sm">
                                                            <button type="button" onClick={() => removeRow(h._globalIdx)} className="absolute top-2 right-2 text-slate-400 hover:text-red-500 transition-colors">
                                                                <XCircle className="w-4 h-4" />
                                                            </button>
                                                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Monitoring Profile #{index + 1}</span>
                                                            <div className="grid grid-cols-2 gap-3 mt-2">
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Channel ID / Handle <span className="text-red-500">*</span></Label>
                                                                    <Input value={h.handle || ''} onChange={e => updateSM(h._globalIdx, 'handle', e.target.value)} className="h-7 text-xs" placeholder="Channel ID/Handle" />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Display Name <span className="text-red-500">*</span></Label>
                                                                    <Input value={h.displayName || h.display_name || ''} onChange={e => updateSM(h._globalIdx, 'displayName', e.target.value)} className="h-7 text-xs" placeholder="Recognizable Name" />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Category</Label>
                                                                    <Select value={h.category || 'others'} onValueChange={(v) => updateSM(h._globalIdx, 'category', v)}>
                                                                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            {CATEGORY_OPTIONS.map(c => <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>)}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Priority</Label>
                                                                    <Select value={h.priority || 'medium'} onValueChange={(v) => updateSM(h._globalIdx, 'priority', v)}>
                                                                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="high" className="text-xs">High</SelectItem>
                                                                            <SelectItem value="medium" className="text-xs">Medium</SelectItem>
                                                                            <SelectItem value="low" className="text-xs">Low</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Subscribers (Optional)</Label>
                                                                    <Input value={h.followerCount || ''} onChange={e => updateSM(h._globalIdx, 'followerCount', e.target.value)} className="h-7 text-xs" placeholder="1M" />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-[11px] text-slate-500">Joined Date (Optional)</Label>
                                                                    <Input value={h.createdDate || h.joinedDate || ''} onChange={e => updateSM(h._globalIdx, 'createdDate', e.target.value)} className="h-7 text-xs" placeholder="Jan 2020" />
                                                                </div>
                                                                <div className="col-span-2 mt-1">
                                                                    <div className="flex items-center justify-between border border-slate-200 px-2 py-1 rounded h-7 bg-slate-50/50">
                                                                        <span className={`text-[11px] font-semibold ${h.is_active !== false ? 'text-red-600' : 'text-slate-400'}`}>
                                                                            Monitoring Status: {h.is_active !== false ? 'Active' : 'Paused'}
                                                                        </span>
                                                                        <Switch checked={h.is_active !== false} onCheckedChange={(v) => updateSM(h._globalIdx, 'is_active', v)} className="scale-75 origin-right" />
                                                                    </div>
                                                                </div>
                                                                <div className="col-span-2 flex items-center gap-2 mt-1 pt-1 border-t border-slate-100">
                                                                    {h.sourceId ? (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => updateSM(h._globalIdx, 'sourceId', null)}
                                                                            className="text-[10px] font-bold text-red-500 hover:text-red-600 bg-red-50 px-2 py-0.5 rounded transition-colors"
                                                                        >
                                                                            Unlink Account
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setLinkingIdx(h._globalIdx);
                                                                                setIsLinking(true);
                                                                            }}
                                                                            className="text-[10px] font-bold text-blue-500 hover:text-blue-600 bg-blue-50 px-2 py-0.5 rounded transition-colors"
                                                                        >
                                                                            Link Search
                                                                        </button>
                                                                    )}
                                                                    {h.sourceId && (
                                                                        <span className="text-[9px] text-slate-400 font-medium italic">Linked to Source ID: {h.sourceId.substring(0, 8)}...</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    <button onClick={addRow} className="flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:text-red-700 mt-2">
                                                        <PlusCircle className="w-3.5 h-3.5" /> Add another YouTube Channel
                                                    </button>
                                                </div>
                                            ) : (
                                                entries.length > 0 ? (
                                                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                                                        <table className="w-full table-fixed border-collapse">
                                                            <thead>
                                                                <tr className="bg-slate-50 border-b border-slate-200">
                                                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left w-[40%]">Channel / Handle</th>
                                                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200 w-[30%]">Subscribers</th>
                                                                    <th className="py-1.5 px-2 text-[10px] font-bold text-slate-500 uppercase text-left border-l border-slate-200 w-[30%]">Joined</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {entries.map((h) => (
                                                                    <tr key={h._globalIdx} className="border-b border-slate-100 last:border-b-0">
                                                                        <td className="py-1 px-2 align-middle break-all">
                                                                            <span className="text-[12px] text-red-600 font-medium">{h.handle || '—'}</span>
                                                                        </td>
                                                                        <td className="py-1 px-2 border-l border-slate-200 align-middle">
                                                                            <span className="text-[12px] text-slate-700">{h.followerCount || '—'}</span>
                                                                        </td>
                                                                        <td className="py-1 px-2 border-l border-slate-200 align-middle">
                                                                            <span className="text-[12px] text-slate-700">{h.createdDate || h.joinedDate || '—'}</span>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                ) : (
                                                    <span className="text-[12px] text-slate-400 italic">No YouTube channels linked</span>
                                                )
                                            )}
                                        </div>
                                    );
                                })()}

                                <div className="h-px bg-slate-50" />

                                {/*WhatsApp*/}
                                <div className="flex items-start min-h-[36px] py-1">
                                    <div className="w-1/2 shrink-0 pt-0.5 flex items-center gap-2">
                                        <MessageCircle className="w-4 h-4 text-green-500" />
                                        <span className="text-[13px] font-semibold text-slate-600">WhatsApp</span>
                                    </div>
                                    <div className="w-1/2 flex items-start">
                                        <span className="text-[13px] text-slate-400 mr-2 pt-0.5">:</span>
                                        <div className="flex-1 pt-0.5">
                                            {isEditing ? (
                                                <div className="space-y-1">
                                                    {(poiData.whatsappNumbers || ['']).map((num, idx) => (
                                                        <div key={idx} className="flex items-center gap-1">
                                                            <input
                                                                type="text"
                                                                value={num}
                                                                onChange={(e) => {
                                                                    const arr = [...(poiData.whatsappNumbers || [''])];
                                                                    arr[idx] = e.target.value;
                                                                    handleChange('whatsappNumbers', arr);
                                                                }}
                                                                className="flex-1 bg-transparent border-b border-slate-200 text-[13px] text-slate-700 focus:border-green-500 outline-none pb-0.5"
                                                                placeholder="+91 XXXXX XXXXX"
                                                            />
                                                            {(poiData.whatsappNumbers || []).length > 1 && (
                                                                <button onClick={() => {
                                                                    const arr = (poiData.whatsappNumbers || []).filter((_, i) => i !== idx);
                                                                    handleChange('whatsappNumbers', arr);
                                                                }} className="text-red-400 hover:text-red-600">
                                                                    <MinusCircle className="w-3.5 h-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))}
                                                    <button onClick={() => handleChange('whatsappNumbers', [...(poiData.whatsappNumbers || []), ''])} className="flex items-center gap-1 text-[11px] font-semibold text-green-600 hover:text-green-700 mt-1">
                                                        <PlusCircle className="w-3.5 h-3.5" /> Add Number
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="text-[13px] text-slate-700 break-all leading-relaxed">
                                                    {poiData.whatsappNumbers && poiData.whatsappNumbers.filter(n => n).length > 0 ? (
                                                        poiData.whatsappNumbers.filter(n => n).join(', ')
                                                    ) : (
                                                        <span className="text-slate-400 italic">No numbers</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="h-px bg-slate-100 mt-4 mb-2" />

                            {/* Previously Deleted Profiles */}
                            <div className="pt-2">
                                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Previously Deleted Profiles</div>

                                {[
                                    { key: 'x', label: 'X Profiles' },
                                    { key: 'facebook', label: 'Face Book' },
                                    { key: 'instagram', label: 'Instagram' },
                                    { key: 'youtube', label: 'Youtube' },
                                    { key: 'whatsapp', label: 'Whatsapp' }
                                ].map(({ key, label }) => {
                                    const profiles = poiData.previouslyDeletedProfiles?.[key] || [];

                                    return (
                                        <div key={key} className="flex items-start min-h-[36px] mb-1">
                                            <div className="w-1/2 shrink-0 pt-1">
                                                <span className="text-[13px] font-semibold text-slate-500">{label}</span>
                                            </div>
                                            <div className="w-1/2 flex items-start">
                                                <span className="text-[13px] text-slate-400 mr-2 pt-1">:</span>
                                                <div className="flex-1">
                                                    {isEditing ? (
                                                        <div className="space-y-1">
                                                            {(profiles.length > 0 ? profiles : ['']).map((val, idx) => (
                                                                <div key={idx} className="flex items-center gap-1">
                                                                    <input
                                                                        type="text"
                                                                        value={val}
                                                                        onChange={(e) => {
                                                                            const newProfiles = [...(poiData.previouslyDeletedProfiles?.[key] || (profiles.length === 0 ? [''] : []))];
                                                                            if (newProfiles.length === 0) newProfiles.push('');
                                                                            newProfiles[idx] = e.target.value;
                                                                            setPoiData(prev => ({
                                                                                ...prev,
                                                                                previouslyDeletedProfiles: {
                                                                                    ...prev.previouslyDeletedProfiles,
                                                                                    [key]: newProfiles
                                                                                }
                                                                            }));
                                                                        }}
                                                                        className="flex-1 bg-transparent border-b border-slate-200 text-[14px] text-slate-700 focus:border-blue-500 outline-none pb-0.5"
                                                                        placeholder="Unknown"
                                                                    />
                                                                    {profiles.length > 1 && (
                                                                        <button onClick={() => {
                                                                            const newProfiles = profiles.filter((_, i) => i !== idx);
                                                                            setPoiData(prev => ({
                                                                                ...prev,
                                                                                previouslyDeletedProfiles: {
                                                                                    ...prev.previouslyDeletedProfiles,
                                                                                    [key]: newProfiles
                                                                                }
                                                                            }));
                                                                        }} className="text-red-400 hover:text-red-600">
                                                                            <MinusCircle className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))}
                                                            <button onClick={() => {
                                                                const current = poiData.previouslyDeletedProfiles?.[key] || [];
                                                                const newProfiles = [...current, ''];
                                                                setPoiData(prev => ({
                                                                    ...prev,
                                                                    previouslyDeletedProfiles: {
                                                                        ...prev.previouslyDeletedProfiles,
                                                                        [key]: newProfiles
                                                                    }
                                                                }));
                                                            }} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 mt-1">
                                                                <PlusCircle className="w-3.5 h-3.5" /> Add Field
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[14px] text-slate-700 break-words">
                                                            {profiles.filter(p => p).length > 0 ? profiles.filter(p => p).join(', ') : 'Unknown'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                        </div>
                    </div>
                    {/* RIGHT CONTENT - INTERACTIVE DASHBOARD (75%) */}
                    <div className="flex-1 flex flex-col min-w-0 bg-white relative z-0">
                        {/* Floating Controls for collapsed sidebar */}
                        {
                            !isSidebarOpen && (
                                <div className="absolute top-4 left-4 flex gap-2 z-20">
                                    <button
                                        onClick={() => navigate(-1)}
                                        className="bg-white/90 backdrop-blur shadow-sm p-1.5 rounded-full text-gray-500 hover:text-gray-700 hover:bg-white transition-all border border-gray-100"
                                        title="Back"
                                    >
                                        <ArrowLeft className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => setIsSidebarOpen(true)}
                                        className="bg-white/90 backdrop-blur shadow-sm p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-white transition-all border border-gray-100"
                                        title="Show Profile"
                                    >
                                        <PanelLeftOpen className="w-5 h-5" />
                                    </button>
                                </div>
                            )
                        }

                        {/* Filter Bar */}
                        <div className="px-6 bg-white sticky top-0 z-10">
                            <div className={`flex items-center gap-8 ${!isSidebarOpen ? 'pl-20' : ''}`}>
                                {platforms.map((platform) => {
                                    const isActive = selectedPlatform === platform.id;
                                    const Icon = platform.icon;

                                    return (
                                        <button
                                            key={platform.id}
                                            onClick={() => setSelectedPlatform(platform.id)}
                                            className={`
                                            group flex items-center gap-2.5 py-4 text-[15px] font-bold transition-all relative border-b-2
                                            ${isActive
                                                    ? `${platform.activeText} ${platform.activeBorder}`
                                                    : `text-gray-500 border-transparent hover:text-gray-700`
                                                }
                                        `}
                                        >
                                            <Icon className={`w-5 h-5 ${isActive ? platform.text : 'text-gray-400'}`} />
                                            <span>{platform.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Feed Content Area */}
                        <div className="flex-1 overflow-y-auto bg-gray-50/50 p-6 relative custom-scrollbar">
                            {/* CASE 1: No Platform Selected */}
                            {!selectedPlatform && (
                                <div className="h-full w-full flex flex-col items-center justify-center text-center opacity-40">
                                    <Activity className="w-16 h-16 text-gray-300 mb-4" />
                                    <h3 className="text-lg font-bold text-gray-800">No Data Stream Selected</h3>
                                    <p className="text-sm text-gray-500 max-w-sm mt-2">
                                        Select a platform from the top bar to initialize the data stream and view analyzed content.
                                    </p>
                                </div>
                            )}

                            {/* CASE 2: Linking Phase */}
                            {selectedPlatform && isLinking && (
                                <div className={`${isSidebarOpen ? 'max-w-2xl' : 'max-w-4xl'} mx-auto mt-10 animate-in fade-in slide-in-from-bottom-2 duration-300 transition-all`}>
                                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                        <div className="p-6 border-b border-gray-100 text-center bg-gray-50/30">
                                            <div className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-3 ${platforms.find(p => p.id === selectedPlatform)?.bg || 'bg-gray-100'}`}>
                                                <LinkIcon className={`w-6 h-6 ${platforms.find(p => p.id === selectedPlatform)?.text || 'text-gray-400'}`} />
                                            </div>
                                            <h2 className="text-lg font-bold text-gray-900">Link {platforms.find(p => p.id === selectedPlatform)?.label || selectedPlatform} Account</h2>
                                            {linkingIdx !== null && poiData.socialMedia[linkingIdx] && (
                                                <p className="text-sm font-bold text-blue-600 mt-1">Linking for: {poiData.socialMedia[linkingIdx].displayName || poiData.socialMedia[linkingIdx].handle}</p>
                                            )}
                                            <p className="text-sm text-gray-500 mt-1">Connect a social profile to monitor activity and alerts.</p>
                                        </div>

                                        <div className="p-6">
                                            {linkStep === 'search' && (
                                                <div className="space-y-4">
                                                    <div className="relative">
                                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                                        <input
                                                            type="text"
                                                            placeholder={`Search existing ${selectedPlatform} handles...`}
                                                            value={searchTerm}
                                                            onChange={(e) => setSearchTerm(e.target.value)}
                                                            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                                                        />
                                                        {loadingSources && (
                                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                                        {sortedSources.length > 0 ? (
                                                            sortedSources.map(source => {
                                                                const checkMatch = (s) => {
                                                                    const id = s.identifier?.toLowerCase() || '';
                                                                    const dn = s.display_name?.toLowerCase() || '';

                                                                    const namesToCheck = [
                                                                        poiData.name,
                                                                        poiData.realName,
                                                                        ...(poiData.aliasNames || [])
                                                                    ].filter(Boolean).map(n => n.toLowerCase());

                                                                    // Full name match (highest priority)
                                                                    if (namesToCheck.some(n => id.includes(n) || dn.includes(n))) return 2;

                                                                    // Aggressive word-based match
                                                                    const allWords = namesToCheck.flatMap(n => n.split(/[\s._-]+/)).filter(w => w.length > 2);
                                                                    if (allWords.some(w => id.includes(w) || dn.includes(w))) return 1;

                                                                    return 0;
                                                                };

                                                                const isSuggested = checkMatch(source) > 0;

                                                                return (
                                                                    <div
                                                                        key={source._id || source.id}
                                                                        onClick={() => handleLinkSource(source)}
                                                                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all group ${isSuggested
                                                                            ? 'bg-blue-50/30 border-blue-200 hover:bg-blue-50'
                                                                            : 'border-gray-100 hover:border-blue-200 hover:bg-gray-50'
                                                                            }`}
                                                                    >
                                                                        <div className="flex items-center gap-3">
                                                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${isSuggested ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                                                                                }`}>
                                                                                {getInitial(source.display_name)}
                                                                            </div>
                                                                            <div>
                                                                                <div className="flex items-center gap-2">
                                                                                    <div className="text-sm font-bold text-gray-800">{source.display_name}</div>
                                                                                    {isSuggested && (
                                                                                        <span className="text-[10px] font-bold bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">Suggested</span>
                                                                                    )}
                                                                                </div>
                                                                                <div className="text-xs text-gray-500 font-mono">
                                                                                    {source.identifier.length > 30 ? source.identifier.substring(0, 30) + '...' : source.identifier}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        <button className="text-xs font-bold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1 bg-blue-100 rounded">
                                                                            Link
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })
                                                        ) : (
                                                            <div className="text-center py-6">
                                                                <p className="text-sm text-gray-400">No matching sources found.</p>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="pt-4 border-t border-gray-100 text-center">
                                                        <p className="text-xs text-gray-500 mb-3">Can't find the profile?</p>
                                                        <Button
                                                            onClick={() => setAddSourceDialogOpen(true)}
                                                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
                                                        >
                                                            <PlusCircle className="w-4 h-4" />
                                                            Add New Source
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Add Source Dialog */}
                            <AddSourceModal
                                open={addSourceDialogOpen}
                                onClose={() => {
                                    if (isAddSourceDirty) {
                                        setShowDiscardConfirm(true);
                                    } else {
                                        setAddSourceDialogOpen(false);
                                    }
                                }}
                                onDirtyChange={setIsAddSourceDirty}
                                onSuccess={(newSource) => {
                                    setSources(prev => [...prev, newSource]);
                                    handleLinkSource(newSource);
                                    setAddSourceDialogOpen(false);
                                    setIsAddSourceDirty(false);
                                }}
                            />

                            {/* CASE 3: Active Feed */}
                            <div className="no-print">
                                {selectedPlatform && linkedHandles.length > 0 && !isLinking && (
                                    <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        {/* Multi-Account Header Snapshots */}
                                        <div className="mb-6">
                                            <div className="flex items-center justify-between mb-4">
                                                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-3">
                                                    <span className={`p-2 rounded-lg ${platforms.find(p => p.id === selectedPlatform)?.bg || 'bg-gray-100'}`}>
                                                        {platforms.find(p => p.id === selectedPlatform)?.icon ? (
                                                            React.createElement(
                                                                platforms.find(p => p.id === selectedPlatform).icon,
                                                                { className: `w-5 h-5 ${platforms.find(p => p.id === selectedPlatform)?.text || ''}` }
                                                            )
                                                        ) : (
                                                            <Activity className="w-5 h-5 text-gray-400" />
                                                        )}
                                                    </span>
                                                    {(!selectedSourceId && linkedHandles.length > 0) ? (
                                                        <span>{platforms.find(p => p.id === selectedPlatform)?.label} Aggregated Feed</span>
                                                    ) : (
                                                        (() => {
                                                            const displayHandle = selectedSourceId
                                                                ? linkedHandles.find(h => (h.sourceId || h.id || h._id) === selectedSourceId)
                                                                : linkedHandle;
                                                            return (
                                                                <div className="flex items-center gap-2">
                                                                    <a
                                                                        href={getSocialMediaUrl(selectedPlatform, displayHandle?.handle)}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="hover:underline hover:text-blue-600 transition-colors"
                                                                    >
                                                                        {displayHandle?.displayName || displayHandle?.display_name || displayHandle?.handle}
                                                                    </a>
                                                                    <a
                                                                        href={getSocialMediaUrl(selectedPlatform, displayHandle?.handle)}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-all"
                                                                        title="Open in new tab"
                                                                    >
                                                                        <ExternalLink className="w-3.5 h-3.5" />
                                                                    </a>
                                                                </div>
                                                            );
                                                        })()
                                                    )}
                                                </h2>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => {
                                                            setLinkingIdx(null); // Signals a new row addition on link
                                                            setIsLinking(true);
                                                            setIsUnlinkingMode(false);
                                                        }}
                                                        className="text-[10px] font-bold uppercase tracking-wider text-blue-600 hover:text-blue-700 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 rounded-md transition-all active:scale-95 flex items-center gap-1"
                                                    >
                                                        <PlusCircle className="w-3 h-3" />
                                                        Link New Account
                                                    </button>
                                                    {linkedHandles.length > 0 && (
                                                        <button
                                                            onClick={() => {
                                                                if (!isUnlinkingMode) {
                                                                    setIsUnlinkingMode(true);
                                                                    setUnlinkingSelection([]);
                                                                } else if (unlinkingSelection.length > 0) {
                                                                    handleUnlinkSource();
                                                                } else {
                                                                    setIsUnlinkingMode(false);
                                                                }
                                                            }}
                                                            className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md transition-all active:scale-95 ${isUnlinkingMode && unlinkingSelection.length > 0
                                                                ? 'text-white bg-red-500 hover:bg-red-600'
                                                                : 'text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100'
                                                                }`}
                                                        >
                                                            {isUnlinkingMode ? (unlinkingSelection.length > 0 ? 'Confirm Unlink' : 'Cancel') : 'Unlink'}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Account Snapshots Ribbon */}
                                            {linkedHandles.length > 0 && (
                                                <div className="flex items-center gap-3 overflow-x-auto pb-4 custom-scrollbar-horizontal border-b border-gray-100 mb-2">
                                                    {linkedHandles.map((handle, idx) => {
                                                        const sId = handle.sourceId || handle.id || handle._id;
                                                        const isSelected = selectedSourceId === sId;
                                                        const isUnlinkSelected = unlinkingSelection.includes(sId);

                                                        return (
                                                            <div
                                                                key={idx}
                                                                onClick={() => {
                                                                    if (isUnlinkingMode) {
                                                                        setUnlinkingSelection(prev =>
                                                                            prev.includes(sId) ? prev.filter(id => id !== sId) : [...prev, sId]
                                                                        );
                                                                    } else {
                                                                        setSelectedSourceId(sId);
                                                                    }
                                                                }}
                                                                className={`flex items-center gap-2.5 bg-gray-50/80 border p-2 rounded-xl min-w-fit hover:bg-white hover:shadow-sm transition-all cursor-pointer group ${isUnlinkingMode
                                                                    ? (isUnlinkSelected ? 'border-red-500 ring-1 ring-red-500 shadow-md bg-red-50' : 'border-gray-200/60')
                                                                    : (isSelected ? 'border-blue-500 ring-1 ring-blue-500 shadow-md bg-white' : 'border-gray-200/60')
                                                                    }`}
                                                            >
                                                                <div className="relative">
                                                                    <div className={`w-10 h-10 rounded-full overflow-hidden shadow-sm ring-1 ring-gray-100 ${isUnlinkingMode ? (isUnlinkSelected ? 'border-2 border-red-200' : 'border-2 border-gray-200 opacity-60') : (isSelected ? 'border-2 border-blue-100' : 'border-2 border-white')}`}>
                                                                        {handle.profileImage ? (
                                                                            <img src={proxifyImageUrl(handle.profileImage)} alt={handle.handle} className="w-full h-full object-cover" />
                                                                        ) : (
                                                                            <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-400 uppercase font-bold text-sm">
                                                                                {getInitial(handle.displayName || handle.display_name || handle.handle)}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    {isUnlinkingMode ? (
                                                                        <div className="absolute -top-1 -right-1 bg-white rounded-md">
                                                                            {isUnlinkSelected ? (
                                                                                <CheckSquare className="w-4 h-4 text-red-500 fill-red-50" />
                                                                            ) : (
                                                                                <Square className="w-4 h-4 text-gray-300" />
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="absolute -top-1 -right-1">
                                                                            <div className={`w-3.5 h-3.5 rounded-full border-2 border-white flex items-center justify-center ${handle.is_active !== false ? 'bg-green-500' : 'bg-gray-400'}`}>
                                                                                {handle.is_active !== false && <Check className="w-2 h-2 text-white" />}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="flex flex-col pr-1">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className={`text-xs font-bold truncate max-w-[120px] ${isSelected ? 'text-blue-700' : 'text-gray-800'}`}>
                                                                            {handle.displayName || handle.display_name || handle.handle}
                                                                        </span>
                                                                        <a
                                                                            href={getSocialMediaUrl(selectedPlatform, handle.handle)}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            onClick={(e) => e.stopPropagation()} // Prevent link click from triggering filter toggle
                                                                            className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-blue-600 transition-all"
                                                                        >
                                                                            <ExternalLink className="w-3 h-3" />
                                                                        </a>
                                                                    </div>
                                                                    <span className={`text-[10px] font-medium ${isSelected ? 'text-blue-400' : 'text-gray-400'}`}>
                                                                        {handle.handle && !handle.handle.startsWith('@') ? `@${handle.handle}` : handle.handle}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>

                                        {/* Tabs Navigation */}
                                        <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
                                            <button
                                                onClick={() => setRightPanelTab('content')}
                                                className={`px-4 py-2 text-sm font-medium border-b-2 transition-all flex items-center gap-2 ${rightPanelTab === 'content' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                            >
                                                <LayoutGrid className="w-4 h-4" />
                                                Content
                                            </button>
                                            <button
                                                onClick={() => setRightPanelTab('reports')}
                                                className={`px-4 py-2 text-sm font-medium border-b-2 transition-all flex items-center gap-2 ${rightPanelTab === 'reports' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                            >
                                                <FileText className="w-4 h-4" />
                                                Reports History
                                                {reports.length > 0 && (
                                                    <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full text-[10px]">{reports.length}</span>
                                                )}
                                            </button>
                                            <button
                                                onClick={() => setRightPanelTab('analysis')}
                                                className={`px-4 py-2 text-sm font-medium border-b-2 transition-all flex items-center gap-2 ${rightPanelTab === 'analysis' ? 'border-black text-black' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                            >
                                                <Activity className="w-4 h-4" />
                                                Risk Analysis
                                            </button>
                                        </div>

                                        <div className="flex flex-col gap-6 w-full transition-all duration-300">

                                            {/* CONTENT TAB */}
                                            {rightPanelTab === 'content' && (
                                                <>
                                                    {loadingFeed ? (
                                                        <div className="flex items-center justify-center py-12 col-span-full">
                                                            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                                                        </div>
                                                    ) : contentFeed.length > 0 ? (
                                                        contentFeed.map((item) => (
                                                            <div key={item.id || item._id} className="break-inside-avoid mb-6">
                                                                {selectedPlatform === 'youtube' ? (
                                                                    <YoutubeAlertCard
                                                                        alert={item.primary_alert || item}
                                                                        content={item}
                                                                        source={item.source_meta || {
                                                                            name: linkedHandle?.displayName || linkedHandle?.display_name,
                                                                            handle: linkedHandle?.handle,
                                                                            profile_image_url: linkedHandle?.profileImage || null
                                                                        }}
                                                                        viewMode="list"
                                                                        hideActions={false}
                                                                    />
                                                                ) : (
                                                                    <TwitterAlertCard
                                                                        alert={item.primary_alert || { ...item, platform: selectedPlatform === 'twitter' ? 'x' : selectedPlatform }}
                                                                        content={item}
                                                                        source={item.source_meta || {
                                                                            name: linkedHandle?.displayName || linkedHandle?.display_name,
                                                                            handle: linkedHandle?.handle,
                                                                            profile_image_url: linkedHandle?.profileImage || null
                                                                        }}
                                                                        viewMode="list"
                                                                        hideActions={false}
                                                                    />
                                                                )}
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <div className="text-center py-10 bg-white rounded-xl border border-dashed border-gray-200 col-span-full">
                                                            <p className="text-gray-500 text-sm">No recent content found for this profile.</p>
                                                        </div>
                                                    )}

                                                    {/* Load More Sentinel */}
                                                    {hasMore && linkedHandle && contentFeed.length > 0 && (
                                                        <div ref={observerTarget} className="py-8 flex justify-center w-full col-span-full">
                                                            {isFetchingMore ? (
                                                                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                                                            ) : (
                                                                <span className="text-gray-400 text-xs font-medium">Loading more historical content...</span>
                                                            )}
                                                        </div>
                                                    )}

                                                    {!hasMore && contentFeed.length > 0 && (
                                                        <div className="py-8 text-center text-gray-400 text-xs font-medium w-full col-span-full border-t border-gray-100 mt-4 italic">
                                                            Reached the beginning of the feed. All content loaded.
                                                        </div>
                                                    )}
                                                </>
                                            )}

                                            {/* REPORTS TAB */}
                                            {rightPanelTab === 'reports' && (
                                                <div className="flex flex-col gap-4">
                                                    {/* Escalation Metrics Dashboard */}
                                                    <div className="flex items-center justify-between bg-white px-4 py-3 rounded-xl border border-gray-200 shadow-sm">
                                                        <div className="flex items-center gap-6">
                                                            <div className="flex flex-col items-center min-w-[60px]">
                                                                {statsLoading ? (
                                                                    <div className="h-6 w-8 bg-gray-100 animate-pulse rounded" />
                                                                ) : (
                                                                    <span className="text-xl font-bold text-purple-600">{escalationStats.escalated}</span>
                                                                )}
                                                                <span className="text-[9px] uppercase font-bold text-gray-500 tracking-wider text-center leading-tight mt-1">Escalated</span>
                                                            </div>

                                                            <div className="h-8 w-px bg-gray-100"></div>

                                                            <div className="flex flex-col items-center min-w-[60px]">
                                                                {statsLoading ? (
                                                                    <div className="h-6 w-8 bg-gray-100 animate-pulse rounded" />
                                                                ) : (
                                                                    <span className="text-xl font-bold text-blue-600">{escalationStats.sentToIntermediary}</span>
                                                                )}
                                                                <span className="text-[9px] uppercase font-bold text-gray-500 tracking-wider text-center leading-tight mt-1">Sent To Int.</span>
                                                            </div>

                                                            <div className="h-8 w-px bg-gray-100"></div>

                                                            <div className="flex flex-col items-center min-w-[60px]">
                                                                {statsLoading ? (
                                                                    <div className="h-6 w-8 bg-gray-100 animate-pulse rounded" />
                                                                ) : (
                                                                    <span className="text-xl font-bold text-green-600">{escalationStats.closed}</span>
                                                                )}
                                                                <span className="text-[9px] uppercase font-bold text-gray-500 tracking-wider text-center leading-tight mt-1">Closed</span>
                                                            </div>
                                                        </div>

                                                        <div className="h-6 w-px bg-gray-200 mx-2"></div>

                                                        <button
                                                            onClick={() => {
                                                                if (linkedHandle?.handle) {
                                                                    navigate(`/alerts?status=reports&handle=${encodeURIComponent(linkedHandle.handle)}`);
                                                                    window.scrollTo(0, 0);
                                                                }
                                                            }}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-all"
                                                        >
                                                            View History
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>

                                                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                                        {statsLoading ? (
                                                            <div className="p-8 text-center">
                                                                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-2" />
                                                                <p className="text-sm text-gray-500">Loading reports history...</p>
                                                            </div>
                                                        ) : reports.length > 0 ? (
                                                            <div className="overflow-x-auto">
                                                                <table className="w-full text-left">
                                                                    <thead className="bg-gray-50/50 border-b border-gray-100">
                                                                        <tr>
                                                                            <th className="px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Report SN</th>
                                                                            <th className="px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Date</th>
                                                                            <th className="px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
                                                                            <th className="px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-gray-100">
                                                                        {reports.map((report) => (
                                                                            <tr key={report.id || report._id} className="hover:bg-gray-50/50 transition-colors">
                                                                                <td className="px-4 py-3">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <Hash className="w-3.5 h-3.5 text-blue-500" />
                                                                                        <span className="text-sm font-medium font-mono text-gray-700">{report.serial_number}</span>
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-4 py-3">
                                                                                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                                                                                        <Calendar className="w-3 h-3" />
                                                                                        {new Date(report.generated_at).toLocaleDateString()}
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-4 py-3">
                                                                                    <Badge variant="secondary" className={`text-[10px] font-bold uppercase ${['closed', 'resolved'].includes(report.status) ? 'bg-green-100 text-green-700' :
                                                                                        ['sent', 'sent_to_intermediary'].includes(report.status) ? 'bg-blue-100 text-blue-700' :
                                                                                            'bg-amber-100 text-amber-700'
                                                                                        }`}>
                                                                                        {report.status}
                                                                                    </Badge>
                                                                                </td>
                                                                                <td className="px-4 py-3 text-right">
                                                                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 ml-auto" onClick={() => navigate(`/reports/generate/${report.alert_id}`)}>
                                                                                        <Eye className="w-3.5 h-3.5 text-gray-500" />
                                                                                    </Button>
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>

                                                                {hasMoreReports && (
                                                                    <div className="p-4 border-t border-gray-100 flex justify-center">
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            className="text-blue-600 font-bold text-xs"
                                                                            onClick={() => fetchEscalationStats(linkedHandles, true)}
                                                                            disabled={loadingMoreReports}
                                                                        >
                                                                            {loadingMoreReports ? (
                                                                                <>
                                                                                    <Loader2 className="w-3 h-3 animate-spin mr-2" />
                                                                                    Loading...
                                                                                </>
                                                                            ) : (
                                                                                'Load More Reports'
                                                                            )}
                                                                        </Button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <div className="p-12 text-center text-gray-500">
                                                                <FileText className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                                                                <p className="text-sm font-medium">No reports generated yet</p>
                                                                <p className="text-xs text-gray-400 mt-1">Escalate alerts to generate formal reports</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* RISK ANALYSIS TAB */}
                                            {rightPanelTab === 'analysis' && (
                                                <div className="space-y-6">
                                                    {contentFeed.length > 0 ? (
                                                        <Card className="border-none shadow-sm bg-white">
                                                            <CardHeader className="pb-2">
                                                                <CardTitle className="text-base font-semibold">Risk Distribution</CardTitle>
                                                                <CardDescription>Based on {contentFeed.length} analyzed items</CardDescription>
                                                            </CardHeader>
                                                            <CardContent>
                                                                <div className="h-[250px] w-full mt-2">
                                                                    <ResponsiveContainer width="100%" height="100%">
                                                                        <PieChart>
                                                                            <Pie
                                                                                data={[
                                                                                    { name: 'High', value: contentFeed.filter(i => (i.risk_level === 'high' || i.analysis?.risk_level === 'HIGH')).length, color: '#ef4444' },
                                                                                    { name: 'Medium', value: contentFeed.filter(i => (i.risk_level === 'medium' || i.analysis?.risk_level === 'MEDIUM')).length, color: '#f59e0b' },
                                                                                    { name: 'Low', value: contentFeed.filter(i => (i.risk_level === 'low' || i.analysis?.risk_level === 'LOW') || (!i.risk_level && !i.analysis?.risk_level)).length, color: '#10b981' },
                                                                                ].filter(i => i.value > 0)}
                                                                                cx="50%"
                                                                                cy="50%"
                                                                                innerRadius={60}
                                                                                outerRadius={80}
                                                                                paddingAngle={2}
                                                                                dataKey="value"
                                                                            >
                                                                                {[
                                                                                    { name: 'High', value: contentFeed.filter(i => (i.risk_level === 'high' || i.analysis?.risk_level === 'HIGH')).length, color: '#ef4444' },
                                                                                    { name: 'Medium', value: contentFeed.filter(i => (i.risk_level === 'medium' || i.analysis?.risk_level === 'MEDIUM')).length, color: '#f59e0b' },
                                                                                    { name: 'Low', value: contentFeed.filter(i => (i.risk_level === 'low' || i.analysis?.risk_level === 'LOW') || (!i.risk_level && !i.analysis?.risk_level)).length, color: '#10b981' },
                                                                                ].filter(i => i.value > 0).map((entry, index) => (
                                                                                    <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
                                                                                ))}
                                                                            </Pie>
                                                                            <RechartsTooltip
                                                                                formatter={(value, name) => [value, `${name} Risk`]}
                                                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                                            />
                                                                            <Legend verticalAlign="bottom" height={36} />
                                                                        </PieChart>
                                                                    </ResponsiveContainer>
                                                                </div>
                                                                <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                                                                    <div className="p-2 bg-red-50 rounded-lg">
                                                                        <div className="text-xl font-bold text-red-600">
                                                                            {contentFeed.filter(i => (i.risk_level === 'high' || i.analysis?.risk_level === 'HIGH')).length}
                                                                        </div>
                                                                        <div className="text-[10px] uppercase font-bold text-red-400">High</div>
                                                                    </div>
                                                                    <div className="p-2 bg-amber-50 rounded-lg">
                                                                        <div className="text-xl font-bold text-amber-600">
                                                                            {contentFeed.filter(i => (i.risk_level === 'medium' || i.analysis?.risk_level === 'MEDIUM')).length}
                                                                        </div>
                                                                        <div className="text-[10px] uppercase font-bold text-amber-400">Medium</div>
                                                                    </div>
                                                                    <div className="p-2 bg-emerald-50 rounded-lg">
                                                                        <div className="text-xl font-bold text-emerald-600">
                                                                            {contentFeed.filter(i => (i.risk_level === 'low' || i.analysis?.risk_level === 'LOW') || (!i.risk_level && !i.analysis?.risk_level)).length}
                                                                        </div>
                                                                        <div className="text-[10px] uppercase font-bold text-emerald-400">Low</div>
                                                                    </div>
                                                                </div>
                                                            </CardContent>
                                                        </Card>
                                                    ) : (
                                                        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-dashed">
                                                            <BarChart2 className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                                                            <p className="text-sm font-medium">No data for analysis</p>
                                                            <p className="text-xs text-gray-400 mt-1">Wait for content to be gathered</p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="no-print">
                        {/* Profile Image Management Dialog */}
                        <ManageProfileImageDialog
                            open={manageImageOpen}
                            onClose={() => setManageImageOpen(false)}
                            poiData={poiData}
                            onUpdate={handleProfileImageUpdate}
                        />
                    </div>
                </div>
            </div>

            {/* Hidden Printed Report - Silent container that doesn't disrupt screen layout */}
            <div
                ref={reportRef}
                className="hidden-report-container report-document"
                style={{
                    position: 'absolute',
                    left: '-10000px',
                    top: '-10000px',
                    zIndex: -9999
                }}
            >
                {renderReportDocument(false, predictiveQrUrl)}
            </div>

            {/* Component Specific Print Styles */}
            <style dangerouslySetInnerHTML={{
                __html: `
                @media print {
                    @page {
                        margin: 0 !important; /* Kills browser headers/footers */
                        size: A4 portrait;
                    }

                    /* ENSURE ANCESTORS ARE VISIBLE */
                    /* We must walk down from html/body and ensure #root and its Layout wrappers are visible */
                    html, body, #root, #root > div, .poi-detail-root-container {
                        display: block !important;
                        visibility: visible !important;
                        opacity: 1 !important;
                        height: auto !important;
                        min-height: 0 !important;
                        overflow: visible !important;
                        position: static !important;
                        background: white !important;
                    }

                    /* HIDE EVERYTHING EXCEPT THE REPORT */
                    /* Hide main UI elements within POIDetail */
                    .poi-detail-root-container > div:not(.hidden-report-container),
                    .no-print, nav, header, aside, footer { 
                        display: none !important; 
                        height: 0 !important;
                        overflow: hidden !important;
                    }

                    /* TARGET THE REPORT CONTAINER */
                    .hidden-report-container.report-document {
                        display: block !important;
                        visibility: visible !important;
                        opacity: 1 !important;
                        position: relative !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 100% !important;
                        height: auto !important;
                        overflow: visible !important;
                        z-index: 999999 !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        background: white !important;
                    }

                    /* Fix for QR code and images */
                    img, canvas {
                        max-width: 100% !important;
                    }
                }
            `}} />
            {/* Global Search Expansion for previouslyDeletedProfiles */}
            {/* Added Confirmation Dialogs */}
            <Dialog open={showDiscardConfirm} onOpenChange={(open) => !open && handleDiscardCancel()}>
                <DialogContent className="sm:max-w-md bg-white border-none shadow-2xl rounded-xl p-6 text-slate-900">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-amber-600">
                            <AlertTriangle className="h-5 w-5" />
                            Discard Changes?
                        </DialogTitle>
                        <DialogDescription className="text-slate-500 pt-2 text-[14px]">
                            You have unsaved changes in this profile. Are you sure you want to discard them? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center justify-end gap-3 mt-6">
                        <Button
                            variant="ghost"
                            onClick={handleDiscardCancel}
                            className="text-slate-600 hover:bg-slate-100 h-9 px-4"
                        >
                            Keep Editing
                        </Button>
                        <Button
                            onClick={confirmDiscard}
                            className="bg-amber-600 hover:bg-amber-700 text-white border-none h-9 px-4"
                        >
                            Discard Changes
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div >
    );
};

export default POIDetail;
