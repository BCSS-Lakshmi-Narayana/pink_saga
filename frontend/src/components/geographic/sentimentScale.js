import { canonicalDistrictName } from '../../data/stateMLAs';

/**
 * Shared 5-bucket sentiment_index (-100..100) → color scale, used by both
 * the State Overview heatmap and the Historical Playback heatmap so the
 * same district always reads the same color regardless of which tab it's
 * viewed from.
 */
export const MOOD_LEGEND = [
  { color: '#16a34a', label: 'Very Positive (60 to 100)' },
  { color: '#84cc16', label: 'Positive (20 to 59)' },
  { color: '#eab308', label: 'Neutral (-19 to 19)' },
  { color: '#f97316', label: 'Negative (-59 to -20)' },
  { color: '#dc2626', label: 'Very Negative (-100 to -60)' },
  { color: '#e2e8f0', label: 'No Data' },
];

export const bucketColorForIndex = (entry) => {
  if (!entry) return '#e2e8f0';
  const idx = entry.sentiment_index;
  if (idx >= 60) return '#16a34a';
  if (idx >= 20) return '#84cc16';
  if (idx >= -19) return '#eab308';
  if (idx >= -59) return '#f97316';
  return '#dc2626';
};

export const DISTRICT_GEOJSON_SOURCES = ['/state_districts.geojson', '/state_outline.geojson'];

/**
 * Shared 0-100 risk-score → color scale (critical/high/medium/low, matching
 * the backend's riskLevelFromScore thresholds of 75/50/25) — used by
 * RiskGauge and the Risk Distribution Treemap so a district's risk color
 * doesn't silently drift between the two if the palette is ever tuned.
 */
export const RISK_COLORS = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#10b981' };
export const colorForRiskScore = (score) => {
  if (score >= 75) return RISK_COLORS.critical;
  if (score >= 50) return RISK_COLORS.high;
  if (score >= 25) return RISK_COLORS.medium;
  return RISK_COLORS.low;
};

export const formatGeoName = (rawName) => {
  if (!rawName) return '';
  const s = String(rawName).trim();
  const district = canonicalDistrictName(s);
  if (district) return district;

  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};
