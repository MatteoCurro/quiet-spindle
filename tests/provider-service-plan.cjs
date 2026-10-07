const fs=require('fs'),vm=require('vm'),assert=require('assert');
const payloads={},seen=[];
async function fetch(url){
  url=String(url);seen.push(url);const data=payloads[url];
  return {ok:!!data,status:data?200:404,json:async()=>data,arrayBuffer:async()=>new ArrayBuffer(0),blob:async()=>({})};
}
const window={};window.window=window;
const ctx=vm.createContext({window,document:{baseURI:'https://example.test/trasporti/'},URL,fetch,WebSocket:function(){},Intl,Date,Map,Set,Object,Array,Number,String,Error});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/service-date-resolver.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/service-plan.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/provider-actv.js','utf8'),ctx);

const old={id:'old',sourceZipSha256:'oldhash',core:{file:'old-core.json'},schedule:{file:'old-schedule.json'},serviceDates:['20260929']};
const latest={id:'new',sourceZipSha256:'newhash',core:{file:'new-core.json'},schedule:{file:'new-schedule.json'},serviceDates:['20260930']};
const manifest={schema:1,networks:{aut:{core:latest.core,schedule:latest.schedule,snapshots:[latest,old]}}};

payloads['https://example.test/trasporti/runtime-data/old-core.json']={
  schema:1,network:'aut',
  agencies:[],routeShapes:{},
  routes:[{id:'RO',short:'1',type:3}],
  stops:[{id:'A',code:'10',name:'Alpha',lat:45,lon:12},{id:'B',code:'20',name:'Beta',lat:45.1,lon:12.1}],
  trips:[{id:'T-SHARED',routeId:'RO',directionId:'0',headsign:'Beta',shapeId:'SO',blockId:'B1'}]
};
payloads['https://example.test/trasporti/runtime-data/new-core.json']={
  schema:1,network:'aut',
  agencies:[],routeShapes:{},
  routes:[{id:'RN',short:'2',type:3}],
  stops:[{id:'B',code:'20',name:'Beta',lat:45.1,lon:12.1},{id:'C',code:'30',name:'Gamma',lat:45.2,lon:12.2}],
  trips:[{id:'T-SHARED',routeId:'RN',directionId:'1',headsign:'Gamma',shapeId:'SN',blockId:''}]
};
payloads['https://example.test/trasporti/runtime-data/old-schedule.json']={
  schema:2,network:'aut',timezone:'Europe/Rome',days:['20260929'],
  routes:[['RO','1',3]],stops:[['A','Alpha',45,12,''],['B','Beta',45.1,12.1,'']],
  transfers:[],transferRules:[],chunks:{'20260929':{file:'old-29.json',trips:1}}
};
payloads['https://example.test/trasporti/runtime-data/new-schedule.json']={
  schema:2,network:'aut',timezone:'Europe/Rome',days:['20260930'],
  routes:[['RN','2',3]],stops:[['B','Beta',45.1,12.1,''],['C','Gamma',45.2,12.2,'']],
  transfers:[],transferRules:[],chunks:{'20260930':{file:'new-30.json',trips:1}}
};
payloads['https://example.test/trasporti/runtime-data/old-29.json']={
  schema:2,network:'aut',day:'20260929',
  trips:[['T-SHARED','RO','Beta','SO',[['A',1,23*3600+50*60,23*3600+50*60,1,0],['B',2,25*3600,25*3600,1,1]]]]
};
payloads['https://example.test/trasporti/runtime-data/new-30.json']={
  schema:2,network:'aut',day:'20260930',
  trips:[['T-SHARED','RN','Gamma','SN',[['B',1,8*3600,8*3600,1,0],['C',2,8*3600+20*60,8*3600+20*60,1,1]]]]
};

(async()=>{
  const P=window.UVTransitProvider;
  const first=await P.loadServicePlan('aut',manifest,['20260929','20260930']);
  const plan=first.plan;
  assert.equal(plan.instances().length,2);
  assert.equal(plan.getTrip('20260929','T-SHARED').direction,'0');
  assert.equal(plan.getTrip('20260929','T-SHARED').blockId,'B1');
  assert.equal(plan.getTrip('20260929','T-SHARED').route.id,'RO');
  assert.equal(plan.getTrip('20260929','T-SHARED').snapshotId,'old');
  assert.equal(plan.getTrip('20260930','T-SHARED').direction,'1');
  assert.equal(plan.getTrip('20260930','T-SHARED').route.id,'RN');
  assert.equal(plan.getTrip('20260930','T-SHARED').snapshotId,'new');
  assert(plan.duty('20260929','B1'));
  assert.equal(plan.forRoute('RO').length,1);
  assert.equal(plan.forRoute('RN').length,1);
  const second=await P.loadServicePlan('aut',manifest,['20260929','20260930']);
  assert.strictEqual(second.plan,plan);
  assert(seen.includes('https://example.test/trasporti/runtime-data/old-core.json'));
  assert(seen.includes('https://example.test/trasporti/runtime-data/new-core.json'));
  console.log('RESULT: 14 ACTV ServicePlan integration checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
