/** Orbital Outlaws v0.5 — continuous 2-D spacecraft collision geometry.
 * Uses swept circular collision envelopes and a momentum-conserving normal impulse.
 * Envelopes are game-scaled (km), not the literal physical hull dimensions (metres).
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OrbitalCollisions=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const hypot=Math.hypot;
  function sweep(a0,a1,b0,b1,radius){
    const x=b0.x-a0.x,y=b0.y-a0.y;
    const dx=(b1.x-b0.x)-(a1.x-a0.x),dy=(b1.y-b0.y)-(a1.y-a0.y);
    const c=x*x+y*y-radius*radius;
    let u;
    if(c<=0)u=0;
    else{
      const aa=dx*dx+dy*dy;
      if(aa<1e-18)return null;
      const bb=2*(x*dx+y*dy),discriminant=bb*bb-4*aa*c;
      if(discriminant<0)return null;
      u=(-bb-Math.sqrt(discriminant))/(2*aa);
      if(u<0||u>1)return null;
    }
    const hitX=x+dx*u,hitY=y+dy*u;
    const len=hypot(hitX,hitY);
    const fallback=hypot(dx,dy)||1;
    return {timeFraction:u,nx:len>1e-9?hitX/len:dx/fallback,ny:len>1e-9?hitY/len:dy/fallback};
  }
  function resolve(a,b,hit,dt,contactRadius){
    const m1=a.massKg,m2=b.massKg;
    if(m1<=0||m2<=0||dt<=0)return null;
    const relX=b.vx-a.vx,relY=b.vy-a.vy;
    const closing=relX*hit.nx+relY*hit.ny;
    const relSpeed=hypot(relX,relY);
    const reduced=m1*m2/(m1+m2);
    const impactEnergyJ=.5*reduced*(Math.max(0,-closing)*1000)**2;
    const damage=closing>=-.15?0:Math.min(160,Math.max(0,(impactEnergyJ-500000)/18000000));
    // Compute collision point along the swept motion; then integrate remaining fraction linearly.
    const aX=a.startX+(a.x-a.startX)*hit.timeFraction;
    const aY=a.startY+(a.y-a.startY)*hit.timeFraction;
    const bX=b.startX+(b.x-b.startX)*hit.timeFraction;
    const bY=b.startY+(b.y-b.startY)*hit.timeFraction;
    if(closing<0){
      const restitution=relSpeed<.15?.08:.22;
      const impulse=-(1+restitution)*closing/(1/m1+1/m2);
      a.vx-=impulse*hit.nx/m1;a.vy-=impulse*hit.ny/m1;
      b.vx+=impulse*hit.nx/m2;b.vy+=impulse*hit.ny/m2;
    }
    const push=Math.max(0,contactRadius-hypot(bX-aX,bY-aY))+.02;
    const separatedAX=aX-hit.nx*push*m2/(m1+m2);
    const separatedAY=aY-hit.ny*push*m2/(m1+m2);
    const separatedBX=bX+hit.nx*push*m1/(m1+m2);
    const separatedBY=bY+hit.ny*push*m1/(m1+m2);
    const remaining=(1-hit.timeFraction)*dt;
    a.x=separatedAX+a.vx*remaining;a.y=separatedAY+a.vy*remaining;
    b.x=separatedBX+b.vx*remaining;b.y=separatedBY+b.vy*remaining;
    return {relativeSpeedKmS:relSpeed,impactEnergyJ,damage};
  }
  return {sweep,resolve};
});
