const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Object,Array,String,Number,Map,Set,Math,Date,Error});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/prediction-accuracy.js','utf8'),ctx);
const A=window.UVTransitPredictionAccuracy;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}

const predicted=(t,pos={lat:45,lon:12},method='physical_speed_projection')=>({
 provider:'p',network:'aut',tripInstanceId:'trip:1',routeId:'R1',generatedAt:t,
 motionMode:'predicted_live',
 motion:{
  generatedAt:t,predictionMethod:method,anchorObservationId:'obs-old',
  predictedFromObservedAt:t-25,
  position:{value:pos,confidence:.8,observedAt:t-25,details:{observationId:'obs-old',method}},
  shapeProgress:{value:1000,confidence:.8}
 }
});
const live=(t,pos={lat:45,lon:12},progress=1000)=>({
 provider:'p',network:'aut',tripInstanceId:'trip:1',routeId:'R1',generatedAt:t,
 motionMode:'live',freshestObservedAt:t,
 motion:{
  generatedAt:t,anchorObservationId:'obs-'+t,
  position:{value:pos,confidence:1,observedAt:t,details:{observationId:'obs-'+t}},
  shapeProgress:{value:progress,confidence:1}
 }
});
const snap=(t,rows)=>({provider:'p',network:'aut',generatedAt:t,tripStates:rows});

const e=A.createPredictionAccuracyEngine({directOutcomeLagSec:20,forecastExpirySec:60,interpolationMaxGapSec:45});

check('predicted_live records forecast without settling immediately',()=>{
 const s=e.ingest(snap(100,[predicted(100)]));
 assert.equal(s.pending.length,1);assert.equal(s.results.length,0);
 assert.equal(s.pending[0].predictionAgeSec,25);
});
check('duplicate forecast id is ignored',()=>{
 const s=e.ingest(snap(100,[predicted(100)]));
 assert.equal(s.pending.length,1);assert.equal(s.stats.deduplicatedForecasts,1);
});
check('later live sample on same trip settles prediction',()=>{
 const s=e.ingest(snap(110,[live(110)]));
 assert.equal(s.pending.length,0);assert.equal(s.results.length,1);
 assert.equal(s.results[0].outcomeMethod,'nearest_live_sample');
 assert.equal(s.results[0].outcomeLagSec,10);
 assert(s.results[0].spatialErrorM<.1);
});
check('spatial error is measured independently of predictor',()=>{
 const local=A.createPredictionAccuracyEngine();
 local.ingest(snap(200,[predicted(200,{lat:45,lon:12})]));
 const s=local.ingest(snap(210,[live(210,{lat:45.001,lon:12},1010)]));
 assert(s.results[0].spatialErrorM>100&&s.results[0].spatialErrorM<120);
 assert.equal(s.results[0].progressErrorM,10);
});
check('different trip cannot settle forecast',()=>{
 const local=A.createPredictionAccuracyEngine({forecastExpirySec:30});
 local.ingest(snap(300,[predicted(300)]));
 const other={...live(310),tripInstanceId:'trip:2'};
 const s=local.ingest(snap(310,[other]));
 assert.equal(s.pending.length,1);assert.equal(s.results.length,0);
});
check('bracketed live samples interpolate to target timestamp',()=>{
 const local=A.createPredictionAccuracyEngine({directOutcomeLagSec:2,interpolationMaxGapSec:30});
 local.ingest(snap(390,[live(390,{lat:45,lon:12},900)]));
 local.ingest(snap(400,[predicted(400,{lat:45.001,lon:12})]));
 const s=local.ingest(snap(410,[live(410,{lat:45.002,lon:12},1100)]));
 assert.equal(s.results.length,1);
 assert.equal(s.results[0].outcomeMethod,'interpolated_live');
 assert.equal(s.results[0].outcomeLagSec,0);
 assert(s.results[0].spatialErrorM<.1);
 assert.equal(s.results[0].progressErrorM,0);
});
check('forecast without comparable outcome expires',()=>{
 const local=A.createPredictionAccuracyEngine({forecastExpirySec:20});
 local.ingest(snap(500,[predicted(500)]));
 const s=local.ingest(snap(521,[]));
 assert.equal(s.pending.length,0);assert.equal(s.results.length,0);assert.equal(s.stats.expired,1);
});
check('scheduled and live rows never create forecasts',()=>{
 const local=A.createPredictionAccuracyEngine();
 const scheduled={...predicted(600),motionMode:'scheduled_simulation'};
 const s=local.ingest(snap(600,[scheduled,live(600)]));
 assert.equal(s.pending.length,0);assert.equal(s.stats.forecastsRecorded,0);
});
check('summary has aggregate error by prediction method and no coordinates',()=>{
 const s=e.snapshot().summary(),json=JSON.stringify(s);
 assert.equal(s.settled,1);assert.equal(s.byMethod.physical_speed_projection.settled,1);
 assert.equal(Object.prototype.hasOwnProperty.call(s,'score'),false);
 assert(!json.includes('"lat"'));assert(!json.includes('"lon"'));assert(!json.includes('"position"'));
});
check('result history is bounded',()=>{
 const local=A.createPredictionAccuracyEngine({maxResults:2});
 for(let i=0;i<3;i++){
  const t=700+i*30;local.ingest(snap(t,[predicted(t)]));local.ingest(snap(t+5,[live(t+5)]));
 }
 assert.equal(local.snapshot().results.length,2);
});
check('sample history is bounded per trip',()=>{
 const local=A.createPredictionAccuracyEngine({maxSamplesPerTrip:2});
 local.ingest(snap(800,[live(800)]));local.ingest(snap(801,[live(801)]));local.ingest(snap(802,[live(802)]));
 assert.equal(local._samplesByTrip.get('trip:1').length,2);
});
check('engine source has no predictor dependency',()=>{
 const src=fs.readFileSync(__dirname+'/../js/core/prediction-accuracy.js','utf8');
 assert(!src.includes('UVTransitPrediction.'));
 assert(!src.includes('predictPhysicalProgress'));
 assert(!src.includes('projectedAnchor'));
});
check('invalid input fails explicitly',()=>assert.throws(()=>e.ingest(null),/snapshot non valido/));

console.log('RESULT: '+n+' PredictionAccuracyEngine checks passed.');
