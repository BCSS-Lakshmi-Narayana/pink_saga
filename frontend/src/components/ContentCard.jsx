import React, { useState } from 'react';
import { ExternalLink, Youtube, Facebook, Instagram, Download, Repeat, Heart, MessageSquare, UserPlus, Play, ThumbsUp, Share2, Eye } from 'lucide-react';
import { Button } from './ui/button';
import ReactPlayer from 'react-player';
import { BACKEND_URL } from '../lib/api';

/* ──────────────────────────────────────────────
   Media proxy — route CDN URLs through backend
   to avoid CORS / hotlinking / referrer issues
   ────────────────────────────────────────────── */
const NEEDS_PROXY_RE = /(amazonaws\.com|\.fbcdn\.net|\.fbsbx\.com|lookaside\.facebook\.com|cdninstagram\.com|video\.twimg\.com|pbs\.twimg\.com|googlevideo\.com|ytimg\.com|ggpht\.com|googleusercontent\.com|scontent|bhaskar-media-storage)/i;

const proxyMediaUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl || '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/') || trimmed.startsWith(BACKEND_URL)) return trimmed;
  if (NEEDS_PROXY_RE.test(trimmed)) {
    return `${BACKEND_URL}/api/media/stream?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
};

/* ──────────────────────────────────────────────
   X (𝕏) Logo SVG — official glyph
   ────────────────────────────────────────────── */
const XLogo = ({ className = '' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

/* ──────────────────────────────────────────────
   Platform theme configs
   ────────────────────────────────────────────── */
const PLATFORM_THEMES = {
  x: {
    bg: 'bg-white dark:bg-zinc-900',
    text: 'text-zinc-900 dark:text-zinc-100',
    muted: 'text-zinc-500 dark:text-zinc-400',
    border: 'border-zinc-200 dark:border-zinc-700',
    accent: 'text-zinc-900 dark:text-zinc-100',
    icon: <XLogo className="h-4 w-4" />,
    name: '𝕏',
    engagement: [
      { key: 'comments', icon: MessageSquare, label: 'Replies' },
      { key: 'retweets', icon: Repeat, label: 'Reposts' },
      { key: 'likes', icon: Heart, label: 'Likes' },
      { key: 'views', icon: Eye, label: 'Views' }
    ]
  },
  youtube: {
    bg: 'bg-white dark:bg-zinc-900',
    text: 'text-zinc-900 dark:text-zinc-100',
    muted: 'text-zinc-500 dark:text-zinc-400',
    border: 'border-zinc-200 dark:border-zinc-700',
    accent: 'text-red-600',
    icon: <Youtube className="h-4 w-4 text-red-600" />,
    name: 'YouTube',
    engagement: [
      { key: 'views', icon: Eye, label: 'Views' },
      { key: 'likes', icon: ThumbsUp, label: 'Likes' },
      { key: 'comments', icon: MessageSquare, label: 'Comments' }
    ]
  },
  facebook: {
    bg: 'bg-white dark:bg-zinc-900',
    text: 'text-zinc-900 dark:text-zinc-100',
    muted: 'text-zinc-500 dark:text-zinc-400',
    border: 'border-zinc-200 dark:border-zinc-700',
    accent: 'text-blue-600',
    icon: <Facebook className="h-4 w-4 text-blue-600" />,
    name: 'Facebook',
    engagement: [
      { key: 'likes', icon: ThumbsUp, label: 'Like' },
      { key: 'comments', icon: MessageSquare, label: 'Comment' },
      { key: 'retweets', icon: Share2, label: 'Share' }
    ]
  },
  instagram: {
    bg: 'bg-white dark:bg-zinc-900',
    text: 'text-zinc-900 dark:text-zinc-100',
    muted: 'text-zinc-500 dark:text-zinc-400',
    border: 'border-zinc-200 dark:border-zinc-700',
    accent: 'text-pink-600',
    icon: <Instagram className="h-4 w-4 text-pink-600" />,
    name: 'Instagram',
    engagement: [
      { key: 'likes', icon: Heart, label: 'Likes' },
      { key: 'comments', icon: MessageSquare, label: 'Comments' }
    ]
  }
};

const DEFAULT_THEME = PLATFORM_THEMES.x;

/* ──────────────────────────────────────────────
   Media helpers
   ────────────────────────────────────────────── */
const getMediaUrl = (item) => {
  if (!item) return null;
  if (typeof item === 'string') return proxyMediaUrl(item) || null;
  const raw = item.s3_url || item.url || item.video_url || item.original_video_url || item.original_url || null;
  return raw ? proxyMediaUrl(raw) : null;
};

/* Facebook-specific: collect ALL candidate URLs for fallback chains */
const getAllMediaUrls = (item) => {
  if (!item) return [];
  if (typeof item === 'string') return [proxyMediaUrl(item)].filter(Boolean);
  const urls = [item.s3_url, item.url, item.video_url, item.original_video_url, item.original_url, item.s3_preview, item.preview_url, item.preview, item.original_preview].filter(Boolean);
  return [...new Set(urls.map(proxyMediaUrl))];
};

const getVideoUrl = (item) => {
  if (!item) return null;
  const raw = item.s3_url || item.video_url || item.original_video_url || item.url || item.original_url || null;
  return raw ? proxyMediaUrl(raw) : null;
};

const getMediaPreview = (item) => {
  const raw = item?.s3_preview || item?.preview_url || item?.preview || item?.original_preview || null;
  return raw ? proxyMediaUrl(raw) : null;
};

const getMediaType = (item) => {
  if (item.type === 'video' || item.type === 'animated_gif') return 'video';
  if (item.type === 'photo' || item.type === 'image') return 'photo';
  const url = getMediaUrl(item);
  if (!url) return 'photo';
  if (url.match(/\.(mp4|m3u8|webm|mov)(\?|$)/i)) return 'video';
  return 'photo';
};

const extractYouTubeId = (value) => {
  const input = String(value || '').trim();
  if (!input) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    const host = url.hostname.replace('www.', '').toLowerCase();
    if (host === 'youtu.be') {
      const seg = url.pathname.split('/').filter(Boolean)[0];
      return seg || null;
    }
    if (host.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return v;
      const parts = url.pathname.split('/').filter(Boolean);
      const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'live');
      if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1];
    }
  } catch {
    return null;
  }
  return null;
};

/* ──────────────────────────────────────────────
   Facebook-specific fallback components
   ────────────────────────────────────────────── */

/* FacebookImage: tries each URL in sequence; shows placeholder if all fail */
const FacebookImage = ({ urls, alt, className }) => {
  const [urlIdx, setUrlIdx] = React.useState(0);
  const [failed, setFailed] = React.useState(false);

  const handleError = () => {
    if (urlIdx + 1 < urls.length) {
      setUrlIdx(urlIdx + 1);
    } else {
      setFailed(true);
    }
  };

  if (failed) {
    return (
      <div className={`flex flex-col items-center justify-center bg-blue-50 text-blue-400 ${className}`}>
        <Facebook className="h-8 w-8 mb-1 opacity-50" />
        <span className="text-[10px] font-medium opacity-60">Image unavailable</span>
      </div>
    );
  }

  return <img src={urls[urlIdx]} alt={alt} className={className} loading="lazy" onError={handleError} />;
};

/* FacebookVideoPlayer: tries <video> first, then ReactPlayer, then preview poster with "View on Facebook" */
const FacebookVideoPlayer = ({ videoUrl, preview, contentUrl, fallbackUrls }) => {
  const [mode, setMode] = React.useState('native'); // 'native' | 'reactplayer' | 'poster'

  const handleVideoError = () => {
    if (mode === 'native') setMode('reactplayer');
    else setMode('poster');
  };

  if (mode === 'native') {
    return (
      <video
        src={videoUrl}
        controls
        poster={preview || undefined}
        className="absolute top-0 left-0 w-full h-full object-cover"
        preload="metadata"
        onError={handleVideoError}
      />
    );
  }

  if (mode === 'reactplayer') {
    return (
      <ReactPlayer
        url={videoUrl}
        controls
        width="100%"
        height="100%"
        style={{ position: 'absolute', top: 0, left: 0 }}
        onError={handleVideoError}
        config={{ file: { attributes: { poster: preview || undefined } } }}
      />
    );
  }

  /* Poster fallback — show preview image with "View on Facebook" overlay */
  const posterSrc = preview || (fallbackUrls && fallbackUrls.find(u => u && /\.(jpg|jpeg|png|webp)/i.test(u)));
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900">
      {posterSrc ? (
        <img src={posterSrc} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
      ) : null}
      <div className="relative z-10 flex flex-col items-center gap-2">
        <div className="w-14 h-14 rounded-full bg-blue-600/90 flex items-center justify-center shadow-lg">
          <Play className="h-7 w-7 text-white ml-0.5" />
        </div>
        {contentUrl && (
          <a href={contentUrl} target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors shadow">
            View on Facebook
          </a>
        )}
      </div>
    </div>
  );
};

const MediaGrid = ({ media, platformTheme, platform, contentUrl, contentId }) => {
  if (!media || media.length === 0) return null;
  const validItems = media.filter(m => getMediaUrl(m));
  if (validItems.length === 0) return null;

  const isFacebook = platform === 'facebook';

  const renderItem = (item, idx) => {
    const url = getMediaUrl(item);
    const videoUrl = getVideoUrl(item);
    const preview = getMediaPreview(item);
    const type = getMediaType(item);
    const fallbackUrls = isFacebook ? getAllMediaUrls(item) : [];

    const handleDownload = (e, downloadUrl) => {
      e.preventDefault();
      e.stopPropagation();
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = downloadUrl.split('/').pop()?.split('?')[0] || 'download';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    if (type === 'video') {
      const isYouTube =
        platform === 'youtube' ||
        url.includes('youtube.com') ||
        url.includes('youtu.be') ||
        String(contentUrl || '').includes('youtube.com') ||
        String(contentUrl || '').includes('youtu.be');
      const youtubeId =
        extractYouTubeId(contentId) ||
        extractYouTubeId(contentUrl) ||
        extractYouTubeId(url);

      return (
        <div key={idx} className={`relative rounded-xl overflow-hidden ${platformTheme.border} border group ${validItems.length > 1 ? 'aspect-square' : 'aspect-video'} bg-zinc-900`}>
          {isYouTube && youtubeId ? (
            <iframe
              src={`https://www.youtube.com/embed/${youtubeId}?rel=0&modestbranding=1`}
              title={`youtube-${youtubeId}`}
              className="absolute top-0 left-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          ) : isYouTube ? (
            <ReactPlayer
              url={contentUrl || url}
              controls
              width="100%"
              height="100%"
              style={{ position: 'absolute', top: 0, left: 0 }}
            />
          ) : isFacebook ? (
            <FacebookVideoPlayer videoUrl={videoUrl || url} preview={preview} contentUrl={contentUrl} fallbackUrls={fallbackUrls} />
          ) : (
            <video
              src={url}
              controls
              poster={preview || undefined}
              className="absolute top-0 left-0 w-full h-full object-cover"
              crossOrigin="anonymous"
              preload="metadata"
            />
          )}
          <button
            title="Download Media"
            onClick={(e) => handleDownload(e, videoUrl || url)}
            className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 text-white backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-black/80">
            <Download className="h-4 w-4" />
          </button>
        </div>
      );
    }

    /* Photo rendering with Facebook fallback chain */
    return (
      <div key={idx} className={`relative rounded-xl overflow-hidden ${platformTheme.border} border group ${validItems.length > 1 ? 'aspect-square' : ''}`}>
        {isFacebook ? (
          <FacebookImage
            urls={fallbackUrls.length > 0 ? fallbackUrls : [url]}
            alt=""
            className={`w-full h-full object-cover ${validItems.length === 1 ? 'max-h-[500px]' : ''}`}
          />
        ) : (
          <img
            src={url}
            alt=""
            className={`w-full h-full object-cover ${validItems.length === 1 ? 'max-h-[500px]' : ''}`}
            loading="lazy"
            onError={(e) => { e.target.closest('div').style.display = 'none'; }}
          />
        )}
        <button
          title="Download Media"
          onClick={(e) => handleDownload(e, url)}
          className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 text-white backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-black/80">
          <Download className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <div className={`${validItems.length > 1 ? 'grid grid-cols-2 gap-1' : ''} mt-3 rounded-xl overflow-hidden`}>
      {validItems.slice(0, 4).map(renderItem)}
    </div>
  );
};

const QuotedCard = ({ quoted, platformTheme }) => {
  if (!quoted) return null;
  const theme = platformTheme || DEFAULT_THEME;
  return (
    <div className={`mt-3 rounded-xl border ${theme.border} p-3 ${theme.bg}`}>
      <div className="flex items-center gap-2 mb-1.5">
        {quoted.profile_image_url && <img src={proxyMediaUrl(quoted.profile_image_url)} className="h-5 w-5 rounded-full" alt="" />}
        <span className={`text-xs font-bold ${theme.text}`}>{quoted.author_name}</span>
        <span className={`text-[11px] ${theme.muted}`}>@{quoted.author_handle}</span>
      </div>
      <p className={`text-[13px] leading-relaxed line-clamp-4 ${theme.text}`}>{quoted.text}</p>
      {quoted.media && quoted.media.length > 0 && (
        <MediaGrid media={quoted.media} platformTheme={theme} />
      )}
    </div>
  );
};

const URLCard = ({ card, platformTheme }) => {
  if (!card || !card.expanded_url) return null;
  const theme = platformTheme || DEFAULT_THEME;
  let domain = '';
  try { domain = new URL(card.expanded_url).hostname.replace('www.', ''); } catch { domain = ''; }
  return (
    <a href={card.expanded_url} target="_blank" rel="noopener noreferrer"
      className={`block mt-3 rounded-xl border ${theme.border} overflow-hidden hover:opacity-90 transition-opacity`}>
      {card.image && (
        <div className="w-full aspect-[2/1] overflow-hidden bg-muted">
          <img src={card.image} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <div className={`p-3 ${theme.bg}`}>
        <div className={`text-[10px] ${theme.muted} uppercase tracking-wider`}>{domain}</div>
        <div className={`text-xs font-bold line-clamp-1 mt-0.5 ${theme.text}`}>{card.title}</div>
        {card.description && <div className={`text-[11px] ${theme.muted} line-clamp-2 mt-0.5`}>{card.description}</div>}
      </div>
    </a>
  );
};

/* ══════════════════════════════════════════════════════════
   ContentCard — Platform-themed content display
   ══════════════════════════════════════════════════════════ */
const ContentCard = ({ item, index, onDownload, onAddSource }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const theme = PLATFORM_THEMES[item.platform] || DEFAULT_THEME;

  return (
    <div className={`rounded-2xl border ${theme.border} ${theme.bg} overflow-hidden shadow-sm hover:shadow-md transition-shadow`} data-testid={`content-item-${index}`}>
      <div className="p-4 space-y-2.5">

        {/* Top Bar: Platform + Timestamp + Actions */}
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-2 text-xs ${theme.muted}`}>
            {theme.icon}
            <span className="font-medium">{new Date(item.published_at).toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1">
            {onDownload && (
              <Button variant="ghost" size="sm" onClick={() => onDownload(item)}
                className={`h-7 px-2 text-[11px] ${theme.muted} hover:opacity-80 gap-1`}>
                <Download className="h-3 w-3" /> Save
              </Button>
            )}
            <Button asChild variant="ghost" size="sm" className={`h-7 px-2 text-[11px] ${theme.accent} gap-1`}>
              <a href={item.content_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" /> Original
              </a>
            </Button>
          </div>
        </div>

        {/* Author Profile + Add Source */}
        <div className="flex items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0 shrink">
            {item.author_avatar && <img src={proxyMediaUrl(item.author_avatar)} className="h-10 w-10 shrink-0 rounded-full border shadow-sm" alt="" />}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className={`font-bold text-sm leading-tight truncate ${theme.text}`}>{item.author}</h3>
                {item.verified && (
                  <div className={`${item.platform === 'x' ? 'bg-white text-black' : 'bg-sky-500 text-white'} rounded-full p-0.5`}>
                    <div className="w-2 h-2 bg-current rounded-full" />
                  </div>
                )}
              </div>
              <p className={`text-xs ${theme.muted} truncate`}>@{item.author_handle}</p>
            </div>
          </div>
          {onAddSource && (
            <Button variant="outline" size="sm" onClick={() => onAddSource(item)}
              className="h-8 px-3 gap-1.5 text-xs font-semibold shrink-0 hover:bg-primary/5 hover:border-primary/30 transition-all">
              <UserPlus className="h-3.5 w-3.5" />
              Add to Sources
            </Button>
          )}
        </div>

        {/* Text Content */}
        <div>
          <p className={`text-[14px] leading-[1.6] whitespace-pre-wrap break-words ${theme.text} ${isExpanded ? '' : 'line-clamp-4'} overflow-hidden`}>
            {item.text}
          </p>
          {item.text && (item.text.length > 200 || (item.text.match(/\n/g) || []).length > 3) && (
            <button onClick={() => setIsExpanded(!isExpanded)} className={`text-[12px] font-bold ${theme.accent} hover:underline mt-1.5`}>
              {isExpanded ? 'Show Less' : 'Read more...'}
            </button>
          )}
        </div>

        {/* Media */}
        <MediaGrid
          media={item.media}
          platformTheme={theme}
          platform={item.platform}
          contentUrl={item.content_url}
          contentId={item.content_id}
        />

        {/* Quoted */}
        {item.quoted_content && <QuotedCard quoted={item.quoted_content} platformTheme={theme} />}

        {/* URL Cards */}
        {item.url_cards && item.url_cards.map((card, idx) => <URLCard key={idx} card={card} platformTheme={theme} />)}

        {/* Engagement Metrics — platform specific */}
        <div className={`flex items-center gap-5 pt-2.5 border-t ${theme.border} text-xs ${theme.muted}`}>
          {theme.engagement.map(({ key, icon: Icon, label }) => {
            const val = Number(item.engagement?.[key] || 0);
            return (
              <div key={key} className="flex items-center gap-1.5 cursor-default hover:opacity-80 transition-opacity" title={label}>
                <Icon className="h-3.5 w-3.5" />
                <span>{val.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ContentCard;
