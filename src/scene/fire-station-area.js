import * as THREE from "three";
import { AreaDetail } from "../area-detail.js";
import { areaView, disposeArea } from "./area-view.js";
import { buildFireStationBase } from "./fire-station-base.js";
export function buildFireStationArea(scene,sample){
  const base=buildFireStationBase(scene,sample),bounds=new THREE.Box3().setFromObject(base.group).expandByScalar(3);
  const evaluate=areaView(bounds,{near:200,far:320});
  const area=new AreaDetail({base,load:async attempt=>{
    const module=await import(`./fire-station.js${attempt?`?retry=${attempt}`:""}`),container=new THREE.Group();container.name="fire-station-detail";
    try{const detail=module.buildFireStation(container,sample);container.visible=false;scene.add(container);return{group:container,update:detail.update,dispose:()=>disposeArea(container)}}
    catch(error){disposeArea(container);throw error}
  },onError:error=>console.warn("Fire station detail could not load; keeping the base model and retrying.",error)});
  let due=0,view={enter:false,retain:false};
  return{landmarks:[base.building],update(level,camera,height,now){if(now>=due){due=now+.25;view=evaluate(camera,height)}area.update(view,level,now)},dispose:()=>area.dispose()};
}
