// Brain point cloud and fibre graph (prototype v12). Pure and deterministic:
// the same seed always gives the same brain. No three.js objects here.
import { mulberry } from "../lib/random.js";

export const REG=["memory","planning","execution","research","workflows","connectors","subagents"];
/** Z position of the brainstem / cord centre line at height y. */
export const CORDZ=y=>{const u=(-.35-y)/1.45;return -.36-.12*Math.min(1,u*4)+.05*Math.sin(u*3);};

export function buildBrain(){
  const rnd=mulberry(7);
  function gauss(){return Math.sqrt(-2*Math.log(rnd()+1e-9))*Math.cos(6.2831853*rnd());}
  function dir(){let x=gauss(),y=gauss(),z=gauss();const l=Math.hypot(x,y,z)||1;return [x/l,y/l,z/l];}

  const pos=[],reg=[],size=[],shade=[],kind=[];
  function add(x,y,z,r,s,sh,kd){pos.push(x,y,z);reg.push(r);size.push(s);shade.push(sh===undefined?1:sh);kind.push(kd||0);}
  function classify(x,y,z){
    if(z>.6) return 1;                                  // prefrontal
    if(y>.28&&z>.14&&z<.44) return 2;                   // motor strip in front of the central sulcus
    if(y<-.02&&z>-.5&&z<.5&&Math.abs(x)>.55) return 0;  // temporal lobe below the lateral fissure
    if(z<-.7) return 3;                                 // occipital
    return -1;
  }
  // hemispheres: lobed shape, gyri shading, lateral and central fissures
  function gyri(d){return Math.sin(11*d[0]+7*d[1]+3)*Math.sin(9*d[2]+6*d[1])+.55*Math.sin(17*d[2]-11*d[1]+1)*Math.cos(13*d[0]);}
  function cortex(side,d,depth,checkFissures){
    const g=gyri(d),fold=1+.035*g;
    const lateral=Math.abs(d[0]);
    const temporal=Math.exp(-Math.pow((d[2]+.02)/.42,2))*(lateral>.25?1:.35);
    const ry=d[1]<0?(.42+.4*temporal):.74;
    const tap=d[2]<-.45?1-.3*((-d[2]-.45)/.55):1;          // occipital taper
    let lx=d[0]*.64*fold*depth*tap, y=.14+d[1]*ry*fold*depth*tap, z=d[2]*1.14*fold*depth;
    if(d[2]>.55&&d[1]<0) y=.14+d[1]*.3*fold*depth;      // flat orbital base of the frontal lobe
    if(lx*side<0) lx*=.42;                               // flat medial wall -> visible midline gap
    const x=side*.46+lx;let skip=false;
    if(checkFissures){
      if(lx*side>.22&&Math.abs(y-(-.03+.3*z))<.04&&z>-.4&&z<.58) skip=true;   // lateral (Sylvian) fissure
      if(y>.22&&Math.abs(z-(.12-.28*(y-.22)))<.028) skip=true;               // central sulcus
    }
    return {x,y,z,g,skip};
  }
  for(const side of [-1,1]){
    for(let i=0;i<2000;i++){
      const d=dir();const interior=rnd()<.1;
      const c=cortex(side,d,interior?(.45+.45*rnd()):1,!interior);if(c.skip)continue;
      const sh=interior?.55:(.55+.35*Math.max(0,Math.min(1,(c.g+1.2)/2.2)));   // gyri bright, sulci dark
      add(c.x,c.y,c.z,classify(c.x,c.y,c.z),interior?1.05:1.3,sh,0);
    }
    // fold lines: dense points along the gyri contour, later linked into fine curved lines
    let kept=0;
    for(let i=0;i<90000&&kept<1500;i++){
      const d=dir();if(Math.abs(gyri(d))>.05)continue;
      const c=cortex(side,d,1,true);if(c.skip)continue;
      add(c.x,c.y,c.z,classify(c.x,c.y,c.z),.85,1,1);kept++;
    }
  }
  // cerebellum
  for(let i=0;i<700;i++){const d=dir();const s=Math.sin(46*d[1]);const f=1+.05*s;add(d[0]*.58*f,-.48+d[1]*.26*f,-.78+d[2]*.32*f,4,1.25,.6+.4*(s*.5+.5));}
  // brainstem (fixed part of the brain); the cord and connector nerves below it are built in buildBody()
  for(let i=0;i<170;i++){const u=rnd(),a=rnd()*6.283,r=(.12-.04*u)*(.7+.3*rnd());const cy=-.35-u*.37;add(Math.cos(a)*r,cy,CORDZ(cy)+Math.sin(a)*r,5,1.15,.95,0);}
  // subagent satellites
  for(const side of [-1,1]){for(let i=0;i<45;i++){const d=dir();add(side*1.75+d[0]*.16,-.05+d[1]*.16,-.25+d[2]*.16,6,1.4);}}
  const NB=pos.length/3;
  // world network
  for(let i=0;i<420;i++){const d=dir();const r=3+rnd()*8;add(d[0]*r,d[1]*r*.7,d[2]*r,-2,2.2);}
  const N=pos.length/3;

  // region centroids
  const cen=REG.map(()=>[0,0,0,0]);
  for(let i=0;i<NB;i++){const r=reg[i];if(r>=0){cen[r][0]+=pos[i*3];cen[r][1]+=pos[i*3+1];cen[r][2]+=pos[i*3+2];cen[r][3]++;}}
  // region point samples (max ~400 each) for the camera-facing label anchor
  const regPts=REG.map(()=>[]);
  for(let i=0;i<NB;i++){const r=reg[i];if(r>=0)regPts[r].push(i);}
  regPts.forEach((a,r)=>{if(a.length>400){const s=a.length/400;regPts[r]=Array.from({length:400},(_,k)=>a[Math.floor(k*s)]);}});

  const NT=N;
  // growth rank per point: the brain shows more of its points the more files are linked (see setLib).
  // Brainstem, subagent satellites and the outer network are always shown.
  const urnd=mulberry(23),aU=new Float32Array(NT);
  for(let i=0;i<NT;i++){const r=reg[i];aU[i]=(i>=NB||r===5||r===6)?0:urnd();}

  // edges
  const segs=[];
  function knn(ids,k,maxd){
    const grid=new Map(),key=(a,b,c)=>a+","+b+","+c,cell=v=>Math.floor(v/maxd);
    for(const i of ids){const kk=key(cell(pos[i*3]),cell(pos[i*3+1]),cell(pos[i*3+2]));let a=grid.get(kk);if(!a)grid.set(kk,a=[]);a.push(i);}
    const m2=maxd*maxd;
    for(const i of ids){
      const xi=pos[i*3],yi=pos[i*3+1],zi=pos[i*3+2],gx=cell(xi),gy=cell(yi),gz=cell(zi);const best=[];
      for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++){const arr=grid.get(key(gx+a,gy+b,gz+c));if(!arr)continue;
        for(const j of arr){if(j===i)continue;const dx=pos[j*3]-xi,dy=pos[j*3+1]-yi,dz=pos[j*3+2]-zi;const d=dx*dx+dy*dy+dz*dz;if(d>m2)continue;
          if(best.length<k){best.push([d,j]);best.sort((p,q)=>p[0]-q[0]);}else if(d<best[k-1][0]){best[k-1]=[d,j];best.sort((p,q)=>p[0]-q[0]);}}}
      for(const p of best) if(p[1]>i) segs.push(i,p[1]);
    }
  }
  const idsCortex=[],idsFold=[],idsWorld=[];
  for(let i=0;i<NB;i++)(kind[i]===1?idsFold:idsCortex).push(i);
  for(let i=NB;i<N;i++)idsWorld.push(i);
  knn(idsCortex,3,.12);
  knn(idsFold,2,.06);
  knn(idsWorld,2,2.6);
  // subagent branches to hemisphere sides
  for(const side of [-1,1]){let best=-1,bd=9;for(let i=0;i<NB;i++){if(reg[i]>3||reg[i]===-2)continue;const d=Math.abs(pos[i*3]-side*1.05)+Math.abs(pos[i*3+1]+.05)+Math.abs(pos[i*3+2]+.25);if(d<bd){bd=d;best=i;}}
    let sb=-1,sd=9;for(let i=0;i<NB;i++){if(reg[i]!==6)continue;if(Math.sign(pos[i*3])!==side)continue;const d=Math.abs(pos[i*3]-side*1.6);if(d<sd){sd=d;sb=i;}} if(best>=0&&sb>=0) segs.push(best,sb);}
  const centroids=cen.map(c=>[c[0]/c[3],c[1]/c[3],c[2]/c[3]]);
  return {pos,reg,size,shade,kind,NB,N,NT,aU,segs,centroids,regPts};
}
