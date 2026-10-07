const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Object,Array,String,Number,Map,Math,Error});
for(const file of ['transit-metrics.js','source-quality-monitor.js'])
 vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);
const M=window.UVTransitMetrics,Q=window.UVTransitSourceQuality;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}

function snapshot(rows,input={},generatedAt=1000){
 return {
  provider:'p',network:'aut',generatedAt,
  tripStates:rows,
  vehicleStates:[],
  inputSummary:{observations:10,resolutions:10,matchedResolutions:9,freshMatchedTrips:4,...input}
 };
}
const row=(id,status,age,route='R1')=>({
 tripInstanceId:id,routeId:route,active:status!=='scheduled'&&status!=='completed',
 status,freshestObservedAt:age===null?null:1000-age
});

const healthySnapshot=snapshot([
 row('1','observed',20),row('2','observed',30),row('3','observed',40),
 row('4','observed',50),row('5','observed',60),row('6','observed',70),
 row('7','observed',80),row('8','predicted_live',100),
 row('9','expected_unobserved',null),row('10','awaiting_observation',null)
]);
const healthyMetrics=M.fromSnapshot(healthySnapshot);
const healthy=Q.fromState({snapshot:healthySnapshot,metrics:healthyMetrics});

check('healthy source keeps dimensions separate',()=>{
 assert.equal(healthy.status,'healthy');
 assert.equal(healthy.dimensions.freshness.band,'healthy');
 assert.equal(healthy.dimensions.validity.band,'healthy');
 assert.equal(healthy.dimensions.coverage.band,'healthy');
 assert.equal(healthy.dimensions.resolution.band,'healthy');
});
check('freshness uses newest canonical observation age',()=>{
 assert.equal(healthy.dimensions.freshness.ageSec,20);
});
check('coverage uses assessed denominator, excluding awaiting grace',()=>{
 assert.equal(healthyMetrics.counts.expected,10);
 assert.equal(healthyMetrics.rates.assessedExpected,9);
 assert.equal(healthy.dimensions.coverage.valuePct,88.9);
});
check('resolution rate comes from matched resolutions / resolutions',()=>{
 assert.equal(healthy.dimensions.resolution.valuePct,90);
});

const degradedSnapshot=snapshot([
 row('1','observed',200),row('2','predicted_live',220),
 row('3','expected_unobserved',null),row('4','expected_unobserved',null)
],{observations:10,resolutions:10,matchedResolutions:6});
const degradedMetrics=M.fromSnapshot(degradedSnapshot);
const degraded=Q.fromState({snapshot:degradedSnapshot,metrics:degradedMetrics});
check('mid freshness/coverage/resolution produces degraded band',()=>{
 assert.equal(degraded.dimensions.freshness.band,'degraded');
 assert.equal(degraded.dimensions.coverage.band,'degraded');
 assert.equal(degraded.dimensions.resolution.band,'degraded');
 assert.equal(degraded.status,'degraded');
});

const poorSnapshot=snapshot([
 row('1','expected_unobserved',null),row('2','likely_missing',null)
],{observations:0,resolutions:0,matchedResolutions:0,freshMatchedTrips:0});
const poorMetrics=M.fromSnapshot(poorSnapshot);
const poor=Q.fromState({snapshot:poorSnapshot,metrics:poorMetrics});
check('expected service with no observation evidence is poor freshness, not idle',()=>{
 assert.equal(poor.dimensions.freshness.band,'poor');
 assert.equal(poor.status,'poor');
 assert(poor.reasons.includes('no_observation_evidence'));
});
check('missing service is a coverage signal, not rewritten as a provider diagnosis',()=>{
 assert.equal(poor.dimensions.coverage.missing,2);
 assert(poor.reasons.includes('low_assessed_coverage'));
 assert(!poor.reasons.includes('provider_failure'));
});

const idleSnapshot=snapshot([],{observations:0,resolutions:0,matchedResolutions:0,freshMatchedTrips:0});
const idleMetrics=M.fromSnapshot(idleSnapshot);
const idle=Q.fromState({snapshot:idleSnapshot,metrics:idleMetrics});
check('no expected service and no observations is idle',()=>{
 assert.equal(idle.status,'idle');
 assert.equal(idle.dimensions.coverage.band,'unavailable');
 assert.equal(idle.dimensions.resolution.band,'unavailable');
});

const invalidMetrics=M.fromSnapshot(healthySnapshot);
const invalidSnapshot={...healthySnapshot,inputSummary:{observations:2,resolutions:2,matchedResolutions:5,freshMatchedTrips:1}};
const invalid=Q.fromState({snapshot:invalidSnapshot,metrics:invalidMetrics});
check('invalid canonical counters force poor validity',()=>{
 assert.equal(invalid.dimensions.validity.ok,false);
 assert.equal(invalid.dimensions.validity.checks.matchedWithinResolutions,false);
 assert.equal(invalid.status,'poor');
});

const custom=Q.fromState({
 snapshot:degradedSnapshot,metrics:degradedMetrics,
 options:{freshnessHealthySec:240,coverageHealthyPct:50,resolutionHealthyPct:50}
});
check('thresholds are configurable without changing metrics',()=>{
 assert.equal(custom.dimensions.freshness.band,'healthy');
 assert.equal(custom.dimensions.coverage.band,'healthy');
 assert.equal(custom.dimensions.resolution.band,'healthy');
 assert.equal(custom.status,'healthy');
});
check('quality snapshot and dimensions are immutable',()=>{
 assert(Object.isFrozen(healthy));assert(Object.isFrozen(healthy.dimensions));
 assert(Object.isFrozen(healthy.dimensions.coverage));assert(Object.isFrozen(healthy.reasons));
});
check('summary contains bands and rates but no synthetic quality score',()=>{
 const s=healthy.summary();
 assert.equal(s.status,'healthy');assert.equal(s.coveragePct,88.9);assert.equal(s.resolutionRatePct,90);
 assert.equal(Object.prototype.hasOwnProperty.call(s,'score'),false);
});
check('invalid input fails explicitly',()=>assert.throws(()=>Q.fromState({}),/snapshot e metrics richiesti/));

console.log('RESULT: '+n+' SourceQualityMonitor checks passed.');
