import * as THREE from "three";
import { AreaDetail } from "../area-detail.js";
import { toWorld } from "../geo.js";
import { areaView, disposeArea } from "./area-view.js";
import { buildMarinaBase } from "./marina-base.js";

export function buildMarinaArea(scene, sample) {
  // Includes the full dock plan, fixed pier, shelter and flagpole, with margin.
  const nw=toWorld(48.97750,-123.06485,-10), se=toWorld(48.97665,-123.06310,30);
  const bounds=new THREE.Box3(new THREE.Vector3(nw.x,nw.y,nw.z),new THREE.Vector3(se.x,se.y,se.z));
  const evaluate=areaView(bounds);
  const area=new AreaDetail({
    base:buildMarinaBase(scene,sample),
    load:async attempt => {
      const module = await import(`./marina.js${attempt ? `?retry=${attempt}` : ""}`);
      // Build detached so a failure or stale request cannot leave half a model.
      const container=new THREE.Group(); container.name="marina-detail";
      try {
        const detail=module.buildMarina(container,sample);
        container.visible=false; scene.add(container);
        return { group:container, update:detail.update, dispose:()=>disposeArea(container) };
      } catch (error) { disposeArea(container); throw error; }
    },
    onError:error => console.warn("Marina detail could not load; keeping the base model and retrying.",error),
  });
  let due=0, view={enter:false,retain:false};
  return {
    update(level,camera,height,now) {
      if (now>=due) { due=now+.25; view=evaluate(camera,height); }
      area.update(view,level,now);
    },
    dispose:()=>area.dispose(),
  };
}
