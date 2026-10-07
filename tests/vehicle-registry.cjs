const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Date,Map,Object,Array,Number,String,Math});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/vehicle-registry.js','utf8'),ctx);
const R=window.UVTransitVehicleRegistry;let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}
const registry=R.createVehicleRegistry(),now=1000;
const observations=[
{id:'tu-match',provider:'p',network:'n',kind:'trip_update',observedAt:970,externalVehicleId:'BUS-1',externalTripId:'T1',externalRouteId:'R1'},
{id:'vp-match',provider:'p',network:'n',kind:'vehicle_position',observedAt:980,externalVehicleId:'BUS-1',position:{lat:45,lon:12}},
{id:'vp-route',provider:'p',network:'n',kind:'vehicle_position',observedAt:985,externalVehicleId:'BUS-2',externalRouteId:'R2',position:{lat:45.1,lon:12.1}},
{id:'vp-service',provider:'p',network:'n',kind:'vehicle_position',observedAt:990,externalVehicleId:'BUS-3',externalTripId:'RAW-T',position:{lat:45.2,lon:12.2}},
{id:'vp-anon',provider:'p',network:'n',kind:'vehicle_position',observedAt:995,position:{lat:45.3,lon:12.3}},
{id:'deleted',provider:'p',network:'n',kind:'entity_deleted',observedAt:996,externalVehicleId:'BUS-DELETED'}];
const resolutions=[
{observationId:'tu-match',classification:'exact',matched:true,tripInstanceId:'p:n:d:T1',routeId:'R1',confidence:1,alternatives:[]},
{observationId:'vp-match',classification:'vehicle_correlated',matched:true,tripInstanceId:'p:n:d:T1',routeId:'R1',confidence:.95,alternatives:[]},
{observationId:'vp-route',classification:'route_only',matched:false,tripInstanceId:null,routeId:'R2',confidence:.8,alternatives:[{tripInstanceId:'candidate',score:20}]},
{observationId:'vp-service',classification:'unknown',matched:false,tripInstanceId:null,routeId:null,confidence:0,alternatives:[]},
{observationId:'vp-anon',classification:'unknown',matched:false,tripInstanceId:null,routeId:null,confidence:0,alternatives:[]}];
const snap=registry.replace({provider:'p',network:'n',observations,resolutions,now});
check('matched observations are grouped',()=>{const v=snap.vehicle('BUS-1');assert(v);assert.equal(v.status,'matched');assert.equal(v.tripInstanceId,'p:n:d:T1');assert.deepEqual([...v.observationIds],['tu-match','vp-match']);assert.deepEqual({...v.position},{lat:45,lon:12})});
check('route-only is retained with route and alternatives',()=>{const v=snap.vehicle('BUS-2');assert.equal(v.status,'route_only');assert.equal(v.routeId,'R2');assert.equal(v.alternatives[0].tripInstanceId,'candidate')});
check('unknown trip evidence becomes service_unknown',()=>{const v=snap.vehicle('BUS-3');assert(v);assert.equal(v.status,'service_unknown');assert.equal(v.externalTripId,'RAW-T')});
check('anonymous VehiclePosition is preserved',()=>{const v=snap.vehicle('anonymous:vp-anon');assert(v);assert.equal(v.status,'unknown');assert.equal(v.anonymous,true)});
check('deleted entity is not current',()=>assert.equal(snap.vehicle('BUS-DELETED'),null));
check('summary exposes unresolved classes',()=>{const s=snap.summary();assert.equal(s.vehicles,4);assert.equal(s.unresolved,3);assert.equal(s.statuses.route_only,1);assert.equal(s.statuses.service_unknown,1);assert.equal(s.statuses.unknown,1)});
check('build is pure and does not replace current feed',()=>{const built=registry.build({provider:'p',network:'n',observations:[observations[1]],resolutions:[resolutions[1]],now:1005});assert.equal(built.entries.length,1);assert.equal(built.vehicle('BUS-2'),null);assert.strictEqual(registry.current('p','n'),snap)});
check('replace semantics have no hidden history',()=>{const next=registry.replace({provider:'p',network:'n',observations:[observations[1]],resolutions:[resolutions[1]],now:1010});assert.equal(next.entries.length,1);assert.equal(next.vehicle('BUS-2'),null);assert.strictEqual(registry.current('p','n'),next)});
check('scopes are isolated',()=>{const other=registry.replace({provider:'other',network:'x',observations:[{id:'x',provider:'other',network:'x',kind:'vehicle_position',observedAt:1000,externalVehicleId:'X'}],resolutions:[],now});assert(other.vehicle('X'));assert(registry.current('p','n').vehicle('BUS-1'));assert.equal(registry.current('p','n').vehicle('X'),null)});
check('snapshot is immutable',()=>{assert(Object.isFrozen(snap));assert(Object.isFrozen(snap.entries));assert(Object.isFrozen(snap.entries[0]))});
console.log('RESULT: '+n+' vehicle-registry checks passed.');
