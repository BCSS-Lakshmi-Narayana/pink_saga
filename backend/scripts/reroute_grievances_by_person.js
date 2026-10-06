/**
 * reroute_grievances_by_person.js
 * ─────────────────────────────────────────────────────────────────────
 * One-shot: walk every active grievance, run the person-mention resolver
 * over its text + author handle, and if any politician is mentioned
 * rewrite `detected_location.constituency` + `routing_targets` to point
 * at that politician's AC (longest-match wins as primary, full set saved
 * in routing_targets.constituencies).
 *
 *   node backend/scripts/reroute_grievances_by_person.js
 *   node backend/scripts/reroute_grievances_by_person.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const Grievance = require('../src/models/Grievance');
const { resolveAllPersonsToConstituencies, resolveRouting } = require('../src/services/constituencyMasterService');

const DRY = process.argv.includes('--dry-run');

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`[reroute] connected (db=${dbName || 'default'}) dry-run=${DRY}`);

    const rows = await Grievance.find({ is_active: true })
        .select('id content.text content.full_text posted_by.handle tagged_account detected_location')
        .lean();

    console.log(`[reroute] scanning ${rows.length} grievances`);

    let matched = 0, updated = 0, unchanged = 0;
    for (const g of rows) {
        const scan = [g.content?.text || '', g.content?.full_text || '', g.posted_by?.handle || '', g.tagged_account || '']
            .filter(Boolean).join(' ');
        const hits = await resolveAllPersonsToConstituencies(scan);
        if (hits.length === 0) continue;
        matched += 1;
        const primary = hits[0];
        const before = g.detected_location?.constituency || null;
        if (before && before.toUpperCase() === primary.ac_name.toUpperCase() && g.detected_location?.source?.startsWith?.('person_match')) {
            unchanged += 1;
            continue;
        }

        const routings = await Promise.all(hits.map(async (h) => {
            try { return { hit: h, routing: await resolveRouting(h.ac_name) }; }
            catch (_) { return { hit: h, routing: null }; }
        }));
        const primaryRouting = routings[0]?.routing || null;
        const mlaIds = new Set(), mpIds = new Set();
        const allAc = [], dashboards = [], scopeKeys = new Set();
        for (const { hit, routing } of routings) {
            allAc.push(hit.ac_name);
            if (!routing) continue;
            for (const u of routing.mla_users || []) if (u?.id) mlaIds.add(u.id);
            for (const u of routing.mp_users  || []) if (u?.id) mpIds.add(u.id);
            if (routing.dashboards?.ac) dashboards.push(routing.dashboards.ac);
            for (const k of routing.scope_keys || []) scopeKeys.add(k);
        }

        const finalLocation = {
            city: primary.ac_name,
            district: primaryRouting?.district || null,
            constituency: primary.ac_name,
            lok_sabha: primaryRouting?.lok_sabha || null,
            confidence: 1.0,
            source: `person_match:${primary.matched_via}`,
            reasoning: hits.length > 1
                ? `Mentions ${hits.map(h => h.matched_name).join(', ')}`
                : `Mentions ${primary.matched_name}`,
            matched_token: primary.matched_name,
            match_source: primary.matched_via,
            auto_assigned: true,
            manual_review_required: false,
        };
        const routingTargets = {
            ac_key: primaryRouting?.ac_key || null,
            district_key: primaryRouting?.district_key || null,
            lok_sabha_key: primaryRouting?.lok_sabha_key || null,
            dashboards: primaryRouting?.dashboards || null,
            siblings_in_district: primaryRouting?.siblings_in_district || [],
            siblings_in_ls: primaryRouting?.siblings_in_ls || [],
            constituencies: allAc,
            ac_dashboards: dashboards,
            mla_user_ids: [...mlaIds],
            mp_user_ids: [...mpIds],
            scope_keys: [...scopeKeys],
            matched_persons: hits.map(h => ({ ac_name: h.ac_name, matched_name: h.matched_name, matched_via: h.matched_via })),
        };

        console.log(`  ${g.id}: ${before || '(empty)'} → [${allAc.join(', ')}]`);
        if (!DRY) {
            await Grievance.findOneAndUpdate(
                { id: g.id },
                { $set: { detected_location: finalLocation, routing_targets: routingTargets } }
            );
            updated += 1;
        }
    }
    console.log(`[reroute] done. matched=${matched} updated=${updated} unchanged=${unchanged}`);
    await mongoose.disconnect();
}

main().catch((err) => { console.error('[reroute] failed:', err); process.exit(1); });
