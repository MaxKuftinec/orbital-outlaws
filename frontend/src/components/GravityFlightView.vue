<script lang="ts">
import {defineComponent} from 'vue'
type Axes={xMin:number;xMax:number;yMin:number;yMax:number;zMin:number;zMax:number}
type Scene={bodies:Array<{x:number;y:number;mu:number;radius:number;name:string}>;ships:any[];time:number;systemView:boolean}
export default defineComponent({
  name:'GravityFlightView',
  data(){
    return {
      preset:'kestrel' as 'kestrel'|'veyra'|'system',
      yaw:-.62,pitch:.78,depth:1,
      axes:null as Axes|null,
      lastScene:null as Scene|null,
      invalid:'',
      playerG:'—',playerPotential:'—',
      interval:null as ReturnType<typeof setInterval>|null,
      observer:null as ResizeObserver|null,
      dragging:null as {id:number;x:number;y:number;angle:number;pitch:number}|null,
      lastFrameTime:0
    }
  },
  mounted(){
    this.refresh(true)
    if(typeof ResizeObserver!=='undefined'){
      this.observer=new ResizeObserver(()=>this.redraw())
      this.observer.observe(this.$refs.surface as Element)
    }
    window.addEventListener('resize',this.redraw)
    this.interval=setInterval(()=>{
      if(!document.hidden)this.refresh()
    },400)
  },
  beforeUnmount(){
    if(this.interval)clearInterval(this.interval)
    this.observer?.disconnect()
    window.removeEventListener('resize',this.redraw)
  },
  methods:{
    engine():any{return (window as any).OrbitalGravityFlight},
    snapshot():any{return (window as any).OrbitalGameSnapshot?.()},
    refresh(force=false){
      const engine=this.engine(),snap=this.snapshot(),star=(window as any).OrbitalStarSystem
      if(!engine||!snap||!star)return
      const scene=engine.world(snap,star) as Scene
      if(!this.axes||force||this.lastScene?.systemView!==scene.systemView){
        this.axes=engine.axesFor(scene,this.preset)
      }
      this.lastScene=scene
      const ship=scene.ships.find((s:any)=>s.player)
      if(ship){
        const f=engine.field(scene,ship.x,ship.y)
        this.playerG=(f.g*1000).toPrecision(4)+' m/s²'
        this.playerPotential=f.phi.toPrecision(6)+' km²/s²'
      }
      this.redraw()
    },
    selectPreset(preset:'kestrel'|'veyra'|'system'){
      this.preset=preset
      if(this.lastScene)this.axes=this.engine().axesFor(this.lastScene,preset)
      this.redraw()
    },
    fitZ(){
      if(!this.lastScene||!this.axes)return
      const range=this.engine().sampleRange(this.lastScene,this.axes)
      this.axes={...this.axes,zMin:range.min,zMax:range.max}
      this.redraw()
    },
    setAxis(name:keyof Axes,event:Event){
      if(!this.axes)return
      const raw=(event.target as HTMLInputElement).value
      if(raw.trim()==='')return
      const num=Number(raw)
      if(!Number.isFinite(num))return
      const proposal={...this.axes,[name]:num}
      if(!this.engine().validAxes(proposal)){
        this.invalid='Each maximum must exceed its corresponding minimum'
        return
      }
      this.invalid=''
      this.axes=proposal
      this.redraw()
    },
    redraw(){
      const canvas=this.$refs.surface as HTMLCanvasElement|undefined
      if(!canvas||!this.lastScene||!this.axes||!this.engine().validAxes(this.axes))return
      const w=Math.max(250,canvas.clientWidth),h=Math.max(280,canvas.clientHeight)
      const scale=Math.min(window.devicePixelRatio||1,1.5)
      const ww=Math.round(w*scale),hh=Math.round(h*scale)
      if(canvas.width!==ww||canvas.height!==hh){canvas.width=ww;canvas.height=hh}
      const ctx=canvas.getContext('2d',{alpha:false})
      if(!ctx)return
      ctx.setTransform(scale,0,0,scale,0,0)
      this.engine().paint(ctx,w,h,this.lastScene,this.axes,{
        yaw:this.yaw,pitch:this.pitch,depth:this.depth,detail:w<620?24:36
      })
    },
    pointerDown(event:PointerEvent){
      if(event.button!==0)return
      const canvas=this.$refs.surface as HTMLCanvasElement
      this.dragging={id:event.pointerId,x:event.clientX,y:event.clientY,angle:this.yaw,pitch:this.pitch}
      canvas?.setPointerCapture?.(event.pointerId)
    },
    pointerMove(event:PointerEvent){
      const d=this.dragging
      if(!d||d.id!==event.pointerId)return
      this.yaw=d.angle+(event.clientX-d.x)*.007
      this.pitch=Math.max(.24,Math.min(1.3,d.pitch+(event.clientY-d.y)*.005))
      this.redraw()
    },
    pointerUp(){this.dragging=null},
    wheel(event:WheelEvent){
      event.preventDefault()
      if(!this.axes)return
      const f=event.deltaY>0?1.16:.86
      const axes=this.axes
      const cx=(axes.xMin+axes.xMax)/2,cy=(axes.yMin+axes.yMax)/2
      const hx=(axes.xMax-axes.xMin)*f/2,hy=(axes.yMax-axes.yMin)*f/2
      this.axes={...axes,xMin:cx-hx,xMax:cx+hx,yMin:cy-hy,yMax:cy+hy}
      this.redraw()
    }
  }
})
</script>

<template>
  <section class="gravity-flight" aria-label="Live gravitational wells replacing the starfield map">
    <canvas ref="surface" class="gravity-flight-surface"
      aria-label="Live inertial Newtonian gravitational potential of Veyra and Kestrel in the current canvas reference frame"
      @pointerdown="pointerDown" @pointermove="pointerMove"
      @pointerup="pointerUp" @pointercancel="pointerUp" @lostpointercapture="pointerUp"
      @wheel="wheel"></canvas>
    <div class="gravity-flight-heading">
      <span>COCKPIT / MATHEMATICAL VIEW</span>
      <strong>LIVE GRAVITATIONAL WELLS</strong>
      <small>Same universe, same spacecraft, different visualization</small>
    </div>
    <aside class="gravity-flight-controls" aria-label="Gravitational well axis controls">
      <div class="gravity-flight-title"><strong>AXIS WINDOW</strong><small>All axes linear</small></div>
      <div class="gravity-flight-presets" role="group" aria-label="Quick axis presets">
        <button type="button" :aria-pressed="preset==='kestrel'" @click="selectPreset('kestrel')">Kestrel</button>
        <button type="button" :aria-pressed="preset==='veyra'" @click="selectPreset('veyra')">Veyra</button>
        <button type="button" :aria-pressed="preset==='system'" @click="selectPreset('system')">Both</button>
      </div>
      <template v-if="axes">
        <div v-for="axis in (['x','y','z'] as const)" :key="axis" class="gravity-flight-axis">
          <label>{{ axis.toUpperCase() }} <span>{{ axis==='z' ? 'km²/s² · potential' : 'km · space' }}</span></label>
          <div class="gravity-flight-range">
            <input :aria-label="axis.toUpperCase()+' minimum'" type="number" step="any"
              :value="axes[(axis+'Min') as keyof Axes]" @change="setAxis((axis+'Min') as keyof Axes,$event)">
            <span>to</span>
            <input :aria-label="axis.toUpperCase()+' maximum'" type="number" step="any"
              :value="axes[(axis+'Max') as keyof Axes]" @change="setAxis((axis+'Max') as keyof Axes,$event)">
          </div>
        </div>
        <button type="button" class="gravity-flight-fit" @click="fitZ">Fit potential depth to X/Y</button>
      </template>
      <div class="gravity-flight-depth">
        <label for="gravity-flight-exaggeration">Display exaggeration <b>{{ depth.toFixed(1) }}×</b></label>
        <input id="gravity-flight-exaggeration" type="range" min=".4" max="2" step=".2"
          v-model.number="depth" @input="redraw">
      </div>
      <p v-if="invalid" class="gravity-flight-warning" role="status">{{ invalid }}</p>
      <p class="gravity-flight-explain">Adjust the X, Y and potential (Z) limits independently to reveal local or global curvature. The vertical scale changes only the picture, never gravity or ship motion</p>
    </aside>
    <div class="gravity-flight-metrics" aria-label="Live field at your spacecraft">
      <small>YOUR SPACECRAFT · NEWTONIAN FIELD</small>
      <div><span>Potential Φ</span><b>{{ playerPotential }}</b></div>
      <div><span>Acceleration |g|</span><b>{{ playerG }}</b></div>
      <p>Field measured in an inertial frame. In Kestrel's moving reference frame, the relative acceleration differs. This surface is not literal GR spacetime</p>
    </div>
    <div class="gravity-flight-hint">DRAG TO ROTATE · SCROLL TO ZOOM X/Y · EDIT AXIS LIMITS</div>
  </section>
</template>
