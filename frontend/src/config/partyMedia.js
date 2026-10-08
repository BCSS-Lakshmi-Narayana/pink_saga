/**
 * SANKET — branding and media catalogue for the client: the Bharat Rashtra
 * Samithi (president K. Chandrashekar Rao; working president K. T. Rama Rao).
 *
 * ── THE PRODUCT NAME AND THE CLIENT NAME ARE SEPARATE ───────────────
 * SANKET is the platform. The BRS is who this instance watches over. They are
 * deliberately not merged in the chrome: the title bar, splash, navbar and
 * login masthead say SANKET alone, and the party appears one level down, as
 * the subject of the monitoring rather than as part of the product's name.
 * Keeping them apart is what lets the same build be re-pointed at another
 * client by editing `partyName`/`partyShort` without renaming the product.
 *
 * ⚠ THE CLIENT IS IN OPPOSITION. Copy here must not imply the party holds
 * office: KCR is a party president and a former Chief Minister, not a sitting
 * one, and Telangana is governed by the Congress.
 *
 * ── IMAGES ARE LOCAL, NOT REMOTE ────────────────────────────────────
 * Earlier deployments pulled portraits from Wikipedia's Special:FilePath at
 * runtime. This one does not: every image below is a path under /public, to be
 * supplied with the deployment. Nothing here reaches out to a third-party host
 * on page load, so the login screen and navbar cannot be broken by an upstream
 * file being renamed, relicensed or removed.
 *
 * FILES TO DROP INTO /public (until then the UI shows a neutral placeholder,
 * it does not break):
 *   /leader-portrait.png   — KCR
 *   /leader-portrait-2.jpg — KTR
 *   /party-logo.png        — BRS mark, used in the navbar and as og:image
 *   /party-flag.jpg        — BRS flag, decorative
 *   /state-1.jpg … /state-4.jpg — Telangana imagery for the login collage
 *
 * Re-branding for another client means editing this file, public/index.html,
 * and the data files in src/data — no page code needs to change.
 */

/* ─── App / client identity ─────────────────────────────────────── */
export const BRAND = {
  appName: 'SANKET',
  appShortName: 'SANKET',
  /** What the name stands for — used wherever there is room to expand it. */
  appFullName: 'Social Analytics, Network Knowledge & Engagement Trends',
  tagline: 'Social Analytics, Network Knowledge & Engagement Trends',
  partyName: 'Bharat Rashtra Samithi',
  partyShort: 'BRS',
  /** A state party — there is no separate state unit to name. */
  partyUnit: 'Bharat Rashtra Samithi',
  stateName: 'Telangana',
  leaderName: 'K. Chandrashekar Rao',
  /** Party post, NOT an office of state. */
  leaderTitle: 'President, Bharat Rashtra Samithi',
  constituencyCount: 119,
  lokSabhaCount: 17,
};

/* ─── Portraits of the client leadership ─────────────────────────── */
export const PARTY_PORTRAITS = [
  {
    id: 'portrait-primary',
    src: '/leader-portrait.png',
    alt: 'K. Chandrashekar Rao — President, Bharat Rashtra Samithi',
    caption: 'Party President · BRS',
  },
  {
    id: 'portrait-working-president',
    src: '/leader-portrait-2.jpg',
    alt: 'K. T. Rama Rao — Working President, Bharat Rashtra Samithi',
    caption: 'Working President · BRS',
  },
];

/* The "hero" image used across the app (login, header, dashboard avatar). */
export const PARTY_HERO = PARTY_PORTRAITS[0];

/* ─── Telangana imagery ─────────────────────────────────────────── */
export const STATE_GALLERY = [
  { id: 'tg-charminar',   src: '/state-1.jpg', alt: 'Charminar, Hyderabad',                caption: 'Charminar · Hyderabad' },
  { id: 'tg-golconda',    src: '/state-2.jpg', alt: 'Golconda Fort',                       caption: 'Golconda Fort · Hyderabad' },
  { id: 'tg-ramappa',     src: '/state-3.jpg', alt: 'Ramappa Temple, a UNESCO World Heritage site', caption: 'Ramappa Temple · Mulugu' },
  { id: 'tg-secretariat', src: '/state-4.jpg', alt: 'Telangana Secretariat, Hyderabad',    caption: 'Secretariat · Hyderabad' },
];

/* ─── Party visual marks ─────────────────────────────────────────── */
export const PARTY_MARK = {
  flag: '/party-flag.jpg',
  logo: '/party-logo.png',
};

/* ─── Local fallback served from /public ─────────────────────────── */
export const LOCAL_FALLBACK = '/leader-portrait.png';
export const LOCAL_LOGO = '/party-logo.png';

/* ─── Seats worth watching ───────────────────────────────────────────
 * Districts below are taken from the ECI roster in backend/src/data, not from
 * general knowledge — the two disagree in places. Note Gajwel is filed under
 * MEDAK there, following the pre-2016 district scheme the 2008 delimitation
 * used, although Gajwel mandal now sits in Siddipet district.
 */
export const KEY_CONSTITUENCIES = [
  { name: 'Gajwel',          district: 'Medak' },            // KCR
  { name: 'Sircilla',        district: 'Rajanna Sircilla' }, // KTR
  { name: 'Siddipet',        district: 'Siddipet' },         // Harish Rao
  { name: 'Khairatabad',     district: 'Hyderabad' },        // VACANT — by-election pending
  { name: 'Jubilee Hills',   district: 'Hyderabad' },        // lost to Congress, Nov 2025 by-poll
  { name: 'Kodangal',        district: 'Vikarabad' },        // CM Revanth Reddy (INC)
  { name: 'Chandrayangutta', district: 'Hyderabad' },        // Akbaruddin Owaisi (AIMIM)
];

/* ─── Lines the party is pressing ────────────────────────────────────
 * ⚠ An opposition party's talking points are ATTACK lines and legacy claims,
 * not delivery announcements. A ruling-party deployment lists what the
 * government is building; this lists what our side argues the government has
 * failed to do, plus the record we want remembered.
 */
export const FOCUS_TOPICS = [
  'Rythu Bharosa short of the promised Rs 15,000',
  'Farm loan waiver left incomplete',
  'Congress guarantees undelivered',
  'Unemployment and stalled job notifications',
  'Dharani replaced by Bhu Bharati — land record chaos',
  'HYDRAA demolitions and displacement',
  'Musi riverfront displacement',
  '42% BC reservation still stalled in court',
  'Defectors should resign and face the voters',
  "KCR's governance record — Mission Bhagiratha, Rythu Bandhu, Dalit Bandhu",
];
