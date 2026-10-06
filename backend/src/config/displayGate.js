/**
 * displayGate
 * ─────────────────────────────────────────────────────────────────────────────
 * Keeps a freshly ingested record OUT of the UI until the pipeline has finished
 * scoring it, so an operator never sees a card appear with no sentiment/stance
 * and then silently change a minute later.
 *
 * THE RULE: a record ingested from now on is displayed only once the analysis is
 * complete. Not "after N hours". Complete, or hidden — for as long as it takes.
 *
 * WHY THERE IS A TIMESTAMP IN HERE AT ALL
 * ───────────────────────────────────────
 * It is a LEGACY LINE, not a timeout. A plain `analysed = true` filter cannot
 * tell "not scored YET" from "was never scored, months ago". Measured against the
 * live database when this was written:
 *
 *      mentions  69,232 total —     47 unanalysed
 *      alerts    11,245 total —  5,833 unanalysed  (3,126 ai_risk, 874 velocity;
 *                                 sampled 4,000, and 0 had the verdict on a linked
 *                                 Content record either — genuinely never scored)
 *      news       1,832 total —  1,832 unscored    (Node never scored RSS at all
 *                                 until the scheduler in index.js was added)
 *
 * An unconditional gate would have hidden those 7,712 existing records the moment
 * it shipped, with no error and no way for anyone to notice they were gone. So the
 * line says: everything already in the database when the gate first went live is
 * history and always displays; everything ingested after it must be scored.
 *
 * WHY THE LINE IS PERSISTED AND NOT `new Date()` AT BOOT
 * ─────────────────────────────────────────────────────
 * The obvious implementation — capture the line at require() time — is wrong, and
 * subtly so. It moves forward on every restart, which means anything still waiting
 * for analysis is silently reclassified as "history" and released UNSCORED. PM2
 * here restarts on a 950MB memory ceiling, so that fires on its own, and it fires
 * hardest exactly when the pipeline is struggling and the pending queue is longest
 * — the one case the gate exists for.
 *
 * So the line is written ONCE, on first boot, into `system_flags` with
 * `$setOnInsert`, and every later boot reads that same value back. Restarts no
 * longer move it. A plain collection handle is used rather than a Mongoose model
 * on purpose: nothing else in the app touches this document, so no schema, no
 * strict-mode surprises, and no settings controller can overwrite it.
 *
 * Until that read completes the gates return null — i.e. they show everything.
 * Withholding records on the strength of a line we have not loaded yet would be
 * guessing, and guessing in the hiding direction is the one failure worth avoiding.
 *
 * ENV
 *   HIDE_UNANALYSED_POSTS      'false' disables every gate outright (default on)
 *   REQUIRE_TOPIC_FOR_DISPLAY  'false' drops the campaign-topic condition from the
 *                              mention and news gates (default on — llmService
 *                              stamps the taxonomy version on every answer, so a
 *                              "no matching topic" verdict still counts as done).
 *                              Turn it off if a topic backlog holds cards up.
 *   ANALYSIS_GATE_START_AT     ISO date; overrides the persisted line entirely.
 *   ANALYSIS_PENDING_WINDOW_HOURS  optional age-out for pending records. 0/unset
 *                              means never age out (the intended behaviour).
 */

const mongoose = require('mongoose');

const ENABLED = String(process.env.HIDE_UNANALYSED_POSTS || 'true').toLowerCase() !== 'false';
const REQUIRE_TOPIC = String(process.env.REQUIRE_TOPIC_FOR_DISPLAY || 'true').toLowerCase() !== 'false';

// 0 (the default) means "no age-out" — a pending record waits as long as it takes.
const WINDOW_HOURS = Number(process.env.ANALYSIS_PENDING_WINDOW_HOURS || 0);

const FLAG_COLLECTION = 'system_flags';
const FLAG_KEY = 'display_gate_start_at';

const SET = { $exists: true, $nin: [null, ''] };

const envStart = (() => {
  if (!process.env.ANALYSIS_GATE_START_AT) return null;
  const d = new Date(process.env.ANALYSIS_GATE_START_AT);
  return Number.isNaN(d.getTime()) ? null : d;
})();

/** Resolved once by initDisplayGate(). null means "not known yet — show everything". */
let startAt = envStart;

/**
 * Load (or, on the very first boot, write) the legacy line. Safe to call more than
 * once and safe to call concurrently from several instances: `$setOnInsert` means
 * whichever one gets there first defines the line and the rest read it back.
 * Never throws — a gate that cannot read its own config must not take the API down.
 */
const initDisplayGate = async () => {
  if (envStart) return startAt;
  try {
    const col = mongoose.connection.db.collection(FLAG_COLLECTION);
    await col.updateOne(
      { key: FLAG_KEY },
      { $setOnInsert: { key: FLAG_KEY, value: new Date(), created_at: new Date() } },
      { upsert: true }
    );
    const doc = await col.findOne({ key: FLAG_KEY });
    startAt = doc && doc.value ? new Date(doc.value) : null;
    console.log(`[displayGate] enabled=${ENABLED} start=${startAt ? startAt.toISOString() : 'unresolved'} requireTopic=${REQUIRE_TOPIC} windowHours=${WINDOW_HOURS}`);
  } catch (err) {
    startAt = null; // stays open rather than hiding on a guess
    console.error(`[displayGate] could not resolve start line, gates stay open: ${err.message}`);
  }
  return startAt;
};

/**
 * Build the filter fragment. `scoredConditions` are ANDed together to mean
 * "fully scored"; `ageField` is what places a record on the legacy side of the
 * line. A record displays when it is fully scored, OR predates the line, OR has
 * no timestamp at all (nothing to compare, so never withhold it).
 */
const gate = (scoredConditions, ageField) => {
  const passes = [
    { $and: scoredConditions },
    { [ageField]: { $lt: startAt } },
    { [ageField]: null },
  ];
  if (WINDOW_HOURS > 0) {
    passes.push({ [ageField]: { $lt: new Date(Date.now() - WINDOW_HOURS * 3600 * 1000) } });
  }
  return { $or: passes };
};

const active = () => ENABLED && startAt instanceof Date;

/**
 * Mentions. `analysis.stance` is checked as well as `political_stance` because
 * the vocabulary migration has not been run — most of the corpus still carries
 * only the retired field, and requiring the new one alone would withhold
 * everything analysed before the rename.
 */
const grievanceGate = () => {
  if (!active()) return null;
  const scored = [
    { 'analysis.analyzed_at': { $ne: null } },
    { $or: [{ 'analysis.political_stance': SET }, { 'analysis.stance': SET }] },
  ];
  if (REQUIRE_TOPIC) scored.push({ 'analysis.topic_taxonomy_version': { $ne: null } });
  return gate(scored, 'detected_date');
};

/**
 * News. `pipeline_analyzed_at` is set by rssAnalysisService and is the single
 * authoritative marker that the Node pipeline (not the Python engine) has scored
 * the article. Aged on `scraped_at` — when WE received it, not when the outlet
 * published it, since a backdated article is not "pending".
 */
const newsGate = () => {
  if (!active()) return null;
  const scored = [{ pipeline_analyzed_at: { $ne: null } }];
  if (REQUIRE_TOPIC) scored.push({ campaign_topic_taxonomy_version: { $ne: null } });
  return gate(scored, 'scraped_at');
};

/* ─── alerts ──────────────────────────────────────────────────────────────────
 *
 * Alerts cannot use the same shape, because the stance an alert card DISPLAYS is
 * not necessarily the one stored on the alert. getAlerts hydrates each row from
 * the `analyses` collection at read time (alertController ~line 683), so the badge
 * may come from the linked Analysis. Judging an alert by `alert.llm_analysis`
 * alone badly understates coverage — measured over 7 days:
 *
 *      type      alerts   stance on alert doc   stance via linked Analysis
 *      ai_risk      189            116                171  (90%)
 *      velocity      48             25                 48  (100%)
 *
 * So a gate here delays cards rather than deleting them, which is the point. The
 * 18 ai_risk alerts with no Analysis row at all are precisely what to withhold.
 *
 * Two deliberate differences from the mention/news gates:
 *
 *  1. NO TOPIC CONDITION. velocityAlertService never writes `campaign_topic` — not
 *     conditionally, not at all — so requiring it would hide every new velocity
 *     alert permanently. The rows that do carry one got it from the backfill
 *     script. Stance is the only field both creators actually produce.
 *
 *  2. IT IS ASYNC AND RETURNS AN ID LIST. Mongo cannot filter on a joined
 *     collection in a find(), and this controller deliberately avoids $lookup
 *     (32MB sort limit, see alertController ~line 417). Resolving it instead is
 *     cheap because the candidate set is only the alerts created since the line —
 *     49 in a typical 24h — so this reads a few dozen ids, not the collection.
 */

const ALERT_CACHE_MS = Number(process.env.ALERT_GATE_CACHE_MS || 30000);
let alertCache = { at: 0, fragment: null };

const hasStance = (llm) => !!(llm && (llm.political_stance || llm.stance));

const alertGate = async () => {
  if (!active()) return null;
  if (Date.now() - alertCache.at < ALERT_CACHE_MS) return alertCache.fragment;

  let fragment = null;
  try {
    const db = mongoose.connection.db;
    const since = { created_at: { $gte: startAt } };

    const candidates = await db.collection('alerts')
      .find(WINDOW_HOURS > 0
        ? { $and: [since, { created_at: { $gte: new Date(Date.now() - WINDOW_HOURS * 3600 * 1000) } }] }
        : since)
      .project({ id: 1, content_id: 1, 'llm_analysis.political_stance': 1, 'llm_analysis.stance': 1 })
      .toArray();

    // Anything already carrying its own stance is done; only the rest needs a join.
    const pending = candidates.filter((a) => !hasStance(a.llm_analysis));

    if (pending.length) {
      const contentIds = [...new Set(pending.map((a) => a.content_id).filter(Boolean))];
      const analyses = contentIds.length
        ? await db.collection('analyses')
            .find({ content_id: { $in: contentIds } })
            .project({ content_id: 1, 'llm_analysis.political_stance': 1, 'llm_analysis.stance': 1 })
            .toArray()
        : [];
      const scored = new Set(
        analyses.filter((a) => hasStance(a.llm_analysis)).map((a) => a.content_id)
      );
      const hide = pending
        .filter((a) => !a.content_id || !scored.has(a.content_id))
        .map((a) => a.id)
        .filter(Boolean);
      if (hide.length) fragment = { id: { $nin: hide } };
    }
  } catch (err) {
    // Same principle as initDisplayGate: never hide on a failed lookup.
    console.error(`[displayGate] alert gate lookup failed, showing all alerts: ${err.message}`);
    fragment = null;
  }

  alertCache = { at: Date.now(), fragment };
  return fragment;
};

/** Merge a gate into an existing filter without clobbering a caller's own $and/$or. */
const applyGate = (filter, gateFragment) => {
  if (!gateFragment) return filter;
  const existing = Array.isArray(filter.$and) ? filter.$and : [];
  return { ...filter, $and: [...existing, gateFragment] };
};

module.exports = {
  initDisplayGate,
  grievanceGate,
  newsGate,
  alertGate,
  applyGate,
  _config: { ENABLED, REQUIRE_TOPIC, WINDOW_HOURS, ALERT_CACHE_MS, get startAt() { return startAt; } },
};
