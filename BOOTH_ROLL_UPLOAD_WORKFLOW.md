# Booth Roll Bulk Upload — Workflow

Super Admin → Config → **Booth Rolls**. Staged upload of one constituency's ECI
electoral roll (summary + per-booth voter files) into the tenant's database.

Product scope: **political / state** tenants only (the police saga has no booth rolls).

---

## 1. Topology

```
┌─────────────────────────────┐
│ Browser — Super Admin SPA   │  BoothDataManager.jsx
│ • FileReader + JSON.parse   │  parses the .json files IN THE BROWSER
│ • chunks 10 parts / batch   │  no multipart anywhere in this flow
│ • 3 concurrent, 3 retries   │
└──────────────┬──────────────┘
               │ Bearer super_admin_token
               │ /api/tenants/:tenantId/:type/booth-imports…
┌──────────────▼──────────────┐
│ Super Admin backend :4000   │  superAdminController.js
│ • permission gate           │  permissions.manage_state_tenants
│ • apiForTenant() routing    │  TenantMirror.saga_backend → which saga
│ • express.json 10mb  ⚠      │  PURE PROXY — stores nothing
└──────────────┬──────────────┘
               │ x-service-key: SUPER_ADMIN_SERVICE_KEY
               │ /api/super-admin/tenants/:tenantId/booth-imports…
┌──────────────▼──────────────┐
│ Political-State saga backend│  boothImportController.js
│ • service-key gate          │  ALL validation + ALL writes live here
│ • :tenantId router param    │  runWithTenant(...) puts the DB in scope
│ • express.json 50mb         │
└──────────────┬──────────────┘
               ▼
   booth_roll_imports · booths · booth_voters   (+ Candidate.booth_data mirror)
```

**Files**

| Layer | File |
|---|---|
| UI | `superadmin/frontend/src/components/BoothDataManager.jsx` |
| Proxy | `superadmin/backend/src/controllers/superAdminController.js` (≈L623–710) |
| Proxy routes | `superadmin/backend/src/routes/superAdminRoutes.js` (L51–57) |
| Owner | `political-state saga/backend/src/controllers/boothImportController.js` |
| Owner routes | `political-state saga/backend/src/routes/superAdminRoutes.js` (L108–115) |
| Models | `models/BoothRollImport.js` · `models/Booth.js` · `models/Voter.js` |
| Read path | `controllers/voterProfileController.js` |

---

## 2. The five API steps

| # | Method | Path (saga) | Purpose |
|---|---|---|---|
| 1 | `POST` | `/booth-imports` | Create session from the summary file → `import_id`, `expected_parts` |
| 2 | `POST` | `/booth-imports/:id/parts` | Stage a batch of booth files (repeat until done) |
| 3 | `GET` | `/booth-imports/:id` | Progress / `missing_parts` |
| 4 | `POST` | `/booth-imports/:id/commit` | Go live atomically |
| 5 | `DELETE` | `/booth-imports/:id` | Abort + sweep staged rows |

Plus `GET /booth-imports` (panel overview + dropdown source) and
`PUT /booth-imports/:id/year` (label a roll imported before `roll_year` existed).

Nothing is visible to the tenant app until step 4.

---

## 3. Stage 0 — file selection & client-side parsing

Happens entirely in the browser. The files never travel as files.

- **Summary file** — must be a non-empty JSON array whose rows carry a `part`
  field. Rejected in the UI otherwise.
- **Booth files** — only names matching `^(\d+)\.json$` are accepted; everything
  else (including `<seat>.summary.json` itself when a whole folder is picked) is
  reported as *"Ignored N file(s) not named like 1.json"* rather than silently
  dropped.
- **Roll year** — required. The ECI export loses the year once flattened to
  `part / locality / electors`, so if it is not stated here it is gone for good
  and 2024 becomes indistinguishable from 2025.

Batching constants (`BoothDataManager.jsx`):

```
PARTS_PER_BATCH  = 10      // ~10 booths × ~900 voters ≈ 1.2 MB of JSON
CONCURRENCY      = 3
RETRY_BACKOFF_MS = [0, 1500, 5000]
```

---

## 4. Stage 1 — create the session (`createImport`)

The security-critical step.

1. **`roll_year` validated** — integer, `1990 … currentYear + 1`. Missing → `400`.
2. **`resolveTenantSeats(tenantId)`** builds the list of assembly constituencies
   this tenant may hold a roll for, from **the tenant's own
   `location_config.assembly_segments`** resolved against the state map:
   - state-level tenant → every AC in the state
   - MP-seat tenant → its 17 segments
   - MLA tenant → its single AC
   - configured before `assembly_segments` existed → re-derived via
     `mapRef.resolveConstituency()` rather than falling back to all seats
3. **The posted `constituency_key` is re-resolved and then discarded.** The name
   and key that get stored come from the state map, never from the browser. A
   seat outside the tenant's area → `403`. *This is what makes it impossible to
   aim an import at another tenant's seat.*
4. **Name-collision handling** — where two different seats share a name once the
   reservation marker is stripped (AP: Prathipadu / Prathipadu (SC), Gannavaram),
   the district is appended to the key so they cannot share one roll.
5. **Summary rows normalized** — `part` must be a positive number, duplicates
   dropped; bad rows returned as `duplicate_or_invalid_summary_rows`.
6. **`expected_parts` = exactly what the summary lists.** Deliberately *not*
   assumed contiguous — Kuppam skips part 43, Mangalagiri skips 285.
7. Candidate is looked up but **optional** — a seat can hold a roll with no
   candidate record.

Session written to `booth_roll_imports` with `status: 'staging'`.

**Response** → `{ import_id, expected_parts, total_expected, … }`

---

## 5. Stage 2 — stage the booth files (`uploadParts`)

**Client:** drops any file whose part number is not in `session.expected_parts`
*before sending anything* — this is what catches "Kuppam summary + Mangalagiri
folder". Then batches of 10, 3 in flight, 3 attempts each with backoff.

**Server guards per part:**

| Guard | Result |
|---|---|
| Unreadable part number | rejected |
| Part not in `expected_parts` | rejected |
| `voters[]` missing / not an array | rejected |
| `> MAX_VOTERS_PER_PART` (5000) | rejected |
| `> MAX_PARTS_PER_BATCH` (40) in one request | `413` |

### The conversion (source JSON → `booth_voters` document)

| Source field | Stored as | Transform |
|---|---|---|
| `name` | `name`, `name_lc` | trimmed + lowercase copy for search |
| `relation` | `relation`, `relation_lc` | same |
| `house_no` | `house_no`, `house_no_lc` | same |
| `age` | `age` | `Number()` or `null` (6,780 Kuppam rows are null) |
| `gender` | `gender` | normalized → `Male / Female / Third / Other / Unknown` (source has both "Others" and "Other") |
| `sl` | `sl` | `Number()` or `null` |
| `voter_id` | `voter_id` | as-is; **not unique** (7,925 Kuppam rows repeat one) and **not required** (2,027 are `""`) |
| — | `tenant_id`, `constituency_key`, `import_id`, `part` | **injected server-side from the session**, never from the payload |

Schema constraints are deliberately loose because the ECI Final Roll export is
dirty — validated against real Kuppam data. Dirt is normalized on the way in
rather than rejected at the DB layer.

### Write per part

```
deleteMany({tenant_id, constituency_key, import_id, part})   // re-send must not duplicate
insertMany(docs, chunks of INSERT_CHUNK = 2000, ordered:false)
on error → deleteMany the part again (clean rollback) + push to rejected[]
```

Each part is written independently, so **one bad booth costs one booth**, not the
whole batch of ten.

### Metrics — computed once, here

`computeBoothMetrics()` does a single pass per booth and produces:
gender counts · age brackets (18-29 / 30-44 / 45-59 / 60+ / unknown) ·
avg + median age · young & senior share · household count + avg per household ·
sex ratio (females per 1,000 males).

Stored on the session as `metrics_by_part.<part>` — so drill-down never rescans
~900 voter rows.

### Concurrency safety

The session document is updated with **one atomic operator set**:

```js
$addToSet: { received_parts: { $each: acceptedParts } }
$inc:      { voters_staged: stagedThisBatch }
$set:      { 'metrics_by_part.<part>': … }
$push:     { rejected: { $each: rejected, $slice: 200 } }
```

A `save()` of the whole document would let the 3 parallel batches clobber each
other's `received_parts`. That trap is explicitly avoided.

---

## 6. Stage 3 — read back, then Stage 4 — commit (`commitImport`)

The client re-reads `GET /booth-imports/:id` before committing. If any part is
missing it shows a confirm with the failure reasons and offers to leave the
session **staged for Resume** instead.

Commit sequence:

1. **Find the roll being superseded** — matched on
   `(constituency_key, roll_year, status: 'committed')`. Not on candidate, not on
   constituency alone. Re-importing 2026 replaces **only** 2026; the 2024 roll is
   a separate historical record and survives for year-over-year diffing.
2. **Merge** `summary` rows + `metrics_by_part` → `booths` documents
   (`deleteMany` this `import_id`, then `insertMany` in chunks of 500).
   Missing parts still get a Booth row with `voter_count: 0`.
3. **The flip** — `status = 'committed'`, `committed_at = now`.
   *Everything above this line was invisible. This single write makes the roll live.*
4. **Mirror onto `Candidate.booth_data`** — booth summaries only, no voters —
   so the pre-existing tenant endpoint keeps working. Written **only if no newer
   year exists**, so back-filling 2024 after 2026 cannot overwrite live figures.
   Seats without a candidate are still fully stored in `booths` / `booth_voters`.
5. **Purge the superseded roll** — its `booth_voters` + `booths` deleted, its
   session marked `aborted`.
6. Return the summary the panel displays: booths updated, booths with roll, total
   voters, missing parts, purged rows.

`?allow_partial=true` is required to commit with missing parts (the UI always
sends it, gated behind the confirm dialog).

---

## 7. Stage 5 — abort & resume

- **Abort** (`DELETE`) — deletes staged `booth_voters` + `booths` for that
  `import_id`, marks the session `aborted`. A committed import cannot be aborted.
- **Resume** — sends **only the parts still missing**, into the *same* session.
  Re-running the normal upload would open a NEW session and orphan everything
  already staged, so the two code paths are kept distinct. The operator must
  re-select the files (the browser cannot re-read them on its own).
- **Set year** (`PUT …/year`) — for rolls imported before `roll_year` existed.
  Rejects a year that collides with another retained roll for the seat, and keeps
  the denormalized `roll_year` on the booth rows in step.

---

## 8. Where the data lands

`TENANT_DB_MODE` is unset → **`shared`** mode (`config/tenantConnections.js`).
All tenants share one database; isolation is by the `tenant_id` field. The
per-tenant-database machinery (`tenantModel` proxy + `runWithTenant` on the
`:tenantId` router param) is fully wired and ready but not switched on.

| Collection | Model | Rows (Kuppam) | Contents |
|---|---|---|---|
| `booth_roll_imports` | `BoothRollImport` | 1 | Session: expected/received parts, summary verbatim, `metrics_by_part`, `roll_year`, `roll_label`, status |
| `booths` | `Booth` | 242 | One per polling station: ECI summary row + precomputed `metrics` + `voter_count` + denormalized `roll_year` |
| `booth_voters` | `Voter` | 219,284 | One document per elector |

Plus **`Candidate.booth_data`** — a denormalized mirror of the booth summaries
(no voters), purely so the existing `/voter-profiles/:constituency/booths`
endpoint keeps working unchanged.

Voters can never live on the Candidate document — ~250k rows blows the 16 MB BSON
limit. That is exactly why the three-collection design exists.

**Indexes**

```
booths        { tenant_id, constituency_key, import_id, part }  UNIQUE
              { tenant_id, constituency_key, roll_year, part }
booth_voters  { tenant_id, constituency_key, import_id, part, sl }   ← primary read path
              { tenant_id, constituency_key, import_id, voter_id }
imports       { tenant_id, constituency_key, status }
              { tenant_id, constituency_key, roll_year, status }
              { status, created_at }                                 ← intended for a sweeper
```

**Read path** — `voterProfileController.js` reads `Booth` / `Voter` by the
`import_id` of a **committed** import, not from `Candidate.booth_data`. So staged
rows are genuinely invisible, and a seat without a candidate still works. Year
comparison reads two `import_id`s and diffs.

---

## 9. Tenant isolation

Every DB operation on this path is tenant-scoped, via `withTenant(req, …)` or an
explicit `tenant_id: req.tenantId`:

| Handler | Scoped operations |
|---|---|
| `createImport` | candidate lookup ✓ · session create carries `tenant_id` ✓ |
| `uploadParts` | session lookup ✓ · voter `deleteMany` ✓ · inserted docs carry `tenant_id` ✓ · session update ✓ |
| `commitImport` | session ✓ · previous-roll lookup ✓ · booth delete + insert ✓ · candidate ✓ · `newerExists` ✓ · purge ✓ · count ✓ |
| `abortImport` | voter + booth delete ✓ |
| `setImportYear` | session ✓ · clash check ✓ · booth update ✓ |
| `listImports` | committed ✓ · voter aggregate `$match` ✓ · candidates ✓ · staging ✓ |

`req.tenantId` is set by `actAsTenant()`; `withTenant` **fails closed** to a
`__NO_TENANT__` sentinel if it is ever missing — returning nothing rather than
everything.

Combined with the Stage-1 seat re-resolution, there is no path by which one
tenant's roll reaches another tenant's rows or seat list.

---

## 10. Known gaps

| # | Gap | Impact | Fix |
|---|---|---|---|
| 1 | `listImports` counts voters with `$match {tenant_id, import_id:{$in:[…]}}` + `$group` on **every panel load** | A whole-state tenant at 175 seats × ~220k scans ~40M docs per page open; `import_id` alone is not an index prefix | Persist the committed voter total on the `BoothRollImport` doc at commit and read that |
| 2 | **No sweeper for abandoned staging sessions** — the `{status, created_at}` index exists for it, but no cron/queue/worker uses it | A closed tab mid-upload leaves ~9k orphan `booth_voters` rows per landed batch, permanently | Scheduled job: abort `staging` sessions older than N hours |
| 3 | The 10 MB proxy cap is the tightest link and only respected by convention | Server allows 5000 voters/part × 10 parts/batch → a dense-booth seat can exceed 10 MB → `413`, retried 3× identically, then permanently failed for those booths | Size the batch by estimated bytes, not by count |
| 4 | `abortImport` deletes on `{tenant_id, import_id}` — no `constituency_key`, so no compound-index prefix | Correct but scans the tenant's whole voter set | Add `constituency_key` to the filter |
| 5 | `createImport` has no same-year duplicate guard (`setImportYear` does) | A second 2026 session can be started and silently supersedes the first at commit — intentional ("re-uploading the same year replaces it") but unconfirmed | Warn in the UI when the seat already has that year |
| 6 | `YearSetter` receives an `importId` prop it never uses | None — dead prop | Remove |

---

## 11. Quick reference — end-to-end for the screenshot's Kuppam run

```
1  UI    242 booth files + kuppam.summary.json parsed in browser, year 2026
2  POST  /booth-imports        → seat re-resolved to "Kuppam" (CHITTOOR, AC 294)
                                 import_id issued, expected_parts = 242 entries
3  POST  /parts × 25 batches   → 219,284 voter docs, 3 concurrent, metrics per booth
4  GET   /booth-imports/:id    → missing_parts = []
5  POST  /commit               → 242 booths written, status flipped to committed,
                                 Candidate.booth_data mirrored, prior 2026 roll purged
6  UI    "Roll is live for Kuppam · 242 booths · 219,284 voters · 0 missing"
```
