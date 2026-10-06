const mappingService = require("./mappingService");
const { chatJson } = require("./llmProvider");
const {
  STATE_NAME,
  CLIENT_DESCRIPTION,
  OUR_CAMP_SUMMARY,
  OUR_CAMP_LEADERS,
  OPPOSITION_SUMMARY,
} = require("../config/deployment");
const {
  CAMPAIGN_TOPICS,
  TOPIC_TAXONOMY_VERSION,
  normalizeCampaignTopic,
} = require("./campaignTaxonomy");

/**
 * How much of the post text may reach the prompt — budgeted in TOKENS, not
 * characters, because the two are not interchangeable here.
 *
 * The shared Ollama host keeps qwen2.5:7b RESIDENT AT num_ctx 4096 (confirmed via
 * /api/ps), and the backfill scripts deliberately never set `num_ctx` because
 * asking for a different one forces a model reload for everything else on that
 * host. So 4096 is the real budget and it has to be divided deliberately:
 *
 *   instructions + category definitions   ~2,650 tokens (grows with the mapping table)
 *   num_predict (MAX_OUTPUT_TOKENS)          300 tokens
 *   post text                                900 tokens  ← TEXT_TOKEN_BUDGET
 *
 * Overrunning it is SILENT: Ollama does not error when a prompt exceeds num_ctx,
 * it drops the OLDEST tokens — here the head of the prompt, i.e. the very list of
 * moderation categories the model is being asked to choose from.
 *
 * A character cap cannot do this job. Measured with `prompt_eval_count`, 2,000
 * characters of English is ~500 tokens, while the same length of Indic script
 * (Telugu, and the Devanagari and Urdu that also appear in this feed)
 * approaches 2,000 — about 2 tokens per character against English's 0.25. The
 * same cap is either wasteful or destructive depending on the script, hence the
 * estimator below, which charges non-Latin characters at their real rate.
 *
 * In the normal path analysisService pre-translates non-English text before
 * calling, so this mostly matters when that translation fails — which is exactly
 * when a silent truncation would be hardest to notice.
 *
 * MAX_OUTPUT_TOKENS is 300 because the JSON this prompt asks for measured 108-135
 * output tokens; 700 was reserving five times what it uses, out of the same 4096.
 */
const TEXT_TOKEN_BUDGET = parseInt(process.env.CATEGORIZE_TEXT_TOKEN_BUDGET || '900', 10);
const MAX_OUTPUT_TOKENS = parseInt(process.env.CATEGORIZE_MAX_TOKENS || '300', 10);

/**
 * Rough token count. Deliberately PESSIMISTIC — over-estimating costs a few
 * truncated characters, under-estimating costs the head of the prompt.
 * Non-Latin (Telugu, Devanagari, Urdu…) is charged at 2 tokens/char, Latin at
 * 1/3.5, both measured against this model rather than assumed.
 */
const estimateTokens = (s) => {
  // The Latin block is U+0000-U+024F, which deliberately includes whitespace:
  // newlines and tabs are plentiful in article text, and charging them at the
  // non-Latin rate would over-truncate every long post for no reason.
  const nonLatin = (s.match(/[^\u0000-\u024F]/gu) || []).length;
  return Math.ceil(nonLatin * 2 + (s.length - nonLatin) / 3.5);
};

/** Longest prefix of `text` that fits `budget` tokens, cut on a space when possible. */
const fitToTokenBudget = (text, budget) => {
  if (estimateTokens(text) <= budget) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(text.slice(0, mid)) <= budget) lo = mid; else hi = mid - 1;
  }
  let cut = text.slice(0, lo);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > lo * 0.8) cut = cut.slice(0, lastSpace);
  // Slicing by code unit can land between the halves of an emoji; drop the
  // orphaned lead surrogate rather than send a broken character to the model.
  return cut.replace(/[\uD800-\uDBFF]$/, '');
};

/**
 * Categorization (V7) — routed through llmProvider.
 * Default provider is Ollama (qwen2.5:7b) with RapidAPI as fallback.
 * Controlled by GlobalProfileSettings.flags.llm_provider.
 */
async function categorizeText(rawText) {
  // 1. Ensure Mapping Data is loaded (avoid empty categorization lists)
  await mappingService.waitForLoad();

  const fullText = String(rawText == null ? '' : rawText);
  const text = fitToTokenBudget(fullText, TEXT_TOKEN_BUDGET);
  if (text.length < fullText.length) {
    console.log(
      `[LLM] Post text truncated to fit the 4096 context: ${fullText.length} → ${text.length} chars ` +
      `(~${estimateTokens(fullText)} → ~${estimateTokens(text)} tokens, budget ${TEXT_TOKEN_BUDGET}).`
    );
  }

  // Dynamic Prompt Construction
  const categories = mappingService.mappingData.category_mappings || [];
  console.log(`[LLM] Constructing prompt with ${categories.length} allowed categories.`);
  const categoryListStr = categories.map(c => `- ${c.category_id}`).join('\n');
  const definitionsStr = categories.map(c => `
- ${c.category_id}
  ${c.definition || "No definition provided."}
`).join('\n');

  const prompt = `
You are an elite multilingual content moderation expert specializing in the Indian sociopolitical context.
You have TWO jobs:
1. CONTENT MODERATION: Select EXACTLY ONE moderation category from the provided list.
2. GRIEVANCE TOPIC: Classify what real-world issue this post is about.
3. SENTIMENT ANALYSIS: Determine the emotional tone of the post.

════════════════════════
JOB 1: CONTENT MODERATION
════════════════════════
ANALYSIS RULES:
- TRANSLITERATION HANDLING: If the text is an Indian language written in English script (e.g., Telugu written in Roman script — "Telgish"), you MUST first correctly translate the intent. Do not assume it is English.
- INTENT OVER SURFACE: Identify threats, slurs, and violent intent even when expressed in informal or transliterated slang.
- CONTEXT: Distinguish between neutral political dissent and targeted harm.
- RELIGIOUS GREETINGS ARE HARMLESS: Common Indian greetings and blessings like "जय माता दी", "Jai Mata Di", "Jai Shri Ram", "Allahu Akbar", "Waheguru Ji", "Om Namah Shivaya", "Radhe Radhe", "Har Har Mahadev" etc. are NORMAL everyday expressions. They are NOT communal content, NOT hate speech, NOT threats. Tagging a political handle while saying a greeting does NOT make it communal or political.
- BENIGN CONTENT DEFAULT: If a post is just a greeting, blessing, compliment, congratulation, or casual conversation with NO harmful intent → ALWAYS classify as 'Normal'. Do NOT overthink or force a harmful category onto harmless text.

AVAILABLE CATEGORIES:
${categoryListStr}

CATEGORY DEFINITIONS:
${definitionsStr}

- Select EXACTLY ONE category ID from the list above.
- If the content is harmless/neutral/a greeting/a blessing → 'Normal'.
- ONLY use harmful categories (Hate_Speech, Communal_Violence, etc.) when there is CLEAR, EXPLICIT harmful content — slurs, threats, incitement, abuse. Never flag benign text.

════════════════════════
JOB 2: GRIEVANCE TOPIC CLASSIFICATION
════════════════════════
Classify the content into EXACTLY ONE of these predefined grievance topics.

ALLOWED GRIEVANCE TOPICS:
- Political Criticism — criticism of politicians, political parties, government policies, elections
- Hate Speech — communal hate, caste slurs, religious targeting, extremism
- Public Complaint — general citizen complaints about public services (electricity, water, sanitation, hospitals, schools, pensions etc.)
- Corruption Complaint — allegations of bribery, scams, misuse of funds, nepotism
- Government Praise — content appreciating or praising government work, schemes, or leaders
- Traffic Complaint — traffic jams, signal issues, road rage, challan disputes, parking problems
- Public Nuisance — noise pollution, illegal dumping, encroachments, stray animals, eve teasing
- Road & Infrastructure — potholes, broken roads, damaged bridges, street light issues, construction delays
- Law & Order — police inaction, crime reports, drug menace, theft, safety concerns
- Normal — neutral content with no complaint, grievance, or praise (greetings, casual chat, memes, jokes, blessings)

RULES:
- Select EXACTLY ONE topic from the list above. Do NOT invent new topics.
- If the post is a greeting, blessing, joke, meme, or casual chat → "Normal".
- Focus on the GROUND-LEVEL PROBLEM, not who is tagged.
- If someone tags a politician about power cuts → "Public Complaint" (NOT Political Criticism).
- If content has political criticism AND a specific complaint, pick the more specific complaint topic.
- Default to "Normal" when unsure.

════════════════════════
JOB 3: SENTIMENT ANALYSIS
════════════════════════
Identify the sentiment in the context of ${CLIENT_DESCRIPTION}.
  Our camp       : ${OUR_CAMP_SUMMARY} — leaders include ${OUR_CAMP_LEADERS.join(', ')}.
  Opposition     : ${OPPOSITION_SUMMARY}.

MIXED-PARTY POSTS: When a post mentions BOTH our camp AND an opposition party/leader (e.g. "X did great work, unlike the current government" or "the government failed the people but the opposition delivered"), first work out which clause is actually about which entity, then score sentiment for OUR side of that comparison ONLY. Praise of the opposition does not make the post positive, and criticism of the opposition does not make it negative — judge our camp's own tone independently of what's said about the other party.
- 'positive':
    * Praise, gratitude or support towards the Chief Minister, our camp's leaders, our party, or the ${STATE_NAME} government.
    * Appreciation for government schemes, governance and development work across ${STATE_NAME} (infrastructure, welfare schemes, jobs, tourism).
    * Criticism, mockery, or reporting of scandals regarding the opposition parties and their leaders.
    * General positive greetings, festival messages, and celebrations involving our camp's leaders.
- 'negative':
    * Direct criticism, complaints, or anger directed at the Chief Minister, our camp's leaders, our party, or the ${STATE_NAME} government.
    * Genuine public grievances within ${STATE_NAME} (electricity, water, roads, jobs, mining, tourism, law & order).
    * Hate speech, communal incitement, or personal attacks against our camp's leaders.
- 'neutral':
    * Purely informational news, questions, or vague/balanced statements without clear positive or negative political tone.

════════════════════════
JOB 4: RISK ASSESSMENT
════════════════════════
Determine the risk level and score:
- 'low' (0-40): Harmless, informational, or minor citizen complaints.
- 'medium' (41-71): Moderate complaints, political criticism, or infrastructure issues.
- 'high' (72-100): Severe threats, hateful rhetoric, communal incitement, or major corruption allegations.

════════════════════════
JOB 5: SEVERITY (citizen-impact)
════════════════════════
How urgent is this for the citizen / region (NOT for the politician)?
- 'low'      : informational / praise / minor inconvenience
- 'medium'   : ongoing service complaint (power outage, road damage, water shortage)
- 'high'     : public safety risk, multiple-people-affected, serious infra failure
- 'critical' : life-threatening, riot/violence risk, mass agitation, hospital/water emergency

════════════════════════
JOB 6: CONCERNED DEPARTMENT
════════════════════════
Pick EXACTLY ONE government department best suited to act on this post.
ALLOWED DEPARTMENTS (use the exact label):
- Roads & Buildings
- Municipal & Sanitation
- Water Supply
- Electricity
- Health & Medical
- Education
- Police & Law Order
- Revenue
- Agriculture
- Welfare & Pensions
- Employment & Skill Development
- Transport & RTA
- Forest & Environment
- General Administration

If the post is not a grievance (greeting, praise, joke) → "General Administration".

════════════════════════
JOB 7: CAMPAIGN TOPIC
════════════════════════
Which real-world ISSUE the post is about, used to group posts into campaigns.
Choose from THIS list and this list only:

${CAMPAIGN_TOPICS.join(', ')}

Pick the subject, not the tone. "Elections & Politics" is for party/candidate talk
that names no service issue. "None" only for spam, advertising, unintelligible text,
or pure personal abuse with no issue in it.

⚠ THE THREE LISTS ARE SEPARATE — DO NOT MIX THEM.
This prompt gives you three different vocabularies, one per field:
  • "category"        → ONLY a value from AVAILABLE CATEGORIES (JOB 1)
  • "grievance_type"  → ONLY a value from ALLOWED GRIEVANCE TOPICS (JOB 2)
  • "campaign_topic"  → ONLY a value from the JOB 7 list above
A label from one list is INVALID in the other two fields, even when it looks like a
better description. Answer each field from its own list, independently.

════════════════════════
OUTPUT FORMAT (STRICT JSON ONLY):
════════════════════════
{
  "category": "<copy one ID verbatim from AVAILABLE CATEGORIES in JOB 1>",
  "reasoning": "<why this moderation category>",
  "grievance_type": "<copy one label verbatim from ALLOWED GRIEVANCE TOPICS in JOB 2>",
  "grievance_reasoning": "<1-line plain summary of what the person is complaining about>",
  "campaign_topic": "<copy one label verbatim from the JOB 7 list>",
  "sentiment": "positive | negative | neutral",
  "target_party": "OUR_GROUP | OPPOSITION | NEUTRAL",
  "risk_level": "low | medium | high",
  "risk_score": <number 0-100 indicating severity>,
  "severity": "low | medium | high | critical",
  "concerned_department": "<one of the allowed departments>"
}

"target_party" tells us WHOSE side the post is actually about, so downstream
checks know what your "sentiment" value means:
- "OUR_GROUP"  → the post is primarily about our camp: ${OUR_CAMP_SUMMARY} or its leaders.
- "OPPOSITION" → the post is primarily about the opposition: ${OPPOSITION_SUMMARY}.
- "NEUTRAL"    → neither side is the subject (off-topic, generic news, a civic
                 complaint naming nobody, a greeting). Use this when unsure.

────────────────────────
TEXT TO ANALYZE:
<<<
${text}
>>>
`;

  try {
    console.log(`[LLM] Calling LLM (via llmProvider) for categorization`);
    const result = await chatJson({
      prompt,
      temperature: 0,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    if (!result) {
      console.warn('[LLM] RapidAPI returned no parseable JSON.');
      return null;
    }

    // --- CATEGORY VALIDATION ---
    const availableCategories = (mappingService.mappingData.category_mappings || []).map(c => c.category_id);
    let finalCategory = result.category;

    console.log(`[LLM] Raw Category: "${finalCategory}"`);

    if (!availableCategories.includes(finalCategory)) {
      // Try strict case-insensitive match (trim + case)
      const exactMatch = availableCategories.find(c =>
        String(c).trim().toLowerCase() === String(finalCategory).trim().toLowerCase()
      );

      if (exactMatch) {
        finalCategory = exactMatch;
      } else {
        console.warn(`[LLM] INVALID CATEGORY: "${finalCategory}". Fallback to 'Normal'.`);
        finalCategory = 'Normal';
      }
    }

    // --- GRIEVANCE TOPIC VALIDATION ---
    const ALLOWED_TOPICS = [
      'Political Criticism', 'Hate Speech', 'Public Complaint', 'Corruption Complaint',
      'Government Praise', 'Traffic Complaint', 'Public Nuisance', 'Road & Infrastructure',
      'Law & Order', 'Normal'
    ];
    let finalTopic = result.grievance_type || 'Normal';
    if (!ALLOWED_TOPICS.includes(finalTopic)) {
      const topicMatch = ALLOWED_TOPICS.find(t => t.toLowerCase() === String(finalTopic).trim().toLowerCase());
      if (topicMatch) {
        finalTopic = topicMatch;
      } else {
        console.warn(`[LLM] INVALID TOPIC: "${finalTopic}". Fallback to 'Normal'.`);
        finalTopic = 'Normal';
      }
    }

    // --- CAMPAIGN TOPIC VALIDATION ---
    // Deliberately normalised through the SAME function the backfill script uses
    // (campaignTaxonomy.normalizeCampaignTopic), so a post classified here at ingest
    // and one classified later by backfill-grievance-topics.js are guaranteed to
    // agree — otherwise Stage A would group the same issue under two spellings.
    // Returns null, never a guess, when the model answers outside the taxonomy.
    const finalCampaignTopic = normalizeCampaignTopic(result.campaign_topic);
    if (result.campaign_topic && !finalCampaignTopic) {
      console.warn(`[LLM] campaign_topic "${result.campaign_topic}" is outside the taxonomy — storing null.`);
    }

    // --- SENTIMENT VALIDATION ---
    const ALLOWED_SENTIMENTS = ['positive', 'negative', 'neutral'];
    let finalSentiment = String(result.sentiment || 'neutral').toLowerCase();
    if (finalSentiment === 'moderate') finalSentiment = 'neutral'; // retired label
    if (!ALLOWED_SENTIMENTS.includes(finalSentiment)) {
      finalSentiment = 'neutral';
    }

    // --- SEVERITY VALIDATION ---
    const ALLOWED_SEVERITY = ['low', 'medium', 'high', 'critical'];
    let finalSeverity = result.severity || result.risk_level || 'low';
    if (!ALLOWED_SEVERITY.includes(finalSeverity)) finalSeverity = 'low';

    // --- DEPARTMENT VALIDATION ---
    const ALLOWED_DEPARTMENTS = [
      'Roads & Buildings', 'Municipal & Sanitation', 'Water Supply',
      'Electricity', 'Health & Medical', 'Education',
      'Police & Law Order', 'Revenue', 'Agriculture',
      'Welfare & Pensions', 'Employment & Skill Development',
      'Transport & RTA', 'Forest & Environment', 'General Administration'
    ];
    let finalDept = result.concerned_department || 'General Administration';
    if (!ALLOWED_DEPARTMENTS.includes(finalDept)) {
      const lc = String(finalDept).toLowerCase();
      finalDept = ALLOWED_DEPARTMENTS.find((d) => d.toLowerCase() === lc) || 'General Administration';
    }

    // --- TARGET PARTY VALIDATION ---
    // Consumed by analysisService.buildQualityGate to decide whether a
    // disagreement with the Stage 4 verdict is a genuine contradiction (both
    // client-relative) or an expected difference (generic tone vs client-relative).
    const ALLOWED_TARGET_PARTIES = ['OUR_GROUP', 'OPPOSITION', 'NEUTRAL'];
    let finalTargetParty = String(result.target_party || 'NEUTRAL').toUpperCase().trim().replace(/[-\s]/g, '_');
    if (finalTargetParty === 'OURS' || finalTargetParty === 'ALLY' || finalTargetParty === 'NDA' || finalTargetParty === 'BJP') {
      finalTargetParty = 'OUR_GROUP';
    }
    if (finalTargetParty === 'OPP' || finalTargetParty === 'INC' || finalTargetParty === 'CONGRESS') finalTargetParty = 'OPPOSITION';
    if (!ALLOWED_TARGET_PARTIES.includes(finalTargetParty)) finalTargetParty = 'NEUTRAL';

    return {
      category: finalCategory,
      reasoning: result.reasoning || "",
      grievance_type: finalTopic,
      grievance_reasoning: result.grievance_reasoning || "",
      // The 16-value CAMPAIGN taxonomy — distinct from grievance_type above.
      // Consumed by analysisService → analysis.topic, which is what AI Campaigns
      // Stage A groups on. null when the model returned nothing usable.
      campaign_topic: finalCampaignTopic,
      /**
       * Stamped whenever the model ANSWERED, even when the answer was "None"
       * (→ null topic). The version means "classified under taxonomy v1", not
       * "has a topic" — a spam post genuinely has no campaign topic and is fully
       * classified.
       *
       * The distinction matters twice over: the backfill uses this as its resume
       * cursor and would otherwise re-ask the model about the same spam forever,
       * and displayGate treats a null version as "still pending" and would
       * withhold every such post for the whole pending window.
       *
       * When the LLM is unreachable, categorizeText returns null before reaching
       * here, so nothing is stamped and the post is correctly still pending.
       */
      campaign_topic_taxonomy_version: TOPIC_TAXONOMY_VERSION,
      confidence: {
        topic: finalCampaignTopic ? 0.7 : 0.45,
      },
      sentiment: finalSentiment,
      target_party: finalTargetParty,
      risk_level: result.risk_level || 'low',
      risk_score: result.risk_score || 10,
      severity: finalSeverity,
      concerned_department: finalDept
    };
  } catch (err) {
    console.error(`[LLM] categorization failed:`, err.message);
    return null;
  }
}

module.exports = {
  categorizeText
};
