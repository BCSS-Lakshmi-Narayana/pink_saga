#!/usr/bin/env node
/**
 * Grant an existing page to users who already have a stored PagePermission doc.
 *
 *   node src/scripts/grant-page-permission.js --page /ai-suggestions --dry-run
 *   node src/scripts/grant-page-permission.js --page /ai-suggestions
 *   node src/scripts/grant-page-permission.js --page /ai-suggestions --roles mla,mp
 *   node src/scripts/grant-page-permission.js --page /ai-suggestions --disabled
 *
 * WHY THIS IS NEEDED ON THIS DEPLOYMENT
 * ─────────────────────────────────────
 * Adding a page to `config/rbacConfig.js` ALL_PAGES makes it appear in Access
 * Management and grants it to superadmins — but this deployment also seeds a
 * PagePermission document for every user at registration
 * (controllers/authController.js `buildDefaultPagePermissions`). `DEFAULT_PAGE_PATHS`
 * is computed from ALL_PAGES at module load, so NEW users pick the page up
 * automatically — while every EXISTING user keeps a stored `permissions` object
 * that has no key for it.
 *
 * `normalizePermissions` in rbacMiddleware only reflects stored keys, so those
 * users are DENIED the new page and it simply never appears in their sidebar.
 * There is no error and nothing in the logs — it just looks like the feature was
 * never shipped. This script closes that gap.
 *
 * Idempotent: a user who already has a key for the page is left untouched.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const PagePermission = require('../models/PagePermission');
const User = require('../models/User');
const { ALL_PAGES, PAGE_FEATURES } = require('../config/rbacConfig');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const val = (name, dflt = null) => {
    const i = args.indexOf(`--${name}`);
    if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
    const inline = args.find((a) => a.startsWith(`--${name}=`));
    return inline ? inline.split('=').slice(1).join('=') : dflt;
};

const PAGE = val('page');
const DRY_RUN = flag('dry-run');
// Grant it switched OFF, so it shows in Access Management as an explicit
// per-user decision rather than being turned on for everyone at once.
const DISABLED = flag('disabled');
const ROLES = (val('roles') || '').split(',').map((r) => r.trim()).filter(Boolean);

const main = async () => {
    if (!PAGE) {
        console.error('Usage: --page /ai-suggestions [--dry-run] [--disabled] [--roles mla,mp]');
        process.exit(1);
    }
    if (!ALL_PAGES.some((p) => p.path === PAGE)) {
        console.error(`"${PAGE}" is not in config/rbacConfig.js ALL_PAGES. Add it there first, or the grant would be meaningless.`);
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
        dbName: process.env.DB_NAME || undefined,
    });

    // Feature ids default to "all features of this page", matching how
    // authController seeds a new user.
    const features = (PAGE_FEATURES[PAGE] || []).map((f) => f.id);
    const grant = { enabled: !DISABLED, features };

    let userFilterIds = null;
    if (ROLES.length) {
        const users = await User.find({ role: { $in: ROLES } }).select('id _id role').lean();
        userFilterIds = new Set(users.flatMap((u) => [u.id, String(u._id)].filter(Boolean)));
        console.log(`[grant-page] restricting to roles ${ROLES.join(', ')} → ${users.length} user(s)`);
    }

    const docs = await PagePermission.find({}).lean();
    console.log(`[grant-page] ${docs.length} permission document(s) on file`);
    console.log(`[grant-page] page=${PAGE} enabled=${!DISABLED} features=[${features.join(', ') || 'none'}]`);
    console.log(`[grant-page] mode=${DRY_RUN ? 'DRY RUN (no writes)' : 'PERSIST'}\n`);

    const stats = { updated: 0, already: 0, skippedRole: 0, noPermissionsObject: 0 };

    for (const doc of docs) {
        if (userFilterIds && !userFilterIds.has(String(doc.user_id))) { stats.skippedRole += 1; continue; }

        const perms = doc.permissions;
        if (!perms || typeof perms !== 'object') {
            // A null `permissions` means this user falls through to the role
            // defaults at read time, so there is nothing here to patch — writing
            // one key would actually NARROW them to just that page.
            stats.noPermissionsObject += 1;
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(perms, PAGE)) { stats.already += 1; continue; }

        stats.updated += 1;
        if (DRY_RUN) continue;

        // `permissions` is a Mixed path, so a nested assignment is invisible to
        // change tracking — set the whole object and let Mongoose write it.
        await PagePermission.updateOne(
            { _id: doc._id },
            { $set: { permissions: { ...perms, [PAGE]: grant }, updated_at: new Date() } },
        );
    }

    console.log('─── summary ─────────────────────────────────');
    console.log(`  granted            : ${stats.updated}`);
    console.log(`  already had it     : ${stats.already}`);
    console.log(`  null permissions   : ${stats.noPermissionsObject}  (use role defaults — intentionally untouched)`);
    if (ROLES.length) console.log(`  skipped (role)     : ${stats.skippedRole}`);
    console.log(`  writes             : ${DRY_RUN ? 'NONE (dry run)' : 'persisted'}`);
    console.log('─────────────────────────────────────────────\n');

    await mongoose.connection.close();
};

main().catch(async (err) => {
    console.error('[grant-page] fatal:', err);
    try { await mongoose.connection.close(); } catch (e) { /* already closed */ }
    process.exit(1);
});
