import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { box,tint,gableRoof } from "./parts.js";
import { fromWorld } from "../geo.js";
import { disposeArea } from "./area-view.js";
import { CLUBHOUSE as P,clubhouseFrame as F,clubhousePoint,clubhouseRing } from "./clubhouse-plan.js";
export const LOG=0x6b3a26,SHINGLE=0x6a675e,TIMBER=0x4a3527,GLASS=0x2e3a3e,
  DECK=0x7a6a55,STONE=0xa9a69c,CHIMNEY=0x4b4239;
export function clubhouseTransform(g){g.rotateY(F.angle);g.translate(F.origin.x,0,F.origin.z);return g}
export function clubhouseBox(x0,x1,z0,z1,y,h,color){return clubhouseTransform(box(x1-x0,z1-z0,h,(x0+x1)/2,y,(z0+z1)/2,color))}
export function clubhouseMerge(parts,group,name){const g=mergeGeometries(parts,false);for(const p of parts)p.dispose();const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide}));m.name=name;group.add(m);return m}
export function clubhouseHeight(sample,x,z){const p=clubhousePoint(x,z),ll=fromWorld(p.x,p.z);return sample(ll.lat,ll.lon)}
export function buildClubhouseBase(scene,sample){
  const group=new THREE.Group();group.name="clubhouse-base";
  const ground=clubhouseRing.map(p=>clubhouseHeight(sample,p.x,p.z)),
    floor=Math.max(...ground)+.12,bottom=Math.min(...ground)-.35;
  const walls=[
    // The core, on its stone foot.
    clubhouseBox(0,F.width,0,F.depth,floor,P.wallHeight,LOG),
    clubhouseBox(-.1,F.width+.1,-.1,F.depth+.1,bottom,floor-bottom+.45,STONE),
    // The lower wing, and the glazed room at the end of it.
    clubhouseBox(P.wing.x0,P.wing.x1,P.wing.z0,P.wing.z1,floor,P.wing.height,LOG),
    clubhouseBox(P.sunroom.x0,P.sunroom.x1,P.sunroom.z0,P.sunroom.z1,floor,P.sunroom.height,GLASS),
  ];
  const building=clubhouseMerge(walls,group,"clubhouse-walls");
  building.userData.landmark={name:"Point Roberts Golf & Country Club",kind:"building"};
  const roofs=[];
  // The core's roof: steep, ridge running north-east down the length of it, so
  // the gable end faces the course. That is the face in the club's photograph.
  {
    const g=gableRoof(F.depth/2,F.width/2,floor+P.wallHeight,P.ridgeRise,P.eave,SHINGLE),
      c=new THREE.Color(LOG),a=g.attributes.color;
    // The helper closes both ends; those two triangles are log wall, not roof.
    for(let i=a.count-6;i<a.count;i++)a.setXYZ(i,c.r,c.g,c.b);
    g.rotateY(Math.PI/2);g.translate(F.width/2,0,F.depth/2);roofs.push(clubhouseTransform(g));
  }
  // The wing's shallower roof, and the porch's own gable on the north-east end.
  {
    const w=P.wing,g=gableRoof((w.x1-w.x0)/2,(w.z1-w.z0)/2,floor+w.height,w.rise,.55,SHINGLE);
    g.translate((w.x0+w.x1)/2,0,(w.z0+w.z1)/2);roofs.push(clubhouseTransform(g));
  }
  {
    const p=P.porch,g=gableRoof((p.z1-p.z0)/2+.4,p.out/2+.5,floor+p.height,p.rise,.6,SHINGLE);
    g.rotateY(Math.PI/2);g.translate(p.x+p.out/2,0,(p.z0+p.z1)/2);roofs.push(clubhouseTransform(g));
  }
  roofs.push(clubhouseBox(P.chimney.x-P.chimney.side/2,P.chimney.x+P.chimney.side/2,
    P.chimney.z-P.chimney.side/2,P.chimney.z+P.chimney.side/2,floor,P.chimney.height,CHIMNEY));
  clubhouseMerge(roofs,group,"clubhouse-roofs");
  // The deck in front of the wing, on its posts, with the ground falling away.
  {
    const d=P.deck,parts=[clubhouseBox(d.x0,d.x1,d.z0,d.z1,floor+d.height-.12,.12,DECK)];
    for(let x=d.x0+.5;x<d.x1;x+=2.2) for(const z of [d.z0+.6,d.z1-.4]){
      const g=clubhouseHeight(sample,x,z);
      parts.push(clubhouseBox(x-.09,x+.09,z-.09,z+.09,g,floor+d.height-g-.12,TIMBER));
    }
    clubhouseMerge(parts,group,"clubhouse-deck");
  }
  scene.add(group);return{group,building,floor,bottom,update(){},dispose:()=>disposeArea(group)};
}
