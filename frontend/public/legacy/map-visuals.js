/* Visual level-of-detail for maps from planet orbit to star-system scale.
 * These are display-space sizes, not hitboxes or physical object diameters.
 * The smallest marker must remain smaller than a celestial-body marker.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OrbitalVisuals=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  function spacecraft(pixelsPerKm){
    const s=Math.max(0,pixelsPerKm||0);
    if(s<.18)return {sprite:false,scale:0,dotRadius:clamp(.9+s*5,.9,1.75),
      showLabel:false,showHealth:false,showPlayerRing:false};
    return {sprite:true,scale:clamp(s*1.15,.22,1.85),dotRadius:0,
      showLabel:s>=.58,showHealth:s>=.58,showPlayerRing:s>=.45};
  }
  function salvage(pixelsPerKm){
    const s=Math.max(0,pixelsPerKm||0);
    if(s<.18)return {marker:true,radius:clamp(.8+s*3,.8,1.4),label:false};
    return {marker:false,radius:clamp(s*.9,.2,1.25)*6+2,label:s>=.52};
  }
  function reticle(pixelsPerKm,kind='salvage',bodyRadiusPx=0){
    const s=Math.max(0,pixelsPerKm||0);
    const system=s<.18;
    const base=clamp(9+Math.sqrt(s)*8,9,22);
    const celestial=kind==='star'||kind==='planet';
    const radius=celestial?clamp(Math.max(base,bodyRadiusPx+4),9,34):base;
    return {radius,system,corner:clamp(radius*.42,4,10),
      label:!system&&!celestial, ticks:!system};
  }
  return {spacecraft,salvage,reticle};
});
