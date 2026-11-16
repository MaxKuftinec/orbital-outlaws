<script lang="ts">
import { defineComponent } from 'vue'
import { COMMS_EVENT, type CommsEntry, type CommsPayload } from '../services/comms'

export default defineComponent({
  name: 'CommsPanel',
  data() {
    return {
      entries: [] as CommsEntry[]
    }
  },
  mounted() {
    window.addEventListener(COMMS_EVENT, this.onComms as EventListener)
  },
  beforeUnmount() {
    window.removeEventListener(COMMS_EVENT, this.onComms as EventListener)
  },
  methods: {
    onComms(event: Event) {
      this.entries = [...((event as CustomEvent<CommsPayload>).detail?.events ?? [])]
    },
    timestamp(seconds: number): string {
      const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
      const remaining = Math.floor(seconds % 60).toString().padStart(2, '0')
      return minutes + ':' + remaining
    }
  }
})
</script>

<template>
  <section class="panel feed-panel">
    <div class="panel-heading">
      <span>COMMS & EVENTS</span>
      <span class="live-label">●</span>
    </div>
    <div id="event-feed" class="event-feed" data-vue-managed="true" aria-live="polite">
      <div v-for="(entry, index) in entries" :key="index"
           class="event-entry" :class="entry.category">
        <time>{{ timestamp(entry.t) }}</time>
        <span>{{ entry.message }}</span>
      </div>
    </div>
  </section>
</template>
