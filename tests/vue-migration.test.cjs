const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('frontend/src/App.vue');
const game=read('frontend/public/legacy/game.js');
const rendering=read('frontend/public/legacy/rendering.js');

test('telemetry targeting and navigation are Vue Options API instruments',()=>{
  for(const name of ['TelemetryPanel','TargetingPanel','NavigationPanel']){
    const source=read('frontend/src/components/'+name+'.vue');
    assert.match(source,/defineComponent\(/);
    assert.match(app,new RegExp('<'+name+'(?:\\s|\\s+:console=)'));
    assert.match(source,/data-vue-managed="true"/);
  }
  const events=read('frontend/src/services/instruments.ts');
  for(const kind of ['orbital-telemetry-state','orbital-targeting-state','orbital-navigation-state'])
    assert.ok(events.includes(kind));
});

test('canvas renderer is standalone and death never covers the arena',()=>{
  assert.match(app,/'rendering\.js', 'game\.js'/);
  assert.match(rendering,/root\.OrbitalRenderer/);
  assert.match(rendering,/function drawEphemeris\(/);
  assert.match(game,/window\.OrbitalRenderer\.create/);
  assert.doesNotMatch(game,/function drawBackground\(/);
  assert.doesNotMatch(rendering,/function stepBody\(/);
  assert.match(app,/id="game-over" hidden style="display:none"/);
  assert.doesNotMatch(app,/<h2[^>]*>SHIP LOST<\/h2>/);
  assert.match(game,/if\(state\.ended\|\|!state\.player\.alive\)return;/);
});

test('client routes and Vite proxy have no /api prefix',()=>{
  const proxy=read('frontend/vite.config.ts');
  const persistence=read('frontend/public/legacy/persistence.js');
  assert.match(proxy,/'\/players':/);
  assert.match(proxy,/'\/worlds':/);
  assert.match(proxy,/'\/dev':/);
  assert.ok(persistence.includes("+'/players/'+auth.id+'/live'"));
  assert.match(persistence,/new WebSocket\\(address,\\['orbital-v1','auth\\.'\\+auth\\.token\\]\\)/);
  assert.ok(!persistence.includes("localStorage.setItem('orbital-outlaws.pilot.v1'"));
  assert.doesNotMatch(persistence,/\/api\/players/);
});

test('navigation reports budget vs unsolved geometry',()=>{
  const nav=require('../navigation.js');
  const v=Math.sqrt(310000/260);
  const start={x:260,y:0,vx:0,vy:v};
  let diagnostic=null;
  nav.plan(start,{x:260,y:0,vx:0,vy:-v},{
    mu:310000,waits:[0],flights:[10],massKg:1100,
    propellantKg:.001,onDiagnostics:d=>diagnostic=d
  });
  assert.ok(diagnostic);
  assert.ok(diagnostic.maxDv>0);
  assert.equal(diagnostic.samples,1);
});


test('fuel donation is Vue-owned and does not require a legacy DOM node at initialization',()=>{
  const nav=read('frontend/src/components/NavigationPanel.vue');
  assert.match(nav,/@click="offerFuel"/);
  assert.match(nav,/orbital-offer-fuel/);
  assert.match(game,/window.addEventListener\('orbital-offer-fuel',donateFuelToAlly\)/);
  assert.doesNotMatch(game,/\$\('escort-donate-btn'\)\.addEventListener/);
  assert.doesNotMatch(game,/\$\('escort-donate-btn'\)\.disabled/);
});


test('capture rig is exposed in the reactive marketplace with persistent ownership',()=>{
  const market=read('frontend/src/components/TechnologyMarket.vue');
  const types=read('frontend/src/services/cockpit.ts');
  const store=read('backend/app/store.py');
  const physics=read('backend/app/universe.py');
  assert.match(market,/key: 'capture'/);
  assert.match(market,/price: 55/);
  assert.match(types,/\| 'capture'/);
  assert.match(store,/'capture':55/);
  assert.match(physics,/capture_limit = 8\./);
});

test('Vue-owned instrument DOM is never mutated directly by the legacy HUD',()=>{
  const ids=['alt-value','speed-value','peri-value','apo-value','period-value','path-status',
    'target-name','target-state','range-value','target-hull','shot-time','shot-miss',
    'nav-status','nav-dv','nav-eta','nav-fuel','nav-engage','nav-abort',
    'nav-quick-status','nav-quick-metrics','quick-alt','quick-speed','quick-peri',
    'quick-apo','quick-reserve','quick-flight'];
  const hud=game.slice(game.indexOf('function updateHud()'),game.indexOf('function updateZoom()'));
  for(const id of ids){
    assert.ok(!hud.includes("$('"+id+"').textContent"),id+' direct text mutation');
    assert.ok(!hud.includes("$('"+id+"').disabled"),id+' direct disabled mutation');
    assert.ok(!hud.includes("$('"+id+"').style"),id+' direct style mutation');
  }
  assert.ok(game.includes('function legacyNode(id)'));
  assert.ok(game.includes("node.closest('[data-vue-managed="+'"'+'true'+'"' + "]')"));
});


test('capture heat and physical cargo are exposed in the cockpit without direct DOM writes',()=>{
  const component=read('frontend/src/components/ShipPanel.vue');
  const types=read('frontend/src/services/cockpit.ts');
  assert.match(component,/Grapple heat/);
  assert.match(component,/Recovered cargo/);
  assert.match(types,/captureHeatMJ: number/);
  assert.ok(game.includes('captureHeatMJ:p.captureHeatMJ||0'));
  assert.match(game,/function renderServerBodies\(dt\)/);
  assert.match(game,/burn\.remainingDv/);
});


test('compact navigation and telemetry consoles are mounted alongside the sidebar counterparts',()=>{
  const app=read('frontend/src/App.vue');
  const nav=read('frontend/src/components/NavigationPanel.vue');
  assert.match(app,/<NavigationPanel\s+:console="true"\s*\/>/);
  assert.match(app,/<NavigationPanel\s*\/>/);
  assert.match(app,/<TelemetryPanel\s+:console="true"\s*\/>/);
  assert.match(app,/<TelemetryPanel\s*\/>/);
  assert.match(nav,/v-if="console" class="nav-command"/);
  assert.match(nav,/v-else class="panel autopilot-panel"/);
  assert.match(nav,/id="nav-console-fuel-reserve-kg"/);
  assert.match(nav,/id="fuel-reserve-kg"/);
});

test('fuel reserve input is not overwritten while typing during frequent game events',()=>{
  const nav=read('frontend/src/components/NavigationPanel.vue');
  assert.match(nav,/if\(!this\.editingReserve\)this\.reserveDraft=String\(this\.navigation\.reserveKg\)/);
  assert.match(nav,/@focus="beginReserveEdit"/);
  assert.match(nav,/@blur="finishReserveEdit"/);
  assert.match(nav,/new CustomEvent\('orbital-set-reserve',\{detail:\{kg\}\}\)/);
});
