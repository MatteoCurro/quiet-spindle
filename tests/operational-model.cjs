const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Intl,Date,Map,Set,Object,Array,Number,String,Error,Math});
for(const file of ['service-plan.js','operational-model.js'])
 vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);
const S=window.UVTransitServicePlan,O=window.UVTransitOperations;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}
const sec=(h,m)=>h*3600+m*60;

const core={schema:1,network:'aut',
 routes:[{id:'R1',short:'1',long:'Linea 1',type:3}],
 stops:[
  {id:'DEPOT',name:'Depot',lat:45,lon:12},
  {id:'A',name:'A',lat:45.01,lon:12},
  {id:'B',name:'B',lat:45.02,lon:12},
  {id:'C',name:'C',lat:45.03,lon:12}
 ],
 trips:[
  {id:'DH1',routeId:'R1',serviceId:'weekday',directionId:'0',headsign:'A',shapeId:'S',blockId:'BLOCK-A'},
  {id:'T1',routeId:'R1',serviceId:'weekday',directionId:'0',headsign:'B',shapeId:'S',blockId:'BLOCK-A'},
  {id:'T2',routeId:'R1',serviceId:'weekday',directionId:'1',headsign:'C',shapeId:'S',blockId:'BLOCK-A'},
  {id:'T3',routeId:'R1',serviceId:'school',directionId:'0',headsign:'B',shapeId:'S',blockId:'BLOCK-B'}
 ]};
const schedule={schema:2,network:'aut',timezone:'Europe/Rome',
 routes:[['R1','1',3]],
 stops:[['DEPOT','Depot',45,12,''],['A','A',45.01,12,''],['B','B',45.02,12,''],['C','C',45.03,12,'']],
 snapshotByDay:{'20261005':'snap'},
 chunksData:{'20261005':{trips:[
  ['DH1','R1','A','S',[['DEPOT',1,sec(7,40),sec(7,40),0,0],['A',2,sec(7,55),sec(7,55),0,0]]],
  ['T1','R1','B','S',[['A',1,sec(8,0),sec(8,0),1,0],['B',2,sec(8,30),sec(8,30),1,1]]],
  ['T2','R1','C','S',[['C',1,sec(8,45),sec(8,45),1,0],['A',2,sec(9,15),sec(9,15),1,1]]],
  ['T3','R1','B','S',[['A',1,sec(10,0),sec(10,0),1,0],['B',2,sec(10,30),sec(10,30),1,1]]]
 ]}}
};
const plan=S.createServicePlan({provider:'actv-official',network:'aut',core,schedule,coreBySnapshot:{snap:core}});
const tods={
 trips:[{trip_id:'DH1',TODS_trip_type:'pull-out'}],
 vehicles:[{vehicle_id:'BUS-1',vehicle_label:'101',license_plate:'VE123'}],
 vehicle_assignments:[{date:'20261005',service_id:'weekday',block_id:'BLOCK-A',vehicle_id:'BUS-1'}],
 run_events:[
  {service_id:'weekday',run_id:'100',event_sequence:10,piece_id:'100-1',block_id:'BLOCK-A',event_type:'Pull-Out',trip_id:'DH1',start_location:'DEPOT',start_time:'07:40:00',end_location:'A',end_time:'07:55:00'},
  {service_id:'weekday',run_id:'100',event_sequence:20,piece_id:'100-1',block_id:'BLOCK-A',event_type:'Operator',trip_id:'T1',start_location:'A',start_time:'08:00:00',end_location:'B',end_time:'08:30:00'}
 ]
};
const model=O.createOperationalModel({servicePlan:plan,tods});

check('TripInstance preserves GTFS service_id required for TODS assignment scope',()=>{
 assert.equal(plan.getTrip('20261005','T1').serviceId,'weekday');
});
check('GTFS block becomes vehicle duty, not crew run',()=>{
 assert.equal(model.duties.length,2);
 const d=model.duties.find(x=>x.blockId==='BLOCK-A');
 assert(d);assert.equal(d.provenance,'gtfs_block');assert.deepEqual([...d.serviceIds],['weekday']);
});
check('explicit TODS trip type creates explicit non-revenue deadhead leg',()=>{
 const d=model.duties.find(x=>x.blockId==='BLOCK-A');
 const dh=d.legs.find(x=>x.tripId==='DH1');
 assert.equal(dh.kind,'trip_non_revenue');assert.equal(dh.deadhead,true);
 assert.equal(dh.operationalType,'pull-out');assert.equal(dh.provenance,'tods_trip_type');
});
check('different terminal stops inside same block create candidate, not asserted deadhead',()=>{
 const d=model.duties.find(x=>x.blockId==='BLOCK-A');
 const gap=d.legs.find(x=>x.kind==='deadhead_candidate');
 assert(gap);assert.equal(gap.startStopId,'B');assert.equal(gap.endStopId,'C');
 assert.equal(gap.deadhead,false);assert.equal(gap.provenance,'gtfs_block_gap');
});
check('crew runs exist only from explicit TODS run_events',()=>{
 assert.equal(model.crewRuns.length,1);
 assert.equal(model.crewRuns[0].runId,'100');assert.equal(model.crewRuns[0].events.length,2);
 assert.deepEqual([...model.crewRuns[0].blockIds],['BLOCK-A']);
});
check('TODS fleet vehicle metadata is preserved separately from realtime IDs',()=>{
 assert.equal(model.vehicles.length,1);assert.equal(model.vehicles[0].vehicleId,'BUS-1');
 assert.equal(model.vehicles[0].licensePlate,'VE123');
});
check('planned TODS vehicle assignment resolves to vehicle duty',()=>{
 const s=model.snapshot({now:1});
 const a=s.assignments.find(x=>x.source==='tods_vehicle_assignment');
 assert(a);assert.equal(a.status,'planned');assert.equal(a.confidence,1);assert.equal(a.dutyIds.length,1);
});
check('matched realtime vehicle yields observed block assignment',()=>{
 const t=plan.getTrip('20261005','T1');
 const s=model.snapshot({now:100,transitSnapshot:{generatedAt:100,vehicleStates:[{
  vehicleId:'BUS-1',externalVehicleId:'BUS-1',anonymous:false,status:'matched',
  tripInstanceId:t.id,lastSeenAt:99,strongestResolution:{confidence:.9}
 }]}});
 const a=s.assignments.find(x=>x.source==='observed_realtime');
 assert(a);assert.equal(a.blockId,'BLOCK-A');assert.equal(a.serviceId,'weekday');assert.equal(a.confidence,.9);
});
check('planned versus observed different vehicle is surfaced as conflict',()=>{
 const t=plan.getTrip('20261005','T1');
 const s=model.snapshot({now:100,transitSnapshot:{generatedAt:100,vehicleStates:[{
  vehicleId:'BUS-X',externalVehicleId:'BUS-X',anonymous:false,status:'matched',
  tripInstanceId:t.id,lastSeenAt:99,strongestResolution:{confidence:1}
 }]}});
 assert.equal(s.assignmentConflicts.length,1);
 assert.equal(s.assignmentConflicts[0].type,'planned_observed_vehicle_mismatch');
});
check('anonymous and unblocked vehicles cannot become operational assignments',()=>{
 const t=plan.getTrip('20261005','T3');
 const s=model.snapshot({now:100,transitSnapshot:{generatedAt:100,vehicleStates:[
  {vehicleId:'anon',anonymous:true,status:'matched',tripInstanceId:t.id},
  {vehicleId:'unknown',anonymous:false,status:'unknown',tripInstanceId:null}
 ]}});
 assert.equal(s.assignments.filter(x=>x.source==='observed_realtime').length,0);
});
check('summary keeps explicit deadheads separate from inferred candidates',()=>{
 const s=model.snapshot({now:1}),x=s.summary();
 assert.equal(x.vehicleDuties,2);assert.equal(x.crewRuns,1);
 assert.equal(x.explicitDeadheads,1);assert.equal(x.deadheadCandidates,1);
 assert.equal(x.plannedAssignments,1);
});
check('model does not infer a crew run from a GTFS block',()=>{
 const empty=O.createOperationalModel({servicePlan:plan,tods:{}});
 assert.equal(empty.crewRuns.length,0);assert.equal(empty.duties.length,2);
});
check('official snake_case TODS field names are accepted directly',()=>{
 assert.equal(model.crewRuns[0].events[0].eventSequence,10);
 assert.equal(model.snapshot({now:1}).assignments[0].date,'20261005');
});

console.log('RESULT: '+n+' TODS-compatible operational model checks passed.');
