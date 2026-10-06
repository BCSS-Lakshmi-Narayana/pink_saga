/**
 * entityResolver.js — canonicalizes the Stage 3 extractor's raw actor/target
 * strings against the political roster, returning an alignment per candidate.
 *
 * Resolution order (first hit wins):
 *   1. Stage 2's `mentioned_entities` — already matched against the ORIGINAL
 *      text, so this is the highest-confidence path.
 *   2. A full-roster alias lookup on the candidate's raw text. This is the one
 *      that matters most in practice: Stage 1 pre-translates Telugu to English,
 *      so the LLM hands back an ENGLISH actor name, while Stage 2 only sees
 *      the original Telugu. A leader with no curated Telugu alias is invisible
 *      to (1) but resolvable here.
 *   3. An optional operator-maintained CSV override.
 *
 * There is deliberately NO "short name" heuristic fallback. Accepting any
 * <=6-character string as its own canonical entity (as an earlier design did)
 * manufactures an unaligned pseudo-entity for words like "govt" or "cm", which
 * then occupies the actor slot and blocks the real entity behind it.
 */

const fs = require('fs');
const path = require('path');
const { POLITICAL_ENTITIES, findAliasMatches, resolveEntityKey } = require('../config/politicalEntities');
const { OUR_PARTY } = require('../config/politicalData');
const { STATE_NAME, STATE_NAME_NATIVE } = require('../config/deployment');

/** The whole candidate is a generic "the (state) government", optionally naming this state. */
const GENERIC_STATE_GOVERNMENT_RX = new RegExp(
    '^\\s*(?:(?:the|this|our|current|present|ruling|state|a)\\s+)*(?:state\\s+)?(?:government|govt\\.?|sarkar|sarkaar|administration)'
    + `(?:\\s+of\\s+${STATE_NAME})?\\s*$`
    + `|^\\s*(?:${STATE_NAME}\\s+)(?:government|govt\\.?|sarkar)\\s*$`
    + `|^\\s*(?:यह\\s+|इस\\s+|ये\\s+|हे\\s+|राज्य\\s+|प्रदेश\\s+|${STATE_NAME_NATIVE}\\s+)?सरकार\\s*$`,
    'i',
);

/**
 * Optional CSV of manual actor→affiliation overrides, for names the roster does
 * not carry (a district-level functionary, a recurring commentator). Format:
 *   actor,affiliation
 *   some person,opposition
 * Absent file ⇒ empty map, which is the normal case.
 */
const ACTOR_MAP_PATH = path.join(__dirname, '..', '..', 'evaluation', 'actor_affiliation_map.csv');

const loadActorMap = () => {
    try {
        const csv = fs.readFileSync(ACTOR_MAP_PATH, 'utf8');
        const map = {};
        for (const line of csv.split(/\r?\n/).slice(1)) {
            if (!line.trim()) continue;
            const [actor, affiliation] = line.split(',');
            if (!actor) continue;
            const aff = String(affiliation || '').trim().toLowerCase();
            if (!['ally', 'opposition', 'neutral'].includes(aff)) continue;
            map[String(actor).trim().toLowerCase()] = aff;
        }
        return map;
    } catch (err) {
        return {};
    }
};

const ACTOR_MAP = loadActorMap();

const nameWords = (s) => ` ${String(s || '').toLowerCase().replace(/^@+/, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()} `;

/**
 * A bare surname or first name ("Baghel", "Sai") is ambiguous across the
 * roster — four Baghels span both camps — so on its own it resolves to no one,
 * and the stance engine then falls back to whichever OTHER actor it can place,
 * pinning the tone on the wrong person. When exactly one person the post names
 * outright (by handle or full name — ctx.mentioned_entities) carries all of
 * the candidate's words in their name or aliases, that is who is meant.
 */
const fromMentioned = (rawText, mentioned) => {
    const words = nameWords(rawText).trim().split(' ').filter((w) => w.length >= 3);
    if (!words.length) return null;
    const hits = new Map();
    for (const e of mentioned) {
        const ent = POLITICAL_ENTITIES[e.key];
        if (!ent) continue;
        const names = [ent.canonical, ...(ent.aliases || [])].map(nameWords);
        if (words.every((w) => names.some((n) => n.includes(` ${w} `)))) hits.set(e.key, ent);
    }
    if (hits.size !== 1) return null;
    const [key, ent] = [...hits][0];
    return { key, canonical: ent.canonical, affiliation: ent.alignment || null, confidence: 0.8 };
};

/**
 * Match a candidate's raw text against the FULL roster.
 *
 * `findAliasMatches` returns matches longest-alias-first, so "k chandrashekar rao"
 * beats a bare "sai". An alias claimed by several entities (a shared surname)
 * resolves to the highest-priority claimant but carries reduced confidence, so
 * the confidence gate can route it to review.
 */
const matchRosterEntity = (rawText) => {
    if (!rawText) return null;
    const matches = findAliasMatches(rawText);
    if (!matches.length) return null;

    const best = matches[0];
    const entityKey = best.entityKeys[0];
    const ent = POLITICAL_ENTITIES[entityKey];
    if (!ent) return null;

    return {
        key: entityKey,
        canonical: ent.canonical,
        affiliation: ent.alignment || null,
        confidence: best.ambiguous ? 0.65 : 0.85,
    };
};

/**
 * @param {Array<{text:string, span?:*}>} candidates raw extractor output
 * @param {object} ctx politicalContextService snapshot
 * @returns {Array<{text, span, key, canonical, affiliation, confidence}>}
 */
const resolve = (candidates = [], ctx = {}) => {
    const resolved = [];

    for (const candidate of candidates || []) {
        const rawText = String((candidate && candidate.text) || '').trim();
        if (!rawText) continue;

        const key = rawText.toLowerCase();
        let entityKey = null;
        let canonical = null;
        let affiliation = null;
        let confidence = 0.5;

        // 1. Stage 2 pre-scan — matched against the original text.
        const mentioned = Array.isArray(ctx.mentioned_entities) ? ctx.mentioned_entities : [];
        const hit = mentioned.find((e) => String(e.canonical || '').toLowerCase() === key
            || String(e.key || '').toLowerCase() === key);
        if (hit) {
            entityKey = hit.key || null;
            canonical = hit.canonical;
            affiliation = hit.alignment || null;
            confidence = 0.9;
        }

        // 2. Full-roster alias lookup on the (usually translated) raw text. A
        //    bare name that is ambiguous there, or unknown, is settled by the
        //    people the post names outright (fromMentioned).
        if (!canonical) {
            let rosterHit = matchRosterEntity(rawText);
            if (!rosterHit || rosterHit.confidence < 0.85) rosterHit = fromMentioned(rawText, mentioned) || rosterHit;
            if (rosterHit) {
                entityKey = rosterHit.key;
                canonical = rosterHit.canonical;
                affiliation = rosterHit.affiliation;
                confidence = rosterHit.confidence;
            }
        }

        // 3. Operator CSV override.
        if (!canonical && ACTOR_MAP[key]) {
            canonical = rawText;
            affiliation = ACTOR_MAP[key];
            confidence = 0.8;
        }

        // 4. A bare reference to "the government" ("this government", "state
        //    govt", "सरकार", "प्रदेश सरकार") means the state government, which is
        //    the client's. Without this, "X exposed the government" leaves the
        //    target unresolved and the stance falls back to X — inverting it.
        //    Named governments ("Congress government", "Revanth sarkar") already
        //    resolved above through their aliases; central/union references
        //    are deliberately not matched.
        if (!canonical && GENERIC_STATE_GOVERNMENT_RX.test(rawText)) {
            entityKey = POLITICAL_ENTITIES.state_government ? 'state_government' : OUR_PARTY.id;
            canonical = `Government of ${STATE_NAME}`;
            affiliation = 'ally';
            confidence = 0.7;
        }

        // Unresolved candidates are still returned — with a null affiliation and
        // low confidence — so the stance engine can see that something was
        // extracted but could not be placed, and the confidence gate can react.
        resolved.push({
            text: candidate.text,
            span: candidate.span,
            key: entityKey ? resolveEntityKey(entityKey) : null,
            canonical,
            affiliation,
            confidence: canonical ? confidence : 0.25,
        });
    }

    return resolved;
};

module.exports = { resolve, matchRosterEntity };
