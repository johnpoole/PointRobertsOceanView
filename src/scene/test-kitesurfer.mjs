// Run from the repository root with the app's pinned Three r186 files cached
// in data/cabin-blender/three (same dependency cache as authoring/cabin/verify.mjs).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
globalThis.location = { protocol: 'http:', host: 'localhost' };
const cache = new Map(), vendor = path.resolve('data/cabin-blender/three');
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  let source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  source = source.replace(/((?:^|\n)\s*(?:import|export)\s+(?:\*|\{)[\s\S]*?\sfrom\s+)["']([^"']+)["']/g,
    (_, prefix, ref) => `${prefix}"${load(ref === 'three' ? path.join(vendor, 'three.module.js')
      : ref.startsWith('three/addons/') ? path.join(vendor, ref.slice(13))
      : path.resolve(path.dirname(file), ref))}"`);
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  cache.set(file, url); return url;
}
const { KITE_SURFER: spec, kiteSurferState: state } = await import(load('src/scene/kitesurfer-plan.js'));
const { kiteWind } = await import(load('src/scene/kitesurfer-weather.js'));
const conditions = { sunrise: new Date('2026-06-09T12:00:00Z'), sunset: new Date('2026-06-10T04:00:00Z'),
  windSpeedMps: 8, windDirectionDegrees: 270, waterLevel: 0 };
let active, count = 0, total = 0;
for (let t = +conditions.sunrise; t < +conditions.sunset; t += 1000) {
  const pose = state(new Date(t), conditions); total++;
  if (pose) { active ??= new Date(t + 1000); count++;
    assert.ok(Math.abs(pose.east) <= spec.offshoreRadiusM && Math.abs(pose.south) <= spec.northSouthRadiusM);
  }
}
assert.ok(active && count / total > .04 && count / total < .3, 'occasional sessions');
assert.deepEqual(state(active, conditions), state(new Date(+active), conditions), 'repeatable clock');
for (const overrides of [{windSpeedMps:7.69},{windSpeedMps:null},{windSpeedMps:NaN},
  {sunrise:null},{sunset:null},{waterLevel:NaN},{sunrise:new Date(+active+1)},{sunset:active}])
  assert.equal(state(active, {...conditions,...overrides}), null);
assert.ok(state(active, {...conditions,windSpeedMps:7.7,sunrise:active}), 'inclusive sunrise and threshold');
assert.equal(state(new Date(NaN), conditions), null);
const feed = { connected:true, providerHealth:{weather:'live'}, weather:{data:{wind_speed_mps:9,
  series:{start:'2026-06-09 12:00Z',step_s:3600,wind_speed_mps:[8,10],wind_direction_degrees:[350,10]}}}};
assert.equal(kiteWind(feed,active,false).windSpeedMps,9);
assert.deepEqual(kiteWind(feed,new Date('2026-06-09T12:30Z'),true),{windSpeedMps:9,windDirectionDegrees:0});
assert.equal(kiteWind(feed,new Date('2026-06-11T12:30Z'),true).windSpeedMps,null,'no live fallback');
assert.equal(kiteWind({...feed,connected:false},active,false).windSpeedMps,undefined);
assert.equal(kiteWind({...feed,weather:{...feed.weather,quality:{stale:true}}},active,false).windSpeedMps,undefined);

const THREE = await import(load(path.join(vendor,'three.module.js')));
const { buildKiteSurfer } = await import(load('src/scene/kitesurfer.js'));
const { toWorld, fromWorld } = await import(load('src/geo.js'));
// Check the full ellipse against the actual seabed, including low tide.
const meta = JSON.parse(fs.readFileSync('assets/terrain/meta.json')), grid = meta.grid;
const raw = fs.readFileSync('assets/terrain/heightmap.bin');
function bed(lat,lon) {
  const r=(grid.north_lat-lat)/grid.cellsize_deg,c=(lon-grid.west_lon)/grid.cellsize_deg;
  const i=Math.floor(r),j=Math.floor(c),u=c-j,v=r-i;
  assert.ok(i>=0&&j>=0&&i+1<grid.nrows&&j+1<grid.ncols,'route within terrain');
  const at=(r,c)=>raw.readInt16LE((r*grid.ncols+c)*2)*grid.scale_m;
  return (at(i,j)*(1-u)+at(i,j+1)*u)*(1-v)+(at(i+1,j)*(1-u)+at(i+1,j+1)*u)*v;
}
const origin=toWorld(spec.lat,spec.lon); let highest=-Infinity;
for(let i=0;i<360;i++) {
  const p=fromWorld(origin.x+spec.offshoreRadiusM*Math.cos(i*Math.PI/180),origin.z+spec.northSouthRadiusM*Math.sin(i*Math.PI/180));
  highest=Math.max(highest,bed(p.lat,p.lon));
}
assert.ok(highest < -1.45,`route wet at -1m MLLW: highest bed ${highest}`);
const parent=new THREE.Group(), model=buildKiteSurfer(parent,bed);
assert.equal(model.group.visible,false);
model.update(active,null,conditions);assert.equal(model.group.visible,true);
model.update(active,null,{...conditions,waterLevel:2,surfaceAt:()=>2.4});
assert.ok(Math.abs(model.group.position.y-2.5)<1e-6,'wave surface follows tide');
model.update(active,null,{...conditions,windSpeedMps:0});assert.equal(model.group.visible,false);
model.update(conditions.sunset,null,conditions);assert.equal(model.group.visible,false);
const dry=buildKiteSurfer(new THREE.Group(),()=>4);dry.update(active,null,conditions);assert.equal(dry.group.visible,false);
model.update(active,null,conditions);
const camera=new THREE.PerspectiveCamera(45,1,.1,5000);
camera.position.copy(model.group.position).add(new THREE.Vector3(60,25,60));camera.lookAt(model.group.position.clone().add(new THREE.Vector3(0,10,0)));
model.update(active,camera,conditions);assert.equal(model.group.visible,true);
camera.position.y+=3000;model.update(active,camera,conditions);assert.equal(model.group.visible,false);
model.update(active,null,conditions);parent.updateMatrixWorld(true);
let triangles=0,draws=0;
const meshes=[];
model.group.traverse(o=>{
  if(!o.geometry)return; draws++;
  for(const a of Object.values(o.geometry.attributes))for(const n of a.array)assert.ok(Number.isFinite(n));
  if(o.isMesh) triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
  const positions=Array.from(o.geometry.attributes.position.array);
  for(let i=0;i<positions.length;i+=3){const v=new THREE.Vector3(...positions.slice(i,i+3)).applyMatrix4(o.matrixWorld).sub(model.group.position);v.toArray(positions,i);}
  meshes.push({positions,indices:o.geometry.index?Array.from(o.geometry.index.array):null,
    colors:o.geometry.attributes.color?Array.from(o.geometry.attributes.color.array):null,lines:!!o.isLineSegments});
});
assert.ok(triangles<2000 && draws<=5,`${triangles} triangles, ${draws} draws`);
if(process.argv.includes('--export'))fs.writeFileSync('data/kitesurf/model.json',JSON.stringify(meshes));
console.log(`Kite surfer PASS: ${triangles} triangles, ${draws} draws; route bed <= ${highest.toFixed(2)}m MLLW; ${Math.round(100*count/total)}% of suitable daylight; preview ${active.toISOString()}`);
