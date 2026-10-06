# Chhattisgarh Political Watch

Social-media and news intelligence for **BJP Chhattisgarh** and the Government
of Chhattisgarh (Chief Minister Vishnu Deo Sai). It tracks mentions,
sentiment, alerts and grievances across X, YouTube (including live chat),
Facebook, Instagram, Telegram and the Chhattisgarh press. Sentiment is the
post's own tone; the **stance** label is relative to the client: an attack on
the Congress opposition is shown as negative sentiment and **pro client**, and
praise for it as positive sentiment and **anti client**.

The codebase is a clone of Goa Political Watch (itself a clone of
AP.Blura.Saga). Code is kept as close to the Goa build as possible so a fix
can be applied to both; everything state-specific lives in the data and config
files listed below. See [ARCHITECTURE.md](ARCHITECTURE.md) for the system
design and [docs/SENTIMENT_ANALYSIS.md](docs/SENTIMENT_ANALYSIS.md) for the
sentiment pipeline. The other root-level `.md` files are analyses from earlier
deployments, kept for reference.

## Layout

| Folder | What it is |
|---|---|
| `frontend/` | React (CRA + craco) SPA. Branding lives in `src/config/partyMedia.js`, party colours in `src/config/partyColors.js`, the roster in `src/data/stateMLAs.js` / `stateMPs.js` (generated). |
| `backend/` | Node/Express API and background jobs. Deployment facts are in `src/config/deployment.js`, the political roster in `src/config/politicalData.js` → `politicalEntities.js`, locations in `src/config/stateLocations.js`, and the state datasets in `src/data/state_*.json`. |
| `Blura-Engine/` | Python RSS engine (116 Hindi, English and district feeds) that writes into the same MongoDB. Config is in `political_config.py`. |

## Setup

1. **MongoDB.** Use a dedicated database called `cgsaga` with its own user,
   scoped to that database only (see
   [MONGODB_OPERATIONS.md](MONGODB_OPERATIONS.md)). Never point this app at
   the Goa database. `backend/.env` already expects user `cgsaga_app`; create
   it with the password that file contains.
2. **`backend/.env`.** Ports are 8001 (backend) and 3001 (frontend), so this
   copy runs side by side with Goa (8000/3000). At a minimum, check:

   | Key | Notes |
   |---|---|
   | `MONGODB_URI`, `DB_NAME="cgsaga"` | |
   | `JWT_SECRET` | Long random string, different from Goa's. |
   | `DEFAULT_ADMIN_EMAIL`, `DEFAULT_ADMIN_PASSWORD` | First superadmin. If no password is set, a random one is printed once at first start; existing users are never overwritten. |
   | `CORS_ORIGINS`, `PORT`, LLM / RapidAPI / BluGate keys | As in the existing file |
   | `AWS_S3_FOLDER` | `cgsaga-uploads`, kept apart from Goa's uploads. |

3. **`Blura-Engine/`.** The engine reads `.env.political` and falls back to
   `backend/.env`. Install it with `pip install -r requirements.txt`. Set
   `COHERE_API_KEY` to turn on LLM sentiment for articles.
4. **Seed** (from `backend/`):

   ```
   npm run seed:constituencies   # 90 ACs, 33 districts, 11 Lok Sabha seats
   npm run seed:rbac             # page permissions (+ optional senior_leader from env)
   npm run seed:accounts         # one login per MLA / MP, random passwords printed once
   npm run seed:sources          # 104 verified media, government and party accounts
   npm run seed:keywords         # Chhattisgarh tracking keywords, then one fetch
   ```

5. **Run.**
   - Backend: `npm run dev`, from `backend/`.
   - Frontend: `npm start`, from `frontend/`.
   - Engine: `python political_main.py`, from `Blura-Engine/`. Add `--once` for a single pass.
6. **Test.**
   - Backend: `npm run test:sentiment`, from `backend/`.
   - Frontend: `npx craco test --watchAll=false`, from `frontend/`.

## Keeping the political data current

The roster is a snapshot as of **26 Sep 2026**:

- **Assembly (90 seats):** BJP 54, INC 35, GGP 1. No vacancies. BJP governs alone (no coalition partner).
- **Since the Dec 2023 election:** Raipur City South by-election (13 Nov 2024) won by Sunil Kumar Soni (BJP) after Brijmohan Agrawal moved to the Lok Sabha; cabinet expanded on 20 Aug 2025 (Gajendra Yadav, Rajesh Agrawal, Guru Khushwant Saheb).
- **Lok Sabha (11):** BJP 10, INC 1 (Korba). **Rajya Sabha (5):** BJP 2, INC 3.
- **Districts:** 33, including the five created in 2022.

After a by-election, defection or cabinet reshuffle, update the data in this order:

1. Edit `backend/src/data/state_mlas.json` and `state_voter_profiles.json`.
2. If the cabinet or party leadership changed, edit the curated lists in
   `backend/src/config/politicalData.js`, and handles in
   `backend/src/data/state_leader_handles.json` (with a source). Add any new
   spellings to `CURATED_ALIASES` in `politicalEntities.js`. Never add a bare
   surname or nickname: Sai, Sao, Baghel, Singh, "Kaka" and "Baba" are shared
   by many people.
3. Regenerate the frontend roster with `node frontend/scripts/gen_state_data.js`.
4. Only if boundaries change, rebuild the maps with
   `node frontend/scripts/build_state_geojson.js`. This needs network access
   and runs mapshaper through npx.
5. Run `npm run test:sentiment`.

## Known limitations

- The Chhattisgarhi (Devanagari and romanised) aliases and sentiment lexicons
  were written by hand. They need review by a native speaker.
- AC-wise electors are the 2023 election rolls; the 2026 roll is published
  only by district.
- District map edges are the ACs dissolved by district, so they are
  approximate where the 2022 districts cut across a constituency.
- jsPDF does not shape Devanagari, so conjuncts can render incorrectly in PDF
  exports. Use the CSV export for Hindi or Chhattisgarhi text.
- The RAG embedding model was validated on earlier deployments' languages.
  Re-check its recall on Hindi and Chhattisgarhi before relying on it.
- The leader portraits are Wikimedia Commons images (GODL-India). Credit them
  as their licence requires (see `frontend/src/config/partyMedia.js`).
- The legal-notice template (`pages/GenerateReport.jsx`) ships with
  bracketed placeholders for the issuing office. Fill them in per notice.
