/**
 * clientImpact.js — keeps four different questions from being answered with one number.
 *
 *   A. TONE              how the content reads (raw emotional tone of the whole post)
 *   B. TARGET SENTIMENT  the tone aimed at the identified target entity
 *   C. BRS STANCE        does the post help or hurt the CLIENT (the stance engine's verdict)
 *   D. MODERATION RISK   is the content unsafe (threats, hate, incitement)
 *
 * Until now one value — `risk_level` — followed A. A post saying "the Congress
 * government failed the farmers" is negative TONE, so it was scored HIGH risk and
 * counted as hostile, although for BRS it is favourable (stance pro_target_indirect).
 * `risk_level` / `risk_score` keep their meaning for compatibility (they drive the
 * Alerts page's Negative/Neutral/Positive pills and every existing aggregate) and
 * are now documented as TONE bands. Anything that asks "is this hostile to BRS?"
 * must ask C, through this module.
 *
 * Pure functions, no I/O.
 */

const { clientStance } = require('./stanceVocabulary');

const TONES = ['positive', 'negative', 'neutral'];
const normTone = (t) => {
    const v = String(t || '').toLowerCase().trim();
    if (v === 'moderate') return 'neutral';
    return TONES.includes(v) ? v : 'neutral';
};

/** The tone bands `risk_level` has always carried (kept so existing UI/aggregates do not change). */
const toneRisk = (tone) => {
    switch (normTone(tone)) {
        case 'negative': return { level: 'high', score: 75 };
        case 'positive': return { level: 'low', score: 15 };
        default: return { level: 'low', score: 20 };
    }
};

/**
 * @param {object} p
 * @param {string} p.tone              raw tone of the whole post
 * @param {string} p.stance            stance engine verdict (any vocabulary)
 * @param {string} [p.target_sentiment] client-relative sentiment label
 * @param {string} [p.moderation_level] Pass-A moderation risk ('low'|'medium'|'high'), if known
 * @param {boolean}[p.hate_speech]
 * @returns {{
 *   tone_band: 'low'|'high',            // legacy risk_level (tone-based), unchanged
 *   moderation_risk: 'low'|'medium'|'high',
 *   brs_stance: 'pro_client'|'anti_client'|'neutral_client'|'mixed_client',
 *   client_impact: 'favourable'|'adverse'|'neutral'|'mixed',
 *   hostile_to_client: boolean,         // the ONLY flag client-facing "hostile" counts may use
 *   note: string,
 * }}
 */
const deriveClientImpact = ({ tone, stance, moderation_level = null, hate_speech = false } = {}) => {
    const brs = clientStance(stance);
    const t = normTone(tone);
    const impact = brs === 'pro_client' ? 'favourable'
        : brs === 'anti_client' ? 'adverse'
            : brs === 'mixed_client' ? 'mixed' : 'neutral';

    let moderation = ['low', 'medium', 'high'].includes(String(moderation_level)) ? String(moderation_level) : 'low';
    if (hate_speech) moderation = 'high';

    return {
        tone_band: toneRisk(t).level,
        moderation_risk: moderation,
        brs_stance: brs,
        client_impact: impact,
        hostile_to_client: brs === 'anti_client',
        note: t === 'negative' && brs === 'pro_client'
            ? 'negative tone, favourable to BRS (a rival is criticised) — tone band is high but this is not hostile to the client'
            : t === 'positive' && brs === 'anti_client'
                ? 'positive tone, adverse to BRS (a rival is praised or BRS is damaged) — tone band is low but this is hostile to the client'
                : '',
    };
};

module.exports = { deriveClientImpact, toneRisk, normTone };
