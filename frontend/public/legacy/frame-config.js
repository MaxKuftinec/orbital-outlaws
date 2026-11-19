/* Frame settings shared by today's Ephemeris and future frame-aware tools.
 * Canvas and tool frames are independent unless a user explicitly requests
 * "all" when changing the canvas frame.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OrbitalFrameConfig=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  const SCOPE_KEY='orbital-outlaws.frame-scope.v1';
  const EPHEMERIS_KEY='orbital-outlaws.ephemeris-frame.v1';
  const FRAME_KEY='orbital-outlaws.map-frame.v1';
  const TOOLS=Object.freeze({ephemeris:EPHEMERIS_KEY});
  const validFrame=frame=>frame==='star'||frame==='planet';
  function read(key,fallback){
    try{return root.localStorage?.getItem(key)??fallback;}catch{return fallback;}
  }
  function write(key,value){
    try{root.localStorage?.setItem(key,value);}catch{}
  }
  function announce(){
    root.dispatchEvent?.(new Event('orbital-reference-frames-updated'));
    root.dispatchEvent?.(new Event('orbital-preferences-changed'));
  }
  function getFrame(tool){
    const key=TOOLS[tool];
    if(!key)return 'planet';
    const stored=read(key,'planet');
    return validFrame(stored)?stored:'planet';
  }
  function getScope(){return read(SCOPE_KEY,'canvas')==='all'?'all':'canvas';}
  function setFrame(tool,frame){
    const key=TOOLS[tool];
    if(!key||!validFrame(frame))return false;
    if(getFrame(tool)!==frame){write(key,frame);announce();}
    return true;
  }
  function applyCanvasChange(frame){
    if(!validFrame(frame))return;
    if(getScope()==='all'){
      for(const tool of Object.keys(TOOLS))write(TOOLS[tool],frame);
    }
    announce();
  }
  function setScope(scope){
    if(scope!=='canvas'&&scope!=='all')return false;
    write(SCOPE_KEY,scope);
    // Selecting "all" deliberately aligns existing tools immediately;
    // independent tool changes are still possible until a later canvas change.
    if(scope==='all'){
      const current=read(FRAME_KEY,'planet');
      for(const tool of Object.keys(TOOLS))write(TOOLS[tool],validFrame(current)?current:'planet');
    }
    announce();
    return true;
  }
  function projectPoint(point,seconds,epoch,frame,planetAt){
    if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
    if(frame!=='star')return {x:point.x,y:point.y};
    // All gameplay positions are Kestrel-relative. The Veyra-frame trace
    // has Kestrel's future inertial displacement at every predicted epoch.
    // Keep output relative to Kestrel's current position so the existing
    // canvas camera can display it in either frame without double offsets.
    const start=planetAt(epoch),future=planetAt(epoch+seconds);
    return {x:point.x+future.x-start.x,y:point.y+future.y-start.y};
  }
  function projectTrace(points,epoch,frame,planetAt){
    return points.map(point=>projectPoint(point,point.t??0,epoch,frame,planetAt)).filter(Boolean);
  }
  return {TOOLS,SCOPE_KEY,EPHEMERIS_KEY,FRAME_KEY,getFrame,getScope,setFrame,setScope,
    applyCanvasChange,projectPoint,projectTrace};
});
