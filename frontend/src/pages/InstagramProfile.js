import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Instagram,
  ChevronRight,
  ArrowLeft,
  Grid3X3,
  Film,
  Loader2,
  Heart,
  MessageCircle,
  Play,
  ExternalLink,
  Shield,
  UserCheck,
  Globe,
  Lock,
  Tag,
  X,
  ChevronLeft,
  RefreshCw,
  Volume2,
  VolumeX,
  Eye,
  AlertCircle,
  Trash2,
  Clock,
} from 'lucide-react';
import api from '../lib/api';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { useInstagramCache } from '../contexts/InstagramCacheContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';
const DEFAULT_LIMIT = 18;

const proxyUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  if (rawUrl.startsWith('/') || rawUrl.startsWith(BACKEND_URL)) return rawUrl;
  if (
    rawUrl.includes('cdninstagram.com') ||
    rawUrl.includes('fbcdn.net') ||
    rawUrl.includes('instagram.') ||
    rawUrl.includes('scontent')
  ) {
    return `${BACKEND_URL}/api/media/stream?url=${encodeURIComponent(rawUrl)}`;
  }
  return rawUrl;
};

const formatCount = (num) => {
  if (!num) return '0';
  const n = Number(num);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
};

/* ─── Inline Video Player (with proxy fallback) ─── */
const MODES = ['proxy', 'direct', 'embed'];

const InlineVideoPlayer = ({ videoUrl, thumbnailUrl, embedUrl, contentUrl }) => {
  const [modeIdx, setModeIdx] = useState(0);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef(null);
  const retryRef = useRef(null);

  const mode = MODES[modeIdx];
  const proxiedUrl = useMemo(() => proxyUrl(videoUrl), [videoUrl]);
  const posterUrl = useMemo(() => proxyUrl(thumbnailUrl), [thumbnailUrl]);

  const nextMode = useCallback(() => {
    setModeIdx((prev) => (prev + 1 < MODES.length ? prev + 1 : prev));
  }, []);

  useEffect(() => () => clearTimeout(retryRef.current), []);
  useEffect(() => { setModeIdx(videoUrl ? 0 : 2); }, [videoUrl]);

  if (mode === 'proxy' || mode === 'direct') {
    const src = mode === 'proxy' ? proxiedUrl : videoUrl;
    return (
      <div className="relative w-full h-full bg-black flex items-center justify-center">
        <video
          ref={videoRef}
          key={mode}
          src={src}
          poster={posterUrl}
          controls
          playsInline
          muted={muted}
          autoPlay
          preload="metadata"
          controlsList="nodownload"
          referrerPolicy="no-referrer"
          className="w-full h-full object-contain"
          onError={() => {
            clearTimeout(retryRef.current);
            retryRef.current = setTimeout(() => nextMode(), 300);
          }}
        />
        <button
          className="absolute top-3 right-3 bg-black/50 rounded-full p-2 text-white hover:bg-black/70 z-10"
          onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    );
  }

  if (mode === 'embed' && embedUrl) {
    return (
      <iframe
        src={embedUrl}
        title="Instagram Reel"
        className="w-full h-full border-none"
        allowFullScreen
        allow="autoplay; encrypted-media"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 gap-3 p-6">
      <AlertCircle className="w-8 h-8 text-gray-400" />
      <p className="text-sm text-gray-500">Unable to play this reel.</p>
      {contentUrl && (
        <a
          href={contentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full text-white text-sm font-semibold"
        >
          <ExternalLink className="w-4 h-4" /> Watch on Instagram
        </a>
      )}
    </div>
  );
};

/* ─── Post Detail Modal ─────────────────────────── */
const PostModal = ({ item, profile, onClose, onPrev, onNext, hasPrev, hasNext }) => {
  // Keyboard navigation
  useEffect(() => {
    if (!item) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onPrev();
      if (e.key === 'ArrowRight' && hasNext) onNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [item, onClose, onPrev, onNext, hasPrev, hasNext]);

  // Prevent body scroll
  useEffect(() => {
    if (!item) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [item]);

  if (!item) return null;

  const videoMedia = item.media?.find((m) => m.type === 'video');
  const imageMedia = item.media?.find((m) => m.type === 'photo');
  const isVideo = !!videoMedia || (item.content_url && /instagram\.com\/(reel|p)\//i.test(item.content_url));

  // Prefer S3 URLs (permanent) over CDN URLs (may expire / get deleted)
  const directVideoUrl = videoMedia?.s3_url || videoMedia?.url || '';
  const imageUrl = imageMedia?.s3_url || imageMedia?.url || videoMedia?.s3_preview || videoMedia?.preview || videoMedia?.preview_image_url || imageMedia?.s3_preview || imageMedia?.preview || item.thumbnail_url || '';
  const thumbnailUrl = videoMedia?.s3_preview || videoMedia?.preview || videoMedia?.preview_image_url || imageMedia?.s3_url || imageMedia?.url || item.thumbnail_url || '';

  const embedUrl = item.content_url
    ? item.content_url.trim().replace(/\/$/, '') + '/embed/captioned/'
    : null;

  const engagement = item.engagement || {};
  const metrics = item.public_metrics || item.metrics || {};
  const likes = Number(engagement.likes || engagement.like_count || metrics.likes || item.like_count || 0);
  const comments = Number(engagement.comments || engagement.comment_count || metrics.comments || item.comment_count || 0);
  const views = Number(
    engagement.views || engagement.view_count || engagement.play_count ||
    metrics.views || metrics.view_count || item.view_count || item.video_view_count || 0
  );

  const dateStr = item.published_at || item.created_at || item.posted_at;
  const dateObj = dateStr ? new Date(dateStr) : null;
  const timeAgo = dateObj ? formatDistanceToNow(dateObj, { addSuffix: true }) : '';
  const fullDateTime = dateObj ? dateObj.toLocaleString() : '';

  const captionText = item.text || item.description || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Close button */}
      <button
        className="absolute top-4 right-4 z-50 text-white hover:text-gray-300 transition-colors"
        onClick={onClose}
      >
        <X className="w-7 h-7" />
      </button>

      {/* Prev / Next arrows */}
      {hasPrev && (
        <button
          className="absolute left-4 z-50 bg-white/90 hover:bg-white rounded-full p-2 shadow-lg transition-transform hover:scale-110"
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
        >
          <ChevronLeft className="w-5 h-5 text-gray-800" />
        </button>
      )}
      {hasNext && (
        <button
          className="absolute right-4 z-50 bg-white/90 hover:bg-white rounded-full p-2 shadow-lg transition-transform hover:scale-110"
          onClick={(e) => { e.stopPropagation(); onNext(); }}
        >
          <ChevronRight className="w-5 h-5 text-gray-800" />
        </button>
      )}

      {/* Modal Content */}
      <div
        className="relative z-40 bg-white rounded-sm shadow-2xl flex flex-col md:flex-row overflow-hidden"
        style={{ maxWidth: '950px', maxHeight: '90vh', width: '95vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Media */}
        <div className={cn(
          'bg-black flex items-center justify-center flex-shrink-0',
          isVideo ? 'md:w-[480px] w-full aspect-[9/16] md:aspect-auto md:max-h-[90vh]' : 'md:w-[480px] w-full aspect-square md:aspect-auto md:max-h-[90vh]'
        )}>
          {/* Deleted / Expired badge */}
          {item.is_deleted && (
            <div className="absolute top-3 left-3 z-30">
              <div className="bg-red-600/90 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-lg">
                <Trash2 className="w-3 h-3" />
                Deleted{item.deleted_at ? ` · ${new Date(item.deleted_at).toLocaleDateString()}` : ''}
              </div>
            </div>
          )}
          {item.is_expired && !item.is_deleted && (
            <div className="absolute top-3 left-3 z-30">
              <div className="bg-amber-500/90 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-lg">
                <Clock className="w-3 h-3" />
                Expired{item.expired_at ? ` · ${new Date(item.expired_at).toLocaleDateString()}` : ''}
              </div>
            </div>
          )}
          {isVideo ? (
            <InlineVideoPlayer
              videoUrl={directVideoUrl}
              thumbnailUrl={thumbnailUrl}
              embedUrl={embedUrl}
              contentUrl={item.content_url}
            />
          ) : (
            <img
              src={proxyUrl(imageUrl)}
              alt=""
              className="w-full h-full object-contain"
              onError={(e) => {
                if (e.target.src.includes('/api/media/stream')) {
                  e.target.src = imageUrl;
                }
              }}
            />
          )}
        </div>

        {/* Right: Details */}
        <div className="flex-1 flex flex-col min-w-0 md:w-[420px] max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-gray-200">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-600 p-[2px] flex-shrink-0">
              <div className="w-full h-full rounded-full border-[1.5px] border-white bg-gray-100 overflow-hidden">
                {profile?.profile_pic_url ? (
                  <img src={proxyUrl(profile.profile_pic_url)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gray-200" />
                )}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-gray-900 truncate">
                  {profile?.username || item.author_handle || 'user'}
                </span>
                {profile?.is_verified && <Shield className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
              </div>
              {item.location && <p className="text-xs text-gray-500 truncate">{item.location}</p>}
            </div>
            {item.content_url && (
              <a
                href={item.content_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                title="Open on Instagram"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>

          {/* Caption / comments area (scrollable) */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {captionText && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
                  {profile?.profile_pic_url ? (
                    <img src={proxyUrl(profile.profile_pic_url)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gray-200" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold mr-1.5">{profile?.username || item.author_handle || 'user'}</span>
                    <span className="text-gray-800 whitespace-pre-wrap break-words">{captionText}</span>
                  </p>
                  {timeAgo && <p className="text-xs text-gray-400 mt-1">{timeAgo}</p>}
                </div>
              </div>
            )}
          </div>

          {/* Engagement actions */}
          <div className="border-t border-gray-200 p-4 space-y-3">
            {/* Stats */}
            <div className="flex items-center gap-5 text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-gray-900">
                <Heart className="w-5 h-5" />
                {formatCount(likes)} likes
              </span>
              {views > 0 && (
                <span className="flex items-center gap-1 text-gray-500">
                  <Eye className="w-4 h-4" />
                  {formatCount(views)} views
                </span>
              )}
              {comments > 0 && (
                <span className="flex items-center gap-1 text-gray-500">
                  <MessageCircle className="w-4 h-4" />
                  {formatCount(comments)}
                </span>
              )}
            </div>
            {/* Timestamp */}
            {fullDateTime && (
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">{fullDateTime}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── Grid Thumbnail Card ───────────────────────── */
const GridCard = ({ content, onClick }) => {
  const videoMedia = content.media?.find((m) => m.type === 'video');
  const imageMedia = content.media?.find((m) => m.type === 'photo');

  // Prefer S3 URLs (permanent) over CDN URLs (may expire / get deleted)
  const thumbnailUrl =
    videoMedia?.s3_preview || videoMedia?.preview ||
    videoMedia?.preview_image_url ||
    imageMedia?.s3_preview || imageMedia?.preview ||
    imageMedia?.s3_url || imageMedia?.url ||
    content.thumbnail_url ||
    videoMedia?.s3_url || videoMedia?.url ||
    imageMedia?.url ||
    '';

  const isVideo = !!videoMedia || (content.content_url && /instagram\.com\/(reel|p)\//i.test(content.content_url));

  const engagement = content.engagement || {};
  const metrics = content.public_metrics || content.metrics || {};
  const likes = Number(engagement.likes || engagement.like_count || metrics.likes || content.like_count || 0);
  const comments = Number(engagement.comments || engagement.comment_count || metrics.comments || content.comment_count || 0);
  const views = Number(
    engagement.views || engagement.view_count || engagement.play_count ||
    metrics.views || metrics.view_count || content.view_count || content.video_view_count || 0
  );

  return (
    <div
      className="relative aspect-square bg-gray-100 cursor-pointer group overflow-hidden"
      onClick={onClick}
    >
      {thumbnailUrl ? (
        <img
          src={proxyUrl(thumbnailUrl)}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            if (e.target.src.includes('/api/media/stream')) {
              e.target.src = thumbnailUrl;
            }
          }}
        />
      ) : (
        <div className="w-full h-full bg-gray-50 flex items-center justify-center">
          <Instagram className="w-8 h-8 text-gray-300" />
        </div>
      )}

      {/* Video / Reel icon */}
      {isVideo && (
        <div className="absolute top-2.5 right-2.5 z-10">
          <Film className="w-5 h-5 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]" />
        </div>
      )}

      {/* Deleted / Expired badge */}
      {content.is_deleted && (
        <div className="absolute top-2 left-2 z-10">
          <div className="bg-red-600/90 backdrop-blur-sm text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Trash2 className="h-2.5 w-2.5" />
            Deleted
          </div>
        </div>
      )}
      {content.is_expired && !content.is_deleted && (
        <div className="absolute top-2 left-2 z-10">
          <div className="bg-amber-500/90 backdrop-blur-sm text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            Expired
          </div>
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-7 text-white">
        <div className="flex items-center gap-1.5 font-bold text-sm">
          <Heart className="w-5 h-5 fill-white" />
          {formatCount(likes)}
        </div>
        <div className="flex items-center gap-1.5 font-bold text-sm">
          <MessageCircle className="w-5 h-5 fill-white text-white" />
          {formatCount(comments)}
        </div>
        {views > 0 && isVideo && (
          <div className="flex items-center gap-1.5 font-bold text-sm">
            <Play className="w-4 h-4 fill-white" />
            {formatCount(views)}
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── Main Profile Page ─────────────────────────── */
const InstagramProfile = () => {
  const { sourceId } = useParams();
  const navigate = useNavigate();
  const cache = useInstagramCache();

  // Restore from cache on mount
  const cachedProfile = cache.getProfile(sourceId);
  const cachedContent = cache.getContent(sourceId, 'all');

  const [profile, setProfile] = useState(cachedProfile || null);
  const [content, setContent] = useState(cachedContent?.items || []);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(!cachedProfile);
  const [page, setPage] = useState(cachedContent?.page || 1);
  const [hasMore, setHasMore] = useState(cachedContent?.hasMore ?? true);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedIdx, setSelectedIdx] = useState(null);

  const loadingRef = useRef(false);
  const observerRef = useRef(null);

  // Load profile info (skip if cached)
  useEffect(() => {
    const cached = cache.getProfile(sourceId);
    if (cached) {
      setProfile(cached);
      setLoadingProfile(false);
      return;
    }
    const fetchProfile = async () => {
      setLoadingProfile(true);
      try {
        const res = await api.get(`/sources/${sourceId}/instagram-profile`);
        setProfile(res.data);
        cache.setProfile(sourceId, res.data);
      } catch (err) {
        console.error('Failed to load profile:', err);
        try {
          const srcRes = await api.get('/sources', { params: { platform: 'instagram' } });
          const list = Array.isArray(srcRes.data) ? srcRes.data : srcRes.data?.data || [];
          const found = list.find((s) => s.id === sourceId);
          if (found) {
            const fallback = {
              username: found.identifier,
              full_name: found.display_name,
              profile_pic_url: found.profile_image_url || '',
              followers_count: found.statistics?.subscriber_count || 0,
              following_count: 0,
              media_count: found.statistics?.video_count || 0,
              biography: '',
              is_verified: found.is_verified || false,
              external_url: '',
              category: found.category || '',
              is_private: false,
              _cached: true,
            };
            setProfile(fallback);
            cache.setProfile(sourceId, fallback);
          }
        } catch (_) {}
      } finally {
        setLoadingProfile(false);
      }
    };
    fetchProfile();
  }, [sourceId, cache]);

  // Save content to cache whenever it changes
  useEffect(() => {
    if (content.length > 0) {
      cache.setContent(sourceId, activeTab, content, page, hasMore);
    }
  }, [content, sourceId, activeTab, page, hasMore, cache]);

  // Load content
  const loadContent = useCallback(
    async (reset = false) => {
      if (loadingRef.current) return;
      if (!reset && !hasMore) return;

      loadingRef.current = true;
      setLoading(true);
      const pageToLoad = reset ? 1 : page;

      try {
        const params = {
          platform: 'instagram',
          source_id: sourceId,
          limit: DEFAULT_LIMIT,
          page: pageToLoad,
        };
        if (activeTab === 'reels') params.media_type = 'video';

        const res = await api.get('/content', { params });
        const items = Array.isArray(res.data) ? res.data : res.data?.items || [];

        let filteredItems = items;
        if (activeTab === 'reels') {
          filteredItems = items.filter((item) => item && item.media?.some((m) => m.type === 'video'));
        } else if (activeTab === 'posts') {
          filteredItems = items.filter(
            (item) => item && !item.media?.some((m) => m.type === 'video')
          );
        }

        if (reset) {
          setContent(filteredItems);
          setPage(2);
        } else {
          setContent((prev) => [...prev, ...filteredItems]);
          setPage((prev) => prev + 1);
        }
        setHasMore(items.length === DEFAULT_LIMIT);
      } catch (err) {
        console.error('Failed to load content:', err);
        toast.error('Failed to load content');
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [sourceId, page, hasMore, activeTab]
  );

  const handleManualScan = async () => {
    setScanning(true);
    try {
      const res = await api.post(`/sources/${sourceId}/scan`);
      toast.success(res.data.message || 'Scan completed.');
      // Refresh content
      loadContent(true);
    } catch (err) {
      console.error('Scan failed:', err);
      toast.error(err.response?.data?.message || 'Manual scan failed.');
    } finally {
      setScanning(false);
    }
  };

  // On tab change: restore from cache or fetch fresh
  useEffect(() => {
    const cached = cache.getContent(sourceId, activeTab);
    if (cached && cached.items.length > 0) {
      setContent(cached.items);
      setPage(cached.page);
      setHasMore(cached.hasMore);
    } else {
      setContent([]);
      setPage(1);
      setHasMore(true);
      loadContent(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, activeTab]);

  const lastElementRef = useCallback(
    (node) => {
      if (loading) return;
      if (observerRef.current) observerRef.current.disconnect();
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
          loadContent(false);
        }
      });
      if (node) observerRef.current.observe(node);
    },
    [loading, hasMore, loadContent]
  );

  if (loadingProfile) {
    return (
      <div className="flex items-center justify-center min-h-[400px] bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  const p = profile || {};

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-[935px] mx-auto px-5 pt-6 pb-12">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
          <Link to="/dashboard" className="hover:text-gray-700 transition-colors">Dashboard</Link>
          <ChevronRight className="h-3 w-3" />
          <Link to="/instagram-monitor" className="hover:text-gray-700 transition-colors">Instagram Monitor</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-gray-700 font-medium">@{p.username || p.handle || 'user'}</span>
        </div>

        {/* Back */}
        <button
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-8 transition-colors"
          onClick={() => navigate('/instagram-monitor')}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Monitor
        </button>

        {/* ─── Profile Header ─────────────────── */}
        <div className="flex flex-col md:flex-row items-center md:items-start gap-8 md:gap-16 mb-10">
          {/* Avatar */}
          <div className="flex-shrink-0">
            <div className="w-[150px] h-[150px] rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-600 p-[3px]">
              <div className="w-full h-full rounded-full border-[3px] border-white bg-gray-100 overflow-hidden">
                {p.profile_pic_url ? (
                  <img
                    src={proxyUrl(p.profile_pic_url)}
                    alt={p.username}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                    <Instagram className="w-14 h-14 text-gray-300" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 space-y-5 text-center md:text-left">
            {/* Username row */}
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <h1 className="text-xl font-normal tracking-wide text-gray-900">{p.username || p.handle || 'instagram_user'}</h1>
              {p.is_verified && (
                <Badge className="bg-blue-50 text-blue-600 border-blue-200 gap-1 text-xs">
                  <Shield className="w-3 h-3" /> Verified
                </Badge>
              )}
              {p.is_private && (
                <Badge className="bg-gray-100 text-gray-500 border-gray-200 gap-1 text-xs">
                  <Lock className="w-3 h-3" /> Private
                </Badge>
              )}
              <a
                href={`https://www.instagram.com/${p.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white px-5 py-1.5 rounded-lg transition-colors font-semibold"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View on Instagram
              </a>
              <button
                onClick={handleManualScan}
                disabled={scanning}
                className="inline-flex items-center gap-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 px-5 py-1.5 rounded-lg transition-colors font-semibold disabled:opacity-50"
              >
                {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {scanning ? 'Scanning...' : 'Scan Now'}
              </button>
            </div>

            {/* Stats */}
            <div className="flex items-center justify-center md:justify-start gap-10">
              <div>
                <span className="font-semibold text-lg text-gray-900">{formatCount(p.media_count)}</span>
                <span className="text-gray-500 ml-1.5 text-sm">posts</span>
              </div>
              <div>
                <span className="font-semibold text-lg text-gray-900">{formatCount(p.followers_count)}</span>
                <span className="text-gray-500 ml-1.5 text-sm">followers</span>
              </div>
              <div>
                <span className="font-semibold text-lg text-gray-900">{formatCount(p.following_count)}</span>
                <span className="text-gray-500 ml-1.5 text-sm">following</span>
              </div>
            </div>

            {/* Bio */}
            <div className="space-y-1.5">
              {p.full_name && <p className="font-semibold text-sm text-gray-900">{p.full_name}</p>}
              {p.category && p.category !== 'unknown' && (
                <p className="text-xs text-gray-400">{p.category}</p>
              )}
              {p.biography && (
                <p className="text-sm whitespace-pre-wrap leading-relaxed text-gray-700">{p.biography}</p>
              )}
              {p.external_url && (
                <a
                  href={p.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  <Globe className="w-3.5 h-3.5" />
                  {p.external_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              )}
            </div>

            {/* Mutual followers */}
            {p.mutual_followers && p.mutual_followers.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <UserCheck className="w-3.5 h-3.5" />
                <span>
                  Followed by{' '}
                  <span className="text-gray-700 font-medium">
                    {p.mutual_followers.slice(0, 3).join(', ')}
                  </span>
                  {p.mutual_followers_count > 3 && (
                    <span> + {p.mutual_followers_count - 3} more</span>
                  )}
                </span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-center md:justify-start gap-2 pt-1">
              <div className="bg-gray-100 text-gray-900 text-sm font-semibold px-6 py-1.5 rounded-lg border border-gray-200">
                Following
              </div>
              <div className="bg-gray-100 text-gray-900 text-sm font-semibold px-6 py-1.5 rounded-lg border border-gray-200">
                Message
              </div>
              <div className="bg-gray-100 text-gray-900 p-1.5 rounded-lg border border-gray-200">
                <UserCheck className="w-4 h-4" />
              </div>
            </div>
          </div>
        </div>

        {/* ─── Tabs ────────────────────────────── */}
        <div className="border-t border-gray-200">
          <div className="flex items-center justify-center gap-16">
            <button
              onClick={() => setActiveTab('all')}
              className={cn(
                'flex items-center gap-1.5 py-3 text-xs font-semibold uppercase tracking-[.1em] border-t-[1px] -mt-[1px] transition-colors',
                activeTab === 'all'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              )}
            >
              <Grid3X3 className="w-3 h-3" />
              Posts
            </button>
            <button
              onClick={() => setActiveTab('reels')}
              className={cn(
                'flex items-center gap-1.5 py-3 text-xs font-semibold uppercase tracking-[.1em] border-t-[1px] -mt-[1px] transition-colors',
                activeTab === 'reels'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              )}
            >
              <Film className="w-3 h-3" />
              Reels
            </button>
            <button
              onClick={() => setActiveTab('tagged')}
              className={cn(
                'flex items-center gap-1.5 py-3 text-xs font-semibold uppercase tracking-[.1em] border-t-[1px] -mt-[1px] transition-colors',
                activeTab === 'tagged'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              )}
              disabled
            >
              <Tag className="w-3 h-3" />
              Tagged
            </button>
          </div>
        </div>

        {/* ─── Content Grid ────────────────────── */}
        {content.length > 0 ? (
          <div className="grid grid-cols-3 gap-1 mt-[3px]">
            {content.map((item, idx) => (
              <GridCard
                key={item.id || item.content_id || idx}
                content={item}
                onClick={() => setSelectedIdx(idx)}
              />
            ))}
          </div>
        ) : !loading ? (
          <div className="text-center py-24 text-gray-400">
            <Instagram className="h-16 w-16 mx-auto mb-4 text-gray-200" />
            <h3 className="text-lg font-semibold text-gray-600 mb-1">No posts yet</h3>
            <p className="text-sm">No content has been collected from this account yet.</p>
          </div>
        ) : null}

        {/* Infinite scroll trigger */}
        {hasMore && (
          <div ref={lastElementRef} className="py-10 flex items-center justify-center min-h-[80px]">
            {loading && (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-7 w-7 animate-spin text-gray-400" />
                <p className="text-xs text-gray-400">Loading more posts...</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Post Detail Modal */}
      {selectedIdx !== null && content[selectedIdx] && (
        <PostModal
          item={content[selectedIdx]}
          profile={p}
          onClose={() => setSelectedIdx(null)}
          onPrev={() => setSelectedIdx((i) => Math.max(0, i - 1))}
          onNext={() => setSelectedIdx((i) => Math.min(content.length - 1, i + 1))}
          hasPrev={selectedIdx > 0}
          hasNext={selectedIdx < content.length - 1}
        />
      )}
    </div>
  );
};

export default InstagramProfile;
