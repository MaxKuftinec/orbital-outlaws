/**
 * ORBITAL OUTLAWS 0.1
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
  const palette = { cyan: '#62d9f6', green:'#67e0aa', red:'#ff7184', yellow:'#edbe6b', purple:'#bd9efa' };
  let W = 840, H = 550, dpr = 1;
  let state;
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
    return {...circularPosition(r,theta), id,name,color, isPlayer, hp:isPlayer?100:66, fuel:isPlayer?100:rand(70,100), fuelMax:isPlayer?100:100,
      ammo:isPlayer?36:999, credits:0, thrustAccel:isPlayer?14:9.5, fuelRate:isPlayer?7.2:4.4,
      gunCooldown: isPlayer?0:rand(2.2,4), aiThrustUntil:0, aiThrustKind:null, nextDecision:rand(4,9),
      trail:[], trailT:0, alive:true, heading:0, thrustVector:null, shotCount:0 };
  }
  function newPickup(r, angle, type='fuel', amount=25) {
    return {...circularPosition(r,angle), id:'pod-'+Math.random().toString(36).slice(2,8), type, amount,
      phase:rand(0,TWO_PI), age:0, alive:true};
  }
  function logEvent(message, category='neutral') {
    state.events.unshift({t:state.t, message, category});
    if(state.events.length>7) state.events.length=7;
    $('event-feed').innerHTML = state.events.map(e => {
      const min = Math.floor(e.t/60).toString().padStart(2,'0');
      const sec = Math.floor(e.t%60).toString().padStart(2,'0');
      return `<div class="event-entry ${e.category}"><time>${min}:${sec}</time><span>${escapeHtml(e.message)}</span></div>`;
    }).join('');
  }
  function escapeHtml(str) { return String(str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function reset() {
    const player = newShip('player','KESTREL-7',260,-0.67,palette.cyan,true);
    const e1 = newShip('raider-01','RAIDER-01',280,0.17,palette.red);
    const e2 = newShip('raider-02','RAIDER-02',323,-2.02,palette.purple);
    state = {t:0, player, enemies:[e1,e2], shots:[], pickups:[
      newPickup(260,-0.42,'fuel',28), newPickup(250,-1.20,'credits',24), newPickup(330,-2.42,'ammo',16),newPickup(312,0.75,'fuel',32),newPickup(365,1.7,'credits',30)
    ], particles:[], events:[], down:new Set(), mouseTarget:null, targetId:e1.id, aimMode:'locked', zoom:1,
    orbitVisible:true, predictive:false, ended:false, paused:false, speed:1, nextEnemySpawn:75,
    playerKills:0, recordSurvival:0, predicted:[], lastPrediction:-999, dangerPrediction:false};
    lastFrame = performance.now(); accumulator=0;
    document.querySelectorAll('[data-thrust]').forEach(btn=>btn.classList.remove('pressed'));
    $('fire-btn').classList.remove('pressed');
    $('game-over').classList.add('hidden');
    $('sim-speed').value='1';$('pause-btn').textContent='Ⅱ Pause';
    $('orbit-btn').classList.add('selected');$('orbit-btn').setAttribute('aria-pressed','true');
    updateZoom();
    logEvent('Circular orbit established · no fuel needed to coast.','good');
    logEvent('Two pirate ships detected in sector.','danger');
    logEvent('Use RETROGRADE to enter a faster, lower orbit.');
    computePrediction();updateHud();
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
  function unit(x,y) {const m=magnitude(x,y)||1;return {x:x/m,y:y/m};}
  function thrustVector(ship, pressed) {
    if (!ship.fuel || pressed.length===0) return null;
    const radial=unit(ship.x,ship.y), forward=unit(ship.vx,ship.vy);
    let dx=0, dy=0;
    for(const kind of pressed) {
      if(kind==='prograde') {dx+=forward.x;dy+=forward.y;}
      if(kind==='retrograde') {dx-=forward.x;dy-=forward.y;}
      if(kind==='outward') {dx+=radial.x;dy+=radial.y;}
      if(kind==='inward') {dx-=radial.x;dy-=radial.y;}
    }
    if(magnitude(dx,dy)<.01) return null;
    const dir=unit(dx,dy);
    return {x:dir.x*ship.thrustAccel,y:dir.y*ship.thrustAccel};
  }
  function applyShipStep(ship, dt, pressed) {
    if(!ship.alive) return;
    const extra=thrustVector(ship, pressed);
    ship.thrustVector=extra;
    if(extra) ship.fuel=Math.max(0,ship.fuel-dt*ship.fuelRate);
    stepBody(ship,dt,extra);
    ship.gunCooldown=Math.max(0,ship.gunCooldown-dt);
    ship.trailT+=dt;
    if(ship.trailT>.16) {ship.trail.push({x:ship.x,y:ship.y});if(ship.trail.length>120)ship.trail.shift();ship.trailT=0;}
    if(magnitude(ship.x,ship.y)<WORLD.crashRadius) {
      if(ship.isPlayer) endGame('Your spacecraft intersected the surface of Kestrel.');
      else destroyEnemy(ship,'fell into the gravity well');
    }
    if(ship.isPlayer && magnitude(ship.x,ship.y)>WORLD.outerRadius) endGame('Your spacecraft escaped the playable sector.');
    if(ship.isPlayer && ship.hp<=0) endGame('Hostile fire destroyed your spacecraft.');
  }
  function step(dt) {
    if(state.ended)return;
    state.t+=dt;
    const player=state.player;
    const pressed = ['prograde','retrograde','inward','outward'].filter(k=>state.down.has(k));
    applyShipStep(player,dt,pressed);
    if(state.ended)return;
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
      const d=magnitude(enemy.x-player.x,enemy.y-player.y);
      if(d<310 && enemy.gunCooldown<=0 && state.t>5) {
        shoot(enemy,player,true);
        enemy.gunCooldown=rand(3.7,5.2);
      }
    }
    if(state.down.has('fire')) firePlayer();
    for(const p of state.pickups) {
      if(!p.alive) continue;
      stepBody(p,dt);p.age+=dt;
      if(magnitude(p.x-player.x,p.y-player.y)<19) collect(p);
      if(magnitude(p.x,p.y)<WORLD.crashRadius || p.age>190) p.alive=false;
    }
    for(const shot of state.shots) {
      if(!shot.alive)continue;
      stepBody(shot,dt);shot.age+=dt;
      if(shot.age>5.2 || magnitude(shot.x,shot.y)<WORLD.crashRadius || magnitude(shot.x,shot.y)>1300) {shot.alive=false;continue;}
      const targets=shot.fromPlayer?state.enemies:[player];
      for(const target of targets) {
        if(!target.alive)continue;
        if(magnitude(shot.x-target.x,shot.y-target.y)<14) {
          shot.alive=false; target.hp=Math.max(0,target.hp-(shot.fromPlayer?26:10));
          sparks(shot.x,shot.y,shot.fromPlayer?palette.red:palette.cyan,9);
          if(target.hp<=0) {
            if(target.isPlayer)endGame('Hostile projectile destroyed your spacecraft.');
            else destroyEnemy(target,'destroyed by Kestrel-7');
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
    if(state.t>state.nextEnemySpawn) {
      const alive = state.enemies.filter(e=>e.alive).length;
      if(alive<2){spawnEnemy();}
      state.nextEnemySpawn=state.t+rand(35,55);
    }
  }
  function spawnEnemy() {
    const r=rand(240,370),angle=rand(-Math.PI,Math.PI);
    const id='raider-'+Math.random().toString(36).slice(2,7);
    const bot = newShip(id,'RAIDER-'+String(Math.floor(rand(10,99))),r,angle,palette.red);
    state.enemies.push(bot);logEvent('New pirate contact: '+bot.name,'danger');
  }
  function destroyEnemy(enemy,reason) {
    if(!enemy.alive)return;
    enemy.alive=false; enemy.hp=0;sparks(enemy.x,enemy.y,palette.red,22);
    state.pickups.push({x:enemy.x,y:enemy.y,vx:enemy.vx,vy:enemy.vy,id:'wreck-'+enemy.id,type:'wreck',amount:1,age:0,phase:0,alive:true});
    if(reason==='destroyed by Kestrel-7'){state.playerKills++;logEvent(enemy.name+' destroyed. Salvage the wreck.','good');}
    else logEvent(enemy.name+' '+reason+'.');
    const survivors=state.enemies.filter(e=>e.alive);
    if(state.targetId===enemy.id)state.targetId=survivors.length?survivors[0].id:null;
  }
  function collect(pod) {
    pod.alive=false;
    const p=state.player;
    if(pod.type==='fuel') {p.fuel=Math.min(p.fuelMax,p.fuel+pod.amount);logEvent('Recovered '+pod.amount+' units of fuel.','good');}
    if(pod.type==='ammo') {p.ammo+=pod.amount;logEvent('Recovered '+pod.amount+' ballistic rounds.','good');}
    if(pod.type==='credits') {p.credits+=pod.amount;logEvent('Recovered '+pod.amount+' salvage credits.','good');}
    if(pod.type==='wreck') {p.credits+=50;p.ammo+=12;p.fuel=Math.min(p.fuelMax,p.fuel+25);logEvent('Wreck salvaged: +50 ¤, +25 fuel, +12 ammo.','good');}
    sparks(pod.x,pod.y,palette.green,12);
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
  function shoot(shooter,target,isEnemy=false) {
    if(!shooter.alive || shooter.gunCooldown>0)return;
    if(shooter.isPlayer && shooter.ammo<=0){if(state.t-(shooter.lastOutOfAmmo||0)>3){logEvent('Ammo depleted. Search for salvage.','danger');shooter.lastOutOfAmmo=state.t;}return;}
    let aim;
    if(!isEnemy && state.aimMode==='manual' && state.mouseTarget) aim=unit(state.mouseTarget.x-shooter.x,state.mouseTarget.y-shooter.y);
    else if(target && target.alive) aim=state.predictive||isEnemy?leadAim(shooter,target):unit(target.x-shooter.x,target.y-shooter.y);
    else aim=unit(shooter.vx,shooter.vy);
    if(isEnemy){const theta=rand(-.045,.045);const c=Math.cos(theta),s=Math.sin(theta);aim={x:aim.x*c-aim.y*s,y:aim.x*s+aim.y*c};}
    const gun= {x:shooter.x+aim.x*12, y:shooter.y+aim.y*12,
      vx:shooter.vx+WORLD.projectileSpeed*aim.x,vy:shooter.vy+WORLD.projectileSpeed*aim.y,
      fromPlayer:!isEnemy,alive:true,age:0};
    state.shots.push(gun);
    shooter.gunCooldown=isEnemy?rand(2.4,3.6):.27;
    if(shooter.isPlayer){shooter.ammo--;shooter.shotCount++;}
    sparks(gun.x,gun.y, isEnemy?palette.red:palette.cyan,2);
  }
  function firePlayer(){if(!state.ended)shoot(state.player,aliveTarget());}
  function endGame(reason) {
    if(state.ended)return;
    state.ended=true;state.paused=true;state.down.clear();
    $('game-over-details').textContent=`${reason} Survived ${formatTime(state.t)}. Raider kills: ${state.playerKills}.`;
    $('game-over').classList.remove('hidden');
    $('pause-btn').textContent='Ⅱ Pause';logEvent('MISSION FAILED: '+reason,'danger');
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
    $('hull-value').textContent=Math.round(p.hp)+'%';$('hull-bar').style.width=clamp(p.hp,0,100)+'%';
    $('fuel-value').textContent=`${Math.ceil(p.fuel)} / ${p.fuelMax}`;$('fuel-bar').style.width=(100*p.fuel/p.fuelMax)+'%';
    $('ammo-value').textContent=p.ammo;
    $('credits-value').innerHTML=p.credits+' <i>¤</i>';
    $('dv-value').textContent=(p.fuel/p.fuelRate*p.thrustAccel).toFixed(0)+' u/s';
    $('alt-value').textContent=(e.r-WORLD.radius).toFixed(1)+' u';
    $('speed-value').textContent=e.v.toFixed(1)+' u/s';
    $('peri-value').textContent=Number.isFinite(e.rp)?Math.max(0,e.rp-WORLD.radius).toFixed(1)+' u':'—';
    $('apo-value').textContent=Number.isFinite(e.ra)?Math.max(0,e.ra-WORLD.radius).toFixed(1)+' u':'ESCAPE';
    $('period-value').textContent=Number.isFinite(e.period)?e.period.toFixed(1)+' s':'UNBOUND';
    $('path-status').textContent=state.dangerPrediction?'IMPACT':e.e>=1?'UNBOUND':'BOUND';
    $('path-status').style.color=state.dangerPrediction?palette.red:e.e>=1?palette.yellow:palette.green;
    $('status-text').textContent=state.ended?'Spacecraft lost':p.thrustVector?'Thrusters active':e.e>=1?'Escape trajectory':'Coasting (no fuel burn)';
    $('status-text').style.color=state.ended?palette.red:p.thrustVector?palette.yellow:palette.green;
    const target=aliveTarget();
    $('target-name').textContent=state.aimMode==='manual'?'MANUAL AIM':target?target.name:'NO CONTACT';
    $('target-state').textContent=state.aimMode==='manual'?'FREE AIM':target?'HOSTILE':'SCANNING';
    $('range-value').textContent=target?magnitude(target.x-p.x,target.y-p.y).toFixed(1)+' u':'—';
    $('target-hull').textContent=target?Math.ceil(target.hp)+' / 66':'—';
    $('target-indicator').textContent=state.aimMode==='manual'?'AIM MODE: MANUAL':target?'TRACKING: '+target.name:'NO TARGET';
    $('mission-status').textContent=state.enemies.filter(ship=>ship.alive).length+' hostiles in sector';
    $('upgrade-status').textContent=state.predictive?'Installed · lead shot active':'40 ¤';
    $('upgrade-btn').textContent=state.predictive?'OWNED':'BUY';
    $('upgrade-btn').disabled=state.predictive||p.credits<40||state.ended;
  }
  function updateZoom(){$('zoom-level').textContent=state.zoom.toFixed(1)+'×';}
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
  function toScreen(x,y){const s=scale();return {x:W/2 + x*s,y:H/2+y*s};}
  function fromScreen(x,y){const s=scale();return {x:(x-W/2)/s,y:(y-H/2)/s};}
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
      if(r<=550){ctx.fillStyle='#54778e';ctx.font='10px monospace';ctx.fillText(r+'u',center.x+r*s+4,center.y-4);}}
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
    for(const e of [...state.enemies,state.player])if(e.alive)pathWorld(e.trail,e.isPlayer?'#62d9f654':'#ff718433',1.5);
  }
  function drawShip(ship){
    if(!ship.alive)return;
    const p=toScreen(ship.x,ship.y),s=Math.max(.67,Math.min(1.2,scale()*1.6));
    const aim = ship.isPlayer? (state.aimMode==='manual'&&state.mouseTarget?unit(state.mouseTarget.x-ship.x,state.mouseTarget.y-ship.y):aliveTarget()?unit(aliveTarget().x-ship.x,aliveTarget().y-ship.y):unit(ship.vx,ship.vy)) : unit(ship.vx,ship.vy);
    const a=Math.atan2(aim.y,aim.x)+Math.PI/2;
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(a);ctx.scale(s,s);
    if(ship.thrustVector){const tv=ship.thrustVector;const flame=unit(-tv.x,-tv.y); const ang=Math.atan2(flame.y,flame.x)-a;
      ctx.save();ctx.rotate(ang);ctx.fillStyle=ship.isPlayer?'#72d9ef':'#ec956c';ctx.beginPath();ctx.moveTo(0,-4);ctx.lineTo(21+Math.sin(state.t*40)*6,0);ctx.lineTo(0,4);ctx.fill();ctx.restore();}
    ctx.fillStyle='#0a1f30';ctx.strokeStyle=ship.color;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(9,10);ctx.lineTo(0,5);ctx.lineTo(-9,10);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle=ship.color;ctx.beginPath();ctx.arc(0,1,2.5,0,TWO_PI);ctx.fill();ctx.restore();
    if(!ship.isPlayer){ctx.font='10px system-ui';ctx.fillStyle=ship.color;ctx.fillText(ship.name,p.x+13,p.y-12);ctx.fillStyle='#254052';ctx.fillRect(p.x+13,p.y-7,48,3);ctx.fillStyle=ship.color;ctx.fillRect(p.x+13,p.y-7,48*(ship.hp/66),3);}
    if(ship.isPlayer){ctx.save();ctx.strokeStyle=palette.cyan;ctx.globalAlpha=.4;ctx.setLineDash([4,6]);ctx.beginPath();ctx.arc(p.x,p.y,19,0,TWO_PI);ctx.stroke();ctx.restore();}
  }
  function drawPickup(pod){const p=toScreen(pod.x,pod.y),s=clamp(scale(),.5,1.25),size=6*s+2;
    const color=pod.type==='fuel'?palette.green:pod.type==='ammo'?palette.purple:pod.type==='wreck'?palette.red:palette.yellow;
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(state.t*.4+pod.phase);ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.fillStyle='#102334';ctx.beginPath();ctx.moveTo(0,-size);ctx.lineTo(size,0);ctx.lineTo(0,size);ctx.lineTo(-size,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=.24+.13*Math.sin(state.t*2+pod.phase);ctx.beginPath();ctx.arc(p.x,p.y,size+6,0,TWO_PI);ctx.stroke();ctx.restore();
    ctx.fillStyle=color;ctx.font='9px monospace';ctx.fillText(pod.type==='wreck'?'WRECK':pod.type.toUpperCase(),p.x+10,p.y+14);
  }
  function drawShots(){for(const s of state.shots){const p=toScreen(s.x,s.y),tail=toScreen(s.x-s.vx*.035,s.y-s.vy*.035);ctx.strokeStyle=s.fromPlayer?palette.cyan:palette.red;ctx.lineWidth=2.6;ctx.beginPath();ctx.moveTo(tail.x,tail.y);ctx.lineTo(p.x,p.y);ctx.stroke();}}
  function drawParticles(){for(const p of state.particles){const q=toScreen(p.x,p.y);ctx.globalAlpha=clamp(p.life/p.maxLife,0,1);ctx.fillStyle=p.color;ctx.fillRect(q.x,q.y,2.2,2.2);}ctx.globalAlpha=1;}
  function drawAim(){
    const p=state.player;if(!p.alive)return;const pos=toScreen(p.x,p.y);let target=null;
    const enemy=aliveTarget();
    if(state.aimMode==='manual')target=state.mouseTarget;
    else if(enemy){if(state.predictive){const d=leadAim(p,enemy);target={x:p.x+d.x*170,y:p.y+d.y*170};} else target={x:enemy.x,y:enemy.y};}
    if(!target)return;
    const q=toScreen(target.x,target.y);
    ctx.save();ctx.setLineDash([4,6]);ctx.strokeStyle=state.predictive?'#67e0aa8a':'#62d9f67a';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pos.x,pos.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.setLineDash([]);
    ctx.strokeStyle=state.predictive?palette.green:palette.cyan;ctx.beginPath();ctx.arc(q.x,q.y,11,0,TWO_PI);ctx.moveTo(q.x-18,q.y);ctx.lineTo(q.x-7,q.y);ctx.moveTo(q.x+7,q.y);ctx.lineTo(q.x+18,q.y);ctx.moveTo(q.x,q.y-18);ctx.lineTo(q.x,q.y-7);ctx.moveTo(q.x,q.y+7);ctx.lineTo(q.x,q.y+18);ctx.stroke();
    ctx.restore();
  }
  function draw(){
    if(!state)return;ctx.setTransform(dpr,0,0,dpr,0,0);drawBackground();drawTrails();
    for(const pod of state.pickups)drawPickup(pod);
    drawShots();for(const e of state.enemies)drawShip(e);drawShip(state.player);drawAim();drawParticles();
    if(state.paused&&!state.ended){ctx.fillStyle='#0513207f';ctx.fillRect(0,0,W,H);ctx.fillStyle='#e1f2fc';ctx.textAlign='center';ctx.font='bold 25px system-ui';ctx.fillText('PAUSED',W/2,H/2);ctx.textAlign='left';}
    if(state.ended){ctx.fillStyle='#060e1870';ctx.fillRect(0,0,W,H);}
  }
  function frame(now){
    const realDelta=Math.min(Math.max((now-lastFrame)/1000,0),.06);
    lastFrame=now;
    if(state&&!state.paused&&!state.ended){
      accumulator+=realDelta*state.speed;
      let steps=0;
      while(accumulator>=.015 && steps<22){step(.015);accumulator-=.015;steps++;if(state.ended)break;}
      if(steps>=22)accumulator=0;
      if(state.t-state.lastPrediction>.22)computePrediction();
    }
    if(now>nextHud){updateHud();nextHud=now+130;}
    draw();lastFrameId=requestAnimationFrame(frame);
  }
  function bindControls(){
    const keyToAction={KeyW:'prograde',ArrowUp:'prograde',KeyS:'retrograde',ArrowDown:'retrograde',KeyA:'inward',ArrowLeft:'inward',KeyD:'outward',ArrowRight:'outward',Space:'fire'};
    window.addEventListener('keydown',(e)=>{
      if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
      const action=keyToAction[e.code];
      if(action){e.preventDefault();state.down.add(action);document.querySelectorAll(`[data-thrust="${action}"]`).forEach(b=>b.classList.add('pressed'));if(action==='fire')$('fire-btn').classList.add('pressed');}
      if(e.code==='KeyP'&&!e.repeat){e.preventDefault();togglePause();}
    });
    window.addEventListener('keyup',(e)=>{
      const action=keyToAction[e.code];if(action){e.preventDefault();state.down.delete(action);document.querySelectorAll(`[data-thrust="${action}"]`).forEach(b=>b.classList.remove('pressed'));if(action==='fire')$('fire-btn').classList.remove('pressed');}
    });
    window.addEventListener('blur',()=>{if(state){state.down.clear();document.querySelectorAll('.pressed').forEach(b=>b.classList.remove('pressed'));}});
    function hold(button,action){
      button.addEventListener('pointerdown',e=>{if(state.ended)return;e.preventDefault();state.down.add(action);button.classList.add('pressed');if(button.setPointerCapture)button.setPointerCapture(e.pointerId);});
      const stop=()=>{state.down.delete(action);button.classList.remove('pressed');};
      button.addEventListener('pointerup',stop);button.addEventListener('pointercancel',stop);button.addEventListener('lostpointercapture',stop);
    }
    document.querySelectorAll('[data-thrust]').forEach(b=>hold(b,b.dataset.thrust));hold($('fire-btn'),'fire');
    $('pause-btn').addEventListener('click',togglePause);
    $('reset-btn').addEventListener('click',reset);
    $('retry-btn').addEventListener('click',reset);
    $('sim-speed').addEventListener('change',e=>state.speed=clamp(Number(e.target.value)||1,.5,4));
    $('orbit-btn').addEventListener('click',()=>{
      state.orbitVisible=!state.orbitVisible;$('orbit-btn').classList.toggle('selected',state.orbitVisible);$('orbit-btn').setAttribute('aria-pressed',String(state.orbitVisible));
    });
    $('zoom-in').addEventListener('click',()=>{state.zoom=clamp(state.zoom+.2,.6,2.2);updateZoom();});
    $('zoom-out').addEventListener('click',()=>{state.zoom=clamp(state.zoom-.2,.6,2.2);updateZoom();});
    $('next-target').addEventListener('click',selectNextTarget);
    $('lock-btn').addEventListener('click',lockNearest);
    $('upgrade-btn').addEventListener('click',()=>{
      if(state.predictive||state.player.credits<40||state.ended)return;
      state.player.credits-=40;state.predictive=true;logEvent('Predictive fire control installed.','good');updateHud();
    });
    canvas.addEventListener('pointerdown',e=>{
      if(state.ended)return;
      const bounds=canvas.getBoundingClientRect(),p=fromScreen(e.clientX-bounds.left,e.clientY-bounds.top);
      let candidate=null,dist=Infinity;
      for(const enemy of state.enemies)if(enemy.alive){const d=magnitude(p.x-enemy.x,p.y-enemy.y);if(d<Math.max(25,23/scale())&&d<dist){dist=d;candidate=enemy;}}
      if(candidate){state.targetId=candidate.id;state.aimMode='locked';logEvent('Target lock: '+candidate.name);}
      else{state.aimMode='manual';state.mouseTarget=p;logEvent('Manual firing solution selected.');}
    });
    window.addEventListener('resize',fitCanvas);
    if(typeof ResizeObserver!=='undefined'){const ro=new ResizeObserver(fitCanvas);ro.observe(canvas);}
    document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();accumulator=0;if(document.hidden&&state&&!state.paused&&!state.ended){state.paused=true;$('pause-btn').textContent='▶ Resume';}});
  }
  function togglePause(){if(state.ended)return;state.paused=!state.paused;state.down.clear();$('pause-btn').textContent=state.paused?'▶ Resume':'Ⅱ Pause';}
  bindControls();reset();fitCanvas();lastFrameId=requestAnimationFrame(frame);
})();
