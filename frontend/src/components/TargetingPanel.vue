<script lang="ts">
import { defineComponent } from 'vue'
import { TARGETING_EVENT, type TargetingView } from '../services/instruments'
const EMPTY: TargetingView = {status:'SCANNING',name:'NONE',range:'—',hull:'—',shotTime:'—',shotMiss:'Requires analyzer'}
export default defineComponent({
  name:'TargetingPanel',
  data(){return {targeting:{...EMPTY}}},
  mounted(){window.addEventListener(TARGETING_EVENT,this.onTarget as EventListener)},
  beforeUnmount(){window.removeEventListener(TARGETING_EVENT,this.onTarget as EventListener)},
  methods:{onTarget(e:Event){this.targeting={...(e as CustomEvent<TargetingView>).detail}}}
})
</script>
<template>
  <section class="panel targeting" data-vue-managed="true">
    <div class="panel-heading"><span>TARGET ACQUISITION</span>
      <span id="target-state" class="status-pill" :class="{hostile:targeting.status==='HOSTILE'}">{{ targeting.status }}</span></div>
    <div class="target-name" id="target-name">{{ targeting.name }}</div>
    <div class="metric-row"><span>Range</span><strong id="range-value">{{ targeting.range }}</strong></div>
    <div class="metric-row"><span>Hull</span><strong id="target-hull">{{ targeting.hull }}</strong></div>
    <div class="metric-row"><span>Weapon</span><strong>Ballistic rounds</strong></div>
    <div class="metric-row"><span>Bullet arrival estimate</span><strong id="shot-time">{{ targeting.shotTime }}</strong></div>
    <div class="metric-row"><span>Estimated separation at arrival</span><strong id="shot-miss">{{ targeting.shotMiss }}</strong></div>
    <div class="mini-note">Bullet ETA requires Predictive Fire Control. Cyan: projected bullet path. Purple: target's future position requires the trajectory analyzer.</div>
    <button type="button" id="next-target" class="wide-subtle-btn">Next target ↗</button>
  </section>
</template>
