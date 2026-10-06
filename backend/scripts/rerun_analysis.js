/**
 * rerun_last_100_all.js
 *
 * Re-runs the last 100 Mentions (Grievances), last 100 Alerts, and last 100
 * RSS articles (NewsArticle) through the corrected political sentiment
 * pipeline (entityResolver roster fix + new Telugu ally aliases +
 * stanceEngine fallback fix, etc.) and reports before/after target_sentiment,
 * stance and risk fields for each.
 *
 * Dry-run by default — no writes. Pass --save to persist. Pass --limit=N to
 * override the default of 100. Pass --only=mentions|alerts|rss to run just
 * one section.
 *
 * A combined CSV of every before/after row is written to
 * evaluation/rerun_last_100_all_results.csv on every run (dry or saved).
 *
 * Usage:
 *   node scripts/rerun_last_100_all.js
 *   node scripts/rerun_last_100_all.js --save
 *   node scripts/rerun_last_100_all.js --only=alerts --save
 *   node scripts/rerun_last_100_all.js --limit=20
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const args = process.argv.slice(2);
// --ids=abc123,def456 re-runs only those records (id prefixes), e.g. the ones an audit flagged.
const idsArg = args.find((a) => a.startsWith('--ids='));
const ID_FILTER = idsArg ? { id: { $in: idsArg.split('=')[1].split(',').filter(Boolean).map((p) => new RegExp('^' + p.replace(/[^a-z0-9-]/gi, ''))) } } : {};
const shouldSave = args.includes('--save');
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 100;
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1] : null; // 'mentions' | 'alerts' | 'rss'

/**
 * How many records to analyse at once.
 *
 * Each record costs two LLM calls, and the Ollama host serves requests in
 * parallel — measured on this deployment: 39.6s/record sequential, 15.8s at 4
 * concurrent, 8.5s at 8. The work is entirely remote (local CPU was 1.7s across
 * a 4-record run), so this is pure wall-clock win with no local cost.
 *
 * Default 4 rather than 8 because the host is SHARED with another deployment —
 * saturating it would starve whatever else is using it. Raise deliberately.
 */
const concArg = args.find((a) => a.startsWith('--concurrency='));
const CONCURRENCY = Math.max(1, Math.min(16, parseInt(concArg ? concArg.split('=')[1] : '4', 10) || 4));

/**
 * Run `worker` over `items` with at most CONCURRENCY in flight.
 *
 * A plain Promise.all over 500 records would open 500 sockets at once and be
 * refused; this keeps exactly N running and starts the next as each finishes.
 * A worker that throws is caught by the caller, so one bad record cannot abort
 * the batch.
 */
const mapLimit = async (items, limit, worker) => {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            await worker(items[i], i);
        }
    });
    await Promise.all(runners);
};

const connectDB = async () => {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/cgsaga';
    await mongoose.connect(uri);
    console.log(`[DB] Connected to MongoDB: ${mongoose.connection.name}`);
};

const Grievance = require('../src/models/Grievance');
const Alert = require('../src/models/Alert');
const Content = require('../src/models/Content');
const Analysis = require('../src/models/Analysis');
const NewsArticle = require('../src/models/NewsArticle');
const { analyzeContent, isAnalysisComplete } = require('../src/services/analysisService');
const { upsertAlertForContent } = require('../src/services/monitorService');
const Source = require('../src/models/Source');
const { analyzeArticle } = require('../src/services/rssAnalysisService');
const { buildGrievanceAnalysisUpdate } = require('../src/services/grievanceService');

const rows = []; // combined CSV rows across all three sections

const escapeCsv = (str) => {
    if (str === null || str === undefined) return '""';
    const s = String(str).replace(/"/g, '""').replace(/\r?\n/g, ' ');
    return `"${s}"`;
};

const toContentRiskLevel = (level) => {
    const v = String(level || '').toLowerCase();
    if (v === 'high' || v === 'critical') return 'high';
    if (v === 'medium') return 'medium';
    return 'low';
};

const addRow = (row) => rows.push(row);

/* ─────────────────────────── Mentions (Grievances) ─────────────────────────── */

const extractGrievanceText = (g) => {
    if (typeof g.tweet_text === 'string' && g.tweet_text) return g.tweet_text;
    if (typeof g.text === 'string' && g.text) return g.text;
    if (g.content) {
        if (typeof g.content === 'string') return g.content;
        if (typeof g.content.full_text === 'string' && g.content.full_text) return g.content.full_text;
        if (typeof g.content.text === 'string' && g.content.text) return g.content.text;
    }
    return '';
};

const rerunMentions = async () => {
    console.log(`\n${'='.repeat(100)}\nMENTIONS (Grievances) — last ${LIMIT}\n${'='.repeat(100)}`);
    const grievances = await Grievance.find({ is_active: { $ne: false }, ...ID_FILTER })
        .sort({ created_at: -1, _id: -1 })
        .limit(LIMIT)
        .lean();
    console.log(`[Fetch] ${grievances.length} grievances.\n`);

    let changed = 0;
    let done = 0;
    await mapLimit(grievances, CONCURRENCY, async (g) => {
        const text = extractGrievanceText(g);
        if (!text.trim()) return;

        const prevSentiment = g.analysis?.target_sentiment || g.analysis?.sentiment || 'unknown';
        const prevStance = g.analysis?.political_stance || g.analysis?.stance || 'unknown';
        const prevRiskLevel = g.analysis?.risk_level || 'unknown';
        const prevRiskScore = g.analysis?.risk_score ?? 'unknown';

        let fresh;
        try {
            fresh = await analyzeContent(text, {
                platform: g.platform || 'x',
                taggedKeyword: g.tagged_account || '',
                authorHandle: g.posted_by?.handle || '',
                skipForensics: true,
            });
        } catch (err) {
            console.log(`[Error] Grievance ${g.id}: ${err.message}`);
            return;
        }

        // Complete-or-pending: a re-run that did not finish (LLM fallback, no
        // stance) must not overwrite a finished verdict with a half one.
        if (!isAnalysisComplete(fresh)) {
            console.log(`[skip]    ${g.id.slice(0, 8)} analysis incomplete — kept as is`);
            return;
        }
        const isChanged = prevSentiment !== fresh.target_sentiment || prevStance !== fresh.stance;
        if (isChanged) changed++;
        console.log(`${isChanged ? '[CHANGED]' : '[same]   '} ${g.id.slice(0, 8)} @${g.posted_by?.handle || 'unknown'}  sentiment: ${prevSentiment} -> ${fresh.target_sentiment}  stance: ${prevStance} -> ${fresh.stance}  risk: ${prevRiskLevel}/${prevRiskScore} -> ${fresh.risk_level}/${fresh.risk_score}`);

        addRow({
            type: 'mention', id: g.id, author: g.posted_by?.handle || g.posted_by?.name || 'unknown',
            text, prevSentiment, newSentiment: fresh.target_sentiment, prevStance, newStance: fresh.stance,
            prevRiskLevel, newRiskLevel: fresh.risk_level, prevRiskScore, newRiskScore: fresh.risk_score,
            reasoning: fresh.political_reasoning || fresh.explanation || '',
        });

        if (shouldSave) {
            // Reuse the ingest path's own update builder. Hand-listing the fields
            // here is how a re-run silently stops writing `analysis.bsk_sentiment`,
            // `target_tone`, the confidence bag and the review flags — leaving
            // re-analysed posts half-migrated and disagreeing with themselves
            // across surfaces that read the older field names first.
            await Grievance.updateOne(
                { id: g.id },
                { $set: buildGrievanceAnalysisUpdate(fresh) },
            );
        }
        done += 1;
        if (done % 25 === 0) console.log(`   … ${done}/${grievances.length}`);
    });
    console.log(`\n[Mentions] ${changed}/${grievances.length} changed.`);
};

/* ─────────────────────────────────── Alerts ─────────────────────────────────── */

const rerunAlerts = async () => {
    console.log(`\n${'='.repeat(100)}\nALERTS — last ${LIMIT}\n${'='.repeat(100)}`);
    const alerts = await Alert.find({ ...ID_FILTER }).sort({ created_at: -1, _id: -1 }).limit(LIMIT).lean();
    console.log(`[Fetch] ${alerts.length} alerts.\n`);

    let changed = 0;
    let done = 0;
    await mapLimit(alerts, CONCURRENCY, async (alert) => {
        const content = alert.content_id ? await Content.findOne({ id: alert.content_id }).lean() : null;
        const text = content?.text || alert.description || '';
        if (!text.trim()) return;
        // An operator's manual correction is never overwritten by a re-run.
        if (alert.llm_analysis?.manual_override) return;

        const prevSentiment = alert.llm_analysis?.target_sentiment || alert.llm_analysis?.sentiment || 'unknown';
        const prevStance = alert.llm_analysis?.political_stance || alert.llm_analysis?.stance || 'unknown';
        const prevRiskLevel = alert.risk_level || 'unknown';
        const prevRiskScore = alert.threat_details?.risk_score ?? 'unknown';

        let fresh;
        try {
            fresh = await analyzeContent(text, {
                platform: alert.platform || content?.platform || 'x',
                authorHandle: alert.author_handle || content?.author_handle || '',
                skipForensics: true,
            });
        } catch (err) {
            console.log(`[Error] Alert ${alert.id}: ${err.message}`);
            return;
        }

        if (!isAnalysisComplete(fresh)) {
            console.log(`[skip]    ${alert.id.slice(0, 8)} analysis incomplete — kept as is`);
            return;
        }
        const isChanged = prevSentiment !== fresh.target_sentiment || prevStance !== fresh.stance;
        if (isChanged) changed++;
        console.log(`${isChanged ? '[CHANGED]' : '[same]   '} ${alert.id.slice(0, 8)} @${alert.author_handle || alert.author || 'unknown'}  sentiment: ${prevSentiment} -> ${fresh.target_sentiment}  stance: ${prevStance} -> ${fresh.stance}  risk: ${prevRiskLevel}/${prevRiskScore} -> ${fresh.risk_level}/${fresh.risk_score}`);

        addRow({
            type: 'alert', id: alert.id, author: alert.author_handle || alert.author || 'unknown',
            text, prevSentiment, newSentiment: fresh.target_sentiment, prevStance, newStance: fresh.stance,
            prevRiskLevel, newRiskLevel: fresh.risk_level, prevRiskScore, newRiskScore: fresh.risk_score,
            reasoning: fresh.political_reasoning || fresh.explanation || '',
        });

        if (shouldSave) {
            // The live pipeline's own alert builder (monitorService), so a
            // re-run writes exactly what a fresh ingest would — risk, verdict,
            // title/description, topic — and never an operator's correction.
            if (content) {
                const source = content.source_id ? await Source.findOne({ id: content.source_id }).lean() : null;
                await upsertAlertForContent({ content, analysis: fresh, source, allowCreate: false });
            }
            if (content) {
                await Content.updateOne({ id: content.id }, {
                    $set: { risk_level: toContentRiskLevel(fresh.risk_level), risk_score: fresh.risk_score, sentiment: fresh.sentiment }
                });
            }
            if (alert.analysis_id) {
                await Analysis.updateOne({ id: alert.analysis_id }, {
                    $set: {
                        risk_level: toContentRiskLevel(fresh.risk_level),
                        risk_score: Math.round(fresh.risk_score || 0),
                        sentiment: fresh.sentiment,
                        llm_analysis: fresh.llm_analysis,
                    }
                });
            }
        }
        done += 1;
        if (done % 25 === 0) console.log(`   … ${done}/${alerts.length}`);
    });
    console.log(`\n[Alerts] ${changed}/${alerts.length} changed.`);
};

/* ──────────────────────────────── RSS (NewsArticle) ──────────────────────────────── */

const rerunRss = async () => {
    console.log(`\n${'='.repeat(100)}\nRSS ARTICLES — last ${LIMIT}\n${'='.repeat(100)}`);
    const articles = await NewsArticle.find({}).sort({ scraped_at: -1, _id: -1 }).limit(LIMIT).lean();
    console.log(`[Fetch] ${articles.length} articles.\n`);

    let changed = 0;
    let done = 0;
    await mapLimit(articles, CONCURRENCY, async (article) => {
        const prevSentiment = article.target_sentiment || article.sentiment || 'unknown';
        const prevStance = article.political_stance || 'unknown';

        let result;
        try {
            result = await analyzeArticle(article, { write: false });
        } catch (err) {
            console.log(`[Error] Article ${article._id}: ${err.message}`);
            return;
        }
        if (!result) { console.log(`[Skip] Article ${article._id} — no text.`); return; }

        const fresh = result.update;
        const isChanged = prevSentiment !== fresh.target_sentiment || prevStance !== fresh.political_stance;
        if (isChanged) changed++;
        console.log(`${isChanged ? '[CHANGED]' : '[same]   '} ${String(article._id).slice(-8)} ${article.source_name || article.source_domain || 'unknown'}  sentiment: ${prevSentiment} -> ${fresh.target_sentiment}  stance: ${prevStance} -> ${fresh.political_stance}`);

        addRow({
            type: 'rss', id: String(article._id), author: article.source_name || article.source_domain || 'unknown',
            text: article.title || '', prevSentiment, newSentiment: fresh.target_sentiment,
            prevStance, newStance: fresh.political_stance,
            prevRiskLevel: '', newRiskLevel: '', prevRiskScore: '', newRiskScore: '',
            reasoning: fresh.sentiment_reasoning || '',
        });

        if (shouldSave) {
            await NewsArticle.updateOne({ _id: article._id }, { $set: fresh });
        }
        done += 1;
        if (done % 25 === 0) console.log(`   … ${done}/${articles.length}`);
    });
    console.log(`\n[RSS] ${changed}/${articles.length} changed.`);
};

/* ──────────────────────────────────── main ──────────────────────────────────── */

const main = async () => {
    console.log(`\n=== RE-RUNNING LAST ${LIMIT} OF EACH (save=${shouldSave}, concurrency=${CONCURRENCY}${ONLY ? `, only=${ONLY}` : ''}) ===`);
    await connectDB();

    if (!ONLY || ONLY === 'mentions') await rerunMentions();
    if (!ONLY || ONLY === 'alerts') await rerunAlerts();
    if (!ONLY || ONLY === 'rss') await rerunRss();

    const outputDir = path.join(__dirname, '..', 'evaluation');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const csvHeaders = ['Type', 'ID', 'Author', 'Prev Sentiment', 'New Sentiment', 'Prev Stance', 'New Stance', 'Prev Risk Level', 'New Risk Level', 'Prev Risk Score', 'New Risk Score', 'Text', 'Reasoning'];
    const csvRows = rows.map(r => [
        escapeCsv(r.type), escapeCsv(r.id), escapeCsv(r.author),
        escapeCsv(r.prevSentiment), escapeCsv(r.newSentiment),
        escapeCsv(r.prevStance), escapeCsv(r.newStance),
        escapeCsv(r.prevRiskLevel), escapeCsv(r.newRiskLevel),
        escapeCsv(r.prevRiskScore), escapeCsv(r.newRiskScore),
        escapeCsv((r.text || '').slice(0, 200)), escapeCsv((r.reasoning || '').slice(0, 300)),
    ].join(','));
    const csvContent = '﻿' + [csvHeaders.join(','), ...csvRows].join('\n');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const scope = ONLY || 'all';
    const csvPath = path.join(outputDir, `rerun_${scope}_${LIMIT}_${stamp}.csv`);
    fs.writeFileSync(csvPath, csvContent, 'utf8');
    console.log(`\n[Export] Combined CSV saved to: ${csvPath}`);

    /**
     * Markdown evaluation report.
     *
     * The CSV is the row-level audit trail; this is the thing a human actually
     * reads to decide whether the re-analysis improved anything. It reports the
     * BEFORE and AFTER distributions side by side, because "20 changed" alone
     * does not say whether the corpus moved in a sensible direction.
     */
    const tally = (arr) => arr.reduce((m, v) => m.set(v || '(none)', (m.get(v || '(none)') || 0) + 1), new Map());
    const table = (title, before, after) => {
        const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
        const lines = [`| ${title} | before | after | delta |`, '|---|--:|--:|--:|'];
        for (const k of keys) {
            const b = before.get(k) || 0;
            const a = after.get(k) || 0;
            const d = a - b;
            lines.push(`| ${k} | ${b} | ${a} | ${d > 0 ? '+' : ''}${d} |`);
        }
        return lines.join('\n');
    };

    const md = [];
    md.push(`# Re-analysis report — ${scope}, last ${LIMIT} per type`);
    md.push('');
    md.push(`- Run at: ${new Date().toISOString()}`);
    md.push(`- Mode: **${shouldSave ? 'SAVED to DB' : 'DRY RUN — nothing written'}**`);
    md.push(`- Rows evaluated: **${rows.length}**`);
    md.push('');

    for (const type of [...new Set(rows.map((r) => r.type))]) {
        const sub = rows.filter((r) => r.type === type);
        const changed = sub.filter((r) => r.prevSentiment !== r.newSentiment || r.prevStance !== r.newStance);
        const sentFlip = sub.filter((r) => r.prevSentiment !== r.newSentiment);
        const stanceFlip = sub.filter((r) => r.prevStance !== r.newStance);
        // The verdicts that matter most: a post that used to read as GOOD for the
        // client and now reads as BAD (or the reverse) is a decision reversal, not
        // a tweak — these are the rows worth reading by hand.
        const reversals = sub.filter((r) =>
            (r.prevSentiment === 'positive' && r.newSentiment === 'negative')
            || (r.prevSentiment === 'negative' && r.newSentiment === 'positive'));

        md.push(`## ${type}`);
        md.push('');
        md.push(`- evaluated: **${sub.length}**`);
        md.push(`- changed (sentiment or stance): **${changed.length}** (${sub.length ? Math.round(changed.length / sub.length * 100) : 0}%)`);
        md.push(`- sentiment changed: ${sentFlip.length} · stance changed: ${stanceFlip.length}`);
        md.push(`- **full reversals (positive ⇄ negative): ${reversals.length}** ← review these first`);
        md.push('');
        md.push(table('sentiment', tally(sub.map((r) => r.prevSentiment)), tally(sub.map((r) => r.newSentiment))));
        md.push('');
        md.push(table('stance', tally(sub.map((r) => r.prevStance)), tally(sub.map((r) => r.newStance))));
        md.push('');
        if (reversals.length) {
            md.push('### Reversals');
            md.push('');
            md.push('| id | author | was | now | text |');
            md.push('|---|---|---|---|---|');
            for (const r of reversals.slice(0, 40)) {
                const txt = String(r.text || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120);
                md.push(`| ${String(r.id).slice(0, 8)} | ${r.author || ''} | ${r.prevSentiment}/${r.prevStance} | ${r.newSentiment}/${r.newStance} | ${txt} |`);
            }
            if (reversals.length > 40) md.push(`| … | | | | ${reversals.length - 40} more in the CSV |`);
            md.push('');
        }
    }

    md.push('---');
    md.push('');
    md.push('## How to read this');
    md.push('');
    md.push('- A high **changed** rate on a first run is expected: the corpus was scored by the previous logic.');
    md.push('- **Reversals** are the rows to spot-check by hand — they are the cases where the new pipeline');
    md.push('  disagrees with the old one about whether a post is good or bad for the client.');
    md.push('- `stance` moving from `(none)` to a real value means the post had no client-relative verdict at all before.');
    md.push('- Rows still showing `needs_review` are ones the pipeline itself was not confident about; they are');
    md.push('  intentionally routed to a human rather than published as fact.');
    md.push('');

    const mdPath = path.join(outputDir, `rerun_${scope}_${LIMIT}_${stamp}.md`);
    fs.writeFileSync(mdPath, md.join('\n'), 'utf8');
    console.log(`[Export] Evaluation report saved to: ${mdPath}`);

    console.log('\n' + '='.repeat(100));
    console.log(shouldSave ? 'Done. Changes saved.' : 'Dry run complete — no changes written. Re-run with --save to persist.');
    process.exit(0);
};

main().catch((err) => {
    console.error('[Fatal Error]', err);
    process.exit(1);
});
