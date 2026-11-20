<script lang="ts">
import { defineComponent } from 'vue'

type LabScene = 'binary' | 'uniform' | 'kestrel'
type PointerTrack = { id: number; x: number; y: number; yaw: number; pitch: number; moved: boolean } | null
type SurfacePoint = { x: number; y: number }

export default defineComponent({
  name: 'GravityLab',
  data() {
    return {
      sceneType: 'binary' as LabScene,
      yaw: -0.70,
      pitch: 0.84,
      zoom: 1,
      depth: 1,
      arrows: true,
      probe: { x: 0, y: 0 } as SurfacePoint,
      epoch: 0,
      measured: { phi: 0, gx: 0, gy: 0, g: 0 },
      sceneDescription: '',
      visibleError: '',
      tick: null as ReturnType<typeof setInterval> | null,
      observer: null as ResizeObserver | null,
      pointer: null as PointerTrack,
      viewCache: null as any
    }
  },
  computed: {
    sceneLabel(): string {
      return this.sceneType === 'binary' ? 'Two equal masses'
        : this.sceneType === 'uniform' ? 'Uniform sphere' : 'Veyra · Kestrel'
    },
    potentialText(): string {
      return Number.isFinite(this.measured.phi)
        ? this.measured.phi.toLocaleString(undefined, { maximumFractionDigits: 3 }) + ' km²/s²' : '—'
    },
    accelerationText(): string {
      return Number.isFinite(this.measured.g)
        ? (this.measured.g * 1000).toPrecision(4) + ' m/s²' : '—'
    }
  },
  mounted() {
    this.refreshWorld()
    this.observer = typeof ResizeObserver === 'undefined' ? null
      : new ResizeObserver(() => this.renderSurface())
    if (this.observer && this.$refs.surface) this.observer.observe(this.$refs.surface as Element)
    window.addEventListener('resize', this.renderSurface)
    // This is deliberately not an animation loop: refresh the scene at low
    // frequency only when the live Veyra/Kestrel preset is selected
    this.tick = setInterval(() => {
      if (this.sceneType === 'kestrel' && !document.hidden) {
        this.refreshWorld()
        this.renderSurface()
      }
    }, 1500)
    this.renderSurface()
  },
  beforeUnmount() {
    if (this.tick) clearInterval(this.tick)
    this.observer?.disconnect()
    window.removeEventListener('resize', this.renderSurface)
  },
  methods: {
    engine(): any {
      return (window as any).OrbitalGravityLab
    },
    system(): any {
      return (window as any).OrbitalStarSystem
    },
    refreshWorld() {
      const snapshot = (window as any).OrbitalPhysicsLabSnapshot?.()
      this.epoch = typeof snapshot?.time === 'number' && Number.isFinite(snapshot.time) ? snapshot.time : 0
    },
    setScene(scene: LabScene) {
      this.sceneType = scene
      this.probe = { x: 0, y: 0 }
      this.refreshWorld()
      this.renderSurface()
    },
    updateView() {
      this.renderSurface()
    },
    renderSurface() {
      const canvas = this.$refs.surface as HTMLCanvasElement | undefined
      const engine = this.engine()
      if (!canvas || !engine) {
        this.visibleError = 'The Physics Lab is not loaded yet'
        return
      }
      this.visibleError = ''
      const width = Math.max(220, canvas.clientWidth)
      const height = Math.max(280, canvas.clientHeight)
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      const pixelW = Math.round(width * ratio), pixelH = Math.round(height * ratio)
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW
        canvas.height = pixelH
      }
      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) return
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      const scene = engine.scenario(this.sceneType, this.epoch, this.system())
      this.sceneDescription = scene.note
      this.measured = engine.fieldAt(scene, this.probe.x, this.probe.y)
      this.viewCache = engine.paint(ctx, width, height, scene, {
        yaw: this.yaw, pitch: this.pitch, zoom: this.zoom,
        depth: this.depth, arrows: this.arrows, probe: this.probe,
        detail: width < 610 ? 24 : 38
      })
    },
    pointerDown(event: PointerEvent) {
      if (event.button !== 0) return
      const canvas = this.$refs.surface as HTMLCanvasElement
      if (!canvas) return
      this.pointer = {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        yaw: this.yaw, pitch: this.pitch, moved: false
      }
      canvas.setPointerCapture?.(event.pointerId)
    },
    pointerMove(event: PointerEvent) {
      const track = this.pointer
      if (!track || event.pointerId !== track.id) return
      const dx = event.clientX - track.x, dy = event.clientY - track.y
      if (Math.hypot(dx, dy) < 5 && !track.moved) return
      track.moved = true
      this.yaw = track.yaw + dx * .008
      this.pitch = Math.max(.28, Math.min(1.28, track.pitch + dy * .005))
      this.renderSurface()
    },
    pointerUp(event: PointerEvent) {
      const track = this.pointer
      if (!track || event.pointerId !== track.id) return
      if (!track.moved && this.viewCache) {
        const canvas = this.$refs.surface as HTMLCanvasElement
        const rect = canvas.getBoundingClientRect()
        const nearest = this.engine().pickNearest(
          this.viewCache, event.clientX - rect.left, event.clientY - rect.top
        )
        if (nearest) this.probe = nearest
        this.renderSurface()
      }
      this.pointer = null
    },
    pointerCancel() {
      this.pointer = null
    },
    wheel(event: WheelEvent) {
      event.preventDefault()
      this.zoom = Math.max(.55, Math.min(1.7, this.zoom * (event.deltaY > 0 ? .92 : 1.08)))
      this.renderSurface()
    },
    resetCamera() {
      this.yaw = -.70
      this.pitch = .84
      this.zoom = 1
      this.depth = 1
      this.probe = { x: 0, y: 0 }
      this.renderSurface()
    },
    selectProbeMidpoint() {
      this.probe = { x: 0, y: 0 }
      this.renderSurface()
    }
  }
})
</script>

<template>
  <section class="gravity-lab" aria-label="Interactive gravitational potential Physics Lab">
    <canvas ref="surface" class="gravity-lab-surface"
            aria-label="Rotatable three-dimensional scientific plot of Newtonian gravitational potential"
            @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp"
            @pointercancel="pointerCancel" @lostpointercapture="pointerCancel" @wheel="wheel"></canvas>
    <div class="gravity-lab-top">
      <div class="gravity-lab-eyebrow">PHYSICS LAB / MATHEMATICAL CONSTRUCT 01</div>
      <h3>GRAVITATIONAL POTENTIAL</h3>
      <p>Height encodes Φ(x,y) · gravity points downhill (−∇Φ)</p>
      <div class="gravity-lab-presets" role="group" aria-label="Physics Lab scenarios">
        <button type="button" :aria-pressed="sceneType==='binary'" @click="setScene('binary')">Equal masses</button>
        <button type="button" :aria-pressed="sceneType==='uniform'" @click="setScene('uniform')">Uniform sphere</button>
        <button type="button" :aria-pressed="sceneType==='kestrel'" @click="setScene('kestrel')">Kestrel / Veyra</button>
      </div>
    </div>
    <div class="gravity-lab-side">
      <span class="gravity-lab-kicker">EXPERIMENT</span>
      <strong>{{ sceneLabel }}</strong>
      <p>{{ sceneDescription }}</p>
      <label class="gravity-lab-check">
        <input v-model="arrows" type="checkbox" @change="updateView" />
        Acceleration vectors
      </label>
      <label class="gravity-lab-slider">
        <span>Visual depth <b>{{ depth.toFixed(1) }}×</b></span>
        <input v-model.number="depth" type="range" min="0.4" max="2" step="0.2" @input="updateView" />
      </label>
      <button type="button" class="gravity-lab-reset" @click="resetCamera">Reset view</button>
    </div>
    <div class="gravity-lab-bottom">
      <div class="gravity-lab-probe">
        <span class="gravity-lab-kicker">FIELD PROBE · {{ probe.x.toFixed(0) }}, {{ probe.y.toFixed(0) }} km</span>
        <div class="gravity-lab-probe-values">
          <div><small>Potential Φ</small><strong>{{ potentialText }}</strong></div>
          <div><small>Acceleration |g|</small><strong>{{ accelerationText }}</strong></div>
        </div>
        <button v-if="sceneType==='binary'" type="button" @click="selectProbeMidpoint">Probe the midpoint</button>
      </div>
      <div class="gravity-lab-help">
        <strong>DRAG</strong> Rotate
        <strong>SCROLL</strong> Zoom
        <strong>TAP</strong> Probe
        <small>Idealized uniform-density interiors. Depth is visually exaggerated. Not literal curved spacetime</small>
      </div>
    </div>
    <p v-if="visibleError" class="gravity-lab-error" role="status">{{ visibleError }}</p>
  </section>
</template>
