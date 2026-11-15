const test=require('node:test');
const assert=require('node:assert/strict');
const collision=require('../collisions.js');
test('swept collision finds high-speed crossings despite separate final positions',()=>{
  const result=collision.sweep({x:-10,y:0},{x:10,y:0},{x:10,y:0},{x:-10,y:0},2);
  assert(result);assert(result.timeFraction>.4&&result.timeFraction<.6);
});
test('separate tracks never collide',()=>{
  assert.equal(collision.sweep({x:0,y:0},{x:10,y:0},{x:10,y:9},{x:0,y:9},2),null);
});
test('a collision conserves linear momentum in isolated normal impulse',()=>{
  const a={startX:-10,startY:0,x:0,y:0,vx:3,vy:0,massKg:1000};
  const b={startX:10,startY:0,x:0,y:0,vx:-1,vy:0,massKg:500};
  const before=a.massKg*a.vx+b.massKg*b.vx;
  const hit=collision.sweep({x:-10,y:0},{x:0,y:0},{x:10,y:0},{x:0,y:0},2);
  const result=collision.resolve(a,b,hit,1,2);
  assert(result.damage>0);assert(Math.abs((a.massKg*a.vx+b.massKg*b.vx)-before)<1e-9);
  assert(result.impactEnergyJ>0);
});
test('slow docking bump has no hull damage',()=>{
  const a={startX:0,startY:0,x:.01,y:0,vx:.01,vy:0,massKg:1000};
  const b={startX:1.9,startY:0,x:1.9,y:0,vx:0,vy:0,massKg:1000};
  const hit=collision.sweep({x:0,y:0},{x:.01,y:0},{x:1.9,y:0},{x:1.9,y:0},2);
  assert.equal(collision.resolve(a,b,hit,1,2).damage,0);
});
