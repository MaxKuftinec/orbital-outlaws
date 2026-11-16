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
  assert.ok(persistence.includes("+'/players/'+pilotId()+'/live'"));
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
