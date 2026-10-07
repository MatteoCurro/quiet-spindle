const fs=require('fs'),vm=require('vm'),assert=require('assert');
const payloads={},calls=[];
const tuFeed={header:{gtfsRealtimeVersion:'2.0',timestamp:1780207500},entity:[
  {id:'tu',tripUpdate:{trip:{tripId:'AUT_ACTV_786_777',routeId:'1_UM',startDate:'20260930'},vehicle:{id:'BUS-7'},timestamp:1780207500}}
]};
const vpFeed={header:{gtfsRealtimeVersion:'2.0',timestamp:1780207560},entity:[
  {id:'vp',vehicle:{trip:{},vehicle:{id:'BUS-7'},position:{latitude:45.005,longitude:12},timestamp:1780207560}}
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
for(const file of ['gtfs.js','observations.js','observation-history.js','service-date-resolver.js','service-plan.js','expected-position.js','vehicle-continuity.js','identity-resolver.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/provider-actv.js','utf8'),ctx);

const snap={id:'snap',sourceZipSha256:'hash',core:{file:'core.json'},shapes:{file:'shapes.json'},schedule:{file:'schedule.json'},serviceDates:['20260930']};
const manifest={schema:1,networks:{aut:{core:snap.core,shapes:snap.shapes,schedule:snap.schedule,snapshots:[snap]}}};
payloads['https://example.test/trasporti/runtime-data/core.json']={
  schema:1,network:'aut',agencies:[],routeShapes:{},
  routes:[{id:'R1',short:'1',long:'Linea 1',desc:'UM',type:3}],
  stops:[{id:'A',name:'A',lat:45,lon:12},{id:'B',name:'B',lat:45.01,lon:12}],
  trips:[{id:'AUT_ACTV_787_777',routeId:'R1',directionId:'0',headsign:'B',shapeId:'S1',blockId:''}]
};
payloads['https://example.test/trasporti/runtime-data/shapes.json']={schema:1,network:'aut',shapes:{S1:[[45,12],[45.01,12]]}};
payloads['https://example.test/trasporti/runtime-data/schedule.json']={
  schema:2,network:'aut',timezone:'Europe/Rome',days:['20260930'],
  routes:[['R1','1',3]],stops:[['A','A',45,12,''],['B','B',45.01,12,'']],
  transfers:[],transferRules:[],chunks:{'20260930':{file:'day.json',trips:1}}
};
payloads['https://example.test/trasporti/runtime-data/day.json']={
  schema:2,network:'aut',day:'20260930',
  trips:[['AUT_ACTV_787_777','R1','B','S1',[['A',1,28800,28800,1,0],['B',2,30000,30000,1,1]]]]
};

(async()=>{
  const P=window.UVTransitProvider;
  assert.deepEqual([...P._test.actvTripKeys('AUT_ACTV_786_777')],['AUT_ACTV_786_777','777']);
  assert.deepEqual([...P._test.actvTripKeys('AUT_ACTV_787_777')],['AUT_ACTV_787_777','777']);

  const out=await P.resolveObservations('aut',manifest,['20260930']);
  const tu=out.resolutions.find(x=>x.observationId.includes(':trip_update:tu:'));
  const vp=out.resolutions.find(x=>x.observationId.includes(':vehicle_position:vp:'));
  assert(tu);assert(vp);
  assert.equal(tu.classification,'trip_matched');
  assert(tu.tripInstanceId.endsWith(':20260930:AUT_ACTV_787_777'));
  assert.equal(vp.classification,'vehicle_correlated');
  assert.equal(vp.tripInstanceId,tu.tripInstanceId);
  assert.equal(out.stats.matched,2);
  assert.equal(out.stats.classes.trip_matched,1);
  assert.equal(out.stats.classes.vehicle_correlated,1);
  assert.equal(calls.filter(x=>x.includes('feed=tripUpdates')).length,1);
  assert.equal(calls.filter(x=>x.includes('feed=vehiclePositions')).length,1);

  const again=await P.loadIdentityResolver('aut',manifest,['20260930']);
  assert.strictEqual(again.identityResolver,out.identityResolver);
  assert(again.vehicleContinuity);assert.strictEqual(again.vehicleContinuity,P.loadVehicleContinuity('aut'));
  console.log('RESULT: 14 ACTV Identity Resolver + continuity integration checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
