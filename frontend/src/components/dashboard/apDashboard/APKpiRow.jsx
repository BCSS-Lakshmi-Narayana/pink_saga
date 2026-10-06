import React from 'react';
import { useNavigate } from 'react-router-dom';
import APKpiCard from './APKpiCard';
import {
  MessageSquare, ThumbsUp, ThumbsDown, Minus,
  Activity, Users, MapPin, AlertTriangle
} from 'lucide-react';

/**
 * APKpiRow — 8-card KPI summary strip with horizontal layout and custom styles
 */
const APKpiRow = ({ data, loading, compareLabel, fromDate, toDate, district, sentiment, platform }) => {
  const kpis = data?.kpis || {};
  const navigate = useNavigate();

  // Helper to build the query parameters string dynamically
  const buildQueryParams = (cardSentiment) => {
    const params = [];
    
    // Add date filters
    if (fromDate) params.push(`from=${encodeURIComponent(fromDate)}`);
    if (toDate) params.push(`to=${encodeURIComponent(toDate)}`);
    
    // Add district filter (grievances page uses location parameter)
    if (district) params.push(`location=${encodeURIComponent(district)}`);
    
    // Add platform filter
    if (platform && platform !== 'all') params.push(`platform=${encodeURIComponent(platform)}`);
    
    // Add sentiment filter (card sentiment overrides select filter)
    const activeSentiment = cardSentiment || (sentiment !== 'all' ? sentiment : null);
    if (activeSentiment) params.push(`sentiment=${encodeURIComponent(activeSentiment)}`);
    
    return params.length > 0 ? `?${params.join('&')}` : '';
  };

  const buildAlertQueryParams = () => {
    const params = [];
    if (fromDate) params.push(`from=${encodeURIComponent(fromDate)}`);
    if (toDate) params.push(`to=${encodeURIComponent(toDate)}`);
    if (district) params.push(`district=${encodeURIComponent(district)}`);
    if (platform && platform !== 'all') params.push(`platform=${encodeURIComponent(platform)}`);
    if (sentiment && sentiment !== 'all') params.push(`sentiment=${encodeURIComponent(sentiment)}`);
    return params.length > 0 ? `?${params.join('&')}` : '';
  };

  const cards = [
    {
      key: 'totalMentions',
      title: 'Total Mentions',
      icon: MessageSquare,
      iconBg: 'bg-blue-600',
      iconColor: 'text-white',
      format: 'compact',
      tooltip: 'Total monitored content mentioning Telangana constituencies/leaders in the selected period',
      onClick: () => navigate(`/grievances${buildQueryParams()}`)
    },
    {
      key: 'positiveMentions',
      title: 'Positive',
      icon: ThumbsUp,
      iconBg: 'bg-emerald-500',
      iconColor: 'text-white',
      format: 'compact',
      tooltip: 'Total positive sentiment mentions',
      onClick: () => navigate(`/grievances${buildQueryParams('positive')}`)
    },
    {
      key: 'neutralMentions',
      title: 'Neutral',
      icon: Minus,
      iconBg: 'bg-slate-400',
      iconColor: 'text-white',
      format: 'compact',
      tooltip: 'Mentions with no positive or negative substance (no risk)',
      onClick: () => navigate(`/grievances${buildQueryParams('neutral')}`)
    },
    {
      key: 'negativeMentions',
      title: 'Negative',
      icon: ThumbsDown,
      iconBg: 'bg-red-500',
      iconColor: 'text-white',
      format: 'compact',
      tooltip: 'Total negative sentiment mentions',
      onClick: () => navigate(`/grievances${buildQueryParams('negative')}`)
    },
    {
      key: 'potentialReach',
      title: 'Potential Reach',
      icon: Users,
      iconBg: 'bg-purple-600',
      iconColor: 'text-white',
      format: 'compact',
      tooltip: 'Total views/impressions across monitored content',
      onClick: () => navigate(`/grievances${buildQueryParams()}`)
    },
    {
      key: 'totalEngagement',
      title: 'Engagement',
      icon: Activity,
      iconBg: 'bg-teal-600',
      iconColor: 'text-white',
      format: 'compact',
      tooltip: 'Total engagement (likes + retweets + replies) across all mentions',
      onClick: () => navigate(`/grievances${buildQueryParams()}`)
    },
    {
      key: 'activeConstituencies',
      title: 'Active Constituencies',
      icon: MapPin,
      iconBg: 'bg-orange-500',
      iconColor: 'text-white',
      format: 'number',
      hideCompare: true,
      tooltip: 'Number of Telangana constituencies with monitored activity in the selected period',
      onClick: () => navigate('/state-map')
    },
    {
      key: 'totalAlerts',
      title: 'Alerts',
      icon: AlertTriangle,
      iconBg: 'bg-rose-600',
      iconColor: 'text-white',
      format: 'number',
      tooltip: 'Total alerts generated in the selected period',
      onClick: () => navigate(`/alerts${buildAlertQueryParams()}`)
    }
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 2xl:grid-cols-8 gap-3">
      {cards.map(card => {
        const kpi = kpis[card.key];
        const value = card.showPctAsSub ? kpi?.value : kpi?.value;
        const subValue = card.showPctAsSub ? (kpi?.pct !== undefined ? `${kpi.pct}%` : undefined) : undefined;

        return (
          <APKpiCard
            key={card.key}
            title={card.title}
            value={value}
            subValue={subValue}
            change={kpi?.change}
            up={kpi?.up}
            icon={card.icon}
            iconColor={card.iconColor}
            iconBg={card.iconBg}
            format={card.format}
            tooltip={card.tooltip}
            loading={loading}
            compareLabel={compareLabel}
            hideCompare={card.hideCompare}
            onClick={card.onClick}
          />
        );
      })}
    </div>
  );
};

export default APKpiRow;
