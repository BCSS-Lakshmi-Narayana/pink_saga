import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { extractLocationsBatch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import {
    Search, FileText, CheckCircle2, Calendar, Clock, ArrowLeft,
    AlertCircle, X, RefreshCw, Plus, Trash2, Loader2, Download,
    Building2, Users, BadgeCheck, CalendarDays, Filter, ChevronDown, ExternalLink, Tag, Rss,
    LayoutGrid, LayoutList, ImageOff, Video as VideoIcon
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Separator } from '../components/ui/separator';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter
} from '../components/ui/dialog';
import { ScrollArea } from '../components/ui/scroll-area';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../components/ui/select';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar as CalendarComponent } from '../components/ui/calendar';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import {
    format, startOfDay, endOfDay, subDays, subMonths,
    startOfMonth, endOfMonth, isSameDay, isSameMonth, isSameYear,
    differenceInCalendarDays,
} from 'date-fns';
import { VideoPlayer, normalizeMediaList } from '../components/AlertCards';
import { GrievanceCard } from '../components/grievances/GrievanceCard';
import { GrievanceTopNavbar } from '../components/grievances/GrievanceTopNavbar';
import { CriticismPopup } from '../components/grievances/CriticismPopup';
import { CriticismReports } from '../components/grievances/CriticismReports';
import { GrievancePopup } from '../components/grievances/GrievancePopup';
import { GrievanceWorkflowReports } from '../components/grievances/GrievanceWorkflowReports';
import { GrievanceStatusChangePopup } from '../components/grievances/GrievanceStatusChangePopup';
import { QueryPopup } from '../components/grievances/QueryPopup';
import { QueryReports } from '../components/grievances/QueryReports';
import { SuggestionPopup } from '../components/grievances/SuggestionPopup';
import { SuggestionReports } from '../components/grievances/SuggestionReports';
import GrievanceAnalysisModal from '../components/grievances/GrievanceAnalysisModal';
import { RssNewsCard } from '../components/grievances/RssNewsCard';
import { YouTubeLiveTab } from '../components/grievances/YouTubeLiveTab';
import { useRbac } from '../contexts/RbacContext';
import { canManageRestrictedGrievanceUi } from '../lib/grievanceUiPermissions';
//added

const EMPTY_SENTIMENT_LEADERS = {
    positive: [],
    negative: [],
    neutral: []
};

/* ─── Fullscreen Image with fallback chain ─── */
const FullscreenImage = ({ url, fallbackUrl, allUrls = [] }) => {
    const candidates = React.useMemo(() => {
        const seen = new Set();
        const out = [];
        for (const u of [url, fallbackUrl, ...allUrls]) {
            if (!u || seen.has(u)) continue;
            seen.add(u);
            out.push(u);
        }
        return out;
    }, [url, fallbackUrl, allUrls]);

    const [idx, setIdx] = React.useState(0);

    if (!candidates.length || idx >= candidates.length) {
        return (
            <div className="flex flex-col items-center justify-center text-white/50 select-none">
                <ImageOff className="h-16 w-16 mb-3" />
                <span className="text-sm font-medium uppercase tracking-wider">Image unavailable</span>
            </div>
        );
    }

    return (
        <img
            src={candidates[idx]}
            alt="Media"
            className="max-w-full max-h-full object-contain"
            referrerPolicy="no-referrer"
            onError={() => setIdx((i) => i + 1)}
        />
    );
};
/* ─── Fullscreen Video Player with full fallback chain ─── */
const RobustVideoPlayer = ({ selectedMedia, selectedGrievance, getProxiedMediaUrl, videoRefreshUrl, setVideoRefreshUrl, videoRefreshing, setVideoRefreshing, BACKEND_URL }) => {
    const candidates = React.useMemo(() => {
        const raw = [
            videoRefreshUrl,
            selectedGrievance?.content?.archived_video_url,
            selectedMedia?.video_url,
            selectedMedia?.s3_url,
            selectedMedia?.url,
            selectedMedia?.original_url,
            selectedMedia?.original_video_url
        ].filter(u => typeof u === 'string' && u.length > 0);
        const proxied = raw.map(u => getProxiedMediaUrl(u)).filter(Boolean);
        const seen = new Set();
        return [...raw, ...proxied].filter(u => { if (!u || seen.has(u)) return false; seen.add(u); return true; });
    }, [selectedMedia, selectedGrievance, getProxiedMediaUrl, videoRefreshUrl]);

    const [urlIdx, setUrlIdx] = React.useState(0);
    const [triedRefresh, setTriedRefresh] = React.useState(false);

    const currentUrl = candidates[urlIdx];

    const handleError = React.useCallback(async () => {
        // Try next URL in the chain
        if (urlIdx + 1 < candidates.length) {
            setUrlIdx(i => i + 1);
            return;
        }
        // Last resort: try Twitter API refresh
        if (!triedRefresh && !videoRefreshing) {
            const tweetId = selectedMedia?.tweet_id;
            if (tweetId && /^\d{5,25}$/.test(tweetId)) {
                setVideoRefreshing(true);
                setTriedRefresh(true);
                try {
                    const resp = await fetch(`${BACKEND_URL}/api/media/twitter-video?tweetId=${tweetId}`);
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data.url) {
                            setVideoRefreshUrl(getProxiedMediaUrl(data.url));
                            return;
                        }
                    }
                } catch (_) {}
                setVideoRefreshing(false);
            }
        }
        toast.error('Failed to load video.');
    }, [urlIdx, candidates, triedRefresh, videoRefreshing, selectedMedia, BACKEND_URL, getProxiedMediaUrl, setVideoRefreshUrl, setVideoRefreshing]);

    if (!currentUrl) {
        return (
            <div className="flex flex-col items-center justify-center text-white/50 select-none">
                <VideoIcon className="h-16 w-16 mb-3" />
                <span className="text-sm font-medium uppercase tracking-wider">Video unavailable</span>
            </div>
        );
    }

    return (
        <VideoPlayer
            url={currentUrl}
            preview={getProxiedMediaUrl(selectedMedia?.preview_url)}
            type={selectedMedia?.type}
            autoPlay={selectedMedia?.type === 'animated_gif'}
            onError={handleError}
        />
    );
};

/**
 * Date-range filtering
 * ─────────────────────────────────────────────────────────────────────
 * A calendar day is a LOCAL concept — the user picking "6 Aug" means 6 Aug
 * where they are — while `post_date` is stored as a UTC instant. The browser
 * is the only party that knows the user's timezone, so it is the browser that
 * resolves the picked day into an absolute instant range; the API then honours
 * those instants verbatim (see toIsoStart/toIsoEnd in grievanceController).
 *
 * Two rules follow, and breaking either is what made this filter unusable:
 *
 *   · A calendar day NEVER round-trips through toISOString(). Local midnight
 *     on 6 Aug in IST is 5 Aug 18:30 UTC, so `toISOString().split('T')[0]`
 *     wrote "2026-08-05" into the URL for every timezone east of UTC.
 *   · A single-day selection is a CLOSED range. It used to send `from` with no
 *     `to`, which the API reads as an open-ended `$gte` — "6 Aug onwards" —
 *     so picking one day returned the newest posts in the collection.
 */
const DATE_ONLY_RX = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' as a LOCAL calendar day. `new Date(str)` would read it as UTC
 *  midnight, which renders as the previous day anywhere east of UTC. */
const parseDateParam = (dateStr) => {
    if (!dateStr) return null;
    const raw = String(dateStr).trim();
    if (DATE_ONLY_RX.test(raw)) {
        const [y, m, d] = raw.split('-').map(Number);
        const local = new Date(y, m - 1, d);
        return isNaN(local.getTime()) ? null : local;
    }
    // Full ISO timestamps still parse, so existing deep links keep working.
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
};

/** The URL carries the calendar day the user clicked, in local terms. */
const toDateParam = (date) => (date ? format(date, 'yyyy-MM-dd') : null);

/**
 * The six windows people actually ask for. Reaching "last 7 days" by paging a
 * calendar and clicking two cells is the slowest possible route to the most
 * common question.
 *
 * Each is a function rather than a value because "today" has to mean today at
 * click time, not at module load — the page is left open for whole shifts.
 */
const DATE_PRESETS = [
    { id: 'today', label: 'Today', range: () => { const t = new Date(); return { from: t, to: t }; } },
    { id: 'yesterday', label: 'Yesterday', range: () => { const y = subDays(new Date(), 1); return { from: y, to: y }; } },
    { id: 'last7', label: 'Last 7 days', range: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
    { id: 'last30', label: 'Last 30 days', range: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
    { id: 'thisMonth', label: 'This month', range: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
    { id: 'lastMonth', label: 'Last month', range: () => { const m = subMonths(new Date(), 1); return { from: startOfMonth(m), to: endOfMonth(m) }; } },
];

const sameDayOrBothNull = (a, b) => (!a && !b) || (!!a && !!b && isSameDay(a, b));

/** Which preset, if any, the current selection corresponds to. */
const matchDatePreset = ({ from, to }) => {
    if (!from && !to) return null;
    const hit = DATE_PRESETS.find((p) => {
        const r = p.range();
        return sameDayOrBothNull(from, r.from) && sameDayOrBothNull(to || from, r.to);
    });
    return hit ? hit.id : null;
};

/**
 * The trigger label has to separate "on 6 Aug" from "since 6 Aug" — the two
 * readings the old open-ended query conflated, and the reason a one-day filter
 * looked like it was returning today's posts. A single day therefore renders as
 * one date and a range always shows both ends.
 */
const formatDateRangeLabel = ({ from, to }) => {
    if (!from && !to) return null;
    if (!from) return `Until ${format(to, 'd MMM yyyy')}`;
    if (!to || isSameDay(from, to)) return format(from, 'd MMM yyyy');
    if (!isSameYear(from, to)) return `${format(from, 'd MMM yyyy')} – ${format(to, 'd MMM yyyy')}`;
    return isSameMonth(from, to)
        ? `${format(from, 'd')} – ${format(to, 'd MMM yyyy')}`
        : `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')}`;
};

/** Plain-language restatement of what the query will match, shown in the
 *  popover footer so the selection is unambiguous before it is applied. */
const describeDateSelection = ({ from, to }) => {
    if (!from && !to) return 'No date filter — showing all mentions';
    if (!from) return `Everything posted up to ${format(to, 'd MMM yyyy')}`;
    if (!to || isSameDay(from, to)) return `${format(from, 'EEEE, d MMM yyyy')} only`;
    const days = differenceInCalendarDays(to, from) + 1;
    return `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')} · ${days} days`;
};

/**
 * Every URL param that narrows the feed, grouped by the control that owns it.
 *
 * These exist because every "clear" affordance carried its own hand-written
 * subset and they had drifted apart — the topic chip cleared `grievance_type`
 * but not the legacy `topic` alias that the sync effect also reads, so the chip
 * came back the moment anything else changed. Anything that clears a filter now
 * reads these lists rather than restating them.
 *
 * `location` is the param this page reads and writes; the other three are
 * accepted spellings a map deep-link may arrive with, cleared alongside it so a
 * stale one cannot survive a "Clear all". (Note `location_city` is the API's
 * parameter name, not a URL one — see fetchGrievances.)
 */
const LOCATION_PARAMS = ['location', 'location_city', 'location_district', 'location_constituency'];
const TOPIC_PARAMS = ['grievance_type', 'topic'];   // `topic` is the legacy alias
const HANDLE_PARAMS = ['handle', 'posted_by'];
const FILTER_PARAMS = [
    'search', 'platform', 'sentiment', 'stance', 'analysis_category', 'target_entity', 'leader', 'from', 'to',
    ...TOPIC_PARAMS, ...HANDLE_PARAMS, ...LOCATION_PARAMS,
];

/** `['a','b']` → `{ a: null, b: null }`, the shape updateURLParams deletes. */
const clearParams = (keys) => Object.fromEntries(keys.map((k) => [k, null]));

/**
 * The languages a tracking keyword can carry. This list MUST match the enum on
 * models/Keyword.js — ['en', 'te', 'ur', 'hi', 'all'] — because the "add" selector
 * writes straight into it and the server rejects anything else. Declared once
 * so the add selector and the list filter cannot drift apart.
 *
 * Ordered for this deployment: the languages actually used first. A row stored
 * with some other code still gets an option (see keywordLangOptions), so it
 * stays reachable rather than being filtered into invisibility.
 */
const KEYWORD_LANGUAGES = [
    { value: 'en', label: 'EN', name: 'English' },
    { value: 'hi', label: 'HI', name: 'Hindi' },
    { value: 'te', label: 'TE', name: 'Telugu' },
    { value: 'ur', label: 'UR', name: 'Urdu' },
    { value: 'all', label: 'All', name: 'Any language' },
];

const keywordLanguageName = (code) => (
    KEYWORD_LANGUAGES.find((l) => l.value === String(code || 'en').toLowerCase())?.name
    || String(code || '').toUpperCase()
);

/* ═══════════════════════════════════════════════════════════════ */
/*                       MAIN COMPONENT                          */
/* ═══════════════════════════════════════════════════════════════ */
const Grievances = () => {
    const { hasFeatureAccess } = useRbac();
    const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

    // Get logged-in user from AuthContext (full_name is the canonical field)
    const { user: authUser } = useAuth();
    const userName = authUser?.full_name || authUser?.name || authUser?.email?.split('@')[0] || 'Operator';
    const canManageSpecialGrievanceUi = canManageRestrictedGrievanceUi(authUser);
    const [downloadStates, setDownloadStates] = useState({});

    const updateDownloadState = useCallback((id, updates) => {
        if (!id) return;
        setDownloadStates((prev) => ({
            ...prev,
            [id]: {
                ...(prev[id] || {}),
                ...updates
            }
        }));
    }, []);

    const getProxiedMediaUrl = useCallback((rawUrl) => {
        if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
        if (rawUrl.startsWith('/api/media/stream') || rawUrl.startsWith('/api/media/proxy')) return `${BACKEND_URL}${rawUrl}`;
        if (rawUrl.startsWith('/') || rawUrl.startsWith(BACKEND_URL)) return rawUrl;
        const needsProxy = (
            rawUrl.includes('twimg.com') ||
            rawUrl.includes('fbcdn.net') ||
            rawUrl.includes('cdninstagram.com') ||
            rawUrl.includes('fbsbx.com') ||
            rawUrl.includes('googleusercontent.com')
        );
        if (needsProxy) {
            return `${BACKEND_URL}/api/media/stream?url=${encodeURIComponent(rawUrl)}`;
        }
        return rawUrl;
    }, [BACKEND_URL]);

    const triggerBlobDownload = useCallback(async (url, filename) => {
        try {
            const absoluteUrl = typeof url === 'string' && url.startsWith('/') ? `${BACKEND_URL}${url}` : url;
            const response = await fetch(absoluteUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            if (contentType.includes('text/html')) {
                throw new Error('Invalid file response (HTML)');
            }
            const blob = await response.blob();
            const hasExtension = /\.[a-z0-9]{2,5}$/i.test(filename || '');
            let finalFilename = filename || 'media';
            if (!hasExtension) {
                if (contentType.includes('video/mp4')) finalFilename = `${finalFilename}.mp4`;
                else if (contentType.includes('video/')) finalFilename = `${finalFilename}.mp4`;
                else if (contentType.includes('image/png')) finalFilename = `${finalFilename}.png`;
                else if (contentType.includes('image/webp')) finalFilename = `${finalFilename}.webp`;
                else if (contentType.includes('image/gif')) finalFilename = `${finalFilename}.gif`;
                else finalFilename = `${finalFilename}.jpg`;
            }
            const blobUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = finalFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
            return true;
        } catch (error) {
            return false;
        }
    }, [BACKEND_URL]);

    const downloadMediaForGrievance = async (grievance) => {
        const grievanceId = grievance?.id;
        const context = grievance?.context || {};

        const collectedMedia = [
            ...normalizeMediaList(grievance?.content?.media),
            ...normalizeMediaList(context?.content?.media),
            ...normalizeMediaList(context?.quoted?.content?.media),
            ...normalizeMediaList(context?.in_reply_to?.content?.media),
            ...normalizeMediaList(context?.reposted_from?.content?.media),
            ...normalizeMediaList(context?.parent?.content?.media),
            ...normalizeMediaList(context?.thread_parent?.content?.media)
        ];

        const mediaItems = Array.from(new Map(
            collectedMedia
                .map((item) => ({
                    type: item?.type || 'photo',
                    url: item?.url || item?.preview
                }))
                .filter((item) => !!item.url)
                .map((item) => [item.url, item])
        ).values());

        const fallbackMediaUrl = [
            grievance?.tweet_url,
            grievance?.url,
            context?.tweet_url,
            context?.url,
            context?.quoted?.tweet_url,
            context?.quoted?.url,
            context?.in_reply_to?.tweet_url,
            context?.in_reply_to?.url,
            context?.reposted_from?.tweet_url,
            context?.reposted_from?.url,
            context?.parent?.tweet_url,
            context?.parent?.url,
            context?.thread_parent?.tweet_url,
            context?.thread_parent?.url,
            mediaItems[0]?.url
        ].find(Boolean);

        if (!mediaItems.length && !fallbackMediaUrl) {
            updateDownloadState(grievanceId, { error: 'No media available to download' });
            setTimeout(() => updateDownloadState(grievanceId, { error: null }), 3000);
            toast.error('No media available to download');
            return;
        }

        const isVideoLike = (item) => {
            const type = String(item?.type || '').toLowerCase();
            const url = String(item?.url || '').toLowerCase();
            return type === 'video' || type === 'animated_gif' || url.includes('video.twimg.com') || /\.(mp4|webm|mov|mkv|avi|m3u8)(\?|$)/i.test(url);
        };

        const videoItems = mediaItems.filter(isVideoLike);
        const imageItems = mediaItems.filter((item) => !isVideoLike(item));

        updateDownloadState(grievanceId, {
            downloading: true,
            progress: 5,
            status: 'Video is downloading...',
            error: null
        });

        let progress = 5;
        const progressInterval = setInterval(() => {
            progress = Math.min(progress + Math.random() * 12, 90);
            updateDownloadState(grievanceId, {
                progress,
                status: progress < 45 ? 'Fetching media info...' : progress < 75 ? 'Downloading video...' : 'Finalizing download...'
            });
        }, 450);

        try {
            const filesToDownload = [];

            if (videoItems.length > 0) {
                const uniqueVideoUrls = [...new Set(videoItems.map((v) => v.url).filter(Boolean))];
                updateDownloadState(grievanceId, { progress: 20, status: `Preparing ${uniqueVideoUrls.length} video download(s)...` });

                for (let vi = 0; vi < uniqueVideoUrls.length; vi += 1) {
                    const videoUrl = uniqueVideoUrls[vi];
                    const baseProgress = 20 + Math.round(((vi + 1) / uniqueVideoUrls.length) * 20);
                    updateDownloadState(grievanceId, { progress: baseProgress, status: `Fetching video ${vi + 1}/${uniqueVideoUrls.length}...` });

                    const videoResponse = await api.post('/media/download-video', {
                        media_url: videoUrl || fallbackMediaUrl,
                        content_id: grievance?.content_id || grievance?.id
                    });

                    const vData = videoResponse.data || {};
                    if (Array.isArray(vData.items) && vData.items.length > 0) {
                        filesToDownload.push(...vData.items.map((item, idx) => ({
                            url: item?.download_url,
                            filename: item?.filename || `video_${vi + 1}_${idx + 1}.mp4`
                        })));
                    } else if (vData.download_url) {
                        filesToDownload.push({
                            url: vData.download_url,
                            filename: vData.filename || `video_${vi + 1}.mp4`
                        });
                    }
                }
            }

            if (imageItems.length > 0) {
                updateDownloadState(grievanceId, { progress: 45, status: 'Preparing image download...' });
                const imageUrls = imageItems.map((m) => m.url).filter(Boolean);
                const imageResponse = await api.post('/media/download-images', {
                    image_urls: imageUrls,
                    content_id: grievance?.content_id || grievance?.id
                });
                const iData = imageResponse.data || {};
                if (Array.isArray(iData.items) && iData.items.length > 0) {
                    filesToDownload.push(...iData.items.map((item, idx) => ({
                        url: item?.download_url,
                        filename: item?.filename || `image_${idx + 1}.jpg`
                    })));
                }
            }

            if (!filesToDownload.length) {
                clearInterval(progressInterval);
                updateDownloadState(grievanceId, {
                    downloading: false,
                    progress: 0,
                    status: '',
                    error: 'No download URL returned from server'
                });
                setTimeout(() => updateDownloadState(grievanceId, { error: null }), 3000);
                toast.error('No download URL returned from server');
                return;
            }

            clearInterval(progressInterval);
            updateDownloadState(grievanceId, { progress: 92, status: 'Saving files...' });

            let successCount = 0;
            for (let i = 0; i < filesToDownload.length; i += 1) {
                const item = filesToDownload[i];
                const ok = await triggerBlobDownload(item.url, item.filename);
                if (ok) successCount += 1;

                const pct = 92 + Math.round(((i + 1) / filesToDownload.length) * 8);
                updateDownloadState(grievanceId, { progress: Math.min(100, pct), status: 'Download started' });
                if (i < filesToDownload.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 300));
                }
            }

            if (successCount === 0) {
                throw new Error('All downloads failed');
            }

            setTimeout(() => {
                updateDownloadState(grievanceId, {
                    downloading: false,
                    progress: 0,
                    status: ''
                });
            }, 900);

            toast.success(`Downloaded ${successCount} file${successCount !== 1 ? 's' : ''}`);
        } catch (error) {
            clearInterval(progressInterval);
            updateDownloadState(grievanceId, {
                downloading: false,
                progress: 0,
                status: '',
                error: error?.response?.data?.error || 'Failed to download media'
            });
            setTimeout(() => updateDownloadState(grievanceId, { error: null }), 3000);
            toast.error(error?.response?.data?.error || 'Failed to download media');
        }
    };

    /* ─── State ─── */
    const [searchParams, setSearchParams] = useSearchParams();
    const [grievances, setGrievances] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [activeTab, setActiveTab] = useState('all');
    const [stats, setStats] = useState({ total: 0, pending: 0, escalated: 0, closed: 0, converted_to_fir: 0 });
    const [workflowStats, setWorkflowStats] = useState({ total: 0, pending: 0, escalated: 0, closed: 0, fir: 0 });
    const [activeReportSubTab, setActiveReportSubTab] = useState('grievance'); // grievance, suggestion, criticism
    const [pagination, setPagination] = useState({ hasMore: false, nextCursor: null, total: 0 });
    const fetchAbortRef = useRef(null); // AbortController for cancelling stale requests
    const locationEnrichmentInFlightRef = useRef(new Set());
    const locationEnrichmentCacheRef = useRef(new Map());

    // Sources
    const [sources, setSources] = useState([]);
    const [sourcesLoading, setSourcesLoading] = useState(false);
    const [showAddSource, setShowAddSource] = useState(false);
    const [addSourcePlatform, setAddSourcePlatform] = useState('x');
    const [addSourceHandle, setAddSourceHandle] = useState('');
    const [addSourceDept, setAddSourceDept] = useState('');
    const [addingSource, setAddingSource] = useState(false);
    const [fetchingSource, setFetchingSource] = useState(null);
    const [showSourcePanel, setShowSourcePanel] = useState(true);

    // Fetch date range for source
    const [fetchDateDialog, setFetchDateDialog] = useState(null);
    const [fetchDateRange, setFetchDateRange] = useState({ from: null, to: null });

    // Dialogs
    const [isStatusOpen, setIsStatusOpen] = useState(false);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
    const [isMediaOpen, setIsMediaOpen] = useState(false);
    const [isFirConfirmOpen, setIsFirConfirmOpen] = useState(false);
    const [deleteConfirmSource, setDeleteConfirmSource] = useState(null);
    const [sentimentLeadersOpen, setSentimentLeadersOpen] = useState(false);
    const [sentimentLeadersLoading, setSentimentLeadersLoading] = useState(false);
    const [sentimentLeadersTab, setSentimentLeadersTab] = useState('positive');
    const [sentimentLeadersPlatform, setSentimentLeadersPlatform] = useState('all');
    const [sentimentLeadersSearch, setSentimentLeadersSearch] = useState('');
    const [sentimentLeaders, setSentimentLeaders] = useState(EMPTY_SENTIMENT_LEADERS);

    // ─── View mode (grid / list) — persisted across sessions ──────
    const [viewMode, setViewMode] = useState(() => {
        try { return localStorage.getItem('mentions:viewMode') || 'grid'; } catch (_) { return 'grid'; }
    });
    useEffect(() => {
        try { localStorage.setItem('mentions:viewMode', viewMode); } catch (_) {}
    }, [viewMode]);

    // ─── Add Tweet by URL/ID ──────────────────────────────────────
    const [addTweetOpen, setAddTweetOpen] = useState(false);
    const [addTweetInput, setAddTweetInput] = useState('');
    const [addTweetLoading, setAddTweetLoading] = useState(false);

    // ─── Tracked keywords (auto-fetcher) ──────────────────────
    const [keywordsOpen, setKeywordsOpen] = useState(false);
    const [trackedKeywords, setTrackedKeywords] = useState([]);
    const [trackedKeywordsLoading, setTrackedKeywordsLoading] = useState(false);
    const [newKeywordInput, setNewKeywordInput] = useState('');
    const [newKeywordCategory, setNewKeywordCategory] = useState('other');
    const [newKeywordLang, setNewKeywordLang] = useState('en');
    // Filtering the list is a separate concern from choosing the language of the
    // keyword being added, so it gets its own control rather than overloading
    // the one beside the Add button.
    const [keywordLangFilter, setKeywordLangFilter] = useState('');
    const [keywordSaving, setKeywordSaving] = useState(false);
    const [triggerFetchLoading, setTriggerFetchLoading] = useState(false);

    const fetchTrackedKeywords = useCallback(async () => {
        setTrackedKeywordsLoading(true);
        try {
            const res = await api.get('/keywords');
            const list = Array.isArray(res.data) ? res.data : res.data?.keywords || [];
            // Show high-weight (leader / mention-style) keywords first
            list.sort((a, b) => (b.weight || 0) - (a.weight || 0));
            setTrackedKeywords(list);
        } catch (err) {
            toast.error('Failed to load keywords');
        } finally {
            setTrackedKeywordsLoading(false);
        }
    }, []);

    const handleAddKeyword = useCallback(async () => {
        const kw = newKeywordInput.trim();
        if (!kw) return;
        setKeywordSaving(true);
        try {
            await api.post('/keywords', {
                keyword: kw,
                category: newKeywordCategory,
                language: newKeywordLang,
                weight: 75,
                is_active: true,
            });
            toast.success(`Added "${kw}" — next auto-fetch will pick it up`);
            setNewKeywordInput('');
            await fetchTrackedKeywords();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to add keyword');
        } finally {
            setKeywordSaving(false);
        }
    }, [newKeywordInput, newKeywordCategory, newKeywordLang, fetchTrackedKeywords]);

    const handleDeleteKeyword = useCallback(async (id) => {
        if (!id) return;
        try {
            await api.delete(`/keywords/${id}`);
            toast.success('Keyword removed');
            await fetchTrackedKeywords();
        } catch (err) {
            toast.error('Failed to delete keyword');
        }
    }, [fetchTrackedKeywords]);

    /**
     * How many keywords sit in each language, and therefore which languages the
     * filter offers. Derived from the rows themselves rather than a fixed list,
     * so a language present in the data can never be missing from the control
     * that filters it.
     */
    const keywordLangCounts = useMemo(() => {
        const counts = new Map();
        for (const k of trackedKeywords) {
            const code = String(k.language || 'en').toLowerCase();
            counts.set(code, (counts.get(code) || 0) + 1);
        }
        return counts;
    }, [trackedKeywords]);

    const keywordLangOptions = useMemo(() => {
        const known = KEYWORD_LANGUAGES.filter((l) => keywordLangCounts.has(l.value));
        // Anything stored outside the model's enum still gets an entry, so those
        // rows stay reachable instead of being filtered into invisibility.
        const extra = [...keywordLangCounts.keys()]
            .filter((code) => !KEYWORD_LANGUAGES.some((l) => l.value === code))
            .sort()
            .map((code) => ({ value: code, label: code.toUpperCase(), name: code.toUpperCase() }));
        return [...known, ...extra];
    }, [keywordLangCounts]);

    const visibleKeywords = useMemo(() => {
        // The "no filter" sentinel is '', NOT 'all' — 'all' is itself a stored
        // language meaning "matches in any language", so it has to stay
        // selectable as a real filter value rather than being swallowed by the
        // reset option.
        if (!keywordLangFilter) return trackedKeywords;
        return trackedKeywords.filter(
            (k) => String(k.language || 'en').toLowerCase() === keywordLangFilter
        );
    }, [trackedKeywords, keywordLangFilter]);

    // Ref so handlers below can call fetchGrievances even though it's
    // declared further down in this component (TDZ-safe).
    const fetchGrievancesRef = useRef(null);

    const handleImportTweet = useCallback(async () => {
        const raw = addTweetInput.trim();
        if (!raw) return;
        setAddTweetLoading(true);
        try {
            const res = await api.post('/grievances/import-tweet', { url_or_id: raw });
            if (res.data?.imported) {
                toast.success('Tweet imported and analysed');
                setAddTweetInput('');
                setAddTweetOpen(false);
                fetchGrievancesRef.current && fetchGrievancesRef.current();
            } else {
                toast.info(res.data?.message || 'Tweet already in feed');
            }
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Import failed');
        } finally {
            setAddTweetLoading(false);
        }
    }, [addTweetInput]);

    const handleTriggerFetch = useCallback(async () => {
        setTriggerFetchLoading(true);
        try {
            await api.post('/grievances/fetch-keywords');
            toast.success('Keyword fetch triggered — new mentions arriving');
        } catch (err) {
            toast.error('Failed to trigger fetch');
        } finally {
            setTriggerFetchLoading(false);
        }
    }, []);

    // Criticism popup
    const [criticismGrievance, setCriticismGrievance] = useState(null);
    const [grievancePopupGrievance, setGrievancePopupGrievance] = useState(null);
    const [statusChangePopup, setStatusChangePopup] = useState(null); // { grievance, targetStatus }
    const [queryPopupGrievance, setQueryPopupGrievance] = useState(null);
    const [suggestionPopupGrievance, setSuggestionPopupGrievance] = useState(null);

    // Selected grievance
    const [selectedGrievance, setSelectedGrievance] = useState(null);
    const [selectedMedia, setSelectedMedia] = useState(null);
    const [videoRefreshUrl, setVideoRefreshUrl] = useState(null);
    const [videoRefreshing, setVideoRefreshing] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [statusUpdateNote, setStatusUpdateNote] = useState('');
    const [firNote, setFirNote] = useState('');
    const [firNumber, setFirNumber] = useState('');
    const [updatingStatus, setUpdatingStatus] = useState(false);

    // Filters //
    const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
    const [platformFilter, setPlatformFilter] = useState(() => searchParams.get('platform') || 'all');
    const [dateRange, setDateRange] = useState(() => {
        const fromStr = searchParams.get('from');
        const toStr = searchParams.get('to');
        return {
            from: parseDateParam(fromStr),
            to: parseDateParam(toStr)
        };
    });
    const [datePickerOpen, setDatePickerOpen] = useState(false);
    const [locationFilter, setLocationFilter] = useState(() => searchParams.get('location') || null);

    // Top Navbar Filters //
    
    const [navbarPlatform, setNavbarPlatform] = useState(() => searchParams.get('platform') || 'all');
    const [navbarStatus, setNavbarStatus] = useState('total');

    // ── RSS News state ────────────────────────────────────────────
    const [rssArticles, setRssArticles] = useState([]);
    const [rssLoading, setRssLoading] = useState(false);
    const [rssLoadingMore, setRssLoadingMore] = useState(false);
    const [rssPagination, setRssPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
    const [rssSearch, setRssSearch] = useState('');
    const [rssDistrict, setRssDistrict] = useState('all');
    const [rssCategory, setRssCategory] = useState('all');
    const [rssSourceType, setRssSourceType] = useState('all');
    // Filtered server-side: the feed is paged 20 at a time, so filtering in the
    // browser would mean "the negative ones among the 20 you happen to have
    // scrolled to" rather than the negative ones in the corpus.
    const [rssSentiment, setRssSentiment] = useState('all');
    // One definition, so the empty-state copy and the Clear Filters button can
    // never disagree about whether a filter is active.
    const rssHasFilters = rssDistrict !== 'all' || rssCategory !== 'all'
        || rssSourceType !== 'all' || rssSentiment !== 'all' || !!rssSearch;
    // District + category options, derived from the actual scraped articles
    // (not a hard-coded list) so the filters only offer what the RSS data holds.
    const [rssFacets, setRssFacets] = useState({ districts: [], categories: [] });
    const rssSearchTimer = useRef(null);

    // ── RSS Keyword Management state ──────────────────────────────
    const [rssSubTab, setRssSubTab] = useState('articles'); // 'articles' or 'keywords'
    const [rssKeywords, setRssKeywords] = useState([]);
    const [rssKeywordsLoading, setRssKeywordsLoading] = useState(false);
    const [newRssKeyword, setNewRssKeyword] = useState('');
    const [newRssKeywordLang, setNewRssKeywordLang] = useState('en');
    const [rssKeywordError, setRssKeywordError] = useState('');
    const [rssKeywordSuccess, setRssKeywordSuccess] = useState('');
    const [isAddRssKeywordOpen, setIsAddRssKeywordOpen] = useState(false);
    // Languages are DB-managed too — the buckets keywords are grouped into.
    const [rssLanguages, setRssLanguages] = useState([]);
    const [isAddRssLanguageOpen, setIsAddRssLanguageOpen] = useState(false);
    const [newRssLanguageName, setNewRssLanguageName] = useState('');
    const [newRssLanguageCode, setNewRssLanguageCode] = useState('');
    const [rssLanguageError, setRssLanguageError] = useState('');

    const grievanceStatusFeatureMap = useMemo(() => ({
        total: 'all',
        pending: 'pending',
        escalated: 'pending',
        closed: 'closed',
        fir: 'fir',
        reports: 'reports',
    }), []);
    const navbarStatuses = useMemo(
        () => Object.keys(grievanceStatusFeatureMap),
        [grievanceStatusFeatureMap]
    );

    const canAccessGrievanceReports = hasFeatureAccess('/grievances', 'reports');

    useEffect(() => {
        if (navbarStatuses.length === 0) {
            setNavbarStatus('');
            return;
        }
        if (!navbarStatuses.includes(navbarStatus)) {
            setNavbarStatus(navbarStatuses[0]);
        }
    }, [navbarStatuses, navbarStatus]);
    const normalizeTopicFilterLabel = useCallback((topic) => {
        const raw = String(topic || '').trim();
        if (!raw) return null;
        const normalized = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized === 'govt praise' || normalized === 'government praise' || normalized === 'general praise' || normalized === 'general complaint') {
            return 'General Complaint';
        }
        if (normalized === 'law and order' || normalized === 'law & order' || normalized === 'law_order') return 'Law & Order';
        if (normalized === 'road and infrastructure' || normalized === 'road & infrastructure') return 'Road & Infrastructure';
        return raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }, []);

    const mapTopicFilterToApi = useCallback((topic) => {
        const normalizedTopic = normalizeTopicFilterLabel(topic);
        if (normalizedTopic === 'General Complaint') return 'Government Praise';
        return normalizedTopic;
    }, [normalizeTopicFilterLabel]);

    const [selectedHandle, setSelectedHandle] = useState(() => searchParams.get('posted_by') || searchParams.get('handle') || null);
    const [sentimentFilter, setSentimentFilter] = useState(() => searchParams.get('sentiment') || null);
    // Supportive / Opposing / Neutral — the stance badge (see lib/sentiment.js).
    const [stanceFilter, setStanceFilter] = useState(() => searchParams.get('stance') || null);
    const [topicFilter, setTopicFilter] = useState(() => normalizeTopicFilterLabel(searchParams.get('grievance_type') || searchParams.get('topic')));
    const [analysisCategoryFilter, setAnalysisCategoryFilter] = useState(() => searchParams.get('analysis_category') || null);
    const [targetEntityFilter, setTargetEntityFilter] = useState(() => searchParams.get('target_entity') || null);
    // ?leader=<constituency>: posts tagging / naming that seat's MLA or naming
    // the seat — the evidence behind the MLA's leaderboard count.
    const [leaderFilter, setLeaderFilter] = useState(() => searchParams.get('leader') || null);
    // Was a hardcoded list mixing real AI-classified categories (e.g. "Public
    // Complaint", "Political Criticism") with values that never actually
    // occur in analysis.grievance_type (a leftover, separate keyword-lexicon
    // taxonomy used elsewhere for a live-text scan, e.g. "Welfare"/"Roads") —
    // picking one of those always returned zero results. Fetched live from
    // the same distinct-values endpoint IntelligenceDashboard.jsx already
    // uses, so the dropdown only ever offers topics that exist in the data.
    const [grievanceTopics, setGrievanceTopics] = useState([]);
    // Two taxonomies are tagged on a mention: the SUBJECT it is about
    // (analysis.topic — Education, Water Supply, the campaign taxonomy the CM
    // brief groups by) and the INTENT behind it (analysis.grievance_type —
    // Public Complaint, Political Criticism). The dropdown used to offer only
    // intent, so a subject reported on elsewhere in the platform could not be
    // selected here. Kept in separate groups so the distinction is visible.
    const [topicGroups, setTopicGroups] = useState({ subjects: [], intents: [] });
    useEffect(() => {
        let cancelled = false;
        api.get('/grievances/topics')
            .then((res) => {
                if (cancelled) return;
                setGrievanceTopics(Array.isArray(res.data?.topics) ? res.data.topics : []);
                setTopicGroups({
                    subjects: Array.isArray(res.data?.subjects) ? res.data.subjects : [],
                    intents: Array.isArray(res.data?.intents) ? res.data.intents : [],
                });
            })
            .catch(() => {
                if (cancelled) return;
                setGrievanceTopics([]);
                setTopicGroups({ subjects: [], intents: [] });
            });
        return () => { cancelled = true; };
    }, []);
    const [openGReportCode, setOpenGReportCode] = useState('');
    const [openSReportCode, setOpenSReportCode] = useState('');
    const [openCReportCode, setOpenCReportCode] = useState('');
    const [actionedGrievanceIds, setActionedGrievanceIds] = useState([]);
    const deepLinkGrievanceRef = useRef(null);

    // Debounce search
    const searchTimerRef = useRef(null);
    const [debouncedSearch, setDebouncedSearch] = useState('');

    const splitPaneRef = useRef(null);

    // Excel sheet modal
    const [showExcelModal, setShowExcelModal] = useState(false);
    const [preFilledRow, setPreFilledRow] = useState(null); // For pre-filling from grievance
    const [excelRows, setExcelRows] = useState([
        {
            id: 1,
            uniqueNumber: 'UNQ-001',
            callerNumber: '',
            receivedBy: userName,
            mentionName: '',
            receivedTime: new Date().toISOString().slice(0, 16),
            contents: '',
            psJurisdiction: '',
            typeOfPost: '',
            subCategory: '',
            informedTo: '',
            actionTime: '',
            actionTaken: '',
            caseDetails: '',
            actionInformedTo: '',
            completionDate: '',
        }
    ]);

    // Draggable/resizable modal state
    const [modalPos, setModalPos] = useState({ x: 100, y: 50 });
    const [modalSize, setModalSize] = useState({ width: 1200, height: 600 });
    const [isDraggingModal, setIsDraggingModal] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [isResizingModal, setIsResizingModal] = useState(false);
    const modalRef = useRef(null);

    // Keep filter state in sync when URL query params change (e.g. map redirection).
    const updateURLParams = useCallback((updates) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            Object.entries(updates).forEach(([key, val]) => {
                if (val === null || val === undefined || val === '') {
                    next.delete(key);
                } else {
                    next.set(key, val);
                }
            });
            return next;
        }, { replace: true });
    }, [setSearchParams]);

    /**
     * The single place a date selection is committed. Everything that can change
     * the range — the calendar, the presets, both Clear affordances — goes
     * through here, so the URL stays the one source of truth for the window and
     * no caller can write a half-updated pair.
     */
    const applyDateRange = useCallback((from, to) => {
        updateURLParams({ from: toDateParam(from), to: toDateParam(to) });
    }, [updateURLParams]);

    const activeDatePreset = useMemo(() => matchDatePreset(dateRange), [dateRange]);

    /**
     * Drops every filter param in one write. `setSearchQuery('')` is here too
     * because the input holds its own uncommitted text — clearing only the URL
     * would leave the box reading like an applied filter until the next debounce.
     */
    const clearAllFilters = useCallback(() => {
        setSearchQuery('');
        updateURLParams(clearParams(FILTER_PARAMS));
    }, [updateURLParams]);

    // `searchQuery` is the raw input, kept local so typing stays responsive.
    // The settled value is written to the URL, which is where every filter now
    // lives — see the sync effect below.
    useEffect(() => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => {
            updateURLParams({ search: searchQuery || null });
        }, 400);
        return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
    }, [searchQuery, updateURLParams]);

    // Keep filter state in sync when URL query params change (e.g. map redirection).
    useEffect(() => {
        const urlSearch = searchParams.get('search') || '';
        const urlLocation = searchParams.get('location') || null;
        const urlSentiment = searchParams.get('sentiment') || null;
        const urlStance = searchParams.get('stance') || null;
        const urlHandle = searchParams.get('posted_by') || searchParams.get('handle') || null;
        const urlTopic = normalizeTopicFilterLabel(searchParams.get('grievance_type') || searchParams.get('topic'));
        const urlAnalysisCategory = searchParams.get('analysis_category') || null;
        const urlTargetEntity = searchParams.get('target_entity') || null;
        const urlLeader = searchParams.get('leader') || null;
        const urlPlatform = searchParams.get('platform') || 'all';
        const urlFrom = searchParams.get('from');
        const urlTo = searchParams.get('to');

        setSearchQuery(urlSearch);
        // The value the query actually uses. Derived from the URL rather than
        // set by the debounce, so it can never disagree with the address bar.
        setDebouncedSearch(urlSearch);
        setLocationFilter(urlLocation);
        setSentimentFilter(urlSentiment);
        setStanceFilter(urlStance);
        setSelectedHandle(urlHandle);
        setTopicFilter(urlTopic);
        setAnalysisCategoryFilter(urlAnalysisCategory);
        setTargetEntityFilter(urlTargetEntity);
        setLeaderFilter(urlLeader);
        setNavbarPlatform(urlPlatform);
        setPlatformFilter(urlPlatform);
        setDateRange({
            from: parseDateParam(urlFrom),
            to: parseDateParam(urlTo)
        });
    }, [searchParams, normalizeTopicFilterLabel]);

    useEffect(() => {
        const targetId = searchParams.get('id');
        if (!targetId || deepLinkGrievanceRef.current === targetId) return;
        deepLinkGrievanceRef.current = targetId;
        let cancelled = false;
        api.get(`/grievances/${targetId}`)
            .then((res) => {
                if (cancelled) return;
                setSelectedGrievance(res.data);
                setIsDetailOpen(true);
            })
            .catch(() => { });
        return () => { cancelled = true; };
    }, [searchParams]);

    // Modal dragging
    useEffect(() => {
        if (!isDraggingModal) return;

        const handleMouseMove = (e) => {
            setModalPos({
                x: e.clientX - dragOffset.x,
                y: e.clientY - dragOffset.y,
            });
        };

        const handleMouseUp = () => setIsDraggingModal(false);

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingModal, dragOffset]);

    // Modal resizing
    useEffect(() => {
        if (!isResizingModal) return;

        const handleMouseMove = (e) => {
            if (!modalRef.current) return;
            const rect = modalRef.current.getBoundingClientRect();
            const newWidth = Math.max(600, e.clientX - rect.left);
            const newHeight = Math.max(400, e.clientY - rect.top);
            setModalSize({ width: newWidth, height: newHeight });
        };

        const handleMouseUp = () => setIsResizingModal(false);

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizingModal]);

    /* ─── Location stats (aggregated from stored detected_location in DB) ─── */
    const [uniqueLocations, setUniqueLocations] = useState([]);

    const fetchLocationStats = async () => {
        try {
            const res = await api.get('/grievances/location-stats');
            const data = res.data;
            setUniqueLocations(
                (data.cities || []).map(c => ({ city: c.city, count: c.count, district: c.district, constituency: c.constituency }))
            );
        } catch (err) {
            console.warn('[Grievances] Location stats fetch failed:', err);
            setUniqueLocations([]);
        }
    };

    const hasUsableLocation = useCallback((location) => (
        !!(location && (
            location.city ||
            location.district ||
            location.constituency ||
            (location.location_found && Number.parseFloat(location.confidence) > 0.8)
        ))
    ), []);

    const normalizeDetectedLocation = useCallback((location) => ({
        location_found: Boolean(location?.location_found),
        city: location?.city || '',
        district: location?.district || '',
        constituency: location?.constituency || '',
        keyword_matched: location?.keyword_matched || '',
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        confidence: location?.confidence ?? null,
        source: location?.source || ''
    }), []);

    const applyCachedLocations = useCallback((rows = []) => (
        rows.map((grievance) => {
            if (hasUsableLocation(grievance.detected_location)) return grievance;
            const cachedLocation = locationEnrichmentCacheRef.current.get(grievance.id);
            if (!cachedLocation?.location_found) return grievance;
            return {
                ...grievance,
                detected_location: normalizeDetectedLocation(cachedLocation)
            };
        })
    ), [hasUsableLocation, normalizeDetectedLocation]);

    const enrichLocationsInBackground = useCallback(async (rows = []) => {
        const itemsForLocation = rows
            .filter((grievance) => (
                grievance?.id &&
                !hasUsableLocation(grievance.detected_location) &&
                !locationEnrichmentInFlightRef.current.has(grievance.id) &&
                (grievance.content?.full_text || grievance.content?.text)
            ))
            .map((grievance) => {
                const text = grievance.content?.full_text || grievance.content?.text || '';
                const hashtags = (text.match(/#\w+/g) || []).join(' ');

                return {
                    id: grievance.id,
                    text,
                    user_location: grievance.posted_by?.location || '',
                    user_bio: grievance.posted_by?.bio || grievance.posted_by?.description || '',
                    hashtags
                };
            });

        if (!itemsForLocation.length) return;

        itemsForLocation.forEach((item) => locationEnrichmentInFlightRef.current.add(item.id));

        try {
            const locationMap = await extractLocationsBatch(itemsForLocation);

            Object.entries(locationMap || {}).forEach(([id, location]) => {
                if (location?.location_found) {
                    locationEnrichmentCacheRef.current.set(id, location);
                }
            });

            setGrievances((prev) => prev.map((grievance) => {
                if (hasUsableLocation(grievance.detected_location)) return grievance;
                const location = locationMap?.[grievance.id];
                if (!location?.location_found) return grievance;
                return {
                    ...grievance,
                    detected_location: normalizeDetectedLocation(location)
                };
            }));

            setSelectedGrievance((prev) => {
                if (!prev || hasUsableLocation(prev.detected_location)) return prev;
                const location = locationMap?.[prev.id];
                if (!location?.location_found) return prev;
                return {
                    ...prev,
                    detected_location: normalizeDetectedLocation(location)
                };
            });
        } catch (e) {
            console.warn('[Grievances] Location extraction failed:', e);
        } finally {
            itemsForLocation.forEach((item) => locationEnrichmentInFlightRef.current.delete(item.id));
        }
    }, [hasUsableLocation, normalizeDetectedLocation]);

    /* ─── Data Fetching ─── */
    useEffect(() => { fetchSources(); fetchLocationStats(); }, []);
    // Keep the ref pointing at the current fetchGrievances so handlers
    // declared before its definition can still call it.
    useEffect(() => { fetchGrievancesRef.current = fetchGrievances; });
    useEffect(() => {
        if (!navbarStatus) return;
        fetchDashboardStats();
        fetchGrievances();
    }, [activeTab, platformFilter, dateRange, debouncedSearch, navbarPlatform, navbarStatus, selectedHandle, sentimentFilter, stanceFilter, topicFilter, analysisCategoryFilter, locationFilter, targetEntityFilter, leaderFilter]);

    // ── RSS fetch ─────────────────────────────────────────────────
    const fetchNewsArticles = useCallback(async (page = 1, append = false) => {
        if (page === 1) setRssLoading(true);
        else setRssLoadingMore(true);
        try {
            const res = await api.get('/news', {
                params: {
                    page,
                    limit: 20,
                    search:      rssSearch   || undefined,
                    district:    rssDistrict  !== 'all' ? rssDistrict  : undefined,
                    category:    rssCategory  !== 'all' ? rssCategory  : undefined,
                    source_type: rssSourceType !== 'all' ? rssSourceType : undefined,
                    sentiment:   rssSentiment  !== 'all' ? rssSentiment  : undefined,
                },
            });
            const { articles = [], pagination } = res.data;
            setRssArticles(prev => append ? [...prev, ...articles] : articles);
            setRssPagination(pagination || { page: 1, pages: 1, total: 0, limit: 20 });
        } catch (err) {
            console.error('[RSS] fetchNewsArticles error:', err);
        } finally {
            setRssLoading(false);
            setRssLoadingMore(false);
        }
    }, [rssSearch, rssDistrict, rssCategory, rssSourceType, rssSentiment]);

    useEffect(() => {
        if (navbarPlatform !== 'rss') return;
        setRssArticles([]);
        fetchNewsArticles(1, false);
    }, [navbarPlatform, rssSearch, rssDistrict, rssCategory, rssSourceType, rssSentiment, fetchNewsArticles]);

    // Admin-only: delete an article / edit its sentiment (mirrors the Mentions flow).
    const handleDeleteRssArticle = async (article) => {
        const id = article?._id;
        if (!id) return;
        try {
            await api.delete(`/news/${id}`);
            setRssArticles((prev) => prev.filter((a) => a._id !== id));
            toast.success('Article deleted');
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to delete article');
        }
    };

    const handleRssArticleSentiment = async (article, sentiment) => {
        const id = article?._id;
        if (!id) return;
        try {
            await api.patch(`/news/${id}/sentiment`, { sentiment });
            setRssArticles((prev) => prev.map((a) => (a._id === id ? { ...a, sentiment } : a)));
            toast.success('Sentiment updated');
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to update sentiment');
        }
    };

    // Load the distinct districts + categories that actually appear in the
    // scraped articles, to populate the filter dropdowns. Independent of the
    // active filters so the full option set is always available.
    const fetchRssFacets = useCallback(async () => {
        try {
            const res = await api.get('/news/stats');
            const districts = (res.data?.byDistrict || [])
                .map((d) => d._id)
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
            const categories = (res.data?.byCategory || [])
                .map((c) => c._id)
                .filter(Boolean);
            setRssFacets({ districts, categories });
        } catch (err) {
            console.error('[RSS] fetchRssFacets error:', err);
        }
    }, []);

    useEffect(() => {
        if (navbarPlatform === 'rss') fetchRssFacets();
    }, [navbarPlatform, fetchRssFacets]);

    // ── RSS Keywords Fetch/Add/Delete ─────────────────────────────
    const fetchRssKeywords = useCallback(async () => {
        setRssKeywordsLoading(true);
        setRssKeywordError('');
        try {
            const res = await api.get('/news/keywords');
            setRssKeywords(res.data || []);
        } catch (err) {
            console.error('[RSS] fetchRssKeywords error:', err);
            setRssKeywordError('Failed to fetch RSS keywords.');
        } finally {
            setRssKeywordsLoading(false);
        }
    }, []);

    const handleAddRssKeyword = async (e) => {
        e.preventDefault();
        const kw = newRssKeyword.trim();
        if (!kw) return;
        setRssKeywordError('');
        setRssKeywordSuccess('');
        try {
            // Backend accepts a comma-separated list and returns how many were
            // added vs skipped (already existed).
            const res = await api.post('/news/keywords', { keyword: kw, language: newRssKeywordLang });
            const added = res.data?.added ?? 1;
            const skipped = res.data?.skipped ?? 0;
            setNewRssKeyword('');
            if (added > 0) {
                toast.success(`Added ${added} keyword${added !== 1 ? 's' : ''}${skipped ? ` · ${skipped} already existed` : ''}`);
                setIsAddRssKeywordOpen(false);
            } else {
                toast(skipped ? 'All of those keywords already exist' : 'Nothing to add');
                setRssKeywordError(skipped ? 'All of those keywords already exist.' : 'Enter at least one keyword.');
            }
            fetchRssKeywords();
        } catch (err) {
            console.error('[RSS] handleAddRssKeyword error:', err);
            const errMsg = err?.response?.data?.message || 'Failed to add RSS keyword.';
            setRssKeywordError(errMsg);
            toast.error(errMsg);
        }
    };

    const handleDeleteRssKeyword = async (kw) => {
        if (!window.confirm(`Are you sure you want to delete the keyword "${kw}"?`)) return;
        try {
            await api.delete(`/news/keywords/${encodeURIComponent(kw)}`);
            toast.success(`Successfully deleted keyword: "${kw}"`);
            fetchRssKeywords();
        } catch (err) {
            console.error('[RSS] handleDeleteRssKeyword error:', err);
            toast.error('Failed to delete RSS keyword.');
        }
    };

    // ── RSS Languages Fetch/Add/Delete ────────────────────────────
    const fetchRssLanguages = useCallback(async () => {
        try {
            const res = await api.get('/news/languages');
            setRssLanguages(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error('[RSS] fetchRssLanguages error:', err);
        }
    }, []);

    const handleAddRssLanguage = async (e) => {
        e.preventDefault();
        const name = newRssLanguageName.trim();
        if (!name) return;
        setRssLanguageError('');
        try {
            const res = await api.post('/news/languages', { name, code: newRssLanguageCode.trim() });
            setNewRssLanguageName('');
            setNewRssLanguageCode('');
            toast.success(`Added language: "${name}"`);
            setIsAddRssLanguageOpen(false);
            await fetchRssLanguages();
            // Select the freshly added language in the keyword form for convenience.
            if (res.data?.code) setNewRssKeywordLang(res.data.code);
        } catch (err) {
            console.error('[RSS] handleAddRssLanguage error:', err);
            const errMsg = err?.response?.data?.message || 'Failed to add language.';
            setRssLanguageError(errMsg);
            toast.error(errMsg);
        }
    };

    const handleDeleteRssLanguage = async (lang) => {
        const count = rssKeywords.filter((k) => k.language === lang.code).length;
        const warn = count > 0
            ? `Delete the language "${lang.label}"? This will also remove its ${count} keyword${count === 1 ? '' : 's'}.`
            : `Delete the language "${lang.label}"?`;
        if (!window.confirm(warn)) return;
        try {
            const res = await api.delete(`/news/languages/${encodeURIComponent(lang.code)}`);
            const removed = res.data?.keywordsRemoved || 0;
            toast.success(`Deleted "${lang.label}"${removed ? ` and ${removed} keyword${removed === 1 ? '' : 's'}` : ''}`);
            await Promise.all([fetchRssLanguages(), fetchRssKeywords()]);
        } catch (err) {
            console.error('[RSS] handleDeleteRssLanguage error:', err);
            toast.error('Failed to delete language.');
        }
    };

    useEffect(() => {
        if (navbarPlatform === 'rss' && rssSubTab === 'keywords') {
            fetchRssKeywords();
            fetchRssLanguages();
        }
    }, [navbarPlatform, rssSubTab, fetchRssKeywords, fetchRssLanguages]);

    const fetchSources = async () => {
        setSourcesLoading(true);
        try {
            const res = await api.get('/grievances/sources');
            setSources(res.data || []);
        } catch (error) {
            console.error('Failed to fetch sources', error);
        } finally {
            setSourcesLoading(false);
        }
    };

    const fetchDashboardStats = async () => {
        try {
            const requests = [api.get('/grievances/stats')];
            if (canAccessGrievanceReports) {
                requests.push(api.get('/grievance-workflow/reports', { params: { page: 1, limit: 1 } }));
            }

            const [statsRes, wfRes] = await Promise.all(requests);
            if (statsRes.data) setStats(statsRes.data);
            if (wfRes?.data?.stats) {
                setWorkflowStats(wfRes.data.stats);
            } else if (!canAccessGrievanceReports) {
                setWorkflowStats({ total: 0, pending: 0, escalated: 0, closed: 0, fir: 0 });
            }
        } catch (error) {
            console.error('Failed to fetch stats', error);
        }
    };

    const fetchSentimentLeaders = useCallback(async () => {
        setSentimentLeadersLoading(true);
        try {
            const res = await api.get('/grievances/sentiment-leaders', { params: { limit: 100 } });
            setSentimentLeaders({
                positive: res.data?.leaders?.positive || [],
                negative: res.data?.leaders?.negative || [],
                neutral: res.data?.leaders?.neutral || res.data?.leaders?.moderate || []
            });
        } catch (error) {
            console.error('Failed to fetch sentiment leaders', error);
            setSentimentLeaders(EMPTY_SENTIMENT_LEADERS);
            toast.error('Failed to load sentiment leaders');
        } finally {
            setSentimentLeadersLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!sentimentLeadersOpen) return;
        fetchSentimentLeaders();
    }, [sentimentLeadersOpen, fetchSentimentLeaders]);

    const fetchGrievances = async (cursor = null) => {
        if (!navbarStatus) {
            setGrievances([]);
            setPagination({ hasMore: false, nextCursor: null, total: 0 });
            setLoading(false);
            return;
        }

        if (navbarStatus === 'reports') {
            setGrievances([]);
            setPagination({ hasMore: false, nextCursor: null, total: 0 });
            setLoading(false);
            return;
        }

        // YouTube LIVE is a standalone feed backed by its own collection. It must
        // never be passed as a grievance platform filter, and its chat messages
        // never appear in "All".
        if (navbarPlatform === 'ytlive') {
            setGrievances([]);
            setPagination({ hasMore: false, nextCursor: null, total: 0 });
            setLoading(false);
            return;
        }

        // Cancel any in-flight request when filters change (not for "load more")
        if (!cursor && fetchAbortRef.current) {
            fetchAbortRef.current.abort();
        }
        const abortController = new AbortController();
        if (!cursor) fetchAbortRef.current = abortController;

        if (cursor) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }
        try {
            const params = {
                tab: activeTab === 'fir' ? 'fir' : activeTab,
                limit: 100,
            };

            if (navbarStatus && navbarStatus !== 'total' && navbarStatus !== 'reports') {
                params.status_filter = navbarStatus;
            }
            if (navbarPlatform && navbarPlatform !== 'all') {
                params.platform = navbarPlatform;
            } else if (platformFilter && platformFilter !== 'all') {
                params.platform = platformFilter;
            }
            if (selectedHandle) params.handle = selectedHandle;
            if (sentimentFilter) params.sentiment = sentimentFilter;
            if (stanceFilter) params.stance = stanceFilter;
            if (topicFilter) params.grievance_type = mapTopicFilterToApi(topicFilter);
            if (analysisCategoryFilter) params.analysis_category = analysisCategoryFilter;
            if (targetEntityFilter) params.target_entity = targetEntityFilter;
            if (leaderFilter) params.leader_seat = leaderFilter;
            if (locationFilter) params.location_city = locationFilter;
            if (debouncedSearch) params.search = debouncedSearch;
            // Always a CLOSED range, resolved against the user's own clock. A
            // single-day pick leaves `dateRange.to` null — falling back to
            // `from` is what turns "6 Aug" into 6 Aug rather than "6 Aug
            // onwards". Sent as exact instants, not calendar days, so the
            // window is the user's local day and not the UTC one.
            if (dateRange.from) {
                params.from = startOfDay(dateRange.from).toISOString();
                params.to = endOfDay(dateRange.to || dateRange.from).toISOString();
            } else if (dateRange.to) {
                // `to` alone stays open-ended on the lower bound, which is a
                // meaningful "everything up to" query.
                params.to = endOfDay(dateRange.to).toISOString();
            }
            if (cursor) params.cursor = cursor;

            const res = await api.get('/grievances', { params, signal: abortController.signal });
            const data = res.data;
            const rows = Array.isArray(data.grievances) ? data.grievances : [];
            const rowsWithCachedLocations = applyCachedLocations(rows);

            if (cursor) {
                setGrievances(prev => [...prev, ...rowsWithCachedLocations]);
            } else {
                setGrievances(rowsWithCachedLocations);
            }
            // Carry the server-side sentiment breakdown forward across
            // Load More clicks (the backend only sends it on page 1).
            setPagination((prev) => ({
                hasMore: data.pagination?.hasMore || false,
                nextCursor: data.pagination?.nextCursor || null,
                total: data.pagination?.total ?? prev.total ?? 0,
                sentiment_counts:
                    data.pagination?.sentiment_counts
                    || (cursor ? prev.sentiment_counts : undefined)
            }));

            void enrichLocationsInBackground(rowsWithCachedLocations);
        } catch (error) {
            if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') return; // aborted — ignore
            toast.error('Failed to load grievances');
            console.error(error);
        } finally {
            // A superseded (aborted) request must not clear `loading` on behalf
            // of the newer request that replaced it — only the request that's
            // still current (i.e. still referenced by fetchAbortRef) may do so.
            // "Load More" calls never touch fetchAbortRef, so they always clear
            // loadingMore unconditionally, same as before.
            if (cursor) {
                setLoadingMore(false);
            } else if (fetchAbortRef.current === abortController) {
                setLoading(false);
            }
        }
    };

    /* ─── Source Management ─── */
    const handleAddSource = async () => {
        if (!addSourceHandle.trim()) {
            toast.error('Please enter an account handle or ID');
            return;
        }
        setAddingSource(true);
        try {
            const res = await api.post('/grievances/sources', {
                handle: addSourceHandle.trim(),
                platform: addSourcePlatform,
                department: addSourceDept || undefined,
            });
            toast.success(`Source "${res.data.display_name || addSourceHandle}" added successfully`);
            setSources(prev => [res.data, ...prev]);
            setShowAddSource(false);
            setAddSourceHandle('');
            setAddSourceDept('');
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to add source');
        } finally {
            setAddingSource(false);
        }
    };

    const handleDeleteSource = async (source) => {
        try {
            await api.delete(`/grievances/sources/${source.id}`);
            toast.success(`Source "${source.handle}" removed`);
            setSources(prev => prev.filter(s => s.id !== source.id));
            setDeleteConfirmSource(null);
        } catch (error) {
            toast.error('Failed to delete source');
        }
    };

    const handleFetchForSource = async (source, startDate, endDate) => {
        setFetchingSource(source.id);
        try {
            const res = await api.post(`/grievances/sources/${source.id}/fetch`, {
                start_date: startDate || undefined,
                end_date: endDate || undefined,
            });
            const newCount = res.data?.newGrievances || 0;
            toast.success(`Fetched ${newCount} new grievance${newCount !== 1 ? 's' : ''} for ${source.handle}`);
            fetchGrievances();
            fetchDashboardStats();
            fetchSources();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to fetch grievances for source');
        } finally {
            setFetchingSource(null);
            setFetchDateDialog(null);
        }
    };

    const handleFetchAll = async () => {
        setFetchingSource('all');
        try {
            const res = await api.post('/grievances/fetch-all');
            const newCount = res.data?.newGrievances || 0;
            toast.success(`Fetched ${newCount} new grievance${newCount !== 1 ? 's' : ''} from all sources`);
            fetchGrievances();
            fetchDashboardStats();
            fetchSources();
        } catch (error) {
            toast.error('Failed to fetch grievances');
        } finally {
            setFetchingSource(null);
        }
    };

    const handleFetchKeywords = async (platform) => {
        const key = platform || 'keywords';
        setFetchingSource(key);
        try {
            const res = await api.post('/grievances/fetch-keywords', platform ? { platform } : {});
            const newCount = res.data?.newGrievances || 0;
            const kwCount = res.data?.keywordsSearched || 0;
            const label = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'all platforms';
            toast.success(`Fetched ${newCount} new post${newCount !== 1 ? 's' : ''} from ${label} (${kwCount} keyword${kwCount !== 1 ? 's' : ''})`);
            fetchGrievances();
            fetchDashboardStats();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to fetch keyword content');
        } finally {
            setFetchingSource(null);
        }
    };

    // handleFetchHashtag removed with the Fetch button: the search box filters
    // what is already collected, and the endpoint it called
    // (POST /grievances/fetch-hashtag) has no route on the backend, so the
    // button only ever produced a 404 toast. Ingestion lives in Keywords.

    const handleUpdateGrievanceWorkflowStatus = async (grievance, status) => {
        const reportId = grievance?.grievance_workflow?.report_id;
        if (!reportId) {
            toast.error('Unique ID not generated yet for this post');
            return;
        }

        // ESCALATED or CLOSED → open multi-step popup
        if (['ESCALATED', 'CLOSED'].includes(status)) {
            setStatusChangePopup({ grievance, targetStatus: status });
            return;
        }

        // PENDING → direct API call
        try {
            const res = await api.put(`/grievance-workflow/${grievance.grievance_workflow.id}/status`, { status });
            const nextStatus = res?.data?.status || status;
            triggerActionBlink(grievance.id);

            setGrievances(prev => prev.map(item => (
                item.id === grievance.id
                    ? {
                        ...item,
                        grievance_workflow: {
                            ...(item.grievance_workflow || {}),
                            status: nextStatus
                        }
                    }
                    : item
            )));

            toast.success(`Status updated to ${nextStatus}`);
        } catch (error) {
            toast.error(error?.response?.data?.error || 'Failed to update grievance workflow status');
        }
    };

    const handleStatusChangeComplete = (grievanceId, newStatus) => {
        triggerActionBlink(grievanceId);
        setGrievances(prev => prev.map(item => (
            item.id === grievanceId
                ? {
                    ...item,
                    grievance_workflow: {
                        ...(item.grievance_workflow || {}),
                        status: newStatus
                    }
                }
                : item
        )));
    };

    const triggerActionBlink = (id) => {
        if (!id) return;
        setActionedGrievanceIds(prev => [...prev, id]);
        setTimeout(() => {
            setActionedGrievanceIds(prev => prev.filter(item => item !== id));
        }, 5000);
    };

    const handleGrievanceReportCreated = (originalGrievanceId, report) => {
        if (!originalGrievanceId || !report) return;
        triggerActionBlink(originalGrievanceId);

        const nextWorkflow = {
            report_id: report.id,
            unique_code: report.unique_code,
            status: report.status || 'PENDING'
        };

        setGrievances(prev => prev.map(item => (
            item.id === originalGrievanceId
                ? {
                    ...item,
                    grievance_workflow: {
                        ...(item.grievance_workflow || {}),
                        ...nextWorkflow
                    }
                }
                : item
        )));

        setSelectedGrievance(prev => (
            prev?.id === originalGrievanceId
                ? {
                    ...prev,
                    grievance_workflow: {
                        ...(prev.grievance_workflow || {}),
                        ...nextWorkflow
                    }
                }
                : prev
        ));

        setGrievancePopupGrievance(prev => (
            prev?.id === originalGrievanceId
                ? {
                    ...prev,
                    grievance_workflow: {
                        ...(prev.grievance_workflow || {}),
                        ...nextWorkflow
                    }
                }
                : prev
        ));

        fetchDashboardStats();
    };

    const handleQueryReportCreated = (originalGrievanceId, report) => {
        if (!originalGrievanceId || !report) return;
        triggerActionBlink(originalGrievanceId);

        const nextQuery = {
            report_id: report.id,
            unique_code: report.unique_code,
            status: report.status || 'PENDING'
        };

        setGrievances(prev => prev.map(item => (
            item.id === originalGrievanceId
                ? {
                    ...item,
                    query_workflow: {
                        ...(item.query_workflow || {}),
                        ...nextQuery
                    }
                }
                : item
        )));

        setSelectedGrievance(prev => (
            prev?.id === originalGrievanceId
                ? {
                    ...prev,
                    query_workflow: {
                        ...(prev.query_workflow || {}),
                        ...nextQuery
                    }
                }
                : prev
        ));

        setQueryPopupGrievance(prev => (
            prev?.id === originalGrievanceId
                ? {
                    ...prev,
                    query_workflow: {
                        ...(prev.query_workflow || {}),
                        ...nextQuery
                    }
                }
                : prev
        ));

        fetchDashboardStats();
    };

    const handleSuggestionReportCreated = (originalGrievanceId, report) => {
        if (!originalGrievanceId || !report) return;
        triggerActionBlink(originalGrievanceId);

        const nextSuggestion = {
            report_id: report.id,
            unique_code: report.unique_code,
            category: report.category
        };

        setGrievances(prev => prev.map(item => (
            item.id === originalGrievanceId
                ? {
                    ...item,
                    suggestion: {
                        ...(item.suggestion || {}),
                        ...nextSuggestion
                    }
                }
                : item
        )));

        setSelectedGrievance(prev => (
            prev?.id === originalGrievanceId
                ? {
                    ...prev,
                    suggestion: {
                        ...(prev.suggestion || {}),
                        ...nextSuggestion
                    }
                }
                : prev
        ));

        setSuggestionPopupGrievance(prev => (
            prev?.id === originalGrievanceId
                ? {
                    ...prev,
                    suggestion: {
                        ...(prev.suggestion || {}),
                        ...nextSuggestion
                    }
                }
                : prev
        ));

        fetchDashboardStats();
    };

    const handleCriticismReportCreated = (criticismReport, grievanceId) => {
        triggerActionBlink(grievanceId);
        setGrievances(prev => prev.map(g =>
            g.id === grievanceId
                ? {
                    ...g,
                    criticism: {
                        ...(g.criticism || {}),
                        ...criticismReport
                    }
                }
                : g
        ));

        setCriticismGrievance(prev => (
            prev?.id === grievanceId
                ? {
                    ...prev,
                    criticism: {
                        ...(prev.criticism || {}),
                        ...criticismReport
                    }
                }
                : prev
        ));
    };

    /* ─── Card Actions ─── */
    const handleDeleteGrievance = async (grievanceId) => {
        if (!canManageSpecialGrievanceUi) {
            toast.error('You do not have access to delete grievances');
            return;
        }
        try {
            await api.delete(`/grievances/${grievanceId}`);
            setGrievances(prev => prev.filter(g => g.id !== grievanceId));
            toast.success('Grievance deleted successfully');
            fetchDashboardStats();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to delete grievance');
        }
    };

    const handleAction = (action, { grievance, media, status }) => {
        setSelectedGrievance(grievance);
        if (action === 'view') {
            setIsDetailOpen(true);
        } else if (action === 'update_status') {
            setNewStatus(grievance.workflow_status || 'received');
            setStatusUpdateNote('');
            setIsStatusOpen(true);
        } else if (action === 'convert_to_fir') {
            setFirNote('');
            setFirNumber('');
            setIsFirConfirmOpen(true);
        } else if (action === 'view_media') {
            setSelectedMedia(media);
            setVideoRefreshUrl(null);
            setVideoRefreshing(false);
            setIsMediaOpen(true);
        } else if (action === 'share_to_excel') {
            // Pre-fill modal with grievance data
            const complainantName = grievance.posted_by?.display_name || grievance.complainant_phone || 'Unknown';
            const content = grievance.content?.full_text || grievance.content?.text || '';
            setPreFilledRow({
                callerNumber: grievance.complainant_phone || grievance.posted_by?.handle || '',
                mentionName: complainantName,
                contents: content,
                receivedTime: new Date().toISOString().slice(0, 16),
            });
            setShowExcelModal(true);
        } else if (action === 'download') {
            downloadMediaForGrievance(grievance);
        } else if (action === 'classify_criticism') {
            setCriticismGrievance(grievance);
        } else if (action === 'classify_grievance') {
            setGrievancePopupGrievance(grievance);
        } else if (action === 'classify_query') {
            setQueryPopupGrievance(grievance);
        } else if (action === 'classify_suggestion') {
            setSuggestionPopupGrievance(grievance);
        } else if (action === 'open_g_report') {
            const uniqueCode = grievance?.grievance_workflow?.unique_code || '';
            if (!uniqueCode) {
                toast.error('No grievance report code found for this card');
                return;
            }
            setActiveReportSubTab('grievance');
            setNavbarStatus('reports');
            setOpenGReportCode(uniqueCode);
        } else if (action === 'open_s_report') {
            const uniqueCode = grievance?.suggestion?.unique_code || '';
            if (!uniqueCode) {
                toast.error('No suggestion report code found for this card');
                return;
            }
            setActiveReportSubTab('suggestion');
            setNavbarStatus('reports');
            setOpenSReportCode(uniqueCode);
        } else if (action === 'open_c_report') {
            const uniqueCode = grievance?.criticism?.unique_code || '';
            if (!uniqueCode) {
                toast.error('No criticism report code found for this card');
                return;
            }
            setActiveReportSubTab('criticism');
            setNavbarStatus('reports');
            setOpenCReportCode(uniqueCode);
        } else if (action === 'view_analysis') {
            setIsAnalysisOpen(true);
        } else if (action === 'update_g_workflow_status') {
            handleUpdateGrievanceWorkflowStatus(grievance, status);
        } else if (action === 'delete') {
            if (!canManageSpecialGrievanceUi) {
                toast.error('You do not have access to delete grievances');
                return;
            }
            handleDeleteGrievance(grievance.id);
        }
    };

    // Handler for updating a grievance report status inline
    const handleUpdateGrievanceWorkflowStatusInline = async (grievance, newStatus) => {
        try {
            await api.put(`/grievance-workflow/${grievance.grievance_workflow.id}/status`, {
                status: newStatus
            });
            triggerActionBlink(grievance.id);
            toast.success('Report status updated');
        } catch (error) {
            toast.error('Failed to update report status');
        }
    };

    const handleUpdateStatus = async () => {
        if (!selectedGrievance) return;
        setUpdatingStatus(true);
        try {
            await api.put(`/grievances/${selectedGrievance.id}/workflow`, {
                workflow_status: newStatus,
                note: statusUpdateNote || undefined,
            });
            triggerActionBlink(selectedGrievance.id);
            toast.success('Status updated successfully');
            setIsStatusOpen(false);

            // Add delay so user can see the blink before it vanishes to another tab
            setTimeout(() => {
                // Switch to the tab matching the new status
                const statusTabMap = {
                    received: 'pending',
                    reviewed: 'pending',
                    action_taken: 'pending',
                    closed: 'closed',
                    converted_to_fir: 'fir'
                };
                const targetTab = statusTabMap[newStatus] || 'all';
                setActiveTab(targetTab);
                setGrievances([]);
                fetchGrievances();
                fetchDashboardStats();
            }, 1000);
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to update status');
        } finally {
            setUpdatingStatus(false);
        }
    };

    const handleConvertToFir = async () => {
        if (!selectedGrievance) return;
        setUpdatingStatus(true);
        try {
            await api.post(`/grievances/${selectedGrievance.id}/convert-to-fir`, {
                note: firNote || undefined,
                fir_number: firNumber || undefined,
            });
            triggerActionBlink(selectedGrievance.id);
            toast.success('Grievance converted to FIR');
            setIsFirConfirmOpen(false);

            setTimeout(() => {
                // Switch to FIR tab
                setActiveTab('fir');
                setGrievances([]);
                fetchGrievances();
                fetchDashboardStats();
            }, 1000);
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to convert to FIR');
        } finally {
            setUpdatingStatus(false);
        }
    };

    const clearFilters = () => {
        // Every filter lives in the URL, so one write clears them all — the
        // hand-written subset here used to miss sentiment, topic, category,
        // target and three of the four location params.
        clearAllFilters();
        setNavbarStatus('total');
    };

    const leaderRows = useMemo(() => {
        const rows = sentimentLeaders[sentimentLeadersTab] || [];
        const platformRows = sentimentLeadersPlatform === 'all'
            ? rows
            : rows.filter((row) => String(row.platform || '').toLowerCase() === sentimentLeadersPlatform);
        const q = sentimentLeadersSearch.trim().toLowerCase();
        if (!q) return platformRows;
        return platformRows.filter((row) => (
            String(row.handle || '').toLowerCase().includes(q) ||
            String(row.display_name || '').toLowerCase().includes(q) ||
            String(row.platform || '').toLowerCase().includes(q)
        ));
    }, [sentimentLeaders, sentimentLeadersTab, sentimentLeadersPlatform, sentimentLeadersSearch]);

    const openSentimentLeaderPosts = useCallback((row) => {
        if (!row?.handle) return;
        // One URL write, so the drill-down lands as a single navigable state
        // rather than three separate setState calls the sync effect would
        // immediately undo.
        updateURLParams({
            sentiment: sentimentLeadersTab,
            handle: String(row.handle || '').replace(/^@/, ''),
            posted_by: null,
            platform: row.platform && row.platform !== 'all' ? row.platform : null,
        });
        setNavbarStatus('total');
        setSentimentLeadersOpen(false);
    }, [sentimentLeadersTab, updateURLParams]);

    // Every filter that can hide rows, so the Clear affordance appears whenever
    // one is applied. Sentiment, topic, category and target were missing, so a
    // feed narrowed by any of them looked unfiltered.
    const hasActiveFilters = navbarPlatform !== 'all' || dateRange.from || dateRange.to
        || debouncedSearch || navbarStatus !== 'total' || selectedHandle || locationFilter
        || sentimentFilter || stanceFilter || topicFilter || analysisCategoryFilter || targetEntityFilter || leaderFilter;
    const isReportsTab = navbarStatus === 'reports';

    // No more client-side location filtering — backend handles it via location_city param
    const displayedGrievances = grievances;

    const xSources = sources.filter(s => s.platform === 'x');
    const fbSources = sources.filter(s => s.platform === 'facebook');

    /* ═══════════════════════════════════════════════════════════════ */
    /*                           RENDER                              */
    /* ═══════════════════════════════════════════════════════════════ */
    return (
        <div className="p-4 md:p-6 space-y-0 bg-slate-50 min-h-screen flex flex-col">

            {/* ─── Page Header ─── */}
            {/* Title on its own line, then a toolbar that spans the full page
                width so it lines up with the platform tab bar below rather than
                collapsing into a left-aligned huddle. */}
            <div className="px-2 py-2 space-y-2">
                <div className="flex items-center gap-3 min-w-0">
                    <h1 className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">Grievance Management</h1>
                    <span className="hidden sm:inline text-xs text-muted-foreground border-l border-slate-200 pl-3">Monitor and resolve public complaints from social platforms</span>
                </div>
                <div className="flex w-full items-center gap-1.5 flex-wrap">
                    {/* Takes whatever width the buttons leave. `min-w` keeps it
                        usable once the row wraps on a narrow viewport. */}
                    <div className="relative flex-1 min-w-[220px]">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search handle, name, #hashtag..."
                            className="bg-white border border-slate-200 rounded-md pl-6 pr-6 py-1 text-xs text-slate-700 w-full h-7 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 placeholder:text-slate-400"
                        />
                        {searchQuery && (
                            <button type="button" onClick={() => { setSearchQuery(''); updateURLParams({ search: null }); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                <X className="h-3 w-3" />
                            </button>
                        )}
                    </div>
                    <div className="relative shrink-0">
                        <select value={topicFilter || ''} onChange={(e) => updateURLParams({ grievance_type: e.target.value || null, topic: null })} className="appearance-none bg-white border border-slate-200 rounded-md pl-6 pr-6 py-1 h-7 text-xs text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 cursor-pointer">
                            <option value="">All Topics</option>
                            {topicGroups.subjects.length > 0 && (
                                <optgroup label="Subject">
                                    {topicGroups.subjects.map(t => <option key={`s-${t}`} value={t}>{t}</option>)}
                                </optgroup>
                            )}
                            {topicGroups.intents.length > 0 && (
                                <optgroup label="Type of post">
                                    {topicGroups.intents.map(t => <option key={`i-${t}`} value={t}>{t}</option>)}
                                </optgroup>
                            )}
                            {topicGroups.subjects.length === 0 && topicGroups.intents.length === 0
                                && grievanceTopics.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <Tag className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
                        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
                    </div>
                    {/* The sentiment control lives in the pill row below the
                        platform tabs, not here. This spot used to hold a second
                        <select> bound to the SAME `sentimentFilter` state and
                        the same three values — a duplicate that was also
                        mislabelled "All Risk Levels" (it never touched
                        risk_level) and carried no counts. The pills win: correct
                        labels, live per-sentiment totals, and an explicit All. */}

                    <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                title={describeDateSelection(dateRange)}
                                className={`h-7 gap-1.5 text-xs px-2 shrink-0 ${dateRange.from || dateRange.to ? 'border-violet-400 bg-violet-50 text-violet-700 hover:bg-violet-100' : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'}`}
                            >
                                <Calendar className="h-3 w-3 shrink-0" />
                                <span>{formatDateRangeLabel(dateRange) || 'Date range'}</span>
                                {(dateRange.from || dateRange.to) && (
                                    // Clearing is the most repeated action here, so it
                                    // does not require opening the popover first.
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        aria-label="Clear date filter"
                                        className="ml-0.5 -mr-0.5 rounded-sm p-0.5 hover:bg-violet-200/70"
                                        onClick={(e) => { e.stopPropagation(); applyDateRange(null, null); }}
                                        onKeyDown={(e) => {
                                            if (e.key !== 'Enter' && e.key !== ' ') return;
                                            e.preventDefault(); e.stopPropagation(); applyDateRange(null, null);
                                        }}
                                    >
                                        <X className="h-3 w-3" />
                                    </span>
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                            <div className="flex">
                                {/* Presets — the common windows, one click each. */}
                                <div className="flex flex-col gap-0.5 border-r border-slate-200 p-2 w-36">
                                    <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                        Quick ranges
                                    </div>
                                    {DATE_PRESETS.map((preset) => {
                                        const isActive = activeDatePreset === preset.id;
                                        return (
                                            <button
                                                key={preset.id}
                                                type="button"
                                                onClick={() => {
                                                    const { from, to } = preset.range();
                                                    applyDateRange(from, to);
                                                    setDatePickerOpen(false);
                                                }}
                                                className={cn(
                                                    'rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                                                    isActive
                                                        ? 'bg-violet-100 font-medium text-violet-700'
                                                        : 'text-slate-600 hover:bg-slate-100'
                                                )}
                                            >
                                                {preset.label}
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="flex flex-col">
                                    <div className="border-b border-slate-200 px-3 py-2 text-[11px] text-slate-500">
                                        Click one day to filter that day, or click a second to span a range.
                                    </div>
                                    <CalendarComponent
                                        initialFocus
                                        mode="range"
                                        defaultMonth={dateRange.from || new Date()}
                                        selected={{ from: dateRange.from || undefined, to: dateRange.to || undefined }}
                                        // Nothing is posted in the future; offering
                                        // those cells only invites an empty result.
                                        disabled={{ after: new Date() }}
                                        onSelect={(range) => {
                                            // Local calendar days — see toDateParam.
                                            // A single click leaves `to` undefined and
                                            // the URL keeps it that way; the closing
                                            // bound is applied when the query is built,
                                            // so the label still reads as one day.
                                            applyDateRange(range?.from, range?.to);
                                        }}
                                        numberOfMonths={2}
                                    />
                                    <div className="flex items-center justify-between gap-4 border-t border-slate-200 px-3 py-2">
                                        {/* Says in words exactly what will be matched,
                                            so a one-day pick can't be misread as
                                            "from this date onwards". */}
                                        <span className={`text-xs ${dateRange.from || dateRange.to ? 'text-slate-700' : 'text-slate-400'}`}>
                                            {describeDateSelection(dateRange)}
                                        </span>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {(dateRange.from || dateRange.to) && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 text-xs text-slate-500"
                                                    onClick={() => applyDateRange(null, null)}
                                                >
                                                    Clear
                                                </Button>
                                            )}
                                            <Button
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => setDatePickerOpen(false)}
                                            >
                                                Done
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>

                    <Button variant="outline" size="sm" onClick={() => { fetchGrievances(); fetchDashboardStats(); fetchLocationStats(); }} className="h-7 gap-1 text-xs px-2 shrink-0">
                        <RefreshCw className="h-3 w-3" /> Refresh
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setSentimentLeadersSearch(''); setSentimentLeadersTab('positive'); setSentimentLeadersOpen(true); }} className="h-7 gap-1 text-xs px-2 shrink-0 border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400">
                        <Users className="h-3 w-3" /> Sentiment Leaders
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setAddTweetOpen(true)} className="h-7 gap-1 text-xs px-2 shrink-0 border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-400">
                        <Download className="h-3 w-3" /> Add Tweet
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { fetchTrackedKeywords(); setKeywordsOpen(true); }} className="h-7 gap-1 text-xs px-2 shrink-0 border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 hover:border-orange-400">
                        <Tag className="h-3 w-3" /> Keywords
                    </Button>
                </div>
            </div>

            {/* ─── Add Tweet by URL/ID Modal ─── */}
            <Dialog open={addTweetOpen} onOpenChange={setAddTweetOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Download className="h-4 w-4 text-blue-600" /> Add Tweet manually
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 pt-1">
                        <p className="text-xs text-muted-foreground">
                            Paste any X / Twitter URL or a tweet id. We'll fetch the tweet, run sentiment classification (RapidAPI ChatGPT-42), and add it to the BRS mentions feed.
                        </p>
                        <input
                            type="text"
                            value={addTweetInput}
                            onChange={(e) => setAddTweetInput(e.target.value)}
                            placeholder="https://x.com/username/status/1234567890  ·  or just 1234567890"
                            disabled={addTweetLoading}
                            className="w-full bg-white border border-slate-200 rounded-md px-2.5 py-2 text-sm hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 placeholder:text-slate-400"
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setAddTweetOpen(false)} disabled={addTweetLoading}>Cancel</Button>
                            <Button
                                size="sm"
                                onClick={handleImportTweet}
                                disabled={addTweetLoading || !addTweetInput.trim()}
                                className="gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                            >
                                {addTweetLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                {addTweetLoading ? 'Importing…' : 'Import'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ─── Keywords Manager Modal ─── */}
            <Dialog open={keywordsOpen} onOpenChange={setKeywordsOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Tag className="h-4 w-4 text-orange-600" /> BRS Tracking Keywords
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 pt-1">
                        <p className="text-xs text-muted-foreground">
                            These keywords are what the auto-fetcher searches every 10–30 minutes. Add anything related to KCR / KTR / BRS, or to the Congress government we are up against — names, hashtags, rival keywords, constituency landmarks. English, Telugu (Telugu script or romanised) and Urdu all work.
                        </p>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={newKeywordInput}
                                onChange={(e) => setNewKeywordInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleAddKeyword(); }}
                                placeholder="e.g. #KCR  ·  rythu bharosa  ·  కేసీఆర్"
                                disabled={keywordSaving}
                                className="flex-1 bg-white border border-slate-200 rounded-md px-2.5 py-2 text-sm hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 placeholder:text-slate-400"
                            />
                            <select
                                value={newKeywordCategory}
                                onChange={(e) => setNewKeywordCategory(e.target.value)}
                                disabled={keywordSaving}
                                className="bg-white border border-slate-200 rounded-md px-2 py-2 text-xs"
                            >
                                <option value="other">Others</option>
                                <option value="violence">Violence</option>
                                <option value="threat">Threat</option>
                                <option value="hate">Hate</option>
                            </select>
                            <select
                                value={newKeywordLang}
                                onChange={(e) => setNewKeywordLang(e.target.value)}
                                disabled={keywordSaving}
                                title="Language of the keyword being added"
                                aria-label="Language of the keyword being added"
                                className="bg-white border border-slate-200 rounded-md px-2 py-2 text-xs"
                            >
                                {KEYWORD_LANGUAGES.map((l) => (
                                    <option key={l.value} value={l.value}>{l.label}</option>
                                ))}
                            </select>
                            <Button
                                size="sm"
                                onClick={handleAddKeyword}
                                disabled={keywordSaving || !newKeywordInput.trim()}
                                className="gap-1 bg-orange-600 hover:bg-orange-700 text-white"
                            >
                                {keywordSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                                Add
                            </Button>
                        </div>
                        {/* Filtering the list, deliberately separate from the
                            language chosen for a new keyword above — one control
                            meaning two things would make picking a language to
                            add silently re-filter the table. */}
                        {trackedKeywords.length > 0 && (
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-slate-500">Show</span>
                                <select
                                    value={keywordLangFilter}
                                    onChange={(e) => setKeywordLangFilter(e.target.value)}
                                    aria-label="Filter keywords by language"
                                    className="bg-white border border-slate-200 rounded-md px-2 py-1 text-xs hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
                                >
                                    <option value="">All languages ({trackedKeywords.length})</option>
                                    {keywordLangOptions.map((l) => (
                                        <option key={l.value} value={l.value}>
                                            {l.name} ({keywordLangCounts.get(l.value)})
                                        </option>
                                    ))}
                                </select>
                                {keywordLangFilter && (
                                    <button
                                        type="button"
                                        onClick={() => setKeywordLangFilter('')}
                                        className="text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
                                    >
                                        <X className="h-3 w-3" /> Clear
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="border border-slate-200 rounded-md max-h-[420px] overflow-y-auto">
                            {trackedKeywordsLoading ? (
                                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Loading keywords…
                                </div>
                            ) : trackedKeywords.length === 0 ? (
                                <div className="text-center py-8 text-xs text-muted-foreground">No keywords yet. Add some above.</div>
                            ) : visibleKeywords.length === 0 ? (
                                <div className="text-center py-8 text-xs text-muted-foreground">
                                    No {keywordLanguageName(keywordLangFilter)} keywords.{' '}
                                    <button
                                        type="button"
                                        onClick={() => setKeywordLangFilter('')}
                                        className="text-orange-600 hover:underline"
                                    >
                                        Show all
                                    </button>
                                </div>
                            ) : (
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 sticky top-0">
                                        <tr className="text-left text-slate-500">
                                            <th className="px-3 py-2 font-semibold">Keyword</th>
                                            <th className="px-2 py-2 font-semibold">Cat</th>
                                            <th className="px-2 py-2 font-semibold">Lang</th>
                                            <th className="px-2 py-2 font-semibold">Weight</th>
                                            <th className="px-2 py-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleKeywords.map((k) => (
                                            <tr key={k.id || k._id || k.keyword} className="border-t border-slate-100 hover:bg-slate-50/60">
                                                <td className="px-3 py-1.5 font-medium text-slate-800">{k.keyword}</td>
                                                <td className="px-2 py-1.5">
                                                    <span className={cn(
                                                        'inline-block px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider',
                                                        k.category === 'hate'     ? 'bg-rose-100 text-rose-700'    :
                                                        k.category === 'threat'   ? 'bg-orange-100 text-orange-700' :
                                                        k.category === 'violence' ? 'bg-red-100 text-red-700'      :
                                                                                    'bg-slate-100 text-slate-700'
                                                    )}>{({ violence: 'Violence', threat: 'Threat', hate: 'Hate' })[k.category] || 'Others'}</span>
                                                </td>
                                                <td className="px-2 py-1.5 uppercase text-slate-500">{k.language || 'en'}</td>
                                                <td className="px-2 py-1.5 text-slate-500">{k.weight ?? 50}</td>
                                                <td className="px-2 py-1.5 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteKeyword(k.id || k._id)}
                                                        className="text-rose-500 hover:text-rose-700 inline-flex items-center gap-1"
                                                        title="Delete"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                            <span>
                                {keywordLangFilter
                                    ? `${visibleKeywords.length} of ${trackedKeywords.length} keywords · ${keywordLanguageName(keywordLangFilter)}`
                                    : `${trackedKeywords.length} keywords tracked`}
                                {' · auto-fetched every 10 min'}
                            </span>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleTriggerFetch}
                                disabled={triggerFetchLoading}
                                className="h-7 gap-1 text-xs"
                            >
                                {triggerFetchLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                Fetch now
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ─── Top Navigation Bar with Filters ─── */}
            <GrievanceTopNavbar
                activePlatform={navbarPlatform}
                // Through the URL, like every other filter. Setting state alone
                // meant the platform was absent from the address bar, so the
                // sync effect below read it back as 'all' the next time
                // anything else changed — applying a date range while on
                // Instagram bounced you to the All tab.
                onPlatformChange={(p) => updateURLParams({ platform: !p || p === 'all' ? null : p })}
                selectedHandle={selectedHandle}
                onHandleChange={(h) => updateURLParams({ handle: h || null, posted_by: null })}
                stats={stats}
                grievances={grievances}
                sources={sources}
                onAddSource={() => {
                    if (navbarPlatform !== 'all') {
                        setAddSourcePlatform(navbarPlatform);
                    }
                    setShowAddSource(true);
                }}
                onRemoveSource={(source) => setDeleteConfirmSource(source)}
                onFetchSourceHistory={(source) => setFetchDateDialog(source)}
                onFetchKeywords={handleFetchKeywords}
                fetchingSource={fetchingSource}
                locationFilter={locationFilter}
                // The dropdown lists city/district names, so a manual pick
                // resets any constituency scope carried in from a deep link by
                // clearing the other location params.
                onLocationChange={(value) => {
                    updateURLParams({ ...clearParams(LOCATION_PARAMS), location: value || null });
                }}
                uniqueLocations={uniqueLocations}
                stanceFilter={stanceFilter}
                onStanceChange={(value) => updateURLParams({ stance: value || null })}
            />

            {/* Dashboard Filter Banner */}
            {(sentimentFilter || stanceFilter || selectedHandle || topicFilter || analysisCategoryFilter || locationFilter || targetEntityFilter || leaderFilter || dateRange.from || dateRange.to) && (
                <div className="mx-2 mt-2 flex items-center gap-2 px-3 py-2 bg-violet-50 border border-violet-200 rounded-lg text-xs">
                    <span className="text-violet-700 font-medium">Filtered by:</span>
                    {leaderFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 font-semibold text-[11px]">
                            MLA of {leaderFilter} · tagged / named / seat named
                            <button type="button" onClick={() => updateURLParams({ leader: null })} className="ml-0.5 hover:opacity-70">&times;</button>
                        </span>
                    )}
                    {targetEntityFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 font-semibold text-[11px]">
                            {targetEntityFilter === 'kcr' ? 'K. Chandrashekar Rao' : targetEntityFilter === 'ktr' ? 'K. T. Rama Rao' : targetEntityFilter}
                            <button type="button" onClick={() => updateURLParams({ target_entity: null })} className="ml-0.5 hover:opacity-70">&times;</button>
                        </span>
                    )}
                    {sentimentFilter && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold text-[11px] ${
                            sentimentFilter === 'negative' ? 'bg-red-100 text-red-700' :
                            sentimentFilter === 'positive' ? 'bg-emerald-100 text-emerald-700' :
                            'bg-amber-100 text-amber-700'}`}>
                            {sentimentFilter === 'negative' ? 'Negative' : sentimentFilter === 'positive' ? 'Positive' : 'Neutral'}
                            <button type="button" onClick={() => updateURLParams({ sentiment: null })} className="ml-0.5 hover:opacity-70">&times;</button>
                        </span>
                    )}
                    {stanceFilter && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold text-[11px] ${
                            stanceFilter === 'opposing' ? 'bg-rose-100 text-rose-700' :
                            stanceFilter === 'supportive' ? 'bg-blue-100 text-blue-700' :
                            'bg-slate-100 text-slate-700'}`}>
                            {stanceFilter === 'opposing' ? 'Opposing' : stanceFilter === 'supportive' ? 'Supportive' : 'Neutral'}
                            <button type="button" onClick={() => updateURLParams({ stance: null })} className="ml-0.5 hover:opacity-70">&times;</button>
                        </span>
                    )}
                    {analysisCategoryFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold text-[11px]">
                            {analysisCategoryFilter.replace(/[_-]+/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            <button type="button" onClick={() => updateURLParams({ analysis_category: null })} className="ml-0.5 hover:opacity-70">&times;</button>
                        </span>
                    )}
                    {topicFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-semibold text-[11px]">
                            {topicFilter}
                            <button type="button" onClick={() => updateURLParams(clearParams(TOPIC_PARAMS))} className="ml-0.5 hover:opacity-70">&times;</button>
                        </span>
                    )}
                    {selectedHandle && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold text-[11px]">
                            @{selectedHandle.replace('@', '')}
                            <button type="button" onClick={() => updateURLParams(clearParams(HANDLE_PARAMS))} className="ml-0.5 hover:opacity-70">&times;</button>
                        </span>
                    )}
                    {locationFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold text-[11px]">
                            📍 {locationFilter}
                            <button type="button" onClick={() => updateURLParams(clearParams(LOCATION_PARAMS))} className="ml-0.5 hover:opacity-70">&times;</button>
                        </span>
                    )}
                    {(dateRange.from || dateRange.to) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-semibold text-[11px]" title={describeDateSelection(dateRange)}>
                            {/* Same label as the picker's trigger, so a one-day
                                pick reads as one day here too, and an open lower
                                bound ("Until 6 Aug") gets a chip at all. */}
                            📅 {formatDateRangeLabel(dateRange)}
                            <button type="button" onClick={() => applyDateRange(null, null)} className="ml-0.5 hover:opacity-70">&times;</button>
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={clearAllFilters}
                        className="ml-auto text-violet-600 hover:text-violet-800 font-medium"
                    >
                        Clear all
                    </button>
                </div>
            )}

            {/* ─── Reports Tab Content ─── */}
            {isReportsTab && (
                <div className="px-4 mt-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="max-w-5xl mx-auto flex justify-start">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setNavbarStatus('total')}
                            className="gap-2"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back to Grievances
                        </Button>
                    </div>
                    {/* Big Navigation Buttons */}
                    <div className="grid grid-cols-3 gap-6 max-w-5xl mx-auto">
                        {[
                            { id: 'grievance', label: 'Grievance Reports', icon: FileText, color: 'blue', desc: 'Track formal complaints' },
                            { id: 'suggestion', label: 'Suggestions', icon: Building2, color: 'purple', desc: 'Community feedback' },
                            { id: 'criticism', label: 'Criticisms', icon: AlertCircle, color: 'red', desc: 'Critical alerts' },
                        ].map((btn) => {
                            const isActive = activeReportSubTab === btn.id;
                            const colors = {
                                blue: isActive ? 'bg-blue-600 text-white ring-blue-200' : 'bg-white text-slate-600 hover:bg-blue-50/50',
                                purple: isActive ? 'bg-purple-600 text-white ring-purple-200' : 'bg-white text-slate-600 hover:bg-purple-50/50',
                                red: isActive ? 'bg-red-600 text-white ring-red-200' : 'bg-white text-slate-600 hover:bg-red-50/50',
                            };
                            const iconColors = {
                                blue: isActive ? 'text-white' : 'text-blue-500',
                                purple: isActive ? 'text-white' : 'text-purple-500',
                                red: isActive ? 'text-white' : 'text-red-500',
                            };

                            return (
                                <button
                                    key={btn.id}
                                    onClick={() => setActiveReportSubTab(btn.id)}
                                    className={cn(
                                        "relative flex flex-col items-center justify-center p-6 rounded-3xl transition-all duration-300 border h-40 group",
                                        isActive
                                            ? "shadow-2xl scale-[1.02] border-transparent ring-4"
                                            : "border-slate-200 shadow-sm hover:shadow-md hover:scale-[1.01] hover:border-slate-300",
                                        colors[btn.color]
                                    )}
                                >
                                    <div className={cn(
                                        "p-3 rounded-2xl mb-3 transition-colors duration-300",
                                        isActive ? "bg-white/20" : "bg-slate-100 group-hover:bg-white"
                                    )}>
                                        <btn.icon className={cn("h-8 w-8", iconColors[btn.color])} />
                                    </div>
                                    <div className="text-center">
                                        <h4 className="font-black text-lg uppercase tracking-tight">{btn.label}</h4>
                                        <p className={cn("text-[10px] font-medium opacity-80 mt-1 uppercase tracking-widest")}>
                                            {btn.desc}
                                        </p>
                                    </div>
                                    {isActive && (
                                        <div className="absolute -bottom-2 flex justify-center w-full">
                                            <div className="h-1.5 w-8 rounded-full bg-white shadow-sm" />
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    <Separator className="max-w-5xl mx-auto opacity-50" />

                    {/* Active Report View */}
                    <div className="transition-all duration-500">
                        {activeReportSubTab === 'grievance' && (
                            <GrievanceWorkflowReports
                                onStatsUpdate={setWorkflowStats}
                                openReportCode={openGReportCode}
                                onReportCodeHandled={() => setOpenGReportCode('')}
                            />
                        )}
                        {activeReportSubTab === 'suggestion' && (
                            <SuggestionReports
                                openReportCode={openSReportCode}
                                onReportCodeHandled={() => setOpenSReportCode('')}
                            />
                        )}
                        {activeReportSubTab === 'criticism' && (
                            <CriticismReports
                                openReportCode={openCReportCode}
                                onReportCodeHandled={() => setOpenCReportCode('')}
                            />
                        )}
                    </div>
                </div>
            )}

            {/* ─── RSS News Feed ─── */}
            {navbarPlatform === 'rss' && (
                <div className="mx-2 mt-3 space-y-3">
                    <style>{`
                        .mentions-masonry { column-gap: 1rem; column-count: 1; }
                        @media (min-width: 768px)  { .mentions-masonry { column-count: 2; } }
                        @media (min-width: 1280px) { .mentions-masonry { column-count: 3; } }
                        .mentions-masonry > .mention-cell {
                            break-inside: avoid;
                            -webkit-column-break-inside: avoid;
                            page-break-inside: avoid;
                            display: block;
                            margin-bottom: 1rem;
                        }
                    `}</style>
                    {/* RSS Sub Tabs */}
                    <div className="flex gap-4 border-b border-slate-200 pb-1 mb-2">
                        <button
                            type="button"
                            onClick={() => setRssSubTab('articles')}
                            className={`pb-2 text-xs font-semibold border-b-2 transition-all ${rssSubTab === 'articles' ? 'border-violet-600 text-violet-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Articles Feed
                        </button>
                        <button
                            type="button"
                            onClick={() => setRssSubTab('keywords')}
                            className={`pb-2 text-xs font-semibold border-b-2 transition-all ${rssSubTab === 'keywords' ? 'border-violet-600 text-violet-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        >
                            Keywords
                        </button>
                    </div>

                    {rssSubTab === 'articles' && (
                        <>
                            {/* Filter bar */}
                            <div className="flex items-center gap-2 flex-wrap bg-white border border-slate-200 rounded-xl px-4 py-3">
                        {/* Search */}
                        <div className="relative flex-1 min-w-[180px]">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Search articles..."
                                value={rssSearch}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setRssSearch(v);
                                    clearTimeout(rssSearchTimer.current);
                                    rssSearchTimer.current = setTimeout(() => {}, 0);
                                }}
                                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400"
                            />
                        </div>

                        {/* District */}
                        <select
                            value={rssDistrict}
                            onChange={(e) => setRssDistrict(e.target.value)}
                            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 bg-white"
                        >
                            <option value="all">All Districts{rssFacets.districts.length ? ` (${rssFacets.districts.length})` : ''}</option>
                            {rssFacets.districts.map(d => (
                                <option key={d} value={d}>{d}</option>
                            ))}
                        </select>

                        {/* Category */}
                        <select
                            value={rssCategory}
                            onChange={(e) => setRssCategory(e.target.value)}
                            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 bg-white"
                        >
                            <option value="all">All Categories</option>
                            {rssFacets.categories.map(c => (
                                <option key={c} value={c}>{String(c).replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
                            ))}
                        </select>

                        {/* Source type */}
                        <select
                            value={rssSourceType}
                            onChange={(e) => setRssSourceType(e.target.value)}
                            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 bg-white"
                        >
                            <option value="all">All Sources</option>
                            <option value="rss">Web Articles</option>
                            <option value="keyword_search">Search</option>
                            <option value="domain">Web</option>
                        </select>

                        {/* Sentiment — matches the verdict printed on the card,
                            which reads `article.sentiment` (see RssNewsCard and
                            newsSentimentClause on the server). Applied
                            server-side: the feed is paged 20 at a time, so
                            filtering here would only narrow the page you happen
                            to have scrolled to. */}
                        <select
                            value={rssSentiment}
                            onChange={(e) => setRssSentiment(e.target.value)}
                            aria-label="Filter articles by sentiment"
                            className={cn(
                                'text-xs border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400',
                                rssSentiment === 'positive' ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                    : rssSentiment === 'negative' ? 'border-rose-300 bg-rose-50 text-rose-700'
                                        : rssSentiment === 'neutral' ? 'border-slate-300 bg-slate-50 text-slate-700'
                                            : 'border-slate-200 bg-white'
                            )}
                        >
                            <option value="all">All Sentiment</option>
                            <option value="positive">Positive</option>
                            <option value="neutral">Neutral</option>
                            <option value="negative">Negative</option>
                        </select>

                        {/* Count + Refresh */}
                        <div className="ml-auto flex items-center gap-2">
                            {!rssLoading && rssPagination.total > 0 && (
                                <span className="text-xs text-slate-500 whitespace-nowrap">
                                    <span className="font-semibold text-slate-700">{rssPagination.total}</span> articles
                                </span>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => fetchNewsArticles(1, false)}
                                disabled={rssLoading}
                                className="h-7 gap-1.5 text-xs text-violet-600 border-violet-200 hover:bg-violet-50"
                            >
                                <RefreshCw className={cn('h-3 w-3', rssLoading && 'animate-spin')} />
                                Refresh
                            </Button>
                            {rssHasFilters && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setRssDistrict('all');
                                        setRssCategory('all');
                                        setRssSourceType('all');
                                        setRssSentiment('all');
                                        setRssSearch('');
                                    }}
                                    className="h-7 gap-1 text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 border border-slate-200 rounded-lg px-2 transition-colors"
                                >
                                    <X className="h-3 w-3" />
                                    Clear Filters
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Skeleton loading */}
                    {rssLoading && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="bg-white rounded-xl border border-slate-200 h-[175px] flex overflow-hidden animate-pulse">
                                    <div className="w-44 shrink-0 bg-slate-100" />
                                    <div className="flex-1 p-4 space-y-3">
                                        <div className="h-4 bg-slate-100 rounded w-3/4" />
                                        <div className="h-3 bg-slate-100 rounded w-full" />
                                        <div className="h-3 bg-slate-100 rounded w-2/3" />
                                        <div className="h-3 bg-slate-100 rounded w-1/2 mt-auto" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Empty state */}
                    {!rssLoading && rssArticles.length === 0 && (
                        <div className="text-center py-16 bg-white rounded-xl border-2 border-dashed border-slate-200">
                            <Rss className="h-12 w-12 mx-auto text-slate-200 mb-3" />
                            <h3 className="text-sm font-semibold text-slate-700">No news articles found</h3>
                            <p className="text-xs text-slate-400 mt-1">
                                {rssHasFilters
                                    ? 'Try clearing some filters.'
                                    : 'Start the Blura Engine to populate news. See Blura-Engine/political_main.py (entry script for the Telangana RSS feeds).'}
                            </p>
                            {rssHasFilters && (
                                <Button variant="outline" size="sm" className="mt-3 text-xs"
                                    onClick={() => { setRssSearch(''); setRssDistrict('all'); setRssCategory('all'); setRssSourceType('all'); setRssSentiment('all'); }}>
                                    Clear Filters
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Article list */}
                    {!rssLoading && rssArticles.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
                            {rssArticles.map((article) => (
                                <RssNewsCard
                                    key={article._id || article.source_url}
                                    article={article}
                                    canManage={canManageSpecialGrievanceUi}
                                    onDelete={handleDeleteRssArticle}
                                    onSentimentChange={handleRssArticleSentiment}
                                />
                            ))}

                            {/* Load more */}
                            {rssPagination.page < rssPagination.pages && (
                                <div className="flex justify-center py-4">
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            const nextPage = rssPagination.page + 1;
                                            setRssPagination(p => ({ ...p, page: nextPage }));
                                            fetchNewsArticles(nextPage, true);
                                        }}
                                        disabled={rssLoadingMore}
                                        className="gap-2 text-sm text-violet-600 border-violet-200 hover:bg-violet-50"
                                    >
                                        {rssLoadingMore
                                            ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading...</>
                                            : <>Load More · Page {rssPagination.page + 1} of {rssPagination.pages}</>
                                        }
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                    </>
                    )}

                    {rssSubTab === 'keywords' && (
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 space-y-6">
                            {/* Header Section */}
                            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                                <h3 className="text-base font-bold text-slate-800">Keywords</h3>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => {
                                            setRssLanguageError('');
                                            setNewRssLanguageName('');
                                            setNewRssLanguageCode('');
                                            setIsAddRssLanguageOpen(true);
                                        }}
                                        className="border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold text-xs flex items-center gap-1"
                                    >
                                        <span className="text-sm font-light">+</span> Language
                                    </Button>
                                    <Button
                                        type="button"
                                        onClick={() => {
                                            setRssKeywordError('');
                                            setRssKeywordSuccess('');
                                            setNewRssKeyword('');
                                            // Default the form to the first available language so the
                                            // dropdown is never stuck on a code that was deleted.
                                            setNewRssKeywordLang(rssLanguages[0]?.code || 'en');
                                            setIsAddRssKeywordOpen(true);
                                        }}
                                        className="bg-[#0f172a] hover:bg-slate-800 text-white font-semibold text-xs flex items-center gap-1"
                                    >
                                        <span className="text-sm font-light">+</span> Add
                                    </Button>
                                </div>
                            </div>

                            {/* Keywords List Section */}
                            <div className="space-y-6">
                                {rssKeywordsLoading ? (
                                    <div className="flex items-center gap-2 text-xs text-slate-500 py-4">
                                        <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                                        Loading keywords...
                                    </div>
                                ) : rssLanguages.length === 0 ? (
                                    <div className="text-xs text-slate-400 italic py-4">
                                        No languages configured yet. Use “+ Language” to add one.
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        {/* One section per DB-managed language. Colours cycle so each
                                            language reads as its own group regardless of how many exist. */}
                                        {rssLanguages.map((lang, idx) => {
                                            const palette = [
                                                { chip: 'bg-violet-50 text-violet-700 border-violet-100', x: 'text-violet-400 hover:text-violet-600' },
                                                { chip: 'bg-amber-50 text-amber-700 border-amber-100', x: 'text-amber-400 hover:text-amber-600' },
                                                { chip: 'bg-emerald-50 text-emerald-700 border-emerald-100', x: 'text-emerald-400 hover:text-emerald-600' },
                                                { chip: 'bg-sky-50 text-sky-700 border-sky-100', x: 'text-sky-400 hover:text-sky-600' },
                                                { chip: 'bg-rose-50 text-rose-700 border-rose-100', x: 'text-rose-400 hover:text-rose-600' },
                                                { chip: 'bg-indigo-50 text-indigo-700 border-indigo-100', x: 'text-indigo-400 hover:text-indigo-600' },
                                            ];
                                            const c = palette[idx % palette.length];
                                            const langKeywords = rssKeywords.filter(k => k.language === lang.code);
                                            return (
                                                <div key={lang.code}>
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{lang.label} Keywords</h4>
                                                        <span className="text-[10px] text-slate-300">({langKeywords.length})</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteRssLanguage(lang)}
                                                            title={`Delete language "${lang.label}"`}
                                                            className="ml-auto text-[10px] font-semibold text-slate-400 hover:text-red-600 inline-flex items-center gap-1 focus:outline-none"
                                                        >
                                                            <span className="font-bold">&times;</span> Remove language
                                                        </button>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {langKeywords.map((kw) => (
                                                            <span key={kw.keyword} className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border font-medium ${c.chip}`}>
                                                                {kw.keyword}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteRssKeyword(kw.keyword)}
                                                                    className={`ml-1 font-bold focus:outline-none ${c.x}`}
                                                                >
                                                                    &times;
                                                                </button>
                                                            </span>
                                                        ))}
                                                        {langKeywords.length === 0 && (
                                                            <span className="text-xs text-slate-350 italic">No {lang.label} keywords found</span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ─── YouTube LIVE (standalone feed — never merged into "All") ─── */}
            {navbarPlatform === 'ytlive' && <YouTubeLiveTab />}

            {/* ─── Tab Layout + Content ─── */}
            {!isReportsTab && navbarPlatform !== 'rss' && navbarPlatform !== 'ytlive' && (
                <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setGrievances([]); }} className="w-full mx-2">
                    <TabsContent value={activeTab} className="mt-4 px-2">
                        <div
                            ref={splitPaneRef}
                            className="grid grid-cols-1 gap-4 items-start"
                        >
                            {/* 60%: Grievances */}
                            <div className="space-y-4 relative z-10">
                                {loading ? (
                                    <div className="flex flex-col items-center justify-center p-12 bg-white rounded-lg border border-slate-200">
                                        <Loader2 className="h-8 w-8 animate-spin text-slate-400 mb-3" />
                                        <p className="text-sm text-muted-foreground">Loading grievances...</p>
                                    </div>
                                ) : grievances.length === 0 ? (
                                    <div className="text-center p-12 bg-white rounded-lg border-2 border-dashed border-slate-200">
                                        <FileText className="h-12 w-12 mx-auto text-slate-300 mb-3" />
                                        <h3 className="text-sm font-semibold text-slate-900">No grievances found</h3>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {hasActiveFilters
                                                ? 'Try adjusting your filters or search terms.'
                                                : 'Add source accounts and fetch grievances to get started.'}
                                        </p>
                                        {hasActiveFilters && (
                                            <Button variant="outline" size="sm" onClick={clearFilters} className="mt-3">
                                                Clear Filters
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {/* Sentiment filter pills + counts
                                          *
                                          * Counts come from the server's `pagination.sentiment_counts`
                                          * payload — totals across the full filtered set, not just the
                                          * rows currently loaded. Falls back to a quick client tally
                                          * only while the first page is still in flight so the pills
                                          * never render as 0/0/0.
                                          */}
                                        {(() => {
                                            const serverCounts = pagination.sentiment_counts;
                                            let counts;
                                            if (serverCounts) {
                                                // sentiment_counts is the breakdown ignoring the active
                                                // sentiment filter, so "All" is their sum — this keeps every
                                                // pill's count stable no matter which sentiment is selected.
                                                const positive = serverCounts.positive || 0;
                                                const negative = serverCounts.negative || 0;
                                                const neutral  = serverCounts.neutral  || 0;
                                                counts = { all: positive + negative + neutral, positive, negative, neutral };
                                            } else {
                                                counts = { all: displayedGrievances.length, positive: 0, neutral: 0, negative: 0 };
                                                displayedGrievances.forEach((g) => {
                                                    const s = String(g?.analysis?.sentiment || '').toLowerCase();
                                                    if (s === 'positive') counts.positive += 1;
                                                    else if (s === 'negative') counts.negative += 1;
                                                    else counts.neutral += 1;
                                                });
                                            }
                                            const pills = [
                                                { id: null,        label: 'All',       n: counts.all,      active: 'bg-slate-900 text-white border-slate-900',  idle: 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',       dot: 'bg-slate-400' },
                                                { id: 'positive',  label: 'Positive',  n: counts.positive, active: 'bg-emerald-600 text-white border-emerald-600', idle: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100', dot: 'bg-emerald-500' },
                                                { id: 'neutral',   label: 'Neutral',   n: counts.neutral,  active: 'bg-slate-500 text-white border-slate-500',     idle: 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100',         dot: 'bg-slate-500' },
                                                { id: 'negative',  label: 'Negative',  n: counts.negative, active: 'bg-rose-600 text-white border-rose-600',       idle: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100',             dot: 'bg-rose-500' },
                                            ];
                                            return (
                                                <div className="flex items-center justify-between gap-3 flex-wrap px-1">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        {pills.map((p) => {
                                                            const isActive = (sentimentFilter || null) === p.id;
                                                            return (
                                                                <button
                                                                    key={String(p.id)}
                                                                    type="button"
                                                                    onClick={() => updateURLParams({ sentiment: p.id || null })}
                                                                    className={cn(
                                                                        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold uppercase tracking-wider transition-all duration-150 active:scale-[0.97]',
                                                                        isActive ? p.active : p.idle
                                                                    )}
                                                                >
                                                                    <span className={cn('h-2 w-2 rounded-full', p.dot)} />
                                                                    {p.label}
                                                                    <span className={cn(
                                                                        'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold',
                                                                        isActive ? 'bg-white/20 text-white' : 'bg-slate-900/5 text-slate-700'
                                                                    )}>
                                                                        {p.n}
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        {/* View-mode toggle (grid / list) */}
                                                        <div className="inline-flex items-center rounded-md border border-slate-200 bg-white overflow-hidden">
                                                            <button
                                                                type="button"
                                                                onClick={() => setViewMode('list')}
                                                                title="List view"
                                                                className={cn(
                                                                    'px-2.5 py-1.5 text-xs font-semibold transition-colors',
                                                                    viewMode === 'list' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                                                                )}
                                                            >
                                                                <LayoutList className="h-3.5 w-3.5" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setViewMode('grid')}
                                                                title="Grid view"
                                                                className={cn(
                                                                    'px-2.5 py-1.5 text-xs font-semibold transition-colors border-l border-slate-200',
                                                                    viewMode === 'grid' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                                                                )}
                                                            >
                                                                <LayoutGrid className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                        <span className="text-xs text-muted-foreground">
                                                            Showing {displayedGrievances.length}{pagination.total ? ` of ${pagination.total.toLocaleString()}` : ''} mentions
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* ─── Single mixed feed; cards self-colour by sentiment ───
                                          *
                                          * Grid mode uses a CSS multi-column (masonry) layout instead of
                                          * CSS Grid. CSS Grid forces every cell in a row to the row's max
                                          * height, which leaves short cards with a tall card next to them
                                          * showing dead whitespace below. Columns pack each card flush
                                          * against the previous one, so the feed reads like a Pinterest
                                          * / X-style stream — no gaps between cards.
                                          */}
                                        {viewMode === 'grid' ? (
                                            <>
                                                <style>{`
                                                    .mentions-masonry { column-gap: 1rem; column-count: 1; }
                                                    @media (min-width: 768px)  { .mentions-masonry { column-count: 2; } }
                                                    @media (min-width: 1280px) { .mentions-masonry { column-count: 3; } }
                                                    .mentions-masonry > .mention-cell {
                                                        break-inside: avoid;
                                                        -webkit-column-break-inside: avoid;
                                                        page-break-inside: avoid;
                                                        display: block;
                                                        margin-bottom: 1rem;
                                                    }
                                                `}</style>
                                                <div className="mentions-masonry">
                                                    {displayedGrievances.map((grievance) => (
                                                        <div key={grievance.id} className="mention-cell">
                                                            <GrievanceCard
                                                                grievance={grievance}
                                                                onAction={handleAction}
                                                                getProxiedMediaUrl={getProxiedMediaUrl}
                                                                downloadState={downloadStates[grievance.id]}
                                                                isSelected={selectedGrievance?.id === grievance.id && window.innerWidth >= 1280}
                                                                isActioned={actionedGrievanceIds.includes(grievance.id)}
                                                                compact={true}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="space-y-4">
                                                {displayedGrievances.map((grievance) => (
                                                    <GrievanceCard
                                                        key={grievance.id}
                                                        grievance={grievance}
                                                        onAction={handleAction}
                                                        getProxiedMediaUrl={getProxiedMediaUrl}
                                                        downloadState={downloadStates[grievance.id]}
                                                        isSelected={selectedGrievance?.id === grievance.id && window.innerWidth >= 1280}
                                                        isActioned={actionedGrievanceIds.includes(grievance.id)}
                                                        compact={true}
                                                    />
                                                ))}
                                            </div>
                                        )}

                                        {/* Load More */}
                                        {pagination.hasMore && (
                                            <div className="flex justify-center py-4">
                                                <Button
                                                    variant="outline"
                                                    onClick={() => fetchGrievances(pagination.nextCursor)}
                                                    disabled={loadingMore}
                                                    className="gap-2"
                                                >
                                                    {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                                                    Load More
                                                </Button>
                                            </div>
                                        )}


                                    </div>
                                )}
                            </div>


                        </div>
                    </TabsContent>
                </Tabs>
            )}

            {/* Criticism Popup */}
            {criticismGrievance && (
                <CriticismPopup
                    grievance={criticismGrievance}
                    onClose={() => setCriticismGrievance(null)}
                    onReportCreated={handleCriticismReportCreated}
                    userName={userName}
                />
            )}

            {/* Grievance Workflow Popup */}
            {grievancePopupGrievance && (
                <GrievancePopup
                    grievance={grievancePopupGrievance}
                    onClose={() => setGrievancePopupGrievance(null)}
                    onReportCreated={handleGrievanceReportCreated}
                    onAction={handleAction}
                    userName={userName}
                />
            )}

            {/* Grievance Status Change Popup (ESCALATED / CLOSED) */}
            {statusChangePopup && (
                <GrievanceStatusChangePopup
                    grievance={statusChangePopup.grievance}
                    targetStatus={statusChangePopup.targetStatus}
                    onClose={() => setStatusChangePopup(null)}
                    onStatusUpdated={handleStatusChangeComplete}
                    userName={userName}
                />
            )}

            {/* Query Workflow Popup */}
            {queryPopupGrievance && (
                <QueryPopup
                    grievance={queryPopupGrievance}
                    onClose={() => setQueryPopupGrievance(null)}
                    onReportCreated={handleQueryReportCreated}
                    userName={userName}
                />
            )}

            {/* Suggestion Popup */}
            {suggestionPopupGrievance && (
                <SuggestionPopup
                    grievance={suggestionPopupGrievance}
                    onClose={() => setSuggestionPopupGrievance(null)}
                    onReportCreated={handleSuggestionReportCreated}
                    userName={userName}
                />
            )}

            {/* ═══════════════════════════════════════════════════════════ */}
            {/*                        DIALOGS                            */}
            {/* ═══════════════════════════════════════════════════════════ */}

            {/* Excel Sheet Modal */}
            <ExcelSheetModal
                open={showExcelModal}
                onOpenChange={setShowExcelModal}
                rows={excelRows}
                setRows={setExcelRows}
                modalPos={modalPos}
                setModalPos={setModalPos}
                modalSize={modalSize}
                setModalSize={setModalSize}
                isDragging={isDraggingModal}
                setIsDragging={setIsDraggingModal}
                dragOffset={dragOffset}
                setDragOffset={setDragOffset}
                isResizing={isResizingModal}
                setIsResizing={setIsResizingModal}
                modalRef={modalRef}
                preFilledRow={preFilledRow}
                setPreFilledRow={setPreFilledRow}
                userName={userName}
            />

            {/* Add Source Dialog */}
            <Dialog open={sentimentLeadersOpen} onOpenChange={setSentimentLeadersOpen}>
                <DialogContent className="max-w-5xl h-[85vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Top Sentiment Leaders</DialogTitle>
                        <DialogDescription>
                            Top 100 profiles across all grievance platforms, ranked by how many positive, negative, or neutral posts they have published.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
                        <div className="flex gap-2 flex-wrap">
                            {[
                                { key: 'positive', label: 'Positive', tone: 'bg-emerald-600 text-white border-emerald-600' },
                                { key: 'negative', label: 'Negative', tone: 'bg-rose-600 text-white border-rose-600' },
                                { key: 'neutral', label: 'Neutral', tone: 'bg-slate-500 text-white border-slate-500' }
                            ].map((tab) => {
                                const active = sentimentLeadersTab === tab.key;
                                return (
                                    <Button
                                        key={tab.key}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setSentimentLeadersTab(tab.key)}
                                        className={active ? tab.tone : 'bg-white'}
                                    >
                                        {tab.label}
                                        <span className="ml-1 opacity-80">({sentimentLeaders[tab.key]?.length || 0})</span>
                                    </Button>
                                );
                            })}
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:ml-auto w-full sm:w-auto">
                            <Select value={sentimentLeadersPlatform} onValueChange={setSentimentLeadersPlatform}>
                                <SelectTrigger className="w-full sm:w-44 h-10 text-xs font-medium">
                                    <SelectValue placeholder="All Platforms" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Platforms</SelectItem>
                                    <SelectItem value="x">X (Twitter)</SelectItem>
                                    <SelectItem value="facebook">Facebook</SelectItem>
                                    <SelectItem value="instagram">Instagram</SelectItem>
                                    <SelectItem value="youtube">YouTube</SelectItem>
                                </SelectContent>
                            </Select>

                            <div className="relative w-full sm:w-72">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                            <input
                                type="text"
                                value={sentimentLeadersSearch}
                                onChange={(e) => setSentimentLeadersSearch(e.target.value)}
                                placeholder="Search handle, name, platform..."
                                className="w-full bg-white border border-slate-200 rounded-md pl-8 pr-8 py-2 text-xs font-medium text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 placeholder:text-slate-400"
                            />
                            {sentimentLeadersSearch && (
                                <button
                                    type="button"
                                    onClick={() => setSentimentLeadersSearch('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto border rounded-xl bg-white">
                        {sentimentLeadersLoading ? (
                            <div className="h-64 flex items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                            </div>
                        ) : leaderRows.length === 0 ? (
                            <div className="h-64 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                                <Users className="h-8 w-8 opacity-30" />
                                <p>No profiles found for this sentiment.</p>
                            </div>
                        ) : (
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-slate-50 border-b z-10">
                                    <tr>
                                        <th className="text-left px-4 py-3 font-semibold text-slate-700">#</th>
                                        <th className="text-left px-4 py-3 font-semibold text-slate-700">Profile</th>
                                        <th className="text-left px-4 py-3 font-semibold text-slate-700">Platform</th>
                                        <th className="text-center px-4 py-3 font-semibold text-slate-700">Posts</th>
                                        <th className="text-center px-4 py-3 font-semibold text-slate-700">Latest Post</th>
                                        <th className="text-right px-4 py-3 font-semibold text-slate-700">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {leaderRows.map((row) => (
                                        <tr key={`${row.platform}-${row.handle}`} className="border-b last:border-b-0 hover:bg-slate-50/70">
                                            <td className="px-4 py-3 font-semibold text-slate-500">{row.rank}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <Avatar className="h-9 w-9 border border-slate-200">
                                                        <AvatarImage src={row.profile_image_url || ''} alt={row.display_name || row.handle} />
                                                        <AvatarFallback>{String(row.display_name || row.handle || '?').charAt(0).toUpperCase()}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <div className="font-semibold text-slate-900 truncate">
                                                            {row.display_name || row.handle}
                                                        </div>
                                                        <div className="text-slate-500 truncate">
                                                            @{String(row.handle || '').replace(/^@/, '')}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge variant="outline" className="capitalize">
                                                    {row.platform}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 text-center font-bold text-slate-900">{row.post_count}</td>
                                            <td className="px-4 py-3 text-center text-slate-500">
                                                {row.latest_post_date ? format(new Date(row.latest_post_date), 'MMM d, h:mm a') : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => openSentimentLeaderPosts(row)}
                                                >
                                                    View Posts
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={showAddSource} onOpenChange={setShowAddSource}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Plus className="h-5 w-5" /> Add Government Account
                        </DialogTitle>
                        <DialogDescription>
                            Add an X (Twitter) or Facebook government account to monitor for tagged grievances.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Platform</Label>
                            <Select value={addSourcePlatform} onValueChange={setAddSourcePlatform}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="x">X (Twitter)</SelectItem>
                                    <SelectItem value="facebook">Facebook</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>{addSourcePlatform === 'x' ? 'Twitter Handle' : 'Facebook Page ID/URL'}</Label>
                            <Input
                                placeholder={addSourcePlatform === 'x' ? '@government_handle' : 'page-id or URL'}
                                value={addSourceHandle}
                                onChange={(e) => setAddSourceHandle(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                {addSourcePlatform === 'x'
                                    ? 'Enter the X handle without @ symbol'
                                    : 'Enter the Facebook page ID or URL slug'}
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>Department <span className="text-muted-foreground">(optional)</span></Label>
                            <Input
                                placeholder="e.g., Police Department"
                                value={addSourceDept}
                                onChange={(e) => setAddSourceDept(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAddSource(false)}>Cancel</Button>
                        <Button onClick={handleAddSource} disabled={addingSource || !addSourceHandle.trim()}>
                            {addingSource ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Adding...</> : 'Add Source'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Fetch Date Range Dialog */}
            <Dialog open={!!fetchDateDialog} onOpenChange={(open) => { if (!open) setFetchDateDialog(null); }}>
                <DialogContent className="sm:max-w-fit">
                    <DialogHeader>
                        <DialogTitle>Fetch Grievances for {fetchDateDialog?.handle}</DialogTitle>
                        <DialogDescription>
                            Optionally select a date range to fetch historical grievances, or fetch recent ones.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <div className="flex justify-center">
                            <CalendarComponent
                                mode="range"
                                selected={fetchDateRange}
                                onSelect={setFetchDateRange}
                                numberOfMonths={2}
                            />
                        </div>
                        {fetchDateRange.from && (
                            <div className="text-center text-sm text-muted-foreground mt-2">
                                {format(fetchDateRange.from, 'LLL dd, y')}
                                {fetchDateRange.to && ` – ${format(fetchDateRange.to, 'LLL dd, y')}`}
                            </div>
                        )}
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => { setFetchDateDialog(null); setFetchDateRange({ from: null, to: null }); }}>Cancel</Button>
                        <Button variant="outline" onClick={() => {
                            if (fetchDateDialog) handleFetchForSource(fetchDateDialog);
                            setFetchDateRange({ from: null, to: null });
                        }}>
                            Fetch Recent
                        </Button>
                        <Button onClick={() => {
                            if (fetchDateDialog && fetchDateRange.from) {
                                handleFetchForSource(
                                    fetchDateDialog,
                                    fetchDateRange.from.toISOString(),
                                    fetchDateRange.to?.toISOString()
                                );
                            }
                            setFetchDateRange({ from: null, to: null });
                        }} disabled={!fetchDateRange.from}>
                            Fetch by Date
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Add RSS Relevance Keyword Dialog */}
            <Dialog open={isAddRssKeywordOpen} onOpenChange={setIsAddRssKeywordOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add Relevance Keyword</DialogTitle>
                        <DialogDescription>
                            The scraper engine will monitor these keywords to match and save relevant articles.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleAddRssKeyword} className="space-y-4">
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">
                                    Keyword Text <span className="font-normal text-slate-400">(add several at once, comma-separated)</span>
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. kcr, kaleshwaram, dharani"
                                    value={newRssKeyword}
                                    onChange={(e) => setNewRssKeyword(e.target.value)}
                                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400"
                                    required
                                />
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">Language</label>
                                <select
                                    value={newRssKeywordLang}
                                    onChange={(e) => setNewRssKeywordLang(e.target.value)}
                                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/30"
                                >
                                    {rssLanguages.length === 0 ? (
                                        <option value="">No languages — add one first</option>
                                    ) : (
                                        rssLanguages.map((lang) => (
                                            <option key={lang.code} value={lang.code}>{lang.label}</option>
                                        ))
                                    )}
                                </select>
                            </div>
                        </div>

                        {rssKeywordError && (
                            <div className="p-3 text-xs bg-red-50 border border-red-150 text-red-700 rounded-lg">
                                {rssKeywordError}
                            </div>
                        )}
                        {rssKeywordSuccess && (
                            <div className="p-3 text-xs bg-green-50 border border-green-150 text-green-700 rounded-lg">
                                {rssKeywordSuccess}
                            </div>
                        )}

                        <DialogFooter className="gap-2 sm:gap-0">
                            <Button type="button" variant="outline" size="sm" onClick={() => setIsAddRssKeywordOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" size="sm" className="bg-[#0f172a] hover:bg-slate-800 text-white font-semibold">
                                Add Keyword
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Add Language */}
            <Dialog open={isAddRssLanguageOpen} onOpenChange={setIsAddRssLanguageOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add Language</DialogTitle>
                        <DialogDescription>
                            Add a language bucket that keywords can be grouped under. It appears in the keyword form and as its own section.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleAddRssLanguage} className="space-y-4">
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">Language Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Hindi"
                                    value={newRssLanguageName}
                                    onChange={(e) => setNewRssLanguageName(e.target.value)}
                                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400"
                                    required
                                />
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">
                                    Code <span className="font-normal text-slate-400">(optional — auto-generated from the name)</span>
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. hi"
                                    value={newRssLanguageCode}
                                    onChange={(e) => setNewRssLanguageCode(e.target.value)}
                                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400"
                                />
                                <p className="text-[10px] text-slate-400 mt-1">Short identifier stored on each keyword. Lowercase letters/numbers only.</p>
                            </div>
                        </div>

                        {rssLanguageError && (
                            <div className="p-3 text-xs bg-red-50 border border-red-150 text-red-700 rounded-lg">
                                {rssLanguageError}
                            </div>
                        )}

                        <DialogFooter className="gap-2 sm:gap-0">
                            <Button type="button" variant="outline" size="sm" onClick={() => setIsAddRssLanguageOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" size="sm" className="bg-[#0f172a] hover:bg-slate-800 text-white font-semibold">
                                Add Language
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Delete Source Confirmation */}
            <Dialog open={!!deleteConfirmSource} onOpenChange={(open) => { if (!open) setDeleteConfirmSource(null); }}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="text-red-600">Remove Source</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to remove <strong>{deleteConfirmSource?.handle}</strong>?
                            Existing grievances will not be deleted.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteConfirmSource(null)}>Cancel</Button>
                        <Button variant="destructive" onClick={() => handleDeleteSource(deleteConfirmSource)}>Remove</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Status Update Dialog */}
            <Dialog open={isStatusOpen} onOpenChange={setIsStatusOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Update Workflow Status</DialogTitle>
                        <DialogDescription>
                            Change the workflow status for complaint {selectedGrievance?.complaint_code || selectedGrievance?.id?.substring(0, 8)}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-3">
                        {selectedGrievance && (
                            <div className="bg-slate-50 rounded-lg p-3 text-sm">
                                <span className="text-muted-foreground">Current status: </span>
                                <span className="font-medium capitalize">{(selectedGrievance.workflow_status || 'received').replace(/_/g, ' ')}</span>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label>New Status</Label>
                            <Select value={newStatus} onValueChange={setNewStatus}>
                                <SelectTrigger><SelectValue placeholder="Select Status" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="received">Received (Pending)</SelectItem>
                                    <SelectItem value="reviewed">Reviewed</SelectItem>
                                    <SelectItem value="action_taken">Action Taken</SelectItem>
                                    <SelectItem value="closed">Closed (Resolved)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Remarks / Note</Label>
                            <Textarea
                                placeholder="Add a note about this status update..."
                                value={statusUpdateNote}
                                onChange={(e) => setStatusUpdateNote(e.target.value)}
                                rows={3}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsStatusOpen(false)}>Cancel</Button>
                        <Button onClick={handleUpdateStatus} disabled={updatingStatus}>
                            {updatingStatus ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Update Status
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Convert to FIR Dialog */}
            <Dialog open={isFirConfirmOpen} onOpenChange={setIsFirConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-red-600 flex items-center gap-2">
                            <AlertCircle className="h-5 w-5" />
                            Confirm FIR Conversion
                        </DialogTitle>
                        <DialogDescription>
                            This will mark the grievance as "Converted to FIR" and log the timestamp.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-3">
                        <div className="bg-red-50 p-3 rounded-lg border border-red-200">
                            <p className="text-sm text-red-800">
                                <strong>Warning:</strong> This action initiates the formal FIR process. Ensure all preliminary reviews are complete before proceeding.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>FIR Number <span className="text-muted-foreground">(optional)</span></Label>
                            <Input
                                placeholder="Enter FIR number if available"
                                value={firNumber}
                                onChange={(e) => setFirNumber(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Official Remarks</Label>
                            <Textarea
                                placeholder="Enter reason or reference for FIR conversion..."
                                value={firNote}
                                onChange={(e) => setFirNote(e.target.value)}
                                rows={3}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsFirConfirmOpen(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={handleConvertToFir} disabled={updatingStatus}>
                            {updatingStatus ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Convert to FIR
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Details Modal */}
            <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh]">
                    <DialogHeader>
                        <DialogTitle>Grievance Details</DialogTitle>
                    </DialogHeader>
                    {selectedGrievance && (
                        <ScrollArea className="max-h-[70vh] pr-4">
                            <div className="space-y-6">
                                {/* Info grid */}
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <InfoField label="Complaint Code" value={selectedGrievance.complaint_code || selectedGrievance.id?.substring(0, 8)} />
                                    <InfoField label="Platform" value={<span className="capitalize">{selectedGrievance.platform}</span>} />
                                    <InfoField label="Complainant" value={selectedGrievance.posted_by?.display_name || selectedGrievance.posted_by?.handle || selectedGrievance.complainant_phone || 'Unknown'} />
                                    <InfoField label="Date Received" value={selectedGrievance.post_date ? format(new Date(selectedGrievance.post_date), 'PPP p') : 'N/A'} />
                                    <InfoField label="Current Status" value={
                                        <Badge variant="outline" className="capitalize">
                                            {(selectedGrievance.workflow_status || 'received').replace(/_/g, ' ')}
                                        </Badge>
                                    } />
                                    <InfoField label="Escalation Count" value={selectedGrievance.escalation_count || 0} />
                                    {selectedGrievance.tagged_account && <InfoField label="Tagged Account" value={selectedGrievance.tagged_account} />}
                                    {selectedGrievance.fir_number && <InfoField label="FIR Number" value={selectedGrievance.fir_number} />}
                                </div>

                                {/* Content */}
                                <div>
                                    <h4 className="text-sm font-semibold text-slate-500 mb-2">Content</h4>
                                    <div className="p-4 bg-slate-50 rounded-lg text-sm whitespace-pre-wrap break-words border">
                                        {selectedGrievance.content?.full_text || selectedGrievance.content?.text || 'No content'}
                                    </div>
                                </div>

                                {/* Media */}
                                {selectedGrievance.content?.media?.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-semibold text-slate-500 mb-2">Media ({selectedGrievance.content.media.length})</h4>
                                        <div className="grid grid-cols-3 gap-2">
                                            {selectedGrievance.content.media.map((m, i) => {
                                                const isVideo = m.type === 'video' || m.type === 'animated_gif';
                                                // For videos: use poster/preview images only (NOT the MP4 url).
                                                // For images: full candidate chain.
                                                const rawPosters = isVideo
                                                    ? [m.s3_preview, m.preview_url, m.preview].filter(Boolean)
                                                    : [m.s3_preview, m.s3_url, m.preview_url, m.preview, m.url, m.original_url].filter(Boolean);
                                                const rawVideos = isVideo
                                                    ? [m.s3_url, m.video_url, m.url, m.original_video_url, m.original_url].filter(Boolean)
                                                    : [];
                                                const proxiedPosters = rawPosters.map((u) => getProxiedMediaUrl(u)).filter(Boolean);
                                                const proxiedVideos = rawVideos.map((u) => getProxiedMediaUrl(u)).filter(Boolean);
                                                const posterAll = [...new Set([...rawPosters, ...proxiedPosters])];
                                                const videoAll = [...new Set([...rawVideos, ...proxiedVideos])];
                                                return (
                                                <div key={i} className="aspect-video rounded-lg overflow-hidden bg-slate-100 cursor-pointer border relative flex items-center justify-center group"
                                                    onClick={() => {
                                                        setSelectedMedia(m);
                                                        setVideoRefreshUrl(null);
                                                        setVideoRefreshing(false);
                                                        setIsMediaOpen(true);
                                                    }}>
                                                    {posterAll.length > 0 ? (
                                                        <img
                                                            src={posterAll[0]}
                                                            alt=""
                                                            data-fb-idx="0"
                                                            data-fb-list={posterAll.join('|')}
                                                            data-vid-list={videoAll.join('|')}
                                                            className="w-full h-full object-cover"
                                                            referrerPolicy="no-referrer"
                                                            onError={(e) => {
                                                                const list = (e.currentTarget.getAttribute('data-fb-list') || '').split('|').filter(Boolean);
                                                                const idx = parseInt(e.currentTarget.getAttribute('data-fb-idx') || '0', 10) + 1;
                                                                if (idx < list.length) {
                                                                    e.currentTarget.setAttribute('data-fb-idx', String(idx));
                                                                    e.currentTarget.src = list[idx];
                                                                    return;
                                                                }
                                                                // For videos, try to auto-poster from the actual video element
                                                                const vidList = (e.currentTarget.getAttribute('data-vid-list') || '').split('|').filter(Boolean);
                                                                if (isVideo && vidList.length) {
                                                                    e.currentTarget.style.display = 'none';
                                                                    const wrapper = e.currentTarget.parentElement;
                                                                    const existing = wrapper.querySelector('video.media-auto-poster');
                                                                    if (!existing) {
                                                                        const v = document.createElement('video');
                                                                        v.src = vidList[0];
                                                                        v.muted = true;
                                                                        v.playsInline = true;
                                                                        v.preload = 'metadata';
                                                                        v.className = 'media-auto-poster w-full h-full object-cover';
                                                                        v.setAttribute('referrerpolicy', 'no-referrer');
                                                                        v.onloadeddata = () => { try { v.currentTime = 0.1; } catch (_) {} };
                                                                        v.onerror = () => {
                                                                            v.style.display = 'none';
                                                                            const placeholder = wrapper.querySelector('.media-placeholder');
                                                                            if (placeholder) placeholder.style.display = 'flex';
                                                                        };
                                                                        wrapper.insertBefore(v, wrapper.firstChild);
                                                                    }
                                                                    return;
                                                                }
                                                                e.currentTarget.style.display = 'none';
                                                                const placeholder = e.currentTarget.parentElement.querySelector('.media-placeholder');
                                                                if (placeholder) placeholder.style.display = 'flex';
                                                            }}
                                                        />
                                                    ) : isVideo && videoAll.length > 0 ? (
                                                        <video
                                                            src={videoAll[0]}
                                                            className="w-full h-full object-cover media-auto-poster"
                                                            referrerPolicy="no-referrer"
                                                            muted
                                                            playsInline
                                                            preload="metadata"
                                                            onLoadedData={(e) => { try { e.currentTarget.currentTime = 0.1; } catch (_) {} }}
                                                            onError={(e) => {
                                                                e.currentTarget.style.display = 'none';
                                                                const placeholder = e.currentTarget.parentElement.querySelector('.media-placeholder');
                                                                if (placeholder) placeholder.style.display = 'flex';
                                                            }}
                                                        />
                                                    ) : null}
                                                    <div className="media-placeholder flex-col items-center justify-center text-slate-400 select-none" style={{ display: (posterAll.length > 0 || (isVideo && videoAll.length > 0)) ? 'none' : 'flex' }}>
                                                        {isVideo ? <VideoIcon className="h-6 w-6 mb-1" /> : <ImageOff className="h-6 w-6 mb-1" />}
                                                        <span className="text-[10px] font-medium uppercase tracking-wider">
                                                            {isVideo ? 'Video unavailable' : 'Image unavailable'}
                                                        </span>
                                                    </div>
                                                    {isVideo && (
                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none transition-colors group-hover:bg-black/40">
                                                            <div className="bg-black/70 rounded-full p-2.5 backdrop-blur-sm border border-white/40 shadow-lg">
                                                                <VideoIcon className="h-5 w-5 text-white fill-white" />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Workflow History */}
                                {selectedGrievance.workflow_history?.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-semibold text-slate-500 mb-2">Workflow History</h4>
                                        <div className="space-y-2">
                                            {selectedGrievance.workflow_history.map((h, i) => (
                                                <div key={i} className="text-sm border-l-2 border-slate-300 pl-3 py-1.5">
                                                    <div className="flex justify-between items-baseline">
                                                        <span className="font-medium capitalize text-slate-700">{(h.to || '').replace(/_/g, ' ')}</span>
                                                        <span className="text-xs text-muted-foreground">{h.at ? format(new Date(h.at), 'MMM d, h:mm a') : ''}</span>
                                                    </div>
                                                    {h.from && <span className="text-xs text-muted-foreground">From: {(h.from || '').replace(/_/g, ' ')}</span>}
                                                    {h.note && <p className="text-slate-600 text-xs mt-1">{h.note}</p>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Original URL */}
                                {(selectedGrievance.tweet_url || selectedGrievance.url) && (
                                    <div>
                                        <Button variant="outline" size="sm" className="gap-2" asChild>
                                            <a href={selectedGrievance.tweet_url || selectedGrievance.url} target="_blank" rel="noopener noreferrer">
                                                <ExternalLink className="h-4 w-4" /> View Original Post
                                            </a>
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    )}
                </DialogContent>
            </Dialog>

            {/* Fullscreen Media Preview */}
            <Dialog open={isMediaOpen} onOpenChange={setIsMediaOpen} modal={false}>
                <DialogContent
                    className="!flex w-screen h-screen max-w-none max-h-none p-0 bg-black/95 border-none rounded-none top-0 left-0 translate-x-0 translate-y-0 [&>button]:hidden"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onCloseAutoFocus={(e) => e.preventDefault()}
                >
                    <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
                        <button
                            type="button"
                            onClick={() => { setIsMediaOpen(false); setVideoRefreshUrl(null); setVideoRefreshing(false); }}
                            className="absolute top-4 right-4 z-50 rounded-full bg-black/50 p-2 text-white hover:bg-white/20 transition-colors"
                            aria-label="Close preview"
                        >
                            <X className="h-6 w-6" />
                        </button>
                        {selectedMedia && (
                            selectedMedia.type === 'video' || selectedMedia.type === 'animated_gif' ? (
                                <RobustVideoPlayer
                                    selectedMedia={selectedMedia}
                                    selectedGrievance={selectedGrievance}
                                    getProxiedMediaUrl={getProxiedMediaUrl}
                                    videoRefreshUrl={videoRefreshUrl}
                                    setVideoRefreshUrl={setVideoRefreshUrl}
                                    videoRefreshing={videoRefreshing}
                                    setVideoRefreshing={setVideoRefreshing}
                                    BACKEND_URL={BACKEND_URL}
                                />
                            ) : (
                                <FullscreenImage
                                    url={getProxiedMediaUrl(selectedMedia.url || selectedMedia.preview_url)}
                                    fallbackUrl={getProxiedMediaUrl(selectedMedia.preview_url || selectedMedia.url)}
                                    allUrls={[
                                        selectedMedia.s3_preview,
                                        selectedMedia.s3_url,
                                        selectedMedia.url,
                                        selectedMedia.preview_url,
                                        selectedMedia.preview,
                                        selectedMedia.original_url
                                    ].filter(Boolean).map(u => getProxiedMediaUrl(u)).filter(Boolean)}
                                />
                            )
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Grievance Analysis Details Modal */}
            <GrievanceAnalysisModal
                open={isAnalysisOpen}
                onClose={() => setIsAnalysisOpen(false)}
                grievance={selectedGrievance}
                onRiskLevelChange={canManageSpecialGrievanceUi ? async (g, newLevel) => {
                    try {
                        const res = await api.put(`/grievances/${g.id}/risk-level`, { risk_level: newLevel });
                        const updatedAnalysis = res?.data?.analysis;
                        if (!updatedAnalysis) throw new Error('No analysis returned');

                        const patch = { ...updatedAnalysis, risk_level: newLevel };
                        setGrievances(prev => prev.map(item => (
                            item.id === g.id
                                ? { ...item, analysis: { ...(item.analysis || {}), ...patch } }
                                : item
                        )));
                        setSelectedGrievance(prev => (
                            prev && prev.id === g.id
                                ? { ...prev, analysis: { ...(prev.analysis || {}), ...patch } }
                                : prev
                        ));
                        triggerActionBlink(g.id);
                        toast.success(`Risk level updated to ${newLevel.toUpperCase()} (${updatedAnalysis.risk_score}%)`);
                    } catch (error) {
                        toast.error(error?.response?.data?.message || 'Failed to update risk level');
                        throw error;
                    }
                } : undefined}
                onSentimentChange={canManageSpecialGrievanceUi ? async (g, newSentiment) => {
                    try {
                        const res = await api.put(`/grievances/${g.id}/risk-level`, { sentiment: newSentiment });
                        const updatedAnalysis = res?.data?.analysis;
                        if (!updatedAnalysis) throw new Error('No analysis returned');

                        const patch = { ...updatedAnalysis, sentiment: newSentiment };
                        setGrievances(prev => prev.map(item => (
                            item.id === g.id
                                ? { ...item, analysis: { ...(item.analysis || {}), ...patch } }
                                : item
                        )));
                        setSelectedGrievance(prev => (
                            prev && prev.id === g.id
                                ? { ...prev, analysis: { ...(prev.analysis || {}), ...patch } }
                                : prev
                        ));
                        triggerActionBlink(g.id);
                        toast.success(`Sentiment updated to ${newSentiment.toUpperCase()}`);
                    } catch (error) {
                        toast.error(error?.response?.data?.message || 'Failed to update sentiment');
                        throw error;
                    }
                } : undefined}
            />
        </div>
    );
};

/* ─── Source Card Sub-component ─── */
const SourceCard = ({ source, fetching, onFetch, onDelete }) => (
    <Card className="border-slate-200 hover:border-slate-300 transition-colors">
        <CardContent className="p-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar className="h-9 w-9 shrink-0">
                        <AvatarImage src={source.profile_image_url} />
                        <AvatarFallback className="text-xs bg-slate-200">
                            {(source.handle || '?').replace('@', '')[0]?.toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1">
                            <span className="text-sm font-medium text-slate-900 truncate">
                                {source.display_name || source.handle}
                            </span>
                            {source.is_verified && <BadgeCheck className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{source.handle}</div>
                    </div>
                </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">{source.total_grievances || 0} grievances</span>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onFetch} disabled={fetching} title="Fetch grievances">
                        {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={onDelete} title="Remove source">
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>
        </CardContent>
    </Card>
);

/* ─── Detail Info Field ─── */
const InfoField = ({ label, value }) => (
    <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-0.5">{label}</h4>
        <div className="text-sm text-slate-800">{value}</div>
    </div>
);

/* ─── Resizable/Draggable Excel Sheet Modal ─── */
const ExcelSheetModal = ({ open, onOpenChange, rows, setRows, modalPos, setModalPos, modalSize, setModalSize, isDragging, setIsDragging, dragOffset, setDragOffset, isResizing, setIsResizing, modalRef, preFilledRow, setPreFilledRow, userName }) => {
    // Dropdown options
    const psJurisdictionOptions = [
        'PS-01', 'PS-02', 'PS-03', 'PS-04', 'PS-05', 'PS-06', 'PS-07', 'PS-08', 'PS-09', 'PS-10'
    ];
    const typeOfPostOptions = [
        'Twitter/X Post', 'Facebook Post', 'Instagram Post', 'WhatsApp Message', 'Comment', 'Story', 'Other'
    ];
    const subCategoryOptions = [
        'Complaint', 'Suggestion', 'Appreciation', 'Query', 'Feedback', 'Report', 'Other'
    ];
    const actionTakenOptions = [
        'Forwarded', 'Suggested', 'Solved'
    ];
    const informedToOptions = [
        { label: 'Police Station', phone: '100' },
        { label: 'Fire Department', phone: '101' },
        { label: 'Ambulance', phone: '102' },
        { label: 'Disaster Management', phone: '108' },
        { label: 'Women Helpline', phone: '1091' },
        { label: 'Custom Contact', phone: '' }
    ];

    const [searchInputs, setSearchInputs] = useState({});

    const addRow = () => {
        const newId = Math.max(...rows.map(r => r.id), 0) + 1;
        const now = new Date().toISOString().slice(0, 16);

        // If we have pre-filled data, use it
        const newRow = {
            id: newId,
            uniqueNumber: `UNQ-${String(newId).padStart(3, '0')}`,
            callerNumber: preFilledRow?.callerNumber || '',
            receivedBy: userName,
            mentionName: preFilledRow?.mentionName || '',
            receivedTime: preFilledRow?.receivedTime || now,
            contents: preFilledRow?.contents || '',
            psJurisdiction: '',
            typeOfPost: '',
            subCategory: '',
            informedTo: '',
            actionTime: '',
            actionTaken: '',
            caseDetails: '',
            actionInformedTo: '',
            completionDate: '',
        };

        setRows([...rows, newRow]);
        setPreFilledRow(null); // Clear pre-filled data after use
    };

    const updateRow = (id, field, value) => {
        setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    const deleteRow = (id) => {
        setRows(rows.filter(r => r.id !== id));
    };

    const exportToCSV = () => {
        const headers = ['Unique Number', 'Caller Number', 'Received By', 'Mention Name', 'Received Time & Date',
            'Contents of Complaint', 'PS Jurisdiction', 'Type of Post', 'Sub Category', 'Informed To',
            'Action Time', 'Action Taken', 'Case Details', 'Action Informed To', 'Completion Date'];
        const csvContent = [
            headers.join(','),
            ...rows.map(r => [
                r.uniqueNumber, r.callerNumber, r.receivedBy, r.mentionName, r.receivedTime,
                r.contents, r.psJurisdiction, r.typeOfPost, r.subCategory, r.informedTo,
                r.actionTime, r.actionTaken, r.caseDetails, r.actionInformedTo, r.completionDate
            ].map(v => `"${(v || '').replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `grievance_records_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    };

    if (!open) return null;

    return (
        <div
            ref={modalRef}
            className="fixed bg-white rounded-lg shadow-2xl border border-slate-200 flex flex-col z-50"
            style={{
                left: `${modalPos.x}px`,
                top: `${modalPos.y}px`,
                width: `${modalSize.width}px`,
                height: `${modalSize.height}px`,
            }}
        >
            {/* Title Bar - Draggable */}
            <div
                className="flex items-center justify-between p-3 bg-gradient-to-r from-slate-100 to-slate-50 border-b border-slate-200 rounded-t-lg cursor-move hover:bg-slate-100 transition-colors select-none"
                onMouseDown={(e) => {
                    if (!modalRef.current) return;
                    const rect = modalRef.current.getBoundingClientRect();
                    setDragOffset({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                    });
                    setIsDragging(true);
                }}
            >
                <div>
                    <h2 className="font-semibold text-slate-900">Grievance Records - Excel Sheet</h2>
                    <p className="text-xs text-slate-500">Manage and export grievance complaint records</p>
                </div>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onOpenChange(false)}>
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-100">
                        <tr>
                            <th className="border p-2 text-left bg-slate-200 font-semibold w-16">Unique #</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-20">Caller #</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-20">Received By</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-20">Mention</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-24">Rcv Time</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-28">Contents</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-16">PS</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-16">Type</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-16">SubCat</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-16">Inform To</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-20">Action Time</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-16">Action</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-24">Details</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-16">Inf To</th>
                            <th className="border p-2 text-left bg-slate-200 font-semibold min-w-16">Complete</th>
                            <th className="border p-2 text-center bg-slate-200 font-semibold w-10">Del</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.id} className="hover:bg-slate-50">
                                <td className="border p-1"><span className="font-mono text-[10px]">{row.uniqueNumber}</span></td>
                                <td className="border p-1"><Input value={row.callerNumber} onChange={(e) => updateRow(row.id, 'callerNumber', e.target.value)} className="h-6 text-xs p-1" placeholder="+91..." /></td>
                                <td className="border p-1"><Input value={row.receivedBy} readOnly className="h-6 text-xs p-1 bg-slate-100" title="Auto-filled from login" /></td>
                                <td className="border p-1"><Input value={row.mentionName} onChange={(e) => updateRow(row.id, 'mentionName', e.target.value)} className="h-6 text-xs p-1" placeholder="Victim name" /></td>
                                <td className="border p-1"><Input type="datetime-local" value={row.receivedTime} readOnly className="h-6 text-xs p-1 bg-slate-100" title="Auto-filled" /></td>
                                <td className="border p-1"><textarea value={row.contents} readOnly className="w-full h-6 text-xs border rounded p-1 resize-none bg-slate-100" title="Auto-filled from post" /></td>
                                <td className="border p-1">
                                    <select value={row.psJurisdiction} onChange={(e) => updateRow(row.id, 'psJurisdiction', e.target.value)} className="h-6 text-xs w-full p-1 border rounded">
                                        <option value="">Select PS</option>
                                        {psJurisdictionOptions.map(ps => <option key={ps} value={ps}>{ps}</option>)}
                                        <option value="other">Other</option>
                                    </select>
                                </td>
                                <td className="border p-1">
                                    <select value={row.typeOfPost} onChange={(e) => updateRow(row.id, 'typeOfPost', e.target.value)} className="h-6 text-xs w-full p-1 border rounded">
                                        <option value="">Type</option>
                                        {typeOfPostOptions.map(type => <option key={type} value={type}>{type}</option>)}
                                    </select>
                                </td>
                                <td className="border p-1">
                                    <select value={row.subCategory} onChange={(e) => updateRow(row.id, 'subCategory', e.target.value)} className="h-6 text-xs w-full p-1 border rounded">
                                        <option value="">SubCat</option>
                                        {subCategoryOptions.map(sub => <option key={sub} value={sub}>{sub}</option>)}
                                    </select>
                                </td>
                                <td className="border p-1">
                                    <select value={row.informedTo} onChange={(e) => updateRow(row.id, 'informedTo', e.target.value)} className="h-6 text-xs w-full p-1 border rounded">
                                        <option value="">Select</option>
                                        {informedToOptions.map(opt => <option key={opt.phone} value={opt.phone}>{opt.label} ({opt.phone})</option>)}
                                    </select>
                                </td>
                                <td className="border p-1"><Input type="datetime-local" value={row.actionTime} onChange={(e) => updateRow(row.id, 'actionTime', e.target.value)} className="h-6 text-xs p-1" /></td>
                                <td className="border p-1">
                                    <select value={row.actionTaken} onChange={(e) => updateRow(row.id, 'actionTaken', e.target.value)} className="h-6 text-xs w-full p-1 border rounded">
                                        <option value="">Action</option>
                                        {actionTakenOptions.map(action => <option key={action} value={action}>{action}</option>)}
                                    </select>
                                </td>
                                <td className="border p-1"><textarea value={row.caseDetails} onChange={(e) => updateRow(row.id, 'caseDetails', e.target.value)} className="w-full h-6 text-xs border rounded p-1 resize-none" placeholder="Details..." /></td>
                                <td className="border p-1"><Input value={row.actionInformedTo} onChange={(e) => updateRow(row.id, 'actionInformedTo', e.target.value)} className="h-6 text-xs p-1" placeholder="Complainant" /></td>
                                <td className="border p-1"><Input type="date" value={row.completionDate} onChange={(e) => updateRow(row.id, 'completionDate', e.target.value)} className="h-6 text-xs p-1" /></td>
                                <td className="border p-1 text-center"><Button variant="destructive" size="sm" onClick={() => deleteRow(row.id)} className="h-5 w-5 p-0"><X className="h-3 w-3" /></Button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-3 bg-slate-50 border-t border-slate-200 rounded-b-lg gap-2">
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={addRow} className="gap-1 text-xs h-7"><Plus className="h-3 w-3" />Add Row</Button>
                    <Button variant="outline" size="sm" onClick={exportToCSV} className="gap-1 text-xs h-7"><Download className="h-3 w-3" />Export CSV</Button>
                </div>
                <span className="text-xs text-slate-500">Drag title to move, resize from corner</span>
            </div>

            {/* Resize Handle */}
            <div
                className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize bg-gradient-to-tl from-slate-300 to-transparent rounded-tl hover:from-slate-400 transition-colors"
                onMouseDown={() => setIsResizing(true)}
                title="Drag to resize"
            />
        </div>
    );
};
export default Grievances;
