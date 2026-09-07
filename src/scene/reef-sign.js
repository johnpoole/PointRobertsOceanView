// Roadside sign silhouette. Photo-estimated dimensions; sources in CONTINUE-reef.md.
import * as THREE from "three";
import { box, tint } from "./parts.js";
import { REEF, reefPoint } from "./reef-plan.js";

export function reefSignParts() {
  const parts=[box(.34,.34,3.4,0,0,0,0xc9c8b9)];
  const cylinder=(radius,height,bottom,color)=>{
    const g=new THREE.CylinderGeometry(radius,radius,height,12);
    g.translate(0,bottom+height/2,0);parts.push(tint(g,color));
  };
  cylinder(.74,.65,0,0x333638);
  for(let y=.08;y<.65;y+=.13)cylinder(.80,.055,y,0x454847);
  // Local +Z faces east after the group rotation. The high end is south.
  const shape=new THREE.Shape([[-2.05,3.85],[1.85,3.85],[2.30,5.36],[-2.70,7.05]].map(p=>new THREE.Vector2(...p)));
  const cabinet=new THREE.ExtrudeGeometry(shape,{depth:.30,bevelEnabled:false});
  cabinet.translate(0,0,-.15);parts.push(tint(cabinet,0xacaca3));
  for(const side of [-1,1]) {
    // Thin red trailing edge of the tall, backward-leaning cabinet.
    const stripe=new THREE.Shape([[-2.05,3.85],[-1.90,3.85],[-2.55,7.00],[-2.70,7.05]].map(p=>new THREE.Vector2(...p)));
    const g=new THREE.ShapeGeometry(stripe);g.translate(0,0,side*.156);parts.push(tint(g,0xad3440));
  }
  parts.push(box(4.65,.40,1.05,0,2.72,0,0x585c56));
  for(const side of [-1,1]) {
    parts.push(box(4.48,.022,.89,0,2.80,side*.211,0xa23b43));
    parts.push(box(4.30,.024,.73,0,2.88,side*.226,0xd3d3bb));
    for(const y of [3.10,3.34])parts.push(box(4.30,.027,.018,0,y,side*.243,0x777d73));
  }
  return parts;
}

export function positionReefSign(group,height) {
  const p=reefPoint(...REEF.sign);
  // Avoid a second georeferencing convention for the sampled ground elevation.
  group.position.set(p.x,height,p.z);group.rotation.y=Math.PI/2;
}
