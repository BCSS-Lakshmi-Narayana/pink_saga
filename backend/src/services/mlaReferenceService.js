/**
 * mlaReferenceService
 * ─────────────────────────────────────────────────────────────────────
 * Read-only reference layer over the Telangana MLA dataset (119 assembly
 * constituencies; 2023 affidavits via ADR, current party as of Sep 2026;
 * vacant seats carry `mla: null` and `vacant: true`).
 *
 * This is the backend source of truth for MLA ↔ constituency mapping,
 * mirroring frontend/src/data/stateMLAs.js. It powers the Constituency
 * War Room intelligence endpoints (party-strategist view).
 *
 * Also exposes a lightweight, multilingual civic-issue classifier so we
 * can bucket grievance text into actionable categories (roads, water,
 * power, …) without an LLM call.
 */

const MLA_ROSTER = require('../data/state_mlas.json');
const { tokenOccurs } = require('../utils/lexiconMatch');

/* ─── constituency key normalisation (matches frontend) ───────────── */
const normalizeConstituencyKey = (name) =>
  String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // "Taleigão" → "taleigao", not "taleigo"
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .trim();

// Alternate spellings of AC names seen in GeoJSON, news and posts —
// Hindi (Devanagari) and press spellings mapped to the ECI spelling. One
// shared table: frontend/scripts/gen_state_data.js emits the same file.
const CONSTITUENCY_ALIASES = require('../data/state_constituency_aliases.json').aliases;

const MLA_BY_KEY = MLA_ROSTER.reduce((acc, m) => {
  acc[m.key || normalizeConstituencyKey(m.constituency)] = m;
  return acc;
}, {});

const getMlaByConstituency = (name) => {
  const k = normalizeConstituencyKey(name);
  return MLA_BY_KEY[k] || MLA_BY_KEY[CONSTITUENCY_ALIASES[k]] || null;
};

const getAllMlas = () => MLA_ROSTER;

/* ─── parse "Rs 14,27,05,249 ~ 14 Crore+" → numeric rupees ────────── */
const parseRupees = (raw) => {
  if (!raw) return 0;
  const m = String(raw).match(/Rs\s*([0-9,]+)/i);
  if (!m) return 0;
  return Number(m[1].replace(/,/g, '')) || 0;
};

/* ─── multilingual civic-issue lexicon ────────────────────────────── */
/* Tokens in English and Telugu (Telugu script + romanised), matched
 * by utils/lexiconMatch (whole words for Latin script, substrings for
 * Devanagari). Tokens must be specific enough not to hide inside unrelated words
 * (bare "ration" would match "administration"). */
const ISSUE_LEXICON = {
  roads: [
    'road', 'pothole', 'highway', 'flyover', 'bridge', 'national highway', 'orr', 'outer ring road',
    'rasta', 'gunta',
    'రోడ్డు', 'గుంత', 'గుంతలు', 'వంతెన', 'బ్రిడ్జి', 'హైవే',
  ],
  water: [
    'water', 'drinking water', 'tap water', 'borewell', 'hand pump', 'pipeline', 'tanker',
    'mission bhagiratha', 'neeru', 'manchineeru',
    'నీరు', 'తాగునీరు', 'మంచినీరు', 'బోర్వెల్', 'ట్యాంకర్', 'మిషన్ భగీరథ',
  ],
  electricity: [
    'electricity', 'power supply', 'power cut', 'power outage', 'no current', 'transformer', 'voltage',
    'gruha jyothi', 'current', 'vidyut',
    'కరెంటు', 'విద్యుత్', 'ట్రాన్స్ఫార్మర్', 'కరెంటు బిల్లు', 'గృహ జ్యోతి',
  ],
  drainage: [
    'drainage', 'drain', 'sewage', 'nala', 'waterlogging', 'flooding', 'manhole', 'nalla',
    'డ్రైనేజీ', 'మురికినీరు', 'నాలా', 'మ్యాన్హోల్',
  ],
  sanitation: [
    'garbage', 'sanitation', 'toilet', 'swachh', 'cleaning', 'sweeper', 'waste', 'dumping yard',
    'chettha', 'pariseelana',
    'చెత్త', 'పారిశుద్ధ్యం', 'టాయ్లెట్', 'మురికివాడ',
  ],
  health: [
    'hospital', 'doctor', 'nurse', 'medicine', 'ambulance', 'dengue', 'fever', 'phc', 'arogyasri',
    'gandhi hospital', 'nims', 'asupatri', 'vaidyam',
    'ఆసుపత్రి', 'వైద్యం', 'డాక్టర్', 'మందులు', 'డెంగ్యూ', 'జ్వరం', 'ఆరోగ్యశ్రీ',
  ],
  education: [
    'school', 'college', 'teacher', 'student', 'university', 'gurukul', 'hostel', 'mid day meal',
    'fee reimbursement', 'badi', 'vidyarthi',
    'పాఠశాల', 'కళాశాల', 'ఉపాధ్యాయుడు', 'విద్యార్థి', 'గురుకులం', 'హాస్టల్', 'ఫీజు రీయింబర్స్మెంట్',
  ],
  employment: [
    'job', 'jobs', 'unemployment', 'recruitment', 'notification', 'vacancy', 'tgpsc', 'tspsc',
    'group 1', 'group 2', 'paper leak', 'nirudyoga', 'udyogam',
    'ఉద్యోగం', 'నిరుద్యోగం', 'నోటిఫికేషన్', 'పేపర్ లీక్', 'భర్తీ',
  ],
  agriculture: [
    'farmer', 'paddy', 'crop', 'irrigation', 'fertiliser', 'urea', 'cotton', 'procurement', 'msp',
    'loan waiver', 'rythu bandhu', 'rythu bharosa', 'rythu bima', 'kaleshwaram', 'rythu', 'pantalu',
    'రైతు', 'పంట', 'ధాన్యం', 'పత్తి', 'యూరియా', 'సాగునీరు', 'రుణమాఫీ', 'గిట్టుబాటు',
  ],
  welfare: [
    'pension', 'ration', 'ration card', 'housing', 'subsidy', 'beneficiary', 'scheme',
    'indiramma', 'dalit bandhu', 'mahalakshmi', 'cheyutha', 'asara',
    'పించన్', 'రేషన్', 'రేషన్ కార్డు', 'ఇంటి', 'పథకం', 'లబ్ధిదారు', 'ఆసరా',
  ],
  land: [
    'land', 'land records', 'dharani', 'bhu bharati', 'pattadar', 'passbook', 'mutation',
    'assigned land', 'encroachment', 'hydraa', 'bhoomi',
    'భూమి', 'ధరణి', 'భూభారతి', 'పట్టాదారు', 'పాస్ పుస్తకం', 'ఆక్రమణ',
  ],
  law_and_order: [
    'police', 'crime', 'murder', 'theft', 'arrest', 'fir', 'law and order', 'communal', 'riot',
    'ganja', 'drugs', 'cyber crime', 'police station',
    'పోలీసు', 'నేరం', 'హత్య', 'దోపిడీ', 'అరెస్ట్', 'గాంజాయి', 'సైబర్ క్రైం',
  ],
};

const ISSUE_CATEGORIES = Object.keys(ISSUE_LEXICON);

/**
 * Classify a piece of grievance text into civic-issue categories.
 * Returns an array of matched category keys (may be empty).
 */
const classifyIssues = (text) => {
  const lower = String(text || '').toLowerCase();
  if (!lower) return [];
  const hits = [];
  for (const [category, tokens] of Object.entries(ISSUE_LEXICON)) {
    if (tokens.some((t) => tokenOccurs(lower, t))) hits.push(category);
  }
  return hits;
};

/** Roster key for any spelling of an AC name (alias-aware), or null. */
const resolveConstituencyKey = (name) => {
  const m = getMlaByConstituency(name);
  return m ? (m.key || normalizeConstituencyKey(m.constituency)) : null;
};

module.exports = {
  MLA_ROSTER,
  resolveConstituencyKey,
  ISSUE_CATEGORIES,
  normalizeConstituencyKey,
  getMlaByConstituency,
  getAllMlas,
  parseRupees,
  classifyIssues,
  ISSUE_LEXICON,
};
