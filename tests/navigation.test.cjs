const test=require('node:test');
const assert=require('node:assert/strict');
const nav=require('../navigation.js');
const mu=310000;
const r=260;
const circular=(r,a)=>{const v=Math.sqrt(mu/r);return {x:r*Math.cos(a),y:r*Math.sin(a),vx:-v*Math.sin(a),vy:v*Math.cos(a)};};
test('circular orbit conserves radius and speed over 3 periods',()=>{
  const s=circular(r,.4);const period=2*Math.PI*Math.sqrt(r**3/mu);
  const p=nav.propagate(s,3*period,mu,.04);
  assert(p.safe);assert(Math.abs(Math.hypot(p.x,p.y)-r)<.03);
  assert(Math.abs(Math.hypot(p.vx,p.vy)-Math.sqrt(mu/r))<.01);
});
test('planner minimizes sampled delta-v, predicts a safe near-coorbital rendezvous',()=>{
  const a=circular(260,-.67),b=circular(260,-.42);
  const plan=nav.plan(a,b,{mu,massKg:1100,propellantKg:200});
  assert(plan);assert(plan.dv<3);
  assert(plan.miss<1);
  const beginning=nav.propagate(a,plan.wait,mu,.04);
  const after=nav.propagate({...beginning,vx:beginning.vx+plan.dv1.x,vy:beginning.vy+plan.dv1.y},plan.flight,mu,.04);
  const target=nav.targetAt(b,plan.eta,mu,97,1200);
  assert(after.safe);assert(Math.hypot(after.x-target.x,after.y-target.y)<2);
});
test('unsafe inner target is rejected',()=>{
  const a=circular(260,-.67);
  const p=nav.plan(a,{x:50,y:0,fixed:true},{mu});
  assert.equal(p,null);
});
test('fuel limit eliminates impossible transfer',()=>{
  const a=circular(260,-.67),b=circular(365,1.7);
  assert.equal(nav.plan(a,b,{mu,massKg:1100,propellantKg:.000001}),null);
});
