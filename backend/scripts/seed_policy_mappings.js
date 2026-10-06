/**
 * seed_policy_mappings.js
 * ─────────────────────────────────────────────────────────────────────
 * Seeds the `policymappings` collection that powers MappingService.
 *
 * Why this exists: the app reads category → legal section / platform
 * policy mappings from MongoDB (see src/services/mappingService.js). If
 * the collection is empty you see:
 *     [MappingService] Successfully loaded 0 category mappings from MongoDB.
 *
 * Source of truth for the legal_sections + platform_policies is
 * src/config/mapping_data.json (also used as the in-process fallback).
 * Human-readable `definition` and `severity_level` — required by the
 * PolicyMapping schema but absent from that JSON — are supplied by the
 * CATEGORY_META table below.
 *
 * Connects to the SAME database the app uses: MONGODB_URI + DB_NAME.
 * (The URI has no database path, so DB_NAME — "cgsaga" — is required;
 * omitting it would seed the default "test" db and the app would still
 * load 0 mappings.)
 *
 * Idempotent: upserts by category_id, so re-running updates existing
 * documents instead of duplicating or skipping them.
 *
 *   node scripts/seed_policy_mappings.js
 *   node scripts/seed_policy_mappings.js --dry-run   # show plan, write nothing
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const PolicyMapping = require('../src/models/PolicyMapping');
const mappingData = require('../src/config/mapping_data.json');

const DRY_RUN = process.argv.includes('--dry-run');

// definition (required by schema) + severity_level per category.
// Keyed by category_id from mapping_data.json.
const CATEGORY_META = {
  Communal_Violence: {
    definition: 'Promotes or supports physical violence, riots or destruction between religious or communal groups.',
    severity_level: 'High',
  },
  Hate_Speech: {
    definition: 'Insults, dehumanises or promotes hatred against a protected group (religion, caste, community, ethnicity, nationality, etc.) without a physical threat.',
    severity_level: 'High',
  },
  Hate_Speech_Threat: {
    definition: 'Hate speech with a direct or implied physical threat against a protected group.',
    severity_level: 'High',
  },
  Hate_Speech_Threat_Extremist: {
    definition: 'Hate or violent content supporting extremist, terrorist or organised violent ideology.',
    severity_level: 'High',
  },
  Harassment: {
    definition: 'Targeted hostile or intimidating behaviour against a specific person.',
    severity_level: 'Medium',
  },
  Abusive: {
    definition: 'Personal insults, profanity or degrading remarks about a person or people (including vulgar family or sexualised slurs in any language), without threats and without protected-group targeting.',
    severity_level: 'High',
  },
  Sexual_Harassment: {
    definition: 'Unwelcome sexual remarks or sexualised targeting.',
    severity_level: 'High',
  },
  Sexual_Violence: {
    definition: 'Threats or support of rape or sexual assault.',
    severity_level: 'High',
  },
  Sexual: {
    definition: 'Sexual references without targeting or coercion.',
    severity_level: 'Medium',
  },
  threat: {
    definition: 'Direct threat of physical harm against a person or group (not identity-based).',
    severity_level: 'High',
  },
  threat_incitement: {
    definition: 'Urging or mobilising others to commit violence.',
    severity_level: 'High',
  },
  Misinformation: {
    definition: 'False or misleading claims likely to cause public harm, panic or prejudice to national integration.',
    severity_level: 'Medium',
  },
  Communal_Content: {
    definition: 'Communal or religious references that are flagged for review but carry no specific legal section or platform policy by default.',
    severity_level: 'Low',
  },
  Normal: {
    definition: 'News, complaints, political messaging, slogans, lyrics, praise, opinions or neutral discussion without abuse, threats, hate, sexual targeting or misinformation.',
    severity_level: 'Low',
  },
};

function buildDocuments() {
  const source = mappingData.category_mappings || [];
  return source.map((m) => {
    const meta = CATEGORY_META[m.category_id];
    if (!meta) {
      throw new Error(
        `No CATEGORY_META (definition/severity) defined for category_id "${m.category_id}". ` +
        `Add it to seed_policy_mappings.js.`
      );
    }
    return {
      category_id: m.category_id,
      definition: meta.definition,
      severity_level: meta.severity_level,
      legal_sections: m.legal_sections || [],
      platform_policies: m.platform_policies || {},
      keywords: m.keywords || [],
      is_active: true,
    };
  });
}

async function seed() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;

  if (!uri) {
    console.error('Error: MONGODB_URI is not set in .env');
    process.exit(1);
  }
  if (!dbName) {
    console.warn('Warning: DB_NAME is not set — the app reads it, so seeding without it likely targets the wrong database.');
  }

  const documents = buildDocuments();
  console.log(`Prepared ${documents.length} category mappings from mapping_data.json.`);

  if (DRY_RUN) {
    documents.forEach((d) =>
      console.log(`  PLAN  ${d.category_id.padEnd(32)} severity=${d.severity_level} sections=${d.legal_sections.length}`)
    );
    console.log('\nDry run — no changes written.');
    process.exit(0);
  }

  try {
    await mongoose.connect(uri, dbName ? { dbName } : undefined);
    console.log(`Connected to MongoDB (db: ${dbName || 'default'}).`);

    let inserted = 0;
    let updated = 0;
    for (const doc of documents) {
      const res = await PolicyMapping.updateOne(
        { category_id: doc.category_id },
        { $set: { ...doc, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
        { upsert: true }
      );
      if (res.upsertedCount > 0) {
        console.log(`  INSERT ${doc.category_id}`);
        inserted++;
      } else {
        console.log(`  UPDATE ${doc.category_id}`);
        updated++;
      }
    }

    const total = await PolicyMapping.countDocuments({ is_active: true });
    console.log(`\nDone — inserted: ${inserted}, updated: ${updated}.`);
    console.log(`Active mappings now in '${dbName}': ${total}.`);
    console.log('Restart the backend (or wait for the 5-min refresh) to load them.');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
}

seed();
