/**
 * campaignTaxonomy — the 16-value CAMPAIGN topic vocabulary and its normaliser.
 *
 * Lifted verbatim from the multi-tenant saga's llmService, into its own module rather
 * than bolted onto this deployment's llmService. That file is large, shared by every
 * monitoring path, and none of this is needed by any of them — a separate module keeps
 * the campaign feature additive and leaves the existing analysis pipeline untouched.
 *
 * WHY A SECOND TAXONOMY AT ALL. Grievance.analysis.grievance_type already classifies
 * posts, but its "Public Complaint" bucket merges water, power, roads, schools and
 * pensions, and "Normal" swallows a large share of the corpus. A campaign has to be
 * about ONE issue, so it needs the finer split these values provide.
 */

/**
 * Campaign topic — the real-world SUBJECT a post is about.
 *
 * Deliberately separate from `grievance_type`, and deliberately orthogonal to
 * stance. grievance_type answers "what kind of post is this" (Public Complaint,
 * Government Praise); topic answers "what is it about" (Water Supply); stance
 * answers "whose side does it help". A post criticising the government over
 * borewells is grievance_type=Public Complaint, topic=Water Supply,
 * stance=anti_target — three independent axes, and the campaign engine needs all
 * three.
 *
 * This exists because grievance_type is too coarse to campaign on: its
 * "Public Complaint" value covers water, electricity, sanitation, hospitals,
 * schools and pensions at once, so aggregating on it yields one undifferentiated
 * mega-bucket instead of the per-issue split a campaign needs.
 *
 * Keep this list SHORT and STABLE — it is the aggregation's group key. Adding a
 * value means historical posts never carry it until they are re-classified, so
 * additions should be rare and deliberate (bump TOPIC_TAXONOMY_VERSION when they
 * happen).
 */
const CAMPAIGN_TOPICS = [
  'Water Supply',
  'Electricity',
  'Sanitation & Waste',
  'Roads & Transport',
  'Health Services',
  'Education',
  'Housing & Land',
  'Pensions & Welfare',
  'Employment & Jobs',
  'Agriculture & Farmers',
  'Law & Order',
  'Corruption',
  'Environment',
  'Governance & Administration',
  'Elections & Politics',
  'None',
];

const TOPIC_TAXONOMY_VERSION = 1;

/**
 * Match an LLM-returned topic to the taxonomy, or null when it does not belong.
 *
 * Returns null — never a guess — for anything unrecognised, and for the explicit
 * "None". A wrong topic is worse than a missing one: the aggregation would surface
 * a phantom issue and a campaign would be written about it.
 */
/**
 * Near-misses that are UNAMBIGUOUS — the model named the right bucket by a shorter or
 * more common name. Measured against real output: "Transport" came back for a bus-pass
 * complaint and was discarded, losing a correctly classified post.
 *
 * Only synonyms with exactly one possible target belong here. Anything that could
 * plausibly be two topics is deliberately absent, so it still returns null rather than
 * being filed under a guess.
 */
const CAMPAIGN_TOPIC_ALIASES = {
  transport: 'Roads & Transport',
  roads: 'Roads & Transport',
  road: 'Roads & Transport',
  infrastructure: 'Roads & Transport',
  water: 'Water Supply',
  drinkingwater: 'Water Supply',
  power: 'Electricity',
  powersupply: 'Electricity',
  sanitation: 'Sanitation & Waste',
  waste: 'Sanitation & Waste',
  garbage: 'Sanitation & Waste',
  health: 'Health Services',
  healthcare: 'Health Services',
  hospitals: 'Health Services',
  schools: 'Education',
  housing: 'Housing & Land',
  land: 'Housing & Land',
  pension: 'Pensions & Welfare',
  pensions: 'Pensions & Welfare',
  welfare: 'Pensions & Welfare',
  employment: 'Employment & Jobs',
  jobs: 'Employment & Jobs',
  unemployment: 'Employment & Jobs',
  agriculture: 'Agriculture & Farmers',
  farmers: 'Agriculture & Farmers',
  lawandorder: 'Law & Order',
  crime: 'Law & Order',
  police: 'Law & Order',
  corruption: 'Corruption',
  governance: 'Governance & Administration',
  administration: 'Governance & Administration',
  politics: 'Elections & Politics',
  elections: 'Elections & Politics',
  election: 'Elections & Politics',
};

const normalizeCampaignTopic = (raw) => {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  // Case- and separator-insensitive: models return "water supply", "Water_Supply",
  // "Water and Sanitation" — the first two are the same topic, the third is not.
  //
  // The standalone word "and" folds to the same thing as "&" because 9 of the 16
  // labels join two words with "&" and a model rewriting it as "and" is common —
  // it cost us "Roads and Transport" outright, and the `lawandorder` entry below
  // is a one-off patch for the same failure. Folding it here retires the whole
  // class. The \b guard is what keeps "Housing & Land" from becoming "housing l":
  // the "and" inside "land" has a word character before it, so it never matches.
  const key = (v) => v.toLowerCase().replace(/\band\b/g, ' ').replace(/[\s_&-]+/g, '');
  const k = key(s);
  const hit = CAMPAIGN_TOPICS.find((t) => key(t) === k);
  if (hit) return hit === 'None' ? null : hit;
  // Exact match failed — try the unambiguous synonyms before giving up.
  return CAMPAIGN_TOPIC_ALIASES[k] || null;
};
const CAMPAIGN_TOPICS_BLOCK = `- Water Supply — drinking water, borewells, taps, tankers, pipelines, water scarcity or contamination
- Electricity — power cuts, voltage, billing, transformers, street lighting supply
- Sanitation & Waste — garbage collection, drainage, sewage, open defecation, public toilets
- Roads & Transport — potholes, road quality, bridges, buses, traffic, parking, public transport
- Health Services — hospitals, clinics, doctors, medicines, ambulances, disease outbreaks
- Education — schools, colleges, teachers, fees, admissions, scholarships, mid-day meals
- Housing & Land — housing schemes, land disputes, encroachment, evictions, property records
- Pensions & Welfare — pensions, ration, subsidies, welfare schemes, benefit delays
- Employment & Jobs — unemployment, recruitment, job notifications, wages, labour issues
- Agriculture & Farmers — crops, irrigation, fertiliser, procurement, MSP, farm loans, compensation
- Law & Order — crime, police action or inaction, safety, drugs, communal tension
- Corruption — bribery, scams, misuse of funds, nepotism, tender irregularities
- Environment — pollution, tree felling, lakes, mining, industrial waste, climate
- Governance & Administration — general administration, officials, delays, transfers, policy with no single service above
- Elections & Politics — elections, campaigning, party politics, alliances, political statements with no civic issue
- None — no identifiable real-world subject (greetings, memes, jokes, casual chat, spam)`;

module.exports = {
  CAMPAIGN_TOPICS,
  CAMPAIGN_TOPICS_BLOCK,
  CAMPAIGN_TOPIC_ALIASES,
  TOPIC_TAXONOMY_VERSION,
  normalizeCampaignTopic,
};
