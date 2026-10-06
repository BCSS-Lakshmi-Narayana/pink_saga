import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Play, Pause, History } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import GeoChoropleth, { normalizeGeoName } from '../GeoChoropleth';
import StateKpiTile from '../StateKpiTile';
import SentimentTrendChart from '../SentimentTrendChart';
import InsightsSummaryPanel from '../InsightsSummaryPanel';
import { MOOD_LEGEND, bucketColorForIndex, DISTRICT_GEOJSON_SOURCES } from '../sentimentScale';
import { PLATFORM_META } from '../platformScale';
import { toLocalYMD } from '../geoDate';
import { usePlayback } from '../../../hooks/useGeoIntel';

const PRESETS = [
  { label: 'Last 7 Days', days: 7 },
  { label: 'Last 30 Days', days: 30 },
  { label: 'Last 90 Days', days: 90 },
];

const pct = (n, t) => (t > 0 ? Math.round((n / t) * 100) : 0);

const aggregateFrames = (frames) => {
  const totals = frames.reduce((acc, f) => {
    f.districts.forEach((d) => {
      acc.total += d.total_mentions;
      acc.positive += d.positive;
      acc.negative += d.negative;
      acc.neutral += d.neutral;
    });
    return acc;
  }, { total: 0, positive: 0, negative: 0, neutral: 0 });
  return totals;
};

/**
 * Historical Playback — "Political Time Machine". Scrubs through the
 * district sentiment heatmap day by day via /api/geo-intel/playback, backed
 * by a real state-wide sentiment-over-time chart (summed from the same
 * frames — no extra request), a platforms-over-time stacked area, event
 * markers on the timeline for the sharpest single-day swings, an optional
 * previous-period comparison, and a rule-based insights summary.
 */
const HistoricalPlaybackTab = ({ sharedFilters, active = true }) => {
  const [rangeDays, setRangeDays] = useState(7);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const timerRef = useRef(null);

  // Inherits platform/sentiment/topic from the shared GeoFilterBar so
  // switching to Playback doesn't silently drop whatever the user was
  // already filtering by on the other tabs — only the date range is
  // Playback's own (a fixed range doesn't fit a "scrub through time" UI).
  const filters = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - rangeDays * 86400000);
    return {
      from: toLocalYMD(from),
      to: toLocalYMD(to),
      platform: sharedFilters?.platform,
      sentiment: sharedFilters?.sentiment,
      topic: sharedFilters?.topic,
    };
  }, [rangeDays, sharedFilters?.platform, sharedFilters?.sentiment, sharedFilters?.topic]);

  const prevFilters = useMemo(() => {
    const to = new Date(new Date(filters.from).getTime() - 86400000);
    const from = new Date(to.getTime() - rangeDays * 86400000);
    return { ...filters, from: toLocalYMD(from), to: toLocalYMD(to) };
  }, [filters, rangeDays]);

  // `active` lets the page keep this tab mounted (preserving the range/
  // scrubber position/compare toggle) while hidden, without it continuing
  // to fetch or tick the animation timer in the background.
  const { data, loading, error } = usePlayback(filters, { enabled: active });
  const { data: prevData, loading: prevLoading } = usePlayback(prevFilters, { enabled: active && compareMode });
  const frames = useMemo(() => data?.frames || [], [data]);

  useEffect(() => { setFrameIdx(0); setPlaying(false); }, [rangeDays, data]);

  useEffect(() => {
    if (!active || !playing || !frames.length) return;
    timerRef.current = setInterval(() => {
      setFrameIdx((i) => (i + 1 >= frames.length ? 0 : i + 1));
    }, 700);
    return () => clearInterval(timerRef.current);
  }, [active, playing, frames.length]);

  const currentFrame = frames[frameIdx];

  const dataByKey = useMemo(() => {
    const map = {};
    (currentFrame?.districts || []).forEach((d) => { map[normalizeGeoName(d.name)] = d; });
    return map;
  }, [currentFrame]);

  // State-wide daily sentiment — summed from the same per-day/per-district
  // frames already fetched for the map, so this needs no extra request.
  const dailySentiment = useMemo(() => frames.map((f) => {
    const t = f.districts.reduce((acc, d) => {
      acc.total += d.total_mentions; acc.positive += d.positive; acc.negative += d.negative; acc.neutral += d.neutral;
      return acc;
    }, { total: 0, positive: 0, negative: 0, neutral: 0 });
    return { date: f.date, ...t };
  }), [frames]);

  // Event markers — days where the sentiment index swung sharply vs the
  // previous day, surfaced as ticks above the scrubber.
  const eventFrames = useMemo(() => {
    const events = [];
    for (let i = 1; i < dailySentiment.length; i++) {
      const idxNow = pct(dailySentiment[i].positive - dailySentiment[i].negative, dailySentiment[i].total || 1);
      const idxPrev = pct(dailySentiment[i - 1].positive - dailySentiment[i - 1].negative, dailySentiment[i - 1].total || 1);
      if (Math.abs(idxNow - idxPrev) >= 25 && dailySentiment[i].total >= 5) {
        events.push({ index: i, date: dailySentiment[i].date, severity: idxNow < idxPrev ? 'negative' : 'positive' });
      }
    }
    return events;
  }, [dailySentiment]);

  const totals = useMemo(() => aggregateFrames(frames), [frames]);
  const prevTotals = useMemo(() => (prevData ? aggregateFrames(prevData.frames || []) : null), [prevData]);
  const changePct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0));

  const platformSeries = useMemo(() => frames.map((f) => ({ date: f.date, ...f.platforms })), [frames]);
  const platformKeys = useMemo(() => {
    const keys = new Set();
    frames.forEach((f) => Object.keys(f.platforms || {}).forEach((k) => keys.add(k)));
    return Array.from(keys);
  }, [frames]);

  // Rule-based insights from the fetched frames — no LLM call, mirrors the
  // approach already used in constituencyIntelligenceController.
  const insights = useMemo(() => {
    if (frames.length < 2) return [];
    const first = frames[0].districts;
    const last = frames[frames.length - 1].districts;
    const byKeyFirst = Object.fromEntries(first.map((d) => [d.key, d]));
    const notes = [];

    let worst = null;
    for (const d of last) {
      const prev = byKeyFirst[d.key];
      const delta = prev ? d.sentiment_index - prev.sentiment_index : 0;
      if (!worst || delta < worst.delta) worst = { name: d.name, delta };
    }
    if (worst && worst.delta < -10) notes.push({ tone: 'critical', text: `Sentiment declined sharply in ${worst.name} (${worst.delta} pts) over the selected window.` });

    let best = null;
    for (const d of last) {
      const prev = byKeyFirst[d.key];
      const delta = prev ? d.sentiment_index - prev.sentiment_index : 0;
      if (!best || delta > best.delta) best = { name: d.name, delta };
    }
    if (best && best.delta > 10) notes.push({ tone: 'positive', text: `Sentiment improved most in ${best.name} (+${best.delta} pts) over the selected window.` });

    if (platformKeys.length) {
      const platformTotals = Object.fromEntries(platformKeys.map((k) => [k, 0]));
      frames.forEach((f) => platformKeys.forEach((k) => { platformTotals[k] += f.platforms[k] || 0; }));
      const topPlatform = Object.entries(platformTotals).sort((a, b) => b[1] - a[1])[0];
      if (topPlatform) notes.push({ tone: 'info', text: `${topPlatform[0]} carried the most conversation volume across the period.` });
    }

    if (eventFrames.length) {
      notes.push({ tone: 'warning', text: `${eventFrames.length} day${eventFrames.length === 1 ? '' : 's'} with a sharp sentiment swing (≥25 pts) detected — see markers on the timeline.` });
    }

    if (compareMode && prevTotals) {
      const chg = changePct(totals.total, prevTotals.total);
      // Neutral tone regardless of direction — volume change isn't
      // inherently good or bad, matching TrendIndicator's rationale.
      if (Math.abs(chg) >= 10) notes.push({ tone: 'info', text: `Volume ${chg > 0 ? 'grew' : 'declined'} ${Math.abs(chg)}% vs the equivalent previous period.` });
    }

    if (!notes.length) notes.push({ tone: 'info', text: 'No major sentiment swings detected in this window.' });
    return notes;
  }, [frames, platformKeys, eventFrames, compareMode, prevTotals, totals]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-slate-800 text-white flex items-center justify-center flex-shrink-0">
          <History className="h-3.5 w-3.5" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Political Time Machine</h2>
          <p className="text-[10px] text-slate-400">Replay political conversation and sentiment evolution over time</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-lg px-3 py-2">
          {error} — showing whatever loaded successfully.
        </div>
      )}

      {/* Historical KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StateKpiTile label="Total Mentions" numericValue={totals.total} loading={loading} changePct={compareMode && prevTotals ? changePct(totals.total, prevTotals.total) : undefined} compareLabel="vs previous period" iconBg="bg-blue-50" iconColor="text-blue-600" />
        <StateKpiTile label="Positive" numericValue={pct(totals.positive, totals.total)} value={`${pct(totals.positive, totals.total)}%`} loading={loading} changePct={compareMode && prevTotals ? pct(totals.positive, totals.total) - pct(prevTotals.positive, prevTotals.total) : undefined} changeIsGood detail="pts vs previous period" iconBg="bg-emerald-50" iconColor="text-emerald-600" />
        <StateKpiTile label="Neutral" numericValue={pct(totals.neutral, totals.total)} value={`${pct(totals.neutral, totals.total)}%`} loading={loading} iconBg="bg-slate-50" iconColor="text-slate-600" />
        <StateKpiTile label="Negative" numericValue={pct(totals.negative, totals.total)} value={`${pct(totals.negative, totals.total)}%`} loading={loading} changePct={compareMode && prevTotals ? pct(totals.negative, totals.total) - pct(prevTotals.negative, prevTotals.total) : undefined} changeIsGood={false} detail="pts vs previous period" iconBg="bg-red-50" iconColor="text-red-600" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)_260px] gap-3 items-start">
        {/* Time presets + compare toggle */}
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-800">Time Presets</h3>
          <div className="space-y-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setRangeDays(p.days)}
                className={`w-full text-left text-xs font-semibold px-3 py-2 rounded-lg transition-colors ${rangeDays === p.days ? 'bg-yellow-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">Compare with previous period</span>
            <button
              type="button"
              onClick={() => setCompareMode((v) => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${compareMode ? 'bg-yellow-600' : 'bg-slate-200'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${compareMode ? 'translate-x-4' : ''}`} />
            </button>
          </div>
          {compareMode && prevLoading && <div className="text-[10px] text-slate-400 animate-pulse">Loading comparison…</div>}
          {!loading && frames.length > 0 && (
            <div className="text-[10px] text-slate-400 pt-2 border-t border-slate-100">
              {frames.length} day{frames.length === 1 ? '' : 's'} · {data.window.from.slice(0, 10)} → {data.window.to.slice(0, 10)}
            </div>
          )}
        </div>

        {/* Main: sentiment-over-time chart + map + platform trend */}
        <div className="space-y-3">
          <SentimentTrendChart data={dailySentiment} loading={loading} title="Sentiment Over Time" height={200} />

          <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-800">Sentiment Heatmap Playback</h3>
              <span className="text-xs font-semibold text-slate-500">{currentFrame?.date || '—'}</span>
            </div>
            <GeoChoropleth
              sources={DISTRICT_GEOJSON_SOURCES}
              dataByKey={dataByKey}
              colorFor={bucketColorForIndex}
              legend={MOOD_LEGEND}
              height={380}
              tooltipRenderer={(name, entry) => (
                <>
                  <div className="font-bold text-slate-800">{name}</div>
                  {entry ? (
                    <div className="text-slate-500">{entry.total_mentions} mentions · index {entry.sentiment_index}</div>
                  ) : <div className="text-slate-400">No data</div>}
                </>
              )}
            />
            {frames.length > 0 && (
              <div className="mt-3">
                {/* Event markers */}
                {eventFrames.length > 0 && (
                  <div className="relative h-3 mb-0.5">
                    {eventFrames.map((e) => (
                      <button
                        key={e.index}
                        type="button"
                        title={`${e.date} · sharp ${e.severity} swing`}
                        aria-label={`Jump to ${e.date}, a sharp ${e.severity} sentiment swing`}
                        className={`absolute top-0 w-1.5 h-1.5 rounded-full -translate-x-1/2 cursor-pointer p-0 border-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-slate-400 ${e.severity === 'negative' ? 'bg-red-500' : 'bg-emerald-500'}`}
                        style={{ left: `${(e.index / Math.max(1, frames.length - 1)) * 100}%` }}
                        onClick={() => { setPlaying(false); setFrameIdx(e.index); }}
                      />
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPlaying((p) => !p)}
                    aria-label={playing ? 'Pause playback' : 'Play playback'}
                    aria-pressed={playing}
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-yellow-600 text-white hover:bg-yellow-700 flex-shrink-0 transition-colors"
                  >
                    {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, frames.length - 1)}
                    value={frameIdx}
                    onChange={(e) => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
                    className="flex-1 accent-yellow-600"
                  />
                  <span className="text-[10px] text-slate-400 w-16 text-right flex-shrink-0 tabular-nums">{frameIdx + 1}/{frames.length}</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
            <h3 className="text-sm font-bold text-slate-800 mb-2">Top Platforms Over Time</h3>
            {!platformSeries.length ? (
              <div className="text-xs text-slate-400 py-10 text-center">No platform data for this window</div>
            ) : (
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer>
                  <AreaChart data={platformSeries} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {platformKeys.map((k) => {
                      const meta = PLATFORM_META[k] || PLATFORM_META.unknown;
                      return <Area key={k} type="monotone" dataKey={k} stackId="1" name={meta.label} stroke={meta.color} fill={meta.color} fillOpacity={0.5} />;
                    })}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Insights summary */}
        <InsightsSummaryPanel insights={insights} loading={loading} title="Insights Summary" />
      </div>
    </div>
  );
};

export default HistoricalPlaybackTab;
