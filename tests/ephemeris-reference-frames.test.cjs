const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const STAR=require('../frontend/public/legacy/star-system.js');
const NAV=require('../frontend/public/legacy/navigation.js');

function makeSettings(){
  const stored=new Map();
  const events=[];
  const win={
    localStorage:{getItem:key=>stored.has(key)?stored.get(key):null,
      setItem:(key,value)=>{stored.set(key,String(value))}},
    dispatchEvent:event=>events.push(event.type)
  };
  const ctx={window:win,Event:class{constructor(type){this.type=type}},Math,Number};
  vm.runInNewContext(read('frontend/public/legacy/frame-config.js'),ctx);
  return {config:win.OrbitalFrameConfig,stored,events};
}

test('Kestrel and Veyra Ephemeris frames are independent of the canvas frame',()=>{
  const {config,stored,events}=makeSettings();
  assert.equal(config.getFrame('ephemeris'),'planet');
  assert.equal(config.getScope(),'canvas');
  assert.equal(config.setFrame('ephemeris','star'),true);
  stored.set(config.FRAME_KEY,'planet');
  config.applyCanvasChange('planet');
  assert.equal(config.getFrame('ephemeris'),'star');
  assert.equal(config.setScope('all'),true);
  assert.equal(config.getFrame('ephemeris'),'planet'); // synchronized immediately
  config.setFrame('ephemeris','star'); // instrument-local override still permitted
  assert.equal(config.getFrame('ephemeris'),'star');
  config.applyCanvasChange('planet'); // next explicit canvas selection rebroadcasts
  assert.equal(config.getFrame('ephemeris'),'planet');
  config.setScope('canvas');
  config.setFrame('ephemeris','star');
  config.applyCanvasChange('planet');
  assert.equal(config.getFrame('ephemeris'),'star');
  assert.ok(events.includes('orbital-reference-frames-updated'));
  assert.ok(events.includes('orbital-preferences-changed'));
  assert.equal(config.setFrame('ephemeris','jupiter'),false);
  assert.equal(config.setScope('universal'),false);
});

test('Veyra-frame prediction translates each future point by Kestrel actual orbital displacement',()=>{
  const {config}=makeSettings();
  const t0=5_000_000;
  const points=[{x:270,y:0,t:0},{x:270,y:0,t:60},{x:270,y:0,t:120}];
  const local=config.projectTrace(points,t0,'planet',STAR.planet);
  const stellar=config.projectTrace(points,t0,'star',STAR.planet);
  assert.equal(local.length,3);
  assert.equal(stellar.length,3);
  for(let i=0;i<points.length;i++){
    const now=STAR.planet(t0),then=STAR.planet(t0+points[i].t);
    assert.ok(Math.abs(local[i].x-270)<1e-12);
    assert.ok(Math.abs(local[i].y)<1e-12);
    assert.ok(Math.abs(stellar[i].x-(270+then.x-now.x))<1e-8);
    assert.ok(Math.abs(stellar[i].y-(then.y-now.y))<1e-8);
  }
  assert.ok(Math.hypot(stellar[2].x-local[2].x,stellar[2].y-local[2].y)>100);
  const marker=config.projectPoint({x:300,y:20},60,t0,'star',STAR.planet);
  assert.ok(Math.hypot(marker.x-stellar[1].x,marker.y-stellar[1].y)>0);
});

test('Ephemeris time sampling records the correct future epoch for path and ETA markers',()=>{
  const mu=310000,T=180,r=280,v=Math.sqrt(mu/r);
  const predicted=NAV.propagate({x:r,y:0,vx:0,vy:v},T,mu,.7,91,100000,true);
  assert.equal(predicted.safe,true);
  assert.equal(predicted.points[0].t,0);
  assert.equal(predicted.points.at(-1).t,T);
  assert.ok(predicted.points.length>3);
  for(let i=1;i<predicted.points.length;i++)
    assert.ok(predicted.points[i].t>=predicted.points[i-1].t);
  const renderer=read('frontend/public/legacy/rendering.js');
  assert.match(renderer,/frames\.projectTrace\(path\.points,state\.t,frame,getSystem\(\)\.planet\)/);
  assert.match(renderer,/frames\.projectPoint\(m,\(i\+1\)\*60,state\.t,frame,getSystem\(\)\.planet\)/);
});

test('Ephemeris and canvas reference frame controls remain available in desktop and mobile settings',()=>{
  const app=read('frontend/src/App.vue');
  const market=read('frontend/src/components/TechnologyMarket.vue');
  const frontend=read('frontend/src/services/preferences.ts');
  const backend=read('backend/app/account_settings.py');
  for(const id of ['settings-tab-ephemeris','settings-ephemeris-frame-planet',
      'settings-ephemeris-frame-star','settings-frame-scope-canvas','settings-frame-scope-all',
      'ephemeris-settings-btn'])assert.ok(app.includes('id="'+id+'"'),id);
  assert.match(market,/id="ephemeris-market-frame"/);
  assert.match(market,/market\.owned\.ephemeris/);
  assert.match(frontend,/ephemeris_frame/);
  assert.match(frontend,/frame_scope/);
  assert.match(backend,/Invalid Ephemeris reference frame/);
  assert.match(backend,/Invalid frame propagation scope/);
});
