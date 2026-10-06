/**
 * constituencyLocationSweepService
 * ─────────────────────────────────────────────────────────────────────────────
 * Places an AP constituency on Alerts and NewsArticles, the two surfaces the
 * Grievance ingest path already does this for and they never have. Built for
 * Constituency Leader Popularity, whose per-seat numbers are worthless without
 * it — measured before this shipped:
 *
 *      grievances  78,837 total — 56,116 placed (71.2%)  (placed at ingest)
 *      alerts      11,461 total —      0 placed ( 0.0%)  (no path ever tried)
 *      newsarticles 3,656 total —  1,368 placed (37.4% district/city only,
 *                                  0 with a constituency — the field itself
 *                                  did not exist until this shipped)
 *
 * REUSES THE GRIEVANCE PIPELINE'S OWN TWO STEPS, in the same order, because it
 * already resolves 71% of grievances and re-inventing a weaker matcher for the
 * other two surfaces would make the same post land in three different
 * constituencies depending which collection it is in:
 *
 *   STEP -1  Person-mention short-circuit (resolveAllPersonsToConstituencies)
 *            — names an MLA/MP → their seat, confidence 1.0, no network call.
 *            On grievances this alone resolves 55% of ALL placed rows (person
 *            match + MLA fan-out combined, 30,949 of 56,116) — the single
 *            highest-value signal, and free.
 *   STEP  0  classifyLocation — its own two offline tiers (master alias
 *            index, then a plain constituency-name substring match) before
 *            falling back to a paid RapidAPI call for genuinely ambiguous text.
 *
 * NOT reused: grievanceService's `routing_targets` fan-out (which MLA/MP
 * accounts a grievance routes to). That is an RBAC-scope concern for a
 * different feature; this sweep only needs `detected_location.constituency`
 * for the Leader Popularity aggregation to group by. Alerts and news are not
 * wired into constituency-scoped login routing today, and this file does not
 * change that.
 *
 * THE BUG THIS IS DESIGNED AROUND: a sweep that marks a row unplaceable but
 * queries "pending" only on a missing constituency re-scans that same row
 * forever, since a failed attempt also leaves the constituency empty. Every
 * write here — success OR failure — stamps `detected_location.attempted_at`,
 * and the pending query is keyed on THAT field, not on whether a constituency
 * was found. An unplaceable row is asked once and then left alone.
 */

const Alert = require('../models/Alert');
const NewsArticle = require('../models/NewsArticle');
const Content = require('../models/Content');
const { resolveAllPersonsToConstituencies, resolveRouting, matchAlias } = require('./constituencyMasterService');
const { classifyLocation, CONSTITUENCIES, DISTRICT_BY_AC, AC_TO_LS } = require('./locationClassifierService');
const { locateDistrict } = require('./districtLocator');

const AUTO_ASSIGN_THRESHOLD = Number(process.env.LOCATION_AUTO_ASSIGN_THRESHOLD || 0.80);

/**
 * The same longest-name-first substring match `classifyLocation` runs as its
 * own tier 2 (that function keeps it private). Duplicated here — not imported
 * — because it is 8 lines and re-implementing it is cheaper than widening that
 * module's public surface for one caller.
 */
const CONSTITUENCIES_LONGEST_FIRST = [...CONSTITUENCIES].sort((a, b) => b.length - a.length);
const heuristicLookup = (text) => {
    const lower = String(text || '').toLowerCase();
    for (const c of CONSTITUENCIES_LONGEST_FIRST) {
        if (c.length < 4) continue;
        if (lower.includes(c.toLowerCase())) return c;
    }
    return null;
};

// Same key shape DISTRICT_BY_AC / AC_TO_LS are built with inside
// locationClassifierService (that normalize() is not exported).
const normalizeName = (v) =>
    String(v || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, '').trim();

/**
 * Tiers 1+2 of classifyLocation ONLY — master alias index, then the plain
 * name match — with the paid RapidAPI tier 3 never called. Used by the
 * one-shot backfill so a first run over an 11k+ backlog cannot burn API quota
 * before anyone has seen a placement number; the live scheduler below uses the
 * full three-tier classifier instead, same as grievance ingest.
 */
const classifyOffline = async (text, ctx) => {
    const haystack = `${text} ${ctx.userLocation} ${ctx.userBio} ${ctx.hashtags} ${ctx.taggedAccount}`;
    try {
        const hit = await matchAlias(haystack);
        if (hit) {
            return {
                constituency: hit.ac_name,
                district: DISTRICT_BY_AC[normalizeName(hit.ac_name)] || null,
                lok_sabha: AC_TO_LS[normalizeName(hit.ac_name)] || null,
                confidence: 0.95,
                provider: 'master_index',
                matched_token: hit.matched_token,
                match_source: hit.match_source,
            };
        }
    } catch (err) {
        console.warn(`[ConstituencySweep] offline master-index lookup failed: ${err.message}`);
    }
    const name = heuristicLookup(haystack);
    if (!name) return null;
    return {
        constituency: name,
        district: DISTRICT_BY_AC[normalizeName(name)] || null,
        lok_sabha: AC_TO_LS[normalizeName(name)] || null,
        confidence: 0.92,
        provider: 'heuristic',
    };
};

/**
 * Resolve one piece of text to an AP constituency, or null if genuinely
 * unplaceable. Never throws — a lookup failure degrades to "unplaceable",
 * it does not stop the sweep.
 *
 * @param {boolean} opts.offlineOnly  skip the paid RapidAPI tier (used by the
 *   one-shot backfill over a large backlog, so a first run cannot silently
 *   burn API quota on thousands of rows before anyone has seen a number).
 */
const locateText = async (text, meta = {}, opts = {}) => {
    if (!text || !text.trim()) return null;

    try {
        const personScan = [text, meta.handle].filter(Boolean).join(' ');
        const hits = await resolveAllPersonsToConstituencies(personScan);
        if (hits.length > 0) {
            const primary = hits[0];
            const routing = await resolveRouting(primary.ac_name).catch(() => null);
            return {
                location_found: true,
                city: primary.ac_name,
                constituency: primary.ac_name,
                district: routing?.district || null,
                lok_sabha: routing?.lok_sabha || null,
                confidence: 1.0,
                source: `person_match:${primary.matched_via}`,
                matched_token: primary.matched_name,
                match_source: primary.matched_via,
                auto_assigned: true,
            };
        }
    } catch (err) {
        console.warn(`[ConstituencySweep] person resolver failed: ${err.message}`);
    }

    try {
        const hashtags = (text.match(/#\w+/g) || []).join(' ');
        const ctx = { userLocation: meta.userLocation || '', userBio: meta.userBio || '', hashtags, taggedAccount: meta.taggedAccount || '' };
        const ap = opts.offlineOnly
            ? await classifyOffline(text, ctx)
            : await classifyLocation(text, ctx);
        if (ap && ap.constituency && ap.confidence >= AUTO_ASSIGN_THRESHOLD) {
            return {
                location_found: true,
                city: ap.constituency,
                constituency: ap.constituency,
                district: ap.district || null,
                lok_sabha: ap.lok_sabha || null,
                confidence: ap.confidence,
                source: `ap_classifier:${ap.provider}`,
                matched_token: ap.matched_token || null,
                match_source: ap.match_source || ap.provider,
                auto_assigned: true,
            };
        }
    } catch (err) {
        console.warn(`[ConstituencySweep] classifier failed: ${err.message}`);
    }

    // District level only — the post names a district/town but no seat.
    const d = locateDistrict(text);
    if (d) {
        return {
            location_found: true,
            city: d.city,
            district: d.district,
            constituency: null,
            lok_sabha: null,
            confidence: 0.85,
            source: 'district_match',
            matched_token: d.matched_token,
            match_source: 'district_match',
            auto_assigned: true,
        };
    }

    return null;
};

/* ─── per-surface adapters ────────────────────────────────────────────── */

/**
 * Alerts have no location at all. Reads the ORIGINAL post via `content_id`,
 * not `alert.description` — that field is a rendered summary
 * ("**Intent Detected:** …"), not the post text.
 */
const sweepAlerts = async ({ limit = 25, offlineOnly = false } = {}) => {
    const pending = await Alert.find({ 'detected_location.attempted_at': null })
        .sort({ created_at: -1 })
        .limit(limit)
        .select('id content_id author author_handle')
        .lean();
    if (!pending.length) return { scanned: 0, placed: 0, unplaceable: 0 };

    const contentIds = [...new Set(pending.map((a) => a.content_id).filter(Boolean))];
    const contents = contentIds.length
        ? await Content.find({ id: { $in: contentIds } }).select('id text translated_text').lean()
        : [];
    const contentMap = new Map(contents.map((c) => [c.id, c]));

    let placed = 0;
    let unplaceable = 0;
    for (const alert of pending) {
        const content = contentMap.get(alert.content_id);
        const text = content?.translated_text || content?.text || '';
        const loc = await locateText(text, { handle: alert.author_handle }, { offlineOnly });
        const attempted_at = new Date();
        if (loc) {
            await Alert.updateOne({ id: alert.id }, { $set: { detected_location: { ...loc, attempted_at } } });
            placed += 1;
        } else {
            await Alert.updateOne(
                { id: alert.id },
                { $set: { detected_location: { location_found: false, auto_assigned: false, attempted_at } } }
            );
            unplaceable += 1;
        }
    }
    return { scanned: pending.length, placed, unplaceable };
};

/**
 * News. A safety net over the Python engine's own placement, not a
 * replacement — only rows IT left unplaced are touched, and its
 * district/city/lat/lng are never overwritten, only the added
 * constituency/lok_sabha fields.
 */
const sweepNews = async ({ limit = 25, offlineOnly = false } = {}) => {
    const pending = await NewsArticle.find({ 'detected_location.attempted_at': null })
        .sort({ scraped_at: -1 })
        .limit(limit)
        .select('title title_english summary summary_english content')
        .lean();
    if (!pending.length) return { scanned: 0, placed: 0, unplaceable: 0 };

    let placed = 0;
    let unplaceable = 0;
    for (const article of pending) {
        const text = [
            article.title_english || article.title,
            article.summary_english || article.summary,
            article.content,
        ].filter(Boolean).join('\n\n').slice(0, 1500);

        const loc = await locateText(text, {}, { offlineOnly });
        const attempted_at = new Date();
        if (loc) {
            await NewsArticle.updateOne(
                { _id: article._id },
                { $set: {
                    'detected_location.location_found': true,
                    'detected_location.constituency': loc.constituency || '',
                    'detected_location.lok_sabha': loc.lok_sabha || '',
                    'detected_location.source': loc.source,
                    'detected_location.attempted_at': attempted_at,
                    // Fill district/city too, but only if the Python engine left them empty.
                    ...(article.detected_location?.district ? {} : { 'detected_location.district': loc.district || '' }),
                    ...(article.detected_location?.city ? {} : { 'detected_location.city': loc.city || '' }),
                } }
            );
            placed += 1;
        } else {
            await NewsArticle.updateOne(
                { _id: article._id },
                { $set: { 'detected_location.attempted_at': attempted_at } }
            );
            unplaceable += 1;
        }
    }
    return { scanned: pending.length, placed, unplaceable };
};

/** Run one batch for one or both surfaces. Never throws. */
const runSweep = async ({ surface = 'all', limit = 25, offlineOnly = false } = {}) => {
    const results = {};
    try {
        if (surface === 'alert' || surface === 'all') {
            results.alert = await sweepAlerts({ limit, offlineOnly });
        }
        if (surface === 'news' || surface === 'all') {
            results.news = await sweepNews({ limit, offlineOnly });
        }
    } catch (err) {
        console.error(`[ConstituencySweep] batch failed: ${err.message}`);
    }
    return results;
};

module.exports = {
    locateText,
    sweepAlerts,
    sweepNews,
    runSweep,
};
