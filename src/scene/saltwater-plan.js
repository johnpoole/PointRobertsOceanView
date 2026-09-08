// OSM geographic anchor; façade/roof/site estimates: CONTINUE-saltwater.md.
import { toWorld } from "../geo.js";
export const SALTWATER={
  footprint:[[48.9841077,-123.0819087],[48.9840475,-123.0819091],
    [48.9840475,-123.0818858],[48.9839636,-123.0818863],
    [48.9839633,-123.0817805],[48.9841073,-123.0817796]],
  wallHeight:3,roofRise:1.45,
  patio:[[-7.8,-6.8],[-.3,-6.8],[-.3,1.5],[-7.8,1.5]],
  forecourt:[[-8,-8.5],[9.6,-8.5],[9.6,0],[-.3,0],[-.3,1.5],[-8,1.5]],
  tables:[[-2.2,-2],[-5,-2.2],[-4.3,-5]],
  sign:[-7.4,-5.5],
};
const ring=SALTWATER.footprint.map(p=>toWorld(...p)),origin=ring[0],east=ring[5];
export const saltwaterFrame={origin,angle:Math.atan2(-(east.z-origin.z),east.x-origin.x),width:Math.hypot(east.x-origin.x,east.z-origin.z)};
export function saltwaterPoint(x,z,y=0){const {origin:o,angle:a}=saltwaterFrame;return{x:o.x+Math.cos(a)*x+Math.sin(a)*z,y,z:o.z-Math.sin(a)*x+Math.cos(a)*z}}
export function saltwaterLocal(p){const {origin:o,angle:a}=saltwaterFrame,x=p.x-o.x,z=p.z-o.z;return{x:Math.cos(a)*x-Math.sin(a)*z,z:Math.sin(a)*x+Math.cos(a)*z}}
export const saltwaterRing=ring.map(saltwaterLocal);
saltwaterFrame.length=saltwaterRing[3].z;
saltwaterFrame.step=saltwaterRing[1].z;
saltwaterFrame.inset=saltwaterRing[2].x;
export function isSaltwaterBuilding(b){const p=b.coords?.[0];return !!p&&Math.abs(p[0]-48.9841077)<1e-8&&Math.abs(p[1]+123.0819087)<1e-8}
