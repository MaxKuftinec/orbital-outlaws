<script lang="ts">
import {defineComponent, markRaw} from 'vue'
type Axes={xMin:number;xMax:number;yMin:number;yMax:number;zMin:number;zMax:number}
type Scene={bodies:any[];ships:any[];pickups:any[];shots:any[];entities:any[];camera:any;time:number;systemView:boolean}
type PointerSample={x:number;y:number}
type Drag={id:number;x:number;y:number;yaw:number;pitch:number;mode:'orbit'|'pan';moved:boolean}

export default defineComponent({
  name:'GravityFlightView',
  data(){
    return {
      preset:'camera' as 'camera'|'kestrel'|'veyra'|'system',
      yaw:0,pitch:0,depth:1,
      zoomMode:'fabric' as 'fabric'|'world',
      fabricZoom:1,
      palette:localStorage.getItem('orbital-outlaws.well-palette.v1')==='classic'?'classic':'survey',
      showBoundary:true,showOwnPath:true,showEphemerisPath:true,
      axes:null as Axes|null,
      scene:null as Scene|null,
      invalid:'',
      playerG:'—',playerPotential:'—',
      contactCount:0,
      showContacts:true,
      showLabels:true,
      frameId:0,
      observer:null as ResizeObserver|null,
      dragging:null as Drag|null,
      pointers:markRaw(new Map<number,PointerSample>()),
      pinch:null as {distance:number;mx:number;my:number}|null,
      backbuffer:null as HTMLCanvasElement|null,
      cacheDirty:true,
      lastSurfaceAt:0,lastDrawAt:0,lastReadoutAt:0,
      lastSurfaceAxes:null as Axes|null,
      lastSceneTime:0,
      shownEntities:markRaw([] as any[]),
      manualXY:false,
      manualZ:false,
      hasInitialized:false
    }
  },
  mounted(){
    this.backbuffer=markRaw(document.createElement('canvas'))
    this.refresh(true)
    if(typeof ResizeObserver!=='undefined'){
      this.observer=new ResizeObserver(()=>{this.cacheDirty=true;this.refresh(true)})
      this.observer.observe(this.$refs.surface as Element)
    }
    window.addEventListener('resize',this.onResize)
    this.frameId=requestAnimationFrame(this.frame)
  },
  beforeUnmount(){
    cancelAnimationFrame(this.frameId)
    this.observer?.disconnect()
    window.removeEventListener('resize',this.onResize)
    this.pointers.clear()
  },
  methods:{
    engine():any{return (window as any).OrbitalGravityFlight},
    snapshot():any{return (window as any).OrbitalGameSnapshot?.()},
    onResize(){this.cacheDirty=true;this.refresh(true)},
    refresh(force=false){
      const engine=this.engine(),snapshot=this.snapshot(),system=(window as any).OrbitalStarSystem
      if(!engine||!snapshot||!system)return
      const scene=engine.world(snapshot,system) as Scene
      // Follow the live Flight camera in the default mode. This includes
      // existing Follow Target/Player camera movement, not just a one-off copy.
      if(!this.axes||!this.hasInitialized){
        this.axes=engine.axesFromCamera(scene,snapshot.camera)
        this.hasInitialized=true
        this.cacheDirty=true
      }else if(!this.manualXY&&snapshot.camera){
        const cam=snapshot.camera,sc=cam.scale
        const cx=-cam.panX/sc,cy=-cam.panY/sc
        const w=cam.width/sc,h=cam.height/sc
        if(w>0&&h>0&&Number.isFinite(cx+cy)){
          const a=this.axes
          const next={xMin:cx-w/2,xMax:cx+w/2,yMin:cy-h/2,yMax:cy+h/2}
          // Ignore tiny subpixel shifts so the mesh isn't constantly redrawn.
          if(Math.abs((a.xMin-next.xMin)*sc)>.4||
             Math.abs((a.yMin-next.yMin)*sc)>.4||
             Math.abs(a.xMax-a.xMin-w)>w*.0002){
            this.axes={...a,...next}
            this.cacheDirty=true
          }
        }
      }
      this.scene=markRaw(scene)
      if(force)this.cacheDirty=true
    },
    frame(now:number){
      this.frameId=requestAnimationFrame(this.frame)
      if(document.hidden)return
      const canvas=this.$refs.surface as HTMLCanvasElement|undefined
      // Smooth ship/salvage movement at display refresh on desktop.
      // Touch devices use a 30-FPS budget to limit battery/mesh overhead.
      const coarse=window.matchMedia?.('(pointer:coarse)').matches??false
      if(!canvas||!this.engine()||now-this.lastDrawAt<(coarse?33:16))return
      this.lastDrawAt=now
      // Keep entity positions fluid (up to 30 Hz). The much more expensive
      // potential mesh is cached and refreshed only when its geometry changes.
      this.refresh()
      if(!this.scene||!this.axes)return
      this.drawFrame(now)
    },
    drawFrame(now:number){
      const canvas=this.$refs.surface as HTMLCanvasElement
      if(!canvas||!this.axes||!this.scene||!this.backbuffer)return
      const engine=this.engine(),axes=this.axes,scene=this.scene
      const w=Math.max(200,canvas.clientWidth),h=Math.max(200,canvas.clientHeight)
      const dpr=Math.min(window.devicePixelRatio||1,1.5)
      const pw=Math.round(w*dpr),ph=Math.round(h*dpr)
      if(canvas.width!==pw||canvas.height!==ph){
        canvas.width=pw;canvas.height=ph;this.cacheDirty=true
      }
      if(this.backbuffer.width!==pw||this.backbuffer.height!==ph){
        this.backbuffer.width=pw;this.backbuffer.height=ph;this.cacheDirty=true
      }
      const options={yaw:this.yaw,pitch:this.pitch,depth:this.depth,
        fabricZoom:this.fabricZoom,palette:this.palette,
        showBoundary:this.showBoundary,
        detail:w<620?23:36,showLabels:this.showLabels}
      if(this.cacheDirty||now-this.lastSurfaceAt>650){
        const bctx=this.backbuffer.getContext('2d',{alpha:false})
        if(bctx){
          bctx.setTransform(dpr,0,0,dpr,0,0)
          engine.paintSurface(bctx,w,h,scene,axes,options)
          this.cacheDirty=false;this.lastSurfaceAt=now
        }
      }
      const ctx=canvas.getContext('2d',{alpha:false})
      if(!ctx)return
      ctx.setTransform(dpr,0,0,dpr,0,0)
      ctx.drawImage(this.backbuffer,0,0,w,h)
      if(this.showOwnPath||this.showEphemerisPath){
        const plotted={...scene,
          orbitVisible:scene.orbitVisible&&this.showOwnPath,
          ephemerisVisible:scene.ephemerisVisible&&this.showEphemerisPath}
        engine.drawTrajectories(ctx,w,h,plotted,axes,options)
      }
      this.shownEntities=markRaw(this.showContacts?
        engine.drawEntities(ctx,w,h,scene,axes,options):[])
      if(now-this.lastReadoutAt>300){
        const pilot=scene.ships.find((ship:any)=>ship.player)
        if(pilot){
          const f=engine.field(scene,pilot.x,pilot.y)
          this.playerG=(f.g*1000).toPrecision(4)+' m/s²'
          this.playerPotential=f.phi.toPrecision(6)+' km²/s²'
        }
        this.contactCount=scene.entities.filter((e:any)=>e.alive&&e.type!=='shot').length
        this.lastReadoutAt=now
      }
    },
    invalidate(){this.cacheDirty=true},
    setPalette(name:'classic'|'survey'){
      if(name!=='classic'&&name!=='survey')return
      this.palette=name
      localStorage.setItem('orbital-outlaws.well-palette.v1',name)
      window.dispatchEvent(new Event('orbital-preferences-changed'))
      this.invalidate()
    },
    setZoomMode(mode:'fabric'|'world'){
      if(mode!=='fabric'&&mode!=='world')return
      this.zoomMode=mode
    },
    selectPreset(preset:'kestrel'|'veyra'|'system'){
      if(!this.scene)return
      this.preset=preset
      this.axes=this.engine().axesFor(this.scene,preset)
      this.manualXY=true;this.manualZ=true;this.invalid=''
      this.writeCamera()
      this.invalidate()
    },
    matchFlight(){
      this.fabricZoom=1
      this.preset='camera'
      this.manualXY=false;this.manualZ=false;this.invalid=''
      if(this.scene){
        this.axes=this.engine().axesFromCamera(this.scene,this.snapshot()?.camera)
        this.invalidate()
      }
      this.resetOverhead()
    },
    fitZ(){
      if(!this.scene||!this.axes)return
      const z=this.engine().sampleRange(this.scene,this.axes)
      this.axes={...this.axes,zMin:z.min,zMax:z.max}
      this.manualZ=true;this.invalid='';this.invalidate()
    },
    setAxis(name:keyof Axes,event:Event){
      if(!this.axes)return
      const raw=(event.target as HTMLInputElement).value
      const num=Number(raw)
      if(raw.trim()===''||!Number.isFinite(num))return
      const proposal={...this.axes,[name]:num}
      if(!this.engine().validAxes(proposal)){
        this.invalid='The maximum must exceed the minimum on each axis'
        return
      }
      this.invalid=''
      this.axes=proposal
      if(name==='xMin'||name==='xMax'||name==='yMin'||name==='yMax'){
        this.manualXY=true;this.preset='camera'
        this.writeCamera()
      }else this.manualZ=true
      this.invalidate()
    },
    writeCamera(){
      if(!this.axes)return
      const canvas=this.$refs.surface as HTMLCanvasElement|undefined
      const w=Math.max(200,canvas?.clientWidth||840),h=Math.max(200,canvas?.clientHeight||550)
      const a=this.axes
      const cx=(a.xMin+a.xMax)*.5,cy=(a.yMin+a.yMax)*.5
      // Flight has a uniform physical scale; for custom unequal axis spans,
      // fit both dimensions while keeping the same center. The well itself
      // retains the intentionally independent Desmos-style XY ranges.
      const scale=Math.min(w/(a.xMax-a.xMin),h/(a.yMax-a.yMin))
      ;(window as any).OrbitalGravityCameraUpdate?.({centerX:cx,centerY:cy,scale})
    },
    resetOverhead(){this.yaw=0;this.pitch=0;this.invalidate()},
    pointerDown(event:PointerEvent){
      if(event.pointerType!=='touch'&&event.button!==0&&event.button!==1&&event.button!==2)return
      event.preventDefault()
      const canvas=this.$refs.surface as HTMLCanvasElement
      canvas?.setPointerCapture?.(event.pointerId)
      this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY})
      if(this.pointers.size===2){
        const pts=[...this.pointers.values()]
        this.pinch={distance:Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y),
          mx:(pts[0].x+pts[1].x)/2,my:(pts[0].y+pts[1].y)/2}
        this.dragging=null
      }else if(this.pointers.size===1){
        this.dragging={id:event.pointerId,x:event.clientX,y:event.clientY,
          yaw:this.yaw,pitch:this.pitch,
          mode:(event.button!==0||event.shiftKey)?'pan':'orbit',moved:false}
      }
    },
    pointerMove(event:PointerEvent){
      if(!this.pointers.has(event.pointerId))return
      this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY})
      if(this.pointers.size>=2){
        const pts=[...this.pointers.values()]
        const next={distance:Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y),
          mx:(pts[0].x+pts[1].x)/2,my:(pts[0].y+pts[1].y)/2}
        if(this.pinch&&next.distance>10&&this.pinch.distance>10){
          this.zoomBy(this.pinch.distance/next.distance)
          this.panBy(next.mx-this.pinch.mx,next.my-this.pinch.my)
        }
        this.pinch=next
        return
      }
      const d=this.dragging
      if(!d||d.id!==event.pointerId)return
      const dx=event.clientX-d.x,dy=event.clientY-d.y
      if(Math.hypot(dx,dy)>3)d.moved=true
      if(!d.moved)return
      if(d.mode==='pan'){
        // Incremental screen-space panning while preserving free orbit angles.
        this.panBy(event.movementX||dx,event.movementY||dy)
        d.x=event.clientX;d.y=event.clientY
      }else{
        this.yaw=d.yaw+dx*.008
        this.pitch=d.pitch+dy*.008
        // Unrestricted pitch: 0 overhead, PI/2 side, PI underside, 2PI full turn.
        this.invalidate()
      }
    },
    pointerUp(event:PointerEvent){
      const d=this.dragging
      if(d&&d.id===event.pointerId&&!d.moved)this.pick(event)
      this.pointers.delete(event.pointerId)
      if(this.pointers.size<2)this.pinch=null
      this.dragging=null
    },
    pick(event:PointerEvent){
      if(!this.showContacts)return
      const canvas=this.$refs.surface as HTMLCanvasElement
      const rect=canvas.getBoundingClientRect()
      const x=event.clientX-rect.left,y=event.clientY-rect.top
      let nearest:any=null,dist=14*14
      for(const e of this.shownEntities){
        const ex=e.type==='body'?e.x:e.screenX
        const ey=e.type==='body'?e.y:e.screenY
        const d=(ex-x)**2+(ey-y)**2
        if(d<dist&&e.id){nearest=e;dist=d}
      }
      if(nearest)(window as any).OrbitalGravitySelectContact?.({
        type:nearest.type,id:nearest.type==='body'?nearest.name:nearest.id
      })
    },
    panBy(dx:number,dy:number){
      if(!this.axes)return
      const a=this.axes
      const canvas=this.$refs.surface as HTMLCanvasElement
      const w=Math.max(200,canvas?.clientWidth||800),h=Math.max(200,canvas?.clientHeight||550)
      const co=Math.cos(this.yaw),si=Math.sin(this.yaw)
      const magnification=Math.max(.15,this.fabricZoom)
      const xMove=-(dx*co+dy*si)*(a.xMax-a.xMin)/(w*magnification)
      const yMove=-(-dx*si+dy*co)*(a.yMax-a.yMin)/(h*magnification)
      this.axes={...a,xMin:a.xMin+xMove,xMax:a.xMax+xMove,
        yMin:a.yMin+yMove,yMax:a.yMax+yMove}
      this.manualXY=true;this.preset='camera'
      this.writeCamera();this.invalidate()
    },
    zoomBy(factor:number){
      if(!this.axes||!Number.isFinite(factor)||factor<=0)return
      const f=Math.max(.70,Math.min(1.43,factor))
      if(this.zoomMode==='fabric'){
        // Dolly/magnify the entire projected surface, without changing
        // physical world window, player position or Flight camera zoom.
        this.fabricZoom=Math.max(.15,Math.min(40,this.fabricZoom/f))
        this.invalidate()
        return
      }
      const a=this.axes
      const cx=(a.xMin+a.xMax)/2,cy=(a.yMin+a.yMax)/2
      const hx=(a.xMax-a.xMin)*f/2,hy=(a.yMax-a.yMin)*f/2
      this.axes={...a,xMin:cx-hx,xMax:cx+hx,yMin:cy-hy,yMax:cy+hy}
      this.manualXY=true;this.preset='camera'
      this.writeCamera();this.invalidate()
    },
    wheel(event:WheelEvent){
      event.preventDefault()
      this.zoomBy(Math.exp(Math.sign(event.deltaY)*.12))
    }
  }
})
</script>

<template>
  <section class="gravity-flight" aria-label="Live gravitational wells replacing the starfield map">
    <canvas ref="surface" class="gravity-flight-surface"
      aria-label="Live gravitational potential. Wheel zooms into fabric or world according to selected mode. Drag to rotate, right drag to pan"
      @contextmenu.prevent
      @pointerdown="pointerDown" @pointermove="pointerMove"
      @pointerup="pointerUp" @pointercancel="pointerUp" @lostpointercapture="pointerUp"
      @wheel="wheel"></canvas>
    <div class="gravity-flight-heading">
      <span>COCKPIT / MATHEMATICAL VIEW</span>
      <strong>LIVE GRAVITATIONAL WELLS</strong>
      <small>Same live sector · all contacts · shared flight camera</small>
    </div>
    <aside class="gravity-flight-controls" aria-label="Gravitational well axis controls">
      <div class="gravity-flight-title"><strong>AXIS WINDOW</strong><small>All axes linear</small></div>
      <div class="gravity-flight-presets" role="group" aria-label="Quick axis presets">
        <button type="button" :aria-pressed="preset==='kestrel'" @click="selectPreset('kestrel')">Kestrel</button>
        <button type="button" :aria-pressed="preset==='veyra'" @click="selectPreset('veyra')">Veyra</button>
        <button type="button" :aria-pressed="preset==='system'" @click="selectPreset('system')">Both</button>
      </div>
      <div class="gravity-flight-view-actions">
        <button type="button" @click="resetOverhead" title="Align view exactly with Flight">◎ Overhead</button>
        <button type="button" @click="matchFlight" title="Rejoin Flight pan and zoom exactly">⌖ Match Flight</button>
      </div>
      <div class="gravity-flight-zoom-modes" role="group" aria-label="Mouse wheel zoom operation">
        <span>SCROLL WHEEL CONTROLS</span>
        <div>
          <button type="button" :aria-pressed="zoomMode==='fabric'"
            @click="setZoomMode('fabric')">◉ Fabric zoom</button>
          <button type="button" :aria-pressed="zoomMode==='world'"
            @click="setZoomMode('world')">⊞ World zoom</button>
        </div>
        <small v-if="zoomMode==='fabric'">Move closer to the rendered well without changing physical X/Y bounds · {{ fabricZoom.toFixed(2) }}×</small>
        <small v-else>Change the spatial X/Y range and synchronize with the Flight map</small>
      </div>
      <div class="gravity-flight-orientation">Yaw {{ ((yaw*180/Math.PI)%360+360)%360|0 }}° · Tilt {{ ((pitch*180/Math.PI)%360+360)%360|0 }}°</div>
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
          v-model.number="depth" @input="invalidate">
      </div>
      <fieldset class="gravity-flight-palette">
        <legend>FABRIC COLOR PALETTE</legend>
        <div class="gravity-flight-palette-options">
          <button type="button" :aria-pressed="palette==='classic'"
            @click="setPalette('classic')"><span class="gravity-flight-palette-swatch classic"></span>Classic · Teal</button>
          <button type="button" :aria-pressed="palette==='survey'"
            @click="setPalette('survey')"><span class="gravity-flight-palette-swatch survey"></span>Survey · Contrast</button>
        </div>
        <small>Classic is retained unchanged; Survey is the new preview theme</small>
      </fieldset>
      <label class="gravity-flight-show-contacts"><input v-model="showBoundary" type="checkbox" @change="invalidate"> Show physical surface / interior</label>
      <label class="gravity-flight-show-contacts"><input v-model="showOwnPath" type="checkbox"> Own trajectory</label>
      <label class="gravity-flight-show-contacts"><input v-model="showEphemerisPath" type="checkbox"> Ephemeris forecast (if installed)</label>
      <label class="gravity-flight-show-contacts"><input v-model="showContacts" type="checkbox"> Show live objects</label>
      <label class="gravity-flight-show-contacts"><input v-model="showLabels" type="checkbox"> Object labels</label>
      <p v-if="invalid" class="gravity-flight-warning" role="status">{{ invalid }}</p>
      <p class="gravity-flight-explain">Dashed cyan is your flight forecast; dashed gold is Ephemeris. The bright body-radius ring separates the actual spherical interior from exterior space. Fabric zoom moves the view toward the surface; World zoom changes map axes</p>
    </aside>
    <div class="gravity-flight-metrics" aria-label="Live field at your spacecraft">
      <small>YOUR SPACECRAFT · NEWTONIAN FIELD</small>
      <div><span>Potential Φ</span><b>{{ playerPotential }}</b></div>
      <div><span>Acceleration |g|</span><b>{{ playerG }}</b></div>
      <div><span>Live contacts</span><b>{{ contactCount }}</b></div>
      <div class="gravity-flight-legend">◈ Credits · ◆ Wreck · ● Fuel · ▲ Ammo · ◇ Parts · ◎ Ships</div>
      <p>Inertial Newtonian potential, not literal curved spacetime or Kestrel-frame effective potential</p>
    </div>
    <div class="gravity-flight-hint">DRAG ORBIT 360° · RIGHT/SHIFT DRAG PAN · SCROLL {{ zoomMode.toUpperCase() }} ZOOM · TAP SELECT · PINCH ZOOM</div>
  </section>
</template>
