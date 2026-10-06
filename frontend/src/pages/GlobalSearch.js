import React, { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import axios from 'axios';
import {
    Search, User, Users, Youtube, Monitor, ExternalLink,
    Loader2, AlertCircle, Download, Facebook, Instagram,
    Globe, Heart, MessageCircle, Eye, Repeat2, ArrowUpRight,
    Hash, ChevronDown, X, RefreshCw, Share2, StopCircle, ArrowLeft, History
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import AddSourceModal from '../components/AddSourceModal';
import { toast } from 'sonner';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

// Reddit SVG icon (official Snoo shape)
const RedditIcon = ({ size = 24, className = '', ...props }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" {...props}>
        <path d="M14.238 15.348c.085.084.085.221 0 .306-.465.462-1.194.687-2.231.687l-.008-.002-.008.002c-1.036 0-1.766-.225-2.231-.688-.085-.084-.085-.221 0-.305.084-.084.222-.084.307 0 .379.377 1.008.561 1.924.561l.008.002.008-.002c.915 0 1.544-.184 1.924-.561.085-.084.223-.084.307 0zm-3.44-2.418c0-.507-.414-.919-.922-.919-.509 0-.922.412-.922.919 0 .506.414.918.922.918.508 0 .922-.412.922-.918zm4.04-.919c-.509 0-.922.412-.922.919 0 .506.414.918.922.918.508 0 .922-.412.922-.918 0-.507-.414-.919-.922-.919zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5.8 11.333c.02.14.03.283.03.428 0 2.19-2.547 3.964-5.69 3.964-3.142 0-5.69-1.774-5.69-3.964 0-.145.01-.288.03-.428A1.473 1.473 0 0 1 5.5 12c0-.378.145-.722.382-.982-.02-.12-.035-.244-.035-.372 0-.946.476-1.818 1.268-2.464C7.96 7.428 9.862 6.9 12 6.9c2.137 0 4.04.528 4.886 1.282.79.646 1.266 1.518 1.266 2.464 0 .128-.015.252-.035.372.237.26.383.604.383.982 0 .556-.312 1.04-.77 1.29l.07.043z"/>
    </svg>
);

/* ── 3D Globe Animation (CSS-only) ────────────────────────────── */
const SearchGlobe = () => (
    <div className="relative w-28 h-28 flex items-center justify-center">
        {/* Glow ring */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-400/20 to-indigo-500/20 animate-pulse" />
        <div className="absolute inset-2 rounded-full bg-gradient-to-br from-blue-400/10 to-transparent" />

        {/* Globe sphere */}
        <div className="relative w-24 h-24 rounded-full overflow-hidden" style={{
            background: 'radial-gradient(circle at 35% 35%, #60a5fa, #3b82f6 40%, #1d4ed8 75%, #1e3a5f)',
            boxShadow: '0 0 40px rgba(59,130,246,0.3), inset -8px -8px 20px rgba(0,0,0,0.3), inset 4px 4px 10px rgba(255,255,255,0.15)'
        }}>
            {/* Spinning grid lines - longitude */}
            <div className="absolute inset-0 rounded-full" style={{ animation: 'globeSpin 3s linear infinite' }}>
                {[0, 30, 60, 90, 120, 150].map(deg => (
                    <div key={deg} className="absolute inset-0 rounded-full border border-white/20"
                        style={{ transform: `rotateY(${deg}deg)`, borderRadius: '50%' }} />
                ))}
            </div>
            {/* Latitude lines */}
            {[20, 40, 60, 80].map(pct => (
                <div key={pct} className="absolute left-0 right-0 border-t border-white/15"
                    style={{ top: `${pct}%` }} />
            ))}
            {/* Orbiting dots */}
            <div className="absolute inset-0" style={{ animation: 'globeSpin 2.5s linear infinite' }}>
                <div className="absolute w-2 h-2 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50" style={{ top: '30%', left: '55%' }} />
                <div className="absolute w-1.5 h-1.5 rounded-full bg-amber-400 shadow-lg shadow-amber-400/50" style={{ top: '55%', left: '35%' }} />
                <div className="absolute w-1.5 h-1.5 rounded-full bg-rose-400 shadow-lg shadow-rose-400/50" style={{ top: '42%', left: '72%' }} />
            </div>
            {/* Specular highlight */}
            <div className="absolute top-2 left-3 w-8 h-8 rounded-full bg-white/15 blur-md" />
        </div>

        {/* CSS keyframes injected via style tag */}
        <style>{`
            @keyframes globeSpin {
                from { transform: rotateY(0deg); }
                to { transform: rotateY(360deg); }
            }
        `}</style>
    </div>
);

// X (𝕏) Logo SVG
const XLogo = ({ className = '' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

// Platform configuration
const PLATFORMS = {
    all: { label: 'All Platforms', icon: Globe, color: 'from-slate-600 to-slate-800', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
    x: { label: 'X (Twitter)', icon: XLogo, color: 'from-gray-900 to-black', bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-900 dark:text-gray-100', border: 'border-gray-300' },
    youtube: { label: 'YouTube', icon: Youtube, color: 'from-red-500 to-red-700', bg: 'bg-red-50 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', border: 'border-red-200' },
    reddit: { label: 'Reddit', icon: RedditIcon, color: 'from-orange-500 to-orange-700', bg: 'bg-orange-50 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-200' },
    facebook: { label: 'Facebook', icon: Facebook, color: 'from-blue-500 to-blue-700', bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200' },
    instagram: { label: 'Instagram', icon: Instagram, color: 'from-purple-500 via-pink-500 to-orange-400', bg: 'bg-pink-50 dark:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-300', border: 'border-pink-200' },
};

const PROFILE_PLATFORMS = ['x', 'youtube', 'reddit', 'facebook', 'instagram'];
const CONTENT_PLATFORMS = ['x', 'youtube', 'reddit', 'facebook'];

const formatIST = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: diffDays > 365 ? 'numeric' : undefined });
};

const formatNumber = (num) => {
    const n = Number(num) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
};

const PlatformPill = ({ platformKey, small }) => {
    const cfg = PLATFORMS[platformKey] || PLATFORMS.all;
    const Icon = cfg.icon;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-white bg-gradient-to-r ${cfg.color} ${small ? 'text-[10px]' : 'text-xs'} font-medium`}>
            <Icon className={small ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
            {!small && cfg.label}
        </span>
    );
};

const TEXT_CLAMP_LENGTH = 200;
const CONTENT_RANGE_OPTIONS = ['20', '40', '60', '80', '100'];

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildResultSearchText = (item) => {
    if (!item || typeof item !== 'object') return '';
    return [
        item.text,
        item.title,
        item.description,
        item.author,
        item.author_handle,
        item.channelTitle,
        item.screen_name,
        item.name,
        item.url,
        item.content_url
    ]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase())
        .join(' ');
};

const doesResultMatch = (item, searchText) => {
    const normalizedSearch = String(searchText || '').trim().toLowerCase();
    if (!normalizedSearch) return true;

    const terms = normalizedSearch.split(/\s+/).filter(Boolean);
    if (!terms.length) return true;

    const haystack = buildResultSearchText(item);
    if (!haystack) return false;

    return haystack.includes(normalizedSearch) || terms.every((term) => haystack.includes(term));
};

const highlightText = (text, searchText) => {
    const raw = String(text || '');
    const normalized = String(searchText || '').trim();
    if (!raw || !normalized) return raw;

    const terms = Array.from(new Set(normalized.split(/\s+/).filter(Boolean))).slice(0, 8);
    if (!terms.length) return raw;

    const tokenSource = terms.map(escapeRegExp).join('|');
    const splitRegex = new RegExp(`(${tokenSource})`, 'ig');
    const exactRegex = new RegExp(`^(${tokenSource})$`, 'i');
    const parts = raw.split(splitRegex);

    return parts.map((part, idx) => (
        exactRegex.test(part)
            ? <mark key={`${part}-${idx}`} className="bg-amber-200/80 text-foreground px-0.5 rounded-sm">{part}</mark>
            : <React.Fragment key={`${part}-${idx}`}>{part}</React.Fragment>
    ));
};

const ContentCard = memo(({ item, index, getContentUrl, onMonitor, highlightQuery = '' }) => {
    const [expanded, setExpanded] = useState(false);
    const textRef = React.useRef(null);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const p = item._platform || 'x';
    const cfg = PLATFORMS[p] || PLATFORMS.all;
    const contentUrl = getContentUrl(item);
    const likes = item.metrics?.likes || item.statistics?.likeCount || 0;
    const comments = item.metrics?.comments || item.statistics?.commentCount || 0;
    const views = item.metrics?.views || item.statistics?.viewCount || 0;
    const shares = item.metrics?.retweets || item.metrics?.shares || 0;
    const contentText = item.text || item.description || item.title || '';
    const thumbnail = item.thumbnails?.medium?.url || item.thumbnails?.default?.url || null;
    const isMonitorDisabled = p === 'reddit';

    React.useEffect(() => {
        const el = textRef.current;
        if (el) setIsOverflowing(el.scrollHeight > el.clientHeight);
    }, [contentText]);

    return (
        <div className="group bg-card rounded-xl border border-border hover:shadow-lg hover:border-border/80 transition-all duration-200 overflow-hidden flex flex-col">
            <div className="p-4 flex flex-col flex-1">
                {/* Author row */}
                <div className="flex items-center gap-3 mb-3">
                    <Avatar className="h-9 w-9 border border-border flex-shrink-0">
                        <AvatarImage src={item.author_avatar || item.thumbnails?.default?.url} />
                        <AvatarFallback className={`${cfg.bg} ${cfg.text} text-xs font-semibold`}>
                            {(item.author || item.channelTitle || '?')[0]?.toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-foreground truncate">{highlightText(item.author || item.channelTitle || 'Unknown', highlightQuery)}</span>
                            <PlatformPill platformKey={p} small />
                        </div>
                        {(item.author_handle || item.created_at || item.publishedAt) && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                {item.author_handle && <span>@{highlightText(item.author_handle, highlightQuery)}</span>}
                                {(item.created_at || item.publishedAt) && (
                                    <span>· {formatIST(item.created_at || item.publishedAt)}</span>
                                )}
                            </div>
                        )}
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        onClick={() => window.open(contentUrl, '_blank', 'noopener,noreferrer')}
                    >
                        <ArrowUpRight className="h-4 w-4" />
                    </Button>
                </div>

                {/* Content — fixed height when collapsed */}
                <div className="flex gap-3 flex-1">
                    <div className="flex-1 min-w-0">
                        <div
                            ref={textRef}
                            className={`text-sm text-foreground/80 leading-relaxed whitespace-pre-line break-words overflow-hidden transition-all ${expanded ? '' : 'line-clamp-4'}`}
                        >
                            {highlightText(contentText, highlightQuery)}
                        </div>
                        {isOverflowing && (
                            <button
                                type="button"
                                onClick={() => setExpanded(e => !e)}
                                className="mt-1.5 text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-0.5 transition-colors"
                            >
                                {expanded ? 'Show less' : 'Read more'}
                                <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                            </button>
                        )}
                    </div>
                    {thumbnail && p === 'youtube' && (
                        <div className="flex-shrink-0 w-32 h-20 rounded-lg overflow-hidden bg-muted">
                            <img src={thumbnail} alt="" className="w-full h-full object-cover" />
                        </div>
                    )}
                </div>

                {/* Engagement metrics */}
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50">
                    {likes > 0 && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Heart className="h-3.5 w-3.5" />
                            {formatNumber(likes)}
                        </span>
                    )}
                    {comments > 0 && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MessageCircle className="h-3.5 w-3.5" />
                            {formatNumber(comments)}
                        </span>
                    )}
                    {shares > 0 && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Repeat2 className="h-3.5 w-3.5" />
                            {formatNumber(shares)}
                        </span>
                    )}
                    {views > 0 && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Eye className="h-3.5 w-3.5" />
                            {formatNumber(views)}
                        </span>
                    )}
                    <div className="flex-1" />
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs px-2 gap-1"
                        onClick={() => !isMonitorDisabled && onMonitor?.(item)}
                        disabled={isMonitorDisabled}
                    >
                        <Monitor className="h-3 w-3" /> Monitor
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 px-2 gap-1"
                        onClick={() => window.open(contentUrl, '_blank', 'noopener,noreferrer')}
                    >
                        View <ExternalLink className="h-3 w-3" />
                    </Button>
                </div>
            </div>
        </div>
    );
});

const GlobalSearch = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [platform, setPlatform] = useState('all');
    const [searchType, setSearchType] = useState('profiles');
    const [resultLimit, setResultLimit] = useState('20');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [resultFilter, setResultFilter] = useState('all');
    const [searched, setSearched] = useState(false);
    const [platformErrors, setPlatformErrors] = useState({});
    const [completedPlatforms, setCompletedPlatforms] = useState(new Set());
    const [viewMode, setViewMode] = useState('search');

    const [historyItems, setHistoryItems] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyDetailLoadingId, setHistoryDetailLoadingId] = useState(null);
    const [historyFilters, setHistoryFilters] = useState({
        q: '',
        searchType: 'all',
        platform: 'all',
        from: '',
        to: ''
    });
    const [historyPagination, setHistoryPagination] = useState({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1
    });
    const [historySelectedRecord, setHistorySelectedRecord] = useState(null);
    const historyDebounceRef = useRef(null);

    // Abort controller ref
    const abortRef = useRef(null);

    // Add Source modal state
    const [sourceModalOpen, setSourceModalOpen] = useState(false);
    const [initialSourceData, setInitialSourceData] = useState(null);

    const loadHistory = useCallback(async (page = 1, overrideFilters = null) => {
        setHistoryLoading(true);
        try {
            const activeFilters = overrideFilters || historyFilters;
            const params = {
                page,
                limit: historyPagination.limit
            };

            if (activeFilters.q.trim()) params.q = activeFilters.q.trim();
            if (activeFilters.searchType !== 'all') params.searchType = activeFilters.searchType;
            if (activeFilters.platform !== 'all') params.platform = activeFilters.platform;
            if (activeFilters.from) params.from = activeFilters.from;
            if (activeFilters.to) params.to = activeFilters.to;

            const response = await api.get('/search/history', { params });
            setHistoryItems(Array.isArray(response.data?.items) ? response.data.items : []);
            setHistoryPagination(response.data?.pagination || {
                page: 1,
                limit: historyPagination.limit,
                total: 0,
                totalPages: 1
            });
        } catch (error) {
            console.error('Failed to load search history:', error);
            toast.error(error?.response?.data?.error || 'Failed to load search history');
        } finally {
            setHistoryLoading(false);
        }
    }, [historyFilters, historyPagination.limit]);

    const openHistoryRecord = useCallback(async (historyId) => {
        setHistoryDetailLoadingId(historyId);
        try {
            const response = await api.get(`/search/history/${historyId}`);
            const record = response.data || {};
            const historyResults = Array.isArray(record.results) ? record.results : [];
            const normalizedResults = historyResults.map((item) => {
                const sourcePlatform = item?._platform || item?.platform || record.platform || 'all';
                return { ...item, _platform: sourcePlatform };
            });

            setHistorySelectedRecord({
                ...record,
                results: normalizedResults,
                search_type: record.search_type || 'profiles',
                platform: record.platform || 'all'
            });
            toast.success('Loaded history results');
        } catch (error) {
            console.error('Failed to open search history record:', error);
            toast.error(error?.response?.data?.error || 'Failed to open search history item');
        } finally {
            setHistoryDetailLoadingId(null);
        }
    }, []);

    useEffect(() => {
        if (viewMode !== 'history') return;

        if (historyDebounceRef.current) {
            clearTimeout(historyDebounceRef.current);
        }

        historyDebounceRef.current = setTimeout(() => {
            loadHistory(1);
        }, 260);

        return () => {
            if (historyDebounceRef.current) {
                clearTimeout(historyDebounceRef.current);
            }
        };
    }, [
        viewMode,
        historyFilters.q,
        historyFilters.searchType,
        historyFilters.platform,
        historyFilters.from,
        historyFilters.to,
        loadHistory
    ]);

    useEffect(() => {
        if (viewMode !== 'history') {
            setHistorySelectedRecord(null);
        }
    }, [viewMode]);

    const handleSearch = useCallback(async (e) => {
        e?.preventDefault?.();
        if (!query.trim()) return;

        const isContentSearch = searchType === 'content';
        const activeLimit = isContentSearch ? Number(resultLimit) : 20;

        const startedAt = Date.now();

        // Abort any previous search
        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setResults([]);
        setSearched(true);
        setPlatformErrors({});
        setCompletedPlatforms(new Set());

        try {
            const endpoint = searchType === 'profiles' ? '/search/profiles' : '/search/content';
            const timeout = 45000;
            let combinedResults = [];
            let combinedErrors = {};
            let combinedCounts = {};

            if (platform === 'all') {
                const platformKeys = searchType === 'content' ? CONTENT_PLATFORMS : PROFILE_PLATFORMS;

                // Create an abort-aware wrapper that rejects immediately on abort
                const abortPromise = new Promise((_, reject) => {
                    controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
                });

                const fetchAll = Promise.allSettled(
                    platformKeys.map(p =>
                        api.get(endpoint, {
                            params: {
                                platform: p,
                                query,
                                limit: activeLimit
                            },
                            timeout,
                            signal: controller.signal
                        })
                    )
                );

                const settled = await Promise.race([fetchAll, abortPromise]);

                const combined = [];
                const errors = {};
                // Process in fixed order: x, youtube, reddit, facebook, instagram
                settled.forEach((result, idx) => {
                    const p = platformKeys[idx];
                    if (result.status === 'fulfilled') {
                        const data = Array.isArray(result.value.data) ? result.value.data : [];
                        combined.push(...data.map(item => ({ ...item, _platform: item._platform || item.platform || p })));
                        combinedCounts[p] = data.length;
                    } else {
                        if (axios.isCancel(result.reason) || result.reason?.name === 'AbortError' || result.reason?.code === 'ERR_CANCELED') return;
                        const errMsg = result.reason?.response?.data?.error || result.reason?.message || 'Failed';
                        errors[p] = errMsg.includes('timeout') ? 'Timed out' : errMsg;
                        combinedCounts[p] = 0;
                    }
                });
                setPlatformErrors(errors);
                setCompletedPlatforms(new Set(platformKeys));
                // Sort combined results by most recent first
                combined.sort((a, b) => {
                    const timeA = new Date(a.created_at || a.timestamp || a.publishedAt || 0).getTime();
                    const timeB = new Date(b.created_at || b.timestamp || b.publishedAt || 0).getTime();
                    return timeB - timeA;
                });
                setResults(combined);
                combinedResults = combined;
                combinedErrors = errors;
            } else {
                const response = await api.get(endpoint, {
                    params: {
                        platform,
                        query,
                        limit: activeLimit
                    },
                    timeout,
                    signal: controller.signal
                });
                const data = Array.isArray(response.data) ? response.data : [];
                const mapped = data.map(item => ({ ...item, _platform: item._platform || item.platform || platform }));
                setResults(mapped);
                setCompletedPlatforms(new Set([platform]));
                combinedResults = mapped;
                combinedErrors = {};
                combinedCounts = { [platform]: mapped.length };
            }

            try {
                await api.post('/search/history', {
                    query: query.trim(),
                    searchType,
                    platform,
                    results: combinedResults,
                    platformCounts: combinedCounts,
                    platformErrors: combinedErrors,
                    durationMs: Date.now() - startedAt,
                    searchedAt: new Date(startedAt).toISOString()
                });
            } catch (historyError) {
                console.warn('Search history save failed:', historyError?.message || historyError);
            }
        } catch (error) {
            if (axios.isCancel(error) || error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
                toast.info('Search cancelled');
                return;
            }
            console.error('Search error:', error);
            const msg = error?.code === 'ECONNABORTED' ? 'Search timed out. Try a specific platform.' : (error?.response?.data?.error || 'Search failed. Please try again.');
            toast.error(msg);
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        }
    }, [query, platform, searchType, resultLimit]);

    const openMonitorDialog = useCallback((source) => {
        const sourcePlatform = source._platform || platform;
        const handle = source.screen_name || source.username || source.id || '';
        const displayName = source.name || source.title || '';
        const followers = source.followers_count || source.subscriber_count || '';

        setInitialSourceData({
            platform: sourcePlatform,
            identifier: handle,
            display_name: displayName,
            category: 'others',
            priority: 'medium',
            is_active: true,
            poiData: {
                realName: displayName,
                socialMedia: [{
                    platform: sourcePlatform,
                    handle: handle,
                    displayName: displayName,
                    category: 'others',
                    priority: 'medium',
                    isActive: true,
                    followerCount: followers ? String(followers) : '',
                    createdDate: ''
                }]
            }
        });
        setSourceModalOpen(true);
    }, [platform]);

    const openMonitorDialogFromContent = useCallback((contentItem) => {
        if (!contentItem) return;

        const sourcePlatform = contentItem._platform || contentItem.platform || platform;
        const cleanHandle = (value) => String(value || '').trim().replace(/^@/, '');

        let identifier = '';
        if (sourcePlatform === 'youtube') {
            identifier = cleanHandle(contentItem.channelId || contentItem.channel_id || contentItem.author_handle || contentItem.author || contentItem.id);
        } else if (sourcePlatform === 'x' || sourcePlatform === 'instagram') {
            identifier = cleanHandle(contentItem.author_handle || contentItem.screen_name || contentItem.author || contentItem.id);
        } else if (sourcePlatform === 'reddit') {
            identifier = cleanHandle(contentItem.author_handle || contentItem.author || contentItem.screen_name || contentItem.id);
        } else if (sourcePlatform === 'facebook') {
            identifier = cleanHandle(contentItem.author_handle || contentItem.author || contentItem.page_id || contentItem.id);
        } else {
            identifier = cleanHandle(contentItem.author_handle || contentItem.author || contentItem.id);
        }

        if (!identifier) {
            toast.error('Unable to identify source handle for this result');
            return;
        }

        const displayName = String(contentItem.author || contentItem.channelTitle || identifier).trim();
        const followers = contentItem.followers_count || contentItem.statistics?.subscriberCount || 0;

        openMonitorDialog({
            _platform: sourcePlatform,
            id: identifier,
            screen_name: identifier,
            username: identifier,
            name: displayName,
            title: displayName,
            followers_count: followers
        });
    }, [openMonitorDialog, platform]);

    // Filtered results
    const filteredResults = useMemo(() => {
        if (resultFilter === 'all') return results;
        return results.filter(item => item._platform === resultFilter);
    }, [results, resultFilter]);

    // Platform stats
    const platformCounts = useMemo(() => {
        const counts = {};
        results.forEach(r => {
            const p = r._platform || 'unknown';
            counts[p] = (counts[p] || 0) + 1;
        });
        return counts;
    }, [results]);

    const hasActiveHistoryFilters = useMemo(() => {
        return Boolean(
            historyFilters.q.trim() ||
            historyFilters.searchType !== 'all' ||
            historyFilters.platform !== 'all' ||
            historyFilters.from ||
            historyFilters.to
        );
    }, [historyFilters]);

    const historySelectedFilteredResults = useMemo(() => {
        if (!historySelectedRecord) return [];

        if (
            historyFilters.searchType !== 'all' &&
            historySelectedRecord.search_type !== historyFilters.searchType
        ) {
            return [];
        }

        const allResults = Array.isArray(historySelectedRecord.results) ? historySelectedRecord.results : [];
        const q = historyFilters.q;
        const fromDate = historyFilters.from ? new Date(historyFilters.from) : null;
        const toDate = historyFilters.to ? new Date(historyFilters.to) : null;
        if (toDate && !Number.isNaN(toDate.getTime())) {
            toDate.setHours(23, 59, 59, 999);
        }

        return allResults.filter((item) => {
            const itemPlatform = item?._platform || item?.platform || historySelectedRecord.platform || 'all';

            if (historyFilters.platform !== 'all' && itemPlatform !== historyFilters.platform) {
                return false;
            }

            if (q?.trim() && !doesResultMatch(item, q)) {
                return false;
            }

            if (fromDate || toDate) {
                const rawDate = item?.created_at || item?.publishedAt || item?.timestamp || item?.date || null;
                const parsedDate = rawDate ? new Date(rawDate) : null;
                if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
                    return false;
                }

                if (fromDate && !Number.isNaN(fromDate.getTime()) && parsedDate < fromDate) {
                    return false;
                }

                if (toDate && !Number.isNaN(toDate.getTime()) && parsedDate > toDate) {
                    return false;
                }
            }

            return true;
        });
    }, [historySelectedRecord, historyFilters.q, historyFilters.platform, historyFilters.searchType, historyFilters.from, historyFilters.to]);

    const groupedHistoryItems = useMemo(() => {
        const groups = [];
        const map = new Map();

        historyItems.forEach((item) => {
            const dateKey = item.searched_at
                ? new Date(item.searched_at).toISOString().slice(0, 10)
                : 'unknown';
            if (!map.has(dateKey)) {
                map.set(dateKey, []);
                groups.push(dateKey);
            }
            map.get(dateKey).push(item);
        });

        return groups.map((dateKey) => ({
            dateKey,
            label: dateKey === 'unknown'
                ? 'Unknown date'
                : new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-IN', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                }),
            items: map.get(dateKey) || []
        }));
    }, [historyItems]);

    const formatISTFull = (dateStr) => {
        if (!dateStr) return 'N/A';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    };

    const getProfileUrl = (item) => {
        const p = item._platform;
        if (p === 'x') return `https://x.com/${item.screen_name}`;
        if (p === 'youtube') return item.customUrl || `https://youtube.com/channel/${item.id}`;
        if (p === 'reddit') return `https://www.reddit.com/user/${item.screen_name}`;
        if (p === 'facebook') return item.url || `https://facebook.com/${item.id}`;
        if (p === 'instagram') return `https://instagram.com/${item.screen_name}`;
        return '#';
    };

    const getContentUrl = (item) => {
        if (item.url) return item.url;
        const p = item._platform;
        if (p === 'x') return `https://x.com/i/status/${item.id}`;
        if (p === 'youtube') return `https://youtube.com/watch?v=${item.id?.videoId || item.id}`;
        if (p === 'facebook') return `https://facebook.com/${item.id}`;
        if (p === 'instagram') return `https://instagram.com/p/${item.id}`;
        if (p === 'reddit') return item.url || `https://reddit.com`;
        return '#';
    };

    const getHandle = (item) => {
        const p = item._platform;
        if (p === 'x' || p === 'instagram') return `@${item.screen_name || ''}`;
        if (p === 'reddit') return `u/${item.screen_name || ''}`;
        if (p === 'facebook') return item.screen_name || item.id || '';
        if (p === 'youtube') return item.customUrl || '';
        return item.screen_name || '';
    };

    const getFollowerLabel = (p) => {
        if (p === 'youtube') return 'subscribers';
        if (p === 'reddit') return 'karma';
        return 'followers';
    };

    const getFollowerCount = (item) => {
        return item.followers_count || item.statistics?.subscriberCount || 0;
    };

    // --- Export Functions ---
    const exportToPDF = () => {
        if (filteredResults.length === 0) { toast.error('No results to export'); return; }
        const doc = new jsPDF({ orientation: 'landscape' });
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 297, 22, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.text('Global Search Report', 14, 14);
        doc.setFontSize(8);
        doc.text(`"${query}" | ${PLATFORMS[platform]?.label || platform} | ${searchType} | ${formatISTFull(new Date())}`, 14, 20);
        doc.setTextColor(0, 0, 0);

        const tableColumn = searchType === 'profiles'
            ? ['#', 'Platform', 'Name', 'Handle', 'Followers', 'Link']
            : ['#', 'Platform', 'Author', 'Date', 'Likes', 'Comments', 'Link'];

        const tableRows = filteredResults.map((item, i) => {
            const p = (item._platform || '').toUpperCase();
            if (searchType === 'profiles') {
                return [i + 1, p, item.name || item.title || 'N/A', getHandle(item), formatNumber(getFollowerCount(item)), getProfileUrl(item)];
            }
            return [i + 1, p, item.author || item.channelTitle || 'N/A', formatISTFull(item.created_at || item.publishedAt),
                (item.metrics?.likes || item.statistics?.likeCount || 0).toLocaleString(),
                (item.metrics?.comments || item.statistics?.commentCount || 0).toLocaleString(),
                getContentUrl(item)];
        });

        const urlColIndex = searchType === 'profiles' ? 5 : 6;
        autoTable(doc, {
            head: [tableColumn], body: tableRows, startY: 28,
            styles: { fontSize: 7, cellPadding: 2 },
            headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            didDrawCell: (data) => {
                if (data.column.index === urlColIndex && data.cell.section === 'body') {
                    const url = data.cell.raw;
                    if (url && String(url).startsWith('http')) {
                        doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
                    }
                }
            }
        });
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(7);
            doc.setTextColor(148, 163, 184);
            doc.text(`Page ${i}/${pageCount} — SOC - EYE`, 148, 205, { align: 'center' });
        }
        doc.save(`search_${query}_${new Date().toISOString().split('T')[0]}.pdf`);
        toast.success('PDF exported');
    };

    const exportToExcel = () => {
        if (filteredResults.length === 0) { toast.error('No results to export'); return; }
        const rows = filteredResults.map(item => {
            const p = item._platform || '';
            if (searchType === 'profiles') {
                return { Platform: p.toUpperCase(), Name: item.name || item.title || '', Handle: getHandle(item), Description: item.description || '', Followers: getFollowerCount(item), URL: getProfileUrl(item) };
            }
            return { Platform: p.toUpperCase(), Author: item.author || item.channelTitle || '', Content: (item.text || item.description || item.title || '').substring(0, 300), Date: formatISTFull(item.created_at || item.publishedAt), Likes: item.metrics?.likes || item.statistics?.likeCount || 0, Comments: item.metrics?.comments || item.statistics?.commentCount || 0, Views: item.metrics?.views || item.statistics?.viewCount || 0, URL: getContentUrl(item) };
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Results');
        const meta = [{ Field: 'Query', Value: query }, { Field: 'Platform', Value: PLATFORMS[platform]?.label || platform }, { Field: 'Type', Value: searchType }, { Field: 'Count', Value: filteredResults.length }, { Field: 'Date', Value: formatISTFull(new Date()) }];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), 'Info');
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `search_${query}_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.success('Excel exported');
    };

    const exportHistoryToPDF = () => {
        if (!historySelectedRecord) return;
        if (historySelectedFilteredResults.length === 0) { toast.error('No history results to export'); return; }

        const historyQuery = historySelectedRecord.query || 'history';
        const historyType = historySelectedRecord.search_type || 'profiles';
        const historyPlatform = historyFilters.platform !== 'all'
            ? historyFilters.platform
            : (historySelectedRecord.platform || 'all');

        const doc = new jsPDF({ orientation: 'landscape' });
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 297, 22, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.text('Search History Report', 14, 14);
        doc.setFontSize(8);
        doc.text(`"${historyQuery}" | ${PLATFORMS[historyPlatform]?.label || historyPlatform} | ${historyType} | ${formatISTFull(new Date())}`, 14, 20);
        doc.setTextColor(0, 0, 0);

        const tableColumn = historyType === 'profiles'
            ? ['#', 'Platform', 'Name', 'Handle', 'Followers', 'Link']
            : ['#', 'Platform', 'Author', 'Date', 'Likes', 'Comments', 'Link'];

        const tableRows = historySelectedFilteredResults.map((item, i) => {
            const p = (item._platform || item.platform || '').toUpperCase();
            if (historyType === 'profiles') {
                return [i + 1, p, item.name || item.title || 'N/A', getHandle(item), formatNumber(getFollowerCount(item)), getProfileUrl(item)];
            }
            return [
                i + 1,
                p,
                item.author || item.channelTitle || 'N/A',
                formatISTFull(item.created_at || item.publishedAt || item.timestamp),
                (item.metrics?.likes || item.statistics?.likeCount || 0).toLocaleString(),
                (item.metrics?.comments || item.statistics?.commentCount || 0).toLocaleString(),
                getContentUrl(item)
            ];
        });

        const urlColIndex = historyType === 'profiles' ? 5 : 6;
        autoTable(doc, {
            head: [tableColumn], body: tableRows, startY: 28,
            styles: { fontSize: 7, cellPadding: 2 },
            headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            didDrawCell: (data) => {
                if (data.column.index === urlColIndex && data.cell.section === 'body') {
                    const url = data.cell.raw;
                    if (url && String(url).startsWith('http')) {
                        doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
                    }
                }
            }
        });

        doc.save(`history_${historyQuery}_${new Date().toISOString().split('T')[0]}.pdf`);
        toast.success('History PDF exported');
    };

    const exportHistoryToExcel = () => {
        if (!historySelectedRecord) return;
        if (historySelectedFilteredResults.length === 0) { toast.error('No history results to export'); return; }

        const historyQuery = historySelectedRecord.query || 'history';
        const historyType = historySelectedRecord.search_type || 'profiles';
        const historyPlatform = historyFilters.platform !== 'all'
            ? historyFilters.platform
            : (historySelectedRecord.platform || 'all');

        const rows = historySelectedFilteredResults.map((item) => {
            const p = item._platform || item.platform || '';
            if (historyType === 'profiles') {
                return {
                    Platform: p.toUpperCase(),
                    Name: item.name || item.title || '',
                    Handle: getHandle(item),
                    Description: item.description || '',
                    Followers: getFollowerCount(item),
                    URL: getProfileUrl(item)
                };
            }

            return {
                Platform: p.toUpperCase(),
                Author: item.author || item.channelTitle || '',
                Content: (item.text || item.description || item.title || '').substring(0, 300),
                Date: formatISTFull(item.created_at || item.publishedAt || item.timestamp),
                Likes: item.metrics?.likes || item.statistics?.likeCount || 0,
                Comments: item.metrics?.comments || item.statistics?.commentCount || 0,
                Views: item.metrics?.views || item.statistics?.viewCount || 0,
                URL: getContentUrl(item)
            };
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'History Results');

        const meta = [
            { Field: 'Query', Value: historyQuery },
            { Field: 'Platform', Value: PLATFORMS[historyPlatform]?.label || historyPlatform },
            { Field: 'Type', Value: historyType },
            { Field: 'Filtered Count', Value: historySelectedFilteredResults.length },
            { Field: 'Date', Value: formatISTFull(new Date()) }
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), 'Info');

        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `history_${historyQuery}_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.success('History Excel exported');
    };

    // --- Render Helpers ---

    const renderProfileCard = (item, index, highlightQuery = '') => {
        const p = item._platform || 'x';
        const cfg = PLATFORMS[p] || PLATFORMS.all;
        const profileUrl = getProfileUrl(item);
        const followers = getFollowerCount(item);
        const isMonitorDisabled = p === 'reddit';

        return (
            <div key={`${p}-${item.id}-${index}`} className={`group relative bg-card rounded-xl border border-border hover:shadow-lg transition-all duration-200 overflow-hidden`}>
                {/* Gradient top stripe */}
                <div className={`h-1 bg-gradient-to-r ${cfg.color}`} />

                <div className="p-4">
                    <div className="flex items-start gap-3">
                        <div className="relative flex-shrink-0">
                            <Avatar className="h-12 w-12 border-2 border-card shadow-sm">
                                <AvatarImage src={item.profile_image_url || item.thumbnails?.default?.url} />
                                <AvatarFallback className={`${cfg.bg} ${cfg.text} font-semibold`}>
                                    {(item.name || item.title || '?')[0]?.toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                            {item.verified && (
                                <div className="absolute -bottom-0.5 -right-0.5 bg-blue-500 rounded-full p-0.5">
                                    <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <h3 className="font-semibold text-sm text-foreground truncate leading-tight">
                                        {highlightText(item.name || item.title, highlightQuery)}
                                    </h3>
                                    <p className="text-xs text-muted-foreground truncate mt-0.5">{highlightText(getHandle(item), highlightQuery)}</p>
                                </div>
                                <PlatformPill platformKey={p} small />
                            </div>

                            <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">
                                {highlightText(item.description || 'No description available', highlightQuery)}
                            </p>
                        </div>
                    </div>

                    {/* Stats + Actions */}
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                        <div className="flex items-center gap-1 text-xs">
                            <Users className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-semibold text-foreground">{formatNumber(followers)}</span>
                            <span className="text-muted-foreground">{getFollowerLabel(p)}</span>
                        </div>
                        <div className="flex gap-1.5">
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => window.open(profileUrl, '_blank', 'noopener,noreferrer')}
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs px-2.5 gap-1 font-medium"
                                onClick={() => !isMonitorDisabled && openMonitorDialog(item)}
                                disabled={isMonitorDisabled}
                            >
                                <Monitor className="h-3 w-3" />
                                Monitor
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderContentCard = (item, index, highlightQuery = '') => {
        return (
            <ContentCard
                key={`${item._platform || 'x'}-${item.id}-${index}`}
                item={item}
                index={index}
                getContentUrl={getContentUrl}
                onMonitor={openMonitorDialogFromContent}
                highlightQuery={highlightQuery}
            />
        );
    };

    // How many platforms are done (for loading progress)
    const totalPlatforms = platform === 'all'
        ? (searchType === 'content' ? CONTENT_PLATFORMS.length : PROFILE_PLATFORMS.length)
        : 1;
    const donePlatforms = completedPlatforms.size;

    const historyPlatformList = historyFilters.searchType === 'content'
        ? ['all', ...CONTENT_PLATFORMS]
        : ['all', ...PROFILE_PLATFORMS];

    const handleLeftNavClick = useCallback(() => {
        if (viewMode === 'history') {
            if (historySelectedRecord) {
                setHistorySelectedRecord(null);
                return;
            }
            setViewMode('search');
            return;
        }

        if (location.state?.fromTools) {
            navigate('/analysis-tools');
            return;
        }

        navigate(-1);
    }, [viewMode, historySelectedRecord, location.state, navigate]);

    return (
        <div className="h-full flex flex-col bg-gradient-to-b from-background to-muted/30 overflow-hidden">
            {/* Header + Search — sticky within the page container */}
            <div className="flex-shrink-0 bg-background/80 backdrop-blur-md z-20 shadow-sm border-b border-border/50">
                <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
                    {/* Title row */}
                    <div className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleLeftNavClick}
                                className="w-8 h-8 rounded-lg border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                                aria-label={viewMode === 'history' ? 'Back to search' : 'Go back'}
                                title={viewMode === 'history' ? 'Back to Search' : 'Go Back'}
                            >
                                <ArrowLeft className="w-4 h-4" />
                            </button>
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-200 dark:shadow-blue-900/30">
                                <Globe className="h-4.5 w-4.5 text-white" />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold text-foreground leading-tight">Global Search</h1>
                                <p className="text-[11px] text-muted-foreground">
                                    {viewMode === 'history'
                                        ? 'Browse saved searches grouped by date'
                                        : 'Search profiles & content across all platforms'}
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-2 items-center">
                                {viewMode === 'search' && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setViewMode('history')}
                                        className="gap-1.5 text-xs h-8"
                                    >
                                        <History className="h-3.5 w-3.5" /> History
                                    </Button>
                                )}
                                {viewMode === 'search' && results.length > 0 && (
                                    <>
                                <Button variant="outline" size="sm" onClick={exportToPDF} className="gap-1.5 text-xs h-8">
                                    <Download className="h-3.5 w-3.5" /> PDF
                                </Button>
                                <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-1.5 text-xs h-8">
                                    <Download className="h-3.5 w-3.5" /> Excel
                                </Button>
                                    </>
                                )}
                        </div>
                    </div>

                    {/* Search bar */}
                    {viewMode === 'search' && (
                    <form onSubmit={handleSearch} className="pb-3">
                        <div className="flex flex-col sm:flex-row gap-2.5">
                            {/* Platform + Type selectors */}
                            <div className="flex gap-2">
                                <Select value={platform} onValueChange={(v) => { setPlatform(v); setResultFilter('all'); }}>
                                    <SelectTrigger className="w-[160px] h-10 bg-card text-sm rounded-lg">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-popover border border-border shadow-lg">
                                        {Object.entries(PLATFORMS)
                                            .filter(([key]) => key === 'all' || (searchType === 'content' ? CONTENT_PLATFORMS.includes(key) : PROFILE_PLATFORMS.includes(key)))
                                            .map(([key, cfg]) => {
                                            const Icon = cfg.icon;
                                            return (
                                                <SelectItem key={key} value={key}>
                                                    <span className="flex items-center gap-2">
                                                        <Icon className="h-3.5 w-3.5" />
                                                        {cfg.label}
                                                    </span>
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>

                                <div className="flex rounded-lg overflow-hidden border border-border">
                                    <button
                                        type="button"
                                        className={`px-3 py-2 text-xs font-medium flex items-center gap-1.5 transition-all ${searchType === 'profiles' ? 'bg-primary text-primary-foreground shadow-inner' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                                        onClick={() => setSearchType('profiles')}
                                    >
                                        <Users className="h-3.5 w-3.5" /> Profiles
                                    </button>
                                    <button
                                        type="button"
                                        className={`px-3 py-2 text-xs font-medium flex items-center gap-1.5 transition-all border-l border-border ${searchType === 'content' ? 'bg-primary text-primary-foreground shadow-inner' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                                        onClick={() => { setSearchType('content'); if (platform === 'instagram') setPlatform('all'); }}
                                    >
                                        <Hash className="h-3.5 w-3.5" /> Content
                                    </button>
                                </div>
                            </div>

                            {/* Search input */}
                            <div className="flex-1 flex gap-2">
                                {searchType === 'content' && (
                                    <Select value={resultLimit} onValueChange={setResultLimit}>
                                        <SelectTrigger className="w-[95px] h-10 bg-card text-sm rounded-lg">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {CONTENT_RANGE_OPTIONS.map((value) => (
                                                <SelectItem key={value} value={value}>Last {value}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder={searchType === 'profiles'
                                            ? `Search users, channels, pages...`
                                            : `Search posts, tweets by keyword...`}
                                        className="pl-10 h-10 bg-muted/50 border-border focus:bg-card text-sm rounded-lg"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                    />
                                    {query && (
                                        <button type="button" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                                <Button type="submit" disabled={loading || !query.trim()} className="h-10 px-6 bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-sm font-medium rounded-lg text-white">
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Search className="h-4 w-4 mr-1.5" />} Search
                                </Button>
                            </div>
                        </div>
                    </form>
                    )}
                </div>
                {/* Thin progress bar during loading */}
                {loading && (
                    <div className="h-0.5 bg-muted w-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-500 transition-all duration-700 ease-out"
                            style={{ width: `${Math.max(10, (donePlatforms / totalPlatforms) * 100)}%` }}
                        />
                    </div>
                )}
            </div>

            {/* Scrollable results area */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-5">
                    {/* Platform error warnings */}
                    {viewMode === 'search' && Object.keys(platformErrors).length > 0 && (
                        <div className="mb-4 flex flex-wrap gap-2">
                            {Object.entries(platformErrors).map(([p, err]) => (
                                <div key={p} className="flex items-center gap-2 px-3 py-1.5 bg-amber-50/80 dark:bg-amber-900/20 rounded-lg text-xs text-amber-800 dark:text-amber-300">
                                    <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                                    <span className="font-medium">{PLATFORMS[p]?.label || p}:</span> {err}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Results header with filter pills */}
                    {viewMode === 'search' && searched && results.length > 0 && (
                        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                            <div className="flex items-center gap-3 flex-wrap">
                                <h2 className="text-sm font-semibold text-foreground">
                                    {filteredResults.length} result{filteredResults.length !== 1 ? 's' : ''}
                                    {resultFilter !== 'all' && ` from ${PLATFORMS[resultFilter]?.label || resultFilter}`}

                                </h2>
                                {platform === 'all' && Object.keys(platformCounts).length > 1 && (
                                    <div className="flex gap-1.5 flex-wrap">
                                        <button
                                            onClick={() => setResultFilter('all')}
                                            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${resultFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                                        >
                                            All ({results.length})
                                        </button>
                                        {(searchType === 'content' ? CONTENT_PLATFORMS : PROFILE_PLATFORMS).filter(p => platformCounts[p]).map(p => {
                                            const count = platformCounts[p];
                                            const cfg = PLATFORMS[p];
                                            const Icon = cfg.icon;
                                            return (
                                                <button
                                                    key={p}
                                                    onClick={() => setResultFilter(p)}
                                                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${resultFilter === p ? `bg-gradient-to-r ${cfg.color} text-white shadow-sm` : `${cfg.bg} ${cfg.text} hover:opacity-80`}`}
                                                >
                                                    <Icon className="h-3 w-3" /> {count}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Loading state — 3D Globe */}
                    {viewMode === 'search' && loading && results.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20">
                            <SearchGlobe />
                            <p className="mt-6 text-sm font-medium text-foreground">
                                Scanning {platform === 'all' ? 'all platforms' : PLATFORMS[platform]?.label || platform}...
                            </p>
                            <p className="text-xs text-muted-foreground mt-1.5">Results will appear as they arrive</p>
                            {/* Platform progress dots */}
                            {platform === 'all' && (
                                <div className="flex items-center gap-3 mt-5">
                                    {(searchType === 'content' ? CONTENT_PLATFORMS : PROFILE_PLATFORMS).map(p => {
                                        const cfg = PLATFORMS[p];
                                        const Icon = cfg.icon;
                                        const done = completedPlatforms.has(p);
                                        const hasError = !!platformErrors[p];
                                        return (
                                            <div key={p} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all duration-300 ${done ? (hasError ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300') : 'bg-muted text-muted-foreground'}`}>
                                                <Icon className="h-3 w-3" />
                                                {done ? (hasError ? '!' : '✓') : <Loader2 className="h-3 w-3 animate-spin" />}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Empty state — not searched yet */}
                    {viewMode === 'search' && !loading && !searched && (
                        <div className="flex flex-col items-center justify-center py-24">
                            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/20 flex items-center justify-center mb-6 shadow-sm">
                                <Globe className="h-10 w-10 text-blue-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-foreground mb-2">Search across platforms</h3>
                            <p className="text-sm text-muted-foreground text-center max-w-md">
                                Find users, channels, and pages or discover content by keywords across X, YouTube, Reddit, Facebook{searchType === 'profiles' ? ', and Instagram' : ''}.
                            </p>
                            <div className="flex gap-3 mt-6">
                                {(searchType === 'content' ? CONTENT_PLATFORMS : PROFILE_PLATFORMS).map(p => {
                                    const cfg = PLATFORMS[p];
                                    const Icon = cfg.icon;
                                    return (
                                        <div key={p} className={`w-10 h-10 rounded-xl ${cfg.bg} flex items-center justify-center shadow-sm`}>
                                            <Icon className={`h-5 w-5 ${cfg.text}`} />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* No results */}
                    {viewMode === 'search' && !loading && searched && results.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-24">
                            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                                <Search className="h-8 w-8 text-muted-foreground/40" />
                            </div>
                            <h3 className="text-base font-semibold text-foreground mb-1">No results found</h3>
                            <p className="text-sm text-muted-foreground mb-4">Try a different keyword or switch platforms</p>
                            <Button variant="outline" size="sm" onClick={() => { setQuery(''); setSearched(false); }} className="gap-1.5">
                                <RefreshCw className="h-3.5 w-3.5" /> Clear & try again
                            </Button>
                        </div>
                    )}

                    {/* Results grid */}
                    {viewMode === 'search' && !loading && filteredResults.length > 0 && (
                        searchType === 'profiles' ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {filteredResults.map((item, i) => renderProfileCard(item, i))}
                            </div>
                        ) : (
                            <div className="flex gap-6 w-full items-start">
                                {(() => {
                                    const colCount = typeof window !== 'undefined' && window.innerWidth < 768 ? 1 : window.innerWidth < 1024 ? 2 : 3;
                                    const cols = Array.from({ length: colCount }, () => []);
                                    filteredResults.forEach((item, i) => {
                                        cols[i % colCount].push({ item, index: i });
                                    });
                                    return cols.map((colItems, colIndex) => (
                                        <div key={colIndex} className="flex-1 min-w-0 flex flex-col gap-6">
                                            {colItems.map(({ item, index }) => renderContentCard(item, index))}
                                        </div>
                                    ));
                                })()}
                            </div>
                        )
                    )}

                    {viewMode === 'history' && (
                        <div className="space-y-4">
                            <Card className="border-border/70 bg-gradient-to-b from-card to-card/90 overflow-hidden rounded-lg shadow-sm">
                                <CardContent className="p-2.5 sm:p-3">
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <h3 className="text-xs font-semibold text-foreground">Search History Filters</h3>
                                        {hasActiveHistoryFilters && (
                                            <button
                                                type="button"
                                                className="h-7 w-7 inline-flex items-center justify-center rounded-full border border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                                                onClick={() => setHistoryFilters({ q: '', searchType: 'all', platform: 'all', from: '', to: '' })}
                                                aria-label="Clear history filters"
                                                title="Clear filters"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2.6fr_1.2fr_1.2fr_1fr_1fr] gap-2">
                                        <Input
                                            placeholder="Search text"
                                            value={historyFilters.q}
                                            onChange={(e) => setHistoryFilters(prev => ({ ...prev, q: e.target.value }))}
                                            className="h-9 text-sm bg-background"
                                        />
                                        <Select value={historyFilters.searchType} onValueChange={(v) => setHistoryFilters(prev => ({ ...prev, searchType: v }))}>
                                            <SelectTrigger className="bg-background h-9 text-sm"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">All Types</SelectItem>
                                                <SelectItem value="profiles">Profiles</SelectItem>
                                                <SelectItem value="content">Content</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Select value={historyFilters.platform} onValueChange={(v) => setHistoryFilters(prev => ({ ...prev, platform: v }))}>
                                            <SelectTrigger className="bg-background h-9 text-sm"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {historyPlatformList.map((key) => (
                                                    <SelectItem key={key} value={key}>
                                                        {PLATFORMS[key]?.label || key}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Input
                                            type="date"
                                            value={historyFilters.from}
                                            onChange={(e) => setHistoryFilters(prev => ({ ...prev, from: e.target.value }))}
                                            className="h-9 text-sm bg-background"
                                        />
                                        <Input
                                            type="date"
                                            value={historyFilters.to}
                                            onChange={(e) => setHistoryFilters(prev => ({ ...prev, to: e.target.value }))}
                                            className="h-9 text-sm bg-background"
                                        />
                                    </div>
                                </CardContent>
                            </Card>

                            {historyLoading ? (
                                <div className="rounded-lg border border-border bg-card py-7 flex items-center justify-center text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading search history...
                                </div>
                            ) : historyItems.length === 0 ? (
                                <div className="rounded-lg border border-border bg-card p-5 text-center">
                                    <History className="h-7 w-7 mx-auto text-muted-foreground mb-1.5" />
                                    <p className="text-xs text-muted-foreground">No search history found for the selected filters.</p>
                                </div>
                            ) : historySelectedRecord ? (
                                <div className="space-y-4">
                                    <div className="rounded-lg border border-border bg-card px-3 py-3 sm:px-4 sm:py-3.5 space-y-3">
                                        <div className="min-w-0">
                                            <p className="text-base font-semibold text-foreground truncate">{historySelectedRecord.query}</p>
                                            <p className="text-xs text-muted-foreground mt-1">{formatISTFull(historySelectedRecord.searched_at)}</p>
                                        </div>
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <Badge variant="outline" className="text-[11px]">{historySelectedRecord.search_type}</Badge>
                                                <Badge variant="outline" className="text-[11px]">{PLATFORMS[historySelectedRecord.platform]?.label || historySelectedRecord.platform}</Badge>
                                                <span className="px-2 py-0.5 rounded-full text-[11px] bg-muted text-muted-foreground">{Number(historySelectedFilteredResults.length || 0).toLocaleString()} results</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={exportHistoryToPDF}
                                                    className="h-7 text-xs gap-1"
                                                >
                                                    <Download className="h-3.5 w-3.5" /> PDF
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={exportHistoryToExcel}
                                                    className="h-7 text-xs gap-1"
                                                >
                                                    <Download className="h-3.5 w-3.5" /> Excel
                                                </Button>
                                            </div>
                                        </div>
                                    </div>

                                    {historySelectedRecord.search_type === 'profiles' ? (
                                        historySelectedFilteredResults.length > 0 ? (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                                {historySelectedFilteredResults.map((item, i) => renderProfileCard(item, i, historyFilters.q))}
                                            </div>
                                        ) : (
                                            <div className="rounded-lg border border-border bg-card p-5 text-center text-sm text-muted-foreground">
                                                No history profile results matched current filters.
                                            </div>
                                        )
                                    ) : (
                                        historySelectedFilteredResults.length > 0 ? (
                                            <div className="flex gap-6 w-full items-start">
                                                {(() => {
                                                    const detailResults = historySelectedFilteredResults;
                                                    const colCount = typeof window !== 'undefined' && window.innerWidth < 768 ? 1 : window.innerWidth < 1024 ? 2 : 3;
                                                    const cols = Array.from({ length: colCount }, () => []);
                                                    detailResults.forEach((item, i) => {
                                                        cols[i % colCount].push({ item, index: i });
                                                    });
                                                    return cols.map((colItems, colIndex) => (
                                                        <div key={colIndex} className="flex-1 min-w-0 flex flex-col gap-6">
                                                            {colItems.map(({ item, index }) => renderContentCard(item, index, historyFilters.q))}
                                                        </div>
                                                    ));
                                                })()}
                                            </div>
                                        ) : (
                                            <div className="rounded-lg border border-border bg-card p-5 text-center text-sm text-muted-foreground">
                                                No history content results matched current filters.
                                            </div>
                                        )
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="space-y-3">
                                        {groupedHistoryItems.map((group) => (
                                            <div key={group.dateKey} className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
                                                <div className="px-3 py-2 bg-muted/45 border-b border-border/70">
                                                    <p className="text-xs font-semibold text-foreground">{group.label}</p>
                                                </div>
                                                <div>
                                                    {group.items.map((item) => (
                                                        <button
                                                            key={item.id}
                                                            type="button"
                                                            onClick={() => openHistoryRecord(item.id)}
                                                            disabled={historyDetailLoadingId === item.id}
                                                            className="w-full text-left px-3 py-2.5 border-b border-border/70 last:border-b-0 hover:bg-muted/40 transition-colors disabled:opacity-70"
                                                        >
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="min-w-0">
                                                                    <p className="text-sm font-semibold text-foreground truncate">{highlightText(item.query, historyFilters.q)}</p>
                                                                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                                                        <Badge variant="outline" className="text-[11px]">{item.search_type}</Badge>
                                                                        <Badge variant="outline" className="text-[11px]">{PLATFORMS[item.platform]?.label || item.platform}</Badge>
                                                                        <span className="px-2 py-0.5 rounded-full text-[11px] bg-muted text-muted-foreground">{Number(item.total_results || 0).toLocaleString()} results</span>
                                                                        {historyFilters.q?.trim() && (
                                                                            <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-100 text-emerald-700">
                                                                                {Number(item.matched_results_count || 0).toLocaleString()} matched
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-2 shrink-0">
                                                                    <span className="text-[11px] text-muted-foreground">{formatISTFull(item.searched_at)}</span>
                                                                    {historyDetailLoadingId === item.id ? (
                                                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                                                    ) : (
                                                                        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-1">
                                        <p className="text-xs text-muted-foreground">
                                            Page {historyPagination.page} of {historyPagination.totalPages}
                                        </p>
                                        <div className="flex gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={historyPagination.page <= 1 || historyLoading}
                                                onClick={() => loadHistory(historyPagination.page - 1)}
                                            >
                                                Previous
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={historyPagination.page >= historyPagination.totalPages || historyLoading}
                                                onClick={() => loadHistory(historyPagination.page + 1)}
                                            >
                                                Next
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}


                </div>
            </div>

            {/* Add Source Modal — same as Alerts/Sources/POI */}
            <AddSourceModal
                open={sourceModalOpen}
                onClose={() => setSourceModalOpen(false)}
                initialData={initialSourceData}
                onSuccess={() => {
                    toast.success(`Started monitoring ${initialSourceData?.display_name || initialSourceData?.identifier || 'source'}`);
                    setSourceModalOpen(false);
                }}
            />
        </div>
    );
};

export default GlobalSearch;
