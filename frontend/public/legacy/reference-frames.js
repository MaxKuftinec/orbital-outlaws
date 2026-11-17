/* Planet-relative persistence, translated into the selected inertial frame.
 * Do not confuse a star-centered camera with star-centered measurements.
 * Historical positions must use the planet ephemeris at their SAMPLE time.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OrbitalReferenceFrames=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function inertialState(body,time,starFrame,planetAt){
    const planet=starFrame?planetAt(time):{x:0,y:0,vx:0,vy:0};
    return {x:body.x+planet.x,y:body.y+planet.y,
      vx:body.vx+planet.vx,vy:body.vy+planet.vy};
  }
  function mapSample(point,now,starFrame,planetAt){
    if(!starFrame)return point;
    if(!Number.isFinite(point.t))return null; // legacy samples have unknown frame epoch
    const then=planetAt(point.t),current=planetAt(now);
    return {x:point.x+then.x-current.x,y:point.y+then.y-current.y};
  }
  function osculating(body,mu,radius){
    const r=Math.hypot(body.x,body.y),safeR=Math.max(r,1e-9);
    const v2=body.vx**2+body.vy**2;
    const h=body.x*body.vy-body.y*body.vx;
    const specificEnergy=v2/2-mu/safeR;
    const e=Math.sqrt(Math.max(0,1+2*specificEnergy*h*h/(mu*mu)));
    const rp=h*h/(mu*(1+e));
    const ra=e<1-1e-10?h*h/(mu*(1-e)):Infinity;
    const a=specificEnergy<0?-mu/(2*specificEnergy):Infinity;
    const period=Number.isFinite(a)?2*Math.PI*Math.sqrt(a**3/mu):Infinity;
    return {r,v:Math.sqrt(v2),e,rp,ra,period,altitude:r-radius};
  }
  function telemetry(body,time,starFrame,system,planetRadius){
    const inertial=inertialState(body,time,starFrame,system.planet);
    const mu=starFrame?system.STAR_MU:system.PLANET_MU;
    const radius=starFrame?system.STAR_RADIUS_KM:planetRadius;
    return {frame:starFrame?'Veyra':'Kestrel',
      model:'Instantaneous two-body estimate; other-body gravity still acts',
      ...osculating(inertial,mu,radius),inertial};
  }
  return {inertialState,mapSample,osculating,telemetry};
});
