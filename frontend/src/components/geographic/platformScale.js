/**
 * Shared platform label/color metadata for the Geographic Intelligence
 * module — single source of truth so a platform reads the same label and
 * color everywhere it's shown (donut, filter bar, playback chart) instead of
 * each component maintaining its own copy that can silently drift (e.g. one
 * component calling the news/RSS source "news" with a color, another calling
 * it "rss" with none, so it fell back to the "unknown" grey).
 */
export const PLATFORM_META = {
  x: { label: 'X (Twitter)', color: '#1d9bf0' },
  twitter: { label: 'X (Twitter)', color: '#1d9bf0' },
  facebook: { label: 'Facebook', color: '#1877f2' },
  instagram: { label: 'Instagram', color: '#e1306c' },
  youtube: { label: 'YouTube', color: '#ff0000' },
  whatsapp: { label: 'WhatsApp', color: '#25d366' },
  news: { label: 'Web Articles', color: '#8b5cf6' },
  rss: { label: 'Web Articles', color: '#8b5cf6' },
  unknown: { label: 'Other', color: '#94a3b8' },
};

export const platformMeta = (platform) => PLATFORM_META[platform] || PLATFORM_META.unknown;
