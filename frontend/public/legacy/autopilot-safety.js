/** Safety budget for approximate finite-burn autopilots. No optimality guarantee. */
(function(root, factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OrbitalSafety=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const reserveKg = (capacity, ratio=.18, floor=16) => Math.min(capacity,Math.max(floor,capacity*ratio));
  const requiredFuel = (massKg,dvKmS,exhaustKmS) =>
    !Number.isFinite(dvKmS)||dvKmS<0||massKg<=0||exhaustKmS<=0?Infinity:massKg*(1-Math.exp(-dvKmS/exhaustKmS));
  function authorize({fuelKg,capacityKg,massKg,dvKmS,exhaustKmS,margin=1.65,reserve=null}) {
    const protectedKg=reserve??reserveKg(capacityKg);
    const estimatedKg=requiredFuel(massKg,dvKmS,exhaustKmS);
    const availableKg=Math.max(0,fuelKg-protectedKg);
    return {ok:Number.isFinite(estimatedKg)&&estimatedKg*margin<=availableKg,estimatedKg,availableKg,reserveKg:protectedKg,margin};
  }
  function burnAllowed(fuelKg,capacityKg,reserve=null){return fuelKg>(reserve??reserveKg(capacityKg))+.00001;}
  return {reserveKg,requiredFuel,authorize,burnAllowed};
});
