/**
 * politicalImpactService
 * ─────────────────────────────────────────────────────────────────────
 * Computes a Political Impact Score per AC over a configurable time
 * window, combining four signals:
 *
 *   1. Complaint volume        — how many grievances landed in the AC
 *   2. Sentiment score         — average bsk_sentiment (negative drags down)
 *   3. Engagement              — sum of likes+retweets+replies+views+quotes
 *   4. Virality                — max single-post engagement (proxy for one
 *                                 going viral)
 *
 * Each raw signal is normalised to 0..1 against the strongest AC in the
 * window, then weighted and summed. The result is a single 0..100 score
 * plus a level bucket (critical / high / medium / low) for UI colouring.
 *
 *   total = round( 100 *
 *      ( W_VOL  * vol_norm
 *      + W_SENT * sent_norm    ← inverted: negative sentiment increases impact
 *      + W_ENG  * eng_norm
 *      + W_VIR  * vir_norm ))
 *
 * The weights are intentionally close to equal — tune via env if needed.
 */

const Grievance = require('../models/Grievance');

const W_VOL  = Number(process.env.IMPACT_WEIGHT_VOLUME    || 0.30);
const W_SENT = Number(process.env.IMPACT_WEIGHT_SENTIMENT || 0.25);
const W_ENG  = Number(process.env.IMPACT_WEIGHT_ENGAGEMENT|| 0.25);
const W_VIR  = Number(process.env.IMPACT_WEIGHT_VIRALITY  || 0.20);

const parseWindow = (windowStr) => {
    const s = String(windowStr || '24h').trim().toLowerCase();
    const m = s.match(/^(\d+)\s*([hdw])$/);
    if (!m) return 24 * 60 * 60 * 1000;
    const n = parseInt(m[1], 10);
    const unit = m[2];
    if (unit === 'h') return n * 60 * 60 * 1000;
    if (unit === 'd') return n * 24 * 60 * 60 * 1000;
    if (unit === 'w') return n * 7 * 24 * 60 * 60 * 1000;
    return 24 * 60 * 60 * 1000;
};

const levelFromScore = (score) => {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    return 'low';
};

/**
 * Compute the Political Impact Score table.
 *
 *   opts.window         — '24h' | '7d' | '30d' (default '24h')
 *   opts.minVolume      — drop ACs with fewer than N grievances (default 1)
 *   opts.limit          — return top-N ACs (default 200 = all)
 */
const computeImpact = async (opts = {}) => {
    const windowMs   = parseWindow(opts.window || '24h');
    const cutoff     = new Date(Date.now() - windowMs);
    const minVolume  = Number(opts.minVolume || 1);
    const limit      = Math.min(Number(opts.limit || 200), 1000);

    // Pull a slim projection — we only need the AC, sentiment, engagement.
    const docs = await Grievance.find({
        post_date: { $gte: cutoff },
        'detected_location.constituency': { $ne: null },
        is_active: { $ne: false },
    }).select({
        _id: 0,
        id: 1,
        'detected_location.constituency': 1,
        'detected_location.district': 1,
        'detected_location.lok_sabha': 1,
        'analysis.bsk_sentiment': 1,
        'analysis.sentiment': 1,
        'analysis.severity': 1,
        'analysis.risk_level': 1,
        engagement: 1,
    }).lean();

    // Bucket by AC.
    const buckets = {}; // ac → { count, sentSum, engSum, engMax, sevCounts, district, ls }
    for (const d of docs) {
        const ac = d.detected_location?.constituency;
        if (!ac) continue;
        const b = buckets[ac] = buckets[ac] || {
            ac, district: d.detected_location?.district || null, ls: d.detected_location?.lok_sabha || null,
            count: 0, sentSum: 0, sentCount: 0, engSum: 0, engMax: 0,
            sevCounts: { low: 0, medium: 0, high: 0, critical: 0 },
        };
        b.count += 1;

        const sent = d.analysis?.bsk_sentiment || d.analysis?.sentiment;
        if (sent === 'negative') { b.sentSum += -1; b.sentCount += 1; }
        else if (sent === 'positive') { b.sentSum += 1; b.sentCount += 1; }
        else if (sent === 'neutral') { b.sentSum += 0; b.sentCount += 1; }

        const eng = (d.engagement?.likes    || 0)
                  + (d.engagement?.retweets || 0)
                  + (d.engagement?.replies  || 0)
                  + (d.engagement?.quotes   || 0)
                  + Math.floor((d.engagement?.views || 0) / 10); // views are noisy; dampen
        b.engSum += eng;
        if (eng > b.engMax) b.engMax = eng;

        const sev = d.analysis?.severity || d.analysis?.risk_level || 'low';
        if (b.sevCounts[sev] !== undefined) b.sevCounts[sev] += 1;
    }

    // Normaliser: max value across all ACs for each signal.
    const acs = Object.values(buckets);
    if (acs.length === 0) return { window: opts.window || '24h', cutoff, rows: [], totals: { ac_count: 0, grievance_count: 0 } };

    const maxVol = Math.max(1, ...acs.map((b) => b.count));
    const maxEng = Math.max(1, ...acs.map((b) => b.engSum));
    const maxVir = Math.max(1, ...acs.map((b) => b.engMax));

    const rows = acs
        .filter((b) => b.count >= minVolume)
        .map((b) => {
            const volNorm = b.count   / maxVol;
            const engNorm = b.engSum  / maxEng;
            const virNorm = b.engMax  / maxVir;

            // Average sentiment in [-1, +1]. Invert + shift to [0,1] where
            // 1 = highly negative (high impact) and 0 = highly positive.
            const avgSent = b.sentCount ? (b.sentSum / b.sentCount) : 0;
            const sentNorm = Math.max(0, Math.min(1, (1 - avgSent) / 2));

            const total = Math.round(100 * (
                W_VOL  * volNorm  +
                W_SENT * sentNorm +
                W_ENG  * engNorm  +
                W_VIR  * virNorm
            ));

            return {
                ac:           b.ac,
                district:     b.district,
                lok_sabha:    b.ls,
                complaint_volume:   b.count,
                avg_sentiment:      Number(avgSent.toFixed(3)),
                engagement_total:   b.engSum,
                virality_max_post:  b.engMax,
                severity_breakdown: b.sevCounts,
                scores: {
                    volume:     Number(volNorm.toFixed(3)),
                    sentiment:  Number(sentNorm.toFixed(3)),
                    engagement: Number(engNorm.toFixed(3)),
                    virality:   Number(virNorm.toFixed(3)),
                },
                impact_total: total,
                level:        levelFromScore(total),
            };
        })
        .sort((a, b) => b.impact_total - a.impact_total)
        .slice(0, limit);

    return {
        window: opts.window || '24h',
        cutoff,
        weights: { volume: W_VOL, sentiment: W_SENT, engagement: W_ENG, virality: W_VIR },
        totals: {
            ac_count: rows.length,
            grievance_count: docs.length,
        },
        rows,
    };
};

module.exports = { computeImpact, levelFromScore };
