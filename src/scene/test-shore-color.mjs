// Regression: chart datum must not draw a material boundary on exposed beach.
// Run: node src/scene/test-shore-color.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Only the actual material-color portion of terrain.js is evaluated. The rest
// needs WebGL; this color stub implements its used operations in linear RGB.
class Color {
  constructor(hex=0xffffff){this.setHex(hex)}
  setHex(hex){
    const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
    [this.r,this.g,this.b]=[16,8,0].map(s=>linear(((hex>>s)&255)/255));return this;
  }
  copy(c){this.r=c.r;this.g=c.g;this.b=c.b;return this}
  lerp(c,t){for(const k of ['r','g','b'])this[k]+=(c[k]-this[k])*t;return this}
}
const source=readFileSync(new URL('./terrain.js',import.meta.url),'utf8');
const end=source.indexOf('// Lays gravel');
assert(end>0,'terrain color section must be present');
const color=vm.runInNewContext(source.slice(0,end)
  .replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'')+'\ncolorForGround;',
  {THREE:{Color}});
const at=(height,slope)=>color(height,new Color(),73,51,slope,31);
const rgb=c=>[c.r,c.g,c.b];
for(const slope of [0,.1,.22,.4]){
  const above=rgb(at(.001,slope));
  for(const height of [-1,-.36,-.001,0,1]){
    const result=rgb(at(height,slope));
    assert(result.every(Number.isFinite));
    assert.deepEqual(result,above,`continuous foreshore at ${height} m, slope ${slope}`);
  }
}
assert.notDeepEqual(rgb(at(-.36,0)),rgb(at(-.36,.4)),'exposed sand and shingle remain distinct');
assert.deepEqual(rgb(at(-.36,0)),rgb(new Color(0x9c8f6f)),'low-tide sand retains its beach material');
assert.notDeepEqual(rgb(at(10,0)),rgb(at(0,0)),'upland ground remains separate');
console.log('PASS: continuous sand/shingle across chart datum, finite low-tide colors and distinct upland material');
