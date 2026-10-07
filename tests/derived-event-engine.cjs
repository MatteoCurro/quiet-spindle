const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Intl,Date,Map,Set,Object,Array,Number,String,Error,Math});
for(const file of ['gtfs.js','service-plan.js','expected-position.js','derived-event-engine.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);

const S=window.UVTransitServicePlan,E=window.UVTransitExpectedPosition,D=window.UVTransitDerivedEvents;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}
const sec=(h,m)=>h*3600+m*60;

const stops=[{id:'A',name:'A',lat:45,lon:12},{id:'B',name:'B',lat:45.01,lon:12}];
const routes=[{id:'R1',short:'1',long:'Linea 1',desc:'UM',type:3}];
const trips=['T1','T2','T3','T4'].map(id=>({id,routeId:'R1',directionId:'0',headsign:'B',shapeId:'S1',blockId:''}));
const core={schema:1,network:'aut',routes,stops,trips};
const rows=trips.map((t,i)=>[t.id,'R1','B','S1',[
  ['A',1,sec(8,0)+i*60,sec(8,0)+i*60,1,0],
  ['B',2,sec(9,0)+i*60,sec(9,0)+i*60,1,1]
]]);
const schedule={schema:2,network:'aut',timezone:'Europe/Rome',
  routes:[['R1','1',3]],stops:[['A','A',45,12,''],['B','B',45.01,12,'']],
  snapshotByDay:{'20260930':'snap'},chunksData:{'20260930':{trips:rows}}
};
const plan=S.createServicePlan({provider:'actv-official',network:'aut',core,schedule,coreBySnapshot:{snap:core}});
const expected=E.createExpectedPositionModel({servicePlan:plan,shapesBySnapshot:{snap:{S1:[[45,12],[45.01,12]]}}});
const ids=Object.fromEntries(trips.map(t=>[t.id,plan.getTrip('20260930',t.id).id]));

function trip(id,{status='observed',delay=360,delaySource='official_realtime',progress=400,
  motionMode='live',position={lat:45.005,lon:12},confidence=.9}={}){
  return {
    tripInstanceId:ids[id],routeId:'R1',status,active:true,
    plannedStart:100,plannedEnd:999999,confidence,
    delay:{value:delay,source:delaySource,confidence:.9,observedAt:null},
    position:{value:position,source:position?'official_realtime_position':'schedule_only',confidence:.9,observedAt:null},
    motionMode,
    motion:{shapeProgress:{value:progress,confidence:.9,observedAt:null},position:{value:position,source:motionMode,confidence:.9,observedAt:null}},
    observationAgeSec:10
  };
}
function snapshot(at,tripStates){
  for(const row of tripStates){
    if(row.delay&&row.delay.source!=='schedule_only')row.delay.observedAt=at;
    if(row.position&&row.position.source==='official_realtime_position')row.position.observedAt=at;
    if(row.motion?.shapeProgress&&['live','predicted_live'].includes(row.motionMode))row.motion.shapeProgress.observedAt=at;
    if(row.motion?.position&&['live','predicted_live'].includes(row.motionMode))row.motion.position.observedAt=at;
  }
  return {provider:'actv-official',network:'aut',generatedAt:at,tripStates,vehicleStates:[]};
}
function baseline(at){
  return snapshot(at,['T1','T2','T3','T4'].map(id=>trip(id,{delay:0,progress:400+at,confidence:1})));
}

const engine=D.createDerivedEventEngine({servicePlan:plan,expectedPosition:expected});
engine.analyze(baseline(0));
engine.analyze(baseline(60));
engine.analyze(baseline(120));

const anomalous=snapshot(180,[
  trip('T1',{delay:420,progress:400,position:{lat:46,lon:13}}),
  trip('T2',{status:'likely_missing',delay:null,delaySource:'schedule_only',motionMode:'scheduled_simulation',progress:null,position:null,confidence:.7}),
  trip('T3',{status:'likely_missing',delay:null,delaySource:'schedule_only',motionMode:'scheduled_simulation',progress:null,position:null,confidence:.65}),
  trip('T4',{status:'expected_unobserved',delay:null,delaySource:'schedule_only',motionMode:'scheduled_simulation',progress:null,position:null,confidence:.5})
]);

/* Build enough same-progress, delayed history for T1 without disturbing the
   three high-coverage baseline samples used by coverage-drop detection. */
const stoppedEngine=D.createDerivedEventEngine({servicePlan:plan,expectedPosition:expected});
for(const [t,p] of [[0,400],[60,405],[120,410],[180,412]]){
  stoppedEngine.analyze(snapshot(t,[
    trip('T1',{delay:420,progress:p}),
    trip('T2',{delay:0,progress:500+t}),
    trip('T3',{delay:0,progress:600+t}),
    trip('T4',{delay:0,progress:700+t})
  ]));
}
const stopped=stoppedEngine.analyze(snapshot(240,[
  trip('T1',{delay:420,progress:414}),
  trip('T2',{delay:0,progress:740}),
  trip('T3',{delay:0,progress:840}),
  trip('T4',{delay:0,progress:940})
]));

const result=engine.analyze(anomalous);

check('trip expected-unobserved events include likely-missing and unobserved trips',()=>{
  assert.equal(result.byType('trip_expected_unobserved').length,3);
});

check('two consecutive likely-missing trips produce route-level anomaly',()=>{
  const e=result.byType('consecutive_missing_trips')[0];
  assert(e);assert.equal(e.scope.routeIds[0],'R1');assert.equal(e.scope.tripInstanceIds.length,2);
});

check('undocumented disruption is derived only when no official route alert overlaps',()=>{
  const e=result.byType('possible_undocumented_disruption')[0];
  assert(e);assert.equal(e.sourceKind,'derived');assert.equal(e.officialOverlap.matched,false);
  assert.equal(e.userVisible,false);
});

check('coverage drop compares current snapshot with previous healthy baseline',()=>{
  const e=result.byType('realtime_coverage_drop')[0];
  assert(e);assert(e.evidence[0].baseline>=.99);assert(e.evidence[0].current<=.25);
});

check('far observed GPS produces off-shape diagnostic',()=>{
  const e=result.byType('vehicle_off_shape')[0];
  assert(e);assert(e.evidence[0].distanceM>250);
});

check('persistent delay requires multiple current qualifying samples',()=>{
  const persistentEngine=D.createDerivedEventEngine({servicePlan:plan,expectedPosition:expected});
  let r;
  for(const t of [0,60,120]){
    r=persistentEngine.analyze(snapshot(t,[
      trip('T1',{delay:360,progress:400+t}),trip('T2',{delay:0,progress:500+t}),
      trip('T3',{delay:0,progress:600+t}),trip('T4',{delay:0,progress:700+t})
    ]));
  }
  const e=r.byType('persistent_delay')[0];
  assert(e);assert.equal(e.evidence[0].count,3);assert.equal(e.evidence[0].durationSec,120);
});

check('stopped anomaly requires duration, low progress movement and meaningful delay',()=>{
  const e=stopped.byType('vehicle_stopped_anomaly')[0];
  assert(e);assert(e.evidence[0].durationSec>=180);assert(e.evidence[0].progressRangeM<=35);
});

check('official alert overlap suppresses only undocumented hypothesis, not underlying derived events',()=>{
  const x=D.createDerivedEventEngine({servicePlan:plan,expectedPosition:expected});
  x.analyze(baseline(0));x.analyze(baseline(60));x.analyze(baseline(120));
  const r=x.analyze(anomalous,{officialAlerts:[{
    id:'official-r1',lifecycle:'active',scope:{lines:['1'],networks:[]}
  }]});
  const missing=r.byType('consecutive_missing_trips')[0];
  assert(missing);assert.equal(missing.officialOverlap.matched,true);
  assert.equal(missing.officialOverlap.alertIds[0],'official-r1');
  assert.equal(r.byType('possible_undocumented_disruption').length,0);
});

check('derived and official provenance remain distinct contracts',()=>{
  for(const e of result.active){
    assert.equal(e.sourceKind,'derived');assert.notEqual(e.sourceKind,'official');assert.equal(e.userVisible,false);
  }
});

check('event lifecycle preserves firstSeen and emits resolved transition',()=>{
  const e=result.byType('vehicle_off_shape')[0];assert(e);
  const recovered=engine.analyze(snapshot(240,[
    trip('T1',{delay:0,progress:700,position:{lat:45.006,lon:12}}),
    trip('T2',{delay:0,progress:800}),trip('T3',{delay:0,progress:900}),trip('T4',{delay:0,progress:1000})
  ]));
  const resolved=recovered.resolved.find(x=>x.id===e.id);
  assert(resolved);assert.equal(resolved.lifecycle,'resolved');assert.equal(resolved.resolvedAt,240);
  assert.equal(resolved.firstSeenAt,e.firstSeenAt);
});

check('repeated polling of the same stale observation does not create persistence',()=>{
  const x=D.createDerivedEventEngine({servicePlan:plan,expectedPosition:expected});
  const same=trip('T1',{delay:360,progress:400});
  same.delay.observedAt=10;same.position.observedAt=10;
  same.motion.shapeProgress.observedAt=10;same.motion.position.observedAt=10;
  let r;
  for(const t of [10,70,130,190]){
    const clone=JSON.parse(JSON.stringify(same));
    r=x.analyze({provider:'actv-official',network:'aut',generatedAt:t,tripStates:[clone],vehicleStates:[]});
  }
  assert.equal(r.byType('persistent_delay').length,0);
  assert.equal(r.byType('vehicle_stopped_anomaly').length,0);
});

check('persistent delay resolves immediately when current delay is no longer above threshold',()=>{
  const x=D.createDerivedEventEngine({servicePlan:plan,expectedPosition:expected});
  let r;
  for(const t of [0,60,120])r=x.analyze(snapshot(t,[trip('T1',{delay:360,progress:400+t})]));
  const id=r.byType('persistent_delay')[0].id;
  const next=x.analyze(snapshot(180,[trip('T1',{delay:0,progress:580})]));
  assert.equal(next.byType('persistent_delay').length,0);
  assert(next.resolved.some(e=>e.id===id));
});

check('summary exposes diagnostic counts without KPI semantics',()=>{
  const s=result.summary();
  assert(s.active>0);assert(s.types.consecutive_missing_trips>=1);
  assert(s.officialOverlap.unmatched>=1);
});

console.log('RESULT: '+n+' derived-event-engine checks passed.');
