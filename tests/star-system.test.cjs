const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const context={module:{exports:{}}};
vm.runInNewContext(read('frontend/public/legacy/star-system.js'),context);
const STAR=context.module.exports;
const game=read('frontend/public/legacy/game.js');
const app=read('frontend/src/App.vue');
const renderer=read('frontend/public/legacy/rendering.js');

test('parent star is fixed in star-centered coordinates and planet follows a real circular orbit',()=>{
  const a=STAR.planet(0),b=STAR.planet(STAR.PERIOD_S/4),z=STAR.planet(STAR.PERIOD_S);
  assert.ok(Math.abs(Math.hypot(a.x,a.y)-STAR.ORBIT_RADIUS_KM)<1e-7);
  assert.ok(Math.hypot(a.x-z.x,a.y-z.y)<1e-7);
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>STAR.ORBIT_RADIUS_KM);
  const sun=STAR.star(0);
  assert.ok(Math.abs(sun.x+a.x)<1e-7&&Math.abs(sun.y+a.y)<1e-7);
  const t=STAR.tidalAcceleration(0,0,STAR.PERIOD_S/3);
  assert.ok(Math.hypot(t.x,t.y)<1e-10);
});

test('system and planet map controls are mounted and star/planet selectable',()=>{
  assert.match(app,/id="settings-frame-star"/);
  assert.match(app,/id="settings-frame-planet"/);
  assert.doesNotMatch(app,/id="system-map-btn"/);
  assert.doesNotMatch(app,/id="planet-map-btn"/);
  assert.match(app,/'star-system\.js'/);
  assert.match(game,/if\(key==='star'\)return STAR\.star\(state\.t\)/);
  assert.match(game,/if\(key==='planet'\)return \{id:'kestrel'/);
  assert.match(game,/Interplanetary guidance is not yet supported/);
  assert.match(game,/state\.systemView\?STAR\.planet\(state\.t\)/);
  assert.match(renderer,/drawParentStar\(\)/);
  assert.match(renderer,/ORBIT_RADIUS_KM\*s/);
});

function makeCamera(){
  const obj={textContent:'',style:{},classList:{toggle(){}},setAttribute(){}};
  const state={systemView:false,t:0,zoom:1,panX:0,panY:0,
               followPlayer:false,followTarget:false,player:{x:100,y:0}};
  const MAP={niceScale:()=>({km:100,pixels:50,label:'100 km'})};
  const ctx={state,STAR,MAP,FRAME_KEY:'test-frame',localStorage:{setItem(){}},
    W:1000,H:600,clamp:(x,min,max)=>Math.max(min,Math.min(max,x)),
    logEvent:()=>{},updateHud:()=>{},$:()=>obj,Math};
  vm.createContext(ctx);
  const begin=game.indexOf('  function cameraOffset(){');
  const end=game.indexOf('  function fitCanvas(){',begin);
  const geomStart=game.indexOf('  function scale(){');
  const geomEnd=game.indexOf('  const renderer=',geomStart);
  assert.ok(begin>=0&&end>begin&&geomStart>=0&&geomEnd>geomStart);
  vm.runInContext(game.slice(begin,end)+game.slice(geomStart,geomEnd),ctx);
  return {ctx,state};
}
test('camera shows both bodies at system scale, star stays put while planet advances',()=>{
  const {ctx,state}=makeCamera();
  ctx.showSystemMap();
  assert.equal(state.systemView,true);
  const p=STAR.planet(state.t),sun=STAR.star(state.t);
  const planetPixel=ctx.toScreen(0,0),starPixel=ctx.toScreen(sun.x,sun.y);
  assert.ok(planetPixel.x>0&&planetPixel.x<1000);
  assert.ok(starPixel.x>0&&starPixel.x<1000);
  assert.ok(Math.abs(planetPixel.x-starPixel.x)>100);
  const local={x:52000,y:-19000};
  const mapped=ctx.toScreen(local.x,local.y);
  const back=ctx.fromScreen(mapped.x,mapped.y);
  assert.ok(Math.hypot(local.x-back.x,local.y-back.y)<1e-6);
  const fixed={...starPixel};
  state.t+=STAR.PERIOD_S/4;
  const sun2=STAR.star(state.t),star2=ctx.toScreen(sun2.x,sun2.y);
  assert.ok(Math.hypot(fixed.x-star2.x,fixed.y-star2.y)<1e-7);
  ctx.showPlanetMap();
  assert.equal(state.systemView,false);
  assert.equal(ctx.toScreen(0,0).x,500);
  assert.equal(ctx.toScreen(0,0).y,300);
});
test('system zoom preserves the world point beneath the cursor',()=>{
  const {ctx}=makeCamera();
  ctx.showSystemMap();
  const a=ctx.fromScreen(214,381);
  ctx.zoomAt(2,214,381);
  const b=ctx.fromScreen(214,381);
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-7);
});

test('system-map celestial markers take priority over the large zoom-scaled ship hitbox',()=>{
  const begin=game.indexOf("canvas.addEventListener('pointerdown'");
  const celestial=game.indexOf('if(state.systemView){',begin);
  const enemy=game.indexOf('for(const enemy of state.enemies)',begin);
  assert.ok(celestial>begin&&celestial<enemy);
});
