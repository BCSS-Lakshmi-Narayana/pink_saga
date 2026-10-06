import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { CalendarDays, Loader2, ArrowRight } from 'lucide-react';
import { Badge } from '../ui/badge';

const MOCK_EVENTS = [
  { id: 'm1', programName: 'CM Public Meeting at Town Hall', category: 'category1', zone: 'Central', time: '10:00 AM', expectedMembers: 5000 },
  { id: 'm2', programName: 'Protest at District Collectorate', category: 'category2', zone: 'North', time: '11:30 AM', expectedMembers: 200 },
  { id: 'm3', programName: 'Religious Procession - Main St.', category: 'category3', zone: 'South', time: '04:00 PM', expectedMembers: 1500 },
  { id: 'm4', programName: 'Tech Summit Inauguration', category: 'category2', zone: 'West', time: '09:00 AM', expectedMembers: 300 },
  { id: 'm5', programName: 'Traffic Awareness Campaign', category: 'category1', zone: 'East', time: '08:00 AM', expectedMembers: 50 },
  { id: 'm6', programName: 'Political Rally - Opposition Party', category: 'category1', zone: 'Central', time: '05:00 PM', expectedMembers: 10000 },
  { id: 'm7', programName: 'Community Cleanup Drive', category: 'category2', zone: 'South', time: '07:00 AM', expectedMembers: 100 },
  { id: 'm8', programName: 'Book Fair Opening Ceremony', category: 'category2', zone: 'North', time: '10:00 AM', expectedMembers: 500 },
  { id: 'm9', programName: 'Farmers Protest March', category: 'category2', zone: 'Rural', time: '12:00 PM', expectedMembers: 3000 },
  { id: 'm10', programName: 'Night Patrol Briefing', category: 'category1', zone: 'All', time: '10:00 PM', expectedMembers: 20 },
];

const TodaysEventsWidget = ({ className = '' }) => {
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const scrollRef = useRef(null);
  const [isPaused, setIsPaused] = useState(false);

  const getTodayDate = () => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  };

  const categoryMap = {
    category1: 'GOVT',
    category2: 'OTHER',
    category3: 'RELIGIOUS',
    category4: 'ONGOING'
  };

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await api.get(`/daily-programmes?date=${getTodayDate()}`);
        const data = response.data;

        const apiEvents = [
          ...data.programmes.category1,
          ...data.programmes.category2,
          ...data.programmes.category3,
          ...data.programmes.category4,
        ];

        if (apiEvents.length > 0) {
          setEvents(apiEvents);
        } else {
          setEvents(MOCK_EVENTS);
        }
      } catch (error) {
        console.error('Error fetching events:', error);
        setEvents(MOCK_EVENTS);
      } finally {
        setIsLoading(false);
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 30000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll logic
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || isPaused) return;

    let animationFrameId;
    const scroll = () => {
      if (scrollContainer.scrollTop >= scrollContainer.scrollHeight / 2) {
        scrollContainer.scrollTop = 0; // Seamless reset to top
      } else {
        scrollContainer.scrollTop += 0.4; // Slightly slower for smoother reading
      }
      animationFrameId = requestAnimationFrame(scroll);
    };

    animationFrameId = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPaused, events]);

  const totalCount = events.length;

  return (
    <div className={`bg-gradient-to-br from-card via-card to-indigo-500/5 rounded-xl border border-border/5 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col ${className}`}>
      <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/5 to-transparent border-b border-border/5 px-2.5 py-1.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white px-1.5 py-0.5 text-[8px] font-bold uppercase rounded shadow-sm">
              LIVE
            </div>
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-purple-600 rounded animate-pulse opacity-50"></div>
          </div>
          <CalendarDays className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
          <span className="text-[11px] font-bold">Ongoing Events - Periscope</span>
          <Badge variant="secondary" className="text-[9px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20 px-1.5 py-0">{totalCount}</Badge>
        </div>
        <Link to="/announcements" className="text-[9px] text-indigo-600 dark:text-indigo-400 hover:underline font-medium flex items-center gap-0.5">
          Manage <ArrowRight className="h-2.5 w-2.5" />
        </Link>
      </div>

      <div className="flex-1 bg-card relative overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <CalendarDays className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-sm">No events for today</p>
            <Link to="/announcements" className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              + Add Events
            </Link>
          </div>
        ) : (
          <div
            className="flex-1 overflow-y-auto custom-scrollbar h-full"
            ref={scrollRef}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
          >
            <div className="divide-y divide-border/50">
              {[...events, ...events].map((event, idx) => (
                <div
                  key={`${event.id}-${idx}`}
                  className="px-2.5 py-1.5 hover:bg-indigo-500/5 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={`text-[7px] px-1 py-0 font-bold shrink-0 ${event.category === 'category1' ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' :
                      event.category === 'category3' ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' :
                        event.category === 'category4' ? 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20' :
                          'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
                      }`}>
                      {categoryMap[event.category] || 'OTHER'}
                    </Badge>
                    <p className="text-foreground text-[11px] font-semibold leading-tight group-hover:text-indigo-600 transition-colors truncate flex-1">
                      {event.programName || 'Untitled Event'}
                    </p>
                    <span className="text-[9px] text-muted-foreground shrink-0">{event.time || '--'}</span>
                    <span className="text-[9px] text-muted-foreground shrink-0">{event.zone || '--'}</span>
                    <ArrowRight className="h-2.5 w-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(99, 102, 241, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(99, 102, 241, 0.4);
        }
      `}</style>

      <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/5 to-transparent border-t border-border/50 px-2 py-1 flex items-center justify-center shrink-0">
        <Link
          to="/announcements"
          className="flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-[10px] font-medium rounded-md shadow-sm transition-all"
        >
          <CalendarDays className="h-3 w-3" />
          VIEW ALL
        </Link>
      </div>
    </div>
  );
};

export default TodaysEventsWidget;
