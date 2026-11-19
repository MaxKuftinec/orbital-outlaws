const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function harness() {
  const handlers = new Map()
  const globalHandlers = new Map()
  const rootWindow = {
    addEventListener(name, handler) { globalHandlers.set(name, handler) },
    removeEventListener(name) { globalHandlers.delete(name) }
  }
  const canvas = {
    addEventListener(name, handler) { handlers.set(name, handler) },
    removeEventListener(name) { handlers.delete(name) },
    setPointerCapture(id) { this.captured = id },
    getBoundingClientRect() { return { left: 10, top: 20 } }
  }
  vm.runInNewContext(read('frontend/public/legacy/touch-navigation.js'), {window: rootWindow})
  const events = { taps: [], pans: [], pinches: [] }
  const dispose = rootWindow.OrbitalTouchNavigation.attach(canvas, {
    onTap: event => events.taps.push(event.pointerId),
    onPan: (x,y) => events.pans.push({x,y}),
    onPinch: (factor,x,y) => events.pinches.push({factor,x,y})
  })
  function emit(type,id,x,y,pointerType='touch') {
    const handler = handlers.get(type)
    assert.ok(handler, 'expected listener '+type)
    handler({pointerType,pointerId:id,clientX:x,clientY:y,preventDefault(){},button:0})
  }
  return {emit,events,dispose,handlers,globalHandlers,canvas}
}

test('mobile canvas tap targets only after touch release',()=>{
  const {emit,events,canvas}=harness()
  emit('pointerdown',1,100,100)
  assert.deepEqual(events.taps,[])
  assert.equal(canvas.captured,1)
  emit('pointerup',1,100,100)
  assert.deepEqual(events.taps,[1])
})

test('finger drag pans and never generates an accidental weapon target tap',()=>{
  const {emit,events}=harness()
  emit('pointerdown',1,50,50)
  emit('pointermove',1,71,66)
  emit('pointermove',1,76,70)
  emit('pointerup',1,76,70)
  assert.equal(events.taps.length,0)
  assert.equal(events.pinches.length,0)
  assert.ok(events.pans.length>=1)
  assert.ok(events.pans.some(p=>p.x>0&&p.y>0))
})

test('two fingers zoom around map-local midpoint and do not tap',()=>{
  const {emit,events}=harness()
  emit('pointerdown',1,100,100)
  emit('pointerdown',2,200,100)
  emit('pointermove',2,220,100)
  assert.equal(events.pinches.length,1)
  assert.ok(events.pinches[0].factor>1)
  assert.equal(events.pinches[0].x,150)
  assert.equal(events.pinches[0].y,80)
  emit('pointerup',1,100,100)
  emit('pointerup',2,220,100)
  assert.equal(events.taps.length,0)
})

test('touch cancellations, blur and mouse inputs never produce touch taps',()=>{
  const {emit,events,dispose,handlers,globalHandlers}=harness()
  emit('pointerdown',3,40,50)
  emit('pointercancel',3,40,50)
  emit('pointerdown',4,40,50,'mouse')
  emit('pointerup',4,40,50,'mouse')
  assert.equal(events.taps.length,0)
  emit('pointerdown',5,40,50)
  globalHandlers.get('blur')()
  emit('pointerup',5,40,50)
  assert.equal(events.taps.length,0)
  dispose()
  assert.equal(handlers.size,0)
  assert.equal(globalHandlers.size,0)
})

test('mobile cockpit has touch helm, drawer navigation and no duplicate desktop inputs',()=>{
  const app=read('frontend/src/App.vue')
  const game=read('frontend/public/legacy/game.js')
  const css=read('frontend/src/mobile.css')
  const workspace=read('frontend/public/legacy/workspace.js')
  assert.match(app,/'touch-navigation\.js', 'game\.js'/)
  assert.match(app,/class="mobile-flight-pad"/)
  assert.match(app,/data-mobile-thrust="main"/)
  assert.match(app,/id="mobile-fire-btn"/)
  assert.match(app,/class="mobile-navigation"/)
  assert.match(app,/class="sidebar" :class="\{'mobile-instruments-open'/)
  assert.match(game,/\[data-mobile-thrust\]/)
  assert.match(game,/OrbitalTouchNavigation\.attach\(canvas/)
  assert.match(game,/if\(e.pointerType==='touch'\)return/)
  assert.match(css,/touch-action:none/)
  assert.match(css,/env\(safe-area-inset-bottom\)/)
  assert.match(workspace,/mobileViewport\(\)\?false/)
})
