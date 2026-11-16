/** Hyperbolic arrivals from outside the playable sector (not random circular spawning inside it). */
(function(root, factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OrbitalArrival=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function inboundState(angle, radius=1450, radialSpeed=-26, tangentialSpeed=11, direction=1){
    const ux=Math.cos(angle),uy=Math.sin(angle),t=direction*tangentialSpeed;
    return {x:radius*ux,y:radius*uy,vx:radialSpeed*ux-t*uy,vy:radialSpeed*uy+t*ux};
  }
  return {inboundState};
});
