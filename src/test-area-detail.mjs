import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync(new URL("./area-detail.js",import.meta.url),"utf8");
const { AreaDetail }=await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const outside={enter:false,retain:false}, inside={enter:true,retain:true}, edge={enter:false,retain:true};
function model() {
  return {group:{visible:true},levels:[],disposals:0,
    update(level){this.levels.push(level)},dispose(){this.disposals++}};
}
let resolve, loads=0;
const base=model(), detail=model();
const area=new AreaDetail({base,load:()=>{loads++;return new Promise(r=>{resolve=r})}});
area.update(outside,1,0); assert.equal(loads,0); assert.equal(base.group.visible,true);
area.update(edge,1,1); assert.equal(area.pending,null,"retention alone must not start loading");
area.update(inside,2,2); await Promise.resolve();
const pending=area.pending;
for(let i=0;i<10;i++)area.update(inside,2,3);
assert.equal(loads,1,"one pending load per area");
area.update(outside,3,4);resolve(detail);await pending;
assert.equal(detail.group.visible,false,"a late result must not appear after jumping away");
assert.equal(base.group.visible,true);
area.update(inside,4,5);
assert.equal(detail.levels.at(-1),4,"cached detail receives current tide before activation");
assert.equal(detail.group.visible,true);assert.equal(base.group.visible,false);
area.update(edge,5,6);assert.equal(detail.group.visible,true,"hysteresis retains active detail");
area.update(outside,6,7);assert.equal(base.levels.at(-1),6);assert.equal(base.group.visible,true);
area.update(outside,6,35);assert.equal(detail.disposals,0);
area.update(outside,6,36);assert.equal(detail.disposals,1);assert.equal(area.detail,null);
area.update(inside,7,37);await Promise.resolve();assert.equal(loads,2);
const replacement=model();resolve(replacement);await area.pending;
assert.equal(replacement.levels.at(-1),7);
area.dispose();area.dispose();assert.equal(replacement.disposals,1);assert.equal(base.disposals,1);
area.update(inside,8,40);assert.equal(loads,2,"disposed areas never reload");

const slowBase=model(),slowDetail=model();
const slow=new AreaDetail({base:slowBase,load:()=>new Promise(r=>{resolve=r})});
slow.update(inside,1,0);await Promise.resolve();const slowPending=slow.pending;
slow.update(outside,2,60);resolve(slowDetail);await slowPending;
assert.equal(slowDetail.disposals,1,"expired in-flight result is disposed");assert.equal(slow.detail,null);
slow.update(inside,2,61);await Promise.resolve();const disposedPending=slow.pending;
slow.dispose();const afterDispose=model();resolve(afterDispose);await disposedPending;
assert.equal(afterDispose.disposals,1,"in-flight result after shutdown is disposed");

let attempts=[],errors=0;
const recovered=model(),retryBase=model();
const retry=new AreaDetail({base:retryBase,load:async attempt=>{
  attempts.push(attempt);if(attempt===0)throw Error("offline");return recovered;
},onError:()=>errors++});
retry.update(inside,1,0);await retry.pending;
assert.equal(errors,1);assert.equal(retryBase.group.visible,true);
retry.update(inside,2,9);assert.equal(retry.pending,null,"backoff prevents request storms");
retry.update(outside,2,15);assert.equal(retry.pending,null,"no retry when not needed");
retry.update(inside,3,16);await retry.pending;
assert.deepEqual(attempts,[0,1]);assert.equal(recovered.levels.at(-1),3);assert.equal(recovered.group.visible,true);
console.log("PASS: lazy start, hysteresis, single load, stale results, current tide, cache eviction/rebuild, disposal and retry.");
