/**
 * politicalEntities.js
 * ─────────────────────────────────────────────────────────────────────
 * Telangana political entity graph — a DERIVED VIEW over `politicalData.js`, which
 * remains the single source of truth for who exists in the political universe.
 *
 * What this layer adds:
 *   • alignment        — 'ally' | 'opposition' | 'neutral'
 *   • scope            — 'state' | 'national'
 *   • priority         — ranking hint only; NEVER a stance decision
 *   • aliases          — transliterations, nicknames, handles, symbol names,
 *                        and hand-curated NATIVE-SCRIPT spellings
 *   • ALIAS_INDEX      — alias → primary entity (longest alias first)
 *   • ALIAS_CANDIDATES — alias → ALL entities claiming it (ambiguity-aware)
 *
 * IMPORTANT:
 *   This module resolves ENTITY IDENTITY. It does NOT decide political stance.
 *   Stance is decided downstream by services/stanceEngine.js from
 *   (target, target_tone, author) — never from priority or mention order.
 *
 * ⚠ ALIGNMENT IS STATE-SPECIFIC, AND THIS DEPLOYMENT IS INVERTED relative to the
 *   Chhattisgarh/Goa/AP ones it was cloned from. Here BRS is the client and it is
 *   OUT OF POWER, so `alignment: 'ally'` means "our camp", NOT "the government".
 *   The INC government, its ministers and the Speaker are all `'opposition'`,
 *   alongside BJP, AIMIM, CPI, CPI(M) and Kavitha's TRS(K).
 *
 *   The trap to watch: `alignment: 'ally'` and `STATE_GOVERNMENT_ENTITY` used to
 *   point at the same camp. They now point at opposite ones.
 */

const {
    OUR_PARTY,
    ALLY_PARTIES,
    OPPOSITION_PARTIES,
    OUR_FRONTBENCH,
    RULING_MINISTERS,
    PRESIDING_OFFICERS,
    PARTY_ORG_LEADERS,
    NATIONAL_ALLY_LEADERS,
    NATIONAL_OPPOSITION_LEADERS,
    ALLY_MLAS,
    ALLY_MPS,
    OPPOSITION_LEADERS,
} = require('./politicalData');
const { STATE_NAME } = require('./deployment');

/* ─── priority ──────────────────────────────────────────────────────── */

/**
 * Priority is ONLY an entity-ranking hint, used to pick a `primary_target`
 * for display when several entities are mentioned.
 *
 * It must NEVER be used as:
 *   priority → target        (that is `sentiment_target`, extracted per-post)
 *   priority → stance        (that is stanceEngine)
 *   priority → client relevance
 */
const PRIORITY = {
    /**
     * Our principal — KCR, party president and Leader of the Opposition. He
     * outranks the Chief Minister here, which is the reverse of every earlier
     * deployment: this product is read from BRS's side of the room.
     */
    PARTY_PRESIDENT: 100,
    /** The rival head of government. Ranks high as a TARGET, not as a principal. */
    CHIEF_MINISTER: 98,
    /** KTR — runs BRS day to day while KCR keeps a low public profile. */
    WORKING_PRESIDENT: 96,
    DEPUTY_CM: 92,
    PARTY_CHIEF: 90,
    /** BRS itself. Deliberately NOT called RULING_PARTY — we are not ruling. */
    OUR_PARTY_ENTITY: 88,
    /** INC — the party of government, and so our principal adversary. */
    RULING_PARTY: 86,
    OPPOSITION_CHIEF: 85,
    OPPOSITION_PARTY: 84,
    CABINET_MINISTER: 80,
    /** Our deputy floor leaders and legislature-party front bench. */
    FRONTBENCH: 78,
    ALLY_PARTY: 75,
    PRESIDING_OFFICER: 70,
    MP: 60,
    /** Senior figure on the far side. */
    OPPOSITION_SENIOR: 58,
    /** Senior figure on OUR side without a legislative post (party office-bearers). */
    SENIOR_FUNCTIONARY: 58,
    MLA: 55,
    NATIONAL_LEADER: 50,
    NEUTRAL_INSTITUTION: 30,
};

/* ─── curated aliases ───────────────────────────────────────────────── */

/**
 * Hand-curated aliases keyed by the `id` used in politicalData.js.
 *
 * WHY THIS MATTERS MORE THAN ANYTHING ELSE IN THIS FILE:
 * The Stage 2 deterministic pre-scan reads the ORIGINAL post text.
 * Chhattisgarh posts often name a leader only in Devanagari (Hindi press) or by
 * a nickname ("TS Baba", "Bhupesh Kaka"). Without that alias here, Stage 2 cannot see the leader,
 * and Stage 4 has no camp to attach a stance to — the post silently drops to
 * `general_politics`.
 *
 * Devanagari spellings come from Hindi media (Dainik Bhaskar, Haribhoomi,
 * Patrika) and the Assembly's member list. Also included:
 *   • MACHINE-TRANSLATION spellings — the pipeline pre-translates to English
 *     before the LLM extracts actors, and translators vary the spelling.
 *   • Legacy pipeline keys ('bsk', 'bsk_son') so stored `target_entity` values
 *     keep resolving to the primary/secondary client leaders.
 *
 * Very common surnames ("sai", "sao", "baghel", "singh", "sharma") and
 * ordinary words used as nicknames ("kaka" = uncle, "baba") are deliberately
 * NOT aliases on their own: they would match unrelated people and text.
 */
const CURATED_ALIASES = {
    // ── ours ──
    "kcr": ["kcr", "k chandrashekar rao", "kalvakuntla chandrashekar rao", "chandrashekar rao", "chandrasekhar rao", "k chandrasekhar rao", "kcr garu", "former cm kcr", "ex cm kcr", "brs chief", "brs president", "brs supremo", "@kcrbrspresident", "#kcr", "కేసీఆర్", "కల్వకుంట్ల చంద్రశేఖర్ రావు", "చంద్రశేఖర్ రావు", "కేసీఆర్ గారు", "బీఆర్ఎస్ అధినేత"],
    "ktr": ["ktr", "k t rama rao", "kt rama rao", "kalvakuntla taraka rama rao", "taraka rama rao", "brs working president", "working president ktr", "former it minister ktr", "@ktrbrs", "#ktr", "కేటీఆర్", "కల్వకుంట్ల తారక రామారావు", "తారక రామారావు", "కేటీఆర్ గారు"],
    "harish-rao": ["harish rao", "t harish rao", "thanneeru harish rao", "tanneeru harish rao", "former finance minister harish rao", "former irrigation minister harish rao", "@brsharish", "హరీష్ రావు", "తన్నీరు హరీష్ రావు", "హరీశ్ రావు"],
    "sabitha-indra-reddy": ["sabitha indra reddy", "sabitha indrareddy", "సబితా ఇంద్రా రెడ్డి", "సబిత ఇంద్రా రెడ్డి"],
    "talasani-srinivas-yadav": ["talasani srinivas yadav", "talasani", "తలసాని శ్రీనివాస్ యాదవ్", "తలసాని"],
    "kotha-prabhakar-reddy": ["kotha prabhakar reddy", "కొత్త ప్రభాకర్ రెడ్డి"],
    "j-santosh-kumar": ["j santosh kumar", "joginapally santosh kumar", "santosh kumar mp", "జోగినపల్లి సంతోష్ కుమార్"],
    "vaddiraju-ravichandra": ["vaddiraju ravichandra", "ravichandra vaddiraju", "వడ్డిరాజు రవిచంద్ర"],
    "damodar-rao": ["d damodar rao", "divakonda damodar rao", "దామోదర్ రావు"],

    // ── the government ──
    "revanth-reddy": ["revanth reddy", "a revanth reddy", "anumula revanth reddy", "cm revanth", "cm revanth reddy", "telangana cm", "chief minister revanth reddy", "revanth sarkar", "revanth government", "@revanth_anumula", "@telanganacmo", "#revanthreddy", "రేవంత్ రెడ్డి", "అనుముల రేవంత్ రెడ్డి", "ముఖ్యమంత్రి రేవంత్ రెడ్డి", "సీఎం రేవంత్", "రేవంత్ సర్కార్"],
    "bhatti-vikramarka": ["bhatti vikramarka", "mallu bhatti vikramarka", "deputy cm bhatti", "dy cm bhatti", "భట్టి విక్రమార్క", "మల్లు భట్టి విక్రమార్క", "ఉప ముఖ్యమంత్రి భట్టి"],
    "uttam-kumar-reddy": ["uttam kumar reddy", "n uttam kumar reddy", "nalamada uttam kumar reddy", "irrigation minister uttam", "ఉత్తమ్ కుమార్ రెడ్డి", "నలమాద ఉత్తమ్ కుమార్ రెడ్డి"],
    "sridhar-babu": ["sridhar babu", "d sridhar babu", "duddilla sridhar babu", "it minister sridhar babu", "శ్రీధర్ బాబు", "దుద్దిళ్ల శ్రీధర్ బాబు"],
    "ponguleti-srinivasa-reddy": ["ponguleti srinivasa reddy", "ponguleti", "revenue minister ponguleti", "పొంగులేటి శ్రీనివాస రెడ్డి", "పొంగులేటి"],
    "komatireddy-venkat-reddy": ["komatireddy venkat reddy", "komatireddy", "కోమటిరెడ్డి వెంకట్ రెడ్డి", "కోమటిరెడ్డి"],
    "damodar-raja-narasimha": ["damodar raja narasimha", "raja narasimha", "health minister damodar", "దామోదర రాజనర్సింహ"],
    "seethakka": ["seethakka", "sithakka", "danasari anasuya", "d anasuya", "సీతక్క", "దనసరి అనసూయ"],
    "ponnam-prabhakar": ["ponnam prabhakar", "transport minister ponnam", "పొన్నం ప్రభాకర్", "పొన్నం"],
    "jupally-krishna-rao": ["jupally krishna rao", "jupally", "జూపల్లి కృష్ణారావు", "జూపల్లి"],
    "gaddam-prasad-kumar": ["gaddam prasad kumar", "speaker prasad kumar", "assembly speaker", "గడ్డం ప్రసాద్ కుమార్", "స్పీకర్ ప్రసాద్ కుమార్"],
    "mahesh-kumar-goud": ["mahesh kumar goud", "bomma mahesh kumar goud", "tpcc president", "tpcc chief", "మహేష్ కుమార్ గౌడ్", "బొమ్మ మహేష్ కుమార్ గౌడ్", "టీపీసీసీ అధ్యక్షుడు"],

    // ── BJP ──
    "ramchander-rao": ["ramchander rao", "n ramchander rao", "naraparaju ramchander rao", "bjp state president", "telangana bjp president", "రాంచందర్ రావు", "ఎన్ రాంచందర్ రావు"],
    "kishan-reddy": ["kishan reddy", "g kishan reddy", "gangapuram kishan reddy", "union minister kishan reddy", "కిషన్ రెడ్డి", "గంగాపురం కిషన్ రెడ్డి"],
    "bandi-sanjay": ["bandi sanjay", "bandi sanjay kumar", "bandi", "బండి సంజయ్", "బండి సంజయ్ కుమార్"],
    "dk-aruna": ["dk aruna", "d k aruna", "dharmapuri kondala aruna", "డీకే అరుణ"],
    "eatala-rajender": ["eatala rajender", "etela rajender", "etala rajender", "eatala", "ఈటల రాజేందర్", "ఈటెల రాజేందర్"],

    // ── AIMIM ──
    "asaduddin-owaisi": ["asaduddin owaisi", "asad owaisi", "barrister owaisi", "aimim chief", "@asadowaisi", "అసదుద్దీన్ ఒవైసీ", "అసద్ ఒవైసీ", "ఒవైసీ"],
    "akbaruddin-owaisi": ["akbaruddin owaisi", "akbar owaisi", "@akbarowaisi_mim", "అక్బరుద్దీన్ ఒవైసీ", "అక్బర్ ఒవైసీ"],

    // ── left ──
    "kunamneni-sambasiva-rao": ["kunamneni sambasiva rao", "kunamneni", "cpi state secretary", "కూనంనేని సాంబశివరావు", "కూనంనేని"],
    "john-wesley": ["john wesley", "jaggula john wesley", "cpm state secretary", "జాగుల జాన్ వెస్లీ", "జాన్ వెస్లీ"],

    /*
     * Kavitha. The highest-risk entity in this deployment: she is KCR's
     * daughter and her party recycles the "TRS" abbreviation, so both family
     * association and brand pull her toward BRS. Every alias here is one that
     * cannot also mean her father or his party — "kavitha" always qualified,
     * never a bare "kalvakuntla".
     */
    "kavitha": ["k kavitha", "kavitha", "kalvakuntla kavitha", "kavitha kalvakuntla", "mlc kavitha", "@raokavitha", "#kavitha", "కవిత", "కల్వకుంట్ల కవిత", "ఎమ్మెల్సీ కవిత"],

    "raja-singh": ["raja singh", "t raja singh", "tiger raja singh", "raja singh lodha", "goshamahal mla", "రాజా సింగ్", "టీ రాజా సింగ్"],

    // ── national ──
    "narendra-modi": ["narendra modi", "modi", "modi ji", "pm modi", "prime minister modi", "@narendramodi", "@pmoindia", "నరేంద్ర మోదీ", "మోదీ", "ప్రధాని మోదీ"],
    "amit-shah": ["amit shah", "hm shah", "home minister amit shah", "@amitshah", "అమిత్ షా"],
    "rahul-gandhi": ["rahul gandhi", "@rahulgandhi", "రాహుల్ గాంధీ"],
    "mallikarjun-kharge": ["mallikarjun kharge", "kharge", "aicc president", "@kharge", "మల్లికార్జున్ ఖర్గే", "ఖర్గే"],
    "priyanka-gandhi": ["priyanka gandhi", "priyanka gandhi vadra", "@priyankagandhi", "ప్రియాంక గాంధీ"],
};

/**
 * Party-level aliases, keyed by the party id in politicalData.js.
 * Symbol names ("lotus party", "broom") are how ordinary posts often refer to a
 * party without naming it.
 */
const PARTY_ALIASES = {
    /*
     * ⚠ Bare "trs" appears in NO list here.
     *
     * It is ambiguous three ways: this party's own name until Oct 2022, K.
     * Kavitha's Telangana Rakshana Sena founded Apr 2026, and the legacy
     * @trspartyonline handle. Whichever list claimed it would swallow the
     * others' mentions wholesale, and the two parties are led by a father and
     * his estranged daughter attacking each other — the worst possible pair to
     * conflate. Only unambiguous full forms are listed.
     */
    brs: ["brs", "brs party", "bharat rashtra samithi", "bharath rashtra samithi", "telangana rashtra samithi", "telangana rashtra samiti", "car party", "pink party", "@brsparty", "#brs", "#brsparty", "బీఆర్ఎస్", "భారత్ రాష్ట్ర సమితి", "తెలంగాణ రాష్ట్ర సమితి", "కారు పార్టీ", "గులాబీ పార్టీ"],
    inc: ["congress", "indian national congress", "telangana congress", "tpcc", "telangana pradesh congress committee", "hand symbol party", "congress government", "congress sarkar", "@inctelangana", "@incindia", "#congress", "కాంగ్రెస్", "భారత జాతీయ కాంగ్రెస్", "తెలంగాణ కాంగ్రెస్", "టీపీసీసీ", "హస్తం పార్టీ", "కాంగ్రెస్ ప్రభుత్వం"],
    bjp: ["bjp", "bjp telangana", "telangana bjp", "bharatiya janata party", "bharatiya janta party", "lotus party", "saffron party", "@bjp4telangana", "@bjp4india", "#bjp", "బీజేపీ", "భారతీయ జనతా పార్టీ", "కమలం పార్టీ", "తెలంగాణ బీజేపీ"],
    aimim: ["aimim", "mim", "majlis", "ittehadul muslimeen", "all india majlis-e-ittehadul muslimeen", "owaisi party", "@aimim_national", "#aimim", "ఎంఐఎం", "ఏఐఎంఐఎం", "మజ్లిస్"],
    "trs-k": ["telangana rakshana sena", "telangana rashtra sena", "rakshana sena", "kavitha party", "telangana jagruthi", "jagruthi party", "తెలంగాణ రక్షణ సేన", "తెలంగాణ జాగృతి", "రక్షణ సేన"],
    cpi: ["cpi", "communist party of india", "సీపీఐ"],
    cpm: ["cpm", "cpi(m)", "cpi-m", "communist party of india (marxist)", "సీపీఎం"],
};

/**
 * Institutions that must resolve to a NAME but must never be scored as a
 * political camp. Complaints about the police are civic grievances, not
 * attacks on the opposition.
 */
const NEUTRAL_ENTITIES = {
    ts_police: {
        canonical: 'Telangana Police',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: ['telangana police', 'ts police', 'hyderabad police', 'cyberabad police', 'rachakonda police', 'telangana dgp', 'dgp telangana', '@telanganacopsfc', '@hyderabadpolice', '@cyberabadpolice', 'తెలంగాణ పోలీస్', 'పోలీసులు', 'హైదరాబాద్ పోలీస్'],
    },
    /*
     * The Anti-Corruption Bureau is prosecuting KTR over the Formula E
     * payments and has moved to impound his passport. It is named in a large
     * share of hostile BRS coverage, and it must stay NEUTRAL: filing it as an
     * opposition entity would turn every report that merely mentions the
     * investigating agency into an attack on the government.
     */
    ts_acb: {
        canonical: 'Anti-Corruption Bureau, Telangana',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: ['anti-corruption bureau', 'anti corruption bureau', 'acb telangana', 'telangana acb', 'acb court', 'ఏసీబీ', 'అవినీతి నిరోధక శాఖ'],
    },
    /* The SIT running the phone-tapping investigation. Same reasoning as ACB. */
    ts_sit: {
        canonical: 'Special Investigation Team, Telangana',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: ['special investigation team', 'sit telangana', 'telangana sit', 'phone tapping sit', 'ప్రత్యేక దర్యాప్తు బృందం'],
    },
    election_commission: {
        canonical: 'Election Commission of India',
        type: 'institution',
        alignment: 'neutral',
        scope: 'national',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        /* SIR — the Special Intensive Revision of rolls — is live and is delaying
         * the Khairatabad by-poll, so the EC is named far more than usual. */
        aliases: ['election commission', 'eci', 'chief electoral officer', 'ceo telangana', 'special intensive revision', 'sir rolls', 'electoral roll revision', '@eci', 'ఎన్నికల సంఘం', 'ఎన్నికల కమిషన్'],
    },
    telangana_high_court: {
        canonical: 'Telangana High Court',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: ['telangana high court', 'high court of telangana', 'ts high court', 'hc telangana', 'తెలంగాణ హైకోర్టు', 'హైకోర్టు'],
    },
    supreme_court: {
        canonical: 'Supreme Court of India',
        type: 'institution',
        alignment: 'neutral',
        scope: 'national',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: ['supreme court', 'apex court', 'సుప్రీంకోర్టు', 'సర్వోన్నత న్యాయస్థానం'],
    },
    ts_governor: {
        canonical: 'Governor of Telangana',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        /* The office, not the holder — an incumbent's name would go stale. */
        aliases: ['governor of telangana', 'telangana governor', 'raj bhavan', 'తెలంగాణ గవర్నర్', 'గవర్నర్', 'రాజ్ భవన్'],
    },
    tspsc: {
        canonical: 'Telangana State Public Service Commission',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        /* Recruitment-exam leaks are a standing grievance for job aspirants. */
        aliases: ['tspsc', 'tgpsc', 'telangana public service commission', 'group 1 exam', 'group 2 exam', 'paper leak', 'టీఎస్పీఎస్సీ', 'గ్రూప్ 1'],
    },
    ghmc: {
        canonical: 'Greater Hyderabad Municipal Corporation',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: ['ghmc', 'greater hyderabad municipal corporation', 'hyderabad corporation', '@ghmconline', 'జీహెచ్ఎంసీ', 'మున్సిపల్ కార్పొరేషన్'],
    },
    cag: {
        canonical: 'Comptroller and Auditor General of India',
        type: 'institution',
        alignment: 'neutral',
        scope: 'national',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        /* The CAG's Kaleshwaram and sheep-distribution reports are the
         * evidentiary basis for most corruption coverage aimed at BRS. */
        aliases: ['cag', 'comptroller and auditor general', 'cag report', 'కాగ్', 'కాగ్ నివేదిక'],
    },
    ghose_commission: {
        canonical: 'Justice P. C. Ghose Commission of Inquiry',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: ['ghose commission', 'justice ghose commission', 'pc ghose commission', 'commission of inquiry', 'ఘోష్ కమిషన్'],
    },
};

/**
 * The STATE GOVERNMENT as an entity. Departments, the public-relations
 * directorate and the government's own slogans all mean "the government" in a
 * post; without this they matched nothing, so a post crediting or blaming "the
 * government" or one of its departments had no target.
 *
 * ⚠ THE SINGLE MOST IMPORTANT INVERSION IN THIS DEPLOYMENT. In Chhattisgarh,
 * Goa and AP this entity was `party: <client>` / `alignment: 'ally'`, because
 * the client ran the state. In Telangana the government is CONGRESS and we are
 * against it. Left as 'ally' it would read every attack on the administration
 * as an attack on us, and invert the sign of a large share of all stance
 * scoring — the government is the most-mentioned entity in the corpus.
 */
const STATE_GOVERNMENT_ENTITY = {
    canonical: `Government of ${STATE_NAME}`,
    type: 'government',
    party: 'inc',
    alignment: 'opposition',
    scope: 'state',
    priority: PRIORITY.RULING_PARTY,
    aliases: [
        'government of chhattisgarh', 'chhattisgarh government', 'govt of chhattisgarh', 'chhattisgarh govt',
        'cg government', 'cg govt', 'chhattisgarh sarkar', 'sushasan sarkar', '#sushasansarkar', 'vishnudev sarkar',
        '@dprchhattisgarh', 'dpr chhattisgarh', '@cggovt', '@healthcggov', '@schooleducggov', '@pwdcggov',
        '@urbancgofficial', '@muncipalraipur',
        'छत्तीसगढ़ सरकार', 'छत्तीसगढ़ शासन', 'राज्य सरकार', 'प्रदेश सरकार', 'सुशासन सरकार', 'सुशासन',
        'विष्णुदेव सरकार', 'जनसंपर्क छत्तीसगढ़',
    ],
};

/* ─── helpers ───────────────────────────────────────────────────────── */

const clean = (v) => String(v || '').trim();

/** Aliases contributed automatically by a politicalData.js roster entry. */
const deriveRosterAliases = (leader) => {
    const out = [
        clean(leader.name),
        clean(leader.shortName),
        ...(leader.aliases || []).map(clean),
    ];

    for (const handle of leader.handles || []) {
        const bare = clean(handle).replace(/^@/, '');
        if (!bare) continue;
        out.push(`@${bare}`);
        out.push(bare.toLowerCase());
    }

    return out.filter(Boolean);
};

const buildLeaderEntity = (leader, { alignment, priority, scope = leader.scope || 'state' }) => ({
    canonical: leader.name,
    type: 'person',
    party: (leader.party || '').toLowerCase() || null,
    role: leader.role || null,
    constituency: leader.constituency || null,
    district: leader.district || null,
    scope,
    alignment,
    priority,
    derived: !!leader.derived,
    aliases: [
        ...new Set([
            ...deriveRosterAliases(leader),
            ...(CURATED_ALIASES[leader.id] || []),
        ]),
    ],
});

/** Ranks the GOVERNMENT's ministers — every one of them a target here. */
const ministerPriority = (leader) => {
    const role = (leader.role || '').toLowerCase();
    if (role.includes('chief minister') && !role.includes('deputy')) return PRIORITY.CHIEF_MINISTER;
    if (role.includes('deputy chief minister')) return PRIORITY.DEPUTY_CM;
    return PRIORITY.CABINET_MINISTER;
};

/**
 * Ranks OUR legislature-party leadership. Checked in order, because KCR's role
 * string contains both "President" and "Leader of the Opposition" and the
 * working-president test would otherwise swallow the president himself.
 */
const frontbenchPriority = (leader) => {
    const role = (leader.role || '').toLowerCase();
    if (/working president/.test(role)) return PRIORITY.WORKING_PRESIDENT;
    if (/^president,|president, bharat rashtra samithi/.test(role)) return PRIORITY.PARTY_PRESIDENT;
    return PRIORITY.FRONTBENCH;
};

const oppositionPriority = (leader) => {
    const role = (leader.role || '').toLowerCase();
    if (role.includes('leader of opposition') || (role.includes('president') && !role.includes('working'))) {
        return PRIORITY.OPPOSITION_CHIEF;
    }
    if (role === 'mp' || role.startsWith('mp,')) return PRIORITY.MP;
    if (role === 'mla') return PRIORITY.MLA;
    return PRIORITY.OPPOSITION_SENIOR;
};

/* ─── build the entity graph ────────────────────────────────────────── */

const POLITICAL_ENTITIES = {};

const addLeaders = (leaders, opts) => {
    for (const leader of leaders) {
        if (POLITICAL_ENTITIES[leader.id]) continue;
        POLITICAL_ENTITIES[leader.id] = buildLeaderEntity(leader, {
            alignment: opts.alignment,
            priority: typeof opts.priority === 'function' ? opts.priority(leader) : opts.priority,
            ...(opts.scope ? { scope: opts.scope } : {}),
        });
    }
};

/**
 * Order matters. addLeaders() skips anyone already in the graph, so specific
 * collections go in BEFORE the catch-all OPPOSITION_LEADERS sweep — the
 * government's ministers appear in both, and if the sweep reached them first
 * the Chief Minister would be filed as a generic senior figure rather than the
 * highest-ranked target in the state.
 */
addLeaders(OUR_FRONTBENCH, { alignment: 'ally', priority: frontbenchPriority });
addLeaders(PARTY_ORG_LEADERS, {
    alignment: 'ally',
    priority: (l) => (/general secretary/i.test(l.role || '') ? PRIORITY.PARTY_CHIEF : PRIORITY.SENIOR_FUNCTIONARY),
});
addLeaders(NATIONAL_ALLY_LEADERS, { alignment: 'ally', priority: PRIORITY.NATIONAL_LEADER, scope: 'national' });
addLeaders([...ALLY_MLAS, ...ALLY_MPS], {
    alignment: 'ally',
    priority: (l) => (/^mp/i.test(l.role || '') ? PRIORITY.MP : PRIORITY.MLA),
});

/* ── the far side: the government, the Speaker, and the rival parties ── */
addLeaders(RULING_MINISTERS, { alignment: 'opposition', priority: ministerPriority });
addLeaders(PRESIDING_OFFICERS, { alignment: 'opposition', priority: PRIORITY.PRESIDING_OFFICER });
addLeaders(OPPOSITION_LEADERS.filter((l) => l.scope !== 'national'), { alignment: 'opposition', priority: oppositionPriority });
addLeaders(NATIONAL_OPPOSITION_LEADERS, { alignment: 'opposition', priority: PRIORITY.NATIONAL_LEADER, scope: 'national' });

/* ── parties ── */

const buildPartyEntity = (party, alignment, priority) => ({
    canonical: party.full_name || party.name,
    type: 'party',
    party: party.id,
    role: null,
    constituency: null,
    district: null,
    scope: 'state',
    alignment,
    priority,
    derived: false,
    aliases: [
        ...new Set([
            clean(party.name),
            clean(party.full_name),
            ...(party.aliases || []).map(clean),
            ...(PARTY_ALIASES[party.id] || []),
            // The party's own accounts (politicalData merges the verified registry).
            ...(party.handles || []).flatMap((h) => {
                const bare = clean(h).replace(/^@/, '');
                return bare ? [`@${bare}`, bare] : [];
            }),
        ].filter(Boolean)),
    ],
});

POLITICAL_ENTITIES[OUR_PARTY.id] = buildPartyEntity(OUR_PARTY, 'ally', PRIORITY.OUR_PARTY_ENTITY);

for (const party of ALLY_PARTIES) {
    POLITICAL_ENTITIES[party.id] = buildPartyEntity(party, 'ally', PRIORITY.ALLY_PARTY);
}

/**
 * INC ranks above the other rivals because it is the party of government —
 * "the Congress" in a Telangana post usually means the administration, not one
 * opposition party among several. BJP is next: it competes with us for the
 * same anti-government space, so it is named far more often than its seven
 * seats would suggest.
 */
const RIVAL_PARTY_PRIORITY = {
    inc: PRIORITY.RULING_PARTY,
    bjp: PRIORITY.OPPOSITION_PARTY,
};

for (const party of OPPOSITION_PARTIES) {
    POLITICAL_ENTITIES[party.id] = buildPartyEntity(
        party,
        'opposition',
        RIVAL_PARTY_PRIORITY[party.id] || PRIORITY.OPPOSITION_SENIOR,
    );
}

/* ── neutral institutions ── */

for (const [key, ent] of Object.entries(NEUTRAL_ENTITIES)) {
    POLITICAL_ENTITIES[key] = { ...ent, derived: false };
}

/* ── the state government ── */
POLITICAL_ENTITIES.state_government = { ...STATE_GOVERNMENT_ENTITY, role: null, constituency: null, district: null, derived: false };

/* ── government schemes and flagship projects ───────────────────────
 *
 * WHY THESE ARE ENTITIES
 * A post can be squarely about this government without naming a single person
 * ("Mahtari Vandan money still not credited for three months"). Without these
 * entries Stage 2 finds ZERO entities, the stance engine has no camp to attach
 * anything to, and the post scores `unrelated` — invisible to every dashboard.
 *
 * ⚠ TELANGANA NEEDS TWO CAMPS OF SCHEME, NOT ONE.
 *
 * Every earlier deployment could tag all schemes `ally`, because the client
 * both built and ran them. Here the two come apart: BRS governed for nine
 * years, so the state is full of schemes WE BUILT that the Congress government
 * now runs, replaces, or audits. The sign of a post depends on which.
 *
 *   built_by 'brs'  → praise credits US; criticism lands on US.
 *                     Kaleshwaram is the clearest case: it is the single
 *                     largest attack line against BRS, and every attack on it
 *                     is an attack on us even though Congress runs the state.
 *   built_by 'inc'  → praise credits THEM; criticism lands on THEM.
 *                     Rythu Bharosa, Indiramma Indlu, Bhu Bharati, HYDRAA.
 *
 * `replaces` / `replaced_by` link the pairs that define the argument — Dharani
 * vs Bhu Bharati, Rythu Bandhu vs Rythu Bharosa. Those pairings are the
 * sharpest dividing lines in Telangana politics and a post naming one is
 * almost always arguing about the other.
 *
 * PRIORITY IS DELIBERATELY LOW (55) in both camps: a scheme must never
 * outrank a named leader when deciding `primary_target`.
 *
 * Contested ISSUES are NOT schemes — BC reservation, the phone-tapping case,
 * the Musi displacement protests, SIR/roll revision. Filing those under either
 * camp would score every protest about them as an attack on the protesters'
 * own side. They are handled by the civic/topic lexicons instead.
 */
const GOVERNMENT_SCHEMES = {
    /* ── OURS: built under the BRS government (2014-2023) ────────────── */
    'scheme-rythu-bandhu': {
        canonical: 'Rythu Bandhu',
        built_by: 'brs',
        replaced_by: 'scheme-rythu-bharosa',
        aliases: ['rythu bandhu', 'rythubandhu', 'raithu bandhu', 'farmer investment support', '#rythubandhu', 'రైతుబంధు', 'రైతు బంధు'],
    },
    'scheme-dalit-bandhu': {
        canonical: 'Dalit Bandhu',
        built_by: 'brs',
        aliases: ['dalit bandhu', 'dalitbandhu', '#dalitbandhu', 'దళితబంధు', 'దళిత బంధు'],
    },
    'scheme-kaleshwaram': {
        canonical: 'Kaleshwaram Lift Irrigation Project',
        built_by: 'brs',
        /**
         * The heaviest liability in this dataset. A CAG report, the Ghose
         * Commission (which held KCR "directly and indirectly responsible" and
         * also named Harish Rao), and a referral to the CBI all attach here —
         * though the High Court has barred action on the Commission's findings.
         * Almost every mention is hostile, and correctly scores against us.
         */
        aliases: ['kaleshwaram', 'kaleshwaram project', 'kaleshwaram lift irrigation', 'klip', 'medigadda', 'medigadda barrage', 'annaram', 'sundilla', '#kaleshwaram', 'కాళేశ్వరం', 'మేడిగడ్డ'],
    },
    'scheme-mission-bhagiratha': {
        canonical: 'Mission Bhagiratha',
        built_by: 'brs',
        aliases: ['mission bhagiratha', 'bhagiratha', 'mission bhageeratha', 'మిషన్ భగీరథ'],
    },
    'scheme-mission-kakatiya': {
        canonical: 'Mission Kakatiya',
        built_by: 'brs',
        aliases: ['mission kakatiya', 'kakatiya mission', 'tank restoration', 'మిషన్ కాకతీయ'],
    },
    'scheme-dharani': {
        canonical: 'Dharani Portal',
        built_by: 'brs',
        replaced_by: 'scheme-bhu-bharati',
        /** Congress's single biggest 2023 attack line on BRS land governance. */
        aliases: ['dharani', 'dharani portal', 'dharani website', '#dharani', 'ధరణి', 'ధరణి పోర్టల్'],
    },
    'scheme-rythu-bima': {
        canonical: 'Rythu Bima',
        built_by: 'brs',
        aliases: ['rythu bima', 'rythubima', 'raithu bima', 'farmer insurance scheme', 'రైతు బీమా'],
    },
    'scheme-kcr-kit': {
        canonical: 'KCR Kit',
        built_by: 'brs',
        aliases: ['kcr kit', 'kcrkit', 'kcr kits', 'కేసీఆర్ కిట్'],
    },
    'scheme-2bhk': {
        canonical: 'Double Bedroom Housing Scheme',
        built_by: 'brs',
        aliases: ['2bhk', 'double bedroom', 'double bedroom scheme', 'dignity housing', 'డబుల్ బెడ్‌రూమ్'],
    },
    'scheme-haritha-haram': {
        canonical: 'Telanganaku Haritha Haram',
        built_by: 'brs',
        aliases: ['haritha haram', 'harithaharam', 'telanganaku haritha haram', '#harithaharam', 'హరితహారం'],
    },

    /* ── THEIRS: built by the Congress government (since Dec 2023) ───── */
    'scheme-rythu-bharosa': {
        canonical: 'Rythu Bharosa',
        built_by: 'inc',
        replaces: 'scheme-rythu-bandhu',
        /**
         * Launched 26 Jan 2025 at Rs 12,000/acre against a promised Rs 15,000 —
         * which is precisely the gap BRS attacks. Mentions are frequently
         * hostile to the government and therefore favourable to us.
         */
        aliases: ['rythu bharosa', 'rythubharosa', 'raithu bharosa', '#rythubharosa', 'రైతు భరోసా'],
    },
    'scheme-indiramma-indlu': {
        canonical: 'Indiramma Indlu',
        built_by: 'inc',
        aliases: ['indiramma indlu', 'indiramma illu', 'indiramma housing', 'ఇందిరమ్మ ఇళ్లు'],
    },
    'scheme-bhu-bharati': {
        canonical: 'Bhu Bharati',
        built_by: 'inc',
        replaces: 'scheme-dharani',
        aliases: ['bhu bharati', 'bhubharati', 'bhu bharathi', 'record of rights act', 'భూభారతి'],
    },
    'scheme-gruha-jyothi': {
        canonical: 'Gruha Jyothi',
        built_by: 'inc',
        aliases: ['gruha jyothi', 'gruhajyothi', 'griha jyothi', 'free electricity scheme', 'గృహ జ్యోతి'],
    },
    'scheme-mahalakshmi': {
        canonical: 'Mahalakshmi',
        built_by: 'inc',
        aliases: ['mahalakshmi scheme', 'maha lakshmi scheme', 'free bus travel', 'మహాలక్ష్మి'],
    },
    'scheme-indiramma-atmiya-bharosa': {
        canonical: 'Indiramma Atmiya Bharosa',
        built_by: 'inc',
        aliases: ['indiramma atmiya bharosa', 'atmiya bharosa', 'ఆత్మీయ భరోసా'],
    },
    'scheme-rajiv-yuva-vikasam': {
        canonical: 'Rajiv Yuva Vikasam',
        built_by: 'inc',
        aliases: ['rajiv yuva vikasam', 'yuva vikasam', 'రాజీవ్ యువ వికాసం'],
    },
    'scheme-hydraa': {
        canonical: 'HYDRAA',
        built_by: 'inc',
        /** The demolition drive — popular with some, bitterly contested by those displaced. */
        aliases: ['hydraa', 'hydra commissioner', 'hyderabad disaster response and asset monitoring', '#hydraa', 'హైడ్రా'],
    },
    'scheme-musi-riverfront': {
        canonical: 'Musi Riverfront Development',
        built_by: 'inc',
        aliases: ['musi riverfront', 'musi project', 'musi beautification', 'musi river development', 'మూసీ', 'మూసీ ప్రాజెక్ట్'],
    },
    'scheme-future-city': {
        canonical: 'Future City',
        built_by: 'inc',
        aliases: ['future city', 'futurecity', 'fourth city', 'ఫ్యూచర్ సిటీ'],
    },
};

for (const [key, scheme] of Object.entries(GOVERNMENT_SCHEMES)) {
    /**
     * A scheme sits with whoever BUILT it, not whoever administers it today.
     * Congress runs every scheme in the state now, ours included; if the
     * current administrator decided alignment, then attacks on Kaleshwaram —
     * the biggest single line of criticism aimed at BRS — would score as
     * attacks on the government, i.e. in our favour. Exactly backwards.
     */
    const ours = scheme.built_by === OUR_PARTY.id;
    POLITICAL_ENTITIES[key] = {
        canonical: scheme.canonical,
        type: 'scheme',
        party: scheme.built_by || OUR_PARTY.id,
        built_by: scheme.built_by || null,
        /** Whoever holds office administers it, whoever built it owns it politically. */
        run_by: 'inc',
        ...(scheme.replaces ? { replaces: scheme.replaces } : {}),
        ...(scheme.replaced_by ? { replaced_by: scheme.replaced_by } : {}),
        role: null,
        constituency: null,
        district: null,
        scope: 'state',
        alignment: ours ? 'ally' : 'opposition',
        priority: 55,
        derived: false,
        aliases: [...new Set(scheme.aliases.map((a) => String(a).toLowerCase().trim()).filter(Boolean))],
    };
}

/* ─── alias indexes ─────────────────────────────────────────────────── */

/**
 * Minimum alias length. Anything shorter is dropped entirely — a 1-2 character
 * alias matches inside half the words in the language and would poison every
 * downstream resolution.
 */
const MIN_ALIAS_LEN = 3;

/**
 * Build alias → [entityKey, ...]. Unlike a first-writer-wins map this keeps
 * EVERY entity claiming an alias, so the resolver can tell a unique match from
 * an ambiguous one (surnames like "naik" are shared by many entities) and lower
 * its confidence accordingly.
 */
const buildAliasCandidates = () => {
    const candidates = {};

    for (const [key, ent] of Object.entries(POLITICAL_ENTITIES)) {
        for (const alias of ent.aliases || []) {
            const normalized = String(alias).toLowerCase().trim();
            if (normalized.length < MIN_ALIAS_LEN) continue;
            if (!candidates[normalized]) candidates[normalized] = [];
            if (!candidates[normalized].includes(key)) candidates[normalized].push(key);
        }
    }

    // Higher-priority entities first, so ALIAS_INDEX's "primary" answer for an
    // ambiguous alias is the most salient claimant.
    for (const keys of Object.values(candidates)) {
        keys.sort((a, b) => (POLITICAL_ENTITIES[b]?.priority || 0) - (POLITICAL_ENTITIES[a]?.priority || 0));
    }

    return candidates;
};

const ALIAS_CANDIDATES = buildAliasCandidates();

/**
 * Backward-compatible primary alias index: `[{ alias, entityKey, candidates,
 * ambiguous }]`, sorted longest-alias-first so multi-word matches win over
 * shorter substrings.
 */
const buildAliasIndex = () => {
    const entries = [];

    for (const [alias, entityKeys] of Object.entries(ALIAS_CANDIDATES)) {
        const primaryEntity = entityKeys[0];
        if (!primaryEntity) continue;
        entries.push({
            alias,
            entityKey: primaryEntity,
            candidates: [...entityKeys],
            ambiguous: entityKeys.length > 1,
        });
    }

    entries.sort((a, b) => b.alias.length - a.alias.length);
    return entries;
};

const ALIAS_INDEX = buildAliasIndex();

const resolveAliasCandidates = (alias) => {
    const normalized = String(alias || '').toLowerCase().trim();
    if (!normalized) return [];
    return (ALIAS_CANDIDATES[normalized] || []).map((key) => ({
        entityKey: key,
        entity: POLITICAL_ENTITIES[key] || null,
    }));
};

/**
 * Short ASCII aliases need a word boundary, otherwise 'bjp' matches inside
 * 'bjpsupporter' and — worse — 'inc' matches inside 'incident', 'increase',
 * 'including', and 'aap' inside 'aapka'. Non-ASCII aliases (Devanagari) are
 * exempt: those scripts do not use ASCII word characters.
 */
const SHORT_ALIAS_MAX_LEN = 4;
const isShortAsciiAlias = (alias) => alias.length <= SHORT_ALIAS_MAX_LEN && /^[a-z0-9]+$/.test(alias);

/**
 * Phrases in which an alias is NOT the politician/party. They are blanked out
 * before the alias is looked for, so the alias can still match elsewhere in
 * the same text.
 *   inc   — the company suffix ("Apple Inc.")
 *   aap   — Hindi "aap" = "you" (aap ka, aap log …)
 *   modi  — other well-known Modis
 *   raman singh — namesakes are common; kept, but only as the full name
 */
const ALIAS_BLOCKED_CONTEXTS = {
    // "Apple Inc.", "Acme, Inc", "Foo Inc Ltd": the company suffix, not the party.
    inc: /\binc\.|, ?inc\b|\binc\.? ?(ltd|limited|corp|corporation)\b/g,
    modi: /\b(lalit|nirav|mehul|sushil|sameer|nilesh) modi\b/g,
    'మోదీ': /(లలిత్|నీరవ్|మెహుల్) మోదీ/g,
    /**
     * కవిత is Kavitha's name AND the ordinary Telugu word for "poem" — spelt
     * identically. The alias cannot be dropped (it is the form she is most
     * often named by) nor kept raw (it would match every post about poetry).
     *
     * The derived forms are unambiguous, though: కవితలు (poems), కవిత్వం
     * (poetry), కవితా- (poetic). Stripping those first leaves a bare కవిత,
     * which in Telangana political text is overwhelmingly her. Telugu being
     * agglutinative, this is the same manoeuvre the Devanagari builds used for
     * "दुर्ग" — remove the inflected senses, then test what is left.
     */
    'కవిత': /కవిత(లు|ల|ం|్వం|్వ|ా)/g,
};

/**
 * Aliases that are also everyday words and only mean the party when written
 * in capitals. Checked against the ORIGINAL-case text.
 *
 * MIM is the Telangana case: lowercase "mim" appears inside ordinary words and
 * transliterations, while the party is written "MIM" or "AIMIM".
 */
const CASE_SENSITIVE_ALIASES = {
    mim: /(^|[^A-Za-z0-9_])MIM([^A-Za-z0-9_]|$)/,
};

const aliasOccursIn = (haystackLower, alias, rawText = null) => {
    if (!haystackLower.includes(alias)) return false;
    if (CASE_SENSITIVE_ALIASES[alias] && rawText != null) return CASE_SENSITIVE_ALIASES[alias].test(rawText);
    const blocker = ALIAS_BLOCKED_CONTEXTS[alias];
    if (blocker) {
        haystackLower = haystackLower.replace(blocker, ' ');
        if (!haystackLower.includes(alias)) return false;
    }
    if (!isShortAsciiAlias(alias)) return true;
    return new RegExp(`(?:^|[^a-z0-9_])${alias}(?:[^a-z0-9_]|$)`, 'i').test(haystackLower);
};

/**
 * Find every roster alias occurring in `text`, longest first.
 *
 * Used as a candidate generator by entityResolver — notably to resolve the
 * LLM's own (already translated) actor/target text against the FULL roster.
 *
 * This function does NOT decide the final actor or stance.
 */
const findAliasMatches = (text) => {
    const source = String(text || '').toLowerCase();
    if (!source) return [];

    const matches = [];
    for (const [alias, entityKeys] of Object.entries(ALIAS_CANDIDATES)) {
        if (!aliasOccursIn(source, alias, String(text || ''))) continue;
        matches.push({
            alias,
            entityKeys: [...entityKeys],
            ambiguous: entityKeys.length > 1,
            length: alias.length,
        });
    }

    matches.sort((a, b) => b.length - a.length);
    return matches;
};

/* ─── target universe ───────────────────────────────────────────────── */

/**
 * The "target" is the client leadership the whole sentiment pipeline is
 * measured against: the party president, and the working president who runs
 * the organisation day to day. Every ally is still scored on the same side of
 * the matrix; these are the primary client entities for relevance and display.
 *
 * In a ruling-party deployment these were the Chief Minister and the state
 * party president. BRS holds no office, so both targets are party posts — and
 * KTR matters more here than a secondary target usually would, because he is
 * far and away the most active BRS voice online while KCR posts rarely.
 */
const PRIMARY_TARGET_KEY = 'kcr';
const SECONDARY_TARGET_KEY = 'ktr';

const TARGET_KEYS = new Set([
    PRIMARY_TARGET_KEY,
    SECONDARY_TARGET_KEY,
]);

const isAlly = (key) => POLITICAL_ENTITIES[key]?.alignment === 'ally';
const isOpposition = (key) => POLITICAL_ENTITIES[key]?.alignment === 'opposition';
const isNeutral = (key) => POLITICAL_ENTITIES[key]?.alignment === 'neutral';
const isPrimaryTarget = (key) => TARGET_KEYS.has(key);

const TARGET_ALIASES = [...TARGET_KEYS]
    .flatMap((key) => POLITICAL_ENTITIES[key]?.aliases || [])
    .map((alias) => alias.toLowerCase());

const isNational = (key) => POLITICAL_ENTITIES[key]?.scope === 'national';
const isState = (key) => POLITICAL_ENTITIES[key]?.scope === 'state';
const getEntity = (key) => (key ? POLITICAL_ENTITIES[key] || null : null);

/**
 * Legacy entity keys used by records and UI filters written before the roster
 * used entity ids. Map them forward instead of losing the row.
 */
/**
 * Keys emitted by earlier pipelines, mapped onto their referent here.
 *
 * ⚠ `bjp_telangana` needs care. In deployments where the client WAS BJP
 * Telangana it meant "our machinery", and mapping it to OUR_PARTY.id was
 * right. Here BJP Telangana is a rival, so that mapping would file every
 * legacy BJP-tagged record as BRS — silently crediting our own party with the
 * opposition's output. It points at the actual BJP entity instead.
 *
 * `bsk` is likewise mapped to the real Bandi Sanjay Kumar, who exists in this
 * roster as a Union Minister and a prominent BRS critic, rather than to
 * whoever happens to be the current client.
 */
const LEGACY_ENTITY_KEYS = {
    bsk: 'bandi-sanjay',
    bjp_telangana: 'bjp',
    modi: 'narendra-modi',
    bjp_national: 'bjp',
};

/** Map a possibly-legacy entity key onto its current key. */
const resolveEntityKey = (key) => {
    const k = String(key || '').trim();
    if (!k) return null;
    if (POLITICAL_ENTITIES[k]) return k;
    return LEGACY_ENTITY_KEYS[k] || null;
};

module.exports = {
    POLITICAL_ENTITIES,

    // Alias lookup
    ALIAS_INDEX,
    ALIAS_CANDIDATES,
    resolveAliasCandidates,
    findAliasMatches,
    aliasOccursIn,

    PRIORITY,

    PRIMARY_TARGET_KEY,
    SECONDARY_TARGET_KEY,
    TARGET_KEYS,
    TARGET_ALIASES,

    isAlly,
    isOpposition,
    isNeutral,
    isPrimaryTarget,

    isNational,
    isState,
    getEntity,

    LEGACY_ENTITY_KEYS,
    resolveEntityKey,

    /** Legacy name for the same test, kept so older imports keep working. */
    isBskTarget: isPrimaryTarget,
};
