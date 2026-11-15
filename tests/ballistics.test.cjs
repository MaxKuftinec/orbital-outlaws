const test=require('node:test');
const assert=require('node:assert/strict');
const ballistic=require('../ballistics.js');
test('projectile inherits spacecraft velocity',()=>{
 const shot=ballistic.projectileAt({x:260,y:0,vx:5,vy:30},{x:1,y:0},205,12);
 assert.equal(shot.vx,210);assert.equal(shot.vy,30);assert.equal(shot.x,272);
});
test('projectile and target are predicted to the same cursor arrival time',()=>{
 const result=ballistic.forecast({x:260,y:0,vx:0,vy:0},{x:1,y:0},{x:465,y:0},{x:465,y:50,vx:0,vy:-20},{mu:0,crashRadius:0,horizonSec:5});
 assert.equal(result.status,'reachable');
 assert(Math.abs(result.arrivalTime-(465-260-12)/205)<1e-4);
 assert(Math.abs(result.targetAtCursor.y-(50-20*result.arrivalTime))<1e-3);
});
test('preview horizon and sector distance are not projectile lifetimes',()=>{
 const shooter={x:260,y:0,vx:0,vy:0},dir={x:1,y:0};
 const near=ballistic.forecast(shooter,dir,{x:1620,y:0},null,{mu:0,crashRadius:0,horizonSec:8});
 assert.equal(near.status,'reachable');assert(near.bulletAtCursor.x>1300);
 const far=ballistic.forecast(shooter,dir,{x:9000,y:0},null,{mu:0,crashRadius:0,horizonSec:3});
 assert.equal(far.status,'preview-limit');
});
