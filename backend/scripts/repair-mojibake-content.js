/**
 * Manual full sweep for double-encoded text (UTF-8 decoded as Windows-1252
 * upstream), e.g. Telugu stored as "à°µà°°à±�à°·à°¾à°•à°¾à°²à°‚".
 *
 * The same sweep runs automatically every 30 minutes in the server
 * (mojibakeHealerService, started from index.js) with a per-run cap. This script
 * exists to run it on demand and unbounded — e.g. to clear a backlog after an
 * incident, or to check the current state without waiting for the next tick.
 *
 * NOTE: not the same as scripts/repair_mojibake.js, which repairs strings
 * arithmetically in place. That works for Latin-1 damage but cannot touch this
 * variant: Windows-1252 has no mapping for 0x8D/0x8F/0x90, so the bytes behind
 * the Telugu virama (U+0C4D = E0 B1 8D) are already destroyed. The only way back
 * is to re-fetch from the API, which is what this does. Anything that IS
 * losslessly repairable is fixed without spending an API call.
 *
 * Usage:
 *   node scripts/repair-mojibake-content.js            # report only
 *   node scripts/repair-mojibake-content.js --fix      # re-fetch and update
 *
 * Needs BLUGATE_API_KEY / BLUGATE_CLIENT_CODE, so run it where the monitor runs.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { runMojibakeHealOnce } = require('../src/services/mojibakeHealerService');

const APPLY = process.argv.includes('--fix');
const UNBOUNDED = 100000; // manual runs are not capped the way the scheduled sweep is

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });

  const result = await runMojibakeHealOnce({ maxPerRun: UNBOUNDED, dryRun: !APPLY });

  const line = (label, s) =>
    console.log(`  ${label.padEnd(12)} found=${s.found} repaired=${s.repaired} failed=${s.failed}`);

  console.log(APPLY ? '\n=== repair run ===' : '\n=== dry run (no writes) ===');
  line('contents', result.contents);
  line('grievances', result.grievances);
  line('alerts', result.alerts);

  if (!APPLY) {
    console.log(`\n${result.total} document(s) affected. Re-run with --fix to repair.`);
  } else {
    const fixed = result.contents.repaired + result.grievances.repaired + result.alerts.repaired;
    const failed = result.contents.failed + result.grievances.failed + result.alerts.failed;
    console.log(`\nDone. repaired=${fixed} failed=${failed}`);
    if (failed) {
      console.log('Failed rows are usually a response that came back double-encoded again —');
      console.log('re-running normally clears them, and the scheduled sweep will retry anyway.');
    }
  }

  console.log('\nNote: `newsarticles` is ingested by Blura-Engine (Python); see commit c08fdf8.');

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
