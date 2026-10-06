import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Instagram, Search, Shield, AlertTriangle, Activity,
  BarChart2, Users, FileText, RefreshCw, ExternalLink,
  LayoutGrid, LayoutList, Filter, Trash2, ArrowLeft,
  ChevronRight, AlertOctagon, CheckCircle2,
  TrendingUp, Eye, Heart, MessageCircle,
  User, Calendar, AlertCircle, Clock, Download, Tag, Pause, Play, Loader2, BadgeCheck, Plus, Circle, Volume2, VolumeX
} from 'lucide-react';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { Progress } from '../components/ui/progress';
import { Skeleton } from '../components/ui/skeleton';
import { Avatar } from '../components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import InstagramReelCard from '../components/InstagramReelCard';
import StoryViewer from '../components/StoryViewer';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { useInstagramCache } from '../contexts/InstagramCacheContext';

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
    } catch (_) {
      // Keep original value if URL parsing fails.
    }
  }

  return handle.replace(/^@/, '').toLowerCase();
};

const getStoryOpenUrl = (story = {}, storySource = null) => {
  const storyUrl = typeof story?.content_url === 'string' ? story.content_url.trim() : '';
  if (storyUrl) return storyUrl;

  const fallbackHandle = normalizeInstagramHandle(
    story?.author_handle ||
    storySource?.handle ||
    story?.author ||
    storySource?.name
  );
  return fallbackHandle ? `https://www.instagram.com/${fallbackHandle}/` : null;
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

const buildProfileImageCandidates = (entity = {}, extras = [], handles = []) => {
  const primary = [
    entity.profile_image_url,
    entity.profile_pic_url,
    entity.author_avatar,
    entity.author_profile_image_url,
    entity.author_profile_pic_url
  ];
  const fallbackHandles = [
    entity.username,
    entity.handle,
    entity.identifier,
    entity.author_handle,
    ...handles
  ]
    .map(normalizeInstagramHandle)
    .filter(Boolean);

  const fallbackUrls = fallbackHandles.map((handle) => `https://unavatar.io/instagram/${handle}`);
  return buildMediaCandidates([...primary, ...extras, ...fallbackUrls]);
};

const ResilientAvatarContent = ({ candidates, alt, fallbackText, className }) => {
  const [idx, setIdx] = useState(0);
  const stableKey = useMemo(() => candidates.join('|'), [candidates]);
  const src = candidates[idx];

  useEffect(() => {
    setIdx(0);
  }, [stableKey]);

  if (!src) {
    return (
      <div className="w-full h-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600">
        {(fallbackText || '?').slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className || 'w-full h-full object-cover'}
      onError={() => setIdx((prev) => prev + 1)}
    />
  );
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

    // S3 archived URLs have highest priority (permanent, never expire)
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

    // S3 archived URLs have highest priority (permanent, never expire)
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
  }, [
    mediaItems,
    story?.preview,
    story?.preview_image_url,
    story?.thumbnail_url,
    story?.thumbnail_src,
    story?.display_url,
    story?.image_url,
    story?.image_versions2,
    story?.image_versions,
    story?.display_resources
  ]);
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
      node.play().catch(() => {});
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
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleStoryOpen();
        }
      }}
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
          onLoadedData={() => {
            if (isVisible && videoRef.current) {
              videoRef.current.play().catch(() => {});
            }
          }}
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
          <p className="text-xs font-semibold text-purple-700">Open on Instagram</p>
          <p className="text-[10px] text-purple-600/80">Story media unavailable here</p>
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="absolute bottom-2 left-2 right-2">
          <p className="text-white text-xs font-medium truncate">
            {story.author || story.author_handle || 'Instagram User'}
          </p>
          {!isExpired && typeof timeLeftHours === 'number' && (
            <p className="text-white/70 text-[10px]">{timeLeftHours}h left</p>
          )}
        </div>
      </div>

      {hasVideoSource && (
        <>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {isTilePaused ? (
              <Play className="h-8 w-8 text-white/80 drop-shadow-lg" />
            ) : (
              <Pause className="h-8 w-8 text-white/80 drop-shadow-lg" />
            )}
          </div>
          <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5">
            <button
              type="button"
              className="bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setIsTileMuted((prev) => !prev);
              }}
              title={isTileMuted ? 'Unmute story' : 'Mute story'}
            >
              {isTileMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              className="bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setIsTilePaused((prev) => !prev);
              }}
              title={isTilePaused ? 'Play story' : 'Pause story'}
            >
              {isTilePaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
          </div>
        </>
      )}
    </div>
  );
});

const StoryGridTile = React.memo(({ story, storySource, isExpired, timeLeftHours, publishedLabel, showTimeLeft = true, onOpenStory }) => {
  const storyKey = String(story?.id || story?.content_id || story?.content_url || `${story?.author_handle || 'unknown'}__${story?.published_at || 'na'}`);
  const isViewed = story?.viewed === true;
  const handleOpen = useCallback(() => {
    if (typeof onOpenStory === 'function') onOpenStory(story, storySource);
  }, [onOpenStory, story, storySource]);

  return (
    <div
      className={cn(
        "relative group cursor-pointer transition-transform hover:scale-[1.02]",
        isExpired && "opacity-40 pointer-events-none"
      )}
    >
      {/* Instagram-style ring: gradient for active, gray for viewed */}
      <div className={cn(
        "p-[3px] rounded-2xl transition-all",
        isExpired
          ? "bg-gray-300"
          : isViewed
            ? "bg-gradient-to-tr from-gray-300 via-gray-400 to-gray-300"
            : "bg-gradient-to-tr from-[#FCAF45] via-[#E1306C] to-[#833AB4] shadow-[0_0_12px_rgba(225,48,108,0.3)]"
      )}>
        <div className="bg-white dark:bg-gray-900 p-[2px] rounded-[14px]">
          <StoryTileMedia story={story} storyKey={storyKey} isExpired={isExpired} timeLeftHours={timeLeftHours} onOpenStory={handleOpen} />
        </div>
      </div>

      {/* Viewed indicator dot */}
      {isViewed && !isExpired && (
        <div className="absolute -top-0.5 -right-0.5 z-10">
          <div className="w-3.5 h-3.5 rounded-full bg-gray-400 border-2 border-white dark:border-gray-900 flex items-center justify-center">
            <Eye className="h-2 w-2 text-white" />
          </div>
        </div>
      )}

      {/* New/Active indicator */}
      {!isViewed && !isExpired && (
        <div className="absolute -top-0.5 -right-0.5 z-10">
          <div className="w-3.5 h-3.5 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 border-2 border-white dark:border-gray-900 animate-pulse" />
        </div>
      )}

      {/* Archived badge */}
      {story.is_archived && (
        <div className="absolute top-2 left-2 z-10">
          <div className="bg-emerald-500/80 backdrop-blur-sm text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Download className="h-2 w-2" />
            S3
          </div>
        </div>
      )}

      {/* Deleted badge */}
      {(story.is_deleted || story.availability_status === 'deleted') && (
        <div className="absolute bottom-12 left-2 z-10">
          <div className="bg-red-600/90 backdrop-blur-sm text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Trash2 className="h-2 w-2" />
            Deleted
          </div>
        </div>
      )}

      {/* Expired badge */}
      {(story.is_expired || story.availability_status === 'expired') && !story.is_deleted && (
        <div className="absolute bottom-12 left-2 z-10">
          <div className="bg-amber-500/90 backdrop-blur-sm text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Clock className="h-2 w-2" />
            Expired
          </div>
        </div>
      )}

      <div className="mt-2 text-center">
        <p className={cn(
          "text-xs font-medium truncate",
          isViewed ? "text-muted-foreground" : "text-foreground"
        )}>
          @{(story.author_handle || storySource?.handle || 'unknown').replace('@', '')}
        </p>
        {showTimeLeft && !isExpired && (
          <p className={cn(
            "text-[10px]",
            isViewed ? "text-muted-foreground/60" : "text-pink-500 font-medium"
          )}>
            {timeLeftHours}h left
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">
          {publishedLabel}
        </p>
      </div>
    </div>
  );
});

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

  const Icon = icons[level?.toLowerCase()] || Shield;

  return (
    <Badge
      variant="outline"
      className={cn(
        `${colors[level?.toLowerCase()] || colors.low} font-semibold px-3 py-1.5`,
        "flex items-center gap-1.5 whitespace-nowrap"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {level?.toUpperCase()} • {score || 0}
    </Badge>
  );
};

const InstagramMonitor = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [sources, setSources] = useState([]);
  const [posts, setPosts] = useState([]);
  const [stories, setStories] = useState([]);
  const [stats, setStats] = useState({
    totalSources: 0,
    totalPosts: 0,
    totalStories: 0,
    highRisk: 0,
    criticalRisk: 0,
    avgRiskScore: '0.0'
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
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileStories, setProfileStories] = useState([]);
  const [selectedSourceTab, setSelectedSourceTab] = useState('posts');
  const [timeFilter, setTimeFilter] = useState('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [keywordFilter, setKeywordFilter] = useState('all');
  const [viewMode, setViewMode] = useState('grid');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [scanning, setScanning] = useState(false);
  const [storyViewerOpen, setStoryViewerOpen] = useState(false);
  const [storyViewerIndex, setStoryViewerIndex] = useState(0);
  const [storyViewerStories, setStoryViewerStories] = useState([]);
  const [viewedStoryIds, setViewedStoryIds] = useState(new Set());
  const [dbStories, setDbStories] = useState([]);
  const [dbStoriesLoading, setDbStoriesLoading] = useState(false);
  const {
    getProfile,
    setProfile,
    getContent,
    setContent,
    getReels,
    setReels,
    getSources,
    setSources: setCachedSources
  } = useInstagramCache();

  // Pagination State
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const loadingRef = useRef(false);
  const postsRef = useRef(posts);
  const selectedSourceRef = useRef(selectedSource);
  const selectedStoriesRef = useRef(null);
  postsRef.current = posts;
  selectedSourceRef.current = selectedSource;

  // Helper: Format date to IST string
  const formatIST = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  };

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
      const handle = selectedSource.identifier.replace('@', '').toLowerCase();
      filtered = filtered.filter(post =>
        post.author_handle?.toLowerCase().replace('@', '') === handle ||
        post.author?.toLowerCase().includes(handle) ||
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
        case 'views':
          return (b.engagement?.views || 0) - (a.engagement?.views || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [posts, searchQuery, riskFilter, sortBy, selectedSource, timeFilter, dateRange, keywordFilter]);

  // Helper to determine if a source is considered "Official"
  const isSourceOfficial = useCallback((s) => {
    const cat = (s.category || '').toLowerCase();
    const name = (s.display_name || '').toLowerCase();
    const handle = (s.identifier || '').toLowerCase();

    if (cat === 'general') return false;
    if (['official', 'government', 'govt', 'party', 'public_representative'].includes(cat)) return true;
    if (s.is_verified) return true;

    const keywords = ['brs', 'congress', 'inc', 'bjp', 'aimim', 'mim', 'govt', 'official', 'telangana', 'hyderabad', 'police', 'collector', 'minister', 'cmo', 'office', 'media'];
    return keywords.some(k => name.includes(k) || handle.includes(k));
  }, []);

  const officialSources = useMemo(() => {
    return sources.filter(isSourceOfficial);
  }, [sources, isSourceOfficial]);

  // Toggle Official Status
  const handleMarkOfficial = async (source) => {
    try {
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

  const officialPosts = useMemo(() => {
    const officialSourceIds = new Set(officialSources.map(s => s.id));
    return filteredPosts.filter(p => officialSourceIds.has(p.source_id));
  }, [filteredPosts, officialSources]);

  // Export filtered posts to Excel
  const exportToExcel = () => {
    if (filteredPosts.length === 0) {
      toast.error('No posts to export');
      return;
    }

    const worksheetData = filteredPosts.map(post => ({
      'Author': post.author || 'N/A',
      'Handle': post.author_handle || 'N/A',
      'Content': post.text || 'N/A',
      'Published (IST)': formatIST(post.published_at),
      'Risk Level': post.risk_level || post.analysis?.risk_level || 'low',
      'Risk Score': post.risk_score || post.analysis?.violence_score || 0,
      'Keywords Detected': (post.risk_factors?.map(f => f.keyword || f).join(', ') || post.analysis?.triggered_keywords?.join(', ')) || 'None',
      'Views': post.engagement?.views || 0,
      'Likes': post.engagement?.likes || 0,
      'Comments': post.engagement?.comments || 0,
      'Post URL': post.content_url || 'N/A'
    }));

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Posts');

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
    const filename = `instagram_monitor_${selectedSource ? selectedSource.identifier.replace('@', '') : 'all'}_${keywordFilter !== 'all' ? keywordFilter + '_' : ''}${new Date().toISOString().split('T')[0]}.xlsx`;
    saveAs(data, filename);
    toast.success('Excel report exported successfully');
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    const cachedSources = getSources();
    const cachedStories = getContent('monitor', 'stories');
    const cachedReels = getReels(selectedSourceRef.current?.id || 'all');

    if (cachedSources) setSources(cachedSources);
    if (cachedStories?.items) setStories(cachedStories.items);
    if (cachedReels?.items) {
      setPosts(cachedReels.items);
      setPage(cachedReels.page || 1);
      setHasMore(!!cachedReels.hasMore);
    }

    setStatsLoading(true);
    try {
      const handleParam = searchParams.get('handle');

      const [srcRes, statsRes, storiesRes] = await Promise.all([
        api.get('/sources?platform=instagram'),
        api.get('/content/stats?platform=instagram'),
        api.get('/content?platform=instagram&content_type=story&limit=50')
      ]);

      setSources(srcRes.data);
      setCachedSources(srcRes.data);
      
      // Process stories
      const storiesData = Array.isArray(storiesRes.data) ? storiesRes.data : (storiesRes.data.content || storiesRes.data.items || []);
      setStories(storiesData);
      setContent('monitor', 'stories', storiesData, 1, false);

      // Auto-persist fetched stories to DB & S3
      if (storiesData.length > 0) {
        persistStoriesToDb(storiesData, { identifier: 'all' });
        fetchDbStories();
      }

      setStats({
        ...statsRes.data,
        totalSources: srcRes.data.length,
        totalPosts: statsRes.data.totalTweets || 0,
        totalStories: storiesData.length
      });

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
          fetchPostsPage(1, true, true);
        }
      } else if (!selectedSource) {
        fetchPostsPage(1, true, true);
      }
    } catch (error) {
      console.error('Initial fetch failed:', error);
      toast.error('Failed to load Instagram data');
    } finally {
      setStatsLoading(false);
    }
  };

  const fetchPostsPage = async (pageNum, reset = false, preferCache = false) => {
    if (pageNum > 1 && !hasMore) return;
    const selectedKey = selectedSourceRef.current?.id || 'all';
    if (preferCache && pageNum === 1 && reset) {
      const cached = getReels(selectedKey);
      if (cached?.items) {
        setPosts(cached.items);
        setPage(cached.page || 1);
        setHasMore(!!cached.hasMore);
      }
    }

    loadingRef.current = true;
    setLoading(true);
    try {
      const limit = pageNum === 1 ? 25 : 100;
      const sourceParam = selectedSourceRef.current ? `&source_id=${selectedSourceRef.current.id}` : '';
      const res = await api.get(`/content?platform=instagram&page=${pageNum}&limit=${limit}${sourceParam}`);

      const newPosts = Array.isArray(res.data) ? res.data : (res.data.content || res.data.items || []);
      const mergedPosts = reset ? newPosts : [...postsRef.current, ...newPosts];
      setPosts(mergedPosts);
      setHasMore(newPosts.length === limit);
      setPage(pageNum);
      setReels(selectedKey, mergedPosts, pageNum, newPosts.length === limit);
    } catch (error) {
      console.error('Failed to fetch posts:', error);
      toast.error('Failed to load posts');
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  // Fetch Instagram profile when source is selected
  const fetchProfileData = async (sourceId) => {
    const cachedProfile = getProfile(sourceId);
    const cachedProfileStories = getContent(sourceId, 'stories');
    if (cachedProfile) setProfileData(cachedProfile);
    if (cachedProfileStories?.items) setProfileStories(cachedProfileStories.items);

    setProfileLoading(true);
    try {
      const [profileRes, storiesRes] = await Promise.all([
        api.get(`/sources/${sourceId}/instagram-profile`),
        api.get(`/content?platform=instagram&content_type=story&source_id=${sourceId}&limit=50`)
      ]);
      setProfileData(profileRes.data);
      setProfile(sourceId, profileRes.data);
      const storiesData = Array.isArray(storiesRes.data) ? storiesRes.data : (storiesRes.data.content || storiesRes.data.items || []);
      setProfileStories(storiesData);
      setContent(sourceId, 'stories', storiesData, 1, false);

      // Persist profile stories to DB & S3
      const source = sources.find(s => s.id === sourceId);
      if (storiesData.length > 0 && source) {
        persistStoriesToDb(storiesData, source);
        fetchDbStories(sourceId);
      }
    } catch (error) {
      console.error('Failed to fetch profile data:', error);
      setProfileData(null);
      setProfileStories([]);
    } finally {
      setProfileLoading(false);
    }
  };

  // Refetch posts when source changes
  useEffect(() => {
    setSelectedSourceTab('posts');
    fetchPostsPage(1, true, true);
    if (selectedSource) {
      window.scrollTo(0, 0);
      fetchProfileData(selectedSource.id);
    } else {
      setProfileData(null);
      setProfileStories([]);
    }
  }, [selectedSource]);

  useEffect(() => {
    if (!selectedSource || selectedSourceTab !== 'stories') return;
    const timer = window.setTimeout(() => {
      selectedStoriesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [selectedSource, selectedSourceTab]);

  // Function to load more
  const loadMorePosts = useCallback(() => {
    if (!loadingRef.current && hasMore) {
      fetchPostsPage(page + 1);
    }
  }, [hasMore, page]);

  // Infinite Scroll Ref
  const observer = useRef();
  const lastElementRef = useCallback(node => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
        loadMorePosts();
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore, loadMorePosts]);

  const handleAddSource = async (e) => {
    e.preventDefault();
    if (!sourceHandle.trim()) {
      toast.error('Please enter a username');
      return;
    }

    try {
      await api.post('/sources', {
        platform: 'instagram',
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
      : contextSources;

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

  const handleScanNow = async (sourceId) => {
    setScanning(true);
    try {
      const res = await api.post(`/sources/${sourceId}/scan`);
      toast.success(res.data.message || 'Manual scan initiated.');
      fetchInitialData();
    } catch (err) {
      console.error('Scan failed:', err);
      toast.error(err.response?.data?.message || 'Manual scan failed.');
    } finally {
      setScanning(false);
    }
  };

  const handleScanAll = async () => {
    setScanning(true);
    try {
      const res = await api.post('/sources/scan-all', { platform: 'instagram' });
      toast.success(res.data.message || 'Mass scan completed.');
      fetchInitialData();
    } catch (err) {
      console.error('Mass scan failed:', err);
      toast.error(err.response?.data?.message || 'Mass scan failed.');
    } finally {
      setScanning(false);
    }
  };

  // ─── Fetch stored stories from DB ─────────────────────────────────────
  const fetchDbStories = useCallback(async (sourceId = null) => {
    setDbStoriesLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (sourceId) params.set('source_id', sourceId);
      const res = await api.get(`/instagram-stories?${params.toString()}`);
      const data = res.data?.stories || [];
      setDbStories(data);
      // Merge viewed state
      const viewed = new Set(viewedStoryIds);
      data.filter(s => s.viewed).forEach(s => viewed.add(s.id));
      setViewedStoryIds(viewed);
      return data;
    } catch (err) {
      console.error('[Stories] Failed to fetch DB stories:', err);
      return [];
    } finally {
      setDbStoriesLoading(false);
    }
  }, [viewedStoryIds]);

  // Persist fetched stories to backend DB
  const persistStoriesToDb = useCallback(async (storyItems, source) => {
    if (!storyItems || storyItems.length === 0) return;
    try {
      await api.post('/instagram-stories/store', {
        stories: storyItems,
        source_id: source?.id || source?.source_id,
        author_handle: source?.identifier || source?.handle || source?.author_handle,
        author: source?.display_name || source?.name || source?.author,
        author_avatar: source?.profile_image_url || source?.author_avatar
      });
    } catch (err) {
      console.error('[Stories] Failed to persist stories:', err.message);
    }
  }, []);

  // Open story in the in-page viewer
  const openStoryViewer = useCallback((story, storySource, allStories) => {
    const storiesToShow = allStories || stories;
    const idx = storiesToShow.findIndex(s =>
      (s.id && s.id === story.id) ||
      (s.story_pk && s.story_pk === story.story_pk) ||
      (s.content_id && s.content_id === story.content_id)
    );
    setStoryViewerStories(storiesToShow);
    setStoryViewerIndex(idx >= 0 ? idx : 0);
    setStoryViewerOpen(true);
  }, [stories]);

  // Handle story viewed callback
  const handleStoryViewed = useCallback(async (storyId) => {
    setViewedStoryIds(prev => new Set([...prev, storyId]));
    try {
      await api.put(`/instagram-stories/${storyId}/viewed`);
    } catch (err) {
      // Silent fail for viewed tracking
    }
  }, []);

  // Handle story deletion from viewer
  const handleStoryDeleteFromViewer = useCallback((storyId) => {
    setStories(prev => prev.filter(s => s.id !== storyId));
    setProfileStories(prev => prev.filter(s => s.id !== storyId));
    setDbStories(prev => prev.filter(s => s.id !== storyId));
  }, []);

  const getStoryExpiration = useCallback((story) => {
    if (!story) return { expiresAt: null, isExpired: false, timeLeftHours: null };
    const expiresAt = story.scraped_content?.includes('expires:')
      ? new Date(story.scraped_content.split('expires:')[1].trim())
      : story.published_at
        ? new Date(new Date(story.published_at).getTime() + 24 * 60 * 60 * 1000)
        : null;
    const now = new Date();
    const isExpired = expiresAt ? expiresAt < now : false;
    const timeLeftHours = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / (1000 * 60 * 60))) : null;
    return { expiresAt, isExpired, timeLeftHours };
  }, []);

  // Auto-remove unavailable/expired stories from UI
  const activeStories = useMemo(() => {
    const now = new Date();
    return stories.filter(story => {
      const { isExpired } = getStoryExpiration(story);
      // Remove expired stories from display
      if (isExpired) return false;
      // Remove stories marked as unavailable
      if (story.is_available === false) return false;
      return true;
    });
  }, [stories, getStoryExpiration]);

  const activeProfileStories = useMemo(() => {
    const now = new Date();
    return profileStories.filter(story => {
      const { isExpired } = getStoryExpiration(story);
      if (isExpired) return false;
      if (story.is_available === false) return false;
      return true;
    });
  }, [profileStories, getStoryExpiration]);

  // Fetch DB stories on mount
  useEffect(() => {
    fetchDbStories();
  }, []);

  // Source map for building source info for posts
  const sourceMap = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources]
  );

  const buildSourceForPost = useCallback((post) => {
    const source = sourceMap.get(post?.source_id);
    if (!source) return null;
    return {
      name: source.display_name || source.identifier,
      handle: source.identifier,
      is_verified: source.is_verified,
      profile_image_url: source.profile_image_url
    };
  }, [sourceMap]);

  const handleProfileAvatarClick = useCallback(() => {
    setSelectedSourceTab('stories');
  }, []);

  const openStoryInInstagram = useCallback((story, storySource) => {
    // Open in-page viewer instead of redirecting to Instagram
    const allStories = selectedSource ? activeProfileStories : activeStories;
    openStoryViewer(story, storySource, allStories);
  }, [selectedSource, activeProfileStories, activeStories, openStoryViewer]);

  const profileAvatarCandidates = useMemo(() => buildProfileImageCandidates({
    profile_image_url: selectedSource?.profile_image_url,
    profile_pic_url: profileData?.profile_pic_url,
    identifier: selectedSource?.identifier,
    username: profileData?.username
  }, [], [
    profileData?.username,
    selectedSource?.identifier
  ]), [selectedSource?.profile_image_url, profileData?.profile_pic_url, selectedSource?.identifier, profileData?.username]);

  return (
    <div className="p-6 md:p-8 max-w-[1800px] mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between gap-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
            <ChevronRight className="h-4 w-4" />
            <span className="text-foreground font-medium">Instagram Monitor</span>
          </div>
          <div className="flex items-center gap-3">
            {selectedSource ? (
              <Button variant="ghost" size="icon" onClick={() => setSelectedSource(null)} className="mr-2">
                <ChevronRight className="h-6 w-6 rotate-180" />
              </Button>
            ) : (
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
                <Instagram className="h-7 w-7 text-white" />
              </div>
            )}
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">
                {selectedSource ? selectedSource.display_name : 'Instagram Intelligence'}
              </h1>
              <p className="text-muted-foreground mt-1 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                {selectedSource ? `Monitoring since ${new Date(selectedSource.created_at).toLocaleDateString()}` : 'Real-time Instagram monitoring and risk detection'}
              </p>
            </div>
          </div>
        </div>
        {!selectedSource && (
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="outline"
              onClick={handleScanAll}
              disabled={scanning || sources.length === 0}
              className="gap-2 border-purple-200 text-purple-700 hover:bg-purple-50"
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {scanning ? 'Scanning...' : 'Scan All Profiles'}
            </Button>
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
              className="gap-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 shadow-lg text-white"
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
                  <DialogTitle>Monitor New Instagram Account</DialogTitle>
                  <DialogDescription>
                    Add an Instagram username to start monitoring.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddSource} className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Username</Label>
                      <Input
                        placeholder="@username"
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

                  <Button type="submit" className="w-full h-11 bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600">Start Monitoring</Button>
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
            <div className="h-32 bg-gradient-to-r from-purple-500 to-pink-500 relative">
              <div className="absolute bottom-4 right-4 flex gap-2">
                <Button variant="secondary" size="sm" className="bg-white/90 hover:bg-white text-black text-xs font-semibold backdrop-blur-sm" onClick={() => window.open(`https://instagram.com/${selectedSource.identifier.replace('@', '')}`, '_blank')}>
                  <ExternalLink className="h-3 w-3 mr-1.5" />
                  View on Instagram
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="bg-white/90 hover:bg-white text-purple-700 text-xs font-semibold backdrop-blur-sm"
                  onClick={() => handleScanNow(selectedSource.id)}
                  disabled={scanning}
                >
                  {scanning ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1.5" />}
                  Scan Now
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
                  {/* Profile Picture with Story Ring if has active stories */}
                  <button
                    type="button"
                    onClick={handleProfileAvatarClick}
                    className={cn(
                      "p-1 -mt-12 rounded-2xl shadow-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500",
                      profileStories.length > 0
                        ? "bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 hover:brightness-105"
                        : "bg-card border-4 border-card hover:border-purple-300"
                    )}
                    title={profileStories.length > 0 ? 'View active stories' : 'Open stories tab'}
                    aria-label="Open profile stories"
                  >
                    <Avatar className={cn(
                      "h-24 w-24 rounded-xl",
                      profileStories.length > 0 && "border-2 border-white"
                    )}>
                      <ResilientAvatarContent
                        candidates={profileAvatarCandidates}
                        alt={profileData?.username || selectedSource?.identifier || 'profile'}
                        fallbackText={(profileData?.full_name || selectedSource?.display_name || 'I').slice(0, 2)}
                        className="w-full h-full object-cover rounded-xl"
                      />
                    </Avatar>
                  </button>
                  <div className="mt-4 md:mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-2xl font-bold">{profileData?.full_name || selectedSource.display_name}</h2>
                      {(profileData?.is_verified || selectedSource.is_verified) && <BadgeCheck className="h-5 w-5 text-blue-500" />}
                      {selectedSource.category === 'high_risk' && (
                        <Badge variant="destructive" className="ml-2 text-xs">High Risk Entity</Badge>
                      )}
                      {profileData?.is_private && (
                        <Badge variant="outline" className="ml-2 text-xs">Private Account</Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground font-medium">@{profileData?.username || selectedSource.identifier}</p>
                    
                    {/* Bio */}
                    {profileData?.biography && (
                      <p className="text-sm text-foreground max-w-lg whitespace-pre-wrap">{profileData.biography}</p>
                    )}

                    {/* Stats Row */}
                    <div className="flex gap-6 pt-2">
                      <div className="text-center">
                        <p className="text-lg font-bold">{(profileData?.media_count || selectedSource.statistics?.video_count || 0).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Posts</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold">{(profileData?.followers_count || selectedSource.statistics?.subscriber_count || 0).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Followers</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold">{(profileData?.following_count || 0).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Following</p>
                      </div>
                      {profileStories.length > 0 && (
                        <div className="text-center">
                          <p className="text-lg font-bold text-pink-500">{profileStories.length}</p>
                          <p className="text-xs text-muted-foreground">Active Stories</p>
                        </div>
                      )}
                    </div>

                    {/* Category & External Link */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {(profileData?.category || selectedSource.category) && (
                        <Badge variant="secondary" className="text-xs capitalize">
                          {profileData?.category || selectedSource.category}
                        </Badge>
                      )}
                      {profileData?.external_url && (
                        <a 
                          href={profileData.external_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {profileData.external_url.replace(/^https?:\/\//, '').slice(0, 30)}
                        </a>
                      )}
                    </div>

                    <div className="flex gap-4 text-xs text-muted-foreground pt-1">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        Monitoring since {new Date(selectedSource.created_at).toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5" />
                        {filteredPosts.length} Posts Analyzed
                      </div>
                    </div>
                  </div>
                </div>

                {/* Loading indicator for profile */}
                {profileLoading && (
                  <div className="absolute top-4 left-4">
                    <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Tabs value={selectedSourceTab} onValueChange={setSelectedSourceTab} className="space-y-6">
            <TabsList className="bg-background border p-1 h-auto w-full justify-start">
              <TabsTrigger value="posts" className="px-6 py-2.5">
                <Instagram className="h-4 w-4 mr-2" />
                Posts
              </TabsTrigger>
              <TabsTrigger value="stories" className="px-6 py-2.5">
                <Circle className="h-4 w-4 mr-2" />
                Stories
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
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{filteredPosts.length} posts</Badge>
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

              {filteredPosts.length > 0 ? (
                <div className={cn(
                  viewMode === 'grid'
                    ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
                    : "space-y-5 max-w-[760px] mx-auto"
                )}>
                  {filteredPosts.map(post => {
                    const postSource = buildSourceForPost(post);
                    return (
                      <div key={post.id || post.content_id} className={cn(viewMode === 'list' ? "w-full" : "h-full")}>
                        <InstagramReelCard
                          content={post}
                          source={postSource}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-16 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                  <Instagram className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <h3 className="text-lg font-semibold text-foreground">No posts found</h3>
                  <p>We haven't detected any posts from this source yet.</p>
                </div>
              )}

              {hasMore && (
                <div ref={lastElementRef} className="py-8 flex flex-col items-center gap-4 min-h-[80px]">
                  {loading && (
                    <div className="flex flex-col items-center gap-3 animate-in fade-in duration-300">
                      <div className="relative">
                        <div className="absolute inset-0 bg-purple-500/20 blur-xl rounded-full"></div>
                        <Loader2 className="h-8 w-8 animate-spin text-purple-600 relative z-10" />
                      </div>
                      <p className="text-sm font-medium text-muted-foreground animate-pulse">Fetching more posts...</p>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Stories Tab for Selected Source */}
            <TabsContent value="stories" className="space-y-4" ref={selectedStoriesRef}>
              <div className="flex items-center justify-between mb-4">
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <div className="p-1.5 rounded-full bg-gradient-to-tr from-[#FCAF45] via-[#E1306C] to-[#833AB4]">
                      <Circle className="h-4 w-4 text-white" />
                    </div>
                    Stories from @{selectedSource?.identifier?.replace('@', '')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {activeProfileStories.length > 0 ? `${activeProfileStories.length} active stories` : 'Active stories from this profile'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchProfileData(selectedSource.id)}
                  disabled={profileLoading}
                  className="gap-2"
                >
                  {profileLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh Stories
                </Button>
              </div>

              {profileLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
                </div>
              ) : activeProfileStories.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {activeProfileStories.map((story) => {
                    const storySource = buildSourceForPost(story);
                    const { isExpired, timeLeftHours } = getStoryExpiration(story);
                    const isViewed = viewedStoryIds.has(story.id) || story.viewed;
                    return (
                      <StoryGridTile
                        key={story.id || story.content_id || story.content_url || `${story.author_handle}-${story.published_at}`}
                        story={{ ...story, viewed: isViewed }}
                        storySource={storySource}
                        isExpired={isExpired}
                        timeLeftHours={timeLeftHours}
                        publishedLabel={formatIST(story.published_at)}
                        onOpenStory={openStoryInInstagram}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-16 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                  <div className="p-3 rounded-full bg-gradient-to-tr from-[#FCAF45] via-[#E1306C] to-[#833AB4] w-fit mx-auto mb-4">
                    <Circle className="h-8 w-8 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">No Active Stories</h3>
                  <p>This profile has no active stories right now.</p>
                  <p className="text-xs text-muted-foreground mt-2">Stories expire after 24 hours</p>
                </div>
              )}}
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
          {/* Stats Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Monitored Accounts', value: stats.totalSources, icon: Users, color: 'bg-purple-50', iconColor: 'text-purple-600' },
              { label: 'Analyzed Posts', value: stats.totalPosts, icon: FileText, color: 'bg-pink-50', iconColor: 'text-pink-600' },
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
              <TabsTrigger value="posts" className="px-4 py-2.5">
                <Instagram className="h-4 w-4 mr-2" />
                All Posts ({stats.totalPosts})
              </TabsTrigger>
              <TabsTrigger value="stories" className="px-4 py-2.5">
                <Circle className="h-4 w-4 mr-2" />
                Stories ({activeStories.length})
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
                      {loading && posts.length === 0 ? (
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
                        filteredPosts
                          .filter(p => {
                            const isHighRisk = p.risk_level === 'high' || p.risk_level === 'critical' || p.analysis?.risk_level === 'HIGH' || p.analysis?.risk_level === 'CRITICAL';
                            const hasAI = (p.risk_factors || p.analysis?.triggered_keywords || []).some(k => (k.keyword || k).toString().includes('[AI]'));
                            return isHighRisk || hasAI;
                          })
                          .slice(0, 5)
                          .map(post => {
                            const postSource = buildSourceForPost(post);
                            return (
                              <div key={post.id || post.content_id} className="flex gap-3 p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors group">
                                <Avatar className="h-8 w-8 cursor-pointer hover:ring-2 hover:ring-purple-500 transition-all">
                                  <ResilientAvatarContent
                                    candidates={buildProfileImageCandidates(postSource || {}, [
                                      post?.author_avatar,
                                      post?.author_profile_image_url,
                                      post?.profile_image_url
                                    ])}
                                    alt={postSource?.handle || post?.author_handle || post?.author || 'profile'}
                                    fallbackText={(post?.author || postSource?.name || 'I').slice(0, 2)}
                                  />
                                </Avatar>
                                <div className="flex-1 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-sm cursor-pointer hover:text-purple-600 hover:underline">
                                      {post.author || postSource?.name}
                                    </span>
                                    <RiskBadge level={post.risk_level || post.analysis?.risk_level} score={post.risk_score || post.analysis?.violence_score} />
                                  </div>
                                  <p className="text-xs text-muted-foreground line-clamp-2">{post.text}</p>
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1">
                                    <span>{formatIST(post.published_at)}</span>
                                    <span>•</span>
                                    <a href={post.content_url} target="_blank" rel="noopener noreferrer" className="hover:underline text-purple-500">View Post</a>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                      )}
                      {!loading && filteredPosts.filter(p => {
                        const isHighRisk = p.risk_level === 'high' || p.risk_level === 'critical' || p.analysis?.risk_level === 'HIGH' || p.analysis?.risk_level === 'CRITICAL';
                        const hasAI = (p.risk_factors || p.analysis?.triggered_keywords || []).some(k => (k.keyword || k).toString().includes('[AI]'));
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
                        <Activity className="h-5 w-5 text-purple-600" />
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
                            <p className="font-medium text-sm">Instagram Data API</p>
                            <p className="text-xs text-muted-foreground">RapidAPI Integration</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">Operational</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-purple-100 rounded-full">
                            <Clock className="h-4 w-4 text-purple-600" />
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
                      className="h-8 gap-2 border-purple-200 text-purple-700 hover:bg-purple-50"
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
                        const updateCount = officialPosts.filter(p => p.source_id === source.id).length;
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
                            <TableCell className="font-medium text-purple-600 flex items-center gap-2">
                              @{source.identifier}
                              {source.is_verified && <BadgeCheck className="h-4 w-4 text-blue-500" />}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar className="h-9 w-9 border">
                                  <ResilientAvatarContent
                                    candidates={buildProfileImageCandidates(source)}
                                    alt={source.display_name}
                                    fallbackText={(source.display_name || source.identifier || 'I').slice(0, 2)}
                                  />
                                </Avatar>
                                <div className="flex flex-col">
                                  <span className="font-medium text-sm">{source.display_name}</span>
                                  {updateCount > 0 && (
                                    <Badge variant="secondary" className="mt-1 w-fit text-[10px] bg-purple-50 text-purple-700">
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
                    <CardTitle>Monitored Instagram Accounts</CardTitle>
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
                        source.display_name?.toLowerCase().includes(sourceSearchQuery.toLowerCase()) ||
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
                          <TableCell className="font-medium text-purple-600 flex items-center gap-2">
                            @{source.identifier}
                            {source.is_verified && <BadgeCheck className="h-3.5 w-3.5 text-blue-500" />}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9 border">
                                <ResilientAvatarContent
                                  candidates={buildProfileImageCandidates(source)}
                                  alt={source.display_name}
                                  fallbackText={(source.display_name || source.identifier || 'I').slice(0, 2)}
                                />
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

            {/* Posts Tab */}
            <TabsContent value="posts" className="space-y-6">
              <div className="flex flex-col gap-4 mb-4">
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search posts..."
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
                  <Badge variant="secondary">{filteredPosts.length} posts</Badge>
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

              <div className={cn(
                viewMode === 'grid'
                  ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
                  : "space-y-5 max-w-[760px] mx-auto"
              )}>
                {loading && posts.length === 0 ? (
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
                    {filteredPosts.map(post => {
                      const postSource = buildSourceForPost(post);
                      return (
                        <div key={post.id || post.content_id} className={cn(viewMode === 'list' ? "w-full" : "h-full")}>
                          <InstagramReelCard
                            content={post}
                            source={postSource}
                          />
                        </div>
                      );
                    })}
                    {filteredPosts.length === 0 && (
                      <div className="col-span-full text-center py-12 text-muted-foreground">
                        No posts found matching your criteria.
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
                        <div className="absolute inset-0 bg-purple-500/20 blur-xl rounded-full"></div>
                        <Loader2 className="h-8 w-8 animate-spin text-purple-600 relative z-10" />
                      </div>
                      <p className="text-sm font-medium text-muted-foreground animate-pulse">Fetching more posts...</p>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Stories Tab */}
            <TabsContent value="stories" className="space-y-6">
              <div className="flex items-center justify-between mb-4">
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <div className="p-1.5 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
                      <Circle className="h-4 w-4 text-white" />
                    </div>
                    Active Stories
                  </h3>
                  <p className="text-sm text-muted-foreground">Stories disappear after 24 hours • Click to view</p>
                </div>
                <Badge variant="secondary" className="text-sm">
                  {activeStories.length} stories
                </Badge>
              </div>

              {activeStories.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {activeStories.map((story) => {
                    const storySource = buildSourceForPost(story);
                    const { isExpired, timeLeftHours } = getStoryExpiration(story);
                    const isViewed = viewedStoryIds.has(story.id) || story.viewed;
                    return (
                      <StoryGridTile
                        key={story.id || story.content_id || story.content_url || `${story.author_handle}-${story.published_at}`}
                        story={{ ...story, viewed: isViewed }}
                        storySource={storySource}
                        isExpired={isExpired}
                        timeLeftHours={timeLeftHours}
                        publishedLabel={formatIST(story.published_at)}
                        onOpenStory={openStoryInInstagram}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-16 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                  <div className="p-3 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 w-fit mx-auto mb-4">
                    <Circle className="h-8 w-8 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">No Active Stories</h3>
                  <p>Stories from monitored accounts will appear here.</p>
                  <p className="text-sm mt-2">Stories are fetched during profile scans and expire after 24 hours.</p>
                </div>
              )}}
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* In-Page Story Viewer Overlay */}
      {storyViewerOpen && storyViewerStories.length > 0 && (
        <StoryViewer
          stories={storyViewerStories}
          initialIndex={storyViewerIndex}
          onClose={() => setStoryViewerOpen(false)}
          onViewed={handleStoryViewed}
          onDelete={handleStoryDeleteFromViewer}
          isAdmin={true}
        />
      )}
    </div>
  );
};

export default InstagramMonitor;
