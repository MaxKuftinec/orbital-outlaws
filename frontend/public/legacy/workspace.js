/* Fullscreen floating cockpit: three draggable, locally remembered HUD panels. */
(() => {
  'use strict';
  const workspace=document.getElementById('canvas-workspace');
  const fullscreen=document.getElementById('fullscreen-btn');
  if(!workspace||!fullscreen)return;
  const key='orbital-outlaws.panel-layout.v1';
  const saved=JSON.parse(localStorage.getItem(key)||'{}');
  const panels=['nav-command','telemetry-console','ship-panel'];
  let layer=40;

  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const bounds=panel=>({
    x:Math.max(0,workspace.clientWidth-panel.offsetWidth),
    y:Math.max(0,workspace.clientHeight-panel.offsetHeight)
  });
  function position(panel,x,y,save=false){
    const limit=bounds(panel);
    x=clamp(x,0,limit.x);y=clamp(y,0,limit.y);
    panel.style.left=x+'px';panel.style.top=y+'px';
    panel.style.right='auto';panel.style.bottom='auto';
    if(save){
      saved[panel.id]={x:limit.x?x/limit.x:0,y:limit.y?y/limit.y:0};
      localStorage.setItem(key,JSON.stringify(saved));
    }
  }
  function restore(){
    for(const id of panels){
      const panel=document.getElementById(id),p=saved[id];
      if(!panel||!p)continue;
      const size=bounds(panel);
      position(panel,p.x*size.x,p.y*size.y);
    }
  }
  for(const id of panels){
    const panel=document.getElementById(id);
    const handle=panel?.querySelector('[data-drag-handle]');
    if(!handle)continue;
    let drag=null;
    handle.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      e.preventDefault();e.stopPropagation();
      const wrap=workspace.getBoundingClientRect();
      const rect=panel.getBoundingClientRect();
      drag={id:e.pointerId,x:e.clientX,y:e.clientY,
        left:rect.left-wrap.left,top:rect.top-wrap.top};
      panel.style.zIndex=String(++layer);
      panel.classList.add('dragging-panel');
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener('pointermove',e=>{
      if(!drag||drag.id!==e.pointerId)return;
      position(panel,drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);
    });
    function stop(e){
      if(!drag||drag.id!==e.pointerId)return;
      const wrap=workspace.getBoundingClientRect(),rect=panel.getBoundingClientRect();
      position(panel,rect.left-wrap.left,rect.top-wrap.top,true);
      drag=null;panel.classList.remove('dragging-panel');
      if(handle.hasPointerCapture?.(e.pointerId))handle.releasePointerCapture(e.pointerId);
    }
    handle.addEventListener('pointerup',stop);
    handle.addEventListener('pointercancel',stop);
    handle.addEventListener('lostpointercapture',stop);
    handle.addEventListener('keydown',e=>{
      const movement={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
      if(!movement)return;
      e.preventDefault();
      const wrap=workspace.getBoundingClientRect(),rect=panel.getBoundingClientRect();
      const step=e.shiftKey?4:16;
      position(panel,rect.left-wrap.left+movement[0]*step,rect.top-wrap.top+movement[1]*step,true);
    });
  }

  function updateFullscreen(){
    const active=document.fullscreenElement===workspace;
    fullscreen.textContent=active?'⤡ Exit fullscreen':'⛶ Fullscreen';
    fullscreen.setAttribute('aria-label',active?'Exit fullscreen cockpit':'Enter fullscreen cockpit');
    requestAnimationFrame(()=>{
      restore();
      window.dispatchEvent(new Event('resize'));
    });
  }
  fullscreen.addEventListener('click',()=>{
    if(document.fullscreenElement===workspace)document.exitFullscreen();
    else workspace.requestFullscreen();
  });
  document.addEventListener('fullscreenchange',updateFullscreen);
  window.addEventListener('resize',restore);
  restore();
})();
