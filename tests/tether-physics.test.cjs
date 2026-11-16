const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const game=fs.readFileSync(path.join(root,'frontend/public/legacy/game.js'),'utf8');
const renderer=fs.readFileSync(path.join(root,'frontend/public/legacy/rendering.js'),'utf8');
const ship=fs.readFileSync(path.join(root,'frontend/src/components/ShipPanel.vue'),'utf8');
const types=fs.readFileSync(path.join(root,'frontend/src/services/cockpit.ts'),'utf8');
test('salvage uses finite-force winch in local and server-mode rendering',()=>{
  assert.match(game,/function handleLocalTether\(pod,dt\)/);
  assert.match(game,/handleLocalTether\(p,dt\)/);
  assert.match(game,/tether\.tensionN=tension/);
  assert.match(game,/pod\.vx-=impulse\/tether\.massKg\*nx/);
  assert.match(game,/p\.vx\+=impulse\/mass\(p\)\*nx/);
  assert.match(game,/state\.captureTether=saved\.captureTether\|\|null/);
  assert.match(renderer,/function drawTether\(/);
  assert.match(renderer,/drawTrails\(\);drawTether\(\)/);
});
test('grapple state and tension are visible in Vue instruments',()=>{
  assert.match(ship,/Grapple state/);
  assert.match(ship,/Tether tension/);
  assert.match(types,/captureTensionN: number/);
  assert.match(types,/captureStatus: string/);
  assert.match(game,/captureStatus:state\.captureTether\?/);
});
