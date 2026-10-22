import React, { useEffect, useState } from 'react';
import {
  Scale, ScrollText, Landmark, MessageSquare, ThumbsUp, Megaphone, ChevronDown, ChevronRight, ArrowRight, Info,
} from 'lucide-react';
import api from '../../lib/api';
import { platformMeta } from '../geographic/platformScale';
import { Card, Pill, Kpi } from '../brief/BriefParts';

/*
 * Manifesto tracker (client requirement 3) — the third tab of the Intelligence
 * Brief, built from the Brief's own cards so the tabs read as one page.
 *
 *   "Election manifesto: status of promised schemes, people reach, people sentiments"
 *
 *   Head to head    each of our schemes beside the one that replaced it
 *   Their promises  the governing party's 2023 promises
 *   Our schemes     the schemes our party built in government
 *
 * Per scheme: STATUS = what the public and press report about it reaching them
 * (a verdict only with enough reports), SENTIMENT = whom the discussion
 * favours, REACH = posts, accounts and engagement (GET /api/manifesto/overview).
 */

// Report types — a palette checked for colour-blind separation and contrast; always shown with labels.
const REPORTS = [
  { id: 'not_received', label: 'Not received', color: '#dc5a14', tone: 'negative' },
  { id: 'delayed', label: 'Delayed', color: '#9333ea', tone: 'neutral' },
  { id: 'reduced', label: 'Less than promised', color: '#a16207', tone: 'neutral' },
  { id: 'stopped', label: 'Stopped', color: '#be185d', tone: 'negative' },
  { id: 'received', label: 'Received', color: '#2563eb', tone: 'positive' },
];
const REPORT = Object.fromEntries(REPORTS.map((r) => [r.id, r]));
// The Brief's supportive / opposing colours.
const OURS = '#15803d';
const GOVT = '#ef4444';

const n = (v) => Number(v || 0).toLocaleString('en-IN');
const fmtNet = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`);
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : null);
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');

/* One request per window, kept for the session and keyed by login (scope differs by user). */
const CLIENT_TTL_MS = 10 * 60 * 1000;
const windowCache = new Map();
const fetchWindow = (days) => {
  let who = '';
  try { who = localStorage.getItem('token') || ''; } catch { /* storage blocked */ }
  const key = `${who.slice(-16)}:${days}`;
  const hit = windowCache.get(key);
  if (hit && Date.now() - hit.at < CLIENT_TTL_MS) return hit.promise;
  const promise = api.get('/manifesto/overview', { params: { days } }).then((r) => r.data);
  windowCache.set(key, { at: Date.now(), promise });
  promise.catch(() => windowCache.delete(key));
  return promise;
};

/* ── pieces ─────────────────────────────────────────────────────────────── */

/** The public's verdict, or how many reports are still needed for one. */
const Verdict = ({ status }) => (status.verdict
  ? <Pill tone={REPORT[status.verdict.claim].tone}>{status.verdict.text}</Pill>
  : <Pill tone="muted">{status.total ? `${status.total} of ${status.min_reports} reports` : 'No reports yet'}</Pill>);

/** What people report, split by type; counts written out so colour is never alone. */
const ReportBar = ({ status, compact = false }) => {
  const total = status.total;
  if (!total) return compact ? null : <div className="text-[11.5px] text-slate-400">Nobody has reported on it reaching them yet</div>;
  return (
    <div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100 gap-px">
        {REPORTS.map((r) => (status.reports[r.id]
          ? <div key={r.id} style={{ width: `${(status.reports[r.id] / total) * 100}%`, background: r.color }} />
          : null))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2.5 text-[11px] text-slate-600 tabular-nums">
        {REPORTS.filter((r) => status.reports[r.id]).map((r) => (
          <span key={r.id} className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.color }} />{r.label} {status.reports[r.id]}
          </span>
        ))}
      </div>
    </div>
  );
};

/** Whom the discussion favours: our party (green) or the government (red), with the counts. */
const FavourBar = ({ s }) => {
  const total = s.favours_ours + s.favours_govt;
  return (
    <div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100 gap-px">
        {total > 0 && <>
          <div style={{ width: `${(s.favours_ours / total) * 100}%`, background: OURS }} />
          <div style={{ width: `${(s.favours_govt / total) * 100}%`, background: GOVT }} />
        </>}
      </div>
      <div className="mt-1 text-[11px] tabular-nums text-slate-500">
        {total ? <><span className="text-emerald-700 font-medium">{s.favours_ours} us</span> · <span className="text-rose-600 font-medium">{s.favours_govt} govt</span></> : 'No one took a side'}
      </div>
    </div>
  );
};

const NetFigure = ({ v }) => (
  <span className={`text-[15px] font-bold tabular-nums ${v == null ? 'text-slate-300' : v > 0 ? 'text-emerald-700' : v < 0 ? 'text-rose-600' : 'text-slate-600'}`}>{fmtNet(v)}</span>
);

/* ── head to head ───────────────────────────────────────────────────────── */

const Side = ({ tag, s }) => (
  <div className="min-w-0 space-y-2">
    <div className="text-[10.5px] uppercase tracking-wide text-slate-400">{tag}</div>
    <div className="text-[14px] font-semibold text-slate-900 truncate" title={s.name}>{s.name}</div>
    <Verdict status={s.status} />
    <ReportBar status={s.status} compact />
    <FavourBar s={s.sentiment} />
    <div className="text-[11px] text-slate-400 tabular-nums">{n(s.reach.posts)} posts · {n(s.reach.accounts)} accounts</div>
  </div>
);

function HeadToHead({ pairs }) {
  return (
    <Card Icon={Scale} title="Head to head — our scheme and what replaced it">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {pairs.map(({ ours, theirs }) => (
          <div key={ours.id} className="rounded-lg border border-slate-200 p-3.5">
            <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
              <Side tag="Ours" s={ours} />
              <ArrowRight className="h-4 w-4 text-slate-300 mt-6" />
              <Side tag="Now" s={theirs} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── scheme list ────────────────────────────────────────────────────────── */

function SchemeRow({ s }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full grid grid-cols-12 gap-3 items-center px-1 py-3 text-left hover:bg-slate-50/70 rounded-md">
        <div className="col-span-12 md:col-span-4 flex items-start gap-2 min-w-0">
          <Chevron className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-slate-900 truncate">{s.name}</div>
            <div className="text-[11.5px] text-slate-500 truncate" title={s.promise}>{s.promise}</div>
          </div>
        </div>
        <div className="col-span-6 md:col-span-3 space-y-1.5"><Verdict status={s.status} /><ReportBar status={s.status} compact /></div>
        <div className="col-span-4 md:col-span-3"><FavourBar s={s.sentiment} /></div>
        <div className="col-span-2 md:col-span-2 text-right">
          <div className="text-[15px] font-bold text-slate-900 tabular-nums">{n(s.reach.posts)}</div>
          <div className="text-[11px] text-slate-400">posts</div>
        </div>
      </button>
      {open && (
        <div className="px-7 pb-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-3">
            <div>
              <div className="text-[11px] font-medium text-slate-500 mb-1">What people report</div>
              <ReportBar status={s.status} />
              {s.status.previous && <div className="text-[11px] text-slate-400 mt-1">Previous period: {s.status.previous.text} ({s.status.previous.total} reports)</div>}
            </div>
            <div className="text-[11.5px] text-slate-600 tabular-nums">
              {n(s.reach.accounts)} accounts · {n(s.reach.engagement)} engagements{s.reach.top_platform ? ` · mostly on ${platformMeta(s.reach.top_platform).label}` : ''}
            </div>
            {!!s.reach.figures.length && (
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1">Figures people quote (claims)</div>
                {s.reach.figures.slice(0, 3).map((f, i) => (
                  <div key={`${f.url}-${i}`} className="text-[11.5px] text-slate-700">
                    <span className="font-semibold">{f.figure}</span>
                    <span className="text-slate-400"> · {f.source_type} · {fmtDay(f.date)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="lg:col-span-2">
            <div className="text-[11px] font-medium text-slate-500 mb-1">Posts behind it</div>
            <div className="space-y-1.5">
              {s.examples.slice(0, 4).map((e) => (
                <a key={e.url} href={e.url} target="_blank" rel="noopener noreferrer"
                  className="block rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-[12px] text-slate-700 hover:border-slate-200 hover:bg-slate-50">
                  <div className="flex items-center gap-2 mb-0.5">
                    {REPORT[e.claim] ? <Pill tone={REPORT[e.claim].tone}>{REPORT[e.claim].label}</Pill> : <Pill tone="muted">Discussion</Pill>}
                    <span className="text-[11px] text-slate-400 truncate">{e.author || 'Post'} · {platformMeta(e.platform).label} · {e.source_type}</span>
                  </div>
                  <div className="line-clamp-2">{e.text}</div>
                </a>
              ))}
              {!s.examples.length && <div className="text-[12px] text-slate-400">No posts in this period.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SchemeList({ Icon, title, schemes }) {
  return (
    <Card Icon={Icon} title={title}>
      <div className="hidden md:grid grid-cols-12 gap-3 px-1 pb-2 text-[11px] font-medium text-slate-400 border-b border-slate-100">
        <div className="col-span-4 pl-6">Scheme</div>
        <div className="col-span-3">Status — what people report</div>
        <div className="col-span-3">Whom it favours</div>
        <div className="col-span-2 text-right">Reach</div>
      </div>
      {schemes.map((s) => <SchemeRow key={s.id} s={s} />)}
    </Card>
  );
}

/* ── the tab ─────────────────────────────────────────────────────────────── */

export default function ManifestoTrackerView({ days = 7 }) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((st) => ({ ...st, loading: true, error: null }));
    fetchWindow(days)
      .then((body) => {
        if (cancelled) return;
        setState({ data: { ...body.data, scoped: body.scoped }, loading: false, error: null });
        [7, 30, 90].filter((w) => w !== days).forEach((w) => fetchWindow(w).catch(() => {}));
      })
      .catch((error) => { if (!cancelled) setState({ data: null, loading: false, error }); });
    return () => { cancelled = true; };
  }, [days]);

  const d = state.data;
  if (state.loading && !d) return <div className="py-24 text-center text-[13px] text-slate-400">Loading the manifesto tracker…</div>;
  if (state.error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-700">
        {state.error?.response?.status === 403 ? 'You do not have access to this view.' : 'Could not load the manifesto tracker.'}
      </div>
    );
  }

  const theirs = d.theirs.schemes.filter((s) => !s.new_scheme);
  const all = [...d.theirs.schemes, ...d.ours.schemes];
  const sum = (fn) => all.reduce((t, s) => t + fn(s), 0);
  const reports = sum((s) => s.status.total);
  const notReached = sum((s) => (s.status.reports.not_received || 0) + (s.status.reports.stopped || 0) + (s.status.reports.delayed || 0) + (s.status.reports.reduced || 0));
  const favOurs = sum((s) => s.sentiment.favours_ours);
  const favGovt = sum((s) => s.sentiment.favours_govt);
  const net = favOurs + favGovt ? Math.round(((favOurs - favGovt) / (favOurs + favGovt)) * 100) : null;
  const verdicts = theirs.filter((s) => s.status.verdict).length;
  const lastRun = fmtTime(d.reading?.last_run_at);

  return (
    <div className={`space-y-5 ${state.loading ? 'opacity-60 transition-opacity' : ''}`}>
      {/* One line on how to read it; the details live in each row. */}
      <p className="text-[12px] text-slate-500 flex items-start gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-300" />
        <span>
          Status is what the public and press report about each scheme reaching them — a verdict needs {d.min_reports} reports.
          Posts are read automatically{lastRun ? ` (last run ${lastRun})` : ''}; data as of {fmtTime(d.as_of)}.
          {d.scoped ? ' Your constituencies only.' : ''}
          {days === 7 ? ' Schemes come up less often than daily news — 30 or 90 days give fuller verdicts.' : ''}
        </span>
      </p>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5 items-stretch">
        <Kpi label="Schemes tracked" value={n(all.length)} Icon={ScrollText} color="#4f46e5" bg="#eef2ff"
          footer={`${theirs.length} of their promises · ${d.ours.schemes.length} of ours`} />
        <Kpi label="Public reports" value={n(reports)} Icon={Megaphone} color="#2563eb" bg="#eff6ff"
          footer={`${verdicts} of their promises have a verdict`} />
        <Kpi label="Not reaching people" value={n(notReached)} share={reports ? Math.round((notReached / reports) * 100) : null}
          Icon={MessageSquare} color="#dc2626" bg="#fef2f2" footer="not received, delayed, cut or stopped" />
        <Kpi label="Discussion favours" value={net == null ? '—' : (net >= 0 ? 'Us' : 'Govt')} Icon={ThumbsUp}
          color={net == null ? '#64748b' : net >= 0 ? '#15803d' : '#dc2626'} bg={net == null ? '#f1f5f9' : net >= 0 ? '#f0fdf4' : '#fef2f2'}
          footer={<><NetFigure v={net} /><span>{n(favOurs)} us · {n(favGovt)} govt</span></>} />
      </div>

      <HeadToHead pairs={d.pairs} />

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-5 items-start">
        <SchemeList Icon={Landmark} title="Their 2023 promises" schemes={d.theirs.schemes} />
        <SchemeList Icon={ScrollText} title="Our schemes (2014–2023)" schemes={d.ours.schemes} />
      </div>

      {d.reading?.pending > 0 && (
        <p className="text-[11.5px] text-slate-400">{n(d.reading.pending)} recent posts are waiting to be read; they appear after the next scheduled run.</p>
      )}
    </div>
  );
}
