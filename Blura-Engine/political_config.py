"""
Political Saga configuration for Telangana — Blura Engine.
RSS feeds, keywords, category rules — covering Indian national politics,
Telangana state politics, and district/town-level news.

⚠ THE CLIENT IS THE OPPOSITION. Bharat Rashtra Samithi (BRS) — president
K. Chandrashekar Rao, working president K. T. Rama Rao — lost power in
December 2023. Telangana is governed by the Congress under Chief Minister
A. Revanth Reddy. Coverage of the GOVERNMENT is therefore as relevant to this
deployment as coverage of our own leaders, which is the reverse of how a
ruling-party deployment filters.

Telangana's press is Telugu first, with a substantial English tier (Telangana
Today, Deccan Chronicle, The Hindu) and a real Urdu/Hyderabadi tier (Siasat).
Every direct feed below was fetched and confirmed to return items on
2026-09-30. Eenadu's RSS path answers 200 with zero items and Andhra Jyothy's
404s, so both reach the pipeline through Google News queries instead.

NOTE ON SOURCE BIAS: Namasthe Telangana (ntnews.com) is BRS-ALIGNED and
Telangana Today is BRS-leaning. They are not neutral press. Anything that
computes "how the media is covering us" must treat them as owned or friendly
voice, or headline sentiment reads far better than it is.
"""

from urllib.parse import quote_plus

_GN_EN = "https://news.google.com/rss/search?q={q}&hl=en-IN&gl=IN&ceid=IN:en"
_GN_TE = "https://news.google.com/rss/search?q={q}&hl=te&gl=IN&ceid=IN:te"


def _gn(template, query, source_name, language):
    return {
        "url": template.format(q=quote_plus(query)),
        "source_name": source_name,
        "language": language,
        "follow_redirect": True,
    }


# ── RSS Feeds ──────────────────────────────────────────────────────────────────
# "state_only": True marks outlets whose feed carries only Telangana news.
# Their items skip the keyword relevance gate (a local story rarely names a
# party or leader).
RSS_FEEDS = [

    # ── Telangana outlets (verified live, item counts as of 2026-09-30) ──
    {"url": "https://telanganatoday.com/feed", "source_name": "Telangana Today", "language": "en", "state_only": True},
    {"url": "https://ntnews.com/feed", "source_name": "Namasthe Telangana", "language": "te", "state_only": True},
    {"url": "https://www.v6velugu.com/feed", "source_name": "V6 Velugu", "language": "te", "state_only": True},
    {"url": "https://www.siasat.com/feed/", "source_name": "Siasat", "language": "en", "state_only": True},
    {"url": "https://www.sakshi.com/rss.xml", "source_name": "Sakshi", "language": "te"},
    {"url": "https://www.deccanchronicle.com/google_feeds.xml", "source_name": "Deccan Chronicle", "language": "en"},
    {"url": "https://www.thehindu.com/news/national/telangana/feeder/default.rss", "source_name": "The Hindu – Telangana", "language": "en", "state_only": True},
    {"url": "https://timesofindia.indiatimes.com/rssfeeds/-2128816011.cms", "source_name": "Times of India – Hyderabad", "language": "en", "state_only": True},

    # ── Our leadership ──
    _gn(_GN_TE, "కేసీఆర్", "Google News – KCR (te)", "te"),
    _gn(_GN_TE, "కేటీఆర్", "Google News – KTR (te)", "te"),
    _gn(_GN_TE, "హరీష్ రావు", "Google News – Harish Rao (te)", "te"),
    _gn(_GN_TE, "బీఆర్ఎస్", "Google News – BRS (te)", "te"),
    _gn(_GN_EN, "KCR BRS Telangana", "Google News – KCR", "en"),
    _gn(_GN_EN, "KTR Rama Rao BRS", "Google News – KTR", "en"),
    _gn(_GN_EN, "Harish Rao BRS", "Google News – Harish Rao", "en"),
    _gn(_GN_EN, "Bharat Rashtra Samithi", "Google News – BRS", "en"),

    # ── The government we are against ──
    _gn(_GN_TE, "రేవంత్ రెడ్డి", "Google News – Revanth Reddy (te)", "te"),
    _gn(_GN_TE, "తెలంగాణ ప్రభుత్వం", "Google News – TG Government (te)", "te"),
    _gn(_GN_EN, "Revanth Reddy Telangana Chief Minister", "Google News – Revanth Reddy", "en"),
    _gn(_GN_EN, "Telangana Congress government", "Google News – TG Congress", "en"),

    # ── Rivals ──
    _gn(_GN_EN, "Telangana BJP Ramchander Rao Kishan Reddy", "Google News – TG BJP", "en"),
    _gn(_GN_EN, "AIMIM Owaisi Hyderabad", "Google News – AIMIM", "en"),
    _gn(_GN_TE, "కవిత తెలంగాణ రక్షణ సేన", "Google News – Kavitha TRS (te)", "te"),
    _gn(_GN_EN, "Kavitha Telangana Rakshana Sena", "Google News – Kavitha", "en"),

    # ── Live issues ──
    _gn(_GN_EN, "Kaleshwaram project inquiry", "Google News – Kaleshwaram", "en"),
    _gn(_GN_EN, "Telangana phone tapping case", "Google News – Phone tapping", "en"),
    _gn(_GN_EN, "Formula E case KTR ACB", "Google News – Formula E", "en"),
    _gn(_GN_EN, "Khairatabad by-election Telangana", "Google News – Khairatabad bypoll", "en"),
    _gn(_GN_EN, "Telangana BC reservation 42 percent", "Google News – BC reservation", "en"),
    _gn(_GN_TE, "రైతు భరోసా", "Google News – Rythu Bharosa (te)", "te"),
    _gn(_GN_TE, "భూభారతి ధరణి", "Google News – Bhu Bharati (te)", "te"),
    _gn(_GN_EN, "HYDRAA demolition Hyderabad", "Google News – HYDRAA", "en"),
    _gn(_GN_EN, "Musi riverfront project", "Google News – Musi", "en"),
]


# ── Districts ──────────────────────────────────────────────────────────────────
# The canonical district string MUST match constituencymasters.district exactly.
# These are generated from the same geography file the backend reads, so they do.
DISTRICTS = [
    ("Adilabad", "Adilabad Telangana", "ఆదిలాబాద్ జిల్లా"),
    ("Bhadradri Kothagudem", "Bhadradri Kothagudem Telangana", "భద్రాద్రి కొత్తగూడెం జిల్లా"),
    ("Hanumakonda", "Hanumakonda Telangana", "హనుమకొండ జిల్లా"),
    ("Hyderabad", "Hyderabad Telangana", "హైదరాబాద్ జిల్లా"),
    ("Jagtial", "Jagtial Telangana", "జగిత్యాల జిల్లా"),
    ("Jangaon", "Jangaon Telangana", "జనగామ జిల్లా"),
    ("Jayashankar Bhupalpally", "Jayashankar Bhupalpally Telangana", "జయశంకర్ భూపాలపల్లి జిల్లా"),
    ("Jogulamba Gadwal", "Jogulamba Gadwal Telangana", "జోగులంబా గద్వాల్ జిల్లా"),
    ("Kamareddy", "Kamareddy Telangana", "కామారెడ్డి జిల్లా"),
    ("Karimnagar", "Karimnagar Telangana", "కరీంనగర్ జిల్లా"),
    ("Khammam", "Khammam Telangana", "ఖమ్మం జిల్లా"),
    ("Kumuram Bheem Asifabad", "Kumuram Bheem Asifabad Telangana", "కుమురం భీమ్ ఆసిఫాబాద్ జిల్లా"),
    ("Mahabubabad", "Mahabubabad Telangana", "మహబూబాబాద్ జిల్లా"),
    ("Mahabubnagar", "Mahabubnagar Telangana", "మహబూబ్ నగర్ జిల్లా"),
    ("Mancherial", "Mancherial Telangana", "మంచిర్యాల జిల్లా"),
    ("Medak", "Medak Telangana", "మెదక్ జిల్లా"),
    ("Medchal–Malkajgiri", "Medchal–Malkajgiri Telangana", "మేడ్చల్-మల్కాజ్గిరి జిల్లా"),
    ("Mulugu", "Mulugu Telangana", "ములుగు జిల్లా"),
    ("Nagarkurnool", "Nagarkurnool Telangana", "నాగర్ కర్నూల్ జిల్లా"),
    ("Nalgonda", "Nalgonda Telangana", "నల్గొండ జిల్లా"),
    ("Narayanpet", "Narayanpet Telangana", "నారాయణపేట జిల్లా"),
    ("Nirmal", "Nirmal Telangana", "నిర్మల్ జిల్లా"),
    ("Nizamabad", "Nizamabad Telangana", "నిజామాబాద్ జిల్లా"),
    ("Peddapalli", "Peddapalli Telangana", "పెద్దపల్లి జిల్లా"),
    ("Rajanna Sircilla", "Rajanna Sircilla Telangana", "రాజన్న సిరిసిల్ల జిల్లా"),
    ("Rangareddy", "Rangareddy Telangana", "రంగారెడ్డి జిల్లా"),
    ("Sangareddy", "Sangareddy Telangana", "సంగారెడ్డి జిల్లా"),
    ("Siddipet", "Siddipet Telangana", "సిద్దిపేట జిల్లా"),
    ("Suryapet", "Suryapet Telangana", "సూర్యాపేట జిల్లా"),
    ("Vikarabad", "Vikarabad Telangana", "వికారాబాద్ జిల్లా"),
    ("Wanaparthy", "Wanaparthy Telangana", "వనపర్తి జిల్లా"),
    ("Warangal", "Warangal Telangana", "వరంగల్ జిల్లా"),
    ("Yadadri Bhuvanagiri", "Yadadri Bhuvanagiri Telangana", "యాదాద్రి భువనగిరి జిల్లా"),
]

# Google News matches these words in unrelated commerce and weather copy.
_DISTRICT_NEG_EN = " -price -\"on road\" -AQI -\"air quality\" -weather -horoscope"
_DISTRICT_NEG_TE = " -ధర -వాతావరణం"


def _district_feeds(canonical, query_en, query_te):
    return [
        _gn(_GN_EN, query_en + _DISTRICT_NEG_EN, "TG District – " + canonical, "en"),
        _gn(_GN_TE, query_te + _DISTRICT_NEG_TE, "TG District – " + canonical, "te"),
    ]


for _canonical, _q_en, _q_te in DISTRICTS:
    RSS_FEEDS.extend(_district_feeds(_canonical, _q_en, _q_te))


# Telugu first. Urdu matters in Hyderabad but has no Google News edition, so it
# arrives through Siasat and social rather than through a language feed.
PRIORITY_LANGUAGES = ("te",)


# Fallback when the rsskeywords Mongo collection is empty.
POLITICAL_RELEVANCE_KEYWORDS = [
    # ── ours ──
    "brs", "bharat rashtra samithi", "telangana rashtra samithi",
    "kcr", "chandrashekar rao", "chandrasekhar rao",
    "ktr", "rama rao", "taraka rama rao",
    "harish rao", "santosh kumar", "kavitha",
    "బీఆర్ఎస్", "కేసీఆర్", "కేటీఆర్", "హరీష్ రావు", "కవిత",
    # ── the government ──
    "revanth reddy", "telangana cm", "chief minister", "bhatti vikramarka",
    "uttam kumar reddy", "sridhar babu", "ponguleti", "komatireddy", "seethakka",
    "congress", "tpcc", "telangana government",
    "రేవంత్ రెడ్డి", "ముఖ్యమంత్రి", "కాంగ్రెస్", "తెలంగాణ ప్రభుత్వం",
    # ── rivals ──
    "bjp", "kishan reddy", "bandi sanjay", "ramchander rao", "eatala rajender",
    "aimim", "owaisi", "asaduddin owaisi", "akbaruddin owaisi",
    "raja singh", "telangana rakshana sena",
    "బీజేపీ", "ఎంఐఎం", "ఒవైసీ", "రాజా సింగ్",
    # ── issues and schemes ──
    "kaleshwaram", "medigadda", "phone tapping", "formula e",
    "rythu bandhu", "rythu bharosa", "dalit bandhu", "dharani", "bhu bharati",
    "mission bhagiratha", "indiramma", "gruha jyothi", "hydraa", "musi",
    "bc reservation", "loan waiver", "unemployment", "job notification",
    "కాళేశ్వరం", "ఫోన్ ట్యాపింగ్", "రైతుబంధు", "రైతు భరోసా", "ధరణి", "భూభారతి",
    "నిరుద్యోగం", "రుణమాఫీ", "హైడ్రా", "మూసీ",
    # ── institutions ──
    "assembly", "vidhan sabha", "legislative council", "acb", "cag",
    "అసెంబ్లీ", "శాసనసభ", "ఏసీబీ",
]


CATEGORY_KEYWORDS = {
    "politics": [
        "party", "election", "minister", "mla", "mp", "assembly", "cabinet",
        "manifesto", "by-election", "bypoll", "defection", "campaign",
        "పార్టీ", "ఎన్నికలు", "మంత్రి", "ఎమ్మెల్యే", "అసెంబ్లీ", "ఉప ఎన్నిక",
    ],
    "crime": [
        "murder", "rape", "arrest", "police", "fir", "chargesheet", "fraud",
        "kidnap", "assault", "encounter", "smuggling",
        "హత్య", "అత్యాచారం", "అరెస్ట్", "పోలీసు", "కేసు", "మోసం",
    ],
    "corruption": [
        "corruption", "scam", "bribe", "irregularities", "acb", "kickback",
        "అవినీతి", "కుంభకోణం", "లంచం", "అక్రమాలు",
    ],
    "agriculture": [
        "farmer", "paddy", "crop", "irrigation", "loan waiver", "procurement",
        "fertiliser", "urea", "cotton", "rythu",
        "రైతు", "పంట", "వరి", "పత్తి", "యూరియా", "రుణమాఫీ", "సాగునీరు",
    ],
    "employment": [
        "unemployment", "job", "recruitment", "notification", "vacancy",
        "group 1", "group 2", "tspsc", "tgpsc", "paper leak",
        "నిరుద్యోగం", "ఉద్యోగం", "నోటిఫికేషన్", "పేపర్ లీక్",
    ],
    "infrastructure": [
        "road", "bridge", "metro", "orr", "project", "flyover", "drinking water",
        "power cut", "electricity",
        "రోడ్డు", "వంతెన", "మెట్రో", "ప్రాజెక్ట్", "కరెంట్", "తాగునీరు",
    ],
    "welfare": [
        "scheme", "pension", "ration", "housing", "subsidy", "beneficiary",
        "పథకం", "పెన్షన్", "రేషన్", "ఇళ్లు", "లబ్ధిదారు",
    ],
    "health": [
        "hospital", "dengue", "fever", "doctor", "medical", "arogyasri",
        "ఆసుపత్రి", "డెంగ్యూ", "జ్వరం", "వైద్యం", "ఆరోగ్యశ్రీ",
    ],
    "education": [
        "school", "college", "university", "student", "fee reimbursement",
        "gurukul", "hostel",
        "పాఠశాల", "కళాశాల", "విద్యార్థి", "ఫీజు", "గురుకులం",
    ],
    "protest": [
        "protest", "dharna", "bandh", "strike", "rally", "agitation", "rasta roko",
        "నిరసన", "ధర్నా", "బంద్", "సమ్మె", "ఆందోళన",
    ],
}


# ── Locations ──────────────────────────────────────────────────────────────────
LOCATION_KEYWORDS = {
    "Adilabad": ["adilabad", "ఆదిలాబాద్"],
    "Bhadradri Kothagudem": ["bhadradri kothagudem", "భద్రాద్రి కొత్తగూడెం"],
    "Hanumakonda": ["hanumakonda", "హనుమకొండ"],
    "Hyderabad": ["hyderabad", "హైదరాబాద్"],
    "Jagtial": ["jagtial", "జగిత్యాల"],
    "Jangaon": ["jangaon", "జనగామ"],
    "Jayashankar Bhupalpally": ["jayashankar bhupalpally", "జయశంకర్ భూపాలపల్లి"],
    "Jogulamba Gadwal": ["jogulamba gadwal", "జోగులంబా గద్వాల్"],
    "Kamareddy": ["kamareddy", "కామారెడ్డి"],
    "Karimnagar": ["karimnagar", "కరీంనగర్"],
    "Khammam": ["khammam", "ఖమ్మం"],
    "Kumuram Bheem Asifabad": ["kumuram bheem asifabad", "కుమురం భీమ్ ఆసిఫాబాద్"],
    "Mahabubabad": ["mahabubabad", "మహబూబాబాద్"],
    "Mahabubnagar": ["mahabubnagar", "మహబూబ్ నగర్"],
    "Mancherial": ["mancherial", "మంచిర్యాల"],
    "Medak": ["medak", "మెదక్"],
    "Medchal–Malkajgiri": ["medchal–malkajgiri", "మేడ్చల్-మల్కాజ్గిరి"],
    "Mulugu": ["mulugu", "ములుగు"],
    "Nagarkurnool": ["nagarkurnool", "నాగర్ కర్నూల్"],
    "Nalgonda": ["nalgonda", "నల్గొండ"],
    "Narayanpet": ["narayanpet", "నారాయణపేట"],
    "Nirmal": ["nirmal", "నిర్మల్"],
    "Nizamabad": ["nizamabad", "నిజామాబాద్"],
    "Peddapalli": ["peddapalli", "పెద్దపల్లి"],
    "Rajanna Sircilla": ["rajanna sircilla", "రాజన్న సిరిసిల్ల"],
    "Rangareddy": ["rangareddy", "రంగారెడ్డి"],
    "Sangareddy": ["sangareddy", "సంగారెడ్డి"],
    "Siddipet": ["siddipet", "సిద్దిపేట"],
    "Suryapet": ["suryapet", "సూర్యాపేట"],
    "Vikarabad": ["vikarabad", "వికారాబాద్"],
    "Wanaparthy": ["wanaparthy", "వనపర్తి"],
    "Warangal": ["warangal", "వరంగల్"],
    "Yadadri Bhuvanagiri": ["yadadri bhuvanagiri", "యాదాద్రి భువనగిరి"],
    "Utnoor": ["utnoor", "ఉట్నూరు", "utnoor town"],
    "Aswaraopeta": ["aswaraopeta", "అశ్వారావుపేట", "aswaraopeta town"],
    "Bhadrachalam": ["bhadrachalam", "భద్రాచలం", "bhadrachalam town"],
    "Burgampadu": ["burgampadu", "బూర్గంపాడు", "burgampadu town"],
    "Kothagudem": ["kothagudem", "కొత్తగూడెం", "kottagudem", "bhadradri kothagudem", "కొత్తగూడెం (భద్రాద్రి జిల్లా)"],
    "Manuguru": ["manuguru", "మణుగూరు", "manuguru town"],
    "Palvancha": ["palvancha", "పాల్వంచ", "palvancha town"],
    "Sarapaka": ["sarapaka", "సారపాక", "sarapaka town"],
    "Yellandu": ["yellandu", "ఇల్లెందు", "yellandu town"],
    "Parkal": ["parkal", "పరకాల", "parkal town"],
    "Secunderabad": ["secunderabad", "సికింద్రాబాద్", "secunderabad cantonment", "సికింద్రాబాదు", "sikandarabad", "twin cities"],
    "Dharmapuri": ["dharmapuri", "ధర్మపురి", "dharmapuri town"],
    "Korutla": ["korutla", "కోరుట్ల", "korutla town"],
    "Metpally": ["metpally", "మెట్‌పల్లి", "metpally town"],
    "Raikal": ["raikal", "రాయికల్", "raikal town"],
    "Station Ghanpur": ["station ghanpur", "ఘన్‌పూర్ (స్టేషన్)", "station ghanpur town"],
    "Bhupalpally": ["bhupalpally", "భూపాలపల్లి", "bhupalapally", "bhoopalapally", "jayashankar bhupalpally"],
    "Mahadevpur": ["mahadevpur", "మహదేవ్‌పూర్", "mahadevpur town"],
    "Alampur": ["alampur", "ఆలంపూర్", "alampur town"],
    "Gadwal": ["gadwal", "గద్వాల", "గద్వాల్", "gadwal town", "jogulamba gadwal"],
    "Ieeja": ["ieeja", "అయిజ", "ieeja town"],
    "Waddepalle": ["waddepalle", "వడ్డేపల్లి", "waddepalle town"],
    "Banswada": ["banswada", "బాన్స్‌వాడ", "banswada town"],
    "Bhiknur": ["bhiknur", "బిక్నూర్", "bhiknur town"],
    "Bichkunda": ["bichkunda", "బిచ్కుంద", "bichkunda town"],
    "Yellareddy": ["yellareddy", "ఎల్లారెడ్డి", "yellareddy town"],
    "Choppadandi": ["choppadandi", "చొప్పదండి", "choppadandi town"],
    "Huzurabad": ["huzurabad", "హుజూరాబాద్", "huzurabad town"],
    "Jammikunta": ["jammikunta", "జమ్మికుంట", "jammikunta town"],
    "Madhira": ["madhira", "మధిర", "madhira town"],
    "Sathupalli": ["sathupalli", "సత్తుపల్లి", "sathupalli town"],
    "Wyra": ["wyra", "వైరా", "wyra town"],
    "Asifabad": ["asifabad", "ఆసిఫాబాద్", "kumuram bheem asifabad", "komaram bheem asifabad", "asifabad town"],
    "Kagaznagar": ["kagaznagar", "కాగజ్‌నగర్", "kagaznagar town"],
    "Dornakal": ["dornakal", "డోర్నకల్", "dornakal town"],
    "Kesamudram": ["kesamudram", "కేసముద్రం", "kesamudram town"],
    "Maripeda": ["maripeda", "మరిపెడ", "maripeda town"],
    "Thorrur": ["thorrur", "తొర్రూర్", "thorrur town"],
    "Devarakadra": ["devarakadra", "దేవరకద్ర", "devarakadra town"],
    "Jadcherla": ["jadcherla", "జడ్చర్ల", "jadcherla town"],
    "Bellampalle": ["bellampalle", "బెల్లంపల్లి", "bellampalle town"],
    "Chennur": ["chennur", "చెన్నూర్", "chennur town"],
    "Kyathanpally": ["kyathanpally", "క్యాతన్‌పల్లి", "kyathanpally town"],
    "Luxettipet": ["luxettipet", "లక్సెట్టిపేట", "luxettipet town"],
    "Mandamarri": ["mandamarri", "మందమర్రి", "mandamarri town"],
    "Naspur": ["naspur", "నస్పూర్", "naspur town"],
    "Narsapur": ["narsapur", "నర్సాపూర్", "narsapur town"],
    "Ramayampet": ["ramayampet", "రామాయంపేట", "ramayampet town"],
    "Toopran": ["toopran", "తూప్రాన్", "toopran town"],
    "Boduppal": ["boduppal", "బోడుప్పల్", "boduppal town"],
    "Bolarum": ["bolarum", "బొల్లారం", "bolarum town"],
    "Dundigal": ["dundigal", "దుండిగల్", "dundigal town"],
    "Ghatkesar": ["ghatkesar", "ఘటకేసర్", "ghatkesar town"],
    "Jawaharnagar": ["jawaharnagar", "జవహర్‌నగర్", "jawaharnagar town"],
    "Kukatpally": ["kukatpally", "కూకట్‌పల్లి", "kukatpally town"],
    "Nagaram": ["nagaram", "నాగారం", "nagaram town"],
    "Nizampet": ["nizampet", "నిజాంపేట్", "nizampet town"],
    "Peerzadiguda": ["peerzadiguda", "పీర్జాదిగూడ", "peerzadiguda town"],
    "Shamirpet": ["shamirpet", "షామీర్‌పేట్", "shameerpet", "anthaipally"],
    "Eturnagaram": ["eturnagaram", "ఏటూరునాగారం", "eturnagaram town"],
    "Venkatapuram": ["venkatapuram", "వెంకటాపురం", "venkatapuram town"],
    "Achampet": ["achampet", "అచ్చంపేట", "achampet town"],
    "Kalwakurthy": ["kalwakurthy", "కల్వకుర్తి", "kalwakurthy town"],
    "Kollapur": ["kollapur", "కొల్లాపూర్", "kollapur town"],
    "Chandur": ["chandur", "చండూరు", "chandur town"],
    "Chityal": ["chityal", "చిట్యాల", "chityal town"],
    "Devarakonda": ["devarakonda", "దేవరకొండ", "devarakonda town"],
    "Miryalaguda": ["miryalaguda", "మిర్యాలగూడ", "miryalaguda town"],
    "Munugode": ["munugode", "మునుగోడు", "munugode town"],
    "Nakrekal": ["nakrekal", "నకిరేకల్", "nakrekal town"],
    "Kosgi": ["kosgi", "కోస్గి", "kosgi town"],
    "Makhtal": ["makhtal", "మఖ్తల్", "makhtal town"],
    "Bhainsa": ["bhainsa", "భైంసా", "bhainsa town"],
    "Khanapur": ["khanapur", "ఖానాపూర్", "khanapur town"],
    "Armoor": ["armoor", "ఆర్మూరు", "armoor town"],
    "Balkonda": ["balkonda", "బాల్కొండ", "balkonda town"],
    "Bheemgal": ["bheemgal", "భీంగల్", "bheemgal town"],
    "Bodhan": ["bodhan", "బోధన్", "bodhan town"],
    "Nandipet": ["nandipet", "నందిపేట్", "nandipet town"],
    "Godavarikhani": ["godavarikhani", "గోదావరిఖని", "godavarikhani town"],
    "Manthani": ["manthani", "మంథని", "manthani town"],
    "Ramagundam": ["ramagundam", "రామగుండం", "ramagundam town"],
    "Sultanabad": ["sultanabad", "సుల్తానాబాద్", "sultanabad town"],
    "Sircilla": ["sircilla", "సిరిసిల్ల", "siricilla", "sirsilla", "rajanna sircilla"],
    "Vemulawada": ["vemulawada", "వేములవాడ", "vemulawada town"],
    "Amangal": ["amangal", "ఆమనగల్", "amangal town"],
    "Badangpet": ["badangpet", "బడంగ్‌పేట", "badangpet town"],
    "Bandlaguda Jagir": ["bandlaguda jagir", "బండ్లగూడ జాగీర్", "bandlaguda jagir town"],
    "Ibrahimpatnam": ["ibrahimpatnam", "ఇబ్రహీంపట్నం", "ibrahimpatnam town"],
    "Kothur": ["kothur", "కొత్తూరు", "kothur town"],
    "Meerpet": ["meerpet", "మీర్‌పేట", "meerpet town"],
    "Serilingampally": ["serilingampally", "శేరిలింగంపల్లి", "serilingampally town"],
    "Shadnagar": ["shadnagar", "షాద్‌నగర్", "shadnagar town"],
    "Shamshabad": ["shamshabad", "శంషాబాద్", "shamshabad town"],
    "Turkayamjal": ["turkayamjal", "తుర్కయాంజల్", "turkayamjal town"],
    "Ameenpur": ["ameenpur", "అమీన్‌పూర్", "ameenpur town"],
    "Andole": ["andole", "ఆందోల్", "andole town"],
    "Jogipet": ["jogipet", "జోగిపేట", "jogipet town"],
    "Narayankhed": ["narayankhed", "నారాయణఖేడ్", "narayankhed town"],
    "Patancheru": ["patancheru", "పటాన్‌చెరు", "patancheru town"],
    "Sadasivpet": ["sadasivpet", "సదాశివపేట", "sadasivpet town"],
    "Zaheerabad": ["zaheerabad", "జహీరాబాద్", "zaheerabad town"],
    "Dubbaka": ["dubbaka", "దుబ్బాక", "dubbaka town"],
    "Gajwel": ["gajwel", "గజ్వేల్", "gajwel town"],
    "Husnabad": ["husnabad", "హుస్నాబాద్", "husnabad town"],
    "Huzurnagar": ["huzurnagar", "హుజూర్‌నగర్", "huzurnagar town"],
    "Kodad": ["kodad", "కోదాడ", "kodad town"],
    "Neredcherla": ["neredcherla", "నేరేడుచర్ల", "neredcherla town"],
    "Kodangal": ["kodangal", "కొడంగల్", "kodangal town"],
    "Parigi": ["parigi", "పరిగి", "parigi town"],
    "Tandur": ["tandur", "తాండూరు", "tandur town"],
    "Amarchinta": ["amarchinta", "అమరచింత", "amarchinta town"],
    "Atmakur": ["atmakur", "ఆత్మకూరు", "atmakur town"],
    "Kothakota": ["kothakota", "కొత్తకోట", "kothakota town"],
    "Pebbair": ["pebbair", "పెబ్బేరు", "pebbair town"],
    "Narsampet": ["narsampet", "నర్సంపేట", "narsampet town"],
    "Wardhannapet": ["wardhannapet", "వర్ధన్నపేట", "wardhannapet town"],
    "Alair": ["alair", "ఆలేరు", "alair town"],
    "Bhongir": ["bhongir", "భువనగిరి", "bhuvanagiri", "bhongiri", "yadadri", "యాదాద్రి"],
    "Bhoodan Pochampally": ["bhoodan pochampally", "భూదాన్ పోచంపల్లి", "bhoodan pochampally town"],
    "Choutuppal": ["choutuppal", "చౌటుప్పల్", "choutuppal town"],
    "Mothkur": ["mothkur", "మోత్కూర్", "mothkur town"],
    "Ramannapeta": ["ramannapeta", "రామన్నపేట", "ramannapeta town"],
    "Yadagirigutta": ["yadagirigutta", "యాదగిరిగుట్ట", "yadagirigutta town"],
}

# name -> (district, lat, lng)
LOCATION_META = {
    "Adilabad": ("Adilabad", 19.6759, 78.534),
    "Bhadradri Kothagudem": ("Bhadradri Kothagudem", 17.5477, 80.6137),
    "Hanumakonda": ("Hanumakonda", 18.0069, 79.5579),
    "Hyderabad": ("Hyderabad", 17.3617, 78.4747),
    "Jagtial": ("Jagtial", 18.7957, 78.9162),
    "Jangaon": ("Jangaon", 17.7244, 79.1571),
    "Jayashankar Bhupalpally": ("Jayashankar Bhupalpally", 18.4381, 79.8685),
    "Jogulamba Gadwal": ("Jogulamba Gadwal", 16.2347, 77.7946),
    "Kamareddy": ("Kamareddy", 18.3222, 78.3387),
    "Karimnagar": ("Karimnagar", 18.4348, 79.1328),
    "Khammam": ("Khammam", 17.2465, 80.15),
    "Kumuram Bheem Asifabad": ("Kumuram Bheem Asifabad", 19.3593, 79.296),
    "Mahabubabad": ("Mahabubabad", 17.5957, 79.9999),
    "Mahabubnagar": ("Mahabubnagar", 16.7435, 77.9923),
    "Mancherial": ("Mancherial", 18.8762, 79.445),
    "Medak": ("Medak", 18.0459, 78.2652),
    "Medchal–Malkajgiri": ("Medchal–Malkajgiri", 17.5917, 78.5822),
    "Mulugu": ("Mulugu", 18.1932, 79.9414),
    "Nagarkurnool": ("Nagarkurnool", 16.487, 78.3169),
    "Nalgonda": ("Nalgonda", 17.0504, 79.2669),
    "Narayanpet": ("Narayanpet", 16.7478, 77.495),
    "Nirmal": ("Nirmal", 19.0925, 78.3486),
    "Nizamabad": ("Nizamabad", 18.6732, 78.0978),
    "Peddapalli": ("Peddapalli", 18.6177, 79.3868),
    "Rajanna Sircilla": ("Rajanna Sircilla", 18.3898, 78.8086),
    "Rangareddy": ("Rangareddy", 17.2611, 78.3932),
    "Sangareddy": ("Sangareddy", 17.6119, 78.0819),
    "Siddipet": ("Siddipet", 18.1018, 78.852),
    "Suryapet": ("Suryapet", 17.1405, 79.6225),
    "Vikarabad": ("Vikarabad", 17.3379, 77.904),
    "Wanaparthy": ("Wanaparthy", 16.3618, 78.0611),
    "Warangal": ("Warangal", 17.9821, 79.5971),
    "Yadadri Bhuvanagiri": ("Yadadri Bhuvanagiri", 17.5173, 78.8863),
    "Utnoor": ("Adilabad", 19.3667, 78.7667),
    "Aswaraopeta": ("Bhadradri Kothagudem", 17.2067, 80.8375),
    "Bhadrachalam": ("Bhadradri Kothagudem", 17.6669, 80.8826),
    "Burgampadu": ("Bhadradri Kothagudem", 17.65, 80.8667),
    "Kothagudem": ("Bhadradri Kothagudem", 17.5477, 80.6137),
    "Manuguru": ("Bhadradri Kothagudem", 17.9373, 80.8185),
    "Palvancha": ("Bhadradri Kothagudem", 17.5963, 80.7087),
    "Sarapaka": ("Bhadradri Kothagudem", 17.6922, 80.8614),
    "Yellandu": ("Bhadradri Kothagudem", 17.6, 80.33),
    "Parkal": ("Hanumakonda", 18.2, 79.7167),
    "Secunderabad": ("Hyderabad", 17.4399, 78.4983),
    "Dharmapuri": ("Jagtial", 18.9475, 79.094),
    "Korutla": ("Jagtial", 18.8235, 78.7108),
    "Metpally": ("Jagtial", 18.8492, 78.6262),
    "Raikal": ("Jagtial", 18.9, 78.8),
    "Station Ghanpur": ("Jangaon", 17.8565, 79.3717),
    "Bhupalpally": ("Jayashankar Bhupalpally", 18.4381, 79.8685),
    "Mahadevpur": ("Jayashankar Bhupalpally", 18.7316, 79.9837),
    "Alampur": ("Jogulamba Gadwal", 15.8771, 78.1353),
    "Gadwal": ("Jogulamba Gadwal", 16.2347, 77.7946),
    "Ieeja": ("Jogulamba Gadwal", 16.0142, 77.6703),
    "Waddepalle": ("Jogulamba Gadwal", 15.9359, 77.8417),
    "Banswada": ("Kamareddy", 18.3833, 77.8833),
    "Bhiknur": ("Kamareddy", 18.215, 78.4367),
    "Bichkunda": ("Kamareddy", 18.4, 77.7167),
    "Yellareddy": ("Kamareddy", 18.1859, 78.0212),
    "Choppadandi": ("Karimnagar", 18.5833, 79.1667),
    "Huzurabad": ("Karimnagar", 18.2, 79.42),
    "Jammikunta": ("Karimnagar", 18.2864, 79.4761),
    "Madhira": ("Khammam", 16.925, 80.3641),
    "Sathupalli": ("Khammam", 17.2083, 80.8361),
    "Wyra": ("Khammam", 17.196, 80.3555),
    "Asifabad": ("Kumuram Bheem Asifabad", 19.3593, 79.296),
    "Kagaznagar": ("Kumuram Bheem Asifabad", 19.3333, 79.4833),
    "Dornakal": ("Mahabubabad", 17.4447, 80.1492),
    "Kesamudram": ("Mahabubabad", 17.6875, 79.8944),
    "Maripeda": ("Mahabubabad", 17.4031, 79.8567),
    "Thorrur": ("Mahabubabad", 17.5857, 79.6578),
    "Devarakadra": ("Mahabubnagar", 16.6167, 77.85),
    "Jadcherla": ("Mahabubnagar", 16.7667, 78.15),
    "Bellampalle": ("Mancherial", 19.0558, 79.4931),
    "Chennur": ("Mancherial", 18.8535, 79.7826),
    "Kyathanpally": ("Mancherial", 18.9234, 79.4587),
    "Luxettipet": ("Mancherial", 18.8667, 79.2167),
    "Mandamarri": ("Mancherial", 18.9822, 79.4811),
    "Naspur": ("Mancherial", 18.83, 79.45),
    "Narsapur": ("Medak", 17.7386, 78.2828),
    "Ramayampet": ("Medak", 18.1166, 78.4298),
    "Toopran": ("Medak", 17.8447, 78.48),
    "Boduppal": ("Medchal–Malkajgiri", 17.4139, 78.5783),
    "Bolarum": ("Medchal–Malkajgiri", 17.5144, 78.5136),
    "Dundigal": ("Medchal–Malkajgiri", 17.5781, 78.4288),
    "Ghatkesar": ("Medchal–Malkajgiri", 17.4494, 78.6853),
    "Jawaharnagar": ("Medchal–Malkajgiri", 17.5092, 78.5542),
    "Kukatpally": ("Medchal–Malkajgiri", 17.4833, 78.4167),
    "Nagaram": ("Medchal–Malkajgiri", 17.4875, 78.6012),
    "Nizampet": ("Medchal–Malkajgiri", 17.5197, 78.3776),
    "Peerzadiguda": ("Medchal–Malkajgiri", 17.3974, 78.5783),
    "Shamirpet": ("Medchal–Malkajgiri", 17.5917, 78.5822),
    "Eturnagaram": ("Mulugu", 18.3389, 80.4292),
    "Achampet": ("Nagarkurnool", 16.399, 78.637),
    "Kalwakurthy": ("Nagarkurnool", 16.65, 78.48),
    "Kollapur": ("Nagarkurnool", 16.1046, 78.3206),
    "Chandur": ("Nalgonda", 16.98, 79.06),
    "Chityal": ("Nalgonda", 17.2333, 79.1333),
    "Devarakonda": ("Nalgonda", 16.7, 78.9333),
    "Miryalaguda": ("Nalgonda", 16.525, 79.354),
    "Munugode": ("Nalgonda", 17.0667, 79.0667),
    "Nakrekal": ("Nalgonda", 17.1667, 79.4333),
    "Kosgi": ("Narayanpet", 16.9839, 77.7193),
    "Makhtal": ("Narayanpet", 16.5021, 77.5075),
    "Bhainsa": ("Nirmal", 19.1, 77.9667),
    "Khanapur": ("Nirmal", 19.0333, 78.6667),
    "Armoor": ("Nizamabad", 18.79, 78.29),
    "Balkonda": ("Nizamabad", 18.8667, 78.35),
    "Bheemgal": ("Nizamabad", 18.7, 78.4667),
    "Bodhan": ("Nizamabad", 18.67, 77.9),
    "Nandipet": ("Nizamabad", 18.9622, 78.1772),
    "Godavarikhani": ("Peddapalli", 18.7519, 79.5133),
    "Manthani": ("Peddapalli", 18.65, 79.6667),
    "Ramagundam": ("Peddapalli", 18.8, 79.45),
    "Sultanabad": ("Peddapalli", 18.5264, 79.3212),
    "Sircilla": ("Rajanna Sircilla", 18.3898, 78.8086),
    "Vemulawada": ("Rajanna Sircilla", 18.4667, 78.8833),
    "Amangal": ("Rangareddy", 16.85, 78.533),
    "Badangpet": ("Rangareddy", 17.3047, 78.515),
    "Bandlaguda Jagir": ("Rangareddy", 17.3543, 78.3853),
    "Ibrahimpatnam": ("Rangareddy", 17.1017, 78.6294),
    "Kothur": ("Rangareddy", 17.1447, 78.2886),
    "Meerpet": ("Rangareddy", 17.32, 78.52),
    "Serilingampally": ("Rangareddy", 17.48, 78.33),
    "Shadnagar": ("Rangareddy", 17.0909, 78.2185),
    "Shamshabad": ("Rangareddy", 17.2611, 78.3932),
    "Turkayamjal": ("Rangareddy", 17.2728, 78.5708),
    "Ameenpur": ("Sangareddy", 17.5241, 78.3242),
    "Andole": ("Sangareddy", 17.8144, 78.0772),
    "Jogipet": ("Sangareddy", 17.8333, 78.0667),
    "Narayankhed": ("Sangareddy", 18.0333, 77.7833),
    "Patancheru": ("Sangareddy", 17.53, 78.27),
    "Sadasivpet": ("Sangareddy", 17.6167, 77.95),
    "Zaheerabad": ("Sangareddy", 17.68, 77.62),
    "Dubbaka": ("Siddipet", 18.1914, 78.6783),
    "Gajwel": ("Siddipet", 17.8517, 78.6828),
    "Husnabad": ("Siddipet", 18.1307, 79.2082),
    "Huzurnagar": ("Suryapet", 16.9, 79.8833),
    "Kodad": ("Suryapet", 16.9978, 79.9653),
    "Neredcherla": ("Suryapet", 16.8321, 79.4356),
    "Kodangal": ("Vikarabad", 17.107, 77.627),
    "Parigi": ("Vikarabad", 17.1833, 77.8833),
    "Tandur": ("Vikarabad", 17.23, 77.58),
    "Amarchinta": ("Wanaparthy", 16.374, 77.7729),
    "Atmakur": ("Wanaparthy", 16.3364, 77.8056),
    "Kothakota": ("Wanaparthy", 16.3667, 77.9667),
    "Pebbair": ("Wanaparthy", 16.2167, 77.9833),
    "Narsampet": ("Warangal", 17.9264, 79.8969),
    "Wardhannapet": ("Warangal", 17.7736, 79.575),
    "Alair": ("Yadadri Bhuvanagiri", 17.65, 79.05),
    "Bhongir": ("Yadadri Bhuvanagiri", 17.5173, 78.8863),
    "Bhoodan Pochampally": ("Yadadri Bhuvanagiri", 17.3461, 78.8122),
    "Choutuppal": ("Yadadri Bhuvanagiri", 17.2508, 78.8972),
    "Mothkur": ("Yadadri Bhuvanagiri", 17.45, 79.2667),
    "Ramannapeta": ("Yadadri Bhuvanagiri", 17.2833, 79.1),
    "Yadagirigutta": ("Yadadri Bhuvanagiri", 17.5864, 78.9461),
}


# Aliases that are a prefix of a longer unrelated word. The suffixes listed are
# the continuations that must NOT count as a match.
ALIAS_BLOCKED_CONTINUATIONS = {
    # "medak" inside "medakalpatnam"; "nirmal" is also an ordinary word and a
    # given name, so it needs its adjectival endings excluded.
    "nirmal": ("a", "ai", "ata"),
    "medak": ("al", "alp"),
    # "sirpur" (Telangana) vs "sirpurkagaznagar" is the same place, but
    # "siripuram" is not.
    "sirpur": ("am",),
}


STATE_NAME = 'Telangana'

# Area-weighted polygon centroid of the OSM administrative boundary relation,
# not the bounding-box midpoint — the state's shape is far from rectangular.
STATE_LAT = 17.801203
STATE_LNG = 79.008393
