/**
 * Formats a change value for display next to a KPI — percentage-point deltas
 * print as "N pp"; large relative swings (≥1000%) collapse to an "Nx"
 * multiplier instead of an unreadable 4-digit percentage. Shared by every
 * KPI tile/chip in the Geographic Intelligence module so the ≥1000% → "x"
 * rule isn't reimplemented (and potentially drifting) in more than one place.
 */
export const formatPctChange = (val, unit) => {
  const abs = Math.abs(val);
  if (unit === 'pp') return `${abs} pp`;
  if (abs >= 1000) {
    const times = (abs / 100).toFixed(1);
    return `${parseFloat(times)}x`;
  }
  return `${abs}%`;
};
