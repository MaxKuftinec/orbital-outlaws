/* Always-available map scale and measurement math (kilometres). */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OrbitalMapTools=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function niceScale(pixelsPerKm,targetPx=110){
    if(!(pixelsPerKm>0)||!Number.isFinite(pixelsPerKm))return {km:0,pixels:0,label:'—'};
    const approximate=targetPx/pixelsPerKm;
    const exponent=Math.floor(Math.log10(approximate));
    const base=Math.pow(10,exponent);
    const step=[1,2,5,10].filter(n=>n*base<=approximate).pop()||1;
    const km=step*base;
    const label=km<1?(km*1000).toLocaleString('en-US',{maximumFractionDigits:2})+' m':
      km.toLocaleString('en-US',{maximumFractionDigits:2})+' km';
    return {km,pixels:km*pixelsPerKm,label};
  }
  function distance(a,b){
    if(!a||!b)return null;
    return Math.hypot(b.x-a.x,b.y-a.y);
  }
  function distanceLabel(km){
    if(km===null||!Number.isFinite(km))return 'Choose two map points';
    if(km<1)return (km*1000).toLocaleString('en-US',{maximumFractionDigits:1})+' m';
    return km.toLocaleString('en-US',{maximumFractionDigits:km>=100?0:2})+' km';
  }
  return {niceScale,distance,distanceLabel};
});
