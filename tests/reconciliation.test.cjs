const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const game = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');

test('a server snapshot never snaps heading; correction converges across frames', () => {
  const start = game.indexOf('  function flightSample(p){');
  const end = game.indexOf('  function repairHull(', start);
  assert.ok(start >= 0 && end > start, 'expected flight reconciliation helpers');
  const ship = {x:100,y:0,vx:0,vy:1,heading:.1,omega:.2,fuel:200,dryMass:900,repairParts:10};
  const snapshot = {x:105,y:0,vx:0,vy:1,heading:.3,omega:.2,fuel_kg:199.6,mass_kg:1109.6};
  const runtime = [
    'const ENGINE={gimbalMax:Math.PI/6},state={player:ship,gimbalTarget:null,down:new Set(),paused:false,ended:false};',
    'const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));',
    'const normAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));',
    'const mass=p=>p.dryMass+p.fuel+(p.repairParts||0);',
    'let persistentFlight=true,flightOnline=true;',
    'let flightHistory=[{ms:1000,state:{x:100,y:0,vx:0,vy:1,heading:.1,omega:.2,fuel:200,mass:1110}}];',
    'let correction=null;',
    game.slice(start,end),
    'const initial=ship.heading;',
    'reconcileFlight(ship,snapshot,1000);',
    'const beforeFrame=ship.heading;',
    'applyFlightCorrection(ship,.015);',
    'const firstFrame=ship.heading;',
    'for(let i=0;i<23;i++)applyFlightCorrection(ship,.015);',
    '({initial,beforeFrame,firstFrame,last:ship.heading,x:ship.x,fuel:ship.fuel,mass:mass(ship)});'
  ].join('\n');
  const result=vm.runInNewContext(runtime,{ship,snapshot,Math,Set},{timeout:1000});
  assert.equal(result.beforeFrame,result.initial,'network callback must not snap rotation');
  assert.ok(result.firstFrame>result.initial&&result.firstFrame<snapshot.heading);
  assert.ok(result.last>.28&&result.last<snapshot.heading+.005,'heading approaches authoritative value');
  assert.ok(result.x>104&&result.x<105.01);
  assert.ok(result.fuel<200&&result.fuel>199.59);
  assert.ok(result.mass>1109.59&&result.mass<1110);
});

test('browser predicts continuous flight between network snapshots', () => {
  assert.match(game,/if\(flightOnline\)\{\s*\/\/ Immediate local prediction[\s\S]*?applyShipStep\(player,dt\);\s*applyFlightCorrection\(player,dt\);/);
  assert.match(game,/flightHistory\.push\(/);
  assert.match(game,/controls:flightControls/);
  assert.match(game,/if\(persistentFlight && \(a\.isPlayer\|\|b\.isPlayer\)\)continue/);
});
