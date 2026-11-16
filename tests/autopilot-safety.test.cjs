const {test}=require('node:test');
const assert=require('node:assert/strict');
const p=require('../autopilot-safety.js');
test('tank has real emergency reserve',()=>{
  assert.equal(p.reserveKg(200),36);
  assert(Math.abs(p.reserveKg(170)-30.6)<1e-10);
  assert.equal(p.burnAllowed(36,200),false);
  assert.equal(p.burnAllowed(40,200),true);
});
test('a mathematically feasible but risky plan is refused',()=>{
  const s=p.authorize({fuelKg:200,capacityKg:200,massKg:1110,dvKmS:40,exhaustKmS:320});
  assert(s.estimatedKg>120);assert.equal(s.ok,false);
});
test('an affordable transfer keeps room for execution error',()=>{
  const s=p.authorize({fuelKg:200,capacityKg:200,massKg:1110,dvKmS:8,exhaustKmS:320});
  assert.equal(s.ok,true);assert(s.estimatedKg*s.margin<s.availableKg);
});
test('zero fuel and invalid request are rejected',()=>{
  const s=p.authorize({fuelKg:0,capacityKg:200,massKg:1110,dvKmS:2,exhaustKmS:320});
  assert(!s.ok);assert.equal(p.requiredFuel(1110,-1,320),Infinity);
});
