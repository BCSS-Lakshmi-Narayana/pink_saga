import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { Loader2, Search, Maximize2, Minimize2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Card } from '../../ui/card';
import { STATE_MLAS, getMlaByConstituency, canonicalDistrictName } from '../../../data/stateMLAs';
import { BRAND } from '../../../config/partyMedia';
import { getMpByLsId, getMpByLsName } from '../../../data/stateMPs';
import { PARTY_ORDER, partyStyle } from '../../../config/partyColors';

const DISTRICT_SOURCES = [
  '/state_districts.geojson',
  '/state_outline.geojson',
];

const AC_SOURCES = [
  '/state_ac.geojson',
];

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const titleCase = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const getDistrictName = (props = {}) => {
  const direct =
    props.DIST_NAME ||
    props.district_name ||
    props.district ||
    props.DISTRICT ||
    props.dtname ||
    props.NAME_2 ||
    props.NAME_1 ||
    props.NAME ||
    props.name ||
    '';
  return String(direct || '').trim();
};

const getStateName = (props = {}) => {
  const direct = props.ST_NAME || props.st_nm || props.st_name || props.STATE || props.state || '';
  return String(direct || '').trim();
};

const getAcName = (props = {}) => {
  const direct = props.AC_NAME || props.ac_name || props.NAME || props.name || props.Name || '';
  return String(direct || '').trim();
};

// District spellings ("Kawardha", "GPM", "Kabirdham district") resolve to the
// canonical district, keyed like the backend's district normaliser. The
// variant map is generated from backend/src/data/state_geo.json.
const normalizeDistrictKey = (name) => {
  if (!name) return '';
  const clean = String(name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const canonical = canonicalDistrictName(name);
  return canonical ? canonical.toLowerCase() : clean;
};

// District colour in party view = the party holding the most seats there,
// derived from the MLA roster so it follows by-elections and defections.
const DISTRICT_PARTY_MAP = (() => {
  const counts = {};
  for (const m of STATE_MLAS) {
    if (m.vacant) continue;
    const d = normalizeDistrictKey(m.district);
    counts[d] = counts[d] || {};
    counts[d][m.party] = (counts[d][m.party] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).map(([d, c]) => [d, Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]])
  );
})();
const getDistrictParty = (distName) => DISTRICT_PARTY_MAP[normalizeDistrictKey(distName)] || null;

const getPartyFill = (party) => (party ? partyStyle(party).hex : '#cbd5e1');

/**
 * APMap Component
 * Hero visualization with zoom, pan, search, view modes, and legends.
 */
const APMap = ({ mapData, loading: statsLoading, onConstituencyClick, filters }) => {
  const [districtGeo, setDistrictGeo] = useState(null);
  const [acGeo, setAcGeo] = useState(null);
  const [viewLevel, setViewLevel] = useState('ac'); // 'district' | 'ac'
  const [viewMode, setViewMode] = useState('sentiment'); // 'sentiment' | 'volume' | 'engagement' | 'party'
  const [searchQuery, setSearchQuery] = useState('');
  const [hovered, setHovered] = useState(null);
  const [tooltip, setTooltip] = useState({ x: 0, y: 0 });
  const [loadingGeo, setLoadingGeo] = useState(true);

  // Zoom/Pan State — the SVG is transformed with origin 0 0:
  //   screen = offset + zoom * point
  // so zooming can keep the point under the cursor fixed.
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState([0, 0]);
  const [isPanning, setIsPanning] = useState(false);
  const canvasRef = useRef(null);
  const viewRef = useRef({ zoom: 1, offset: [0, 0] });
  viewRef.current = { zoom, offset };
  // Drag bookkeeping; `moved` suppresses the click that ends a drag.
  const dragRef = useRef({ active: false, pointerId: null, startX: 0, startY: 0, ox: 0, oy: 0, moved: false });

  // Fetch GeoJSON sources
  useEffect(() => {
    const loadSources = async (sources) => {
      for (const source of sources) {
        try {
          const res = await fetch(source);
          if (!res.ok) continue;
          const text = await res.text();
          if (!text || !text.trim()) continue;
          const parsed = JSON.parse(text);
          if (!parsed?.features?.length) continue;

          const normalizedFeatures = parsed.features.map((feature) => {
            const props = feature.properties || {};
            return {
              ...feature,
              properties: {
                ...props,
                DIST_NAME: getDistrictName(props),
                AC_NAME: getAcName(props),
                ST_NAME: getStateName(props),
              },
            };
          });

          const stateOnly = normalizedFeatures.filter(
            (f) => normalize(f.properties?.ST_NAME) === normalize(BRAND.stateName)
          );
          const features = stateOnly.length > 0 ? stateOnly : normalizedFeatures;
          return { ...parsed, features };
        } catch (_err) {
          // Continue to next source
        }
      }
      return null;
    };

    (async () => {
      setLoadingGeo(true);
      const [districts, acs] = await Promise.all([
        loadSources(DISTRICT_SOURCES),
        loadSources(AC_SOURCES),
      ]);
      setDistrictGeo(districts);
      setAcGeo(acs);
      setLoadingGeo(false);
    })();
  }, []);

  const geojson = viewLevel === 'district' ? districtGeo : acGeo;

  // D3 Projection
  const projection = useMemo(() => {
    if (!geojson) return null;
    const p = geoMercator();
    p.fitSize([750, 520], geojson);
    return p;
  }, [geojson]);

  const path = useMemo(() => {
    if (!projection) return null;
    return geoPath().projection(projection);
  }, [projection]);

  // Crop the drawing to the state's own outline (plus a margin) instead of
  // the fixed 750×520 frame. A tall or narrow state left most of
  // the canvas empty; with the real bounds the SVG scales the map to fill the
  // available height and still fit whole (preserveAspectRatio "meet").
  const viewBox = useMemo(() => {
    if (!path || !geojson) return '0 0 750 520';
    const [[x0, y0], [x1, y1]] = path.bounds(geojson);
    const pad = Math.max(x1 - x0, y1 - y0) * 0.03;
    return `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`;
  }, [path, geojson]);
  // Color matching formulas based on view modes
  const getFillColor = useCallback((name, stats) => {
    if (viewMode === 'party') {
      if (viewLevel === 'district') {
        return getPartyFill(getDistrictParty(name));
      }
      const mla = getMlaByConstituency(name);
      return getPartyFill(mla?.party);
    }

    if (!stats || stats.total === 0) return '#cbd5e1';
    if (viewMode === 'sentiment') {
      const negRatio = (stats.negative || 0) / Math.max(stats.total, 1);
      if (negRatio >= 0.5) return '#ef4444'; // Red (High negative)
      if (negRatio >= 0.25) return '#f97316'; // Orange (Medium negative)
      return '#10b981'; // Green (Low negative/Positive)
    }

    if (viewMode === 'volume') {
      const volume = stats.total || 0;
      if (volume >= 100) return '#ca8a04'; // Deep Gold
      if (volume >= 30)  return '#eab308'; // Gold
      if (volume >= 10)  return '#facc15'; // Yellow
      return '#fef08a'; // Light Yellow
    }

    if (viewMode === 'engagement') {
      const eng = stats.engagement || 0;
      if (eng >= 1000) return '#1d4ed8'; // Deep Blue
      if (eng >= 200)  return '#3b82f6'; // Blue
      if (eng >= 50)   return '#60a5fa'; // Light Blue
      return '#bfdbfe'; // Very Light Blue
    }

    return '#e2e8f0';
  }, [viewMode, viewLevel]);

  // Map mouse handlers
  const handleMouseMove = (e, name) => {
    setHovered(name);
    setTooltip({ x: e.clientX, y: e.clientY });
  };

  const handleMouseLeave = () => {
    setHovered(null);
  };

  // Zoom about a point in canvas pixels (the cursor, or the canvas centre for
  // the buttons), keeping that point fixed on screen.
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 8;
  const zoomAt = useCallback((factor, cx, cy) => {
    const { zoom: z, offset: [ox, oy] } = viewRef.current;
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
    if (nz === z) return;
    const px = (cx - ox) / z;
    const py = (cy - oy) / z;
    setZoom(nz);
    setOffset([cx - nz * px, cy - nz * py]);
  }, []);

  const zoomAtCentre = (factor) => {
    const el = canvasRef.current;
    if (!el) return;
    zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
  };
  const handleZoomIn = () => zoomAtCentre(1.4);
  const handleZoomOut = () => zoomAtCentre(1 / 1.4);
  const handleReset = () => {
    setZoom(1);
    setOffset([0, 0]);
  };

  // Mouse-wheel / trackpad zoom at the cursor. Registered natively because
  // React's onWheel is passive and cannot stop the page from scrolling.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, geojson]);

  // Drag to pan, anywhere on the canvas and with no bounds — mouse, pen or
  // touch. Pointer capture keeps the drag going outside the canvas.
  const handlePointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const [ox, oy] = viewRef.current.offset;
    dragRef.current = { active: true, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, ox, oy, moved: false };
  };

  const handlePointerMove = (e) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 4) return; // still a click
    if (!d.moved) {
      d.moved = true;
      setIsPanning(true);
      setHovered(null);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    setOffset([d.ox + dx, d.oy + dy]);
  };

  const handlePointerUp = (e) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    d.active = false;
    setIsPanning(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // Clear `moved` after the click event that follows this pointerup.
    if (d.moved) setTimeout(() => { dragRef.current.moved = false; }, 0);
  };

  // Search filter
  const filteredFeatures = useMemo(() => {
    if (!geojson) return [];
    if (!searchQuery) return geojson.features;
    const query = normalize(searchQuery);
    return geojson.features.filter(f => {
      const name = normalize(viewLevel === 'ac' ? getAcName(f.properties) : getDistrictName(f.properties));
      return name.includes(query);
    });
  }, [geojson, searchQuery, viewLevel]);

  if (loadingGeo || statsLoading || !geojson || !path) {
    return (
      <div className="h-full min-h-[500px] w-full flex flex-col items-center justify-center bg-slate-50 rounded-xl border border-slate-200">
        <Loader2 className="h-8 w-8 animate-spin text-yellow-600" />
        <span className="text-xs text-slate-500 mt-2 font-semibold">Loading Constituency GeoJSON Layers...</span>
      </div>
    );
  }

  return (
    <Card className="relative h-full min-h-0 flex flex-col border border-slate-200 overflow-hidden bg-slate-50 select-none">
      {/* Top Map Controls */}
      <div className="px-2.5 py-2 bg-white border-b border-slate-100 flex flex-wrap items-center gap-2 z-10">
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 flex-1 min-w-[120px] max-w-[190px]">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search seat…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="text-[11px] bg-transparent border-none outline-none w-full text-slate-700"
          />
        </div>

        {/* View Mode Select */}
        <div className="flex rounded-md overflow-hidden border border-slate-200 text-[11px] ml-auto">
          {['sentiment', 'volume', 'engagement', 'party'].map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-2 py-1 font-medium transition-colors border-r last:border-r-0 ${
                viewMode === mode
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'
              }`}
            >
              <span className="capitalize">{mode}</span>
            </button>
          ))}
        </div>

        {/* View Level */}
        <div className="flex rounded-md overflow-hidden border border-slate-200 text-[11px]">
          <button
            onClick={() => setViewLevel('ac')}
            className={`px-2 py-1 font-medium transition-colors ${
              viewLevel === 'ac' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Assembly
          </button>
          <button
            onClick={() => setViewLevel('district')}
            className={`px-2 py-1 font-medium transition-colors border-l ${
              viewLevel === 'district' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            District
          </button>
        </div>
      </div>

      {/* Hero Interactive Map Canvas */}
      <div
        ref={canvasRef}
        className={`flex-1 min-h-[260px] relative overflow-hidden bg-[#fafafa] ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          zoomAt(1.6, e.clientX - rect.left, e.clientY - rect.top);
        }}
      >
        {/* Absolutely positioned so its size comes from the canvas box, not
            from its own aspect ratio (h-full inside a flex item does not
            resolve, which made the SVG taller than the canvas and clipped it). */}
        <svg
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 w-full h-full transform-gpu"
          style={{
            transform: `translate(${offset[0]}px, ${offset[1]}px) scale(${zoom})`,
            transformOrigin: '0 0',
            transition: isPanning ? 'none' : 'transform 0.12s ease-out'
          }}
        >
          {filteredFeatures.map((feature, idx) => {
            const name = viewLevel === 'ac' ? getAcName(feature.properties) : getDistrictName(feature.properties);
            const lowerName = name.toLowerCase();

            // Fetch live metrics
            const stats = viewLevel === 'ac'
              ? mapData?.constituencies?.[lowerName]
              : mapData?.districts?.[normalizeDistrictKey(name)] || mapData?.districts?.[lowerName];

            const isHovered = hovered === name;
            const fill = getFillColor(name, stats);

            return (
              <path
                key={`${name}-${idx}`}
                d={path(feature)}
                fill={isHovered ? '#1e293b' : fill}
                stroke="#ffffff"
                strokeWidth={viewLevel === 'district' ? 1.4 : 0.8}
                className="transition-colors duration-100 ease-out cursor-pointer"
                vectorEffect="non-scaling-stroke"
                onMouseMove={(e) => { if (!isPanning) handleMouseMove(e, name); }}
                onMouseLeave={handleMouseLeave}
                onClick={() => { if (!dragRef.current.moved) onConstituencyClick(name); }}
              />
            );
          })}
        </svg>

        {/* Legend Panel */}
        <div className="absolute top-2 left-3 bg-white/95 border border-slate-200/80 rounded-lg shadow-md p-2 z-10 max-w-[155px] text-[9px]">
          <div className="font-bold text-slate-700 mb-1 uppercase tracking-wide">
            {viewMode === 'sentiment' ? 'Sentiment View' :
             viewMode === 'volume' ? 'Mention Volume' :
             viewMode === 'engagement' ? 'Total Engagement' : 'winning party'}
          </div>

          <div className="space-y-0.5">
            {viewMode !== 'party' && (
              <div className="flex items-center gap-1.5 border-b border-slate-100 pb-1 mb-1 text-slate-500">
                <span className="w-2.5 h-2.5 rounded bg-[#cbd5e1]" />
                <span>No Data</span>
              </div>
            )}
            {viewMode === 'sentiment' && (
              <>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-[#10b981]" />Low Risk (&lt;25% Neg)</div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-[#f97316]" />Medium Risk (25-50% Neg)</div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-[#ef4444]" />High Risk (&gt;50% Neg)</div>
              </>
            )}
            {viewMode === 'volume' && (
              <>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-[#ca8a04]" />High (100+ Mentions)</div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-[#eab308]" />Moderate (30-100)</div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-[#facc15]" />Low (10-30)</div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-[#fef08a]" />Minimal (&lt;10)</div>
              </>
            )}
            {viewMode === 'engagement' && (
              <>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-[#1d4ed8]" />Extreme (1K+)</div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-[#3b82f6]" />High (200-1K)</div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-[#60a5fa]" />Moderate (50-200)</div>
                <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-[#bfdbfe]" />Low (&lt;50)</div>
              </>
            )}
            {viewMode === 'party' && (
              <>
                {PARTY_ORDER.map((code) => (
                  <div key={code} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded" style={{ background: partyStyle(code).hex }} />
                    {code === 'VACANT' ? 'Vacant' : code}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Map Float HUD controls */}
        <div className="absolute right-3 bottom-3 flex flex-col gap-1 z-10">
          <button
            onClick={handleZoomIn}
            className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 shadow-md text-slate-600"
            title="Zoom In"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 shadow-md text-slate-600"
            title="Zoom Out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            onClick={handleReset}
            className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 shadow-md text-slate-600"
            title="Reset View"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Floating Hover Tooltip */}
      {hovered && (
        <div
          className="fixed z-50 pointer-events-none bg-white/95 border border-slate-200 shadow-xl rounded-xl px-3.5 py-2.5 text-xs select-none backdrop-blur-sm"
          style={{ left: tooltip.x + 15, top: tooltip.y + 15 }}
        >
          <div className="font-bold text-slate-800 capitalize mb-1">{titleCase(hovered)}</div>
          
          {(() => {
            const stats = viewLevel === 'ac'
              ? mapData?.constituencies?.[hovered.toLowerCase()]
              : mapData?.districts?.[normalizeDistrictKey(hovered)] || mapData?.districts?.[hovered.toLowerCase()];

            const mla = viewLevel === 'ac' ? getMlaByConstituency(hovered) : null;

            return (
              <div className="space-y-1 text-slate-600">
                {mla && (
                  <div className="text-[10px] text-slate-400 font-semibold mb-1">
                    {mla.vacant ? 'Seat vacant' : `MLA: ${mla.mla} (${mla.party})`}
                  </div>
                )}
                <div>Mentions: <span className="font-semibold text-slate-800">{stats?.total || 0}</span></div>
                <div className="flex gap-2">
                  <span className="text-emerald-600">Pos: {stats?.positive || 0}</span>
                  <span className="text-red-500">Neg: {stats?.negative || 0}</span>
                </div>
                {stats?.topTopic && (
                  <div className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded mt-1.5 font-medium">
                    Top Issue: {stats.topTopic}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </Card>
  );
};

export default APMap;
