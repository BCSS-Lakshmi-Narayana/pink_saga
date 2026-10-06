import React, { useEffect, useState } from 'react';
import {
  Users, MapPinned, TrendingUp,
  Wallet, Info, Loader2, LayoutGrid, ArrowRight,
  Mars, Venus, Transgender,
  Building2, Factory, HardHat, TrendingDown, UserCheck, Landmark,
  FileText, CalendarDays,
  Route, Droplet, Zap, Waves, Trash2, HeartPulse, GraduationCap, Briefcase, Wheat, HandHeart, ShieldAlert,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from './ui/card';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from './ui/tooltip';
import ConstituencyHeatMap from './ConstituencyHeatMap';
import BoothLevelModal from './BoothLevelModal';
import api from '../lib/api';

const fmtNum = (n) => (n || n === 0) ? Number(n).toLocaleString('en-IN') : '—';
// Indian short format: 2,25,977 -> "2.26 L", 12,40,000 -> "12.4 L", 1,24,00,000 -> "1.24 Cr"
const fmtShort = (n) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
  return String(v);
};

/* ── Top stat strip tile (compact — 5 fit across a half-width column) ── */
const StatCard = ({ icon: Icon, iconBg, iconColor, label, value, sub, pendingReason, exact }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 flex items-start gap-2 shadow-sm min-w-0 transition-shadow duration-200 hover:shadow-md">
    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
      <Icon className={`h-4 w-4 ${iconColor}`} />
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-[9px] text-slate-500 leading-snug uppercase tracking-wide break-words">{label}</div>
      {value !== undefined && value !== null ? (
        <>
          {/* Compact headline for scanning; the exact count (no rounding) is on
              hover and in the sub-line, since every elector matters. */}
          <div
            className={`text-base font-bold text-slate-800 leading-tight break-words ${exact != null ? 'cursor-help' : ''}`}
            title={exact != null ? `${fmtNum(exact)} — exact count` : undefined}
          >
            {value}
          </div>
          {sub && <div className="text-[9px] text-slate-400 leading-snug break-words">{sub}</div>}
        </>
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-xs font-medium text-slate-300 italic cursor-help leading-tight mt-0.5">Pending</div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[220px] text-xs">
              {pendingReason || 'No official public dataset exists for this field at constituency granularity.'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  </div>
);

const PanelCard = ({ icon: Icon, title, badge, children, className = '' }) => (
  <Card className={`border-slate-200 overflow-hidden flex flex-col transition-shadow duration-200 hover:shadow-md ${className}`}>
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
      <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
        <Icon className="h-3.5 w-3.5 text-slate-500" /> {title}
      </h3>
      {badge}
    </div>
    <div className="p-4 flex-1">{children}</div>
  </Card>
);

const PendingNote = ({ children }) => (
  <div className="flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
    <span>{children}</span>
  </div>
);

/* Gender split donut — AC-wise registered electors from the ECI 2023 index cards (2023 election rolls).
   Thick ring with the total seated in the middle, then an icon-led breakdown
   where each row carries its own proportion bar. */
const GenderDonut = ({ male, female, other }) => {
  const total = (male || 0) + (female || 0) + (other || 0);
  if (!total) {
    return (
      <div className="flex items-center gap-4">
        <div className="w-32 h-32 rounded-full border-[14px] border-slate-100 shrink-0" />
        <PendingNote>Gender-wise elector roll not available for this seat.</PendingNote>
      </div>
    );
  }
  const pm = (male / total) * 100;
  const pf = (female / total) * 100;
  const po = (other / total) * 100;

  // SVG arc donut. Arcs are drawn at their exact proportion with no artificial
  // gaps — a sliver like 18 third-gender electors in 2.26L (0.008%) should be
  // visually negligible, not padded up to a notch that misreads as a real share.
  const RADIUS = 42;
  const STROKE = 17;
  const CIRC = 2 * Math.PI * RADIUS;
  const segments = [
    { pct: pm, color: '#3b82f6' },
    { pct: pf, color: '#ec4899' },
    { pct: po, color: '#94a3b8' },
  ].filter((s) => s.pct > 0);

  let cursor = 0;
  const arcs = segments.map((s, i) => {
    const len = (s.pct / 100) * CIRC;
    const arc = {
      key: i,
      color: s.color,
      dash: `${len} ${CIRC - len}`,
      offset: -cursor,
    };
    cursor += len;
    return arc;
  });

  const Row = ({ icon: Icon, color, tint, label, pct, count }) => (
    <div className="rounded-lg px-2.5 py-2" style={{ background: tint }}>
      <div className="flex items-center gap-2 text-xs">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
        <span className="text-slate-700 font-medium flex-1">{label}</span>
        <span className="font-bold text-slate-800 shrink-0 tabular-nums">{pct.toFixed(1)}%</span>
        <span className="text-slate-500 w-16 text-right shrink-0 tabular-nums">{fmtNum(count)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/70 overflow-hidden mt-1.5">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(pct, 1.5)}%`, background: color }}
        />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Thick arc donut with the headline total in the middle */}
      <div className="relative w-36 h-36">
        <svg viewBox="0 0 100 100" className="w-36 h-36 -rotate-90">
          <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="#f1f5f9" strokeWidth={STROKE} />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx="50"
              cy="50"
              r={RADIUS}
              fill="none"
              stroke={a.color}
              strokeWidth={STROKE}
              strokeDasharray={a.dash}
              strokeDashoffset={a.offset}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        {/* Exact elector count as the headline (no rounding — every vote counts).
            Hover reveals the precise gender breakdown. */}
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="absolute inset-0 flex flex-col items-center justify-center cursor-help">
                <span className="text-[15px] font-bold text-slate-800 leading-none tabular-nums">{fmtNum(total)}</span>
                <span className="text-[8px] text-slate-400 uppercase tracking-wide mt-1">Total Electors</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <div className="font-semibold">{fmtNum(total)} total electors</div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                Male {fmtNum(male)} · Female {fmtNum(female)}{other > 0 ? ` · Third gender ${fmtNum(other)}` : ''}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Exact ECI count — shown without rounding.</div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Icon-led breakdown, each row with its own proportion bar */}
      <div className="w-full space-y-1.5">
        <Row icon={Mars} color="#3b82f6" tint="#eff6ff" label="Male" pct={pm} count={male} />
        <Row icon={Venus} color="#ec4899" tint="#fdf2f8" label="Female" pct={pf} count={female} />
        {other > 0 && (
          <Row icon={Transgender} color="#64748b" tint="#f8fafc" label="Third gender" pct={po} count={other} />
        )}
      </div>
    </div>
  );
};

/* Socio-economic sector employment — latest available (NSO/MoSPI PLFS
   2023-24, Telangana state tables). Statewide figures — this source doesn't publish
   a district/AC breakdown, unlike the stale 2011 census did. */
const SocioEconomic = ({ data, constituency }) => {
  if (!data) {
    return <PendingNote>No socio-economic data available.</PendingNote>;
  }
  const se = data.sector_employment || {};
  // Each figure maps onto the grievance-feed `analysis_category` it best
  // corresponds to, so clicking drills into the related grievances the same
  // way Key Public Issues does. Only the categories the feed actually filters
  // on are valid — Agriculture maps 1:1; every other economic/labour figure
  // rolls up to `employment` (the closest supported category).
  const bars = [
    { label: 'Agriculture', value: se.agriculture, color: '#10b981', tint: '#ecfdf5', icon: Wheat, category: 'agriculture' },
    { label: 'Services', value: se.services, color: '#3b82f6', tint: '#eff6ff', icon: Building2, category: 'employment' },
    { label: 'Manufacturing & Industry', value: se.manufacturing_and_industry, color: '#a855f7', tint: '#faf5ff', icon: Factory, category: 'employment' },
    { label: 'Construction', value: se.construction, color: '#f59e0b', tint: '#fffbeb', icon: HardHat, category: 'employment' },
  ];
  const metrics = [
    { label: 'LFPR', value: data.labour_force_participation_rate, icon: Briefcase, color: '#0f766e', tint: '#f0fdfa', category: 'employment' },
    { label: 'Unemployment', value: data.unemployment_rate, icon: TrendingDown, color: '#b91c1c', tint: '#fef2f2', category: 'employment' },
    { label: 'Female LFPR', value: data.lfpr_female, icon: UserCheck, color: '#be185d', tint: '#fdf2f8', category: 'employment' },
    { label: 'Informal (rural)', value: data.informal_sector_rural, icon: Landmark, color: '#c2410c', tint: '#fff7ed', category: 'employment' },
  ];

  const grievanceLink = (category) =>
    `/grievances?location=${encodeURIComponent(constituency)}&analysis_category=${encodeURIComponent(category)}`;

  return (
    <div className="flex flex-col h-full">
      {/* Sector employment split — each row drills into its related grievances */}
      <div className="space-y-2.5">
        {bars.map((b) => {
          const body = (
            <>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-700 font-medium flex items-center gap-1.5 min-w-0">
                  <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: b.tint }}>
                    <b.icon className="h-3 w-3" style={{ color: b.color }} />
                  </span>
                  <span className="truncate">{b.label}</span>
                </span>
                <span className="font-bold text-slate-800 shrink-0 tabular-nums">{b.value}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${Math.min(100, b.value)}%`, background: b.color }}
                />
              </div>
            </>
          );
          return constituency ? (
            <Link
              key={b.label}
              to={grievanceLink(b.category)}
              className="block rounded-md px-1.5 py-1 -mx-1.5 -my-0.5 hover:bg-slate-100/70 transition-colors cursor-pointer"
            >
              {body}
            </Link>
          ) : (
            <div key={b.label}>{body}</div>
          );
        })}
      </div>

      {/* Labour-market metrics as tiles — fills the card instead of trailing
          micro-text, and gives each figure equal visual weight. Each tile drills
          into the related grievances too. */}
      <div className="grid grid-cols-2 gap-2 mt-3.5">
        {metrics.map((m) => {
          const body = (
            <>
              <div className="flex items-center gap-1.5">
                <m.icon className="h-3 w-3 shrink-0" style={{ color: m.color }} />
                <span className="text-[9px] text-slate-500 uppercase tracking-wide truncate">{m.label}</span>
              </div>
              <div className="text-sm font-bold text-slate-800 tabular-nums mt-0.5">
                {m.value != null ? `${m.value}%` : '—'}
              </div>
            </>
          );
          return constituency ? (
            <Link
              key={m.label}
              to={grievanceLink(m.category)}
              className="rounded-lg px-2.5 py-2 block transition-shadow hover:shadow-md cursor-pointer"
              style={{ background: m.tint }}
            >
              {body}
            </Link>
          ) : (
            <div key={m.label} className="rounded-lg px-2.5 py-2" style={{ background: m.tint }}>
              {body}
            </div>
          );
        })}
      </div>

    </div>
  );
};

// Icon per civic-issue category — matches the exact keys the backend's
// mlaReferenceService.ISSUE_LEXICON classifier produces.
const ISSUE_ICON = {
  roads: Route,
  water: Droplet,
  electricity: Zap,
  drainage: Waves,
  sanitation: Trash2,
  health: HeartPulse,
  education: GraduationCap,
  employment: Briefcase,
  agriculture: Wheat,
  welfare: HandHeart,
  law_and_order: ShieldAlert,
};

const IssueBar = ({ rank, issue, count, max, constituency }) => {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  const RANK_COLORS = ['#ef4444', '#f97316', '#eab308', '#3b82f6', '#8b5cf6'];
  const color = RANK_COLORS[rank - 1] || '#94a3b8';
  const Icon = ISSUE_ICON[issue] || Info;
  return (
    <Link
      to={`/grievances?location=${encodeURIComponent(constituency)}&analysis_category=${encodeURIComponent(issue)}`}
      className="block"
    >
      <div className="flex items-center gap-2 h-8 shrink-0 hover:bg-slate-100/70 transition-colors rounded-md px-1 -mx-1 cursor-pointer">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: `${color}1a` }}>
          <Icon className="h-3 w-3" style={{ color }} />
        </div>
        {/* Track + fill are a light tint so the label text stays legible at any
            fill %, instead of white text that only works on wide, dark bars. */}
        <div className="relative flex-1 h-6 rounded-md bg-slate-100 overflow-hidden min-w-0">
          <div className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${Math.max(pct, 4)}%`, background: `${color}33` }} />
          <div className="absolute inset-0 flex items-center justify-between px-2">
            <span className="text-[11px] font-medium text-slate-700 capitalize truncate">{issue.replace(/_/g, ' ')}</span>
            <span className="text-[10px] font-bold text-slate-600 shrink-0 ml-2">{count}</span>
          </div>
        </div>
      </div>
    </Link>
  );
};

// Reference-style colourful channel tiles. Order mirrors the reference image.
const ENGAGEMENT_CHANNELS = [
  { key: 'grievances', label: 'Grievance Tracking', icon: FileText, live: true, color: '#e11d48', bg: '#fff1f2' },
  { key: 'events', label: 'Events Participation', icon: CalendarDays, live: true, color: '#ea580c', bg: '#fff7ed' },
];

const EngagementChannel = ({ channel, constituency }) => {
  const body = (
    <div className={`flex flex-col items-center gap-2.5 rounded-xl border px-4 py-6 text-center transition-all h-full ${
      channel.live ? 'border-slate-200 bg-white hover:shadow-md cursor-pointer' : 'border-slate-100 bg-white opacity-90'
    }`}>
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: channel.bg }}>
        <channel.icon className="h-7 w-7" style={{ color: channel.color }} />
      </div>
      <span className="text-sm font-semibold text-slate-700 leading-tight">{channel.label}</span>
      <span
        className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
        style={channel.live
          ? { background: '#dcfce7', color: '#15803d' }
          : { background: '#f1f5f9', color: '#94a3b8' }}
      >
        {channel.live ? 'Live' : 'Not connected'}
      </span>
    </div>
  );
  if (channel.key === 'grievances') return <Link to={`/grievances?location=${encodeURIComponent(constituency)}`}>{body}</Link>;
  if (channel.key === 'events') return <Link to="/events">{body}</Link>;
  return body;
};

const VoterProfilePanel = ({ profile, loading, topIssues = [], constituencyDisplayName, dense = false, sectionNumber }) => {
  // null while the probe is in flight, then true/false. The drill-down button
  // renders for EVERY seat regardless — this only decides its wording, since
  // a seat with no roll opens the panel on the upload flow instead of a grid.
  const [boothAvailable, setBoothAvailable] = useState(null);
  const [boothModalOpen, setBoothModalOpen] = useState(false);

  useEffect(() => {
    const constName = profile?.constituency;
    if (!constName) { setBoothAvailable(null); return undefined; }
    let cancelled = false;
    setBoothAvailable(null);
    api.get(`/voter-profiles/${encodeURIComponent(constName)}/booths`)
      .then((res) => { if (!cancelled) setBoothAvailable(Boolean(res.data?.success)); })
      .catch(() => { if (!cancelled) setBoothAvailable(false); });
    return () => { cancelled = true; };
  }, [profile?.constituency, boothModalOpen]);

  if (loading) {
    return <div className="h-64 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  }
  if (!profile) {
    return (
      <PendingNote>
        No verified voter-profile dataset found for this constituency yet. This may be a seat outside the
        current 119-seat Telangana dataset, or a name-matching gap.
      </PendingNote>
    );
  }

  const { constituency } = profile;
  const maxIssue = topIssues.reduce((m, t) => Math.max(m, t.count), 0);

  const acDisplay = constituencyDisplayName || constituency;

  // In dense (split-column) mode we keep the reference's multi-card grid but
  // switch to md: breakpoints — at xl+ (where the two halves sit side-by-side)
  // the viewport is wide enough that md: renders the cards across within the
  // half-width column, matching the reference layout.
  const grid3 = dense ? 'grid grid-cols-1 md:grid-cols-3 gap-3' : 'grid grid-cols-1 lg:grid-cols-3 gap-4';
  // Top stat strip now holds 3 cards (Total/Male/Female voters) — a plain
  // 3-column grid fits cleanly at any width without an awkward trailing gap.
  const statGrid = 'grid grid-cols-1 sm:grid-cols-3 gap-2.5';

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Banner */}
      <div className="rounded-xl bg-white border border-slate-200 px-5 py-3 flex items-center justify-between flex-wrap gap-2 shadow-sm">
        <div className="flex items-center gap-3">
          {sectionNumber != null && (
            <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-bold shrink-0">{sectionNumber}</div>
          )}
          <div>
            <div className="text-sm font-bold text-slate-800">Voter Profiling &amp; Constituency Intelligence</div>
            <div className="text-[11px] text-slate-500">Know your voters. Understand their needs. Serve better.</div>
          </div>
        </div>
      </div>

      <BoothLevelModal
        open={boothModalOpen}
        onClose={() => setBoothModalOpen(false)}
        constituency={constituency}
        constituencyDisplayName={acDisplay}
        acNumber={profile.ac_number}
      />

      {/* Row 1 — top stat strip (all real) */}
      <div className={statGrid}>
        <StatCard icon={Users} iconBg="bg-violet-100" iconColor="text-violet-600"
          label="Total Voters" value={fmtShort(profile.electors_total)} exact={profile.electors_total}
          sub={`${fmtNum(profile.electors_total)} electors`} />
        <StatCard icon={Users} iconBg="bg-blue-100" iconColor="text-blue-600"
          label="Male Voters" value={fmtShort(profile.electors_male)} exact={profile.electors_male}
          sub={profile.electors_total ? `${fmtNum(profile.electors_male)} · ${((profile.electors_male / profile.electors_total) * 100).toFixed(1)}%` : fmtNum(profile.electors_male)} />
        <StatCard icon={Users} iconBg="bg-pink-100" iconColor="text-pink-600"
          label="Female Voters" value={fmtShort(profile.electors_female)} exact={profile.electors_female}
          sub={profile.electors_total ? `${fmtNum(profile.electors_female)} · ${((profile.electors_female / profile.electors_total) * 100).toFixed(1)}%` : fmtNum(profile.electors_female)} />
      </div>

      {/* Row 2 — Demographics | Socio-Economic | Key Issues */}
      <div className={grid3}>
        <PanelCard icon={Users} title="Demographic Overview">
          <div className="flex flex-col h-full">
            <GenderDonut male={profile.electors_male} female={profile.electors_female} other={profile.electors_other} />
            {/* Booth-level drill-down sits here, directly under the seat-wide
                split it breaks down. Rendered for every seat: where no roll
                has been uploaded yet, the panel opens on the upload flow. */}
            <button
              type="button"
              onClick={() => setBoothModalOpen(true)}
              className="group mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 text-violet-700 px-3 py-2.5 text-[11px] font-semibold hover:from-violet-100 hover:to-indigo-100 hover:border-violet-300 transition-all active:scale-[0.98]"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              View booth-level data
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </button>
            {boothAvailable === false && (
              /* Neutral wording: only allowlisted accounts can actually add a
                 roll, and the panel itself decides whether to offer that. */
              <div className="mt-1.5 text-center text-[10px] text-slate-400">
                No booth-level roll uploaded yet
              </div>
            )}
          </div>
        </PanelCard>

        <PanelCard icon={Wallet} title="Socio-Economic Profile">
          <SocioEconomic data={profile.socio_economic} constituency={acDisplay} />
        </PanelCard>

        <PanelCard icon={TrendingUp} title="Key Public Issues" badge={<span className="text-[9px] text-slate-400">live · grievance feed</span>}>
          {topIssues.length === 0 ? (
            <PendingNote>No issue patterns detected yet from social/grievance monitoring for this seat.</PendingNote>
          ) : (
            // Fixed height regardless of how many issues there are — the card
            // never grows; extra rows scroll vertically inside instead.
            <div className="max-h-[340px] overflow-y-auto space-y-1.5 pr-1">
              {topIssues.slice(0, 10).map((t, i) => (
                <IssueBar key={t.issue} rank={i + 1} issue={t.issue} count={t.count} max={maxIssue} constituency={acDisplay} />
              ))}
            </div>
          )}
        </PanelCard>
      </div>

      {/* Row 3 — Constituency heat map */}
      <PanelCard icon={MapPinned} title="Constituency Heat Map" badge={<span className="text-[9px] text-slate-400">priority · live sentiment</span>}>
        <ConstituencyHeatMap currentConstituency={acDisplay} />
      </PanelCard>

      {/* Row 5 — Citizen engagement channels */}
      <PanelCard icon={Users} title="Citizen Engagement Channels">
        <div className="grid grid-cols-2 gap-3">
          {ENGAGEMENT_CHANNELS.map((c) => (
            <EngagementChannel key={c.key} channel={c} constituency={acDisplay} />
          ))}
        </div>
      </PanelCard>
    </div>
  );
};

export default VoterProfilePanel;
