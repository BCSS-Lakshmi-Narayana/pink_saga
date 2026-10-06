/**
 * recommendationAdviceService — turns a finding into advice worth reading.
 * ─────────────────────────────────────────────────────────────────────────
 * The CM brief's recommendation engine is deterministic: it scans every issue,
 * district, minister and outlet, scores each on the numbers, and ranks them.
 * That part must stay deterministic — the figures are audited by
 * scripts/verify_cm_brief.js and drilled into by evidence links.
 *
 * What it could NOT do was say anything specific about what to DO. The action
 * line was one of thirteen sentences written by hand, so the diagnosis changed
 * daily while the advice never did:
 *
 *   "Brief the department holding Corruption and answer the specific complaints."
 *
 * …even though the engine had already worked out the criticism was about smart
 * meters, that it was concentrated in Durg and Bilaspur, and that the
 * opposition had posted three times while we said nothing.
 *
 * This hands that evidence — including the verbatim posts — to the model and
 * asks for the action only. Nothing else about the brief becomes generated:
 * every number, count, ranking and link still comes from the database.
 *
 * Failure is expected and handled. If the model is down, slow, or returns
 * something unusable, the caller keeps the template sentence it already had.
 */

const { chatJson, withForcedProvider } = require('./llmProvider');

/**
 * Everything tunable is read from the environment, so the model, the host, the
 * timeouts and how much of the brief gets generated can be changed per
 * deployment without touching code. The model and URL themselves come from
 * OLLAMA_MODEL / OLLAMA_URL via services/ollamaLLMService.
 */
const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * Per-call ceiling. Generous, because a call that overruns the page budget
 * below still completes in the background and warms the cache for next time —
 * abandoning it early would waste the work entirely.
 */
const TIMEOUT_MS = num('CM_ADVICE_TIMEOUT_MS', 45000);
/**
 * How long the PAGE waits. Whatever has arrived by then is used; the rest keep
 * running and are picked up on the next request. This is the number that
 * decides how fast the brief loads.
 */
const BUDGET_MS = num('CM_ADVICE_BUDGET_MS', 12000);
/** Only the findings a Chief Minister will actually read get a model call. */
const MAX_FINDINGS = num('CM_ADVICE_MAX', 8);
/** Lower is steadier wording run to run; higher reads less like a template. */
const TEMPERATURE = Number.isFinite(Number(process.env.CM_ADVICE_TEMPERATURE))
  ? Number(process.env.CM_ADVICE_TEMPERATURE) : 0.3;
const MAX_TOKENS = num('CM_ADVICE_MAX_TOKENS', 160);
/** Reject a reply that is obviously not one instruction. */
const MIN_CHARS = num('CM_ADVICE_MIN_CHARS', 15);
const MAX_CHARS = num('CM_ADVICE_MAX_CHARS', 400);
/** Set CM_ADVICE_ENABLED=false to fall back to the written templates entirely. */
const ENABLED = String(process.env.CM_ADVICE_ENABLED ?? 'true').toLowerCase() !== 'false';
/** Consecutive failures before generation is skipped, and for how long. */
const BREAKER_AFTER = num('CM_ADVICE_BREAKER_AFTER', 2);
const BREAKER_MINUTES = num('CM_ADVICE_BREAKER_MINUTES', 10);

/**
 * Regenerating identical advice on every page load wastes a GPU and makes the
 * page slower for no gain, so it is cached against the finding's own numbers:
 * the key changes only when the finding materially changes.
 */
/**
 * Consecutive rounds in which no finding produced advice. While the breaker is
 * open the brief does not call the model at all, so a slow endpoint costs one
 * budget rather than one on every load.
 */
let consecutiveFailures = 0;
let breakerUntil = 0;
const breakerOpen = () => Date.now() < breakerUntil;

const cache = new Map();
const CACHE_TTL_MS = num('CM_ADVICE_CACHE_MINUTES', 15) * 60 * 1000;
const CACHE_MAX = num('CM_ADVICE_CACHE_MAX', 300);

const keyFor = (r) => [
  r.kind, r.topic || r.headline,
  r.evidence?.anti ?? r.evidence?.adverse ?? r.evidence?.hostile ?? '',
  r.evidence?.pro ?? '',
  (r.themes || []).map((t) => t.term).join('|'),
].join('::');

const readCache = (k) => {
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(k); return null; }
  return hit.value;
};
const writeCache = (k, value) => {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(k, { value, at: Date.now() });
};

/** Trim a post to something worth sending without blowing the context. */
const snippet = (t, n = 220) => String(t || '').replace(/\s+/g, ' ').slice(0, n);

/**
 * The brief is read by a Chief Minister, so the prompt asks for an instruction
 * an office can act on this week — not analysis, which the card already shows
 * above the action line.
 */
const buildPrompt = (r, ctx) => {
  const ev = r.evidence || {};
  const themes = (r.themes || []).map((t) => `${t.term} (in ${t.posts} posts)`).join(', ');
  const quotes = (r.quotes || []).map((q, i) => `${i + 1}. "${snippet(q)}"`).join('\n');

  return `The Chief Minister of ${ctx.state} is reading this. Our party is ${ctx.party}.
You are his chief of staff writing the single line of advice under a finding.

A monitoring system found this in the last ${ctx.days} days. Every figure is measured, not estimated.

FINDING: ${r.headline}
${r.detail || ''}
${themes ? `WORDS RECURRING IN THE CRITICISM: ${themes}` : ''}
${ev.pro !== undefined ? `SUPPORTIVE: ${ev.pro}   OPPOSING: ${ev.anti}` : ''}
${ev.opposition !== undefined ? `OPPOSITION POSTED: ${ev.opposition}   WE POSTED: ${ev.ours}` : ''}
${ctx.districts ? `CONCENTRATED IN: ${ctx.districts}` : ''}
${quotes ? `WHAT PEOPLE ACTUALLY WROTE:\n${quotes}` : ''}

Write the single action the CM's office should take this week.

Rules:
- The CM is the reader. NEVER say "brief the CM", "inform the CM" or "advise the CM" — he already knows, he is looking at it. Write what HE should order.
- Name the actual grievance from the quotes above, not the topic label. If a post names a scheme, a machine, a scandal or an amount, use it.
- One or two sentences, under 40 words. Plain English. Start with a verb.
- Do not repeat the numbers; they are on screen directly above your sentence.
- Invent nothing. Every fact must come from the evidence above.
- If the evidence is too thin for a specific action, say what to establish first.

Reply with EXACTLY one JSON object, no markdown:
{"action": "your sentence"}`;
};

/** One finding → one action sentence, or null if the model cannot help. */
async function adviseOne(r, ctx) {
  const key = keyFor(r);
  const cached = readCache(key);
  if (cached) return cached;

  try {
    /**
     * Pinned to Ollama. llmProvider's default is `auto`, which silently falls
     * back to RapidAPI when Ollama is unreachable — that would send the
     * verbatim posts behind a finding to a third-party API without anything on
     * the page changing to say so. This advice stays on the local model or it
     * does not run, and the template sentence takes over.
     */
    const out = await withForcedProvider('ollama', () => chatJson({
      prompt: buildPrompt(r, ctx),
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
    }));
    const action = String(out?.action || '').trim();
    // Guard against an empty reply, a refusal, or the model returning an essay.
    if (!action || action.length < MIN_CHARS || action.length > MAX_CHARS) return null;
    writeCache(key, action);
    return action;
  } catch (err) {
    console.warn('[cm-advice]', r.kind, '-', err.message);
    return null;
  }
}

/**
 * Rewrites the `action` on the highest-impact findings, in parallel, and leaves
 * the rest with their template sentence. Never throws and never rejects: a
 * dashboard must render even when the model is unavailable.
 *
 * Returns the same array, with `action_source` marking which came from the
 * model, so the page can be honest about what is generated.
 */
async function adviseAll(recommendations, ctx = {}) {
  const list = Array.isArray(recommendations) ? recommendations : [];
  if (!list.length) return list;
  if (!ENABLED || breakerOpen()) {
    for (const r of list) r.action_source = 'template';
    return list;
  }

  const targets = list.slice(0, MAX_FINDINGS);

  // Each job runs to completion regardless — it writes to the cache when it
  // lands, so a slow first load pays for a fast second one.
  const jobs = targets.map((r) => adviseOne(r, ctx).catch(() => null));

  // …but the page only waits BUDGET_MS for them collectively.
  let expired = false;
  const deadline = new Promise((resolve) => {
    setTimeout(() => { expired = true; resolve(); }, BUDGET_MS).unref?.();
  });
  const settled = await Promise.race([
    Promise.all(jobs).then((v) => v),
    deadline.then(() => null),
  ]);

  const actions = settled || await Promise.all(
    // Budget blown: take only what has already resolved, leave the rest running.
    jobs.map((j) => Promise.race([j, Promise.resolve(undefined)])),
  );

  actions.forEach((action, i) => {
    if (action) {
      targets[i].action = action;
      targets[i].action_source = 'model';
    } else {
      targets[i].action_source = 'template';
    }
  });
  for (const r of list.slice(MAX_FINDINGS)) r.action_source = 'template';

  const produced = actions.filter(Boolean).length;
  if (produced > 0) {
    consecutiveFailures = 0;
  } else {
    consecutiveFailures += 1;
    if (consecutiveFailures >= BREAKER_AFTER) {
      breakerUntil = Date.now() + BREAKER_MINUTES * 60 * 1000;
      consecutiveFailures = 0;
      console.warn(`[cm-advice] no advice produced ${BREAKER_AFTER}x — `
        + `pausing generation for ${BREAKER_MINUTES}m so the brief stays fast. `
        + 'It resumes on its own; check the model endpoint is reachable and fast enough.');
    }
  }
  if (expired && produced > 0) {
    console.info('[cm-advice] page budget reached; the rest will be ready next load');
  }
  return list;
}

module.exports = { adviseAll, adviseOne, buildPrompt };
