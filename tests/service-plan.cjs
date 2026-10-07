const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Intl,Date,Map,Set,Object,Array,Number,String,Error});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/service-plan.js','utf8'),ctx);
const S=window.UVTransitServicePlan;
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name)}

const core={
  schema:1,network:'aut',
  routes:[{id:'R1',short:'1',long:'Linea 1',desc:'',type:3,color:'112233',textColor:'ffffff'}],
  stops:[
    {id:'A',code:'100',name:'Alpha',lat:45,lon:12,parentStation:'',platformCode:''},
    {id:'B',code:'200',name:'Beta',lat:45.1,lon:12.1,parentStation:'',platformCode:''}
  ],
  trips:[
    {id:'T1',routeId:'R1',serviceId:'weekday',directionId:'0',headsign:'Beta',shapeId:'S1',blockId:'BLOCK1'},
    {id:'T2',routeId:'R1',directionId:'1',headsign:'Alpha',shapeId:'S2',blockId:''}
  ]
};
const trip1=['T1','R1','Beta','S1',[
  ['A',1,23*3600+50*60,23*3600+50*60,1,0],
  ['B',2,25*3600+10*60,25*3600+10*60,1,1]
]];
const trip2=['T2','R1','Alpha','S2',[
  ['B',1,8*3600,8*3600,1,0],
  ['A',2,8*3600+20*60,8*3600+20*60,1,1]
]];
const schedule={
  schema:2,network:'aut',timezone:'Europe/Rome',
  days:['20260929','20260930'],
  routes:[['R1','1',3]],stops:[['A','Alpha',45,12,''],['B','Beta',45.1,12.1,'']],
  chunksData:{
    '20260929':{schema:2,network:'aut',day:'20260929',trips:[trip1]},
    '20260930':{schema:2,network:'aut',day:'20260930',trips:[trip2]}
  },
  snapshotByDay:{'20260929':'old','20260930':'new'}
};
const plan=S.createServicePlan({provider:'actv-official',network:'aut',core,schedule,shapes:{}});

test('one TripInstance exists for each concrete service date',()=>{
  assert.equal(plan.instances().length,2);
  assert(plan.getTrip('20260929','T1'));
  assert(plan.getTrip('20260930','T2'));
});
test('TripInstance id is stable and date-scoped',()=>{
  assert.equal(plan.getTrip('20260929','T1').id,'actv-official:aut:20260929:T1');
});
test('route direction headsign shape and stop metadata survive normalization',()=>{
  const t=plan.getTrip('20260929','T1');
  assert.equal(t.route.short,'1');assert.equal(t.serviceId,'weekday');assert.equal(t.direction,'0');assert.equal(t.headsign,'Beta');assert.equal(t.shape,'S1');
  assert.equal(t.stops[0].stop.code,'100');
});
test('GTFS service-day base follows noon-minus-12h across DST',()=>{
  assert.equal(S.serviceDateBase('20260329','Europe/Rome'),Date.parse('2026-03-28T22:00:00Z')/1000);
  assert.equal(S.serviceDateBase('20261025','Europe/Rome'),Date.parse('2026-10-24T23:00:00Z')/1000);
  assert.equal(S.serviceDateBase('20260330','Europe/Rome')+8*3600,Date.parse('2026-03-30T08:00:00+02:00')/1000);
});

test('service-day times above 24h remain attached to the previous service date',()=>{
  const t=plan.getTrip('20260929','T1');
  assert.equal(t.plannedEnd-t.plannedStart,80*60);
  assert.equal(S.localServiceDate(t.plannedEnd,'Europe/Rome'),'20260930');
  assert.equal(t.serviceDate,'20260929');
});
test('activeAt finds a previous-service-date night trip after midnight',()=>{
  const t=plan.getTrip('20260929','T1');
  assert.equal(plan.activeCountAt(t.plannedStart+30*60),1);
});
test('route and stop indexes expose candidate TripInstances',()=>{
  assert.equal(plan.forRoute('R1').length,2);
  assert.equal(plan.forStop('A').length,2);
});
test('VehicleDuty is created only for populated block_id',()=>{
  const d=plan.duty('20260929','BLOCK1');assert(d);assert.deepEqual([...d.tripInstanceIds],[plan.getTrip('20260929','T1').id]);
  assert.equal(plan.vehicleDuties.size,1);
});
test('snapshot provenance is attached per service date',()=>{
  assert.equal(plan.getTrip('20260929','T1').snapshotId,'old');
  assert.equal(plan.getTrip('20260930','T2').snapshotId,'new');
});
test('shape progress is deliberately unresolved until Expected Position Model',()=>{
  const t=plan.getTrip('20260929','T1');assert.equal(t.shapeProgressStatus,'unresolved');assert.deepEqual([...t.shapeProgressByStop],[null,null]);
});
test('summary exposes operational counts without realtime semantics',()=>{
  const s=plan.summary();assert.equal(s.tripInstances,2);assert.equal(s.vehicleDuties,1);assert.deepEqual([...s.serviceDates],['20260929','20260930']);
});
console.log('RESULT: '+count+' service-plan checks passed.');
