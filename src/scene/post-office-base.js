import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { box,tint,gableRoof } from "./parts.js";
import { fromWorld } from "../geo.js";
import { disposeArea } from "./area-view.js";
import { POST_OFFICE as P,postOfficeFrame as F,postOfficePoint,postOfficeWallRing,postOfficeAerial,postOfficeWings } from "./post-office-plan.js";
export const CREAM=0xe3d2a2,TRIM=0x4b3a2c,TILE=0x7a4b3c,GLASS=0x2c3338;
export function postOfficeTransform(g){g.rotateY(F.angle);g.translate(F.origin.x,0,F.origin.z);return g}
export function postOfficeBox(x0,x1,z0,z1,y,h,color){return postOfficeTransform(box(x1-x0,z1-z0,h,(x0+x1)/2,y,(z0+z1)/2,color))}
export function postOfficeMerge(parts,group,name){const g=mergeGeometries(parts,false);for(const p of parts)p.dispose();const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide}));m.name=name;group.add(m);return m}
export function postOfficeHeight(sample,x,z){const p=postOfficePoint(x,z),ll=fromWorld(p.x,p.z);return sample(ll.lat,ll.lon)}
// A hipped roof: two slopes to a ridge along X and a hip off each end, all at
// one pitch. Both photographs show the ends sloping rather than gabled, and a
// gable end where a hip stands is the first thing wrong from the road.
export function hipRoof(halfW,halfD,wallTop,rise,eave,color){
  const D=halfD+eave,W=halfW+eave,slope=rise/halfD,ridgeY=wallTop+rise,eaveY=ridgeY-slope*D,run=Math.max(W-D,0),pos=[];
  const tri=(a,b,c)=>pos.push(...a,...b,...c);
  const A=[-run,ridgeY,0],B=[run,ridgeY,0],c1=[-W,eaveY,-D],c2=[W,eaveY,-D],c3=[W,eaveY,D],c4=[-W,eaveY,D];
  tri(A,B,c2);tri(A,c2,c1);tri(B,A,c4);tri(B,c4,c3);tri(A,c1,c4);tri(B,c3,c2);
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(pos),3));g.computeVertexNormals();return tint(g,color);
}
function prism(ring,bottom,height,color){const shape=new THREE.Shape(ring.map(p=>new THREE.Vector2(p.x,-p.z))),g=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,bottom,0);return postOfficeTransform(tint(g,color))}
export function drape(pixels,sample,color,offset,local=false){
  const ring=local?pixels.map(([x,z])=>({x,z})):pixels.map(p=>postOfficeAerial(...p)),flat=ring.map(p=>new THREE.Vector2(p.x,p.z)),pos=[];
  function tri(a,b,c){const dist=(p,q)=>Math.hypot(p.x-q.x,p.z-q.z),mid=(p,q)=>({x:(p.x+q.x)/2,z:(p.z+q.z)/2});if(Math.max(dist(a,b),dist(b,c),dist(c,a))>3){const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);tri(a,ab,ca);tri(ab,b,bc);tri(ca,bc,c);tri(ab,bc,ca);return}for(const p of [a,b,c])pos.push(p.x,postOfficeHeight(sample,p.x,p.z)+offset,p.z)}
  for(const f of THREE.ShapeUtils.triangulateShape(flat,[]))tri(...f.map(i=>ring[i]));
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return postOfficeTransform(tint(g,color));
}
export function buildPostOfficeBase(scene,sample){
  const group=new THREE.Group();group.name="post-office-base";
  // The floor is set at the door under the porch, and the walls run down to
  // whatever the terrain does behind.
  const ground=postOfficeWallRing.map(p=>postOfficeHeight(sample,p.x,p.z)),
    floor=postOfficeHeight(sample,(F.bayWest+F.east)/2,F.baySouth)+.09,bottom=Math.min(...ground)-.10,
    wings=postOfficeWings();
  const building=postOfficeMerge([
    prism(wings.main,bottom,floor+P.wallHeight-bottom,CREAM),
    prism(wings.west,bottom,floor+P.westHeight-bottom,CREAM),
  ],group,"post-office-walls");
  building.userData.landmark={name:"Point Roberts Post Office",kind:"building"};
  const roofs=[];
  function place(g,x0,x1,z0,z1){g.translate((x0+x1)/2,0,(z0+z1)/2);roofs.push(postOfficeTransform(g))}
  place(hipRoof((F.east-F.mainWest)/2,(F.mainSouth-F.north)/2,floor+P.wallHeight,P.mainRise,P.eave,TILE),F.mainWest,F.east,F.north,F.mainSouth);
  place(hipRoof((F.mainWest-F.westX)/2,(F.westSouth-F.westNorth)/2,floor+P.westHeight,P.westRise,.45,TILE),F.westX,F.mainWest,F.westNorth,F.westSouth);
  // The porch: a gable facing the parking lot. The helper lays its ridge along Z,
  // which here is north to south, out from the main roof toward the road, and
  // that puts the triangle at the south end where the sign goes. No turn.
  {
    const z0=F.mainSouth-2.6,z1=F.baySouth,
      g=gableRoof((F.east-F.bayWest)/2,(z1-z0)/2,floor+P.wallHeight,P.entryRise,P.eave,TILE),
      c=new THREE.Color(CREAM),a=g.attributes.color;
    // The helper closes both ends with its last two triangles: the south one is
    // the gable face the sign hangs on and the north one dies into the main
    // roof. Both are siding, not tile.
    for(let i=a.count-6;i<a.count;i++)a.setXYZ(i,c.r,c.g,c.b);
    place(g,F.bayWest,F.east,z0,z1);
  }
  postOfficeMerge(roofs,group,"post-office-roofs");
  postOfficeMerge([drape(P.lot,sample,0x5f6360,.05),drape(P.walk,sample,0xb0ada0,.075)],group,"post-office-lot");
  scene.add(group);return{group,building,floor,bottom,update(){},dispose:()=>disposeArea(group)};
}
