/** Orbital Outlaws v0.5: deterministic Newtonian transfer planner.
 * Two-impulse, fixed-time shooting with a discrete search of coast / flight windows.
 * It minimizes a sampled delta-v objective; it is not a globally optimal low-thrust solver.
 */
(function(root, factory) {
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) root.OrbitalNavigation=api;
})(typeof globalThis!=='undefined'?globalThis:this, function(){
  'use strict';
  const length=(x,y)=>Math.hypot(x,y);
  function propagate(s,T,mu,stepSize=.18,inner=91,outer=1600,trace=false){
    let x=s.x,y=s.y,vx=s.vx,vy=s.vy,minR=Infinity,maxR=0;
    const steps=Math.max(1,Math.ceil(Math.max(0,T)/stepSize)),h=T/steps;
    const points=trace?[{x,y}]:null;
    for(let i=0;i<steps;i++){
      const r2=Math.max(x*x+y*y,1),f=-mu/(r2*Math.sqrt(r2));
      const hvx=vx+.5*h*x*f,hvy=vy+.5*h*y*f;
      x+=hvx*h;y+=hvy*h;
      const rn=Math.hypot(x,y);minR=Math.min(minR,rn);maxR=Math.max(maxR,rn);
      if(rn<=inner || rn>=outer)return {x,y,vx:hvx,vy:hvy,safe:false,minR,maxR,points};
      const rr=Math.max(x*x+y*y,1),g=-mu/(rr*Math.sqrt(rr));
      vx=hvx+.5*h*x*g;vy=hvy+.5*h*y*g;
      if(points&&i%4===0)points.push({x,y});
    }
    if(points)points.push({x,y});
    return {x,y,vx,vy,safe:true,minR,maxR,points};
  }
  function targetAt(target,t,mu,inner,outer){
    if(target.fixed){
      const r=Math.hypot(target.x,target.y);
      const direction=target.orbitSign||1;
      const v=Math.sqrt(mu/Math.max(1,r));
      return {x:target.x,y:target.y,vx:-target.y/r*v*direction,vy:target.x/r*v*direction,safe:r>inner&&r<outer};
    }
    return propagate(target,t,mu,.16,inner,outer);
  }
  function shoot(start,destination,T,mu,inner,outer){
    const coast=propagate(start,T,mu,.22,inner,outer);
    if(!coast.safe) return null;
    let vx=start.vx+(destination.x-coast.x)/Math.max(T,1);
    let vy=start.vy+(destination.y-coast.y)/Math.max(T,1);
    for(let iteration=0;iteration<9;iteration++){
      const p=propagate({...start,vx,vy},T,mu,.22,inner,outer);
      if(!p.safe)return null;
      const dx=destination.x-p.x,dy=destination.y-p.y;
      if(length(dx,dy)<.16){
        const dv1={x:vx-start.vx,y:vy-start.vy};
        const dv2={x:destination.vx-p.vx,y:destination.vy-p.vy};
        const dv=length(dv1.x,dv1.y)+length(dv2.x,dv2.y);
        const detailed=propagate({...start,vx,vy},T,mu,.16,inner,outer,true);
        if(!detailed.safe)return null;
        return {dv,dv1,dv2,flight:T,path:detailed.points,miss:length(destination.x-detailed.x,destination.y-detailed.y)};
      }
      const eps=.06;
      const px=propagate({...start,vx:vx+eps,vy},T,mu,.22,inner,outer);
      const py=propagate({...start,vx,vy:vy+eps},T,mu,.22,inner,outer);
      if(!px.safe||!py.safe)return null;
      const a=(px.x-p.x)/eps,b=(py.x-p.x)/eps,c=(px.y-p.y)/eps,d=(py.y-p.y)/eps;
      const determinant=a*d-b*c;
      if(Math.abs(determinant)<1e-5)return null;
      let deltaX=(d*dx-b*dy)/determinant,deltaY=(-c*dx+a*dy)/determinant;
      const mag=length(deltaX,deltaY);
      if(mag>20){deltaX*=20/mag;deltaY*=20/mag;}
      vx+=deltaX;vy+=deltaY;
    }
    return null;
  }
  function plan(start,target,options={}){
    const mu=options.mu??310000,inner=options.inner??97,outer=options.outer??1200;
    // Extended planning expands the departure/arrival windows for highly elliptical
    // targets. The transfer remains a sampled two-impulse search: it does not
    // invent free plane changes or guarantee a global optimum.
    function orbitPeriod(body){
      const r=Math.hypot(body.x,body.y),v2=body.vx*body.vx+body.vy*body.vy;
      const energy=v2/2-mu/r;
      if(energy>=0)return null;
      const a=-mu/(2*energy);
      return 2*Math.PI*Math.sqrt(a*a*a/mu);
    }
    const initialWaits=[0,5,12,22,36];
    const initialFlights=[7,10,15,21,29,39,52,70,92];
    const periodA=orbitPeriod(start);
    const periodB=target.fixed?null:orbitPeriod(target);
    const bounded=(t)=>Math.round(t*10)/10;
    const toCandidates=(base,extra,lo,hi)=>[...new Set([...base,...extra].filter(t=>Number.isFinite(t)&&t>=lo&&t<=hi).map(bounded))].sort((a,b)=>a-b);
    const waits=options.waits??(options.extended?toCandidates(initialWaits,[periodA/4,periodA/2,periodB/4,periodB/2,57,75],0,95):initialWaits);
    const flights=options.flights??(options.extended?toCandidates(initialFlights,[periodA,periodA*1.5,periodA*2,periodB,periodB*1.5,110,135,165,205,250],4,280):initialFlights);
    const exhaust=options.exhaustKmS??320;
    const mass=options.massKg??1100;
    const propellant=options.propellantKg??200;
    const maxDv=exhaust*Math.log(mass/Math.max(1,mass-propellant));
    let best=null;
    for(const wait of waits){
      const departure=propagate(start,wait,mu,.18,inner,outer);
      if(!departure.safe)continue;
      for(const flight of flights){
        const targetFuture=targetAt(target,wait+flight,mu,inner,outer);
        if(!targetFuture.safe)continue;
        const s=shoot(departure,targetFuture,flight,mu,inner,outer);
        if(!s || !Number.isFinite(s.dv) || s.dv>maxDv*.96)continue;
        // Slight preference for earlier arrival and a margin for finite burns/corrections.
        const rank=s.dv+.018*(wait+flight);
        if(!best||rank<best.rank){best={...s,wait,rank,eta:wait+flight,coastPath:s.path,departure:{x:departure.x,y:departure.y},arrival:{x:targetFuture.x,y:targetFuture.y},availableDv:maxDv};}
      }
    }
    return best;
  }
  return {propagate,targetAt,shoot,plan};
});
