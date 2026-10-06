/**
 * seed_mla_mp_accounts.js
 * ─────────────────────────────────────────────────────────────────────
 * Idempotent seed for the per-constituency MLA + MP logins.
 *
 *   119 MLAs  →   email: <seat-slug>-mla@<MLA_MP_EMAIL_DOMAIN>
 *                pass : random, printed once on creation
 *                role : 'mla'
 *                scope: assigned_constituency = <CONSTITUENCY name>
 *                (vacant seat — Khairatabad — get no MLA login)
 *
 *    17 MPs   →   email: <ls-slug>-mp@<MLA_MP_EMAIL_DOMAIN>
 *                pass : random, printed once on creation
 *                role : 'mp'
 *                scope: assigned_lok_sabha = <LS slug>
 *                       (auto-expands to all child ACs via scopeMiddleware)
 *
 * Every seeded account also gets a PagePermission doc enabling the
 * operational pages an MLA/MP needs (Dashboard, Grievances, Alerts,
 * Reports, Unified Reports). Admin pages are deliberately excluded.
 *
 * Re-running the script updates names / scopes / page permissions in
 * place. Existing passwords are kept unless --reset-passwords is passed.
 * Existing users with the same email are NOT deleted, only refreshed.
 *
 * Run:
 *   node backend/scripts/seed_mla_mp_accounts.js
 *   node backend/scripts/seed_mla_mp_accounts.js --dry-run
 *   node backend/scripts/seed_mla_mp_accounts.js --only mla
 *   node backend/scripts/seed_mla_mp_accounts.js --only mp
 *   node backend/scripts/seed_mla_mp_accounts.js --reset-passwords
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const User = require('../src/models/User');
const PagePermission = require('../src/models/PagePermission');
const MLA_ROSTER = require('../src/data/state_mlas.json');
const LS_TO_AC = require('../src/data/state_ls_to_ac.json');
const { ALL_PAGES, PAGE_FEATURES } = require('../src/config/rbacConfig');

const EMAIL_DOMAIN = process.env.MLA_MP_EMAIL_DOMAIN || 'brswatch.local';

/** Lok Sabha slug → display name, from the roster (e.g. janjgirchampa → Janjgir-Champa). */
const LS_DISPLAY = Object.fromEntries(
    require('../src/data/state_voter_profiles.json')
        .filter((p) => p.lok_sabha)
        .map((p) => [String(p.lok_sabha).toLowerCase().replace(/[^a-z0-9]/g, ''), p.lok_sabha]),
);

const randomPassword = () => crypto.randomBytes(12).toString('base64url');

// Pages every MLA / MP login is granted by default.
const DEFAULT_PAGES = [
    '/dashboard',
    '/grievances',
    '/alerts',
    '/intelligence-dashboard',
    '/unified-reports',
];

/* ─── slug helpers ───────────────────────────────────────────────── */

// URL-safe lowercase slug for use in email local-parts and password roots.
// Matches the normalisation already used in scopeMiddleware / User model so
// the seat name a user types into the login form maps deterministically to
// the account we create here.
const slugify = (value) =>
    String(value || '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')   // strip "(SC)", "(ST)", etc.
        .replace(/[^a-z0-9]+/g, '')   // drop punctuation + spaces
        .trim();

/* ─── permission seeding ─────────────────────────────────────────── */

const buildPermissionsForPages = (pagePaths) => {
    const pagePathSet = new Set(ALL_PAGES.map((p) => p.path));
    const permissions = {};
    for (const path of pagePaths) {
        if (!pagePathSet.has(path)) continue;
        const featureIds = (PAGE_FEATURES[path] || []).map((f) => f.id);
        permissions[path] = { enabled: true, features: featureIds };
    }
    return permissions;
};

const DEFAULT_PERMISSIONS = buildPermissionsForPages(DEFAULT_PAGES);

const upsertPagePermission = async (userId, updatedBy) => {
    const allowed = Object.keys(DEFAULT_PERMISSIONS);
    const update = {
        allowed_pages: allowed,
        permissions: DEFAULT_PERMISSIONS,
        updated_by: updatedBy,
        updated_at: new Date(),
    };
    await PagePermission.updateOne(
        { user_id: userId },
        { $set: update, $setOnInsert: { user_id: userId } },
        { upsert: true }
    );
};

/* ─── user upsert ────────────────────────────────────────────────── */

const upsertUser = async ({ email, password, full_name, role, scope, dryRun, resetPasswords }) => {
    const lookupEmail = email.toLowerCase();
    if (dryRun) {
        return { email: lookupEmail, role, full_name, scope, action: 'dry-run' };
    }
    const existing = await User.findOne({ email: lookupEmail });
    if (existing) {
        existing.full_name = full_name;
        existing.role = role;
        if (scope.assigned_constituency !== undefined) existing.assigned_constituency = scope.assigned_constituency;
        if (scope.assigned_lok_sabha !== undefined)    existing.assigned_lok_sabha    = scope.assigned_lok_sabha;
        if (scope.extra_constituencies !== undefined)  existing.extra_constituencies  = scope.extra_constituencies;
        if (resetPasswords) {
            const salt = await bcrypt.genSalt(10);
            existing.password = await bcrypt.hash(password, salt);
        }
        existing.is_active = true;
        await existing.save();
        return { email: lookupEmail, role, action: 'updated', user_id: existing.id, passwordSet: resetPasswords };
    }
    const salt = await bcrypt.genSalt(10);
    const user = await User.create({
        email: lookupEmail,
        password: await bcrypt.hash(password, salt),
        full_name,
        role,
        ...scope,
        is_active: true,
    });
    return { email: lookupEmail, role, action: 'created', user_id: user.id, passwordSet: true };
};

/* ─── builders for each role ─────────────────────────────────────── */

const buildMlaSeeds = () => {
    const seeds = [];
    const seenEmails = new Set();
    for (const row of MLA_ROSTER) {
        const seat = String(row.constituency || '').trim();
        if (!seat || row.vacant) continue;
        const slug = row.key || slugify(seat);
        if (!slug) continue;
        const email = `${slug}-mla@${EMAIL_DOMAIN}`;
        if (seenEmails.has(email)) continue;
        seenEmails.add(email);
        seeds.push({
            email,
            password: randomPassword(),
            full_name: row.mla ? `${row.mla} (MLA, ${seat})` : `MLA — ${seat}`,
            role: 'mla',
            scope: { assigned_constituency: seat, assigned_lok_sabha: null, extra_constituencies: [] },
        });
    }
    return seeds;
};

const buildMpSeeds = () => {
    const seeds = [];
    for (const lsSlug of Object.keys(LS_TO_AC)) {
        const slug = slugify(lsSlug);
        if (!slug) continue;
        const childAcs = LS_TO_AC[lsSlug] || [];
        const displayLs = LS_DISPLAY[lsSlug] || lsSlug;
        seeds.push({
            email: `${slug}-mp@${EMAIL_DOMAIN}`,
            password: randomPassword(),
            full_name: `MP — ${displayLs} (LS)`,
            role: 'mp',
            // assigned_lok_sabha drives the LS→AC expansion in scopeMiddleware;
            // we also pre-fill extra_constituencies so existing queries that
            // only look at `constituencies` array still work without round-trip.
            scope: {
                assigned_constituency: null,
                assigned_lok_sabha: lsSlug,
                extra_constituencies: childAcs,
            },
        });
    }
    return seeds;
};

/* ─── main ───────────────────────────────────────────────────────── */

const main = async () => {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes('--dry-run');
    const resetPasswords = argv.includes('--reset-passwords');
    const onlyIdx = argv.indexOf('--only');
    const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

    const mlaSeeds = (only && only !== 'mla') ? [] : buildMlaSeeds();
    const mpSeeds  = (only && only !== 'mp')  ? [] : buildMpSeeds();

    console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
    console.log(`║  SEED · Telangana MLA + MP login accounts               ║`);
    console.log(`║  Domain: ${EMAIL_DOMAIN.padEnd(48)} ║`);
    console.log(`║  MLAs:   ${String(mlaSeeds.length).padStart(3)}    MPs: ${String(mpSeeds.length).padStart(3)}${dryRun ? '    (DRY-RUN)' : ''}            ║`);
    console.log(`╚═══════════════════════════════════════════════════════════╝\n`);

    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cgsaga';
    const dbName = process.env.DB_NAME;
    await mongoose.connect(uri, dbName ? { dbName } : undefined);

    const summary = { created: 0, updated: 0, errors: 0, credentials: [] };

    try {
        const adminUser = await User.findOne({ role: 'superadmin' }).select('id').lean();
        const updatedBy = adminUser?.id || 'seed:mla_mp_accounts';

        for (const seed of [...mlaSeeds, ...mpSeeds]) {
            try {
                const r = await upsertUser({ ...seed, dryRun, resetPasswords });
                if (r.action === 'created') summary.created += 1;
                else if (r.action === 'updated') summary.updated += 1;
                if (!dryRun && r.user_id) {
                    await upsertPagePermission(r.user_id, updatedBy);
                }
                if (r.passwordSet) summary.credentials.push({ ...seed, action: r.action });
            } catch (err) {
                summary.errors += 1;
                console.error(`  ✖ ${seed.email}: ${err.message}`);
            }
        }
    } finally {
        await mongoose.disconnect();
    }

    console.log(`\n┌─ SUMMARY ────────────────┐`);
    console.log(`│  created : ${String(summary.created).padStart(5)}         │`);
    console.log(`│  updated : ${String(summary.updated).padStart(5)}         │`);
    console.log(`│  errors  : ${String(summary.errors).padStart(5)}         │`);
    console.log(`└──────────────────────────┘\n`);

    if (summary.credentials.length) {
        console.log(`New credentials — shown ONCE, hand them over securely:`);
        for (const s of summary.credentials) {
            console.log(`  ${s.role.toUpperCase().padEnd(3)}  ${s.email.padEnd(45)}  pw=${s.password}`);
        }
    }
    console.log('');

    process.exit(summary.errors === 0 ? 0 : 1);
};

main().catch((err) => {
    console.error('[seed_mla_mp_accounts] crashed:', err);
    process.exit(1);
});
