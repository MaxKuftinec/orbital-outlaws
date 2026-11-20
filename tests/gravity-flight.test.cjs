const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function load(file){
  const env={module:{exports:{}},Math};
  vm.runInNewContext(read(file),env);
  return env.module.exports;
}
const GRAV=load('frontend/public/legacy/gravity-flight.js');
const STAR=load('frontend/public/legacy/star-system.js');
const snapshot={time:234589,systemView:false,
  ships:[{id:'pilot',name:'PILOT',x:140,y:-27,alive:true,player:true}]};

test('cockpit well scene represents the actual time-dependent celestial bodies',()=>{
  const planet=GRAV.world(snapshot,STAR);
  assert.equal(planet.bodies.length,2);
  assert.equal(planet.bodies[0].name,'VEYRA');
  assert.equal(planet.bodies[1].name,'KESTREL');
  assert.equal(planet.bodies[1].x,0);
  assert.equal(planet.bodies[0].mu,STAR.STAR_MU);
  assert.equal(planet.bodies[1].mu,STAR.PLANET_MU);
  const star=STAR.star(snapshot.time);
  assert.ok(Math.hypot(planet.bodies[0].x-star.x,planet.bodies[0].y-star.y)<1e-7);
  const system=GRAV.world({...snapshot,systemView:true},STAR);
  const pos=STAR.planet(snapshot.time);
  assert.ok(Math.hypot(system.bodies[0].x,system.bodies[0].y)<1e-10);
  assert.ok(Math.hypot(system.bodies[1].x-pos.x,system.bodies[1].y-pos.y)<1e-7);
  assert.ok(Math.abs(system.ships[0].x-planet.ships[0].x-pos.x)<1e-7);
  assert.ok(Math.abs(system.ships[0].y-planet.ships[0].y-pos.y)<1e-7);
  const current=GRAV.field(planet,planet.ships[0].x,planet.ships[0].y);
  const translated=GRAV.field(system,system.ships[0].x,system.ships[0].y);
  assert.ok(Math.abs(current.phi-translated.phi)<1e-9);
  assert.ok(Math.hypot(current.gx-translated.gx,current.gy-translated.gy)<1e-8);
});

test('axis windows are linear, independent and physically meaningful',()=>{
  const scene=GRAV.world(snapshot,STAR);
  for(const focus of ['kestrel','veyra','system']){
    const axes=GRAV.axesFor(scene,focus);
    assert.ok(GRAV.validAxes(axes),focus);
    assert.ok(axes.zMin<axes.zMax,focus);
    const center=focus==='kestrel'?scene.bodies[1]:focus==='veyra'?scene.bodies[0]:null;
    if(center){
      assert.ok(axes.xMin<center.x&&center.x<axes.xMax);
      assert.ok(axes.yMin<center.y&&center.y<axes.yMax);
    }
  }
  const a=GRAV.axesFor(scene,'kestrel');
  assert.ok(!GRAV.validAxes({...a,xMin:a.xMax}));
  assert.ok(!GRAV.validAxes({...a,zMin:a.zMax}));
  const p=GRAV.plotPoint(0,0,0,{xMin:-100,xMax:100,yMin:-100,yMax:100,zMin:-20,zMax:20},800,500,{yaw:0,pitch:1,depth:1});
  const q=GRAV.plotPoint(100,0,0,{xMin:-100,xMax:100,yMin:-100,yMax:100,zMin:-20,zMax:20},800,500,{yaw:0,pitch:1,depth:1});
  assert.ok(q.x>p.x);
  const deeper=GRAV.plotPoint(0,0,-10,{xMin:-100,xMax:100,yMin:-100,yMax:100,zMin:-20,zMax:20},800,500,{yaw:0,pitch:1,depth:1});
  assert.ok(deeper.y>p.y);
});

test('live Kestrel and Veyra are gravitational sources, not decorative backdrops',()=>{
  const scene=GRAV.world(snapshot,STAR);
  const star=scene.bodies[0],planet=scene.bodies[1];
  const mid={x:(star.x+planet.x)/2,y:(star.y+planet.y)/2};
  const f=GRAV.field(scene,mid.x,mid.y);
  assert.ok(Number.isFinite(f.phi)&&Number.isFinite(f.g));
  assert.ok(f.phi<0);
  const p=GRAV.field(scene,planet.x,planet.y);
  assert.ok(p.phi<f.phi,'planetary well is deeper close to Kestrel in a locally zoomed plot');
});

test('the well renderer caches its mesh while refreshing live contacts via animation frames',()=>{
  const comp=read('frontend/src/components/GravityFlightView.vue');
  const app=read('frontend/src/App.vue');
  const css=read('frontend/src/gravity-flight.css');
  assert.match(app,/openPhysics\(\)/);
  assert.match(app,/visualization==='wells'/);
  assert.match(app,/view==='physics'/);
  assert.match(comp,/:value="axes\[\(axis\+'Min'\)/);
  assert.match(comp,/:value="axes\[\(axis\+'Max'\)/);
  assert.match(comp,/@wheel="wheel"/);
  assert.match(css,/\.physics-page \.physics-scene/);
  assert.match(comp,/requestAnimationFrame\(this\.frame\)/);
  assert.match(comp,/paintSurface\(/);
  assert.match(comp,/drawEntities\(/);
  assert.match(comp,/lastSurfaceAt>650/);
  assert.match(comp,/resetOverhead\(/);
  const scene=GRAV.world(snapshot,STAR),axes=GRAV.axesFor(scene,'kestrel');
  const ctx={
    createLinearGradient(){return {addColorStop(){}}},fillRect(){},beginPath(){},
    moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){},arc(){},translate(){},bezierCurveTo(){},rect(){},clip(){},setLineDash(){},
    fillText(){},save(){},restore(){},
    set fillStyle(x){},set strokeStyle(x){},set font(x){},
    set textAlign(x){},set lineWidth(x){}
  };
  const result=GRAV.paint(ctx,800,540,scene,axes,{detail:24});
  assert.equal(result.count,24);
  assert.equal(result.quads,24*24);
});

test('default overhead gravity view aligns pixel-for-pixel with the Flight camera',()=>{
  const cam={width:840,height:550,scale:1.2,panX:90,panY:-48}
  const snap={...snapshot,camera:cam}
  const scene=GRAV.world(snap,STAR)
  const axes=GRAV.axesFromCamera(scene,cam)
  const x=260,y=31
  const px=GRAV.plotPoint(x,y,GRAV.field(scene,x,y).phi,axes,cam.width,cam.height,{yaw:0,pitch:0,depth:1})
  assert.ok(Math.abs(px.x-(cam.width/2+cam.panX+x*cam.scale))<1e-6)
  assert.ok(Math.abs(px.y-(cam.height/2+cam.panY+y*cam.scale))<1e-6)
});

test('360-degree free camera rotation returns exactly to overhead',()=>{
  const a={xMin:-100,xMax:100,yMin:-100,yMax:100,zMin:-10,zMax:2}
  const first=GRAV.plotPoint(54,-36,-6,a,800,480,{yaw:0,pitch:0,depth:1})
  const once=GRAV.plotPoint(54,-36,-6,a,800,480,{yaw:Math.PI*2,pitch:Math.PI*2,depth:1})
  assert.ok(Math.hypot(first.x-once.x,first.y-once.y)<1e-8)
  const side=GRAV.plotPoint(54,-36,-6,a,800,480,{yaw:0,pitch:Math.PI/2,depth:1})
  assert.ok(Math.abs(side.y-first.y)>1)
});

test('real local salvage, allied craft, raiders and projectiles share the same transformation',()=>{
  const snap={...snapshot,
    ships:[{id:'p',x:0,y:0,player:true,type:'ship',alive:true},
      {id:'raider',x:200,y:100,type:'enemy',alive:true},
      {id:'ally',x:100,y:60,type:'ally',alive:true}],
    pickups:[{id:'c',type:'credits',amount:20,x:60,y:80,alive:true},
      {id:'w',type:'wreck',x:30,y:-50,alive:true},
      {id:'f',type:'fuel',x:70,y:85,alive:true},
      {id:'a',type:'ammo',x:25,y:30,alive:true},
      {id:'r',type:'parts',x:65,y:35,alive:true}],
    shots:[{id:'s',x:30,y:33,type:'shot',alive:true}],
    waypoint:{x:150,y:180}}
  const a=GRAV.world(snap,STAR)
  const b=GRAV.world({...snap,systemView:true},STAR)
  assert.equal(a.ships.length,3)
  assert.equal(a.pickups.length,5)
  assert.equal(a.shots.length,1)
  assert.equal(a.entities.length,10)
  const planet=STAR.planet(snap.time)
  for(let i=0;i<a.entities.length;i++){
    assert.ok(Math.abs((b.entities[i].x-a.entities[i].x)-planet.x)<1e-6)
    assert.ok(Math.abs((b.entities[i].y-a.entities[i].y)-planet.y)<1e-6)
  }
});
