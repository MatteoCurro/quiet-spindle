const fs=require('fs'),vm=require('vm'),assert=require('assert');
const calls=[];
const snapshot={
  generatedAt:1000,
  tripStates:[
    {tripInstanceId:'x:aut:20260930:T1',routeId:'R1',active:true,status:'predicted_live',motionMode:'predicted_live',
      motion:{position:{source:'predicted_live',confidence:.8,observedAt:975,value:{lat:45,lon:12}}},
      delay:{source:'position_derived',value:30,confidence:.7},freshestObservedAt:975},
    {tripInstanceId:'x:aut:20260930:T2',routeId:'R2',active:false,status:'scheduled',motionMode:'unavailable',
      motion:{position:{source:'unavailable',confidence:0,observedAt:null,value:null}},
      delay:{source:'schedule_only',value:null,confidence:0},freshestObservedAt:null}
  ],
  summary(){return {provider:'x',network:'aut',motionModes:{predicted_live:1,unavailable:1}}}
};
const metrics={
  generatedAt:1000,
  counts:{expected:3,observed:1,predictedLive:1,awaiting:0,expectedUnobserved:1,likelyMissing:0,missing:1,otherActive:0},
  byRoute:[{routeId:'R1',counts:{expected:3,observed:1,predictedLive:1,missing:1,likelyMissing:0,awaiting:0},rates:{liveEvidenceCoveragePct:66.7}}],
  summary(){return {provider:'x',network:'aut',expected:3,observed:1,predictedLive:1,missing:1,expectedUnobserved:1,likelyMissing:0,awaiting:0,liveEvidenceCoveragePct:66.7}}
};
const quality={
  generatedAt:1000,status:'degraded',
  dimensions:{
    freshness:{band:'healthy',ageSec:25,newestObservedAt:975},
    validity:{band:'healthy',ok:true,checks:{snapshotShape:true,generatedAt:true,expectedAccounting:true,missingAccounting:true,nonNegativeInputs:true,matchedWithinResolutions:true}},
    coverage:{band:'degraded',valuePct:66.7,expected:3,missing:1},
    resolution:{band:'degraded',valuePct:60,observations:10,resolutions:10,matchedResolutions:6}
  },
  summary(){return {provider:'x',network:'aut',generatedAt:1000,status:'degraded',freshness:'healthy',freshnessAgeSec:25,validity:'healthy',coverage:'degraded',coveragePct:66.7,resolution:'degraded',resolutionRatePct:60,reasons:[]}}
};
const window={};window.window=window;
window.UVTransitRead={diagnostics:{
  async transitState(network){calls.push('state:'+network);return {snapshot,metrics,quality}},
  async transitMetrics(network){calls.push('metrics:'+network);return metrics},
  async sourceQuality(network){calls.push('quality:'+network);return quality},
  async derivedEvents(network){
    calls.push('events:'+network);
    const events={
      generatedAt:1000,
      active:[{
        id:'derived:x:aut:trip_expected_unobserved:T1',
        type:'trip_expected_unobserved',severity:'minor',confidence:.6,
        sourceKind:'derived',userVisible:false,firstSeenAt:900,lastSeenAt:1000,
        scope:{routeIds:['R1'],tripInstanceIds:['T1']},
        officialOverlap:{matched:false,alertIds:[]}
      }],
      summary(){return {provider:'x',network:'aut',active:1,types:{trip_expected_unobserved:1}}}
    };
    return {events};
  }
}};
const ctx=vm.createContext({window,Object,Array,Set,Map,Error});
vm.runInContext(fs.readFileSync(__dirname+'/../js/debug/diagnostics.js','utf8'),ctx);
(async()=>{
  const out=await window.UVTransitDiagnostics.transitStateSmoke('aut');
  assert.deepEqual(calls,['state:aut']);
  assert.equal(out.network,'aut');assert.equal(out.active.length,1);
  assert.equal(out.active[0].motionMode,'predicted_live');
  assert.equal(out.active[0].delaySource,'position_derived');
  assert.equal(out.checks.validModes,true);assert.equal(out.checks.provenancePresent,true);
  assert.equal(out.checks.noCoordinates,true);assert.equal(out.checks.coverageAccounting,true);assert.equal(out.checks.qualityDimensioned,true);
  assert.equal(out.coverage.expected,3);assert.equal(out.coverage.missing,1);
  assert.equal(out.sourceQuality.status,'degraded');assert.equal(out.sourceQuality.freshness,'healthy');
  const serialized=JSON.stringify(out);
  assert(!serialized.includes('"lat"'));assert(!serialized.includes('"lon"'));
  assert(!serialized.includes('"position"'));

  const coverage=await window.UVTransitDiagnostics.transitMetricsSmoke('aut');
  assert.deepEqual(calls,['state:aut','metrics:aut']);
  assert.equal(coverage.summary.expected,3);assert.equal(coverage.summary.missing,1);
  assert.equal(coverage.routes[0].liveEvidenceCoveragePct,66.7);
  assert.equal(coverage.checks.expectedEqualsBuckets,true);assert.equal(coverage.checks.missingSplit,true);
  assert(!JSON.stringify(coverage).includes('"lat"'));assert(!JSON.stringify(coverage).includes('"lon"'));

  const qualityOut=await window.UVTransitDiagnostics.sourceQualitySmoke('aut');
  assert.deepEqual(calls,['state:aut','metrics:aut','quality:aut']);
  assert.equal(qualityOut.summary.status,'degraded');
  assert.equal(qualityOut.dimensions.freshness.band,'healthy');
  assert.equal(qualityOut.dimensions.coverage.valuePct,66.7);
  assert.equal(qualityOut.checks.noSyntheticScore,true);assert.equal(qualityOut.checks.dimensionBands,true);
  assert(!JSON.stringify(qualityOut).includes('"lat"'));assert(!JSON.stringify(qualityOut).includes('"lon"'));

  const derived=await window.UVTransitDiagnostics.derivedEventSmoke('aut');
  assert.deepEqual(calls,['state:aut','metrics:aut','quality:aut','events:aut']);
  assert.equal(derived.active.length,1);
  assert.equal(derived.active[0].sourceKind,'derived');
  assert.equal(derived.active[0].userVisible,false);
  assert.equal(derived.checks.allDerived,true);
  assert.equal(derived.checks.diagnosticOnly,true);
  assert.equal(derived.checks.officialSeparation,true);
  const derivedJson=JSON.stringify(derived);
  assert(!derivedJson.includes('"lat"'));assert(!derivedJson.includes('"lon"'));
  console.log('RESULT: 34 TransitState/TransitMetrics/SourceQuality/DerivedEvent diagnostics smoke checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
