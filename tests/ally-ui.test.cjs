const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const game=fs.readFileSync(path.join(root,'frontend/public/legacy/game.js'),'utf8');
const renderer=fs.readFileSync(path.join(root,'frontend/public/legacy/rendering.js'),'utf8');
const app=fs.readFileSync(path.join(root,'frontend/src/App.vue'),'utf8');
const css=fs.readFileSync(path.join(root,'frontend/src/cockpit.css'),'utf8');
const vue=fs.readFileSync(path.join(root,'frontend/src/components/NavigationPanel.vue'),'utf8');
const persistence=fs.readFileSync(path.join(root,'frontend/public/legacy/persistence.js'),'utf8');
function functionRange(name,next){
  const start=game.indexOf('  function '+name+'('),end=game.indexOf('  function '+next+'(',start);
  assert.ok(start>=0 && end>start,'missing '+name+' / '+next);
  return game.slice(start,end);
}
test('rendezvous receives dedicated ability art instead of predictive fire art',()=>{
  assert.match(css,/\.tech-icon\.tech-icon--nav\{/);
  assert.match(css,/background-image:url\('\/tech\/rendezvous-monitor\.webp'\)/);
  assert.doesNotMatch(css,/\.tech-icon\.tech-icon--rendezvous\{/);
});
test('ephemeris control shows and hides selected contact trajectory independently',()=>{
  assert.match(app,/id="ephemeris-visibility-btn"/);
  assert.match(game,/state\.ephemerisVisible=!state\.ephemerisVisible/);
  assert.match(renderer,/if\(!state\.ephemerisOwned\|\|!state\.ephemerisVisible\)return;/);
  assert.match(game,/getEphemerisTarget:\(\)=>navTarget\(state\.selectedNavKey\)/);
});
test('newly spawned allies are valid selectable navigation and ephemeris targets',()=>{
  const targets=functionRange('navKeyExists','navTarget');
  const state={ally:{alive:true},allies:[{id:'ally-02',alive:true},{id:'ally-03',alive:false}],pickups:[],enemies:[]};
  const context={state};
  vm.runInNewContext(targets,context);
  assert.equal(context.navKeyExists('ally'),true);
  assert.equal(context.navKeyExists('ally:ally-02'),true);
  assert.equal(context.navKeyExists('ally:ally-03'),false);
  const navOptions=functionRange('updateTargetOptions','cycleNavigationTarget');
  const notifications=[];
  const select={value:'',dataset:{vueManaged:'true'}};
  Object.assign(context,{
    $:()=>select,window:{dispatchEvent:e=>notifications.push(e.detail)},
    CustomEvent:class{constructor(_name,opts){this.detail=opts.detail}},
    navTarget:key=>key==='ally:ally-02'?state.allies[0]:null
  });
  state.player={alive:true};
  state.ally={alive:true,name:'AEGIS-01'};
  state.selectedNavKey='';state.ephemerisCache=null;state.waypoint=null;
  vm.runInNewContext(navOptions,context);
  context.updateTargetOptions('ally:ally-02');
  assert.equal(state.selectedNavKey,'ally:ally-02');
  assert.equal(notifications.at(-1).selected,'ally:ally-02');
  assert.ok(notifications.at(-1).options.some(x=>x.key==='ally:ally-02'));
});
test('Vue-selected ally routes both donation and rescue through the live server',()=>{
  assert.match(vue,/orbital-target-selected/);
  assert.match(vue,/orbital-request-ally-assistance/);
  assert.match(game,/function requestSelectedAllyAssistance\(/);
  assert.match(game,/pilotLink\?\.requestAssistance\(recipient\.id\)/);
  assert.match(game,/pilotLink\?\.offerFuel\(ally\.id,20\)/);
  assert.match(game,/allyRange<=18&&allyRelative<2\.5/);
  assert.match(persistence,/else if\(data\.type==='assistance'\)onAssistance\?\.\(data\.result\)/);
  assert.match(vue,/:disabled="navigation\.donateDisabled"/);
  assert.match(vue,/:disabled="navigation\.requestAllyDisabled"/);
});
