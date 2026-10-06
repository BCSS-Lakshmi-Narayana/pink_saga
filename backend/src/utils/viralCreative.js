/**
 * viralCreative — shared sanitizers for the viral-campaign "creative" payload
 * (media, caption, hashtags, per-platform overrides), used by both the tenant
 * create path and the Super-Admin create-for-tenant path so validation stays
 * identical. Everything is bounded to keep documents small and safe.
 */

const CONTENT_TYPES = ['post', 'video', 'reel', 'story', 'tweet', 'short', 'image', 'audio', 'text'];
const MEDIA_KINDS = ['image', 'video', 'audio', 'document', 'link'];

/**
 * The canonical platform spellings the UI keys off (CONTENT_TYPES_BY_PLATFORM,
 * per-platform overrides, influencer briefs). Anything reaching a ViralCampaign must
 * use these exact strings.
 *
 * This matters for the AI path: the suggestion engine feeds the model the platforms it
 * observed in the data, which come off Grievance.platform as 'x' / 'facebook', and the
 * model echoes that casing back. Stored lowercase, a platform silently stops matching
 * its content-type list and its override panel.
 */
const CANONICAL_PLATFORMS = ['Instagram', 'X', 'YouTube', 'Facebook'];

const PLATFORM_ALIASES = {
  x: 'X', twitter: 'X', tweet: 'X',
  facebook: 'Facebook', fb: 'Facebook', meta: 'Facebook',
  instagram: 'Instagram', insta: 'Instagram', ig: 'Instagram',
  youtube: 'YouTube', yt: 'YouTube', youtubeshorts: 'YouTube',
};

/** Map any casing/alias onto the canonical spelling; unknown platforms are dropped. */
const normalizePlatforms = (arr) => {
  const out = (Array.isArray(arr) ? arr : [])
    .map((p) => PLATFORM_ALIASES[String(p || '').toLowerCase().replace(/[^a-z]/g, '')])
    .filter(Boolean);
  return [...new Set(out)];
};

const sanitizeContentType = (v) => (CONTENT_TYPES.includes(v) ? v : undefined);

const sanitizeMedia = (arr) => (Array.isArray(arr) ? arr : [])
  .filter((m) => m && m.url)
  .slice(0, 20)
  .map((m) => ({
    url: String(m.url).slice(0, 1000),
    kind: MEDIA_KINDS.includes(m.kind) ? m.kind : 'link',
    name: String(m.name || '').slice(0, 200),
  }));

const sanitizeHashtags = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\s,]+/))
  .map((h) => String(h).replace(/^#+/, '').trim())
  .filter(Boolean)
  .slice(0, 30);

const sanitizePlatformContent = (arr) => (Array.isArray(arr) ? arr : [])
  .filter((p) => p && p.platform)
  .slice(0, 8)
  .map((p) => ({
    platform: String(p.platform).slice(0, 40),
    // Same 200-char cap the campaign's own title gets (see campaignSuggestionRoutes
    // send-to-viral); blank means the override inherits the campaign title.
    title: String(p.title || '').trim().slice(0, 200),
    content_type: sanitizeContentType(p.content_type) || '',
    caption: String(p.caption || '').slice(0, 2000),
    hashtags: sanitizeHashtags(p.hashtags),
    media: sanitizeMedia(p.media),
  }));

// Build the persistable creative sub-document from a raw request body.
const buildCreative = (body = {}) => ({
  content_type: sanitizeContentType(body.content_type),
  content_url: body.content_url ? String(body.content_url).slice(0, 1000) : undefined,
  caption: String(body.caption || '').slice(0, 2000),
  hashtags: sanitizeHashtags(body.hashtags),
  media: sanitizeMedia(body.media),
  platform_content: sanitizePlatformContent(body.platform_content),
});

module.exports = {
  CONTENT_TYPES,
  MEDIA_KINDS,
  CANONICAL_PLATFORMS,
  normalizePlatforms,
  sanitizeContentType,
  sanitizeMedia,
  sanitizeHashtags,
  sanitizePlatformContent,
  buildCreative,
};
