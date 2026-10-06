import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { TwitterAlertCard } from '../components/AlertCards';
import AddSourceModal from '../components/AddSourceModal';
import api from '../lib/api';
import {
    Twitter, Search, Shield, AlertTriangle, Activity,
    BarChart2, Users, FileText, RefreshCw, ExternalLink,
    LayoutGrid, LayoutList, Filter, Trash2, ArrowLeft,
    ChevronRight, AlertOctagon, CheckCircle2,
    TrendingUp, Eye, Heart, MessageCircle,
    User, Calendar, AlertCircle, Repeat, Clock, Download, Tag, Pause, Play, Loader2, BadgeCheck, Plus,
    ShieldAlert, History
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { ScrollArea } from '../components/ui/scroll-area';
import { Progress } from '../components/ui/progress';
import { Skeleton } from '../components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { Checkbox } from '../components/ui/checkbox';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';

const RiskBadge = ({ level, score }) => {
    const colors = {
        low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        medium: 'bg-amber-50 text-amber-700 border-amber-200',
        high: 'bg-orange-50 text-orange-700 border-orange-200',
        critical: 'bg-red-50 text-red-700 border-red-200'
    };

    const icons = {
        low: Shield,
        medium: AlertTriangle,
        high: AlertOctagon,
        critical: AlertCircle
    };

    const Icon = icons[level] || Shield;

    return (
        <Badge
            variant="outline"
            className={cn(
                `${colors[level.toLowerCase()] || colors.low} font-semibold px-3 py-1.5`,
                "flex items-center gap-1.5 whitespace-nowrap"
            )}
        >
            <Icon className="h-3.5 w-3.5" />
            {level?.toUpperCase()} • {score}
        </Badge>
    );
};

const XMonitor = () => {
    const [activeTab, setActiveTab] = useState('overview');
    const [loading, setLoading] = useState(false);
    const [statsLoading, setStatsLoading] = useState(false);
    const [sources, setSources] = useState([]);
    const [tweets, setTweets] = useState([]);
    const [stats, setStats] = useState({
        totalSources: 0,
        totalTweets: 0,
        highRisk: 0,
        criticalRisk: 0,
        mediumRisk: 0,
        avgRiskScore: '0.0'
    });
    const [escalationStats, setEscalationStats] = useState({
        total: 0,
        pending: 0,
        active: 0,
        resolved: 0,
        loading: false
    });
    const [sourceHandle, setSourceHandle] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [sourceSearchQuery, setSourceSearchQuery] = useState('');
    const [officialSearchQuery, setOfficialSearchQuery] = useState('');
    const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);
    const [sourceCategory, setSourceCategory] = useState('unknown');
    const [sourcePriority, setSourcePriority] = useState('medium');
    const [sourceDisplayName, setSourceDisplayName] = useState('');
    const [sourceActive, setSourceActive] = useState(true);
    const [riskFilter, setRiskFilter] = useState('all');
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const [sortBy, setSortBy] = useState('latest');
    const [selectedSource, setSelectedSource] = useState(null);
    const [timeFilter, setTimeFilter] = useState('all'); // 'all', '1h', '6h', '24h', 'custom'
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [keywordFilter, setKeywordFilter] = useState('all'); // Filter by detected keyword
    const [viewMode, setViewMode] = useState('grid');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [sourceModalOpen, setSourceModalOpen] = useState(false);
    const [initialSourceData, setInitialSourceData] = useState(null);

    // Pagination State
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);

    const monitoredHandles = useMemo(() => {
        return sources.map(s => s.identifier).filter(Boolean);
    }, [sources]);
    const loadingRef = useRef(false);
    const selectedSourceRef = useRef(selectedSource);
    selectedSourceRef.current = selectedSource;

    // Helper: Format date to IST string
    const formatIST = (dateStr) => {
        if (!dateStr) return 'N/A';
        const date = new Date(dateStr);
        return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    };

    // Extract all unique keywords from tweets (Only from loaded tweets, which is acceptable for filter dropdown)
    const allKeywords = useMemo(() => {
        const keywordSet = new Set();
        tweets.forEach(tweet => {
            const factors = tweet.risk_factors || [];
            const triggered = tweet.analysis?.triggered_keywords || [];
            factors.forEach(f => keywordSet.add(f.keyword || f));
            triggered.forEach(k => keywordSet.add(k));
        });
        return Array.from(keywordSet).filter(k => k && k.trim()).sort();
    }, [tweets]);

    const filteredTweets = useMemo(() => {
        let filtered = [...tweets];

        // Filter by Selected Source if active
        if (selectedSource) {
            const handle = selectedSource.identifier.replace('@', '').toLowerCase();
            filtered = filtered.filter(tweet =>
                tweet.author_handle?.toLowerCase().replace('@', '') === handle ||
                tweet.author?.toLowerCase().includes(handle)
            );
        }

        // Apply TIME filter
        if (timeFilter !== 'all') {
            const now = new Date();
            let cutoff;
            if (timeFilter === '1h') cutoff = new Date(now.getTime() - 1 * 60 * 60 * 1000);
            else if (timeFilter === '6h') cutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
            else if (timeFilter === '24h') cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            else if (timeFilter === 'custom' && dateRange.start && dateRange.end) {
                const startD = new Date(dateRange.start);
                const endD = new Date(dateRange.end);
                filtered = filtered.filter(tweet => {
                    const pubDate = new Date(tweet.published_at);
                    return pubDate >= startD && pubDate <= endD;
                });
                cutoff = null; // Already filtered
            }
            if (cutoff) {
                filtered = filtered.filter(tweet => new Date(tweet.published_at) >= cutoff);
            }
        }

        // Apply search filter
        if (searchQuery) {
            filtered = filtered.filter(tweet =>
                tweet.text?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                tweet.author?.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }

        // Apply risk filter
        if (riskFilter !== 'all') {
            filtered = filtered.filter(tweet => (tweet.risk_level === riskFilter || tweet.analysis?.risk_level === riskFilter.toUpperCase()));
        }

        // Apply keyword filter
        if (keywordFilter !== 'all') {
            filtered = filtered.filter(tweet => {
                const factors = tweet.risk_factors?.map(f => f.keyword || f) || [];
                const triggered = tweet.analysis?.triggered_keywords || [];
                const allKws = [...factors, ...triggered].map(k => k.toLowerCase());
                return allKws.includes(keywordFilter.toLowerCase());
            });
        }

        // Apply sorting
        filtered.sort((a, b) => {
            switch (sortBy) {
                case 'latest':
                    return new Date(b.published_at) - new Date(a.published_at);
                case 'risk':
                    return (b.risk_score || b.analysis?.violence_score || 0) - (a.risk_score || a.analysis?.violence_score || 0);
                case 'views':
                    return (b.engagement?.views || 0) - (a.engagement?.views || 0);
                default:
                    return 0;
            }
        });

        return filtered;
    }, [tweets, searchQuery, riskFilter, sortBy, selectedSource, timeFilter, dateRange, keywordFilter]);

    // Helper to determine if a source is considered "Official"
    const isSourceOfficial = useCallback((s) => {
        const cat = (s.category || '').toLowerCase();
        const name = (s.display_name || '').toLowerCase();
        const handle = (s.identifier || '').toLowerCase();

        // Explicit Exclusion
        if (cat === 'general') return false;

        // Explicit category check
        if (['official', 'government', 'govt', 'party', 'public_representative'].includes(cat)) return true;

        // Verified Account Check (Blue/Gold/Grey Tick)
        if (s.is_verified) return true;

        // Heuristic keyword check (Temporary Quick Fix for existing data)
        const keywords = ['brs', 'congress', 'inc', 'bjp', 'aimim', 'mim', 'govt', 'official', 'telangana', 'hyderabad', 'police', 'collector', 'minister', 'cmo', 'office', 'media'];
        return keywords.some(k => name.includes(k) || handle.includes(k));
    }, []);

    const officialSources = useMemo(() => {
        return sources.filter(isSourceOfficial);
    }, [sources, isSourceOfficial]);

    // ... (lines 208-372 unchanged) ...

    // Toggle Official Status
    const handleMarkOfficial = async (source) => {
        try {
            // If already official (explicit or implicit), toggle to 'general' to remove it.
            // If not official, toggle to 'official' to add it.
            const currentlyOfficial = isSourceOfficial(source);
            const newCategory = currentlyOfficial ? 'general' : 'official';

            await api.put(`/sources/${source.id}`, { category: newCategory });

            setSources(sources.map(s =>
                s.id === source.id ? { ...s, category: newCategory } : s
            ));

            toast.success(`Source ${currentlyOfficial ? 'removed from' : 'marked as'} Official`);
        } catch (error) {
            console.error('Error updating source:', error);
            toast.error('Failed to update source status');
        }
    };

    const officialTweets = useMemo(() => {
        const officialSourceIds = new Set(officialSources.map(s => s.id));
        return filteredTweets.filter(t => officialSourceIds.has(t.source_id));
    }, [filteredTweets, officialSources]);

    // Export filtered tweets to Excel
    const exportToExcel = () => {
        if (filteredTweets.length === 0) {
            toast.error('No tweets to export');
            return;
        }

        const worksheetData = filteredTweets.map(tweet => ({
            'Author': tweet.author || 'N/A',
            'Handle': tweet.author_handle || 'N/A',
            'Tweet Content': tweet.text || 'N/A',
            'Published (IST)': formatIST(tweet.published_at),
            'Risk Level': tweet.risk_level || tweet.analysis?.risk_level || 'low',
            'Risk Score': tweet.risk_score || tweet.analysis?.violence_score || 0,
            'Keywords Detected': (tweet.risk_factors?.map(f => f.keyword || f).join(', ') || tweet.analysis?.triggered_keywords?.join(', ')) || 'None',
            'Views': tweet.engagement?.views || 0,
            'Likes': tweet.engagement?.likes || 0,
            'Retweets': tweet.engagement?.retweets || 0,
            'Tweet URL': tweet.content_url || 'N/A'
        }));

        const worksheet = XLSX.utils.json_to_sheet(worksheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Tweets');

        // Add metadata sheet
        const metaData = [
            { 'Field': 'Report Type', 'Value': selectedSource ? `Source: ${selectedSource.identifier}` : 'All Tweets' },
            { 'Field': 'Total Tweets', 'Value': filteredTweets.length },
            { 'Field': 'Keyword Filter', 'Value': keywordFilter === 'all' ? 'All Keywords' : keywordFilter },
            { 'Field': 'Risk Filter', 'Value': riskFilter === 'all' ? 'All Levels' : riskFilter },
            { 'Field': 'Time Filter', 'Value': timeFilter === 'all' ? 'All Time' : timeFilter },
            { 'Field': 'Generated At (IST)', 'Value': formatIST(new Date()) }
        ];
        const metaSheet = XLSX.utils.json_to_sheet(metaData);
        XLSX.utils.book_append_sheet(workbook, metaSheet, 'Report Info');

        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const data = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const filename = `x_monitor_${selectedSource ? selectedSource.identifier.replace('@', '') : 'all'}_${keywordFilter !== 'all' ? keywordFilter + '_' : ''}${new Date().toISOString().split('T')[0]}.xlsx`;
        saveAs(data, filename);
        toast.success('Excel report exported successfully');
    };

    useEffect(() => {
        fetchInitialData();
    }, []);

    // Handled in fetchInitialData for zero-refresh speed
    useEffect(() => {
        // fetchInitialData now handles this logic to avoid double-fetching
    }, [searchParams, sources, setSearchParams]);

    const fetchInitialData = async () => {
        setStatsLoading(true);
        try {
            // Coordinator for initial parallel fetch
            const handleParam = searchParams.get('handle');

            const [srcRes, statsRes] = await Promise.all([
                api.get('/sources?platform=x'),
                api.get('/content/stats?platform=x')
            ]);

            const sourcesData = Array.isArray(srcRes.data) ? srcRes.data : (srcRes.data?.data || []);
            setSources(sourcesData);
            setStats({
                ...statsRes.data,
                totalSources: sourcesData.length
            });

            // If we have a handle param, we need to wait for sources to find the right one
            if (handleParam) {
                const source = srcRes.data.find(s =>
                    s.identifier.replace('@', '').toLowerCase() === handleParam.toLowerCase()
                );
                if (source) {
                    setSelectedSource(source);
                    setActiveTab('overview');
                    window.scrollTo(0, 0);

                    const nextParams = new URLSearchParams(searchParams);
                    nextParams.delete('handle');
                    setSearchParams(nextParams, { replace: true });
                } else {
                    // Even if not found, fetch tweets for the main view
                    fetchTweetsPage(1, true);
                }
            } else if (!selectedSource) {
                // Initial load without specific source
                fetchTweetsPage(1, true);
            }
        } catch (error) {
            console.error('Initial fetch failed:', error);
            toast.error('Failed to load X data');
        } finally {
            setStatsLoading(false);
        }
    };

    const fetchTweetsPage = async (pageNum, reset = false) => {
        if (pageNum > 1 && !hasMore) return;
        setLoading(true);
        try {
            const limit = pageNum === 1 ? 25 : 100; // Faster first load, larger subsequent loads
            const sourceParam = selectedSourceRef.current ? `&source_id=${selectedSourceRef.current.id}` : '';
            const res = await api.get(`/content?platform=x&page=${pageNum}&limit=${limit}${sourceParam}`);

            const newTweets = Array.isArray(res.data) ? res.data : (res.data.content || res.data.items || []);
            if (reset) {
                setTweets(newTweets);
            } else {
                setTweets(prev => [...prev, ...newTweets]);
            }
            setHasMore(newTweets.length === limit);
            setPage(pageNum);
        } catch (error) {
            console.error('Failed to fetch tweets:', error);
            toast.error('Failed to load tweets');
        } finally {
            setLoading(false);
        }
    };

    const fetchEscalationStats = async (handle) => {
        if (!handle) return;
        setEscalationStats(prev => ({ ...prev, loading: true }));
        try {
            const res = await api.get(`/reports?search=${encodeURIComponent(handle)}`);
            const reports = res.data || [];

            setEscalationStats({
                escalated: reports.length, // Total "Escalated"
                sentToIntermediary: reports.filter(r => ['sent', 'sent_to_intermediary', 'awaiting_reply'].includes(r.status)).length, // "Sent to Intermediary"
                closed: reports.filter(r => ['closed', 'resolved'].includes(r.status)).length, // "Closed"
                loading: false
            });
        } catch (error) {
            console.error('Failed to fetch escalation stats:', error);
            setEscalationStats(prev => ({ ...prev, loading: false }));
        }
    };

    // Refetch tweets when source changes
    useEffect(() => {
        fetchTweetsPage(1, true);
        if (selectedSource) {
            window.scrollTo(0, 0);
            fetchEscalationStats(selectedSource.identifier);
        }
    }, [selectedSource]);

    // Function to load more
    const loadMoreTweets = useCallback(() => {
        if (!loadingRef.current && hasMore) {
            fetchTweetsPage(page + 1);
        }
    }, [hasMore, page]);

    // Infinite Scroll Ref
    const observer = useRef();
    const lastElementRef = useCallback(node => {
        if (loading) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
                loadMoreTweets();
            }
        });
        if (node) observer.current.observe(node);
    }, [loading, hasMore, loadMoreTweets]);



    const handleAddSource = async (e) => {
        e.preventDefault();
        if (!sourceHandle.trim()) {
            toast.error('Please enter a handle');
            return;
        }

        try {
            // Identifier is the handle
            await api.post('/sources', {
                platform: 'x',
                identifier: sourceHandle,
                display_name: sourceDisplayName || sourceHandle,
                category: sourceCategory,
                priority: sourcePriority,
                is_active: sourceActive
            });
            toast.success('Source added successfully');
            setSourceHandle('');
            setSourceDisplayName('');
            setSourceCategory('unknown');
            setSourcePriority('medium');
            setSourceActive(true);
            setIsAddSourceOpen(false);
            fetchInitialData();
        } catch (e) {
            toast.error(e.response?.data?.message || 'Failed to add source');
        }
    };
    const handleDeleteSource = async (id) => {
        if (!window.confirm('Are you sure you want to stop monitoring this source?')) return;
        try {
            await api.delete(`/sources/${id}`);
            toast.success('Source removed');
            if (selectedSource?.id === id) setSelectedSource(null);
            fetchInitialData();
        } catch (e) {
            toast.error('Failed to remove source');
        }
    };

    const handleBulkToggle = async (isActive, contextSources = sources) => {
        const targetSources = selectedIds.size > 0
            ? sources.filter(s => selectedIds.has(s.id))
            : contextSources; // Context-aware fallback

        if (targetSources.length === 0) return;

        try {
            toast.promise(
                Promise.all(targetSources.map(s =>
                    api.put(`/sources/${s.id}`, { ...s, is_active: isActive })
                )),
                {
                    loading: `${isActive ? 'Resuming' : 'Pausing'} ${targetSources.length} sources...`,
                    success: () => {
                        fetchInitialData();
                        setSelectedIds(new Set()); // Clear selection after action
                        return `${isActive ? 'Resumed' : 'Paused'} ${targetSources.length} sources`;
                    },
                    error: 'Failed to update sources'
                }
            );
        } catch (error) {
            toast.error('Bulk update failed');
        }
    };

    const handleSelectAll = (checked, contextSources = sources) => {
        if (checked) {
            setSelectedIds(new Set(contextSources.map(s => s.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectRow = (id, checked) => {
        const newSelected = new Set(selectedIds);
        if (checked) {
            newSelected.add(id);
        } else {
            newSelected.delete(id);
        }
        setSelectedIds(newSelected);
    };

    const handleToggleSource = async (source) => {
        try {
            const res = await api.put(`/sources/${source.id}/toggle`);
            toast.success(res.data.message);
            fetchInitialData();
        } catch (e) {
            toast.error('Failed to toggle source status');
        }
    };

    // Download Handler
    const handleInternalProfileClick = (handle) => {
        if (!handle) return;
        const cleanHandle = handle.replace('@', '').toLowerCase();
        const source = sources.find(s =>
            s.identifier.replace('@', '').toLowerCase() === cleanHandle
        );
        if (source) {
            setSelectedSource(source);
        } else {
            setSearchParams({ handle: cleanHandle });
        }
    };

    const handleDownload = async (item) => {
        const toastId = toast.loading('Preparing download...');
        try {
            const tweetUrl = item.content_url || `https://twitter.com/${item.author_handle}/status/${item.source_id}`;

            // Send snake_case media_url as expected by backend
            const response = await api.post('/media/download-video', { media_url: tweetUrl });

            if (response.data && response.data.download_url) {
                // Backend returns absolute URL, use it directly
                const fileUrl = response.data.download_url;

                // Trigger download
                const link = document.createElement('a');
                link.href = fileUrl;
                link.setAttribute('download', '');
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                toast.success('Download started', { id: toastId });
            } else {
                toast.error('Download preparation failed', { id: toastId });
            }
        } catch (error) {
            console.error('Download error:', error);
            toast.error(error.response?.data?.error || 'Failed to download media. It might be restricted or text-only.', { id: toastId });
        }
    };

    const renderTweetCard = (tweet, mode = 'list') => (
        <TwitterAlertCard
            key={tweet.id}
            alert={tweet}
            content={tweet}
            source={{ name: tweet.author, handle: tweet.author_handle }}
            hideActions={true}
            viewMode={mode}
            monitoredHandles={monitoredHandles}
            onAddSource={(data) => {
                setInitialSourceData(data);
                setSourceModalOpen(true);
            }}
        />
    );

    return (
        <div className="p-6 md:p-8 max-w-[1800px] mx-auto space-y-8">
            {/* Header */}
            <div className="flex flex-col lg:flex-row justify-between gap-6">
                <div className="space-y-3">
                    <div className="flex items-center gap-3">
                        {selectedSource ? (
                            <Button variant="ghost" size="icon" onClick={() => setSelectedSource(null)} className="mr-2">
                                <ChevronRight className="h-6 w-6 rotate-180" />
                            </Button>
                        ) : (
                            <div className="p-2.5 rounded-xl bg-black shadow-lg">
                                <Twitter className="h-7 w-7 text-white" />
                            </div>
                        )}
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
                                {selectedSource ? selectedSource.display_name : 'X Monitor'}
                            </h1>
                            <p className="text-muted-foreground mt-1 flex items-center gap-2">
                                <Shield className="h-4 w-4" />
                                {selectedSource ? `Monitoring since ${new Date(selectedSource.created_at).toLocaleDateString()}` : 'Real-time tweet monitoring and risk detection'}
                            </p>
                        </div>
                    </div>
                </div>
                {!selectedSource && (
                    <div className="flex flex-col sm:flex-row gap-3">
                        <Button
                            variant="outline"
                            onClick={fetchInitialData}
                            disabled={loading}
                            className="gap-2"
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                            {loading ? 'Refreshing...' : 'Refresh Data'}
                        </Button>
                        <Button
                            className="gap-2 bg-black hover:bg-gray-800 shadow-lg text-white"
                            onClick={() => {
                                setSourceCategory('unknown');
                                setIsAddSourceOpen(true);
                            }}
                        >
                            <Plus className="h-4 w-4" />
                            Add Source
                        </Button>

                        <Dialog open={isAddSourceOpen} onOpenChange={setIsAddSourceOpen}>
                            <DialogContent className="sm:max-w-md bg-white">
                                <DialogHeader>
                                    <DialogTitle>Monitor New X Account</DialogTitle>
                                    <DialogDescription>
                                        Add an X handle (e.g., @BJP4CGState) for monitoring.
                                    </DialogDescription>
                                </DialogHeader>
                                <form onSubmit={handleAddSource} className="space-y-4 pt-2">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Handle</Label>
                                            <Input
                                                placeholder="@handle"
                                                value={sourceHandle}
                                                onChange={e => setSourceHandle(e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Priority</Label>
                                            <Select value={sourcePriority} onValueChange={setSourcePriority}>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="high">High</SelectItem>
                                                    <SelectItem value="medium">Medium</SelectItem>
                                                    <SelectItem value="low">Low</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Display Name</Label>
                                        <Input
                                            placeholder="Display Name (optional)"
                                            value={sourceDisplayName}
                                            onChange={e => setSourceDisplayName(e.target.value)}
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Category</Label>
                                        <Select value={sourceCategory} onValueChange={setSourceCategory}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select category" />
                                            </SelectTrigger>
                                            <SelectContent className="max-h-[200px]">
                                                <SelectItem value="unknown">General / Unknown</SelectItem>
                                                <SelectItem value="official">Official Handle</SelectItem>
                                                <SelectItem value="government">Government Body</SelectItem>
                                                <SelectItem value="party">Political Party</SelectItem>
                                                <SelectItem value="news">News</SelectItem>
                                                <SelectItem value="media">Media</SelectItem>
                                                <SelectItem value="political">Political</SelectItem>
                                                <SelectItem value="influencer">Influencer</SelectItem>
                                                <SelectItem value="high_risk">High Risk</SelectItem>
                                                <SelectItem value="security">Security</SelectItem>
                                                {[
                                                    'entertainment', 'sports', 'technology', 'business',
                                                    'education', 'health', 'lifestyle', 'gaming',
                                                    'finance', 'science', 'travel', 'food', 'fashion',
                                                    'art', 'music'
                                                ].sort().map(cat => (
                                                    <SelectItem key={cat} value={cat} className="capitalize">{cat}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                                        <div className="space-y-0.5">
                                            <Label>Active Monitoring</Label>
                                            <p className="text-xs text-muted-foreground">Enable real-time monitoring</p>
                                        </div>
                                        <Switch
                                            checked={sourceActive}
                                            onCheckedChange={setSourceActive}
                                        />
                                    </div>

                                    <Button type="submit" className="w-full h-11 bg-black text-white hover:bg-gray-800">Start Monitoring</Button>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </div>
                )}
            </div>

            {/* Content Area */}
            {selectedSource ? (
                <div className="space-y-6">
                    {/* Profile Header Card */}
                    <Card className="overflow-hidden border-border bg-card">
                        <div className="h-32 bg-gradient-to-r from-blue-600 to-cyan-500 relative">
                            <div className="absolute bottom-4 right-4 flex gap-2">
                                <Button variant="secondary" size="sm" className="bg-white/90 hover:bg-white text-black text-xs font-semibold backdrop-blur-sm" onClick={() => window.open(`https://twitter.com/${selectedSource.identifier.replace('@', '')}`, '_blank')}>
                                    <ExternalLink className="h-3 w-3 mr-1.5" />
                                    View on X
                                </Button>
                                <Button variant="destructive" size="sm" className="text-xs font-semibold shadow-sm" onClick={() => handleDeleteSource(selectedSource.id)}>
                                    <Trash2 className="h-3 w-3 mr-1.5" />
                                    Stop Monitoring
                                </Button>
                            </div>
                        </div>
                        <CardContent className="pt-0 relative">
                            <div className="flex flex-col md:flex-row gap-6 items-start justify-between w-full">
                                <div className="flex flex-col md:flex-row gap-6 items-start">
                                    <Avatar className="h-24 w-24 border-4 border-card -mt-12 rounded-2xl shadow-lg">
                                        <AvatarImage src={selectedSource.profile_image_url} />
                                        <AvatarFallback className="text-2xl font-bold bg-black text-white">
                                            {selectedSource.display_name[0]}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="mt-4 md:mt-2 space-y-1">
                                        <div className="flex items-center gap-2">
                                            <h2 className="text-2xl font-bold">{selectedSource.display_name}</h2>
                                            {selectedSource.is_verified && <BadgeCheck className="h-5 w-5 text-blue-500" />}
                                            {selectedSource.category === 'high_risk' && (
                                                <Badge variant="destructive" className="ml-2 text-xs">High Risk Entity</Badge>
                                            )}
                                        </div>
                                        <p className="text-muted-foreground font-medium">{selectedSource.identifier}</p>
                                        <div className="flex gap-4 text-sm text-muted-foreground mt-2">
                                            <div className="flex items-center gap-1.5">
                                                <Calendar className="h-4 w-4" />
                                                Since {new Date(selectedSource.created_at).toLocaleDateString()}
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Activity className="h-4 w-4" />
                                                {filteredTweets.length} Tweets Analyzed
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 md:mt-0 hidden lg:flex items-center gap-5 bg-slate-50/80 backdrop-blur-sm p-3 rounded-xl border border-slate-200/60 shadow-sm mr-2">
                                    <div className="flex flex-col items-center px-4 min-w-[80px]">
                                        {escalationStats.loading ? (
                                            <Skeleton className="h-8 w-10 mb-1" />
                                        ) : (
                                            <span className="text-3xl font-bold text-purple-600">{escalationStats.escalated}</span>
                                        )}
                                        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider text-center leading-tight mt-1">NO OF TIMES<br />ESCALATED</span>
                                    </div>

                                    <div className="h-10 w-px bg-slate-200"></div>

                                    <div className="flex flex-col items-center px-4 min-w-[80px]">
                                        {escalationStats.loading ? (
                                            <Skeleton className="h-8 w-10 mb-1" />
                                        ) : (
                                            <span className="text-3xl font-bold text-blue-600">{escalationStats.sentToIntermediary}</span>
                                        )}
                                        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider text-center leading-tight mt-1">SENT TO<br />INTERMEDIARY</span>
                                    </div>

                                    <div className="h-10 w-px bg-slate-200"></div>

                                    <div className="flex flex-col items-center px-4 min-w-[80px]">
                                        {escalationStats.loading ? (
                                            <Skeleton className="h-8 w-10 mb-1" />
                                        ) : (
                                            <span className="text-3xl font-bold text-green-600">{escalationStats.closed}</span>
                                        )}
                                        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider text-center leading-tight mt-1">CLOSED</span>
                                    </div>

                                    <div className="h-8 w-px bg-slate-200 mx-1"></div>

                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 font-medium h-9 gap-2"
                                        onClick={() => {
                                            if (selectedSource?.identifier) {
                                                navigate(`/alerts?status=reports&handle=${encodeURIComponent(selectedSource.identifier)}`);
                                                window.scrollTo(0, 0);
                                            }
                                        }}
                                    >
                                        View History
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Tabs defaultValue="tweets" className="space-y-6">
                        <TabsList className="bg-background border p-1 h-auto w-full justify-start overflow-x-auto no-scrollbar flex-nowrap">
                            <TabsTrigger value="tweets" className="px-6 py-2.5">
                                <Twitter className="h-4 w-4 mr-2" />
                                Tweets
                            </TabsTrigger>
                            <TabsTrigger value="analysis" className="px-6 py-2.5">
                                <BarChart2 className="h-4 w-4 mr-2" />
                                Risk Analytics
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="tweets" className="space-y-4">
                            {/* Filter Controls */}
                            <div className="flex flex-wrap gap-3 mb-4 items-center justify-between">
                                <div className="flex flex-wrap gap-3 items-start">
                                    <Select value={timeFilter} onValueChange={setTimeFilter}>
                                        <SelectTrigger className="w-[150px] bg-white">
                                            <Clock className="h-4 w-4 mr-2" />
                                            <SelectValue placeholder="Time" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white border shadow-lg">
                                            <SelectItem value="all">All Time</SelectItem>
                                            <SelectItem value="1h">Last 1 Hour</SelectItem>
                                            <SelectItem value="6h">Last 6 Hours</SelectItem>
                                            <SelectItem value="24h">Last 24 Hours</SelectItem>
                                            <SelectItem value="custom">Custom Range</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    {allKeywords.length > 0 && (
                                        <Select value={keywordFilter} onValueChange={setKeywordFilter}>
                                            <SelectTrigger className="w-[180px] bg-white">
                                                <Tag className="h-4 w-4 mr-2" />
                                                <SelectValue placeholder="Filter Keyword" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white border shadow-lg max-h-[300px]">
                                                <SelectItem value="all">All Keywords</SelectItem>
                                                {allKeywords.map(kw => (
                                                    <SelectItem key={kw} value={kw}>{kw}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                    {timeFilter === 'custom' && (
                                        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center p-3 bg-muted/50 rounded-lg border">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-xs text-muted-foreground font-medium">From</span>
                                                <Input
                                                    type="datetime-local"
                                                    value={dateRange.start}
                                                    onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                                                    className="w-[200px] bg-white"
                                                />
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <span className="text-xs text-muted-foreground font-medium">To</span>
                                                <Input
                                                    type="datetime-local"
                                                    value={dateRange.end}
                                                    onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                                                    className="w-[200px] bg-white"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-2">
                                    <Download className="h-4 w-4" />
                                    Export Excel
                                </Button>
                            </div>
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Badge variant="secondary">{filteredTweets.length} tweets</Badge>
                                    {keywordFilter !== 'all' && (
                                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                                            Keyword: {keywordFilter}
                                        </Badge>
                                    )}
                                </div>

                                <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border">
                                    <Button
                                        variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                                        size="sm"
                                        onClick={() => setViewMode('list')}
                                        className={cn(
                                            "h-8 w-8 p-0",
                                            viewMode === 'list' && "bg-white shadow-sm"
                                        )}
                                        title="List View"
                                    >
                                        <LayoutList className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                                        size="sm"
                                        onClick={() => setViewMode('grid')}
                                        className={cn(
                                            "h-8 w-8 p-0",
                                            viewMode === 'grid' && "bg-white shadow-sm"
                                        )}
                                        title="Grid View"
                                    >
                                        <LayoutGrid className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            {filteredTweets.length > 0 ? (
                                <div className={cn(
                                    viewMode === 'grid'
                                        ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
                                        : "space-y-4 max-w-[800px] mx-auto"
                                )}>
                                    {filteredTweets.map(tweet => (
                                        <div key={tweet.id} className={cn(viewMode === 'list' ? "w-full" : "h-full")}>
                                            {renderTweetCard(tweet, viewMode)}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-16 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                                    <Twitter className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                                    <h3 className="text-lg font-semibold text-foreground">No tweets found</h3>
                                    <p>We haven't detected any tweets from this source yet.</p>
                                </div>
                            )}

                            {hasMore && (
                                <div ref={lastElementRef} className="py-8 flex flex-col items-center gap-4 min-h-[80px]">
                                    {loading && (
                                        <div className="flex flex-col items-center gap-3 animate-in fade-in duration-300">
                                            <div className="relative">
                                                <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full"></div>
                                                <Loader2 className="h-8 w-8 animate-spin text-blue-600 relative z-10" />
                                            </div>
                                            <p className="text-sm font-medium text-muted-foreground animate-pulse">Fetching more tweets...</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="analysis">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <Card>
                                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total Volume</CardTitle></CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold">{filteredTweets.length}</div>
                                        <p className="text-xs text-muted-foreground mt-1">Total analyzed tweets</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Risk Profile</CardTitle></CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-red-600">{filteredTweets.filter(t => (t.risk_level === 'high' || t.analysis?.risk_level === 'HIGH')).length}</div>
                                        <p className="text-xs text-muted-foreground mt-1">High risk alerts generated</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Average Threat Score</CardTitle></CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-orange-600">
                                            {(filteredTweets.reduce((acc, t) => acc + (t.risk_score || t.analysis?.violence_score || 0), 0) / (filteredTweets.length || 1)).toFixed(1)}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">Out of 1000</p>
                                    </CardContent>
                                </Card>
                            </div>
                        </TabsContent>


                    </Tabs>
                </div>
            ) : (
                <>
                    {/* Stats Overview */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {[
                            { label: 'Monitored Accounts', value: stats.totalSources, icon: Users, color: 'bg-blue-50', iconColor: 'text-blue-600' },
                            { label: 'Analyzed Tweets', value: stats.totalTweets, icon: FileText, color: 'bg-purple-50', iconColor: 'text-purple-600' },
                            { label: 'High Risk Content', value: stats.highRisk, icon: AlertTriangle, color: 'bg-red-50', iconColor: 'text-red-600', textColor: 'text-red-600' },
                            { label: 'Critical Risk', value: stats.criticalRisk, icon: AlertOctagon, color: 'bg-red-100', iconColor: 'text-red-800', textColor: 'text-red-800' }
                        ].map((s, i) => (
                            <Card key={i} className="hover:shadow-lg transition-all bg-card border-border">
                                <CardContent className="pt-6">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-2">
                                            <p className="text-sm font-medium text-muted-foreground">{s.label}</p>
                                            {statsLoading ? (
                                                <Skeleton className="h-9 w-20" />
                                            ) : (
                                                <h3 className={cn("text-3xl font-bold", s.textColor)}>{s.value}</h3>
                                            )}
                                        </div>
                                        <div className={cn("p-3 rounded-full", s.color)}>
                                            <s.icon className={cn("h-6 w-6", s.iconColor)} />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    {/* Main Tabs */}
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                        <TabsList className="bg-background border p-1 h-auto">
                            <TabsTrigger value="overview" className="px-4 py-2.5">
                                <LayoutGrid className="h-4 w-4 mr-2" />
                                Overview
                            </TabsTrigger>
                            <TabsTrigger value="sources" className="px-4 py-2.5">
                                <Users className="h-4 w-4 mr-2" />
                                Sources ({sources.length})
                            </TabsTrigger>
                            <TabsTrigger value="official" className="px-4 py-2.5">
                                <BadgeCheck className="h-4 w-4 mr-2 text-blue-500" />
                                Official Handles ({officialSources.length})
                            </TabsTrigger>
                            <TabsTrigger value="tweets" className="px-4 py-2.5">
                                <Twitter className="h-4 w-4 mr-2" />
                                All Tweets ({stats.totalTweets})
                            </TabsTrigger>
                        </TabsList>

                        {/* Overview Tab */}
                        <TabsContent value="overview" className="space-y-6">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Recent High Risk Alerts */}
                                <Card className="col-span-1">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <AlertOctagon className="h-5 w-5 text-red-600" />
                                            Recent High Risk Alerts
                                        </CardTitle>
                                        <CardDescription>Latest critical threats detected across all sources.</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-4">
                                            {loading && tweets.length === 0 ? (
                                                [...Array(5)].map((_, i) => (
                                                    <div key={i} className="flex gap-3 p-3 rounded-lg border bg-muted/10 animate-pulse">
                                                        <Skeleton className="h-8 w-8 rounded-full" />
                                                        <div className="flex-1 space-y-2">
                                                            <div className="flex justify-between items-center">
                                                                <Skeleton className="h-4 w-24" />
                                                                <Skeleton className="h-4 w-12" />
                                                            </div>
                                                            <Skeleton className="h-3 w-full" />
                                                            <Skeleton className="h-3 w-2/3" />
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                filteredTweets
                                                    .filter(t => {
                                                        const isHighRisk = t.risk_level === 'high' || t.risk_level === 'critical' || t.analysis?.risk_level === 'HIGH' || t.analysis?.risk_level === 'CRITICAL';
                                                        const hasAI = (t.risk_factors || t.analysis?.triggered_keywords || []).some(k => (k.keyword || k).toString().includes('[AI]'));
                                                        return isHighRisk || hasAI;
                                                    })
                                                    .slice(0, 5)
                                                    .map(tweet => (
                                                        <div key={tweet.id} className="flex gap-3 p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors group">
                                                            <Avatar
                                                                className="h-8 w-8 cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
                                                                onClick={() => handleInternalProfileClick(tweet.author_handle)}
                                                            >
                                                                <AvatarFallback className="bg-muted text-[10px]">{tweet.author[0]}</AvatarFallback>
                                                            </Avatar>
                                                            <div className="flex-1 space-y-1">
                                                                <div className="flex items-center justify-between">
                                                                    <span
                                                                        className="font-semibold text-sm cursor-pointer hover:text-blue-600 hover:underline"
                                                                        onClick={() => handleInternalProfileClick(tweet.author_handle)}
                                                                    >
                                                                        {tweet.author}
                                                                    </span>
                                                                    <RiskBadge level={tweet.risk_level || tweet.analysis?.risk_level} score={tweet.risk_score || tweet.analysis?.violence_score} />
                                                                </div>
                                                                <p className="text-xs text-muted-foreground line-clamp-2">{tweet.text}</p>
                                                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1">
                                                                    <span>{formatIST(tweet.published_at)}</span>
                                                                    <span>•</span>
                                                                    <a href={tweet.content_url} target="_blank" rel="noopener noreferrer" className="hover:underline text-blue-500">View Tweet</a>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))
                                            )}
                                            {!loading && filteredTweets.filter(t => {
                                                const isHighRisk = t.risk_level === 'high' || t.risk_level === 'critical' || t.analysis?.risk_level === 'HIGH' || t.analysis?.risk_level === 'CRITICAL';
                                                const hasAI = (t.risk_factors || t.analysis?.triggered_keywords || []).some(k => (k.keyword || k).toString().includes('[AI]'));
                                                return isHighRisk || hasAI;
                                            }).length === 0 && (
                                                    <div className="text-center py-8 text-muted-foreground">
                                                        <Shield className="h-8 w-8 mx-auto mb-2 text-emerald-500/50" />
                                                        <p>No high risk alerts detected recently.</p>
                                                    </div>
                                                )}
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* System Status / Quick Stats */}
                                <div className="space-y-6">
                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="flex items-center gap-2">
                                                <Activity className="h-5 w-5 text-blue-600" />
                                                System Status
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-green-100 rounded-full">
                                                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-sm">X Data API</p>
                                                        <p className="text-xs text-muted-foreground">RapidAPI (Twttr)</p>
                                                    </div>
                                                </div>
                                                <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">Operational</Badge>
                                            </div>
                                            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-blue-100 rounded-full">
                                                        <Clock className="h-4 w-4 text-blue-600" />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-sm">Last Sync</p>
                                                        <p className="text-xs text-muted-foreground">{new Date().toLocaleTimeString()}</p>
                                                    </div>
                                                </div>
                                                <Badge variant="secondary">15m Interval</Badge>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card>
                                        <CardHeader>
                                            <CardTitle>Top Keywords Detected</CardTitle>
                                            <CardDescription>Most frequent triggers in monitored tweets.</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="flex flex-wrap gap-2">
                                                {Array.from(new Set(tweets.flatMap(t => (t.risk_factors?.map(r => r.keyword) || t.analysis?.triggered_keywords || [])))).slice(0, 10).map((kw, i) => (
                                                    <Badge key={i} variant="outline" className="px-3 py-1 bg-secondary/50">
                                                        {kw}
                                                    </Badge>
                                                ))}
                                                {tweets.flatMap(t => t.analysis?.triggered_keywords || []).length === 0 && (
                                                    <span className="text-sm text-muted-foreground">No keywords detected yet.</span>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="official" className="space-y-6">
                            <Card>
                                <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between space-y-0 pb-6">
                                    <div className="space-y-1.5">
                                        <CardTitle className="flex items-center gap-2">
                                            <BadgeCheck className="h-5 w-5 text-blue-500" />
                                            Official Communications
                                        </CardTitle>
                                        <CardDescription>
                                            Monitoring official government and party handles.
                                        </CardDescription>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto items-end md:items-center">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setSourceCategory('official');
                                                setIsAddSourceOpen(true);
                                            }}
                                            className="h-8 gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            Add Profile
                                        </Button>
                                        <div className="relative w-full sm:w-[250px]">
                                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                placeholder="Search official profiles..."
                                                value={officialSearchQuery}
                                                onChange={e => setOfficialSearchQuery(e.target.value)}
                                                className="pl-9 h-9"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => handleBulkToggle(true, officialSources)}>
                                                <Play className="h-4 w-4 mr-2" /> Resume {selectedIds.size > 0 ? `Selected` : 'All'}
                                            </Button>
                                            <Button size="sm" variant="outline" className="text-amber-600 border-amber-200 hover:bg-amber-50" onClick={() => handleBulkToggle(false, officialSources)}>
                                                <Pause className="h-4 w-4 mr-2" /> Pause {selectedIds.size > 0 ? `Selected` : 'All'}
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[50px]">
                                                    <Checkbox
                                                        checked={officialSources.length > 0 && officialSources.every(s => selectedIds.has(s.id))}
                                                        onCheckedChange={(checked) => handleSelectAll(checked, officialSources)}
                                                    />
                                                </TableHead>
                                                <TableHead>Handle</TableHead>
                                                <TableHead>Display Name</TableHead>
                                                <TableHead>Last Checked</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {officialSources.filter(source =>
                                                !officialSearchQuery ||
                                                source.display_name.toLowerCase().includes(officialSearchQuery.toLowerCase()) ||
                                                source.identifier.toLowerCase().includes(officialSearchQuery.toLowerCase()) ||
                                                (source.is_active ? 'active' : 'paused').includes(officialSearchQuery.toLowerCase())
                                            ).map(source => {
                                                const updateCount = officialTweets.filter(t => t.source_id === source.id).length;
                                                return (
                                                    <TableRow
                                                        key={source.id}
                                                        className={`cursor-pointer hover:bg-muted/50 ${selectedIds.has(source.id) ? 'bg-muted/50' : ''}`}
                                                        onClick={() => setSelectedSource(source)}
                                                    >
                                                        <TableCell onClick={(e) => e.stopPropagation()}>
                                                            <Checkbox
                                                                checked={selectedIds.has(source.id)}
                                                                onCheckedChange={(checked) => handleSelectRow(source.id, checked)}
                                                            />
                                                        </TableCell>
                                                        <TableCell className="font-medium text-blue-600 flex items-center gap-2">
                                                            {source.identifier}
                                                            {source.is_verified && <BadgeCheck className="h-4 w-4 text-blue-500" />}
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-3">
                                                                <Avatar className="h-9 w-9 border">
                                                                    <AvatarImage src={source.profile_image_url} alt={source.display_name} />
                                                                    <AvatarFallback>{source.display_name[0]}</AvatarFallback>
                                                                </Avatar>
                                                                <div className="flex flex-col">
                                                                    <span className="font-medium text-sm">{source.display_name}</span>
                                                                    {updateCount > 0 && (
                                                                        <Badge variant="secondary" className="mt-1 w-fit text-[10px] bg-blue-50 text-blue-700">
                                                                            {updateCount} New
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>{source.last_checked ? formatIST(source.last_checked) : 'Never'}</TableCell>
                                                        <TableCell>
                                                            <Badge variant={source.is_active ? 'default' : 'secondary'} className={source.is_active ? 'bg-emerald-500' : ''}>
                                                                {source.is_active ? 'Active' : 'Paused'}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => handleMarkOfficial(source)}
                                                                    className={isSourceOfficial(source) ? 'text-blue-500 hover:text-blue-700' : 'text-slate-400 hover:text-blue-500'}
                                                                    title={isSourceOfficial(source) ? 'Remove from Official' : 'Mark as Official'}
                                                                >
                                                                    <BadgeCheck className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => handleToggleSource(source)}
                                                                    className={source.is_active ? 'text-orange-500 hover:text-orange-700' : 'text-green-500 hover:text-green-700'}
                                                                    title={source.is_active ? 'Pause monitoring' : 'Resume monitoring'}
                                                                >
                                                                    {source.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                                                </Button>
                                                                <Button variant="ghost" size="icon" onClick={() => handleDeleteSource(source.id)} className="text-red-500 hover:text-red-700">
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            })}
                                            {officialSources.length === 0 && (
                                                <TableRow>
                                                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                        No Official Profiles Found.
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* Sources Tab */}
                        <TabsContent value="sources" className="space-y-6">
                            <Card>
                                <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between space-y-0 pb-6">
                                    <div className="space-y-1.5">
                                        <CardTitle>Monitored X Accounts</CardTitle>
                                        <CardDescription>Click on a source row to view detailed activity.</CardDescription>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto items-end md:items-center">
                                        <div className="relative w-full sm:w-[250px]">
                                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                type="search"
                                                placeholder="Search sources..."
                                                className="pl-9 h-9"
                                                value={sourceSearchQuery}
                                                onChange={(e) => setSourceSearchQuery(e.target.value)}
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => handleBulkToggle(true)}>
                                                <Play className="h-4 w-4 mr-2" /> Resume {selectedIds.size > 0 ? `Selected (${selectedIds.size})` : 'All'}
                                            </Button>
                                            <Button size="sm" variant="outline" className="text-amber-600 border-amber-200 hover:bg-amber-50" onClick={() => handleBulkToggle(false)}>
                                                <Pause className="h-4 w-4 mr-2" /> Pause {selectedIds.size > 0 ? `Selected (${selectedIds.size})` : 'All'}
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[50px]">
                                                    <Checkbox
                                                        checked={sources.length > 0 && selectedIds.size === sources.length}
                                                        onCheckedChange={handleSelectAll}
                                                    />
                                                </TableHead>
                                                <TableHead>Handle</TableHead>
                                                <TableHead>Display Name</TableHead>
                                                <TableHead>Last Checked</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {sources.filter(source =>
                                                !sourceSearchQuery ||
                                                source.display_name.toLowerCase().includes(sourceSearchQuery.toLowerCase()) ||
                                                source.identifier.toLowerCase().includes(sourceSearchQuery.toLowerCase()) ||
                                                (source.is_active ? 'active' : 'paused').includes(sourceSearchQuery.toLowerCase())
                                            ).map(source => (
                                                <TableRow
                                                    key={source.id}
                                                    className={`cursor-pointer hover:bg-muted/50 ${selectedIds.has(source.id) ? 'bg-muted/50' : ''}`}
                                                    onClick={() => setSelectedSource(source)}
                                                >
                                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                                        <Checkbox
                                                            checked={selectedIds.has(source.id)}
                                                            onCheckedChange={(checked) => handleSelectRow(source.id, checked)}
                                                        />
                                                    </TableCell>
                                                    <TableCell className="font-medium text-blue-600 flex items-center gap-2">
                                                        {source.identifier}
                                                        {source.is_verified && <BadgeCheck className="h-3.5 w-3.5 text-blue-500" />}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-3">
                                                            <Avatar className="h-9 w-9 border">
                                                                <AvatarImage src={source.profile_image_url} alt={source.display_name} />
                                                                <AvatarFallback>{source.display_name[0]}</AvatarFallback>
                                                            </Avatar>
                                                            <div className="flex flex-col">
                                                                <span className="font-medium text-sm">{source.display_name}</span>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>{source.last_checked ? formatIST(source.last_checked) : 'Never'}</TableCell>
                                                    <TableCell>
                                                        <Badge variant={source.is_active ? 'default' : 'secondary'} className={source.is_active ? 'bg-emerald-500' : ''}>
                                                            {source.is_active ? 'Active' : 'Paused'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => handleMarkOfficial(source)}
                                                                className={isSourceOfficial(source) ? 'text-blue-500 hover:text-blue-700' : 'text-slate-400 hover:text-blue-500'}
                                                                title={isSourceOfficial(source) ? 'Remove from Official' : 'Mark as Official'}
                                                            >
                                                                <BadgeCheck className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => handleToggleSource(source)}
                                                                className={source.is_active ? 'text-orange-500 hover:text-orange-700' : 'text-green-500 hover:text-green-700'}
                                                                title={source.is_active ? 'Pause monitoring' : 'Resume monitoring'}
                                                            >
                                                                {source.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                                            </Button>
                                                            <Button variant="ghost" size="icon" onClick={() => handleDeleteSource(source.id)} className="text-red-500 hover:text-red-700">
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            {sources.length === 0 && (
                                                <TableRow>
                                                    <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                                                        No sources added yet.
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* Tweets Tab */}
                        <TabsContent value="tweets" className="space-y-6">
                            <div className="flex flex-col gap-4 mb-4">
                                <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                                    <div className="relative flex-1 min-w-[200px]">
                                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Search tweets..."
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            className="pl-9"
                                        />
                                    </div>
                                    <Select value={riskFilter} onValueChange={setRiskFilter}>
                                        <SelectTrigger className="w-[150px] bg-white">
                                            <Shield className="h-4 w-4 mr-2" />
                                            <SelectValue placeholder="Risk Level" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white border shadow-lg">
                                            <SelectItem value="all">All Risks</SelectItem>
                                            <SelectItem value="high">High Risk</SelectItem>
                                            <SelectItem value="medium">Medium Risk</SelectItem>
                                            <SelectItem value="low">Low Risk</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    {allKeywords.length > 0 && (
                                        <Select value={keywordFilter} onValueChange={setKeywordFilter}>
                                            <SelectTrigger className="w-[180px] bg-white">
                                                <Tag className="h-4 w-4 mr-2" />
                                                <SelectValue placeholder="Keyword" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white border shadow-lg max-h-[300px]">
                                                <SelectItem value="all">All Keywords</SelectItem>
                                                {allKeywords.map(kw => (
                                                    <SelectItem key={kw} value={kw}>{kw}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                    <Select value={timeFilter} onValueChange={setTimeFilter}>
                                        <SelectTrigger className="w-[150px] bg-white">
                                            <Clock className="h-4 w-4 mr-2" />
                                            <SelectValue placeholder="Time" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white border shadow-lg">
                                            <SelectItem value="all">All Time</SelectItem>
                                            <SelectItem value="1h">Last 1 Hour</SelectItem>
                                            <SelectItem value="6h">Last 6 Hours</SelectItem>
                                            <SelectItem value="24h">Last 24 Hours</SelectItem>
                                            <SelectItem value="custom">Custom Range</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-2 h-10">
                                        <Download className="h-4 w-4" />
                                        Export Excel
                                    </Button>
                                </div>
                                {timeFilter === 'custom' && (
                                    <div className="flex flex-col sm:flex-row gap-3 p-4 bg-muted/50 rounded-lg border">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-xs text-muted-foreground font-medium">From</span>
                                            <Input
                                                type="datetime-local"
                                                value={dateRange.start}
                                                onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                                                className="w-full sm:w-[200px] bg-white"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <span className="text-xs text-muted-foreground font-medium">To</span>
                                            <Input
                                                type="datetime-local"
                                                value={dateRange.end}
                                                onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                                                className="w-full sm:w-[200px] bg-white"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Badge variant="secondary">{filteredTweets.length} tweets</Badge>
                                    {keywordFilter !== 'all' && (
                                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                                            Keyword: {keywordFilter}
                                        </Badge>
                                    )}
                                    {riskFilter !== 'all' && (
                                        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                                            Risk: {riskFilter}
                                        </Badge>
                                    )}
                                </div>
                            </div>

                            <div className={cn(
                                viewMode === 'grid'
                                    ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
                                    : "space-y-4 max-w-[800px] mx-auto"
                            )}>
                                {loading && tweets.length === 0 ? (
                                    [...Array(6)].map((_, i) => (
                                        <div key={i} className="bg-card border rounded-xl p-4 space-y-4 animate-pulse">
                                            <div className="flex items-center gap-3">
                                                <Skeleton className="h-10 w-10 rounded-full" />
                                                <div className="space-y-2">
                                                    <Skeleton className="h-4 w-32" />
                                                    <Skeleton className="h-3 w-24" />
                                                </div>
                                            </div>
                                            <Skeleton className="h-20 w-full" />
                                            <div className="flex gap-2">
                                                <Skeleton className="h-8 w-20" />
                                                <Skeleton className="h-8 w-20" />
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <>
                                        {filteredTweets.map(tweet => (
                                            <div key={tweet.id} className={cn(viewMode === 'list' ? "w-full" : "h-full")}>
                                                {renderTweetCard(tweet, viewMode)}
                                            </div>
                                        ))}
                                        {filteredTweets.length === 0 && (
                                            <div className="col-span-full text-center py-12 text-muted-foreground">
                                                No tweets found matching your criteria.
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {hasMore && (
                                <div ref={lastElementRef} className="py-8 flex flex-col items-center gap-4 min-h-[80px]">
                                    {loading && (
                                        <div className="flex flex-col items-center gap-3 animate-in fade-in duration-300">
                                            <div className="relative">
                                                <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full"></div>
                                                <Loader2 className="h-8 w-8 animate-spin text-blue-600 relative z-10" />
                                            </div>
                                            <p className="text-sm font-medium text-muted-foreground animate-pulse">Fetching more tweets...</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
                </>
            )}
            <AddSourceModal
                open={sourceModalOpen}
                onClose={() => setSourceModalOpen(false)}
                onSuccess={(createdSource) => {
                    if (createdSource) {
                        setSources(prev => {
                            const exists = prev.some(s => s.id === createdSource.id || s.identifier === createdSource.identifier);
                            if (exists) return prev;
                            return [...prev, createdSource];
                        });
                    }
                    fetchInitialData();
                }}

                initialData={initialSourceData}
            />
        </div>
    );
};

export default XMonitor;
