const fs=require('fs'),vm=require('vm'),assert=require('assert');
const payloads={},calls=[];
const now=Date.parse('2026-09-30T08:20:00+02:00')/1000;
const tuFeed={header:{gtfsRealtimeVersion:'2.0',timestamp:now-10},entity:[
  {id:'tu',tripUpdate:{trip:{tripId:'AUT_ACTV_786_777',routeId:'1_UM',startDate:'20260930'},vehicle:{id:'BUS-7'},timestamp:now-10}}
]};
const vpFeed={header:{gtfsRealtimeVersion:'2.0',timestamp:now-8},entity:[
  {id:'vp',vehicle:{trip:{tripId:'AUT_ACTV_786_777',routeId:'1_UM',startDate:'20260930'},vehicle:{id:'BUS-7'},position:{latitude:45.005,longitude:12,bearing:0,speed:8},timestamp:now-8}}
]};
async function fetch(url){
  url=String(url);calls.push(url);
  if(url.includes('feed=tripUpdates'))return {ok:true,status:200,arrayBuffer:async()=>Uint8Array.from([1]).buffer};
  if(url.includes('feed=vehiclePositions'))return {ok:true,status:200,arrayBuffer:async()=>Uint8Array.from([2]).buffer};
  const data=payloads[url];
  return {ok:!!data,status:data?200:404,json:async()=>data,arrayBuffer:async()=>new ArrayBuffer(0),blob:async()=>({})};
}
const window={};window.window=window;
window.UVTransitGTFSRT={decodeFeed:(buf)=>new Uint8Array(buf)[0]===1?tuFeed:vpFeed};
const ctx=vm.createContext({window,document:{baseURI:'https://example.test/trasporti/'},URL,fetch,WebSocket:function(){},Intl,Date,Map,Set,Object,Array,Number,String,Error,Math,encodeURIComponent});
for(const file of ['gtfs.js','observations.js','observation-history.js','service-date-resolver.js','service-plan.js','expected-position.js','identity-resolver.js','delay-position.js','prediction.js','motion-state.js','transit-state-engine.js','derived-event-engine.js'])
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
    {id:'T2',routeId:'R1',directionId:'0',headsign:'B',shapeId:'S1',blockId:''},
    {id:'T3',routeId:'R1',directionId:'0',headsign:'B',shapeId:'S1',blockId:''}
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
    ['T2','R1','B','S1',[['A',1,28860,28860,1,0],['B',2,32460,32460,1,1]]],
    ['T3','R1','B','S1',[['A',1,28920,28920,1,0],['B',2,32520,32520,1,1]]]
  ]
};

(async()=>{
  const P=window.UVTransitProvider;
  const official=[{id:'official-r1',lifecycle:'active',scope:{lines:['1'],networks:[]}}];
  const out=await P.loadDerivedEvents('aut',manifest,['20260930'],now,official);
  assert.equal(out.events.byType('trip_expected_unobserved').length,2);
  const consecutive=out.events.byType('consecutive_missing_trips')[0];
  assert(consecutive);assert.equal(consecutive.scope.tripInstanceIds.length,2);
  assert.equal(consecutive.officialOverlap.matched,true);
  assert.equal(consecutive.officialOverlap.alertIds[0],'official-r1');
  assert.equal(out.events.byType('possible_undocumented_disruption').length,0);
  assert.equal(out.stats.types.consecutive_missing_trips,1);

  const core=await P.loadDerivedEventEngine('aut',manifest,['20260930']);
  assert.strictEqual(core.derivedEventEngine,out.derivedEventEngine);

  assert.equal(calls.filter(x=>x.includes('feed=tripUpdates')).length,1);
  assert.equal(calls.filter(x=>x.includes('feed=vehiclePositions')).length,1);
  assert.equal(calls.filter(x=>x.endsWith('core.json')).length,1);
  assert.equal(calls.filter(x=>x.endsWith('shapes.json')).length,1);
  assert.equal(calls.filter(x=>x.endsWith('schedule.json')).length,1);
  assert.equal(calls.filter(x=>x.endsWith('day.json')).length,1);
  console.log('RESULT: 15 ACTV DerivedEventEngine integration checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
