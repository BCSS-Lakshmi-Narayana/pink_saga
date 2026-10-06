/**
 * BoothDataManager
 * ─────────────────────────────────────────────────────────────────────
 * Staged upload of one constituency's ECI electoral roll, shown inside the
 * booth-level panel whenever the seat has no roll yet.
 *
 * The seat is NOT chosen here — it comes from whichever candidate the
 * operator opened, and the server re-resolves it independently. So this
 * component only ever collects: the roll year, the summary file, and the
 * per-booth voter files.
 *
 * ── How the upload works ─────────────────────────────────────────────
 * Files never travel as files. The browser reads and JSON.parses them and
 * posts plain JSON, in batches:
 *
 *   1. POST /booth-imports            → import_id + expected_parts
 *   2. POST /booth-imports/:id/parts  → batches, 3 concurrent, 3 tries each
 *   3. GET  /booth-imports/:id        → confirm nothing is missing
 *   4. POST /booth-imports/:id/commit → the roll goes live
 *
 * Nothing is visible in the app until step 4 succeeds.
 *
 * Booth files are parsed lazily, one batch at a time, rather than all up
 * front — a district's worth of rolls is millions of rows and parsing them
 * all into memory before sending would blow the tab up.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload, FolderOpen, FileJson, Loader2, CheckCircle2, AlertTriangle,
  RotateCcw, X, Calendar, ChevronRight,
} from 'lucide-react';
import api from '../lib/api';

/* Batches are capped by BYTES as well as by count. Count alone is the wrong
   unit — a dense urban booth carries several times the rows of a rural one,
   so "10 parts" can mean 1MB or 20MB. The server accepts 50mb of JSON; 8MB
   per batch keeps a wide margin without making the request count silly. */
const PARTS_PER_BATCH = 10;
const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const CONCURRENCY = 3;
const RETRY_BACKOFF_MS = [0, 1500, 5000];
/* axios has no default timeout, so a stalled connection hangs the upload
   forever with no error and no progress — indistinguishable from "working".
   A finite ceiling turns that into a failure the retry can act on. Generous,
   because a slow tunnel legitimately takes a while to move ~1.3MB. */
const REQUEST_TIMEOUT_MS = 120000;

const BOOTH_FILE_RE = /^(\d+)\.json$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtNum = (n) => (n || n === 0 ? Number(n).toLocaleString('en-IN') : '—');

/** Fixed-size worker pool — keeps CONCURRENCY requests in flight, no more. */
const runPool = async (items, worker, concurrency) => {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
};

/** Retry with backoff. Safe because staging a part is idempotent server-side. */
const withRetry = async (fn) => {
  let lastErr;
  for (let attempt = 0; attempt < RETRY_BACKOFF_MS.length; attempt += 1) {
    if (RETRY_BACKOFF_MS[attempt]) await sleep(RETRY_BACKOFF_MS[attempt]);
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
};

const errMsg = (err, fallback) =>
  err?.response?.data?.message || err?.message || fallback;

/* Group booth files into batches bounded by both count and total bytes. */
const buildBatches = (files) => {
  const batches = [];
  let current = [];
  let bytes = 0;
  files.forEach((f) => {
    if (current.length && (current.length >= PARTS_PER_BATCH || bytes + f.file.size > MAX_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(f);
    bytes += f.file.size;
  });
  if (current.length) batches.push(current);
  return batches;
};

const Field = ({ step, label, children }) => (
  <div>
    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
      {step} · {label}
    </div>
    {children}
  </div>
);

const DropZone = ({ onClick, active, icon: Icon, children, inputRef, onChange, multiple, directory }) => {
  // `webkitdirectory` is not a standard React prop — set it on the DOM node.
  useEffect(() => {
    if (directory && inputRef.current) {
      inputRef.current.setAttribute('webkitdirectory', '');
      inputRef.current.setAttribute('directory', '');
    }
  }, [directory, inputRef]);

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm font-semibold transition-colors ${
          active
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
            : 'border-slate-300 bg-white text-slate-600 hover:border-violet-300 hover:bg-violet-50'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate text-left">{children}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        multiple={multiple}
        onChange={onChange}
        className="hidden"
      />
    </>
  );
};

const BoothDataManager = ({ constituency, acNumber, onCommitted, onCancel, existingRollYear }) => {
  const [rollYear, setRollYear] = useState(String(new Date().getFullYear()));
  const [rollLabel, setRollLabel] = useState('');

  const [summaryFile, setSummaryFile] = useState(null);
  const [summaryRows, setSummaryRows] = useState(null);
  const [boothFiles, setBoothFiles] = useState([]);
  const [ignoredCount, setIgnoredCount] = useState(0);

  // 'idle' | 'creating' | 'uploading' | 'committing' | 'done'
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0, voters: 0 });
  // Batches run 3-at-a-time and only report on completion, so the counter can
  // legitimately sit at 0 for a while on a slow link. An elapsed clock is the
  // difference between "still working" and "apparently frozen".
  const [elapsed, setElapsed] = useState(0);
  // Last batch's { server, roundTrip, network } split, in ms.
  const [timing, setTiming] = useState(null);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [result, setResult] = useState(null);
  const [failedParts, setFailedParts] = useState([]);

  const summaryInput = useRef(null);
  const filesInput = useRef(null);
  const folderInput = useRef(null);
  const cancelled = useRef(false);

  // Must set the flag back to false on (re-)mount, not just true on unmount:
  // StrictMode runs effects mount → unmount → mount in development, so a
  // cleanup-only guard latches true before the user ever clicks Upload and
  // silently no-ops every batch. run() resets it too, so the guard can only
  // ever mean "the component went away mid-run".
  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  useEffect(() => {
    if (phase !== 'uploading' && phase !== 'committing') return undefined;
    const started = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const busy = phase === 'creating' || phase === 'uploading' || phase === 'committing';

  const partRange = useMemo(() => {
    if (!boothFiles.length) return null;
    const parts = boothFiles.map((f) => f.part);
    return { min: Math.min(...parts), max: Math.max(...parts) };
  }, [boothFiles]);

  /* ── File selection ─────────────────────────────────────────────── */

  const onPickSummary = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const rows = JSON.parse(await file.text());
      if (!Array.isArray(rows) || rows.length === 0) {
        setError('Summary file must be a non-empty JSON array.');
        return;
      }
      if (!rows.some((r) => Number.isFinite(Number(r?.part)))) {
        setError('Summary rows have no `part` field — this does not look like a booth summary file.');
        return;
      }
      setSummaryFile(file);
      setSummaryRows(rows);
    } catch (err) {
      setError(`Could not read ${file.name}: ${err.message}`);
    }
  };

  const onPickBooths = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    setError(null);

    const accepted = [];
    let ignored = 0;
    picked.forEach((file) => {
      // Strip any directory prefix the folder picker attaches.
      const base = (file.name || '').split('/').pop();
      const m = BOOTH_FILE_RE.exec(base);
      // The summary file itself lands here when a whole folder is picked —
      // it is reported as ignored rather than silently dropped.
      if (!m) { ignored += 1; return; }
      accepted.push({ part: Number(m[1]), file });
    });

    accepted.sort((a, b) => a.part - b.part);
    setBoothFiles(accepted);
    setIgnoredCount(ignored);
  };

  const reset = useCallback(() => {
    setSummaryFile(null);
    setSummaryRows(null);
    setBoothFiles([]);
    setIgnoredCount(0);
    setPhase('idle');
    setProgress({ done: 0, total: 0, voters: 0 });
    setError(null);
    setWarning(null);
    setResult(null);
    setFailedParts([]);
    setTiming(null);
  }, []);

  /* ── The upload ─────────────────────────────────────────────────── */

  const run = async () => {
    cancelled.current = false;
    setError(null);
    setWarning(null);
    setFailedParts([]);

    if (!summaryRows) { setError('Select the constituency summary file first.'); return; }
    if (!boothFiles.length) { setError('Select the per-booth voter files.'); return; }

    let importId = null;
    try {
      // ── 1. Create the session ──
      setPhase('creating');
      const created = await api.post('/booth-imports', {
        ac_number: acNumber,
        constituency,
        roll_year: Number(rollYear),
        roll_label: rollLabel.trim() || undefined,
        summary: summaryRows,
      });

      importId = created.data.import_id;
      const expected = new Set(created.data.expected_parts || []);

      if (created.data.existing_staging) {
        setWarning(`A previous unfinished upload exists for this seat and year (${created.data.existing_staging.received}/${created.data.existing_staging.expected} booths staged). It will be left untouched — abort it from the imports list if it is stale.`);
      }

      // Drop files the summary never declared, BEFORE sending anything.
      // This is what catches "seat A's summary + seat B's folder".
      const toSend = boothFiles.filter((f) => expected.has(f.part));
      const skipped = boothFiles.length - toSend.length;
      if (!toSend.length) {
        setError(`None of the ${boothFiles.length} selected booth files match the parts listed in this summary. Are the summary and the folder from the same constituency?`);
        setPhase('idle');
        return;
      }
      if (skipped > 0) {
        setWarning((w) => [w, `${skipped} file(s) were not listed in the summary and were skipped.`].filter(Boolean).join(' '));
      }

      // ── 2. Stage the parts ──
      setPhase('uploading');
      const batches = buildBatches(toSend);
      setProgress({ done: 0, total: batches.length, voters: 0 });

      const failed = [];
      await runPool(batches, async (batch) => {
        if (cancelled.current) return;
        try {
          const parts = await Promise.all(batch.map(async ({ part, file }) => ({
            part,
            voters: JSON.parse(await file.text()),
          })));

          const sentAt = Date.now();
          const res = await withRetry(() => api.post(
            `/booth-imports/${importId}/parts`,
            { parts },
            { timeout: REQUEST_TIMEOUT_MS },
          ));
          const roundTrip = Date.now() - sentAt;
          (res.data?.rejected || []).forEach((r) => failed.push(r));

          // The server reports how long it spent. Everything else in the
          // round trip is network, proxy and body transfer — which is the
          // only way to tell a slow database from a slow pipe.
          const serverMs = res.data?.timings?.total_ms ?? null;
          setTiming(serverMs == null ? null : {
            server: serverMs,
            roundTrip,
            network: Math.max(0, roundTrip - serverMs),
          });

          setProgress((p) => ({
            done: p.done + 1,
            total: p.total,
            voters: res.data?.voters_staged ?? p.voters,
          }));
        } catch (err) {
          batch.forEach(({ part }) => failed.push({ part, reason: errMsg(err, 'upload failed') }));
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      }, CONCURRENCY);

      if (cancelled.current) return;

      // ── 3. Read back before committing ──
      const status = await api.get(`/booth-imports/${importId}`);
      const missing = status.data?.missing_parts || [];
      setFailedParts(failed);

      if (missing.length) {
        const ok = window.confirm(
          `${missing.length} of ${status.data.expected_parts} booth files did not land.\n\n` +
          `Parts: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}\n\n` +
          'Commit anyway? Those booths will show as having no roll.\n' +
          'Cancel to leave the upload staged so you can retry.',
        );
        if (!ok) {
          setPhase('idle');
          setWarning(`Upload left staged with ${missing.length} booth(s) missing — nothing is live yet.`);
          return;
        }
      }

      // ── 4. Commit — this is what makes the roll visible ──
      setPhase('committing');
      const committed = await api.post(
        `/booth-imports/${importId}/commit?allow_partial=true`,
      );

      setResult(committed.data);
      setPhase('done');
      if (onCommitted) onCommitted();
    } catch (err) {
      setError(errMsg(err, 'Upload failed'));
      setPhase('idle');
      // Leave the session staged rather than deleting it — the rows already
      // written are invisible, and keeping them lets the operator retry.
      if (importId) {
        setWarning(`Import ${importId} is still staged and invisible. Re-run the upload to replace it, or abort it from the imports list.`);
      }
    }
  };

  /* ── Result screen ──────────────────────────────────────────────── */

  if (phase === 'done' && result) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="max-w-sm w-full text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          </div>
          <div className="text-sm font-bold text-slate-800 mb-1">
            Roll is live for {result.constituency}
          </div>
          <div className="text-xs text-slate-500 mb-4">
            {fmtNum(result.booths_with_roll)} of {fmtNum(result.booths_written)} booths ·{' '}
            {fmtNum(result.voters_total)} voters · {result.roll_year}
            {result.missing_parts?.length ? ` · ${result.missing_parts.length} missing` : ''}
          </div>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Upload another roll
          </button>
        </div>
      </div>
    );
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <div className="mb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-bold text-slate-800">Booth-Level Voter Roll</div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="shrink-0 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          )}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">
          {existingRollYear
            ? <>Uploading a new roll for <span className="font-semibold text-slate-600">{constituency}</span>. Use year <b>{existingRollYear}</b> to replace the live roll, or a different year to keep both.</>
            : <>No roll has been uploaded for <span className="font-semibold text-slate-600">{constituency}</span> yet. Upload the constituency summary and its per-booth voter files.</>}
          {' '}Nothing goes live until every batch has landed and the import is committed.
        </div>
      </div>

      <div className="space-y-4">
        <Field step="1" label="Roll year">
          <div className="flex gap-2">
            <div className="relative w-32 shrink-0">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="number"
                value={rollYear}
                onChange={(e) => setRollYear(e.target.value)}
                disabled={busy}
                className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 py-2 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>
            <input
              type="text"
              value={rollLabel}
              onChange={(e) => setRollLabel(e.target.value)}
              disabled={busy}
              placeholder="Revision (optional) — e.g. Final Roll, SSR"
              className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
            />
          </div>
          <div className="text-[10px] text-slate-400 mt-1.5">
            Each year is kept separately — uploading {rollYear || 'a new year'} does not replace an earlier
            roll for this seat. Re-uploading the same year does replace it.
          </div>
        </Field>

        <Field step="2" label="Summary file">
          <DropZone
            inputRef={summaryInput}
            onClick={() => !busy && summaryInput.current?.click()}
            onChange={onPickSummary}
            active={Boolean(summaryFile)}
            icon={FileJson}
          >
            {summaryFile
              ? `${summaryFile.name} — ${fmtNum(summaryRows?.length)} booths`
              : 'Select <constituency>.summary.json'}
          </DropZone>
        </Field>

        <Field step="3" label="Booth voter files">
          <div className="grid grid-cols-2 gap-2">
            <DropZone
              inputRef={filesInput}
              onClick={() => !busy && filesInput.current?.click()}
              onChange={onPickBooths}
              active={boothFiles.length > 0}
              icon={Upload}
              multiple
            >
              Select files
            </DropZone>
            <DropZone
              inputRef={folderInput}
              onClick={() => !busy && folderInput.current?.click()}
              onChange={onPickBooths}
              active={false}
              icon={FolderOpen}
              multiple
              directory
            >
              Pick whole folder
            </DropZone>
          </div>
          {boothFiles.length > 0 && (
            <div className="text-[11px] text-slate-500 mt-1.5">
              {fmtNum(boothFiles.length)} booth file(s) ready
              {partRange ? ` · parts ${partRange.min}–${partRange.max}` : ''}
              {ignoredCount > 0 && (
                <span className="text-amber-600"> · ignored {ignoredCount} file(s) not named like 1.json</span>
              )}
            </div>
          )}
        </Field>

        {(phase === 'uploading' || phase === 'committing') && (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-2">
              <span>
                {phase === 'committing'
                  ? 'Committing…'
                  : `Uploading batch ${progress.done}/${progress.total}`}
              </span>
              <span className="text-slate-500">{fmtNum(progress.voters)} voters staged</span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1.5">
              <span>
                {phase === 'uploading' && progress.done < progress.total
                  ? `${Math.min(CONCURRENCY, progress.total - progress.done)} batch(es) in flight`
                  : 'Writing booth rows'}
              </span>
              <span>{elapsed}s elapsed</span>
            </div>
            {timing && (
              <div className="text-[10px] text-slate-400 mb-1.5">
                last batch · server {timing.server}ms · network {timing.network}ms
                {timing.network > timing.server * 3 && timing.network > 1000 && (
                  <span className="text-amber-600 font-semibold"> — bottleneck is the connection, not the database</span>
                )}
              </div>
            )}
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-violet-500 transition-[width] duration-300"
                style={{ width: `${phase === 'committing' ? 100 : pct}%` }}
              />
            </div>
          </div>
        )}

        {warning && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{warning}</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
            <X className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {failedParts.length > 0 && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
            <div className="text-[11px] font-bold text-rose-800 mb-1">
              {failedParts.length} booth(s) rejected
            </div>
            <div className="text-[10px] text-rose-700 max-h-24 overflow-y-auto space-y-0.5">
              {failedParts.slice(0, 25).map((f, i) => (
                <div key={`${f.part}-${i}`}>Part {f.part}: {f.reason}</div>
              ))}
              {failedParts.length > 25 && <div>…and {failedParts.length - 25} more</div>}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={run}
            disabled={busy || !summaryRows || !boothFiles.length}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-violet-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {busy ? 'Working…' : 'Upload & commit'}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        </div>
      </div>
    </div>
  );
};

export default BoothDataManager;
