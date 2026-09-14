// Exercise the app's actual GLTFLoader and terrain code without a browser/GPU.
// Dependencies are the five files pinned by index.html; see README.md.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
process.on('uncaughtException', e => { console.error(e.name + ': ' + e.message); process.exit(1); });
const root = process.cwd(), cache = new Map();
const vendor = path.resolve(process.argv[2] || 'data/cabin-blender/three');
globalThis.location = { protocol: 'http:', host: 'localhost' };
globalThis.self = globalThis;
// Decode embedded JPEGs with Pillow in this DOM-free check. Blender renders
// verify their appearance; this supplies real decoded dimensions to Three.
globalThis.createImageBitmap = async blob => {
  const result = spawnSync('python', ['-c', 'import sys,json; from PIL import Image; im=Image.open(sys.stdin.buffer); im.load(); print(json.dumps(dict(width=im.width,height=im.height)))'],
    { input: Buffer.from(await blob.arrayBuffer()), encoding: 'utf8' });
  if(result.status!==0)console.error('Texture decode:',result.error?.message,result.stderr);
  assert.equal(result.status, 0, result.stderr);
  return { ...JSON.parse(result.stdout), close() {} };
};
globalThis.ProgressEvent = class { constructor(type, data) { this.type = type; Object.assign(this, data); } };
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(url, options) { super(new URL(url, 'http://localhost').href, options); }
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
  if (url.protocol === 'blob:') {
    try{return await nativeFetch(input);}catch(err){console.error('Blob read:',err.message);throw err;}
  }
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
assert.equal(meshes.length, 5, 'three original batches plus two selected video surface materials');
const exported = scene.getObjectByName('CabinAsset');
const spec = JSON.parse(exported.userData.stair), surfaces = JSON.parse(exported.userData.terrain);
const report = JSON.parse(fs.readFileSync('authoring/cabin/export-report.json'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(hash('authoring/cabin/cabin.blend'), exported.userData.sourceSha256, 'export matches editable source');
assert.equal(hash('assets/site/389-cabin.glb'), report.sha256, 'report matches deployed asset');
for (const mesh of meshes) {
  if (mesh.material.map) {
    assert.ok(mesh.geometry.getAttribute('uv'), 'selected frame has exported UV coordinates');
    assert.equal(mesh.material.map.image.width,1920,'full-resolution selected video frame decoded');
    assert.equal(mesh.material.map.image.height,1080);
  } else assert.ok(mesh.geometry.getAttribute('color'), 'vertex colours survive Blender');
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
assert.ok(a.clone().expandByScalar(.0001).containsBox(b), 'original cabin remains within the extended site model');
assert.equal(meshes.filter(m=>m.material.map).length,2,'only the two selected surface frames are textures');
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
// Walk the complete new path at both sides of a 0.70 m corridor. Check a real
// surface below and clear space above it, independently of the clearance helper.
const layout=JSON.parse(exported.userData.walkthrough);
function pathY(x) {
  for(const [[a,ya],[b,yb]] of layout.stations.map((p,i)=>[p,layout.stations[i+1]]).slice(0,-1))
    if(x>=b-1e-6&&x<=a+1e-6)return yb+(ya-yb)*(x-b)/(a-b);
  throw Error('Point outside approach');
}
let routeSamples=0;
function walk(x,z,y) {
  const w=oldCabin.cabinWorld(x,z);
  ray.set(new THREE.Vector3(w.x,y+.035,w.z),down); ray.far=.07;
  const hit=ray.intersectObjects(meshes);
  assert.ok(hit.length&&Math.abs(hit[0].point.y-y)<.008,'new paved route surface '+[x,z,y]);
  ray.set(new THREE.Vector3(w.x,y+.025,w.z),new THREE.Vector3(0,1,0));ray.far=1.65;
  assert.equal(ray.intersectObjects(meshes).length,0,'body/head clearance '+[x,z,y]);
  routeSamples++;
}
for(let x=14.06;x<25.69;x+=.07)for(const dz of [-.35,0,.35])walk(x,8.4+dz,pathY(x));
for(let z=5.13;z<8.7;z+=.07)for(const dx of [-.35,0,.35])walk(13.45+dx,z,layout.junctionLevel);
for(let x=12.5;x<13.8;x+=.07)walk(x,5.10,layout.junctionLevel);
for(let z=4.65;z<8.4;z+=.08)walk(20.95,z,layout.shedBase);
for(let k=0;k<7;k++)walk(20.95,4.6-(k+.5)*2.2/7,layout.shedBase+(k+1)*(layout.branchTop-layout.shedBase)/7);
// Preserve measured trunks: none may intersect the newly laid walking corridor.
const treeData=JSON.parse(fs.readFileSync('assets/site/389-trees.json'));
for(const tree of treeData.trees) {
  const wx=(tree.lon+123.085318)*111320*Math.cos(48.989009*Math.PI/180), wz=-(tree.lat-48.989009)*111320;
  const t=oldCabin.cabinLocal(wx,wz), radius=tree.height_m*.02;
  if(t.x>14.05&&t.x<25.7)assert.ok(Math.abs(t.z-8.4)>radius+.55,'main path avoids measured tree');
  if(t.z>layout.junctionNorth&&t.z<8.95)assert.ok(Math.abs(t.x-13.45)>radius+.60,'turn avoids measured tree');
  if(t.z>2.4&&t.z<7.85)assert.ok(Math.abs(t.x-20.925)>radius+.525,'branch avoids measured tree');
}
fs.writeFileSync('data/cabin-blender/current-terrain.json',JSON.stringify({assetSha256:report.sha256,grid:g,heights:Array.from(terrain.heights)}));
console.log(`PASS: Three r${THREE.REVISION}, ${report.triangles} triangles, ${meshes.length} batches; source hash, frame texture decoding, ${samples} terrain checks, ${routeSamples} full-route walking/headroom samples, measured tree clearance, north connection and all 19 approach treads.`);
