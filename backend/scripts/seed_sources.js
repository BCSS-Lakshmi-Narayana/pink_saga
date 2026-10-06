#!/usr/bin/env node
/**
 * seed_sources.js
 * ─────────────────────────────────────────────────────────────────────
 * Loads the monitored social-media accounts (the Sources page) into the
 * database named by DB_NAME:
 *
 *   • src/data/sources_list.json: Telangana media, party and leader accounts.
 *     Every X handle there was fetched from api.fxtwitter.com and its bio read
 *     before inclusion. Outlets that could not be resolved to a live account are
 *     ABSENT rather than guessed — Eenadu, NTV Telugu, HMTV, TV5 Telugu and
 *     Namasthe Telangana among them. They still reach the pipeline through RSS.
 *   • with --with-leaders: also every X account of a Telangana leader or party in
 *     src/data/state_leader_handles.json that is not already a source, tagged
 *     with the leader's constituency where there is one.
 *
 * Existing sources (same identifier, or same name on the same platform) are
 * left untouched, so re-running is safe. YouTube handles are resolved to a
 * channel id through BluGate when its credentials are set.
 *
 *   • with --with-adversaries: also every X account in
 *     src/data/state_adversary_handles.json — the rival campaign apparatus.
 *     Classifying an attack account is useless if its posts are never fetched.
 *
 *   npm run seed:sources -- --dry-run            show what would be added
 *   npm run seed:sources                         add sources_list.json
 *   npm run seed:sources -- --with-leaders       also add leaders' X accounts
 *   npm run seed:sources -- --with-adversaries   also add the attack accounts
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Source = require('../src/models/Source');
const blugateClient = require('../src/services/blugateClient');
const youtubeChannels = require('../src/services/youtubeChannelService');
const SOURCES = require('../src/data/sources_list.json');
const HANDLES = require('../src/data/state_leader_handles.json');
const ADVERSARIES = require('../src/data/state_adversary_handles.json');
const MLAS = require('../src/data/state_mlas.json');
// OUR_FRONTBENCH replaces the ruling-party `CABINET_MINISTERS` export: BRS is
// in opposition and holds no portfolios, so the people who speak for the party
// are its legislature-party leadership, not ministers.
const { OUR_FRONTBENCH, PRESIDING_OFFICERS, PARTY_ORG_LEADERS, OPPOSITION_LEADERS, ALLY_MPS, NATIONAL_ALLY_LEADERS, NATIONAL_OPPOSITION_LEADERS } = require('../src/config/politicalData');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const withLeaders = argv.includes('--with-leaders');
const withAdversaries = argv.includes('--with-adversaries');

/** X accounts from the verified handle registry, as source rows. */
const leaderSources = () => {
    const byId = new Map();
    for (const l of [...OUR_FRONTBENCH, ...PRESIDING_OFFICERS, ...PARTY_ORG_LEADERS, ...OPPOSITION_LEADERS,
        ...ALLY_MPS, ...NATIONAL_ALLY_LEADERS, ...NATIONAL_OPPOSITION_LEADERS]) byId.set(l.id, l);
    const byAc = new Map(MLAS.map((m) => [`ac:${m.key}`, m]));

    const rows = [];
    for (const [key, entries] of Object.entries(HANDLES.people)) {
        const leader = byId.get(key);
        const mla = byAc.get(key);
        const name = leader ? leader.name : mla ? mla.mla : null;
        if (!name) continue;
        const constituency = mla ? mla.constituency : (leader && leader.constituency) || null;
        for (const e of entries) {
            if (e.platform !== 'x') continue;
            rows.push({ platform: 'x', identifier: `@${e.handle}`, display_name: name, category: 'political', constituency });
        }
    }
    for (const [party, entries] of Object.entries(HANDLES.parties)) {
        for (const e of entries) {
            if (e.platform !== 'x') continue;
            rows.push({ platform: 'x', identifier: `@${e.handle}`, display_name: `${party.toUpperCase()} Telangana`, category: 'political', is_party_wide: true });
        }
    }
    return rows;
};

/**
 * The rival campaign apparatus, from state_adversary_handles.json.
 *
 * Classifying these correctly is not the same as collecting them. Voice
 * classification only decides what to do with a post once we HAVE it — if the
 * account is not a monitored source, its posts never arrive, and the adversary
 * column is empty for the best of reasons and the worst of outcomes.
 *
 * Behind a flag because each added source costs API quota on every run, and
 * because the roster is deliberately broader than any one client will want:
 * AIMIM is on it as situational, not reliably hostile.
 */
const adversarySources = () => (ADVERSARIES.adversaries || [])
    .filter((a) => a.platform === 'x' && a.handle)
    .map((a) => ({
        platform: 'x',
        identifier: `@${a.handle}`,
        display_name: a.name || a.handle,
        category: 'political',
    }));

(async () => {
    const wanted = [
        ...SOURCES,
        ...(withLeaders ? leaderSources() : []),
        ...(withAdversaries ? adversarySources() : []),
    ];
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}${dryRun ? '   (DRY-RUN: nothing is written)' : ''}`);

    const canResolveYoutube = blugateClient.hasCredentials();
    const seen = new Set();
    const counts = { added: 0, existing: 0, duplicate: 0, failed: 0 };

    for (const s of wanted) {
        const idKey = `${s.platform}:${String(s.identifier).toLowerCase()}`;
        if (seen.has(idKey)) { counts.duplicate += 1; continue; }
        seen.add(idKey);

        const existing = await Source.findOne({
            $or: [
                { platform: s.platform, identifier: new RegExp(`^${String(s.identifier).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
                { display_name: s.display_name, platform: s.platform },
            ],
        }).lean();
        if (existing) { counts.existing += 1; continue; }

        let identifier = s.identifier;
        // Channel URLs / @handles → channel id without search.list (quota-safe).
        // If it can't be resolved now, the monitor resolves it on first scan.
        if (!dryRun && s.platform === 'youtube' && canResolveYoutube) {
            try {
                const ch = await youtubeChannels.resolveChannel(identifier);
                if (ch && ch.id) identifier = ch.id;
            } catch (err) {
                console.warn(`  could not resolve YouTube ${s.identifier}: ${err.message}`);
            }
        }

        if (dryRun) {
            console.log(`  + ${s.platform.padEnd(9)} ${String(identifier).padEnd(28)} ${s.display_name}`);
            counts.added += 1;
            continue;
        }
        try {
            await Source.create({
                platform: s.platform,
                identifier,
                display_name: s.display_name,
                category: s.category || 'unknown',
                constituency: s.constituency || null,
                is_party_wide: !!s.is_party_wide,
                created_by: 'system_seed',
                is_active: true,
            });
            counts.added += 1;
        } catch (err) {
            if (err.code === 11000) counts.existing += 1;
            else { counts.failed += 1; console.warn(`  failed ${s.platform} ${s.identifier}: ${err.message}`); }
        }
    }

    console.log(`\n${dryRun ? 'Would add' : 'Added'}: ${counts.added}   already present: ${counts.existing}   duplicates in input: ${counts.duplicate}   failed: ${counts.failed}`);
    await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
