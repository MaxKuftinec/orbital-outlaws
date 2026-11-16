const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const game=fs.readFileSync(path.join(root,'game.js'),'utf8');
const app=fs.readFileSync(path.join(root,'frontend/src/App.vue'),'utf8');
const workspace=fs.readFileSync(path.join(root,'frontend/public/legacy/workspace.js'),'utf8');

function extract(start,end){
  const a=game.indexOf('  function '+start+'(');
  const b=game.indexOf('  function '+end+'(',a);
  assert.ok(a>=0&&b>a,'functions not found: '+start+' -> '+end);
  return game.slice(a,b);
}

test('full-screen canvas owns floating draggable ship, navigation and telemetry panels',()=>{
  const canvas=app.indexOf('id="canvas-workspace"');
  const ship=app.indexOf('id="ship-panel"');
  const aside=app.indexOf('<aside class="sidebar"');
  assert.ok(canvas>=0&&ship>canvas&&ship<aside,'ship panel must be inside the canvas');
  for(const id of ['nav-command','telemetry-console','ship-panel'])
    assert.ok(app.includes('id="'+id+'"'));
  assert.ok(app.includes('id="fullscreen-btn"'));
  assert.equal((app.match(/data-drag-handle/g)||[]).length,3);
  assert.match(workspace,/requestFullscreen\(\)/);
  assert.match(workspace,/exitFullscreen\(\)/);
  assert.match(workspace,/setPointerCapture/);
  assert.match(workspace,/panel-layout\.v1/);
  assert.match(app,/workspace\.js/);
});

test('server nav ownership allows Engage and automatically computes a route',()=>{
  assert.doesNotMatch(game,/if\(persistentFlight\)\{logEvent\('Server autopilot not implemented yet/);
  assert.doesNotMatch(game,/\$\('nav-engage'\)\.disabled=[^;]*!state\.navPlan/,'Engage must be clickable without a precomputed route');
});

test('owned rendezvous guidance issues real thrust and RCS commands, not position overwrites',()=>{
  const controls=extract('flightControls','applyFlightCorrection');
  const pilot={x:260,y:0,vx:0,vy:35,heading:0,omega:0,fuel:120,dryMass:900,repairParts:10};
  const state={
    player:pilot,down:new Set(),ended:false,gimbalTarget:null,
    autopilot:{reserveKg:20},autoDirection:{x:1,y:0},autoBurnAllowed:true
  };
  const ENGINE={gimbalMax:.48869,rcsN:2500,leverM:7,shipLengthM:14};
  const context={state,ENGINE,Math,Number,
    clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),
    normAngle:a=>Math.atan2(Math.sin(a),Math.cos(a)),
    mass:s=>s.dryMass+s.fuel+s.repairParts};
  const straight=vm.runInNewContext(controls+'\nflightControls();',context,{timeout:1000});
  assert.equal(straight.thrust,true);
  assert.equal(straight.turn,0);
  state.autoDirection={x:0,y:1};
  state.autoBurnAllowed=false;
  const turning=vm.runInNewContext(controls+'\nflightControls();',context,{timeout:1000});
  assert.equal(turning.thrust,false);
  assert.equal(turning.turn,1);
  assert.ok(turning.gimbal>0);
});

test('checkpoint preserves killed raiders and salvage rather than respawning on refresh',()=>{
  const callbacks=extract('captureEncounter','accel');
  const state={
    t:45,reinforcements:false,nextEnemySpawn:75,targetId:'raider-02',playerKills:1,
    enemies:[{id:'raider-01',alive:false,x:280,y:0,vx:0,vy:33,trail:[{x:1,y:2}]},
      {id:'raider-02',alive:true,x:320,y:0,vx:0,vy:31,trail:[]}],
    ally:{id:'ally-01',alive:true,x:270,y:0,vx:0,vy:34,trail:[]},
    pickups:[{id:'wreck-raider-01',type:'wreck',alive:true,x:280,y:0,vx:0,vy:33}],
    lastPrediction:0,lastBallistic:0
  };
  let changed=0;
  const events=[];
  const context={state,updateTargetOptions:()=>changed++,updateHud:()=>{},
    logEvent:msg=>events.push(msg)};
  const snapshot=vm.runInNewContext(callbacks+'\ncaptureEncounter();',context,{timeout:1000});
  assert.equal(snapshot.enemies[0].alive,false);
  assert.equal(snapshot.enemies[0].trail.length,0);
  state.enemies=[];
  vm.runInNewContext(callbacks+'\nrestoreEncounter({snapshot});',{...context,snapshot},{timeout:1000});
  assert.equal(state.enemies.length,2);
  assert.equal(state.enemies[0].alive,false);
  assert.equal(state.pickups[0].id,'wreck-raider-01');
  assert.equal(changed,1);
});
