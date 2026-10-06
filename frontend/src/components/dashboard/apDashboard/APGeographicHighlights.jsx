import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ThumbsUp, ThumbsDown, BarChart2, Zap } from 'lucide-react';

const APGeographicHighlights = ({ data, loading, filters }) => {
  const navigate = useNavigate();
  const highlights = data || {};
  const {
    highestNegativeDistrict,
    highestPositiveDistrict,
    mostDiscussedDistrict,
    highestEngagementDistrict
  } = highlights;

  const cards = [
    {
      title: 'Highest Negative District',
      data: highestNegativeDistrict,
      colorClass: 'text-red-600 bg-red-50 border-red-100',
      icon: ThumbsDown,
      desc: (d) => `${d.pct}% of mentions are negative (${d.value} mentions)`,
      sentimentOverride: 'negative'
    },
    {
      title: 'Highest Positive District',
      data: highestPositiveDistrict,
      colorClass: 'text-emerald-600 bg-emerald-50 border-emerald-100',
      icon: ThumbsUp,
      desc: (d) => `${d.pct}% of mentions are positive (${d.value} mentions)`,
      sentimentOverride: 'positive'
    },
    {
      title: 'Most Discussed District',
      data: mostDiscussedDistrict,
      colorClass: 'text-yellow-600 bg-yellow-50 border-yellow-100',
      icon: BarChart2,
      desc: (d) => `Accumulated a total of ${d.total.toLocaleString()} mentions`
    },
    {
      title: 'Highest Engagement District',
      data: highestEngagementDistrict,
      colorClass: 'text-blue-600 bg-blue-50 border-blue-100',
      icon: Zap,
      desc: (d) => `Generated ${d.engagement.toLocaleString()} reactions & comments`
    }
  ];

  const handleCardClick = (district, sentimentOverride) => {
    const params = [];
    if (filters?.from) params.push(`from=${encodeURIComponent(filters.from)}`);
    if (filters?.to) params.push(`to=${encodeURIComponent(filters.to)}`);
    if (district) params.push(`location=${encodeURIComponent(district)}`);
    if (filters?.platform && filters.platform !== 'all') params.push(`platform=${encodeURIComponent(filters.platform)}`);
    const activeSentiment = sentimentOverride || (filters?.sentiment && filters.sentiment !== 'all' ? filters.sentiment : null);
    if (activeSentiment) params.push(`sentiment=${encodeURIComponent(activeSentiment)}`);
    navigate(`/grievances?${params.join('&')}`);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
        <div className="h-4 w-40 bg-slate-200 rounded mb-4" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-slate-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const activeHighlights = cards.filter(c => c.data);

  if (activeHighlights.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 text-center py-8 text-xs text-slate-400">
        No geographic highlights available for this period.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 h-[320px] flex flex-col">
      <h3 className="text-sm font-bold text-slate-800 mb-3 flex-shrink-0">Geographic Highlights</h3>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1 overflow-y-auto pr-0.5">
        {cards.map((card, i) => {
          if (!card.data) return null;
          const Icon = card.icon;
          return (
            <div
              key={i}
              role="button"
              tabIndex={0}
              title={`View ${card.data.name} mentions in Mentions feed`}
              onClick={() => handleCardClick(card.data.name, card.sentimentOverride)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCardClick(card.data.name, card.sentimentOverride); }}
              className={`flex items-start gap-3 p-3 rounded-xl border border-slate-100 hover:border-yellow-300 hover:shadow-sm transition-colors bg-gradient-to-br from-white to-slate-50/30 cursor-pointer`}
            >
              <div className={`p-2 rounded-lg ${card.colorClass.split(' ')[1]} ${card.colorClass.split(' ')[0]}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  {card.title}
                </div>
                <div className="text-sm font-bold text-slate-800 mt-0.5 capitalize">
                  {card.data.name}
                </div>
                <div className="text-[10px] text-slate-500 mt-1 leading-normal">
                  {card.desc(card.data)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default APGeographicHighlights;
