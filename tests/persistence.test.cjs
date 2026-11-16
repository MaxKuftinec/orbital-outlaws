const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('persistent client sends control inputs, never client-derived coordinates or fuel', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/public/legacy/persistence.js'), 'utf8');
  const calls = [];
  let callback;
  const window = {};
  const storage = new Map();
  const sandbox = {
    window, document:{hidden:false}, crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789abc'},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    performance:{now:()=>1000},
    setInterval:cb=>{callback=cb;return 5}, clearInterval:()=>{},
    console, fetch:async (url, init)=>{
      calls.push({url,init});
      return {ok:true,json:async()=>({state:{x:123}})};
    }
  };
  vm.runInNewContext(source,sandbox);
  const seen=[];
  const sampleTimes=[];
  const controls=()=>({thrust:true,turn:0,stabilize:false,gimbal:0});
  window.OrbitalPersistence.attach({controls,onState:s=>{seen.push(s.state.x);sampleTimes.push(s.clientSampleMs)},onConnected:()=>{}});
  await new Promise(resolve=>setImmediate(resolve));
  callback();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(calls[0].url,/\/api\/players\/12345678123412341234123456789abc$/);
  assert.equal(calls[0].init.method,'POST');
  assert.equal(calls[1].init.method,'POST');
  assert.equal(calls[1].url,calls[0].url+'/input');
  assert.deepEqual(JSON.parse(calls[1].init.body),controls());
  assert.ok(seen.length>=2);
  assert.ok(sampleTimes.every(t=>t===1000), 'estimated browser-side snapshot timestamp is attached');
});


test('short press and release trigger immediate requests without waiting for interval polling', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/public/legacy/persistence.js'), 'utf8');
  const listeners = new Map();
  const window = {
    addEventListener: (type, callback) => listeners.set(type,callback),
    removeEventListener: type => listeners.delete(type)
  };
  let now=1000, active=false;
  const calls=[];
  const sandbox = {
    window, document:{hidden:false},
    crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},
    localStorage:{getItem:()=>null,setItem:()=>{}},
    performance:{now:()=>now}, setInterval:()=>1, clearInterval:()=>{},
    Promise, console,
    fetch:async (url,options)=>{
      calls.push({url,options});
      return {ok:true,json:async()=>({state:{x:200}})};
    }
  };
  vm.runInNewContext(source,sandbox);
  window.OrbitalPersistence.attach({
    controls:()=>({thrust:false,turn:active?1:0,stabilize:false,gimbal:0}),
    onState:()=>{}, onConnected:()=>{}
  });
  await new Promise(resolve=>setImmediate(resolve)); // initial connect
  active=true; now=1010; listeners.get('keydown')();
  await new Promise(resolve=>setImmediate(resolve));
  active=false; now=1020; listeners.get('keyup')();
  await new Promise(resolve=>setImmediate(resolve));
  const inputs = calls.filter(c=>c.url.endsWith('/input')).map(c=>JSON.parse(c.options.body));
  assert.equal(inputs.length,2,'both input edges should be transmitted without timer ticks');
  assert.equal(inputs[0].turn,1);
  assert.equal(inputs[1].turn,0);
});
