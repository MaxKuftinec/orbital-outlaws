const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../frontend/public/legacy/persistence.js'),'utf8');

function harness(){
  const sockets=[],sent=[],events=new Map(),docEvents=new Map(),store=new Map();
  let now=1000,control={thrust:false,turn:0,stabilize:false,gimbal:0},interval;
  class FakeWebSocket {
    static OPEN=1;
    constructor(url){this.url=url;this.readyState=1;sockets.push(this);}
    send(raw){sent.push(JSON.parse(raw));}
    emit(packet){this.onmessage({data:JSON.stringify(packet)});}
    close(){this.readyState=3;this.onclose?.({code:1000});}
  }
  const window={
    ORBITAL_API_BASE_URL:'',
    addEventListener:(name,listener)=>events.set(name,listener),
    removeEventListener:name=>events.delete(name)
  };
  const document={hidden:false,addEventListener:(name,listener)=>docEvents.set(name,listener),
    removeEventListener:name=>docEvents.delete(name)};
  const context={
    window,document,URL,location:{href:'http://localhost:5173/'},WebSocket:FakeWebSocket,
    crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789abc'},
    localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
    performance:{now:()=>now},setInterval:fn=>{interval=fn;return 10},clearInterval:()=>{},
    setTimeout:()=>11,clearTimeout:()=>{}
  };
  vm.runInNewContext(source,context);
  const snapshots=[],progress=[],statuses=[],errors=[];
  const handle=window.OrbitalPersistence.attach({
    controls:()=>control,
    onState:packet=>snapshots.push(packet),
    onProgress:state=>progress.push(state),
    onConnected:state=>statuses.push(state),
    onError:reason=>errors.push(reason)
  });
  return {
    sockets,sent,events,docEvents,document,store,handle,snapshots,progress,statuses,errors,
    setControl:value=>{control=value;},setTime:value=>{now=value;},tick:()=>interval()
  };
}

test('WebSocket welcome resumes persistent flight and progress without an HTTP request',()=>{
  const h=harness();
  assert.match(h.sockets[0].url,/^ws:\/\/localhost:5173\/api\/players\/12345678123412341234123456789abc\/live$/);
  const flight={state:{x:123,y:42,heading:.3}};
  const economy={credits:65,upgrades:{predictive:true}};
  h.sockets[0].emit({type:'welcome',flight,progress:economy});
  assert.equal(h.snapshots[0].state.x,123);
  assert.equal(h.snapshots[0].clientSampleMs,1000);
  assert.equal(h.progress[0].credits,65);
  assert.deepEqual(h.statuses,[true]);
  assert.equal(h.sent[0].type,'input');
  assert.equal(h.sent[0].thrust,false);
});

test('short key press and release transmit immediate control edges',()=>{
  const h=harness();
  h.sockets[0].emit({type:'welcome',flight:{state:{}},progress:{credits:65,upgrades:{}}});
  h.setControl({thrust:false,turn:1,stabilize:false,gimbal:0});
  h.setTime(1010);h.events.get('keydown')();
  h.setControl({thrust:false,turn:0,stabilize:false,gimbal:0});
  h.setTime(1020);h.events.get('keyup')();
  const inputs=h.sent.filter(x=>x.type==='input');
  assert.deepEqual(inputs.map(i=>i.turn),[0,1,0]);
  assert.ok(inputs.every(i=>!('x' in i)&&!('fuel' in i)));
});

test('continuous active thrust renews lease without writing on every render tick',()=>{
  const h=harness();
  h.sockets[0].emit({type:'welcome',flight:{state:{}},progress:{credits:65,upgrades:{}}});
  h.setControl({thrust:true,turn:0,stabilize:false,gimbal:0});
  h.setTime(1100);h.tick();
  for(let t=1110;t<1250;t+=10){h.setTime(t);h.tick();}
  h.setTime(1300);h.tick();
  assert.equal(h.sent.filter(x=>x.type==='input').length,3);
});

test('purchases and salvage use the same WebSocket and accept server progress',()=>{
  const h=harness();
  h.sockets[0].emit({type:'welcome',flight:{state:{}},progress:{credits:65,upgrades:{}}});
  assert.equal(h.handle.purchase('predictive'),true);
  assert.equal(h.handle.salvage('starter-credits-0',24),true);
  assert.deepEqual(h.sent.slice(-2).map(x=>x.type),['purchase','salvage']);
  assert.equal(h.sent.at(-1).credits,24);
  h.sockets[0].emit({type:'progress',progress:{credits:49,upgrades:{predictive:true}}});
  assert.equal(h.progress.at(-1).credits,49);
  h.sockets[0].emit({type:'error',message:'Insufficient credits'});
  assert.equal(h.errors.at(-1),'Insufficient credits');
});

test('hidden tab sends neutral controls; disconnects clear connected state',()=>{
  const h=harness();
  h.sockets[0].emit({type:'welcome',flight:{state:{}},progress:{credits:65,upgrades:{}}});
  h.setControl({thrust:true,turn:1,stabilize:false,gimbal:0});
  h.setTime(1100);h.tick();
  h.document.hidden=true;h.docEvents.get('visibilitychange')();
  assert.equal(h.sent.at(-1).thrust,false);
  assert.equal(h.sent.at(-1).turn,0);
  h.sockets[0].close();
  assert.deepEqual(h.statuses,[true,false]);
  assert.equal(h.handle.purchase('nav'),false);
});


test('unacknowledged salvage is queued and cleared only after server acknowledgement',()=>{
  const h=harness();
  assert.equal(h.handle.salvage('starter-credits-1',30),true);
  assert.equal(h.sent.length,0,'claim must not be sent before welcome');
  h.sockets[0].emit({type:'welcome',flight:{state:{}},progress:{credits:65,upgrades:{}}});
  assert.equal(h.sent.at(-1).type,'salvage');
  assert.equal(h.sent.at(-1).id,'starter-credits-1');
  const key='orbital-outlaws.pending-salvage.v1';
  assert.equal(JSON.parse(h.store.get(key)).length,1);
  h.sockets[0].emit({type:'progress',progress:{credits:95,upgrades:{}},claim_id:'starter-credits-1'});
  assert.equal(JSON.parse(h.store.get(key)).length,0,'acknowledged credit claim must leave retry queue');
});
