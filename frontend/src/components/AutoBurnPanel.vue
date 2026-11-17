<script lang="ts">
import { defineComponent } from 'vue'
import '../auto-burn.css'

type BurnDirection = 'prograde' | 'retrograde' | 'radial_out' | 'radial_in' | 'heading' | 'angle'
type BurnReference = 'kestrel' | 'veyra'
type BurnCutoff = 'duration' | 'fuel'
interface BurnState {
  direction: BurnDirection
  reference: BurnReference
  cutoff: BurnCutoff
  duration_s: number | null
  fuel_floor_kg: number | null
  effective_floor_kg: number
  max_ignition_s: number
  status: 'aligning' | 'burning' | 'completed' | 'aborted' | 'failed'
  align_elapsed_s: number
  burn_elapsed_s: number
  rcs_used_kg: number
  reason: string
  active: boolean
}
interface GuidanceEvent {
  online: boolean
  fuel: number
  mass: number
  reserve: number
  alive: boolean
  burn: BurnState | null
}
const directions: { value: BurnDirection; label: string; icon: string; hint: string }[] = [
  { value:'prograde',label:'Prograde',icon:'↗',hint:'Along orbital velocity' },
  { value:'retrograde',label:'Retrograde',icon:'↙',hint:'Oppose orbital velocity' },
  { value:'radial_out',label:'Radial out',icon:'↑',hint:'Away from chosen origin' },
  { value:'radial_in',label:'Radial in',icon:'↓',hint:'Toward chosen origin' },
  { value:'heading',label:'Ship heading',icon:'△',hint:'Hold initial heading' },
  { value:'angle',label:'Custom vector',icon:'⌖',hint:'Fixed inertial angle' }
]
const finite = (value: number) => Number.isFinite(value)
export default defineComponent({
  name: 'AutoBurnPanel',
  data() {
    return {
      expanded: false,
      direction: 'prograde' as BurnDirection,
      reference: 'kestrel' as BurnReference,
      cutoff: 'duration' as BurnCutoff,
      duration: 6,
      floor: 36,
      angle: 0,
      online: false,
      alive: true,
      fuel: 200,
      mass: 1110,
      reserve: 36,
      burn: null as BurnState | null,
      pending: false,
      feedback: '',
      directions
    }
  },
  computed: {
    active(): boolean { return Boolean(this.burn?.active) },
    effectiveFloor(): number { return Math.max(this.reserve, this.cutoff === 'fuel' ? this.floor : 0) },
    availableFuel(): number { return Math.max(0, this.fuel - this.effectiveFloor) },
    estimateFuel(): number {
      return Math.min(this.availableFuel,
        Math.min(40, this.cutoff === 'duration' ? this.duration : 40) * 5)
    },
    estimateDv(): number {
      return this.mass > this.estimateFuel && this.estimateFuel > 0
        ? 320 * Math.log(this.mass / (this.mass - this.estimateFuel)) : 0
    },
    estimateBurnSeconds(): number {
      return this.estimateFuel / 5
    },
    valid(): boolean {
      return this.online && this.alive && !this.active && !this.pending &&
        this.availableFuel > 0.001 &&
        (this.cutoff === 'duration'
          ? finite(this.duration) && this.duration >= .05 && this.duration <= 40
          : finite(this.floor) && this.floor >= this.reserve && this.floor < this.fuel && this.floor <= 200) &&
        (this.direction !== 'angle' || (finite(this.angle) && Math.abs(this.angle) <= 360))
    },
    progressRatio(): number {
      if (!this.burn) return 0
      const duration = this.burn.cutoff === 'duration'
        ? this.burn.duration_s ?? 40 : this.burn.max_ignition_s
      return Math.min(100, Math.max(0, (this.burn.burn_elapsed_s / Math.max(.05, duration)) * 100))
    }
  },
  mounted() {
    window.addEventListener('orbital-auto-burn-state', this.onServerState as EventListener)
    window.addEventListener('orbital-auto-burn-error', this.onServerError as EventListener)
  },
  beforeUnmount() {
    window.removeEventListener('orbital-auto-burn-state', this.onServerState as EventListener)
    window.removeEventListener('orbital-auto-burn-error', this.onServerError as EventListener)
  },
  methods: {
    onServerState(event: Event) {
      const detail = (event as CustomEvent<GuidanceEvent>).detail
      if (!detail) return
      this.online = detail.online
      this.alive = detail.alive
      if (finite(detail.fuel)) this.fuel = detail.fuel
      if (finite(detail.mass)) this.mass = detail.mass
      if (finite(detail.reserve)) {
        this.reserve = detail.reserve
        if (this.floor < this.reserve) this.floor = this.reserve
      }
      if (detail.burn !== undefined) {
        const wasActive = this.active
        this.burn = detail.burn
        if (this.burn?.active) this.expanded = true
        if (wasActive && this.burn && !this.burn.active) {
          this.feedback = this.burn.reason || 'Guidance sequence ended.'
          this.pending = false
        }
      }
    },
    onServerError(event: Event) {
      this.feedback = String((event as CustomEvent<{message?:string}>).detail?.message || 'Flight command rejected.')
      this.pending = false
    },
    engage() {
      if (!this.valid) return
      this.pending = true
      this.feedback = ''
      window.dispatchEvent(new CustomEvent('orbital-auto-burn-engage', {
        detail: {
          direction: this.direction,
          reference: this.reference,
          cutoff: this.cutoff,
          duration_s: this.cutoff === 'duration' ? this.duration : null,
          fuel_floor_kg: this.cutoff === 'fuel' ? this.floor : null,
          angle_deg: this.direction === 'angle' ? this.angle : null
        }
      }))
      // The request is a WebSocket command. The server sends the accepted
      // plan, authoritative snapshots, or an error; never fire client timers.
    },
    abort() {
      if (!this.active || !this.online || this.pending) return
      this.pending = true
      this.feedback = ''
      window.dispatchEvent(new CustomEvent('orbital-auto-burn-abort'))
    }
  }
})
</script>

<template>
  <section class="auto-burn-instrument" aria-label="Server-authoritative automated thrust">
    <div class="auto-burn-heading">
      <button type="button" class="auto-burn-expander" :aria-expanded="expanded"
              aria-controls="automated-burn-body" @click="expanded=!expanded">
        <span class="auto-burn-symbol">◈</span>
        <span><strong>AUTOMATED BURN</strong><small>BASE GUIDANCE COMPUTER · SERVER AUTHORITY</small></span>
        <span class="auto-burn-caret">{{ expanded?'⌃':'⌄' }}</span>
      </button>
      <span class="auto-burn-pill" :class="{'auto-burn-live':active}">
        {{ active ? burn?.status?.toUpperCase() : online ? 'READY' : 'OFFLINE' }}
      </span>
    </div>
    <div v-if="expanded" id="automated-burn-body" class="auto-burn-body">
      <div class="auto-burn-main">
        <div class="auto-burn-section-label">01 / THRUST VECTOR</div>
        <div class="auto-burn-directions" role="group" aria-label="Thrust direction">
          <button v-for="option in directions" :key="option.value" type="button"
                  :aria-pressed="direction===option.value" :title="option.hint"
                  :disabled="active || pending" class="auto-direction"
                  :class="{selected:direction===option.value}" @click="direction=option.value">
            <span class="auto-direction-icon">{{ option.icon }}</span>
            <span>{{ option.label }}</span>
          </button>
        </div>
        <div class="auto-burn-config-grid">
          <label v-if="direction==='angle'">
            <span>Inertial vector angle <small>0° +X · +90° +Y</small></span>
            <input v-model.number="angle" type="number" min="-360" max="360" step="1"
                   :disabled="active || pending" />
          </label>
          <label v-if="direction!=='heading' && direction!=='angle'">
            <span>Vector reference</span>
            <select v-model="reference" :disabled="active || pending">
              <option value="kestrel">◎ Kestrel-relative</option>
              <option value="veyra">✦ Veyra-centered inertial</option>
            </select>
          </label>
        </div>
        <div class="auto-burn-section-label">02 / ENGINE CUTOFF</div>
        <div class="auto-burn-cutoff" role="group" aria-label="Choose automated burn termination">
          <button type="button" :disabled="active || pending" :aria-pressed="cutoff==='duration'"
                  @click="cutoff='duration'">⏱ Duration</button>
          <button type="button" :disabled="active || pending" :aria-pressed="cutoff==='fuel'"
                  @click="cutoff='fuel'">◫ Fuel remaining</button>
        </div>
        <div class="auto-burn-config-grid">
          <label v-if="cutoff==='duration'">
            <span>Ignition duration <small>seconds · 0.05–40</small></span>
            <input v-model.number="duration" type="number" min="0.05" max="40" step="0.5"
                   :disabled="active || pending" />
          </label>
          <label v-else>
            <span>Cut off at <small>kg propellant remaining</small></span>
            <input v-model.number="floor" type="number" min="0" max="200" step="1"
                   :disabled="active || pending" />
          </label>
        </div>
        <p class="auto-burn-tip">The computer turns using real RCS thrusters before ignition. Your
          {{ reserve.toFixed(1) }} kg protected reserve is never consumed by an automated burn.
          Manual thrust still overrides guidance.</p>
      </div>
      <aside class="auto-burn-preview">
        <div class="auto-burn-section-label">03 / FLIGHT ESTIMATE</div>
        <div class="auto-burn-metric"><span>Usable fuel</span><strong>{{ availableFuel.toFixed(1) }} kg</strong></div>
        <div class="auto-burn-metric"><span>Estimated main burn</span><strong>{{ estimateBurnSeconds.toFixed(2) }} s</strong></div>
        <div class="auto-burn-metric"><span>Estimated consumption</span><strong>{{ estimateFuel.toFixed(2) }} kg</strong></div>
        <div class="auto-burn-metric"><span>Ideal Δv</span><strong>{{ estimateDv.toFixed(2) }} km/s</strong></div>
        <p class="auto-burn-disclaimer">Estimate excludes alignment RCS fuel, attitude corrections and changing orbital geometry.</p>
        <template v-if="burn">
          <div class="auto-burn-section-label">MISSION TELEMETRY</div>
          <div class="auto-burn-progress" role="progressbar" :aria-valuenow="progressRatio"
               aria-valuemin="0" aria-valuemax="100"><div :style="{width:progressRatio+'%'}"></div></div>
          <div class="auto-burn-metric"><span>Guidance phase</span><strong>{{ burn.status.toUpperCase() }}</strong></div>
          <div class="auto-burn-metric"><span>Alignment time</span><strong>{{ burn.align_elapsed_s.toFixed(2) }} s</strong></div>
          <div class="auto-burn-metric"><span>Engine time</span><strong>{{ burn.burn_elapsed_s.toFixed(2) }} s</strong></div>
          <div class="auto-burn-metric"><span>RCS spent</span><strong>{{ burn.rcs_used_kg.toFixed(3) }} kg</strong></div>
        </template>
      </aside>
      <div class="auto-burn-actions">
        <button type="button" class="auto-burn-engage" :disabled="!valid" @click="engage">
          <span>▲</span> {{ pending?'AWAITING SERVER…':'ENGAGE AUTOMATED BURN' }}
        </button>
        <button type="button" class="auto-burn-abort" :disabled="!active || !online || pending" @click="abort">
          ■ ABORT
        </button>
        <span class="auto-burn-warning" v-if="!online">Connect to a trusted live flight server to use automated thrust.</span>
        <span class="auto-burn-feedback" v-if="feedback" role="status">{{ feedback }}</span>
      </div>
    </div>
    <div v-else class="auto-burn-collapsed-readout">
      <span v-if="active">Server-controlled {{ burn?.direction }} burn · {{ burn?.burn_elapsed_s.toFixed(1) }} s ignition</span>
      <span v-else>Choose a direction and cutoff · no continuous keypress required</span>
      <button v-if="active" type="button" class="auto-burn-mini-abort"
              :disabled="!online || pending" @click="abort">■ ABORT</button>
    </div>
  </section>
</template>
