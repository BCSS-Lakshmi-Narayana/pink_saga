/**
 * liveChatBatchAnalyzer.js
 *
 * Client-axis sentiment for YouTube LIVE chat, scored by the LLM in BATCHES.
 *
 * Why this exists instead of reusing politicalSentimentService directly:
 * that service makes one HTTP round-trip per message, which is fine for
 * mentions (tens per minute) but hopeless for live chat (hundreds per minute).
 * At one-call-per-message only ~4 of 30 political comments ever got a verdict
 * before the next chunk arrived, so a keyword guess survived as the final
 * answer. Scoring 25-30 comments in a single call is ~10x the throughput and
 * lets the model — not a word list — decide every one of them.
 *
 * SCOPE: used ONLY by youtubeLiveService. It does not touch, wrap or alter
 * politicalSentimentService / analysisService, so the mentions, alerts and
 * news sentiment flows are completely unaffected.
 */

const { chatJson } = require('./llmProvider');
const {
    STATE_NAME,
    LANGUAGES_DESCRIPTION,
    OUR_CAMP_SUMMARY,
    OUR_CAMP_LEADERS,
    OPPOSITION_SUMMARY,
} = require('../config/deployment');

// Generation, not connectivity, is the constraint: a 7B model emitting ~20 JSON
// rows takes well over the 60s a single-message call needs. Batches are
// background work — the feed already shows a placeholder — so a long ceiling
// costs nothing and prevents a timeout from discarding the whole batch.
const BATCH_TIMEOUT_MS = Number(process.env.YT_LIVE_BATCH_TIMEOUT_MS || 180000);
const MAX_TEXT_CHARS = 220;

/* stance -> the positive/neutral/negative scheme used across the app */
const STANCE_TO_SENTIMENT = {
    pro_client: 'positive',
    anti_client: 'negative',
    neutral: 'neutral',
    unrelated: 'neutral',
};

const ALLOWED_ABOUT = ['ours', 'opposition', 'both', 'none'];
const ALLOWED_TONES = ['praise', 'attack', 'neutral'];

const ALIGNMENT_NOTE = {
    ally: 'This channel is aligned with the ruling camp, so its audience skews pro-government. Judge each comment on its own words regardless.',
    opposition:
        'This channel is opposition-aligned, so many commenters will be praising the opposition or attacking the government. Judge each comment on its own words regardless.',
    neutral: 'This channel is broadly neutral.',
    unknown: '',
};

const sanitize = (s) =>
    String(s || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/"/g, "'")
        .trim()
        .slice(0, MAX_TEXT_CHARS);

/**
 * The prompt deliberately does NOT ask for the final pro/anti verdict.
 *
 * Models are reliable at PERCEPTION ("who is this about, is it praise or
 * abuse?") and unreliable at the INVERSION step. Measured on real chat, asking
 * for the verdict directly produced self-contradictions — abuse of an opposition
 * leader was labelled anti-client, an attack on a client leader pro-client. So the model is
 * asked only for `about` + `tone`, and deriveStance() applies the logic in
 * code, where it is deterministic and cannot be inverted.
 */
const buildPrompt = (items, ctx = {}) => {
    const alignment = ALIGNMENT_NOTE[ctx.channelAlignment] || '';
    const numbered = items.map((it, i) => `${i + 1}. ${sanitize(it.text)}`).join('\n');

    return `You are reading live YouTube chat comments about ${STATE_NAME} politics (India).
Comments are in ${LANGUAGES_DESCRIPTION}, and are often abusive or sarcastic.

THE TWO CAMPS
- Camp "ours": the ruling camp — ${OUR_CAMP_SUMMARY}; leaders ${OUR_CAMP_LEADERS.join(', ')}; the ${STATE_NAME} government.
- Camp "opposition": ${OPPOSITION_SUMMARY}.

For EACH comment report only two observations. Do not judge who it helps — just describe what you see.

"about"  = which camp the comment is directed at:
           "ours"       - it is about the ruling camp, its leaders or the government
           "opposition" - it is about an opposition party or leader
           "both"       - it compares or addresses both camps
           "none"       - no politician or party involved

"tone"   = how the comment treats that camp:
           "praise"  - supports, celebrates, cheers ("jai", "great leader", "viva", "zindabad")
           "attack"  - criticises, abuses, mocks, accuses ("cheater", "chor", "चोर", "fottkiro", "failed")
           "neutral" - a question, a plain statement, a name alone, or no clear feeling

Read the ACTUAL MEANING, not individual words. Slang and profanity aimed at a leader is "attack".
Cheering a leader by name is "praise" even if the wording is plain.
${alignment ? `\nCHANNEL CONTEXT: ${alignment}` : ''}${ctx.videoTitle ? `\nSTREAM TITLE: ${sanitize(ctx.videoTitle)}` : ''}

COMMENTS:
${numbered}

Return ONLY JSON, no prose:
{"results":[{"i":1,"about":"ours|opposition|both|none","tone":"praise|attack|neutral","why":"max 6 words"}]}
Return exactly ${items.length} entries, "i" matching the comment number.`;
};

/**
 * The inversion, done in code so it cannot be got backwards:
 *   attack the opposition  -> good for the client
 *   praise the opposition  -> bad for the client
 */
const deriveStance = (about, tone) => {
    if (about === 'none' || tone === 'neutral') {
        return about === 'none' ? 'unrelated' : 'neutral';
    }
    if (about === 'both') return 'neutral';          // needs a side to be meaningful

    if (about === 'opposition') return tone === 'attack' ? 'pro_client' : 'anti_client';
    if (about === 'ours') return tone === 'praise' ? 'pro_client' : 'anti_client';
    return 'unrelated';
};

const coerce = (row, fallbackIndex) => {
    const i = Number.isFinite(Number(row?.i)) ? Number(row.i) : fallbackIndex + 1;
    const about = ALLOWED_ABOUT.includes(row?.about) ? row.about : 'none';
    const tone = ALLOWED_TONES.includes(row?.tone) ? row.tone : 'neutral';
    const stance = deriveStance(about, tone);

    return {
        index: i - 1,
        about,
        stance,
        sentiment: STANCE_TO_SENTIMENT[stance],
        // Raw emotional tone, kept separate from client-axis sentiment.
        tone: tone === 'praise' ? 'positive' : tone === 'attack' ? 'negative' : 'neutral',
        target_entity: about === 'none' ? null : about,
        reason: String(row?.why || '').trim().slice(0, 120) || null,
    };
};

/**
 * Score a batch of comments in one LLM call.
 *
 * @param {Array<{id:string, text:string}>} items
 * @param {{channelAlignment?:string, videoTitle?:string}} ctx
 * @returns {Promise<Map<string, object>>} message id -> verdict (missing ids = no verdict)
 */
const analyzeBatch = async (items, ctx = {}) => {
    const out = new Map();
    const usable = (items || []).filter((it) => it && it.id && String(it.text || '').trim());
    if (!usable.length) return out;

    const raw = await chatJson({
        prompt: buildPrompt(usable, ctx),
        temperature: 0.1,
        maxTokens: Math.min(4000, 120 * usable.length + 400),
        timeoutMs: BATCH_TIMEOUT_MS,
    });

    // Providers occasionally hand back a bare array instead of {results:[…]}.
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : null;
    if (!rows || !rows.length) return out;

    for (let n = 0; n < rows.length; n++) {
        const v = coerce(rows[n], n);
        const item = usable[v.index];
        // A hallucinated index would otherwise write a verdict onto the wrong
        // comment, which is worse than having no verdict at all.
        if (!item) continue;
        out.set(item.id, v);
    }

    return out;
};

module.exports = {
    analyzeBatch,
    // exported for tests
    buildPrompt,
    deriveStance,
    STANCE_TO_SENTIMENT,
};
