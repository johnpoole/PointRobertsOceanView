// One-time migration of the legacy procedural model. Future edits belong in
// cabin.blend; running this and create_blend.py again would discard those edits.
// node authoring/cabin/bootstrap.mjs <three.module.js> <BufferGeometryUtils.js>
import fs from 'node:fs';
import path from 'node:path';
process.on('uncaughtException', e => { console.error(e.message); process.exit(1); });
const root = process.cwd(), cache = new Map();
const three = path.resolve(process.argv[2]), utils = path.resolve(process.argv[3]);
globalThis.location = { protocol: 'http:', host: 'localhost' };
globalThis.cabinParts = [];
globalThis.cabinSection = 'Walls and siding';
const sections = [
  ['// Boards span the narrow east passage.', 'East passage boards'],
  ['// Retaining blocks on the uphill edge.', 'East retaining blocks'],
  ['const beamTop =', 'Deck posts beams and braces'],
  ['// PXL_20250514_163557098:', 'Lower west glazing'],
  ['westRun(UPPER_FLOOR, WEST_HEAD, WEST_UPPER);', 'Upper west glazing'],
  ['// The entrance is on the east-facing inset wall', 'Notch entrance doors'],
  ['// The north gable end:', 'North window'],
  ['// The south gable end,', 'South picture window'],
  ['// The narrow lower south window', 'Lower south window'],
  ['// Cut every roof component', 'Roof shell'],
  ['// May 2025 roof close-ups:', 'Standing seams'],
  ['// Fascia round the eave', 'Fascia and open soffits'],
  ['// The chimney,', 'Brick chimney'],
  ['// The upper deck,', 'Upper deck and wire rails'],
  ['// The lower deck,', 'Lower deck and lattice'],
  ['// The concrete flight,', 'Lower south concrete flight'],
  ['// Level concrete access', 'South landings and upper flight'],
  ['// North access in', 'North landings and timber flight'],
];
function load(file) {
  if (cache.has(file)) return cache.get(file);
  let source = fs.readFileSync(file, 'utf8');
  if (file === path.join(root, 'src/scene/cabin.js')) {
    source = source.replace('parts.push(geom);',
      'parts.push(geom); globalThis.cabinParts.push({name: globalThis.cabinSection, geometry: geom});');
    for (const [marker, name] of sections) {
      if (!source.includes(marker)) throw new Error('Missing migration marker: ' + marker);
      source = source.replace(marker, `globalThis.cabinSection = ${JSON.stringify(name)};\n  ${marker}`);
    }
  }
  source = source.replace(/from\s+["']([^"']+)["']/g, (_, ref) =>
    `from "${load(ref === 'three' ? three : ref === 'three/addons/utils/BufferGeometryUtils.js'
      ? utils : path.resolve(path.dirname(file), ref))}"`);
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  cache.set(file, url); return url;
}
globalThis.fetch = async url => {
  const b = fs.readFileSync(path.resolve(root, url));
  return { ok: true, json: async () => JSON.parse(b),
    arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const THREE = await import(load(three));
const cabin = await import(load(path.join(root, 'src/scene/cabin.js')));
const stairs = await import(load(path.join(root, 'src/scene/stair.js')));
const { buildTerrain } = await import(load(path.join(root, 'src/scene/terrain.js')));
const spec = JSON.parse(fs.readFileSync('assets/site/389-stair.json'));
const terrain = await buildTerrain(new THREE.Group(), {
  meta: 'assets/terrain/meta_fine.json', heightmap: 'assets/terrain/heightmap_fine.bin',
}, { gravel: false, projector: false, fog: false, refine: 4, preserveSurvey: true,
  carveForGrid: d => {
    const a = cabin.cabinCarve(d), b = stairs.stairCarve(spec, d, cabin.cabinApproachEdge());
    return (lat, lon, y) => a(lat, lon, b(lat, lon, y));
  } });
cabin.buildCabin(new THREE.Group(), terrain.sample, terrain.surveySample);
const groups = new Map();
function append(name, geometry, material, crop = false) {
  if (!groups.has(name)) groups.set(name, { name, position: [], color: [] });
  const out = groups.get(name), p = geometry.attributes.position, c = geometry.attributes.color;
  const ix = geometry.index;
  for (let k = 0; k < (ix?.count ?? p.count); k += 3) {
    const ids = [0, 1, 2].map(i => ix ? ix.getX(k + i) : k + i);
    if (crop && !ids.some(i => {
      const v = cabin.cabinLocal(p.getX(i), p.getZ(i));
      return v.x > -18 && v.x < 35 && v.z > -25 && v.z < 28;
    })) continue;
    for (const i of ids) {
      // Blender: east, north, up; local horizontal origin at the roof centre.
      out.position.push(p.getX(i) + 34.17, -(p.getZ(i) + 7.03), p.getY(i));
      out.color.push(...(c ? [c.getX(i), c.getY(i), c.getZ(i)] : material.color.toArray()));
    }
  }
}
for (const part of globalThis.cabinParts) append(part.name, part.geometry);
const roadStair = stairs.buildStair(new THREE.Group(), spec, null, cabin.cabinApproachEdge());
roadStair.meshes.forEach((m, i) => append(['Approach concrete treads and landings',
  'Approach risers and paving joints', 'Approach timber handrails'][i], m.geometry, m.material));
append('Cleared terrain reference', terrain.mesh.geometry, terrain.mesh.material, true);
const surveyed = terrain.mesh.geometry.clone();
const pos = surveyed.attributes.position;
const { fromWorld } = await import(load(path.join(root, 'src/geo.js')));
for (let i = 0; i < pos.count; i++) {
  const ll = fromWorld(pos.getX(i), pos.getZ(i));
  pos.setY(i, terrain.surveySample(ll.lat, ll.lon));
}
append('Original survey reference', surveyed, terrain.mesh.material, true);
const surfaces = cabin.cabinGroundSurfaces().map((s, i) => ({
  name: `Cabin clearance ${String(i + 1).padStart(2, '0')}`,
  polygon: s.polygon.map(([x, z]) => {
    const w = cabin.cabinWorld(x, z); return [w.x + 34.17, -(w.z + 7.03), s.ceiling];
  }),
}));
const access = stairs.stairAccess(spec, cabin.cabinApproachEdge());
for (const [name, polygon] of [['Entrance bridge clearance', access.bottom], ['Approach head clearance', access.head]]) {
  surfaces.push({ name, polygon: polygon.map(([x, y, z]) => [x + 34.17, -(z + 7.03), y - .28]) });
}
const manifest = JSON.parse(fs.readFileSync('images/cabin-walkthrough-20170718/manifest.json'));
const data = { worldOrigin: [-34.17, 0, -7.03], yaw: .318,
  objects: [...groups.values()], surfaces, stair: spec,
  approachEdge: cabin.cabinApproachEdge(), videoManifest: manifest };
fs.mkdirSync('data/cabin-blender', { recursive: true });
fs.writeFileSync('data/cabin-blender/bootstrap.json', JSON.stringify(data));
console.log(`Prepared ${groups.size} named meshes and ${surfaces.length} clearance surfaces.`);
