import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Radio, Plus, Trash2, RefreshCw, Loader2, Search, Users, ExternalLink,
    Pause, Play, ShieldCheck, Crown, Star, AlertTriangle, MessageSquare, Wifi, WifiOff, Clock,
    Volume2, VolumeX, VideoOff, Eye, X, Hourglass
} from 'lucide-react';
import api, { BACKEND_URL } from '../../lib/api';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { renderMessageBody } from './liveChatEmoji';
import { BRAND } from '../../config/partyMedia';

/* Same positive / neutral / negative scheme as Mentions & Alerts. */
const SENTIMENT_CONFIG = {
    positive: { label: 'Positive', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
    neutral: { label: 'Neutral', chip: 'bg-slate-50 text-slate-700 border-slate-200', dot: 'bg-slate-400', bar: 'bg-slate-400' },
    negative: { label: 'Negative', chip: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500', bar: 'bg-rose-500' },
};

const STATUS_CONFIG = {
    live: { label: 'LIVE', className: 'bg-red-600 text-white', pulse: true },
    idle: { label: 'Offline', className: 'bg-slate-200 text-slate-600', pulse: false },
    // A finished broadcast is a normal outcome, not a fault — it gets its own
    // neutral tag so it never reads as something needing attention.
    ended: { label: 'ENDED', className: 'bg-slate-700 text-white', pulse: false },
    error: { label: 'Error', className: 'bg-amber-100 text-amber-700', pulse: false },
};

const MAX_FEED = 400;   // cap the DOM; live chat is unbounded

/**
 * Presentation-only collapse of the canonical 6-value stance
 * (pro_target / anti_target / pro_target_indirect / anti_target_indirect /
 * neutral / unrelated) into the 2-3 labels the UI shows. The stored value
 * always stays the raw canonical one — this never gets written back.
 */
function stanceToLabel(stance) {
    // pro_client / anti_client are written by scripts/rescore_live_chat.js.
    if (stance === 'pro_target' || stance === 'pro_target_indirect' || stance === 'pro_client') return { label: 'Supportive', className: 'bg-blue-50 text-blue-700 border-blue-200' };
    if (stance === 'anti_target' || stance === 'anti_target_indirect' || stance === 'anti_client') return { label: 'Opposing', className: 'bg-rose-50 text-rose-700 border-rose-200' };
    return { label: 'Neutral', className: 'bg-slate-50 text-slate-500 border-slate-200' };
}

function formatViewers(n) {
    const v = Number(n) || 0;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
    return String(v);
}

function timeAgo(date) {
    if (!date) return '';
    const diff = Date.now() - new Date(date).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

/* ═════════════════════════ real analysis progress ═════════════════════════
 *
 * Every number here comes from the backend's real timestamps
 * (analysis_queued_at / analysis_started_at) and its real rolling median of
 * ACTUAL completed analysis durations (expected_duration_ms — null until at
 * least one real completion exists, never a guessed default). This
 * component only reads a local clock to recompute "now" — it never polls
 * the API, never fabricates a percentage, and never advances past 97% on
 * its own; the backend's own 'complete'/'failed' event is what removes it.
 */
const AnalysisProgress = ({ status, queuedAt, startedAt, expectedDurationMs }) => {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (status !== 'pending' && status !== 'analyzing') return undefined;
        // Local tick only — no network request. Real elapsed time is always
        // (now - the real backend timestamp), recomputed every tick.
        const id = setInterval(() => setNow(Date.now()), 200);
        return () => clearInterval(id);
    }, [status]);

    if (status === 'pending') {
        const anchorMs = queuedAt ? new Date(queuedAt).getTime() : null;
        const elapsedS = anchorMs ? Math.max(0, (now - anchorMs) / 1000) : null;
        return (
            <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-slate-50 text-slate-400 border-slate-200">
                <Hourglass className="h-2.5 w-2.5" />
                Waiting for analysis{elapsedS !== null ? ` · ${elapsedS.toFixed(1)}s` : ''}
            </span>
        );
    }

    // status === 'analyzing'
    const anchorMs = startedAt ? new Date(startedAt).getTime() : null;
    const elapsedMs = anchorMs ? Math.max(0, now - anchorMs) : 0;
    const elapsedS = elapsedMs / 1000;
    // Real formula: elapsed / real measured median duration. null (no bar
    // fill, elapsed text only) when there is no real history yet — never a
    // hard-coded stand-in duration. Clamped below 100 so a slower-than-usual
    // analysis never falsely reads as done before the backend says so.
    const pct = expectedDurationMs ? Math.min(97, Math.round((elapsedMs / expectedDurationMs) * 100)) : null;

    return (
        <div className="flex flex-col gap-1 min-w-[140px] max-w-[220px]">
            <span className="text-[10px] font-semibold text-slate-500">
                Analyzing · {elapsedS.toFixed(1)}s
            </span>
            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                    className="h-full bg-blue-400"
                    style={{ width: pct !== null ? `${pct}%` : '0%' }}
                />
            </div>
        </div>
    );
};

/* ═════════════════════════ message row ═════════════════════════ */

const MessageRow = ({ msg, isNew, onOpenAnalysis }) => {
    const cfg = SENTIMENT_CONFIG[msg.sentiment === 'moderate' ? 'neutral' : msg.sentiment] || SENTIMENT_CONFIG.neutral;
    const status = msg.analysis_status || (msg.is_political ? 'pending' : 'complete');
    const isPendingState = status === 'pending';
    const isAnalyzingState = status === 'analyzing';
    const isFailed = status === 'failed';
    const isComplete = status === 'complete';
    const stance = stanceToLabel(msg.stance);

    return (
        <div
            className={cn(
                'flex gap-3 px-3 py-2.5 border-b border-slate-100 transition-colors',
                isNew ? 'animate-in fade-in slide-in-from-bottom-1 duration-500 bg-blue-50/40' : 'hover:bg-slate-50'
            )}
        >
            {msg.author_photo ? (
                <img src={msg.author_photo} alt="" className="h-8 w-8 rounded-full flex-shrink-0 object-cover" loading="lazy" />
            ) : (
                <div className="h-8 w-8 rounded-full flex-shrink-0 bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
                    {(msg.author_name || '?').charAt(0).toUpperCase()}
                </div>
            )}

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-slate-900 truncate max-w-[180px]">{msg.author_name}</span>
                    {msg.is_owner && <Crown className="h-3 w-3 text-amber-500" title="Channel owner" />}
                    {msg.is_moderator && <ShieldCheck className="h-3 w-3 text-blue-500" title="Moderator" />}
                    {msg.is_member && <Star className="h-3 w-3 text-emerald-500" title="Member" />}
                    {msg.is_superchat && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-100 text-yellow-800 border border-yellow-300">
                            {msg.superchat_amount || 'SUPERCHAT'}
                        </span>
                    )}
                    <span className="text-[10px] text-slate-400">{timeAgo(msg.published_at)}</span>
                </div>

                <p className="text-sm text-slate-800 break-words mt-0.5 leading-snug">{renderMessageBody(msg)}</p>

                {/*
                 * Never show a sentiment/stance/risk chip while the canonical
                 * engine hasn't produced a real result yet — an "Analyzing…"
                 * placeholder instead, never the old lexicon guess as if final.
                 */}
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {(isPendingState || isAnalyzingState) && (
                        <AnalysisProgress
                            status={status}
                            queuedAt={msg.analysis_queued_at || msg.created_at}
                            startedAt={msg.analysis_started_at}
                            expectedDurationMs={msg.expected_duration_ms}
                        />
                    )}
                    {isFailed && (
                        <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-slate-50 text-slate-400 border-slate-200"
                            title={msg.analysis_reason || 'Canonical analysis unavailable'}
                        >
                            Analysis unavailable
                        </span>
                    )}
                    {isComplete && (
                        <>
                            <span
                                className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold', cfg.chip)}
                                title={(msg.matched_entities || []).join(', ') || undefined}
                            >
                                <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                                {cfg.label}
                            </span>
                            <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold', stance.className)}>
                                {stance.label}
                            </span>
                            {msg.needs_review && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-amber-50 text-amber-700 border-amber-200" title={msg.review_reason || 'Low confidence — flagged for review'}>
                                    Needs review
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={() => onOpenAnalysis && onOpenAnalysis(msg)}
                                className="ml-auto p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                                title="View analysis details"
                            >
                                <Eye className="h-3.5 w-3.5" />
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

/* ═════════════════════════ analysis detail modal ═════════════════════════ */

const LiveChatAnalysisModal = ({ msg, onClose }) => {
    if (!msg) return null;
    const cfg = SENTIMENT_CONFIG[msg.sentiment === 'moderate' ? 'neutral' : msg.sentiment] || SENTIMENT_CONFIG.neutral;
    const stance = stanceToLabel(msg.stance);
    const details = msg.analysis_details || {};
    const riskColor = msg.risk_level === 'high' ? 'text-rose-600' : msg.risk_level === 'medium' ? 'text-amber-600' : 'text-emerald-600';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
            <div
                className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-800">Comment Analysis</h3>
                    <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="p-4 space-y-3">
                    <p className="text-sm text-slate-700 bg-slate-50 rounded p-2 border border-slate-100">{msg.text}</p>

                    <div className="grid grid-cols-3 gap-2">
                        <div className="border border-slate-200 rounded p-2 text-center">
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">Sentiment</div>
                            <div className={cn('text-sm font-bold mt-0.5', cfg.dot.replace('bg-', 'text-'))}>{cfg.label}</div>
                        </div>
                        <div className="border border-slate-200 rounded p-2 text-center">
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">Stance</div>
                            <div className="text-sm font-bold mt-0.5 text-slate-800">{stance.label}</div>
                        </div>
                        <div className="border border-slate-200 rounded p-2 text-center">
                            <div className="text-[10px] text-slate-400 uppercase font-semibold">Risk</div>
                            <div className={cn('text-sm font-bold mt-0.5 capitalize', riskColor)}>{msg.risk_level || '—'}</div>
                        </div>
                    </div>

                    {msg.needs_review && (
                        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded p-2">
                            Flagged for review: {msg.review_reason || 'low confidence'}
                        </div>
                    )}

                    {msg.target_entity && (
                        <div className="text-xs text-slate-600"><span className="font-semibold">Target entity:</span> {msg.target_entity}</div>
                    )}

                    {(details.explanation || details.political_reasoning) && (
                        <div className="text-xs text-slate-600 border-t border-slate-100 pt-2">
                            <span className="font-semibold">Reasoning:</span> {details.explanation || details.political_reasoning}
                        </div>
                    )}

                    <div className="text-[10px] text-slate-400 border-t border-slate-100 pt-2 flex justify-between">
                        <span>Provider: {msg.analysis_provider || '—'}</span>
                        <span>Confidence: {typeof msg.confidence === 'number' ? `${Math.round(msg.confidence * 100)}%` : '—'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

/* ═════════════════════════ live player ═════════════════════════ */

/**
 * The selected channel's CURRENT broadcast, played through YouTube's official
 * iframe embed.
 *
 * This is the one part of the tab that talks to YouTube through a sanctioned,
 * public interface — no API key, no quota, no InnerTube — so it keeps working
 * independently of the chat reader.
 *
 * It always follows whatever is live *now*: the backend watcher rewrites
 * `video_id` when a channel starts a new broadcast, so the player switches over
 * on its own rather than pinning to the video that was live when it was added.
 */
const LivePlayer = ({ channel, onSelectStream, switching }) => {
    // Browsers refuse to autoplay audio, so the stream starts muted and the
    // viewer unmutes deliberately. Toggling remounts the iframe (see `key`),
    // which is the only way to change the flag without pulling in the YouTube
    // IFrame API just for this.
    const [muted, setMuted] = useState(true);

    const streams = channel?.available_streams || [];

    // Play the stream being read — but only while it is still in the live list.
    // video_id persists after a broadcast ends, so trusting it blindly loads a
    // finished video. Anything not currently live falls back to the top stream.
    const playing =
        streams.find((s) => s.video_id === channel?.video_id) || streams[0] || null;

    // With no list yet (a doc predating this feature) trust video_id if the
    // channel is marked live, so those channels still play.
    const playingId =
        playing?.video_id ||
        (streams.length === 0 && channel?.status === 'live' ? channel?.video_id : null) ||
        null;

    const isLive = !!playingId;
    const playingTitle = playing?.title || channel?.video_title || '';

    if (!channel) {
        return (
            <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
                <Radio className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                <p className="text-sm text-slate-500">Select a channel to watch its live stream.</p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    {isLive ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white">
                            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                            LIVE
                        </span>
                    ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-600">
                            OFFLINE
                        </span>
                    )}
                    <h3 className="text-xs font-semibold text-slate-800 truncate">
                        {channel.channel_name || channel.channel_ref}
                    </h3>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {isLive && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setMuted((m) => !m)}
                            className="h-7 gap-1 text-[11px]"
                            title={muted ? 'Unmute the stream' : 'Mute the stream'}
                        >
                            {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                            {muted ? 'Unmute' : 'Mute'}
                        </Button>
                    )}
                    {playingId && (
                        <a
                            href={`https://www.youtube.com/watch?v=${playingId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-slate-200 bg-white text-[11px] text-slate-600 hover:bg-slate-50"
                            title="Open this broadcast on YouTube"
                        >
                            <ExternalLink className="h-3 w-3" />
                            YouTube
                        </a>
                    )}
                </div>
            </div>

            {isLive ? (
                <div className="relative w-full bg-black aspect-video">
                    <iframe
                        key={`${playingId}-${muted ? 'muted' : 'unmuted'}`}
                        src={`https://www.youtube.com/embed/${playingId}?autoplay=1&mute=${muted ? 1 : 0}&rel=0&playsinline=1`}
                        title={playingTitle || 'Live stream'}
                        className="absolute inset-0 h-full w-full"
                        frameBorder="0"
                        /*
                         * index.html sets a document-wide `no-referrer` policy.
                         * YouTube's player validates the embedding domain from the
                         * Referer header and refuses to start without one ("Error
                         * 153 — video player configuration error"), so this iframe
                         * opts back in. `strict-origin-when-cross-origin` sends
                         * only the origin, never the path, so the app's pages are
                         * still not leaked to YouTube.
                         */
                        referrerPolicy="strict-origin-when-cross-origin"
                        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                        allowFullScreen
                    />
                </div>
            ) : (
                /* Offline: show the last known broadcast's thumbnail rather than a
                   dead player, so the card still identifies the channel. */
                <div className="relative w-full bg-slate-900 aspect-video flex flex-col items-center justify-center">
                    {channel.thumbnail && (
                        <img
                            src={channel.thumbnail}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover opacity-25"
                        />
                    )}
                    <VideoOff className="h-8 w-8 text-slate-400 mb-2 relative" />
                    <p className="text-sm font-medium text-slate-200 relative">Not live right now</p>
                    <p className="text-[11px] text-slate-400 mt-1 relative px-6 text-center">
                        The stream starts here automatically when this channel goes live.
                    </p>
                </div>
            )}

            {playingTitle && (
                <div className="px-3 py-2 border-t border-slate-100">
                    <p className="text-xs font-medium text-slate-800 line-clamp-2">{playingTitle}</p>
                </div>
            )}

            {/*
              * A news channel routinely runs several broadcasts at once — a
              * rolling 24/7 feed plus one stream per event. Only the selected
              * one is read for chat, so which one is picked matters: the
              * highest-viewer feed is not always the one worth watching.
              */}
            {streams.length > 1 && (
                <div className="px-3 py-2 border-t border-slate-100 bg-slate-50/60">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                            {streams.length} streams live · pick one to read
                        </span>
                        {switching && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                    </div>

                    <div className="flex gap-2 overflow-x-auto pb-1">
                        {streams.map((s) => {
                            // READING reflects where chat is actually read from,
                            // which is the backend video_id — not whatever the
                            // player fell back to.
                            const active = s.video_id === channel.video_id;
                            return (
                                <button
                                    key={s.video_id}
                                    type="button"
                                    disabled={switching || active}
                                    onClick={() => onSelectStream?.(s.video_id)}
                                    title={s.title}
                                    className={cn(
                                        'flex-shrink-0 w-[150px] text-left rounded-md border overflow-hidden transition-colors',
                                        active
                                            ? 'border-red-400 ring-1 ring-red-300 bg-white'
                                            : 'border-slate-200 bg-white hover:border-slate-400 disabled:opacity-60'
                                    )}
                                >
                                    <div className="relative">
                                        <img src={s.thumbnail} alt="" className="w-full h-[84px] object-cover" loading="lazy" />
                                        <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/75 text-white text-[9px] font-semibold">
                                            {formatViewers(s.viewers)} watching
                                        </span>
                                        {active && (
                                            <span className="absolute top-1 left-1 px-1 py-0.5 rounded bg-red-600 text-white text-[9px] font-bold">
                                                READING
                                            </span>
                                        )}
                                    </div>
                                    <p className="px-1.5 py-1 h-[34px] overflow-hidden text-[10px] leading-tight text-slate-700 line-clamp-2">
                                        {s.title || s.video_id}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

/* ═════════════════════════ main tab ═════════════════════════ */

export const YouTubeLiveTab = () => {
    const [channels, setChannels] = useState([]);
    const [selectedStreamId, setSelectedStreamId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [stats, setStats] = useState({ total: 0, political: 0, sentiment: { positive: 0, neutral: 0, negative: 0 }, live_streams: 0 });
    const [topAuthors, setTopAuthors] = useState([]);

    const [loading, setLoading] = useState(true);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [adding, setAdding] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [newChannel, setNewChannel] = useState('');

    const [sentimentFilter, setSentimentFilter] = useState('all');
    const [politicalOnly, setPoliticalOnly] = useState(false);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [paused, setPaused] = useState(false);
    const [switchingStream, setSwitchingStream] = useState(false);
    const [connected, setConnected] = useState(false);
    const [watchInterval, setWatchInterval] = useState(180);
    const [analysisModalMsg, setAnalysisModalMsg] = useState(null);

    const newIdsRef = useRef(new Set());
    const pausedRef = useRef(paused);
    const feedRef = useRef(null);
    const esRef = useRef(null);

    useEffect(() => { pausedRef.current = paused; }, [paused]);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 350);
        return () => clearTimeout(t);
    }, [search]);

    /* ─── data loading ─── */

    const loadChannels = useCallback(async () => {
        try {
            const res = await api.get('/youtube-live/channels');
            const list = res.data?.channels || [];
            setChannels(list);
            setSelectedStreamId((cur) => {
                if (cur && list.some((c) => c.id === cur)) return cur;
                return (list.find((c) => c.status === 'live') || list[0])?.id || null;
            });
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to load live channels');
        } finally {
            setLoading(false);
        }
    }, []);

    /*
     * Both loaders are scoped by videoId as well as streamId.
     *
     * stream_id identifies the CHANNEL, and a channel accumulates messages from
     * every broadcast it has ever run — so filtering on it alone returns the
     * same merged history no matter which stream is selected.
     */
    const loadStats = useCallback(async (streamId, videoId) => {
        try {
            const scope = { stream_id: streamId || undefined, video_id: videoId || undefined };
            const [s, a] = await Promise.all([
                api.get('/youtube-live/stats', { params: scope }),
                api.get('/youtube-live/top-authors', { params: { ...scope, limit: 8 } }),
            ]);
            setStats(s.data || {});
            setTopAuthors(a.data?.authors || []);
        } catch (_) { /* non-fatal */ }
    }, []);

    const loadMessages = useCallback(async (streamId, videoId) => {
        if (!streamId) { setMessages([]); return; }
        setMessagesLoading(true);
        try {
            const res = await api.get('/youtube-live/messages', {
                params: {
                    stream_id: streamId,
                    video_id: videoId || undefined,
                    sentiment: sentimentFilter !== 'all' ? sentimentFilter : undefined,
                    political: politicalOnly ? 'true' : undefined,
                    search: debouncedSearch.trim() || undefined,
                    limit: 150,
                },
            });
            setMessages(res.data?.messages || []);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to load chat messages');
        } finally {
            setMessagesLoading(false);
        }
    }, [sentimentFilter, politicalOnly, debouncedSearch]);

    /*
     * Which broadcast is on screen. Derived rather than stored so it follows
     * both a manual pick and the watcher swapping in a new broadcast, and so
     * the effect below refires when it changes.
     */
    const selectedVideoId = channels.find((c) => c.id === selectedStreamId)?.video_id || null;

    useEffect(() => { loadChannels(); }, [loadChannels]);

    useEffect(() => {
        api.get('/youtube-live/settings')
            .then((res) => setWatchInterval(res.data?.watch_interval_sec ?? 180))
            .catch(() => { /* keep the default */ });
    }, []);

    /**
     * How often tracked channels are checked for a NEW broadcast. Costs no
     * YouTube API quota (it reads the public channel page), but each tick is
     * one request per tracked channel, so slow it down as the list grows.
     */
    const handleWatchIntervalChange = async (seconds) => {
        const secs = Number(seconds);
        const prev = watchInterval;
        setWatchInterval(secs);
        try {
            await api.put('/youtube-live/settings', { watch_interval_sec: secs });
            toast.success(`Checking for new broadcasts every ${secs >= 60 ? `${secs / 60} min` : `${secs}s`}`);
        } catch (err) {
            setWatchInterval(prev);
            toast.error(err.response?.data?.message || 'Failed to update interval');
        }
    };

    useEffect(() => {
        loadMessages(selectedStreamId, selectedVideoId);
        loadStats(selectedStreamId, selectedVideoId);
    }, [selectedStreamId, selectedVideoId, loadMessages, loadStats]);

    /* ─── live feed (SSE) ─── */

    // Filters live in a ref so changing them never re-runs the SSE effect —
    // otherwise every keystroke in the search box would tear down and rebuild
    // the EventSource connection.
    const filtersRef = useRef({ sentimentFilter, politicalOnly, search, videoId: selectedVideoId });
    useEffect(() => {
        filtersRef.current = { sentimentFilter, politicalOnly, search, videoId: selectedVideoId };
    }, [sentimentFilter, politicalOnly, search, selectedVideoId]);

    const matchesFilters = useCallback((m) => {
        const { sentimentFilter: s, politicalOnly: p, search: q, videoId } = filtersRef.current;
        // The SSE stream is scoped to the channel, so a message from a different
        // broadcast of that channel can arrive mid-switch. Keep the feed to the
        // broadcast actually on screen.
        if (videoId && m.video_id && m.video_id !== videoId) return false;
        if (s !== 'all' && m.sentiment !== s) return false;
        if (p && !m.is_political) return false;
        if (q.trim() && !String(m.text || '').toLowerCase().includes(q.trim().toLowerCase())) return false;
        return true;
    }, []);

    useEffect(() => {
        if (!selectedStreamId) return undefined;

        const token = localStorage.getItem('token');
        if (!token) return undefined;

        const url = `${BACKEND_URL}/api/youtube-live/stream?token=${encodeURIComponent(token)}&stream_id=${encodeURIComponent(selectedStreamId)}`;
        const es = new EventSource(url);
        esRef.current = es;

        es.onopen = () => {
            setConnected(true);
            // A dropped connection (server restart/deploy, network blip) means
            // any 'message:update' that happened while disconnected is gone —
            // EventSource has no replay. Re-sync from the DB on every
            // (re)connect, including the first one, so a row can never be left
            // showing a stale Analyzing/pending state after the real result
            // already landed.
            loadMessages(selectedStreamId, filtersRef.current.videoId);
            loadStats(selectedStreamId, filtersRef.current.videoId);
        };
        es.onerror = () => setConnected(false);

        es.addEventListener('messages', (evt) => {
            if (pausedRef.current) return;
            try {
                const payload = JSON.parse(evt.data);
                const incoming = (payload.messages || []).filter(matchesFilters);
                if (!incoming.length) return;

                incoming.forEach((m) => newIdsRef.current.add(m.id));
                setTimeout(() => {
                    incoming.forEach((m) => newIdsRef.current.delete(m.id));
                }, 2000);

                setMessages((prev) => {
                    const seen = new Set(prev.map((p) => p.message_id));
                    const fresh = incoming.filter((m) => !seen.has(m.message_id));
                    if (!fresh.length) return prev;
                    return [...fresh.reverse(), ...prev].slice(0, MAX_FEED);
                });

                setStats((prev) => {
                    const next = { ...prev, sentiment: { ...prev.sentiment } };
                    next.total = (next.total || 0) + incoming.length;
                    incoming.forEach((m) => {
                        next.sentiment[m.sentiment] = (next.sentiment[m.sentiment] || 0) + 1;
                        if (m.is_political) next.political = (next.political || 0) + 1;
                    });
                    return next;
                });
            } catch (_) { /* ignore malformed frame */ }
        });

        // The LLM refines political messages a moment after insert — patch in place.
        es.addEventListener('message:update', (evt) => {
            try {
                const { message } = JSON.parse(evt.data);
                setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, ...message } : m)));
            } catch (_) { /* ignore */ }
        });

        es.addEventListener('stream:status', () => { loadChannels(); });

        // Authoritative totals after the LLM re-scores a batch; the optimistic
        // increment below would otherwise drift from the DB until a refresh.
        es.addEventListener('stream:counts', (evt) => {
            try {
                const p = JSON.parse(evt.data);
                if (p.video_id && p.video_id !== filtersRef.current.videoId) return;
                setStats((prev) => ({ ...prev, total: p.message_count, sentiment: p.sentiment_counts }));
            } catch (_) { /* ignore */ }
        });

        // Streams start and end while the tab is open, and viewer counts move —
        // patch the picker in place rather than refetching the channel list.
        es.addEventListener('stream:available', (evt) => {
            try {
                const { stream_id, available_streams } = JSON.parse(evt.data);
                setChannels((prev) => prev.map((c) => (
                    c.id === stream_id ? { ...c, available_streams } : c
                )));
            } catch (_) { /* ignore */ }
        });

        return () => {
            es.close();
            esRef.current = null;
            setConnected(false);
        };
    }, [selectedStreamId, matchesFilters, loadChannels]);

    /* ─── actions ─── */

    const handleAddChannel = async (e) => {
        e?.preventDefault();
        const value = newChannel.trim();
        if (!value) return;

        setAdding(true);
        try {
            const res = await api.post('/youtube-live/channels', { channel: value });
            toast.success(res.data?.message || 'Channel added');
            setNewChannel('');
            await loadChannels();
            if (res.data?.channel?.id) setSelectedStreamId(res.data.channel.id);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to add channel');
        } finally {
            setAdding(false);
        }
    };

    const handleRemove = async (channel) => {
        if (!window.confirm(`Remove ${channel.channel_name || channel.channel_ref} and delete its stored chat messages?`)) return;
        try {
            await api.delete(`/youtube-live/channels/${channel.id}`);
            toast.success('Channel removed');
            if (selectedStreamId === channel.id) setSelectedStreamId(null);
            await loadChannels();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to remove channel');
        }
    };

    /**
     * Per-channel pause. This is a real backend toggle, not a UI freeze:
     * `is_active: false` stops that channel's poller so its chat is no longer
     * read at all, while every other channel keeps running.
     */
    const handleToggleChannel = async (channel) => {
        const next = !channel.is_active;
        // optimistic — the poller stop/start is immediate server-side
        setChannels((prev) => prev.map((c) => (c.id === channel.id ? { ...c, is_active: next } : c)));
        try {
            await api.patch(`/youtube-live/channels/${channel.id}`, { is_active: next });
            toast.success(`${channel.channel_name || channel.channel_ref} ${next ? 'resumed' : 'paused'}`);
            if (next) await api.post(`/youtube-live/channels/${channel.id}/refresh`).catch(() => {});
            await loadChannels();
        } catch (err) {
            setChannels((prev) => prev.map((c) => (c.id === channel.id ? { ...c, is_active: !next } : c)));
            toast.error(err.response?.data?.message || 'Failed to update channel');
        }
    };

    /**
     * How often this channel's chat is read. 0 = follow YouTube's own pace
     * (~10s). Larger values cut total request volume when several channels are
     * being watched — safe, because the continuation is a cursor, so a slower
     * poll just returns more messages per read rather than losing any.
     */
    const handleIntervalChange = async (channel, seconds) => {
        const secs = Number(seconds);
        setChannels((prev) => prev.map((c) => (c.id === channel.id ? { ...c, poll_interval_sec: secs } : c)));
        try {
            await api.patch(`/youtube-live/channels/${channel.id}`, { poll_interval_sec: secs });
            toast.success(secs === 0 ? 'Following YouTube’s pace (~10s)' : `Reading every ${secs}s`);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to update interval');
            await loadChannels();
        }
    };

    /**
     * Switch which of the channel's concurrent broadcasts is being read.
     * The backend stops the old poller and starts one on the chosen video, so
     * the chat feed is reloaded from scratch rather than mixing two streams.
     */
    const handleSelectStream = async (videoId) => {
        if (!selectedStreamId) return;
        setSwitchingStream(true);
        try {
            const res = await api.post(`/youtube-live/channels/${selectedStreamId}/select-stream`, { video_id: videoId });
            const { channel: updated, applied, message } = res.data || {};
            if (updated) setChannels((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

            // Reload against what the backend actually switched to — the stream
            // can end between the click and the switch.
            const nextVideoId = updated?.video_id || videoId;
            setMessages([]);
            await Promise.all([
                loadMessages(selectedStreamId, nextVideoId),
                loadStats(selectedStreamId, nextVideoId),
            ]);
            (applied === false ? toast.warning : toast.success)(message || 'Now reading this stream');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to switch stream');
        } finally {
            setSwitchingStream(false);
        }
    };

    /** Reload everything shown in this tab. */
    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await Promise.all([
                loadChannels(),
                loadMessages(selectedStreamId, selectedVideoId),
                loadStats(selectedStreamId, selectedVideoId),
            ]);
        } finally {
            setRefreshing(false);
        }
    };

    const handleRefreshAll = async () => {
        setRefreshing(true);
        try {
            const res = await api.post('/youtube-live/refresh-all');
            setChannels(res.data?.channels || []);
            toast.success('Checked all channels for live broadcasts');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Refresh failed');
        } finally {
            setRefreshing(false);
        }
    };

    const selected = useMemo(
        () => channels.find((c) => c.id === selectedStreamId) || null,
        [channels, selectedStreamId]
    );

    const sentimentTotal = Math.max(
        1,
        (stats.sentiment?.positive || 0) + (stats.sentiment?.neutral ?? stats.sentiment?.moderate ?? 0) + (stats.sentiment?.negative || 0)
    );

    /* ─── render ─── */

    return (
        <div className="mx-2 mt-3 mb-6">
            {/* header */}
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-red-50 border border-red-200">
                        <Radio className="h-4 w-4 text-red-600" />
                        <span className="text-sm font-bold text-red-700">YouTube LIVE</span>
                    </div>
                    <span className="text-xs text-slate-500">
                        Live chat comments read in real time ·
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <span className={cn(
                        'inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold border',
                        connected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'
                    )}>
                        {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                        {connected ? 'Connected' : 'Disconnected'}
                    </span>
                    <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing} className="h-8 gap-1.5 text-xs">
                        {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Refresh
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleRefreshAll} disabled={refreshing} className="h-8 gap-1.5 text-xs">
                        <Radio className="h-3.5 w-3.5" />
                        Check for live
                    </Button>

                    <span
                        className="inline-flex items-center gap-1.5 h-8 px-2 rounded-md border border-slate-200 bg-white"
                        title="How often tracked channels are checked for a new broadcast. Uses no YouTube API quota."
                    >
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-[11px] text-slate-500">auto-check</span>
                        <select
                            value={watchInterval}
                            onChange={(e) => handleWatchIntervalChange(e.target.value)}
                            className="text-xs bg-transparent text-slate-700 font-medium cursor-pointer focus:outline-none"
                        >
                            <option value={60}>1 min</option>
                            <option value={180}>3 min</option>
                            <option value={300}>5 min</option>
                            <option value={600}>10 min</option>
                            <option value={1800}>30 min</option>
                            <option value={3600}>1 hour</option>
                        </select>
                    </span>
                </div>
            </div>

            {/* add channel */}
            <form onSubmit={handleAddChannel} className="flex items-center gap-2 mb-3">
                <div className="relative flex-1 max-w-lg">
                    <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                        value={newChannel}
                        onChange={(e) => setNewChannel(e.target.value)}
                        placeholder="Add a channel — @SakshiTV, UCxxxx…, or a youtube.com URL"
                        className="w-full h-9 pl-9 pr-3 text-sm rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400"
                    />
                </div>
                <Button type="submit" size="sm" disabled={adding || !newChannel.trim()} className="h-9 gap-1.5 bg-red-600 hover:bg-red-700 text-white">
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add Channel
                </Button>
            </form>

            <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr_260px] gap-3 items-start">
                {/* ── channels ── */}
                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                    <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
                        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                            Channels ({channels.length})
                        </h3>
                    </div>

                    {loading ? (
                        <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                    ) : channels.length === 0 ? (
                        <div className="p-6 text-center">
                            <Radio className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                            <p className="text-xs text-slate-500">No channels tracked yet.</p>
                            <p className="text-[11px] text-slate-400 mt-1">Add one above to start reading its live chat.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
                            {channels.map((ch) => {
                                const paused = ch.is_active === false;
                                const st = paused
                                    ? { label: 'PAUSED', className: 'bg-amber-100 text-amber-700', pulse: false }
                                    : (STATUS_CONFIG[ch.status] || STATUS_CONFIG.idle);
                                const isSel = ch.id === selectedStreamId;
                                return (
                                    // A div, not a button: this row contains its own link and
                                    // remove control, and nesting interactive elements inside a
                                    // <button> is invalid HTML.
                                    <div
                                        key={ch.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setSelectedStreamId(ch.id)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedStreamId(ch.id); } }}
                                        className={cn(
                                            'w-full text-left px-3 py-2.5 transition-colors cursor-pointer',
                                            isSel ? 'bg-red-50 border-l-2 border-l-red-500' : 'hover:bg-slate-50 border-l-2 border-l-transparent'
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide', st.className)}>
                                                        {st.pulse && <span className="inline-block h-1.5 w-1.5 rounded-full bg-white mr-1 animate-pulse" />}
                                                        {st.label}
                                                    </span>
                                                    <span className="text-xs font-semibold text-slate-900 truncate">
                                                        {ch.channel_name || ch.channel_ref}
                                                    </span>
                                                </div>
                                                {ch.video_title && (
                                                    <p className="text-[11px] text-slate-500 line-clamp-2 mt-1">{ch.video_title}</p>
                                                )}
                                                <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                                                    <span className="inline-flex items-center gap-0.5">
                                                        <MessageSquare className="h-2.5 w-2.5" />
                                                        {(ch.message_count || 0).toLocaleString()}
                                                    </span>
                                                    {ch.status === 'ended' && ch.ended_at && (
                                                        <span
                                                            className="inline-flex items-center gap-0.5 text-slate-500"
                                                            title={`Broadcast finished ${new Date(ch.ended_at).toLocaleString()}. Chat resumes automatically when this channel goes live again.`}
                                                        >
                                                            <Clock className="h-2.5 w-2.5" /> ended {timeAgo(ch.ended_at)}
                                                        </span>
                                                    )}
                                                    <span
                                                        className={cn(
                                                            'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 transition-colors',
                                                            (ch.poll_interval_sec ?? 0) > 0
                                                                ? 'bg-blue-50 border-blue-300 text-blue-700'
                                                                : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
                                                        )}
                                                        title="How often this channel's chat is read"
                                                    >
                                                        <Clock className="h-3 w-3" />
                                                        {/*
                                                          * stopPropagation lives on the <select> itself rather than a
                                                          * wrapper <span>: a click handler on a plain span is an
                                                          * accessibility violation, and suppressing that would mean
                                                          * naming a jsx-a11y rule, which craco.config.js does not load.
                                                          */}
                                                        <select
                                                            value={ch.poll_interval_sec ?? 0}
                                                            onClick={(e) => e.stopPropagation()}
                                                            onChange={(e) => handleIntervalChange(ch, e.target.value)}
                                                            className="text-[11px] font-semibold bg-transparent text-current cursor-pointer focus:outline-none"
                                                        >
                                                            <option value={0}>auto ~10s</option>
                                                            <option value={15}>15s</option>
                                                            <option value={30}>30s</option>
                                                            <option value={60}>1 min</option>
                                                            <option value={120}>2 min</option>
                                                            <option value={300}>5 min</option>
                                                        </select>
                                                    </span>
                                                    {ch.last_error && (
                                                        <span className="inline-flex items-center gap-0.5 text-amber-600" title={ch.last_error}>
                                                            <AlertTriangle className="h-2.5 w-2.5" /> error
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <span className="flex items-center gap-0.5 flex-shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); handleToggleChannel(ch); }}
                                                    className={cn(
                                                        'p-1 rounded',
                                                        paused
                                                            ? 'text-emerald-600 hover:bg-emerald-100'
                                                            : 'text-slate-400 hover:bg-slate-200 hover:text-slate-700'
                                                    )}
                                                    title={paused ? 'Resume reading this channel' : 'Pause reading this channel'}
                                                >
                                                    {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                                                </button>
                                                {ch.video_id && (
                                                    <a
                                                        href={`https://www.youtube.com/watch?v=${ch.video_id}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700"
                                                        title="Open on YouTube"
                                                    >
                                                        <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); handleRemove(ch); }}
                                                    className="p-1 rounded hover:bg-rose-100 text-slate-400 hover:text-rose-600"
                                                    title="Remove channel"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </button>
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ── stream + live chat ── */}
                <div className="space-y-3 min-w-0">
                    <LivePlayer
                        channel={selected}
                        onSelectStream={handleSelectStream}
                        switching={switchingStream}
                    />

                    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 min-w-0">
                                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide whitespace-nowrap">Live Chat</h3>
                                {selected && (
                                    <span className="text-[11px] text-slate-500 truncate">{selected.channel_name || selected.channel_ref}</span>
                                )}
                            </div>
                            <Button
                                size="sm"
                                variant={paused ? 'default' : 'outline'}
                                onClick={() => setPaused((p) => !p)}
                                className="h-7 gap-1 text-[11px]"
                                title="Freeze this view so new messages stop pushing the list down. Chat keeps being read and stored."
                            >
                                {paused ? <><Play className="h-3 w-3" /> Resume scroll</> : <><Pause className="h-3 w-3" /> Freeze view</>}
                            </Button>
                        </div>

                        {/* filters */}
                        <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2 flex-wrap">
                            <div className="relative flex-1 min-w-[150px]">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                                <input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search chat…"
                                    className="w-full h-7 pl-7 pr-2 text-xs rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-red-400"
                                />
                            </div>
                            {['all', 'positive', 'neutral', 'negative'].map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => setSentimentFilter(s)}
                                    className={cn(
                                        'px-2 py-1 rounded text-[11px] font-semibold border capitalize transition-colors',
                                        sentimentFilter === s
                                            ? (s === 'all' ? 'bg-slate-900 text-white border-slate-900' : SENTIMENT_CONFIG[s].chip.replace('50', '100'))
                                            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                    )}
                                >
                                    {s}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={() => setPoliticalOnly((p) => !p)}
                                className={cn(
                                    'px-2 py-1 rounded text-[11px] font-semibold border transition-colors',
                                    politicalOnly ? 'bg-violet-100 text-violet-700 border-violet-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                )}
                            >
                                Political only
                            </button>
                        </div>

                        <div ref={feedRef} className="max-h-[560px] overflow-y-auto">
                            {messagesLoading ? (
                                <div className="p-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
                            ) : !selected ? (
                                <div className="p-10 text-center text-sm text-slate-500">Select a channel to view its live chat.</div>
                            ) : messages.length === 0 ? (
                                <div className="p-10 text-center">
                                    <MessageSquare className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                                    <p className="text-sm font-medium text-slate-700">No chat messages yet</p>
                                    <p className="text-xs text-slate-500 mt-1">
                                        {selected.chat_disabled
                                            ? 'This broadcast has live chat turned off. The video still plays above — pick another stream to read chat.'
                                            : selected.status === 'live'
                                            ? 'Waiting for viewers to post — new comments appear here instantly.'
                                            : selected.status === 'ended'
                                                ? `This broadcast has ended${selected.ended_at ? ` (${timeAgo(selected.ended_at)})` : ''}. Chat is read again automatically the next time this channel goes live.`
                                                : 'This channel is not live right now. Chat is read automatically when it goes live.'}
                                    </p>
                                </div>
                            ) : (
                                messages.map((m) => (
                                    <MessageRow key={m.id || m.message_id} msg={m} isNew={newIdsRef.current.has(m.id)} onOpenAnalysis={setAnalysisModalMsg} />
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* ── analytics ── */}
                <div className="space-y-3">
                    <div className="bg-white rounded-lg border border-slate-200 p-3">
                        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Chat Sentiment</h3>
                        <div className="text-2xl font-bold text-slate-900">{(stats.total || 0).toLocaleString()}</div>
                        <div className="text-[11px] text-slate-500 mb-3">
                            messages analysed · {(stats.political || 0).toLocaleString()} political
                        </div>

                        <div className="flex h-2 rounded-full overflow-hidden bg-slate-100 mb-3">
                            {['positive', 'neutral', 'negative'].map((s) => (
                                <div
                                    key={s}
                                    className={SENTIMENT_CONFIG[s].bar}
                                    style={{ width: `${((stats.sentiment?.[s] || 0) / sentimentTotal) * 100}%` }}
                                />
                            ))}
                        </div>

                        {['positive', 'neutral', 'negative'].map((s) => (
                            <div key={s} className="flex items-center justify-between py-1">
                                <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                                    <span className={cn('h-2 w-2 rounded-full', SENTIMENT_CONFIG[s].dot)} />
                                    {SENTIMENT_CONFIG[s].label}
                                </span>
                                <span className="text-xs font-bold text-slate-900">
                                    {(stats.sentiment?.[s] || 0).toLocaleString()}
                                </span>
                            </div>
                        ))}
                    </div>

                    <div className="bg-white rounded-lg border border-slate-200 p-3">
                        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5" /> Top Participants
                        </h3>
                        {topAuthors.length === 0 ? (
                            <p className="text-[11px] text-slate-400">No data yet.</p>
                        ) : (
                            <div className="space-y-1.5">
                                {topAuthors.map((a) => (
                                    <div key={a._id} className="flex items-center gap-2">
                                        {a.photo ? (
                                            <img src={a.photo} alt="" className="h-6 w-6 rounded-full object-cover flex-shrink-0" loading="lazy" />
                                        ) : (
                                            <div className="h-6 w-6 rounded-full bg-slate-200 flex-shrink-0" />
                                        )}
                                        <span className="text-[11px] text-slate-700 truncate flex-1">{a._id}</span>
                                        {a.negative > 0 && (
                                            <span
                                                className="text-[10px] font-semibold text-rose-600 px-1 rounded bg-rose-50"
                                                title={`${a.negative} of this person's ${a.messages} messages are negative for ${BRAND.partyUnit}`}
                                            >
                                                {a.negative} neg
                                            </span>
                                        )}
                                        <span
                                            className="text-[11px] font-bold text-slate-900"
                                            title={`${a.messages} messages sent`}
                                        >
                                            {a.messages}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {analysisModalMsg && (
                <LiveChatAnalysisModal msg={analysisModalMsg} onClose={() => setAnalysisModalMsg(null)} />
            )}
        </div>
    );
};

export default YouTubeLiveTab;
