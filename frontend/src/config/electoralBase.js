/**
 * Electoral Base — shared helpers for the map's "BRS wins" view, the
 * year-by-year table and the electoral analysis window.
 *
 * Loyalty = in how many of the six general elections for a seat BRS won
 * (MLA 2014/2018/2023 and MP 2014/2019/2024) — a count of published results.
 * One pink ramp, light → dark, validated as an ordinal scale with the data-viz
 * palette checker; the bottom band is neutral grey. The legend and tooltips
 * always state the count, so colour is never the only cue.
 */
export const LOYALTY_BANDS = [
  { min: 6, hex: '#6b0f3a', text: '#ffffff', label: 'Won all 6' },
  { min: 4, hex: '#c8246f', text: '#ffffff', label: 'Won 4–5 of 6' },
  { min: 2, hex: '#f06aa8', text: '#0f172a', label: 'Won 2–3 of 6' },
  { min: 0, hex: '#e2e8f0', text: '#0f172a', label: 'Won 0–1 of 6' },
];

export const loyaltyBand = (wins) => LOYALTY_BANDS.find((b) => (wins ?? -1) >= b.min) || { hex: '#cbd5e1', text: '#0f172a', label: '—' };

/**
 * Party name as it stood on the day of an election. The data keys TRS and BRS
 * as one party (so counts line up across the rename), but TRS was renamed
 * Bharat Rashtra Samithi only when the ECI approved it on 8 Dec 2022 — so
 * 2014, 2018 and 2019 contests are shown as TRS.
 */
export const BRS_RENAMED_ON = '2022-12-08';
export const partyAsOf = (party, pollDate) => (party === 'BRS' && pollDate && pollDate < BRS_RENAMED_ON ? 'TRS' : party);
/** Name for counts that span the rename. */
export const OUR_PARTY_LABEL = 'BRS (TRS)';

/** Same normalisation as the backend's normalizeConstituencyKey. */
export const seatKey = (name) => String(name || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/[^a-z0-9]/g, '');

export const fmtPts = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}`);
