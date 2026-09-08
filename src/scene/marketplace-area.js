import * as THREE from "three";
import { AreaDetail } from "../area-detail.js";
import { areaView, disposeArea } from "./area-view.js";
import { marketPoint } from "./marketplace-plan.js";
import { buildMarketplaceBase } from "./marketplace-base.js";
export function buildMarketplaceArea(scene,sample){
  const base=buildMarketplaceBase(scene,sample),nw=marketPoint(300,180),se=marketPoint(885,600);
  const evaluate=areaView(new THREE.Box3(new THREE.Vector3(nw.x,base.bottom-2,nw.z),new THREE.Vector3(se.x,base.floor+12,se.z)),{near:220,far:350});
  const area=new AreaDetail({base,load:async attempt=>{
    const module=await import(`./marketplace.js${attempt?`?retry=${attempt}`:""}`),container=new THREE.Group();container.name="marketplace-detail";
    try{const detail=module.buildMarketplace(container,sample);container.visible=false;scene.add(container);return{group:container,update:detail.update,dispose:()=>disposeArea(container)}}
    catch(error){disposeArea(container);throw error}
  },onError:error=>console.warn("Marketplace detail could not load; keeping the base model and retrying.",error)});
  let due=0,view={enter:false,retain:false};
  return{landmarks:[base.building],update(level,camera,height,now){if(now>=due){due=now+.25;view=evaluate(camera,height)}area.update(view,level,now)},dispose:()=>area.dispose()};
}
