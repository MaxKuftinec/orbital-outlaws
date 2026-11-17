const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
// frontend/package.json declares ESM; evaluate the browser UMD in a CJS sandbox.
const attitudeContext={module:{exports:{}}};
vm.runInNewContext(read('frontend/public/legacy/autopilot-attitude.js'),attitudeContext);
const attitude=attitudeContext.module.exports;

test('braking-aware attitude controller turns toward a distant heading without sustained spins',()=>{
  const direction={x:1,y:0},alpha=2.1,dt=.015;
  let heading=-2.8,omega=0,maxSpin=0;
  for(let i=0;i<1100;i++){
    const command=attitude.steer(heading,omega,direction,alpha,dt);
    const torque=command.stabilize?-Math.sign(omega):command.turn;
    const updated=omega+torque*alpha*dt;
    omega=command.stabilize&&omega*updated<=0?0:updated;
    heading=attitude.wrap(heading+omega*dt);
    maxSpin=Math.max(maxSpin,Math.abs(omega));
  }
  assert.ok(maxSpin<.8,'angular velocity must stay well below old 1.9 rad/s spins');
  assert.ok(Math.abs(heading)<.12,'ship should converge to target heading');
  assert.ok(Math.abs(omega)<.15,'ship should settle rather than keep spinning');
});

test('ship panel can always center and track player without changing physics',()=>{
  const shipPanel=read('frontend/src/components/ShipPanel.vue');
  const game=read('frontend/public/legacy/game.js');
  const cockpit=read('frontend/src/services/cockpit.ts');
  assert.match(shipPanel,/@click="centerOnShip"/);
  assert.match(shipPanel,/orbital-center-ship/);
  assert.match(shipPanel,/CENTER ON MY SHIP/);
  assert.match(cockpit,/followPlayer: boolean/);
  assert.match(game,/window\.addEventListener\('orbital-center-ship',centerOnMyShip\)/);
  assert.match(game,/if\(state\.followPlayer\)\{\s*centerCameraOn\(state\.player\)/);
  assert.match(game,/state\.followTarget=false;state\.followPlayer=false;updateHud\(\)/);
  const a=game.indexOf('  function centerOnMyShip(){');
  const b=game.indexOf('  function updateZoom()',a);
  assert.ok(a>=0&&b>a);
  const state={player:{x:50000,y:-28000,vx:100,vy:10},followTarget:true,followPlayer:false,
    panX:0,panY:0,zoom:.5,targetId:'raider-1'};
  const ctx={state,
    centerCameraOn:t=>{state.panX=-t.x*state.zoom;state.panY=-t.y*state.zoom},
    updateZoom:()=>{},updateHud:()=>{},logEvent:()=>{},
    clamp:(x,min,max)=>Math.max(min,Math.min(max,x))
  };
  vm.createContext(ctx);vm.runInContext(game.slice(a,b),ctx);
  const shipBefore={...state.player};
  ctx.centerOnMyShip();
  assert.equal(state.followPlayer,true);
  assert.equal(state.followTarget,false);
  assert.equal(state.zoom,2.8);
  assert.equal(state.panX,-50000*2.8);
  assert.equal(state.panY,28000*2.8);
  assert.deepEqual(state.player,shipBefore);
});

function connectionHarness(){
  const source=read('frontend/public/legacy/persistence.js');
  let active=true,now=0,periodic=null;
  const handlers={};
  const rootWindow={
    ORBITAL_API_BASE_URL:'http://localhost:8000',
    addEventListener:(name,fn)=>{(handlers[name]??=[]).push(fn)},
    removeEventListener:()=>{}
  };
  const document={hidden:false,addEventListener:()=>{},removeEventListener:()=>{}};
  const localStorage={getItem:()=> 'a'.repeat(32),setItem:()=>{}};
  class WebSocket{
    static OPEN=1;
    static current=null;
    constructor(url){this.url=url;this.readyState=WebSocket.OPEN;this.sent=[];WebSocket.current=this}
    send(body){this.sent.push(JSON.parse(body))}
    close(){}
  }
  const ctx={window:rootWindow,document,localStorage,WebSocket,
    location:{href:'http://localhost:5173/'},URL,performance:{now:()=>now},
    setInterval:fn=>{periodic=fn;return 1},clearInterval:()=>{},
    setTimeout:()=>1,clearTimeout:()=>{}
  };
  vm.createContext(ctx);vm.runInContext(source,ctx);
  rootWindow.OrbitalPersistence.attach({
    controls:()=>({thrust:active,turn:0,stabilize:false,gimbal:0,fire:false,repair:false,aim_x:0,aim_y:0}),
    onState:()=>{},onProgress:()=>{},onEncounter:()=>{},onConnected:()=>{},onError:()=>{}
  });
  const socket=WebSocket.current;
  const deliver=(payload)=>socket.onmessage({data:JSON.stringify(payload)});
  deliver({type:'welcome',flight:{},progress:{},encounter:{}});
  return {socket,deliver,release:()=>{
    active=false;for(const handler of handlers.keyup||[])handler({code:'KeyW'});
  },spam:(count=50)=>{for(let i=0;i<count;i++){now+=50;periodic()}}};
}
test('held engine input is ACK-paced and key release cuts ahead of queued thrust',()=>{
  const h=connectionHarness();
  assert.equal(h.socket.sent.length,1);
  assert.equal(h.socket.sent[0].thrust,true);
  assert.equal(h.socket.sent[0].seq,1);
  h.spam(50);
  assert.equal(h.socket.sent.length,1,'never queue up 50 old thrust frames');
  h.release();
  assert.equal(h.socket.sent.length,2,'the OFF command must transmit immediately');
  assert.equal(h.socket.sent[1].thrust,false);
  assert.equal(h.socket.sent[1].seq,2);
  h.spam(40);
  assert.equal(h.socket.sent.length,2,'do not submit stale controls while release is in flight');
  h.deliver({type:'snapshot',flight:{},progress:{},encounter:{},input_ack:1});
  assert.equal(h.socket.sent.length,2);
  h.deliver({type:'snapshot',flight:{},progress:{},encounter:{},input_ack:2});
  assert.equal(h.socket.sent.length,2);
});

test('route planner reserves attitude lead time before launch',()=>{
  const nav=read('frontend/public/legacy/navigation.js');
  const game=read('frontend/public/legacy/game.js');
  assert.match(nav,/minWaitSeconds/);
  assert.match(nav,/minFlightSeconds/);
  assert.match(game,/minWaitSeconds:10,minFlightSeconds:25/);
  assert.match(game,/const guidance=ATTITUDE\.steer\(/);
});
