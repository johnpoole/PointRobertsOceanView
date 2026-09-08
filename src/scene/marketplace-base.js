import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { box, tint } from "./parts.js";
import { fromWorld } from "../geo.js";
import { MARKET, marketPoint, marketRings } from "./marketplace-plan.js";
import { disposeArea } from "./area-view.js";
export function marketMerge(parts,group,name){
  const geometry=mergeGeometries(parts,false);for(const p of parts)p.dispose();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide}));
  mesh.name=name;group.add(mesh);return mesh;
}
export function marketHeight(sample,p){const ll=fromWorld(p.x,p.z);return sample(ll.lat,ll.lon)}
export function marketPrism(ring,y,height,color){
  const shape=new THREE.Shape(ring.map(p=>new THREE.Vector2(p.x,-p.z)));
  const g=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,y,0);return tint(g,color);
}
export function marketDrape(pixels,sample,color,lift=.06,step=8){
  const ring=pixels.map(p=>marketPoint(...p)),faces=THREE.ShapeUtils.triangulateShape(ring.map(p=>new THREE.Vector2(p.x,p.z)),[]),pos=[];
  function tri(a,b,c){
    const d=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z),mid=(a,b)=>({x:(a.x+b.x)/2,z:(a.z+b.z)/2});
    if(Math.max(d(a,b),d(b,c),d(c,a))>step){const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);tri(a,ab,ca);tri(ab,b,bc);tri(ca,bc,c);tri(ab,bc,ca);return}
    for(const p of [a,b,c])pos.push(p.x,marketHeight(sample,p)+lift,p.z);
  }
  for(const f of faces)tri(...f.map(i=>ring[i]));
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();return tint(g,color);
}
// Hipped blue metal roof, aligned to the north–south frontage.
export function marketHip(x0,x1,z0,z1,y,rise,color){
  const cx=(x0+x1)/2,cz=(z0+z1)/2,inset=Math.min((x1-x0)/2,(z1-z0)/2);
  const v=[[x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1],[cx,y+rise,z0+inset],[cx,y+rise,z1-inset]];
  const f=[[0,1,4],[1,2,5],[1,5,4],[2,3,5],[3,0,4],[3,4,5]];
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(f.flatMap(t=>t.flatMap(i=>v[i])),3));g.computeVertexNormals();return tint(g,color);
}
export function buildMarketplaceBase(scene,sample){
  const group=new THREE.Group();group.name="marketplace-base";
  const rings=marketRings(),heights=rings.outline.map(p=>marketHeight(sample,p));
  const floor=Math.max(...heights)+.08,bottom=Math.min(...heights)-.08;
  const walls=[marketPrism(rings.north,bottom,floor+6.9-bottom,0xd4d2c7),marketPrism(rings.south,bottom,floor+5.5-bottom,0xcfcfc1)];
  const roofs=[marketPrism(rings.north,floor+6.9,.12,0x747c87),marketPrism(rings.south,floor+5.5,.12,0xbfc2b5)];
  const front=marketPoint(637,350).x,back=marketPoint(654,350).x;
  for(const [a,b,type] of MARKET.bays){
    const z0=marketPoint(637,a).z,z1=marketPoint(637,b).z,cz=(z0+z1)/2,w=z1-z0;
    const top=type==="sign"?8.2:type==="windows"?6.8:type==="tower"?5.8:4.1;
    if(type==="canopy"){
      // Open covered walkway: roof falls westward from the rear edge.
      const g=new THREE.BoxGeometry(back-front,.12,w),p=g.attributes.position;
      for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+1.15*(.5+p.getX(i)/(back-front)));
      g.computeVertexNormals();g.translate((front+back)/2,floor+top,cz);roofs.push(tint(g,0x487c95));
      walls.push(box(.20,w,.28,front,floor+top-.25,cz,0xe0e0d3));
    }else{
      walls.push(box(back-front,w,top-3.05,(front+back)/2,floor+3.05,cz,0xe0dfd1));
      roofs.push(box(back-front,w,.12,(front+back)/2,floor+top,cz,0xc8c9bc));
      if(type==="tower"||type==="sign"){
        const inset=type==="sign"?3.8:0;
        roofs.push(marketHip(front+.2,back+.8,z0+inset,z1-inset,floor+top+.12,type==="sign"?1.4:1.0,0x487c95));
      }
    }
    for(const z of [z0+.35,z1-.35]){
      const ground=marketHeight(sample,{x:front,z});
      walls.push(box(.80,.80,.65,front,ground,z,0xdad9cc),box(.66,.66,floor+3.1-ground-.65,front,ground+.65,z,0x355b58));
    }
  }
  const building=marketMerge(walls,group,"marketplace-walls-and-colonnade");building.userData.landmark={name:"International Marketplace",kind:"building"};
  marketMerge(roofs,group,"marketplace-roofs");
  marketMerge([marketDrape(MARKET.paving,sample,0x858681),...MARKET.drives.map(p=>marketDrape(p,sample,0x858681)),
    marketDrape([[625,247],[654,247],[654,499],[625,499]],sample,0xc3bdae,.18,4)],group,"marketplace-grounds");
  scene.add(group);return{group,building,floor,bottom,rings,front,back,update(){},dispose:()=>disposeArea(group)};
}
