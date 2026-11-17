/* Frame-invariant map measurement geometry (kilometres), shared by tools. */
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
  // Inertial map +X points east, -Y points north (canvas is Y-down).
  function bearing(a,b){
    if(!a||!b||!(distance(a,b)>0))return null;
    return (Math.atan2(b.x-a.x,a.y-b.y)*180/Math.PI+360)%360;
  }
  function bearingLabel(angle){
    return angle===null?'Choose two different points':angle.toFixed(1)+'° · inertial N';
  }
  // Endpoints are stored in Veyra-centered *inertial* coordinates, never
  // Kestrel-relative camera coordinates. Object anchors resolve every frame.
  function anchorAt(anchor,planet,objects={}){
    if(!anchor)return null;
    if(anchor.object==='veyra')return {x:0,y:0};
    if(anchor.object==='kestrel')return {x:planet.x,y:planet.y};
    if(anchor.object){
      const body=objects[anchor.object];
      return body?{x:body.x+planet.x,y:body.y+planet.y}:null;
    }
    return {x:anchor.x,y:anchor.y};
  }
  // Liang–Barsky clipping: never ask Canvas to rasterize a line that extends
  // millions of pixels off-screen at planetary zoom.
  function clipSegment(a,b,width,height,pad=4){
    if(!a||!b||!Number.isFinite(a.x+a.y+b.x+b.y))return null;
    const x0=a.x,y0=a.y,dx=b.x-a.x,dy=b.y-a.y;
    const p=[-dx,dx,-dy,dy],q=[x0+pad,width+pad-x0,y0+pad,height+pad-y0];
    let t0=0,t1=1;
    for(let i=0;i<4;i++){
      if(Math.abs(p[i])<1e-15){if(q[i]<0)return null;continue;}
      const r=q[i]/p[i];
      if(p[i]<0)t0=Math.max(t0,r);
      else t1=Math.min(t1,r);
      if(t0>t1)return null;
    }
    return [{x:x0+dx*t0,y:y0+dy*t0},{x:x0+dx*t1,y:y0+dy*t1}];
  }
  return {niceScale,distance,distanceLabel,bearing,bearingLabel,anchorAt,clipSegment};
});
