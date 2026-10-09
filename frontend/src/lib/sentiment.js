/**
 * sentiment.js — ONE place that decides what a record's sentiment and stance
 * are, for every component that displays them.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * Before this, three different components derived the same record's verdict
 * three different ways:
 *   • the alert card badge read `alert.risk_level`
 *   • the card's left border read `alert.risk_level` with a different mapping
 *   • the reason modal read `llm_analysis.sentiment`
 * so one alert could legitimately show three different verdicts on screen at
 * once, and the Negative/Neutral/Positive filter (which queries the server on
 * `target_sentiment`) could return rows the card labelled the opposite.
 *
 * Two rules this module enforces:
 *
 * 1. READ THE SAME FIELDS IN THE SAME ORDER, everywhere. The chains below are
 *    the single definition.
 *
 * 2. A MISSING VALUE IS NOT GOOD NEWS. Alert types that never ran through the
 *    political pipeline (velocity spikes, new_post alerts, captured stories)
 *    have no sentiment at all. The old code fell through to the `else` arm and
 *    painted them green "POSITIVE" — actively misleading on a platform whose
 *    whole job is spotting attacks. Unknown now resolves to `neutral`.
 */

/**
 * Canonical labels used across the app. 'neutral' = no positive or negative
 * substance, and it carries NO risk. 'moderate' is its retired name.
 */
export const SENTIMENTS = ['positive', 'neutral', 'negative'];

const normalize = (raw) => {
  const v = String(raw || '').toLowerCase().trim();
  if (v === 'negative' || v === 'high' || v === 'medium') return 'negative';
  if (v === 'positive' || v === 'low') return 'positive';
  if (v === 'neutral' || v === 'moderate') return 'neutral';
  return null;
};

/**
 * The RAW sentiment of an alert: the post's own tone (risk follows it).
 * Whether the post helps or hurts the client is the stance (getAlertStance).
 *
 * Note the nested `content.analysis.llm_analysis.*` rungs: many alerts
 * (velocity / new_post types) never get their own `llm_analysis`, because the
 * real classification lives on the linked Content's Analysis record. The FLAT
 * `content.analysis.sentiment` is checked after those, because historically it
 * was written as a hardcoded constant rather than the real verdict.
 */
export const getAlertSentiment = (alert, content) => {
  // RAW sentiment (the post's own tone). Whether it helps the client is the
  // stance, resolved separately by getAlertStance.
  const raw =
    alert?.llm_analysis?.generic_sentiment ||
    alert?.llm_analysis?.sentiment ||
    alert?.analysis?.generic_sentiment ||
    alert?.analysis?.sentiment ||
    content?.analysis?.llm_analysis?.generic_sentiment ||
    content?.analysis?.llm_analysis?.sentiment ||
    content?.analysis?.generic_sentiment ||
    content?.analysis?.sentiment ||
    content?.sentiment ||
    alert?.sentiment ||
    '';

  const direct = normalize(raw);
  if (direct) return direct;

  // Nothing sentiment-shaped stored. risk_level is derived from the raw
  // sentiment: medium/high mean negative; low is shared by positive AND
  // neutral, so it cannot claim good news — same as the server filter.
  const level = String(alert?.risk_level || '').toLowerCase();
  if (level === 'medium' || level === 'high' || level === 'critical') return 'negative';

  // Genuinely unknown. Do NOT claim this is good news — see rule 2 above.
  return 'neutral';
};

/** Same resolution for a grievance/mention record. */
export const getGrievanceSentiment = (grievance) => {
  const a = grievance?.analysis || {};
  // RAW sentiment; the client-relative verdict is the stance.
  const raw =
    a.generic_sentiment ||
    a.sentiment ||
    a.llm_analysis?.generic_sentiment ||
    a.llm_analysis?.sentiment ||
    '';
  return normalize(raw) || 'neutral';
};

/** Client-relative sentiment of a news/RSS article. */
export const getArticleSentiment = (article) =>
  normalize(article?.target_sentiment || article?.sentiment) || 'neutral';

/* ─── stance ────────────────────────────────────────────────────────── */

const STANCE_LABELS = {
  pro_target: { label: 'supportive', tone: 'positive' },
  pro_target_indirect: { label: 'supportive', tone: 'positive' },
  anti_target: { label: 'opposing', tone: 'negative' },
  anti_target_indirect: { label: 'opposing', tone: 'negative' },
  neutral: { label: 'neutral', tone: 'neutral' },
  unrelated: { label: 'unrelated', tone: 'neutral' },
  // Retired vocabulary, still present on records written before the rename.
  pro_bsk: { label: 'supportive', tone: 'positive' },
  pro_bsk_indirect: { label: 'supportive', tone: 'positive' },
  anti_bsk: { label: 'opposing', tone: 'negative' },
  anti_bsk_indirect: { label: 'opposing', tone: 'negative' },
  // The YouTube live-chat analyser (services/liveChatBatchAnalyzer.js) runs its
  // own lexicon pass and emits a THIRD vocabulary. Mapped here so any consumer
  // of this helper resolves live-chat rows too.
  pro_client: { label: 'supportive', tone: 'positive' },
  anti_client: { label: 'opposing', tone: 'negative' },
};

const STANCE_CLASSES = {
  positive: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  negative: 'bg-red-100 text-red-800 border-red-300',
  neutral: 'bg-slate-100 text-slate-700 border-slate-300',
};

const resolveStance = (raw, fallbackSentiment) => {
  const key = String(raw || '').toLowerCase().trim();
  const hit = STANCE_LABELS[key];
  if (hit) return { ...hit, raw: key, cls: STANCE_CLASSES[hit.tone] };

  // No stance stored — describe it from the sentiment rather than inventing one.
  const tone = fallbackSentiment || 'neutral';
  const label = tone === 'negative' ? 'opposing' : tone === 'positive' ? 'supportive' : 'neutral';
  return { label, tone, raw: '', cls: STANCE_CLASSES[tone], inferred: true };
};

// Note: bsk_pipeline.stance is NOT read here — it is the relevance gate's
// positive/negative/unknown tone guess, a different vocabulary.
export const getAlertStance = (alert, content) => resolveStance(
  alert?.llm_analysis?.political_stance ||
    alert?.llm_analysis?.stance ||
    alert?.analysis?.political_stance ||
    alert?.analysis?.stance ||
    content?.analysis?.llm_analysis?.political_stance ||
    content?.analysis?.llm_analysis?.stance ||
    content?.analysis?.political_stance ||
    content?.analysis?.stance ||
    '',
  getAlertSentiment(alert, content),
);

export const getGrievanceStance = (grievance) => resolveStance(
  grievance?.analysis?.political_stance ||
    grievance?.analysis?.stance ||
    grievance?.analysis?.llm_analysis?.political_stance ||
    grievance?.analysis?.llm_analysis?.stance ||
    '',
  getGrievanceSentiment(grievance),
);

/**
 * NewsArticle stance. The Node pipeline writes `political_stance` at the top
 * level (rssAnalysisService.updateFromAnalysis) and the full verdict under
 * `pipeline_analysis`; articles the Python engine ingested but that have not been
 * re-scored yet have neither, and fall back to the inferred description.
 */
export const getArticleStance = (article) => resolveStance(
  article?.political_stance ||
    article?.pipeline_analysis?.political_stance ||
    article?.pipeline_analysis?.stance ||
    '',
  getArticleSentiment(article),
);

/* ─── presentation ──────────────────────────────────────────────────── */

/** Tailwind classes for a solid sentiment badge. */
export const sentimentBadgeClass = (sentiment) => {
  switch (sentiment) {
    case 'negative': return 'bg-red-600 text-white';
    case 'positive': return 'bg-emerald-500 text-white';
    // Neutral: no risk — grey, not the amber of a warning.
    default: return 'bg-slate-500 text-white';
  }
};

/** Tailwind class for the card's left accent bar. */
export const sentimentBorderClass = (sentiment) => {
  switch (sentiment) {
    case 'negative': return 'bg-red-500';
    case 'positive': return 'bg-emerald-500';
    default: return 'bg-slate-400';
  }
};

/**
 * True when the pipeline routed this record to a human.
 * Surfacing it stops a low-confidence guess reading as a settled verdict.
 */
export const needsReview = (record) => !!(
  record?.needs_review ||
  record?.analysis?.needs_review ||
  record?.llm_analysis?.needs_review ||
  record?.analysis?.llm_analysis?.needs_review
);

/**
 * The rationale that actually produced the badge (Stage 4), preferred over
 * Pass A's `reasoning` — a separate, earlier LLM call whose own political read
 * is not what the badge shows. Displaying Pass A's text next to Stage 4's badge
 * is what made the explanation contradict the label.
 */
export const getReasoning = (record) => (
  record?.political_reasoning ||
  record?.llm_analysis?.political_reasoning ||
  record?.analysis?.political_reasoning ||
  record?.analysis?.llm_analysis?.political_reasoning ||
  record?.sentiment_reasoning ||
  ''
);

/* ─── BRS-relative verdict (primary badge) ──────────────────────────── */

/**
 * The PRIMARY badge on Alerts and Mentions: how the post affects BRS.
 *
 * Precedence — `political_stance` is canonical (the stance engine's verdict);
 * `target_sentiment` (client-relative: positive = good for BRS) is derived from
 * it by the backend, so it is only (a) a cross-check and (b) the fallback when
 * no stance was stored. Raw tone is NEVER consulted here: a negative-toned attack
 * on Congress is Supportive, a positive-toned praise of Congress is Opposing.
 *
 *   stance supportive + target_sentiment negative  → Unclear (contradiction)
 *   stance opposing   + target_sentiment positive  → Unclear (contradiction)
 *   stance neutral/unrelated + a signed target_sentiment → Unclear (contradiction)
 *   stance 'mixed' or unrecognised                 → Unclear
 *   no stance, signed target_sentiment             → from target_sentiment
 *   nothing stored                                 → Unclear
 */
export const BRS_VERDICTS = {
  supportive: { key: 'supportive', label: 'Supportive of BRS', tone: 'positive' },
  opposing: { key: 'opposing', label: 'Opposing BRS', tone: 'negative' },
  neutral: { key: 'neutral', label: 'Neutral on BRS', tone: 'neutral' },
  unclear: { key: 'unclear', label: 'Unclear', tone: 'unclear' },
};

const BRS_VERDICT_CLASSES = {
  supportive: 'bg-emerald-600 text-white',
  opposing: 'bg-red-600 text-white',
  neutral: 'bg-slate-500 text-white',
  unclear: 'bg-amber-100 text-amber-900 border border-amber-300',
};
const BRS_VERDICT_BORDERS = {
  supportive: 'bg-emerald-500', opposing: 'bg-red-500', neutral: 'bg-slate-400', unclear: 'bg-amber-400',
};

const stanceSide = (raw) => {
  const hit = STANCE_LABELS[String(raw || '').toLowerCase().trim()];
  if (!hit) return null;
  return hit.label === 'supportive' ? 'supportive' : hit.label === 'opposing' ? 'opposing' : hit.label === 'neutral' ? 'neutral' : 'unrelated';
};

/** Pure resolver over one analysis-shaped object. */
export const resolveBrsVerdict = (stanceRaw, targetSentimentRaw) => {
  const side = stanceSide(stanceRaw);
  const ts = normalize(targetSentimentRaw);
  // 'high'/'low' etc. are risk words, not a client-relative sentiment: only the three real labels count.
  const signed = ['positive', 'negative'].includes(String(targetSentimentRaw || '').toLowerCase().trim()) ? ts : null;
  let key;
  if (side === 'supportive') key = signed === 'negative' ? 'unclear' : 'supportive';
  else if (side === 'opposing') key = signed === 'positive' ? 'unclear' : 'opposing';
  else if (side === 'neutral' || side === 'unrelated') key = signed ? 'unclear' : 'neutral';
  else if (!String(stanceRaw || '').trim() && signed) key = signed === 'positive' ? 'supportive' : 'opposing';
  else key = 'unclear';
  return { ...BRS_VERDICTS[key], raw_stance: String(stanceRaw || ''), raw_target_sentiment: String(targetSentimentRaw || ''), cls: BRS_VERDICT_CLASSES[key], borderCls: BRS_VERDICT_BORDERS[key] };
};

const verdictFrom = (candidates) => {
  const list = candidates.filter(Boolean);
  // Stance and target_sentiment are read from the SAME object so they cannot come from different analyses.
  const withStance = list.find((c) => c.political_stance || c.stance);
  if (withStance) return resolveBrsVerdict(withStance.political_stance || withStance.stance, withStance.target_sentiment || withStance.bsk_sentiment);
  const withTarget = list.find((c) => c.target_sentiment || c.bsk_sentiment);
  return resolveBrsVerdict('', withTarget ? (withTarget.target_sentiment || withTarget.bsk_sentiment) : '');
};

export const getAlertBrsVerdict = (alert, content) => verdictFrom([
  alert?.llm_analysis, alert?.analysis, content?.analysis?.llm_analysis, content?.analysis,
]);

export const getGrievanceBrsVerdict = (grievance) => verdictFrom([
  grievance?.analysis, grievance?.analysis?.llm_analysis,
]);

/** Secondary chip text: the raw linguistic tone. */
export const toneLabel = (tone) => `Tone: ${({ positive: 'Positive', negative: 'Negative' })[tone] || 'Neutral'}`;

/** Muted classes for the secondary tone chip. */
export const toneChipClass = (tone) => {
  switch (tone) {
    case 'negative': return 'bg-red-50 text-red-700 border-red-200';
    case 'positive': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
};
