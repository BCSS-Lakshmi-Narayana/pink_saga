# BRS / Telangana (SANKET) — where this build stands

**As of 2026-10-01.** Work paused here to return to Chhattisgarh. This file is the handoff: what is finished, what is blocked, what is still wrong, and what has to be decided by a person.

Numbers below were read from the files on the date above, not recalled.

---

## 1. The one thing to know before touching anything

**This client is in OPPOSITION.** Every earlier deployment of this codebase (Chhattisgarh, Goa, and the Bandi Sanjay build before them) was ruling-party, and the code collapsed two statements that are identical for a ruling party and opposite for this one:

> "this implicates the government" **≠** "this damages the client"

Telangana is governed by the Congress under CM Revanth Reddy. BRS attacks that government. So an unattributed complaint about potholes is mildly *good* news for us, government press output is the *rival's* voice, and `ally` does not mean "the administration".

Do not port a change from the Chhattisgarh tree into this one without checking which of those two statements it assumed. The inversions are listed in §3.

---

## 2. Done and verified

### Backend configuration
| File | State |
|---|---|
| `src/config/politicalData.js` | Rewritten. `OUR_PARTY` = BRS, `role: 'opposition'`, `in_power: false`. `CABINET_MINISTERS` → `OUR_FRONTBENCH` (BRS holds no portfolios); added `PARTY_CHIEF`, `RULING_MINISTERS`, `DEFECTED_MLAS` |
| `src/config/politicalEntities.js` | 177 entities. `STATE_GOVERNMENT_ENTITY` flipped to Congress/opposition. Schemes carry `built_by` so Kaleshwaram (ours) and Rythu Bharosa (theirs) attract opposite stances |
| `src/config/deployment.js` | `APP_NAME = 'SANKET'`; `CLIENT_DESCRIPTION` names the adversary explicitly so a model cannot drift into the wrong frame |
| `src/services/stanceEngine.js` | `civicVerdict` reads `OUR_PARTY.in_power` instead of assuming we govern |
| `src/controllers/cmDashboardController.js` | Government handles moved `owned` → `opposition`; adversary roster folded into the opposition set |

### Data (all counts read 2026-10-01)
- `state_voter_profiles.json` — **119** seats (ECI ST1028 + ADR affidavits on 116)
- `state_ac_electors.json` — **119** seats
- `state_mlas.json` — **119**
- `state_geo.json` — **33** districts
- `sources_list.json` — **34**, each X handle resolved live before inclusion
- `state_leader_handles.json` — verified against `api.fxtwitter.com`; `@NRamchanderRao` **rejected** (2 followers, bio "sining")
- `state_adversary_handles.json` — **20** adversaries + the deleted `@SandhyaRaoBRS` impersonation record. See `docs/ADVERSARY_HANDLES.md`

### Blura-Engine
- `political_config.py` — **99** RSS feeds, 33 districts, `PRIORITY_LANGUAGES=('te',)`
- `political_rss.py` — sentiment prompt rewritten for an opposition client (it previously defined BJP Chhattisgarh as ALLY); Telugu / romanised-Telugu / Urdu / Hindi detection
- Smoke-tested on live feeds, not just compiled

### Branding
Renamed to **SANKET** (Social Analytics, Network Knowledge & Engagement Trends). Neither the client party nor the vendor may appear as the application name. Blue Cloud / BCSS logo removed from navbar, Events reports, YouTube PDF export and `.xlsx` metadata; `Logo.png` and `BCSS_logo.png` taken out of `frontend/public/`.

### Tests — 474 assertions, all green, no database needed
```bash
cd backend
for t in verify_clone test_adversary_handles test_stance_engine test_sentiment_pipeline \
         test_hashtags_schemes test_relevance_filter test_leader_popularity \
         test_stage3_input test_emoji_display_parts; do
  printf "%-28s " "$t"; node "scripts/$t.js" 2>&1 | grep -E "passed|failed" | tail -1
done
```
Expected: 46, 129, 63, 64, 37, 54, 37, 25, 19.

**A green `npm run build` proves nothing** — craco drops `no-undef`. Lint separately:
```bash
npx eslint src --no-eslintrc --parser-options=ecmaVersion:2022 \
  --rule '{"no-undef":"error"}' --env node,es2022
```
Expected: exactly **4** errors, all inherited (see §5).

---

## 3. Bugs found by porting the tests — the pattern to expect

Each of these was invisible: nothing threw, nothing failed to build, the numbers were just wrong.

1. **`civicVerdict` assumed the client governs.** Its own comment was right — "a service-failure complaint implicates the RULING government" — but the code jumped straight to `anti_target`, which only follows if the client *is* that government. Every unattributed civic grievance, a large share of the corpus, carried the wrong sign.
2. **Organised rival output was counted as public opinion.** `classifyVoice` falls through to `organic` for unknown handles, and the registry held ~one handle per party. `@IYCTelangana` — 175,553 posts to 54,121 followers — was landing in the organic bucket, so the rival's posting schedule became our sentiment trend.
3. **`CIVIC_COMPLAINT_MARKERS` and `CEREMONIAL_RX` had no Telugu at all**, so Telugu complaints and tributes never triggered their rules in a Telugu-speaking state.
4. **LS/AC name collision.** 12 Telangana seats share a name between Lok Sabha and Assembly; MPs in the leader arrays poisoned `CURATED_AC_KEYS` and deleted 12 MLAs, 4 of them ours. Fixed with a declarative `house: 'parliament'` flag — role-string inference was wrong in both directions ("Union Minister; MP, Secunderabad" doesn't start with "MP"; "MLA, Dubbak; former MP" contains it).

### Three Telangana facts that are easy to get wrong
- **"TRS" is a three-way collision**: BRS's pre-2022 name, *and* K. Kavitha's new Telangana Rakshana Sena, *and* the legacy `@trspartyonline`. Kavitha was expelled Sep 2025 and now has **1.31M followers — more than @BRSparty's 945K**. Any rule mapping bare "TRS" to BRS files her attacks as our own voice.
- **BRS has 36 MLAs de jure, 27 de facto**, after the Speaker dismissed the disqualification petitions on 11 Mar 2026.
- **`bsk_*` is a legacy DB prefix meaning "the client"**, from the Bandi Sanjay deployment. Do not rename it — and do not infer alignment from it. Bandi Sanjay is a *rival* here.

---

## 4. Blocked on you

### a. Database — URI is configured, existence unverified
`backend/.env` points at `mongodb://brssaga_app:***@32.192.131.130:27017/brssaga?authSource=brssaga`, `DB_NAME=brssaga`. Whether that database and user actually exist on the server has not been checked from here. Confirm before seeding:
```bash
cd backend && node -e "require('dotenv').config();require('mongoose').connect(process.env.MONGODB_URI,{dbName:process.env.DB_NAME}).then(c=>{console.log('connected:',c.connection.name);process.exit(0)}).catch(e=>{console.error('FAILED:',e.message);process.exit(1)})"
```

Then, in order:
```bash
npm run seed:rbac
npm run seed:constituencies
npm run seed:sources                            # media + party accounts
npm run seed:sources -- --with-leaders          # leaders' X accounts
npm run seed:sources -- --with-adversaries --dry-run   # inspect before committing quota
npm run seed:keywords
```
`--with-adversaries` adds 20 accounts, each costing API quota every run. Consider starting with the Congress tier only.

### b. 🔴 The party logo is currently the BJP lotus
`frontend/public/party-logo.png` **and** `party-logo.svg` are both the saffron-and-green BJP lotus, inherited from Chhattisgarh. They are live right now as the favicon, the `og:image`, the page-loader mark, and the logo on both printable reports. **A BRS deployment is shipping a rival party's symbol.** Highest-priority asset fix.

### c. Missing image and font files
`frontend/public/` currently has none of these. The UI degrades to a neutral placeholder rather than breaking, so this is not urgent — but it is why the login page looks unfinished.

| File | What |
|---|---|
| `leader-portrait.jpg` | KCR |
| `leader-portrait-2.jpg` | KTR |
| `party-logo.png` / `.svg` | **replace the BJP lotus** |
| `party-flag.jpg` | BRS flag, decorative |
| `state-1.jpg` … `state-4.jpg` | Charminar, Golconda, Ramappa, Secretariat |
| `fonts/NotoSansTelugu-Regular.ttf` | `fonts/` holds only a README. Without this, Telugu renders as boxes in PDF exports — `YouTubeMonitor.js` already warns and falls back to CSV |

Per your instruction, nothing fetches images from a remote host at page load. All paths are local. Dropping the files in is the whole job — no code change.

Also in `public/`: `cm-portrait.jpg` is an unreferenced Chhattisgarh leftover, safe to delete.

### d. Run the Grok prompts
`docs/ADVERSARY_HANDLES.md` has three ready prompts: discover anonymous anti-BRS accounts (the gap profile data cannot fill), confirm the 20 already listed actually post against BRS, and find handles for 9 office-bearers whose accounts could not be established. Fold answers back in only after `api.fxtwitter.com` confirms each one — that check is what caught the fake Ramchander Rao account.

---

## 5. Open decisions and accepted debt

| Item | Status |
|---|---|
| **Gajwel district** | ECI roster says Medak (2008 delimitation), towns data says Siddipet (post-2016 districts). Both defensible. Needs an editorial call — currently filed under Medak with the conflict documented in `partyMedia.js` |
| **4 inherited `no-undef`** | `localStorage` (apDashboardController:1142), `log` (aiAnalysisService:115), `rapidApiKey` (monitorService:2220), plus one parse error. **Identical in Chhattisgarh** — left alone deliberately so the two trees stay comparable. Fix in both or neither |
| **`Blura-Engine/.venv`** | 1.1 GB, Chhattisgarh-era. Flagged, not deleted — deleting someone's virtualenv is their call |
| **Docs are still Chhattisgarh-era** | `README.md`, `ARCHITECTURE.md`, `docs/SENTIMENT_ANALYSIS.md` describe the CG deployment in substance, not just in title. Renaming the headings would make them *look* current while staying wrong, so they were left for a proper pass |

---

## 6. Returning to this after Chhattisgarh

1. Re-run the suite in §2. If it is not 474/474, something drifted — start there.
2. Run the lint in §2. If it is not exactly 4 errors, a rename broke a reference. That is how the `seed_sources.js` break was found: it still destructured `CABINET_MINISTERS`, which this build renamed to `OUR_FRONTBENCH`, so `npm run seed:sources -- --with-leaders` threw `not iterable`. Nothing surfaced it until someone read the file.
3. Anything brought over from the Chhattisgarh tree must be re-read against §1 before it is applied here.
