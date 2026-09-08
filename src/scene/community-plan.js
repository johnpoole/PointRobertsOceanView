// County aerial screen coordinates: 720 square, left x=280 / top y=0.
// See CONTINUE-community.md for source dates and geometric uncertainty.
import { toWorld } from "../geo.js";
export const COMMUNITY = {
  center:[[48.9843286, -123.0769828], [48.9843278, -123.0766835], [48.9843709, -123.0766833], [48.9843708, -123.0766531], [48.9843829, -123.0766355], [48.984414, -123.0766355], [48.9844257, -123.0766516], [48.9844257, -123.076683], [48.9845213, -123.0766824], [48.9845222, -123.0769815]],
  library:[[48.9845245, -123.0774082], [48.9845255, -123.0772623], [48.9845095, -123.077262], [48.9845098, -123.0772243], [48.9844467, -123.0772233], [48.9844464, -123.0772599], [48.9843363, -123.0772582], [48.9843361, -123.077284], [48.9842913, -123.0772833], [48.9842907, -123.0773806], [48.9843373, -123.0773813], [48.9843371, -123.0774054], [48.9844536, -123.0774072], [48.984453, -123.0775052], [48.9845105, -123.077506], [48.9845111, -123.077408]],
  paving:[[443,380],[882,380],[892,518],[681,532],[665,539],[555,539],[542,544],[470,534],[441,492]],
  westParking:[[333,389],[365,389],[365,525],[337,523]],
  sidewalk:[[332,375],[886,375],[886,382],[332,382]],
  playPad:[[829,580],[883,580],[884,617],[830,617]],
  gardenBeds:[[491,550],[507,550],[523,550],[491,566],[507,566],[523,566],[539,550],[539,566]],
  courts:[[713,448,744,515],[813,448,844,515]],
  roofUnits:[[574,450,1],[653,450,1],[574,505,1],[653,505,1],[589,438,0],[616,461,0],[619,494,0],[599,483,0]],
};
export function communityLatLon(px,py){
  const x=-13700951.138491033+(px-280)/720*220,y=6272367.221409737-py/720*220;
  return{lat:(2*Math.atan(Math.exp(y/6378137))-Math.PI/2)*180/Math.PI,lon:x/6378137*180/Math.PI};
}
export function communityPoint(px,py,y=0){const p=communityLatLon(px,py);return toWorld(p.lat,p.lon,y)}
export function communityBuildingKind(b){const p=b.coords?.[0];if(!p)return null;
  for(const kind of ["center","library"]){const q=COMMUNITY[kind][0];if(Math.abs(p[0]-q[0])<1e-8&&Math.abs(p[1]-q[1])<1e-8)return kind}return null;
}
export function clipCommunity(ring,axis,value,greater){const out=[],inside=p=>greater?p[axis]>=value:p[axis]<=value;
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];if(inside(a))out.push(a);if(inside(a)!==inside(b)){const t=(value-a[axis])/(b[axis]-a[axis]);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t})}}return out;
}
export function communityRings(){const center=COMMUNITY.center.map(p=>toWorld(...p)),split=communityPoint(664.3,490).x;
  return{center,main:clipCommunity(center,"x",split,false),annex:clipCommunity(center,"x",split,true),library:COMMUNITY.library.map(p=>toWorld(...p))};
}
