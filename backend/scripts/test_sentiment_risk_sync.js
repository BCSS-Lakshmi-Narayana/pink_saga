#!/usr/bin/env node
/**
 * test_sentiment_risk_sync.js
 * ─────────────────────────────────────────────────────────────────────
 * End-to-end check of the display contract through analysisService, with both
 * LLM passes stubbed (no network, no DB, no Ollama):
 *
 *   sentiment  = the post's RAW tone (Stage 3 generic_sentiment)
 *   risk       = follows sentiment exactly:
 *                  positive → low 15, neutral → low 20, negative → high 75
 *   stance     = derived from the TARGET (pro/anti client, neutral)
 *
 * plus the review gate (no false conflicts on opposition posts).
 *
 *   node scripts/test_sentiment_risk_sync.js
 */

/* ─── stubs, installed BEFORE the pipeline is required ──────────────── */

const stub = (relPath, exports) => {
    const p = require.resolve(relPath);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

let PASS_A = null;   // Pass A (categorizeText) response
let STAGE_3 = null;  // Stage 3 (constrained extraction) response

stub('../src/services/llmProvider', {
    // Stage 3's prompt asks for "candidate_actors"; everything else is Pass A.
    chatJson: async ({ prompt }) => (String(prompt).includes('candidate_actors') ? STAGE_3 : PASS_A),
    chatCompletion: async () => '',
    invalidateProviderCache: () => {},
    getProvider: async () => 'ollama',
    withForcedProvider: (_p, fn) => fn(),
    extractJson: (t) => { try { return JSON.parse(t); } catch (_) { return null; } },
});
stub('../src/services/mappingService', {
    mappingData: { category_mappings: [{ category_id: 'Normal' }, { category_id: 'Political' }] },
    waitForLoad: async () => {},
    resolveMapping: () => ({ platform_policies: [], legal_sections: [], triggered_keywords: [] }),
});
stub('../src/services/translationService', { translate: async (t) => t });

const { analyzeContent, isAnalysisComplete } = require('../src/services/analysisService');
const { updateFromAnalysis } = require('../src/services/rssAnalysisService');

/* ─── harness ───────────────────────────────────────────────────────── */

let pass = 0;
let fail = 0;
const check = (name, actual, expected) => {
    const ok = actual === expected;
    if (ok) pass += 1; else fail += 1;
    console.log(`${ok ? 'PASS' : '*** FAIL'}  ${name}${ok ? '' : `  (got "${actual}", exp "${expected}")`}`);
};

const passA = (sentiment, targetParty = null) => ({
    category: 'Political', grievance_type: 'Normal', sentiment, risk_level: 'low', risk_score: 10,
    target_party: targetParty, reasoning: 'stub', confidence: { classification: 0.9, sentiment: 0.9, topic: 0.9 },
});
const stage3 = ({ target = null, targetTone = 'neutral', generic = 'neutral', actors = [], subjects = [] }) => ({
    english_translation: '', candidate_actors: actors.map((text) => ({ text })),
    candidate_subjects: subjects.map((text) => ({ text })),
    sentiment_target: target ? { text: target } : null,
    reasoning: 'stub reasoning', target_tone: targetTone, generic_sentiment: generic,
    emotion: 'neutral', language_detected: 'english', confidence: 0.9,
});

const RISK = { positive: ['low', 15], neutral: ['low', 20], negative: ['high', 75] };
const CLIENT_LABEL = {
    pro_target: 'pro client', pro_target_indirect: 'pro client',
    anti_target: 'anti client', anti_target_indirect: 'anti client',
    neutral: 'neutral', unrelated: 'neutral',
};

const run = async (title, text, author, a, s3, expect) => {
    console.log(`\n=== ${title} ===`);
    PASS_A = a;
    STAGE_3 = s3;
    const r = await analyzeContent(text, { platform: 'x', authorHandle: author, skipForensics: true });
    const la = r.llm_analysis || {};
    const [level, score] = RISK[expect.sentiment];
    check('sentiment is the raw tone', r.sentiment, expect.sentiment);
    check('llm_analysis.sentiment = raw tone', la.sentiment, expect.sentiment);
    check('generic_sentiment = raw tone', la.generic_sentiment, expect.sentiment);
    check('risk level follows sentiment', r.risk_level, level);
    check('risk score follows sentiment', r.risk_score, score);
    check('stance label', CLIENT_LABEL[la.political_stance], expect.stance);
    if (expect.review !== undefined) check(`needs review (${(la.validation?.reasons || []).join(',') || 'none'}; conf ${JSON.stringify(la.confidence)})`, !!la.needs_review, expect.review);
    return la;
};

(async () => {
    // ── the display contract ──────────────────────────────────────────
    await run('Praise of the CM → positive / low / pro client',
        'CM Vishnu Deo Sai inaugurated the new Raipur expressway link today. Great relief for commuters!', 'citizen_a',
        passA('positive', 'OUR_GROUP'),
        stage3({ target: 'Vishnu Deo Sai', targetTone: 'positive', generic: 'positive', actors: ['Vishnu Deo Sai'] }),
        { sentiment: 'positive', stance: 'pro client', review: false });

    await run('Attack on the CM → negative / high / anti client',
        'The Sai government has sold Chhattisgarh to coal miners. Shame!', 'citizen_b',
        passA('negative', 'OUR_GROUP'),
        stage3({ target: 'Vishnu Deo Sai', targetTone: 'negative', generic: 'negative', actors: ['Vishnu Deo Sai'] }),
        { sentiment: 'negative', stance: 'anti client', review: false });

    await run('Attack on Congress → negative / high / PRO client',
        'Congress looted Chhattisgarh for 5 years and now pretends to care.', 'citizen_c',
        passA('negative', 'OPPOSITION'), // Pass A reports the raw tone here — must not trigger review
        stage3({ target: 'Congress', targetTone: 'negative', generic: 'negative', actors: ['Congress'] }),
        { sentiment: 'negative', stance: 'pro client', review: false });

    await run('Praise of the opposition → positive / low / ANTI client',
        'Charan Das Mahant has done excellent work raising the water problem. Salute!', 'citizen_d',
        passA('positive', 'OPPOSITION'),
        stage3({ target: 'Charan Das Mahant', targetTone: 'positive', generic: 'positive', actors: ['Charan Das Mahant'] }),
        { sentiment: 'positive', stance: 'anti client' });

    await run('Civic complaint naming nobody → negative / high / anti client',
        'No water supply in Tatibandh for 4 days. Residents are suffering.', 'citizen_e',
        passA('negative'),
        stage3({ targetTone: 'neutral', generic: 'negative', subjects: ['residents'] }),
        { sentiment: 'negative', stance: 'anti client' });

    await run('Festival greeting → positive / low / neutral, no review',
        'Wishing everyone a very happy Ganesh Chaturthi!', 'citizen_f',
        passA('positive'),
        stage3({ targetTone: 'neutral', generic: 'positive' }),
        { sentiment: 'positive', stance: 'neutral', review: false });

    await run('Weather news → neutral / low / neutral',
        'Heavy rains expected in Bastar tomorrow, yellow alert issued.', 'citizen_g',
        passA('neutral'),
        stage3({ targetTone: 'neutral', generic: 'neutral' }),
        { sentiment: 'neutral', stance: 'neutral' });

    await run('Target tone unclear, raw mood positive → pro client (raw fallback)',
        'Minister Shyam Bihari Jaiswal announced a new cancer wing at Mekahara, a big step forward.', 'citizen_h',
        passA('positive', 'OUR_GROUP'),
        stage3({ target: 'Shyam Bihari Jaiswal', targetTone: 'neutral', generic: 'positive', actors: ['Shyam Bihari Jaiswal'] }),
        { sentiment: 'positive', stance: 'pro client' });

    // ── review gate: a real conflict on a direct post IS flagged ─────────
    const la = await run('Direct conflict (Pass A positive, Stage 4 anti client) → review',
        'Vishnu Deo Sai failed Chhattisgarh completely on jobs.', 'citizen_i',
        passA('positive', 'OUR_GROUP'),
        stage3({ target: 'Vishnu Deo Sai', targetTone: 'negative', generic: 'negative', actors: ['Vishnu Deo Sai'] }),
        { sentiment: 'negative', stance: 'anti client', review: true });
    check('review reason is client_sentiment_conflict', (la.validation?.reasons || []).includes('client_sentiment_conflict'), true);

    // ── mixed posts: praise for one side, attack on the other ────────────
    // The model paired the praised leader with the attack's tone; its own
    // praised/criticised lists correct it.
    await run('Praised opposition leader mis-paired with negative tone → corrected to anti client',
        'Bhupesh Baghel gave a brilliant speech in the Assembly and exposed the government.', 'citizen_j',
        passA('positive', 'OPPOSITION'),
        { ...stage3({ target: 'Bhupesh Baghel', targetTone: 'negative', generic: 'positive', actors: ['Bhupesh Baghel'] }),
          praised: [{ text: 'Bhupesh Baghel' }], criticised: [{ text: 'the government' }] },
        { sentiment: 'positive', stance: 'anti client' });

    // "the government" names nobody, but in a state post it is the state
    // government — the client's. Unresolved, the stance fell back to Baghel.
    await run('Bare "the government" target resolves to the client government → anti client',
        'Bhupesh Baghel exposed the government in the Assembly today.', 'citizen_k',
        passA('negative', 'OUR_GROUP'),
        stage3({ target: 'the government', targetTone: 'negative', generic: 'negative', actors: ['Bhupesh Baghel'] }),
        { sentiment: 'negative', stance: 'anti client' });

    // ── completeness: an incomplete analysis must never pass as a verdict ──
    console.log('\n=== Completeness gate ===');
    {
        PASS_A = passA('negative', 'OUR_GROUP');
        STAGE_3 = stage3({ target: 'Vishnu Deo Sai', targetTone: 'negative', generic: 'negative', actors: ['Vishnu Deo Sai'] });
        const ok = await analyzeContent('Vishnu Deo Sai failed the state completely on jobs and roads.', { platform: 'x', authorHandle: 'gate_a', skipForensics: true });
        check('full model analysis → analysis_complete', ok.analysis_complete, true);
        check('full model analysis → isAnalysisComplete', isAnalysisComplete(ok), true);

        PASS_A = null; // Pass A model call failed
        STAGE_3 = stage3({ target: 'Vishnu Deo Sai', targetTone: 'negative', generic: 'negative', actors: ['Vishnu Deo Sai'] });
        const noA = await analyzeContent('Vishnu Deo Sai has failed everyone, says a resident of the capital.', { platform: 'x', authorHandle: 'gate_b', skipForensics: true });
        check('Pass A failure → not complete', isAnalysisComplete(noA), false);
        check('Pass A failure → reason recorded', (noA.analysis_incomplete_reasons || []).includes('pass_a_failed'), true);

        PASS_A = passA('negative', 'OUR_GROUP');
        STAGE_3 = null; // Stage 3 model call failed → keyword fallback
        const noS3 = await analyzeContent('Vishnu Deo Sai must resign over the scam, says the opposition.', { platform: 'x', authorHandle: 'gate_c', skipForensics: true });
        check('stance fallback → not complete', isAnalysisComplete(noS3), false);
        check('stance fallback → reason recorded', (noS3.analysis_incomplete_reasons || []).includes('stance_llm_fallback'), true);

        // An incomplete result must not be cached: the same text re-analysed
        // with the model back must come out complete.
        PASS_A = passA('negative', 'OUR_GROUP');
        STAGE_3 = stage3({ target: 'Vishnu Deo Sai', targetTone: 'negative', generic: 'negative', actors: ['Vishnu Deo Sai'] });
        const retried = await analyzeContent('Vishnu Deo Sai must resign over the scam, says the opposition.', { platform: 'x', authorHandle: 'gate_c', skipForensics: true });
        check('retry after fallback is a fresh, complete analysis', isAnalysisComplete(retried) && !retried.from_text_cache, true);
    }

    // ── news articles: same contract through rssAnalysisService ──────────
    const news = async (title, text, a, s3, expect) => {
        console.log(`\n=== News: ${title} ===`);
        PASS_A = a;
        STAGE_3 = s3;
        const r = await analyzeContent(text, { platform: 'news', authorHandle: 'Haribhoomi', skipForensics: true });
        const u = updateFromAnalysis(r);
        const [level, score] = RISK[expect.sentiment];
        check('article sentiment is the raw tone', u.sentiment, expect.sentiment);
        check('article generic_sentiment = raw tone', u.generic_sentiment, expect.sentiment);
        check('article risk level follows sentiment', u.risk_level, level);
        check('article risk score follows sentiment', u.risk_score, score);
        check('article stance label', CLIENT_LABEL[u.political_stance], expect.stance);
        if (expect.target) check('article target_sentiment (client-relative)', u.target_sentiment, expect.target);
    };

    await news('Congress scam report → negative / high / PRO client',
        'Report exposes liquor scam during the Congress regime in Chhattisgarh; party leaders face probe.',
        passA('negative', 'OPPOSITION'),
        stage3({ target: 'Congress', targetTone: 'negative', generic: 'negative', actors: ['Congress'] }),
        { sentiment: 'negative', stance: 'pro client', target: 'positive' });

    await news('CM project inauguration → positive / low / pro client',
        'CM Vishnu Deo Sai inaugurates new hospital block in Jashpur.',
        passA('positive', 'OUR_GROUP'),
        stage3({ target: 'Vishnu Deo Sai', targetTone: 'positive', generic: 'positive', actors: ['Vishnu Deo Sai'] }),
        { sentiment: 'positive', stance: 'pro client', target: 'positive' });

    await news('Opposition attacks government → negative / high / anti client',
        'Congress slams Sai government over mining mess and unemployment.',
        passA('negative', 'OUR_GROUP'),
        stage3({ target: 'Vishnu Deo Sai', targetTone: 'negative', generic: 'negative', actors: ['Congress', 'Vishnu Deo Sai'] }),
        { sentiment: 'negative', stance: 'anti client', target: 'negative' });

    await news('Weather bulletin → neutral / low / neutral',
        'IMD issues orange alert for Chhattisgarh as monsoon intensifies.',
        passA('neutral'),
        stage3({ targetTone: 'neutral', generic: 'neutral' }),
        { sentiment: 'neutral', stance: 'neutral' });

    console.log(`\n================  ${pass} passed, ${fail} failed  ================`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
