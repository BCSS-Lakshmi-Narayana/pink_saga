# Chhattisgarh Political Watch — System Architecture

> **Chhattisgarh Political Watch** — a BJP Chhattisgarh / Government of Chhattisgarh (CM Vishnu Deo Sai) social-media & news monitoring platform,
> cloned from the AP.Blura.Saga (TDP / Andhra Pradesh) codebase.
> Three cooperating processes (React SPA · Node/Express API · Python news engine) over one shared MongoDB,
> wired to a dozen external platforms. This document diagrams every layer and the flows that connect them.

| Metric | Count | | Metric | Count |
|---|---|---|---|---|
| Runtime processes | **3 (+1 aux)** | | REST endpoints | **325** |
| SPA pages / routes | **55+** | | API routers | **45** |
| React components | **150+** | | Backend services | **130+** |
| React context providers | **5** | | Data models | **55** |
| Background jobs | **6+** | | MongoDB (shared) | **`cgsaga`** |

**Stack:** React (CRA) · Node/Express · Python · MongoDB Atlas &nbsp;•&nbsp; **Auth:** JWT + RBAC &nbsp;•&nbsp; **Domain:** Chhattisgarh political monitoring

### Color legend (diagrams)

| | Subsystem |
|---|---|
| 🟪 violet | Frontend / Client |
| 🟧 amber | Backend / API |
| 🟦 cyan | Python Engine |
| 🟩 green | Data Store |
| ⬜ slate | External API |
| 🟥 rose | Actor |

---

## Table of Contents

1. [System Context](#01--system-context)
2. [Frontend Architecture](#02--frontend-architecture)
3. [Backend Architecture](#03--backend-architecture)
4. [Blura-Engine · News Pipeline](#04--blura-engine--news-pipeline)
5. [End-to-End Data Flows](#05--end-to-end-data-flows)
6. [Feature Module Map](#06--feature-module-map)
7. [API Surface](#07--api-surface)
8. [Data Stores](#08--data-stores)
9. [External Integrations](#09--external-integrations)
10. [Background Jobs](#10--background-jobs)

---

## 01 · System Context

A single-page app talks REST+JWT to the Node API; the Python **Blura-Engine** writes news straight into the same
database on a 5-minute cron; media is archived to S3 and Cloudinary; and a Python location micro-service is
reverse-proxied through the API to avoid mixed-content.

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontFamily':'ui-monospace,monospace','fontSize':'13px','lineColor':'#8792a6','textColor':'#8792a6','clusterBkg':'transparent','clusterBorder':'#9aa4b8'}}}%%
flowchart LR
  U["Analyst · Admin ·<br/>Constituency Login"]:::actor
  subgraph CLIENT["BROWSER"]
    FE["React SPA<br/>CRA · Vercel / Nginx"]:::fe
  end
  subgraph APP["APPLICATION SERVER"]
    API["Node / Express API<br/>:8000 · /api/*"]:::be
  end
  subgraph ASYNC["ASYNC WORKERS"]
    ENG["Blura-Engine<br/>Python · cron 5 min"]:::eng
    LOC["Location Extraction<br/>Python · :5002"]:::eng
  end
  subgraph STORE["DATA STORES"]
    DB[("MongoDB Atlas<br/>db: cgsaga")]:::data
    S3[("AWS S3<br/>media archive")]:::data
    CLD[("Cloudinary<br/>uploads")]:::data
    FS[("Booth / Voter<br/>JSON on disk")]:::data
  end
  subgraph EXT["EXTERNAL PLATFORMS & AI"]
    SOC["X · Instagram · Facebook<br/>YouTube · Reddit · Telegram"]:::ext
    AI["Cohere · Gemini · OpenAI<br/>Ollama · Google Translate"]:::ext
    GG["Google News RSS · Trends<br/>SMTP mail"]:::ext
  end
  U -->|HTTPS| FE
  FE -->|"REST + Bearer JWT"| API
  API --> DB
  API --> FS
  API --> S3
  API --> CLD
  API -->|proxy| LOC
  API -->|"fetch / OAuth"| SOC
  API -->|"classify · summarise"| AI
  API --> GG
  ENG -->|"scrape RSS"| GG
  ENG -->|"translate · sentiment"| AI
  ENG -->|upsert newsarticles| DB
  classDef actor fill:#fbe0dd,stroke:#d9534f,color:#6e211f;
  classDef fe fill:#ede9fe,stroke:#7c3aed,color:#3b1f7a;
  classDef be fill:#fdecc8,stroke:#c77d1a,color:#5c3a06;
  classDef eng fill:#cbf0f8,stroke:#0e8ba8,color:#083b49;
  classDef data fill:#d5f3e0,stroke:#12925f,color:#0a4d33;
  classDef ext fill:#e4e8ef,stroke:#64748b,color:#28313f;
```

> Three runtime processes + one auxiliary micro-service, unified by the `cgsaga` database.

---

## 02 · Frontend Architecture

A Create-React-App SPA. Boot flows through a nested provider stack, then a `ProtectedRoute` gate wraps a shared
`Layout`. Every page is lazy-loaded; all traffic passes through one Axios instance that injects the JWT and
force-logs-out on `401`.

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontFamily':'ui-monospace,monospace','fontSize':'12.5px','lineColor':'#8792a6','textColor':'#8792a6','clusterBkg':'transparent','clusterBorder':'#9aa4b8'}}}%%
flowchart TB
  IDX["index.js → App.js"]:::fe
  subgraph PROV["PROVIDER STACK"]
    direction LR
    P1["AuthProvider"]:::fe --> P2["DashboardProvider"]:::fe --> P3["NotificationProvider"]:::fe --> P4["RbacProvider"]:::fe --> P5["InstagramCacheProvider"]:::fe
  end
  GATE["ProtectedRoute<br/>(JWT guard)"]:::fe
  LAY["Layout<br/>top-nav shell"]:::fe
  API["lib/api.js — Axios<br/>+ Bearer · 401→/login"]:::be
  subgraph PAGES["FEATURE PAGES (lazy)"]
    direction LR
    M1["State Map ·<br/>Dashboard"]:::fe
    M2["Mentions ·<br/>Web Articles"]:::fe
    M3["Alerts ·<br/>Threats"]:::fe
    M4["Social<br/>Monitors"]:::fe
    M5["Geographic<br/>Intelligence"]:::fe
    M6["MLA Profile ·<br/>Voter/Booth"]:::fe
    M7["Reports ·<br/>Events"]:::fe
    M8["Access · RBAC ·<br/>Audit · Settings"]:::fe
  end
  subgraph LIB["SHARED COMPONENT LIBRARIES"]
    direction LR
    L1["ui/ — radix + shadcn"]:::fe
    L2["dashboard/apDashboard"]:::fe
    L3["geographic/ + tabs"]:::fe
    L4["grievances/ · compare/ · reports/"]:::fe
  end
  BE[("Backend /api/*")]:::data
  IDX --> PROV --> GATE --> LAY --> PAGES
  PAGES --> LIB
  PAGES --> API --> BE
  classDef fe fill:#ede9fe,stroke:#7c3aed,color:#3b1f7a;
  classDef be fill:#fdecc8,stroke:#c77d1a,color:#5c3a06;
  classDef data fill:#d5f3e0,stroke:#12925f,color:#0a4d33;
```

> `react-router-dom` v7 · recharts · react-simple-maps + d3-geo · framer-motion · CKEditor.

**5 context providers**

- **AuthContext** — JWT in localStorage, user identity
- **RbacContext** — page + tab visibility per role
- **DashboardContext** — shared filters / date range
- **NotificationContext** — toast + alert badges
- **InstagramCacheContext** — profile memo cache

**Visualization / rendering**

- **recharts** — sentiment, trend, source charts
- **react-simple-maps + d3-geo** — Chhattisgarh choropleth (90 ACs, 33 districts)
- **framer-motion** — panels & transitions
- **jspdf + html2canvas** — report export

**Auth boundary** — Every call → Axios interceptor attaches `Bearer`; a `401` clears the token and redirects to
`/login`. Location lookups hit the proxied Python service.

---

## 03 · Backend Architecture

Classic layered Express: **route → middleware → controller → service → model → Mongo**. Middleware handles CORS,
JWT verification (`protect`), role checks and scope-building. A fleet of services isolates every external
integration and the AI/analysis pipeline.

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontFamily':'ui-monospace,monospace','fontSize':'12.5px','lineColor':'#8792a6','textColor':'#8792a6','clusterBkg':'transparent','clusterBorder':'#9aa4b8'}}}%%
flowchart TB
  REQ["Client request<br/>/api/*"]:::fe
  subgraph MW["MIDDLEWARE"]
    direction LR
    MW1["CORS + JSON 50mb"]:::be --> MW2["protect<br/>JWT verify"]:::be --> MW3["rbac + scope<br/>buildScope"]:::be
  end
  subgraph RT["ROUTE LAYER · 45 routers · 325 endpoints"]
    direction LR
    R1["grievances · alerts<br/>news · content"]:::be
    R2["x · telegram · youtube<br/>media · sources"]:::be
    R3["dashboard · geo-intel<br/>voter-profiles"]:::be
    R4["events · reports · poi<br/>rbac · audit · auth"]:::be
  end
  subgraph CT["CONTROLLERS · ~50"]
    direction LR
    C1["request parse ·<br/>validation · shaping"]:::be
  end
  subgraph SV["SERVICE LAYER · 130+"]
    direction LR
    S1["Social fetchers<br/>rapidApi* · xApi · telegram"]:::be
    S2["AI / analysis<br/>llm · gemini · sentiment"]:::be
    S3["Pipeline<br/>monitor · grievance · alerts"]:::be
    S4["Domain<br/>booth · geo · political"]:::be
    S5["Storage / mail<br/>S3 · cloudinary · email"]:::be
  end
  subgraph MD["MODELS · 55 (Mongoose)"]
    direction LR
    D1["User · Grievance · Alert<br/>NewsArticle · Content · POI …"]:::data
  end
  DB[("MongoDB Atlas · cgsaga")]:::data
  EXT["External APIs<br/>+ AI providers"]:::ext
  REQ --> MW --> RT --> CT --> SV
  SV --> MD --> DB
  SV --> EXT
  classDef fe fill:#ede9fe,stroke:#7c3aed,color:#3b1f7a;
  classDef be fill:#fdecc8,stroke:#c77d1a,color:#5c3a06;
  classDef data fill:#d5f3e0,stroke:#12925f,color:#0a4d33;
  classDef ext fill:#e4e8ef,stroke:#64748b,color:#28313f;
```

> A `USE_ENGINE` flag swaps the live monitoring loop for a **TempContent** queue drained from the engine.

**130+ services, by role**

- **Social fetch** — `rapidApiX/Instagram/Facebook`, `xApiService`, `redditService`, `telegramService`, `youtube.service`, `agent-twitter-client`, `puppeteer`
- **AI / NLP** — `llmProvider`, `geminiService`, `openaiGlanceService`, `ollamaLLMService`, `sentimentService`, `politicalSentimentService`, `translationService`, `keywordGenService`
- **Pipeline** — `monitorService`, `tempContentProcessor`, `grievanceService`, `grievanceWorkflowService`, `alertsToMentionsService`, `velocityAlertService`
- **Domain** — `boothVoterService`, `voterProfileService`, `constituencyMasterService`, `geoIntel`, `politicalImpactService`, `unrestPredictorService`, `engagerAnalysisService`

**Cross-cutting**

- **authMiddleware** — `protect` (Bearer→JWT→User) & `authorize(roles)`
- **rbacMiddleware / scopeMiddleware** — page & constituency scoping via `buildScope`
- **cacheService** — in-memory warm caches (gated alerts, profiles)
- **auditService** — action logging → `AuditLog`
- **Default seeds** — superadmin `admin@apwatch.in`, grievance admin, settings, thresholds, calendar

---

## 04 · Blura-Engine · News Pipeline

A standalone Python process that scrapes 116 RSS feeds (Chhattisgarh sections of the Hindi and English press,
national EN, and Google News in English and Hindi, including per-district queries for all 33 districts),
decodes Google's redirect URLs, enriches with Cohere, and
upserts de-duplicated articles into the same `newsarticles` collection the API reads.

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontFamily':'ui-monospace,monospace','fontSize':'12.5px','lineColor':'#8792a6','textColor':'#8792a6','clusterBkg':'transparent','clusterBorder':'#9aa4b8'}}}%%
flowchart LR
  CRON["political_main.py<br/>schedule · 5 min"]:::eng
  CFG["political_config.py<br/>RSS_FEEDS · DISTRICTS<br/>keywords · EN / Hindi / Chhattisgarhi"]:::eng
  FEED["feedparser<br/>parse RSS"]:::eng
  subgraph ENR["PER-ARTICLE ENRICHMENT · political_rss.py"]
    direction TB
    E1["detect_language ·<br/>relevance · category ·<br/>district"]:::eng
    E2["resolve_google_news_url<br/>(batchexecute decode)"]:::eng
    E3["fetch_article_page<br/>requests + BeautifulSoup"]:::eng
    E4["Cohere → English +<br/>sentiment<br/>(heuristic fallback)"]:::eng
    E1 --> E2 --> E3 --> E4
  end
  DEDUP["mongo_similarity<br/>de-dup"]:::eng
  UP["mongo_insert<br/>upsert_article"]:::eng
  NA[("newsarticles")]:::data
  BF["backfill_content.py<br/>backfill_sentiment.py"]:::eng
  CRON --> CFG --> FEED --> ENR --> DEDUP --> UP --> NA
  BF -.->|"re-enrich existing"| NA
  classDef eng fill:#cbf0f8,stroke:#0e8ba8,color:#083b49;
  classDef data fill:#d5f3e0,stroke:#12925f,color:#0a4d33;
```

> `DB/mongo_connect.py` loads `backend/.env`, so engine + API share one database. Cohere is optional (keyed by `COHERE_API_KEY`).

---

## 05 · End-to-End Data Flows

Five journeys trace a datum from origin to the pixel a user sees.

### A · Social monitoring → Alerts → Mentions

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontFamily':'ui-monospace,monospace','fontSize':'12.5px','lineColor':'#8792a6','textColor':'#8792a6','clusterBkg':'transparent','clusterBorder':'#9aa4b8'}}}%%
flowchart LR
  SRC["Sources + Keywords<br/>(configured in UI)"]:::fe
  subgraph ING["INGEST (mode-dependent)"]
    direction TB
    MON["monitorService<br/>live fetch loop"]:::be
    TMP["Blura-Engine →<br/>TempContent queue →<br/>tempContentProcessor"]:::be
  end
  PLAT["X · IG · FB · YouTube<br/>Reddit · Telegram"]:::ext
  CNT[("Content")]:::data
  AN["analysisService<br/>sentiment · stance ·<br/>political impact · keywords"]:::be
  VEL["velocityAlertService<br/>threshold breach"]:::be
  AL[("Alert")]:::data
  A2M["alertsToMentionsService<br/>promote (5 min)"]:::be
  GRV[("Grievance / Mention")]:::data
  UI["Alerts page ·<br/>Mentions feed"]:::fe
  SRC --> ING
  PLAT --> MON
  PLAT --> TMP
  ING --> CNT --> AN --> VEL --> AL --> A2M --> GRV --> UI
  AL --> UI
  classDef fe fill:#ede9fe,stroke:#7c3aed,color:#3b1f7a;
  classDef be fill:#fdecc8,stroke:#c77d1a,color:#5c3a06;
  classDef data fill:#d5f3e0,stroke:#12925f,color:#0a4d33;
  classDef ext fill:#e4e8ef,stroke:#64748b,color:#28313f;
```

### B · Mention analysis & grievance workflow

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontFamily':'ui-monospace,monospace','fontSize':'12.5px','lineColor':'#8792a6','textColor':'#8792a6','clusterBkg':'transparent','clusterBorder':'#9aa4b8'}}}%%
flowchart LR
  FE1["rapidApiXService<br/>fetch mentions"]:::be
  GS["grievanceService<br/>analyzeGrievanceContent"]:::be
  AS["analysisService<br/>BSK-relative sentiment ·<br/>stance · target entity · risk"]:::be
  LOC["locationClassifierService<br/>→ Chhattisgarh district / AC"]:::be
  G[("Grievance")]:::data
  WF["Workflow codes<br/>criticism · query · suggestion"]:::be
  RPT["Reports ·<br/>CriticismReport · QueryReport"]:::data
  UI["Mentions page<br/>filter · edit sentiment · FIR"]:::fe
  FE1 --> GS --> AS --> LOC --> G --> WF --> RPT --> UI
  G --> UI
  classDef fe fill:#ede9fe,stroke:#7c3aed,color:#3b1f7a;
  classDef be fill:#fdecc8,stroke:#c77d1a,color:#5c3a06;
  classDef data fill:#d5f3e0,stroke:#12925f,color:#0a4d33;
```

### C · News → constituency drill-down

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontFamily':'ui-monospace,monospace','fontSize':'12.5px','lineColor':'#8792a6','textColor':'#8792a6','clusterBkg':'transparent','clusterBorder':'#9aa4b8'}}}%%
flowchart LR
  ENG["Blura-Engine"]:::eng
  NA[("newsarticles<br/>+ district · sentiment")]:::data
  NC["newsController<br/>/api/news · /stats ·<br/>/constituency/:ac"]:::be
  CM["ConstituencyMaster<br/>AC → district map"]:::be
  RSS["Mentions · RSS tab<br/>RssNewsCard"]:::fe
  DNP["DistrictNewsPanel<br/>on MLA Profile ·<br/>who's-against-us split"]:::fe
  ENG --> NA --> NC
  NC --> CM
  NC --> RSS
  NC --> DNP
  classDef fe fill:#ede9fe,stroke:#7c3aed,color:#3b1f7a;
  classDef be fill:#fdecc8,stroke:#c77d1a,color:#5c3a06;
  classDef eng fill:#cbf0f8,stroke:#0e8ba8,color:#083b49;
  classDef data fill:#d5f3e0,stroke:#12925f,color:#0a4d33;
```

### D · Auth & RBAC

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontFamily':'ui-monospace,monospace','fontSize':'12px','lineColor':'#8792a6','textColor':'#8792a6','clusterBkg':'transparent','clusterBorder':'#9aa4b8'}}}%%
flowchart TB
  LG["Login page"]:::fe
  AC["authController<br/>bcrypt + JWT sign"]:::be
  TK["localStorage token"]:::fe
  IN["Axios interceptor<br/>Bearer header"]:::fe
  PR["protect + buildScope"]:::be
  RB["rbacConfig<br/>page / tab gating"]:::be
  LG --> AC --> TK --> IN --> PR --> RB
  classDef fe fill:#ede9fe,stroke:#7c3aed,color:#3b1f7a;
  classDef be fill:#fdecc8,stroke:#c77d1a,color:#5c3a06;
```

### E · Booth / voter (file-based)

```mermaid
%%{init:{'theme':'base','themeVariables':{'fontFamily':'ui-monospace,monospace','fontSize':'12px','lineColor':'#8792a6','textColor':'#8792a6','clusterBkg':'transparent','clusterBorder':'#9aa4b8'}}}%%
flowchart TB
  FSX[("summary.json +<br/>voters/&lt;part&gt;.json")]:::data
  BV["boothVoterService<br/>lazy-load · compute metrics"]:::be
  VC["voterProfileController<br/>/api/voter-profiles"]:::be
  UI["VoterProfilePanel ·<br/>BoothLevelModal"]:::fe
  FSX --> BV --> VC --> UI
  classDef fe fill:#ede9fe,stroke:#7c3aed,color:#3b1f7a;
  classDef be fill:#fdecc8,stroke:#c77d1a,color:#5c3a06;
  classDef data fill:#d5f3e0,stroke:#12925f,color:#0a4d33;
```

> **Sentiment scheme** everywhere: `positive` · `moderate` · `negative` (`neutral` is a legacy alias for `moderate`).

---

## 06 · Feature Module Map

The application decomposes into ~16 functional modules. Each binds pages ↔ endpoints ↔ models.

| Module | Key pages | Endpoints / services |
|---|---|---|
| **State Map & Dashboard** — command center, choropleth, KPIs, AI insights | `StateMap`, `DashboardNew` | `/api/dashboard` |
| **Geographic Intelligence** — district/city drill-down, risk, playback | `GeographicIntelligence` | `/api/geo-intel`, `/api/constituency-intel` |
| **Mentions / Grievances** — mention feed + RSS news, sentiment, FIR | `Grievances` | `/api/grievances` (29), `/api/news` |
| **Alerts & Threats** — velocity alerts, engager analysis, escalation | `Alerts`, `ActiveThreats` | `/api/alerts` (19), `/api/alert-thresholds` |
| **Social Monitors** — X, FB, IG (+profiles/stories), YouTube, Telegram | `XMonitor`, `FacebookMonitor`, `InstagramMonitor`, `YouTubeMonitor`, `Telegram` | `/api/x` (27), `/api/telegram` (19), `/api/youtube` (12) |
| **Web Articles** — public web article search/monitoring | `PublicWebArticles` | `/api/web-articles`, `webArticleSearchService` |
| **Voter / Booth Intelligence** — booth rolls, demographics, sentiment | `VoterProfilePanel`, `BoothLevelModal` | `/api/voter-profiles`, `boothVoterService` |
| **MLA / MP Profiles** — per-constituency profile, district news, compare | `MlaProfile`, `compare/` | `/api/admin` |
| **Events & Programmes** — events, ongoing, daily, master calendar | `Events`, `EventsReport` | `/api/events` (15), `/api/daily-programmes`, `/api/master-calendar` |
| **Reports & Intelligence** — unified reports, generation, export | `UnifiedReports`, `IntelligenceDashboard`, `GenerateReport` | `/api/reports`, `/api/intelligence-reports`, `/api/export` |
| **Person of Interest** — POI dossiers, profile-image mgmt | `PersonOfInterest`, `POIDetail` | `/api/poi` |
| **Dial-100 Incidents** — incident reporting & tracking | `Dial100IncidentReporting` | `/api/dial100-incidents` |
| **Deepfake Analysis** — media forensics / deepfake detection | `DeepfakeAnalysis` | `/api/deepfake`, `mediaAnalyzerService` |
| **Search & Trends** — global search, analytics, Google Trends | `GlobalSearch`, `SearchAnalytics` | `/api/search`, `/api/search-trends` |
| **Policies & Templates** — platform policy manager, legal, templates | `PolicyManager` | `/api/policies`, `/api/templates` |
| **Access · RBAC · Audit** — access mgmt, constituency logins, audit | `AccessManagement`, `ConstituencyLogins`, `AuditLogs`, `Settings`, `Sources` | `/api/rbac`, `/api/audit`, `/api/settings` |

---

## 07 · API Surface

**325 endpoints** across **45 routers**, all mounted under `/api`. The busiest routers carry the monitoring,
social-action, and admin workloads.

| Base path | Router | Endpoints | Responsibility |
|---|---|--:|---|
| `/api/grievances` | `grievanceRoutes` | 29 | Mentions CRUD, fetch, analyze, status, FIR |
| `/api/x` | `x.routes` | 27 | X OAuth, actions, bulk ops, accounts |
| `/api/admin` | `profileSettingsRoutes` | 20 | MLA + global profile settings |
| `/api/alerts` | `alertRoutes` | 19 | Alerts, ack, escalate, reports, engagers |
| `/api/telegram` | `telegramRoutes` | 19 | Groups, messages, sync |
| `/api/events` | `eventRoutes` | 15 | Events lifecycle |
| `/api/dashboard` | `apDashboardRoutes` | 12 | Chhattisgarh KPIs, sentiment, districts, map, AI insights (legacy `ap-*` route names) |
| `/api/youtube` | `youtube.routes` | 12 | Channel/video monitoring, transcripts |
| `/api/news` | `newsRoutes` | 11 | RSS articles, keywords, languages, sentiment |
| `/api/criticism` | `criticismRoutes` | 10 | Criticism workflow & contacts |
| `/api/grievance-workflow` | `grievanceWorkflowRoutes` | 10 | Grievance workflow reports |
| `/api/daily-programmes` | `dailyProgrammeRoutes` | 10 | Daily programme scheduling |
| `/api/templates` · `/query-workflow` · `/media` | `templates` · `query` · `media` | 8–9 | Templates, query workflow, media |
| `/api/content` · `/poi` · `/search` · `/geo-intel` · `/rbac` · `/instagram-stories` · `/suggestion` | *various* | 7 | Content, POI, search, geo, rbac, IG stories, suggestions |
| `/api/reports` · `/sources` · `/auth` · `/constituency-intel` · `/voter-profiles` | *various* | 5–6 | Reports, sources, auth, constituency intel, voter/booth |
| `/api/intelligence` · `/keywords` · `/master-calendar` · `/ongoing-events` | *various* | 4 | Intelligence dashboard, keywords, calendar, ongoing events |
| `/api/deepfake` · `/analytics` · `/unrest` · `/uploads` | *various* | 3 | Deepfake, analytics, unrest, uploads |
| `/api/dial100-incidents` · `/export` · `/intelligence-reports` | *various* | 2 | Incidents, export, intel reports |
| `/api/audit` · `/threats` · `/search-trends` · `/web-articles` · `/alert-thresholds` | *various* | 1 | The long tail |

---

## 08 · Data Stores

One MongoDB Atlas database (`cgsaga`, ~55 Mongoose models) is the system of record. Binary media lives in S3 &
Cloudinary; static electoral rolls live as JSON on disk.

### MongoDB · `cgsaga` — 55 collections

| Group | Collections |
|---|---|
| **Identity / Access** | `User`, `PagePermission`, `AuditLog` |
| **Monitoring** | `Content`, `TempContent`, `Source`, `GrievanceSource`, `Keyword`, `ManualReviewQueue` |
| **Social** | `TwitterAccount`, `XOAuthAccount`, `XBulkAction`, `TelegramGroup`, `TelegramMessage`, `InstagramStory`, `YouTubeTranscript`, `EngagerAnalysis`, `PeriscopeUpload` |
| **Grievance** | `Grievance`, `GrievanceSettings`, `GrievanceWorkflowReport`, `CriticismReport`, `CriticismContact`, `QueryReport`, `SuggestionReport`, `Comment` |
| **Alerts** | `Alert`, `AlertThreshold`, `Analysis` |
| **News / Geo** | `NewsArticle`, `ConstituencyMaster`, `POI` |
| **Events** | `Event`, `OngoingEvent`, `DailyProgramme`, `MasterCalendarEvent` |
| **Policy / Output** | `PlatformPolicy`, `PolicyMapping`, `LegalSection`, `Template`, `Report`, `SearchHistory` |
| **Config** | `MlaProfileSettings`, `GlobalProfileSettings`, `Settings`, `Counter`, `Dial100Incident` |

### Non-Mongo stores

- **Booth/Voter JSON** — `src/data/boothVoters/<ac>.summary.json` + `voters/<ac>/<part>.json`, lazy-loaded, counts computed server-side. None ships with the Chhattisgarh build (the AP rolls were removed); upload per seat via the booth-roll flow
- **Static data** — `state_mlas.json`, `state_voter_profiles.json`, `state_ac_electors.json`, `state_ls_to_ac.json`, `state_socioeconomic_*.json`, `state_geo.json`, `state_leader_handles.json`; frontend `stateMLAs.js` / `stateMPs.js` (generated by `frontend/scripts/gen_state_data.js`)
- **AWS S3** — archived tweet/story/periscope/telegram media (4 S3 services)
- **Cloudinary** — user uploads via `/api/uploads`

> **⚠ Shared-DB coupling.** The Python engine and the Node API bind to the **same** `cgsaga` database (engine reads
> `backend/.env`). The engine owns `newsarticles`; the API owns everything else. Credentials live only in `.env` /
> env-vars — never in source.

---

## 09 · External Integrations

Each third party is wrapped by a dedicated service, so credentials and quirks stay isolated.

| Category | Provider | Used for | Wrapper |
|---|---|---|---|
| Social | RapidAPI (X / IG / FB / LLM) | Timeline & profile scraping, cheap LLM | `rapidApi*Service` |
| Social | Twitter API v2 · agent-twitter-client | Authenticated X reads & actions | `xApiService`, `xActionService` |
| Social | YouTube Data API (googleapis) | Channel/video monitoring | `youtube.service` |
| Social | Telegram (MTProto) | Group message sync | `telegramService` |
| Social | Reddit | Subreddit mentions | `redditService` |
| AI / NLP | Cohere | Engine translate + sentiment | `political_rss.py` |
| AI / NLP | Google Gemini · OpenAI · Ollama | Analysis, glance summaries, local LLM | `gemini/openai/ollama` services |
| AI / NLP | TensorFlow toxicity · Xenova transformers | On-device toxicity / embeddings | `mediaAnalyzer`, `sentiment` |
| Google | News RSS · Translate · Trends | News source, translation, interest data | engine · `translation` · `searchTrends` |
| Storage | AWS S3 · Cloudinary | Media archive · uploads | `contentS3`, `storyS3`, `uploads` |
| Infra | Nodemailer / SMTP | Email alerts | `emailService` |
| Infra | Location Extraction (Python :5002) | Text → Chhattisgarh town/district geocode | `/api/location-extraction` proxy |
| Infra | Puppeteer (stealth) | Headless page scraping | `scraperService` |

---

## 10 · Background Jobs

Beyond request/response, the server runs timed loops on boot. A `USE_ENGINE` flag decides whether the API fetches
directly or drains the engine's `TempContent` queue.

| Job | Interval | Process | Does |
|---|---|---|---|
| Blura-Engine run | 5 min | Python | Scrape RSS → enrich → upsert `newsarticles` |
| `monitorService` / `tempContentProcessor` | loop | Node | Fetch or drain social content → `Content` |
| Grievance auto-fetch | 10 min | Node | Pull mentions for active sources + keywords |
| `alertsToMentions` | 5 min | Node | Promote qualifying alerts → mentions |
| `engagerAutoQueue` | 1 hr | Node | Queue one handle for engager analysis |
| `availabilityChecker` | 6 hr | Node | Re-check content still live |
| Telegram auto-sync | loop | Node | Sync Telegram groups (legacy mode) |
| Cache warm-up | boot | Node | Pre-warm gated-alert IDs & profile caches |

> **Two ingestion modes.** With `USE_ENGINE=false` the API runs its own monitoring + grievance schedulers. With
> `USE_ENGINE=true` those are skipped and the engine feeds a `TempContent` queue that `tempContentProcessor`
> drains — the same normalization either way.

---

<sub>Chhattisgarh Political Watch (from Goa Political Watch / AP.Blura.Saga) · architecture reference · Frontend React · Backend Node/Express · Engine Python · MongoDB `cgsaga` · generated from source, 2026.</sub>
