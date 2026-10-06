import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { geoMercator, geoPath } from 'd3-geo';
import { Loader2, Maximize2, Crosshair } from 'lucide-react';
import api from '../lib/api';

const normalize = (v) => String(v || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]/g, '').trim();

const titleCase = (v) =>
  String(v || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();

// Priority colour scale: negative/critical sentiment = high priority (red),
// positive = low priority (green). Buckets come from constituency-intel.
const BUCKET_COLOR = {
  critical: '#dc2626',
  negative: '#f97316',
  mixed: '#eab308',
  positive: '#22c55e',
  no_data: '#e2e8f0',
};

const LEGEND = [
  { color: '#dc2626', label: 'High priority' },
  { color: '#f97316', label: 'Elevated' },
  { color: '#eab308', label: 'Watch' },
  { color: '#22c55e', label: 'Low priority' },
  { color: '#e2e8f0', label: 'No data' },
];

// Module-level promise caches — the heat map renders in BOTH the voter-profile
// and social-narrative panels, so the large GeoJSON and the 40-seat leaderboard
// are fetched once and shared, not duplicated per instance. Leaderboard cached
// for 60s so quick re-mounts (tab/navigation) reuse it.
let geoPromise = null;
const loadGeo = () => {
  if (geoPromise) return geoPromise;
  geoPromise = (async () => {
    const sources = ['/state_ac.geojson'];
    for (const src of sources) {
      try {
        const res = await fetch(src);
        if (!res.ok) continue;
        const parsed = JSON.parse(await res.text());
        if (parsed?.features?.length) return parsed;
      } catch (_e) { /* try next */ }
    }
    return null;
  })();
  return geoPromise;
};

let leaderboardPromise = null;
let leaderboardAt = 0;
const loadLeaderboard = () => {
  if (leaderboardPromise && Date.now() - leaderboardAt < 60000) return leaderboardPromise;
  leaderboardAt = Date.now();
  leaderboardPromise = api
    .get('/constituency-intel/leaderboard', { params: { days: 365, sort: 'index', order: 'asc', limit: 200 } })
    .then((res) => {
      const map = {};
      for (const r of res.data?.data || []) {
        map[normalize(r.constituency)] = { bucket: r.bucket, negative: r.negative, index: r.sentiment_index };
      }
      return map;
    })
    .catch(() => ({}));
  return leaderboardPromise;
};

// One AC's <path>. Memoized so hovering seat A only re-renders seat A and
// whichever seat was previously hovered — not all 90 paths on every mouse
// move (which is what was causing the map, and the whole page with two maps
// on it, to feel laggy).
const ACPath = memo(function ACPath({ d, fill, isTarget, isHover, zoomed, dataKey }) {
  return (
    <path
      data-key={dataKey}
      d={d}
      fill={fill}
      stroke={isTarget ? '#0f172a' : '#ffffff'}
      strokeWidth={isTarget ? 2.5 : 0.4}
      vectorEffect="non-scaling-stroke"
      opacity={isTarget ? 1 : isHover ? 1 : zoomed ? 0.6 : 0.9}
      style={isTarget && zoomed ? { animation: 'acPulse 1.8s ease-in-out infinite' } : undefined}
      className="cursor-pointer transition-opacity duration-150"
    />
  );
});

/**
 * Statewide constituency heat-map coloured by real per-seat priority
 * (sentiment/grievance pressure from /constituency-intel/leaderboard).
 * The current constituency is outlined; other seats are clickable.
 */
const ConstituencyHeatMap = ({ currentConstituency }) => {
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const [geo, setGeo] = useState(null);
  const [priorityByKey, setPriorityByKey] = useState({});
  const [hover, setHover] = useState(null);
  const [inView, setInView] = useState(false);
  const [showFull, setShowFull] = useState(false); // user override: full state map
  const target = normalize(currentConstituency);

  useEffect(() => {
    let cancelled = false;
    loadGeo().then((parsed) => { if (!cancelled && parsed) setGeo(parsed); });
    loadLeaderboard().then((map) => { if (!cancelled) setPriorityByKey(map); });
    return () => { cancelled = true; };
  }, []);

  const acName = useCallback(
    (f) => f?.properties?.AC_NAME || f?.properties?.ac_name || f?.properties?.NAME || f?.properties?.name || '',
    []
  );

  const { path, features } = useMemo(() => {
    if (!geo) return { path: null, features: [] };
    const projection = geoMercator().fitSize([520, 400], geo);
    return { path: geoPath().projection(projection), features: geo.features };
  }, [geo]);

  // Auto-zoom target: map the highlighted seat's bounds to the frame centre.
  const zoom = useMemo(() => {
    if (!path || !features.length) return null;
    const hf = features.find((f) => normalize(acName(f)) === target);
    if (!hf) return null;
    const [[x0, y0], [x1, y1]] = path.bounds(hf);
    const w = x1 - x0, h = y1 - y0;
    if (!(w > 0) || !(h > 0)) return null;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let scale = 0.5 * Math.min(520 / w, 400 / h);
    scale = Math.max(1.8, Math.min(scale, 7));
    const tx = 260 - cx * scale;
    const ty = 200 - cy * scale;
    return `translate(${tx}px, ${ty}px) scale(${scale})`;
  }, [path, features, target, acName]);

  // Trigger the zoom when the map scrolls into view (re-animates on re-entry).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.4 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [geo]);

  // Precomputed once per data change (NOT per hover) — the expensive part
  // (path generation, colour lookup) never re-runs just because the mouse moved.
  // Must stay above the early-return below — all hooks need to run on every
  // render in the same order (rules-of-hooks).
  const featureData = useMemo(() => {
    if (!path) return [];
    return features.map((f) => {
      const name = acName(f);
      const key = normalize(name);
      const info = priorityByKey[key];
      return {
        key,
        name,
        d: path(f),
        fill: info ? (BUCKET_COLOR[info.bucket] || BUCKET_COLOR.no_data) : BUCKET_COLOR.no_data,
        isTarget: key === target,
      };
    });
  }, [features, path, priorityByKey, target, acName]);

  // Event delegation: one listener for the whole map instead of 40 per-path
  // closures recreated every render — reading data-key off the hit element.
  const handlePointerOver = useCallback((e) => {
    const key = e.target?.dataset?.key;
    if (key) setHover(key);
  }, []);
  const handlePointerOut = useCallback(() => setHover(null), []);
  const handleMapClick = useCallback((e) => {
    const key = e.target?.dataset?.key;
    if (!key) return;
    const match = featureData.find((f) => f.key === key);
    if (match?.name) navigate(`/mla/${encodeURIComponent(titleCase(match.name))}`);
  }, [featureData, navigate]);

  if (!geo || !path) {
    return (
      <div className="h-[300px] flex items-center justify-center text-slate-400 text-sm">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading heat map…
      </div>
    );
  }

  const hoverInfo = hover ? priorityByKey[hover] : null;

  const zoomed = inView && zoom && !showFull;

  return (
    <div className="relative w-full h-full min-h-[320px] rounded-lg overflow-hidden bg-slate-50" ref={containerRef}>
      {/* Zoom toggle: focus on the seat vs. see the full state map */}
      {zoom && (
        <button
          type="button"
          onClick={() => setShowFull((v) => !v)}
          className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-white/95 border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900 transition-colors"
          title={showFull ? 'Zoom to constituency' : 'View full state map'}
        >
          {showFull ? (
            <><Crosshair className="h-3 w-3" /> Focus seat</>
          ) : (
            <><Maximize2 className="h-3 w-3" /> Full map</>
          )}
        </button>
      )}
      <svg
        viewBox="0 0 520 400"
        className="w-full h-full absolute inset-0"
        preserveAspectRatio={zoomed ? 'xMidYMid slice' : 'xMidYMid meet'}
      >
        <style>{'@keyframes acPulse{0%,100%{stroke-width:2.5px}50%{stroke-width:4.5px}}'}</style>
        <rect width="520" height="400" fill="#f8fafc" />
        <g
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={handleMapClick}
          style={{
            transform: zoomed ? zoom : 'translate(0px, 0px) scale(1)',
            transformBox: 'view-box',
            transformOrigin: '0 0',
            transition: 'transform 1.4s cubic-bezier(0.33, 1, 0.68, 1)',
            willChange: 'transform',
          }}
        >
          {featureData.map((f) => (
            <ACPath
              key={f.key || f.name}
              dataKey={f.key}
              d={f.d}
              fill={f.fill}
              isTarget={f.isTarget}
              isHover={hover === f.key}
              zoomed={zoomed}
            />
          ))}
        </g>
      </svg>

      {/* Legend */}
      <div className="absolute top-2 left-2 bg-white/95 border border-slate-200 rounded-lg px-2.5 py-2 shadow-sm space-y-1">
        <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500 mb-1">Priority</div>
        {LEGEND.map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
            <span className="text-[9px] text-slate-600">{l.label}</span>
          </div>
        ))}
      </div>

      {/* Hover / current-seat tooltip */}
      <div className="absolute bottom-2 right-2 bg-white/95 border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm text-[10px] max-w-[200px]">
        {hover ? (
          <>
            <span className="font-semibold text-slate-800">{titleCase(hover === target ? currentConstituency : hover)}</span>
            {hoverInfo ? (
              <span className="text-slate-500"> · {hoverInfo.negative} negative mentions · sentiment {hoverInfo.index > 0 ? '+' : ''}{hoverInfo.index}</span>
            ) : (
              <span className="text-slate-400"> · no data</span>
            )}
          </>
        ) : (
          <span className="text-slate-500">
            Highlighted: <span className="font-semibold text-slate-800">{titleCase(currentConstituency)}</span> · hover any seat
          </span>
        )}
      </div>
    </div>
  );
};

export default ConstituencyHeatMap;
