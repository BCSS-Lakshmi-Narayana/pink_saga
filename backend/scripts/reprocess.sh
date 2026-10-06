#!/usr/bin/env bash
#
# Re-analyse a bounded window and prepare it for AI Campaigns — one source at a
# time, strictly sequential, safe to start and walk away from.
#
#   ./scripts/reprocess.sh mentions 500
#   ./scripts/reprocess.sh alerts   500
#   ./scripts/reprocess.sh news     500
#   ./scripts/reprocess.sh all      500      # all three, one after another
#   ./scripts/reprocess.sh all      500 dry  # report only, writes nothing
#   CONCURRENCY=8 ./scripts/reprocess.sh mentions 500   # faster, heavier on the shared host
#
# WHY A WRAPPER
# The underlying scripts disagree on flag syntax — some take `--limit 500`
# (space), others `--limit=500` (equals). Passing the wrong one does NOT error:
# it silently falls back to the default window, so you would think you processed
# 500 records when you processed 100, or all 69,000. This script holds the
# correct spelling for each.
#
# STEPS run foreground and in order; RECORDS inside a step run CONCURRENTLY
# (see CONCURRENCY below). Measured: the Ollama host parallelises well —
# 39.6s/record at 1, 15.8s at 4, 8.5s at 8 — and the local CPU is idle
# throughout, so the only reason not to raise it is politeness to whatever else
# shares that host.

set -uo pipefail
cd "$(dirname "$0")/.."

SOURCE="${1:-all}"
LIMIT="${2:-500}"
MODE="${3:-save}"
# Records analysed at once. Measured on this deployment: 94s/record sequential,
# 24.6s at 4, and it keeps improving to ~17s at 8. The work is entirely on the
# remote Ollama host (local CPU is idle), so this is free wall-clock.
# 4 is the default because that host is SHARED — raise it deliberately.
CONCURRENCY="${CONCURRENCY:-4}"

STAMP="$(date +%Y-%m-%d_%H-%M)"
LOG_DIR="evaluation/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/reprocess_${SOURCE}_${LIMIT}_${STAMP}.log"

if [ "$MODE" = "dry" ]; then SAVE_FLAG=""; DRY_FLAG="--dry-run"; else SAVE_FLAG="--save"; DRY_FLAG=""; fi

say() { printf '\n\033[1m== %s ==\033[0m\n' "$*" | tee -a "$LOG"; }
run() {
  # Each step is timed and its exit status recorded, so a run that dies at 3am
  # leaves behind which step failed rather than just a truncated log.
  local label="$1"; shift
  printf '\n--- %s\n    $ %s\n    started %s\n' "$label" "$*" "$(date '+%H:%M:%S')" | tee -a "$LOG"
  local t0=$SECONDS
  if "$@" >>"$LOG" 2>&1; then
    printf '    OK  (%dm %ds)\n' $(( (SECONDS-t0)/60 )) $(( (SECONDS-t0)%60 )) | tee -a "$LOG"
  else
    printf '\033[31m    FAILED (exit %d) — see %s\033[0m\n' "$?" "$LOG" | tee -a "$LOG"
    FAILED="${FAILED:-}${label}; "
  fi
}

FAILED=""

say "reprocess: source=$SOURCE limit=$LIMIT mode=$MODE concurrency=$CONCURRENCY"
echo "log: $LOG" | tee -a "$LOG"

# ── Step 0: vocabulary migration ───────────────────────────────────────────
# Cheap, no LLM, and REQUIRED before AI Campaigns can see anything. Idempotent,
# so re-running it on an already-migrated corpus is a no-op.
if [ "$SOURCE" = "all" ] || [ "$SOURCE" = "mentions" ]; then
  say "step 0 — stance vocabulary migration (no LLM, seconds)"
  if [ "$MODE" = "dry" ]; then
    run "migrate stance (dry)" node src/scripts/migrate-stance-vocabulary.js --dry-run
  else
    run "migrate stance" node src/scripts/migrate-stance-vocabulary.js
  fi
fi

# ── Step 1: re-analysis (the slow one — 2 LLM calls per record) ────────────
if [ "$SOURCE" = "all" ] || [ "$SOURCE" = "mentions" ]; then
  say "step 1a — re-analyse last $LIMIT MENTIONS"
  run "reanalyze mentions" node scripts/rerun_analysis.js --only=mentions "--limit=$LIMIT" "--concurrency=$CONCURRENCY" $SAVE_FLAG
fi

if [ "$SOURCE" = "all" ] || [ "$SOURCE" = "alerts" ]; then
  say "step 1b — re-analyse last $LIMIT ALERTS"
  run "reanalyze alerts" node scripts/rerun_analysis.js --only=alerts "--limit=$LIMIT" "--concurrency=$CONCURRENCY" $SAVE_FLAG
fi

if [ "$SOURCE" = "all" ] || [ "$SOURCE" = "news" ]; then
  say "step 1c — re-analyse last $LIMIT RSS ARTICLES"
  run "reanalyze rss" node scripts/rerun_analysis.js --only=rss "--limit=$LIMIT" "--concurrency=$CONCURRENCY" $SAVE_FLAG
fi

# ── Step 2: campaign topics (LLM, note the SPACE-separated --limit) ────────
if [ "$SOURCE" = "all" ] || [ "$SOURCE" = "mentions" ]; then
  say "step 2a — classify campaign topics on MENTIONS"
  run "topics mentions" node src/scripts/backfill-grievance-topics.js --limit "$LIMIT" $DRY_FLAG
fi

if [ "$SOURCE" = "all" ] || [ "$SOURCE" = "alerts" ]; then
  say "step 2b — classify campaign topics on ALERTS"
  run "topics alerts" node src/scripts/backfill-alert-topics.js --limit "$LIMIT" $DRY_FLAG
fi

# ── Step 3: embeddings for RAG retrieval ───────────────────────────────────
if [ "$SOURCE" = "all" ] || [ "$SOURCE" = "mentions" ]; then
  say "step 3 — embeddings for RAG (bge-m3)"
  run "embeddings" node src/scripts/backfill-grievance-embeddings.js --limit "$LIMIT" $DRY_FLAG
fi

# ── Summary ────────────────────────────────────────────────────────────────
say "done"
{
  echo "log     : $LOG"
  echo "reports : $(ls -1t evaluation/rerun_*.md 2>/dev/null | head -3 | tr '\n' ' ')"
  if [ -n "$FAILED" ]; then
    printf '\033[31mFAILED STEPS: %s\033[0m\n' "$FAILED"
    echo "Nothing after a failed step was skipped — each step is independent and resumable."
  else
    echo "all steps OK"
  fi
} | tee -a "$LOG"

[ -z "$FAILED" ]
