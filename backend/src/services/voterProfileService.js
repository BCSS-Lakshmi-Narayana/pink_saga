/**
 * voterProfileService
 * ─────────────────────────────────────────────────────────────────────
 * Read-only reference layer over verified public election data for all
 * 119 Telangana assembly constituencies (2023 Assembly election; current
 * MLAs as of Sep 2026).
 *
 * Sources (see each record's data_sources field):
 *   - 2023 candidate-level results: ECI Form-21E / index cards published by
 *     CEO Telangana, cross-checked against Wikipedia's 2023 Telangana
 *     election results table.
 *   - Lok Sabha / SC-ST reservation: Delimitation Order, 2008 (Schedule VII).
 *     Districts: the 33 current districts, as ECI grouped the 2023 election.
 *   - MLA bio fields (criminal cases, education, assets, liabilities): ADR /
 *     myneta.info 2023 affidavits (none for the two by-poll winners or the
 *     by-election winner). Vacant seats carry `mla: null` and a `vacancy` object.
 *   - Electors: 2023 general electors from the ECI index cards (AC-wise
 *     figures for the 2026 roll are not published).
 *
 * NOT included because no genuine public dataset exists at this
 * granularity — see mlaReferenceService for the same caveat:
 *   - 2013/2018 historical results (flagged as pending, not fabricated)
 *   - Age-group distribution, household count, SC/ST/OBC population %,
 *     religion breakdown, booth-level data, village-panchayat lists
 */

const RAW_VOTER_PROFILES = require('../data/state_voter_profiles.json');
const VERIFIED_ELECTORS = require('../data/state_ac_electors.json');
const SOCIOECONOMIC_LATEST = require('../data/state_socioeconomic_latest.json');

const normalizeConstituencyKey = (name) =>
  String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // "Taleigão" → "taleigao", not "taleigo"
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .trim();

// Merge verified gender-split elector counts onto each profile, keyed by AC
// NUMBER (not name), which stays safe even in states with duplicate AC names.
// Also merge the latest available socio-economic indicators (PLFS 2023-24) —
// state-level only, so every AC shows the same statewide figures; see
// SOCIOECONOMIC_LATEST._meta.
const SE = SOCIOECONOMIC_LATEST.statewide;
const VOTER_PROFILES = RAW_VOTER_PROFILES.map((p) => {
  const e = VERIFIED_ELECTORS[String(p.ac_number)];
  return {
    ...p,
    electors_male: e ? e.electors_male : null,
    electors_female: e ? e.electors_female : null,
    electors_other: e ? e.electors_other : null,
    electors_total: e ? e.electors_total : null,
    electors_source: e ? e.source : null,
    socio_economic: {
      ...SE,
      vintage: SOCIOECONOMIC_LATEST._meta.vintage,
      granularity: SOCIOECONOMIC_LATEST._meta.granularity,
      source: SOCIOECONOMIC_LATEST._meta.source,
    },
  };
});

const PROFILE_BY_KEY = VOTER_PROFILES.reduce((acc, p) => {
  acc[p.key] = p;
  return acc;
}, {});

const getAllVoterProfiles = () => VOTER_PROFILES;

// Alias-aware, so "Vasco", "Madgaon" or "Marmagao" find the same profile the
// MLA lookup does.
const getVoterProfileByConstituency = (name) => {
  const key = normalizeConstituencyKey(name);
  if (PROFILE_BY_KEY[key]) return PROFILE_BY_KEY[key];
  const resolved = require('./mlaReferenceService').resolveConstituencyKey(name);
  return (resolved && PROFILE_BY_KEY[resolved]) || null;
};

/** Which sections of the standard 9-part voter-profile spec are populated vs pending, for UI messaging. */
const DATA_COVERAGE = {
  electoral_profile: 'partial', // total votes polled yes; registered electors/M-F split/polling stations pending per-seat sourcing
  demographic_profile: 'pending',
  community_social_profile: 'unavailable', // not published by any official source at AC granularity
  socio_economic_profile: 'statewide', // latest (PLFS 2023-24), state-level not per-AC
  geographic_profile: 'partial', // district + taluka + Lok Sabha yes; villages/wards pending
  election_intelligence: 'partial', // 2023 full results yes; 2013/2018 pending
  public_issues_profile: 'derived', // comes from the grievance/sentiment pipeline, not this dataset
  booth_level_profile: 'unavailable',
  citizen_engagement_metrics: 'unavailable',
};

module.exports = {
  VOTER_PROFILES,
  normalizeConstituencyKey,
  getAllVoterProfiles,
  getVoterProfileByConstituency,
  DATA_COVERAGE,
};
