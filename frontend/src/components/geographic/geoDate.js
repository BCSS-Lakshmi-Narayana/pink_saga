/**
 * Local-calendar-day YYYY-MM-DD formatting, shared across the Geographic
 * Intelligence module. Using `Date#toISOString()` instead of this converts
 * to a UTC calendar day — for users in India (UTC+5:30) that silently shifts any
 * "today"/date-range boundary by up to 5.5 hours, which is why every date
 * default in this module goes through this one helper instead of each
 * component reimplementing its own (and risking exactly that bug, as
 * happened with Historical Playback's date-range presets previously).
 */
export const toLocalYMD = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
