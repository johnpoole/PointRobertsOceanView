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
// The old deck footprint is intentionally reduced; retain the fitted roof and
// building envelope, not the superseded seaward extent of the legacy model.
for(const x of [-4.085,4.085])for(const z of [-4.245,4.245]) {
  const w=oldCabin.cabinWorld(x,z);
  assert.ok(a.containsPoint(new THREE.Vector3(w.x,12.8,w.z)), 'fitted cabin roof envelope retained');
}
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
      assert.ok(terrain.sample(ll.lat,ll.lon)<=s.ceiling+.00001,
        'walking sampler below '+s.name+' at '+[x,z]+': '+terrain.sample(ll.lat,ll.lon)+' > '+s.ceiling);
      assert.ok(triangle(ll.lat,ll.lon)<=s.ceiling+.00001, 'actual terrain triangles below exported clearance');
      samples++;
    }
}
const ray = new THREE.Raycaster(), down = new THREE.Vector3(0,-1,0);
// East wall: complete block courses and a clear boarded passage, rather than
// independent lidar-height columns. Check the exported triangles, not helpers.
const eastWall=JSON.parse(fs.readFileSync('authoring/cabin/east-wall-layout.json'));
const eastDirection=new THREE.Vector3(Math.cos(.318),0,-Math.sin(.318));
let eastWallChecks=0;
for(let z=-2.73;z<3.3;z+=.27) {
  for(const row of [1,3,5]) {
    const w=oldCabin.cabinWorld(4.3,z),y=eastWall.wall.base+row*.2+.1;
    ray.set(new THREE.Vector3(w.x,y,w.z),eastDirection);ray.far=.7;
    const hit=ray.intersectObjects(meshes)[0];assert.ok(hit,'continuous east retaining wall');
    assert.ok(Math.abs(oldCabin.cabinLocal(hit.point.x,hit.point.z).x-(4.46+row*.025))<.025,'photo wall setback follows courses');
    eastWallChecks++;
  }
  for(const x of [3.55,3.95,4.3]) {
    // Sample board centres, avoiding the intentional 4 mm timber joints.
    const pitch=6.39/45,boardZ=-2.995+(Math.floor((z+2.995)/pitch)+.5)*pitch;
    const w=oldCabin.cabinWorld(x,boardZ);
    ray.set(new THREE.Vector3(w.x,10.48,w.z),down);ray.far=.08;
    assert.ok(ray.intersectObjects(meshes).some(h=>Math.abs(h.point.y-10.45)<.0001),'boarded east passage remains');
    ray.set(new THREE.Vector3(w.x,10.48,w.z),new THREE.Vector3(0,1,0));ray.far=1.65;
    assert.equal(ray.intersectObjects(meshes).length,0,'wall and planting leave passage headroom');
  }
}
// The bank now belongs to the terrain mesh and sampler, never a second skin.
const entranceLayout=JSON.parse(fs.readFileSync('authoring/cabin/entrance-layout.json'));
assert.ok(exported.userData.grade,'authored grade travels with the cabin GLB');
const gradeSpec=JSON.parse(exported.userData.grade);
const {terrainGrade}=await import(load(path.join(root,'src/scene/terrain-grade.js')));
const fitGrade=terrainGrade(gradeSpec);
const testGrade=terrainGrade({fade:1,triangles:[[[0,2,0],[1,3,0],[0,2,1]]]});
assert.equal(testGrade(.25,.25,0),2.25,'barycentric grade');
assert.equal(testGrade(-2,0,9),9,'grade leaves distant ground alone');
assert.ok(Math.abs(testGrade(-.999,0,9)-9)<.001,'grade blends into surrounding terrain');
assert.equal(terrainGrade(null)(0,0,7),7,'older GLBs keep their terrain behavior');
const activeNames=JSON.parse(exported.userData.sourceObjects);
for(const n of entranceLayout.retired)assert.ok(!activeNames.includes(n),'unsupported bank/return is not exported: '+n);
for(const x of [6.2,6.7,7.1])for(const z of [-1.1,.5,1.9,2.7]) {
 const w=oldCabin.cabinWorld(x,z),ll=fromWorld(w.x,w.z),desired=fitGrade(w.x,w.z,0);
 assert.ok(Math.abs(terrain.sample(ll.lat,ll.lon)-desired)<.015,'terrain sampler follows authored bank');
 assert.ok(Math.abs(triangle(ll.lat,ll.lon)-desired)<.02,'visible terrain follows same bank grade');
}
// Upper deck: the tree is outside the deck/rail envelope, in an open notch.
const upperDeck=JSON.parse(fs.readFileSync('authoring/cabin/upper-deck-layout.json'));
assert.ok(upperDeck.southEdge.west[1]-upperDeck.southEdge.east[1]>1,
  'south return widens toward the water');
const deckTree=upperDeck.tree, notch=upperDeck.notch;
assert.ok(notch.back-notch.west<1.0,'owner correction: shallow edge notch, not a deep slot');
assert.ok(deckTree.x-notch.west>0 && deckTree.x-notch.west<.25,'tree barely inside seaward edge');
const runtimeDeckTree=JSON.parse(fs.readFileSync('assets/site/389-trees.json')).trees.find(t=>t.id==='cabin-deck-tree');
assert.ok(runtimeDeckTree?.position_override?.original,'original rejected tree position is retained as provenance');
const runtimeTreeWorld={x:(runtimeDeckTree.lon+123.085318)*111320*Math.cos(48.989009*Math.PI/180),
  z:-(runtimeDeckTree.lat-48.989009)*111320};
const shape=runtimeDeckTree.shape_override;
assert.ok(shape && shape.lean_degrees>=4 && shape.lean_degrees<=10,'photo tree leans seaward');
const { buildPhotoTree } = await import(load(path.join(root,'src/scene/deck-tree.js')));
const photoTree=buildPhotoTree(new THREE.Group(),runtimeDeckTree);
let treeTriangles=0;
photoTree.group.traverse(o=>{
  if(!o.geometry)return;
  for(const attr of Object.values(o.geometry.attributes))for(const n of attr.array)assert.ok(Number.isFinite(n),'finite photo-tree geometry');
  treeTriangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
});
assert.equal(photoTree.group.children.length,2,'one bark mesh and one sparse foliage mesh');
assert.ok(treeTriangles<2000 && shape.foliage.length<=20,'small separated foliage clusters, bounded geometry');
const foliageVolume=shape.foliage.reduce((sum,f)=>sum+4/3*Math.PI*f.scale[0]*f.scale[1]*f.scale[2],0);
assert.ok(foliageVolume<10,'open crown rather than a filled canopy volume');
const top=shape.trunk.at(-1).at;
assert.ok(top[0]<-2 && top[1]>20,'trunk top leans west away from cabin');
const treeCamera=new THREE.PerspectiveCamera(60,1,.1,3000);
treeCamera.position.copy(photoTree.group.position).add(new THREE.Vector3(-15,10,15));
treeCamera.lookAt(photoTree.group.position.clone().add(new THREE.Vector3(0,10,0)));
photoTree.update(treeCamera);assert.equal(photoTree.group.visible,true);
photoTree.update(treeCamera,false);assert.equal(photoTree.group.visible,false,'home-tree visibility remains controllable');
treeCamera.position.y+=3000;photoTree.update(treeCamera);assert.equal(photoTree.group.visible,false,'photo tree culls at distance');
assert.equal(upperDeck.upperProjection,2.4,'upper seaward projection narrowed');
assert.equal(upperDeck.lowerProjection,2.1,'lower deck stays inside upper edge');
const runtimeTreeLocal=oldCabin.cabinLocal(runtimeTreeWorld.x+shape.deckContactOffset[0],runtimeTreeWorld.z+shape.deckContactOffset[2]);
assert.ok(Math.hypot(runtimeTreeLocal.x-deckTree.x,runtimeTreeLocal.z-deckTree.z)<1e-6,'web tree and Blender notch share corrected anchor');
const restored=oldCabin.cabinWorld((notch.back-3.235)/2,deckTree.z);
ray.set(new THREE.Vector3(restored.x,10.48,restored.z),down);ray.far=.06;
assert.ok(ray.intersectObjects(meshes).some(h=>Math.abs(h.point.y-10.45)<.00001),'floor restored inside the former oversized notch');
let notchChecks=0;
for(let dx=-.5;dx<=.5;dx+=.125)for(let dz=-.5;dz<=.5;dz+=.125) {
  const w=oldCabin.cabinWorld(deckTree.x+dx,deckTree.z+dz);
  ray.set(new THREE.Vector3(w.x,11.65,w.z),down);ray.far=1.7;
  assert.equal(ray.intersectObjects(meshes).length,0,'no deck, rail or framing through tree notch');notchChecks++;
}
// Keep a usable passage behind the three-sided notch rail, along the wall.
for(let z=notch.north-.3;z<notch.south+.3;z+=.12) {
  for(const x of [notch.back+.15,-3.385]) {
    const w=oldCabin.cabinWorld(x,z);
    ray.set(new THREE.Vector3(w.x,10.48,w.z),down);ray.far=.06;
    assert.ok(ray.intersectObjects(meshes).some(h=>Math.abs(h.point.y-10.45)<.00001),'deck passage behind notch');
    ray.set(new THREE.Vector3(w.x,10.48,w.z),new THREE.Vector3(0,1,0));ray.far=1.65;
    assert.equal(ray.intersectObjects(meshes).length,0,'clear passage behind notch');
  }
}
// Former rail must no longer cross the mouth; the new widened corner is solid.
const mouth=oldCabin.cabinWorld(notch.west,deckTree.z);
ray.set(new THREE.Vector3(mouth.x,11.65,mouth.z),down);ray.far=1.7;
assert.equal(ray.intersectObjects(meshes).length,0,'open seaward mouth of notch');
for(const x of [notch.west+.2,notch.west+.7,-4]) {
  const w=oldCabin.cabinWorld(x,4.55);
  ray.set(new THREE.Vector3(w.x,10.48,w.z),down);ray.far=.06;
  assert.ok(ray.intersectObjects(meshes).some(h=>Math.abs(h.point.y-10.45)<.00001),'new tapered return has a floor');
}
// Owner's August south view places the door in the first seaward bay.
// Test actual GLB rays and actual terrain, not merely authoring coordinates.
const greenDoor = JSON.parse(fs.readFileSync('authoring/cabin/green-door-layout.json')).door;
assert.ok(greenDoor.x-.53>=-3.235-upperDeck.lowerProjection && greenDoor.x+.53<-3.235,
  'full-width door stays inside the narrowed seaward structural bay');
const doorPoint=(u,v)=>oldCabin.cabinWorld(greenDoor.x+Math.cos(greenDoor.angle)*u-Math.sin(greenDoor.angle)*v,
  greenDoor.z+Math.sin(greenDoor.angle)*u+Math.cos(greenDoor.angle)*v);
for(const u of [-.3,0,.3]) {
  const start=doorPoint(u,1.1), end=doorPoint(u,-.1);
  ray.set(new THREE.Vector3(start.x,7.25,start.z),
    new THREE.Vector3(end.x-start.x,0,end.z-start.z).normalize());ray.far=1.2;
  const hits=ray.intersectObjects(meshes);
  assert.ok(hits.length && hits[0].distance>1.0 && hits[0].distance<1.12,
    'relocated storage facade visible from apron at '+u+': '+hits.map(h=>h.distance.toFixed(3)).join(','));
  for(let v=.3;v<=1;v+=.15) {
    const w=doorPoint(u,v), ll=fromWorld(w.x,w.z);
    assert.ok(triangle(ll.lat,ll.lon)<greenDoor.floor-.14,'terrain below storage apron underside');
    ray.set(new THREE.Vector3(w.x,greenDoor.floor+.03,w.z),down);ray.far=.06;
    assert.ok(ray.intersectObjects(meshes).some(h=>Math.abs(h.point.y-greenDoor.floor)<.00001),
      'solid apron supports the corrected entrance');
  }
}
const rejected=oldCabin.cabinWorld(-2.9,5.42);
ray.set(new THREE.Vector3(rejected.x,7.25,rejected.z),new THREE.Vector3(1,0,0));ray.far=.08;
assert.equal(ray.intersectObjects(meshes).length,0,'old uphill door removed');
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
const stairEast=JSON.parse(fs.readFileSync('authoring/cabin/stair-east-layout.json'));
const stumpCentre=oldCabin.cabinWorld(stairEast.stump.centre[0],stairEast.stump.centre[2]);
ray.set(new THREE.Vector3(stumpCentre.x,14,stumpCentre.z),down);ray.far=1.3;
assert.ok(ray.intersectObjects(meshes).some(h=>h.point.y>12.8 && h.point.y<13.4),'broad low stump relocated beside stair base');
for(let k=0;k<spec.steps;k++) {
  const along=(k+.5)*spec.going_m, x=fx+Math.sin(bearing)*along, z=fz-Math.cos(bearing)*along;
  const y=spec.bottom.ground_m+k*spec.rise_m, ll=fromWorld(x,z);
  ray.set(new THREE.Vector3(x,y+.03,z),down);ray.far=.06;
  assert.ok(ray.intersectObjects(meshes).length,'owner tread present in GLB');
  assert.ok(triangle(ll.lat,ll.lon)<y,'terrain below owner tread');
  for(const offset of [-.45,0,.45]) {
    const px=x+Math.cos(bearing)*offset,pz=z+Math.sin(bearing)*offset;
    ray.set(new THREE.Vector3(px,y+.03,pz),down);ray.far=.06;
    assert.ok(ray.intersectObjects(meshes).some(h=>Math.abs(h.point.y-y)<.00001),'weathering preserves full tread plane');
    ray.set(new THREE.Vector3(px,y+.025,pz),new THREE.Vector3(0,1,0));ray.far=1.65;
    assert.equal(ray.intersectObjects(meshes).length,0,'new wall, stump, planting and left rail clear stair corridor');
  }
}
// Walk the complete new path at both sides of a 0.70 m corridor. Check a real
// surface below and clear space above it, independently of the clearance helper.
const layout=JSON.parse(exported.userData.walkthrough);
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
const sections=layout.centerline;
assert.ok(sections?.length>2,'owner-corrected continuous route is exported');
assert.deepEqual(layout.routeCorrection.excludedDirectionIntervalSeconds,[22,25]);
const exportedNames=JSON.parse(exported.userData.sourceObjects);
assert.ok(!exportedNames.some(n=>n.startsWith('Video - widened turn')||n==='Video - head junction'),
  'rejected dogleg stays out of the web asset');
let lastAngle=null;
for(let i=0;i<sections.length-1;i++) {
  const a=sections[i],b=sections[i+1],dx=b.x-a.x,dz=b.z-a.z;
  assert.ok(dx>0,'route always progresses westward when descending');
  const angle=Math.atan2(dz,dx);
  assert.ok(Math.abs(angle)<40*Math.PI/180,'gentle variation, no northbound right-angle leg');
  if(lastAngle!==null)assert.ok(Math.abs(angle-lastAngle)<8*Math.PI/180,'no abrupt corner between route segments');
  lastAngle=angle;
  for(let k=0;k<3;k++) {
    const t=(k+.5)/3,y=a.y+(b.y-a.y)*t;
    const left=a.left.map((v,j)=>v+(b.left[j]-v)*t),right=a.right.map((v,j)=>v+(b.right[j]-v)*t);
    for(const u of [.18,.5,.82])walk(left[0]+(right[0]-left[0])*u,left[1]+(right[1]-left[1])*u,y);
  }
}
for(const [i,side] of [[0,'left'],[1,'right']])
  assert.ok(Math.hypot(...sections[0][side].map((v,j)=>v-layout.headEdge[i][j]))<1e-6,'route meets retained stair-head edge');
for(let z=4.65;z<8.4;z+=.08)walk(20.95,z,layout.shedBase);
for(let k=0;k<7;k++)walk(20.95,4.6-(k+.5)*2.2/7,layout.shedBase+(k+1)*(layout.branchTop-layout.shedBase)/7);
// Preserve measured trunks: none may intersect the newly laid walking corridor.
const treeData=JSON.parse(fs.readFileSync('assets/site/389-trees.json'));
for(const tree of treeData.trees) {
  const wx=(tree.lon+123.085318)*111320*Math.cos(48.989009*Math.PI/180), wz=-(tree.lat-48.989009)*111320;
  const t=oldCabin.cabinLocal(wx,wz), radius=tree.height_m*.02;
  for(let i=0;i<sections.length-1;i++) {
    const a=sections[i],b=sections[i+1],dx=b.x-a.x,dz=b.z-a.z;
    const u=Math.max(0,Math.min(1,((t.x-a.x)*dx+(t.z-a.z)*dz)/(dx*dx+dz*dz)));
    const distance=Math.hypot(t.x-a.x-u*dx,t.z-a.z-u*dz);
    assert.ok(distance>radius+Math.max(a.width,b.width)/2,'curved route avoids measured trunk at '+[t.x,t.z]);
  }
  if(t.z>2.4&&t.z<7.85)assert.ok(Math.abs(t.x-20.925)>radius+.525,'branch avoids measured tree');
}
// Walk complete junctions, including the road-stair foot, doorway recess,
// upper deck, beach-side upper flight head and east passage. Board-joint gaps
// are only 4mm; try an adjacent point before declaring the walking surface absent.
let entranceSamples=0;
for(const path of entranceLayout.routes)for(let i=1;i<path.length;i++) {
 const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
 for(let d=0;d<len;d+=.08)for(const side of [-.25,0,.25]) {
  const x=a[0]+dx*d/len-dz/len*side,z=a[1]+dz*d/len+dx/len*side,w=oldCabin.cabinWorld(x,z),ll=fromWorld(w.x,w.z);
  let supported=false;
  for(const shift of [0,-.006,.006]) {
   const q=oldCabin.cabinWorld(x,z+shift);ray.set(new THREE.Vector3(q.x,10.485,q.z),down);ray.far=.07;
   supported ||= ray.intersectObjects(meshes).some(h=>Math.abs(h.point.y-10.45)<.008);
  }
  assert.ok(supported,'continuous entrance floor at '+[x,z]);
  ray.set(new THREE.Vector3(w.x,10.475,w.z),new THREE.Vector3(0,1,0));ray.far=1.65;
  assert.equal(ray.intersectObjects(meshes).length,0,'connected entrance headroom at '+[x,z]);
  assert.ok(triangle(ll.lat,ll.lon)<10.36,'terrain below the whole entrance connection');
  entranceSamples++;
 }
}
console.log('PASS connected entrance:',entranceSamples,'floor/headroom/terrain samples');
fs.writeFileSync('data/cabin-blender/current-terrain.json',JSON.stringify({assetSha256:report.sha256,grid:g,heights:Array.from(terrain.heights)}));
console.log(`PASS: Three r${THREE.REVISION}, ${report.triangles} triangles, ${meshes.length} batches; source hash, frame texture decoding, ${samples} terrain checks, ${routeSamples} full-route walking/headroom samples, measured tree clearance, north connection and all 19 approach treads.`);
