import * as THREE from "three";
import { AreaDetail } from "../area-detail.js";
import { areaView, disposeArea } from "./area-view.js";
import { communityPoint } from "./community-plan.js";
import { buildCommunityBase } from "./community-base.js";
export function buildCommunityArea(scene,sample){
  const base=buildCommunityBase(scene,sample),nw=communityPoint(325,370),se=communityPoint(915,650);
  const evaluate=areaView(new THREE.Box3(new THREE.Vector3(nw.x,Math.min(...Object.values(base.bottoms))-2,nw.z),new THREE.Vector3(se.x,Math.max(...Object.values(base.floors))+10,se.z)),{near:220,far:350});
  const area=new AreaDetail({base,load:async attempt=>{
    const module=await import(`./community.js${attempt?`?retry=${attempt}`:""}`),container=new THREE.Group();container.name="community-detail";
    try{const detail=module.buildCommunity(container,sample);container.visible=false;scene.add(container);return{group:container,update:detail.update,dispose:()=>disposeArea(container)}}catch(error){disposeArea(container);throw error}
  },onError:error=>console.warn("Community Center detail could not load; keeping the base and retrying.",error)});
  let due=0,view={enter:false,retain:false};return{landmarks:base.buildings,update(level,camera,height,now){if(now>=due){due=now+.25;view=evaluate(camera,height)}area.update(view,level,now)},dispose:()=>area.dispose()};
}
