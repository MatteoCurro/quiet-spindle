const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.resolve(__dirname,'..');
const window={};window.window=window;const ctx=vm.createContext({window,console});
for(const f of ['js/core/gtfs.js','js/core/prediction.js'])vm.runInContext(fs.readFileSync(root+'/'+f,'utf8'),ctx,{filename:f});
const G=window.UVTransitGTFS,P=window.UVTransitPrediction;
const shape=G.prepareShape([{lat:45,lon:12,seq:1},{lat:45,lon:12.03,seq:2}]);
let count=0;function check(name,fn){fn();console.log('PASS '+name);count++}
function vehicle(overrides={}){return {shape,stateProgress:100,measuredProgress:100,fixProgress:100,fixTimestamp:1000,lastDataTs:1000,fixIntervalEma:10,speed:10,targetSpeed:10,observedSpeed:10,currentStatus:'IN_TRANSIT_TO',routeType:'0',displayLat:45,displayLon:12,nextStop:null,...overrides}}
function stopAt(progress,time=0){const p=G.pointAt(shape,progress);return {id:'S',name:'Stop',lat:p.lat,lon:p.lon,time,delay:0}}

check('physical max unchanged',()=>assert.equal(P.DEFAULTS.maxSpeed,24));
check('water physical profile remains distinct and shared',()=>{assert.equal(P.PROFILES.water.maxSpeed,18);assert.equal(P.PROFILES.water.projectionMaxAge,50);assert.strictEqual(P.PROFILES.land,P.DEFAULTS)});
check('visual catch-up separated',()=>assert(P.DEFAULTS.maxCorrectionSpeed>P.DEFAULTS.maxSpeed));
check('elastic lag follows fix cadence',()=>{const a=P.elasticLagSeconds(vehicle({fixIntervalEma:7})),b=P.elasticLagSeconds(vehicle({fixIntervalEma:14}));assert(a>=2.2&&a<b&&b<=4.8,`a=${a} b=${b}`)});
check('elastic lag collapses then grows inside fix cycle',()=>{const v=vehicle({fixIntervalEma:10});const a=P.elasticLagSeconds(v,null,0),m=P.elasticLagSeconds(v,null,5.5),e=P.elasticLagSeconds(v,null,10);assert(m<a*.45,`start=${a} mid=${m}`);assert(e>m*2,`mid=${m} end=${e}`)});
check('duplicate timestamp does not alter speed',()=>{const v=vehicle();const before=[v.targetSpeed,v.observedSpeed,v.fixProgress,v.fixIntervalEma];const r=P.acceptProgressFix(v,130,1000);assert.equal(r.reason,'duplicate');assert.deepEqual([v.targetSpeed,v.observedSpeed,v.fixProgress,v.fixIntervalEma],before)});
check('older packet rejected',()=>{const v=vehicle();const r=P.acceptProgressFix(v,80,999);assert.equal(r.reason,'older');assert.equal(v.fixProgress,100)});
check('new fix updates speed and cadence from source time',()=>{const v=vehicle({fixIntervalEma:null});const r=P.acceptProgressFix(v,200,1010);assert(r.accepted);assert.equal(v.fixProgress,200);assert.equal(v.fixTimestamp,1010);assert(Math.abs(v.fixIntervalEma-10)<.01);assert(v.observedSpeed>9)});

check('pure physical projection advances without elastic presentation lag',()=>{const v=vehicle({fixProgress:200,measuredProgress:200,stateProgress:165,fixIntervalEma:10,targetSpeed:10});const p=P.predictPhysicalProgress(v,1005);const visual=P.projectedAnchor(v,1005);assert(p>visual,'physical='+p+' visual='+visual);assert(p>240,'physical='+p)});

check('fresh elastic anchor begins behind raw fix',()=>{const v=vehicle({fixProgress:200,measuredProgress:200,stateProgress:165});const a=P.projectedAnchor(v,1000);assert(a<200,`anchor=${a}`);assert(a>150,`anchor too far back ${a}`)});
check('elastic anchor crosses raw fix during normal interval',()=>{const v=vehicle({fixProgress:200,measuredProgress:200,stateProgress:165,fixIntervalEma:10,targetSpeed:10});const early=P.projectedAnchor(v,1001),mid=P.projectedAnchor(v,1005);assert(early<200,`early=${early}`);assert(mid>200,`mid=${mid}`)});
check('elastic anchor remains moving while feed is fresh',()=>{const v=vehicle({fixProgress:200,measuredProgress:200,stateProgress:165,targetSpeed:10});const a=P.projectedAnchor(v,1005),b=P.projectedAnchor(v,1012);assert(b>a+35,`a=${a} b=${b}`)});

check('marker catches a real positive debt quickly',()=>{const v=vehicle({stateProgress:80,fixProgress:180,measuredProgress:180,fixTimestamp:1000,lastDataTs:1000,speed:8,targetSpeed:10});let now=1000;for(let i=0;i<30;i++){now+=.1;P.stepVehicle(v,now,.1)}const anchor=P.projectedAnchor(v,now);assert(anchor-v.stateProgress<20,`gap ${anchor-v.stateProgress}`)});
check('prediction never reverses marker',()=>{const v=vehicle({stateProgress:220,fixProgress:180,measuredProgress:180,fixTimestamp:1000,lastDataTs:1000,speed:10,targetSpeed:10});P.stepVehicle(v,1000,.2);assert(v.stateProgress>=220)});
check('large debt snaps to elastic anchor',()=>{const v=vehicle({stateProgress:20,fixProgress:400,measuredProgress:400,fixTimestamp:1000,lastDataTs:1000,speed:10,targetSpeed:10,fixIntervalEma:10});const anchor=P.projectedAnchor(v,1000);P.stepVehicle(v,1000,.1);assert(Math.abs(v.stateProgress-anchor)<.01,`state=${v.stateProgress} anchor=${anchor}`)});

function simulate(dt){const v=vehicle({stateProgress:65,fixProgress:100,measuredProgress:100,fixTimestamp:1000,lastDataTs:1000,speed:10,targetSpeed:10});let now=1000;for(let t=0;t<6-1e-9;t+=dt){now+=dt;P.stepVehicle(v,now,dt)}return v.stateProgress}
check('5 FPS and 60 FPS stay close',()=>{const a=simulate(.2),b=simulate(1/60);assert(Math.abs(a-b)<14,`5fps=${a}, 60fps=${b}`)});
check('resume reanchors to elastic estimate after RAF pause',()=>{const v=vehicle({stateProgress:20,fixProgress:100,measuredProgress:100,fixTimestamp:1000,lastDataTs:1000,targetSpeed:10,fixIntervalEma:10});const anchor=P.projectedAnchor(v,1005);P.reanchorVehicle(v,1005);assert(Math.abs(v.stateProgress-anchor)<.01)});

check('elastic cycle visibly accelerates then eases off',()=>{
  const v=vehicle({stateProgress:64,fixProgress:100,measuredProgress:100,fixTimestamp:1000,lastDataTs:1000,fixIntervalEma:10,speed:10,targetSpeed:10,observedSpeed:10});
  let now=1000;
  // Warm one complete cycle so the state is representative at a new fix.
  for(let i=0;i<100;i++){now+=.1;P.stepVehicle(v,now,.1)}
  P.acceptProgressFix(v,200,now);
  const perSecond=[];
  let prev=v.stateProgress;
  for(let sec=0;sec<9;sec++){
    for(let i=0;i<10;i++){now+=.1;P.stepVehicle(v,now,.1)}
    perSecond.push(v.stateProgress-prev);prev=v.stateProgress;
  }
  const early=Math.max(...perSecond.slice(1,5));
  const late=Math.min(...perSecond.slice(6,9));
  assert(early>late+4,`profile ${perSecond.map(x=>x.toFixed(1)).join(',')}`);
});

check('periodic fixes create behind-then-ahead visual cycle',()=>{
  const v=vehicle({stateProgress:64,fixProgress:100,measuredProgress:100,fixTimestamp:1000,lastDataTs:1000,fixIntervalEma:10,speed:10,targetSpeed:10,observedSpeed:10});
  let now=1000;
  for(let cycle=0;cycle<3;cycle++){
    const rawFix=v.fixProgress;
    // shortly after the fix the marker must still be behind it
    for(let i=0;i<10;i++){now+=.1;P.stepVehicle(v,now,.1)}
    assert(v.stateProgress<rawFix+2,`cycle ${cycle} should start behind raw=${rawFix}, display=${v.stateProgress}`);
    // before the next fix it must have crossed the stationary raw point
    for(let i=0;i<70;i++){now+=.1;P.stepVehicle(v,now,.1)}
    assert(v.stateProgress>rawFix+8,`cycle ${cycle} never crossed raw=${rawFix}, display=${v.stateProgress}`);
    // complete 10 s interval, then feed the new physical fix
    for(let i=0;i<20;i++){now+=.1;P.stepVehicle(v,now,.1)}
    const newRaw=100+10*(now-1000);
    P.acceptProgressFix(v,newRaw,now);
    assert(v.stateProgress<newRaw,`cycle ${cycle} should be behind new fix raw=${newRaw}, display=${v.stateProgress}`);
  }
});

check('stale extrapolation decays instead of running forever',()=>{const v=vehicle({targetSpeed:10,observedSpeed:10,speed:10});const a18=P.projectedAnchor(v,1018),a30=P.projectedAnchor(v,1030),a40=P.projectedAnchor(v,1040),a50=P.projectedAnchor(v,1050);assert(a30>a18);assert(a40>a30);assert(Math.abs(a50-a40)<.01,`a40=${a40} a50=${a50}`)});

check('tram prediction slows materially near next stop',()=>{const v=vehicle({stateProgress:200,targetSpeed:18,observedSpeed:18,speed:18,routeType:'0',nextStop:stopAt(255)});const cap=P.stopApproachSpeedCap(v);const target=P.targetSpeed(v,1000);assert(cap<18,`cap=${cap}`);assert(target<18,`target=${target}`)});
check('bus prediction also slows near next stop but uses bus profile',()=>{const v=vehicle({stateProgress:200,targetSpeed:18,observedSpeed:18,speed:18,routeType:'3',nextStop:stopAt(260)});const cap=P.stopApproachSpeedCap(v);assert(cap<18,`cap=${cap}`);assert(cap>0)});
check('elastic projection itself respects stop slowdown',()=>{const base=vehicle({stateProgress:200,fixProgress:200,measuredProgress:200,targetSpeed:18,observedSpeed:18,speed:18,routeType:'0'});const near=vehicle({...base,nextStop:stopAt(250)});const free=P.projectedAnchor(base,1008),braked=P.projectedAnchor(near,1008);assert(braked<free-8,`free=${free} braked=${braked}`)});
check('stopped vehicle anchors exactly to GPS stop',()=>{const v=vehicle({fixProgress:250,measuredProgress:250,stateProgress:220,currentStatus:'STOPPED_AT',nextStop:stopAt(250)});assert.equal(P.targetSpeed(v,1000),0);assert(Math.abs(P.projectedAnchor(v,1005)-250)<.01)});

console.log(`RESULT: ${count} motion checks passed.`);
