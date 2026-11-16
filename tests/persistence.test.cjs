const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/public/legacy/persistence.js'),'utf8');

function harness(){
  const sockets=[],sent=[],listeners=new Map(),docListeners=new Map(),store=new Map();
  let now=1000,control={thrust:false,turn:0,stabilize:false,gimbal:0,
                         fire:false,repair:false,aim_x:0,aim_y:0},interval;
  class MockWebSocket {
    static OPEN=1;
    constructor(url){this.url=url;this.readyState=1;sockets.push(this);}
    send(data){sent.push(JSON.parse(data));}
    emit(packet){this.onmessage({data:JSON.stringify(packet)});}
    close(){this.readyState=3;this.onclose?.({code:1000});}
  }
  const window={ORBITAL_API_BASE_URL:'',
    addEventListener:(name,callback)=>listeners.set(name,callback),
    removeEventListener:name=>listeners.delete(name)};
  const document={hidden:false,
    addEventListener:(name,callback)=>docListeners.set(name,callback),
    removeEventListener:name=>docListeners.delete(name)};
  const context={window,document,URL,location:{href:'http://localhost:5173/'},WebSocket:MockWebSocket,
    crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789abc'},
    localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
    performance:{now:()=>now},setInterval:fn=>{interval=fn;return 1},clearInterval:()=>{},
    setTimeout:()=>1,clearTimeout:()=>{}};
  vm.runInNewContext(source,context);
  const states=[],progress=[],encounters=[],statuses=[],errors=[];
  const handle=window.OrbitalPersistence.attach({
    controls:()=>control,onState:state=>states.push(state),
    onProgress:value=>progress.push(value),onEncounter:value=>encounters.push(value),
    onConnected:value=>statuses.push(value),onError:reason=>errors.push(reason)
  });
  return {sockets,sent,handle,states,progress,encounters,statuses,errors,document,
    listeners,docListeners,control,
    setTime:v=>{now=v},setControl:value=>{control=value},tick:()=>interval()};
}
const sector={saved_at_utc:100,snapshot:{version:3,t:40,player:{hp:85,ammo:27,alive:true},
  enemies:[{id:'raider-01',alive:false}],ally:{id:'ally-01'},pickups:[],shots:[]}};
const welcome={type:'welcome',flight:{state:{x:123,heading:.3}},
  progress:{credits:65,upgrades:{}},encounter:sector};

test('WebSocket receives server-authoritative flight, sector, credits and technologies',()=>{
  const h=harness();
  assert.match(h.sockets[0].url,/^ws:\/\/localhost:5173\/players\/12345678123412341234123456789abc\/live$/);
  h.sockets[0].emit(welcome);
  assert.equal(h.states[0].state.x,123);
  assert.equal(h.states[0].clientSampleMs,1000);
  assert.equal(h.encounters[0].snapshot.player.hp,85);
  assert.equal(h.progress[0].credits,65);
  assert.deepEqual(h.statuses,[true]);
  h.sockets[0].emit({type:'snapshot',flight:{state:{x:125}},encounter:sector,
    progress:{credits:69,upgrades:{ephemeris:true}}});
  assert.equal(h.states.at(-1).state.x,125);
  assert.equal(h.progress.at(-1).upgrades.ephemeris,true);
});

test('short pilot input edges transmit immediately and never send client-derived positions',()=>{
  const h=harness();h.sockets[0].emit(welcome);
  h.setControl({...h.control,turn:1,fire:true,aim_x:0,aim_y:1});
  h.setTime(1010);h.listeners.get('keydown')();
  h.setControl({...h.control,turn:0,fire:false,aim_x:0,aim_y:0});
  h.setTime(1020);h.listeners.get('keyup')();
  const inputs=h.sent.filter(m=>m.type==='input');
  assert.deepEqual(inputs.map(m=>m.turn),[0,1,0]);
  assert.equal(inputs[1].fire,true);
  assert.equal(inputs[1].aim_y,1);
  assert.ok(inputs.every(m=>!('x' in m)&&!('y' in m)&&!('fuel' in m)));
});

test('active controls renew their lease; hidden tabs send neutral intents',()=>{
  const h=harness();h.sockets[0].emit(welcome);
  h.setControl({...h.control,thrust:true,repair:true});
  h.setTime(1100);h.tick();
  for(let t=1110;t<1260;t+=10){h.setTime(t);h.tick();}
  h.setTime(1300);h.tick();
  assert.equal(h.sent.filter(m=>m.type==='input').length,3);
  h.document.hidden=true;h.docListeners.get('visibilitychange')();
  assert.equal(h.sent.at(-1).thrust,false);
  assert.equal(h.sent.at(-1).repair,false);
});

test('client can buy technology, but cannot claim kills, enemy positions or credits',()=>{
  const h=harness();h.sockets[0].emit(welcome);
  assert.equal(h.handle.purchase('ephemeris'),true);
  assert.deepEqual(h.sent.at(-1),{type:'purchase',upgrade:'ephemeris'});
  assert.equal(h.handle.salvage,undefined);
  assert.equal(h.handle.encounter,undefined);
  h.sockets[0].emit({type:'error',message:'Only flight inputs and purchases are accepted'});
  assert.equal(h.errors.at(-1),'Only flight inputs and purchases are accepted');
  h.sockets[0].close();
  assert.deepEqual(h.statuses,[true,false]);
  assert.equal(h.handle.purchase('nav'),false);
});
