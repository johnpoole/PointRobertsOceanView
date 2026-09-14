// A small authored bank joins the retaining wall to the surrounding heightfield.
// It edits the terrain itself; walking clearances are applied afterward.
export function terrainGrade(spec) {
  if (!spec) return (x,z,height)=>height;
  if (!(spec.fade>0) || !Array.isArray(spec.triangles) || !spec.triangles.length
      || !spec.triangles.every(t=>t.length===3 && t.every(p=>p.length===3 && p.every(Number.isFinite))))
    throw new Error('Invalid cabin terrain grade');
  const points=spec.triangles.flat(),xs=points.map(p=>p[0]),zs=points.map(p=>p[2]);
  const minX=Math.min(...xs)-spec.fade,maxX=Math.max(...xs)+spec.fade;
  const minZ=Math.min(...zs)-spec.fade,maxZ=Math.max(...zs)+spec.fade;
  return (x,z,height)=>{
    if(x<minX||x>maxX||z<minZ||z>maxZ)return height;
    let distance=Infinity,target=height;
    for(const [a,b,c] of spec.triangles) {
      const den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
      if(Math.abs(den)<1e-10)continue;
      const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den;
      const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den;
      if(u>=0&&v>=0&&u+v<=1)return a[1]*u+b[1]*v+c[1]*(1-u-v);
      for(const [p,q] of [[a,b],[b,c],[c,a]]) {
        const dx=q[0]-p[0],dz=q[2]-p[2],length=dx*dx+dz*dz;
        const t=Math.max(0,Math.min(1,((x-p[0])*dx+(z-p[2])*dz)/length));
        const d=Math.hypot(x-p[0]-t*dx,z-p[2]-t*dz);
        if(d<distance){distance=d;target=p[1]+t*(q[1]-p[1]);}
      }
    }
    const t=Math.max(0,1-distance/spec.fade),blend=t*t*(3-2*t);
    return height+(target-height)*blend;
  };
}
