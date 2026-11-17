/* Shared, braking-aware RCS guidance for local physics and server input. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OrbitalAttitude=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MAX_RATE=.55; // rad/s; do not spin at the old 1.9 rad/s.
  const wrap=rad=>Math.atan2(Math.sin(rad),Math.cos(rad));
  function steer(heading,omega,direction,alpha,dt=.15){
    if(!direction||!Number.isFinite(alpha)||alpha<=0)
      return {turn:0,stabilize:true,gimbal:0,aligned:false};
    const angle=wrap(Math.atan2(direction.y,direction.x)-heading);
    const limit=Math.min(MAX_RATE,.78*Math.sqrt(2*alpha*Math.max(0,Math.abs(angle)-.018)));
    const wantedRate=Math.sign(angle)*limit;
    const error=wantedRate-omega;
    const onTarget=Math.abs(angle)<.085&&Math.abs(omega)<.12;
    const braking=Math.abs(angle)<.022 || (Math.abs(wantedRate)<.08 && Math.abs(omega)>.08);
    if(braking)return {turn:0,stabilize:true,gimbal:Math.max(-.48869219,Math.min(.48869219,angle)),aligned:onTarget};
    const turn=Math.abs(error)<alpha*Math.max(.025,dt)*.36?0:Math.sign(error);
    return {turn,stabilize:false,
      gimbal:Math.max(-.48869219,Math.min(.48869219,angle)),aligned:onTarget};
  }
  return {steer,wrap,MAX_RATE};
});
