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
