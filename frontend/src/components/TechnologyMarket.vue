<script lang="ts">
import { defineComponent } from 'vue'
import {
  COCKPIT_STATE_EVENT, MARKET_PURCHASE_EVENT,
  type CockpitState, type MarketView, type TechnologyKey
} from '../services/cockpit'

interface Technology {
  key: TechnologyKey
  title: string
  description: string
  price: number
  buttonId: string
  statusId: string
  ownedDescription: string
}

const OFFERS: Technology[] = [
  {
    key: 'predictive', title: 'Predictive fire control',
    description: 'Solves a lead shot using projected target motion.',
    price: 40, buttonId: 'upgrade-btn', statusId: 'upgrade-status',
    ownedDescription: 'Installed · lead shot active'
  },
  {
    key: 'trajectory', title: 'Target trajectory analyzer',
    description: 'Show enemy coast path and its future position at bullet arrival.',
    price: 25, buttonId: 'trajectory-upgrade-btn', statusId: 'trajectory-upgrade-status',
    ownedDescription: 'Installed · trajectory overlay active'
  },
  {
    key: 'ephemeris', title: 'Ephemeris computer',
    description: "Project the selected object's unpowered orbit at +60s and +120s.",
    price: 45, buttonId: 'ephemeris-upgrade-btn', statusId: 'ephemeris-upgrade-status',
    ownedDescription: 'Installed · orbit projection'
  },
  {
    key: 'capture', title: 'Salvage Capture Rig',
    description: 'Magnetic grapple assist: capture light salvage below 8 km/s relative speed (base 5 km/s).',
    price: 55, buttonId: 'capture-upgrade-btn', statusId: 'capture-upgrade-status',
    ownedDescription: 'Installed · capture limit 8 km/s'
  },
  {
    key: 'nav', title: 'Rendezvous computer',
    description: 'Fuel-conscious route search, attitude control and automatic capture.',
    price: 60, buttonId: 'nav-upgrade-btn', statusId: 'nav-upgrade-status',
    ownedDescription: 'Installed · navigation online'
  }
]

const DEFAULT_MARKET: MarketView = {
  credits: 65, ended: false,
  owned: { predictive: false, trajectory: false, ephemeris: false, nav: false, capture: false }
}

export default defineComponent({
  name: 'TechnologyMarket',
  data() {
    return {
      market: { ...DEFAULT_MARKET, owned: { ...DEFAULT_MARKET.owned } },
      offers: OFFERS
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
      this.market = { ...(event as CustomEvent<CockpitState>).detail.market }
    },
    purchase(key: TechnologyKey) {
      window.dispatchEvent(new CustomEvent(MARKET_PURCHASE_EVENT, { detail: { upgrade: key } }))
    }
  }
})
</script>

<template>
  <section class="panel upgrades" data-vue-managed="true">
    <div class="panel-heading"><span>UPGRADES</span><span>FIELD MARKET</span></div>
    <div v-for="offer in offers" :key="offer.key" class="upgrade-entry">
      <span class="tech-icon" :class="'tech-icon--' + offer.key"
            role="img" :aria-label="offer.title + ' ability icon'"></span>
      <div>
        <strong>{{ offer.title }}</strong>
        <small>{{ offer.description }}</small>
        <span :id="offer.statusId">
          {{ market.owned[offer.key] ? offer.ownedDescription : offer.price + ' ¤' }}
        </span>
      </div>
      <button :id="offer.buttonId" class="buy-btn"
              :disabled="market.owned[offer.key] || market.ended || market.credits < offer.price"
              @click="purchase(offer.key)">
        {{ market.owned[offer.key] ? 'OWNED' : 'BUY' }}
      </button>
    </div>
  </section>
</template>
