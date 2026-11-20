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

test('fabric magnification changes screen proximity but not physical axis window or gravitational readings',()=>{
  const scene=GRAV.world(snapshot,STAR)
  const axes=GRAV.axesFromCamera(scene,{width:800,height:540,scale:1,panX:0,panY:0})
  const x=130,y=74,phi=GRAV.field(scene,x,y).phi
  const origin=GRAV.plotPoint(x,y,phi,axes,800,540,{yaw:0,pitch:0,depth:1,fabricZoom:1})
  const close=GRAV.plotPoint(x,y,phi,axes,800,540,{yaw:0,pitch:0,depth:1,fabricZoom:3})
  assert.ok(Math.abs(close.x-400-3*(origin.x-400))<1e-8)
  assert.ok(Math.abs(close.y-270-3*(origin.y-270))<1e-8)
  assert.equal(axes.xMin,-400)
  assert.equal(axes.yMax,270)
  assert.ok(Math.abs(phi-GRAV.field(scene,x,y).phi)<1e-12)
});

test('the Ephemeris projection honors independent Kestrel/Veyra choices at future epochs',()=>{
  const time=71000
  const s=GRAV.world({...snapshot,time,systemView:true},STAR)
  const p={x:240,y:-80}
  const now=STAR.planet(time),future=STAR.planet(time+60)
  const local=GRAV.trajectoryPoint(s,p,60,'planet')
  const stellar=GRAV.trajectoryPoint(s,p,60,'star')
  assert.ok(Math.hypot(local.x-p.x-now.x,local.y-p.y-now.y)<1e-6)
  assert.ok(Math.hypot(stellar.x-p.x-future.x,stellar.y-p.y-future.y)<1e-6)
  const kestrel=GRAV.world({...snapshot,time,systemView:false},STAR)
  const starRelative=GRAV.trajectoryPoint(kestrel,p,60,'star')
  assert.ok(Math.hypot(starRelative.x-(p.x+future.x-now.x),
    starRelative.y-(p.y+future.y-now.y))<1e-6)
  const localRelative=GRAV.trajectoryPoint(kestrel,p,60,'planet')
  assert.ok(Math.hypot(localRelative.x-p.x,localRelative.y-p.y)<1e-8)
});

test('both user trajectory and unlocked Ephemeris remain gated by player instrument flags',()=>{
  const own=[{x:240,y:10,t:snapshot.time+10},{x:245,y:25,t:snapshot.time+20}]
  const ephemeris={points:[{x:300,y:20,t:0},{x:310,y:30,t:60}],
    markers:[{x:310,y:30,safe:true},{x:320,y:40,safe:false}]}
  const scene=GRAV.world({...snapshot,systemView:false,orbitVisible:true,
    ownTrajectory:own,ephemerisOwned:true,ephemerisVisible:true,
    ephemerisFrame:'planet',ephemeris},STAR)
  const lines=GRAV.trajectoryPaths(scene)
  assert.equal(lines.own.length,2)
  assert.equal(lines.ephem.length,2)
  assert.equal(lines.markers.length,1)
  assert.equal(lines.markers[0].label,'T+60s')
  const noTech=GRAV.world({...snapshot,orbitVisible:false,ephemerisOwned:false,
    ephemerisVisible:true,ownTrajectory:own,ephemeris},STAR)
  const hidden=GRAV.trajectoryPaths(noTech)
  assert.equal(hidden.own.length,0)
  assert.equal(hidden.ephem.length,0)
});

test('Classic and Survey palettes are selectable, and radii remain physical boundaries',()=>{
  assert.equal(GRAV.paletteFor('classic').name,'Original Teal')
  assert.equal(GRAV.paletteFor('survey').name,'Survey · High Contrast')
  const scene=GRAV.world(snapshot,STAR)
  const kestrel=scene.bodies.find(b=>b.name==='KESTREL')
  assert.equal(kestrel.radius,85)
  const atCenter=GRAV.field(scene,kestrel.x,kestrel.y)
  const atSurface=GRAV.field(scene,kestrel.x+kestrel.radius,kestrel.y)
  assert.ok(atCenter.phi<atSurface.phi)
  const view=read('frontend/src/components/GravityFlightView.vue')
  assert.match(view,/zoomMode:'fabric'/)
  assert.match(view,/this.zoomMode==='fabric'/)
  assert.match(view,/this.fabricZoom\/f/)
  assert.match(view,/setPalette\('classic'\)/)
  assert.match(view,/setPalette\('survey'\)/)
  assert.match(view,/showBoundary/)
  assert.match(view,/showEphemerisPath/)
  assert.match(view,/showOwnPath/)
});

test('WASD camera motion is camera-relative, frame-rate independent and diagonal-normalized',()=>{
  const vec=keys=>GRAV.cameraKeyVector(new Set(keys));
  assert.deepEqual({...vec(['KeyW'])},{x:0,y:1});
  assert.deepEqual({...vec(['KeyS'])},{x:0,y:-1});
  assert.deepEqual({...vec(['KeyA'])},{x:1,y:0});
  assert.deepEqual({...vec(['KeyD'])},{x:-1,y:0});
  assert.deepEqual({...vec(['KeyA','KeyD'])},{x:0,y:0});
  assert.deepEqual({...vec(['KeyW','KeyS'])},{x:0,y:0});
  const diagonal=vec(['KeyW','KeyD']);
  assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.y)-1)<1e-12);
  assert.ok(diagonal.x<0&&diagonal.y>0);
});

test('WASD navigates the gravitational surface without activating spacecraft RCS or engines',()=>{
  const component=read('frontend/src/components/GravityFlightView.vue');
  const flight=read('frontend/public/legacy/game.js');
  assert.match(component,/window\.addEventListener\('keydown',this\.cameraKeyDown\)/);
  assert.match(component,/window\.addEventListener\('keyup',this\.cameraKeyUp\)/);
  assert.match(component,/window\.removeEventListener\('keydown',this\.cameraKeyDown\)/);
  assert.match(component,/advanceCameraKeys\(now\)/);
  assert.match(component,/speed=330/);
  assert.match(component,/Math\.min\(\.05,Math\.max\(0,\(now-previous\)\/1000\)\)/);
  assert.match(component,/this\.panBy\(direction\.x\*speed\*dt,direction\.y\*speed\*dt\)/);
  assert.match(component,/settings-modal/);
  assert.match(flight,/OrbitalVisualizationMode==='wells'&&[\s\S]*?\['KeyW','KeyA','KeyS','KeyD'\]\.includes\(e\.code\)\)return;/);
});
