/**
 * Re-scores stored YouTube LIVE chat through the current pipeline:
 *   1. lexicon pass (client-axis, target-aware)  — every message
 *   2. batched LLM pass                        — political messages only
 *
 * Use after a change to the polarity rules, the prompt, or the entity graph.
 * Messages carrying the retired `pro_bsk` / `anti_bsk` stance vocabulary were
 * scored by the old per-message path and are the main reason to run this.
 *
 *   node scripts/rescore_live_chat.js              # everything
 *   node scripts/rescore_live_chat.js --stale-only # only old-vocabulary rows
 *   node scripts/rescore_live_chat.js --lexicon    # skip the LLM
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const LiveChatMessage = require('../src/models/LiveChatMessage');
const LiveStream = require('../src/models/LiveStream');
const { analyzeFast, enforceBatchConsistency, resyncStreamCounts } = require('../src/services/youtubeLiveService');
const { analyzeBatch } = require('../src/services/liveChatBatchAnalyzer');

const STALE_ONLY = process.argv.includes('--stale-only');
const LEXICON_ONLY = process.argv.includes('--lexicon');
const BATCH = Number(process.env.YT_LIVE_LLM_BATCH_SIZE || 20);

const OLD_STANCES = ['pro_bsk', 'pro_bsk_indirect', 'anti_bsk', 'anti_bsk_indirect', 'neutral', 'unrelated'];

const SENTIMENT_TO_RISK = { negative: 'high', moderate: 'medium', positive: 'low' };

(async () => {
    await connectDB();

    const filter = STALE_ONLY ? { stance: { $in: OLD_STANCES } } : {};
    const msgs = await LiveChatMessage.find(filter).lean();
    console.log(`Re-scoring ${msgs.length} message(s)${STALE_ONLY ? ' with stale stance vocabulary' : ''}\n`);
    if (!msgs.length) { await mongoose.disconnect(); process.exit(0); }

    /* ── pass 1: lexicon ── */
    const ctxById = new Map();
    const lexOps = [];
    for (const m of msgs) {
        const { ctx, fields } = analyzeFast(m.text);
        ctxById.set(m.id, { ctx, tone: fields.tone });
        lexOps.push({
            updateOne: {
                filter: { _id: m._id },
                update: {
                    $set: {
                        sentiment: fields.sentiment,
                        tone: fields.tone,
                        sentiment_score: fields.sentiment_score,
                        is_political: fields.is_political,
                        political_relevance: fields.political_relevance,
                        matched_entities: fields.matched_entities,
                        target_entity: fields.target_entity,
                        risk_level: fields.risk_level,
                        stance: null,
                        analysis_provider: 'lexicon',
                        analysis_reason: null,
                    },
                },
            },
        });
    }
    await LiveChatMessage.bulkWrite(lexOps, { ordered: false });
    console.log(`Pass 1 (lexicon): ${lexOps.length} updated`);

    if (LEXICON_ONLY) {
        for (const s of await LiveStream.find().lean()) await resyncStreamCounts(s.id);
        console.log('Done (lexicon only).');
        await mongoose.disconnect();
        process.exit(0);
    }

    /* ── pass 2: batched LLM over political messages ── */
    const political = await LiveChatMessage.find(
        STALE_ONLY ? { _id: { $in: msgs.map((m) => m._id) }, is_political: true } : { is_political: true }
    ).lean();

    console.log(`Pass 2 (LLM): ${political.length} political message(s), batches of ${BATCH}\n`);

    const streams = new Map((await LiveStream.find().lean()).map((s) => [s.id, s]));
    let scored = 0;
    let flipped = 0;

    for (let i = 0; i < political.length; i += BATCH) {
        const slice = political.slice(i, i + BATCH);
        const stream = streams.get(slice[0].stream_id) || {};
        const t0 = Date.now();

        let verdicts;
        try {
            verdicts = await analyzeBatch(
                slice.map((m) => ({ id: m.id, text: m.text })),
                { channelAlignment: stream.alignment || 'unknown', videoTitle: stream.video_title }
            );
        } catch (err) {
            console.warn(`  batch ${i / BATCH + 1} FAILED: ${err.message} — leaving lexicon values`);
            continue;
        }

        const ops = [];
        for (const m of slice) {
            const v = verdicts.get(m.id);
            if (!v) continue;
            const meta = ctxById.get(m.id);
            const g = enforceBatchConsistency(v, meta.ctx, meta.tone);

            if (g.sentiment !== m.sentiment) flipped++;
            ops.push({
                updateOne: {
                    filter: { id: m.id },
                    update: {
                        $set: {
                            sentiment: g.sentiment,
                            tone: g.tone,
                            stance: g.stance,
                            target_entity: g.target_entity || meta.ctx.primary_target || null,
                            risk_level: SENTIMENT_TO_RISK[g.sentiment] || 'medium',
                            analysis_reason: g.reason || null,
                            analysis_provider: 'llm',
                        },
                    },
                },
            });
            console.log(`  ${String(g.sentiment).padEnd(8)} ${String(g.stance).padEnd(10)} ${String(m.text).slice(0, 46).padEnd(48)} ${g.reason || ''}`);
        }

        if (ops.length) await LiveChatMessage.bulkWrite(ops, { ordered: false });
        scored += ops.length;
        console.log(`  -- batch ${Math.floor(i / BATCH) + 1}: ${ops.length}/${slice.length} scored in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

        // Models sometimes return fewer rows than requested; those messages
        // would silently keep their lexicon guess. Retry them in a small batch,
        // which the model handles far more reliably.
        const missed = slice.filter((m) => !verdicts.get(m.id));
        if (missed.length) {
            console.log(`     retrying ${missed.length} unscored…`);
            const retryOps = [];
            for (let j = 0; j < missed.length; j += 5) {
                const chunk = missed.slice(j, j + 5);
                let rv;
                try {
                    rv = await analyzeBatch(chunk.map((m) => ({ id: m.id, text: m.text })),
                        { channelAlignment: stream.alignment || 'unknown', videoTitle: stream.video_title });
                } catch (_) { continue; }
                for (const m of chunk) {
                    const v = rv.get(m.id);
                    if (!v) continue;
                    const meta = ctxById.get(m.id);
                    const g = enforceBatchConsistency(v, meta.ctx, meta.tone);
                    retryOps.push({
                        updateOne: {
                            filter: { id: m.id },
                            update: { $set: {
                                sentiment: g.sentiment, tone: g.tone, stance: g.stance,
                                target_entity: g.target_entity || meta.ctx.primary_target || null,
                                risk_level: SENTIMENT_TO_RISK[g.sentiment] || 'medium',
                                analysis_reason: g.reason || null, analysis_provider: 'llm',
                            } },
                        },
                    });
                    console.log(`     ${String(g.sentiment).padEnd(8)} ${String(g.stance).padEnd(10)} ${String(m.text).slice(0, 46)}`);
                }
            }
            if (retryOps.length) {
                await LiveChatMessage.bulkWrite(retryOps, { ordered: false });
                scored += retryOps.length;
            }
        }
        console.log('');
    }

    for (const id of streams.keys()) await resyncStreamCounts(id);

    console.log(`\nLLM scored ${scored}/${political.length}; ${flipped} changed from the lexicon guess.`);
    for (const s of await LiveStream.find().lean()) {
        console.log(`  ${s.channel_name}: +${s.sentiment_counts.positive} / ~${s.sentiment_counts.moderate} / -${s.sentiment_counts.negative}`);
    }

    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
