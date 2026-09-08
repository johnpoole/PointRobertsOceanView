import * as THREE from "three";
import { AreaDetail } from "../area-detail.js";
import { areaView, disposeArea } from "./area-view.js";
import { buildSaltwaterBase } from "./saltwater-base.js";
export function buildSaltwaterArea(scene,sample){
  const base=buildSaltwaterBase(scene,sample),bounds=new THREE.Box3().setFromObject(base.group).expandByScalar(3);
  const evaluate=areaView(bounds,{near:200,far:320});
  const area=new AreaDetail({base,load:async attempt=>{
    const module=await import(`./saltwater.js${attempt?`?retry=${attempt}`:""}`),container=new THREE.Group();container.name="saltwater-detail";
    try{const detail=module.buildSaltwater(container,sample);container.visible=false;scene.add(container);return{group:container,update:detail.update,dispose:()=>disposeArea(container)}}
    catch(error){disposeArea(container);throw error}
  },onError:error=>console.warn("Saltwater Cafe detail could not load; keeping the base model and retrying.",error)});
  let due=0,view={enter:false,retain:false};
  return{landmarks:[base.building],update(level,camera,height,now){if(now>=due){due=now+.25;view=evaluate(camera,height)}area.update(view,level,now)},dispose:()=>area.dispose()};
}
