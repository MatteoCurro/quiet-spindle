const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Intl,Date,Map,Set,Object,Array,Number,String,Error,Math});
for(const file of ['gtfs.js','service-plan.js','expected-position.js','delay-position.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);

const S=window.UVTransitServicePlan,E=window.UVTransitExpectedPosition,D=window.UVTransitDelayPosition;
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
const model=D.createDelayPositionModel({servicePlan:plan,expectedPosition:expected});
const trip=plan.getTrip('20260930','T1');
const now=at('2026-09-30T08:10:00+02:00');
const matched=(id,confidence=1)=>[{observationId:id,classification:'exact',matched:true,tripInstanceId:trip.id,routeId:'R1',confidence}];

check('official trip-level delay has highest priority',()=>{
  const obs=[
    {id:'tu',provider:'actv-official',network:'aut',kind:'trip_update',observedAt:now-10,delay:120,stopTimeUpdates:[]},
    {id:'vp',provider:'actv-official',network:'aut',kind:'vehicle_position',observedAt:now-5,position:{lat:45.012,lon:12}}
  ];
  const x=model.estimate(trip,{observations:obs,resolutions:[...matched('tu'),...matched('vp')],now});
  assert.equal(x.delay.source,'official_realtime');assert.equal(x.delay.value,120);
  assert.equal(x.delay.details.method,'trip_delay');
});

check('official stop event delay is used when top-level delay is absent',()=>{
  const obs=[{id:'tu2',kind:'trip_update',observedAt:now-5,stopTimeUpdates:[
    {stopId:'B',stopSequence:2,arrival:{delay:75,time:at('2026-09-30T08:11:15+02:00')}}
  ]}];
  const x=model.estimate(trip,{observations:obs,resolutions:matched('tu2'),now});
  assert.equal(x.delay.source,'official_realtime');assert.equal(x.delay.value,75);
  assert.equal(x.delay.details.method,'event_delay');
});

check('official event time can derive delay against planned stop time',()=>{
  const actual=at('2026-09-30T08:11:30+02:00');
  const obs=[{id:'tu3',kind:'trip_update',observedAt:now-5,stopTimeUpdates:[
    {stopId:'B',stopSequence:2,arrival:{time:actual}}
  ]}];
  const x=model.estimate(trip,{observations:obs,resolutions:matched('tu3'),now});
  assert.equal(x.delay.source,'official_realtime');
  assert.equal(x.delay.value,90);
  assert.equal(x.delay.details.method,'event_time');
});

check('GPS position derives positive delay from timetable progress',()=>{
  const obs=[{id:'vp1',kind:'vehicle_position',observedAt:at('2026-09-30T08:12:00+02:00'),position:{lat:45.01,lon:12},bearing:0,speed:8}];
  const x=model.estimate(trip,{observations:obs,resolutions:matched('vp1'),now:at('2026-09-30T08:12:05+02:00')});
  assert.equal(x.delay.source,'position_derived');
  assert(Math.abs(x.delay.value-120)<1);
  assert.equal(x.position.source,'official_realtime_position');
  assert.equal(x.shapeProgress.source,'position_derived');
});

check('GPS position can derive a negative delay for an early vehicle',()=>{
  const obs=[{id:'vp2',kind:'vehicle_position',observedAt:at('2026-09-30T08:08:00+02:00'),position:{lat:45.01,lon:12}}];
  const x=model.estimate(trip,{observations:obs,resolutions:matched('vp2'),now:at('2026-09-30T08:08:05+02:00')});
  assert.equal(x.delay.source,'position_derived');assert(Math.abs(x.delay.value+120)<1);
});

check('latest VehiclePosition wins current live position',()=>{
  const obs=[
    {id:'old',kind:'vehicle_position',observedAt:now-30,position:{lat:45.005,lon:12}},
    {id:'new',kind:'vehicle_position',observedAt:now-5,position:{lat:45.009,lon:12}}
  ];
  const x=model.estimate(trip,{observations:obs,resolutions:[...matched('old'),...matched('new')],now});
  assert.equal(x.liveObservationId,'new');assert.equal(x.position.value.lat,45.009);
});

check('far GPS remains live position but is rejected for position-derived delay',()=>{
  const obs=[{id:'far',kind:'vehicle_position',observedAt:now-5,position:{lat:46,lon:13}}];
  const x=model.estimate(trip,{observations:obs,resolutions:matched('far'),now});
  assert.equal(x.position.source,'official_realtime_position');
  assert.equal(x.delay.source,'schedule_only');assert.equal(x.delay.value,null);
  assert.equal(x.hasProjectedLivePosition,false);
});

check('schedule-only fallback never invents zero delay',()=>{
  const x=model.estimate(trip,{observations:[],resolutions:[],now});
  assert.equal(x.delay.source,'schedule_only');assert.equal(x.delay.value,null);assert.equal(x.delay.confidence,0);
  assert.equal(x.position.source,'schedule_shape');assert(x.position.value);
});

check('inactive trip does not expose a fake scheduled position',()=>{
  const x=model.estimate(trip,{observations:[],resolutions:[],now:at('2026-09-30T09:30:00+02:00')});
  assert.equal(x.position.source,'schedule_only');assert.equal(x.position.value,null);
  assert.equal(x.position.details.reason,'trip_not_active');
});

check('confidence decays as official evidence ages',()=>{
  const fresh=model.estimate(trip,{observations:[{id:'f',kind:'trip_update',observedAt:now-30,delay:60,stopTimeUpdates:[]}],resolutions:matched('f'),now});
  const stale=model.estimate(trip,{observations:[{id:'s',kind:'trip_update',observedAt:now-1900,delay:60,stopTimeUpdates:[]}],resolutions:matched('s'),now});
  assert(fresh.delay.confidence>stale.delay.confidence);
});

check('position-derived confidence includes identity confidence',()=>{
  const obs=[{id:'weak',kind:'vehicle_position',observedAt:now,position:{lat:45.01,lon:12}}];
  const strong=model.estimate(trip,{observations:obs,resolutions:matched('weak',1),now});
  const weak=model.estimate(trip,{observations:obs,resolutions:matched('weak',.6),now});
  assert(strong.delay.confidence>weak.delay.confidence);
});

check('all exposed metrics use value/source/confidence/observedAt contract',()=>{
  const x=model.estimate(trip,{observations:[],resolutions:[],now});
  for(const key of ['delay','position','shapeProgress','theoreticalTime']){
    const m=x[key];assert(Object.prototype.hasOwnProperty.call(m,'value'));
    assert.equal(typeof m.source,'string');assert.equal(typeof m.confidence,'number');
    assert(Object.prototype.hasOwnProperty.call(m,'observedAt'));
  }
});

console.log('RESULT: '+n+' delay-position checks passed.');
