import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { Loader2, Plus, Trash2, ArrowRight, Calendar as CalendarIcon } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Calendar } from '../ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { cn } from '../../lib/utils';

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
                className="h-5 text-sm flex-1"
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

const MOCK_RIBBON_EVENTS = [
  { id: 'r1', title: 'Live Update: Traffic restrictions on MG Road due to VIP movement.', type: 'GOVT' },
  { id: 'r2', title: 'Flash: Heavy rain alert issued for coastal districts.', type: 'OTHER' },
  { id: 'r3', title: 'Update: Peace committee meeting concluded successfully.', type: 'POLITICAL' },
  { id: 'r4', title: 'Alert: Fake news circulating about examination schedule.', type: 'TECH' },
  { id: 'r5', title: 'Notice: Power outage scheduled for maintenance in Sector 4.', type: 'GOVT' },
  { id: 'r6', title: 'Live Update: Traffic restrictions on MG Road due to VIP movement.', type: 'GOVT' },
  { id: 'r7', title: 'Flash: Heavy rain alert issued for coastal districts.', type: 'OTHER' },
  { id: 'r8', title: 'Update: Peace committee meeting concluded successfully.', type: 'POLITICAL' },
  { id: 'r9', title: 'Alert: Fake news circulating about examination schedule.', type: 'TECH' },
  { id: 'r10', title: 'Notice: Power outage scheduled for maintenance in Sector 4.', type: 'GOVT' },
];

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
  const scrollRef = useRef(null);
  const [isPaused, setIsPaused] = useState(false);
  const [date, setDate] = useState(new Date());

  const fetchEvents = async () => {
    try {
      const params = { bucket };
      if (date) {
        params.date = format(date, 'yyyy-MM-dd');
      }
      
      const response = await api.get('/ongoing-events', { params });
      let data = response.data;
      
      if ((!data || data.length === 0) && !date) {
        data = MOCK_RIBBON_EVENTS;
      } else if (!data) {
        data = [];
      }
      
      setEvents(data);
    } catch (error) {
      console.error('Error fetching ribbon items:', error);
      if (!date) setEvents(MOCK_RIBBON_EVENTS);
      else setEvents([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [bucket, date]);

  // Auto-scroll logic
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || isPaused) return;

    let animationFrameId;
    const scroll = () => {
      if (scrollContainer.scrollTop >= scrollContainer.scrollHeight / 2) {
        scrollContainer.scrollTop = 0; // Seamless reset
      } else {
        scrollContainer.scrollTop += 0.4; // Adjust speed
      }
      animationFrameId = requestAnimationFrame(scroll);
    };

    animationFrameId = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPaused, events]);

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
          
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "h-5 px-2 text-[10px] font-normal hover:bg-background/20",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-1 h-3 w-3" />
                  {date ? format(date, "dd/MM") : <span>Date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(newDate) => {
                    if (newDate) setDate(newDate);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

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
        </div>
        <div
          className="flex-1 overflow-y-auto p-0"
          ref={scrollRef}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          {isLoading ? (
            <div className="flex justify-center items-center h-full">
              <Loader2 className={`h-4 w-4 animate-spin ${iconClass}`} />
            </div>
          ) : events.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
              {emptyLabel}
            </div>
          ) : (
            [...events, ...events].map((event, idx) => (
              <div key={`${event.id || event._id}-${idx}`} className={`border-b border-border/50 last:border-0 p-3 transition-colors ${hoverClass}`}>
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

export default ManagedRibbonWidget;
