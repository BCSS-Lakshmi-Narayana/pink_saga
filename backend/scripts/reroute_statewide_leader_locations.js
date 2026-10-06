/**
 * reroute_statewide_leader_locations.js
 * ─────────────────────────────────────────────────────────────────────
 * One-shot repair. Before STATEWIDE_LEADER_AC_KEYS existed, a post that named
 * or tagged the CM / a minister / a party or opposition leader was placed in
 * that leader's OWN seat (e.g. every post tagging the CM landed on his home
 * constituency). This re-locates those rows with the current resolver:
 *
 *   grievances → location cleared, then extractAndSaveLocation re-run
 *   alerts     → location cleared, then the constituency sweep re-run
 *
 *   node scripts/reroute_statewide_leader_locations.js --dry-run
 *   node scripts/reroute_statewide_leader_locations.js
 *
 * --rapidapi instead re-checks every row placed by the LLM classifier tier,
 * through its grounding gate (a place literally in the post, inside the state).
 * --unplaced re-runs placement on every row that currently has no location.
 * --recheck re-runs placement on rows placed by the rules that changed: an MP
 * name, a district/town/locality match, or a master-index alias.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry-run');
const LLM_TIER = process.argv.includes('--rapidapi');
const UNPLACED = process.argv.includes('--unplaced');
const RECHECK = process.argv.includes('--recheck');

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, process.env.DB_NAME ? { dbName: String(process.env.DB_NAME).trim() } : undefined);
    const Grievance = require('../src/models/Grievance');
    const Alert = require('../src/models/Alert');
    const { STATEWIDE_LEADER_AC_KEYS } = require('../src/services/constituencyMasterService');
    const { acKey } = require('../src/config/politicalData');
    let isStatewideOrAll = (ac) => !!ac && STATEWIDE_LEADER_AC_KEYS.has(acKey(ac));
    const isStatewide = (ac) => isStatewideOrAll(ac);

    // A row is affected when it was placed by a person match and any of its
    // matched persons sits in a statewide leader's seat.
    const personPlaced = RECHECK
        ? { 'detected_location.source': /^(person_match:mp|district_match|ap_classifier:master_index)/ }
        : UNPLACED
        ? { $or: [{ 'detected_location.district': { $in: [null, ''] } }, { detected_location: null }] }
        : { 'detected_location.source': LLM_TIER ? /rapidapi/ : /^person_match/ };
    if (LLM_TIER || UNPLACED || RECHECK) isStatewideOrAll = () => true;

    const grievances = (await Grievance.find({ is_active: true, ...personPlaced })
        .select('id content.text content.full_text posted_by tagged_account detected_location routing_targets')
        .lean())
        .filter((g) => {
            const acs = [g.detected_location?.constituency, ...(g.routing_targets?.constituencies || [])];
            return UNPLACED || acs.some(isStatewide);
        });

    const alerts = (await Alert.find(personPlaced).select('id detected_location').lean())
        .filter((a) => UNPLACED || isStatewide(a.detected_location?.constituency));

    console.log(`[reroute] dry-run=${DRY} grievances=${grievances.length} alerts=${alerts.length}`);
    if (DRY) {
        grievances.slice(0, 30).forEach((g) => console.log(`  G ${g.id}: ${g.detected_location?.constituency} (${g.detected_location?.matched_token})`));
        alerts.slice(0, 30).forEach((a) => console.log(`  A ${a.id}: ${a.detected_location?.constituency} (${a.detected_location?.matched_token})`));
        await mongoose.disconnect();
        process.exit(0);
    }

    const { extractAndSaveLocation } = require('../src/services/grievanceService');
    for (const g of grievances) {
        const before = g.detected_location?.constituency;
        await Grievance.updateOne({ id: g.id }, { $unset: { detected_location: 1, routing_targets: 1 } });
        const text = g.content?.full_text || g.content?.text || '';
        await extractAndSaveLocation(g.id, text, g.posted_by || {}, { tagged_account: g.tagged_account });
        const after = await Grievance.findOne({ id: g.id }).select('detected_location').lean();
        console.log(`  G ${g.id}: ${before} → ${after?.detected_location?.constituency || after?.detected_location?.city || '(unplaced)'}`);
    }

    if (alerts.length) {
        await Alert.updateMany({ id: { $in: alerts.map((a) => a.id) } }, { $unset: { detected_location: 1 } });
        const { sweepAlerts } = require('../src/services/constituencyLocationSweepService');
        let round;
        do {
            round = await sweepAlerts({ limit: 50 });
            console.log(`  alerts sweep: ${JSON.stringify(round)}`);
        } while (round.scanned > 0 && round.scanned === 50);
    }

    console.log('[reroute] done');
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error('[reroute] failed:', e); process.exit(1); });
