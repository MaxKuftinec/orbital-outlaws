const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('frontend/src/App.vue');
const game=read('frontend/public/legacy/game.js');
const renderer=read('frontend/public/legacy/rendering.js');
const targeting=read('frontend/src/components/TargetingPanel.vue');
const sandbox={module:{exports:{}}};
vm.runInNewContext(read('frontend/public/legacy/map-tools.js'),sandbox);
const MAP=sandbox.module.exports;

test('version 1.0 and named Veyra star appear in the user-facing interface',()=>{
  assert.match(app,/VERSION 1\.1/);
  assert.match(app,/Orbital Outlaws · v1\.1/);
  assert.match(app,/id="settings-btn"[^>]*>⚙ Settings/);
  assert.ok(!app.includes('id="system-map-btn"'));
  assert.ok(!app.includes('id="planet-map-btn"'));
  assert.match(app,/id="settings-frame-star"/);
  assert.match(game,/VEYRA/);
});
test('frame settings and axes are separated from hotkeys, browser persistent, and camera-only',()=>{
  for(const id of ['settings-tab-controls','settings-tab-frame','settings-controls-pane',
                   'settings-frame-pane','settings-frame-planet','settings-frame-star','settings-show-axes'])
    assert.ok(app.includes('id="'+id+'"'),'Missing '+id);
  assert.match(game,/function settingsTab\(tab\)/);
  assert.match(game,/function storedFrame\(\)/);
  assert.match(game,/function storedAxes\(\)/);
  assert.match(game,/localStorage\.setItem\(AXES_KEY,String\(state\.showAxes\)\)/);
  assert.match(renderer,/const origin=state\.systemView\?getSystem\(\)\.star\(state\.t\):\{x:0,y:0\}/);
  assert.match(renderer,/if\(state\.showAxes!==false\)/);
  assert.match(renderer,/drawCentralBody\(planetCenter\.x,planetCenter\.y,s\)/);
});
test('scale bar uses 1–2–5 progression and reflects zoom over orders of magnitude',()=>{
  for(const pxPerKm of [6,2,.5,.0007,.000001,90]){
    const scale=MAP.niceScale(pxPerKm,110);
    assert.ok(scale.km>0);
    assert.ok(scale.pixels>40&&scale.pixels<=110.00001,
      JSON.stringify({pxPerKm,scale}));
    assert.ok(scale.label.endsWith('km')||scale.label.endsWith('m'));
  }
  assert.match(app,/id="map-scale-label"/);
  assert.match(app,/id="map-scale-bar"/);
  assert.match(game,/MAP\.niceScale\(scale\(\)\)/);
  assert.match(game,/\$\('map-scale-bar'\)\.style\.width/);
});
function rulerHarness(){
  const elems=new Map();
  const $=id=>{
    if(!elems.has(id))elems.set(id,{
      textContent:'',style:{},disabled:false,checked:false,
      classList:{toggle:()=>{}},setAttribute:()=>{}});
    return elems.get(id);
  };
  const state={zoom:1,systemView:false,showAxes:true,
    player:{fuel:120,vx:33,vy:-5},
    measurement:{enabled:false,start:null,end:null,hover:null}};
  const ctx={state,MAP,$,scale:()=>.6};
  vm.createContext(ctx);
  const from=game.indexOf('  function updateMapScale(){');
  const to=game.indexOf('  function zoomAt(',from);
  assert.ok(from>0&&to>from);
  vm.runInContext(game.slice(from,to),ctx);
  return {ctx,state,elems};
}
test('ruler measures any two points without changing flight, and can be cleared',()=>{
  const {ctx,state,elems}=rulerHarness();
  const shipBefore={...state.player};
  ctx.toggleRuler();
  assert.equal(state.measurement.enabled,true);
  ctx.chooseRulerPoint({x:100,y:10});
  state.measurement.hover={x:103,y:14};
  ctx.updateRulerUI();
  assert.match(elems.get('ruler-distance').textContent,/5 km · preview/);
  ctx.chooseRulerPoint({x:103,y:14});
  assert.equal(MAP.distance(state.measurement.start,state.measurement.end),5);
  assert.equal(elems.get('ruler-distance').textContent,'5 km');
  ctx.clearRuler();
  assert.equal(state.measurement.start,null);
  assert.equal(state.measurement.end,null);
  assert.deepEqual(state.player,shipBefore);
  assert.match(game,/if\\(state\\.measurement\\.enabled\\)\\{\\s*e\\.preventDefault\\(\\);chooseRulerPoint\\(measurementAnchor\\(pt,p\\)\\);return;/);
  assert.match(renderer,/function drawMeasurement\(\)/);
});
test('projectile ETA remains hidden until Predictive Fire Control is owned',()=>{
  assert.match(game,/shotTime:!state\.predictive\?'Requires predictive fire control'/);
  assert.match(game,/setLegacyText\('shot-time',!state\.predictive/);
  assert.match(renderer,/state\.predictive\?preview\.arrivalTime\.toFixed\(2\)\+'s':'ETA LOCKED'/);
  assert.match(targeting,/Bullet ETA requires Predictive Fire Control/);
});
