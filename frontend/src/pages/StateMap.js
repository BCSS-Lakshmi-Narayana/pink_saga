import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PARTY_PORTRAITS, BRAND } from '../config/partyMedia';
import { Card } from '../components/ui/card';

// Revamped Dashboard Component imports
import { useDashboardData } from '../components/dashboard/apDashboard/useDashboardData';
import APDashboardHeader from '../components/dashboard/apDashboard/APDashboardHeader';
import APKpiRow from '../components/dashboard/apDashboard/APKpiRow';
import APMap from '../components/dashboard/apDashboard/APMap';
import APSentimentChart from '../components/dashboard/apDashboard/APSentimentChart';
import APMentionTrendChart from '../components/dashboard/apDashboard/APMentionTrendChart';
import APSourceDistributionChart from '../components/dashboard/apDashboard/APSourceDistributionChart';
import APTopTopics from '../components/dashboard/apDashboard/APTopTopics';
import APDistrictPerformance from '../components/dashboard/apDashboard/APDistrictPerformance';
import APAIInsights from '../components/dashboard/apDashboard/APAIInsights';
import APAlertsWidget from '../components/dashboard/apDashboard/APAlertsWidget';
import APRecentActivity from '../components/dashboard/apDashboard/APRecentActivity';
import APGeographicHighlights from '../components/dashboard/apDashboard/APGeographicHighlights';
import APConstituencyPanel from '../components/dashboard/apDashboard/APConstituencyPanel';

const LEADERSHIP_TARGET_ENTITY = {
  'portrait-primary': 'bsk',
  'portrait-party-president': 'bsk_son',
};

const StateMap = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // Custom dashboard data hook managing all APIs and states
  const {
    filters,
    updateFilters,
    data,
    loading,
    refresh
  } = useDashboardData();

  const [activeConstituency, setActiveConstituency] = useState(null);

  // Leadership quick navigation click
  const handlePortraitClick = (portraitId) => {
    const entity = LEADERSHIP_TARGET_ENTITY[portraitId] || '';
    const params = [`target_entity=${encodeURIComponent(entity)}`];
    if (filters.from) params.push(`from=${encodeURIComponent(filters.from)}`);
    if (filters.to) params.push(`to=${encodeURIComponent(filters.to)}`);
    if (filters.district) params.push(`location=${encodeURIComponent(filters.district)}`);
    if (filters.platform && filters.platform !== 'all') params.push(`platform=${encodeURIComponent(filters.platform)}`);
    if (filters.sentiment && filters.sentiment !== 'all') params.push(`sentiment=${encodeURIComponent(filters.sentiment)}`);
    navigate(`/grievances?${params.join('&')}`);
  };

  const isGlobalLoading = Object.values(loading).some(Boolean);

  const getCompareLabel = () => {
    if (!filters.from || !filters.to) return 'vs Last 7 days';
    const start = new Date(filters.from);
    const end = new Date(filters.to);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return `vs Last ${diffDays} days`;
  };

  if (embedded) {
    return (
      <div className="h-full w-full">
        <APMap
          mapData={data.mapData}
          loading={loading.mapData}
          onConstituencyClick={(name) => {
            navigate(`/mla/${encodeURIComponent(name)}`);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto p-1">
      {/* Top Banner Row: Header + leadership portraits */}
      <div className="flex flex-col xl:flex-row gap-3 items-stretch">
        <div className="flex-1 flex flex-col">
          <APDashboardHeader
            filters={filters}
            onFiltersChange={updateFilters}
            onRefresh={refresh}
            loading={isGlobalLoading}
          />
        </div>

        {/* Leadership quick navigation cards */}
        <Card className="p-3 border border-slate-200 bg-white flex items-center justify-center gap-4 xl:w-[280px] shrink-0 shadow-sm">
          <div className="flex items-center gap-4">
            {PARTY_PORTRAITS.map((portrait) => (
              <button
                key={portrait.id}
                type="button"
                title={`View grievances mentioning ${portrait.alt.split(' — ')[0]}`}
                onClick={() => handlePortraitClick(portrait.id)}
                className="flex flex-col items-center gap-1 group"
              >
                <img
                  src={portrait.src}
                  alt={portrait.alt}
                  className="w-10 h-10 lg:w-11 lg:h-11 rounded-full object-cover border-2 border-yellow-400 shadow-sm group-hover:border-yellow-500 group-hover:scale-105 transition-transform"
                />
                <span className="text-[10px] font-bold text-slate-500 group-hover:text-slate-800 tracking-wide">
                  {portrait.caption}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <APKpiRow
        data={data.kpis}
        loading={loading.kpis}
        compareLabel={getCompareLabel()}
        fromDate={filters.from}
        toDate={filters.to}
        district={filters.district}
        sentiment={filters.sentiment}
        platform={filters.platform}
      />

      {/* Primary Command Center Row: Map + Alerts (Height 580px) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Left Side: Map Widget */}
        <div className="lg:col-span-8 flex flex-col">
          <div className="flex h-[580px] rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-white relative">
            <div className="flex-1 h-full">
              <APMap
                mapData={data.mapData}
                loading={loading.mapData}
                filters={filters}
                onConstituencyClick={(name) => setActiveConstituency(name)}
              />
            </div>
            {/* Slide-in side panel on click */}
            {activeConstituency && (
              <APConstituencyPanel
                constituencyName={activeConstituency}
                fromDate={filters.from}
                toDate={filters.to}
                onClose={() => setActiveConstituency(null)}
              />
            )}
          </div>
        </div>

        {/* Right Side: Alerts Summary */}
        <div className="lg:col-span-4 flex flex-col h-[580px]">
          <APAlertsWidget data={data.alertsSummary} loading={loading.alertsSummary} />
        </div>
      </div>

      {/* Analytics Charts Row (3 fill horizontally) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <APSentimentChart data={data.sentimentTrend} loading={loading.sentimentTrend} filters={filters} />
        <APMentionTrendChart data={data.mentionTrend} loading={loading.mentionTrend} filters={filters} />
        <APSourceDistributionChart data={data.sourceDistribution} loading={loading.sourceDistribution} filters={filters} />
      </div>

      {/* AI Insights + Geographic Highlights + Recent Activity (3 fill horizontally) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        <APAIInsights data={data.aiInsights} loading={loading.aiInsights} />
        <APGeographicHighlights data={data.geoHighlights} loading={loading.geoHighlights} filters={filters} />
        <APRecentActivity data={data.recentActivity} loading={loading.recentActivity} filters={filters} />
      </div>

      {/* Topics & Leaders Leaderboard (2 fill horizontally, scrollable) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <APDistrictPerformance data={data.districtPerformance} loading={loading.districtPerformance} filters={filters} />
        <APTopTopics data={data.topTopics} loading={loading.topTopics} filters={filters} />
      </div>
    </div>
  );
};

export default StateMap;
