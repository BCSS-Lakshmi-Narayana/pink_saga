import React, { useRef, useEffect } from 'react';
import { Sparkles, ArrowRight, ShieldAlert } from 'lucide-react';

const APAIInsights = ({ data, loading }) => {
  const insights = data?.insights || [];
  const aiProvider = data?.aiProvider || 'none';
  const scrollRef = useRef(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || insights.length <= 2) return;

    let animationFrameId;
    let scrollSpeed = 0.4; // Pixels per frame
    let position = 0;

    const scroll = () => {
      position += scrollSpeed;
      if (position >= container.scrollHeight - container.clientHeight) {
        position = 0; // Loop back to top
      }
      container.scrollTop = position;
      animationFrameId = requestAnimationFrame(scroll);
    };

    // Auto scroll starts after a 1.5 second delay
    const timer = setTimeout(() => {
      animationFrameId = requestAnimationFrame(scroll);
    }, 1500);

    const handleMouseEnter = () => cancelAnimationFrame(animationFrameId);
    const handleMouseLeave = () => {
      // Re-align position tracker to actual scroll position in case of user manual scroll
      position = container.scrollTop;
      animationFrameId = requestAnimationFrame(scroll);
    };

    container.addEventListener('mouseenter', handleMouseEnter);
    container.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(animationFrameId);
      container.removeEventListener('mouseenter', handleMouseEnter);
      container.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [insights]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
        <div className="flex justify-between items-center mb-3">
          <div className="h-4 w-32 bg-slate-200 rounded" />
          <div className="h-3 w-16 bg-slate-200 rounded" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 bg-slate-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 relative overflow-hidden bg-gradient-to-br from-white via-white to-yellow-50/10 h-[320px] flex flex-col">
      {/* Decorative shine */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-yellow-400/5 rounded-full blur-2xl" />

      <div className="flex items-center justify-between mb-3.5 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-yellow-500 fill-yellow-100" />
          <h3 className="text-sm font-bold text-slate-800">AI Intelligence Insights</h3>
        </div>
        <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest bg-slate-50 border border-slate-200/60 rounded px-1.5 py-0.5">
          {aiProvider === 'openai' ? 'GPT-4o' : aiProvider === 'gemini' ? 'Gemini Pro' : 'Real-time'}
        </span>
      </div>

      <div ref={scrollRef} className="space-y-2.5 flex-1 overflow-y-auto pr-1">
        {insights.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-6">
            Insufficient monitored content to generate meaningful insights for this period.
          </div>
        ) : (
          insights.map((insight, i) => {
            const isNegativeAlert = insight.toLowerCase().includes('negative') || insight.toLowerCase().includes('attention');
            return (
              <div
                key={i}
                className="flex gap-2.5 items-start text-xs text-slate-600 leading-relaxed bg-white/40 border border-slate-100/60 rounded-xl p-3 hover:border-yellow-200 hover:bg-white/80 transition-all duration-200 shadow-sm"
              >
                {isNegativeAlert ? (
                  <ShieldAlert className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <ArrowRight className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                )}
                <span>{insight}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default APAIInsights;
