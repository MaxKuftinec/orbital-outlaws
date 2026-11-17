<script lang="ts">
import { defineComponent } from 'vue'
import { TELEMETRY_EVENT, type TelemetryView } from '../services/instruments'

const EMPTY: TelemetryView = {
  altitude:'—', speed:'—', periapsis:'—', apoapsis:'—',
  period:'—', predicted:'SAFE', reserve:'—', flight:'FREE',
  frame:'Kestrel',model:'Instantaneous two-body estimate; other-body gravity still acts'
}
export default defineComponent({
  name:'TelemetryPanel',
  props:{ console:{type:Boolean,default:false} },
  data(){ return { telemetry:{...EMPTY} } },
  mounted(){ window.addEventListener(TELEMETRY_EVENT,this.onTelemetry as EventListener) },
  beforeUnmount(){ window.removeEventListener(TELEMETRY_EVENT,this.onTelemetry as EventListener) },
  methods:{
    onTelemetry(e:Event){ this.telemetry={...(e as CustomEvent<TelemetryView>).detail} }
  }
})
</script>
<template>
  <div v-if="console" class="telemetry-console collapsed" id="telemetry-console"
       role="group" aria-label="On-screen orbital telemetry" data-vue-managed="true">
    <button type="button" class="panel-drag-handle" data-drag-handle title="Drag telemetry panel" aria-label="Drag telemetry panel">⠿</button>
    <button type="button" class="console-toggle" id="telemetry-toggle" aria-controls="telemetry-console-body" aria-expanded="false">◉ TELEMETRY</button>
    <div class="telemetry-console-body" id="telemetry-console-body">
      <div><span>Altitude</span><strong id="quick-alt">{{ telemetry.altitude }}</strong></div>
      <div><span>Speed</span><strong id="quick-speed">{{ telemetry.speed }}</strong></div>
      <div><span>Periapsis</span><strong id="quick-peri">{{ telemetry.periapsis }}</strong></div>
      <div><span>Apoapsis</span><strong id="quick-apo">{{ telemetry.apoapsis }}</strong></div>
      <div><span>Fuel reserve</span><strong id="quick-reserve">{{ telemetry.reserve }}</strong></div>
      <div><span>Flight status</span><strong id="quick-flight">{{ telemetry.flight }}</strong></div>
    </div>
  </div>
  <section v-else class="panel instruments" data-vue-managed="true">
    <div class="panel-heading"><span>ORBITAL TELEMETRY · {{ telemetry.frame.toUpperCase() }}</span><span class="status-pill">NEWTONIAN</span></div>
    <div class="mini-note">Reference origin: {{ telemetry.frame }} · {{ telemetry.model }}</div>
    <div class="metric-row"><span>Altitude</span><strong id="alt-value">{{ telemetry.altitude }}</strong></div>
    <div class="metric-row"><span>Speed</span><strong id="speed-value">{{ telemetry.speed }}</strong></div>
    <div class="metric-row"><span>Periapsis</span><strong id="peri-value">{{ telemetry.periapsis }}</strong></div>
    <div class="metric-row"><span>Apoapsis</span><strong id="apo-value">{{ telemetry.apoapsis }}</strong></div>
    <div class="metric-row"><span>Orbit period</span><strong id="period-value">{{ telemetry.period }}</strong></div>
    <div class="metric-row"><span>Instantaneous conic</span><strong id="path-status">{{ telemetry.predicted }}</strong></div>
  </section>
</template>
