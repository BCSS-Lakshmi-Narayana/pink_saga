/**
 * manifestoSchemes — the promises and schemes the Manifesto tracker follows.
 * ─────────────────────────────────────────────────────────────────────
 * Client requirement 3: "Election manifesto — status of promised schemes,
 * people reach, people sentiments". Tracked on BOTH sides:
 *
 *   side 'theirs'  the governing party's 2023 promises (Six Guarantees and the
 *                  crop-loan waiver), split into the separate promises people
 *                  actually argue about — Mahalakshmi's free bus is delivered,
 *                  its Rs 2,500 a month is not, and one status for both would
 *                  be wrong
 *   side 'ours'    schemes our party built while in government (2014–2023):
 *                  what the public says has become of them now
 *
 * Status, reach and sentiment are all read from public posts and news — what
 * people report — never set by hand (schemeClaimService).
 *
 * `entity` points at GOVERNMENT_SCHEMES in politicalEntities.js: its canonical
 * name and aliases are reused, not copied. `phrases` adds only what that list
 * does not have — mostly the PROMISE itself ("2500", "రుణమాఫీ"), because
 * promise-gap posts name the money, not the scheme. Phrases only pick the
 * candidate posts; the model then decides whether a post is really about the
 * promise, so a broad phrase costs a model call, never a wrong count.
 *
 * `pair` links a scheme to the one that replaced it or that it replaced
 * (Rythu Bandhu ↔ Rythu Bharosa): shown head to head.
 */
const { GOVERNMENT_SCHEMES } = require('./politicalEntities');

const MANIFESTO_SCHEMES = [
    /* ── theirs: 2023 promises of the governing party ─────────────────── */
    {
        id: 'mahalakshmi-cash', side: 'theirs', group: 'Mahalakshmi', name: 'Rs 2,500 a month for women',
        promise: 'Rs 2,500 a month to every woman', entity: 'scheme-mahalakshmi',
        not: 'any other 2,500 (acres, rupees for something else); the goddess Mahalakshmi',
        phrases: ['2500', '2,500', 'నెలకు 2500', 'మహిళలకు 2500', 'రూ.2500', 'రూ. 2,500', '₹2500', '₹2,500', 'మహాలక్ష్మి డబ్బులు'],
    },
    {
        id: 'mahalakshmi-lpg', side: 'theirs', group: 'Mahalakshmi', name: 'LPG cylinder for Rs 500',
        promise: 'Cooking gas cylinder for Rs 500', entity: 'scheme-mahalakshmi',
        phrases: ['500 cylinder', 'cylinder for 500', 'cylinder at 500', 'gas cylinder', 'lpg subsidy', 'గ్యాస్ సిలిండర్', 'సిలిండర్ 500', '500కే సిలిండర్', 'రూ.500 సిలిండర్'],
    },
    {
        id: 'mahalakshmi-bus', side: 'theirs', group: 'Mahalakshmi', name: 'Free bus travel for women',
        promise: 'Free travel for women in state-run buses', entity: 'scheme-mahalakshmi',
        not: 'bus fares or fare hikes in general; the goddess Mahalakshmi',
        // A quote with these words is about something else, whatever the model says (see schemeClaimService).
        notWords: /fare|charge|ticket price|ఛార్జీ|ధర పెంపు/i,
        phrases: ['free bus', 'zero ticket', 'ఉచిత బస్సు', 'ఉచిత ప్రయాణం', 'జీరో టికెట్', 'ఫ్రీ బస్సు', 'మహాలక్ష్మి బస్సు'],
    },
    {
        id: 'rythu-bharosa', side: 'theirs', group: 'Rythu Bharosa', name: 'Rythu Bharosa: Rs 15,000 an acre',
        promise: 'Rs 15,000 per acre a year to farmers and tenant farmers', entity: 'scheme-rythu-bharosa', pair: 'rythu-bandhu',
        not: "Andhra Pradesh's Annadatha Sukhibhava or PM-Kisan",
        phrases: ['15000 per acre', '15,000 per acre', 'ఎకరానికి 15000', 'ఎకరాకు 15 వేలు', 'ఎకరాకు 12 వేలు', 'పెట్టుబడి సాయం'],
    },
    {
        id: 'atmiya-bharosa', side: 'theirs', group: 'Rythu Bharosa', name: 'Rs 12,000 a year for farm labourers',
        promise: 'Rs 12,000 a year to landless agricultural labourers', entity: 'scheme-indiramma-atmiya-bharosa',
        phrases: ['farm labourers 12000', 'landless labourers', 'ఉపాధి కూలీలకు', 'భూమిలేని కూలీలకు', 'వ్యవసాయ కూలీలకు 12'],
    },
    {
        id: 'paddy-bonus', side: 'theirs', group: 'Rythu Bharosa', name: 'Rs 500 bonus on paddy',
        promise: 'Rs 500 per quintal bonus on paddy above MSP',
        phrases: ['paddy bonus', '500 bonus', 'bonus on paddy', 'సన్న వడ్ల', 'సన్నవడ్ల', 'వడ్లకు బోనస్', 'రూ.500 బోనస్', 'రూ. 500 బోనస్', 'క్వింటాల్‌కు 500', 'క్వింటాకు 500', 'బోనస్ 500'],
    },
    {
        id: 'indiramma-indlu', side: 'theirs', group: 'Indiramma Indlu', name: 'Indiramma Indlu: house + Rs 5 lakh',
        promise: 'A house site and Rs 5 lakh to build a house for the homeless', entity: 'scheme-indiramma-indlu', pair: '2bhk',
        phrases: ['indiramma house', 'indiramma illu', 'ఇందిరమ్మ ఇల్లు', 'ఇందిరమ్మ ఇండ్లు', 'ఇందిరమ్మ ఇళ్ల'],
    },
    {
        id: 'gruha-jyothi', side: 'theirs', group: 'Gruha Jyothi', name: 'Gruha Jyothi: 200 units free power',
        promise: '200 units of free electricity for every household', entity: 'scheme-gruha-jyothi',
        not: 'free or 24-hour power for farms and agriculture; power cuts in general',
        notWords: /farm|agri|crop|24[- ]?(?:hour|hrs?)|రైతు|వ్యవసాయ|పంట|సాగు|24 ?గంటల/i,
        phrases: ['200 units', 'free power', 'free current', '200 యూనిట్లు', 'ఉచిత విద్యుత్', 'ఉచిత కరెంట్', 'జీరో బిల్'],
    },
    {
        id: 'vidya-bharosa', side: 'theirs', group: 'Yuva Vikasam', name: 'Rs 5 lakh education card',
        promise: 'Vidya Bharosa card worth Rs 5 lakh for students; an international school in every mandal', entity: 'scheme-rajiv-yuva-vikasam',
        phrases: ['vidya bharosa', 'విద్యా భరోసా', '5 lakh card', 'ఐదు లక్షల కార్డు', 'international school', 'young india school', 'యంగ్ ఇండియా'],
    },
    {
        id: 'cheyutha', side: 'theirs', group: 'Cheyutha', name: 'Cheyutha: Rs 4,000 pension',
        promise: 'Rs 4,000 a month pension for the elderly, widows and other groups', pair: 'aasara',
        phrases: ['cheyutha', 'చేయూత పింఛన్', 'చేయూత పెన్షన్', '4000 pension', '4,000 pension', 'pension 4000', 'పింఛన్ 4000', 'పెన్షన్ 4000', '4 వేల పింఛన్', '4 వేల పెన్షన్', 'నాలుగు వేల పింఛన్'],
    },
    {
        id: 'aarogyasri', side: 'theirs', group: 'Cheyutha', name: 'Aarogyasri: Rs 10 lakh health cover',
        promise: 'Rs 10 lakh Rajiv Aarogyasri health cover',
        phrases: ['aarogyasri', 'arogyasri', 'ఆరోగ్యశ్రీ', 'ఆరోగ్య శ్రీ'],
    },
    {
        id: 'loan-waiver', side: 'theirs', group: 'Loan waiver', name: 'Crop-loan waiver up to Rs 2 lakh',
        promise: 'Crop loans up to Rs 2 lakh waived',
        phrases: ['loan waiver', 'runa mafi', 'runamafi', 'crop loan', 'రుణమాఫీ', 'రుణ మాఫీ', 'రైతు రుణ', '2 లక్షల రుణ', 'कर्ज माफी'],
    },
    {
        id: 'bhu-bharati', side: 'theirs', group: 'Land records', name: 'Bhu Bharati land records',
        promise: 'A new land-records system in place of Dharani', entity: 'scheme-bhu-bharati', pair: 'dharani', newScheme: true,
        phrases: ['భూ భారతి'],
    },

    /* ── ours: schemes built while our party governed (2014–2023) ──────── */
    { id: 'rythu-bandhu', side: 'ours', name: 'Rythu Bandhu', what: 'Investment support to farmers per acre each season', entity: 'scheme-rythu-bandhu', pair: 'rythu-bharosa' },
    { id: 'aasara', side: 'ours', name: 'Aasara pensions', what: 'Monthly social security pensions (Rs 2,016)', pair: 'cheyutha',
        phrases: ['aasara', 'asara pension', 'ఆసరా', 'ఆసరా పింఛన్'] },
    { id: '2bhk', side: 'ours', name: 'Double bedroom houses', what: 'Free two-bedroom houses for the poor', entity: 'scheme-2bhk', pair: 'indiramma-indlu',
        not: 'any 2BHK flat or house for sale or rent' },
    { id: 'dharani', side: 'ours', name: 'Dharani portal', what: 'Online land-records portal', entity: 'scheme-dharani', pair: 'bhu-bharati' },
    { id: 'kalyana-lakshmi', side: 'ours', name: 'Kalyana Lakshmi / Shaadi Mubarak', what: 'Rs 1,00,116 marriage assistance for poor families',
        phrases: ['kalyana lakshmi', 'kalyanalakshmi', 'shaadi mubarak', 'shadi mubarak', 'కల్యాణ లక్ష్మి', 'కళ్యాణ లక్ష్మి', 'షాదీ ముబారక్'] },
    { id: 'dalit-bandhu', side: 'ours', name: 'Dalit Bandhu', what: 'Rs 10 lakh grant per Dalit family', entity: 'scheme-dalit-bandhu' },
    { id: 'rythu-bima', side: 'ours', name: 'Rythu Bima', what: 'Rs 5 lakh life insurance for farmers', entity: 'scheme-rythu-bima' },
    { id: 'kcr-kit', side: 'ours', name: 'KCR Kit', what: 'Kit and cash support for mothers after delivery', entity: 'scheme-kcr-kit' },
    { id: 'mission-bhagiratha', side: 'ours', name: 'Mission Bhagiratha', what: 'Piped drinking water to every home', entity: 'scheme-mission-bhagiratha',
        not: 'reservoir levels or water shortages that do not mention Bhagiratha supply' },
    { id: 'mission-kakatiya', side: 'ours', name: 'Mission Kakatiya', what: 'Restoration of village tanks', entity: 'scheme-mission-kakatiya' },
    { id: 'kaleshwaram', side: 'ours', name: 'Kaleshwaram project', what: 'Lift irrigation project on the Godavari', entity: 'scheme-kaleshwaram' },
    { id: 'gruha-lakshmi', side: 'ours', name: 'Gruha Lakshmi', what: 'Rs 3 lakh to build a house on own land',
        phrases: ['gruha lakshmi', 'gruhalakshmi', 'గృహలక్ష్మి', 'గృహ లక్ష్మి'] },
    { id: 'sheep-distribution', side: 'ours', name: 'Sheep distribution', what: 'Sheep units for Golla-Kuruma families',
        phrases: ['sheep distribution', 'sheep scheme', 'గొర్రెల పంపిణీ', 'గొర్రెల పథకం'] },
    { id: 'haritha-haram', side: 'ours', name: 'Haritha Haram', what: 'State-wide tree plantation drive', entity: 'scheme-haritha-haram' },
];

/** Every name a post might use for the scheme: the entity's canonical name and aliases, plus the phrases above. */
const namesOf = (s) => {
    const e = s.entity ? GOVERNMENT_SCHEMES[s.entity] : null;
    return [...new Set([...(e ? [e.canonical, ...(e.aliases || [])] : []), ...(s.phrases || [])].map((x) => String(x).trim()).filter(Boolean))];
};

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MATCHERS = MANIFESTO_SCHEMES.map((s) => ({ id: s.id, rx: new RegExp(namesOf(s).map(esc).join('|'), 'iu') }));

/**
 * Ids of the schemes a text names (candidates only — the model confirms).
 * Account handles and links are ignored: "@DharaniBRS" is an account, not a
 * post about the Dharani portal. So is "#2bhkfamily", a political nickname,
 * not the housing scheme.
 */
const schemesNamedIn = (text) => {
    const t = String(text || '').replace(/https?:\/\/\S+/g, ' ').replace(/@\w+/g, ' ').replace(/#?2\s*bhk\s*family/gi, ' ');
    if (!t) return [];
    return MATCHERS.filter((m) => m.rx.test(t)).map((m) => m.id);
};

const SCHEME_BY_ID = new Map(MANIFESTO_SCHEMES.map((s) => [s.id, s]));

module.exports = { MANIFESTO_SCHEMES, SCHEME_BY_ID, namesOf, schemesNamedIn };
