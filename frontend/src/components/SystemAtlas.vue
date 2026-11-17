<script lang="ts">
import { defineComponent } from 'vue'
import {
  objects, fieldGuides, orbitalDays, KESTREL_ORBIT_AU, NERIS_ORBIT_AU,
  type AtlasObject
} from '../data/systemAtlas'
import '../system-atlas.css'

type AtlasTab = 'system' | 'guides' | 'frontier'
type AtlasId = AtlasObject['id']

export default defineComponent({
  name: 'SystemAtlas',
  emits: ['back', 'inspect'],
  data() {
    return {
      tab: 'system' as AtlasTab,
      selectedId: 'veyra' as AtlasId,
      selectedGuide: 'frames',
      daysAhead: 0,
      objects,
      guides: fieldGuides,
      periodKestrel: orbitalDays(KESTREL_ORBIT_AU),
      periodNeris: orbitalDays(NERIS_ORBIT_AU)
    }
  },
  computed: {
    selectedObject(): AtlasObject {
      return this.objects.find(obj => obj.id === this.selectedId) ?? this.objects[0]
    },
    selectedFieldGuide() {
      return this.guides.find(guide => guide.id === this.selectedGuide) ?? this.guides[0]
    },
    kestrelPoint(): { x: number; y: number } {
      const phase = .4 + 2 * Math.PI * this.daysAhead / this.periodKestrel
      return { x: 397 + 131 * Math.cos(phase), y: 224 + 131 * Math.sin(phase) }
    },
    nerisPoint(): { x: number; y: number } {
      const phase = 2.55 + 2 * Math.PI * this.daysAhead / this.periodNeris
      return { x: 397 + 213 * Math.cos(phase), y: 224 + 213 * Math.sin(phase) }
    }
  },
  methods: {
    switchTab(tab: AtlasTab) {
      this.tab = tab
      this.$nextTick(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    },
    selectBody(id: AtlasId) {
      this.selectedId = id
    },
    inspectBody() {
      if (this.selectedObject.status === 'Simulated')
        this.$emit('inspect', this.selectedObject.id)
    },
    scrollToExplorer() {
      document.getElementById('atlas-explorer')?.scrollIntoView({
        behavior:'smooth',block:'start'
      })
    },
    viewDossier(id: AtlasId) {
      this.selectedId = id
      this.$nextTick(() => document.getElementById('atlas-dossier')?.scrollIntoView({
        behavior:'smooth', block:'start'
      }))
    }
  }
})
</script>

<template>
  <div class="atlas-page">
    <div class="atlas-ambient" aria-hidden="true"></div>
    <div class="atlas-container">
      <header class="atlas-header">
        <div class="atlas-brand" aria-label="Orbital Outlaws">
          <span class="atlas-brand-mark" aria-hidden="true">◈</span>
          <span class="atlas-brand-text">ORBITAL <strong>OUTLAWS</strong><small>THE SYSTEM ARCHIVE</small></span>
        </div>
        <nav class="atlas-global-nav" aria-label="Atlas sections">
          <button type="button" :class="{active:tab==='system'}" :aria-current="tab==='system'?'page':undefined" @click="switchTab('system')">The system</button>
          <button type="button" :class="{active:tab==='guides'}" :aria-current="tab==='guides'?'page':undefined" @click="switchTab('guides')">Field guides</button>
          <button type="button" :class="{active:tab==='frontier'}" :aria-current="tab==='frontier'?'page':undefined" @click="switchTab('frontier')">The frontier</button>
        </nav>
        <button type="button" class="atlas-back" @click="$emit('back')">
          <span aria-hidden="true">↗</span> Return to cockpit
        </button>
      </header>

      <main id="atlas-main" class="atlas-main">
        <template v-if="tab==='system'">
          <section class="atlas-hero" aria-labelledby="atlas-heading">
            <div class="atlas-hero-copy">
              <div class="atlas-kicker"><span class="atlas-kicker-dot"></span> SYSTEM ARCHIVE <span class="atlas-kicker-sep">/</span> 001</div>
              <h1 id="atlas-heading">Beyond one world.<br /><em>Under one star.</em></h1>
              <p>Welcome to Veyra: a place where humanity can travel between worlds, but cannot negotiate with gravity. Trace the orbital architecture, meet its inhabitants-to-be, and learn how to survive the journey.</p>
              <div class="atlas-hero-actions">
                <button type="button" class="atlas-primary-link" @click="scrollToExplorer">Explore the system <span aria-hidden="true">↗</span></button>
                <button type="button" class="atlas-secondary-link" @click="switchTab('guides')">Read the pilot's handbook <span aria-hidden="true">→</span></button>
              </div>
            </div>
            <div class="atlas-hero-art" aria-hidden="true">
              <div class="atlas-hero-orbit atlas-hero-orbit--one"></div>
              <div class="atlas-hero-orbit atlas-hero-orbit--two"></div>
              <div class="atlas-hero-star"></div>
              <div class="atlas-hero-planet"></div>
              <span class="atlas-art-caption">VEYRA <small>K-TYPE MAIN SEQUENCE</small></span>
              <span class="atlas-hero-art-coordinate">SYS 01 / 0.82 M☉</span>
            </div>
          </section>

          <section class="atlas-summary-stats" aria-label="System at a glance">
            <div><span class="atlas-stat-label">Central body</span><strong>01 <small>orange dwarf</small></strong></div>
            <div><span class="atlas-stat-label">Simulated planets</span><strong>01 <small>Kestrel</small></strong></div>
            <div><span class="atlas-stat-label">Worlds in design</span><strong>01 <small>Neris</small></strong></div>
            <div><span class="atlas-stat-label">Current universe</span><strong>v1.x <small>physical spaceflight</small></strong></div>
          </section>

          <section id="atlas-explorer" class="atlas-explorer" aria-labelledby="atlas-explorer-heading">
            <div class="atlas-section-header">
              <div><span class="atlas-eyebrow">NAVIGATIONAL SURVEY / 01</span>
                <h2 id="atlas-explorer-heading">A system in motion</h2></div>
              <span class="atlas-faint-note">PLANAR ORBITS · CONCEPTUAL VIEW</span>
            </div>
            <div class="atlas-explorer-grid">
              <div class="atlas-system-graphic">
                <div class="atlas-map-hud"><span class="atlas-map-live"><i></i> VEYRA SYSTEM</span><span>TOP-DOWN ORBITAL CHART</span></div>
                <svg class="atlas-orbital-svg" viewBox="0 0 794 448" role="img" aria-label="Veyra at the center, Kestrel on a 0.40 astronomical-unit orbit, and the proposed Neris at 0.65 AU. Select a body for information.">
                  <defs>
                    <radialGradient id="atlas-sun-gradient" cx="33%" cy="29%">
                      <stop offset="0%" stop-color="#fff4c8"/><stop offset="42%" stop-color="#ffdc89"/>
                      <stop offset="78%" stop-color="#ff9f46"/><stop offset="100%" stop-color="#be5239"/>
                    </radialGradient>
                    <radialGradient id="atlas-kestrel-gradient" cx="26%" cy="25%">
                      <stop offset="0%" stop-color="#efc3a3"/><stop offset="58%" stop-color="#b57963"/><stop offset="100%" stop-color="#593d40"/>
                    </radialGradient>
                    <radialGradient id="atlas-neris-gradient" cx="28%" cy="26%">
                      <stop offset="0%" stop-color="#d7e9d4"/><stop offset="40%" stop-color="#74b3a5"/>
                      <stop offset="75%" stop-color="#33769a"/><stop offset="100%" stop-color="#163854"/>
                    </radialGradient>
                    <radialGradient id="atlas-glow">
                      <stop offset="0%" stop-color="#ffac59" stop-opacity=".30"/>
                      <stop offset="100%" stop-color="#ffac59" stop-opacity="0"/>
                    </radialGradient>
                  </defs>
                  <g class="atlas-chart-grid">
                    <path d="M0 224H794 M397 0V448" />
                    <circle cx="397" cy="224" r="75"/>
                    <circle cx="397" cy="224" r="280"/>
                  </g>
                  <circle class="atlas-map-orbit" cx="397" cy="224" r="131"/>
                  <circle class="atlas-map-orbit atlas-map-orbit--future" cx="397" cy="224" r="213"/>
                  <g role="button" tabindex="0" aria-label="Select Veyra" class="atlas-svg-contact" @click="selectBody('veyra')" @keydown.enter.prevent="selectBody('veyra')" @keydown.space.prevent="selectBody('veyra')">
                    <circle cx="397" cy="224" r="74" fill="url(#atlas-glow)"/>
                    <circle cx="397" cy="224" r="26" fill="url(#atlas-sun-gradient)"/>
                    <circle v-if="selectedId==='veyra'" class="atlas-selected-ring" cx="397" cy="224" r="35"/>
                    <text x="433" y="206" class="atlas-svg-label">VEYRA</text>
                    <text x="433" y="222" class="atlas-svg-small">K2V / STAR</text>
                  </g>
                  <g role="button" tabindex="0" aria-label="Select Kestrel" class="atlas-svg-contact" @click="selectBody('kestrel')" @keydown.enter.prevent="selectBody('kestrel')" @keydown.space.prevent="selectBody('kestrel')">
                    <circle :cx="kestrelPoint.x" :cy="kestrelPoint.y" r="12" fill="url(#atlas-kestrel-gradient)"/>
                    <circle v-if="selectedId==='kestrel'" class="atlas-selected-ring" :cx="kestrelPoint.x" :cy="kestrelPoint.y" r="21"/>
                    <text :x="kestrelPoint.x+18" :y="kestrelPoint.y-12" class="atlas-svg-label">KESTREL</text>
                    <text :x="kestrelPoint.x+18" :y="kestrelPoint.y+4" class="atlas-svg-small">0.40 AU</text>
                  </g>
                  <g role="button" tabindex="0" aria-label="Select proposed Neris" class="atlas-svg-contact" @click="selectBody('neris')" @keydown.enter.prevent="selectBody('neris')" @keydown.space.prevent="selectBody('neris')">
                    <circle :cx="nerisPoint.x" :cy="nerisPoint.y" r="12" fill="url(#atlas-neris-gradient)" opacity=".83"/>
                    <circle :cx="nerisPoint.x" :cy="nerisPoint.y" r="19" class="atlas-concept-ring"/>
                    <circle v-if="selectedId==='neris'" class="atlas-selected-ring" :cx="nerisPoint.x" :cy="nerisPoint.y" r="25"/>
                    <text :x="nerisPoint.x+21" :y="nerisPoint.y-12" class="atlas-svg-label">NERIS</text>
                    <text :x="nerisPoint.x+21" :y="nerisPoint.y+4" class="atlas-svg-small">DESIGN CANDIDATE</text>
                  </g>
                </svg>
                <div class="atlas-map-bottom">
                  <label for="atlas-time-offset">EXPLORE ORBITAL PHASE <strong>T + {{ daysAhead }} days</strong></label>
                  <input id="atlas-time-offset" v-model.number="daysAhead" type="range" min="0" max="365" step="1" aria-label="Preview planetary positions by number of days" />
                  <div class="atlas-orbit-legend"><span><i class="atlas-dot atlas-dot--active"></i> Simulated orbit</span><span><i class="atlas-dot atlas-dot--future"></i> Proposed orbit</span></div>
                </div>
              </div>
              <aside class="atlas-featured-body" aria-live="polite">
                <div class="atlas-featured-top"><span>{{ selectedObject.eyebrow }}</span>
                  <span :class="['atlas-body-state', selectedObject.status==='Concept'?'atlas-body-state--future':'']">{{ selectedObject.status }}</span></div>
                <div :class="['atlas-featured-orb',selectedObject.className]" aria-hidden="true"></div>
                <span class="atlas-featured-type">{{ selectedObject.type }}</span>
                <h3>{{ selectedObject.name }}</h3>
                <p>{{ selectedObject.lead }}</p>
                <div class="atlas-featured-divider"></div>
                <div class="atlas-featured-summary"><span>{{ selectedObject.specs[0]?.label }}</span><strong>{{ selectedObject.specs[0]?.value }}</strong></div>
                <div class="atlas-featured-summary"><span>{{ selectedObject.specs[1]?.label }}</span><strong>{{ selectedObject.specs[1]?.value }}</strong></div>
                <button type="button" class="atlas-body-more" @click="viewDossier(selectedObject.id)">Open full dossier <span aria-hidden="true">↗</span></button>
              </aside>
            </div>
            <p class="atlas-map-disclaimer">Orbital distances are proportional; body sizes are enlarged for legibility. The time slider is an illustrative ephemeris preview, not a command to advance the live simulation. Neris is not yet simulated.</p>
          </section>

          <section id="atlas-dossier" class="atlas-dossiers" aria-labelledby="atlas-objects-heading">
            <div class="atlas-section-header">
              <div><span class="atlas-eyebrow">OBJECT RECORDS / CLASSIFIED BY STATUS</span>
                <h2 id="atlas-objects-heading">Celestial dossiers</h2></div>
              <span class="atlas-faint-note">EACH WORLD HAS A STORY AND A MASS</span>
            </div>
            <div class="atlas-object-grid">
              <article v-for="obj in objects" :key="obj.id" :id="'atlas-'+obj.id"
                       :class="['atlas-object-card',{'atlas-object-card--selected': selectedId===obj.id}]">
                <button type="button" class="atlas-object-select" :aria-label="'Select '+obj.name" @click="selectBody(obj.id)">
                  <span>{{ obj.eyebrow }}</span><span>{{ obj.status==='Concept'?'◌ DESIGN':'● LIVE MODEL' }}</span>
                </button>
                <div :class="['atlas-object-orb',obj.className]" aria-hidden="true"></div>
                <div class="atlas-object-meta">{{ obj.type }}</div>
                <h3>{{ obj.name }}</h3>
                <p class="atlas-object-lead">{{ obj.lead }}</p>
                <div class="atlas-object-facts">
                  <div v-for="spec in obj.specs" :key="spec.label" class="atlas-object-fact">
                    <span>{{ spec.label }}</span><strong>{{ spec.value }}</strong>
                  </div>
                </div>
                <div class="atlas-object-story">{{ obj.story }}</div>
                <details class="atlas-science-details">
                  <summary>Science & simulation notes</summary>
                  <p>{{ obj.scienceNote }}</p>
                </details>
                <button v-if="obj.status==='Simulated'" type="button" class="atlas-inspect-btn" @click="selectBody(obj.id); inspectBody()">
                  Locate in cockpit <span aria-hidden="true">↗</span>
                </button>
                <div v-else class="atlas-concept-notice">Under design · no live physics or landing ports</div>
              </article>
            </div>
          </section>

          <section class="atlas-quote-panel">
            <span class="atlas-eyebrow">A NOTE FROM THE CARTOGRAPHERS</span>
            <p>“The map tells you where a world is. It does not tell you whether you have the propellant to arrive.”</p>
            <button type="button" @click="switchTab('guides')">Learn to navigate the system <span aria-hidden="true">→</span></button>
          </section>
        </template>

        <template v-else-if="tab==='guides'">
          <section class="atlas-section-hero atlas-section-hero--guides">
            <span class="atlas-kicker"><span class="atlas-kicker-dot"></span> FLIGHT ACADEMY / 001</span>
            <h1>Learn the rules.<br /><em>Then survive them.</em></h1>
            <p>Short, grounded instructions for pilots who would rather understand their spacecraft than trust a blinking button.</p>
          </section>
          <section class="atlas-guide-layout" aria-labelledby="atlas-guide-heading">
            <div class="atlas-guide-list">
              <div class="atlas-eyebrow" id="atlas-guide-heading">PILOT'S FIELD HANDBOOK</div>
              <button v-for="guide in guides" :key="guide.id" type="button"
                :class="['atlas-guide-select',{active:selectedGuide===guide.id}]" @click="selectedGuide=guide.id">
                <span>{{ guide.chapter }}</span><strong>{{ guide.title }}</strong><span aria-hidden="true">↗</span>
              </button>
            </div>
            <article class="atlas-guide-article">
              <span class="atlas-eyebrow">FIELD NOTE {{ selectedFieldGuide.chapter }} / BASIC CLEARANCE</span>
              <h2>{{ selectedFieldGuide.title }}</h2>
              <p class="atlas-guide-subtitle">{{ selectedFieldGuide.subtitle }}</p>
              <div class="atlas-guide-rule"></div>
              <p class="atlas-guide-text">{{ selectedFieldGuide.body }}</p>
              <div class="atlas-guide-takeaway"><span>THE RULE TO REMEMBER</span><strong>{{ selectedFieldGuide.note }}</strong></div>
              <button type="button" class="atlas-inspect-btn" @click="$emit('back')">Return to live instruments <span aria-hidden="true">↗</span></button>
            </article>
          </section>
          <section class="atlas-guide-footnote">
            <span class="atlas-eyebrow">FLIGHT SAFETY</span>
            <h2>Physics doesn't pause for the handbook.</h2>
            <p>In persistent mode, your ship continues to exist while you read. Leaving the cockpit does not create a safe parking orbit or stop a running burn automatically.</p>
          </section>
        </template>

        <template v-else>
          <section class="atlas-section-hero atlas-section-hero--frontier">
            <span class="atlas-kicker"><span class="atlas-kicker-dot"></span> THE HUMAN FRONTIER / DESIGN CHRONICLE</span>
            <h1>Space is settled.<br /><em>Society is not simple.</em></h1>
            <p>Orbital Outlaws imagines a mature spacefaring humanity: busy trade lanes, habitable worlds, territorial administrations and technologies built by real industries—not conjured from a universal menu.</p>
          </section>
          <section class="atlas-frontier-grid">
            <article><span class="atlas-eyebrow">ECONOMY</span><h2>Technology has a supplier.</h2><p>In the future, you will travel to manufacturers, station workshops and planetary ports. Inventory, parts, labor and politics will shape what you can buy, not just a credit counter.</p><span class="atlas-roadmap-tag">FUTURE SYSTEM</span></article>
            <article><span class="atlas-eyebrow">LANDING</span><h2>Worlds have surfaces.</h2><p>Landing requires orbital capture, atmosphere and thermal management where applicable, propulsion and a place to actually dock. Surface towns will be destinations, not static textures.</p><span class="atlas-roadmap-tag">FUTURE SYSTEM</span></article>
            <article><span class="atlas-eyebrow">CIVILIZATION</span><h2>Life becomes simulation.</h2><p>Population, resource production, ecological pressures, governments, markets and settlements should interact persistently. Their behavior will ultimately change the opportunities available to players.</p><span class="atlas-roadmap-tag atlas-roadmap-tag--v2">v2.0 MAJOR MILESTONE</span></article>
          </section>
          <section class="atlas-milestone">
            <span class="atlas-eyebrow">VERSION CONTROL / DESIGN PROMISE</span>
            <h2>v1.x is the spaceflight foundation.<br /><em>v2.0 begins when a world comes alive.</em></h2>
            <div class="atlas-milestone-track">
              <div><b>v1.x</b><span>Stellar model, navigation, salvage, ports & landing groundwork</span></div>
              <div><b>v2.0</b><span>First implemented persistent planetary ecology or civilization</span></div>
            </div>
          </section>
        </template>
      </main>

      <footer class="atlas-footer">
        <span>ORBITAL OUTLAWS <i>·</i> SYSTEM ARCHIVE</span>
        <span>HARD SCIENCE WHERE IT MATTERS. FICTION BY DESIGN.</span>
        <button type="button" @click="$emit('back')">↗ FLIGHT DECK</button>
      </footer>
    </div>
  </div>
</template>
