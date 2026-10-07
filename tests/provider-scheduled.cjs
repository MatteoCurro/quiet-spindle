const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Object,Array,String,Number,Map,Set,Math,Date,Intl,Error});
for(const file of [
 'gtfs.js','service-plan.js','expected-position.js','delay-position.js',
 'prediction.js','motion-state.js','transit-state-engine.js','provider-scheduled.js'
])vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);

const now=Date.now()/1000;
const serviceDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'})
 .format(new Date(now*1000)).replaceAll('-','');
const base=new Date(new Date().toLocaleString('en-US',{timeZone:'Europe/Rome'}));
const sec=base.getHours()*3600+base.getMinutes()*60+base.getSeconds();
const core={schema:1,network:'rail',agencies:[{id:'TI'}],routes:[{id:'R',short:'R',type:2}],stops:[
 {id:'MESTRE',name:'Venezia Mestre',lat:45.482,lon:12.231},
 {id:'SL',name:'Venezia Santa Lucia',lat:45.441,lon:12.322}
],trips:[{id:'TR1',routeId:'R',serviceId:'WK',directionId:'0',headsign:'Venezia S. Lucia',shapeId:'S',blockId:''}],routeShapes:{R:['S']}};
const shape={schema:1,network:'rail',shapes:{S:[[45.482,12.231],[45.46,12.27],[45.441,12.322]]}};
const snapshot={id:'snap',core:{file:'c'},shapes:{file:'s'},schedule:{file:'sched'}};
const schedule={schema:2,network:'rail',timezone:'Europe/Rome',routes:[['R','R',2]],stops:[
 ['MESTRE','Venezia Mestre',45.482,12.231,''],['SL','Venezia Santa Lucia',45.441,12.322,'']
],days:[serviceDate],snapshotByDay:{[serviceDate]:'snap'},chunksData:{[serviceDate]:{schema:2,network:'rail',day:serviceDate,trips:[
 ['TR1','R','Venezia S. Lucia','S',[['MESTRE',1,sec-120,sec-120,1,0],['SL',2,sec+480,sec+480,1,1]]]
]}}};
const manifest={schema:1,networks:{rail:{core:snapshot.core,shapes:snapshot.shapes,schedule:snapshot.schedule,snapshots:[snapshot]}}};
const calls=[];
const runtime={
 loadRuntimeManifest:async()=>manifest,
 loadRuntimeCore:async(n,m,s)=>{calls.push(['core',n]);return {manifest:m,entry:m.networks[n],snapshot:s,data:core}},
 loadRuntimeShapes:async(n,m,s)=>{calls.push(['shapes',n]);return {manifest:m,entry:m.networks[n],snapshot:s,data:shape}},
 loadRuntimeSchedule:async(n,m)=>{calls.push(['schedule',n]);return {entry:m.networks[n],snapshots:[snapshot],data:schedule}}
};
const P=window.UVTransitScheduledProvider.createScheduledProvider({providerId:'rail-open-data',network:'rail',runtimeDelegate:runtime});
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}

(async()=>{
 const out=await P.loadTransitState('ignored',manifest,null,now);
 check('scheduled provider emits canonical snapshot',()=>assert(out.snapshot));
 check('provider and network are source-specific',()=>{assert.equal(out.snapshot.provider,'rail-open-data');assert.equal(out.snapshot.network,'rail')});
 check('no realtime observations are fabricated',()=>{assert.equal(out.observations.length,0);assert.equal(out.resolutions.length,0);assert.equal(out.scheduleOnly,true)});
 const active=out.snapshot.tripStates.find(x=>x.tripId==='TR1');
 check('active rail trip gets scheduled simulation motion',()=>{assert(active);assert.equal(active.motionMode,'scheduled_simulation');assert.equal(active.motion.position.source,'scheduled_simulation')});
 check('scheduled position is derived from shape and timetable',()=>assert(active.motion.position.value&&Number.isFinite(active.motion.position.value.lat)));
 check('scheduled provider binds every runtime read to rail network',()=>assert(calls.every(x=>x[1]==='rail')));
 check('snapshot contains no vehicles without realtime evidence',()=>assert.equal(out.snapshot.vehicleStates.length,0));
 const service=await P.loadServicePlan();
 check('service plan remains provider-neutral',()=>assert.equal(service.plan.provider,'rail-open-data'));
 console.log('RESULT: '+n+' generic scheduled provider checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
