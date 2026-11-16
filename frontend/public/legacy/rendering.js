/** Isolated canvas renderer. No physics, command or networking ownership. */
(function(root){
  'use strict';
  root.OrbitalRenderer={
    create({ctx,WORLD,ENGINE,palette,NAV,getState,getViewport,toScreen,scale,clamp,getEphemerisTarget}){
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
    ctx.save();ctx.lineWidth=1;const center=toScreen(0,0);const s=scale();
    ctx.strokeStyle='#183149';ctx.setLineDash([3,7]);
    for(let r=150;r<=1050;r+=100){ctx.beginPath();ctx.ellipse(center.x,center.y,r*s,r*s,0,0,TWO_PI);ctx.stroke();
      if(r<=550){ctx.fillStyle='#54778e';ctx.font='10px monospace';ctx.fillText(r+'km',center.x+r*s+4,center.y-4);}}
    ctx.setLineDash([]);ctx.strokeStyle='#25445c';ctx.beginPath();ctx.moveTo(0,center.y);ctx.lineTo(W,center.y);ctx.moveTo(center.x,0);ctx.lineTo(center.x,H);ctx.stroke();ctx.restore();
    drawCentralBody(center.x,center.y,s);
  }
  function drawCentralBody(x,y,s){
    const R=WORLD.radius*s;
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
  function drawShots(){for(const s of state.shots){const p=toScreen(s.x,s.y);if(p.x<-90||p.x>W+90||p.y<-90||p.y>H+90)continue;const tail=toScreen(s.x-s.vx*.035,s.y-s.vy*.035);ctx.strokeStyle=s.faction==='ally'?palette.green:s.faction==='player'?palette.cyan:palette.red;ctx.lineWidth=2.6;ctx.beginPath();ctx.moveTo(tail.x,tail.y);ctx.lineTo(p.x,p.y);ctx.stroke();}}
  function drawParticles(){for(const p of state.particles){const q=toScreen(p.x,p.y);ctx.globalAlpha=clamp(p.life/p.maxLife,0,1);ctx.fillStyle=p.color;ctx.fillRect(q.x,q.y,2.2,2.2);}ctx.globalAlpha=1;}
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
      const label=preview.arrivalTime!==null?preview.arrivalTime.toFixed(2)+'s':preview.status==='planet'?'PLANET':'PREVIEW LIMIT';
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
    if(!state.ephemerisOwned)return;
    const target=getEphemerisTarget();
    if(!target?.alive)return;
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
  function draw(){
    if(!state)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);drawBackground();
    if(!encounterReady){
      ctx.fillStyle='#a6dbe8';ctx.font='bold 14px system-ui';ctx.textAlign='center';
      ctx.fillText('RESTORING PERSISTENT SECTOR…',W/2,H/2);ctx.textAlign='left';
      return;
    }
    drawTrails();
    for(const pod of state.pickups)drawPickup(pod);
    drawShots();for(const e of state.enemies)drawShip(e);drawShip(state.ally);
    for(const ally of state.allies||[])drawShip(ally);
    drawShip(state.player);
    drawEphemeris();drawAim();drawParticles();
  }

      return {draw(){
        state=getState();
        ({W,H,dpr,starfield,encounterReady}=getViewport());
        draw();
      }};
    }
  };
})(window);
