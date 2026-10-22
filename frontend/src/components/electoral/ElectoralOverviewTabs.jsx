import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, LineChart, Line, Legend } from 'recharts';
import { partyStyle } from '../../config/partyColors';
import { partyAsOf } from '../../config/electoralBase';

/*
 * The three client questions, statewide (or across a user's own seats):
 *   Core support   — who consistently votes BRS, and which kinds of seats
 *   Swing seats    — where the vote is persuadable, and what people there raise
 *   Opposition     — what rivals promised, and where BRS lost votes to them
 * Every figure is a count or vote share from the published results; the
 * "issues" panels are the topics of posts this platform collected.
 */

const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const ELECTIONS = [['AE2014', 'MLA 2014'], ['AE2018', 'MLA 2018'], ['LS2019', 'MP 2019'], ['AE2023', 'MLA 2023'], ['LS2024', 'MP 2024']];
const POLL = { AE2014: '2014-04-30', AE2018: '2018-12-07', LS2019: '2019-04-11', AE2023: '2023-11-30', LS2024: '2024-05-13' };
const SEAT_TYPE = { GEN: 'General seats', SC: 'SC-reserved seats', ST: 'ST-reserved seats' };

const Box = ({ title, sub, children, className = '' }) => (
  <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
    <div className="text-[13px] font-semibold text-slate-800">{title}</div>
    {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    <div className="mt-3">{children}</div>
  </section>
);

const Stat = ({ value, label, sub }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
    <div className="text-[22px] font-bold text-slate-900 tabular-nums">{value}</div>
    <div className="text-[12px] text-slate-600">{label}</div>
    {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
  </div>
);

const SeatChips = ({ rows, onOpenSeat, extra }) => (
  <div className="flex flex-wrap gap-1.5">
    {rows.map((r) => (
      <button key={r.key} type="button" onClick={() => onOpenSeat?.(r.constituency)}
        className="text-[11px] rounded-md border border-slate-200 bg-white px-2 py-1 hover:border-pink-300 hover:bg-pink-50 text-left">
        <span className="font-semibold text-slate-800">{titleCase(r.constituency)}</span>
        {extra && <span className="text-slate-500"> · {extra(r)}</span>}
      </button>
    ))}
    {!rows.length && <span className="text-[12px] text-slate-400">None</span>}
  </div>
);

const Issues = ({ issues, label }) => (
  <Box title={`What people raise in ${label}`} sub={`Topics of ${issues?.posts || 0} public posts located in these seats, last ${issues?.days || 30} days (collected by this platform) · ${issues?.negative_pct || 0}% negative in tone`}>
    {issues?.top?.length ? (
      <div className="space-y-1.5">
        {issues.top.map((t) => (
          <div key={t.topic} className="flex items-center gap-2 text-[12px]">
            <span className="w-44 truncate text-slate-700" title={t.topic}>{t.topic}</span>
            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-slate-500" style={{ width: `${(t.count / issues.top[0].count) * 100}%` }} />
            </div>
            <span className="w-10 text-right tabular-nums text-slate-600">{t.count}</span>
          </div>
        ))}
      </div>
    ) : <p className="text-[12px] text-slate-400">No classified posts located in these seats yet.</p>}
  </Box>
);

/* ── Core support ─────────────────────────────────────────────────── */

/** Loyalty groups, strongest first. `min`/`max` = elections won or led, out of 6. */
const LOYALTY_GROUPS = [
  { id: 'very', label: 'Very loyal', rule: 'won or led in all 6 elections', min: 6, max: 6, hex: '#6b0f3a' },
  { id: 'loyal', label: 'Loyal', rule: 'won or led in exactly 5 of 6 (lost 1)', min: 5, max: 5, hex: '#c8246f' },
  { id: 'leaning', label: 'Leaning BRS', rule: 'won or led in exactly 4 of 6 (lost 2)', min: 4, max: 4, hex: '#e05297' },
  { id: 'mixed', label: 'Mixed', rule: 'won or led in 2 or 3 of 6', min: 2, max: 3, hex: '#f4a3c8' },
  { id: 'not', label: 'Not with BRS', rule: 'won or led in 1 or none of 6', min: 0, max: 1, hex: '#e2e8f0' },
];

function LoyaltyGroup({ g, list, onOpenSeat }) {
  const [all, setAll] = useState(false);
  const LIMIT = 12;
  const shown = all ? list : list.slice(0, LIMIT);
  return (
    <div className="flex flex-col md:flex-row md:items-start gap-3 py-3">
      <div className="md:w-56 shrink-0 flex items-start gap-2.5">
        <span className="mt-0.5 w-4 h-4 rounded shrink-0 border border-slate-300/60" style={{ background: g.hex }} />
        <div>
          <div className="text-[14px] font-bold text-slate-900">{g.label} · {list.length} seat{list.length === 1 ? '' : 's'}</div>
          <div className="text-[12px] text-slate-500">{g.rule}</div>
        </div>
      </div>
      <div className="flex-1">
        <SeatChips rows={shown} onOpenSeat={onOpenSeat} extra={(r) => r.district} />
        {list.length > LIMIT && (
          <button type="button" onClick={() => setAll((v) => !v)} className="mt-1.5 text-[12px] font-medium text-pink-700 hover:underline">
            {all ? 'Show fewer' : `Show all ${list.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

export function CoreTab({ o, seats = [], onOpenSeat }) {
  const c = o.core;
  const byWins = (min, max) => seats.filter((s) => s.brs_wins >= min && s.brs_wins <= max)
    .sort((a, b) => b.brs_wins - a.brs_wins || a.constituency.localeCompare(b.constituency));
  const groups = LOYALTY_GROUPS.map((g) => ({ g, list: byWins(g.min, g.max) }));
  const n = (id) => groups.find((x) => x.g.id === id).list.length;

  // District: how many of its seats are loyal (5–6 of 6), and how many BRS won in 2023.
  const districts = {};
  seats.forEach((s) => {
    const d = districts[s.district] || (districts[s.district] = { district: s.district, seats: 0, loyal: 0, won2023: 0 });
    d.seats += 1;
    if (s.brs_wins >= 5) d.loyal += 1;
    if (s.assembly.AE2023.winner_party === 'BRS') d.won2023 += 1;
  });
  const districtRows = Object.values(districts).sort((a, b) => b.loyal - a.loyal || b.won2023 / b.seats - a.won2023 / a.seats || a.district.localeCompare(b.district));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[15px] text-slate-800 leading-relaxed">
          Out of <b>{seats.length}</b> constituencies, BRS (TRS) won or led in <b>all 6</b> MLA and MP elections in <b>{n('very')}</b>,
          and in <b>5 of 6</b> in another <b>{n('loyal')}</b>. These <b>{n('very') + n('loyal')}</b> are the party's loyal base.
          In <b>{n('not')}</b> it won or led at most once.
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          The six elections: MLA 2014, 2018, 2023 and MP 2014, 2019, 2024. For MP 2019 and 2024 we count how that assembly area voted. Click any seat for its full results.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-4 divide-y divide-slate-100">
        <p className="py-2 text-[12px] text-slate-500">Each constituency appears in <b>one group only</b>, by how many of the 6 elections BRS (TRS) won or led there — so the seats in "Very loyal" are not repeated below. {groups.map(({ g, list }) => `${g.label} ${list.length}`).join(" + ")} = {seats.length} seats.</p>
        {groups.map(({ g, list }) => <LoyaltyGroup key={g.id} g={g} list={list} onOpenSeat={onOpenSeat} />)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Box title="Districts" sub="Loyal seats = won or led in 5–6 of the 6 elections. Most loyal first.">
          <table className="w-full text-[12px] tabular-nums">
            <thead className="text-[11px] text-slate-400 border-b border-slate-100">
              <tr><th className="text-left font-normal py-1">District</th><th className="text-right font-normal">Seats</th><th className="text-right font-normal">Loyal seats</th><th className="text-right font-normal">Won by BRS in 2023</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {districtRows.map((d) => (
                <tr key={d.district}>
                  <td className="py-1 text-slate-800">{d.district}</td>
                  <td className="text-right text-slate-500">{d.seats}</td>
                  <td className={`text-right ${d.loyal ? 'font-bold text-pink-800' : 'text-slate-300'}`}>{d.loyal}</td>
                  <td className="text-right text-slate-700">{d.won2023} of {d.seats}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>

        <Box title="Seat type" sub="Assembly seats BRS (TRS) won, by reserved status — the population attribute ECI records per seat">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="text-[11px] text-slate-400 border-b border-slate-100">
              <tr><th className="text-left font-normal py-1">Seat type</th><th className="text-right font-normal">Seats</th><th className="text-right font-normal">Won 2014</th><th className="text-right font-normal">Won 2018</th><th className="text-right font-normal">Won 2023</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {c.by_seat_type.map((g) => (
                <tr key={g.group}>
                  <td className="py-1.5 text-slate-800">{SEAT_TYPE[g.group] || g.group}</td>
                  <td className="text-right text-slate-500">{g.seats}</td>
                  <td className="text-right">{g.brs_seats_won.AE2014}</td>
                  <td className="text-right">{g.brs_seats_won.AE2018}</td>
                  <td className="text-right font-semibold">{g.brs_seats_won.AE2023}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-slate-500 mt-3">
            {c.by_seat_type.map((g) => `${SEAT_TYPE[g.group] || g.group}: ${g.brs_seats_won.AE2023} of ${g.seats} won in 2023 (${g.brs_share.AE2023}% of the vote)`).join(' · ')}.
          </p>
        </Box>
      </div>

      <Issues issues={c.issues} label="the loyal seats" />
    </div>
  );
}

/* ── Swing seats ──────────────────────────────────────────────────── */

export function SwingTab({ o, onOpenSeat }) {
  const s = o.swing;
  const flips = {};
  s.changed_hands_2018_2023.forEach((r) => { const k = `${partyAsOf(r.from, POLL.AE2018)} → ${r.to}`; flips[k] = (flips[k] || 0) + 1; });
  const flipData = Object.entries(flips).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat value={s.close_2023.length} label={`Seats decided by under ${s.close_pts} pts in 2023`} sub={`BRS won ${s.close_2023_brs_won} of them`} />
        <Stat value={s.changed_hands_2018_2023.length} label="Seats that changed party, 2018 → 2023" />
        <Stat value={s.split_2023_2024.length} label="Seats that voted differently for MLA (2023) and MP (2024)" sub="six months apart, same voters" />
        <Stat value={o.seats} label="Seats in view" />
      </div>

      <Box title={`Close contests, 2023 (margin under ${s.close_pts} percentage points)`} sub="The persuadable seats: a small swing changes the winner. Closest first.">
        <SeatChips rows={s.close_2023} onOpenSeat={onOpenSeat} extra={(r) => `${r.winner_2023} won by ${r.margin_pct_2023} pts`} />
      </Box>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Box title="Seats that changed party, 2018 → 2023" sub="From the 2018 winner to the 2023 winner">
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={flipData} layout="vertical" margin={{ top: 0, right: 30, bottom: 0, left: 10 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="k" width={110} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => [`${v} seats`, 'Changed']} />
                <Bar dataKey="n" fill="#64748b" radius={[0, 4, 4, 0]} isAnimationActive={false}><LabelList dataKey="n" position="right" fontSize={11} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <SeatChips rows={s.changed_hands_2018_2023} onOpenSeat={onOpenSeat} extra={(r) => `${partyAsOf(r.from, POLL.AE2018)}→${r.to}`} />
        </Box>
        <Box title="Same voters, different choice: MLA 2023 vs MP 2024" sub="Winner of the 2023 assembly seat vs the party that led this area in the 2024 Lok Sabha vote">
          <SeatChips rows={s.split_2023_2024} onOpenSeat={onOpenSeat} extra={(r) => `${r.mla_2023}→${r.mp_2024_area}`} />
        </Box>
      </div>

      <Issues issues={s.issues} label="the close-contest seats" />
    </div>
  );
}

/* ── Opposition ───────────────────────────────────────────────────── */

export function OppositionTab({ o, onOpenSeat }) {
  const op = o.opposition;
  const shareData = ELECTIONS.map(([id, label]) => {
    const row = { label };
    op.party_shares.forEach((p) => { row[p.party] = p.share[id]; });
    return row;
  });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat value={op.brs_seats_2018} label="Seats TRS won in 2018" />
        <Stat value={op.brs_held_2023} label="Of those, BRS held in 2023" />
        {op.lost_to.slice(0, 2).map((l) => <Stat key={l.party} value={l.seats} label={`Lost to ${l.party} in 2023`} />)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Box title="Vote share by party, every election" sub="Pooled over all seats in view (MP = votes cast in these assembly areas)">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={shareData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#334155' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v, n) => [`${v}%`, n === 'BRS' ? 'BRS (TRS)' : n]} />
                <Legend formatter={(v) => (v === 'BRS' ? 'BRS (TRS)' : v)} wrapperStyle={{ fontSize: 11 }} />
                {op.party_shares.map((p) => (
                  <Line key={p.party} dataKey={p.party} stroke={partyStyle(p.party).hex} strokeWidth={p.party === 'BRS' ? 3 : 2} dot={{ r: 3 }} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Box>
        <Box title="Where TRS's 2018 seats went in 2023" sub="Seats TRS won in 2018 and lost in 2023, by the party that won them">
          {op.lost_to.map((l) => (
            <div key={l.party} className="mb-3">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700 mb-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: partyStyle(l.party).hex }} />{l.party} · {l.seats} seats
              </div>
              <SeatChips rows={l.list} onOpenSeat={onOpenSeat} extra={(r) => `by ${r.margin_pct_2023} pts`} />
            </div>
          ))}
        </Box>
      </div>

      <Box title="What the parties promised in 2023" sub="Main promises as reported when each manifesto was released">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {op.manifestos_2023.map((m) => (
            <div key={m.party} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: partyStyle(m.party).hex }} />
                <span className="text-[13px] font-bold text-slate-900">{m.party}</span>
                <span className="text-[11px] text-slate-500">— {m.title}</span>
              </div>
              <div className="text-[10px] text-slate-400 mb-2">Released {m.released} · {m.released_by}</div>
              <ul className="space-y-1.5">
                {m.promises.map((p) => (
                  <li key={p.promise} className="text-[12px] text-slate-700">
                    <span className="font-semibold">{p.scheme || p.area}</span>{p.scheme ? <span className="text-slate-400"> · {p.area}</span> : null}: {p.promise}
                  </li>
                ))}
              </ul>
              <div className="text-[10px] text-slate-400 mt-2">
                Source: {m.sources.map((s, i) => <span key={s.url}>{i ? ', ' : ''}<a href={s.url} target="_blank" rel="noopener noreferrer" className="text-pink-700 hover:underline">{s.publisher}</a></span>)}
              </div>
            </div>
          ))}
        </div>
      </Box>
    </div>
  );
}
