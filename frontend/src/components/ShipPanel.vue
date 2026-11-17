<script lang="ts">
import { defineComponent } from 'vue'
import { COCKPIT_STATE_EVENT, type CockpitState, type ShipView } from '../services/cockpit'

const DEFAULT_SHIP: ShipView = {
  hp: 100, fuel: 200, fuelMax: 200, repairParts: 10, repairCapacity: 24,
  ammo: 36, credits: 65, captureHeatMJ: 0, captureCapacityMJ: 520, cargoKg: 0, captureTensionN: 0, captureStatus: 'STANDBY',
  deltaV: 0, status: 'Nominal orbit',
  statusColor: '#67e0aa', followPlayer: false, repairDisabled: true, repairing: false
}

export default defineComponent({
  name: 'ShipPanel',
  data() {
    return {
      ship: { ...DEFAULT_SHIP }
    }
  },
  mounted() {
    window.addEventListener(COCKPIT_STATE_EVENT, this.onState as EventListener)
  },
  beforeUnmount() {
    window.removeEventListener(COCKPIT_STATE_EVENT, this.onState as EventListener)
  },
  methods: {
    onState(event: Event) {
      this.ship = { ...(event as CustomEvent<CockpitState>).detail.ship }
    },
    centerOnShip() {
      window.dispatchEvent(new CustomEvent('orbital-center-ship'))
    }
  }
})
</script>

<template>
  <section id="ship-panel" class="panel ship-panel canvas-floating" data-vue-managed="true">
    <div class="panel-heading">
      <span>YOUR SHIP</span>
      <button type="button" class="panel-drag-handle" data-drag-handle
              title="Drag ship panel" aria-label="Drag ship panel">⠿</button>
      <span class="ship-class">SCOUT / MK-I</span>
    </div>
    <div class="ship-name">
      <span class="ship-glyph">△</span>
      <span>KESTREL-7<small id="status-text" :style="{ color: ship.statusColor }">{{ ship.status }}</small></span>
    </div>
    <button type="button" class="small-btn ship-center-btn"
            :aria-pressed="ship.followPlayer"
            title="Center and continuously follow KESTREL-7. Drag the map to return to free camera."
            @click="centerOnShip">⌖ {{ ship.followPlayer ? 'FOLLOWING MY SHIP' : 'CENTER ON MY SHIP' }}</button>
    <div class="meter-title">
      <span>HULL INTEGRITY</span><b id="hull-value">{{ Math.round(ship.hp) }}%</b>
    </div>
    <div class="meter"><div id="hull-bar" class="meter-fill green"
                            :style="{ width: Math.max(0, Math.min(100, ship.hp)) + '%' }"></div></div>
    <div class="repair-controls">
      <span>SPARE PARTS
        <strong id="repair-parts">{{ ship.repairParts.toFixed(1) }} / {{ ship.repairCapacity }} kg</strong>
      </span>
      <button id="repair-btn" type="button" class="small-btn repair-button"
              :disabled="ship.repairDisabled">
        {{ ship.repairing ? 'REPAIRING… (R)' : 'HOLD R · REPAIR' }}
      </button>
    </div>
    <div class="meter-title">
      <span>PROPELLANT</span><b id="fuel-value">{{ ship.fuel.toFixed(1) }} / {{ ship.fuelMax }} kg</b>
    </div>
    <div class="meter"><div id="fuel-bar" class="meter-fill cyan"
                            :style="{ width: (100 * ship.fuel / Math.max(ship.fuelMax, 1)) + '%' }"></div></div>
    <div class="capture-instruments" aria-label="Physical salvage capture monitoring">
      <div class="metric-row"><span>Grapple heat</span><strong>{{ ship.captureHeatMJ.toFixed(1) }} / {{ ship.captureCapacityMJ }} MJ</strong></div>
      <div class="meter"><div class="meter-fill cyan" :style="{ width: (100 * ship.captureHeatMJ / Math.max(1,ship.captureCapacityMJ)) + '%' }"></div></div>
      <div class="metric-row"><span>Grapple state</span><strong>{{ ship.captureStatus }}</strong></div>
      <div class="metric-row"><span>Tether tension</span><strong>{{ ship.captureTensionN.toFixed(0) }} N</strong></div>
      <div class="metric-row"><span>Recovered cargo</span><strong>{{ ship.cargoKg.toFixed(1) }} kg</strong></div>
    </div>
    <div class="small-stats">
      <div><span>AMMO</span><strong id="ammo-value">{{ ship.ammo }}</strong></div>
      <div><span>CREDITS</span><strong id="credits-value">{{ ship.credits }} <i>¤</i></strong></div>
      <div><span>ΔV BUDGET</span><strong id="dv-value">{{ ship.deltaV.toFixed(1) }} km/s</strong></div>
    </div>
  </section>
</template>
