const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function load(file){
  const ctx={module:{exports:{}},Math};
  vm.runInNewContext(read(file),ctx);
  return ctx.module.exports;
}
const LAB=load('frontend/public/legacy/gravity-lab.js');
const STAR=load('frontend/public/legacy/star-system.js');

test('the interior of a uniform sphere is parabolic in potential and linear in field',()=>{
  const s=LAB.scenario('uniform');
  const {radius:R,mu}=s.bodies[0];
  const center=LAB.fieldAt(s,0,0);
  const mid=LAB.fieldAt(s,R/2,0);
  const edge=LAB.fieldAt(s,R,0);
  assert.ok(Math.abs(center.phi+1.5*mu/R)<1e-10);
  assert.equal(center.g,0);
  assert.ok(Math.abs(mid.gx+mu*(R/2)/R**3)<1e-12);
  assert.ok(Math.abs(mid.phi-(-mu*(3*R*R-(R/2)**2)/(2*R**3)))<1e-12);
  assert.ok(Math.abs(edge.phi+mu/R)<1e-10);
  assert.ok(Math.abs(edge.g-mu/(R*R))<1e-12);
  assert.ok(center.phi<mid.phi&&mid.phi<edge.phi);
});

test('two equal masses have zero force but nonzero potential and tidal gradients at midpoint',()=>{
  const s=LAB.scenario('binary'),zero=LAB.fieldAt(s,0,0);
  assert.ok(Math.abs(zero.gx)<1e-13);
  assert.ok(Math.abs(zero.gy)<1e-13);
  assert.ok(zero.phi<0);
  const right=LAB.fieldAt(s,1,0),above=LAB.fieldAt(s,0,1);
  assert.ok(right.gx>0,'small x displacement is unstable toward the right mass');
  assert.ok(above.gy<0,'small y displacement feels restoring field toward the saddle axis');
});

test('real Kestrel visualization includes Veyra field at the correct stellar epoch',()=>{
  const s=LAB.scenario('kestrel',112384,STAR);
  assert.equal(s.bodies.length,2);
  assert.equal(s.bodies[0].mu,STAR.PLANET_MU);
  const sun=STAR.star(112384);
  assert.ok(Math.hypot(s.bodies[1].x-sun.x,s.bodies[1].y-sun.y)<1e-6);
  const f=LAB.fieldAt(s,0,0);
  assert.ok(f.phi<0&&f.g>0,'Veyra still accelerates an object at Kestrel center in an inertial frame');
});

test('surface mesh resolution and potential values are finite and bounded for phone and desktop',()=>{
  for(const name of ['binary','uniform','kestrel']){
    const s=LAB.scenario(name,1200,STAR);
    for(const detail of [24,38]){
      const mesh=LAB.surface(s,detail);
      assert.equal(mesh.rows.length,detail+1);
      assert.equal(mesh.rows[0].length,detail+1);
      assert.ok(Number.isFinite(mesh.min)&&Number.isFinite(mesh.max)&&mesh.max>mesh.min);
      assert.ok(mesh.rows.every(row=>row.every(point=>Number.isFinite(point.phi))));
    }
  }
});

test('Physics Lab is a separate page and the cockpit has its own real-world well view',()=>{
  const app=read('frontend/src/App.vue');
  const game=read('frontend/public/legacy/game.js');
  const component=read('frontend/src/components/GravityLab.vue');
  const physicsCss=read('frontend/src/gravity-flight.css');
  assert.match(app,/defineAsyncComponent\(\(\) => import\('\.\/components\/GravityLab\.vue'\)\)/);
  assert.match(app,/view==='physics'/);
  assert.match(app,/openPhysics\(\)/);
  assert.match(app,/<GravityLab v-if="view==='physics'/);
  assert.match(app,/<GravityFlightView v-if="view==='cockpit' && visualization==='wells'"/);
  assert.match(game,/if\(\['wells','physics','atlas'\]\.includes\(globalThis\.OrbitalVisualizationMode\)\)return;/);
  assert.match(game,/window\.OrbitalPhysicsLabSnapshot=/);
  assert.match(game,/window\.OrbitalGameSnapshot=/);
  assert.match(component,/@pointerdown="pointerDown"/);
  assert.match(component,/1500\)/);
  assert.match(component,/markRaw\(engine\.paint/);
  assert.match(physicsCss,/\.physics-page \.gravity-lab/);
  assert.doesNotMatch(component,/requestAnimationFrame/);
});
