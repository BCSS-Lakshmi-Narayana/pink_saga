/**
 * boothMetrics
 * ─────────────────────────────────────────────────────────────────────
 * Booth-level demographic maths, shared by both roll sources so they can
 * never drift apart:
 *   • boothImportService — runs it once per booth at upload time, storing
 *     the result on the import session (and then on the Booth row).
 *   • boothVoterService  — runs it on the legacy on-disk rolls, which have
 *     no precomputed metrics.
 *
 * Both callers pass plain rows carrying `gender`, `age` and `house_no`, so
 * one implementation covers the uploaded Mongo documents and the original
 * JSON files alike.
 */

/** Coarse bucket used for counts + the roll's gender filter. */
const genderBucket = (g) => {
    const v = String(g || '').trim().toLowerCase();
    if (v === 'male') return 'male';
    if (v === 'female') return 'female';
    if (v.includes('third') || v === 'tg') return 'third';
    return 'other';
};

/**
 * Canonical stored form of a source gender value.
 * The ECI export is inconsistent — it carries both "Others" and "Other",
 * and leaves the field blank on some rows — so it is normalized once on
 * the way in rather than at every read.
 */
const normalizeGender = (g) => {
    const v = String(g || '').trim().toLowerCase();
    if (!v) return 'Unknown';
    if (v === 'male' || v === 'm') return 'Male';
    if (v === 'female' || v === 'f') return 'Female';
    if (v.includes('third') || v === 'tg') return 'Third';
    if (v.startsWith('other')) return 'Other';
    return 'Unknown';
};

/**
 * Exact booth-level metrics derived from a full voter roll — genders, age
 * profile (brackets + avg/median), first-time/senior share, and household
 * spread. Single pass over the roll.
 */
const computeBoothMetrics = (all) => {
    const counts = { male: 0, female: 0, third: 0, other: 0 };
    const age = { '18-29': 0, '30-44': 0, '45-59': 0, '60+': 0, unknown: 0 };
    const houses = new Map();
    const ages = [];
    let ageSum = 0;

    for (const v of all) {
        counts[genderBucket(v.gender)] += 1;

        const a = Number(v.age);
        if (Number.isFinite(a) && a > 0) {
            ageSum += a;
            ages.push(a);
            if (a < 30) age['18-29'] += 1;
            else if (a < 45) age['30-44'] += 1;
            else if (a < 60) age['45-59'] += 1;
            else age['60+'] += 1;
        } else {
            age.unknown += 1;
        }

        const h = String(v.house_no || '').trim();
        if (h && h !== '-') houses.set(h, (houses.get(h) || 0) + 1);
    }

    ages.sort((a, b) => a - b);
    const median = ages.length ? ages[Math.floor(ages.length / 2)] : null;
    const total = all.length;
    const households = houses.size;

    return {
        total,
        counts,
        age,
        avgAge: ages.length ? Math.round(ageSum / ages.length) : null,
        medianAge: median,
        youngCount: age['18-29'],
        youngPct: total ? Math.round((age['18-29'] / total) * 100) : 0,
        seniorCount: age['60+'],
        seniorPct: total ? Math.round((age['60+'] / total) * 100) : 0,
        households,
        avgPerHousehold: households ? Number((total / households).toFixed(1)) : null,
        // Standard electoral sex ratio: females per 1,000 males.
        genderRatio: counts.male ? Math.round((counts.female / counts.male) * 1000) : null,
    };
};

module.exports = { genderBucket, normalizeGender, computeBoothMetrics };
