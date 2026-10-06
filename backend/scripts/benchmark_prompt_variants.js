/**
 * benchmark_prompt_variants.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Scores three ways of feeding non-English text to Stage 3, against the posts a
 * human has already corrected in the UI.
 *
 *      A · english   the CURRENT behaviour — Google translation only
 *      B · telugu    the original text only, no translation
 *      C · both      original AND translation together
 *
 * WHY THIS EXISTS
 * ───────────────
 * "Telugu + English is probably better" is a hypothesis. Before changing a
 * pipeline that scores 69,000 posts, it should be a number. This produces that
 * number, and it does so without touching the pipeline.
 *
 * THE LABELS ARE ALREADY IN THE DATABASE
 * Every sentiment an operator corrected through the UI is flagged
 * `manual_override` (mentions/alerts) or `manual_sentiment_override` (news).
 * Those corrections ARE the ground truth — no hand-labelling needed.
 *
 * ⚠ THE LABEL SET IS BIASED, ON PURPOSE. An operator corrects posts the model got
 * WRONG, so absolute accuracy here is a FLOOR, not the platform's true accuracy.
 * It is still valid for the only question being asked: which variant is better
 * than the others on the same posts.
 *
 * SAFETY
 *   • Read-only. Opens no write path: it calls buildPoliticalContext and
 *     analyzePoliticalSentiment directly, both of which are pure (verified: no
 *     .save/.updateOne/.insertOne anywhere in politicalSentimentService).
 *   • It does NOT call analyzeContent, which has side effects.
 *   • It changes no existing file. Variant C is expressed purely as different
 *     INPUT TEXT, so nothing needs modifying to measure it.
 *
 * COVERS ALL THREE SOURCES — mentions, alerts and RSS — because each stores its
 * verdict under a different shape and a fix that helps one can hurt another.
 *
 * USAGE
 *   node scripts/benchmark_prompt_variants.js                  # everything
 *   node scripts/benchmark_prompt_variants.js --limit 12       # quick smoke run
 *   node scripts/benchmark_prompt_variants.js --only mentions  # one source
 *   node scripts/benchmark_prompt_variants.js --concurrency 6
 *   node scripts/benchmark_prompt_variants.js --variants english,both
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Grievance = require('../src/models/Grievance');
const Alert = require('../src/models/Alert');
const NewsArticle = require('../src/models/NewsArticle');
const translationService = require('../src/services/translationService');
const { buildPoliticalContext, detectLanguageHints } = require('../src/services/politicalContextService');
const { analyzePoliticalSentiment } = require('../src/services/politicalSentimentService');
// The production builder for variant C — shared, never duplicated, so the
// benchmark cannot measure a prompt that differs from the one that ships.
const { buildStage3Input } = require('../src/services/stage3Input');

/* ─── args ────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1 || i + 1 >= argv.length) return dflt;
    return argv[i + 1];
};
const LIMIT = parseInt(flag('limit', '0'), 10) || 0;
const ONLY = String(flag('only', 'all')).toLowerCase();
const CONCURRENCY = Math.max(1, Math.min(12, parseInt(flag('concurrency', '4'), 10) || 4));
const VARIANTS = String(flag('variants', 'english,telugu,both')).split(',').map((s) => s.trim()).filter(Boolean);

/* ─── the three ways of building Stage 3's input ──────────────────── */
const BUILDERS = {
    /** Current production behaviour: translate, then analyse the English. */
    english: ({ english, original }) => english || original,
    /** No translation at all — the model reads the source language. */
    telugu: ({ original }) => original,
    /**
     * Both, original first — built by the SAME function production uses when
     * STAGE3_INCLUDE_ORIGINAL is on, not a copy of it. If the two ever drifted,
     * this benchmark would be measuring a prompt that never ships. The env var is
     * forced on for the duration of this variant so the builder is exercised
     * regardless of how the shell is configured.
     */
    both: ({ english, original }) => {
        const prev = process.env.STAGE3_INCLUDE_ORIGINAL;
        process.env.STAGE3_INCLUDE_ORIGINAL = 'true';
        try {
            return buildStage3Input({ original, english });
        } finally {
            if (prev === undefined) delete process.env.STAGE3_INCLUDE_ORIGINAL;
            else process.env.STAGE3_INCLUDE_ORIGINAL = prev;
        }
    },
};

/* ─── ground truth extraction, one shape per collection ───────────── */
const norm = (v) => String(v == null ? '' : v).toLowerCase().trim();

/** Collapse the retired bsk_* vocabulary so old labels compare against new output. */
const canonStance = (v) => {
    const s = norm(v).replace(/_bsk/g, '_target').replace(/^bsk_/, 'target_');
    if (!s) return '';
    if (s === 'pro_client') return 'pro_target';
    if (s === 'anti_client') return 'anti_target';
    return s;
};
/** Direction only — pro/anti/other. Indirect variants collapse into their side. */
const stanceSide = (v) => {
    const s = canonStance(v);
    if (s.startsWith('pro_')) return 'pro';
    if (s.startsWith('anti_')) return 'anti';
    if (!s) return '';
    return 'neither';
};
const canonSentiment = (v) => {
    const s = norm(v);
    if (s === 'neutral') return 'moderate';
    return s;
};

const SOURCES = {
    mentions: {
        Model: Grievance,
        filter: { 'analysis.manual_override': true },
        select: 'id content.text content.full_text analysis.sentiment analysis.stance analysis.political_stance posted_by.handle',
        text: (d) => d.content?.full_text || d.content?.text || '',
        author: (d) => d.posted_by?.handle || '',
        truth: (d) => ({
            stance: d.analysis?.political_stance || d.analysis?.stance || '',
            sentiment: d.analysis?.sentiment || '',
        }),
    },
    alerts: {
        Model: Alert,
        filter: { 'llm_analysis.manual_override': true },
        select: 'id title description llm_analysis author_handle author',
        text: (d) => d.description || d.title || '',
        author: (d) => d.author_handle || d.author || '',
        truth: (d) => ({
            stance: d.llm_analysis?.political_stance || d.llm_analysis?.stance || '',
            sentiment: d.llm_analysis?.target_sentiment || d.llm_analysis?.sentiment || '',
        }),
    },
    news: {
        Model: NewsArticle,
        filter: { manual_sentiment_override: true },
        select: 'title title_english summary summary_english content sentiment political_stance source_name',
        // Deliberately the ORIGINAL title, not title_english: the point is to
        // measure how the variants handle source-language text.
        text: (d) => [d.title, d.summary].filter(Boolean).join('\n\n') || d.content || '',
        author: (d) => d.source_name || '',
        truth: (d) => ({
            stance: d.political_stance || '',
            sentiment: d.sentiment || '',
        }),
    },
};

/* ─── bounded concurrency (same pattern as rerun_analysis.js) ─────── */
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

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0');

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(`connected: ${mongoose.connection.name}`);
    console.log(`variants: ${VARIANTS.join(', ')}   concurrency: ${CONCURRENCY}\n`);

    /* ── 1. gather the human-corrected records ── */
    const cases = [];
    for (const [name, cfg] of Object.entries(SOURCES)) {
        if (ONLY !== 'all' && ONLY !== name) continue;
        let q = cfg.Model.find(cfg.filter).select(cfg.select).sort({ _id: -1 }).lean();
        if (LIMIT) q = q.limit(LIMIT);
        const docs = await q;
        for (const d of docs) {
            const text = String(cfg.text(d) || '').trim();
            const truth = cfg.truth(d);
            // A label with no direction teaches nothing — skip rather than score noise.
            if (!text || !stanceSide(truth.stance)) continue;
            cases.push({ source: name, id: d.id || String(d._id), text, author: cfg.author(d), truth });
        }
    }

    if (!cases.length) {
        console.log('No human-corrected records with a usable stance label. Nothing to benchmark.');
        await mongoose.disconnect();
        return;
    }

    const bySource = cases.reduce((m, c) => { m[c.source] = (m[c.source] || 0) + 1; return m; }, {});
    console.log(`labelled cases: ${cases.length}   ${JSON.stringify(bySource)}`);
    console.log(`LLM calls: ${cases.length * VARIANTS.length}\n`);

    /* ── 2. translate once per case, reused by every variant ── */
    process.stdout.write('translating… ');
    let translated = 0;
    await mapLimit(cases, 6, async (c) => {
        const hints = detectLanguageHints(c.text);
        c.nonEnglish = !!(hints.has_telugu || hints.has_hindi || hints.has_devanagari
            || hints.has_tamil || hints.has_kannada || hints.has_urdu);
        if (!c.nonEnglish) { c.english = ''; return; }
        try {
            c.english = await translationService.translate(c.text, 'en', 'auto');
            translated += 1;
        } catch (_) {
            // Exactly what production does on failure: carry on with the original.
            c.english = '';
            c.translationFailed = true;
        }
    });
    const nonEnglishCount = cases.filter((c) => c.nonEnglish).length;
    console.log(`${translated}/${nonEnglishCount} non-English cases translated\n`);

    /* ── 3. Stage 2 once per case: identical for every variant ──
     * Production runs the entity scan on the ORIGINAL, and that is not what is
     * being tested here — holding it constant keeps the comparison honest by
     * isolating the ONE thing that differs: Stage 3's input text. */
    for (const c of cases) {
        try {
            c.ctx = buildPoliticalContext(c.text, { authorHandle: c.author });
        } catch (_) {
            c.ctx = {};
        }
    }

    /* ── 4. run each variant ── */
    const results = {};
    for (const v of VARIANTS) {
        if (!BUILDERS[v]) { console.log(`skipping unknown variant "${v}"`); continue; }
        const t0 = Date.now();
        let done = 0;
        process.stdout.write(`variant ${v}: `);
        results[v] = [];
        await mapLimit(cases, CONCURRENCY, async (c) => {
            const input = BUILDERS[v](c);
            let verdict = null;
            try {
                verdict = await analyzePoliticalSentiment(input, c.ctx);
            } catch (err) {
                verdict = { _error: err.message };
            }
            results[v].push({
                source: c.source,
                id: c.id,
                truth: c.truth,
                predStance: verdict?.political_stance || verdict?.stance || '',
                predSentiment: verdict?.target_sentiment || '',
                /**
                 * CRITICAL. analyzePoliticalSentiment never throws on an LLM
                 * failure — it catches internally and returns a deterministic
                 * heuristic verdict tagged `provider: 'fallback'`. Without
                 * recording this the benchmark happily scores heuristics as
                 * though they were model output and reports a confident,
                 * meaningless number. The smoke run hit exactly that: one whole
                 * variant completed in 0s because every call had fallen back.
                 */
                provider: verdict?.provider || 'unknown',
                error: verdict?._error || null,
                text: c.text,
                english: c.english,
            });
            done += 1;
            if (done % 10 === 0) process.stdout.write('.');
        });
        console.log(` ${results[v].length} in ${Math.round((Date.now() - t0) / 1000)}s`);
    }

    /* ── 5. score ── */
    const score = (rows) => {
        const s = { n: 0, stanceExact: 0, stanceSide: 0, sentiment: 0, errors: 0, fallbacks: 0, bySource: {} };
        for (const r of rows) {
            if (r.error) { s.errors += 1; continue; }
            // A heuristic verdict says nothing about the prompt variant — it is
            // the same deterministic guess whatever text went in. Counted and
            // EXCLUDED, so a variant cannot look good by failing quietly.
            if (r.provider === 'fallback') { s.fallbacks += 1; continue; }
            s.n += 1;
            const src = (s.bySource[r.source] ||= { n: 0, side: 0 });
            src.n += 1;
            if (canonStance(r.predStance) === canonStance(r.truth.stance)) s.stanceExact += 1;
            if (stanceSide(r.predStance) === stanceSide(r.truth.stance)) { s.stanceSide += 1; src.side += 1; }
            if (canonSentiment(r.predSentiment) === canonSentiment(r.truth.sentiment)) s.sentiment += 1;
        }
        return s;
    };

    const scored = Object.fromEntries(Object.entries(results).map(([v, rows]) => [v, score(rows)]));

    console.log(`\n${'='.repeat(74)}`);
    console.log('RESULTS  — agreement with the human correction');
    console.log('='.repeat(74));
    console.log('variant    scored   stance side   stance exact   sentiment   LLM-failed');
    console.log('-'.repeat(74));
    for (const [v, s] of Object.entries(scored)) {
        console.log(
            `${v.padEnd(9)} ${String(s.n).padStart(6)}   ` +
            `${(pct(s.stanceSide, s.n) + '%').padStart(10)}   ` +
            `${(pct(s.stanceExact, s.n) + '%').padStart(12)}   ` +
            `${(pct(s.sentiment, s.n) + '%').padStart(9)}   ` +
            `${String(s.fallbacks + s.errors).padStart(10)}`
        );
    }
    const anyFallback = Object.values(scored).some((s) => s.fallbacks > 0);
    if (anyFallback) {
        console.log('\n  ⚠ "LLM-failed" rows fell back to the deterministic heuristic and are EXCLUDED');
        console.log('    from the percentages. A variant with many of these has not been measured —');
        console.log('    re-run it before drawing any conclusion.');
    }

    console.log(`\nper source — stance side (pro / anti), the number that matters most`);
    console.log('-'.repeat(74));
    const srcNames = [...new Set(cases.map((c) => c.source))];
    console.log(`variant    ${srcNames.map((s) => s.padStart(12)).join('')}`);
    for (const [v, s] of Object.entries(scored)) {
        const cells = srcNames.map((n) => {
            const b = s.bySource[n];
            return (b ? `${pct(b.side, b.n)}% (${b.n})` : '—').padStart(12);
        });
        console.log(`${v.padEnd(9)} ${cells.join('')}`);
    }

    /* ── 6. where the variants disagree — the interesting rows ── */
    const base = VARIANTS[0];
    const others = VARIANTS.slice(1).filter((v) => results[v]);
    if (results[base] && others.length) {
        const idx = Object.fromEntries(
            Object.entries(results).map(([v, rows]) => [v, Object.fromEntries(rows.map((r) => [r.id, r]))])
        );
        const flips = [];
        for (const r of results[base]) {
            if (r.error || r.provider === 'fallback') continue;
            const truthSide = stanceSide(r.truth.stance);
            const baseOk = stanceSide(r.predStance) === truthSide;
            for (const v of others) {
                const o = idx[v][r.id];
                // Both sides of a comparison must be real model verdicts.
                if (!o || o.error || o.provider === 'fallback') continue;
                const okNow = stanceSide(o.predStance) === truthSide;
                if (baseOk !== okNow) {
                    flips.push({ id: r.id, source: r.source, variant: v, fixed: okNow, truth: truthSide,
                        from: stanceSide(r.predStance), to: stanceSide(o.predStance), text: r.text });
                }
            }
        }
        const fixed = flips.filter((f) => f.fixed);
        const broke = flips.filter((f) => !f.fixed);
        console.log(`\nchanges vs "${base}"`);
        console.log('-'.repeat(74));
        console.log(`  newly CORRECT : ${fixed.length}`);
        console.log(`  newly WRONG   : ${broke.length}   ← a variant that fixes 10 and breaks 9 is not a win`);
        for (const f of [...fixed.slice(0, 6), ...broke.slice(0, 6)]) {
            console.log(`  [${f.fixed ? 'FIX ' : 'BREAK'}] ${f.variant.padEnd(8)} ${f.source.padEnd(9)} ` +
                `${f.from}→${f.to} (truth ${f.truth})  "${String(f.text).replace(/\s+/g, ' ').slice(0, 52)}"`);
        }
    }

    /* ── 7. persist the full run for inspection ── */
    const dir = path.join(__dirname, '..', 'evaluation');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(dir, `prompt_variants_${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({
        generated_at: new Date().toISOString(),
        note: 'Labels come from operator corrections, which skew toward posts the model got wrong. '
            + 'Treat absolute accuracy as a floor; compare variants against each other.',
        variants: VARIANTS, cases: cases.length, scored, results,
    }, null, 2));
    console.log(`\nfull run written to ${path.relative(process.cwd(), file)}`);

    await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
