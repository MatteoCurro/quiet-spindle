const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Object,Array,String,Number,Map,Math,Error});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/transit-metrics.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/source-quality-monitor.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/transit-read-api.js','utf8'),ctx);

const calls=[];
const snapshot={
 provider:'p',network:'aut',generatedAt:10,
 tripStates:[
  {tripInstanceId:'T1',routeId:'R1',active:true,status:'observed',freshestObservedAt:9},
  {tripInstanceId:'T2',routeId:'R1',active:true,status:'expected_unobserved',freshestObservedAt:null}
 ],
 vehicleStates:[{vehicleId:'V1',status:'matched'}],
 inputSummary:{observations:2,resolutions:2,matchedResolutions:1},
 vehicleRegistrySnapshot:{entries:[1]},vehicleContinuitySnapshot:{entries:[1]},
 summary(){return {tripStates:2,vehicleStates:1}}
};
const events={summary(){return {active:1}}};
const adapter={routeCandidates:(route,now)=>[{id:route+':'+now}],resolve:input=>({matched:true,input})};
const source={
 loadRuntimeManifest:async()=>{calls.push('manifest');return {m:1}},
 loadRuntimeCore:async(...a)=>{calls.push(['core',...a]);return {data:{}}},
 loadRuntimeShapes:async(...a)=>{calls.push(['shapes',...a]);return {data:{}}},
 loadRuntimeSchedule:async(...a)=>{calls.push(['schedule',...a]);return {data:{}}},
 loadStaticGtfs:async n=>{calls.push(['static',n]);return 'blob'},
 loadVehiclePositions:async n=>{calls.push(['vp',n]);return {entity:[1]}},
 loadTripUpdates:async n=>{calls.push(['tu',n]);return {entity:[2]}},
 loadTransitState:async(n,m,d,now)=>{calls.push(['state',n,m,d,now]);return {provider:'p',network:n,receivedAt:9,snapshot,observationHistorySummary:{provider:'p',network:n,entries:7,batches:2,kinds:{vehicle_position:4,trip_update:3},ingested:7,deduplicated:5,rejectedPrivate:0,pruned:1},predictionAccuracySummary:{provider:'p',network:n,forecastsRecorded:8,pending:2,settled:6,expired:1,meanErrorM:18.4,medianErrorM:12.1,p90ErrorM:31.2,meanOutcomeLagSec:6.2,byMethod:{physical_speed_projection:{settled:6,meanErrorM:18.4,medianErrorM:12.1,p90ErrorM:31.2}}}}},
 peekTransitState:async(n,m,d,now,maxAgeMs)=>{calls.push(['cached-state',n,m,d,now,maxAgeMs]);return {provider:'p',network:n,receivedAt:9,snapshot}},
 loadDriverStateAdapter:async n=>{calls.push(['driver',n]);return {plan:{provider:'p',network:n},driverStateAdapter:adapter}},
 loadDerivedEvents:async(n,m,d,now,alerts)=>{calls.push(['derived',n,m,d,now,alerts]);return {provider:'p',network:n,receivedAt:9,snapshot,events}},
 connect:(n,onTick,handlers)=>{calls.push(['connect',n,typeof onTick,!!handlers]);return 'sub'}
};
const api=window.UVTransitReadAPI.create({source});
let n=0;function check(name,fn){return Promise.resolve().then(fn).then(()=>{n++;console.log('PASS '+name)})}
(async()=>{
 await check('facade and consumer surfaces are frozen',()=>{assert(Object.isFrozen(api));assert(Object.isFrozen(api.map));assert(Object.isFrozen(api.journey));assert(Object.isFrozen(api.driver));assert(Object.isFrozen(api.diagnostics));assert(Object.isFrozen(api.capabilities))});
 await check('capabilities do not expose source',()=>{assert.equal(api.capabilities.transitState,true);assert.equal(api.capabilities.cachedTransitState,true);assert.equal(api.source,undefined)});
 await check('map reads route through source',async()=>{assert.deepEqual(await api.map.vehiclePositions(),{entity:[1]});assert.deepEqual(await api.map.tripUpdates('nav'),{entity:[2]});assert.equal(api.map.subscribe(()=>{},{}),'sub')});
 await check('journey static and realtime reads use boundary',async()=>{assert.deepEqual(await api.journey.runtimeManifest(),{m:1});assert.equal(await api.journey.staticGtfs('nav'),'blob');await api.journey.runtimeSchedule('nav',{m:1});await api.journey.runtimeShapes('nav',{m:1})});
 await check('canonical state hides engine/store internals',async()=>{const v=await api.state.read('aut',{now:10});assert.equal(v.snapshot,snapshot);assert.equal(v.registry,snapshot.vehicleRegistrySnapshot);assert.equal(v.continuity,snapshot.vehicleContinuitySnapshot);assert(v.metrics);assert.equal(v.metrics.counts.expected,2);assert.equal(v.metrics.counts.observed,1);assert.equal(v.metrics.counts.missing,1);assert(v.quality);assert.equal(v.quality.status,'degraded');assert.equal(v.quality.dimensions.freshness.band,'healthy');assert(v.observationHistory);assert.equal(v.observationHistory.entries,7);assert.equal(v.observationHistory.batches,2);assert(v.predictionAccuracy);assert.equal(v.predictionAccuracy.settled,6);assert.equal(v.predictionAccuracy.meanErrorM,18.4);assert.equal(v.transitStateEngine,undefined);assert.equal(v.observations,undefined);assert(Object.isFrozen(v));assert(Object.isFrozen(v.summary))});
 await check('map and journey share canonical state contract',async()=>{assert.equal((await api.map.state('aut')).snapshot,snapshot);assert.equal((await api.journey.state('aut')).snapshot,snapshot)});
 await check('cached journey state uses cache-only source capability',async()=>{const v=await api.journey.cachedState('aut',{now:10,maxAgeMs:25000});assert.equal(v.snapshot,snapshot);assert(calls.some(x=>Array.isArray(x)&&x[0]==='cached-state'));});
 await check('driver exposes computation only',async()=>{const c=await api.driver.core('aut');assert.deepEqual(c.routeCandidates('1',5),[{id:'1:5'}]);assert.equal(c.resolve({gps:1}).matched,true);assert.equal(c.driverStateAdapter,undefined);assert(Object.isFrozen(c))});
 await check('diagnostics gets projected state/metrics/quality/events',async()=>{assert.equal((await api.diagnostics.transitState('aut')).snapshot,snapshot);const m=await api.diagnostics.transitMetrics('aut');assert.equal(m.counts.expected,2);assert.equal(m.counts.missing,1);const q=await api.diagnostics.sourceQuality('aut');assert.equal(q.status,'degraded');assert.equal(q.dimensions.resolution.valuePct,50);const h=await api.diagnostics.observationHistory('aut');assert.equal(h.entries,7);assert.equal(h.kinds.vehicle_position,4);const a=await api.diagnostics.predictionAccuracy('aut');assert.equal(a.settled,6);assert.equal(a.p90ErrorM,31.2);assert.equal((await api.diagnostics.derivedEvents('aut',{officialAlerts:['a']})).events,events)});
 await check('missing capability fails only on demand',async()=>{const p=window.UVTransitReadAPI.create({source:{loadTripUpdates:async()=>({})}});assert.equal(p.capabilities.tripUpdates,true);assert.equal(p.capabilities.vehiclePositions,false);assert.throws(()=>p.map.vehiclePositions(),/capability loadVehiclePositions non disponibile/)});
 console.log('RESULT: '+n+' TransitReadAPI checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
