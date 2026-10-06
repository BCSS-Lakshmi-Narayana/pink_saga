/**
 * textEncoding.js
 *
 * Repairs "mojibake" — text that was written as UTF-8 but read back as
 * Latin-1. Because Latin-1 maps every byte to some character, nothing throws:
 * each 3-byte Telugu letter silently becomes 3 wrong Latin characters, and the
 * garbage is stored as if it were real text.
 *
 *   written : తలపై            (UTF-8 bytes E0 B0 A4 …)
 *   read    : à°¤à°²à°ªà±     (those bytes as Latin-1)
 *
 * Encoding back to Latin-1 and decoding as UTF-8 is an exact inverse, so the
 * original characters return byte-for-byte.
 *
 * SAFETY: this must never damage text that is already correct. It therefore
 *   1. only acts on strings carrying the unambiguous mojibake signature,
 *   2. verifies the repair actually cleared that signature, and
 *   3. returns the input untouched if either check fails.
 */

/**
 * Every Indic script sits in the U+0900–U+0DFF range, whose UTF-8 lead byte is
 * 0xE0 — rendered as 'à' in Latin-1 — followed by a continuation byte in the
 * 0xA4–0xBF range. That covers Devanagari (à¤), Bengali (à¦), Gurmukhi (à¨),
 * Gujarati (àª), Tamil (à®), Telugu (à°/à±), Kannada (à²), Malayalam (à´).
 * 'â€' catches mangled smart quotes/dashes, 'Ã' catches accented Latin.
 */
const MOJIBAKE_SIGNATURE = /à[¤-¿]|â€[-¿™œ]|Ã[-¿]/;

/** Repair a single string. Returns the input unchanged when not mojibake. */
const fixMojibake = (value) => {
  if (typeof value !== 'string' || !value) return value;
  if (!MOJIBAKE_SIGNATURE.test(value)) return value;

  let repaired;
  try {
    repaired = Buffer.from(value, 'latin1').toString('utf8');
  } catch (_) {
    return value;
  }

  // A failed round-trip leaves U+FFFD; a correct one clears the signature.
  if (repaired.includes('�')) return value;
  return MOJIBAKE_SIGNATURE.test(repaired) ? value : repaired;
};

const MAX_DEPTH = 12;

/**
 * Walk a value and repair every string inside it, in place where possible.
 * Dates, ObjectIds, Buffers and RegExps are left alone.
 */
const repairDeep = (value, depth = 0) => {
  if (depth > MAX_DEPTH || value == null) return value;

  if (typeof value === 'string') return fixMojibake(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = repairDeep(value[i], depth + 1);
    return value;
  }

  if (typeof value !== 'object') return value;

  // Leave non-plain objects (Date, ObjectId, Buffer, RegExp) untouched.
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    Buffer.isBuffer(value) ||
    typeof value._bsontype === 'string'
  ) {
    return value;
  }

  // Mongoose subdocuments (embedded array elements) are live, schema-backed
  // objects — writing through their properties re-triggers Mongoose's own
  // cast/validate/dirty-tracking setters on every field, which is many times
  // more expensive than a plain assignment. Doing that for every element of
  // every array (engagement_history, media, url_cards, ...) on every single
  // save/update, across every schema, was pinning the event loop app-wide.
  // Plain data objects (constructor === Object, e.g. this._doc itself, or a
  // nested plain sub-object) are unaffected; only live ODM instances — whose
  // constructor is the compiled Mongoose model/subdocument class — are
  // skipped here. (Arrays were already handled and returned above.)
  if (value.constructor !== Object) {
    return value;
  }

  for (const key of Object.keys(value)) {
    value[key] = repairDeep(value[key], depth + 1);
  }
  return value;
};

/**
 * Mongoose plugin: repair text on every write path.
 *
 * `save` covers document writes; `insertMany` covers bulk inserts; the update
 * hooks cover `updateOne` / `findOneAndUpdate` / `updateMany`, which bypass
 * `save` entirely and are what most of the ingest services actually use.
 */
const mojibakeGuardPlugin = (schema) => {
  schema.pre('save', function (next) {
    try {
      repairDeep(this._doc);
    } catch (_) {
      /* never block a write because the guard failed */
    }
    next();
  });

  schema.pre('insertMany', function (next, docs) {
    try {
      if (Array.isArray(docs)) docs.forEach((d) => repairDeep(d));
    } catch (_) { /* ignore */ }
    next();
  });

  schema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], function (next) {
    try {
      const update = this.getUpdate();
      if (update) {
        // Repair operator payloads ($set/$setOnInsert/$push) and any
        // top-level replacement fields, but never the query filter.
        for (const key of Object.keys(update)) {
          if (key.startsWith('$')) repairDeep(update[key]);
          else update[key] = repairDeep(update[key]);
        }
      }
    } catch (_) { /* ignore */ }
    next();
  });
};

/* ---------------------------------------------------------------------------
 * Detection side: stopping the corruption before it is ever stored.
 *
 * The repair above is the right net for Latin-1 damage, but the X ingest hits a
 * case it deliberately declines: the RapidAPI provider intermittently serves a
 * whole response whose UTF-8 was decoded as WINDOWS-1252, not Latin-1. The tell
 * is codepoints Latin-1 has no business producing — U+201A, U+2039, U+02C6,
 * U+0178 — alongside U+FFFD.
 *
 * That variant is irreversible. Windows-1252 has no mapping for bytes
 * 0x81/0x8D/0x8F/0x90/0x9D, so those bytes are already gone by the time we see
 * the string. The Telugu virama U+0C4D encodes as E0 B1 8D, which means nearly
 * every Telugu word loses bytes permanently — fixMojibake() correctly bails out
 * via its U+FFFD check rather than writing damaged text.
 *
 * Since it cannot be repaired, it has to be caught on arrival: detect it in the
 * API response and re-request (a retry comes back clean), and never let a
 * mangled copy overwrite text already stored correctly.
 * ------------------------------------------------------------------------- */

// Windows-1252 byte -> codepoint for the 0x80-0x9F range, where it differs from
// Latin-1. 0x81, 0x8D, 0x8F, 0x90 and 0x9D are absent on purpose: they have no
// mapping, and that gap is precisely what makes this corruption irreversible.
const CP1252_HIGH = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152,
  0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A,
  0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178
};

const CP1252_TO_BYTE = new Map();
for (const [byte, codepoint] of Object.entries(CP1252_HIGH)) {
  CP1252_TO_BYTE.set(codepoint, Number(byte));
}

// A UTF-8 lead byte followed by what was a continuation byte. Continuations land
// either in U+0080-U+00BF or, for the 0x80-0x9F slice, on the Windows-1252
// punctuation codepoints / U+FFFD.
const MOJIBAKE_PAIR = new RegExp(
  '[\\u00C2-\\u00F4]' +
  '[\\u0080-\\u00BF\\u20AC\\u201A\\u0192\\u201E\\u2026\\u2020\\u2021\\u02C6\\u2030' +
  '\\u0160\\u2039\\u0152\\u017D\\u2018\\u2019\\u201C\\u201D\\u2022\\u2013\\u2014' +
  '\\u02DC\\u2122\\u0161\\u203A\\u0153\\u017E\\u0178\\uFFFD]',
  'g'
);

// A lone pair shows up in legitimate text (an "Ã" in a name). Real mojibake from
// a 3-byte script emits three pairs per character, so require a short run.
const MIN_PAIRS = 3;

/** True when `value` looks like UTF-8 that was decoded as Windows-1252. */
const looksDoubleEncoded = (value) => {
  if (typeof value !== 'string' || value.length < 3) return false;
  const matches = value.match(MOJIBAKE_PAIR);
  return matches !== null && matches.length >= MIN_PAIRS;
};

// Tweet text sits deep in a timeline payload — roughly
// data.user.result.timeline.instructions[].entries[].content.itemContent
//   .tweet_results.result.legacy.full_text — so the scan must reach past the
// depth a shallow walk would cover.
const MAX_SCAN_DEPTH = 16;

/**
 * Scans a parsed API response for the corruption, short-circuiting on the first
 * corrupt string. Walks nested objects so a mangled author bio is caught even
 * when the tweet itself is plain ASCII — the provider mangles a whole response
 * or none of it.
 */
const responseLooksDoubleEncoded = (payload, depth = 0) => {
  if (depth > MAX_SCAN_DEPTH || payload == null) return false;
  if (typeof payload === 'string') return looksDoubleEncoded(payload);
  if (Array.isArray(payload)) {
    return payload.some((item) => responseLooksDoubleEncoded(item, depth + 1));
  }
  if (typeof payload === 'object') {
    return Object.values(payload).some((item) => responseLooksDoubleEncoded(item, depth + 1));
  }
  return false;
};

/**
 * Reverses the Windows-1252 double-encoding, but only when nothing was lost —
 * i.e. the text stayed inside the Latin-1 range. Returns null when the original
 * bytes are unrecoverable (any Indic content), so callers re-fetch instead of
 * persisting a half-repaired string.
 */
const repairIfLossless = (value) => {
  if (!looksDoubleEncoded(value)) return null;

  const bytes = [];
  for (const char of value) {
    const codepoint = char.codePointAt(0);
    if (codepoint === 0xFFFD) return null;             // byte destroyed by the 1252 gap
    if (codepoint <= 0xFF) bytes.push(codepoint);
    else if (CP1252_TO_BYTE.has(codepoint)) bytes.push(CP1252_TO_BYTE.get(codepoint));
    else return null;                                   // not from a 1252 decode
  }

  const repaired = Buffer.from(bytes).toString('utf8');
  if (repaired.includes('�')) return null;         // reinterpretation failed
  return repaired;
};

/**
 * Guard for update paths: keep the stored text when the incoming copy is corrupt
 * and the stored one is not. Without this, a single bad poll permanently
 * corrupts a post that later ages out of the polling window and is never
 * refreshed again.
 */
const preferCleanText = (incoming, existing) => {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (looksDoubleEncoded(incoming) && !looksDoubleEncoded(existing)) return existing;
  return incoming;
};

module.exports = {
  fixMojibake,
  repairDeep,
  mojibakeGuardPlugin,
  MOJIBAKE_SIGNATURE,
  looksDoubleEncoded,
  responseLooksDoubleEncoded,
  repairIfLossless,
  preferCleanText
};
