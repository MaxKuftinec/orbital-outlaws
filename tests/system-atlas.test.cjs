const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const ctx={module:{exports:{}}};
vm.runInNewContext(read('frontend/public/legacy/star-system.js'),ctx);
const star=ctx.module.exports;
const atlas=read('frontend/src/components/SystemAtlas.vue');
const data=read('frontend/src/data/systemAtlas.ts');
const app=read('frontend/src/App.vue');
const css=read('frontend/src/system-atlas.css');

test('Veyra is a physically coherent K dwarf and both planned orbits use AU distances',()=>{
  assert.equal(star.STAR_MASS_SOLAR,.82);
  assert.equal(star.STAR_RADIUS_SOLAR,.78);
  assert.equal(star.STAR_LUMINOSITY_SOLAR,.40);
  assert.ok(star.STAR_EFFECTIVE_TEMPERATURE_K>5000&&star.STAR_EFFECTIVE_TEMPERATURE_K<5300);
  assert.ok(star.STAR_RADIUS_KM>500000);
  assert.ok(Math.abs(star.ORBIT_RADIUS_KM/star.AU_KM-.4)<1e-12);
  assert.ok(Math.abs(star.NERIS_ORBIT_KM/star.AU_KM-.65)<1e-12);
  assert.ok(Math.abs(star.PERIOD_S/86400-102.04)<.05);
  assert.ok(Math.abs(star.NERIS_PERIOD_S/86400-211.38)<.05);
  assert.ok(star.HILL_RADIUS_KM>500000);
});
test('Atlas is a separate navigable page while cockpit DOM remains mounted for live flight',()=>{
  assert.match(app,/import SystemAtlas from '.\/components\/SystemAtlas.vue'/);
  assert.match(app,/v-show="view==='atlas'"/);
  assert.match(app,/v-show="view==='cockpit'"/);
  assert.match(app,/window\.location\.hash === '#\/atlas'/);
  assert.match(app,/window\.addEventListener\('hashchange'/);
  assert.match(app,/id="open-atlas-btn"/);
  assert.match(app,/@back="openCockpit" @inspect="inspectBody"/);
  assert.match(app,/detail:\{key:id==='veyra'\?'star':'planet'\}/);
  assert.match(app,/VERSION 1\.1/);
});
test('Atlas contains accessible map interaction, separate star/planet cards, guides and culture roadmap',()=>{
  for(const text of [
    'Beyond one world.', 'A system in motion','Celestial dossiers',
    'objects, fieldGuides','atlas-orbital-svg', 'atlas-object-card',
    'atlas-object-facts','atlas-science-details','atlas-time-offset',
    'NAVIGATIONAL SURVEY','The frontier','FIELD HANDBOOK',
    'v2.0 MAJOR MILESTONE','@keydown.enter.prevent',
    'role="button" tabindex="0"'
  ])assert.ok(atlas.includes(text),'Atlas missing '+text);
  assert.match(atlas,/selectedObject\.status === 'Simulated'/);
  assert.match(atlas,/Neris is not yet simulated/);
});
test('Atlas source explicitly distinguishes Neris proposal from simulated star and planet',()=>{
  assert.match(data,/id:'neris'.*status:'Concept'/s);
  assert.match(data,/id: 'veyra'.*status: 'Simulated'/s);
  assert.match(data,/id: 'kestrel'.*status:'Simulated'/s);
  assert.match(data,/the encounter currently uses an 85 km collision radius/i);
  assert.match(data,/gravitational parameter/);
  assert.match(data,/insolationEarth/);
  assert.match(data,/orbitalDays/);
});
test('Atlas stylesheet is responsive and respects reduced-motion preferences',()=>{
  assert.match(css,/@media\(max-width:900px\)/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/atlas-object-grid/);
  assert.match(css,/atlas-sun/);
  assert.match(css,/atlas-hero-art/);
});
