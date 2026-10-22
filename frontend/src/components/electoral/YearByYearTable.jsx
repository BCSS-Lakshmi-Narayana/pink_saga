import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts';
import { loyaltyBand, LOYALTY_BANDS } from '../../config/electoralBase';
import { partyStyle } from '../../config/partyColors';
import LoyaltyTimeline from './LoyaltyTimeline';

const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const COLUMNS = ['MLA 2014', 'MP 2014', 'MLA 2018', 'MP 2019', 'MLA 2023', 'MP 2024'];

/**
 * Every seat, year by year: who won each MLA and MP election and whether BRS
 * (TRS) did. Sorted most-loyal first, so the seats BRS keeps winning lead.
 */
export default function YearByYearTable({ seats, onOpenSeat }) {
  const [query, setQuery] = useState('');
  const [district, setDistrict] = useState('');
  const [sort, setSort] = useState('loyal');

  const districts = useMemo(() => [...new Set(seats.map((s) => s.district))].sort(), [seats]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = seats
      .filter((s) => !district || s.district === district)
      .filter((s) => !q || s.constituency.toLowerCase().includes(q));
    const by = {
      loyal: (a, b) => (b.brs_wins - a.brs_wins) || a.ac_number - b.ac_number,
      least: (a, b) => (a.brs_wins - b.brs_wins) || a.ac_number - b.ac_number,
      number: (a, b) => a.ac_number - b.ac_number,
    }[sort];
    return [...list].sort(by);
  }, [seats, query, district, sort]);

  const dist = useMemo(() => [6, 5, 4, 3, 2, 1, 0].map((n) => ({
    label: `${n} of 6`, wins: n, seats: rows.filter((s) => s.brs_wins === n).length,
  })), [rows]);
  const perElection = useMemo(() => COLUMNS.map((label) => ({
    label, won: rows.filter((s) => s.timeline.find((t) => t.label === label)?.brs_won).length,
  })), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search seat…"
            className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-[12px] w-48 bg-white" />
        </div>
        <select value={district} onChange={(e) => setDistrict(e.target.value)} className="text-[12px] border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
          <option value="">All districts</option>
          {districts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="text-[12px] border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
          <option value="loyal">Most BRS (TRS) wins first</option>
          <option value="least">Fewest BRS (TRS) wins first</option>
          <option value="number">Constituency number</option>
        </select>
        <span className="text-[12px] text-slate-500">{rows.length} seats</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[13px] font-semibold text-slate-800">Seats by number of BRS (TRS) wins (out of 6 elections)</div>
          <div className="h-[200px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dist} margin={{ top: 18, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#334155' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => [`${v} seats`, 'Seats']} />
                <Bar dataKey="seats" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {dist.map((d) => <Cell key={d.wins} fill={loyaltyBand(d.wins).hex} stroke="#cbd5e1" />)}
                  <LabelList dataKey="seats" position="top" fontSize={11} fill="#334155" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[13px] font-semibold text-slate-800">Seats BRS (TRS) won or led, election by election ({rows.length} seats shown)</div>
          <div className="h-[200px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perElection} margin={{ top: 18, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#334155' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => [`${v} of ${rows.length}`, 'BRS (TRS) won or led']} />
                <Bar dataKey="won" fill={partyStyle('BRS').hex} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="won" position="top" fontSize={11} fill="#334155" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-[12px]">
          <thead className="text-[11px] text-slate-500 border-b border-slate-200">
            <tr>
              <th className="text-left font-medium px-4 py-2">Constituency</th>
              <th className="text-left font-medium px-2">BRS (TRS) won or led</th>
              <th className="text-left font-medium px-2">
                <div className="flex gap-1">{COLUMNS.map((c) => <span key={c} className="w-[46px] text-center">{c.replace(' 20', " '")}</span>)}</div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((s) => {
              const band = loyaltyBand(s.brs_wins);
              return (
                <tr key={s.key} onClick={() => onOpenSeat?.(s.constituency)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-1.5">
                    <div className="font-semibold text-slate-800">{titleCase(s.constituency)}</div>
                    <div className="text-[10px] text-slate-400">{s.district} · MP seat: {s.lok_sabha}</div>
                  </td>
                  <td className="px-2">
                    <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded tabular-nums" style={{ background: band.hex, color: band.text }}>
                      {s.brs_wins} of {s.elections_counted}
                    </span>
                  </td>
                  <td className="px-2 py-1.5"><LoyaltyTimeline timeline={s.timeline.filter((t) => !t.bypoll)} compact /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 px-1">
        <span>Cell colour = party that won · <b className="text-slate-700">✓</b> = BRS (TRS) won, or for MP 2019/2024 led in that assembly area · click a row to open the seat</span>
        {LOYALTY_BANDS.map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border border-slate-300/60" style={{ background: b.hex }} />{b.label}</span>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 px-1">
        MLA = assembly election for the seat. MP 2019 and 2024 = how voters in this assembly area voted in the Lok Sabha election (ECI assembly-segment results).
        MP 2014 = the whole Lok Sabha seat's result (2014 results by assembly area were not published in machine-readable form). By-polls appear in each seat's own view.
      </p>
    </div>
  );
}
