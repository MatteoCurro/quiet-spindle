const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Date,Map,Object,Array,Number,String,Error,Math});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/observations.js','utf8'),ctx);
const O=window.UVTransitObservations;
let n=0;const check=(name,fn)=>{fn();console.log('PASS '+name);n++};

const received=1780000010;
const vpFeed={header:{gtfsRealtimeVersion:'2.0',incrementality:0,timestamp:1780000000},entity:[
  {id:'vp-full',vehicle:{
    trip:{tripId:'RAW-T1',routeId:'RAW-R1',startDate:'20260928',startTime:'08:00:00',directionId:1,scheduleRelationship:0},
    vehicle:{id:'BUS-12',label:'12'},position:{latitude:45.493,longitude:12.244,bearing:123.5,speed:8.25,odometer:1200},
    currentStopSequence:7,currentStatus:2,timestamp:1780000002,stopId:'STOP7',
    congestionLevel:1,occupancyStatus:2,occupancyPercentage:63
  }},
  {id:'vp-incomplete',vehicle:{trip:{tripId:'UNKNOWN'},timestamp:1780000003}},
  {id:'gone',isDeleted:true}
]};
const tuFeed={header:{gtfsRealtimeVersion:'2.0',timestamp:1780000000},entity:[
  {id:'tu-1',tripUpdate:{
    trip:{tripId:'RAW-T1',routeId:'RAW-R1',startDate:'20260928',directionId:1},
    vehicle:{id:'BUS-12'},timestamp:1780000001,delay:-30,
    stopTimeUpdate:[
      {stopSequence:7,stopId:'STOP7',arrival:{delay:-45,time:1780000300},departure:{time:1780000330}},
      {stopSequence:8,stopId:'STOP8',scheduleRelationship:1}
    ]
  }},
  {id:'tu-route-only',tripUpdate:{trip:{routeId:'RAW-R2'},stopTimeUpdate:[]}}
]};

const batch=O.fromGtfsRealtimeFeeds({
  provider:'actv-official',network:'aut',vehiclePositions:vpFeed,tripUpdates:tuFeed,receivedAt:received
});

check('vehicle position maps canonical identity and kinematics',()=>{
  const o=batch.vehiclePositions.find(x=>x.provenance.entityId==='vp-full');
  assert.equal(o.kind,'vehicle_position');assert.equal(o.externalVehicleId,'BUS-12');
  assert.equal(o.externalTripId,'RAW-T1');assert.equal(o.externalRouteId,'RAW-R1');
  assert.equal(o.serviceDate,'20260928');assert.equal(o.directionId,1);
  assert.equal(o.observedAt,1780000002);assert.equal(o.receivedAt,received);
  assert.deepEqual({...o.position},{lat:45.493,lon:12.244});
  assert.equal(o.bearing,123.5);assert.equal(o.speed,8.25);
  assert.equal(o.stopId,'STOP7');assert.equal(o.stopSequence,7);
});
check('upstream occupancy is preserved as details, not promoted to canonical crowding yet',()=>{
  const o=batch.vehiclePositions.find(x=>x.provenance.entityId==='vp-full');
  assert.equal(o.details.occupancyStatus,2);assert.equal(o.details.occupancyPercentage,63);
});
check('incomplete unknown vehicle observation is preserved without invented fields',()=>{
  const o=batch.vehiclePositions.find(x=>x.provenance.entityId==='vp-incomplete');
  assert(o);assert.equal(o.externalTripId,'UNKNOWN');assert.equal(o.externalRouteId,null);
  assert.equal(o.externalVehicleId,null);assert.equal(o.position,null);assert.equal(o.stopId,null);
});
check('deleted GTFS-RT entity is preserved explicitly',()=>{
  const o=batch.vehiclePositions.find(x=>x.kind==='entity_deleted');
  assert(o);assert.equal(o.provenance.entityId,'gone');assert.equal(o.provenance.isDeleted,true);
});
check('trip update preserves top-level delay and stop updates',()=>{
  const o=batch.tripUpdates.find(x=>x.provenance.entityId==='tu-1');
  assert.equal(o.kind,'trip_update');assert.equal(o.delay,-30);assert.equal(o.externalVehicleId,'BUS-12');
  assert.equal(o.stopId,'STOP7');assert.equal(o.stopSequence,7);assert.equal(o.stopTimeUpdates.length,2);
  assert.equal(o.stopTimeUpdates[0].arrival.delay,-45);assert.equal(o.stopTimeUpdates[1].scheduleRelationship,1);
});
check('route-only trip update remains a valid incomplete observation',()=>{
  const o=batch.tripUpdates.find(x=>x.provenance.entityId==='tu-route-only');
  assert(o);assert.equal(o.externalTripId,null);assert.equal(o.externalRouteId,'RAW-R2');
});
check('feed header timestamp is fallback observedAt',()=>{
  const o=batch.tripUpdates.find(x=>x.provenance.entityId==='tu-route-only');
  assert.equal(o.observedAt,1780000000);
});
check('source feeds are never mutated',()=>{
  assert.equal(vpFeed.entity[0].vehicle.trip.tripId,'RAW-T1');
  assert.equal(tuFeed.entity[0].tripUpdate.stopTimeUpdate[0].stopId,'STOP7');
});
check('ObservationStore keeps current feed snapshot and replaces old scope',()=>{
  const store=new O.ObservationStore();store.ingestGtfsRealtime(batch);
  assert.equal(store.summary().observations,5);
  const newer=O.fromGtfsRealtimeFeeds({
    provider:'actv-official',network:'aut',
    vehiclePositions:{header:{timestamp:1780000100},entity:[{id:'vp-new',vehicle:{vehicle:{id:'BUS-99'},timestamp:1780000101}}]},
    tripUpdates:{header:{timestamp:1780000100},entity:[]},receivedAt:1780000110
  });
  store.ingestGtfsRealtime(newer);
  assert.equal(store.summary().observations,1);
  assert.equal(store.all()[0].externalVehicleId,'BUS-99');
  assert.equal(store.query({kind:'vehicle_position',externalVehicleId:'BUS-99'}).length,1);
});
check('invalid coordinates do not become a canonical position',()=>{
  const x=O.fromGtfsRealtimeFeed({
    provider:'x',network:'n',feedKind:'vehicle_positions',receivedAt:10,
    feed:{entity:[{vehicle:{position:{latitude:999,longitude:12}}}]}
  });
  assert.equal(x[0].position,null);
});
check('canonical observation ids are deterministic for same source entity and timestamp',()=>{
  const a=batch.vehiclePositions[0],b=O.fromGtfsRealtimeFeeds({
    provider:'actv-official',network:'aut',vehiclePositions:vpFeed,tripUpdates:tuFeed,receivedAt:received+10
  }).vehiclePositions[0];
  assert.equal(a.id,b.id);
});
console.log('RESULT: '+n+' observation-model checks passed.');
