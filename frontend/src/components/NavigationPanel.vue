<script lang="ts">
import { defineComponent } from 'vue'
import { NAVIGATION_EVENT,NAV_OPTIONS_EVENT, type NavigationView, type NavOption } from '../services/instruments'
const EMPTY:NavigationView = {
  locked:true,phase:'LOCKED',deltaV:'—',eta:'—',fuel:'—',status:'No plan',quick:'COMPUTER LOCKED',
  metrics:'Pick a contact · press C to calculate',engageText:'BUY NAV 60¤',
  engageDisabled:false,abortDisabled:true,selected:''
}
export default defineComponent({
  name:'NavigationPanel',
  props:{console:{type:Boolean,default:false}},
  data(){return {navigation:{...EMPTY},options:[] as NavOption[]}},
  mounted(){
    window.addEventListener(NAVIGATION_EVENT,this.onNav as EventListener)
    window.addEventListener(NAV_OPTIONS_EVENT,this.onOptions as EventListener)
  },
  beforeUnmount(){
    window.removeEventListener(NAVIGATION_EVENT,this.onNav as EventListener)
    window.removeEventListener(NAV_OPTIONS_EVENT,this.onOptions as EventListener)
  },
  methods:{
    onNav(e:Event){this.navigation={...(e as CustomEvent<NavigationView>).detail}},
    onOptions(e:Event){
      const detail=(e as CustomEvent<{options:NavOption[];selected:string}>).detail
      this.options=[...detail.options]
      this.navigation.selected=detail.selected
    },
    selectTarget(e:Event){this.navigation.selected=(e.target as HTMLSelectElement).value}
  }
})
</script>
<template>
  <div v-if="console" class="nav-command" id="nav-command" role="group"
       aria-label="Navigation console" data-vue-managed="true">
    <div class="nav-command-head">
      <button type="button" class="panel-drag-handle" data-drag-handle title="Drag navigation panel" aria-label="Drag navigation panel">⠿</button>
      <button type="button" id="nav-toggle" class="console-toggle" aria-controls="nav-command-body" aria-expanded="true">◈ NAVIGATION</button>
      <span id="nav-quick-status">{{ navigation.quick }}</span>
    </div>
    <div id="nav-command-body" class="nav-command-body">
      <div class="nav-command-select">
        <select id="nav-target" class="nav-target" aria-label="Rendezvous destination"
                data-vue-managed="true" :value="navigation.selected" @change="selectTarget">
          <option v-for="option in options" :key="option.key" :value="option.key">{{ option.text }}</option>
        </select>
        <button type="button" id="nav-next" class="small-btn" title="Next navigation target (N)">↻</button>
      </div>
      <div class="nav-command-actions">
        <button type="button" id="nav-plan" class="wide-subtle-btn" title="Calculate route (C)">CALCULATE</button>
        <button type="button" id="nav-engage" class="buy-btn" :disabled="navigation.engageDisabled">{{ navigation.engageText }}</button>
        <button type="button" id="nav-abort" class="small-btn" :disabled="navigation.abortDisabled">ABORT</button>
      </div>
      <div class="nav-command-readout" id="nav-quick-metrics" aria-live="polite">{{ navigation.metrics }}</div>
    </div>
  </div>
  <section v-else class="panel autopilot-panel" data-vue-managed="true">
    <div class="panel-heading"><span>RENDEZVOUS COMPUTER</span>
      <span id="autopilot-chip" class="status-pill">{{ navigation.locked?'LOCKED':'ONLINE' }}</span>
    </div>
    <div class="mini-note">The computer searches departure and arrival windows while protecting a fuel reserve. Opposite-sense transfers can be expensive.</div>
    <div class="metric-row"><span>Estimated total Δv</span><strong id="nav-dv">{{ navigation.deltaV }}</strong></div>
    <div class="metric-row"><span>Arrival in</span><strong id="nav-eta">{{ navigation.eta }}</strong></div>
    <div class="metric-row"><span>Propellant estimate</span><strong id="nav-fuel">{{ navigation.fuel }}</strong></div>
    <div class="metric-row"><span>Guidance status</span><strong id="nav-status">{{ navigation.status }}</strong></div>
    <div class="control-note">Alt+click to set a waypoint. Manual steering disengages autopilot. Estimates assume impulsive burns; live thrust must correct.</div>
  </section>
</template>
