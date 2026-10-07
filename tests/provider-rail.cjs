const fs=require('fs'),vm=require('vm'),assert=require('assert');
const files=name=>fs.readFileSync(__dirname+'/../js/'+name,'utf8');

async function scenario(withRail){
 const window={};window.window=window;
 const ctx=vm.createContext({window,Object,Array,String,Number,Map,Set,Math,Date,Intl,Error});
 for(const f of [
  'core/gtfs.js','core/service-plan.js','core/expected-position.js','core/delay-position.js',
  'core/prediction.js','core/motion-state.js','core/transit-state-engine.js',
  'core/provider-scheduled.js','core/source-capabilities.js','core/transit-read-api.js'
 ])vm.runInContext(files(f),ctx);

 const now=Date.now()/1000;
 const serviceDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
 const p=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 const sec=(+p.hour)*3600+(+p.minute)*60+(+p.second);
 const snapshot={id:'r1',core:{file:'rail-core.json'},shapes:{file:'rail-shapes.json'},schedule:{file:'rail-schedule.json'}};
 const manifest={schema:1,networks:withRail?{rail:{core:snapshot.core,shapes:snapshot.shapes,schedule:snapshot.schedule,snapshots:[snapshot]}}:{}};
 const core={schema:1,network:'rail',agencies:[{id:'TI'}],routes:[{id:'R',short:'R',type:2}],stops:[
  {id:'M',name:'Venezia Mestre',lat:45.482,lon:12.231},{id:'S',name:'Venezia S. Lucia',lat:45.441,lon:12.322}
 ],trips:[{id:'T',routeId:'R',serviceId:'WK',directionId:'0',headsign:'Venezia S. Lucia',shapeId:'SH',blockId:''}],routeShapes:{R:['SH']}};
 const shapes={schema:1,network:'rail',shapes:{SH:[[45.482,12.231],[45.441,12.322]]}};
 const schedule={schema:2,network:'rail',timezone:'Europe/Rome',routes:[['R','R',2]],stops:[
  ['M','Venezia Mestre',45.482,12.231,''],['S','Venezia S. Lucia',45.441,12.322,'']
 ],days:[serviceDate],snapshotByDay:{[serviceDate]:'r1'},chunksData:{[serviceDate]:{schema:2,network:'rail',day:serviceDate,trips:[
  ['T','R','Venezia S. Lucia','SH',[['M',1,sec-60,sec-60,1,0],['S',2,sec+540,sec+540,1,1]]]
 ]}}};
 window.UVTransitProvider={
  loadRuntimeManifest:async()=>manifest,
  loadRuntimeCore:async()=>({data:core}),
  loadRuntimeShapes:async()=>({data:shapes}),
  loadRuntimeSchedule:async()=>({entry:manifest.networks.rail,snapshots:[snapshot],data:schedule})
 };
 window.UVTransitSourceRegistry=window.UVTransitCapabilities.createRegistry();
 vm.runInContext(files('provider-rail.js'),ctx);
 await window.UVTransitRail.bootstrapPromise;
 return window;
}

(async()=>{
 let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}
 const absent=await scenario(false);
 check('catalog is present even when rail feed is not provisioned',()=>{
  const x=absent.UVTransitSourceRegistry.get('rail:veneto-open-data');
  assert(x);assert.equal(x.kind,'catalog');assert.equal(x.supports('external_timetable'),true);
 });
 check('runtime rail source is not registered without manifest data',()=>{
  assert.equal(absent.UVTransitSourceRegistry.get('rail:veneto'),null);
  assert.equal(absent.UVTransitSourceReads?.['rail:veneto'],undefined);
 });
 const active=await scenario(true);
 check('rail source activates only when runtime manifest contains rail',()=>{
  const x=active.UVTransitSourceRegistry.get('rail:veneto');
  assert(x);assert.equal(x.kind,'source');assert.equal(x.supports('static_schedule'),true);
  assert.equal(x.supports('scheduled_simulation'),true);assert.equal(x.supports('canonical_state'),true);
 });
 check('rail source does not advertise realtime',()=>{
  const x=active.UVTransitSourceRegistry.get('rail:veneto');
  assert.equal(x.supports('realtime_vehicle_positions'),false);assert.equal(x.supports('realtime_trip_updates'),false);
 });
 const view=await active.UVTransitSourceReads['rail:veneto'].state.read('ignored',{now:Date.now()/1000});
 const trip=view.snapshot.tripStates.find(x=>x.tripId==='T');
 check('rail TransitRead emits scheduled simulation canonical state',()=>{
  assert(trip);assert.equal(trip.motionMode,'scheduled_simulation');assert.equal(trip.motion.position.source,'scheduled_simulation');
 });
 check('rail scheduled state never fabricates vehicle observations',()=>{
  assert.equal(view.snapshot.vehicleStates.length,0);assert.equal(view.snapshot.inputSummary.observations,0);
 });
 console.log('RESULT: '+n+' Veneto rail bootstrap checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
