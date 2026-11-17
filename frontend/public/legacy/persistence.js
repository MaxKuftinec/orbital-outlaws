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
    let nextSeq=1,lastControls=null;
    const pending=new Set(); // One normal in-flight command; at most one urgent release.

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
      // A release is urgent. Never let a long stream of old throttle inputs
      // sit ahead of a stop command in the WebSocket/server queue.
      const release=!!lastControls?.thrust&&!value.thrust;
      const sendNormally=pending.size===0&&
        (fingerprint!==last||(active&&now-lastSent>=180));
      const sendRelease=release&&pending.size<2;
      if(sendNormally||sendRelease){
        const seq=nextSeq++;
        if(send('input',{...value,seq})){
          pending.add(seq);last=fingerprint;lastSent=now;lastControls=value;
        }
      }
    }
    function connect(){
      if(closed)return;
      const ws=new WebSocket(address);
      socket=ws;
      ws.onmessage=event=>{
        const data=JSON.parse(event.data);
        if(data.type==='welcome'||data.type==='snapshot'){
          if(data.type==='snapshot'&&Number.isInteger(data.input_ack)){
            for(const seq of pending)if(seq<=data.input_ack)pending.delete(seq);
          }
          onState({...data.flight,clientSampleMs:performance.now()});
          if(data.progress)onProgress(data.progress);
          if(onEncounter)onEncounter(data.encounter);
          if(data.type==='welcome'){
            connected=true;last='';lastControls=null;pending.clear();
            onConnected(true);tick();
          }else if(Number.isInteger(data.input_ack)){
            // The server has finished this command; submit at most one
            // fresh control state, not all the stale intermediate samples.
            tick();
          }
        }else if(data.type==='progress')onProgress(data.progress);
        else if(data.type==='assistance')onAssistance?.(data.result);
        else if(data.type==='error')onError(data.message);
      };
      ws.onerror=()=>onError('WebSocket connection error');
      ws.onclose=event=>{
        pending.clear();lastControls=null;
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
       requestAssistance:(recipient,donor)=>send('request_assistance',donor?{recipient,donor}:{recipient}),
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
