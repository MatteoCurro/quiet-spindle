const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const context={window:null,Intl,Date,Map,Set,console};context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/actv/realtime-normalizer.js'),'utf8'),context);
const N=context.UVTransitACTVNormalizer;

const core={schema:1,network:'aut',routes:[
 {id:'R1',short:'1',long:'Linea 1',desc:'UM',type:3},{id:'R2',short:'2',long:'Linea 2',desc:'ES',type:3}
],trips:[
 {id:'STATIC-A',routeId:'R1',directionId:0,shapeId:'S1'},
 {id:'STATIC-B',routeId:'R1',directionId:0,shapeId:'S1'},
 {id:'STATIC-C',routeId:'R2',directionId:1,shapeId:'S2'},
 {id:'STATIC-D',routeId:'R1',directionId:0,shapeId:'S1'},
 {id:'AUT_ACTV_787_777',routeId:'R1',directionId:0,shapeId:'S1'}
],stops:[
 {id:'A',lat:45.0000,lon:12.0000},{id:'B',lat:45.0010,lon:12.0000},
 {id:'C',lat:45.0020,lon:12.0000},{id:'X',lat:45.0010,lon:12.0100}
]};
const schedule={schema:2,network:'aut',days:['20260928'],chunksData:{
 '20260928':{schema:2,network:'aut',day:'20260928',trips:[
  ['STATIC-A','R1','Centro','S1',[['A',1,28800,28800,1,1],['B',2,29400,29400,1,1],['C',3,30000,30000,1,1]]],
  ['STATIC-B','R1','Centro','S1',[['A',1,32400,32400,1,1],['B',2,33000,33000,1,1],['C',3,33600,33600,1,1]]],
  ['STATIC-C','R2','Altro','S2',[['A',1,28800,28800,1,1],['X',2,29400,29400,1,1]]]
 ]}}
};
const matcher=N.createMatcher({network:'aut',core,schedule});
const t=s=>Math.floor(new Date(s).getTime()/1000);
const tuFeed={header:{timestamp:t('2026-09-28T08:05:00+02:00')},entity:[
 {id:'u1',tripUpdate:{trip:{tripId:'RAW-42',routeId:'UPSTREAM-1',directionId:0,startDate:'20260928'},vehicle:{id:'BUS-42'},delay:60,stopTimeUpdate:[
  {stopId:'A',stopSequence:1,arrival:{time:t('2026-09-28T08:01:00+02:00'),delay:60}},
  {stopId:'B',stopSequence:2,arrival:{time:t('2026-09-28T08:11:00+02:00'),delay:60}},
  {stopId:'C',stopSequence:3,arrival:{time:t('2026-09-28T08:21:00+02:00'),delay:60}}
 ]}},
 {id:'exact',tripUpdate:{trip:{tripId:'STATIC-C',routeId:'R2',directionId:1,startDate:'20260928'},stopTimeUpdate:[
  {stopId:'A',stopSequence:1,arrival:{time:t('2026-09-28T08:00:00+02:00')}}
 ]}},
 {id:'ambiguous',tripUpdate:{trip:{tripId:'RAW-AMB'},stopTimeUpdate:[{stopId:'A'}]}}
]};
const vpFeed={header:{timestamp:t('2026-09-28T08:06:00+02:00')},entity:[
 {id:'v1',vehicle:{trip:{tripId:'VP-OTHER',routeId:'UPSTREAM-1'},vehicle:{id:'BUS-42'},position:{latitude:45.49,longitude:12.24},timestamp:t('2026-09-28T08:06:00+02:00')}},
 {id:'v2',vehicle:{trip:{tripId:'RAW-V2',routeId:'R2',directionId:1},stopId:'X',currentStopSequence:2,position:{latitude:45.5,longitude:12.3},timestamp:t('2026-09-28T08:10:30+02:00')}}
]};
const out=N.normalizePair(matcher,tuFeed,vpFeed);
const gpsMatcher=N.createMatcher({network:'aut',core,schedule});
const gpsTime=t('2026-09-28T08:11:00+02:00');
const gpsMatched=N.normalizeVehiclePositions(gpsMatcher,{header:{timestamp:gpsTime},entity:[
 {id:'gps-ok',vehicle:{trip:{},vehicle:{id:'GPS-1'},position:{latitude:45.00101,longitude:12.00001},timestamp:gpsTime}}
]});
const ambiguousTime=t('2026-09-28T08:40:00+02:00');
const gpsAmbiguous=N.normalizeVehiclePositions(N.createMatcher({network:'aut',core,schedule}),{header:{timestamp:ambiguousTime},entity:[
 {id:'gps-amb',vehicle:{trip:{},vehicle:{id:'GPS-2'},position:{latitude:45.00101,longitude:12.00001},timestamp:ambiguousTime}}
]});
const shapeCore={schema:1,network:'aut',routes:[
 {id:'RG',short:'G',long:'Linea geometrica',desc:'UM',type:3}
],trips:[
 {id:'GS1',routeId:'RG',directionId:0,shapeId:'LONG'},
 {id:'GS2',routeId:'RG',directionId:0,shapeId:'LONG'}
],stops:[
 {id:'P',lat:45.0000,lon:12.0000},{id:'Q',lat:45.0400,lon:12.0000}
]};
const shapeSchedule={schema:2,network:'aut',days:['20260928'],chunksData:{
 '20260928':{schema:2,network:'aut',day:'20260928',trips:[
  ['GS1','RG','Nord','LONG',[['P',1,28800,28800,1,1],['Q',2,31200,31200,1,1]]],
  ['GS2','RG','Nord','LONG',[['P',1,32400,32400,1,1],['Q',2,34800,34800,1,1]]]
 ]}}
};
const shapeMatcher=N.createMatcher({network:'aut',core:shapeCore,schedule:shapeSchedule,shapes:{
 LONG:[[45.0000,12.0000],[45.0100,12.0000],[45.0200,12.0000],[45.0300,12.0000],[45.0400,12.0000]]
}});
const shapeTime=t('2026-09-28T08:10:00+02:00');
const shapeMatched=N.normalizeVehiclePositions(shapeMatcher,{header:{timestamp:shapeTime},entity:[
 {id:'shape-mid',vehicle:{trip:{},vehicle:{id:'GPS-SHAPE'},position:{latitude:45.01002,longitude:12.00001,bearing:0,speed:10},timestamp:shapeTime}}
]});
const stopAliasTu=N.normalizeTripUpdates(N.createMatcher({network:'aut',core,schedule}),{entity:[
 {id:'stop-alias-tu',tripUpdate:{trip:{tripId:'STATIC-A',routeId:'R1',startDate:'20260928'},stopTimeUpdate:[
  {stopId:'OLD-B',stopSequence:2,arrival:{time:t('2026-09-28T08:10:00+02:00')}}
 ]}}
]});
const stopAliasVp=N.normalizeVehiclePositions(N.createMatcher({network:'aut',core,schedule}),{entity:[
 {id:'stop-alias-vp',vehicle:{trip:{tripId:'STATIC-A',routeId:'R1',startDate:'20260928'},stopId:'OLD-B',currentStopSequence:2,position:{latitude:45.001,longitude:12},timestamp:t('2026-09-28T08:10:00+02:00')}}
]});
const routeOnly=N.normalizeVehiclePositions(N.createMatcher({network:'aut',core,schedule}),{entity:[
 {id:'route-only',vehicle:{trip:{tripId:'UNKNOWN',routeId:'1_UM'},vehicle:{id:'ROUTE-1'},position:{latitude:45.5,longitude:12.5},timestamp:t('2026-09-28T12:00:00+02:00')}}
]});
const wrapped=N.normalizeTripUpdates(matcher,{entity:[
 {tripUpdate:{trip:{tripId:'AUT_ACTV_786_STATIC-B',routeId:'1_UM',startDate:'20260928'},stopTimeUpdate:[]}}
]});
const coreOnly=N.normalizeTripUpdates(matcher,{header:{timestamp:t('2026-09-28T08:00:00+02:00')},entity:[
 {tripUpdate:{trip:{tripId:'AUT_ACTV_786_STATIC-D',routeId:'1_UM',directionId:0,startDate:'20260928'},stopTimeUpdate:[]}}
]});
const generationShift=N.normalizeTripUpdates(matcher,{entity:[
 {tripUpdate:{trip:{tripId:'AUT_ACTV_786_777',routeId:'1_UM',directionId:0,startDate:'20260928'},stopTimeUpdate:[]}}
]});
const publicRoute=N.normalizeTripUpdates(matcher,{entity:[
 {tripUpdate:{trip:{tripId:'AUT_ACTV_786_MISSING',routeId:'1_UM',directionId:0,startTime:'08:00:00',startDate:'20260928'},stopTimeUpdate:[]}}
]});
let n=0;const check=(name,fn)=>{fn();console.log('PASS '+name);n++};
check('schedule/time remaps upstream trip',()=>{const tr=out.tripUpdates.entity[0].tripUpdate.trip;assert.equal(tr.tripId,'STATIC-A');assert.equal(tr.routeId,'R1')});
check('exact static trip stays exact',()=>assert.equal(out.tripUpdates.entity[1].tripUpdate.trip.tripId,'STATIC-C'));
check('ambiguous weak update is not force-matched',()=>assert.equal(out.tripUpdates.entity[2].tripUpdate.trip.tripId,'RAW-AMB'));
check('vehicle descriptor links VP to normalized TU even with a different upstream trip id',()=>{assert.equal(out.vehiclePositions.entity[0].vehicle.trip.tripId,'STATIC-A');assert.equal(out.stats.vehiclePositions.vehicleId,1)});
check('vehicle can match by stop sequence, route and time',()=>assert.equal(out.vehiclePositions.entity[1].vehicle.trip.tripId,'STATIC-C'));
check('coverage stats expose reconciliation quality',()=>{assert.equal(out.stats.tripUpdates.matched,2);assert.equal(out.stats.tripUpdates.unmatched,1);assert.equal(out.stats.vehiclePositions.matched,2);assert(out.stats.correlatedTrips>=2)});
check('source feeds are not mutated',()=>{assert.equal(tuFeed.entity[0].tripUpdate.trip.tripId,'RAW-42');assert.equal(vpFeed.entity[0].vehicle.trip.tripId,'VP-OTHER')});
check('wrapped ACTV trip id maps directly to static id',()=>{assert.equal(wrapped.feed.entity[0].tripUpdate.trip.tripId,'STATIC-B');assert.equal(wrapped.stats.coreAlias,1)});
check('GPS fallback matches only a spatially and temporally isolated automotive trip',()=>{assert.equal(gpsMatched.feed.entity[0].vehicle.trip.tripId,'STATIC-A');assert.equal(gpsMatched.stats.gps,1)});
check('GPS fallback rejects temporally ambiguous service',()=>{assert.equal(gpsAmbiguous.feed.entity[0].vehicle.trip.tripId,undefined);assert.equal(gpsAmbiguous.stats.matched,0)});
check('shape GPS fallback matches a vehicle between distant stops',()=>{assert.equal(shapeMatched.feed.entity[0].vehicle.trip.tripId,'GS1');assert.equal(shapeMatched.stats.shapeGps,1)});
check('shape GPS candidate is not credited to near-stop GPS',()=>assert.equal(shapeMatched.stats.gps,0));
check('route-only vehicle is preserved without inventing a trip',()=>{const tr=routeOnly.feed.entity[0].vehicle.trip;assert.equal(tr.tripId,'UNKNOWN');assert.equal(tr.routeId,'R1');assert.equal(tr._uvRouteOnly,true);assert.equal(routeOnly.stats.routeOnly,1);assert.equal(routeOnly.stats.matched,0);assert.equal(routeOnly.stats.displayable,1);assert.equal(routeOnly.stats.displayCoveragePct,100)});
check('validated stop sequence rewrites a stale TripUpdate stop id',()=>{const u=stopAliasTu.feed.entity[0].tripUpdate.stopTimeUpdate[0];assert.equal(u.stopId,'B');assert.equal(stopAliasTu.stats.stopIdsRewritten,1)});
check('validated stop sequence rewrites a stale VehiclePosition stop id',()=>{const v=stopAliasVp.feed.entity[0].vehicle;assert.equal(v.stopId,'B');assert.equal(stopAliasVp.stats.stopIdsRewritten,1)});

check('shape index excludes inactive shapes',()=>{const idx=N._test.buildShapeIndex({ACTIVE:[[45,12],[45.01,12]],INACTIVE:[[45,12.1],[45.01,12.1]]},new Set(['ACTIVE']));assert(idx.metas.has('ACTIVE'));assert(!idx.metas.has('INACTIVE'))});
check('wrapped ACTV id can map to a core trip outside the active schedule window',()=>{assert.equal(coreOnly.feed.entity[0].tripUpdate.trip.tripId,'STATIC-D');assert.equal(coreOnly.feed.entity[0].tripUpdate.trip.routeId,'R1');assert.equal(coreOnly.feed.entity[0].tripUpdate.timestamp,t('2026-09-28T08:00:00+02:00'))});
check('ACTV publication generation changes do not change logical trip identity',()=>{assert.equal(generationShift.feed.entity[0].tripUpdate.trip.tripId,'AUT_ACTV_787_777');assert.equal(generationShift.stats.coreAlias,1)});
check('natural trip tail ignores ACTV publication generation',()=>{assert.equal(N._test.naturalTripTail('AUT_ACTV_787_18836'),'18836');assert.equal(N._test.naturalTripTail('NAV_ACTV_648_101'),'101')});
check('ACTV public route key maps short name plus sector',()=>{assert.equal(publicRoute.feed.entity[0].tripUpdate.trip.tripId,'STATIC-A');assert.equal(publicRoute.feed.entity[0].tripUpdate.trip.routeId,'R1')});
check('wrapped trip parser only unwraps versioned ACTV ids',()=>{assert.equal(N._test.wrappedTripId('AUT_ACTV_786_18836'),'18836');assert.equal(N._test.wrappedTripId('18836'),'')});
console.log(`RESULT: ${n} ACTV normalizer checks passed.`);
