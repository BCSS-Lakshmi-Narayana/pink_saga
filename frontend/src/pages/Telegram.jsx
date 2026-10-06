import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    Send, Search, Users, MessageSquare, Loader2, CheckCircle2,
    XCircle, LogIn, ChevronRight, Hash, Link as LinkIcon,
    AlertTriangle, Info, Clock, ExternalLink, Zap, Image as ImageIcon,
    FileText, ChevronDown, ArrowLeft, MoreVertical, Pin, Volume2,
    Download, Shield, Lock, Globe, UserPlus, RefreshCw, X, Plus,
    ChevronLeft, Phone, Key, Trash2, LogOut, RotateCcw, Archive, ChevronUp
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import api, { BACKEND_URL } from '../lib/api';

// ── Color helpers for consistent avatar colors ──
const AVATAR_COLORS = [
    'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500',
    'bg-teal-500', 'bg-cyan-500', 'bg-blue-500', 'bg-indigo-500',
    'bg-violet-500', 'bg-purple-500', 'bg-pink-500', 'bg-rose-500',
];
const getAvatarColor = (str) => {
    let hash = 0;
    for (let i = 0; i < (str || '').length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatMsgTime = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateSeparator = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

const Telegram = () => {
    // ── Auth State ──
    const [authState, setAuthState] = useState({
        isAuthenticated: false,
        phone: '',
        code: '',
        phoneCodeHash: '',
        password: '',
        step: 'phone',
        loading: false
    });

    // ── Search State ──
    const [searchState, setSearchState] = useState({
        query: '',
        results: [],
        loading: false
    });

    // ── Groups & Messages State ──
    const [groupsState, setGroupsState] = useState({
        joined: [],
        loading: false,
        activeGroupId: null,
        messages: [],
        messagesLoading: false
    });

    // ── Discovery State ──
    const [discoveryState, setDiscoveryState] = useState({
        privateResults: [],
        publicResults: [],
        myGroups: [],
        loading: false,
        offset: 0,
        hasMore: false,
        deepScan: true,
        autoJoin: false,
        discoveryTab: 'public' // public | discovered | private
    });

    const [isSyncing, setIsSyncing] = useState(false);
    const [isScrapeAll, setIsScrapeAll] = useState(false);
    const [manualJoinUrl, setManualJoinUrl] = useState('');
    const [sidebarTab, setSidebarTab] = useState('chats'); // chats | search | discover
    const [showMobileSidebar, setShowMobileSidebar] = useState(true);
    const [searchFocused, setSearchFocused] = useState(false);
    const [showGroupMenu, setShowGroupMenu] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);
    const [groupActionMenu, setGroupActionMenu] = useState(null); // { groupId, groupTitle, x, y }
    const [chatHeaderMenu, setChatHeaderMenu] = useState(false);
    const [expandedResults, setExpandedResults] = useState(new Set()); // Set of result IDs
    const [confirmDialog, setConfirmDialog] = useState(null); // { type: 'leave'|'delete', groupId, groupTitle }
    const messagesEndRef = useRef(null);
    const pendingPollRef = useRef(null);

    // ── Active group derived ──
    const activeGroup = useMemo(
        () => groupsState.joined.find(g => g.id === groupsState.activeGroupId),
        [groupsState.joined, groupsState.activeGroupId]
    );

    // ── Sorted groups list by most recent activity ──
    const sortedGroups = useMemo(() => {
        return [...groupsState.joined]
            .sort((a, b) => {
                const dateA = a.last_scraped_at ? new Date(a.last_scraped_at) : new Date(0);
                const dateB = b.last_scraped_at ? new Date(b.last_scraped_at) : new Date(0);
                return dateB - dateA;
            });
    }, [groupsState.joined]);

    // ── Filter groups by search query in sidebar ──
    const filteredGroups = useMemo(() => {
        if (searchState.query && sidebarTab === 'chats') {
            return sortedGroups.filter(g => g.title.toLowerCase().includes(searchState.query.toLowerCase()));
        }
        return sortedGroups;
    }, [sortedGroups, searchState.query, sidebarTab]);

    // ── Group messages by date for date separators (oldest first, newest at bottom) ──
    const groupedMessages = useMemo(() => {
        const sorted = [...groupsState.messages].sort((a, b) => new Date(a.date) - new Date(b.date));
        const groups = [];
        let lastDate = '';
        for (const msg of sorted) {
            const msgDate = new Date(msg.date).toDateString();
            if (msgDate !== lastDate) {
                groups.push({ type: 'date', date: msg.date, key: `date-${msgDate}` });
                lastDate = msgDate;
            }
            groups.push({ type: 'message', data: msg, key: msg.id });
        }
        return groups;
    }, [groupsState.messages]);

    // ── Highlight keywords and links in text ──
    const highlightText = useCallback((text, keyword) => {
        if (!text) return '';

        const escaped = keyword ? keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
        const kwPat = escaped ? `(${escaped})` : '';
        const linkPat = '((?:https?://)?t\\.me/(?:\\+|joinchat/)[\\w-]+|(?:https?://)?t\\.me/[\\w-]+)';
        const combined = [kwPat, linkPat].filter(Boolean).join('|');
        if (!combined) return text;

        const regex = new RegExp(combined, 'gi');
        const result = [];
        let lastIdx = 0;
        let m;
        let k = 0;

        while ((m = regex.exec(text)) !== null) {
            if (m.index > lastIdx) result.push(text.slice(lastIdx, m.index));
            const val = m[0];
            const isLink = /t\.me\//i.test(val);
            if (isLink) {
                result.push(<span key={`h${k++}`} className="font-bold text-foreground">{val}</span>);
            } else {
                result.push(<span key={`h${k++}`} className="font-bold text-foreground bg-yellow-200/40 rounded-sm px-0.5">{val}</span>);
            }
            lastIdx = regex.lastIndex;
        }
        if (lastIdx < text.length) result.push(text.slice(lastIdx));
        return result;
    }, []);

    // ── All discovery results merged for sidebar ──
    const allDiscoveryResults = useMemo(() => [
        ...discoveryState.myGroups.map(g => ({ ...g, _section: 'joined' })),
        ...searchState.results.map(g => ({ ...g, _section: 'public' })),
        ...discoveryState.publicResults.map(g => ({ ...g, _section: 'discovered_public' })),
        ...discoveryState.privateResults.map(g => ({ ...g, _section: 'discovered_private' })),
    ], [discoveryState.myGroups, searchState.results, discoveryState.publicResults, discoveryState.privateResults]);

    // ── Scroll to bottom when messages change ──
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [groupsState.messages]);

    // ── Track pending groups count ──
    useEffect(() => {
        const count = groupsState.joined.filter(g => g.status === 'pending').length;
        setPendingCount(count);
    }, [groupsState.joined]);

    // ── Auto-poll for database updates every 30s (Minimal API load) ──
    useEffect(() => {
        if (!authState.isAuthenticated) return;

        const pollData = async () => {
            try {
                // Silently refresh from database ONLY
                await fetchJoinedGroups(true);

                if (groupsState.activeGroupId) {
                    await fetchMessages(groupsState.activeGroupId, true);
                }
            } catch (e) { /* silent fail on poll */ }
        };

        const interval = setInterval(pollData, 5 * 60 * 1000); // Strict 5-minute poll
        return () => clearInterval(interval);
    }, [authState.isAuthenticated, groupsState.activeGroupId]);

    // ── Fetch status and joined groups on mount ──
    useEffect(() => {
        checkStatus();
        fetchJoinedGroups();
    }, []);

    const checkStatus = async () => {
        try {
            const response = await api.get('/telegram/status');
            if (response.data.authenticated) {
                setAuthState(prev => ({ ...prev, isAuthenticated: true, step: 'authenticated' }));
            }
        } catch (error) {
            console.error('Status check failed:', error);
        }
    };

    const fetchJoinedGroups = async (silent = false) => {
        if (!silent) setGroupsState(prev => ({ ...prev, loading: true }));
        try {
            const response = await api.get('/telegram/groups');
            const newData = response.data;

            setGroupsState(prev => {
                // If silent, merge to preserve some local states or avoid full flash
                // But mostly we just want to avoid the "loading" state.
                // However, for unread_count, we might want to keep our local "0" 
                // if we just clicked it and the backend hasn't synced yet.
                return { ...prev, joined: newData, loading: false };
            });
        } catch (error) {
            console.error('Failed to fetch groups:', error);
            if (!silent) setGroupsState(prev => ({ ...prev, loading: false }));
        }
    };

    const handleSendCode = async () => {
        if (!authState.phone) return toast.error('Phone number is required');
        setAuthState(prev => ({ ...prev, loading: true }));
        try {
            const response = await api.post('/telegram/auth/send-code', { phone: authState.phone });
            setAuthState(prev => ({
                ...prev, step: 'code', phoneCodeHash: response.data.phoneCodeHash, loading: false
            }));
            toast.success('Verification code sent to your Telegram app');
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to send code');
            setAuthState(prev => ({ ...prev, loading: false }));
        }
    };

    const handleVerifyCode = async () => {
        if (!authState.code) return toast.error('Code is required');
        setAuthState(prev => ({ ...prev, loading: true }));
        try {
            await api.post('/telegram/auth/verify', {
                phone: authState.phone, code: authState.code,
                phoneCodeHash: authState.phoneCodeHash, password: authState.password
            });
            setAuthState(prev => ({ ...prev, isAuthenticated: true, step: 'authenticated', loading: false }));
            toast.success('Authenticated successfully');
        } catch (error) {
            toast.error(error.response?.data?.message || 'Verification failed');
            setAuthState(prev => ({ ...prev, loading: false }));
        }
    };

    const handleSearch = async () => {
        if (!searchState.query) return;
        setSearchState(prev => ({ ...prev, loading: true }));
        setDiscoveryState(prev => ({
            ...prev, loading: true, offset: 0, privateResults: [], publicResults: [], myGroups: []
        }));
        try {
            console.log(`[Frontend] Searching Global: "${searchState.query}" (Deep: ${discoveryState.deepScan}, Auto: ${discoveryState.autoJoin})`);
            const queryParams = new URLSearchParams({
                q: searchState.query, offset: 0,
                deepScan: discoveryState.deepScan, autoJoin: discoveryState.autoJoin
            });
            const response = await api.get(`/telegram/search-global?${queryParams}`);
            setSearchState(prev => ({ ...prev, results: response.data.public || [], loading: false }));
            setDiscoveryState(prev => ({
                ...prev,
                privateResults: response.data.discovered_private || [],
                publicResults: response.data.discovered_public || [],
                myGroups: response.data.my_groups || [],
                loading: false, hasMore: response.data.has_more
            }));

            if (response.data.floodWait) {
                toast.error('Auto-Join Paused', {
                    description: `Telegram rate limit hit. ${response.data.floodWait.message}`,
                    duration: 8000
                });
            }

            setSidebarTab('discover');
        } catch (error) {
            toast.error('Search failed');
            setSearchState(prev => ({ ...prev, loading: false }));
            setDiscoveryState(prev => ({ ...prev, loading: false }));
        }
    };

    const handleLoadMore = async () => {
        const newOffset = discoveryState.offset + 5;
        setDiscoveryState(prev => ({ ...prev, loading: true }));
        try {
            const queryParams = new URLSearchParams({
                q: searchState.query, offset: newOffset,
                deepScan: discoveryState.deepScan, autoJoin: discoveryState.autoJoin
            });
            const response = await api.get(`/telegram/search-global?${queryParams}`);
            setDiscoveryState(prev => ({
                ...prev,
                privateResults: [...prev.privateResults, ...(response.data.discovered_private || [])],
                publicResults: [...prev.publicResults, ...(response.data.discovered_public || [])],
                offset: newOffset, loading: false, hasMore: response.data.has_more
            }));

            if (response.data.floodWait) {
                toast.error('Auto-Join Paused', {
                    description: `Telegram rate limit hit. ${response.data.floodWait.message}`,
                    duration: 8000
                });
            }
        } catch (error) {
            toast.error('Failed to load more');
            setDiscoveryState(prev => ({ ...prev, loading: false }));
        }
    };

    const handleJoin = async (identifier) => {
        toast.loading('Attempting to join...', { id: 'join-group' });
        try {
            const response = await api.post('/telegram/join', { identifier });

            // Check for various success states (200, 201, 202)
            const status = response.status;
            const resData = response.data;
            const isPending = status === 202 || resData?.status === 'request_sent' || resData?.status === 'already_pending';
            const isAlreadyJoined = resData?.status === 'already_joined';

            const updateDiscoveryUI = (newStatusLabel) => {
                setDiscoveryState(prev => {
                    const matchId = (r) => {
                        if (!identifier || !r) return false;
                        const id = identifier.toLowerCase();
                        return (r.link && r.link.toLowerCase().includes(id)) ||
                            (r.username && id.includes(r.username.toLowerCase())) ||
                            (r.id && id.includes(r.id.toString().toLowerCase())) ||
                            (id.includes(r.link?.toLowerCase() || '')) ||
                            (r.link && id.includes(r.link.toLowerCase()));
                    };

                    return {
                        ...prev,
                        privateResults: prev.privateResults.map(r =>
                            matchId(r) ? { ...r, joinStatus: newStatusLabel } : r
                        ),
                        publicResults: prev.publicResults.map(r =>
                            matchId(r) ? { ...r, joinStatus: newStatusLabel } : r
                        )
                    };
                });
            };

            if (isPending) {
                toast.success(resData?.message || 'Join request sent! Pending admin approval.', {
                    id: 'join-group',
                    duration: 6000
                });
                updateDiscoveryUI('Pending');
                fetchJoinedGroups();
            } else if (isAlreadyJoined) {
                toast.success(resData?.message || 'You are already a member of this group.', {
                    id: 'join-group',
                    duration: 4000
                });
                updateDiscoveryUI('Joined');
                fetchJoinedGroups();
            } else {
                toast.success('Successfully joined group', {
                    id: 'join-group',
                    duration: 4000
                });
                updateDiscoveryUI('Joined');
                fetchJoinedGroups();
                // Auto-scrape
                const gid = resData?.id || resData?.group?.id;
                if (gid) {
                    try {
                        await api.post(`/telegram/scrape/${gid}`);
                        fetchJoinedGroups();
                    } catch (e) { /* silent */ }
                }
            }
            setManualJoinUrl('');
        } catch (error) {
            if (error.response?.status === 429) {
                const waitMsg = error.response.data?.message || 'Rate limit hit.';
                toast.error('Telegram Rate Limit', {
                    id: 'join-group',
                    description: waitMsg,
                    duration: 10000
                });
            } else {
                toast.error(error.response?.data?.message || 'Failed to join group', { id: 'join-group' });
            }
        }
    };

    const handleSync = async () => {
        setIsSyncing(true);
        toast.loading('Syncing your groups from Telegram...', { id: 'sync-groups' });
        try {
            const response = await api.post('/telegram/sync');
            fetchJoinedGroups();
            toast.success(response.data.message, { id: 'sync-groups' });
        } catch (error) {
            toast.error('Sync failed', { id: 'sync-groups' });
        } finally {
            setIsSyncing(false);
        }
    };

    const handleLogout = async () => {
        toast.loading('Logging out...', { id: 'logout' });
        try {
            await api.post('/telegram/auth/logout');
            setAuthState({
                isAuthenticated: false,
                phone: '',
                code: '',
                phoneCodeHash: '',
                password: '',
                step: 'phone',
                loading: false
            });
            // Clear other relevant states
            setGroupsState(prev => ({
                ...prev,
                joined: [],
                activeGroupId: null,
                messages: []
            }));
            toast.success('Logged out successfully', { id: 'logout' });
        } catch (error) {
            toast.error('Logout failed', { id: 'logout' });
        }
    };

    const fetchMessages = async (groupId, silent = false) => {
        if (!silent) {
            setGroupsState(prev => ({ ...prev, activeGroupId: groupId, messagesLoading: true }));
            setShowMobileSidebar(false);
        } else {
            // Guard against background overwrite
            if (groupsState.activeGroupId !== groupId) return;
        }

        try {
            const response = await api.get(`/telegram/messages/${groupId}`);
            const newMessages = response.data || [];

            setGroupsState(prev => {
                if (prev.activeGroupId !== groupId) return prev;

                // For background sync, only append genuinely new messages
                if (silent) {
                    const existingIds = new Set(prev.messages.map(m => m.id));
                    const uniqueNew = newMessages.filter(m => !existingIds.has(m.id));

                    if (uniqueNew.length === 0) return { ...prev, messagesLoading: false };

                    const combined = [...prev.messages, ...uniqueNew].sort((a, b) => new Date(a.date) - new Date(b.date));
                    return { ...prev, messages: combined, messagesLoading: false };
                }

                // For manual clicks, return the fresh set but also clear unread count
                return { ...prev, messages: newMessages, messagesLoading: false };
            });

            // Optimistically clear the unread count in sidebar and sync to Telegram
            if (!silent) {
                setGroupsState(prev => ({
                    ...prev,
                    joined: prev.joined.map(g => g.id === groupId ? { ...g, unread_count: 0 } : g)
                }));

                // Fire and forget mark-read on server
                api.post(`/telegram/mark-read/${groupId}`).catch(e =>
                    console.warn('[Telegram UI] Failed to sync read status:', e.message)
                );
            }
        } catch (error) {
            console.error('Failed to fetch messages:', error);
            if (!silent) setGroupsState(prev => ({ ...prev, messagesLoading: false }));
        }
    };

    const handleScrape = async (groupId, silent = false) => {
        if (!silent) toast.loading('Scraping latest messages...', { id: 'scrape' });
        try {
            await api.post(`/telegram/scrape/${groupId}`);
            if (!silent) toast.success(`Scrape complete`, { id: 'scrape' });

            // Re-fetch strictly from DB to refresh view
            fetchMessages(groupId, true);
            fetchJoinedGroups(true);
        } catch (error) {
            if (!silent) toast.error('Scrape failed', { id: 'scrape' });
        }
    };


    const handleDeleteGroup = async (groupId) => {
        const group = groupsState.joined.find(g => g.id === groupId);
        toast.loading(`Deleting ${group?.title || 'group'}...`, { id: 'delete-group' });
        try {
            const response = await api.delete(`/telegram/group/${groupId}`);
            toast.success(response.data.message + ` (${response.data.deleted_messages} messages removed)`, { id: 'delete-group' });
            // If this was the active chat, clear it
            if (groupsState.activeGroupId === groupId) {
                setGroupsState(prev => ({ ...prev, activeGroupId: null, messages: [] }));
            }
            fetchJoinedGroups();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to delete group', { id: 'delete-group' });
        }
        setConfirmDialog(null);
    };

    const handleScrapeAll = async () => {
        setIsScrapeAll(true);
        toast.loading('Scraping all groups...', { id: 'scrape-all' });
        try {
            const response = await api.post('/telegram/scrape-all');
            toast.success(response.data.message, { id: 'scrape-all' });
            fetchJoinedGroups();
            if (groupsState.activeGroupId) fetchMessages(groupsState.activeGroupId);
        } catch (error) {
            toast.error('Batch scrape failed', { id: 'scrape-all' });
        } finally {
            setIsScrapeAll(false);
        }
    };

    const handleCheckPending = async () => {
        toast.loading('Checking pending requests...', { id: 'check-pending' });
        try {
            const response = await api.post('/telegram/check-pending');
            const { accepted, still_pending } = response.data;
            if (accepted.length > 0) {
                toast.success(`${accepted.length} group(s) accepted!`, { id: 'check-pending' });
                fetchJoinedGroups();
                // Auto-scrape accepted groups
                for (const group of accepted) {
                    if (group.id && group.status === 'joined') {
                        try { await api.post(`/telegram/scrape/${group.id}`); } catch (e) { }
                    }
                }
                fetchJoinedGroups();
            } else {
                toast.info(`${still_pending.length} group(s) still pending`, { id: 'check-pending' });
            }
        } catch (error) {
            toast.error('Check failed', { id: 'check-pending' });
        }
    };

    const handleFullSync = async () => {
        setIsSyncing(true);
        toast.loading('Full sync: checking pending + syncing groups...', { id: 'full-sync' });
        try {
            // 1. Check pending requests first
            await api.post('/telegram/check-pending');
            // 2. Sync all dialogs
            const response = await api.post('/telegram/sync');
            fetchJoinedGroups();
            toast.success(response.data.message, { id: 'full-sync' });
        } catch (error) {
            toast.error('Sync failed', { id: 'full-sync' });
        } finally {
            setIsSyncing(false);
        }
    };

    // ──────────────────────────────────────────────
    // AUTH SCREEN — Telegram-style centered auth
    // ──────────────────────────────────────────────
    if (!authState.isAuthenticated) {
        return (
            <div className="h-[calc(100vh-140px)] flex items-center justify-center p-4 relative overflow-hidden"
                style={{ background: 'radial-gradient(ellipse at 30% 20%, rgba(42,171,238,0.12), transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(34,158,217,0.08), transparent 50%), linear-gradient(135deg, hsl(200 70% 96%), hsl(217 60% 93%))' }}>
                {/* Floating glass orbs */}
                <div className="absolute top-[15%] left-[10%] w-32 h-32 rounded-full opacity-30 animate-pulse"
                    style={{ background: 'radial-gradient(circle, rgba(42,171,238,0.15), transparent 70%)', filter: 'blur(20px)' }} />
                <div className="absolute bottom-[20%] right-[15%] w-40 h-40 rounded-full opacity-20 animate-pulse"
                    style={{ background: 'radial-gradient(circle, rgba(42,171,238,0.12), transparent 70%)', filter: 'blur(25px)', animationDelay: '1s' }} />

                <div className="w-full max-w-sm relative z-10">
                    {/* Telegram Logo Area */}
                    <div className="text-center mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <div className="w-28 h-28 mx-auto mb-6 rounded-full flex items-center justify-center"
                            style={{ background: 'linear-gradient(135deg, #2AABEE, #1E9AD6, #229ED9)', boxShadow: '0 12px 40px rgba(42,171,238,0.35), 0 4px 12px rgba(42,171,238,0.2)' }}>
                            <Send className="h-14 w-14 text-white -rotate-[20deg] translate-x-0.5 drop-shadow-md" />
                        </div>
                        <h1 className="text-3xl font-bold text-gray-800 tracking-tight">Telegram</h1>
                        <p className="text-gray-500 mt-2 text-sm leading-relaxed">
                            {authState.step === 'phone'
                                ? 'Please confirm your country code and enter your phone number.'
                                : 'Enter the code sent to your Telegram app.'}
                        </p>
                    </div>

                    {/* Auth Card — Liquid Glass */}
                    <div className="rounded-2xl p-6 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500"
                        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.75), rgba(255,255,255,0.5))', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6)' }}>
                        {authState.step === 'phone' && (
                            <>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="+91 XXXXXXXXXX"
                                        className="w-full h-12 pl-10 pr-4 bg-white/50 border border-gray-200/60 rounded-xl text-sm focus:outline-none focus:border-[#2AABEE] focus:ring-2 focus:ring-[#2AABEE]/10 transition-all duration-200"
                                        style={{ backdropFilter: 'blur(8px)' }}
                                        value={authState.phone}
                                        onChange={(e) => setAuthState(prev => ({ ...prev, phone: e.target.value }))}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                                    />
                                </div>
                                <button
                                    className="w-full h-12 rounded-xl font-semibold text-white text-sm transition-all duration-300 disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
                                    style={{ background: 'linear-gradient(135deg, #2AABEE, #229ED9)', boxShadow: '0 4px 16px rgba(42,171,238,0.3)' }}
                                    onClick={handleSendCode}
                                    disabled={authState.loading}
                                >
                                    {authState.loading ? (
                                        <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                                    ) : 'NEXT'}
                                </button>
                            </>
                        )}

                        {authState.step === 'code' && (
                            <>
                                <div className="relative">
                                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Verification Code"
                                        className="w-full h-12 pl-10 pr-4 bg-white/50 border border-gray-200/60 rounded-xl text-sm tracking-[0.3em] text-center font-mono focus:outline-none focus:border-[#2AABEE] focus:ring-2 focus:ring-[#2AABEE]/10 transition-all duration-200"
                                        style={{ backdropFilter: 'blur(8px)' }}
                                        value={authState.code}
                                        onChange={(e) => setAuthState(prev => ({ ...prev, code: e.target.value }))}
                                        onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                                        autoFocus
                                    />
                                </div>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <input
                                        type="password"
                                        placeholder="2FA Password (if enabled)"
                                        className="w-full h-12 pl-10 pr-4 bg-white/50 border border-gray-200/60 rounded-xl text-sm focus:outline-none focus:border-[#2AABEE] focus:ring-2 focus:ring-[#2AABEE]/10 transition-all duration-200"
                                        style={{ backdropFilter: 'blur(8px)' }}
                                        value={authState.password}
                                        onChange={(e) => setAuthState(prev => ({ ...prev, password: e.target.value }))}
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        className="flex-1 h-12 rounded-xl font-semibold text-gray-600 text-sm border border-gray-200/60 transition-all duration-300 hover:bg-gray-50/50 hover:scale-[1.02] active:scale-[0.98]"
                                        style={{ backdropFilter: 'blur(8px)' }}
                                        onClick={() => setAuthState(prev => ({ ...prev, step: 'phone' }))}
                                    >
                                        BACK
                                    </button>
                                    <button
                                        className="flex-[2] h-12 rounded-xl font-semibold text-white text-sm transition-all duration-300 disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
                                        style={{ background: 'linear-gradient(135deg, #2AABEE, #229ED9)', boxShadow: '0 4px 16px rgba(42,171,238,0.3)' }}
                                        onClick={handleVerifyCode}
                                        disabled={authState.loading}
                                    >
                                        {authState.loading ? (
                                            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                                        ) : 'VERIFY'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    <p className="text-center text-xs text-gray-400/80 mt-6 animate-in fade-in duration-700">
                        One-time authentication for monitoring integration
                    </p>
                </div>
            </div>
        );
    }

    // ──────────────────────────────────────────────
    // MAIN TELEGRAM INTERFACE
    // ──────────────────────────────────────────────
    return (
        <div className="h-[calc(100vh-140px)] flex overflow-hidden rounded-2xl shadow-xl bg-background" style={{ border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 8px 40px rgba(0,0,0,0.08), 0 2px 12px rgba(0,0,0,0.04)' }}>

            {/* ═══════════════════════════════════════
                LEFT SIDEBAR — Chat List (Telegram style)
                ═══════════════════════════════════════ */}
            <div className={`${showMobileSidebar ? 'flex' : 'hidden'} lg:flex flex-col w-full lg:w-[420px] lg:min-w-[320px]`}
                style={{ borderRight: '1px solid rgba(0,0,0,0.06)', background: 'linear-gradient(180deg, rgba(255,255,255,0.95), rgba(248,250,252,0.9))', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>

                {/* Sidebar Header */}
                <div className="flex-shrink-0 h-14 flex items-center px-3 gap-2 relative z-50" style={{ background: 'linear-gradient(135deg, #2AABEE, #1E9AD6, #229ED9)', boxShadow: '0 2px 20px rgba(42,171,238,0.2)' }}>
                    {/* Hamburger / Menu */}
                    <button
                        className="h-10 w-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-white"
                        onClick={() => setShowGroupMenu(prev => !prev)}
                    >
                        <MoreVertical className="h-5 w-5" />
                    </button>

                    {/* Search Bar */}
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
                        <input
                            type="text"
                            placeholder="Search groups..."
                            className="w-full h-9 pl-9 pr-3 bg-white/15 text-white placeholder-white/60 rounded-full text-sm focus:outline-none focus:bg-white/25 transition-colors"
                            value={searchState.query}
                            onChange={(e) => setSearchState(prev => ({ ...prev, query: e.target.value }))}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSearch();
                                if (e.key === 'Escape') {
                                    setSearchState(prev => ({ ...prev, query: '' }));
                                    setSidebarTab('chats');
                                }
                            }}
                            onFocus={() => setSearchFocused(true)}
                            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                        />
                        {searchState.query && (
                            <button
                                className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center text-white/60 hover:text-white"
                                onClick={() => {
                                    setSearchState(prev => ({ ...prev, query: '', results: [] }));
                                    setDiscoveryState(prev => ({ ...prev, privateResults: [], publicResults: [], myGroups: [] }));
                                    setSidebarTab('chats');
                                }}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Global Search Trigger */}
                    <button
                        className="h-10 w-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-white"
                        onClick={handleSearch}
                        disabled={searchState.loading || !searchState.query}
                        title="Search Telegram globally"
                    >
                        {searchState.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-5 w-5" />}
                    </button>

                    {/* Dropdown Menu */}
                    {showGroupMenu && (
                        <div className="absolute top-[60px] left-2 z-50 w-64 bg-card rounded-xl shadow-xl border border-border py-1 animate-in fade-in slide-in-from-top-2 duration-200">
                            <button
                                className="w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 hover:bg-muted transition-colors"
                                onClick={() => { handleFullSync(); setShowGroupMenu(false); }}
                                disabled={isSyncing}
                            >
                                {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                <div>
                                    <div className="font-medium">Full Sync</div>
                                    <div className="text-[10px] text-muted-foreground">Check pending + sync from mobile</div>
                                </div>
                            </button>
                            <button
                                className="w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 hover:bg-muted transition-colors"
                                onClick={() => { handleScrapeAll(); setShowGroupMenu(false); }}
                                disabled={isScrapeAll}
                            >
                                {isScrapeAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                <div>
                                    <div className="font-medium">Scrape All Groups</div>
                                    <div className="text-[10px] text-muted-foreground">Fetch latest messages from all groups</div>
                                </div>
                            </button>
                            {pendingCount > 0 && (
                                <button
                                    className="w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 hover:bg-muted transition-colors"
                                    onClick={() => { handleCheckPending(); setShowGroupMenu(false); }}
                                >
                                    <Clock className="h-4 w-4 text-orange-500" />
                                    <div>
                                        <div className="font-medium">Check Pending ({pendingCount})</div>
                                        <div className="text-[10px] text-muted-foreground">Check if join requests accepted</div>
                                    </div>
                                </button>
                            )}
                            <div className="border-t border-border my-1" />
                            <button
                                className="w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 hover:bg-muted transition-colors"
                                onClick={() => { fetchJoinedGroups(); setShowGroupMenu(false); }}
                            >
                                <RefreshCw className="h-4 w-4" />
                                Refresh Group List
                            </button>
                            <button
                                className="w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 hover:bg-muted transition-colors"
                                onClick={() => { setSidebarTab('discover'); setShowGroupMenu(false); }}
                            >
                                <Search className="h-4 w-4" />
                                Discover Groups
                            </button>
                            <div className="border-t border-border my-1" />
                            <button
                                className="w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 hover:bg-red-500/10 text-red-600 dark:text-red-400 transition-colors"
                                onClick={() => { handleLogout(); setShowGroupMenu(false); }}
                            >
                                <LogOut className="h-4 w-4" />
                                <div>
                                    <div className="font-medium">Logout Account</div>
                                    <div className="text-[10px] opacity-70">Disconnect and link a new account</div>
                                </div>
                            </button>
                        </div>
                    )}
                </div>

                {showGroupMenu && (
                    <div className="fixed inset-0 z-40" onClick={() => setShowGroupMenu(false)} />
                )}

                {/* Tab Switcher — Liquid Glass */}
                <div className="flex-shrink-0 flex p-2 gap-1" style={{ background: 'linear-gradient(180deg, rgba(42,171,238,0.04), transparent)', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <button
                        className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-all duration-300 relative ${sidebarTab === 'chats'
                            ? 'text-[#2AABEE] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        style={sidebarTab === 'chats' ? {
                            background: 'linear-gradient(135deg, rgba(42,171,238,0.12), rgba(42,171,238,0.06))',
                            backdropFilter: 'blur(12px)',
                            border: '1px solid rgba(42,171,238,0.15)',
                            boxShadow: '0 2px 8px rgba(42,171,238,0.1), inset 0 1px 0 rgba(255,255,255,0.5)',
                        } : { border: '1px solid transparent' }}
                        onClick={() => setSidebarTab('chats')}
                    >
                        Chats
                        {pendingCount > 0 && (
                            <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-[16px] px-1 text-[10px] font-bold text-white bg-orange-500 rounded-full">
                                {pendingCount}
                            </span>
                        )}
                    </button>
                    <button
                        className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-all duration-300 relative ${sidebarTab === 'discover'
                            ? 'text-[#2AABEE] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        style={sidebarTab === 'discover' ? {
                            background: 'linear-gradient(135deg, rgba(42,171,238,0.12), rgba(42,171,238,0.06))',
                            backdropFilter: 'blur(12px)',
                            border: '1px solid rgba(42,171,238,0.15)',
                            boxShadow: '0 2px 8px rgba(42,171,238,0.1), inset 0 1px 0 rgba(255,255,255,0.5)',
                        } : { border: '1px solid transparent' }}
                        onClick={() => setSidebarTab('discover')}
                    >
                        Discover
                        {allDiscoveryResults.length > 0 && (
                            <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-[16px] px-1 text-[10px] font-bold text-white bg-[#2AABEE] rounded-full">
                                {allDiscoveryResults.length}
                            </span>
                        )}
                    </button>
                </div>

                {/* ── Chat List Tab ── */}
                {sidebarTab === 'chats' && (
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {/* Manual Join Bar */}
                        <div className="px-3 py-2.5" style={{ background: 'linear-gradient(135deg, rgba(42,171,238,0.03), rgba(255,255,255,0.4))', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                            <div className="flex gap-1.5">
                                <input
                                    type="text"
                                    placeholder="Paste invite link to join..."
                                    className="flex-1 h-8 px-3 bg-background border border-border rounded-lg text-xs focus:outline-none focus:border-[#2AABEE] transition-colors"
                                    value={manualJoinUrl}
                                    onChange={(e) => setManualJoinUrl(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && manualJoinUrl && handleJoin(manualJoinUrl)}
                                />
                                <button
                                    className="h-8 px-3 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-colors"
                                    style={{ background: '#2AABEE' }}
                                    onClick={() => handleJoin(manualJoinUrl)}
                                    disabled={!manualJoinUrl}
                                >
                                    <UserPlus className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>

                        {/* Loading State */}
                        {groupsState.loading && (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="h-6 w-6 animate-spin text-[#2AABEE]" />
                            </div>
                        )}

                        {/* Empty State */}
                        {!groupsState.loading && filteredGroups.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                                    <MessageSquare className="h-7 w-7 text-muted-foreground" />
                                </div>
                                <p className="text-sm font-medium text-muted-foreground mb-1">No groups yet</p>
                                <p className="text-xs text-muted-foreground/70">Search for groups or paste an invite link to start monitoring</p>
                            </div>
                        )}

                        {/* Group Chat Items */}
                        {filteredGroups.map((group) => {
                            const isPending = group.status === 'pending';
                            const isActive = groupsState.activeGroupId === group.id;
                            return (
                                <div
                                    key={group.id}
                                    className={`flex items-center gap-3 px-3 py-2.5 transition-all duration-200 ${isPending
                                        ? 'opacity-70 cursor-default'
                                        : `cursor-pointer ${isActive ? '' : 'hover:bg-[#2AABEE]/[0.04]'}`
                                        }`}
                                    style={{
                                        ...(isActive && !isPending ? {
                                            background: 'linear-gradient(135deg, rgba(42,171,238,0.08), rgba(42,171,238,0.04))',
                                            borderLeft: '3px solid #2AABEE',
                                            paddingLeft: '9px',
                                        } : {}),
                                        ...(isPending ? {
                                            background: 'linear-gradient(135deg, rgba(249,115,22,0.04), rgba(249,115,22,0.02))',
                                        } : {}),
                                        borderBottom: '1px solid hsl(var(--border) / 0.2)',
                                    }}
                                    onClick={() => !isPending && fetchMessages(group.id)}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        setGroupActionMenu({ groupId: group.id, groupTitle: group.title, status: group.status, x: e.clientX, y: e.clientY });
                                    }}
                                >
                                    {/* Avatar */}
                                    <div className="relative flex-shrink-0">
                                        <div className={`h-11 w-11 rounded-full ${getAvatarColor(group.title)} flex items-center justify-center text-white font-bold text-base shadow-md`}
                                            style={{ boxShadow: isActive ? '0 4px 12px rgba(42,171,238,0.2)' : undefined }}>
                                            {group.title.charAt(0).toUpperCase()}
                                        </div>
                                        {isPending && (
                                            <div className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-orange-500 flex items-center justify-center ring-2 ring-card">
                                                <Clock className="h-3 w-3 text-white" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                {group.type === 'private' ? (
                                                    <Lock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                ) : (
                                                    <Globe className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                )}
                                                <span className="font-semibold text-sm truncate">{group.title}</span>
                                            </div>
                                            {isPending ? (
                                                <span className="text-[10px] font-semibold text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
                                                    Pending
                                                </span>
                                            ) : (
                                                <span className="text-[11px] text-muted-foreground flex-shrink-0">
                                                    {formatTime(group.last_scraped_at)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between gap-2 mt-0.5">
                                            <span className="text-xs text-muted-foreground truncate">
                                                {isPending
                                                    ? 'Waiting for admin approval...'
                                                    : group.message_count > 0
                                                        ? `${group.message_count} messages scraped`
                                                        : 'No messages yet'}
                                            </span>
                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                {!isPending && group.unread_count > 0 && (
                                                    <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 text-[10px] font-bold text-white bg-[#2AABEE] rounded-full shadow-sm" title="New unread messages">
                                                        {group.unread_count > 999 ? '999+' : group.unread_count}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                    </div>
                )}

                {/* ── Discover Tab ── */}
                {sidebarTab === 'discover' && (
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {/* Discovery Controls */}
                        <div className="px-3 py-3 border-b border-border bg-muted/20 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <button
                                    className={`flex-1 flex items-center justify-between gap-2 p-2.5 rounded-xl border transition-all ${discoveryState.deepScan ? 'bg-[#2AABEE]/10 border-[#2AABEE]/50 text-[#2AABEE]' : 'bg-card border-border/50 text-muted-foreground hover:border-border'}`}
                                    onClick={() => setDiscoveryState(prev => ({ ...prev, deepScan: !prev.deepScan }))}
                                >
                                    <div className="flex items-center gap-2">
                                        <Zap className={`h-4 w-4 ${discoveryState.deepScan ? 'animate-pulse' : ''}`} />
                                        <span className="text-[10px] font-bold uppercase tracking-wider">Deep Scan</span>
                                    </div>
                                    <div className={`w-8 h-4 rounded-full transition-colors relative ${discoveryState.deepScan ? 'bg-[#2AABEE]' : 'bg-muted-foreground/30'}`}>
                                        <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${discoveryState.deepScan ? 'left-[18px]' : 'left-1'}`} />
                                    </div>
                                </button>

                                <button
                                    className={`flex-1 flex items-center justify-between gap-2 p-2.5 rounded-xl border transition-all ${discoveryState.autoJoin ? 'bg-orange-500/10 border-orange-500/50 text-orange-600' : 'bg-card border-border/50 text-muted-foreground hover:border-border'}`}
                                    onClick={() => setDiscoveryState(prev => ({ ...prev, autoJoin: !prev.autoJoin }))}
                                >
                                    <div className="flex items-center gap-2">
                                        <Users className="h-4 w-4" />
                                        <span className="text-[10px] font-bold uppercase tracking-wider">Auto-Join</span>
                                    </div>
                                    <div className={`w-8 h-4 rounded-full transition-colors relative ${discoveryState.autoJoin ? 'bg-orange-500' : 'bg-muted-foreground/30'}`}>
                                        <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${discoveryState.autoJoin ? 'left-[18px]' : 'left-1'}`} />
                                    </div>
                                </button>
                            </div>

                            {/* Discovery Sub-Tabs — Liquid Glass */}
                            <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(0,0,0,0.03), rgba(0,0,0,0.01))', border: '1px solid rgba(0,0,0,0.04)', backdropFilter: 'blur(8px)' }}>
                                <button
                                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${discoveryState.discoveryTab === 'public' ? 'text-[#2AABEE] shadow-sm' : 'text-muted-foreground hover:bg-white/50'}`}
                                    style={discoveryState.discoveryTab === 'public' ? {
                                        background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.7))',
                                        border: '1px solid rgba(42,171,238,0.15)',
                                        boxShadow: '0 2px 8px rgba(42,171,238,0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
                                    } : { border: '1px solid transparent' }}
                                    onClick={() => setDiscoveryState(prev => ({ ...prev, discoveryTab: 'public' }))}
                                >
                                    Public ({searchState.results.length})
                                </button>
                                <button
                                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${discoveryState.discoveryTab === 'discovered' ? 'text-[#2AABEE] shadow-sm' : 'text-muted-foreground hover:bg-white/50'}`}
                                    style={discoveryState.discoveryTab === 'discovered' ? {
                                        background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.7))',
                                        border: '1px solid rgba(42,171,238,0.15)',
                                        boxShadow: '0 2px 8px rgba(42,171,238,0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
                                    } : { border: '1px solid transparent' }}
                                    onClick={() => setDiscoveryState(prev => ({ ...prev, discoveryTab: 'discovered' }))}
                                >
                                    Discovered ({discoveryState.publicResults.length})
                                </button>
                                <button
                                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${discoveryState.discoveryTab === 'private' ? 'text-orange-600 shadow-sm' : 'text-muted-foreground hover:bg-white/50'}`}
                                    style={discoveryState.discoveryTab === 'private' ? {
                                        background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.7))',
                                        border: '1px solid rgba(249,115,22,0.15)',
                                        boxShadow: '0 2px 8px rgba(249,115,22,0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
                                    } : { border: '1px solid transparent' }}
                                    onClick={() => setDiscoveryState(prev => ({ ...prev, discoveryTab: 'private' }))}
                                >
                                    Private ({discoveryState.privateResults.length})
                                </button>
                            </div>

                            <div className="text-[11px] text-[#2AABEE] px-3 py-2.5 rounded-xl flex items-start gap-2.5 leading-relaxed"
                                style={{ background: 'linear-gradient(135deg, rgba(42,171,238,0.06), rgba(42,171,238,0.02))', border: '1px solid rgba(42,171,238,0.1)', backdropFilter: 'blur(8px)' }}>
                                <div className="h-6 w-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                                    style={{ background: 'linear-gradient(135deg, rgba(42,171,238,0.15), rgba(42,171,238,0.08))' }}>
                                    <Globe className="h-3.5 w-3.5 text-[#2AABEE]" />
                                </div>
                                <span><b className="font-bold">Deep Discovery Active:</b> System is performing native Hub Scanning to identify unlisted private groups and leaked invite links from public channels.</span>
                            </div>
                        </div>

                        {/* Discovery Loading */}
                        {discoveryState.loading && allDiscoveryResults.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-12 gap-3">
                                <Loader2 className="h-7 w-7 animate-spin text-[#2AABEE]" />
                                <p className="text-xs text-muted-foreground">Scanning Telegram network...</p>
                            </div>
                        )}

                        {/* My Groups Section */}
                        {discoveryState.myGroups.length > 0 && (
                            <div>
                                <div className="px-3 py-2.5 flex items-center gap-2"
                                    style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.06), rgba(16,185,129,0.02))', borderBottom: '1px solid rgba(16,185,129,0.08)' }}>
                                    <div className="h-5 w-5 rounded-md flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.12)' }}>
                                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                    </div>
                                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                                        Already Joined ({discoveryState.myGroups.length})
                                    </span>
                                </div>
                                {discoveryState.myGroups.map((group, i) => (
                                    <div key={`my-${i}`} className="flex items-center gap-3 px-3 py-3 transition-all duration-200 hover:bg-emerald-500/[0.03]"
                                        style={{ borderBottom: '1px solid hsl(var(--border) / 0.15)' }}>
                                        <div className={`h-10 w-10 rounded-full ${getAvatarColor(group.title)} flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm`}>
                                            {group.title?.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                                                <span className="font-semibold text-sm truncate">{group.title}</span>
                                            </div>
                                            <span className="text-[11px] text-muted-foreground">
                                                {group.username ? `@${group.username}` : 'Private'} • {(group.member_count || 0).toLocaleString()} members
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Public Search Results */}
                        {discoveryState.discoveryTab === 'public' && searchState.results.length > 0 && (
                            <div>
                                <div className="px-3 py-2.5 flex items-center gap-2"
                                    style={{ background: 'linear-gradient(135deg, rgba(42,171,238,0.06), rgba(42,171,238,0.02))', borderBottom: '1px solid rgba(42,171,238,0.08)' }}>
                                    <div className="h-5 w-5 rounded-md flex items-center justify-center" style={{ background: 'rgba(42,171,238,0.12)' }}>
                                        <Globe className="h-3 w-3 text-[#2AABEE]" />
                                    </div>
                                    <span className="text-[11px] font-bold text-[#2AABEE] uppercase tracking-wider">
                                        Public Groups ({searchState.results.length})
                                    </span>
                                </div>
                                {searchState.results.length === 0 && !discoveryState.loading && (
                                    <div className="py-10 text-center text-muted-foreground italic text-xs px-4">
                                        No public groups found for this keyword.
                                    </div>
                                )}
                                {searchState.results.map((group) => (
                                    <div key={group.telegram_id} className="flex items-center gap-3 px-3 py-3 transition-all duration-200 hover:bg-[#2AABEE]/[0.03] group/item"
                                        style={{ borderBottom: '1px solid hsl(var(--border) / 0.15)' }}>
                                        <div className={`h-10 w-10 rounded-full ${getAvatarColor(group.title)} flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm`}>
                                            {group.title?.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-semibold text-sm truncate">{group.title}</span>
                                                {group.verified && <CheckCircle2 className="h-3.5 w-3.5 text-[#2AABEE] fill-[#2AABEE] flex-shrink-0" />}
                                            </div>
                                            <span className="text-[11px] text-muted-foreground">
                                                {group.username ? `@${group.username}` : ''} • {group.member_count?.toLocaleString() || 0} members
                                            </span>
                                        </div>
                                        <button
                                            className="h-8 px-4 rounded-lg text-[11px] font-semibold text-white opacity-0 group-hover/item:opacity-100 transition-all duration-200 flex-shrink-0 hover:scale-105 active:scale-95"
                                            style={{ background: 'linear-gradient(135deg, #2AABEE, #229ED9)', boxShadow: '0 2px 8px rgba(42,171,238,0.25)' }}
                                            onClick={(e) => { e.stopPropagation(); handleJoin(group.username || group.telegram_id); }}
                                        >
                                            Join
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Discovered Public (Hub Scan) */}
                        {discoveryState.discoveryTab === 'discovered' && (
                            <div className="px-2 py-2 space-y-2">
                                {discoveryState.publicResults.length === 0 && !discoveryState.loading && (
                                    <div className="py-10 text-center text-muted-foreground italic text-xs">
                                        No public groups discovered via Hub Scanning yet.
                                    </div>
                                )}
                                {discoveryState.publicResults.map((result, i) => {
                                    const isExpanded = expandedResults.has(result.id);
                                    const toggleExpand = () => {
                                        const newExpanded = new Set(expandedResults);
                                        if (isExpanded) newExpanded.delete(result.id);
                                        else newExpanded.add(result.id);
                                        setExpandedResults(newExpanded);
                                    };

                                    return (
                                        <div key={`pub-${i}`} className="rounded-xl transition-all duration-200 group/item"
                                            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.6), rgba(255,255,255,0.35))', border: '1px solid hsl(var(--border) / 0.2)', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                                            <div className="flex items-center gap-3 px-3 py-3">
                                                <div className="h-10 w-10 rounded-full flex items-center justify-center text-white flex-shrink-0 shadow-sm"
                                                    style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}>
                                                    <Globe className="h-4.5 w-4.5" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <span className="font-semibold text-sm truncate block">{result.title}</span>
                                                    <span className="text-[11px] text-muted-foreground truncate block">
                                                        {result.username ? `@${result.username}` : result.link}
                                                    </span>
                                                </div>
                                                <button
                                                    disabled={!!result.joinStatus}
                                                    className={`h-8 px-4 rounded-lg text-[11px] font-semibold text-white transition-all duration-200 flex-shrink-0 ${result.joinStatus ? 'cursor-default' : 'opacity-0 group-hover/item:opacity-100 hover:scale-105 active:scale-95'}`}
                                                    style={{ background: result.joinStatus ? '#9ca3af' : 'linear-gradient(135deg, #2AABEE, #229ED9)', boxShadow: result.joinStatus ? 'none' : '0 2px 8px rgba(42,171,238,0.25)' }}
                                                    onClick={(e) => { e.stopPropagation(); handleJoin(result.username || result.link); }}
                                                >
                                                    {result.joinStatus || 'Join'}
                                                </button>
                                            </div>

                                            {result.full_text && (
                                                <div className="px-3 pb-3">
                                                    <div className={`rounded-lg p-2.5 text-[11px] text-muted-foreground leading-relaxed overflow-hidden transition-all duration-500 ease-in-out ${isExpanded ? 'max-h-[1000px]' : 'max-h-[48px]'}`}
                                                        style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid hsl(var(--border) / 0.12)' }}>
                                                        <div className="flex items-start gap-2">
                                                            <MessageSquare className="h-3.5 w-3.5 mt-0.5 text-muted-foreground/40 flex-shrink-0" />
                                                            <div className="flex-1 whitespace-pre-wrap text-[11px] leading-relaxed">
                                                                {highlightText(result.full_text, searchState.query)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center justify-between mt-2">
                                                        <button
                                                            onClick={toggleExpand}
                                                            className="text-[11px] font-semibold text-[#2AABEE] hover:text-[#2AABEE]/70 transition-colors flex items-center gap-1"
                                                        >
                                                            {isExpanded ? (
                                                                <>Show Less <ChevronUp className="h-3 w-3" /></>
                                                            ) : (
                                                                <>View More <ChevronDown className="h-3 w-3" /></>
                                                            )}
                                                        </button>
                                                        {result.source_title && (
                                                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                                                                <Globe className="h-3 w-3" />
                                                                <span>Found in <span className="font-semibold text-muted-foreground/80">{result.source_title}</span></span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Discovered Private (Hub Scan) */}
                        {discoveryState.discoveryTab === 'private' && (
                            <div className="px-2 py-2 space-y-2">
                                {discoveryState.privateResults.length === 0 && !discoveryState.loading && (
                                    <div className="py-10 text-center text-muted-foreground italic text-xs">
                                        No private groups discovered via Hub Scanning yet.
                                    </div>
                                )}
                                {discoveryState.privateResults.map((result, i) => {
                                    const isExpanded = expandedResults.has(result.id);
                                    const toggleExpand = () => {
                                        const newExpanded = new Set(expandedResults);
                                        if (isExpanded) newExpanded.delete(result.id);
                                        else newExpanded.add(result.id);
                                        setExpandedResults(newExpanded);
                                    };

                                    return (
                                        <div key={`priv-${i}`} className="rounded-xl transition-all duration-200 group/item"
                                            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.6), rgba(255,255,255,0.35))', border: '1px solid hsl(var(--border) / 0.2)', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                                            <div className="flex items-center gap-3 px-3 py-3">
                                                <div className="h-10 w-10 rounded-full flex items-center justify-center text-white flex-shrink-0 shadow-sm"
                                                    style={{ background: 'linear-gradient(135deg, #f97316, #ea580c)' }}>
                                                    <Lock className="h-4.5 w-4.5" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <span className="font-semibold text-sm truncate block">{result.title}</span>
                                                    <span className="text-[11px] text-orange-500/70 truncate block">
                                                        Private invite link
                                                    </span>
                                                </div>
                                                <button
                                                    disabled={!!result.joinStatus}
                                                    className={`h-8 px-4 rounded-lg text-[11px] font-semibold text-white transition-all duration-200 flex-shrink-0 ${result.joinStatus ? 'cursor-default' : 'opacity-0 group-hover/item:opacity-100 hover:scale-105 active:scale-95'}`}
                                                    style={{ background: result.joinStatus ? '#9ca3af' : 'linear-gradient(135deg, #f97316, #ea580c)', boxShadow: result.joinStatus ? 'none' : '0 2px 8px rgba(249,115,22,0.25)' }}
                                                    onClick={(e) => { e.stopPropagation(); handleJoin(result.link); }}
                                                >
                                                    {result.joinStatus || 'Join'}
                                                </button>
                                            </div>

                                            {result.full_text && (
                                                <div className="px-3 pb-3">
                                                    <div className={`rounded-lg p-2.5 text-[11px] text-muted-foreground leading-relaxed overflow-hidden transition-all duration-500 ease-in-out ${isExpanded ? 'max-h-[1000px]' : 'max-h-[48px]'}`}
                                                        style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid hsl(var(--border) / 0.12)' }}>
                                                        <div className="flex items-start gap-2">
                                                            <MessageSquare className="h-3.5 w-3.5 mt-0.5 text-muted-foreground/40 flex-shrink-0" />
                                                            <div className="flex-1 whitespace-pre-wrap text-[11px] leading-relaxed">
                                                                {highlightText(result.full_text, searchState.query)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center justify-between mt-2">
                                                        <button
                                                            onClick={toggleExpand}
                                                            className="text-[11px] font-semibold text-orange-500 hover:text-orange-400 transition-colors flex items-center gap-1"
                                                        >
                                                            {isExpanded ? (
                                                                <>Show Less <ChevronUp className="h-3 w-3" /></>
                                                            ) : (
                                                                <>View More <ChevronDown className="h-3 w-3" /></>
                                                            )}
                                                        </button>
                                                        {result.source_title && (
                                                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                                                                <Globe className="h-3 w-3" />
                                                                <span>Found in <span className="font-semibold text-muted-foreground/80">{result.source_title}</span></span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Load More */}
                        {discoveryState.hasMore && (
                            <div className="py-4 flex justify-center">
                                <button
                                    className="h-9 px-6 rounded-xl text-[11px] font-semibold text-white transition-all duration-300 disabled:opacity-50 flex items-center gap-2 hover:scale-105 active:scale-95"
                                    style={{ background: 'linear-gradient(135deg, #2AABEE, #229ED9)', boxShadow: '0 4px 16px rgba(42,171,238,0.2)' }}
                                    onClick={handleLoadMore}
                                    disabled={discoveryState.loading}
                                >
                                    {discoveryState.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    Load More
                                </button>
                            </div>
                        )}

                    </div>
                )}
            </div>

            {/* ═══════════════════════════════════════
                RIGHT PANEL — Chat / Messages Area
                ═══════════════════════════════════════ */}
            <div className={`${!showMobileSidebar ? 'flex' : 'hidden'} lg:flex flex-col flex-1 min-w-0`}>
                {/* ── No Chat Selected State ── */}
                {!groupsState.activeGroupId && (
                    <div className="flex-1 flex flex-col items-center justify-center"
                        style={{ background: 'radial-gradient(ellipse at 30% 20%, rgba(42,171,238,0.04), transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(42,171,238,0.03), transparent 60%), hsl(var(--background))' }}>
                        <div className="text-center animate-in fade-in duration-500">
                            <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center shadow-lg"
                                style={{ background: 'linear-gradient(135deg, #2AABEE, #1E9AD6, #229ED9)', boxShadow: '0 8px 32px rgba(42,171,238,0.25)' }}>
                                <Send className="h-10 w-10 text-white -rotate-[20deg]" />
                            </div>
                            <h2 className="text-xl font-bold text-foreground mb-2">Telegram Monitor</h2>
                            <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                                Select a group from the sidebar to view messages, or search for new groups to monitor.
                            </p>
                            <div className="mt-6">
                                <button
                                    className="h-10 px-6 rounded-xl text-sm font-semibold text-white flex items-center gap-2 mx-auto transition-all duration-300 hover:scale-105 active:scale-95"
                                    style={{ background: 'linear-gradient(135deg, #2AABEE, #229ED9)', boxShadow: '0 4px 16px rgba(42,171,238,0.3)' }}
                                    onClick={() => { setSidebarTab('discover'); setShowMobileSidebar(true); }}
                                >
                                    <Search className="h-4 w-4" /> Discover Groups
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Active Chat View ── */}
                {groupsState.activeGroupId && activeGroup && (
                    <>
                        {/* Chat Header */}
                        <div className="flex-shrink-0 h-14 flex items-center px-3 gap-3"
                            style={{ background: 'linear-gradient(135deg, #2AABEE, #1E9AD6, #229ED9)', boxShadow: '0 2px 20px rgba(42,171,238,0.15)' }}>
                            {/* Back button (mobile) */}
                            <button
                                className="lg:hidden h-10 w-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-white"
                                onClick={() => { setShowMobileSidebar(true); setGroupsState(prev => ({ ...prev, activeGroupId: null })); }}
                            >
                                <ArrowLeft className="h-5 w-5" />
                            </button>

                            {/* Group Avatar */}
                            <div className={`h-10 w-10 rounded-full ${getAvatarColor(activeGroup.title)} flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm`}>
                                {activeGroup.title.charAt(0).toUpperCase()}
                            </div>

                            {/* Group Info */}
                            <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-sm text-white truncate">{activeGroup.title}</h3>
                                <p className="text-[10px] text-white/60">{activeGroup.message_count || 0} messages</p>
                            </div>

                            {/* Single menu button */}
                            <div className="relative">
                                <button
                                    className="h-10 w-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-white"
                                    onClick={() => setChatHeaderMenu(prev => !prev)}
                                    title="Group actions"
                                >
                                    <MoreVertical className="h-5 w-5" />
                                </button>
                                {chatHeaderMenu && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setChatHeaderMenu(false)} />
                                        <div
                                            className="absolute right-0 top-12 z-50 w-56 rounded-2xl py-1.5 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden"
                                            style={{
                                                background: 'linear-gradient(135deg, rgba(255,255,255,0.88), rgba(255,255,255,0.7))',
                                                backdropFilter: 'blur(20px) saturate(180%)',
                                                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                                                boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.5)',
                                                border: '1px solid rgba(255,255,255,0.3)',
                                            }}
                                        >
                                            <button
                                                className="w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-200 active:scale-[0.98]"
                                                onClick={() => { handleScrape(activeGroup.id); setChatHeaderMenu(false); }}
                                            >
                                                <div className="h-7 w-7 rounded-lg bg-[#2AABEE]/10 flex items-center justify-center">
                                                    <Download className="h-3.5 w-3.5 text-[#2AABEE]" />
                                                </div>
                                                <span className="font-medium">Scrape Messages</span>
                                            </button>
                                            <button
                                                className="w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-200 active:scale-[0.98]"
                                                onClick={() => { fetchMessages(activeGroup.id); setChatHeaderMenu(false); }}
                                            >
                                                <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                                    <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
                                                </div>
                                                <span className="font-medium">Refresh Messages</span>
                                            </button>
                                            <button
                                                className="w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-200 active:scale-[0.98]"
                                                onClick={() => {
                                                    setConfirmDialog({ type: 'delete', groupId: activeGroup.id, groupTitle: activeGroup.title });
                                                    setChatHeaderMenu(false);
                                                }}
                                            >
                                                <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-red-500/15 to-rose-500/10 flex items-center justify-center">
                                                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                                </div>
                                                <span className="font-medium text-red-600 dark:text-red-400">Delete Group & Data</span>
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 sm:px-6 lg:px-10 py-4"
                            style={{ background: 'radial-gradient(ellipse at 20% 10%, rgba(42,171,238,0.03), transparent 50%), radial-gradient(ellipse at 80% 90%, rgba(42,171,238,0.02), transparent 50%), linear-gradient(to bottom, hsl(var(--background)), hsl(var(--muted) / 0.15))' }}>

                            {/* Loading */}
                            {groupsState.messagesLoading && (
                                <div className="flex items-center justify-center h-full">
                                    <div className="text-center">
                                        <Loader2 className="h-8 w-8 animate-spin text-[#2AABEE] mx-auto mb-3" />
                                        <p className="text-sm text-muted-foreground">Loading messages...</p>
                                    </div>
                                </div>
                            )}

                            {/* Empty State */}
                            {!groupsState.messagesLoading && groupsState.messages.length === 0 && (
                                <div className="flex flex-col items-center justify-center h-full">
                                    <div className="rounded-2xl p-8 text-center max-w-sm"
                                        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.7), rgba(255,255,255,0.4))', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.3)', boxShadow: '0 8px 32px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.5)' }}>
                                        <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
                                            style={{ background: 'linear-gradient(135deg, rgba(42,171,238,0.1), rgba(42,171,238,0.05))' }}>
                                            <MessageSquare className="h-7 w-7 text-[#2AABEE]/40" />
                                        </div>
                                        <h4 className="font-semibold text-sm mb-2">No messages yet</h4>
                                        <p className="text-xs text-muted-foreground mb-4">
                                            Scrape messages from this group to start monitoring.
                                        </p>
                                        <button
                                            className="h-9 px-5 rounded-xl text-xs font-semibold text-white flex items-center gap-2 mx-auto transition-all duration-300 hover:scale-105 active:scale-95"
                                            style={{ background: 'linear-gradient(135deg, #2AABEE, #229ED9)', boxShadow: '0 4px 16px rgba(42,171,238,0.3)' }}
                                            onClick={() => handleScrape(activeGroup.id)}
                                        >
                                            <Download className="h-3.5 w-3.5" /> Scrape Messages
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Messages */}
                            {!groupsState.messagesLoading && groupedMessages.map((item) => {
                                if (item.type === 'date') {
                                    return (
                                        <div key={item.key} className="flex justify-center my-4">
                                            <span className="px-3 py-1 text-[11px] font-medium text-foreground/70 bg-card/80 backdrop-blur-sm rounded-full shadow-sm border border-border/50">
                                                {formatDateSeparator(item.date)}
                                            </span>
                                        </div>
                                    );
                                }

                                const msg = item.data;
                                const senderName = msg.sender_name || (msg.sender_username ? `@${msg.sender_username}` : 'Unknown');
                                const senderColor = getAvatarColor(senderName);
                                const hasRisk = msg.risk_level && msg.risk_level !== 'none';
                                const isHighRisk = msg.risk_level === 'critical' || msg.risk_level === 'high';

                                return (
                                    <div key={item.key} className="flex gap-2.5 mb-3 max-w-[85%] sm:max-w-[70%] group/msg animate-in fade-in duration-200">
                                        {/* Sender Avatar */}
                                        <div className={`h-8 w-8 rounded-full ${senderColor} flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 mt-1 shadow-md`}>
                                            {senderName.charAt(0).toUpperCase()}
                                        </div>

                                        {/* Message Bubble */}
                                        <div className={`flex-1 min-w-0 rounded-2xl rounded-tl-md p-3 transition-shadow duration-200 ${hasRisk && isHighRisk
                                            ? 'shadow-sm'
                                            : 'shadow-sm hover:shadow-md'
                                            }`}
                                            style={hasRisk && isHighRisk
                                                ? { background: 'linear-gradient(135deg, rgba(239,68,68,0.06), rgba(254,226,226,0.8))', border: '1px solid rgba(239,68,68,0.15)', backdropFilter: 'blur(8px)' }
                                                : { background: 'linear-gradient(135deg, rgba(255,255,255,0.85), rgba(255,255,255,0.65))', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(0,0,0,0.04)', boxShadow: '0 1px 4px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,0.6)' }
                                            }>
                                            {/* Sender Name */}
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-bold" style={{ color: '#2AABEE' }}>
                                                    {senderName}
                                                </span>
                                                {hasRisk && (
                                                    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${isHighRisk ? 'bg-red-500/10 text-red-500' : 'bg-orange-500/10 text-orange-500'}`}>
                                                        <AlertTriangle className="h-2.5 w-2.5" />
                                                        {msg.risk_level}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Media */}
                                            {msg.media && msg.media.length > 0 && (
                                                <div className="space-y-2 mb-2">
                                                    {msg.media.map((m, mi) => (
                                                        <div key={mi} className="rounded-xl overflow-hidden">
                                                            {m.type === 'photo' ? (
                                                                <div className="relative group/media">
                                                                    <img
                                                                        src={`${BACKEND_URL}/api/telegram/media/${msg.group_id}/${msg.telegram_message_id}`}
                                                                        alt="Telegram Media"
                                                                        className="max-h-[300px] w-auto h-auto object-contain rounded-lg cursor-zoom-in"
                                                                        onError={(e) => {
                                                                            e.target.style.display = 'none';
                                                                            if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                                                                        }}
                                                                    />
                                                                    <div className="hidden flex-col items-center justify-center h-20 text-muted-foreground">
                                                                        <ImageIcon className="h-6 w-6 mb-1 opacity-30" />
                                                                        <p className="text-[10px]">Failed to load</p>
                                                                    </div>
                                                                    <a
                                                                        href={`${BACKEND_URL}/api/telegram/media/${msg.group_id}/${msg.telegram_message_id}`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity"
                                                                    >
                                                                        <ExternalLink className="h-3 w-3" />
                                                                    </a>
                                                                </div>
                                                            ) : m.type === 'video' ? (
                                                                <div className="relative bg-black rounded-lg overflow-hidden">
                                                                    <video controls className="max-h-[300px] w-full">
                                                                        <source src={`${BACKEND_URL}/api/telegram/media/${msg.group_id}/${msg.telegram_message_id}`} type={m.mimeType || 'video/mp4'} />
                                                                    </video>
                                                                    <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur rounded text-[9px] font-bold text-white uppercase">
                                                                        VIDEO {m.fileSize ? `• ${(m.fileSize / (1024 * 1024)).toFixed(1)}MB` : ''}
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                                                                    onClick={() => window.open(`${BACKEND_URL}/api/telegram/media/${msg.group_id}/${msg.telegram_message_id}`, '_blank')}>
                                                                    <div className="h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0"
                                                                        style={{ background: '#2AABEE' }}>
                                                                        {m.type === 'document' ? <FileText className="h-5 w-5 text-white" /> : <Hash className="h-5 w-5 text-white" />}
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <p className="text-xs font-medium truncate">{m.fileName || `Attachment_${mi + 1}`}</p>
                                                                        <p className="text-[10px] text-muted-foreground uppercase">
                                                                            {m.type} {m.fileSize ? `• ${(m.fileSize / 1024).toFixed(1)} KB` : ''}
                                                                        </p>
                                                                    </div>
                                                                    <Download className="h-4 w-4 text-muted-foreground" />
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Text */}
                                            {(msg.text || (!msg.media || msg.media.length === 0)) && (
                                                <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                                                    {msg.text ? highlightText(msg.text, searchState.query) : '[Empty Message]'}
                                                </p>
                                            )}

                                            {/* Links */}
                                            {msg.links && msg.links.length > 0 && (
                                                <div className="mt-2 space-y-1">
                                                    {msg.links.map((link, li) => (
                                                        <a
                                                            key={li}
                                                            href={link.startsWith('http') ? link : `https://${link}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex items-center gap-1.5 text-[11px] text-[#2AABEE] hover:underline"
                                                        >
                                                            <ExternalLink className="h-3 w-3 opacity-50" />
                                                            <span className="truncate">{link}</span>
                                                        </a>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Timestamp */}
                                            <div className="flex items-center justify-end gap-1 mt-1">
                                                <span className="text-[10px] text-muted-foreground">
                                                    {formatMsgTime(msg.date)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Bottom Info Bar — Frosted Glass */}
                        <div className="flex-shrink-0 h-11 flex items-center justify-center px-4"
                            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.7), rgba(248,250,252,0.6))', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1.5">
                                    <Shield className="h-3.5 w-3.5 text-[#2AABEE]" />
                                    Monitoring
                                </span>
                                <span className="w-px h-3 bg-border" />
                                <span className="flex items-center gap-1.5">
                                    <Clock className="h-3.5 w-3.5" />
                                    {activeGroup.last_scraped_at ? new Date(activeGroup.last_scraped_at).toLocaleString() : 'Never scraped'}
                                </span>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* ── Group Context Menu (Glassmorphic) ── */}
            {groupActionMenu && (
                <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setGroupActionMenu(null)} />
                    <div
                        className="fixed z-[70] w-56 rounded-2xl py-1.5 animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
                        style={{
                            top: Math.min(groupActionMenu.y, window.innerHeight - 220),
                            left: Math.min(groupActionMenu.x, window.innerWidth - 240),
                            background: 'linear-gradient(135deg, rgba(255,255,255,0.85), rgba(255,255,255,0.65))',
                            backdropFilter: 'blur(20px) saturate(180%)',
                            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.5)',
                            border: '1px solid rgba(255,255,255,0.3)',
                        }}
                    >
                        <div className="dark:hidden absolute inset-0 pointer-events-none" />
                        <style>{`.dark [data-glass-ctx] { background: linear-gradient(135deg, rgba(30,30,40,0.85), rgba(20,20,30,0.75)) !important; border-color: rgba(255,255,255,0.08) !important; box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06) !important; }`}</style>
                        <div data-glass-ctx="" className="contents">
                            <button
                                className="w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-200 active:scale-[0.98]"
                                onClick={() => { handleScrape(groupActionMenu.groupId); setGroupActionMenu(null); }}
                            >
                                <div className="h-7 w-7 rounded-lg bg-[#2AABEE]/10 flex items-center justify-center">
                                    <Download className="h-3.5 w-3.5 text-[#2AABEE]" />
                                </div>
                                <span className="font-medium">Scrape Messages</span>
                            </button>
                            <button
                                className="w-full px-4 py-2.5 text-sm text-left flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-200 active:scale-[0.98]"
                                onClick={() => {
                                    setConfirmDialog({ type: 'delete', groupId: groupActionMenu.groupId, groupTitle: groupActionMenu.groupTitle });
                                    setGroupActionMenu(null);
                                }}
                            >
                                <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-red-500/15 to-rose-500/10 flex items-center justify-center">
                                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                </div>
                                <span className="font-medium text-red-600 dark:text-red-400">Delete Group & Data</span>
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* ── Confirmation Dialog (Glassmorphic) ── */}
            {confirmDialog && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center animate-in fade-in duration-300"
                    style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.4), rgba(0,0,0,0.6))' }}
                    onClick={() => setConfirmDialog(null)}
                >
                    <div
                        className="max-w-sm w-full mx-4 p-7 rounded-3xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                        style={{
                            background: 'linear-gradient(145deg, rgba(255,255,255,0.88), rgba(255,255,255,0.72))',
                            backdropFilter: 'blur(24px) saturate(180%)',
                            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                            boxShadow: '0 24px 80px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.6)',
                            border: '1px solid rgba(255,255,255,0.35)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <style>{`.dark [data-glass-dialog] { background: linear-gradient(145deg, rgba(30,30,45,0.88), rgba(20,20,35,0.78)) !important; border-color: rgba(255,255,255,0.06) !important; box-shadow: 0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06) !important; }`}</style>
                        <div data-glass-dialog="" className="contents" />

                        {/* Icon */}
                        <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-5 transition-transform duration-300 hover:scale-105"
                            style={{
                                background: 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(248,113,113,0.08))',
                                backdropFilter: 'blur(8px)',
                                border: '1px solid rgba(239,68,68,0.15)',
                                boxShadow: '0 4px 20px rgba(239,68,68,0.1)',
                            }}
                        >
                            <Trash2 className="h-7 w-7 text-red-500" />
                        </div>

                        {/* Title */}
                        <h3 className="text-xl font-bold text-center mb-2 tracking-tight">Delete Group?</h3>

                        {/* Group Name */}
                        <div className="mx-auto mb-3 px-4 py-1.5 rounded-full w-fit"
                            style={{
                                background: 'linear-gradient(135deg, rgba(0,0,0,0.04), rgba(0,0,0,0.02))',
                                border: '1px solid rgba(0,0,0,0.06)',
                            }}>
                            <span className="text-sm font-semibold">{confirmDialog.groupTitle}</span>
                        </div>

                        {/* Description */}
                        <p className="text-xs text-muted-foreground text-center mb-7 leading-relaxed max-w-[280px] mx-auto">
                            This will leave the group on Telegram, remove it from your monitor list, and permanently delete all scraped messages. This action cannot be undone.
                        </p>

                        {/* Buttons */}
                        <div className="flex gap-3">
                            <button
                                className="flex-1 h-11 rounded-xl text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                                style={{
                                    background: 'linear-gradient(135deg, rgba(0,0,0,0.04), rgba(0,0,0,0.02))',
                                    backdropFilter: 'blur(8px)',
                                    border: '1px solid rgba(0,0,0,0.08)',
                                }}
                                onClick={() => setConfirmDialog(null)}
                            >
                                Cancel
                            </button>
                            <button
                                className="flex-1 h-11 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg"
                                style={{
                                    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                    boxShadow: '0 4px 14px rgba(239,68,68,0.3)',
                                }}
                                onClick={() => handleDeleteGroup(confirmDialog.groupId)}
                            >
                                Delete Forever
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Telegram;
