// Exercise the app's actual GLTFLoader and terrain code without a browser/GPU.
// Dependencies are the five files pinned by index.html; see README.md.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.on('uncaughtException', e => { console.error(e.name + ': ' + e.message); process.exit(1); });
const root = process.cwd(), cache = new Map();
const vendor = path.resolve(process.argv[2] || 'data/cabin-blender/three');
globalThis.location = { protocol: 'http:', host: 'localhost' };
globalThis.ProgressEvent = class { constructor(type, data) { this.type = type; Object.assign(this, data); } };
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(url, options) { super(new URL(url, 'http://localhost').href, options); }
};
globalThis.fetch = async input => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
  const b = fs.readFileSync(path.join(root, decodeURIComponent(url.pathname)));
  return new Response(b, { headers: { 'Content-Length': b.length } });
};
function load(file) {
  if (cache.has(file)) return cache.get(file);
  let source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  source = source.replace(/((?:^|\n)\s*(?:import|export)\s+(?:\*|\{)[\s\S]*?\sfrom\s+)["']([^"']+)["']/g, (_, prefix, ref) =>
    `${prefix}"${load(ref === 'three' ? path.join(vendor, 'three.module.js')
      : ref.startsWith('three/addons/') ? path.join(vendor, ref.slice('three/addons/'.length))
      : path.resolve(path.dirname(file), ref))}"`);
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  cache.set(file, url); return url;
}
const THREE = await import(load(path.join(vendor, 'three.module.js')));
const { loadCabinAsset } = await import(load(path.join(root, 'src/scene/cabin-asset.js')));
const { buildTerrain } = await import(load(path.join(root, 'src/scene/terrain.js')));
const oldCabin = await import(load(path.join(root, 'src/scene/cabin.js')));
const { stairCarve, buildStair } = await import(load(path.join(root, 'src/scene/stair.js')));
const { fromWorld } = await import(load(path.join(root, 'src/geo.js')));
const scene = new THREE.Group(), asset = await loadCabinAsset();
asset.addTo(scene, null); scene.updateMatrixWorld(true);
const meshes = [];
scene.traverse(o => { if (o.isMesh) meshes.push(o); });
assert.equal(meshes.length, 3, 'only cabin and access material batches; no survey or photos');
const exported = scene.getObjectByName('CabinAsset');
const spec = JSON.parse(exported.userData.stair), surfaces = JSON.parse(exported.userData.terrain);
const report = JSON.parse(fs.readFileSync('authoring/cabin/export-report.json'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(hash('authoring/cabin/cabin.blend'), exported.userData.sourceSha256, 'export matches editable source');
assert.equal(hash('assets/site/389-cabin.glb'), report.sha256, 'report matches deployed asset');
for (const mesh of meshes) {
  assert.ok(mesh.geometry.getAttribute('color'), 'vertex colours survive Blender');
  assert.equal(mesh.material.map, null, 'reference photos are not exported textures');
  assert.equal(mesh.material.side, THREE.DoubleSide, 'preserve cabin two-sided material');
  for (const attr of Object.values(mesh.geometry.attributes)) {
    for (const value of attr.array) assert.ok(Number.isFinite(value), 'finite exported attributes');
  }
}
const terrain = await buildTerrain(new THREE.Group(), {
  meta: 'assets/terrain/meta_fine.json', heightmap: 'assets/terrain/heightmap_fine.bin',
}, { gravel: false, projector: false, fog: false, refine: 4, preserveSurvey: true,
  carveForGrid: d => asset.carve(d) });
const legacy = new THREE.Group();
oldCabin.buildCabin(legacy, terrain.sample, terrain.surveySample);
buildStair(legacy, JSON.parse(fs.readFileSync('assets/site/389-stair.json')), null, oldCabin.cabinApproachEdge());
legacy.updateMatrixWorld(true);
const a = new THREE.Box3().setFromObject(scene), b = new THREE.Box3().setFromObject(legacy);
assert.ok(a.min.distanceTo(b.min) < .0001 && a.max.distanceTo(b.max) < .0001, 'export orientation and origin match existing model');
assert.equal(meshes.reduce((n,m) => n + m.geometry.index.count/3, 0), report.triangles);

const g = terrain.meta.grid, p = terrain.mesh.geometry.attributes.position;
function triangle(lat, lon) {
  const r = (g.north_lat - lat)/g.cellsize_deg, c = (lon - g.west_lon)/g.cellsize_deg;
  const i = Math.floor(r), j = Math.floor(c), u = c-j, v = r-i;
  const a = p.getY(i*g.ncols+j), b = p.getY(i*g.ncols+j+1);
  const c0 = p.getY((i+1)*g.ncols+j), d = p.getY((i+1)*g.ncols+j+1);
  return u+v <= 1 ? a*(1-u-v)+b*u+c0*v : b*(1-v)+c0*(1-u)+d*(u+v-1);
}
function inside(poly,x,z) {
  let yes=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const [a,b]=poly[i],[d,e]=poly[j];
    if((b>z)!==(e>z)&&x<(d-a)*(z-b)/(e-b)+a) yes=!yes;
  }
  return yes;
}
let samples = 0;
for (const s of surfaces) {
  const xs=s.polygon.map(p=>p[0]), zs=s.polygon.map(p=>p[1]);
  for(let x=Math.min(...xs)+.001;x<Math.max(...xs);x+=.047)
    for(let z=Math.min(...zs)+.001;z<Math.max(...zs);z+=.049) {
      if(!inside(s.polygon,x,z)) continue;
      const ll=fromWorld(x,z);
      assert.ok(terrain.sample(ll.lat,ll.lon)<=s.ceiling+.00001, 'walking sampler below exported clearance');
      assert.ok(triangle(ll.lat,ll.lon)<=s.ceiling+.00001, 'actual terrain triangles below exported clearance');
      samples++;
    }
}
const ray = new THREE.Raycaster(), down = new THREE.Vector3(0,-1,0);
function floor(x,z,y) {
  const w=oldCabin.cabinWorld(x,z);
  ray.set(new THREE.Vector3(w.x,y+.03,w.z),down); ray.far=.06;
  const hits=ray.intersectObjects(meshes);
  assert.ok(hits.length && Math.abs(hits[0].point.y-y)<.00001, 'GLB walking surface at '+[x,z,y]);
}
// Real exported surfaces across the corrected north route, not just plan values.
const head=-2.035, foot=-4.555, northZ=-3.85;
const topCount=Math.ceil((3.235-head)/.145), bottomCount=Math.ceil(.91/.145);
for(let k=0;k<topCount;k++) floor(head+(k+.5)*(3.235-head)/topCount,northZ,10.45);
for(let k=0;k<9;k++) floor(head-(k+.5)*.28,northZ,10.45-(k+1)*(1.9/9));
for(let k=0;k<bottomCount;k++) floor(foot-.91+(k+.5)*.91/bottomCount,northZ,8.55);
for(const x of [-5.3,-5.1,-4.9,-4.7]) floor(x,-3.3,8.55);
const northStart=oldCabin.cabinWorld(-5,-3.85), northEnd=oldCabin.cabinWorld(-5,-3.05);
ray.set(new THREE.Vector3(northStart.x,9.25,northStart.z),
  new THREE.Vector3(northEnd.x-northStart.x,0,northEnd.z-northStart.z).normalize());
ray.far=.8;
assert.equal(ray.intersectObjects(meshes).length,0,'no rail or wall blocks north lower landing into deck');
const fx=(spec.bottom.lon+123.085318)*111320*Math.cos(48.989009*Math.PI/180);
const fz=-(spec.bottom.lat-48.989009)*111320, bearing=spec.bearing_deg*Math.PI/180;
for(let k=0;k<spec.steps;k++) {
  const along=(k+.5)*spec.going_m, x=fx+Math.sin(bearing)*along, z=fz-Math.cos(bearing)*along;
  const y=spec.bottom.ground_m+k*spec.rise_m, ll=fromWorld(x,z);
  ray.set(new THREE.Vector3(x,y+.03,z),down);ray.far=.06;
  assert.ok(ray.intersectObjects(meshes).length,'owner tread present in GLB');
  assert.ok(triangle(ll.lat,ll.lon)<y,'terrain below owner tread');
}
console.log(`PASS: Three r${THREE.REVISION} loads ${report.triangles} triangles in 3 batches; source hash, colours, axes, ${samples} terrain mesh/sampler checks, north landing/stair/deck connection, all 19 approach treads.`);
