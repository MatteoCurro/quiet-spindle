const fs=require('fs'),vm=require('vm'),assert=require('assert');
const window={};window.window=window;
const ctx=vm.createContext({window,Intl,Date,Map,Set,Object,Array,Number,String,Error,Math});
for(const file of ['gtfs.js','service-plan.js','expected-position.js'])
  vm.runInContext(fs.readFileSync(__dirname+'/../js/core/'+file,'utf8'),ctx);

const S=window.UVTransitServicePlan,E=window.UVTransitExpectedPosition;
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name)}
const approx=(a,b,tol=1)=>assert(Math.abs(a-b)<=tol,String(a)+' != '+String(b));

function makePlan(stops,tripStops,shapeId='S1',snapshotId='snap'){
  const core={schema:1,network:'aut',
    routes:[{id:'R1',short:'1',type:3}],
    stops,
    trips:[{id:'T1',routeId:'R1',directionId:'0',headsign:'End',shapeId,blockId:''}]
  };
  const schedule={schema:2,network:'aut',timezone:'Europe/Rome',
    routes:[['R1','1',3]],stops:stops.map(s=>[s.id,s.name,s.lat,s.lon,'']),
    snapshotByDay:{'20260930':snapshotId},
    chunksData:{'20260930':{trips:[['T1','R1','End',shapeId,tripStops]]}}
  };
  return S.createServicePlan({provider:'actv-official',network:'aut',core,schedule,coreBySnapshot:{[snapshotId]:core}});
}

const stops=[
  {id:'A',name:'A',lat:45,lon:12},
  {id:'B',name:'B',lat:45,lon:12.01},
  {id:'C',name:'C',lat:45,lon:12.02}
];
const rows=[
  ['A',1,8*3600,8*3600,1,0],
  ['B',2,8*3600+10*60,8*3600+12*60,1,1],
  ['C',3,8*3600+22*60,8*3600+22*60,1,1]
];
const plan=makePlan(stops,rows);
const instance=plan.getTrip('20260930','T1');
const shapes={S1:[[45,12],[45,12.01],[45,12.02]]};
const model=E.createExpectedPositionModel({servicePlan:plan,shapesBySnapshot:{snap:shapes}});

test('stop projections resolve monotonically along shape',()=>{
  const g=model.geometry(instance);
  assert.equal(g.status,'resolved');
  assert(g.shapeProgressByStop[0]<=g.shapeProgressByStop[1]);
  assert(g.shapeProgressByStop[1]<=g.shapeProgressByStop[2]);
  assert(g.maxStopDistanceM<2);
});

test('expected position interpolates by timetable between stops',()=>{
  const t=instance.stops[0].plannedDeparture+5*60;
  const state=model.expectedState(instance,t);
  approx(state.expectedShapeProgress,model.geometry(instance).shapeProgressByStop[1]/2,2);
  approx(state.expectedPosition.lon,12.005,.0001);
  assert.equal(state.previousStop.id,'A');assert.equal(state.nextStop.id,'B');
});

test('dwell time holds position at stop and advances stop context',()=>{
  const t=instance.stops[1].plannedArrival+60;
  const state=model.expectedState(instance,t),p=model.geometry(instance).shapeProgressByStop[1];
  approx(state.expectedShapeProgress,p,.1);
  assert.equal(state.previousStop.id,'B');assert.equal(state.nextStop.id,'C');
  assert.equal(state.expectedTimestampAtPosition,t);
});

test('timeAtProgress is inverse of timetable interpolation',()=>{
  const g=model.geometry(instance),p=(g.shapeProgressByStop[1]+g.shapeProgressByStop[2])/2;
  const expected=instance.stops[1].plannedDeparture+5*60;
  approx(model.timeAtProgress(instance,p),expected,1);
});

test('activeStates emits scheduled expected state only for active trips',()=>{
  const t=instance.plannedStart+60;
  const states=model.activeStates(t);assert.equal(states.length,1);
  assert.equal(states[0].source,'schedule_shape');assert(states[0].confidence>.9);
  assert.equal(model.activeStates(instance.plannedEnd+1).length,0);
});

test('missing shape is explicit and never fabricates a position',()=>{
  const missing=E.createExpectedPositionModel({servicePlan:plan,shapes:{}});
  const state=missing.expectedState(instance,instance.plannedStart+60);
  assert.equal(state.geometryStatus,'unavailable');assert.equal(state.expectedPosition,null);assert.equal(state.expectedShapeProgress,null);
});

test('loop projection cannot jump backwards at repeated coordinates',()=>{
  const loopStops=[
    {id:'A',name:'A',lat:45,lon:12},
    {id:'B',name:'B',lat:45.01,lon:12.01},
    {id:'C',name:'C',lat:45,lon:12},
    {id:'D',name:'D',lat:44.99,lon:12}
  ];
  const loopRows=[
    ['A',1,8*3600,8*3600,1,0],
    ['B',2,8*3600+10*60,8*3600+10*60,1,1],
    ['C',3,8*3600+20*60,8*3600+20*60,1,1],
    ['D',4,8*3600+30*60,8*3600+30*60,1,1]
  ];
  const loopPlan=makePlan(loopStops,loopRows,'LOOP','loopSnap');
  const loopModel=E.createExpectedPositionModel({servicePlan:loopPlan,shapesBySnapshot:{loopSnap:{LOOP:[
    [45,12],[45,12.01],[45.01,12.01],[45.01,12],[45,12],[44.99,12]
  ]}}});
  const g=loopModel.geometry(loopPlan.getTrip('20260930','T1'));
  assert.equal(g.status,'resolved');
  for(let i=1;i<g.shapeProgressByStop.length;i++)assert(g.shapeProgressByStop[i]>=g.shapeProgressByStop[i-1]);
  assert(g.shapeProgressByStop[2]>g.shapeProgressByStop[1]);
  assert(g.shapeProgressByStop[2]>g.shapeLengthM*.6);
});

test('same shape id remains snapshot-scoped',()=>{
  const oldPlan=makePlan(stops,rows,'SAME','old');
  const oldInstance=oldPlan.getTrip('20260930','T1');
  const m=E.createExpectedPositionModel({servicePlan:oldPlan,shapesBySnapshot:{
    old:{SAME:[[45,12],[45,12.01],[45,12.02]]},
    new:{SAME:[[45,12],[45.02,12],[45.04,12]]}
  }});
  assert(m.geometry(oldInstance).maxStopDistanceM<2);
});

test('summary reports geometry coverage',()=>{
  const s=model.summary();assert.equal(s.tripInstances,1);assert.equal(s.resolved,1);assert.equal(s.unavailable,0);
});

console.log('RESULT: '+count+' expected-position checks passed.');
