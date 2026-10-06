const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const path = require('path');
const fs = require('fs');
const mediaAnalyzerService = require('../services/mediaAnalyzerService');
const AuditLog = require('../models/AuditLog');
const { protect } = require('../middleware/authMiddleware');
const { requireAnyPageAccess, requirePlatformFeatureAccess } = require('../middleware/rbacMiddleware');

const mediaAccessMiddleware = [
  protect,
  requireAnyPageAccess([
    '/alerts',
    '/grievances',
    '/content',
    '/monitors',
    '/x-monitor',
    '/facebook-monitor',
    '/instagram-monitor',
    '/youtube-monitor'
  ])
];

// Keep legacy call sites but preserve authenticated user identity.
const mockUser = (req, res, next) => {
  if (!req.user) {
    req.user = {
      id: 'unknown',
      email: 'unknown@local',
      full_name: 'Unknown User'
    };
  }
  req.user.name = req.user.name || req.user.full_name || req.user.email || req.user.id;
  next();
};

const logAction = async (user, action, resourceType, resourceId, details) => {
  try {
    await AuditLog.create({
      user_id: user.id,
      user_email: user.email,
      user_name: user.name,
      action: action,
      resource_type: resourceType,
      resource_id: resourceId,
      details: details
    });
  } catch (error) {
    //console.error('Audit Log Error:', error);
  }
};

const getAbsoluteUrlHelper = (req) => (maybeRelativeUrl) => {
  if (!maybeRelativeUrl || typeof maybeRelativeUrl !== 'string') return maybeRelativeUrl;
  if (/^https?:\/\//i.test(maybeRelativeUrl)) return maybeRelativeUrl;
  if (!maybeRelativeUrl.startsWith('/')) return maybeRelativeUrl;
  const protocol = req.get('X-Forwarded-Proto') || req.protocol || 'https';
  return `${protocol}://${req.get('host')}${maybeRelativeUrl}`;
};

const DIRECT_VIDEO_EXT_RE = /\.(mp4|webm|mkv|mov|avi|m3u8)(\?|$)/i;
const DIRECT_IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp)(\?|$)/i;

const normalizeMediaType = (value) => String(value ?? '').trim().toLowerCase();
const isVideoType = (value) => {
  const normalized = normalizeMediaType(value);
  return ['video', 'animated_gif', 'gifv', '2'].includes(normalized);
};
const isImageType = (value) => {
  const normalized = normalizeMediaType(value);
  return ['photo', 'image', '1'].includes(normalized);
};

// Generic media download for any platform
router.post('/download', ...mediaAccessMiddleware, requirePlatformFeatureAccess('/monitors', (req) => req.body.platform), mockUser, async (req, res) => {
  try {
    const { media_url, media_urls, media_items, content_url, url, content_id } = req.body;
    const mediaUrl = media_url || content_url || url;

    const toAbsolute = getAbsoluteUrlHelper(req);

    let result;

    const normalizeTwitterImageUrl = (u) => {
      if (!u || typeof u !== 'string') return u;
      // Prefer highest quality for Twitter images
      if (u.includes('pbs.twimg.com') && !/[?&]name=/.test(u)) {
        return `${u}${u.includes('?') ? '&' : '?'}name=orig`;
      }
      return u;
    };

    const isLikelyVideoUrl = (u) => {
      if (!u || typeof u !== 'string') return false;
      return (
        u.includes('video.twimg.com') ||
        u.includes('.cdninstagram.com') ||
        u.includes('.fbcdn.net') ||
        DIRECT_VIDEO_EXT_RE.test(u)
      );
    };

    const isLikelyImageUrl = (u) => {
      if (!u || typeof u !== 'string') return false;
      return DIRECT_IMAGE_EXT_RE.test(u);
    };

    const hasVideoInItems = (items = []) => {
      if (!Array.isArray(items)) return false;
      return items.some((it) => {
        const t = normalizeMediaType(it?.type);
        const u = String(it?.url || '');
        const mediaType = normalizeMediaType(it?.media_type);
        const isStoryOrReelVideo = Boolean(it?.is_video) || ['story_video', 'reel_video'].includes(mediaType);
        return isVideoType(t) || isVideoType(mediaType) || isStoryOrReelVideo || isLikelyVideoUrl(u);
      });
    };

    // If frontend passes explicit media items/urls (Twitter posts often have 1+ images)
    if ((Array.isArray(media_items) && media_items.length > 0) || (Array.isArray(media_urls) && media_urls.length > 0)) {
      const rawItems = Array.isArray(media_items) && media_items.length > 0
        ? media_items
        : media_urls.map((u) => ({ type: 'photo', url: u }));

      const cleaned = rawItems
        .map((it) => ({
          type: it?.type,
          media_type: it?.media_type,
          is_video: it?.is_video,
          url: typeof it?.url === 'string' ? it.url.trim() : it
        }))
        .filter((it) => !!it.url);

      const hasVideo = hasVideoInItems(cleaned);

      // Requirement: if any video exists, trigger MEDIA_ANALYZER_URL downloader.
      if (hasVideo) {
        if (!mediaUrl) {
          // Fall back to first video URL if tweet URL wasn't provided
          const firstVideo = cleaned.find((it) => {
            const t = normalizeMediaType(it?.type);
            const mt = normalizeMediaType(it?.media_type);
            return isVideoType(t) || isVideoType(mt) || Boolean(it?.is_video) || isLikelyVideoUrl(String(it?.url || ''));
          });
          if (!firstVideo?.url) {
            return res.status(400).json({ error: 'media_url is required for video download' });
          }
          result = await mediaAnalyzerService.downloadVideo(String(firstVideo.url));
        } else {
          result = await mediaAnalyzerService.downloadVideo(mediaUrl);
        }
      } else {
        // Images: return direct URLs (browser downloads), no external service.
        const directItems = cleaned.map((it, idx) => {
          const directUrl = normalizeTwitterImageUrl(String(it.url));
          const normalizedType = normalizeMediaType(it.type);
          const outputType = isImageType(normalizedType) ? normalizedType : (isLikelyImageUrl(directUrl) ? 'photo' : (normalizedType || 'photo'));
          return {
            type: outputType,
            url: directUrl,
            download_url: directUrl,
            title: `Media ${idx + 1}`
          };
        });

        result = {
          video_id: content_id || 'media',
          filename: directItems.length === 1 ? 'image' : `images_${directItems.length}`,
          download_url: directItems.length === 1 ? directItems[0].download_url : directItems.map((i) => i.download_url),
          title: directItems.length === 1 ? 'Image' : `Images (${directItems.length})`,
          media_count: directItems.length,
          items: directItems
        };
      }
    } else {
      if (!mediaUrl) {
        return res.status(400).json({ error: 'media_url is required' });
      }

      //console.log(`Initiating media download for: ${mediaUrl}`);
      result = await mediaAnalyzerService.downloadVideo(mediaUrl);
    }

    await logAction(req.user, 'download_video', 'content', content_id || result.video_id, {
      media_url: mediaUrl,
      video_id: result.video_id,
      filename: result.filename
    });

    // Normalize/absolute-ify URLs so window.open works from the React app
    const downloadUrl = Array.isArray(result.download_url)
      ? result.download_url.map(toAbsolute)
      : toAbsolute(result.download_url);

    const items = Array.isArray(result.items)
      ? result.items.map((i) => ({
        ...i,
        download_url: toAbsolute(i.download_url)
      }))
      : undefined;

    // Backward compatible: keep download_url as a single string when possible
    const primaryDownloadUrl = Array.isArray(downloadUrl) ? downloadUrl[0] : downloadUrl;

    res.json({
      success: true,
      video_id: result.video_id,
      filename: result.filename,
      download_url: primaryDownloadUrl,
      download_urls: Array.isArray(downloadUrl) ? downloadUrl : undefined,
      title: result.title,
      duration_seconds: result.duration_seconds,
      media_count: result.media_count,
      items
    });
  } catch (error) {
    //console.error('Media download error:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to download media'
    });
  }
});

// Download images only (for separate image download option)
router.post('/download-images', ...mediaAccessMiddleware, requirePlatformFeatureAccess('/monitors', (req) => req.body.platform), mockUser, async (req, res) => {
  try {
    const { image_urls, content_id } = req.body;

    if (!image_urls || !Array.isArray(image_urls) || image_urls.length === 0) {
      return res.status(400).json({ error: 'image_urls array is required' });
    }

    //console.log(`Downloading ${image_urls.length} images...`);
    const result = await mediaAnalyzerService.downloadImages(image_urls, content_id);

    const toAbsolute = getAbsoluteUrlHelper(req);
    const absoluteResult = {
      ...result,
      items: result.items ? result.items.map(i => ({
        ...i,
        download_url: toAbsolute(i.download_url)
      })) : []
    };

    await logAction(req.user, 'download_images', 'content', content_id, {
      image_count: result.media_count
    });

    res.json(absoluteResult);
  } catch (error) {
    // console.error('Image download error:', error);
    res.status(500).json({ error: 'Failed to download images' });
  }
});

// Download videos only (for separate video download option, supports up to 30 min)
router.post('/download-video', ...mediaAccessMiddleware, requirePlatformFeatureAccess('/monitors', (req) => req.body.platform), mockUser, async (req, res) => {
  try {
    const { media_url, video_urls, content_id } = req.body;

    if (!media_url && (!video_urls || video_urls.length === 0)) {
      return res.status(400).json({ error: 'media_url or video_urls is required' });
    }

    //console.log(`Downloading video from: ${media_url || video_urls[0]}`);

    // Use media analyzer service for video download (supports longer videos)
    const result = await mediaAnalyzerService.downloadVideo(media_url || video_urls[0]);

    await logAction(req.user, 'download_video', 'content', content_id || result.video_id, {
      media_url: media_url,
      video_id: result.video_id,
      filename: result.filename
    });

    const toAbsolute = getAbsoluteUrlHelper(req);
    const downloadUrl = toAbsolute(result.download_url);

    res.json({
      success: true,
      video_id: result.video_id,
      filename: result.filename,
      download_url: downloadUrl,
      title: result.title,
      duration_seconds: result.duration_seconds,
      items: result.items ? result.items.map(i => ({
        ...i,
        download_url: toAbsolute(i.download_url)
      })) : [{ filename: result.filename, download_url: downloadUrl }]
    });
  } catch (error) {
    //console.error('Video download error:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Failed to download video'
    });
  }
});

// Serve downloaded files
router.get('/downloads/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    // Sanitize filename to prevent directory traversal
    const sanitizedFilename = path.basename(filename);
    const filepath = mediaAnalyzerService.getLocalDownloadPath(sanitizedFilename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Determine content type
    const ext = path.extname(filename).toLowerCase();
    const contentTypes = {
      '.mp4': 'video/mp4',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };

    const contentType = contentTypes[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);

    const fileStream = fs.createReadStream(filepath);
    fileStream.pipe(res);
  } catch (error) {
    //console.error('File serve error:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// Check service status
router.get('/status', async (req, res) => {
  const externalAvailable = await mediaAnalyzerService.isMediaAnalyzerAvailable();
  res.json({
    external_service: externalAvailable ? 'available' : 'unavailable',
    fallback: 'available',
    message: externalAvailable
      ? 'Using external media analyzer service'
      : 'Using built-in Twitter media downloader'
  });
});

// Stream proxy for remote media (primarily X/Twitter videos).
// Rationale: browsers often can't play video.twimg.com MP4s directly due to CORS/hotlinking;
// by streaming through our backend, videos become playable "from our platform".
// Security: strict allowlist to avoid becoming an open proxy.
router.get('/stream', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'url query param is required' });
    }

    // Handle local paths for profile images and other uploads
    if (rawUrl.startsWith('/') || !rawUrl.startsWith('http')) {
      const publicPath = path.join(process.cwd(), 'public');
      const filePath = path.join(publicPath, rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`);

      // Safety check to prevent path traversal
      if (!filePath.startsWith(publicPath)) {
        return res.status(403).json({ error: 'Path not allowed' });
      }

      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
      return res.status(404).json({ error: 'File not found' });
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid url' });
    }

    const hostname = (parsed.hostname || '').toLowerCase();

    // We keep this endpoint as a strict allowlist proxy (to avoid becoming an open proxy).
    // Supported today:
    // - X/Twitter media domains (video.twimg.com, pbs.twimg.com, *.twimg.com)
    // - Instagram CDN media domains ( *.cdninstagram.com, *.fbcdn.net )
    const allowedTwitterHosts = new Set([
      'video.twimg.com',
      'pbs.twimg.com',
      'twitter.com',
      'x.com',
      'abs.twimg.com'
    ]);

    const isTwitterHost = allowedTwitterHosts.has(hostname) || hostname.endsWith('.twimg.com');
    const isInstagramHost =
      hostname === 'instagram.com' ||
      hostname === 'www.instagram.com' ||
      hostname.endsWith('.cdninstagram.com');

    const isFacebookHost =
      hostname === 'facebook.com' ||
      hostname === 'www.facebook.com' ||
      hostname.endsWith('.fbcdn.net') ||
      hostname.endsWith('.fbsbx.com');

    const isYouTubeHost =
      hostname === 'youtube.com' ||
      hostname === 'www.youtube.com' ||
      hostname.endsWith('.ggpht.com') ||
      hostname.endsWith('.googleusercontent.com');

    const isS3Host = hostname.endsWith('.amazonaws.com');

    if (!isTwitterHost && !isInstagramHost && !isFacebookHost && !isYouTubeHost && !isS3Host) {
      return res.status(403).json({ error: 'Host not allowed' });
    }

    const range = req.headers.range;

    let referer = 'https://x.com/';
    let origin = 'https://x.com';

    if (isInstagramHost) {
      referer = 'https://www.instagram.com/';
      origin = 'https://www.instagram.com';
    } else if (isFacebookHost) {
      referer = 'https://www.facebook.com/';
      origin = 'https://www.facebook.com';
    } else if (isYouTubeHost) {
      referer = 'https://www.youtube.com/';
      origin = 'https://www.youtube.com';
    }

    console.log(`[MediaProxy] Streaming: ${hostname} (UA: ${req.headers['user-agent']})`);

    // Decide whether to fetch as buffer (so we can rewrite manifests) or stream.
    // HLS manifests (.m3u8) and DASH manifests (.mpd) must be rewritten so the
    // segment URLs they reference also flow through this proxy. Everything else
    // streams as-is for performance.
    const lowerPath = (parsed.pathname || '').toLowerCase();
    const isManifest = lowerPath.endsWith('.m3u8') || lowerPath.endsWith('.mpd');

    const upstream = await axios.get(rawUrl, {
      // Buffer manifests so we can rewrite them; stream everything else.
      responseType: isManifest ? 'arraybuffer' : 'stream',
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        ...(range ? { Range: range } : {}),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': referer,
        'Origin': origin,
        'Sec-Fetch-Dest': 'video',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site'
      },
      validateStatus: (status) => true,
      // Always decompress: HLS.js / <video> expect identity-encoded bytes once
      // Content-Encoding is stripped, and we'd otherwise serve gzipped blobs
      // labeled as plain m3u8/video.
      decompress: true,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 30000
    });

    if (upstream.status >= 400) {
      console.warn(`[MediaProxy] Upstream returned ${upstream.status} for ${hostname}`);
    }

    const upstreamContentType = (upstream.headers?.['content-type'] || '').toLowerCase();

    // For streamed responses, abort on HTML (expired URL or login page).
    if (!isManifest && upstreamContentType.includes('text/html')) {
      upstream.data.destroy?.();
      return res.status(502).json({ error: 'Upstream returned HTML — media URL may have expired' });
    }

    // Headers to forward as-is. NOTE: we intentionally drop content-encoding and
    // content-length because axios has already decompressed the body, so the
    // upstream-reported length/encoding no longer match what we're about to send.
    const passthroughHeaders = [
      'content-type',
      'accept-ranges',
      'content-range',
      'etag',
      'last-modified',
      'cache-control'
    ];

    for (const headerName of passthroughHeaders) {
      const value = upstream.headers?.[headerName];
      if (value) res.setHeader(headerName, value);
    }

    if (isManifest) {
      // Rewrite all URLs inside the manifest to also flow through this proxy.
      const text = Buffer.from(upstream.data).toString('utf8');
      const baseHref = rawUrl.replace(/[^/]*$/, ''); // directory of the manifest
      const proxyBase = `/api/media/stream?url=`;
      const rewriteUrl = (raw) => {
        let abs = raw;
        if (!/^https?:\/\//i.test(abs)) {
          try { abs = new URL(abs, baseHref).toString(); } catch (_) { return raw; }
        }
        return `${proxyBase}${encodeURIComponent(abs)}`;
      };

      const rewritten = text
        .split(/\r?\n/)
        .map((line) => {
          if (!line || line.startsWith('#')) {
            // Rewrite URIs inside attribute lists (e.g. #EXT-X-KEY:URI="..."
            // or #EXT-X-MAP:URI="...") and EXT-X-MEDIA URI references.
            return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${rewriteUrl(u)}"`);
          }
          // Non-comment lines in m3u8 are segment URIs.
          return rewriteUrl(line.trim());
        })
        .join('\n');

      const body = Buffer.from(rewritten, 'utf8');
      res.setHeader('content-length', body.length);
      res.status(upstream.status === 206 ? 200 : upstream.status);
      return res.end(body);
    }

    // For non-manifest streamed responses, preserve the upstream status (incl. 206 partial).
    res.status(upstream.status);
    upstream.data.pipe(res);
    upstream.data.on('error', (err) => {
      console.error('[StreamProxy] Upstream stream error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream media' });
      } else {
        res.end();
      }
    });
  } catch (error) {
    console.error('[StreamProxy] Global error:', error.message);
    res.status(500).json({ error: 'Failed to stream media' });
  }
});

// Proxy endpoint to stream videos from media-analyzer service
// This allows the backend to serve files from the media-analyzer service
// which may not be directly accessible from the user's browser
router.get('/proxy/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;

    // Sanitize videoId to prevent path traversal (allow dots for file extensions)
    const sanitizedVideoId = videoId.replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!sanitizedVideoId) {
      return res.status(400).json({ error: 'Invalid video ID' });
    }

    //console.log(`Proxying download for: ${sanitizedVideoId}`);

    const { stream, headers, status } = await mediaAnalyzerService.getVideoStream(sanitizedVideoId);

    // Skip problematic hop-by-hop headers
    const headersToSkip = [
      'host', 'connection', 'keep-alive', 'proxy-authenticate',
      'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade'
    ];

    // Forward upstream status
    res.status(status || 200);

    // Forward headers
    for (const [key, value] of Object.entries(headers)) {
      if (!headersToSkip.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }

    // Reinforce content type if missing or generic to prevent .bin downloads
    const contentTypeToExt = {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/x-matroska': 'mkv',
      'video/x-msvideo': 'avi',
      'video/quicktime': 'mov',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'application/zip': 'zip'
    };

    let contentType = res.getHeader('Content-Type')?.toString().split(';')[0]?.trim();
    if (!contentType || contentType === 'application/octet-stream') {
      const ext = sanitizedVideoId.split('.').pop().toLowerCase();
      const mappedType = Object.entries(contentTypeToExt).find(([type, e]) => e === ext)?.[0];
      if (mappedType) {
        contentType = mappedType;
        res.setHeader('Content-Type', contentType);
      } else if (sanitizedVideoId.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        contentType = 'image/jpeg';
        res.setHeader('Content-Type', contentType);
      } else {
        // Fallback for media proxy if still unknown
        contentType = 'video/mp4';
        res.setHeader('Content-Type', contentType);
      }
    }

    // Reinforce Content-Disposition with a proper extension if needed
    let contentDisposition = res.getHeader('Content-Disposition')?.toString();
    if (!contentDisposition) {
      const ext = contentTypeToExt[contentType] || 'mp4';
      const filename = sanitizedVideoId.includes('.') ? sanitizedVideoId : `${sanitizedVideoId}.${ext}`;
      contentDisposition = `attachment; filename="${filename}"`;
      res.setHeader('Content-Disposition', contentDisposition);
    }

    // Pipe the stream to the response
    stream.pipe(res);

    stream.on('error', (err) => {
      // console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream video' });
      }
    });
  } catch (error) {
    // console.error('Proxy download error:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.detail || 'Failed to download video. It may have been cleaned up.'
    });
  }
});

// Fetch a fresh direct MP4 URL for a Twitter/X video using the syndication API.
// Useful when the stored video.twimg.com URL has expired and S3 archival was not available.
router.get('/twitter-video', async (req, res) => {
  const tweetId = String(req.query.tweetId || '').trim();
  if (!tweetId || !/^\d{5,25}$/.test(tweetId)) {
    return res.status(400).json({ error: 'Valid numeric tweetId required' });
  }
  try {
    const response = await axios.get('https://cdn.syndication.twimg.com/tweet-result', {
      params: { id: tweetId, token: 'x' },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Referer': 'https://platform.twitter.com/'
      },
      timeout: 10000
    });
    const mediaDetails = response.data?.mediaDetails || [];
    for (const m of mediaDetails) {
      if ((m.type === 'video' || m.type === 'animated_gif') && m.video_info?.variants) {
        const mp4s = m.video_info.variants
          .filter(v => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        if (mp4s.length > 0) {
          return res.json({ url: mp4s[0].url, source: 'syndication' });
        }
      }
    }
    return res.status(404).json({ error: 'No video found for this tweet' });
  } catch (err) {
    console.error(`[MediaRoutes] Twitter syndication failed for ${tweetId}: ${err.message}`);
    return res.status(502).json({ error: 'Syndication API unavailable' });
  }
});

module.exports = router;
