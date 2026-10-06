import React, { useState, useEffect } from 'react';
import { X, MessageSquare, ThumbsUp, ThumbsDown, ArrowRight, User, Minus } from 'lucide-react';
import api from '../../../lib/api';
import { getMlaByConstituency } from '../../../data/stateMLAs';

/**
 * APConstituencyPanel — Slide-in side panel containing detailed analytics for a constituency.
 */
const APConstituencyPanel = ({ constituencyName, onClose, fromDate, toDate }) => {
  const seatMla = getMlaByConstituency(constituencyName);
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState(null);

  useEffect(() => {
    if (!constituencyName) return;

    const fetchDetails = async () => {
      setLoading(true);
      try {
        const res = await api.get('/grievances/location-summary', {
          params: {
            location: constituencyName,
            from: fromDate,
            to: toDate,
            bsk_only: 'false'
          }
        });
        setDetails(res.data);
      } catch (err) {
        console.error('Failed to load constituency details:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [constituencyName, fromDate, toDate]);

  if (!constituencyName) return null;

  return (
    <div className="w-[380px] h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col z-20">
      {/* Panel Header */}
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-yellow-50/50 to-white">
        <div>
          <span className="text-[10px] font-bold text-yellow-600 uppercase tracking-widest">
            Constituency Intelligence
          </span>
          <h3 className="text-base font-bold text-slate-800 capitalize leading-tight mt-0.5">
            {constituencyName}
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-20 bg-slate-100 rounded-xl" />
            <div className="h-40 bg-slate-50 rounded-xl" />
            <div className="h-32 bg-slate-50 rounded-xl" />
          </div>
        ) : !details || details.total === 0 ? (
          <div className="h-full flex flex-col justify-center items-center gap-2 text-slate-400 text-center py-12">
            <span className="text-3xl">🗳️</span>
            <div className="text-xs font-semibold">No monitored activity found</div>
            <p className="text-[10px] max-w-[200px] leading-normal">
              There are no mentions or alerts generated for this constituency in the selected period.
            </p>
          </div>
        ) : (
          (() => {
            const total = details.total || 0;
            const positiveCount = details.positive || 0;
            const negativeCount = details.negative || 0;
            const neutralCount = Math.max(0, total - positiveCount - negativeCount);

            const positivePct = total ? Math.round((positiveCount / total) * 100) : 0;
            const negativePct = total ? Math.round((negativeCount / total) * 100) : 0;
            const neutralPct = total ? Math.max(0, 100 - positivePct - negativePct) : 0;

            return (
              <>
                {/* Quick Stats Grid */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                    <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">
                      Mentions
                    </div>
                    <div className="text-xl font-bold text-slate-800 mt-1">
                      {total}
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                    <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">
                      Engagement
                    </div>
                    <div className="text-xl font-bold text-slate-800 mt-1">
                      {details.engagement || 0}
                    </div>
                  </div>
                </div>

                {/* Sentiment Breakdown */}
                <div className="bg-white border border-slate-100 rounded-xl p-3.5 space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    Sentiment Distribution
                  </h4>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
                    <div
                      className="bg-emerald-500 h-full transition-all"
                      style={{ width: `${positivePct}%` }}
                    />
                    <div
                      className="bg-amber-400 h-full transition-all"
                      style={{ width: `${neutralPct}%` }}
                    />
                    <div
                      className="bg-red-500 h-full transition-all"
                      style={{ width: `${negativePct}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-semibold">
                    <div className="text-emerald-600 bg-emerald-50/55 rounded-lg py-1.5 border border-emerald-100/50">
                      <div>Positive</div>
                      <div className="text-sm font-bold mt-0.5">{positivePct}%</div>
                      <div className="text-[9px] font-medium opacity-70">({positiveCount})</div>
                    </div>
                    <div className="text-slate-600 bg-slate-50/55 rounded-lg py-1.5 border border-slate-200/60">
                      <div>Neutral</div>
                      <div className="text-sm font-bold mt-0.5">{neutralPct}%</div>
                      <div className="text-[9px] font-medium opacity-70">({neutralCount})</div>
                    </div>
                    <div className="text-red-500 bg-red-50/55 rounded-lg py-1.5 border border-red-100/50">
                      <div>Negative</div>
                      <div className="text-sm font-bold mt-0.5">{negativePct}%</div>
                      <div className="text-[9px] font-medium opacity-70">({negativeCount})</div>
                    </div>
                  </div>
                </div>

                {/* Concerned MLA: from the static roster (the location-summary
                    endpoint carries only counts). */}
                {seatMla && (seatMla.vacant ? (
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs font-semibold text-slate-600">
                    Seat vacant
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-yellow-100 border border-yellow-200 flex items-center justify-center flex-shrink-0">
                      <User className="h-5 w-5 text-yellow-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">
                        Incumbent MLA
                      </div>
                      <div className="text-xs font-bold text-slate-700 mt-0.5 truncate">
                        {seatMla.mla}
                      </div>
                      <div className="text-[9px] font-medium text-slate-500">
                        Party: {seatMla.party || '—'} &middot; Term: 2023-2028
                      </div>
                    </div>
                  </div>
                ))}

                {/* Top Trending Topics */}
                {details.topics && details.topics.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Top Topics Discussed
                    </h4>
                    <div className="space-y-1.5">
                      {details.topics.slice(0, 5).map((topic, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50 border border-slate-100"
                        >
                          <span className="font-medium text-slate-700 truncate max-w-[200px]">
                            {topic.name}
                          </span>
                          <span className="font-semibold text-slate-600 bg-white border px-2 py-0.5 rounded shadow-sm">
                            {topic.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* External Links */}
                <div className="pt-2">
                  {(() => {
                    const params = [`location=${encodeURIComponent(constituencyName)}`];
                    if (fromDate) params.push(`from=${encodeURIComponent(fromDate)}`);
                    if (toDate) params.push(`to=${encodeURIComponent(toDate)}`);
                    return (
                      <a
                        href={`/grievances?${params.join('&')}`}
                        className="flex items-center justify-center gap-1.5 w-full bg-yellow-600 text-white hover:bg-yellow-700 transition-colors font-semibold text-xs py-2 rounded-xl"
                      >
                        View Content Feed
                        <ArrowRight className="h-3.5 w-3.5" />
                      </a>
                    );
                  })()}
                </div>
              </>
            );
          })()
        )}
      </div>
    </div>
  );
};

export default APConstituencyPanel;
