import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import {
  Shield, AlertTriangle, RefreshCcw, Clock, CalendarDays,
  ExternalLink, CheckCircle2, Eye, FileText, Send,
  AlertCircle, Users, ChevronRight, Search, TrendingUp, X, ChevronDown,
  Globe, Zap, Filter, Sparkles, Loader2, ArrowUp, Hash,
  MessageSquare, Heart, Share2, Play, Brain, Quote, CornerDownLeft,
  ThumbsUp, ThumbsDown, Copy, Info, Target, Plus, Trash2, Edit, Save,
  Activity, TrendingDown, BarChart3, ArrowRight, MapPin, ShieldAlert, User,
  Video, Pencil
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Link } from 'react-router-dom';
import { PlatformSelector, CategorySelector, StatusSelector, TrendingAssistant } from '../components/DashboardWidgets';

// Platform icon components
const PlatformIcons = {
  all: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>,
  twitter: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>,
  youtube: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>,
  facebook: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>,
  instagram: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.757-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z" /></svg>,
  whatsapp: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.008-.57-.008-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>
};

// Platform configurations
const PLATFORMS = [
  { id: 'all', label: 'All sources', shortLabel: 'All', icon: PlatformIcons.all, activeClass: 'bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 text-foreground' },
  { id: 'twitter', label: 'X (Twitter)', shortLabel: 'X', icon: PlatformIcons.twitter, activeClass: 'bg-gradient-to-br from-gray-900 to-black text-white' },
  { id: 'youtube', label: 'YouTube', shortLabel: 'YouTube', icon: PlatformIcons.youtube, activeClass: 'bg-gradient-to-br from-red-600 to-red-700 text-white' },
  { id: 'facebook', label: 'Facebook', shortLabel: 'Facebook', icon: PlatformIcons.facebook, activeClass: 'bg-gradient-to-br from-blue-600 to-blue-700 text-white' },
  { id: 'instagram', label: 'Instagram', shortLabel: 'Instagram', icon: PlatformIcons.instagram, activeClass: 'bg-gradient-to-br from-purple-600 via-pink-500 to-orange-500 text-white' },
  { id: 'whatsapp', label: 'WhatsApp', shortLabel: 'WhatsApp', icon: PlatformIcons.whatsapp, activeClass: 'bg-gradient-to-br from-green-600 to-green-700 text-white' }
];

const CATEGORIES = [
  { id: 'all', label: 'All topics' },
  { id: 'political', label: 'Politics' },
  { id: 'communal', label: 'Community issues' }
];

// Helper to extract hashtags
const extractHashtags = (text) => {
  if (!text) return [];
  const matches = text.match(/#[\w\u0C00-\u0C7F]+/g) || [];
  return matches.map(h => h.slice(1)).slice(0, 5);
};

// Manage Events Dialog
const ManageEventsDialog = ({
  open,
  onOpenChange,
  events,
  onEventChange,
  title = 'Manage Ongoing Events',
  bucket = 'ONGOING',
  emptyLabel = 'No ongoing events'
}) => {
  const [newEvent, setNewEvent] = useState({ title: '', type: 'OTHER' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!newEvent.title.trim()) {
      toast.error('Title is required');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post('/ongoing-events', { ...newEvent, bucket });
      toast.success('Event added');
      setNewEvent({ title: '', type: 'OTHER' });
      onEventChange();
    } catch (error) {
      toast.error('Failed to add event');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/ongoing-events/${id}`);
      toast.success('Event deleted');
      onEventChange();
    } catch (error) {
      toast.error('Failed to delete event');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 bg-gradient-to-br from-primary/5 to-primary/10 rounded-lg space-y-3 border border-primary/20">
            <h4 className="text-xs font-semibold uppercase text-primary">Add New Event</h4>
            <div className="flex gap-2">
              <Input
                placeholder="Event Title..."
                value={newEvent.title}
                onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                className="h-8 text-sm flex-1"
              />
              <Button size="sm" onClick={handleCreate} disabled={isSubmitting} className="h-8 text-xs">
                {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                Add
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">Current Items ({events.length})</h4>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{emptyLabel}</p>
          ) : (
            events.map((event) => (
              <div key={event.id} className="flex items-center justify-between p-2 rounded border border-border bg-card hover:bg-muted/50 transition-colors">
                <div className="flex flex-col min-w-0 flex-1 mr-2">
                  <span className="text-sm truncate font-medium" title={event.title}>{event.title}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(event.id || event._id)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Managed Ribbon Widget
const ManagedRibbonWidget = ({
  title,
  bucket,
  icon: Icon,
  headerClass,
  iconWrapClass,
  iconClass,
  badgeClass,
  manageClass,
  hoverClass,
  emptyLabel,
  heightClass = 'h-[150px]',
  linkTo = null
}) => {
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isManageOpen, setIsManageOpen] = useState(false);

  const fetchEvents = async () => {
    try {
      const response = await api.get('/ongoing-events', {
        params: { bucket }
      });
      setEvents(response.data);
    } catch (error) {
      console.error('Error fetching ribbon items:', error);
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [bucket]);

  return (
    <>
      <div className={`bg-gradient-to-br from-card via-card to-primary/5 rounded-xl border border-border/50 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col ${heightClass}`}>
        <div className={`${headerClass} border-b border-border/50 p-2.5 flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <div className={`p-1 rounded-lg ${iconWrapClass}`}>
              <Icon className={`h-4 w-4 ${iconClass}`} />
            </div>
            <span className="text-xs font-bold">{title}</span>
            <Badge variant="secondary" className={`text-[10px] h-4 px-1.5 ${badgeClass}`}>{events.length}</Badge>
          </div>
          {linkTo ? (
            <Link
              to={linkTo}
              className={`text-[10px] transition-colors font-medium ${manageClass} flex items-center gap-1 hover:underline`}
            >
              Manage <ArrowRight className="h-3 w-3" />
            </Link>
          ) : (
            <button
              onClick={() => setIsManageOpen(true)}
              className={`text-[10px] transition-colors font-medium ${manageClass}`}
            >
              Manage
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-0">
          {isLoading ? (
            <div className="flex justify-center items-center h-full">
              <Loader2 className={`h-4 w-4 animate-spin ${iconClass}`} />
            </div>
          ) : events.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
              {emptyLabel}
            </div>
          ) : (
            events.map((event) => (
              <div key={event.id} className={`border-b border-border/50 last:border-0 p-3 transition-colors ${hoverClass}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${event.type === 'POLITICAL' ? 'bg-rose-500' :
                    event.type === 'GOVT' ? 'bg-blue-500' :
                      event.type === 'TECH' ? 'bg-emerald-500' : 'bg-slate-500'
                    }`}></span>
                  <p className="text-xs font-medium text-foreground line-clamp-2 leading-tight">
                    {event.title}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <ManageEventsDialog
        open={isManageOpen}
        onOpenChange={setIsManageOpen}
        events={events}
        onEventChange={fetchEvents}
        title={`Manage ${title}`}
        bucket={bucket}
        emptyLabel={emptyLabel}
      />
    </>
  );
};

// Today's Events Widget
const TodaysEventsWidget = () => {
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [categoryLabels, setCategoryLabels] = useState({});
  const [hoveredEvent, setHoveredEvent] = useState(null);
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 });

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

  const categoryColors = {
    category1: { badge: 'bg-blue-500/10 text-blue-600 border-blue-500/20', dot: 'bg-blue-500', header: 'bg-blue-600' },
    category2: { badge: 'bg-slate-500/10 text-slate-600 border-slate-500/20', dot: 'bg-slate-500', header: 'bg-slate-600' },
    category3: { badge: 'bg-purple-500/10 text-purple-600 border-purple-500/20', dot: 'bg-purple-500', header: 'bg-purple-600' },
    category4: { badge: 'bg-pink-500/10 text-pink-600 border-pink-500/20', dot: 'bg-pink-500', header: 'bg-pink-600' },
  };

  const permissionStyle = (p) => {
    if (!p) return 'bg-muted text-muted-foreground border-border';
    if (p === 'Permitted') return 'bg-green-500/10 text-green-700 border-green-400/40';
    if (p === 'Applied for Permission') return 'bg-yellow-500/10 text-yellow-700 border-yellow-400/40';
    if (p === 'Rejected') return 'bg-red-500/10 text-red-700 border-red-400/40';
    return 'bg-slate-500/10 text-slate-600 border-slate-400/30';
  };

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await api.get(`/daily-programmes?date=${getTodayDate()}`);
        const data = response.data;

        const allEvents = [
          ...data.programmes.category1,
          ...data.programmes.category2,
          ...data.programmes.category3,
          ...data.programmes.category4,
        ];

        setEvents(allEvents);
        setCategoryLabels(data.categoryLabels || {});
      } catch (error) {
        console.error('Error fetching events:', error);
        setEvents([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 30000);
    return () => clearInterval(interval);
  }, []);

  const totalCount = events.length;

  // Compute smart popup position so it doesn't go off-screen
  const getPopupStyle = () => {
    const W = 280;
    const left = popupPos.x + 16 + W > window.innerWidth ? popupPos.x - W - 8 : popupPos.x + 16;
    const top = Math.min(popupPos.y - 8, window.innerHeight - 340);
    return { position: 'fixed', left, top: Math.max(8, top), width: W, zIndex: 9999 };
  };

  return (
    <>
      {/* Hover detail popup — fixed so it escapes overflow:hidden */}
      {hoveredEvent && (
        <div
          style={getPopupStyle()}
          className="bg-background border border-border rounded-xl shadow-2xl overflow-hidden pointer-events-none"
        >
          {/* Colour-coded header */}
          <div className={`${categoryColors[hoveredEvent.category]?.header || 'bg-indigo-600'} text-white px-3 py-2 flex items-center gap-2`}>
            <CalendarDays className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="text-[11px] font-bold uppercase tracking-wide">
              {categoryMap[hoveredEvent.category] || 'EVENT'} &mdash; #{hoveredEvent.slNo}
            </span>
          </div>

          <div className="p-3 space-y-2.5">
            {/* Name */}
            <p className="text-sm font-semibold leading-snug">
              {hoveredEvent.programName || 'Untitled Event'}
            </p>

            {/* Permission badge */}
            {hoveredEvent.permission && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 ${permissionStyle(hoveredEvent.permission)}`}>
                <ShieldAlert className="h-2.5 w-2.5" />
                {hoveredEvent.permission}
              </span>
            )}

            {/* Grid of key fields */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              {hoveredEvent.zone && (
                <div className="col-span-2 flex items-start gap-1">
                  <MapPin className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span className="text-muted-foreground"><span className="font-medium text-foreground">Zone:</span> {hoveredEvent.zone}</span>
                </div>
              )}
              {hoveredEvent.time && (
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <span>{hoveredEvent.time}</span>
                </div>
              )}
              {hoveredEvent.expectedMembers > 0 && (
                <div className="flex items-center gap-1">
                  <Users className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <span>{hoveredEvent.expectedMembers.toLocaleString()} expected</span>
                </div>
              )}
              {hoveredEvent.location && (
                <div className="col-span-2 flex items-start gap-1">
                  <Eye className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span className="text-muted-foreground"><span className="font-medium text-foreground">Location:</span> {hoveredEvent.location}</span>
                </div>
              )}
              {hoveredEvent.organizer && (
                <div className="col-span-2 flex items-start gap-1">
                  <User className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span className="text-muted-foreground"><span className="font-medium text-foreground">Organizer:</span> {hoveredEvent.organizer}</span>
                </div>
              )}
            </div>

            {/* Gist */}
            {hoveredEvent.gist && (
              <div className="border-t border-border/50 pt-2">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Gist</p>
                <p className="text-[11px] leading-relaxed line-clamp-3">{hoveredEvent.gist}</p>
              </div>
            )}

            {/* Comments */}
            {hoveredEvent.comments && hoveredEvent.comments !== 'Required L&O and Traffic BB' && (
              <div className="border-t border-border/50 pt-2">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">Notes</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{hoveredEvent.comments}</p>
              </div>
            )}

            <p className="text-[9px] text-muted-foreground/60 border-t border-border/30 pt-1.5 flex items-center gap-1">
              <ExternalLink className="h-2.5 w-2.5" /> Click to open in Periscope
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 bg-gradient-to-br from-card via-card to-indigo-500/5 rounded-xl border border-border/5 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col h-[520px]">
        <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/5 to-transparent border-b border-border/5 p-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white px-2 py-0.5 text-[10px] font-bold uppercase rounded shadow-sm">
                LIVE
              </div>
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-purple-600 rounded animate-pulse opacity-50"></div>
            </div>
            <div className="p-1 bg-indigo-500/10 rounded-lg">
              <CalendarDays className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <span className="text-xs font-bold">Periscope</span>
            <Badge variant="secondary" className="text-[10px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20">{totalCount}</Badge>
          </div>
          <Link to="/announcements" className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline font-medium flex items-center gap-1">
            Manage <ArrowRight className="h-3 w-3" />
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
            <div className="absolute inset-0 flex flex-col">
              <div className="flex-1 overflow-hidden">
                <div className="animate-marquee-vertical space-y-0">
                  {events.map((event) => (
                    <Link
                      to="/announcements"
                      key={event.id}
                      className="block border-b border-border/50 p-3 hover:bg-indigo-500/10 transition-colors cursor-pointer group"
                      onMouseEnter={(e) => {
                        setHoveredEvent(event);
                        setPopupPos({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseMove={(e) => setPopupPos({ x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHoveredEvent(null)}
                    >
                      <div className="flex items-start gap-2">
                        <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${categoryColors[event.category]?.dot || 'bg-indigo-500'}`} />
                        <Badge variant="outline" className={`text-[8px] font-bold flex-shrink-0 ${categoryColors[event.category]?.badge || 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20'}`}>
                          {categoryMap[event.category] || 'OTHER'}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="text-foreground text-xs font-medium leading-tight truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {event.programName || 'Untitled Event'}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                            {event.zone && <span className="truncate max-w-[80px]">{event.zone}</span>}
                            {event.zone && event.time && <span className="text-indigo-500">•</span>}
                            {event.time && <span className="text-foreground font-medium">{event.time}</span>}
                            {event.expectedMembers > 0 && (
                              <>
                                <span className="text-indigo-500">•</span>
                                <span>{event.expectedMembers.toLocaleString()}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/5 to-transparent border-t border-border/50 p-2 flex items-center justify-center">
          <Link
            to="/announcements"
            className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-xs font-medium rounded-lg shadow-sm transition-all"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            VIEW ALL EVENTS
          </Link>
        </div>
      </div>
    </>
  );
};

// Glance Chat Component
const GlanceChat = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState({});
  const [timeRange, setTimeRange] = useState('24h');
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [customDateRange, setCustomDateRange] = useState({ start: '', end: '' });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [searchHistory, setSearchHistory] = useState(() => {
    const saved = localStorage.getItem('glance_history');
    return saved ? JSON.parse(saved).slice(0, 10) : [];
  });
  const scrollRef = useRef(null);

  const saveToHistory = (query) => {
    const newHistory = [query, ...searchHistory.filter(h => h !== query)].slice(0, 10);
    setSearchHistory(newHistory);
    localStorage.setItem('glance_history', JSON.stringify(newHistory));
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSearching]);

  const handleSearch = async (e, customQuery = null) => {
    e?.preventDefault();
    const query = customQuery || input;
    if (!query.trim()) return;

    saveToHistory(query.trim());

    const userMsg = { role: 'user', content: query, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsSearching(true);

    try {
      const params = {
        query,
        timeRange: timeRange,
        platforms: selectedPlatform
      };

      if (timeRange === 'custom' && customDateRange.start && customDateRange.end) {
        params.startDate = customDateRange.start;
        params.endDate = customDateRange.end;
      }

      const response = await api.get('/search/glance', { params });

      const { aiAnalysis, results, platformBreakdown, totalResults, searchDuration, topLinks } = response.data;

      const sources = [];

      // Prefer backend-provided topLinks (already deduped + ranked).
      if (Array.isArray(topLinks) && topLinks.length > 0) {
        topLinks.slice(0, 4).forEach((l) => {
          sources.push({
            title: l.title || l.url,
            domain: l.source || 'Link',
            url: l.url || '#',
            image: l.image || null,
            snippet: l.snippet || '',
            count: l.count || 1,
            platform: 'link'
          });
        });
      }
      const byPlatform = {};
      if (results && results.length > 0) {
        results.forEach(item => {
          const pKey = item.platformKey || 'other';
          if (!byPlatform[pKey]) byPlatform[pKey] = [];
          byPlatform[pKey].push(item);
        });
      }

      ['x', 'youtube', 'instagram', 'facebook'].forEach(pKey => {
        if (byPlatform[pKey] && byPlatform[pKey].length > 0 && sources.length < 4) {
          const item = byPlatform[pKey][0];
          sources.push({
            title: item.title || item.text?.slice(0, 50) + '...',
            domain: pKey === 'x' ? '𝕏' : pKey === 'youtube' ? '▶️ YT' : pKey === 'instagram' ? 'Instagram' : pKey === 'facebook' ? 'Facebook' : item.platform,
            url: item.link || item.url || '#',
            platform: pKey
          });
        }
      });


      const aiMsg = {
        role: 'assistant',
        content: aiAnalysis || 'Unable to generate analysis.',
        timestamp: new Date(),
        sources,
        topLinks: Array.isArray(topLinks) ? topLinks : [],
        stats: {
          total: totalResults || 0,
          duration: searchDuration || '0s',
          platforms: platformBreakdown || {}
        }
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error('Glance Search Error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Connection to the intelligence network failed. Please try again.",
        timestamp: new Date(),
        isError: true
      }]);
    } finally {
      setIsSearching(false);
    }
  };

  const renderMarkdown = (text) => {
    if (!text) return null;

    return text.split('\n').map((line, i) => {
      if (line.startsWith('### ')) {
        return <h3 key={i} className="text-sm font-semibold text-foreground mt-4 mb-2 flex items-center gap-2">
          <span className="w-1 h-4 bg-gradient-to-b from-violet-500 to-indigo-500 rounded-full"></span>
          {line.slice(4)}
        </h3>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={i} className="text-base font-bold text-foreground mt-5 mb-3 pb-2 border-b border-violet-500/20">{line.slice(3)}</h2>;
      }
      if (line.startsWith('# ')) {
        return <h1 key={i} className="text-lg font-bold text-foreground mt-4 mb-2">{line.slice(2)}</h1>;
      }

      if (line.startsWith('- ') || line.startsWith('* ')) {
        const content = line.slice(2);
        return (
          <div key={i} className="flex items-start gap-2 my-1.5 pl-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 mt-2 flex-shrink-0"></span>
            <span className="text-foreground/85 leading-relaxed">{renderInlineStyles(content)}</span>
          </div>
        );
      }

      if (!line.trim()) return <div key={i} className="h-2"></div>;

      return <p key={i} className="text-foreground/80 leading-relaxed my-1.5">{renderInlineStyles(line)}</p>;
    });
  };

  const renderInlineStyles = (text) => {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`|\[.*?\]\(.*?\))/g);
    return parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={j} className="px-1.5 py-0.5 bg-violet-500/10 rounded text-xs font-mono text-violet-600 dark:text-violet-400">{part.slice(1, -1)}</code>;
      }
      const linkMatch = part.match(/\[(.*?)\]\((.*?)\)/);
      if (linkMatch) {
        return <a key={j} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-violet-600 dark:text-violet-400 hover:underline">{linkMatch[1]}</a>;
      }
      return <span key={j}>{part}</span>;
    });
  };

  return (
    <div className="flex justify-start gap-4">
      <div className="w-[55%] flex bg-gradient-to-br from-card via-card to-violet-500/5 rounded-xl border border-border/50 shadow-md hover:shadow-lg transition-all overflow-hidden" style={{ height: '420px' }}>
        {/* History Sidebar */}
        <div className="w-48 bg-gradient-to-b from-muted/50 to-muted/30 border-r border-border/50 flex flex-col">
          <div className="p-3 border-b border-border/50 bg-gradient-to-r from-violet-500/10 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-sm">
                <Target className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold tracking-tight bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">GLANCE</span>
                <span className="text-[9px] text-muted-foreground">Intelligence Hub</span>
              </div>
            </div>
          </div>

          <div className="p-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs gap-1.5 justify-start hover:bg-violet-500/10 border-violet-500/20"
              onClick={() => setMessages([])}
            >
              <MessageSquare className="h-3 w-3" />
              New chat
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 space-y-1">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground px-2 py-1">Recent</p>
            {searchHistory.slice(0, 8).map((h, i) => (
              <button
                key={i}
                onClick={(e) => handleSearch(e, h)}
                className="w-full text-left px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-violet-500/10 rounded truncate transition-colors"
              >
                {h}
              </button>
            ))}
            {searchHistory.length === 0 && (
              <p className="text-[10px] text-muted-foreground/50 px-2 py-2">No history yet</p>
            )}
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mb-4 shadow-lg">
                  <Sparkles className="h-6 w-6 text-white" />
                </div>
                <h3 className="text-sm font-medium mb-1">How can I help you today?</h3>
                <p className="text-xs text-muted-foreground mb-4 text-center max-w-xs">
                  Ask me anything about social media trends, news, or real-time insights
                </p>

                <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                  {[
                    { q: "What's trending today?", icon: "🔥", color: "from-orange-500/10 to-red-500/10 border-orange-500/20" },
                    { q: "Latest political news", icon: "🗳️", color: "from-blue-500/10 to-indigo-500/10 border-blue-500/20" },
                    { q: "Tech updates", icon: "💻", color: "from-green-500/10 to-emerald-500/10 border-green-500/20" },
                    { q: "Viral posts", icon: "📈", color: "from-purple-500/10 to-pink-500/10 border-purple-500/20" }
                  ].map(({ q, icon, color }, i) => (
                    <button
                      key={i}
                      onClick={(e) => handleSearch(e, q)}
                      className={`flex items-center gap-2 p-2.5 text-[11px] text-left bg-gradient-to-br ${color} hover:scale-105 border rounded-lg transition-all shadow-sm hover:shadow-md`}
                    >
                      <span className="text-sm">{icon}</span>
                      <span className="truncate font-medium">{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`px-4 py-3 ${msg.role === 'assistant' ? 'bg-gradient-to-r from-violet-500/5 to-transparent' : ''}`}
                  >
                    <div className="flex gap-3 max-w-2xl mx-auto">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'assistant'
                        ? 'bg-gradient-to-br from-violet-600 to-indigo-600'
                        : 'bg-gradient-to-br from-slate-600 to-slate-700'
                        }`}>
                        {msg.role === 'assistant'
                          ? <Target className="h-3 w-3 text-white" />
                          : <Users className="h-3 w-3 text-white" />
                        }
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium text-muted-foreground mb-0.5">
                          {msg.role === 'assistant' ? 'GLANCE' : 'You'}
                        </p>
                        <div className="text-xs text-foreground/90">
                          {msg.role === 'user' ? (
                            <p>{msg.content}</p>
                          ) : msg.isError ? (
                            <p className="text-destructive">{msg.content}</p>
                          ) : (
                            <div className="space-y-1.5">{renderMarkdown(msg.content)}</div>
                          )}
                        </div>

                        {msg.role === 'assistant' && Array.isArray(msg.topLinks) && msg.topLinks.length > 0 && (
                          <div className="mt-3">
                            <div className="flex gap-2 overflow-x-auto pb-1">
                              {msg.topLinks.slice(0, 4).map((l, i) => (
                                <a
                                  key={i}
                                  href={l.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="min-w-[170px] max-w-[170px] rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors overflow-hidden shadow-sm"
                                >
                                  <div className="h-20 w-full bg-muted/40">
                                    {l.image ? (
                                      <img src={l.image} alt="" className="h-20 w-full object-cover" />
                                    ) : (
                                      <div className="h-20 w-full flex items-center justify-center text-[10px] text-muted-foreground">Link</div>
                                    )}
                                  </div>
                                  <div className="p-2">
                                    <div className="text-[10px] text-muted-foreground truncate">{l.source || 'Source'}</div>
                                    <div className="text-[11px] font-medium leading-snug line-clamp-2">{l.title || l.url}</div>
                                    {l.count ? (
                                      <div className="mt-1 text-[9px] text-muted-foreground">Shared {l.count}x</div>
                                    ) : null}
                                  </div>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {msg.sources.slice(0, 3).map((source, i) => (
                              <a
                                key={i}
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 rounded transition-colors"
                              >
                                <ExternalLink className="h-2 w-2" />
                                <span className="truncate max-w-[60px]">{source.domain}</span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {isSearching && (
                  <div className="px-4 py-3 bg-gradient-to-r from-violet-500/5 to-transparent">
                    <div className="flex gap-3 max-w-2xl mx-auto">
                      <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center animate-pulse shadow-sm">
                        <Sparkles className="h-3 w-3 text-white" />
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Input Bar */}
          <div className="p-3 border-t border-border/50 bg-gradient-to-r from-violet-500/5 to-transparent">
            <form onSubmit={handleSearch} className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-2">
                  {[
                    { id: '24h', label: '24 Hours' },
                    { id: '7d', label: '1 Week' },
                    { id: '30d', label: '1 Month' },
                    { id: 'custom', label: 'Custom' }
                  ].map((range) => (
                    <button
                      key={range.id}
                      type="button"
                      onClick={() => {
                        setTimeRange(range.id);
                        if (range.id === 'custom') {
                          setShowDatePicker(true);
                        } else {
                          setShowDatePicker(false);
                        }
                      }}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${timeRange === range.id
                        ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white border-transparent shadow-sm font-medium'
                        : 'bg-muted/50 text-muted-foreground border-border hover:bg-violet-500/10 hover:border-violet-500/20'
                        }`}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>

                <select
                  value={selectedPlatform}
                  onChange={(e) => setSelectedPlatform(e.target.value)}
                  className="bg-muted/50 text-[10px] border border-border rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500/50 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <option value="all">All Platforms</option>
                  <option value="twitter">X (Twitter)</option>
                  <option value="youtube">YouTube</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                </select>
              </div>

              {showDatePicker && timeRange === 'custom' && (
                <div className="flex items-center gap-2 mb-2 px-1 py-2 bg-violet-500/10 rounded border border-violet-500/20">
                  <div className="flex items-center gap-1">
                    <label className="text-[9px] text-muted-foreground">From:</label>
                    <input
                      type="date"
                      value={customDateRange.start}
                      onChange={(e) => setCustomDateRange({ ...customDateRange, start: e.target.value })}
                      className="bg-background text-[10px] border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-[9px] text-muted-foreground">To:</label>
                    <input
                      type="date"
                      value={customDateRange.end}
                      onChange={(e) => setCustomDateRange({ ...customDateRange, end: e.target.value })}
                      className="bg-background text-[10px] border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                    />
                  </div>
                </div>
              )}

              <div className="relative flex items-center">
                <Target className="absolute left-3 h-4 w-4 text-violet-500" />
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={isSearching}
                  placeholder={`Ask GLANCE anything...`}
                  className="w-full h-10 pl-10 pr-12 bg-muted/50 border border-border hover:border-violet-500/30 focus:border-violet-500/50 rounded-xl text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30 transition-all"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!input.trim() || isSearching}
                  className="absolute right-2 h-7 w-7 p-0 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-sm"
                >
                  {isSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-[9px] text-center text-muted-foreground/50 mt-1.5">
                GLANCE may produce inaccurate results. Verify critical information.
              </p>
            </form>
          </div>
        </div>
      </div>

      {/* Right Column */}
      <div className="flex-1 flex flex-col gap-5" style={{ minHeight: '420px' }}>
        <ManagedRibbonWidget
          title="Dail 100 Feed"
          bucket="DAIL_100_FEED"
          icon={FileText}
          headerClass="bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-transparent"
          iconWrapClass="bg-blue-500/10"
          iconClass="text-blue-600 dark:text-blue-400"
          badgeClass="bg-blue-500/10 text-blue-600 border-blue-500/20"
          manageClass="text-blue-600 hover:text-blue-600/80"
          hoverClass="hover:bg-blue-500/5"
          emptyLabel="No daily feed items"
          heightClass="h-[90px]"
          linkTo="/dial-100-incident-reporting"
        />
        <ManagedRibbonWidget
          title="SB Inputs"
          bucket="SB_INPUTS"
          icon={MessageSquare}
          headerClass="bg-gradient-to-r from-purple-500/10 via-purple-500/5 to-transparent"
          iconWrapClass="bg-purple-500/10"
          iconClass="text-purple-600 dark:text-purple-400"
          badgeClass="bg-purple-500/10 text-purple-600 border-purple-500/20"
          manageClass="text-purple-600 hover:text-purple-600/80"
          hoverClass="hover:bg-purple-500/5"
          emptyLabel="No SB inputs"
          heightClass="h-[90px]"
        />
        <ManagedRibbonWidget
          title="Ongoing Events"
          bucket="ONGOING"
          icon={Clock}
          headerClass="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent"
          iconWrapClass="bg-primary/10"
          iconClass="text-primary"
          badgeClass="bg-primary/10 text-primary border-primary/20"
          manageClass="text-primary hover:text-primary/80"
          hoverClass="hover:bg-primary/5"
          emptyLabel="No ongoing events"
          heightClass="h-[120px]"
        />
        <TodaysEventsWidget />
      </div>
    </div>
  );
};

// ─── Drone View Live Monitoring Strip ───────────────────────────────────────
const DroneViewStrip = () => {
  const [title, setTitle] = useState('Drone View');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('Drone View');
  const [linkInput, setLinkInput] = useState('');
  const [savedLink, setSavedLink] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');

  const extractYouTubeId = (url) => {
    if (!url) return null;
    const patterns = [
      /[?&]v=([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /\/(?:live|embed)\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  };

  const handleOpenModal = () => {
    const id = extractYouTubeId(linkInput.trim());
    if (!id) {
      setError('Please enter a valid YouTube live stream URL');
      return;
    }
    setError('');
    setSavedLink(linkInput.trim());
    setShowModal(true);
  };

  const embedUrl = () => {
    const id = extractYouTubeId(savedLink);
    return id
      ? `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`
      : '';
  };

  const handleTitleSave = () => {
    setTitle(titleInput.trim() || 'Drone View');
    setIsEditingTitle(false);
  };

  return (
    <>
      {/* Strip */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-xl border border-sky-500/30 bg-gradient-to-r from-sky-500/10 via-sky-500/5 to-transparent shadow-sm">
        {/* Pulsing dot */}
        <div className="relative flex-shrink-0">
          <div className="h-2 w-2 rounded-full bg-sky-500" />
          <div className="absolute inset-0 h-2 w-2 rounded-full bg-sky-500 animate-ping opacity-75" />
        </div>

        <Video className="h-4 w-4 text-sky-500 flex-shrink-0" />

        {/* Editable title */}
        {isEditingTitle ? (
          <input
            value={titleInput}
            autoFocus
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleSave();
              if (e.key === 'Escape') { setTitleInput(title); setIsEditingTitle(false); }
            }}
            className="text-sm font-semibold bg-transparent border-b border-sky-500/60 focus:outline-none focus:border-sky-500 w-32 text-sky-700 dark:text-sky-300"
          />
        ) : (
          <button
            onClick={() => { setTitleInput(title); setIsEditingTitle(true); }}
            className="flex items-center gap-1.5 group"
          >
            <span className="text-sm font-semibold text-sky-700 dark:text-sky-300">{title}</span>
            <Pencil className="h-3 w-3 text-sky-400/50 group-hover:text-sky-500 transition-colors" />
          </button>
        )}

        <div className="h-4 w-px bg-border flex-shrink-0" />

        {/* URL input */}
        <div className="flex flex-1 min-w-0 items-center gap-2">
          <input
            value={linkInput}
            onChange={(e) => { setLinkInput(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleOpenModal()}
            placeholder="Paste YouTube live stream URL (e.g. youtube.com/live/...)"
            className="flex-1 min-w-0 text-xs bg-background/60 border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500/40 focus:border-sky-500/50 placeholder:text-muted-foreground/50"
          />
          {error && (
            <span className="text-[10px] text-rose-500 whitespace-nowrap hidden sm:inline">{error}</span>
          )}
        </div>

        {/* Watch Live button */}
        <button
          onClick={handleOpenModal}
          disabled={!linkInput.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 shadow-sm"
        >
          <Play className="h-3 w-3 fill-current" />
          Watch Live
        </button>

        {error && (
          <span className="text-[10px] text-rose-500 sm:hidden w-full text-center">{error}</span>
        )}
      </div>

      {/* Live Viewer Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="relative w-full max-w-4xl bg-card rounded-2xl shadow-2xl overflow-hidden border border-border/60"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-sky-500/15 to-transparent border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="relative flex-shrink-0">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-red-500 animate-ping opacity-75" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">Live</span>
                <div className="h-3.5 w-px bg-border" />
                <Video className="h-4 w-4 text-sky-500" />
                <span className="text-sm font-semibold text-foreground">{title}</span>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            {/* 16:9 video embed */}
            <div className="relative w-full bg-black" style={{ paddingBottom: '56.25%' }}>
              <iframe
                src={embedUrl()}
                title={title}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>

            {/* Modal footer */}
            <div className="px-5 py-2.5 bg-muted/30 border-t border-border flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground truncate">{savedLink}</p>
              <button
                onClick={() => setShowModal(false)}
                className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors flex-shrink-0"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const Dashboard = () => {
  const [overview, setOverview] = useState(null);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [alertData, setAlertData] = useState({});
  const [reportData, setReportData] = useState({});
  const [grievanceData, setGrievanceData] = useState({});

  const [alertType, setAlertType] = useState('active');
  const [alertPlatform, setAlertPlatform] = useState('all');
  const [threatPlatform, setThreatPlatform] = useState('all');
  const [threatCategory, setThreatCategory] = useState('all');
  const [alertPendingReportData, setAlertPendingReportData] = useState({});
  const [reportPlatform, setReportPlatform] = useState('all');
  const [reportStatus, setReportStatus] = useState('all');
  const [grievancePlatform, setGrievancePlatform] = useState('all');
  const [grievanceStatus, setGrievanceStatus] = useState('all');
  const [monitorPlatform, setMonitorPlatform] = useState('all');

  useEffect(() => {
    fetchData();
  }, []);

  const getApiPlatform = (platformId) => {
    if (platformId === 'twitter') return 'x';
    return platformId;
  };

  const fetchAlertsTotal = async (params) => {
    const response = await api.get('/alerts', {
      params: {
        page: 1,
        limit: 1,
        ...params
      }
    });
    return response.data?.pagination?.total || 0;
  };

  const buildDashboardCounts = async () => {
    const platformIds = PLATFORMS.map(p => p.id);
    const grievancePlatforms = platformIds.filter(p => p !== 'youtube');

    // Fire all backend calls in one parallel batch (instead of awaiting each step).
    // Step 1: per-platform alert stats. Step 2: per-platform viral totals.
    // Step 3: aggregated reports stats (replaces the old full /reports table fetch).
    // Step 4: per-platform grievance pending/resolved totals.
    const [alertStatsEntries, viralEntries, reportsStatsRes, grievanceEntries] = await Promise.all([
      Promise.all(
        platformIds.map(async (platformId) => {
          const platform = platformId === 'all' ? undefined : getApiPlatform(platformId);
          const response = await api.get('/alerts/stats', { params: { platform } });
          return [platformId, response.data || {}];
        })
      ),
      Promise.all(
        platformIds.map(async (platformId) => {
          const platform = platformId === 'all' ? undefined : getApiPlatform(platformId);
          const total = await fetchAlertsTotal({
            status: 'active',
            alert_type: 'velocity',
            platform
          });
          return [platformId, total];
        })
      ),
      api.get('/reports/stats').catch(() => ({ data: { byPlatform: {} } })),
      Promise.all(
        grievancePlatforms.map(async (platformId) => {
          const platform = platformId === 'all' ? undefined : getApiPlatform(platformId);
          const [pending, resolved] = await Promise.all([
            fetchAlertsTotal({ status: 'active', platform, alert_type: 'risk' }),
            fetchAlertsTotal({ status: 'resolved', platform, alert_type: 'risk' })
          ]);
          return [platformId, { total: pending + resolved, pending, resolved }];
        })
      )
    ]);

    const alertStatsByPlatform = Object.fromEntries(alertStatsEntries);

    const statusBuckets = ['active', 'acknowledged', 'false_positive', 'escalated'];
    const nextAlertData = Object.fromEntries(
      statusBuckets.map((status) => [
        status,
        Object.fromEntries(
          platformIds.map((platformId) => [
            platformId,
            alertStatsByPlatform?.[platformId]?.[status] || 0
          ])
        )
      ])
    );

    nextAlertData.viral = Object.fromEntries(viralEntries);

    const pendingReportEntries = platformIds.map((platformId) => [
      platformId,
      alertStatsByPlatform?.[platformId]?.escalated_pending_report || 0
    ]);

    const emptyReportCounts = { total: 0, sent_to_intermediary: 0, awaiting_reply: 0, closed: 0 };
    const reportCounts = Object.fromEntries(
      platformIds.map((platformId) => [platformId, { ...emptyReportCounts }])
    );

    // /reports/stats already aggregates counts on the server — just project per-platform.
    const statsByPlatform = reportsStatsRes?.data?.byPlatform || {};
    platformIds.forEach((platformId) => {
      const apiPlatformKey = platformId === 'all' ? 'all' : (platformId === 'twitter' ? 'twitter' : platformId);
      const src = statsByPlatform[apiPlatformKey] || {};
      reportCounts[platformId] = {
        total: src.total || 0,
        sent_to_intermediary: src.sent_to_intermediary || 0,
        awaiting_reply: src.awaiting_reply || 0,
        closed: (src.closed || 0) + (src.resolved || 0)
      };
    });

    setAlertData(nextAlertData);
    setAlertPendingReportData(Object.fromEntries(pendingReportEntries));
    setReportData(reportCounts);
    setGrievanceData(Object.fromEntries(grievanceEntries));
  };

  const fetchData = async () => {
    // First batch: overview + recent alerts — unblocks first paint of the dashboard shell.
    // Second batch: per-platform counts — runs in parallel and fills metrics in-place.
    const firstBatch = Promise.all([
      api.get('/analytics/overview'),
      api.get('/alerts?status=active')
    ])
      .then(([overviewRes, alertsRes]) => {
        setOverview(overviewRes.data);
        setRecentAlerts((alertsRes.data.alerts || alertsRes.data).slice(0, 8));
      })
      .catch((error) => {
        console.error(error);
        toast.error('Failed to load dashboard data');
      })
      .finally(() => {
        setLoading(false);
      });

    const secondBatch = buildDashboardCounts().catch((error) => {
      console.error('Dashboard counts failed', error);
    });

    try {
      await Promise.all([firstBatch, secondBatch]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="relative">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-violet-500/20 border-t-violet-600"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <Shield className="h-5 w-5 text-violet-600 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  const ALERT_TYPES = [
    { id: 'active', label: 'Active Alerts' },
    { id: 'acknowledged', label: 'Acknowledged Alerts' },
    { id: 'false_positive', label: 'False Positive Alerts' },
    { id: 'escalated', label: 'Escalated Alerts' },
    { id: 'viral', label: 'Viral Posts' }
  ];

  const getAlertCount = () => {
    const typeData = alertData?.[alertType] || alertData?.active || {};
    return typeData[alertPlatform] ?? typeData.all ?? 0;
  };

  const getEscalatedPendingCount = () => {
    const data = alertPendingReportData?.[alertPlatform] ?? alertPendingReportData?.all ?? 0;
    return data || 0;
  };

  const getEscalatedGeneratedCount = () => {
    const total = alertData?.escalated?.[alertPlatform] ?? alertData?.escalated?.all ?? 0;
    const pending = getEscalatedPendingCount();
    return Math.max(0, total - pending);
  };

  const getGrievanceCount = () => {
    const data = grievanceData?.[grievancePlatform] || grievanceData?.all || {};
    if (grievanceStatus === 'pending') return data.pending ?? 0;
    if (grievanceStatus === 'resolved') return data.resolved ?? 0;
    return data.total ?? 0;
  };

  const getReportCount = () => {
    const data = reportData?.[reportPlatform] || reportData?.all || {};
    if (reportStatus === 'sent_to_intermediary') return data.sent_to_intermediary || 0;
    if (reportStatus === 'awaiting_reply') return data.awaiting_reply || 0;
    if (reportStatus === 'closed') return data.closed || 0;
    return data.total || 0;
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300" data-testid="dashboard">
      {/* Stats Cards */}
      <TooltipProvider>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Alerts Card */}
          <Card className="bg-gradient-to-br from-card via-card to-rose-500/5 border border-border/50 shadow-sm hover:shadow-lg transition-all overflow-hidden">
            <div className="p-4 border-b border-border/50 bg-gradient-to-r from-rose-500/10 to-transparent">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1 bg-rose-500/10 rounded-lg">
                    <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                  </div>
                  <div className="relative">
                    <select
                      value={alertType}
                      onChange={(e) => setAlertType(e.target.value)}
                      className="appearance-none bg-transparent text-sm font-semibold text-foreground cursor-pointer focus:outline-none pr-5"
                    >
                      {ALERT_TYPES.map((type) => (
                        <option key={type.id} value={type.id}>{type.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {alertType === 'active' && 'Posts and messages currently flagged for review.'}
                      {alertType === 'acknowledged' && 'Alerts that have been reviewed and acknowledged.'}
                      {alertType === 'false_positive' && 'Alerts marked as false positives.'}
                      {alertType === 'escalated' && 'High priority alerts escalated for action.'}
                      {alertType === 'viral' && 'Content with significant viral spread.'}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Link to={`/alerts?status=${alertType}`} className="text-xs text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1">
                  View <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <p className="text-4xl font-bold bg-gradient-to-r from-rose-600 to-pink-600 bg-clip-text text-transparent">{getAlertCount()}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {PLATFORMS.find(p => p.id === alertPlatform)?.label || 'All platforms'}
              </p>
              {alertType === 'escalated' && (
                <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                  <p>Generated: {getEscalatedGeneratedCount()}</p>
                  <p>Awaiting Report Generation: {getEscalatedPendingCount()}</p>
                </div>
              )}
            </div>

            <div className="p-3 border-b border-border/50">
              <div className="flex items-center gap-2">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Platform</p>
                <div className="relative flex-1">
                  <select
                    value={alertPlatform}
                    onChange={(e) => setAlertPlatform(e.target.value)}
                    className="appearance-none bg-transparent text-xs font-medium text-foreground cursor-pointer focus:outline-none w-full pr-5"
                  >
                    {PLATFORMS.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="p-3 flex gap-3">
              {ALERT_TYPES.filter(t => t.id !== alertType).slice(0, 3).map((type) => (
                <button
                  key={type.id}
                  onClick={() => setAlertType(type.id)}
                  className="flex-1 text-center py-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors hover:bg-rose-500/5 rounded"
                >
                  <span className="block text-lg font-semibold text-foreground">{alertData[type.id]?.all || 0}</span>
                  <span>{type.label.replace(' Alerts', '').replace(' Posts', '')}</span>
                </button>
              ))}
            </div>
          </Card>

          {/* Requests Card */}
          <Card className="bg-gradient-to-br from-card via-card to-blue-500/5 border border-border/50 shadow-sm hover:shadow-lg transition-all overflow-hidden">
            <div className="p-4 border-b border-border/50 bg-gradient-to-r from-blue-500/10 to-transparent">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1 bg-blue-500/10 rounded-lg">
                    <Send className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-sm font-semibold">Requests Sent to SM</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Requests sent to social media platforms for content action.</TooltipContent>
                  </Tooltip>
                </div>
                <Link to="/reports" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                  View <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <p className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">{getReportCount()}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {PLATFORMS.find(p => p.id === reportPlatform)?.label || 'All platforms'}
              </p>
            </div>

            <div className="p-3 border-b border-border/50">
              <div className="flex items-center gap-2">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Platform</p>
                <div className="relative flex-1">
                  <select
                    value={reportPlatform}
                    onChange={(e) => setReportPlatform(e.target.value)}
                    className="appearance-none bg-transparent text-xs font-medium text-foreground cursor-pointer focus:outline-none w-full pr-5"
                  >
                    {PLATFORMS.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="p-3">
              <div className="flex items-center gap-2">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Status</p>
                <div className="relative flex-1">
                  <select
                    value={reportStatus}
                    onChange={(e) => setReportStatus(e.target.value)}
                    className="appearance-none bg-transparent text-xs font-medium text-foreground cursor-pointer focus:outline-none w-full pr-5"
                  >
                 
                    <option value="sent_to_intermediary">Sent to Intermediary</option>
                    <option value="closed">Closed</option>
                  </select>
                  <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>
          </Card>

          {/* Grievances Card */}
          <Card className="bg-gradient-to-br from-card via-card to-emerald-500/5 border border-border/50 shadow-sm hover:shadow-lg transition-all overflow-hidden">
            <div className="p-4 border-b border-border/50 bg-gradient-to-r from-emerald-500/10 to-transparent">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1 bg-emerald-500/10 rounded-lg">
                    <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <span className="text-sm font-semibold">Grievances</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Posts where people report issues, complaints, or requests for help.</TooltipContent>
                  </Tooltip>
                </div>
                <Link to="/grievances" className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1">
                  View <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <p className="text-4xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">{getGrievanceCount()}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {PLATFORMS.find(p => p.id === grievancePlatform)?.label || 'All platforms'}
              </p>
            </div>

            <div className="p-3 border-b border-border/50">
              <div className="flex items-center gap-2">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Platform</p>
                <div className="relative flex-1">
                  <select
                    value={grievancePlatform}
                    onChange={(e) => setGrievancePlatform(e.target.value)}
                    className="appearance-none bg-transparent text-xs font-medium text-foreground cursor-pointer focus:outline-none w-full pr-5"
                  >
                    {PLATFORMS.filter(p => p.id !== 'youtube').map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="p-3">
              <div className="flex items-center gap-2">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Status</p>
                <div className="relative flex-1">
                  <select
                    value={grievanceStatus}
                    onChange={(e) => setGrievanceStatus(e.target.value)}
                    className="appearance-none bg-transparent text-xs font-medium text-foreground cursor-pointer focus:outline-none w-full pr-5"
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="resolved">Resolved</option>
                  </select>
                  <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </TooltipProvider>

      {/* Drone View Live Monitoring Strip */}
      <DroneViewStrip />

      {/* Glance Chat Section */}
      <GlanceChat />
    </div>
  );
};

export default Dashboard;
