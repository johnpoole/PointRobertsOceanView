import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toWorld, fromWorld } from "../geo.js";
import { KITE_SURFER, kiteSurferState } from "./kitesurfer-plan.js";

// Low-poly geometry from the owner's turquoise/red kite and dark wetsuit.
// No photo textures or source video are loaded by the web app.
export function buildKiteSurfer(parent, ground) {
  const group=new THREE.Group();group.name='cast-the-kite-surfer';group.visible=false;
  group.userData={role:KITE_SURFER.role,invented:true,source:'Owner references in kitesurf/; assumed wind threshold, route and sessions'};
  parent.add(group);
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8,metalness:0,side:THREE.DoubleSide});
  const colour=new THREE.Color(), parts=[];
  function tint(g,hex) {
    colour.setHex(hex);const values=new Float32Array(g.attributes.position.count*3);
    for(let i=0;i<values.length;i+=3){values[i]=colour.r;values[i+1]=colour.g;values[i+2]=colour.b;}
    g.setAttribute('color',new THREE.BufferAttribute(values,3));return g;
  }
  function beam(a,b,r,hex=0x19252b) {
    const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),d=bv.clone().sub(av);
    const g=new THREE.CylinderGeometry(r,r,d.length(),6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));
    g.translate(...av.add(bv).multiplyScalar(.5).toArray());parts.push(tint(g,hex));
  }
  function box(w,h,d,x,y,z,hex) {const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);parts.push(tint(g,hex));}
  function merged() {const g=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());parts.length=0;return new THREE.Mesh(g,material);}
  const rider=new THREE.Group();group.add(rider);
  box(1.42,.07,.43,0,.07,0,0xd84842);
  // Bent knees, leaning back into the harness; raised arms hold the bar.
  beam([-.46,.12,0],[-.29,.48,.14],.075);beam([-.29,.48,.14],[-.10,.87,-.03],.09);
  beam([.46,.12,0],[.28,.46,.17],.075);beam([.28,.46,.17],[.10,.87,-.03],.09);
  beam([0,.85,-.03],[0,1.32,-.25],.17);
  box(.36,.13,.27,0,.95,-.07,0x33373a);
  const head=new THREE.SphereGeometry(.135,8,6);head.translate(0,1.49,-.28);parts.push(tint(head,0x242b30));
  for(const sign of [-1,1]) {beam([sign*.16,1.26,-.21],[sign*.30,1.08,.16],.055);beam([sign*.30,1.08,.16],[sign*.24,1.32,.52],.047);}
  beam([-.36,1.32,.52],[.36,1.32,.52],.025,0xdc5044);
  rider.add(merged());

  // Arched inflatable canopy: turquoise sail, red trailing strip and dark seams.
  const canopy=new THREE.Group();group.add(canopy);
  const vertices=[],colors=[],indices=[];const n=18;
  for(let i=0;i<=n;i++) {
    const u=-1+2*i/n, theta=u*1.25;
    for(let j=0;j<3;j++) {
      const chord=[-.72,.56,.82][j];vertices.push(3.0*Math.sin(theta),1.85*Math.cos(theta)-1.2-.10*j,chord);
      colour.setHex(j===2?0xdc4147:(i%5===0?0x203c49:0x16a6b6));colors.push(colour.r,colour.g,colour.b);
    }
    if(i<n)for(let j=0;j<2;j++){const a=i*3+j,b=a+3;indices.push(a,b,a+1,b,b+1,a+1);}
  }
  const sail=new THREE.BufferGeometry();sail.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  sail.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));sail.setIndex(indices);sail.computeVertexNormals();
  canopy.add(new THREE.Mesh(sail,material));
  for(let i=0;i<n;i++)beam(vertices.slice(i*9,i*9+3),vertices.slice((i+1)*9,(i+1)*9+3),.055,0x203c49);
  canopy.add(merged());
  const lineGeometry=new THREE.BufferGeometry(),linePositions=new Float32Array(24);
  lineGeometry.setAttribute('position',new THREE.BufferAttribute(linePositions,3).setUsage(THREE.DynamicDrawUsage));
  const lines=new THREE.LineSegments(lineGeometry,new THREE.LineBasicMaterial({color:0xced5d5,transparent:true,opacity:.7}));
  lines.frustumCulled=false;group.add(lines);
  // Small planar wake; one mesh, faded out at the slow ends of each tack.
  const wakeGeometry=new THREE.BufferGeometry();wakeGeometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,-.75,0,-6,.75,0,-6],3));
  const wake=new THREE.Mesh(wakeGeometry,new THREE.MeshBasicMaterial({color:0xdbe9e9,transparent:true,opacity:.3,depthWrite:false,side:THREE.DoubleSide}));rider.add(wake);
  const origin=toWorld(KITE_SURFER.lat,KITE_SURFER.lon),a=new THREE.Vector3(),b=new THREE.Vector3();
  const frustum=new THREE.Frustum(),matrix=new THREE.Matrix4(),sphere=new THREE.Sphere(new THREE.Vector3(),24);
  return {group,
    update(now,camera,conditions={}) {
      const state=kiteSurferState(now,conditions);group.visible=false;if(!state)return;
      const x=origin.x+state.east,z=origin.z+state.south,ll=fromWorld(x,z);
      const bed=ground(ll.lat,ll.lon);
      // The selected offshore route must remain water even at low tide.
      if(!Number.isFinite(bed)||bed>conditions.waterLevel-.45)return;
      const sampled=conditions.surfaceAt?.(x,z);
      const surface=Number.isFinite(sampled)?sampled:conditions.waterLevel;
      group.position.set(x,surface+.10,z);
      rider.rotation.set(0,state.heading+Math.PI/2,.10*Math.sin(state.phase));
      wake.rotation.y=-Math.PI/2;
      wake.position.y=-.04;wake.material.opacity=.10+.23*Math.abs(Math.cos(state.phase));
      const wind=state.downwind*Math.PI/180,sweep=.20*Math.sin(state.elapsed*.45);
      canopy.position.set(Math.sin(wind+sweep)*11,19+1.5*Math.sin(state.elapsed*.28),-Math.cos(wind+sweep)*11);
      canopy.rotation.set(.12,Math.PI-wind,.12*Math.sin(state.elapsed*.45));
      rider.updateMatrix();canopy.updateMatrix();
      for(let i=0;i<4;i++) {
        a.set(i%2? .24:-.24,1.32,.52).applyMatrix4(rider.matrix);
        b.set(i%2?2.6:-2.6,-.6,i<2?-.72:.70).applyMatrix4(canopy.matrix);
        a.toArray(linePositions,i*6);b.toArray(linePositions,i*6+3);
      }
      lineGeometry.attributes.position.needsUpdate=true;
      if(camera) {
        camera.updateMatrixWorld();matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(matrix);sphere.center.set(x,surface+10,z);
        if(camera.position.distanceTo(sphere.center)>2200||!frustum.intersectsSphere(sphere))return;
      }
      group.visible=true;
    }
  };
}
