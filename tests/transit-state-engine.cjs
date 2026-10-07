const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Intl,Date,Map,Set,Object,Array,Number,String,Error,Math});
for(const file of ['gtfs.js','service-plan.js','expected-position.js','vehicle-registry.js','vehicle-continuity.js','transit-state-engine.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);

const S=window.UVTransitServicePlan,E=window.UVTransitExpectedPosition,V=window.UVTransitVehicleRegistry,C=window.UVTransitVehicleContinuity,T=window.UVTransitState;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}
const sec=(h,m)=>h*3600+m*60;
const at=s=>Date.parse(s)/1000;

const stops=[
  {id:'A',name:'A',lat:45,lon:12},
  {id:'B',name:'B',lat:45.01,lon:12}
];
const routes=[
  {id:'R1',short:'1',long:'Linea 1',desc:'UM',type:3},
  {id:'R2',short:'2',long:'Linea 2',desc:'ES',type:3}
];
const tripMeta=[];
const rows=[];
function addTrip(id,routeId,start,end){
  tripMeta.push({id,routeId,directionId:'0',headsign:'B',shapeId:'S1',blockId:''});
  rows.push([id,routeId,'B','S1',[
    ['A',1,start,start,1,0],['B',2,end,end,1,1]
  ]]);
}
addTrip('T_ACTIVE','R1',sec(8,0),sec(9,0));
addTrip('T_UNOBS','R1',sec(8,15),sec(8,45));
addTrip('T_MISSING','R1',sec(8,0),sec(9,0));
addTrip('T_CANCEL','R1',sec(8,10),sec(8,40));
addTrip('T_FUTURE','R1',sec(9,0),sec(10,0));
addTrip('T_SOON','R1',sec(8,23),sec(9,0));
addTrip('T_DONE','R1',sec(7,0),sec(8,0));

const core={schema:1,network:'aut',routes,stops,trips:tripMeta};
const schedule={
  schema:2,network:'aut',timezone:'Europe/Rome',
  routes:[['R1','1',3],['R2','2',3]],stops:[['A','A',45,12,''],['B','B',45.01,12,'']],
  snapshotByDay:{'20260930':'snap'},
  chunksData:{'20260930':{trips:rows}}
};
const plan=S.createServicePlan({provider:'actv-official',network:'aut',core,schedule,coreBySnapshot:{snap:core}});
const expected=E.createExpectedPositionModel({servicePlan:plan,shapesBySnapshot:{snap:{S1:[[45,12],[45.01,12]]}}});
const now=at('2026-09-30T08:20:00+02:00');

const observations=[
  {id:'obs-active',provider:'actv-official',network:'aut',kind:'vehicle_position',observedAt:now-30,receivedAt:now,
   externalVehicleId:'BUS-1',externalTripId:'T_ACTIVE',externalRouteId:'R1',position:{lat:45.005,lon:12},bearing:0,speed:7},
  {id:'obs-cancel',provider:'actv-official',network:'aut',kind:'trip_update',observedAt:now-20,receivedAt:now,
   externalTripId:'T_CANCEL',externalRouteId:'R1',scheduleRelationship:3},
  {id:'obs-route',provider:'actv-official',network:'aut',kind:'vehicle_position',observedAt:now-10,receivedAt:now,
   externalVehicleId:'BUS-2',externalRouteId:'R2',position:{lat:45.2,lon:12.2}},
  {id:'obs-service-unknown',provider:'actv-official',network:'aut',kind:'vehicle_position',observedAt:now-8,receivedAt:now,
   externalVehicleId:'BUS-3',externalTripId:'RAW-UNKNOWN',position:{lat:45.3,lon:12.3}},
  {id:'obs-anon',provider:'actv-official',network:'aut',kind:'vehicle_position',observedAt:now-5,receivedAt:now,
   position:{lat:45.4,lon:12.4}}
];
const resolutions=[
  {observationId:'obs-active',classification:'exact',matched:true,tripInstanceId:plan.getTrip('20260930','T_ACTIVE').id,routeId:'R1',confidence:1},
  {observationId:'obs-cancel',classification:'exact',matched:true,tripInstanceId:plan.getTrip('20260930','T_CANCEL').id,routeId:'R1',confidence:1},
  {observationId:'obs-route',classification:'route_only',matched:false,tripInstanceId:null,routeId:'R2',confidence:.8},
  {observationId:'obs-service-unknown',classification:'unknown',matched:false,tripInstanceId:null,routeId:null,confidence:0},
  {observationId:'obs-anon',classification:'unknown',matched:false,tripInstanceId:null,routeId:null,confidence:0}
];

const vehicleRegistry=V.createVehicleRegistry(),vehicleContinuity=C.createVehicleContinuityStore();
const engine=T.createTransitStateEngine({servicePlan:plan,expectedPosition:expected,vehicleRegistry,vehicleContinuity});
const snap=engine.snapshot({observations,resolutions,now,persistVehicleRegistry:true});

check('observed active trip is marked observed with ExpectedState alongside raw observation',()=>{
  const s=snap.trip(plan.getTrip('20260930','T_ACTIVE').id);
  assert.equal(s.status,'observed');assert.equal(s.active,true);
  assert(s.expectedState);assert.equal(s.observationIds[0],'obs-active');assert(s.observationAgeSec<=30);
});

check('recently active trip without observation is expected_unobserved',()=>{
  assert.equal(snap.trip(plan.getTrip('20260930','T_UNOBS').id).status,'expected_unobserved');
});

check('long-active unobserved trip becomes likely_missing only with fresh network evidence',()=>{
  const s=snap.trip(plan.getTrip('20260930','T_MISSING').id);
  assert.equal(s.status,'likely_missing');assert(s.confidence>=.55&&s.confidence<=.75);
  assert(s.evidence.some(x=>x.type==='network_has_fresh_matched_observations'));
});

check('official GTFS-RT cancellation overrides active state',()=>{
  const s=snap.trip(plan.getTrip('20260930','T_CANCEL').id);
  assert.equal(s.status,'cancelled');assert.equal(s.confidence,1);
  assert(s.evidence.some(x=>x.type==='official_cancellation'));
});

check('future trip is scheduled and near-future trip is awaiting_observation',()=>{
  assert.equal(snap.trip(plan.getTrip('20260930','T_FUTURE').id).status,'scheduled');
  assert.equal(snap.trip(plan.getTrip('20260930','T_SOON').id).status,'awaiting_observation');
});

check('past trip is completed',()=>{
  assert.equal(snap.trip(plan.getTrip('20260930','T_DONE').id).status,'completed');
});

check('predicted_live is reserved but not emitted by 8.7 engine',()=>{
  assert(T.TRIP_STATUSES.includes('predicted_live'));
  assert.equal(snap.tripsByStatus('predicted_live').length,0);
});

check('matched vehicle groups current observations without losing raw position',()=>{
  const v=snap.vehicle('BUS-1');
  assert.equal(v.status,'matched');assert.equal(v.tripInstanceId,plan.getTrip('20260930','T_ACTIVE').id);
  assert.deepEqual({...v.position},{lat:45.005,lon:12});
});

check('route-only, service-unknown and anonymous unknown vehicles are preserved',()=>{
  assert.equal(snap.vehicle('BUS-2').status,'route_only');
  assert.equal(snap.vehicle('BUS-3').status,'service_unknown');
  const anon=snap.vehicleStates.find(x=>x.anonymous);
  assert(anon);assert.equal(anon.status,'unknown');assert(anon.vehicleId.startsWith('anonymous:'));
});

check('vehicle registry and continuity snapshots are attached without changing vehicle-state contract',()=>{
  assert(snap.vehicleRegistrySnapshot);assert.equal(snap.vehicleRegistrySnapshot.vehicle('BUS-2').status,'route_only');
  assert(snap.vehicleContinuitySnapshot);assert.equal(snap.vehicleContinuitySnapshot.vehicle('BUS-1').presentInLatestFeed,true);
  assert.equal(snap.inputSummary.registryVehicles,snap.vehicleStates.length);
  assert.equal(snap.inputSummary.continuityVehicles,snap.vehicleContinuitySnapshot.entries.length);
});

check('partial snapshots do not overwrite authoritative registry or continuity',()=>{
  const currentRegistry=vehicleRegistry.current(plan.provider,plan.network);
  const currentContinuity=vehicleContinuity.snapshot(plan.provider,plan.network,{now});
  const partial=engine.snapshot({observations:[observations[4]],resolutions:[resolutions[4]],now:now+1});
  assert.equal(partial.vehicleContinuitySnapshot,null);
  assert.strictEqual(vehicleRegistry.current(plan.provider,plan.network),currentRegistry);
  const after=vehicleContinuity.snapshot(plan.provider,plan.network,{now:now+1});
  assert.equal(after.entries.length,currentContinuity.entries.length);
  assert.equal(after.vehicle('BUS-1').lastMatchedTripInstanceId,currentContinuity.vehicle('BUS-1').lastMatchedTripInstanceId);
});

check('snapshot indexes and rows are immutable views',()=>{
  assert(Object.isFrozen(snap));assert(Object.isFrozen(snap.tripStates));assert(Object.isFrozen(snap.byTripInstanceId));
});

check('likely_missing is not inferred when the network has no fresh matched evidence',()=>{
  const empty=engine.snapshot({observations:[],resolutions:[],now});
  assert.equal(empty.trip(plan.getTrip('20260930','T_MISSING').id).status,'expected_unobserved');
});

check('stale matched observation is retained but does not count as observed',()=>{
  const old=[{id:'old',provider:'actv-official',network:'aut',kind:'vehicle_position',observedAt:now-600,externalVehicleId:'OLD'}];
  const rr=[{observationId:'old',classification:'exact',matched:true,tripInstanceId:plan.getTrip('20260930','T_UNOBS').id,routeId:'R1',confidence:1}];
  const x=engine.snapshot({observations:old,resolutions:rr,now}).trip(plan.getTrip('20260930','T_UNOBS').id);
  assert.equal(x.status,'expected_unobserved');assert.equal(x.observationIds.length,1);assert(x.observationAgeSec>=600);
});

check('out-of-scope observations are excluded from the state snapshot',()=>{
  const foreign=[...observations,{id:'foreign',provider:'other',network:'aut',kind:'vehicle_position',observedAt:now,externalVehicleId:'FOREIGN'}];
  const x=engine.snapshot({observations:foreign,resolutions,now});
  assert.equal(x.vehicle('FOREIGN'),null);assert.equal(x.inputSummary.observations,observations.length);
});

check('engine can invoke supplied IdentityResolver when resolutions are omitted',()=>{
  const fake={resolveBatch(obs){return obs.map(o=>({observationId:o.id,classification:'unknown',matched:false,confidence:0}))}};
  const local=T.createTransitStateEngine({servicePlan:plan,expectedPosition:expected,identityResolver:fake});
  const x=local.snapshot({observations:[observations[4]],now});
  assert.equal(x.inputSummary.resolutions,1);assert.equal(x.vehicleStates.length,1);
});

check('summary reports state distribution without introducing 8.12 KPI semantics',()=>{
  const s=snap.summary();
  assert.equal(s.trips.observed,1);assert.equal(s.trips.cancelled,1);assert.equal(s.trips.likely_missing,1);
  assert.equal(s.vehicles.matched,1);assert.equal(s.vehicles.route_only,1);
});

console.log('RESULT: '+n+' transit-state-engine checks passed.');
