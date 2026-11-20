/* Live gravitational-well cockpit view.
 * Computes the Newtonian potential from the SAME star/planet coordinates
 * as flight, with independent linear axis windows. Read-only rendering:
 * no alternate physics integrator, no server commands.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OrbitalGravityFlight=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function world(snapshot,starSystem){
    const time=Number.isFinite(snapshot?.time)?snapshot.time:0;
    const systemView=!!snapshot?.systemView;
    const p=starSystem.planet(time),s=starSystem.star(time);
    const star=systemView?{x:0,y:0}:s,planet=systemView?p:{x:0,y:0};
    const bodies=[
      {name:'VEYRA',x:star.x,y:star.y,mu:starSystem.STAR_MU,
       radius:starSystem.STAR_RADIUS_KM},
      {name:'KESTREL',x:planet.x,y:planet.y,mu:starSystem.PLANET_MU,
       radius:85}
    ];
    const ships=(snapshot?.ships||[]).filter(a=>Number.isFinite(a.x)&&Number.isFinite(a.y))
      .map(a=>({id:a.id||'',name:a.name||'SPACECRAFT',
        x:a.x+(systemView?p.x:0),y:a.y+(systemView?p.y:0),
        player:!!a.player,alive:a.alive!==false}));
    return {time,systemView,bodies,ships};
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
    return a&&['xMin','xMax','yMin','yMax','zMin','zMax'].every(k=>Number.isFinite(a[k]))&&
      a.xMax>a.xMin&&a.yMax>a.yMin&&a.zMax>a.zMin;
  }
  function sampleRange(scene,a){
    let min=Infinity,max=-Infinity;
    for(let j=0;j<=24;j++)for(let i=0;i<=24;i++){
      const x=a.xMin+(a.xMax-a.xMin)*i/24,y=a.yMin+(a.yMax-a.yMin)*j/24;
      const v=field(scene,x,y).phi;
      min=Math.min(min,v);max=Math.max(max,v);
    }
    // Include the core when its center is inside the window, even if
    // the coarse grid fails to land precisely on the stellar/planet center.
    for(const b of scene.bodies)if(b.x>=a.xMin&&b.x<=a.xMax&&b.y>=a.yMin&&b.y<=a.yMax){
      const v=field(scene,b.x,b.y).phi;
      min=Math.min(min,v);max=Math.max(max,v);
    }
    const span=Math.max((max-min),Math.abs(max)*.00001,1e-8);
    return {min:min-.04*span,max:max+.12*span};
  }
  function axesFor(scene,preset='system'){
    const star=scene.bodies[0],planet=scene.bodies[1];
    let cx,cy,half;
    if(preset==='veyra'){
      cx=star.x;cy=star.y;half=star.radius*3;
    }else if(preset==='kestrel'){
      cx=planet.x;cy=planet.y;half=1400;
    }else{
      cx=(star.x+planet.x)*.5;cy=(star.y+planet.y)*.5;
      half=Math.hypot(star.x-planet.x,star.y-planet.y)*.64;
    }
    const a={xMin:cx-half,xMax:cx+half,yMin:cy-half,yMax:cy+half};
    const z=sampleRange(scene,a);
    return {...a,zMin:z.min,zMax:z.max};
  }
  function plotPoint(x,y,phi,axes,w,h,view){
    const u=(x-(axes.xMax+axes.xMin)*.5)/(axes.xMax-axes.xMin)*2;
    const v=(y-(axes.yMax+axes.yMin)*.5)/(axes.yMax-axes.yMin)*2;
    const yaw=view.yaw??-.62,pitch=view.pitch??.78;
    const co=Math.cos(yaw),si=Math.sin(yaw);
    const rx=u*co-v*si,ry=u*si+v*co;
    // Linear, independently adjustable physical axis ranges.
    // Vertical exaggerated rendering is deliberately dimensionless.
    const depth=Math.max(-.4,Math.min(1.4,(axes.zMax-phi)/(axes.zMax-axes.zMin)));
    const sx=Math.min(w*.83,h*.98)*.46;
    return {x:w*.5+rx*sx,y:h*.42+ry*Math.sin(pitch)*sx*.47+
      depth*h*.33*(view.depth??1),depth,order:ry};
  }
  function paint(ctx,w,h,scene,axes,options={}){
    if(!validAxes(axes))return null;
    const detail=Math.max(12,Math.min(46,Math.floor(options.detail||30)));
    ctx.fillStyle='#07111c';ctx.fillRect(0,0,w,h);
    const gradient=ctx.createLinearGradient(0,0,0,h);
    gradient.addColorStop(0,'#0d2231');gradient.addColorStop(1,'#06111b');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
    const grid=[];
    for(let j=0;j<=detail;j++){
      const row=[];
      for(let i=0;i<=detail;i++){
        const x=axes.xMin+(axes.xMax-axes.xMin)*i/detail;
        const y=axes.yMin+(axes.yMax-axes.yMin)*j/detail;
        const phi=field(scene,x,y).phi;
        row.push(plotPoint(x,y,phi,axes,w,h,options));
      }
      grid.push(row);
    }
    const quads=[];
    for(let j=0;j<detail;j++)for(let i=0;i<detail;i++){
      const a=grid[j][i],b=grid[j][i+1],c=grid[j+1][i+1],d=grid[j+1][i];
      quads.push({a,b,c,d,order:(a.order+b.order+c.order+d.order)/4,
        depth:(a.depth+b.depth+c.depth+d.depth)*.25});
    }
    quads.sort((a,b)=>a.order-b.order);
    ctx.lineWidth=.8;
    for(const q of quads){
      const t=Math.max(0,Math.min(1,q.depth));
      const hue=191-t*162,light=18+12*(1-t);
      ctx.beginPath();ctx.moveTo(q.a.x,q.a.y);ctx.lineTo(q.b.x,q.b.y);
      ctx.lineTo(q.c.x,q.c.y);ctx.lineTo(q.d.x,q.d.y);ctx.closePath();
      ctx.fillStyle='hsl('+hue.toFixed(1)+' 48% '+light.toFixed(1)+'%)';ctx.fill();
      ctx.strokeStyle='rgba(119,210,224,'+(.14+(1-t)*.24).toFixed(3)+')';ctx.stroke();
    }
    function at(x,y){return plotPoint(x,y,field(scene,x,y).phi,axes,w,h,options);}
    ctx.save();ctx.textAlign='center';ctx.font='700 11px system-ui,sans-serif';
    for(const body of scene.bodies){
      if(body.x<axes.xMin||body.x>axes.xMax||body.y<axes.yMin||body.y>axes.yMax)continue;
      const p=at(body.x,body.y);
      ctx.fillStyle='#e8c487';ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();
      ctx.fillText(body.name,p.x,p.y-14);
    }
    for(const ship of scene.ships)if(ship.alive&&ship.x>=axes.xMin&&ship.x<=axes.xMax&&ship.y>=axes.yMin&&ship.y<=axes.yMax){
      const p=at(ship.x,ship.y);
      ctx.strokeStyle=ship.player?'#8cfce6':'#f9acb5';
      ctx.fillStyle=ship.player?'#7aebd9':'#f4869a';
      ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,ship.player?4.6:3.3,0,2*Math.PI);ctx.fill();
      ctx.beginPath();ctx.arc(p.x,p.y,ship.player?9:6,0,2*Math.PI);ctx.stroke();
      if(ship.player){ctx.fillStyle='#d3fff5';ctx.fillText('YOUR SHIP',p.x,p.y-14);}
    }
    ctx.textAlign='left';ctx.font='10px ui-monospace,monospace';
    ctx.fillStyle='#9bbbc9';
    ctx.fillText('X  '+fmt(axes.xMin)+' to '+fmt(axes.xMax)+' km',12,h-32);
    ctx.fillText('Y  '+fmt(axes.yMin)+' to '+fmt(axes.yMax)+' km',12,h-18);
    ctx.restore();
    return {count:detail,quads:detail*detail};
  }
  function fmt(value){
    return Math.abs(value)>100000?value.toExponential(2):
      Number(value.toPrecision(5)).toLocaleString('en-US',{maximumFractionDigits:2});
  }
  return {world,field,axesFor,validAxes,sampleRange,plotPoint,paint,fmt};
});
