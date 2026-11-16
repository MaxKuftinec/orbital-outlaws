/* One bidirectional WebSocket: server owns flight, NPCs, combat and economy. */
(function(root){
  'use strict';
  const key='orbital-outlaws.pilot.v1';
  function pilotId(){
    let id=localStorage.getItem(key);
    if(!id||!/^[a-f0-9]{32}$/.test(id)){
      id=crypto.randomUUID().replace(/-/g,'');
      localStorage.setItem(key,id);
    }
    return id;
  }
  function attach({controls,onState,onProgress,onEncounter,onAssistance,onConnected,onError}){
    const origin=new URL(root.ORBITAL_API_BASE_URL||'/',location.href);
    const address=(origin.protocol==='https:'?'wss:':'ws:')+'//'+origin.host+
      origin.pathname.replace(/\/$/,'')+'/players/'+pilotId()+'/live';
    let socket=null,connected=false,last='',lastSent=0,retry=null,closed=false;
    const send=(type,body={})=>{
      if(!connected||socket?.readyState!==WebSocket.OPEN)return false;
      socket.send(JSON.stringify({type,...body}));
      return true;
    };
    function tick(){
      if(!connected)return;
      const value=document.hidden?
        {thrust:false,turn:0,stabilize:false,gimbal:0,fire:false,repair:false,aim_x:0,aim_y:0}:controls();
      const fingerprint=JSON.stringify(value),now=performance.now();
      const active=value.thrust||value.turn||value.stabilize||value.fire||value.repair;
      if(fingerprint!==last||(active&&now-lastSent>=180)){
        if(send('input',value)){last=fingerprint;lastSent=now;}
      }
    }
    function connect(){
      if(closed)return;
      const ws=new WebSocket(address);
      socket=ws;
      ws.onmessage=event=>{
        const data=JSON.parse(event.data);
        if(data.type==='welcome'||data.type==='snapshot'){
          onState({...data.flight,clientSampleMs:performance.now()});
          if(data.progress)onProgress(data.progress);
          if(onEncounter)onEncounter(data.encounter);
          if(data.type==='welcome'){
            connected=true;last='';onConnected(true);tick();
          }
        }else if(data.type==='progress')onProgress(data.progress);
        else if(data.type==='assistance')onAssistance?.(data.result);
        else if(data.type==='error')onError(data.message);
      };
      ws.onerror=()=>onError('WebSocket connection error');
      ws.onclose=event=>{
        if(connected){connected=false;onConnected(false);}
        if(event.code===1008){onError('Development WebSocket disabled. Enable ORBITAL_DEV_COMMANDS=1 locally.');return;}
        if(!closed)retry=setTimeout(connect,1500);
      };
    }
    const events=['keydown','keyup','pointerdown','pointerup','pointercancel','click','blur'];
    for(const name of events)root.addEventListener(name,tick);
    document.addEventListener('visibilitychange',tick);
    const interval=setInterval(tick,50);
    connect();
    return {
      purchase:upgrade=>send('purchase',{upgrade}),
       setReserve:kg=>send('reserve',{kg}),
       requestAssistance:recipient=>send('request_assistance',{recipient}),
       offerFuel:(target,kg=20)=>send('offer_fuel',{target,kg}),
      close:()=>{
        closed=true;clearInterval(interval);clearTimeout(retry);
        for(const name of events)root.removeEventListener(name,tick);
        document.removeEventListener('visibilitychange',tick);
        socket?.close();
      }
    };
  }
  root.OrbitalPersistence={attach};
})(window);
