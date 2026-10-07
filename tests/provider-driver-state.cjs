const fs=require('fs'),vm=require('vm'),assert=require('assert');
const payloads={},calls=[];
async function fetch(url){
  url=String(url);calls.push(url);
  const data=payloads[url];
  return {ok:!!data,status:data?200:404,json:async()=>data,arrayBuffer:async()=>new ArrayBuffer(0),blob:async()=>({})};
}
const window={};window.window=window;
window.UVTransitGTFSRT={decodeFeed:()=>({header:{},entity:[]})};
const ctx=vm.createContext({window,document:{baseURI:'https://example.test/trasporti/'},URL,fetch,WebSocket:function(){},Intl,Date,Map,Set,Object,Array,Number,String,Error,Math,encodeURIComponent});
for(const file of ['gtfs.js','observations.js','service-date-resolver.js','service-plan.js','expected-position.js','identity-resolver.js','delay-position.js','prediction.js','motion-state.js','transit-state-engine.js','driver-state-adapter.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/provider-actv.js','utf8'),ctx);

const snap={id:'snap',sourceZipSha256:'hash',core:{file:'core.json'},shapes:{file:'shapes.json'},schedule:{file:'schedule.json'},serviceDates:['20260930']};
const manifest={schema:1,networks:{aut:{core:snap.core,shapes:snap.shapes,schedule:snap.schedule,snapshots:[snap]}}};
payloads['https://example.test/trasporti/runtime-data/core.json']={
 schema:1,network:'aut',agencies:[],routeShapes:{},
 routes:[{id:'R8',short:'8AE',long:'Linea 8AE',desc:'UM',type:3}],
 stops:[
  {id:'A',code:'A1',name:'A',lat:45,lon:12},
  {id:'B',code:'B2',name:'B',lat:45.01,lon:12},
  {id:'C',code:'C3',name:'C',lat:45.02,lon:12}
 ],
 trips:[{id:'T1',routeId:'R8',directionId:'0',headsign:'MOGLIANO FS prosegue per CASALE',shapeId:'S1',blockId:''}]
};
payloads['https://example.test/trasporti/runtime-data/shapes.json']={schema:1,network:'aut',shapes:{S1:[[45,12],[45.01,12],[45.02,12]]}};
payloads['https://example.test/trasporti/runtime-data/schedule.json']={
 schema:2,network:'aut',timezone:'Europe/Rome',days:['20260930'],
 routes:[['R8','8AE',3]],stops:[['A','A',45,12,''],['B','B',45.01,12,''],['C','C',45.02,12,'']],
 transfers:[],transferRules:[],chunks:{'20260930':{file:'day.json',trips:1}}
};
payloads['https://example.test/trasporti/runtime-data/day.json']={
 schema:2,network:'aut',day:'20260930',
 trips:[['T1','R8','MOGLIANO FS prosegue per CASALE','S1',[
  ['A',1,28800,28800,1,0],['B',2,29400,29400,1,1],['C',3,30000,30000,1,1]
 ]]]
};

(async()=>{
 const P=window.UVTransitProvider;
 const core=await P.loadDriverStateAdapter('aut',manifest,['20260930']);
 assert(core.driverStateAdapter);assert(core.transitStateEngine);assert(core.identityResolver);
 const now=Date.parse('2026-09-30T08:10:00+02:00')/1000;
 const candidates=core.driverStateAdapter.routeCandidates('8AE',now);
 assert.equal(candidates.length,1);
 const state=core.driverStateAdapter.resolve({
  gps:{lat:45.0101,lon:12,timestamp:now*1000,speed:7,accuracy:10},
  routeHint:'8AE',candidateTripInstanceIds:[candidates[0].id],now
 });
 assert.equal(state.matched,true);assert.equal(state.trip.route,'8AE');
 assert.equal(state.nextStop.id,'B');assert.equal(state.followingStop.id,'C');
 assert.equal(state.tripState.position.source,'driver_gps_position');
 assert.equal(state.delay.source,'position_derived');
 assert(state.routeDistanceM<50);

 const again=await P.loadDriverStateAdapter('aut',manifest,['20260930']);
 assert.strictEqual(again.driverStateAdapter,core.driverStateAdapter);
 assert.strictEqual(again.transitStateEngine,core.transitStateEngine);
 assert.equal(calls.filter(x=>x.endsWith('core.json')).length,1);
 assert.equal(calls.filter(x=>x.endsWith('shapes.json')).length,1);
 assert.equal(calls.filter(x=>x.endsWith('schedule.json')).length,1);
 assert.equal(calls.filter(x=>x.endsWith('day.json')).length,1);
 assert.equal(calls.filter(x=>x.includes('feed=')).length,0);
 console.log('RESULT: 15 ACTV DriverStateAdapter integration checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
