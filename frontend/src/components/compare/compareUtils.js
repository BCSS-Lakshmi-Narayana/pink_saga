import { useEffect, useRef, useState } from 'react';
import { PARTY_PALETTE } from '../../config/partyColors';

/* Party visual identity — used to colour every "side" of the comparison so
   the two candidates stay readable even without labels. */
export const PARTY_COLORS = {
  ...Object.fromEntries(
    Object.entries(PARTY_PALETTE).map(([code, c]) => [code, { main: c.hex, soft: c.soft, text: c.text, ring: c.ring, grad: c.grad }])
  ),
  DEFAULT: { main: '#64748b', soft: '#f1f5f9', text: '#334155', ring: '#94a3b8', grad: 'from-slate-400 to-slate-600' },
};

export const partyColor = (p) => PARTY_COLORS[String(p || '').toUpperCase()] || PARTY_COLORS.DEFAULT;

export const fmtNum = (n) => (n || n === 0 ? Number(n).toLocaleString('en-IN') : '—');

export const fmtShort = (n) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return String(v);
};

export const initialOf = (name) => String(name || '?').trim().charAt(0).toUpperCase() || '?';

export const titleCase = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

/* Animated count-up. Re-animates from the previous value whenever `target`
   changes — so switching the opponent mid-comparison counts to the new number
   instead of snapping. easeOutCubic for a lively-but-settled feel. */
export const useCountUp = (target, { duration = 900, decimals = 0 } = {}) => {
  // Starts from 0 on mount so every reveal (and every opponent switch, which
  // remounts the view) counts up rather than snapping into place.
  const [val, setVal] = useState(0);
  const state = useRef({ raf: 0, from: 0 });

  useEffect(() => {
    const from = state.current.from;
    const to = Number(target) || 0;
    if (from === to) { setVal(to); return undefined; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(from + (to - from) * eased);
      if (t < 1) {
        state.current.raf = requestAnimationFrame(tick);
      } else {
        state.current.from = to;
      }
    };
    cancelAnimationFrame(state.current.raf);
    state.current.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(state.current.raf);
  }, [target, duration]);

  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
};
