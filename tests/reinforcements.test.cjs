/** Regression coverage for enemy reinforcement spawning and mirrored browser builds. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ARRIVAL = require('../arrival.js');

const root = path.join(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');

test('reinforcement spawn creates an inbound spacecraft without runtime errors', () => {
  const start = game.indexOf('  function spawnEnemy() {');
  const end = game.indexOf('  function destroyAlly(', start);
  assert.ok(start >= 0 && end > start, 'spawnEnemy function must be present');

  const state = {enemies: []};
  const logs = [];
  const ctx = {
    state,
    ARRIVAL,
    palette: {red: '#f66'},
    rand: (a, b) => (a + b) / 2,
    newShip: (id, name, radius, angle, color) => {
      assert.equal(radius, 1450, 'ship constructor must use the inbound spawn radius');
      return {id, name, radius, angle, color, alive: true};
    },
    logEvent: (message, type) => logs.push({message, type}),
    persistEncounterNow: () => {},
    Math
  };

  vm.runInNewContext(game.slice(start, end) + '\nspawnEnemy();', ctx, {timeout: 1000});
  assert.equal(state.enemies.length, 1);
  const ship = state.enemies[0];
  for (const n of ['x', 'y', 'vx', 'vy', 'heading']) {
    assert.ok(Number.isFinite(ship[n]), n + ' must be finite');
  }
  assert.ok(Math.abs(Math.hypot(ship.x, ship.y) - 1450) < 1e-8);
  assert.ok(ship.x * ship.vx + ship.y * ship.vy < 0, 'new enemy must initially move inward');
  assert.match(logs[0].message, /Inbound ship detected/);
});

test('Vue gameplay copy stays synced; offline standalone remains separately playable', () => {
  const legacy = fs.readFileSync(path.join(root, 'frontend', 'public', 'legacy', 'game.js'), 'utf8');
  const standalone = fs.readFileSync(path.join(root, 'orbital-outlaws.html'), 'utf8');
  assert.equal(legacy, game);
  assert.ok(standalone.includes('function spawnEnemy()'), 'standalone must still contain enemy spawning');
  assert.ok(standalone.includes('const spawnRadiusKm=1450;'), 'standalone keeps the reinforcement fix');
});
