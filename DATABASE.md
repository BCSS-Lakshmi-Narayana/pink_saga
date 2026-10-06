# Political Saga — MongoDB Data Architecture

## 1. Content Pipeline — Relations

```mermaid
erDiagram
    SOURCE ||--o{ CONTENT : produces
    CONTENT ||--o| ANALYSIS : content_id
    CONTENT ||--o{ ALERT : content_id
    ANALYSIS ||--o{ ALERT : analysis_id
    ALERT ||--o| GRIEVANCE : "promoted (minority)"
    GRIEVANCE_SOURCE ||--o{ GRIEVANCE : "direct fetch (majority)"

    SOURCE {
        string id PK
        string platform
        string handle
    }
    CONTENT {
        string id PK
        string content_id UK
        string risk_level
        string avgSize "7.6 KB"
    }
    ANALYSIS {
        string id PK
        string content_id FK
        number risk_score
        string avgSize "1.7 KB"
    }
    ALERT {
        string id PK
        string content_id FK
        string analysis_id FK
        string avgSize "2.2 KB"
    }
    GRIEVANCE {
        string id PK
        string tweet_id UK
        object content "embedded copy"
        object analysis "embedded copy"
        string avgSize "6.8 KB"
    }
    GRIEVANCE_SOURCE {
        string id PK
        string tagged_account
    }
```

## 2. Content Pipeline — Flow: Where Each Record Comes From

```mermaid
flowchart TB
    Platforms(["X · Facebook ·\nInstagram · YouTube"])

    Platforms --> Monitor["monitorService"]
    Monitor --> Content[("contents")]

    Content --> AnalysisSvc["analysisService"]
    AnalysisSvc --> Analysis[("analyses")]

    Content --> Vel["velocityAlertService"]
    Analysis --> Vel
    Vel --> Alert[("alerts")]

    Alert --> Promote["alertsToMentionsService"]
    Promote -->|minority path| Grievance[("grievances")]

    Platforms --> GrvSvc["grievanceService"]
    GrvSvc -->|majority path| Grievance
```

## 3. Cost of 1,000 New Documents

```mermaid
flowchart LR
    Ingest["1,000 new documents"] --> C2["contents ~7.6 MB"]
    Ingest --> A2["analyses ~1.7 MB"]
    Ingest --> Al2["alerts ~2.2 MB"]
    Ingest --> Gr2["grievances ~6.8 MB"]
```

## 4. Every Active Data Domain

### 4.1 Sources & Engagement

```mermaid
erDiagram
    SOURCE ||--o{ ENGAGER_ANALYSIS : source_id

    SOURCE {
        string id PK
        string platform
        string identifier UK
        string avgSize "0.6 KB"
    }
    GRIEVANCE_SOURCE {
        string id PK
        string handle
        string avgSize "0.5 KB"
    }
    KEYWORD {
        string id PK
        string keyword
        string category
        string avgSize "0.3 KB"
    }
    ENGAGER_ANALYSIS {
        string id PK
        string source_id FK
        array engagers "embedded"
        string avgSize "182 KB"
    }
    COMMENT {
        string id PK
        string content_id FK
        string avgSize "0.6 KB"
    }
```

```mermaid
flowchart LR
    User(["User"]) -->|Sources page| SourceCtrl["sourceController"] -->|writes| SourceDB[("sources")]
    User -->|Keywords page| KwCtrl["keywordController"] -->|writes| KwDB[("keywords")]
    User -->|Grievance Sources page| GsCtrl["grievanceSourceController"] -->|writes| GsDB[("grievance_sources")]
    Scheduler(["Hourly scheduler"]) -->|triggers| EngSvc["engagerAnalysisService"] -->|writes| EngDB[("engager_analyses")]
    YouTube(["YouTube API"]) -->|comment fetch| Monitor["monitorService"] -->|writes| ComDB[("comments")]
```

### 4.2 News & Geography

```mermaid
erDiagram
    POI }o--o| SOURCE : socialMedia_sourceId

    NEWS_ARTICLE {
        string source_url UK
        string category
        string sentiment
        string avgSize "4.8 KB"
    }
    CONSTITUENCY_MASTER {
        string ac_name UK
        string district
        string avgSize "0.4 KB"
    }
    POI {
        string name
        array socialMedia "embedded"
        string avgSize "1.0 KB"
    }
```

```mermaid
flowchart LR
    RSS(["Python RSS engine\nscheduled"]) -->|writes| NewsDB[("news_articles")]
    Admin(["Admin / one-time seed"]) -->|reference data,\nrarely changes| ConstDB[("constituency_masters")]
    User(["User"]) -->|POI page| PoiCtrl["poiController"] -->|writes| PoiDB[("pois")]
```

### 4.3 Events & Calendar

```mermaid
erDiagram
    MASTER_CALENDAR_EVENT ||--o{ EVENT : origin_calendar_id

    MASTER_CALENDAR_EVENT {
        number slNo PK
        string occasion
        string avgSize "0.3 KB"
    }
    EVENT {
        string id PK
        string origin
        string origin_calendar_id FK
        string avgSize "3.3 KB"
    }
```

```mermaid
flowchart LR
    User(["User"]) -->|Master Calendar page| CalCtrl["masterCalendarController"] -->|writes| CalDB[("master_calendar_events")]
    CalDB -->|"auto-generates\nrecurring date"| EventCtrl["eventController"]
    User -->|or manually, Events page| EventCtrl
    EventCtrl -->|writes| EventDB[("events")]
```

### 4.4 Identity & Access

```mermaid
erDiagram
    USER ||--|| PAGE_PERMISSION : "user_id (1:1)"
    USER ||--o{ AUDIT_LOG : user_id

    USER {
        string id PK
        string email UK
        string role
        string avgSize "0.5 KB"
    }
    PAGE_PERMISSION {
        string user_id FK,UK
        array allowed_pages
        string avgSize "0.7 KB"
    }
    AUDIT_LOG {
        string user_id FK
        string action
        string avgSize "0.5 KB"
    }
```

```mermaid
flowchart LR
    SuperAdmin(["Super admin"]) -->|Access Management page| AuthCtrl["authController"] -->|writes| UserDB[("users")]
    SuperAdmin -->|RBAC page| RbacCtrl["rbacController"] -->|writes| PermDB[("page_permissions")]
    AnyWrite(["Any authenticated\nwrite action"]) -->|auto-logged by| AuditSvc["auditService"] -->|writes| AuditDB[("audit_logs")]
```

### 4.5 Policy & Configuration

```mermaid
erDiagram
    POLICY_MAPPING {
        string category_id PK,UK
        string severity_level
        string avgSize "0.9 KB"
    }
    ALERT_THRESHOLD {
        string platform PK,UK
        number high_threshold
        string avgSize "0.2 KB"
    }
    SETTINGS {
        string id PK "singleton"
        string avgSize "1.1 KB"
    }
    GRIEVANCE_SETTINGS {
        string id PK "singleton"
        string avgSize "0.5 KB"
    }
    COUNTER {
        string key PK,UK
        number seq
        string avgSize "0.1 KB"
    }
```

```mermaid
flowchart LR
    User(["User"]) -->|Policy Manager page| PolCtrl["policyController"] -->|writes| PolDB[("policy_mappings")]
    User -->|Alert Thresholds page| ThreshCtrl["alertThresholdController"] -->|writes| ThreshDB[("alert_thresholds")]
    User -->|Settings page| SetCtrl["settingsController"] -->|writes| SetDB[("settings /\ngrievance_settings")]
    Internal(["Internal report\nnumbering calls"]) -->|auto-increments| CountDB[("counters")]
```

### 4.6 Search

```mermaid
erDiagram
    USER ||--o{ SEARCH_HISTORY : user_id

    SEARCH_HISTORY {
        string user_id FK
        string query
        array results "embedded"
        string avgSize "75 KB"
    }
```

```mermaid
flowchart LR
    User(["Any logged-in user"]) -->|runs a search| SearchCtrl["searchController"] -->|writes| SearchDB[("search_history")]
```
