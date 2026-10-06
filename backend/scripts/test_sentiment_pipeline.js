#!/usr/bin/env node
/**
 * End-to-end test of the target-aware sentiment pipeline, with the LLM stubbed.
 *
 *   node scripts/test_sentiment_pipeline.js
 *
 * Covers what `test_stance_engine.js` cannot: the WIRING between the stages.
 * The stance engine can be perfect and the pipeline still wrong if Stage 2 does
 * not resolve the author, Stage 3 does not pass `target_tone` to the matrix, or
 * the result object drops a field on its way to the DB.
 *
 * No network, no DB, no real LLM — `llmProvider.chatJson` is replaced in the
 * require cache before the pipeline is loaded, so each case controls exactly
 * what the "model" returned.
 */

const path = require('path');

/* ─── stub the LLM provider BEFORE anything requires it ─────────────── */

const llmProviderPath = require.resolve('../src/services/llmProvider');
let STUB_RESPONSE = null;
let lastPrompt = '';

require.cache[llmProviderPath] = {
    id: llmProviderPath,
    filename: llmProviderPath,
    loaded: true,
    exports: {
        /**
         * NOTE: consumers destructure this (`const { chatJson } = require(...)`),
         * so they capture THIS function object once at load time. Reassigning
         * `exports.chatJson` later would not reach them. All per-case control
         * therefore goes through the mutable `STUB_RESPONSE` below — which may
         * be a value, an Error to throw, or a function of the prompt.
         */
        chatJson: async ({ prompt }) => {
            lastPrompt = prompt;
            if (STUB_RESPONSE instanceof Error) throw STUB_RESPONSE;
            if (typeof STUB_RESPONSE === 'function') return STUB_RESPONSE(prompt);
            return STUB_RESPONSE;
        },
        chatCompletion: async () => '',
        invalidateProviderCache: () => {},
    },
};

const { buildPoliticalContext } = require('../src/services/politicalContextService');
const { analyzePoliticalSentiment } = require('../src/services/politicalSentimentService');

/* ─── harness ───────────────────────────────────────────────────────── */

let pass = 0;
let fail = 0;

const check = (name, actual, expected) => {
    const ok = actual === expected;
    if (ok) pass += 1; else fail += 1;
    console.log(`${ok ? 'PASS' : '*** FAIL'}  ${name}${ok ? '' : `  (got "${actual}", exp "${expected}")`}`);
};

const truthy = (name, actual) => {
    const ok = !!actual;
    if (ok) pass += 1; else fail += 1;
    console.log(`${ok ? 'PASS' : '*** FAIL'}  ${name}${ok ? '' : `  (got "${actual}")`}`);
};

const run = async (text, { author = '', keyword = '', platform = 'x' } = {}, stub) => {
    STUB_RESPONSE = stub;
    const ctx = buildPoliticalContext(text, { authorHandle: author, taggedKeyword: keyword, platform });
    const verdict = await analyzePoliticalSentiment(text, ctx);
    return { ctx, verdict };
};

/* ─── the two posts that exposed the original defect ────────────────── */

(async () => {
    console.log('\n=== 1. Opposition ultimatum aimed at OUR government ===');
    console.log('    "The promises made to employees by the BRS leadership must be');
    console.log('     fulfilled — otherwise Congress will fight on their behalf."');
    {
        // The model returns the SPEAKER as the target (its most common failure),
        // and reads the ultimatum's whole-post mood as merely neutral.
        const { ctx, verdict } = await run(
            'The promises made to employees, teachers and pensioners by the BRS leadership must be fulfilled — otherwise Congress will fight on their behalf.',
            { author: '@INCTelangana' },
            {
                english_translation: 'The promises ... must be fulfilled, otherwise Congress will fight.',
                candidate_actors: [{ text: 'Congress' }, { text: 'K Chandrashekar Rao' }],
                candidate_subjects: [{ text: 'employees' }, { text: 'teachers' }],
                sentiment_target: { text: 'Congress' },      // ← WRONG: the speaker
                reasoning: 'The party is demanding the government fulfil its promises.',
                target_tone: 'negative',                   // ← but the tone IS extracted right
                generic_sentiment: 'neutral',
                emotion: 'frustration',
                language_detected: 'english',
            },
        );

        check('author resolves to the opposition', ctx.author_alignment, 'opposition');
        check('both camps detected', String(ctx.mentioned_entities.length >= 2), 'true');
        // The author-is-target correction must fire: target==author's own camp,
        // negative tone, opposite camp present ⇒ re-point at our side.
        check('stance', verdict.stance, 'anti_target');
        check('target_sentiment', verdict.target_sentiment, 'negative');
        check('bsk_sentiment mirror agrees', verdict.bsk_sentiment, verdict.target_sentiment);
        check('beneficiary', verdict.beneficiary, 'opposition');
        truthy('rationale names the correction', /author-is-target/.test(verdict.narrative_direction));
    }

    console.log('\n=== 2. Opposition MLA: supports farmers WHILE attacking the government ===');
    console.log('    Whole-post mood reads positive; tone AT the government is negative.');
    {
        const { verdict } = await run(
            'I fully support the farmers\' just fight. The BRS leadership\'s ill-considered order must be withdrawn immediately. Instead of solving their problems they are crushing them with police arrests.',
            { author: '@INCTelangana' },
            {
                english_translation: '...',
                candidate_actors: [{ text: 'K Chandrashekar Rao' }],
                candidate_subjects: [{ text: 'farmers' }],
                sentiment_target: { text: 'K Chandrashekar Rao' },
                reasoning: 'Expresses support for farmers while demanding the government withdraw its order and condemning police action.',
                target_tone: 'negative',      // ← the field that fixes this class
                generic_sentiment: 'positive', // ← whole-post mood genuinely looks positive
                emotion: 'anger',
                language_detected: 'english',
            },
        );

        check('stance uses target_tone, not whole-post mood', verdict.stance, 'anti_target');
        check('target_sentiment', verdict.target_sentiment, 'negative');
        check('generic_sentiment preserved for display', verdict.generic_sentiment, 'positive');
        check('target_tone persisted', verdict.target_tone, 'negative');
        truthy('target entity resolved to the party president',
            /K\.?\s*Chandrashekar Rao/i.test(verdict.target_entity_canonical || ''));
    }

    console.log('\n=== 3. CONTROL: our own account attacking the opposition (must not invert) ===');
    {
        const { verdict } = await run(
            'Congress looted Telangana for years and left the state bankrupt.',
            { author: '@BRSparty' },
            {
                candidate_actors: [{ text: 'Congress' }],
                candidate_subjects: [],
                sentiment_target: { text: 'Congress' },
                reasoning: 'Accuses the opposition party of looting the state.',
                target_tone: 'negative',
                generic_sentiment: 'negative',
                emotion: 'anger',
                language_detected: 'english',
            },
        );
        check('stance', verdict.stance, 'pro_target_indirect');
        check('target_sentiment (good news for the client)', verdict.target_sentiment, 'positive');
        check('generic tone stays negative — THE ONE RULE', verdict.generic_sentiment, 'negative');
    }

    console.log('\n=== 4. Cross-camp prior: opponent "praising" our side → review, not good news ===');
    {
        const { verdict } = await run(
            'K Chandrashekar Rao has done a wonderful job, truly remarkable governance.',
            { author: '@INCTelangana' },
            {
                candidate_actors: [{ text: 'K Chandrashekar Rao' }],
                candidate_subjects: [],
                sentiment_target: { text: 'K Chandrashekar Rao' },
                reasoning: 'Appears to praise the Chief Minister.',
                target_tone: 'positive',
                generic_sentiment: 'positive',
                emotion: 'joy',
                language_detected: 'english',
            },
        );
        check('downgraded to neutral rather than asserting PRO_CLIENT', verdict.stance, 'neutral');
        check('target_sentiment', verdict.target_sentiment, 'neutral');
        truthy('rationale records the prior', /cross-camp prior/.test(verdict.narrative_direction));
    }

    console.log('\n=== 5. SAFETY: ally account praising our CM must stay positive ===');
    {
        const { verdict } = await run(
            'K Chandrashekar Rao has done a wonderful job, truly remarkable governance.',
            { author: '@BRSparty' },
            {
                candidate_actors: [{ text: 'K Chandrashekar Rao' }],
                candidate_subjects: [],
                sentiment_target: { text: 'K Chandrashekar Rao' },
                reasoning: 'Praises the Chief Minister for his governance.',
                target_tone: 'positive',
                generic_sentiment: 'positive',
                emotion: 'pride',
                language_detected: 'english',
            },
        );
        check('stance', verdict.stance, 'pro_target');
        check('target_sentiment', verdict.target_sentiment, 'positive');
    }

    console.log('\n=== 6. NO TONE MIRRORING: emotional but non-political post ===');
    {
        const { verdict } = await run(
            'What a terrible day, my flight got cancelled and I lost my luggage. Absolutely furious.',
            { author: '@some_traveller' },
            {
                candidate_actors: [],
                candidate_subjects: [],
                sentiment_target: null,
                reasoning: 'Personal complaint about travel, no political content.',
                target_tone: 'neutral',
                generic_sentiment: 'negative',
                emotion: 'anger',
                language_detected: 'english',
            },
        );
        check('client-relative verdict is NOT the text tone', verdict.target_sentiment, 'neutral');
        check('generic tone still recorded honestly', verdict.generic_sentiment, 'negative');
        truthy('stance is neutral or unrelated', ['neutral', 'unrelated'].includes(verdict.stance));
    }

    console.log('\n=== 7. Telugu civic grievance, nobody named -> implicates the ruling govt ===');
    // INVERTED vs a ruling-party build: there this implicated the CLIENT's
    // government; here the government is CONGRESS, so it lands on a rival.
    {
        const { verdict } = await run(
            'తెలంగాణలో మా గ్రామంలో కరెంటు పదే పదే పోతోంది, రోడ్డు గుంతలతో ఉంది. ఎవరూ పట్టించుకోవడం లేదు.',
            { author: '@village_citizen' },
            {
                english_translation: 'We cannot bear the power cuts and potholes in our village. Nobody cares.',
                candidate_actors: [],
                candidate_subjects: [{ text: 'villagers' }],
                sentiment_target: null,
                reasoning: 'Civic complaint about power cuts and road conditions with no one named.',
                target_tone: 'negative',
                generic_sentiment: 'negative',
                emotion: 'frustration',
                language_detected: 'telugu',
            },
        );
        // Favourable to us, because the government it implicates is theirs.
        check('stance', verdict.stance, 'pro_target_indirect');
        check('target_sentiment', verdict.target_sentiment, 'positive');
    }

    console.log('\n=== 7c. Bare surname settled by the tagged handle (100-post audit) ===');
    {
        const { verdict, ctx: ctx7c } = await run(
            '@revanth_anumula odipoyina badha lo mulige undandi Revanth ji prajalaku telusu vaari raksha ke liye KCR sarkar poori tarah mustaid hai',
            { author: '@PuchkiNishh8' },
            {
                english_translation: 'Keep drowning in the sorrow of defeat, Revanth ji; people know the KCRv BRS leadership is fully alert for their safety.',
                candidate_actors: [{ text: '@revanth_anumula' }, { text: 'Revanth Reddy' }, { text: 'KCR' }],
                candidate_subjects: [],
                praised: [],
                criticised: [{ text: 'Revanth Reddy' }],
                sentiment_target: { text: 'Revanth Reddy' },
                reasoning: 'The text mocks Revanth Reddy over his defeat.',
                target_tone: 'negative',
                generic_sentiment: 'negative',
                emotion: 'sarcasm',
            },
        );
        check('mocking Revanth Reddy is SUPPORTIVE of the client', verdict.stance, 'pro_target_indirect');
        check('"aap" (you) is not the AAP party', ctx7c.mentioned_entities.some((e) => e.key === 'aap'), false);
    }

    console.log('\n=== 7d. Reasoning names the praised side when the lists are garbled ===');
    {
        const { verdict } = await run(
            '@revanth_anumula odipoyina badha lo mulige undandi Revanth ji prajalaku telusu vaari raksha ke liye KCR sarkar poori tarah mustaid hai',
            { author: '@PuchkiNishh8' },
            {
                english_translation: 'Keep drowning in the sorrow of defeat; the KCRv BRS leadership is ready.',
                candidate_actors: [{ text: '@revanth_anumula' }, { text: 'KCR' }],
                candidate_subjects: [],
                praised: [],
                criticised: [{ text: 'you keep drowning in the game of hair' }],
                sentiment_target: { text: 'Revanth Reddy' },
                reasoning: 'The text criticises Revanth Reddy while praising KCR and the BRS leadership.',
                target_tone: 'negative',
                generic_sentiment: 'negative',
                emotion: 'sarcasm',
            },
        );
        check('mocking a rival is read as favourable to us, indirectly',
            verdict.stance, 'pro_target_indirect');
    }

    console.log('\n=== 7e. Criticising BOTH camps is not support ===');
    {
        const { verdict } = await run(
            'తెలంగాణలో డ్రామా తప్ప ఏమీ లేదు. కాంగ్రెస్ అదే, బీఆర్ఎస్ అదే, బీజేపీ కూడా అంతే.',
            { author: '@some_voter' },
            {
                english_translation: 'Nothing but drama in Telangana. Congress is the same, BRS is the same, BJP is no different.',
                candidate_actors: [{ text: 'Congress' }, { text: 'BRS' }, { text: 'BJP' }],
                candidate_subjects: [],
                praised: [],
                criticised: [{ text: 'Congress' }, { text: 'BRS' }, { text: 'BJP' }],
                sentiment_target: { text: 'Congress' },
                reasoning: 'The text criticises Congress, BRS and BJP alike.',
                target_tone: 'negative',
                generic_sentiment: 'negative',
                emotion: 'anger',
            },
        );
        check('both camps criticised → neutral', verdict.stance, 'neutral');
    }

    console.log('\n=== 7f. A ceremonial tribute belongs to no camp ===');
    {
        const { verdict } = await run(
            'తెలంగాణ అవతరణ దినోత్సవం సందర్భంగా హైదరాబాద్ గన్ పార్క్ వద్ద తెలంగాణ ఉద్యమ అమరవీరులకు నివాళులు',
            { author: '@sevadalcg' },
            {
                english_translation: 'Tributes to the martyrs of the Telangana movement at Gun Park, Hyderabad, on Telangana Formation Day.',
                candidate_actors: [{ text: 'Revanth Reddy' }],
                candidate_subjects: [],
                praised: [{ text: 'the martyrs of the Telangana movement' }],
                criticised: [],
                sentiment_target: null,
                reasoning: 'A ceremonial tribute on the state formation day.',
                target_tone: 'positive',
                generic_sentiment: 'positive',
                emotion: 'pride',
            },
        );
        check('ceremonial tribute → neutral', verdict.stance, 'neutral');
    }

    console.log('\n=== 7g. A post with no state context is unrelated (Ghana) ===');
    {
        const { verdict } = await run(
            'Cocoa farmers know who brought the fertilizer shortage. She remains pure gold. We (The NPP and Dr Bawumia) are not going anywhere.',
            { author: '@ghansudoku' },
            {
                english_translation: 'Cocoa farmers know who brought the fertilizer shortage. She remains pure gold.',
                candidate_actors: [{ text: 'Hajia Samira' }],
                candidate_subjects: [{ text: 'cocoa farmers' }],
                praised: [{ text: 'Hajia Samira' }],
                criticised: [],
                sentiment_target: { text: 'Hajia Samira' },
                reasoning: 'The text praises Hajia Samira.',
                target_tone: 'positive',
                generic_sentiment: 'positive',
                emotion: 'pride',
            },
        );
        check('foreign post → unrelated', verdict.stance, 'unrelated');
    }

    console.log('\n=== 8. LLM outage → conservative fallback, flagged for review ===');
    {
        const { verdict } = await run(
            'K Chandrashekar Rao addressed the assembly today.',
            { author: '@some_news' },
            new Error('provider unreachable'),
        );
        check('provider', verdict.provider, 'fallback');
        check('fallback does NOT publish a confident verdict', verdict.needs_review, true);
        // The old implementation returned an always-'unrelated' variable here,
        // making the whole heuristic branch dead code.
        check('heuristic branch is live (target mentioned → neutral)', verdict.stance, 'neutral');
    }

    console.log('\n=== 9. Malformed LLM output → falls back, never throws ===');
    {
        const { verdict } = await run(
            'Some text about Mahesh Kumar Goud.',
            { author: '' },
            'this is not json at all',
        );
        check('provider', verdict.provider, 'fallback');
        truthy('still returns a usable verdict', !!verdict.target_sentiment);
    }

    console.log('\n=== 10. Prompt contract: extractor is not asked for a verdict ===');
    {
        await run('test', {}, { candidate_actors: [], sentiment_target: null, generic_sentiment: 'neutral' });
        truthy('prompt asks for sentiment_target', /sentiment_target/.test(lastPrompt));
        truthy('prompt asks for target_tone', /target_tone/.test(lastPrompt));
        truthy('prompt forbids emitting stance', /Do NOT output any client-perspective verdict/.test(lastPrompt));
        truthy('prompt names the governing camp', /BJP/.test(lastPrompt));
        truthy('prompt names the opposition', /INC/.test(lastPrompt));
        truthy('reasoning is requested BEFORE the tone labels',
            lastPrompt.indexOf('"reasoning"') < lastPrompt.indexOf('"target_tone"'));
    }

    /* ─── analyzeContent: the full orchestrator ──────────────────────── */

    console.log('\n=== 11. analyzeContent(): result consolidation + quality gate ===');
    {
        // mappingService reads policy data from Mongo and falls back to a
        // bundled file when there is no DB, which is exactly what happens here.
        const mappingService = require('../src/services/mappingService');
        mappingService.waitForLoad = async () => {};
        mappingService.resolveMapping = () => ({ legal_sections: [], platform_policies: [], triggered_keywords: [] });

        // Neutralise the shared cache so cases cannot leak into one another.
        const cacheService = require('../src/services/cacheService');
        cacheService.get = async () => null;
        cacheService.set = async () => {};

        // translationService would call Google for the non-English case.
        const translationService = require('../src/services/translationService');
        translationService.translate = async (t) => t;

        const { analyzeContent } = require('../src/services/analysisService');

        // Pass A and Stage 3 share one stubbed provider, so the stub must
        // answer both shapes. Pass A is identified by its own field names.
        const PASS_A = {
            category: 'Normal',
            reasoning: 'Pass A: the post is critical of the state government.',
            grievance_type: 'Political Criticism',
            sentiment: 'negative',
            target_party: 'OUR_GROUP',
            risk_level: 'medium',
            risk_score: 40,
            severity: 'medium',
            concerned_department: 'General Administration',
        };
        const STAGE_3 = {
            english_translation: '...',
            candidate_actors: [{ text: 'K Chandrashekar Rao' }],
            candidate_subjects: [],
            sentiment_target: { text: 'K Chandrashekar Rao' },
            reasoning: 'Accuses the government of failing on its promises.',
            target_tone: 'negative',
            generic_sentiment: 'negative',
            emotion: 'anger',
            language_detected: 'english',
        };

        // Dispatch on the PROMPT, not a call counter: analyzeContent issues
        // Pass A and Stage 3 through the same provider, and a counter breaks
        // the moment either stage retries or is skipped by a cache hit.
        // Stage 3's prompt is the only one that mentions `sentiment_target`.
        const isStage3 = (prompt) => /sentiment_target/.test(String(prompt || ''));
        STUB_RESPONSE = (prompt) => (isStage3(prompt) ? STAGE_3 : PASS_A);

        const r = await analyzeContent(
            'The BRS leadership has failed on every promise it made to farmers.',
            { platform: 'x', authorHandle: '@INCTelangana', skipForensics: true },
        );

        check('risk_level derived from target_sentiment', r.risk_level, 'high');
        check('risk_score derived from target_sentiment', r.risk_score, 75);
        check('sentiment is the client-relative verdict', r.sentiment, 'negative');
        check('target_sentiment', r.target_sentiment, 'negative');
        check('bsk_sentiment mirror agrees', r.bsk_sentiment, r.target_sentiment);
        check('generic_sentiment carried separately', r.generic_sentiment, 'negative');
        check('target_tone persisted (not undefined)', r.target_tone, 'negative');
        check('political_stance mirrors stance', r.political_stance, r.stance);
        check('stance', r.stance, 'anti_target');
        truthy('confidence bag present', r.confidence && typeof r.confidence.overall === 'number');
        truthy('validation record present', r.validation && Array.isArray(r.validation.reasons));
        check('validation records the target_tone it used', r.validation.sentiment.target_tone, 'negative');
        truthy('llm_analysis carries target_sentiment for the UI', !!r.llm_analysis.target_sentiment);
        truthy('llm_analysis carries political_stance for the UI', !!r.llm_analysis.political_stance);
        truthy('needs_review is a boolean', typeof r.needs_review === 'boolean');

        // Pass A said negative AND claimed a side (OUR_GROUP); Stage 4 also says
        // negative — they agree, so no conflict must be raised.
        check('agreeing client-relative verdicts raise no conflict',
            r.validation.reasons.includes('client_sentiment_conflict'), false);
    }

    console.log('\n=== 12. analyzeContent(): genuine two-model contradiction blocks ===');
    {
        const { analyzeContent } = require('../src/services/analysisService');
        STUB_RESPONSE = (prompt) => (/sentiment_target/.test(String(prompt || ''))
            // Stage 3/4 concludes this is an attack on our side...
            ? {
                candidate_actors: [{ text: 'K Chandrashekar Rao' }],
                candidate_subjects: [],
                sentiment_target: { text: 'K Chandrashekar Rao' },
                reasoning: 'Condemns the government.',
                target_tone: 'negative',
                generic_sentiment: 'negative',
                emotion: 'anger',
                language_detected: 'english',
            }
            // ...while Pass A picked a side and called it GOOD for the client.
            : { category: 'Normal', reasoning: 'x', sentiment: 'positive', target_party: 'OUR_GROUP', risk_level: 'low', risk_score: 10 });

        const r = await analyzeContent('K Chandrashekar Rao must resign immediately.', {
            platform: 'x', authorHandle: '@INCTelangana', skipForensics: true,
        });

        check('two contradicting CLIENT-RELATIVE verdicts → blocking review',
            r.validation.reasons.includes('client_sentiment_conflict'), true);
        check('needs_review set', r.needs_review, true);
    }

    console.log('\n=== 13. analyzeContent(): expected generic-vs-client difference is NOT blocking ===');
    {
        const { analyzeContent } = require('../src/services/analysisService');
        STUB_RESPONSE = (prompt) => (/sentiment_target/.test(String(prompt || ''))
            ? {
                candidate_actors: [{ text: 'Congress' }],
                candidate_subjects: [],
                sentiment_target: { text: 'Congress' },
                reasoning: 'Accuses the opposition party of corruption.',
                target_tone: 'negative',
                generic_sentiment: 'negative',
                emotion: 'anger',
                language_detected: 'english',
            }
            // Pass A did NOT pick a side, so its sentiment is raw tone.
            : { category: 'Normal', reasoning: 'x', sentiment: 'negative', target_party: 'NEUTRAL', risk_level: 'low', risk_score: 10 });

        const r = await analyzeContent('Congress looted the state treasury.', {
            platform: 'x', authorHandle: '@BRSparty', skipForensics: true,
        });

        check('attack on opposition is good news for the client', r.target_sentiment, 'positive');
        check('generic tone stays negative', r.generic_sentiment, 'negative');
        check('generic-vs-client difference is audit-only',
            r.validation.reasons.includes('client_sentiment_conflict'), false);
        check('...and recorded as a warning',
            r.validation.warnings.includes('sentiment_disagreement'), true);
    }

    console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
    process.exit(fail ? 1 : 0);
})().catch((err) => {
    console.error('\n*** SUITE CRASHED ***');
    console.error(err);
    process.exit(1);
});
