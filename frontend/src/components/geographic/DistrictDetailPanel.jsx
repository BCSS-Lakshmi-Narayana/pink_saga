import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, ThumbsUp, ThumbsDown, Gauge, Users, ExternalLink } from 'lucide-react';
import StateKpiTile from './StateKpiTile';
import GeoLeaderboardTable from './GeoLeaderboardTable';
import TopicAnalyticsTable from './TopicAnalyticsTable';
import PlatformDistributionBar from './PlatformDistributionBar';
import SentimentTrendChart from './SentimentTrendChart';
import RecentActivityList from './RecentActivityList';
import RiskGauge from './RiskGauge';
import RiskBadge from './RiskBadge';
import TrendIndicator from './TrendIndicator';
import { formatGeoName } from './sentimentScale';
import { useDistrictDetail, useCityLeaderboard, useTopicAnalytics } from '../../hooks/useGeoIntel';

/**
 * District drill-down content.
 */
const DistrictDetailPanel = ({ districtKey, filters, active = true }) => {
  const navigate = useNavigate();
  const [showAllCities, setShowAllCities] = useState(false);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [postsTab, setPostsTab] = useState('recent'); // 'recent' | 'top' | 'influencers'

  // `active` lets the parent tab stay mounted (preserving showAllCities/
  // showAllTopics/postsTab selections) while hidden, without this panel
  // continuing to fetch/refetch in the background.
  const { data, loading, error } = useDistrictDetail(districtKey, filters, { enabled: active });
  const { data: allCities, loading: allCitiesLoading } = useCityLeaderboard(districtKey, filters, { enabled: active && showAllCities });
  const { data: allTopics, loading: allTopicsLoading } = useTopicAnalytics(districtKey, filters, { enabled: active && showAllTopics });

  const districtName = formatGeoName(data?.district?.name || districtKey);
  const stats = data?.stats;

  const cityRows = showAllCities ? (allCities?.cities || []) : (data?.cities_preview || []);
  const cityLoading = showAllCities ? allCitiesLoading : loading;
  const topicRows = showAllTopics ? (allTopics?.topics || []) : (data?.top_topics || []);
  const topicLoading = showAllTopics ? allTopicsLoading : loading;

  const goToCityMentions = (row) => navigate(`/grievances?location=${encodeURIComponent(row.city_name || row.name)}`);
  const goToDistrictMentions = () => navigate(`/grievances?location=${encodeURIComponent(districtName)}`);

  if (!loading && error) {
    return (
      <div className="bg-white rounded-xl border border-red-200 p-10 flex flex-col items-center justify-center gap-2 text-red-500">
        <span className="text-2xl">⚠️</span>
        <span className="text-sm font-semibold">{error}</span>
        <span className="text-xs text-slate-400">This is a failed request, not an empty district — try again or check your access.</span>
      </div>
    );
  }

  if (!loading && !stats) {
    return (
      <div className="bg-white rounded-xl border border-slate-200/80 p-10 flex flex-col items-center justify-center gap-2 text-slate-400">
        <span className="text-2xl">🗺️</span>
        <span className="text-sm">No monitored mentions for {districtName} in this window yet</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* District Profile Header */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="min-w-[180px]">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-extrabold text-slate-800">{districtName}</h2>
              {stats && <RiskBadge level={stats.risk_level} />}
              {stats && <TrendIndicator direction={stats.mention_trend?.direction} changePct={stats.mention_trend?.change_pct} />}
            </div>
            <button type="button" onClick={goToDistrictMentions} className="text-[10px] text-slate-400 hover:text-yellow-700 mt-0.5 flex items-center gap-1 transition-colors">
              {stats?.total_mentions?.toLocaleString() || 0} mentions in window <ExternalLink className="h-2.5 w-2.5" />
            </button>
          </div>
          {stats && (
            <>
              <RiskGauge score={stats.avg_risk_score} size={80} />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 flex-1">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Mentions</div>
                  <div className="text-sm font-bold text-slate-800 tabular-nums">{stats.total_mentions.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Positivity</div>
                  <div className="text-sm font-bold text-emerald-600 tabular-nums">{stats.positive_pct}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Negativity</div>
                  <div className="text-sm font-bold text-red-500 tabular-nums">{stats.negative_pct}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Engagement</div>
                  <div className="text-sm font-bold text-slate-800 tabular-nums">{stats.engagement.toLocaleString()}</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StateKpiTile label="Total Mentions" numericValue={stats?.total_mentions} icon={MessageSquare} iconColor="text-blue-600" iconBg="bg-blue-50" loading={loading} onClick={goToDistrictMentions} />
        <StateKpiTile label="Positive" value={stats ? `${stats.positive_pct}%` : undefined} detail={`${stats?.positive || 0} mentions`} icon={ThumbsUp} iconColor="text-emerald-600" iconBg="bg-emerald-50" loading={loading} />
        <StateKpiTile label="Negative" value={stats ? `${stats.negative_pct}%` : undefined} detail={`${stats?.negative || 0} mentions`} icon={ThumbsDown} iconColor="text-red-600" iconBg="bg-red-50" loading={loading} />
        <StateKpiTile label="Sentiment Index" value={stats?.sentiment_index} icon={Gauge} iconColor={stats?.sentiment_index >= 0 ? 'text-emerald-600' : 'text-red-600'} iconBg={stats?.sentiment_index >= 0 ? 'bg-emerald-50' : 'bg-red-50'} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <SentimentTrendChart
            data={data?.sentiment_trend || []}
            loading={loading}
            title={`${districtName} · Sentiment Trend`}
            windowNote={filters?.from && filters?.to && filters.from === filters.to ? 'Showing trailing 7 days — your filter selects a single day' : undefined}
          />
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
          <h3 className="text-sm font-bold text-slate-800 mb-2">Platform Distribution</h3>
          <PlatformDistributionBar distribution={stats?.platform_distribution || {}} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-slate-700">City-wise Statistics</h2>
          {data && data.city_count > (data.cities_preview?.length || 0) && (
            <button type="button" onClick={() => setShowAllCities((v) => !v)} className="text-[11px] font-semibold text-yellow-700 hover:text-yellow-800">
              {showAllCities ? 'Show top cities' : `View all ${data.city_count} cities →`}
            </button>
          )}
        </div>
        <GeoLeaderboardTable rows={cityRows} loading={cityLoading} levelLabel="City" onRowClick={goToCityMentions} onQuickAction={goToCityMentions} emptyMessage="No city-level data for this district yet" />
      </div>

      <div>
        <div className="flex items-center justify-end mb-2">
          <button type="button" onClick={() => setShowAllTopics((v) => !v)} className="text-[11px] font-semibold text-yellow-700 hover:text-yellow-800">
            {showAllTopics ? 'Show top topics' : 'View all topics →'}
          </button>
        </div>
        <TopicAnalyticsTable topics={topicRows} loading={topicLoading} title="Topic Analytics" subtitle="Mention volume, sentiment split, risk and trend per issue" />
      </div>

      <div>
        <div className="flex items-center gap-1 mb-2">
          {[['recent', 'Recent Activity'], ['top', 'Top Posts'], ['influencers', 'Influencers']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPostsTab(key)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${postsTab === key ? 'bg-yellow-50 text-yellow-800' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {postsTab === 'influencers' ? (
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4">
            {!data?.top_influencers?.length ? (
              <div className="text-xs text-slate-400 py-6 text-center flex flex-col items-center gap-2"><Users className="h-5 w-5" />No influencer data for this window</div>
            ) : (
              <ul className="space-y-2">
                {data.top_influencers.map((inf) => (
                  <li key={inf.handle} className="flex items-center justify-between border-b border-slate-50 last:border-0 pb-2 last:pb-0">
                    <div>
                      <span className="text-xs font-semibold text-slate-700">{inf.display_name}</span>
                      {inf.verified && <span className="text-yellow-600 text-[10px] ml-1">✓</span>}
                      <div className="text-[10px] text-slate-400">@{inf.handle} · {inf.posts} posts</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-slate-700">{inf.followers.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400">followers</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <RecentActivityList
            items={postsTab === 'top' ? (data?.top_posts || []) : (data?.recent_activity || [])}
            loading={loading}
            onViewAll={goToDistrictMentions}
            title={postsTab === 'top' ? 'Top Posts (by engagement)' : 'Recent Activity'}
            showEngagement={postsTab === 'top'}
          />
        )}
      </div>
    </div>
  );
};

export default DistrictDetailPanel;
