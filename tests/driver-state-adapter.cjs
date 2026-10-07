const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Intl,Date,Map,Set,Object,Array,Number,String,Error,Math});
for(const file of ['gtfs.js','service-plan.js','expected-position.js','identity-resolver.js','delay-position.js','prediction.js','motion-state.js','transit-state-engine.js','driver-state-adapter.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);

const S=window.UVTransitServicePlan,E=window.UVTransitExpectedPosition,I=window.UVTransitIdentityResolver;
const D=window.UVTransitDelayPosition,M=window.UVTransitMotionState,T=window.UVTransitState,A=window.UVTransitDriverState;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}
const at=s=>Date.parse(s)/1000;

const stops=[
 {id:'A',name:'A',code:'A1',lat:45.0000,lon:12.0000},
 {id:'B',name:'B',code:'B2',lat:45.0100,lon:12.0000},
 {id:'C',name:'C',code:'C3',lat:45.0200,lon:12.0000},
 {id:'X',name:'X',code:'X1',lat:45.0000,lon:12.0400},
 {id:'Y',name:'Y',code:'Y2',lat:45.0100,lon:12.0400},
 {id:'Z',name:'Z',code:'Z3',lat:45.0200,lon:12.0400}
];
const core={schema:1,network:'aut',
 routes:[{id:'R8',short:'8AE',long:'Linea 8AE',desc:'UM',type:3}],
 stops,
 trips:[
  {id:'T-NEAR',routeId:'R8',directionId:'0',headsign:'MOGLIANO FS prosegue per CASALE',shapeId:'SN',blockId:''},
  {id:'T-FAR',routeId:'R8',directionId:'0',headsign:'MOGLIANO FS prosegue per CASALE',shapeId:'SF',blockId:''}
 ]
};
const schedule={schema:2,network:'aut',timezone:'Europe/Rome',
 routes:[['R8','8AE',3]],
 stops:stops.map(s=>[s.id,s.name,s.lat,s.lon,'']),
 snapshotByDay:{'20260930':'snap'},
 chunksData:{'20260930':{trips:[
  ['T-NEAR','R8','MOGLIANO FS prosegue per CASALE','SN',[
   ['A',1,28800,28800,1,0],['B',2,29400,29400,1,1],['C',3,30000,30000,1,1]
  ]],
  ['T-FAR','R8','MOGLIANO FS prosegue per CASALE','SF',[
   ['X',1,28800,28800,1,0],['Y',2,29400,29400,1,1],['Z',3,30000,30000,1,1]
  ]]
 ]}}
};
const plan=S.createServicePlan({provider:'actv-official',network:'aut',core,schedule,coreBySnapshot:{snap:core}});
const expected=E.createExpectedPositionModel({servicePlan:plan,shapesBySnapshot:{snap:{
 SN:[[45.0000,12.0000],[45.0100,12.0000],[45.0200,12.0000]],
 SF:[[45.0000,12.0400],[45.0100,12.0400],[45.0200,12.0400]]
}}});
const identity=I.createIdentityResolver({servicePlan:plan,expectedPosition:expected});
const delay=D.createDelayPositionModel({servicePlan:plan,expectedPosition:expected});
const motion=M.createMotionStateModel({servicePlan:plan,expectedPosition:expected,delayPosition:delay});
const state=T.createTransitStateEngine({servicePlan:plan,expectedPosition:expected,identityResolver:identity,delayPosition:delay,motionState:motion});
const adapter=A.createDriverStateAdapter({servicePlan:plan,expectedPosition:expected,identityResolver:identity,transitStateEngine:state});
const now=at('2026-09-30T08:10:00+02:00');
const near=plan.getTrip('20260930','T-NEAR'),far=plan.getTrip('20260930','T-FAR');

check('route candidates come from ServicePlan and preserve both plausible runs',()=>{
 const rows=adapter.routeCandidates('8AE',now);
 assert.equal(rows.length,2);assert(rows.some(x=>x.id===near.id));assert(rows.some(x=>x.id===far.id));
});

check('driver GPS is canonical observation with explicit driver provenance',()=>{
 const o=A._test.driverObservation({
  servicePlan:plan,gps:{lat:45.0102,lon:12,timestamp:now*1000,speed:8,accuracy:12},
  routeHint:'8AE',now
 });
 assert.equal(o.kind,'vehicle_position');assert.equal(o.provider,'actv-official');
 assert.equal(o.provenance.format,'driver-gps');assert.equal(o.details.sourceKind,'driver_device');
 assert.equal(o.observedAt,now);assert.equal(o.externalRouteId,'8AE');
});

check('candidate restriction plus shared IdentityResolver selects the geographically coherent trip',()=>{
 const x=adapter.resolve({
  gps:{lat:45.0102,lon:12,timestamp:now*1000,speed:8,accuracy:12},
  routeHint:'8AE',candidateTripInstanceIds:[near.id,far.id],now
 });
 assert.equal(x.matched,true);assert.equal(x.trip.tripInstanceId,near.id);
 assert(['gps_shape_matched','gps_stop_matched','trip_matched'].includes(x.resolution.classification));
});

check('driver state is produced by canonical TransitState with driver GPS provenance',()=>{
 const x=adapter.resolve({
  gps:{lat:45.0102,lon:12,timestamp:now*1000,speed:8,accuracy:12},
  routeHint:'8AE',candidateTripInstanceIds:[near.id,far.id],now
 });
 assert(x.tripState);assert.equal(x.tripState.status,'observed');
 assert.equal(x.tripState.position.source,'driver_gps_position');
 assert.equal(x.motion.mode,'live');
 assert.equal(x.delay.source,'position_derived');
});

check('next stop and following stop derive from canonical shape progress',()=>{
 const x=adapter.resolve({
  gps:{lat:45.01005,lon:12,timestamp:now*1000,speed:6,accuracy:10},
  routeHint:'8AE',candidateTripInstanceIds:[near.id],now
 });
 assert.equal(x.nextStop.id,'B');assert.equal(x.nextStop.code,'B2');
 assert.equal(x.followingStop.id,'C');assert.equal(x.followingStop.code,'C3');
});

check('next-stop index advances monotonically after passing a stop',()=>{
 const x=adapter.resolve({
  gps:{lat:45.0110,lon:12,timestamp:(now+60)*1000,speed:7,accuracy:10},
  routeHint:'8AE',selectedTripInstanceId:near.id,previousNextStopIndex:1,now:now+60
 });
 assert.equal(x.trip.tripInstanceId,near.id);assert.equal(x.nextStop.id,'C');
});

check('explicit selected TripInstance locks identity while GPS remains progress evidence',()=>{
 const x=adapter.resolve({
  gps:{lat:45.0098,lon:12,timestamp:now*1000,speed:5,accuracy:9},
  routeHint:'8AE',selectedTripInstanceId:near.id,now
 });
 assert.equal(x.resolution.classification,'exact');assert.equal(x.resolution.tripInstanceId,near.id);
});

check('route distance uses the shared ExpectedPosition geometry',()=>{
 const x=adapter.resolve({
  gps:{lat:45.0102,lon:12,timestamp:now*1000,speed:8,accuracy:12},
  routeHint:'8AE',selectedTripInstanceId:near.id,now
 });
 assert(x.routeDistanceM<50);assert.equal(x.offRouteCandidate,false);
});

check('far driver GPS is retained but marked as off-route candidate',()=>{
 const x=adapter.resolve({
  gps:{lat:45.0100,lon:12.0100,timestamp:now*1000,speed:8,accuracy:12},
  routeHint:'8AE',selectedTripInstanceId:near.id,now
 });
 assert.equal(x.matched,true);assert(x.routeDistanceM>105);assert.equal(x.offRouteCandidate,true);
 assert.equal(x.progressReliable,false);assert.equal(x.shapeProgress,null);
 assert.equal(x.tripState.position.source,'driver_gps_position');
});

check('single explicit candidate can be locked only after normal resolver remains inconclusive',()=>{
 const x=adapter.resolve({
  gps:{lat:45.0100,lon:12.02,timestamp:now*1000,speed:null,accuracy:15},
  routeHint:'8AE',candidateTripInstanceIds:[near.id],now
 });
 assert.equal(x.matched,true);assert.equal(x.trip.tripInstanceId,near.id);
});

check('missing GPS does not invent a trip or a position',()=>{
 const x=adapter.resolve({routeHint:'8AE',candidateTripInstanceIds:[near.id],now});
 assert.equal(x.matched,false);assert.equal(x.reason,'gps_unavailable');
 assert.equal(x.trip,null);assert.equal(x.motion,null);
});

check('trip view contains canonical scheduled stop times and display route',()=>{
 const v=A._test.tripView(near);
 assert.equal(v.route,'8AE');assert.equal(v.headsign,'MOGLIANO FS prosegue per CASALE');
 assert.equal(v.stops[1].plannedArrival,near.stops[1].plannedArrival);
});

console.log('RESULT: '+n+' driver-state-adapter checks passed.');
