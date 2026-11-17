/**
 * ORBITAL OUTLAWS v1.0
 * Veyra–Kestrel restricted three-body system. Gameplay coordinates remain
 * Kestrel-relative; a differential stellar tide adds Veyra's gravity while
 * planetary and star frames share fixed inertial axes.
 * All spacecraft and projectiles inherit the same local gravity model.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const canvas = $('orbit-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const WORLD = Object.freeze({ mu: 310000, radius: 85, crashRadius: 91, outerRadius: 1200, projectileSpeed: 205 });
  const TWO_PI = Math.PI * 2;
  const NAV = window.OrbitalNavigation;
  const BALL = window.OrbitalBallistics;
  const COLL = window.OrbitalCollisions;
  const SAFE = window.OrbitalSafety;
  const ARRIVAL = window.OrbitalArrival;
  const ATTITUDE=window.OrbitalAttitude;
  const STAR=window.OrbitalStarSystem;
  const MAP=window.OrbitalMapTools;
  if(!NAV||!BALL||!COLL||!SAFE||!ARRIVAL||!ATTITUDE||!STAR||!MAP)throw new Error('Simulation modules missing');
  // 1 world distance unit = 1 km; velocities in km/s. Engines are futuristic.
  const ENGINE=Object.freeze({dryKg:900,propellantKg:200,thrustN:1600000,flowKgS:5,rcsN:2500,rcsFlowKgS:.04,leverM:7,shipLengthM:14,gimbalMax:28*Math.PI/180});
  const exhaustKmS=ENGINE.thrustN/ENGINE.flowKgS/1000;
  const REPAIR=Object.freeze({starterKg:10,capacityKg:24,hpPerKg:5,rateHpS:5});
  const RESERVE_KEY='orbital-outlaws.fuel-reserve-kg.v1';
  const FRAME_KEY='orbital-outlaws.map-frame.v1';
  const AXES_KEY='orbital-outlaws.show-axes.v1';
  function storedFrame(){try{return localStorage.getItem(FRAME_KEY)==='star'?'star':'planet';}catch{return 'planet';}}
  function storedAxes(){try{return localStorage.getItem(AXES_KEY)!=='false';}catch{return true;}}
  function storedReserve(){
    const saved=localStorage.getItem(RESERVE_KEY);
    const value=saved===null?SAFE.reserveKg(ENGINE.propellantKg):Number(saved);
    return Number.isFinite(value)&&value>=0&&value<=ENGINE.propellantKg?value:SAFE.reserveKg(ENGINE.propellantKg);
  }

  const palette = { cyan: '#62d9f6', green:'#67e0aa', red:'#ff7184', yellow:'#edbe6b', purple:'#bd9efa' };
  let W = 840, H = 550, dpr = 1;
  let state;
  let persistentFlight = false, flightOnline = false, pilotLink = null;
  let encounterReady = !window.OrbitalPersistence;
  let flightHistory = [], correction = null;
  let lastFrame = performance.now(), accumulator = 0, nextHud = 0;
  let lastFrameId;
  let starfield = [];

  const vec = (x,y) => ({x,y});
  const magnitude = (x,y) => Math.hypot(x,y);
  const clamp = (x,a,b) => Math.max(a, Math.min(b,x));
  const rand = (min,max) => min + Math.random()*(max-min);
  function circularPosition(r, theta, clockwise=false) {
    const s = Math.sqrt(WORLD.mu / r)*(clockwise?-1:1);
    return {x:r*Math.cos(theta), y:r*Math.sin(theta), vx:-s*Math.sin(theta), vy:s*Math.cos(theta)};
  }
  function newShip(id, name, r, theta, color, isPlayer=false) {
    const orbit=circularPosition(r,theta);
    return {...orbit,id,name,color,isPlayer,hp:isPlayer?100:66,
      fuel:isPlayer?ENGINE.propellantKg:rand(120,170),fuelMax:isPlayer?ENGINE.propellantKg:170,
      dryMass:isPlayer?ENGINE.dryKg:1050,ammo:isPlayer?36:999,credits:isPlayer?65:0,
      repairParts:isPlayer?REPAIR.starterKg:0,isAlly:false,
      cargoKg:0,captureHeatMJ:0,captureRadiatedMJ:0,captureHeatProducedMJ:0,
      thrustN:isPlayer?ENGINE.thrustN:1400000,flowKgS:isPlayer?ENGINE.flowKgS:4.8,
      gunCooldown:isPlayer?0:rand(2.2,4),aiThrustUntil:0,aiThrustKind:null,nextDecision:rand(4,9),
      trail:[],trailT:0,alive:true,heading:Math.atan2(orbit.vy,orbit.vx),omega:0,
      gimbal:0,thrustVector:null,rcsFiring:0,shotCount:0};
  }
  function newPickup(r, angle, type='fuel', amount=25) {
    return {...circularPosition(r,angle), id:'pod-'+Math.random().toString(36).slice(2,8), type, amount,
      phase:rand(0,TWO_PI), alive:true};
  }
  function logEvent(message, category='neutral') {
    state.events.unshift({t:state.t, message, category});
    if(state.events.length>7) state.events.length=7;
    window.dispatchEvent(new CustomEvent('orbital-comms', {
      detail: {events: state.events.map(e=>({...e}))}
    }));
    const legacyFeed=$('event-feed');
    if(legacyFeed && legacyFeed.dataset.vueManaged!=='true')legacyFeed.innerHTML = state.events.map(e => {
      const min = Math.floor(e.t/60).toString().padStart(2,'0');
      const sec = Math.floor(e.t%60).toString().padStart(2,'0');
      return `<div class="event-entry ${e.category}"><time>${min}:${sec}</time><span>${escapeHtml(e.message)}</span></div>`;
    }).join('');
  }
  function escapeHtml(str) { return String(str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function reset() {
    if(persistentFlight&&state){
      state.followTarget=false;state.followPlayer=false;state.systemView=false;
      state.panX=0;state.panY=0;state.zoom=1;updateZoom();
      logEvent('View recentered; live encounter and pilot remain unchanged.','good');
      return;
    }
    const oldPilot = persistentFlight && state ? state.player : null;
    const oldTech = persistentFlight && state ? {predictive:state.predictive,trajectoryIntel:state.trajectoryIntel,navOwned:state.navOwned,ephemerisOwned:state.ephemerisOwned,captureOwned:state.captureOwned} : null;
    const player = newShip('player','KESTREL-7',260,-0.67,palette.cyan,true);
    if(oldPilot){
      for(const key of ['x','y','vx','vy','heading','omega','fuel'])player[key]=oldPilot[key];
      player.dryMass=oldPilot.dryMass;
    }
    const e1 = newShip('raider-01','RAIDER-01',280,0.17,palette.red);
    const e2 = newShip('raider-02','RAIDER-02',323,-2.02,palette.purple);
    const ally = newShip('ally-01','AEGIS-01',272,-0.21,palette.green);
    ally.isAlly=true;ally.hp=80;ally.ammo=120;ally.gunCooldown=1.5;ally.fuel=140;
    state = {t:0, player, ally, allies:[], enemies:[e1,e2], shots:[], pickups:[
      newPickup(260,-0.42,'fuel',28), newPickup(250,-1.20,'credits',24), newPickup(330,-2.42,'ammo',16),newPickup(312,0.75,'fuel',32),newPickup(365,1.7,'credits',30),newPickup(295,1.1,'parts',8)
    ], particles:[], events:[], down:new Set(), mouseTarget:null, targetId:e1.id, aimMode:'locked', zoom:1,
    orbitVisible:true, ephemerisVisible:true, selectedNavKey:'', systemView:false, showAxes:storedAxes(),
    measurement:{enabled:false,start:null,end:null,hover:null},followTarget:false, followPlayer:false, predictive:false, trajectoryIntel:false, ephemerisOwned:false, captureOwned:false, ballistic:null, lastBallistic:-999, reinforcements:false, navOwned:false, navPlan:null, autopilot:null, rescue:null, waypoint:null, panX:0,panY:0, pointerThrust:false, repairing:false, ended:false, speed:1, nextEnemySpawn:75,
    collisionCooldown:new Map(), playerKills:0, recordSurvival:0, predicted:[], lastPrediction:-999, dangerPrediction:false,
    playerReserveKg:storedReserve(),captureTether:null};
    if(oldTech){Object.assign(state,oldTech);player.credits=oldPilot.credits;}
    // Seeded salvage keeps one stable claim ID across encounter resets.
    state.pickups.filter(p=>p.type==='credits').forEach((pod,i)=>pod.id='starter-credits-'+i);
    lastFrame = performance.now(); accumulator=0;
    document.querySelectorAll('[data-thrust]').forEach(btn=>btn.classList.remove('pressed'));
    $('fire-btn').classList.remove('pressed');
    $('repair-btn').classList.remove('pressed');
    $('game-over').classList.add('hidden');
 
    $('orbit-btn').classList.add('selected');$('orbit-btn').setAttribute('aria-pressed','true');
    $('ephemeris-visibility-btn').classList.remove('selected');
    updateZoom();updateRulerUI();
    logEvent('Coast is free. Starter grant: 65 ¤ for testing upgrades.','good');
    logEvent('AEGIS-01 friendly escort online. Reinforcements disabled by default.','good');
    logEvent('Two pirate ships detected in sector.','danger');
    logEvent('Rotate A/D, stabilize S, thrust W; left-click targets, SPACE fires.');
    logEvent('Hold R to repair damage using spare parts (5 HP/kg).');
    logEvent('Press H or click REQUEST FUEL ASSISTANCE to call AEGIS-01.');
    updateTargetOptions();
    computePrediction();updateShotPreview();updateHud();
  }
  // NPCs and combat are server-owned. We only extrapolate them for smooth display.
  const seenSectorEvents = new Set();
  function mergeLiveBodies(current,incoming){
    const old=new Map(current.filter(Boolean).map(b=>[b.id,b]));
    return incoming.map(fresh=>{
      const previous=old.get(fresh.id);
      if(!previous)return {...fresh,trail:[],_netCorrection:null};
      const dx=fresh.x-previous.x,dy=fresh.y-previous.y;
      const correction=Math.hypot(dx,dy)<160?{x:dx,y:dy}:null;
      const x=correction?previous.x:fresh.x,y=correction?previous.y:fresh.y;
      return {...previous,...fresh,x,y,trail:previous.trail||[],_netCorrection:correction};
    });
  }
  function restoreEncounter(checkpoint){
    if(!checkpoint?.snapshot)return;
    const saved=checkpoint.snapshot;
    if(!Array.isArray(saved.enemies)||!Array.isArray(saved.pickups)||!saved.ally)return;
    const previous=JSON.stringify([state.enemies.map(e=>[e.id,e.alive]),state.ally.id+':'+state.ally.alive,(state.allies||[]).map(a=>[a.id,a.alive]),state.pickups.map(p=>[p.id,p.alive])]);
    state.enemies=mergeLiveBodies(state.enemies,saved.enemies);
    state.ally=mergeLiveBodies([state.ally],[saved.ally])[0];
    state.allies=mergeLiveBodies(state.allies||[],saved.allies||[]);
    state.pickups=mergeLiveBodies(state.pickups,saved.pickups);
    state.shots=mergeLiveBodies(state.shots,(saved.shots||[]).map((shot,i)=>({id:shot.id||'shot-'+i,...shot})));
    state.t=Math.max(state.t,saved.t||0);
    state.reinforcements=!!saved.reinforcements;
    state.nextEnemySpawn=saved.nextEnemySpawn||state.t+60;
    state.serverAssistance=saved.assistance||[];
    state.captureTether=saved.captureTether||null;
    state.playerKills=saved.playerKills||0;
    if(saved.player){
      const p=state.player,info=saved.player;
      const replacement=(info.respawnCount||0)>(state.lastRespawnCount||0);
      const revived=(!p.alive&&info.alive)||replacement;
      state.lastRespawnCount=info.respawnCount||0;
      p.hp=info.hp;p.ammo=info.ammo;p.repairParts=info.repairParts;p.alive=info.alive;
      p.cargoKg=info.cargoKg||0;
      p.captureHeatMJ=info.captureHeatMJ||0;
      p.captureRadiatedMJ=info.captureRadiatedMJ||0;
      p.captureHeatProducedMJ=info.captureHeatProducedMJ||0;
      p.captureMotorMJ=info.captureMotorMJ||0;
      p.captureFailures=info.captureFailures||0;
      if(revived){
        state.ended=false;state.autopilot=null;state.navPlan=null;state.down.clear();
        state.panX=-p.x*scale();state.panY=-p.y*scale();state.followPlayer=true;state.followTarget=false;
        correction=null;flightHistory=[];
        logEvent('Replacement spacecraft received from FastAPI. Manual approach controls ready.','good');
      }
      if(!p.alive){
        if(state.autopilot)abortNav('Spacecraft destroyed; guidance terminated.');
        state.down.clear();
        $('game-over-details').textContent='Ship destroyed. Use POST /dev/players/{pilot_id}/respawn in your local FastAPI /docs, then resume.';
        $('game-over').classList.remove('hidden');
      }else $('game-over').classList.add('hidden');
    }
    for(const e of saved.events||[]){
      const key=e.t+':'+e.message;
      if(seenSectorEvents.has(key))continue;
      seenSectorEvents.add(key);
      logEvent(e.message,e.category||'neutral');
    }
    if(seenSectorEvents.size>150)seenSectorEvents.clear();
    if(previous!==JSON.stringify([state.enemies.map(e=>[e.id,e.alive]),state.ally.id+':'+state.ally.alive,(state.allies||[]).map(a=>[a.id,a.alive]),state.pickups.map(p=>[p.id,p.alive])]))updateTargetOptions();
    state.lastPrediction=-999;state.lastBallistic=-999;
    updateHud();
  }
  function renderServerBodies(dt){
    for(const body of [state.ally,...(state.allies||[]),...state.enemies,...state.pickups,...state.shots]){
      if(!body?.alive)continue;
      // Visually extrapolate authoritative finite NPC engine burns. The server
      // still owns actual fuel, mass, velocity and burn completion.
      const burn=body.burn;
      if(burn && body.fuel>burn.reserveKg && burn.remainingDv>.0001){
        const m=body.dryMass+body.fuel,needed=m*(1-Math.exp(-burn.remainingDv/320));
        const spent=Math.max(0,Math.min(5*dt,body.fuel-burn.reserveKg,needed));
        const burnDt=spent/5;
        if(spent>0 && burnDt>0){
          const [ux,uy]=burn.direction;
          const acceleration=1600000/(Math.max(1,m-spent/2)*1000);
          stepBody(body,burnDt,{x:ux*acceleration,y:uy*acceleration});
          body.fuel-=spent;
          burn.remainingDv=Math.max(0,burn.remainingDv-320*Math.log(m/(m-spent)));
          body.heading=Math.atan2(uy,ux);
          body.thrustVector={x:ux,y:uy};
          if(burn.remainingDv<=.0001)body.burn=null;
          if(dt>burnDt)stepBody(body,dt-burnDt);
        }else stepBody(body,dt);
      }else{
        stepBody(body,dt);
        body.thrustVector=null;
      }
      body.heading=normAngle((body.heading||0)+(body.omega||0)*dt);
      if(body._netCorrection){
        const f=1-Math.exp(-11*dt);
        body.x+=body._netCorrection.x*f;
        body.y+=body._netCorrection.y*f;
        body._netCorrection.x*=1-f;body._netCorrection.y*=1-f;
      }
    }
    for(const p of state.particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt;}
    state.particles=state.particles.filter(p=>p.life>0);
  }

  function accel(x,y,at=state.t) {
    return STAR.acceleration(x,y,at);
  }
  function stepBody(body, dt, extra=null) {
    const a = accel(body.x,body.y,state.t-dt);
    const ax = a.x + (extra?.x || 0), ay = a.y + (extra?.y || 0);
    const halfVx = body.vx + .5*dt*ax, halfVy = body.vy + .5*dt*ay;
    body.x += halfVx*dt; body.y += halfVy*dt;
    const a2 = accel(body.x,body.y,state.t);
    body.vx = halfVx + .5*dt*(a2.x + (extra?.x || 0));
    body.vy = halfVy + .5*dt*(a2.y + (extra?.y || 0));
  }
  function unit(x,y){const m=magnitude(x,y)||1;return {x:x/m,y:y/m};}
  function normAngle(a){return Math.atan2(Math.sin(a),Math.cos(a));}
  function mass(ship){return ship.dryMass+ship.fuel+(ship.repairParts||0);}

  // The browser predicts flight at the render tick; these fields are corrected
  // from server snapshots without ever hard-setting the visible ship mid-flight.
  function flightSample(p){
    return {x:p.x,y:p.y,vx:p.vx,vy:p.vy,heading:p.heading,omega:p.omega,
      fuel:p.fuel,mass:mass(p)};
  }
  function flightControls(){
    const p=state.player,target=state.gimbalTarget;
    const desired=target?Math.atan2(target.y-p.y,target.x-p.x):p.heading;
    const firing=!!p.alive&&!state.ended&&state.down.has('fire');
    const aim=firing?shotDirection(p,aliveTarget()):{x:0,y:0};
    const weapons={fire:firing,repair:!!p.alive&&state.down.has('repair'),
      aim_x:aim.x,aim_y:aim.y};
    if(state.autopilot){
      const wanted=state.autoDirection;
      if(!wanted)return {thrust:false,turn:0,stabilize:true,gimbal:0,...weapons};
      const alpha=2*ENGINE.rcsN*ENGINE.leverM/(mass(p)*ENGINE.shipLengthM**2/12);
      const guidance=ATTITUDE.steer(p.heading,p.omega,wanted,alpha,.16);
      return {thrust:!!state.autoBurnAllowed&&guidance.aligned&&p.fuel>state.autopilot.reserveKg,
        turn:guidance.turn,stabilize:guidance.stabilize,gimbal:guidance.gimbal,...weapons};
    }
    return {
      thrust:!state.ended&&state.down.has('main'),
      turn:state.ended?0:Number(state.down.has('rotate-right'))-Number(state.down.has('rotate-left')),
      stabilize:!state.ended&&state.down.has('stabilize'),
      gimbal:state.down.has('main')?clamp(normAngle(desired-p.heading),-ENGINE.gimbalMax,ENGINE.gimbalMax):0,
      ...weapons
    };
  }
  function applyFlightCorrection(p,dt){
    if(!correction)return;
    const f=1-Math.exp(-12*dt);
    const fuelFix=correction.fuel*f, massFix=correction.mass*f;
    for(const key of ['x','y','vx','vy','omega','fuel']){
      const amount=correction[key]*f;
      p[key]+=amount;
      correction[key]-=amount;
    }
    const headingFix=correction.heading*f;
    p.heading=normAngle(p.heading+headingFix);
    correction.heading-=headingFix;
    p.dryMass+=massFix-fuelFix;
    correction.mass-=massFix;
  }
  function reconcileFlight(p,s,atMs){
    const reference=flightHistory.reduce((nearest,sample)=>
      Math.abs(sample.ms-atMs)<Math.abs(nearest.ms-atMs)?sample:nearest,flightHistory[0]);
    if(!persistentFlight||!flightOnline||!reference||Math.abs(reference.ms-atMs)>500||
       Math.hypot(p.x-s.x,p.y-s.y)>150){
      for(const key of ['x','y','vx','vy','heading','omega'])p[key]=s[key];
      p.fuel=s.fuel_kg;
      p.dryMass=s.mass_kg-s.fuel_kg-p.repairParts;
      correction=null;flightHistory=[];
      return;
    }
    const base=reference.state;
    const estimate={...s,fuel:s.fuel_kg,mass:s.mass_kg};
    correction={};
    for(const key of ['x','y','vx','vy','omega','fuel','mass'])
      correction[key]=estimate[key]-base[key];
    correction.heading=normAngle(estimate.heading-base.heading);
  }
  function repairHull(ship,dt){
    // Deliberately simple field repair: consumes cargo mass, never restores a destroyed ship
    if(!ship.alive || ship.hp>=100 || ship.repairParts<=0 || dt<=0)return false;
    const restored=Math.min(REPAIR.rateHpS*dt,100-ship.hp,ship.repairParts*REPAIR.hpPerKg);
    if(restored<=0)return false;
    ship.hp=Math.min(100,ship.hp+restored);
    const usedKg=restored/REPAIR.hpPerKg;
    ship.repairParts=Math.max(0,ship.repairParts-usedKg);
    ship.dryMass+=usedKg; // Repair material becomes hull structure; total mass is conserved
    return true;
  }
  function burn(ship,dt,dir,rcs=false,minReserve=0){
    if(!dir||ship.fuel<=minReserve)return null;
    const flow=rcs?ENGINE.rcsFlowKgS:ship.flowKgS;
    const rate=rcs?ENGINE.rcsN*2:ship.thrustN;
    const used=Math.min(Math.max(0,ship.fuel-minReserve),flow*dt);
    if(used<=0)return null;
    const before=mass(ship),after=before-used;
    ship.fuel-=used;
    const dv=(rate/flow/1000)*Math.log(before/after);
    return {x:dir.x*dv/dt,y:dir.y*dv/dt,used,dv};
  }
  function rcsControl(ship,dt,command,minReserve=0){
    const inertia=mass(ship)*ENGINE.shipLengthM**2/12;
    const alpha=(2*ENGINE.rcsN*ENGINE.leverM)/inertia;
    let sign=command==='rotate-left'?-1:command==='rotate-right'?1:0;
    if(command==='stabilize' && Math.abs(ship.omega)>.00001) sign=-Math.sign(ship.omega);
    ship.rcsFiring=0;
    if(sign!==0 && ship.fuel>minReserve){
      const used=Math.min(Math.max(0,ship.fuel-minReserve),ENGINE.rcsFlowKgS*dt);
      ship.fuel-=used;
      const applied=alpha*sign*dt*(used/(ENGINE.rcsFlowKgS*dt));
      if(command==='stabilize' && Math.sign(ship.omega+applied)!==Math.sign(ship.omega)) ship.omega=0;
      else ship.omega+=applied;
      ship.rcsFiring=sign;
    }
    ship.heading=normAngle(ship.heading+ship.omega*dt);
  }
  function autoAttitude(ship,dt,wanted,minReserve=0){
    const alpha=(2*ENGINE.rcsN*ENGINE.leverM)/(mass(ship)*ENGINE.shipLengthM**2/12);
    const guidance=ATTITUDE.steer(ship.heading,ship.omega,wanted,alpha,dt);
    const command=guidance.stabilize?'stabilize':guidance.turn<0?'rotate-left':
      guidance.turn>0?'rotate-right':'idle';
    rcsControl(ship,dt,command,minReserve);
    ship.gimbal=guidance.gimbal;
    // Finite burn is allowed only when the spacecraft is actually settled
    // near the intended direction, preventing unintended side impulses.
    return guidance.aligned;
  }
  function manualAttitude(ship,dt){
    let command='idle';
    if(state.down.has('stabilize'))command='stabilize';
    else if(state.down.has('rotate-left')&&!state.down.has('rotate-right'))command='rotate-left';
    else if(state.down.has('rotate-right')&&!state.down.has('rotate-left'))command='rotate-right';
    rcsControl(ship,dt,command);
    if(state.gimbalTarget){
      const desired=Math.atan2(state.gimbalTarget.y-ship.y,state.gimbalTarget.x-ship.x);
      ship.gimbal=clamp(normAngle(desired-ship.heading),-ENGINE.gimbalMax,ENGINE.gimbalMax);
    }else ship.gimbal=0;
  }
  function enemyThrustDirection(ship,pressed){
    if(!pressed.length)return null;
    const radial=unit(ship.x,ship.y),forward=unit(ship.vx,ship.vy);
    const kind=pressed[0];
    if(kind==='prograde')return forward;
    if(kind==='retrograde')return {x:-forward.x,y:-forward.y};
    if(kind==='outward')return radial;
    if(kind==='inward')return {x:-radial.x,y:-radial.y};
    return null;
  }
  function applyShipStep(ship,dt,pressed=[]){
    if(!ship.alive)return;
    let dir=null;
    if(ship.isPlayer){
      const requested=autopilotStep(dt);
      if(persistentFlight){state.autoDirection=requested;state.autoBurnAllowed=false;}
      const reserve=state.autopilot?.reserveKg||0;
      if(requested){
        if(autoAttitude(ship,dt,requested,reserve))dir=requested;
        if(persistentFlight)state.autoBurnAllowed=!!dir;
      }else if(state.autopilot){
        const a=state.autopilot;
        const next=a.phase==='wait'?a.plan.dv1:a.phase==='coast'?a.plan.dv2:null;
        if(next&&magnitude(next.x,next.y)>.01){
          autoAttitude(ship,dt,next,reserve);
          if(persistentFlight)state.autoDirection=unit(next.x,next.y);
        }else rcsControl(ship,dt,'stabilize',reserve);
      }else{
        manualAttitude(ship,dt);
        if(state.down.has('main')){
          const angle=ship.heading+ship.gimbal;dir={x:Math.cos(angle),y:Math.sin(angle)};
        }
      }
    }else if(ship.isAlly&&state.rescue){
      const wanted=rescueStep(dt);
      const reserve=rescueFuelFloor();
      if(wanted){if(autoAttitude(ship,dt,wanted,reserve))dir=wanted;}
      else rcsControl(ship,dt,'stabilize',reserve);
    }else{
      dir=enemyThrustDirection(ship,pressed);
      if(dir)ship.heading=Math.atan2(dir.y,dir.x);
    }
    const minReserve=ship.isPlayer&&state.autopilot?state.autopilot.reserveKg:ship.isAlly&&state.rescue?rescueFuelFloor():0;
    const result=dir?burn(ship,dt,dir,false,minReserve):null;
    const extra=result?{x:result.x,y:result.y}:null;
    ship.thrustVector=extra;
    if(ship.isAlly&&result&&state.rescue&&state.rescue.phase==='burn1'){
      const a=state.rescue,left=magnitude(a.remaining.x,a.remaining.y);
      const projected=(result.x*a.remaining.x+result.y*a.remaining.y)/Math.max(.00001,left)*dt;
      const remaining=Math.max(0,left-Math.max(0,projected)),k=remaining/Math.max(left,.00001);
      a.remaining.x*=k;a.remaining.y*=k;
      if(remaining<Math.max(.12,result.dv*.65))a.phase='coast';
    }
    if(ship.isPlayer&&result&&state.autopilot&&state.autopilot.phase==='burn1'){
      const a=state.autopilot;
      const lengthLeft=magnitude(a.remaining.x,a.remaining.y);
      const projected=(result.x*a.remaining.x+result.y*a.remaining.y)/Math.max(.00001,lengthLeft)*dt;
      const remaining=Math.max(0,lengthLeft-projected);
      const k=remaining/Math.max(lengthLeft,.00001);
      a.remaining.x*=k;a.remaining.y*=k;
      if(remaining<Math.max(.12,result.dv*.65)){a.phase='coast';a.remaining={x:0,y:0};}
    }
    if(ship.isPlayer&&state.autopilot){
      const a=state.autopilot;
      if(a.spentAtStart-ship.fuel>a.maxSpendKg+.0001)abortNav('Fuel budget exhausted; emergency reserve protected.');
      else if(!SAFE.burnAllowed(ship.fuel,ship.fuelMax,a.reserveKg))abortNav('Emergency propellant reserve reached.');
    }
    if(ship.isAlly&&state.rescue&&state.rescue.fuelAtStart-ship.fuel>state.rescue.maxSpendKg+.1){
      cancelRescue('AEGIS-01 aborted: its rescue fuel budget was exceeded.');
    }
    stepBody(ship,dt,extra);
    ship.gunCooldown=Math.max(0,ship.gunCooldown-dt);
    ship.trailT+=dt;
    if(ship.trailT>.16){ship.trail.push({x:ship.x,y:ship.y});if(ship.trail.length>120)ship.trail.shift();ship.trailT=0;}
    if(magnitude(ship.x,ship.y)<WORLD.crashRadius){
      if(ship.isPlayer)endGame('Your spacecraft intersected the surface of Kestrel.');
      else if(ship.isAlly)destroyAlly('fell into the gravity well');
      else destroyEnemy(ship,'fell into the gravity well');
    }
    // Leaving the former sector boundary does not destroy a spacecraft. Hyperbolic escape is physical.
    if(ship.isPlayer&&ship.hp<=0)endGame('Hostile fire destroyed your spacecraft.');
  }
  function resolveVesselCollisions(dt,initial){
    const vessels=[state.player,state.ally,...state.enemies].filter(v=>v.alive);
    const effectiveDiameterKm=4; // A generous gameplay envelope; the literal ship is 14 m long.
    for(let i=0;i<vessels.length;i++)for(let j=i+1;j<vessels.length;j++){
      const a=vessels[i],b=vessels[j],a0=initial.get(a.id),b0=initial.get(b.id);
      if(persistentFlight && (a.isPlayer||b.isPlayer))continue; // Player collision physics is not yet server authoritative.
      if(!a0||!b0)continue;
      const pair=[a.id,b.id].sort().join(':');
      if((state.collisionCooldown.get(pair)||-1)>state.t)continue;
      const hit=COLL.sweep(a0,a,b0,b,effectiveDiameterKm);
      if(!hit)continue;
      const av={...a,startX:a0.x,startY:a0.y,massKg:mass(a)};
      const bv={...b,startX:b0.x,startY:b0.y,massKg:mass(b)};
      const impact=COLL.resolve(av,bv,hit,dt,effectiveDiameterKm);
      if(!impact)continue;
      for(const name of ['x','y','vx','vy']){a[name]=av[name];b[name]=bv[name];}
      state.collisionCooldown.set(pair,state.t+.8);
      if(impact.damage<.05)continue;
      a.hp=Math.max(0,a.hp-impact.damage);b.hp=Math.max(0,b.hp-impact.damage);
      const severity=impact.relativeSpeedKmS.toFixed(2)+' km/s';
      logEvent(a.name+' collided with '+b.name+' at '+severity+'!','danger');
      sparks((a.x+b.x)/2,(a.y+b.y)/2,palette.yellow,24);
      for(const ship of [a,b]){
        if(ship.hp>0||!ship.alive)continue;
        if(ship.isPlayer)endGame('Spacecraft collision destroyed KESTREL-7.');
        else if(ship.isAlly)destroyAlly('destroyed by collision');
        else destroyEnemy(ship,'destroyed by spacecraft collision');
      }
      if(state.ended)return;
    }
    for(const [key,until] of state.collisionCooldown)if(until<state.t-2)state.collisionCooldown.delete(key);
  }
  function step(dt) {
    if(state.ended)return;
    state.t+=dt;
    const initial=new Map([state.player,state.ally,...state.enemies].filter(s=>s.alive).map(s=>[s.id,{x:s.x,y:s.y}]));
    const player=state.player;
    if(persistentFlight){
      if(player.alive&&flightOnline){
        applyShipStep(player,dt);
        applyFlightCorrection(player,dt);
      }else{
        stepBody(player,dt);
        player.heading=normAngle(player.heading+player.omega*dt);
        player.thrustVector=null;player.rcsFiring=0;
      }
      flightHistory.push({ms:performance.now(),state:flightSample(player)});
      while(flightHistory.length>2&&performance.now()-flightHistory[0].ms>1400)flightHistory.shift();
      renderServerBodies(dt);
      return;
    }
    applyShipStep(player,dt);
    if(state.ended)return;
    state.repairing=state.down.has('repair')&&repairHull(player,dt);
    const cooling=Math.min(player.captureHeatMJ||0,8*dt);
    player.captureHeatMJ=Math.max(0,(player.captureHeatMJ||0)-cooling);
    player.captureRadiatedMJ=(player.captureRadiatedMJ||0)+cooling;
    const ally=state.ally;
    if(ally.alive){
      applyShipStep(ally,dt);
      const threats=state.enemies.filter(e=>e.alive);
      threats.sort((a,b)=>magnitude(a.x-ally.x,a.y-ally.y)-magnitude(b.x-ally.x,b.y-ally.y));
      const target=threats[0];
      if(target && magnitude(target.x-ally.x,target.y-ally.y)<460 && ally.gunCooldown<=0 && ally.ammo>0 && state.t>2){
        shoot(ally,target,false);
      }
    }
    for(const enemy of state.enemies) {
      if(!enemy.alive)continue;
      let command=[];
      if(state.t>enemy.nextDecision) {
        const r=magnitude(enemy.x,enemy.y);
        enemy.aiThrustKind = r<165 ? 'prograde' : ['retrograde','prograde','inward','outward',null][Math.floor(rand(0,5))];
        enemy.aiThrustUntil=state.t+rand(.2,.6);
        enemy.nextDecision=state.t+rand(6,12);
      }
      if(enemy.aiThrustKind && state.t<enemy.aiThrustUntil) command=[enemy.aiThrustKind];
      applyShipStep(enemy,dt,command);
      if(!enemy.alive)continue;
      const defenders=[player,ally].filter(ship=>ship.alive);
      defenders.sort((a,b)=>magnitude(enemy.x-a.x,enemy.y-a.y)-magnitude(enemy.x-b.x,enemy.y-b.y));
      const victim=defenders[0];
      const d=victim?magnitude(enemy.x-victim.x,enemy.y-victim.y):Infinity;
      if(d<310 && enemy.gunCooldown<=0 && state.t>5) {
        shoot(enemy,victim,true);
        enemy.gunCooldown=rand(3.7,5.2);
      }
    }
    resolveVesselCollisions(dt,initial);
    if(state.ended)return;
    if(state.down.has('fire')) firePlayer();
    for(const p of state.pickups) {
      if(!p.alive) continue;
      stepBody(p,dt);
      handleLocalTether(p,dt);
      if(p.alive&&!state.captureTether&&state.rescue?.activity==='scavenge'&&state.rescue.targetKey==='pickup:'+p.id&&state.ally.alive&&
         magnitude(p.x-state.ally.x,p.y-state.ally.y)<19&&magnitude(p.vx-state.ally.vx,p.vy-state.ally.vy)<5){
        p.alive=false;
        const received=Math.min(state.ally.fuelMax-state.ally.fuel,p.amount);
        state.ally.fuel+=Math.max(0,received);
        logEvent('AEGIS-01 collected '+received.toFixed(1)+' kg propellant from salvage.','good');
        state.rescue=null;startRescueLeg('deliver');updateTargetOptions();
      }
      // Salvage has no despawn timer. It remains in orbit until collected or crashes.
      if(magnitude(p.x,p.y)<WORLD.crashRadius) p.alive=false;
    }
    for(const shot of state.shots) {
      if(!shot.alive)continue;
      stepBody(shot,dt);
      // A shot persists indefinitely unless it hits something physical. Escaping the sector is not a deletion event.
      if(magnitude(shot.x,shot.y)<WORLD.crashRadius) {shot.alive=false;continue;}
      const targets=shot.faction==='raider'?[player,ally]:state.enemies;
      for(const target of targets) {
        if(!target.alive)continue;
        if(magnitude(shot.x-target.x,shot.y-target.y)<14) {
          const damage=shot.faction==='player'?26:shot.faction==='ally'?18:10;
          shot.alive=false; target.hp=Math.max(0,target.hp-damage);
          sparks(shot.x,shot.y,shot.fromPlayer?palette.red:palette.cyan,9);
          if(target.hp<=0) {
            if(target.isPlayer)endGame('Hostile projectile destroyed your spacecraft.');
            else if(target.isAlly)destroyAlly('destroyed by pirate fire');
            else destroyEnemy(target,shot.faction==='ally'?'destroyed by AEGIS-01':'destroyed by Kestrel-7');
          } else if(target.isPlayer && (state.t-(target.lastHitLog||0))>2.3) {
            logEvent('Hull impact! Integrity '+Math.ceil(target.hp)+'%.','danger');target.lastHitLog=state.t;
          }
          break;
        }
      }
    }
    for(const part of state.particles){part.x+=part.vx*dt;part.y+=part.vy*dt;part.life-=dt;}
    state.shots=state.shots.filter(s=>s.alive);
    state.pickups=state.pickups.filter(p=>p.alive);
    state.particles=state.particles.filter(p=>p.life>0);
    if(state.reinforcements && state.t>state.nextEnemySpawn) {
      const alive = state.enemies.filter(e=>e.alive).length;
      if(alive<2){spawnEnemy();}
      state.nextEnemySpawn=state.t+rand(35,55);
    }
  }
  function spawnEnemy() {
    const spawnRadiusKm=1450;
    const angle=rand(-Math.PI,Math.PI);
    const id='raider-'+Math.random().toString(36).slice(2,7);
    const bot = newShip(id,'RAIDER-'+String(Math.floor(rand(10,99))),spawnRadiusKm,angle,palette.red);
    Object.assign(bot,ARRIVAL.inboundState(angle,spawnRadiusKm,rand(-29,-24),rand(10,13),Math.random()<.5?-1:1));
    bot.heading=Math.atan2(bot.vy,bot.vx);
    state.enemies.push(bot);logEvent('Inbound ship detected beyond sector boundary: '+bot.name,'danger');
    
  }
  function destroyAlly(reason){
    const ally=state.ally;if(!ally.alive)return;
    ally.alive=false;ally.hp=0;ally.thrustVector=null;
    sparks(ally.x,ally.y,palette.green,25);
    state.pickups.push({x:ally.x,y:ally.y,vx:ally.vx,vy:ally.vy,id:'wreck-'+ally.id,type:'wreck',amount:1,phase:0,alive:true});
    logEvent('AEGIS-01 '+reason+'. Escort lost.','danger');
    updateTargetOptions();
  }
  function destroyEnemy(enemy,reason) {
    if(!enemy.alive)return;
    enemy.alive=false; enemy.hp=0;sparks(enemy.x,enemy.y,palette.red,22);
    state.pickups.push({x:enemy.x,y:enemy.y,vx:enemy.vx,vy:enemy.vy,id:'wreck-'+enemy.id,type:'wreck',amount:1,phase:0,alive:true});
    if(reason==='destroyed by Kestrel-7'){state.playerKills++;logEvent(enemy.name+' destroyed. Salvage the wreck.','good');}
    else logEvent(enemy.name+' '+reason+'.',reason.includes('AEGIS')?'good':'neutral');
    const survivors=state.enemies.filter(e=>e.alive);
    if(state.targetId===enemy.id)state.targetId=survivors.length?survivors[0].id:null;
    if(state.autopilot?.targetKey==='enemy:'+enemy.id)abortNav('Target destroyed.');
    updateTargetOptions();
    
  }
  function handleLocalTether(pod,dt){
    const p=state.player;
    const range=magnitude(pod.x-p.x,pod.y-p.y);
    const rvx=pod.vx-p.vx,rvy=pod.vy-p.vy,relative=magnitude(rvx,rvy);
    let tether=state.captureTether;
    if(tether&&tether.pickupId!==pod.id)return;
    if(!tether){
      if(range>19||state.t-(pod.lastTetherFailedAt||-1e9)<20)return;
      const amount=pod.amount||0;
      const fuelGain=pod.type==='fuel'?Math.max(0,Math.min(amount,p.fuelMax-p.fuel)):0;
      const partsGain=pod.type==='parts'?Math.max(0,Math.min(amount,REPAIR.capacityKg-p.repairParts)):0;
      if((pod.type==='fuel'&&fuelGain===0)||(pod.type==='parts'&&partsGain===0))return;
      const payload=pod.type==='fuel'?fuelGain:pod.type==='parts'?partsGain:
        pod.type==='credits'?2:pod.type==='ammo'?amount*.12:pod.type==='wreck'?(pod.massKg||120):0;
      const reduced=mass(p)*payload/(mass(p)+payload);
      const energy=.5*reduced*relative*relative;
      const limit=state.captureOwned?8:5;
      if(!payload||payload>(state.captureOwned?240:150)||relative>=limit||
         (p.captureHeatMJ||0)+energy>(state.captureOwned?1300:520))return;
      const dx=pod.x-p.x,dy=pod.y-p.y;
      const nx=range>1e-7?dx/range:relative>1e-7?rvx/relative:1;
      const ny=range>1e-7?dy/range:relative>1e-7?rvy/relative:0;
      const outbound=Math.max(0,rvx*nx+rvy*ny);
      const tensionLimit=state.captureOwned?12000:2200;
      const brakeDistance=reduced*1000*outbound*outbound/(2*tensionLimit);
      if(brakeDistance+.25>19-range){
        if(state.t-(pod.lastCaptureDeniedAt||-1e9)>12){
          pod.lastCaptureDeniedAt=state.t;
          logEvent('Automatic grapple refused: '+brakeDistance.toFixed(1)+
            ' km braking distance needs more free tether line. Approach more slowly.','danger');
        }
        return;
      }
      tether={pickupId:pod.id,massKg:payload,startedAt:state.t,durationS:0,tensionN:0,
        peakTensionN:0,fatigueS:0,heatMJ:0,motorMJ:0,status:'reeling'};
      state.captureTether=tether;
      logEvent('Finite grapple latched onto '+pod.id+'; reeling in '+payload.toFixed(1)+' kg.','good');
    }
    const fail=reason=>{
      state.captureTether=null;pod.lastTetherFailedAt=state.t;
      p.hp=Math.max(0,p.hp-2);p.captureFailures=(p.captureFailures||0)+1;
      logEvent('Capture tether failed: '+reason+'. 2% hull damage.','danger');
      if(p.hp<=0)endGame('Capture tether destroyed KESTREL-7.');
    };
    if(range<.7&&relative<.65){state.captureTether=null;collect(pod);return;}
    if(state.t-tether.startedAt>110||range>19){fail('line overextended or timeout');return;}
    const [nx,ny]=range>1e-7?[ (pod.x-p.x)/range,(pod.y-p.y)/range ]:
      relative>1e-7?[rvx/relative,rvy/relative]:[1,0];
    const radial=rvx*nx+rvy*ny;
    const reduced=mass(p)*tether.massKg/(mass(p)+tether.massKg);
    const maxTension=state.captureOwned?12000:2200;
    const breaking=state.captureOwned?30000:6000;
    const desired=-Math.min(.36,Math.max(0,range-.7)*.20);
    const wanted=Math.max(0,reduced*1000*(radial-desired)/Math.max(.025,dt));
    const stopping=reduced*1000*Math.max(0,radial)**2/(2*maxTension);
    if(radial>0&&range+stopping>19.05||wanted>breaking&&range>19*.85){
      fail('overload / insufficient braking distance');return;
    }
    const tension=Math.min(maxTension,wanted);
    const heat=Math.max(0,tension*radial*dt/1000);
    const motor=Math.max(0,-tension*radial*dt/1000);
    if((p.captureHeatMJ||0)+heat>(state.captureOwned?1300:520)){
      fail('heat sink exceeded');return;
    }
    tether.fatigueS+=(tension/maxTension)**2*dt;
    if(tether.fatigueS>55){fail('structural fatigue');return;}
    const impulse=tension*dt/1000;
    p.vx+=impulse/mass(p)*nx;
    p.vy+=impulse/mass(p)*ny;
    pod.vx-=impulse/tether.massKg*nx;
    pod.vy-=impulse/tether.massKg*ny;
    tether.tensionN=tension;tether.peakTensionN=Math.max(tension,tether.peakTensionN);
    tether.durationS+=dt;tether.heatMJ+=heat;tether.motorMJ+=motor;
    p.captureHeatMJ=(p.captureHeatMJ||0)+heat;
    p.captureHeatProducedMJ=(p.captureHeatProducedMJ||0)+heat;
    p.captureMotorMJ=(p.captureMotorMJ||0)+motor;
  }
  function collect(pod) {
    const p=state.player;
    const massBefore=mass(p),heatLimit=state.captureOwned?1300:520;
    const amount=pod.amount||0;
    const fuelGain=pod.type==='fuel'?Math.min(amount,p.fuelMax-p.fuel):0;
    const partsGain=pod.type==='parts'?Math.min(amount,REPAIR.capacityKg-p.repairParts):0;
    if(pod.type==='fuel'&&fuelGain<=0||pod.type==='parts'&&partsGain<=0)return;
    const incomingMass=pod.type==='fuel'?fuelGain:
      pod.type==='parts'?partsGain:pod.type==='ammo'?amount*.12:
      pod.type==='credits'?2:pod.type==='wreck'?(pod.massKg||120):0;
    const relV=magnitude(pod.vx-p.vx,pod.vy-p.vy);
    const reducer=massBefore*incomingMass/(massBefore+incomingMass);
    const heatMJ=.5*reducer*relV*relV;
    const maxMass=state.captureOwned?240:150;
    if(!incomingMass||incomingMass>maxMass||relV>=(state.captureOwned?8:5)||
       (p.captureHeatMJ||0)+heatMJ>heatLimit){
      if(state.t-(pod.lastCaptureDeniedAt||-1e9)>12){
        pod.lastCaptureDeniedAt=state.t;
        logEvent('Capture rejected: speed, grapple mass or heat-sink limit exceeded.','danger');
      }
      return;
    }
    const ratio=incomingMass/(massBefore+incomingMass);
    p.vx+=ratio*(pod.vx-p.vx);
    p.vy+=ratio*(pod.vy-p.vy);
    p.captureHeatMJ=(p.captureHeatMJ||0)+heatMJ;
    p.captureHeatProducedMJ=(p.captureHeatProducedMJ||0)+heatMJ;
    if(pod.type==='fuel'){p.fuel+=fuelGain;}
    if(pod.type==='ammo')p.ammo+=amount;
    if(pod.type==='credits')p.credits+=amount;
    if(pod.type==='parts')p.repairParts+=partsGain;
    let wreckParts=0;
    if(pod.type==='wreck'){
      p.credits+=50;p.ammo+=12;
      wreckParts=Math.min(6,REPAIR.capacityKg-p.repairParts);
      p.repairParts+=wreckParts;
    }
    if(!['fuel','parts'].includes(pod.type)){
      // Repair parts are already counted by mass(ship). Do not double-count.
      p.dryMass+=incomingMass-wreckParts;
      p.cargoKg=(p.cargoKg||0)+incomingMass;
    }
    if(['fuel','parts'].includes(pod.type)&&
       (pod.type==='fuel'?fuelGain:partsGain)<amount-.00001){
      pod.amount=amount-(pod.type==='fuel'?fuelGain:partsGain);
    }else pod.alive=false;
    logEvent('Salvage captured · '+heatMJ.toFixed(1)+' MJ absorbed, momentum conserved.','good');
    if(!pod.alive&&state.autopilot?.targetKey==='pickup:'+pod.id){
      state.autopilot=null;state.navPlan=null;
      logEvent('Rendezvous complete. Salvage secured!','good');
    }
    sparks(pod.x,pod.y,palette.green,12);
    if(!pod.alive)updateTargetOptions();
  }

  function sparks(x,y,color,n) {
    for(let i=0;i<n;i++){const a=rand(0,TWO_PI),v=rand(6,45);state.particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,color,life:rand(.35,1),maxLife:1});}
    if(state.particles.length>200)state.particles.splice(0,state.particles.length-200);
  }
  function aliveTarget() {return state.enemies.find(e=>e.id===state.targetId && e.alive)||null;}
  function selectNextTarget() {
    const targets=state.enemies.filter(e=>e.alive);
    if(!targets.length){state.targetId=null;state.aimMode='manual';return;}
    const index=targets.findIndex(e=>e.id===state.targetId);
    state.targetId=targets[(index+1)%targets.length].id;
    state.aimMode='locked';logEvent('Tracking '+aliveTarget().name+'.');
  }
  function lockNearest() {
    let nearest=null, dist=Infinity;
    for(const e of state.enemies)if(e.alive){const d=magnitude(e.x-state.player.x,e.y-state.player.y);if(d<dist){nearest=e;dist=d;}}
    if(nearest){state.targetId=nearest.id;state.aimMode='locked';logEvent('Locked nearest contact: '+nearest.name+'.');}
    else logEvent('No living targets in range.');
  }
  function navKeyExists(key){
    if(key==='star'||key==='planet')return true;
    if(key==='waypoint')return !!state.waypoint;
    if(key?.startsWith('pickup:'))return state.pickups.some(p=>p.id===key.slice(7)&&p.alive);
    if(key?.startsWith('enemy:'))return state.enemies.some(p=>p.id===key.slice(6)&&p.alive);
    if(key==='ally')return state.ally.alive;
    if(key?.startsWith('ally:'))return (state.allies||[]).some(a=>a.id===key.slice(5)&&a.alive);
    return false;
  }
  function navTarget(key){
    if(key==='star')return STAR.star(state.t);
    if(key==='planet')return {id:'kestrel',name:'KESTREL',type:'planet',
      alive:true,x:0,y:0,vx:0,vy:0,fixed:true};
    if(key==='waypoint'&&state.waypoint)return {...state.waypoint,fixed:true,orbitSign:state.player.x*state.player.vy-state.player.y*state.player.vx>=0?1:-1};
    if(key?.startsWith('pickup:'))return state.pickups.find(p=>p.id===key.slice(7)&&p.alive)||null;
    if(key?.startsWith('enemy:'))return state.enemies.find(p=>p.id===key.slice(6)&&p.alive)||null;
    if(key==='ally'&&state.ally.alive)return state.ally;
    if(key?.startsWith('ally:'))return (state.allies||[]).find(a=>a.id===key.slice(5)&&a.alive)||null;
    return null;
  }
  function selectedContact(){
    const key=state.selectedNavKey,target=navTarget(key);
    if(!target)return null;
    const kind=key==='star'?'star':key==='planet'?'planet':
      key==='waypoint'?'waypoint':key.startsWith('pickup:')?'salvage':
      key.startsWith('enemy:')?'enemy':'ally';
    const label=kind==='waypoint'?'WAYPOINT':target.name||
      ((target.type==='wreck'?'WRECK':String(target.type||'SALVAGE').toUpperCase())+' · '+target.id);
    return {x:target.x,y:target.y,kind,label,id:target.id||key};
  }
  function updateTargetOptions(preferred){
    const select=$('nav-target');const previous=preferred||state.selectedNavKey||select.value;
    const entries=[...state.pickups.filter(p=>p.alive).map(p=>({key:'pickup:'+p.id,text:(p.type==='wreck'?'Wreck':'Salvage '+p.type)+' · '+p.id.slice(-4)})),
      ...state.enemies.filter(e=>e.alive).map(e=>({key:'enemy:'+e.id,text:e.name+' · hostile'})),
      ...(state.ally.alive?[{key:'ally',text:'AEGIS-01 · friendly escort'}]:[]),
      ...(state.allies||[]).filter(a=>a.alive).map(a=>({key:'ally:'+a.id,text:a.name+' · friendly visitor'})),
      {key:'star',text:'✦ Veyra · parent star'},
      {key:'planet',text:'◎ Kestrel · planet'}];
    if(state.waypoint)entries.unshift({key:'waypoint',text:'Map waypoint (fixed location)'});
    const selected=entries.some(item=>item.key===previous)?previous:entries[0]?.key||'';
    state.selectedNavKey=selected;
    if(state.ephemerisCache?.key!==navTarget(selected)?.id)state.ephemerisCache=null;
    if(select.dataset.vueManaged==='true'){
      window.dispatchEvent(new CustomEvent('orbital-navigation-options',{detail:{options:entries,selected}}));
      return;
    }
    select.replaceChildren();
    for(const item of entries){const o=document.createElement('option');o.value=item.key;o.textContent=item.text;select.append(o);}
    select.value=selected;
  }
  function cycleNavigationTarget(){
    const select=$('nav-target');
    if(select.options.length<2)return;
    select.selectedIndex=(select.selectedIndex+1)%select.options.length;
    state.navPlan=null;
    const key=select.value;
    state.selectedNavKey=key;state.ephemerisCache=null;
    if(key.startsWith('enemy:')){state.targetId=key.slice(6);state.aimMode='locked';state.lastBallistic=-999;}
    logEvent('Navigation target: '+select.selectedOptions[0].textContent);
    if(select.dataset.vueManaged==='true')window.dispatchEvent(new CustomEvent('orbital-navigation-options',{
      detail:{options:Array.from(select.options).map(o=>({key:o.value,text:o.textContent})),selected:key}
    }));
    updateHud();
  }
  function purchaseUpgrade(upgrade){
    if(!persistentFlight)return false;
    if(!pilotLink?.purchase(upgrade))logEvent('Connect to the flight server to purchase upgrades.','danger');
    return true;
  }
  function purchaseOrEngage(){
    if(state.ended)return;
    if(!state.navOwned&&purchaseUpgrade('nav'))return;
    if(!state.navOwned){
      if(state.player.credits<60){logEvent('Rendezvous computer costs 60 credits.','danger');return;}
      state.player.credits-=60;state.navOwned=true;logEvent('Rendezvous computer installed. Calculate a route, then engage.','good');updateHud();return;
    }
    engageNav();
  }

  // Rescue is neither a teleport nor free fuel: the ally must physically intercept
  // a salvage pod if short of fuel, then rendezvous and match velocity before transfer.
  const rescueFuelFloor=()=>state.rescue?.protectedKg??Math.max(18,SAFE.reserveKg(state.ally.fuelMax,.12,18));
  function cancelRescue(reason){
    if(!state.rescue)return;
    state.rescue=null;logEvent(reason,'danger');updateHud();
  }
  function startRescueLeg(activity){
    const ally=state.ally;
    if(!ally.alive)return false;
    let key,target,donationHold=activity==='deliver'?20:0;
    if(activity==='scavenge'){
      const eligible=state.pickups.filter(p=>p.alive&&p.type==='fuel');
      let best=null;
      for(const p of eligible){
        const budget=Math.max(0,ally.fuel-rescueFuelFloor()-5);
        if(budget<2)continue;
        const plan=NAV.plan(ally,p,{mu:WORLD.mu,inner:WORLD.crashRadius+7,outer:2200,
          massKg:mass(ally),propellantKg:budget,exhaustKmS,extended:false});
        const assessment=plan?SAFE.authorize({fuelKg:ally.fuel,capacityKg:ally.fuelMax,massKg:mass(ally),dvKmS:plan.dv,exhaustKmS,margin:1.6,reserve:rescueFuelFloor()+5}):null;
        if(plan&&assessment?.ok&&(!best||plan.dv<best.plan.dv))best={p,plan,assessment};
      }
      if(!best){logEvent('AEGIS cannot find an affordable fuel pod. Assistance on hold.','danger');return false;}
      key='pickup:'+best.p.id;target=best.p;
    }else{
      target=state.player;key='player';
      if(ally.fuel<rescueFuelFloor()+donationHold+4)return startRescueLeg('scavenge');
    }
    let plan,assessment;
    if(activity==='scavenge'){
      const bestPlan=NAV.plan(ally,target,{mu:WORLD.mu,inner:WORLD.crashRadius+7,outer:2200,
        massKg:mass(ally),propellantKg:Math.max(0,ally.fuel-rescueFuelFloor()-5),exhaustKmS,extended:false});
      plan=bestPlan;
      assessment=plan?SAFE.authorize({fuelKg:ally.fuel,capacityKg:ally.fuelMax,massKg:mass(ally),dvKmS:plan.dv,exhaustKmS,margin:1.6,reserve:rescueFuelFloor()+5}):null;
    }else{
      plan=NAV.plan(ally,target,{mu:WORLD.mu,inner:WORLD.crashRadius+7,outer:2200,
        massKg:mass(ally),propellantKg:Math.max(0,ally.fuel-rescueFuelFloor()-donationHold),exhaustKmS,extended:true});
      assessment=plan?SAFE.authorize({fuelKg:ally.fuel,capacityKg:ally.fuelMax,massKg:mass(ally),dvKmS:plan.dv,exhaustKmS,margin:1.6,reserve:rescueFuelFloor()+donationHold}):null;
    }
    if(!plan||!assessment?.ok){logEvent('AEGIS could not calculate a safe rescue rendezvous. Try again after orbits change.','danger');return false;}
    state.rescue={activity,targetKey:key,phase:'wait',plan,startAt:state.t+plan.wait,
      dueAt:state.t+plan.wait+plan.flight,remaining:{...plan.dv1},fuelAtStart:ally.fuel,
      maxSpendKg:assessment.estimatedKg*assessment.margin,protectedKg:assessment.reserveKg};
    logEvent('AEGIS rescue: '+(activity==='deliver'?'approaching KESTREL-7':'collecting fuel')+'; ETA '+plan.eta.toFixed(0)+'s.','good');
    updateHud();return true;
  }
  function requestFuelHelp(){
    if(persistentFlight){
      if(!state.player.alive){logEvent('Destroyed ships cannot request rescue.','danger');return;}
      if(!flightOnline||!pilotLink?.requestAssistance('player'))logEvent('Fuel assistance needs a live server connection.','danger');
      else logEvent('Fuel assistance requested. A donor must approach and match velocity.','good');
      return;
    }
    if(state.ended)return;
    if(!state.ally.alive){logEvent('No friendly rescue craft available.','danger');return;}
    if(state.player.fuel>=state.player.fuelMax-.1){logEvent('Your tanks are already full.');return;}
    if(state.rescue){logEvent('AEGIS rescue request already active.');return;}
    const ally=state.ally;
    if(ally.fuel<rescueFuelFloor()+24){startRescueLeg('scavenge');return;}
    startRescueLeg('deliver');
  }
  function requestSelectedDonor(){
    if(!persistentFlight||!flightOnline){
      logEvent('A live flight server is required to choose a fuel donor.','danger');return;
    }
    if(!state.player.alive){logEvent('Destroyed ships cannot request fuel.','danger');return;}
    if(state.player.fuel>=state.player.fuelMax-.1){
      logEvent('Your propellant tank is already full.','danger');return;
    }
    const ally=navTarget(state.selectedNavKey);
    if(!ally?.isAlly||!ally.alive){
      logEvent('Select a living AEGIS spacecraft in Navigation before choosing your donor.','danger');return;
    }
    if(!pilotLink?.requestAssistance('player',ally.id)){
      logEvent('Could not send donor request to the flight server.','danger');return;
    }
    logEvent('Requested fuel FROM '+ally.name+' TO KESTREL-7. Awaiting server validation.','neutral');
  }
  function requestSelectedAllyAssistance(){
    if(!persistentFlight||!flightOnline){logEvent('Connected flight required for allied rescue orders.','danger');return;}
    const recipient=navTarget(state.selectedNavKey);
    if(!recipient?.isAlly||!recipient.alive){
      logEvent('Select a living ally in Navigation before requesting assistance.','danger');return;
    }
    if(!pilotLink?.requestAssistance(recipient.id)){
      logEvent('Could not transmit assistance order for '+recipient.name+'.','danger');return;
    }
    logEvent('Requested a fuel-rescue rendezvous for '+recipient.name+'.','neutral');
  }
  function donateFuelToAlly(){
    if(!persistentFlight||!flightOnline){logEvent('Live server is required for player donations.','danger');return;}
    if(!state.player.alive){logEvent('Destroyed ships cannot donate fuel.','danger');return;}
    const key=state.selectedNavKey;
    const target=navTarget(key);
    const ally=target?.isAlly?target:null;
    if(!ally?.alive){logEvent('Select a living friendly craft in Navigation before offering fuel.','danger');return;}
    const separation=magnitude(ally.x-state.player.x,ally.y-state.player.y);
    const relative=magnitude(ally.vx-state.player.vx,ally.vy-state.player.vy);
    if(separation>18||relative>=2.5){
      logEvent('Cannot transfer fuel: '+separation.toFixed(1)+' km separation, '+
        relative.toFixed(2)+' km/s relative; approach within 18 km and below 2.5 km/s.','danger');return;
    }
    if(!pilotLink?.offerFuel(ally.id,20))logEvent('Fuel transfer could not be sent.','danger');
    else logEvent('Fuel offer sent to '+ally.name+'; transfer needs ≤18 km and <2.5 km/s relative speed.');
  }
  function rescueStep(dt){
    const a=state.rescue,ally=state.ally;
    if(!a||!ally.alive)return null;
    const target=a.targetKey==='player'?state.player:state.pickups.find(p=>p.id===a.targetKey.slice(7)&&p.alive);
    if(!target){cancelRescue('AEGIS rescue target vanished.');return null;}
    if(ally.fuel<=a.protectedKg+.001){cancelRescue('AEGIS rescue stopped at protected fuel reserve.');return null;}
    if(state.t>a.dueAt+28){cancelRescue('AEGIS rescue transfer failed to converge; burn halted.');return null;}
    const range=magnitude(target.x-ally.x,target.y-ally.y);
    const relative=magnitude(target.vx-ally.vx,target.vy-ally.vy);
    if(range<18&&relative<3){
      if(a.activity==='deliver'){
        const kg=Math.max(0,Math.min(35,ally.fuel-rescueFuelFloor(),state.player.fuelMax-state.player.fuel));
        if(kg>0){ally.fuel-=kg;state.player.fuel+=kg;logEvent('AEGIS-01 transferred '+kg.toFixed(1)+' kg of propellant after rendezvous.','good');}
        else logEvent('AEGIS reached you, but has no surplus propellant.','danger');
        state.rescue=null;updateHud();
      }
      // Fuel pod capture is checked once the pod itself has advanced a physics step.
      return null;
    }
    if(a.phase==='wait'){if(state.t>=a.startAt)a.phase='burn1';else return null;}
    if(a.phase==='burn1'){
      if(magnitude(a.remaining.x,a.remaining.y)<.12){a.phase='coast';return null;}
      return unit(a.remaining.x,a.remaining.y);
    }
    if(a.phase==='coast'){
      const remaining=a.dueAt-state.t;
      const brakeEstimate=magnitude(a.plan.dv2.x,a.plan.dv2.y)/(ally.thrustN/mass(ally)/1000);
      if(remaining<Math.max(1.0,brakeEstimate*.7))a.phase='brake';else return null;
    }
    if(a.phase==='brake'){
      const dx=target.x-ally.x,dy=target.y-ally.y,dvx=target.vx-ally.vx,dvy=target.vy-ally.vy;
      const timeScale=clamp(magnitude(dx,dy)/Math.max(3,magnitude(dvx,dvy)),2,10);
      const correction={x:dvx+dx/timeScale,y:dvy+dy/timeScale};
      if(magnitude(correction.x,correction.y)<.35)return null;
      return unit(correction.x,correction.y);
    }
    return null;
  }

  function applyPlayerReserve(kg){
    if(!Number.isFinite(kg)||kg<0||kg>ENGINE.propellantKg)return;
    if(Math.abs(state.playerReserveKg-kg)<.000001)return;
    state.playerReserveKg=kg;
    localStorage.setItem(RESERVE_KEY,String(kg));
    state.navPlan=null;
    state.navFailure='';
    if(state.autopilot)abortNav('Protected fuel reserve changed; replan before engaging.');
    logEvent('Protected fuel reserve set to '+kg.toFixed(1)+' kg. Manual thrust remains unrestricted.','good');
    updateHud();
  }
  function requestReserveSetting(e){
    const kg=Number(e.detail?.kg);
    if(!Number.isFinite(kg)||kg<0||kg>ENGINE.propellantKg)return;
    if(persistentFlight){
      if(!flightOnline||!pilotLink?.setReserve(kg)){
        logEvent('Reserve preference not saved: connect to the flight server.','danger');
        updateHud();
      }
    }else applyPlayerReserve(kg);
  }
  function planNav(){
    if(state.ended)return null;
    const key=state.selectedNavKey,target=navTarget(key);
    if(!target){state.navPlan=null;logEvent('Select a valid target before planning.');return null;}
    if(key==='star'||key==='planet'){
      state.navPlan=null;state.navFailure='Interplanetary guidance is not yet supported. System map and manual flight are available.';
      logEvent(state.navFailure,'danger');updateHud();return null;
    }
    const reserve=state.playerReserveKg;
    const usableFuel=Math.max(0,state.player.fuel-reserve);
    let diagnostics=null;
    const plan=usableFuel>0?NAV.plan(state.player,target,{mu:WORLD.mu,inner:WORLD.crashRadius+7,outer:WORLD.outerRadius-10,
      massKg:mass(state.player),propellantKg:usableFuel,exhaustKmS,extended:true,
      minWaitSeconds:10,minFlightSeconds:25,
      onDiagnostics:report=>{diagnostics=report;}}):null;
    const safety=plan?SAFE.authorize({fuelKg:state.player.fuel,capacityKg:state.player.fuelMax,massKg:mass(state.player),dvKmS:plan.dv,exhaustKmS,reserve:reserve}):null;
    state.navPlan=plan&&safety.ok?{...plan,targetKey:key,calculatedAt:state.t,safety}:null;
    state.navFailure='';
    if(state.navPlan)logEvent('Conservative route: '+plan.dv.toFixed(2)+' km/s, '+plan.eta.toFixed(0)+' s; '+safety.reserveKg.toFixed(0)+' kg fuel protected.','good');
    else{
      const sense=state.player.x*state.player.vy-state.player.y*state.player.vx;
      const targetSense=target.x*target.vy-target.y*target.vx;
      const opposite=sense*targetSense<0;
      const prefix=opposite?'Counter-rotating encounter. ':'';
      if(diagnostics?.minimumDv!==null && diagnostics?.minimumDv!==undefined)
        state.navFailure=prefix+'Best sampled transfer '+diagnostics.minimumDv.toFixed(1)+' km/s; budget '+diagnostics.maxDv.toFixed(1)+' km/s.';
      else if(!usableFuel)
        state.navFailure='Fuel reserve leaves no propellant for autopilot.';
      else
        state.navFailure=prefix+'No safe two-burn solution in sampled windows. Try a different orbital phase.';
      logEvent(state.navFailure,'danger');
    }
    updateHud();return state.navPlan;
  }
  function abortNav(message='Autopilot disengaged.'){
    if(!state.autopilot)return;
    state.autopilot=null;state.autoDirection=null;state.autoBurnAllowed=false;
    logEvent(message);updateHud();
  }
  function engageNav(){
    if(persistentFlight&&!flightOnline){
      logEvent('Reconnect to the flight server before engaging autopilot.','danger');return;
    }
    if(!state.navOwned){logEvent('Buy the rendezvous computer to engage.');return;}
    const plan=state.navPlan&&state.navPlan.targetKey===$('nav-target').value&&state.t-state.navPlan.calculatedAt<1?state.navPlan:planNav();
    if(!plan)return;
    const safety=SAFE.authorize({fuelKg:state.player.fuel,capacityKg:state.player.fuelMax,massKg:mass(state.player),dvKmS:plan.dv,exhaustKmS,reserve:state.playerReserveKg});
    if(!safety.ok){state.navPlan=null;logEvent('Autopilot REFUSED: insufficient fuel for safe execution margin.','danger');updateHud();return;}
    state.autopilot={targetKey:plan.targetKey,plan,phase:'wait',startAt:state.t+plan.wait,
      dueAt:state.t+plan.wait+plan.flight,remaining:{...plan.dv1},spentAtStart:state.player.fuel,
      maxSpendKg:safety.estimatedKg*safety.margin,reserveKg:safety.reserveKg};
    state.down.clear();state.autoDirection=null;state.autoBurnAllowed=false;
    logEvent(persistentFlight?'Rendezvous guidance engaged · must remain connected.':'Rendezvous autopilot engaged.','good');updateHud();
  }
  function autopilotStep(dt){
    const a=state.autopilot;if(!a)return null;
    const isPickup=a.targetKey.startsWith('pickup:');
    const target=navTarget(a.targetKey);
    if(!target){
      if(isPickup&&a.phase==='tether')abortNav('Salvage contact cleared after grapple; guidance complete.');
      else abortNav('Navigation contact lost.');
      return null;
    }
    const ship=state.player,range=magnitude(ship.x-target.x,ship.y-target.y),relative=magnitude(ship.vx-(target.vx||0),ship.vy-(target.vy||0));
    const grappleActive=isPickup&&state.captureTether?.pickupId===target.id;
    if(grappleActive){
      if(a.phase!=='tether'){
        a.phase='tether';
        logEvent('Grapple attached; suspending maneuver burns until capture succeeds or the line releases.','good');
      }
      return null;
    }
    if(isPickup&&a.phase==='tether'){
      abortNav('Grapple released before recovery. Reduce relative speed, then replot the rendezvous.');
      return null;
    }
    if(!SAFE.burnAllowed(ship.fuel,ship.fuelMax,a.reserveKg)){abortNav('Autopilot aborted: protected reserve reached.');return null;}
    if(state.t>a.dueAt+28){abortNav('Autopilot aborted: interception deadline exceeded. No more blind correction burns.');return null;}
    if((a.targetKey.startsWith('enemy:')||a.targetKey==='ally'||a.targetKey.startsWith('ally:'))&&range<28&&relative<3){abortNav('Rendezvous range reached; hostile contact nearby!');return null;}
    if(a.targetKey==='waypoint'&&range<24){abortNav('Waypoint reached.');return null;}
    if(a.phase==='wait'){
      if(state.t>=a.startAt){a.phase='burn1';}
      else return null;
    }
    if(a.phase==='burn1'){
      const m=magnitude(a.remaining.x,a.remaining.y);
      if(m<.12){a.phase='coast';return null;}
      return unit(a.remaining.x,a.remaining.y);
    }
    if(a.phase==='coast'){
      // Burn 2 is a terminal relative-velocity match. Finite-burn correction is approximate.
      const remaining=a.dueAt-state.t;
      const brakeEstimate=magnitude(a.plan.dv2.x,a.plan.dv2.y)/(ship.thrustN/mass(ship)/1000);
      if(remaining<Math.max(.9,brakeEstimate*.7)) a.phase='brake';
      else return null;
    }
    if(a.phase==='brake'){
      const future=target.fixed?NAV.targetAt(target,0,WORLD.mu,WORLD.crashRadius,WORLD.outerRadius):target;
      const dx=future.x-ship.x,dy=future.y-ship.y;
      const dvx=future.vx-ship.vx,dvy=future.vy-ship.vy;
      const dist=magnitude(dx,dy);
      // For moving salvage the old <22 km / <3 km/s threshold was far too
      // generous for a finite-force tether (especially a 120 kg wreck).
      // Continue to actively match velocity before switching into capture
      // holding. The server's own tether safety envelope remains final.
      const captureReady=isPickup?dist<16&&magnitude(dvx,dvy)<(state.captureOwned?.5:.2):
        dist<22&&magnitude(dvx,dvy)<3;
      if(captureReady){
        if(a.targetKey.startsWith('enemy:')||a.targetKey==='waypoint'||a.targetKey==='ally'||
           a.targetKey.startsWith('ally:'))abortNav('Relative velocity matched near destination.');
        else {a.phase='holding';a.holdingAt=state.t;}
        return null;
      }
      // PD terminal controller corrects the finite-thrust departure and AI movement.
      const timeScale=clamp(dist/Math.max(3,magnitude(dvx,dvy)),2,10);
      const correction={x:dvx+dx/timeScale,y:dvy+dy/timeScale};
      if(magnitude(correction.x,correction.y)<.25)return null;
      return unit(correction.x,correction.y);
    }
    if(a.phase==='holding'){
      if(isPickup&&state.t-a.holdingAt>12)
        abortNav('No safe grapple attachment confirmed. Replot a closer, slower salvage approach.');
      else if(!isPickup&&state.t-a.holdingAt>6)
        abortNav('Capture window missed. Replot the route.');
      return null;
    }
    return null;
  }
  // Predict intercept by iterating a target's free orbital motion, the shooter's
  // existing velocity and approximate projectile gravity over a short flight.
  function leadAim(shooter, target) {
    const speed=WORLD.projectileSpeed;
    let t=magnitude(target.x-shooter.x,target.y-shooter.y)/speed;
    const g=accel(shooter.x,shooter.y);
    let direction=unit(target.x-shooter.x,target.y-shooter.y);
    for(let i=0;i<5;i++) {
      const predicted={x:target.x,y:target.y,vx:target.vx,vy:target.vy};
      const sub=Math.max(1,Math.ceil(t/.07)),d=t/sub;
      for(let j=0;j<sub;j++)stepBody(predicted,d);
      const dx=predicted.x-shooter.x-shooter.vx*t-.5*g.x*t*t;
      const dy=predicted.y-shooter.y-shooter.vy*t-.5*g.y*t*t;
      direction=unit(dx,dy);
      const required=magnitude(dx,dy);
      t=clamp(required/speed,.03,5);
    }
    return direction;
  }
  function shotDirection(shooter,target,isEnemy=false){
    if(!isEnemy && !shooter.isAlly && state.aimMode==='manual' && state.mouseTarget)return unit(state.mouseTarget.x-shooter.x,state.mouseTarget.y-shooter.y);
    if(target && target.alive)return (state.predictive||isEnemy||shooter.isAlly)?leadAim(shooter,target):unit(target.x-shooter.x,target.y-shooter.y);
    return unit(shooter.vx,shooter.vy);
  }
  function shoot(shooter,target,isEnemy=false) {
    if(!shooter.alive || shooter.gunCooldown>0)return;
    if(shooter.ammo<=0){if(shooter.isPlayer && state.t-(shooter.lastOutOfAmmo||0)>3){logEvent('Ammo depleted. Search for salvage.','danger');shooter.lastOutOfAmmo=state.t;}return;}
    let aim=shotDirection(shooter,target,isEnemy);
    if(isEnemy){const theta=rand(-.045,.045);const c=Math.cos(theta),s=Math.sin(theta);aim={x:aim.x*c-aim.y*s,y:aim.x*s+aim.y*c};}
    const gun= {x:shooter.x+aim.x*12, y:shooter.y+aim.y*12,
      vx:shooter.vx+WORLD.projectileSpeed*aim.x,vy:shooter.vy+WORLD.projectileSpeed*aim.y,
      faction:isEnemy?'raider':shooter.isAlly?'ally':'player',fromPlayer:shooter.isPlayer,alive:true};
    state.shots.push(gun);
    shooter.gunCooldown=isEnemy?rand(2.4,3.6):shooter.isAlly?rand(1.7,2.6):.27;
    if(!isEnemy){shooter.ammo--;shooter.shotCount++;}
    sparks(gun.x,gun.y, isEnemy?palette.red:palette.cyan,2);
  }
  function firePlayer(){if(!state.ended)shoot(state.player,aliveTarget());}
  function updateShotPreview(){
    const p=state.player,enemy=aliveTarget();
    if(!p.alive){state.ballistic=null;return;}
    const dir=shotDirection(p,enemy,false);
    const cursor=state.aimMode==='manual'&&state.mouseTarget?state.mouseTarget:(state.gimbalTarget||enemy||{x:p.x+dir.x*280,y:p.y+dir.y*280});
    state.ballistic=BALL.forecast(p,dir,cursor,state.trajectoryIntel?enemy:null,{
      mu:WORLD.mu,speed:WORLD.projectileSpeed,crashRadius:WORLD.crashRadius,horizonSec:12,dt:.015
    });
    state.lastBallistic=state.t;
  }
  function endGame(reason) {
    if(state.ended)return;
    if(persistentFlight){
      if(state.t-(state.lastLocalLoss??-100)>5)logEvent('Local combat loss (not yet persistent): '+reason,'danger');
      state.lastLocalLoss=state.t;
      state.player.hp=100;
      return;
    }
    state.ended=true;state.down.clear();
    $('game-over-details').textContent=`${reason} Survived ${formatTime(state.t)}. Raider kills: ${state.playerKills}.`;
    $('game-over').classList.remove('hidden');
    logEvent('MISSION FAILED: '+reason,'danger');
  }
  function orbitalElements(b){
    const r=magnitude(b.x,b.y),v2=b.vx*b.vx+b.vy*b.vy,h=b.x*b.vy-b.y*b.vx,eps=v2/2-WORLD.mu/r;
    const e=Math.sqrt(Math.max(0,1+2*eps*h*h/(WORLD.mu*WORLD.mu)));
    const rp=h*h/(WORLD.mu*(1+e));
    const ra=e<1? h*h/(WORLD.mu*(1-e)) : Infinity;
    const a=eps<0?-WORLD.mu/(2*eps):Infinity;
    const period=isFinite(a)?TWO_PI*Math.sqrt(a*a*a/WORLD.mu):Infinity;
    return {r,v:Math.sqrt(v2),e,rp,ra,period};
  }
  function computePrediction(){
    const b=state.player, ghost={x:b.x,y:b.y,vx:b.vx,vy:b.vy},out=[];
    let dangerous=false;
    for(let i=0;i<580;i++) {
      stepBody(ghost,.22);out.push({x:ghost.x,y:ghost.y});
      const r=magnitude(ghost.x,ghost.y);
      if(r<WORLD.crashRadius){dangerous=true;break;}
      if(r>1400) break;
    }
    state.predicted=out;state.dangerPrediction=dangerous;state.lastPrediction=state.t;
  }
  function formatTime(t){const sec=Math.floor(t);return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
  // During the Options API migration, Vue owns instrument text/state.
  // Direct DOM mutation is allowed only in the original standalone cockpit.
  function legacyNode(id){
    const node=$(id);
    return node && !node.closest('[data-vue-managed="true"]') ? node : null;
  }
  function setLegacyText(id,value){const node=legacyNode(id);if(node)node.textContent=value;}
  function setLegacyColor(id,value){const node=legacyNode(id);if(node)node.style.color=value;}
  function setLegacyDisabled(id,value){const node=legacyNode(id);if(node)node.disabled=value;}
  function updateHud() {
    const p=state.player;const e=orbitalElements(p);
    $('sim-clock').textContent=formatTime(state.t);
    setLegacyText('quick-alt',(e.r-WORLD.radius).toFixed(1)+' km');
    setLegacyText('quick-speed',e.v.toFixed(1)+' km/s');
    setLegacyText('quick-peri',Number.isFinite(e.rp)?Math.max(0,e.rp-WORLD.radius).toFixed(1)+' km':'—');
    setLegacyText('quick-apo',Number.isFinite(e.ra)?Math.max(0,e.ra-WORLD.radius).toFixed(1)+' km':'ESCAPE');
    setLegacyText('quick-reserve',state.playerReserveKg.toFixed(1)+' kg (autopilot & donations)');
    setLegacyText('quick-flight',state.autopilot?state.autopilot.phase.toUpperCase():state.rescue?'ALLY ASSIST':'FREE');
    if($('ship-panel') && $('ship-panel').dataset.vueManaged!=='true'){
      $('hull-value').textContent=Math.round(p.hp)+'%';$('hull-bar').style.width=clamp(p.hp,0,100)+'%';
      $('fuel-value').textContent=`${p.fuel.toFixed(1)} / ${p.fuelMax} kg`;$('fuel-bar').style.width=(100*p.fuel/p.fuelMax)+'%';
      $('repair-parts').textContent=p.repairParts.toFixed(1)+' / '+REPAIR.capacityKg+' kg';
      $('repair-btn').disabled=state.ended||p.hp>=100||p.repairParts<=.00001;
      $('repair-btn').textContent=state.down.has('repair')?'REPAIRING… (R)':'HOLD R · REPAIR';
      $('ammo-value').textContent=p.ammo;
      $('credits-value').innerHTML=p.credits+' <i>¤</i>';
      $('dv-value').textContent=(exhaustKmS*Math.log(mass(p)/(p.dryMass+p.repairParts))).toFixed(1)+' km/s';
    }
    setLegacyText('alt-value',(e.r-WORLD.radius).toFixed(1)+' km');
    setLegacyText('speed-value',e.v.toFixed(1)+' km/s');
    setLegacyText('peri-value',Number.isFinite(e.rp)?Math.max(0,e.rp-WORLD.radius).toFixed(1)+' km':'—');
    setLegacyText('apo-value',Number.isFinite(e.ra)?Math.max(0,e.ra-WORLD.radius).toFixed(1)+' km':'ESCAPE');
    setLegacyText('period-value',Number.isFinite(e.period)?e.period.toFixed(1)+' s':'UNBOUND');
    setLegacyText('path-status',state.dangerPrediction?'IMPACT':e.e>=1?'UNBOUND':'BOUND');
    setLegacyColor('path-status',state.dangerPrediction?palette.red:e.e>=1?palette.yellow:palette.green);
    const shipStatus=(state.ended||!p.alive)?'Spacecraft lost':state.repairing?'Repairing hull':state.autopilot?'Autopilot '+state.autopilot.phase:p.thrustVector?'Main engine firing':p.rcsFiring?'RCS firing':e.e>=1?'Escape trajectory':'Coasting (fuel conserved)';
    const shipStatusColor=(state.ended||!p.alive)?palette.red:p.thrustVector?palette.yellow:palette.green;
    if($('ship-panel') && $('ship-panel').dataset.vueManaged!=='true'){
      $('status-text').textContent=shipStatus;
      $('status-text').style.color=shipStatusColor;
    }
    const target=aliveTarget();
    setLegacyText('target-name',state.aimMode==='manual'?'MANUAL AIM':target?target.name:'NO CONTACT');
    setLegacyText('target-state',state.aimMode==='manual'?'FREE AIM':target?'HOSTILE':'SCANNING');
    setLegacyText('range-value',target?magnitude(target.x-p.x,target.y-p.y).toFixed(1)+' km':'—');
    setLegacyText('target-hull',target?Math.ceil(target.hp)+' / 66':'—');
    $('target-indicator').textContent=state.aimMode==='manual'?'AIM MODE: MANUAL':target?'TRACKING: '+target.name:'NO TARGET';
    const selected=selectedContact();
    const currentDistance=selected?magnitude(selected.x-p.x,selected.y-p.y):0;
    $('nav-selected-contact').textContent=selected?
      'NAV TARGET: '+selected.label+' · '+currentDistance.toFixed(1)+' km':'NAV TARGET: NONE';
    $('focus-target-btn').disabled=!selected;
    $('follow-target-btn').disabled=!selected;
    $('follow-target-btn').classList.toggle('selected',!!selected&&state.followTarget);
    $('follow-target-btn').setAttribute('aria-pressed',String(!!selected&&state.followTarget));
    const liveHostiles=state.enemies.filter(ship=>ship.alive).length;
    const activeAllies=(state.ally.alive?1:0)+(state.allies||[]).filter(ally=>ally.alive).length;
    $('mission-status').textContent=liveHostiles+' hostile'+(liveHostiles!==1?'s':'')+' · '+activeAllies+' active allies';
    $('sos-btn').disabled=state.ended||!p.alive||(persistentFlight&&!flightOnline)||(!persistentFlight&&!state.ally.alive);
    $('sos-btn').textContent=(state.rescue||state.serverAssistance?.some(o=>o.recipient==='player'))?'⚑ ASSISTANCE REQUESTED':'⚑ REQUEST FUEL ASSISTANCE';
    const ephemerisToggle=$('ephemeris-visibility-btn');
    ephemerisToggle.disabled=!state.ephemerisOwned;
    ephemerisToggle.textContent=state.ephemerisVisible?'◎ Ephemeris ON':'◎ Ephemeris OFF';
    ephemerisToggle.setAttribute('aria-pressed',String(state.ephemerisOwned&&state.ephemerisVisible));
    ephemerisToggle.classList.toggle('selected',state.ephemerisOwned&&state.ephemerisVisible);
    const selectedAlly=navTarget(state.selectedNavKey);
    const friendly=selectedAlly?.isAlly&&selectedAlly.alive?selectedAlly:null;
    const allyRange=friendly?magnitude(friendly.x-p.x,friendly.y-p.y):Infinity;
    const allyRelative=friendly?magnitude(friendly.vx-p.vx,friendly.vy-p.vy):Infinity;
    const alliance=(state.serverAssistance||[]).find(o=>o.recipient===friendly?.id);
    const playerOrder=(state.serverAssistance||[]).find(o=>o.recipient==='player');
    const otherOrder=(state.serverAssistance||[]).some(o=>
      friendly?.id&&(o.recipient===friendly.id||(o.donor===friendly.id&&o.recipient!=='player')));
    const arrivingPhases=['launch','course_burn','course_trim','approach','insertion_burn','insertion_trim'];
    const canRequestFromAlly=!!friendly&&persistentFlight&&flightOnline&&
      !state.ended&&p.alive&&p.fuel<p.fuelMax-.1&&
      friendly.fuel>55&&!arrivingPhases.includes(friendly.arrivalPhase)&&
      !otherOrder&&playerOrder?.donor!==friendly.id;
    const donorStatus=state.serverAssistance?.filter(o=>o.recipient==='player'||o.recipient===friendly?.id).map(o=>{
      const donor=[state.ally,...(state.allies||[])].find(a=>a.id===o.donor);
      return (o.recipient==='player'?'For you':friendly?.name||'Ally')+' · '+(donor?.name||'Awaiting donor')+
        (o.navigation?' · '+o.navigation.phase:' · rendezvous');
    }).join(' | ')||'No active fuel transfers';
    const canDonate=!!friendly&&persistentFlight&&flightOnline&&!state.ended&&p.alive&&
      allyRange<=18&&allyRelative<2.5&&p.fuel>state.playerReserveKg+.1&&
      friendly.fuel<friendly.fuelMax-.1;
    const canRequestForAlly=!!friendly&&persistentFlight&&flightOnline&&!state.ended&&
      p.alive&&friendly.fuel<friendly.fuelMax-.1&&!alliance;
    // Donation button is Vue-owned; its enabled state arrives via navigation events.
    // Reinforcements are now created by the guarded FastAPI dev endpoint only.
    if(document.querySelector('.upgrades') && document.querySelector('.upgrades').dataset.vueManaged!=='true'){
      $('upgrade-status').textContent=state.predictive?'Installed · lead shot active':'40 ¤';
      $('trajectory-upgrade-status').textContent=state.trajectoryIntel?'Installed · trajectory overlay active':'25 ¤';
      $('trajectory-upgrade-btn').textContent=state.trajectoryIntel?'OWNED':'BUY';
      $('trajectory-upgrade-btn').disabled=state.trajectoryIntel||p.credits<25||state.ended;
    }
    const fp=state.ballistic;
    setLegacyText('shot-time',!state.predictive?'Requires predictive fire control':
      fp&&fp.arrivalTime!==null?fp.arrivalTime.toFixed(2)+' s':
      fp&&fp.status==='planet'?'OBSTRUCTED':'OUT OF RANGE');
    setLegacyText('shot-miss',!state.trajectoryIntel?'Requires analyzer':fp&&fp.missKm!==null?fp.missKm.toFixed(1)+' km':'—');
    if(document.querySelector('.upgrades') && document.querySelector('.upgrades').dataset.vueManaged!=='true'){
      $('upgrade-btn').textContent=state.predictive?'OWNED':'BUY';
      $('upgrade-btn').disabled=state.predictive||p.credits<40||state.ended;
    }
    $('dry-mass').textContent=p.dryMass.toLocaleString()+' kg';
    $('total-mass').textContent=mass(p).toFixed(1)+' kg';
    $('main-thrust').textContent=(p.thrustN/1e6).toFixed(1)+' MN';
    $('mass-flow').textContent=p.flowKgS+' kg/s';
    $('exhaust-vel').textContent=exhaustKmS.toFixed(0)+' km/s';
    $('ship-heading').textContent=(p.heading*180/Math.PI).toFixed(0)+'°';
    $('spin-value').textContent=(p.omega*180/Math.PI).toFixed(1)+'°/s';
    if(document.querySelector('.upgrades') && document.querySelector('.upgrades').dataset.vueManaged!=='true'){
      $('nav-upgrade-status').textContent=state.navOwned?'Installed':'60 ¤';
      $('nav-upgrade-btn').textContent=state.navOwned?'OWNED':'BUY';
      $('nav-upgrade-btn').disabled=state.navOwned||p.credits<60||state.ended;
    }
    setLegacyText('autopilot-chip',state.navOwned?'ONLINE':'LOCKED');
    if(document.querySelector('.upgrades') && document.querySelector('.upgrades').dataset.vueManaged!=='true'&&$('ephemeris-upgrade-btn')){
      $('ephemeris-upgrade-status').textContent=state.ephemerisOwned?'Installed · orbit projection':'45 ¤';
      $('ephemeris-upgrade-btn').textContent=state.ephemerisOwned?'OWNED':'BUY';
      $('ephemeris-upgrade-btn').disabled=state.ephemerisOwned||p.credits<45||state.ended;
    }
    setLegacyText('nav-status',state.autopilot?state.autopilot.phase.toUpperCase():state.navPlan?'Route ready':'No plan');
    setLegacyText('nav-dv',state.navPlan?state.navPlan.dv.toFixed(2)+' km/s':'—');
    setLegacyText('nav-eta',state.navPlan?state.navPlan.eta.toFixed(0)+' s':'—');
    setLegacyText('nav-fuel',state.navPlan?SAFE.requiredFuel(mass(p),state.navPlan.dv,exhaustKmS).toFixed(1)+' kg (ideal)':'—');
    setLegacyText('nav-engage',state.navOwned?'ENGAGE':'BUY NAV 60¤');
    setLegacyDisabled('nav-engage',state.ended||!!state.autopilot||
      (persistentFlight&&!flightOnline)||(!state.navOwned&&p.credits<60));
    setLegacyDisabled('nav-abort',!state.autopilot);
    setLegacyText('nav-quick-status',state.autopilot?'AUTO · '+state.autopilot.phase.toUpperCase():state.navOwned?'COMPUTER ONLINE':'COMPUTER LOCKED');
    setLegacyText('nav-quick-metrics',state.navPlan?`${state.navPlan.dv.toFixed(2)} km/s Δv · ${state.navPlan.eta.toFixed(0)}s ETA · ${state.navPlan.safety.estimatedKg.toFixed(1)} kg ideal · ${state.navPlan.safety.reserveKg.toFixed(0)} kg reserved`: 'Pick a contact · press C to calculate');
    window.dispatchEvent(new CustomEvent('orbital-telemetry-state',{detail:{
      altitude:(e.r-WORLD.radius).toFixed(1)+' km',speed:e.v.toFixed(1)+' km/s',
      periapsis:Number.isFinite(e.rp)?Math.max(0,e.rp-WORLD.radius).toFixed(1)+' km':'—',
      apoapsis:Number.isFinite(e.ra)?Math.max(0,e.ra-WORLD.radius).toFixed(1)+' km':'ESCAPE',
      period:Number.isFinite(e.period)?e.period.toFixed(1)+' s':'UNBOUND',
      predicted:state.dangerPrediction?'IMPACT':e.e>=1?'UNBOUND':'BOUND',
      reserve:state.playerReserveKg.toFixed(1)+' kg (autopilot & donations)',
      flight:!p.alive?'LOST':state.autopilot?state.autopilot.phase.toUpperCase():state.serverAssistance?.some(o=>o.recipient==='player')?'ALLY ASSIST':'FREE'
    }}));
    window.dispatchEvent(new CustomEvent('orbital-targeting-state',{detail:{
      status:state.aimMode==='manual'?'FREE AIM':target?'HOSTILE':'SCANNING',
      name:state.aimMode==='manual'?'MANUAL AIM':target?target.name:'NO CONTACT',
      range:target?magnitude(target.x-p.x,target.y-p.y).toFixed(1)+' km':'—',
      hull:target?Math.ceil(target.hp)+' / 66':'—',
      shotTime:!state.predictive?'Requires predictive fire control':
        fp&&fp.arrivalTime!==null?fp.arrivalTime.toFixed(2)+' s':
        fp&&fp.status==='planet'?'OBSTRUCTED':'OUT OF RANGE',
      shotMiss:!state.trajectoryIntel?'Requires analyzer':fp&&fp.missKm!==null?fp.missKm.toFixed(1)+' km':'—'
    }}));
    window.dispatchEvent(new CustomEvent('orbital-navigation-state',{detail:{
      locked:!state.navOwned,phase:state.autopilot?.phase||'IDLE',reserveKg:state.playerReserveKg,
      focusDisabled:!selected,followTarget:!!selected&&state.followTarget,
      deltaV:state.navPlan?state.navPlan.dv.toFixed(2)+' km/s':'—',
      eta:state.navPlan?state.navPlan.eta.toFixed(0)+' s':'—',
      fuel:state.navPlan?SAFE.requiredFuel(mass(p),state.navPlan.dv,exhaustKmS).toFixed(1)+' kg (ideal)':'—',
      status:state.autopilot?state.autopilot.phase.toUpperCase():state.navPlan?'Route ready':state.navFailure||'No plan',
      quick:state.autopilot?'AUTO · '+state.autopilot.phase.toUpperCase():state.navOwned?'COMPUTER ONLINE':'COMPUTER LOCKED',
      metrics:state.navPlan?`${state.navPlan.dv.toFixed(2)} km/s Δv · ${state.navPlan.eta.toFixed(0)}s ETA · ${state.navPlan.safety.estimatedKg.toFixed(1)} kg ideal`:state.navFailure||'Pick a contact · press C to calculate',
      engageText:state.navOwned?'ENGAGE':'BUY NAV 60¤',
      engageDisabled:state.ended||!p.alive||!!state.autopilot||(persistentFlight&&!flightOnline)||(!state.navOwned&&p.credits<60),
      abortDisabled:!state.autopilot,donateDisabled:!canDonate,
      requestAllyDisabled:!canRequestForAlly,
      requestDonorDisabled:!canRequestFromAlly,
      requestDonorText:friendly?
        (playerOrder?'Switch your fuel donor to ':'Request fuel for KESTREL-7 from ')+friendly.name:
        'Select an AEGIS ally to request fuel',
      allyInfo:friendly?(friendly.name+' · '+friendly.fuel.toFixed(1)+' / '+friendly.fuelMax+
        ' kg fuel · '+allyRange.toFixed(1)+' km away · '+allyRelative.toFixed(2)+' km/s relative'):
        'Select a living friendly spacecraft in Navigation or click its icon on the map.',
      assistInfo:donorStatus,
      selected:state.selectedNavKey
    }}));
    window.dispatchEvent(new CustomEvent('orbital-cockpit-state',{detail:{
      ship:{
        hp:p.hp,fuel:p.fuel,fuelMax:p.fuelMax,repairParts:p.repairParts,repairCapacity:REPAIR.capacityKg,
        ammo:p.ammo,credits:p.credits,
        captureHeatMJ:p.captureHeatMJ||0,captureCapacityMJ:state.captureOwned?1300:520,
        cargoKg:p.cargoKg||0,
        captureTensionN:state.captureTether?.tensionN||0,
        captureStatus:state.captureTether?'REELING · '+state.captureTether.durationS.toFixed(1)+' s':'STANDBY',
        deltaV:exhaustKmS*Math.log(mass(p)/(p.dryMass+p.repairParts)),
        status:shipStatus,statusColor:shipStatusColor,followPlayer:!!state.followPlayer,
        repairDisabled:state.ended||p.hp>=100||p.repairParts<=.00001,
        repairing:state.down.has('repair')
      },
      market:{
        credits:p.credits,ended:state.ended||!p.alive,
        owned:{predictive:state.predictive,trajectory:state.trajectoryIntel,
          ephemeris:state.ephemerisOwned,nav:state.navOwned,capture:state.captureOwned}
      }
    }}));
  }
  function cameraOffset(){
    return state.systemView?STAR.planet(state.t):{x:0,y:0};
  }
  function centerCameraOn(target){
    const o=cameraOffset(),s=scale();
    state.panX=-(target.x+o.x)*s;
    state.panY=-(target.y+o.y)*s;
  }
  function showSystemMap(){
    state.systemView=true;
    try{localStorage.setItem(FRAME_KEY,'star');}catch{}
    const baseScale=Math.min(W/700,H/660);
    state.zoom=clamp(.65*Math.min(W,H)/(STAR.ORBIT_RADIUS_KM*baseScale),.0001,6);
    const planet=STAR.planet(state.t),s=scale();
    // Center the initial system view between its star and planet.
    state.panX=-planet.x*s/2;state.panY=-planet.y*s/2;
    state.followPlayer=false;state.followTarget=false;
    updateZoom();updateHud();
    logEvent('System map: VEYRA and orbiting KESTREL. Distances are in km.','good');
  }
  function showPlanetMap(){
    state.systemView=false;
    try{localStorage.setItem(FRAME_KEY,'planet');}catch{}state.followPlayer=false;state.followTarget=false;
    state.zoom=1;state.panX=0;state.panY=0;
    updateZoom();updateHud();
    logEvent('Returned to Kestrel planetary view.','good');
  }
  function focusSelectedTarget(follow=false){
    const target=selectedContact();
    if(!target){logEvent('Select a live navigation target before focusing the camera.');return;}
    if(target.kind==='star'){
      state.systemView=true;
      try{localStorage.setItem(FRAME_KEY,'star');}catch{}
      state.zoom=clamp(.65*Math.min(W,H)/(STAR.ORBIT_RADIUS_KM*Math.min(W/700,H/660)),.0001,6);
    }else if(target.kind==='planet'){
      state.systemView=false;state.zoom=1.8;
      try{localStorage.setItem(FRAME_KEY,'planet');}catch{}
    }else{
      state.zoom=clamp(Math.max(state.zoom,2.8),.0001,6);
    }
    state.followTarget=follow;state.followPlayer=false;
    centerCameraOn(target);updateZoom();
    logEvent((follow?'Camera following ':'Camera focused on ')+target.label+
      '. Ship flight and weapon lock unchanged.','good');
    updateHud();
  }
  function toggleFollowTarget(){
    if(state.followTarget){
      state.followTarget=false;
      logEvent('Camera follow disengaged.');updateHud();
    }else focusSelectedTarget(true);
  }
  function centerOnMyShip(){
    if(!state?.player)return;
    state.followTarget=false;state.followPlayer=true;
    state.zoom=clamp(Math.max(state.zoom,2.8),.35,6);
    centerCameraOn(state.player);
    updateZoom();
    logEvent('Camera centered on KESTREL-7 · tracking your spacecraft. Drag to release camera follow.','good');
    updateHud();
  }
  function updateMapScale(){
    if(!state)return;
    const tick=MAP.niceScale(scale());
    $('map-scale-label').textContent=tick.label;
    $('map-scale-bar').style.width=tick.pixels.toFixed(1)+'px';
  }
  function updateRulerUI(){
    const m=state.measurement;
    $('ruler-toggle').setAttribute('aria-pressed',String(m.enabled));
    $('ruler-toggle').classList.toggle('selected',m.enabled);
    $('ruler-clear').disabled=!m.start&&!m.end;
    const d=MAP.distance(m.start,m.end||m.hover);
    $('ruler-distance').textContent=!m.enabled?'Ruler off':
      !m.start?'Click first map point':d===null?'Click second map point':
      MAP.distanceLabel(d)+(m.end?'':' · preview');
  }
  function toggleRuler(){
    state.measurement.enabled=!state.measurement.enabled;
    state.measurement.hover=null;
    updateRulerUI();
  }
  function clearRuler(){
    state.measurement.start=null;state.measurement.end=null;state.measurement.hover=null;
    updateRulerUI();
  }
  function chooseRulerPoint(point){
    const m=state.measurement;
    if(!m.start||m.end){m.start={...point};m.end=null;}
    else m.end={...point};
    m.hover=null;
    updateRulerUI();
  }
  function updateZoom(){
    $('zoom-level').textContent=(state.zoom<.01?state.zoom.toExponential(2):state.zoom.toFixed(2))+'×';
    $('settings-frame-star').setAttribute('aria-pressed',String(!!state.systemView));
    $('settings-frame-planet').setAttribute('aria-pressed',String(!state.systemView));
    $('settings-show-axes').checked=!!state.showAxes;
    updateMapScale();
  }
  function zoomAt(factor,px=W/2,py=H/2){
    const world=fromScreen(px,py);
    state.zoom=clamp(state.zoom*factor,.0001,6);
    const offset=cameraOffset();
    state.panX=px-W/2-(world.x+offset.x)*scale();
    state.panY=py-H/2-(world.y+offset.y)*scale();
    updateZoom();
  }
  function fitCanvas(){
    const bounds=canvas.getBoundingClientRect();
    W=Math.max(200, bounds.width);H=Math.max(200,bounds.height);
    dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    starfield=[];
    for(let i=0;i<150;i++)starfield.push({x:Math.random()*W,y:Math.random()*H,size:rand(.3,1.3),alpha:rand(.12,.55)});
    updateMapScale();
  }
  function scale(){return Math.min(W/700,H/660)*state.zoom;}
  function toScreen(x,y){
    const s=scale(),offset=cameraOffset();
    return {x:W/2+state.panX+(x+offset.x)*s,y:H/2+state.panY+(y+offset.y)*s};
  }
  function fromScreen(x,y){
    const s=scale(),offset=cameraOffset();
    return {x:(x-W/2-state.panX)/s-offset.x,y:(y-H/2-state.panY)/s-offset.y};
  }
  const renderer=window.OrbitalRenderer.create({
    ctx,WORLD,ENGINE,palette,NAV,getState:()=>state,
    getViewport:()=>({W,H,dpr,starfield,encounterReady}),
    toScreen,scale,clamp,getSystem:()=>STAR,getEphemerisTarget:()=>navTarget(state.selectedNavKey),
    getSelectedContact:selectedContact
  });
  function draw(){
    if(state.followPlayer){
      centerCameraOn(state.player);
    }else if(state.followTarget){
      const target=selectedContact();
      if(target)centerCameraOn(target);
      else state.followTarget=false;
    }
    renderer.draw();
  }
  function frame(now){
    const realDelta=Math.min(Math.max((now-lastFrame)/1000,0),.06);
    lastFrame=now;
    if(state&&!state.ended&&encounterReady){
      accumulator+=realDelta;
      let steps=0;
      while(accumulator>=.015 && steps<22){step(.015);accumulator-=.015;steps++;if(state.ended)break;}
      if(steps>=22)accumulator=0;
      if(state.t-state.lastPrediction>.22)computePrediction();
      if(state.t-state.lastBallistic>.1)updateShotPreview();
    }
    if(now>nextHud){updateHud();nextHud=now+130;}
    draw();lastFrameId=requestAnimationFrame(frame);
  }

  const DEFAULT_KEYS=Object.freeze({main:'KeyW',left:'KeyA',right:'KeyD',stabilize:'KeyS',fire:'Space',repair:'KeyR',
    nextNav:'KeyN',planNav:'KeyC',engageNav:'KeyE',abortNav:'KeyX',sos:'KeyH',navConsole:'KeyV',telemetryConsole:'KeyT'});
  const KEY_LABELS={main:'Main engine',left:'Rotate counter-clockwise',right:'Rotate clockwise',stabilize:'Stop rotation',
    fire:'Fire weapon',repair:'Field repair',nextNav:'Next nav target',planNav:'Calculate transfer',
    engageNav:'Buy / engage autopilot',abortNav:'Abort autopilot',sos:'Request ally fuel',
    navConsole:'Show / hide navigation',telemetryConsole:'Show / hide telemetry'};
  function loadHotkeys(){
    try{
      const value=JSON.parse(localStorage.getItem('orbital-outlaws.hotkeys.v1')||'null');
      if(!value||typeof value!=='object')return {...DEFAULT_KEYS};
      const out={...DEFAULT_KEYS},used=new Set();
      for(const id of Object.keys(DEFAULT_KEYS)){
        const candidate=typeof value[id]==='string'?value[id]:DEFAULT_KEYS[id];
        if(!used.has(candidate)&&candidate!=='Escape'){out[id]=candidate;used.add(candidate);}
        else if(!used.has(DEFAULT_KEYS[id])){out[id]=DEFAULT_KEYS[id];used.add(DEFAULT_KEYS[id]);}
      }
      return out;
    }catch{return {...DEFAULT_KEYS};}
  }
  let hotkeys=loadHotkeys(),settingsOpen=false,capturingAction=null;
  function saveHotkeys(){try{localStorage.setItem('orbital-outlaws.hotkeys.v1',JSON.stringify(hotkeys));}catch{}updateHotkeyHints();}
  function actionForKey(code){
    const matched=Object.keys(hotkeys).find(k=>hotkeys[k]===code);
    return {main:'main',left:'rotate-left',right:'rotate-right',stabilize:'stabilize',fire:'fire',repair:'repair'}[matched]||null;
  }
  function commandForKey(code){return Object.keys(hotkeys).find(k=>hotkeys[k]===code&&!['main','left','right','stabilize','fire','repair'].includes(k))||null;}
  function keyLabel(code){if(code.startsWith('Key'))return code.slice(3);if(code.startsWith('Digit'))return code.slice(5);return {Space:'SPACE',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Backquote:'`',Minus:'-',Equal:'+'}[code]||code;}
  function updateHotkeyHints(){
    const controls={'main':'main','rotate-left':'left','rotate-right':'right','stabilize':'stabilize'};
    for(const [dataKey,key] of Object.entries(controls)){
      const hint=document.querySelector('[data-thrust="'+dataKey+'"] small');
      if(hint)hint.textContent=keyLabel(hotkeys[key]);
    }
    const firing=$('fire-btn')?.querySelector('small');if(firing)firing.textContent=keyLabel(hotkeys.fire);
    $('nav-plan').title='Calculate route ('+keyLabel(hotkeys.planNav)+')';
    $('nav-engage').title='Buy or engage ('+keyLabel(hotkeys.engageNav)+')';
    $('nav-next').title='Next navigation target ('+keyLabel(hotkeys.nextNav)+')';
    $('nav-abort').title='Abort ('+keyLabel(hotkeys.abortNav)+')';
    $('sos-btn').title='Request allied fuel assistance ('+keyLabel(hotkeys.sos)+')';
  }
  function renderHotkeys(){
    const list=$('hotkey-list');list.replaceChildren();
    for(const [id,description] of Object.entries(KEY_LABELS)){
      const entry=document.createElement('div');entry.className='hotkey-entry';
      const name=document.createElement('span');name.textContent=description;
      const button=document.createElement('button');button.type='button';button.textContent=capturingAction===id?'PRESS KEY…':keyLabel(hotkeys[id]);
      button.classList.toggle('capturing',capturingAction===id);
      button.addEventListener('click',()=>{capturingAction=id;renderHotkeys();$('hotkey-feedback').textContent='Press a new key for '+description+'. ESC cancels.';});
      entry.append(name,button);list.append(entry);
    }
  }
  function assignCapturedKey(code){
    if(code==='Escape'){capturingAction=null;$('hotkey-feedback').textContent='Key change cancelled.';renderHotkeys();return;}
    if(['ShiftLeft','ShiftRight','AltLeft','AltRight','ControlLeft','ControlRight','MetaLeft','MetaRight','Tab'].includes(code)){
      $('hotkey-feedback').textContent='Choose a non-modifier key.';return;
    }
    const conflict=Object.keys(hotkeys).find(k=>k!==capturingAction&&hotkeys[k]===code);
    if(conflict){$('hotkey-feedback').textContent=keyLabel(code)+' is already assigned to '+KEY_LABELS[conflict]+'. Choose another key.';return;}
    hotkeys[capturingAction]=code;saveHotkeys();capturingAction=null;
    $('hotkey-feedback').textContent='Saved: '+keyLabel(code);renderHotkeys();
  }
  function settingsTab(tab){
    const controls=tab==='controls';
    $('settings-controls-pane').classList.toggle('hidden',!controls);
    $('settings-frame-pane').classList.toggle('hidden',controls);
    $('settings-tab-controls').setAttribute('aria-selected',String(controls));
    $('settings-tab-frame').setAttribute('aria-selected',String(!controls));
    $('settings-tab-controls').classList.toggle('selected',controls);
    $('settings-tab-frame').classList.toggle('selected',!controls);
  }
  function openSettings(){
    settingsOpen=true;capturingAction=null;state.down.clear();
    $('settings-modal').classList.remove('hidden');
    settingsTab('controls');updateZoom();
    renderHotkeys();$('hotkey-feedback').textContent='';$('settings-close').focus();
  }
  function closeSettings(){settingsOpen=false;capturingAction=null;$('settings-modal').classList.add('hidden');$('settings-btn').focus();}
  function toggleConsole(which){
    const id=which==='nav'?'nav-command':'telemetry-console';
    if(window.OrbitalHUD?.togglePanelById){
      window.OrbitalHUD.togglePanelById(id);
      return;
    }
    const element=$(id),collapsed=element.classList.toggle('collapsed');
    $(which+'-toggle').setAttribute('aria-expanded',String(!collapsed));
    const arrow=$(which+'-toggle-arrow');
    if(arrow)arrow.textContent=collapsed?'▾':'▴';
  }

  function bindControls(){
    const manual=()=>{if(state.autopilot)abortNav('Manual pilot override.');};
    window.addEventListener('keydown',e=>{
      if(settingsOpen){
        if(capturingAction){e.preventDefault();assignCapturedKey(e.code);return;}
        if(e.code==='Escape'){e.preventDefault();closeSettings();}
        return;
      }
      if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
      const action=actionForKey(e.code);
      if(action){e.preventDefault();if(action!=='fire'&&action!=='repair')manual();state.down.add(action);document.querySelectorAll(`[data-thrust="${action}"]`).forEach(b=>b.classList.add('pressed'));if(action==='fire')$('fire-btn').classList.add('pressed');if(action==='repair')$('repair-btn').classList.add('pressed');}
      if(!e.repeat){
        const command=commandForKey(e.code);
        if(command){e.preventDefault();
          if(command==='nextNav')cycleNavigationTarget();
          if(command==='planNav')planNav();
          if(command==='engageNav')purchaseOrEngage();
          if(command==='abortNav')abortNav();
          if(command==='sos')requestFuelHelp();
          if(command==='navConsole')toggleConsole('nav');
          if(command==='telemetryConsole')toggleConsole('telemetry');
        }
      }
    });
    window.addEventListener('keyup',e=>{
      const action=actionForKey(e.code);if(action){e.preventDefault();state.down.delete(action);document.querySelectorAll(`[data-thrust="${action}"]`).forEach(b=>b.classList.remove('pressed'));if(action==='fire')$('fire-btn').classList.remove('pressed');if(action==='repair')$('repair-btn').classList.remove('pressed');}
    });
    window.addEventListener('blur',()=>{if(state){state.down.clear();state.pointerThrust=false;document.querySelectorAll('.pressed').forEach(b=>b.classList.remove('pressed'));}});
    function hold(button,action){
      button.addEventListener('pointerdown',e=>{if(state.ended)return;e.preventDefault();if(action!=='fire'&&action!=='repair')manual();state.down.add(action);button.classList.add('pressed');if(button.setPointerCapture)button.setPointerCapture(e.pointerId);});
      const stop=()=>{state.down.delete(action);button.classList.remove('pressed');};
      button.addEventListener('pointerup',stop);button.addEventListener('pointercancel',stop);button.addEventListener('lostpointercapture',stop);
    }
    document.querySelectorAll('[data-thrust]').forEach(b=>hold(b,b.dataset.thrust));hold($('fire-btn'),'fire');hold($('repair-btn'),'repair');
    $('reset-btn').addEventListener('click',reset);
    $('retry-btn')?.addEventListener('click',reset);
    $('ruler-toggle').addEventListener('click',toggleRuler);
    $('ruler-clear').addEventListener('click',clearRuler);
    $('orbit-btn').addEventListener('click',()=>{state.orbitVisible=!state.orbitVisible;$('orbit-btn').classList.toggle('selected',state.orbitVisible);$('orbit-btn').setAttribute('aria-pressed',String(state.orbitVisible));});
    $('zoom-in').addEventListener('click',()=>zoomAt(1.25));
    $('zoom-out').addEventListener('click',()=>zoomAt(1/1.25));
    $('focus-target-btn').addEventListener('click',()=>focusSelectedTarget(false));
    $('follow-target-btn').addEventListener('click',toggleFollowTarget);
    $('next-target').addEventListener('click',selectNextTarget);
    $('lock-btn').addEventListener('click',lockNearest);
    const technologies={
      predictive:{flag:'predictive',price:40,name:'Predictive fire control'},
      trajectory:{flag:'trajectoryIntel',price:25,name:'Target trajectory analyzer'},
      ephemeris:{flag:'ephemerisOwned',price:45,name:'Ephemeris computer'},
      nav:{flag:'navOwned',price:60,name:'Rendezvous computer'},
      capture:{flag:'captureOwned',price:55,name:'Salvage Capture Rig'}
    };
    function buyTechnology(key){
      const tech=technologies[key];
      if(!tech||state.ended||state[tech.flag])return;
      if(purchaseUpgrade(key))return;
      if(state.player.credits<tech.price)return;
      state.player.credits-=tech.price;
      state[tech.flag]=true;
      state.lastBallistic=-999;
      logEvent(tech.name+' installed.','good');
      updateHud();
    }
    window.addEventListener('orbital-market-purchase',e=>buyTechnology(e.detail?.upgrade));
    if(!document.querySelector('.upgrades[data-vue-managed="true"]')){
      for(const [key,id] of [
        ['predictive','upgrade-btn'],['trajectory','trajectory-upgrade-btn'],
        ['ephemeris','ephemeris-upgrade-btn'],['nav','nav-upgrade-btn'],['capture','capture-upgrade-btn']
      ])$(id)?.addEventListener('click',()=>buyTechnology(key));
    }
    // NPC reinforcement spawning is available only via the FastAPI development API.
    $('nav-plan').addEventListener('click',planNav);
    $('nav-engage').addEventListener('click',purchaseOrEngage);
    $('nav-next').addEventListener('click',cycleNavigationTarget);
    $('nav-abort').addEventListener('click',()=>abortNav());
    $('nav-target').addEventListener('change',()=>{state.selectedNavKey=$('nav-target').value;state.ephemerisCache=null;state.navPlan=null;updateHud();});
    $('nav-toggle').addEventListener('click',()=>toggleConsole('nav'));
    $('telemetry-toggle').addEventListener('click',()=>toggleConsole('telemetry'));
    $('sos-btn').addEventListener('click',requestFuelHelp);
    $('ephemeris-visibility-btn').addEventListener('click',()=>{
      if(!state.ephemerisOwned)return;
      state.ephemerisVisible=!state.ephemerisVisible;state.ephemerisCache=null;
      logEvent('Ephemeris trajectory '+(state.ephemerisVisible?'shown':'hidden')+'.');updateHud();
    });
    window.addEventListener('orbital-target-selected',e=>{
      const key=e.detail?.key;
      if(typeof key!=='string'||!navKeyExists(key))return;
      state.selectedNavKey=key;state.ephemerisCache=null;state.navPlan=null;updateHud();
    });
    window.addEventListener('orbital-request-ally-assistance',requestSelectedAllyAssistance);
    window.addEventListener('orbital-request-selected-donor',requestSelectedDonor);
    window.addEventListener('orbital-focus-target',()=>focusSelectedTarget(false));
    window.addEventListener('orbital-follow-target',toggleFollowTarget);
    window.addEventListener('orbital-center-ship',centerOnMyShip);
    window.addEventListener('orbital-offer-fuel',donateFuelToAlly);
    window.addEventListener('orbital-set-reserve',requestReserveSetting);
    $('settings-btn').addEventListener('click',openSettings);
    $('settings-tab-controls').addEventListener('click',()=>settingsTab('controls'));
    $('settings-tab-frame').addEventListener('click',()=>settingsTab('frame'));
    $('settings-frame-planet').addEventListener('click',showPlanetMap);
    $('settings-frame-star').addEventListener('click',showSystemMap);
    $('settings-show-axes').addEventListener('change',e=>{
      state.showAxes=e.target.checked;
      try{localStorage.setItem(AXES_KEY,String(state.showAxes));}catch{}
    });
    $('settings-close').addEventListener('click',closeSettings);
    $('settings-done').addEventListener('click',closeSettings);
    $('settings-modal').addEventListener('click',e=>{if(e.target===$('settings-modal'))closeSettings();});
    $('hotkey-reset').addEventListener('click',()=>{hotkeys={...DEFAULT_KEYS};capturingAction=null;saveHotkeys();renderHotkeys();$('hotkey-feedback').textContent='Defaults restored.';});
    let drag=null;
    const coords=e=>{const b=canvas.getBoundingClientRect();return {px:e.clientX-b.left,py:e.clientY-b.top};};
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('wheel',e=>{e.preventDefault();const pt=coords(e);zoomAt(Math.exp(-e.deltaY*.0016),pt.px,pt.py);},{passive:false});
    canvas.addEventListener('pointermove',e=>{
      const pt=coords(e);
      if(drag&&drag.id===e.pointerId){state.panX+=pt.px-drag.px;state.panY+=pt.py-drag.py;drag.px=pt.px;drag.py=pt.py;return;}
      if(state.measurement.enabled&&state.measurement.start&&!state.measurement.end){
        state.measurement.hover=fromScreen(pt.px,pt.py);updateRulerUI();return;
      }
      state.gimbalTarget=fromScreen(pt.px,pt.py);
      state.lastBallistic=-999;
      if(state.aimMode==='manual')state.mouseTarget=state.gimbalTarget;
    });
    canvas.addEventListener('pointerdown',e=>{
      const pt=coords(e),p=fromScreen(pt.px,pt.py);
      if(e.button===1||e.button===2||e.shiftKey){
        e.preventDefault();
        if(state.followTarget||state.followPlayer){
          state.followTarget=false;state.followPlayer=false;updateHud();
        }
        drag={id:e.pointerId,px:pt.px,py:pt.py};canvas.setPointerCapture(e.pointerId);return;
      }
      if(e.button!==0)return;
      if(state.measurement.enabled){
        e.preventDefault();chooseRulerPoint(p);return;
      }
      if(state.ended||!state.player.alive)return;
      if(e.altKey){state.waypoint={x:p.x,y:p.y};updateTargetOptions('waypoint');state.navPlan=null;logEvent('Waypoint plotted at '+p.x.toFixed(0)+', '+p.y.toFixed(0)+' km.');updateHud();return;}
      // Pick celestial bodies with a SCREEN-space hit radius at system scale.
      // Do not let a star-map click accidentally become a gun-aim command.
      if(state.systemView){
        const sun=STAR.star(state.t),sunPt=toScreen(sun.x,sun.y);
        const kestrelPt=toScreen(0,0);
        const nearSun=Math.hypot(pt.px-sunPt.x,pt.py-sunPt.y)<Math.max(20,STAR.STAR_RADIUS_KM*scale());
        const nearPlanet=Math.hypot(pt.px-kestrelPt.x,pt.py-kestrelPt.y)<16;
        if(nearSun||nearPlanet){
          updateTargetOptions(nearSun?'star':'planet');state.navPlan=null;
          logEvent((nearSun?'VEYRA':'KESTREL')+' selected in the system map.','good');
          updateHud();return;
        }
      }
      let candidate=null,dist=Infinity;
      for(const enemy of state.enemies)if(enemy.alive){const d=magnitude(p.x-enemy.x,p.y-enemy.y);if(d<Math.max(23,23/scale())&&d<dist){dist=d;candidate=enemy;}}
      if(candidate){state.targetId=candidate.id;state.aimMode='locked';state.lastBallistic=-999;state.navPlan=null;logEvent('Target lock: '+candidate.name);updateTargetOptions('enemy:'+candidate.id);updateHud();return;}
      let clickedAlly=null,clickedAllyDistance=Infinity;
      for(const ally of [state.ally,...(state.allies||[])])if(ally.alive){
        const d=magnitude(p.x-ally.x,p.y-ally.y);
        if(d<Math.max(23,23/scale())&&d<clickedAllyDistance){
          clickedAlly=ally;clickedAllyDistance=d;
        }
      }
      if(clickedAlly){
        updateTargetOptions(clickedAlly.id===state.ally.id?'ally':'ally:'+clickedAlly.id);
        state.navPlan=null;state.ephemerisVisible=true;state.ephemerisCache=null;
        logEvent(clickedAlly.name+' selected · '+(state.ephemerisOwned?'Ephemeris trajectory visible.':'Ephemeris computer not installed.'),'good');
        updateHud();return;
      }
      for(const pickup of state.pickups)if(pickup.alive){const d=magnitude(p.x-pickup.x,p.y-pickup.y);if(d<Math.max(17,19/scale())&&d<dist){dist=d;candidate=pickup;}}
      if(candidate&&candidate.type){updateTargetOptions('pickup:'+candidate.id);state.navPlan=null;logEvent('Navigation target selected: '+candidate.type+'.');updateHud();return;}
      e.preventDefault();state.aimMode='manual';state.mouseTarget=p;state.gimbalTarget=p;state.lastBallistic=-999;logEvent('Manual gun aim: curved shot path shown. Hold SPACE to fire.');updateHud();
    });
    function endPointer(e){if(drag&&drag.id===e.pointerId)drag=null;if(state.pointerThrust){state.pointerThrust=false;state.down.delete('main');}}
    canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);canvas.addEventListener('lostpointercapture',endPointer);
    window.addEventListener('resize',fitCanvas);
    if(typeof ResizeObserver!=='undefined'){const ro=new ResizeObserver(fitCanvas);ro.observe(canvas);}
    document.addEventListener('visibilitychange',()=>{
      lastFrame=performance.now();accumulator=0;
      if(document.hidden){state.down.clear();state.pointerThrust=false;
        if(state.autopilot)abortNav('Autopilot halted when cockpit tab became hidden.');
        
      }
    });
  }
  bindControls();updateHotkeyHints();reset();fitCanvas();
  if(storedFrame()==='star')showSystemMap();
  lastFrameId=requestAnimationFrame(frame);
  if(window.OrbitalPersistence){
    pilotLink=window.OrbitalPersistence.attach({
      controls:flightControls,
      onEncounter:checkpoint=>{restoreEncounter(checkpoint);encounterReady=true;},
      onState:result=>{
        const p=state.player;
        reconcileFlight(p,result.state,result.clientSampleMs||performance.now());
        if(!persistentFlight && Math.hypot(p.x,p.y)>850){
          // On a first connection, include the outer launch region in the viewport.
          state.zoom=.55;state.panX=-p.x*scale()*.55;state.panY=-p.y*scale()*.55;
          updateZoom();
        }
        state.lastPrediction=-999;
        state.lastBallistic=-999;
      },
      onProgress:progress=>{
        const previous={predictive:state.predictive,trajectoryIntel:state.trajectoryIntel,navOwned:state.navOwned,ephemerisOwned:state.ephemerisOwned,captureOwned:state.captureOwned};
        state.player.credits=progress.credits;
        if(typeof progress.reserve_kg==='number')applyPlayerReserve(progress.reserve_kg);
        state.predictive=Boolean(progress.upgrades.predictive);
        state.trajectoryIntel=Boolean(progress.upgrades.trajectory);
        state.navOwned=Boolean(progress.upgrades.nav);
        state.ephemerisOwned=Boolean(progress.upgrades.ephemeris);
        state.captureOwned=Boolean(progress.upgrades.capture);
        if(!previous.predictive&&state.predictive)logEvent('Predictive fire control installed persistently.','good');
        if(!previous.trajectoryIntel&&state.trajectoryIntel)logEvent('Trajectory analyzer installed persistently.','good');
        if(!previous.navOwned&&state.navOwned)logEvent('Rendezvous technology installed persistently.','good');
        if(!previous.ephemerisOwned&&state.ephemerisOwned)logEvent('Ephemeris computer installed · orbital predictions unlocked.','good');
        if(!previous.captureOwned&&state.captureOwned)logEvent('Salvage Capture Rig installed · capture tolerance now 8 km/s.','good');
        state.lastBallistic=-999;updateHud();
      },
      onAssistance:result=>{
        if(result?.status==='queued')logEvent(
          result.donor?'Server assigned '+result.donor+' to deliver fuel to '+result.recipient+'.':
            'Server accepted automatic assistance order for '+result.recipient+'.','good');
        else if(result?.transferred_kg!==undefined)
          logEvent('Transfer complete: '+result.transferred_kg.toFixed(1)+' kg sent to '+result.target+'.','good');
        updateHud();
      },
      onError:message=>{encounterReady=true;logEvent('Flight server: '+message.slice(0,110),'danger');},
      onConnected:online=>{
        flightOnline=online;
        if(online){
          persistentFlight=true;
          state.speed=1;
          $('reset-btn').textContent='⌖ Recenter view';
          $('reset-btn').title='Recenter map without resetting any persistent ships or combat.';
          state.autopilot=null;
          
          logEvent('Live sector connected; NPCs, combat and salvage now run on FastAPI.','good');
        }else{
          if(state.autopilot)abortNav('Connection lost; autopilot guidance halted.');
          // Keep the pilot read-only while offline: never silently switch to local authority.
          logEvent('Flight server disconnected. Inputs suspended; orbit will resume from server.','danger');
        }
        window.dispatchEvent(new CustomEvent('orbital-persistence',{detail:{online}}));
      }
    });
  }
})();
