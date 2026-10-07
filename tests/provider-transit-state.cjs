const fs=require('fs'),vm=require('vm'),assert=require('assert');
const payloads={},calls=[];
const now=Date.parse('2026-09-30T08:05:00+02:00')/1000;
const tuFeed={header:{gtfsRealtimeVersion:'2.0',timestamp:now-20},entity:[
  {id:'tu',tripUpdate:{trip:{tripId:'AUT_ACTV_786_777',routeId:'1_UM',startDate:'20260930'},vehicle:{id:'BUS-7'},timestamp:now-20,delay:90}}
]};
const vpFeed={header:{gtfsRealtimeVersion:'2.0',timestamp:now-10},entity:[
  {id:'vp',vehicle:{trip:{},vehicle:{id:'BUS-7'},position:{latitude:45.005,longitude:12},timestamp:now-10}}
]};
async function fetch(url){
  url=String(url);calls.push(url);
  if(url.includes('feed=tripUpdates'))return {ok:true,status:200,arrayBuffer:async()=>Uint8Array.from([1]).buffer};
  if(url.includes('feed=vehiclePositions'))return {ok:true,status:200,arrayBuffer:async()=>Uint8Array.from([2]).buffer};
  const data=payloads[url];return {ok:!!data,status:data?200:404,json:async()=>data,arrayBuffer:async()=>new ArrayBuffer(0),blob:async()=>({})};
}
const window={};window.window=window;
window.UVTransitGTFSRT={decodeFeed:(buf)=>new Uint8Array(buf)[0]===1?tuFeed:vpFeed};
const ctx=vm.createContext({window,document:{baseURI:'https://example.test/trasporti/'},URL,fetch,WebSocket:function(){},Intl,Date,Map,Set,Object,Array,Number,String,Error,Math,encodeURIComponent});
for(const file of ['gtfs.js','observations.js','observation-history.js','service-date-resolver.js','service-plan.js','expected-position.js','identity-resolver.js','vehicle-registry.js','vehicle-continuity.js','delay-position.js','prediction.js','motion-state.js','transit-state-engine.js','prediction-accuracy.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/provider-actv.js','utf8'),ctx);

const snap={id:'snap',sourceZipSha256:'hash',core:{file:'core.json'},shapes:{file:'shapes.json'},schedule:{file:'schedule.json'},serviceDates:['20260930']};
const manifest={schema:1,networks:{aut:{core:snap.core,shapes:snap.shapes,schedule:snap.schedule,snapshots:[snap]}}};
payloads['https://example.test/trasporti/runtime-data/core.json']={
  schema:1,network:'aut',agencies:[],routeShapes:{},
  routes:[{id:'R1',short:'1',long:'Linea 1',desc:'UM',type:3}],
  stops:[{id:'A',name:'A',lat:45,lon:12},{id:'B',name:'B',lat:45.01,lon:12}],
  trips:[
    {id:'AUT_ACTV_787_777',routeId:'R1',directionId:'0',headsign:'B',shapeId:'S1',blockId:''},
    {id:'T-MISSING',routeId:'R1',directionId:'0',headsign:'B',shapeId:'S1',blockId:''},
    {id:'T-FUTURE',routeId:'R1',directionId:'0',headsign:'B',shapeId:'S1',blockId:''}
  ]
};
payloads['https://example.test/trasporti/runtime-data/shapes.json']={schema:1,network:'aut',shapes:{S1:[[45,12],[45.01,12]]}};
payloads['https://example.test/trasporti/runtime-data/schedule.json']={
  schema:2,network:'aut',timezone:'Europe/Rome',days:['20260930'],
  routes:[['R1','1',3]],stops:[['A','A',45,12,''],['B','B',45.01,12,'']],
  transfers:[],transferRules:[],chunks:{'20260930':{file:'day.json',trips:3}}
};
payloads['https://example.test/trasporti/runtime-data/day.json']={
  schema:2,network:'aut',day:'20260930',
  trips:[
    ['AUT_ACTV_787_777','R1','B','S1',[['A',1,28800,28800,1,0],['B',2,32400,32400,1,1]]],
    ['T-MISSING','R1','B','S1',[['A',1,28800,28800,1,0],['B',2,32400,32400,1,1]]],
    ['T-FUTURE','R1','B','S1',[['A',1,32400,32400,1,0],['B',2,36000,36000,1,1]]]
  ]
};

(async()=>{
  const P=window.UVTransitProvider;
  const out=await P.loadTransitState('aut',manifest,['20260930'],now);
  const observed=out.snapshot.trip('actv-official:aut:20260930:AUT_ACTV_787_777');
  const missing=out.snapshot.trip('actv-official:aut:20260930:T-MISSING');
  const future=out.snapshot.trip('actv-official:aut:20260930:T-FUTURE');

  assert(observed);assert.equal(observed.status,'observed');assert(observed.expectedState);
  assert(observed.motion);assert.equal(observed.motion.mode,'live');
  assert.equal(observed.delay.source,'official_realtime');assert.equal(observed.delay.value,90);
  assert.equal(observed.position.source,'official_realtime_position');assert(observed.position.value);
  assert(missing);assert.equal(missing.status,'expected_unobserved');
  assert(future);assert.equal(future.status,'scheduled');

  const bus=out.snapshot.vehicle('BUS-7');
  assert(bus);assert.equal(bus.status,'matched');assert.equal(bus.tripInstanceId,observed.tripInstanceId);
  assert(out.vehicleRegistry);assert.strictEqual(out.vehicleRegistry,out.snapshot.vehicleRegistrySnapshot);
  assert.equal(out.vehicleRegistry.vehicle('BUS-7').status,'matched');
  assert(out.vehicleContinuity);assert.strictEqual(out.vehicleContinuity,out.snapshot.vehicleContinuitySnapshot);
  assert.equal(out.vehicleContinuity.vehicle('BUS-7').presentInLatestFeed,true);
  assert.equal(out.vehicleContinuity.vehicle('BUS-7').lastMatchedTripInstanceId,observed.tripInstanceId);
  assert.equal(out.stats.trips.observed,1);assert.equal(out.stats.trips.expected_unobserved,1);
  assert.equal(out.stats.trips.scheduled,1);assert.equal(out.stats.vehicles.matched,1);
  assert(out.predictionAccuracy);assert.equal(out.predictionAccuracySummary.forecastsRecorded,0);
  assert.strictEqual(P.loadPredictionAccuracyEngine('aut').snapshot().summary().forecastsRecorded,0);
  assert.equal(calls.filter(x=>x.includes('feed=tripUpdates')).length,1);
  assert.equal(calls.filter(x=>x.includes('feed=vehiclePositions')).length,1);

  const beforePeek=calls.filter(x=>x.includes('feed=')).length;
  const cached=await P._test.peekTransitState('aut',manifest,['20260930'],now+5,20000);
  assert(cached&&cached.cacheOnly===true);
  assert(cached.snapshot.trip('actv-official:aut:20260930:AUT_ACTV_787_777'));
  assert.equal(calls.filter(x=>x.includes('feed=')).length,beforePeek,'cache-only TransitState must not fetch ACTV realtime');

  const core=await P.loadTransitStateEngine('aut',manifest,['20260930']);
  assert.strictEqual(core.transitStateEngine,out.transitStateEngine);
  console.log('RESULT: 26 ACTV TransitStateEngine + PredictionAccuracy integration checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
