import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { Loader2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { BRAND } from '../../config/partyMedia';

export const normalizeGeoName = (v) => String(v || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]/g, '').trim();
const normalize = normalizeGeoName;
const titleCase = (v) => String(v || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const DEFAULT_NAME_KEYS = ['DIST_NAME', 'district_name', 'district', 'DISTRICT', 'dtname', 'AC_NAME', 'ac_name', 'NAME_2', 'NAME_1', 'NAME', 'name'];
const getFeatureName = (props = {}) => {
  for (const key of DEFAULT_NAME_KEYS) {
    if (props[key]) return String(props[key]).trim();
  }
  return '';
};
const getStateName = (props = {}) => String(props.ST_NAME || props.st_nm || props.st_name || props.STATE || props.state || '').trim();

// Module-level GeoJSON cache — the same shape (district or AC boundaries) is
// reused across every tab that renders a map, so it's fetched once per
// session, not once per component mount.
const geoCache = new Map();
const loadGeo = (sources) => {
  const cacheKey = sources.join('|');
  if (geoCache.has(cacheKey)) return geoCache.get(cacheKey);
  const promise = (async () => {
    for (const src of sources) {
      try {
        const res = await fetch(src);
        if (!res.ok) continue;
        const text = await res.text();
        if (!text?.trim()) continue;
        const parsed = JSON.parse(text);
        if (!parsed?.features?.length) continue;
        const normalized = parsed.features.map((f) => ({
          ...f,
          properties: { ...f.properties, __name: getFeatureName(f.properties), __state: getStateName(f.properties) },
        }));
        const stateOnly = normalized.filter((f) => normalize(f.properties.__state) === normalize(BRAND.stateName));
        return { ...parsed, features: stateOnly.length ? stateOnly : normalized };
      } catch (_e) { /* try next source */ }
    }
    return null;
  })();
  geoCache.set(cacheKey, promise);
  return promise;
};

const FeaturePath = memo(function FeaturePath({ d, fill, isHover, isSelected, strokeWidth, name, ...rest }) {
  return (
    <path
      d={d}
      fill={fill}
      stroke={isSelected ? '#1e293b' : '#ffffff'}
      strokeWidth={isSelected ? strokeWidth * 2.5 : strokeWidth}
      opacity={isHover ? 1 : 0.95}
      className="cursor-pointer transition-opacity duration-100 outline-none focus-visible:stroke-yellow-500"
      vectorEffect="non-scaling-stroke"
      role="button"
      tabIndex={0}
      aria-label={name}
      {...rest}
    />
  );
});

/**
 * Generic light-theme choropleth — geography-agnostic. Feed it a GeoJSON
 * source list, a lookup of normalized-name → data, and a color function; it
 * handles projection, hover/click, and basic zoom. Reused for the district
 * sentiment heatmap, the historical-playback map, and (in principle) any
 * other state boundary map, instead of separate d3-geo implementations.
 */
const GeoChoropleth = ({
  sources,
  dataByKey = {},
  colorFor,
  onFeatureClick,
  legend = [],
  height = 420,
  selectedKey,
  tooltipRenderer,
  emptyColor = '#e2e8f0',
}) => {
  const [geo, setGeo] = useState(null);
  const [hover, setHover] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadGeo(sources).then((parsed) => { if (!cancelled) setGeo(parsed); });
    return () => { cancelled = true; };
  }, [sources]);

  const { path, features } = useMemo(() => {
    if (!geo) return { path: null, features: [] };
    const projection = geoMercator().fitSize([700, 560], geo);
    return { path: geoPath().projection(projection), features: geo.features };
  }, [geo]);

  // Geometry (path projection) is invariant across data updates — only
  // recomputed when the source features/projection change. Color/entry is
  // split into its own memo so a data-only change (e.g. every ~700ms
  // Historical Playback frame tick) doesn't re-run the expensive d3 path()
  // projection for all ~26 features, only the cheap color lookup.
  const geometryData = useMemo(() => {
    if (!path) return [];
    return features.map((f) => {
      const name = f.properties.__name;
      const key = normalize(name);
      return { key, name, d: path(f) };
    });
  }, [features, path]);

  const featureData = useMemo(() => (
    geometryData.map((g) => {
      const entry = dataByKey[g.key] || null;
      return { ...g, entry, fill: colorFor(entry) || emptyColor };
    })
  ), [geometryData, dataByKey, colorFor, emptyColor]);

  const handlePointerOver = useCallback((e) => {
    const idx = e.target?.dataset?.idx;
    if (idx !== undefined) setHover(featureData[Number(idx)] || null);
  }, [featureData]);
  const handlePointerOut = useCallback(() => setHover(null), []);
  const handleMove = useCallback((e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);
  const handleClick = useCallback((e) => {
    const idx = e.target?.dataset?.idx;
    if (idx === undefined) return;
    const f = featureData[Number(idx)];
    if (f) onFeatureClick?.(f.name, f.entry);
  }, [featureData, onFeatureClick]);
  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const idx = e.target?.dataset?.idx;
    if (idx === undefined) return;
    e.preventDefault();
    const f = featureData[Number(idx)];
    if (f) { setHover(f); onFeatureClick?.(f.name, f.entry); }
  }, [featureData, onFeatureClick]);

  if (!geo || !path) {
    return (
      <div style={{ height }} className="flex flex-col items-center justify-center bg-slate-50 rounded-xl border border-slate-200">
        <Loader2 className="h-6 w-6 animate-spin text-yellow-600" />
        <span className="text-[11px] text-slate-500 mt-2 font-semibold">Loading map…</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ height }} className="relative w-full rounded-xl border border-slate-200 bg-[#fafafa] overflow-hidden select-none">
      <svg
        viewBox="0 0 700 560"
        className="w-full h-full"
        onMouseMove={handleMove}
        onClick={handleClick}
      >
        <rect width="700" height="560" fill="#fafafa" />
        <g
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onKeyDown={handleKeyDown}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 0.2s ease-out' }}
        >
          {featureData.map((f, idx) => (
            <FeaturePath
              key={f.key || idx}
              d={f.d}
              fill={f.fill}
              name={f.name}
              isHover={hover?.key === f.key}
              isSelected={selectedKey && f.key === selectedKey}
              strokeWidth={0.6}
              data-idx={idx}
            />
          ))}
        </g>
      </svg>

      {legend.length > 0 && (
        <div className="absolute top-2 left-2 bg-white/95 border border-slate-200 rounded-lg px-2.5 py-2 space-y-1 shadow-sm">
          {legend.map((l) => (
            <div key={l.label} className="flex items-center gap-1.5 text-[9px] text-slate-600">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      )}

      <div className="absolute right-2 bottom-2 flex flex-col gap-1">
        <button type="button" onClick={() => setZoom((z) => Math.min(z + 0.4, 4))} className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 shadow-sm text-slate-600" title="Zoom in">
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => setZoom((z) => Math.max(z - 0.4, 1))} className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 shadow-sm text-slate-600" title="Zoom out">
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => setZoom(1)} className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 shadow-sm text-slate-600" title="Reset">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {hover && (
        <div
          className="absolute z-10 pointer-events-none bg-white/95 border border-slate-200 shadow-xl rounded-lg px-3 py-2 text-xs max-w-[220px]"
          style={{ left: Math.min(tooltipPos.x + 12, 460), top: Math.min(tooltipPos.y + 12, height - 90) }}
        >
          {tooltipRenderer ? tooltipRenderer(hover.name, hover.entry) : (
            <>
              <div className="font-bold text-slate-800">{titleCase(hover.name)}</div>
              {hover.entry ? (
                <div className="text-slate-500 mt-0.5">{hover.entry.total_mentions ?? hover.entry.total ?? 0} mentions</div>
              ) : (
                <div className="text-slate-400 mt-0.5">No data</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default GeoChoropleth;
