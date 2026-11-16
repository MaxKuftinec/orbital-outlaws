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
  const a=game.indexOf('  function '+start+'('),b=game.indexOf('  function '+end+'(',a);
  assert.ok(a>=0&&b>a,'Expected functions '+start+' and '+end);
  return game.slice(a,b);
}

test('Vue matches Axore Options API convention',()=>{
  assert.match(app,/<script lang="ts">[\s\S]*defineComponent\(/);
  assert.match(app,/data\(\)\s*\{/);
  assert.match(app,/methods:\s*\{/);
  assert.doesNotMatch(app,/<script setup/);
});

test('every cockpit panel can dock, undock, minimize and drag; fullscreen keeps a HUD picker',()=>{
  const canvas=app.indexOf('id="canvas-workspace"');
  const ship=app.indexOf('<ShipPanel />');
  const aside=app.indexOf('<aside class="sidebar"');
  assert.ok(canvas>=0&&ship>canvas&&ship<aside);
  assert.match(workspace,/sidebar\.querySelectorAll\('\.panel'\)/);
  assert.match(workspace,/for\(const definition of panels\)/);
  assert.match(workspace,/hud-layout\.v2/);
  assert.match(workspace,/panel\.classList\.toggle\('hud-minimized'/);
  assert.match(workspace,/panel\.classList\.toggle\('hud-in-canvas'/);
  assert.match(workspace,/setPointerCapture/);
  assert.match(workspace,/requestFullscreen\(\)/);
  assert.match(workspace,/hud-picker-menu/);
});

test('autopilot gimbal ignores mouse hover, but manually controlled gimbal follows the mouse',()=>{
  const controls=extract('flightControls','applyFlightCorrection');
  const player={x:260,y:0,vx:0,vy:35,heading:0,omega:0,fuel:120,dryMass:900,repairParts:10,alive:true};
  const state={player,down:new Set(['main']),ended:false,gimbalTarget:{x:260,y:300},
    autopilot:{reserveKg:20},autoDirection:{x:1,y:0},autoBurnAllowed:true};
  const ENGINE={gimbalMax:.48869,rcsN:2500,leverM:7,shipLengthM:14};
  const ctx={state,ENGINE,Math,Number,aliveTarget:()=>null,shotDirection:()=>({x:1,y:0}),
    clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),
    normAngle:a=>Math.atan2(Math.sin(a),Math.cos(a)),
    mass:s=>s.dryMass+s.fuel+s.repairParts};
  const run=()=>vm.runInNewContext(controls+'\nflightControls();',ctx,{timeout:1000});
  const before=run();
  state.gimbalTarget={x:-200,y:0};
  const after=run();
  assert.equal(before.gimbal,after.gimbal);
  assert.equal(before.thrust,true);
  state.autopilot=null;
  const manual=run();
  assert.notEqual(manual.gimbal,before.gimbal);
});

test('persistent player simulation bypasses browser NPC AI and collision authority',()=>{
  assert.match(game,/if\(persistentFlight\)\{[\s\S]*renderServerBodies\(dt\);\s*return;\s*\}/);
  assert.match(game,/onEncounter:checkpoint=>\{restoreEncounter\(checkpoint\)/);
  assert.doesNotMatch(game,/pilotLink\?\.encounter/);
  assert.doesNotMatch(game,/pilotLink\?\.salvage/);
});

test('new ephemeris is a separate purchase and projects an object orbit',()=>{
  const market=fs.readFileSync(path.join(root,'frontend/src/components/TechnologyMarket.vue'),'utf8');
  assert.match(app,/<TechnologyMarket\s*\/>/);
  assert.match(market,/ephemeris-upgrade-btn/);
  assert.match(game,/ephemeris:\{flag:'ephemerisOwned',price:45/);
  assert.match(game,/purchaseUpgrade\(key\)/);
  assert.match(game,/function drawEphemeris\(\)/);
  assert.match(game,/NAV\.propagate\(target,180/);
});


test('panel headings are the only minimize controls, and Panels is left of Fullscreen',()=>{
  assert.match(workspace,/title\.dataset\.panelCollapse=''/);
  assert.match(workspace,/setCollapsed\(panel,!panel\.classList\.contains\('hud-minimized'\)\)/);
  assert.doesNotMatch(workspace,/data-panel-minimize|panelMinimize/);
  assert.match(workspace,/toolbar\.append\(picker,fullscreen,menu\)/);
  assert.match(game,/window\.OrbitalHUD\.togglePanelById\(id\)/);
  assert.match(game,/if\(arrow\)arrow\.textContent/);
});

test('all four upgrades use distinct Dota-like square icon atlas regions',()=>{
  const market=fs.readFileSync(path.join(root,'frontend/src/components/TechnologyMarket.vue'),'utf8');
  for(const kind of ['predictive','trajectory','nav','ephemeris'])
    assert.match(market,new RegExp("key: '"+kind+"'"));
  assert.match(market,/tech-icon--/);
  const css=fs.readFileSync(path.join(root,'frontend/src/cockpit.css'),'utf8');
  assert.match(css,/ability-icons\.webp/);
  assert.match(css,/background-size:200% 200%/);
  const atlas=fs.readFileSync(path.join(root,'frontend/public/tech/ability-icons.webp'));
  assert.equal(atlas.toString('ascii',0,4),'RIFF');
  assert.equal(atlas.toString('ascii',8,12),'WEBP');
});


test('Comms uses a real Options API Vue component and never receives legacy HTML injection',()=>{
  const comms=fs.readFileSync(path.join(root,'frontend/src/components/CommsPanel.vue'),'utf8');
  const bridge=fs.readFileSync(path.join(root,'frontend/src/services/comms.ts'),'utf8');
  assert.match(app,/import CommsPanel from '\.\/components\/CommsPanel\.vue'/);
  assert.match(app,/<CommsPanel\s*\/>/);
  assert.match(comms,/defineComponent\(/);
  assert.match(comms,/data\(\)/);
  assert.match(comms,/v-for="\(entry, index\) in entries"/);
  assert.match(comms,/data-vue-managed="true"/);
  assert.match(bridge,/export const COMMS_EVENT = 'orbital-comms'/);
  assert.match(game,/new CustomEvent\('orbital-comms'/);
  assert.match(game,/legacyFeed\.dataset\.vueManaged!=='true'/);
});

test('reinforcement button is removed from the cockpit',()=>{
  assert.doesNotMatch(app,/id="reinforce-btn"/);
  assert.doesNotMatch(game,/\$\('reinforce-btn'\)/);
});

test('Rendezvous has a new single-icon monitor image independent of the atlas',()=>{
  const css=fs.readFileSync(path.join(root,'frontend/src/cockpit.css'),'utf8');
  assert.match(css,/tech-icon\.tech-icon--rendezvous\{/);
  assert.match(css,/rendezvous-monitor\.webp/);
  const icon=fs.readFileSync(path.join(root,'frontend/public/tech/rendezvous-monitor.webp'));
  assert.equal(icon.toString('ascii',0,4),'RIFF');
  assert.equal(icon.toString('ascii',8,12),'WEBP');
});


test('Ship and Technology panels are genuine Options API components on one typed state bridge',()=>{
  const ship=fs.readFileSync(path.join(root,'frontend/src/components/ShipPanel.vue'),'utf8');
  const market=fs.readFileSync(path.join(root,'frontend/src/components/TechnologyMarket.vue'),'utf8');
  const bridge=fs.readFileSync(path.join(root,'frontend/src/services/cockpit.ts'),'utf8');
  assert.match(app,/import ShipPanel from '\.\/components\/ShipPanel\.vue'/);
  assert.match(app,/import TechnologyMarket from '\.\/components\/TechnologyMarket\.vue'/);
  assert.match(app,/<ShipPanel\s*\/>/);
  assert.match(app,/<TechnologyMarket\s*\/>/);
  assert.match(ship,/defineComponent\(/);
  assert.match(ship,/data\(\)/);
  assert.match(ship,/data-vue-managed="true"/);
  assert.match(ship,/id="ship-panel"/);
  assert.match(market,/data-vue-managed="true"/);
  assert.match(market,/@click="purchase\(offer\.key\)"/);
  assert.match(bridge,/COCKPIT_STATE_EVENT = 'orbital-cockpit-state'/);
  assert.match(bridge,/MARKET_PURCHASE_EVENT = 'orbital-market-purchase'/);
  assert.match(game,/new CustomEvent\('orbital-cockpit-state'/);
  assert.match(game,/window\.addEventListener\('orbital-market-purchase'/);
  assert.match(game,/dataset\.vueManaged!=='true'/);
});

test('incoming additional allies are rendered and retain server authority',()=>{
  assert.match(game,/state\.allies=mergeLiveBodies/);
  assert.match(game,/for\(const ally of state\.allies\|\|\[\]\)drawShip\(ally\)/);
});
