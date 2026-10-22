import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Landmark } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { useElectoralSeat, useElectoralSeats, useElectoralOverview } from '../../hooks/useElectoralBase';
import { seatKey, fmtPts, loyaltyBand, partyAsOf, OUR_PARTY_LABEL } from '../../config/electoralBase';
import LoyaltyTimeline from './LoyaltyTimeline';
import SeatAnalysisCard from './SeatAnalysisCard';
import YearByYearTable from './YearByYearTable';
import { CoreTab, SwingTab, OppositionTab } from './ElectoralOverviewTabs';
import { partyStyle } from '../../config/partyColors';
import { getMlaByConstituency } from '../../data/stateMLAs';

const ordinal = (n) => (!n ? '—' : n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
const fmtInt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const brsPlace = (c) => (c.candidates || []).findIndex((x) => x.party === 'BRS') + 1;

/* ── small building blocks ───────────────────────────────────────────── */

const Card = ({ title, right, children, className = '' }) => (
  <section className={`rounded-xl border border-slate-200 bg-white ${className}`}>
    {title && (
      <header className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <h4 className="text-[13px] font-semibold text-slate-800">{title}</h4>
        {right}
      </header>
    )}
    <div className={title ? 'px-4 pb-4' : 'p-4'}>{children}</div>
  </section>
);

const Kpi = ({ label, value, sub, tone }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
    <div className="text-[11px] text-slate-500">{label}</div>
    <div className={`text-[22px] leading-tight font-bold tabular-nums mt-1 ${tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-slate-900'}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
  </div>
);

const Dot = ({ party, size = 8 }) => (
  <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: partyStyle(party).hex }} />
);

/* ── Results by year ─────────────────────────────────────────────────── */

const pickParties = (columns) => {
  const best = {};
  columns.forEach((c) => Object.entries(c.parties).forEach(([p, v]) => { best[p] = Math.max(best[p] || 0, v.share); }));
  delete best.BRS; delete best.IND;
  return ['BRS', ...Object.entries(best).filter(([, v]) => v >= 10).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p)];
};

/** The strongest party other than BRS in one contest. */
const topRival = (c) => (c.candidates || []).find((x) => x.party !== 'BRS') || null;

const resultText = (place) => (!place ? 'Not contested' : place === 1 ? 'Won' : `Lost (${ordinal(place)})`);
const resultChip = (place) => (place === 1 ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
  : place ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-slate-50 border-slate-200 text-slate-500');

/** X-axis tick: the year, and BRS's result under it. */
const ResultTick = ({ x, y, payload, rows }) => {
  const row = rows.find((r) => r.label === payload.value);
  const won = row?.place === 1;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={14} textAnchor="middle" fontSize={12} fill="#334155" fontWeight={600}>{payload.value}</text>
      <text x={0} y={0} dy={30} textAnchor="middle" fontSize={11} fontWeight={700} fill={!row?.place ? '#94a3b8' : won ? '#047857' : '#be123c'}>
        {row?.ours} {!row?.place ? 'ABSENT' : won ? 'WON' : `LOST · ${ordinal(row.place)}`}
      </text>
      {row?.rivalParty && <text x={0} y={0} dy={45} textAnchor="middle" fontSize={10} fill="#64748b">vs {row.rivalParty}</text>}
    </g>
  );
};

/**
 * One kind of election for this seat, year by year: a summary line, BRS
 * against its strongest rival, every major party's share, and a table.
 * `mode` is 'assembly' (the MLA seat) or 'ls' (the parent MP seat).
 */
function ResultsSection({ seat, meta, columns, mode, onOpenElection }) {
  const isLs = mode === 'ls';
  const parties = useMemo(() => pickParties(columns), [columns]);
  const lineData = useMemo(() => columns.map((c) => {
    const row = { label: c.short };
    parties.forEach((p) => { row[p] = c.parties[p] ? c.parties[p].share : null; });
    return row;
  }), [columns, parties]);
  const last = lineData.length - 1;
  const rows = useMemo(() => columns.map((c) => {
    const rival = topRival(c);
    return { id: c.id, label: c.short, place: brsPlace(c), BRS: c.parties.BRS ? c.parties.BRS.share : 0,
      ours: partyAsOf('BRS', c.poll_date), rival: rival ? rival.share : 0, rivalParty: rival ? rival.party : '' };
  }), [columns]);

  const generals = columns.filter((c) => c.kind !== 'bye');
  const won = generals.filter((c) => brsPlace(c) === 1).map((c) => c.short);
  const latest = columns[columns.length - 1];
  const stateGov = meta?.statewide?.AE2023?.government;
  const pcName = seat.lok_sabha_seat?.name || seat.lok_sabha;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-3 pt-1">
        <h3 className="text-[17px] font-bold text-slate-900">{isLs ? 'Lok Sabha elections (MP)' : 'Assembly elections (MLA)'}</h3>
        <span className="text-[12px] text-slate-500">
          {isLs ? `${pcName} Lok Sabha seat — ${titleCase(seat.constituency)} is one of its assembly areas` : `${titleCase(seat.constituency)} assembly seat`}
        </span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[15px] font-semibold text-slate-900">
          {OUR_PARTY_LABEL} won {won.length} of {generals.length} {isLs ? `Lok Sabha elections for the whole ${pcName} seat` : 'assembly elections here'}{won.length ? ` (${won.join(', ')})` : ''}.
        </p>
        <p className="text-[11px] text-slate-500">Contested as TRS in 2014, 2018 and 2019; renamed BRS in December 2022.</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {columns.map((c) => (
            <button key={c.id} type="button" onClick={() => onOpenElection(c.id)}
              className={`text-[12px] font-semibold px-2.5 py-1 rounded-md border ${resultChip(brsPlace(c))}`}>
              {c.kind === 'bye' ? c.title : c.short}: {partyAsOf('BRS', c.poll_date)} {resultText(brsPlace(c)).toLowerCase()}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-slate-500 mt-3">
          {isLs ? (
            <>Sitting MP: <b className="text-slate-700">{titleCase(latest.winner.name)}</b> ({partyAsOf(latest.winner.party, latest.poll_date)}, {latest.short})
              {latest.government ? <> · Central government: <b className="text-slate-700">{latest.government.party_label}</b> (PM {latest.government.head})</> : null}</>
          ) : (
            <>Sitting MLA: <b className="text-slate-700">{titleCase(latest.winner.name)}</b> ({partyAsOf(latest.winner.party, latest.poll_date)}, {latest.title})
              {seat.defected_mla ? <> — elected as BRS, now with {seat.defected_mla.now_with}</> : null}
              {stateGov ? <> · State government: <b className="text-slate-700">{stateGov.party}</b> (CM {stateGov.head}, since {fmtDate(stateGov.sworn_in)})</> : null}</>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title={`${OUR_PARTY_LABEL} vs strongest rival, each election`} right={<span className="text-[11px] text-slate-400">vote share %</span>}>
          <div className="h-[290px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 22, right: 8, bottom: 30, left: -14 }} barGap={6} barCategoryGap="24%">
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" interval={0} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} height={52}
                  tick={(props) => <ResultTick {...props} rows={rows} />} />
                <YAxis domain={[0, (max) => Math.min(100, Math.ceil((max + 8) / 10) * 10)]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e2e8f0' }}
                  formatter={(v, name, item) => [`${v}%`, name === 'rival' ? item.payload.rivalParty : item.payload.ours]} />
                <Bar dataKey="BRS" fill={partyStyle('BRS').hex} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="BRS" position="top" fontSize={10} fill="#334155" formatter={(v) => (v ? Number(v).toFixed(1) : '')} />
                </Bar>
                <Bar dataKey="rival" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {rows.map((r) => <Cell key={r.id} fill={partyStyle(r.rivalParty).hex} />)}
                  <LabelList dataKey="rival" position="top" fontSize={10} fill="#334155" formatter={(v) => (v ? Number(v).toFixed(1) : '')} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-4 text-[11px] text-slate-600 mt-1">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: partyStyle('BRS').hex }} />{OUR_PARTY_LABEL}</span>
            <span>Second bar: the strongest other party that year ("vs" under the year), in its own colour</span>
          </div>
        </Card>

        <Card title="Vote share by party over the years" right={<span className="text-[11px] text-slate-400">vote share %</span>}>
          <div className="h-[290px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData} margin={{ top: 22, right: 76, bottom: 22, left: -14 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" interval={0} tick={{ fontSize: 12, fill: '#334155' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} height={40} />
                <YAxis domain={[0, (max) => Math.min(100, Math.ceil((max + 8) / 10) * 10)]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e2e8f0' }}
                  formatter={(v, p) => [v == null ? 'did not contest' : `${v}%`, p]} />
                {parties.map((p) => (
                  <Line key={p} type="linear" dataKey={p} stroke={partyStyle(p).hex} strokeWidth={p === 'BRS' ? 3 : 2}
                    dot={{ r: 4, strokeWidth: 0, fill: partyStyle(p).hex }} activeDot={{ r: 6 }} isAnimationActive={false} connectNulls={false}>
                    <LabelList dataKey={p} content={({ x, y, index, value }) => (index === last && value != null
                      ? <text x={x + 8} y={y + 4} fontSize={11} fill="#334155" fontWeight={p === 'BRS' ? 700 : 400}>{partyAsOf(p, columns[last]?.poll_date)} {Number(value).toFixed(1)}%</text>
                      : null)} />
                  </Line>
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-4 text-[11px] text-slate-600 mt-1">
            {parties.map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5"><span className="w-4 h-1 rounded" style={{ background: partyStyle(p).hex }} />{p === 'BRS' ? OUR_PARTY_LABEL : p}</span>
            ))}
            <span className="text-slate-400">gap = did not contest</span>
          </div>
        </Card>
      </div>

      <Card title="Results" right={<span className="text-[11px] text-slate-400">click a row for the full result</span>}>
        <table className="w-full text-[13px] tabular-nums">
          <thead className="text-[11px] text-slate-500 border-b border-slate-200">
            <tr>
              <th className="text-left font-medium py-2">Election</th>
              <th className="text-left font-medium">{OUR_PARTY_LABEL} result</th>
              <th className="text-left font-medium">{isLs ? 'Winner (MP, whole seat)' : 'Winner (MLA)'}</th>
              <th className="text-right font-medium">{OUR_PARTY_LABEL} share</th>
              {isLs && <th className="text-right font-medium" title="How voters in this assembly area voted in the MP election">In {titleCase(seat.constituency)} area</th>}
              <th className="text-right font-medium">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[...columns].reverse().map((c) => {
              const place = brsPlace(c);
              const seg = c.segment;
              const segPlace = seg ? brsPlace(seg) : 0;
              return (
                <tr key={c.id} onClick={() => onOpenElection(c.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="py-2.5">
                    <div className="font-semibold text-slate-900">{c.title}</div>
                    <div className="text-[11px] text-slate-400">{fmtDate(c.poll_date)}</div>
                  </td>
                  <td>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${place === 1 ? 'bg-emerald-100 text-emerald-800' : place ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-500'}`}>
                      {partyAsOf('BRS', c.poll_date)} {place === 1 ? 'WON' : place ? `LOST · ${ordinal(place)}` : 'ABSENT'}
                    </span>
                  </td>
                  <td className="text-slate-800"><span className="inline-flex items-center gap-1.5"><Dot party={c.winner.party} />{titleCase(c.winner.name)} <span className="text-slate-500">({partyAsOf(c.winner.party, c.poll_date)})</span></span></td>
                  <td className="text-right font-semibold">{c.parties.BRS ? `${c.parties.BRS.share}%` : '—'}</td>
                  {isLs && (
                    <td className="text-right text-slate-600">
                      {seg?.parties?.BRS
                        ? <>{seg.parties.BRS.share}% <span className={`text-[11px] font-semibold ${segPlace === 1 ? 'text-emerald-700' : 'text-slate-400'}`}>({segPlace === 1 ? 'led here' : ordinal(segPlace)})</span></>
                        : <span className="text-slate-300" title="Not published by assembly area for this year">—</span>}
                    </td>
                  )}
                  <td className="text-right text-slate-600">{fmtInt(c.margin)} <span className="text-[11px] text-slate-400">({c.margin_pct} pts)</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {isLs && <p className="text-[11px] text-slate-400 mt-2">"In {titleCase(seat.constituency)} area" = how voters in this assembly area voted for MP (EVM votes; available for 2019 and 2024).</p>}
      </Card>
    </section>
  );
}

/* ── One election ────────────────────────────────────────────────────── */

const SHOW_CANDIDATES = 6;

function ElectionTab({ col, prev, source }) {
  const cands = col.candidates || [];
  const top = cands[0]?.share || 1;
  const [showAll, setShowAll] = useState(false);
  // The contest is decided at the top; minor candidates fold behind a toggle,
  // but BRS is always visible wherever it finished.
  const brsIdx = cands.findIndex((c) => c.party === 'BRS');
  const visible = showAll ? cands.map((c, i) => [c, i])
    : cands.map((c, i) => [c, i]).filter(([, i]) => i < SHOW_CANDIDATES || i === brsIdx);
  const hidden = cands.length - visible.length;
  const hiddenShare = Math.round(cands.filter((_, i) => !visible.some(([, j]) => j === i)).reduce((s, c) => s + c.share, 0) * 10) / 10;
  // By-poll sources publish votes polled and turnout, not electors: derive it.
  const electors = col.electors || (col.votes_polled && col.turnout_pct ? Math.round(col.votes_polled / (col.turnout_pct / 100)) : null);
  const place = brsPlace(col);
  const brs = cands.find((c) => c.party === 'BRS');
  const ours = partyAsOf('BRS', col.poll_date);
  const depositLost = cands.filter((c) => c.deposit_lost).length;

  // Party-level change against the previous election shown (null for the first).
  const change = useMemo(() => {
    if (!prev) return [];
    const parties = new Set([...Object.keys(col.parties), ...Object.keys(prev.parties)]);
    parties.delete('IND');
    return [...parties]
      .map((p) => ({ party: p, now: col.parties[p]?.share ?? null, before: prev.parties[p]?.share ?? null }))
      .filter((r) => (r.now ?? 0) >= 2 || (r.before ?? 0) >= 2)
      .map((r) => ({ ...r, delta: r.now != null && r.before != null ? Math.round((r.now - r.before) * 10) / 10 : null }))
      .sort((a, b) => (b.now ?? -1) - (a.now ?? -1));
  }, [col, prev]);

  return (
    <div className="space-y-4">
      {/* Result line */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-[12px] text-slate-500">{col.title} · {col.kindLabel}{col.poll_date ? ` · polled ${fmtDate(col.poll_date)}` : ''}</div>
        <p className="text-[16px] font-semibold text-slate-900 mt-1 leading-snug">
          {titleCase(col.winner.name)} ({partyAsOf(col.winner.party, col.poll_date)}) won with {col.winner.share}%,{' '}
          {col.runner_up ? <>{fmtInt(col.margin)} votes ({col.margin_pct} pts) ahead of {titleCase(col.runner_up.name)} ({partyAsOf(col.runner_up.party, col.poll_date)}).</> : 'unopposed.'}
        </p>
        <p className="text-[13px] mt-1 text-slate-700">
          {brs ? <>{ours}: <b>{titleCase(brs.name)}</b> — {brs.share}% ({fmtInt(brs.votes)} votes), finished <b>{ordinal(place)}</b>{brs.deposit_lost ? <> and <b className="text-rose-700">lost its deposit</b></> : ''}.</> : `${ours} did not field a candidate.`}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Electors" value={col.electors ? fmtInt(electors) : electors ? `≈ ${fmtInt(electors)}` : '—'} sub={!col.electors && electors ? 'votes polled ÷ turnout' : ''} />
        <Kpi label={col.kind === 'bye' ? 'Votes polled' : 'Valid votes'} value={fmtInt(col.kind === 'bye' ? col.votes_polled : col.valid_votes)} />
        <Kpi label="Turnout" value={col.turnout_pct != null ? `${col.turnout_pct}%` : '—'} />
        <Kpi label="Candidates" value={col.partial ? `${cands.length}+` : fmtInt(cands.length)} sub={col.partial ? 'leading candidates published' : `${depositLost} lost deposit`} />
        <Kpi label="NOTA" value={col.nota ? `${col.nota.share}%` : '—'} sub={col.nota ? `${fmtInt(col.nota.votes)} votes` : ''} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <Card title="Every candidate" className={col.kind === 'ls' && !prev ? 'xl:col-span-5' : 'xl:col-span-3'}
          right={<span className="text-[11px] text-slate-400">bar = vote share</span>}>
          <div className="space-y-1.5">
            {visible.map(([c, i]) => {
              const isBrs = c.party === 'BRS';
              return (
                <div key={`${c.name}-${i}`} className={`grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1.3fr)_88px] items-center gap-2 rounded-md px-1.5 py-1 ${isBrs ? 'bg-pink-50' : ''}`}>
                  <span className="text-[11px] text-slate-400 tabular-nums">{i + 1}</span>
                  <div className="min-w-0">
                    <div className={`text-[12px] truncate ${isBrs ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{titleCase(c.name)}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      <Dot party={c.party} size={6} />{partyAsOf(c.party, col.poll_date)}
                      {c.incumbent && <span className="text-slate-400">· sitting MLA</span>}
                      {c.turncoat && <span className="text-slate-400">· switched party</span>}
                    </div>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (c.share / top) * 100)}%`, background: partyStyle(c.party).hex, opacity: c.deposit_lost ? 0.45 : 1 }} />
                  </div>
                  <div className="text-right tabular-nums">
                    <span className="text-[12px] font-semibold text-slate-800">{c.share}%</span>
                    <div className="text-[10px] text-slate-400">{fmtInt(c.votes)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {(hidden > 0 || showAll) && cands.length > SHOW_CANDIDATES && (
            <button type="button" onClick={() => setShowAll((v) => !v)}
              className="mt-2 text-[12px] font-medium text-pink-700 hover:underline">
              {showAll ? 'Show fewer' : `Show ${hidden} more candidate${hidden === 1 ? '' : 's'} (${hiddenShare}% of the vote together)`}
            </button>
          )}
          <p className="text-[11px] text-slate-400 mt-3">
            {col.partial
              ? 'By-election: only the leading candidates were published in the cited source.'
              : 'Faded bars lost their deposit (under one-sixth of valid votes, the ECI rule).'}
            {col.evm_only ? ' Lok Sabha segment counts are EVM votes only; postal ballots are counted per parliamentary seat.' : ''}
          </p>
        </Card>

        {(col.kind !== 'ls' || prev) && (
        <Card title={prev ? `Change since ${prev.title}` : 'Change since previous election'} className="xl:col-span-2">
          {prev ? (
            <table className="w-full text-[12px] tabular-nums">
              <thead className="text-[11px] text-slate-400">
                <tr><th className="text-left font-normal pb-1">Party</th><th className="text-right font-normal">{prev.short}</th><th className="text-right font-normal">{col.short}</th><th className="text-right font-normal">Change</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {change.map((r) => (
                  <tr key={r.party} className={r.party === 'BRS' ? 'font-semibold' : ''}>
                    <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><Dot party={r.party} />{r.party === 'BRS' ? OUR_PARTY_LABEL : r.party}</span></td>
                    <td className="text-right text-slate-500">{r.before != null ? `${r.before}%` : '—'}</td>
                    <td className="text-right">{r.now != null ? `${r.now}%` : '—'}</td>
                    <td className={`text-right ${r.delta == null ? 'text-slate-400' : r.delta > 0 ? 'text-emerald-700' : r.delta < 0 ? 'text-rose-700' : ''}`}>
                      {r.delta == null ? (r.now == null ? 'did not contest' : 'new') : `${fmtPts(r.delta)} pts`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-[12px] text-slate-400">2014 is the first election in this record (Telangana's first assembly).</p>}
          {prev && <p className="text-[11px] text-slate-400 mt-3">Net change in vote share; results cannot show that the same voters switched.</p>}
        </Card>
        )}
      </div>

      {source && (
        <p className="text-[11px] text-slate-500 px-1">
          Source: {source.publisher}.{' '}
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-pink-700 hover:underline break-all">{source.url}</a>
        </p>
      )}
    </div>
  );
}

/* ── Seat view ───────────────────────────────────────────────────────── */

const buildColumns = (seat, meta) => [
  { id: 'AE2014', title: 'Assembly 2014', short: '2014', kind: 'ae', kindLabel: 'Assembly election', ...seat.results.AE2014 },
  { id: 'AE2018', title: 'Assembly 2018', short: '2018', kind: 'ae', kindLabel: 'Assembly election', ...seat.results.AE2018 },
  { id: 'AE2023', title: 'Assembly 2023', short: '2023', kind: 'ae', kindLabel: 'Assembly election', ...seat.results.AE2023 },
  ...seat.bypolls.map((b) => ({ id: `BYE${b.poll_date}`, title: `By-poll ${b.poll_date.slice(0, 4)}`, short: `By-poll ${b.poll_date.slice(2, 4)}`, kind: 'bye', kindLabel: 'Assembly by-election', ...b })),
  // Lok Sabha: the parent MP seat's own result each year, plus — where the ECI
  // publishes it — how this assembly area voted in that election.
  ...['LS2014', 'LS2019', 'LS2024'].filter((id) => seat.lok_sabha_seat?.results?.[id]).map((id) => ({
    id: `PC${id.slice(2)}`, title: `Lok Sabha ${id.slice(2)}`, short: id.slice(2), kind: 'ls',
    kindLabel: `Lok Sabha · ${seat.lok_sabha_seat.name} seat`,
    ...seat.lok_sabha_seat.results[id],
    government: meta?.statewide?.[id]?.government || null,
    statewide: meta?.statewide?.[id] || null,
    segment: seat.results[id] || null,
  })),
];

const subTabClass = (active) => `shrink-0 px-3 py-1.5 text-[12.5px] font-medium rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-200 ${
  active ? 'bg-pink-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`;

/** One seat: year-by-year strip, seat analysis, MLA and MP results, and one tab per election. */
function SeatView({ constituency }) {
  const { seat, meta, loading, error } = useElectoralSeat(constituency ? seatKey(constituency) : null);
  const mla = constituency ? getMlaByConstituency(constituency) : null;
  const [tab, setTab] = useState('results');
  useEffect(() => { setTab('results'); }, [constituency]);

  const columns = useMemo(() => (seat ? buildColumns(seat, meta) : []), [seat, meta]);
  // Assembly (MLA) and Lok Sabha (MP) are different elections and are kept apart.
  const assembly = useMemo(() => columns.filter((c) => c.kind !== 'ls'), [columns]);
  const lokSabha = useMemo(() => columns.filter((c) => c.kind === 'ls'), [columns]);
  const col = columns.find((c) => c.id === tab) || null;
  // Each election compares with the previous one of the SAME kind.
  const generals = assembly.filter((c) => c.kind === 'ae');
  const prev = !col ? null
    : col.kind === 'ls' ? lokSabha[lokSabha.findIndex((c) => c.id === col.id) - 1] || null
      : col.kind === 'bye' ? generals[generals.length - 1]
        : generals[generals.findIndex((c) => c.id === col.id) - 1] || null;
  const sourceFor = (c) => {
    if (!c) return null;
    if (c.kind === 'bye') return { publisher: 'By-election result as published', url: c.sources?.[0] };
    if (c.kind === 'ls') return meta?.lok_sabha_elections?.find((e) => e.id === `LS${c.short}`) || null;
    return meta?.elections?.find((e) => e.id === c.id) || null;
  };

  if (!constituency) return <div className="py-16 text-center text-[13px] text-slate-500">Choose a constituency above.</div>;
  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>;
  if (error || !seat) {
    return (
      <div className="py-16 text-center text-[13px] text-slate-500">
        {error?.response?.status === 403 || error?.response?.status === 404 ? 'You do not have access to this constituency.' : 'No election record found for this seat.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Seat header + its election tabs */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-lg font-bold text-slate-900">{titleCase(seat.constituency)}</div>
        <div className="text-[12px] text-slate-500">
          {seat.district} district · {seat.reserved_category === 'GEN' ? 'General seat' : `${seat.reserved_category}-reserved seat`} · {seat.lok_sabha} Lok Sabha
          {mla && !mla.vacant && <> · MLA <span className="text-slate-700 font-medium">{mla.mla}</span> ({mla.party})</>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'results'} onClick={() => setTab('results')} className={subTabClass(tab === 'results')}>All results</button>
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mr-1">MLA</span>
            {assembly.map((c) => <button key={c.id} type="button" role="tab" aria-selected={tab === c.id} onClick={() => setTab(c.id)} className={subTabClass(tab === c.id)}>{c.kind === 'bye' ? c.title : c.short}</button>)}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mr-1">MP · {seat.lok_sabha_seat?.name}</span>
            {lokSabha.map((c) => <button key={c.id} type="button" role="tab" aria-selected={tab === c.id} onClick={() => setTab(c.id)} className={subTabClass(tab === c.id)}>{c.short}</button>)}
          </div>
        </div>
      </div>

      {tab === 'results' && (
        <div className="space-y-8">
          {seat.timeline && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <h3 className="text-[16px] font-bold text-slate-900">Year by year — MLA and MP elections</h3>
                <span className="text-[12px] font-bold px-2 py-0.5 rounded tabular-nums"
                  style={{ background: loyaltyBand(seat.brs_wins).hex, color: loyaltyBand(seat.brs_wins).text }}>
                  {OUR_PARTY_LABEL} won or led in {seat.brs_wins} of {seat.elections_counted}
                </span>
              </div>
              <LoyaltyTimeline timeline={seat.timeline} onSelect={(t) => setTab(t.type === 'MP' ? `PC${t.id.slice(2)}` : t.id)} />
              <p className="text-[11px] text-slate-400 mt-2">
                Colour dot = party that won. The party contested as TRS until it was renamed BRS in December 2022; both are counted together.
                MP 2019 and 2024 show how this assembly area voted, with the whole {seat.lok_sabha} seat's winner beneath — they can differ.
                *MP 2014 is the whole {seat.lok_sabha} seat (2014 results by assembly area were not published). Click an election for its full result.
              </p>
            </section>
          )}
          <SeatAnalysisCard seat={seat} />
          <ResultsSection seat={seat} meta={meta} columns={assembly} mode="assembly" onOpenElection={setTab} />
          {lokSabha.length > 0 && <ResultsSection seat={seat} meta={meta} columns={lokSabha} mode="ls" onOpenElection={setTab} />}
        </div>
      )}
      {col && col.kind === 'ls' && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13px] text-slate-700">
          <b>Lok Sabha is the MP election.</b> {titleCase(seat.constituency)} is one of the assembly areas inside the <b>{seat.lok_sabha_seat?.name}</b> Lok Sabha seat; below is that seat's full result.
          {col.segment?.parties?.BRS && <> In the {titleCase(seat.constituency)} area itself, {partyAsOf('BRS', col.poll_date)} polled <b>{col.segment.parties.BRS.share}%</b> and finished <b>{ordinal(brsPlace(col.segment))}</b> (EVM votes); the whole seat was won by <b>{partyAsOf(col.winner.party, col.poll_date)}</b>.</>}
          {col.statewide?.lok_sabha_seats_won && <> Telangana's {col.statewide.lok_sabha_seats} seats that year: <b>{Object.entries({ ...col.statewide.lok_sabha_seats_won, BRS: col.statewide.lok_sabha_seats_won.BRS || 0 }).sort((x, y) => y[1] - x[1]).map(([p, n]) => `${partyAsOf(p, col.poll_date)} ${n}`).join(' · ')}</b>.</>}
        </div>
      )}
      {col && <ElectionTab key={col.id} col={col} prev={prev} source={sourceFor(col)} />}
    </div>
  );
}

/* ── The Electoral analysis window ───────────────────────────────────── */

/** One plain line at the top of each tab saying what it shows. */
const TAB_NOTES = {
  core: 'Which constituencies consistently vote BRS (TRS) — each seat grouped by how many of the 6 MLA and MP elections since 2014 BRS won or led there.',
  swing: 'Where the vote can swing — seats decided by under 5 points in 2023, seats that changed party, and seats that voted differently for MLA and MP.',
  opposition: 'Where BRS lost votes and seats to rivals since 2014, and what INC, BJP and BRS promised in 2023.',
  table: 'Every constituency, election by election — cell colour is the party that won, ✓ marks a BRS (TRS) win.',
  seat: 'One constituency in full — how it voted in every MLA and MP election, its seat analysis, and each election\'s full result.',
};

function TabNote({ id }) {
  if (!TAB_NOTES[id]) return null;
  return <p className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-[13px] text-slate-700">{TAB_NOTES[id]}</p>;
}

const MAIN_TABS = [
  { id: 'core', label: 'Core support' },
  { id: 'swing', label: 'Swing seats' },
  { id: 'opposition', label: 'Opposition' },
  { id: 'table', label: 'Year by year' },
  { id: 'seat', label: 'Constituency' },
];

/**
 * One window for the whole Electoral analysis: the three client questions
 * statewide (core support, swing seats, opposition), every seat year by year,
 * and any one constituency in full. Opening it with `constituency` lands on
 * that seat; without, on Core support. Clicking a seat anywhere inside
 * switches to it here rather than opening another window.
 */
export default function ElectoralAnalysisModal({ open, onOpenChange, constituency }) {
  const [tab, setTab] = useState(constituency ? 'seat' : 'core');
  const [current, setCurrent] = useState(constituency || null);
  const scrollRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    setCurrent(constituency || null);
    setTab(constituency ? 'seat' : 'core');
  }, [open, constituency]);

  const { seats } = useElectoralSeats({ enabled: open });
  const { overview, scoped, loading: ovLoading, error: ovError } = useElectoralOverview({ enabled: open });

  const openSeat = (name) => {
    setCurrent(name);
    setTab('seat');
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const seatOptions = useMemo(() => [...seats].sort((a, b) => a.constituency.localeCompare(b.constituency)), [seats]);
  const currentKey = current ? seatKey(current) : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1280px] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden sm:rounded-2xl">
        <DialogTitle className="sr-only">Electoral analysis</DialogTitle>
        <div className="bg-white border-b border-slate-200">
          <div className="flex items-center gap-3 px-6 pt-4 pb-2 pr-14">
            <div className="p-2 rounded-lg bg-pink-100"><Landmark className="h-5 w-5 text-pink-700" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold text-slate-900">Electoral analysis — {scoped ? 'your constituencies' : `all ${seats.length || 119} constituencies`}</div>
              <div className="text-[12px] text-slate-500">MLA and MP elections 2014–2024 · BRS contested as TRS until December 2022</div>
            </div>
            <select value={currentKey} onChange={(e) => { const s = seats.find((x) => x.key === e.target.value); if (s) openSeat(s.constituency); }}
              className="text-[12px] border border-slate-200 rounded-lg px-2 py-1.5 bg-white max-w-[220px]" aria-label="Open a constituency">
              <option value="">Open a constituency…</option>
              {seatOptions.map((s) => <option key={s.key} value={s.key}>{titleCase(s.constituency)} · {s.district}</option>)}
            </select>
          </div>
          <nav className="flex gap-1 px-5 overflow-x-auto" role="tablist">
            {MAIN_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={`shrink-0 px-3 py-2 text-[13px] font-medium border-b-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-200 ${tab === t.id ? 'border-pink-600 text-pink-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {t.id === 'seat' && current ? titleCase(current) : t.label}
              </button>
            ))}
          </nav>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-slate-50 p-6">
          <TabNote key={tab} id={tab} />
          {tab === 'seat' && <SeatView constituency={current} />}
          {tab === 'table' && (seats.length
            ? <YearByYearTable seats={seats} onOpenSeat={openSeat} />
            : <div className="py-16 flex justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>)}
          {['core', 'swing', 'opposition'].includes(tab) && (
            ovLoading ? <div className="py-16 flex justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
              : ovError || !overview ? <div className="py-16 text-center text-[13px] text-slate-500">The analysis could not be loaded.</div>
                : tab === 'core' ? <CoreTab o={overview} seats={seats} onOpenSeat={openSeat} />
                  : tab === 'swing' ? <SwingTab o={overview} onOpenSeat={openSeat} />
                    : <OppositionTab o={overview} onOpenSeat={openSeat} />
          )}
          <p className="text-[11px] text-slate-400 px-1 mt-6">
            Sources: Election Commission of India; TCPD LokDhaba (Ashoka University) for assembly 2014/2018 and Lok Sabha 2019; India Data Portal for Lok Sabha 2014;
            CEO Telangana for districts; 2023 manifestos as reported at release (sources linked). Issues = topics of public posts collected by this platform, last 30 days.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
