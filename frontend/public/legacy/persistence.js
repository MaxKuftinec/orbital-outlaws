/* One bidirectional WebSocket: server owns flight, NPCs, combat and economy. */
(function(root){
  'use strict';
  const tokenKey='orbital-outlaws.account.session.v1';
  const accountKey='orbital-outlaws.account.id.v1';
  function credentials(){
    const token=sessionStorage.getItem(tokenKey);
    const id=sessionStorage.getItem(accountKey);
    if(!token||!/^[A-Za-z0-9_-]{32,128}$/.test(token)||!/^[a-f0-9]{32}$/.test(id||''))return null;
    return {token,id};
  }
  function attach({controls,onState,onProgress,onEncounter,onAssistance,onBurn,onConnected,onError}){
    const origin=new URL(root.ORBITAL_API_BASE_URL||'/',location.href);
    let socket=null,connected=false,last='',lastSent=0,retry=null,closed=false;
    let activeIdentity='';
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
      // Short key/button taps must not disappear while a previous command
      // is awaiting acknowledgement. Allow a small bounded queue for actual
      // button edges; do not queue repeated held-state/gimbal updates.
      const buttonEdge=!!lastControls&&['thrust','turn','stabilize','fire','repair']
        .some(key=>lastControls[key]!==value[key]);
      const sendNormally=pending.size===0&&
        (fingerprint!==last||(active&&now-lastSent>=180));
      const sendEdge=buttonEdge&&pending.size<3;
      const sendRelease=release;
      if(sendNormally||sendEdge||sendRelease){
        const seq=nextSeq++;
        if(send('input',{...value,seq})){
          pending.add(seq);last=fingerprint;lastSent=now;lastControls=value;
        }
      }
    }
    function connect(){
      const auth=credentials();
      if(closed||!auth||activeIdentity!==auth.id+':'+auth.token)return;
      const address=(origin.protocol==='https:'?'wss:':'ws:')+'//'+origin.host+
        origin.pathname.replace(/\/$/,'')+'/players/'+auth.id+'/live';
      // The session token travels in a WebSocket subprotocol, not the URL.
      // The server validates it against the account and echoes only orbital-v1.
      const ws=new WebSocket(address,['orbital-v1','auth.'+auth.token]);
      socket=ws;
      ws.onmessage=event=>{
        if(ws!==socket)return;
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
        else if(data.type==='auto_burn')onBurn?.(data.result);
        else if(data.type==='error')onError(data.message);
      };
      ws.onerror=()=>{if(ws===socket)onError('WebSocket connection error');};
      ws.onclose=event=>{
        if(ws!==socket)return;
        socket=null;pending.clear();lastControls=null;
        if(connected){connected=false;onConnected(false);}
        if(event.code===1008){onError('Flight session rejected. Please sign in again.');return;}
        if(!closed)retry=setTimeout(connect,1500);
      };
    }
    function syncAuth(){
      const auth=credentials();
      const next=auth?auth.id+':'+auth.token:'';
      if(next===activeIdentity)return;
      activeIdentity=next;
      clearTimeout(retry);
      pending.clear();lastControls=null;
      const old=socket;socket=null;
      if(old)old.close(1000,'Account session changed');
      if(connected){connected=false;onConnected(false);}
      if(auth)connect();
    }
    const events=['keydown','keyup','pointerdown','pointerup','pointercancel','click','blur'];
    for(const name of events)root.addEventListener(name,tick);
    document.addEventListener('visibilitychange',tick);
    const interval=setInterval(tick,50);
    root.addEventListener('orbital-auth',syncAuth);
    syncAuth();
    return {
      purchase:upgrade=>send('purchase',{upgrade}),
       setReserve:kg=>send('reserve',{kg}),
       requestAssistance:(recipient,donor)=>send('request_assistance',donor?{recipient,donor}:{recipient}),
       offerFuel:(target,kg=20)=>send('offer_fuel',{target,kg}),
       startBurn:plan=>send('auto_burn_start',plan),
       abortBurn:()=>send('auto_burn_abort'),
      close:()=>{
        closed=true;clearInterval(interval);clearTimeout(retry);
        root.removeEventListener('orbital-auth',syncAuth);
        for(const name of events)root.removeEventListener(name,tick);
        document.removeEventListener('visibilitychange',tick);
        socket?.close();
      }
    };
  }
  root.OrbitalPersistence={attach};
})(window);
