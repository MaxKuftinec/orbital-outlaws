const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const load=p=>{
  const ctx={module:{exports:{}}};
  vm.runInNewContext(read(p),ctx);
  return ctx.module.exports;
};
const STAR=load('frontend/public/legacy/star-system.js');
const FRAMES=load('frontend/public/legacy/reference-frames.js');
const game=read('frontend/public/legacy/game.js');
const renderer=read('frontend/public/legacy/rendering.js');
const app=read('frontend/src/App.vue');
const workspace=read('frontend/public/legacy/workspace.js');
const ui=read('frontend/src/components/TelemetryPanel.vue');
const types=read('frontend/src/services/instruments.ts');

test('historical trail samples use the planet ephemeris at each sample epoch',()=>{
  const tNow=1200;
  const samples=[
    {x:260,y:20,t:100},
    {x:300,y:40,t:130},
    {x:340,y:65,t:180}
  ];
  const planetNow=STAR.planet(tNow);
  const mapped=samples.map(p=>FRAMES.mapSample(p,tNow,true,STAR.planet));
  for(let i=0;i<samples.length;i++){
    const before=STAR.planet(samples[i].t);
    assert.ok(Math.hypot(mapped[i].x+planetNow.x-(samples[i].x+before.x),
      mapped[i].y+planetNow.y-(samples[i].y+before.y))<1e-8);
    assert.equal(FRAMES.mapSample(samples[i],tNow,false,STAR.planet),samples[i],
      'planet-relative trail is unchanged');
  }
  assert.equal(FRAMES.mapSample({x:260,y:0},tNow,true,STAR.planet),null,
    'do not guess missing epoch on old trail samples');
  const incorrectlyShifted=samples[0].x+planetNow.x;
  assert.ok(Math.abs(samples[0].x+STAR.planet(samples[0].t).x-incorrectlyShifted)>1000);
});

test('instantaneous telemetry follows planet or star origin and velocity without changing ship',()=>{
  const ship={x:260,y:-20,vx:4,vy:30};
  const copy={...ship},at=600;
  const planet=FRAMES.telemetry(ship,at,false,STAR,85);
  const stellar=FRAMES.telemetry(ship,at,true,STAR,85);
  const center=STAR.planet(at);
  assert.equal(planet.frame,'Kestrel');
  assert.equal(stellar.frame,'Veyra');
  assert.ok(Math.abs(planet.r-Math.hypot(ship.x,ship.y))<1e-10);
  assert.ok(Math.abs(planet.v-Math.hypot(ship.vx,ship.vy))<1e-10);
  assert.ok(Math.abs(stellar.r-Math.hypot(ship.x+center.x,ship.y+center.y))<1e-8);
  assert.ok(Math.abs(stellar.v-Math.hypot(ship.vx+center.vx,ship.vy+center.vy))<1e-9);
  assert.ok(Math.abs(stellar.altitude-(stellar.r-STAR.STAR_RADIUS_KM))<1e-8);
  assert.ok(planet.period!==stellar.period);
  assert.deepEqual(ship,copy,'telemetry must never alter the authoritative ship');
  assert.match(stellar.model,/two-body/);
});

test('real trajectory draws timestamped histories and star-frame prediction, but not planet-only NAV plan',()=>{
  assert.match(game,/ship\.trail\.push\(\{x:ship\.x,y:ship\.y,t:state\.t\}\)/);
  assert.match(game,/out\.push\(\{x:ghost\.x,y:ghost\.y,t:sampleT\}\)/);
  assert.match(renderer,/points\.map\(p=>getFrameSample\(p\)\)\.filter\(Boolean\)/);
  assert.match(renderer,/if\(state\.navPlan&&!state\.systemView\)/);
  assert.match(renderer,/e\.isAlly\?'#67e0aa55':'#ff718433',1\.5,\[\],true\)/);
});

test('telemetry panel announces selected reference body and multi-body caveat',()=>{
  assert.match(ui,/telemetry\.frame\.toUpperCase\(\)/);
  assert.match(ui,/Reference origin: \{\{ telemetry\.frame \}\}/);
  assert.match(ui,/Instantaneous conic/);
  assert.match(types,/frame: string; model: string/);
  assert.match(game,/FRAMES\.telemetry\(b,state\.t,!!state\.systemView,STAR,WORLD\.radius\)/);
});

test('map distance scale is an unboxed bottom-right overlay, ruler moves into Tools left of Panels',()=>{
  assert.match(app,/id="map-scale-overlay" class="map-scale-readout"/);
  assert.match(app,/id="map-measure-tools"/);
  const a=app.indexOf('id="map-measure-tools"');
  const b=app.indexOf('id="map-scale-overlay"');
  assert.ok(a>0&&b>a);
  assert.ok(app.slice(a,b).indexOf('id="map-scale-bar"')<0);
  assert.match(workspace,/toolsButton\.id='map-tools-btn'/);
  assert.match(workspace,/toolsMenu\.id='map-tools-menu'/);
  assert.match(workspace,/toolsMenu\.append\(measure\)/);
  assert.match(workspace,/toolbar\.append\(toolsButton,picker,fullscreen,toolsMenu,menu\)/);
  assert.match(workspace,/setToolsOpen\(false\)/);
  const css=read('frontend/src/cockpit.css');
  assert.match(css,/#canvas-workspace #map-scale-overlay/);
  assert.match(css,/#canvas-workspace \.map-tools-popover\[hidden\]\{display:none\}/);
});
