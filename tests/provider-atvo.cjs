const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=__dirname+'/../js/';
const read=p=>fs.readFileSync(root+p,'utf8');

async function make(withAtvo){
 const window={};window.window=window;
 const ctx=vm.createContext({window,Object,Array,String,Number,Map,Set,Math,Date,Intl,Error});
 for(const f of [
  'core/gtfs.js','core/service-plan.js','core/expected-position.js','core/delay-position.js',
  'core/prediction.js','core/motion-state.js','core/transit-state-engine.js',
  'core/provider-scheduled.js','core/source-capabilities.js','core/transit-read-api.js'
 ])vm.runInContext(read(f),ctx);

 const snapshot={id:'a1',core:{file:'atvo-core.json'},shapes:{file:'atvo-shapes.json'},schedule:{file:'atvo-schedule.json'}};
 const manifest={schema:1,networks:withAtvo?{atvo:{core:snapshot.core,shapes:snapshot.shapes,schedule:snapshot.schedule,snapshots:[snapshot]}}:{}};
 const now=Date.now()/1000;
 const serviceDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
 const timeParts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 const sec=(+timeParts.hour)*3600+(+timeParts.minute)*60+(+timeParts.second);
 const core={schema:1,network:'atvo',agencies:[{id:'ATVO'}],routes:[{id:'351',short:'351',type:3}],stops:[
  {id:'TSF',name:'Treviso Airport',lat:45.6508,lon:12.1978},{id:'MESTRE',name:'Venezia Mestre',lat:45.4824,lon:12.2320}
 ],trips:[{id:'A1',routeId:'351',serviceId:'D',directionId:'0',headsign:'Venezia Mestre',shapeId:'S',blockId:''}],routeShapes:{351:['S']}};
 const shapes={schema:1,network:'atvo',shapes:{S:[[45.6508,12.1978],[45.4824,12.2320]]}};
 const schedule={schema:2,network:'atvo',timezone:'Europe/Rome',routes:[['351','351',3]],stops:[['TSF','Treviso Airport',45.6508,12.1978,''],['MESTRE','Venezia Mestre',45.4824,12.2320,'']],days:[serviceDate],snapshotByDay:{[serviceDate]:'a1'},chunksData:{[serviceDate]:{schema:2,network:'atvo',day:serviceDate,trips:[
  ['A1','351','Venezia Mestre','S',[['TSF',1,sec-60,sec-60,1,0],['MESTRE',2,sec+1800,sec+1800,1,1]]]
 ]}}};
 window.UVTransitProvider={
  loadRuntimeManifest:async()=>manifest,
  loadRuntimeCore:async()=>({data:core}),
  loadRuntimeShapes:async()=>({data:shapes}),
  loadRuntimeSchedule:async()=>({entry:manifest.networks.atvo,snapshots:[snapshot],data:schedule})
 };
 window.UVTransitSourceRegistry=window.UVTransitCapabilities.createRegistry();
 vm.runInContext(read('provider-atvo.js'),ctx);
 await window.UVTransitATVO.bootstrapPromise;
 return window;
}

(async()=>{
 let n=0;const check=(name,fn)=>{fn();n++;console.log('PASS '+name)};
 const absent=await make(false);
 check('ATVO source stays absent without built runtime network',()=>assert.equal(absent.UVTransitSourceRegistry.get('atvo:schedule'),null));
 const active=await make(true);
 const src=active.UVTransitSourceRegistry.get('atvo:schedule');
 check('ATVO source activates from runtime manifest',()=>{assert(src);assert.equal(src.supports('static_schedule'),true);assert.equal(src.supports('scheduled_simulation'),true)});
 check('ATVO source remains schedule-only',()=>{assert.equal(src.supports('realtime_vehicle_positions'),false);assert.equal(src.supports('realtime_trip_updates'),false)});
 const state=await active.UVTransitSourceReads['atvo:schedule'].state.read('ignored',{now:Date.now()/1000});
 check('ATVO canonical state is scheduled simulation',()=>{const t=state.snapshot.tripStates.find(x=>x.tripId==='A1');assert(t);assert.equal(t.motionMode,'scheduled_simulation')});
 console.log('RESULT: '+n+' ATVO structured-source bootstrap checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
