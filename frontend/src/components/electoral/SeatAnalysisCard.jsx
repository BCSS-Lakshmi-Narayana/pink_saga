import React from 'react';
import { partyStyle } from '../../config/partyColors';
import { partyAsOf } from '../../config/electoralBase';

const fmtInt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
const SEAT_TYPE = { GEN: 'General', SC: 'SC-reserved', ST: 'ST-reserved' };

const Panel = ({ title, children }) => (
  <div className="rounded-lg border border-slate-200 p-3">
    <div className="text-[12px] font-semibold text-slate-800 mb-2">{title}</div>
    {children}
  </div>
);

const Fact = ({ ok, children }) => (
  <div className="flex items-start gap-2 text-[12px] text-slate-700 mb-1.5">
    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${ok == null ? 'bg-slate-300' : ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
    <span>{children}</span>
  </div>
);

/**
 * The client's three questions for one seat — core support, swing, opposition —
 * plus who the voters are and what they raise. Every line is a published
 * result or a count of this platform's own posts; nothing is scored.
 */
export default function SeatAnalysisCard({ seat }) {
  const f = seat.facts;
  if (!f) return null;
  const a23 = seat.assembly.AE2023;
  // Parties that mattered here: 5 %+ of the vote in either election.
  const change = f.vote_share_change_2018_2023.filter((c) => c.share_2018 >= 5 || c.share_2023 >= 5);
  const d = f.demographics;
  const issues = seat.issues;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-[16px] font-bold text-slate-900 mb-3">Seat analysis</h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-3">
        <Panel title="Core support">
          <Fact ok={seat.brs_wins >= 4}>BRS (TRS) won or led in <b>{seat.brs_wins} of {seat.elections_counted}</b> MLA and MP elections since 2014.</Fact>
          <Fact ok={seat.brs_assembly_wins >= 2}>Won the MLA seat in <b>{seat.brs_assembly_wins} of 3</b> assembly elections.</Fact>
          {seat.defected_mla && <Fact ok={false}>Elected MLA {seat.defected_mla.name} has since crossed to {seat.defected_mla.now_with}.</Fact>}
        </Panel>

        <Panel title="Swing">
          <Fact ok={!f.close_2023}>
            2023 was decided by <b>{f.margin_pct_2023} pts</b> ({a23.winner_party} won){f.close_2023 ? ' — a close contest; a small swing changes the winner.' : '.'}
          </Fact>
          <Fact ok={f.changed_hands_2018_2023 ? f.changed_hands_2018_2023.to === 'BRS' : null}>
            {f.changed_hands_2018_2023
              ? <>Changed party in 2023: <b>{partyAsOf(f.changed_hands_2018_2023.from, '2018-12-07')} → {f.changed_hands_2018_2023.to}</b>.</>
              : <>Same party won in 2018 and 2023.</>}
          </Fact>
          <Fact ok={f.split_2023_2024 ? f.split_2023_2024.mp_2024_area === 'BRS' : null}>
            {f.split_2023_2024
              ? <>Voters split: <b>{f.split_2023_2024.mla_2023}</b> won the MLA seat (2023), <b>{f.split_2023_2024.mp_2024_area}</b> led here for MP (2024).</>
              : <>Same party won here for MLA (2023) and led for MP (2024).</>}
          </Fact>
        </Panel>

        <Panel title="Opposition: who gained, 2018 → 2023">
          <table className="w-full text-[12px] tabular-nums">
            <thead className="text-[11px] text-slate-400">
              <tr><th className="text-left font-normal">Party</th><th className="text-right font-normal">2018</th><th className="text-right font-normal">2023</th><th className="text-right font-normal">Change</th></tr>
            </thead>
            <tbody>
              {change.map((c) => (
                <tr key={c.party} className={c.party === 'BRS' ? 'font-semibold' : ''}>
                  <td className="py-0.5"><span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: partyStyle(c.party).hex }} />{c.party === 'BRS' ? 'BRS (TRS)' : c.party}
                  </span></td>
                  <td className="text-right text-slate-500">{c.share_2018}%</td>
                  <td className="text-right">{c.share_2023}%</td>
                  <td className={`text-right font-semibold ${c.change > 0 ? 'text-emerald-700' : c.change < 0 ? 'text-rose-700' : ''}`}>{c.change > 0 ? '+' : ''}{c.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[11px] text-slate-500 mt-2">
            MP 2024: {seat.timeline.find((t) => t.id === 'LS2024')?.winner_party} led this area; {f.lok_sabha_seat_2024_winner} won the {seat.lok_sabha} seat.
          </div>
        </Panel>

        <Panel title="Voters">
          <table className="w-full text-[12px] tabular-nums">
            <tbody>
              <tr><td className="py-0.5 text-slate-500">Seat type</td><td className="text-right font-semibold">{SEAT_TYPE[d.seat_type] || d.seat_type}</td></tr>
              <tr><td className="py-0.5 text-slate-500">Electors (2023)</td><td className="text-right font-semibold">{fmtInt(d.electors_2023)}</td></tr>
              <tr><td className="py-0.5 text-slate-500">Women electors</td><td className="text-right font-semibold">{d.women_electors_pct != null ? `${d.women_electors_pct}%` : '—'}</td></tr>
              <tr><td className="py-0.5 text-slate-500">Turnout 2014 · 2018 · 2023</td><td className="text-right font-semibold">{d.turnout.AE2014}% · {d.turnout.AE2018}% · {d.turnout.AE2023}%</td></tr>
              <tr><td className="py-0.5 text-slate-500">Turnout MP 2024 (area)</td><td className="text-right font-semibold">{d.turnout.LS2024}%</td></tr>
            </tbody>
          </table>
          <div className="text-[10px] text-slate-400 mt-1">ECI. Caste, religion or income are not published per seat.</div>
        </Panel>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 p-3">
        <div className="text-[12px] font-semibold text-slate-800">What people here are raising</div>
        <div className="text-[11px] text-slate-500 mb-2">
          Topics of {issues?.posts || 0} public posts located in this seat, last {issues?.days || 30} days (collected by this platform) · {issues?.negative_pct || 0}% negative in tone
        </div>
        {issues?.top?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {issues.top.map((t) => <span key={t.topic} className="text-[12px] bg-slate-100 text-slate-700 rounded px-2 py-0.5">{t.topic} · {t.count}</span>)}
          </div>
        ) : <p className="text-[12px] text-slate-400">No classified posts located in this seat in the last 30 days.</p>}
      </div>
    </section>
  );
}
