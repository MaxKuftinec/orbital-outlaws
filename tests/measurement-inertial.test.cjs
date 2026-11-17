const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const moduleContext={module:{exports:{}}};
vm.runInNewContext(read('frontend/public/legacy/map-tools.js'),moduleContext);
const MAP=moduleContext.module.exports;

test('measurement anchors stay at the same inertial position under frame changes',()=>{
  const p0={x:4e7,y:1e7},p1={x:4e7+10000,y:1e7+5000};
  const veyra={object:'veyra'},kestrel={object:'kestrel'};
  assert.equal(MAP.anchorAt(veyra,p0).x,0);
  assert.equal(MAP.anchorAt(kestrel,p0).x,p0.x);
  assert.equal(MAP.anchorAt(kestrel,p1).x,p1.x,'planet anchor follows its orbital motion');
  const arbitrary={frame:'star',x:9e6,y:7e6};
  assert.equal(MAP.anchorAt(arbitrary,p0).x,9e6);
  assert.equal(MAP.anchorAt(arbitrary,p1).x,9e6,'unattached point does not follow Kestrel');
  // Switching a camera origin never changes physical ruler distance.
  const d0=MAP.distance(MAP.anchorAt(veyra,p0),MAP.anchorAt(arbitrary,p0));
  const d1=MAP.distance(MAP.anchorAt(veyra,p1),MAP.anchorAt(arbitrary,p1));
  assert.equal(d0,d1);
});

test('ruler endpoints track living spacecraft by object key',()=>{
  const anchor={object:'ship:raider-1'};
  const planet={x:1000,y:2000};
  const shipA={x:35,y:9},shipB={x:45,y:11};
  assert.equal(MAP.anchorAt(anchor,planet,{'ship:raider-1':shipA}).x,1035);
  assert.equal(MAP.anchorAt(anchor,planet,{'ship:raider-1':shipB}).x,1045);
  assert.equal(MAP.anchorAt(anchor,planet,{}),null);
});

test('compass bearings are inertial north clockwise via east',()=>{
  const center={x:0,y:0};
  assert.equal(MAP.bearing(center,{x:0,y:-100}),0);
  assert.equal(MAP.bearing(center,{x:100,y:0}),90);
  assert.equal(MAP.bearing(center,{x:0,y:100}),180);
  assert.equal(MAP.bearing(center,{x:-100,y:0}),270);
  assert.equal(MAP.bearing(center,center),null);
  assert.match(MAP.bearingLabel(90),/90.0°/);
});

test('long segments are clipped to the viewport before rasterization',()=>{
  const clipped=MAP.clipSegment({x:-1e12,y:300},{x:1e12,y:300},800,600,0);
  assert.ok(clipped);
  assert.ok(Math.abs(clipped[0].x)<=.001);
  assert.ok(Math.abs(clipped[1].x-800)<=.001);
  assert.equal(MAP.clipSegment({x:900,y:800},{x:1400,y:1000},800,600),null);
});

test('ruler/compass instrument has snap, independent stellar anchors and bounded line drawing',()=>{
  const game=read('frontend/public/legacy/game.js');
  const app=read('frontend/src/App.vue');
  const rendering=read('frontend/public/legacy/rendering.js');
  assert.match(game,/measurementAnchor\(pt,fromScreen\(pt\.px,pt\.py\)\)/);
  assert.match(game,/frame:'star',x:local\.x\+planet\.x,y:local\.y\+planet\.y/);
  assert.match(game,/getMeasurementPoint/);
  assert.match(app,/id="compass-toggle"/);
  assert.match(rendering,/clipSegment\(a,b,W,H,8\)/);
  assert.match(rendering,/getMeasurementPoint/);
});
