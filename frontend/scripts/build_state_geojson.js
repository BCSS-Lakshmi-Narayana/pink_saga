#!/usr/bin/env node
/**
 * Builds the three map layers in frontend/public:
 *   state_ac.geojson        119 assembly constituencies (post-2008 delimitation)
 *   state_districts.geojson 33 districts
 *   state_outline.geojson   state outline
 *
 * Source: HindustanTimesLabs/shapefiles telangana_AC.json (MIT), 119
 * features keyed by AC_NO. Every AC takes its spelling, current district and
 * Lok Sabha seat from backend/src/data/state_voter_profiles.json — the file's
 * own DIST_NAME uses the PRE-2016 ten-district scheme and must not be used.
 *
 * No public GeoJSON has Telangana's 33 current districts, so districts are the
 * ACs dissolved by the district ECI assigns each AC to. An AC that spans two
 * districts is drawn wholly inside the one ECI names, so district edges are
 * approximate wherever the 2016/2019 districts cut across an AC — which in
 * Telangana is often, since 23 of the 33 districts postdate the delimitation.
 *
 * Requires network access and runs mapshaper through npx (not a project
 * dependency):   node frontend/scripts/build_state_geojson.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const { geoArea } = require('d3-geo');

const SRC_URL = 'https://raw.githubusercontent.com/HindustanTimesLabs/shapefiles/master/state_ut/telangana/assembly/telangana_AC.json';
const PUBLIC = path.join(__dirname, '..', 'public');
const PROFILES = require('../../backend/src/data/state_voter_profiles.json');

const download = (url) => new Promise((resolve, reject) => {
  https.get(url, (res) => {
    if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve(body));
  }).on('error', reject);
});

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-.])([a-z])/g, (m, a, b) => a + b.toUpperCase());

const toMultiPolygon = (geom) => {
  if (geom.type !== 'GeometryCollection') return geom;
  const polys = [];
  for (const g of geom.geometries) {
    if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
  }
  return { type: 'MultiPolygon', coordinates: polys };
};

/** d3-geo reads rings with the opposite winding as "the globe minus the shape". */
const fixWinding = (fc) => {
  const reverse = (poly) => poly.map((ring) => ring.slice().reverse());
  for (const f of fc.features) {
    if (geoArea(f) <= 2 * Math.PI) continue;
    if (f.geometry.type === 'Polygon') f.geometry.coordinates = reverse(f.geometry.coordinates);
    else if (f.geometry.type === 'MultiPolygon') f.geometry.coordinates = f.geometry.coordinates.map(reverse);
  }
  return fc;
};

(async () => {
  const src = JSON.parse(await download(SRC_URL));
  const byNo = new Map(PROFILES.map((p) => [p.ac_number, p]));

  const features = src.features
    .filter((f) => Number(f.properties.AC_NO) > 0)
    .map((f) => {
      const no = Number(f.properties.AC_NO);
      const p = byNo.get(no);
      if (!p) throw new Error(`No roster row for AC ${no}`);
      return {
        type: 'Feature',
        properties: {
          AC_NO: no,
          AC_NAME: titleCase(p.constituency),
          DIST_NAME: p.district,
          PC_NAME: p.lok_sabha,
          ST_NAME: 'Chhattisgarh',
          RESERVED: p.reserved_category || null,
        },
        geometry: toMultiPolygon(f.geometry),
      };
    })
    .sort((a, b) => a.properties.AC_NO - b.properties.AC_NO);
  // Expected count comes from the roster, not a literal: a hardcoded 90 is
  // what broke this on the Telangana build.
  const EXPECTED_ACS = PROFILES.length;
  if (features.length !== EXPECTED_ACS) {
    throw new Error(`Expected ${EXPECTED_ACS} ACs (from state_voter_profiles.json), got ${features.length}`);
  }

  const acPath = path.join(PUBLIC, 'state_ac.geojson');
  fs.writeFileSync(acPath, JSON.stringify(fixWinding({ type: 'FeatureCollection', features })));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stategeo-'));
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // Windows needs a shell for npx.cmd, and the shell splits unquoted paths on
  // spaces (the repo folder may contain one), so quote them there.
  const q = (a) => (process.platform === 'win32' && /\s/.test(a) ? `"${a}"` : a);
  const run = (args) => execFileSync(npx, ['-y', 'mapshaper@0.6', ...args.map(q)], { stdio: 'inherit', shell: process.platform === 'win32' });
  run([acPath, '-dissolve', 'DIST_NAME', 'copy-fields=ST_NAME', '-o', path.join(tmp, 'd.geojson'), 'format=geojson']);
  run([acPath, '-dissolve', 'copy-fields=ST_NAME', '-o', path.join(tmp, 's.geojson'), 'format=geojson']);

  for (const [from, to] of [['d.geojson', 'state_districts.geojson'], ['s.geojson', 'state_outline.geojson']]) {
    const fc = fixWinding(JSON.parse(fs.readFileSync(path.join(tmp, from), 'utf8')));
    fs.writeFileSync(path.join(PUBLIC, to), JSON.stringify(fc));
  }
  const R = 6371.0088;
  const d = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'state_districts.geojson'), 'utf8'));
  console.log('districts:', d.features.map((f) => `${f.properties.DIST_NAME} ${Math.round(geoArea(f) * R * R)} km²`).join(', '));
})().catch((err) => { console.error(err); process.exit(1); });
