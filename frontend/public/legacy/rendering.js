/** Isolated canvas renderer. No physics, command or networking ownership. */
(function(root){
  'use strict';
  root.OrbitalRenderer={
    create({ctx,WORLD,ENGINE,palette,NAV,getState,getViewport,toScreen,scale,clamp,getEphemerisTarget,getSelectedContact,getSystem}){
      const TWO_PI=Math.PI*2;
      let state,W,H,dpr,starfield,encounterReady;
  function pathWorld(points,stroke,lineWidth=1,dash=[]) {
    if(points.length<2)return;
    ctx.save();ctx.beginPath();const first=toScreen(points[0].x,points[0].y);ctx.moveTo(first.x,first.y);
    for(let i=1;i<points.length;i++){const p=toScreen(points[i].x,points[i].y);ctx.lineTo(p.x,p.y);}
    ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.setLineDash(dash);ctx.stroke();ctx.restore();
  }
  function drawBackground(){
    ctx.fillStyle='#06101b';ctx.fillRect(0,0,W,H);
    const g=ctx.createRadialGradient(W/2,H/2,20,W/2,H/2,Math.max(W,H)*.75);
    g.addColorStop(0,'#11283b');g.addColorStop(.5,'#0a1a2b');g.addColorStop(1,'#060e18');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    for(const star of starfield){ctx.fillStyle=`rgba(178,209,229,${star.alpha})`;ctx.fillRect(star.x,star.y,star.size,star.size);}
    ctx.save();ctx.lineWidth=1;
    const s=scale(),planetCenter=toScreen(0,0);
    const origin=state.systemView?getSystem().star(state.t):{x:0,y:0};
    const center=toScreen(origin.x,origin.y);
    // The map uses star-centered coordinates in system mode: Kestrel moves
    // around a fixed primary star and the orbit ring is drawn in that frame.
    if(state.systemView){
      const star=getSystem().star(state.t),focus=toScreen(star.x,star.y);
      const ring=getSystem().ORBIT_RADIUS_KM*s;
      if(ring<Math.max(W,H)*3){
        ctx.setLineDash([5,8]);ctx.lineWidth=1.5;ctx.strokeStyle='#4f759399';
        ctx.beginPath();ctx.arc(focus.x,focus.y,ring,0,TWO_PI);ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if(state.showAxes!==false){
      ctx.strokeStyle='#183149';ctx.setLineDash([3,7]);
      for(let r=150;r<=1050&&s>.025;r+=100){
        ctx.beginPath();ctx.ellipse(center.x,center.y,r*s,r*s,0,0,TWO_PI);ctx.stroke();
        if(r<=550){ctx.fillStyle='#54778e';ctx.font='10px monospace';ctx.fillText(r+'km',center.x+r*s+4,center.y-4);}
      }
      ctx.setLineDash([]);ctx.strokeStyle='#25445c';ctx.beginPath();
      ctx.moveTo(0,center.y);ctx.lineTo(W,center.y);
      ctx.moveTo(center.x,0);ctx.lineTo(center.x,H);ctx.stroke();
      ctx.fillStyle='#648ba5';ctx.font='10px ui-monospace,monospace';
    }
    ctx.restore();
    drawCentralBody(planetCenter.x,planetCenter.y,s);
    drawParentStar();
  }
  function drawParentStar(){
    const system=getSystem();
    if(!system)return;
    const sun=system.star(state.t);
    const p=toScreen(sun.x,sun.y),r=Math.max(5,system.STAR_RADIUS_KM*scale());
    if(p.x< -r*3||p.x>W+r*3||p.y< -r*3||p.y>H+r*3)return;
    ctx.save();
    const glow=ctx.createRadialGradient(p.x,p.y,r*.5,p.x,p.y,r*3);
    glow.addColorStop(0,'rgba(255,205,103,.68)');
    glow.addColorStop(.5,'rgba(255,169,58,.19)');
    glow.addColorStop(1,'rgba(255,130,55,0)');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(p.x,p.y,r*3,0,TWO_PI);ctx.fill();
    const core=ctx.createRadialGradient(p.x-r*.35,p.y-r*.32,r*.07,p.x,p.y,r);
    core.addColorStop(0,'#fff5c6');core.addColorStop(.48,'#ffdf7f');
    core.addColorStop(.82,'#ffa63f');core.addColorStop(1,'#d76532');
    ctx.fillStyle=core;ctx.beginPath();ctx.arc(p.x,p.y,r,0,TWO_PI);ctx.fill();
    ctx.strokeStyle='#fff0b388';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,TWO_PI);ctx.stroke();
    ctx.fillStyle='#ffe4a4';ctx.textAlign='center';
    ctx.font='bold 11px ui-monospace,monospace';
    ctx.fillText('VEYRA',p.x,p.y+r+19);
    ctx.textAlign='left';ctx.restore();
  }
  function drawCentralBody(x,y,s){
    const R=Math.max(state.systemView?3:0,WORLD.radius*s);
    ctx.save();
    let halo=ctx.createRadialGradient(x,y,R*.1,x,y,R*2.65);
    halo.addColorStop(0,'rgba(255,173,87,.35)');halo.addColorStop(.55,'rgba(250,142,64,.10)');halo.addColorStop(1,'rgba(250,142,64,0)');
    ctx.beginPath();ctx.arc(x,y,R*2.65,0,TWO_PI);ctx.fillStyle=halo;ctx.fill();
    ctx.beginPath();ctx.arc(x,y,WORLD.crashRadius*s,0,TWO_PI);ctx.strokeStyle='#ed765355';ctx.setLineDash([4,6]);ctx.lineWidth=1.4;ctx.stroke();ctx.setLineDash([]);
    const planet=ctx.createRadialGradient(x-R*.4,y-R*.35,R*.1,x,y,R*1.1);
    planet.addColorStop(0,'#f6c17a');planet.addColorStop(.32,'#cf8750');planet.addColorStop(.77,'#724d46');planet.addColorStop(1,'#2a2a3a');
    ctx.beginPath();ctx.arc(x,y,R,0,TWO_PI);ctx.fillStyle=planet;ctx.fill();ctx.strokeStyle='#d3a771';ctx.lineWidth=1;ctx.stroke();
    ctx.translate(x,y);ctx.rotate(-.35);
    for(let j=0;j<4;j++){ctx.beginPath();ctx.ellipse(0,R*(-.5+j*.33),R*.84,R*.075,.06*j,0,TWO_PI);ctx.strokeStyle=`rgba(61,35,43,${.13+.07*j})`;ctx.lineWidth=Math.max(1,R*.1);ctx.stroke();}
    ctx.restore();
    ctx.fillStyle='#dda96e';ctx.font='11px ui-monospace,monospace';ctx.textAlign='center';ctx.fillText('KESTREL',x,y+R+20);ctx.textAlign='left';
  }
  function drawTrails(){
    if(state.orbitVisible){pathWorld(state.predicted, state.dangerPrediction?'rgba(255,113,132,.72)':'rgba(98,217,246,.63)',1.7,[5,5]);}
    if(state.navPlan){pathWorld(state.navPlan.coastPath,'#67e0aa9a',2.1,[6,4]);const a=state.navPlan.arrival;if(a){const q=toScreen(a.x,a.y);ctx.strokeStyle=palette.green;ctx.beginPath();ctx.arc(q.x,q.y,11,0,TWO_PI);ctx.stroke();}}
    if(state.waypoint){const q=toScreen(state.waypoint.x,state.waypoint.y);ctx.strokeStyle=palette.yellow;ctx.lineWidth=2;ctx.strokeRect(q.x-8,q.y-8,16,16);}
    for(const e of [...state.enemies,state.ally,...(state.allies||[]),state.player])if(e.alive)pathWorld(e.trail,e.isPlayer?'#62d9f654':e.isAlly?'#67e0aa55':'#ff718433',1.5);
  }
  function drawShip(ship){
    if(!ship.alive)return;
    const p=toScreen(ship.x,ship.y),s=clamp(scale()*2.1,.8,1.85),a=ship.heading+Math.PI/2;
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(a);ctx.scale(s,s);
    if(ship.thrustVector){
      const burnAngle=ship.isPlayer?ship.gimbal:0;
      ctx.save();ctx.rotate(burnAngle);
      ctx.fillStyle=ship.isPlayer?'#72d9ef':'#ec956c';
      ctx.beginPath();ctx.moveTo(-5,10);ctx.lineTo(0,25+Math.sin(state.t*47)*4);ctx.lineTo(5,10);ctx.fill();ctx.restore();
    }
    if(ship.rcsFiring){ctx.fillStyle='#ffbc66';const sign=ship.rcsFiring;ctx.beginPath();ctx.moveTo(-sign*9,-8);ctx.lineTo(-sign*21,-4);ctx.lineTo(-sign*9,-1);ctx.fill();ctx.beginPath();ctx.moveTo(sign*9,7);ctx.lineTo(sign*21,12);ctx.lineTo(sign*9,14);ctx.fill();}
    ctx.fillStyle='#0a1f30';ctx.strokeStyle=ship.color;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(0,-13);ctx.lineTo(9,11);ctx.lineTo(0,6);ctx.lineTo(-9,11);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle=ship.color;ctx.beginPath();ctx.arc(0,1,2.5,0,TWO_PI);ctx.fill();
    if(ship.isPlayer){
      ctx.save();ctx.rotate(ship.gimbal);ctx.strokeStyle=palette.yellow;ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(0,8);ctx.lineTo(0,16);ctx.stroke();ctx.restore();
      ctx.save();ctx.strokeStyle='#80b3ce88';ctx.setLineDash([2,5]);ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,35,-Math.PI/2-ENGINE.gimbalMax,-Math.PI/2+ENGINE.gimbalMax);ctx.stroke();ctx.restore();
    }
    ctx.restore();
    if(!ship.isPlayer){ctx.font='10px system-ui';ctx.fillStyle=ship.color;ctx.fillText((ship.isAlly?'★ ':'')+ship.name,p.x+13,p.y-12);ctx.fillStyle='#254052';ctx.fillRect(p.x+13,p.y-7,48,3);ctx.fillStyle=ship.color;ctx.fillRect(p.x+13,p.y-7,48*(ship.hp/(ship.isAlly?80:66)),3);}
    if(ship.isPlayer){ctx.save();ctx.strokeStyle=palette.cyan;ctx.globalAlpha=.4;ctx.setLineDash([4,6]);ctx.beginPath();ctx.arc(p.x,p.y,22,0,TWO_PI);ctx.stroke();ctx.restore();}
  }
  function drawPickup(pod){const p=toScreen(pod.x,pod.y),s=clamp(scale(),.5,1.25),size=6*s+2;
    const color=pod.type==='fuel'?palette.green:pod.type==='ammo'?palette.purple:pod.type==='wreck'?palette.red:pod.type==='parts'?palette.cyan:palette.yellow;
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(state.t*.4+pod.phase);ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.fillStyle='#102334';ctx.beginPath();ctx.moveTo(0,-size);ctx.lineTo(size,0);ctx.lineTo(0,size);ctx.lineTo(-size,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=.24+.13*Math.sin(state.t*2+pod.phase);ctx.beginPath();ctx.arc(p.x,p.y,size+6,0,TWO_PI);ctx.stroke();ctx.restore();
    ctx.fillStyle=color;ctx.font='9px monospace';ctx.fillText(pod.type==='wreck'?'WRECK':pod.type.toUpperCase(),p.x+10,p.y+14);
  }
  function drawTether(){
    const line=state.captureTether;
    if(!line||!state.player.alive)return;
    const pod=state.pickups.find(p=>p.id===line.pickupId&&p.alive);
    if(!pod)return;
    const a=toScreen(state.player.x,state.player.y),b=toScreen(pod.x,pod.y);
    ctx.save();ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    ctx.strokeStyle=line.fatigueS>35?'#ff7184':'#edbe6b';ctx.lineWidth=2.1;
    ctx.setLineDash([5,3]);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#edbe6b';ctx.font='bold 10px ui-monospace,monospace';
    ctx.fillText(Math.round(line.tensionN||0)+' N TETHER',(a.x+b.x)/2+7,(a.y+b.y)/2-9);
    ctx.restore();
  }
  function drawShots(){for(const s of state.shots){const p=toScreen(s.x,s.y);if(p.x<-90||p.x>W+90||p.y<-90||p.y>H+90)continue;const tail=toScreen(s.x-s.vx*.035,s.y-s.vy*.035);ctx.strokeStyle=s.faction==='ally'?palette.green:s.faction==='player'?palette.cyan:palette.red;ctx.lineWidth=2.6;ctx.beginPath();ctx.moveTo(tail.x,tail.y);ctx.lineTo(p.x,p.y);ctx.stroke();}}
  function drawParticles(){for(const p of state.particles){const q=toScreen(p.x,p.y);ctx.globalAlpha=clamp(p.life/p.maxLife,0,1);ctx.fillStyle=p.color;ctx.fillRect(q.x,q.y,2.2,2.2);}ctx.globalAlpha=1;}
  function drawMeasurement(){
    const m=state.measurement;
    if(!m?.enabled||!m.start)return;
    const a=toScreen(m.start.x,m.start.y);
    const b=m.end||m.hover;
    ctx.save();
    ctx.strokeStyle='#c9a6f8';ctx.fillStyle='#dbc1ff';
    ctx.lineWidth=2;ctx.setLineDash([6,4]);
    if(b){
      const end=toScreen(b.x,b.y);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(end.x,end.y);ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(end.x,end.y,4,0,TWO_PI);ctx.fill();
      const km=Math.hypot(b.x-m.start.x,b.y-m.start.y);
      const label=km>=1?km.toLocaleString('en-US',{maximumFractionDigits:2})+' km':
        (km*1000).toFixed(1)+' m';
      ctx.fillStyle='#0c1b2fe8';ctx.fillRect((a.x+end.x)/2-42,(a.y+end.y)/2-22,Math.max(83,label.length*7+10),19);
      ctx.fillStyle='#dbc1ff';ctx.font='bold 11px monospace';
      ctx.fillText(label,(a.x+end.x)/2-37,(a.y+end.y)/2-8);
    }
    ctx.setLineDash([]);ctx.beginPath();ctx.arc(a.x,a.y,4,0,TWO_PI);ctx.fill();
    ctx.restore();
  }
  function drawAim(){
    const p=state.player,preview=state.ballistic;if(!p.alive||!preview)return;
    const bulletLine=preview.path.map(q=>({x:q.x,y:q.y}));
    pathWorld(bulletLine,'rgba(98,217,246,.92)',2.25,[6,3]);
    const end=preview.path[preview.path.length-1];
    if(end){
      const q=toScreen(end.x,end.y);
      ctx.save();ctx.strokeStyle=preview.status==='reachable'?palette.cyan:palette.yellow;
      ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(q.x,q.y,7,0,TWO_PI);ctx.stroke();
      ctx.fillStyle='#aeddea';ctx.font='bold 10px monospace';
      const label=preview.arrivalTime!==null?
        (state.predictive?preview.arrivalTime.toFixed(2)+'s':'ETA LOCKED'):
        preview.status==='planet'?'PLANET':'PREVIEW LIMIT';
      ctx.fillText(label,q.x+11,q.y-10);ctx.restore();
    }
    if(!state.trajectoryIntel||!preview.targetAtCursor)return;
    pathWorld(preview.targetPath,'rgba(189,158,250,.85)',2.15,[3,5]);
    const ghost=toScreen(preview.targetAtCursor.x,preview.targetAtCursor.y);
    ctx.save();ctx.strokeStyle=palette.purple;ctx.lineWidth=2;ctx.beginPath();ctx.arc(ghost.x,ghost.y,12,0,TWO_PI);
    ctx.moveTo(ghost.x-20,ghost.y);ctx.lineTo(ghost.x-7,ghost.y);
    ctx.moveTo(ghost.x+7,ghost.y);ctx.lineTo(ghost.x+20,ghost.y);
    ctx.moveTo(ghost.x,ghost.y-20);ctx.lineTo(ghost.x,ghost.y-7);
    ctx.moveTo(ghost.x,ghost.y+7);ctx.lineTo(ghost.x,ghost.y+20);ctx.stroke();
    const shot=toScreen(preview.bulletAtCursor.x,preview.bulletAtCursor.y);
    ctx.strokeStyle=preview.missKm<14?palette.green:palette.yellow;ctx.setLineDash([2,3]);
    ctx.beginPath();ctx.moveTo(shot.x,shot.y);ctx.lineTo(ghost.x,ghost.y);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle=palette.purple;ctx.font='bold 10px monospace';
    ctx.fillText('TARGET +'+preview.arrivalTime.toFixed(2)+'s',ghost.x+14,ghost.y-14);
    ctx.restore();
  }
  function drawEphemeris(){
    if(!state.ephemerisOwned||!state.ephemerisVisible)return;
    const target=getEphemerisTarget();
    if(!target?.alive||target.type==='star'||target.type==='planet')return;
    const now=performance.now();
    if(!state.ephemerisCache||state.ephemerisCache.key!==target.id||
       now-state.ephemerisCache.ms>500){
      const predicted=NAV.propagate(target,180,WORLD.mu,.7,WORLD.crashRadius,100000,true);
      const t60=NAV.propagate(target,60,WORLD.mu,1,WORLD.crashRadius,100000);
      const t120=NAV.propagate(target,120,WORLD.mu,1,WORLD.crashRadius,100000);
      state.ephemerisCache={key:target.id,ms:now,
        points:predicted.points||[],markers:[t60,t120]};
    }
    const path=state.ephemerisCache;
    if(path.points.length<2)return;
    pathWorld(path.points,'rgba(237,190,107,.82)',2,[7,5]);
    ctx.save();ctx.fillStyle='#edbe6b';ctx.font='bold 11px monospace';
    path.markers.forEach((m,i)=>{
      if(!m?.safe)return;
      const pixel=toScreen(m.x,m.y);
      ctx.beginPath();ctx.arc(pixel.x,pixel.y,4,0,TWO_PI);ctx.fill();
      ctx.fillText('T+'+(i+1)*60+'s',pixel.x+9,pixel.y-8);
    });
    ctx.restore();
  }
  function drawSelectedContact(){
    const selected=getSelectedContact?.();
    if(!selected||!Number.isFinite(selected.x)||!Number.isFinite(selected.y))return;
    const raw=toScreen(selected.x,selected.y),margin=38;
    const inside=raw.x>=margin&&raw.x<=W-margin&&raw.y>=margin&&raw.y<=H-margin;
    let cx=raw.x,cy=raw.y;
    if(!inside){
      // Point toward objects far beyond the camera, using the screen edge.
      const dx=raw.x-W/2,dy=raw.y-H/2;
      const factor=Math.min((W/2-margin)/Math.max(1e-9,Math.abs(dx)),
                            (H/2-margin)/Math.max(1e-9,Math.abs(dy)));
      cx=W/2+dx*factor;cy=H/2+dy*factor;
    }
    const stroke=selected.kind==='enemy'?palette.red:selected.kind==='ally'?palette.green:
      selected.kind==='salvage'||selected.kind==='star'?palette.yellow:palette.cyan;
    ctx.save();
    ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.shadowColor=stroke;ctx.shadowBlur=7;
    // Unique in-game reticle: circular sight, cross ticks and four corners.
    ctx.beginPath();ctx.arc(cx,cy,21,0,TWO_PI);
    ctx.moveTo(cx-29,cy);ctx.lineTo(cx-17,cy);
    ctx.moveTo(cx+17,cy);ctx.lineTo(cx+29,cy);
    ctx.moveTo(cx,cy-29);ctx.lineTo(cx,cy-17);
    ctx.moveTo(cx,cy+17);ctx.lineTo(cx,cy+29);
    for(const signX of [-1,1])for(const signY of [-1,1]){
      const x=cx+signX*34,y=cy+signY*34;
      ctx.moveTo(x-signX*12,y);ctx.lineTo(x,y);ctx.lineTo(x,y-signY*12);
    }
    ctx.stroke();ctx.shadowBlur=0;
    ctx.beginPath();ctx.arc(cx,cy,5,0,TWO_PI);ctx.stroke();
    if(!inside){
      const dir=Math.atan2(raw.y-H/2,raw.x-W/2);
      ctx.translate(cx,cy);ctx.rotate(dir);ctx.fillStyle=stroke;
      ctx.beginPath();ctx.moveTo(23,0);ctx.lineTo(10,-6);ctx.lineTo(10,6);
      ctx.closePath();ctx.fill();
      // Reset the arrow-local transform before positioning the text.
      ctx.rotate(-dir);ctx.translate(-cx,-cy);
    }
    const range=Math.hypot(selected.x-state.player.x,selected.y-state.player.y);
    const text=String(selected.label).slice(0,36)+' · '+range.toFixed(1)+' km'+(inside?'':' · OFFSCREEN');
    ctx.font='bold 10px ui-monospace,monospace';ctx.textAlign='left';
    const width=Math.min(W-16,ctx.measureText(text).width+18);
    const labelX=clamp(cx+39,8,Math.max(8,W-width-8));
    const labelY=clamp(cy-48,8,Math.max(8,H-25));
    ctx.fillStyle='rgba(5,20,34,.94)';ctx.fillRect(labelX,labelY,width,22);
    ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.strokeRect(labelX,labelY,width,22);
    ctx.fillStyle=stroke;ctx.fillText(text,labelX+8,labelY+15,Math.max(0,width-14));
    ctx.restore();
  }
  function draw(){
    if(!state)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);drawBackground();
    if(!encounterReady){
      ctx.fillStyle='#a6dbe8';ctx.font='bold 14px system-ui';ctx.textAlign='center';
      ctx.fillText('LOADING…',W/2,H/2);ctx.textAlign='left';
      return;
    }
    drawTrails();drawTether();
    for(const pod of state.pickups)drawPickup(pod);
    drawShots();for(const e of state.enemies)drawShip(e);drawShip(state.ally);
    for(const ally of state.allies||[])drawShip(ally);
    drawShip(state.player);
    drawEphemeris();drawAim();drawParticles();drawMeasurement();drawSelectedContact();
  }

      return {draw(){
        state=getState();
        ({W,H,dpr,starfield,encounterReady}=getViewport());
        draw();
      }};
    }
  };
})(window);
