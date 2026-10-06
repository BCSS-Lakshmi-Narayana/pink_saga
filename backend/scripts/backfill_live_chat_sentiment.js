/**
 * Re-runs client-axis sentiment over stored live-chat messages.
 *
 * Needed after a change to the polarity rules or the entity graph — e.g. the
 * fix that flips praise/attack aimed at the opposition ("Viva Yuri" is
 * negative for the client; "Yuri fottkiro" is positive).
 *
 *   node scripts/backfill_live_chat_sentiment.js            # all messages
 *   node scripts/backfill_live_chat_sentiment.js --dry-run  # report only
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const LiveChatMessage = require('../src/models/LiveChatMessage');
const LiveStream = require('../src/models/LiveStream');
const { analyzeFast } = require('../src/services/youtubeLiveService');

const DRY = process.argv.includes('--dry-run');

(async () => {
    await connectDB();

    const msgs = await LiveChatMessage.find().lean();
    console.log(`Scanning ${msgs.length} messages${DRY ? ' (dry run)' : ''}…\n`);

    let changed = 0;
    const ops = [];
    const perStream = new Map();

    for (const m of msgs) {
        const { fields } = analyzeFast(m.text);

        if (fields.sentiment !== m.sentiment) {
            changed++;
            if (changed <= 15) {
                console.log(`  ${String(m.sentiment).padEnd(8)} -> ${String(fields.sentiment).padEnd(8)} | ${String(m.text).slice(0, 55)}`);
            }
        }

        ops.push({
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
                        analysis_provider: 'lexicon',
                    },
                },
            },
        });

        const s = perStream.get(m.stream_id) || { positive: 0, moderate: 0, negative: 0, total: 0 };
        s[fields.sentiment]++;
        s.total++;
        perStream.set(m.stream_id, s);
    }

    if (changed > 15) console.log(`  … and ${changed - 15} more`);

    if (!DRY && ops.length) {
        await LiveChatMessage.bulkWrite(ops, { ordered: false });
        for (const [streamId, s] of perStream) {
            await LiveStream.updateOne(
                { id: streamId },
                { $set: { message_count: s.total, sentiment_counts: { positive: s.positive, moderate: s.moderate, negative: s.negative } } }
            );
        }
    }

    console.log(`\n${changed} of ${msgs.length} messages re-classified${DRY ? ' (nothing written)' : ''}.`);
    for (const [streamId, s] of perStream) {
        console.log(`  stream ${streamId}: +${s.positive} / ~${s.moderate} / -${s.negative}`);
    }

    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
