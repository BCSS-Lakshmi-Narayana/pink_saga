import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNotification } from '../context/NotificationContext';
import api from '../lib/api';
import { AlertTriangle, CheckCircle, Flag, XCircle, Zap, Activity, MessageSquare, Filter, ExternalLink, Search, Calendar, Download, Loader2, ArrowUpCircle, Plus, LayoutGrid, LayoutList, Tag, Users, X } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { toast } from 'sonner';
import { TwitterAlertCard, YoutubeAlertCard, FrequentEngagersDialog } from '../components/AlertCards';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar as CalendarComponent } from '../components/ui/calendar';
import {
  format, startOfDay, endOfDay, subDays, subMonths,
  startOfMonth, endOfMonth, isSameDay, isSameMonth, isSameYear,
  differenceInCalendarDays,
} from 'date-fns';
import AddSourceModal from '../components/AddSourceModal';
import { useRbac } from '../contexts/RbacContext';
import { useAuth } from '../contexts/AuthContext';
import { canManageRestrictedGrievanceUi } from '../lib/grievanceUiPermissions';
// Same resolver the cards use, so the client-side filter and the rendered badge
// can never disagree about a record.
import { getAlertSentiment } from '../lib/sentiment';

const ALERT_STATUS_VALUES = ['active', 'false_positive', 'acknowledged', 'escalated'];
const ALERTS_CACHE_KEY = 'alertsCache_v2';
const ALERTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ENGAGER_AUTO_QUEUE_TRIGGER_KEY = 'engagerAutoQueueLastTriggerAt';
const ENGAGER_AUTO_QUEUE_TRIGGER_TTL = 60 * 60 * 1000; // 1 hour
const ALERTS_PAGE_SIZE = 20;
// Negative/Neutral/Positive pills filter on the post's RAW sentiment
// (llm_analysis.generic_sentiment); the client-relative view is the stance.
const SENTIMENT_BY_CATEGORY = { high: 'negative', medium: 'neutral', low: 'positive' };

/**
 * Date-range filtering
 * ─────────────────────────────────────────────────────────────────────
 * A calendar day is a LOCAL concept — the user picking "12 Aug" means 12 Aug
 * where they are — while `published_at` is stored as a UTC instant. The browser
 * is the only party that knows the timezone, so it resolves the picked day into
 * an absolute instant range and the API honours those instants verbatim.
 *
 * Two rules follow, and breaking either is what made this filter unusable:
 *
 *   · A calendar day NEVER round-trips through toISOString(). Local midnight on
 *     12 Aug in IST is 11 Aug 18:30 UTC, so the day written to state was the
 *     day before the one clicked.
 *   · A single-day selection is a CLOSED range. It used to send `startDate`
 *     with no `endDate`, which the API reads as an open-ended `$gte` — "12 Aug
 *     onwards" — so picking one day returned the newest alerts in the
 *     collection.
 */
const DATE_ONLY_RX = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' as a LOCAL calendar day. `new Date(str)` would read it as UTC
 *  midnight, which renders as the previous day anywhere east of UTC. */
const parseDayParam = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (DATE_ONLY_RX.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    const local = new Date(y, m - 1, d);
    return Number.isNaN(local.getTime()) ? null : local;
  }
  // Full ISO timestamps still parse, so existing deep links keep working.
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

const toDayParam = (date) => (date ? format(date, 'yyyy-MM-dd') : '');

/**
 * The request bounds for a picked range. Always closed: a single day leaves
 * `end` empty and falls back to `start`, which is what turns "12 Aug" into
 * 12 Aug rather than "12 Aug onwards". Sent as exact instants so the window is
 * the user's local day, not the UTC one.
 */
const dateRangeParams = (dateRange) => {
  const from = parseDayParam(dateRange?.start);
  const to = parseDayParam(dateRange?.end);
  if (from) {
    return {
      startDate: startOfDay(from).toISOString(),
      endDate: endOfDay(to || from).toISOString(),
    };
  }
  // `end` alone stays open-ended on the lower bound, which is a meaningful
  // "everything up to" query.
  if (to) return { startDate: undefined, endDate: endOfDay(to).toISOString() };
  return { startDate: undefined, endDate: undefined };
};

/**
 * The windows people actually ask for, evaluated at click time — "today" has to
 * mean today when it is clicked, not when the module was loaded, because this
 * page is left open for whole shifts.
 */
const DATE_PRESETS = [
  { id: 'today', label: 'Today', range: () => { const t = new Date(); return { from: t, to: t }; } },
  { id: 'yesterday', label: 'Yesterday', range: () => { const y = subDays(new Date(), 1); return { from: y, to: y }; } },
  { id: 'last7', label: 'Last 7 days', range: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
  { id: 'last30', label: 'Last 30 days', range: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
  { id: 'thisMonth', label: 'This month', range: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { id: 'lastMonth', label: 'Last month', range: () => { const m = subMonths(new Date(), 1); return { from: startOfMonth(m), to: endOfMonth(m) }; } },
];

const sameDayOrBothNull = (a, b) => (!a && !b) || (!!a && !!b && isSameDay(a, b));

/** Which preset, if any, the current selection corresponds to. */
const matchDatePreset = ({ from, to }) => {
  if (!from && !to) return null;
  const hit = DATE_PRESETS.find((p) => {
    const r = p.range();
    return sameDayOrBothNull(from, r.from) && sameDayOrBothNull(to || from, r.to);
  });
  return hit ? hit.id : null;
};

/** Separates "on 12 Aug" from "since 12 Aug" — the two readings the old
 *  open-ended query conflated. */
const formatDateRangeLabel = ({ from, to }) => {
  if (!from && !to) return null;
  if (!from) return `Until ${format(to, 'd MMM yyyy')}`;
  if (!to || isSameDay(from, to)) return format(from, 'd MMM yyyy');
  if (!isSameYear(from, to)) return `${format(from, 'd MMM yyyy')} – ${format(to, 'd MMM yyyy')}`;
  return isSameMonth(from, to)
    ? `${format(from, 'd')} – ${format(to, 'd MMM yyyy')}`
    : `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')}`;
};

/** Plain-language restatement shown in the popover footer, so a one-day pick
 *  cannot be misread as "from this date onwards". */
const describeDateSelection = ({ from, to }) => {
  if (!from && !to) return 'No date filter — showing all alerts';
  if (!from) return `Everything posted up to ${format(to, 'd MMM yyyy')}`;
  if (!to || isSameDay(from, to)) return `${format(from, 'EEEE, d MMM yyyy')} only`;
  const days = differenceInCalendarDays(to, from) + 1;
  return `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')} · ${days} days`;
};

const Alerts = () => {
  const { user } = useAuth();
  const canEditAlerts = canManageRestrictedGrievanceUi(user);
  const [searchParams] = useSearchParams();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const isFirstLoadRef = useRef(true);
  const activeTab = 'all';
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth >= 1024);
  const [monitoredHandles, setMonitoredHandles] = useState([]);
  const [frequentEngagersOpen, setFrequentEngagersOpen] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [alertCategory, setAlertCategory] = useState('all'); // 'all', 'risk', 'viral', 'new_post'
  const [totalResults, setTotalResults] = useState(0);
  const [alertStats, setAlertStats] = useState(null);
  const [downloadStates, setDownloadStates] = useState({});
  const [newAlertCount, setNewAlertCount] = useState(0); // Count of new alerts since last scroll-to-top
  const [pendingNewAlerts, setPendingNewAlerts] = useState([]); // Buffer for new alerts during polling
  const scrollAnchorRef = useRef({ shouldRestore: false, prevHeight: 0, prevScroll: 0 });
  const scrollContainerRef = useRef(null);

  // Search & Pagination States
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [targetAlertId, setTargetAlertId] = useState(null);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [keywordFilter, setKeywordFilter] = useState('all');
  const [availableKeywords, setAvailableKeywords] = useState([]);
  const [sourceCategoryFilter, setSourceCategoryFilter] = useState('all');
  // Supportive / Opposing / Neutral — the stance badge (see lib/sentiment.js).
  // Seeded from the URL so a figure elsewhere can link to its evidence:
  //   /alerts?stance=opposing&from=…&to=…
  const [stanceFilter, setStanceFilter] = useState(
    () => new URLSearchParams(window.location.search).get('stance') || 'all',
  );
  // ?leader=<constituency>: alerts whose post tags / names that seat's MLA
  // or names the seat (the MLA detail page's "Open in Alerts").
  const [leaderSeat, setLeaderSeat] = useState(() => new URLSearchParams(window.location.search).get('leader') || '');
  // ?risk=<low|medium|high|critical>: risk level, separate from the sentiment
  // tabs (positive and neutral are BOTH low risk, so a risk link cannot be a tab).
  const [riskParam, setRiskParam] = useState(() => new URLSearchParams(window.location.search).get('risk') || '');
  // Local calendar days ('YYYY-MM-DD'), converted to exact instants only when
  // a request is built — see dateRangeParams.
  const [dateRange, setDateRange] = useState(() => ({
    start: toDayParam(parseDayParam(searchParams.get('from'))),
    end: toDayParam(parseDayParam(searchParams.get('to'))),
  }));
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [topicClassificationFilter, setTopicClassificationFilter] = useState('all');

  // The picked range as Dates, for the calendar and the labels. State stays
  // string-based so the cache key and the effect dependencies are stable.
  const pickedRange = useMemo(() => ({
    from: parseDayParam(dateRange.start),
    to: parseDayParam(dateRange.end),
  }), [dateRange.start, dateRange.end]);
  const hasDateFilter = !!(dateRange.start || dateRange.end);
  const activeDatePreset = useMemo(() => matchDatePreset(pickedRange), [pickedRange]);

  /**
   * The single place a date selection is committed, so the calendar, the
   * presets and both Clear affordances cannot write a half-updated pair.
   */
  const applyDateRange = useCallback((from, to) => {
    setDateRange({ start: toDayParam(from), end: toDayParam(to) });
  }, []);

  const [topicCounts, setTopicCounts] = useState([]);
  // Total under the current filters WITHOUT a topic requirement — what the
  // "All Topics" chip means, since clicking it clears the topic filter. Summing
  // the per-topic counts excluded unclassified alerts, so the chip reported a
  // number the feed contradicted.
  const [topicTotal, setTopicTotal] = useState(null);
  // How many alerts carry no usable topic. Selectable as its own chip so the
  // bucket isn't unreachable.
  const [topicUnclassified, setTopicUnclassified] = useState(0);
  // Categories come from the data rather than a fixed list — see below.
  const [sourceCategories, setSourceCategories] = useState([]);
  const [instagramContentFilter, setInstagramContentFilter] = useState('all_posts_reels');
  const [instagramStoriesStatusFilter, setInstagramStoriesStatusFilter] = useState('all');
  const [capturedStories, setCapturedStories] = useState([]);
  const [capturedStoriesLoading, setCapturedStoriesLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageRef = useRef(1); // mirrors page state so fetchAlerts doesn't need page as a dep
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState(null);
  const loadMoreSentinelRef = useRef(null);
  const isFetchingRef = useRef(false);
  const isPollingRef = useRef(false);
  const fetchAbortRef = useRef(null);
  const fetchRequestSeqRef = useRef(0);

  // Link Investigation States
  const [isInvestigating, setIsInvestigating] = useState(false);
  const [investigatedAlerts, setInvestigatedAlerts] = useState([]);

  const { markAllRead } = useNotification();
  const { hasFeatureAccess } = useRbac();

  const accessibleAlertStatuses = useMemo(
    () => ALERT_STATUS_VALUES.filter((status) => hasFeatureAccess('/alerts', status)),
    [hasFeatureAccess]
  );
  const hasAnyAlertFeature = accessibleAlertStatuses.length > 0;
  const isCapturedStoriesView = platformFilter === 'instagram' && instagramContentFilter === 'captured_stories';

  // Categories come from the data, not a fixed list. The hardcoded seven had
  // drifted from what Sources are actually tagged with, so the ones nothing
  // carries selected nothing and read as a broken filter. See
  // GET /api/alerts/source-categories.

  const buildCacheKey = useCallback(() => {
    return [
      'tab', activeTab,
      'cat', alertCategory,
      'q', debouncedSearchQuery || '',
      'platform', platformFilter,
      'keyword', keywordFilter,
      'sourceCat', sourceCategoryFilter,
      'stance', stanceFilter,
      'leader', leaderSeat,
      'risk', riskParam,
      'topicClass', topicClassificationFilter,
      'start', dateRange.start || '',
      'end', dateRange.end || '',
      'igContent', instagramContentFilter,
      'igStories', instagramStoriesStatusFilter
    ].join('|');
  }, [activeTab, alertCategory, debouncedSearchQuery, platformFilter, keywordFilter, sourceCategoryFilter, stanceFilter, leaderSeat, riskParam, topicClassificationFilter, dateRange.start, dateRange.end, instagramContentFilter, instagramStoriesStatusFilter]);

  const readCache = useCallback((key) => {
    try {
      const raw = localStorage.getItem(ALERTS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const entry = parsed?.[key];
      if (!entry?.ts || !entry?.data) return null;
      if (Date.now() - entry.ts > ALERTS_CACHE_TTL) return null;
      return entry.data;
    } catch (error) {
      console.error('Failed to read alerts cache:', error);
      return null;
    }
  }, []);

  const writeCache = useCallback((key, data) => {
    try {
      const raw = localStorage.getItem(ALERTS_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[key] = { ts: Date.now(), data };
      localStorage.setItem(ALERTS_CACHE_KEY, JSON.stringify(parsed));
    } catch (error) {
      console.error('Failed to write alerts cache:', error);
    }
  }, []);

  // Read status from URL query params (e.g., /alerts?status=acknowledged)
  useEffect(() => {
    const searchParam = searchParams.get('search');
    const platformParam = searchParams.get('platform');
    const categoryParam = searchParams.get('category');
    const alertIdParam = searchParams.get('alertId');
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    if (platformParam) {
      setPlatformFilter(platformParam);
    }

    if (categoryParam) {
      setAlertCategory(categoryParam);
    }

    // Only populate search query if EXPLICITLY provided via 'search' param
    if (searchParam) {
      setSearchQuery(searchParam);
      setDebouncedSearchQuery(searchParam);
    }

    if (alertIdParam) {
      setTargetAlertId(alertIdParam);
    } else {
      setTargetAlertId(null);
    }

    if (fromParam || toParam) {
      try {
        setDateRange({
          start: fromParam ? new Date(fromParam).toISOString() : '',
          end: toParam ? new Date(toParam).toISOString() : ''
        });
      } catch (err) {
        console.error('Failed to parse date range params:', err);
      }
    }
  }, [searchParams]);


  const updateDownloadState = (id, updates) => {
    setDownloadStates((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        ...updates
      }
    }));
  };

  // Map to store reports by alert_id for quick lookup
  const [reportsMap, setReportsMap] = useState({});

  // Add Source Modal States
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [initialSourceData, setInitialSourceData] = useState(null);

  // Fetch reports for escalated alerts to show report status
  const fetchReportsForAlerts = useCallback(async (alertsList) => {
    const escalatedAlertIds = alertsList
      .filter(a => a.status === 'escalated')
      .map(a => a.id);

    if (escalatedAlertIds.length === 0) return;

    try {
      const response = await api.get('/reports');
      const reports = response.data.data || response.data || [];

      // Create a map of alert_id -> report, but ONLY for alerts currently on screen
      const newReportsMap = {};
      reports.forEach(report => {
        // Only include reports that match current escalated alerts
        if (report.alert_id && escalatedAlertIds.includes(report.alert_id)) {
          newReportsMap[report.alert_id] = report;
        }
      });
      setReportsMap(newReportsMap); // Replace, don't merge, to avoid stale data
    } catch (error) {
      console.error('Failed to fetch reports for alerts:', error);
    }
  }, []);

  const handleDownloadMedia = async (alert, contentData) => {
    const mediaUrl = alert?.content_url || contentData?.url || contentData?.link;
    if (!mediaUrl) {
      updateDownloadState(alert.id, { error: 'No media URL available' });
      setTimeout(() => updateDownloadState(alert.id, { error: null }), 3000);
      return;
    }

    updateDownloadState(alert.id, {
      downloading: true,
      progress: 0,
      status: 'Initializing...',
      error: null
    });

    try {
      updateDownloadState(alert.id, { progress: 10, status: 'Fetching media info...' });

      const downloadPromise = api.post('/media/download', {
        media_url: mediaUrl,
        content_id: contentData?.id || alert.content_id
      });

      let progress = 10;
      const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress < 85) {
          updateDownloadState(alert.id, { progress: Math.min(progress, 85) });
          if (progress < 30) updateDownloadState(alert.id, { status: 'Fetching media info...' });
          else if (progress < 50) updateDownloadState(alert.id, { status: 'Downloading media...' });
          else if (progress < 70) updateDownloadState(alert.id, { status: 'Processing...' });
          else updateDownloadState(alert.id, { status: 'Almost done...' });
        }
      }, 500);

      const response = await downloadPromise;
      clearInterval(progressInterval);

      updateDownloadState(alert.id, { progress: 100, status: 'Complete!' });

      if (response.data.download_url) {
        setTimeout(() => {
          window.open(response.data.download_url, '_blank');
          updateDownloadState(alert.id, { downloading: false, progress: 0, status: '' });
        }, 500);
      } else {
        updateDownloadState(alert.id, { downloading: false, progress: 0, status: '' });
      }
    } catch (error) {
      updateDownloadState(alert.id, {
        downloading: false,
        progress: 0,
        status: '',
        error: error.response?.data?.error || 'Download failed'
      });
      setTimeout(() => updateDownloadState(alert.id, { error: null }), 3000);
    }
  };

  // Reset pagination when filters change
  useEffect(() => {
    setPage(1);
    setHasMore(false);
    if (!hasAnyAlertFeature) return;
    // Clear cache to force fresh fetch on filter change
    try {
      localStorage.removeItem(ALERTS_CACHE_KEY);
    } catch (e) { /* ignore */ }
  }, [activeTab, alertCategory, debouncedSearchQuery, platformFilter, keywordFilter, sourceCategoryFilter, stanceFilter, leaderSeat, riskParam, topicClassificationFilter, dateRange, hasAnyAlertFeature]);

  useEffect(() => {
    if (platformFilter !== 'instagram') {
      setInstagramContentFilter('all_posts_reels');
      setInstagramStoriesStatusFilter('all');
    }
  }, [platformFilter]);

  useEffect(() => {
    if (instagramContentFilter !== 'stories_24h') {
      setInstagramStoriesStatusFilter('all');
    }
  }, [instagramContentFilter]);

  // Fetch topic classification counts from server
  const fetchTopicCounts = useCallback(async () => {
    try {
      // Every filter the feed sends, so each chip's count is the number of
      // rows clicking it returns. Search, category and keyword used to be
      // omitted here, so those three moved the feed and left the chips
      // showing totals for a different set.
      const params = {
        status: 'all',
        search: debouncedSearchQuery || undefined,
        platform: platformFilter !== 'all' ? platformFilter : undefined,
        category: sourceCategoryFilter !== 'all' ? sourceCategoryFilter : undefined,
        stance: stanceFilter !== 'all' ? stanceFilter : undefined,
        leader_seat: leaderSeat || undefined,
        risk_level: riskParam || undefined,
        keyword: keywordFilter !== 'all' ? keywordFilter : undefined,
        // Spread from the two fields rather than the object, so the effect
        // dependency list below is exactly what is read.
        ...dateRangeParams({ start: dateRange.start, end: dateRange.end })
      };

      if (alertCategory === 'viral') {
        params.alert_type = 'velocity';
      } else if (alertCategory === 'risk') {
        params.alert_type = 'risk';
      } else if (['high', 'medium', 'low'].includes(alertCategory)) {
        params.sentiment = SENTIMENT_BY_CATEGORY[alertCategory];
      } else if (alertCategory === 'critical') {
        params.risk_level = alertCategory;
      }

      const response = await api.get('/alerts/topic-counts', { params });
      const data = response.data;
      // Tolerates the old bare-array shape as well as { topics, total, ... }.
      setTopicCounts(Array.isArray(data) ? data : (data?.topics || []));
      setTopicTotal(Array.isArray(data) ? null : (data?.total ?? null));
      setTopicUnclassified(Array.isArray(data) ? 0 : (data?.unclassified ?? 0));
    } catch (error) {
      console.error('Failed to fetch topic classification counts:', error);
      setTopicCounts([]);
      setTopicTotal(null);
      setTopicUnclassified(0);
    }
  }, [platformFilter, dateRange.start, dateRange.end, alertCategory,
      debouncedSearchQuery, sourceCategoryFilter, stanceFilter, leaderSeat, riskParam, keywordFilter]);

  // Source categories that actually select something. Independent of the other
  // filters, so it is fetched once.
  useEffect(() => {
    let cancelled = false;
    api.get('/alerts/source-categories')
      .then((res) => { if (!cancelled) setSourceCategories(res.data || []); })
      .catch(() => { if (!cancelled) setSourceCategories([]); });
    return () => { cancelled = true; };
  }, []);

  // Keywords that actually select alerts, with their counts — not the raw
  // tracked list, most of which matches nothing and read as a broken filter.
  // Follows the other active filters so the counts describe the current view.
  //
  // Deliberately NOT keyed on keywordFilter: the counts are computed with the
  // keyword filter removed, so re-running on your own selection would refetch
  // an identical list.
  const fetchKeywordCounts = useCallback(async () => {
    try {
      const params = {
        status: 'all',
        search: debouncedSearchQuery || undefined,
        platform: platformFilter !== 'all' ? platformFilter : undefined,
        category: sourceCategoryFilter !== 'all' ? sourceCategoryFilter : undefined,
        stance: stanceFilter !== 'all' ? stanceFilter : undefined,
        leader_seat: leaderSeat || undefined,
        risk_level: riskParam || undefined,
        topic_classification: topicClassificationFilter !== 'all' ? topicClassificationFilter : undefined,
        ...dateRangeParams({ start: dateRange.start, end: dateRange.end }),
      };
      const response = await api.get('/alerts/keyword-counts', { params });
      setAvailableKeywords(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Failed to fetch keyword counts:', error);
      setAvailableKeywords([]);
    }
  }, [debouncedSearchQuery, platformFilter, sourceCategoryFilter, stanceFilter, leaderSeat, riskParam,
      topicClassificationFilter, dateRange.start, dateRange.end]);

  useEffect(() => { fetchKeywordCounts(); }, [fetchKeywordCounts]);

  useEffect(() => {
    // Prefetch lightweight summary so counts are available immediately
    api.get('/alerts/summary').then(res => {
      if (res.data) {
        setAlertStats(prev => prev || res.data);
      }
    }).catch(() => { });
  }, []);

  // Topic counts follow the same filters. This used to be called from two
  // separate effects with the same dependency, so every filter change fetched
  // it twice.
  useEffect(() => {
    fetchTopicCounts();
  }, [fetchTopicCounts]);

  // Removed mapContentToAlert as it was only for content/feed fallback which is now unified
  // Removed fetchContentFeed as we now use /api/alerts for everything

  const fetchAlerts = useCallback(async (isLoadMore = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setError(null);

    if (isFirstLoadRef.current && !isLoadMore) {
      setLoading(true);
    } else if (isLoadMore) {
      setIsFetchingMore(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const requestSeq = ++fetchRequestSeqRef.current;

      const params = {
        page: isLoadMore ? pageRef.current + 1 : 1,
        limit: ALERTS_PAGE_SIZE,
        includeStats: !isLoadMore,
        status: 'all',
        search: debouncedSearchQuery || undefined,
        platform: platformFilter !== 'all' ? platformFilter : undefined,
        category: sourceCategoryFilter !== 'all' ? sourceCategoryFilter : undefined,
        stance: stanceFilter !== 'all' ? stanceFilter : undefined,
        leader_seat: leaderSeat || undefined,
        risk_level: riskParam || undefined,
        topic_classification: topicClassificationFilter !== 'all' ? topicClassificationFilter : undefined,
        ...dateRangeParams(dateRange),
        keyword: keywordFilter !== 'all' ? keywordFilter : undefined
      };

      if (alertCategory === 'viral') {
        params.alert_type = 'velocity';
      } else if (alertCategory === 'risk') {
        params.alert_type = 'risk';
      } else if (['high', 'medium', 'low'].includes(alertCategory)) {
        params.sentiment = SENTIMENT_BY_CATEGORY[alertCategory];
      } else if (alertCategory === 'critical') {
        params.risk_level = alertCategory;
      }

      const promises = [
        api.get('/alerts', { params, timeout: 60000 })
      ];

      if (targetAlertId && !isLoadMore) {
        promises.push(
          api.get(`/alerts/${targetAlertId}`).catch((err) => {
            console.error('[Alerts] Failed to fetch target alert:', err);
            return null;
          })
        );
      }

      const results = await Promise.all(promises);
      if (requestSeq !== fetchRequestSeqRef.current) return;

      const response = results[0];
      const targetAlertRes = results[1];
      const targetAlert = targetAlertRes?.data || null;

      const newAlerts = response.data.alerts || [];
      const pagination = response.data.pagination || {};

      setTotalResults((prev) => (typeof pagination.total === 'number' ? pagination.total : prev));
      setHasMore(pagination.hasMore);
      setNextCursor(pagination.nextCursor || null);
      setPage((prev) => {
        const next = isLoadMore ? prev + 1 : 1;
        pageRef.current = next;
        return next;
      });

      if (response.data.stats) setAlertStats(response.data.stats);

      if (isLoadMore) {
        setAlerts((prev) => {
          const existingIds = new Set(prev.map((a) => a.id));
          const trulyUnique = newAlerts.filter((a) => !existingIds.has(a.id));
          if (trulyUnique.length === 0) return prev;
          return [...prev, ...trulyUnique];
        });
      } else {
        if (targetAlert) {
          const filteredNew = newAlerts.filter((a) => a.id !== targetAlert.id && a._id !== targetAlert._id);
          setAlerts([targetAlert, ...filteredNew]);
        } else {
          setAlerts(newAlerts);
        }
        // Cache the first page for fast paint on next navigation
        writeCache(buildCacheKey(), {
          alerts: targetAlert 
            ? [targetAlert, ...newAlerts.filter((a) => a.id !== targetAlert.id && a._id !== targetAlert._id)] 
            : newAlerts,
          totalResults: pagination.total || 0,
          totalPages: pagination.totalPages || 1,
          alertStats: response.data.stats || null
        });
      }

    } catch (error) {
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') return;
      console.error(error);
      setError('Failed to load alerts');
      toast.error('Failed to load alerts');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      setIsFetchingMore(false);
      isFirstLoadRef.current = false;
      isFetchingRef.current = false;
    }
  }, [debouncedSearchQuery, targetAlertId, platformFilter, keywordFilter, alertCategory, dateRange, sourceCategoryFilter, stanceFilter, leaderSeat, riskParam, topicClassificationFilter, buildCacheKey, writeCache]);

  const fetchCapturedStories = useCallback(async () => {
    if (!isCapturedStoriesView) {
      setCapturedStories([]);
      setCapturedStoriesLoading(false);
      return;
    }

    setCapturedStoriesLoading(true);
    try {
      const allStories = [];
      let currentPage = 1;
      let hasMoreStories = true;

      while (hasMoreStories && currentPage <= 20) {
        const response = await api.get('/instagram-stories', {
          params: {
            page: currentPage,
            limit: 200,
            include_expired: true,
            include_unavailable: true,
            archived_only: true,
            s3_only: true
          }
        });

        const storiesChunk = Array.isArray(response.data?.stories) ? response.data.stories : [];
        allStories.push(...storiesChunk);

        hasMoreStories = Boolean(response.data?.pagination?.hasMore) && storiesChunk.length > 0;
        currentPage += 1;
      }

      const seenStoryIds = new Set();
      const dedupedStories = allStories.filter((story, index) => {
        const dedupeKey = story?.id || story?.story_pk || `${story?.author_handle || 'unknown'}-${story?.published_at || story?.created_at || index}`;
        if (seenStoryIds.has(dedupeKey)) return false;
        seenStoryIds.add(dedupeKey);
        return true;
      });

      setCapturedStories(dedupedStories);
    } catch (error) {
      console.error('Failed to fetch captured stories:', error);
      setCapturedStories([]);
      toast.error('Failed to load captured Instagram stories');
    } finally {
      setCapturedStoriesLoading(false);
    }
  }, [isCapturedStoriesView]);

  useEffect(() => {
    fetchCapturedStories();
  }, [fetchCapturedStories]);

  const fetchAlertStats = useCallback(async () => {
    // We now fetch stats always (for the Escalated pending count), 
    // relying on the JSX to hide regular status counts if no search is active.
    try {
      const params = {
        search: debouncedSearchQuery || undefined,
        platform: platformFilter !== 'all' ? platformFilter : undefined,
        category: sourceCategoryFilter !== 'all' ? sourceCategoryFilter : undefined,
        stance: stanceFilter !== 'all' ? stanceFilter : undefined,
        leader_seat: leaderSeat || undefined,
        risk_level: riskParam || undefined,
        ...dateRangeParams(dateRange),
        alert_type: alertCategory === 'viral' ? 'velocity' : undefined,
        keyword: keywordFilter !== 'all' ? keywordFilter : undefined
      };

      // Topic classification filter for stats
      if (topicClassificationFilter !== 'all') {
        params.topic_classification = topicClassificationFilter;
      }

      if (alertCategory === 'viral') {
        params.alert_type = 'velocity';
      } else if (alertCategory === 'risk') {
        params.alert_type = 'risk';
      } else if (['high', 'medium', 'low'].includes(alertCategory)) {
        params.sentiment = SENTIMENT_BY_CATEGORY[alertCategory];
      } else if (alertCategory === 'critical') {
        params.risk_level = alertCategory;
      }

      const response = await api.get('/alerts/stats', { params });
      setAlertStats(response.data);
    } catch (error) {
      console.error('Failed to fetch alert stats:', error);
    }
  }, [debouncedSearchQuery, platformFilter, keywordFilter, alertCategory, dateRange, sourceCategoryFilter, stanceFilter, leaderSeat, riskParam, topicClassificationFilter]);

  // Initial load or Filter change
  // Debounce Search Query so the alerts search reacts to any detail the user types.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 600); // 600ms debounce

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Trigger fetch on filter change or initial load
  useEffect(() => {
    pageRef.current = 1;
    setPage(1);
    setNextCursor(null);
    setHasMore(true);
    fetchAlerts(false);
  }, [activeTab, alertCategory, debouncedSearchQuery, platformFilter, keywordFilter, dateRange, sourceCategoryFilter, stanceFilter, leaderSeat, riskParam, topicClassificationFilter]);

  // Infinite-scroll: load more when sentinel becomes visible
  useEffect(() => {
    const node = loadMoreSentinelRef.current;
    if (!node) return undefined;
    if (!hasMore) return undefined;
    if (isCapturedStoriesView) return undefined;

    const scrollContainer = document.querySelector('main');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !isFetchingRef.current) {
          fetchAlerts(true);
        }
      },
      { root: scrollContainer, rootMargin: '300px', threshold: 0.1 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, fetchAlerts, isCapturedStoriesView]);

  useEffect(() => {
    markAllRead();
  }, [markAllRead]);

  // Fetch reports for escalated alerts when viewing escalated tab
  useEffect(() => {
    if (alerts.some((alert) => alert.status === 'escalated')) {
      fetchReportsForAlerts(alerts);
    } else {
      setReportsMap({});
    }
  }, [alerts, fetchReportsForAlerts]);

  // --- POLLING LOGIC ---
  const checkForNewAlerts = useCallback(async () => {
    if (!hasAnyAlertFeature) return;
    if (page !== 1 || isCapturedStoriesView) return;
    if (isFetchingRef.current || isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      const params = {
        page: 1,
        limit: ALERTS_PAGE_SIZE,
        status: 'all',
        platform: platformFilter !== 'all' ? platformFilter : undefined,
        category: sourceCategoryFilter !== 'all' ? sourceCategoryFilter : undefined,
        stance: stanceFilter !== 'all' ? stanceFilter : undefined,
        leader_seat: leaderSeat || undefined,
        risk_level: riskParam || undefined,
        topic_classification: topicClassificationFilter !== 'all' ? topicClassificationFilter : undefined,
        search: debouncedSearchQuery || undefined,
        keyword: keywordFilter !== 'all' ? keywordFilter : undefined
      };

      if (alertCategory === 'viral') params.alert_type = 'velocity';
      else if (alertCategory === 'risk') params.alert_type = 'risk';
      else if (['high', 'medium', 'low'].includes(alertCategory)) params.sentiment = SENTIMENT_BY_CATEGORY[alertCategory];
      else if (alertCategory === 'critical') params.risk_level = alertCategory;

      const response = await api.get('/alerts', { params, timeout: 15000 });
      const mappedNew = response.data.alerts || [];

      // Identify truly new items — ALWAYS buffer them, never prepend directly.
      // This prevents reorder chaos while user is reading.
      setAlerts(currentAlerts => {
        const currentIds = new Set([
          ...currentAlerts.map(a => a.id),
          ...pendingNewAlerts.map(a => a.id)
        ]);
        const trulyNew = mappedNew.filter(a => !currentIds.has(a.id));

        if (trulyNew.length > 0) {
          // Always buffer — never auto-prepend regardless of scroll position
          setPendingNewAlerts((prev) => {
            const seen = new Set(prev.map((a) => a.id));
            const merged = [...prev];
            trulyNew.forEach((item) => {
              if (!seen.has(item.id)) {
                seen.add(item.id);
                merged.push(item);
              }
            });
            return merged;
          });
          setNewAlertCount((prev) => prev + trulyNew.length);
        }
        return currentAlerts;
      });
      if (response.data?.stats) setAlertStats(response.data.stats);

    } catch (e) {
      console.error("Polling error:", e); // Silent fail
    } finally {
      isPollingRef.current = false;
    }
  }, [platformFilter, debouncedSearchQuery, alertCategory, keywordFilter, sourceCategoryFilter, stanceFilter, leaderSeat, riskParam, topicClassificationFilter, hasAnyAlertFeature, page, isCapturedStoriesView]);

  // Resolve the <main> scroll container from Layout
  useEffect(() => {
    scrollContainerRef.current = document.querySelector('main');
  }, []);

  // Scroll Anchoring Effect
  React.useLayoutEffect(() => {
    if (scrollAnchorRef.current.shouldRestore) {
      const container = scrollContainerRef.current || document.documentElement;
      const newHeight = container.scrollHeight;
      const diff = newHeight - scrollAnchorRef.current.prevHeight;
      if (diff > 0) {
        (scrollContainerRef.current || window).scrollTo(0, scrollAnchorRef.current.prevScroll + diff);
      }
      scrollAnchorRef.current.shouldRestore = false;
    }
  }, [alerts]);

  // Merge pending new alerts when user clicks the button
  const mergePendingAlerts = useCallback(() => {
    // Full re-fetch to load new alerts in proper order
    setPendingNewAlerts([]);
    setNewAlertCount(0);
    pageRef.current = 1;
    setPage(1);
    setNextCursor(null);
    setHasMore(true);
    fetchAlerts(false);
  }, [fetchAlerts]);

  // Reset new count when at top
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY < 50 && newAlertCount > 0) {
        setNewAlertCount(0);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [newAlertCount]);

  const fetchSourcesMetadata = useCallback(async () => {
    try {
      const response = await api.get('/sources');
      // Handle both { data: [...] } and directly [...]
      const data = Array.isArray(response.data) ? response.data : (response.data?.data || []);
      const handles = data.map(s => s.identifier).filter(Boolean);
      setMonitoredHandles(handles);
      console.log(`[Alerts] Fetched ${handles.length} monitored handles:`, handles);
    } catch (err) {
      console.error('Error fetching source metadata:', err);
    }
  }, []);

  useEffect(() => {
    // Clear alerts cache on page load to ensure fresh data
    try {
      localStorage.removeItem(ALERTS_CACHE_KEY);
    } catch (e) { /* ignore */ }

    if (!hasAnyAlertFeature) return;

    try {
      const lastTriggeredAt = Number(localStorage.getItem(ENGAGER_AUTO_QUEUE_TRIGGER_KEY) || 0);
      if (Date.now() - lastTriggeredAt < ENGAGER_AUTO_QUEUE_TRIGGER_TTL) return;
    } catch (error) {
      console.error('Failed to read engager auto-queue trigger cache:', error);
    }

    api.post('/x/engager-analysis-auto-queue')
      .then(() => {
        try {
          localStorage.setItem(ENGAGER_AUTO_QUEUE_TRIGGER_KEY, String(Date.now()));
        } catch (error) {
          console.error('Failed to write engager auto-queue trigger cache:', error);
        }
      })
      .catch((error) => {
        console.error('Failed to trigger engager auto-queue:', error);
      });
  }, []);

  useEffect(() => {
    // fetchSourcesMetadata is called initially and periodically
    fetchSourcesMetadata();

    // Auto-refresh every 2 minutes
    const interval = setInterval(() => {
      checkForNewAlerts(); // Use checkForNewAlerts for silent refresh
      fetchSourcesMetadata();
      if (isCapturedStoriesView) {
        fetchCapturedStories();
      }
    }, 120000);

    return () => clearInterval(interval);
  }, [checkForNewAlerts, fetchAlerts, fetchAlertStats, fetchSourcesMetadata, fetchCapturedStories, isCapturedStoriesView]);




  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setNewAlertCount(0);
  };



  const handleAlertResolve = (resolvedAlert) => {
    const newStatus = resolvedAlert.status;

    setAlerts(prev => prev.map((alert) => (
      alert.id === resolvedAlert.id ? { ...alert, status: newStatus } : alert
    )));
    setInvestigatedAlerts(prev => prev.map((alert) => (
      alert.id === resolvedAlert.id ? { ...alert, status: newStatus } : alert
    )));

    toast.success(`Alert moved to ${newStatus?.replace('_', ' ') || 'updated'}`);
    fetchAlertStats();
  };

  // Patch an alert across both list states + nested content.analysis (so the
  // ReasonModal and card badges reflect the change without a refetch).
  const patchAlertLocally = (alertId, patch) => {
    const apply = (a) => {
      if (a.id !== alertId) return a;
      const merged = { ...a, ...patch };
      if (patch.llm_analysis) merged.llm_analysis = { ...(a.llm_analysis || {}), ...patch.llm_analysis };
      if (patch.threat_details) merged.threat_details = { ...(a.threat_details || {}), ...patch.threat_details };
      if (patch.content_details_patch && a.content_details) {
        merged.content_details = {
          ...a.content_details,
          ...patch.content_details_patch,
          analysis: patch.content_details_patch.analysis
            ? { ...(a.content_details.analysis || {}), ...patch.content_details_patch.analysis }
            : a.content_details.analysis
        };
      }
      return merged;
    };
    setAlerts(prev => prev.map(apply));
    setInvestigatedAlerts(prev => prev.map(apply));
  };

  // Raw sentiment ⇄ risk, same mapping as the backend (analysisService /
  // alertController): positive → low 15, neutral → low 20, negative → high 75.
  // An explicit risk edit scores by its own band (alertController RISK_LEVEL_SCORE_MAP).
  const RISK_SCORE_BANDS = { low: 20, medium: 50, high: 75, critical: 90 };
  // Risk → tone, as the server does it: medium/high/critical are negative;
  // low cannot tell positive from neutral, so a positive/neutral tone is kept
  // and a negative one becomes neutral.
  const riskToSentiment = (level, alert) => {
    if (level === 'medium' || level === 'high' || level === 'critical') return 'negative';
    const cur = String(alert?.llm_analysis?.generic_sentiment || alert?.llm_analysis?.sentiment || '').toLowerCase().replace('moderate', 'neutral');
    return cur === 'positive' || cur === 'neutral' ? cur : 'neutral';
  };

  const handleRiskLevelChange = async (alert, newLevel) => {
    try {
      const res = await api.put(`/alerts/${alert.id}/analysis-override`, { risk_level: newLevel });
      const newScore = RISK_SCORE_BANDS[newLevel] ?? 0;
      const sentiment = riskToSentiment(newLevel, alert);
      const llmPatch = { score: newScore, ...(sentiment ? { sentiment, generic_sentiment: sentiment } : {}) };
      patchAlertLocally(alert.id, {
        risk_level: newLevel,
        threat_details: { risk_score: newScore },
        llm_analysis: llmPatch,
        content_details_patch: {
          risk_level: newLevel,
          analysis: { risk_level: newLevel, risk_score: newScore, ...(sentiment ? { sentiment } : {}), llm_analysis: llmPatch }
        }
      });
      toast.success(`Risk level updated to ${newLevel.toUpperCase()} (${newScore}%)`);
      fetchAlertStats();
      return res?.data;
    } catch (error) {
      console.error('Failed to update risk level:', error);
      toast.error(error?.response?.data?.message || 'Failed to update risk level');
      throw error;
    }
  };

  const handleSentimentChange = async (alert, newSentiment) => {
    try {
      await api.put(`/alerts/${alert.id}/analysis-override`, { sentiment: newSentiment });
      /**
       * Mirror the server-side cascade locally so the card updates immediately.
       * Sentiment is the post's RAW tone and risk follows it; the stance
       * (pro/anti client) is left as analysed.
       */
      const canonical = newSentiment === 'moderate' ? 'neutral' : newSentiment;
      // Neutral carries no risk: positive and neutral are both low. A negative
      // edit keeps an existing medium/high grade (as the server does).
      const keepGrade = canonical === 'negative' && ['medium', 'high', 'critical'].includes(alert.risk_level);
      const derivedRisk = canonical === 'negative' ? (keepGrade ? alert.risk_level : 'high') : 'low';
      const derivedScore = keepGrade ? RISK_SCORE_BANDS[derivedRisk] : canonical === 'negative' ? 75 : canonical === 'positive' ? 15 : 20;
      const llmPatch = {
        sentiment: canonical,
        generic_sentiment: canonical,
        score: derivedScore,
        needs_review: false,
      };
      patchAlertLocally(alert.id, {
        risk_level: derivedRisk,
        threat_details: { risk_score: derivedScore },
        llm_analysis: llmPatch,
        content_details_patch: {
          sentiment: canonical,
          risk_level: derivedRisk,
          analysis: {
            sentiment: canonical,
            risk_level: derivedRisk,
            risk_score: derivedScore,
            llm_analysis: llmPatch,
          }
        }
      });
      toast.success(`Sentiment updated to ${newSentiment.toUpperCase()}`);
    } catch (error) {
      console.error('Failed to update sentiment:', error);
      toast.error(error?.response?.data?.message || 'Failed to update sentiment');
      throw error;
    }
  };

  const handleDeleteAlert = async (alert) => {
    if (!window.confirm('Are you sure you want to permanently delete this alert?')) return;
    try {
      await api.delete(`/alerts/${alert.id}`);
      setAlerts(prev => prev.filter(a => a.id !== alert.id));
      setInvestigatedAlerts(prev => prev.filter(a => a.id !== alert.id));
      toast.success('Alert deleted');
      fetchAlertStats();
    } catch (error) {
      console.error('Failed to delete alert:', error);
      toast.error('Failed to delete alert');
    }
  };

  const handleInvestigate = async (url) => {
    if (!url.trim()) return;

    console.log('[Alerts] Investigating URL:', url);
    setIsInvestigating(true);
    try {
      console.log('[Alerts] POSTing to /alerts/investigate...');
      const response = await api.post('/alerts/investigate', { url });
      console.log('[Alerts] Investigation response:', response.data);
      const newAlert = response.data;

      setInvestigatedAlerts(prev => [newAlert, ...prev]);
      setSearchQuery(''); // Clear search after investigation
      toast.success('Investigation complete. Result added to the list.');

      // Clear frontend localStorage cache so refresh gets fresh data from DB
      try {
        localStorage.removeItem(ALERTS_CACHE_KEY);
      } catch (e) { /* ignore */ }

      // Re-fetch the main alerts list so the new alert appears in the regular list
      // This ensures it persists after page refresh (no longer depends on client state)
      setPage(1);
      setNextCursor(null);
      setHasMore(true);
      isFetchingRef.current = false; // Reset so fetchAlerts can run
      fetchAlerts(false);

      // Also refresh stats to update counts
      fetchAlertStats();

      // Scroll to top to see the new result
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('Investigation failed:', error);
      const serverMessage = error.response?.data?.message;
      const debugDetails = error.response?.data?.debug;

      const displayMessage = serverMessage
        ? `${serverMessage}${debugDetails ? ` (Debug: ${JSON.stringify(debugDetails)})` : ''}`
        : 'Failed to investigate link';

      toast.error(displayMessage);
    } finally {
      setIsInvestigating(false);
    }
  };

  // Filter investigated alerts based on current filters
  const filterInvestigatedAlerts = useCallback((alerts) => {
    return alerts.filter(alert => {
      // Platform filter
      if (platformFilter !== 'all' && alert.platform !== platformFilter) {
        return false;
      }

      // Search query filter (search in text, author, author_handle)
      if (debouncedSearchQuery) {
        const searchLower = debouncedSearchQuery.toLowerCase();
        const searchableFields = [
          alert.content_id?.text,
          alert.content_details?.text,
          alert.content_details?.translated_text,
          alert.content_details?.scraped_content,
          alert.content_details?.content_url,
          alert.author,
          alert.author_handle,
          alert.platform,
          alert.status,
          alert.risk_level,
          alert.source_category,
          alert.llm_analysis?.grievance_type,
          alert.source_meta?.name,
          alert.source_meta?.handle
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());

        if (!searchableFields.some((value) => value.includes(searchLower))) {
          return false;
        }
      }

      // Alert category filter (risk level or viral)
      if (alertCategory !== 'all') {
        if (alertCategory === 'viral') {
          // For viral, check if has high engagement metrics
          const isViral = alert.viral_score > 70 || alert.engagement_velocity > 100;
          if (!isViral) return false;
        } else if (alertCategory === 'critical') {
          const riskLevel = alert.risk_level?.toLowerCase() || alert.severity?.toLowerCase();
          if (riskLevel !== 'critical') return false;
        } else {
          /**
           * The Negative/Neutral/Positive pills send `sentiment` to the server
           * (SENTIMENT_BY_CATEGORY above). This client-side pass — which filters
           * the locally-held investigated results — used to compare `risk_level`
           * instead, so the same pill filtered two different fields on one
           * screen and locally-held rows were dropped or kept inconsistently.
           *
           * Both paths now resolve sentiment the same way.
           */
          const wanted = SENTIMENT_BY_CATEGORY[alertCategory];
          if (wanted && getAlertSentiment(alert, alert.content_details) !== wanted) {
            return false;
          }
        }
      }

      // Keyword filter
      if (keywordFilter !== 'all' && alert.matched_keywords) {
        const hasKeyword = alert.matched_keywords.some(k =>
          k.keyword_id === keywordFilter || k.keyword === keywordFilter
        );
        if (!hasKeyword) {
          return false;
        }
      }

      // Gate filter — always show only alerts with matched keywords
      if (!alert.matched_keywords || alert.matched_keywords.length === 0) {
        return false;
      }

      // No client-side date filter. The server already applied the range —
      // against `published_at`, the post's time on the platform — while this
      // re-filtered on `created_at`, when WE raised the alert. Two different
      // questions, so it silently dropped rows the server had correctly
      // included, and it repeated the same open-ended bug for a single day.

      const alertStatus = alert.status || 'active';
      if (!accessibleAlertStatuses.includes(alertStatus)) {
        return false;
      }

      // Topic Classification filter (grievance_type)
      if (topicClassificationFilter !== 'all') {
        const alertTopicCategory = alert.llm_analysis?.grievance_type ||
          alert.content_details?.analysis?.llm_analysis?.grievance_type ||
          '';
        // 'unclassified' is the bucket for alerts the classifier gave no usable
        // topic — it is not a stored value, so it cannot be compared by name.
        // Must agree with UNCLASSIFIED_TOPIC_VALUES in alertController.
        if (topicClassificationFilter === 'unclassified') {
          const t = alertTopicCategory.trim().toLowerCase();
          if (t && t !== 'normal' && t !== 'not a grievance') return false;
        } else if (alertTopicCategory.toLowerCase() !== topicClassificationFilter.toLowerCase()) {
          return false;
        }
      }

      return true;
    });
    // `dateRange` is deliberately absent: the server owns the date filter now,
    // so nothing in this callback reads it.
  }, [platformFilter, debouncedSearchQuery, alertCategory, keywordFilter, topicClassificationFilter, accessibleAlertStatuses]);


  const allFilteredAlerts = useMemo(() => {
    const filteredInvestigated = filterInvestigatedAlerts(investigatedAlerts);
    const filteredRegular = alerts.filter(a => !investigatedAlerts.some(inv => inv.id === a.id));

    const applyInstagramContentFilter = (items) => {
      if (platformFilter !== 'instagram') return items;
      return items.filter((item) => {
        const content =
          item?.content_details ||
          ((item?.content_id && typeof item.content_id === 'object') ? item.content_id : null) ||
          {};
        const contentType = String(content?.content_type || '').toLowerCase();
        const contentUrl = item?.content_url || content?.content_url || content?.url || '';
        const publishedAt = content?.published_at || item?.created_at || item?.timestamp;
        const isStory = contentType === 'story' || /instagram\.com\/stories\//i.test(contentUrl);
        const isReel = contentType === 'reel' || /instagram\.com\/(reel|reels)\//i.test(contentUrl);
        const isPost = contentType === 'post' || /instagram\.com\/p\//i.test(contentUrl);
        const isArchivedStory = isStory && /(amazonaws|s3|bhaskar-media-storage)/i.test(contentUrl);

        if (instagramContentFilter === 'stories_24h') {
          if (!isStory) return false;
          if (publishedAt) {
            const publishedTime = new Date(publishedAt).getTime();
            if (!Number.isNaN(publishedTime) && Date.now() - publishedTime > 24 * 60 * 60 * 1000) {
              return false;
            }
          }
          const isDeleted = content?.is_available === false || item?.is_available === false || content?.is_deleted === true;
          if (instagramStoriesStatusFilter === 'live') return !isDeleted;
          if (instagramStoriesStatusFilter === 'deleted') return isDeleted;
          return true;
        }

        if (instagramContentFilter === 'captured_stories') {
          if (!isArchivedStory) return false;
          if (!dateRange.start && !dateRange.end) return true;
          const publishedTime = publishedAt ? new Date(publishedAt).getTime() : null;
          if (!publishedTime || Number.isNaN(publishedTime)) return false;
          // Captured stories are held client-side, so this range really is
          // applied here rather than by the server — but through the SAME
          // local-day bounds the request uses (see dateRangeParams). A picked
          // day is a CLOSED range, and 'YYYY-MM-DD' means the user's local day,
          // not UTC midnight; reading it with `new Date(str)` made the end
          // bound land at the START of the day and hid almost everything.
          const from = parseDayParam(dateRange.start);
          const to = parseDayParam(dateRange.end) || from;
          const startTime = from ? startOfDay(from).getTime() : null;
          const endTime = to ? endOfDay(to).getTime() : null;
          if (startTime && publishedTime < startTime) return false;
          if (endTime && publishedTime > endTime) return false;
          return true;
        }

        // all_posts_reels
        return isPost || isReel || (!isStory && !isArchivedStory);
      });
    };

    const parseDateTime = (value) => {
      if (!value) return 0;
      if (value instanceof Date) {
        const t = value.getTime();
        return Number.isNaN(t) ? 0 : t;
      }
      if (typeof value === 'number') return value;
      const str = String(value).trim();
      if (!str) return 0;
      const direct = new Date(str).getTime();
      if (!Number.isNaN(direct)) return direct;

      const match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
      if (match) {
        let day = Number(match[1]);
        let month = Number(match[2]);
        let year = Number(match[3]);
        let hour = Number(match[4] || 0);
        const minute = Number(match[5] || 0);
        const second = Number(match[6] || 0);
        const meridiem = (match[7] || '').toUpperCase();
        if (year < 100) year += 2000;
        if (meridiem) {
          if (meridiem === 'PM' && hour < 12) hour += 12;
          if (meridiem === 'AM' && hour === 12) hour = 0;
        }
        const parsed = new Date(year, month - 1, day, hour, minute, second).getTime();
        return Number.isNaN(parsed) ? 0 : parsed;
      }
      return 0;
    };

    const getAlertTime = (item) => {
      const content = item?.content_details || item?.content_id || {};
      const published =
        content?.published_at ||
        content?.dateTime ||
        content?.created_at ||
        content?.timestamp;
      const fallback =
        item?.created_at ||
        item?.timestamp ||
        item?.updated_at;
      return parseDateTime(published || fallback);
    };

    const mapCapturedStoryToAlert = (story, index) => {
      const storyId = story?.id || story?.story_pk || `${story?.author_handle || 'unknown'}-${story?.published_at || story?.created_at || index}`;
      const publishedAt = story?.published_at || story?.created_at || story?.updated_at || new Date().toISOString();
      const mediaUrl = story?.s3_url || story?.original_url || story?.thumbnail_url || '';
      const previewUrl = story?.s3_thumbnail_url || story?.thumbnail_url || mediaUrl;
      const isVideo = String(story?.media_type || '').toLowerCase() === 'video' || Number(story?.media_type) === 2;
      const mediaType = isVideo ? 'video' : 'photo';

      return {
        id: `captured-story-${storyId}`,
        platform: 'instagram',
        status: 'active',
        /**
         * A captured story is an ARCHIVE ITEM — it never went through the
         * political-sentiment pipeline, so it has no verdict.
         *
         * This used to be hardcoded `risk_level: 'low'`, which the card then
         * rendered as a green "POSITIVE" badge: an unanalysed archive item
         * asserting it was good news for the client. 'medium' maps to the
         * honest "neutral/unknown" bucket instead.
         */
        risk_level: 'medium',
        alert_type: 'content',
        created_at: publishedAt,
        timestamp: publishedAt,
        content_url: mediaUrl || previewUrl || '',
        author: story?.author || story?.author_handle || 'Instagram User',
        author_handle: story?.author_handle || '',
        is_story_archive: true,
        is_available: story?.is_available,
        content_details: {
          id: storyId,
          platform: 'instagram',
          content_type: 'story',
          content_url: mediaUrl || previewUrl || '',
          text: story?.caption || '',
          author_handle: story?.author_handle || '',
          published_at: publishedAt,
          media: mediaUrl ? [{
            type: mediaType,
            media_type: mediaType,
            url: mediaUrl,
            preview: previewUrl,
            s3_url: story?.s3_url || undefined,
            s3_preview: story?.s3_thumbnail_url || undefined,
            video_versions: Array.isArray(story?.video_versions) ? story.video_versions : undefined
          }] : [],
          is_deleted: story?.is_available === false,
          is_available: story?.is_available,
          deleted_at: story?.deleted_at || null,
          is_archived: true,
          s3_url: story?.s3_url || null,
          s3_thumbnail_url: story?.s3_thumbnail_url || null
        },
        source_meta: {
          name: story?.author || story?.author_handle || 'Instagram User',
          handle: story?.author_handle || '',
          profile_image_url: story?.author_avatar || '',
          is_verified: false
        }
      };
    };

    if (isCapturedStoriesView) {
      // Same local-day, closed-range resolution as dateRangeParams — a picked
      // day means that whole day where the user is.
      const capturedFrom = parseDayParam(dateRange.start);
      const capturedTo = parseDayParam(dateRange.end) || capturedFrom;
      const startTime = capturedFrom ? startOfDay(capturedFrom).getTime() : null;
      const endTime = capturedTo ? endOfDay(capturedTo).getTime() : null;

      return capturedStories
        .filter((story) => {
          const hasS3Media = Boolean(story?.s3_url || story?.s3_thumbnail_url);
          if (!hasS3Media) return false;

          const storyTime = parseDateTime(story?.published_at || story?.created_at || story?.updated_at);
          if ((startTime || endTime) && !storyTime) return false;
          if (startTime && storyTime < startTime) return false;
          if (endTime && storyTime > endTime) return false;
          return true;
        })
        .map(mapCapturedStoryToAlert)
        .sort((a, b) => getAlertTime(b) - getAlertTime(a));
    }

    // Trust backend sort order (published_at: -1) — don't re-sort on frontend
    // This prevents visual reordering when data loads
    return applyInstagramContentFilter([
      ...filteredInvestigated,
      ...filteredRegular
    ]);
  }, [alerts, investigatedAlerts, filterInvestigatedAlerts, platformFilter, instagramContentFilter, instagramStoriesStatusFilter, dateRange.start, dateRange.end, capturedStories, isCapturedStoriesView]);

  const paginationTotal = isCapturedStoriesView ? allFilteredAlerts.length : totalResults;
  const paginatedAlerts = useMemo(() => {
    if (!isCapturedStoriesView) return allFilteredAlerts;
    const startIndex = (page - 1) * ALERTS_PAGE_SIZE;
    return allFilteredAlerts.slice(startIndex, startIndex + ALERTS_PAGE_SIZE);
  }, [allFilteredAlerts, isCapturedStoriesView, page]);

  // Detect if search query is a URL
  const isUrlQuery = (query) => {
    const urlPattern = /^(https?:\/\/)?(www\.)?(twitter\.com|x\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|whatsapp\.com)/i;
    return urlPattern.test(query.trim());
  };

  // Handle search input change with URL detection
  const handleSearchChange = (value) => {
    setSearchQuery(value);

    // Clear the highlighted target alert if they change the query
    setTargetAlertId(null);
  };

  // Handle search submit (Enter key or button click)
  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    if (searchQuery && isUrlQuery(searchQuery)) {
      handleInvestigate(searchQuery);
    }
  };

  const handleOpenAddSource = (data = null) => {
    setInitialSourceData(data);
    setSourceModalOpen(true);
  };

  const getRiskBadge = (level) => {
    const styles = {
      HIGH: 'bg-red-100 text-red-700 border-red-200',
      MEDIUM: 'bg-amber-100 text-amber-700 border-amber-200',
      high: 'bg-red-100 text-red-700 border-red-200',
      medium: 'bg-amber-100 text-amber-700 border-amber-200',
      critical: 'bg-red-100 text-red-700 border-red-200'
    };
    return styles[level] || 'bg-slate-100 text-slate-700 border-slate-200';
  };

  const getAlertTypeIcon = (type) => {
    switch (type) {
      case 'velocity':
        return <Zap className="h-4 w-4" />;
      case 'new_post':
        return <MessageSquare className="h-4 w-4" />;
      case 'ai_risk':
        return <Activity className="h-4 w-4" />;
      case 'content':
        return <LayoutList className="h-4 w-4" />;
      default:
        return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const getAlertTypeLabel = (type) => {
    switch (type) {
      case 'velocity':
        return 'Velocity';
      case 'new_post':
        return 'New Post';
      case 'ai_risk':
        return 'AI Risk';
      case 'content':
        return 'Post';
      default:
        return 'Risk';
    }
  };

  return (
    <>
      <div className="space-y-6 max-w-[1600px] mx-auto" data-testid="alerts-page">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex flex-col">
            <h1 className="text-3xl font-heading font-bold tracking-tight">Alerts Center</h1>
            <p className="text-sm text-muted-foreground mt-1">Monitor, triage, and respond to threat alerts in real-time</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="gap-2 shadow-sm h-9 px-3 text-xs border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-400"
              onClick={() => setFrequentEngagersOpen(true)}
            >
              <Users className="h-3.5 w-3.5" />
              Frequent Engagers
            </Button>
            <Button
              onClick={() => {
                setInitialSourceData(null);
                setSourceModalOpen(true);
              }}
              className="gap-2 shadow-sm"
            >
              <Plus className="h-4 w-4" />
              Add Resource
            </Button>
          </div>
        </div>

        {/* Search & Filters Row */}
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Unified Search Input */}
          <form onSubmit={handleSearchSubmit} className="relative w-full md:flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search alerts or paste URL to investigate..."
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pl-9 pr-28"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              disabled={isInvestigating}
            />
            {isInvestigating && (
              <div className="absolute right-2 top-1.5 flex items-center gap-2 px-3 py-1 bg-muted rounded-md text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Investigating...</span>
              </div>
            )}
            {searchQuery && isUrlQuery(searchQuery) && !isInvestigating && (
              <button
                type="submit"
                className="absolute right-2 top-1 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 shadow-sm flex items-center gap-1 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Investigate
              </button>
            )}
          </form>

          {/* Compact Filter Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger className="w-[130px] h-9 text-xs">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                <SelectItem value="x">Twitter (X)</SelectItem>
                <SelectItem value="youtube">YouTube</SelectItem>
                <SelectItem value="facebook">Facebook</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sourceCategoryFilter} onValueChange={setSourceCategoryFilter}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {sourceCategories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value} className="capitalize">
                    {cat.label} ({cat.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {riskParam && (
              <span className="inline-flex items-center gap-1 px-2 h-9 rounded-md bg-slate-100 text-slate-800 font-semibold text-[11px] capitalize">
                {riskParam} risk
                <button type="button" onClick={() => setRiskParam('')} className="ml-0.5 hover:opacity-70">&times;</button>
              </span>
            )}

            {leaderSeat && (
              <span className="inline-flex items-center gap-1 px-2 h-9 rounded-md bg-violet-100 text-violet-800 font-semibold text-[11px]">
                MLA of {leaderSeat}
                <button type="button" onClick={() => setLeaderSeat('')} className="ml-0.5 hover:opacity-70">&times;</button>
              </span>
            )}

            <Select value={stanceFilter} onValueChange={setStanceFilter}>
              <SelectTrigger className="w-[130px] h-9 text-xs">
                <SelectValue placeholder="Stance" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stances</SelectItem>
                <SelectItem value="supportive">Supportive</SelectItem>
                <SelectItem value="opposing">Opposing</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
              </SelectContent>
            </Select>

            <Select value={keywordFilter} onValueChange={setKeywordFilter}>
              <SelectTrigger className="w-[130px] h-9 text-xs">
                <SelectValue placeholder="Keyword" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Keywords</SelectItem>
                {availableKeywords.map((kw) => (
                  <SelectItem key={kw.keyword} value={kw.keyword}>
                    {kw.keyword} ({kw.count})
                  </SelectItem>
                ))}
                {/* A keyword carried in from a deep link that no longer matches
                    anything still needs an entry, or the Select shows a blank
                    trigger over a filtered-to-empty feed. */}
                {keywordFilter !== 'all'
                  && !availableKeywords.some((k) => k.keyword === keywordFilter) && (
                    <SelectItem value={keywordFilter}>{keywordFilter} (0)</SelectItem>
                  )}
              </SelectContent>
            </Select>

            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  title={describeDateSelection(pickedRange)}
                  className={`h-9 justify-start text-left font-normal text-xs gap-1.5 ${hasDateFilter
                    ? 'border-violet-400 bg-violet-50 text-violet-700 hover:bg-violet-100'
                    : 'w-[200px] text-muted-foreground'}`}
                >
                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                  <span>{formatDateRangeLabel(pickedRange) || 'Date range'}</span>
                  {hasDateFilter && (
                    // Clearing is the most repeated action here, so it does not
                    // require opening the popover first.
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Clear date filter"
                      className="ml-0.5 -mr-0.5 rounded-sm p-0.5 hover:bg-violet-200/70"
                      onClick={(e) => { e.stopPropagation(); applyDateRange(null, null); }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault(); e.stopPropagation(); applyDateRange(null, null);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <div className="flex">
                  {/* Presets — the common windows, one click each. */}
                  <div className="flex flex-col gap-0.5 border-r border-border p-2 w-36">
                    <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Quick ranges
                    </div>
                    {DATE_PRESETS.map((preset) => {
                      const isActive = activeDatePreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            const { from, to } = preset.range();
                            applyDateRange(from, to);
                            setDatePickerOpen(false);
                          }}
                          className={`rounded-md px-2 py-1.5 text-left text-xs transition-colors ${isActive
                            ? 'bg-violet-100 font-medium text-violet-700'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-col">
                    <div className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
                      Click one day to filter that day, or click a second to span a range.
                    </div>
                    <CalendarComponent
                      initialFocus
                      mode="range"
                      defaultMonth={pickedRange.from || new Date()}
                      selected={{ from: pickedRange.from || undefined, to: pickedRange.to || undefined }}
                      // Nothing is posted in the future; offering those cells
                      // only invites an empty result.
                      disabled={{ after: new Date() }}
                      onSelect={(range) => applyDateRange(range?.from, range?.to)}
                      numberOfMonths={2}
                    />
                    <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-2">
                      {/* Says in words exactly what will be matched, so a
                          one-day pick can't be misread as "from this date on". */}
                      <span className={`text-xs ${hasDateFilter ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {describeDateSelection(pickedRange)}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {hasDateFilter && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
                            onClick={() => applyDateRange(null, null)}>
                            Clear
                          </Button>
                        )}
                        <Button size="sm" className="h-7 text-xs" onClick={() => setDatePickerOpen(false)}>
                          Done
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Category Filter Bar */}
        <div className="border border-border bg-card rounded-md p-3 space-y-2.5">
          {!hasAnyAlertFeature && (
            <div className="px-1 text-sm text-muted-foreground">
              No alert features are assigned to your account.
            </div>
          )}

          {/* Category Quick Filters */}
          <div className="flex items-center gap-1.5 text-sm overflow-x-auto no-scrollbar">
            {[
              { value: 'all', label: 'All' },
              { value: 'high', label: 'Negative' },
              { value: 'medium', label: 'Neutral' },
              { value: 'low', label: 'Positive' },
              { value: 'viral', label: 'Viral' }
            ].map((cat) => (
              <button
                key={cat.value}
                onClick={() => setAlertCategory(cat.value)}
                className={`px-3 py-1 font-medium transition-all rounded-full text-xs ${alertCategory === cat.value
                  ? 'bg-secondary text-secondary-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Topic Classification Filters */}
          {topicCounts.length > 0 && (
            <>
              <div className="border-t border-border/50" />
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
                  <Tag className="h-3 w-3" />
                  <span>Topic Classification</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm overflow-x-auto no-scrollbar">
                  <button
                    onClick={() => setTopicClassificationFilter('all')}
                    className={`px-3 py-1 font-medium transition-all rounded-full text-xs whitespace-nowrap ${topicClassificationFilter === 'all'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                      }`}
                  >
                    All Topics
                    <span className={`ml-1 text-[10px] ${topicClassificationFilter === 'all' ? 'text-white/80' : 'text-muted-foreground/70'}`}>
                      ({topicTotal ?? topicCounts.reduce((sum, t) => sum + t.count, 0)})
                    </span>
                  </button>
                  {topicUnclassified > 0 && (
                    <button
                      onClick={() => setTopicClassificationFilter(
                        topicClassificationFilter === 'unclassified' ? 'all' : 'unclassified'
                      )}
                      title="Alerts the classifier gave no usable topic"
                      className={`px-3 py-1 font-medium transition-all rounded-full text-xs whitespace-nowrap ${topicClassificationFilter === 'unclassified'
                        ? 'bg-slate-600 text-white shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                        }`}
                    >
                      Normal
                      <span className={`ml-1 text-[10px] ${topicClassificationFilter === 'unclassified' ? 'text-white/80' : 'text-muted-foreground/70'}`}>
                        ({topicUnclassified})
                      </span>
                    </button>
                  )}
                  {topicCounts.map((topic) => (
                    <button
                      key={topic.topic}
                      onClick={() => setTopicClassificationFilter(
                        topicClassificationFilter === topic.topic ? 'all' : topic.topic
                      )}
                      className={`px-3 py-1 font-medium transition-all rounded-full text-xs whitespace-nowrap flex items-center gap-1.5 ${topicClassificationFilter === topic.topic
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent hover:border-border'
                        }`}
                    >
                      {topic.topic}
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${topicClassificationFilter === topic.topic
                        ? 'bg-white/20 text-white'
                        : 'bg-muted text-muted-foreground'
                        }`}>
                        {topic.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {platformFilter === 'instagram' && (
            <div className="flex items-center gap-1.5 text-sm overflow-x-auto no-scrollbar pt-1">
              {[
                { value: 'all_posts_reels', label: 'All Posts & Reels' },
                { value: 'stories_24h', label: 'Stories (Last 24 hrs)' },
                { value: 'captured_stories', label: 'Captured Stories' }
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setInstagramContentFilter(opt.value)}
                  className={`px-3 py-1 font-medium transition-all rounded-full text-xs ${instagramContentFilter === opt.value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
              {instagramContentFilter === 'stories_24h' && (
                <div className="ml-2">
                  <Select value={instagramStoriesStatusFilter} onValueChange={setInstagramStoriesStatusFilter}>
                    <SelectTrigger className="h-8 w-[150px] text-xs">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="live">Live</SelectItem>
                      <SelectItem value="deleted">Deleted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {instagramContentFilter === 'captured_stories' && (
                <div className="ml-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        title={describeDateSelection(pickedRange)}
                        className={`h-8 justify-start text-left font-normal text-xs gap-1.5 ${hasDateFilter
                          ? 'border-violet-400 bg-violet-50 text-violet-700 hover:bg-violet-100'
                          : 'w-[190px] text-muted-foreground'}`}
                      >
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        <span>{formatDateRangeLabel(pickedRange) || 'Captured date'}</span>
                        {hasDateFilter && (
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label="Clear date filter"
                            className="ml-0.5 -mr-0.5 rounded-sm p-0.5 hover:bg-violet-200/70"
                            onClick={(e) => { e.stopPropagation(); applyDateRange(null, null); }}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter' && e.key !== ' ') return;
                              e.preventDefault(); e.stopPropagation(); applyDateRange(null, null);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <div className="flex flex-col">
                        <div className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
                          Click one day to filter that day, or click a second to span a range.
                        </div>
                        <CalendarComponent
                          initialFocus
                          mode="range"
                          defaultMonth={pickedRange.from || new Date()}
                          selected={{ from: pickedRange.from || undefined, to: pickedRange.to || undefined }}
                          disabled={{ after: new Date() }}
                          onSelect={(range) => applyDateRange(range?.from, range?.to)}
                          numberOfMonths={2}
                        />
                        <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-2">
                          <span className={`text-xs ${hasDateFilter ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {describeDateSelection(pickedRange)}
                          </span>
                          {hasDateFilter && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground shrink-0"
                              onClick={() => applyDateRange(null, null)}>
                              Clear
                            </Button>
                          )}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div>
          <>
            {/* New Alert / Scroll Top Button */}
            {(newAlertCount > 0 || (typeof window !== 'undefined' && window.scrollY > 300)) && (
              <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4">
                <button
                  onClick={scrollToTop}
                  className={`shadow-lg flex items-center gap-2 rounded-md px-4 py-2.5 font-medium text-sm transition-all hover:scale-105 ${newAlertCount > 0
                    ? 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/30'
                    : 'bg-card hover:bg-accent text-foreground border border-border'
                    }`}
                >
                  <ArrowUpCircle className="h-5 w-5" />
                  {newAlertCount > 0 ? (
                    <span>{newAlertCount} New Alerts</span>
                  ) : null}
                </button>
              </div>
            )}

            {/* View Toggle Commented Out
              <div className="flex justify-end mb-4">
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-1.5 rounded-md transition-all ${viewMode === 'grid'
                      ? 'bg-white dark:bg-slate-600 shadow-sm text-blue-600 dark:text-blue-400'
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                      }`}
                    title="Grid View"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-1.5 rounded-md transition-all ${viewMode === 'list'
                      ? 'bg-white dark:bg-slate-600 shadow-sm text-blue-600 dark:text-blue-400'
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                      }`}
                    title="List View"
                  >
                    <LayoutList className="h-4 w-4" />
                  </button>
                </div>
              </div>
              */}

            {searchQuery.trim() && (
              <div className="mb-4 text-xs text-muted-foreground flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span>Found <strong className="text-foreground">{paginationTotal}</strong> results matching "<strong className="text-foreground">{searchQuery}</strong>"</span>
                  <span className="text-[11px]">Sorted: Latest first</span>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-4 text-xs text-destructive">{error}</div>
            )}

            {(() => {
              // Show loading spinner on initial load with no alerts yet
              if (loading && allFilteredAlerts.length === 0) {
                return (
                  <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="flex flex-col items-center gap-4">
                      <div className="relative w-16 h-16">
                        <div className="absolute inset-0 rounded-full border-4 border-muted animate-spin border-t-primary"></div>
                      </div>
                      <p className="text-sm font-medium text-muted-foreground">Loading alerts...</p>
                    </div>
                  </div>
                );
              }

              if (!loading && !capturedStoriesLoading && !isFetchingRef.current && allFilteredAlerts.length === 0) {
                return (
                  <Card className="p-12 text-center border border-border rounded-md" data-testid="no-alerts">
                    <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground mb-2">No alerts found matching your criteria.</p>
                    <Button
                      variant="link"
                      className="text-xs"
                      onClick={() => {
                        setSearchQuery('');
                        setPlatformFilter('all');
                        setKeywordFilter('all');
                        setAlertCategory('all');
                        setSourceCategoryFilter('all');
                    setStanceFilter('all');
                        setTopicClassificationFilter('all');
                      }}
                    >
                      Clear All Filters
                    </Button>
                  </Card>
                );
              }

              return (
                <div className="relative flex flex-col lg:flex-row gap-8 items-start">
                  {/* Refresh overlay — shows when filter changes reload alerts */}
                  {isRefreshing && !isFirstLoadRef.current && (
                    <div className="absolute inset-0 z-20 flex items-start justify-center pt-32 bg-background/60 backdrop-blur-[1px] rounded-md pointer-events-none">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <span className="text-xs font-medium text-muted-foreground">Loading alerts…</span>
                      </div>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-muted-foreground">
                        Showing <strong className="text-foreground">{paginatedAlerts.length}</strong>
                        {' '}of <strong className="text-foreground">{paginationTotal}</strong> alerts
                      </p>
                      <p className="text-[11px] text-muted-foreground">Sorted by post time (latest first)</p>
                    </div>

                    <div className="columns-1 gap-6 md:columns-2 xl:columns-3 [column-fill:_balance]">
                      {paginatedAlerts.map((alert, index) => {
                        const isYoutube = alert?.platform === 'youtube';
                        const isStoryArchiveCard = Boolean(alert?.is_story_archive);

                        const contentData =
                          alert?.content_details ||
                          ((alert?.content_id && typeof alert.content_id === 'object') ? alert.content_id : null) ||
                          {};

                        const sourceData =
                          alert?.source_meta ||
                          alert?.source_details ||
                          alert?.source ||
                          (alert?.author ? { name: alert.author } : null);

                        return (
                          <div
                            key={alert?.id || index}
                            className="group relative mb-6 break-inside-avoid"
                            data-testid={`alert-item-${index}`}
                          >
                            {isYoutube ? (
                              <YoutubeAlertCard
                                alert={alert}
                                content={contentData}
                                source={sourceData}
                                onResolve={handleAlertResolve}
                                onRiskLevelChange={canEditAlerts ? handleRiskLevelChange : undefined}
                                onSentimentChange={canEditAlerts ? handleSentimentChange : undefined}
                                onDelete={canEditAlerts ? handleDeleteAlert : undefined}
                                viewMode="grid"
                                hideActions={isStoryArchiveCard}
                                report={reportsMap[alert?.id]}
                                onAddSource={handleOpenAddSource}
                                isInvestigatedResult={alert?.is_investigation}
                              />
                            ) : (
                              <TwitterAlertCard
                                alert={alert}
                                content={contentData}
                                source={sourceData}
                                onResolve={handleAlertResolve}
                                onRiskLevelChange={canEditAlerts ? handleRiskLevelChange : undefined}
                                onSentimentChange={canEditAlerts ? handleSentimentChange : undefined}
                                onDelete={canEditAlerts ? handleDeleteAlert : undefined}
                                viewMode="grid"
                                hideActions={isStoryArchiveCard}
                                searchQuery={searchQuery}
                                monitoredHandles={monitoredHandles}
                                report={reportsMap[alert?.id]}
                                onAddSource={handleOpenAddSource}
                                isInvestigatedResult={alert?.is_investigation}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Pagination loading indicator */}
                    {!isCapturedStoriesView && isFetchingMore && (
                      <div className="mt-6 flex justify-center">
                        <div className="flex items-center gap-2">
                          <div className="relative w-5 h-5">
                            <div className="absolute inset-0 rounded-full border-2 border-muted animate-spin border-t-primary"></div>
                          </div>
                          <p className="text-xs text-muted-foreground">Loading more...</p>
                        </div>
                      </div>
                    )}

                    {/* Infinite-scroll sentinel — advances page when visible */}
                    {!isCapturedStoriesView && (
                      <div ref={loadMoreSentinelRef} className="h-4 w-full" aria-hidden="true" />
                    )}
                    {!isCapturedStoriesView && !hasMore && paginatedAlerts.length > 0 && (
                      <p className="mt-6 text-center text-xs text-muted-foreground">
                        You've reached the end · {paginationTotal} alert{paginationTotal === 1 ? '' : 's'} total
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
          </>
        </div>
      </div>

      {/* New Alerts Button */}
      {newAlertCount > 0 && (
        <button
          onClick={mergePendingAlerts}
          className="fixed bottom-8 right-8 z-50 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg shadow-lg hover:bg-blue-700 transition-colors font-medium text-sm"
        >
          <span>↑ {newAlertCount} New Alert{newAlertCount === 1 ? '' : 's'}</span>
        </button>
      )}

      <AddSourceModal
        open={sourceModalOpen}
        onClose={() => setSourceModalOpen(false)}
        initialData={initialSourceData}
        onSuccess={async (createdSource) => {
          toast.success('Monitoring started for this profile');

          const newHandle = createdSource?.identifier || initialSourceData?.identifier;
          if (newHandle) {
            setMonitoredHandles(prev => [...prev, newHandle]);
          }

          // Update all alerts from this profile to mark as monitored (both investigated and regular)
          if (initialSourceData || createdSource) {
            const platform = createdSource?.platform || initialSourceData?.platform;
            const identifier = createdSource?.identifier || initialSourceData?.identifier;
            const displayName = createdSource?.display_name || initialSourceData?.display_name;

            const updateMonitoredStatus = (alert) => {
              const matchesPlatform = alert.platform === platform;
              const matchesIdentifier = alert.author_handle === identifier;
              const matchesDisplayName = alert.author === displayName;

              return (matchesPlatform && matchesIdentifier) || (matchesPlatform && matchesDisplayName)
                ? { ...alert, is_monitored: true, source_id: createdSource?.id || null }
                : alert;
            };

            setInvestigatedAlerts(prev => prev.map(updateMonitoredStatus));
            setAlerts(prev => prev.map(updateMonitoredStatus));

            // Update backend alerts to link them to the source
            try {
              const alertsToUpdate = [...investigatedAlerts, ...alerts].filter(alert => {
                const matchesPlatform = alert.platform === platform;
                const matchesIdentifier = alert.author_handle === identifier;
                const matchesDisplayName = alert.author === displayName;
                return (matchesPlatform && matchesIdentifier) || (matchesPlatform && matchesDisplayName);
              });

              // Update each alert with source_id
              for (const alert of alertsToUpdate) {
                try {
                  api.put(`/alerts/${alert.id}`, { source_id: createdSource?.id || null }).catch(err => {
                    console.error(`Failed to link alert ${alert.id} to source:`, err);
                  });
                } catch (error) {
                  console.error(`Failed to link alert ${alert.id} to source:`, error);
                }
              }
            } catch (error) {
              console.error('Failed to update alerts with source_id:', error);
            }
          }
        }}

      />
      <FrequentEngagersDialog
        open={frequentEngagersOpen}
        onOpenChange={setFrequentEngagersOpen}
        onAddSource={handleOpenAddSource}
        monitoredHandles={monitoredHandles}
      />
    </>
  );
};

export default Alerts;
