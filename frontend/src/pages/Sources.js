import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import {
  Plus, Trash2, Youtube, Twitter, Instagram, Facebook,
  ExternalLink, Play, Pause, RefreshCw, Search, Clock,
  CheckCircle, AlertCircle, X, ArrowLeft, Calendar,
  ChevronLeft, ChevronRight, Globe, Activity, BarChart2,
  Users, FileText, ShieldAlert, ShieldCheck, ChevronDown, Loader2,
  Filter, Eye, User, MessageSquare, ThumbsUp, MessageCircle,
  Circle, Share2, Zap, Pencil, LayoutGrid, PlayCircle
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Separator } from '../components/ui/separator';
import { ScrollArea } from '../components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { cn } from '../lib/utils';
import { Progress } from '../components/ui/progress';
import { TwitterAlertCard } from '../components/AlertCards';
import InstagramReelCard from '../components/InstagramReelCard';
import StoryViewer from '../components/StoryViewer';
import AddSourceModal from '../components/AddSourceModal';
import { VideoModal } from '../components/YoutubeVideoModal';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

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

const buildMediaCandidates = (urls = []) => {
  const candidates = [];
  urls
    .filter((url) => typeof url === 'string' && url.trim())
    .forEach((url) => {
      const trimmed = url.trim();
      const proxied = proxyUrl(trimmed);
      if (proxied && !candidates.includes(proxied)) candidates.push(proxied);
      if (trimmed && proxied !== trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
    });
  return candidates;
};

const INSTAGRAM_VIDEO_EXT_RE = /\.(mp4|webm|m3u8|mov)(\?|$)/i;

const normalizeInstagramHandle = (value) => {
  if (!value || typeof value !== 'string') return '';
  let handle = value.trim();
  if (!handle) return '';
  if (handle.includes('instagram.com/')) {
    try {
      const normalized = handle.startsWith('http') ? handle : `https://${handle}`;
      const parsed = new URL(normalized);
      const firstPathPart = parsed.pathname.split('/').filter(Boolean)[0];
      handle = firstPathPart || handle;
    } catch (_) { }
  }
  return handle.replace(/^@/, '').toLowerCase();
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const pickStoryVideoVariantUrl = (variants = []) => {
  const normalized = variants
    .map((variant) => {
      if (typeof variant === 'string') return { url: variant };
      if (!variant || typeof variant !== 'object') return null;
      return {
        ...variant,
        url: variant.url || variant.src,
        contentType: variant.content_type || variant.mime_type || variant.type || ''
      };
    })
    .filter((variant) => typeof variant?.url === 'string' && variant.url.trim());

  if (!normalized.length) return null;
  const mp4Variants = normalized.filter((variant) => {
    const contentType = String(variant.contentType || '').toLowerCase();
    return !contentType || contentType.includes('mp4');
  });
  const sortable = mp4Variants.length > 0 ? mp4Variants : normalized;
  sortable.sort((a, b) => Number(b.bitrate || b.bandwidth || 0) - Number(a.bitrate || a.bandwidth || 0));
  return sortable[0]?.url || null;
};

const normalizeStoryMediaItem = (item) => {
  if (!item) return null;
  if (typeof item === 'string') return { url: item };
  return item?.node || item?.media || item?.story || item?.item || item;
};

const StoryTileMedia = React.memo(({ story, storyKey, isExpired, timeLeftHours, onOpenStory }) => {
  const tileRef = useRef(null);
  const videoRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [videoIdx, setVideoIdx] = useState(0);
  const [imageIdx, setImageIdx] = useState(0);
  const [isTileMuted, setIsTileMuted] = useState(true);
  const [isTilePaused, setIsTilePaused] = useState(false);

  const mediaItems = useMemo(() => {
    return asArray(story?.media)
      .map(normalizeStoryMediaItem)
      .filter(Boolean);
  }, [story?.media]);

  const handleStoryOpen = useCallback(() => {
    if (typeof onOpenStory === 'function') onOpenStory();
  }, [onOpenStory]);

  const videoCandidates = useMemo(() => {
    const videoRaw = [];
    mediaItems.forEach((mediaItem) => {
      if (mediaItem?.s3_url && (String(mediaItem?.type || '').toLowerCase() === 'video' || INSTAGRAM_VIDEO_EXT_RE.test(mediaItem.s3_url))) {
        videoRaw.push(mediaItem.s3_url);
      }
    });
    if (story?.s3_url && story?.media_type === 'video') {
      videoRaw.push(story.s3_url);
    }

    mediaItems.forEach((mediaItem) => {
      if (typeof mediaItem?.url === 'string' && INSTAGRAM_VIDEO_EXT_RE.test(mediaItem.url)) {
        videoRaw.push(mediaItem.url);
      }
      const mediaType = String(mediaItem?.type || mediaItem?.media_type || '').toLowerCase();
      const versionUrls = [
        ...asArray(mediaItem?.video_versions),
        ...asArray(mediaItem?.videoVersions)
      ];
      const bestVariant = pickStoryVideoVariantUrl(versionUrls);
      const directVideo = mediaItem?.video_url || mediaItem?.videoUrl;
      const isVideoMedia = mediaType === 'video' || mediaType === 'animated_gif' || mediaType === '2' || mediaItem?.is_video || !!bestVariant || !!directVideo;

      if (isVideoMedia) {
        videoRaw.push(
          directVideo,
          bestVariant,
          ...versionUrls.map((variant) => (typeof variant === 'string' ? variant : variant?.url || variant?.src))
        );
      }
    });

    const storyLevelVariants = [
      ...asArray(story?.video_versions),
      ...asArray(story?.videoVersions)
    ];
    videoRaw.push(
      story?.video_url,
      story?.videoUrl,
      pickStoryVideoVariantUrl(storyLevelVariants),
      ...storyLevelVariants.map((variant) => (typeof variant === 'string' ? variant : variant?.url || variant?.src))
    );

    return buildMediaCandidates(videoRaw);
  }, [mediaItems, story?.video_url, story?.videoUrl, story?.video_versions, story?.videoVersions]);

  const imageCandidates = useMemo(() => {
    const imageRaw = [];
    mediaItems.forEach((mediaItem) => {
      if (mediaItem?.s3_url && String(mediaItem?.type || '').toLowerCase() !== 'video') {
        imageRaw.push(mediaItem.s3_url);
      }
      if (mediaItem?.s3_preview) {
        imageRaw.push(mediaItem.s3_preview);
      }
    });
    if (story?.s3_url && story?.media_type !== 'video') {
      imageRaw.push(story.s3_url);
    }
    if (story?.s3_thumbnail_url) {
      imageRaw.push(story.s3_thumbnail_url);
    }

    mediaItems.forEach((mediaItem) => {
      const mediaType = String(mediaItem?.type || mediaItem?.media_type || '').toLowerCase();
      const imageVersions = [
        ...asArray(mediaItem?.image_versions2?.candidates),
        ...asArray(mediaItem?.image_versions),
        ...asArray(mediaItem?.display_resources)
      ];
      if (typeof mediaItem?.url === 'string' && (!INSTAGRAM_VIDEO_EXT_RE.test(mediaItem.url) || mediaType === 'photo')) {
        imageRaw.push(mediaItem.url);
      }
      imageRaw.push(
        mediaItem?.preview,
        mediaItem?.preview_image_url,
        mediaItem?.thumbnail_url,
        mediaItem?.thumbnail_src,
        mediaItem?.display_url,
        mediaItem?.image_url,
        mediaItem?.cover_frame_url,
        ...imageVersions.map((version) => version?.url || version?.src)
      );
    });

    imageRaw.push(
      story?.preview,
      story?.preview_image_url,
      story?.thumbnail_url,
      story?.thumbnail_src,
      story?.display_url,
      story?.image_url,
      ...asArray(story?.image_versions2?.candidates).map((candidate) => candidate?.url),
      ...asArray(story?.image_versions).map((candidate) => candidate?.url),
      ...asArray(story?.display_resources).map((resource) => resource?.src)
    );

    return buildMediaCandidates(imageRaw);
  }, [mediaItems, story]);

  const activeVideoSrc = videoCandidates[videoIdx] || null;
  const activeImageSrc = imageCandidates[imageIdx] || null;
  const hasVideoSource = !!activeVideoSrc && videoIdx < videoCandidates.length;

  useEffect(() => {
    setVideoIdx(0);
    setImageIdx(0);
    setIsTileMuted(true);
    setIsTilePaused(false);
  }, [storyKey]);

  useEffect(() => {
    if (!tileRef.current) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        setIsVisible(entries[0]?.isIntersecting ?? false);
      },
      { threshold: 0.45 }
    );
    observer.observe(tileRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = videoRef.current;
    if (!node) return;
    if (isVisible && !isTilePaused) {
      node.play().catch(() => { });
      return;
    }
    node.pause();
    node.currentTime = 0;
  }, [isVisible, hasVideoSource, videoIdx, isTilePaused]);

  return (
    <div
      ref={tileRef}
      className="relative aspect-[9/16] rounded-lg overflow-hidden bg-gray-100 cursor-pointer"
      onClick={handleStoryOpen}
      role="button"
      tabIndex={0}
    >
      {hasVideoSource ? (
        <video
          ref={videoRef}
          key={`${storyKey}-${videoIdx}`}
          src={activeVideoSrc}
          className="w-full h-full object-cover"
          muted={isTileMuted}
          loop
          playsInline
          autoPlay={isVisible && !isTilePaused}
          preload="metadata"
          onError={() => setVideoIdx((prev) => prev + 1)}
        />
      ) : activeImageSrc ? (
        <img
          src={activeImageSrc}
          alt="Story"
          className="w-full h-full object-cover"
          onError={() => setImageIdx((prev) => prev + 1)}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-purple-100 to-pink-100 px-3 text-center">
          <ExternalLink className="h-7 w-7 text-purple-500" />
          <p className="text-xs font-semibold text-purple-700">Media unavailable</p>
        </div>
      )}

      {hasVideoSource && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5">
          <button
            type="button"
            className="bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80 transition-colors"
            onClick={(e) => { e.stopPropagation(); setIsTileMuted((prev) => !prev); }}
          >
            {isTileMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          </button>
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="absolute bottom-2 left-2 right-2">
          <p className="text-white text-xs font-medium truncate">
            {story.author || story.author_handle || 'Instagram User'}
          </p>
          {timeLeftHours && <p className="text-white/70 text-[10px]">{timeLeftHours}h left</p>}
        </div>
      </div>
    </div>
  );
});

const StoryGridTile = React.memo(({ story, storySource, onOpenStory }) => {
  const storyKey = String(story?.id || story?.content_id || story?.content_url || `${story?.author_handle || 'unknown'}__${story?.published_at || 'na'}`);
  const isViewed = story?.viewed === true;

  const getStoryExpiration = (story) => {
    if (!story) return { expiresAt: null, isExpired: false, timeLeftHours: null };
    const expiresAt = story.scraped_content?.includes('expires:')
      ? new Date(story.scraped_content.split('expires:')[1].trim())
      : story.published_at
        ? new Date(new Date(story.published_at).getTime() + 24 * 60 * 60 * 1000)
        : null;

    if (!expiresAt) return { expiresAt: null, isExpired: false, timeLeftHours: null };
    const now = new Date();
    const isExpired = now > expiresAt;
    const timeLeftHours = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)));
    return { expiresAt, isExpired, timeLeftHours };
  };

  const { isExpired, timeLeftHours } = getStoryExpiration(story);

  return (
    <div className={cn("relative group cursor-pointer transition-transform hover:scale-[1.02]", isExpired && "opacity-40 pointer-events-none")}>
      <div className={cn(
        "p-[3px] rounded-2xl transition-all",
        isExpired ? "bg-gray-300" : isViewed ? "bg-gray-300" : "bg-gradient-to-tr from-[#FCAF45] via-[#E1306C] to-[#833AB4]"
      )}>
        <div className="bg-white dark:bg-gray-900 p-[2px] rounded-[14px]">
          <StoryTileMedia story={story} storyKey={storyKey} isExpired={isExpired} timeLeftHours={timeLeftHours} onOpenStory={() => onOpenStory(story, storySource)} />
        </div>
      </div>
      <div className="mt-2 text-center">
        <p className={cn("text-xs font-medium truncate", isViewed ? "text-muted-foreground" : "text-foreground")}>
          @{(story.author_handle || storySource?.handle || 'unknown').replace('@', '')}
        </p>
        {!isExpired && timeLeftHours > 0 && (
          <p className="text-[10px] text-pink-500 font-medium">{timeLeftHours}h left</p>
        )}
      </div>
    </div>
  );
});

const Volume2 = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>;
const VolumeX = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>;

// ─── Platform Config ────────────────────────────────────────
const PLATFORMS = [
  { value: 'x', label: 'X (Twitter)', icon: Twitter, color: 'text-slate-800', gradient: 'from-slate-800 to-slate-600', hoverBg: 'hover:bg-slate-100 hover:border-slate-300', activeBg: 'bg-slate-900 text-white border-slate-900' },
  { value: 'instagram', label: 'Instagram', icon: Instagram, color: 'text-pink-500', gradient: 'from-purple-600 to-pink-500', hoverBg: 'hover:bg-pink-50 hover:text-pink-600 hover:border-pink-200', activeBg: 'bg-gradient-to-r from-purple-600 to-pink-600 text-white border-pink-600' },
  { value: 'facebook', label: 'Facebook', icon: Facebook, color: 'text-blue-600', gradient: 'from-blue-600 to-cyan-500', hoverBg: 'hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200', activeBg: 'bg-blue-600 text-white border-blue-600' },
  { value: 'youtube', label: 'YouTube', icon: Youtube, color: 'text-red-500', gradient: 'from-red-600 to-orange-500', hoverBg: 'hover:bg-red-50 hover:text-red-600 hover:border-red-200', activeBg: 'bg-red-600 text-white border-red-600' },
];

const CATEGORY_OPTIONS = [
  { value: 'political', label: 'Political' }, { value: 'communal', label: 'Communal' },
  { value: 'trouble_makers', label: 'Trouble Makers' }, { value: 'defamation', label: 'Defamation' },
  { value: 'narcotics', label: 'Narcotics' }, { value: 'history_sheeters', label: 'History Sheeters' },
  { value: 'others', label: 'Others' }
];

const MetricCard = ({ label, value, icon: Icon, color, onClick }) => (
  <div
    className={cn(
      "flex items-center gap-3 px-5 py-4 bg-white rounded-xl border border-slate-200/80 shadow-sm transition-all duration-200",
      onClick ? "cursor-pointer hover:shadow-md hover:border-slate-300 active:scale-[0.98]" : ""
    )}
    onClick={onClick}
  >
    <div className={`p-2.5 rounded-lg ${color}`}><Icon className="h-4.5 w-4.5 text-white" strokeWidth={2} /></div>
    <div>
      <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider leading-none mb-1">{label}</p>
      <p className="text-xl font-bold text-slate-800 leading-none">{value}</p>
    </div>
  </div>
);

const RiskBadge = ({ level, score }) => {
  const l = (level || '').toString().toLowerCase();
  const cls = l === 'high' || l === 'critical' ? 'bg-red-100 text-red-700 border-red-200' : l === 'medium' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200';
  return <Badge variant="outline" className={`text-[10px] font-bold uppercase ${cls}`}>{level}{score != null ? ` (${score})` : ''}</Badge>;
};

const Sources = () => {
  const navigate = useNavigate();
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('x');
  const [sourceTypeFilter, setSourceTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [editingSource, setEditingSource] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState([]);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const itemsPerPage = 20;

  // ─── Selected Source Detail View State ──────────────────────
  const [selectedSource, setSelectedSource] = useState(null);
  const [contentItems, setContentItems] = useState([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentHasMore, setContentHasMore] = useState(false);
  const [contentPage, setContentPage] = useState(1);
  const [escalationStats, setEscalationStats] = useState({ escalated: 0, sentToIntermediary: 0, closed: 0, loading: false });
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoComments, setVideoComments] = useState([]);
  const [videoCommentsLoading, setVideoCommentsLoading] = useState(false);
  const [showThreatsOnly, setShowThreatsOnly] = useState(false);
  const [instagramStories, setInstagramStories] = useState([]);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [selectedContentTab, setSelectedContentTab] = useState('content');
  const [contentStats, setContentStats] = useState({ total: 0, high: 0, medium: 0, loading: false });
  const selectedSourceRef = useRef(null);


  useEffect(() => { fetchSources(); }, [categoryFilter]);
  useEffect(() => { setSelectedSourceIds(prev => prev.filter(id => sources.some(s => s.id === id))); }, [sources]);

  // When selectedSource changes, fetch its content
  useEffect(() => {
    selectedSourceRef.current = selectedSource;
    if (selectedSource) {
      setSelectedContentTab('content');
      fetchSourceContent(1, true);
      fetchEscalationStats(selectedSource.identifier);
      if (selectedSource.platform === 'instagram') {
        fetchInstagramStories(selectedSource.id);
      }
      window.scrollTo(0, 0);
    }
  }, [selectedSource]);

  // ─── API Handlers ───────────────────────────────────────────
  const fetchSources = async (showRefreshState = false) => {
    try {
      if (showRefreshState) setIsRefreshing(true); else setLoading(true);
      const params = {};
      if (categoryFilter !== 'all') params.category = categoryFilter;
      const response = await api.get('/sources', { params });
      setSources(response.data);
    } catch (error) { toast.error('Failed to load sources'); }
    finally { setLoading(false); setIsRefreshing(false); }
  };

  const fetchSourceContent = async (pageNum = 1, reset = false) => {
    if (!selectedSourceRef.current) return;
    setContentLoading(true);
    try {
      const limit = 25;
      const src = selectedSourceRef.current;
      const res = await api.get(`/content?platform=${src.platform}&source_id=${src.id}&page=${pageNum}&limit=${limit}`);
      const items = Array.isArray(res.data) ? res.data : (res.data.content || res.data.items || []);
      if (reset) setContentItems(items); else setContentItems(prev => [...prev, ...items]);
      setContentHasMore(items.length === limit);
      setContentPage(pageNum);
    } catch (error) { console.error('Failed to fetch content:', error); }
    finally { setContentLoading(false); }
  };

  const fetchEscalationStats = async (handle) => {
    if (!handle) return;
    setEscalationStats(prev => ({ ...prev, loading: true }));
    try {
      const res = await api.get(`/reports?search=${encodeURIComponent(handle)}`);
      const reports = res.data || [];
      setEscalationStats({
        escalated: reports.length,
        sentToIntermediary: reports.filter(r => ['sent', 'sent_to_intermediary', 'awaiting_reply'].includes(r.status)).length,
        closed: reports.filter(r => ['closed', 'resolved'].includes(r.status)).length,
        loading: false
      });
    } catch (error) { setEscalationStats(prev => ({ ...prev, loading: false })); }
  };


  const handleDelete = async (id) => {
    // Optimistic update
    const previousSources = [...sources];
    setSources(prev => prev.filter(s => s.id !== id));
    setSelectedSourceIds(prev => prev.filter(sid => sid !== id));
    setDeleteConfirmId(null);
    if (selectedSource?.id === id) setSelectedSource(null);

    try {
      await api.delete(`/sources/${id}`);
      toast.success('Source removed');
      fetchSources(true);
    } catch (error) {
      toast.error('Failed to delete source');
      setSources(previousSources); // Revert on failure
    }
  };

  const handleToggleActive = async (source) => {
    // Optimistic update
    const previousSources = [...sources];
    setSources(prev => prev.map(s => s.id === source.id ? { ...s, is_active: !s.is_active } : s));

    try {
      await api.put(`/sources/${source.id}`, { ...source, is_active: !source.is_active });
      toast.success(source.is_active ? 'Monitoring paused' : 'Monitoring resumed');
      fetchSources(true);
    } catch (error) {
      toast.error('Failed to update source status');
      setSources(previousSources); // Revert on failure
    }
  };

  const handleManualCheck = async (id) => {
    try { toast.info('Initiating manual check...'); await api.post(`/sources/${id}/check`); toast.success('Manual check completed'); fetchSources(true); }
    catch (error) { toast.error('Failed to perform manual check'); }
  };

  const handleScanNow = async (id) => {
    try { toast.info('Starting external API scan...'); const res = await api.post(`/sources/${id}/scan`); toast.success(res.data.message || 'Scan completed.'); fetchSources(true); }
    catch (error) { toast.error('Scan failed', { description: error.response?.data?.message || 'API limit or network error' }); }
  };

  const handleEditSource = async (source) => {
    try {
      const poiRes = await api.get(`/poi/by-source/${source.id}?handle=${encodeURIComponent(source.identifier)}&platform=${source.platform}`);
      setEditingSource({ ...source, poiData: poiRes.data });
      setIsAddModalOpen(true);
    } catch (error) {
      console.error('Failed to fetch linked POI:', error);
      // Even if POI fetch fails, we can still edit source basic info, but it might create a new POI on save.
      // However, it's better to show a warning or just open with empty poiData.
      setEditingSource({ ...source, poiData: {} });
      setIsAddModalOpen(true);
      toast.warning('Linked POI profile details could not be fully loaded');
    }
  };

  const fetchPlatformStats = async () => {
    if (platformFilter === 'all') return;
    setContentStats(prev => ({ ...prev, loading: true }));
    try {
      const res = await api.get(`/content/stats?platform=${platformFilter}`);
      setContentStats({
        total: res.data.totalTweets || 0,
        high: (res.data.highRisk || 0) + (res.data.criticalRisk || 0),
        medium: res.data.mediumRisk || 0,
        loading: false
      });
    } catch (e) {
      console.error('Failed to fetch platform stats:', e);
      setContentStats(prev => ({ ...prev, loading: false }));
    }
  };

  const toggleAllPlatformSources = async (isActive) => {
    const targets = filteredSources;
    if (!targets.length) return;

    // Optimistic update
    const previousSources = [...sources];
    const targetIds = new Set(targets.map(t => t.id));
    setSources(prev => prev.map(s => targetIds.has(s.id) ? { ...s, is_active: isActive } : s));

    toast.promise(Promise.all(targets.map(s => api.put(`/sources/${s.id}`, { ...s, is_active: isActive }))), {
      loading: `${isActive ? 'Resuming' : 'Pausing'} ${targets.length} sources...`,
      success: () => {
        fetchSources(true);
        return `${isActive ? 'Resumed' : 'Paused'} ${targets.length} sources`;
      },
      error: () => {
        setSources(previousSources); // Revert on failure
        return 'Failed to update sources';
      }
    });
  };

  const handleBulkDelete = async () => {
    if (!selectedSourceIds.length) return;
    const previousSources = [...sources];
    const deletingIds = new Set(selectedSourceIds);

    // Optimistic update
    setSources(prev => prev.filter(s => !deletingIds.has(s.id)));
    setSelectedSourceIds([]);
    setIsBulkDeleteOpen(false);

    try {
      await Promise.all(Array.from(deletingIds).map(id => api.delete(`/sources/${id}`)));
      toast.success(`Deleted ${deletingIds.size} source(s)`);
      fetchSources(true);
    } catch (error) {
      toast.error('Failed to delete selected sources');
      setSources(previousSources); // Revert on failure
    }
  };

  // ─── Helpers ────────────────────────────────────────────────

  const getSourceLink = (source) => {
    switch (source.platform) {
      case 'youtube': return source.identifier.startsWith('@') ? `https://youtube.com/${source.identifier}` : `https://youtube.com/channel/${source.identifier}`;
      case 'x': return `https://x.com/${source.identifier.replace('@', '')}`;
      case 'instagram': return `https://instagram.com/${source.identifier.replace('@', '')}`;
      case 'facebook': return `https://facebook.com/${source.identifier.replace('@', '')}`;
      default: return '#';
    }
  };

  const getPlatformIcon = (platform, size = "h-4 w-4") => {
    switch (platform) {
      case 'youtube': return <Youtube className={`${size} text-red-500`} />;
      case 'x': return <Twitter className={`${size} text-slate-800`} />;
      case 'instagram': return <Instagram className={`${size} text-pink-500`} />;
      case 'facebook': return <Facebook className={`${size} text-blue-600`} />;
      default: return <Globe className={`${size}`} />;
    }
  };

  const getPlatformGradient = (platform) => (PLATFORMS.find(p => p.value === platform)?.gradient || 'from-blue-600 to-cyan-500');

  const getContentLabel = (platform) => {
    switch (platform) { case 'youtube': return 'Videos'; case 'x': return 'Tweets'; case 'instagram': return 'Posts'; case 'facebook': return 'Posts'; default: return 'Content'; }
  };

  const getPlatformViewLabel = (platform) => {
    switch (platform) { case 'youtube': return 'View on YouTube'; case 'x': return 'View on X'; case 'instagram': return 'View on Instagram'; case 'facebook': return 'View on Facebook'; default: return 'View Profile'; }
  };

  const formatIST = (dateStr) => { try { return format(new Date(dateStr), 'd MMM yyyy, h:mm a'); } catch { return 'N/A'; } };

  const formatNumber = (num) => {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const fetchInstagramStories = async (sourceId) => {
    setStoriesLoading(true);
    try {
      const res = await api.get(`/content?platform=instagram&content_type=story&source_id=${sourceId}&limit=50`);
      const data = Array.isArray(res.data) ? res.data : (res.data.content || res.data.items || []);
      setInstagramStories(data);
    } catch (e) {
      console.error('Failed to fetch stories:', e);
      setInstagramStories([]);
    } finally { setStoriesLoading(false); }
  };

  const fetchVideoComments = async (video) => {
    setVideoCommentsLoading(true);
    try {
      const res = await api.get(`/youtube/videos/${video.content_id}/comments`);
      setVideoComments(res.data);
    } catch (e) {
      console.error(e);
      setVideoComments([]);
    } finally { setVideoCommentsLoading(false); }
  };

  // ─── Filtering & Pagination ─────────────────────────────────
  const filteredSources = useMemo(() => {
    return sources.filter(source => {
      const matchesSearch = source.display_name.toLowerCase().includes(searchQuery.toLowerCase()) || source.identifier.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPlatform = platformFilter === 'all' || source.platform === platformFilter;
      const matchesType = sourceTypeFilter === 'all' || (sourceTypeFilter === 'official' && source.is_official);
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? source.is_active : !source.is_active);
      const matchesCategory = categoryFilter === 'all' || (source.category || '').toLowerCase() === categoryFilter;
      return matchesSearch && matchesPlatform && matchesType && matchesStatus && matchesCategory;
    }).sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
  }, [sources, searchQuery, platformFilter, sourceTypeFilter, statusFilter, categoryFilter]);

  const totalPages = Math.ceil(filteredSources.length / itemsPerPage);
  const paginatedSources = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredSources.slice(start, start + itemsPerPage);
  }, [filteredSources, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
    fetchPlatformStats();
  }, [platformFilter]);

  const selectedSet = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);
  const allVisibleSelected = paginatedSources.length > 0 && paginatedSources.every(s => selectedSet.has(s.id));
  const toggleSourceSelection = (id, checked) => { setSelectedSourceIds(prev => checked ? [...prev.filter(x => x !== id), id] : prev.filter(x => x !== id)); };
  const handleSelectAllCurrentPage = (shouldSelect) => { const ids = paginatedSources.map(s => s.id); if (!shouldSelect) setSelectedSourceIds(prev => prev.filter(id => !ids.includes(id))); else setSelectedSourceIds(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return Array.from(next); }); };

  const metrics = useMemo(() => {
    const pool = platformFilter === 'all' ? sources : sources.filter(s => s.platform === platformFilter);
    return { totalAccounts: pool.length, activeAccounts: pool.filter(s => s.is_active).length, highRisk: pool.filter(s => s.risk_level === 'high' || s.risk_level === 'critical').length, mediumRisk: pool.filter(s => s.risk_level === 'medium').length };
  }, [sources, platformFilter]);

  // ─── Content Card Renderer ──────────────────────────────────
  const renderContentCard = (item) => {
    // X (Twitter) platform
    if (selectedSource?.platform === 'x') {
      return <TwitterAlertCard key={item.id || item._id} alert={item} content={item} source={{ name: item.author, handle: item.author_handle }} hideActions={true} viewMode="grid" />;
    }

    // Instagram platform — use InstagramReelCard
    if (selectedSource?.platform === 'instagram') {
      const postSource = {
        name: selectedSource.display_name || selectedSource.identifier,
        handle: selectedSource.identifier,
        is_verified: selectedSource.is_verified,
        profile_image_url: selectedSource.profile_image_url
      };
      return (
        <div key={item.id || item._id || item.content_id} className="h-full">
          <InstagramReelCard content={item} source={postSource} />
        </div>
      );
    }

    // Facebook platform — replicate FacebookMonitor.renderPostCard
    if (selectedSource?.platform === 'facebook') {
      const riskLevel = item.risk_level || item.analysis?.risk_level || 'low';
      return (
        <Card key={item.id || item._id} className="hover:shadow-lg transition-all duration-200 group border-l-4 border-l-transparent hover:border-l-blue-500">
          <CardContent className="p-5">
            <div className="flex gap-4">
              <Avatar className="h-11 w-11 border-2 border-blue-100 ring-2 ring-blue-50 flex-shrink-0">
                <AvatarImage src={item.author_avatar} />
                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-blue-600 text-white font-bold">
                  {(item.author || 'FB')[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 truncate">{item.author || 'Unknown Page'}</span>
                      <Badge variant="secondary" className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5">
                        <Facebook className="h-2.5 w-2.5 mr-1" /> Facebook
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <Clock className="h-3 w-3" /> {item.published_at ? formatIST(item.published_at) : ''}
                    </div>
                  </div>
                  <RiskBadge level={riskLevel} score={item.risk_score || item.analysis?.violence_score || 0} />
                </div>
                <p className="text-gray-700 text-sm leading-relaxed line-clamp-3 group-hover:line-clamp-none transition-all">{item.text}</p>
                {item.media && item.media.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {item.media.slice(0, 3).map((url, idx) => (
                      <img key={idx} src={url} alt="Post media" className="h-20 w-20 object-cover rounded-lg border flex-shrink-0 hover:scale-105 transition-transform cursor-pointer" onError={(e) => e.target.style.display = 'none'} />
                    ))}
                    {item.media.length > 3 && <div className="h-20 w-20 flex items-center justify-center bg-muted rounded-lg text-xs text-muted-foreground flex-shrink-0">+{item.media.length - 3} more</div>}
                  </div>
                )}
                {(item.risk_factors?.length > 0 || item.analysis?.triggered_keywords?.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {(item.risk_factors || item.analysis?.triggered_keywords?.map(k => ({ keyword: k })) || []).slice(0, 5).map((factor, i) => (
                      <Badge key={i} className="bg-red-50 text-red-600 border-red-100 text-[10px] px-2 py-0.5 hover:bg-red-100 transition-colors cursor-default">
                        <Zap className="h-2.5 w-2.5 mr-1" /> {factor.keyword || factor}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5" title="Likes"><ThumbsUp className="h-3.5 w-3.5" /> {(item.engagement?.likes || 0).toLocaleString()}</span>
                    <span className="flex items-center gap-1.5" title="Comments"><MessageCircle className="h-3.5 w-3.5" /> {(item.engagement?.comments || 0).toLocaleString()}</span>
                    <span className="flex items-center gap-1.5" title="Shares"><Share2 className="h-3.5 w-3.5" /> {(item.engagement?.shares || 0).toLocaleString()}</span>
                  </div>
                  {item.content_url && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => window.open(item.content_url, '_blank')}>
                      <ExternalLink className="h-3 w-3" /> View Post
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    // YouTube platform — exact match to YouTubeMonitor video cards
    if (selectedSource?.platform === 'youtube') {
      const videoTitle = item.text?.split('\n')[0] || item.title || 'Untitled Video';
      return (
        <Card key={item.id || item._id} className="group hover:shadow-md transition-all duration-200 border-border overflow-hidden flex flex-col">
          <div className="relative aspect-video bg-black/5">
            <img
              src={item.thumbnails?.medium?.url || item.thumbnails?.high?.url || item.thumbnails?.default?.url || item.thumbnail_url || 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/YouTube_full-color_icon_%282017%29.svg/1024px-YouTube_full-color_icon_%282017%29.svg.png'}
              className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${!(item.thumbnails?.default || item.thumbnail_url) ? 'p-8 bg-white object-contain' : ''}`}
              alt={videoTitle}
              onError={(e) => { e.target.onerror = null; e.target.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/YouTube_full-color_icon_%282017%29.svg/1024px-YouTube_full-color_icon_%282017%29.svg.png'; e.target.className = 'w-full h-full object-contain p-8 bg-white'; }}
            />
            <div className="absolute inset-0 bg-black/20 sm:bg-black/0 sm:group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transform sm:translate-y-4 sm:group-hover:translate-y-0 transition-all duration-300">
                <Button variant="secondary" size="sm" className="gap-2 shadow-lg" onClick={() => { setSelectedVideo(item); fetchVideoComments(item); }}>
                  <Activity className="h-4 w-4" /> Analyze Intelligence
                </Button>
              </div>
            </div>
            <div className="absolute top-2 right-2">
              <RiskBadge level={item.risk_level} score={item.risk_score} />
            </div>
            <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
              {item.published_at ? new Date(item.published_at).toLocaleDateString() : ''}
            </div>
          </div>
          <div className="p-4 flex-1 flex flex-col">
            <div className="mb-3">
              <h3 className="font-semibold text-base leading-tight line-clamp-2 mb-1" title={videoTitle}>{videoTitle}</h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                <span className="truncate max-w-[150px]">{item.author}</span>
              </div>
            </div>
            <div className="mt-auto pt-3 border-t grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground font-semibold">Views</div>
                <div className="text-sm font-bold">{formatNumber(item.engagement?.views)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground font-semibold">Risk</div>
                <div className={cn('text-sm font-bold', item.risk_score > 70 ? 'text-red-600' : item.risk_score > 40 ? 'text-orange-500' : 'text-emerald-600')}>{item.risk_score || 0}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground font-semibold">Threats</div>
                <div className={cn('text-sm font-bold', item.threat_comments_count > 0 ? 'text-red-600' : 'text-muted-foreground')}>{item.threat_comments_count || 0}</div>
              </div>
            </div>
          </div>
        </Card>
      );
    }

    // Generic content card for Instagram/Facebook
    const riskLevel = item.risk_level || item.analysis?.risk_level || 'low';
    const riskColor = riskLevel === 'high' || riskLevel === 'critical' ? 'border-red-200 bg-red-50/30' : riskLevel === 'medium' ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200';
    return (
      <Card key={item.id || item._id} className={`overflow-hidden hover:shadow-md transition-shadow ${riskColor}`}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <RiskBadge level={riskLevel} score={item.risk_score || item.analysis?.violence_score} />
            <span className="text-xs text-slate-400">{item.published_at ? formatIST(item.published_at) : ''}</span>
          </div>
          {item.title && <h4 className="text-sm font-semibold text-slate-800 line-clamp-2">{item.title}</h4>}
          <p className="text-xs text-slate-600 line-clamp-3">{item.text || item.description || item.caption || ''}</p>
          {item.thumbnail_url && <img src={item.thumbnail_url} alt="" className="w-full rounded-lg object-cover max-h-40" />}
          {item.content_url && (
            <a href={item.content_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              <ExternalLink className="h-3 w-3" /> View Original
            </a>
          )}
        </CardContent>
      </Card>
    );
  };

  // ─── Loading Skeleton ───────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50/50 p-4 md:p-6 lg:p-8">
        <div className="w-full space-y-6">
          <Skeleton className="h-8 w-56" />
          <div className="flex gap-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-28 rounded-full" />)}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // SELECTED SOURCE DETAIL VIEW
  // ═══════════════════════════════════════════════════════════
  if (selectedSource) {
    const gradient = getPlatformGradient(selectedSource.platform);
    const contentLabel = getContentLabel(selectedSource.platform);
    return (
      <TooltipProvider>
        <div className="min-h-screen bg-slate-50/50">
          <div className="p-4 md:p-6 lg:p-8 w-full space-y-6">

            {/* Back Button */}
            <Button variant="ghost" onClick={() => { setSelectedSource(null); setContentItems([]); }} className="gap-2 text-slate-600 hover:text-slate-800 -ml-2">
              <ArrowLeft className="h-4 w-4" /> Back to Sources
            </Button>

            {/* Profile Header Card */}
            <Card className="overflow-hidden border-slate-200">
              <div className={`h-32 bg-gradient-to-r ${gradient} relative`}>
                <div className="absolute bottom-4 right-4 flex gap-2">
                  <Button variant="secondary" size="sm" className="bg-white/90 hover:bg-white text-black text-xs font-semibold backdrop-blur-sm" onClick={() => window.open(getSourceLink(selectedSource), '_blank')}>
                    <ExternalLink className="h-3 w-3 mr-1.5" /> {getPlatformViewLabel(selectedSource.platform)}
                  </Button>
                  <Button variant="destructive" size="sm" className="text-xs font-semibold shadow-sm" onClick={() => handleDelete(selectedSource.id)}>
                    <Trash2 className="h-3 w-3 mr-1.5" /> Stop Monitoring
                  </Button>
                </div>
              </div>
              <CardContent className="pt-0 relative">
                <div className="flex flex-col md:flex-row gap-6 items-start justify-between w-full">
                  <div className="flex flex-col md:flex-row gap-6 items-start">
                    {/* Avatar */}
                    <div className="h-24 w-24 border-4 border-white -mt-12 rounded-2xl shadow-lg bg-slate-100 flex items-center justify-center overflow-hidden">
                      {selectedSource.profile_image_url ? (
                        <img src={selectedSource.profile_image_url} alt="" className="h-24 w-24 rounded-xl object-cover" />
                      ) : (
                        <span className="text-2xl font-bold text-slate-500">{(selectedSource.display_name || '?')[0].toUpperCase()}</span>
                      )}
                    </div>
                    <div className="mt-4 md:mt-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-bold text-slate-800">{selectedSource.display_name}</h2>
                        {selectedSource.is_verified && <CheckCircle className="h-5 w-5 text-blue-500" />}
                        {selectedSource.risk_level === 'high' && <Badge variant="destructive" className="ml-2 text-xs">High Risk</Badge>}
                      </div>
                      <p className="text-slate-500 font-medium">{selectedSource.identifier}</p>
                      <div className="flex gap-4 text-sm text-slate-500 mt-2">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-4 w-4" />
                          Since {selectedSource.created_at ? format(new Date(selectedSource.created_at), 'd/MM/yyyy') : 'N/A'}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Activity className="h-4 w-4" />
                          {contentItems.length} {contentLabel} Analyzed
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Escalation Stats */}
                  <div className="mt-4 md:mt-0 hidden lg:flex items-center gap-5 bg-slate-50/80 backdrop-blur-sm p-3 rounded-xl border border-slate-200/60 shadow-sm mr-2">
                    <div className="flex flex-col items-center px-4 min-w-[80px]">
                      {escalationStats.loading ? <Skeleton className="h-8 w-10 mb-1" /> : <span className="text-3xl font-bold text-purple-600">{escalationStats.escalated}</span>}
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider text-center leading-tight mt-1">NO OF TIMES<br />ESCALATED</span>
                    </div>
                    <div className="h-10 w-px bg-slate-200" />
                    <div className="flex flex-col items-center px-4 min-w-[80px]">
                      {escalationStats.loading ? <Skeleton className="h-8 w-10 mb-1" /> : <span className="text-3xl font-bold text-blue-600">{escalationStats.sentToIntermediary}</span>}
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider text-center leading-tight mt-1">SENT TO<br />INTERMEDIARY</span>
                    </div>
                    <div className="h-10 w-px bg-slate-200" />
                    <div className="flex flex-col items-center px-4 min-w-[80px]">
                      {escalationStats.loading ? <Skeleton className="h-8 w-10 mb-1" /> : <span className="text-3xl font-bold text-green-600">{escalationStats.closed}</span>}
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider text-center leading-tight mt-1">CLOSED</span>
                    </div>
                    <div className="h-8 w-px bg-slate-200 mx-1" />
                    <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 font-medium h-9 gap-2"
                      onClick={() => { if (selectedSource?.identifier) { navigate(`/alerts?status=reports&handle=${encodeURIComponent(selectedSource.identifier)}`); } }}>
                      View History <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Content Tabs */}
            <Tabs value={selectedContentTab} onValueChange={setSelectedContentTab} className="space-y-6">
              <TabsList className="bg-white border p-1 h-auto w-full justify-start">
                <TabsTrigger value="content" className="px-6 py-2.5">
                  {getPlatformIcon(selectedSource.platform, 'h-4 w-4 mr-2')} {contentLabel}
                </TabsTrigger>
                {selectedSource.platform === 'instagram' && (
                  <TabsTrigger value="stories" className="px-6 py-2.5">
                    <Circle className="h-4 w-4 mr-2" /> Stories
                  </TabsTrigger>
                )}
                <TabsTrigger value="analytics" className="px-6 py-2.5">
                  <BarChart2 className="h-4 w-4 mr-2" /> Risk Analytics
                </TabsTrigger>
              </TabsList>

              <TabsContent value="content" className="space-y-4">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">{contentItems.length} {contentLabel.toLowerCase()}</Badge>
                </div>
                {contentLoading && contentItems.length === 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="bg-white border rounded-xl p-4 space-y-4 animate-pulse">
                        <div className="flex items-center gap-3"><Skeleton className="h-10 w-10 rounded-full" /><div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div></div>
                        <Skeleton className="h-20 w-full" />
                      </div>
                    ))}
                  </div>
                ) : contentItems.length > 0 ? (
                  selectedSource.platform === 'facebook' ? (
                    <div className="space-y-4">
                      {contentItems.map(item => renderContentCard(item))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {contentItems.map(item => renderContentCard(item))}
                    </div>
                  )
                ) : (
                  <div className="text-center py-16 text-slate-500 bg-slate-50 rounded-xl border border-dashed">
                    {getPlatformIcon(selectedSource.platform, 'h-12 w-12 mx-auto mb-4 text-slate-300')}
                    <h3 className="text-lg font-semibold text-slate-700">No {contentLabel.toLowerCase()} found</h3>
                    <p className="text-sm">We haven't detected any {contentLabel.toLowerCase()} from this source yet.</p>
                  </div>
                )}
                {contentHasMore && (
                  <div className="flex justify-center py-4">
                    <Button variant="outline" onClick={() => fetchSourceContent(contentPage + 1, false)} disabled={contentLoading} className="gap-2">
                      {contentLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Load More
                    </Button>
                  </div>
                )}
              </TabsContent>

              {/* Instagram Stories Tab */}
              {selectedSource.platform === 'instagram' && (
                <TabsContent value="stories" className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="space-y-1">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <div className="p-1.5 rounded-full bg-gradient-to-tr from-[#FCAF45] via-[#E1306C] to-[#833AB4]">
                          <Circle className="h-4 w-4 text-white" />
                        </div>
                        Stories from @{selectedSource?.identifier?.replace('@', '')}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {instagramStories.length > 0 ? `${instagramStories.length} stories found` : 'Stories from this profile'}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => fetchInstagramStories(selectedSource.id)} disabled={storiesLoading} className="gap-2">
                      {storiesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh Stories
                    </Button>
                  </div>
                  {storiesLoading ? (
                    <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-purple-500" /></div>
                  ) : instagramStories.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                      {instagramStories.map((story) => (
                        <Card key={story.id || story.content_id} className="overflow-hidden group cursor-pointer hover:shadow-lg transition-all"
                          onClick={() => {
                            const url = story.content_url || story.media_url;
                            if (url) window.open(url, '_blank');
                          }}>
                          <div className="relative aspect-[9/16] bg-gradient-to-br from-purple-100 to-pink-100">
                            {(story.thumbnail_url || story.media_url) ? (
                              <img src={story.thumbnail_url || story.media_url} alt="Story" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                onError={(e) => { e.target.style.display = 'none'; }} />
                            ) : (
                              <div className="flex items-center justify-center h-full">
                                <Instagram className="h-12 w-12 text-pink-300" />
                              </div>
                            )}
                            <div className="absolute top-2 left-2">
                              <RiskBadge level={story.risk_level || 'low'} score={story.risk_score} />
                            </div>
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                              <p className="text-white text-xs font-medium line-clamp-2">{story.text || 'Story'}</p>
                              <p className="text-white/70 text-[10px] mt-1">{story.published_at ? formatIST(story.published_at) : ''}</p>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-16 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                      <div className="p-3 rounded-full bg-gradient-to-tr from-[#FCAF45] via-[#E1306C] to-[#833AB4] w-fit mx-auto mb-4">
                        <Circle className="h-8 w-8 text-white" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">No Stories Found</h3>
                      <p>This profile has no stories at the moment.</p>
                      <p className="text-xs text-muted-foreground mt-2">Stories expire after 24 hours</p>
                    </div>
                  )}
                </TabsContent>
              )}

              <TabsContent value="analytics">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total Volume</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{contentItems.length}</div><p className="text-xs text-slate-500 mt-1">Total analyzed {contentLabel.toLowerCase()}</p></CardContent></Card>
                  <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Risk Profile</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-red-600">{contentItems.filter(t => { const r = (t.risk_level || t.analysis?.risk_level || '').toString().toLowerCase(); return r === 'high' || r === 'critical'; }).length}</div><p className="text-xs text-slate-500 mt-1">High risk content detected</p></CardContent></Card>
                  <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Avg Threat Score</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-orange-600">{(contentItems.reduce((acc, t) => acc + (t.risk_score || t.analysis?.violence_score || 0), 0) / (contentItems.length || 1)).toFixed(1)}</div><p className="text-xs text-slate-500 mt-1">Out of 1000</p></CardContent></Card>
                </div>
              </TabsContent>
            </Tabs>
            {/* YouTube Video Modal */}
            <Dialog open={!!selectedVideo} onOpenChange={(open) => !open && setSelectedVideo(null)}>
              <DialogContent className="w-full max-w-6xl h-[95vh] sm:h-auto sm:max-h-[90vh] overflow-y-auto bg-white p-4 md:p-6">
                {selectedVideo && (() => {
                  const videoTitle = selectedVideo.text?.split('\n')[0] || selectedVideo.title || 'Untitled Video';
                  const videoDescription = selectedVideo.text?.split('\n').slice(1).join(' ') || 'No description available';
                  const filteredComments = showThreatsOnly ? videoComments.filter(c => c.is_threat) : videoComments;
                  return (
                    <div className="h-[80vh] flex flex-col">
                      <div className="flex items-start justify-between mb-6">
                        <div>
                          <h2 className="text-2xl font-bold line-clamp-1">{videoTitle}</h2>
                          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1.5"><User className="h-4 w-4" /><span className="font-medium text-foreground">{selectedVideo.author}</span></div>
                            <div className="flex items-center gap-1.5"><Calendar className="h-4 w-4" /><span>{selectedVideo.published_at ? new Date(selectedVideo.published_at).toLocaleDateString() : 'N/A'}</span></div>
                            <RiskBadge level={selectedVideo.risk_level} score={selectedVideo.risk_score} />
                          </div>
                        </div>
                        <Button variant="outline" className="gap-2" onClick={() => window.open(`https://www.youtube.com/watch?v=${selectedVideo.content_id}`, '_blank')}>
                          <ExternalLink className="h-4 w-4" /> Open in YouTube
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 min-h-0">
                        <div className="lg:col-span-7 flex flex-col gap-6 overflow-y-auto pr-2">
                          <div className="relative w-full pt-[56.25%] rounded-xl overflow-hidden bg-black border shadow-sm">
                            <iframe className="absolute top-0 left-0 w-full h-full" src={`https://www.youtube.com/embed/${selectedVideo.content_id}`} title={videoTitle} frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                          </div>
                          <Card><CardHeader><CardTitle className="text-sm font-medium">Description</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{videoDescription}</p></CardContent></Card>
                        </div>
                        <div className="lg:col-span-5 flex flex-col min-h-0">
                          <Tabs defaultValue="analysis" className="h-full flex flex-col">
                            <TabsList className="w-full justify-start border-b rounded-none px-0 h-auto p-0 bg-transparent gap-6">
                              <TabsTrigger value="analysis" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Risk Analysis</TabsTrigger>
                              <TabsTrigger value="comments" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2">Comments ({videoComments.length})</TabsTrigger>
                            </TabsList>
                            <div className="flex-1 overflow-y-auto pt-6">
                              <TabsContent value="analysis" className="mt-0 space-y-6">
                                {(selectedVideo.analysis_data?.topic || selectedVideo.analysis_data?.summary) && (
                                  <Card className="bg-gradient-to-br from-purple-50 to-white border-purple-100">
                                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2 text-purple-900"><Activity className="h-4 w-4" /> AI Intelligence Brief</CardTitle></CardHeader>
                                    <CardContent className="space-y-3">
                                      {selectedVideo.analysis_data?.topic && <div className="flex gap-2 text-sm"><span className="font-semibold min-w-16 text-muted-foreground">Topic:</span><span className="font-medium">{selectedVideo.analysis_data.topic}</span></div>}
                                      {selectedVideo.analysis_data?.summary && <div className="flex gap-2 text-sm"><span className="font-semibold min-w-16 text-muted-foreground">Summary:</span><span className="text-muted-foreground leading-relaxed">{selectedVideo.analysis_data.summary}</span></div>}
                                    </CardContent>
                                  </Card>
                                )}
                                <Card>
                                  <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> Risk Assessment</CardTitle></CardHeader>
                                  <CardContent>
                                    <div className="space-y-4">
                                      <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Risk Score</span><span className={cn('text-2xl font-bold', selectedVideo.risk_score > 70 ? 'text-red-600' : selectedVideo.risk_score > 40 ? 'text-orange-500' : 'text-emerald-600')}>{selectedVideo.risk_score || 0}</span></div>
                                      <Progress value={Math.min(selectedVideo.risk_score || 0, 100)} className="h-2" />
                                      {selectedVideo.analysis_data?.explanation && <p className="text-xs text-muted-foreground">{selectedVideo.analysis_data.explanation}</p>}
                                    </div>
                                  </CardContent>
                                </Card>
                                <div className="grid grid-cols-2 gap-4">
                                  <Card><CardContent className="pt-6 text-center"><Eye className="h-5 w-5 mx-auto mb-2 text-blue-500" /><div className="text-lg font-bold">{formatNumber(selectedVideo.engagement?.views)}</div><p className="text-xs text-muted-foreground">Views</p></CardContent></Card>
                                  <Card><CardContent className="pt-6 text-center"><ThumbsUp className="h-5 w-5 mx-auto mb-2 text-green-500" /><div className="text-lg font-bold">{formatNumber(selectedVideo.engagement?.likes)}</div><p className="text-xs text-muted-foreground">Likes</p></CardContent></Card>
                                  <Card><CardContent className="pt-6 text-center"><MessageCircle className="h-5 w-5 mx-auto mb-2 text-purple-500" /><div className="text-lg font-bold">{formatNumber(selectedVideo.engagement?.comments)}</div><p className="text-xs text-muted-foreground">Comments</p></CardContent></Card>
                                  <Card><CardContent className="pt-6 text-center"><Activity className="h-5 w-5 mx-auto mb-2 text-orange-500" /><div className="text-lg font-bold">{Math.round(selectedVideo.engagement_score || 0)}%</div><p className="text-xs text-muted-foreground">Eng. Score</p></CardContent></Card>
                                </div>
                              </TabsContent>
                              <TabsContent value="comments" className="mt-0 h-full flex flex-col">
                                <div className="flex items-center justify-between mb-4">
                                  <div className="flex items-center gap-2"><Switch id="threats-only-src" checked={showThreatsOnly} onCheckedChange={setShowThreatsOnly} /><Label htmlFor="threats-only-src" className="text-sm">Show threats only</Label></div>
                                  <Button variant="outline" size="sm" onClick={() => fetchVideoComments(selectedVideo)} disabled={videoCommentsLoading}><RefreshCw className={`h-3.5 w-3.5 mr-2 ${videoCommentsLoading ? 'animate-spin' : ''}`} /> Refresh</Button>
                                </div>
                                <ScrollArea className="flex-1 pr-4 -mr-4">
                                  {videoCommentsLoading ? (
                                    <div className="flex flex-col items-center justify-center py-12"><RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mb-4" /><p className="text-muted-foreground">Loading comments...</p></div>
                                  ) : filteredComments.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12 text-center"><MessageSquare className="h-10 w-10 text-muted-foreground mb-3 opacity-20" /><p className="text-muted-foreground font-medium">No comments found</p></div>
                                  ) : (
                                    <div className="space-y-3">
                                      {filteredComments.map((comment) => (
                                        <div key={comment.id} className={cn('p-4 rounded-lg border bg-card transition-colors', comment.is_threat ? 'border-red-200 bg-red-50/50' : 'hover:bg-muted/50')}>
                                          <div className="flex gap-3">
                                            <Avatar className="h-8 w-8 border"><AvatarImage src={comment.author_profile_image} /><AvatarFallback>{comment.author_display_name?.[0] || '?'}</AvatarFallback></Avatar>
                                            <div className="flex-1 space-y-1.5">
                                              <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2"><span className="font-semibold text-sm">{comment.author_display_name}</span>{comment.is_threat && <Badge variant="destructive" className="h-5 px-1.5 text-[10px] uppercase">Threat</Badge>}</div>
                                                <span className="text-xs text-muted-foreground">{comment.published_at ? new Date(comment.published_at).toLocaleDateString() : ''}</span>
                                              </div>
                                              <p className="text-sm leading-relaxed text-foreground/90">{comment.text}</p>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </ScrollArea>
                              </TabsContent>
                            </div>
                          </Tabs>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </DialogContent>
            </Dialog>

          </div>
        </div>
      </TooltipProvider>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN SOURCE LIST VIEW
  // ═══════════════════════════════════════════════════════════
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-slate-50/50" data-testid="sources-page">
        {/* Dialogs */}
        <Dialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
          <DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><Trash2 className="h-5 w-5" /> Delete Selected Sources</DialogTitle><DialogDescription className="pt-2">{selectedSourceIds.length === 1 ? 'Are you sure? This cannot be undone.' : `Delete ${selectedSourceIds.length} sources? This cannot be undone.`}</DialogDescription></DialogHeader>
            <div className="flex gap-3 pt-4"><Button variant="outline" className="flex-1" onClick={() => setIsBulkDeleteOpen(false)}>Cancel</Button><Button variant="destructive" className="flex-1" onClick={handleBulkDelete}>Delete</Button></div>
          </DialogContent>
        </Dialog>
        <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
          <DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><AlertCircle className="h-5 w-5" /> Confirm Deletion</DialogTitle><DialogDescription className="pt-2">Are you sure you want to delete this source? This cannot be undone.</DialogDescription></DialogHeader>
            <div className="flex gap-3 pt-4"><Button variant="outline" className="flex-1" onClick={() => setDeleteConfirmId(null)}>Cancel</Button><Button variant="destructive" className="flex-1" onClick={() => handleDelete(deleteConfirmId)}>Delete</Button></div>
          </DialogContent>
        </Dialog>

        <div className={cn("w-full space-y-6", !window.location.pathname.includes('/settings') && "p-4 md:p-6")}>
          {/* Header */}
          <header className="flex items-center justify-between">
            <div><h1 className="text-2xl font-semibold text-slate-800 tracking-tight">Profile Management</h1></div>
            <div className="flex items-center gap-2">
              <Tooltip><TooltipTrigger asChild><Button variant="outline" size="sm" onClick={() => fetchSources(true)} disabled={isRefreshing} className="gap-2"><RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh</Button></TooltipTrigger><TooltipContent>Sync latest data</TooltipContent></Tooltip>
              <Button onClick={() => setIsAddModalOpen(true)} size="sm" className="gap-2">
                <Plus className="h-4 w-4" /> Add Profile
              </Button>
            </div>
          </header>

          {/* Platform Filter Tabs */}
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(p => {
              const isActive = platformFilter === p.value;
              const count = sources.filter(s => s.platform === p.value).length;
              return (
                <button key={p.value} onClick={() => setPlatformFilter(p.value)} className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all duration-200 ${isActive ? p.activeBg : `bg-white text-slate-600 border-slate-200 ${p.hoverBg}`}`}>
                  <p.icon className="h-4 w-4" /><span>{p.label}</span><span className={`text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Dynamic Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <MetricCard label="Total Accounts" value={metrics.totalAccounts} icon={Users} color="bg-slate-700" />
            <MetricCard
              label={platformFilter === 'all' ? "Active Accounts" : `Analyzed ${getContentLabel(platformFilter)}`}
              value={platformFilter === 'all' ? metrics.activeAccounts : contentStats.total}
              icon={FileText}
              color="bg-emerald-600"
              onClick={() => {
                const params = new URLSearchParams();
                if (platformFilter !== 'all') params.set('platform', platformFilter);
                navigate(`/alerts?${params.toString()}`);
              }}
            />
            <MetricCard
              label="High Risk Alerts"
              value={platformFilter === 'all' ? metrics.highRisk : contentStats.high}
              icon={ShieldAlert}
              color="bg-red-500"
              onClick={() => {
                const params = new URLSearchParams();
                if (platformFilter !== 'all') params.set('platform', platformFilter);
                params.set('category', 'high');
                navigate(`/alerts?${params.toString()}`);
              }}
            />
            <MetricCard
              label="Medium Risk Alerts"
              value={platformFilter === 'all' ? metrics.mediumRisk : contentStats.medium}
              icon={ShieldCheck}
              color="bg-amber-500"
              onClick={() => {
                const params = new URLSearchParams();
                if (platformFilter !== 'all') params.set('platform', platformFilter);
                params.set('category', 'medium');
                navigate(`/alerts?${params.toString()}`);
              }}
            />
          </div>

          {/* Search + Filters */}
          <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 mb-4">
            <div className="relative w-full lg:w-96 lg:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search sources..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-slate-50 border-slate-200 h-9 w-full"
              />
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-600 shrink-0">Category:</span>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-full sm:w-[140px] bg-slate-50 border-slate-200 h-9 shrink-0">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {CATEGORY_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-600 shrink-0">Status:</span>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-[120px] bg-slate-50 border-slate-200 h-9 shrink-0">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active Only</SelectItem>
                    <SelectItem value="paused">Paused Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Results Summary & Actions - Below the search card */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-4 px-1">
            <p className="text-sm text-slate-500">
              Showing <span className="font-semibold text-slate-700">{paginatedSources.length}</span> of <span className="font-semibold text-slate-700">{filteredSources.length}</span> sources
            </p>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleAllPlatformSources(true)}
                      className="h-9 px-4 gap-2 text-emerald-700 border-emerald-200 hover:bg-emerald-50 bg-white"
                    >
                      <Play className="h-4 w-4" /> Resume All
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Resume all filtered sources</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleAllPlatformSources(false)}
                      className="h-9 px-4 gap-2 text-amber-700 border-amber-200 hover:bg-amber-50 bg-white"
                    >
                      <Pause className="h-4 w-4" /> Pause All
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Pause all filtered sources</TooltipContent>
                </Tooltip>
              </div>

              {selectedSourceIds.length > 0 && (
                <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
                  <span className="text-xs text-slate-500">{selectedSourceIds.length} selected</span>
                  <Button variant="destructive" size="sm" onClick={() => setIsBulkDeleteOpen(true)} className="gap-1.5 h-8">
                    <Trash2 className="h-3 w-3" /> Delete Selected
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-x-auto">
            {filteredSources.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="p-4 bg-slate-100 rounded-full mb-4"><Users className="h-8 w-8 text-slate-400" /></div>
                <h3 className="text-lg font-semibold text-slate-700">No sources found</h3>
                <p className="text-sm text-slate-500 mt-1 max-w-sm">{sources.length === 0 ? 'Get started by adding your first source.' : 'Try adjusting your search or filters.'}</p>
                {sources.length === 0 && <Button onClick={() => setIsAddModalOpen(true)} size="sm" className="mt-4 gap-2"><Plus className="h-4 w-4" /> Add First Source</Button>}
              </div>
            ) : (
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                    <TableHead className="w-10 pl-4"><Checkbox checked={allVisibleSelected} onCheckedChange={(checked) => handleSelectAllCurrentPage(checked === true)} aria-label="Select all" /></TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Handle</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Display Name</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Last Checked</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-right pr-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSources.map((source) => {
                    const isSelected = selectedSet.has(source.id);
                    return (
                      <TableRow key={source.id} className={`group cursor-pointer transition-colors ${isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50/50'}`} onClick={async () => {
                        try {
                          const res = await api.get(`/poi/by-source/${source.id}?handle=${encodeURIComponent(source.identifier)}&platform=${source.platform}`);
                          if (res.data?._id) {
                            navigate(`/person-of-interest/${res.data._id}`, { state: { selectedPlatform: source.platform, selectedHandle: source.identifier } });
                          } else {
                            toast.error('No POI profile found for this source');
                          }
                        } catch (err) {
                          if (err?.response?.status === 404) {
                            toast.error('No POI profile linked to this source yet');
                          } else {
                            toast.error('Failed to find linked POI');
                          }
                        }
                      }}>
                        <TableCell className="pl-4 w-10" onClick={(e) => e.stopPropagation()}><Checkbox checked={isSelected} onCheckedChange={(checked) => toggleSourceSelection(source.id, checked === true)} /></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getPlatformIcon(source.platform, 'h-4 w-4')}
                            <span className="text-sm font-medium text-blue-600">{source.identifier}</span>
                            <a href={getSourceLink(source)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-slate-400 hover:text-blue-600"><ExternalLink className="h-3 w-3" /></a>
                            {source.is_official && <CheckCircle className="h-3.5 w-3.5 text-blue-500" />}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                              {source.profile_image_url ? <img src={source.profile_image_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="text-sm font-semibold text-slate-500">{(source.display_name || '?')[0].toUpperCase()}</span>}
                            </div>
                            <span className="text-sm font-medium text-slate-700 truncate max-w-[200px]" title={source.display_name}>{source.display_name}</span>
                            {source.is_party_wide ? (
                              <Badge variant="secondary" className="text-[10px] px-1 py-0">Party-wide</Badge>
                            ) : source.constituency ? (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-300 text-blue-700">{source.constituency}</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell><span className="text-sm text-slate-500">{source.last_checked ? format(new Date(source.last_checked), 'd MMM yyyy, h:mm a') : 'Never'}</span></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs font-medium ${source.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                            <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${source.is_active ? 'bg-emerald-500' : 'bg-amber-500'}`} />{source.is_active ? 'Active' : 'Paused'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-end">
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" onClick={() => handleEditSource(source)} className="h-8 w-8 p-0 text-slate-400 hover:text-blue-600"><Pencil className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>Edit Profile</TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" onClick={() => handleToggleActive(source)} className="h-8 w-8 p-0 text-slate-400 hover:text-emerald-600">{source.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button></TooltipTrigger><TooltipContent>{source.is_active ? 'Pause' : 'Resume'}</TooltipContent></Tooltip>
                            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" onClick={() => setDeleteConfirmId(source.id)} className="h-8 w-8 p-0 text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>Delete</TooltipContent></Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-slate-500">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="gap-1"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <AddSourceModal
          open={isAddModalOpen}
          initialData={editingSource}
          onClose={() => {
            setIsAddModalOpen(false);
            setEditingSource(null);
          }}
          onSuccess={() => {
            fetchSources(true);
            setIsAddModalOpen(false);
            setEditingSource(null);
          }}
        />
      </div>
    </TooltipProvider>
  );
};

export default Sources;
