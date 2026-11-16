const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/public/legacy/game.js'),'utf8');
const start=source.indexOf('  function autopilotStep(dt){');
const end=source.indexOf('  function leadAim(',start);
assert.ok(start>=0&&end>start);
const extracted=source.slice(start,end);
function simulation({phase='holding',targetPresent=true,tether=true,range=12,relative=.3,time=100}={}){
  const messages=[];
  const target=targetPresent?{id:'wreck-12',type:'wreck',alive:true,x:range,y:0,vx:relative,vy:0}:null;
  const state={
    t:time,
    player:{alive:true,x:0,y:0,vx:0,vy:0,fuel:150,fuelMax:200,dryMass:900,thrustN:1600000},
    autopilot:{targetKey:'pickup:wreck-12',phase,dueAt:10,holdingAt:0,startAt:0,
      remaining:{x:0,y:0},reserveKg:30,plan:{dv2:{x:0,y:0}}},
    captureTether:tether?{pickupId:'wreck-12'}:null,
    captureOwned:true,
  };
  const ctx={
    state,navTarget:()=>target,magnitude:Math.hypot,
    SAFE:{burnAllowed:()=>true},logEvent:message=>messages.push(message),
    abortNav:message=>{messages.push(message);state.autopilot=null},
    clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),
    unit:(x,y)=>{const m=Math.hypot(x,y)||1;return{x:x/m,y:y/m}},
    mass:()=>1000,
  };
  vm.createContext(ctx);
  vm.runInContext(extracted,ctx);
  const output=vm.runInContext('autopilotStep(.25)',ctx);
  return {state,messages,output};
}
test('grapple attachment takes precedence over old six-second hold and intercept deadline',()=>{
  const result=simulation({phase:'holding',time:100,tether:true});
  assert.equal(result.state.autopilot.phase,'tether');
  assert.equal(result.output,null);
  assert.match(result.messages.join(' '),/Grapple attached/);
  const ongoing=simulation({phase:'tether',time:100,tether:true});
  assert.equal(ongoing.state.autopilot.phase,'tether');
  assert.equal(ongoing.messages.length,0);
});
test('tether failure stops autopilot with actionable feedback, not capture-window timeout',()=>{
  const result=simulation({phase:'tether',tether:false});
  assert.equal(result.state.autopilot,null);
  assert.match(result.messages.join(' '),/Grapple released before recovery/);
  assert.doesNotMatch(result.messages.join(' '),/Capture window missed/);
});
test('payload recovered while tether engaged ends guidance rather than treating it as lost contact',()=>{
  const result=simulation({phase:'tether',tether:false,targetPresent:false});
  assert.equal(result.state.autopilot,null);
  assert.match(result.messages.join(' '),/guidance complete/);
});
test('autopilot does not enter capture holding at legacy 22 km and 3 km per second',()=>{
  const result=simulation({phase:'brake',range:20,relative:2.7,tether:false,time:1});
  assert.equal(result.state.autopilot.phase,'brake');
  assert.ok(result.output);
});
test('a close slow approach can enter holding before server grapple',()=>{
  const result=simulation({phase:'brake',range:8,relative:.3,tether:false,time:1});
  assert.equal(result.state.autopilot.phase,'holding');
  assert.equal(result.output,null);
});
test('the new holding window reports a missing safe grapple instead of the legacy error',()=>{
  const result=simulation({phase:'holding',range:8,relative:.3,tether:false,time:15});
  assert.equal(result.state.autopilot,null);
  assert.match(result.messages.join(' '),/No safe grapple attachment/);
});
