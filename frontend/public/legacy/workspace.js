/* Dockable orbital cockpit HUD. Each panel can float, collapse or live in the sidebar. */
(() => {
  'use strict';
  const workspace=document.getElementById('canvas-workspace');
  const sidebar=document.querySelector('.sidebar');
  const fullscreen=document.getElementById('fullscreen-btn');
  if(!workspace||!sidebar||!fullscreen)return;

  const storageKey='orbital-outlaws.hud-layout.v2';
  const layout=JSON.parse(localStorage.getItem(storageKey)||'{}');
  const save=()=>localStorage.setItem(storageKey,JSON.stringify(layout));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const panels=[
    {id:'nav-command',title:'Navigation',inside:true},
    {id:'telemetry-console',title:'Quick telemetry',inside:true},
    {id:'ship-panel',title:'Your ship',inside:true},
    ...[...sidebar.querySelectorAll('.panel')].map(panel=>{
      const kind=[...panel.classList].find(c=>c.endsWith('-panel'))||
        [...panel.classList].find(c=>c!=='panel');
      panel.id ||= 'hud-'+kind;
      return {id:panel.id,title:(panel.querySelector('.panel-heading>span')?.textContent||kind).trim(),inside:false};
    })
  ];
  let layer=80,drag=null;
  function limits(panel){
    return {x:Math.max(0,workspace.clientWidth-panel.offsetWidth),
      y:Math.max(0,workspace.clientHeight-panel.offsetHeight)};
  }
  function moveTo(panel,x,y,persist=false){
    const max=limits(panel);
    x=clamp(x,0,max.x);y=clamp(y,0,max.y);
    panel.style.left=x+'px';panel.style.top=y+'px';
    panel.style.right='auto';panel.style.bottom='auto';
    if(persist){
      layout[panel.id]={...layout[panel.id],
        x:max.x?x/max.x:0,y:max.y?y/max.y:0};
      save();
    }
  }
  function restorePosition(panel){
    if(!panel.classList.contains('hud-in-canvas'))return;
    const saved=layout[panel.id];
    if(!saved||saved.x===undefined)return;
    const max=limits(panel);
    moveTo(panel,clamp(saved.x,0,1)*max.x,clamp(saved.y,0,1)*max.y);
  }
  function dock(panel,inside,persist=true){
    panel.classList.toggle('hud-in-canvas',inside);
    if(inside){
      workspace.appendChild(panel);
      // Sidebar panels acquire an initial cascade; positions are then preserved.
      if(!layout[panel.id]||layout[panel.id].x===undefined){
        const index=panels.findIndex(p=>p.id===panel.id);
        moveTo(panel,20+index*20,65+index*28,true);
      }else restorePosition(panel);
    }else{
      sidebar.appendChild(panel);
      for(const prop of ['top','left','right','bottom','zIndex'])
        panel.style[prop]='';
    }
    layout[panel.id]={...layout[panel.id],inside};
    if(persist)save();
    refreshButtons(panel);
  }
  function minimize(panel,collapsed){
    panel.classList.toggle('hud-minimized',collapsed);
    layout[panel.id]={...layout[panel.id],collapsed};
    save();
    refreshButtons(panel);
    restorePosition(panel);
  }
  function refreshButtons(panel){
    const inside=panel.classList.contains('hud-in-canvas');
    panel.querySelector('[data-panel-dock]').textContent=inside?'↗':'↙';
    panel.querySelector('[data-panel-dock]').title=inside?'Move panel to sidebar':'Move panel into canvas';
    panel.querySelector('[data-panel-minimize]').textContent=panel.classList.contains('hud-minimized')?'▢':'−';
    panel.querySelector('[data-panel-minimize]').title=panel.classList.contains('hud-minimized')?'Expand panel':'Minimize panel';
  }
  for(const definition of panels){
    const panel=document.getElementById(definition.id);
    if(!panel)continue;
    const header=panel.querySelector('.panel-heading,.nav-command-head')||
      (()=>{const row=document.createElement('div');row.className='hud-heading';
        panel.insertBefore(row,panel.firstChild);return row;})();
    panel.classList.add('hud-panel');
    panel.dataset.panelTitle=definition.title;
    let handle=header.querySelector('[data-drag-handle]');
    if(!handle){
      handle=document.createElement('button');
      handle.type='button';handle.textContent='⠿';
      handle.className='panel-drag-handle';handle.dataset.dragHandle='';
      handle.title='Drag floating panel';
      header.prepend(handle);
    }else if(handle.parentElement!==header)header.prepend(handle);
    for(const kind of ['minimize','dock']){
      const button=document.createElement('button');
      button.type='button';button.className='hud-tool';
      button.dataset['panel'+kind[0].toUpperCase()+kind.slice(1)]='';
      button.addEventListener('click',()=>{
        if(kind==='dock')dock(panel,!panel.classList.contains('hud-in-canvas'));
        else minimize(panel,!panel.classList.contains('hud-minimized'));
      });
      header.append(button);
    }
    // Restore persisted inside/outside choice and collapsed state.
    dock(panel,layout[panel.id]?.inside??definition.inside,false);
    if(layout[panel.id]?.collapsed)panel.classList.add('hud-minimized');
    refreshButtons(panel);

    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0||!panel.classList.contains('hud-in-canvas'))return;
      event.preventDefault();event.stopPropagation();
      const rect=panel.getBoundingClientRect(),wrap=workspace.getBoundingClientRect();
      drag={panel,handle,id:event.pointerId,
        x:event.clientX,y:event.clientY,left:rect.left-wrap.left,top:rect.top-wrap.top};
      panel.style.zIndex=String(++layer);
      panel.classList.add('dragging-panel');
      handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener('pointermove',event=>{
      if(!drag||drag.handle!==handle||drag.id!==event.pointerId)return;
      moveTo(panel,drag.left+event.clientX-drag.x,drag.top+event.clientY-drag.y);
    });
    const stop=event=>{
      if(!drag||drag.handle!==handle||drag.id!==event.pointerId)return;
      const rect=panel.getBoundingClientRect(),wrap=workspace.getBoundingClientRect();
      moveTo(panel,rect.left-wrap.left,rect.top-wrap.top,true);
      drag=null;panel.classList.remove('dragging-panel');
      if(handle.hasPointerCapture?.(event.pointerId))
        handle.releasePointerCapture(event.pointerId);
    };
    for(const name of ['pointerup','pointercancel','lostpointercapture'])
      handle.addEventListener(name,stop);
    handle.addEventListener('keydown',event=>{
      const arrow={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
      if(!arrow||!panel.classList.contains('hud-in-canvas'))return;
      event.preventDefault();
      const rect=panel.getBoundingClientRect(),wrap=workspace.getBoundingClientRect();
      const pixels=event.shiftKey?4:16;
      moveTo(panel,rect.left-wrap.left+pixels*arrow[0],
        rect.top-wrap.top+pixels*arrow[1],true);
    });
  }

  // HUD picker remains visible in fullscreen even when a panel is outside the map.
  const picker=document.createElement('button');
  picker.type='button';picker.className='hud-picker';picker.textContent='☷ Panels';
  const menu=document.createElement('div');
  menu.className='hud-picker-menu';menu.hidden=true;
  workspace.append(picker,menu);
  function renderMenu(){
    menu.replaceChildren();
    for(const definition of panels){
      const panel=document.getElementById(definition.id);
      const button=document.createElement('button');
      button.type='button';button.className='hud-picker-entry';
      button.textContent=(panel.classList.contains('hud-in-canvas')?'◉ ':'○ ')+definition.title;
      button.addEventListener('click',()=>{
        dock(panel,!panel.classList.contains('hud-in-canvas'));renderMenu();
      });
      menu.append(button);
    }
    const reset=document.createElement('button');
    reset.type='button';reset.className='hud-picker-entry';
    reset.textContent='↺ Restore default layout';
    reset.addEventListener('click',()=>{
      for(const name of Object.keys(layout))delete layout[name];
      save();
      panels.forEach(definition=>{
        const panel=document.getElementById(definition.id);
        panel.classList.remove('hud-minimized');
        dock(panel,definition.inside);
      });
      renderMenu();
    });
    menu.append(reset);
  }
  picker.addEventListener('click',()=>{menu.hidden=!menu.hidden;if(!menu.hidden)renderMenu();});
  document.addEventListener('pointerdown',event=>{
    if(!menu.contains(event.target)&&event.target!==picker)menu.hidden=true;
  });

  function refreshFullscreen(){
    const fullscreenActive=document.fullscreenElement===workspace;
    fullscreen.textContent=fullscreenActive?'⤡ Exit fullscreen':'⛶ Fullscreen';
    fullscreen.setAttribute('aria-label',fullscreenActive?'Exit fullscreen cockpit':'Enter fullscreen cockpit');
    requestAnimationFrame(()=>{
      panels.forEach(({id})=>restorePosition(document.getElementById(id)));
      window.dispatchEvent(new Event('resize'));
    });
  }
  fullscreen.addEventListener('click',()=>{
    if(document.fullscreenElement===workspace)document.exitFullscreen();
    else workspace.requestFullscreen();
  });
  document.addEventListener('fullscreenchange',refreshFullscreen);
  window.addEventListener('resize',()=>panels.forEach(({id})=>restorePosition(document.getElementById(id))));
  rootlessExpose();
  function rootlessExpose(){
    window.OrbitalHUD={resetLayout:()=>{localStorage.removeItem(storageKey);location.reload();}};
  }
})();
