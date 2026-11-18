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
    timestamp(entry: CommsEntry): string {
      // Historical server events display the time they occurred, not the
      // moment the browser received a catch-up snapshot.
      if (typeof entry.occurredAtUtc === 'number' && Number.isFinite(entry.occurredAtUtc)) {
        return new Date(entry.occurredAtUtc * 1000).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit',
          minute: '2-digit', second: '2-digit', hour12: false
        })
      }
      const minutes = Math.floor(entry.t / 60).toString().padStart(2, '0')
      const remaining = Math.floor(entry.t % 60).toString().padStart(2, '0')
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
        <time>{{ timestamp(entry) }}</time>
        <span>{{ entry.message }}</span>
      </div>
    </div>
  </section>
</template>
