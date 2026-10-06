import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../lib/api';
import {
    Facebook, Search, Shield, AlertTriangle, Activity,
    BarChart2, Users, FileText, RefreshCw, ExternalLink,
    LayoutGrid, Filter, Trash2, Plus, X, Sparkles, Zap, Globe,
    ChevronRight, AlertOctagon, CheckCircle2,
    TrendingUp, Eye, Heart, MessageCircle,
    User, Calendar, AlertCircle, Share2, Clock, Download, Tag, Pause, Play, ThumbsUp
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter, DialogClose } from '../components/ui/dialog';
import { ScrollArea } from '../components/ui/scroll-area';
import { Progress } from '../components/ui/progress';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { Checkbox } from '../components/ui/checkbox';
import { Textarea } from '../components/ui/textarea';

// Quick Action Button Component with Tooltip
const QuickAction = ({ icon: Icon, label, onClick, variant = "outline", className = "", disabled = false }) => (
    <TooltipProvider>
        <Tooltip>
            <TooltipTrigger asChild>
                <Button variant={variant} size="sm" onClick={onClick} disabled={disabled} className={cn("gap-2", className)}>
                    <Icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{label}</span>
                </Button>
            </TooltipTrigger>
            <TooltipContent><p>{label}</p></TooltipContent>
        </Tooltip>
    </TooltipProvider>
);

// Enhanced Stat Card Component with animation
const StatCard = ({ title, value, icon: Icon, color, subValue, description }) => (
    <Card className="hover:shadow-lg transition-all duration-300 group cursor-default overflow-hidden">
        <CardContent className="pt-6 relative">
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">{title}</p>
                    <div className="flex items-baseline gap-2">
                        <h3 className={cn("text-3xl font-bold", color)}>{value}</h3>
                        {subValue && <span className="text-xs text-muted-foreground">({subValue})</span>}
                    </div>
                    {description && <p className="text-xs text-muted-foreground">{description}</p>}
                </div>
                <div className={cn(
                    "p-3 rounded-xl transition-transform group-hover:scale-110",
                    color?.includes('red') ? 'bg-red-50' : color?.includes('blue') ? 'bg-blue-50' : color?.includes('purple') ? 'bg-purple-50' : 'bg-emerald-50'
                )}>
                    <Icon className={cn("h-6 w-6", color)} />
                </div>
            </div>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
        </CardContent>
    </Card>
);

const RiskBadge = ({ level, score }) => {
    const config = {
        low: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', icon: Shield, glow: 'shadow-emerald-100' },
        medium: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', icon: AlertTriangle, glow: 'shadow-amber-100' },
        high: { bg: 'bg-orange-50 border-orange-200', text: 'text-orange-700', icon: AlertOctagon, glow: 'shadow-orange-100' },
        critical: { bg: 'bg-red-50 border-red-200', text: 'text-red-700', icon: AlertCircle, glow: 'shadow-red-200' }
    };
    const { bg, text, icon: Icon, glow } = config[level?.toLowerCase()] || config.low;

    return (
        <Badge
            variant="outline"
            className={cn(
                bg, text, glow,
                "font-semibold px-2.5 py-1 flex items-center gap-1.5 whitespace-nowrap shadow-sm hover:shadow-md transition-shadow"
            )}
        >
            <Icon className="h-3.5 w-3.5" />
            {level?.toUpperCase() || 'LOW'} • {score || 0}
        </Badge>
    );
};

// Filter Chip Component for active filters display
const FilterChip = ({ label, onClear }) => (
    <Badge variant="secondary" className="gap-1.5 pl-2.5 pr-1.5 py-1 bg-blue-50 text-blue-700 border-blue-200">
        {label}
        <button onClick={onClear} className="ml-1 hover:bg-blue-200 rounded-full p-0.5 transition-colors">
            <X className="h-3 w-3" />
        </button>
    </Badge>
);

const FacebookMonitor = () => {
    const [activeTab, setActiveTab] = useState('overview');
    const [loading, setLoading] = useState(false);
    const [scanningIds, setScanningIds] = useState(new Set());
    const [sources, setSources] = useState([]);
    const [posts, setPosts] = useState([]);
    const [sourceHandle, setSourceHandle] = useState('');
    const [bulkSourceText, setBulkSourceText] = useState('');
    const [bulkAdding, setBulkAdding] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [riskFilter, setRiskFilter] = useState('all');
    const [sortBy, setSortBy] = useState('latest');
    const [selectedSource, setSelectedSource] = useState(null);
    const [timeFilter, setTimeFilter] = useState('all');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [keywordFilter, setKeywordFilter] = useState('all');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [showFilters, setShowFilters] = useState(true);

    // Check if any filters are active
    const hasActiveFilters = searchQuery || riskFilter !== 'all' || timeFilter !== 'all' || keywordFilter !== 'all';

    // Clear all filters function
    const clearAllFilters = useCallback(() => {
        setSearchQuery('');
        setRiskFilter('all');
        setTimeFilter('all');
        setKeywordFilter('all');
        setDateRange({ start: '', end: '' });
    }, []);

    // Helper: Format date to IST string
    const formatIST = (dateStr) => {
        if (!dateStr) return 'N/A';
        const date = new Date(dateStr);
        if (isNaN(date)) return 'N/A';
        return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    };

    const toFacebookUrl = useCallback((identifier) => {
        const raw = String(identifier || '').trim();
        if (!raw) return 'https://www.facebook.com';
        if (/^https?:\/\//i.test(raw)) return raw;
        if (/facebook\.com\//i.test(raw) || /fb\.me\//i.test(raw) || /m\.facebook\.com\//i.test(raw)) {
            return raw.startsWith('http') ? raw : `https://${raw}`;
        }
        return `https://www.facebook.com/${raw.replace(/^\//, '')}`;
    }, []);

    const toFacebookDisplay = useCallback((identifier) => {
        const url = toFacebookUrl(identifier);
        return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    }, [toFacebookUrl]);

    // Calculate stats
    const stats = useMemo(() => {
        const highRiskPosts = posts.filter(p => (p.risk_level === 'high' || p.risk_level === 'critical' || p.analysis?.risk_level === 'HIGH' || p.analysis?.risk_level === 'CRITICAL'));
        const totalEngagement = posts.reduce((acc, p) => acc + (p.engagement?.likes || 0) + (p.engagement?.shares || 0) + (p.engagement?.comments || 0), 0);

        return {
            totalSources: sources.length,
            activeSources: sources.filter(s => s.is_active).length,
            totalPosts: posts.length,
            highRisk: highRiskPosts.length,
            criticalRisk: posts.filter(p => (p.risk_level === 'critical' || p.analysis?.risk_level === 'CRITICAL')).length,
            avgRiskScore: posts.length > 0
                ? (posts.reduce((acc, p) => acc + (p.risk_score || p.analysis?.violence_score || 0), 0) / posts.length).toFixed(1)
                : '0.0',
            totalEngagement
        };
    }, [sources, posts]);

    // Extract all unique keywords from posts
    const allKeywords = useMemo(() => {
        const keywordSet = new Set();
        posts.forEach(post => {
            const factors = post.risk_factors || [];
            const triggered = post.analysis?.triggered_keywords || [];
            factors.forEach(f => keywordSet.add(f.keyword || f));
            triggered.forEach(k => keywordSet.add(k));
        });
        return Array.from(keywordSet).filter(k => k && k.trim()).sort();
    }, [posts]);

    const filteredPosts = useMemo(() => {
        let filtered = [...posts];

        // Filter by Selected Source if active
        if (selectedSource) {
            const identifier = selectedSource.identifier?.toLowerCase();
            filtered = filtered.filter(post =>
                post.author_handle?.toLowerCase() === identifier ||
                post.author?.toLowerCase().includes(identifier) ||
                post.source_id === selectedSource.id
            );
        }

        // Apply TIME filter
        if (timeFilter !== 'all') {
            const now = new Date();
            let cutoff;
            if (timeFilter === '1h') cutoff = new Date(now.getTime() - 1 * 60 * 60 * 1000);
            else if (timeFilter === '6h') cutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
            else if (timeFilter === '24h') cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            else if (timeFilter === '7d') cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            else if (timeFilter === 'custom' && dateRange.start && dateRange.end) {
                const startD = new Date(dateRange.start);
                const endD = new Date(dateRange.end);
                filtered = filtered.filter(post => {
                    const pubDate = new Date(post.published_at);
                    return pubDate >= startD && pubDate <= endD;
                });
                cutoff = null;
            }
            if (cutoff) {
                filtered = filtered.filter(post => new Date(post.published_at) >= cutoff);
            }
        }

        // Apply search filter
        if (searchQuery) {
            filtered = filtered.filter(post =>
                post.text?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                post.author?.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }

        // Apply risk filter
        if (riskFilter !== 'all') {
            filtered = filtered.filter(post => (post.risk_level === riskFilter || post.analysis?.risk_level === riskFilter.toUpperCase()));
        }

        // Apply keyword filter
        if (keywordFilter !== 'all') {
            filtered = filtered.filter(post => {
                const factors = post.risk_factors?.map(f => f.keyword || f) || [];
                const triggered = post.analysis?.triggered_keywords || [];
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
                case 'engagement':
                    const engA = (a.engagement?.likes || 0) + (a.engagement?.shares || 0) + (a.engagement?.comments || 0);
                    const engB = (b.engagement?.likes || 0) + (b.engagement?.shares || 0) + (b.engagement?.comments || 0);
                    return engB - engA;
                default:
                    return 0;
            }
        });

        return filtered;
    }, [posts, searchQuery, riskFilter, sortBy, selectedSource, timeFilter, dateRange, keywordFilter]);

    // Export filtered posts to Excel
    const exportToExcel = () => {
        if (filteredPosts.length === 0) {
            toast.error('No posts to export');
            return;
        }

        const worksheetData = filteredPosts.map(post => ({
            'Author': post.author || 'N/A',
            'Page/Profile': post.author_handle || 'N/A',
            'Post Content': post.text || 'N/A',
            'Published (IST)': formatIST(post.published_at),
            'Risk Level': post.risk_level || post.analysis?.risk_level || 'low',
            'Risk Score': post.risk_score || post.analysis?.violence_score || 0,
            'Keywords Detected': (post.risk_factors?.map(f => f.keyword || f).join(', ') || post.analysis?.triggered_keywords?.join(', ')) || 'None',
            'Likes': post.engagement?.likes || 0,
            'Shares': post.engagement?.shares || 0,
            'Comments': post.engagement?.comments || 0,
            'Post URL': post.content_url || 'N/A'
        }));

        const worksheet = XLSX.utils.json_to_sheet(worksheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Facebook Posts');

        // Add metadata sheet
        const metaData = [
            { 'Field': 'Report Type', 'Value': selectedSource ? `Source: ${selectedSource.identifier}` : 'All Posts' },
            { 'Field': 'Total Posts', 'Value': filteredPosts.length },
            { 'Field': 'Keyword Filter', 'Value': keywordFilter === 'all' ? 'All Keywords' : keywordFilter },
            { 'Field': 'Risk Filter', 'Value': riskFilter === 'all' ? 'All Levels' : riskFilter },
            { 'Field': 'Time Filter', 'Value': timeFilter === 'all' ? 'All Time' : timeFilter },
            { 'Field': 'Generated At (IST)', 'Value': formatIST(new Date()) }
        ];
        const metaSheet = XLSX.utils.json_to_sheet(metaData);
        XLSX.utils.book_append_sheet(workbook, metaSheet, 'Report Info');

        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const data = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const filename = `facebook_monitor_${selectedSource ? selectedSource.identifier : 'all'}_${keywordFilter !== 'all' ? keywordFilter + '_' : ''}${new Date().toISOString().split('T')[0]}.xlsx`;
        saveAs(data, filename);
        toast.success('Excel report exported successfully');
    };

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async (showToast = false) => {
        setLoading(true);
        try {
            const [srcRes, postsRes] = await Promise.all([
                api.get('/sources?platform=facebook'),
                api.get('/content?platform=facebook')
            ]);
            setSources(srcRes.data);
            setPosts(Array.isArray(postsRes.data) ? postsRes.data : (postsRes.data?.items || []));
            if (showToast) toast.success('Facebook data refreshed');
        } catch (error) {
            console.error('Error fetching Facebook data:', error);
            toast.error('Failed to load Facebook data');
        } finally {
            setLoading(false);
        }
    };

    const handleAddSource = async (e) => {
        e.preventDefault();
        if (!sourceHandle.trim()) {
            toast.error('Please enter a page ID or URL');
            return;
        }

        try {
            // Send the link as-is; backend will normalize to a canonical Facebook URL.
            // Examples:
            // - https://www.facebook.com/nasa
            // - https://www.facebook.com/profile.php?id=123
            const identifier = sourceHandle.trim();

            await api.post('/sources', {
                platform: 'facebook',
                identifier,
                display_name: identifier
            });
            toast.success('Facebook page added for monitoring');
            setSourceHandle('');
            setAddDialogOpen(false);
            fetchData();
        } catch (e) {
            toast.error(e.response?.data?.message || 'Failed to add source');
        }
    };

    const parseBulkIdentifiers = (text) => {
        // Split on newlines/spaces/commas, keep only facebook-like tokens.
        const tokens = String(text || '')
            .split(/[\n\r,\t ]+/)
            .map(t => t.trim())
            .filter(Boolean);

        const cleaned = tokens
            .map(t => t.replace(/^['"\[]+|['"\]]+$/g, ''))
            .filter(Boolean);

        // Keep URLs and facebook.com-ish inputs
        return Array.from(new Set(
            cleaned.filter(t => /facebook\.com\//i.test(t) || /fb\.me\//i.test(t) || /^\w[\w\.]+$/.test(t) || /profile\.php\?id=/i.test(t))
        ));
    };

    const handleBulkAddSources = async () => {
        const identifiers = parseBulkIdentifiers(bulkSourceText);
        if (identifiers.length === 0) {
            toast.error('Paste at least one Facebook page/profile URL');
            return;
        }

        setBulkAdding(true);
        try {
            const res = await api.post('/sources/bulk', {
                platform: 'facebook',
                identifiers
            });

            const created = res.data?.created?.length || 0;
            const skipped = res.data?.skipped?.length || 0;
            const failed = res.data?.failed?.length || 0;

            toast.success(`Imported: ${created} added, ${skipped} skipped, ${failed} failed`);
            setBulkSourceText('');
            setAddDialogOpen(false);
            fetchData();
        } catch (e) {
            toast.error(e.response?.data?.message || 'Bulk import failed');
        } finally {
            setBulkAdding(false);
        }
    };

    const handleDeleteSource = async (id) => {
        if (!window.confirm('Are you sure you want to stop monitoring this Facebook page?')) return;
        try {
            await api.delete(`/sources/${id}`);
            toast.success('Source removed');
            if (selectedSource?.id === id) setSelectedSource(null);
            fetchData();
        } catch (e) {
            toast.error('Failed to remove source');
        }
    };

    const handleBulkToggle = async (isActive) => {
        const targetSources = selectedIds.size > 0
            ? sources.filter(s => selectedIds.has(s.id))
            : sources;

        if (targetSources.length === 0) return;

        try {
            toast.promise(
                Promise.all(targetSources.map(s =>
                    api.put(`/sources/${s.id}`, { ...s, is_active: isActive })
                )),
                {
                    loading: `${isActive ? 'Resuming' : 'Pausing'} ${targetSources.length} sources...`,
                    success: () => {
                        fetchData();
                        setSelectedIds(new Set());
                        return `${isActive ? 'Resumed' : 'Paused'} ${targetSources.length} sources`;
                    },
                    error: 'Failed to update sources'
                }
            );
        } catch (error) {
            toast.error('Bulk update failed');
        }
    };

    const handleSelectAll = (checked) => {
        if (checked) {
            setSelectedIds(new Set(sources.map(s => s.id)));
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
            fetchData();
        } catch (e) {
            toast.error('Failed to toggle source status');
        }
    };

    const handleScanSource = async (source) => {
        if (!source?.id) return;
        const sourceId = source.id;

        setScanningIds(prev => {
            const next = new Set(prev);
            next.add(sourceId);
            return next;
        });

        try {
            const res = await api.post(`/sources/${sourceId}/scan`);
            const ingested = res.data?.ingested ?? res.data?.scanned ?? 0;
            toast.success(`${res.data?.message || 'Scan completed'} • ${ingested} new items`);
            fetchData();
        } catch (e) {
            if (e?.response?.status === 429) {
                const retry = e.response?.data?.retryAfterSeconds;
                toast.error(`${e.response?.data?.message || 'Facebook is rate limited'}${retry ? ` (retry in ${retry}s)` : ''}`);
            } else {
                toast.error(e?.response?.data?.message || 'Failed to scan source');
            }
        } finally {
            setScanningIds(prev => {
                const next = new Set(prev);
                next.delete(sourceId);
                return next;
            });
        }
    };

    const renderPostCard = (post) => (
        <Card key={post.id} className="hover:shadow-lg transition-all duration-200 group border-l-4 border-l-transparent hover:border-l-blue-500">
            <CardContent className="p-5">
                <div className="flex gap-4">
                    <Avatar className="h-11 w-11 border-2 border-blue-100 ring-2 ring-blue-50 flex-shrink-0">
                        <AvatarImage src={post.author_avatar} />
                        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-blue-600 text-white font-bold">
                            {(post.author || 'FB')[0]}
                        </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0 space-y-2.5">
                        {/* Header */}
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-gray-900 truncate">{post.author || 'Unknown Page'}</span>
                                    <Badge variant="secondary" className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5">
                                        <Facebook className="h-2.5 w-2.5 mr-1" />
                                        Facebook
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                    <Clock className="h-3 w-3" />
                                    {formatIST(post.published_at)}
                                </div>
                            </div>
                            <RiskBadge level={post.risk_level || post.analysis?.risk_level || 'low'} score={post.risk_score || post.analysis?.violence_score || 0} />
                        </div>

                        {/* Content */}
                        <p className="text-gray-700 text-sm leading-relaxed line-clamp-3 group-hover:line-clamp-none transition-all">
                            {post.text}
                        </p>

                        {/* Media Preview */}
                        {post.media && post.media.length > 0 && (
                            <div className="flex gap-2 overflow-x-auto pb-1">
                                {post.media.slice(0, 3).map((url, idx) => (
                                    <img 
                                        key={idx} 
                                        src={url} 
                                        alt="Post media" 
                                        className="h-20 w-20 object-cover rounded-lg border flex-shrink-0 hover:scale-105 transition-transform cursor-pointer"
                                        onError={(e) => e.target.style.display = 'none'}
                                    />
                                ))}
                                {post.media.length > 3 && (
                                    <div className="h-20 w-20 flex items-center justify-center bg-muted rounded-lg text-xs text-muted-foreground flex-shrink-0">
                                        +{post.media.length - 3} more
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Keywords Badge */}
                        {(post.risk_factors?.length > 0 || post.analysis?.triggered_keywords?.length > 0) && (
                            <div className="flex flex-wrap gap-1.5">
                                {(post.risk_factors || post.analysis?.triggered_keywords?.map(k => ({ keyword: k })) || []).slice(0, 5).map((factor, i) => (
                                    <Badge key={i} className="bg-red-50 text-red-600 border-red-100 text-[10px] px-2 py-0.5 hover:bg-red-100 transition-colors cursor-default">
                                        <Zap className="h-2.5 w-2.5 mr-1" />
                                        {factor.keyword || factor}
                                    </Badge>
                                ))}
                                {(post.risk_factors?.length || 0) + (post.analysis?.triggered_keywords?.length || 0) > 5 && (
                                    <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                                        +{(post.risk_factors?.length || 0) + (post.analysis?.triggered_keywords?.length || 0) - 5} more
                                    </Badge>
                                )}
                            </div>
                        )}

                        {/* Metrics */}
                        <div className="flex items-center justify-between pt-2 border-t">
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1.5 hover:text-blue-600 transition-colors cursor-default" title="Likes">
                                    <ThumbsUp className="h-3.5 w-3.5" /> {(post.engagement?.likes || 0).toLocaleString()}
                                </span>
                                <span className="flex items-center gap-1.5 hover:text-blue-600 transition-colors cursor-default" title="Comments">
                                    <MessageCircle className="h-3.5 w-3.5" /> {(post.engagement?.comments || 0).toLocaleString()}
                                </span>
                                <span className="flex items-center gap-1.5 hover:text-blue-600 transition-colors cursor-default" title="Shares">
                                    <Share2 className="h-3.5 w-3.5" /> {(post.engagement?.shares || 0).toLocaleString()}
                                </span>
                            </div>
                            {post.content_url && (
                                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => window.open(post.content_url, '_blank')}>
                                    <ExternalLink className="h-3 w-3" /> View Post
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );

    return (
        <div className="p-4 md:p-6 lg:p-8 max-w-[1800px] mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    {selectedSource ? (
                        <Button variant="ghost" size="icon" onClick={() => setSelectedSource(null)} className="shrink-0 hover:bg-blue-50">
                            <ChevronRight className="h-5 w-5 rotate-180" />
                        </Button>
                    ) : (
                        <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-200">
                            <Facebook className="h-7 w-7 text-white" />
                        </div>
                    )}
                    <div>
                        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
                            {selectedSource ? selectedSource.display_name : 'Facebook Intelligence'}
                        </h1>
                        <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2">
                            <Globe className="h-3.5 w-3.5" />
                            {selectedSource ? `Monitoring since ${new Date(selectedSource.created_at).toLocaleDateString()}` : 'Real-time page monitoring & threat detection'}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <QuickAction icon={RefreshCw} label="Refresh" onClick={() => fetchData(true)} disabled={loading} className={loading ? "animate-pulse" : ""} />
                    {selectedSource && (
                        <QuickAction
                            icon={Zap}
                            label={scanningIds.has(selectedSource.id) ? 'Scanning…' : 'Scan Now'}
                            onClick={() => handleScanSource(selectedSource)}
                            disabled={scanningIds.has(selectedSource.id)}
                            variant="secondary"
                            className={cn(scanningIds.has(selectedSource.id) ? 'animate-pulse' : '', 'text-blue-700 bg-blue-50 hover:bg-blue-100')}
                        />
                    )}
                    <QuickAction icon={Download} label="Export" onClick={exportToExcel} disabled={filteredPosts.length === 0} />
                    
                    <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="gap-2 bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200">
                                <Plus className="h-4 w-4" />
                                <span className="hidden sm:inline">Add Page</span>
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md bg-white">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Facebook className="h-5 w-5 text-blue-600" />
                                    Monitor Facebook Page
                                </DialogTitle>
                                <DialogDescription>
                                    Add one page, or bulk import a list.
                                </DialogDescription>
                            </DialogHeader>

                            <Tabs defaultValue="single" className="space-y-4">
                                <TabsList className="grid grid-cols-2">
                                    <TabsTrigger value="single">Single</TabsTrigger>
                                    <TabsTrigger value="bulk">Bulk Import</TabsTrigger>
                                </TabsList>

                                <TabsContent value="single" className="space-y-4">
                                    <form onSubmit={handleAddSource} className="space-y-4">
                                        <Input
                                            placeholder="e.g., nasa or https://facebook.com/nasa"
                                            value={sourceHandle}
                                            onChange={e => setSourceHandle(e.target.value)}
                                            className="h-11"
                                        />
                                        <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
                                            <strong>Tip:</strong> Paste a full URL or a page/profile name. Facebook group URLs will be rejected.
                                        </div>
                                        <DialogFooter>
                                            <DialogClose asChild>
                                                <Button variant="outline">Cancel</Button>
                                            </DialogClose>
                                            <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                                                Start Monitoring
                                            </Button>
                                        </DialogFooter>
                                    </form>
                                </TabsContent>

                                <TabsContent value="bulk" className="space-y-4">
                                    <div className="space-y-3">
                                        <Textarea
                                            placeholder={`Paste one per line, e.g.\nhttps://www.facebook.com/nasa\nhttps://www.facebook.com/profile.php?id=123\nhttps://www.facebook.com/groups/123 (will be rejected)`}
                                            value={bulkSourceText}
                                            onChange={(e) => setBulkSourceText(e.target.value)}
                                            className="min-h-[180px]"
                                        />
                                        <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
                                            <strong>Bulk Import:</strong> Adds all valid pages/profiles, skips duplicates, and reports failures.
                                        </div>
                                        <DialogFooter>
                                            <DialogClose asChild>
                                                <Button variant="outline" disabled={bulkAdding}>Cancel</Button>
                                            </DialogClose>
                                            <Button
                                                type="button"
                                                className="bg-blue-600 hover:bg-blue-700"
                                                onClick={handleBulkAddSources}
                                                disabled={bulkAdding}
                                            >
                                                {bulkAdding ? 'Importing…' : 'Import List'}
                                            </Button>
                                        </DialogFooter>
                                    </div>
                                </TabsContent>
                            </Tabs>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Content Area */}
            {selectedSource ? (
                <div className="space-y-6">
                    {/* Profile Header Card */}
                    <Card className="overflow-hidden border-border bg-card">
                        <div className="h-32 bg-gradient-to-r from-blue-600 to-indigo-500 relative">
                            <div className="absolute bottom-4 right-4 flex gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="bg-white/90 hover:bg-white text-black text-xs font-semibold backdrop-blur-sm"
                                    onClick={() => handleScanSource(selectedSource)}
                                    disabled={scanningIds.has(selectedSource.id)}
                                    title={scanningIds.has(selectedSource.id) ? 'Scanning…' : 'Scan this page now'}
                                >
                                    <RefreshCw className={cn('h-3 w-3 mr-1.5', scanningIds.has(selectedSource.id) ? 'animate-spin' : '')} />
                                    Scan Now
                                </Button>
                                <Button variant="secondary" size="sm" className="bg-white/90 hover:bg-white text-black text-xs font-semibold backdrop-blur-sm" onClick={() => window.open(toFacebookUrl(selectedSource.identifier), '_blank')}>
                                    <ExternalLink className="h-3 w-3 mr-1.5" />
                                    View on Facebook
                                </Button>
                                <Button variant="destructive" size="sm" className="text-xs font-semibold shadow-sm" onClick={() => handleDeleteSource(selectedSource.id)}>
                                    <Trash2 className="h-3 w-3 mr-1.5" />
                                    Stop Monitoring
                                </Button>
                            </div>
                        </div>
                        <CardContent className="pt-0 relative">
                            <div className="flex flex-col md:flex-row gap-6 items-start">
                                <Avatar className="h-24 w-24 border-4 border-card -mt-12 rounded-2xl shadow-lg">
                                    <AvatarFallback className="text-2xl font-bold bg-blue-600 text-white">
                                        {selectedSource.display_name[0]}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="mt-4 md:mt-2 space-y-1">
                                    <h2 className="text-2xl font-bold">{selectedSource.display_name}</h2>
                                    <p className="text-muted-foreground font-medium">{toFacebookDisplay(selectedSource.identifier)}</p>
                                    <div className="flex gap-4 text-sm text-muted-foreground mt-2">
                                        <div className="flex items-center gap-1.5">
                                            <Calendar className="h-4 w-4" />
                                            Monitoring since {new Date(selectedSource.created_at).toLocaleDateString()}
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <Activity className="h-4 w-4" />
                                            {filteredPosts.length} Posts Analyzed
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Tabs defaultValue="posts" className="space-y-6">
                        <TabsList className="bg-background border p-1 h-auto w-full justify-start">
                            <TabsTrigger value="posts" className="px-6 py-2.5">
                                <Facebook className="h-4 w-4 mr-2" />
                                Posts
                            </TabsTrigger>
                            <TabsTrigger value="analysis" className="px-6 py-2.5">
                                <BarChart2 className="h-4 w-4 mr-2" />
                                Risk Analytics
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="posts" className="space-y-4">
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
                            <div className="flex items-center gap-2 mb-2">
                                <Badge variant="secondary">{filteredPosts.length} posts</Badge>
                                {keywordFilter !== 'all' && (
                                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                                        Keyword: {keywordFilter}
                                    </Badge>
                                )}
                            </div>
                            {filteredPosts.length > 0 ? (
                                <div className="space-y-4">
                                    {filteredPosts.map(post => renderPostCard(post))}
                                </div>
                            ) : (
                                <div className="text-center py-16 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                                    <Facebook className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                                    <h3 className="text-lg font-semibold text-foreground">No posts found</h3>
                                    <p>We haven't detected any posts from this source yet.</p>
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="analysis">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <Card>
                                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total Volume</CardTitle></CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold">{filteredPosts.length}</div>
                                        <p className="text-xs text-muted-foreground mt-1">Total analyzed posts</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Risk Profile</CardTitle></CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-red-600">{filteredPosts.filter(p => (p.risk_level === 'high' || p.analysis?.risk_level === 'HIGH')).length}</div>
                                        <p className="text-xs text-muted-foreground mt-1">High risk alerts generated</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Average Threat Score</CardTitle></CardHeader>
                                    <CardContent>
                                        <div className="text-3xl font-bold text-orange-600">
                                            {(filteredPosts.reduce((acc, p) => acc + (p.risk_score || p.analysis?.violence_score || 0), 0) / (filteredPosts.length || 1)).toFixed(1)}
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
                    {/* Stats Overview with new StatCard components */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard 
                            title="Monitored Pages" 
                            value={stats.totalSources} 
                            icon={Users} 
                            color="text-blue-600" 
                            subValue={`${stats.activeSources} active`}
                            description="Facebook pages being tracked"
                        />
                        <StatCard 
                            title="Total Posts" 
                            value={stats.totalPosts.toLocaleString()} 
                            icon={FileText} 
                            color="text-purple-600" 
                            description="Analyzed content items"
                        />
                        <StatCard 
                            title="High Risk" 
                            value={stats.highRisk} 
                            icon={AlertTriangle} 
                            color="text-red-600" 
                            subValue={stats.criticalRisk > 0 ? `${stats.criticalRisk} critical` : null}
                            description="Threats requiring attention"
                        />
                        <StatCard 
                            title="Engagement" 
                            value={stats.totalEngagement.toLocaleString()} 
                            icon={TrendingUp} 
                            color="text-emerald-600" 
                            description="Total interactions tracked"
                        />
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
                            <TabsTrigger value="posts" className="px-4 py-2.5">
                                <Facebook className="h-4 w-4 mr-2" />
                                All Posts ({posts.length})
                            </TabsTrigger>
                        </TabsList>

                        {/* Overview Tab */}
                        <TabsContent value="overview" className="space-y-6">
                            {/* Quick Actions Panel */}
                            <Card className="bg-gradient-to-r from-blue-50/80 to-indigo-50/80 border-blue-100">
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center gap-2 text-lg">
                                        <Sparkles className="h-5 w-5 text-blue-500" />
                                        Quick Actions
                                    </CardTitle>
                                    <CardDescription>Common tasks at your fingertips</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        <Button variant="outline" className="h-auto py-4 flex-col gap-2 bg-white hover:bg-blue-50 hover:border-blue-300" onClick={() => setAddDialogOpen(true)}>
                                            <Plus className="h-5 w-5 text-blue-600" />
                                            <span className="text-xs font-medium">Add Page</span>
                                        </Button>
                                        <Button variant="outline" className="h-auto py-4 flex-col gap-2 bg-white hover:bg-emerald-50 hover:border-emerald-300" onClick={fetchData}>
                                            <RefreshCw className="h-5 w-5 text-emerald-600" />
                                            <span className="text-xs font-medium">Refresh Data</span>
                                        </Button>
                                        <Button variant="outline" className="h-auto py-4 flex-col gap-2 bg-white hover:bg-purple-50 hover:border-purple-300" onClick={exportToExcel}>
                                            <Download className="h-5 w-5 text-purple-600" />
                                            <span className="text-xs font-medium">Export Report</span>
                                        </Button>
                                        <Button variant="outline" className="h-auto py-4 flex-col gap-2 bg-white hover:bg-orange-50 hover:border-orange-300" onClick={() => setActiveTab('posts')}>
                                            <Search className="h-5 w-5 text-orange-600" />
                                            <span className="text-xs font-medium">Search Posts</span>
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Recent High Risk Alerts */}
                                <Card className="col-span-1">
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <AlertOctagon className="h-5 w-5 text-red-600" />
                                            Recent High Risk Alerts
                                        </CardTitle>
                                        <CardDescription>Latest critical threats detected across all Facebook sources.</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-4">
                                            {filteredPosts
                                                .filter(p => {
                                                    const isHighRisk = p.risk_level === 'high' || p.risk_level === 'critical' || p.analysis?.risk_level === 'HIGH' || p.analysis?.risk_level === 'CRITICAL';
                                                    const hasAI = (p.risk_factors || p.analysis?.triggered_keywords || []).some(k => (k.keyword || k).toString().includes('[AI]'));
                                                    return isHighRisk || hasAI;
                                                })
                                                .slice(0, 5)
                                                .map(post => (
                                                    <div key={post.id} className="flex gap-3 p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => {
                                                        const src = sources.find(s => s.id === post.source_id);
                                                        if (src) setSelectedSource(src);
                                                    }}>
                                                        <Avatar className="h-8 w-8">
                                                            <AvatarFallback className="bg-blue-600 text-white text-xs">{(post.author || 'FB')[0]}</AvatarFallback>
                                                        </Avatar>
                                                        <div className="flex-1 space-y-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="font-semibold text-sm truncate">{post.author || 'Unknown'}</span>
                                                                <RiskBadge level={post.risk_level || post.analysis?.risk_level} score={post.risk_score || post.analysis?.violence_score} />
                                                            </div>
                                                            <p className="text-xs text-muted-foreground line-clamp-2">{post.text}</p>
                                                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1">
                                                                <Clock className="h-3 w-3" />
                                                                <span>{formatIST(post.published_at)}</span>
                                                                {post.content_url && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <a href={post.content_url} target="_blank" rel="noopener noreferrer" className="hover:underline text-blue-500" onClick={e => e.stopPropagation()}>View Post</a>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            {filteredPosts.filter(p => {
                                                const isHighRisk = p.risk_level === 'high' || p.risk_level === 'critical' || p.analysis?.risk_level === 'HIGH' || p.analysis?.risk_level === 'CRITICAL';
                                                const hasAI = (p.risk_factors || p.analysis?.triggered_keywords || []).some(k => (k.keyword || k).toString().includes('[AI]'));
                                                return isHighRisk || hasAI;
                                            }).length === 0 && (
                                                <div className="text-center py-8 text-muted-foreground">
                                                    <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-500/50" />
                                                    <p className="font-medium">All Clear!</p>
                                                    <p className="text-xs mt-1">No high risk alerts detected recently.</p>
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
                                                        <p className="font-medium text-sm">Facebook Scraper API</p>
                                                        <p className="text-xs text-muted-foreground">RapidAPI (Facebook Scraper 3)</p>
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
                                            <CardDescription>Most frequent triggers in monitored posts.</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="flex flex-wrap gap-2">
                                                {Array.from(new Set(posts.flatMap(p => (p.risk_factors?.map(r => r.keyword) || p.analysis?.triggered_keywords || [])))).slice(0, 10).map((kw, i) => (
                                                    <Badge key={i} variant="outline" className="px-3 py-1 bg-secondary/50">
                                                        {kw}
                                                    </Badge>
                                                ))}
                                                {posts.flatMap(p => p.analysis?.triggered_keywords || []).length === 0 && (
                                                    <span className="text-sm text-muted-foreground">No keywords detected yet.</span>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            </div>
                        </TabsContent>

                        {/* Sources Tab */}
                        <TabsContent value="sources" className="space-y-6">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6">
                                    <div className="space-y-1.5">
                                        <CardTitle>Monitored Facebook Pages</CardTitle>
                                        <CardDescription>Click on a source row to view detailed activity.</CardDescription>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => handleBulkToggle(true)}>
                                            <Play className="h-4 w-4 mr-2" /> Resume {selectedIds.size > 0 ? `Selected (${selectedIds.size})` : 'All'}
                                        </Button>
                                        <Button size="sm" variant="outline" className="text-amber-600 border-amber-200 hover:bg-amber-50" onClick={() => handleBulkToggle(false)}>
                                            <Pause className="h-4 w-4 mr-2" /> Pause {selectedIds.size > 0 ? `Selected (${selectedIds.size})` : 'All'}
                                        </Button>
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
                                                <TableHead>Page ID</TableHead>
                                                <TableHead>Display Name</TableHead>
                                                <TableHead>Last Checked</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {sources.map(source => (
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
                                                    <TableCell className="font-medium text-blue-600">{source.identifier}</TableCell>
                                                    <TableCell>{source.display_name}</TableCell>
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
                                                                onClick={() => handleScanSource(source)}
                                                                disabled={scanningIds.has(source.id)}
                                                                className="text-blue-600 hover:text-blue-700"
                                                                title={scanningIds.has(source.id) ? 'Scanning…' : 'Scan now'}
                                                            >
                                                                <RefreshCw className={cn("h-4 w-4", scanningIds.has(source.id) ? "animate-spin" : "")} />
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
                                                        No Facebook pages added yet. Click "Add Page" to start monitoring.
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* Posts Tab */}
                        <TabsContent value="posts" className="space-y-4">
                            {/* Filter Bar with Toggle */}
                            <Card className="border-dashed">
                                <CardContent className="py-4">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <div className="relative flex-1 min-w-[200px]">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                placeholder="Search posts, authors..."
                                                value={searchQuery}
                                                onChange={e => setSearchQuery(e.target.value)}
                                                className="pl-9 h-10"
                                            />
                                        </div>
                                        
                                        <Button 
                                            variant={showFilters ? "secondary" : "outline"} 
                                            size="sm" 
                                            onClick={() => setShowFilters(!showFilters)} 
                                            className="gap-2 h-10"
                                        >
                                            <Filter className="h-4 w-4" />
                                            Filters
                                            {hasActiveFilters && <Badge className="ml-1 h-5 w-5 p-0 justify-center bg-blue-600 text-[10px]">{[riskFilter !== 'all', timeFilter !== 'all', keywordFilter !== 'all'].filter(Boolean).length}</Badge>}
                                        </Button>
                                        
                                        <Select value={sortBy} onValueChange={setSortBy}>
                                            <SelectTrigger className="w-[140px] h-10 bg-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white">
                                                <SelectItem value="latest">Latest First</SelectItem>
                                                <SelectItem value="risk">Highest Risk</SelectItem>
                                                <SelectItem value="engagement">Most Engaged</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        
                                        <QuickAction icon={Download} label="Export" onClick={exportToExcel} disabled={filteredPosts.length === 0} />
                                    </div>
                                    
                                    {/* Expandable Filters */}
                                    {showFilters && (
                                        <div className="mt-4 pt-4 border-t flex flex-wrap gap-3">
                                            <Select value={timeFilter} onValueChange={setTimeFilter}>
                                                <SelectTrigger className="w-[140px] bg-white">
                                                    <Clock className="h-4 w-4 mr-2" />
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="bg-white">
                                                    <SelectItem value="all">All Time</SelectItem>
                                                    <SelectItem value="1h">Last Hour</SelectItem>
                                                    <SelectItem value="6h">Last 6 Hours</SelectItem>
                                                    <SelectItem value="24h">Last 24 Hours</SelectItem>
                                                    <SelectItem value="7d">Last 7 Days</SelectItem>
                                                    <SelectItem value="custom">Custom Range</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            
                                            <Select value={riskFilter} onValueChange={setRiskFilter}>
                                                <SelectTrigger className="w-[140px] bg-white">
                                                    <Shield className="h-4 w-4 mr-2" />
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="bg-white">
                                                    <SelectItem value="all">All Risks</SelectItem>
                                                    <SelectItem value="critical">Critical</SelectItem>
                                                    <SelectItem value="high">High</SelectItem>
                                                    <SelectItem value="medium">Medium</SelectItem>
                                                    <SelectItem value="low">Low</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            
                                            {allKeywords.length > 0 && (
                                                <Select value={keywordFilter} onValueChange={setKeywordFilter}>
                                                    <SelectTrigger className="w-[160px] bg-white">
                                                        <Tag className="h-4 w-4 mr-2" />
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent className="bg-white max-h-[250px]">
                                                        <SelectItem value="all">All Keywords</SelectItem>
                                                        {allKeywords.map(kw => <SelectItem key={kw} value={kw}>{kw}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                            
                                            {hasActiveFilters && (
                                                <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-muted-foreground hover:text-red-600">
                                                    <X className="h-4 w-4 mr-1" /> Clear All
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                    
                                    {/* Custom Date Range */}
                                    {timeFilter === 'custom' && (
                                        <div className="mt-4 pt-4 border-t flex flex-wrap gap-3 items-end">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-xs text-muted-foreground font-medium">From</span>
                                                <Input type="datetime-local" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))} className="w-[200px] bg-white" />
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <span className="text-xs text-muted-foreground font-medium">To</span>
                                                <Input type="datetime-local" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))} className="w-[200px] bg-white" />
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Active Filters Display */}
                            {hasActiveFilters && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs text-muted-foreground">Active filters:</span>
                                    {searchQuery && <FilterChip label={`Search: "${searchQuery}"`} onClear={() => setSearchQuery('')} />}
                                    {riskFilter !== 'all' && <FilterChip label={`Risk: ${riskFilter}`} onClear={() => setRiskFilter('all')} />}
                                    {timeFilter !== 'all' && <FilterChip label={`Time: ${timeFilter}`} onClear={() => setTimeFilter('all')} />}
                                    {keywordFilter !== 'all' && <FilterChip label={`Keyword: ${keywordFilter}`} onClear={() => setKeywordFilter('all')} />}
                                </div>
                            )}

                            {/* Results Header */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Badge variant="secondary" className="text-sm">{filteredPosts.length} posts</Badge>
                                    {hasActiveFilters && <span className="text-xs text-muted-foreground">(filtered)</span>}
                                </div>
                            </div>

                            {/* Posts Grid */}
                            {filteredPosts.length > 0 ? (
                                <div className="grid gap-4">
                                    {filteredPosts.map(post => renderPostCard(post))}
                                </div>
                            ) : (
                                <Card className="border-dashed">
                                    <CardContent className="py-16 text-center">
                                        <Facebook className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                                        <h3 className="font-semibold text-lg">No posts found</h3>
                                        <p className="text-muted-foreground text-sm mt-1">
                                            {hasActiveFilters ? 'Try adjusting your filters' : 'Add a Facebook page to start monitoring'}
                                        </p>
                                        {hasActiveFilters && (
                                            <Button variant="outline" size="sm" onClick={clearAllFilters} className="mt-4">
                                                Clear Filters
                                            </Button>
                                        )}
                                    </CardContent>
                                </Card>
                            )}
                        </TabsContent>
                    </Tabs>
                </>
            )}
        </div>
    );
};

export default FacebookMonitor;
