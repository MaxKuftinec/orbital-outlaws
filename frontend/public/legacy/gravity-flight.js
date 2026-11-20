/* Live mathematical view of the authoritative world. Drawing only; never
 * changes gravity, combat, or player state. Coordinates, entities and camera
 * come from the same cockpit snapshot as the ordinary Flight renderer.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OrbitalGravityFlight=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TWO_PI=Math.PI*2;
  const PALETTES=Object.freeze({
    classic:Object.freeze({
      name:'Original Teal',top:'#0e2534',bottom:'#050e1a',
      rim:'#e6c17c',inside:'rgba(239,185,119,.38)',
      grid:'rgba(110,207,228,.25)',axis:'#87aebe',
      own:'#62d9f6',danger:'#ff7184',ephemeris:'#edbe6b'
    }),
    survey:Object.freeze({
      name:'Survey · High Contrast',top:'#0d1728',bottom:'#080b17',
      rim:'#fcf6df',inside:'rgba(249,148,76,.43)',
      grid:'rgba(235,239,254,.32)',axis:'#ced8eb',
      own:'#48e2ff',danger:'#ff6688',ephemeris:'#ffe078'
    })
  });
  function paletteFor(name){return PALETTES[name]||PALETTES.survey;}
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function world(snapshot,system){
    const time=Number.isFinite(snapshot?.time)?snapshot.time:0;
    const systemView=!!snapshot?.systemView;
    const p=system.planet(time),s=system.star(time);
    const offset=systemView?p:{x:0,y:0};
    const star=systemView?{x:0,y:0}:s,planet=systemView?p:{x:0,y:0};
    const map=a=>({
      id:String(a.id??''),name:String(a.name??''),
      x:a.x+offset.x,y:a.y+offset.y,alive:a.alive!==false,
      type:String(a.type||'ship'),player:!!a.player,
      amount:Number.isFinite(a.amount)?a.amount:null
    });
    const ships=(snapshot?.ships||[]).filter(a=>Number.isFinite(a.x)&&Number.isFinite(a.y)).map(map);
    const pickups=(snapshot?.pickups||[]).filter(a=>Number.isFinite(a.x)&&Number.isFinite(a.y)).map(map);
    const shots=(snapshot?.shots||[]).filter(a=>Number.isFinite(a.x)&&Number.isFinite(a.y)).map(map);
    const waypoint=snapshot?.waypoint&&Number.isFinite(snapshot.waypoint.x)&&Number.isFinite(snapshot.waypoint.y)
      ?map({...snapshot.waypoint,type:'waypoint',name:'WAYPOINT'}):null;
    return {time,systemView,camera:snapshot?.camera||null,
      selectedNavKey:String(snapshot?.selectedNavKey||''),
      orbitVisible:!!snapshot?.orbitVisible,
      dangerPrediction:!!snapshot?.dangerPrediction,
      ownTrajectory:Array.isArray(snapshot?.ownTrajectory)?snapshot.ownTrajectory:[],
      ephemerisOwned:!!snapshot?.ephemerisOwned,
      ephemerisVisible:!!snapshot?.ephemerisVisible,
      ephemerisFrame:snapshot?.ephemerisFrame==='star'?'star':'planet',
      ephemeris:snapshot?.ephemeris||null,
      system,
      bodies:[
        {name:'VEYRA',x:star.x,y:star.y,mu:system.STAR_MU,radius:system.STAR_RADIUS_KM},
        {name:'KESTREL',x:planet.x,y:planet.y,mu:system.PLANET_MU,radius:85}
      ],
      ships,pickups,shots,waypoint,entities:[
        ...pickups.filter(a=>a.alive),...ships.filter(a=>a.alive),
        ...shots.filter(a=>a.alive),...(waypoint?[waypoint]:[])
      ]};
  }
  function field(scene,x,y){
    let phi=0,gx=0,gy=0;
    for(const b of scene.bodies){
      const dx=x-b.x,dy=y-b.y,r=Math.hypot(dx,dy),R=b.radius;
      if(r<R){
        phi-=b.mu*(3*R*R-r*r)/(2*R*R*R);
        const f=-b.mu/(R*R*R);gx+=f*dx;gy+=f*dy;
      }else{
        const safe=Math.max(r,1e-10),f=-b.mu/(safe**3);
        phi-=b.mu/safe;gx+=f*dx;gy+=f*dy;
      }
    }
    return {phi,gx,gy,g:Math.hypot(gx,gy)};
  }
  function validAxes(a){
    return !!a&&['xMin','xMax','yMin','yMax','zMin','zMax']
      .every(k=>Number.isFinite(a[k]))&&
      a.xMax>a.xMin&&a.yMax>a.yMin&&a.zMax>a.zMin;
  }
  function sampleRange(scene,a){
    let min=Infinity,max=-Infinity;
    for(let j=0;j<=24;j++)for(let i=0;i<=24;i++){
      const x=a.xMin+(a.xMax-a.xMin)*i/24,y=a.yMin+(a.yMax-a.yMin)*j/24;
      const v=field(scene,x,y).phi;
      min=Math.min(min,v);max=Math.max(max,v);
    }
    for(const b of scene.bodies)if(b.x>=a.xMin&&b.x<=a.xMax&&b.y>=a.yMin&&b.y<=a.yMax){
      const v=field(scene,b.x,b.y).phi;min=Math.min(min,v);max=Math.max(max,v);
    }
    const span=Math.max(max-min,Math.abs(max)*.00001,1e-8);
    return {min:min-.04*span,max:max+.12*span};
  }
  function axesFor(scene,preset='system'){
    const star=scene.bodies[0],planet=scene.bodies[1];
    let cx,cy,half;
    if(preset==='veyra'){cx=star.x;cy=star.y;half=star.radius*3;}
    else if(preset==='kestrel'){cx=planet.x;cy=planet.y;half=1400;}
    else{cx=(star.x+planet.x)*.5;cy=(star.y+planet.y)*.5;
      half=Math.hypot(star.x-planet.x,star.y-planet.y)*.64;}
    const a={xMin:cx-half,xMax:cx+half,yMin:cy-half,yMax:cy+half};
    const z=sampleRange(scene,a);
    return {...a,zMin:z.min,zMax:z.max};
  }
  function axesFromCamera(scene,camera){
    if(!camera||!Number.isFinite(camera.scale)||camera.scale<=0||
      !(camera.width>0&&camera.height>0))return axesFor(scene,'kestrel');
    const cX=-(camera.panX||0)/camera.scale,cY=-(camera.panY||0)/camera.scale;
    const xSpan=camera.width/camera.scale,ySpan=camera.height/camera.scale;
    const a={xMin:cX-xSpan/2,xMax:cX+xSpan/2,yMin:cY-ySpan/2,yMax:cY+ySpan/2};
    const z=sampleRange(scene,a);
    return {...a,zMin:z.min,zMax:z.max};
  }
  // At yaw=tilt=0 the projection is EXACTLY the Flight screen transform
  // when axes are built from the flight camera. Tilt is unrestricted; a full
  // revolution around either axis works, including true overhead and below.
  function plotPoint(x,y,phi,axes,w,h,view={}){
    const dx=(x-(axes.xMin+axes.xMax)*.5)*w/(axes.xMax-axes.xMin);
    const dy=(y-(axes.yMin+axes.yMax)*.5)*h/(axes.yMax-axes.yMin);
    const yaw=view.yaw??0,tilt=view.pitch??0;
    const cs=Math.cos(yaw),sn=Math.sin(yaw);
    const rx=dx*cs-dy*sn,ry=dx*sn+dy*cs;
    const depth=clamp((axes.zMax-phi)/(axes.zMax-axes.zMin),-.5,1.5);
    const z=depth*Math.min(w,h)*.45*(view.depth??1);
    // Fabric magnification moves our virtual view closer to the same
    // geometric surface. It DOES NOT edit physical X/Y/Z axis bounds.
    // At magnification 1 and overhead 0 the screen is pixel-aligned to Flight.
    const magnification=clamp(view.fabricZoom??1,.15,40);
    return {x:w*.5+rx*magnification,
      y:h*.5+(ry*Math.cos(tilt)+z*Math.sin(tilt))*magnification,
      depth,order:ry*Math.cos(tilt)-z*Math.sin(tilt)};
  }
  function paintSurface(ctx,w,h,scene,axes,options={}){
    if(!validAxes(axes))return null;
    const detail=clamp(Math.floor(options.detail||30),12,50);
    ctx.fillStyle='#07111c';ctx.fillRect(0,0,w,h);
    const colors=paletteFor(options.palette);
    const gradient=ctx.createLinearGradient(0,0,0,h);
    gradient.addColorStop(0,colors.top);gradient.addColorStop(1,colors.bottom);
    ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
    const grid=[];
    for(let j=0;j<=detail;j++){
      const row=[];
      for(let i=0;i<=detail;i++){
        const x=axes.xMin+(axes.xMax-axes.xMin)*i/detail;
        const y=axes.yMin+(axes.yMax-axes.yMin)*j/detail;
        row.push(plotPoint(x,y,field(scene,x,y).phi,axes,w,h,options));
      }
      grid.push(row);
    }
    const quads=[];
    for(let j=0;j<detail;j++)for(let i=0;i<detail;i++){
      const a=grid[j][i],b=grid[j][i+1],c=grid[j+1][i+1],d=grid[j+1][i];
      quads.push({a,b,c,d,order:(a.order+b.order+c.order+d.order)*.25,
        depth:(a.depth+b.depth+c.depth+d.depth)*.25,
        x:axes.xMin+(axes.xMax-axes.xMin)*(i+.5)/detail,
        y:axes.yMin+(axes.yMax-axes.yMin)*(j+.5)/detail});
    }
    quads.sort((a,b)=>a.order-b.order);
    ctx.lineWidth=.7;
    for(const q of quads){
      const t=clamp(q.depth,0,1),hue=193-t*157,light=18+14*(1-t);
      ctx.beginPath();ctx.moveTo(q.a.x,q.a.y);ctx.lineTo(q.b.x,q.b.y);
      ctx.lineTo(q.c.x,q.c.y);ctx.lineTo(q.d.x,q.d.y);ctx.closePath();
      const inside=scene.bodies.some(b=>Math.hypot(q.x-b.x,q.y-b.y)<b.radius);
      if(options.palette==='classic'){
        ctx.fillStyle='hsl('+hue.toFixed(0)+' 50% '+light.toFixed(1)+'%)';
        ctx.strokeStyle='rgba(110,207,228,'+(.20+(1-t)*.23).toFixed(3)+')';
      }else{
        // High-contrast Survey palette: distinct exterior / interior areas
        // even when the two masses' potential contributions overlap.
        const tint=clamp(t,0,1);
        ctx.fillStyle=inside?'hsl(26 65% '+(26+18*tint).toFixed(1)+'%)':
          'hsl('+(206-45*tint).toFixed(0)+' 45% '+(22+23*tint).toFixed(1)+'%)';
        ctx.strokeStyle=colors.grid;
      }
      ctx.fill();ctx.stroke();
    }
    if(options.showBoundary!==false)drawBodyBoundaries(ctx,w,h,scene,axes,options);
    return {count:detail,quads:detail*detail};
  }
  // The physical surface (r=R) separates the parabolic interior from
  // the inverse-distance exterior. Fill the interior and outline the EXACT
  // material radius independently of mesh tessellation
  function drawBodyBoundaries(ctx,w,h,scene,axes,options={}){
    const colors=paletteFor(options.palette);
    ctx.save();
    ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
    for(const b of scene.bodies){
      const visible=!(b.x+b.radius<axes.xMin||b.x-b.radius>axes.xMax||
        b.y+b.radius<axes.yMin||b.y-b.radius>axes.yMax);
      if(!visible)continue;
      ctx.beginPath();
      const count=96;
      for(let i=0;i<=count;i++){
        const angle=i*TWO_PI/count;
        const x=b.x+Math.cos(angle)*b.radius;
        const y=b.y+Math.sin(angle)*b.radius;
        const p=plotPoint(x,y,field(scene,x,y).phi,axes,w,h,options);
        if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
      }
      ctx.closePath();
      ctx.fillStyle=colors.inside;ctx.fill();
      ctx.strokeStyle=colors.rim;ctx.lineWidth=2.4;
      ctx.setLineDash([]);ctx.stroke();
      const edge=plotPoint(b.x+b.radius,b.y,
        field(scene,b.x+b.radius,b.y).phi,axes,w,h,options);
      if(edge.x>=-70&&edge.x<=w+70&&edge.y>=-30&&edge.y<=h+30){
        ctx.font='bold 10px ui-monospace,monospace';
        ctx.fillStyle=colors.rim;ctx.textAlign='left';
        ctx.fillText('SURFACE · R '+fmt(b.radius)+' km',edge.x+6,edge.y-8);
      }
    }
    ctx.restore();
  }
  // Forecast points are Kestrel-relative. Their future epoch is essential
  // when plotting in the Veyra frame, while Kestrel-frame forecasts remain
  // attached to the moving planet, as requested for the Ephemeris Computer.
  function trajectoryPoint(scene,point,relativeSeconds,reference){
    if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
    const time=Number.isFinite(relativeSeconds)?relativeSeconds:0;
    const planetNow=scene.system.planet(scene.time);
    const future=reference==='star'?scene.system.planet(scene.time+time):planetNow;
    return {x:point.x+future.x-(scene.systemView?0:planetNow.x),
      y:point.y+future.y-(scene.systemView?0:planetNow.y)};
  }
  function trajectoryPaths(scene){
    const own=scene.orbitVisible?scene.ownTrajectory.map(p=>trajectoryPoint(
      scene,p,(Number.isFinite(p.t)?p.t:scene.time)-scene.time,
      scene.systemView?'star':'planet')).filter(Boolean):[];
    const ephem=scene.ephemerisOwned&&scene.ephemerisVisible&&scene.ephemeris?
      (scene.ephemeris.points||[]).map(p=>trajectoryPoint(
        scene,p,Number.isFinite(p.t)?p.t:0,scene.ephemerisFrame)).filter(Boolean):[];
    const markers=scene.ephemerisOwned&&scene.ephemerisVisible&&scene.ephemeris?
      (scene.ephemeris.markers||[]).map((m,i)=>m?.safe?
        {point:trajectoryPoint(scene,m,(i+1)*60,scene.ephemerisFrame),
         label:'T+'+(i+1)*60+'s'}:null).filter(Boolean):[];
    return {own,ephem,markers};
  }
  function drawTrajectories(ctx,w,h,scene,axes,options={}){
    if(!validAxes(axes))return;
    const colors=paletteFor(options.palette);
    const paths=trajectoryPaths(scene);
    const visible=(points,color,dash)=>{
      if(points.length<2)return;
      ctx.beginPath();
      let first=true;
      for(const p of points){
        const pt=plotPoint(p.x,p.y,field(scene,p.x,p.y).phi,axes,w,h,options);
        if(!Number.isFinite(pt.x+pt.y))continue;
        if(first){ctx.moveTo(pt.x,pt.y);first=false;}
        else ctx.lineTo(pt.x,pt.y);
      }
      if(!first){ctx.strokeStyle=color;ctx.lineWidth=2.4;ctx.setLineDash(dash);ctx.stroke();}
    };
    ctx.save();ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
    visible(paths.own,scene.dangerPrediction?colors.danger:colors.own,[6,4]);
    visible(paths.ephem,colors.ephemeris,[9,5]);
    ctx.setLineDash([]);
    for(const m of paths.markers){
      if(!m?.point)continue;
      const p=plotPoint(m.point.x,m.point.y,field(scene,m.point.x,m.point.y).phi,
        axes,w,h,options);
      ctx.fillStyle=colors.ephemeris;ctx.beginPath();
      ctx.arc(p.x,p.y,4.5,0,TWO_PI);ctx.fill();
      ctx.font='bold 10px ui-monospace,monospace';
      ctx.fillText(m.label,p.x+9,p.y-8);
    }
    ctx.restore();
  }
  function shape(ctx,type,x,y,color,r){
    ctx.save();ctx.translate(x,y);ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.6;
    ctx.beginPath();
    if(type==='wreck'||type==='credits'||type==='parts'){
      ctx.moveTo(0,-r);ctx.lineTo(r,0);ctx.lineTo(0,r);ctx.lineTo(-r,0);ctx.closePath();
    }else if(type==='ammo'||type==='shot'){
      ctx.moveTo(0,-r);ctx.lineTo(r,r);ctx.lineTo(-r,r);ctx.closePath();
    }else if(type==='fuel'){
      ctx.moveTo(0,-r);ctx.bezierCurveTo(r*1.4,0,r,r,0,r);
      ctx.bezierCurveTo(-r,r,-r*1.4,0,0,-r);ctx.closePath();
    }else if(type==='waypoint'){
      ctx.moveTo(-r,-r);ctx.lineTo(r,-r);ctx.lineTo(r,r);
      ctx.lineTo(-r,r);ctx.closePath();
    }else{ctx.arc(0,0,r,0,TWO_PI);}
    if(type==='wreck'||type==='waypoint'){ctx.stroke();}
    else ctx.fill();
    ctx.restore();
  }
  function entityColor(entity){
    if(entity.player)return '#9dfff0';
    return {credits:'#f5d386',fuel:'#63eabe',ammo:'#eea5f1',parts:'#adbeff',
      wreck:'#fba5a5',waypoint:'#edc77e',shot:'#ffbf8d',
      ally:'#66d8b0',enemy:'#f48b9f'}[entity.type]||'#f58b9f';
  }
  function drawEntities(ctx,w,h,scene,axes,options={}){
    if(!validAxes(axes))return [];
    const rendered=[];
    ctx.save();ctx.textAlign='center';ctx.font='700 10px system-ui,sans-serif';
    for(const b of scene.bodies){
      if(b.x<axes.xMin||b.x>axes.xMax||b.y<axes.yMin||b.y>axes.yMax)continue;
      const p=plotPoint(b.x,b.y,field(scene,b.x,b.y).phi,axes,w,h,options);
      if(p.x< -20||p.x>w+20||p.y< -20||p.y>h+20)continue;
      shape(ctx,'star',p.x,p.y,'#efc786',5.3);
      ctx.fillStyle='#f4cd8c';ctx.fillText(b.name,p.x,p.y-13);
      rendered.push({...b,id:b.name,x:p.x,y:p.y,type:'body'});
    }
    // Draw spacecraft and pickups from the SAME live sector, not fabricated
    // background markers. At stellar scale several may share a pixel; the
    // local zoom preserves every contact individually.
    for(const e of scene.entities){
      if(!e.alive||e.x<axes.xMin||e.x>axes.xMax||
        e.y<axes.yMin||e.y>axes.yMax)continue;
      const p=plotPoint(e.x,e.y,field(scene,e.x,e.y).phi,axes,w,h,options);
      if(p.x< -16||p.x>w+16||p.y< -16||p.y>h+16)continue;
      const color=entityColor(e),size=e.player?5.2:e.type==='shot'?2.2:4;
      shape(ctx,e.type,p.x,p.y,color,size);
      if(e.player){ctx.strokeStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,10,0,TWO_PI);ctx.stroke();}
      const targetKey=e.type==='ally'?'ally:'+e.id:
        e.type==='enemy'?'enemy:'+e.id:
        ['wreck','fuel','credits','ammo','parts'].includes(e.type)?'pickup:'+e.id:'';
      const isSelected=!!targetKey&&(scene.selectedNavKey===targetKey||
        (e.type==='ally'&&scene.selectedNavKey==='ally'&&
         scene.ships.filter(a=>a.type==='ally')[0]?.id===e.id));
      if(isSelected){
        ctx.strokeStyle='#ffe4a0';ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(p.x,p.y,13,0,TWO_PI);ctx.stroke();
      }
      const caption=e.player?'YOUR SHIP':
        e.type==='ship'?(e.name||'SPACECRAFT'):
        e.type==='shot'?'':e.type.toUpperCase()+(e.type==='credits'&&e.amount!==null?' · '+e.amount+' ¤':'');
      if(caption && (options.showLabels!==false||e.player)){
        ctx.fillStyle=color;ctx.fillText(caption.slice(0,30),p.x,p.y-12);
      }
      rendered.push({...e,screenX:p.x,screenY:p.y});
    }
    ctx.textAlign='left';ctx.fillStyle=paletteFor(options.palette).axis;
    ctx.font='10px ui-monospace,monospace';
    ctx.fillText('X '+fmt(axes.xMin)+' — '+fmt(axes.xMax)+' km',12,h-32);
    ctx.fillText('Y '+fmt(axes.yMin)+' — '+fmt(axes.yMax)+' km',12,h-18);
    ctx.restore();
    return rendered;
  }
  function paint(ctx,w,h,scene,axes,options={}){
    const mesh=paintSurface(ctx,w,h,scene,axes,options);
    drawTrajectories(ctx,w,h,scene,axes,options);
    drawEntities(ctx,w,h,scene,axes,options);
    return mesh;
  }
  // Normalized camera strafe direction: diagonal key combinations don't
  // move faster, and opposing keys cancel rather than accumulating drift.
  function cameraKeyVector(keys){
    const x=Number(keys.has('KeyA'))-Number(keys.has('KeyD'));
    const y=Number(keys.has('KeyW'))-Number(keys.has('KeyS'));
    const length=Math.hypot(x,y);
    return length?{x:x/length,y:y/length}:{x:0,y:0};
  }
  function fmt(value){
    return Math.abs(value)>1e5?value.toExponential(2):
      Number(value.toPrecision(5)).toLocaleString('en-US',{maximumFractionDigits:2});
  }
  return {world,field,axesFor,axesFromCamera,validAxes,sampleRange,PALETTES,paletteFor,
    plotPoint,paintSurface,drawBodyBoundaries,trajectoryPoint,trajectoryPaths,
    drawTrajectories,drawEntities,paint,fmt,entityColor,cameraKeyVector};
});
