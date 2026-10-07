const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Intl,Date,Map,Set,Object,Array,Number,String,Error,Math});
for(const file of ['gtfs.js','service-plan.js','expected-position.js','delay-position.js','prediction.js','motion-state.js','transit-state-engine.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);

const S=window.UVTransitServicePlan,E=window.UVTransitExpectedPosition,D=window.UVTransitDelayPosition,M=window.UVTransitMotionState,T=window.UVTransitState;
let n=0;function check(name,fn){fn();n++;console.log('PASS '+name)}
const at=s=>Date.parse(s)/1000;

const core={schema:1,network:'aut',
  routes:[{id:'R1',short:'1',long:'Linea 1',desc:'UM',type:3}],
  stops:[
    {id:'A',name:'A',lat:45,lon:12},
    {id:'B',name:'B',lat:45.01,lon:12},
    {id:'C',name:'C',lat:45.02,lon:12}
  ],
  trips:[{id:'T1',routeId:'R1',directionId:'0',headsign:'C',shapeId:'S1',blockId:''}]
};
const schedule={schema:2,network:'aut',timezone:'Europe/Rome',
  routes:[['R1','1',3]],stops:[['A','A',45,12,''],['B','B',45.01,12,''],['C','C',45.02,12,'']],
  snapshotByDay:{'20260930':'snap'},
  chunksData:{'20260930':{trips:[
    ['T1','R1','C','S1',[
      ['A',1,28800,28800,1,0],
      ['B',2,29400,29400,1,1],
      ['C',3,30000,30000,1,1]
    ]]
  ]}}
};
const plan=S.createServicePlan({provider:'actv-official',network:'aut',core,schedule,coreBySnapshot:{snap:core}});
const expected=E.createExpectedPositionModel({
  servicePlan:plan,shapesBySnapshot:{snap:{S1:[[45,12],[45.01,12],[45.02,12]]}}
});
const delay= D.createDelayPositionModel({servicePlan:plan,expectedPosition:expected});
const motion=M.createMotionStateModel({servicePlan:plan,expectedPosition:expected,delayPosition:delay});
const trip=plan.getTrip('20260930','T1');
const now=at('2026-09-30T08:10:30+02:00');
const res=id=>[{observationId:id,classification:'exact',matched:true,tripInstanceId:trip.id,routeId:'R1',confidence:1}];

check('water profile extends bounded prediction horizon without changing land defaults',()=>{
  const water=M.createMotionStateModel({
    servicePlan:plan,expectedPosition:expected,delayPosition:delay,
    predictionOptions:window.UVTransitPrediction.PROFILES.water
  });
  assert.equal(motion.options.liveMaxAgeSec,18);assert.equal(motion.options.predictedMaxAgeSec,40);
  assert.equal(water.options.liveMaxAgeSec,20);assert.equal(water.options.predictedMaxAgeSec,50);assert.equal(water.options.maxSpeedMps,18);
});

check('recent fix is live and remains raw observed position',()=>{
  const observedAt=now-10;
  const obs=[{id:'live',kind:'vehicle_position',observedAt,position:{lat:45.0105,lon:12},speed:8,bearing:0,details:{currentStatus:'IN_TRANSIT_TO'}}];
  const x=motion.estimate(trip,{observations:obs,resolutions:res('live'),now});
  assert.equal(x.mode,'live');assert.equal(x.position.source,'live');
  assert.equal(x.position.value.lat,45.0105);assert.equal(x.position.observedAt,observedAt);
  assert.equal(x.predictedFromObservedAt,null);
});

check('slightly stale fix with speed becomes predicted_live using physical projection',()=>{
  const observedAt=now-25;
  const obs=[{id:'pred-speed',kind:'vehicle_position',observedAt,position:{lat:45.01,lon:12},speed:8,bearing:0,details:{currentStatus:'IN_TRANSIT_TO'}}];
  const d=delay.estimate(trip,{observations:obs,resolutions:res('pred-speed'),now});
  const x=motion.estimate(trip,{observations:obs,resolutions:res('pred-speed'),delayEstimate:d,now});
  assert.equal(x.mode,'predicted_live');assert.equal(x.predictionMethod,'physical_speed_projection');
  assert(x.shapeProgress.value>d.shapeProgress.value);
  assert.equal(x.position.source,'predicted_live');assert.equal(x.position.observedAt,observedAt);
});

check('stopped vehicle remains anchored during predicted_live window',()=>{
  const observedAt=now-25;
  const obs=[{id:'stopped',kind:'vehicle_position',observedAt,position:{lat:45.01,lon:12},speed:0,details:{currentStatus:'STOPPED_AT'}}];
  const d=delay.estimate(trip,{observations:obs,resolutions:res('stopped'),now});
  const x=motion.estimate(trip,{observations:obs,resolutions:res('stopped'),delayEstimate:d,now});
  assert.equal(x.mode,'predicted_live');assert.equal(x.predictionMethod,'physical_speed_projection');
  assert(Math.abs(x.shapeProgress.value-d.shapeProgress.value)<.01);
});

check('prediction without reported speed can use delay-shifted schedule',()=>{
  const observedAt=now-25;
  const obs=[{id:'pred-delay',kind:'vehicle_position',observedAt,position:{lat:45.0095,lon:12},speed:null}];
  const d=delay.estimate(trip,{observations:obs,resolutions:res('pred-delay'),now});
  const x=motion.estimate(trip,{observations:obs,resolutions:res('pred-delay'),delayEstimate:d,now});
  assert.equal(x.mode,'predicted_live');assert.equal(x.predictionMethod,'delay_shifted_schedule');
  assert(x.shapeProgress.value>=d.shapeProgress.value);
});

check('fix beyond prediction horizon falls back to scheduled_simulation',()=>{
  const observedAt=now-50;
  const obs=[{id:'stale',kind:'vehicle_position',observedAt,position:{lat:45.01,lon:12},speed:8}];
  const x=motion.estimate(trip,{observations:obs,resolutions:res('stale'),now});
  assert.equal(x.mode,'scheduled_simulation');assert.equal(x.position.source,'scheduled_simulation');
  assert.equal(x.position.observedAt,null);assert.equal(x.anchorObservationId,null);
});

check('no VehiclePosition on active trip uses scheduled_simulation',()=>{
  const x=motion.estimate(trip,{observations:[],resolutions:[],now});
  assert.equal(x.mode,'scheduled_simulation');assert(x.position.value);
  assert.equal(x.shapeProgress.source,'scheduled_simulation');
});

check('TransitState uses predicted_live when stale position is the only fresh realtime evidence',()=>{
  const observedAt=now-25;
  const obs=[{id:'state-vp',provider:'actv-official',network:'aut',kind:'vehicle_position',observedAt,position:{lat:45.01,lon:12},speed:8}];
  const resolutions=res('state-vp');
  const engine=T.createTransitStateEngine({servicePlan:plan,expectedPosition:expected,delayPosition:delay,motionState:motion});
  const x=engine.snapshot({observations:obs,resolutions,now}).trip(trip.id);
  assert.equal(x.status,'predicted_live');assert.equal(x.motionMode,'predicted_live');
});

check('fresh TripUpdate keeps trip observed while its position may be predicted_live',()=>{
  const vpAt=now-25;
  const obs=[
    {id:'state-vp2',provider:'actv-official',network:'aut',kind:'vehicle_position',observedAt:vpAt,position:{lat:45.01,lon:12},speed:8},
    {id:'state-tu',provider:'actv-official',network:'aut',kind:'trip_update',observedAt:now-2,delay:30,stopTimeUpdates:[]}
  ];
  const resolutions=[
    {observationId:'state-vp2',classification:'exact',matched:true,tripInstanceId:trip.id,routeId:'R1',confidence:1},
    {observationId:'state-tu',classification:'exact',matched:true,tripInstanceId:trip.id,routeId:'R1',confidence:1}
  ];
  const engine=T.createTransitStateEngine({servicePlan:plan,expectedPosition:expected,delayPosition:delay,motionState:motion});
  const x=engine.snapshot({observations:obs,resolutions,now}).trip(trip.id);
  assert.equal(x.status,'observed');assert.equal(x.motionMode,'predicted_live');
});

check('inactive trip motion is unavailable rather than clamped to terminus',()=>{
  const x=motion.estimate(trip,{observations:[],resolutions:[],now:at('2026-09-30T09:30:00+02:00')});
  assert.equal(x.mode,'unavailable');assert.equal(x.position.value,null);
});

check('prediction confidence decays as the fix approaches prediction horizon',()=>{
  const mk=(id,age)=>[{id,kind:'vehicle_position',observedAt:now-age,position:{lat:45.01,lon:12},speed:8}];
  const a=motion.estimate(trip,{observations:mk('a',20),resolutions:res('a'),now});
  const b=motion.estimate(trip,{observations:mk('b',38),resolutions:res('b'),now});
  assert.equal(a.mode,'predicted_live');assert.equal(b.mode,'predicted_live');
  assert(a.position.confidence>b.position.confidence);
});

check('predicted_live keeps the source fix timestamp and generation time separate',()=>{
  const observedAt=now-25;
  const obs=[{id:'stamp',kind:'vehicle_position',observedAt,position:{lat:45.01,lon:12},speed:8}];
  const x=motion.estimate(trip,{observations:obs,resolutions:res('stamp'),now});
  assert.equal(x.position.observedAt,observedAt);assert.equal(x.generatedAt,now);
  assert.equal(x.predictedFromObservedAt,observedAt);
});

check('live mode never exposes predicted method metadata',()=>{
  const obs=[{id:'plain',kind:'vehicle_position',observedAt:now-2,position:{lat:45.01,lon:12},speed:8}];
  const x=motion.estimate(trip,{observations:obs,resolutions:res('plain'),now});
  assert.equal(x.mode,'live');assert.equal(x.predictionMethod,null);
});

console.log('RESULT: '+n+' motion-state checks passed.');
