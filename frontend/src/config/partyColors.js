/**
 * Party palette for Telangana — the single source for every party colour in the UI
 * (maps, badges, dots, comparison cards). Keys are the party codes used in
 * src/data/stateMLAs.js and the backend roster.
 *
 * BRS is pink, the colour it is actually known by ("gulabi party"). INC is sky
 * blue and BJP saffron, as on their flags. AIMIM is green, as on theirs. The
 * communists are reds, distinguished by depth.
 *
 * TRS(K) — K. Kavitha's Telangana Rakshana Sena — is deliberately NOT pink,
 * despite being a BRS breakaway whose branding echoes it. On a map, a near-pink
 * would read as BRS at a glance, which is the one mistake this palette must not
 * make; violet keeps the two unmistakable. That is a UI choice, not the party's
 * own colour.
 */
export const PARTY_PALETTE = {
  BRS:      { hex: '#EC4899', soft: '#FCE7F3', text: '#9D174D', ring: '#F472B6', grad: 'from-pink-400 to-pink-600', badge: 'bg-pink-100 text-pink-700 border-pink-300', dot: 'bg-pink-500' },
  INC:      { hex: '#0EA5E9', soft: '#E0F2FE', text: '#075985', ring: '#38BDF8', grad: 'from-sky-400 to-sky-600', badge: 'bg-sky-100 text-sky-700 border-sky-300', dot: 'bg-sky-500' },
  BJP:      { hex: '#F97316', soft: '#FFEDD5', text: '#9A3412', ring: '#FB923C', grad: 'from-orange-400 to-orange-600', badge: 'bg-orange-100 text-orange-700 border-orange-300', dot: 'bg-orange-500' },
  AIMIM:    { hex: '#16A34A', soft: '#DCFCE7', text: '#166534', ring: '#22C55E', grad: 'from-green-500 to-green-700', badge: 'bg-green-100 text-green-700 border-green-300', dot: 'bg-green-600' },
  CPI:      { hex: '#DC2626', soft: '#FEE2E2', text: '#991B1B', ring: '#EF4444', grad: 'from-red-500 to-red-700', badge: 'bg-red-100 text-red-700 border-red-300', dot: 'bg-red-600' },
  CPM:      { hex: '#B91C1C', soft: '#FEE2E2', text: '#7F1D1D', ring: '#DC2626', grad: 'from-red-700 to-red-900', badge: 'bg-red-100 text-red-800 border-red-400', dot: 'bg-red-700' },
  'TRS(K)': { hex: '#7C3AED', soft: '#EDE9FE', text: '#5B21B6', ring: '#8B5CF6', grad: 'from-violet-500 to-violet-700', badge: 'bg-violet-100 text-violet-700 border-violet-300', dot: 'bg-violet-600' },
  IND:      { hex: '#64748B', soft: '#F1F5F9', text: '#334155', ring: '#94A3B8', grad: 'from-slate-400 to-slate-600', badge: 'bg-slate-100 text-slate-700 border-slate-300', dot: 'bg-slate-500' },
  VACANT:   { hex: '#D4D4D8', soft: '#F4F4F5', text: '#52525B', ring: '#A1A1AA', grad: 'from-zinc-300 to-zinc-400', badge: 'bg-zinc-100 text-zinc-500 border-zinc-300 border-dashed', dot: 'bg-zinc-300' },
};

export const DEFAULT_PARTY_STYLE = PARTY_PALETTE.IND;

/**
 * Legend / tab order.
 *
 * ⚠ CLIENT FIRST, not government first. Ruling-party deployments led with the
 * governing party because that was also the client; here they are different
 * parties, and a BRS reader should not have to look past Congress to find
 * their own numbers.
 *
 * Only parties holding more than one seat appear. CPI and the lone Independent
 * (T. Raja Singh, Goshamahal) hold one each and would be a dead row in the map
 * legend; PARTY_PALETTE still carries every code so partyStyle() keeps working
 * wherever they turn up in data. TRS(K) holds no seat yet — it is in the
 * palette because it contests by-elections and appears in coverage.
 */
export const PARTY_ORDER = ['BRS', 'INC', 'BJP', 'AIMIM'];

export const PARTY_FULL_NAMES = {
  BRS: 'Bharat Rashtra Samithi',
  INC: 'Indian National Congress',
  BJP: 'Bharatiya Janata Party',
  AIMIM: 'All India Majlis-e-Ittehadul Muslimeen',
  CPI: 'Communist Party of India',
  CPM: 'Communist Party of India (Marxist)',
  'TRS(K)': 'Telangana Rakshana Sena',
  IND: 'Independent',
  VACANT: 'Vacant seat',
};

export const partyStyle = (party) =>
  PARTY_PALETTE[String(party || '').trim().toUpperCase()] || DEFAULT_PARTY_STYLE;
