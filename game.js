/**
 * ORBITAL OUTLAWS 0.6
 * One central body, Newtonian inverse-square gravity, kick-drift-kick (velocity Verlet).
 * World distances and seconds are intentionally game-scaled to keep orbits playable.
 * All ships, floating salvage and ballistic projectiles share the same gravity solver.
 * No propulsion is needed to remain in a stable orbit.
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
  if(!NAV||!BALL||!COLL||!SAFE||!ARRIVAL)throw new Error('Simulation modules missing');
  // 1 world distance unit = 1 km; velocities in km/s. Engines are futuristic.
  const ENGINE=Object.freeze({dryKg:900,propellantKg:200,thrustN:1600000,flowKgS:5,rcsN:2500,rcsFlowKgS:.04,leverM:7,shipLengthM:14,gimbalMax:28*Math.PI/180});
  const exhaustKmS=ENGINE.thrustN/ENGINE.flowKgS/1000;
  const REPAIR=Object.freeze({starterKg:10,capacityKg:24,hpPerKg:5,rateHpS:5});

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
      state.panX=0;state.panY=0;state.zoom=1;updateZoom();
      logEvent('View recentered; live encounter and pilot remain unchanged.','good');
      return;
    }
    const oldPilot = persistentFlight && state ? state.player : null;
    const oldTech = persistentFlight && state ? {predictive:state.predictive,trajectoryIntel:state.trajectoryIntel,navOwned:state.navOwned,ephemerisOwned:state.ephemerisOwned} : null;
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
    orbitVisible:true, predictive:false, trajectoryIntel:false, ephemerisOwned:false, ballistic:null, lastBallistic:-999, reinforcements:false, navOwned:false, navPlan:null, autopilot:null, rescue:null, waypoint:null, panX:0,panY:0, pointerThrust:false, repairing:false, ended:false, speed:1, nextEnemySpawn:75,
    collisionCooldown:new Map(), playerKills:0, recordSurvival:0, predicted:[], lastPrediction:-999, dangerPrediction:false};
    if(oldTech){Object.assign(state,oldTech);player.credits=oldPilot.credits;}
    // Seeded salvage keeps one stable claim ID across encounter resets.
    state.pickups.filter(p=>p.type==='credits').forEach((pod,i)=>pod.id='starter-credits-'+i);
    lastFrame = performance.now(); accumulator=0;
    document.querySelectorAll('[data-thrust]').forEach(btn=>btn.classList.remove('pressed'));
    $('fire-btn').classList.remove('pressed');
    $('repair-btn').classList.remove('pressed');
    $('game-over').classList.add('hidden');
 
    $('orbit-btn').classList.add('selected');$('orbit-btn').setAttribute('aria-pressed','true');
    updateZoom();
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
    const previous=state.enemies.map(e=>e.id+':'+e.alive).join(',');
    state.enemies=mergeLiveBodies(state.enemies,saved.enemies);
    state.ally=mergeLiveBodies([state.ally],[saved.ally])[0];
    state.allies=mergeLiveBodies(state.allies||[],saved.allies||[]);
    state.pickups=mergeLiveBodies(state.pickups,saved.pickups);
    state.shots=mergeLiveBodies(state.shots,(saved.shots||[]).map((shot,i)=>({id:shot.id||'shot-'+i,...shot})));
    state.t=Math.max(state.t,saved.t||0);
    state.reinforcements=!!saved.reinforcements;
    state.nextEnemySpawn=saved.nextEnemySpawn||state.t+60;
    state.playerKills=saved.playerKills||0;
    if(saved.player){
      const p=state.player,info=saved.player;
      p.hp=info.hp;p.ammo=info.ammo;p.repairParts=info.repairParts;p.alive=info.alive;
      if(!p.alive){
        if(state.autopilot)abortNav('Spacecraft destroyed; guidance terminated.');
        state.down.clear();
        $('game-over-details').textContent='Your ship was destroyed in the persistent sector. Reset your development pilot to respawn.';
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
    if(previous!==state.enemies.map(e=>e.id+':'+e.alive).join(','))updateTargetOptions();
    state.lastPrediction=-999;state.lastBallistic=-999;
    updateHud();
  }
  function renderServerBodies(dt){
    for(const body of [state.ally,...(state.allies||[]),...state.enemies,...state.pickups,...state.shots]){
      if(!body?.alive)continue;
      stepBody(body,dt);
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

  function accel(x,y) {
    const r2 = Math.max(x*x+y*y, 10);
    const f = -WORLD.mu / (r2 * Math.sqrt(r2));
    return {x:x*f,y:y*f};
  }
  function stepBody(body, dt, extra=null) {
    const a = accel(body.x,body.y);
    const ax = a.x + (extra?.x || 0), ay = a.y + (extra?.y || 0);
    const halfVx = body.vx + .5*dt*ax, halfVy = body.vy + .5*dt*ay;
    body.x += halfVx*dt; body.y += halfVy*dt;
    const a2 = accel(body.x,body.y);
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
      const angle=normAngle(Math.atan2(wanted.y,wanted.x)-p.heading);
      const alpha=2*ENGINE.rcsN*ENGINE.leverM/(mass(p)*ENGINE.shipLengthM**2/12);
      const error=clamp(2.7*angle,-1.9,1.9)-p.omega;
      const turn=Math.abs(error)<alpha*.05*.4?0:Math.sign(error);
      return {thrust:!!state.autoBurnAllowed&&p.fuel>state.autopilot.reserveKg,
        turn,stabilize:false,gimbal:clamp(angle,-ENGINE.gimbalMax,ENGINE.gimbalMax),...weapons};
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
    if(!persistentFlight||!flightOnline||!reference||Math.abs(reference.ms-atMs)>500){
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
    const difference=normAngle(Math.atan2(wanted.y,wanted.x)-ship.heading);
    const maxAlpha=(2*ENGINE.rcsN*ENGINE.leverM)/(mass(ship)*ENGINE.shipLengthM**2/12);
    const omegaTarget=clamp(2.7*difference,-1.9,1.9);
    const error=omegaTarget-ship.omega;
    const command=Math.abs(error)<maxAlpha*dt*.4?'idle':error<0?'rotate-left':'rotate-right';
    rcsControl(ship,dt,command,minReserve);
    ship.gimbal=clamp(normAngle(Math.atan2(wanted.y,wanted.x)-ship.heading),-ENGINE.gimbalMax,ENGINE.gimbalMax);
    return Math.abs(normAngle(Math.atan2(wanted.y,wanted.x)-ship.heading))<.13 && Math.abs(ship.omega)<.35;
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
      if(magnitude(p.x-player.x,p.y-player.y)<19 && magnitude(p.vx-player.vx,p.vy-player.vy)<5) collect(p);
      if(p.alive&&state.rescue?.activity==='scavenge'&&state.rescue.targetKey==='pickup:'+p.id&&state.ally.alive&&
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
  function collect(pod) {
    pod.alive=false;
    const p=state.player;
    if(pod.type==='fuel') {
      if(persistentFlight) logEvent('Fuel salvage is not yet persistent.','danger');
      else {p.fuel=Math.min(p.fuelMax,p.fuel+pod.amount);logEvent('Recovered '+pod.amount+' kg propellant.','good');}
    }
    if(pod.type==='ammo') {p.ammo+=pod.amount;logEvent('Recovered '+pod.amount+' ballistic rounds.','good');}
    if(pod.type==='credits'){p.credits+=pod.amount;logEvent('Recovered '+pod.amount+' salvage credits.','good');}
    if(pod.type==='parts') {const received=Math.min(pod.amount,REPAIR.capacityKg-p.repairParts);p.repairParts+=received;logEvent(received>0?'Recovered '+received.toFixed(1)+' kg repair materials.':'Repair storage already full.','good');}
    if(pod.type==='wreck') {
      p.credits+=50;p.fuel=Math.min(p.fuelMax,p.fuel+25);
      p.ammo+=12;
      const parts=Math.min(6,REPAIR.capacityKg-p.repairParts);p.repairParts+=parts;
      logEvent('Wreck salvaged. Ammo/repair parts are still local.','good');
    }
    if(state.autopilot?.targetKey==='pickup:'+pod.id){state.autopilot=null;state.navPlan=null;logEvent('Rendezvous complete. Salvage secured!','good');}
    sparks(pod.x,pod.y,palette.green,12);updateTargetOptions();
    
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
    if(key==='waypoint')return !!state.waypoint;
    if(key?.startsWith('pickup:'))return state.pickups.some(p=>p.id===key.slice(7)&&p.alive);
    if(key?.startsWith('enemy:'))return state.enemies.some(p=>p.id===key.slice(6)&&p.alive);
    if(key==='ally')return state.ally.alive;
    return false;
  }
  function navTarget(key){
    if(key==='waypoint'&&state.waypoint)return {...state.waypoint,fixed:true,orbitSign:state.player.x*state.player.vy-state.player.y*state.player.vx>=0?1:-1};
    if(key?.startsWith('pickup:'))return state.pickups.find(p=>p.id===key.slice(7)&&p.alive)||null;
    if(key?.startsWith('enemy:'))return state.enemies.find(p=>p.id===key.slice(6)&&p.alive)||null;
    if(key==='ally'&&state.ally.alive)return state.ally;
    return null;
  }
  function updateTargetOptions(preferred){
    const select=$('nav-target');const previous=preferred||select.value;
    const entries=[...state.pickups.filter(p=>p.alive).map(p=>({key:'pickup:'+p.id,text:(p.type==='wreck'?'Wreck':'Salvage '+p.type)+' · '+p.id.slice(-4)})),
      ...state.enemies.filter(e=>e.alive).map(e=>({key:'enemy:'+e.id,text:e.name+' · hostile'})),
      ...(state.ally.alive?[{key:'ally',text:'AEGIS-01 · friendly escort'}]:[])];
    if(state.waypoint)entries.unshift({key:'waypoint',text:'Map waypoint (fixed location)'});
    select.replaceChildren();
    for(const item of entries){const o=document.createElement('option');o.value=item.key;o.textContent=item.text;select.append(o);}
    if(entries.some(item=>item.key===previous))select.value=previous;
  }
  function cycleNavigationTarget(){
    const select=$('nav-target');
    if(select.options.length<2)return;
    select.selectedIndex=(select.selectedIndex+1)%select.options.length;
    state.navPlan=null;
    const key=select.value;
    if(key.startsWith('enemy:')){state.targetId=key.slice(6);state.aimMode='locked';state.lastBallistic=-999;}
    logEvent('Navigation target: '+select.selectedOptions[0].textContent);
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
    if(persistentFlight){logEvent('Server fuel transfers not implemented yet.','danger');return;}
    if(state.ended)return;
    if(!state.ally.alive){logEvent('No friendly rescue craft available.','danger');return;}
    if(state.player.fuel>=state.player.fuelMax-.1){logEvent('Your tanks are already full.');return;}
    if(state.rescue){logEvent('AEGIS rescue request already active.');return;}
    const ally=state.ally;
    if(ally.fuel<rescueFuelFloor()+24){startRescueLeg('scavenge');return;}
    startRescueLeg('deliver');
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
      if(magnitude(correction.x,correction.y)<.25)return null;
      return unit(correction.x,correction.y);
    }
    return null;
  }

  function planNav(){
    if(state.ended)return null;
    const key=$('nav-target').value,target=navTarget(key);
    if(!target){state.navPlan=null;logEvent('Select a valid target before planning.');return null;}
    const reserve=SAFE.reserveKg(state.player.fuelMax);
    const usableFuel=Math.max(0,state.player.fuel-reserve);
    const plan=usableFuel>0?NAV.plan(state.player,target,{mu:WORLD.mu,inner:WORLD.crashRadius+7,outer:WORLD.outerRadius-10,
      massKg:mass(state.player),propellantKg:usableFuel,exhaustKmS,extended:true}):null;
    const safety=plan?SAFE.authorize({fuelKg:state.player.fuel,capacityKg:state.player.fuelMax,massKg:mass(state.player),dvKmS:plan.dv,exhaustKmS}):null;
    state.navPlan=plan&&safety.ok?{...plan,targetKey:key,calculatedAt:state.t,safety}:null;
    if(state.navPlan)logEvent('Conservative route: '+plan.dv.toFixed(2)+' km/s, '+plan.eta.toFixed(0)+' s; '+safety.reserveKg.toFixed(0)+' kg fuel protected.','good');
    else logEvent('No route within safety budget. Manual flight or later replan required.','danger');
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
    const safety=SAFE.authorize({fuelKg:state.player.fuel,capacityKg:state.player.fuelMax,massKg:mass(state.player),dvKmS:plan.dv,exhaustKmS});
    if(!safety.ok){state.navPlan=null;logEvent('Autopilot REFUSED: insufficient fuel for safe execution margin.','danger');updateHud();return;}
    state.autopilot={targetKey:plan.targetKey,plan,phase:'wait',startAt:state.t+plan.wait,
      dueAt:state.t+plan.wait+plan.flight,remaining:{...plan.dv1},spentAtStart:state.player.fuel,
      maxSpendKg:safety.estimatedKg*safety.margin,reserveKg:safety.reserveKg};
    state.down.clear();state.autoDirection=null;state.autoBurnAllowed=false;
    logEvent(persistentFlight?'Rendezvous guidance engaged · must remain connected.':'Rendezvous autopilot engaged.','good');updateHud();
  }
  function autopilotStep(dt){
    const a=state.autopilot;if(!a)return null;
    const target=navTarget(a.targetKey);
    if(!target){abortNav('Navigation contact lost.');return null;}
    const ship=state.player,range=magnitude(ship.x-target.x,ship.y-target.y),relative=magnitude(ship.vx-(target.vx||0),ship.vy-(target.vy||0));
    if(!SAFE.burnAllowed(ship.fuel,ship.fuelMax,a.reserveKg)){abortNav('Autopilot aborted: protected reserve reached.');return null;}
    if(state.t>a.dueAt+28){abortNav('Autopilot aborted: interception deadline exceeded. No more blind correction burns.');return null;}
    if((a.targetKey.startsWith('enemy:')||a.targetKey==='ally')&&range<28&&relative<3){abortNav('Rendezvous range reached; hostile contact nearby!');return null;}
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
      if(dist<22&&magnitude(dvx,dvy)<3){
        if(a.targetKey.startsWith('enemy:')||a.targetKey==='waypoint'||a.targetKey==='ally')abortNav('Relative velocity matched near destination.');
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
      if(state.t-a.holdingAt>6)abortNav('Capture window missed. Replot the route.');
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
  function updateHud() {
    const p=state.player;const e=orbitalElements(p);
    $('sim-clock').textContent=formatTime(state.t);
    $('quick-alt').textContent=(e.r-WORLD.radius).toFixed(1)+' km';
    $('quick-speed').textContent=e.v.toFixed(1)+' km/s';
    $('quick-peri').textContent=Number.isFinite(e.rp)?Math.max(0,e.rp-WORLD.radius).toFixed(1)+' km':'—';
    $('quick-apo').textContent=Number.isFinite(e.ra)?Math.max(0,e.ra-WORLD.radius).toFixed(1)+' km':'ESCAPE';
    $('quick-reserve').textContent=SAFE.reserveKg(p.fuelMax).toFixed(0)+' kg (autopilot)';
    $('quick-flight').textContent=state.autopilot?state.autopilot.phase.toUpperCase():state.rescue?'ALLY ASSIST':'FREE';
    $('hull-value').textContent=Math.round(p.hp)+'%';$('hull-bar').style.width=clamp(p.hp,0,100)+'%';
    $('fuel-value').textContent=`${p.fuel.toFixed(1)} / ${p.fuelMax} kg`;$('fuel-bar').style.width=(100*p.fuel/p.fuelMax)+'%';
    $('repair-parts').textContent=p.repairParts.toFixed(1)+' / '+REPAIR.capacityKg+' kg';
    $('repair-btn').disabled=state.ended||p.hp>=100||p.repairParts<=.00001;
    $('repair-btn').textContent=state.down.has('repair')?'REPAIRING… (R)':'HOLD R · REPAIR';
    $('ammo-value').textContent=p.ammo;
    $('credits-value').innerHTML=p.credits+' <i>¤</i>';
    $('dv-value').textContent=(exhaustKmS*Math.log(mass(p)/(p.dryMass+p.repairParts))).toFixed(1)+' km/s';
    $('alt-value').textContent=(e.r-WORLD.radius).toFixed(1)+' km';
    $('speed-value').textContent=e.v.toFixed(1)+' km/s';
    $('peri-value').textContent=Number.isFinite(e.rp)?Math.max(0,e.rp-WORLD.radius).toFixed(1)+' km':'—';
    $('apo-value').textContent=Number.isFinite(e.ra)?Math.max(0,e.ra-WORLD.radius).toFixed(1)+' km':'ESCAPE';
    $('period-value').textContent=Number.isFinite(e.period)?e.period.toFixed(1)+' s':'UNBOUND';
    $('path-status').textContent=state.dangerPrediction?'IMPACT':e.e>=1?'UNBOUND':'BOUND';
    $('path-status').style.color=state.dangerPrediction?palette.red:e.e>=1?palette.yellow:palette.green;
    $('status-text').textContent=state.ended?'Spacecraft lost':state.repairing?'Repairing hull':state.autopilot?'Autopilot '+state.autopilot.phase:p.thrustVector?'Main engine firing':p.rcsFiring?'RCS firing':e.e>=1?'Escape trajectory':'Coasting (fuel conserved)';
    $('status-text').style.color=state.ended?palette.red:p.thrustVector?palette.yellow:palette.green;
    const target=aliveTarget();
    $('target-name').textContent=state.aimMode==='manual'?'MANUAL AIM':target?target.name:'NO CONTACT';
    $('target-state').textContent=state.aimMode==='manual'?'FREE AIM':target?'HOSTILE':'SCANNING';
    $('range-value').textContent=target?magnitude(target.x-p.x,target.y-p.y).toFixed(1)+' km':'—';
    $('target-hull').textContent=target?Math.ceil(target.hp)+' / 66':'—';
    $('target-indicator').textContent=state.aimMode==='manual'?'AIM MODE: MANUAL':target?'TRACKING: '+target.name:'NO TARGET';
    const liveHostiles=state.enemies.filter(ship=>ship.alive).length;
    const activeAllies=(state.ally.alive?1:0)+(state.allies||[]).filter(ally=>ally.alive).length;
    $('mission-status').textContent=liveHostiles+' hostile'+(liveHostiles!==1?'s':'')+' · '+activeAllies+' active allies';
    $('escort-status').textContent=state.ally.alive?'ONLINE':'LOST';
    $('escort-status').style.color=state.ally.alive?palette.green:palette.red;
    $('escort-hull').textContent=state.ally.alive?Math.ceil(state.ally.hp)+' / 80':'DESTROYED';
    $('escort-ammo').textContent=state.ally.alive?String(state.ally.ammo):'—';
    $('escort-fuel').textContent=state.ally.alive?state.ally.fuel.toFixed(1)+' kg':'—';
    $('escort-state').textContent=!state.ally.alive?'ESCORT LOST':state.rescue?'RESCUE: '+state.rescue.activity.toUpperCase()+' / '+state.rescue.phase.toUpperCase():(liveHostiles?'ENGAGING HOSTILES':'HOLDING ORBIT');
    $('sos-btn').disabled=persistentFlight||state.ended||!state.ally.alive;
    $('sos-btn').textContent=state.rescue?'⚑ ASSISTANCE REQUESTED':'⚑ REQUEST FUEL ASSISTANCE';
    $('escort-help-btn').disabled=persistentFlight||state.ended||!state.ally.alive;
    // Reinforcements are now created by the guarded FastAPI dev endpoint only.
    $('upgrade-status').textContent=state.predictive?'Installed · lead shot active':'40 ¤';
    $('trajectory-upgrade-status').textContent=state.trajectoryIntel?'Installed · trajectory overlay active':'25 ¤';
    $('trajectory-upgrade-btn').textContent=state.trajectoryIntel?'OWNED':'BUY';
    $('trajectory-upgrade-btn').disabled=state.trajectoryIntel||p.credits<25||state.ended;
    const fp=state.ballistic;
    $('shot-time').textContent=fp&&fp.arrivalTime!==null?fp.arrivalTime.toFixed(2)+' s':fp&&fp.status==='planet'?'OBSTRUCTED':'OUT OF RANGE';
    $('shot-miss').textContent=!state.trajectoryIntel?'Requires analyzer':fp&&fp.missKm!==null?fp.missKm.toFixed(1)+' km':'—';
    $('upgrade-btn').textContent=state.predictive?'OWNED':'BUY';
    $('upgrade-btn').disabled=state.predictive||p.credits<40||state.ended;
    $('dry-mass').textContent=p.dryMass.toLocaleString()+' kg';
    $('total-mass').textContent=mass(p).toFixed(1)+' kg';
    $('main-thrust').textContent=(p.thrustN/1e6).toFixed(1)+' MN';
    $('mass-flow').textContent=p.flowKgS+' kg/s';
    $('exhaust-vel').textContent=exhaustKmS.toFixed(0)+' km/s';
    $('ship-heading').textContent=(p.heading*180/Math.PI).toFixed(0)+'°';
    $('spin-value').textContent=(p.omega*180/Math.PI).toFixed(1)+'°/s';
    $('nav-upgrade-status').textContent=state.navOwned?'Installed':'60 ¤';
    $('nav-upgrade-btn').textContent=state.navOwned?'OWNED':'BUY';
    $('nav-upgrade-btn').disabled=state.navOwned||p.credits<60||state.ended;
    $('autopilot-chip').textContent=state.navOwned?'ONLINE':'LOCKED';
    if($('ephemeris-upgrade-btn')){
      $('ephemeris-upgrade-status').textContent=state.ephemerisOwned?'Installed · orbit projection':'45 ¤';
      $('ephemeris-upgrade-btn').textContent=state.ephemerisOwned?'OWNED':'BUY';
      $('ephemeris-upgrade-btn').disabled=state.ephemerisOwned||p.credits<45||state.ended;
    }
    $('nav-status').textContent=state.autopilot?state.autopilot.phase.toUpperCase():state.navPlan?'Route ready':'No plan';
    $('nav-dv').textContent=state.navPlan?state.navPlan.dv.toFixed(2)+' km/s':'—';
    $('nav-eta').textContent=state.navPlan?state.navPlan.eta.toFixed(0)+' s':'—';
    $('nav-fuel').textContent=state.navPlan?SAFE.requiredFuel(mass(p),state.navPlan.dv,exhaustKmS).toFixed(1)+' kg (ideal)':'—';
    $('nav-engage').textContent=state.navOwned?'ENGAGE':'BUY NAV 60¤';
    $('nav-engage').disabled=state.ended||!!state.autopilot||
      (persistentFlight&&!flightOnline)||(!state.navOwned&&p.credits<60);
    $('nav-abort').disabled=!state.autopilot;
    $('nav-quick-status').textContent=state.autopilot?'AUTO · '+state.autopilot.phase.toUpperCase():state.navOwned?'COMPUTER ONLINE':'COMPUTER LOCKED';
    $('nav-quick-metrics').textContent=state.navPlan?`${state.navPlan.dv.toFixed(2)} km/s Δv · ${state.navPlan.eta.toFixed(0)}s ETA · ${state.navPlan.safety.estimatedKg.toFixed(1)} kg ideal · ${state.navPlan.safety.reserveKg.toFixed(0)} kg reserved`: 'Pick a contact · press C to calculate';

  }
  function updateZoom(){$('zoom-level').textContent=state.zoom.toFixed(2)+'×';}
  function zoomAt(factor,px=W/2,py=H/2){
    const world=fromScreen(px,py);
    state.zoom=clamp(state.zoom*factor,.35,6);
    state.panX=px-W/2-world.x*scale();
    state.panY=py-H/2-world.y*scale();
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
  }
  function scale(){return Math.min(W/700,H/660)*state.zoom;}
  function toScreen(x,y){const s=scale();return {x:W/2 + state.panX+x*s,y:H/2+state.panY+y*s};}
  function fromScreen(x,y){const s=scale();return {x:(x-W/2-state.panX)/s,y:(y-H/2-state.panY)/s};}
  function pathWorld(points,stroke,lineWidth=1,dash=[]) {
    if(points.length<2)return;
    ctx.save();ctx.beginPath();const first=toScreen(points[0].x,points[0].y);ctx.moveTo(first.x,first.y);
    for(let i=1;i<points.length;i++){const p=toScreen(points[i].x,points[i].y);ctx.lineTo(p.x,p.y);}
    ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.setLineDash(dash);ctx.stroke();ctx.restore();
  }
  function drawBackground(){
    ctx.fillStyle='#06101b';ctx.fillRect(0,0,W,H);
    const g=ctx.createRadialGradient(W/2,H/2,20,W/2,H/2,Math.max(W,H)*.75);
    g.addColorStop(0,'#11283b');g.addColorStop(.5,'#0a1a2b');g.addColorStop(1,'#060e18');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    for(const star of starfield){ctx.fillStyle=`rgba(178,209,229,${star.alpha})`;ctx.fillRect(star.x,star.y,star.size,star.size);}
    ctx.save();ctx.lineWidth=1;const center=toScreen(0,0);const s=scale();
    ctx.strokeStyle='#183149';ctx.setLineDash([3,7]);
    for(let r=150;r<=1050;r+=100){ctx.beginPath();ctx.ellipse(center.x,center.y,r*s,r*s,0,0,TWO_PI);ctx.stroke();
      if(r<=550){ctx.fillStyle='#54778e';ctx.font='10px monospace';ctx.fillText(r+'km',center.x+r*s+4,center.y-4);}}
    ctx.setLineDash([]);ctx.strokeStyle='#25445c';ctx.beginPath();ctx.moveTo(0,center.y);ctx.lineTo(W,center.y);ctx.moveTo(center.x,0);ctx.lineTo(center.x,H);ctx.stroke();ctx.restore();
    drawCentralBody(center.x,center.y,s);
  }
  function drawCentralBody(x,y,s){
    const R=WORLD.radius*s;
    ctx.save();
    let halo=ctx.createRadialGradient(x,y,R*.1,x,y,R*2.65);
    halo.addColorStop(0,'rgba(255,173,87,.35)');halo.addColorStop(.55,'rgba(250,142,64,.10)');halo.addColorStop(1,'rgba(250,142,64,0)');
    ctx.beginPath();ctx.arc(x,y,R*2.65,0,TWO_PI);ctx.fillStyle=halo;ctx.fill();
    ctx.beginPath();ctx.arc(x,y,WORLD.crashRadius*s,0,TWO_PI);ctx.strokeStyle='#ed765355';ctx.setLineDash([4,6]);ctx.lineWidth=1.4;ctx.stroke();ctx.setLineDash([]);
    const planet=ctx.createRadialGradient(x-R*.4,y-R*.35,R*.1,x,y,R*1.1);
    planet.addColorStop(0,'#f6c17a');planet.addColorStop(.32,'#cf8750');planet.addColorStop(.77,'#724d46');planet.addColorStop(1,'#2a2a3a');
    ctx.beginPath();ctx.arc(x,y,R,0,TWO_PI);ctx.fillStyle=planet;ctx.fill();ctx.strokeStyle='#d3a771';ctx.lineWidth=1;ctx.stroke();
    ctx.translate(x,y);ctx.rotate(-.35);
    for(let j=0;j<4;j++){ctx.beginPath();ctx.ellipse(0,R*(-.5+j*.33),R*.84,R*.075,.06*j,0,TWO_PI);ctx.strokeStyle=`rgba(61,35,43,${.13+.07*j})`;ctx.lineWidth=Math.max(1,R*.1);ctx.stroke();}
    ctx.restore();
    ctx.fillStyle='#dda96e';ctx.font='11px ui-monospace,monospace';ctx.textAlign='center';ctx.fillText('KESTREL',x,y+R+20);ctx.textAlign='left';
  }
  function drawTrails(){
    if(state.orbitVisible){pathWorld(state.predicted, state.dangerPrediction?'rgba(255,113,132,.72)':'rgba(98,217,246,.63)',1.7,[5,5]);}
    if(state.navPlan){pathWorld(state.navPlan.coastPath,'#67e0aa9a',2.1,[6,4]);const a=state.navPlan.arrival;if(a){const q=toScreen(a.x,a.y);ctx.strokeStyle=palette.green;ctx.beginPath();ctx.arc(q.x,q.y,11,0,TWO_PI);ctx.stroke();}}
    if(state.waypoint){const q=toScreen(state.waypoint.x,state.waypoint.y);ctx.strokeStyle=palette.yellow;ctx.lineWidth=2;ctx.strokeRect(q.x-8,q.y-8,16,16);}
    for(const e of [...state.enemies,state.ally,...(state.allies||[]),state.player])if(e.alive)pathWorld(e.trail,e.isPlayer?'#62d9f654':e.isAlly?'#67e0aa55':'#ff718433',1.5);
  }
  function drawShip(ship){
    if(!ship.alive)return;
    const p=toScreen(ship.x,ship.y),s=clamp(scale()*2.1,.8,1.85),a=ship.heading+Math.PI/2;
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(a);ctx.scale(s,s);
    if(ship.thrustVector){
      const burnAngle=ship.isPlayer?ship.gimbal:0;
      ctx.save();ctx.rotate(burnAngle);
      ctx.fillStyle=ship.isPlayer?'#72d9ef':'#ec956c';
      ctx.beginPath();ctx.moveTo(-5,10);ctx.lineTo(0,25+Math.sin(state.t*47)*4);ctx.lineTo(5,10);ctx.fill();ctx.restore();
    }
    if(ship.rcsFiring){ctx.fillStyle='#ffbc66';const sign=ship.rcsFiring;ctx.beginPath();ctx.moveTo(-sign*9,-8);ctx.lineTo(-sign*21,-4);ctx.lineTo(-sign*9,-1);ctx.fill();ctx.beginPath();ctx.moveTo(sign*9,7);ctx.lineTo(sign*21,12);ctx.lineTo(sign*9,14);ctx.fill();}
    ctx.fillStyle='#0a1f30';ctx.strokeStyle=ship.color;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(0,-13);ctx.lineTo(9,11);ctx.lineTo(0,6);ctx.lineTo(-9,11);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle=ship.color;ctx.beginPath();ctx.arc(0,1,2.5,0,TWO_PI);ctx.fill();
    if(ship.isPlayer){
      ctx.save();ctx.rotate(ship.gimbal);ctx.strokeStyle=palette.yellow;ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(0,8);ctx.lineTo(0,16);ctx.stroke();ctx.restore();
      ctx.save();ctx.strokeStyle='#80b3ce88';ctx.setLineDash([2,5]);ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,35,-Math.PI/2-ENGINE.gimbalMax,-Math.PI/2+ENGINE.gimbalMax);ctx.stroke();ctx.restore();
    }
    ctx.restore();
    if(!ship.isPlayer){ctx.font='10px system-ui';ctx.fillStyle=ship.color;ctx.fillText((ship.isAlly?'★ ':'')+ship.name,p.x+13,p.y-12);ctx.fillStyle='#254052';ctx.fillRect(p.x+13,p.y-7,48,3);ctx.fillStyle=ship.color;ctx.fillRect(p.x+13,p.y-7,48*(ship.hp/(ship.isAlly?80:66)),3);}
    if(ship.isPlayer){ctx.save();ctx.strokeStyle=palette.cyan;ctx.globalAlpha=.4;ctx.setLineDash([4,6]);ctx.beginPath();ctx.arc(p.x,p.y,22,0,TWO_PI);ctx.stroke();ctx.restore();}
  }
  function drawPickup(pod){const p=toScreen(pod.x,pod.y),s=clamp(scale(),.5,1.25),size=6*s+2;
    const color=pod.type==='fuel'?palette.green:pod.type==='ammo'?palette.purple:pod.type==='wreck'?palette.red:pod.type==='parts'?palette.cyan:palette.yellow;
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(state.t*.4+pod.phase);ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.fillStyle='#102334';ctx.beginPath();ctx.moveTo(0,-size);ctx.lineTo(size,0);ctx.lineTo(0,size);ctx.lineTo(-size,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=.24+.13*Math.sin(state.t*2+pod.phase);ctx.beginPath();ctx.arc(p.x,p.y,size+6,0,TWO_PI);ctx.stroke();ctx.restore();
    ctx.fillStyle=color;ctx.font='9px monospace';ctx.fillText(pod.type==='wreck'?'WRECK':pod.type.toUpperCase(),p.x+10,p.y+14);
  }
  function drawShots(){for(const s of state.shots){const p=toScreen(s.x,s.y);if(p.x<-90||p.x>W+90||p.y<-90||p.y>H+90)continue;const tail=toScreen(s.x-s.vx*.035,s.y-s.vy*.035);ctx.strokeStyle=s.faction==='ally'?palette.green:s.faction==='player'?palette.cyan:palette.red;ctx.lineWidth=2.6;ctx.beginPath();ctx.moveTo(tail.x,tail.y);ctx.lineTo(p.x,p.y);ctx.stroke();}}
  function drawParticles(){for(const p of state.particles){const q=toScreen(p.x,p.y);ctx.globalAlpha=clamp(p.life/p.maxLife,0,1);ctx.fillStyle=p.color;ctx.fillRect(q.x,q.y,2.2,2.2);}ctx.globalAlpha=1;}
  function drawAim(){
    const p=state.player,preview=state.ballistic;if(!p.alive||!preview)return;
    const bulletLine=preview.path.map(q=>({x:q.x,y:q.y}));
    pathWorld(bulletLine,'rgba(98,217,246,.92)',2.25,[6,3]);
    const end=preview.path[preview.path.length-1];
    if(end){
      const q=toScreen(end.x,end.y);
      ctx.save();ctx.strokeStyle=preview.status==='reachable'?palette.cyan:palette.yellow;
      ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(q.x,q.y,7,0,TWO_PI);ctx.stroke();
      ctx.fillStyle='#aeddea';ctx.font='bold 10px monospace';
      const label=preview.arrivalTime!==null?preview.arrivalTime.toFixed(2)+'s':preview.status==='planet'?'PLANET':'PREVIEW LIMIT';
      ctx.fillText(label,q.x+11,q.y-10);ctx.restore();
    }
    if(!state.trajectoryIntel||!preview.targetAtCursor)return;
    pathWorld(preview.targetPath,'rgba(189,158,250,.85)',2.15,[3,5]);
    const ghost=toScreen(preview.targetAtCursor.x,preview.targetAtCursor.y);
    ctx.save();ctx.strokeStyle=palette.purple;ctx.lineWidth=2;ctx.beginPath();ctx.arc(ghost.x,ghost.y,12,0,TWO_PI);
    ctx.moveTo(ghost.x-20,ghost.y);ctx.lineTo(ghost.x-7,ghost.y);
    ctx.moveTo(ghost.x+7,ghost.y);ctx.lineTo(ghost.x+20,ghost.y);
    ctx.moveTo(ghost.x,ghost.y-20);ctx.lineTo(ghost.x,ghost.y-7);
    ctx.moveTo(ghost.x,ghost.y+7);ctx.lineTo(ghost.x,ghost.y+20);ctx.stroke();
    const shot=toScreen(preview.bulletAtCursor.x,preview.bulletAtCursor.y);
    ctx.strokeStyle=preview.missKm<14?palette.green:palette.yellow;ctx.setLineDash([2,3]);
    ctx.beginPath();ctx.moveTo(shot.x,shot.y);ctx.lineTo(ghost.x,ghost.y);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle=palette.purple;ctx.font='bold 10px monospace';
    ctx.fillText('TARGET +'+preview.arrivalTime.toFixed(2)+'s',ghost.x+14,ghost.y-14);
    ctx.restore();
  }
  function drawEphemeris(){
    if(!state.ephemerisOwned)return;
    const target=navTarget($('nav-target').value)||aliveTarget();
    if(!target?.alive)return;
    const now=performance.now();
    if(!state.ephemerisCache||state.ephemerisCache.key!==target.id||
       now-state.ephemerisCache.ms>500){
      const predicted=NAV.propagate(target,180,WORLD.mu,.7,WORLD.crashRadius,100000,true);
      const t60=NAV.propagate(target,60,WORLD.mu,1,WORLD.crashRadius,100000);
      const t120=NAV.propagate(target,120,WORLD.mu,1,WORLD.crashRadius,100000);
      state.ephemerisCache={key:target.id,ms:now,
        points:predicted.points||[],markers:[t60,t120]};
    }
    const path=state.ephemerisCache;
    if(path.points.length<2)return;
    pathWorld(path.points,'rgba(237,190,107,.82)',2,[7,5]);
    ctx.save();ctx.fillStyle='#edbe6b';ctx.font='bold 11px monospace';
    path.markers.forEach((m,i)=>{
      if(!m?.safe)return;
      const pixel=toScreen(m.x,m.y);
      ctx.beginPath();ctx.arc(pixel.x,pixel.y,4,0,TWO_PI);ctx.fill();
      ctx.fillText('T+'+(i+1)*60+'s',pixel.x+9,pixel.y-8);
    });
    ctx.restore();
  }
  function draw(){
    if(!state)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);drawBackground();
    if(!encounterReady){
      ctx.fillStyle='#a6dbe8';ctx.font='bold 14px system-ui';ctx.textAlign='center';
      ctx.fillText('RESTORING PERSISTENT SECTOR…',W/2,H/2);ctx.textAlign='left';
      return;
    }
    drawTrails();
    for(const pod of state.pickups)drawPickup(pod);
    drawShots();for(const e of state.enemies)drawShip(e);drawShip(state.ally);
    for(const ally of state.allies||[])drawShip(ally);
    drawShip(state.player);
    drawEphemeris();drawAim();drawParticles();
    if(state.ended){ctx.fillStyle='#060e1870';ctx.fillRect(0,0,W,H);}
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
    $('sos-btn').title='Ask AEGIS-01 for fuel ('+keyLabel(hotkeys.sos)+')';
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
  function openSettings(){settingsOpen=true;capturingAction=null;state.down.clear();$('settings-modal').classList.remove('hidden');renderHotkeys();$('hotkey-feedback').textContent='';$('settings-close').focus();}
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
    $('retry-btn').addEventListener('click',reset);
    $('orbit-btn').addEventListener('click',()=>{state.orbitVisible=!state.orbitVisible;$('orbit-btn').classList.toggle('selected',state.orbitVisible);$('orbit-btn').setAttribute('aria-pressed',String(state.orbitVisible));});
    $('zoom-in').addEventListener('click',()=>zoomAt(1.25));
    $('zoom-out').addEventListener('click',()=>zoomAt(1/1.25));
    $('next-target').addEventListener('click',selectNextTarget);
    $('lock-btn').addEventListener('click',lockNearest);
    $('upgrade-btn').addEventListener('click',()=>{if(state.predictive||state.ended)return;if(purchaseUpgrade('predictive'))return;if(state.player.credits<40)return;state.player.credits-=40;state.predictive=true;logEvent('Predictive fire control installed.','good');state.lastBallistic=-999;updateHud();});
    $('trajectory-upgrade-btn').addEventListener('click',()=>{if(state.trajectoryIntel||state.ended)return;if(purchaseUpgrade('trajectory'))return;if(state.player.credits<25)return;state.player.credits-=25;state.trajectoryIntel=true;state.lastBallistic=-999;logEvent('Target trajectory analyzer installed.','good');updateHud();});
    // No reinforcement control in the connected cockpit; use POST /api/dev/players/{pilot_id}/raiders.
    $('nav-upgrade-btn').addEventListener('click',()=>{if(state.navOwned||state.ended)return;if(purchaseUpgrade('nav'))return;if(state.player.credits<60)return;state.player.credits-=60;state.navOwned=true;logEvent('Rendezvous intelligence installed.','good');updateHud();});
    $('ephemeris-upgrade-btn')?.addEventListener('click',()=>{
      if(state.ephemerisOwned||state.ended)return;
      if(purchaseUpgrade('ephemeris'))return;
      if(state.player.credits<45)return;
      state.player.credits-=45;state.ephemerisOwned=true;
      logEvent('Orbital ephemeris computer installed.','good');updateHud();
    });
    $('nav-plan').addEventListener('click',planNav);
    $('nav-engage').addEventListener('click',purchaseOrEngage);
    $('nav-next').addEventListener('click',cycleNavigationTarget);
    $('nav-abort').addEventListener('click',()=>abortNav());
    $('nav-target').addEventListener('change',()=>{state.navPlan=null;updateHud();});
    $('nav-toggle').addEventListener('click',()=>toggleConsole('nav'));
    $('telemetry-toggle').addEventListener('click',()=>toggleConsole('telemetry'));
    $('sos-btn').addEventListener('click',requestFuelHelp);
    $('escort-help-btn').addEventListener('click',requestFuelHelp);
    $('settings-btn').addEventListener('click',openSettings);
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
      state.gimbalTarget=fromScreen(pt.px,pt.py);
      state.lastBallistic=-999;
      if(state.aimMode==='manual')state.mouseTarget=state.gimbalTarget;
    });
    canvas.addEventListener('pointerdown',e=>{
      if(state.ended)return;
      const pt=coords(e),p=fromScreen(pt.px,pt.py);
      if(e.button===1||e.button===2||e.shiftKey){e.preventDefault();drag={id:e.pointerId,px:pt.px,py:pt.py};canvas.setPointerCapture(e.pointerId);return;}
      if(e.button!==0)return;
      if(e.altKey){state.waypoint={x:p.x,y:p.y};updateTargetOptions('waypoint');state.navPlan=null;logEvent('Waypoint plotted at '+p.x.toFixed(0)+', '+p.y.toFixed(0)+' km.');updateHud();return;}
      let candidate=null,dist=Infinity;
      for(const enemy of state.enemies)if(enemy.alive){const d=magnitude(p.x-enemy.x,p.y-enemy.y);if(d<Math.max(23,23/scale())&&d<dist){dist=d;candidate=enemy;}}
      if(candidate){state.targetId=candidate.id;state.aimMode='locked';state.lastBallistic=-999;state.navPlan=null;logEvent('Target lock: '+candidate.name);updateTargetOptions('enemy:'+candidate.id);updateHud();return;}
      if(state.ally.alive&&magnitude(p.x-state.ally.x,p.y-state.ally.y)<Math.max(23,23/scale())){updateTargetOptions('ally');state.navPlan=null;logEvent('Friendly escort selected as navigation target.','good');return;}
      for(const pickup of state.pickups)if(pickup.alive){const d=magnitude(p.x-pickup.x,p.y-pickup.y);if(d<Math.max(17,19/scale())&&d<dist){dist=d;candidate=pickup;}}
      if(candidate&&candidate.type){updateTargetOptions('pickup:'+candidate.id);state.navPlan=null;logEvent('Navigation target selected: '+candidate.type+'.');return;}
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
  bindControls();updateHotkeyHints();reset();fitCanvas();lastFrameId=requestAnimationFrame(frame);
  if(window.OrbitalPersistence){
    pilotLink=window.OrbitalPersistence.attach({
      controls:flightControls,
      onEncounter:checkpoint=>{restoreEncounter(checkpoint);encounterReady=true;},
      onState:result=>{
        const p=state.player;
        reconcileFlight(p,result.state,result.clientSampleMs||performance.now());
        state.lastPrediction=-999;
        state.lastBallistic=-999;
      },
      onProgress:progress=>{
        const previous={predictive:state.predictive,trajectoryIntel:state.trajectoryIntel,navOwned:state.navOwned,ephemerisOwned:state.ephemerisOwned};
        state.player.credits=progress.credits;
        state.predictive=Boolean(progress.upgrades.predictive);
        state.trajectoryIntel=Boolean(progress.upgrades.trajectory);
        state.navOwned=Boolean(progress.upgrades.nav);
        state.ephemerisOwned=Boolean(progress.upgrades.ephemeris);
        if(!previous.predictive&&state.predictive)logEvent('Predictive fire control installed persistently.','good');
        if(!previous.trajectoryIntel&&state.trajectoryIntel)logEvent('Trajectory analyzer installed persistently.','good');
        if(!previous.navOwned&&state.navOwned)logEvent('Rendezvous technology installed persistently.','good');
        if(!previous.ephemerisOwned&&state.ephemerisOwned)logEvent('Ephemeris computer installed · orbital predictions unlocked.','good');
        state.lastBallistic=-999;updateHud();
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
