const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Object,Array,String,Number,Map,Set,Math,Date,Error,JSON});
vm.runInContext(fs.readFileSync(__dirname+'/../js/core/learning-layer.js','utf8'),ctx);
const L=window.UVTransitLearning;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}

check('feature schema is versioned and validates types',()=>{
 const s=new L.FeatureSchemaRegistry();
 s.register({id:'eta',version:'1',features:{speed:{type:'number'},route:{type:'string',required:false}}});
 assert.equal(s.validate('eta','1',{speed:12}).valid,true);
 assert.equal(s.validate('eta','1',{speed:'bad'}).valid,false);
 assert.equal(s.snapshot()[0].key,'eta@1');
});

check('prediction log cannot embed ground truth',()=>{
 const p=new L.PredictionLog();
 assert.throws(()=>p.append({task:'eta',entityId:'t1',modelVersion:'m1',generatedAt:1,targetAt:2,value:1,groundTruth:1}),/separati/);
});

check('prediction log is bounded and deduplicated',()=>{
 const p=new L.PredictionLog({retentionSec:100,maxEntries:2});
 const base={task:'eta',entityId:'t1',modelVersion:'m1',confidence:.5,value:1};
 p.append({...base,generatedAt:100,targetAt:110,id:'a'});
 p.append({...base,generatedAt:101,targetAt:111,id:'a'});
 p.append({...base,generatedAt:102,targetAt:112,id:'b'});
 p.append({...base,generatedAt:103,targetAt:113,id:'c'});
 const s=p.snapshot(113);
 assert.equal(s.entries.length,2);assert.equal(s.stats.deduplicated,1);
});

check('ground truth accepts verified evidence only',()=>{
 const g=new L.GroundTruthStore();
 assert(g.add({kind:'position',entityId:'t1',observedAt:10,sourceKind:'observed_live',value:{lat:45,lon:12}}));
 assert.throws(()=>g.add({kind:'position',entityId:'t1',observedAt:11,sourceKind:'model_prediction',value:{lat:45,lon:12}}),/non verificata/);
 assert.throws(()=>g.add({kind:'position',entityId:'t1',observedAt:12,sourceKind:'derived',value:{lat:45,lon:12}}),/non verificata/);
});

check('outcome resolver settles only against matching verified truth',()=>{
 const p=new L.PredictionLog(),g=new L.GroundTruthStore(),r=new L.OutcomeResolver({truthStore:g,toleranceSec:20});
 p.append({id:'p1',task:'eta_position',truthKind:'position',entityId:'t1',modelVersion:'m1',generatedAt:90,targetAt:100,horizonSec:120,confidence:.8,value:{lat:45,lon:12}});
 g.add({id:'truth-other',kind:'position',entityId:'t2',observedAt:100,sourceKind:'observed_live',value:{lat:45,lon:12}});
 assert.equal(r.resolve(p.snapshot(100)).length,0);
 g.add({id:'truth-1',kind:'position',entityId:'t1',observedAt:105,sourceKind:'observed_live',value:{lat:45.001,lon:12}});
 const out=r.resolve(p.snapshot(105));
 assert.equal(out.length,1);assert.equal(out[0].truthSourceKind,'observed_live');
 assert.equal(out[0].error.metric,'spatial_error_m');assert(out[0].error.value>100);
 assert.equal(r.resolve(p.snapshot(106)).length,0);
});

check('compact history keeps raw recent rows and aggregates old verified rows',()=>{
 const h=new L.CompactHistoryStore({retentionSec:1000,compactAfterSec:100,bucketSec:300});
 h.record({scope:'segment',key:'R|A|B',at:100,sourceKind:'observed_live',metrics:{delaySec:20}});
 h.record({scope:'segment',key:'R|A|B',at:120,sourceKind:'official_realtime',metrics:{delaySec:40}});
 h.record({scope:'trip',key:'T1',at:250,sourceKind:'observed_live',metrics:{delaySec:5}});
 h.compact(300);
 const s=h.snapshot(false);
 assert.equal(s.raw.length,1);assert.equal(s.compact.length,1);
 assert.equal(s.compact[0].count,2);assert.equal(s.compact[0].metrics.delaySec.mean,30);
 assert.throws(()=>h.record({scope:'trip',key:'T2',at:300,sourceKind:'model_prediction',metrics:{delaySec:1}}),/non verificata/);
});

check('evaluation exposes fixed 2/5/10/15 minute horizon buckets',()=>{
 const e=new L.EvaluationStore();
 e.ingest([
  {id:'o1',modelVersion:'active-v1',horizonSec:120,error:{metric:'absolute_error',value:10}},
  {id:'o2',modelVersion:'candidate-v2',horizonSec:300,error:{metric:'absolute_error',value:6}},
  {id:'o3',modelVersion:'active-v1',horizonSec:42,error:{metric:'absolute_error',value:4}}
 ]);
 const s=e.summary();
 assert.equal(s.byHorizonSec['120'].scored,1);
 assert.equal(s.byHorizonSec['300'].scored,1);
 assert.equal(s.byHorizonSec['600'].scored,0);
 assert.equal(s.byHorizonSec['900'].scored,0);
 assert.equal(s.byHorizonSec.other.scored,1);
 assert.equal(e.compare('active-v1','candidate-v2').ready,true);
});

check('model registry keeps candidate separate from active',()=>{
 const m=new L.ModelRegistry();
 m.register({task:'eta',version:'det-v1',kind:'deterministic',status:'active'});
 m.register({task:'eta',version:'learn-v2',kind:'learned',status:'shadow'});
 assert.equal(m.resolve('eta').version,'det-v1');
 assert.equal(m.candidate('eta').version,'learn-v2');
 assert.throws(()=>m.register({task:'eta',version:'other',kind:'heuristic',status:'active'}),/già/);
});

check('model registry promotion is explicit and rollback restores deterministic active',()=>{
 const m=new L.ModelRegistry();
 m.register({task:'eta',version:'det-v1',kind:'deterministic',status:'active'});
 m.register({task:'eta',version:'learn-v2',kind:'learned',status:'shadow'});
 m.promote('eta','learn-v2',{reason:'test',at:100});
 assert.equal(m.resolve('eta').version,'learn-v2');
 assert.equal(m.snapshot().models.find(x=>x.version==='det-v1').status,'retired');
 m.rollback('eta',{reason:'regression',at:110});
 assert.equal(m.resolve('eta').version,'det-v1');
 assert.equal(m.snapshot().history.at(-1).type,'rollback');
});

check('promotion policy never auto-promotes and requires healthy shadow evidence',()=>{
 const e=new L.EvaluationStore(),m=new L.ModelRegistry();
 m.register({task:'trip_match',version:'det-v1',kind:'deterministic',status:'active'});
 m.register({task:'trip_match',version:'cand-v2',kind:'learned',status:'shadow'});
 for(let i=0;i<30;i++){
  e.ingest([
   {id:'a'+i,task:'trip_match',modelVersion:'det-v1',confidence:.7,error:{metric:'classification_correct',value:i%5?1:0}},
   {id:'c'+i,task:'trip_match',modelVersion:'cand-v2',confidence:.85,error:{metric:'classification_correct',value:i%10?1:0}}
  ]);
 }
 const policy=new L.PromotionPolicy({evaluationStore:e,modelRegistry:m,healthProvider:()=>({status:'healthy'})});
 const verdict=policy.evaluate('trip_match');
 assert.equal(verdict.eligible,true);
 assert.equal(m.resolve('trip_match').version,'det-v1');
 policy.promote('trip_match',{reason:'explicit-test'});
 assert.equal(m.resolve('trip_match').version,'cand-v2');
 policy.rollback('trip_match',{reason:'test-rollback'});
 assert.equal(m.resolve('trip_match').version,'det-v1');
});

check('promotion policy blocks unhealthy or insufficient candidates',()=>{
 const e=new L.EvaluationStore(),m=new L.ModelRegistry();
 m.register({task:'eta',version:'det-v1',kind:'deterministic',status:'active'});
 m.register({task:'eta',version:'cand-v2',kind:'learned',status:'shadow'});
 e.ingest([
  {id:'a',task:'eta',modelVersion:'det-v1',confidence:.7,error:{metric:'absolute_error',value:10}},
  {id:'c',task:'eta',modelVersion:'cand-v2',confidence:.8,error:{metric:'absolute_error',value:8}}
 ]);
 const policy=new L.PromotionPolicy({evaluationStore:e,modelRegistry:m,healthProvider:()=>({status:'degraded'}),options:{minScored:1}});
 const verdict=policy.evaluate('eta');
 assert.equal(verdict.eligible,false);assert(verdict.reasons.includes('health_degraded'));
 assert.throws(()=>policy.promote('eta'),/non eleggibile/);
 assert.equal(m.resolve('eta').version,'det-v1');
});

check('kill switch and disable return no active model without deleting registry',()=>{
 const m=new L.ModelRegistry();
 m.register({task:'eta',version:'det-v1',kind:'deterministic',status:'active'});
 m.kill('health');assert.equal(m.resolve('eta'),null);assert.equal(m.snapshot().killReason,'health');
 m.restore();assert.equal(m.resolve('eta').version,'det-v1');
 m.setEnabled(false);assert.equal(m.resolve('eta'),null);assert.equal(m.snapshot().models.length,1);
});

const liveRow=(at)=>({
 provider:'p',network:'aut',tripInstanceId:'trip:1',routeId:'R',motionMode:'live',
 freshestObservedAt:at,delay:{value:30},shapeProgress:{value:1000},
 expectedState:{previousStop:{id:'A'},nextStop:{id:'B'}},
 motion:{generatedAt:at,anchorObservationId:'obs-'+at,position:{value:{lat:45.001,lon:12},observedAt:at,confidence:1,details:{observationId:'obs-'+at}}}
});
const predictedRow=(at)=>({
 provider:'p',network:'aut',tripInstanceId:'trip:1',routeId:'R',motionMode:'predicted_live',
 motion:{generatedAt:at,predictedFromObservedAt:at-25,anchorObservationId:'old',position:{value:{lat:45,lon:12},observedAt:at-25,confidence:.8}}
});
const snapshot=(at,rows)=>({provider:'p',network:'aut',generatedAt:at,tripStates:rows,vehicleStates:[]});

check('learning observer records predictions and later verified outcomes without mutating TransitState',()=>{
 const layer=L.createLearningLayer({outcomeToleranceSec:30});
 const first=snapshot(100,[predictedRow(100)]),firstJson=JSON.stringify(first);
 let s=layer.observeTransitSnapshot(first);
 assert.equal(JSON.stringify(first),firstJson);assert.equal(s.predictionLog.entries,1);assert.equal(s.groundTruth.entries,0);
 const second=snapshot(110,[liveRow(110)]),secondJson=JSON.stringify(second);
 s=layer.observeTransitSnapshot(second);
 assert.equal(JSON.stringify(second),secondJson);
 assert.equal(s.groundTruth.entries,2);assert.equal(s.outcomes.entries,1);
 assert.equal(s.history.raw>=1,true);
});

check('learning layer defaults to deterministic active models',()=>{
 const layer=L.createLearningLayer();
 const m=layer.summary(100).models;
 assert.equal(m.active.length,4);
 assert.equal(m.active.every(x=>x.kind==='deterministic'),true);
});

check('verified GTFS-RT actual stop times populate arrival truth and compact segment history',()=>{
 const layer=L.createLearningLayer();
 const obs={id:'tu-1',kind:'trip_update',stopTimeUpdates:[
  {stopId:'A',departure:{time:100}},
  {stopId:'B',arrival:{time:160},departure:{time:180}}
 ]};
 const res={observationId:'tu-1',matched:true,tripInstanceId:'trip:1',routeId:'R',classification:'exact',confidence:1,evidence:[{type:'trip_id_exact',weight:1000}]};
 const s=layer.observeTransitSnapshot(snapshot(200,[]),{observations:[obs],resolutions:[res]});
 const truth=layer.truth.snapshot(200).entries;
 assert(truth.some(x=>x.kind==='arrival_time'&&x.entityId==='trip:1|B'&&x.value===160));
 const hist=layer.history.snapshot(false);
 assert.equal(hist.raw.length,1);assert.equal(hist.raw[0].key,'R|A|B');
 assert.equal(hist.raw[0].metrics.travelTimeSec,60);assert.equal(hist.raw[0].metrics.dwellTimeSec,20);
 assert.equal(s.stats.officialTimingSamples,1);
});

check('learning layer disabled leaves snapshot valid and does not collect new evidence',()=>{
 const layer=L.createLearningLayer();layer.setEnabled(false);
 const snap=snapshot(200,[predictedRow(200)]),json=JSON.stringify(snap);
 const s=layer.observeTransitSnapshot(snap);
 assert.equal(JSON.stringify(snap),json);assert.equal(s.enabled,false);assert.equal(s.predictionLog.entries,0);
});

check('learning layer kill switch is immediate and reversible',()=>{
 const layer=L.createLearningLayer();layer.kill('manual-test');
 let s=layer.observeTransitSnapshot(snapshot(300,[predictedRow(300)]));
 assert.equal(s.killSwitch,true);assert.equal(s.predictionLog.entries,0);
 layer.restore();s=layer.observeTransitSnapshot(snapshot(301,[predictedRow(301)]));
 assert.equal(s.killSwitch,false);assert.equal(s.predictionLog.entries,1);
});

check('learning layer exposes automatic active vs candidate comparison without changing active model',()=>{
 const layer=L.createLearningLayer();
 layer.models.register({task:'eta_position',version:'candidate-eta-v2',kind:'learned',status:'shadow'});
 layer.evaluation.ingest([
  {id:'cmp-a',task:'eta_position',modelVersion:'deterministic-motion-v1',horizonSec:120,error:{metric:'absolute_error',value:12}},
  {id:'cmp-c',task:'eta_position',modelVersion:'candidate-eta-v2',horizonSec:120,error:{metric:'absolute_error',value:8}}
 ]);
 const s=layer.summary(400);
 assert.equal(s.models.active.find(x=>x.task==='eta_position').version,'deterministic-motion-v1');
 assert.equal(s.comparisons.eta_position.ready,true);
 assert.equal(s.comparisons.eta_position.meanErrorDelta,-4);
});

check('learning health reports healthy degraded and killed states independently from core',()=>{
 const layer=L.createLearningLayer();
 assert.equal(layer.health(500).status,'healthy');
 layer._stats.observerErrors=1;assert.equal(layer.health(500).status,'degraded');
 layer.kill('health-test');assert.equal(layer.health(500).status,'killed');
 layer.restore();assert.equal(layer.health(500).status,'degraded');
});

check('learning module does not depend on predictor implementation',()=>{
 const src=fs.readFileSync(__dirname+'/../js/core/learning-layer.js','utf8');
 assert(!src.includes('UVTransitPrediction.'));
 assert(!src.includes('predictPhysicalProgress'));
 assert(!src.includes('TransitStateEngine.snapshot('));
});

console.log('RESULT: '+n+' M7C learning foundation checks passed.');
