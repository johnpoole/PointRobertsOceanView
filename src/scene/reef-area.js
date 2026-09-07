import * as THREE from "three";
import { AreaDetail } from "../area-detail.js";
import { areaView, disposeArea } from "./area-view.js";
import { reefPoint } from "./reef-plan.js";
import { buildReefBase } from "./reef-base.js";

export function buildReefArea(scene,sample) {
  const nw=reefPoint(345,190,-2),se=reefPoint(910,600,18);
  const evaluate=areaView(new THREE.Box3(new THREE.Vector3(nw.x,nw.y,nw.z),new THREE.Vector3(se.x,se.y,se.z)),{near:220,far:350});
  const base=buildReefBase(scene,sample);
  const area=new AreaDetail({base,load:async attempt=>{
    const module=await import(`./reef.js${attempt?`?retry=${attempt}`:""}`);
    const container=new THREE.Group();container.name="reef-detail";
    try {
      const detail=module.buildReef(container,sample);container.visible=false;scene.add(container);
      return {group:container,update:detail.update,dispose:()=>disposeArea(container)};
    } catch(error) {disposeArea(container);throw error}
  },onError:error=>console.warn("Reef detail could not load; keeping the base model and retrying.",error)});
  let due=0,view={enter:false,retain:false};
  return {landmarks:[base.building],update(level,camera,height,now){
    if(now>=due){due=now+.25;view=evaluate(camera,height)}
    area.update(view,level,now);
  },dispose:()=>area.dispose()};
}
