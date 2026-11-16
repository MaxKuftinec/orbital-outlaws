<script lang="ts">
import { defineComponent } from 'vue'
import { NAVIGATION_EVENT,NAV_OPTIONS_EVENT, type NavigationView, type NavOption } from '../services/instruments'
const EMPTY:NavigationView = {
  locked:true,phase:'LOCKED',deltaV:'—',eta:'—',fuel:'—',status:'No plan',quick:'COMPUTER LOCKED',
  metrics:'Pick a contact · press C to calculate',engageText:'BUY NAV 60¤',
  engageDisabled:false,abortDisabled:true,donateDisabled:true,requestAllyDisabled:true,
  allyInfo:'Select a friendly spacecraft',assistInfo:'No active transfers',selected:'',reserveKg:36
}
export default defineComponent({
  name:'NavigationPanel',
  props:{console:{type:Boolean,default:false}},
  data(){return {
    navigation:{...EMPTY},options:[] as NavOption[],
    reserveDraft:String(EMPTY.reserveKg),editingReserve:false
  }},
  mounted(){
    window.addEventListener(NAVIGATION_EVENT,this.onNav as EventListener)
    window.addEventListener(NAV_OPTIONS_EVENT,this.onOptions as EventListener)
  },
  beforeUnmount(){
    window.removeEventListener(NAVIGATION_EVENT,this.onNav as EventListener)
    window.removeEventListener(NAV_OPTIONS_EVENT,this.onOptions as EventListener)
  },
  methods:{
    onNav(e:Event){
      this.navigation={...(e as CustomEvent<NavigationView>).detail}
      // Prevent high-frequency live HUD updates from resetting typed input.
      if(!this.editingReserve)this.reserveDraft=String(this.navigation.reserveKg)
    },
    onOptions(e:Event){
      const detail=(e as CustomEvent<{options:NavOption[];selected:string}>).detail
      this.options=[...detail.options]
      this.navigation.selected=detail.selected
    },
    selectTarget(e:Event){const key=(e.target as HTMLSelectElement).value;
      this.navigation.selected=key;
      window.dispatchEvent(new CustomEvent('orbital-target-selected',{detail:{key}}))},
    offerFuel(){window.dispatchEvent(new CustomEvent('orbital-offer-fuel'))},
    requestAllyAssistance(){window.dispatchEvent(new CustomEvent('orbital-request-ally-assistance'))},
    beginReserveEdit(){this.editingReserve=true},
    editReserve(e:Event){this.reserveDraft=(e.target as HTMLInputElement).value},
    finishReserveEdit(){
      if(!this.editingReserve)return
      const raw=this.reserveDraft.trim(),kg=Number(raw)
      if(!raw||!Number.isFinite(kg)||kg<0||kg>200){
        this.reserveDraft=String(this.navigation.reserveKg)
      }else{
        this.navigation.reserveKg=kg
        this.reserveDraft=String(kg)
        window.dispatchEvent(new CustomEvent('orbital-set-reserve',{detail:{kg}}))
      }
      this.editingReserve=false
    },
    finishReserveOnEnter(e:KeyboardEvent){(e.target as HTMLInputElement).blur()}
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
      <div class="nav-console-reserve reserve-setting">
        <label for="nav-console-fuel-reserve-kg">Protected fuel reserve</label>
        <div><input id="nav-console-fuel-reserve-kg" type="number" min="0" max="200" step="1"
                    :value="reserveDraft" @focus="beginReserveEdit" @input="editReserve"
                    @blur="finishReserveEdit" @keydown.enter.prevent="finishReserveOnEnter"
                    aria-label="Protected fuel reserve in kilograms" />
          <span>kg</span></div>
      </div>
      <div class="mini-note">Autopilot and fuel donations keep this fuel untouched; manual thrust remains unrestricted.</div>
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
    <div class="metric-row reserve-setting">
      <label for="fuel-reserve-kg">Protected propellant</label>
      <div><input id="fuel-reserve-kg" type="number" min="0" max="200" step="1"
                  :value="reserveDraft" @focus="beginReserveEdit" @input="editReserve"
                  @blur="finishReserveEdit" @keydown.enter.prevent="finishReserveOnEnter"
                  aria-label="Protected fuel reserve in kilograms" />
        <span>kg</span></div>
    </div>
    <div class="mini-note">Autopilot and fuel donations protect this much fuel. Manual thrust can still consume it. Set 0 kg to disable the reserve.</div>
    <div class="metric-row"><span>Guidance status</span><strong id="nav-status">{{ navigation.status }}</strong></div>
    <div class="control-note">Alt+click to set a waypoint. Manual steering disengages autopilot. Estimates assume impulsive burns; live thrust must correct.</div>
    <div class="mini-note" id="ally-fuel-status">{{ navigation.allyInfo }}</div>
    <div class="mini-note" id="assistance-status">{{ navigation.assistInfo }}</div>
    <button type="button" class="wide-subtle-btn" id="ally-assistance-btn"
            :disabled="navigation.requestAllyDisabled" @click="requestAllyAssistance"
            title="Request another available NPC to deliver fuel to your selected friendly spacecraft">
      ⚑ Request assistance for selected ally
    </button>
    <button type="button" class="wide-subtle-btn" id="escort-donate-btn"
            :disabled="navigation.donateDisabled" @click="offerFuel"
            title="Offer 20 kg to your selected friendly spacecraft once within 18 km and below 2.5 km/s relative speed">
      ⇄ Transfer up to 20 kg to selected ally
    </button>
    <div class="mini-note">Direct player transfer requires ≤18 km and &lt;2.5 km/s relative speed, protected donor fuel and room in the receiver's tank. NPC allies can autonomously rendezvous and refuel one another.</div>
  </section>
</template>
