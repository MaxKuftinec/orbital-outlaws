/* Persistent pilot transport; never sends client positions, velocities, or fuel. */
(function(root){
  'use strict';
  const key = 'orbital-outlaws.pilot.v1';
  const base = (root.ORBITAL_API_BASE_URL || '').replace(/\/$/, '');
  function pilotId(){
    let id = localStorage.getItem(key);
    if(!id || !/^[a-f0-9]{32}$/.test(id)){
      id = crypto.randomUUID().replace(/-/g, '');
      localStorage.setItem(key,id);
    }
    return id;
  }
  function attach({controls, onState, onConnected, onError}){
    const url = base + '/api/players/' + pilotId();
    let connected = false, busy = false, pending = false, previous = '', lastSent = 0, lastPoll = 0, nextRetry = 0, lastError = '';
    async function request(path, init){
      const sentAt=performance.now();
      const response = await fetch(url + path, {cache:'no-store',...init});
      if(!response.ok) throw new Error('Flight API '+response.status+': '+await response.text());
      const result=await response.json();
      // Approximate server snapshot time between browser send/receive timestamps.
      result.clientSampleMs=(sentAt+performance.now())/2;
      return result;
    }
    async function tick(){
      if(busy){pending=true;return;}
      if(document.hidden || (!connected && performance.now()<nextRetry)) return;
      busy = true;
      try{
        if(!connected){
          onState(await request('',{method:'POST'}));
          connected = true;
          onConnected(true);
        }else{
          const command = controls();
          const fingerprint = JSON.stringify(command);
          const active = command.thrust || command.turn || command.stabilize;
          const now = performance.now();
          if(fingerprint !== previous || (active && now-lastSent>=220)){
            lastSent=now;
            onState(await request('/input',{method:'POST',headers:{'Content-Type':'application/json'},body:fingerprint}));
            previous = fingerprint;
          }else if(!active && now-lastPoll>550){
            onState(await request(''));
            lastPoll = now;
          }
        }
        lastError = '';
      }catch(error){
        nextRetry=performance.now()+2000;
        if(String(error)!==lastError){console.warn('Persistent flight unavailable:',error);lastError=String(error);if(onError)onError(lastError);}
        if(connected){connected=false;onConnected(false);}
      }finally{
        busy=false;
        if(pending){pending=false;Promise.resolve().then(tick);}
      }
    }
    const events=['keydown','keyup','pointerdown','pointerup','pointercancel','click','blur'];
    for(const name of events)root.addEventListener?.(name,tick);
    const timer=setInterval(tick,100);
    tick();
    return ()=>{
      clearInterval(timer);
      for(const name of events)root.removeEventListener?.(name,tick);
    };
  }
  root.OrbitalPersistence = {attach};
})(window);
