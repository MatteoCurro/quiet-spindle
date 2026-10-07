const assert=require('assert');
for(const p of [
  '../js/navigation/gps-reliability.js',
  '../js/navigation/offroute.js',
  '../js/navigation/wake-lock.js',
  '../js/navigation/visibility.js'
]){
  delete require.cache[require.resolve(p)];require(p);
}

const G=globalThis.UVNavigationGpsReliability;
const gps=G.create({hardAccuracyM:100,staleAfterMs:20000,maxWalkingMps:7.5});
let r=gps.update({lat:45,lon:12,accuracyM:8,timestampMs:100000},100000);
assert.equal(r.accepted,true);
assert.equal(r.quality,'good');
r=gps.update({lat:45.02,lon:12.02,accuracyM:8,timestampMs:101000},101000);
assert.equal(r.accepted,false);
assert.equal(r.reason,'jump');
r=gps.update({lat:45.00005,lon:12.00002,accuracyM:12,timestampMs:102000},102000);
assert.equal(r.accepted,true);
assert(r.fix.lat>45&&r.fix.lat<45.00005);
r=gps.update({lat:45,lon:12,accuracyM:10,timestampMs:1000},30000);
assert.equal(r.accepted,false);
assert.equal(r.reason,'stale');

const O=globalThis.UVNavigationOffRoute;
const one=O.create({minSamples:3,minDurationMs:6500});
assert.equal(one.update({distanceM:70,accuracyM:10,timestampMs:1000}).state,'UNCERTAIN');
assert.equal(one.update({distanceM:5,accuracyM:10,timestampMs:2000}).state,'ON_ROUTE','single anomaly must reset without reroute');

const persistent=O.create({minSamples:3,minDurationMs:6500});
assert.equal(persistent.update({distanceM:80,accuracyM:10,timestampMs:1000}).state,'UNCERTAIN');
assert.equal(persistent.update({distanceM:82,accuracyM:10,timestampMs:4000}).state,'UNCERTAIN');
assert.equal(persistent.update({distanceM:85,accuracyM:10,timestampMs:8000}).state,'OFF_ROUTE_CONFIRMED');
assert.equal(persistent.markRerouting().state,'REROUTING');
assert.equal(persistent.rerouteFailed(9000).state,'UNCERTAIN');
assert.equal(persistent.update({distanceM:4,accuracyM:10,timestampMs:10000}).state,'ON_ROUTE');

(async()=>{
  let released=false,releaseHandler=null;
  const sentinel={
    addEventListener(name,fn){if(name==='release')releaseHandler=fn},
    async release(){released=true;releaseHandler?.()}
  };
  const nav={wakeLock:{request:async type=>{assert.equal(type,'screen');return sentinel}}};
  const listeners=new Map();
  const doc={
    visibilityState:'visible',
    addEventListener(name,fn){listeners.set(name,fn)},
    removeEventListener(name){listeners.delete(name)}
  };
  const W=globalThis.UVNavigationWakeLock.create({navigator:nav,document:doc});
  let state=await W.acquire();
  assert.equal(state.active,true);
  state=await W.release();
  assert.equal(released,true);
  assert.equal(state.active,false);
  W.unbind();

  let now=1000;
  const visDoc={visibilityState:'visible'};
  const V=globalThis.UVNavigationVisibility.create({document:visDoc,clock:()=>now});
  assert.equal(V.snapshot().visible,true);
  visDoc.visibilityState='hidden';now=2000;V.update();now=7000;
  assert.equal(V.snapshot().hiddenForMs,5000);
  visDoc.visibilityState='visible';now=8000;V.update();
  assert.equal(V.snapshot().visible,true);

  console.log('navigation-reliability tests passed');
})().catch(err=>{console.error(err);process.exit(1)});
