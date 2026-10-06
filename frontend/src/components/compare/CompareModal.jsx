import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Swords, RefreshCw, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import api from '../../lib/api';
import { partyColor, initialOf, titleCase } from './compareUtils';
import CandidateComparePicker from './CandidateComparePicker';
import ComparisonView from './ComparisonView';

/* Identity chip for the sticky header — one per candidate. */
const IdentityChip = ({ name, constituency, party, align = 'left', onChange }) => {
  const pc = partyColor(party);
  return (
    <div className={`flex items-center gap-2.5 min-w-0 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm"
        style={{ background: pc.main }}
      >
        {initialOf(name)}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold text-slate-800 truncate">{name}</div>
        <div className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
          <span className="text-[11px] text-slate-500 truncate">{titleCase(constituency)}</span>
          <span className="text-[9px] font-bold px-1.5 rounded-full" style={{ color: pc.text, background: pc.soft }}>{party}</span>
        </div>
        {onChange && (
          <button type="button" onClick={onChange} className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium mt-0.5">
            Change candidate
          </button>
        )}
      </div>
    </div>
  );
};

const EmptyOpponent = () => (
  <div className="flex items-center gap-2.5 text-slate-400">
    <div className="w-10 h-10 rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center shrink-0">
      <Swords className="h-4 w-4" />
    </div>
    <div className="text-sm font-medium">Select a candidate →</div>
  </div>
);

const LoadingState = () => (
  <div className="p-6 space-y-4">
    <div className="h-20 rounded-2xl bg-slate-100 animate-pulse" />
    <div className="h-52 rounded-2xl bg-slate-100 animate-pulse" />
    <div className="grid grid-cols-2 gap-4">
      <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />
      <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />
    </div>
    <div className="flex items-center justify-center gap-2 text-sm text-slate-400 pt-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Drawing the comparison…
    </div>
  </div>
);

const CompareModal = ({ open, onClose, me }) => {
  const [opponent, setOpponent] = useState(null); // constituency string
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const meConst = me?.constituency || '';

  const runCompare = useCallback((oppConst) => {
    if (!meConst || !oppConst) return;
    setStatus('loading');
    setError(null);
    api.get('/constituency-intel/compare', { params: { a: meConst, b: oppConst, days: 90 } })
      .then((res) => {
        setData(res.data);
        setStatus('ready');
      })
      .catch((err) => {
        setError(err?.response?.data?.message || 'Could not build the comparison. Please try again.');
        setStatus('error');
      });
  }, [meConst]);

  useEffect(() => {
    if (opponent) runCompare(opponent);
  }, [opponent, runCompare]);

  // Reset everything when the modal is closed so it reopens on the picker.
  useEffect(() => {
    if (!open) {
      setOpponent(null);
      setStatus('idle');
      setData(null);
      setError(null);
    }
  }, [open]);

  const handleChange = () => {
    setOpponent(null);
    setStatus('idle');
    setData(null);
    setError(null);
  };

  const oppMla = data?.b?.mla;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden sm:rounded-2xl">
        <DialogTitle className="sr-only">Compare candidates</DialogTitle>

        {/* Sticky header — both identities + VS */}
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-slate-200 bg-white shrink-0">
          <div className="flex-1 min-w-0">
            {me && <IdentityChip name={me.mla} constituency={meConst} party={me.party} />}
          </div>
          <div className="shrink-0 flex flex-col items-center">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-md">
              <Swords className="h-4 w-4" />
            </div>
            <span className="text-[9px] font-bold text-slate-400 mt-0.5 tracking-wider">VS</span>
          </div>
          <div className="flex-1 min-w-0 flex justify-end pr-8">
            {opponent && oppMla
              ? <IdentityChip name={oppMla.name} constituency={data.b.constituency} party={oppMla.party} align="right" onChange={handleChange} />
              : opponent
                ? <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                : <EmptyOpponent />}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden bg-slate-50">
          <AnimatePresence mode="wait">
            {!opponent ? (
              <motion.div
                key="picker"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="h-full bg-white"
              >
                <CandidateComparePicker meKey={me?.key} onSelect={setOpponent} />
              </motion.div>
            ) : (
              <motion.div
                key="compare"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="h-full overflow-y-auto px-4 md:px-6 py-5"
              >
                {status === 'loading' && <LoadingState />}
                {status === 'error' && (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                    <AlertTriangle className="h-8 w-8 text-amber-500" />
                    <div className="text-sm text-slate-600 max-w-sm">{error}</div>
                    <button
                      type="button"
                      onClick={() => runCompare(opponent)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-700"
                    >
                      <RefreshCw className="h-4 w-4" /> Retry
                    </button>
                  </div>
                )}
                {status === 'ready' && data && (
                  // Key by opponent so switching candidates remounts → the whole
                  // comparison re-animates (count-ups, bar growth, staggered reveal).
                  <ComparisonView key={opponent} data={data} />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CompareModal;
