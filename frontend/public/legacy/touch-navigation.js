/* Pointer navigation for mobile touchscreens. Desktop mouse and stylus are untouched. */
(function(root){
  'use strict';
  function attach(canvas,{onTap,onPan,onPinch,threshold=8}){
    const touches=new Map();
    let usedMultiTouch=false;
    function points(){return [...touches.values()];}
    function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
    function midpoint(a,b){return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
    function down(event){
      if(event.pointerType!=='touch')return;
      event.preventDefault();
      touches.set(event.pointerId,{x:event.clientX,y:event.clientY,
        startX:event.clientX,startY:event.clientY,moved:false});
      if(touches.size>=2){
        usedMultiTouch=true;
        for(const item of touches.values())item.moved=true;
      }else usedMultiTouch=false;
      canvas.setPointerCapture?.(event.pointerId);
    }
    function move(event){
      if(event.pointerType!=='touch'||!touches.has(event.pointerId))return;
      event.preventDefault();
      const current=touches.get(event.pointerId);
      const old={x:current.x,y:current.y};
      current.x=event.clientX;current.y=event.clientY;
      if(touches.size>=2){
        usedMultiTouch=true;
        const pair=points().slice(0,2);
        const previous=pair.map(p=>p===current?old:p);
        const beforeDistance=distance(previous[0],previous[1]);
        const afterDistance=distance(pair[0],pair[1]);
        const beforeMiddle=midpoint(previous[0],previous[1]);
        const afterMiddle=midpoint(pair[0],pair[1]);
        if(afterDistance>0&&beforeDistance>0){
          const rect=canvas.getBoundingClientRect();
          onPinch(afterDistance/beforeDistance,
            afterMiddle.x-rect.left,afterMiddle.y-rect.top);
        }
        onPan(afterMiddle.x-beforeMiddle.x,afterMiddle.y-beforeMiddle.y);
        for(const point of touches.values())point.moved=true;
        return;
      }
      if(!current.moved&&distance(current,{x:current.startX,y:current.startY})>threshold)
        current.moved=true;
      if(current.moved)onPan(current.x-old.x,current.y-old.y);
    }
    function finish(event,cancelled=false){
      if(event.pointerType!=='touch'||!touches.has(event.pointerId))return;
      event.preventDefault();
      const point=touches.get(event.pointerId);
      const tapped=!cancelled&&!point.moved&&!usedMultiTouch&&touches.size===1;
      touches.delete(event.pointerId);
      if(touches.size===0)usedMultiTouch=false;
      else for(const remainder of touches.values())remainder.moved=true;
      if(tapped)onTap(event);
    }
    function up(event){finish(event);}
    function cancel(event){finish(event,true);}
    function clear(){touches.clear();usedMultiTouch=false;}
    canvas.addEventListener('pointerdown',down);
    canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',up);
    canvas.addEventListener('pointercancel',cancel);
    canvas.addEventListener('lostpointercapture',cancel);
    root.addEventListener?.('blur',clear);
    return ()=> {
      canvas.removeEventListener('pointerdown',down);
      canvas.removeEventListener('pointermove',move);
      canvas.removeEventListener('pointerup',up);
      canvas.removeEventListener('pointercancel',cancel);
      canvas.removeEventListener('lostpointercapture',cancel);
      root.removeEventListener?.('blur',clear);
      clear();
    };
  }
  root.OrbitalTouchNavigation={attach};
})(window);
