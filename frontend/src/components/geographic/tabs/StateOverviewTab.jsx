import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare, ShieldAlert, Hash, ThumbsUp, ThumbsDown, Meh, TrendingUp, Activity, Info,
} from 'lucide-react';
import StateKpiTile from '../StateKpiTile';
import PoliticalMoodDonut from '../PoliticalMoodDonut';
import GeoChoropleth, { normalizeGeoName } from '../GeoChoropleth';
import RiskGauge from '../RiskGauge';
import RiskBadge from '../RiskBadge';
import SentimentTrendChart from '../SentimentTrendChart';
import RiskDistributionTreemap from '../RiskDistributionTreemap';
import TopIssuesTiles from '../TopIssuesTiles';
import EmergingTopicsList from '../EmergingTopicsList';
import InsightsSummaryPanel from '../InsightsSummaryPanel';
import RankedDistrictList from '../RankedDistrictList';
import PlatformDonut from '../PlatformDonut';
import buildStateInsights from '../buildStateInsights';
import { MOOD_LEGEND, bucketColorForIndex, DISTRICT_GEOJSON_SOURCES } from '../sentimentScale';
import { formatPctChange } from '../formatPctChange';

const SectionTitle = ({ title, subtitle, action }) => (
  <div className="flex items-end justify-between gap-3 mb-3">
    <div>
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
    {action}
  </div>
);

/**
 * State Overview — executive-hierarchy landing tab: KPI strip → political
 * mood → heatmap + district snapshot → positive/negative leaderboards →
 * top issues → platform mix → emerging topics → insights summary. Composed
 * entirely from /summary + /districts (both already RBAC-scoped and cached
 * server-side) — no new data dependencies beyond what already existed.
 */
const StateOverviewTab = ({ filters, summary, summaryLoading, leaderboard, leaderboardLoading, leaderboardError }) => {
  const navigate = useNavigate();
  const [selectedKey, setSelectedKey] = useState(null);

  const districts = useMemo(() => leaderboard?.districts || [], [leaderboard]);

  useEffect(() => {
    if (!selectedKey && districts.length) {
      const highestRisk = [...districts].sort((a, b) => b.risk_index - a.risk_index)[0];
      setSelectedKey(highestRisk?.key || districts[0].key);
    }
  }, [districts, selectedKey]);

  const dataByKey = useMemo(() => {
    const map = {};
    districts.forEach((d) => { map[normalizeGeoName(d.name)] = d; });
    return map;
  }, [districts]);

  const selectedDistrict = districts.find((d) => d.key === selectedKey) || null;
  const goToDistrict = (key) => navigate(`/geographic-intelligence/${key}`);

  // Raw daily counts for volume; for the sentiment-share tiles (headlined as
  // a %) the sparkline must plot the same unit — a daily % of that day's
  // total — or its shape can visually contradict what the headline % did
  // when overall volume swings during the window.
  const sparkline = (field) => (summary?.sentiment_trend || []).map((d) => d[field]);
  const sparklinePct = (field) => (summary?.sentiment_trend || []).map((d) => (d.total > 0 ? Math.round((d[field] / d.total) * 100) : 0));

  const stateRiskIndex = useMemo(() => {
    const totalVol = districts.reduce((s, d) => s + d.total_mentions, 0);
    if (!totalVol) return 0;
    return Math.round(districts.reduce((s, d) => s + d.risk_index * d.total_mentions, 0) / totalVol);
  }, [districts]);

  const insights = useMemo(() => buildStateInsights(summary, districts), [summary, districts]);

  return (
    <div className="space-y-5">
      {leaderboardError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-lg px-3 py-2">
          {leaderboardError} — showing whatever loaded successfully.
        </div>
      )}
      {/* Section 1 — Executive KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StateKpiTile
          label="Total Mentions"
          numericValue={summary?.total_mentions}
          icon={MessageSquare}
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
          loading={summaryLoading}
          changePct={summary?.trend?.total_mentions_change_pct}
          sparklineData={sparkline('total')}
          sparklineColor="#2563eb"
          tooltip="Total monitored mentions across all districts in the selected window."
        />
        <StateKpiTile
          label="Positive"
          value={summary ? `${summary.overall_mood.positive_pct}%` : undefined}
          icon={ThumbsUp}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
          loading={summaryLoading}
          changePct={summary?.trend?.positive_pct_change !== undefined ? parseFloat(Math.abs(summary.trend.positive_pct_change).toFixed(1)) * (summary.trend.positive_pct_change >= 0 ? 1 : -1) : undefined}
          changeIsGood
          changeUnit="pp"
          detail="vs prev. period"
          sparklineData={sparklinePct('positive')}
          sparklineColor="#10b981"
          tooltip="Share of mentions with positive sentiment. The change shows percentage-point (pp) shift vs the equivalent prior period — not a % of %."
        />
        <StateKpiTile
          label="Neutral"
          value={summary ? `${summary.overall_mood.neutral_pct}%` : undefined}
          icon={Meh}
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
          loading={summaryLoading}
          changePct={summary?.trend?.neutral_pct_change !== undefined ? parseFloat(Math.abs(summary.trend.neutral_pct_change).toFixed(1)) * (summary.trend.neutral_pct_change >= 0 ? 1 : -1) : undefined}
          changeUnit="pp"
          detail="vs prev. period"
          sparklineData={sparklinePct('neutral')}
          sparklineColor="#f59e0b"
          tooltip="Share of mentions with neutral sentiment. The change shows percentage-point (pp) shift vs the equivalent prior period."
        />
        <StateKpiTile
          label="Negative"
          value={summary ? `${summary.overall_mood.negative_pct}%` : undefined}
          icon={ThumbsDown}
          iconColor="text-red-600"
          iconBg="bg-red-50"
          loading={summaryLoading}
          changePct={summary?.trend?.negative_pct_change !== undefined ? parseFloat(Math.abs(summary.trend.negative_pct_change).toFixed(1)) * (summary.trend.negative_pct_change >= 0 ? 1 : -1) : undefined}
          changeIsGood={false}
          changeUnit="pp"
          detail="vs prev. period"
          sparklineData={sparklinePct('negative')}
          sparklineColor="#ef4444"
          tooltip="Share of mentions with negative sentiment. The change shows percentage-point (pp) shift vs the equivalent prior period."
        />
        <StateKpiTile
          label="High Risk Districts"
          value={summary ? `${summary.high_risk_district_count} / ${summary.district_count}` : undefined}
          detail={summary?.high_risk_districts?.slice(0, 2).join(', ')}
          icon={ShieldAlert}
          iconColor="text-orange-600"
          iconBg="bg-orange-50"
          status={summary?.high_risk_district_count > 0 ? 'critical' : 'good'}
          loading={summaryLoading}
          tooltip="Districts currently classified high or critical risk (avg AI risk score ≥ 50)."
        />
        <StateKpiTile
          label="Emerging Topic"
          value={summary?.emerging_topic?.topic || 'None'}
          changePct={summary?.emerging_topic?.trend_change_pct}
          compareLabel="vs last period"
          icon={Hash}
          iconColor="text-purple-600"
          iconBg="bg-purple-50"
          loading={summaryLoading}
          tooltip="The classified topic with the sharpest week-over-week growth (min. 5 mentions)."
        />
      </div>

      {/* Overall Political Mood */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
        <SectionTitle title="Overall Political Mood" subtitle="State-wide sentiment, risk and trend at a glance" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          <PoliticalMoodDonut
            positivePct={summary?.overall_mood?.positive_pct || 0}
            neutralPct={summary?.overall_mood?.neutral_pct || 0}
            negativePct={summary?.overall_mood?.negative_pct || 0}
            loading={summaryLoading}
          />

          {/* State Risk Index with tooltip */}
          <div className="flex items-center gap-3">
            <RiskGauge score={stateRiskIndex} size={84} />
            <div>
              <div className="flex items-center gap-1">
                <div className="text-[10px] font-bold uppercase text-slate-400">State Risk Index</div>
                <div className="relative group/tip">
                  <button type="button" className="text-slate-300 hover:text-slate-500 focus-visible:text-slate-500 cursor-help outline-none" aria-label="How State Risk Index is calculated">
                    <Info className="h-3 w-3" />
                  </button>
                  <div className="pointer-events-none absolute left-0 top-5 z-20 w-64 rounded-lg bg-slate-800 text-white text-[10px] leading-snug px-2.5 py-2 opacity-0 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 transition-opacity shadow-lg">
                    <strong className="block mb-1">How this is calculated</strong>
                    Volume-weighted average of each district&apos;s Risk Index — itself a composite of negative-sentiment confidence, AI risk score, week-over-week negative growth, and mention volume (not the AI risk score alone). Districts with more mentions contribute proportionally more. Score above 50 = high political risk.
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">Weighted avg across {districts.length} districts</div>
              <span className={`mt-1.5 inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                stateRiskIndex >= 75 ? 'bg-red-100 text-red-600' :
                stateRiskIndex >= 50 ? 'bg-orange-100 text-orange-600' :
                stateRiskIndex >= 25 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'
              }`}>
                {stateRiskIndex >= 75 ? 'Critical Risk' : stateRiskIndex >= 50 ? 'High Risk' : stateRiskIndex >= 25 ? 'Medium Risk' : 'Low Risk'}
              </span>
            </div>
          </div>

          {/* Mention Volume trend — styled delta chip */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Activity className="h-4 w-4 text-slate-300 flex-shrink-0" />
              <span className="font-semibold text-slate-600">Mention Volume Trend</span>
            </div>
            {summary?.trend?.total_mentions_change_pct !== undefined ? (() => {
              const raw = summary.trend.total_mentions_change_pct;
              const isUp = raw >= 0;
              // Rising/falling volume isn't inherently good or bad (unlike
              // sentiment share) — colored neutral amber here, matching
              // TrendIndicator's rationale, instead of green-up/red-down.
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                    {isUp
                      ? <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M6 9V3M3 6l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      : <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M6 3v6M3 6l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    }
                    {formatPctChange(raw)}
                  </span>
                  <span className="text-[10px] text-slate-400">vs prev. period</span>
                </div>
              );
            })() : <span className="text-xs text-slate-400">Trend data unavailable</span>}
          </div>
        </div>
      </div>

      {/* Section 3 — State Heat Map + District Snapshot */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3">
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
          <SectionTitle title="State Sentiment Heatmap" subtitle="Click any district to load its snapshot" />
          <GeoChoropleth
            sources={DISTRICT_GEOJSON_SOURCES}
            dataByKey={dataByKey}
            colorFor={bucketColorForIndex}
            legend={MOOD_LEGEND}
            selectedKey={selectedKey}
            height={520}
            onFeatureClick={(name, entry) => setSelectedKey(entry?.key || normalizeGeoName(name))}
            tooltipRenderer={(name, entry) => (
              <>
                <div className="font-bold text-slate-800">{name}</div>
                {entry ? (
                  <>
                    <div className="text-slate-500">Mentions: <span className="text-slate-700 font-semibold">{entry.total_mentions}</span></div>
                    <div className="flex gap-2 mt-0.5">
                      <span className="text-emerald-600">Pos {entry.positive_pct}%</span>
                      <span className="text-red-500">Neg {entry.negative_pct}%</span>
                    </div>
                  </>
                ) : <div className="text-slate-400">No data</div>}
              </>
            )}
          />
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-3">District Snapshot</h3>
          {!selectedDistrict ? (
            <div className="text-xs text-slate-400 py-10 text-center">Select a district on the map</div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-base font-extrabold text-slate-800">{selectedDistrict.name}</div>
                  <RiskBadge level={selectedDistrict.risk_level} />
                </div>
                <div className="text-center">
                  <RiskGauge score={selectedDistrict.avg_risk_score} size={72} />
                  <div className="text-[9px] text-slate-400 uppercase font-bold mt-0.5">AI Risk Score</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-50 rounded-lg p-2">
                  <div className="text-[9px] text-slate-400 uppercase font-bold">Mentions</div>
                  <div className="font-bold text-slate-800">{selectedDistrict.total_mentions.toLocaleString()}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2">
                  <div className="text-[9px] text-slate-400 uppercase font-bold">Engagement</div>
                  <div className="font-bold text-slate-800">{selectedDistrict.engagement.toLocaleString()}</div>
                </div>
                <div className="bg-emerald-50 rounded-lg p-2">
                  <div className="text-[9px] text-emerald-600 uppercase font-bold">Positive</div>
                  <div className="font-bold text-emerald-700">{selectedDistrict.positive_pct}%</div>
                </div>
                <div className="bg-red-50 rounded-lg p-2">
                  <div className="text-[9px] text-red-500 uppercase font-bold">Negative</div>
                  <div className="font-bold text-red-600">{selectedDistrict.negative_pct}%</div>
                </div>
              </div>
              {selectedDistrict.top_topics?.length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold mb-1.5">Top Issues</div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedDistrict.top_topics.slice(0, 5).map((t) => (
                      <span key={t.topic} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-medium">{t.topic} · {t.count}</span>
                    ))}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => goToDistrict(selectedDistrict.key)}
                className="w-full text-xs font-bold text-white bg-yellow-600 hover:bg-yellow-700 rounded-lg py-2 transition-colors"
              >
                View Full District →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Section 4 & 5 — Top Positive / Negative Districts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankedDistrictList
          title="Top Positive Districts"
          subtitle="Wilson-confidence positive score — volume-adjusted"
          icon={ThumbsUp}
          accent="positive"
          items={(leaderboard?.top_positive || []).slice(0, 5)}
          scoreField="positive_score"
          loading={leaderboardLoading}
          onSelect={(row) => setSelectedKey(row.key)}
        />
        <RankedDistrictList
          title="Top Negative Districts"
          subtitle="Weighted political risk — sentiment, AI risk, growth, volume"
          icon={ThumbsDown}
          accent="negative"
          items={(leaderboard?.top_negative || []).slice(0, 5)}
          scoreField="risk_index"
          loading={leaderboardLoading}
          onSelect={(row) => setSelectedKey(row.key)}
        />
      </div>

      {/* Top Issues by Volume */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
        <SectionTitle title="Top Issues by Volume" subtitle="State-wide topic breakdown with sentiment split and trend" />
        <TopIssuesTiles
          issues={summary?.top_issues_by_volume?.slice(0, 6) || []}
          loading={summaryLoading}
          onSelect={(issue) => navigate(`/geographic-intelligence?tab=state&topic=${encodeURIComponent(issue.topic)}`)}
        />
      </div>

      {/* Platform Distribution + Emerging Topics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
          <SectionTitle title="Platform Distribution" subtitle="Where the conversation is happening" />
          <PlatformDonut distribution={summary?.platform_distribution || []} loading={summaryLoading} />
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
          <SectionTitle
            title="Emerging Topics"
            subtitle="Sharpest week-over-week growth"
            action={<TrendingUp className="h-4 w-4 text-purple-400" />}
          />
          <EmergingTopicsList topics={summary?.emerging_topics || []} loading={summaryLoading} />
        </div>
      </div>

      {/* Trend chart + Risk Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <SentimentTrendChart data={summary?.sentiment_trend || []} loading={summaryLoading} title="Sentiment Trend Over Time" />
        <RiskDistributionTreemap districts={districts} loading={leaderboardLoading} onSelect={(p) => setSelectedKey(p.key)} />
      </div>

      {/* Section 9 — Insights Summary */}
      <InsightsSummaryPanel insights={insights} loading={summaryLoading} />
    </div>
  );
};

export default StateOverviewTab;
