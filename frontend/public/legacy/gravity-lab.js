/* Orbital Outlaws Physics Lab — lightweight, read-only Newtonian potential.
 * Height is an EXAGGERATED plot of Phi, not curved spacetime or a geodesic.
 * No WebGL dependencies or independent physics authority.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OrbitalGravityLab=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PI=Math.PI;
  function scenario(id,time=0,system){
    if(id==='uniform')return {
      id,title:'Interior of a uniform sphere',note:'Ideal uniform-density sphere. The interior potential is a paraboloid',
      extent:1300,bodies:[{name:'UNIFORM SPHERE',x:0,y:0,mu:700000,radius:310}],epoch:time
    };
    if(id==='binary')return {
      id,title:'Equal masses · the gravitational saddle',
      note:'At the midpoint, acceleration cancels but potential and tidal gradients remain',
      extent:1300,bodies:[{name:'MASS A',x:-455,y:0,mu:220000,radius:105},
                          {name:'MASS B',x:455,y:0,mu:220000,radius:105}],epoch:time
    };
    if(id==='kestrel'&&system){
      const sun=system.star(time);
      return {
        id,title:'Kestrel vicinity · Veyra + Kestrel',
        note:'Inertial Newtonian potential, centered on Kestrel. Kestrel uses its current idealized radius',
        extent:2350,epoch:time,bodies:[
          {name:'KESTREL',x:0,y:0,mu:system.PLANET_MU,radius:85},
          {name:'VEYRA',x:sun.x,y:sun.y,mu:system.STAR_MU,radius:system.STAR_RADIUS_KM}
        ]
      };
    }
    return scenario('binary',time,system);
  }
  function fieldAt(scene,x,y){
    let phi=0,gx=0,gy=0;
    for(const body of scene.bodies){
      const dx=x-body.x,dy=y-body.y,r=Math.hypot(dx,dy),R=body.radius;
      if(r<R){
        // Uniform density: Phi(r)=-mu(3R²-r²)/(2R³)
        phi-=body.mu*(3*R*R-r*r)/(2*R*R*R);
        const coeff=-body.mu/(R*R*R);
        gx+=coeff*dx;gy+=coeff*dy;
      }else{
        phi-=body.mu/Math.max(r,1e-15);
        const coeff=-body.mu/(Math.max(r,1e-15)**3);
        gx+=coeff*dx;gy+=coeff*dy;
      }
    }
    return {phi,gx,gy,g:Math.hypot(gx,gy)};
  }
  function surface(scene,detail){
    const count=Math.max(8,Math.min(64,Math.floor(detail)));
    const rows=[],extent=scene.extent;
    let min=Infinity,max=-Infinity;
    for(let j=0;j<=count;j++){
      const row=[];
      for(let i=0;i<=count;i++){
        const x=extent*(-1+2*i/count),y=extent*(-1+2*j/count);
        const f=fieldAt(scene,x,y);
        min=Math.min(min,f.phi);max=Math.max(max,f.phi);
        row.push({x,y,phi:f.phi});
      }
      rows.push(row);
    }
    return {count,rows,min,max};
  }
  function project(x,y,depth,w,h,opt){
    const angle=opt.yaw,cos=Math.cos(angle),sin=Math.sin(angle);
    const rx=cos*x-sin*y,ry=sin*x+cos*y;
    const unit=opt.zoom/opt.scene.extent;
    const diameter=Math.min(w,h*1.5);
    return {
      x:w*.5+rx*unit*diameter*.31,
      y:h*.29+ry*unit*Math.sin(opt.pitch)*h*.25+depth*h*.31*opt.depth,
      order:ry
    };
  }
  function paint(ctx,w,h,scene,settings={}){
    const opts={
      scene,yaw:settings.yaw??-.72,pitch:settings.pitch??.84,
      zoom:settings.zoom??1,depth:settings.depth??1
    };
    const mesh=surface(scene,settings.detail??36);
    ctx.fillStyle='#061422';ctx.fillRect(0,0,w,h);
    const bg=ctx.createRadialGradient(w*.5,h*.35,12,w*.5,h*.48,Math.max(w,h)*.75);
    bg.addColorStop(0,'#142e40');bg.addColorStop(1,'#060d18');
    ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    const rng=Math.max(1e-12,mesh.max-mesh.min);
    const points=mesh.rows.map(row=>row.map(p=>{
      const depth=(mesh.max-p.phi)/rng;
      return {...project(p.x,p.y,depth,w,h,opts),phi:p.phi,depth};
    }));
    const quads=[];
    for(let j=0;j<mesh.count;j++)for(let i=0;i<mesh.count;i++){
      const a=points[j][i],b=points[j][i+1],c=points[j+1][i+1],d=points[j+1][i];
      quads.push({a,b,c,d,order:(a.order+b.order+c.order+d.order)/4,
        depth:(a.depth+b.depth+c.depth+d.depth)/4});
    }
    quads.sort((a,b)=>a.order-b.order);
    ctx.lineWidth=Math.max(.55,Math.min(1.0,w/1300));
    for(const q of quads){
      const deep=q.depth;
      const hue=193-157*deep;
      ctx.beginPath();ctx.moveTo(q.a.x,q.a.y);ctx.lineTo(q.b.x,q.b.y);
      ctx.lineTo(q.c.x,q.c.y);ctx.lineTo(q.d.x,q.d.y);ctx.closePath();
      ctx.fillStyle='hsl('+hue.toFixed(0)+' 44% '+(17+15*(1-deep)).toFixed(0)+'%)';
      ctx.fill();
      ctx.strokeStyle='rgba(112,205,222,'+(0.13+0.24*(1-deep)).toFixed(2)+')';
      ctx.stroke();
    }
    // A small set of acceleration arrows is inexpensive, even on phones.
    if(settings.arrows){
      for(let j=-3;j<=3;j++)for(let i=-3;i<=3;i++){
        const x=i*scene.extent/4,y=j*scene.extent/4;
        const f=fieldAt(scene,x,y);
        if(f.g<1e-12)continue;
        const direction=scene.extent*.07/f.g;
        const start=pointOnSurface(x,y),end=pointOnSurface(x+f.gx*direction,y+f.gy*direction);
        arrow(ctx,start,end,'#98efba');
      }
    }
    function pointOnSurface(x,y){
      const f=fieldAt(scene,x,y);
      return project(x,y,(mesh.max-f.phi)/rng,w,h,opts);
    }
    for(const body of scene.bodies){
      if(Math.abs(body.x)>scene.extent*1.2||Math.abs(body.y)>scene.extent*1.2)continue;
      const p=pointOnSurface(body.x,body.y);
      ctx.fillStyle='#ffd292';ctx.beginPath();ctx.arc(p.x,p.y,5,0,2*PI);ctx.fill();
      ctx.font='700 11px system-ui,sans-serif';ctx.textAlign='center';
      ctx.fillText(body.name,p.x,p.y-15);
    }
    if(settings.probe){
      const f=fieldAt(scene,settings.probe.x,settings.probe.y);
      const p=pointOnSurface(settings.probe.x,settings.probe.y);
      ctx.beginPath();ctx.arc(p.x,p.y,8,0,2*PI);
      ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
      ctx.beginPath();ctx.moveTo(p.x-13,p.y);ctx.lineTo(p.x+13,p.y);
      ctx.moveTo(p.x,p.y-13);ctx.lineTo(p.x,p.y+13);ctx.stroke();
    }
    return {mesh,points,projected:pointOnSurface};
  }
  function arrow(ctx,a,b,color){
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    if(len<3)return;
    const ux=dx/len,uy=dy/len;
    ctx.strokeStyle=color;ctx.lineWidth=1.8;ctx.beginPath();
    ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    ctx.moveTo(b.x-ux*7-uy*4,b.y-uy*7+ux*4);
    ctx.lineTo(b.x,b.y);
    ctx.lineTo(b.x-ux*7+uy*4,b.y-uy*7-ux*4);ctx.stroke();
  }
  function pickNearest(view,px,py){
    let result=null,dist=Infinity;
    for(let j=0;j<view.mesh.rows.length;j++)for(let i=0;i<view.mesh.rows[j].length;i++){
      const p=view.points[j][i],dx=px-p.x,dy=py-p.y,d=dx*dx+dy*dy;
      if(d<dist){dist=d;result=view.mesh.rows[j][i];}
    }
    return result&&dist<4000?{x:result.x,y:result.y}:null;
  }
  return {scenario,fieldAt,surface,paint,pickNearest};
});
