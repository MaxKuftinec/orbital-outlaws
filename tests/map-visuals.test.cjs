const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const visualCode=fs.readFileSync(path.join(root,'frontend/public/legacy/map-visuals.js'),'utf8');
const cjs={module:{exports:{}}};
vm.runInNewContext(visualCode,cjs);
const VIS=cjs.module.exports;
const renderer=fs.readFileSync(path.join(root,'frontend/public/legacy/rendering.js'),'utf8');
const extract=(start,end)=>{
  const a=renderer.indexOf('  function '+start+'(');
  const b=renderer.indexOf('  function '+end+'(',a);
  assert.ok(a>=0&&b>a);
  return renderer.slice(a,b);
};
test('star-system camera renders spacecraft smaller than either celestial body',()=>{
  for(const s of [.0001,.002,.02,.1]){
    const ship=VIS.spacecraft(s),pod=VIS.salvage(s);
    assert.equal(ship.sprite,false);
    assert.equal(pod.marker,true);
    assert.ok(ship.dotRadius<3,'spacecraft marker must be smaller than Kestrel');
    assert.ok(ship.dotRadius<Math.max(5,4500*s),'spacecraft marker must be smaller than Veyra');
    assert.ok(pod.radius<3,'salvage marker must be smaller than Kestrel');
    assert.equal(ship.showLabel,false);
    assert.equal(ship.showHealth,false);
    assert.equal(ship.showPlayerRing,false);
    assert.equal(pod.label,false);
  }
  const close=VIS.spacecraft(1);
  assert.equal(close.sprite,true);
  assert.equal(close.showLabel,true);
  assert.equal(close.showHealth,true);
  assert.ok(close.scale>1);
});
test('reticles become compact at wide zoom while surrounding visible celestial disks',()=>{
  const small=VIS.reticle(.002,'salvage');
  const star=VIS.reticle(.002,'star',Math.max(5,4500*.002));
  assert.ok(small.radius<11);
  assert.ok(star.radius<22);
  assert.ok(star.radius>4500*.002);
  assert.equal(small.label,false);
  assert.equal(star.label,false);
  assert.equal(small.ticks,false);
  assert.equal(VIS.reticle(1,'salvage').ticks,true);
  assert.ok(VIS.reticle(1,'salvage').radius>small.radius);
});
function drawAt(s){
  const ops=[];
  const fake=new Proxy({},{
    get:(t,k)=>k in t?t[k]:(...args)=>ops.push({name:String(k),args}),
    set:(t,k,value)=>{t[k]=value;return true}
  });
  const state={t:0},ctx={ctx:fake,getVisuals:()=>VIS,scale:()=>s,
    toScreen:(x,y)=>({x:x+300,y:y+200}),state,W:600,H:400,
    palette:{cyan:'#00ffff',green:'#00ff00',red:'#ff0000',purple:'#aa00ff',yellow:'#ffff00'},
    ENGINE:{gimbalMax:.48869},TWO_PI:Math.PI*2,Math};
  vm.createContext(ctx);
  vm.runInContext(extract('drawShip','drawTether'),ctx);
  const ship={alive:true,x:0,y:0,color:'#ffffff',name:'AEGIS-1',
    isPlayer:false,isAlly:true,heading:0,gimbal:0,thrustVector:null,
    rcsFiring:0,hp:60};
  ctx.drawShip(ship);
  return ops;
}
test('renderer emits a tiny dot with no name/health at system zoom, a ship at close zoom',()=>{
  const far=drawAt(.002);
  const dot=far.find(x=>x.name==='arc');
  assert.ok(dot,'a distant spacecraft retains a small discoverable position marker');
  assert.ok(dot.args[2]<2);
  assert.ok(!far.some(x=>x.name==='fillText'));
  assert.ok(!far.some(x=>x.name==='fillRect'));
  const near=drawAt(1);
  assert.ok(near.some(x=>x.name==='scale'),'close spacecraft uses a hull silhouette');
  assert.ok(near.some(x=>x.name==='fillText'),'close ally displays its name');
});
