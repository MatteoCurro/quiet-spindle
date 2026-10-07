const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Intl,Date,Map,Set,Object,Array,Number,String,Error,Math});
for(const file of ['gtfs.js','service-plan.js','expected-position.js','vehicle-continuity.js','identity-resolver.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);

const S=window.UVTransitServicePlan,E=window.UVTransitExpectedPosition,C=window.UVTransitVehicleContinuity,I=window.UVTransitIdentityResolver;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}
const epoch=s=>Date.parse(s)/1000;

const stops=[
  {id:'A',name:'A',lat:45.0000,lon:12.0000},
  {id:'B',name:'B',lat:45.0100,lon:12.0000},
  {id:'C',name:'C',lat:45.0200,lon:12.0000},
  {id:'X',name:'X',lat:45.0000,lon:12.0300},
  {id:'Y',name:'Y',lat:45.0400,lon:12.0000}
];
const core={schema:1,network:'aut',routes:[
  {id:'R1',short:'1',long:'Linea 1',desc:'UM',type:3},
  {id:'R2',short:'2',long:'Linea 2',desc:'ES',type:3},
  {id:'R3',short:'3',long:'Linea 3',desc:'UM',type:3}
],stops,trips:[
  {id:'AUT_ACTV_787_777',routeId:'R1',directionId:'0',headsign:'C',shapeId:'S1',blockId:''},
  {id:'T2',routeId:'R1',directionId:'0',headsign:'C',shapeId:'S1',blockId:''},
  {id:'T3',routeId:'R2',directionId:'1',headsign:'X',shapeId:'S2',blockId:''},
  {id:'T4',routeId:'R3',directionId:'0',headsign:'Y',shapeId:'LONG',blockId:''}
]};
const rows={
  t1:['AUT_ACTV_787_777','R1','C','S1',[
    ['A',1,28800,28800,1,0],['B',2,29400,29400,1,1],['C',3,30000,30000,1,1]
  ]],
  t2:['T2','R1','C','S1',[
    ['A',1,32400,32400,1,0],['B',2,33000,33000,1,1],['C',3,33600,33600,1,1]
  ]],
  t3:['T3','R2','X','S2',[
    ['A',1,28800,28800,1,0],['X',2,30000,30000,1,1]
  ]],
  t4:['T4','R3','Y','LONG',[
    ['A',1,28800,28800,1,0],['Y',2,31200,31200,1,1]
  ]]
};
const schedule={schema:2,network:'aut',timezone:'Europe/Rome',
  routes:[['R1','1',3],['R2','2',3],['R3','3',3]],
  stops:stops.map(s=>[s.id,s.name,s.lat,s.lon,'']),
  snapshotByDay:{'20260930':'snap'},
  chunksData:{'20260930':{trips:[rows.t1,rows.t2,rows.t3,rows.t4]}}
};
const plan=S.createServicePlan({provider:'actv-official',network:'aut',core,schedule,coreBySnapshot:{snap:core}});
const shapes={S1:[[45,12],[45.01,12],[45.02,12]],S2:[[45,12],[45,12.015],[45,12.03]],LONG:[[45,12],[45.01,12],[45.02,12],[45.03,12],[45.04,12]]};
const expected=E.createExpectedPositionModel({servicePlan:plan,shapesBySnapshot:{snap:shapes}});
const actvKeys=value=>{
  value=String(value||'').trim();if(!value)return [];
  const out=[value],p=value.split('_');
  if(p.length>=4&&p[1]==='ACTV'&&/^\d+$/.test(p[2]))out.push(p.slice(3).join('_'));
  return out;
};
const resolver=I.createIdentityResolver({servicePlan:plan,expectedPosition:expected,tripKeys:actvKeys});

check('exact trip id and service date resolve as exact',()=>{
  const r=resolver.resolve({id:'o1',provider:'actv-official',network:'aut',kind:'trip_update',externalTripId:'T3',serviceDate:'20260930',observedAt:epoch('2026-09-30T08:05:00+02:00')});
  assert.equal(r.classification,'exact');assert.equal(r.tripInstanceId,plan.getTrip('20260930','T3').id);assert.equal(r.confidence,1);
});

check('ACTV publication generation alias resolves cross-generation trip',()=>{
  const r=resolver.resolve({id:'o2',provider:'actv-official',network:'aut',kind:'trip_update',externalTripId:'AUT_ACTV_786_777',serviceDate:'20260930',observedAt:epoch('2026-09-30T08:05:00+02:00')});
  assert.equal(r.classification,'trip_matched');assert.equal(r.tripInstanceId,plan.getTrip('20260930','AUT_ACTV_787_777').id);
});

check('strong trip observation correlates subsequent vehicle id',()=>{
  const first=resolver.resolve({id:'o3a',provider:'actv-official',network:'aut',kind:'trip_update',externalTripId:'T3',serviceDate:'20260930',externalVehicleId:'BUS-3',observedAt:epoch('2026-09-30T08:05:00+02:00')});
  assert.equal(first.classification,'exact');
  const second=resolver.resolve({id:'o3b',provider:'actv-official',network:'aut',kind:'vehicle_position',externalTripId:'UNKNOWN',externalVehicleId:'BUS-3',observedAt:epoch('2026-09-30T08:07:00+02:00')});
  assert.equal(second.classification,'vehicle_correlated');assert.equal(second.tripInstanceId,first.tripInstanceId);
});

check('route direction stop and start time resolve without trip id',()=>{
  const r=resolver.resolve({id:'o4',provider:'actv-official',network:'aut',kind:'trip_update',externalRouteId:'2_ES',directionId:1,serviceDate:'20260930',startTime:'08:00:00',stopId:'X',stopSequence:2,observedAt:epoch('2026-09-30T08:10:00+02:00')});
  assert.equal(r.classification,'trip_matched');assert.equal(r.tripInstanceId,plan.getTrip('20260930','T3').id);
  assert(r.evidence.some(x=>x.type==='stop_sequence_id'));
});

check('TripUpdate stop timing can resolve a trip when startTime is absent',()=>{
  const actual=epoch('2026-09-30T08:11:00+02:00');
  const r=resolver.resolve({
    id:'o4b',provider:'actv-official',network:'aut',kind:'trip_update',
    externalRouteId:'1_UM',directionId:0,serviceDate:'20260930',
    stopId:'B',stopSequence:2,delay:60,observedAt:actual,
    stopTimeUpdates:[{stopId:'B',stopSequence:2,arrival:{time:actual,delay:60}}]
  });
  assert.equal(r.classification,'trip_matched');
  assert.equal(r.tripInstanceId,plan.getTrip('20260930','AUT_ACTV_787_777').id);
  assert(r.evidence.some(x=>x.type==='stop_time'));
});

check('known route and conflicting direction never force a trip match',()=>{
  const r=resolver.resolve({
    id:'o4c',provider:'actv-official',network:'aut',kind:'vehicle_position',
    externalRouteId:'1_UM',directionId:1,serviceDate:'20260930',
    position:{lat:45.01,lon:12},observedAt:epoch('2026-09-30T08:10:00+02:00')
  });
  assert.equal(r.classification,'route_only');assert.equal(r.matched,false);
});

check('stop sequence remains usable when upstream stop id is stale',()=>{
  const r=resolver.resolve({
    id:'o4d',provider:'actv-official',network:'aut',kind:'trip_update',
    externalRouteId:'2_ES',directionId:1,serviceDate:'20260930',startTime:'08:00:00',
    stopId:'STALE-X',stopSequence:2,observedAt:epoch('2026-09-30T08:10:00+02:00')
  });
  assert.equal(r.classification,'trip_matched');
  assert.equal(r.tripInstanceId,plan.getTrip('20260930','T3').id);
  assert(r.evidence.some(x=>x.type==='stop_sequence'));
});

check('cross-provider or cross-network observations are rejected',()=>{
  const a=resolver.resolve({id:'scope-a',provider:'other',network:'aut',kind:'trip_update',externalTripId:'T3',serviceDate:'20260930'});
  const b=resolver.resolve({id:'scope-b',provider:'actv-official',network:'nav',kind:'trip_update',externalTripId:'T3',serviceDate:'20260930'});
  assert.equal(a.classification,'unknown');assert.equal(b.classification,'unknown');
  assert(a.evidence.some(x=>x.type==='scope_mismatch'));assert(b.evidence.some(x=>x.type==='scope_mismatch'));
});

check('GPS near stop resolves conservatively when shape model is unavailable',()=>{
  const noShape=I.createIdentityResolver({servicePlan:plan});
  const r=noShape.resolve({id:'o5',provider:'actv-official',network:'aut',kind:'vehicle_position',serviceDate:'20260930',externalRouteId:'2_ES',directionId:1,position:{lat:45.00005,lon:12.02995},observedAt:epoch('2026-09-30T08:19:00+02:00')});
  assert.equal(r.classification,'gps_stop_matched');assert.equal(r.tripInstanceId,plan.getTrip('20260930','T3').id);
});

check('GPS projected on shape resolves a vehicle between distant stops',()=>{
  const r=resolver.resolve({id:'o6',provider:'actv-official',network:'aut',kind:'vehicle_position',serviceDate:'20260930',externalRouteId:'3_UM',directionId:0,position:{lat:45.01005,lon:12.00001},bearing:0,speed:10,observedAt:epoch('2026-09-30T08:10:00+02:00')});
  assert.equal(r.classification,'gps_shape_matched');assert.equal(r.tripInstanceId,plan.getTrip('20260930','T4').id);
  assert(r.evidence.some(x=>x.type==='gps_shape'));
});

check('expired vehicle correlation is not reused',()=>{
  const local=I.createIdentityResolver({servicePlan:plan,expectedPosition:expected,options:{vehicleCorrelationTtlSec:60}});
  local.resolve({id:'o7a',provider:'actv-official',network:'aut',kind:'trip_update',externalTripId:'T3',serviceDate:'20260930',externalVehicleId:'OLD-BUS',observedAt:1000});
  const r=local.resolve({id:'o7b',provider:'actv-official',network:'aut',kind:'vehicle_position',externalVehicleId:'OLD-BUS',observedAt:1100});
  assert.notEqual(r.classification,'vehicle_correlated');
});

check('vehicle history continuity bridges a later feed conservatively',()=>{
  const continuity=C.createVehicleContinuityStore({correlationTtlSec:180,retentionTtlSec:900});
  const t3=plan.getTrip('20260930','T3'),seedAt=epoch('2026-09-30T08:10:00+02:00');
  continuity.ingest({provider:'actv-official',network:'aut',generatedAt:seedAt,entries:[{
    vehicleId:'HISTORY-BUS',externalVehicleId:'HISTORY-BUS',anonymous:false,status:'matched',
    tripInstanceId:t3.id,routeId:'R2',lastSeenAt:seedAt,position:{lat:45.0001,lon:12.015},
    strongestResolution:{confidence:.95}
  }]},{now:seedAt});
  const local=I.createIdentityResolver({servicePlan:plan,expectedPosition:expected,continuityStore:continuity});
  const bridged=local.resolveBatch([{
    id:'history-ok',provider:'actv-official',network:'aut',kind:'vehicle_position',
    externalVehicleId:'HISTORY-BUS',externalRouteId:'2_ES',directionId:1,
    position:{lat:45.0001,lon:12.015},observedAt:seedAt+60
  }])[0];
  assert.equal(bridged.classification,'vehicle_correlated');assert.equal(bridged.tripInstanceId,t3.id);
  assert(bridged.evidence.some(x=>x.type==='vehicle_history_continuity'));

  const conflict=local.resolveBatch([{
    id:'history-conflict',provider:'actv-official',network:'aut',kind:'vehicle_position',
    externalVehicleId:'HISTORY-BUS',externalTripId:'T4',externalRouteId:'3_UM',directionId:0,
    position:{lat:45.01005,lon:12.00001},observedAt:seedAt+90
  }])[0];
  assert(!conflict.evidence.some(x=>x.type==='vehicle_history_continuity'));

  const expiredHistory=local.resolveBatch([{
    id:'history-expired',provider:'actv-official',network:'aut',kind:'vehicle_position',
    externalVehicleId:'HISTORY-BUS',externalRouteId:'2_ES',directionId:1,observedAt:seedAt+181
  }])[0];
  assert.notEqual(expiredHistory.classification,'vehicle_correlated');
});

check('ambiguous equal timetable candidates remain unknown',()=>{
  const ambCore={...core,trips:[
    {id:'A1',routeId:'R1',directionId:'0',headsign:'C',shapeId:'S1',blockId:''},
    {id:'A2',routeId:'R1',directionId:'0',headsign:'C',shapeId:'S1',blockId:''}
  ]};
  const trip=['','R1','C','S1',[['A',1,28800,28800,1,0],['B',2,29400,29400,1,1],['C',3,30000,30000,1,1]]];
  const ambSchedule={schema:2,network:'aut',timezone:'Europe/Rome',routes:[['R1','1',3]],stops:stops.map(s=>[s.id,s.name,s.lat,s.lon,'']),snapshotByDay:{'20260930':'amb'},chunksData:{'20260930':{trips:[['A1',...trip.slice(1)],['A2',...trip.slice(1)]]}}};
  const ambPlan=S.createServicePlan({provider:'x',network:'aut',core:ambCore,schedule:ambSchedule,coreBySnapshot:{amb:ambCore}});
  const amb=I.createIdentityResolver({servicePlan:ambPlan});
  const r=amb.resolve({id:'o8',provider:'x',network:'aut',kind:'trip_update',externalRouteId:'1_UM',directionId:0,serviceDate:'20260930',startTime:'08:00:00',stopId:'B',stopSequence:2,observedAt:epoch('2026-09-30T08:10:00+02:00')});
  assert.equal(r.classification,'route_only');assert.equal(r.matched,false);assert.equal(r.alternatives.length,2);
});

check('consumer candidate hint can disambiguate a strong observation without forcing weak evidence',()=>{
  const obs={id:'hint-strong',provider:'actv-official',network:'aut',kind:'vehicle_position',externalRouteId:'1_UM',directionId:0,position:{lat:45.0101,lon:12},observedAt:epoch('2026-09-30T08:10:00+02:00')};
  const only=plan.getTrip('20260930','AUT_ACTV_787_777').id;
  const strong=resolver.resolve(obs,{candidateTripInstanceIds:[only]});
  assert.equal(strong.matched,true);assert.equal(strong.tripInstanceId,only);

  const weak=resolver.resolve({
    id:'hint-weak',provider:'actv-official',network:'aut',kind:'vehicle_position',
    externalRouteId:'2_ES',observedAt:epoch('2026-09-30T12:00:00+02:00')
  },{candidateTripInstanceIds:[plan.getTrip('20260930','T3').id]});
  assert.equal(weak.matched,false);assert.equal(weak.classification,'route_only');
});

check('unique route with weak evidence degrades to route_only',()=>{
  const r=resolver.resolve({id:'o9',provider:'actv-official',network:'aut',kind:'vehicle_position',externalRouteId:'2_ES',observedAt:epoch('2026-09-30T12:00:00+02:00')});
  assert.equal(r.classification,'route_only');assert.equal(r.routeId,'R2');assert.equal(r.matched,false);
});

check('observation without useful identity evidence remains unknown',()=>{
  const r=resolver.resolve({id:'o10',provider:'actv-official',network:'aut',kind:'vehicle_position',externalVehicleId:'MYSTERY',observedAt:epoch('2026-09-30T12:00:00+02:00')});
  assert.equal(r.classification,'unknown');assert.equal(r.matched,false);
});

check('resolveBatch processes trip updates before vehicle positions for correlation',()=>{
  const local=I.createIdentityResolver({servicePlan:plan,expectedPosition:expected});
  const rows=local.resolveBatch([
    {id:'vp',provider:'actv-official',network:'aut',kind:'vehicle_position',externalVehicleId:'BATCH-BUS',externalTripId:'NOPE',observedAt:2001},
    {id:'tu',provider:'actv-official',network:'aut',kind:'trip_update',externalVehicleId:'BATCH-BUS',externalTripId:'T3',serviceDate:'20260930',observedAt:2000}
  ]);
  const vp=rows.find(x=>x.observationId==='vp');
  assert.equal(vp.classification,'vehicle_correlated');
});

console.log('RESULT: '+n+' identity-resolver checks passed.');
