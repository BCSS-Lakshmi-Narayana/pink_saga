#!/usr/bin/env node
/**
 * Re-score RSS/news articles through the shared target-aware pipeline.
 *
 *   node scripts/rescore_news_articles.js --dry-run            # report only
 *   node scripts/rescore_news_articles.js --limit=200          # persist 200
 *   node scripts/rescore_news_articles.js --unscored           # only articles
 *                                                              # never scored here
 *   node scripts/rescore_news_articles.js --force              # also re-score
 *                                                              # manually corrected ones
 *
 * WHY: the Python ingest engine scores articles with its own Cohere prompt and
 * its own rubric, so `newsarticles.sentiment` did not mean the same thing as
 * the identically-named field on Grievances and Alerts. This run gives news the
 * same `political_stance` / `target_sentiment` vocabulary as everything else.
 *
 * Each article costs real LLM calls (Pass A + Stage 3). There is a 7-day text
 * cache in analysisService, so re-running the same articles soon after is cheap,
 * but a first pass over a large backlog is not. Budget accordingly and use
 * --limit.
 *
 * A roster populated today does NOT retroactively fix records analysed before
 * it existed — that is exactly what this script is for.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const NewsArticle = require('../src/models/NewsArticle');
const { analyzeArticle } = require('../src/services/rssAnalysisService');

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const getVal = (name, fallback) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=')[1] : fallback;
};

const DRY_RUN = hasFlag('dry-run');
const FORCE = hasFlag('force');
const UNSCORED_ONLY = hasFlag('unscored');
const LIMIT = parseInt(getVal('limit', '100'), 10);

const main = async () => {
    await connectDB();

    const filter = UNSCORED_ONLY ? { pipeline_analyzed_at: null } : {};
    const articles = await NewsArticle.find(filter)
        .sort({ published_date: -1 })
        .limit(LIMIT)
        .lean();

    console.log(`\n[rescore-news] ${articles.length} article(s) selected${UNSCORED_ONLY ? ' (never scored by this pipeline)' : ''}`);
    console.log(`[rescore-news] mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'PERSIST'}${FORCE ? ' + FORCE (overwrites manual corrections)' : ''}\n`);

    const stats = { analyzed: 0, skipped: 0, failed: 0, changed: 0, needs_review: 0 };
    const rows = [];

    for (const article of articles) {
        try {
            const res = await analyzeArticle(article, { write: !DRY_RUN, force: FORCE });
            if (!res) {
                stats.skipped += 1;
                continue;
            }
            stats.analyzed += 1;
            if (res.update.needs_review) stats.needs_review += 1;

            const before = article.sentiment || '(none)';
            const after = res.update.sentiment;
            const changed = before !== after;
            if (changed) stats.changed += 1;

            rows.push({
                title: String(article.title || '').slice(0, 60),
                before,
                after,
                stance: res.update.political_stance,
                review: res.update.needs_review ? 'REVIEW' : '',
            });
            console.log(`${changed ? '~' : ' '} ${before.padEnd(9)} → ${after.padEnd(9)} ${String(res.update.political_stance).padEnd(22)} ${res.update.needs_review ? 'REVIEW ' : '       '}${String(article.title || '').slice(0, 70)}`);
        } catch (err) {
            stats.failed += 1;
            console.warn(`! FAILED ${article._id}: ${err.message}`);
        }
    }

    console.log(`\n─── summary ─────────────────────────────────`);
    console.log(`  analyzed        : ${stats.analyzed}`);
    console.log(`  sentiment moved : ${stats.changed}`);
    console.log(`  flagged review  : ${stats.needs_review}`);
    console.log(`  skipped         : ${stats.skipped}${!FORCE ? ' (manually corrected — use --force to include)' : ''}`);
    console.log(`  failed          : ${stats.failed}`);
    console.log(`  writes          : ${DRY_RUN ? 'NONE (dry run)' : 'persisted'}`);
    console.log(`─────────────────────────────────────────────\n`);

    await mongoose.connection.close();
};

main().catch(async (err) => {
    console.error('[rescore-news] fatal:', err);
    try { await mongoose.connection.close(); } catch (e) { /* already closed */ }
    process.exit(1);
});
