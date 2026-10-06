import React, { useState, useEffect, lazy, Suspense, useRef, useMemo, useCallback } from 'react';
// ...existing imports...
import ReactPlayer from 'react-player';
import { Link, useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import {
  Shield, AlertTriangle, Send,
  Users, ChevronDown, Loader2, Info, Clock, FileText, MessageSquare,
  ArrowRight, RefreshCw, Sparkles, X, Video, Pencil, Play, ExternalLink, Settings,
  BarChart3, Tag, Crown, TrendingUp, TrendingDown, Search
} from 'lucide-react';
import api from '../lib/api';
import { Card } from '../components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '../components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { useDashboard } from '../contexts/DashboardContext';

// Lazy load heavy components
const ManagedRibbonWidget = lazy(() => import('../components/dashboard/ManagedRibbonWidget'));

import StateMap from './StateMap';
import { PARTY_ORDER, partyStyle } from '../config/partyColors';

// Platform configurations
const PLATFORMS = [
  { id: 'all', label: 'All sources' },
  { id: 'twitter', label: 'X (Twitter)' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'whatsapp', label: 'WhatsApp' }
];

const LoadingSpinner = () => (
  <div className="flex items-center justify-center p-4">
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  </div>
);

// ─── Drone View Live Monitoring Strip ───────────────────────────────────────
const DRONE_API_KEY_STORAGE = 'blura_yt_api_key';
// Fallback levels: 0=ReactPlayer, 1=nocookie iframe, 2=standard embed, 3=thumbnail card
const FALLBACK_LABELS = ['Player (auto)', 'Embed (privacy)', 'Embed (standard)', 'Info card'];

const DroneViewStrip = () => {
  const [title, setTitle] = useState('Drone View');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('Drone View');
  const [linkInput, setLinkInput] = useState('');
  const [savedLink, setSavedLink] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const [playerState, setPlayerState] = useState('idle'); // idle|loading|playing|error
  const [playerKey, setPlayerKey] = useState(0);
  const [fallbackLevel, setFallbackLevel] = useState(0); // 0-3

  // API key settings
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem(DRONE_API_KEY_STORAGE) || '');
  const [savedApiKey, setSavedApiKey] = useState(() => localStorage.getItem(DRONE_API_KEY_STORAGE) || '');
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // Stream metadata from YouTube Data API
  const [streamMeta, setStreamMeta] = useState(null); // {title, thumbnail, viewers, isLive}
  const [metaLoading, setMetaLoading] = useState(false);

  const extractYouTubeId = (url) => {
    if (!url) return null;
    const patterns = [
      /[?&]v=([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /\/(?:live|embed)\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  };

  const fetchStreamMeta = async (url, apiKey) => {
    const videoId = extractYouTubeId(url);
    if (!videoId || !apiKey) return null;
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails,statistics&id=${videoId}&key=${apiKey}`
      );
      const data = await res.json();
      if (data.error) return { error: data.error.message };
      const item = data.items?.[0];
      if (!item) return { error: 'Video not found — check the URL.' };
      const thumbs = item.snippet?.thumbnails;
      return {
        videoTitle: item.snippet?.title || '',
        thumbnail: thumbs?.maxres?.url || thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url || '',
        isLive: item.snippet?.liveBroadcastContent === 'live',
        isUpcoming: item.snippet?.liveBroadcastContent === 'upcoming',
        viewers: item.liveStreamingDetails?.concurrentViewers
          ? Number(item.liveStreamingDetails.concurrentViewers).toLocaleString()
          : null,
        channelTitle: item.snippet?.channelTitle || '',
      };
    } catch {
      return null; // silently ignore — still show player
    }
  };

  const handleSaveApiKey = () => {
    localStorage.setItem(DRONE_API_KEY_STORAGE, apiKeyInput.trim());
    setSavedApiKey(apiKeyInput.trim());
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
  };

  const isValidUrl = (url) => {
    try { new URL(url); return true; } catch { return false; }
  };

  const handleOpenModal = async () => {
    const url = linkInput.trim();
    if (!url) { setError('Please paste a stream URL'); return; }
    if (!isValidUrl(url)) { setError('Invalid URL — paste a full link starting with https://'); return; }
    setError('');
    setStreamMeta(null);
    setPlayerState('loading');
    setFallbackLevel(0);
    setPlayerKey(k => k + 1);
    setSavedLink(url);
    setShowModal(true);
    if (savedApiKey) {
      setMetaLoading(true);
      const meta = await fetchStreamMeta(url, savedApiKey);
      setStreamMeta(meta);
      setMetaLoading(false);
    }
  };

  const handleCloseModal = () => {
    setPlayerState('idle');
    setTimeout(() => { setShowModal(false); setStreamMeta(null); }, 50);
  };

  const handleTitleSave = () => {
    setTitle(titleInput.trim() || 'Drone View');
    setIsEditingTitle(false);
  };

  const handlePlayerReady = () => setPlayerState('playing');

  const handlePlayerError = () => {
    setFallbackLevel(prev => {
      const next = prev + 1;
      if (next >= 3) { setPlayerState('error'); }
      else { setPlayerKey(k => k + 1); setPlayerState('loading'); }
      return next;
    });
  };

  const videoId = extractYouTubeId(savedLink);
  const nocookieUrl = videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1` : '';
  const standardEmbedUrl = videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1` : '';

  return (
    <>
      {/* Strip */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-xl border border-sky-500/30 bg-gradient-to-r from-sky-500/10 via-sky-500/5 to-transparent shadow-sm">
        {/* Pulsing dot */}
        <div className="relative flex-shrink-0">
          <div className="h-2 w-2 rounded-full bg-sky-500" />
          <div className="absolute inset-0 h-2 w-2 rounded-full bg-sky-500 animate-ping opacity-75" />
        </div>

        <Video className="h-4 w-4 text-sky-500 flex-shrink-0" />

        {/* Editable title */}
        {isEditingTitle ? (
          <input
            value={titleInput}
            autoFocus
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleSave();
              if (e.key === 'Escape') { setTitleInput(title); setIsEditingTitle(false); }
            }}
            className="text-sm font-semibold bg-transparent border-b border-sky-500/60 focus:outline-none focus:border-sky-500 w-32 text-sky-700 dark:text-sky-300"
          />
        ) : (
          <button onClick={() => { setTitleInput(title); setIsEditingTitle(true); }} className="flex items-center gap-1.5 group">
            <span className="text-sm font-semibold text-sky-700 dark:text-sky-300">{title}</span>
            <Pencil className="h-3 w-3 text-sky-400/50 group-hover:text-sky-500 transition-colors" />
          </button>
        )}

        <div className="h-4 w-px bg-border flex-shrink-0" />

        {/* URL input */}
        <div className="flex flex-1 min-w-0 items-center gap-2">
          <input
            value={linkInput}
            onChange={(e) => { setLinkInput(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleOpenModal()}
            placeholder="Paste live stream URL — YouTube, HLS (.m3u8), direct video..."
            className="flex-1 min-w-0 text-xs bg-background/60 border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500/40 focus:border-sky-500/50 placeholder:text-muted-foreground/50"
          />
          {error && <span className="text-[10px] text-rose-500 whitespace-nowrap hidden sm:inline">{error}</span>}
        </div>

        {/* Watch Live button */}
        <button
          onClick={handleOpenModal}
          disabled={!linkInput.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 shadow-sm"
        >
          <Play className="h-3 w-3 fill-current" />
          Watch Live
        </button>

        {/* Settings gear */}
        <button
          onClick={() => setShowSettings(s => !s)}
          className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${showSettings ? 'bg-sky-500/20 text-sky-600' : 'text-muted-foreground hover:text-sky-600 hover:bg-sky-500/10'
            }`}
          title="YouTube API Key settings"
        >
          <Settings className="h-4 w-4" />
        </button>

        {error && <span className="text-[10px] text-rose-500 sm:hidden w-full text-center">{error}</span>}

        {/* API Key settings panel */}
        {showSettings && (
          <div className="w-full flex items-center gap-2 pt-1 pb-0.5 border-t border-sky-500/20 mt-0.5">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">YouTube Data API v3 Key:</span>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
              placeholder="Paste your Google Console API key..."
              className="flex-1 text-xs bg-background/60 border border-border rounded-lg px-3 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500/40 focus:border-sky-500/50 placeholder:text-muted-foreground/40"
            />
            <button
              onClick={handleSaveApiKey}
              className="text-xs px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white transition-colors whitespace-nowrap"
            >
              {apiKeySaved ? '✓ Saved' : 'Save Key'}
            </button>
            {savedApiKey && (
              <span className="text-[10px] text-emerald-600 whitespace-nowrap">✓ API key active</span>
            )}
          </div>
        )}
      </div>

      {/* Live Viewer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={handleCloseModal}>
          <div className="relative w-full max-w-4xl bg-card rounded-2xl shadow-2xl overflow-hidden border border-border/60" onClick={(e) => e.stopPropagation()}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-sky-500/15 to-transparent border-b border-border">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {/* Thumbnail */}
                {streamMeta?.thumbnail && (
                  <img src={streamMeta.thumbnail} alt="" className="h-10 w-16 rounded object-cover flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {streamMeta?.isLive && (
                      <span className="flex items-center gap-1">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600"></span>
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">Live</span>
                      </span>
                    )}
                    {streamMeta?.isUpcoming && (
                      <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Upcoming</span>
                    )}
                    {streamMeta?.viewers && (
                      <span className="text-[10px] text-white/60">{streamMeta.viewers} watching</span>
                    )}
                    {playerState === 'loading' && !streamMeta && (
                      <Loader2 className="h-3.5 w-3.5 text-sky-400 animate-spin" />
                    )}
                  </div>
                  <p className="text-sm font-semibold text-foreground truncate">
                    {metaLoading
                      ? title
                      : (streamMeta?.videoTitle || title)}
                  </p>
                  {streamMeta?.channelTitle && (
                    <p className="text-[10px] text-muted-foreground truncate">{streamMeta.channelTitle}</p>
                  )}
                </div>
              </div>
              <button onClick={handleCloseModal} className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0 ml-2">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            {/* API error notice (e.g. bad key) */}
            {streamMeta?.error && (
              <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[10px] text-amber-600">
                API: {streamMeta.error}
              </div>
            )}

            {/* Player — 16:9 */}
            <div className="relative w-full bg-black" style={{ paddingBottom: '56.25%' }}>
              <div className="absolute inset-0">

                {/* ── Level 0: ReactPlayer (uses nocookie URL for YouTube — recommended) ── */}
                {fallbackLevel === 0 && playerState !== 'error' && (
                  <ReactPlayer key={`rp-${playerKey}`}
                    url={nocookieUrl || savedLink}
                    playing={playerState === 'loading' || playerState === 'playing'}
                    controls width="100%" height="100%"
                    onReady={handlePlayerReady}
                    onError={handlePlayerError}
                    config={{
                      youtube: { playerVars: { autoplay: 1, rel: 0, modestbranding: 1, origin: window.location.origin } },
                      file: { forceHLS: savedLink.includes('.m3u8'), attributes: { autoPlay: true, controls: true } },
                    }}
                  />
                )}

                {/* ── Level 1: youtube-nocookie iframe ── */}
                {fallbackLevel === 1 && playerState !== 'error' && nocookieUrl && (
                  <iframe key={`nc-${playerKey}`}
                    src={nocookieUrl} title={title}
                    className="absolute inset-0 w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    onLoad={() => setPlayerState('playing')}
                    onError={handlePlayerError}
                  />
                )}

                {/* ── Level 2: standard YouTube embed iframe ── */}
                {fallbackLevel === 2 && playerState !== 'error' && standardEmbedUrl && (
                  <iframe key={`yt-${playerKey}`}
                    src={standardEmbedUrl} title={title}
                    className="absolute inset-0 w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    onLoad={() => setPlayerState('playing')}
                    onError={handlePlayerError}
                  />
                )}

                {/* ── Level 3 / final error: info card ── */}
                {(fallbackLevel >= 3 || playerState === 'error') && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-black to-slate-900 gap-4 px-8 text-center">
                    {streamMeta?.thumbnail ? (
                      <div className="relative w-full max-w-sm">
                        <img src={streamMeta.thumbnail} alt="" className="w-full rounded-lg opacity-40" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="p-4 rounded-full bg-black/60 backdrop-blur-sm border border-white/10">
                            <Video className="h-10 w-10 text-white/60" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-5 rounded-full bg-slate-800 border border-white/10">
                        <Video className="h-12 w-12 text-white/30" />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <p className="text-base font-bold text-white">{streamMeta?.videoTitle || title}</p>
                      {streamMeta?.channelTitle && <p className="text-xs text-white/50">{streamMeta.channelTitle}</p>}
                      {streamMeta?.isLive && streamMeta?.viewers && (
                        <p className="text-xs text-red-400 font-medium">🔴 Live · {streamMeta.viewers} watching</p>
                      )}
                      <p className="text-[11px] text-white/30 mt-2 leading-relaxed">
                        Stream could not be embedded in-app.<br />
                        All 3 playback methods were attempted.
                      </p>
                    </div>
                    <button onClick={() => { setFallbackLevel(0); setPlayerState('loading'); setPlayerKey(k => k + 1); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      <Play className="h-3 w-3 fill-current" /> Retry All
                    </button>
                  </div>
                )}

                {/* Loading overlay (levels 0–2) */}
                {playerState === 'loading' && fallbackLevel < 3 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 pointer-events-none gap-3">
                    <Loader2 className="h-10 w-10 text-sky-400 animate-spin" />
                    <span className="text-xs text-white/50">Trying method {fallbackLevel + 1} of 3…</span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-2.5 bg-muted/30 border-t border-border flex items-center gap-3">
              <p className="text-[11px] text-muted-foreground truncate flex-1">{savedLink}</p>
              {fallbackLevel < 3 && playerState !== 'error' && (
                <div className="hidden sm:flex gap-1">
                  {[0, 1, 2].map(i => (
                    <button key={i}
                      onClick={() => { setFallbackLevel(i); setPlayerState('loading'); setPlayerKey(k => k + 1); }}
                      className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors ${fallbackLevel === i ? 'bg-sky-600 text-white' : 'bg-muted text-muted-foreground hover:bg-sky-500/10'}`}
                    >{['Auto', 'NoCookie', 'Embed'][i]}</button>
                  ))}
                </div>
              )}
              <button onClick={handleCloseModal} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors flex-shrink-0">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const Dashboard = () => {
  const { dashboardData, loading, fetchDashboardData, refreshDashboard, hasCachedData } = useDashboard();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [alertType, setAlertType] = useState('active');
  const [alertPlatform, setAlertPlatform] = useState('all');
  const [reportPlatform, setReportPlatform] = useState('all');
  const [reportStatus, setReportStatus] = useState('all');
  const [grievancePlatform, setGrievancePlatform] = useState('all');
  const [grievanceStatus, setGrievanceStatus] = useState('all');
  const [mlaLeaderboard, setMlaLeaderboard] = useState([]);
  const [mlaLeaderboardLoading, setMlaLeaderboardLoading] = useState(true);
  const [partyFilter, setPartyFilter] = useState('BRS');
  // Pagination state for the Statewide MLA Sentiment leaderboard — 10 rows
  // per page so the user scrolls through pages instead of one long list.
  const [mlaPage, setMlaPage] = useState(1);
  const MLA_PAGE_SIZE = 10;
  // Free-text filter over the leaderboard — matches MLA name or seat, so a
  // seat can be found without paging through all 90 rows to reach it.
  const [mlaQuery, setMlaQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    const fetchLeaderboard = async () => {
      setMlaLeaderboardLoading(true);
      try {
        const res = await api.get('/constituency-intel/leaderboard', {
          // basis=leader: posts tagging the MLA, naming them or naming their seat.
          params: { days: 365, sort: 'index', order: 'desc', limit: 200, basis: 'leader' },
        });
        if (!cancelled) setMlaLeaderboard(res.data?.data || []);
      } catch (_e) {
        if (!cancelled) setMlaLeaderboard([]);
      } finally {
        if (!cancelled) setMlaLeaderboardLoading(false);
      }
    };
    fetchLeaderboard();
    return () => {
      cancelled = true;
    };
  }, []);

  // Extract data from context
  const alertData = dashboardData?.alertData || {};
  const reportData = dashboardData?.reportData || {};
  const grievanceData = dashboardData?.grievanceData || {};
  const alertPendingReportData = dashboardData?.alertPendingReportData || {};
  const sentimentAnalytics = dashboardData?.sentimentAnalytics || null;
  const categoryAnalytics = dashboardData?.categoryAnalytics || null;

  useEffect(() => {
    fetchDashboardData();
    const timer = setInterval(() => {
      refreshDashboard();
    }, 15000);
    return () => clearInterval(timer);
  }, [fetchDashboardData, refreshDashboard]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshDashboard();
    setIsRefreshing(false);
  };

  if (loading && !hasCachedData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="relative">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-violet-500/20 border-t-violet-600"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <Shield className="h-5 w-5 text-violet-600 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  const ALERT_TYPES = [
    { id: 'active', label: 'Active Alerts' },
    { id: 'acknowledged', label: 'Acknowledged Alerts' },
    { id: 'false_positive', label: 'False Positive Alerts' },
    { id: 'escalated', label: 'Escalated Alerts' },
  ];

  const getAlertCount = () => {
    const typeData = alertData?.[alertType] || alertData?.active || {};
    return typeData[alertPlatform] ?? typeData.all ?? 0;
  };

  const getEscalatedPendingCount = () => alertPendingReportData?.[alertPlatform] ?? alertPendingReportData?.all ?? 0;
  const getEscalatedGeneratedCount = () => {
    const total = alertData?.escalated?.[alertPlatform] ?? alertData?.escalated?.all ?? 0;
    return Math.max(0, total - getEscalatedPendingCount());
  };

  const getGrievanceCount = () => {
    const data = grievanceData?.[grievancePlatform] || grievanceData?.all || {};
    if (grievanceStatus === 'pending') return data.pending ?? 0;
    if (grievanceStatus === 'resolved') return data.resolved ?? 0;
    return data.total ?? 0;
  };

  const getReportCount = () => {
    const data = reportData?.[reportPlatform] || reportData?.all || {};
    if (reportStatus === 'sent_to_intermediary') return data.sent_to_intermediary || 0;
    if (reportStatus === 'closed') return data.closed || 0;
    return data.total || 0;
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300" data-testid="dashboard">
      {/* Header with Refresh */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Statewide MLA Sentiment Leaderboard — same fixed height as the map
            card beside it; the list scrolls inside. */}
        <Card className="border border-border/50 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col h-[520px]">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/30">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-violet-100 rounded-lg">
                <Crown className="h-3.5 w-3.5 text-violet-600" />
              </div>
              <h3 className="text-[13px] font-semibold text-foreground">Statewide MLA Sentiment</h3>
              <span className="text-[10px] text-muted-foreground">· positivity ↓</span>
            </div>
            <select
              value={partyFilter}
              onChange={(e) => { setPartyFilter(e.target.value); setMlaPage(1); }}
              className="text-[11px] border border-slate-200 rounded px-1.5 py-0.5 bg-white"
            >
              <option value="ALL">All parties</option>
              {PARTY_ORDER.map((code) => (
                <option key={code} value={code === 'VACANT' ? 'Vacant' : code}>{code === 'VACANT' ? 'Vacant' : code}</option>
              ))}
            </select>
          </div>

          <div className="px-4 py-2 border-b border-border/30 bg-slate-50/50">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={mlaQuery}
                onChange={(e) => { setMlaQuery(e.target.value); setMlaPage(1); }}
                placeholder="Search MLA or constituency…"
                className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-8 py-1.5 text-[12px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
              {mlaQuery && (
                <button
                  type="button"
                  onClick={() => { setMlaQuery(''); setMlaPage(1); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {mlaLeaderboardLoading ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : (() => {
                            const withStats = mlaLeaderboard
                .filter((r) => partyFilter === 'ALL' || r.party === partyFilter)
                .map((r) => {
                  const total = r.grievances || 0;
                  const posShare = total > 0 ? (r.positive || 0) / total : 0;
                  return { ...r, posShare, total };
                });

              // Pin the Chief Minister (MLA for Sanquelim) to position #1
              // regardless of mention count. Only pins entries that survive
              // the current party filter. Names match src/data/stateMLAs.js.
              const PINNED_MLA_ORDER = ['K Chandrashekar Rao', 'K. T. Rama Rao', 'Thanneeru Harish Rao'];
              const pinned = PINNED_MLA_ORDER
                .map((name) => withStats.find((r) => r.mla === name))
                .filter(Boolean);
              const pinnedKeys = new Set(pinned.map((r) => r.key || r.constituency));

              // Everyone else (rank 3+) is ranked purely by mention volume —
              // higher total mentions ranks higher — ties broken by positive
              // share then sentiment_index.
              const rest = withStats
                .filter((r) => !pinnedKeys.has(r.key || r.constituency))
                .sort((a, b) => {
                  if (b.total !== a.total) return b.total - a.total;
                  if (b.posShare !== a.posShare) return b.posShare - a.posShare;
                  return b.sentiment_index - a.sentiment_index;
                });

              // Search runs AFTER ranking so positions stay stable — filtering
              // never re-orders the leaderboard, it only narrows it.
              const q = mlaQuery.trim().toLowerCase();
              const ranked = [...pinned, ...rest];
              const rows = !q ? ranked : ranked.filter((r) =>
                String(r.mla || '').toLowerCase().includes(q) ||
                String(r.constituency || '').toLowerCase().includes(q) ||
                String(r.party || '').toLowerCase().includes(q));

              if (rows.length === 0) {
                return (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center min-h-[400px]">
                    <div className="p-4 rounded-full bg-slate-100 mb-4">
                      {q ? <Search className="h-8 w-8 text-slate-400" /> : <Crown className="h-8 w-8 text-slate-400" />}
                    </div>
                    {q ? (
                      <>
                        <p className="text-sm font-medium text-slate-500">No match for “{mlaQuery}”</p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Try a different spelling, or clear the party filter.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-slate-500">No MLA sentiment data yet</p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Rankings appear once grievance ingestion finds mentions per seat.
                        </p>
                      </>
                    )}
                  </div>
                );
              }

              const totalPages = Math.max(1, Math.ceil(rows.length / MLA_PAGE_SIZE));
              const safePage   = Math.min(mlaPage, totalPages);
              const pageStart  = (safePage - 1) * MLA_PAGE_SIZE;
              const pageRows   = rows.slice(pageStart, pageStart + MLA_PAGE_SIZE);

              return (
                <>
                <div className="divide-y divide-slate-100">
                  {pageRows.map((r, localIdx) => {
                    const idx = pageStart + localIdx;
                    const pct = Math.round(r.posShare * 100);
                    const negPct = r.total > 0 ? Math.round(((r.negative || 0) / r.total) * 100) : 0;
                    const rankColor =
                      idx === 0 ? 'bg-yellow-100 text-yellow-700' :
                      idx === 1 ? 'bg-slate-200 text-slate-700' :
                      idx === 2 ? 'bg-orange-100 text-orange-700' :
                      'bg-slate-50 text-slate-500';
                    return (
                      <Link
                        key={r.key || r.constituency}
                        to={`/mla/${encodeURIComponent(r.constituency)}`}
                        className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 transition-colors group"
                      >
                        <div className={`shrink-0 w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center ${rankColor}`}>
                          {idx + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-semibold text-slate-800 truncate group-hover:text-violet-700">
                              {r.mla || '—'}
                            </span>
                            <span
                              className="inline-block w-2 h-2 rounded-full shrink-0"
                              style={{ background: partyStyle(r.party).hex }}
                              title={r.party}
                            />
                            <span className="text-[10px] text-slate-400">{r.party}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-slate-500 truncate">
                              {r.constituency}
                            </span>
                            <span className="text-[10px] text-slate-300">·</span>
                            <span className="text-[10px] text-slate-500">
                              {r.total} mentions
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden bg-slate-100 mt-1 flex">
                            <div className="bg-emerald-500" style={{ width: `${pct}%` }} />
                            <div className="bg-red-500" style={{ width: `${negPct}%` }} />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="flex items-center justify-end gap-1 text-emerald-700 text-sm font-bold tabular-nums">
                            {r.sentiment_index >= 0 ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3 text-red-600" />
                            )}
                            {pct}%
                          </div>
                          <div className="text-[9px] uppercase tracking-wide text-slate-400">
                            Positive
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-500">
                  <span>
                    Showing <span className="font-semibold text-slate-700">{pageStart + 1}</span>–
                    <span className="font-semibold text-slate-700">{Math.min(pageStart + MLA_PAGE_SIZE, rows.length)}</span>
                    {' '}of <span className="font-semibold text-slate-700">{rows.length}</span> MLAs
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setMlaPage((p) => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      className="px-2 py-1 rounded border border-slate-200 bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                    >
                      ‹ Prev
                    </button>
                    <span className="px-2 tabular-nums">
                      Page {safePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMlaPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                      className="px-2 py-1 rounded border border-slate-200 bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors"
                    >
                      Next ›
                    </button>
                  </div>
                </div>
                </>
              );
            })()}
          </div>
        </Card>

        {/* Telangana Constituency Map — Always Visible */}
        <Card className="border border-border/50 shadow-sm hover:shadow-md transition-all overflow-hidden lg:col-span-1 flex flex-col h-[520px]">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/30">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-orange-100 rounded-lg">
                <BarChart3 className="h-3.5 w-3.5 text-orange-600" />
              </div>
              <h3 className="text-[13px] font-semibold text-foreground">Telangana Constituencies</h3>
            </div>
            <span className="text-[10px] text-muted-foreground font-medium">BRS Leadership · Constituency-wide</span>
          </div>
          <div className="flex-1 min-h-0 bg-white dark:bg-slate-950/20">
            <StateMap embedded />
          </div>
        </Card>
      </div>

      {/* Combined Analytics & Alerts Grid */}
      <TooltipProvider>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[280px] overflow-hidden">
          
          {/* Col 1-2: Grievance Analytics (Pie) */}
          <div className={`${categoryAnalytics ? 'lg:col-span-2' : 'lg:col-span-2'} h-[280px] overflow-hidden`}>
            {categoryAnalytics && (() => {
              const rawTopics = categoryAnalytics.topics || [];
              const canonicalizeTopicName = (name) => {
                const original = String(name || '').trim();
                if (!original) return '';
                const normalized = original
                  .replace(/[_-]+/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .toLowerCase();

                if (normalized === 'normal' || normalized === 'govt praise' || normalized === 'government praise' || normalized === 'general praise' || normalized === 'general complaint') return 'General Complaint';
                if (normalized === 'public complaint') return 'Public Complaint';
                if (normalized === 'political criticism') return 'Political Criticism';
                if (normalized === 'corruption complaint') return 'Corruption Complaint';
                if (normalized === 'traffic complaint') return 'Traffic Complaint';
                if (normalized === 'public nuisance') return 'Public Nuisance';
                if (normalized === 'road and infrastructure' || normalized === 'road & infrastructure') return 'Road & Infrastructure';
                if (normalized === 'law and order' || normalized === 'law & order') return 'Law & Order';
                if (normalized === 'hate speech') return 'Hate Speech';

                return normalized
                  .split(' ')
                  .filter(Boolean)
                  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                  .join(' ');
              };

              const mergedTopicMap = rawTopics.reduce((acc, topic) => {
                const normalizedName = canonicalizeTopicName(topic?.name);
                const count = Number(topic?.count) || 0;
                if (!normalizedName || count <= 0) return acc;
                acc[normalizedName] = (acc[normalizedName] || 0) + count;
                return acc;
              }, {});
              const topics = Object.entries(mergedTopicMap)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count);
              const total = topics.reduce((s, t) => s + t.count, 0);

              if (topics.length === 0) {
                return (
                  <Card className="border border-border/50 shadow-sm hover:shadow-md transition-all overflow-hidden h-full flex flex-col">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 shrink-0">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-violet-100 rounded-lg">
                          <BarChart3 className="h-3.5 w-3.5 text-violet-600" />
                        </div>
                        <h3 className="text-[13px] font-semibold text-foreground">Grievance Analytics</h3>
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
                       <p className="text-xs text-muted-foreground">No category data available</p>
                    </div>
                  </Card>
                );
              }

              const TOPIC_COLORS = {
                'Political Criticism': '#8b5cf6', 'Hate Speech': '#ef4444', 'Public Complaint': '#3b82f6',
                'Corruption Complaint': '#f97316', 'General Complaint': '#10b981', 'Traffic Complaint': '#f59e0b',
                'Public Nuisance': '#f43f5e', 'Road & Infrastructure': '#eab308', 'Law & Order': '#6366f1'
              };

              const pieData = topics.map(t => ({
                name: t.name, value: t.count, color: TOPIC_COLORS[t.name] || '#6b7280'
              }));

              return (
                <Card className="border border-border/50 shadow-sm hover:shadow-md transition-all overflow-hidden h-full flex flex-col">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-violet-100 rounded-lg">
                        <BarChart3 className="h-3.5 w-3.5 text-violet-600" />
                      </div>
                      <h3 className="text-[13px] font-semibold text-foreground">Grievance Analytics</h3>
                      <span className="text-[10px] text-muted-foreground ml-1">({total} total)</span>
                    </div>
                    <Link to="/grievances" className="text-[11px] text-violet-600 hover:text-violet-700 font-medium flex items-center gap-0.5 transition-colors">
                      View <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                  <div className="p-2 flex flex-row items-center gap-2 flex-1 min-h-0">
                    {/* Left Half: Big Pie Chart */}
                    <div className="relative w-1/2 h-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius="50%" outerRadius="80%" paddingAngle={2} strokeWidth={0}>
                            {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                          </Pie>
                          <RechartsTooltip
                            formatter={(value, name) => [`${value} (${total ? Math.round(value / total * 100) : 0}%)`, name]}
                            contentStyle={{ fontSize: '11px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '6px 10px' }}
                            wrapperStyle={{ zIndex: 1000 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <p className="text-2xl font-bold text-foreground leading-none">{total}</p>
                        <p className="text-[8px] text-muted-foreground uppercase tracking-widest mt-1">Grievances</p>
                      </div>
                    </div>

                    {/* Right Half: Category list */}
                    <div className="w-1/2 space-y-1 h-full overflow-y-auto pl-1 pr-1 custom-scrollbar">
                      {topics.map((topic) => {
                        const pct = total ? Math.round(topic.count / total * 100) : 0;
                        const color = TOPIC_COLORS[topic.name] || '#6b7280';
                        return (
                          <Link
                            key={topic.name}
                            to={`/grievances?grievance_type=${encodeURIComponent(topic.name)}`}
                            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-violet-50 dark:hover:bg-violet-500/5 transition-colors group cursor-pointer"
                          >
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                            <span className="text-[11px] font-medium text-foreground flex-1 truncate group-hover:text-violet-700 transition-colors">
                              {topic.name}
                            </span>
                            <span className="text-[10px] font-bold tabular-nums text-right" style={{ color }}>{pct}%</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </Card>
              );
            })()}
          </div>

          {/* Col 3: Alerts Card */}
          <div className={`${categoryAnalytics ? 'lg:col-span-1' : 'lg:col-span-3'} h-[280px] overflow-hidden`}>
            <Card className="bg-gradient-to-br from-card via-card to-rose-500/5 border border-border/50 shadow-sm hover:shadow-lg transition-all overflow-hidden h-full flex flex-col">
              <div className="p-4 border-b border-border/50 bg-gradient-to-r from-rose-500/10 to-transparent shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-rose-500/10 rounded-lg">
                      <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    </div>
                    <Link to={`/alerts?status=${alertType}`} className="text-xs font-semibold hover:underline">
                      Alerts
                    </Link>
                  </div>
                  <div className="relative">
                    <select
                      value={alertType}
                      onChange={(e) => setAlertType(e.target.value)}
                      className="appearance-none bg-transparent text-[11px] font-medium text-muted-foreground cursor-pointer focus:outline-none text-right pr-4"
                    >
                      {ALERT_TYPES.map((type) => (
                        <option key={type.id} value={type.id}>{type.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div className="flex items-end justify-between">
                     <div>
                       <p className="text-4xl font-bold bg-gradient-to-r from-rose-600 to-pink-600 bg-clip-text text-transparent leading-none">{getAlertCount()}</p>
                       <p className="text-[10px] text-muted-foreground mt-1">Total {alertType.replace('_', ' ')}</p>
                     </div>
                     {alertType === 'escalated' && (
                        <div className="text-[10px] text-right text-muted-foreground">
                            <p>Gen: {getEscalatedGeneratedCount()}</p>
                            <p>Pend: {getEscalatedPendingCount()}</p>
                        </div>
                     )}
                </div>
              </div>

              <div className="p-2 border-b border-border/50 shrink-0">
                <div className="flex items-center gap-2">
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Platform</p>
                  <div className="relative flex-1">
                    <select
                      value={alertPlatform}
                      onChange={(e) => setAlertPlatform(e.target.value)}
                      className="appearance-none bg-transparent text-xs font-medium text-foreground cursor-pointer focus:outline-none w-full pr-5"
                    >
                      {PLATFORMS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="p-2 flex gap-2 flex-1 items-stretch min-h-0">
                {ALERT_TYPES.filter(t => t.id !== alertType).slice(0, 3).map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setAlertType(type.id)}
                    className="flex-1 flex flex-col items-center justify-center text-center py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors hover:bg-rose-500/5 rounded border border-transparent hover:border-rose-100"
                  >
                    <span className="block text-sm font-bold text-foreground">{alertData[type.id]?.all || 0}</span>
                    <span className="scale-90 opacity-80 leading-tight">{type.label.replace(' Alerts', '').replace(' Posts', '')}</span>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </TooltipProvider>



    </div >
  );
};

export default Dashboard;
