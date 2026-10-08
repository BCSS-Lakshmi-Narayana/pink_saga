/**
 * bskRelevanceFilterService
 *
 * Fast single-pass relevance gate that decides whether a tweet is about the
 * client's political universe — BRS president KCR, working president KTR, the
 * BRS organisation, and the Congress government they oppose. Heuristic first;
 * ambiguous text falls through to the configured LLM provider.
 *
 * ── WHY THE NAMES IN THIS FILE LOOK WRONG ─────────────────────────────
 * "BSK" stands for Bandi Sanjay Kumar, the client of a much earlier Telangana
 * deployment this codebase descends from. The prefix survived because
 * `llm_analysis.bsk_sentiment` is a DATABASE FIELD and `bsk_only` is a QUERY
 * PARAMETER the frontend sends: renaming them would break the stored schema
 * and the API contract for no functional gain. Read `bsk` as "the client"
 * throughout. (Bandi Sanjay is, as it happens, a real entity in THIS
 * deployment too — a Union Minister and one of the loudest anti-BRS voices —
 * which makes the legacy prefix doubly confusing. It does not refer to him.)
 *
 * ⚠ NAMESPACES. The `target` values this file emits ('bsk' | 'bsk_son' | 'bjp_telangana' |
 * 'unrelated') belong to THIS FILE'S OWN vocabulary and mean:
 *   bsk           → primary client leader (KCR, party president)
 *   bsk_son       → secondary client leader (KTR, working president)
 *   bjp_telangana → the BRS organisation, or the state government it opposes
 * That is NOT the entity layer's reading of the same strings: politicalEntities.js
 * LEGACY_ENTITY_KEYS resolves a stored `bsk` to Bandi Sanjay (a BJP rival) because that is
 * what the key meant in the data of the earlier deployment. So a value from this file must
 * never be passed to resolveEntityKey(). Every result therefore ALSO carries explicit
 * identifiers that mean one thing only:
 *   target_key        'primary_leader' | 'secondary_leader' | 'party_or_government' | 'unrelated'
 *   target_entity_key the roster entity key ('kcr' | 'ktr') or null
 * Use those. `target` is kept unchanged for compatibility.
 *
 * Input  : raw tweet text (string)
 * Output : {
 *            is_bsk:           boolean,
 *            confidence:       number 0..1,
 *            stance:           'positive' | 'negative' | 'neutral' | 'unknown',
 *            topic:            short string  (e.g. "paddy procurement", "welfare scheme"),
 *            reason:           one-line natural-language explanation,
 *            target:           'bsk' | 'bsk_son' | 'bjp_telangana' | 'unrelated',
 *          }
 *
 * Heuristic fast-path: any tweet text containing an unambiguous leader token
 * (full name, official handle) returns true without hitting the LLM.
 *
 * If the LLM is unreachable or returns garbage we fall back to the heuristic —
 * so the pipeline keeps producing data even if the LLM is down.
 */
const { chatJson } = require('./llmProvider');
const { POLITICAL_ENTITIES, PRIMARY_TARGET_KEY, SECONDARY_TARGET_KEY, aliasOccursIn } = require('../config/politicalEntities');
const {
  STATE_NAME, CLIENT_DESCRIPTION, RULING_GOVERNMENT_DESCRIPTION,
  OUR_CAMP_SUMMARY, OPPOSITION_SUMMARY, LANGUAGES_DESCRIPTION,
} = require('../config/deployment');

const LLM_TIMEOUT = parseInt(process.env.BSK_FILTER_TIMEOUT_MS || '45000', 10);

const PRIMARY_NAME = POLITICAL_ENTITIES[PRIMARY_TARGET_KEY]?.canonical || 'the party president';
const SECONDARY_NAME = POLITICAL_ENTITIES[SECONDARY_TARGET_KEY]?.canonical || 'the working president';

// ─── Heuristic tokens — case-insensitive substring match ───────────
// Full names and handles only. A bare surname ("sai", "deo", "singh") is shared
// by millions and would pull unrelated posts into the Mentions feed,
// which also filters on this list.
const PRIMARY_TOKENS = [
  // Bare "chandrashekar rao" / "chandrasekhar rao" are not listed: they name thousands of other
  // people. The full forms below and "kcr" carry the real KCR.
  'kcr', 'k chandrashekar rao', 'kalvakuntla chandrashekar rao', 'k chandrasekhar rao',
  '@kcrbrspresident', '#kcr',
  'కేసీఆర్', 'కల్వకుంట్ల చంద్రశేఖర్ రావు', 'చంద్రశేఖర్ రావు',
];

const SECONDARY_TOKENS = [
  'ktr', 'k t rama rao', 'kt rama rao', 'kalvakuntla taraka rama rao', 'taraka rama rao',
  '@ktrbrs', '#ktr', 'కేటీఆర్', 'కల్వకుంట్ల తారక రామారావు', 'తారక రామారావు',
];

/**
 * The client's political universe, as one unambiguous token list.
 *
 * ⚠ THIS INCLUDES THE GOVERNMENT, which no ruling-party deployment ever did.
 * These tokens back the DEFAULT filter on the grievances list ("show me what
 * concerns us"). For a party in power, that meant its own leadership. For BRS
 * it must also mean the administration it opposes: a complaint against the
 * Congress government is not noise to a BRS reader, it is the entire point.
 * Excluding the government here would hide the opposition's best material
 * behind an opt-out nobody knows to set.
 *
 * Bare surnames ("rao", "reddy", "singh") are deliberately absent — they are
 * shared by millions in Telangana and would drag unrelated posts in.
 */
const HARD_BSK_TOKENS = [
  ...PRIMARY_TOKENS,
  ...SECONDARY_TOKENS,
  // ── our party ──
  'brs', 'bharat rashtra samithi', 'telangana rashtra samithi', '@brsparty', '#brs',
  'harish rao', 'thanneeru harish rao', '@brsharish',
  'బీఆర్ఎస్', 'భారత్ రాష్ట్ర సమితి', 'హరీష్ రావు',
  // ── the government we are against ──
  'revanth reddy', 'anumula revanth reddy', 'cm revanth', 'telangana cm',
  '@revanth_anumula', '@telanganacmo', '#revanthreddy',
  'రేవంత్ రెడ్డి', 'ముఖ్యమంత్రి రేవంత్', 'సీఎం రేవంత్',
  'telangana congress', 'tpcc', '@inctelangana',
];

const SOFT_BSK_TOKENS = [
  // Wider political context that often appears with the leadership.
  'congress', 'కాంగ్రెస్', 'bjp', 'బీజేపీ',
  'telangana government', 'telangana govt', 'ts government', 'state government',
  'తెలంగాణ ప్రభుత్వం', 'ప్రభుత్వం',
  'kaleshwaram', 'కాళేశ్వరం', 'rythu bandhu', 'రైతుబంధు', 'rythu bharosa', 'రైతు భరోసా',
  'dharani', 'ధరణి', 'formula e', 'phone tapping', 'ఫోన్ ట్యాపింగ్',
];

/**
 * Tokens are looked for through the entity layer's own matcher (aliasOccursIn), so the same
 * rules apply here as everywhere else: a short alias needs word boundaries ("ktr" is not
 * inside "factory"), "Nandamuri Taraka Rama Rao" is not KTR, and a bare "Chandrashekar Rao"
 * counts only with a Telangana/BRS cue.
 */
function heuristicMatch(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  for (const t of HARD_BSK_TOKENS) {
    if (aliasOccursIn(lower, t, raw)) return { matched: true, strength: 'hard', token: t };
  }
  for (const t of SOFT_BSK_TOKENS) {
    if (aliasOccursIn(lower, t, raw)) return { matched: true, strength: 'soft', token: t };
  }
  return { matched: false };
}

/**
 * The same hard-token list as ONE regex source for a MongoDB $regex (the Mentions feed gate,
 * which cannot call JS). Collision-prone names carry a lookbehind so the namesake is not
 * admitted ("nandamuri taraka rama rao" is NTR, not KTR); bare "Chandrashekar Rao" is not in
 * the list at all (the full forms are). Keep in step with ALIAS_BLOCKED_CONTEXTS.
 */
const escapeRx = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GATE_GUARDS = { 'taraka rama rao': '(?<!nandamuri )', 'తారక రామారావు': '(?<!నందమూరి )' };
const HARD_BSK_REGEX_SOURCE = HARD_BSK_TOKENS.map((t) => `${GATE_GUARDS[t] || ''}${escapeRx(t)}`).join('|');

/* legacy `target` (this file's vocabulary) → explicit identifiers that cannot be misread */
const TARGET_KEYS = {
  bsk: { target_key: 'primary_leader', target_entity_key: PRIMARY_TARGET_KEY },
  bsk_son: { target_key: 'secondary_leader', target_entity_key: SECONDARY_TARGET_KEY },
  bjp_telangana: { target_key: 'party_or_government', target_entity_key: null },
  unrelated: { target_key: 'unrelated', target_entity_key: null },
};
const withTargetKey = (result) => ({ ...result, ...(TARGET_KEYS[result.target] || TARGET_KEYS.unrelated) });

/* ─── LLM call (RapidAPI ChatGPT-42) ──────────────────────────── */
async function askLLM(tweetText) {
  const prompt = `You are filtering tweets for a political media-monitoring system serving ${CLIENT_DESCRIPTION}.
The primary subject is ${PRIMARY_NAME}, president of the party. The secondary subject is
${SECONDARY_NAME}, its working president. Our camp: ${OUR_CAMP_SUMMARY}.
Rivals: ${OPPOSITION_SUMMARY}.

IMPORTANT: our client is NOT in government. ${RULING_GOVERNMENT_DESCRIPTION} is the ADVERSARY.
Tweets about that government — praising it, attacking it, reporting on its schemes or failures —
ARE relevant to this client, because opposing it is the client's whole purpose. Do not mark such a
tweet irrelevant merely because it does not name our leaders.

TWEET (verbatim, may be ${LANGUAGES_DESCRIPTION}):
"""
${String(tweetText || '').slice(0, 800)}
"""

Decide whether this tweet is meaningfully about ${PRIMARY_NAME}, ${SECONDARY_NAME}, the party
organisation, or ${RULING_GOVERNMENT_DESCRIPTION}. A tweet that merely mentions ${STATE_NAME}
politics generically is NOT relevant. A tweet that targets, defends, mocks, praises, or reports on
that leadership or that government IS relevant.

The JSON keys below are fixed identifiers local to this prompt — map: "bsk" = ${PRIMARY_NAME},
"bsk_son" = ${SECONDARY_NAME}, "bjp_telangana" = the party organisation OR the state government.

Reply with EXACTLY one JSON object on a single line, no prose, no markdown:
{"is_bsk": true|false, "confidence": 0.0-1.0, "stance": "positive"|"negative"|"neutral"|"unknown", "target": "bsk"|"bsk_son"|"bjp_telangana"|"unrelated", "topic": "short label", "reason": "one short sentence"}`;

  try {
    return await chatJson({
      prompt,
      temperature: 0.1,
      maxTokens: 400,
      timeoutMs: LLM_TIMEOUT,
    });
  } catch (err) {
    return { __error: err.message || 'rapidapi call failed' };
  }
}

/* ─── public API ─────────────────────────────────────────────── */
async function checkRelevance(tweetText, { allowLLM = true } = {}) {
  const text = String(tweetText || '').trim();
  if (!text) {
    return withTargetKey({ is_bsk: false, confidence: 0, stance: 'unknown', target: 'unrelated', topic: '', reason: 'empty text' });
  }

  // 1. Heuristic fast-path
  const heur = heuristicMatch(text);
  if (heur.matched && heur.strength === 'hard') {
    return withTargetKey({
      is_bsk: true,
      confidence: 0.95,
      stance: 'unknown',
      target: PRIMARY_TOKENS.includes(heur.token) ? 'bsk'
        : SECONDARY_TOKENS.includes(heur.token) ? 'bsk_son'
        : 'bjp_telangana',
      topic: 'name match',
      reason: `Matched token "${heur.token}"`,
      heuristic: true,
    });
  }

  // 2. LLM gate (skip on demand for speed-only runs)
  if (!allowLLM) {
    return withTargetKey(heur.matched
      ? { is_bsk: true, confidence: 0.55, stance: 'unknown', target: 'bjp_telangana', topic: 'soft match', reason: `Soft token "${heur.token}"`, heuristic: true }
      : { is_bsk: false, confidence: 0.05, stance: 'unknown', target: 'unrelated', topic: '', reason: 'no token, llm skipped', heuristic: true });
  }

  const llm = await askLLM(text);
  if (!llm || llm.__error) {
    // Fall back to heuristic if RapidAPI broken
    return withTargetKey(heur.matched
      ? { is_bsk: true, confidence: 0.5, stance: 'unknown', target: 'bjp_telangana', topic: 'soft match (llm down)', reason: `RapidAPI unreachable; soft heuristic on "${heur.token}"`, heuristic: true, llm_error: llm?.__error }
      : { is_bsk: false, confidence: 0.1, stance: 'unknown', target: 'unrelated', topic: '', reason: 'no match + llm unreachable', heuristic: true, llm_error: llm?.__error });
  }

  // Sanitise LLM output
  return withTargetKey({
    is_bsk:     !!llm.is_bsk,
    confidence: Math.max(0, Math.min(1, Number(llm.confidence) || 0)),
    stance:     ['positive', 'negative', 'neutral', 'unknown'].includes(llm.stance) ? llm.stance : 'unknown',
    target:     ['bsk', 'bsk_son', 'bjp_telangana', 'unrelated'].includes(llm.target) ? llm.target : 'unrelated',
    topic:      String(llm.topic || '').slice(0, 80),
    reason:     String(llm.reason || '').slice(0, 200),
    heuristic:  false,
  });
}

module.exports = {
  checkRelevance,
  heuristicMatch,
  HARD_BSK_TOKENS,
  HARD_BSK_REGEX_SOURCE,
  SOFT_BSK_TOKENS,
  TARGET_KEYS,
};
