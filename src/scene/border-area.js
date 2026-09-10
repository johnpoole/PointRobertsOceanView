import * as THREE from "three";
import { AreaDetail } from "../area-detail.js";
import { areaView, disposeArea } from "./area-view.js";
import { buildBorderBase } from "./border-base.js";
export function buildBorderArea(scene,sample){
  const base=buildBorderBase(scene,sample),bounds=new THREE.Box3().setFromObject(base.group).expandByScalar(4);
  const evaluate=areaView(bounds,{near:220,far:340});
  const area=new AreaDetail({base,load:async attempt=>{
    const module=await import(`./border.js${attempt?`?retry=${attempt}`:""}`),container=new THREE.Group();container.name="border-detail";
    try{const detail=module.buildBorder(container,sample);container.visible=false;scene.add(container);return{group:container,update:detail.update,dispose:()=>disposeArea(container)}}
    catch(error){disposeArea(container);throw error}
  },onError:error=>console.warn("Border station detail could not load; keeping the base model and retrying.",error)});
  let due=0,view={enter:false,retain:false};
  return{landmarks:[base.building],update(level,camera,height,now){if(now>=due){due=now+.25;view=evaluate(camera,height)}area.update(view,level,now)},dispose:()=>area.dispose()};
}
