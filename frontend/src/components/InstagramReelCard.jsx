import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  MoreHorizontal,
  Play,
  Eye,
  Volume2,
  VolumeX,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Loader2,
  Trash2,
  Clock,
  Shield
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import api, { BACKEND_URL } from '../lib/api';
import { toast } from 'sonner';
import ReasonModal from './ReasonModal';

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

/*
  INSTAGRAM VIDEO PLAYER
  Fallback chain:
    1. Native video via backend proxy (proxied CDN URL)
    2. Native video direct CDN URL (no proxy)
    3. Instagram oEmbed iframe (content_url/embed/captioned/)
    4. Open on Instagram link (last-resort)
*/
const MODES = ['proxy', 'direct', 'embed', 'link'];

const InstagramVideoPlayer = ({ videoUrl, thumbnailUrl, embedUrl, contentUrl, isMuted, contentId }) => {
  const [modeIdx, setModeIdx] = useState(0);
  const [muted, setMuted] = useState(!!isMuted);
  const [playing, setPlaying] = useState(true);
  const [showPoster, setShowPoster] = useState(false);
  const videoRef = useRef(null);
  const retryTimerRef = useRef(null);
  const previewTimerRef = useRef(null);
  const previewedRef = useRef(false);

  const mode = MODES[modeIdx];

  const proxiedUrl = useMemo(() => proxyUrl(videoUrl), [videoUrl]);
  const posterUrl = useMemo(() => proxyUrl(thumbnailUrl), [thumbnailUrl]);

  const nextMode = useCallback(() => {
    setModeIdx((prev) => {
      const next = prev + 1;
      if (next < MODES.length) {
        console.warn('[InstaPlayer] Fallback ' + MODES[prev] + ' -> ' + MODES[next] + ' for ' + contentId);
        return next;
      }
      return prev;
    });
  }, [contentId]);

  const handlePlay = useCallback(() => {
    setShowPoster(false);
    setPlaying(true);
    const v = videoRef.current;
    if (v) {
      v.play().catch(() => {});
    }
  }, []);

  const handleVideoError = useCallback(() => {
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => nextMode(), 300);
  }, [nextMode]);

  useEffect(() => () => {
    clearTimeout(retryTimerRef.current);
    clearTimeout(previewTimerRef.current);
  }, []);

  useEffect(() => {
    setModeIdx(videoUrl ? 0 : 2);
    setShowPoster(false);
    setPlaying(true);
    previewedRef.current = false;
  }, [videoUrl, contentId]);

  if (mode === 'proxy' || mode === 'direct') {
    const src = mode === 'proxy' ? proxiedUrl : videoUrl;

    return (
      <div className="relative w-full h-full bg-black flex items-center justify-center">
        {showPoster && posterUrl && (
          <img
            src={posterUrl}
            alt="Reel thumbnail"
            className="absolute inset-0 w-full h-full object-contain"
          />
        )}
        <video
          ref={videoRef}
          key={contentId + '-' + mode}
          src={src}
          poster={posterUrl}
          controls
          playsInline
          muted={muted}
          autoPlay={playing}
          preload="metadata"
          controlsList="nodownload"
          referrerPolicy="no-referrer"
          className={`w-full h-full object-contain ${showPoster ? 'opacity-0' : 'opacity-100'}`}
          onError={handleVideoError}
          onCanPlay={() => {
            if (!videoRef.current) return;
            if (playing) {
              videoRef.current.play().catch(() => {});
              return;
            }
            if (!previewedRef.current) {
              previewedRef.current = true;
              videoRef.current.play().catch(() => {});
              clearTimeout(previewTimerRef.current);
              previewTimerRef.current = setTimeout(() => {
                if (videoRef.current) {
                  videoRef.current.pause();
                }
                setPlaying(false);
                setShowPoster(true);
              }, 100);
            }
          }}
          onPlay={() => {
            setShowPoster(false);
            setPlaying(true);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setShowPoster(true);
          }}
        />

        {showPoster && (
          <button
            onClick={handlePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors group"
          >
            <div className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <Play className="w-7 h-7 text-black ml-1" />
            </div>
          </button>
        )}

        <button
          className="absolute top-3 right-3 bg-black/60 rounded-full p-2 text-white hover:bg-black/80 transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); setMuted(m => !m); }}
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    );
  }

  if (mode === 'embed' && embedUrl) {
    return (
      <div className="relative w-full h-full bg-white">
        <iframe
          src={embedUrl}
          title="Instagram Reel"
          className="w-full h-full border-none"
          allowFullScreen
          allow="autoplay; encrypted-media"
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          onError={nextMode}
        />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-gray-900 to-black text-white gap-4 p-6">
      {posterUrl && (
        <img src={posterUrl} alt="Reel" className="max-h-[60%] rounded-lg object-contain opacity-60" />
      )}
      <div className="flex flex-col items-center gap-2 text-center">
        <AlertCircle className="w-8 h-8 text-gray-400" />
        <p className="text-sm text-gray-300">Unable to play this reel in-app.</p>
        {contentUrl && (
          <a
            href={contentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full text-white text-sm font-semibold hover:from-purple-600 hover:to-pink-600 transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Watch on Instagram
          </a>
        )}
      </div>
    </div>
  );
};

/* MAIN CARD COMPONENT */
// onRiskLevelChange / onSentimentChange are optional: ReasonModal hides its
// edit controls when they are not passed.
const InstagramReelCard = ({ content, source, onRefresh, onRiskLevelChange, onSentimentChange }) => {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [avatarIdx, setAvatarIdx] = useState(0);

  const handleQuickScan = async (e) => {
    e.stopPropagation();
    if (!content.source_id && !source?.id) {
      toast.error('Source ID not found for this post');
      return;
    }
    const sid = content.source_id || source.id;
    setIsScanning(true);
    try {
      const res = await api.post(`/sources/${sid}/scan`);
      toast.success(res.data.message || 'Scan initiated');
    } catch (err) {
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  const avatarCandidates = useMemo(() => {
    const raw = [
      source?.profile_image_url,
      content?.author_avatar,
      content?.author_profile_image_url,
      content?.profile_image_url,
      content?.author_profile_pic_url
    ].filter(Boolean);
    const candidates = [];
    raw.forEach((url) => {
      const proxied = proxyUrl(url);
      if (proxied && !candidates.includes(proxied)) candidates.push(proxied);
      if (proxied !== url && url && !candidates.includes(url)) candidates.push(url);
    });
    return candidates;
  }, [source?.profile_image_url, content?.author_avatar, content?.author_profile_image_url, content?.profile_image_url, content?.author_profile_pic_url]);
  const proxiedAvatar = avatarCandidates[avatarIdx] || null;

  const videoMedia = content.media?.find(m => m.type === 'video');
  const imageMedia = content.media?.find(m => m.type === 'photo');

  // Prefer S3 URLs (permanent) over CDN URLs (may expire / get deleted)
  const directVideoUrl = videoMedia?.s3_url || videoMedia?.url || '';
  const imageUrl = imageMedia?.s3_url || imageMedia?.url || '';
  const mediaUrl = directVideoUrl || imageUrl || content.content_url;
  const isReelLink = !!content.content_url && /instagram\.com\/(reel|p)\//i.test(content.content_url);
  const isVideo = !!videoMedia || isReelLink;
  const thumbnailUrl =
    videoMedia?.s3_preview || videoMedia?.preview ||
    videoMedia?.preview_image_url ||
    imageMedia?.s3_preview || imageMedia?.preview ||
    imageMedia?.s3_url || imageMedia?.url ||
    content.thumbnail_url ||
    mediaUrl;

  const embedUrl = content.content_url
    ? content.content_url.trim().replace(/\/$/, '') + '/embed/captioned/'
    : null;

  const dateStr = content.published_at || content.created_at || content.posted_at;
  const dateObj = dateStr ? new Date(dateStr) : null;
  const timeAgo = dateObj ? formatDistanceToNow(dateObj, { addSuffix: true }) : '';
  const fullDateTime = dateObj ? dateObj.toLocaleString() : '';

  const captionText = content.text || content.description || '';
  const shouldTruncate = captionText.length > 90;
  const displayedText = isExpanded || !shouldTruncate
    ? captionText
    : captionText.slice(0, 90) + '...';

  const engagement = content.engagement || {};
  const metrics = content.public_metrics || content.metrics || {};

  const likesCount = Number(
    engagement.likes || engagement.like_count || metrics.like_count || metrics.likes || content.like_count || 0
  );
  const viewsCount = Number(
    engagement.views || engagement.view_count || engagement.play_count || engagement.plays ||
    metrics.view_count || metrics.views || metrics.play_count ||
    content.view_count || content.video_view_count || content.play_count || content.plays ||
    content.reel_play_count || content.clips_view_count || 0
  );
  const commentsCount = Number(
    engagement.comments || engagement.comment_count || metrics.reply_count || metrics.comments || content.comment_count || 0
  );

  const profileHandleRaw = source?.handle || source?.username || content.author_handle || content.author || 'instagram_user';
  const profileHandle = profileHandleRaw.replace('@', '');
  const profileName = source?.name || source?.display_name || content.author || profileHandleRaw;
  const avatarFallbackText = (profileName || profileHandle || 'IG').slice(0, 2).toUpperCase();
  const profileTarget = content.source_id ? `/instagram-monitor/${content.source_id}` : `/instagram-monitor?handle=${profileHandle}`;

  useEffect(() => {
    setAvatarIdx(0);
  }, [content.id, content.content_id, source?.id, source?.profile_image_url]);

  if (!mediaUrl && !embedUrl) return null;

  return (
    <div className="bg-white border rounded-[3px] border-gray-200 mb-4 w-full shadow-sm h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]">
            <div className="w-full h-full rounded-full border-2 border-white bg-gray-100 overflow-hidden">
              {proxiedAvatar ? (
                <img
                  src={proxiedAvatar}
                  alt={profileHandle}
                  className="w-full h-full object-cover"
                  onError={() => {
                    setAvatarIdx((current) => (current < avatarCandidates.length - 1 ? current + 1 : avatarCandidates.length));
                  }}
                />
              ) : (
                <div className="w-full h-full bg-gray-200 flex items-center justify-center text-[10px] font-semibold text-gray-700">
                  {avatarFallbackText}
                </div>
              )}
            </div>
          </div>
          <div>
            <div className="flex flex-col">
              <span
                className="text-sm font-semibold hover:underline cursor-pointer"
                onClick={() => navigate(profileTarget)}
              >
                @{profileHandle}
              </span>
              <span className="text-[10px] text-gray-400" title={timeAgo}>
                {fullDateTime}
              </span>
            </div>
            {content.location && (
              <div className="text-xs text-gray-500">{content.location}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(content.source_id || source?.id) && (
            <button
              onClick={handleQuickScan}
              disabled={isScanning}
              title="Scan this profile now"
              className="p-1.5 hover:bg-gray-100 rounded-full transition-colors text-purple-600 disabled:opacity-50"
            >
              {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
          )}
          {(content.analysis || content.risk_score > 0) && (
            <button
              onClick={() => setShowReasonModal(true)}
              title="View Analysis Details"
              className="hover:opacity-60 transition-opacity p-1"
            >
              <Shield className={`w-5 h-5 ${(content.risk_level === 'high' || content.risk_level === 'critical' || content.analysis?.risk_level === 'HIGH') ? 'text-red-500 fill-red-100' :
                (content.risk_level === 'medium' || content.analysis?.risk_level === 'MEDIUM') ? 'text-amber-500 fill-amber-100' :
                  'text-blue-500 fill-blue-50'
                }`} />
            </button>
          )}
          <button
            className="hover:opacity-60 transition-opacity"
            onClick={() => content.content_url && window.open(content.content_url, '_blank')}
            title="Open on Instagram"
          >
            <MoreHorizontal className="w-5 h-5 text-gray-600 cursor-pointer" />
          </button>
        </div>
      </div>

      {/* Media Content */}
      <div className={'relative w-full overflow-hidden ' + (isVideo ? 'aspect-[9/16] max-h-[680px]' : 'aspect-square')}>
        {/* Deleted / Expired badge */}
        {content.is_deleted && (
          <div className="absolute top-3 left-3 z-20">
            <div className="bg-red-600/90 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-lg">
              <Trash2 className="w-3 h-3" />
              Deleted{content.deleted_at ? ` · ${new Date(content.deleted_at).toLocaleDateString()}` : ''}
            </div>
          </div>
        )}
        {content.is_expired && !content.is_deleted && (
          <div className="absolute top-3 left-3 z-20">
            <div className="bg-amber-500/90 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-lg">
              <Clock className="w-3 h-3" />
              Expired{content.expired_at ? ` · ${new Date(content.expired_at).toLocaleDateString()}` : ''}
            </div>
          </div>
        )}
        {isVideo ? (
          <InstagramVideoPlayer
            videoUrl={directVideoUrl}
            thumbnailUrl={thumbnailUrl}
            embedUrl={embedUrl}
            contentUrl={content.content_url}
            isMuted={isMuted}
            contentId={content.content_id || content.id}
          />
        ) : (
          <img
            src={proxyUrl(imageUrl || mediaUrl)}
            alt={source?.handle || source?.username || content.author_handle || 'Instagram Content'}
            className="w-full h-full object-contain bg-gray-100"
            onError={(e) => {
              if (e.target.src.includes('/api/media/stream')) {
                e.target.src = imageUrl || mediaUrl;
              }
            }}
          />
        )}
      </div>

      {/* Action Buttons */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsLiked(!isLiked)}
              className="hover:opacity-60 transition-opacity"
            >
              <Heart
                className={'w-6 h-6 ' + (isLiked ? 'fill-red-500 text-red-500' : 'text-black')}
              />
            </button>
            <button className="hover:opacity-60 transition-opacity">
              <MessageCircle className="w-6 h-6 text-black -rotate-90" />
            </button>
            <button className="hover:opacity-60 transition-opacity">
              <Send className="w-6 h-6 text-black" />
            </button>
          </div>
          <button
            onClick={() => setIsSaved(!isSaved)}
            className="hover:opacity-60 transition-opacity"
          >
            <Bookmark
              className={'w-6 h-6 ' + (isSaved ? 'fill-black text-black' : 'text-black')}
            />
          </button>
        </div>

        {/* Engagement Stats */}
        <div className="flex items-center gap-3 mb-2 text-sm">
          <span className="font-semibold">{likesCount.toLocaleString()} likes</span>
          {viewsCount > 0 && (
            <span className="text-gray-500 flex items-center gap-1">
              <Eye className="w-3.5 h-3.5" /> {viewsCount.toLocaleString()} views
            </span>
          )}
          {commentsCount > 0 && (
            <span className="text-gray-500 flex items-center gap-1">
              <MessageCircle className="w-3.5 h-3.5" /> {commentsCount.toLocaleString()}
            </span>
          )}
        </div>

        {/* Caption */}
        <div className="text-sm mb-2">
          <span
            className="font-semibold mr-2 hover:underline cursor-pointer"
            onClick={() => navigate(profileTarget)}
          >
            {source?.handle || content.author_handle || 'user'}
          </span>
          <span className="text-gray-900 whitespace-pre-wrap">
            {displayedText}
          </span>
          {shouldTruncate && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-500 text-xs ml-1 hover:text-gray-700 font-medium"
            >
              {isExpanded ? 'less' : 'more'}
            </button>
          )}
        </div>

        {/* Profile preview */}
        <div className="mt-3 p-3 bg-gray-50 rounded-md border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]">
              <div className="w-full h-full rounded-full border-2 border-white bg-gray-100 overflow-hidden">
                {proxiedAvatar ? (
                  <img
                    src={proxiedAvatar}
                    alt={profileHandle}
                    className="w-full h-full object-cover"
                    onError={() => {
                      setAvatarIdx((current) => (current < avatarCandidates.length - 1 ? current + 1 : avatarCandidates.length));
                    }}
                  />
                ) : (
                  <div className="w-full h-full bg-gray-200 flex items-center justify-center text-[11px] font-semibold text-gray-700">
                    {avatarFallbackText}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">@{profileHandle}</span>
              <span className="text-xs text-gray-500">{profileName}</span>
            </div>
          </div>
          <button
            className="text-xs font-semibold text-purple-600 hover:text-purple-800"
            onClick={() => navigate(profileTarget)}
          >
            View Profile
          </button>
        </div>

        {/* Comments Link */}
        {commentsCount > 0 && (
          <button
            className="text-gray-500 text-sm mb-2"
            onClick={() => content.content_url && window.open(content.content_url, '_blank')}
          >
            View all {commentsCount.toLocaleString()} comments
          </button>
        )}

        {/* Timestamp (relative) */}
        {timeAgo && (
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-1">
            {timeAgo}
          </div>
        )}
      </div>
      {/* Interaction Modal */}
      <ReasonModal
        open={showReasonModal}
        onClose={() => setShowReasonModal(false)}
        alert={content}
        content={content}
        analysis={content.analysis}
        onRiskLevelChange={onRiskLevelChange}
        onSentimentChange={onSentimentChange}
      />
    </div>
  );
};
export default InstagramReelCard;
