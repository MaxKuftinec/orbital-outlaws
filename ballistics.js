/**
 * Orbital Outlaws ballistic projection, v0.4.
 * Uses the same kick-drift-kick (velocity Verlet) gravity model as live projectiles.
 * All world positions are km, velocities km/s, times s. No prediction of future burns.
 */
(function(root, factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  if(root)root.OrbitalBallistics=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const norm=(x,y)=>Math.hypot(x,y);
  function gravity(x,y,mu){
    const r2=Math.max(x*x+y*y,10),a=-mu/(r2*Math.sqrt(r2));
    return {x:a*x,y:a*y};
  }
  function advance(body,dt,mu){
    const a=gravity(body.x,body.y,mu),halfX=body.vx+.5*dt*a.x,halfY=body.vy+.5*dt*a.y;
    body.x+=halfX*dt;body.y+=halfY*dt;
    const b=gravity(body.x,body.y,mu);
    body.vx=halfX+.5*dt*b.x;body.vy=halfY+.5*dt*b.y;
    return body;
  }
  function projectileAt(shooter,dir,speed=205,muzzleOffset=12){
    const n=norm(dir.x,dir.y)||1,dx=dir.x/n,dy=dir.y/n;
    return {x:shooter.x+dx*muzzleOffset,y:shooter.y+dy*muzzleOffset,
      vx:shooter.vx+dx*speed,vy:shooter.vy+dy*speed};
  }
  /**
   * Preview the actual curved ballistic path out to the cursor's projected range.
   * Cursor controls the sampled arrival time; in locked mode fire direction is provided
   * by the existing automatic gun aim rather than assumed to follow the cursor.
   */
  function forecast(shooter,dir,cursor,target,opts={}){
    // Prediction horizon limits the UI computation only; actual projectiles never expire.
    const mu=opts.mu??310000, dt=opts.dt??.015,horizonSec=opts.horizonSec??12;
    const crashRadius=opts.crashRadius??91;
    const speed=opts.speed??205, muzzleOffset=opts.muzzleOffset??12;
    const shot=projectileAt(shooter,dir,speed,muzzleOffset),n=norm(dir.x,dir.y)||1;
    const ux=dir.x/n,uy=dir.y/n;
    const cursorRange=Math.max(muzzleOffset,(cursor.x-shooter.x)*ux+(cursor.y-shooter.y)*uy);
    const path=[{x:shot.x,y:shot.y,t:0}];
    const predictedTarget=target?{x:target.x,y:target.y,vx:target.vx,vy:target.vy}:null;
    const targetPath=predictedTarget?[{x:target.x,y:target.y,t:0}]:[];
    let t=0, reached=cursorRange<=muzzleOffset, endedBy='';
    const steps=Math.ceil(horizonSec/dt);
    for(let i=0;i<steps&&!reached;i++){
      const timeStep=Math.min(dt,horizonSec-t);
      if(timeStep<=0)break;
      const before={...shot},beforeTarget=predictedTarget?{...predictedTarget}:null;
      advance(shot,timeStep,mu);
      if(predictedTarget)advance(predictedTarget,timeStep,mu);
      const prevAlong=(before.x-shooter.x)*ux+(before.y-shooter.y)*uy;
      const newAlong=(shot.x-shooter.x)*ux+(shot.y-shooter.y)*uy;
      let fraction=1;
      if(newAlong>=cursorRange && newAlong>prevAlong){fraction=Math.max(0,Math.min(1,(cursorRange-prevAlong)/(newAlong-prevAlong)));reached=true;}
      if(fraction!==1){
        for(const key of ['x','y','vx','vy'])shot[key]=before[key]+fraction*(shot[key]-before[key]);
        if(predictedTarget)for(const key of ['x','y','vx','vy'])predictedTarget[key]=beforeTarget[key]+fraction*(predictedTarget[key]-beforeTarget[key]);
      }
      t+=timeStep*fraction;
      path.push({x:shot.x,y:shot.y,t});
      if(predictedTarget)targetPath.push({x:predictedTarget.x,y:predictedTarget.y,t});
      const radius=norm(shot.x,shot.y);
      if(radius<crashRadius){endedBy='planet';reached=false;break;}
    }
    if(!reached && !endedBy)endedBy='preview-limit';
    const targetAtCursor=(reached&&predictedTarget)?{...predictedTarget}:null;
    const bulletAtCursor=reached?{...shot}:null;
    return {path,targetPath,targetAtCursor,bulletAtCursor,arrivalTime:reached?t:null,
      missKm:targetAtCursor?norm(shot.x-predictedTarget.x,shot.y-predictedTarget.y):null,
      status:reached?'reachable':endedBy, cursorRange, muzzleOffset};
  }
  return {gravity,advance,projectileAt,forecast};
});
