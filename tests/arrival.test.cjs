const {test}=require('node:test');const assert=require('node:assert/strict');
const {inboundState}=require('../arrival.js');
test('reinforcements begin outside sector and move inward',()=>{
 const s=inboundState(1.25);
 assert(Math.hypot(s.x,s.y)>1200);
 assert(s.x*s.vx+s.y*s.vy<0);
});
test('spawn angle determines inbound corridor',()=>{
 const s=inboundState(0);assert.equal(s.x,1450);assert.equal(s.vx,-26);assert.equal(s.vy,11);
});
