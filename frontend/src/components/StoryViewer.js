import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, ChevronLeft, ChevronRight, Volume2, VolumeX, Play, Pause, Download, Loader2, Eye, Clock, Trash2, ExternalLink } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import api from '../lib/api';

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

/**
 * Full-screen in-page story viewer with Instagram-like UX.
 * Supports video playback, progress bars, navigation, download, and viewed state.
 */
const StoryViewer = ({
  stories = [],
  initialIndex = 0,
  onClose,
  onViewed,
  onDelete,
  isAdmin = false,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isMuted, setIsMuted] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [mediaSrcIdx, setMediaSrcIdx] = useState(0);

  const videoRef = useRef(null);
  const progressInterval = useRef(null);
  const containerRef = useRef(null);

  const STORY_DURATION = 6000; // 6 seconds for images

  const story = stories[currentIndex] || {};

  // Build media source candidates with S3 fallback
  const mediaCandidates = useMemo(() => {
    const candidates = [];
    const isVideo = story.media_type === 'video' || story.is_video;

    if (isVideo) {
      // Prefer S3 archived URL
      if (story.s3_url) candidates.push(story.s3_url);
      // Then try video_versions
      const versions = story.video_versions || story.videoVersions || [];
      versions.forEach(v => {
        const u = v?.url || v?.src;
        if (u) candidates.push(proxyUrl(u));
      });
      // Direct video URL
      if (story.video_url || story.videoUrl) candidates.push(proxyUrl(story.video_url || story.videoUrl));
      if (story.original_url) candidates.push(proxyUrl(story.original_url));
    } else {
      if (story.s3_url) candidates.push(story.s3_url);
      if (story.original_url) candidates.push(proxyUrl(story.original_url));
      if (story.thumbnail_url) candidates.push(proxyUrl(story.thumbnail_url));
      if (story.display_url) candidates.push(proxyUrl(story.display_url));
      if (story.image_url) candidates.push(proxyUrl(story.image_url));
    }

    // Also try s3_thumbnail as very last fallback for images
    if (story.s3_thumbnail_url) candidates.push(story.s3_thumbnail_url);

    // Extract from media array
    const media = Array.isArray(story.media) ? story.media : [];
    media.forEach(m => {
      const u = m?.url || m?.src;
      if (u) candidates.push(proxyUrl(u));
    });

    return [...new Set(candidates.filter(Boolean))];
  }, [story]);

  const currentSrc = mediaCandidates[mediaSrcIdx] || null;
  const isVideo = story.media_type === 'video' || story.is_video;

  // Navigate
  const goTo = useCallback((idx) => {
    if (idx < 0 || idx >= stories.length) {
      onClose?.();
      return;
    }
    setCurrentIndex(idx);
    setProgress(0);
    setMediaLoaded(false);
    setMediaSrcIdx(0);
  }, [stories.length, onClose]);

  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);

  // Mark viewed
  useEffect(() => {
    if (story.id && !story.viewed) {
      onViewed?.(story.id);
    }
  }, [story.id, story.viewed, onViewed]);

  // Image timer progress
  useEffect(() => {
    if (!mediaLoaded || isPaused || isVideo) return;

    const start = Date.now();
    progressInterval.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / STORY_DURATION) * 100, 100);
      setProgress(pct);
      if (pct >= 100) {
        clearInterval(progressInterval.current);
        goNext();
      }
    }, 50);

    return () => clearInterval(progressInterval.current);
  }, [mediaLoaded, isPaused, isVideo, currentIndex, goNext]);

  // Video progress
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideo) return;

    const handleTimeUpdate = () => {
      if (video.duration) {
        setProgress((video.currentTime / video.duration) * 100);
      }
    };
    const handleEnded = () => goNext();
    const handleLoadedData = () => setMediaLoaded(true);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('loadeddata', handleLoadedData);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('loadeddata', handleLoadedData);
    };
  }, [isVideo, goNext, currentIndex, mediaSrcIdx]);

  // Auto-play video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideo) return;

    if (isPaused) {
      video.pause();
    } else {
      video.play().catch(() => {});
    }
  }, [isPaused, isVideo, currentIndex, mediaSrcIdx]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          goNext();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          goPrev();
          break;
        case 'Escape':
          e.preventDefault();
          onClose?.();
          break;
        case ' ':
          e.preventDefault();
          setIsPaused(p => !p);
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          setIsMuted(m => !m);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goNext, goPrev, onClose]);

  // Handle download
  const handleDownload = async () => {
    const url = story.s3_url || story.original_url || currentSrc;
    if (!url) {
      toast.error('No media URL available for download');
      return;
    }

    setDownloading(true);
    try {
      const response = await fetch(proxyUrl(url));
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const ext = isVideo ? 'mp4' : 'jpg';
      link.download = `story_${story.author_handle || 'unknown'}_${story.story_pk || Date.now()}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.success('Story downloaded successfully');
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Failed to download story');
    } finally {
      setDownloading(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!window.confirm('Delete this story permanently? This will also remove it from S3.')) return;
    try {
      await api.delete(`/instagram-stories/${story.id}`);
      toast.success('Story deleted');
      onDelete?.(story.id);
      if (stories.length <= 1) {
        onClose?.();
      } else {
        goTo(currentIndex >= stories.length - 1 ? currentIndex - 1 : currentIndex);
      }
    } catch (error) {
      toast.error('Failed to delete story');
    }
  };

  // Computed values
  const timeAgo = story.published_at
    ? (() => {
        const diff = Date.now() - new Date(story.published_at).getTime();
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor(diff / (1000 * 60));
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return 'Just now';
      })()
    : '';

  const expiresIn = story.expires_at
    ? (() => {
        const diff = new Date(story.expires_at).getTime() - Date.now();
        if (diff <= 0) return 'Expired';
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
      })()
    : '';

  const isExpired = story.expires_at ? new Date(story.expires_at) < new Date() : false;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === containerRef.current) onClose?.();
      }}
    >
      {/* Story Container */}
      <div className="relative w-full max-w-[420px] h-full max-h-[95vh] mx-auto flex flex-col">
        {/* Progress Bars */}
        <div className="absolute top-0 left-0 right-0 z-30 flex gap-1 px-3 pt-2">
          {stories.map((_, i) => (
            <div key={i} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-100"
                style={{
                  width: i < currentIndex ? '100%' : i === currentIndex ? `${progress}%` : '0%'
                }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute top-4 left-0 right-0 z-30 flex items-center justify-between px-4 pt-2">
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className={cn(
              "w-9 h-9 rounded-full overflow-hidden border-2",
              story.viewed ? "border-gray-400" : "border-transparent bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-[2px]"
            )}>
              <div className="w-full h-full rounded-full overflow-hidden bg-black">
                {story.author_avatar ? (
                  <img
                    src={proxyUrl(story.author_avatar)}
                    alt={story.author_handle || ''}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500 text-white text-xs font-bold">
                    {(story.author_handle || story.author || '?').slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
            </div>
            <div>
              <p className="text-white text-sm font-semibold leading-tight">
                {story.author_handle ? `@${story.author_handle.replace('@', '')}` : story.author || 'Unknown'}
              </p>
              <div className="flex items-center gap-2 text-white/60 text-[11px]">
                <span>{timeAgo}</span>
                {expiresIn && !isExpired && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />
                      {expiresIn}
                    </span>
                  </>
                )}
                {isExpired && (
                  <>
                    <span>•</span>
                    <span className="text-red-400">Expired</span>
                  </>
                )}
                {story.is_archived && (
                  <>
                    <span>•</span>
                    <span className="text-emerald-400 text-[10px]">Archived</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Header Actions */}
          <div className="flex items-center gap-1">
            {isVideo && (
              <button
                onClick={(e) => { e.stopPropagation(); setIsMuted(m => !m); }}
                className="p-2 text-white/80 hover:text-white transition-colors"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setIsPaused(p => !p); }}
              className="p-2 text-white/80 hover:text-white transition-colors"
              title={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose?.(); }}
              className="p-2 text-white/80 hover:text-white transition-colors"
              title="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Media Area */}
        <div
          className="flex-1 flex items-center justify-center relative overflow-hidden rounded-xl mx-2 my-2"
          onClick={(e) => {
            e.stopPropagation();
            // Tap left/right to navigate
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < rect.width * 0.3) goPrev();
            else if (x > rect.width * 0.7) goNext();
            else setIsPaused(p => !p);
          }}
        >
          {!mediaLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
              <Loader2 className="h-10 w-10 animate-spin text-white/50" />
            </div>
          )}

          {isVideo && currentSrc ? (
            <video
              ref={videoRef}
              key={`${currentIndex}-${mediaSrcIdx}`}
              src={currentSrc}
              className="w-full h-full object-contain"
              muted={isMuted}
              playsInline
              autoPlay={!isPaused}
              preload="auto"
              onError={() => setMediaSrcIdx(prev => prev + 1 < mediaCandidates.length ? prev + 1 : prev)}
            />
          ) : currentSrc ? (
            <img
              key={`${currentIndex}-${mediaSrcIdx}`}
              src={currentSrc}
              alt="Story"
              className="w-full h-full object-contain"
              onLoad={() => setMediaLoaded(true)}
              onError={() => setMediaSrcIdx(prev => prev + 1 < mediaCandidates.length ? prev + 1 : prev)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 text-white/60">
              <Eye className="h-12 w-12" />
              <p className="text-sm">Story media unavailable</p>
              {story.content_url && (
                <a
                  href={story.content_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-purple-400 hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  View on Instagram
                </a>
              )}
            </div>
          )}

          {/* Left / Right navigation zones */}
          {currentIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); goPrev(); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/30 text-white/80 hover:bg-black/50 hover:text-white transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {currentIndex < stories.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); goNext(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/30 text-white/80 hover:bg-black/50 hover:text-white transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </div>

        {/* Footer Actions - Download inline (no popup) */}
        <div className="absolute bottom-4 left-0 right-0 z-30 flex items-center justify-center gap-3 px-4">
          {story.caption && (
            <div className="absolute bottom-14 left-4 right-4 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2 max-h-20 overflow-y-auto">
              <p className="text-white text-xs leading-relaxed">{story.caption}</p>
            </div>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); handleDownload(); }}
            disabled={downloading}
            className="text-white/80 hover:text-white hover:bg-white/10 gap-1.5"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="text-xs">{downloading ? 'Saving...' : 'Save'}</span>
          </Button>

          {story.content_url && (
            <a
              href={story.content_url || `https://instagram.com/${story.author_handle}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 text-white/80 hover:text-white text-xs px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              Open
            </a>
          )}

          {isAdmin && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              className="text-red-400/80 hover:text-red-400 hover:bg-red-500/10 gap-1.5"
            >
              <Trash2 className="h-4 w-4" />
              <span className="text-xs">Delete</span>
            </Button>
          )}
        </div>

        {/* Story counter */}
        <div className="absolute bottom-2 right-4 z-30 text-white/40 text-[11px]">
          {currentIndex + 1} / {stories.length}
        </div>
      </div>
    </div>
  );
};

export default StoryViewer;
