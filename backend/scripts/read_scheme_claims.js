/**
 * read_scheme_claims.js
 * ─────────────────────────────────────────────────────────────────────
 * Reads every post and news headline from the last 90 days that names a
 * tracked manifesto scheme, records what it says about the scheme reaching
 * people, and saves that on the post (schemeClaimService). The Manifesto
 * tracker on the Intelligence Brief is built from these readings.
 *
 * Run it where an Ollama with the reading models is available — checked by
 * hand on real posts, llama3.1 + gemma3 together (a claim counts only when
 * both agree) read Telugu well enough; the qwen2.5 models did not.
 *
 *   ollama pull llama3.1 && ollama pull gemma3:4b           # once, on the machine running Ollama
 *   node scripts/read_scheme_claims.js                       # local Ollama (http://localhost:11434)
 *   MANIFESTO_CLAIMS_OLLAMA_URL=http://host:11434 node scripts/read_scheme_claims.js
 *
 * Re-run any time: posts already read are skipped, so after the first run it
 * only reads what arrived since. A post that fails is left for the next run.
 * Bump CLAIMS_VERSION in schemeClaimService.js to have everything read again.
 */
process.env.MANIFESTO_CLAIMS_OLLAMA_URL = process.env.MANIFESTO_CLAIMS_OLLAMA_URL || 'http://localhost:11434';
process.env.MANIFESTO_CLAIMS_MODELS = process.env.MANIFESTO_CLAIMS_MODELS || 'llama3.1:latest,gemma3:4b';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const mongoose = require('mongoose');
const { readAll } = require('../src/services/schemeClaimService');

const main = async () => {
    const url = process.env.MANIFESTO_CLAIMS_OLLAMA_URL;
    const models = process.env.MANIFESTO_CLAIMS_MODELS.split(',').map((m) => m.trim());
    // Fail fast with a clear message instead of a run of timeouts.
    const tags = await axios.get(`${url}/api/tags`, { timeout: 8000 }).catch(() => null);
    if (!tags) throw new Error(`no Ollama at ${url} — start it, or set MANIFESTO_CLAIMS_OLLAMA_URL`);
    const have = (tags.data.models || []).map((m) => m.name);
    const missing = models.filter((m) => !have.includes(m) && !have.includes(`${m}:latest`));
    if (missing.length) throw new Error(`missing on ${url}: ${missing.join(', ')} — run: ${missing.map((m) => `ollama pull ${m}`).join(' && ')}`);

    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cgsaga';
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(uri, dbName ? { dbName } : undefined);
    console.log(`Reading scheme posts with ${models.join(' + ')} at ${url}`);

    const t = Date.now();
    const clock = () => `${((Date.now() - t) / 60000).toFixed(1)} min`;
    // A line every 10 posts (and at the end of each model's pass): plain lines read the same in every terminal.
    const say = (line) => console.log(line);
    const out = await readAll({
        onEvent: (e) => {
            const what = e.what === 'NewsArticle' ? 'news articles' : 'posts';
            if (e.type === 'scan' && e.scanned) {
                say(`  [${clock()}] checked ${e.scanned} ${what}: ${e.named} name a scheme, ${e.unnamed} do not (marked as checked)`);
            } else if (e.type === 'read' && (e.at === 1 || e.at % 10 === 0 || e.at === e.of)) {
                say(`  [${clock()}] ${e.model} reading ${what} ${e.at}/${e.of}`);
            }
        },
        onProgress: ({ read, waiting, failed, failing, lastError }) => {
            const mins = (Date.now() - t) / 60000;
            const left = read ? Math.round((mins / read) * waiting) : '?';
            say(`  [${clock()}] saved · ${read} read so far · ${waiting} still to read in this block · ${failed} failed · about ${left} min left for this block${failing ? ` · failing: ${lastError}` : ''}`);
        },
    });
    console.log(`Done: ${out.read} posts and articles read${out.failed ? `; ${out.failed} failed and will be retried on the next run` : ''}.`);
    await mongoose.disconnect();
};

main().catch(async (err) => {
    console.error('[read-scheme-claims] failed:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
