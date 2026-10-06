/**
 * BoothRollManager
 * ─────────────────────────────────────────────────────────────────────
 * Management strip shown above the booth grid once a seat holds a roll.
 * Lists every committed roll for the seat — one per year, newest first —
 * and offers the three things you can do to one:
 *
 *   Replace  → re-run the staged upload for that year. Committing the new
 *              one supersedes the old atomically; nothing is deleted here.
 *   Edit     → change the year / revision label only. The roll's DATA is
 *              never patched in place — see updateImport for why.
 *   Delete   → remove the roll and every booth + voter row under it.
 *
 * Delete is a two-call handshake rather than a `window.confirm`: the first
 * DELETE comes back 409 with the exact row counts, which is what gets shown
 * in the confirmation. The operator therefore confirms against numbers the
 * server just counted, not numbers the browser is guessing at.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Trash2, Pencil, UploadCloud, Check, X, AlertTriangle, Database, FileWarning,
} from 'lucide-react';
import api from '../lib/api';

const fmtNum = (n) => (n || n === 0 ? Number(n).toLocaleString('en-IN') : '—');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const errMsg = (e, f) => e?.response?.data?.message || e?.message || f;

const BoothRollManager = ({ constituencyKey, activeImportId, source, onReplace, onChanged }) => {
  const [rolls, setRolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  // { id, booths, voters, roll_year } once the server has told us what a
  // delete would actually remove.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [editing, setEditing] = useState(null); // { id, year, label }

  const load = useCallback(() => {
    if (!constituencyKey) { setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    // Staging sessions are listed alongside committed rolls: an upload that
    // died mid-flight leaves invisible rows behind, and this is the only
    // place an operator can see it exists and clear it out.
    api.get('/booth-imports', { params: { constituency_key: constituencyKey } })
      .then((res) => {
        if (cancelled) return;
        setRolls((res.data?.data || []).filter((r) => r.status === 'committed' || r.status === 'staging'));
      })
      .catch(() => { if (!cancelled) setRolls([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [constituencyKey]);

  useEffect(load, [load]);

  /* First DELETE is the question, second is the answer. */
  const askDelete = async (roll) => {
    setError(null);
    setBusyId(roll.import_id);
    try {
      await api.delete(`/booth-imports/${roll.import_id}`);
      // No 409 means it was a staging session and is already gone.
      load();
      if (onChanged) onChanged();
    } catch (err) {
      const d = err?.response?.data;
      if (err?.response?.status === 409 && d?.code === 'CONFIRM_REQUIRED') {
        setPendingDelete({ id: roll.import_id, booths: d.booths, voters: d.voters, roll_year: d.roll_year });
      } else {
        setError(errMsg(err, 'Could not delete this roll'));
      }
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    setBusyId(target.id);
    setError(null);
    try {
      await api.delete(`/booth-imports/${target.id}`, { params: { confirm: 'true' } });
      load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(errMsg(err, 'Could not delete this roll'));
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async () => {
    const { id, year, label } = editing;
    setBusyId(id);
    setError(null);
    try {
      await api.put(`/booth-imports/${id}`, {
        roll_year: Number(year),
        roll_label: label.trim() || null,
      });
      setEditing(null);
      load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(errMsg(err, 'Could not update this roll'));
    } finally {
      setBusyId(null);
    }
  };

  /* The two bundled seats predate the upload pipeline and have no session
     to manage — say so plainly instead of showing empty controls. */
  if (source === 'file') {
    return (
      <div className="mx-5 mt-4 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <div className="flex items-start gap-2">
          <FileWarning className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-slate-600">
              Served from the bundled data file — there is no import record to edit or delete.
              Upload a roll to bring this seat under management.
            </div>
            <button
              type="button"
              onClick={onReplace}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[10px] font-bold text-violet-700 hover:bg-violet-100"
            >
              <UploadCloud className="h-3 w-3" /> Upload roll
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-5 mt-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide">
          <Database className="h-3 w-3" /> Uploaded rolls
        </div>
        <button
          type="button"
          onClick={onReplace}
          className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700 hover:bg-violet-100"
        >
          <UploadCloud className="h-3 w-3" /> Upload / replace
        </button>
      </div>

      {loading ? (
        <div className="px-3 py-4 flex justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
        </div>
      ) : rolls.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-slate-400">No uploaded rolls for this seat.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {rolls.map((r) => {
            const isActive = String(r.import_id) === String(activeImportId);
            const isEditing = editing?.id === r.import_id;
            const isBusy = busyId === r.import_id;
            const isStaging = r.status === 'staging';

            return (
              <div key={r.import_id} className="px-3 py-2">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={editing.year}
                      onChange={(e) => setEditing((s) => ({ ...s, year: e.target.value }))}
                      className="w-20 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
                    />
                    <input
                      type="text"
                      value={editing.label}
                      onChange={(e) => setEditing((s) => ({ ...s, label: e.target.value }))}
                      placeholder="Revision label"
                      className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
                    />
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={isBusy}
                      className="rounded-md bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
                      title="Save"
                    >
                      {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
                      title="Cancel"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-700">{r.roll_year}</span>
                        {r.roll_label && (
                          <span className="text-[9px] font-semibold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
                            {r.roll_label}
                          </span>
                        )}
                        {isActive && !isStaging && (
                          <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                            LIVE
                          </span>
                        )}
                        {isStaging && (
                          <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                            UNFINISHED
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                        {isStaging
                          ? `${fmtNum(r.received)}/${fmtNum(r.expected)} booths staged · not live · started ${fmtDate(r.created_at)}`
                          : `${fmtNum(r.booths_total)} booths · ${fmtNum(r.voters_total)} voters · ${fmtDate(r.committed_at)}`}
                      </div>
                    </div>
                    {!isStaging && (
                      <button
                        type="button"
                        onClick={() => setEditing({ id: r.import_id, year: String(r.roll_year), label: r.roll_label || '' })}
                        disabled={isBusy}
                        className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                        title="Edit year / label"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => askDelete(r)}
                      disabled={isBusy}
                      className="rounded-md border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                      title={isStaging ? 'Discard this unfinished upload' : 'Delete this roll'}
                    >
                      {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </button>
                  </div>
                )}

                {pendingDelete?.id === r.import_id && (
                  <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2">
                    <div className="flex items-start gap-1.5 text-[10px] text-rose-800">
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                      <span>
                        Permanently delete the {pendingDelete.roll_year} roll —{' '}
                        <b>{fmtNum(pendingDelete.booths)} booths</b> and{' '}
                        <b>{fmtNum(pendingDelete.voters)} voter records</b>. This cannot be undone.
                      </span>
                    </div>
                    <div className="flex gap-1.5 mt-2">
                      <button
                        type="button"
                        onClick={confirmDelete}
                        className="rounded-md bg-rose-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-rose-700"
                      >
                        Delete permanently
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(null)}
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 border-t border-rose-100 bg-rose-50 text-[10px] text-rose-700">{error}</div>
      )}
    </div>
  );
};

export default BoothRollManager;
