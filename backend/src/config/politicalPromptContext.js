/**
 * politicalPromptContext.js — reusable, config-derived prompt blocks.
 *
 * Every LLM prompt that needs to know WHO the client is, who governs, who the
 * rivals are and what the stance words mean builds it from here, so the same
 * political frame reaches every module and cannot drift per prompt.
 *
 * Nothing here is a second political taxonomy: names, roles, camps and schemes
 * are READ from politicalData.js / politicalEntities.js / deployment.js. Only the
 * wording of the rules is written here. If the roster changes (a new minister, a
 * new defector, a re-assigned handle) every prompt follows without an edit.
 *
 * Blocks (all strings):
 *   CLIENT_CONTEXT        who the client is and that it is in opposition
 *   CLIENT_LEADERS        the client's leadership and their roles
 *   GOVERNMENT_CONTEXT    the governing party and its head
 *   RIVAL_PARTIES         the other parties
 *   POLITICAL_ACTORS      defectors, institutions and other actors worth knowing
 *   CURRENT_ISSUES        structural issues: schemes by who built them, contested pairs
 *   STANCE_DEFINITIONS    what pro/anti/neutral/mixed mean FOR THE CLIENT
 *   ATTRIBUTION_RULES     allegation vs fact; who is speaking
 *   TELUGU_ANALYSIS_RULES Telugu / Telglish / sarcasm / "garu" / quotes
 *   TRS_RULE              the TRS name collision
 *
 * CURRENT_ISSUES is deliberately STRUCTURAL (scheme ownership, institutions). It
 * names no news event and no rumour, so it does not go stale and is not a hard-coded
 * claim about a live story.
 */

const {
    OUR_PARTY,
    OPPOSITION_PARTIES,
    PARTY_CHIEF,
    OUR_FRONTBENCH,
    RULING_MINISTERS,
    DEFECTED_MLAS,
} = require('./politicalData');
const {
    CLIENT_DESCRIPTION,
    RULING_GOVERNMENT_DESCRIPTION,
    OPPOSITION_SUMMARY,
    OUR_CAMP_SUMMARY,
    STATE_NAME,
    LANGUAGES_DESCRIPTION,
} = require('./deployment');
const { POLITICAL_ENTITIES, GOVERNMENT_SCHEMES } = require('./politicalEntities');

const CLIENT = OUR_PARTY.name;                       // "BRS"
const shortRole = (r) => String(r || '').split(';')[0].replace(/\s*\(since[^)]*\)/i, '').trim();

/* ─── client ─────────────────────────────────────────────────────────── */

const CLIENT_CONTEXT =
    `OUR CLIENT is ${CLIENT_DESCRIPTION}. Every verdict is measured relative to ${CLIENT}: ` +
    `does the text help or hurt ${CLIENT}? ${CLIENT} is NOT the government, and its leaders hold no ministry.`;

const leaderLine = (l) => `${l.name}${l.shortName && l.shortName !== l.name ? ` (${l.shortName})` : ''} — ${shortRole(l.role)}`;
const CLIENT_LEADERS_LIST = (() => {
    const top = (OUR_FRONTBENCH || []).filter((l) => !l.derived).slice(0, 3);
    const named = top.length ? top : (PARTY_CHIEF ? [PARTY_CHIEF] : []);
    return named.map(leaderLine);
})();
const CLIENT_LEADERS = CLIENT_LEADERS_LIST.length
    ? `${CLIENT} leadership: ${CLIENT_LEADERS_LIST.join('; ')}.`
    : '';

/* ─── government and rivals ──────────────────────────────────────────── */

const MINISTERS = (RULING_MINISTERS || []).filter((l) => !l.derived).slice(0, 5).map((l) => l.shortName || l.name);
const GOVERNMENT_CONTEXT =
    `THE GOVERNMENT of ${STATE_NAME} is ${RULING_GOVERNMENT_DESCRIPTION}` +
    `${MINISTERS.length ? `; ministers include ${MINISTERS.join(', ')}` : ''}. ` +
    `It is ${CLIENT}'s principal adversary. "The government", "the state government", "Praja Palana", ` +
    `"Congress sarkar" and "Revanth sarkar" all mean THIS government — not ${CLIENT}. ` +
    `A post about BRS's own years in office (2014-2023) names BRS/KCR/the former government, not "the government".`;

const RIVAL_PARTIES = `RIVAL PARTIES: ${OPPOSITION_SUMMARY}.`;

/* ─── other actors ───────────────────────────────────────────────────── */

const DEFECTOR_NAMES = (DEFECTED_MLAS || []).map((m) => m.name);
const NEUTRAL_INSTITUTIONS = Object.values(POLITICAL_ENTITIES)
    .filter((e) => e.type === 'institution')
    .map((e) => e.canonical);

const POLITICAL_ACTORS =
    `OTHER ACTORS: ${OUR_CAMP_SUMMARY} is our camp. ` +
    (DEFECTOR_NAMES.length
        ? `MLAs ELECTED ON A ${CLIENT} TICKET WHO NOW SIT WITH THE GOVERNMENT (${DEFECTOR_NAMES.join(', ')}) belong to the RIVAL camp today: ` +
          `calling one a turncoat or "defector" attacks a rival and does not criticise ${CLIENT}; ` +
          `praise of one by the government's side is praise of a rival. "Former ${CLIENT} MLA" does not make a person ${CLIENT}. `
        : '') +
    (NEUTRAL_INSTITUTIONS.length
        ? `NEUTRAL INSTITUTIONS — never a camp, never the sentiment target just for being named: ${NEUTRAL_INSTITUTIONS.join('; ')}. ` +
          `Choose the person or party the institution's action is being used against or for.`
        : '');

/* ─── structural issues ──────────────────────────────────────────────── */

const schemesBy = (who) => Object.values(GOVERNMENT_SCHEMES).filter((s) => s.built_by === who).map((s) => s.canonical);
const OURS_SCHEMES = schemesBy(OUR_PARTY.id);
const THEIRS_SCHEMES = schemesBy('inc');
const CURRENT_ISSUES =
    `SCHEMES BY WHO BUILT THEM. Built under ${CLIENT} (credit AND criticism land on ${CLIENT}, though the government now administers them): ${OURS_SCHEMES.join(', ')}. ` +
    `Built by the current government (credit AND criticism land on the government): ${THEIRS_SCHEMES.join(', ')}. ` +
    `Rythu Bandhu vs Rythu Bharosa and Dharani vs Bhu Bharati are the dividing lines: a post naming one is usually arguing about the other. ` +
    `A promise-vs-delivery complaint about a government scheme (e.g. Rythu Bharosa paid at less than promised) is criticism of the GOVERNMENT.`;

/* ─── stance + attribution + language rules ──────────────────────────── */

const STANCE_DEFINITIONS =
    `STANCE IS RELATIVE TO ${CLIENT}, never to the words' positivity:\n` +
    `  • PRO-${CLIENT}: praise or defence of ${CLIENT} / its leaders; criticism of the government, Congress, BJP, AIMIM or another rival that positions ${CLIENT} favourably.\n` +
    `  • ANTI-${CLIENT}: criticism of or allegations against ${CLIENT} or its leaders in their political role; claims ${CLIENT} failed in governance or did wrong; praise of a rival when it contrasts them against ${CLIENT}.\n` +
    `  • NEUTRAL: a simple mention, factual reporting, an election result, a neutral comparison, a quote with no context.\n` +
    `  • MIXED: clearly conflicting sentiment toward ${CLIENT} itself (praises it and criticises it in the same post).\n` +
    `  Negative language is NOT anti-${CLIENT}; positive language is NOT pro-${CLIENT}. Criticism of the government ≠ anti-${CLIENT}. Praise of the government ≠ pro-${CLIENT}. ` +
    `Merely naming ${CLIENT}, KCR or KTR is not a stance.`;

const ATTRIBUTION_RULES =
    `ATTRIBUTION: separate WHO SAYS IT from WHO IT IS ABOUT. When a post reports or quotes an accusation ("Congress alleges…", "KTR said…", "Harish Rao slammed…"), ` +
    `report the speaker as claim_source and set claim_type to "allegation" — an allegation is a claim, never an established fact, and the speaker's side does not change who the claim targets. ` +
    `"KTR criticised the government" is still criticism of the government (target = the government), with KTR as the claim source.`;

const TELUGU_ANALYSIS_RULES =
    `LANGUAGE: posts are written in ${LANGUAGES_DESCRIPTION}. Read the INTENT through Telugu script, English, Telugu-English mixing and romanised Telugu ("Telglish"). ` +
    `"garu" and "anna" are honorifics — "KCR garu" is KCR, and an honorific is not praise. ` +
    `Sarcasm and rhetorical questions carry the OPPOSITE of their literal polarity ` +
    `("Praja palana ante idena? Rythu Bharosa ekkada?" mocks the government; "Wow, great job Congress govt, another paper leak 👏" criticises it). ` +
    `Quoted speech is the quoted person's claim, not the author's view. A negative Telugu phrase is NOT automatically anti-${CLIENT}: first find who it is aimed at.`;

const TRS_RULE =
    `"TRS" was ${CLIENT}'s name until October 2022 and is also the abbreviation Kavitha's new party uses. ` +
    `With KCR / KTR / Harish Rao / Car or Pink party / the Telangana movement / a 2014-2022 reference it means ${CLIENT} (historical). ` +
    `With Kavitha / Rakshana Sena / Jagruthi it means her separate party, a rival. With nothing to settle it, do NOT guess — ` +
    `return the entity as "TRS" and let it be reviewed.`;

/* --- compact variants -----------------------------------------------------
 * The shared Ollama host keeps its model at num_ctx 4096 and silently drops the START of an
 * over-long prompt (the instructions), so the Stage-3 extractor cannot afford the full blocks.
 * Same facts, same sources, fewer words. Full blocks stay for prompts with room to spare. */

// Short, readable names for the neutral institutions (fallback: the shortest ASCII alias).
const INSTITUTION_SHORT_NAMES = {
    ts_police: 'Police', ts_acb: 'ACB', ts_sit: 'SIT', election_commission: 'Election Commission',
    telangana_high_court: 'High Court', supreme_court: 'Supreme Court', ts_governor: 'Governor',
    tspsc: 'TGPSC/TSPSC', ghmc: 'GHMC', cag: 'CAG', ghose_commission: 'Ghose Commission',
};
const shortestAscii = (e) => (e.aliases || []).filter((a) => /^[a-z0-9 .'-]+$/i.test(a) && a.length >= 3).sort((a, b) => a.length - b.length)[0] || e.canonical;
const INSTITUTIONS_SHORT = Object.entries(POLITICAL_ENTITIES)
    .filter(([, e]) => e.type === 'institution')
    .map(([k, e]) => INSTITUTION_SHORT_NAMES[k] || shortestAscii(e));

// Rival parties with their two best-known (non-derived) leaders, straight from the roster.
const RIVALS_SHORT = (OPPOSITION_PARTIES || []).map((party) => {
    const leaders = [...new Set((party.leaders || []).filter((l) => !l.derived).map((l) => l.shortName || l.name))].slice(0, 2);
    return `${party.name}${leaders.length ? ` (${leaders.join(', ')})` : ''}`;
}).join('; ');

const COMPACT = {
    POLITICAL_ACTORS:
        `OTHER ACTORS: rival parties — ${RIVALS_SHORT}. ` +
        (DEFECTOR_NAMES.length
            ? `MLAs elected on a ${CLIENT} ticket who now sit with the government (${DEFECTOR_NAMES.join(', ')}) are on the RIVAL side today: calling one a turncoat attacks a rival, not ${CLIENT}. `
            : '') +
        (INSTITUTIONS_SHORT.length
            ? `Neutral institutions, never a camp or the target just for being named: ${INSTITUTIONS_SHORT.join(', ')}.`
            : ''),
    ATTRIBUTION_RULES:
        `Separate WHO SAYS IT from WHO IT IS ABOUT. For a reported or quoted accusation ("Congress alleges…", "KTR said…") give the speaker as claim_source and claim_type "allegation" — a claim, never an established fact. ` +
        `"KTR criticised the government" still targets the government; KTR is only the claim source.`,
    TELUGU_ANALYSIS_RULES:
        `Read INTENT through Telugu script, English, Telugu-English mixing and romanised Telugu. "garu"/"anna" are honorifics, not praise. ` +
        `Sarcasm and rhetorical questions reverse their literal polarity ("Praja palana ante idena? Rythu Bharosa ekkada?" mocks the government). ` +
        `Quoted speech is the quoted person's claim. A negative Telugu phrase is not automatically anti-${CLIENT}: find who it is aimed at first.`,
    /**
     * Shown ONLY for romanised-Telugu posts (ctx.language_hints.has_telugu_roman), where a machine translation
     * often drops the small words that carry the meaning: Google rendered "Revanth sarkar lo rythulaku bharosa
     * ledu, antha mosam" (no assurance for farmers under the Revanth government, it is all cheating) as "the
     * Revanth government has earned the trust of farmers", a full inversion. Everyday words only.
     */
    TELGLISH_GLOSSARY:
        `Common romanised-Telugu words: ledu/ledhu = is not, no, absent; mosam = cheating, fraud; ekkada = where; cheyaledu = did not do; ` +
        `unte = if (they) were there; raavu = will not come; kashtalu = hardships; chesaru/chesindi = did; vallu = those people; ` +
        `antha = all, entirely; chala = very, a lot; lo = in/under; "bharosa" = assurance/trust (and the scheme Rythu Bharosa); sarkar = government. ` +
        `A negation (ledu, cheyaledu) or "mosam" usually makes the sentence a complaint.`,
    TRS_RULE:
        `"TRS" = ${CLIENT}'s name until Oct 2022 AND the abbreviation of Kavitha's new party. With KCR/KTR/Harish Rao/Car or Pink party/2014-2022 it is ${CLIENT}; with Kavitha/Rakshana Sena it is her rival party; otherwise do not guess — return "TRS".`,
};

/** The full "who is who" block, in the order a model reads best. */
const buildPoliticalMap = ({ includeIssues = true, compact = false } = {}) => (compact
    ? [CLIENT_CONTEXT, CLIENT_LEADERS, GOVERNMENT_CONTEXT, COMPACT.POLITICAL_ACTORS]
    : [CLIENT_CONTEXT, CLIENT_LEADERS, GOVERNMENT_CONTEXT, RIVAL_PARTIES, POLITICAL_ACTORS, includeIssues ? CURRENT_ISSUES : '']
).filter(Boolean).join('\n');

module.exports = {
    CLIENT_CONTEXT,
    CLIENT_LEADERS,
    GOVERNMENT_CONTEXT,
    RIVAL_PARTIES,
    POLITICAL_ACTORS,
    CURRENT_ISSUES,
    STANCE_DEFINITIONS,
    ATTRIBUTION_RULES,
    TELUGU_ANALYSIS_RULES,
    TRS_RULE,
    COMPACT,
    RIVALS_SHORT,
    buildPoliticalMap,
};
