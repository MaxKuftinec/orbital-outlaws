<script lang="ts">
import { defineComponent } from 'vue'
import CommsPanel from './components/CommsPanel.vue'
import ShipPanel from './components/ShipPanel.vue'
import TechnologyMarket from './components/TechnologyMarket.vue'
import TelemetryPanel from './components/TelemetryPanel.vue'
import TargetingPanel from './components/TargetingPanel.vue'
import NavigationPanel from './components/NavigationPanel.vue'
import SystemAtlas from './components/SystemAtlas.vue'

const legacyFiles = [
  'map-tools.js', 'map-visuals.js', 'star-system.js', 'reference-frames.js', 'autopilot-attitude.js', 'navigation.js', 'ballistics.js', 'collisions.js', 'autopilot-safety.js',
  'arrival.js', 'persistence.js', 'workspace.js', 'rendering.js', 'game.js'
]

export default defineComponent({
  name: 'OrbitalCockpit',
  components: { CommsPanel, ShipPanel, TechnologyMarket, TelemetryPanel, TargetingPanel, NavigationPanel, SystemAtlas },
  data() {
    return {
      backendOnline: false,
      persistentOnline: false,
      startupError: '',
      view: window.location.hash === '#/atlas' ? 'atlas' : 'cockpit'
    }
  },
  mounted() {
    window.addEventListener('orbital-persistence', this.updatePersistence as EventListener)
    window.addEventListener('hashchange', this.onHashChange as EventListener)
    ;(window as typeof window & { ORBITAL_API_BASE_URL?: string }).ORBITAL_API_BASE_URL =
      import.meta.env.VITE_API_BASE_URL ?? ''
    this.startCockpit()
  },
  beforeUnmount() {
    window.removeEventListener('orbital-persistence', this.updatePersistence as EventListener)
    window.removeEventListener('hashchange', this.onHashChange as EventListener)
  },
  methods: {
    onHashChange() {
      this.view = window.location.hash === '#/atlas' ? 'atlas' : 'cockpit'
      this.$nextTick(() => window.dispatchEvent(new Event('resize')))
    },
    openAtlas() {
      window.location.hash = '#/atlas'
      this.onHashChange()
      window.scrollTo({top:0,behavior:'smooth'})
    },
    openCockpit() {
      window.location.hash = '#/cockpit'
      this.onHashChange()
      window.scrollTo({top:0,behavior:'smooth'})
    },
    inspectBody(id: string) {
      if(id!=='veyra' && id!=='kestrel')return
      this.openCockpit()
      this.$nextTick(() => {
        window.dispatchEvent(new CustomEvent('orbital-target-selected',{
          detail:{key:id==='veyra'?'star':'planet'}
        }))
        window.dispatchEvent(new CustomEvent('orbital-focus-target'))
      })
    },
    updatePersistence(event: Event) {
      this.persistentOnline = Boolean((event as CustomEvent).detail?.online)
    },
    loadLegacyScript(filename: string): Promise<void> {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = '/legacy/' + filename
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('Could not load ' + filename))
        document.head.appendChild(script)
      })
    },
    async startCockpit() {
      try {
        for (const filename of legacyFiles) await this.loadLegacyScript(filename)
      } catch (error) {
        this.startupError = error instanceof Error ? error.message : String(error)
      }
      try {
        const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
        const response = await fetch(base ? base + '/' : '/backend-health')
        this.backendOnline = response.ok
      } catch {
        this.backendOnline = false
      }
    }
  }
})
</script>

<template>
<v-app class="orbital-vuetify">
  <v-main>

  <SystemAtlas v-show="view==='atlas'" @back="openCockpit" @inspect="inspectBody" />
  <div v-show="view==='cockpit'" class="app-shell">
    <header class="topbar">
      <div class="identity">
        <div class="brand-mark" aria-hidden="true"><span>◎</span></div>
        <div><div class="eyebrow">VERSION 1.1</div><h1>ORBITAL <span>OUTLAWS</span></h1></div>
      </div>
      <div class="top-actions"><v-chip :color="persistentOnline || backendOnline ? 'success' : 'warning'" size="x-small" variant="outlined">{{ persistentOnline ? 'Live · flight and upgrades saved' : backendOnline ? 'Backend online · connecting flight' : 'Local gameplay · backend offline' }}</v-chip>
        <div class="sim-clock"><span class="dot live"></span><div><span class="quiet-label">ENCOUNTER TIME</span><strong id="sim-clock">00:00</strong></div></div>
        
        <v-btn density="compact" variant="outlined" id="open-atlas-btn" class="action-btn atlas-app-nav" title="Open the Veyra System Atlas: lore, star system and flight guides" @click="openAtlas">◈ System Atlas</v-btn>
        <v-btn density="compact" variant="tonal"  id="settings-btn" type="button" class="action-btn" title="Flight control and map settings">⚙ Settings</v-btn>
        
        <v-btn density="compact" variant="tonal"  id="reset-btn" class="action-btn muted">↻ Reset</v-btn>
      </div>
    </header>

    <main class="game-layout">
      <section class="arena-shell" aria-label="Orbital gameplay area">
        <div class="arena-head">
          <div><span class="section-kicker">SECTOR 01</span><div class="arena-title">Kestrel system · parent star + planet <span class="online"></span></div></div>
          <div class="arena-actions"><v-btn density="compact" variant="tonal"  id="orbit-btn" class="small-btn selected" aria-pressed="true">◌ Trajectory</v-btn><v-btn density="compact" variant="tonal" id="ephemeris-visibility-btn" class="small-btn" aria-pressed="false" title="Show or hide the selected object's projected orbit" disabled>◎ Ephemeris OFF</v-btn><v-btn density="compact" variant="tonal" id="focus-target-btn" class="small-btn focus-target-btn" aria-label="Center and zoom to selected navigation target" title="Center and zoom to selected navigation target (camera only)" disabled>⌖ Focus</v-btn><v-btn density="compact" variant="tonal" id="follow-target-btn" class="small-btn follow-target-btn" aria-pressed="false" aria-label="Follow selected navigation target with camera" title="Keep camera centered on moving selection; dragging releases follow" disabled>◎ Follow</v-btn><v-btn density="compact" variant="tonal"  id="zoom-out" class="small-btn" aria-label="Zoom out">−</v-btn><span id="zoom-level" class="zoom-text">1.0×</span><v-btn density="compact" variant="tonal"  id="zoom-in" class="small-btn" aria-label="Zoom in">+</v-btn></div>
        </div>
        <div class="canvas-wrap" id="canvas-workspace">
          <button type="button" id="fullscreen-btn" class="fullscreen-btn" aria-label="Enter fullscreen cockpit">⛶ Fullscreen</button>
          <canvas id="orbit-canvas" aria-label="Top-down gravity simulation with spacecraft, orbit predictions, salvage pods and projectile combat"></canvas>
          <!-- Separate floating consoles are required by the legacy control bridge;
               sidebar instances provide the full instrument readouts -->
          <!-- <TelemetryPanel :console="true" /> We don't need this, please don't uncomment--> 
          <!-- <NavigationPanel :console="true" /> We don't need this, please don't uncomment-->
          <ShipPanel />
          <!-- Workspace moves this controls group into the Tools dropdown. -->
          <div id="map-measure-tools" class="map-measure-tools" aria-label="Map measuring tools">
            <div class="map-ruler-controls">
              <button type="button" id="ruler-toggle" aria-pressed="false" title="Click two points on the map to measure distance">↔ Ruler</button>
              <button type="button" id="ruler-clear" title="Clear ruler endpoints">Clear</button>
            </div>
            <div id="ruler-distance" class="map-ruler-distance" aria-live="polite">Ruler off</div>
          </div>
          <!-- Independent overlay: the scale bar never sits inside a panel. -->
          <div id="map-scale-overlay" class="map-scale-readout" aria-label="Map distance scale">
            <span id="map-scale-label">100 km</span>
            <div id="map-scale-bar" class="map-scale-bar"></div>
          </div>
          <div class="canvas-overlay bottom-left"><span class="keyboard-tag">W</span> engine <span class="keyboard-tag">LMB</span> aim <span class="keyboard-tag">A / D</span> rotate <span class="keyboard-tag">RMB</span> pan <span class="keyboard-tag">WHEEL</span> zoom <span class="keyboard-tag">N/C/E/X</span> nav <span class="keyboard-tag">H</span> help</div>
          <!-- Status is announced in Comms; the map remains visible and pannable after death -->
          <div id="game-over" hidden style="display:none"><span id="game-over-details"></span></div>
        </div>
        <div class="mission-strip"><span class="objective-icon">◎</span><span><strong id="nav-selected-contact">OBJECTIVE</strong></span><span class="mission-right" id="mission-status">2 hostiles in sector</span></div>
        <section class="flight-controls" aria-label="Spacecraft flight controls">
          <div class="control-description"><strong>ATTITUDE & PROPULSION</strong><small>Point ship using nose/tail RCS. Aim the ±28° main gimbal with your cursor, then hold W to burn. Left-click selects targets or manual gun aim</small></div>
          <div class="control-grid">
            <button type="button" data-thrust="rotate-left" class="thruster" aria-label="Hold to rotate counter-clockwise"><b>⟲</b><strong>ROTATE LEFT</strong><small>A / ←</small></button>
            <button type="button" data-thrust="rotate-right" class="thruster" aria-label="Hold to rotate clockwise"><b>⟳</b><strong>ROTATE RIGHT</strong><small>D / →</small></button>
            <button type="button" data-thrust="stabilize" class="thruster" aria-label="Hold to cancel spin"><b>◈</b><strong>STOP SPIN</strong><small>S / ↓</small></button>
            <button type="button" data-thrust="main" class="thruster" aria-label="Hold for main engine thrust"><b>▲</b><strong>MAIN ENGINE</strong><small>W / ↑</small></button>
            <button type="button" id="fire-btn" class="fire-button" aria-label="Fire at selected target"><b>⌖</b><strong>FIRE</strong><small>SPACE</small></button>
          </div>
          <div class="control-note">Left-click a raider to lock guns, click empty space for cursor-following manual aim, then hold SPACE to fire. W fires the engine. Right/middle drag or Shift+drag pans. Mouse wheel zooms toward cursor <button id="lock-btn" type="button">Lock nearest raider ↗</button></div>
        </section>
      </section>

      <aside class="sidebar" aria-label="Spacecraft instruments">

        <section class="panel propulsion">
          <div class="panel-heading"><span>PROPULSION</span><span>SCOUT MK-I</span></div>
          <div class="metric-row"><span>Dry mass</span><strong id="dry-mass">900 kg</strong></div>
          <div class="metric-row"><span>Total mass</span><strong id="total-mass">1,110 kg</strong></div>
          <div class="metric-row"><span>Main thrust</span><strong id="main-thrust">1.6 MN</strong></div>
          <div class="metric-row"><span>Mass flow</span><strong id="mass-flow">5 kg/s</strong></div>
          <div class="metric-row"><span>Effective exhaust</span><strong id="exhaust-vel">320 km/s</strong></div>
          <div class="metric-row"><span>Ship heading</span><strong id="ship-heading">0°</strong></div>
          <div class="metric-row"><span>Angular speed</span><strong id="spin-value">0°/s</strong></div>
        </section>
        <TelemetryPanel />
        <TargetingPanel />
        <TechnologyMarket />
        <NavigationPanel />
        <CommsPanel />
      </aside>
    </main>
    <div id="settings-modal" class="settings-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="settings-panel">
        <div class="settings-top"><div><div class="section-kicker">PILOT PREFERENCES</div><h2 id="settings-title">Settings</h2></div><button type="button" id="settings-close" class="action-btn" aria-label="Close settings">✕</button></div>
        <nav class="settings-tabs" aria-label="Settings sections">
          <button type="button" id="settings-tab-controls" class="selected" aria-selected="true">⌨ Controls</button>
          <button type="button" id="settings-tab-frame" aria-selected="false">◎ Frame of reference</button>
        </nav>
        <section id="settings-controls-pane" aria-label="Keyboard controls">
          <p class="mini-note">Select a command and press its new key. Keybindings are saved in this browser.</p>
          <div id="hotkey-list" class="hotkey-list"></div>
          <div id="hotkey-feedback" role="status" class="hotkey-feedback"></div>
          <button type="button" id="hotkey-reset" class="small-btn">Restore key defaults</button>
        </section>
        <section id="settings-frame-pane" class="hidden" aria-label="Reference frame and map axes">
          <p class="mini-note">Choose the map reference frame. Axes, spacecraft trails and telemetry follow the chosen body; the authoritative flight physics and fuel remain unchanged.</p>
          <div class="settings-frame-choice" role="group" aria-label="Map frame of reference">
            <button type="button" id="settings-frame-planet" aria-pressed="true"><b>◎ Kestrel</b><small>Planet-centered coordinates</small></button>
            <button type="button" id="settings-frame-star" aria-pressed="false"><b>✦ Veyra</b><small>Star-centered coordinates</small></button>
          </div>
          <label class="settings-axis-switch" for="settings-show-axes"><input type="checkbox" id="settings-show-axes" checked /> Show coordinate axes and origin grid</label>
          <p class="mini-note">The ruler and distance scale remain available in either frame without upgrades.</p>
        </section>
        <div class="settings-bottom"><span class="mini-note">Display choices are saved locally.</span><button type="button" id="settings-done" class="buy-btn">Done</button></div>
      </div>
    </div>
    <footer class="footer-note">Orbital Outlaws · v1.1 <span>Autonomous server-side sector · persistent upgrades · configurable panels</span></footer>
  </div>

  <v-alert v-if="startupError" color="error" variant="tonal" class="game-startup-error">{{ startupError }}</v-alert>
  </v-main>
</v-app>
</template>
