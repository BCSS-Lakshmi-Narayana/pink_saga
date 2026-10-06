const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const normalizeKey = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .trim();

const userSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  full_name: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: [
      'superadmin',
      'super_admin',
      'party_leadership',
      'level-1',
      'level-2',
      'analyst',
      'viewer',
      'dial100',
      'mla',
      'mp',
      'constituency_manager',
      'senior_leader'
    ],
    default: 'level-1'
  },
  // Single primary constituency (AC name). Used for MLA / senior_leader roles.
  assigned_constituency: {
    type: String,
    default: null,
    trim: true
  },
  // Lok Sabha seat name. Used for MP role.
  assigned_lok_sabha: {
    type: String,
    default: null,
    trim: true
  },
  // Optional additional AC names the user is also allowed to see.
  // Super admin may grant extra access without changing the primary seat.
  extra_constituencies: {
    type: [String],
    default: []
  },
  // Normalised lookup keys auto-derived from the names above. We query against
  // these in the scope middleware so casing / punctuation differences don't
  // accidentally widen or narrow access.
  scope_keys: {
    type: [String],
    default: []
  },
  // Opt-in row-level scoping for roles that are NOT inherently scoped
  // (level-1, level-2, analyst, viewer, …). Those roles historically saw
  // every constituency, so we cannot narrow them wholesale without blanking
  // out every existing account. Instead the super admin flips this on when
  // onboarding the user with a seat assignment; anyone left at false keeps
  // the legacy state-wide view. Inherently scoped roles (mla / mp /
  // senior_leader / constituency_manager) ignore this field entirely.
  is_scoped: {
    type: Boolean,
    default: false
  },
  is_active: {
    type: Boolean,
    default: true
  },
  // Audit-trail fields, surfaced in the super-admin console next to each
  // scoped login so admins can spot stale or never-used accounts.
  last_login_at: {
    type: Date,
    default: null
  },
  last_login_ip: {
    type: String,
    default: null
  },
  login_count: {
    type: Number,
    default: 0
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

// Recompute scope_keys whenever scope fields change so reads can rely on them.
userSchema.pre('save', function preSaveScope(next) {
  const keys = new Set();
  if (this.assigned_constituency) keys.add(normalizeKey(this.assigned_constituency));
  if (this.assigned_lok_sabha) keys.add(`ls:${normalizeKey(this.assigned_lok_sabha)}`);
  (this.extra_constituencies || []).forEach((c) => {
    const k = normalizeKey(c);
    if (k) keys.add(k);
  });
  this.scope_keys = [...keys].filter(Boolean);
  next();
});

userSchema.statics.normalizeScopeKey = normalizeKey;

module.exports = mongoose.model('User', userSchema);
