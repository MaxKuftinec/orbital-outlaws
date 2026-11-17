/* Planar restricted star–planet system, matched to backend/app/star_system.py.
 * All existing gameplay entities keep Kestrel-relative coordinates in fixed
 * inertial axes; only the map converts them into star-centered coordinates.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OrbitalStarSystem=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PLANET_MU=310000, STAR_MU=2000000000;
  const ORBIT_RADIUS_KM=160000,STAR_RADIUS_KM=4500,START_PHASE=.4;
  const ANGULAR_RATE=Math.sqrt(STAR_MU/Math.pow(ORBIT_RADIUS_KM,3));
  const PERIOD_S=2*Math.PI/ANGULAR_RATE;
  const HILL_RADIUS_KM=ORBIT_RADIUS_KM*Math.cbrt(PLANET_MU/(3*STAR_MU));
  function planet(t){
    const angle=START_PHASE+ANGULAR_RATE*t, speed=ANGULAR_RATE*ORBIT_RADIUS_KM;
    return {x:ORBIT_RADIUS_KM*Math.cos(angle),y:ORBIT_RADIUS_KM*Math.sin(angle),
      vx:-speed*Math.sin(angle),vy:speed*Math.cos(angle),id:'kestrel',name:'KESTREL',
      alive:true,type:'planet',radius:85};
  }
  function star(t){
    const p=planet(t);
    return {x:-p.x,y:-p.y,vx:-p.vx,vy:-p.vy,
      id:'kestrel-primary',name:'KESTREL PRIMARY',alive:true,type:'star',
      radius:STAR_RADIUS_KM};
  }
  function tidalAcceleration(x,y,t){
    const s=star(t),dx=x-s.x,dy=y-s.y;
    const r=Math.max(STAR_RADIUS_KM,Math.hypot(dx,dy));
    const common=STAR_MU/Math.pow(ORBIT_RADIUS_KM,3);
    return {x:-STAR_MU*dx/Math.pow(r,3)-common*s.x,
            y:-STAR_MU*dy/Math.pow(r,3)-common*s.y};
  }
  function acceleration(x,y,t){
    const r=Math.max(1,Math.hypot(x,y)),tide=tidalAcceleration(x,y,t);
    return {x:-PLANET_MU*x/Math.pow(r,3)+tide.x,
            y:-PLANET_MU*y/Math.pow(r,3)+tide.y};
  }
  return {planet,star,tidalAcceleration,acceleration,
    PLANET_MU,STAR_MU,ORBIT_RADIUS_KM,STAR_RADIUS_KM,ANGULAR_RATE,PERIOD_S,HILL_RADIUS_KM};
});
