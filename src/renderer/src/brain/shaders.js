// GLSL shaders for the brain, nerves and knowledge nodes (from prototype v12).

export const POINTS_VS=`attribute vec3 aColor;attribute float aSize;attribute float aU;uniform float uPR;uniform float uK;uniform float uDen;varying vec3 vC;varying float vA;
 void main(){vec4 mv=modelViewMatrix*vec4(position,1.);float d=-mv.z;float vis=1.-smoothstep(uDen-.04,uDen,aU);gl_PointSize=vis<.001?0.:min(aSize*uPR*uK*(5.5/max(d,.05)),42.);vA=smoothstep(.05,.45,d)*vis;vC=aColor;gl_Position=projectionMatrix*mv;}`;

export const POINTS_FS=`uniform float uFade;varying vec3 vC;varying float vA;void main(){float r=length(gl_PointCoord-.5);if(r>.5||vA<.001)discard;float a=smoothstep(.5,.0,r)*uFade;gl_FragColor=vec4(vC*a,a*vA);}`;

export const NODES_VS=`attribute vec3 aColor;attribute float aSize;attribute float aShape;uniform float uPR;uniform float uK;varying vec3 vC;varying float vS;
 void main(){vec4 mv=modelViewMatrix*vec4(position,1.);float d=-mv.z;gl_PointSize=min(aSize*uPR*uK*(5.5/max(d,.05)),64.);vC=aColor;vS=aShape;gl_Position=projectionMatrix*mv;}`;

export const NODES_FS=`varying vec3 vC;varying float vS;void main(){vec2 p=gl_PointCoord-.5;float a;
 if(vS<.5){a=smoothstep(.5,.18,length(p));}
 else if(vS<1.5){a=smoothstep(.07,0.,abs(length(p)-.34))+smoothstep(.12,.0,length(p))*.6;}
 else if(vS<2.5){float q=abs(p.x)+abs(p.y);a=smoothstep(.06,0.,abs(q-.4))+step(q,.14);}
 else if(vS<3.5){float q=max(abs(p.x),abs(p.y));a=smoothstep(.06,0.,abs(q-.32))+step(q,.1);}
 else{a=exp(-dot(p,p)*22.)*.9;}
 if(a<.02)discard;gl_FragColor=vec4(vC*a,a);}`;

export const NERVE_VS=`attribute vec3 aColor;attribute float aSize;attribute float aD;attribute float aN;uniform float uPR;uniform float uK;uniform float uAll;uniform float uNew;uniform float uNewIdx;varying vec3 vC;varying float vA;varying float vT;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);float d=-mv.z;float g=abs(aN-uNewIdx)<.5?uNew:uAll;float vis=1.-smoothstep(g-.06,g,aD);vT=vis*smoothstep(g-.5,g-.02,aD)*step(aD,999.);
gl_PointSize=vis<.001?0.:min(aSize*(1.+vT*1.5)*uPR*uK*(5.5/max(d,.05)),42.);vA=smoothstep(.05,.45,d)*vis;vC=aColor;gl_Position=projectionMatrix*mv;}`;

export const NERVE_FS=`varying vec3 vC;varying float vA;varying float vT;void main(){float r=length(gl_PointCoord-.5);if(r>.5||vA<.001)discard;float a=smoothstep(.5,.0,r);gl_FragColor=vec4(mix(vC,vec3(1.),vT*.85)*a,a*vA);}`;

export const NERVEL_VS=`attribute float aD;attribute float aN;uniform float uAll;uniform float uNew;uniform float uNewIdx;varying vec3 vC;varying float vV;varying float vT;
void main(){float g=abs(aN-uNewIdx)<.5?uNew:uAll;vV=1.-smoothstep(g-.06,g,aD);vT=vV*smoothstep(g-.5,g-.02,aD);vC=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

export const NERVEL_FS=`varying vec3 vC;varying float vV;varying float vT;void main(){if(vV<.01)discard;gl_FragColor=vec4(mix(vC,vec3(.95),vT*.75),vV);}`;
