// Spinal cord and connector nerves (prototype v12). One nerve per connector,
// built from the real connector list only. Pure data: no scene objects here.
import * as THREE from "three";
import { mulberry } from "../lib/random.js";

/** Gentle curve of the cord below the brainstem: z at height y. */
export const SPZ=y=>-.445+.06*Math.sin((-.72-y)*1.4);

/** @param {{s:string}[]} CONNECTORS */
export function buildNerveData(CONNECTORS){
  let conIdx=[],bodyBottom;
  const brnd=mulberry(11);
  const P=[],S=[],Dd=[],Cn=[],B=[],bs=[];                 // position, size, growth distance, connector id (-1 cord), base brightness
  const ad=(x,y,z,s,d,c,b)=>{P.push(x,y,z);S.push(s);Dd.push(d);Cn.push(c);B.push(b);return P.length/3-1;};
  const poly=(pts,d0,s,c,b)=>{let prev=-1,d=d0,l=null;const ds=[],ids=[];for(const q of pts){if(l)d+=Math.hypot(q[0]-l[0],q[1]-l[1],q[2]-l[2]);const i=ad(q[0],q[1],q[2],s,d,c,b);if(prev>=0)bs.push(prev,i);prev=i;l=q;ds.push(d);ids.push(i);}return {ds,ids};};
  const nz=v=>{const l=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/l,v[1]/l,v[2]/l];};
  const ru=()=>nz([brnd()-.5,brnd()-.5,brnd()-.5]);
  const tan=(pts,j)=>{const a=pts[Math.max(0,j-1)],b=pts[Math.min(pts.length-1,j+1)];return nz([b[0]-a[0],b[1]-a[1],b[2]-a[2]]);};
  // small side twig, optionally splitting once more (gives the nerve an organic, not wire-like look)
  const twig=(p,tg,d0,c,len,depth)=>{const r=ru(),dt=r[0]*tg[0]+r[1]*tg[1]+r[2]*tg[2],dir=nz([r[0]-tg[0]*dt+tg[0]*.7,r[1]-tg[1]*dt+tg[1]*.7,r[2]-tg[2]*dt+tg[2]*.7]);
    const m=Math.max(3,Math.ceil(len/.03)),bend=ru(),pts=[];for(let i=0;i<=m;i++){const u=i/m,w=Math.sin(u*Math.PI)*.12*len;pts.push([p[0]+dir[0]*len*u+bend[0]*w,p[1]+dir[1]*len*u+bend[1]*w,p[2]+dir[2]*len*u+bend[2]*w]);}
    const r2=poly(pts,d0,depth?.42:.48,c,depth?.28:.38);if(!depth&&brnd()<.6){const q=Math.floor(m*(.5+.4*brnd()));twig(pts[q],tan(pts,q),r2.ds[q],c,len*.55,1);}};
  const cordD=y=>(-.72-y)*1.02;
  const n=CONNECTORS.length,LV=k=>-.98-k*.26;             // nerve exit level per connector, from the top of the cord down
  const yEnd=Math.min(-2.0,LV(Math.max(0,n-1))-.55);
  // spinal cord: dense core plus three twisting fibre lines; grows down from the brainstem
  for(let i=0,m=Math.round((-.72-yEnd)*180);i<m;i++){const y=-.72-brnd()*(-.72-yEnd),a=brnd()*6.283,r=.065*(.65+.35*brnd())*(y<yEnd+.25?.6:1);ad(Math.cos(a)*r,y,SPZ(y)+Math.sin(a)*r,1,cordD(y),-1,.85);}
  for(let f=0;f<3;f++){const c=[],ph=f*2.1;for(let y=-.72;y>=yEnd;y-=.03)c.push([.045*Math.cos(y*7+ph),y,SPZ(y)+.045*Math.sin(y*7+ph)]);poly(c,0,.55,-1,.6);}
  // one nerve per connector; front/back alternate so labels form two tidy columns in the side view
  conIdx=[];
  CONNECTORS.forEach((c,k)=>{const y=LV(k),z0=SPZ(y),fb=k%2?-1:1,sx=(k%4<2?1:-1)*.12,d0=cordD(y);
    const dim=c.s==="bad"?.45:c.s==="warn"?.75:1,len=1.25+.1*((k*7)%3);
    const end=[sx*2.2,y-.32-.04*(k%3),z0+fb*len];
    const ctrl=[[sx*.3,y,z0],[sx*.9,y-.05,z0+fb*.32],[sx*1.6,y-.16,z0+fb*.75],end];
    const cv=new THREE.CubicBezierCurve3(...[[0,y,z0],...ctrl.slice(0,2),end].map(a=>new THREE.Vector3(a[0],a[1],a[2])));
    const L=cv.getLength(),m=Math.ceil(L/.025),sp=cv.getSpacedPoints(m).map(v=>[v.x,v.y,v.z]);
    let main=null;
    for(let f=0;f<4;f++){const ph=f*1.57+brnd(),amp=.028*(1-.3*f/3);   // fibre bundle twisting around the nerve axis, tapering toward the end
      const r=poly(sp.map((q,j)=>{const u=j/m,a=u*L*9+ph,t=amp*(1-.55*u);return [q[0]+t*Math.cos(a)*.5,q[1]+t*Math.cos(a),q[2]+t*Math.sin(a)];}),d0,f?.48:.62,k,(f?.5:.78)*dim);if(!f)main=r;}
    for(let t=.18;t<L-.12;t+=.12+.14*brnd()){const j=Math.round(t/L*m);twig(sp[j],tan(sp,j),main.ds[j],k,.12+.22*brnd(),0);}   // side twigs
    for(let i=0;i<6;i++)twig(sp[m],tan(sp,m),main.ds[m],k,.14+.16*brnd(),0);                                                  // terminal arborisation at the connector
    conIdx[k]=ad(end[0],end[1],end[2],6.5,main.ds[m],k,.95);});
  bodyBottom=Math.min(yEnd,...CONNECTORS.map((_,k)=>LV(k)-.5))-.2;
  let Dmax=0;for(const d of Dd)if(d>Dmax)Dmax=d;
  const startD=k=>cordD(LV(k));
  return {P,S,Dd,Cn,B,bs,conIdx,bodyBottom,Dmax,n,startD};
}
