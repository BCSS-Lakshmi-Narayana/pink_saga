const axios = require('axios');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const blugateClient = require('./blugateClient');
const rapidApiXService = require('./rapidApiXService');

const MEDIA_ANALYZER_URL = (process.env.MEDIA_ANALYZER_URL || 'http://127.0.0.1:8002').replace(/\/$/, '');
const DOWNLOADS_DIR = process.env.MEDIA_DOWNLOADS_DIR || path.join(__dirname, '../../downloads');
const DIRECT_MEDIA_EXT_RE = /\.(mp4|webm|mkv|mov|avi|m3u8|jpg|jpeg|png|gif|webp)(\?|$)/i;

// Check if external media analyzer service is available
async function isMediaAnalyzerAvailable() {
  try {
    await axios.get(`${MEDIA_ANALYZER_URL}/health`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function transcribeYoutubeUrl(youtubeUrl) {
  if (!youtubeUrl || typeof youtubeUrl !== 'string') {
    throw new Error('youtubeUrl is required');
  }

  try {
    const res = await axios.post(
      `${MEDIA_ANALYZER_URL}/analyze`,
      { youtube_url: youtubeUrl },
      {
        timeout: Number(process.env.MEDIA_ANALYZER_TIMEOUT_MS || 240000),
        headers: { 'Content-Type': 'application/json' }
      }
    );
    return res.data;
  } catch (err) {
    const detail = err?.response?.data?.detail || err?.response?.data?.message;
    const msg = detail || err?.message || 'media-analyzer request failed';
    const status = err?.response?.status;
    const out = new Error(msg);
    out.statusCode = status;
    throw out;
  }
}

function safeParseUrl(raw) {
  try {
    return new URL(String(raw || '').trim());
  } catch {
    return null;
  }
}

function getHostname(rawUrl) {
  return safeParseUrl(rawUrl)?.hostname?.toLowerCase() || '';
}

function isTwitterUrl(rawUrl) {
  const host = getHostname(rawUrl);
  return host === 'twitter.com' || host === 'x.com' || host.endsWith('.twimg.com') || host.endsWith('.twitter.com');
}

function isInstagramUrl(rawUrl) {
  const host = getHostname(rawUrl);
  return (
    host === 'instagram.com' ||
    host === 'www.instagram.com' ||
    host.endsWith('.cdninstagram.com') ||
    host.endsWith('.fbcdn.net')
  );
}

function isAllowedStreamHost(rawUrl) {
  const host = getHostname(rawUrl);
  if (!host) return false;
  if (host === 'video.twimg.com' || host === 'pbs.twimg.com' || host === 'abs.twimg.com') return true;
  if (host.endsWith('.twimg.com')) return true;
  if (host === 'instagram.com' || host === 'www.instagram.com') return true;
  if (host.endsWith('.cdninstagram.com') || host.endsWith('.fbcdn.net')) return true;
  return false;
}

function isDirectMediaUrl(rawUrl) {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) return false;
  return DIRECT_MEDIA_EXT_RE.test(parsed.pathname || '');
}

function toStreamProxyUrl(rawUrl) {
  return `/api/media/stream?url=${encodeURIComponent(rawUrl)}`;
}

function inferFilename(rawUrl, fallbackPrefix = 'media') {
  const parsed = safeParseUrl(rawUrl);
  const extFromPath = parsed ? path.extname(parsed.pathname || '').replace('.', '') : '';
  const ext = extFromPath || 'bin';
  const stem = `${fallbackPrefix}_${uuidv4().slice(0, 8)}`;
  return `${stem}.${ext}`;
}

function isInstagramPageUrl(rawUrl) {
  if (!isInstagramUrl(rawUrl)) return false;
  const parsed = safeParseUrl(rawUrl);
  const pathname = String(parsed?.pathname || '').toLowerCase();
  return /\/(reels?|stories|p|tv)\//.test(pathname);
}

async function downloadVideo(mediaUrl) {
  if (!mediaUrl || typeof mediaUrl !== 'string') {
    throw new Error('mediaUrl is required');
  }
  const normalizedUrl = mediaUrl.trim();
  const isTwitter = isTwitterUrl(normalizedUrl);
  const isInstagram = isInstagramUrl(normalizedUrl);
  const isDirectMedia = isDirectMediaUrl(normalizedUrl);
  const canStreamProxy = isAllowedStreamHost(normalizedUrl);

  // Check if external service is available
  const serviceAvailable = await isMediaAnalyzerAvailable();

  if (serviceAvailable) {
    // Use external media analyzer service
    try {
      const res = await axios.post(
        `${MEDIA_ANALYZER_URL}/download`,
        { url: normalizedUrl },
        {
          timeout: Number(process.env.MEDIA_ANALYZER_TIMEOUT_MS || 300000),
          headers: { 'Content-Type': 'application/json' }
        }
      );

      // Return the video_id so backend can proxy the download
      // Don't return the direct MEDIA_ANALYZER_URL - it may not be accessible from user's browser
      return {
        video_id: res.data.video_id,
        filename: res.data.filename,
        // Use backend proxy route instead of direct media-analyzer URL
        download_url: `/api/media/proxy/${res.data.video_id}`,
        title: res.data.title,
        duration_seconds: res.data.duration_seconds,
        source: 'media-analyzer'  // Flag to indicate this needs proxying
      };
    } catch (err) {
      console.log('External service failed, falling back to direct download...');
      // Fall through to direct download
    }
  }

  if (isTwitter) {
    console.log('Falling back to direct/RapidAPI download...');
    return await downloadTwitterMediaDirect(normalizedUrl);
  }

  if (isDirectMedia && canStreamProxy) {
    console.log('Falling back to stream-proxy direct media download...');
    return await downloadDirectMedia(normalizedUrl);
  }

  if (isInstagram && isInstagramPageUrl(normalizedUrl)) {
    const err = new Error('Instagram page URL download requires media analyzer service. Use a direct Instagram CDN media URL for fallback.');
    err.statusCode = 503;
    throw err;
  }

  throw new Error('External media service is unavailable and this URL type does not support direct fallback.');
}

async function downloadImages(imageUrls, contentId) {
  if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
    throw new Error('imageUrls array is required');
  }

  // Check if external service is available
  const serviceAvailable = await isMediaAnalyzerAvailable();

  if (serviceAvailable) {
    try {
      const res = await axios.post(
        `${MEDIA_ANALYZER_URL}/download-images`,
        { image_urls: imageUrls, content_id: contentId },
        {
          timeout: Number(process.env.MEDIA_ANALYZER_TIMEOUT_MS || 300000),
          headers: { 'Content-Type': 'application/json' }
        }
      );

      // Return items with proxied URLs
      return {
        success: true,
        media_count: res.data.media_count,
        items: res.data.items.map(item => ({
          ...item,
          download_url: `/api/media/proxy/${item.video_id}`
        }))
      };
    } catch (err) {
      console.log('External service failed for images, falling back to direct download...');
    }
  }

  // Fallback: Direct download (legacy logic from routes)
  // INSTEAD OF SAVING LOCALLY, just return the original URLs as download links
  const downloads = imageUrls.map((url, i) => {
    const resolvedUrl = String(url || '').trim();
    const downloadUrl = isAllowedStreamHost(resolvedUrl) ? toStreamProxyUrl(resolvedUrl) : resolvedUrl;
    return {
      video_id: `image_${contentId || Date.now()}_${i + 1}`,
      filename: path.basename((safeParseUrl(resolvedUrl)?.pathname || '').replace(/\/+$/, '')) || `image_${i + 1}.jpg`,
      download_url: downloadUrl,
      type: 'image',
      size: null
    };
  });

  return {
    success: true,
    items: downloads,
    media_count: downloads.length
  };
}

// Direct Twitter media download (fallback when external service unavailable)
async function downloadTwitterMediaDirect(mediaUrl) {
  const twitterUrl = isTwitterUrl(mediaUrl);

  if (twitterUrl) {
    // Extract tweet ID and fetch media URLs via RapidAPI
    const tweetId = extractTweetId(mediaUrl);
    if (tweetId) {
      return await downloadTweetMedia(tweetId, mediaUrl);
    }
  }

  // For direct media URLs (images/videos), download directly
  return await downloadDirectMedia(mediaUrl);
}

// Extract tweet ID from URL
function extractTweetId(url) {
  const patterns = [
    /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/,
    /(?:twitter\.com|x\.com)\/i\/web\/status\/(\d+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Remove all local saving for X/Twitter videos
async function downloadTweetMedia(tweetId, originalUrl) {
  try {
    // Fetch tweet details. /tweet-v2 is the current BluGate route; /tweet is
    // the deprecated alternative. Both take `pid`.
    let tweetData = null;
    for (const endpoint of ['tweet-v2', 'tweet']) {
      try {
        const { params } = rapidApiXService.prepareXRequest(endpoint, { pid: tweetId });
        const response = await blugateClient.withRateLimitRetry(() => axios.get(`${blugateClient.GATEWAY_BASE}/twitter/${endpoint}`, {
          params,
          headers: blugateClient.getHeaders(),
          timeout: 30000,
          ...blugateClient.responseOptions(),
        }), { label: 'BluGate X tweet' });

        let result = response.data?.result || response.data?.data || response.data;
        for (let i = 0; i < 6; i++) {
          if (!result || typeof result !== 'object' || result.legacy) break;
          const next = result.tweetResult || result.tweet || result.result || result.tweet_results?.result;
          if (!next) break;
          result = next;
        }
        const candidate = result?.legacy || result;
        if (candidate?.extended_entities || candidate?.entities) {
          tweetData = candidate;
          break;
        }
      } catch (err) {
        if (err.code === 'BLUGATE_X_MISSING_PARAMS') throw err;
      }
    }

    const mediaItems = extractMediaFromTweet(tweetData);

    if (mediaItems.length === 0) {
      throw new Error('No media found in tweet');
    }

    // Instead of downloading, just return the media URLs for streaming
    const downloads = mediaItems.map((item, idx) => ({
      video_id: `${tweetId}_${idx + 1}`,
      filename: item.url.split('/').pop(),
      download_url: item.url,
      title: `Tweet ${tweetId} - Media ${idx + 1}`,
      type: item.type,
      size: null
    }));

    if (downloads.length === 1) {
      return downloads[0];
    }

    // Multiple media items
    return {
      video_id: tweetId,
      filename: `tweet_${tweetId}_media.zip`,
      download_url: downloads.map(d => d.download_url),
      title: `Tweet ${tweetId} Media (${downloads.length} items)`,
      media_count: downloads.length,
      items: downloads
    };
  } catch (error) {
    console.error('Tweet media download error:', error.message);
    const fallbackProxy = isDirectMediaUrl(originalUrl) && isAllowedStreamHost(originalUrl)
      ? toStreamProxyUrl(originalUrl)
      : originalUrl;
    // Try direct URL download as last resort (but do not save locally)
    return {
      video_id: tweetId,
      filename: originalUrl.split('/').pop(),
      download_url: fallbackProxy,
      title: `Tweet ${tweetId} - Media`,
      type: 'video',
      size: null
    };
  }
}

// Extract media URLs from tweet data
function extractMediaFromTweet(tweetData) {
  const media = [];
  const extendedMedia = tweetData?.extended_entities?.media || tweetData?.entities?.media || [];

  for (const item of extendedMedia) {
    if (item.type === 'video' || item.type === 'animated_gif') {
      // Get best quality video variant
      const variants = item.video_info?.variants || [];
      const mp4Variants = variants
        .filter(v => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      if (mp4Variants.length > 0) {
        media.push({
          type: item.type,
          url: mp4Variants[0].url,
          preview: item.media_url_https
        });
      }
    } else if (item.type === 'photo') {
      // Get highest quality image
      let imageUrl = item.media_url_https || item.media_url;
      if (imageUrl && !imageUrl.includes('?format=')) {
        imageUrl = `${imageUrl}?format=jpg&name=large`;
      }
      media.push({
        type: 'photo',
        url: imageUrl,
        preview: imageUrl
      });
    }
  }

  return media;
}

// Direct media URL download (for non-Twitter URLs or direct media links)
async function downloadDirectMedia(url) {
  try {
    const parsed = safeParseUrl(url);
    if (!parsed) {
      throw new Error('Invalid media URL');
    }
    if (!isAllowedStreamHost(url)) {
      throw new Error('Host not allowed for direct media fallback');
    }
    if (!isDirectMediaUrl(url)) {
      throw new Error('URL is not a direct media file');
    }

    const filename = inferFilename(url, 'direct');
    const videoId = uuidv4().slice(0, 8);

    return {
      video_id: videoId,
      filename: filename,
      download_url: toStreamProxyUrl(url),
      title: 'Direct Media',
      source: 'stream-proxy',
      size: null
    };
  } catch (error) {
    console.error('Direct media download error:', error.message);
    throw new Error(`Failed to download media: ${error.message}`);
  }
}

function getVideoDownloadUrl(videoId) {
  return `${MEDIA_ANALYZER_URL}/videos/${videoId}`;
}

// Stream video from media-analyzer service (for proxying)
async function getVideoStream(videoId) {
  const url = `${MEDIA_ANALYZER_URL}/videos/${videoId}`;
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 600000, // 10 minutes for large files
    decompress: false, // Don't decompress so we can forward bytes exactly
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: {
      'Accept-Encoding': 'identity' // Strictly request non-compressed content for proxying
    }
  });
  return {
    stream: response.data,
    headers: response.headers,
    status: response.status
  };
}

// Serve downloaded files
function getLocalDownloadPath(filename) {
  return path.join(DOWNLOADS_DIR, filename);
}

module.exports = {
  transcribeYoutubeUrl,
  downloadVideo,
  getVideoDownloadUrl,
  getVideoStream,
  getLocalDownloadPath,
  downloadTwitterMediaDirect,
  isMediaAnalyzerAvailable,
  downloadImages,
  MEDIA_ANALYZER_URL
};
