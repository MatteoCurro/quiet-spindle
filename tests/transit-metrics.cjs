const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Object,Array,String,Number,Map,Math,Error});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/transit-metrics.js','utf8'),ctx);
const M=window.UVTransitMetrics;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}

const snapshot={
 provider:'p',network:'aut',generatedAt:1000,
 tripStates:[
  {tripInstanceId:'1',routeId:'R1',active:true,status:'observed'},
  {tripInstanceId:'2',routeId:'R1',active:true,status:'predicted_live'},
  {tripInstanceId:'3',routeId:'R1',active:true,status:'expected_unobserved'},
  {tripInstanceId:'4',routeId:'R1',active:true,status:'likely_missing'},
  {tripInstanceId:'5',routeId:'R2',active:true,status:'awaiting_observation'},
  {tripInstanceId:'6',routeId:'R2',active:true,status:'observed'},
  {tripInstanceId:'7',routeId:'R2',active:true,status:'cancelled'},
  {tripInstanceId:'8',routeId:'R3',active:false,status:'scheduled'},
  {tripInstanceId:'9',routeId:'R3',active:false,status:'completed'}
 ],
 vehicleStates:[
  {vehicleId:'A',status:'matched'},
  {vehicleId:'B',status:'route_only'},
  {vehicleId:'C',status:'unknown'}
 ],
 inputSummary:{observations:12,resolutions:12,matchedResolutions:7,freshMatchedTrips:3}
};
const metrics=M.fromSnapshot(snapshot);

check('expected denominator contains active non-cancelled TripInstances only',()=>{
 assert.equal(metrics.counts.expected,6);
 assert.equal(metrics.counts.cancelled,1);
});
check('observed is strict fresh/current evidence',()=>{
 assert.equal(metrics.counts.observed,2);
 assert.equal(metrics.rates.observedCoveragePct,33.3);
});
check('predicted-live remains separate but contributes to live evidence',()=>{
 assert.equal(metrics.counts.predictedLive,1);
 assert.equal(metrics.rates.liveEvidenceCoveragePct,50);
});
check('missing preserves expected-unobserved vs likely-missing distinction',()=>{
 assert.equal(metrics.counts.expectedUnobserved,1);
 assert.equal(metrics.counts.likelyMissing,1);
 assert.equal(metrics.counts.missing,2);
 assert.equal(metrics.rates.missingPct,33.3);
});
check('awaiting grace is excluded from assessed denominator',()=>{
 assert.equal(metrics.counts.awaiting,1);
 assert.equal(metrics.rates.assessedExpected,5);
 assert.equal(metrics.rates.assessedEvidence,3);
 assert.equal(metrics.rates.assessedCoveragePct,60);
});
check('route breakdown preserves same accounting',()=>{
 const r1=metrics.byRoute.find(x=>x.routeId==='R1');
 const r2=metrics.byRoute.find(x=>x.routeId==='R2');
 assert.equal(r1.counts.expected,4);assert.equal(r1.counts.missing,2);
 assert.equal(r1.rates.liveEvidenceCoveragePct,50);
 assert.equal(r2.counts.expected,2);assert.equal(r2.counts.awaiting,1);assert.equal(r2.counts.cancelled,1);
});
check('future/completed rows stay visible in byStatus but not expected denominator',()=>{
 assert.equal(metrics.byStatus.scheduled,1);assert.equal(metrics.byStatus.completed,1);
 assert.equal(metrics.byRoute.some(x=>x.routeId==='R3'),false);
});
check('vehicle evidence counters are diagnostic and do not alter trip coverage',()=>{
 assert.equal(metrics.vehicles.total,3);assert.equal(metrics.vehicles.matched,1);assert.equal(metrics.vehicles.unresolved,2);
 assert.equal(metrics.vehicles.statuses.route_only,1);
});
check('input summary is preserved read-only for later quality analysis',()=>{
 assert.equal(metrics.input.observations,12);assert.equal(metrics.input.matchedResolutions,7);
 assert(Object.isFrozen(metrics.input));
});
check('summary exposes stable expected/observed/missing contract',()=>{
 const s=metrics.summary();
 assert.equal(s.expected,6);assert.equal(s.observed,2);assert.equal(s.missing,2);
 assert.equal(s.expectedUnobserved,1);assert.equal(s.likelyMissing,1);
 assert.equal(s.observedCoveragePct,33.3);
});
check('metrics graph is immutable',()=>{
 assert(Object.isFrozen(metrics));assert(Object.isFrozen(metrics.counts));assert(Object.isFrozen(metrics.rates));
 assert(Object.isFrozen(metrics.byRoute));assert(Object.isFrozen(metrics.byRoute[0]));
});
check('zero denominator returns null percentages instead of false precision',()=>{
 const z=M.fromSnapshot({provider:'p',network:'x',generatedAt:1,tripStates:[],vehicleStates:[],inputSummary:{}});
 assert.equal(z.counts.expected,0);assert.equal(z.rates.observedCoveragePct,null);assert.equal(z.rates.missingPct,null);
});
check('invalid input fails explicitly',()=>assert.throws(()=>M.fromSnapshot(null),/snapshot non valido/));

console.log('RESULT: '+n+' TransitCoverageMetrics checks passed.');
