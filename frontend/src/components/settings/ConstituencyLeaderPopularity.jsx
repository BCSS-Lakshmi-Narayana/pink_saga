import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../lib/api';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { ScrollArea } from '../ui/scroll-area';
import { RefreshCw, Search, TrendingUp, ThumbsUp, ThumbsDown, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Constituency Leader Popularity — per Telangana seat, who is being discussed and
 * whether that discussion helps or hurts them, across Mentions, Alerts and
 * RSS/News. Backs onto GET /constituency-intel/leader-popularity (list) and
 * .../leader-popularity/posts (drill-down).
 *
 * Sentiment shown here is PERSON-relative, not client-relative — the backend
 * flips it for opposition figures (see leaderPopularityController.js). The
 * banner below states this explicitly, same as the API response's own
 * `sentiment_basis` field, so nobody reads a "Negative" badge under an opposition
 * leader's name (e.g. Revanth Reddy) as bad news for BRS.
 */

const ALIGNMENT_STYLE = {
  ally: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  opposition: 'bg-red-50 text-red-700 border-red-200',
  neutral: 'bg-slate-50 text-slate-600 border-slate-200',
  unknown: 'bg-slate-50 text-slate-500 border-slate-200',
};

const SORT_OPTIONS = [
  { value: 'most_discussed', label: 'Most discussed' },
  { value: 'most_negative', label: 'Most negative' },
  { value: 'alphabetical', label: 'A–Z' },
];

const MIN_MENTIONS_OPTIONS = [1, 3, 5, 10, 20];

const LeaderBar = ({ leader }) => {
  const total = Math.max(leader.total, 1);
  const posPct = (leader.positive / total) * 100;
  const modPct = ((leader.neutral ?? leader.moderate ?? 0) / total) * 100;
  const negPct = (leader.negative / total) * 100;
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden bg-slate-100 flex">
      <div className="h-full bg-emerald-500" style={{ width: `${posPct}%` }} />
      <div className="h-full bg-amber-400" style={{ width: `${modPct}%` }} />
      <div className="h-full bg-red-500" style={{ width: `${negPct}%` }} />
    </div>
  );
};

const LeaderRow = ({ leader, onOpen }) => (
  <button
    type="button"
    onClick={() => onOpen(leader)}
    className="w-full text-left rounded-md px-2 py-2 hover:bg-slate-50 transition-colors border-b last:border-b-0"
  >
    <div className="flex items-center gap-2 mb-1">
      <span className="text-xs font-medium truncate">{leader.name}</span>
      <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 uppercase', ALIGNMENT_STYLE[leader.alignment] || ALIGNMENT_STYLE.unknown)}>
        {leader.alignment}
      </Badge>
      {leader.high_neg && (
        <Badge variant="outline" className="text-[9px] px-1.5 py-0 uppercase bg-red-100 text-red-700 border-red-300">
          High neg
        </Badge>
      )}
    </div>
    <LeaderBar leader={leader} />
    <div className="mt-1 grid grid-cols-5 gap-1 text-[10px] text-muted-foreground">
      <div><span className="font-semibold text-foreground">{leader.total}</span> total</div>
      <div className="text-emerald-600"><span className="font-semibold">{leader.positive}</span> pos</div>
      <div className="text-red-600"><span className="font-semibold">{leader.negative}</span> neg</div>
      <div className="text-slate-600"><span className="font-semibold">{leader.neutral ?? leader.moderate}</span> neu</div>
      <div><span className="font-semibold text-foreground">{leader.neg_pct}%</span> neg%</div>
    </div>
  </button>
);

const ConstituencyCard = ({ seat, onOpenLeader }) => (
  <Card className="p-3 flex flex-col">
    <div className="flex items-start justify-between mb-2">
      <div>
        <h3 className="text-sm font-semibold">{seat.constituency}</h3>
        <p className="text-[11px] text-muted-foreground">{seat.total_mentions} mentions · {seat.leader_count} leaders</p>
      </div>
    </div>
    <div className="flex flex-wrap gap-1.5 mb-2">
      {seat.top && (
        <Badge variant="outline" className="text-[9px] px-1.5 py-0.5 gap-1">
          <TrendingUp className="h-2.5 w-2.5" /> Top {seat.top.name} {seat.top.total}
        </Badge>
      )}
      {seat.best && (
        <Badge variant="outline" className="text-[9px] px-1.5 py-0.5 gap-1 bg-emerald-50 text-emerald-700 border-emerald-200">
          <ThumbsUp className="h-2.5 w-2.5" /> Best {seat.best.name} {seat.best.neg_pct}%
        </Badge>
      )}
      {seat.worst && (
        <Badge variant="outline" className="text-[9px] px-1.5 py-0.5 gap-1 bg-red-50 text-red-700 border-red-200">
          <ThumbsDown className="h-2.5 w-2.5" /> Worst {seat.worst.name} {seat.worst.neg_pct}%
        </Badge>
      )}
    </div>
    <ScrollArea className="max-h-72">
      {seat.leaders.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No leader clears the minimum mention count for this seat.</p>
      ) : (
        seat.leaders.map((l) => <LeaderRow key={l.key || l.name} leader={l} onOpen={(leader) => onOpenLeader(seat.constituency, leader)} />)
      )}
    </ScrollArea>
  </Card>
);

const SENTIMENT_PILL = {
  positive: 'bg-emerald-100 text-emerald-800',
  negative: 'bg-red-100 text-red-800',
  neutral: 'bg-slate-100 text-slate-700',
  moderate: 'bg-slate-100 text-slate-700', // retired name
};

const PostRow = ({ post }) => (
  <div className="border-b last:border-b-0 py-2 px-1">
    <div className="flex items-center gap-2 mb-1 text-[10px] text-muted-foreground">
      <span className={cn('px-1.5 py-0.5 rounded font-semibold uppercase', SENTIMENT_PILL[post.sentiment] || 'bg-slate-100 text-slate-700')}>
        {post.sentiment || 'unknown'}
      </span>
      <span className="uppercase">{post.surface}</span>
      {post.platform && <span>· {post.platform}</span>}
      <span>· {post.date ? new Date(post.date).toLocaleDateString() : ''}</span>
      {post.url && (
        <a href={post.url} target="_blank" rel="noreferrer" className="ml-auto text-primary flex items-center gap-0.5">
          Open <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
    </div>
    <p className="text-xs line-clamp-3">{post.text || '(no text)'}</p>
  </div>
);

const LeaderDrilldown = ({ constituency, leader, minMentions, days, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!leader) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get('/constituency-intel/leader-popularity/posts', {
      params: {
        constituency,
        entity_key: leader.key || undefined,
        entity_name: leader.key ? undefined : leader.name,
        page,
        limit: 20,
        ...(days ? { days } : {}),
      },
    })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err?.response?.data?.message || 'Could not load posts for this leader.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [constituency, leader, page, days]);

  return (
    <Dialog open={!!leader} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{leader?.name}</DialogTitle>
          <DialogDescription>{constituency} · sentiment shown is relative to {leader?.name}, not the client</DialogDescription>
        </DialogHeader>
        {loading && <p className="text-xs text-muted-foreground py-6 text-center">Loading…</p>}
        {!loading && error && <p className="text-xs text-red-600 py-6 text-center">{error}</p>}
        {!loading && !error && data && (
          <>
            <p className="text-[11px] text-muted-foreground">{data.total} total posts{data.browsable < data.total ? ` (browsing the most recent ${data.browsable})` : ''}</p>
            <ScrollArea className="flex-1 -mx-1 px-1">
              {data.posts.length === 0
                ? <p className="text-xs text-muted-foreground py-6 text-center">No posts found.</p>
                : data.posts.map((p) => <PostRow key={`${p.surface}:${p.id}`} post={p} />)}
            </ScrollArea>
            <div className="flex items-center justify-between pt-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-[11px] text-muted-foreground">Page {data.page}</span>
              <Button size="sm" variant="outline" disabled={!data.has_more} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const errorCopy = (err) => {
  const status = err?.response?.status;
  if (status === 401 || status === 403) return 'You do not have access to Constituency Leader Popularity — ask an administrator for the Geographic Intelligence permission.';
  if (status === 404) return 'This endpoint was not found — the backend may need a restart after the latest deploy.';
  if (err?.code === 'ECONNABORTED') return 'The request timed out — try a higher minimum mention count to shrink the result.';
  return err?.response?.data?.message || 'Failed to load constituency leader popularity.';
};

const ConstituencyLeaderPopularity = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);
  const [search, setSearch] = useState('');
  const [constituency, setConstituency] = useState('all');
  const [sort, setSort] = useState('most_discussed');
  const [minMentions, setMinMentions] = useState(3);
  const [days, setDays] = useState('');
  const [drilldown, setDrilldown] = useState(null); // { constituency, leader }

  const fetchData = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/constituency-intel/leader-popularity', {
      params: {
        search: search || undefined,
        constituency,
        sort,
        min_mentions: minMentions,
        ...(days ? { days } : {}),
      },
    })
      .then((res) => setPayload(res.data))
      .catch((err) => setError(errorCopy(err)))
      .finally(() => setLoading(false));
  }, [search, constituency, sort, minMentions, days]);

  useEffect(() => {
    // One debounce for every filter, including free-text search — a single
    // effect keeps the initial mount to exactly one request instead of two
    // (a filter-change effect firing immediately alongside a search effect).
    const t = setTimeout(fetchData, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, constituency, sort, minMentions, days]);

  const constituencyOptions = useMemo(() => {
    if (!payload) return [];
    return payload.constituencies.map((c) => c.constituency).sort();
  }, [payload]);

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search a leader or seat…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Select value={constituency} onValueChange={setConstituency}>
            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="All constituencies" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All constituencies</SelectItem>
              {constituencyOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(minMentions)} onValueChange={(v) => setMinMentions(Number(v))}>
            <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MIN_MENTIONS_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>Min {n} mention{n > 1 ? 's' : ''}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={fetchData} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
          </Button>
          {payload && (
            <span className="text-[11px] text-muted-foreground ml-auto whitespace-nowrap">
              {payload.total_placed_mentions.toLocaleString()} placed mentions
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Sentiment is shown <strong>relative to each leader</strong>. Stored verdicts are client-relative, so a post
          attacking an opposition figure is flipped to count as negative <em>for them</em> rather than positive for
          the client. Only posts with a detected constituency are counted.
        </p>
      </Card>

      {loading && !payload && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <Card key={i} className="p-3 h-64 animate-pulse bg-slate-50" />
          ))}
        </div>
      )}

      {!loading && error && (
        <Card className="p-6 text-center">
          <p className="text-sm text-red-600 mb-2">{error}</p>
          <Button size="sm" variant="outline" onClick={fetchData}>Try again</Button>
        </Card>
      )}

      {!error && payload && payload.constituencies.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No constituencies match this filter yet — try lowering the minimum mention count.
        </Card>
      )}

      {!error && payload && payload.constituencies.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {payload.constituencies.map((seat) => (
            <ConstituencyCard
              key={seat.constituency}
              seat={seat}
              onOpenLeader={(seatName, leader) => setDrilldown({ constituency: seatName, leader })}
            />
          ))}
        </div>
      )}

      <LeaderDrilldown
        constituency={drilldown?.constituency}
        leader={drilldown?.leader}
        minMentions={minMentions}
        days={days}
        onClose={() => setDrilldown(null)}
      />
    </div>
  );
};

export default ConstituencyLeaderPopularity;
