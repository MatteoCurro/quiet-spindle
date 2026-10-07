const fs=require('fs'),vm=require('vm'),assert=require('assert');
const payloads={},seen=[];
async function fetch(url){
  url=String(url);seen.push(url);const data=payloads[url];
  return {ok:!!data,status:data?200:404,json:async()=>data,arrayBuffer:async()=>new ArrayBuffer(0),blob:async()=>({})};
}
const window={};window.window=window;
const ctx=vm.createContext({window,document:{baseURI:'https://example.test/trasporti/'},URL,fetch,WebSocket:function(){},Intl,Date,Map,Set,Object,Array,Number,String,Error,Math});
for(const file of ['gtfs.js','service-date-resolver.js','service-plan.js','expected-position.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/provider-actv.js','utf8'),ctx);

const old={
  id:'old',sourceZipSha256:'oldhash',
  core:{file:'old-core.json'},shapes:{file:'old-shapes.json'},schedule:{file:'old-schedule.json'},
  serviceDates:['20260929']
};
const latest={
  id:'new',sourceZipSha256:'newhash',
  core:{file:'new-core.json'},shapes:{file:'new-shapes.json'},schedule:{file:'new-schedule.json'},
  serviceDates:['20260930']
};
const manifest={schema:1,networks:{aut:{core:latest.core,shapes:latest.shapes,schedule:latest.schedule,snapshots:[latest,old]}}};

payloads['https://example.test/trasporti/runtime-data/old-core.json']={
  schema:1,network:'aut',agencies:[],routeShapes:{},
  routes:[{id:'R',short:'1',type:3}],
  stops:[{id:'A',name:'A',lat:45,lon:12},{id:'B',name:'B',lat:45,lon:12.02}],
  trips:[{id:'T',routeId:'R',directionId:'0',headsign:'East',shapeId:'SAME',blockId:''}]
};
payloads['https://example.test/trasporti/runtime-data/new-core.json']={
  schema:1,network:'aut',agencies:[],routeShapes:{},
  routes:[{id:'R',short:'1',type:3}],
  stops:[{id:'A',name:'A',lat:45,lon:12},{id:'B',name:'B',lat:45.02,lon:12}],
  trips:[{id:'T',routeId:'R',directionId:'1',headsign:'North',shapeId:'SAME',blockId:''}]
};
payloads['https://example.test/trasporti/runtime-data/old-shapes.json']={
  schema:1,network:'aut',shapes:{SAME:[[45,12],[45,12.01],[45,12.02]]}
};
payloads['https://example.test/trasporti/runtime-data/new-shapes.json']={
  schema:1,network:'aut',shapes:{SAME:[[45,12],[45.01,12],[45.02,12]]}
};
payloads['https://example.test/trasporti/runtime-data/old-schedule.json']={
  schema:2,network:'aut',timezone:'Europe/Rome',days:['20260929'],
  routes:[['R','1',3]],stops:[['A','A',45,12,''],['B','B',45,12.02,'']],
  transfers:[],transferRules:[],chunks:{'20260929':{file:'old-29.json',trips:1}}
};
payloads['https://example.test/trasporti/runtime-data/new-schedule.json']={
  schema:2,network:'aut',timezone:'Europe/Rome',days:['20260930'],
  routes:[['R','1',3]],stops:[['A','A',45,12,''],['B','B',45.02,12,'']],
  transfers:[],transferRules:[],chunks:{'20260930':{file:'new-30.json',trips:1}}
};
payloads['https://example.test/trasporti/runtime-data/old-29.json']={
  schema:2,network:'aut',day:'20260929',
  trips:[['T','R','East','SAME',[['A',1,8*3600,8*3600,1,0],['B',2,8*3600+20*60,8*3600+20*60,1,1]]]]
};
payloads['https://example.test/trasporti/runtime-data/new-30.json']={
  schema:2,network:'aut',day:'20260930',
  trips:[['T','R','North','SAME',[['A',1,8*3600,8*3600,1,0],['B',2,8*3600+20*60,8*3600+20*60,1,1]]]]
};

(async()=>{
  const P=window.UVTransitProvider;
  const first=await P.loadExpectedPositionModel('aut',manifest,['20260929','20260930']);
  const model=first.expectedPosition,oldTrip=first.plan.getTrip('20260929','T'),newTrip=first.plan.getTrip('20260930','T');
  assert.equal(model.geometry(oldTrip).status,'resolved');
  assert.equal(model.geometry(newTrip).status,'resolved');
  assert(model.geometry(oldTrip).maxStopDistanceM<2);
  assert(model.geometry(newTrip).maxStopDistanceM<2);
  const oldState=model.expectedState(oldTrip,oldTrip.plannedStart+10*60);
  const newState=model.expectedState(newTrip,newTrip.plannedStart+10*60);
  assert(Math.abs(oldState.expectedPosition.lat-45)<0.0001);
  assert(oldState.expectedPosition.lon>12.009&&oldState.expectedPosition.lon<12.011);
  assert(newState.expectedPosition.lat>45.009&&newState.expectedPosition.lat<45.011);
  assert(Math.abs(newState.expectedPosition.lon-12)<0.0001);
  assert.equal(oldTrip.direction,'0');assert.equal(newTrip.direction,'1');
  const second=await P.loadExpectedPositionModel('aut',manifest,['20260929','20260930']);
  assert.strictEqual(second.expectedPosition,model);
  assert(seen.includes('https://example.test/trasporti/runtime-data/old-shapes.json'));
  assert(seen.includes('https://example.test/trasporti/runtime-data/new-shapes.json'));
  console.log('RESULT: 13 ACTV Expected Position integration checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
