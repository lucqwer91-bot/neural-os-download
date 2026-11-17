import * as THREE from "three";
import I18N_EN from "../../../i18n/en.json";
import I18N_DE from "../../../i18n/de.json";
import { FILES, EVENTS, CONNECTORS, NOTE, FX, CLAUDEMD } from "../demo/data.js";
import { PROJ, SHARED, DEMO_POOL, SESS, HIST, RPL } from "../demo/data.js";
import { ICON, MODT, BASE_DOCK } from "../ui/dock.js";
import { stickySide, spreadDown, stackColumn } from "../brain/labels.js";
import { paletteMatches } from "../ui/palette.js";
import { createOverlays } from "../ui/overlays.js";
import { bridge, lib, refreshLibrary, libraryBlock, importSummary, linkSummary, fmtBytes as fmtB } from "../ui/library.js";
import { createRealLayer } from "../brain/realnodes.js";
import { createForeignBrains } from "../brain/foreign.js";
import { renderMarkdown, section as mdSection, headings as mdHeadings } from "../ui/markdown.js";
import { renderCanvas, wireCanvas } from "../ui/canvas.js";
import "katex/dist/katex.min.css";
import { BR, brainsBridge, brainsBlock, projectList, exportOpts } from "../ui/brains.js";
import { regionColor, nameColor, css as cssCol } from "../brain/colors.js";
import { computeNumbers } from "../ui/numbers.js";
import { monBridge, mon, refreshMonitor, isLive, addLive, baseName as pathBase, isActive, eventKey, eventDetail, timelineEvents, lineDiff, compactDiff, diffStats } from "../ui/monitor.js";
import { GROUP_BY, assignColors, groupOf, groupColor, groupCounts, isNone, histogram, idsInMonth, idsInGroup, setTags, tagsLoaded, rampColor } from "../ui/groups.js";
import { mulberry } from "../lib/random.js";
import { setupSteps, setupProgress, TRIED_KEY, PICK_KEY, GOALS, readPick } from "../ui/setup.js";
import { esc } from "../lib/text.js";
import { parseProps, serializeProps, propsBlock } from "../ui/props.js";
import { FS as FT, filesBody, splitKey, parentOf as fsParent, baseOf as fsBase } from "../ui/files.js";
import * as SH from "../brain/shaders.js";
import { REG, CORDZ, buildBrain } from "../brain/geometry.js";
import { SPZ, buildNerveData } from "../brain/nerves.js";
import { DEFAULT_VIEW, frameFor, orbitPosition, zoomStep, rotateStep, ease } from "../brain/camera.js";
// Ported 1:1 from design/neural-os-prototype.html (v12). Demo data only.
// Being split into modules step by step (demo/, lib/, brain/).
THREE.ColorManagement.enabled = false; // keep r128 colour behaviour
(function(){
"use strict";
/* ---------- i18n ---------- */
const T={en:I18N_EN,de:I18N_DE}; // UI text lives in src/i18n/*.json
let lang="en";
/* first start is English; the user's own choice (Settings → Sprache/Language) is kept */
try{const s=localStorage.getItem("nos-lang"); if(s==="de"||s==="en") lang=s;}catch(e){}
const t=k=>(T[lang][k]??T.en[k]??k);

/* ---------- state ---------- */
// timer callbacks can change what is shown, so they wake the render loop afterwards (see wake() in the loop section)
const setTimeout=(f,ms)=>window.setTimeout(()=>{f();wake();},ms),setInterval=(f,ms)=>window.setInterval(()=>{f();wake();},ms);
const VIEW=(()=>{try{return JSON.parse(localStorage.getItem("nos-view")||"{}")||{};}catch{return {};}})();
const st={linkColor:VIEW.linkColor==="files"?"files":"region",regLabels:VIEW.regLabels==="brain"?"brain":"side",form:Math.max(0,Math.min(1,+VIEW.form||0)),colorBy:VIEW.look2===undefined?"project":GROUP_BY.includes(VIEW.colorBy)?VIEW.colorBy:"project",look:VIEW.look2==="dust"?"dust":"web",psize:+VIEW.psize||1,bright:+VIEW.bright||1,turn:VIEW.turn!==false,speed:+VIEW.speed||1,links:VIEW.look2===undefined?true:VIEW.links!==false,theme:(()=>{try{return localStorage.getItem("nos-theme")||"color";}catch{return "color";}})(),privacy:false,reduce:matchMedia("(prefers-reduced-motion: reduce)").matches,power:false,paused:false};
const privMap=new Map();
function nm(s,kind){ if(!st.privacy) return s; const k=kind+"|"+s; if(!privMap.has(k)){const n=[...privMap.keys()].filter(x=>x.startsWith(kind+"|")).length; privMap.set(k,(kind==="p"?(lang==="de"?"Projekt ":"Project "):(lang==="de"?"Datei ":"File "))+String.fromCharCode(65+n));} return privMap.get(k); }

/* ---------- demo content ---------- */
const log=[];

/* ---------- three.js scene ---------- */
const canvas=document.getElementById("scene");
let renderer;
try{ renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false}); }catch(e){ document.getElementById("st-view").textContent="WebGL not available"; }
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(50,1,0.01,60);
if(renderer){ renderer.outputColorSpace=THREE.LinearSRGBColorSpace; renderer.setClearColor(0x08090a,1); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); }

const {pos,reg,size,shade,kind,NB,N,NT,aU,segs,centroids,regPts}=buildBrain();
const centroid=centroids.map(c=>new THREE.Vector3(c[0],c[1],c[2]));
const anchorV=REG.map(()=>new THREE.Vector3()),_cd=new THREE.Vector3(),_cl=new THREE.Vector3();
// anchor = soft-weighted mean of the region points that face the camera, so the marker sits on the visible surface.
// Soft weights (instead of a hard cut-off) make the anchor glide continuously while the brain turns, it never jumps.
function updAnchors(){_cl.copy(camera.position);brainG.worldToLocal(_cl);
  REG.forEach((_,r)=>{const c=centroid[r],P=regPts[r];if(!P.length){anchorV[r].copy(c).applyMatrix4(brainG.matrixWorld);return;}
  _cd.copy(_cl).sub(c).normalize();let mx=-1e9;
  for(const i of P){const s=(pos[i*3]-c.x)*_cd.x+(pos[i*3+1]-c.y)*_cd.y+(pos[i*3+2]-c.z)*_cd.z;if(s>mx)mx=s;}
  let x=0,y=0,z=0,n=0;for(const i of P){const s=(pos[i*3]-c.x)*_cd.x+(pos[i*3+1]-c.y)*_cd.y+(pos[i*3+2]-c.z)*_cd.z;const w=Math.exp((s-mx)/.06);x+=pos[i*3]*w;y+=pos[i*3+1]*w;z+=pos[i*3+2]*w;n+=w;}
  anchorV[r].set(x/n,y/n,z/n).applyMatrix4(brainG.matrixWorld);});}


// geometry
const base=new Float32Array(NT*3), col=new Float32Array(NT*3);
const act=new Float32Array(REG.length); // region activity 0..1
let hoverReg=-1,showAll=true;
// with labels on, each region gets its own slight brightness so its area reads as one patch (monochrome only)
const LIFT=REG.map((_,r)=>[.05,.13,.08,.16,.06,.11,.09][r%7]);
function baseShade(i){const r=reg[i];if(r===-2)return .2; return (r>=0?.62:.52)*shade[i];}
// base tint: region colour in the colour theme, faint cold silver in mono
let RC=REG.map(r=>regionColor(r,st.theme));
function tintBase(){RC=REG.map(r=>regionColor(r,st.theme));const mono=st.theme!=="color";
  for(let i=0;i<NT;i++){const s=baseShade(i),r=reg[i],c=r>=0?RC[r]:[.92,.98,1.08],w=mono||r<0?1:.82;
    for(let k=0;k<3;k++)base[i*3+k]=Math.min(1,mono||r<0?s*[.92,.98,1.08][k]:s*(c[k]*w+(1-w)*.9)*1.9);}}
tintBase();
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
geo.setAttribute("aColor",new THREE.BufferAttribute(col,3));
geo.setAttribute("aSize",new THREE.Float32BufferAttribute(size,1));
geo.setAttribute("aU",new THREE.BufferAttribute(aU,1));
const pmat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
 uniforms:{uPR:{value:1},uK:{value:1},uDen:{value:1},uFade:{value:1}},
 vertexShader:SH.POINTS_VS,
 fragmentShader:SH.POINTS_FS});
// the brain (points, fold lines, activity paths) lives in one group, scaled around the base of the brainstem
// so the spinal cord below stays attached while the brain grows with the library
const brainG=new THREE.Group();scene.add(brainG);
const BPIV=new THREE.Vector3(0,-.72,CORDZ(-.72));
const points=new THREE.Points(geo,pmat);brainG.add(points);

const lpos=new Float32Array(segs.length*3), lcol=new Float32Array(segs.length*3);
for(let s=0;s<segs.length;s++){const i=segs[s];lpos[s*3]=pos[i*3];lpos[s*3+1]=pos[i*3+1];lpos[s*3+2]=pos[i*3+2];}
const lgeo=new THREE.BufferGeometry();
lgeo.setAttribute("position",new THREE.BufferAttribute(lpos,3));
lgeo.setAttribute("color",new THREE.BufferAttribute(lcol,3));
const lines=new THREE.LineSegments(lgeo,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false}));
brainG.add(lines);

/* ---------- spinal cord + connector nerves: every connector is wired in by its own nerve from the cord ---------- */
let body=null,conIdx=[],bodyBottom=-2.4,hoverCon=-1;
const growAll={value:0},growNew={value:1e3},newIdx={value:-1};let newNerve=-1,growNewTarget=1e3,growAllTarget=1e3;
const GU={uAll:growAll,uNew:growNew,uNewIdx:newIdx};
const nervePMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{uPR:pmat.uniforms.uPR,uK:pmat.uniforms.uK,...GU},vertexShader:SH.NERVE_VS,fragmentShader:SH.NERVE_FS});
const nerveLMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,vertexColors:true,uniforms:{...GU},vertexShader:SH.NERVEL_VS,fragmentShader:SH.NERVEL_FS});
function buildBody(){
  if(body){for(const o of [body.pts,body.lns])if(o){scene.remove(o);o.geometry.dispose();}}
  const {P,S,Dd,Cn,B,bs,conIdx:ci,bodyBottom:bb,Dmax,n,startD}=buildNerveData(CONNECTORS);
  conIdx=ci;bodyBottom=bb;
  const aN=Cn.map(c=>c);   // nerve index for per-nerve growth
  const geo=new THREE.BufferGeometry(),col=new Float32Array(S.length*3);
  geo.setAttribute("position",new THREE.Float32BufferAttribute(P,3));
  geo.setAttribute("aColor",new THREE.BufferAttribute(col,3));
  geo.setAttribute("aSize",new THREE.Float32BufferAttribute(S,1));
  geo.setAttribute("aD",new THREE.Float32BufferAttribute(Dd,1));
  geo.setAttribute("aN",new THREE.Float32BufferAttribute(aN,1));
  const lp=new Float32Array(bs.length*3),lc=new Float32Array(bs.length*3),ld=new Float32Array(bs.length),ln=new Float32Array(bs.length);
  for(let s=0;s<bs.length;s++){const i=bs[s];lp[s*3]=P[i*3];lp[s*3+1]=P[i*3+1];lp[s*3+2]=P[i*3+2];ld[s]=Dd[i];ln[s]=Cn[i];}
  const lgeo=new THREE.BufferGeometry();lgeo.setAttribute("position",new THREE.BufferAttribute(lp,3));lgeo.setAttribute("color",new THREE.BufferAttribute(lc,3));lgeo.setAttribute("aD",new THREE.BufferAttribute(ld,1));lgeo.setAttribute("aN",new THREE.BufferAttribute(ln,1));
  const pts=new THREE.Points(geo,nervePMat),lns=new THREE.LineSegments(lgeo,nerveLMat);
  scene.add(pts);scene.add(lns);
  body={pts,lns,geo,lgeo,P,Dd,C:Cn,B,bs,col,lc,Dmax};
  growAllTarget=Dmax+.5;
  if(newNerve>=0&&newNerve<n){newIdx.value=newNerve;growNew.value=startD(newNerve);growNewTarget=Dmax+.5;}else{newIdx.value=-1;}
  paintBody();
}
// is point i of the nerve system already grown (visible)?
function grown(i){if(!body)return false;const g=body.C[i]===newIdx.value?growNew.value:growAll.value;return body.Dd[i]<=g;}
function paintBody(){if(!body)return;const {C,B,bs,col,lc}=body;
  const ra=Math.max(act[5],hoverReg===5?.35:0);
  for(let i=0;i<B.length;i++){let k=ra*(C[i]<0?1:.7),b=B[i];
    if(hoverCon>=0){if(C[i]===hoverCon)k=Math.max(k,.6);else if(C[i]>=0){k*=.5;b*=.55;}}
    const v=b+(1-b)*k;const nc=st.theme==="color"?(C[i]>=0&&CONNECTORS[C[i]]?nameColor(CONNECTORS[C[i]].n):RC[5]):[.93,.98,1.06];
    col[i*3]=Math.min(1,v*nc[0]*(st.theme==="color"?1.2:1));col[i*3+1]=Math.min(1,v*nc[1]*(st.theme==="color"?1.2:1));col[i*3+2]=Math.min(1,v*nc[2]*(st.theme==="color"?1.2:1));}
  body.geo.attributes.aColor.needsUpdate=true;
  for(let s=0;s<bs.length;s++){const i=bs[s];lc[s*3]=col[i*3]*.55;lc[s*3+1]=col[i*3+1]*.55;lc[s*3+2]=col[i*3+2]*.55;}
  body.lgeo.attributes.color.needsUpdate=true;
}
buildBody();

function paint(){
  for(let i=0;i<NT;i++){const r=reg[i];let a=0;if(r>=0){a=Math.max(act[r],showAll?LIFT[r]:0);if(r===hoverReg)a=Math.max(a,.45);else if(hoverReg>=0)a*=.5;}
    const k=a;if(st.theme==="color"&&r>=0){const c=RC[r];for(let q=0;q<3;q++){const hot=Math.min(1,c[q]*1.25+.08);col[i*3+q]=k<.6?base[i*3+q]+(hot-base[i*3+q])*(k/.6):hot+(1-hot)*((k-.6)/.4)*.6;}}
    else{col[i*3]=base[i*3]+(1-base[i*3])*k;col[i*3+1]=base[i*3+1]+(1-base[i*3+1])*k;col[i*3+2]=base[i*3+2]+(1-base[i*3+2])*k;}}
  geo.attributes.aColor.needsUpdate=true;
  const den=pmat.uniforms.uDen.value,vis=i=>{const u=aU[i];return u<=den-.04?1:u>=den?0:(den-u)/.04;};
  for(let s=0;s<segs.length;s+=2){const a=segs[s],b=segs[s+1],v=Math.min(vis(a),vis(b));
    for(const q of [s,s+1]){const i=segs[q],kd=kind[i];const f=(kd===1?.62:kd===2?.42:reg[i]===-2?.16:.11)*v;lcol[q*3]=col[i*3]*f;lcol[q*3+1]=col[i*3+1]*f;lcol[q*3+2]=col[i*3+2]*f;}}
  lgeo.attributes.color.needsUpdate=true;
  paintBody();
}
paint();

// activity paths (fx)
const FXN=24, fxPos=new Float32Array(FXN*3), fxCol=new Float32Array(FXN*3), fxSize=new Float32Array(FXN).fill(4);
const fxGeo=new THREE.BufferGeometry();
fxGeo.setAttribute("position",new THREE.BufferAttribute(fxPos,3));
fxGeo.setAttribute("aColor",new THREE.BufferAttribute(fxCol,3));
fxGeo.setAttribute("aSize",new THREE.BufferAttribute(fxSize,1));
const fx=new THREE.Points(fxGeo,pmat);brainG.add(fx);

/* ---------- library growth: the brain grows with the linked files ----------
   Linked file count (from the file index; demo value here) -> f = log10(files+1)/5, capped at 1 (100,000 files).
   No files: a small, sparse seed brain (18 % of the points, 72 % size). Many files: the full, dense brain. */
let libN=18412;
const libF=n=>Math.min(1,Math.log10(n+1)/5);
const libGoal=()=>({s:.72+.28*libF(libN),den:.18+.82*libF(libN)});
const libCur=libGoal();
function applyLib(){brainG.scale.setScalar(libCur.s);brainG.position.copy(BPIV).multiplyScalar(1-libCur.s);brainG.updateMatrixWorld(true);pmat.uniforms.uDen.value=libCur.den;}
applyLib();paint();
const fmtN=n=>n.toLocaleString(lang==="de"?"de-DE":"en-US");
const libGB=n=>(n*.004367).toFixed(n<230?2:1);
// real size once the real library has files; otherwise the demo estimate (shown with the demo badge)
const libSize=n=>(lib.ready&&lib.count>0&&n===lib.count)?fmtB(lib.bytes):libGB(n)+" GB";
function setLib(n){libN=Math.max(0,Math.round(n));renderStatic();
  const a=document.getElementById("lib-n"),b=document.getElementById("lib-gb"),c=document.getElementById("lib-t");if(a)a.textContent=fmtN(libN);if(b)b.textContent=libSize(libN);if(c)c.textContent=fmtN(libN);
  if(st.reduce){Object.assign(libCur,libGoal());applyLib();paint();}dirty=true;}
const paths=[];
function addPath(a,b){if(a<0||b<0||a===b)return;const p0=centroid[a],p2=centroid[b];const mid=p0.clone().add(p2).multiplyScalar(.5);mid.add(mid.clone().normalize().multiplyScalar(.6));mid.y+=.35;
  paths.push({c:new THREE.QuadraticBezierCurve3(p0.clone(),mid,p2.clone()),t:0,a,b});}

/* ---------- camera control ---------- */
const DEF={...DEFAULT_VIEW};
// frame brain + cord + nerves; with many connectors the cord gets longer and the camera pulls back a little.
// Point size is compensated so the brain keeps its density.
function frameBody(){const f=frameFor(bodyBottom);DEF.ty=f.ty;DEF.r=f.r;pmat.uniforms.uK.value=f.k;}
frameBody();
const cam={th:DEF.th,ph:DEF.ph,r:DEF.r,target:new THREE.Vector3(0,DEF.ty,-.05)};
const goal={th:cam.th,ph:cam.ph,r:cam.r,target:cam.target.clone()};
let dirty=true,lastInteract=0,shiftCur=0;
function applyCam(){camera.position.set(...orbitPosition(cam.th,cam.ph,cam.r,cam.target));camera.lookAt(cam.target);}
function resize(){if(!renderer)return;const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;if(shiftCur)camera.setViewOffset(w,h,shiftCur,0,w,h);else camera.updateProjectionMatrix();pmat.uniforms.uPR.value=renderer.getPixelRatio()*h/900*st.psize;dirty=true;}
addEventListener("resize",resize);resize();
function resetView(){goal.th=DEF.th;goal.ph=DEF.ph;goal.r=DEF.r;goal.target.set(0,DEF.ty,-.05);dirty=true;}
let drag=null;
canvas.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY,btn:e.button,moved:0};canvas.setPointerCapture(e.pointerId);canvas.classList.add("dragging");lastInteract=performance.now();});
canvas.addEventListener("pointermove",e=>{
  if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;drag.moved+=Math.abs(dx)+Math.abs(dy);
    if(drag.btn===2||e.shiftKey){const k=goal.r*.0015;const right=new THREE.Vector3().setFromMatrixColumn(camera.matrix,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrix,1);goal.target.addScaledVector(right,-dx*k).addScaledVector(up,dy*k);}
    else{const g=rotateStep(goal.th,goal.ph,dx,dy);goal.th=g.th;goal.ph=g.ph;}
    lastInteract=performance.now();dirty=true;hideTip();}
  else{mouse.set(e.clientX,e.clientY);hoverPending=true;dirty=true;}
});
canvas.addEventListener("pointerup",e=>{canvas.classList.remove("dragging");if(drag&&drag.moved<5&&drag.btn===0){clickAt(e.clientX,e.clientY);}drag=null;});
canvas.addEventListener("pointerleave",()=>{if(!drag){hoverReg=-1;hoverCon=-1;paint();hideTip();dirty=true;}});
canvas.addEventListener("contextmenu",e=>e.preventDefault());
canvas.addEventListener("wheel",e=>{e.preventDefault();goal.r=zoomStep(goal.r,e.deltaY);lastInteract=performance.now();dirty=true;},{passive:false});
canvas.addEventListener("dblclick",e=>{const h=pick(e.clientX,e.clientY);if(h>=0){goal.target.set(pos[h*3],pos[h*3+1],pos[h*3+2]).applyMatrix4(brainG.matrixWorld);goal.r=Math.min(goal.r,1.1);dirty=true;}});   // brain points live in the scaled brain group

/* ---------- picking / tooltip ---------- */
const ray=new THREE.Raycaster();ray.params.Points.threshold=.035;
const mouse=new THREE.Vector2();let hoverPending=false;
function pick(x,y){if(pmat.uniforms.uFade.value<.5)return -1;const v=new THREE.Vector2(x/innerWidth*2-1,-(y/innerHeight)*2+1);ray.setFromCamera(v,camera);const hits=ray.intersectObject(points);for(const h of hits){if(h.index<NT&&reg[h.index]>=0&&aU[h.index]<pmat.uniforms.uDen.value)return h.index;}return -1;}
const tip=document.getElementById("tip");
function hideTip(){tip.classList.remove("show");}
// body hit: connector id (rib, nerve, node or vertebra), -2 for spine/girdle, -1 for nothing
function pickBody(x,y){if(!body)return -1;const v=new THREE.Vector2(x/innerWidth*2-1,-(y/innerHeight)*2+1);ray.setFromCamera(v,camera);const hits=ray.intersectObject(body.pts).filter(h=>grown(h.index));if(!hits.length)return -1;const c=body.C[hits[0].index];return c>=0?c:-2;}
function doHover(){hoverPending=false;const i=pick(mouse.x,mouse.y);let r=i>=0?reg[i]:-1,hc=-1;
  if(i<0){const b=pickBody(mouse.x,mouse.y);if(b>=0)hc=b;else if(b===-2)r=5;}
  if(r!==hoverReg||hc!==hoverCon){hoverReg=r;hoverCon=hc;paint();dirty=true;}
  if(r>=0||hc>=0){let html;
    if(hc>=0){const c=CONNECTORS[hc];html=`<b>${esc(c.n)}</b>${esc(c.nv)} ${lang==="de"?"Nerv":"nerve"} ·${esc(t(c.s==="ok"?"ready":c.s==="warn"?"signin":"missing"))}<small>${esc(t("clickOpen"))}</small>`;}
    else html=`<b>${esc(REG[r])}</b>${esc(t("r_"+REG[r]))}<small>${esc(t("clickOpen"))}</small>`;
    tip.innerHTML=html;tip.style.left=Math.min(mouse.x+16,innerWidth-275)+"px";tip.style.top=(mouse.y+16)+"px";tip.classList.add("show");canvas.style.cursor="pointer";}
  else{hideTip();canvas.style.cursor="";}
}
const REGMOD={memory:"memory",planning:"planning",execution:"activity",research:"activity",workflows:"workflows",connectors:"connectors",subagents:"models"};
function clickAt(x,y){const i=pick(x,y);if(i>=0){openOv(REGMOD[REG[reg[i]]]);return;}if(pickBody(x,y)!==-1)openOv("connectors");}

/* ---------- labels ---------- */
const labelsEl=document.getElementById("labels");
const rlabels=REG.map((r,i)=>{const d=document.createElement("div");d.className="rlabel";d.textContent=r;d.style.setProperty("--rc",cssCol(RC[i]));labelsEl.appendChild(d);
  d.addEventListener("pointerenter",()=>{hoverReg=i;paint();dirty=true;});
  d.addEventListener("pointerleave",()=>{if(hoverReg===i){hoverReg=-1;paint();dirty=true;}});
  d.addEventListener("click",()=>openOv(REGMOD[r]));return d;});
// region names as a coloured list at the side (default), so the brain itself stays clean;
// hovering a row shows only that region's marker in the brain
const regSideEl=document.createElement("div");regSideEl.id="regside";document.body.appendChild(regSideEl);
function renderRegSide(){regSideEl.innerHTML=`<div class="rsh">${t("regionsH")}</div>`+REG.map((r,i)=>`<button type="button" data-ri="${i}" style="--rc:${cssCol(RC[i])}"><i></i>${esc(r)}</button>`).join("");}
renderRegSide();
regSideEl.addEventListener("pointerover",e=>{const b=e.target.closest("[data-ri]");if(!b)return;const i=+b.dataset.ri;if(hoverReg!==i){hoverReg=i;paint();dirty=true;}});
regSideEl.addEventListener("pointerleave",()=>{if(hoverReg!==-1){hoverReg=-1;paint();dirty=true;}});
regSideEl.addEventListener("click",e=>{const b=e.target.closest("[data-ri]");if(b)openOv(REGMOD[REG[+b.dataset.ri]]);});
const clabels=[];
function renderCLabels(){
  while(clabels.length>CONNECTORS.length)clabels.pop().remove();
  while(clabels.length<CONNECTORS.length){const d=document.createElement("div");d.className="clabel";labelsEl.appendChild(d);clabels.push(d);}
  CONNECTORS.forEach((c,i)=>{clabels[i].innerHTML=`<small>${esc(c.nv)} ${lang==="de"?"Nerv":"nerve"}</small>${esc(c.n)}<i style="color:var(--${c.s})">●</i>`;});}
renderCLabels();
const v3=new THREE.Vector3();
const leadEl=document.getElementById("lead");
const regSide=REG.map(()=>0),regLP=REG.map(()=>null);   // per region label: chosen side, smoothed screen position
function placeLabels(){
  const W=innerWidth,H=innerHeight;v3.set(0,.1,-.1).project(camera);const cx=(v3.x+1)/2*W,cy=(1-v3.y)/2*H;let svg="";
  updAnchors();
  const RL=[];
  REG.forEach((r,i)=>{v3.copy(anchorV[i]).project(camera);const el=rlabels[i];
    const sideList=st.regLabels==="side",row=regSideEl.children[i+1];
    if(row){row.classList.toggle("act",act[i]>.25);row.classList.toggle("hot",i===hoverReg);}
    const vis=v3.z<1&&(sideList?i===hoverReg:(act[i]>.25||i===hoverReg||(showAll&&cam.r>1.25)));
    el.classList.toggle("show",vis&&!sideList);if(!vis){regLP[i]=null;return;}
    const px=(v3.x+1)/2*W,py=(1-v3.y)/2*H;let dx=px-cx,dy=py-cy;
    // sticky side: a label only changes sides once its marker is clearly across the middle (no flip-flopping while turning)
    regSide[i]=stickySide(regSide[i],dx);
    const side=regSide[i],l=Math.hypot(dx,dy)||1;dy/=l;
    RL.push({i,el,px,py,dx:side,dy,lx:px+side*(70+30*Math.min(1,Math.abs(dx)/l)),ly:py+dy*50});});
  // keep region labels on the same side at least 22 px apart
  for(const left of [true,false]){spreadDown(RL.filter(o=>(o.dx<0)===left).sort((a,b)=>a.ly-b.ly),"ly",22);}
  // labels glide toward their target instead of jumping
  RL.forEach(o=>{const q=regLP[o.i];if(q&&!st.reduce){q.tx=o.lx;q.ty=o.ly;q.x+=(o.lx-q.x)*.18;q.y+=(o.ly-q.y)*.18;o.lx=q.x;o.ly=q.y;}else regLP[o.i]={x:o.lx,y:o.ly,tx:o.lx,ty:o.ly};});
  RL.forEach(({i,el,px,py,dx,dy,lx,ly})=>{
    if(st.regLabels==="side"){const R=9,X=px.toFixed(1),Y=py.toFixed(1);   // marker only, no leader line or floating name
      svg+=`<g class="mk hot" style="--rc:${cssCol(RC[i])}"><circle class="ring" cx="${X}" cy="${Y}" r="${R}"/><path d="M${px-R-4} ${Y}h3M${px+R+1} ${Y}h3M${X} ${py-R-4}v3M${X} ${py+R+1}v3"/><circle class="c" cx="${X}" cy="${Y}" r="1.6"/></g>`;return;}
    el.style.left=lx+"px";el.style.top=ly+"px";el.style.transform=dx<0?"translate(calc(-100% - 6px),-50%)":"translate(6px,-50%)";
    el.classList.toggle("hot",i===hoverReg);
    // reticle marker: ring + four ticks + centre dot; the leader line starts at the ring edge
    const hot=i===hoverReg,R=hot?9:6,X=px.toFixed(1),Y=py.toFixed(1),sx=(px+dx*R).toFixed(1),sy=(py+dy*R).toFixed(1);
    svg+=`<g class="mk${hot?" hot":""}"><line x1="${sx}" y1="${sy}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}"/><circle class="ring" cx="${X}" cy="${Y}" r="${R}"/>`
      +`<path d="M${px-R-4} ${Y}h3M${px+R+1} ${Y}h3M${X} ${py-R-4}v3M${X} ${py+R+1}v3"/><circle class="c" cx="${X}" cy="${Y}" r="1.6"/></g>`;});
  // connector labels: a left and a right column beside the cord, spaced so they never overlap, with leader lines to the nodes
  const BP=body?body.P:[],nodes=[];
  CONNECTORS.forEach((c,k)=>{const i=conIdx[k],el=clabels[k];if(i===undefined)return;v3.set(BP[i*3],BP[i*3+1],BP[i*3+2]).project(camera);
    const show=v3.z<1&&cam.r>1.2&&grown(i);el.style.display=show?"":"none";el.classList.toggle("hot",k===hoverCon);
    if(show)nodes.push({k,el,sx:(v3.x+1)/2*W,sy:(1-v3.y)/2*H});});
  if(nodes.length){
    // split into a left and a right column around the body's axis
    v3.set(0,-1.5,SPZ(-1.5)).project(camera);const ax=(v3.x+1)/2*W;
    for(const left of [true,false]){const grp=nodes.filter(n=>(n.sx<ax)===left);if(!grp.length)continue;
      let colX=left?Math.min(...grp.map(n=>n.sx))-46:Math.max(...grp.map(n=>n.sx))+46;
      // never slide under an open module panel on the right
      if(!left&&open.size){let ovL=1e9;open.forEach(el=>{ovL=Math.min(ovL,el.offsetLeft);});colX=Math.max(ax+40,Math.min(colX,ovL-185));}
      stackColumn(grp,38,H-60);   // spaced, and kept on screen without stacking
      for(const n of grp){const y=n.y;
        n.el.classList.toggle("l",left);n.el.classList.toggle("r",!left);n.el.style.left=colX+"px";n.el.style.top=y+"px";
        const ex=left?colX+4:colX-4;
        svg+=`<g class="mk${n.k===hoverCon?" hot":""}"><line x1="${n.sx.toFixed(1)}" y1="${n.sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${y.toFixed(1)}"/></g>`;}}
  }
  leadEl.innerHTML=svg;
}

/* ---------- loop ---------- */
// The loop only runs while something moves. When a frame changes nothing it stops;
// any input, timer callback or tab switch starts it again (wake). Saves CPU and GPU when idle.
let last=performance.now(),rafId=0,idleFrames=0;
function wake(){idleFrames=0;if(!rafId&&!document.hidden){last=performance.now();rafId=requestAnimationFrame(frame);}}
for(const ev of ["pointerdown","pointermove","pointerup","wheel","keydown","input","change","click","dragover","drop","focus"])addEventListener(ev,wake,{capture:true,passive:true});
addEventListener("resize",wake);document.addEventListener("visibilitychange",wake);
function frame(now){
  rafId=0;
  const dt=Math.max(0,Math.min(.05,(now-last)/1000));last=now;   // rAF time can lie before the first performance.now()
  const autoRot=!st.reduce&&!st.power&&!document.body.classList.contains("focus")&&now-lastInteract>4000;
  if(autoRot&&st.turn){goal.th+=dt*.04*st.speed;dirty=true;}
  const e=ease(dt);
  const before=cam.r+cam.th+cam.ph+cam.target.x+cam.target.y+cam.target.z;
  cam.th+=(goal.th-cam.th)*e;cam.ph+=(goal.ph-cam.ph)*e;cam.r+=(goal.r-cam.r)*e;cam.target.lerp(goal.target,e);
  if(Math.abs(before-(cam.r+cam.th+cam.ph+cam.target.x+cam.target.y+cam.target.z))>1e-5)dirty=true;
  let changed=false;
  for(let i=0;i<act.length;i++){if(act[i]>0){act[i]=Math.max(0,act[i]-dt*.45);changed=true;}}
  if(changed){paint();dirty=true;}
  // fx paths
  let n=0;
  for(let p=paths.length-1;p>=0;p--){const P=paths[p];P.t+=dt*.9;if(P.t>1.25){paths.splice(p,1);continue;}
    for(let j=0;j<6&&n<FXN;j++){const tt=Math.min(1,Math.max(0,P.t-j*.035));const q=P.c.getPoint(tt);fxPos[n*3]=q.x;fxPos[n*3+1]=q.y;fxPos[n*3+2]=q.z;const b=(1-j/6)*(P.t>1?Math.max(0,1.25-P.t)*4:1);if(st.theme==="color"){const ca=RC[P.a],cb=RC[P.b];for(let q=0;q<3;q++)fxCol[n*3+q]=b*Math.min(1,(ca[q]+(cb[q]-ca[q])*tt)*.7+.3);}else{fxCol[n*3]=b;fxCol[n*3+1]=b;fxCol[n*3+2]=b*1.04;}fxSize[n]=5-j*.5;n++;}}
  for(let k=n;k<FXN;k++){fxCol[k*3]=fxCol[k*3+1]=fxCol[k*3+2]=0;}
  if(n>0||paths.length===0){fxGeo.attributes.position.needsUpdate=true;fxGeo.attributes.aColor.needsUpdate=true;fxGeo.attributes.aSize.needsUpdate=true;}
  if(n>0)dirty=true;
  // growth: on load the cord and all nerves grow out; a newly added connector's nerve grows on its own
  for(const [u,tg] of [[growAll,growAllTarget],[growNew,growNewTarget]]){const df=tg-u.value;if(Math.abs(df)>.002){u.value=st.reduce?tg:u.value+Math.sign(df)*Math.min(Math.abs(df),Math.max(1.4,Math.abs(df)*1.2)*dt);dirty=true;}}
  // library growth: brain size and density follow the linked file count
  {const g=libGoal();if(Math.abs(g.s-libCur.s)+Math.abs(g.den-libCur.den)>.0005){const k=st.reduce?1:Math.min(1,dt*2.5);libCur.s+=(g.s-libCur.s)*k;libCur.den+=(g.den-libCur.den)*k;applyLib();paint();dirty=true;}}
  // labels still gliding to their place
  if(!st.reduce&&regLP.some(q=>q&&Math.abs(q.tx-q.x)+Math.abs(q.ty-q.y)>.5))dirty=true;
  // shift the brain left while overlays are open on the right, so it is never covered
  const wantShift=(typeof open!=="undefined"&&open.size>0&&innerWidth>700)?Math.min(220,innerWidth*.16):0;
  if(Math.abs(wantShift-shiftCur)>.5){shiftCur+=(wantShift-shiftCur)*e;if(renderer){camera.setViewOffset(innerWidth,innerHeight,shiftCur,0,innerWidth,innerHeight);}dirty=true;}
  if(hoverPending&&!drag)doHover();
  extStep();
  const busy=dirty||hoverPending;
  if(dirty&&renderer&&!document.hidden){applyCam();renderer.render(scene,camera);placeLabels();updView();dirty=false;}
  idleFrames=busy?0:idleFrames+1;
  if(idleFrames<10&&!document.hidden)rafId=requestAnimationFrame(frame);
}
wake();
const viewEl=document.getElementById("st-view");
function updView(){viewEl.textContent=cam.r<1.25?t("inside"):t("outside");}

/* ---------- demo events ---------- */
let evIdx=0,lastReg=-1;
function fire(){
  if(isLive())return;                                                  // real Claude Code events replace the demo
  if(st.paused||document.body.classList.contains("focus"))return;
  const E={...EVENTS[evIdx%EVENTS.length]};evIdx++;
  E.s=E.s||(evIdx%3===0?"NEURAL OS":"Roblox Game");
  if(sessState[E.s]==="off")return;                                   // excluded session: not recorded
  const r=REG.indexOf(E.r);
  if(sessState[E.s]!=="mute"&&r>=0){act[r]=1;addPath(lastReg,r);lastReg=r;paint();dirty=true;}   // muted: recorded, not animated
  const d=new Date();log.unshift({time:d.toTimeString().slice(0,8),...E});if(log.length>40)log.pop();
  onEvent(E);
  if(actTab==="live")refreshOv("activity");if(!document.activeElement||document.activeElement.id!=="libslider")refreshOv("overview");   // never re-render under a dragged slider
}
setInterval(fire,2600);setTimeout(fire,700);

/* ---------- overlays ---------- */
const DOCK=BASE_DOCK.slice();   // icons, titles and order: ui/dock.js
const dock=document.getElementById("dock");
function renderDock(){dock.innerHTML=DOCK.map(m=>m==="|"?"<hr>":`<button type="button" data-m="${m}" aria-label="${esc(t(MODT[m]))}"><svg viewBox="0 0 16 16">${ICON[m]}</svg><span class="lbl">${esc(t(MODT[m]))}</span></button>`).join("");markDock();}
dock.addEventListener("click",e=>{const b=e.target.closest("button[data-m]");if(!b)return;const m=b.dataset.m;if(open.has(m))closeOv(m);else openOv(m);});
function markDock(){dock.querySelectorAll("button[data-m]").forEach(b=>b.classList.toggle("on",open.has(b.dataset.m)));}

const pill=s=>`<span class="pill ${s}">${esc(t(s==="ok"?"ready":s==="warn"?"signin":"missing"))}</span>`;
function evText(E){return `${esc(t(E.k==="mcp"?"e_mcp":"e_"+E.k))} <span class="mono">${esc(E.f?nm(E.x,"f"):E.x)}</span>`;}
let curNote=1;
const tf=(k,o)=>t(k).replace(/\{(\w+)\}/g,(_,a)=>o[a]);
const REGN=r=>r.charAt(0).toUpperCase()+r.slice(1);
const hb=(l,v,max,txt)=>`<div class="hb"><span class="l">${l}</span><div class="bar"><i style="width:${max?Math.round(v/max*100):0}%"></i></div><span class="v">${txt??v}</span></div>`;
const evPlain=E=>t(E.k==="mcp"?"e_mcp":"e_"+E.k)+" "+(E.f?nm(E.x,"f"):E.x);
const evRow=E=>`<div class="evc" data-reg="${E.r}" title="${esc(E.time+" · "+evPlain(E))}"><span class="t">${E.time}</span><span class="d">${evText(E)}</span><span class="r">${E.r}</span></div>`;
let actFilter="all",cmpMode="proj",cmpA="Roblox Game",cmpB="NEURAL OS";
// demo graph data per project; file counts add up to the demo library (18,412)
const sharedN=(a,b)=>a===b?"—":String(SHARED[[a,b].sort().join("|")]||0);
const evoLog=[];   // change-log entries made in this session (connector added/removed)
const stamp=()=>{const d=new Date();return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${d.toTimeString().slice(0,5)}`;};
const spark=arr=>{const mx=Math.max(1,...arr),d="M"+arr.map((v,i)=>(i/(arr.length-1)*100).toFixed(1)+" "+(32-v/mx*30).toFixed(1)).join(" L");
  return `<svg viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"><path class="ar" d="${d} L100 34 L0 34Z"/><path class="ln" d="${d}" vector-effect="non-scaling-stroke"/></svg>`;};
const BODY={
 overview:()=>{const ok=CONNECTORS.filter(c=>c.s==="ok").length,att=CONNECTORS.filter(c=>c.s!=="ok");
   const cnt=REG.map(r=>log.filter(E=>E.r===r).length),mx=Math.max(1,...cnt);
   return `<div class="sec">${t("glance")}</div><div class="tiles">
   <div class="tile"><b>2</b><span>${t("tl_sess")}</span></div>
   <div class="tile"><b>${log.length}</b><span>${t("tl_events")}</span></div>
   <div class="tile"><b>${ok}<small> / ${CONNECTORS.length}</small></b><span>${t("tl_cons")}</span></div>
   <div class="tile"><b id="lib-t">${fmtN(libN)}</b><span>${t("tl_files")}</span></div></div>
   <div class="sec">${t("attn")}</div><div class="list">${att.length?att.map(c=>`<div class="row"><span class="n">${esc(c.n)}</span>${pill(c.s)}<button class="btn" type="button" data-open="connectors">${t("open")}</button></div>`).join(""):`<p class="hint" style="margin:0">${t("attnNone")}</p>`}</div>
   <div class="sec">${t("activeSess")}</div><div class="list">
   <div class="row"><span class="n">${esc(nm("Roblox Game","p"))}</span><span class="m">claude-opus · 42 min</span></div>
   <div class="row"><span class="n">${esc(nm("NEURAL OS","p"))}</span><span class="m">claude-sonnet · 8 min</span></div></div>
   <div class="sec">${t("regAct")}</div>${REG.map((r,i)=>[r,cnt[i]]).sort((a,b)=>b[1]-a[1]).map(([r,v])=>hb(REGN(r),v,mx)).join("")}<p class="hint" style="margin-top:6px">${t("regActHint")}</p>
   <div class="sec">${t("recent")}</div><div class="list">${log.slice(0,3).map(evRow).join("")||`<p class="hint" style="margin:0">${t("noEv")}</p>`}</div>
   <div class="sec">${t("library")}</div><div class="kv"><span>${t("libFiles")}</span><span id="lib-n">${fmtN(libN)}</span><span>${t("libSize")}</span><span id="lib-gb">${libSize(libN)}</span><span>${t("libLinked")}</span><span>1</span><span>${t("readyRule")}</span><span>${t("installed")} v1</span></div>
   <p class="hint">${t("libGrow")}</p>
   <label class="hint" style="display:block;margin-top:6px">${t("libDemo")} <span class="tag">${t("demo")}</span><input type="range" id="libslider" min="0" max="100" step="1" value="${Math.round(libF(libN)*100)}" style="width:100%;margin-top:6px"></label>
   <p class="hint"><span class="tag">${t("demo")}</span></p>`;},
 memory:()=>{const f=FILES[curNote];return `<div class="sec">${t("filesList")}</div><div class="list">${FILES.map((F,i)=>`<div class="row" data-note="${i}" tabindex="0" style="cursor:pointer${i===curNote?";background:rgba(231,234,238,.06)":""}"><span class="n">${esc(nm(F.n,"f"))}</span><span class="m">${esc(F.s)}</span>${F.i?"":`<span class="pill mute">${t("nameOnly")}</span>`}</div>`).join("")}</div>
   <div class="sec">${esc(nm(f.n,"f"))} · ${esc(nm(f.p,"p"))}</div>
   <div class="note"><h3>Map-Ideen</h3>Lobby mit drei Portalen, siehe <span class="wl">[[GameLoop]]</span> und <span class="wl">[[Monetization]]</span>.
   <div class="callout"><b>Note</b> · Spawn-Punkte nach jedem Update in <span class="wl">[[Lobby.rbxl]]</span> prüfen.</div>
   #roblox #design</div>
   <div class="sec">${t("claudeTrace")}</div><div class="list"><div class="row"><span class="n">${t("e_Read")}</span><span class="m">14:02 · ${esc(nm("Roblox Game","p"))}</span></div><div class="row"><span class="n">${t("e_Edit")}</span><span class="m">${lang==="de"?"gestern":"yesterday"} 21:40</span></div></div>
   <div class="sec">${t("backlinks")}</div><div class="list"><div class="row"><span class="n">${esc(nm("Daily 2026-11-16.md","f"))}</span></div></div>
   <div class="btns"><button class="btn" type="button" data-act="focus">${t("focusMode")}</button></div>`;},
 graph:()=>{const P=Object.keys(PROJ),sum=k=>P.reduce((s,p)=>s+PROJ[p][k],0);
   const types=[[t("mNotes"),sum("notes")],[t("mFiles"),sum("files")],[t("cmpProj"),P.length],[t("mSess"),sum("sess")]],tm=Math.max(...types.map(x=>x[1]));
   const line=(l,a,b,extra)=>{const m=Math.max(a,b,1);return `<div class="a">${fmtN(a)}<div class="bar"><i style="width:${a/m*100}%"></i></div></div><div class="lbl">${l}${extra||""}</div><div class="b"><div class="bar"><i style="width:${b/m*100}%"></i></div>${fmtN(b)}</div>`;};
   let cmp;
   if(cmpMode==="proj"){const A=PROJ[cmpA],B=PROJ[cmpB],opt=sel=>P.map(p=>`<option value="${esc(p)}"${p===sel?" selected":""}>${esc(nm(p,"p"))}</option>`).join("");
     cmp=`<div class="cmpsel"><select data-cmp="a" aria-label="A">${opt(cmpA)}</select><span>${t("vs")}</span><select data-cmp="b" aria-label="B">${opt(cmpB)}</select></div>
     <div class="cmp">${[["mNotes","notes"],["mFiles","files"],["mLinks","links"],["mSess","sess"]].map(([l,k])=>line(t(l),A[k],B[k])).join("")}</div>
     <div class="kv" style="margin-top:8px"><span>${t("mShared")}</span><span>${sharedN(cmpA,cmpB)}</span></div><p class="hint" style="margin-top:6px">${t("cmpHint")}</p>`;}
   else{const nN=sum("notes")+sum("files")+P.length+sum("sess"),nL=sum("links"),rows=[["mNodes",Math.round(nN*.86),nN],["mLinks",Math.round(nL*.78),nL],["mClusters",9,12]];
     cmp=`<div class="cmp" style="margin-top:10px"><div class="hd a">${t("then30")}</div><div></div><div class="hd">${t("now")}</div>
     ${rows.map(([l,a,b])=>line(t(l),a,b,`<br><span class="delta">+${Math.round((b/a-1)*100)} %</span>`)).join("")}</div>
     <div class="kv" style="margin-top:8px"><span>${t("topGrow")}</span><span>${esc(nm("Roblox Game","p"))} · Lobby</span></div>`;}
   return `<p class="hint" style="margin-top:0">${t("graphTxt")}</p>
   <div class="sec">${t("byType")}</div>${types.map(([l,v])=>hb(l,v,tm,fmtN(v))).join("")}
   <div class="sec">${t("compare")}</div><span class="seg"><button type="button" data-cmpm="proj" class="${cmpMode==="proj"?"on":""}">${t("cmpProj")}</button><button type="button" data-cmpm="time" class="${cmpMode==="time"?"on":""}">${t("cmpTime")}</button></span>
   ${cmp}
   <div class="sec">${t("timeSlider")}</div><input type="range" id="tslider" min="0" max="100" value="100" style="width:100%">
   <div class="btns"><button class="btn" type="button" data-act="showMem">${t("showInBrain")}</button></div>
   <p class="hint"><span class="tag">${t("demo")}</span> · ${t("regionOther")}</p>`;},
 projects:()=>`<div class="sec">${t("cockpit")} · ${esc(nm("Roblox Game","p"))}</div><div class="kv"><span>${t("libFiles")}</span><span>17,980</span><span>${t("sessionsN")}</span><span>24</span><span>${t("git")}</span><span>${t("cleanTree")}</span></div>
   <div class="sec">${t("m_connectors")}</div><div class="list"><div class="row"><span class="n">GitHub</span>${pill("ok")}</div><div class="row"><span class="n">Obsidian Vault</span>${pill("ok")}</div></div>
   <div class="sec">${esc(nm("NEURAL OS","p"))}</div><div class="kv"><span>${t("libFiles")}</span><span>12</span><span>${t("sessionsN")}</span><span>3</span></div>`,
 activity:()=>{const cnt={};log.forEach(E=>cnt[E.r]=(cnt[E.r]||0)+1);
   const L=actFilter==="all"?log:log.filter(E=>E.r===actFilter);
   let rows="",lastMin="";for(const E of L){const m=E.time.slice(0,5);if(m!==lastMin){rows+=`<div class="evmin">${m}</div>`;lastMin=m;}rows+=evRow(E);}
   return `<div class="sec">${t("timeline")} · ${tf("evCount",{n:L.length})}</div>
   <div class="chips"><button type="button" class="chip${actFilter==="all"?" on":""}" data-flt="all">${t("all")}<em>${log.length}</em></button>${REG.filter(r=>cnt[r]).map(r=>`<button type="button" class="chip${actFilter===r?" on":""}" data-flt="${r}">${REGN(r)}<em>${cnt[r]}</em></button>`).join("")}</div>
   <div class="list" style="gap:0">${rows||`<p class="hint" style="margin:0">${t("noEv")}</p>`}</div>
   <p class="hint">${t("actHint")}</p><p class="hint" style="margin-top:4px"><span class="tag">${t("demo")}</span> · ${t("demoNote")}</p>`;},
 workflows:()=>`<p class="hint" style="margin-top:0">${t("wfTxt")}</p><div class="list"><div class="row"><span class="n">roblox-vfx</span><span class="m">6×</span></div><div class="row"><span class="n">code-review</span><span class="m">2×</span></div></div>`,
 planning:()=>`<p class="hint" style="margin-top:0">${t("planTxt")}</p><div class="list"><div class="row"><span class="pill ok">✓</span><span class="n">Spawn system refactor</span></div><div class="row"><span class="pill warn">…</span><span class="n">Lobby portals</span></div><div class="row"><span class="pill mute">○</span><span class="n">Playtest checklist</span></div></div>`,
 connectors:()=>{const by=s=>CONNECTORS.filter(c=>c.s===s).map(c=>c.n).join(",");
   return `<div class="list">${CONNECTORS.map((c,k)=>`<div class="row" data-con="${k}"><span class="m">${String(k+1).padStart(2,"0")}</span><span class="n">${esc(c.n)}</span>${pill(c.s)}</div>`).join("")}</div>
   <p class="hint">${t("bodyTxt")}</p>
   <div class="btns"><button class="btn" type="button" data-act="conAdd"${CONNECTORS.length>=12?" disabled":""}>+ ${t("conAdd")}</button><button class="btn" type="button" data-act="conDel"${CONNECTORS.length<=1?" disabled":""}>− ${t("conDel")}</button></div>
   <div class="sec">${t("lastCheck")} · 14:01</div><div class="readiness">READINESS: ready=${esc(by("ok"))} missing=${esc(by("bad"))} needs_signin=${esc(by("warn"))} failed=</div><p class="hint"><span class="tag">${t("demo")}</span></p>`;},
 models:()=>`<p class="hint" style="margin-top:0">${t("modelTxt")}</p><div class="kv"><span>${t("model")}</span><span>claude-opus</span><span>${t("sub")}</span><span>Explore · done</span></div>`,
 evolution:()=>{const n=CONNECTORS.length,fs=[0,.03,.09,.2,.36,.55,.8,1].map(f=>f*libN),cs=[0,1,1,2,3,3,4,n].map(v=>Math.min(v,n));
   const base=[{ty:"version",txt:t("ev_install"),d:"16.11 09:12"},{ty:"hooks",txt:t("ev_hooks"),d:"16.11 09:14"},{ty:"rule",txt:t("ev_rule"),d:"16.11 09:15"},{ty:"index",txt:tf("ev_index",{n:fmtN(libN)}),d:"16.11 11:40"},
     ...CONNECTORS.filter(c=>c.s==="bad").map(c=>({ty:"connector",txt:tf("ev_missing",{x:c.n}),d:"16.11 14:01"}))].reverse();
   return `<div class="callout2"><b>${t("evoWhat")}</b><br>${t("evoTxt")}</div><p class="hint" style="margin-top:8px">${t("evoNot")}</p>
   <div class="sec">${t("evoGrowth")} · ${t("evoWeeks")}</div>
   <div class="spark">${spark(fs)}<b>${fmtN(libN)}</b><span>${t("tl_files")}</span></div>
   <div class="spark">${spark(cs)}<b>${n}</b><span>${t("m_connectors")}</span></div>
   <div class="sec">${t("evoLog")}</div><div class="list">${[...evoLog,...base].map(e=>`<div class="lg"><span class="typ">${t("ty_"+e.ty)}</span><span class="m">${e.d}</span><span class="x">${esc(e.txt)}</span></div>`).join("")}</div>
   <p class="hint"><span class="tag">${t("demo")}</span></p>`;},
 security:()=>`<p class="hint" style="margin-top:0">${t("secTxt")}</p><div class="list"><div class="row"><span class="n">${t("hooks")}</span><span class="m">~/.claude/settings.json</span><button class="btn" type="button">${t("undo")}</button></div><div class="row"><span class="n">${t("rule")}</span><span class="m">~/.claude/CLAUDE.md</span><button class="btn" type="button">${t("undo")}</button></div></div>`,
 settings:()=>`<div class="set"><span>${t("lang")}</span><span class="seg"><button type="button" data-lang="de" class="${lang==="de"?"on":""}">Deutsch</button><button type="button" data-lang="en" class="${lang==="en"?"on":""}">English</button></span></div>
   ${[["privacy","privacyD"],["reduce","motionD"],["power","powerD"]].map(([k,d])=>`<div class="set"><span>${t(k==="reduce"?"motion":k)}<small>${t(d)}</small></span><span class="seg"><button type="button" data-tog="${k}" data-v="1" class="${st[k]?"on":""}">${t("on")}</button><button type="button" data-tog="${k}" data-v="0" class="${st[k]?"":"on"}">${t("off")}</button></span></div>`).join("")}`
};
// demo only: add or remove a connector to see its nerve grow out of the cord; real connectors come from the readiness check
function setConnectors(d){
  if(d>0&&CONNECTORS.length<12){const used=new Set(CONNECTORS.map(c=>c.n));const nx=DEMO_POOL.find(c=>!used.has(c.n));if(!nx)return;CONNECTORS.push({...nx});evoLog.unshift({ty:"connector",txt:tf("conAdded",{x:nx.n}),d:stamp()});}
  else if(d<0&&CONNECTORS.length>1){const rm=CONNECTORS.pop();evoLog.unshift({ty:"connector",txt:tf("conRemoved",{x:rm.n}),d:stamp()});}
  else return;
  refreshOv("evolution");refreshOv("overview");
  hoverCon=-1;newNerve=d>0?CONNECTORS.length-1:-1;   // the new nerve grows out of the cord
  buildBody();renderCLabels();frameBody();goal.r=DEF.r;goal.target.y=DEF.ty;lastInteract=performance.now();
  if(open.has("connectors"))fill("connectors");dirty=true;
}
/* ---------- module windows: management in ui/overlays.js, module actions here ---------- */
const ovRoot=document.getElementById("overlays");
function wireOv(el,m){
  // demo only: slider position 0..100 maps logarithmically to 0..100,000 linked files
  el.addEventListener("input",e=>{if(e.target.id==="libslider")setLib(Math.pow(10,+e.target.value/20)-1);});
  el.addEventListener("change",e=>{const s=e.target.closest("select[data-cmp]");if(s){if(s.dataset.cmp==="a")cmpA=s.value;else cmpB=s.value;fill("graph");}});
  el.addEventListener("click",e=>{if(e.target.closest("[data-c]"))return;
    const nt=e.target.closest("[data-note]");if(nt){curNote=+nt.dataset.note;fill("memory");return;}
    const fl=e.target.closest("[data-flt]");if(fl){actFilter=fl.dataset.flt;fill("activity");return;}
    const op=e.target.closest("[data-open]");if(op){openOv(op.dataset.open);return;}
    const cm=e.target.closest("[data-cmpm]");if(cm){cmpMode=cm.dataset.cmpm;fill("graph");return;}
    const rg=e.target.closest("[data-reg]");if(rg){const r=REG.indexOf(rg.dataset.reg);if(r>=0){act[r]=1;paint();dirty=true;}return;}
    const a=e.target.closest("[data-act]");if(a&&a.dataset.act==="focus"){enterFocus();return;}
    if(a&&a.dataset.act==="showMem"){act[0]=1;paint();dirty=true;return;}
    if(a&&(a.dataset.act==="conAdd"||a.dataset.act==="conDel")){setConnectors(a.dataset.act==="conAdd"?1:-1);return;}
    const L=e.target.closest("[data-lang]");if(L){setLang(L.dataset.lang);return;}
    const g=e.target.closest("[data-tog]");if(g){st[g.dataset.tog]=g.dataset.v==="1";if(g.dataset.tog==="privacy"){privMap.clear();refreshAll();}fill("settings");dirty=true;}});
}
const OV=createOverlays({root:ovRoot,leftSide:["files"],max:4,codeOf:m=>String(Math.max(0,DOCK.filter(d=>d!=="|").indexOf(m))+1).padStart(2,"0"),
  titleOf:m=>t(MODT[m]),bodyOf:m=>BODY[m](),onChange:()=>{markDock();if(!open.has("rnode"))setFocus(false);},onCreate:wireOv,onFill:(b,m)=>{hydrate(b,m);if(m==="rnode"&&pendingHead&&scrollToHead(b,pendingHead))pendingHead=null;}});
const open=OV.open,openOv=OV.openOv,fill=OV.fill,refreshOv=OV.refresh,refreshAll=OV.refreshAll,closeOv=OV.close;

/* ---------- focus mode ---------- */
const focusEl=document.getElementById("focus"),ta=document.getElementById("focus-ta");
function enterFocus(){document.body.classList.add("focus");focusEl.hidden=false;document.getElementById("focus-path").textContent=nm("Roblox Game","p")+" / "+nm("Map-Ideen.md","f");ta.value=NOTE;ta.focus();}
function exitFocus(){document.body.classList.remove("focus");focusEl.hidden=true;dirty=true;}
document.getElementById("focus-close").addEventListener("click",exitFocus);

/* ---------- palette ---------- */
const pal=document.getElementById("pal"),pin=document.getElementById("pal-in"),pres=document.getElementById("pal-res");let pItems=[],pSel=0;
function palItems(){const mods=Object.keys(MODT).map(m=>({label:t(MODT[m]),kind:"module",run:()=>openOv(m)}));
  const notes=FILES.map((F,i)=>({label:nm(F.n,"f"),kind:"note",run:()=>{curNote=i;openOv("memory");fill("memory");}}));
  const acts=[{label:t("reset"),kind:"action",run:resetView},{label:t("focusMode"),kind:"action",run:enterFocus},{label:t("privacy"),kind:"action",run:()=>{st.privacy=!st.privacy;privMap.clear();refreshAll();}},{label:lang==="de"?"Language: English":"Sprache: Deutsch",kind:"action",run:()=>setLang(lang==="de"?"en":"de")}];
  return mods.concat(notes,acts);}
function renderPal(){const q=pin.value.toLowerCase();pItems=palItems().filter(x=>x.label.toLowerCase().includes(q)).slice(0,12);pSel=Math.min(pSel,Math.max(0,pItems.length-1));
  pres.innerHTML=pItems.map((x,i)=>`<div class="row${i===pSel?" sel":""}" data-i="${i}"><span class="n">${esc(x.label)}</span><span class="m">${x.kind}</span></div>`).join("");}
function openPal(){pal.hidden=false;pin.placeholder=t("palPh");pin.value="";pSel=0;renderPal();pin.focus();}
function closePal(){pal.hidden=true;}
pin.addEventListener("input",()=>{pSel=0;renderPal();});
pin.addEventListener("keydown",e=>{if(e.key==="ArrowDown"){pSel=Math.min(pItems.length-1,pSel+1);renderPal();e.preventDefault();}else if(e.key==="ArrowUp"){pSel=Math.max(0,pSel-1);renderPal();e.preventDefault();}else if(e.key==="Enter"){const it=pItems[pSel];closePal();if(it)it.run();}});
pres.addEventListener("click",e=>{const r=e.target.closest("[data-i]");if(!r)return;const it=pItems[+r.dataset.i];closePal();if(it)it.run();});
pal.addEventListener("click",e=>{if(e.target===pal)closePal();});

/* ---------- keys ---------- */
addEventListener("keydown",e=>{
  const typing=/INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();pal.hidden?openPal():closePal();return;}
  if(e.key==="Escape"){if(!pal.hidden)closePal();else if(!focusEl.hidden)exitFocus();return;}
  if(typing)return;
  const k=e.key;
  if(k==="r"||k==="R"){resetView();}
  else if(k==="l"||k==="L"){showAll=!showAll;paint();renderLegend();}
  else if(k==="ArrowLeft"){goal.th+=.15;}else if(k==="ArrowRight"){goal.th-=.15;}
  else if(k==="ArrowUp"){goal.ph=Math.max(.15,goal.ph-.12);}else if(k==="ArrowDown"){goal.ph=Math.min(3,goal.ph+.12);}
  else if(k==="+"||k==="="){goal.r=Math.max(.12,goal.r*.85);}else if(k==="-"){goal.r=Math.min(9,goal.r/.85);}
  else return;
  lastInteract=performance.now();dirty=true;
});
document.getElementById("b-reset").addEventListener("click",resetView);
document.getElementById("b-labels").addEventListener("click",()=>{showAll=!showAll;paint();renderLegend();dirty=true;});
const bPause=document.getElementById("b-pause");
bPause.addEventListener("click",()=>{st.paused=!st.paused;renderStatic();});

/* ---------- static text / language ---------- */
function renderStatic(){
  document.documentElement.lang=lang;
  document.querySelectorAll("[data-i]").forEach(el=>{if(el.closest(".res"))return;el.textContent=t(el.dataset.i);});
  {const live=isLive(),badge=document.querySelector(".demo-badge"),dot=document.querySelector("#status .dot");
   // live: Claude activity and library are real, the rest (connectors, models, workflows) is still demo
   if(badge){badge.textContent=t(live?"demoPart":"demo");badge.title=live?t("demoPartTip"):"";}
   if(dot)dot.classList.toggle("off",live&&!(mon.status&&mon.status.receiving));
   document.getElementById("st-sessions").textContent=live?tf("activeN",{n:mon.sessions.filter(s=>isActive(s)).length}):"2 "+t("sessions");}
  document.getElementById("st-conn").textContent="3 "+t("conns");
  document.getElementById("st-lib").textContent=fmtN(libN)+" "+t("files")+" · "+libSize(libN)+" "+t("linked");
  bPause.textContent=st.paused?t("resume"):t("pause");
  updView();renderDock();
}
function setLang(l){lang=l;{const MB=monBridge();if(MB&&MB.setLang)MB.setLang(l);}try{localStorage.setItem("nos-lang",l);}catch(e){}privMap.clear();renderStatic();renderCLabels();refreshAll();dirty=true;}
renderStatic();
/* =====================================================================
   v11 extension: first launch, import, consent diff, conflict view,
   knowledge nodes, note editor, library, context packs, search,
   sessions / history / replay, readiness history, system health,
   security, models tree, projects, settings, orientation, overlay resize.
   All content here is demo data and labeled as such in the UI.
   ===================================================================== */

/* ---------- demo knowledge data ---------- */
const noteText=FX.map(f=>f.md||null),noteVer=FX.map(()=>1);
const baseName=n=>n.replace(/\.[^.]+$/,"");
const fileByName=s=>FILES.findIndex(F=>baseName(F.n)===s||F.n===s);
const linksOf=i=>{const s=noteText[i];if(!s)return [];const out=[];s.replace(/\[\[([^\]|#]+)/g,(m,a)=>{const j=fileByName(a.trim());if(j>=0&&!out.includes(j))out.push(j);});return out;};
const backlinksOf=i=>FILES.map((_,j)=>j).filter(j=>j!==i&&linksOf(j).includes(i));
const noteSrc=i=>noteText[i]||FX[i].txt||FX[i].ocr||"";

/* ---------- knowledge nodes in the brain (Memory region) ---------- */
// node kinds have their own shape, not their own colour: note = dot, file = ring, project = diamond, Claude memory = square
const NODES=[];
FILES.forEach((F,i)=>NODES.push({k:FX[i].k,fi:i,label:F.n,proj:F.p}));
["Personal","Roblox Game","NEURAL OS"].forEach(p=>NODES.push({k:"project",label:p,proj:p}));
CLAUDEMD.forEach((c,j)=>NODES.push({k:"claudemd",cm:j,label:c.label,proj:c.proj}));
const nodeOfFile=i=>NODES.findIndex(n=>n.fi===i);
{const pts=regPts[0].filter(i=>pos[i*3]>0).sort((a,b)=>pos[a*3+2]-pos[b*3+2]);
 const centre={"Personal":.18,"Roblox Game":.5,"NEURAL OS":.82},used=new Map();
 NODES.forEach(n=>{const c=Math.round(centre[n.proj]*(pts.length-1));const k=used.get(n.proj)||0;used.set(n.proj,k+1);
   const off=n.k==="project"?0:[0,-9,9,-17,17,-25,25][k%7]*(n.k==="project"?0:1);const pi=pts[Math.max(0,Math.min(pts.length-1,c+off+(n.k==="project"?0:(k===0?5:0))))];
   n.p=new THREE.Vector3(pos[pi*3]+.05,pos[pi*3+1]+(n.k==="project"?.05:0),pos[pi*3+2]);});}
const nodeGlow=new Float32Array(NODES.length),nodeEdit=new Float32Array(NODES.length);let hoverNodeI=-1;
const ngeo=new THREE.BufferGeometry(),nPos=new Float32Array(NODES.length*3),nCol=new Float32Array(NODES.length*3),nSize=new Float32Array(NODES.length),nShape=new Float32Array(NODES.length);
NODES.forEach((n,i)=>{nPos.set([n.p.x,n.p.y,n.p.z],i*3);nShape[i]={note:0,file:1,project:2,claudemd:3}[n.k];});
ngeo.setAttribute("position",new THREE.BufferAttribute(nPos,3));ngeo.setAttribute("aColor",new THREE.BufferAttribute(nCol,3));ngeo.setAttribute("aSize",new THREE.BufferAttribute(nSize,1));ngeo.setAttribute("aShape",new THREE.BufferAttribute(nShape,1));
const nmat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{uPR:pmat.uniforms.uPR,uK:pmat.uniforms.uK},
 vertexShader:SH.NODES_VS,
 fragmentShader:SH.NODES_FS});
const nodePts=new THREE.Points(ngeo,nmat);brainG.add(nodePts);
// real library files (Phase 2); the demo nodes are hidden as soon as the library has files
const BRC=(()=>{let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];for(let i=0;i<NT;i++){if(reg[i]<0)continue;for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],pos[i*3+k]);mx[k]=Math.max(mx[k],pos[i*3+k]);}}
  return {c:mn.map((v,k)=>(v+mx[k])/2),r:Math.max(mx[0]-mn[0],mx[1]-mn[1])*.42};})();   // brain centre and size, for the cluster ring
// connections: in the colour of the brain region they start/end in (Memory cyan, Workflows green, …), or like the files
const realColorOf=n=>st.theme!=="color"?null:(n.kind==="project"||n.kind==="cluster")?(st.colorBy==="project"?groupColor(n.project,"project"):null):groupColor(groupOf(n.row,st.colorBy),st.colorBy);
const REAL=createRealLayer(THREE,{parent:brainG,material:nmat,regionPts:regPts[0],allPts:regPts.flat(),pos,
  lineColorOf:n=>st.theme!=="color"?null:st.linkColor==="region"&&n.pt!==undefined&&reg[n.pt]>=0?RC[reg[n.pt]]:((n.kind==="project"||n.kind==="cluster")?(st.colorBy==="project"?groupColor(n.project,"project"):null):groupColor(groupOf(n.row,st.colorBy),st.colorBy)),center:BRC.c,radius:BRC.r,keyOf:r=>groupOf(r,st.colorBy),colorOf:realColorOf});REAL.setBright(st.bright);let curReal=-1;
// imported brains (.brain files): smaller copies beside mine, glowing threads to matching notes (foreign.js)
const silShade=new Float32Array(geo.attributes.position.count);for(let i=0;i<NT;i++)silShade[i]=reg[i]===-2?0:baseShade(i);
const FB=createForeignBrains(THREE,{scene,brainG,sil:{geo,material:pmat,shade:silShade},nodeMaterial:nmat,regionPts:regPts[0],allPts:regPts.flat(),pos,center:BRC.c,radius:BRC.r,camera,REAL,myColor:n=>n&&realColorOf(n)});
let curB=null;
// graph edges: explicit wikilinks between notes and files, plus each item to its project
const eArr=[];NODES.forEach((n,i)=>{if(n.fi!==undefined){linksOf(n.fi).forEach(j=>{const b=nodeOfFile(j);eArr.push(n.p,NODES[b].p);});}
  if(n.k!=="project"){const pj=NODES.findIndex(m=>m.k==="project"&&m.label===n.proj);if(pj>=0)eArr.push(n.p,NODES[pj].p);}});
const egeo=new THREE.BufferGeometry().setFromPoints(eArr);
const nodeEdges=new THREE.LineSegments(egeo,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.28,blending:THREE.AdditiveBlending,depthWrite:false}));brainG.add(nodeEdges);
function paintNodes(){NODES.forEach((n,i)=>{const g=Math.max(nodeGlow[i],i===hoverNodeI?.8:0,(n.fi===curNote&&open.has("memory"))?.55:0);const b=.62+.38*g;if(st.theme==="color"){const c=nameColor(n.proj||n.label),w=.35+.65*(1-g);nCol.set(c.map(v=>Math.min(1,v*b*w+b*(1-w))),i*3);}else nCol.set([b*.95,b,Math.min(1,b*1.05)],i*3);
  nSize[i]=({note:7,file:7.5,project:10,claudemd:8})[n.k]*(1+.35*g+1.2*nodeEdit[i]);});ngeo.attributes.aColor.needsUpdate=true;ngeo.attributes.aSize.needsUpdate=true;}
paintNodes();
const nray=new THREE.Raycaster();nray.params.Points.threshold=.06;
function pickNode(x,y){if(!nodePts.visible)return -1;nray.setFromCamera(new THREE.Vector2(x/innerWidth*2-1,-(y/innerHeight)*2+1),camera);const h=nray.intersectObject(nodePts);return h.length?h[0].index:-1;}
function flyTo(n){if(n<0)return;goal.target.copy(NODES[n].p).applyMatrix4(brainG.matrixWorld);goal.r=Math.min(goal.r,1.7);nodeGlow[n]=1;lastInteract=performance.now();dirty=true;}
const nodeName=n=>n.k==="project"?nm(n.label,"p"):n.k==="claudemd"?n.label+" · "+nm(n.proj,"p"):nm(n.label,"f");
const excerptOf=n=>{if(st.privacy||n.fi===undefined)return "";const s=noteSrc(n.fi);const l=s.split("\n").find(x=>x.trim()&&!/^#/.test(x))||"";return l.replace(/\[\[|\]\]/g,"").replace(/^- (\[.\] )?/,"").slice(0,90);};
let curNode=0;
const _doHover=doHover;
doHover=function(){const fh=FB.brains.length?FB.pick(new THREE.Vector2(mouse.x/innerWidth*2-1,-(mouse.y/innerHeight)*2+1)):null;
  if(fh){hoverPending=false;if(FB.setHover(fh))dirty=true;if(REAL.setHover(-1))dirty=true;const N=fh.node;
    tip.innerHTML=(N.kind==="cluster"?`<b>${esc(N.key||t("noProject"))}</b>${esc(tf("clusterN",{n:N.count.toLocaleString()}))}`:N.kind==="project"?`<b>${esc(N.project||t("noProject"))}</b>${esc(t("k_project"))}`:`<b>${esc(N.row.name)}</b>${esc(t("k_"+N.kind))} · ${esc((N.row.ext||"—").toUpperCase())} · ${fmtB(N.row.size)}`)+`<small>${esc(tf("bTip",{b:fh.brain.name}))}</small>`;
    tip.style.left=Math.min(mouse.x+16,innerWidth-275)+"px";tip.style.top=(mouse.y+16)+"px";tip.classList.add("show");canvas.style.cursor="pointer";dirty=true;return;}
  if(FB.brains.length&&FB.setHover(null))dirty=true;
  const rn=REAL.pick(camera,new THREE.Vector2(mouse.x/innerWidth*2-1,-(mouse.y/innerHeight)*2+1));
  if(rn>=0){hoverPending=false;if(REAL.setHover(rn))dirty=true;if(hoverReg!==-1||hoverCon!==-1){hoverReg=-1;hoverCon=-1;paint();}
    const N=REAL.nodes[rn];tip.innerHTML=N.kind==="cluster"?`<b>${esc(nm(N.key||t("noProject"),"p"))}</b>${esc(tf("clusterN",{n:N.count.toLocaleString()}))}<small>${esc(t("clusterOpenTip"))}</small>`:N.kind==="project"?`<b>${esc(nm(N.project,"p"))}</b>${esc(t("k_project"))}<small>${esc(t("realFile"))}</small>`
      :`<b>${esc(nm(N.row.name,"f"))}</b>${esc(t("k_"+N.kind))} · ${esc((N.row.ext||"—").toUpperCase())} · ${fmtB(N.row.size)}${N.row.project?" · "+esc(nm(N.row.project,"p")):""}<small>${esc(t("clickOpen"))}</small>`;
    tip.style.left=Math.min(mouse.x+16,innerWidth-275)+"px";tip.style.top=(mouse.y+16)+"px";tip.classList.add("show");canvas.style.cursor="pointer";dirty=true;return;}
  if(REAL.setHover(-1))dirty=true;
  const n=pickNode(mouse.x,mouse.y);
  if(n>=0){hoverPending=false;if(hoverNodeI!==n){hoverNodeI=n;paintNodes();}if(hoverReg!==-1||hoverCon!==-1){hoverReg=-1;hoverCon=-1;paint();}
    const N=NODES[n],ex=excerptOf(N);tip.innerHTML=`<b>${esc(nodeName(N))}</b>${esc(t("k_"+N.k))}${N.fi!==undefined?" · "+esc(FX[N.fi].ty.toUpperCase())+" · "+esc(FILES[N.fi].s):""}${ex?`<br><span style="color:var(--chrome)">${esc(ex)}</span>`:""}<small>${esc(t("clickOpen"))}</small>`;
    tip.style.left=Math.min(mouse.x+16,innerWidth-275)+"px";tip.style.top=(mouse.y+16)+"px";tip.classList.add("show");canvas.style.cursor="pointer";dirty=true;return;}
  if(hoverNodeI>=0){hoverNodeI=-1;paintNodes();dirty=true;}
  _doHover();};
const _clickAt=clickAt;
clickAt=function(x,y){const fh=FB.brains.length?FB.pick(new THREE.Vector2(x/innerWidth*2-1,-(y/innerHeight)*2+1)):null;if(fh){openForeign(fh);return;}const rn=REAL.pick(camera,new THREE.Vector2(x/innerWidth*2-1,-(y/innerHeight)*2+1));if(rn>=0){openReal(rn);return;}const n=pickNode(x,y);if(n>=0){openNode(n);return;}_clickAt(x,y);};
function openReal(i){const C=REAL.nodes[i];if(C&&C.kind==="cluster"){REAL.setOpen(C.key,true);applyFormFade&&applyFormFade();REAL.setLinks(st.links);i=REAL.nodes.findIndex(n=>n.kind==="project"&&n.project===C.key);if(i<0)i=REAL.nodes.findIndex(n=>n.row&&(n.row.project||"")===C.key);toast(tf("clusterOpened",{p:nm(C.key||t("noProject"),"p"),n:C.count.toLocaleString()}));}curReal=i;tabPush(REAL.nodes[i]);REAL.pulse(i);dirty=true;if(open.has("rnode"))fill("rnode");else openOv("rnode");}
function openForeign(h){const N=h.node;if(N.kind==="cluster"){FB.openCluster(h);toast(tf("clusterOpened",{p:N.key||t("noProject"),n:N.count.toLocaleString()}));dirty=true;return;}
  curB=N.row?{brain:h.brain.id,fid:N.row.fid}:{brain:h.brain.id,project:N.project||""};FB.pulse(h);dirty=true;if(open.has("bnode"))fill("bnode");else openOv("bnode");}
function flyBrain(k){const c=FB.worldCenter(k);if(!c)return;goal.target.copy(c);goal.r=Math.min(Math.max(goal.r,2.2),3);lastInteract=performance.now();dirty=true;wake();}
function flyForeign(){if(!curB||curB.fid===undefined)return;const b=FB.brains.find(x=>x.id===curB.brain);if(!b)return;const i=b.layer.indexOfFile("b:"+b.id+":"+curB.fid);if(i<0)return;goal.target.copy(b.layer.worldPos(i));goal.r=Math.min(goal.r,1.7);b.layer.pulse(i);lastInteract=performance.now();dirty=true;}
function flyReal(i){if(i<0)return;goal.target.copy(REAL.worldPos(i));goal.r=Math.min(goal.r,1.7);REAL.pulse(i);lastInteract=performance.now();dirty=true;}
function openNode(n){curNode=n;nodeGlow[n]=1;if(open.has("node"))fill("node");else openOv("node");}
function openNote(i,fly){curNote=i;memTab="note";if(open.has("memory"))fill("memory");else openOv("memory");if(fly)flyTo(nodeOfFile(i));paintNodes();}
function onEvent(E){if(!E.f)return;const i=FILES.findIndex(F=>F.n===E.x);const n=nodeOfFile(i);if(n<0||sessState[E.s]==="mute")return;nodeGlow[n]=1;if(E.k==="Edit")nodeEdit[n]=1;}

/* ---------- markdown preview ---------- */
// wl(name) -> attribute string for a resolved wikilink, or "" when the target is missing (default: demo notes)
function mdRender(src,wl){if(st.privacy)return `<p class="hint" style="margin:0">${t("privHidden")}</p>`;const out=[];let ul=false,co=false,code=false;
  const res=wl||(a=>{const j=fileByName(a);return j>=0?` data-note="${j}"`:"";});
  const inl=s=>esc(s).replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g,(m,a,al)=>{const at=res(a.trim());return `<span class="wl${at?"":" miss"}"${at}>${al||a}</span>`;})
    .replace(/(^|\s)#([\w-]+)/g,'$1<span class="tagc">#$2</span>').replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/`([^`]+)`/g,'<span class="mono">$1</span>');
  for(const l of src.split("\n")){
    if(/^```/.test(l)){if(ul){out.push("</ul>");ul=false;}out.push(code?"</pre>":'<pre class="mono code">');code=!code;continue;}
    if(code){out.push(esc(l)+"\n");continue;}
    if(/^---\s*$/.test(l)){out.push("<hr>");continue;}
    const c=/^> \[!(\w+)\]/.exec(l);if(c){if(ul){out.push("</ul>");ul=false;}out.push(`<div class="callout"><b>${esc(c[1][0].toUpperCase()+c[1].slice(1))}</b> · `);co=true;continue;}
    if(co&&/^> /.test(l)){out.push(inl(l.slice(2))+" ");continue;}if(co){out.push("</div>");co=false;}
    if(/^- /.test(l)){if(!ul){out.push("<ul>");ul=true;}let s=l.slice(2),cb="";if(/^\[( |x)\] /.test(s)){cb=`<span class="cb${s[1]==="x"?" x":""}"></span>`;s=s.slice(4);}out.push(`<li>${cb}${inl(s)}</li>`);continue;}
    if(ul){out.push("</ul>");ul=false;}
    if(/^#{3,6} /.test(l)){out.push(`<h3>${inl(l.replace(/^#+ /,""))}</h3>`);continue;}
    if(/^## /.test(l)){out.push(`<h2>${inl(l.slice(3))}</h2>`);continue;}
    if(/^\d+\. /.test(l)){out.push(`<p style="margin:3px 0 3px 14px">${inl(l)}</p>`);continue;}
    if(/^# /.test(l)){out.push(`<h1>${inl(l.slice(2))}</h1>`);continue;}
    if(l.trim())out.push(`<p style="margin:4px 0">${inl(l)}</p>`);}
  if(ul)out.push("</ul>");if(co)out.push("</div>");if(code)out.push("</pre>");return `<div class="md note">${out.join("")}</div>`;}

/* ---------- local 2D graph ---------- */
function localGraph(i){const nb=[...new Set([...linksOf(i),...backlinksOf(i)])],W=400,H=170,cx=200,cy=82;
  const P=nb.map((j,k)=>{const a=-Math.PI/2+k*2*Math.PI/Math.max(1,nb.length);return [cx+Math.cos(a)*150,cy+Math.sin(a)*58,j];});
  const lab=s=>{s=baseName(st.privacy?nm(s,"f"):s);return esc(s.length>16?s.slice(0,15)+"…":s);};
  return `<svg class="lgraph" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("localGraph"))}">${P.map(p=>`<line x1="${cx}" y1="${cy}" x2="${p[0]}" y2="${p[1]}"/>`).join("")}
  ${P.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="5" data-note="${p[2]}"/><text x="${p[0]}" y="${p[1]+16}">${lab(FILES[p[2]].n)}</text>`).join("")}
  <circle class="c" cx="${cx}" cy="${cy}" r="6.5"/><text x="${cx}" y="${cy+19}" style="fill:var(--white)">${lab(FILES[i].n)}</text></svg>`;}

/* ---------- Memory overlay: note / library / tags ---------- */
let memTab="note",memView="prev",libQ="",libSort="name",libType="",curTag="",acSel=0;const packSel=new Set(),dismissed=new Set();
const stPill=s=>`<span class="pill ${s==="indexed"?"ok":s==="indexing"?"warn":s==="failed"?"bad":"mute"}">${t("st_"+s)}</span>`;
const sizeB=s=>{const m=/([\d.]+)\s*(KB|MB|GB)/.exec(s);return m?+m[1]*({KB:1e3,MB:1e6,GB:1e9}[m[2]]):0;};
function suggestionsFor(i){const out=[];if(!noteText[i])return out;const linked=new Set([...linksOf(i),...backlinksOf(i)]);
  FILES.forEach((F,j)=>{if(j===i||linked.has(j)||dismissed.has(i+">"+j))return;const src=noteSrc(j);
    if(src&&new RegExp("(^|[^\\[])"+baseName(FILES[i].n).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).test(src)&&!/\[\[/.test("")){out.push({j,why:t("sugMention")});return;}
    const sh=FX[i].tags.find(x=>FX[j].tags.includes(x)&&x!=="daily");if(sh)out.push({j,why:tf("sugTag",{x:sh})});});return out.slice(0,3);}
function unlinkedOf(i){const b=baseName(FILES[i].n);return FILES.map((_,j)=>j).filter(j=>j!==i&&noteText[j]&&noteText[j].includes(b)&&!linksOf(j).includes(i));}
BODY.memory=()=>{const tabs=`<div class="tabs">${[["note","tabNote"],["lib","tabLib"],["search","tabSearch"],["time","tabTime"],["num","tabNum"],["tags","tabTags"],...(lib.count?[["fresh","tabFresh"]]:[]),["brains","tabBrains"]].map(([k,l])=>`<button type="button" data-x="mtab:${k}" class="${memTab===k?"on":""}">${t(l)}</button>`).join("")}</div>`;
  if(memTab==="time")return tabs+timelineBlock();
  if(memTab==="num")return tabs+numbersBlock();
  if(memTab==="brains"){if(!BR.ready||!BR.plan)loadBrainsUi();const tints={},bc={};FB.brains.forEach(b=>{tints[b.id]=cssCol(b.tint);bc[b.id]=FB.bridgesCount(b.id);});
    return tabs+brainsBlock({t,tf,esc,fmtB,nm,rows:lib.rows,tints,bridgeCounts:bc});}
  if(memTab==="lib"){const types={};FX.forEach(f=>types[f.ty]=(types[f.ty]||0)+1);
    let L=FILES.map((F,i)=>i).filter(i=>(!libType||FX[i].ty===libType)&&(!libQ||(FILES[i].n+" "+noteSrc(i)).toLowerCase().includes(libQ.toLowerCase())));
    L.sort((a,b)=>libSort==="size"?sizeB(FILES[b].s)-sizeB(FILES[a].s):libSort==="date"?FX[b].imp.split(".").reverse().join("").localeCompare(FX[a].imp.split(".").reverse().join("")):libSort==="proj"?FILES[a].p.localeCompare(FILES[b].p):FILES[a].n.localeCompare(FILES[b].n));
    return tabs+libraryBlock(t,tf,esc,st.privacy)+`${lib.count?"":`<div class="kv"><span>${t("libFiles")}</span><span>${fmtN(libN)} · ${libSize(libN)}</span></div>`}
    <div class="sec">${t("byFileType")}</div><div class="chips"><button type="button" class="chip${libType?"":" on"}" data-x="ltype:">${t("all")}<em>${FILES.length}</em></button>${Object.keys(types).map(k=>`<button type="button" class="chip${libType===k?" on":""}" data-x="ltype:${k}">${k}<em>${types[k]}</em></button>`).join("")}</div>
    <div class="fld"><input id="libq" class="inp" placeholder="${esc(t("searchLib"))}" value="${esc(libQ)}"><select id="libsort" class="inp" style="flex:0 0 120px">${["name","size","date","proj"].map(k=>`<option value="${k}"${libSort===k?" selected":""}>${t("sort"+k[0].toUpperCase()+k.slice(1))}</option>`).join("")}</select></div>
    <div class="list" id="liblist">${libRows(L)}</div>
    <p class="hint" style="margin-top:6px">${tf("libShown",{a:FILES.length,b:fmtN(libN)})}</p>
    <div class="btns"><button class="btn${packSel.size?" pri":""}" type="button" data-x="pack"${packSel.size?"":" disabled"}>${tf("packBtn",{n:packSel.size})}</button></div>
    <div class="sec">${t("libFolder")}</div><div class="row"><span class="n mono">${st.privacy?"…":"~/NEURAL OS/Library"}</span><button class="btn sm" type="button" data-x="openfolder">${t("openFolder")}</button></div>
    <p class="hint"><span class="tag">${t("demo")}</span></p>`;}
  if(memTab==="search")return tabs+searchBlock();
  if(memTab==="fresh")return tabs+freshBlock();
  if(memTab==="tags"&&lib.count)return tabs+realTagsBlock();
  if(memTab==="tags"){const tg={};FX.forEach(f=>f.tags.forEach(x=>tg[x]=(tg[x]||0)+1));
    return tabs+`<div class="chips">${Object.keys(tg).sort().map(x=>`<button type="button" class="chip${curTag===x?" on":""}" data-x="tag:${x}">#${x}<em>${tg[x]}</em></button>`).join("")}</div>
    ${curTag?`<div class="sec">${tf("tagNotes",{x:curTag})}</div><div class="list">${FILES.map((F,i)=>i).filter(i=>FX[i].tags.includes(curTag)).map(i=>`<div class="row" data-x="opennote:${i}" style="cursor:pointer"><span class="n">${esc(nm(FILES[i].n,"f"))}</span><span class="m">${esc(nm(FILES[i].p,"p"))}</span></div>`).join("")}</div>`:""}`;}
  const i=curNote,F=FILES[i],fx=FX[i],src=noteText[i];
  let main;
  if(src&&memView==="edit")main=`<div class="acwrap"><textarea id="ned" class="ned" spellcheck="false">${esc(src)}</textarea><div class="ac" id="ac" hidden></div></div><p class="hint" id="nsaved" style="margin-top:4px">${tf("saved",{n:noteVer[i]})}</p>`;
  else if(src)main=`<div class="prev">${mdRender(src)}</div>`;
  else if(fx.ty==="png")main=`<div class="previmg">PNG · ${esc(F.s)}</div><div class="sec">${t("extracted")} <span class="gen">${t("generated")}</span></div><p class="hint" style="margin:0">${st.privacy?t("privHidden"):esc(fx.ocr)}</p><p class="hint" style="margin-top:4px">${t("ocrNote")}</p>`;
  else if(fx.ty==="luau")main=`<div class="diff" style="padding:10px 12px">${st.privacy?esc(t("privHidden")):esc(fx.txt)}</div>`;
  else if(fx.st==="failed")main=`<div class="note-w">${tf("failedD",{e:fx.err})}</div>`;
  else main=`<div class="note-w">${t("nameOnlyD")}</div>`;
  const out=linksOf(i),bl=backlinksOf(i),ul=unlinkedOf(i),sg=suggestionsFor(i),heads=src?src.split("\n").filter(l=>/^#{1,3} /.test(l)):[];
  const row=j=>`<div class="row" data-note="${j}" style="cursor:pointer"><span class="n">${esc(nm(FILES[j].n,"f"))}</span><span class="m">${esc(nm(FILES[j].p,"p"))}</span></div>`;
  const trace=log.filter(E=>E.x===F.n).slice(0,3).map(E=>`<div class="row"><span class="n">${esc(t("e_"+E.k))}</span><span class="m">${E.time} · ${esc(nm(E.s||"","p"))}</span></div>`).join("");
  return tabs+`<div class="tbar"><b style="font-size:13px;color:var(--white);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nm(F.n,"f"))}</b><span class="m mono" style="font-size:10px;color:var(--silver)">${esc(nm(F.p,"p"))}</span><span class="sp"></span>
    ${src?`<span class="seg sm"><button type="button" data-x="mview:prev" class="${memView==="prev"?"on":""}">${t("viewPrev")}</button><button type="button" data-x="mview:edit" class="${memView==="edit"?"on":""}">${t("viewEdit")}</button></span>`:""}</div>
  <div class="tbar"><button class="btn sm" type="button" data-x="daily">${t("daily")}</button>${src?`<select class="inp" data-x="tpl" style="flex:0 0 auto;padding:3px 6px;font-size:11px"><option value="">${t("template")}</option>${["meeting","idea","bug"].map(k=>`<option value="${k}">${t("tpl_"+k)}</option>`).join("")}</select>`:""}<span class="sp"></span><button class="btn sm" type="button" data-x="flynote">${t("showInBrain")}</button><button class="btn sm" type="button" data-act="focus">${t("focusMode")}</button></div>
  ${main}
  ${heads.length>1?`<div class="sec">${t("outline")}</div><div class="list">${heads.map(h=>`<div class="row"><span class="n" style="padding-left:${(h.match(/^#+/)[0].length-1)*12}px">${esc(h.replace(/^#+ /,""))}</span></div>`).join("")}</div>`:""}
  <div class="sec">${t("localGraph")}</div>${localGraph(i)}
  ${sg.length?`<div class="sec">${t("suggestions")} <span class="badge">${sg.length}</span></div>${sg.map(s=>`<div class="sugg"><span class="gen">${t("suggestion")}</span><span class="n">${esc(nm(FILES[s.j].n,"f"))}<small>${esc(s.why)}</small></span><button class="btn sm" type="button" data-x="sacc:${s.j}">${t("accept")}</button><button class="btn sm" type="button" data-x="sdis:${s.j}">${t("dismiss")}</button></div>`).join("")}`:""}
  <div class="sec">${t("backlinks")}</div><div class="list">${bl.map(row).join("")||`<p class="hint" style="margin:0">—</p>`}</div>
  ${out.length?`<div class="sec">${t("linksOut")}</div><div class="list">${out.map(row).join("")}</div>`:""}
  ${ul.length?`<div class="sec">${t("unlinked")}</div><div class="list">${ul.map(row).join("")}</div>`:""}
  <div class="sec">${t("claudeTrace")}</div><div class="list">${trace||`<div class="row"><span class="n">${t("e_Read")}</span><span class="m">14:02 · ${esc(nm(F.p,"p"))}</span></div>`}</div>
  <p class="hint"><span class="tag">${t("demo")}</span></p>`;};
function libRows(L){return L.map(i=>`<div class="row" data-libi="${i}" style="cursor:pointer"><input type="checkbox" data-x="psel:${i}" aria-label="${esc(t("packAdd"))}"${packSel.has(i)?" checked":""}><span class="n">${esc(nm(FILES[i].n,"f"))}</span><span class="m">${FX[i].ty} · ${esc(FILES[i].s)}</span>${stPill(FX[i].st)}</div>`).join("");}

/* ---------- node details ---------- */

/* ---------- tabs (open notes, like Obsidian) and a second panel beside it (split view, read-only preview) ---------- */
const TABS={ids:[],pin:null};const TAB_MAX=12;
try{const s=JSON.parse(localStorage.getItem("nos-tabs")||"null");if(s&&Array.isArray(s.ids))TABS.ids=s.ids.slice(0,TAB_MAX);}catch(e){}
function tabSave(){try{localStorage.setItem("nos-tabs",JSON.stringify({ids:TABS.ids}));}catch(e){}}
function tabPush(N){if(!N||!N.row)return;const id=N.row.id;if(TABS.ids.includes(id))return;const cur=REAL.nodes[curReal],at=TABS.ids.indexOf(cur&&cur.row?cur.row.id:"");
  TABS.ids.splice(at>=0?at+1:TABS.ids.length,0,id);while(TABS.ids.length>TAB_MAX)TABS.ids.splice(TABS.ids[0]===id?1:0,1);tabSave();}
function tabBar(curId,byId){const ids=TABS.ids.filter(id=>byId.has(id));if(ids.length!==TABS.ids.length){TABS.ids=ids;tabSave();}if(ids.length<2&&!TABS.pin)return `<div class="ntabs"><span class="sp"></span>${splitBtn(curId)}</div>`;
  const lab=n=>{n=nm(n,"f").replace(/\.(md|txt)$/i,"");return esc(n.length>22?n.slice(0,21)+"…":n);};
  return `<div class="ntabs" role="tablist">${ids.map(id=>`<span class="ntab${id===curId?" on":""}" role="tab" aria-selected="${id===curId}" data-tab="${esc(id)}" title="${esc(nm(byId.get(id).name,"f"))}">${lab(byId.get(id).name)}<button type="button" data-x="tabx:${esc(id)}" aria-label="${esc(t("tabClose"))}">×</button></span>`).join("")}<span class="sp"></span>${splitBtn(curId)}</div>`;}
const splitBtn=id=>`<button class="btn sm" type="button" data-x="tabsplit:${esc(id)}" title="${esc(t("tabSplitT"))}">${t(TABS.pin===id?"tabSplitOff":"tabSplit")}</button>`;
function tabOpen(id){let i=REAL.indexOfFile(id);if(i>=0&&REAL.nodes[i].kind==="cluster"){i=REAL.revealFile(id);REAL.setLinks(st.links);}if(i>=0){edFlush();openReal(i);}}
function tabClose(id){const k=TABS.ids.indexOf(id);if(k<0)return;TABS.ids.splice(k,1);tabSave();const cur=REAL.nodes[curReal];
  if(cur&&cur.row&&cur.row.id===id){const nx=TABS.ids[Math.min(k,TABS.ids.length-1)];if(nx)tabOpen(nx);else{edFlush();closeOv("rnode");}}else refreshNode();}
function tabStep(d){const cur=REAL.nodes[curReal];if(!cur||!cur.row||TABS.ids.length<2)return;const k=TABS.ids.indexOf(cur.row.id);tabOpen(TABS.ids[(k+d+TABS.ids.length)%TABS.ids.length]);}
function splitToggle(id){if(TABS.pin===id||!id){TABS.pin=null;closeOv("rnode2");refreshNode();return;}TABS.pin=id;if(open.has("rnode2"))fill("rnode2");else{openOv("rnode2");
  const a=ovRoot.querySelector('.ov[data-m="rnode"]'),b=ovRoot.querySelector('.ov[data-m="rnode2"]');if(a&&b){b.style.top=a.offsetTop+"px";b.style.height=a.offsetHeight+"px";b.style.left=Math.max(90,a.offsetLeft-b.offsetWidth-12)+"px";}}refreshNode();}
BODY.rnode2=()=>{const r=TABS.pin&&lib.rows.find(x=>x.id===TABS.pin);if(!r)return `<p class="hint">${t("tabPinGone")}</p>`;const B=bridge();let c=realContent.get(r.id);
  if(!c&&B&&B.read){B.read(r.id).then(x=>{realContent.set(r.id,x);refreshOv("rnode2");}).catch(()=>{});}
  return `<div class="tbar"><span class="typ">${t("tabSide")}</span><b style="font-size:13px;color:var(--white)">${esc(nm(r.name,"f"))}</b><span class="sp"></span><button class="btn sm" type="button" data-x="tabswap">${t("tabSwap")}</button></div>`
    +(st.privacy?`<p class="hint">${t("privHidden")}</p>`:!c?`<p class="hint">…</p>`:`<div class="rcontent">${contentBody(c,realWl)}</div>`);};
ovRoot.addEventListener("click",e=>{const tb=e.target.closest("[data-tab]");if(tb&&!e.target.closest("button")){e.stopPropagation();tabOpen(tb.dataset.tab);return;}
  const b=e.target.closest("[data-x]");if(!b)return;const x=b.dataset.x;
  if(x.startsWith("tabx:")){e.stopPropagation();tabClose(x.slice(5));}
  else if(x.startsWith("tabsplit:")){e.stopPropagation();splitToggle(x.slice(9));}
  else if(x==="tabswap"){e.stopPropagation();const cur=REAL.nodes[curReal],p=TABS.pin;if(!p)return;TABS.pin=cur&&cur.row?cur.row.id:null;if(!TABS.pin)closeOv("rnode2");else refreshOv("rnode2");tabOpen(p);}},true);
ovRoot.addEventListener("auxclick",e=>{const tb=e.target.closest("[data-tab]");if(tb&&e.button===1){e.preventDefault();tabClose(tb.dataset.tab);}});
addEventListener("keydown",e=>{if(!(e.ctrlKey||e.metaKey)||!open.has("rnode"))return;
  if(e.key==="Tab"){e.preventDefault();tabStep(e.shiftKey?-1:1);}
  else if(e.key.toLowerCase()==="w"&&ovRoot.querySelector('.ov.front[data-m="rnode"]')){const cur=REAL.nodes[curReal];if(cur&&cur.row){e.preventDefault();tabClose(cur.row.id);}}});
BODY.rnode=()=>{const N=REAL.nodes[curReal];if(!N)return `<p class="hint">${t("noLinksYet")}</p>`;
  const head=`<div class="tbar"><span class="typ">${t("k_"+N.kind)}</span><b style="font-size:13px;color:var(--white)">${esc(N.kind==="project"?nm(N.project,"p"):nm(N.row.name,"f"))}</b><span class="sp"></span>${N.row?bmBtn(N.row.id):""}<button class="btn sm" type="button" data-x="flyreal">${t("showInBrain")}</button></div>`;
  if(N.kind==="project"){const files=lib.rows.filter(r=>r.project===N.project);
    return head+(N.open?`<div class="btns" style="margin-top:0"><button class="btn sm" type="button" data-x="rclose">${t("clusterClose")}</button></div>`:"")+`<div class="sec">${t("libFiles")} · ${files.length}</div><div class="list">${files.slice(0,300).map(r=>`<div class="row" data-real="${esc(r.id)}" style="cursor:pointer"><span class="n">${esc(nm(r.name,"f"))}</span><span class="m">${esc(r.ext||"—")} · ${fmtB(r.size)}</span></div>`).join("")}</div>`;}
  const r=N.row,byId=new Map(lib.rows.map(x=>[x.id,x]));
  const L=lib.links.filter(l=>l.status==="linked"&&(l.from_id===r.id||l.to_id===r.id));
  const row=(l,o)=>`<div class="row" data-real="${esc(o.id)}" style="cursor:pointer"><span class="n">${esc(nm(o.name,"f"))}</span><span class="m">${esc(t("r_"+l.reason))} · ${esc(t(l.origin==="user"?"linkUser":"linkAuto"))}</span></div>`;
  const out=L.filter(l=>l.from_id===r.id).map(l=>{const o=byId.get(l.to_id);return o?row(l,o):"";}).join("");
  const back=L.filter(l=>l.to_id===r.id).map(l=>{const o=byId.get(l.from_id);return o?row(l,o):"";}).join("");
  const links=(out?`<div class="sub">${t("linksOut")}</div><div class="list">${out}</div>`:"")+(back?`<div class="sub">${t("backlinksH")}</div><div class="list">${back}</div>`:"");
  return tabBar(r.id,byId)+head+contentBlock(r)+claudeTrace(r)+`<div class="sec">${t("mLinks")}</div>${realGraph(r,L,byId)}${links||`<p class="hint">${t("noLinksYet")}</p>`}${mentionsBlock(r)}<div class="sec">${t("fileInfo")}</div><div class="kv"><span>${t("k_"+N.kind)}</span><span>${esc((r.ext||"—").toUpperCase())} · ${fmtB(r.size)}</span>
   <span>${t("projectL")}</span><span>${esc(r.project?nm(r.project,"p"):t("noProject"))}${r.project&&r.project_origin==="auto"?` <small style="color:var(--silver)">(${t("projAuto")})</small>`:""}</span>
   <span>${t("loc")}</span><span class="mono">${st.privacy?"…":esc(r.lib_path)}</span><span>${t("src")}</span><span class="mono">${st.privacy?"…":esc(r.original_path)}</span>
   <span>${t("imported")}</span><span>${esc(new Date(r.imported_at).toLocaleString(lang==="de"?"de-DE":"en-US"))}</span><span>Status</span><span>${stPill(r.status)}</span></div>
`;};
/* ---------- tags and full-text search over the real notes (main process reads, nothing is written) ---------- */
const RT={data:null,busy:false,cur:""},FS={q:"",res:null,busy:false,seq:0,t:0};
function loadTags(){const B=bridge();if(!B||!B.tags||RT.busy)return;RT.busy=true;B.tags().then(d=>{RT.data=d;RT.busy=false;if(memTab==="tags")refreshOv("memory");}).catch(()=>{RT.busy=false;});}
function realTagsBlock(){if(!RT.data){loadTags();return `<p class="hint">…</p>`;}const D=RT.data,byId=new Map(lib.rows.map(r=>[r.id,r]));
  if(!D.tags.length)return `<p class="hint">${t("rtNone")}</p>`;
  const sel=RT.cur&&D.files[RT.cur]?D.files[RT.cur].map(id=>byId.get(id)).filter(Boolean):[];
  return `<p class="hint" style="margin-top:0">${t("rtHint")}</p><div class="chips">${D.tags.map(x=>`<button type="button" class="chip${RT.cur===x.tag?" on":""}" data-x="rtag:${esc(x.tag)}">#${esc(x.tag)}<em>${x.count}</em></button>`).join("")}</div>
   ${RT.cur?`<div class="sec">${tf("tagNotes",{x:esc(RT.cur)})}</div><div class="list">${sel.map(r=>`<div class="row" data-real="${esc(r.id)}" style="cursor:pointer"><span class="n">${esc(nm(r.name,"f"))}</span><span class="m">${esc(r.project?nm(r.project,"p"):"")}</span></div>`).join("")}</div>`:""}
   ${D.capped?`<p class="hint">${tf("menCapped",{n:D.scanned.toLocaleString()})}</p>`:""}`;}
function hl(text,q){let h=esc(text);const ws=[...new Set(String(q).toLowerCase().replace(/(^|\s)#\S+/g," ").replace(/"/g," ").split(/\s+/).filter(w=>w.length>=2))].sort((a,b)=>b.length-a.length);
  for(const w of ws){const e=esc(w).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");h=h.replace(new RegExp(`(${e})(?![^<]*>)`,"gi"),"<mark>$1</mark>");}return h;}
function searchBlock(){const R=FS.res;
  const list=!FS.q.trim()?`<p class="hint">${t("fsHint")}</p>`:FS.busy&&!R?`<p class="hint">…</p>`:!R||!R.hits.length?`<p class="hint">${t("fsNone")}</p>`
    :`<p class="hint" style="margin:0 0 6px">${tf("fsCount",{n:R.total.toLocaleString()})}</p><div class="list" id="fslist">${R.hits.map(h=>`<div class="row fsr" data-real="${esc(h.id)}" style="cursor:pointer"><span class="n">${hl(nm(h.name,"f"),FS.q)}${st.privacy?"":h.snippets.map(x=>`<small>${hl(x,FS.q)}</small>`).join("")}</span><span class="m">${esc(h.project?nm(h.project,"p"):"")}</span></div>`).join("")}</div>${R.capped?`<p class="hint">${tf("menCapped",{n:R.scanned.toLocaleString()})}</p>`:""}`;
  return `<div class="fld"><input id="fsq" class="inp" placeholder="${esc(t("fsPh"))}" value="${esc(FS.q)}" spellcheck="false"></div><div id="fsout">${list}</div>`;}
function runSearch(){const B=bridge(),q=FS.q.trim(),n=++FS.seq;if(!B||!B.search)return;if(!q){FS.res=null;paintSearch();return;}FS.busy=true;
  B.search(q).then(R=>{if(n!==FS.seq)return;FS.res=R;FS.busy=false;paintSearch();}).catch(()=>{FS.busy=false;});}
function paintSearch(){const o=document.getElementById("fsout");if(!o)return;const tmp=document.createElement("div");tmp.innerHTML=searchBlock();o.replaceWith(tmp.querySelector("#fsout"));}
// notes that name this note as plain text, not as [[link]] (Obsidian "unlinked mentions"); searched on request
const MEN={id:null,res:null,busy:false};
function mentionsBlock(r){if(r.ext!=="md"&&r.ext!=="txt")return "";const B=bridge();if(!B||!B.mentions)return "";
  const h=`<div class="sec">${t("menT")}</div>`;
  if(MEN.id!==r.id||(!MEN.res&&!MEN.busy))return h+`<p class="hint">${t("menHint")}</p><div class="btns" style="margin-top:0"><button class="btn sm" type="button" data-x="mensearch">${t("menSearch")}</button></div>`;
  if(MEN.busy)return h+`<p class="hint">…</p>`;
  const M=MEN.res.mentions;
  return h+(M.length?`<div class="list">${M.map(x=>`<div class="row men"><span class="n"><span data-real="${esc(x.id)}" style="cursor:pointer">${esc(nm(x.name,"f"))}</span><small>${st.privacy?"…":esc(x.snippet)}</small></span>${x.editable?`<button class="btn sm" type="button" data-x="menlink:${esc(x.id)}">${t("menLink")}</button>`:`<span class="m">${t("readOnly")}</span>`}</div>`).join("")}</div>`:`<p class="hint">${t("menNone")}</p>`)
    +(MEN.res.capped?`<p class="hint">${tf("menCapped",{n:MEN.res.scanned.toLocaleString()})}</p>`:"");}
function mentionsSearch(){const N=REAL.nodes[curReal],B=bridge();if(!N||!N.row||!B||!B.mentions)return;const id=N.row.id;Object.assign(MEN,{id,res:null,busy:true});fill("rnode");
  B.mentions(id).then(R=>{if(MEN.id!==id)return;MEN.res=R;MEN.busy=false;refreshNode();}).catch(()=>{MEN.busy=false;refreshNode();});}
// Obsidian Bases: each view as a table over the notes (main process evaluates the filters)
const BASES=new Map();let baseView=0,baseFor=null;
function baseBlock(r){const B=bridge();if(!B||!B.base)return "";const R=BASES.get(r.id);
  if(!R){BASES.set(r.id,null);B.base(r.id).then(x=>{BASES.set(r.id,x);refreshNode();}).catch(()=>{});return `<p class="hint">…</p>`;}
  if(R===null)return `<p class="hint">…</p>`;
  if(!R.ok)return `<p class="hint">${t("baseBad")}</p>`;
  if(baseFor!==r.id){baseFor=r.id;baseView=0;}const V=R.views[Math.min(baseView,R.views.length-1)];if(!V)return `<p class="hint">${t("baseBad")}</p>`;
  const byId=new Map(lib.rows.map(x=>[x.id,x]));
  const cell=(v,k,id)=>{const s=Array.isArray(v)?v.join(", "):v==null?"":typeof v==="number"&&k==="file.mtime"?new Date(v).toLocaleString(lang==="de"?"de-DE":"en-US"):typeof v==="number"&&k==="file.size"?fmtB(v):String(v);
    return k==="file.name"||k==="file.basename"?`<span data-real="${esc(id)}" class="wl">${esc(s)}</span>`:esc(s);};
  return (R.views.length>1?`<div class="seg sm" style="margin-bottom:8px">${R.views.map((v,k)=>`<button type="button" data-x="bview:${k}" class="${V===v?"on":""}">${esc(v.name)}</button>`).join("")}</div>`:"")
    +(V.unsupportedType?`<p class="hint">${tf("baseType",{t:esc(V.type)})}</p>`:"")
    +`<div class="md"><div class="tablewrap"><table class="base-t"><thead><tr>${V.columns.map(c=>`<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${V.rows.map(row=>`<tr>${row.cells.map((v,k)=>`<td>${st.privacy&&k>0?"…":cell(v,V.columns[k].key,row.id)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`
    +`<p class="hint">${tf("baseCount",{n:V.rows.length,m:V.total})}</p>`
    +(V.skipped.length?`<div class="note-w">${t("baseSkipped")}<div class="mono" style="font-size:11px;margin-top:4px">${V.skipped.map(esc).join("<br>")}</div></div>`:"");}
// small 2D graph of a note's direct links (in and out), each neighbour clickable
function realGraph(r,L,byId){const ids=[...new Set(L.map(l=>l.from_id===r.id?l.to_id:l.from_id))].filter(id=>byId.has(id));if(!ids.length)return "";
  const nb=ids.slice(0,14),W=400,H=170,cx=200,cy=82,out=new Set(L.filter(l=>l.from_id===r.id).map(l=>l.to_id));
  const P=nb.map((id,k)=>{const a=-Math.PI/2+k*2*Math.PI/nb.length;return [cx+Math.cos(a)*150,cy+Math.sin(a)*58,id];});
  const lab=n=>{n=nm(n,"f").replace(/\.(md|txt)$/i,"");return esc(n.length>16?n.slice(0,15)+"…":n);};
  return `<svg class="lgraph" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("localGraph"))}">${P.map(p=>`<line x1="${cx}" y1="${cy}" x2="${p[0]}" y2="${p[1]}"${out.has(p[2])?"":` stroke-dasharray="3 3"`}/>`).join("")}
  ${P.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="5" data-real="${esc(p[2])}" ${st.theme==="color"?` style="fill:${cssCol(groupColor(groupOf(byId.get(p[2]),st.colorBy),st.colorBy))}"`:""}/><text x="${p[0]}" y="${p[1]+16}">${lab(byId.get(p[2]).name)}</text>`).join("")}
  <circle class="c" cx="${cx}" cy="${cy}" r="6.5"/><text x="${cx}" y="${cy+19}" style="fill:var(--white)">${lab(r.name)}</text></svg>`+(ids.length>nb.length?`<p class="hint" style="margin:2px 0 6px">${tf("lgMore",{n:ids.length-nb.length})}</p>`:"");}
// file content, read-only: notes rendered (wikilinks jump to their file), code as text, images inline
const realContent=new Map();
function stemOf(n){return String(n).replace(/\.[^.]+$/,"").normalize("NFC").toLowerCase();}
let stemIdx=null,stemFor=null;
function realWl(name){if(stemFor!==lib.rows){stemIdx=new Map();for(const x of lib.rows){const k=stemOf(x.name);if(!stemIdx.has(k))stemIdx.set(k,x.id);}
    for(const x of lib.rows)if(x.aliases)for(const a of x.aliases.split("|"))if(!stemIdx.has(a))stemIdx.set(a,x.id);stemFor=lib.rows;}
  const id=stemIdx.get(stemOf(name.split("/").pop()));return id?` data-real="${esc(id)}"`:"";}
function contentBlock(r){if(st.privacy)return `<div class="sec">${t("content")}</div><p class="hint">${t("privHidden")}</p>`;
  const B=bridge();if(!B||!B.read)return "";const c=realContent.get(r.id);
  if(!c){B.read(r.id).then(x=>{realContent.set(r.id,x);if(curReal>=0&&REAL.nodes[curReal]&&REAL.nodes[curReal].row&&REAL.nodes[curReal].row.id===r.id)refreshOv("rnode");}).catch(()=>{});return `<div class="sec">${t("content")}</div><p class="hint">…</p>`;}
  if(c.kind==="text"&&c.ext!=="extracted"&&(c.ext==="md"||c.ext==="txt"))return editorBlock(r,c);
  if(c.kind==="text"&&c.ext==="canvas")return `<div class="sec">${t("content")}<span class="ro">${t("readOnly")}</span></div>`+renderCanvas(c.text,{esc,t,resolve:realWl,md:x=>renderMarkdown(x,{resolve:realWl,t})});
  if(c.kind==="text"&&c.ext==="base")return `<div class="sec">${t("content")}<span class="ro">${t("readOnly")}</span></div>`+baseBlock(r);
  return `<div class="sec">${t("content")}<span class="ro">${t("readOnly")}</span></div><div class="rcontent">${contentBody(c,realWl)}</div>`;}
/* ---------- note editor (spec 5.6, 5.1): autosave, conflict check, versions; vault folders only when editing is on ---------- */
const ED={id:null,text:"",base:null,dirty:false,status:"",at:null,view:"prev",theirs:null,theirsHash:null,cmp:false,saveT:0,prevT:0,versions:null,showVer:false,ver:null,err:null};
// never re-render the node panel under the user's typing (saves and file watching would reset the cursor)
function refreshNode(){const a=document.activeElement;if(a&&a.id==="red")return;refreshOv("rnode");}
function edOpen(r,c){if(ED.id===r.id){if(!ED.dirty&&ED.theirs===null&&c.hash&&c.hash!==ED.base){ED.text=c.text;ED.base=c.hash;}return;}edFlush();Object.assign(ED,{id:r.id,ren:false,text:c.text,base:c.hash,dirty:false,status:"",at:null,theirs:null,theirsHash:null,cmp:false,versions:null,showVer:false,ver:null,err:null});}
function wordCount(text){const b=String(text).replace(/^---\n[\s\S]*?\n---\n?/,"").replace(/%%[\s\S]*?%%/g,"");const w=b.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);return {w:w?w.length:0,c:b.replace(/\s/g,"").length};}
function edStatus(){const n=wordCount(ED.text),wc=tf("wordCount",{w:n.w.toLocaleString(),c:n.c.toLocaleString()});const st0=edStatus0();return st0?wc+" · "+st0:wc;}
function edStatus0(){return ED.status==="saving"?t("edSaving"):ED.status==="saved"?tf("edSaved",{t:ED.at}):ED.status==="error"?tf("edError",{e:ED.err||"?"}):ED.dirty?t("edUnsaved"):"";}
function editorBlock(r,c){edOpen(r,c);const B=bridge();
  if(!c.editable){const f=r.folder_id&&lib.folders.find(x=>x.id===r.folder_id);
    return `<div class="sec">${t("content")}<span class="ro">${t("readOnly")}</span></div>`+(r.ext==="md"?`<div class="tbar">${noteTools(c.text,false)}</div>${outlineBlock(c.text)}`:"")+(c.why==="readonly"&&f?`<div class="note-w">${esc(tf("edReadonly",{f:f.name}))}<div class="btns" style="margin-top:6px"><button class="btn sm" type="button" data-x="libedit:${esc(f.id)}:1">${t("edEnable")}</button></div></div>`:"")+(c.why==="session"?`<p class="hint">${t("edSessionRo")}</p>`:"")+`<div class="rcontent">${contentBody(c,realWl)}</div>`;}
  const seg=`<span class="seg sm"><button type="button" data-x="edview:prev" class="${ED.view==="prev"?"on":""}">${t("viewPrev")}</button><button type="button" data-x="edview:edit" class="${ED.view==="edit"?"on":""}">${t("viewEdit")}</button></span>`;
  let conflict="";
  if(ED.theirs!==null){const D=lineDiff(ED.theirs,ED.text),cd=compactDiff(D,2);
    conflict=`<div class="note-w"><b>${t("edConflictT")}</b><br>${t("edConflictD")}<div class="btns" style="margin-top:6px"><button class="btn sm pri" type="button" data-x="edc:mine">${t("edKeepMine")}</button><button class="btn sm" type="button" data-x="edc:theirs">${t("edTakeTheirs")}</button><button class="btn sm" type="button" data-x="edc:cmp">${t(ED.cmp?"edHideCmp":"edCompare")}</button></div>
     ${ED.cmp?`<p class="hint" style="margin:6px 0 2px">${t("edCmpHint")}</p><div class="diff" style="max-height:240px">${cd.map(([o,l])=>o==="…"?`<div class="hd">… ${l} …</div>`:`<div class="${o==="+"?"add":o==="-"?"del":"ctx"}">${esc(l)}</div>`).join("")}</div>`:""}</div>`;}
  const body=ED.view==="edit"&&!st.privacy?(r.ext==="md"?`<div class="propsw">${propsBlock(ED.text,{t,esc,open:!!ED.propsOpen})}</div>`:"")+`<div class="acwrap"><textarea id="red" class="ned" spellcheck="false">${esc(ED.text)}</textarea><div class="ac" id="rac" hidden></div></div><div class="sub">${t("edLive")}</div><div class="prev" id="redprev">${noteHtml(ED.text,realWl)}</div>`
    :`<div class="rcontent">${contentBody({...c,text:ED.text},realWl)}</div>`;
  let ver="";
  if(ED.showVer){if(!ED.versions&&B&&B.versions){B.versions(r.id).then(v=>{ED.versions=v;refreshOv("rnode");});ver=`<p class="hint">…</p>`;}
    else{const V=ED.versions||[];ver=V.length?`<div class="list">${V.map(v=>`<div class="row"><span class="n">${esc(dayOf(v.saved_at))} ${hhmm(v.saved_at)}<small style="display:block;color:var(--silver);font-size:11px">${esc(t("edWhy_"+v.reason))} · ${fmtB(v.size)}</small></span><button class="btn sm" type="button" data-x="edv:show:${v.id}">${t(ED.ver&&ED.ver.id===v.id?"edHideCmp":"edCompare")}</button><button class="btn sm" type="button" data-x="edv:restore:${v.id}">${t("edRestore")}</button></div>${ED.ver&&ED.ver.id===v.id?`<div class="diff" style="max-height:220px">${compactDiff(lineDiff(ED.ver.text,ED.text),2).map(([o,l])=>o==="…"?`<div class="hd">… ${l} …</div>`:`<div class="${o==="+"?"add":o==="-"?"del":"ctx"}">${esc(l)}</div>`).join("")}</div>`:""}`).join("")}</div><p class="hint">${t("edVerHint")}</p>`:`<p class="hint">${t("edNoVer")}</p>`;}}
  return `<div class="sec">${t("content")}<span class="ro ok">${t(r.source==="linked"?"edVaultOn":"edEditable")}</span></div>
   <div class="tbar">${seg}<span class="sp"></span><span class="hint" id="redst" style="margin:0">${esc(edStatus())}</span><button class="btn sm" type="button" data-x="edren">${t("edRename")}</button><button class="btn sm" type="button" data-x="edver">${t("edVersions")}</button></div><div class="tbar">${noteTools(ED.text,ED.view==="edit"&&!st.privacy)}</div>${outlineBlock(ED.text)}${ED.ren?`<div class="note-w"><div class="tbar" style="margin:0"><input id="redname" class="inp" value="${esc(r.name.replace(/\.(md|txt)$/i,""))}" spellcheck="false"><button class="btn sm pri" type="button" data-x="edrenok">${t("edRename")}</button><button class="btn sm" type="button" data-x="edren">${t("cancel")}</button></div><p class="hint" style="margin:6px 0 0">${t("edRenameHint")}</p></div>`:""}${conflict}${body}${ED.showVer?`<div class="sec">${t("edVersions")}</div>${ver}`:""}`;}
// outline, focus mode and templates for the open note
let outlineOn=false,TPL=null;
function noteTools(text,editing){const B=bridge();
  // loaded once; added to the open editor without re-rendering it (the cursor stays where it is)
  if(editing&&TPL===null&&B&&B.templates){TPL=[];B.templates().then(x=>{TPL=x;const f=document.querySelector('.ov[data-m="rnode"] [data-x="focus"]');if(x.length&&f&&document.getElementById("red")&&!document.getElementById("edtpl"))f.insertAdjacentHTML("afterend",tplSelect());}).catch(()=>{TPL=null;});}
  return `<button class="btn sm${outlineOn?" on":""}" type="button" data-x="outline">${t("outline")}</button><button class="btn sm${document.body.classList.contains("focus")?" on":""}" type="button" data-x="focus">${t("focusMode")}</button><button class="btn sm" type="button" data-x="notepdf" title="${esc(t("pdfT"))}">PDF</button>`
    +(editing&&TPL&&TPL.length?tplSelect():"");}
const tplSelect=()=>`<select class="inp" id="edtpl" style="flex:0 0 auto;padding:3px 6px;font-size:11px"><option value="">${t("tplInsert")}</option>${TPL.map(x=>`<option value="${esc(x.id)}">${esc(x.name.replace(/\.md$/,""))}</option>`).join("")}</select>`;
function outlineBlock(text){if(!outlineOn)return "";const H=mdHeadings(text||"");
  return H.length?`<div class="outline">${H.map(h=>`<button type="button" data-x="edh:${esc(h.id)}" style="padding-left:${(h.level-1)*12+8}px">${esc(h.text)}</button>`).join("")}</div>`:`<p class="hint">${t("outlineNone")}</p>`;}
function setFocus(on){document.body.classList.toggle("focus",!!on);const el=open.get("rnode");if(el&&on)OV.front(el);}
function insertTemplate(id){const B=bridge(),ta=document.getElementById("red"),N=REAL.nodes[curReal];if(!B||!id||!N||!N.row)return;const at=ta?ta.selectionStart:ED.text.length;
  B.templateText(id,N.row.name.replace(/\.(md|txt)$/i,""),lang).then(x=>{if(x==null)return;ED.text=ED.text.slice(0,at)+x+ED.text.slice(at);ED.dirty=true;edSchedule();fill("rnode");const t2=document.getElementById("red");if(t2){t2.focus();t2.selectionStart=t2.selectionEnd=at+x.length;}});}
function edPaintStatus(){const x=document.getElementById("redst");if(x)x.textContent=edStatus();}
function edSave(force){const B=bridge();if(!B||!B.save||!ED.id||(!ED.dirty&&!force))return Promise.resolve();clearTimeout(ED.saveT);const id=ED.id,text=ED.text;ED.status="saving";edPaintStatus();
  return B.save(id,text,ED.base,!!force).then(R=>{if(ED.id!==id)return;
    if(R.ok){ED.base=R.hash;ED.dirty=ED.text!==text;ED.status="saved";ED.at=new Date().toTimeString().slice(0,5);ED.theirs=null;ED.cmp=false;ED.versions=null;const c=realContent.get(id);if(c)realContent.set(id,{...c,text,hash:R.hash});if(ED.dirty)edSchedule();edPaintStatus();if(force)refreshOv("rnode");}
    else if(R.conflict){ED.status="";ED.theirs=R.theirs??"";ED.theirsHash=R.theirsHash;refreshOv("rnode");}
    else{ED.status="error";ED.err=t("edWhyErr_"+(R.reason||"failed"));edPaintStatus();}}).catch(e=>{ED.status="error";ED.err=String(e&&e.message||e);edPaintStatus();});}
function edSchedule(){clearTimeout(ED.saveT);ED.saveT=setTimeout(()=>edSave(false),1200);}
function edFlush(){if(ED.id&&ED.dirty&&ED.theirs===null)edSave(false);}
addEventListener("beforeunload",edFlush);
// rename: the file gets the new name, [[links]] in notes NEURAL OS may edit follow (each with a version); read-only notes are counted
function edRename(){const B=bridge(),x=document.getElementById("redname");if(!B||!B.rename||!x||!ED.id)return;const id=ED.id,name=x.value.trim();if(!name)return;
  edSave(false).then(()=>B.rename(id,name)).then(R=>{if(!R.ok){toast(tf("edError",{e:t("edWhyErr_"+(R.reason||"failed"))}));return;}
    ED.ren=false;realContent.clear();ED.id=null;
    toast(tf("edRenamed",{n:R.name.replace(/\.(md|txt)$/i,""),u:R.updated})+(R.readonly?" "+tf("edRenamedRo",{n:R.readonly}):"")+(R.ambiguous?" "+t("edRenamedAmb"):""));
    pendingOpen=id;refreshLibrary(onLib);});}
addEventListener("keydown",e=>{if(e.key==="Escape"&&document.body.classList.contains("focus")&&!(e.target&&e.target.id==="redname")){setFocus(false);refreshNode();}});
ovRoot.addEventListener("change",e=>{if(e.target.id==="edtpl"){const id=e.target.value;e.target.value="";insertTemplate(id);}});
ovRoot.addEventListener("keydown",e=>{if(e.target.id==="redname"){if(e.key==="Enter"){e.preventDefault();edRename();}else if(e.key==="Escape"){e.stopPropagation();ED.ren=false;fill("rnode");}}});
/* ---------- Obsidian markdown for real notes (ui/markdown.js) + embeds, math, mermaid filled in after rendering ---------- */
function noteHtml(text,wl){if(st.privacy)return `<p class="hint" style="margin:0">${t("privHidden")}</p>`;return renderMarkdown(String(text).slice(0,400000),{resolve:wl||realWl,t});}
let katexMod=null,mermaidMod=null,mermaidN=0;const mermaidCache=new Map();
function rowByName(n){const k=String(n).normalize("NFC").toLowerCase(),st0=k.replace(/\.[^.]+$/,"");return lib.rows.find(r=>r.name.normalize("NFC").toLowerCase()===k)||lib.rows.find(r=>r.ext==="md"&&r.name.normalize("NFC").toLowerCase().replace(/\.md$/,"")===st0)||lib.rows.find(r=>r.aliases&&r.aliases.split("|").includes(k));}
// [[Note#Heading]] and [[Note#^block]]: scroll to it once the note is shown
let pendingHead=null;
function scrollToHead(root,h){if(!root||!h)return false;const k=String(h).toLowerCase();const el=[...root.querySelectorAll(".rcontent [id], .prev [id]")].find(x=>x.id.toLowerCase()===k||x.id.toLowerCase()==="^"+k);if(!el)return false;
  el.scrollIntoView({block:"start",behavior:"smooth"});const tg=el.classList.contains("bid")?el.parentElement:el;tg.classList.add("hflash");setTimeout(()=>tg.classList.remove("hflash"),1600);return true;}
function hydrate(root,m){if(!root)return;wireCanvas(root);
  const maths=root.querySelectorAll(".math[data-tex]:not([data-done])");
  if(maths.length)(katexMod?Promise.resolve(katexMod):import("katex").then(x=>katexMod=x.default||x)).then(K=>maths.forEach(el=>{el.dataset.done="1";try{el.innerHTML=K.renderToString(el.dataset.tex,{displayMode:el.classList.contains("block"),throwOnError:false,trust:false});}catch(_){}})).catch(()=>{});
  const mers=root.querySelectorAll(".mermaid-box[data-mermaid]:not([data-done])");
  if(mers.length)(mermaidMod?Promise.resolve(mermaidMod):import("mermaid").then(x=>{mermaidMod=x.default||x;mermaidMod.initialize({startOnLoad:false,theme:"dark",securityLevel:"strict"});return mermaidMod;})).then(async M=>{for(const el of mers){el.dataset.done="1";const code=el.dataset.mermaid;
      try{let svg=mermaidCache.get(code);if(!svg){svg=(await M.render("nosmm"+(++mermaidN),code)).svg;mermaidCache.set(code,svg);}el.innerHTML=svg;}catch(e){el.insertAdjacentHTML("beforeend",`<p class="hint">${esc(t("mdMermaidErr"))}</p>`);}}}).catch(()=>{});
  if(!["rnode","rnode2","memory","hover"].includes(m))return;
  const B=bridge();if(!B||!B.read)return;
  root.querySelectorAll(".embed[data-embed]:not([data-done])").forEach(el=>{el.dataset.done="1";if(el.closest(".embed-note .embed-note"))return;   // two levels deep at most
    const r=rowByName(el.dataset.embed);if(!r){el.classList.add("miss");return;}
    const show=c=>{if(c.kind==="image"){const sz=(el.dataset.size||"").split("x");el.outerHTML=`<img class="rimg emb" data-real="${esc(r.id)}" src="${c.url}" alt="${esc(r.name)}"${sz[0]?` style="width:${+sz[0]}px"`:""}>`;}
      else if(c.kind==="text"&&r.ext==="md"){const txt=el.dataset.sub?mdSection(c.text,el.dataset.sub)??c.text:c.text;const box=document.createElement("div");box.className="embed-note";box.innerHTML=`<div class="eh" data-real="${esc(r.id)}">${esc(r.name.replace(/\.md$/,""))}${el.dataset.sub?" › "+esc(el.dataset.sub):""}</div>`+renderMarkdown(txt,{resolve:realWl,t,inner:true});el.replaceWith(box);hydrate(box,m);}
      else el.innerHTML=`<span class="wl" data-real="${esc(r.id)}">${esc(r.name)}</span>`;};
    const c=realContent.get(r.id);if(c)show(c);else B.read(r.id).then(x=>{realContent.set(r.id,x);show(x);}).catch(()=>{});});}
// links in notes: copy external URLs (NEURAL OS opens nothing on the internet by itself), footnotes jump
ovRoot.addEventListener("click",e=>{const a=e.target.closest("a.ext[data-href]");if(a){e.preventDefault();if(navigator.clipboard)navigator.clipboard.writeText(a.dataset.href).then(()=>toast(tf("mdLinkCopied",{u:a.dataset.href})),()=>{});return;}
  const fn=e.target.closest("[data-fn]");if(fn){const b=fn.closest(".body"),x=b&&b.querySelector("#fn-"+fn.dataset.fn);if(x)x.scrollIntoView({block:"center",behavior:"smooth"});}});
function contentBody(c,wl){let body;if(c.kind==="text"&&c.ext==="extracted")body=`<p class="hint" style="margin:0 0 6px">${tf(c.pages>1?"cExtractedP":"cExtracted",{t:String(c.from||"").toUpperCase(),n:c.pages})}</p><pre class="extracted">${esc(c.text.slice(0,200000))}</pre>`;
  else if(c.kind==="text")body=c.ext==="md"?noteHtml(c.text,wl):c.ext==="txt"?`<pre class="plain">${esc(c.text.slice(0,200000))}</pre>`:`<pre class="mono code">${esc(c.text.slice(0,200000))}</pre>`;
  else if(c.kind==="image")body=`<img class="rimg" src="${c.url}" alt="">`;
  else body=`<p class="hint">${t(c.reason==="size"?"cTooBig":c.reason==="missing"?"cMissing":c.reason==="notext"?"cNoText":c.reason==="pending"?"cPending":"cNoPreview")}</p>`;
  return body;}
/* ---------- imported brains: panel for a foreign note (read-only), copy into my library ---------- */
function bWl(d){const m=new Map();for(const f of d.files){const k=stemOf(f.name);if(!m.has(k))m.set(k,f.id);}return name=>{const id=m.get(stemOf(name.split("/").pop()));return id?` data-bfile="${esc(id)}"`:"";};}
BODY.bnode=()=>{const d=curB&&BR.data.get(curB.brain),info=curB&&BR.list.find(x=>x.id===curB.brain);if(!d||!info)return `<p class="hint">${t("noLinksYet")}</p>`;
  const fb=FB.brains.find(x=>x.id===curB.brain),dot=`<span class="bdot" style="background:${fb?cssCol(fb.tint):"transparent"}"></span>`;
  const by=`<p class="hint bby">${dot}${esc(tf("bFrom",{b:info.name,a:info.author||t("bNoAuthor")}))}<span class="ro">${t("readOnly")}</span></p>`;
  const frow=f=>`<div class="row" data-bfile="${esc(f.id)}" style="cursor:pointer"><span class="n">${esc(f.name)}</span><span class="m">${esc(f.ext||"—")} · ${fmtB(f.size)}</span></div>`;
  if(curB.fid===undefined){const files=d.files.filter(f=>(f.project||"")===curB.project);
    return `<div class="tbar"><span class="typ">${t("k_project")}</span><b style="font-size:13px;color:var(--white)">${esc(curB.project||t("noProject"))}</b></div>`+by+`<div class="btns" style="margin-top:0"><button class="btn sm" type="button" data-x="bcopyall">${tf("bCopyAll",{n:files.length.toLocaleString()})}</button></div><div class="sec">${t("libFiles")} · ${files.length}</div><div class="list">${files.slice(0,300).map(frow).join("")}</div>`;}
  const f=d.files.find(x=>x.id===curB.fid);if(!f)return by;
  const head=`<div class="tbar"><span class="typ">${t("k_"+(/^(md|txt)$/.test(f.ext)?"note":"file"))}</span><b style="font-size:13px;color:var(--white)">${esc(f.name)}</b><span class="sp"></span><button class="btn sm" type="button" data-x="bflyf">${t("showInBrain")}</button></div>`;
  let content;if(st.privacy)content=`<p class="hint">${t("privHidden")}</p>`;else{const key=curB.brain+"|"+f.id,c=BR.content.get(key);
    if(!c){const B=brainsBridge();if(B)B.read(curB.brain,f.id).then(x=>{BR.content.set(key,x);if(curB&&curB.fid===f.id)refreshOv("bnode");}).catch(()=>{});content=`<p class="hint">…</p>`;}else content=contentBody(c,bWl(d));}
  const byId=new Map(lib.rows.map(x=>[x.id,x])),byF=new Map(d.files.map(x=>[x.id,x]));
  const brs=d.bridges.files.filter(x=>x.theirs===f.id).map(x=>{const o=byId.get(x.mine);return o?`<div class="row" data-real="${esc(o.id)}" style="cursor:pointer"><span class="n">${esc(nm(o.name,"f"))}</span><span class="m">${esc(t("bWhy_"+x.why))}</span></div>`:"";}).join("");
  const L=d.links.filter(l=>l.from===f.id||l.to===f.id).map(l=>byF.get(l.from===f.id?l.to:l.from)).filter(Boolean);
  return head+by+`<div class="btns" style="margin-top:0"><button class="btn sm pri" type="button" data-x="bcopy">${t("bCopy")}</button></div>`
   +`<div class="sec">${t("content")}<span class="ro">${t("readOnly")}</span></div><div class="rcontent">${content}</div>`
   +`<div class="sec">${t("bBridgesH")}</div>${brs?`<div class="list">${brs}</div>`:`<p class="hint">${t("bNoBridge")}</p>`}`
   +(L.length?`<div class="sec">${t("bLinksH")}</div><div class="list">${L.slice(0,200).map(frow).join("")}</div>`:"")
   +`<div class="sec">${t("fileInfo")}</div><div class="kv"><span>${t("k_file")}</span><span>${esc((f.ext||"—").toUpperCase())} · ${fmtB(f.size)}</span><span>${t("projectL")}</span><span>${esc(f.project||t("noProject"))}</span></div>`;};
// load the list of imported brains and show the visible ones next to mine
let brainsLoading=null;
function refreshBrains(){const B=brainsBridge();if(!B)return Promise.resolve();if(brainsLoading)return brainsLoading;
  brainsLoading=B.list().then(async L=>{BR.list=L;BR.ready=true;const out=[];
    for(const b of L.filter(x=>x.visible)){let d=BR.data.get(b.id);if(!d){d=await B.data(b.id);if(d)BR.data.set(b.id,d);}if(d)out.push({id:b.id,name:b.name,author:b.author,data:d});}
    const had=FB.brains.length;FB.setBrains(out);if(!had&&out.length){goal.r=Math.max(goal.r,DEF.r*1.45);}dirty=true;wake();refreshOv("memory");refreshOv("bnode");}).catch(()=>{}).finally(()=>{brainsLoading=null;});return brainsLoading;}
function planBrain(){const B=brainsBridge();if(!B)return;B.plan(exportOpts(BR.exp,t("bDefaultName"))).then(P=>{BR.plan=P;if(memTab==="brains")refreshOv("memory");}).catch(()=>{});}
function loadBrainsUi(){if(!brainsBridge())return;if(!BR.ready)refreshBrains();if(!BR.plan)planBrain();}
{const B=brainsBridge();if(B){B.onProgress(p=>{BR.prog=p;if(memTab==="brains"&&open.has("memory")){const bar=document.querySelector('[data-m="memory"] .bar i');if(bar)bar.style.width=(p.total?Math.round(p.done/p.total*100):0)+"%";}});setTimeout(refreshBrains,400);}}
function brainCopy(ids){const B=brainsBridge();if(!B||!curB)return;B.copy(curB.brain,ids).then(R=>{toast(tf("bCopied",{n:(R.imported||0).toLocaleString(),d:(R.duplicates||0).toLocaleString()}));refreshLibrary(onLib);}).catch(e=>toast(tf("bFailed",{e:String(e&&e.message||e)})));}
BODY.node=()=>{const N=NODES[curNode];if(!N)return "";const head=`<div class="tbar"><span class="typ">${t("k_"+N.k)}</span><b style="font-size:13px;color:var(--white)">${esc(nodeName(N))}</b><span class="sp"></span><button class="btn sm" type="button" data-x="flynode">${t("showInBrain")}</button></div>`;
  if(N.k==="project"){const P=PROJ[N.label];return head+`<div class="kv"><span>${t("mNotes")}</span><span>${fmtN(P.notes)}</span><span>${t("mFiles")}</span><span>${fmtN(P.files)}</span><span>${t("mLinks")}</span><span>${fmtN(P.links)}</span><span>${t("mSess")}</span><span>${P.sess}</span></div><div class="btns"><button class="btn" type="button" data-x="openproj:${esc(N.label)}">${t("open")}</button></div><p class="hint"><span class="tag">${t("demo")}</span></p>`;}
  if(N.k==="claudemd"){const c=CLAUDEMD[N.cm];return head+`<div class="kv"><span>${t("src")}</span><span class="mono">${st.privacy?"…":"~/"+esc(N.proj)+"/CLAUDE.md"}</span></div><div class="prev" style="margin-top:10px">${mdRender(c.md)}</div><div class="note-ok">${t("claudeMdNote")}</div><div class="btns"><button class="btn" type="button" data-x="diff">${t("editCM")}</button></div><p class="hint"><span class="tag">${t("demo")}</span></p>`;}
  const i=N.fi,F=FILES[i],fx=FX[i];
  return head+`<div class="kv"><span>${t("k_"+N.k)}</span><span>${fx.ty.toUpperCase()} · ${esc(F.s)}</span><span>${t("loc")}</span><span class="mono">${st.privacy?"…":"Library/"+esc(F.p)+"/"}</span><span>${t("src")}</span><span class="mono">${st.privacy?"…":(F.p==="Personal"?"D:/Vault/Personal/":"D:/Projects/"+esc(F.p)+"/")}</span>
   <span>${t("imported")}</span><span>${fx.imp}</span><span>${t("modified")}</span><span>${fx.mod}</span><span>${t("projectL")}</span><span>${esc(nm(F.p,"p"))}</span><span>${t("tagsL")}</span><span>${fx.tags.map(x=>"#"+x).join(" ")||"—"}</span><span>Status</span><span>${stPill(fx.st)}</span></div>
  <div class="sec">${t("previewL")}</div>${noteText[i]?`<div class="prev" style="max-height:160px;overflow:auto">${mdRender(noteText[i])}</div>`:fx.ty==="png"?`<div class="previmg">PNG</div><div class="sec">${t("extracted")} <span class="gen">${t("generated")}</span></div><p class="hint" style="margin:0">${st.privacy?t("privHidden"):esc(fx.ocr)}</p>`:`<div class="note-w">${fx.st==="failed"?tf("failedD",{e:fx.err}):fx.ty==="luau"?esc(st.privacy?t("privHidden"):fx.txt.split("\n")[2]):t("nameOnlyD")}</div>`}
  <div class="sec">${t("summaryL")}</div><p class="hint" style="margin:0">${t("noSummary")}</p>
  <div class="sec">${t("linksOut")} · ${t("linksIn")}</div><div class="list">${[...linksOf(i).map(j=>["→",j]),...backlinksOf(i).map(j=>["←",j])].map(([d,j])=>`<div class="row" data-note="${j}" style="cursor:pointer"><span class="m">${d}</span><span class="n">${esc(nm(FILES[j].n,"f"))}</span></div>`).join("")||`<p class="hint" style="margin:0">—</p>`}</div>
  <div class="sec">${t("claudeTrace")}</div><div class="list"><div class="row"><span class="n">${t("e_Read")}</span><span class="m">14:02 · ${esc(nm(F.p,"p"))}</span></div></div>
  <div class="btns"><button class="btn" type="button" data-x="opennote:${i}">${t("open")}</button><button class="btn" type="button" data-x="toast:rename">${t("actRename")}</button><button class="btn" type="button" data-x="toast:tags">${t("actTags")}</button><button class="btn" type="button" data-x="toast:links">${t("actLinks")}</button></div>
  <p class="hint"><span class="tag">${t("demo")}</span></p>`;};

/* ---------- palette: notes fly to their node; full-text hits with excerpt; demo flows ---------- */
const _palItems=palItems;
palItems=function(){return _palItems().filter(x=>x.kind!=="note").concat(FILES.map((F,i)=>({label:nm(F.n,"f"),kind:"note",run:()=>openNote(i,true)})),
  [["dm_welcome",()=>welcome(0)],["dm_import",()=>importDlg({n:18412,bytes:80.4e9,name:"Obsidian Vault"})],["dm_diff",()=>diffDlg("hooks")],["dm_conflict",conflictDlg],["dm_index",()=>startIndex("Obsidian Vault",18412)]].map(([k,f])=>({label:"Demo · "+t(k),kind:"action",run:f})));};
renderPal=function(){pItems=paletteMatches(palItems(),pin.value,{files:FILES,srcOf:noteSrc,nameOf:F=>nm(F.n,"f"),hitKind:t("searchHit"),open:i=>openNote(i,true),privacy:st.privacy});pSel=Math.min(pSel,Math.max(0,pItems.length-1));
  pres.innerHTML=pItems.map((x,i)=>`<div class="row${i===pSel?" sel":""}" data-i="${i}"><span class="n">${esc(x.label)}${x.ex?`<small style="display:block;color:var(--silver);font-size:11px">${esc(x.ex)}</small>`:""}</span><span class="m">${esc(x.kind)}</span></div>`).join("");};

/* ---------- activity: sessions, live, history, replay ---------- */
let actTab="live",hq="",hs="",ht="",hd="all";const sessState={"Roblox Game":"show","NEURAL OS":"show"};
let histCleared=false;
const rp={i:0,on:false,speed:1,timer:null};
function sessBar(){return `<div class="sec">${t("sessions")}</div>${SESS.map(s=>`<div class="sess${sessState[s.id]==="off"?" off":""}"><span class="n">${esc(nm(s.id,"p"))}<small>${s.start} · ${s.sid}</small></span><span class="seg sm">${[["show","sShow"],["mute","sMute"],["off","sOff"]].map(([k,l])=>`<button type="button" data-x="sess:${esc(s.id)}:${k}" class="${sessState[s.id]===k?"on":""}">${t(l)}</button>`).join("")}</span></div>`).join("")}
  <div class="sess off"><span class="n">${t("cloudSess")}<small>${t("notObs")}</small></span><span class="pill mute">${t("notObs")}</span></div><p class="hint" style="margin-top:4px">${t("sessHint")}</p>`;}
function histRows(){if(histCleared)return `<p class="hint" style="margin:0">${t("cleared")}</p>`;
  const now=log.map(E=>["dToday",E.time.slice(0,5),E.s||"",E.k,E.x]);const all=[...now,...HIST];
  const L=all.filter(h=>(!hs||h[2]===hs)&&(!ht||h[3]===ht)&&(hd==="all"||(hd==="today"?h[0]==="dToday":h[0]!=="12.11"||true))&&(!hq||(h[4]+" "+t("e_"+(h[3]==="mcp"?"mcp":h[3]))).toLowerCase().includes(hq.toLowerCase())));
  let last="",html="";for(const h of L){const d=h[0]==="dToday"?t("dToday"):h[0]==="yesterday"?t("yesterday"):h[0];if(d!==last){html+=`<div class="evmin">${esc(d)}</div>`;last=d;}
    html+=`<div class="evc${h[3]==="Error"?" err":h[3]==="Stop"?" ok":""}"><span class="t">${h[1]}</span><span class="d">${esc(t(h[3]==="mcp"?"e_mcp":"e_"+h[3]))} <span class="mono">${esc(/\.\w+$/.test(h[4])?nm(h[4],"f"):h[4])}</span></span><span class="r">${esc(nm(h[2],"p"))}</span></div>`;}
  return html||`<p class="hint" style="margin:0">${t("noEv")}</p>`;}
const _actBody=BODY.activity;
BODY.activity=()=>{const tabs=`<div class="tabs">${[["live","tabLive"],["hist","tabHist"],["replay","tabReplay"]].map(([k,l])=>`<button type="button" data-x="atab:${k}" class="${actTab===k?"on":""}">${t(l)}</button>`).join("")}</div>`;
  if(actTab==="hist")return tabs+`<div class="fld"><input id="hq" class="inp" placeholder="${esc(t("hSearch"))}" value="${esc(hq)}"></div>
   <div class="fld"><select class="inp" data-x="hs"><option value="">${t("allSess")}</option>${SESS.map(s=>`<option value="${esc(s.id)}"${hs===s.id?" selected":""}>${esc(nm(s.id,"p"))}</option>`).join("")}</select>
   <select class="inp" data-x="ht"><option value="">${t("allTypes")}</option>${["Read","Edit","Bash","WebSearch","TodoWrite","Skill","mcp","Agent","Error","Stop"].map(k=>`<option value="${k}"${ht===k?" selected":""}>${t(k==="mcp"?"e_mcp":"e_"+k)}</option>`).join("")}</select>
   <select class="inp" data-x="hd">${[["today","dToday"],["week","dWeek"],["all","dAll"]].map(([k,l])=>`<option value="${k}"${hd===k?" selected":""}>${t(l)}</option>`).join("")}</select></div>
   <div class="list" id="hlist" style="gap:0">${histRows()}</div>
   <div class="set"><span>${t("retention")}</span><select class="inp" data-x="ret" style="flex:0 0 130px">${["r30","r90","r365","rInf"].map(k=>`<option value="${k}"${(st.ret||"r90")===k?" selected":""}>${t(k)}</option>`).join("")}</select></div>
   <div class="btns"><button class="btn" type="button" data-x="clearhist">${t("clearHist")}</button></div><p class="hint"><span class="tag">${t("demo")}</span></p>`;
  if(actTab==="replay")return tabs+`<div class="sec">${t("replaySess")}</div><div class="row"><span class="n">${esc(nm(RPL.name,"p"))}</span><span class="m">${t("yesterday")} ${RPL.when} · ${tf("evCount",{n:RPL.ev.length})}</span></div>
   <div class="player"><button class="btn" type="button" data-x="rp:play" id="rpbtn" aria-label="Play">${rp.on?"❚❚":"▶"}</button><input type="range" id="rpos" min="0" max="${RPL.ev.length-1}" value="${rp.i}"><span class="mono" id="rpc" style="font-size:10.5px;color:var(--silver)">${rp.i+1}/${RPL.ev.length}</span></div>
   <div class="set"><span>${t("speed")}</span><span class="seg sm">${[1,2,4].map(s=>`<button type="button" data-x="rp:speed:${s}" class="${rp.speed===s?"on":""}">${s}×</button>`).join("")}</span></div>
   <div class="nowev" id="rpnow">${REGN(RPL.ev[rp.i])}</div><p class="hint">${t("replayNote")}</p><p class="hint" style="margin-top:4px"><span class="tag">${t("demo")}</span></p>`;
  return tabs+sessBar()+_actBody();};
/* ---------- real Claude Code monitoring (Phase 3, spec 6 + S1); helpers in ui/monitor.js ---------- */
const _actDemo=BODY.activity;
const hhmm=iso=>new Date(iso).toTimeString().slice(0,5);
const dayOf=iso=>new Date(iso).toLocaleDateString(lang==="de"?"de-DE":"en-GB",{day:"2-digit",month:"2-digit",year:"numeric"});
const sessName=s=>s&&s.cwd?nm(pathBase(s.cwd),"p"):t("notAvail");
const monEvText=e=>{const k=eventKey(e),d=eventDetail(e);return `${esc(k==="m_other"?e.hook:t(k))}${d?` <span class="mono">${esc(e.file_path?nm(d,"f"):d)}</span>`:""}`;};
function monEvRow(e,withSess){const s=withSess?mon.sessions.find(x=>x.id===e.session_id):null;const reg=!e.region||e.region==="other"?"—":REGN(e.region);
  return `<div class="evc${e.type==="tool_failed"?" err":e.type==="turn_finished"||e.type==="session_ended"?" ok":""}" data-reg="${e.region}"${e.file_id?` data-real="${esc(e.file_id)}" style="cursor:pointer"`:""}><span class="t">${hhmm(e.received_at)}</span><span class="d">${monEvText(e)}</span><span class="r">${withSess?esc(sessName(s)):reg}</span></div>`;}
const textDiffHtml=(before,after,h)=>{const D=compactDiff(lineDiff(before,after),3);return `<div class="diff" style="max-height:${h||260}px;margin-top:8px">${D.map(([o,l])=>o==="…"?`<div class="hd">… ${l} …</div>`:`<div class="${o==="+"?"add":o==="-"?"del":"ctx"}">${esc(l)}</div>`).join("")}</div>`;};
function monConnect(){const S=mon.status;if(!mon.ready||!S)return `<div class="sec">${t("monTitle")}</div><p class="hint">…</p>`;
  let h=`<div class="sec">${t("monTitle")}</div>`;
  if(mon.plan){const P=mon.plan;if(P.error)return h+`<p class="hint">${esc(t(P.error==="noNode"?"monNoNode":"monBadSettings"))}</p><div class="btns"><button class="btn" type="button" data-x="mon:cancel">${t("cancel")}</button></div>`;
    const D=compactDiff(lineDiff(P.before,P.after),3),ds=diffStats(D);
    return h+`<p class="hint" style="margin-top:0">${t(mon.planRemove?"monRemoveTxt":"monConsentTxt")}</p>
     <div class="kv"><span>${t("monFile")}</span><span class="mono">${esc(P.path)}</span><span>${t("monChange")}</span><span>+${ds.add} / −${ds.del}</span></div>
     <div class="diff" style="max-height:260px;margin-top:8px">${D.map(([o,l])=>o==="…"?`<div class="hd">… ${l} …</div>`:`<div class="${o==="+"?"add":o==="-"?"del":"ctx"}">${esc(l)}</div>`).join("")}</div>
     <p class="hint">${t(mon.planRemove?"monRemoveNote":"monConsentNote")}</p>
     <div class="btns"><button class="btn pri" type="button" data-x="mon:apply">${t(mon.planRemove?"monDisconnect":"monConnect")}</button><button class="btn" type="button" data-x="mon:cancel">${t("cancel")}</button></div>`;}
  if(S.installed)h+=`<div class="row"><span class="n">${t("monOn")}</span><span class="pill ${S.receiving?"ok":"warn"}">${t(S.receiving?"monReceiving":"monNoReceiver")}</span><button class="btn sm" type="button" data-x="mon:plan:remove">${t("monDisconnect")}…</button></div>`;
  else h+=`<p class="hint" style="margin-top:0">${t("monIntro")}</p><div class="btns"><button class="btn pri" type="button" data-x="mon:plan">${t("monConnect")}…</button></div>`;
  if(mon.result&&mon.result.backup)h+=`<p class="hint">${t("monBackup")} <span class="mono">${esc(st.privacy?"…":mon.result.backup)}</span> <button class="btn sm" type="button" data-x="mon:backups">${t("open")}</button></p>`;
  if(S.outdated)h+=`<p class="hint">${t("monOutdated")}</p><div class="btns"><button class="btn pri" type="button" data-x="mon:plan">${t("monReconnect")}…</button></div>`;
  if(S.installed)h+=`<div class="row"><span class="n">${t("monNotes")}</span><span class="seg sm"><button type="button" data-x="mon:notes:1" class="${mon.notes!==false?"on":""}">${t("on")}</button><button type="button" data-x="mon:notes:0" class="${mon.notes===false?"on":""}">${t("off")}</button></span></div><p class="hint" style="margin-top:2px">${t("monNotesHint")}</p>`;
  if(S.settingsError)h+=`<p class="hint">${t("monBadSettings")}</p>`;
  return h;}
function monSessions(){const L=mon.sessions.slice(0,8);if(!L.length)return `<div class="sec">${t("sessions")}</div><p class="hint">${t("monNoSess")}</p>`;
  return `<div class="sec">${t("sessions")}</div>${L.map(s=>{const state=s.excluded?"off":s.muted?"mute":"show";
   return `<div class="sess${s.excluded?" off":""}${mon.sel===s.id?" sel":""}"><span class="n" data-x="mon:sel:${esc(s.id)}" style="cursor:pointer">${isActive(s)?"● ":""}${esc(sessName(s))}<small>${dayOf(s.started_at)} ${hhmm(s.started_at)} · ${esc(s.model||t("monModelNA"))} · ${tf("evCount",{n:s.events})}${s.device_name?" · "+esc(tf("syncFrom",{d:s.device_name})):""} · ${esc(s.id.slice(0,8))}</small></span>${lib.rows.some(r=>r.id==="session-"+s.id)?`<button class="btn sm" type="button" data-real="session-${esc(s.id)}">${t("monNote")}</button>`:""}<span class="seg sm">${[["show","sShow"],["mute","sMute"],["off","sOff"]].map(([k,l])=>`<button type="button" data-x="mon:sess:${esc(s.id)}:${k}" class="${state===k?"on":""}">${t(l)}</button>`).join("")}</span></div>`;}).join("")}
   <p class="hint" style="margin-top:4px">${t("sessHint")}</p>`;}
function monTimeline(byDay){const L=timelineEvents(mon.events).filter(e=>!mon.sel||e.session_id===mon.sel).slice(0,byDay?300:80);
  if(!L.length)return `<p class="hint" style="margin:0">${t("noEv")}</p>`;
  let html="",last="";for(const e of L){const k=byDay?dayOf(e.received_at):hhmm(e.received_at);if(k!==last){html+=`<div class="evmin">${esc(k)}</div>`;last=k;}html+=monEvRow(e,!mon.sel);}
  return html;}
function changesBody(){if(!mon.changes.length)return `<p class="hint" style="margin-top:0">${t("chNone")}</p>`;
  let h="";
  if(mon.change){const C=mon.change,D=lineDiff(C.before_text,C.after_text),ds=diffStats(D),cd=compactDiff(D,3);
    h+=`<div class="tbar"><b style="font-size:13px;color:var(--white)">${esc(nm(pathBase(C.file_path),"f"))}</b><span class="sp"></span>${C.file_id?`<button class="btn sm" type="button" data-real="${esc(C.file_id)}">${t("showInBrain")}</button>`:""}<button class="btn sm" type="button" data-x="mon:chclose">${t("close")}</button></div>
     <div class="kv"><span>${t("chWhen")}</span><span>${dayOf(C.at)} ${hhmm(C.at)} · ${esc(C.tool)}</span><span>${t("chBefore")}</span><span>${t("chHow_"+C.how)}</span><span>${t("monChange")}</span><span>+${ds.add} / −${ds.del}</span></div>
     ${st.privacy?`<p class="hint">${t("privHidden")}</p>`:C.after_text==null&&C.before_text==null?`<p class="hint">${t("notAvail")}</p>`:`<div class="diff" style="max-height:340px;margin-top:8px">${cd.map(([o,l])=>o==="…"?`<div class="hd">… ${l} …</div>`:`<div class="${o==="+"?"add":o==="-"?"del":"ctx"}">${esc(l)}</div>`).join("")}</div>`}
     <p class="hint">${t("chRestoreNote")}</p>`;}
  const L=mon.changes.filter(c=>!mon.sel||c.session_id===mon.sel);
  h+=`<div class="sec">${t("tabChanges")} · ${L.length}</div><div class="list" style="gap:0">${L.slice(0,200).map(c=>`<div class="evc${mon.change&&mon.change.id===c.id?" sel":""}" data-x="mon:ch:${esc(c.id)}" style="cursor:pointer"><span class="t">${hhmm(c.at)}</span><span class="d">${esc(c.tool)} <span class="mono">${esc(nm(pathBase(c.file_path),"f"))}</span></span><span class="r">${esc(sessName(mon.sessions.find(s=>s.id===c.session_id)))}</span></div>`).join("")}</div>
   <p class="hint">${t("chHint")}</p>`;
  return h;}
function claudeTrace(r){if(!monBridge())return "";const E=mon.events.filter(e=>e.file_id===r.id&&(e.type==="tool_finished"||e.type==="tool_failed")).slice(0,6),C=mon.changes.filter(c=>c.file_id===r.id).slice(0,6);
  if(!E.length&&!C.length)return "";
  return `<div class="sec">${t("claudeTrace")}</div><div class="list" style="gap:0">${E.map(e=>monEvRow(e,true).replace(/ data-real="[^"]*" style="cursor:pointer"/,"")).join("")}${C.map(c=>`<div class="evc" data-x="mon:ch:${esc(c.id)}" style="cursor:pointer"><span class="t">${hhmm(c.at)}</span><span class="d">${t("chOpen")}</span><span class="r">${esc(c.tool)}</span></div>`).join("")}</div>`;}
BODY.activity=()=>{const real=!!monBridge(),live=real&&isLive();
  const tabs=`<div class="tabs">${[["live","tabLive"],["hist","tabHist"],...(real?[["changes","tabChanges"],["learn","tabLearn"],["agents","tabAgents"]]:[]),["replay","tabReplay"]].map(([k,l])=>`<button type="button" data-x="atab:${k}" class="${actTab===k?"on":""}">${t(l)}</button>`).join("")}</div>`;
  if(actTab==="changes")return tabs+changesBody();
  if(actTab==="learn")return tabs+lessonsBody();
  if(actTab==="agents")return tabs+agentsBody();
  if(!live||actTab==="replay"){const d=_actDemo();if(!real)return d;   // demo view keeps its own tabs; swap them for ours
    return tabs+(actTab==="live"?recapBlock()+monConnect():"")+d.slice(d.indexOf("</div>")+6);}
  const filt=mon.sel?`<div class="row"><span class="n">${t("monOnly")} ${esc(sessName(mon.sessions.find(s=>s.id===mon.sel)))}</span><button class="btn sm" type="button" data-x="mon:sel:">${t("all")}</button></div>`:"";
  if(actTab==="hist")return tabs+filt+`<div class="list" style="gap:0">${monTimeline(true)}</div><p class="hint">${t("monHistHint")}</p>`;
  return tabs+recapBlock()+overlapBlock()+monConnect()+monSessions()+`<div class="sec">${t("timeline")}</div>`+filt+`<div class="list" style="gap:0">${monTimeline(false)}</div><p class="hint">${t("monLiveHint")}</p>`;};
/* ---------- lesson book: Claude's LESSON lines per project, the user decides what counts ---------- */
const LES={projects:null,sel:null,data:null,edit:null,loading:false};
function loadLessons(){const MB=monBridge();if(!MB||!MB.lessonProjects||LES.loading)return;LES.loading=true;
  MB.lessonProjects().then(P=>{LES.projects=P;if(LES.sel===null||!P.some(x=>x.project===LES.sel))LES.sel=P.length?P[0].project:"";return MB.lessons(LES.sel);})
   .then(D=>{LES.data=D;}).catch(()=>{}).finally(()=>{LES.loading=false;if(actTab==="learn")refreshOv("activity");});}
function lessonsBody(){if(!LES.projects){loadLessons();return `<p class="hint">…</p>`;}
  const R=mon.rule,C=mon.ctx,warn=[];
  if(!R||!R.installed||(R.version||0)<3)warn.push(`<div class="note-w">${t("lesRuleOld")}<div class="btns" style="margin-top:6px"><button class="btn sm" type="button" data-x="setgo:connectors:">${t("lesGoRule")}</button></div></div>`);
  else if(!C||!C.installed)warn.push(`<div class="note-w">${t("lesNeedCtx")}<div class="btns" style="margin-top:6px"><button class="btn sm" type="button" data-x="setgo:connectors:">${t("lesGoRule")}</button></div></div>`);
  const P=LES.projects,D=LES.data||{lessons:[],observed:[]};
  const sel=P.length?`<div class="fld"><select class="inp" data-x="lesproj">${P.map(x=>`<option value="${esc(x.project)}"${x.project===LES.sel?" selected":""}>${esc(x.project||t("lesAll"))}${x.fresh?` · ${tf("lesFresh",{n:x.fresh})}`:""}</option>`).join("")}</select></div>`:"";
  const row=l=>{const ed=LES.edit===l.id;
    return `<div class="les ${l.status}"><div class="lt"><span class="pill ${l.status==="kept"?"ok":l.status==="new"?"warn":"mute"}">${t("les_"+l.status)}</span><span class="m">${t(l.source==="user"?"lesByYou":"lesByClaude")} · ${esc(new Date(l.updated_at).toLocaleDateString(lang==="de"?"de-DE":"en-US"))}</span></div>
     ${ed?`<textarea id="lesedit" class="inp" rows="3">${esc(l.text)}</textarea>`:`<p class="lx">${esc(l.text)}</p>`}
     <div class="btns">${ed?`<button class="btn sm pri" type="button" data-x="les:save:${l.id}">${t("lesSave")}</button><button class="btn sm" type="button" data-x="les:cancel:${l.id}">${t("cancel")}</button>`
      :(l.status!=="kept"?`<button class="btn sm${l.status==="new"?" pri":""}" type="button" data-x="les:kept:${l.id}">👍 ${t("lesKeep")}</button>`:"")+(l.status!=="dropped"?`<button class="btn sm" type="button" data-x="les:dropped:${l.id}">👎 ${t("lesDrop")}</button>`:"")+`<button class="btn sm" type="button" data-x="les:edit:${l.id}">${t("lesEdit")}</button><button class="btn sm" type="button" data-x="les:del:${l.id}">${t("lesDel")}</button>`}</div></div>`;};
  const L=D.lessons,obs=D.observed||[];
  return `<p class="hint" style="margin-top:0">${t("lesIntro")}</p>`+warn.join("")+sel
   +(L.length?`<div class="sec">${t("lesH")} · ${L.filter(l=>l.status==="kept").length} ${t("les_kept")}</div>${L.map(row).join("")}`:`<p class="hint">${t(P.length?"lesNone":"lesNoProject")}</p>`)
   +(P.length?`<div class="sec">${t("lesOwn")}</div><div class="fld"><input id="lesnew" class="inp" placeholder="${esc(t("lesOwnPh"))}"><button class="btn sm" type="button" data-x="les:add:">${t("lesAdd")}</button></div>`:"")
   +(obs.length?`<div class="sec">${t("lesObsH")}</div><div class="list">${obs.map(o=>`<div class="row"><span class="n">${esc(o.tool)}${o.what?` · ${esc(o.what)}`:""}</span><span class="m">${esc(tf("lesObs",{n:o.count,d:new Date(o.last).toLocaleDateString(lang==="de"?"de-DE":"en-US")}))}</span></div>`).join("")}</div><p class="hint">${t("lesObsHint")}</p>`:"")+lessonsFromNotes();}
/* ---------- "while you were away": observed facts since the app was last open ---------- */
const AWAY={data:null,hidden:false};
{const MB=monBridge();let prev=null;try{prev=localStorage.getItem("nos-lastseen");}catch(_){}
  const mark=()=>{try{localStorage.setItem("nos-lastseen",new Date().toISOString());}catch(_){}};
  if(MB&&MB.recap){if(prev&&Date.now()-Date.parse(prev)>10*60e3)MB.recap(prev).then(R=>{if(!R||!R.sessions.length)return;AWAY.data=R;toast(tf("rcToast",{n:R.sessions.length}));refreshOv("activity");}).catch(()=>{});
    mark();setInterval(()=>{if(!document.hidden)mark();},60e3);addEventListener("beforeunload",mark);}}
function recapBlock(){const R=AWAY.data;if(!R||AWAY.hidden)return "";const P=st.privacy;
  const dt=iso=>dayOf(iso)+" "+hhmm(iso);
  return `<div class="recap"><div class="sec" style="margin-top:0">${t("rcAway")}<span class="sp"></span><button class="btn sm" type="button" data-x="rchide">${t("grHide")}</button></div>
  <p class="hint" style="margin-top:0">${esc(tf("rcSince",{d:dt(R.since),n:R.sessions.length,t:R.tools,f:R.failed,c:R.files.length}))}</p>
  ${R.sessions.map(x=>`<div class="les"><div class="lt"><span class="m">${esc(P?"…":x.project||t("notAvail"))} · ${esc(dt(x.started_at))}–${hhmm(x.last_at)}</span><span class="m">${esc(tf("rcTools",{n:x.tools,f:x.failed,c:x.changes}))}</span></div>
   ${x.summaries.length?x.summaries.map(y=>`<p class="lx">${esc(P?"…":y)}</p>`).join(""):`<p class="hint" style="margin:2px 0">${t("rcNoSummary")}</p>`}
   ${x.lessons.map(y=>`<p class="lx"><b>${t("rcLesson")}:</b> ${esc(P?"…":y)}</p>`).join("")}
   <div class="btns"><button class="btn sm" type="button" data-x="mon:sel:${esc(x.id)}">${t("rcShow")}</button></div></div>`).join("")}
  ${R.files.length?`<div class="chips">${R.files.slice(0,16).map(f=>`<span class="chip"${f.file_id?` data-real="${esc(f.file_id)}" style="cursor:pointer"`:""}>${esc(P?"…":pathBase(f.path))}<em>${f.changes}</em></span>`).join("")}</div>`:""}
  <p class="hint">${t("awHint")}</p></div>`;}
/* ---------- two sessions on one file (warning only) ---------- */
const OVL={data:[],n:0,t:0};
function loadOverlaps(){const MB=monBridge();if(!MB||!MB.overlaps||Date.now()-OVL.t<4000)return;OVL.t=Date.now();
  MB.overlaps(24).then(L=>{const before=OVL.n;OVL.data=L||[];OVL.n=OVL.data.length;if(OVL.n>before&&before>=0&&OVL.seen)toast(tf("ovToast",{f:pathBase(OVL.data[0].file_path)}));OVL.seen=true;if(actTab==="live")refreshOv("activity");}).catch(()=>{});}
function overlapBlock(){if(!OVL.seen)loadOverlaps();const L=OVL.data;if(!L.length)return "";const P=st.privacy;
  return `<div class="note-w"><b>${esc(tf("ovTitle",{n:L.length}))}</b>${L.slice(0,6).map(o=>`<div class="row"${o.file_id?` data-real="${esc(o.file_id)}" style="cursor:pointer"`:""}><span class="n mono">${esc(P?"…":pathBase(o.file_path))}<small style="display:block;font-size:11px">${o.sessions.map(s=>esc((P?"…":sessName(s))+" "+hhmm(s.at)+" ("+s.changes+")")).join(" · ")}</small></span></div>`).join("")}<p class="hint" style="margin:4px 0 0">${t("ovHint")}</p></div>`;}
/* ---------- Memory → Neu: inbox, recently changed, maybe out of date ---------- */
const FR={data:null,busy:false};
function freshBlock(){const B=bridge();if(!B||!B.fresh)return "";if(!FR.data){if(!FR.busy){FR.busy=true;B.fresh().then(d=>{FR.data=d;}).finally(()=>{FR.busy=false;if(memTab==="fresh")refreshOv("memory");});}return `<p class="hint">…</p>`;}
  const D=FR.data,P=st.privacy,d=ms=>ms?new Date(ms).toLocaleDateString(lang==="de"?"de-DE":"en-GB"):"–";
  const row=(r,i)=>`<div class="row" data-real="${esc(r.id)}" style="cursor:pointer"><span class="n">${esc(P?t("files")+" "+(i+1):r.name.replace(/\.md$/i,""))}</span><span class="m">${esc(P?"…":r.folder||r.project||"")} · ${d(r.mtime)}</span></div>`;
  let h=`<p class="hint" style="margin-top:0">${t("frIntro")}</p>`;
  h+=`<div class="sec">${t("frStale")} · ${D.stale.length}</div>`+(D.stale.length?D.stale.map(s=>`<div class="row hl" data-real="${esc(s.id)}" style="cursor:pointer"><span class="n">${esc(P?"…":s.name.replace(/\.md$/i,""))}<small>${esc(tf("frStaleD",{n:s.reads,d:d(s.mtime)}))}: ${s.newer.map(x=>`<a class="wl" data-real="${esc(x.id)}">${esc(P?"…":x.name)}</a> (${d(x.mtime)})`).join(", ")}</small></span><span class="pill warn">${t("frCheck")}</span></div>`).join(""):`<p class="hint">${t("frStaleNone")}</p>`);
  if(D.inbox.length)h+=`<div class="sec">${t("frInbox")} · ${D.inboxTotal}</div><div class="list">${D.inbox.map(row).join("")}</div>`;
  h+=`<div class="sec">${t("frRecent")}</div><div class="list">${D.recent.map(row).join("")}</div>`;
  return h+`<div class="btns"><button class="btn sm" type="button" data-x="frreload">${t("agReload")}</button></div>`;}
/* ---------- agent board: agents, handoffs, grades and open questions from the user's own notes (read-only) ---------- */
const AG={data:null,loading:false,f:""};
function loadAgents(force){const B=bridge();if(!B||!B.agents||AG.loading||(AG.data&&!force))return;AG.loading=true;
  B.agents().then(D=>{AG.data=D;}).catch(()=>{}).finally(()=>{AG.loading=false;if(actTab==="agents"||actTab==="learn")refreshOv("activity");});}
const agSub=a=>{const ti=a.title.toLowerCase().startsWith(a.name.toLowerCase())?a.title.slice(a.name.length).replace(/^[\s:–-]+/,""):a.title;return [ti,a.officer&&!ti.includes(a.officer)?a.officer:""].filter(Boolean).join(" · ");};
const agDay=s=>s?s.slice(0,10):"";
const agPill=s=>{const k=/^(done|pass|ok)/.test(s)?"ok":/^(fail|failed)/.test(s)?"bad":/^block/.test(s)?"warn":"mute";return `<span class="pill ${k}">${esc(s?t("agSt_"+(k==="ok"?"done":k==="bad"?"failed":k==="warn"?"blocked":"none")):"–")}</span>`;};
function agentsBody(){if(!AG.data){loadAgents();return `<p class="hint">…</p>`;}
  const D=AG.data,P=st.privacy,nmx=(s,i)=>esc(P?t("files")+" "+(i+1):s);
  const none=!D.agents.length&&!D.handoffs.length&&!D.questions.length&&!D.subagents.length&&!(D.phases||[]).length&&!(D.proposals||[]).length;
  let h=`<p class="hint" style="margin-top:0">${t("agIntro")}</p>`;
  if(none)return h+`<p class="hint">${t("agNone")}</p>`;
  if(D.subagents.length)h+=`<div class="sec">${t("agSub")}</div><div class="list">${D.subagents.map(a=>`<div class="row"><span class="n">${esc(a.type||t("notAvail"))}</span><span class="m">${esc(tf("agRuns",{n:a.runs}))}${a.failed?" · "+esc(tf("agFailedN",{n:a.failed})):""} · ${esc(dayOf(a.last))} ${hhmm(a.last)}</span></div>`).join("")}</div>`;
  if(D.agents.length)h+=`<div class="sec">${t("agAgents")} · ${D.agents.length}</div><div class="list">${D.agents.map((a,i)=>`<div class="row" data-real="${esc(a.id)}" style="cursor:pointer"><span class="n">${nmx(a.name,i)}<small style="display:block;color:var(--silver);font-size:11px">${esc(P?"…":agSub(a))}</small></span><span class="m">${esc(tf("agHandoffsN",{n:a.handoffs}))}</span>${a.grade?`<span class="pill ${a.grade[0]==="A"?"ok":a.grade[0]==="B"?"mute":"warn"}" title="${esc(tf("agGradeT",{n:a.graded}))}">${esc(a.grade)}</span>`:""}</div>`).join("")}</div>`;
  if(D.questions.length)h+=`<div class="sec">${t("agQuestions")} · ${D.questions.length}</div><div class="list">${D.questions.map(q=>`<div class="row hl" data-real="${esc(q.id)}" style="cursor:pointer"><span class="n" style="white-space:normal">${esc(P?"…":q.text)}<small>${esc((q.date?q.date+" · ":"")+(P?"":q.note))}</small></span></div>`).join("")}</div>`;
  if(D.phases&&D.phases.length)h+=`<div class="sec">${t("agPhases")} · ${D.phases.length}</div><div class="list">${D.phases.map((x,i)=>{const pc=x.total?Math.round(x.done/x.total*100):0;return `<div class="row hl" data-real="${esc(x.id)}" style="cursor:pointer"><span class="n">${nmx(x.title,i)}<small>${esc(P?"":[x.gates.join(" → "),x.agents.join(", "),x.handoffs?tf("agHandoffsN",{n:x.handoffs}):""].filter(Boolean).join(" · "))}</small></span><span class="m">${x.total?esc(tf("agTasks",{a:x.done,b:x.total})):""}</span><span class="pill ${x.total&&x.done===x.total?"ok":x.handoffs||x.done?"warn":"mute"}">${esc(x.status||(x.total?pc+" %":"–"))}</span></div>`;}).join("")}</div><p class="hint">${t("agPhasesHint")}</p>`;
  if(D.proposals&&D.proposals.length)h+=`<div class="sec">${t("agProps")} · ${D.proposals.length}</div>${D.proposals.map(x=>`<div class="les" data-real="${esc(x.id)}" style="cursor:pointer"><div class="lt"><span class="pill ${/accept|ok|done|angenommen/.test(x.status)?"ok":/reject|drop|abgelehnt/.test(x.status)?"mute":"warn"}">${esc(x.status||"–")}</span><span class="m">${esc((x.date?x.date+" · ":"")+(P?"":x.agent))}</span></div><p class="lx">${esc(P?"…":x.change)}</p>${x.why&&!P?`<p class="hint" style="margin:2px 0">${esc(x.why)}</p>`:""}</div>`).join("")}<p class="hint">${t("agPropsHint")}</p>`;
  if(D.handoffs.length){const F=AG.f,L=D.handoffs.filter(x=>!F||(F==="done"?/^(done|pass|ok)/.test(x.status):F==="failed"?/^fail/.test(x.status):/^block/.test(x.status)));
    h+=`<div class="sec">${t("agHandoffs")} · ${D.handoffTotal}</div><div class="chips">${["","done","failed","blocked"].map(k=>`<button type="button" class="chip${F===k?" on":""}" data-x="agf:${k}">${t(k?"agSt_"+k:"all")}</button>`).join("")}</div>
    <div class="list" style="gap:0">${L.slice(0,80).map((x,i)=>`<div class="evc" data-real="${esc(x.id)}" style="cursor:pointer" title="${esc(P?"":x.next?t("agNext")+": "+x.next:"")}"><span class="t">${esc(x.at?x.at.slice(5):"")}</span><span class="d">${esc(P?"…":x.agent.slice(0,40)+(x.to?" → "+x.to.slice(0,40):""))} · ${nmx(x.task,i)}</span><span class="r">${agPill(x.status)}</span></div>`).join("")}</div>
    ${L.length>80?`<p class="hint">${esc(tf("realLibMore",{a:80,b:L.length}))}</p>`:""}`;}
  return h+`<div class="btns"><button class="btn sm" type="button" data-x="agreload">${t("agReload")}</button></div><p class="hint">${t("agHint")}</p>`;}
function lessonsFromNotes(){if(!bridge()||!bridge().agents)return "";if(!AG.data){loadAgents();return "";}
  const L=AG.data.learnings;if(!L.length)return "";const have=new Set(((LES.data&&LES.data.lessons)||[]).map(l=>l.text.trim()));
  return `<div class="sec">${t("lesNotes")} · ${L.length}</div><p class="hint" style="margin-top:0">${t("lesNotesD")}</p>${L.slice(0,40).map((l,i)=>`<div class="les"><div class="lt"><span class="m">${esc((l.date?l.date+" · ":"")+(st.privacy?"":l.note))}</span></div><p class="lx">${esc(st.privacy?"…":l.text)}</p><div class="btns">${have.has(l.text.trim())?`<span class="pill ok">${t("lesTaken")}</span>`:`<button class="btn sm" type="button" data-x="lestake:${i}">${t("lesTake")}</button>`}<button class="btn sm" type="button" data-real="${esc(l.id)}">${t("lesOpenNote")}</button></div></div>`).join("")}`;}
function monChanged(){loadOverlaps();renderStatic();refreshOv("activity");refreshOv("connectors");refreshOv("setup");if(curReal>=0)refreshNode();}
{const MB=monBridge();if(MB){MB.onEvent(p=>{if(!p||!p.event)return;try{const wasLive=isLive();addLive(p);const e=p.event,s=p.session;
  if(e.type==="lesson_noted"){toast(t("lesNoted"));if(LES.projects)loadLessons();}
  if(e.type==="readiness_report"){const MB2=monBridge();if(s&&!s.muted)scanNerves();if(MB2&&MB2.ruleReports)MB2.ruleReports().then(x=>{mon.reports=x;refreshOv("connectors");});}
  if(s&&!s.muted){const r=REG.indexOf(e.region);if(r>=0){act[r]=1;addPath(lastReg,r);lastReg=r;paint();}
    if(e.file_id){const i=REAL.indexOfFile(e.file_id);if(i>=0)REAL.pulse(i);}dirty=true;wake();}
  if(!wasLive)refreshMonitor(monChanged);else monChanged();}catch(err){console.error(err);}});
  // memory flash (S3): the notes NEURAL OS handed to Claude light up and travel to the Claude nerve
  if(MB.onFlash)MB.onFlash(p=>{try{try{localStorage.setItem(TRIED_KEY,"1");}catch(_){}refreshOv("setup");const ids=(p&&p.ids)||[];let n=0;ids.forEach((id,k)=>{const i=REAL.indexOfFile(id);if(i>=0){n++;setTimeout(()=>{REAL.pulse(i);dirty=true;wake();},k*120);}});
    const m=REG.indexOf("memory"),c=REG.indexOf("connectors");act[m]=1;addPath(m,c);setTimeout(()=>{act[c]=1;paint();dirty=true;wake();},500);paint();dirty=true;wake();
    toast(tf("ctxFlash",{n:ids.length}));}catch(err){console.error(err);}});
  if(MB.setLang)MB.setLang(lang);if(MB.getNotes)MB.getNotes().then(on=>{mon.notes=on;});
  refreshMonitor(monChanged);}}
function rpStep(){const r=REG.indexOf(RPL.ev[rp.i]);if(r>=0){act[r]=1;addPath(lastReg,r);lastReg=r;paint();dirty=true;}
  const a=document.getElementById("rpos"),c=document.getElementById("rpc"),nw=document.getElementById("rpnow");if(a)a.value=rp.i;if(c)c.textContent=(rp.i+1)+"/"+RPL.ev.length;if(nw)nw.textContent=REGN(RPL.ev[rp.i]);}
function rpPlay(on){rp.on=on;clearInterval(rp.timer);const b=document.getElementById("rpbtn");if(b)b.textContent=on?"❚❚":"▶";
  if(on)rp.timer=setInterval(()=>{if(rp.i>=RPL.ev.length-1){rpPlay(false);return;}rp.i++;rpStep();},1100/rp.speed);}

/* ---------- connectors: readiness history + scan animation ---------- */
const _conBody=BODY.connectors;
BODY.connectors=()=>_conBody()+(monBridge()?ctxBlock()+ruleBlock()+guardBlock():`<div class="sec">${t("rcTitle")}</div>
  <div class="lg"><span class="typ">14:01</span><span class="m">${esc(nm("Roblox Game","p"))}</span><span class="x">${t("needs")}: GitHub, Figma, Blender · ${t("result")}: 1 ${t("missing")}, 1 ${t("signin")} · ${t("decision")}: ${t("dec_skip")}, ${t("dec_signin")} · ${t("verified")} ✓</span></div>
  <div class="lg"><span class="typ">12:30</span><span class="m">${esc(nm("NEURAL OS","p"))}</span><span class="x" style="color:var(--silver)">${t("rcNA")}</span></div>
  <div class="row"><span class="n">Figma Dev Mode</span><span class="pill mute">${t("suggested")}</span></div>
  <div class="btns"><button class="btn" type="button" data-x="scan">${t("rcScan")}</button></div>`);
/* Claude Code's own guardrails (permissions, hooks), read-only */
const GR={open:false,data:null};
function guardBlock(){const MB=monBridge();if(!MB||!MB.guardrails)return "";
  let h=`<div class="sec">${t("grTitle")}</div><p class="hint" style="margin-top:0">${t("grIntro")}</p>`;
  if(!GR.open)return h+`<div class="btns"><button class="btn sm" type="button" data-x="grshow">${t("grShow")}</button></div>`;
  if(!GR.data){Promise.all([MB.guardrails(),MB.mcpServers?MB.mcpServers():null]).then(([D,M])=>{GR.data=D;GR.mcp=M;refreshOv("connectors");}).catch(()=>{});return h+`<p class="hint">…</p>`;}
  const P=st.privacy,list=(k,a,cls)=>a.length?`<div class="kv"><span>${t(k)}</span><span></span></div><div class="chips">${a.map(r=>`<span class="chip ${cls}">${esc(P?"…":r)}</span>`).join("")}</div>`:"";
  for(const f of GR.data.files){
    h+=`<div class="gr"><div class="row"><span class="n">${t("grScope_"+f.scope)}<small style="display:block;color:var(--silver);font-size:11px" class="mono">${esc(P?"…":f.path)}</small></span>${!f.found?`<span class="pill mute">${t("grMissing")}</span>`:f.error?`<span class="pill bad">${t("grBadJson")}</span>`:f.defaultMode?`<span class="pill ${f.defaultMode==="bypassPermissions"?"bad":"mute"}">${esc(f.defaultMode)}</span>`:""}</div>`;
    if(f.found&&!f.error){
      h+=list("grDeny",f.deny,"bad")+list("grAsk",f.ask,"warn")+list("grAllow",f.allow,"ok")+list("grDirs",f.dirs,"");
      if(f.hooks.length)h+=`<div class="kv"><span>${t("grHooks")}</span><span>${f.hooks.map(x=>esc(x.event)+(x.ours?` (${esc(tf("grOurs",{n:x.ours,m:x.commands}))})`:` (${x.commands})`)).join(", ")}</span></div>`;
      if(!f.deny.length&&!f.ask.length&&!f.allow.length&&!f.hooks.length&&!f.defaultMode)h+=`<p class="hint">${t("grEmpty")}</p>`;}
    h+=`</div>`;}
  h+=`<p class="hint">${t("grHint")}</p>`;
  const M=GR.mcp;if(M){h+=`<div class="sec">${t("mcTitle")}</div>`;
    h+=M.servers.length?`<div class="list">${M.servers.map(x=>{const k=/roblox/i.test(x.name)?"Roblox Studio":/blender/i.test(x.name)?"Blender":/obs/i.test(x.name)?"OBS":/neural/i.test(x.name)?"NEURAL OS":"";return `<div class="row"><span class="n">${esc(x.name)}${k?` <span class="tag">${esc(k)}</span>`:""}<small style="display:block;color:var(--silver);font-size:11px">${esc(t("mcScope_"+x.scope)+(x.project&&!P?" · "+x.project:"")+" · "+x.type+(x.target&&!P?" · "+x.target:""))}</small></span><span class="m">${x.uses?esc(tf("mcUsed",{n:x.uses,d:dayOf(x.lastUsed)})):esc(t("mcNotUsed"))}</span></div>`;}).join("")}</div>`:`<p class="hint">${t(M.configFound?"mcNone":"mcNoConfig")}</p>`;
    h+=`<p class="hint">${t("mcHint")}</p>`;}
  return h+`<div class="btns"><button class="btn sm" type="button" data-x="grshow">${t("grHide")}</button><button class="btn sm" type="button" data-x="grreload">${t("agReload")}</button></div>`;}
function ctxBlock(){const C=mon.ctx;let h=`<div class="sec">${t("ctxTitle")}</div>`;
  if(!C)return h+`<p class="hint">…</p>`;
  if(mon.ctxPlan){const P=mon.ctxPlan;
    if(P.error)return h+`<p class="hint">${t("monNoNode")}</p><div class="btns"><button class="btn" type="button" data-x="ctx:cancel">${t("cancel")}</button></div>`;
    return h+(P.found?"":`<div class="note warn" style="margin:0 0 8px"><b>${t("ctxWhyTitle")}</b><br>${t("ctxWhy")}</div>`)+`<p class="hint" style="margin-top:0">${t(mon.ctxRemove?"ctxRemoveTxt":"ctxConsentTxt")}</p>${P.found?`<p class="hint">${tf("ctxFoundAt",{p:st.privacy?"…":esc(P.claude)})}</p>`:""}<pre class="mono code" id="ctxcmd">${esc(P.command)}</pre>
     <p class="hint">${t(P.found?"ctxNote":"ctxManual")}</p><div class="btns">${P.found?`<button class="btn pri" type="button" data-x="ctx:apply">${t(mon.ctxRemove?"ruleRemove":"ctxInstall")}</button>`:""}<button class="btn" type="button" data-x="ctx:copy">${t("copy")}</button><button class="btn" type="button" data-x="ctx:cancel">${t("cancel")}</button></div>`;}
  if(mon.ctxErr){const E=mon.ctxErr;h+=`<div class="note warn" style="margin:0 0 8px"><b>${t("ctxFailTitle")}</b><br>${t(E.error==="noClaude"?"ctxWhy":"ctxFailOut")}${E.output?`<pre class="mono code">${esc(String(E.output).slice(0,600))}</pre>`:""}</div>`;}
  if(C.installed)h+=`<div class="row"><span class="n">${t("ctxOn")}</span>${C.outdated?`<button class="btn sm pri" type="button" data-x="ctx:plan">${t("monReconnect")}…</button>`:`<span class="pill ok">${t("ready")}</span>`}<button class="btn sm" type="button" data-x="ctx:plan:remove">${t("ruleRemove")}…</button></div><p class="hint" style="margin-top:2px">${t("ctxOnHint")}</p>`;
  else h+=`<p class="hint" style="margin-top:0">${t("ctxIntro")}</p><div class="btns"><button class="btn" type="button" data-x="ctx:plan">${t("ctxInstall")}…</button></div>`;
  return h;}
function ruleBlock(){const R=mon.rule;let h=`<div class="sec">${t("ruleTitle")}</div>`;
  if(!R)return h+`<p class="hint">…</p>`;
  if(mon.rulePlan){const P=mon.rulePlan;if(P.error)return h+`<p class="hint">${t("ruleBroken")}</p><div class="btns"><button class="btn" type="button" data-x="rule:cancel">${t("cancel")}</button></div>`;
    return h+`<p class="hint" style="margin-top:0">${t(mon.ruleRemove?"ruleRemoveTxt":"ruleConsentTxt")}</p><div class="kv"><span>${t("monFile")}</span><span class="mono">${esc(P.path)}</span></div>${textDiffHtml(P.before,P.after,300)}
     <p class="hint">${t("ruleNote")}</p><div class="btns"><button class="btn pri" type="button" data-x="rule:apply">${t(mon.ruleRemove?"ruleRemove":R.installed?"ruleUpdate":"ruleInstall")}</button><button class="btn" type="button" data-x="rule:cancel">${t("cancel")}</button></div>`;}
  if(R.installed)h+=`<div class="row"><span class="n">${tf("ruleOn",{v:R.version})}</span>${R.outdated?`<button class="btn sm pri" type="button" data-x="rule:plan">${t("ruleUpdate")}…</button>`:`<span class="pill ok">${t("ready")}</span>`}<button class="btn sm" type="button" data-x="rule:plan:remove">${t("ruleRemove")}…</button></div>`;
  else h+=`<p class="hint" style="margin-top:0">${t("ruleIntro")}</p><div class="btns"><button class="btn" type="button" data-x="rule:plan">${t("ruleInstall")}…</button></div>`;
  if(R.brokenBlock)h+=`<p class="hint">${t("ruleBroken")}</p>`;
  h+=`<div class="sec">${t("rcTitle")}</div>`;
  const L=mon.reports||[];
  if(!L.length)h+=`<p class="hint">${t(R.installed?"rcNone":"rcNoRule")}</p>`;
  else h+=L.slice(0,12).map(r=>{const P=r.parsed,TT={ready:"ready",needs_signin:"signin",failed:"m_failed",missing:"missing"},list=(k,cls)=>P&&P[k].length?P[k].map(x=>`<span class="pill ${cls}" title="${esc(t(TT[k]))}">${esc(x)}</span>`).join(" "):"";
    return `<div class="lg"><span class="typ">${dayOf(r.received_at)} ${hhmm(r.received_at)}</span><span class="m">${esc(r.cwd?nm(pathBase(r.cwd),"p"):t("notAvail"))}</span><span class="x">${P?[list("ready","ok"),list("needs_signin","warn"),list("failed","bad"),list("missing","mute")].filter(Boolean).join(" ")||t("rcEmpty"):esc(t("rcNA"))}</span></div>`;}).join("");
  return h+`<p class="hint">${t("rcHint")}</p>`;}
function scanNerves(){act[5]=1;paint();CONNECTORS.forEach((c,k)=>setTimeout(()=>{hoverCon=k;paint();dirty=true;},250+k*230));setTimeout(()=>{hoverCon=-1;paint();dirty=true;},250+CONNECTORS.length*230+300);}

/* ---------- system health ---------- */
// health module: icon and title live in ui/dock.js
const FULLDOCK=DOCK.slice();FULLDOCK.splice(FULLDOCK.indexOf("|"),0,"health");const hiddenMods=new Set();
function rebuildDock(){DOCK.length=0;FULLDOCK.filter(m=>m==="|"||!hiddenMods.has(m)).forEach(m=>DOCK.push(m));renderDock();}
rebuildDock();
BODY.health=()=>{const ok=CONNECTORS.filter(c=>c.s==="ok").length,w=CONNECTORS.filter(c=>c.s==="warn").length,b=CONNECTORS.filter(c=>c.s==="bad").length;
  return `<div class="list">
  <div class="row"><span class="n">${t("h_recv")}</span><span class="m">127.0.0.1</span><span class="pill ok">${t("running")}</span></div>
  <div class="row"><span class="n">${t("h_hooksW")}</span><span class="m">~/.claude/settings.json</span><span class="pill ok">${t("installed")}</span></div>
  <div class="row"><span class="n">${t("h_hooksM")}</span><span class="pill mute">${t("notTested")}</span></div>
  <div class="row"><span class="n">${t("h_app")}</span><span class="m">0.1.0</span><span class="pill ok">${t("running")}</span></div>
  <div class="row"><span class="n">${t("h_store")}</span><span class="m">${libSize(libN)} · Index 312 MB</span></div>
  <div class="row"><span class="n">${t("h_index")}</span>${idx?`<span class="pill warn">${t("st_indexing")}</span>`:`<span class="pill ok">${t("upToDate")}</span>`}</div>
  <div class="row"><span class="n">${t("h_cons")}</span><span class="m">${ok} ${t("ready")} · ${w} ${t("signin")} · ${b} ${t("missing")}</span></div>
  <div class="row"><span class="n">${t("h_res")}</span><span class="m">${t("notAvail")}</span></div></div>
  <div class="sec">${t("h_err")}</div><div class="list"><div class="evc err"><span class="t">14:01</span><span class="d">${t("err1")}</span><span class="r">MCP</span></div><div class="evc err"><span class="t">11:40</span><span class="d">${t("err2")}</span><span class="r">Index</span></div></div>
  <p class="hint"><span class="tag">${t("demo")}</span></p>`;};

/* ---------- security ---------- */
const folderMode={vault:"ro"},integState={};
BODY.security=()=>`<p class="hint" style="margin-top:0">${t("secTxt")}</p>
  <div class="sec">${t("folders")}</div>
  <div class="sess"><span class="n">Obsidian Vault<small>${st.privacy?"…":"D:/Vault"}</small></span><span class="seg sm"><button type="button" data-x="fmode:ro" class="${folderMode.vault==="ro"?"on":""}">${t("ro")}</button><button type="button" data-x="fmode:rw" class="${folderMode.vault==="rw"?"on":""}">${t("rw")}</button></span></div>
  ${folderMode.vault==="rw"?`<div class="note-ok">${t("editNote")}</div>`:""}
  <div class="sess"><span class="n">${t("libFolder")}<small>${st.privacy?"…":"~/NEURAL OS/Library"}</small></span><span class="pill mute">${t("rw")} · ${t("ownLib")}</span></div>
  <div class="sec">${t("integr")}</div>${CONNECTORS.filter(c=>c.s!=="bad").map(c=>`<div class="sess${integState[c.n]?" off":""}"><span class="n">${esc(c.n)}${integState[c.n]?`<small>${t("disconnected")}</small>`:""}</span><button class="btn sm" type="button" data-x="integ:${esc(c.n)}">${integState[c.n]?t("connect"):t("disconnect")}</button></div>`).join("")}
  <div class="sec">${t("ccChanges")}</div><div class="list">
  <div class="row"><span class="n">${t("hooks")}</span><span class="m">~/.claude/settings.json</span><button class="btn sm" type="button" data-x="diffv:hooks">${t("view")}</button><button class="btn sm" type="button">${t("undo")}</button></div>
  <div class="row"><span class="n">${t("rule")}</span><span class="m">~/.claude/CLAUDE.md</span><button class="btn sm" type="button" data-x="diffv:rule">${t("view")}</button><button class="btn sm" type="button">${t("undo")}</button></div></div>
  <div class="note-ok">${t("roProj")}</div><p class="hint"><span class="tag">${t("demo")}</span></p>`;

/* ---------- models & subagents ---------- */
BODY.models=()=>`<p class="hint" style="margin-top:0">${t("modelTxt")}</p>
  <div class="sec">${t("subTree")}</div><div class="tree">
  <div class="tn"><span class="typ">${t("k_project")}</span><span class="n">${esc(nm("Roblox Game","p"))}</span><span class="m mono" style="font-size:10px;color:var(--silver)">claude-opus</span></div>
  <div class="ch"><div class="tn"><span class="n">Explore · <span style="color:var(--silver)">Spawn-Code finden</span></span><span class="pill ok">${t("done")}</span></div>
  <div class="tn"><span class="n">general-purpose · <span style="color:var(--silver)">Tests prüfen</span></span><span class="pill warn">${t("running")}</span></div></div>
  <div class="tn"><span class="typ">${t("k_project")}</span><span class="n">${esc(nm("NEURAL OS","p"))}</span><span class="m mono" style="font-size:10px;color:var(--silver)">claude-sonnet</span></div>
  <div class="ch"><div class="tn"><span class="n" style="color:var(--silver)">—</span></div></div></div>
  <div class="sec">${t("modelChanges")}</div><div class="list"><div class="evc"><span class="t">20:14</span><span class="d">claude-sonnet → claude-opus</span><span class="r">${esc(nm("Roblox Game","p"))}</span></div></div>
  <div class="kv" style="margin-top:8px"><span>${t("usage")}</span><span>${t("notAvail")}</span></div><p class="hint"><span class="tag">${t("demo")}</span></p>`;

/* ---------- projects ---------- */
const PLIST=["Roblox Game","NEURAL OS","Personal"];let curProj="Roblox Game",renaming=false;
BODY.projects=()=>{const P=PROJ[curProj];const isU=curProj==="__u";
  return `<div class="fld"><select class="inp" data-x="proj">${PLIST.map(p=>`<option value="${esc(p)}"${p===curProj?" selected":""}>${esc(nm(p,"p"))}</option>`).join("")}<option value="__u"${isU?" selected":""}>${t("unassigned")}</option></select><button class="btn sm" type="button" data-x="newproj">${t("newProj")}</button>${isU?"":`<button class="btn sm" type="button" data-x="renproj">${t("actRename")}</button>`}</div>
  ${renaming?`<div class="fld"><input id="pname" class="inp" value="${esc(curProj)}"><button class="btn sm pri" type="button" data-x="renok">${t("ok")}</button></div>`:""}
  ${isU?`<p class="hint" style="margin-top:0">${t("unassignedD")}</p><div class="list"><div class="row"><span class="n">${esc(nm("Scan-Vertrag.pdf","f"))}</span><span class="m">PDF</span></div><div class="evc"><span class="t">19:41</span><span class="d">${t("e_WebSearch")} <span class="mono">three.js instancing</span></span><span class="r">—</span></div></div>`
  :`<div class="sec">${t("cockpit")} · ${esc(nm(curProj,"p"))}</div><div class="kv"><span>${t("mFiles")}</span><span>${fmtN(P?P.files:0)}</span><span>${t("mNotes")}</span><span>${fmtN(P?P.notes:0)}</span><span>${t("sessionsN")}</span><span>${P?P.sess:0}</span><span>${t("git")}</span><span>${P?t("cleanTree"):t("notAvail")}</span></div>
  <div class="sec">${t("filesList")}</div><div class="list">${FILES.map((F,i)=>i).filter(i=>FILES[i].p===curProj).map(i=>`<div class="row" data-x="opennote:${i}" style="cursor:pointer"><span class="n">${esc(nm(FILES[i].n,"f"))}</span><span class="m">${FX[i].ty}</span></div>`).join("")||`<p class="hint" style="margin:0">—</p>`}</div>
  <div class="sec">${t("m_connectors")}</div><div class="list">${(curProj==="Roblox Game"?CONNECTORS.slice(0,2):curProj==="NEURAL OS"?CONNECTORS.slice(3,4):[]).map(c=>`<div class="row"><span class="n">${esc(c.n)}</span>${pill(c.s)}</div>`).join("")||`<p class="hint" style="margin:0">—</p>`}</div>`}
  <p class="hint">${t("projHint")}</p><p class="hint" style="margin-top:4px"><span class="tag">${t("demo")}</span></p>`;};

/* ---------- setup guide (Settings → Einrichtung, palette) ---------- */
function setupPick(){try{return readPick(localStorage.getItem(PICK_KEY));}catch(_){return GOALS.slice();}}
function setupState(){let tried=false;try{tried=localStorage.getItem(TRIED_KEY)==="1";}catch(_){}return setupSteps({hasBridge:!!(monBridge()&&bridge()),libCount:lib.count||0,mon,tried,pick:setupPick()});}
// Obsidian vaults this computer knows (Obsidian's own list), linkable from the guide with one click
const VAULTS={data:null,busy:false};
function loadVaults(){const B=bridge();if(!B||!B.vaults||VAULTS.busy)return;VAULTS.busy=true;B.vaults().then(d=>{VAULTS.data=d;VAULTS.busy=false;refreshOv("setup");}).catch(()=>{VAULTS.busy=false;VAULTS.data=[];});}
function vaultsBlock(){if(!bridge())return "";if(!VAULTS.data){loadVaults();return `<p class="hint">${t("vaultsLooking")}</p>`;}
  const V=VAULTS.data;
  return `<div class="list">${V.map((x,i)=>`<div class="row"><span class="n">${esc(nm(x.name,"p"))}<small class="mono" style="display:block;opacity:.6">${st.privacy?"…":esc(x.path)}</small></span>${x.linked?`<span class="pill ok">${t("vaultLinked")}</span>`:`<button class="btn sm pri" type="button" data-x="vlink:${i}">${t("vaultLink")}</button>`}</div>`).join("")||`<p class="hint" style="margin:0">${t("vaultsNone")}</p>`}</div>
  <div class="btns" style="margin-top:4px"><button class="btn sm" type="button" data-x="liblink">${t("vaultOther")}</button></div><p class="hint">${t("vaultsHint")}</p>`;}
// connectors for the programs on this computer (setup guide, goal "apps"): scanned when the guide opens
const APPS={data:null,busy:false};
function scanAppsNow(){const MB=monBridge();if(!MB||!MB.apps||APPS.busy)return;APPS.busy=true;MB.apps().then(d=>{APPS.data=d;APPS.busy=false;refreshOv("setup");refreshOv("overview");}).catch(()=>{APPS.busy=false;});}
function appsBlock(){if(!monBridge())return `<p class="hint">${t("setupNA")}</p>`;if(!APPS.data){scanAppsNow();return `<p class="hint">${t("appsScanning")}</p>`;}
  const F=APPS.data.apps.filter(a=>a.found||a.connected);
  if(!F.length)return `<p class="hint">${t("appsNone")}</p>`;
  return `<div class="list">${F.map(a=>`<div class="row"><span class="n">${esc(t("app_"+a.id))}</span><span class="m">${a.connected?esc(tf("appsAs",{n:a.server})):t("appsNotYet")}</span>${a.connected?`<span class="pill ok">${t("appsOk")}</span>`:a.link?`<button class="btn sm pri" type="button" data-x="appguide:${a.id}">${t("appsHow")}</button>`:`<span class="pill mute">${t("appsSearchSelf")}</span>`}</div>`).join("")}</div>
  <p class="hint">${t("appsHint")}</p><div class="btns" style="margin-top:4px"><button class="btn sm" type="button" data-x="appscan">${t("appsRescan")}</button><button class="btn sm" type="button" data-open="connectors">${t("appsAll")}</button></div>`;}
BODY.setup=()=>{const S=setupState(),P=setupProgress(S),pick=setupPick();
  return `<p class="hint" style="margin-top:0">${t("setupIntro")}</p><div class="sec">${t("pickTitle")}</div><div class="picks">${GOALS.map(g=>`<label class="pick${pick.includes(g)?" on":""}"><input type="checkbox" data-x="spick:${g}"${pick.includes(g)?" checked":""}><span><b>${t("goal_"+g)}</b><small>${t("goal_"+g+"D")}</small></span></label>`).join("")}</div>`+
    (S.length?`<div class="sec">${t("pickSteps")}</div>`:"")+`<div class="steps">`+S.map((s,i)=>`<div class="step${s.done?" ok":""}"><span class="num">${s.done?"✓":i+1}</span><div class="tx"><b>${t("setup_"+s.k)}</b><small>${t("setup_"+s.k+"D")}</small></div>${
    s.na?`<span class="pill mute">${t("setupNA")}</span>`:s.done?`<span class="pill ok">${t("setupDone")}</span>`:s.go?`<button class="btn sm pri" type="button" data-x="setgo:${s.go.m}:${s.go.tab||""}:${s.go.act||""}">${t("setupDo")}</button>`:`<span class="pill warn">${t("setupOpenStep")}</span>`}</div>`).join("")+`</div>`+
    (S.length&&P.n===P.total?`<p class="hint">${t("setupAll")}</p>`:"")+(pick.includes("notes")?`<div class="sec">${t("vaultsTitle")}</div>`+vaultsBlock():"")+(pick.includes("apps")?`<div class="sec">${t("goal_apps")}</div>`+appsBlock():"")+(pick.length?"":`<p class="hint">${t("pickNone")}</p>`);};
// Overview (first dock item): what this screen is, what is happening now, and where to find things.
// Real data when the app runs; the old demo body stays for the plain browser preview.
const _ovDemo=BODY.overview;
BODY.overview=()=>{if(!monBridge())return _ovDemo();
  const act=mon.sessions.filter(s=>isActive(s)),today=new Date().toDateString(),evToday=mon.events.filter(e=>new Date(e.received_at||0).toDateString()===today).length;
  const S=setupState(),next=S.find(x=>!x.done&&!x.na),nLinks=(lib.links||[]).filter(l=>l.status==="linked").length;
  const where=[["memory","whMemory"],["activity","whActivity"],["connectors","whConnectors"],["settings","whSettings"]];
  return `<p class="hint" style="margin-top:0">${t("ovIntro")}</p>
  <div class="sec">${t("glance")}</div><div class="tiles">
   <div class="tile"><b>${fmtN(lib.count||0)}</b><span>${t("tl_files")}</span></div>
   <div class="tile"><b>${fmtN(nLinks)}</b><span>${t("tl_links")}</span></div>
   <div class="tile"><b>${act.length}</b><span>${t("tl_active")}</span></div>
   <div class="tile"><b>${fmtN(evToday)}</b><span>${t("tl_today")}</span></div></div>
  <div class="sec">${t("ovNext")}</div>${next?`<div class="step"><span class="num">→</span><div class="tx"><b>${t("setup_"+next.k)}</b><small>${t("setup_"+next.k+"D")}</small></div>${next.go?`<button class="btn sm pri" type="button" data-x="setgo:${next.go.m}:${next.go.tab||""}:${next.go.act||""}">${t("setupDo")}</button>`:`<button class="btn sm" type="button" data-x="setopen">${t("setupOpen")}</button>`}</div>`:`<p class="hint" style="margin:0">${t("ovAllSet")} <button class="btn sm" type="button" data-x="setopen">${t("setupOpen")}</button></p>`}
  <div class="sec">${t("ovNow")}</div>${act.length?`<div class="list">${act.slice(0,4).map(s=>`<div class="row"><span class="n">● ${esc(sessName(s))}</span><span class="m">${hhmm(s.started_at)} · ${tf("evCount",{n:s.events})}</span></div>`).join("")}</div>`:`<p class="hint" style="margin:0">${t("ovNoneNow")}</p>`}
  ${mon.events.length?`<div class="sec">${t("recent")}</div><div class="list">${timelineEvents(mon.events).slice(0,4).map(e=>monEvRow(e,true)).join("")}</div>`:""}
  <div class="sec">${t("ovRead")}</div><div class="kv"><span>${t("ovDot")}</span><span>${t("ovDotD")}</span><span>${t("ovColour")}</span><span>${esc(t("colorBy_"+st.colorBy))}</span><span>${t("ovGlow")}</span><span>${t("ovGlowD")}</span><span>${t("ovNerves")}</span><span>${t("ovNervesD")}</span></div>
  <div class="sec">${t("ovWhere")}</div><div class="list">${where.map(([m,k])=>`<div class="row" data-open="${m}" style="cursor:pointer"><span class="n">${t(MODT[m])}</span><span class="m">${t(k)}</span></div>`).join("")}</div>`;};
const setupRow=()=>{const P=setupProgress(setupState());return `<div class="set"><span>${t("setupRow")}<small>${tf("setupRowD",P)}</small></span><button class="btn sm${P.n<P.total?" pri":""}" type="button" data-x="setopen">${t("setupOpen")}</button></div>`;};

/* ---------- settings additions ---------- */
st.quality="high";st.dockHide=false;
const _setBody=BODY.settings;
/* ---------- device sync through the user's own cloud folder (main: sync/sync.ts) ---------- */
const SYNC={data:null,busy:false};
const syncBridge=()=>window.neuralOS&&window.neuralOS.sync;
function loadSync(then){const S=syncBridge();if(!S||SYNC.busy)return;SYNC.busy=true;S.status().then(d=>{SYNC.data=d;SYNC.busy=false;refreshOv("settings");if(then)then(d);}).catch(()=>{SYNC.busy=false;});}
function ago(iso){if(!iso)return t("notAvail");const m=Math.max(0,Math.round((Date.now()-Date.parse(iso))/6e4));return m<1?t("syncJustNow"):m<60?tf("syncMinAgo",{n:m}):m<1440?tf("syncHAgo",{n:Math.round(m/60)}):tf("syncDAgo",{n:Math.round(m/1440)});}
function syncBlock(){const S=syncBridge();if(!S)return "";const D=SYNC.data;
  let h=`<div class="sec">${t("syncTitle")}</div><p class="hint" style="margin-top:0">${t("syncD")}</p>`;
  if(!D){loadSync();return h;}
  const pv=p=>st.privacy?"…":esc(p);
  if(!D.on){
    h+=D.clouds.length?`<div class="list">${D.clouds.map((c,i)=>`<div class="row"><span class="n">${t("cloud_"+c.kind)}<small>${pv(c.path)}</small></span><button class="btn sm pri" type="button" data-x="synccloud:${i}">${t("syncHere")}</button></div>`).join("")}</div>`:`<p class="hint">${t("syncNoCloud")}</p>`;
    return h+`<div class="btns"><button class="btn sm" type="button" data-x="syncpick">${t("syncOther")}</button></div><p class="hint">${t("syncNotesHint")}</p>`;}
  h+=`<div class="set"><span>${t("syncFolder")}<small>${pv(D.folder)} → ${esc(D.sub)}</small></span><button class="btn sm" type="button" data-x="syncopen">${t("syncOpen")}</button></div>
  <div class="set"><span>${t("syncThis")}<small>${t("syncThisD")}</small></span><span class="rng"><input type="text" id="syncnm" value="${esc(D.device.name)}" maxlength="60" style="width:150px"><button class="btn sm" type="button" data-x="syncname">${t("syncRename")}</button></span></div>`;
  if(D.error)h+=`<div class="note warn">${D.error==="missing"?t("syncMissing"):esc(tf("syncErr",{e:D.error}))}</div>`;
  h+=`<div class="sec">${t("syncPeers")} · ${D.peers.length}</div>`;
  h+=D.peers.length?`<div class="list">${D.peers.map(p=>`<div class="row"><span class="n">${esc(p.name)}<small>${esc(tf("syncPeerD",{s:p.sessions,e:p.events,l:p.lessons}))} · ${esc(tf("syncSeen",{t:ago(p.seen_at)}))}</small></span><span class="pill ok">${esc(p.platform==="darwin"?"macOS":p.platform==="win32"?"Windows":p.platform||"")}</span></div>`).join("")}</div>`:`<p class="hint">${t("syncNoPeers")}</p>`;
  return h+`<div class="btns"><button class="btn sm" type="button" data-x="syncnow">${t("syncNow")}</button><button class="btn sm" type="button" data-x="syncoff">${t("syncOff")}</button></div>
  <p class="hint">${esc(tf("syncLast",{t:ago(D.lastIn)}))} ${t("syncNotesHint")}</p>`;}
function syncSet(folder){const S=syncBridge();if(!S)return;S.set(folder).then(r=>{if(r&&r.ok){SYNC.data=r.status;toast(t(folder?"syncOnToast":"syncOffToast"));}refreshOv("settings");});}
{const S=syncBridge();if(S&&S.onSynced)S.onSynced(()=>{refreshMonitor(monChanged);if(LES.projects)loadLessons();if(SYNC.data)loadSync();});}
BODY.settings=()=>setupRow()+_setBody()+syncBlock()+`<div class="sec">${t("sec_view")}</div>
  <div class="set"><span>${t("quality")}<small>${t("qD")}</small></span><span class="seg"><button type="button" data-x="q:high" class="${st.quality==="high"?"on":""}">${t("qHigh")}</button><button type="button" data-x="q:low" class="${st.quality==="low"?"on":""}">${t("qLow")}</button></span></div>
  <div class="set"><span>${t("colors")}<small>${t("colorsD")}</small></span><span class="seg"><button type="button" data-x="th:color" class="${st.theme==="color"?"on":""}">${t("thColor")}</button><button type="button" data-x="th:mono" class="${st.theme==="color"?"":"on"}">${t("thMono")}</button></span></div>
  <div class="set"><span>${t("regLabels")}<small>${t("regLabelsD")}</small></span><span class="seg"><button type="button" data-x="rl:side" class="${st.regLabels==="side"?"on":""}">${t("rlSide")}</button><button type="button" data-x="rl:brain" class="${st.regLabels==="brain"?"on":""}">${t("rlBrain")}</button></span></div>
  <div class="set"><span>${t("form")}<small>${t(lib.count?"formD":"formNone")}</small></span><span class="rng"><em>${t("formBrain")}</em><input type="range" id="vform" min="0" max="100" step="5" value="${Math.round(st.form*100)}"${lib.count?"":" disabled"}><em>${t("formClusters")}</em></span></div>
  <div class="set"><span>${t("look")}<small>${t("lookD")}</small></span><span class="seg"><button type="button" data-x="look:dust" class="${st.look==="dust"?"on":""}">${t("lookDust")}</button><button type="button" data-x="look:web" class="${st.look==="web"?"on":""}">${t("lookWeb")}</button></span></div>
  <div class="set"><span>${t("colorBy")}<small>${t("colorByD")}</small></span><select class="inp" id="vcby" style="flex:0 0 150px">${GROUP_BY.map(k=>`<option value="${k}"${st.colorBy===k?" selected":""}>${t("colorBy_"+k)}</option>`).join("")}</select></div>
  <div class="set"><span>${t("linkColor")}<small>${t("linkColorD")}</small></span><span class="seg"><button type="button" data-x="lcol:region" class="${st.linkColor==="region"?"on":""}">${t("lcRegion")}</button><button type="button" data-x="lcol:files" class="${st.linkColor==="files"?"on":""}">${t("lcFiles")}</button></span></div>
  <div class="set"><span>${t("brightness")}<small id="vbrightV" class="mono">${Math.round(st.bright*100)} %</small></span><input type="range" id="vbright" min="30" max="150" step="10" value="${Math.round(st.bright*100)}" style="flex:0 0 150px"></div>
  <div class="set"><span>${t("pointSize")}<small id="vpsizeV" class="mono">${Math.round(st.psize*100)} %</small></span><input type="range" id="vpsize" min="50" max="200" step="10" value="${Math.round(st.psize*100)}" style="flex:0 0 150px"></div>
  <div class="set"><span>${t("turning")}<small>${t("turningD")}</small></span><span class="seg"><button type="button" data-x="turn:1" class="${st.turn?"on":""}">${t("on")}</button><button type="button" data-x="turn:0" class="${st.turn?"":"on"}">${t("off")}</button></span></div>
  <div class="set"><span>${t("turnSpeed")}<small id="vspeedV" class="mono">${Math.round(st.speed*100)} %</small></span><input type="range" id="vspeed" min="25" max="300" step="25" value="${Math.round(st.speed*100)}" style="flex:0 0 150px"></div>
  <div class="set"><span>${t("showLinks")}<small>${t("showLinksD")}</small></span><span class="seg"><button type="button" data-x="vlinks:1" class="${st.links?"on":""}">${t("on")}</button><button type="button" data-x="vlinks:0" class="${st.links?"":"on"}">${t("off")}</button></span></div>
  <div class="btns" style="margin-top:4px"><button class="btn sm" type="button" data-x="vreset">${t("viewReset")}</button></div>
  <div class="set"><span>${t("dockHide")}<small>${t("dockHideD")}</small></span><span class="seg"><button type="button" data-x="dh:1" class="${st.dockHide?"on":""}">${t("on")}</button><button type="button" data-x="dh:0" class="${st.dockHide?"":"on"}">${t("off")}</button></span></div>
  <div class="sec">${t("sec_mods")}</div><p class="hint" style="margin:0 0 6px">${t("modsD")}</p>${FULLDOCK.filter(m=>m!=="|"&&m!=="settings").map(m=>`<div class="set" style="padding:6px 0"><span>${t(MODT[m])}</span><span class="seg sm"><button type="button" data-x="mod:${m}:1" class="${hiddenMods.has(m)?"":"on"}">${t("on")}</button><button type="button" data-x="mod:${m}:0" class="${hiddenMods.has(m)?"on":""}">${t("off")}</button></span></div>`).join("")}
  <div class="sec">${t("sec_lib")}</div><div class="set"><span>${t("libFolder")}<small class="mono">${st.privacy?"…":"~/NEURAL OS/Library"}</small></span><button class="btn sm" type="button" data-x="toast:move">${t("move")}</button></div>
  <div class="set"><span>${t("retention")}</span><select class="inp" data-x="ret" style="flex:0 0 130px">${["r30","r90","r365","rInf"].map(k=>`<option value="${k}"${(st.ret||"r90")===k?" selected":""}>${t(k)}</option>`).join("")}</select></div>
  <div class="sec">${t("sec_demo")}</div><div class="btns" style="margin-top:0">${["welcome","import","diff","conflict","index"].map(k=>`<button class="btn sm" type="button" data-x="demo:${k}">${t("dm_"+k)}</button>`).join("")}</div>`;
function setTheme(v){st.theme=v==="mono"?"mono":"color";try{localStorage.setItem("nos-theme",st.theme);}catch{}
  document.body.classList.toggle("mono",st.theme!=="color");tintBase();paint();rlabels.forEach((d,i)=>d.style.setProperty("--rc",cssCol(RC[i])));renderRegSide();REAL.repaint();renderLegend();refreshOv("memory");if(typeof paintNodes==="function")paintNodes();dirty=true;}
document.body.classList.toggle("mono",st.theme!=="color");
function applyQuality(){if(!renderer)return;renderer.setPixelRatio(st.quality==="low"?1:Math.min(devicePixelRatio,2));lines.visible=st.quality!=="low";nodeEdges.visible=st.links&&st.quality!=="low";resize();}
const dockzone=document.createElement("div");dockzone.id="dockzone";document.body.appendChild(dockzone);
dockzone.addEventListener("pointerenter",()=>document.body.classList.add("dockpeek"));
document.getElementById("dock").addEventListener("pointerleave",()=>document.body.classList.remove("dockpeek"));

/* ---------- toast ---------- */
const toastEl=document.createElement("div");toastEl.className="glass";toastEl.style.cssText="position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:64;padding:9px 16px;border-radius:10px;font-size:12px;opacity:0;transition:opacity .2s;pointer-events:none";document.body.appendChild(toastEl);
let toastT=0;function toast(s){toastEl.textContent=s;toastEl.style.opacity="1";clearTimeout(toastT);toastT=setTimeout(()=>toastEl.style.opacity="0",Math.max(2600,s.length*60));}

/* ---------- modals ---------- */
const modal=document.createElement("div");modal.id="modal";modal.hidden=true;document.body.appendChild(modal);
let ms=null;
function showModal(){if(!ms){modal.hidden=true;return;}modal.innerHTML=`<div class="mbox glass${ms.wide?" wide":""}" role="dialog" aria-modal="true">${RENDER[ms.kind]()}</div>`;modal.hidden=false;}
function closeModal(){ms=null;modal.hidden=true;modal.innerHTML="";}
const diffHtml=(path,lines)=>`<div class="diff"><div class="hd">${esc(path)}</div>${lines.map(([k,s])=>`<div class="${k}">${esc(s)}</div>`).join("")}</div>`;
const HOOKDIFF=[["ctx","{"],["ctx","  \"hooks\": {"],["add","    \"PostToolUse\": ["],["add","      { \"matcher\": \"*\", \"hooks\": [ { \"type\": \"command\", \"command\": \"neural-os-hook post-tool\" } ] }"],["add","    ],"],["add","    \"SessionStart\": ["],["add","      { \"hooks\": [ { \"type\": \"command\", \"command\": \"neural-os-hook session-start\" } ] }"],["add","    ]"],["ctx","  }"],["ctx","}"]];
const RULEDIFF=[["ctx","# Global instructions"],["ctx",""],["add","<!-- NEURAL-OS:READINESS:BEGIN v1 -->"],["add","## Plugin & connector readiness check"],["add",""],["add","Before starting a larger task, check whether you have the tools it needs."],["add","…"],["add","READINESS: ready=<…> missing=<…> needs_signin=<…> failed=<…>"],["add","<!-- NEURAL-OS:READINESS:END -->"]];
const mh=(code,title,extra)=>`<div class="mh"><span class="code">${code}</span><h3>${esc(title)}</h3>${extra||""}<button class="btn sm" type="button" data-mx="close" aria-label="${esc(t("close"))}">×</button></div>`;
const RENDER={
 welcome:()=>{const s=ms.step,N=6,dots=`<div class="steps">${Array.from({length:N},(_,k)=>`<i class="${k<=s?"on":""}"></i>`).join("")}</div>`;let b="",f="";
  const nav=(pri,priAct,sec,secAct)=>`${s>0?`<button class="btn" type="button" data-mx="wback">${t("back")}</button>`:""}<span class="sp"></span>${sec?`<button class="btn" type="button" data-mx="${secAct}">${sec}</button>`:""}<button class="btn pri" type="button" data-mx="${priAct}">${pri}</button>`;
  if(s===0){b=`<p style="font-size:15px;color:var(--white);margin:0 0 12px">${t("w1")}</p><div class="feat">${["a","b","c"].map((k,n)=>`<div><span class="code">0${n+1}</span><b>${t("w1"+k+"h")}</b><span>${t("w1"+k)}</span></div>`).join("")}</div><div class="note-ok">${t("w1not")}</div>`;f=`<button class="btn" type="button" data-mx="close">${t("skip")}</button>`+nav(t("next"),"wnext");f=f.replace(/^(.*?)<span class="sp"><\/span>/,'$1<span class="sp"></span>');}
  const realW=!!monBridge(),wDiff=(P,path,demo)=>realW?(P?(P.error?`<p class="hint">${t(P.error==="noNode"?"monNoNode":P.error==="brokenBlock"?"ruleBroken":"monBadSettings")}</p>`:`<div class="kv"><span>${t("monFile")}</span><span class="mono">${esc(P.path)}</span></div>`+textDiffHtml(P.before,P.after,220)):`<p class="hint">…</p>`):diffHtml(path,demo);
  if(s===1){b=`<p>${t("w2")}</p><div class="fld"><input class="inp mono" value="${esc(realW&&lib.libDir?lib.libDir:"~/NEURAL OS/Library")}" readonly><button class="btn sm" type="button" data-mx="toastfolder">${t("change")}</button></div>`;f=nav(t("next"),"wnext");}
  if(s===2){b=`<p>${t("w3")}</p><div class="choice">${[["vault","imp_vault"],["folder","imp_folder"],["example","imp_example"],["later","later"]].map(([k,l])=>`<button type="button" data-mx="wimp:${k}" class="${ms.imp===k?"on":""}"><b>${t(l)}</b>${t(l+"_d")}</button>`).join("")}</div>`;f=nav(t("next"),"wnext");}
  if(s===3){b=`<p>${t("w4")}</p>${wDiff(ms.hp,"~/.claude/settings.json",HOOKDIFF)}${realW?"":`<div class="note-w">${t("w_example")}</div>`}<p class="hint" style="margin:0">${t(realW?"wBackupReal":"backupNote")}</p>`;f=nav(t("optIn"),"whooks:1",t("optSkip"),"whooks:0");}
  if(s===4){b=`<p>${t("w5")}</p>${wDiff(ms.rp,"~/.claude/CLAUDE.md",RULEDIFF)}<p class="hint">${t(realW?"wBackupReal":"backupNote")}</p>`;f=nav(t("optIn"),"wrule:1",t("optSkip"),"wrule:0");}
  if(s===5){b=`<p style="font-size:14px;color:var(--white)">${t("w6")}</p><div class="kv"><span>${t("libFolder")}</span><span>~/NEURAL OS/Library</span><span>${t("w3h")}</span><span>${t(ms.imp==="vault"?"imp_vault":ms.imp==="folder"?"imp_folder":ms.imp==="example"?"imp_example":"later")}</span><span>${t("w4h")}</span><span>${t(ms.hooks?"sumOn":"sumOff")}</span><span>${t("w5h")}</span><span>${t(ms.rule?"sumOn":"sumOff")}</span></div>`;f=nav(t("start"),"wdone");}
  return mh(`0${s+1} / 06`,[t("w1h"),t("w2h"),t("w3h"),t("w4h"),t("w5h"),t("w6h")][s],dots)+`<div class="mb">${b}</div><div class="mf">${f}</div>`;},
 import:()=>{const big=ms.suggest?ms.suggest==="link":ms.n>5000||ms.bytes>1e9;return mh("IMP",t("imp_title")+" · "+(st.privacy?"…":ms.name))+`<div class="mb"><p style="margin:0;font-family:var(--f-data);font-size:12px;color:var(--white)">${tf("imp_sum",{n:fmtN(ms.n),s:fmtBytes(ms.bytes)})}</p>${ms.vault?`<div class="note-ok">${t("imp_vaultHint")}</div>`:""}
  <div class="choice"><button type="button" data-mx="imode:copy" class="${ms.mode==="copy"?"on":""}">${big?"":`<em>${t("recommended")}</em>`}<b>${t("mode_copy")}</b>${t("mode_copy_d")}</button><button type="button" data-mx="imode:link" class="${ms.mode==="link"?"on":""}">${big?`<em>${t("recommended")}</em>`:""}<b>${t("mode_link")}</b>${t("mode_link_d")}</button></div>
  ${ms.mode==="link"?`<div class="set"><span>${t("folders")}</span><span class="seg sm"><button type="button" data-mx="iro:1" class="${ms.ro?"on":""}">${t("readOnly")}</button><button type="button" data-mx="iro:0" class="${ms.ro?"":"on"}">${t("allowEdit")}</button></span></div>${ms.ro?"":`<div class="note-ok">${t("editNote")}</div>`}
  <div class="fld"><span style="font-size:12px;color:var(--silver);min-width:84px">${t("exclude")}</span><input class="inp mono" value=".obsidian/, .trash/, build/, *.cache"></div>`:""}
  <div class="note-w">${tf("dupes",{n:ms.n>1?2:0})}</div></div><div class="mf"><span class="sp"></span><button class="btn" type="button" data-mx="close">${t("cancel")}</button><button class="btn pri" type="button" data-mx="idone">${t("importBtn")}</button></div>`;},
 diff:()=>{const h=ms.which==="hooks";return mh("3.4",t("diff_title"))+`<div class="mb"><p style="margin-top:0">${t("diff_intro")}</p>${diffHtml(h?"~/.claude/settings.json":"~/.claude/CLAUDE.md",h?HOOKDIFF:RULEDIFF)}
  ${h?`<div class="note-w">${t("w_example")}</div>`:""}<div class="kv"><span>${t("backupAt")}</span><span class="mono" style="font-size:10.5px">~/.neural-os/backups/${h?"settings.json":"CLAUDE.md"}.2026-11-16.bak</span></div><p class="hint">${t("backupNote")}</p></div>
  <div class="mf"><span class="sp"></span><button class="btn" type="button" data-mx="close">${t("cancel")}</button>${ms.view?"":`<button class="btn pri" type="button" data-mx="dok">${t("approve")}</button>`}</div>`;},
 conflict:()=>{const mine=["# Map-Ideen","","Lobby mit vier Portalen, siehe [[GameLoop]] und [[Monetization]].","","#roblox #design"],theirs=["# Map-Ideen","","Lobby mit drei Portalen, siehe [[GameLoop]] und [[Monetization]].","- Spawn-Schutz: 3 Sekunden","","#roblox #design"];
  const side=`<div class="cols"><div><h4>${t("cf_mine")}</h4>${diffHtml("",[["ctx",mine[0]],["ctx",""],["del",mine[2]],["ctx",""],["ctx",mine[4]]])}</div><div><h4>${t("cf_theirs")}</h4>${diffHtml("",[["ctx",theirs[0]],["ctx",""],["add",theirs[2]],["add",theirs[3]],["ctx",""],["ctx",theirs[5]]])}</div></div>`;
  const inline=diffHtml(nm("Map-Ideen.md","f"),[["ctx",mine[0]],["ctx",""],["del",mine[2]],["add",theirs[2]],["add",theirs[3]],["ctx",""],["ctx",mine[4]]]);
  return mh("5.1",t("cf_title"),`<span class="seg sm"><button type="button" data-mx="cview:side" class="${ms.view==="side"?"on":""}">${t("sideBySide")}</button><button type="button" data-mx="cview:inline" class="${ms.view==="inline"?"on":""}">${t("compareBtn")}</button></span>`)+`<div class="mb"><p style="margin-top:0">${tf("cf_intro",{file:esc(nm("Map-Ideen.md","f"))})}</p>${ms.view==="side"?side:inline}<p class="hint">${t("cf_backup")}</p></div>
  <div class="mf"><span class="sp"></span><button class="btn" type="button" data-mx="close">${t("keepMine")}</button><button class="btn pri" type="button" data-mx="close">${t("takeTheirs")}</button></div>`;},
 pack:()=>{const L=[...packSel];const txt=ms.full?L.map(i=>`## ${FILES[i].n}\n\n${noteSrc(i)||"("+t("nameOnlyD")+")"}`).join("\n\n"):"# Context pack\n\n"+L.map(i=>`- Library/${FILES[i].p}/${FILES[i].n}`).join("\n");
  return mh("CTX",t("packTitle")+` · ${L.length}`,`<span class="seg sm"><button type="button" data-mx="pmode:0" class="${ms.full?"":"on"}">${t("packRefs")}</button><button type="button" data-mx="pmode:1" class="${ms.full?"on":""}">${t("packFull")}</button></span>`)+`<div class="mb"><p style="margin-top:0">${t("packIntro")}</p><textarea class="ned" id="packtxt" readonly style="min-height:200px">${esc(st.privacy?t("privHidden"):txt)}</textarea></div>
  <div class="mf"><span class="sp"></span><button class="btn" type="button" data-mx="psave">${t("saveFile")}</button><button class="btn pri" type="button" data-mx="pcopy">${t("copy")}</button></div>`;},
 confirm:()=>mh("!",ms.title)+`<div class="mb"><p style="margin:0">${esc(ms.text)}</p></div><div class="mf"><span class="sp"></span><button class="btn" type="button" data-mx="close">${t("cancel")}</button><button class="btn pri" type="button" data-mx="cok">${esc(ms.ok)}</button></div>`};
const fmtBytes=b=>b>=1e9?(b/1e9).toFixed(1)+" GB":b>=1e6?(b/1e6).toFixed(1)+" MB":Math.max(1,Math.round(b/1e3))+" KB";
function welcome(s){ms={kind:"welcome",step:s||0,imp:"vault",hooks:true,rule:true,wide:false};showModal();
  // real app: show the exact changes for this computer (nothing is written before "Start")
  const MB=monBridge();if(MB){const W=ms;Promise.all([MB.plan(false),MB.rulePlan?MB.rulePlan(false):null]).then(([hp,rp])=>{W.hp=hp;W.rp=rp;if(ms===W)showModal();}).catch(()=>{});}}
function importDlg(o){ms={kind:"import",...o,mode:o.suggest||((o.n>5000||o.bytes>1e9)?"link":"copy"),ro:true};showModal();}
function diffDlg(which,view){ms={kind:"diff",which,view:!!view,wide:true};showModal();}
function conflictDlg(){ms={kind:"conflict",view:"side",wide:true};showModal();}
function confirmDlg(title,text,ok,fn){ms={kind:"confirm",title,text,ok,fn};showModal();}
modal.addEventListener("click",e=>{if(e.target===modal&&ms&&ms.kind!=="welcome"){closeModal();return;}const b=e.target.closest("[data-mx]");if(!b||!ms)return;const [a,v]=b.dataset.mx.split(":");
  if(a==="close"){if(ms.kind==="welcome")try{localStorage.setItem("nos-welcomed","1");}catch(_){}closeModal();return;}
  if(a==="wnext"){ms.step++;}else if(a==="wback"){ms.step--;}else if(a==="wimp"){ms.imp=v;}
  else if(a==="whooks"){ms.hooks=v==="1";ms.step++;}else if(a==="wrule"){ms.rule=v==="1";ms.step++;}
  else if(a==="wdone"){const W=ms,imp=W.imp;try{localStorage.setItem("nos-welcomed","1");}catch(_){}closeModal();
    const MB=monBridge(),B=bridge();
    if(!MB||!B){if(imp==="vault")startIndex("Obsidian Vault",18412);return;}
    // real: apply what the user confirmed on the summary, then let them pick their folder
    (async()=>{try{
      if(W.hooks&&W.hp&&!W.hp.error){const r=await MB.apply(false);mon.result=r;if(!r.ok)toast(t("monFailed"));}
      if(W.rule&&W.rp&&!W.rp.error&&MB.ruleApply){const r=await MB.ruleApply(false);if(!r.ok)toast(t("monFailed"));}
      refreshMonitor(monChanged);openOv("setup");
      if(imp==="vault"){const ps=await B.pick(true);if(ps.length)runRealLink(ps,ps.length===1?ps[0].split(/[\\/]/).pop():ps.length+" "+t("files"));}
      else if(imp==="folder"){const ps=await B.pick(true);if(ps.length)realImportDlg(ps);}
      else if(imp==="example")tryExample();
    }catch(e){console.error(e);}})();return;}
  else if(a==="toastfolder"){toast(t("moveD"));return;}
  else if(a==="imode"){ms.mode=v;}else if(a==="iro"){ms.ro=v==="1";}
  else if(a==="idone"){const n=ms.n,name=ms.name,paths=ms.paths,mode=ms.mode;closeModal();
    if(paths){if(mode==="link")runRealLink(paths,name);else runRealImport(paths,name);return;}   // real: copy, or link folders in place
    startIndex(name,n);return;}
  else if(a==="dok"){closeModal();toast(t("written"));return;}
  else if(a==="cview"){ms.view=v;}
  else if(a==="pmode"){ms.full=v==="1";}
  else if(a==="pcopy"){const ta2=document.getElementById("packtxt");try{navigator.clipboard.writeText(ta2.value);}catch(_){}toast(t("copied"));return;}
  else if(a==="psave"){toast(t("packSaved"));return;}
  else if(a==="cok"){const fn=ms.fn;closeModal();if(fn)fn();return;}
  showModal();});
addEventListener("keydown",e=>{if(e.key==="Escape"&&ms&&ms.kind!=="welcome")closeModal();if(e.key==="Escape")ctxClose();},true);

/* ---------- drag & drop import ---------- */
let dropEl=null,dragDepth=0;
const hasFiles=e=>e.dataTransfer&&[...(e.dataTransfer.types||[])].includes("Files");
addEventListener("dragenter",e=>{if(!hasFiles(e))return;e.preventDefault();dragDepth++;if(!dropEl){dropEl=document.createElement("div");dropEl.id="drop";dropEl.innerHTML=`<b>${esc(t("drop_t"))}</b><span>${esc(t("drop_s"))}</span>`;document.body.appendChild(dropEl);act[0]=1;paint();dirty=true;}});
addEventListener("dragover",e=>{if(hasFiles(e))e.preventDefault();});
addEventListener("dragleave",e=>{if(!hasFiles(e))return;dragDepth--;if(dragDepth<=0&&dropEl){dropEl.remove();dropEl=null;dragDepth=0;}});
addEventListener("drop",e=>{if(!hasFiles(e))return;e.preventDefault();dragDepth=0;if(dropEl){dropEl.remove();dropEl=null;}
  const fl=[...e.dataTransfer.files];
  const B=bridge();if(B){const ps=B.pathsFor(fl);if(ps.length){realImportDlg(ps);return;}}
  const bytes=fl.reduce((s,f)=>s+(f.size||0),0);   // demo (browser preview): only count and size are read, never the contents
  importDlg({n:fl.length||1,bytes,name:fl.length===1?fl[0].name:fl.length+" "+t("files")});});

/* ---------- real import (app only): plan, confirm in the import dialog, copy with progress ---------- */
/* ---------- colour legend (bottom left) and "when you wrote" timeline ---------- */
let lgFocus=null,tmFocus=null;   // selected group key / month
function saveView(){try{localStorage.setItem("nos-view",JSON.stringify({look2:st.look,linkColor:st.linkColor,regLabels:st.regLabels,form:st.form,colorBy:st.colorBy,psize:st.psize,bright:st.bright,turn:st.turn,speed:st.speed,links:st.links}));}catch{}}
const NOGROUP={project:"noProject",top:"noFolder",folder:"noFolder",type:"noType",time:"noDate",tag:"noTag"};
const gName=k=>isNone(k)?t(NOGROUP[st.colorBy]||"noType"):st.colorBy==="type"?k.toUpperCase():st.colorBy==="time"?monthName(k):st.colorBy==="tag"?"#"+(st.privacy?"…":k):nm(k,st.colorBy==="project"?"p":"f");
const monthName=k=>{const [y,m]=k.split("-").map(Number);try{return new Date(y,m-1,1).toLocaleDateString(lang==="de"?"de-DE":"en-US",{month:"short",year:"numeric"});}catch{return k;}};
// colour by tag: tags come from the notes (lib:tags), loaded once when the user picks it
let tagColorsBusy=false;
function loadTagColors(){const B=bridge();if(!B||!B.tags||tagColorsBusy)return;tagColorsBusy=true;B.tags().then(d=>{tagColorsBusy=false;setTags(d);assignColors(lib.rows,"tag");if(st.colorBy==="tag"){REAL.relayout();REAL.repaint();renderLegend();dirty=true;wake();}}).catch(()=>{tagColorsBusy=false;});}
const rampCss=[0,.25,.5,.75,1].map(x=>cssCol(rampColor(x))).join(",");
const legendEl=document.createElement("div");legendEl.id="legend";document.body.appendChild(legendEl);
function renderLegend(){regSideEl.classList.toggle("show",showAll&&st.regLabels==="side");const on=lib.count>0&&st.theme==="color"&&showAll;legendEl.classList.toggle("show",on);if(!on){legendEl.innerHTML="";return;}
  const G=groupCounts(lib.rows,st.colorBy),MAX=10;
  // time: one colour bar from old to new instead of a list of months
  if(st.colorBy==="time"){const M=G.filter(g=>!isNone(g.key)).map(g=>g.key),nd=G.find(g=>isNone(g.key));
    legendEl.innerHTML=`<div class="lgh">${t("colorBy_time")}</div>${M.length?`<div class="lgramp" style="background:linear-gradient(90deg,${rampCss})"></div><div class="lgends"><span>${esc(monthName(M[M.length-1]))}</span><span>${esc(monthName(M[0]))}</span></div>`:""}${nd?`<div class="lgi"><button type="button" class="${lgFocus===nd.key?"on":""}" data-lg="${esc(nd.key)}"><i style="background:${cssCol(groupColor(nd.key,"time"))}"></i>${esc(t("noDate"))}<em>${fmtN(nd.n)}</em></button></div>`:""}`;return;}
  legendEl.innerHTML=`<div class="lgh">${t("colorBy_"+st.colorBy)}</div><div class="lgi">${G.slice(0,MAX).map(g=>`<button type="button" class="${lgFocus===g.key?"on":""}" data-lg="${esc(g.key)}"><i style="background:${cssCol(groupColor(g.key,st.colorBy))}"></i>${esc(gName(g.key))}<em>${fmtN(g.n)}</em></button>`).join("")}${G.length>MAX?`<span class="more">${tf("lgMore",{n:G.length-MAX})}</span>`:""}</div>`;}
legendEl.addEventListener("click",e=>{const b=e.target.closest("[data-lg]");if(!b)return;const k=b.dataset.lg;lgFocus=lgFocus===k?null:k;tmFocus=null;applyFocus();});
queueMicrotask(()=>renderLegend());
function applyFocus(){REAL.setFocus(lgFocus!==null?idsInGroup(lib.rows,st.colorBy,lgFocus):tmFocus?idsInMonth(lib.rows,tmFocus):null);renderLegend();refreshOv("memory");dirty=true;wake();}
const MONTHS={de:["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"],en:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]};
const monLabel=m=>{const [y,mo]=m.split("-");return MONTHS[lang==="de"?"de":"en"][+mo-1]+" "+y;};
function timelineBlock(){if(!lib.count)return `<p class="hint" style="margin:0">${t("tlEmpty")}</p>`;
  const H=histogram(lib.rows,st.colorBy),G=groupCounts(lib.rows,st.colorBy).map(g=>g.key),n=H.months.length,W=100/Math.max(1,n);
  const bars=H.months.map((m,i)=>{let y=100,seg="";for(const k of G){const c=m.groups.get(k);if(!c)continue;const h=c/H.max*100;y-=h;seg+=`<rect x="${(i*W+W*.12).toFixed(3)}" y="${y.toFixed(3)}" width="${(W*.76).toFixed(3)}" height="${h.toFixed(3)}" fill="${st.theme==="color"?cssCol(groupColor(k,st.colorBy)):"#cfd4da"}"/>`;}
    return `<g class="tb${tmFocus===m.month?" on":""}${tmFocus&&tmFocus!==m.month?" dim":""}" data-x="tmon:${m.month}"><title>${monLabel(m.month)} · ${m.total}</title><rect class="hit" x="${(i*W).toFixed(3)}" y="0" width="${W.toFixed(3)}" height="100"/>${seg}</g>`;}).join("");
  const years=H.months.map((m,i)=>m.month.endsWith("-01")||i===0?`<span style="left:${(i*W).toFixed(2)}%">${m.month.slice(0,4)}</span>`:"").join("");
  const sel=tmFocus?H.months.find(m=>m.month===tmFocus):null;
  return `<p class="hint" style="margin:0 0 8px">${t("tlD")}</p><div class="tl"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${bars}</svg><div class="tly">${years}</div></div>
   ${sel?`<div class="row"><span class="n">${tf(sel.total===1?"tlSel1":"tlSel",{m:monLabel(sel.month),n:fmtN(sel.total)})}</span><button class="btn sm" type="button" data-x="tmon:">${t("tlClear")}</button></div>`:""}
   <p class="hint" style="margin-top:6px">${t("tlBy")}: ${t("colorBy_"+st.colorBy)}${H.undated?" · "+tf("tlUndated",{n:fmtN(H.undated)}):""}${H.hidden?" · "+tf("tlHidden",{n:fmtN(H.hidden)}):""}</p>`;}
// brain <-> clusters: the anatomy (points, folds, region labels) fades as the files gather into their group balls
function applyFormFade(){const m=lib.count?REAL.morph:0,dz=lib.count&&st.look==="dust",f=(1-.88*m)*(dz?.35:1);pmat.uniforms.uFade.value=f;lines.material.opacity=.55*f*(dz?.25:1);document.body.classList.toggle("clusters",m>.5);}
function setForm(v,now){st.form=v;REAL.setMorph(lib.count?v:0,now);applyFormFade();dirty=true;wake();}
// Memory -> Numbers: statistics from the real library only; "you and Claude" stays "not available" until real hook data exists
function numbersBlock(){if(!lib.count)return `<p class="hint" style="margin:0">${t("tlEmpty")}</p>`;
  const N=computeNumbers(lib.rows,lib.links),fileRow=r=>`<div class="row" data-real="${esc(r.id)}" style="cursor:pointer"><span class="n">${esc(nm(r.name,"f"))}</span><span class="m">${r.project?esc(nm(r.project,"p"))+" · ":""}`;
  const mt=N.types[0]?N.types[0].n:1;
  return `<div class="kv"><span>${t("nFiles")}</span><span>${fmtN(N.files)} · ${tf("nSplit",{a:fmtN(N.notes),b:fmtN(N.other)})}</span>
   <span>${t("nSize")}</span><span>${fmtB(N.bytes)}</span><span>${t("nProjects")}</span><span>${fmtN(N.projects)}</span>
   <span>${t("nSpan")}</span><span>${N.first?monLabel(N.first)+(N.last!==N.first?" – "+monLabel(N.last):""):t("notAvail")}</span>
   <span>${t("nRecent")}</span><span>${fmtN(N.recent)}</span>${N.busiest?`<span>${t("nBusiest")}</span><span>${monLabel(N.busiest.month)} · ${fmtN(N.busiest.total)}</span>`:""}</div>
  <div class="sec">${t("nLinks")}</div><div class="kv"><span>${t("nByUser")}</span><span>${fmtN(N.byUser)}</span><span>${t("nAuto")}</span><span>${fmtN(N.auto)}</span>
   <span>${t("nSugg")}</span><span>${fmtN(N.suggested)}</span><span>${t("nOrphans")}</span><span>${fmtN(N.orphans)}</span></div>
   ${N.orphans?`<p class="hint" style="margin-top:6px">${t("nOrphansD")}</p>`:""}
  ${N.hubs.length?`<div class="sec">${t("nHubs")}</div><div class="list">${N.hubs.map(r=>fileRow(r)+tf("nLinkN",{n:r.links})+`</span></div>`).join("")}</div>`:""}
  <div class="sec">${t("nTypes")}</div>${N.types.slice(0,8).map(x=>hb(esc(x.k.toUpperCase()),x.n,mt,fmtN(x.n))).join("")}
  <div class="sec">${t("nLargest")}</div><div class="list">${N.largest.map(r=>fileRow(r)+fmtB(r.size)+`</span></div>`).join("")}</div>
  <div class="sec">${t("nYou")}</div><div class="kv"><span>${t("nYouWrote")}</span><span>${t("notAvail")}</span><span>${t("nClaudeWrote")}</span><span>${t("notAvail")}</span></div>
  <p class="hint" style="margin-top:6px">${t("nYouD")}</p>`;}
let pendingOpen=null;
function onLib(){realContent.clear();VAULTS.data=null;FR.data=null;if(AG.data){AG.data=null;if(open.has("activity")&&(actTab==="agents"||actTab==="learn"))loadAgents();}RT.data=null;TPL=null;BASES.clear();if(FS.q.trim()&&memTab==="search")runSearch();GROUP_BY.forEach(b=>assignColors(lib.rows,b));if(st.colorBy==="tag"||tagsLoaded())loadTagColors();REAL.setLook(st.look==="dust");REAL.update(lib.rows,lib.links);REAL.setMorph(lib.count?st.form:0,true);applyFormFade();REAL.setLinks(st.links);if(lgFocus!==null||tmFocus)REAL.setFocus(lgFocus!==null?idsInGroup(lib.rows,st.colorBy,lgFocus):idsInMonth(lib.rows,tmFocus));renderLegend();const demo=!lib.ready||lib.count===0;nodePts.visible=demo;nodeEdges.visible=demo;if(!demo)setLib(lib.count);
  if(curReal>=REAL.count)curReal=-1;refreshOv("memory");refreshNode();dirty=true;wake();
  if(pendingOpen){const i=REAL.indexOfFile(pendingOpen);pendingOpen=null;if(i>=0){openReal(i);flyReal(i);}}
  BR.plan=null;if(memTab==="brains"&&open.has("memory"))planBrain();if(BR.list.some(b=>b.visible)){BR.data.clear();refreshBrains();}}
function realImportDlg(paths){const B=bridge();
  B.plan(paths).then(p=>{if(!p.count){toast(t("imp_fail"));return;}
    const nm1=paths.length===1?paths[0].split(/[\\/]/).pop():paths.length+" "+t("files");
    importDlg({n:p.count,bytes:p.bytes,name:nm1,paths,suggest:p.suggest,vault:!!p.vault});}).catch(()=>toast(t("imp_fail")));}
function runRealImport(paths,name){const B=bridge();
  idx={name,n:1,done:0,paused:false,fin:false,real:true};idxRender();
  const off=B.onProgress(p=>{if(!idx||!idx.real)return;idx.n=p.total;idx.done=p.done;act[0]=Math.max(act[0],.5);paint();dirty=true;idxRender();wake();});
  B.import(paths).then(r=>{off();
    const sum=importSummary(r,t,tf);evoLog.unshift({ty:"import",txt:sum,d:stamp()});refreshOv("evolution");toast(sum);
    if(idx){idx.done=idx.n;idx.fin=true;idxRender();}setTimeout(()=>{idx=null;idxRender();},2200);
    refreshLibrary(onLib);}).catch(()=>{off();idx=null;idxRender();toast(t("imp_fail"));});}
function runRealLink(paths,name){const B=bridge();
  idx={name,n:1,done:0,paused:false,fin:false,real:true,link:true};idxRender();
  const off=B.onProgress(p=>{if(!idx||!idx.real)return;idx.done=p.done;idx.n=Math.max(p.total||p.done,1);act[0]=Math.max(act[0],.5);paint();dirty=true;idxRender();wake();});
  B.link(paths).then(r=>{off();
    const files=r.failed.filter(f=>f.error==="ENOTDIR").map(f=>f.path);   // single files in the selection are copied as usual
    const sum=linkSummary(r,t,tf);evoLog.unshift({ty:"import",txt:sum,d:stamp()});refreshOv("evolution");toast(sum);
    if(idx){idx.done=idx.n;idx.fin=true;idxRender();}setTimeout(()=>{idx=null;idxRender();},2200);
    refreshLibrary(onLib);if(files.length)setTimeout(()=>runRealImport(files,files.length+" "+t("files")),2300);}).catch(()=>{off();idx=null;idxRender();toast(t("imp_fail"));});}
{const B=bridge();if(B&&B.onChanged)B.onChanged(()=>refreshLibrary(onLib));}
refreshLibrary(onLib);

/* ---------- indexing progress (temporary, disappears when done) ---------- */
let idx=null;const idxEl=document.createElement("div");idxEl.id="idx";idxEl.className="glass";idxEl.hidden=true;document.body.appendChild(idxEl);
function idxRender(){if(!idx){idxEl.hidden=true;return;}const p=Math.min(1,idx.done/idx.n);idxEl.hidden=false;
  idxEl.innerHTML=`<span>${esc(idx.fin?t("idx_done"):tf("idx_run",{name:st.privacy?"…":idx.name}))}</span><div class="bar"><i style="width:${(p*100).toFixed(1)}%"></i></div><span class="mono">${fmtN(Math.round(idx.done))} / ${fmtN(idx.n)}</span>${idx.fin||idx.real?"":`<button class="btn sm" type="button" id="idxp">${idx.paused?t("idxResume"):t("idxPause")}</button>`}`;}
idxEl.addEventListener("click",e=>{if(e.target.id==="idxp"&&idx){idx.paused=!idx.paused;idxRender();}});
function startIndex(name,n){idx={name,n,done:0,paused:false,fin:false};idxRender();refreshOv("health");
  const tm=setInterval(()=>{if(!idx){clearInterval(tm);return;}if(idx.paused)return;idx.done+=idx.n/45;act[0]=Math.max(act[0],.5);paint();dirty=true;
    if(idx.done>=idx.n){idx.done=idx.n;idx.fin=true;clearInterval(tm);evoLog.unshift({ty:"index",txt:tf("ev_index",{n:fmtN(idx.n)}),d:stamp()});refreshOv("evolution");idxRender();setTimeout(()=>{idx=null;idxRender();refreshOv("health");},2200);return;}
    idxRender();},140);}


/* ---------- files (file explorer: linked folders as a tree; changes only where editing is on) ---------- */
const filesBridge=()=>window.neuralOS&&window.neuralOS.files;
function loadTree(){const F=filesBridge();if(!F)return;F.tree().then(tr=>{FT.tree=tr||[];refreshOv("files");}).catch(()=>{FT.tree=[];refreshOv("files");});}
BODY.files=()=>{if(!FT.tree&&!FT.busy){FT.busy=true;loadTree();setTimeout(()=>FT.busy=false,500);}
  return bmBlock()+filesBody({t,tf,esc,privacy:st.privacy,rows:lib.rows||[],curId:curReal>=0&&REAL.nodes[curReal]&&REAL.nodes[curReal].row?REAL.nodes[curReal].row.id:null});};
const fsErr=R=>toast(t("fxErr_"+((R&&R.reason)||"failed")));
function fsAfter(R,openId){if(!R||!R.ok){fsErr(R);return false;}if(openId)pendingOpen=openId;FT.tree=null;refreshLibrary(onLib);loadTree();return true;}
function fsFocusRen(){const x=document.getElementById("fsren");if(x){x.focus();x.select();}}
function fsCommitRen(x){const key=x.dataset.k,name=x.value.trim();FT.ren=null;if(!name){refreshOv("files");return;}
  const [fid,rel]=splitKey(key),F=filesBridge(),B=bridge();const row=(lib.rows||[]).find(r=>r.folder_id===fid&&r.rel_path===rel);
  const old=fsBase(rel),oldShown=row&&row.ext==="md"?old.replace(/\.md$/i,""):old;if(name===oldShown){refreshOv("files");return;}
  if(row&&(row.ext==="md"||row.ext==="txt")&&B&&B.rename){edFlush();B.rename(row.id,name).then(R=>{if(!R.ok){fsErr(R);refreshOv("files");return;}if(ED.id===row.id)ED.id=null;realContent.clear();toast(tf("edRenamed",{n:R.name.replace(/\.(md|txt)$/i,""),u:R.updated}));fsAfter(R,row.id);});}
  else if(row)F.moveFile(row.id,fsParent(rel),name).then(R=>{fsAfter(R)||refreshOv("files");});
  else F.move(fid,rel,fsParent(rel),name).then(R=>{if(R&&R.ok){const o=fid+"|"+rel;if(FT.open.delete(o))FT.open.add(fid+"|"+R.rel);}fsAfter(R)||refreshOv("files");});}
ovRoot.addEventListener("keydown",e=>{const x=e.target;if(!x||x.id!=="fsren")return;if(e.key==="Enter"){e.preventDefault();fsCommitRen(x);}else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();FT.ren=null;refreshOv("files");}});
ovRoot.addEventListener("focusout",e=>{const x=e.target;if(x&&x.id==="fsren"&&FT.ren)fsCommitRen(x);});
function fsAction(a,v){const F=filesBridge();if(!F)return false;const [fid,rel]=v?splitKey(v):["",""];
  if(a==="fsopen"){if(rel==="")return true;FT.open.has(v)?FT.open.delete(v):FT.open.add(v);refreshOv("files");}
  else if(a==="fsnew"){F.newNote(fid,rel,t("fxUntitled")).then(R=>{if(fsAfter(R,R&&R.id)){ED.view="edit";if(rel)FT.open.add(v);}});}
  else if(a==="fsdir"){F.newFolder(fid,rel,t("fxNewFolderName")).then(R=>{if(R&&R.ok){if(rel)FT.open.add(v);FT.ren=fid+"|"+R.rel;}fsAfter(R);});}
  else if(a==="fsren"){FT.ren=v;refreshOv("files");setTimeout(fsFocusRen,0);}
  else if(a==="fstrash"){edFlush();F.trash(fid,rel).then(R=>{if(R&&R.ok){FT.undo={fid,rel,trash:R.trash};clearTimeout(FT.undoT);FT.undoT=setTimeout(()=>{FT.undo=null;refreshOv("files");},20000);}fsAfter(R);});}
  else if(a==="fsundo"){const U=FT.undo;FT.undo=null;if(U)F.untrash(U.fid,U.trash,U.rel).then(R=>fsAfter(R));}
  else if(a==="fsmore"){FT.more.add(v);refreshOv("files");}
  else return false;return true;}
ovRoot.addEventListener("click",e=>{const b=e.target.closest("[data-x]");if(!b||!b.closest('.ov[data-m="files"]'))return;const x=b.dataset.x,i=x.indexOf(":");
  if(fsAction(i<0?x:x.slice(0,i),i<0?"":x.slice(i+1)))e.stopPropagation();},true);
// drag and drop: a file or folder onto a folder moves it (same linked folder only)
let fsDrag=null;
ovRoot.addEventListener("dragstart",e=>{const r=e.target.closest&&e.target.closest('.ov[data-m="files"] [data-ff],.ov[data-m="files"] [data-fd]');if(!r)return;fsDrag=r.dataset.ff?{key:r.dataset.ff,id:r.dataset.id}:{key:r.dataset.fd};e.dataTransfer.effectAllowed="move";try{e.dataTransfer.setData("text/plain",fsDrag.key);}catch(_){}});
ovRoot.addEventListener("dragend",()=>{fsDrag=null;if(FT.dropOn){FT.dropOn=null;refreshOv("files");}});
const fsTarget=e=>{const d=e.target.closest&&e.target.closest('.ov[data-m="files"] [data-fd]');if(!d||!fsDrag)return null;const [f1,r1]=splitKey(fsDrag.key),[f2,r2]=splitKey(d.dataset.fd);
  if(f1!==f2||r2===fsParent(r1)||r2===r1||r2.startsWith(r1+"/"))return null;return d;};
ovRoot.addEventListener("dragover",e=>{const d=fsTarget(e);if(!d)return;e.preventDefault();e.dataTransfer.dropEffect="move";if(FT.dropOn!==d.dataset.fd){ovRoot.querySelectorAll(".ft.drop").forEach(n=>n.classList.remove("drop"));d.classList.add("drop");FT.dropOn=d.dataset.fd;}});
ovRoot.addEventListener("drop",e=>{const d=fsTarget(e);if(!d)return;e.preventDefault();e.stopPropagation();const F=filesBridge(),[fid,rel]=splitKey(fsDrag.key),[,to]=splitKey(d.dataset.fd),D=fsDrag;fsDrag=null;FT.dropOn=null;
  if(D.id)F.moveFile(D.id,to).then(R=>fsAfter(R));else F.move(fid,rel,to).then(R=>{if(R&&R.ok&&FT.open.delete(D.key))FT.open.add(fid+"|"+R.rel);if(fsAfter(R))FT.open.add(d.dataset.fd);});});
{const B=bridge();if(B&&B.onChanged)B.onChanged(()=>{if(open.has("files")){FT.tree=null;loadTree();}});}

/* ---------- images into notes: paste or drop on the editor; saved where Obsidian would put them, ![[name]] at the cursor ---------- */
const ATT_EXT=/\.(png|jpe?g|gif|webp|svg|bmp|avif|pdf)$/i;
const attStamp=()=>{const d=new Date(),p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;};
async function attachFiles(ta,files){const B=bridge();if(!B||!B.attach||!ED.id)return;const id=ED.id;let n=0;
  for(const f of files){let name=f.name||"";if(!name||/^image\.(png|jpe?g|gif|webp)$/i.test(name))name=`Pasted image ${attStamp()}${n?" "+n:""}.${(f.type.split("/")[1]||"png").replace("jpeg","jpg").replace("svg+xml","svg")}`;
    if(!ATT_EXT.test(name)){toast(t("attErr_type"));continue;}
    const R=await B.attach(id,name,await f.arrayBuffer()).catch(()=>({ok:false,reason:"failed"}));
    if(!R.ok){toast(t("attErr_"+(R.reason||"failed")));continue;}n++;
    if(ED.id!==id)continue;ta.focus();const s=ta.selectionStart,before=ta.value.slice(0,s),lead=before&&!before.endsWith("\n")?"\n":"";
    document.execCommand("insertText",false,`${lead}![[${R.name}]]\n`);}
  if(n){toast(tf("attDone",{n}));refreshLibrary(()=>{onLib();const pv=document.getElementById("redprev");if(pv){pv.innerHTML=noteHtml(ED.text,realWl);hydrate(pv,"rnode");}});}}
const onRed=e=>e.target&&e.target.id==="red";
ovRoot.addEventListener("paste",e=>{if(!onRed(e))return;const fs=[...(e.clipboardData&&e.clipboardData.files||[])];if(!fs.length)return;e.preventDefault();attachFiles(e.target,fs);});
for(const ev of ["dragenter","dragover"])ovRoot.addEventListener(ev,e=>{if(!onRed(e)||!e.dataTransfer||![...e.dataTransfer.types].includes("Files"))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect="copy";});
ovRoot.addEventListener("drop",e=>{if(!onRed(e)||!e.dataTransfer||!e.dataTransfer.files.length)return;e.preventDefault();e.stopPropagation();attachFiles(e.target,[...e.dataTransfer.files]);});

/* ---------- hover preview of [[links]] (like Obsidian's page preview) ---------- */
let hovEl=null,hovT=0,hovId=null;
function hovHide(){clearTimeout(hovT);hovId=null;if(hovEl){hovEl.remove();hovEl=null;}}
function hovShow(a,id){const r=lib.rows.find(x=>x.id===id),B=bridge();if(!r||!B||!B.read||st.privacy)return;
  const put=c=>{if(hovId!==id)return;if(!hovEl){hovEl=document.createElement("div");hovEl.id="hov";hovEl.className="glass";document.body.appendChild(hovEl);hovEl.addEventListener("mouseleave",hovHide);}
    hovEl.innerHTML=`<div class="hh">${esc(r.name.replace(/\.md$/i,""))}</div><div class="rcontent">${contentBody(c,realWl)}</div>`;hydrate(hovEl,"hover");
    const b=a.getBoundingClientRect(),W=Math.min(420,innerWidth-24);hovEl.style.width=W+"px";hovEl.style.left=Math.max(12,Math.min(b.left,innerWidth-W-12))+"px";
    const below=b.bottom+8,h=Math.min(340,innerHeight*.5);hovEl.style.top=(below+h<innerHeight?below:Math.max(12,b.top-h-8))+"px";};
  const c=realContent.get(id);if(c)put(c);else B.read(id).then(x=>{realContent.set(id,x);put(x);}).catch(()=>{});}
ovRoot.addEventListener("mouseover",e=>{const a=e.target.closest&&e.target.closest(".wl[data-real],.ft.f [data-real]");if(!a){return;}const id=a.dataset.real;if(id===hovId)return;
  if(a.closest(".ft.f")&&!(e.ctrlKey||e.metaKey))return;   // in the file tree only with Ctrl/Cmd held, like Obsidian
  clearTimeout(hovT);hovT=setTimeout(()=>{hovId=id;hovShow(a,id);},450);
  a.addEventListener("mouseleave",ev=>{clearTimeout(hovT);if(hovEl&&ev.relatedTarget&&hovEl.contains(ev.relatedTarget))return;setTimeout(()=>{if(hovEl&&!hovEl.matches(":hover"))hovHide();},120);},{once:true});});
addEventListener("pointerdown",e=>{if(hovEl&&!hovEl.contains(e.target))hovHide();},true);
addEventListener("keydown",e=>{if(e.key==="Escape"&&hovEl)hovHide();});
ovRoot.addEventListener("click",()=>{if(hovEl)hovHide();});
/* ---------- bookmarks: starred notes, listed on top of Files (kept on this computer) ---------- */
const BM={ids:[]};try{const x=JSON.parse(localStorage.getItem("nos-bookmarks")||"[]");if(Array.isArray(x))BM.ids=x.slice(0,200);}catch(e){}
function bmSave(){try{localStorage.setItem("nos-bookmarks",JSON.stringify(BM.ids));}catch(e){}}
function bmToggle(id){const k=BM.ids.indexOf(id);if(k>=0)BM.ids.splice(k,1);else BM.ids.unshift(id);bmSave();toast(t(k>=0?"bmOff":"bmOn"));refreshNode();refreshOv("files");}
const bmBtn=id=>`<button class="btn sm${BM.ids.includes(id)?" on":""}" type="button" data-x="bm:${esc(id)}" title="${esc(t(BM.ids.includes(id)?"bmRemove":"bmAdd"))}" aria-pressed="${BM.ids.includes(id)}">${BM.ids.includes(id)?"★":"☆"}</button>`;
function bmBlock(){const byId=new Map((lib.rows||[]).map(r=>[r.id,r])),rows=BM.ids.map(id=>byId.get(id)).filter(Boolean);if(!rows.length)return "";
  return `<div class="sec">${t("bmT")}</div><div class="fstree">${rows.map(r=>`<div class="ft f" style="padding-left:6px"><span class="car">★</span><span class="fn" data-real="${esc(r.id)}">${esc(st.privacy?"…":r.name.replace(/\.md$/i,""))}</span><span class="fst"><button type="button" data-x="bm:${esc(r.id)}" title="${esc(t("bmRemove"))}">✕</button></span></div>`).join("")}</div><div class="sec">${t("fxTreeT")}</div>`;}
ovRoot.addEventListener("click",e=>{const b=e.target.closest('[data-x^="bm:"]');if(!b)return;e.stopPropagation();bmToggle(b.dataset.x.slice(3));},true);

/* ---------- properties editor (frontmatter as rows; ui/props.js) ---------- */
function propsApply(P){const ta=document.getElementById("red");const text=serializeProps(P,parseProps(ED.text).body);if(text===ED.text)return;ED.text=text;if(ta)ta.value=text;ED.dirty=true;ED.status="";edPaintStatus();if(ED.theirs===null)edSchedule();
  clearTimeout(ED.prevT);ED.prevT=setTimeout(()=>{const pv=document.getElementById("redprev");if(pv){pv.innerHTML=noteHtml(ED.text,realWl);hydrate(pv,"rnode");}},180);}
function propsFromDom(){const P=parseProps(ED.text).props;document.querySelectorAll('.ov[data-m="rnode"] .props [data-pi]').forEach(x=>{const p=P[+x.dataset.pi];if(!p)return;
  if(x.dataset.pf==="k")p.key=x.value;else p.value=Array.isArray(p.value)?x.value.split(",").map(s=>s.trim()).filter(Boolean):x.value;});return P;}
ovRoot.addEventListener("input",e=>{if(e.target.closest&&e.target.closest(".props")&&e.target.dataset.pi!==undefined)propsApply(propsFromDom());});
ovRoot.addEventListener("click",e=>{const b=e.target.closest('[data-x="props"],[data-x^="propdel:"],[data-x^="propadd"]');if(!b||!b.closest('.ov[data-m="rnode"]'))return;e.stopPropagation();const x=b.dataset.x;
  if(x==="props"){ED.propsOpen=!ED.propsOpen;refreshOv("rnode");return;}
  const P=propsFromDom();if(x.startsWith("propdel:"))P.splice(+x.slice(8),1);
  else if(x==="propadd:tags"){if(!P.some(p=>p.key==="tags"))P.push({key:"tags",value:[]});else{toast(t("propsHasTags"));return;}}
  else P.push({key:t("propsNewName")+(P.length?" "+(P.length+1):""),value:""});
  propsApply(P);
  refreshOv("rnode");},true);

/* ---------- PDF export of the open note (main process prints it in a hidden window without scripts) ---------- */
async function notePdf(){const N=REAL.nodes[curReal],B=bridge();if(!N||!N.row||!B||!B.pdf)return;const r=N.row;
  const c=realContent.get(r.id),text=ED.id===r.id?ED.text:c&&c.kind==="text"?c.text:null;if(text===null){toast(t("pdfNo"));return;}
  const P=parseProps(text),box=document.createElement("div");box.style.cssText="position:fixed;left:-99999px;top:0;width:800px";document.body.appendChild(box);
  box.innerHTML=(P.props.length?`<div class="props-print">${P.props.map(p=>`<div><b>${esc(p.key)}:</b> ${esc(Array.isArray(p.value)?p.value.join(", "):String(p.value))}</div>`).join("")}</div>`:"")+renderMarkdown(P.body,{resolve:realWl,t});
  hydrate(box,"rnode");toast(t("pdfWait"));
  for(let k=0;k<30&&box.querySelector(".embed[data-embed]:not(.miss), .math[data-tex]:not([data-done])");k++)await new Promise(f=>setTimeout(f,100));
  box.querySelectorAll("[data-real],[data-heading],[data-embed]").forEach(el=>{el.removeAttribute("data-real");});
  const html=box.innerHTML;box.remove();
  const R=await B.pdf(r.name,html).catch(()=>({ok:false,reason:"failed"}));if(R.ok)toast(t("pdfDone"));else if(R.reason!=="cancel")toast(t("pdfFail"));}
ovRoot.addEventListener("click",e=>{const b=e.target.closest('[data-x="notepdf"]');if(!b)return;e.stopPropagation();notePdf();},true);

// test mode: example vault in NEURAL OS's own data folder (main: library/example.ts)
function tryExample(){const B=bridge();if(!B||!B.example)return;B.example(lang).then(R=>{toast(t(R&&R.created?"exCreated":"exThere"));FT.tree=null;refreshLibrary(onLib);openOv("files");}).catch(()=>toast(t("fxErr_failed")));}
ovRoot.addEventListener("click",e=>{const b=e.target.closest('[data-x="tryexample"]');if(!b)return;e.stopPropagation();tryExample();},true);

/* ---------- context menu (library rows and nodes in the brain) ---------- */
let ctxEl=null;function ctxClose(){if(ctxEl){ctxEl.remove();ctxEl=null;}}
function ctxOpen(x,y,i){ctxClose();ctxEl=document.createElement("div");ctxEl.id="ctx";ctxEl.className="glass";
  ctxEl.innerHTML=`<button type="button" data-cx="open">${t("open")}</button><button type="button" data-cx="pack">${t("packAdd")}</button><button type="button" data-cx="fly">${t("showInBrain")}</button><button type="button" data-cx="rm">${t("removeLib")}</button>`;
  ctxEl.style.left=Math.min(x,innerWidth-220)+"px";ctxEl.style.top=Math.min(y,innerHeight-170)+"px";document.body.appendChild(ctxEl);
  ctxEl.addEventListener("click",e=>{const b=e.target.closest("[data-cx]");if(!b)return;const a=b.dataset.cx;ctxClose();
    if(a==="open")openNote(i,false);else if(a==="pack"){packSel.add(i);memTab="lib";openNote(i,false);memTab="lib";fill("memory");}else if(a==="fly")flyTo(nodeOfFile(i));
    else confirmDlg(t("removeLib").replace("…",""),t("removeQ"),t("remove"),()=>toast(t("remove")+" · Demo"));});}
addEventListener("pointerdown",e=>{if(ctxEl&&!ctxEl.contains(e.target))ctxClose();},true);
ovRoot.addEventListener("contextmenu",e=>{const r=e.target.closest("[data-libi]");if(r){e.preventDefault();ctxOpen(e.clientX,e.clientY,+r.dataset.libi);}});
canvas.addEventListener("contextmenu",e=>{const n=pickNode(e.clientX,e.clientY);if(n>=0&&NODES[n].fi!==undefined)ctxOpen(e.clientX,e.clientY,NODES[n].fi);});

/* ---------- overlay interaction for all new controls ---------- */
ovRoot.addEventListener("click",e=>{   // capture: wikilinks outside Memory open the note; activity rows fly to their file node
  const nt=e.target.closest("[data-note]");const ov=e.target.closest(".ov");
  if(nt&&ov&&ov.dataset.m!=="memory"){e.stopPropagation();openNote(+nt.dataset.note,true);return;}
  const ev=e.target.closest(".evc");if(ev){const m=/· \S+ \S+ (.+)$/.exec(ev.title||"");const i=FILES.findIndex(F=>(ev.title||"").includes(F.n));if(i>=0)flyTo(nodeOfFile(i));}},true);
ovRoot.addEventListener("click",e=>{const bf=e.target.closest("[data-bfile]");if(bf&&curB){curB={brain:curB.brain,fid:bf.dataset.bfile};fill("bnode");flyForeign();e.stopPropagation();return;}},true);
ovRoot.addEventListener("click",e=>{const tg=e.target.closest("[data-tag]");if(tg&&lib.count&&tg.closest(".rcontent,.prev,.embed-note")){RT.cur=String(tg.dataset.tag).toLowerCase();memTab="tags";if(open.has("memory"))fill("memory");else openOv("memory");return;}
  const hl=e.target.closest(".wl[data-heading]:not([data-real])");if(hl){scrollToHead(hl.closest(".ov"),hl.dataset.heading);return;}
  const rl=e.target.closest("[data-real]");if(rl){pendingHead=rl.dataset.heading||null;let i=REAL.indexOfFile(rl.dataset.real);if(i>=0&&REAL.nodes[i].kind==="cluster"){i=REAL.revealFile(rl.dataset.real);REAL.setLinks(st.links);}if(i>=0){openReal(i);flyReal(i);}return;}});
ovRoot.addEventListener("click",e=>{const lr=e.target.closest("[data-libi]");if(lr&&!e.target.closest("input")){openNote(+lr.dataset.libi,true);return;}
  const b=e.target.closest("[data-x]");if(!b||b.tagName==="SELECT"||b.type==="checkbox")return;const parts=b.dataset.x.split(":"),[a,v,w]=parts;
  if(a==="mtab"){memTab=v;fill("memory");}else if(a==="mview"){memView=v;fill("memory");}else if(a==="ltype"){libType=v||"";fill("memory");}
  else if(a==="tag"){curTag=curTag===v?"":v;fill("memory");}else if(a==="opennote"){openNote(+v,true);}
  else if(a==="daily"){openNote(0,true);}else if(a==="flynote"){flyTo(nodeOfFile(curNote));}else if(a==="flynode"){flyTo(curNode);}else if(a==="flyreal"){flyReal(curReal);}else if(a==="rclose"){const N=REAL.nodes[curReal];if(N&&N.kind==="project"){REAL.setOpen(N.project,false);REAL.setLinks(st.links);curReal=REAL.nodes.findIndex(n=>n.kind==="cluster"&&n.key===N.project);dirty=true;closeOv("rnode");}}
  else if(a==="sacc"){noteText[curNote]=(noteText[curNote]||"")+`\n\n[[${baseName(FILES[+v].n)}]]`;noteVer[curNote]++;fill("memory");buildLinksLater();}
  else if(a==="sdis"){dismissed.add(curNote+">"+v);fill("memory");}
  else if(a==="pack"){ms={kind:"pack",full:false,wide:false};showModal();}
  else if(a==="openfolder"){toast("~/NEURAL OS/Library");}
  else if(a==="autolink"){const B=bridge();if(B)B.setAutoLink(v==="1").then(()=>refreshLibrary(onLib));}
  else if(a==="liblink"){const B=bridge();if(B)B.pick(true).then(ps=>{if(ps.length)runRealLink(ps,ps.length===1?ps[0].split(/[\\/]/).pop():ps.length+" "+t("files"));});}
  else if(a==="libunlink"){const B=bridge(),f=lib.folders.find(x=>x.id===v);if(B&&f)confirmDlg(t("unlinkT"),tf("unlinkD",{name:f.name}),t("unlink"),()=>B.unlink(f.id).then(()=>refreshLibrary(onLib)));}
  else if(a==="libopen"){const B=bridge();if(B)B.openFolder();}
  else if(a==="libadd"){const B=bridge();if(B)B.pick(v==="folder").then(ps=>{if(ps.length)realImportDlg(ps);});}
  else if(a==="openproj"){curProj=v;openOv("projects");fill("projects");}
  else if(a==="diff"){diffDlg("rule");}else if(a==="diffv"){diffDlg(v,true);}
  else if(a==="toast"){toast(t(v==="move"?"moveD":"demo")+(v==="move"?"":" · "+t(v==="rename"?"actRename":v==="tags"?"actTags":"actLinks")));}
  else if(a==="setopen"){openOv("setup");}
  else if(a==="edview"){if(v==="prev")edFlush();ED.view=v;fill("rnode");if(v==="edit"){const x=document.getElementById("red");if(x)x.focus();}}
  else if(a==="mensearch"){mentionsSearch();}
  else if(a==="libexcl"){lib.exclOpen=lib.exclOpen===v?"":v;fill("memory");if(lib.exclOpen){const x=document.getElementById("lexcl");if(x)x.focus();}}
  else if(a==="libexclok"){const B=bridge(),x=document.getElementById("lexcl");if(!B||!B.setExclude||!x)return;b.disabled=true;toast(t("exclBusy"));
    B.setExclude(v,x.value).then(R=>{lib.exclOpen="";if(R&&R.ok)toast(tf("exclDone",{n:R.total,r:R.removed}));if(lib.health)B.health().then(h=>{lib.health=h;});refreshLibrary(onLib);});}
  else if(a==="librescan"){const B=bridge();if(!B||!B.rescan)return;b.disabled=true;toast(t("rescanBusy"));B.rescan(v).then(R=>{toast(R&&R.ok?tf("rescanDone",{a:R.added,c:R.changed,r:R.removed}):t("rescanFail"));refreshLibrary(onLib);});}
  else if(a==="libhealth"){const B=bridge();if(!B||!B.health)return;if(lib.health){lib.health=null;fill("memory");return;}B.health().then(h=>{lib.health=h;fill("memory");});}
  else if(a==="grshow"){GR.open=!GR.open;GR.data=null;fill("connectors");}
  else if(a==="grreload"){GR.data=null;fill("connectors");}
  else if(a==="rchide"){AWAY.hidden=true;fill("activity");}
  else if(a==="frreload"){FR.data=null;fill("memory");}
  else if(a==="agf"){AG.f=v||"";fill("activity");}
  else if(a==="agreload"){loadAgents(true);}
  else if(a==="lestake"){const MB=monBridge(),l=AG.data&&AG.data.learnings[+v];if(!MB||!l)return;b.disabled=true;MB.lessonAdd(LES.sel||"",l.text).then(()=>{toast(t("lesTakenT"));LES.projects=null;fill("activity");});}
  else if(a==="rltype"){lib.typeFilter=lib.typeFilter===v?"":v;fill("memory");}
  else if(a==="bview"){baseView=+v;fill("rnode");}
  else if(a==="outline"){outlineOn=!outlineOn;fill("rnode");}
  else if(a==="edh"){scrollToHead(b.closest(".ov"),parts.slice(1).join(":"));}
  else if(a==="focus"){setFocus(!document.body.classList.contains("focus"));fill("rnode");}
  else if(a==="libdaily"){const B=bridge();if(!B||!B.daily)return;B.daily(lang).then(R=>{if(!R||!R.id)return;toast(t(R.created?"dailyCreated":"dailyOpened"));pendingOpen=R.id;refreshLibrary(onLib);});}
  else if(a==="rtag"){const g=parts.slice(1).join(":");RT.cur=RT.cur===g?"":g;fill("memory");}
  else if(a==="menlink"){const B=bridge(),N=REAL.nodes[curReal];if(!B||!N||!N.row)return;const to=N.row.id;b.disabled=true;
    B.linkMention(v,to).then(R=>{if(R.ok){realContent.delete(v);if(MEN.res)MEN.res.mentions=MEN.res.mentions.filter(x=>x.id!==v);toast(t("menLinked"));refreshNode();}else toast(tf("edError",{e:t("edWhyErr_"+(R.reason||"failed"))}));});}
  else if(a==="edren"){ED.ren=!ED.ren;fill("rnode");if(ED.ren){const x=document.getElementById("redname");if(x){x.focus();x.select();}}}
  else if(a==="edrenok"){edRename();}
  else if(a==="edver"){ED.showVer=!ED.showVer;ED.versions=null;ED.ver=null;fill("rnode");}
  else if(a==="edc"){if(v==="mine")edSave(true);else if(v==="cmp"){ED.cmp=!ED.cmp;fill("rnode");}
    else if(v==="theirs"){const mine=ED.text;ED.text=ED.theirs;ED.base=ED.theirsHash;ED.theirs=null;ED.cmp=false;ED.dirty=false;const c=realContent.get(ED.id);if(c)realContent.set(ED.id,{...c,text:ED.text,hash:ED.base});
      if(navigator.clipboard)navigator.clipboard.writeText(mine).catch(()=>{});toast(t("edMineCopied"));fill("rnode");}}
  else if(a==="edv"){const B=bridge();if(!B)return;
    if(v==="show"){if(ED.ver&&ED.ver.id===w){ED.ver=null;fill("rnode");}else B.version(w).then(x=>{ED.ver=x;fill("rnode");});}
    else if(v==="restore")confirmDlg(t("edRestoreT"),t("edRestoreD"),t("edRestore"),()=>{edFlush();B.restore(w).then(R=>{if(R.ok){const id=ED.id;realContent.delete(id);ED.id=null;toast(t("edRestored"));refreshOv("rnode");}else toast(tf("edError",{e:t("edWhyErr_"+(R.reason||"failed"))}));});});}
  else if(a==="libedit"){const B=bridge(),f=lib.folders.find(x=>x.id===v);if(!B||!f)return;
    if(w==="1")confirmDlg(t("edEnableT"),tf("edEnableD",{f:f.name}),t("edEnable"),()=>B.setEditable(f.id,true).then(()=>{realContent.clear();ED.id=null;refreshLibrary(onLib);}));
    else B.setEditable(f.id,false).then(()=>{realContent.clear();ED.id=null;refreshLibrary(onLib);});}
  else if(a==="libnew"){const B=bridge();if(!B||!B.create)return;B.create(t("edNewName")+" "+new Date().toLocaleString(lang==="de"?"de-DE":"en-GB").replace(/[/:]/g,"-").replace(",",""),null).then(n=>{ED.view="edit";pendingOpen=n.id;refreshLibrary(onLib);});}
  else if(a==="bexport"){const B=brainsBridge();if(!B||BR.busy)return;BR.busy="export";BR.prog=null;BR.last=null;BR.err=null;fill("memory");
    B.export(exportOpts(BR.exp,t("bDefaultName"))).then(R=>{BR.busy=null;if(R.ok)BR.last=R;else if(!R.canceled)BR.err=R.error||"?";fill("memory");});}
  else if(a==="breveal"){const B=brainsBridge();if(B&&BR.last)B.reveal(BR.last.path);}
  else if(a==="bimport"){const B=brainsBridge();if(!B||BR.busy)return;BR.busy="import";BR.prog=null;BR.err=null;fill("memory");
    B.import().then(R=>{BR.busy=null;if(R.ok){toast(tf("bImported",{name:R.brain.name,n:R.brain.files.toLocaleString()}));BR.ready=false;return refreshBrains();}if(!R.canceled)BR.err=R.error||"?";fill("memory");});}
  else if(a==="bvis"){const B=brainsBridge(),b=BR.list[+v];if(B&&b)B.visible(b.id,w==="1").then(()=>refreshBrains());}
  else if(a==="bfly"){const b=BR.list[+v],k=b?FB.brains.findIndex(x=>x.id===b.id):-1;if(k>=0)flyBrain(k);}
  else if(a==="brm"){const B=brainsBridge(),b=BR.list[+v];if(B&&b)confirmDlg(t("bRemoveT"),tf("bRemoveD",{name:b.name}),t("bRemove"),()=>B.remove(b.id).then(()=>{BR.data.delete(b.id);if(curB&&curB.brain===b.id){curB=null;closeOv("bnode");}refreshBrains();}));}
  else if(a==="bcopy"){if(curB&&curB.fid!==undefined)brainCopy([curB.fid]);}
  else if(a==="bcopyall"){const d=curB&&BR.data.get(curB.brain);if(d)brainCopy(d.files.filter(f=>(f.project||"")===curB.project).map(f=>f.id));}
  else if(a==="bflyf"){flyForeign();}
  else if(a==="appscan"){APPS.data=null;scanAppsNow();refreshOv("setup");}
  else if(a==="appguide"){const A=APPS.data&&APPS.data.apps.find(x=>x.id===v);if(A&&A.link)window.open(A.link,"_blank");}
  else if(a==="setgo"){if(v==="memory"&&w)memTab=w;if(v==="activity"&&w)actTab=w;if(open.has(v))refreshOv(v);else openOv(v);
    const act=parts[3];if(act==="mon"||act==="rule"||act==="ctx")setTimeout(()=>{const x=document.createElement("button");x.type="button";x.hidden=true;x.dataset.x=act+":plan";ovRoot.appendChild(x);x.click();x.remove();},60);}
  else if(a==="synccloud"){const C=SYNC.data&&SYNC.data.clouds[+v];if(C)syncSet(C.path);}
  else if(a==="syncpick"){const S=syncBridge();if(S)S.pick().then(f=>{if(f)syncSet(f);});}
  else if(a==="syncoff"){syncSet(null);}
  else if(a==="syncnow"){const S=syncBridge();if(S)S.now().then(d=>{SYNC.data=d;refreshOv("settings");toast(t("syncDone"));});}
  else if(a==="syncopen"){const S=syncBridge();if(S)S.open();}
  else if(a==="syncname"){const S=syncBridge(),i=document.getElementById("syncnm");if(S&&i&&i.value.trim())S.name(i.value).then(d=>{SYNC.data=d;refreshOv("settings");});}
  else if(a==="vlink"){const V=VAULTS.data&&VAULTS.data[+v];if(V&&!V.linked){V.linked=true;runRealLink([V.path],V.name);refreshOv("setup");}}
  else if(a==="ctx"){const MB=monBridge();if(!MB)return;
    if(v==="plan"){mon.ctxErr=null;mon.ctxRemove=w==="remove";MB.ctxPlan(mon.ctxRemove).then(P=>{mon.ctxPlan=P;fill("connectors");});}
    else if(v==="cancel"){mon.ctxPlan=null;fill("connectors");}
    else if(v==="copy"){const c=mon.ctxPlan&&mon.ctxPlan.command;if(c&&navigator.clipboard)navigator.clipboard.writeText(c).then(()=>toast(t("copied")),()=>{});}
    else if(v==="apply"){const rm=mon.ctxRemove;MB.ctxApply(rm).then(R=>{mon.ctxPlan=null;mon.ctxErr=R.ok?null:{error:R.error||null,output:R.output||R.error||""};toast(R.ok?t(rm?"ctxRemoved":"ctxInstalled"):t("monFailed")+(R.output?" · "+R.output.slice(0,120):""));return MB.ctxStatus();}).then(c=>{mon.ctx=c;refreshOv("setup");fill("connectors");});}}
  else if(a==="rule"){const MB=monBridge();if(!MB)return;
    if(v==="plan"){mon.ruleRemove=w==="remove";MB.rulePlan(mon.ruleRemove).then(P=>{mon.rulePlan=P;fill("connectors");});}
    else if(v==="cancel"){mon.rulePlan=null;fill("connectors");}
    else if(v==="apply"){const rm=mon.ruleRemove;MB.ruleApply(rm).then(R=>{mon.rulePlan=null;toast(t(R.ok?(rm?"ruleRemoved":"ruleInstalled"):"monFailed"));return MB.ruleStatus();}).then(st=>{mon.rule=st;fill("connectors");refreshOv("setup");});}}
  else if(a==="mon"){const MB=monBridge();if(!MB)return;
    if(v==="plan"){mon.planRemove=w==="remove";MB.plan(mon.planRemove).then(P=>{mon.plan=P;fill("activity");});}
    else if(v==="cancel"){mon.plan=null;fill("activity");}
    else if(v==="apply"){const rm=mon.planRemove;MB.apply(rm).then(R=>{mon.plan=null;mon.result=R;toast(t(R.ok?(rm?"monRemoved":"monInstalled"):"monFailed"));refreshMonitor(monChanged);});}
    else if(v==="backups"){MB.openBackups();}
    else if(v==="notes"){mon.notes=w==="1";MB.setNotes(mon.notes).then(()=>fill("activity"));}
    else if(v==="sel"){mon.sel=w||"";fill("activity");}
    else if(v==="sess"){const id=w,k=parts[3],S=mon.sessions.find(x=>x.id===id);if(!S)return;
      Promise.all([MB.mute(id,k==="mute"),MB.exclude(id,k==="off")]).then(()=>{S.muted=k==="mute"?1:0;S.excluded=k==="off";fill("activity");});}
    else if(v==="ch"){MB.change(w).then(C=>{mon.change=C;actTab="changes";if(!open.has("activity"))openOv("activity");fill("activity");});}
    else if(v==="chclose"){mon.change=null;fill("activity");}}
  else if(a==="les"){const MB=monBridge();if(!MB)return;const id=w,done=()=>{LES.edit=null;loadLessons();};
    if(v==="kept"||v==="dropped")MB.lessonUpdate(id,{status:v}).then(done);
    else if(v==="edit"){LES.edit=id;fill("activity");const x=document.getElementById("lesedit");if(x)x.focus();}
    else if(v==="cancel"){LES.edit=null;fill("activity");}
    else if(v==="save"){const x=document.getElementById("lesedit");if(x)MB.lessonUpdate(id,{text:x.value}).then(done);}
    else if(v==="del")confirmDlg(t("lesDelT"),t("lesDelD"),t("lesDel"),()=>MB.lessonRemove(id).then(done));
    else if(v==="add"){const x=document.getElementById("lesnew");if(x&&x.value.trim())MB.lessonAdd(LES.sel||"",x.value).then(R=>{if(!R)toast(t("lesDup"));done();});}}
  else if(a==="atab"){actTab=v;if(v==="learn")LES.projects=null;if(v!=="replay")rpPlay(false);fill("activity");}
  else if(a==="sess"){sessState[v]=w;fill("activity");}
  else if(a==="clearhist"){confirmDlg(t("clearHist"),t("clearQ"),t("del"),()=>{histCleared=true;log.length=0;fill("activity");toast(t("cleared"));});}
  else if(a==="rp"){if(v==="play"){if(rp.i>=RPL.ev.length-1)rp.i=0;rpPlay(!rp.on);if(rp.on)rpStep();}else if(v==="speed"){rp.speed=+w;if(rp.on)rpPlay(true);fill("activity");}}
  else if(a==="scan"){scanNerves();}
  else if(a==="fmode"){folderMode.vault=v;fill("security");}else if(a==="integ"){integState[v]=!integState[v];fill("security");}
  else if(a==="newproj"){let k=1;while(PLIST.includes(t("newProjName")+" "+k))k++;const nn=t("newProjName")+" "+k;PLIST.push(nn);curProj=nn;renaming=true;fill("projects");}
  else if(a==="renproj"){renaming=!renaming;fill("projects");}
  else if(a==="renok"){const inp=document.getElementById("pname");const nv=inp&&inp.value.trim();if(nv&&!PLIST.includes(nv)){PLIST[PLIST.indexOf(curProj)]=nv;if(PROJ[curProj]){PROJ[nv]=PROJ[curProj];}curProj=nv;}renaming=false;fill("projects");}
  else if(a==="q"){st.quality=v;applyQuality();fill("settings");}
  else if(a==="th"){setTheme(v);fill("settings");}
  else if(a==="lcol"){st.linkColor=v==="files"?"files":"region";saveView();REAL.repaintLines();dirty=true;fill("settings");}
  else if(a==="rl"){st.regLabels=v==="brain"?"brain":"side";saveView();renderLegend();fill("settings");}
  else if(a==="cby"){st.colorBy=v;if(v==="tag")loadTagColors();lgFocus=null;saveView();REAL.relayout();REAL.repaint();applyFocus();fill("settings");}
  else if(a==="turn"){st.turn=v==="1";saveView();fill("settings");}
  else if(a==="look"){st.look=v==="web"?"web":"dust";st.links=st.look==="web";saveView();REAL.setLook(st.look==="dust");REAL.setLinks(st.links);applyFormFade();dirty=true;wake();fill("settings");}
  else if(a==="vlinks"){st.links=v==="1";saveView();REAL.setLinks(st.links);nodeEdges.visible=st.links&&st.quality!=="low";fill("settings");}
  else if(a==="vreset"){Object.assign(st,{look:"web",linkColor:"region",regLabels:"side",form:0,colorBy:"project",psize:1,bright:1,turn:true,speed:1,links:true});saveView();setForm(0);resize();REAL.setLook(false);REAL.setLinks(true);REAL.setBright(1);applyFormFade();REAL.relayout();REAL.repaint();applyFocus();fill("settings");}
  else if(a==="tmon"){tmFocus=v&&tmFocus!==v?v:null;lgFocus=null;applyFocus();}
  else if(a==="dh"){st.dockHide=v==="1";document.body.classList.toggle("dockhide",st.dockHide);fill("settings");}
  else if(a==="mod"){if(w==="0"){hiddenMods.add(v);closeOv(v);}else hiddenMods.delete(v);rebuildDock();fill("settings");}
  else if(a==="demo"){({welcome:()=>welcome(0),import:()=>importDlg({n:18412,bytes:80.4e9,name:"Obsidian Vault"}),diff:()=>diffDlg("hooks"),conflict:conflictDlg,index:()=>startIndex("Obsidian Vault",18412)})[v]();}
  paintNodes();dirty=true;});
function buildLinksLater(){/* demo: new wikilinks show up in the note, backlinks and local graph; the 3D edges are built once at load */}
ovRoot.addEventListener("change",e=>{const s=e.target;
  if((s.dataset.x||"").startsWith("spick:")){const g=s.dataset.x.slice(6),P=new Set(setupPick());if(s.checked)P.add(g);else P.delete(g);try{localStorage.setItem(PICK_KEY,JSON.stringify([...P]));}catch(_){}refreshOv("setup");refreshOv("overview");return;}
  if((s.dataset.x||"").startsWith("bproj:")){const all=projectList(lib.rows).map(p=>p.name),k=s.dataset.x.slice(6);
    if(k==="all")BR.exp.projects=s.checked?null:new Set();else{const P=BR.exp.projects||new Set(all),n=all[+k];if(s.checked)P.add(n);else P.delete(n);BR.exp.projects=P.size===all.length?null:P;}
    BR.plan=null;planBrain();fill("memory");return;}
  if(s.dataset.x==="bsess"){BR.exp.sessions=s.checked;BR.plan=null;planBrain();fill("memory");return;}
  if(s.dataset.x==="psel"||(s.dataset.x||"").startsWith("psel:")){const i=+s.dataset.x.split(":")[1];if(s.checked)packSel.add(i);else packSel.delete(i);fill("memory");return;}
  const k=s.dataset.x;if(k==="lesproj"){LES.sel=s.value;LES.edit=null;const MB=monBridge();if(MB)MB.lessons(LES.sel).then(D=>{LES.data=D;fill("activity");});return;}
  if(k==="tpl"&&s.value){const T2={meeting:"\n\n## Besprechung\n- Teilnehmer:\n- Entscheidungen:\n- [ ] Nächste Schritte",idea:"\n\n## Idee\n- Problem:\n- Ansatz:",bug:"\n\n## Fehlerbericht\n- Schritte:\n- Erwartet:\n- Tatsächlich:"};noteText[curNote]+=T2[s.value];noteVer[curNote]++;memView="edit";fill("memory");return;}
  if(k==="hs"){hs=s.value;}else if(k==="ht"){ht=s.value;}else if(k==="hd"){hd=s.value;}else if(k==="ret"){st.ret=s.value;return;}
  else if(k==="proj"){curProj=s.value;renaming=false;fill("projects");return;}
  else if(s.id==="libsort"){libSort=s.value;fill("memory");return;}
  if(k==="hs"||k==="ht"||k==="hd"){const h=document.getElementById("hlist");if(h)h.innerHTML=histRows();}});
let saveT=0;
ovRoot.addEventListener("input",e=>{const s=e.target;if(s.id==="bname"){BR.exp.name=s.value;return;}if(s.id==="bauthor"){BR.exp.author=s.value;return;}
  if(s.id==="vform"){setForm(+s.value/100);saveView();return;}
  if(s.id==="vbright"){st.bright=+s.value/100;saveView();REAL.setBright(st.bright);dirty=true;wake();const o=document.getElementById("vbrightV");if(o)o.textContent=s.value+" %";return;}
  if(s.id==="vcby"){st.colorBy=s.value;if(s.value==="tag")loadTagColors();lgFocus=null;saveView();REAL.relayout();REAL.repaint();applyFocus();return;}
  if(s.id==="vpsize"){st.psize=+s.value/100;saveView();resize();const o=document.getElementById("vpsizeV");if(o)o.textContent=s.value+" %";return;}
  if(s.id==="vspeed"){st.speed=+s.value/100;saveView();const o=document.getElementById("vspeedV");if(o)o.textContent=s.value+" %";return;}
  if(s.id==="fsq"){FS.q=s.value;clearTimeout(FS.t);FS.t=setTimeout(runSearch,250);return;}
  if(s.id==="libq"){libQ=s.value;const L=FILES.map((F,i)=>i).filter(i=>(!libType||FX[i].ty===libType)&&(!libQ||(FILES[i].n+" "+noteSrc(i)).toLowerCase().includes(libQ.toLowerCase())));document.getElementById("liblist").innerHTML=libRows(L);return;}
  if(s.id==="hq"){hq=s.value;document.getElementById("hlist").innerHTML=histRows();return;}
  if(s.id==="rpos"){rp.i=+s.value;rpStep();return;}
  if(s.id==="red"){ED.text=s.value;ED.dirty=true;ED.status="";edPaintStatus();if(ED.theirs===null)edSchedule();
    clearTimeout(ED.prevT);ED.prevT=setTimeout(()=>{const pv=document.getElementById("redprev");if(pv){pv.innerHTML=noteHtml(ED.text,realWl);hydrate(pv,"rnode");}},180);
    const pre=s.value.slice(0,s.selectionStart),m=/\[\[([^\]\n|#]*)$/.exec(pre),ac=document.getElementById("rac");
    if(ac){if(m){const q=m[1].toLowerCase(),seen=new Set(),hits=[];for(const r of lib.rows){if(!/^(md|txt)$/.test(r.ext))continue;const n=r.name.replace(/\.[^.]+$/,"");if(seen.has(n.toLowerCase())||!n.toLowerCase().includes(q))continue;seen.add(n.toLowerCase());hits.push({n,p:r.project});if(hits.length>=7)break;}
      acSel=0;ac.innerHTML=hits.map((h,k)=>`<div data-rac="${esc(h.n)}" class="${k===0?"sel":""}">${esc(h.n)}<small>${esc(h.p||t("noProject"))}</small></div>`).join("");ac.hidden=!hits.length;}else ac.hidden=true;}
    return;}
  if(s.id==="ned"){noteText[curNote]=s.value;clearTimeout(saveT);saveT=setTimeout(()=>{noteVer[curNote]++;const sv=document.getElementById("nsaved");if(sv)sv.textContent=tf("saved",{n:noteVer[curNote]});},700);
    const pre=s.value.slice(0,s.selectionStart),m=/\[\[([^\]\n]*)$/.exec(pre),ac=document.getElementById("ac");
    if(m){const q=m[1].toLowerCase(),hits=FILES.filter(F=>F.n.toLowerCase().includes(q)).slice(0,6);acSel=0;
      ac.innerHTML=hits.map((F,k)=>`<div data-ac="${esc(baseName(F.n))}" class="${k===0?"sel":""}">${esc(nm(baseName(F.n),"f"))}<small>${esc(nm(F.p,"p"))}</small></div>`).join("");ac.hidden=!hits.length;}else ac.hidden=true;}});
ovRoot.addEventListener("mousedown",e=>{const it=e.target.closest("[data-rac]");if(!it)return;e.preventDefault();const ta=document.getElementById("red");if(!ta)return;
  const pos=ta.selectionStart,pre=ta.value.slice(0,pos).replace(/\[\[[^\]\n]*$/,"[["+it.dataset.rac+"]]"),rest=ta.value.slice(pos).replace(/^\]\]/,"");
  ta.value=pre+rest;ta.selectionStart=ta.selectionEnd=pre.length;document.getElementById("rac").hidden=true;ta.focus();ta.dispatchEvent(new Event("input",{bubbles:true}));});
ovRoot.addEventListener("keydown",e=>{if(e.target.id!=="red")return;const ac=document.getElementById("rac");
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="s"){e.preventDefault();edSave(false);return;}
  if(!ac||ac.hidden)return;const it=[...ac.children];
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();acSel=(acSel+(e.key==="ArrowDown"?1:-1)+it.length)%it.length;it.forEach((d,k)=>d.classList.toggle("sel",k===acSel));}
  else if(e.key==="Enter"||e.key==="Tab"){e.preventDefault();it[acSel].dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));}else if(e.key==="Escape"){ac.hidden=true;}});
ovRoot.addEventListener("focusout",e=>{if(e.target.id==="red")edFlush();});
ovRoot.addEventListener("mousedown",e=>{const it=e.target.closest("[data-ac]");if(!it)return;e.preventDefault();const ta2=document.getElementById("ned");const pos2=ta2.selectionStart,pre=ta2.value.slice(0,pos2).replace(/\[\[[^\]\n]*$/,"[["+it.dataset.ac+"]]");
  ta2.value=pre+ta2.value.slice(pos2);noteText[curNote]=ta2.value;ta2.selectionStart=ta2.selectionEnd=pre.length;document.getElementById("ac").hidden=true;ta2.focus();});
ovRoot.addEventListener("keydown",e=>{const ac=document.getElementById("ac");if(!ac||ac.hidden||e.target.id!=="ned")return;const it=[...ac.children];
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();acSel=(acSel+(e.key==="ArrowDown"?1:-1)+it.length)%it.length;it.forEach((d,k)=>d.classList.toggle("sel",k===acSel));}
  else if(e.key==="Enter"||e.key==="Tab"){e.preventDefault();it[acSel].dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));}else if(e.key==="Escape"){ac.hidden=true;}});

/* overlays: front state, resize handle, remembered position and size are in ui/overlays.js */

/* ---------- orientation helper: mini top view, shown when close to or inside the brain ---------- */
const compass=document.createElement("div");compass.id="compass";compass.className="glass";compass.title="";document.body.appendChild(compass);
compass.addEventListener("click",resetView);
let cmpKey="";
function drawCompass(){const show=cam.r<2.6&&document.body.classList.contains("focus")===false;compass.classList.toggle("show",show);if(!show)return;
  const k=cam.th.toFixed(2)+cam.r.toFixed(2)+cam.ph.toFixed(2)+lang;if(k===cmpKey)return;cmpKey=k;
  const d=Math.min(25,cam.r*9),s=Math.sin(cam.ph),x=30+d*Math.sin(cam.th)*s,y=30-d*Math.cos(cam.th)*s,inside=cam.r<1.25;
  compass.innerHTML=`<svg viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="27" fill="none" stroke="rgba(231,234,238,.18)"/><ellipse cx="30" cy="31" rx="10" ry="15" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.55)"/><path d="M30 16v30" stroke="rgba(255,255,255,.25)"/><path d="M30 3v4" stroke="rgba(255,255,255,.5)"/>
   <line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="30" y2="31" stroke="rgba(255,255,255,.45)" stroke-dasharray="2 2"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="#fff" style="filter:drop-shadow(0 0 4px #fff)"/></svg><span>${t(inside?"cmpIn":"cmpOut")} · ${t("cmpHintR")}</span>`;}

/* ---------- extension loop: node pulses and orientation ---------- */
// runs inside the main loop (frame), before rendering
function extStep(){let busy=false;for(let i=0;i<NODES.length;i++){if(nodeGlow[i]>0){nodeGlow[i]=Math.max(0,nodeGlow[i]-.012);busy=true;}if(nodeEdit[i]>0){nodeEdit[i]=Math.max(0,nodeEdit[i]-.02);busy=true;}}
  if(busy){paintNodes();dirty=true;}if(REAL.step()){dirty=true;applyFormFade();}if(FB.brains.length){if(FB.step())dirty=true;FB.sync();}drawCompass();}

/* ---------- first launch: show the welcome flow once (not for preview deep links) ---------- */
let welcomed=false;try{welcomed=localStorage.getItem("nos-welcomed")==="1";}catch(_){}
if(!welcomed&&!location.hash)setTimeout(()=>welcome(0),600);
{const hd2=/demo=(\w+)/.exec(location.hash);if(hd2){({welcome:()=>welcome(+((/step=(\d)/.exec(location.hash)||[])[1]||0)),import:()=>importDlg({n:18412,bytes:80.4e9,name:"Obsidian Vault"}),diff:()=>diffDlg("hooks"),conflict:conflictDlg,pack:()=>{packSel.add(1);packSel.add(3);ms={kind:"pack",full:false};showModal();},index:()=>startIndex("Obsidian Vault",18412)})[hd2[1]]();}
 const ht2=/tab=(\w+)/.exec(location.hash);if(ht2){memTab=actTab=ht2[1];if(!["note","lib","tags"].includes(memTab))memTab="note";if(!["live","hist","replay"].includes(actTab))actTab="live";}
 const hn=/node=(\d+)/.exec(location.hash);if(hn){curNode=+hn[1];setTimeout(()=>openNode(curNode),50);}
 if(/near/.test(location.hash)){cam.r=goal.r=1.5;}}

/* deep link for previews: #open=activity,connectors */
const hc=/cons=(\d+)/.exec(location.hash);if(hc){for(let k=CONNECTORS.length;k<Math.min(12,+hc[1]);k++)setConnectors(1);hoverCon=-1;newNerve=-1;newIdx.value=-1;paint();cam.r=DEF.r;cam.target.y=DEF.ty;}
const hf=/files=(\d+)/.exec(location.hash);if(hf){libN=+hf[1];Object.assign(libCur,libGoal());applyLib();paint();renderStatic();}
const hm=/open=([\w,]+)/.exec(location.hash);if(hm)hm[1].split(",").forEach(m=>{if(MODT[m])openOv(m);});
})();
