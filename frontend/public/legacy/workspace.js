/* Dockable orbital cockpit HUD. Each panel can float, collapse or live in the sidebar. */
(() => {
  'use strict';
  const workspace=document.getElementById('canvas-workspace');
  const sidebar=document.querySelector('.sidebar');
  const fullscreen=document.getElementById('fullscreen-btn');
  if(!workspace||!sidebar||!fullscreen)return;

  const storageKey='orbital-outlaws.hud-layout.v2';
  let initial={};
  try{initial=JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{}
  const layout=initial&&typeof initial==='object'&&!Array.isArray(initial)?initial:{};
  const save=()=>{
    localStorage.setItem(storageKey,JSON.stringify(layout));
    window.dispatchEvent(new Event('orbital-preferences-changed'));
  };
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
        const x=panel.id==='nav-command'?limits(panel).x-14:
          panel.id==='telemetry-console'||panel.id==='ship-panel'?14:20+index*20;
        const y=panel.id==='nav-command'?96:panel.id==='telemetry-console'?14:
          panel.id==='ship-panel'?limits(panel).y-14:65+index*28;
        moveTo(panel,x,y,true);
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
  function setCollapsed(panel,collapsed,persist=true){
    panel.classList.toggle('hud-minimized',collapsed);
    if(panel.id==='nav-command'||panel.id==='telemetry-console')
      panel.classList.toggle('collapsed',collapsed);
    const title=panel.querySelector('[data-panel-collapse]');
    title?.setAttribute('aria-expanded',String(!collapsed));
    if(panel.id==='telemetry-console'){
      const arrow=document.getElementById('telemetry-toggle-arrow');
      if(arrow)arrow.textContent=collapsed?'▾':'▴';
    }
    layout[panel.id]={...layout[panel.id],collapsed};
    if(persist)save();
    restorePosition(panel);
  }
  function refreshButtons(panel){
    const inside=panel.classList.contains('hud-in-canvas');
    const dockButton=panel.querySelector('[data-panel-dock]');
    dockButton.textContent=inside?'↗':'↙';
    dockButton.title=inside?'Move panel to sidebar':'Move panel into canvas';
  }
  for(const definition of panels){
    const panel=document.getElementById(definition.id);
    if(!panel)continue;
    let header=panel.querySelector('.panel-heading,.nav-command-head');
    if(!header){
      header=document.createElement('div');
      header.className='hud-heading';
      panel.insertBefore(header,panel.firstChild);
      if(panel.id==='telemetry-console'){
        const existingToggle=panel.querySelector('#telemetry-toggle');
        if(existingToggle)header.append(existingToggle);
      }
    }
    panel.classList.add('hud-panel');
    panel.dataset.panelTitle=definition.title;
    let handle=panel.querySelector('[data-drag-handle]');
    if(!handle){
      handle=document.createElement('button');
      handle.type='button';handle.textContent='⠿';
      handle.className='panel-drag-handle';handle.dataset.dragHandle='';
      handle.title='Drag floating panel';
    }
    header.prepend(handle);
    let title=header.querySelector('#nav-toggle,#telemetry-toggle');
    if(!title){
      const label=header.querySelector('span');
      title=document.createElement('button');
      title.type='button';title.className='hud-collapse-title';
      title.textContent=label?.textContent?.trim()||definition.title;
      if(label)label.replaceWith(title);
      else header.append(title);
      title.addEventListener('click',()=>setCollapsed(panel,!panel.classList.contains('hud-minimized')));
    }
    title.dataset.panelCollapse='';
    const dockButton=document.createElement('button');
    dockButton.type='button';dockButton.className='hud-tool';
    dockButton.dataset.panelDock='';
    dockButton.setAttribute('aria-label','Move panel between canvas and sidebar');
    dockButton.addEventListener('click',()=>dock(panel,!panel.classList.contains('hud-in-canvas')));
    header.append(dockButton);
    // Existing Navigation/Telemetry title buttons keep their original click handlers.
    dock(panel,layout[panel.id]?.inside??definition.inside,false);
    setCollapsed(panel,layout[panel.id]?.collapsed??panel.classList.contains('collapsed'),false);
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
  const toolbar=document.createElement('div');
  toolbar.className='hud-toolbar';
  const picker=document.createElement('button');
  picker.type='button';picker.className='hud-picker';picker.textContent='☷ Panels';
  const menu=document.createElement('div');
  menu.className='hud-picker-menu';menu.hidden=true;
  // Tools is deliberately LEFT of Panels; measurement is not a floating
  // persistent box. Move the existing controls, preserving their IDs so the
  // gameplay controller can attach click handlers after workspace.js loads.
  const toolsButton=document.createElement('button');
  toolsButton.type='button';toolsButton.id='map-tools-btn';
  toolsButton.className='hud-picker map-tools-trigger';
  toolsButton.textContent='⌖ Tools';toolsButton.setAttribute('aria-expanded','false');
  toolsButton.setAttribute('aria-controls','map-tools-menu');
  toolsButton.title='Inertial ruler, object-snapping anchors and compass';
  const toolsMenu=document.createElement('div');
  toolsMenu.id='map-tools-menu';toolsMenu.className='map-tools-popover';
  toolsMenu.hidden=true;
  const measure=document.getElementById('map-measure-tools');
  if(measure)toolsMenu.append(measure);
  workspace.append(toolbar);
  toolbar.append(toolsButton,picker,fullscreen,toolsMenu,menu);
  function setToolsOpen(open){
    toolsMenu.hidden=!open;
    toolsButton.setAttribute('aria-expanded',String(open));
  }
  toolsButton.addEventListener('click',()=>{
    setToolsOpen(toolsMenu.hidden);menu.hidden=true;
  });
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
        dock(panel,definition.inside);
        setCollapsed(panel,definition.id==='telemetry-console');
      });
      renderMenu();
    });
    menu.append(reset);
  }
  picker.addEventListener('click',()=>{
    menu.hidden=!menu.hidden;setToolsOpen(false);
    if(!menu.hidden)renderMenu();
  });
  document.addEventListener('pointerdown',event=>{
    if(!menu.contains(event.target)&&event.target!==picker)menu.hidden=true;
    if(!toolsMenu.contains(event.target)&&event.target!==toolsButton)setToolsOpen(false);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')setToolsOpen(false);
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
  function applyStoredLayout(){
    let incoming={};
    try{incoming=JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{}
    if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))incoming={};
    for(const key of Object.keys(layout))delete layout[key];
    Object.assign(layout,incoming);
    for(const definition of panels){
      const panel=document.getElementById(definition.id);
      if(!panel)continue;
      dock(panel,layout[panel.id]?.inside??definition.inside,false);
      setCollapsed(panel,layout[panel.id]?.collapsed??definition.id==='telemetry-console',false);
    }
    if(!menu.hidden)renderMenu();
  }
  window.addEventListener('orbital-preferences-applied',applyStoredLayout);
  rootlessExpose();
  function rootlessExpose(){
    window.OrbitalHUD={
      togglePanelById:id=>{
        const panel=document.getElementById(id);
        if(panel)setCollapsed(panel,!panel.classList.contains('hud-minimized'));
      },
      resetLayout:()=>{localStorage.removeItem(storageKey);applyStoredLayout();save();}
    };
  }
})();
