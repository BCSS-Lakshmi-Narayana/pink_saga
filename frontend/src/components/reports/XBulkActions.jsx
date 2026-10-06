import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/api';
import {
    RefreshCw, CheckSquare, Square, Repeat2,
    MessageSquare, Upload, X, AlertTriangle, CheckCircle2,
    Loader2, ExternalLink, Image, Video, User, Users, LogIn,
    Trash2, History, Play, BarChart2, Eye, Search, Pencil, Save
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const XLogo = ({ className }) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.26 5.632 5.904-5.632Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
);
import { Textarea } from '../ui/textarea';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';

// ── Helpers ────────────────────────────────────────────────────────────────────

const SENTIMENT_COLORS = {
    positive: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    neutral:  'bg-slate-50 text-slate-600 border-slate-200',
    negative: 'bg-rose-50 text-rose-700 border-rose-200'
};

const RISK_COLORS = {
    low:      'bg-emerald-50 text-emerald-700',
    medium:   'bg-amber-50 text-amber-700',
    high:     'bg-orange-50 text-orange-700',
    critical: 'bg-red-100 text-red-700'
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtNum  = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n || 0);

const SENTIMENT_PILLS = [
    { value: 'all',      label: 'All' },
    { value: 'negative', label: 'Negative' },
    { value: 'neutral',  label: 'Neutral' },
    { value: 'positive', label: 'Positive' }
];

const RISK_OPTIONS = [
    { value: 'all',      label: 'All Levels' },
    { value: 'critical', label: 'Critical' },
    { value: 'high',     label: 'High' },
    { value: 'medium',   label: 'Medium' },
    { value: 'low',      label: 'Low' }
];

// ── Account Card ───────────────────────────────────────────────────────────────

const AccountCard = ({ account, selected, onSelect, onRemove, allMode }) => (
    <div
        onClick={onSelect}
        className={cn(
            'flex items-center justify-between rounded-lg border px-3 py-2 shadow-sm transition-all',
            onSelect ? 'cursor-pointer' : '',
            allMode && account.status === 'active'
                ? 'border-violet-400 bg-violet-50'
                : selected
                ? 'border-sky-400 bg-sky-50'
                : 'border-slate-200 bg-white hover:border-slate-300'
        )}
    >
        <div className="flex items-center gap-2">
            {account.profile_image_url
                ? <img src={account.profile_image_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                : <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100"><User className="h-3.5 w-3.5 text-sky-600" /></div>
            }
            <div>
                <p className="text-xs font-semibold text-slate-800">{account.display_name}</p>
                <p className="text-[11px] text-slate-400">@{account.username}</p>
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold',
                account.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>
                {account.status}
            </span>
            <button onClick={(e) => { e.stopPropagation(); onRemove(account.username); }}
                className="text-slate-400 hover:text-rose-500 transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
            </button>
        </div>
    </div>
);

// ── Post Row ───────────────────────────────────────────────────────────────────

const PostRow = ({ post, selected, onToggle, isAdmin, onEdit, onDelete }) => {
    const handle = post.author_handle || post.raw_data?.handle || post.raw_data?.username || post.author || '—';
    return (
        <div
            className={cn(
                'flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 transition-all',
                selected ? 'border-sky-300 bg-sky-50/60' : 'border-slate-200 bg-white hover:border-slate-300'
            )}
            onClick={onToggle}
        >
            <div className="mt-0.5 shrink-0">
                {selected
                    ? <CheckSquare className="h-4 w-4 text-sky-600" />
                    : <Square className="h-4 w-4 text-slate-400" />
                }
            </div>
            <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-700">@{handle}</span>
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium',
                        SENTIMENT_COLORS[post.sentiment] || SENTIMENT_COLORS.neutral)}>
                        {post.sentiment}
                    </span>
                    {post.risk_level && post.risk_level !== 'low' && (
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', RISK_COLORS[post.risk_level])}>
                            {post.risk_level?.toUpperCase()}
                        </span>
                    )}
                    <span className="ml-auto text-[10px] text-slate-400">{fmtDate(post.published_at)}</span>
                    {isAdmin && (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <button
                                onClick={() => onEdit(post)}
                                className="rounded p-0.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                                title="Edit post"
                            >
                                <Pencil className="h-3 w-3" />
                            </button>
                            <button
                                onClick={() => onDelete(post.content_id)}
                                className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                title="Delete post"
                            >
                                <Trash2 className="h-3 w-3" />
                            </button>
                        </div>
                    )}
                </div>
                <p className="line-clamp-2 text-xs text-slate-600">{post.text}</p>
                <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-400">
                    <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{fmtNum(post.engagement?.views)}</span>
                    <span className="flex items-center gap-1"><Repeat2 className="h-3 w-3" />{fmtNum(post.engagement?.retweets)}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{fmtNum(post.engagement?.comments)}</span>
                    <a href={post.content_url} target="_blank" rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-auto flex items-center gap-0.5 text-sky-500 hover:underline">
                        <ExternalLink className="h-3 w-3" /> View
                    </a>
                </div>
            </div>
        </div>
    );
};

// ── History Row ────────────────────────────────────────────────────────────────

const HistoryRow = ({ action }) => (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
        <div className={cn('mt-0.5 rounded-full p-1',
            action.status === 'success' ? 'bg-emerald-100 text-emerald-600'
            : action.status === 'failed' ? 'bg-rose-100 text-rose-600'
            : 'bg-slate-100 text-slate-500')}>
            {action.status === 'success'
                ? <CheckCircle2 className="h-3 w-3" />
                : action.status === 'failed'
                ? <X className="h-3 w-3" />
                : <Loader2 className="h-3 w-3" />}
        </div>
        <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700">@{action.account_username}</span>
                <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">{action.action_type}</span>
                <span className="text-slate-400">{fmtDate(action.executed_at || action.created_at)}</span>
            </div>
            {action.tweet_text && <p className="mt-0.5 line-clamp-1 text-slate-500">{action.tweet_text}</p>}
            {action.reply_text && <p className="mt-0.5 text-slate-600 italic">"{action.reply_text}"</p>}
            {action.error_message && <p className="mt-0.5 text-rose-500">{action.error_message}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
            {action.created_tweet_url && (
                <a href={action.created_tweet_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-600 hover:underline">
                    <ExternalLink className="h-3 w-3" /> My post
                </a>
            )}
            <a href={action.tweet_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-0.5 text-[10px] text-sky-400 hover:text-sky-600">
                <ExternalLink className="h-3 w-3" /> Original
            </a>
        </div>
    </div>
);

// ── Main Component ─────────────────────────────────────────────────────────────

const XBulkActions = () => {
    const { user } = useAuth();
    const isAdmin = user?.email === 'sreenu@gmail.com';

    // Edit modal state
    const [editingPost, setEditingPost] = useState(null);
    const [editForm, setEditForm]       = useState({ text: '', sentiment: 'neutral', risk_level: 'low' });
    const [editSaving, setEditSaving]   = useState(false);

    // Accounts
    const [accounts, setAccounts]               = useState([]);
    const [accountsLoading, setAccountsLoading] = useState(false);
    const [connectingOAuth, setConnectingOAuth] = useState(false);
    const [selectedAccount, setSelectedAccount] = useState('');
    const [useAllAccounts, setUseAllAccounts]   = useState(false);
    // PIN flow state
    const [pinStep, setPinStep]             = useState(false);
    const [pinOauthToken, setPinOauthToken] = useState('');
    const [pinValue, setPinValue]           = useState('');
    const [pinLoading, setPinLoading]       = useState(false);
    // Cookie login state (replaces broken password login)
    const [directMode, setDirectMode]           = useState(false);
    const [directToken, setDirectToken]         = useState('');       // username
    const [directTokenSecret, setDirectTokenSecret] = useState('');   // cookie file text
    const [directLoading, setDirectLoading]     = useState(false);

    // Filters — all visible at once, no collapse
    const [source, setSource]       = useState('all');       // all | alerts | grievances
    const [search, setSearch]       = useState('');          // searches handle + keyword in one box
    const [sentiment, setSentiment] = useState('all');
    const [riskLevel, setRiskLevel] = useState('all');
    const [dateFrom, setDateFrom]   = useState('');
    const [dateTo, setDateTo]       = useState('');

    // Posts
    const [posts, setPosts]           = useState([]);
    const [postsLoading, setPostsLoading] = useState(false);
    const [totalPosts, setTotalPosts] = useState(0);
    const [page, setPage]             = useState(1);
    const LIMIT = 30;

    // Selection
    const [selectedIds, setSelectedIds] = useState(new Set());

    // Action composer
    const [actionType, setActionType] = useState('reply');
    const [replyText, setReplyText]   = useState('');
    const [mediaFiles, setMediaFiles] = useState([]);
    const mediaInputRef               = useRef(null);

    // Execution
    const [executing, setExecuting]       = useState(false);
    const [execResult, setExecResult]     = useState(null);
    const [execProgress, setExecProgress] = useState('');   // live status text
    const [execEta, setExecEta]           = useState(0);    // countdown seconds

    // History
    const [historyOpen, setHistoryOpen]     = useState(false);
    const [history, setHistory]             = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    const hasActiveFilters = source !== 'all' || search !== '' || sentiment !== 'all' || riskLevel !== 'all' || dateFrom !== '' || dateTo !== '';

    // ── Accounts ──────────────────────────────────────────────────────────────

    const fetchAccounts = useCallback(async () => {
        setAccountsLoading(true);
        try {
            const { data } = await api.get('/x/actions/accounts');
            setAccounts(data.accounts || []);
            if (data.accounts?.length > 0 && !selectedAccount) {
                setSelectedAccount(data.accounts[0].username);
            }
        } catch {
            toast.error('Failed to load connected accounts');
        } finally {
            setAccountsLoading(false);
        }
    }, [selectedAccount]);

    useEffect(() => { fetchAccounts(); }, []);

    // Step 1: open X auth page in new tab, show PIN input box
    const handleConnectAccount = async () => {
        setConnectingOAuth(true);
        try {
            const { data } = await api.get('/x/actions/oauth/connect-pin');
            setPinOauthToken(data.oauthToken);
            window.open(data.oauthUrl, '_blank', 'width=620,height=700,scrollbars=yes');
            setPinStep(true);   // show PIN input
        } catch (err) {
            toast.error(err.response?.data?.error || err.message);
        } finally {
            setConnectingOAuth(false);
        }
    };

    // Step 2: user pastes the PIN shown on X, we exchange it for tokens
    const handleVerifyPin = async () => {
        if (!pinValue.trim()) { toast.error('Enter the PIN shown on X'); return; }
        setPinLoading(true);
        try {
            const { data } = await api.post('/x/actions/oauth/verify-pin', {
                oauthToken: pinOauthToken,
                pin: pinValue.trim()
            });
            toast.success(`@${data.account.username} connected successfully!`);
            setPinStep(false);
            setPinValue('');
            setPinOauthToken('');
            fetchAccounts();
        } catch (err) {
            toast.error(err.response?.data?.error || 'Invalid PIN — please try again');
        } finally {
            setPinLoading(false);
        }
    };

    const handleAddDirect = async () => {
        if (!directToken.trim() || !directTokenSecret.trim()) {
            toast.error('Enter username and paste the cookie file content');
            return;
        }
        setDirectLoading(true);
        try {
            const { data } = await api.post('/x/actions/accounts/add-cookies', {
                username: directToken.trim(),
                cookieText: directTokenSecret.trim()
            });
            toast.success(`@${data.account.username} connected via browser cookies!`);
            setDirectMode(false);
            setDirectToken('');
            setDirectTokenSecret('');
            fetchAccounts();
        } catch (err) {
            toast.error(err.response?.data?.error || 'Cookie login failed — check values and try again');
        } finally {
            setDirectLoading(false);
        }
    };

    const handleRemoveAccount = async (username) => {
        try {
            await api.delete(`/x/actions/accounts/${username}`);
            toast.success(`@${username} disconnected`);
            fetchAccounts();
            if (selectedAccount === username) setSelectedAccount('');
        } catch {
            toast.error('Failed to remove account');
        }
    };

    // ── Posts ─────────────────────────────────────────────────────────────────

    const fetchPosts = useCallback(async (resetPage = false) => {
        setPostsLoading(true);
        const currentPage = resetPage ? 1 : page;
        if (resetPage) setPage(1);
        try {
            const params = { limit: LIMIT, page: currentPage };
            if (source !== 'all')   params.source   = source;
            if (sentiment !== 'all') params.sentiment = sentiment;
            if (riskLevel !== 'all') params.riskLevel = riskLevel;
            if (dateFrom) params.dateFrom = dateFrom;
            if (dateTo)   params.dateTo   = dateTo;
            // search queries both handle and keyword — backend picks it up via both fields
            if (search) {
                params.keyword = search;
                params.handle  = search;
            }
            const { data } = await api.get('/x/actions/posts', { params });
            setPosts(data.posts || []);
            setTotalPosts(data.total || 0);
            setSelectedIds(new Set());
        } catch {
            toast.error('Failed to load posts');
        } finally {
            setPostsLoading(false);
        }
    }, [source, search, sentiment, riskLevel, dateFrom, dateTo, page]);

    const handleClearFilters = () => {
        setSource('all');
        setSearch('');
        setSentiment('all');
        setRiskLevel('all');
        setDateFrom('');
        setDateTo('');
    };

    // ── History ───────────────────────────────────────────────────────────────

    const fetchHistory = async () => {
        setHistoryLoading(true);
        try {
            const { data } = await api.get('/x/actions/history', { params: { limit: 50 } });
            setHistory(data.actions || []);
        } catch {
            toast.error('Failed to load history');
        } finally {
            setHistoryLoading(false);
        }
    };

    useEffect(() => { if (historyOpen) fetchHistory(); }, [historyOpen]);

    // ── Selection ─────────────────────────────────────────────────────────────

    const togglePost = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selectedIds.size === posts.length) setSelectedIds(new Set());
        else setSelectedIds(new Set(posts.map(p => p.content_id)));
    };

    // ── Admin post actions ────────────────────────────────────────────────────

    const handleDeletePost = async (contentId) => {
        if (!window.confirm('Delete this post? This will also delete any linked alerts and grievances.')) return;
        try {
            await api.delete(`/x/actions/posts/${contentId}`);
            setPosts(prev => prev.filter(p => p.content_id !== contentId));
            setSelectedIds(prev => { const next = new Set(prev); next.delete(contentId); return next; });
            setTotalPosts(prev => prev - 1);
            toast.success('Post deleted');
        } catch (err) {
            toast.error(err.response?.data?.error || 'Delete failed');
        }
    };

    const handleOpenEdit = (post) => {
        setEditingPost(post);
        setEditForm({ text: post.text, sentiment: post.sentiment || 'neutral', risk_level: post.risk_level || 'low' });
    };

    const handleSaveEdit = async () => {
        if (!editingPost) return;
        setEditSaving(true);
        try {
            const { data } = await api.patch(`/x/actions/posts/${editingPost.content_id}`, editForm);
            setPosts(prev => prev.map(p =>
                p.content_id === editingPost.content_id
                    ? { ...p, text: data.post.text, sentiment: data.post.sentiment, risk_level: data.post.risk_level }
                    : p
            ));
            toast.success('Post updated');
            setEditingPost(null);
        } catch (err) {
            toast.error(err.response?.data?.error || 'Update failed');
        } finally {
            setEditSaving(false);
        }
    };

    // ── Media ─────────────────────────────────────────────────────────────────

    const handleMediaChange = (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length + mediaFiles.length > 4) { toast.warning('Maximum 4 media files allowed'); return; }
        setMediaFiles(prev => [...prev, ...files]);
    };

    // ── Execute ───────────────────────────────────────────────────────────────

    const handleExecute = async () => {
        const activeAccounts = accounts.filter(a => a.status === 'active');
        if (!useAllAccounts && !selectedAccount)    { toast.error('Select an X account first');       return; }
        if (useAllAccounts && activeAccounts.length === 0) { toast.error('No active accounts connected'); return; }
        if (selectedIds.size === 0)                 { toast.error('Select at least one post');         return; }
        if (actionType === 'reply' && !replyText.trim()) { toast.error('Enter reply text');            return; }

        setExecuting(true);
        setExecResult(null);

        const selectedPosts  = posts.filter(p => selectedIds.has(p.content_id));
        const count          = selectedPosts.length;
        const accountCount   = useAllAccounts ? activeAccounts.length : 1;
        const estSecPerAcct  = count === 1 ? 5 : Math.round((count - 1) * 42 + count * 2);
        // Extra human delay between accounts (42s avg) added for each additional account
        const estSec         = estSecPerAcct * accountCount + (accountCount > 1 ? (accountCount - 1) * 42 : 0);

        setExecEta(estSec);
        setExecProgress(
            `Starting — ${count} post${count > 1 ? 's' : ''} × ${accountCount} account${accountCount > 1 ? 's' : ''}, est. ~${Math.ceil(estSec / 60)} min`
        );

        // Countdown ticker
        let remaining = estSec;
        const ticker = setInterval(() => {
            remaining -= 1;
            if (remaining > 0) {
                const m = Math.floor(remaining / 60), s = remaining % 60;
                setExecProgress(`Processing… ~${m > 0 ? `${m}m ` : ''}${s}s remaining`);
                setExecEta(remaining);
            }
        }, 1000);

        try {
            const tweetIds   = selectedPosts.map(p => p.content_id);
            const tweetUrls  = Object.fromEntries(selectedPosts.map(p => [p.content_id, p.content_url]));
            const tweetTexts = Object.fromEntries(selectedPosts.map(p => [p.content_id, p.text]));

            const formData = new FormData();
            if (useAllAccounts) {
                formData.append('accountUsernames', JSON.stringify(activeAccounts.map(a => a.username)));
            } else {
                formData.append('accountUsername', selectedAccount);
            }
            formData.append('actionType', actionType);
            formData.append('tweetIds', JSON.stringify(tweetIds));
            formData.append('tweetUrls', JSON.stringify(tweetUrls));
            formData.append('tweetTexts', JSON.stringify(tweetTexts));
            if (actionType === 'reply') formData.append('replyText', replyText);
            mediaFiles.forEach(f => formData.append('media', f));

            const { data } = await api.post('/x/actions/bulk', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: (estSec + 120) * 1000
            });

            setExecResult(data);
            setExecProgress('');
            if (data.failed === 0) toast.success(`All ${data.total} actions completed!`);
            else toast.warning(`${data.success} succeeded, ${data.failed} failed`);
            setSelectedIds(new Set());
        } catch (err) {
            setExecProgress('');
            toast.error(err.response?.data?.error || 'Bulk action failed');
        } finally {
            clearInterval(ticker);
            setExecuting(false);
            setExecEta(0);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    const allSelected = posts.length > 0 && selectedIds.size === posts.length;
    const totalPages  = Math.ceil(totalPosts / LIMIT);

    return (
        <>
        <div className="flex flex-col gap-0 p-5">

            {/* ── Header ── */}
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
                        <XLogo className="h-5 w-5 text-sky-500" />
                        X Bulk Actions
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-600">Beta</span>
                    </h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                        Filter posts, select them, then reply or retweet in bulk from a connected X account
                    </p>
                </div>
                <button
                    onClick={() => setHistoryOpen(v => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors"
                >
                    <History className="h-3.5 w-3.5" />
                    {historyOpen ? 'Hide' : 'Show'} History
                </button>
            </div>

            {/* ── History panel ── */}
            {historyOpen && (
                <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">Recent Actions</span>
                        <button onClick={fetchHistory}
                            className="text-slate-400 hover:text-slate-600 transition-colors">
                            <RefreshCw className={cn('h-3.5 w-3.5', historyLoading && 'animate-spin')} />
                        </button>
                    </div>
                    <div className="max-h-48 space-y-1.5 overflow-y-auto">
                        {historyLoading
                            ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
                            : history.length === 0
                            ? <p className="py-4 text-center text-xs text-slate-400">No actions yet</p>
                            : history.map(a => <HistoryRow key={a._id} action={a} />)
                        }
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">

                {/* ══════════════ LEFT PANEL ══════════════ */}
                <div className="flex flex-col gap-4">

                    {/* Connected Accounts */}
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                                <User className="h-3.5 w-3.5" /> X Accounts
                            </span>
                            <div className="flex gap-1.5">
                                <button
                                    onClick={() => { setDirectMode(v => !v); setPinStep(false); }}
                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                                    title="Add account via browser cookies (auth_token + ct0)"
                                >
                                    + Cookie Login
                                </button>
                                <button
                                    onClick={() => { handleConnectAccount(); setDirectMode(false); }}
                                    disabled={connectingOAuth}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] font-semibold text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-60"
                                >
                                    {connectingOAuth ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
                                    PIN Login
                                </button>
                            </div>
                        </div>

                        {/* Direct Token form */}
                        {directMode && (
                            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                                <p className="text-[11px] font-semibold text-amber-800">
                                    Paste the full content of your x.com cookie file (Netscape format)
                                </p>
                                <input
                                    type="text"
                                    placeholder="X Username (without @)"
                                    value={directToken}
                                    onChange={e => setDirectToken(e.target.value)}
                                    className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none"
                                />
                                <textarea
                                    placeholder={'Paste cookie file content here...\n# Netscape HTTP Cookie File\n.x.com TRUE / TRUE 1234567890 auth_token abc123...'}
                                    value={directTokenSecret}
                                    onChange={e => setDirectTokenSecret(e.target.value)}
                                    rows={5}
                                    className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-mono text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none resize-none"
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleAddDirect}
                                        disabled={directLoading || !directToken.trim() || !directTokenSecret.trim()}
                                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                                    >
                                        {directLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                        {directLoading ? 'Adding…' : 'Add Account'}
                                    </button>
                                    <button
                                        onClick={() => { setDirectMode(false); setDirectToken(''); setDirectTokenSecret(''); }}
                                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* PIN entry step — shown after X opens in new tab */}
                        {pinStep && (
                            <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
                                <p className="mb-1.5 text-xs font-semibold text-sky-800">
                                    X opened in a new tab — authorize the app, then copy the PIN shown and paste it below.
                                </p>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        placeholder="Paste PIN from X…"
                                        value={pinValue}
                                        onChange={e => setPinValue(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleVerifyPin()}
                                        className="flex-1 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                                    />
                                    <button
                                        onClick={handleVerifyPin}
                                        disabled={pinLoading || !pinValue.trim()}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
                                    >
                                        {pinLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                        {pinLoading ? 'Verifying…' : 'Verify'}
                                    </button>
                                    <button
                                        onClick={() => { setPinStep(false); setPinValue(''); setPinOauthToken(''); }}
                                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {accountsLoading ? (
                            <div className="flex justify-center py-3">
                                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                            </div>
                        ) : accounts.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-300 py-5 text-center">
                                <XLogo className="mx-auto mb-1.5 h-6 w-6 text-slate-300" />
                                <p className="text-xs text-slate-400">No accounts connected yet.</p>
                                <p className="text-[11px] text-slate-400">Click "Connect Account" to login via X.</p>
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {accounts.map(acc => (
                                    <AccountCard
                                        key={acc.username}
                                        account={acc}
                                        selected={selectedAccount === acc.username}
                                        onSelect={useAllAccounts ? undefined : () => setSelectedAccount(acc.username)}
                                        onRemove={handleRemoveAccount}
                                        allMode={useAllAccounts}
                                    />
                                ))}
                            </div>
                        )}

                        {accounts.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                                <button
                                    onClick={() => setUseAllAccounts(v => !v)}
                                    className={cn(
                                        'flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[11px] font-semibold transition-all',
                                        useAllAccounts
                                            ? 'border-violet-400 bg-violet-50 text-violet-700'
                                            : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:text-slate-700'
                                    )}
                                >
                                    <Users className="h-3 w-3" />
                                    {useAllAccounts
                                        ? `All ${accounts.filter(a => a.status === 'active').length} active accounts selected`
                                        : 'Use all active accounts'}
                                </button>
                                {(selectedAccount || useAllAccounts) && (
                                    <p className={cn('rounded-lg px-2 py-1 text-center text-[11px] font-medium',
                                        useAllAccounts ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700')}>
                                        {useAllAccounts
                                            ? <><strong>{accounts.filter(a => a.status === 'active').length} accounts</strong> will act simultaneously</>
                                            : <>Acting as <strong>@{selectedAccount}</strong></>
                                        }
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Action Composer */}
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <p className="mb-3 text-xs font-semibold text-slate-700">Action Composer</p>

                        {/* Action type toggle */}
                        <div className="mb-3 flex gap-2">
                            <button
                                onClick={() => setActionType('reply')}
                                className={cn(
                                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold transition-all',
                                    actionType === 'reply'
                                        ? 'border-sky-400 bg-sky-50 text-sky-700'
                                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                                )}
                            >
                                <MessageSquare className="h-3.5 w-3.5" /> Reply / Comment
                            </button>
                            <button
                                onClick={() => setActionType('retweet')}
                                className={cn(
                                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold transition-all',
                                    actionType === 'retweet'
                                        ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                                )}
                            >
                                <Repeat2 className="h-3.5 w-3.5" /> Retweet
                            </button>
                        </div>

                        {actionType === 'reply' && (
                            <>
                                <Textarea
                                    className="mb-2 min-h-[90px] resize-none text-xs"
                                    placeholder="Type your reply / comment here… (posted to all selected posts)"
                                    value={replyText}
                                    onChange={e => setReplyText(e.target.value)}
                                    maxLength={280}
                                />
                                <div className="mb-2 text-right text-[10px] text-slate-400">{replyText.length}/280</div>

                                {/* Media upload */}
                                <input
                                    ref={mediaInputRef}
                                    type="file"
                                    accept="image/*,video/*"
                                    multiple
                                    className="hidden"
                                    onChange={handleMediaChange}
                                />
                                <button
                                    onClick={() => mediaInputRef.current?.click()}
                                    className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-2 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors"
                                >
                                    <Upload className="h-3.5 w-3.5" />
                                    Attach image / video (optional, max 4)
                                </button>
                                {mediaFiles.length > 0 && (
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                        {mediaFiles.map((file, idx) => (
                                            <div key={idx}
                                                className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                                                {file.type.startsWith('video')
                                                    ? <Video className="h-3 w-3 text-slate-400" />
                                                    : <Image className="h-3 w-3 text-slate-400" />
                                                }
                                                <span className="max-w-[80px] truncate">{file.name}</span>
                                                <button onClick={() => setMediaFiles(prev => prev.filter((_, i) => i !== idx))}
                                                    className="ml-1 text-slate-400 hover:text-rose-500">
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}

                        {actionType === 'retweet' && (
                            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                                <Repeat2 className="mb-1 h-4 w-4" />
                                All selected posts will be retweeted from <strong>
                                    {useAllAccounts
                                        ? `all ${accounts.filter(a => a.status === 'active').length} active accounts`
                                        : `@${selectedAccount || '—'}`}
                                </strong>. No text needed.
                            </div>
                        )}

                        {/* ETA preview before executing */}
                        {!executing && selectedIds.size > 0 && (selectedAccount || useAllAccounts) && (
                            <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
                                {(() => {
                                    const cnt = selectedIds.size;
                                    const acctCnt = useAllAccounts ? accounts.filter(a => a.status === 'active').length : 1;
                                    const perAcct = cnt === 1 ? 5 : Math.round((cnt - 1) * 42 + cnt * 2);
                                    const total = perAcct * acctCnt + (acctCnt > 1 ? (acctCnt - 1) * 42 : 0);
                                    return `⏱ Est. ~${Math.ceil(total / 60)} min — human-paced delays (28–58s) to avoid spam detection`;
                                })()}
                            </div>
                        )}

                        {/* Execute */}
                        <button
                            onClick={handleExecute}
                            disabled={executing || selectedIds.size === 0 || (!selectedAccount && !useAllAccounts)}
                            className={cn(
                                'flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold text-white transition-all',
                                executing || selectedIds.size === 0 || (!selectedAccount && !useAllAccounts)
                                    ? 'cursor-not-allowed bg-slate-300'
                                    : useAllAccounts
                                    ? 'bg-violet-600 hover:bg-violet-700 shadow-sm'
                                    : 'bg-sky-600 hover:bg-sky-700 shadow-sm'
                            )}
                        >
                            {executing
                                ? <><Loader2 className="h-4 w-4 animate-spin" /> {execProgress || 'Starting…'}</>
                                : <><Play className="h-4 w-4" /> Execute on {selectedIds.size} post{selectedIds.size !== 1 ? 's' : ''}
                                    {useAllAccounts && ` × ${accounts.filter(a => a.status === 'active').length} accounts`}
                                  </>
                            }
                        </button>
                        {executing && (
                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                                <div className="h-full animate-pulse rounded-full bg-sky-400" style={{ width: '100%' }} />
                            </div>
                        )}
                        {!selectedAccount && !useAllAccounts && (
                            <p className="mt-1.5 text-center text-[11px] text-amber-600">
                                Select an account above or enable "Use all active accounts"
                            </p>
                        )}
                    </div>

                    {/* Execution Result */}
                    {execResult && (
                        <div className={cn('rounded-xl border p-3 text-xs',
                            execResult.failed === 0
                                ? 'border-emerald-200 bg-emerald-50'
                                : 'border-amber-200 bg-amber-50')}>
                            <p className="mb-1.5 font-semibold text-slate-700 flex items-center gap-1.5">
                                {execResult.failed === 0
                                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                    : <AlertTriangle className="h-4 w-4 text-amber-600" />
                                }
                                Batch {execResult.batchId?.slice(0, 8)}…
                            </p>
                            <div className="flex gap-4 mb-1">
                                <span className="text-emerald-700">✓ {execResult.success} succeeded</span>
                                {execResult.failed > 0 && <span className="text-rose-600">✗ {execResult.failed} failed</span>}
                            </div>
                            {/* Per-account breakdown for multi-account runs */}
                            {execResult.perAccount?.map((pa, i) => (
                                <div key={i} className="mt-1 flex items-center gap-2 text-[10px] text-slate-600 border-t border-slate-200 pt-1">
                                    <span className="font-semibold">@{pa.accountUsername}:</span>
                                    <span className="text-emerald-700">✓ {pa.success}</span>
                                    {pa.failed > 0 && <span className="text-rose-600">✗ {pa.failed}</span>}
                                    {pa.error && <span className="text-rose-600 font-mono truncate max-w-[160px]" title={pa.error}>{pa.error}</span>}
                                </div>
                            ))}
                            {/* Errors from single-account runs */}
                            {!execResult.perAccount && execResult.results?.filter(r => r.error).map((r, i) => (
                                <p key={i} className="mt-1 text-[10px] text-rose-700 font-mono break-all">
                                    {r.tweetId}: {r.error}
                                </p>
                            ))}
                        </div>
                    )}
                </div>

                {/* ══════════════ RIGHT PANEL — Posts ══════════════ */}
                <div className="flex flex-col gap-3">

                    {/* ── Filter bar — always visible, same style as alerts reports ── */}
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">

                        {/* Row 0: source filter — Alerts / Grievances / All */}
                        <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-3">
                            <span className="shrink-0 text-[11px] font-semibold text-slate-500">Source:</span>
                            {[
                                { value: 'all',        label: 'All Posts',   color: 'sky' },
                                { value: 'alerts',     label: 'Alerts',      color: 'rose' },
                                { value: 'grievances', label: 'Grievances',  color: 'amber' }
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => { setSource(opt.value); fetchPosts(true); }}
                                    className={cn(
                                        'rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                                        source === opt.value
                                            ? opt.value === 'alerts'
                                                ? 'border-rose-400 bg-rose-500 text-white shadow-sm'
                                                : opt.value === 'grievances'
                                                ? 'border-amber-400 bg-amber-500 text-white shadow-sm'
                                                : 'border-sky-400 bg-sky-600 text-white shadow-sm'
                                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                                    )}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        {/* Row 1: search + risk + date + clear */}
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            {/* Combined handle / keyword search */}
                            <div className="relative min-w-[200px] flex-1">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search by @handle or keyword…"
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && fetchPosts(true)}
                                    className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-700 placeholder:text-slate-400 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
                                />
                            </div>

                            {/* Risk level */}
                            <select
                                value={riskLevel}
                                onChange={e => setRiskLevel(e.target.value)}
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-sky-300 focus:outline-none"
                            >
                                {RISK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>

                            {/* Date from */}
                            <input
                                type="date"
                                value={dateFrom}
                                onChange={e => setDateFrom(e.target.value)}
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-sky-300 focus:outline-none"
                            />
                            <span className="text-[11px] text-slate-400">to</span>
                            <input
                                type="date"
                                value={dateTo}
                                onChange={e => setDateTo(e.target.value)}
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-sky-300 focus:outline-none"
                            />

                            {/* Clear when any filter active */}
                            {hasActiveFilters && (
                                <button
                                    type="button"
                                    onClick={() => { handleClearFilters(); fetchPosts(true); }}
                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 transition-colors"
                                >
                                    <RefreshCw className="h-3 w-3" /> Clear
                                </button>
                            )}

                            {/* Apply + count */}
                            <div className="ml-auto flex items-center gap-2">
                                <span className="text-[11px] font-medium text-slate-400">
                                    {totalPosts} post{totalPosts !== 1 ? 's' : ''}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => fetchPosts(true)}
                                    disabled={postsLoading}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition-colors disabled:opacity-50"
                                >
                                    {postsLoading
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <Search className="h-3.5 w-3.5" />
                                    }
                                    Apply
                                </button>
                            </div>
                        </div>

                        {/* Row 2: sentiment pills (like Alerts Reports: All / Negative / Neutral / Positive) */}
                        <div className="flex items-center gap-1.5 overflow-x-auto">
                            {SENTIMENT_PILLS.map(pill => (
                                <button
                                    key={pill.value}
                                    type="button"
                                    onClick={() => setSentiment(pill.value)}
                                    className={cn(
                                        'whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-all',
                                        sentiment === pill.value
                                            ? 'bg-sky-600 text-white shadow-sm'
                                            : 'border border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700'
                                    )}
                                >
                                    {pill.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Select-all bar */}
                    <div className="flex items-center gap-2">
                        <button onClick={toggleAll}
                            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors">
                            {allSelected
                                ? <CheckSquare className="h-4 w-4 text-sky-600" />
                                : <Square className="h-4 w-4 text-slate-400" />
                            }
                            {allSelected ? 'Deselect all' : 'Select all'}
                        </button>
                        <div className="flex items-center gap-1.5 ml-auto text-[11px]">
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-500">
                                Total: <strong>{totalPosts}</strong>
                            </span>
                            <span className={cn(
                                'rounded-full border px-2 py-0.5 font-semibold transition-colors',
                                selectedIds.size > 0
                                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                                    : 'border-slate-200 bg-slate-50 text-slate-400'
                            )}>
                                Selected: <strong>{selectedIds.size}</strong>
                            </span>
                        </div>
                        <button onClick={() => fetchPosts()}
                            className="text-slate-400 hover:text-slate-600 transition-colors">
                            <RefreshCw className={cn('h-3.5 w-3.5', postsLoading && 'animate-spin')} />
                        </button>
                    </div>

                    {/* Posts list */}
                    {postsLoading ? (
                        <div className="flex flex-col gap-2">
                            {[1,2,3,4,5].map(i => (
                                <div key={i} className="h-20 w-full animate-pulse rounded-lg bg-slate-100" />
                            ))}
                        </div>
                    ) : posts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 py-16 text-center">
                            <BarChart2 className="mb-2 h-8 w-8 text-slate-300" />
                            <p className="text-sm text-slate-500">No posts found</p>
                            <p className="text-xs text-slate-400">Enter a search or adjust filters, then click Apply</p>
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-col gap-2">
                                {posts.map(post => (
                                    <PostRow
                                        key={post.content_id}
                                        post={post}
                                        selected={selectedIds.has(post.content_id)}
                                        onToggle={() => togglePost(post.content_id)}
                                        isAdmin={isAdmin}
                                        onEdit={handleOpenEdit}
                                        onDelete={handleDeletePost}
                                    />
                                ))}
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-center gap-2 pt-2">
                                    <button
                                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                                        disabled={page === 1}
                                        onClick={() => { setPage(p => p - 1); fetchPosts(); }}
                                    >
                                        Previous
                                    </button>
                                    <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
                                    <button
                                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                                        disabled={page === totalPages}
                                        onClick={() => { setPage(p => p + 1); fetchPosts(); }}
                                    >
                                        Next
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>

        {/* ── Edit Post Modal (admin only) ── */}
        {editingPost && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                        <span className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                            <Pencil className="h-4 w-4 text-amber-500" /> Edit Post
                        </span>
                        <button onClick={() => setEditingPost(null)}
                            className="text-slate-400 hover:text-slate-600 transition-colors">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="p-4 space-y-3">
                        <div>
                            <label className="mb-1 block text-[11px] font-semibold text-slate-600">Text</label>
                            <textarea
                                rows={5}
                                value={editForm.text}
                                onChange={e => setEditForm(f => ({ ...f, text: e.target.value }))}
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-sky-300 focus:outline-none resize-none"
                            />
                        </div>
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label className="mb-1 block text-[11px] font-semibold text-slate-600">Sentiment</label>
                                <select
                                    value={editForm.sentiment}
                                    onChange={e => setEditForm(f => ({ ...f, sentiment: e.target.value }))}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-sky-300 focus:outline-none"
                                >
                                    <option value="positive">Positive</option>
                                    <option value="neutral">Neutral</option>
                                    <option value="negative">Negative</option>
                                </select>
                            </div>
                            <div className="flex-1">
                                <label className="mb-1 block text-[11px] font-semibold text-slate-600">Risk Level</label>
                                <select
                                    value={editForm.risk_level}
                                    onChange={e => setEditForm(f => ({ ...f, risk_level: e.target.value }))}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-sky-300 focus:outline-none"
                                >
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                    <option value="critical">Critical</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
                        <button
                            onClick={() => setEditingPost(null)}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSaveEdit}
                            disabled={editSaving}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                        >
                            {editSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            {editSaving ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>
        )}
    </>
    );
};

export default XBulkActions;
