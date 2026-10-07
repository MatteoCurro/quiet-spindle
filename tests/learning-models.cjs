const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Object,Array,String,Number,Map,Set,Math,Date,Error,JSON});
for(const file of ['learning-layer.js','learning-models.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);
const L=window.UVTransitLearning,M=window.UVTransitLearningModels;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}

check('trip-match candidate emits versioned calibrated confidence',()=>{
 const model=new M.TripMatchConfidenceModel();
 const out=model.predict({
  classification:'trip_matched',matched:true,tripInstanceId:'trip:1',confidence:.72,
  evidence:[{type:'stop_sequence_id',weight:24},{type:'gps_shape',weight:20}],
  alternatives:[{tripInstanceId:'trip:2',score:35}]
 });
 assert.equal(out.task,'trip_match');assert.equal(out.modelVersion,'trip-match-confidence-v1');
 assert.equal(out.value,'trip:1');assert(out.confidence>0&&out.confidence<1);
 assert.equal(out.features.matched,true);
});

check('missing-trip model outputs probability and confidence without touching state',()=>{
 const model=new M.MissingTripCalibrationModel();
 const row={status:'likely_missing',plannedStart:100,observationAgeSec:240,confidence:.7};
 const copy=JSON.stringify(row),out=model.predict(row,{generatedAt:700,observedCoveragePct:.85});
 assert.equal(JSON.stringify(row),copy);
 assert.equal(out.modelVersion,'missing-trip-calibration-v1');
 assert(out.probability>.5);assert.equal(out.value,true);assert(out.confidence>0);
});

check('segment history model uses only verified compact history samples',()=>{
 const layer=L.createLearningLayer();
 for(const [at,travel,dwell] of [[100,100,20],[110,110,30],[120,90,25]])
  layer.history.record({scope:'segment',key:'R|A|B',at,sourceKind:'official_realtime',metrics:{travelTimeSec:travel,dwellTimeSec:dwell}});
 const model=new M.SegmentHistoryModel({historyStore:layer.history});
 const out=model.estimate('R|A|B');
 assert.equal(out.modelVersion,'segment-history-v1');assert.equal(out.sampleCount,3);
 assert.equal(Math.round(out.travelTimeSec),100);assert.equal(Math.round(out.dwellTimeSec),25);
 assert(out.confidence>0);
});

check('ETA correction reuses historical segment travel and dwell without changing schedule',()=>{
 const layer=L.createLearningLayer();
 for(const [key,travel,dwell] of [['R|A|B',100,30],['R|B|C',150,0]]){
  for(const at of [10,20,30])layer.history.record({scope:'segment',key,at,sourceKind:'official_realtime',metrics:{travelTimeSec:travel,dwellTimeSec:dwell}});
 }
 const seg=new M.SegmentHistoryModel({historyStore:layer.history});
 const eta=new M.EtaCorrectionModel({segmentModel:seg});
 const instance={
  id:'trip:1',route:{id:'R'},plannedEnd:300,
  stops:[
   {id:'A',plannedArrival:70,plannedDeparture:80},
   {id:'B',plannedArrival:160,plannedDeparture:180},
   {id:'C',plannedArrival:300,plannedDeparture:300}
  ]
 };
 const row={expectedState:{previousStop:{id:'A'},nextStop:{id:'B'}}};
 const before=JSON.stringify(instance),out=eta.predict({instance,row,now:100});
 assert.equal(JSON.stringify(instance),before);
 assert.equal(out.modelVersion,'eta-segment-history-v1');assert.equal(out.targetStopId,'C');
 assert.equal(Math.round(out.correctionSec),55);assert.equal(Math.round(out.value),355);
 assert(out.confidence>0);
});

check('bundle registers candidates but deterministic models remain active',()=>{
 const layer=L.createLearningLayer(),bundle=M.createFirstLearningBundle({learningLayer:layer});
 const state=layer.models.snapshot();
 assert.equal(state.active.find(x=>x.task==='trip_match').version,'deterministic-trip-match-v1');
 assert.equal(state.active.find(x=>x.task==='missing_trip').version,'deterministic-missing-trip-v1');
 assert.equal(state.active.find(x=>x.task==='eta_arrival').version,'deterministic-schedule-eta-v1');
 assert.equal(state.candidates.find(x=>x.task==='trip_match').version,'trip-match-confidence-v1');
 assert.equal(state.candidates.find(x=>x.task==='missing_trip').version,'missing-trip-calibration-v1');
 assert.equal(state.candidates.find(x=>x.task==='eta_arrival').version,'eta-segment-history-v1');
 assert.equal(state.candidates.every(x=>x.status==='shadow'),true);
 assert(bundle.summary().versions);
});

check('bundle logs active and candidate trip-match predictions against verified official truth',()=>{
 const layer=L.createLearningLayer(),bundle=M.createFirstLearningBundle({learningLayer:layer});
 const obs={id:'obs-1',kind:'trip_update',observedAt:100,stopTimeUpdates:[]};
 const res={observationId:'obs-1',matched:true,tripInstanceId:'trip:1',routeId:'R',classification:'exact',confidence:1,evidence:[{type:'trip_id_exact',weight:1000}],alternatives:[]};
 const snap={provider:'p',network:'aut',generatedAt:100,tripStates:[],vehicleStates:[]};
 bundle.observe({snapshot:snap,resolutions:[res],observations:[obs],now:100});
 layer.observeTransitSnapshot(snap,{observations:[obs],resolutions:[res]});
 const outcomes=layer.outcomes.snapshot().entries.filter(x=>x.task==='trip_match');
 assert.equal(outcomes.length,2);
 assert(outcomes.every(x=>x.truthSourceKind==='official_realtime'&&x.error.metric==='classification_correct'&&x.error.value===1));
 assert.equal(layer.comparisons().trip_match.ready,true);
});

check('missing predictions are future-dated and throttled per trip',()=>{
 const layer=L.createLearningLayer(),bundle=M.createFirstLearningBundle({learningLayer:layer});
 const row={tripInstanceId:'trip:1',routeId:'R',status:'likely_missing',active:true,plannedStart:0,observationAgeSec:180,confidence:.7};
 const snap={provider:'p',network:'aut',generatedAt:1000,tripStates:[row],vehicleStates:[]};
 bundle.observe({snapshot:snap,resolutions:[],observations:[],now:1000});
 bundle.observe({snapshot:{...snap,generatedAt:1050},resolutions:[],observations:[],now:1050});
 const rows=layer.predictions.snapshot(1050).entries.filter(x=>x.task==='missing_trip');
 assert.equal(rows.length,2);
 assert(rows.every(x=>x.targetAt===1300&&x.horizonSec===300&&x.outcomeToleranceSec===180));
});

check('ETA bundle logs deterministic baseline and candidate only when history exists',()=>{
 const layer=L.createLearningLayer(),bundle=M.createFirstLearningBundle({learningLayer:layer});
 for(const key of ['R|A|B','R|B|C'])for(const at of [10,20,30])
  layer.history.record({scope:'segment',key,at,sourceKind:'official_realtime',metrics:{travelTimeSec:key.endsWith('A|B')?100:150,dwellTimeSec:key.endsWith('A|B')?30:0}});
 const instance={id:'trip:1',route:{id:'R'},plannedEnd:300,stops:[
  {id:'A',plannedArrival:70,plannedDeparture:80},{id:'B',plannedArrival:160,plannedDeparture:180},{id:'C',plannedArrival:300,plannedDeparture:300}
 ]};
 const servicePlan={get:id=>id==='trip:1'?instance:null};
 const row={tripInstanceId:'trip:1',routeId:'R',status:'observed',active:true,expectedState:{previousStop:{id:'A'},nextStop:{id:'B'}}};
 const snap={provider:'p',network:'aut',generatedAt:100,tripStates:[row],vehicleStates:[]};
 bundle.observe({snapshot:snap,resolutions:[],observations:[],servicePlan,now:100});
 const rows=layer.predictions.snapshot(100).entries.filter(x=>x.task==='eta_arrival');
 assert.equal(rows.length,2);
 assert(rows.some(x=>x.modelVersion==='deterministic-schedule-eta-v1'&&x.value===300));
 const candidate=rows.find(x=>x.modelVersion==='eta-segment-history-v1');
 assert(candidate);assert.equal(Math.round(candidate.value),355);assert(candidate.confidence>0);
});

check('kill switch prevents every candidate bundle output immediately',()=>{
 const layer=L.createLearningLayer(),bundle=M.createFirstLearningBundle({learningLayer:layer});
 layer.kill('test');
 const snap={provider:'p',network:'aut',generatedAt:100,tripStates:[{tripInstanceId:'t',routeId:'R',status:'likely_missing',active:true,plannedStart:0}],vehicleStates:[]};
 bundle.observe({snapshot:snap,resolutions:[],observations:[],now:100});
 assert.equal(layer.predictions.snapshot(100).entries.length,0);
});

check('candidate module never calls predictor or mutates TransitState engine',()=>{
 const src=fs.readFileSync(__dirname+'/../js/core/learning-models.js','utf8');
 assert(!src.includes('UVTransitPrediction.'));
 assert(!src.includes('predictPhysicalProgress'));
 assert(!src.includes('TransitStateEngine'));
});

console.log('RESULT: '+n+' M7C first learning model checks passed.');
