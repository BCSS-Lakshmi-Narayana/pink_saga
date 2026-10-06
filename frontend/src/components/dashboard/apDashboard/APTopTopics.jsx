import React from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const SENTIMENT_COLORS = {
  positive: 'bg-emerald-100 text-emerald-700',
  negative: 'bg-red-100 text-red-700',
  neutral:  'bg-slate-100 text-slate-600'
};

/**
 * APTopTopics — Ranked trending issues table
 */
const APTopTopics = ({ data, loading, filters }) => {
  const navigate = useNavigate();
  const topics = data?.topics || [];

  const handleTopicClick = (topic) => {
    const params = [];
    if (filters?.from) params.push(`from=${encodeURIComponent(filters.from)}`);
    if (filters?.to) params.push(`to=${encodeURIComponent(filters.to)}`);
    if (filters?.district) params.push(`location=${encodeURIComponent(filters.district)}`);
    if (filters?.platform && filters.platform !== 'all') params.push(`platform=${encodeURIComponent(filters.platform)}`);
    if (filters?.sentiment && filters.sentiment !== 'all') params.push(`sentiment=${encodeURIComponent(filters.sentiment)}`);
    params.push(`grievance_type=${encodeURIComponent(topic)}`);
    navigate(`/grievances?${params.join('&')}`);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
        <div className="h-4 w-36 bg-slate-200 rounded mb-4" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-100">
            <div className="h-5 w-5 bg-slate-200 rounded" />
            <div className="flex-1 h-3 bg-slate-200 rounded" />
            <div className="h-3 w-12 bg-slate-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!topics.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col items-center justify-center gap-2 text-slate-400 min-h-[180px]">
        <span className="text-2xl">💬</span>
        <span className="text-xs">No trending topics for this period</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800">Top Trending Issues</h3>
        <span className="text-[10px] text-slate-400">by mention count</span>
      </div>
      <div className="space-y-0.5 max-h-[190px] overflow-y-auto pr-1">
        {topics.map((topic, i) => (
          <div
            key={topic.topic}
            role="button"
            tabIndex={0}
            onClick={() => handleTopicClick(topic.topic)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleTopicClick(topic.topic); }}
            title={`View "${topic.topic}" mentions in Mentions feed`}
            className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors group cursor-pointer"
          >
            {/* Rank */}
            <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
              i === 0 ? 'bg-yellow-500 text-white' :
              i === 1 ? 'bg-slate-400 text-white' :
              i === 2 ? 'bg-amber-600 text-white' :
              'bg-slate-100 text-slate-500'
            }`}>
              {i + 1}
            </span>

            {/* Topic name */}
            <span className="flex-1 text-xs font-medium text-slate-800 truncate" title={topic.topic}>
              {topic.topic}
            </span>

            {/* Sentiment pill */}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize flex-shrink-0 ${SENTIMENT_COLORS[topic.dominantSentiment] || SENTIMENT_COLORS.neutral}`}>
              {topic.dominantSentiment}
            </span>

            {/* Count */}
            <span className="text-xs font-semibold text-slate-700 flex-shrink-0 w-10 text-right">
              {topic.count >= 1000 ? `${(topic.count/1000).toFixed(1)}K` : topic.count}
            </span>

            {/* Growth */}
            <div className={`flex items-center gap-0.5 flex-shrink-0 text-[10px] font-medium ${
              topic.growth > 0 ? 'text-emerald-600' : topic.growth < 0 ? 'text-red-500' : 'text-slate-400'
            }`}>
              {topic.growth > 0
                ? <TrendingUp className="h-3 w-3" />
                : topic.growth < 0
                ? <TrendingDown className="h-3 w-3" />
                : <Minus className="h-3 w-3" />
              }
              <span>{Math.abs(topic.growth)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default APTopTopics;
