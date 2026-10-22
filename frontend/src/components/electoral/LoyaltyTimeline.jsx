import React from 'react';
import { partyStyle } from '../../config/partyColors';
import { partyAsOf } from '../../config/electoralBase';

const ord = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/** One election, in plain words: the area's result, and for MP 2019/2024 the whole seat's too. */
const describe = (t) => {
  const ours = partyAsOf('BRS', t.poll_date);
  const winner = partyAsOf(t.winner_party, t.poll_date);
  const area = t.level === 'assembly_area';
  const lead = area ? 'led here' : 'won';
  const brsText = t.brs_won ? `${ours} ${lead}` : t.brs_place ? `${ours} ${ord(t.brs_place)}` : `${ours} did not contest`;
  const seat = area && t.seat_winner_party
    ? `${t.lok_sabha_seat} seat: ${partyAsOf(t.seat_winner_party, t.poll_date)} won`
    : t.level === 'lok_sabha_seat' ? `Whole ${t.lok_sabha_seat || 'Lok Sabha'} seat` : null;
  return { winner, brsText, seat, area };
};

/**
 * One cell per election, MLA and MP together, in date order. The cell is the
 * winning party's colour; a ✓ marks the elections BRS (TRS before Dec 2022)
 * won — or, for MP 2019/2024, led in this assembly area.
 * `compact` = small cells for the all-seats table.
 */
export default function LoyaltyTimeline({ timeline = [], compact = false, onSelect }) {
  return (
    <div className={`flex ${compact ? 'gap-1' : 'gap-2 flex-wrap'}`}>
      {timeline.map((t) => {
        const st = partyStyle(t.winner_party);
        const d = describe(t);
        const title = `${t.label}: ${d.area ? 'in this assembly area ' : ''}${d.winner} ${d.area ? 'led' : 'won'}. ${d.brsText}.${d.seat ? ` ${d.seat}.` : ''}`;
        const Tag = onSelect ? 'button' : 'div';
        return compact ? (
          <div key={t.id} title={title}
            className="w-[46px] h-7 rounded flex items-center justify-center text-[10px] font-bold"
            style={{ background: st.hex, color: '#ffffff' }}>
            {t.brs_won ? '✓' : d.winner}
          </div>
        ) : (
          <Tag key={t.id} type={onSelect ? 'button' : undefined} title={title} onClick={onSelect ? () => onSelect(t) : undefined}
            className={`min-w-[110px] rounded-lg border px-2.5 py-2 text-left ${t.brs_won ? 'border-pink-300 bg-pink-50' : 'border-slate-200 bg-white'} ${onSelect ? 'hover:shadow-sm' : ''}`}>
            <div className="text-[11px] font-semibold text-slate-500">{t.label}{t.level === 'lok_sabha_seat' ? '*' : ''}</div>
            {d.area && <div className="text-[10px] text-slate-400">this assembly area</div>}
            <div className="flex items-center gap-1.5 mt-1">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: st.hex }} />
              <span className="text-[13px] font-bold text-slate-900">{d.winner}</span>
            </div>
            <div className={`text-[11px] font-semibold mt-0.5 ${t.brs_won ? 'text-emerald-700' : 'text-rose-700'}`}>{d.brsText}</div>
            {d.seat && <div className="text-[10px] text-slate-500 mt-0.5 border-t border-slate-100 pt-0.5">{d.seat}</div>}
          </Tag>
        );
      })}
    </div>
  );
}
