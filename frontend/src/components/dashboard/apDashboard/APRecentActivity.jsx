import React, { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Twitter, Facebook, Instagram, Youtube, MessageSquare } from 'lucide-react';

const PLATFORM_ICONS = {
  x: Twitter,
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
  whatsapp: MessageSquare,
};

const PLATFORM_COLORS = {
  x: 'text-sky-500 bg-sky-50 border-sky-200',
  facebook: 'text-blue-600 bg-blue-50 border-blue-200',
  instagram: 'text-pink-600 bg-pink-50 border-pink-200',
  youtube: 'text-red-600 bg-red-50 border-red-200',
  whatsapp: 'text-emerald-600 bg-emerald-50 border-emerald-200',
};

const APRecentActivity = ({ data, loading, filters }) => {
  const activity = data?.activity || [];
  const scrollRef = useRef(null);
  const navigate = useNavigate();

  const handleBadgeClick = (e, overrides) => {
    e.stopPropagation();
    const params = [];
    if (filters?.from) params.push(`from=${encodeURIComponent(filters.from)}`);
    if (filters?.to) params.push(`to=${encodeURIComponent(filters.to)}`);
    const location = overrides.location ?? filters?.district;
    if (location) params.push(`location=${encodeURIComponent(location)}`);
    if (filters?.platform && filters.platform !== 'all') params.push(`platform=${encodeURIComponent(filters.platform)}`);
    if (filters?.sentiment && filters.sentiment !== 'all') params.push(`sentiment=${encodeURIComponent(filters.sentiment)}`);
    if (overrides.topic) params.push(`grievance_type=${encodeURIComponent(overrides.topic)}`);
    navigate(`/grievances?${params.join('&')}`);
  };

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || activity.length <= 2) return;

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

    // Auto scroll starts after a 2 second delay
    const timer = setTimeout(() => {
      animationFrameId = requestAnimationFrame(scroll);
    }, 2000);

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
  }, [activity]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
        <div className="h-4 w-32 bg-slate-200 rounded mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="h-6 w-6 rounded-full bg-slate-200" />
              <div className="flex-1 space-y-1">
                <div className="h-3 w-24 bg-slate-200 rounded" />
                <div className="h-2 w-full bg-slate-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 h-[320px] flex flex-col">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="text-sm font-bold text-slate-800">Recent Activity Timeline</h3>
        <span className="text-[10px] text-slate-400">newest first</span>
      </div>

      <div ref={scrollRef} className="relative pl-4 border-l border-slate-100 space-y-4 flex-1 overflow-y-auto pr-1">
        {activity.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-6">No recent activity monitored</div>
        ) : (
          activity.map((act) => {
            const Icon = PLATFORM_ICONS[act.platform] || MessageSquare;
            const style = PLATFORM_COLORS[act.platform] || 'text-slate-600 bg-slate-50 border-slate-200';
            
            // Format time distance safely
            let timeStr = '';
            try {
              timeStr = formatDistanceToNow(new Date(act.date), { addSuffix: true });
            } catch (err) {
              timeStr = 'recently';
            }

            return (
              <div key={act.id || act._id} className="relative group">
                {/* Timeline dot */}
                <div className={`absolute -left-[24px] top-0.5 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center ${style.split(' ')[0]} ${style.split(' ')[1]}`}>
                  <Icon className="h-2 w-2" />
                </div>

                <div className="bg-slate-50/50 rounded-lg border border-slate-100/80 p-2.5 hover:bg-slate-50 hover:border-yellow-200 transition-colors">
                  <div className="flex items-center justify-between gap-1.5 mb-1">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-xs font-semibold text-slate-800 truncate">
                        {act.author}
                      </span>
                      {act.handle && (
                        <span className="text-[10px] text-slate-400 truncate">
                          @{act.handle}
                        </span>
                      )}
                    </div>
                    <span className="text-[9px] text-slate-400 whitespace-nowrap">
                      {timeStr}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                    {act.text}
                  </p>

                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 text-[9px] text-slate-400 font-medium">
                    <div className="flex items-center gap-3">
                      {act.location && (
                        <button
                          type="button"
                          title={`View ${act.location} mentions in Mentions feed`}
                          onClick={(e) => handleBadgeClick(e, { location: act.location })}
                          className="bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded font-semibold uppercase hover:bg-yellow-100 transition-colors cursor-pointer"
                        >
                          {act.location}
                        </button>
                      )}
                      {act.topic && (
                        <button
                          type="button"
                          title={`View "${act.topic}" mentions in Mentions feed`}
                          onClick={(e) => handleBadgeClick(e, { topic: act.topic })}
                          className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded uppercase hover:bg-slate-200 transition-colors cursor-pointer"
                        >
                          {act.topic}
                        </button>
                      )}
                    </div>
                    {act.url && (
                      <a
                        href={act.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-yellow-600 hover:text-yellow-700 font-semibold"
                      >
                        View Post
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default APRecentActivity;
