const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const game=fs.readFileSync(path.join(root,'frontend/public/legacy/game.js'),'utf8');
const rendering=fs.readFileSync(path.join(root,'frontend/public/legacy/rendering.js'),'utf8');
const app=fs.readFileSync(path.join(root,'frontend/src/App.vue'),'utf8');
const navigation=fs.readFileSync(path.join(root,'frontend/src/components/NavigationPanel.vue'),'utf8');
const bridge=fs.readFileSync(path.join(root,'frontend/src/services/instruments.ts'),'utf8');
const extract=(text,first,last)=>{
  const a=text.indexOf('  function '+first+'('),b=text.indexOf('  function '+last+'(',a+1);
  assert.ok(a>=0&&b>a,'missing function '+first);
  return text.slice(a,b);
};
test('focus and follow are accessible in the map and dockable Navigation console, without a paid technology',()=>{
  for(const id of ['focus-target-btn','follow-target-btn','nav-selected-contact'])
    assert.ok(app.includes('id="'+id+'"'));
  for(const id of ['nav-focus-target','nav-follow-target'])
    assert.ok(navigation.includes('id="'+id+'"'));
  assert.match(navigation,/orbital-focus-target/);
  assert.match(navigation,/orbital-follow-target/);
  assert.match(bridge,/focusDisabled: boolean; followTarget: boolean/);
  assert.match(game,/getSelectedContact:selectedContact/);
  assert.match(game,/\$\('focus-target-btn'\)\.addEventListener\('click',\(\)=>focusSelectedTarget\(false\)\)/);
  assert.match(game,/\$\('follow-target-btn'\)\.addEventListener\('click',toggleFollowTarget\)/);
  assert.match(game,/function focusSelectedTarget\(follow=false\)/);
  assert.doesNotMatch(extract(game,'focusSelectedTarget','toggleFollowTarget'),/navOwned|ephemerisOwned|captureOwned|pilotLink/);
});
function cameraHarness(){
  const events=[];
  const ship={id:'player',x:260,y:0,vx:22,vy:10,fuel:180};
  const target={id:'wreck-r-26',type:'wreck',alive:true,x:3800,y:-2400,vx:10,vy:15};
  const state={selectedNavKey:'pickup:wreck-r-26',player:ship,panX:0,panY:0,zoom:.5,
               followTarget:false,aimMode:'locked',targetId:'raider-01'};
  const ctx={state,
    navTarget:key=>key==='pickup:wreck-r-26'?target:null,
    scale:()=>Math.min(800/700,600/660)*state.zoom,
    clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),
    logEvent:text=>events.push(text),updateHud:()=>{},
    $:()=>({set textContent(value){events.push(value)}})
  };
  vm.createContext(ctx);
  vm.runInContext(extract(game,'selectedContact','updateTargetOptions'),ctx);
  vm.runInContext(extract(game,'centerCameraOn','zoomAt'),ctx);
  return {ctx,state,ship,target,events};
}
test('focus centers even a distant wreck, zooms in, and does not alter flight or weapon targeting',()=>{
  const {ctx,state,ship,target}=cameraHarness();
  const before={...ship};
  ctx.focusSelectedTarget(false);
  assert.equal(state.zoom,2.8);
  assert.equal(state.panX,-target.x*ctx.scale());
  assert.equal(state.panY,-target.y*ctx.scale());
  assert.equal(state.followTarget,false);
  assert.equal(state.targetId,'raider-01');
  assert.deepEqual(ship,before);
  assert.match(ctx.selectedContact().label,/WRECK · wreck-r-26/);
});
test('follow retargets the camera as the object moves and can be disengaged',()=>{
  const {ctx,state,target}=cameraHarness();
  const frame=extract(game,'draw','frame');
  ctx.renderer={draw:()=>{}};
  vm.runInContext(frame,ctx);
  ctx.toggleFollowTarget();
  assert.equal(state.followTarget,true);
  target.x+=100;target.y+=60;
  ctx.draw();
  assert.equal(state.panX,-target.x*ctx.scale());
  assert.equal(state.panY,-target.y*ctx.scale());
  ctx.toggleFollowTarget();
  assert.equal(state.followTarget,false);
  const panX=state.panX;
  target.x+=100;
  ctx.draw();
  assert.equal(state.panX,panX);
});
function drawSelection(x,y){
  const ops=[];
  const fake=new Proxy({measureText:t=>({width:t.length*6})},{
    get(target,k){return k in target?target[k]:(...args)=>{ops.push({op:k,args})}},
    set(target,k,value){target[k]=value;return true}
  });
  const state={player:{x:0,y:0}};
  const ctx={ctx:fake,getSelectedContact:()=>({x,y,label:'WRECK r-26',kind:'salvage'}),
    toScreen:(x,y)=>({x:x+400,y:y+300}),W:800,H:600,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    state,palette:{yellow:'#edbe6b',green:'#67e0aa',cyan:'#62d9f6',red:'#ff7184'},
    TWO_PI:Math.PI*2
  };
  vm.createContext(ctx);
  vm.runInContext(extract(rendering,'drawSelectedContact','draw'),ctx);
  ctx.drawSelectedContact();
  return ops;
}
test('visible navigation selection draws a round-and-corner scope around the actual body',()=>{
  const ops=drawSelection(0,0);
  assert.ok(ops.some(x=>x.op==='arc'&&x.args[0]===400&&x.args[1]===300&&x.args[2]===21));
  assert.ok(ops.some(x=>x.op==='lineTo'));
  assert.ok(ops.some(x=>x.op==='fillText'&&x.args[0].includes('WRECK r-26')));
});
test('off-screen targets receive an edge direction cue and range label',()=>{
  const ops=drawSelection(30000,-1800);
  const ring=ops.find(x=>x.op==='arc'&&x.args[2]===21);
  assert.ok(ring);
  assert.ok(ring.args[0]>=35&&ring.args[0]<=765);
  assert.ok(ring.args[1]>=35&&ring.args[1]<=565);
  assert.ok(ops.some(x=>x.op==='rotate'));
  assert.ok(ops.some(x=>x.op==='fillText'&&x.args[0].includes('OFFSCREEN')));
});
